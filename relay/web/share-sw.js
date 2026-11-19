// The service worker of a Share Link's pages. What's shared shows in a frame at /_c/<k>/…, k a key
// the page showing it made for itself, and every request from that frame (a site's pages, pictures
// and scripts, an app's calls) is handed to that page alone, which sends it over the link's
// encrypted connection and streams the answer back here. Nothing of it goes to the relay.
//
// Two ways, by address (relay/worker.js):
//   - at the link's own content address (Bridge AI's relay, with its share domain): the page is
//     share-frame.js, which passes each request to the page that opened the link (share.js, at
//     another address, which alone holds the link's secret). What's shared may run its scripts here.
//   - at the address the link opened (a relay of your own; Bridge AI's relay without a share domain):
//     the page is share.js itself, and what's shared runs no scripts at all (script-src 'none').
// A request is taken only from a frame of that page (its key in the frame's address), or for a page
// that frame goes to under the same key: never from another link's page, nor from anywhere else.
const OWN = new Set(['/share.js', '/share-sw.js', '/share-frame.js', '/link.js', '/mark.svg'])
const CONTENT = /^\/_c\/([\w-]{16,64})(\/.*)$/
const HOSTS = /^\/(_relay\/frame|v\/[\w-]{22})$/
const FRAMES = "frame-ancestors 'self'"
const SANDBOX = 'sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
// What's shown loads only from its own address (and data: and blob: it makes): its scripts there (at a
// content address of its own), nothing at all anywhere else. Nothing from another site, so nothing it
// asks for says it was opened, or what it holds.
const WITH_SCRIPTS = "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; object-src 'none'; form-action 'self'; base-uri 'self'"
const NO_SCRIPTS = "default-src 'self' data: blob:; style-src 'self' data: blob: 'unsafe-inline'; script-src 'none'; object-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (url.origin !== location.origin || url.pathname.startsWith('/_relay/')) return
  e.respondWith(route(e, url))
})

async function route(e, url) {
  const req = e.request
  const nav = req.mode === 'navigate'
  const m = CONTENT.exec(url.pathname)
  // A page of what's shared opens only in its frame (a window of its own, or another site's link to
  // one, gets nothing).
  if (m && nav && req.destination !== 'iframe') return said(req, 'This shows only inside the page its link opens. Open the link again.', 403)
  // Anything else under a key is taken only from what that key's frame shows.
  if (m && !nav) {
    const c = e.clientId ? await self.clients.get(e.clientId) : null
    const from = c && CONTENT.exec(new URL(c.url).pathname)
    if (!from || from[1] !== m[1]) return said(req, 'This isn\'t part of what was shared.', 404)
  }
  if (m) return tunnel(req, m[1], `${url.pathname}${url.search}`)
  // A link inside what's shared to its own absolute path, at a content address of its own (where
  // every key is this one link's): under the key of the page it came from.
  if (nav && req.destination === 'iframe') {
    let from = null
    try { from = CONTENT.exec(new URL(req.referrer).pathname) } catch { /* none said */ }
    const h = from && await hostOf(from[1])
    if (h && own(h.c)) return Response.redirect(`/_c/${from[1]}${url.pathname}${url.search}`, 302)
  }
  // From what's shared (a frame under /_c/<k>/): its own absolute path, under its own key.
  if (!nav && e.clientId) {
    const c = await self.clients.get(e.clientId)
    const from = c && CONTENT.exec(new URL(c.url).pathname)
    if (from) return tunnel(req, from[1], `/_c/${from[1]}${url.pathname}${url.search}`)
  }
  // The pages' own files, and the pages themselves.
  if (OWN.has(url.pathname) || url.pathname === '/' || HOSTS.test(url.pathname)) return fetch(req)
  return said(req, 'This isn\'t part of what was shared.', 404)
}

// The page that made key k, { c, parent }: one of this address's own pages, asked (a browser may not
// tell a service worker that the page a link opens took the link out of its address), remembered
// while this worker runs. parent: at a content address of its own, the page of the link's that
// frames it (share-frame.js has it from that page's message), which alone may frame what it shows.
const KEY = /^[\w-]{16,64}$/
const hosts = new Map()
self.addEventListener('message', (e) => {
  const c = e.source
  if (e.data?.t === 'host' && KEY.test(String(e.data.k)) && c?.type === 'window' && /^\/v\//.test(new URL(c.url).pathname)) hosts.set(e.data.k, { id: c.id, parent: null })
})
const label = (host) => host.split('.')[0]
const parentOk = (p) => { try { const u = new URL(p); return /^https?:$/.test(u.protocol) && u.origin === p && label(u.hostname) === label(location.hostname) } catch { return false } }
async function hostOf(k) {
  const known = hosts.get(k)
  if (known) { const c = await self.clients.get(known.id); if (c) return { c, parent: known.parent }; hosts.delete(k) }
  const all = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter((c) => HOSTS.test(new URL(c.url).pathname))
  const asked = await Promise.all(all.map((c) => new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel()
    const t = setTimeout(() => resolve(null), 2000)
    port1.onmessage = (m) => {
      clearTimeout(t)
      if (m.data?.k !== k) return resolve(null)
      const frame = own(c)
      if (frame && !parentOk(m.data.parent)) return resolve(null)
      resolve({ c, parent: frame ? m.data.parent : null })
    }
    c.postMessage({ t: 'who', k }, [port2])
  })))
  const h = asked.find(Boolean) || null
  if (h) hosts.set(k, { id: h.c.id, parent: h.parent })
  return h
}

// Whether what's shared may run its scripts: only at a content address of its own (share-frame.js).
const own = (c) => new URL(c.url).pathname === '/_relay/frame'

function headersOf(head, scripts, parent) {
  const h = new Headers()
  for (const [k, v] of head.h || []) { try { h.append(k, v) } catch { /* not a header a page may set */ } }
  h.delete('set-cookie')
  h.delete('clear-site-data')
  h.delete('service-worker-allowed')
  if (!/^application\/pdf\b/i.test(h.get('content-type') || '')) {
    h.append('Content-Security-Policy', SANDBOX)
    h.append('Content-Security-Policy', scripts ? WITH_SCRIPTS : NO_SCRIPTS)
  }
  // Framed only by its own page here, and (at a content address of its own) the link's page around that.
  h.append('Content-Security-Policy', scripts ? `${FRAMES} ${parent}` : FRAMES)
  h.set('X-Content-Type-Options', 'nosniff')
  return h
}

const NO_BODY = new Set([101, 103, 204, 205, 304])
async function tunnel(req, k, u) {
  const found = await hostOf(k)
  if (!found) return said(req, 'Open the link again: the page that shows this was closed.', 503)
  const host = found.c
  const scripts = own(host)
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
        resolve(new Response(NO_BODY.has(m.head.s) || req.method === 'HEAD' ? null : stream, { status: m.head.s, headers: headersOf(m.head, scripts, found.parent) }))
      } else if (m.chunk) { queue.push(new Uint8Array(m.chunk)); poke() }
      else if (m.end) { ended = true; poke() }
      else if (m.error) {
        if (!answered) resolve(said(req, m.error, 503))
        else { failed = new Error(m.error); poke() }
        port1.close()
      }
    }
    host.postMessage({ type: 'fetch', m: req.method, u, h: [...req.headers], body }, body ? [port2, body] : [port2])
  })
}

// Why something didn't open, as a page in the frame (or plain words to a script that asked).
function said(req, why, status) {
  const text = String(why).replace(/[<&>]/g, '')
  if (req.mode === 'navigate') return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;color:#666"><p>${text}</p></body>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } })
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
