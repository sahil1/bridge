// The apps on this computer that open what Studio edits, for its "Open in Word" (Excel,
// PowerPoint), else Apple's Pages, Numbers or Keynote, else LibreOffice. Looked for once, in the
// background, from when Studio's home first asks for your files, and kept (looked again after an
// hour, for one installed since); no request waits on the look, and until it's done the answer
// says so. Nothing here reads your folders or asks the system anything that needs your say:
//   a Mac: /Applications and ~/Applications (and the folders in them), by each app's bundle id in
//     Spotlight's index of them, and by name for when Spotlight is off;
//   Windows: the registry's App Paths, where Office (and LibreOffice) say where their programs are;
//   Linux: LibreOffice's soffice or libreoffice on the PATH.
// An app is offered only once it's found where it was said to be. Opening goes through the app
// itself (open -a on a Mac, its program elsewhere), only on this computer and only for a kind of
// file it opens. Studio keeps watching the file, so what you save there comes back to Studio as a
// change from outside.
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { HOME, NODE } from './paths.js'
import { loginPath, which } from './agents.js'

// Studio's kinds each app opens, in the order they're offered: Microsoft's, then Apple's, then
// LibreOffice. A Markdown file, a page or a PDF opens in its usual app instead.
const DOC = ['.docx']
const SHEET = ['.xlsx', '.xlsm', '.csv', '.tsv']
const DECK = ['.pptx']
export const APPS = [
  { id: 'word', name: 'Word', exts: DOC, bundle: 'com.microsoft.Word', app: 'Microsoft Word.app', exe: 'winword.exe' },
  { id: 'excel', name: 'Excel', exts: SHEET, bundle: 'com.microsoft.Excel', app: 'Microsoft Excel.app', exe: 'excel.exe' },
  { id: 'powerpoint', name: 'PowerPoint', exts: DECK, bundle: 'com.microsoft.Powerpoint', app: 'Microsoft PowerPoint.app', exe: 'powerpnt.exe' },
  { id: 'pages', name: 'Pages', exts: DOC, bundle: 'com.apple.iWork.Pages', app: 'Pages.app' },
  { id: 'numbers', name: 'Numbers', exts: ['.xlsx', '.csv'], bundle: 'com.apple.iWork.Numbers', app: 'Numbers.app' },
  { id: 'keynote', name: 'Keynote', exts: DECK, bundle: 'com.apple.iWork.Keynote', app: 'Keynote.app' },
  { id: 'libreoffice', name: 'LibreOffice', exts: [...DOC, ...SHEET, ...DECK], bundle: 'org.libreoffice.script', app: 'LibreOffice.app', exe: 'soffice.exe', bins: ['soffice', 'libreoffice'] },
]
// LibreOffice opens each kind in its own part of the suite.
const PART = Object.fromEntries([...DOC.map((e) => [e, '--writer']), ...SHEET.map((e) => [e, '--calc']), ...DECK.map((e) => [e, '--impress'])])
const LOOK_MS = 8000 // the longest each way of looking is waited for
const KEEP_MS = 60 * 60_000 // looked again after an hour, in the background

const exists = (p) => fsp.access(p).then(() => true, () => false)
// A program's output, or '' when it isn't there, fails or takes too long. A stand-in script (a
// test's) runs on the app's own Node.
function output(bin, args, env) {
  const script = /\.c?js$/.test(bin)
  return new Promise((resolve) => {
    execFile(script ? NODE.bin : bin, script ? [bin, ...args] : args, { timeout: LOOK_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...env, ...(script ? NODE.env : {}) } }, (err, out) => resolve(err && !out ? '' : String(out || '')))
  })
}

// ---------- A Mac ----------
// Spotlight's answer, each app's path with its bundle id (mdfind -attr). One in the Trash, or inside
// another app, isn't one you'd open.
export function spotlightApps(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const m = /^(\/.*?\.app) {3}kMDItemCFBundleIdentifier = (.+)$/.exec(line.trim())
    if (m && !/\/\.Trash(es)?\/|\.app\/.+\.app$/.test(m[1])) out.push({ path: m[1], bundle: m[2].trim() })
  }
  return out
}
async function onMac({ home, env }) {
  // BRIDGE_APPLICATIONS (tests): the computer's own Applications folder.
  const dirs = [env.BRIDGE_APPLICATIONS || '/Applications', path.join(home, 'Applications')]
  const query = APPS.map((a) => `kMDItemCFBundleIdentifier == "${a.bundle}"`).join(' || ')
  const spot = spotlightApps(await output('mdfind', [...dirs.flatMap((d) => ['-onlyin', d]), '-attr', 'kMDItemCFBundleIdentifier', query], env))
  const found = {}
  for (const a of APPS) {
    const named = dirs.map((d) => path.join(d, a.app))
    // Where you'd keep it first, then wherever Spotlight knows it is.
    for (const p of [...named, ...spot.filter((s) => s.bundle.toLowerCase() === a.bundle.toLowerCase()).map((s) => s.path)]) {
      if (await exists(p)) { found[a.id] = p; break }
    }
  }
  return found
}

