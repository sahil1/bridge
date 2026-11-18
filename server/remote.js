// Remote Screen and Preview (a Beta Feature, src/trials.js): this computer's screen, and the apps
// its agents serve, seen from your other devices, and controlled from them once you allow it here.
//
// Who: only your own devices, paired with this computer (relay.js): each session comes over the
// device's encrypted link (a WebSocket through relay.js, or through another of your computers that
// is linked to this one, machines.js), and the relay sees only sealed messages. Never from this
// computer's own page (there's nothing to see from here), never from a web page.
//
// Guardrails, each set here at this computer only (index.js remoteHere), never from a device:
//   Remote Access Password  asked of every session (a screen, an app as pictures, or a preview of an
//                           app at an address of its own) before anything is taken, and checked here,
//                           one at a time; kept only as a salted scrypt hash in remote.json, never sent
//                           or logged. 5 wrong tries lock that device out for 15 minutes (recorded),
//                           each counted before it's checked. Changed or taken off: sessions end.
//   control                 off until you turn on "Let my other devices control this computer", which
//                           needs the password set, and on a Mac asks for Accessibility then; a
//                           session's control goes back to view-only after 10 minutes without input,
//                           and while someone here moves the mouse or presses a key, remote input
//                           waits a moment (remoteinput.js).
//   Ask Here First          (off by default) Allow or Deny here for each session; no answer in 30
//                           seconds is a no. Allowed to view, control is asked for again; taken back
//                           after it went idle, the password and Allow again.
//   which devices           every paired phone and linked computer may, until it's unticked here;
//                           once any guardrail is set, one paired after that starts unticked. Through
//                           another of your computers, that computer checks its own list first.
// What a device is told (status): its own standing and the screens it may pick, never who else
// looked or what at; only this computer itself sees that.
// Viewing needs nobody at this computer otherwise (it's yours): it shows that it's being viewed (the
// desktop app's badge, on top of everything, with Stop; and a line in Bridge AI itself), and
// afterwards says who looked, when and for how long, until you've seen it. Every session (who, from
// which device, what, when, how long, whether it controlled anything, and how it came), and every
// one turned away (a lockout, a no here, a device not allowed), is kept in ~/.bridge-ai/remote.json,
// the last 200 sessions and apart from them the last 100 turned away (the same again counted on one),
// and shown in Settings.
// Your other devices are told too (on unless it's turned off here): a session starting, control
// taken and an ask waiting each go to your phones as a notification, and to your other computers,
// which pass it on to theirs and show it in every window they have open (screentell.js), with Stop
// and Block This Device. Either is carried out here (endFrom), and only narrows who may connect: a
// device is let back in only at the computer it was unticked on. Each notification, and where it
// went, is in the record. They say who, from which computer and for how long: never what's on the
// screen, nor the record.
//
// The picture: the desktop app's capture page (src/components/remote/Capture.jsx, in a window of
// its own that never shows) takes the screen and sends it peer-to-peer (WebRTC; the offer, answer
// and candidates go over the link, here), or, where the network won't allow that, as pictures over
// the link, a few a second at most (shared/remote.js RATE). A project's app (a preview on a phone)
// comes as pictures from a window of the desktop app's that's drawn off screen (desktop/remote.js).
// Tests stand in for both: BRIDGE_TEST_SCREEN=fake draws pictures here, and the capture page takes
// a canvas instead of a screen with ?fake=1.
import fs from 'node:fs'
import { totalmem } from 'node:os'
import path from 'node:path'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { dataFile, ensureDir, writeFileAtomic } from './paths.js'
import * as input from './remoteinput.js'
import { cleanInput, iceServers, RATE, MAX_FRAME, PAUSE_MS, ACCESS, packFrame, plainName } from '../shared/remote.js'

const FILE = dataFile('remote.json')
const LOG_MAX = 200
const REFUSED_MAX = 100
const REPEAT_MS = 10 * 60000 // turned away again within this, for the same reason: counted on the last
const REFUSALS = new Set(['locked', 'denied', 'unanswered', 'password', 'device', 'stopped', 'blocked'])
const FAKE = process.env.BRIDGE_TEST_SCREEN === 'fake'
const CAPTURE_WAIT_MS = Number(process.env.BRIDGE_REMOTE_CAPTURE_WAIT_MS) || 8000
const IDLE_MS = 5 * 60000 // the capture window, with nothing to capture, closes after this long
// The guardrails' times (shared/remote.js ACCESS), shorter in tests.
const LOCK_MS = Number(process.env.BRIDGE_REMOTE_LOCK_MS) || ACCESS.lockMinutes * 60000
const ASK_MS = Number(process.env.BRIDGE_REMOTE_ASK_MS) || ACCESS.askSeconds * 1000
const CONTROL_IDLE_MS = Number(process.env.BRIDGE_REMOTE_CONTROL_IDLE_MS) || ACCESS.idleMinutes * 60000
const PASSWORD_WAIT_MS = 2 * 60000 // a password not typed in this long: the session goes
const PENDING_MAX = 2 // sessions of one device waiting at the password or for Allow, at once
// Wrong passwords through another of your computers, for every device it speaks for together, before
// all of them are locked out through it (each device has its own ACCESS.tries too).
const HOP_TRIES = ACCESS.tries * 4
const clean = (s, n = 60) => plainName(s, n)

const read = () => {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    const ids = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string').slice(-500) : [])
    // (One from before kept those turned away in its log too.)
    const all = Array.isArray(d.log) ? d.log.filter((e) => e && typeof e === 'object') : []
    const turned = (e) => !e.source && REFUSALS.has(e.end)
    return {
      control: d.control === true,
      password: d.password && typeof d.password.hash === 'string' && typeof d.password.salt === 'string' ? d.password : null,
      askFirst: d.askFirst === true,
      blocked: ids(d.blocked),
      known: Array.isArray(d.known) ? ids(d.known) : null,
      fresh: ids(d.fresh),
      notify: d.notify !== false,
      locks: d.locks && typeof d.locks === 'object' && !Array.isArray(d.locks) ? d.locks : {},
      log: all.filter((e) => !turned(e)).slice(-LOG_MAX),
      refused: [...all.filter(turned), ...(Array.isArray(d.refused) ? d.refused : [])].slice(-REFUSED_MAX),
    }
  } catch { return { control: false, password: null, askFirst: false, blocked: [], known: null, fresh: [], notify: true, locks: {}, log: [], refused: [] } }
}

// ---------- the Remote Access Password ----------
// scrypt, salted, its settings kept beside the hash so an older one still checks after they change,
// and is made again with these once it's typed right. OWASP's: N=2^17, r=8, p=1 (128 MB while it
// checks); a computer with less memory, their equal in time at less of it (2^16 and p=2, 2^15 and p=3).
const GB = 2 ** 30
const SCRYPT = totalmem() >= 4 * GB ? { N: 2 ** 17, r: 8, p: 1 } : totalmem() >= 2 * GB ? { N: 2 ** 16, r: 8, p: 2 } : { N: 2 ** 15, r: 8, p: 3 }
const hashOf = (pw, salt, o = SCRYPT) => new Promise((resolve, reject) => scrypt(String(pw).normalize('NFC'), salt, 32, { N: o.N, r: o.r, p: o.p, maxmem: 256 * o.N * o.r + 2 ** 20 }, (e, k) => (e ? reject(e) : resolve(k))))
async function makePassword(pw) {
  const salt = randomBytes(16)
  return { kdf: 'scrypt', ...SCRYPT, salt: salt.toString('base64'), hash: (await hashOf(pw, salt)).toString('base64'), at: new Date().toISOString() }
}
// { ok, stale }: stale, made with settings older than these.
async function passwordMatches(stored, pw) {
  if (!stored || typeof pw !== 'string' || !pw || pw.length > 1024) return { ok: false }
  const want = Buffer.from(stored.hash, 'base64')
  const o = { N: stored.N || 16384, r: stored.r || SCRYPT.r, p: stored.p || SCRYPT.p }
  const got = await hashOf(pw, Buffer.from(stored.salt, 'base64'), o).catch(() => null)
  return { ok: !!got && got.length === want.length && timingSafeEqual(got, want), stale: o.N !== SCRYPT.N || o.r !== SCRYPT.r || o.p !== SCRYPT.p }
}

