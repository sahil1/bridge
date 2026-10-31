// One-click fixes for what macOS asks you to allow: open the right page of System Settings, say
// which app needs access (Bridge AI itself when you use the app, or the terminal you started it
// from), tell whether access is on yet, and whether it needs a restart first. Also the fixed
// install commands the app may run for you in a terminal tab (never one from a request).
//
// BRIDGE_FIX_DRYRUN=1 (tests): log what would open instead of opening it, and look for tools only
// on the PATH (so a test with a made-up PATH never finds this Mac's own Homebrew).
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { IS_MAC, IS_WIN, HOME, ROOT, brewInstall } from './paths.js'
import { loginPath, which } from './agents.js'

const DRYRUN = process.env.BRIDGE_FIX_DRYRUN === '1'
const SECURITY = 'x-apple.systempreferences:com.apple.preference.security'
const FOLDERS = ['Desktop', 'Documents', 'Downloads']
// restart: what you allow there reaches Bridge AI only once it restarts. add: the list has a +
// button and takes a drag, so you add the app yourself; elsewhere the app is listed once it asked.
// tcc: what macOS files the answer under (tccutil's names), for Reset and ask again. app: the desktop
// app itself asks for it and sees it (desktop/permissions.js); this server only knows what the app
// last said (appReport).
const PANES = {
  'full-disk': { url: `${SECURITY}?Privacy_AllFiles`, label: 'Full Disk Access', restart: true, add: true, tcc: ['SystemPolicyAllFiles'] },
  calendars: { url: `${SECURITY}?Privacy_Calendars`, label: 'Calendars', tcc: ['Calendar'] },
  files: { url: `${SECURITY}?Privacy_FilesAndFolders`, label: 'Files & Folders', restart: true, tcc: FOLDERS.map((f) => `SystemPolicy${f}Folder`) },
  automation: { url: `${SECURITY}?Privacy_Automation`, label: 'Automation', tcc: ['AppleEvents'] },
  microphone: { url: `${SECURITY}?Privacy_Microphone`, label: 'Microphone', tcc: ['Microphone'], app: true },
  // Pasting what you dictate where you're typing (desktop/dictation.js): pressing ⌘V there.
  accessibility: { url: `${SECURITY}?Privacy_Accessibility`, label: 'Accessibility', tcc: ['Accessibility', 'PostEvent'], app: true },
  // A call's sound for meeting notes (System Audio Recording Only, in the same list as screen recording).
  audio: { url: `${SECURITY}?Privacy_ScreenCapture`, label: 'Screen & System Audio Recording', tcc: ['AudioCapture', 'ScreenCapture'] },
  // With the app's bundle id it opens on Bridge AI's own page.
  notifications: { url: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension', label: 'Notifications', perApp: true, app: true },
  'internet-accounts': { url: 'x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension', label: 'Internet Accounts' },
}
// Apps a button may open (Mail, to let it sync the first time).
const APPS = { mail: 'Mail', calendar: 'Calendar' }

// $TERM_PROGRAM of the terminal Bridge AI was started from, by the name System Settings lists it under.
const TERMINALS = { Apple_Terminal: 'Terminal', 'iTerm.app': 'iTerm', ghostty: 'Ghostty', WarpTerminal: 'Warp', vscode: 'Visual Studio Code', WezTerm: 'WezTerm', kitty: 'kitty', Alacritty: 'Alacritty', Hyper: 'Hyper', Tabby: 'Tabby' }

// The app macOS asks about: the desktop app runs this server on its own binary, inside its bundle.
export function app() {
  const bundle = /^(.*?\.app)\//.exec(process.execPath)?.[1]
  if (process.versions.electron && bundle) return { name: path.basename(bundle, '.app'), bundle, desktop: true }
  return { name: TERMINALS[process.env.TERM_PROGRAM] || null, bundle: null, desktop: false }
}

// The bundle id, from the app's Info.plist (Notifications opens on the app's page with it, and
// Reset and ask again forgets this app's answers by it). BRIDGE_FIX_BUNDLE_ID: the tests' stand-in.
let idMemo
function bundleId() {
  const a = app()
  if (DRYRUN && process.env.BRIDGE_FIX_BUNDLE_ID) return Promise.resolve(process.env.BRIDGE_FIX_BUNDLE_ID)
  if (!IS_MAC || !a.bundle) return Promise.resolve(null)
  idMemo ||= new Promise((resolve) => {
    execFile('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(a.bundle, 'Contents', 'Info.plist')], { timeout: 5000 }, (err, out) => resolve(err ? null : String(out).trim() || null))
  })
  return idMemo
}

// Homebrew and the tools the fixes install, on your login PATH or where Homebrew puts them (a new
// install isn't on the PATH until your shell profile says so).
const BREW_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']
export async function tool(name) {
  return which(name, [await loginPath(), ...(DRYRUN ? [] : BREW_DIRS)].join(path.delimiter))
}

// Panes waiting for a restart: access was detected (or you said you turned it on) after this server
// started. Kept until the server restarts, which is what applies them. The same for settings that
// only apply at start (port, runtime...).
const pending = new Set()
const settingsPending = new Set()
export const noteRestart = (keys = []) => { settingsPending.clear(); for (const k of keys) settingsPending.add(k) }

export async function status() {
  const brew = IS_MAC ? !!(await tool('brew')) : false
  return {
    mac: IS_MAC, win: IS_WIN, app: app(), dryRun: DRYRUN,
    panes: Object.fromEntries(Object.entries(PANES).map(([k, v]) => [k, v.label])),
    restart: [
      ...[...pending].map((k) => ({ pane: k, label: PANES[k].label })),
      ...(settingsPending.size ? [{ pane: 'settings', label: [...settingsPending].join(', '), settings: true }] : []),
    ],
    tools: { brew },
    // Reset and ask again: macOS's answers are this app's to forget only when the server is the app's
    // own (from a terminal, they're the terminal's).
    canReset: IS_MAC && !!(await bundleId()),
    // The desktop app on this computer, when it's one that can be told to ask (another device asking,
    // askHere) and says what it's allowed (appReport): its version, and whether it's listening now.
    desktop: fromApp || listeners.size ? { version: fromApp?.version || null, listening: listeners.size > 0 } : null,
    asked: asked && Date.now() - asked.at < ASK_FOR ? asked : null,
  }
}

const open = (args) => {
  if (DRYRUN) { console.log(`[fix dry-run] open ${args.join(' ')}`); return Promise.resolve({ ok: true, dryRun: true }) }
  return new Promise((resolve, reject) => {
    execFile('open', args, { timeout: 15000 }, (err) => (err ? reject(new Error('Couldn\'t open System Settings')) : resolve({ ok: true })))
  })
}

export async function openSettings(pane) {
  if (!IS_MAC) throw new Error('This is a macOS setting')
  const p = PANES[pane]
  if (!p) throw new Error('No such settings page')
  // Calendars has no way to add an app to its list: an app shows there once it has asked. So ask
  // first (macOS shows "Bridge AI would like full access to your calendars"), and open the list only
  // if you'd said no before. Two minutes to answer.
  if (pane === 'calendars' && (!DRYRUN || process.env.BRIDGE_CALASK)) {
    const said = await askCalendars()
    if (said === 'restricted') throw new Error('A profile on this Mac doesn\'t let apps see your calendars. Ask whoever manages it.')
    if (said === 'granted') return { ok: true, state: 'ok' }
    if (!said && !DRYRUN && (await calendarAccess({ wait: 60000 })) === 'ok') return { ok: true, state: 'ok' }
  }
  // Automation the same way: a harmless question to Finder, which macOS asks you about the first
  // time ("Bridge AI wants access to control Finder"). Said yes: nothing to open.
  if (pane === 'automation' && (await askAutomation()) === 'ok') return { ok: true, state: 'ok' }
  const id = p.perApp ? await bundleId() : null
  return open([id ? `${p.url}?id=${encodeURIComponent(id)}` : p.url])
}

// Finder asked for its name: 'ok', 'denied' (-1743: turned off, or said no) or 'unknown' (anything
// else). Only ever when you click Allow, or after (the answer's settled then, so nothing's asked).
// BRIDGE_OSASCRIPT: the tests' stand-in.
let automationSaid = null
function askAutomation() {
  if (DRYRUN && !process.env.BRIDGE_OSASCRIPT) return Promise.resolve('unknown')
  return new Promise((resolve) => {
    execFile(process.env.BRIDGE_OSASCRIPT || 'osascript', ['-e', 'tell application "Finder" to get name'], { timeout: 130000 }, (err, _out, errOut) => {
      automationSaid = !err ? 'ok' : /-1743|not authori[sz]ed/i.test(`${err.message}\n${errOut}`) ? 'denied' : 'unknown'
      resolve(automationSaid)
    })
  })
}

// ---------- Reset and ask again ----------
// macOS keeps an answer for each app (TCC) with the app's signature. One kept from a build signed
// differently (up to 3.4.2 the app was signed ad hoc), or one that's gone wrong, can show as on in
// System Settings and still block Bridge AI. tccutil forgets this app's answer, for this one thing
// only, without a password; the next ask is macOS's own question again.
// BRIDGE_TCCUTIL: the tests' stand-in (in dry runs, without it, nothing runs).
export async function reset(pane, { folder } = {}) {
  if (!IS_MAC) throw new Error('This is a macOS setting')
  const p = PANES[pane]
  if (!p?.tcc) throw new Error('Nothing to reset for this')
  const id = await bundleId()
  if (!id) throw new Error('Bridge AI can reset this only for its own app. In System Settings, remove the app from the list with −, then allow it again.')
  const services = pane === 'files' && FOLDERS.includes(folder) ? [`SystemPolicy${folder}Folder`] : p.tcc
  const bin = process.env.BRIDGE_TCCUTIL || (DRYRUN ? null : '/usr/bin/tccutil')
  for (const s of services) {
    if (!bin) { console.log(`[fix dry-run] tccutil reset ${s} ${id}`); continue }
    // A service an older macOS doesn't know (AudioCapture before 14.2) just says so.
    await new Promise((resolve) => execFile(bin, ['reset', s, id], { timeout: 10000 }, () => resolve()))
  }
  pending.delete(pane)
  if (pane === 'automation') automationSaid = null
  if (p.app && fromApp) delete fromApp.states[pane]
  return { pane, reset: services }
}

// ---------- What the desktop app says ----------
// The microphone, Accessibility and notifications are the app's own to ask for and see (it's the
// process macOS, or Windows, asks about). It tells this server what it's allowed now and then, so another of your
// devices or your phone can see it too.
let fromApp = null // { version, at, states: { microphone: 'ok', ... } }
const STATES = new Set(['ok', 'ask', 'denied', 'restricted', 'restart', 'unknown'])
export function appReport({ version, states } = {}) {
  const ok = Object.fromEntries(Object.entries(states && typeof states === 'object' ? states : {}).filter(([k, v]) => PANES[k]?.app && STATES.has(v)))
  fromApp = { version: /^\d+\.\d+\.\d+$/.test(String(version)) ? String(version) : null, at: Date.now(), states: ok }
  return { ok: true }
}
const appSaid = (pane) => (fromApp && Date.now() - fromApp.at < 3 * 60 * 1000 ? fromApp.states[pane] ?? null : null)

// ---------- Asked from another device ----------
// A permission belongs to the computer it's for: from your phone, or another computer showing this
// one, Bridge AI here is asked to show macOS's question (desktop/main.js hears it on its feed of
// events, brings its window forward at Settings › General › Permissions and asks). The person
// still answers it here. Kept a while, so this computer's Settings shows who asked.
const ASK_FOR = 10 * 60 * 1000
let asked = null // { pane, folder, from, at }
const listeners = new Set() // the desktop app's own feed (/api/events from the app)
export const onAsk = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export function askHere(pane, { folder, from } = {}) {
  if (!PANES[pane] || pane === 'internet-accounts') throw new Error('No such settings page')
  if (!IS_MAC && !IS_WIN) throw new Error('Nothing to allow on this computer')
  // The same ask again straight away (a double tap) doesn't bring the window forward twice.
  if (asked?.pane === pane && Date.now() - asked.at < 10000) return { told: listeners.size > 0 }
  asked = { pane, folder: FOLDERS.includes(folder) ? folder : null, from: String(from || '').slice(0, 60) || null, at: Date.now() }
  for (const fn of listeners) { try { fn(asked) } catch { /* that feed is gone */ } }
  return { told: listeners.size > 0 }
}
export const askedDone = () => { asked = null; return { ok: true } }

// ---------- Everything this computer may be asked to allow ----------
// Which, from what this computer is: os mac, win or linux (Docker is Linux); desktop, the desktop app
// is here (its own: the mic, notifications); paste, pasting where you're typing can work (the app
// says Accessibility applies); callSound, a call's sound can be recorded (native/calltap); trash,
// macOS has /usr/bin/trash (15 and later), so the Trash doesn't go through Finder (Automation).
export function rowsFor({ os, desktop = false, paste = false, callSound = false, trash = false }) {
  if (os === 'win') return desktop ? ['microphone', 'notifications'] : []
  if (os !== 'mac') return []
  return [
    ...(desktop ? ['microphone'] : []),
    ...(desktop && paste ? ['accessibility'] : []),
    'calendars', 'full-disk', 'files',
    ...(callSound ? ['audio'] : []),
    ...(trash ? [] : ['automation']),
    ...(desktop ? ['notifications'] : []),
  ]
}
// Settings › General › Permissions: each one Bridge AI may use here, whether it's on, and what for
// (the page says). Only what applies to this computer: nothing on Linux or in Docker (nothing asks
// there), the desktop app's own only with the desktop app. Looking never asks macOS anything: the
// folders' answers aren't looked at (a look at Desktop is what asks), Automation only once it's asked.
// callSound: whether a call's sound can be recorded here (the server knows: native/calltap).
export async function list({ callSound = false } = {}) {
  const rows = rowsFor({
    os: IS_MAC ? 'mac' : IS_WIN ? 'win' : 'linux',
    desktop: app().desktop || !!fromApp,
    paste: !!fromApp?.states.accessibility,
    callSound,
    trash: IS_MAC && await fs.promises.access('/usr/bin/trash').then(() => true, () => false),
  })
  const items = []
  for (const pane of rows) {
    const p = PANES[pane]
    let state = 'unknown'
    if (p.app) state = appSaid(pane) || 'unknown'
    else if (pane === 'calendars' || pane === 'full-disk') state = (await check(pane).catch(() => ({ state: 'unknown' }))).state
    else if (pane === 'automation') state = automationSaid || 'unknown'
    else if (pending.has(pane)) state = 'restart'
    items.push({ pane, label: p.label, state, restart: !!p.restart, app: !!p.app })
  }
  return { items }
}

export function openApp(which) {
  if (!IS_MAC) throw new Error('This is a macOS app')
  const name = APPS[which]
  if (!name) throw new Error('No such app')
  return open(['-a', name])
}

// Bridge AI in Finder, selected, so you can drag it into the list in System Settings.
export function reveal() {
  const a = app()
  if (!IS_MAC || !a.bundle) throw new Error('Add the app with the + button in System Settings')
  return open(['-R', a.bundle])
}

// ---------- Is access on yet? ----------
// Three answers: 'ok' (this server can read it now), 'restart' (allowed, but not for this server
// yet) and 'denied'. 'unknown' where it can't be told from here (Microphone, Notifications: the
// desktop app asks macOS itself).
//
// Assumption: macOS settles a program's access when the program first asks and keeps that answer
// for as long as it runs, but a program started now gets today's answer. So this long-running
// server keeps its earlier "no" after you allow access, while a fresh /bin/ls started by it sees
// the new "yes" right away (and asks on Bridge AI's behalf: macOS counts the app that started it).
// If that ever stops holding on some macOS version, nothing breaks: the card keeps saying "not
// allowed yet", and "I've turned it on" (claim below) still leads to the restart.
// The restart is the server's. Built-in agents keep running in the terminal host (runtime/
// ptyhost.js) unless Keep agents running is off. By the same rule, each agent is a program of its
// own: one started after you allow access gets it, and one that already asked and was refused
// keeps that answer until it's restarted (closed and resumed).
function target(pane, folder) {
  if (pane === 'full-disk') return path.join(HOME, 'Library', 'Mail')
  if (pane === 'files') return path.join(HOME, FOLDERS.includes(folder) ? folder : 'Desktop')
  return null
}
const denied = (code) => code === 'EPERM' || code === 'EACCES'
// Never blocking: a look into Desktop or Documents can be held while macOS asks.
const ownRead = (p) => fs.promises.readdir(p).then(() => 'yes', (e) => (denied(e.code) ? 'no' : 'none'))
const freshRead = (p) => new Promise((resolve) => {
  execFile('/bin/ls', [p], { timeout: 15000 }, (err, _out, errOut) => resolve(!err ? 'yes' : /not permitted|denied/i.test(String(errOut)) ? 'no' : 'none'))
})

// Bridge AI's own way to the calendars (native/bridgecal.swift): it asks macOS, says whether it may
// see them, and reads them (calendar.js). null with no helper (a Mac that built Bridge AI without
// Xcode's tools), where icalBuddy reads instead. icalBuddy can't ask, and on current macOS it sees no
// calendars even once Bridge AI may. BRIDGE_CALASK: a stand-in; tests use no real one without it.
export const calBin = () => {
  if (DRYRUN && !process.env.BRIDGE_CALASK) return null
  const f = process.env.BRIDGE_CALASK || path.join(ROOT, 'native', 'bin', 'bridgecal')
  return (IS_MAC || process.env.BRIDGE_CALASK) && fs.existsSync(f) ? f : null
}
// Asks macOS for the calendars: 'granted', 'denied' or 'restricted', or null with no helper.
export function askCalendars() {
  const bin = calBin()
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(bin, [], { timeout: 130000 }, (_err, out) => resolve(/^(granted|denied|restricted)$/m.exec(String(out || ''))?.[1] || null))
  })
}

