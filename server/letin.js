// Which Devices May Connect (Settings › Remote Access, remote.js) for everything a device does on
// this computer, not only its screen: one check, before every route and every WebSocket (index.js),
// so one added later is covered too. A device is a phone paired with this computer or another of
// your computers linked to it: relay.js runs its requests and WebSockets here saying which one
// (x-bridge-relay: a device's own is dropped on the way, and anything else sending it needs the
// key), and so does inbox.js for what a phone left while this computer was away. A phone paired
// with another of your computers comes through that one (machines.js), as it: that computer checks
// its own list first, for its own devices, and then this one checks it. What doesn't say which
// device isn't one in the list: this computer itself (its windows, a browser on it, the CLI, a
// window showing another computer at that one's port), and a browser let in through Tailscale (Use
// on your phone, which has its own way in and its own off).
//
// One not let in here (admits, remote.js) gets nothing: the same answer to everything, which says
// which computer and where it's let in, and nothing more; a WebSocket opens only to say it and
// close. What it may still do: load the app's own page and files (the same for everyone with this
// version, so it can show that answer), be told (GET /api/relay, with its own id, which the phone's
// page needs to forget this computer), and unpair itself. What it has open here when it's unticked
// ends then (index.js). A screen it asks for is turned away by the screen itself (remote.js view
// here, machines.js on its way through to another computer), which checks the same list and says so
// in the viewer, keeping the try in Screen Activity.
import { WebSocketServer } from 'ws'
import { builtFile } from './apiauth.js'
import { plainName } from '../shared/remote.js'

// The answer's code, which the app shows as its card (src/components/remote/NotLetIn.jsx).
const CODE = 'notLetIn'
const SCREEN = /^(?:\/m\/[A-Za-z0-9_-]{1,20})?\/api\/remote\/view(?:\?|$)/

// admits(id): whether that device may use this computer (remote.js), and turnedAway(id): it asked
// while it may not. deviceOf(id): the device paired here (relay.js). thisName(): this computer's
// name. ui(): the built app's folder.
export function makeLetIn({ admits, turnedAway = () => {}, deviceOf, thisName, ui }) {
  const idOf = (req) => { const v = req.headers['x-bridge-relay']; return typeof v === 'string' && v ? v : null }
  const out = (req) => {
    const id = idOf(req)
    if (!id || admits(id)) return false
    turnedAway(id)
    return true
  }
  // What it's told. through: the computer it came through, when that's the one not let in here
  // (machines.js says a request is for one of its devices: x-bridge-for).
  function said(req) {
    const d = deviceOf(idOf(req))
    const computer = thisName()
    const through = d?.kind === 'computer' && req.headers['x-bridge-for'] === '1' ? plainName(d.name) || 'Another computer' : null
    const where = `On ${computer}: Settings › Remote Access › Which Devices May Connect.`
    return { error: through ? `${computer} hasn't let ${through} in, which this device comes through. ${where}` : `${computer} hasn't let this device in. ${where}`, code: CODE, computer, ...(through ? { through } : {}) }
  }
  const page = (req) => (req.method === 'GET' || req.method === 'HEAD') && (req.path === '/' || req.path === '/index.html' || req.path === '/api/health' || builtFile(ui(), req.path))
  const unpairs = (req, id) => {
    const m = req.method === 'DELETE' && /^\/api\/relay\/devices\/([^/]+)$/.exec(req.path)
    try { return !!m && decodeURIComponent(m[1]) === id } catch { return false }
  }

  // Requests: after the key is checked (apiauth.js), before anything else.
  const http = (req, res, next) => {
    if (!out(req)) return next()
    const id = idOf(req)
    if (page(req) || unpairs(req, id)) return next()
    res.set('Cache-Control', 'no-store')
    res.status(403).json({ ...said(req), ...(req.method === 'GET' && req.path === '/api/relay' ? { here: id } : {}) })
  }

  // WebSockets: true when it's turned away here (and answered). Said the way a terminal reads an
  // error ({"type":"error"}) and the way a screen does ({"t":"error"}), then closed.
  const wss = new WebSocketServer({ noServer: true })
  function upgrade(req, socket, head) {
    if (!out(req) || SCREEN.test(req.url)) return false
    const s = said(req)
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {})
      ws.send(JSON.stringify({ type: 'error', message: s.error, t: 'error', why: s.error, code: s.code, computer: s.computer, ...(s.through ? { through: s.through } : {}) }))
      setTimeout(() => { try { ws.close(1008, CODE) } catch { /* closed */ } }, 50)
    })
    return true
  }
  return { http, upgrade }
}
