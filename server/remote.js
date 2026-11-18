// Remote Screen and Preview (a Beta Feature, src/trials.js): this computer's screen, and the apps
// its agents serve, seen from your other devices, and controlled from them once you allow it here.
//
// Who: only your own devices, paired with this computer (relay.js): each session comes over the
// device's encrypted link (a WebSocket through relay.js, or through another of your computers that
// is linked to this one, machines.js), and the relay sees only sealed messages. Never from this
// computer's own page (there's nothing to see from here), never from a web page.
//
// Guardrails, each set here at this computer only (index.js remoteHere), never from a device:
//   Remote Access Password  asked of every session before anything of the screen is taken, and
//                           checked here; kept only as a salted scrypt hash in remote.json, never sent
//                           or logged. 5 wrong tries lock that device out for 15 minutes (recorded).
//   control                 off until you turn on "Let my other devices control this computer", which
//                           needs the password set, and on a Mac asks for Accessibility then; a
//                           session's control goes back to view-only after 10 minutes without input,
//                           and while someone here moves the mouse or presses a key, remote input
//                           waits a moment (remoteinput.js).
//   Ask Here First          (off by default) Allow or Deny here for each session; no answer in 30
//                           seconds is a no.
//   which devices           every paired phone and linked computer may, until it's unticked here.
// Viewing needs nobody at this computer otherwise (it's yours): it shows that it's being viewed (the
// desktop app's badge, on top of everything, with Stop; and a line in Bridge AI itself), and
// afterwards says who looked, when and for how long, until you've seen it. Every session (who, from
// which device, what, when, how long, whether it controlled anything, and how it came), and every
// one turned away (a lockout, a no here, a device not allowed), is kept in ~/.bridge-ai/remote.json,
// the last 200, and shown in Settings.
//
// The picture: the desktop app's capture page (src/components/remote/Capture.jsx, in a window of
// its own that never shows) takes the screen and sends it peer-to-peer (WebRTC; the offer, answer
// and candidates go over the link, here), or, where the network won't allow that, as pictures over
// the link, a few a second at most (shared/remote.js RATE). A project's app (a preview on a phone)
// comes as pictures from a window of the desktop app's that's drawn off screen (desktop/remote.js).
// Tests stand in for both: BRIDGE_TEST_SCREEN=fake draws pictures here, and the capture page takes
// a canvas instead of a screen with ?fake=1.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { dataFile, ensureDir, writeFileAtomic } from './paths.js'
import * as input from './remoteinput.js'
import { cleanInput, iceServers, RATE, MAX_FRAME, PAUSE_MS, ACCESS, packFrame } from '../shared/remote.js'

const FILE = dataFile('remote.json')
const LOG_MAX = 200
const FAKE = process.env.BRIDGE_TEST_SCREEN === 'fake'
const CAPTURE_WAIT_MS = Number(process.env.BRIDGE_REMOTE_CAPTURE_WAIT_MS) || 8000
const IDLE_MS = 5 * 60000 // the capture window, with nothing to capture, closes after this long
// The guardrails' times (shared/remote.js ACCESS), shorter in tests.
const LOCK_MS = Number(process.env.BRIDGE_REMOTE_LOCK_MS) || ACCESS.lockMinutes * 60000
const ASK_MS = Number(process.env.BRIDGE_REMOTE_ASK_MS) || ACCESS.askSeconds * 1000
const CONTROL_IDLE_MS = Number(process.env.BRIDGE_REMOTE_CONTROL_IDLE_MS) || ACCESS.idleMinutes * 60000
const PASSWORD_WAIT_MS = 5 * 60000 // a password not typed in this long: the session goes
const clean = (s, n = 60) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '')

const read = () => {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return {
      control: d.control === true,
      password: d.password && typeof d.password.hash === 'string' && typeof d.password.salt === 'string' ? d.password : null,
      askFirst: d.askFirst === true,
      blocked: Array.isArray(d.blocked) ? d.blocked.filter((x) => typeof x === 'string').slice(0, 500) : [],
      locks: d.locks && typeof d.locks === 'object' && !Array.isArray(d.locks) ? d.locks : {},
      log: Array.isArray(d.log) ? d.log.slice(-LOG_MAX) : [],
    }
  } catch { return { control: false, password: null, askFirst: false, blocked: [], locks: {}, log: [] } }
}

