// Another of your computers' pages, shown on this computer (machines.js, /m/<id>/...), each at an
// address of its own (shared/machinehost.js). Before anything else reads a request:
//   - one of its pages asked for at this computer's own address (a tab, a window switched to it, a
//     link) is sent to its own, so it never runs as this computer's page does. Through a phone,
//     Tailscale or another name for this computer it stays at /m/<id>/, as those have no such
//     addresses.
//   - At its address, its own pages, API and terminals go through to it as before. Of this computer,
//     only what its page shows of it (HOST): your devices, Home, Needs you, the agent map and copies
//     with that computer. Never this computer's agents, terminals, files or settings, nor another
//     computer through this one: refused, saying where to do it. A page of this computer's (or of
//     another computer's) asked for there is sent to its own address.
import { LOOPBACK, machineOfHost, machineOrigin, hostOrigin } from '../shared/machinehost.js'

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

// thisName(): this computer's name; nameOf(id): one of yours, by its id here.
export function make({ thisName, nameOf }) {
  const port = (req) => /:(\d+)$/.exec(req.headers.host || '')?.[1] || ''
  const hostname = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '')
  // A page to show (in a window or a frame), not something a page fetches. A service worker passing
  // one on (the app's own, public/sw.js) sends it as navigate with no destination; a browser that
  // says neither, as one asking for HTML.
  const h = (req, k) => String(req.headers[`sec-fetch-${k}`] || '')
  const page = (req) => req.method === 'GET' && (h(req, 'mode') === 'navigate' || /^(document|iframe|frame|embed|object)$/.test(h(req, 'dest')) || (!h(req, 'mode') && /text\/html/.test(req.headers.accept || '')))
  const http = (req, res, next) => {
    const at = machineOfHost(req.headers.host)
    const m = MPATH.exec(req.path)
    if (!at) {
      if (m && page(req) && !req.headers['x-bridge-relay'] && LOOPBACK.has(hostname(req))) return res.redirect(302, `${machineOrigin(m[1], port(req))}${req.originalUrl}`)
      return next()
    }
    if (m?.[1] === at) return next()
    if (page(req)) return res.redirect(302, `${m ? machineOrigin(m[1], port(req)) : hostOrigin(port(req))}${req.originalUrl}`)
    if (!m && req.path.startsWith('/api/') && HOST.some(([verb, path, also]) => req.method === verb && path.test(req.path) && (!also || also(req, at)))) {
      req.machinePage = at
      return next()
    }
    if (!m && !req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' })
    res.status(403).json({ error: elsewhere(m ? nameOf(m[1]) || 'that computer' : thisName()), code: 'machinePage' })
  }
  // A WebSocket (a live terminal) at such an address: only that computer's own.
  const upgrade = (req) => {
    const at = machineOfHost(req.headers.host)
    if (!at) return true
    try { return MPATH.exec(new URL(req.url, 'http://x').pathname)?.[1] === at } catch { return false }
  }
  // What may put that computer's page in a frame: this computer's own page (its tabs), and itself.
  const frames = (req) => `frame-ancestors 'self' ${['127.0.0.1', 'localhost'].map((h) => `http://${h}${port(req) ? `:${port(req)}` : ''}`).join(' ')}`
  return { http, upgrade, frames }
}
