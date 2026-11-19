// What a Share Link shows, at an address of its own (relay/worker.js: <link>.<SHARE_DOMAIN> on Bridge
// AI's relay), apart from the page the link opened (share.js), which holds the link's secret and its
// encrypted connection and never gives either to this one. Only that page can frame this one (the
// relay says so: frame-ancestors), and it hands this one a MessageChannel port and nothing else.
//
// This page registers the service worker here (share-sw.js) and shows what's shared in a frame of
// its own. Each request from it reaches the service worker, which asks this page; this page passes
// the request on through the port, with the worker's own port for the answer, and the page that
// opened the link sends it over the encrypted link and streams the answer straight back to the
// worker. k: this page's own, from the link's page, so only requests meant for it are taken.
//
// What's shown is at this same address, so it could reach into this page: everything this page uses
// once it shows anything is taken here first (the builtins as they are now), its own state is in this
// module (out of reach), and what it passes on is only ever a request under its own key.
const apply = Reflect.apply
const post = MessagePort.prototype.postMessage
const dataOf = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get
const portsOf = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'ports').get
const srcOf = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src').set
const send = (p, msg, transfer) => apply(post, p, transfer ? [msg, transfer] : [msg])
const KEY = /^[\w-]{16,64}$/
const k = new URLSearchParams(location.search).get('k') || ''
const prefix = `/_c/${k}/`
let port = null
let parentOrigin = null
let entry = ''
let frame = null
const say = (text) => { document.body.replaceChildren(Object.assign(document.createElement('p'), { textContent: text })) }

const worker = (async () => {
  if (!('serviceWorker' in navigator)) throw new Error('none')
  await navigator.serviceWorker.register('/share-sw.js', { scope: '/' })
  return navigator.serviceWorker.ready
})()

function show(v) {
  if (!frame) {
    frame = document.createElement('iframe')
    frame.title = 'Shared with you'
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.allow = 'fullscreen; clipboard-write'
    document.body.replaceChildren(frame)
  }
  apply(srcOf, frame, [`${prefix}${entry}${v ? `?v=${v}` : ''}`])
}

// A request's path, only under this page's own key, with nothing in it that leads anywhere else.
const under = (u) => {
  const s = String(u)
  const p = s.split(/[?#]/)[0]
  return s.startsWith(prefix) && !/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(p.slice(prefix.length - 1))
}

addEventListener('message', async (e) => {
  // Only from the page around this one (the relay lets no other frame it), and only once.
  const d = apply(dataOf, e, [])
  const ports = apply(portsOf, e, [])
  if (port || e.source !== parent || d?.t !== 'port' || d.k !== k || !KEY.test(k) || !ports[0]) return
  port = ports[0]
  parentOrigin = e.origin
  entry = String(d.entry || '').replace(/^\/+/, '')
  port.onmessage = (m) => { const x = apply(dataOf, m, []); if (x?.t === 'show') show(Number(x.v) || 0) }
  try { await worker } catch {
    send(port, { t: 'nosw' })
    return say('This browser can\'t show it here: it needs what private windows turn off. Open the link in a normal window, or in another browser.')
  }
  show(0)
})

// The service worker's requests, on to the link's page with the worker's port for the answer.
navigator.serviceWorker?.addEventListener('message', (e) => {
  const d = apply(dataOf, e, [])
  const back = apply(portsOf, e, [])[0]
  if (!back) return
  // The service worker asking which page has a key, and which page frames it.
  if (d?.t === 'who') return send(back, port && d.k === k ? { k, parent: parentOrigin } : { k: null })
  if (d?.type !== 'fetch') return
  if (!port) return send(back, { error: 'Not ready yet. Try again in a moment.' })
  if (!under(d.u)) return send(back, { error: 'Not part of what was shared' })
  const body = d.body instanceof ArrayBuffer ? d.body : null
  send(port, { type: 'fetch', m: String(d.m || 'GET'), u: String(d.u), h: Array.isArray(d.h) ? d.h : [], body }, body ? [back, body] : [back])
})
navigator.serviceWorker?.startMessages?.()
