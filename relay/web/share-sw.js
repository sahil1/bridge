// The service worker of the page a Share Link opens (share.js). What's shared shows in a frame at
// /_c/<share>/…, and every request from it (a site's pages, pictures and scripts, an app's calls) is
// handed to the open page for that share, which sends it to the computer over its encrypted link and
// streams the answer back here. Nothing of it goes to the relay, which couldn't read it anyway.
//
// A site's or an app's own absolute paths (/style.css, /api/items) are its own, not this address's:
// a request from the frame for one is taken as the share's (by the frame's address, or for a page
// the frame goes to, the page it came from). Nothing is kept here.
const OWN = new Set(['/share.js', '/share-sw.js', '/link.js', '/mark.svg'])
const CONTENT = /^\/_c\/([\w-]{22})(\/.*)$/
// What any answer shown in the frame keeps to, whatever the computer said (it says the same): only
// this address's pages may frame it, and a page in it can't take over the window it's in. A PDF goes
// as it is: a sandbox stops the browser showing one.
const FRAMES = "frame-ancestors 'self'"
const SANDBOX = 'sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/_relay/')) return
  e.respondWith(route(e, url))
})

async function route(e, url) {
  const req = e.request
  const nav = req.mode === 'navigate'
  const m = CONTENT.exec(url.pathname)
  if (m) return tunnel(req, m[1], `${url.pathname}${url.search}`)
  // From what's shared: its own absolute path, under its share. The page itself (/, /v/…) and its
  // files are fetched as they are.
  const from = await sidOf(e, nav)
  if (from) {
    const to = `/_c/${from}${url.pathname}${url.search}`
    return nav ? Response.redirect(to, 302) : tunnel(req, from, to)
  }
  if (nav && req.destination !== 'iframe') return fetch(req)
  if (!nav && (OWN.has(url.pathname) || url.pathname === '/' || url.pathname.startsWith('/v/'))) return fetch(req)
  return said(req, 'This isn\'t part of what was shared.', 404)
}

// Which share a request belongs to when it isn't under /_c/ itself: the frame's, when the frame asks
// (its address), or for a page the frame goes to, the one it came from (Referer: the computer sends
// what's shared with Referrer-Policy: same-origin, so it's there and never leaves this address).
async function sidOf(e, nav) {
  if (!nav && e.clientId) {
    const c = await self.clients.get(e.clientId)
    const m = c && CONTENT.exec(new URL(c.url).pathname)
    if (m) return m[1]
  }
  if (nav && e.request.destination === 'iframe') {
    try { const m = CONTENT.exec(new URL(e.request.referrer).pathname); if (m) return m[1] } catch { /* none */ }
    // No referrer said: the one share open here, if there's one.
    const open = await viewers(null)
    const sids = [...new Set(open.map((c) => new URL(c.url).pathname.slice(3)))]
    if (sids.length === 1) return sids[0]
  }
  return null
}

// The pages open for a share (or any share: null), the one in front first.
async function viewers(sid) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const pages = all.filter((c) => c.frameType === 'top-level' && (sid ? new URL(c.url).pathname === `/v/${sid}` : /^\/v\/[\w-]{22}$/.test(new URL(c.url).pathname)))
  return pages.sort((a, b) => (b.focused - a.focused) || ((b.visibilityState === 'visible') - (a.visibilityState === 'visible')))
}

function headersOf(head) {
  const h = new Headers()
  for (const [k, v] of head.h || []) { try { h.append(k, v) } catch { /* not a header a page may set */ } }
  h.delete('set-cookie')
  h.delete('clear-site-data')
  h.delete('service-worker-allowed')
  if (!/^application\/pdf\b/i.test(h.get('content-type') || '')) h.append('Content-Security-Policy', SANDBOX)
  h.append('Content-Security-Policy', FRAMES)
  h.set('X-Content-Type-Options', 'nosniff')
  return h
}

const NO_BODY = new Set([101, 103, 204, 205, 304])
async function tunnel(req, sid, u) {
  const page = (await viewers(sid))[0]
  if (!page) return said(req, 'Open the link again: the page that shows this was closed.', 503)
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
  const { port1, port2 } = new MessageChannel()
  return new Promise((resolve) => {
    let answered = false
    const queue = []
    let ended = false
    let failed = null
    let wake = null
    // To the frame only as fast as it reads, and the page hears each piece taken ({ ack }), so the
    // computer sends no more than that.
    const stream = new ReadableStream({
      pull(c) {
        return new Promise((done) => {
          const next = () => {
            if (queue.length) {
              const b = queue.shift()
              c.enqueue(b)
              port1.postMessage({ ack: b.byteLength })
            } else if (failed) c.error(failed)
            else if (ended) { c.close(); port1.close() }
            else return (wake = next)
            done()
          }
          next()
        })
      },
      cancel() { queue.length = 0; port1.postMessage({ cancel: true }); port1.close() },
    }, { highWaterMark: 0 })
    const poke = () => { const w = wake; wake = null; w?.() }
    port1.onmessage = (e) => {
      const m = e.data
      if (m.head) {
        answered = true
        resolve(new Response(NO_BODY.has(m.head.s) || req.method === 'HEAD' ? null : stream, { status: m.head.s, headers: headersOf(m.head) }))
      } else if (m.chunk) { queue.push(new Uint8Array(m.chunk)); poke() }
      else if (m.end) { ended = true; poke() }
      else if (m.error) {
        if (!answered) resolve(said(req, m.error, 503))
        else { failed = new Error(m.error); poke() }
        port1.close()
      }
    }
    page.postMessage({ type: 'fetch', m: req.method, u, h: [...req.headers], body }, body ? [port2, body] : [port2])
  })
}

// Why something didn't open, as a page in the frame (or plain words to a script that asked).
function said(req, why, status) {
  const text = String(why).replace(/[<&>]/g, '')
  if (req.mode === 'navigate') return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;color:#666"><p>${text}</p></body>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; ${FRAMES}` } })
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
