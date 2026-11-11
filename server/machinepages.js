// Another of your computers' pages, shown on this computer (machines.js, /m/<id>/...), each at an
// address of its own: a port on 127.0.0.1 for each linked computer, picked once and kept with it
// (machines.json), so what its page saves in the browser stays its own across restarts. To a
// browser (Chromium, Safari, the desktop app) another port is another site, with no name to look up.
// Before anything else reads a request:
//   - one of its pages asked for at this computer's own address (a tab, a window switched to it, a
//     link) is sent to its port, so it never runs as this computer's page does. Through a phone,
//     Tailscale or another name for this computer, or a server not listening on this computer alone
//     (Docker), it stays at /m/<id>/ beside this computer's page, as those can't reach its port.
//   - At its port, its own pages, API and terminals go through to it as before. Of this computer,
//     only what its page shows of it (HOST): your devices, Home, Needs you, the agent map and copies
//     with that computer. Never this computer's agents, terminals, files or settings, nor another
//     computer through this one: refused, saying where to do it. A page of this computer's (or of
//     another computer's) asked for there is sent to its own address.
import http from 'node:http'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const MPATH = /^\/m\/([A-Za-z0-9_-]{1,20})(?:\/|$)/
const HOST = [
  ['GET', /^\/api\/machines(\/summary)?$/],
  ['GET', /^\/api\/(home|needs-you|agent-map|transfers)$/],
  ['POST', /^\/api\/home-(pins|layout)$/],
  // Copies with that computer: its files copied here (index.js checks the copy is from it), and
  // those under way stopped, tried again or cleared from the list.
  ['GET', /^\/api\/transfers\/plan$/, (req, id) => req.query.from === id && !req.query.to],
  ['POST', /^\/api\/transfers(\/clear|\/[\w-]{1,80}\/(stop|retry))?$/],
]
// What a window showing another computer can't do here, said where it's tried.
export const elsewhere = (name) => `Switch this window to ${name} to do this: a window showing another computer can't act on ${name}.`

// port, host: where this computer's page is served. thisName(): this computer's name. linked(): your
// computers linked to this one; nameOf(id): one's name. portOf(id), keepPort(id, port): its port, kept.
export function make({ port: mainPort, host, thisName, linked, nameOf, portOf, keepPort }) {
  const own = LOOPBACK.has(String(host))
  const servers = new Map() // id -> { port, server }
  let app = null
  let onUpgrade = null
  const idAt = (p) => { for (const [id, s] of servers) if (s.port === p) return id; return null }
  // The computer whose port a request came in on; null: this computer's own; '': a port no
  // computer has any more (a connection left open after it was unlinked), which gets nothing.
  const at = (req) => (req.socket?.localPort === mainPort ? null : idAt(req.socket?.localPort) || '')
  const hostname = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '')
  // A browser on this computer at this computer's own address: it can reach the computers' ports.
  const splits = (req) => own && !req.headers['x-bridge-relay'] && LOOPBACK.has(hostname(req)) && req.socket?.localPort === mainPort
  // A page to show (in a window or a frame), not something a page fetches. A service worker passing
  // one on (the app's own, public/sw.js) sends it as navigate with no destination; a browser that
  // says neither, as one asking for HTML.
  const h = (req, k) => String(req.headers[`sec-fetch-${k}`] || '')
  const page = (req) => req.method === 'GET' && (h(req, 'mode') === 'navigate' || /^(document|iframe|frame|embed|object)$/.test(h(req, 'dest')) || (!h(req, 'mode') && /text\/html/.test(req.headers.accept || '')))

  // ---------- Each linked computer's port ----------
  const listen = (p) => new Promise((resolve, reject) => {
    const s = http.createServer(app)
    s.on('upgrade', onUpgrade)
    s.once('error', reject)
    s.listen(p, host, () => { s.off('error', reject); resolve(s) })
  })
  // Its port, opened when it isn't yet: the one it had, else another (that one taken meanwhile).
  const opening = new Map()
  function ensure(id) {
    if (servers.has(id)) return Promise.resolve(servers.get(id))
    if (!opening.has(id)) {
      opening.set(id, (async () => {
        const was = portOf(id)
        let s = was ? await listen(was).catch(() => null) : null
        if (!s) s = await listen(0)
        const got = { port: s.address().port, server: s }
        servers.set(id, got)
        if (got.port !== was) keepPort(id, got.port)
        return got
      })().finally(() => opening.delete(id)))
    }
    return opening.get(id)
  }
  // Each linked computer has its port open, and one unlinked has it closed.
  async function sync() {
    if (!own || !app) return
    const ids = new Set(linked().map((m) => m.id))
    for (const [id, s] of servers) if (!ids.has(id)) { servers.delete(id); s.server.close(); s.server.closeAllConnections?.() }
    for (const id of ids) await ensure(id).catch(() => {})
  }
  function start(a, upgrade) {
    app = a
    onUpgrade = upgrade
    sync()
    setInterval(() => { sync().catch(() => {}) }, 5000).unref()
  }

  const http_ = async (req, res, next) => {
    const id = at(req)
    const m = MPATH.exec(req.path)
    const to = (p) => `http://${hostname(req) || '127.0.0.1'}:${p}${req.originalUrl}`
    if (id === '') return res.status(404).json({ error: 'Not found' })
    if (id === null) {
      if (!m || !page(req) || !splits(req) || !linked().some((x) => x.id === m[1])) return next()
      try { return res.redirect(302, to((await ensure(m[1])).port)) } catch { return next() }
    }
    if (m?.[1] === id) return next()
    if (page(req)) {
      if (!m) return res.redirect(302, to(mainPort))
      if (linked().some((x) => x.id === m[1])) { try { return res.redirect(302, to((await ensure(m[1])).port)) } catch { /* below */ } }
    }
    if (!m && req.path.startsWith('/api/') && HOST.some(([verb, path, also]) => req.method === verb && path.test(req.path) && (!also || also(req, id)))) {
      req.machinePage = id
      return next()
    }
    if (!m && !req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' })
    res.status(403).json({ error: elsewhere(m ? nameOf(m[1]) || 'that computer' : thisName()), code: 'machinePage' })
  }
  // A WebSocket (a live terminal) at such a port: only that computer's own.
  const upgrade = (req) => {
    const id = at(req)
    if (id === null) return true
    if (!id) return false
    try { return MPATH.exec(new URL(req.url, 'http://x').pathname)?.[1] === id } catch { return false }
  }
  // What may put that computer's page in a frame: this computer's own page (its tabs), and itself.
  const frames = () => `frame-ancestors 'self' http://127.0.0.1:${mainPort} http://localhost:${mainPort}`
  // For /api/machines: where each computer's pages are for the page asking (null: beside it, at
  // /m/<id>/), and whether it's one of theirs at its port. A linked computer's port is opened first
  // when it isn't yet (just linked, or this computer just started): told null, the page took that
  // computer's page in its tab for one beside it, and heard nothing it said for a while, though
  // asking for that page sends it to the port all the same.
  const portFor = async (req, id) => {
    if (!splits(req) && !at(req)) return null
    if (!servers.has(id) && app && linked().some((x) => x.id === id)) await ensure(id).catch(() => {})
    return servers.get(id)?.port || null
  }
  return { http: http_, upgrade, frames, start, sync, portFor, at }
}