// ---------- Windows ----------
// reg query's answer for App Paths (with /s): each program's key, then its values. The program is
// the value that names it (its default value, whose name Windows writes in your language),
// quoted or not, with %ProgramFiles% and the like as they are on this computer.
export function registryApps(text, env = process.env) {
  const out = {}
  let key = null
  const expand = (s) => s.replace(/%([^%]+)%/g, (m, n) => env[n] ?? env[Object.keys(env).find((k) => k.toLowerCase() === n.toLowerCase())] ?? m)
  for (const raw of String(text).split(/\r?\n/)) {
    const k = /^HKEY_[A-Z_]+\\.*\\App Paths\\([^\\]+)$/i.exec(raw.trim())
    if (k) { key = k[1].toLowerCase(); continue }
    const v = /^\s+.*?\s{4}REG_(?:EXPAND_)?SZ\s{4}(.+)$/.exec(raw)
    if (!key || !v) continue
    const file = expand(v[1].trim().replace(/^"(.*)"$/, '$1'))
    if (path.win32.basename(file).toLowerCase() === key && !out[key]) out[key] = file
  }
  return out
}
async function onWindows({ env }) {
  // BRIDGE_REG (tests): a stand-in for reg.exe.
  const reg = env.BRIDGE_REG || 'reg'
  const keys = ['HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths']
  const said = {}
  for (const text of await Promise.all(keys.map((k) => output(reg, ['query', k, '/s'], env)))) {
    for (const [exe, file] of Object.entries(registryApps(text, env))) said[exe] ||= file
  }
  const found = {}
  for (const a of APPS) if (a.exe && said[a.exe] && await exists(said[a.exe])) found[a.id] = said[a.exe]
  return found
}

// ---------- Linux ----------
async function onLinux({ PATH }) {
  for (const b of APPS.find((a) => a.id === 'libreoffice').bins) {
    const p = await which(b, PATH)
    if (p) return { libreoffice: p }
  }
  return {}
}

// The apps found, by id: { word: '/Applications/Microsoft Word.app', ... }. platform, home, env and
// PATH are this computer's unless a test gives its own.
export async function look({ platform = process.platform, home = HOME, env = process.env, PATH } = {}) {
  if (platform === 'darwin') return onMac({ home, env })
  if (platform === 'win32') return onWindows({ env })
  return onLinux({ PATH: PATH ?? await loginPath() })
}

let known = null // { at, apps }
let looking = null
function refresh() {
  looking ||= look().catch(() => ({})).then((apps) => { known = { at: Date.now(), apps }; looking = null; return known })
  return looking
}
// The app that opens a kind of file (by its extension), from what's found: { id, name, path } or null.
const appFor = (ext, apps) => {
  const a = APPS.find((x) => x.exts.includes(String(ext).toLowerCase()) && apps[x.id])
  return a ? { id: a.id, name: a.name, path: apps[a.id] } : null
}

// The look started, without waiting for it, unless it's been made in the last hour.
export function warm() { if (!known || Date.now() - known.at > KEEP_MS) refresh() }
// For Studio's header: the app for each kind of file it opens, { '.docx': { id, name }, ... }, and
// whether the look has been made (looked: false, ask again in a moment).
export function forStudio() {
  warm()
  if (!known) return { looked: false, apps: {} }
  const apps = {}
  for (const ext of [...new Set(APPS.flatMap((a) => a.exts))]) { const a = appFor(ext, known.apps); if (a) apps[ext] = { id: a.id, name: a.name } }
  return { looked: true, apps }
}

// Opens a file (its real path, checked by the caller) in its app. Says which, or why it can't.
export async function openIn(real) {
  const ext = path.extname(real).toLowerCase()
  const a = appFor(ext, (known || await refresh()).apps)
  if (!a) throw Object.assign(new Error('No app on this computer opens this kind of file here: open it in its usual app'), { status: 404 })
  if (!(await exists(a.path))) { known = null; throw Object.assign(new Error(`${a.name} isn't where it was any more`), { status: 404 }) }
  if (process.platform === 'darwin') {
    await new Promise((resolve, reject) => execFile('open', ['-a', a.path, real], { timeout: 30_000 }, (err, _o, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n')[0] || `${a.name} didn't open it`)) : resolve())))
  } else {
    // Its own program, left running on its own: LibreOffice in the part for this kind of file.
    const args = a.id === 'libreoffice' ? [PART[ext], real] : [real]
    await new Promise((resolve, reject) => {
      const kid = spawn(a.path, args, { detached: true, stdio: 'ignore', windowsHide: false })
      kid.once('error', (e) => reject(new Error(`${a.name} didn't start: ${e.message}`)))
      kid.once('spawn', () => { kid.unref(); resolve() })
    })
  }
  return { ok: true, app: a.name }
}
