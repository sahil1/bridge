// Remote Screen and Preview (a Beta Feature, src/trials.js): this computer's screen, and the apps
// its agents serve, seen from your other devices, and controlled from them once you allow it here.
//
// Who: only your own devices, paired with this computer (relay.js): each session comes over the
// device's encrypted link (a WebSocket through relay.js, or through another of your computers that
// is linked to this one, machines.js), and the relay sees only sealed messages. Never from this
// computer's own page (there's nothing to see from here), never from a web page.
//
// Viewing needs nobody at this computer (it's yours): it shows that it's being viewed (the desktop
// app's badge, on top of everything, with Stop; and a line in Bridge AI itself), and afterwards says
// who looked, when and for how long, until you've seen it. Control is off until you turn on "Let my
// other devices control this computer" here, which on a Mac asks for Accessibility then; and while
// someone here moves the mouse or presses a key, remote input waits a moment (remoteinput.js).
// Every session (who, from which device, what, when, how long, whether it controlled anything, and
// how it came) is kept in ~/.bridge-ai/remote.json, the last 200, and shown in Settings.
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
import { randomBytes } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { dataFile, ensureDir, writeFileAtomic } from './paths.js'
import * as input from './remoteinput.js'
import { cleanInput, iceServers, RATE, MAX_FRAME, PAUSE_MS, packFrame } from '../shared/remote.js'

const FILE = dataFile('remote.json')
const LOG_MAX = 200
const FAKE = process.env.BRIDGE_TEST_SCREEN === 'fake'
const CAPTURE_WAIT_MS = Number(process.env.BRIDGE_REMOTE_CAPTURE_WAIT_MS) || 8000
const IDLE_MS = 5 * 60000 // the capture window, with nothing to capture, closes after this long
const clean = (s, n = 60) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '')

const read = () => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { control: d.control === true, log: Array.isArray(d.log) ? d.log.slice(-LOG_MAX) : [] } } catch { return { control: false, log: [] } } }

