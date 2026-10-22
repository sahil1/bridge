// The relay page's service worker. Bridge AI's own files and data live on your computer, so every
// request the app makes (pages, /api, /assets, pictures) is handed to the open relay page, which
// sends it through the encrypted link and streams the answer back here. Only the relay page's own
// files come from the relay itself.
// Also shows notifications from your computer, like Bridge AI's own service worker, and answers
// one from its buttons over a short encrypted link of its own (the page may be closed meanwhile).
const ASSETS = 'bridge-relay-assets-v1'
const OWN = new Set(['/index.html', '/shell.js', '/sw.js', '/link.js', '/link-sw.js', '/manifest.webmanifest', '/icon-512.png', '/apple-touch-icon.png', '/mark.svg'])
// link.js as a plain script (relay/build.js makes it): self.bridgeLink. Only answer buttons need it.
try { importScripts('/link-sw.js') } catch { /* buttons then open the app instead */ }

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
    // Answer buttons, up to what this browser shows (Chrome: 2; iPhone: none).
    const actions = (n.actions || []).slice(0, self.bridgeLink ? self.Notification?.maxActions || 0 : 0)
    await self.registration.showNotification(n.title || 'Bridge AI', {
      body: n.body || '',
      tag: n.tag || undefined,
      renotify: !!n.tag,
      icon: '/icon-512.png',
      badge: '/icon-512.png',
      data: { url: n.url || '/', actions },
      ...(actions.length ? { actions: actions.map(({ action, title }) => ({ action, title })) } : {}),
      requireInteraction: n.kind === 'needs-you',
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(clicked(e.notification, e.action))
})

// A tap opens Bridge AI at that agent. A button answers it from here, without opening anything,
// if the same question is still waiting (your computer checks); otherwise Bridge AI opens.
async function clicked(n, action) {
  const d = n.data || {}
  const pick = action && (d.actions || []).find((a) => a.action === action)
  let url = d.url || '/'
  if (pick) {
    const r = await answer(pick.token).catch(() => null)
    if (r?.ok) return answered(n, pick)
    url = r?.url || url
  }
  return openApp(new URL(url, location.origin).href, n)
}

// What the relay page keeps (IndexedDB): the pairing, with this phone's key.
const kept = (key) => new Promise((ok) => {
  const r = indexedDB.open('bridge-relay', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('kv')
  r.onerror = () => ok(null)
  r.onsuccess = () => {
    try { const g = r.result.transaction('kv').objectStore('kv').get(key); g.onsuccess = () => ok(g.result || null); g.onerror = () => ok(null) } catch { ok(null) }
  }
})

// One request to your computer over a link of its own: the same pairing as the page, fresh keys.
// Quick, or the browser no longer lets this open a window for the tap (10 seconds in Chrome).
async function answer(token) {
  const L = self.bridgeLink
  const p = L && await kept('pairing')
  if (!p?.hostKey) return null
  return new Promise((resolve) => {
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/_relay/link`)
    ws.binaryType = 'arraybuffer'
    let hello = null
    let session = null
    let head = null
    const body = []
    let inbox = Promise.resolve()
    const done = (r) => { clearTimeout(timer); resolve(r); try { ws.close() } catch { /* closed */ } }
    const timer = setTimeout(() => done(null), 7000)
    ws.onclose = () => done(null)
    ws.onmessage = (e) => {
      inbox = inbox.then(async () => {
        if (typeof e.data === 'string') {
          if (!JSON.parse(e.data).host) return done(null) // your computer is offline
          hello = await L.phoneHello(p.device, null, '')
          return ws.send(L.plainFrame(hello.hello))
        }
        if (!session) {
          session = (await L.phoneFinish(hello, p.device, L.readPlain(e.data), { hostKey: p.hostKey })).session
          const req = [L.pack(L.K.REQ, 1, { m: 'POST', u: '/api/notify/answer', h: [['content-type', 'application/json']], body: true }), L.pack(L.K.BODY, 1, L.utf8(JSON.stringify({ token }))), L.pack(L.K.END, 1)]
          for (const rec of req) ws.send(await session.seal(rec))
          return
        }
        const { kind, body: b } = L.unpack(await session.open(e.data))
        if (kind === L.K.HEAD) head = L.json(b)
        else if (kind === L.K.BODY) body.push(L.text(b))
        else if (kind === L.K.END) done(head?.s === 200 ? JSON.parse(body.join('')) : null)
        else if (kind === L.K.ERR) done(null)
      }).catch(() => done(null))
    }
  })
}

// Says it went through, briefly and without a sound.
async function answered(n, pick) {
  const tag = `${n.tag || 'bridge'}-answered`
  await self.registration.showNotification(n.title, { body: `Answered: ${pick.title}`, tag, silent: true, icon: '/icon-512.png', badge: '/icon-512.png', data: { url: n.data?.url || '/' } })
  await new Promise((r) => setTimeout(r, 4000))
  for (const x of await self.registration.getNotifications({ tag })) x.close()
}

async function openApp(url, n) {
  const top = await shell()
  if (top) {
    await top.focus().catch(() => {})
    // The app inside the page listens for this, as it does with its own service worker.
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'open', url })
    return
  }
  // Too long after the tap for the browser to open a window: leave a notification that does.
  await self.clients.openWindow(url).catch(() => self.registration.showNotification(n.title, { body: 'Open Bridge AI to answer', tag: n.tag || undefined, icon: '/icon-512.png', badge: '/icon-512.png', data: { url } }))
}