// Whether Bridge AI may see the calendars, without asking: bridgecal says. Without it, icalBuddy, a
// new program on every read (so a change in Calendars applies without a restart), which prints
// "No calendars." or nothing at all when macOS hasn't let it see any.
export async function calendarAccess({ wait = 20000 } = {}) {
  const cal = calBin()
  if (cal) {
    const said = await new Promise((resolve) => execFile(cal, ['status'], { timeout: wait }, (_err, out) => resolve(String(out || '').trim())))
    if (said) return said === 'granted' ? 'ok' : 'denied'
  }
  const bin = await tool('icalBuddy')
  if (!bin) return 'missing'
  return new Promise((resolve) => {
    execFile(bin, ['calendars'], { timeout: wait }, (err, out, errOut) => resolve(err?.killed ? 'asking' : /No calendars/i.test(`${out}\n${errOut}`) || !String(out || '').trim() ? 'denied' : 'ok'))
  })
}

export async function check(pane, { folder } = {}) {
  const p = PANES[pane]
  if (!p) throw new Error('No such settings page')
  // Windows asks about the microphone too (its privacy settings), which only the app can see.
  if (IS_WIN && p.app) return { pane, state: appSaid(pane) || 'unknown', restart: false }
  if (!IS_MAC) return { pane, state: 'ok' }
  let state = 'unknown'
  if (p.app) state = appSaid(pane) || 'unknown'
  // Once it's been asked (Allow), Finder's answer is settled: asking again asks you nothing.
  else if (pane === 'automation') state = automationSaid ? await askAutomation() : 'unknown'
  else if (pane === 'calendars') {
    state = await calendarAccess()
    if (state === 'missing') state = 'unknown'
  } else {
    const t = target(pane, folder)
    if (t) {
      const own = await ownRead(t)
      state = own !== 'no' ? 'ok' : (await freshRead(t)) === 'yes' ? 'restart' : 'denied'
    }
  }
  if (state === 'ok') pending.delete(pane)
  if (state === 'restart') pending.add(pane)
  // You said you turned it on: believe it, and offer the restart.
  if (state !== 'ok' && pending.has(pane)) state = 'restart'
  return { pane, state, restart: !!p.restart }
}