// ---------- the Remote Access Password ----------
// scrypt, salted, its settings kept beside the hash so an older one still checks after they change.
const SCRYPT = { N: 16384, r: 8, p: 1 }
const hashOf = (pw, salt, o = SCRYPT) => new Promise((resolve, reject) => scrypt(String(pw).normalize('NFC'), salt, 32, { ...o, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))))
async function makePassword(pw) {
  const salt = randomBytes(16)
  return { kdf: 'scrypt', ...SCRYPT, salt: salt.toString('base64'), hash: (await hashOf(pw, salt)).toString('base64'), at: new Date().toISOString() }
}
async function passwordMatches(stored, pw) {
  if (!stored || typeof pw !== 'string' || !pw || pw.length > 1024) return false
  const want = Buffer.from(stored.hash, 'base64')
  const got = await hashOf(pw, Buffer.from(stored.salt, 'base64'), { N: stored.N || SCRYPT.N, r: stored.r || SCRYPT.r, p: stored.p || SCRYPT.p }).catch(() => null)
  return !!got && got.length === want.length && timingSafeEqual(got, want)
}

// trialOn(): the Beta Feature is on here. deviceOf(id): a device paired here (relay.js), or null.
// thisName(): this computer's name. os: 'mac' | 'windows' | 'linux'. hosted(): this computer's relay
// is Bridge AI's (each message counts against the account's allowance). isDevPort(port): one of
// this computer's dev servers (servers.js). screenAllowed(): on a Mac, whether macOS lets Bridge AI
// record the screen, looked at without asking (calls.js screen). devices(): the phones and computers
// paired here ({ id, name, kind }, relay.js). onChange(): what Bridge AI shows of this changed.
export function makeRemote({ trialOn, deviceOf, thisName, os, hosted = () => false, isDevPort = async () => false, screenAllowed = async () => null, devices = () => [], onChange = () => {} }) {
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

  const desktopOpen = () => desktops.size > 0
  const toDesktop = (ev) => { for (const fn of desktops) { try { fn(ev) } catch { /* gone */ } } }
  const tell = (ws, msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)) }
  const rate = (s) => Math.min(s.slow || hosted() ? RATE.hosted : RATE.own, s.kind === 'page' ? RATE.own : 99)
  // Control is on only with a password set (an older remote.json may have it on without one).
  const controlOn = () => conf.control && !!conf.password
  // Whether a session may press anything now: a page always (it's that app, not this computer); a
  // screen once it was allowed control, while it shows a whole screen (where the pointer goes is known).
  const ctl = (s) => (s.kind === 'page' ? true : !!s.may && s.source?.kind === 'screen')
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
  // The guardrails, as anyone may see them (never the password itself, nor its hash).
  function accessStatus() {
    const locks = activeLocks()
    return {
      password: !!conf.password, passwordAt: conf.password?.at || null,
      askFirst: !!conf.askFirst,
      devices: devices().map((d) => ({ id: d.id, name: clean(d.name) || 'A device', kind: d.kind === 'computer' ? 'computer' : 'phone', allowed: !conf.blocked.includes(d.id), locked: locks.find((l) => l.id === d.id)?.until || null })),
      locks,
      limits: { tries: ACCESS.tries, lockMinutes: Math.round(LOCK_MS / 60000) || 1, askSeconds: Math.round(ASK_MS / 1000), idleMinutes: Math.round(CONTROL_IDLE_MS / 60000) || 1, passwordMin: ACCESS.passwordMin },
    }
  }
  // device: the one asking (relay.js id), or null here. Behind a guardrail (a password, Ask Here
  // First, a device not allowed), a device asking isn't told the windows' titles, nor is the capture
  // page started for it: that waits for the session's own way in.
  async function status({ sources = false, device = null } = {}) {
    const guarded = !!device && (!!conf.password || conf.askFirst || !allows(device))
    if (sources && !guarded && trialOn() && !capture && desktopOpen()) await needCapture().catch(() => {})
    else if (sources && !guarded && capture) await askSources().catch(() => {})
    // macOS asks about Screen Recording the first time the screen is taken (someone looks), never
    // before; until then, whether it's allowed, as macOS says without asking.
    const screen = screenStatus()
    if (guarded && screen.sources) screen.sources = screen.sources.filter((x) => x.kind === 'screen').map(forViewer)
    if (os === 'mac' && !screen.permission && trialOn()) { const a = await screenAllowed().catch(() => null); if (a != null) screen.permission = a ? 'ok' : 'ask' }
    return {
      on: trialOn(), name: thisName(), os,
      screen,
      control: await controlStatus(),
      access: accessStatus(),
      asks: [...asks.values()].map(shownAsk),
      preview: { can: trialOn() && (desktopOpen() || FAKE), why: !trialOn() ? null : desktopOpen() || FAKE ? null : desktopNeeded() },
      paused: pausedUntil > Date.now(),
      sessions: [...sessions.values()].map(shown),
      log: conf.log.slice(-50).reverse(),
      unseen: conf.log.filter((e) => !e.seen && e.kind === 'screen' && e.ended).reverse(),
    }
  }
  const shown = (s) => ({ id: s.id, kind: s.kind, by: s.by, for: s.for, source: { kind: s.source.kind, name: s.source.name, port: s.source.port }, control: ctl(s), controlled: s.controlled, via: s.via, started: new Date(s.started).toISOString() })
  const shownAsk = (a) => ({ id: a.id, by: a.by, for: a.for, control: a.control, at: new Date(a.at).toISOString(), until: new Date(a.until).toISOString() })

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
      if (!s || s.provider !== 'capture') return
      if (m.t === 'frame') { c.next = s.id; return }
      if (m.t === 'offer' || m.t === 'ice') return tell(s.viewer, { t: m.t, ...(m.sdp ? { sdp: String(m.sdp) } : {}), ...(m.c ? { c: m.c } : {}) })
      if (m.t === 'started') { s.size = { w: m.w | 0, h: m.h | 0 }; return tell(s.viewer, { t: 'size', w: s.size.w, h: s.size.h }) }
      if (m.t === 'input') return applyInput(s, m.evs)
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

  // ---------- the guardrails ----------
  const allows = (id) => !!id && !conf.blocked.includes(id)
  function lockOf(id) {
    const l = conf.locks[id]
    if (!l?.until) return null
    if (l.until > Date.now()) return l
    delete conf.locks[id]
    save()
    return null
  }
  const activeLocks = () => Object.entries(conf.locks).filter(([, l]) => l?.until > Date.now()).map(([id, l]) => ({ id, name: l.name || 'A device', until: new Date(l.until).toISOString() }))
  const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const lockedWhy = (until) => `Too many wrong passwords: ${thisName()} won't let this device try again until ${clock(until)}.`
  const lockedSay = (fail, until) => fail(lockedWhy(until), 'locked', { until: new Date(until).toISOString() })
  // A session turned away, kept in the record as the ones that ran are.
  function record(s, end, more = {}) {
    const now = new Date().toISOString()
    conf.log = [...conf.log, { id: s.id, kind: 'screen', by: s.by, for: s.for, source: null, control: false, controlled: false, via: null, started: new Date(s.started).toISOString(), ended: now, seconds: 0, end, ...more, seen: false }].slice(-LOG_MAX)
    save()
    onChange()
  }
  // The next { t: name } the viewer sends, or null when it's gone or doesn't within ms.
  const answerOf = (ws, name, ms) => new Promise((resolve) => {
    let tm = null
    const done = (v) => { clearTimeout(tm); ws.off('message', on); ws.off('close', gone); resolve(v) }
    const on = (data, binary) => { if (binary) return; let m; try { m = JSON.parse(String(data)) } catch { return } if (m?.t === name) done(m) }
    const gone = () => done(null)
    tm = setTimeout(() => done(null), ms)
    ws.on('message', on)
    ws.on('close', gone)
    if (ws.readyState !== 1) done(null)
  })
  // Before anything of the screen is taken: a device locked out goes; the password, when one is set
  // (ACCESS.tries wrong, and that device is locked out); then Ask Here First, when it's on. True to go on.
  async function gate(s, fail) {
    const ws = s.viewer
    const lock = lockOf(s.by.id)
    if (lock) { lockedSay(fail, lock.until); return false }
    if (conf.password) {
      let wrong = false
      for (;;) {
        tell(ws, { t: 'password', wrong, left: ACCESS.tries - (conf.locks[s.by.id]?.fails || 0), tries: ACCESS.tries, lockMinutes: Math.round(LOCK_MS / 60000) || 1 })
        const m = await answerOf(ws, 'password', PASSWORD_WAIT_MS)
        if (!m) { if (s.tries) record(s, 'password', { tries: s.tries }); if (ws.readyState === 1) fail('The password wasn\'t typed in time. Try again.', 'timeout'); return false }
        if (!conf.password) break // taken off here meanwhile
        const now = lockOf(s.by.id)
        if (now) { lockedSay(fail, now.until); return false }
        if (await passwordMatches(conf.password, m.p)) { if (conf.locks[s.by.id]) { delete conf.locks[s.by.id]; save() } break }
        s.tries = (s.tries || 0) + 1
        const l = conf.locks[s.by.id] = { name: s.by.name, fails: (conf.locks[s.by.id]?.fails || 0) + 1, at: Date.now() }
        if (l.fails >= ACCESS.tries) {
          l.until = Date.now() + LOCK_MS
          l.fails = 0
          record(s, 'locked', { tries: s.tries, until: new Date(l.until).toISOString() })
          lockedSay(fail, l.until)
          return false
        }
        save()
        wrong = true
      }
    }
    if (conf.askFirst) {
      tell(ws, { t: 'asking', ms: ASK_MS, until: new Date(Date.now() + ASK_MS).toISOString() })
      const said = await askHere(s)
      if (said === 'gone') return false
      if (said !== 'allow') {
        record(s, said === 'deny' ? 'denied' : 'unanswered')
        fail(said === 'deny' ? `Someone at ${thisName()} said no to this.` : `Nobody at ${thisName()} answered within ${Math.round(ASK_MS / 1000)} seconds, so it wasn't allowed.`, said === 'deny' ? 'denied' : 'unanswered')
        return false
      }
    }
    return true
  }
  // Ask Here First: Allow or Deny here (the badge, Bridge AI's window), within ASK_MS.
  function askHere(s) {
    return new Promise((resolve) => {
      const a = { id: randomBytes(6).toString('base64url'), by: s.by, for: s.for, control: !!s.wants && controlOn(), at: Date.now(), until: Date.now() + ASK_MS }
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
      s.viewer.on('close', gone)
      asks.set(a.id, a)
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

  // ---------- a session ----------
  // A viewer's WebSocket (/api/remote/view?source=screen:<id>|window:<id>|page:<port>&control=1&p2p=1):
  // the session lasts as long as it's open.
  async function view(ws, req) {
    const q = new URL(req.url, 'http://x').searchParams
    const fail = (why, code, more = {}) => { tell(ws, { t: 'error', why, code, ...more }); setTimeout(() => { try { ws.close(1008, 'refused') } catch { /* closed */ } }, 50) }
    const dev = deviceOf(req.headers['x-bridge-relay'])
    if (!dev) return fail(`This is ${thisName()} itself: view its screen from another of your devices.`, 'here')
    if (!trialOn()) return fail(screenStatus().why, 'trial')
    const [kind, ...rest] = String(q.get('source') || 'screen:').split(':')
    const sid = rest.join(':')
    const s = {
      id: randomBytes(8).toString('base64url'), viewer: ws, started: Date.now(),
      by: { id: dev.id, name: clean(dev.name) || 'A device', kind: dev.kind || 'phone' },
      for: dev.kind === 'computer' ? clean(q.get('for')) || null : null,
      kind: kind === 'page' ? 'page' : 'screen', via: null, controlled: false, frames: 0, acked: true, pending: null, sent: 0,
      slow: q.get('slow') === '1', p2p: q.get('p2p') === '1', wants: q.get('control') === '1', lastInput: Date.now(),
    }
    if (!allows(dev.id)) { record(s, 'device'); return fail(`${thisName()} doesn't let ${s.by.name} connect. That's changed at ${thisName()} itself, in Settings › Account & Devices › Computers.`, 'device') }
    if (s.kind === 'page') {
      const port = Number(sid)
      if (!(port > 1023 && port < 65536) || !(await isDevPort(port))) return fail(`Port ${sid} isn't one of the apps ${thisName()} serves.`, 'port')
      if (!desktopOpen() && !FAKE) return fail(`Open the Bridge AI app on ${thisName()} to see its apps on a phone: they're drawn there.`, 'noApp')
      s.source = { kind: 'page', port, name: `:${port}` }
      s.provider = FAKE && !desktopOpen() ? 'fake' : 'desktop'
      s.page = { w: Math.min(1600, Math.max(320, Number(q.get('w')) || 390)), h: Math.min(2400, Math.max(320, Number(q.get('h')) || 800)) }
      s.may = true // a page drawn off screen: what's clicked is that page, not this computer
    } else {
      const st = screenStatus()
      if (!st.can) return fail(st.why, st.code)
      // Nothing of the screen is taken (nor macOS asked about it) before the guardrails let it in.
      if (!(await gate(s, fail))) return
      if (!FAKE || capture) {
        try { await needCapture() } catch (e) { return fail(e.message, e.code) }
        // The capture page's first look is when macOS asks about Screen Recording (first use): turned
        // down, or not answered yet, it's said, and the question is on that screen.
        const after = screenStatus()
        if (!after.can) return fail(after.why, after.code)
      }
      const list = sourceList()
      const src = list.find((x) => x.id === sid && x.kind === (kind === 'window' ? 'window' : 'screen')) || (!sid ? list.find((x) => x.kind === 'screen' && x.primary) || list.find((x) => x.kind === 'screen') : null)
      if (!src) return fail(sid ? 'That screen or window isn\'t there any more. Pick another.' : `${thisName()} didn't say which screens it has. Try again in a moment.`, 'source')
      s.source = { kind: src.kind, id: src.id, name: src.name, bounds: src.bounds, w: src.w, h: src.h }
      s.provider = capture ? 'capture' : 'fake'
      // Control when it's on here and asked for (of a whole screen: where the pointer goes is known there).
      s.may = s.wants && controlOn() && (await input.status()).can
    }
    // The viewer went while this was being worked out: nothing to start.
    if (ws.readyState !== 1) return
    sessions.set(s.id, s)
    clearTimeout(idleTimer)
    s.entry = { id: s.id, kind: s.kind, by: s.by, for: s.for, source: { kind: s.source.kind, name: s.source.name, ...(s.source.port ? { port: s.source.port } : {}) }, control: ctl(s), controlled: false, via: null, started: new Date(s.started).toISOString(), ended: null, seconds: 0, end: null, seen: false }
    conf.log = [...conf.log, s.entry].slice(-LOG_MAX)
    save()
    if (ctl(s) && s.kind === 'screen') startSink()
    if (s.kind === 'screen') { s.idleCheck = setInterval(() => idleBack(s), Math.min(30000, Math.max(200, CONTROL_IDLE_MS / 5))); s.idleCheck.unref?.() }
    ws.on('message', (data, binary) => { if (!binary) { let m; try { m = JSON.parse(String(data)) } catch { return } fromViewer(s, m) } })
    ws.on('close', () => end(s, 'viewer'))
    const p2p = s.kind === 'screen' && s.provider === 'capture' && s.p2p && capture?.p2p
    tell(ws, {
      t: 'hello', session: s.id, name: thisName(), os, source: { kind: s.source.kind, id: s.source.id, name: s.source.name, w: s.source.w, h: s.source.h },
      sources: s.kind === 'screen' ? sourceList().map(forViewer) : [],
      p2p: p2p ? { ice: iceServers(process.env) } : null, rate: rate(s), control: controlInfo(s),
    })
    if (s.provider === 'capture') tell(capture.ws, { t: 'start', session: s.id, source: s.source, p2p: p2p ? { ice: iceServers(process.env) } : null, rate: rate(s), max: MAX_FRAME })
    else if (s.provider === 'desktop') toDesktop({ t: 'page-start', session: s.id, port: s.source.port, w: s.page.w, h: s.page.h, rate: rate(s) })
    else fakeFrames(s)
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
  async function takeControl(s) {
    const st = controlOn() ? await input.status() : null
    if (!sessions.has(s.id)) return
    if (!st?.can) return tell(s.viewer, { t: 'control', ...controlInfo(s), ...(st?.why ? { why: st.why } : {}) })
    s.may = true
    s.idled = false
    s.lastInput = Date.now()
    if (ctl(s)) { s.entry.control = true; save(); startSink() }
    tell(s.viewer, { t: 'control', ...controlInfo(s) })
    toBadge()
    onChange()
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
    if (!s.controlled) { s.controlled = true; s.entry.controlled = true; save(); if (s.kind === 'screen') toBadge() }
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
    if (error) tell(s.viewer, { t: 'error', why: error, code: why })
    if (why === 'here') tell(s.viewer, { t: 'ended', why: 'here', text: `Stopped on ${thisName()}.` })
    try { if (s.viewer.readyState <= 1) s.viewer.close(1000, why) } catch { /* closed */ }
    if (s.provider === 'capture') tell(capture?.ws, { t: 'stop', session: s.id })
    if (s.provider === 'desktop') toDesktop({ t: 'page-stop', session: s.id })
    if (s.kind === 'screen' && s.may) sink?.releaseAll(s.source.bounds)
    stopSinkIfIdle()
    Object.assign(s.entry, { ended: new Date().toISOString(), seconds: Math.round((Date.now() - s.started) / 1000), end: why, ...(error ? { error: clean(error, 300) } : {}), controlled: s.controlled, via: s.via })
    save()
    idleLater()
    toBadge()
    onChange()
  }
  const stop = (id) => { const s = sessions.get(id); if (!s) throw Object.assign(new Error('That session has ended'), { status: 404 }); end(s, 'here'); return true }
  const stopAll = () => { for (const s of [...sessions.values()]) end(s, 'here'); for (const a of [...asks.values()]) a.done('deny') }

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
    controlChanged()
    return accessStatus()
  }
  // Taken off: control needs it, so control goes off too.
  function clearPassword() {
    conf.password = null
    conf.control = false
    save()
    controlChanged()
    return accessStatus()
  }
  function setAskFirst(on) { conf.askFirst = !!on; save(); onChange(); return accessStatus() }
  // Unticked: it can't connect, and a session of its going now ends.
  function setDevice(id, allowed) {
    if (!devices().some((d) => d.id === id)) throw Object.assign(new Error('That device isn\'t paired with this computer.'), { status: 404 })
    conf.blocked = allowed ? conf.blocked.filter((x) => x !== id) : [...new Set([...conf.blocked, id])]
    save()
    if (!allowed) {
      for (const s of [...sessions.values()]) if (s.by.id === id) end(s, 'device', `${thisName()} stopped letting this device connect.`)
      for (const a of [...asks.values()]) if (a.by.id === id) a.done('deny')
    }
    onChange()
    return accessStatus()
  }
  function unlock(id) { if (conf.locks[id]) { delete conf.locks[id]; save(); onChange() } return accessStatus() }

  // What you've seen of who looked while you were away.
  function seen() { for (const e of conf.log) e.seen = true; save(); onChange(); return { ok: true } }

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

  return { status, setControl, setPassword, clearPassword, setAskFirst, setDevice, unlock, answer, allows, stop, stopAll, seen, upgrade, isPath, onDesktop, pageFrame, trialChanged, desktopOpen, active: () => sessions.size }
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
