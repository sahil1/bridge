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
//   which devices           every paired phone and linked computer may, until it's unticked here.
//                           One you untick can't use this computer at all (no agents, terminals,
//                           files, previews or screen: letin.js), with this Beta Feature on or off.
//                           Once any guardrail is set, one paired after that starts New (in Needs
//                           You with Allow), and waits while this Beta Feature is on. Through
//                           another of your computers, that computer checks its own list first,
//                           then this one checks that computer and the device it's for (shutFor).
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
// Starting it: the desktop app is waited for while it's expected (just started, reopening), and the
// capture page for as long as a cold start takes (it connects, then says which screens there are),
// a fresh one asked for once when it doesn't. What can't be got past is said to the device as it is,
// with what fixes it (Open or Reopen Bridge AI here, Allow Screen Recording here), carried out once
// it's past the guardrails and chosen (screenFor), only while it's still let in as it was then, one
// of each at a time, and told to your other devices as a session is; and a line in this server's
// log (a few a minute from one device, none for one not let in). Meanwhile the session is shown here
// with Stop, and ends as one viewing does (Stop, a new password, Ask Here First turned on, Remote
// Screen off). Open Bridge AI only with a Remote Access Password set, and not once you quit the app
// here yourself, until it's opened here. The capture page comes in with a token given to the app
// for it, once, and only from this computer.
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
// The capture page starting: this long for it to connect, and as long again, once it has, for it to
// say which screens there are (a cold start opens a window and loads Bridge AI's page in it first,
// and macOS can be slow to list the screens).
const CAPTURE_WAIT_MS = Number(process.env.BRIDGE_REMOTE_CAPTURE_WAIT_MS) || 10000
// The desktop app reporting in when it's expected to (this server just started or its feed just
// dropped: the app connects again every few seconds), and after it was asked to reopen or opened.
const APP_BACK_MS = Number(process.env.BRIDGE_REMOTE_APP_BACK_MS) || 20000
const REOPEN_MS = Number(process.env.BRIDGE_REMOTE_REOPEN_MS) || 60000
// A fix offered in a session (Reopen Bridge AI there, say): chosen within this, or the session goes.
const FIX_MS = 60000
// Someone at this computer turning on Screen Recording for Bridge AI, once a device asked for it.
const ALLOW_MS = Number(process.env.BRIDGE_REMOTE_ALLOW_MS) || 3 * 60000
// What a session ends with when a guardrail turned it away, or this computer said no (said in Screen
// Activity, not the log).
const GUARDED = new Set([...REFUSALS, 'timeout', 'busy', 'here', 'changed', 'trial', 'off'])
// The capture page's way in (a token in need-capture, put in its window's address): good this long,
// once. BRIDGE_TEST_CAPTURE_TOKEN: the tests' own, good every time.
const TOKEN_MS = 2 * 60000
const TEST_TOKEN = process.env.BRIDGE_FIX_DRYRUN === '1' ? process.env.BRIDGE_TEST_CAPTURE_TOKEN || null : null
// Lines a device's tries can put in the log: this many a minute, each device; and through another of
// your computers, its own and all it speaks for together, this many.
const LOG_PER_MINUTE = 10
const LOG_PER_HOP = 20
// You quit the desktop app here and it couldn't say so to this server (desktop/main.js): it left this.
const QUIT_MARK = dataFile('remote-quit.json')
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
    // Kept apart: blocked, kept out by you (in the list, Keep Out, Block This Device); fresh, New
    // (paired once a guardrail was set, not let in yet). One from before kept both in blocked.
    const fresh = ids(d.fresh)
    const through = d.through && typeof d.through === 'object' && !Array.isArray(d.through) ? d.through : {}
    return {
      control: d.control === true,
      password: d.password && typeof d.password.hash === 'string' && typeof d.password.salt === 'string' ? d.password : null,
      askFirst: d.askFirst === true,
      blocked: ids(d.blocked).filter((x) => !fresh.includes(x)),
      known: Array.isArray(d.known) ? ids(d.known) : null,
      fresh,
      // The keys of the devices you kept out: one paired again with the same key is kept out again.
      outKeys: Array.isArray(d.outKeys) ? d.outKeys.filter((v) => typeof v === 'string' && v.length <= 200).slice(-500) : [],
      through: Object.fromEntries(Object.entries(through).filter(([k, v]) => /^[\w-]{1,40}\/[\w-]{1,40}$/.test(k) && v && typeof v === 'object').slice(-100)),
      notify: d.notify !== false,
      // When you quit the desktop app here yourself: Open Bridge AI isn't offered to a device until
      // it's opened here again.
      quit: typeof d.quit === 'string' ? d.quit : null,
      locks: d.locks && typeof d.locks === 'object' && !Array.isArray(d.locks) ? d.locks : {},
      log: all.filter((e) => !turned(e)).slice(-LOG_MAX),
      refused: [...all.filter(turned), ...(Array.isArray(d.refused) ? d.refused : [])].slice(-REFUSED_MAX),
    }
  } catch { return { control: false, password: null, askFirst: false, blocked: [], known: null, fresh: [], outKeys: [], through: {}, notify: true, quit: null, locks: {}, log: [], refused: [] } }
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
// paired here ({ id, name, kind }, relay.js); byKey(key): the one paired with that key, or null.
// onChange(): what Bridge AI shows of this changed. onBlocked(id): a device unticked here (an id, or
// hop/id for one through another of your computers), whose terminals, copies and sessions through
// this computer to another end too.
// tell(event): your other devices told of a session, control taken or an ask (screentell.js), and
// what became of it ({ sent, computers }). notifyTo(): where that goes, for Settings. blockThere(hop,
// id): a device that came through another of your computers (hop, its device here) blocked there.
// version: this Bridge AI's (a device offers Update to one older than its own). openApp(): the
// desktop app opened here when it isn't (index.js), or null where there's none to open (from a
// terminal); log(line): a line in this server's log. here(req): the request is this computer's own
// page (not a device's, nor Tailscale's): index.js atThisComputer.
export function makeRemote({ trialOn, deviceOf, thisName, os, hosted = () => false, isDevPort = async () => false, screenAllowed = async () => null, devices = () => [], byKey = () => null, onChange = () => {}, onBlocked = () => {}, tell: tellDevices = async () => null, notifyTo = () => ({}), blockThere = async () => null, version = null, openApp = null, log: logOut = (line) => console.log(line), here = (req) => !req.headers['x-bridge-relay'] }) {
  // One line each, whatever is in it: nothing in it starts another.
  const log = (line) => logOut(String(line).replace(/[\r\n\u2028\u2029]+/g, ' '))
  let conf = read()
  const save = () => { ensureDir(path.dirname(FILE)); writeFileAtomic(FILE, JSON.stringify(conf, null, 2), { mode: 0o600 }) }
  // Control turned on before it needed a password: off, so setting one later doesn't turn it back on.
  if (conf.control && !conf.password) { conf.control = false; save() }
  const sessions = new Map() // id -> session
  const desktops = new Set() // the desktop app's own feeds (index.js /api/events): fn(event)
  // The capture page once it's connected: { ws, ready (it said which screens there are), old (its app
  // went, or is going: reopening, quitting, or its window closing as idle), sources, permission,
  // none, problem, p2p, listed (how many times it has said), at }. Only one ready and not old is used.
  let capture = null
  const readyPage = () => (capture && capture.ready && !capture.old ? capture : null)
  let idleTimer = null
  let sink = null // what presses keys here, while anything controls this computer
  let sinkError = null
  let pausedUntil = 0
  const asks = new Map() // Ask Here First, waiting on an answer here: id -> ask
  const pending = new Set() // sessions at the password, or waiting for Allow
  // Sessions past the guardrails, their screen not started yet (waiting on the capture page, or on
  // a fix): what ends sessions ends these too, and they're shown with Stop as the others are.
  const opening = new Set()

  // What waits on the capture page or the desktop app (until): each is looked at again on any change.
  const waits = new Set()
  const poke = () => { for (const fn of [...waits]) fn() }
  const until = (test, ms) => new Promise((resolve) => {
    if (test()) return resolve(true)
    const done = (v) => { clearTimeout(tm); waits.delete(look); resolve(v) }
    const look = () => { if (test()) done(true) }
    const tm = setTimeout(() => done(!!test()), Math.max(0, ms))
    waits.add(look)
  })
  // The desktop app: open while its feed is, except a feed of the app that was asked to reopen,
  // until it's gone (or it didn't go within REOPEN_MS: then it's open after all). Expected to report
  // in soon: this server just started (the app connects its feed again every few seconds), its feed
  // just dropped, or it was asked to reopen, or opened, a moment ago.
  const started = Date.now()
  const app = { gone: 0, reopen: 0, opened: 0, came: 0 }
  const leaving = new Set()
  const desktopOpen = () => {
    if (leaving.size && Date.now() - app.reopen > REOPEN_MS) leaving.clear()
    return [...desktops].some((fn) => !leaving.has(fn))
  }
  const backBy = () => Math.max(started + APP_BACK_MS, app.gone + APP_BACK_MS, app.reopen + REOPEN_MS, app.opened + REOPEN_MS)
  const expected = () => !desktopOpen() && Date.now() < backBy()
  const appBack = () => (desktopOpen() ? Promise.resolve(true) : until(desktopOpen, backBy() - Date.now()))
  const toDesktop = (ev) => { for (const fn of desktops) { try { fn(ev) } catch { /* gone */ } } }
  // One line in this server's log for each start that didn't work, and each thing done to make one
  // work: who (when it's for a device), and what it was. (Never what's on the screen, nor the password.)
  const whoSaid = (s) => (s.for ? `${s.by.name} (for ${s.for})` : s.by.name)
  const note = (s, what) => log(`${new Date().toISOString()} Remote Screen: ${s ? `${whoSaid(s)}: ` : ''}${what}`)
  // A device's tries: LOG_PER_MINUTE lines a minute each, at most, and LOG_PER_HOP for a computer
  // and every device it says it speaks for (s.key hop/id), by that computer (s.by.id, the one paired
  // here). The oldest kept go first past 500.
  const saidBy = new Map() // device key -> when it put a line in, the last minute's
  const recent = (k, now) => (saidBy.get(k) || []).filter((x) => now - x < 60000)
  const mayNote = (s) => {
    const now = Date.now()
    const hop = s.by.id
    const mine = recent(s.key, now)
    const all = [...saidBy.keys()].filter((k) => k === hop || k.startsWith(`${hop}/`)).reduce((n, k) => n + recent(k, now).length, 0)
    if (mine.length >= LOG_PER_MINUTE || all >= LOG_PER_HOP) return false
    saidBy.delete(s.key)
    saidBy.set(s.key, [...mine, now])
    while (saidBy.size > 500) saidBy.delete(saidBy.keys().next().value)
    return true
  }
  const tell = (ws, msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)) }
  const rate = (s) => Math.min(s.slow || hosted() ? RATE.hosted : RATE.own, s.kind === 'page' ? RATE.own : 99)
  // Control is on only with a password set (an older remote.json may have it on without one).
  const controlOn = () => conf.control && !!conf.password
  // Whether a session may press anything now: a page always (it's that app, not this computer); a
  // screen once it was allowed control, while it shows a whole screen (where the pointer goes is known).
  const ctl = (s) => (s.kind === 'page' ? !s.grant : !!s.may && s.source?.kind === 'screen')
  const watchers = () => [...sessions.values()].filter((x) => x.kind === 'screen')
  // The desktop app's badge: who sees this screen, and who asks to (Ask Here First).
  // (With those still connecting: past the guardrails, the screen not started yet, or waiting on a fix.)
  const badgeList = () => [...watchers().map(shown), ...[...opening].map(shownWaiting)]
  const toBadge = () => toDesktop({ t: 'sessions', list: badgeList(), asks: [...asks.values()].map(shownAsk) })

  // ---------- what can be seen and done here ----------
  const desktopNeeded = () => `Open the Bridge AI app on ${thisName()}: its screen can be seen while the app runs there.`
  // What fixes each, from another of your devices, past the guardrails: Open Bridge AI here (it
  // isn't running, and there's an app to open: only with a Remote Access Password set, as control
  // asks, and never once you quit the app here yourself, until it's opened here again), Allow
  // Screen Recording (System Settings, opened here for someone at this computer), Reopen Bridge AI here.
  const canOpen = () => !!conf.password && !conf.quit && typeof openApp === 'function' && !!openApp(false)
  const permissionWhy = () => `macOS doesn't let Bridge AI record the screen on ${thisName()}. On ${thisName()}, turn on Bridge AI in System Settings › Privacy & Security › Screen & System Audio Recording, then open Bridge AI again there.`
  function screenStatus() {
    if (!trialOn()) return { can: false, code: 'trial', why: `Remote Screen and Preview is off on ${thisName()}. Turn it on there in Settings › About & Updates › Beta Features.` }
    if (os === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !FAKE && !capture) return { can: false, code: 'noDisplay', why: `${thisName()} has no screen to show (Bridge AI runs there without a desktop, as on a server or in Docker).` }
    const permission = capture?.permission || null
    if (permission === 'denied' || permission === 'restricted') return { can: false, code: 'screenPermission', permission, why: permissionWhy(), ...(permission === 'denied' && os === 'mac' && desktopOpen() ? { fix: 'allow' } : {}) }
    if (capture || FAKE) return { can: true, permission, sources: readyPage() ? capture.sources : FAKE && !capture ? FAKE_SOURCES : null, p2p: !!capture?.p2p }
    // (The app just started, or is reopening: it's waited for, in the session.)
    if (desktopOpen() || expected()) return { can: true, permission, sources: null, p2p: true }
    return { can: false, code: 'noApp', why: desktopNeeded(), ...(canOpen() ? { fix: 'open' } : {}) }
  }
  const passwordFirst = () => `Control needs a Remote Access Password on ${thisName()}. Set one there in Settings › Account & Devices › Computers, then turn on "Let my other devices control this computer".`
  async function controlStatus(o) {
    const st = await input.status(o)
    return { on: controlOn(), ...st, ...(sinkError === 'accessibility' ? { allowed: false } : {}), ...(!conf.password ? { needs: 'password', ...(st.can ? { why: passwordFirst() } : {}) } : {}) }
  }
  const limits = () => ({ tries: ACCESS.tries, lockMinutes: Math.round(LOCK_MS / 60000) || 1, askSeconds: Math.round(ASK_MS / 1000), idleMinutes: Math.round(CONTROL_IDLE_MS / 60000) || 1, passwordMin: ACCESS.passwordMin })
  // The guardrails, as this computer itself sees them (never the password itself, nor its hash).
  // fresh: paired since a guardrail was set (New), so unticked until it's let in here. out: kept out
  // by you, which holds with this Beta Feature off too. Then the devices seen coming through another
  // of your computers (through: its name), each by that computer and its id there, as the lockout
  // keeps them (hop/id).
  function accessStatus() {
    sync()
    const locks = activeLocks()
    const list = devices()
    const lockOf_ = (id) => locks.find((l) => l.id === id)?.until || null
    const kindOf = (k) => (k === 'computer' ? 'computer' : 'phone')
    // older: a computer on a Bridge AI from before its devices were told apart from it (relay.js
    // builtOf), whose devices this list can't keep out apart from it; with its version.
    const own = list.map((d) => ({ id: d.id, name: clean(d.name) || 'A device', kind: kindOf(d.kind), allowed: !conf.blocked.includes(d.id) && !conf.fresh.includes(d.id), fresh: conf.fresh.includes(d.id), out: conf.blocked.includes(d.id), locked: lockOf_(d.id), ...(d.kind === 'computer' && !d.forDevices ? { older: true, version: d.version || null } : {}), k: deviceOf(d.id)?.key || null }))
    const via = Object.entries(conf.through).map(([key, v]) => {
      const hop = list.find((d) => d.id === key.split('/')[0])
      return hop && { id: key, name: clean(v.name) || 'A device', kind: kindOf(v.kind), through: clean(hop.name) || 'Another computer', allowed: !conf.blocked.includes(key) && !conf.fresh.includes(key), fresh: conf.fresh.includes(key), out: conf.blocked.includes(key), locked: lockOf_(key), k: v.key || null }
    }).filter(Boolean)
    // The same phone can be listed more than once (paired here, and through each of your other
    // computers it's paired with): same, the others that may be it, by its key or its name, for
    // Settings to offer keeping them out too. (Never the key itself.)
    const all = [...own, ...via]
    const named = (x) => x.name.trim().toLowerCase()
    const devicesShown = all.map(({ k, ...d }) => ({ ...d, same: all.filter((x) => x !== d && x.id !== d.id && ((k && x.k === k) || named(x) === named(d))).map((x) => x.id) }))
    return {
      password: !!conf.password, passwordAt: conf.password?.at || null,
      askFirst: !!conf.askFirst,
      devices: devicesShown,
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
    // (Started, and waited for a while: a session waits on the same start for the rest.)
    if (sources && !guarded && trialOn() && !readyPage() && desktopOpen()) await Promise.race([needCapture().catch(() => {}), new Promise((r) => { setTimeout(r, CAPTURE_WAIT_MS).unref?.() })])
    else if (sources && !guarded && readyPage()) await askSources().catch(() => {})
    // macOS asks about Screen Recording the first time the screen is taken (someone looks), never
    // before; until then, whether it's allowed, as macOS says without asking.
    const screen = screenStatus()
    // (Behind a guardrail, not even which screens: Which screen? comes in the session, past them.)
    if (device && screen.sources) screen.sources = guarded ? [] : screen.sources.map(forViewer)
    if (os === 'mac' && !screen.permission && trialOn()) { const a = await screenAllowed().catch(() => null); if (a != null) screen.permission = a ? 'ok' : 'ask' }
    const base = {
      on: trialOn(), name: thisName(), os, ...(version ? { version } : {}),
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
      sessions: [...[...sessions.values()].map(shown), ...[...opening].map(shownWaiting)],
      log: newest([...conf.log.slice(-50), ...conf.refused.slice(-50)]),
      unseen: newest([...conf.log.filter((e) => !e.seen && e.kind === 'screen' && e.ended), ...conf.refused.filter((e) => !e.seen)]),
    }
  }
  const shown = (s) => ({ id: s.id, kind: s.kind, by: s.by, for: s.for, source: { kind: s.source.kind, name: s.source.name, port: s.source.port }, control: ctl(s), controlled: s.controlled, via: s.via, started: new Date(s.started).toISOString(), told: s.told })
  const shownWaiting = (s) => ({ id: s.id, kind: 'screen', by: s.by, for: s.for, source: null, control: false, controlled: false, via: null, started: new Date(s.started).toISOString(), told: s.told, waiting: true })
  // Who asks, what kind of device and how it came (straight, or through which of your computers),
  // and what for: the screen (and control), or an app.
  const shownAsk = (a) => ({ id: a.id, by: a.by, for: a.for, ...(a.for ? { forKind: a.s?.forKind || 'phone' } : {}), control: a.control, ...(a.port ? { port: a.port } : {}), at: new Date(a.at).toISOString(), until: new Date(a.until).toISOString() })

  // ---------- the capture page ----------
  // The desktop app opens it when it's needed, and closes it once nothing has been seen for a while.
  // Ready once it has said which screens there are: before that, nothing is taken from it (nor is
  // the tests' stand-in's list used in its place). One start at a time, however many sessions wait on
  // it. Each try waits CAPTURE_WAIT_MS for the page to connect, and as long again once it has, for it
  // to list the screens; a try that gets neither asks the app for a fresh window (one that never
  // loaded, or hangs, closed first). The app not open: waited for while it's expected (expected).
  // Rejects with why: code noApp, or noCapture with cause window (the page never connected) or list
  // (it connected and never said which screens).
  // The capture page's way in: a token for each ask (need-capture), good once and for TOKEN_MS.
  const tokens = new Map() // token -> when it was given
  const tokenFor = () => {
    const now = Date.now()
    for (const [k, at] of tokens) if (now - at > TOKEN_MS) tokens.delete(k)
    while (tokens.size >= 8) tokens.delete(tokens.keys().next().value)
    const k = randomBytes(18).toString('base64url')
    tokens.set(k, now)
    return k
  }
  const needs = (more = {}) => ({ t: 'need-capture', token: tokenFor(), ...more })
  let starting = null
  function needCapture() {
    if (readyPage()) return Promise.resolve(capture)
    starting ||= startCapture().finally(() => { starting = null; poke(); idleLater() })
    return starting
  }
  async function startCapture() {
    let connected = false
    let tries = [false, true]
    // A page connected already, its screens on their way: those first, and a fresh one after.
    const was = capture && !capture.old ? capture : null
    if (was) {
      if (await until(() => was.ready || capture !== was, CAPTURE_WAIT_MS) && readyPage() === was) return was
      if (capture === was) { connected = true; tries = [true] }
    }
    for (const fresh of tries) {
      if (!(await appBack())) throw Object.assign(new Error(desktopNeeded()), { code: 'noApp' })
      const stale = fresh ? capture : null
      if (fresh) note(null, `the capture window didn't ${connected ? 'list the screens' : 'connect'} within ${Math.round(CAPTURE_WAIT_MS / 1000)} seconds: asked the app for a fresh one`)
      toDesktop(needs(fresh ? { fresh: true } : {}))
      const page = () => (capture && capture !== stale && !capture.old ? capture : null)
      await until(() => page() || !desktopOpen(), CAPTURE_WAIT_MS)
      const c = page()
      if (c) {
        connected = true
        if (await until(() => c.ready || capture !== c, CAPTURE_WAIT_MS) && readyPage() === c) return c
      }
      // (The app went meanwhile, reopening say: waited for, then asked again.)
      if (!desktopOpen()) { if (await appBack()) return startCapture(); throw Object.assign(new Error(desktopNeeded()), { code: 'noApp' }) }
    }
    throw Object.assign(new Error(connected ? `Bridge AI on ${thisName()} opened its screen sharing but never said which screens there are: ${os === 'mac' ? 'macOS' : os === 'windows' ? 'Windows' : 'the system'} didn't list them in time.` : `The Bridge AI app on ${thisName()} didn't open its screen sharing.`), { code: 'noCapture', cause: connected ? 'list' : 'window' })
  }
  // Its screens again: true once it has said (or false after ms).
  function askSources(ms = 4000) {
    const c = readyPage()
    if (!c) return Promise.resolve(false)
    const n = c.listed
    tell(c.ws, { t: 'sources?' })
    return until(() => capture !== c || c.listed > n, ms)
  }
  // Nothing to capture for a while: the window closes. Not while a session is starting (its screen
  // about to be taken), and from then on the page isn't ready (a session after it gets a new one).
  function idleLater() {
    clearTimeout(idleTimer)
    const busy = () => [...sessions.values()].some((s) => s.provider === 'capture') || opening.size > 0 || !!starting
    if (busy()) return
    idleTimer = setTimeout(() => { if (busy()) return; if (capture) capture.old = true; toDesktop({ t: 'capture-idle' }) }, IDLE_MS)
    idleTimer.unref?.()
  }
  function onCapture(ws) {
    const was = capture
    const c = { ws, ready: false, sources: null, permission: null, p2p: false, listed: 0, at: Date.now(), next: null }
    capture = c
    if (was && was.ws !== ws) try { was.ws.close(1000, 'replaced') } catch { /* closed */ }
    poke()
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
        // No screens: why, as far as the app could tell ('reopen': Screen Recording turned on since it
        // started), and what macOS said.
        c.none = m.none === 'reopen' || m.none === 'none' ? m.none : null
        c.problem = clean(m.problem, 200) || null
        c.p2p = m.p2p === true
        c.ready = true
        c.listed++
        if (m.t === 'hello') idleLater()
        poke()
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
      poke()
      onChange()
    })
  }
  const cleanSource = (x) => {
    if (!x || typeof x.id !== 'string') return null
    const b = x.bounds && Number.isFinite(x.bounds.width) ? { x: +x.bounds.x || 0, y: +x.bounds.y || 0, width: +x.bounds.width, height: +x.bounds.height, ...(x.bounds.px && Number.isFinite(x.bounds.px.width) ? { px: { x: +x.bounds.px.x || 0, y: +x.bounds.px.y || 0, width: +x.bounds.px.width, height: +x.bounds.px.height } } : {}) } : null
    return { id: x.id.slice(0, 120), name: clean(x.name, 80) || 'Screen', kind: x.kind === 'window' ? 'window' : 'screen', w: x.w | 0, h: x.h | 0, primary: !!x.primary, scale: Number.isFinite(x.scale) ? Math.min(8, Math.max(0.5, x.scale)) : null, bounds: b }
  }
  // (The tests' stand-in's only with no capture page: one that hasn't said yet has none.)
  const sourceList = () => (capture ? readyPage()?.sources || [] : FAKE ? FAKE_SOURCES : [])
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
  // Once any is set (a password, Ask Here First, a device you kept out), a device paired after that
  // starts unticked (New): let in here, it may connect. One you kept out stays counted when it unpairs
  // itself (its id stays in blocked), so the guardrail is yours to take off, not its. The devices
  // paired before this was kept are known.
  const guarded = () => !!conf.password || conf.askFirst || conf.blocked.length > 0
  function sync() {
    const list = devices()
    if (!conf.known) { conf.known = list.map((d) => d.id); save(); return }
    const fresh = list.filter((d) => !conf.known.includes(d.id))
    if (!fresh.length) return
    const block = guarded()
    conf.known = [...conf.known, ...fresh.map((d) => d.id)].slice(-500)
    // Paired again with a key you kept out: kept out again. Else New, once a guardrail is set.
    const out = fresh.filter((d) => conf.outKeys.includes(deviceOf(d.id)?.key))
    if (out.length) conf.blocked = [...new Set([...conf.blocked, ...out.map((d) => d.id)])].slice(-500)
    if (block) conf.fresh = [...new Set([...conf.fresh, ...fresh.filter((d) => !out.includes(d)).map((d) => d.id)])].slice(-500)
    save()
    onChange()
  }
  // Ticked: neither kept out nor New. (Looked at on every request a device makes: the list of
  // devices is asked for only when this one hasn't been seen here yet.)
  const allows = (id) => { if (!id) return false; if (!conf.known?.includes(id)) sync(); return !conf.blocked.includes(id) && !conf.fresh.includes(id) }
  // Which Devices May Connect for everything a device does here (letin.js), not only the screen. One
  // you kept out gets nothing, whether this Beta Feature is on or not. One New (paired once a
  // guardrail was set) waits to be let in while it's on; off, nothing else is asked of anyone (no
  // screen, no password), and it's still New for when it's on again. A computer nobody set up for
  // this keeps no one out: only you do, or a guardrail you set.
  const admits = (id) => { if (!id) return false; if (!conf.known?.includes(id)) sync(); return !conf.blocked.includes(id) && !(trialOn() && conf.fresh.includes(id)) }
  // A device through another of your computers (hop, a computer paired here; via: { id, name, kind,
  // key } as that computer says): null when it may, else who isn't let in here, 'computer' (the
  // hop) or 'device'. That device is kept out when you kept it out here as it comes through that
  // computer (hop/id, as the lockout keeps it), or, when it's paired here too with the same key, as
  // it is here. A phone keeps a key of its own for each computer it's paired with (a browser, the
  // Android app), so most aren't known here as the same device: those are kept out through each
  // computer apart.
  // One seen through a computer for the first time once a guardrail is set here starts New, as one
  // paired here would; one with a key you kept out, kept out.
  // A computer too old to say which of its devices it's for (via.unknown), once a guardrail is set
  // here: 'update', as its devices can't be told apart (its own requests, as itself, go on as before).
  function shutFor(hop, via = null) {
    if (!admits(hop)) return via ? 'computer' : 'device'
    if (via?.unknown && deviceOf(hop)?.kind === 'computer') return guarded() ? 'update' : null
    if (!via?.id || deviceOf(hop)?.kind !== 'computer') return null
    const key = `${hop}/${via.id}`
    const was = conf.through[key]
    const name = clean(via.name) || 'A device'
    const kind = via.kind === 'computer' ? 'computer' : 'phone'
    const vkey = typeof via.key === 'string' && via.key.length <= 200 ? via.key : null
    if (!was || was.name !== name || was.kind !== kind || (vkey && was.key !== vkey)) {
      conf.through = Object.fromEntries([...Object.entries(conf.through).filter(([k]) => k !== key), [key, { name, kind, ...(vkey ? { key: vkey } : {}), at: was?.at || new Date().toISOString() }]].slice(-100))
      // (Known here by its key as one you let in: the same device, not New.)
      const twin = vkey ? byKey(vkey) : null
      if (!was && vkey && conf.outKeys.includes(vkey)) conf.blocked = [...new Set([...conf.blocked, key])]
      else if (!was && guarded() && !(twin && allows(twin.id))) conf.fresh = [...new Set([...conf.fresh, key])].slice(-500)
      save()
      onChange()
    }
    return throughOut(key) ? 'device' : null
  }
  // Whether a device through another of your computers (hop/id) is kept out here: you kept it out
  // that way, it's New while this Beta Feature is on, or it's known here by its key as one you kept out.
  function throughOut(key) {
    if (conf.blocked.includes(key) || (trialOn() && conf.fresh.includes(key))) return true
    const k = conf.through[key]?.key
    if (!k) return false
    if (conf.outKeys.includes(k)) return true
    const same = byKey(k)
    return !!same && !admits(same.id)
  }
  // The devices of another of your computers (hop, a computer paired here) kept out here as they come
  // through it, by that computer's ids for them: it hides what it shows of this computer from those
  // (its summary of this one, machines.js).
  const outVia = (hop) => (hop ? Object.keys(conf.through).filter((k) => k.startsWith(`${hop}/`) && throughOut(k)).map((k) => k.slice(hop.length + 1)) : [])
  // ...or, with a guardrail set here while this Beta Feature is on, the ones it lets in, and no
  // others: one of that computer's devices not seen here yet would start New, so it's shown nothing
  // of this computer until it's let in. { keepOut } or { letIn }, for that computer's summary.
  const viaList = (hop) => (!hop ? { keepOut: [] } : trialOn() && guarded()
    ? { letIn: Object.keys(conf.through).filter((k) => k.startsWith(`${hop}/`) && !throughOut(k)).map((k) => k.slice(hop.length + 1)) }
    : { keepOut: outVia(hop) })
  // One not let in that asked for something here: when, for Needs You.
  const tried = new Map() // device id -> when
  const turnedAway = (id) => { tried.set(id, Date.now()) }
  // Devices waiting to be let in, for Needs You here: paired once a guardrail was set (New), not
  // ticked yet, and when each last tried (null: not since Bridge AI started).
  function waiting() {
    if (!trialOn()) return []
    sync()
    const list = devices()
    const when = (id) => (tried.has(id) ? new Date(tried.get(id)).toISOString() : null)
    const own = list.filter((d) => conf.fresh.includes(d.id))
      .map((d) => ({ id: d.id, name: clean(d.name) || 'A device', kind: d.kind === 'computer' ? 'computer' : 'phone', paired: d.addedAt || null, tried: when(d.id) }))
    // (Through another of your computers: first seen then, and when it last tried through it.)
    const via = Object.entries(conf.through).filter(([k]) => conf.fresh.includes(k)).map(([k, v]) => {
      const hop = list.find((d) => d.id === k.split('/')[0])
      return hop && { id: k, name: clean(v.name) || 'A device', kind: v.kind === 'computer' ? 'computer' : 'phone', through: clean(hop.name) || 'Another computer', paired: v.at || null, tried: when(hop.id) }
    }).filter(Boolean)
    return [...own, ...via]
  }
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
  // (Through another of your computers, the device it's for, when that computer itself may.)
  const notAllowed = (s) => `${thisName()} doesn't let ${s.forId && s.by.id && allows(s.by.id) ? s.for || 'this device' : s.by.name} connect. That's changed at ${thisName()} itself, in Settings › Remote Access › Which Devices May Connect.`
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
  // { ok, at: the password it was right for (its at) } | ...
  async function check(s, pw) {
    const lock = lockedFor(s)
    if (lock) return { locked: lock.until }
    const stored = conf.password
    if (!stored) return { ok: true, at: null }
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
    const m = await passwordMatches(stored, pw)
    if (m.ok) {
      // Right: that device starts again, and this try isn't counted against the computer it came through.
      delete conf.locks[keys[0]]
      if (keys[1] && conf.locks[keys[1]] && !conf.locks[keys[1]].until) conf.locks[keys[1]].fails = Math.max(0, conf.locks[keys[1]].fails - 1)
      // (Made again with today's settings, unless it was changed here meanwhile.)
      if (m.stale) { const again = await makePassword(pw); if (conf.password === stored) conf.password = { ...again, at: stored.at } }
      save()
      return { ok: true, at: stored.at }
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
    // (Which password it got past: the one it typed was right for, or none.)
    s.pwAt = conf.password?.at || null
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
    // The password changed while it waited here (on Allow, say): not let in on the one it typed.
    if ((conf.password?.at || null) !== s.pwAt) { fail(changedWhy(), 'changed'); return false }
    // What it got past: a session that waits to start is let in only while it's so.
    s.guards = { pw: s.pwAt, ask: !!conf.askFirst }
    return true
  }
  // Still let in as it was at the gate: Remote Screen on, the device allowed and not locked out, the
  // password neither set nor changed since, nor Ask Here First turned on; not ended here meanwhile.
  // Else said (it connects again, past the guardrails as they are now), and false.
  function stillIn(s, mayView, fail) {
    if (s.over) return false
    if (!trialOn()) { fail('Remote Screen and Preview was turned off on this computer.', 'off'); return false }
    if (!mayView()) { refuse(s, 'device'); fail(notAllowed(s), 'device'); return false }
    const lock = lockedFor(s)
    if (lock) { lockedSay(fail, lock.until); return false }
    if (s.guards && ((conf.password?.at || null) !== s.guards.pw || (conf.askFirst && !s.guards.ask))) { fail(changedWhy(), 'changed'); return false }
    return true
  }
  const changedWhy = () => `Remote Access changed on ${thisName()}. Connect again.`
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
      if (!conf.password) { s.pwAt = null; return true } // taken off here meanwhile
      const r = await checkPassword(s, m.p)
      if (r.ok) { s.pwAt = r.at; return true }
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
  // fixes=1: this device takes what fixes a screen that can't be shown (Open Bridge AI, Allow Screen
  // Recording, Reopen Bridge AI: screenFor), and fix=<one>: the one it chose from what it was told
  // before it connected. Each is carried out only past the guardrails.
  async function view(ws, req) {
    const q = new URL(req.url, 'http://x').searchParams
    let who = null
    // Said, and the session goes. One that didn't start for a reason of its own (not a guardrail
    // turning it away): a line in the log too, with why; only for a device let in here and not
    // locked out, LOG_PER_MINUTE a minute at most.
    const fail = (why, code, more = {}) => {
      if (!GUARDED.has(code) && who && allows(who.by.id) && !lockedFor(who) && mayNote(who)) note(who, `couldn't see this screen (${code}${more.cause ? `, ${more.cause}` : ''}): ${why}`)
      tell(ws, { t: 'error', why, code, ...more })
      setTimeout(() => { try { ws.close(1008, 'refused') } catch { /* closed */ } }, 50)
    }
    const fixes = q.get('fixes') === '1'
    const dev = deviceOf(req.headers['x-bridge-relay'])
    if (dev) who = { by: { id: dev.id, name: clean(dev.name) || 'A device' }, key: dev.id, for: dev.kind === 'computer' ? clean(q.get('for')) || null : null }
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
    who = s
    // Ticked here; through another of your computers, the device it's for too (shutFor).
    const forKey = dev.kind === 'computer' && typeof req.headers['x-bridge-for-key'] === 'string' ? req.headers['x-bridge-for-key'] : null
    const mayView = () => allows(dev.id) && !(s.forId && shutFor(dev.id, { id: s.forId, name: s.for, kind: s.forKind, key: forKey }))
    if (!mayView()) { refuse(s, 'device'); return fail(notAllowed(s), 'device') }
    if (s.kind === 'page') {
      const port = Number(sid)
      if (!(port > 1023 && port < 65536) || !(await isDevPort(port))) return fail(`${Number.isInteger(port) ? `Port ${port}` : 'That'} isn't one of the apps ${thisName()} serves.`, 'port')
      if (!s.grant && !desktopOpen() && !FAKE) return fail(`Open the Bridge AI app on ${thisName()} to see its apps on a phone: they're drawn there.`, 'noApp')
      s.port = port
    } else {
      const st = screenStatus()
      // (What fixes it, chosen before it connected: carried out past the guardrails.)
      if (!st.can && !(fixes && st.fix && q.get('fix') === st.fix)) return fail(st.why, st.code, fixes && st.fix ? { fix: st.fix } : {})
    }
    // Nothing is taken (nor macOS asked about the screen) before the guardrails let it in; a few at
    // a time from one device. Unticked here meanwhile, it ends (setDevice).
    // (Those waiting on the screen to start, or on a fix, are counted too.)
    if ([...pending, ...opening].filter((x) => x.key === s.key).length >= PENDING_MAX) return fail(`This device is already waiting to connect to ${thisName()}. Finish that first, or close it.`, 'busy')
    s.fail = fail
    s.mayView = mayView
    pending.add(s)
    let passed = false
    try { passed = await gate(s, fail) } finally { pending.delete(s) }
    if (!passed || ws.readyState !== 1) return
    if (!mayView()) { refuse(s, 'device'); return fail(notAllowed(s), 'device') }
    if (s.kind === 'page') {
      s.source = { kind: 'page', port: s.port, name: `:${s.port}` }
      s.provider = s.grant ? 'none' : FAKE && !desktopOpen() ? 'fake' : 'desktop'
      s.page = { w: Math.min(1600, Math.max(320, Number(q.get('w')) || 390)), h: Math.min(2400, Math.max(320, Number(q.get('h')) || 800)) }
      s.may = !s.grant // a page drawn off screen: what's clicked is that page, not this computer
    } else {
      // (Listed as connecting until it starts, or goes: no gap between the two in what's shown.)
      waitStart(s, true)
      let src = null
      let found = false
      try {
        src = await screenFor(s, { kind, sid, fixes, want: q.get('fix'), fail, mayView })
        if (src) {
          s.source = { kind: src.kind, id: src.id, name: src.name, bounds: src.bounds, w: src.w, h: src.h }
          s.provider = capture ? 'capture' : 'fake'
          // Control when it's on here and asked for (of a whole screen: where the pointer goes is
          // known there), and allowed here when Ask Here First asked.
          s.may = s.wants && s.okControl && controlOn() && (await input.status()).can
          found = true
        }
      } finally { if (!found && opening.has(s)) waitStart(s, false); idleLater() }
      if (!found) return
    }
    // The viewer went while this was being worked out: nothing to start. Nor for one no longer let in.
    if (ws.readyState !== 1 || !stillIn(s, mayView, fail)) { if (opening.has(s)) waitStart(s, false); return }
    opening.delete(s)
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
  const waitingOne = (id) => [...opening].find((x) => x.id === id) || null
  const stopWaiting = (s, by = thisName()) => { s.stoppedBy = by; refuse(s, 'stopped', { stoppedBy: by }); endWaiting(s, 'stopped', `Stopped from ${by}.`, { by }) }
  const stop = (id) => {
    const s = sessions.get(id)
    const w = !s && waitingOne(id)
    if (!s && !w) throw Object.assign(new Error('That session has ended'), { status: 404 })
    if (s) end(s, 'here')
    else stopWaiting(w)
    return true
  }
  const stopAll = () => { for (const s of [...sessions.values()]) end(s, 'here'); for (const s of [...opening]) stopWaiting(s); for (const a of [...asks.values()]) a.done('deny') }
  // Stop, or Block This Device, from another of your devices (a notification's button, the card in
  // a window), carried out here: the session ends (an ask waiting is a no), and Block unticks that
  // device in Which Devices May Connect, which ends anything else of its too; one that came through
  // another of your computers is unticked there, the computer it came through (blockThere), not that
  // computer here. by: who did it, for the record. Either only narrows who may connect; a device is
  // let back in at the computer it's unticked on, only (setDevice).
  async function endFrom(id, { block = false, by = '' } = {}) {
    const s = sessions.get(id)
    const a = asks.get(id)
    const w = !s && !a ? waitingOne(id) : null
    if (!s && !a && !w) throw Object.assign(new Error('That session has ended'), { status: 404 })
    const x = s || w || a.s
    const who = x.by
    const from = clean(by) || 'another of your devices'
    const hop = who.kind === 'computer' && x.forId ? who : null
    if (block && hop) x.blockedAt = hop.name
    if (s) { s.stoppedBy = from; end(s, block ? 'blocked' : 'stopped', block ? `${hop?.name || thisName()} stopped letting this device connect.` : null) }
    if (w) {
      w.stoppedBy = from
      refuse(w, block ? 'blocked' : 'stopped', { stoppedBy: from })
      if (block) endWaiting(w, 'blocked', `${hop?.name || thisName()} stopped letting this device connect.`, hop ? { at: hop.name } : {})
      else endWaiting(w, 'stopped', `Stopped from ${from}.`, { by: from })
    }
    if (a) { a.s.stoppedBy = from; a.done(block ? 'blocked' : 'stopped') }
    if (!block) return { ok: true, said: `Stopped: ${x.for || who.name} isn't viewing ${thisName()}'s screen now.` }
    if (hop) {
      try { await blockThere(hop.id, x.forId) } catch (e) { return { ok: false, said: `Stopped, but ${x.for} couldn't be blocked on ${hop.name}: ${e.message}` } }
      return { ok: true, said: `${x.for} can't connect through ${hop.name} any more.` }
    }
    if (devices().some((d) => d.id === who.id)) setDevice(who.id, false)
    return { ok: true, said: `${who.name} can't connect to ${thisName()} any more.` }
  }

  // ---------- the screen a session asked for ----------
  // Its screen (sid, or the main one) once the capture page is ready. What goes wrong on the way is
  // said with what fixes it, when something here can (problem: { why, code, cause, fix }), and, once
  // the device chooses it ({ t: 'fix' }, within FIX_MS; or before it connected: want), carried out
  // here and the screen asked for again, in the same session: nothing to connect again, nor the
  // password asked again. Each fix once in a session. null when it's said and over.
  async function screenFor(s, { kind, sid, fixes, want, fail, mayView }) {
    const ws = s.viewer
    const used = new Set()
    for (;;) {
      const p = await screenNow(kind, sid)
      if (ws.readyState !== 1 || s.over) return null
      if (!mayView()) { refuse(s, 'device'); fail(notAllowed(s), 'device'); return null }
      if (p.src) return p.src
      const fix = p.fix && !used.has(p.fix) ? p.fix : null
      // A device from before fixes: Reopen as it knows it, after which it connects again.
      if (fix === 'reopen' && !fixes) return oldReopen(s, p)
      if (!fix || !fixes) { fail(p.why, p.code, p.cause ? { cause: p.cause } : {}); return null }
      if (want !== fix) {
        note(s, `couldn't see this screen (${p.code}${p.cause ? `, ${p.cause}` : ''}): ${p.why} Offered: ${fix}.`)
        tell(ws, { t: 'error', why: p.why, code: p.code, fix, waits: true, ...(p.cause ? { cause: p.cause } : {}) })
        const m = await answerOf(ws, (x) => x.t === 'fix' && x.fix === fix, FIX_MS)
        if (!m || ws.readyState !== 1) { setTimeout(() => { try { ws.close(1008, 'refused') } catch { /* closed */ } }, 50); return null }
      }
      want = null
      used.add(fix)
      // (Still let in as at the gate, right before it's carried out.)
      if (!stillIn(s, mayView, fail)) return null
      if (!(await doFix(s, fix, fail))) return null
    }
  }
  // { src }, or the problem.
  async function screenNow(kind, sid) {
    if (!FAKE || capture) {
      try { await needCapture() } catch (e) { return { why: e.message, code: e.code || 'noCapture', cause: e.cause, fix: e.code === 'noApp' ? (canOpen() ? 'open' : null) : desktopOpen() ? 'reopen' : null } }
      // The capture page's first look is when macOS asks about Screen Recording (first use): turned
      // down, or not answered yet, it's said, and the question is on that screen.
      const after = screenStatus()
      if (!after.can) return { why: after.why, code: after.code, fix: after.fix }
    }
    let list = sourceList()
    // No screens yet: asked for again (the app looks a few times) before saying so.
    if (!sid && !list.some((x) => x.kind === 'screen') && capture) { await askSources(); list = sourceList() }
    const src = list.find((x) => x.id === sid && x.kind === (kind === 'window' ? 'window' : 'screen')) || (!sid ? list.find((x) => x.kind === 'screen' && x.primary) || list.find((x) => x.kind === 'screen') : null)
    if (!src && sid) return { why: 'That screen or window isn\'t there any more. Pick another.', code: 'source' }
    return src ? { src } : noScreens()
  }
  // The app here had no screens to share: on a Mac, macOS asking there whether Bridge AI may record
  // the screen (the first look), or nearly always Screen Recording turned on since it opened (macOS
  // lets it record only once it's reopened), or macOS giving none.
  function noScreens() {
    const name = thisName()
    const reopen = desktopOpen() ? 'reopen' : null
    if (os === 'mac' && capture?.permission === 'ask') return { code: 'screenPermission', why: permissionWhy(), fix: reopen && 'allow' }
    if ((capture?.none || 'none') === 'reopen') return { code: 'reopen', why: `Screen Recording was turned on for Bridge AI on ${name} after it opened, and macOS lets it record only once it's reopened.`, fix: reopen }
    if (os === 'mac') return { code: 'noScreens', why: `macOS on ${name} gave Bridge AI no screens to share. If it's asking there whether Bridge AI may record the screen, answer it there; if not, reopening Bridge AI there usually sorts it.`, fix: reopen }
    return { code: 'source', why: `${name} gave Bridge AI no screens to share${capture?.problem ? `: ${capture.problem}` : ''}.`, fix: reopen }
  }
  // As a device from before fixes knows it: Reopen offered ({ reopen: true }), answered { t: 'reopen' }
  // within FIX_MS; the app here reopens, and the device is told to try again.
  async function oldReopen(s, p) {
    const ws = s.viewer
    note(s, `couldn't see this screen (${p.code}): ${p.why} Offered: reopen.`)
    tell(ws, { t: 'error', why: p.why, code: p.code, reopen: true })
    const m = await answerOf(ws, 'reopen', FIX_MS)
    if (m && ws.readyState === 1 && stillIn(s, s.mayView, s.fail)) {
      if (!reopening()) { announce(s, 'reopen', s.id); reopenApp(s) }
      refuse(s, 'reopened')
      tell(ws, { t: 'error', why: `Bridge AI is reopening on ${thisName()}. Try again in a few seconds.`, code: 'reopening' })
    }
    setTimeout(() => { try { ws.close(1008, 'refused') } catch { /* closed */ } }, 50)
    return null
  }
  // A fix the device chose, carried out here and kept in Screen Activity with who chose it; the
  // device told what it's waiting for meanwhile ({ t: 'wait', why }). False when that's over.
  // One of each at a time on this computer, however many sessions choose it: one on its way is
  // waited for, not done again (so is a window of System Settings already asked for). Each one done
  // is told to your other devices, as a session starting is.
  let allowUntil = 0
  const reopening = () => leaving.size > 0 && Date.now() - app.reopen < REOPEN_MS
  async function doFix(s, fix, fail) {
    const ws = s.viewer
    if (fix === 'reopen') {
      if (!reopening()) { announce(s, 'reopen', s.id); reopenApp(s) }
      refuse(s, 'reopened')
      tell(ws, { t: 'wait', why: 'reopen' })
      return true
    }
    if (fix === 'open') {
      // (Only while it may be: a password set, and not quit here since it was offered.)
      if (!canOpen() && !desktopOpen()) { fail(desktopNeeded(), 'noApp'); return false }
      if (!desktopOpen() && Date.now() - app.opened > REOPEN_MS) {
        try { await openApp(true) } catch (e) { fail(`Bridge AI couldn't be opened on ${thisName()}: ${clean(e.message, 200)}`, 'noApp'); return false }
        app.opened = Date.now()
        note(s, 'opened the Bridge AI app here')
        announce(s, 'open', s.id)
      }
      refuse(s, 'opened')
      tell(ws, { t: 'wait', why: 'open' })
      return true
    }
    if (fix === 'allow') {
      if (Date.now() >= allowUntil) {
        allowUntil = Date.now() + ALLOW_MS
        note(s, 'asked for Screen Recording here: System Settings opened at it')
        announce(s, 'allow', s.id)
        toDesktop({ t: 'allow-screen' })
      }
      refuse(s, 'allow')
      const end = allowUntil
      tell(ws, { t: 'wait', why: 'allow', until: new Date(end).toISOString() })
      // Someone here turns it on, and macOS offers Quit & Reopen: the app going (or a new one
      // reporting in), or the page saying it's allowed (asked every few seconds), is what's waited for.
      const feeds = new Set(desktops)
      const done = () => ws.readyState !== 1 || s.over || readyPage()?.permission === 'ok' || [...desktops].some((fn) => !feeds.has(fn)) || !desktopOpen()
      while (Date.now() < end && !(await until(done, Math.min(3000, end - Date.now())))) askSources().catch(() => {})
      return ws.readyState === 1 && !s.over
    }
    return false
  }
  // A session past the guardrails, its screen not started yet: listed (the badge, Settings, your other
  // devices' cards), with Stop, until it starts or goes.
  function waitStart(s, on) {
    if (on) opening.add(s)
    else opening.delete(s)
    toBadge()
    onChange()
  }
  // One of those ended here (Stop, the password changed, Remote Screen off, Ask Here First turned on,
  // the device unticked) or from another of your devices: said to it (code, why), and it goes; what
  // it waited on stops there (screenFor, doFix look at s.over).
  function endWaiting(s, code, why, more = {}) {
    if (s.over) return
    s.over = code
    opening.delete(s)
    s.fail(why, code, more)
    poke()
    toBadge()
    onChange()
  }

  // The desktop app here asked to reopen (it does in a moment: desktop/remote.js). Its feed isn't
  // counted as open from now, nor its capture page as ready, so what waits on it waits for the app
  // to come back (REOPEN_MS at most).
  function reopenApp(s) {
    note(s, 'reopened the Bridge AI app here')
    app.reopen = Date.now()
    for (const fn of desktops) leaving.add(fn)
    if (capture) capture.old = true
    toDesktop({ t: 'reopen' })
    poke()
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
    sessions: [
      ...watchers().map((s) => ({ id: s.id, by: { name: s.by.name, kind: s.by.kind }, for: s.for, forKind: s.forKind, control: ctl(s), controlled: s.controlled, started: new Date(s.started).toISOString() })),
      ...[...opening].map((s) => ({ id: s.id, by: { name: s.by.name, kind: s.by.kind }, for: s.for, forKind: s.forKind, control: false, controlled: false, started: new Date(s.started).toISOString(), waiting: true })),
    ],
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
  // So does one at the password or waiting for Allow here (its ask goes too).
  function passwordChanged() {
    const why = `The Remote Access Password changed on ${thisName()}. Connect again.`
    for (const s of [...sessions.values()]) end(s, 'changed', why)
    for (const s of [...opening]) endWaiting(s, 'changed', why)
    for (const s of [...pending]) if (!s.over) { s.over = 'changed'; pending.delete(s); s.fail(why, 'changed') }
    for (const a of [...asks.values()]) if (!sessions.has(a.s?.id)) a.done('gone')
  }
  // Turned on: a session still connecting goes, to be asked here when it connects again.
  function setAskFirst(on) {
    conf.askFirst = !!on
    save()
    if (on) for (const s of [...opening]) endWaiting(s, 'changed', changedWhy())
    onChange()
    return accessStatus()
  }
  // Unticked: it can't connect, and a session of its going now ends, as does one at the password or
  // waiting for Allow; and the rest of what it has open here (its terminals, what it's fetching or
  // sending) and through this computer to another (onBlocked). Ticked or not, it isn't New any more.
  // id: a device paired here, or one seen through another of your computers (hop/id).
  function setDevice(id, allowed) {
    sync()
    if (!devices().some((d) => d.id === id) && !(conf.through[id] && devices().some((d) => d.id === id.split('/')[0]))) throw Object.assign(new Error('That device isn\'t paired with this computer.'), { status: 404 })
    conf.blocked = allowed ? conf.blocked.filter((x) => x !== id) : [...new Set([...conf.blocked, id])]
    conf.fresh = conf.fresh.filter((x) => x !== id)
    // Its key too (one it pairs with again, or comes through another computer with, is the same).
    const k = deviceOf(id)?.key || conf.through[id]?.key
    if (k) conf.outKeys = allowed ? conf.outKeys.filter((x) => x !== k) : [...new Set([...conf.outKeys, k])].slice(-500)
    tried.delete(id)
    save()
    if (!allowed) {
      const why = `${thisName()} stopped letting this device connect.`
      const its = (s) => s.by.id === id || s.key === id
      for (const s of [...sessions.values()]) if (its(s)) end(s, 'device', why)
      for (const a of [...asks.values()]) if (a.s ? its(a.s) : a.by.id === id) a.done('gone')
      for (const s of [...pending]) if (its(s)) { pending.delete(s); refuse(s, 'device'); s.fail(why, 'device') }
      for (const s of [...opening]) if (its(s)) { refuse(s, 'device'); endWaiting(s, 'device', why) }
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
  // capture: only this computer's own page (the desktop app's capture window), never a device's nor
  // one through Tailscale, and only with a token the app was given for it (need-capture), once.
  function upgrade(req, socket, head) {
    const kind = VIEW.exec(req.url)?.[1]
    if (kind === 'capture') {
      let token = null
      try { token = new URL(req.url, 'http://x').searchParams.get('token') } catch { /* none */ }
      const good = !!token && (tokens.has(token) ? Date.now() - tokens.get(token) <= TOKEN_MS : !!TEST_TOKEN && token === TEST_TOKEN)
      if (!here(req) || !good) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy() }
      tokens.delete(token)
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {})
      if (kind === 'capture') onCapture(ws)
      else view(ws, req).catch((e) => { tell(ws, { t: 'error', why: e.message }); try { ws.close(1011) } catch { /* closed */ } })
    })
  }

  // ---------- the desktop app's feed ----------
  let quitSaid = 0 // when the app here last said you quit it (appQuit), until its feed goes
  // Who's viewing, said each time it connects, nobody too: an app that heard of a session that ended
  // while its feed was down lets the display sleep again, and takes its badge down. Opened here again
  // (not by a device): Open Bridge AI may be offered once more.
  function onDesktop(fn) {
    desktops.add(fn)
    app.came = Date.now()
    takeQuitMark()
    fn({ t: 'control', on: controlOn() })
    fn({ t: 'sessions', list: badgeList(), asks: [...asks.values()].map(shownAsk) })
    // A start waiting on the app (it just started, or reopened): its capture page, asked for now.
    if (starting) fn(needs())
    quitSaid = 0
    if (conf.quit && Date.now() - app.opened > REOPEN_MS) { conf.quit = null; save() }
    poke()
    onChange()
    // (Its capture page goes with it: not used meanwhile, the app's next one is waited for. Gone
    // just after it said you quit it: kept, so Open Bridge AI isn't offered until it's opened here.)
    return () => {
      desktops.delete(fn)
      leaving.delete(fn)
      app.gone = Date.now()
      if (capture && !desktopOpen()) capture.old = true
      if (!desktopOpen() && app.gone - quitSaid < 15000) { quitSaid = 0; conf.quit = new Date().toISOString(); save() }
      poke()
      onChange()
    }
  }
  // The desktop app here, quitting because you quit it (desktop/main.js: not to reopen or update).
  function appQuit() { quitSaid = Date.now(); return { ok: true } }
  // ...or, when it couldn't say so (this server down then: Quit and Stop Agents, say), the mark it left
  // in the data folder, taken as this server starts (and as the app connects, which is it opened again).
  function takeQuitMark() {
    let at = null
    try { at = JSON.parse(fs.readFileSync(QUIT_MARK, 'utf8'))?.at } catch { return }
    try { fs.rmSync(QUIT_MARK, { force: true }) } catch { /* taken next time */ }
    if (!desktopOpen() && typeof at === 'string') { conf.quit = new Date(Date.parse(at) || Date.now()).toISOString(); save() }
  }
  takeQuitMark()

  // Trial turned off: every session ends, and every ask is a no. Turned on: what a New device has
  // open here ends, as when it's unticked (it waits to be let in from now); one you kept out was
  // let in to nothing meanwhile either.
  function trialChanged() {
    if (trialOn()) { sync(); for (const id of [...conf.fresh, ...conf.blocked]) if (devices().some((d) => d.id === id)) onBlocked(id); return }
    for (const s of [...sessions.values()]) end(s, 'off', 'Remote Screen and Preview was turned off on this computer.')
    for (const s of [...opening]) endWaiting(s, 'off', 'Remote Screen and Preview was turned off on this computer.')
    for (const a of [...asks.values()]) a.done('deny')
  }

  // Whether a device of this computer's may go on through it to another of your computers (machines.js):
  // allowed here and not locked out here. null, or why not.
  function mayPass(id) {
    if (!allows(id)) return { code: 'device', why: notAllowed({ by: { name: deviceOf(id)?.name || 'this device' } }) }
    const lock = lockOf(id)
    return lock ? { code: 'locked', why: lockedWhy(lock.until), until: new Date(lock.until).toISOString() } : null
  }

  // Whether a device may have Bridge AI here updated (Update Bridge AI, offered to one that can't see
  // this screen: ScreenView): not one locked out, nor one that typed a wrong password since it last
  // typed the right one, while that still counts. null, or why not. forId: the device it's for,
  // through another of your computers.
  function mayUpdate(id, forId = null) {
    const s = { key: forId ? `${id}/${forId}` : id, by: { id } }
    const lock = lockedFor(s)
    if (lock) return lockedWhy(lock.until)
    const l = conf.locks[s.key]
    if (l?.fails > 0 && Date.now() - (l.at || 0) < LOCK_MS) return `Type ${thisName()}'s Remote Access Password first: a wrong one was typed from this device.`
    return null
  }
  // The names of the devices seen through your other computers, for what a crash report takes out.
  const throughNames = () => Object.values(conf.through).map((v) => clean(v.name)).filter(Boolean)

  // Another computer's screen that didn't show on this one, or on one of its devices (ScreenView.jsx
  // says what it showed instead): a line in this log too, so it says next time. 20 a minute at most.
  let saidAt = []
  function didntShow({ name, code, cause, why, version: theirs } = {}, on = null) {
    const now = Date.now()
    saidAt = saidAt.filter((x) => now - x < 60000)
    if (saidAt.length >= 20) return { ok: false }
    saidAt.push(now)
    log(`${new Date(now).toISOString()} Remote Screen: ${clean(name) || 'Another computer'}'s screen didn't show ${on ? `on ${clean(on)}` : 'here'} (${clean(code, 40) || 'error'}${cause ? `, ${clean(cause, 20)}` : ''}${theirs ? `; it has Bridge AI ${clean(theirs, 40)}` : ''}): ${clean(why, 300) || 'it said no more'}`)
    return { ok: true }
  }

  return { status, setControl, setPassword, clearPassword, setAskFirst, setDevice, setNotify, unlock, answer, allows, admits, shutFor, outVia, viaList, turnedAway, waiting, mayPass, mayPreview, stop, stopAll, endFrom, live, seen, upgrade, isPath, onDesktop, pageFrame, trialChanged, desktopOpen, didntShow, appQuit, mayUpdate, throughNames, desktopSince: () => app.came, active: () => sessions.size }
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