// "I've turned it on": for when the check can't see it (or can't be done from here).
export function claim(pane) {
  if (!PANES[pane]) throw new Error('No such settings page')
  pending.add(pane)
  return { pane, state: 'restart' }
}

// ---------- Fixed install commands, run in a terminal tab you can watch ----------
export const HOMEBREW = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
const BREW = { icalbuddy: ['Install icalBuddy', 'ical-buddy'], gh: ['Install GitHub CLI', 'gh'] }
export async function installCommand(what) {
  if (what === 'homebrew') {
    if (!IS_MAC) throw new Error('Homebrew is set up from a terminal on this system')
    return { label: 'Install Homebrew', command: HOMEBREW }
  }
  if (what === 'xcode') {
    if (!IS_MAC) throw new Error('Install git with your package manager')
    return { label: 'Install developer tools', command: 'xcode-select --install' }
  }
  if (what === 'gh-login') {
    const gh = await tool('gh')
    if (!gh) throw new Error('Install the GitHub CLI first')
    return { label: 'Sign in to GitHub', command: `${q(gh)} auth login --web --git-protocol https` }
  }
  const b = BREW[what]
  if (!b) throw new Error('Nothing to install')
  if (!IS_MAC) throw new Error(`Install ${b[1]} with your package manager`)
  const brew = await tool('brew')
  if (!brew) throw Object.assign(new Error('Homebrew isn\'t installed'), { code: 'noBrew' })
  return { label: b[0], command: brewInstall(q(brew), b[1]) }
}
const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)
