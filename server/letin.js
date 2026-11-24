// Which Devices May Connect (Settings › Remote Access, remote.js) for everything a device does on
// this computer, not only its screen: one check, before every route and every WebSocket (index.js),
// so one added later is covered too. A device is a phone paired with this computer or another of
// your computers linked to it: relay.js runs its requests and WebSockets here saying which one
// (x-bridge-relay: a device's own is dropped on the way, and anything else sending it needs the
// key), and so does inbox.js for what a phone left while this computer was away. A device paired
// with another of your computers comes through that one (machines.js), which checks its own list
// first and says which of its devices it's for (x-bridge-for-*, taken only from a computer); this
// one then checks that computer, and that device as it comes through it (remote.js shutFor). What
// doesn't say which device isn't one in the list: this computer itself (its windows, a browser on
// it, the CLI, a window showing another computer at that one's port), and a browser let in through
// Tailscale (Use on your phone, which has its own way in and its own off).
//
// One not let in here gets nothing: the same answer to everything, which says which computer and
// where it's let in, and nothing more; a WebSocket opens only to say it and close. What it may still
// do: load the app's own page and files (the same for everyone with this version, so it can show
// that answer: only names a built file has, nothing encoded), be told (GET /api/relay, with its own
// id, which the phone's page needs to forget this computer), and unpair itself. What it has open
// here when it's unticked ends then (index.js). A screen it asks for is turned away by the screen
// itself (remote.js view here, machines.js on its way through to another computer), which checks
// the same list and says so in the viewer, keeping the try in Screen Activity.
import { WebSocketServer } from 'ws'
import { builtFile } from './apiauth.js'
import { plainName } from '../shared/remote.js'
import { placeEn } from '../shared/places.js'

// The answer's code, which the app shows as its card (src/components/remote/NotLetIn.jsx).
const CODE = 'notLetIn'
const SCREEN = /^(?:\/m\/[A-Za-z0-9_-]{1,20})?\/api\/remote\/view(?:\?|$)/
// A file of the built app, as it's asked for: a plain name at the top, or one in assets/.
const STATIC = /^\/(assets\/[\w-][\w.-]*|[\w-][\w.-]*)$/

// shutFor(id, via): null when that device may use this computer, else who isn't let in ('device',
// 'computer': the one it came through, or 'update': that one is too old to say which of its devices
// it's for); via: which device of that computer's it's for (remote.js). turnedAway(id): it asked
// while it may not. deviceOf(id): the device paired here (relay.js). versionOf(id): the Bridge AI a
// computer paired here has, as it last said. thisName(): this computer's name. ui(): the built
// app's folder.
export function makeLetIn({ shutFor, turnedAway = () => {}, deviceOf, versionOf = () => null, thisName, ui }) {
  const idOf = (req) => { const v = req.headers['x-bridge-relay']; return typeof v === 'string' && v ? v : null }
  // Which device of another computer's it's for, as that computer says (none from anything else).
  // Said to be for one of its devices without which (x-bridge-for alone): { unknown }.
  const viaOf = (req, d) => {
    const id = req.headers['x-bridge-for-id']
    if (d?.kind !== 'computer') return null
    if (typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id)) return req.headers['x-bridge-for'] != null ? { unknown: true } : null
    let name = ''
    try { name = decodeURIComponent(String(req.headers['x-bridge-for-name'] || '')) } catch { /* as it came */ }
    const key = req.headers['x-bridge-for-key']
    return { id, name, kind: req.headers['x-bridge-for-kind'] === 'computer' ? 'computer' : 'phone', key: typeof key === 'string' && key.length <= 200 ? key : null }
  }
  // Another of your computers turned away here: said in the log too, once an hour for each (and what),
  // so a computer that can't use this one says why here as well as there.
  // no: shutFor's answer; via: the device of its it asked for, if any.
  const noted = new Map() // computer and what -> when it was said
  function note(d, no, via) {
    if (d?.kind !== 'computer') return
    const what = no === 'update' ? 'update' : no === 'computer' || !via ? 'itself' : 'through'
    const now = Date.now()
    for (const [k, at] of noted) if (at < now - 3600000) noted.delete(k)
    const k = `${d.id}:${what}`
    if (noted.has(k)) return
    noted.set(k, now)
    const name = plainName(d.name) || 'Another computer'
    console.log(`Which Devices May Connect: ${name} (a linked computer) was turned away here: ${what === 'itself' ? `it isn't let in (${placeEn('remote-devices')})` : what === 'update' ? 'it runs an older Bridge AI, which can\'t say which of its devices it asks for' : `${plainName(via?.name) || 'a device'}, which comes through it, isn't let in`}`)
  }
  // null, or who isn't let in.
  function out(req) {
    const id = idOf(req)
    if (!id) return null
    const d = deviceOf(id)
    const via = viaOf(req, d)
    const no = shutFor(id, via)
    if (no) { turnedAway(id); note(d, no, via) }
    return no ? { no, hop: d } : null
  }
  // What it's told: through, the computer it came through when that's the one not let in here, or
  // too old to say which of its devices it is (update: its version, as this computer last heard it).
  function said(o) {
    const computer = thisName()
    const through = o.no === 'computer' || o.no === 'update' ? plainName(o.hop?.name) || 'Another computer' : null
    if (o.no === 'update') {
      const v = versionOf(o.hop?.id) || ''
      return { error: `Update Bridge AI on ${through} to use ${computer} from its devices.${v ? ` It has ${v}.` : ''}`, code: CODE, computer, through, update: v }
    }
    const where = `On ${computer}: ${placeEn('remote-devices')}.`
    return { error: through ? `${computer} hasn't let ${through} in, which this device comes through. ${where}` : `${computer} hasn't let this device in. ${where}`, code: CODE, computer, ...(through ? { through } : {}) }
  }
  const page = (req) => (req.method === 'GET' || req.method === 'HEAD') && (req.path === '/' || req.path === '/api/health' || (STATIC.test(req.path) && builtFile(ui(), req.path)))
  const unpairs = (req, id) => {
    const m = req.method === 'DELETE' && /^\/api\/relay\/devices\/([\w-]{1,40})$/.exec(req.path)
    return !!m && m[1] === id
  }

  // Requests: after the key is checked (apiauth.js), before anything else.
  const http = (req, res, next) => {
    const o = out(req)
    if (!o) return next()
    const id = idOf(req)
    if (page(req) || unpairs(req, id)) return next()
    res.set('Cache-Control', 'no-store')
    res.status(403).json({ ...said(o), ...(req.method === 'GET' && req.path === '/api/relay' ? { here: id } : {}) })
  }

  // WebSockets: true when it's turned away here (and answered). Said the way a terminal reads an
  // error ({"type":"error"}) and the way a screen does ({"t":"error"}), then closed.
  const wss = new WebSocketServer({ noServer: true })
  function upgrade(req, socket, head) {
    const o = out(req)
    if (!o || SCREEN.test(req.url)) return false
    const s = said(o)
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {})
      ws.send(JSON.stringify({ type: 'error', message: s.error, t: 'error', why: s.error, code: s.code, computer: s.computer, ...(s.through ? { through: s.through } : {}) }))
      setTimeout(() => { try { ws.close(1008, CODE) } catch { /* closed */ } }, 50)
    })
    return true
  }
  return { http, upgrade }
}
