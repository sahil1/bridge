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
const k = new URLSearchParams(location.search).get('k') || ''
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
  frame.src = `/_c/${k}/${entry}${v ? `?v=${v}` : ''}`
}

addEventListener('message', async (e) => {
  // Only from the page around this one (the relay lets no other frame it), and only once.
  if (port || e.source !== parent || e.data?.t !== 'port' || e.data.k !== k || !/^[\w-]{16,64}$/.test(k) || !e.ports[0]) return
  port = e.ports[0]
  parentOrigin = e.origin
  entry = String(e.data.entry || '').replace(/^\/+/, '')
  port.onmessage = (m) => { if (m.data?.t === 'show') show(Number(m.data.v) || 0) }
  try { await worker } catch {
    port.postMessage({ t: 'nosw' })
    return say('This browser can\'t show it here: it needs what private windows turn off. Open the link in a normal window, or in another browser.')
  }
  show(0)
})

// The service worker's requests, on to the link's page with the worker's port for the answer.
navigator.serviceWorker?.addEventListener('message', (e) => {
  // The service worker asking which page has a key, and which page frames it.
  if (e.data?.t === 'who' && e.ports[0]) return e.ports[0].postMessage(port && e.data.k === k ? { k, parent: parentOrigin } : { k: null })
  if (e.data?.type !== 'fetch' || !e.ports[0]) return
  if (!port) return e.ports[0].postMessage({ error: 'Not ready yet. Try again in a moment.' })
  const { m, u, h, body } = e.data
  port.postMessage({ type: 'fetch', m, u, h, body }, body ? [e.ports[0], body] : [e.ports[0]])
})
navigator.serviceWorker?.startMessages?.()
