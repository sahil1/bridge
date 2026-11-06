// "A new version is available": checks GitHub for the latest release now and then, and updates
// the desktop app on request by running the same one-line installer people install with.
// Running from source, it says how to update instead (git pull), since that's your clone; the desktop
// app around it (its window showing this server) is installed apart, and can be behind: that one
// still updates here, on a Mac or Windows (install({ app: true })).
// A release that needs a newer macOS than this Mac has isn't offered (the app's own update neither):
// Bridge AI says once that it stays on this version, and why.
// The desktop app on a Mac or Windows also updates by itself while you're away (autoView, below).
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, IN_APP, IS_WIN, IS_MAC, cacheFile, ensureDir } from './paths.js'
import { machine, atLeast } from './machine.js'
import { serverWhy, releaseWhy, RETRY_HOURS, INSTALL_MINUTES } from '../shared/autoupdate.js'

const REPO = 'sahil1/bridge'
// BRIDGE_RELEASES_API (tests): where the latest release is asked for.
const LATEST = process.env.BRIDGE_RELEASES_API || `https://api.github.com/repos/${REPO}/releases/latest`
const EVERY = 6 * 60 * 60 * 1000
const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

// 1.24.0 < 1.24.1 < 2.0.0; pre-release suffixes are ignored.
const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0)
const newer = (a, b) => { const x = parts(a); const y = parts(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i] } return false }

// The oldest macOS a release's Mac app opens on, in its notes as a line GitHub doesn't show
// (scripts/release.js writes it there from desktop/package.json): <!-- macOS 14.0 or later -->.
// A release without one opens wherever this version does.
const MIN_MAC = /^<!-- macOS ([\d.]+) or later -->\s*$/m
export const minMacOf = (notes) => String(notes || '').match(MIN_MAC)?.[1] || null

let last = { at: 0, latest: null, url: null, notes: null, minMac: null, error: null }
async function check(force = false) {
  if (!force && Date.now() - last.at < EVERY) return last
  try {
    const r = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'bridge-ai' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
    const j = await r.json()
    const body = String(j.body || '')
    last = { at: Date.now(), latest: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url, notes: body.replace(MIN_MAC, '').trim().slice(0, 4000), minMac: minMacOf(body), publishedAt: j.published_at || null, prerelease: !!j.prerelease, error: null }
  } catch (e) {
    last = { ...last, at: Date.now(), error: e.message }
  }
  return last
}

// How this copy was installed decides how it updates. The Docker image sets BRIDGE_DOCKER.
// BRIDGE_INSTALL_HOW (tests): stands in for it ('app': the desktop app on a Mac or Windows).
const HOWS = ['app', 'app-linux', 'docker', 'source']
const how = () => (HOWS.includes(process.env.BRIDGE_INSTALL_HOW) ? process.env.BRIDGE_INSTALL_HOW : IN_APP ? (IS_MAC || IS_WIN ? 'app' : 'app-linux') : process.env.BRIDGE_DOCKER ? 'docker' : 'source')
const COMMAND = { source: 'git pull && npm start', 'app-linux': `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh`, docker: 'docker compose pull && docker compose up -d' }

// A newer release this Mac can't open (m: machine()): { latest, macos: what it needs, have: what
// this Mac has }, or null. Any Mac, however Bridge AI was installed: from source too, the helpers
// it builds are built for that macOS. Pure, so tests can ask it about any Mac and release.
export function heldBack(s, m) {
  if (!s.latest || !newer(s.latest, current) || !s.minMac || m.platform !== 'darwin' || !m.os) return null
  return atLeast(m.os, s.minMac) ? null : { latest: s.latest, macos: s.minMac.replace(/\.0$/, ''), have: m.os }
}

// The newest release needs a newer macOS than this Mac has, whatever version anything here is: for
// the desktop app's own update (its version can be behind a server run from your clone, which
// heldBack compares with). { latest, macos, have }, or null.
export function below(s, m) {
  if (!s.latest || !s.minMac || m.platform !== 'darwin' || !m.os || atLeast(m.os, s.minMac)) return null
  return { latest: s.latest, macos: s.minMac.replace(/\.0$/, ''), have: m.os }
}

export async function status({ force = false, disabled = false } = {}) {
  if (disabled) return { current, disabled: true }
  const s = await check(force)
  const m = await machine()
  const held = heldBack(s, m)
  const low = below(s, m)
  return {
    current,
    latest: s.latest,
    available: !!(s.latest && newer(s.latest, current)) && !held,
    held,
    // For the desktop app's own update (UpdateChip.jsx withApp): the newest needs a newer macOS.
    below: low,
    url: s.url,
    notes: s.notes,
    checkedAt: s.at ? new Date(s.at).toISOString() : null,
    // When it came out: one that's been out a few days is said more plainly (UpdateChip.jsx), and
    // one only just out doesn't go in by itself yet (autoView).
    publishedAt: s.publishedAt || null,
    prerelease: !!s.prerelease,
    error: s.error,
    how: how(),
    // Shown when the app can't update itself: from source, Linux (the .deb asks for a password),
    // or Docker (on the device running it, in the folder with docker-compose.yml).
    command: COMMAND[how()] || null,
    // The desktop app can be updated from here even when this server is your clone (its window
    // knows its own version: the page compares).
    appUpdate: (how() === 'app' || (how() === 'source' && (IS_MAC || IS_WIN))) && !low,
    // The last update that didn't go through, while this server is still here to say so (one that
    // did replaces it). Its last line says why. One tried by itself while you were away is said
    // until it's tried again (auto: it was by itself).
    failed: lastRun?.failed && Date.now() - lastRun.at < 60 * 60 * 1000 ? lastRun.failed : autoFailed(s.latest),
  }
}

