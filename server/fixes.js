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
import { IS_MAC, HOME } from './paths.js'
import { loginPath, which } from './agents.js'

const DRYRUN = process.env.BRIDGE_FIX_DRYRUN === '1'
const SECURITY = 'x-apple.systempreferences:com.apple.preference.security'
// restart: what you allow there reaches Bridge AI only once it restarts. add: the list has a +
// button and takes a drag, so you add the app yourself; elsewhere the app is listed once it asked.
const PANES = {
  'full-disk': { url: `${SECURITY}?Privacy_AllFiles`, label: 'Full Disk Access', restart: true, add: true },
  calendars: { url: `${SECURITY}?Privacy_Calendars`, label: 'Calendars' },
  files: { url: `${SECURITY}?Privacy_FilesAndFolders`, label: 'Files & Folders', restart: true },
  automation: { url: `${SECURITY}?Privacy_Automation`, label: 'Automation' },
  microphone: { url: `${SECURITY}?Privacy_Microphone`, label: 'Microphone' },
  // With the app's bundle id it opens on Bridge AI's own page.
  notifications: { url: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension', label: 'Notifications', perApp: true },
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

// The bundle id, from the app's Info.plist (Notifications opens on the app's page with it).
let idMemo
function bundleId() {
  const a = app()
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
    mac: IS_MAC, app: app(), dryRun: DRYRUN,
    panes: Object.fromEntries(Object.entries(PANES).map(([k, v]) => [k, v.label])),
    restart: [
      ...[...pending].map((k) => ({ pane: k, label: PANES[k].label })),
      ...(settingsPending.size ? [{ pane: 'settings', label: [...settingsPending].join(', '), settings: true }] : []),
    ],
    tools: { brew },
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
  const id = p.perApp ? await bundleId() : null
  return open([id ? `${p.url}?id=${encodeURIComponent(id)}` : p.url])
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
const FOLDERS = ['Desktop', 'Documents', 'Downloads']
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

// icalBuddy is a new program on every read, so a change in Calendars applies without a restart.
// It prints "No calendars." when macOS hasn't let it see any.
export async function calendarAccess() {
  const bin = await tool('icalBuddy')
  if (!bin) return 'missing'
  return new Promise((resolve) => {
    execFile(bin, ['calendars'], { timeout: 20000 }, (err, out, errOut) => resolve(/No calendars/i.test(`${out}\n${errOut}`) ? 'denied' : 'ok'))
  })
}

export async function check(pane, { folder } = {}) {
  const p = PANES[pane]
  if (!p) throw new Error('No such settings page')
  if (!IS_MAC) return { pane, state: 'ok' }
  let state = 'unknown'
  if (pane === 'calendars') {
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
const HOMEBREW = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
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
  return { label: b[0], command: `${q(brew)} install ${b[1]}` }
}
const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)