// trialOn(): the Beta Feature is on here. deviceOf(id): a device paired here (relay.js), or null.
// thisName(): this computer's name. os: 'mac' | 'windows' | 'linux'. hosted(): this computer's relay
// is Bridge AI's (each message counts against the account's allowance). isDevPort(port): one of
// this computer's dev servers (servers.js). screenAllowed(): on a Mac, whether macOS lets Bridge AI
// record the screen, looked at without asking (calls.js screen). onChange(): what Bridge AI shows
// of this changed.
export function makeRemote({ trialOn, deviceOf, thisName, os, hosted = () => false, isDevPort = async () => false, screenAllowed = async () => null, onChange = () => {} }) {
  let conf = read()
  const save = () => { ensureDir(path.dirname(FILE)); writeFileAtomic(FILE, JSON.stringify(conf, null, 2), { mode: 0o600 }) }
  const sessions = new Map() // id -> session
  const desktops = new Set() // the desktop app's own feeds (index.js /api/events): fn(event)
  let capture = null // the capture page: { ws, sources, permission, p2p, at }
  let captureWaiters = []
  let idleTimer = null
  let sink = null // what presses keys here, while anything controls this computer
  let sinkError = null
  let pausedUntil = 0

  const desktopOpen = () => desktops.size > 0
  const toDesktop = (ev) => { for (const fn of desktops) { try { fn(ev) } catch { /* gone */ } } }
  const tell = (ws, msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)) }
  const rate = (s) => Math.min(s.slow || hosted() ? RATE.hosted : RATE.own, s.kind === 'page' ? RATE.own : 99)

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
  async function controlStatus(o) {
    const st = await input.status(o)
    return { on: conf.control, ...st, ...(sinkError === 'accessibility' ? { allowed: false } : {}) }
  }
  async function status({ sources = false } = {}) {
    if (sources && trialOn() && !capture && desktopOpen()) await needCapture().catch(() => {})
    else if (sources && capture) await askSources().catch(() => {})
    // macOS asks about Screen Recording the first time the screen is taken (someone looks), never
    // before; until then, whether it's allowed, as macOS says without asking.
    const screen = screenStatus()
    if (os === 'mac' && !screen.permission && trialOn()) { const a = await screenAllowed().catch(() => null); if (a != null) screen.permission = a ? 'ok' : 'ask' }
    return {
      on: trialOn(), name: thisName(), os,
      screen,
      control: await controlStatus(),
      preview: { can: trialOn() && (desktopOpen() || FAKE), why: !trialOn() ? null : desktopOpen() || FAKE ? null : desktopNeeded() },
      paused: pausedUntil > Date.now(),
      sessions: [...sessions.values()].map(shown),
      log: conf.log.slice(-50).reverse(),
      unseen: conf.log.filter((e) => !e.seen && e.kind === 'screen' && e.ended).reverse(),
    }
  }
  const shown = (s) => ({ id: s.id, kind: s.kind, by: s.by, for: s.for, source: { kind: s.source.kind, name: s.source.name, port: s.source.port }, control: s.control, controlled: s.controlled, via: s.via, started: new Date(s.started).toISOString() })

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
    capture = { ws, sources: null, permission: null, p2p: false, at: Date.now() }
    if (was && was.ws !== ws) try { was.ws.close(1000, 'replaced') } catch { /* closed */ }
    ws.on('message', (data, binary) => {
      if (binary) {
        const s = sessions.get(capture?.next)
        if (s) frameIn(s, data)
        return
      }
      let m
      try { m = JSON.parse(String(data)) } catch { return }
      if (m.t === 'hello' || m.t === 'sources') {
        capture.sources = Array.isArray(m.sources) ? m.sources.slice(0, 40).map(cleanSource).filter(Boolean) : []
        capture.permission = typeof m.permission === 'string' ? m.permission : null
        capture.p2p = m.p2p === true
        if (m.t === 'hello') { for (const w of captureWaiters.splice(0)) w.resolve(capture); idleLater() }
        for (const w of sourceWaiters.splice(0)) w()
        onChange()
        return
      }
      const s = sessions.get(m.session)
      if (!s || s.provider !== 'capture') return
      if (m.t === 'frame') { capture.next = s.id; return }
      if (m.t === 'offer' || m.t === 'ice') return tell(s.viewer, { t: m.t, ...(m.sdp ? { sdp: String(m.sdp) } : {}), ...(m.c ? { c: m.c } : {}) })
      if (m.t === 'started') { s.size = { w: m.w | 0, h: m.h | 0 }; return tell(s.viewer, { t: 'size', w: s.size.w, h: s.size.h }) }
      if (m.t === 'input') return applyInput(s, m.evs)
      if (m.t === 'error') return end(s, 'error', clean(m.why, 300) || 'The screen couldn\'t be shared')
    })
    ws.on('close', () => {
      if (capture?.ws !== ws) return
      capture = null
      for (const s of [...sessions.values()]) if (s.provider === 'capture') end(s, 'lost', `The Bridge AI app on ${thisName()} stopped sharing its screen.`)
      onChange()
    })
  }
  const cleanSource = (x) => {
    if (!x || typeof x.id !== 'string') return null
    const b = x.bounds && Number.isFinite(x.bounds.width) ? { x: +x.bounds.x || 0, y: +x.bounds.y || 0, width: +x.bounds.width, height: +x.bounds.height, ...(x.bounds.px && Number.isFinite(x.bounds.px.width) ? { px: { x: +x.bounds.px.x || 0, y: +x.bounds.px.y || 0, width: +x.bounds.px.width, height: +x.bounds.px.height } } : {}) } : null
    return { id: x.id.slice(0, 120), name: clean(x.name, 80) || 'Screen', kind: x.kind === 'window' ? 'window' : 'screen', w: x.w | 0, h: x.h | 0, primary: !!x.primary, bounds: b }
  }

  // ---------- a session ----------
  // A viewer's WebSocket (/api/remote/view?source=screen:<id>|window:<id>|page:<port>&control=1&p2p=1):
  // the session lasts as long as it's open.
  async function view(ws, req) {
    const q = new URL(req.url, 'http://x').searchParams
    const fail = (why, code) => { tell(ws, { t: 'error', why, code }); setTimeout(() => { try { ws.close(1008, 'refused') } catch { /* closed */ } }, 50) }
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
      slow: q.get('slow') === '1', p2p: q.get('p2p') === '1',
    }
    if (s.kind === 'page') {
      const port = Number(sid)
      if (!(port > 1023 && port < 65536) || !(await isDevPort(port))) return fail(`Port ${sid} isn't one of the apps ${thisName()} serves.`, 'port')
      if (!desktopOpen() && !FAKE) return fail(`Open the Bridge AI app on ${thisName()} to see its apps on a phone: they're drawn there.`, 'noApp')
      s.source = { kind: 'page', port, name: `:${port}` }
      s.provider = FAKE && !desktopOpen() ? 'fake' : 'desktop'
      s.page = { w: Math.min(1600, Math.max(320, Number(q.get('w')) || 390)), h: Math.min(2400, Math.max(320, Number(q.get('h')) || 800)) }
      s.control = true // a page drawn off screen: what's clicked is that page, not this computer
    } else {
      const st = screenStatus()
      if (!st.can) return fail(st.why, st.code)
      if (!FAKE || capture) {
        try { await needCapture() } catch (e) { return fail(e.message, e.code) }
      }
      const list = capture?.sources || FAKE_SOURCES
      const src = list.find((x) => x.id === sid && x.kind === (kind === 'window' ? 'window' : 'screen')) || (!sid ? list.find((x) => x.kind === 'screen' && x.primary) || list.find((x) => x.kind === 'screen') : null)
      if (!src) return fail(sid ? 'That screen or window isn\'t there any more. Pick another.' : `${thisName()} didn't say which screens it has. Try again in a moment.`, 'source')
      s.source = { kind: src.kind, id: src.id, name: src.name, bounds: src.bounds, w: src.w, h: src.h }
      s.provider = capture ? 'capture' : 'fake'
      // Control only of a whole screen (where the pointer goes is known there), when it's on here and asked for.
      s.control = q.get('control') === '1' && conf.control && s.source.kind === 'screen' && (await input.status()).can
    }
    sessions.set(s.id, s)
    clearTimeout(idleTimer)
    s.entry = { id: s.id, kind: s.kind, by: s.by, for: s.for, source: { kind: s.source.kind, name: s.source.name, ...(s.source.port ? { port: s.source.port } : {}) }, control: !!s.control, controlled: false, via: null, started: new Date(s.started).toISOString(), ended: null, seconds: 0, end: null, seen: false }
    conf.log = [...conf.log, s.entry].slice(-LOG_MAX)
    save()
    if (s.control) startSink()
    ws.on('message', (data, binary) => { if (!binary) { let m; try { m = JSON.parse(String(data)) } catch { return } fromViewer(s, m) } })
    ws.on('close', () => end(s, 'viewer'))
    const p2p = s.kind === 'screen' && s.provider === 'capture' && s.p2p && capture?.p2p
    tell(ws, {
      t: 'hello', session: s.id, name: thisName(), os, source: { kind: s.source.kind, name: s.source.name, w: s.source.w, h: s.source.h },
      sources: s.kind === 'screen' ? (capture?.sources || FAKE_SOURCES).map(({ id, name, kind: k, w, h, primary }) => ({ id, name, kind: k, w, h, primary })) : [],
      p2p: p2p ? { ice: iceServers(process.env) } : null, rate: rate(s), control: { on: conf.control, allowed: !!s.control, why: s.kind === 'screen' && !s.control ? controlWhy(s) : null },
    })
    if (s.provider === 'capture') tell(capture.ws, { t: 'start', session: s.id, source: s.source, p2p: p2p ? { ice: iceServers(process.env) } : null, rate: rate(s), max: MAX_FRAME })
    else if (s.provider === 'desktop') toDesktop({ t: 'page-start', session: s.id, port: s.source.port, w: s.page.w, h: s.page.h, rate: rate(s) })
    else fakeFrames(s)
    if (!p2p) via(s, 'relay')
    toDesktop({ t: 'sessions', list: [...sessions.values()].filter((x) => x.kind === 'screen').map(shown) })
    onChange()
  }
  const controlWhy = (s) => (!conf.control ? `Control is off on ${thisName()}. Turn on "Let my other devices control this computer" there, in Settings › Account & Devices › Computers.` : s.source.kind !== 'screen' ? 'Control works on a whole screen: pick one of the screens to control it.' : null)
  const via = (s, how) => { if (s.via === how) return; s.via = how; s.entry.via = how; save(); onChange() }

  function fromViewer(s, m) {
    if (m.t === 'answer' || m.t === 'ice') { if (s.provider === 'capture') tell(capture?.ws, { t: m.t, session: s.id, ...(m.sdp ? { sdp: String(m.sdp) } : {}), ...(m.c ? { c: m.c } : {}) }); return }
    if (m.t === 'p2p' && m.state === 'connected') return via(s, 'p2p')
    if (m.t === 'fallback') { via(s, 'relay'); if (s.provider === 'capture') tell(capture?.ws, { t: 'fallback', session: s.id, rate: rate(s), max: MAX_FRAME }); return }
    if (m.t === 'ack') { s.acked = true; sendPending(s); return }
    if (m.t === 'input') return applyInput(s, m.evs)
    if (m.t === 'clip' || m.t === 'clip?') return clip(s, m)
    if (m.t === 'go' && s.kind === 'page' && typeof m.path === 'string' && m.path.startsWith('/') && !m.path.startsWith('//')) { s.path = m.path.slice(0, 2000); if (s.provider === 'desktop') toDesktop({ t: 'page-go', session: s.id, path: s.path }); return }
    if (m.t === 'resize' && s.kind === 'page') { s.page = { w: Math.min(1600, Math.max(320, Number(m.w) || s.page.w)), h: Math.min(2400, Math.max(320, Number(m.h) || s.page.h)) }; if (s.provider === 'desktop') toDesktop({ t: 'page-resize', session: s.id, ...s.page }) }
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
  // A picture from the desktop app's page window (POST /api/remote/sessions/:id/frame).
  function pageFrame(id, { type, w, h, body }) {
    const s = sessions.get(id)
    if (!s || s.kind !== 'page') return false
    frameIn(s, Buffer.from(packFrame(type, w, h, body)))
    return true
  }

  // ---------- input ----------
  function startSink() {
    if (sink) return
    sinkError = null
    sink = input.start({
      onLocal: () => {
        pausedUntil = Date.now() + PAUSE_MS
        sink?.releaseAll()
        for (const s of sessions.values()) if (s.control && s.kind === 'screen') tell(s.viewer, { t: 'paused', ms: PAUSE_MS, why: 'local' })
        onChange()
      },
      onError: (e) => {
        sinkError = e
        for (const s of sessions.values()) if (s.control && s.kind === 'screen') tell(s.viewer, { t: 'error', code: e === 'accessibility' ? 'accessibility' : 'input', why: e === 'accessibility' ? `macOS doesn't let Bridge AI control ${thisName()}. On ${thisName()}, turn on Bridge AI in System Settings › Privacy & Security › Accessibility.` : `Control stopped on ${thisName()}: ${e}`, keep: true })
      },
    })
  }
  function stopSinkIfIdle() {
    if (!sink || [...sessions.values()].some((s) => s.control && s.kind === 'screen')) return
    sink.stop()
    sink = null
  }
  function applyInput(s, evs) {
    if (!Array.isArray(evs) || !s.control) return
    if (s.kind === 'screen' && Date.now() < pausedUntil) return
    const list = evs.slice(0, 200).map(cleanInput).filter(Boolean)
    if (!list.length) return
    if (!s.controlled) { s.controlled = true; s.entry.controlled = true; save() }
    if (s.kind === 'page') {
      if (s.provider === 'desktop') toDesktop({ t: 'page-input', session: s.id, evs: list })
      else if (process.env.BRIDGE_TEST_INPUT) for (const ev of list) fs.appendFileSync(process.env.BRIDGE_TEST_INPUT, `${JSON.stringify({ page: s.source.port, ...ev })}\n`)
      return
    }
    startSink()
    for (const ev of list) sink.send(ev, s.source.bounds)
  }
  async function clip(s, m) {
    if (!s.control || s.kind !== 'screen') return tell(s.viewer, { t: 'error', code: 'clipboard', why: controlWhy(s) || 'The clipboard goes along only while you control the computer.', keep: true })
    try {
      if (m.t === 'clip') { await input.writeClipboard(String(m.text ?? '')); tell(s.viewer, { t: 'clip-sent', n: String(m.text ?? '').length }) } else tell(s.viewer, { t: 'clip', text: (await input.readClipboard()).slice(0, 1_000_000) })
    } catch (e) { tell(s.viewer, { t: 'error', code: 'clipboard', why: e.message, keep: true }) }
  }

  // ---------- the end ----------
  function end(s, why, error = null) {
    if (!sessions.delete(s.id)) return
    clearTimeout(s.fakeTimer)
    clearTimeout(s.waitTimer)
    if (error) tell(s.viewer, { t: 'error', why: error, code: why })
    if (why === 'here') tell(s.viewer, { t: 'ended', why: 'here', text: `Stopped on ${thisName()}.` })
    try { if (s.viewer.readyState <= 1) s.viewer.close(1000, why) } catch { /* closed */ }
    if (s.provider === 'capture') tell(capture?.ws, { t: 'stop', session: s.id })
    if (s.provider === 'desktop') toDesktop({ t: 'page-stop', session: s.id })
    if (s.control) { sink?.releaseAll(s.source.bounds); stopSinkIfIdle() }
    Object.assign(s.entry, { ended: new Date().toISOString(), seconds: Math.round((Date.now() - s.started) / 1000), end: why, ...(error ? { error: clean(error, 300) } : {}), controlled: s.controlled, via: s.via })
    save()
    idleLater()
    toDesktop({ t: 'sessions', list: [...sessions.values()].filter((x) => x.kind === 'screen').map(shown) })
    onChange()
  }
  const stop = (id) => { const s = sessions.get(id); if (!s) throw Object.assign(new Error('That session has ended'), { status: 404 }); end(s, 'here'); return true }
  const stopAll = () => { for (const s of [...sessions.values()]) end(s, 'here') }

  // ---------- control, turned on or off here ----------
  async function setControl(on) {
    if (on) {
      const st = await input.status({ fresh: true })
      if (!st.can) throw Object.assign(new Error(st.why), { status: 400, code: 'controlUnavailable' })
    }
    conf.control = !!on
    save()
    for (const s of sessions.values()) {
      if (s.kind !== 'screen') continue
      if (!on && s.control) { s.control = false; tell(s.viewer, { t: 'control', allowed: false, on: false, why: controlWhy(s) }) } else tell(s.viewer, { t: 'control', allowed: !!s.control, on: conf.control, why: s.control ? null : on ? 'Control is on now: start viewing again to control.' : controlWhy(s) })
    }
    if (!on) { sink?.releaseAll(); stopSinkIfIdle() }
    toDesktop({ t: 'control', on: conf.control })
    onChange()
    return controlStatus({ fresh: true })
  }

  // What you've seen of who looked while you were away.
  function seen() { for (const e of conf.log) e.seen = true; save(); onChange(); return { ok: true } }

  // ---------- test stand-in: pictures made here ----------
  function fakeFrames(s) {
    const tick = () => {
      if (!sessions.has(s.id)) return
      const n = s.frames + 1
      const [w, h] = s.kind === 'page' ? [s.page.w, s.page.h] : [s.source.w || 1280, s.source.h || 800]
      const label = s.kind === 'page' ? `Preview of port ${s.source.port}` : `${s.source.name}`
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="hsl(${(n * 37) % 360},55%,42%)"/><text x="50%" y="50%" font-family="sans-serif" font-size="${Math.round(h / 12)}" fill="#fff" text-anchor="middle">${label.replace(/[<&>]/g, '')} · ${n}</text></svg>`
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
    fn({ t: 'control', on: conf.control })
    if (sessions.size) fn({ t: 'sessions', list: [...sessions.values()].filter((x) => x.kind === 'screen').map(shown) })
    onChange()
    return () => { desktops.delete(fn); onChange() }
  }

  // Trial turned off: every session ends.
  function trialChanged() { if (!trialOn()) for (const s of [...sessions.values()]) end(s, 'off', 'Remote Screen and Preview was turned off on this computer.') }

  return { status, setControl, stop, stopAll, seen, upgrade, isPath, onDesktop, pageFrame, trialChanged, desktopOpen, active: () => sessions.size }
}

// The test stand-in's screens.
const FAKE_SOURCES = [
  { id: 'fake-1', name: 'Test screen', kind: 'screen', w: 1280, h: 800, primary: true, bounds: { x: 0, y: 0, width: 1280, height: 800 } },
  { id: 'fake-2', name: 'Second screen', kind: 'screen', w: 1024, h: 768, bounds: { x: 1280, y: 0, width: 1024, height: 768 } },
  { id: 'fake-w1', name: 'Test window', kind: 'window', w: 800, h: 600 },
]