// Desktop app on macOS or Windows: run the installer on its own, outside this server, because it
// closes the app and stops this server, then installs and reopens the new version.
// The installer comes from the release it installs (its tag, not main), and the folder goes to it in
// its environment, never in the command.
// app: the desktop app only, for a server run from your clone: the installer replaces the app where
// it's running and opens it again, and leaves this server be (it stops only what's inside the app).
// BRIDGE_INSTALL_STANDIN: the tests' stand-in runs instead, told what would have.
// auto: by itself while you're away (the desktop app asks, desktop/main.js). Everything is asked
// again with GitHub's answer as it is now (a release pulled meanwhile isn't installed), and nothing
// starts unless it's still the time: { started: false, why } then.
let lastRun = null // { at, log, failed: { code, line, auto } | null }
export async function install({ app = false, auto = false } = {}) {
  const forApp = app && how() === 'source' && (IS_MAC || IS_WIN)
  if (how() !== 'app' && !forApp) throw new Error('This copy updates from a terminal; see the command shown.')
  const s = await check(true)
  const { latest } = s
  if (auto) {
    // And the app said it's the time within the last minute (it asks again right before this).
    const v = await autoView()
    const fresh = !!v.desktop && Date.now() - Date.parse(v.desktop.at) < 60 * 1000
    if (!v.ready || !fresh) return { started: false, why: v.why.length ? v.why : v.desktop?.why.length ? v.desktop.why : ['desktop'] }
  }
  if (!/^\d+\.\d+\.\d+$/.test(latest || '')) throw new Error('Couldn\'t find the newest version on GitHub; try again in a minute.')
  const m = await machine()
  const held = heldBack(s, m) || (forApp ? below(s, m) : null)
  if (held) throw new Error(`Bridge AI ${held.latest} needs macOS ${held.macos} or later, and this Mac has macOS ${held.have}.`)
  const tag = `v${latest}`
  const at = `https://raw.githubusercontent.com/${REPO}/${tag}`
  const log = path.join(ensureDir(cacheFile('update')), 'update.log')
  const out = fs.openSync(log, 'w')
  const dir = forApp ? await runningAppDir() : appDir()
  const env = { ...process.env, BRIDGE_VERSION: tag, ...(dir ? { BRIDGE_APP_DIR: dir } : {}) }
  const command = IS_WIN ? `irm ${at}/install.ps1 | iex` : `curl --proto '=https' -fsSL ${at}/install.sh | sh`
  const standIn = process.env.BRIDGE_INSTALL_STANDIN
  // On Windows the stand-in is a .cmd that runs Node. Started on its own (detached), cmd.exe has no
  // console, so the Node it runs gets one of its own and what it says misses the log: Node runs the
  // stand-in itself instead, handed the log as the installer is.
  const standInJs = IS_WIN && standIn && /\.cmd$/i.test(standIn) ? standIn.replace(/\.cmd$/i, '.cjs') : null
  const child = standIn
    ? standInJs && fs.existsSync(standInJs)
      ? spawn(process.execPath, [standInJs, Buffer.from(command).toString('base64')], { detached: true, stdio: ['ignore', out, out], windowsHide: true, env })
      : spawn(standIn, [Buffer.from(command).toString('base64')], { detached: true, stdio: ['ignore', out, out], env, shell: IS_WIN })
    : IS_WIN
      ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { detached: true, stdio: ['ignore', out, out], windowsHide: true, env })
      : spawn('/bin/sh', ['-c', command], { detached: true, stdio: ['ignore', out, out], env })
  // An update that works stops this server (the app's) on the way; one that fails before that (no
  // network, a download that doesn't match its checksum) is said here, with the installer's last words.
  const run = { at: Date.now(), log, failed: null }
  lastRun = run
  // Kept on disk too, as this server is stopped on the way: whether it went in by itself, and
  // which version not to try by itself again for a while if it didn't.
  const t = { version: latest, from: current, at: run.at, auto: !!auto, failed: null }
  setTried(t)
  const failed = (f) => { run.failed = { ...f, ...(auto ? { auto: true } : {}) }; setTried({ ...t, failed: f }) }
  child.on('exit', (code) => { const line = lastLine(log); if (didntGoThrough(code, line)) failed({ code, line: reasonOf(line) }) })
  child.on('error', (e) => failed({ code: -1, line: e.message }))
  child.unref()
  return { started: true, log }
}
// The installer's last words: what it was doing when it stopped. PowerShell ends its lines with \r\n.
function lastLine(log) {
  try { return String(fs.readFileSync(log, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '' } catch { return '' }
}
const reasonOf = (line) => line.replace(/^Bridge AI install:\s*/, '').slice(0, 300)
// An install that didn't go through: the installer stopped with an error, or said why it couldn't
// ("Bridge AI install: …", both installers' words for it, and only for it). install.ps1 says so and
// returns without an error, so a PowerShell window it was pasted into stays open: on Windows that
// line is the only sign.
export const didntGoThrough = (code, line) => !!code || /^Bridge AI install:/.test(line || '')

// ---------- Updating by itself while you're away ----------
// Settings › About & Updates › Update by itself while you're away: on unless turned off, in the
// desktop app on a Mac or Windows (where install() works). The desktop app asks once a minute
// (desktop/main.js), and this says what the server waits for (shared/autoupdate.js): a release
// that's offered here and has been out a few hours, and nothing running that an update would cut
// short (quiet, from index.js). The app says what it waits for itself (you're here, a window with
// unsaved work); that's kept a few minutes, for About & Updates to say why when it's been a while.
let settings = () => ({ on: true, checks: true })
let quiet = async () => ({ agents: null })
export const useSettings = (fn) => { settings = fn }
export const useQuiet = (fn) => { quiet = fn }
let desktopSaid = null // { why, at }
const SAID_FOR = 5 * 60 * 1000

// The last update this copy started ({ version, from, at, auto, failed }), in the cache.
const TRIED = () => path.join(cacheFile('update'), 'tried.json')
let tried
function lastTried() {
  if (tried === undefined) try { const x = JSON.parse(fs.readFileSync(TRIED(), 'utf8')); tried = x?.version ? x : null } catch { tried = null }
  return tried
}
function setTried(t) {
  tried = t
  try { ensureDir(cacheFile('update')); fs.writeFileSync(TRIED(), JSON.stringify(t)) } catch { /* kept in memory */ }
}
// An update by itself that didn't go through, said until it's tried again. One that stopped this
// server and then didn't bring the new version counts once it's had its time.
function autoFailed(latest) {
  const x = lastTried()
  if (!x?.auto || x.from !== current || x.version !== latest) return null
  const ago = Date.now() - x.at
  if (ago >= RETRY_HOURS * 60 * 60 * 1000 || (!x.failed && ago < INSTALL_MINUTES * 60 * 1000)) return null
  return { ...(x.failed || { code: null, line: reasonOf(lastLine(path.join(cacheFile('update'), 'update.log'))) }), auto: true }
}

// { on, release: there's one to update to, why: what the server waits for, desktop: what the app
// last said it waits for ({ why, at }, null when it hasn't lately), ready: neither waits, done: the
// update that went in by itself to this version ({ version, at }), kept until the next one }.
// said: what the desktop app waits for, now.
export async function autoView({ said } = {}) {
  if (Array.isArray(said)) desktopSaid = { why: said.filter((x) => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, 40)), at: Date.now() }
  const { on, checks } = settings()
  const u = await status({ disabled: !checks })
  const now = Date.now()
  const release = !releaseWhy({ u, on, checks, now }).length
  // What runs here is only asked while there's something to update to.
  const why = serverWhy({ u, on, checks, quiet: release ? await quiet().catch(() => ({ agents: null })) : {}, tried: lastTried(), current, now })
  const desktop = desktopSaid && now - desktopSaid.at < SAID_FOR ? { why: desktopSaid.why, at: new Date(desktopSaid.at).toISOString() } : null
  const x = lastTried()
  return {
    on, release, why, desktop,
    ready: release && !why.length && !!desktop && !desktop.why.length,
    done: x?.auto && x.version === current ? { version: x.version, at: new Date(x.at).toISOString() } : null,
  }
}

// The desktop app that's open now (its window shows this server), for its update to go where it is.
// From a Mac's list of programs: the folder of a running Bridge AI app.
function runningAppDir() {
  if (!IS_MAC) return Promise.resolve(null)
  return new Promise((resolve) => execFile('ps', ['-axo', 'command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    const m = err ? null : /^(\/.*?)\/Bridge AI\.app\/Contents\/MacOS\/Bridge AI$/m.exec(String(out))
    resolve(m && !m[1].includes('/AppTranslocation/') ? m[1] : null)
  }))
}

// The folder this app is installed in (so an update replaces it where it is, not in a new place).
// The outermost .app: the server runs on the Helper inside it (desktop/main.js). Opened straight
// from the .dmg, or copied there other than with Finder, macOS runs it from a read-only copy of its
// own (App Translocation), which can't be replaced: then none, and the installer puts the update in
// Applications as for a new install.
function appDir() {
  const m = process.execPath.match(/^(.*?)\/[^/]+\.app\/Contents\//)
  return m && !m[1].includes('/AppTranslocation/') ? m[1] : null
}
