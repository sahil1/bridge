// The relay page's service worker. Bridge AI's own files and data live on your computer, so every
// request the app makes (pages, /api, /assets, pictures) is handed to the open relay page, which
// sends it through the encrypted link and streams the answer back here. Only the relay page's own
// files come from the relay itself.
// Also shows notifications from your computer, like Bridge AI's own service worker.
const ASSETS = 'bridge-relay-assets-v1'
const OWN = new Set(['/index.html', '/shell.js', '/sw.js', '/link.js', '/manifest.webmanifest', '/icon-512.png', '/apple-touch-icon.png', '/mark.svg'])

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/_relay/')) return
  const nav = req.mode === 'navigate'
  if (nav && req.destination !== 'iframe') {
    // The relay page itself (with ?agent=… and the like, which it passes on to the app).
    if (url.pathname === '/' || url.pathname === '/index.html') return
  } else if (!nav && OWN.has(url.pathname)) return
  // Built files never change (their names carry a hash): keep them here so the app opens fast.
  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(ASSETS).then(async (c) => {
      const hit = await c.match(req)
      if (hit) return hit
      const res = await tunnel(req, url)
      if (res.ok) await c.put(req, res.clone()).catch(() => {})
      return res
    }))
    return
  }
  e.respondWith(tunnel(req, url))
})

// The relay page that holds the link: the one in front if there are several.
async function shell() {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const shells = all.filter((c) => c.frameType === 'top-level' && new URL(c.url).pathname === '/')
  return shells.find((c) => c.focused) || shells.find((c) => c.visibilityState === 'visible') || shells[0] || null
}

const NO_BODY = new Set([101, 103, 204, 205, 304])

async function tunnel(req, url) {
  const s = await shell()
  if (!s) return offline(req, 'Open Bridge AI first.')
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
  const { port1, port2 } = new MessageChannel()
  return new Promise((resolve) => {
    let ctrl
    let answered = false
    const stream = new ReadableStream({
      start(c) { ctrl = c },
      cancel() { port1.postMessage({ cancel: true }); port1.close() },
    })
    port1.onmessage = (e) => {
      const m = e.data
      if (m.head) {
        answered = true
        resolve(new Response(NO_BODY.has(m.head.s) || req.method === 'HEAD' ? null : stream, { status: m.head.s, headers: m.head.h }))
      } else if (m.chunk) {
        try { ctrl.enqueue(new Uint8Array(m.chunk)) } catch { /* reader went away */ }
      } else if (m.end) {
        try { ctrl.close() } catch { /* already closed */ }
        port1.close()
      } else if (m.error) {
        if (!answered) resolve(offline(req, m.error))
        else try { ctrl.error(new Error(m.error)) } catch { /* closed */ }
        port1.close()
      }
    }
    s.postMessage({ type: 'fetch', m: req.method, u: url.pathname + url.search, h: [...req.headers], body }, body ? [port2, body] : [port2])
  })
}

function offline(req, why) {
  if (req.mode === 'navigate') {
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center;color:#888;background:transparent"><p>${String(why).replace(/[<&]/g, '')}</p></body>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  return new Response(JSON.stringify({ error: why }), { status: 503, headers: { 'Content-Type': 'application/json' } })
}

self.addEventListener('push', (e) => {
  let n = {}
  try { n = e.data ? e.data.json() : {} } catch { n = { title: 'Bridge AI', body: e.data?.text() } }
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (open.some((c) => c.visibilityState === 'visible' && c.focused)) return
    await self.registration.showNotification(n.title || 'Bridge AI', {
      body: n.body || '',
      tag: n.tag || undefined,
      renotify: !!n.tag,
      icon: '/icon-512.png',
      badge: '/icon-512.png',
      data: { url: n.url || '/' },
      requireInteraction: n.kind === 'needs-you',
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', location.origin).href
  e.waitUntil((async () => {
    const top = await shell()
    if (top) {
      await top.focus()
      // The app inside the page listens for this, as it does with its own service worker.
      for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'open', url })
      return
    }
    await self.clients.openWindow(url)
  })())
})