// trialOn(): the Beta Feature is on here. deviceOf(id): a device paired here (relay.js), or null.
// thisName(): this computer's name. os: 'mac' | 'windows' | 'linux'. hosted(): this computer's relay
// is Bridge AI's (each message counts against the account's allowance). isDevPort(port): one of
// this computer's dev servers (servers.js). screenAllowed(): on a Mac, whether macOS lets Bridge AI
// record the screen, looked at without asking (calls.js screen). devices(): the phones and computers
// paired here ({ id, name, kind }, relay.js). onChange(): what Bridge AI shows of this changed.
// onBlocked(id): a device unticked here, whose sessions through this computer to another end too.
// tell(event): your other devices told of a session, control taken or an ask (screentell.js), and
// what became of it ({ sent, computers }). notifyTo(): where that goes, for Settings. blockThere(hop,
// id): a device that came through another of your computers (hop, its device here) blocked there.
export function makeRemote({ trialOn, deviceOf, thisName, os, hosted = () => false, isDevPort = async () => false, screenAllowed = async () => null, devices = () => [], onChange = () => {}, onBlocked = () => {}, tell: tellDevices = async () => null, notifyTo = () => ({}), blockThere = async () => null }) {
  let conf = read()
  const save = () => { ensureDir(path.dirname(FILE)); writeFileAtomic(FILE, JSON.stringify(conf, null, 2), { mode: 0o600 }) }
  // Control turned on before it needed a password: off, so setting one later doesn't turn it back on.
  if (conf.control && !conf.password) { conf.control = false; save() }
  const sessions = new Map() // id -> session
  const desktops = new Set() // the desktop app's own feeds (index.js /api/events): fn(event)
  let capture = null // the capture page: { ws, sources, permission, p2p, at }
  let captureWaiters = []
  let idleTimer = null
  let sink = null // what presses keys here, while anything controls this computer
  let sinkError = null
  let pausedUntil = 0
  const asks = new Map() // Ask Here First, waiting on an answer here: id -> ask
  const pending = new Set() // sessions at the password, or waiting for Allow

  const desktopOpen = () => desktops.size > 0
  const toDesktop = (ev) => { for (const fn of desktops) { try { fn(ev) } catch { /* gone */ } } }
  const tell = (ws, msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)) }
  const rate = (s) => Math.min(s.slow || hosted() ? RATE.hosted : RATE.own, s.kind === 'page' ? RATE.own : 99)
  // Control is on only with a password set (an older remote.json may have it on without one).
  const controlOn = () => conf.control && !!conf.password
  // Whether a session may press anything now: a page always (it's that app, not this computer); a
  // screen once it was allowed control, while it shows a whole screen (where the pointer goes is known).
  const ctl = (s) => (s.kind === 'page' ? !s.grant : !!s.may && s.source?.kind === 'screen')
  const watchers = () => [...sessions.values()].filter((x) => x.kind === 'screen')
  // The desktop app's badge: who sees this screen, and who asks to (Ask Here First).
  const toBadge = () => toDesktop({ t: 'sessions', list: watchers().map(shown), asks: [...asks.values()].map(shownAsk) })

  // ---------- what can be seen and done here ----------
  const desktopNeeded = () => `Open the Bridge AI app on ${thisName()}: its screen can be seen while the app runs there.`
  function screenStatus() {
    if (!trialOn()) return { can: false, code: 'trial', why: `Remote Screen and Preview is off on ${thisName()}. Turn it on there in Settings › About & Updates › Beta Features.` }
    if (os === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !FAKE && !capture) return { can: false, code: 'noDisplay', why: `${thisName()} has no screen to show (Bridge AI runs there without a desktop, as on a server or in Docker).` }
    const permission = capture?.permission || null
    if (permission === 'denied' || permission === 'restricted') return { can: false, code: 'screenPermission', permission, why: `macOS doesn't let Bridge AI record the screen on ${thisName()}. On ${thisName()}, turn on Bridge AI in System Settings › Privacy & Security › Screen & System Audio Recording, then open Bridge AI again there.` }
    if (capture || FAKE) return { can: true, permission, sources: capture?.sources || (FAKE ? FAKE_SOURCES : null), p2p: !!capture?.p2p }
    if (desktopOpen()) return { can: true, permission, sources: null, p2p: true }
    return { can: false, code: 'noApp', why: desktopNeeded() }
  }
  const passwordFirst = () => `Control needs a Remote Access Password on ${thisName()}. Set one there in Settings › Account & Devices › Computers, then turn on "Let my other devices control this computer".`
  async function controlStatus(o) {
    const st = await input.status(o)
    return { on: controlOn(), ...st, ...(sinkError === 'accessibility' ? { allowed: false } : {}), ...(!conf.password ? { needs: 'password', ...(st.can ? { why: passwordFirst() } : {}) } : {}) }
  }
  const limits = () => ({ tries: ACCESS.tries, lockMinutes: Math.round(LOCK_MS / 60000) || 1, askSeconds: Math.round(ASK_MS / 1000), idleMinutes: Math.round(CONTROL_IDLE_MS / 60000) || 1, passwordMin: ACCESS.passwordMin })
  // The guardrails, as this computer itself sees them (never the password itself, nor its hash).
  // fresh: paired since a guardrail was set, so unticked until it's ticked here.
  function accessStatus() {
    sync()
    const locks = activeLocks()
    return {
      password: !!conf.password, passwordAt: conf.password?.at || null,
      askFirst: !!conf.askFirst,
      devices: devices().map((d) => ({ id: d.id, name: clean(d.name) || 'A device', kind: d.kind === 'computer' ? 'computer' : 'phone', allowed: !conf.blocked.includes(d.id), fresh: conf.fresh.includes(d.id), locked: locks.find((l) => l.id === d.id)?.until || null })),
      locks,
      limits: limits(),
    }
  }
  // device: the one asking (relay.js id; 'page', another way that isn't this computer itself), or
  // null here. A device is told its own standing and the screens it may pick: behind a guardrail (a
  // password, Ask Here First, a device not allowed) not the windows' titles, nor is the capture page
  // started for it (that waits for the session's own way in); and never the record, who else is
  // looking, what's asked here, nor the other devices.
  async function status({ sources = false, device = null } = {}) {
    const guarded = !!device && (!!conf.password || conf.askFirst || !allows(device))
    if (sources && !guarded && trialOn() && !capture && desktopOpen()) await needCapture().catch(() => {})
    else if (sources && !guarded && capture) await askSources().catch(() => {})
    // macOS asks about Screen Recording the first time the screen is taken (someone looks), never
    // before; until then, whether it's allowed, as macOS says without asking.
    const screen = screenStatus()
    // (Behind a guardrail, not even which screens: Which screen? comes in the session, past them.)
    if (device && screen.sources) screen.sources = guarded ? [] : screen.sources.map(forViewer)
    if (os === 'mac' && !screen.permission && trialOn()) { const a = await screenAllowed().catch(() => null); if (a != null) screen.permission = a ? 'ok' : 'ask' }
    const base = {
      on: trialOn(), name: thisName(), os,
      screen,
      control: await controlStatus(),
      preview: { can: trialOn() && (desktopOpen() || FAKE), why: !trialOn() ? null : desktopOpen() || FAKE ? null : desktopNeeded() },
    }
    if (device) {
      const lock = lockOf(device)
      return { ...base, notify: { on: conf.notify }, access: { password: !!conf.password, askFirst: !!conf.askFirst, limits: limits(), you: { allowed: allows(device), locked: lock ? new Date(lock.until).toISOString() : null } } }
    }
    const latest = (e) => (e.ended ? Date.parse(e.ended) : Infinity)
    const newest = (list) => list.sort((a, b) => latest(b) - latest(a) || Date.parse(b.started) - Date.parse(a.started))
    return {
      ...base,
      access: accessStatus(),
      // Where its notifications go, at this computer only (a device is told whether they're on).
      notify: { on: conf.notify, ...notifyTo() },
      asks: [...asks.values()].map(shownAsk),
      paused: pausedUntil > Date.now(),
      sessions: [...sessions.values()].map(shown),
      log: newest([...conf.log.slice(-50), ...conf.refused.slice(-50)]),
      unseen: newest([...conf.log.filter((e) => !e.seen && e.kind === 'screen' && e.ended), ...conf.refused.filter((e) => !e.seen)]),
    }
  }
  const shown = (s) => ({ id: s.id, kind: s.kind, by: s.by, for: s.for, source: { kind: s.source.kind, name: s.source.name, port: s.source.port }, control: ctl(s), controlled: s.controlled, via: s.via, started: new Date(s.started).toISOString(), told: s.told })
  // Who asks, what kind of device and how it came (straight, or through which of your computers),
  // and what for: the screen (and control), or an app.
  const shownAsk = (a) => ({ id: a.id, by: a.by, for: a.for, ...(a.for ? { forKind: a.s?.forKind || 'phone' } : {}), control: a.control, ...(a.port ? { port: a.port } : {}), at: new Date(a.at).toISOString(), until: new Date(a.until).toISOString() })

  // ---------- the capture page ----------
  // The desktop app opens it when it's needed, and closes it once nothing has been seen for a while.
  function needCapture() {
    if (capture) return Promise.resolve(capture)
    if (!desktopOpen()) return Promise.reject(Object.assign(new Error(desktopNeeded()), { code: 'noApp' }))
    toDesktop({ t: 'need-capture' })
    return new Promise((resolve, reject) => {
      const w = { resolve, reject }
      captureWaiters.push(w)
      setTimeout(() => { captureWaiters = captureWaiters.filter((x) => x !== w); reject(Object.assign(new Error(`The Bridge AI app on ${thisName()} didn't start sharing its screen. Try again; if it keeps happening, restart Bridge AI there.`), { code: 'noCapture' })) }, CAPTURE_WAIT_MS)
    })
  }
  let sourceWaiters = []
  function askSources() {
    tell(capture?.ws, { t: 'sources?' })
    return new Promise((resolve) => { sourceWaiters.push(resolve); setTimeout(resolve, 4000) })
  }
  function idleLater() {
    clearTimeout(idleTimer)
    if ([...sessions.values()].some((s) => s.provider === 'capture')) return
    idleTimer = setTimeout(() => { if (![...sessions.values()].some((s) => s.provider === 'capture')) toDesktop({ t: 'capture-idle' }) }, IDLE_MS)
    idleTimer.unref?.()
  }
  function onCapture(ws) {
    const was = capture
    const c = { ws, sources: null, permission: null, p2p: false, at: Date.now(), next: null }
    capture = c
    if (was && was.ws !== ws) try { was.ws.close(1000, 'replaced') } catch { /* closed */ }
    ws.on('message', (data, binary) => {
      if (capture !== c) return
      if (binary) {
        const s = sessions.get(c.next)
        if (s) frameIn(s, data)
        return
      }
      let m
      try { m = JSON.parse(String(data)) } catch { return }
      if (m.t === 'hello' || m.t === 'sources') {
        c.sources = Array.isArray(m.sources) ? m.sources.slice(0, 40).map(cleanSource).filter(Boolean) : []
        c.permission = typeof m.permission === 'string' ? m.permission : null
        c.p2p = m.p2p === true
        if (m.t === 'hello') { for (const w of captureWaiters.splice(0)) w.resolve(c); idleLater() }
        for (const w of sourceWaiters.splice(0)) w()
        onChange()
        return
      }
      const s = sessions.get(m.session)
      // The pictures that follow are that session's; one that has ended gets none, nor another its.
      if (m.t === 'frame') { c.next = s?.provider === 'capture' ? s.id : null; return }
      if (!s || s.provider !== 'capture') return
      if (m.t === 'offer' || m.t === 'ice') return tell(s.viewer, { t: m.t, ...(m.sdp ? { sdp: String(m.sdp) } : {}), ...(m.c ? { c: m.c } : {}) })
      if (m.t === 'started') { s.size = { w: m.w | 0, h: m.h | 0 }; return tell(s.viewer, { t: 'size', w: s.size.w, h: s.size.h }) }
      if (m.t === 'input') return applyInput(s, m.evs)
      if (m.t === 'thumbs') return thumbsOut(s, m.list)
      if (m.t === 'error') return end(s, 'error', clean(m.why, 300) || 'The screen couldn\'t be shared')
    })
    ws.on('close', () => {
      if (capture !== c) return
      capture = null
      for (const s of [...sessions.values()]) if (s.provider === 'capture') end(s, 'lost', `The Bridge AI app on ${thisName()} stopped sharing its screen.`)
      onChange()
    })
  }
  const cleanSource = (x) => {
    if (!x || typeof x.id !== 'string') return null
    const b = x.bounds && Number.isFinite(x.bounds.width) ? { x: +x.bounds.x || 0, y: +x.bounds.y || 0, width: +x.bounds.width, height: +x.bounds.height, ...(x.bounds.px && Number.isFinite(x.bounds.px.width) ? { px: { x: +x.bounds.px.x || 0, y: +x.bounds.px.y || 0, width: +x.bounds.px.width, height: +x.bounds.px.height } } : {}) } : null
    return { id: x.id.slice(0, 120), name: clean(x.name, 80) || 'Screen', kind: x.kind === 'window' ? 'window' : 'screen', w: x.w | 0, h: x.h | 0, primary: !!x.primary, scale: Number.isFinite(x.scale) ? Math.min(8, Math.max(0.5, x.scale)) : null, bounds: b }
  }
  const sourceList = () => capture?.sources || FAKE_SOURCES
  const forViewer = ({ id, name, kind, w, h, primary, scale }) => ({ id, name, kind, w, h, primary, scale })

  // ---------- a still of each screen, for the viewer's Which screen? ----------
  // Only in a session (past the guardrails), at most every few seconds, each one a picture of its own
  // (a JPEG the desktop app made, or the stand-in's drawing) of a screen that's there.
  const THUMB = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/
  function askThumbs(s) {
    if (Date.now() - (s.thumbsAt || 0) < 3000) return
    s.thumbsAt = Date.now()
    if (s.provider === 'capture') return tell(capture?.ws, { t: 'thumbs', session: s.id })
    for (const x of sourceList().filter((y) => y.kind === 'screen')) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${x.w}" height="${x.h}" viewBox="0 0 ${x.w} ${x.h}"><rect width="100%" height="100%" fill="hsl(${Math.round(x.w / 7) % 360},55%,42%)"/><text x="50%" y="50%" font-family="sans-serif" font-size="${Math.round(Math.min(x.w, x.h) / 8)}" fill="#fff" text-anchor="middle">${x.name.replace(/[<&>]/g, '')}</text></svg>`
      tell(s.viewer, { t: 'thumb', id: x.id, data: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` })
    }
  }
  function thumbsOut(s, list) {
    if (!Array.isArray(list)) return
    const screens = new Set(sourceList().filter((x) => x.kind === 'screen').map((x) => x.id))
    for (const x of list.slice(0, 12)) if (x && screens.has(x.id) && typeof x.data === 'string' && x.data.length <= 80000 && THUMB.test(x.data)) tell(s.viewer, { t: 'thumb', id: x.id, data: x.data })
  }

  // ---------- the guardrails ----------
  // Once any is set (a password, Ask Here First, a device unticked), a device paired after that
  // starts unticked: ticked here, it may connect. The devices paired before this was kept are known.
  const guarded = () => !!conf.password || conf.askFirst || devices().some((d) => conf.blocked.includes(d.id))
  function sync() {
    const list = devices()
    if (!conf.known) { conf.known = list.map((d) => d.id); save(); return }
    const fresh = list.filter((d) => !conf.known.includes(d.id))
    if (!fresh.length) return
    const block = guarded()
    conf.known = [...conf.known, ...fresh.map((d) => d.id)].slice(-500)
    if (block) {
      conf.blocked = [...new Set([...conf.blocked, ...fresh.map((d) => d.id)])]
      conf.fresh = [...new Set([...conf.fresh, ...fresh.map((d) => d.id)])].slice(-50)
    }
    save()
    onChange()
  }
  const allows = (id) => { sync(); return !!id && !conf.blocked.includes(id) }
  // Who's asking, as the lockout counts it (s.key): the device, or, through another of your computers,
  // that computer and the device there it speaks for, each on its own; and all of those through that
  // computer together too, so it can't speak for a new one each time.
  const lockKeys = (s) => (s.key === s.by.id ? [s.key] : [s.key, `${s.by.id}/*`])
  function lockOf(key) {
    const l = conf.locks[key]
    if (!l?.until) return null
    if (l.until > Date.now()) return l
    delete conf.locks[key]
    save()
    return null
  }
  const lockedFor = (s) => lockKeys(s).map(lockOf).filter(Boolean).sort((a, b) => b.until - a.until)[0] || null
  const activeLocks = () => Object.entries(conf.locks).filter(([, l]) => l?.until > Date.now()).map(([id, l]) => ({ id, name: l.name || 'A device', ...(l.for ? { for: l.for } : {}), until: new Date(l.until).toISOString() }))
  const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const lockedWhy = (until) => `Too many wrong passwords: ${thisName()} won't let this device try again until ${clock(until)}.`
  const lockedSay = (fail, until) => fail(lockedWhy(until), 'locked', { until: new Date(until).toISOString() })
  const notAllowed = (s) => `${thisName()} doesn't let ${s.by.name} connect. That's changed at ${thisName()} itself, in Settings › Account & Devices › Computers.`
  // A session turned away, kept apart from the sessions that ran, so many can't push those out of
  // the record; the same again soon after (that device, the same why) is counted on the last one.
  function refuse(s, end, more = {}) {
    const now = new Date().toISOString()
    const last = conf.refused.findLast((e) => e.key === (s.key || s.by.id) && e.end === end)
    if (last && !last.seen && Date.now() - Date.parse(last.ended) < REPEAT_MS) {
      Object.assign(last, { ended: now, count: (last.count || 1) + 1, ...(more.tries ? { tries: (last.tries || 0) + more.tries } : {}), ...(more.until ? { until: more.until } : {}) })
    } else {
      conf.refused = [...conf.refused, { id: s.id, kind: s.kind || 'screen', key: s.key || s.by.id, by: s.by, for: s.for, ...(s.port ? { port: s.port } : {}), source: null, control: false, controlled: false, via: null, started: new Date(s.started).toISOString(), ended: now, seconds: 0, end, ...(s.told?.length ? { told: s.told } : {}), ...more, seen: false }].slice(-REFUSED_MAX)
    }
    save()
    onChange()
  }
  // The next message the viewer sends that's one of names ({ t: name }, or what want(m) says), or
  // null when it's gone or doesn't within ms.
  const answerOf = (ws, names, ms) => new Promise((resolve) => {
    let tm = null
    const want = typeof names === 'function' ? names : (m) => [].concat(names).includes(m?.t)
    const done = (v) => { clearTimeout(tm); ws.off('message', on); ws.off('close', gone); resolve(v) }
    const on = (data, binary) => { if (binary) return; let m; try { m = JSON.parse(String(data)) } catch { return } if (m && want(m)) done(m) }
    const gone = () => done(null)
    tm = setTimeout(() => done(null), ms)
    ws.on('message', on)
    ws.on('close', gone)
    if (ws.readyState !== 1) done(null)
  })
  // The password, checked one at a time on this computer (scrypt takes memory while it checks). Each
  // try is counted before it's checked, so tries at once can't get past the limit; at the limit
  // there's no check at all, and a lockout is kept until it's over (or Unlock here).
  // { ok } | { wrong, left } | { locked: until, now: it just began }
  let checking = Promise.resolve()
  function checkPassword(s, pw) {
    const run = checking.then(() => check(s, pw))
    checking = run.catch(() => {})
    return run
  }
  async function check(s, pw) {
    const lock = lockedFor(s)
    if (lock) return { locked: lock.until }
    if (!conf.password) return { ok: true }
    const keys = lockKeys(s)
    const most = (i) => (i === 0 ? ACCESS.tries : HOP_TRIES)
    const ls = keys.map((k, i) => { conf.locks[k] ||= { name: s.by.name, ...(i === 0 && s.for ? { for: s.for } : {}), fails: 0 }; return conf.locks[k] })
    // (The oldest tries of devices that aren't locked out go first past 200: a computer speaking for
    // many can't fill this.)
    const idle = Object.entries(conf.locks).filter(([, l]) => !l.until && !ls.includes(l)).sort(([, a], [, b]) => (a.at || 0) - (b.at || 0))
    for (const [k] of idle.slice(0, Math.max(0, Object.keys(conf.locks).length - 200))) delete conf.locks[k]
    const lockNow = () => { for (const [i, l] of ls.entries()) if (l.fails >= most(i) && !l.until) l.until = Date.now() + LOCK_MS; save(); return Math.max(...ls.map((l) => l.until || 0)) }
    if (ls.some((l, i) => l.fails >= most(i))) return { locked: lockNow(), now: true }
    for (const l of ls) { l.fails++; l.at = Date.now() }
    save()
    const m = await passwordMatches(conf.password, pw)
    if (m.ok) {
      // Right: that device starts again, and this try isn't counted against the computer it came through.
      delete conf.locks[keys[0]]
      if (keys[1] && conf.locks[keys[1]] && !conf.locks[keys[1]].until) conf.locks[keys[1]].fails = Math.max(0, conf.locks[keys[1]].fails - 1)
      if (m.stale) conf.password = { ...(await makePassword(pw)), at: conf.password.at }
      save()
      return { ok: true }
    }
    s.tries = (s.tries || 0) + 1
    if (ls.some((l, i) => l.fails >= most(i))) return { locked: lockNow(), now: true }
    return { wrong: true, left: ACCESS.tries - ls[0].fails }
  }
  // Before anything is taken: a device locked out goes; the password, when one is set (ACCESS.tries
  // wrong, and that device is locked out); then Ask Here First, when it's on. True to go on, with
  // what was allowed (s.okControl: control may be taken without asking here again).
  async function gate(s, fail) {
    const ws = s.viewer
    const lock = lockedFor(s)
    if (lock) { lockedSay(fail, lock.until); return false }
    if (conf.password && !(await passwordFrom(s, fail))) return false
    if (conf.askFirst) {
      tell(ws, { t: 'asking', ms: ASK_MS, until: new Date(Date.now() + ASK_MS).toISOString() })
      const control = s.kind === 'screen' && !!s.wants && controlOn()
      const said = await askHere(s, { control })
      if (said === 'gone') return false
      // Stopped (or the device blocked) from another of your devices meanwhile: endFrom.
      if (said === 'stopped' || said === 'blocked') {
        refuse(s, said, { stoppedBy: s.stoppedBy })
        if (said === 'blocked') fail(`${s.blockedAt || thisName()} stopped letting this device connect.`, 'blocked', s.blockedAt ? { at: s.blockedAt } : {})
        else fail(`Stopped from ${s.stoppedBy}.`, 'stopped', { by: s.stoppedBy })
        return false
      }
      if (said !== 'allow') {
        refuse(s, said === 'deny' ? 'denied' : 'unanswered')
        fail(said === 'deny' ? `Someone at ${thisName()} said no to this.` : `Nobody at ${thisName()} answered within ${Math.round(ASK_MS / 1000)} seconds, so it wasn't allowed.`, said === 'deny' ? 'denied' : 'unanswered')
        return false
      }
      s.okControl = control
    } else s.okControl = true
    return true
  }
  // The password from the viewer; again: to take control back after it went idle, in a session that
  // goes on view-only if it isn't (or { t: 'control', on: false }, Cancel). True once it's right.
  async function passwordFrom(s, fail, { again = false } = {}) {
    const ws = s.viewer
    let wrong = false
    for (;;) {
      tell(ws, { t: 'password', wrong, left: ACCESS.tries - (conf.locks[s.key]?.fails || 0), tries: ACCESS.tries, lockMinutes: Math.round(LOCK_MS / 60000) || 1, ...(again ? { again: true } : {}) })
      const m = await answerOf(ws, again ? (x) => x.t === 'password' || (x.t === 'control' && x.on === false) : 'password', PASSWORD_WAIT_MS)
      if (!m) { if (s.tries) refuse(s, 'password', { tries: s.tries }); if (!again && ws.readyState === 1) fail('The password wasn\'t typed in time. Try again.', 'timeout'); return false }
      if (m.t === 'control') return false
      if (!conf.password) return true // taken off here meanwhile
      const r = await checkPassword(s, m.p)
      if (r.ok) return true
      if (r.locked) {
        if (r.now) refuse(s, 'locked', { tries: s.tries, until: new Date(r.locked).toISOString() })
        lockedSay(fail, r.locked)
        return false
      }
      wrong = true
    }
  }
  // Ask Here First: Allow or Deny here (the badge, Bridge AI's window), within ASK_MS. control: what
  // Allow lets it do (see, or see and control).
  function askHere(s, { control = false } = {}) {
    return new Promise((resolve) => {
      const a = { id: randomBytes(6).toString('base64url'), by: s.by, for: s.for, control, port: s.kind === 'page' ? s.port : null, at: Date.now(), until: Date.now() + ASK_MS }
      const gone = () => a.done('gone')
      a.done = (v) => {
        if (!asks.delete(a.id)) return
        clearTimeout(a.timer)
        s.viewer.off('close', gone)
        toBadge()
        onChange()
        resolve(v)
      }
      a.timer = setTimeout(() => a.done('timeout'), ASK_MS)
      a.s = s
      s.viewer.on('close', gone)
      asks.set(a.id, a)
      if (s.kind === 'screen') announce(s, 'ask', a.id, { control })
      toBadge()
      onChange()
    })
  }
  function answer(id, allow) {
    const a = asks.get(id)
    if (!a) throw Object.assign(new Error(`That ask has gone: it was answered, or ${Math.round(ASK_MS / 1000)} seconds passed.`), { status: 404 })
    a.done(allow ? 'allow' : 'deny')
    return true
  }
  // A preview of one of this computer's apps, at an address of its own on another of your computers
  // (devpreview.js): that device may, and while a password or Ask Here First is set, only while it
  // has a session for that app open that got past them (view, source=preview:<port>). null, or why not.
  function mayPreview(id, port) {
    if (!allows(id)) return { code: 'device', why: notAllowed({ by: { name: deviceOf(id)?.name || 'this device' } }) }
    const lock = lockOf(id)
    if (lock) return { code: 'locked', why: lockedWhy(lock.until) }
    if (!conf.password && !conf.askFirst) return null
    if ([...sessions.values()].some((s) => s.grant && s.key === id && s.port === Number(port))) return null
    return { code: 'gate', why: `${thisName()} asks for its password${conf.askFirst ? ', or someone there to allow it,' : ''} before it shows its apps.` }
  }

  // ---------- a session ----------
  // A viewer's WebSocket (/api/remote/view?source=screen:<id>|window:<id>|page:<port>|preview:<port>
  // &control=1&p2p=1): the session lasts as long as it's open. page: an app drawn here as pictures;
  // preview: an app at an address of its own on that computer, whose requests may come while this is
  // open (mayPreview). Through another of your computers, it says which of its devices it's for
  // (for, forId: machines.js), having checked that device may.
  async function view(ws, req) {
    const q = new URL(req.url, 'http://x').searchParams
    const fail = (why, code, more = {}) => { tell(ws, { t: 'error', why, code, ...more }); setTimeout(() => { try { ws.close(1008, 'refused') } catch { /* closed */ } }, 50) }
    const dev = deviceOf(req.headers['x-bridge-relay'])
    if (!dev) return fail(`This is ${thisName()} itself: view its screen from another of your devices.`, 'here')
    if (!trialOn()) return fail(screenStatus().why, 'trial')
    const [kind, ...rest] = String(q.get('source') || 'screen:').split(':')
    const sid = rest.join(':')
    const forId = dev.kind === 'computer' && /^[\w-]{1,40}$/.test(q.get('forId') || '') ? q.get('forId') : null
    const s = {
      id: randomBytes(8).toString('base64url'), viewer: ws, started: Date.now(),
      by: { id: dev.id, name: clean(dev.name) || 'A device', kind: dev.kind || 'phone' },
      for: dev.kind === 'computer' ? clean(q.get('for')) || null : null,
      key: forId ? `${dev.id}/${forId}` : dev.id,
      // The device it's for, as the computer it came through knows it: that one's notifications leave
      // it out, and Block This Device unticks it there.
      forId,
      forKind: forId && q.get('for') ? (q.get('forKind') === 'computer' ? 'computer' : 'phone') : null,
      kind: kind === 'page' || kind === 'preview' ? 'page' : 'screen', grant: kind === 'preview', via: null, controlled: false, frames: 0, acked: true, pending: null, sent: 0, told: [],
      slow: q.get('slow') === '1', p2p: q.get('p2p') === '1', wants: q.get('control') === '1', lastInput: Date.now(),
    }
    if (!allows(dev.id)) { refuse(s, 'device'); return fail(notAllowed(s), 'device') }
    if (s.kind === 'page') {
      const port = Number(sid)
      if (!(port > 1023 && port < 65536) || !(await isDevPort(port))) return fail(`Port ${sid} isn't one of the apps ${thisName()} serves.`, 'port')
      if (!s.grant && !desktopOpen() && !FAKE) return fail(`Open the Bridge AI app on ${thisName()} to see its apps on a phone: they're drawn there.`, 'noApp')
      s.port = port
    } else {
      const st = screenStatus()
      if (!st.can) return fail(st.why, st.code)
    }
    // Nothing is taken (nor macOS asked about the screen) before the guardrails let it in; a few at
    // a time from one device. Unticked here meanwhile, it ends (setDevice).
    if ([...pending].filter((x) => x.key === s.key).length >= PENDING_MAX) return fail(`This device is already waiting to connect to ${thisName()}. Finish that first, or close it.`, 'busy')
    s.fail = fail
    pending.add(s)
    let passed = false
    try { passed = await gate(s, fail) } finally { pending.delete(s) }
    if (!passed || ws.readyState !== 1) return
    if (!allows(dev.id)) { refuse(s, 'device'); return fail(notAllowed(s), 'device') }
    if (s.kind === 'page') {
      s.source = { kind: 'page', port: s.port, name: `:${s.port}` }
      s.provider = s.grant ? 'none' : FAKE && !desktopOpen() ? 'fake' : 'desktop'
      s.page = { w: Math.min(1600, Math.max(320, Number(q.get('w')) || 390)), h: Math.min(2400, Math.max(320, Number(q.get('h')) || 800)) }
      s.may = !s.grant // a page drawn off screen: what's clicked is that page, not this computer
    } else {
      if (!FAKE || capture) {
        try { await needCapture() } catch (e) { return fail(e.message, e.code) }
        // The capture page's first look is when macOS asks about Screen Recording (first use): turned
        // down, or not answered yet, it's said, and the question is on that screen.
        const after = screenStatus()
        if (!after.can) return fail(after.why, after.code)
        if (!allows(dev.id)) { refuse(s, 'device'); return fail(notAllowed(s), 'device') }
      }
      const list = sourceList()
      const src = list.find((x) => x.id === sid && x.kind === (kind === 'window' ? 'window' : 'screen')) || (!sid ? list.find((x) => x.kind === 'screen' && x.primary) || list.find((x) => x.kind === 'screen') : null)
      if (!src) return fail(sid ? 'That screen or window isn\'t there any more. Pick another.' : `${thisName()} didn't say which screens it has. Try again in a moment.`, 'source')
      s.source = { kind: src.kind, id: src.id, name: src.name, bounds: src.bounds, w: src.w, h: src.h }
      s.provider = capture ? 'capture' : 'fake'
      // Control when it's on here and asked for (of a whole screen: where the pointer goes is known
      // there), and allowed here when Ask Here First asked.
      s.may = s.wants && s.okControl && controlOn() && (await input.status()).can
    }
    // The viewer went while this was being worked out: nothing to start.
    if (ws.readyState !== 1) return
    sessions.set(s.id, s)
    clearTimeout(idleTimer)
    s.entry = { id: s.id, kind: s.kind, by: s.by, for: s.for, source: { kind: s.source.kind, name: s.source.name, ...(s.source.port ? { port: s.source.port } : {}) }, control: ctl(s), controlled: false, via: null, started: new Date(s.started).toISOString(), ended: null, seconds: 0, end: null, told: s.told, seen: false }
    conf.log = [...conf.log, s.entry].slice(-LOG_MAX)
    save()
    if (s.kind === 'screen') announce(s, 'view', s.id)
    if (ctl(s) && s.kind === 'screen') startSink()
    if (s.kind === 'screen') { s.idleCheck = setInterval(() => idleBack(s), Math.min(30000, Math.max(200, CONTROL_IDLE_MS / 5))); s.idleCheck.unref?.() }
    ws.on('message', (data, binary) => { if (!binary) { let m; try { m = JSON.parse(String(data)) } catch { return } fromViewer(s, m) } })
    ws.on('close', () => end(s, 'viewer'))
    const p2p = s.kind === 'screen' && s.provider === 'capture' && s.p2p && capture?.p2p
    tell(ws, {
      t: 'hello', session: s.id, name: thisName(), os, source: { kind: s.source.kind, id: s.source.id, name: s.source.name, w: s.source.w, h: s.source.h, ...(s.port ? { port: s.port } : {}) },
      sources: s.kind === 'screen' ? sourceList().map(forViewer) : [],
      p2p: p2p ? { ice: iceServers(process.env) } : null, rate: rate(s), control: controlInfo(s), ...(s.grant ? { grant: true } : {}),
    })
    if (s.provider === 'capture') tell(capture.ws, { t: 'start', session: s.id, source: s.source, p2p: p2p ? { ice: iceServers(process.env) } : null, rate: rate(s), max: MAX_FRAME })
    else if (s.provider === 'desktop') toDesktop({ t: 'page-start', session: s.id, port: s.source.port, w: s.page.w, h: s.page.h, rate: rate(s) })
    else if (s.provider === 'fake') fakeFrames(s)
    if (!p2p) via(s, 'relay')
    toBadge()
    onChange()
  }
  const controlWhy = (s) => (!conf.password ? passwordFirst()
    : !conf.control ? `Control is off on ${thisName()}. Turn on "Let my other devices control this computer" there, in Settings › Account & Devices › Computers.`
      : s.source.kind !== 'screen' ? 'Control works on a whole screen: pick one of the screens to control it.'
        : s.idled ? `View only now: nothing was pressed for ${Math.round(CONTROL_IDLE_MS / 60000) || 1} minutes. Choose Control to take it again.` : null)
  const controlInfo = (s) => ({ on: controlOn(), allowed: ctl(s), ...(s.idled ? { idle: true } : {}), why: s.kind === 'screen' && !ctl(s) ? controlWhy(s) : null })
  const via = (s, how) => { if (s.via === how) return; s.via = how; s.entry.via = how; save(); onChange() }

  function fromViewer(s, m) {
    if (m.t === 'answer' || m.t === 'ice') { if (s.provider === 'capture') tell(capture?.ws, { t: m.t, session: s.id, ...(m.sdp ? { sdp: String(m.sdp) } : {}), ...(m.c ? { c: m.c } : {}) }); return }
    if (m.t === 'p2p' && m.state === 'connected') return via(s, 'p2p')
    if (m.t === 'fallback') { via(s, 'relay'); if (s.provider === 'capture') tell(capture?.ws, { t: 'fallback', session: s.id, rate: rate(s), max: MAX_FRAME }); return }
    if (m.t === 'ack') { s.acked = true; sendPending(s); return }
    if (m.t === 'input') return applyInput(s, m.evs)
    if (m.t === 'clip' || m.t === 'clip?') return clip(s, m)
    if (m.t === 'source' && s.kind === 'screen') return switchTo(s, String(m.source || ''))
    if (m.t === 'thumbs?' && s.kind === 'screen') return askThumbs(s)
    if (m.t === 'control' && s.kind === 'screen' && m.on === true) return takeControl(s)
    if (m.t === 'go' && s.kind === 'page' && typeof m.path === 'string' && m.path.startsWith('/') && !m.path.startsWith('//')) { s.path = m.path.slice(0, 2000); if (s.provider === 'desktop') toDesktop({ t: 'page-go', session: s.id, path: s.path }); return }
    if (m.t === 'resize' && s.kind === 'page') { s.page = { w: Math.min(1600, Math.max(320, Number(m.w) || s.page.w)), h: Math.min(2400, Math.max(320, Number(m.h) || s.page.h)) }; if (s.provider === 'desktop') toDesktop({ t: 'page-resize', session: s.id, ...s.page }) }
  }

  // Another of its screens (or windows), in the same session: nothing to reconnect, nor to ask again.
  function switchTo(s, want) {
    const [kind, ...rest] = want.split(':')
    const sid = rest.join(':')
    const src = sourceList().find((x) => x.id === sid && x.kind === (kind === 'window' ? 'window' : 'screen'))
    if (!src) return tell(s.viewer, { t: 'error', code: 'source', why: 'That screen or window isn\'t there any more. Pick another.', keep: true })
    if (src.id === s.source.id && src.kind === s.source.kind) return
    if (s.may) sink?.releaseAll(s.source.bounds)
    s.source = { kind: src.kind, id: src.id, name: src.name, bounds: src.bounds, w: src.w, h: src.h }
    s.entry.also = [...new Set([...(s.entry.also || []), src.name])].filter((n) => n !== s.entry.source.name).slice(0, 10)
    save()
    if (s.provider === 'capture') tell(capture?.ws, { t: 'switch', session: s.id, source: s.source, rate: rate(s), max: MAX_FRAME })
    else if (s.provider === 'fake') tell(s.viewer, { t: 'size', w: src.w, h: src.h })
    tell(s.viewer, { t: 'source', source: { kind: src.kind, id: src.id, name: src.name, w: src.w, h: src.h }, control: controlInfo(s) })
    if (ctl(s)) startSink()
    else stopSinkIfIdle()
    toBadge()
    onChange()
  }

  // Control back to view-only after CONTROL_IDLE_MS without input, and taken again from the viewer.
  function idleBack(s) {
    if (!s.may || Date.now() - s.lastInput < CONTROL_IDLE_MS) return
    s.may = false
    s.idled = true
    sink?.releaseAll(s.source.bounds)
    stopSinkIfIdle()
    tell(s.viewer, { t: 'control', ...controlInfo(s) })
    toBadge()
    onChange()
  }
  // Only what was allowed: control not allowed here yet (Ask Here First allowed viewing) is asked
  // for here; taken back after it went idle, the password again (when there's one) and Allow again
  // (when Ask Here First is on). Turned down, or not answered, it stays view-only.
  async function takeControl(s) {
    if (s.taking) return
    s.taking = true
    try {
      const st = controlOn() ? await input.status() : null
      if (!sessions.has(s.id)) return
      if (!st?.can) return tell(s.viewer, { t: 'control', ...controlInfo(s), ...(st?.why ? { why: st.why } : {}) })
      const stay = (why) => sessions.has(s.id) && tell(s.viewer, { t: 'control', ...controlInfo(s), why })
      const ended = (why, code, more = {}) => { tell(s.viewer, { t: 'error', why, code, ...more }); end(s, code) }
      if (s.idled && conf.password && !(await passwordFrom(s, ended, { again: true }))) return stay(`Still view only: control comes back with ${thisName()}'s password.`)
      if (!sessions.has(s.id)) return
      if (conf.askFirst && (s.idled || !s.okControl)) {
        tell(s.viewer, { t: 'asking', ms: ASK_MS, until: new Date(Date.now() + ASK_MS).toISOString(), control: true })
        const said = await askHere(s, { control: true })
        if (!sessions.has(s.id) || said === 'gone') return
        if (said !== 'allow') return stay(said === 'timeout' ? `Nobody at ${thisName()} answered within ${Math.round(ASK_MS / 1000)} seconds, so it's still view only.` : `Someone at ${thisName()} said no to control.`)
        s.okControl = true
      }
      if (!controlOn()) return stay(null)
      s.may = true
      s.idled = false
      s.lastInput = Date.now()
      if (ctl(s)) { s.entry.control = true; save(); startSink() }
      tell(s.viewer, { t: 'control', ...controlInfo(s) })
      toBadge()
      onChange()
    } finally { s.taking = false }
  }

  // A picture for the viewer: sent once the last one was shown (ack), at most rate(s) a second; one
  // that comes meanwhile takes the place of one still waiting, so what's shown is never behind.
  function frameIn(s, data) {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (b.byteLength > MAX_FRAME + 64) { tell(capture?.ws, { t: 'smaller', session: s.id }); return }
    s.pending = b
    sendPending(s)
  }
  function sendPending(s) {
    if (!s.pending || !s.acked || s.viewer.readyState !== 1) return
    const gap = 1000 / rate(s) - (Date.now() - s.sent)
    if (gap > 0) { if (!s.waitTimer) s.waitTimer = setTimeout(() => { s.waitTimer = null; sendPending(s) }, gap); return }
    const b = s.pending
    s.pending = null
    s.acked = false
    s.sent = Date.now()
    s.frames++
    s.viewer.send(b, { binary: true })
  }
  // A picture of a project's app, from the desktop app's page window (POST /api/remote/sessions/:id/frame).
  function pageFrame(id, { type, w, h, body }) {
    const s = sessions.get(id)
    if (!s || s.kind !== 'page') return false
    frameIn(s, Buffer.from(packFrame(type, w, h, body)))
    return true
  }

  // ---------- input ----------
  const controlling = () => watchers().filter((s) => ctl(s))
  function startSink() {
    if (sink) return
    sinkError = null
    sink = input.start({
      onLocal: () => {
        pausedUntil = Date.now() + PAUSE_MS
        sink?.releaseAll()
        for (const s of controlling()) tell(s.viewer, { t: 'paused', ms: PAUSE_MS, why: 'local' })
        onChange()
      },
      onError: (e) => {
        sinkError = e
        for (const s of controlling()) tell(s.viewer, { t: 'error', code: e === 'accessibility' ? 'accessibility' : 'input', why: e === 'accessibility' ? `macOS doesn't let Bridge AI control ${thisName()}. On ${thisName()}, turn on Bridge AI in System Settings › Privacy & Security › Accessibility.` : `Control stopped on ${thisName()}: ${e}`, keep: true })
      },
    })
  }
  function stopSinkIfIdle() {
    if (!sink || controlling().length) return
    sink.stop()
    sink = null
  }
  function applyInput(s, evs) {
    if (!Array.isArray(evs) || !ctl(s)) return
    if (s.kind === 'screen' && Date.now() < pausedUntil) return
    const list = evs.slice(0, 200).map(cleanInput).filter(Boolean)
    if (!list.length) return
    s.lastInput = Date.now()
    if (!s.controlled) { s.controlled = true; s.entry.controlled = true; save(); if (s.kind === 'screen') { toBadge(); announce(s, 'control', s.id) } }
    if (s.kind === 'page') {
      if (s.provider === 'desktop') toDesktop({ t: 'page-input', session: s.id, evs: list })
      else if (process.env.BRIDGE_TEST_INPUT) for (const ev of list) fs.appendFileSync(process.env.BRIDGE_TEST_INPUT, `${JSON.stringify({ page: s.source.port, ...ev })}\n`)
      return
    }
    startSink()
    for (const ev of list) sink.send(ev, s.source.bounds)
  }
  async function clip(s, m) {
    if (!ctl(s) || s.kind !== 'screen') return tell(s.viewer, { t: 'error', code: 'clipboard', why: controlWhy(s) || 'The clipboard goes along only while you control the computer.', keep: true })
    s.lastInput = Date.now()
    try {
      if (m.t === 'clip') { await input.writeClipboard(String(m.text ?? '')); tell(s.viewer, { t: 'clip-sent', n: String(m.text ?? '').length }) } else tell(s.viewer, { t: 'clip', text: (await input.readClipboard()).slice(0, 1_000_000) })
    } catch (e) { tell(s.viewer, { t: 'error', code: 'clipboard', why: e.message, keep: true }) }
  }

  // ---------- the end ----------
  function end(s, why, error = null) {
    if (!sessions.delete(s.id)) return
    clearTimeout(s.fakeTimer)
    clearTimeout(s.waitTimer)
    clearInterval(s.idleCheck)
    if (error) tell(s.viewer, { t: 'error', why: error, code: why, ...(s.blockedAt ? { at: s.blockedAt } : {}) })
    if (why === 'here') tell(s.viewer, { t: 'ended', why: 'here', text: `Stopped on ${thisName()}.` })
    if (why === 'stopped') tell(s.viewer, { t: 'ended', why: 'stopped', by: s.stoppedBy, text: `Stopped from ${s.stoppedBy}.` })
    try { if (s.viewer.readyState <= 1) s.viewer.close(1000, why) } catch { /* closed */ }
    if (s.provider === 'capture') tell(capture?.ws, { t: 'stop', session: s.id })
    if (s.provider === 'desktop') toDesktop({ t: 'page-stop', session: s.id })
    if (s.kind === 'screen' && s.may) sink?.releaseAll(s.source.bounds)
    stopSinkIfIdle()
    Object.assign(s.entry, { ended: new Date().toISOString(), seconds: Math.round((Date.now() - s.started) / 1000), end: why, ...(error && why !== 'blocked' ? { error: clean(error, 300) } : {}), ...(s.stoppedBy ? { stoppedBy: s.stoppedBy } : {}), controlled: s.controlled, via: s.via })
    save()
    idleLater()
    toBadge()
    onChange()
  }
  const stop = (id) => { const s = sessions.get(id); if (!s) throw Object.assign(new Error('That session has ended'), { status: 404 }); end(s, 'here'); return true }
  const stopAll = () => { for (const s of [...sessions.values()]) end(s, 'here'); for (const a of [...asks.values()]) a.done('deny') }
  // Stop, or Block This Device, from another of your devices (a notification's button, the card in
  // a window), carried out here: the session ends (an ask waiting is a no), and Block unticks that
  // device in Which Devices May Connect, which ends anything else of its too; one that came through
  // another of your computers is unticked there, the computer it came through (blockThere), not that
  // computer here. by: who did it, for the record. Either only narrows who may connect; a device is
  // let back in at the computer it's unticked on, only (setDevice).
  async function endFrom(id, { block = false, by = '' } = {}) {
    const s = sessions.get(id)
    const a = asks.get(id)
    if (!s && !a) throw Object.assign(new Error('That session has ended'), { status: 404 })
    const x = s || a.s
    const who = x.by
    const from = clean(by) || 'another of your devices'
    const hop = who.kind === 'computer' && x.forId ? who : null
    if (block && hop) x.blockedAt = hop.name
    if (s) { s.stoppedBy = from; end(s, block ? 'blocked' : 'stopped', block ? `${hop?.name || thisName()} stopped letting this device connect.` : null) }
    if (a) { a.s.stoppedBy = from; a.done(block ? 'blocked' : 'stopped') }
    if (!block) return { ok: true, said: `Stopped: ${x.for || who.name} isn't viewing ${thisName()}'s screen now.` }
    if (hop) {
      try { await blockThere(hop.id, x.forId) } catch (e) { return { ok: false, said: `Stopped, but ${x.for} couldn't be blocked on ${hop.name}: ${e.message}` } }
      return { ok: true, said: `${x.for} can't connect through ${hop.name} any more.` }
    }
    if (devices().some((d) => d.id === who.id)) setDevice(who.id, false)
    return { ok: true, said: `${who.name} can't connect to ${thisName()} any more.` }
  }

  // ---------- your other devices, told ----------
  // A session starting (view), control taken (control) or an ask waiting (ask), told to your other
  // devices (tell, screentell.js) unless that's off here. What became of each goes in the record
  // with the session: when, and how many of your devices it reached, here and through each computer.
  function announce(s, what, id, { control = null } = {}) {
    const told = { at: new Date().toISOString(), what }
    s.told.push(told)
    if (!conf.notify) { told.off = true; save(); return }
    const ev = { what, id, by: s.by, for: s.for, forId: s.forId, forKind: s.forKind, control: control ?? (what === 'ask' ? !!s.wants && controlOn() : ctl(s)), started: new Date(s.started).toISOString() }
    Promise.resolve().then(() => tellDevices(ev)).then((r) => Object.assign(told, r || {}), (e) => { told.error = clean(e.message, 200) })
      .finally(() => { save(); onChange() })
  }
  function setNotify(on) { conf.notify = !!on; save(); onChange(); return { on: conf.notify, ...notifyTo() } }
  // What's going on here now, for your other devices' cards (screentell.js): who views or controls
  // this screen, and who asks to; never what's on it.
  const live = () => ({
    sessions: watchers().map((s) => ({ id: s.id, by: { name: s.by.name, kind: s.by.kind }, for: s.for, forKind: s.forKind, control: ctl(s), controlled: s.controlled, started: new Date(s.started).toISOString() })),
    asks: [...asks.values()].filter((a) => !a.port).map((a) => ({ id: a.id, by: { name: a.by.name, kind: a.by.kind }, for: a.for, forKind: a.s.forKind, control: a.control, at: new Date(a.at).toISOString(), until: new Date(a.until).toISOString() })),
  })

  // ---------- set here: control, the password, Ask Here First, which devices ----------
  async function setControl(on) {
    if (on) {
      if (!conf.password) throw Object.assign(new Error('Set a Remote Access Password first: control needs one.'), { status: 400, code: 'needsPassword' })
      const st = await input.status({ fresh: true })
      if (!st.can) throw Object.assign(new Error(st.why), { status: 400, code: 'controlUnavailable' })
    }
    conf.control = !!on
    save()
    controlChanged()
    return controlStatus({ fresh: true })
  }
  // Each session told what it may do now.
  function controlChanged() {
    for (const s of watchers()) {
      if (!controlOn() && s.may) { sink?.releaseAll(s.source.bounds); s.may = false }
      tell(s.viewer, { t: 'control', ...controlInfo(s), ...(controlOn() && !ctl(s) && s.source.kind === 'screen' ? { why: 'Control is on now: choose Control to use it.' } : {}) })
    }
    if (!controlOn()) { sink?.releaseAll(); stopSinkIfIdle() }
    toDesktop({ t: 'control', on: controlOn() })
    toBadge()
    onChange()
  }
  async function setPassword(pw) {
    if (typeof pw !== 'string' || [...pw].length < ACCESS.passwordMin) throw Object.assign(new Error(`A Remote Access Password needs at least ${ACCESS.passwordMin} characters.`), { status: 400, code: 'short' })
    if (pw.length > 200) throw Object.assign(new Error('That password is too long (200 characters at most).'), { status: 400, code: 'long' })
    conf.password = await makePassword(pw)
    save()
    passwordChanged()
    controlChanged()
    return accessStatus()
  }
  // Taken off: control needs it, so control goes off too.
  function clearPassword() {
    conf.password = null
    conf.control = false
    save()
    passwordChanged()
    controlChanged()
    return accessStatus()
  }
  // Changed or taken off: every session ends, to connect again as it is now.
  function passwordChanged() {
    for (const s of [...sessions.values()]) end(s, 'changed', `The Remote Access Password changed on ${thisName()}. Connect again.`)
  }
  function setAskFirst(on) { conf.askFirst = !!on; save(); onChange(); return accessStatus() }
  // Unticked: it can't connect, and a session of its going now ends, as does one at the password or
  // waiting for Allow, and one through this computer to another (onBlocked).
  function setDevice(id, allowed) {
    sync()
    if (!devices().some((d) => d.id === id)) throw Object.assign(new Error('That device isn\'t paired with this computer.'), { status: 404 })
    conf.blocked = allowed ? conf.blocked.filter((x) => x !== id) : [...new Set([...conf.blocked, id])]
    conf.fresh = conf.fresh.filter((x) => x !== id)
    save()
    if (!allowed) {
      const why = `${thisName()} stopped letting this device connect.`
      for (const s of [...sessions.values()]) if (s.by.id === id) end(s, 'device', why)
      for (const a of [...asks.values()]) if (a.by.id === id) a.done('gone')
      for (const s of [...pending]) if (s.by.id === id) { pending.delete(s); refuse(s, 'device'); s.fail(why, 'device') }
      onBlocked(id)
    }
    onChange()
    return accessStatus()
  }
  function unlock(id) { if (conf.locks[id]) { delete conf.locks[id]; save(); onChange() } return accessStatus() }

  // What you've seen of who looked while you were away.
  function seen() { for (const e of [...conf.log, ...conf.refused]) e.seen = true; save(); onChange(); return { ok: true } }

  // ---------- test stand-in: pictures made here ----------
  function fakeFrames(s) {
    const tick = () => {
      if (!sessions.has(s.id)) return
      const n = s.frames + 1
      const [w, h] = s.kind === 'page' ? [s.page.w, s.page.h] : [s.source.w || 1280, s.source.h || 800]
      const label = s.kind === 'page' ? `Preview of port ${s.source.port}` : `${s.source.name}`
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="hsl(${(n * 37) % 360},55%,42%)"/><rect x="${w / 4}" y="${h / 4}" width="${w / 2}" height="${h / 2}" fill="none" stroke="#fff" stroke-width="${Math.max(2, Math.round(w / 400))}"/><text x="50%" y="50%" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 12)}" fill="#fff" text-anchor="middle">${label.replace(/[<&>]/g, '')} · ${n}</text></svg>`
      frameIn(s, Buffer.from(packFrame('image/svg+xml', w, h, Buffer.from(svg))))
      s.fakeTimer = setTimeout(tick, 1000 / rate(s))
    }
    tell(s.viewer, { t: 'size', w: s.kind === 'page' ? s.page.w : s.source.w, h: s.kind === 'page' ? s.page.h : s.source.h })
    tick()
  }

  // ---------- WebSockets ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
  const VIEW = /^(?:\/m\/[A-Za-z0-9_-]{1,20})?\/api\/remote\/(view|capture)(?:\?|$)/
  const isPath = (u) => VIEW.test(String(u || ''))
  // capture: only this computer's own page (the desktop app's capture window), never a device's.
  function upgrade(req, socket, head) {
    const kind = VIEW.exec(req.url)?.[1]
    if (kind === 'capture' && req.headers['x-bridge-relay']) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy() }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {})
      if (kind === 'capture') onCapture(ws)
      else view(ws, req).catch((e) => { tell(ws, { t: 'error', why: e.message }); try { ws.close(1011) } catch { /* closed */ } })
    })
  }

  // ---------- the desktop app's feed ----------
  function onDesktop(fn) {
    desktops.add(fn)
    fn({ t: 'control', on: controlOn() })
    if (sessions.size || asks.size) fn({ t: 'sessions', list: watchers().map(shown), asks: [...asks.values()].map(shownAsk) })
    onChange()
    return () => { desktops.delete(fn); onChange() }
  }

  // Trial turned off: every session ends, and every ask is a no.
  function trialChanged() {
    if (trialOn()) return
    for (const s of [...sessions.values()]) end(s, 'off', 'Remote Screen and Preview was turned off on this computer.')
    for (const a of [...asks.values()]) a.done('deny')
  }

  // Whether a device of this computer's may go on through it to another of your computers (machines.js):
  // allowed here and not locked out here. null, or why not.
  function mayPass(id) {
    if (!allows(id)) return { code: 'device', why: notAllowed({ by: { name: deviceOf(id)?.name || 'this device' } }) }
    const lock = lockOf(id)
    return lock ? { code: 'locked', why: lockedWhy(lock.until), until: new Date(lock.until).toISOString() } : null
  }

  return { status, setControl, setPassword, clearPassword, setAskFirst, setDevice, setNotify, unlock, answer, allows, mayPass, mayPreview, stop, stopAll, endFrom, live, seen, upgrade, isPath, onDesktop, pageFrame, trialChanged, desktopOpen, active: () => sessions.size }
}

// The test stand-in's screens: its main one, one beside it, a 5K one at twice its points (as a
// Retina display is), one turned on its side to the left, one below, and a window.
const FAKE_SOURCES = [
  { id: 'fake-1', name: 'Test screen', kind: 'screen', w: 1280, h: 800, primary: true, scale: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 } },
  { id: 'fake-2', name: 'Second screen', kind: 'screen', w: 1024, h: 768, scale: 1, bounds: { x: 1280, y: 0, width: 1024, height: 768 } },
  { id: 'fake-5k', name: 'Studio Display', kind: 'screen', w: 5120, h: 2880, scale: 2, bounds: { x: 2304, y: 0, width: 2560, height: 1440 } },
  { id: 'fake-portrait', name: 'Portrait screen', kind: 'screen', w: 1080, h: 1920, scale: 1, bounds: { x: -1080, y: -400, width: 1080, height: 1920 } },
  { id: 'fake-air', name: 'MacBook Air', kind: 'screen', w: 1440, h: 900, scale: 1, bounds: { x: 0, y: 800, width: 1440, height: 900 } },
  { id: 'fake-w1', name: 'Test window', kind: 'window', w: 800, h: 600 },
]
