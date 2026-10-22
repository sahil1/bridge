// Bridge AI's service worker: what makes it an installable app on your phone.
//   Notifications: shows pushes ("API tests needs you" and what it asks) and opens that agent when
//   you tap one. Simple questions get answer buttons, where the browser shows them.
//   Speed: keeps the app's built files, so it opens instantly; the page itself is always fetched
//   fresh, so updates show up. When your computer can't be reached, it says so.
const ASSETS = 'bridge-assets-v1'

// The icon is kept too, for notifications and the "can't reach your computer" page.
self.addEventListener('install', (e) => e.waitUntil(caches.open(ASSETS).then((c) => c.addAll(['/icon-512.png'])).catch(() => {}).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== ASSETS) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  // Built files have a content hash in their name and never change: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname === '/icon-512.png') {
    e.respondWith(caches.open(ASSETS).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r })))
    return
  }
  // The page: always from your computer, with a clear message when it can't be reached.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
  }
})

self.addEventListener('push', (e) => {
  let n = {}
  try { n = e.data ? e.data.json() : {} } catch { n = { title: 'Bridge AI', body: e.data?.text() } }
  e.waitUntil((async () => {
    // Already looking at Bridge AI? It shows this itself.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (open.some((c) => c.visibilityState === 'visible' && c.focused)) return
    // Answer buttons, up to what this browser shows (Chrome: 2; iPhone: none).
    const actions = (n.actions || []).slice(0, self.Notification?.maxActions || 0)
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
    const r = await answer(pick.token)
    if (r?.ok) return answered(n, pick)
    url = r?.url || url
  }
  return openApp(new URL(url, location.origin).href, n)
}

// Quick, or the browser no longer lets this open a window for the tap.
async function answer(token) {
  try {
    const res = await fetch('/api/notify/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(6000) })
    return res.ok ? await res.json() : null
  } catch { return null }
}

// Says it went through, briefly and without a sound.
async function answered(n, pick) {
  const tag = `${n.tag || 'bridge'}-answered`
  await self.registration.showNotification(n.title, { body: `Answered: ${pick.title}`, tag, silent: true, icon: '/icon-512.png', badge: '/icon-512.png', data: { url: n.data?.url || '/' } })
  await new Promise((r) => setTimeout(r, 4000))
  for (const x of await self.registration.getNotifications({ tag })) x.close()
}

async function openApp(url, n) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const win = wins.find((c) => new URL(c.url).origin === location.origin)
  if (win) { await win.focus().catch(() => {}); win.postMessage({ type: 'open', url }); return }
  // Too long after the tap for the browser to open a window: leave a notification that does.
  await self.clients.openWindow(url).catch(() => self.registration.showNotification(n.title, { body: 'Open Bridge AI to answer', tag: n.tag || undefined, icon: '/icon-512.png', badge: '/icon-512.png', data: { url } }))
}

const OFFLINE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bridge AI</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px -apple-system,system-ui,sans-serif;background:#0f1115;color:#c9ced8;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:19px;color:#fff;margin:16px 0 8px}p{margin:6px 0;max-width:340px;line-height:1.45}img{width:64px;height:64px;border-radius:15px}button{margin-top:18px;height:40px;padding:0 20px;border-radius:10px;border:0;background:#3b82f6;color:#fff;font:600 15px inherit}</style></head>
<body><div><img src="/icon-512.png" alt=""><h1>Can't reach your computer</h1><p>Bridge AI runs on your computer. Check that it's on and Bridge AI is open, and that Tailscale is connected on both this phone and the computer.</p><button onclick="location.reload()">Try again</button></div></body></html>`
