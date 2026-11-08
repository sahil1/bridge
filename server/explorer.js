// Files, a beta feature (src/components/files/): your folders as Finder shows them. The home folder
// and this computer's drives are roots beside agents' folders and places, read through the same
// routes (files.js: listing, the viewer, open in its app, show in Finder), and this lists them for
// its sidebar, lists a folder as Finder does, and answers Get Info, a folder's size and a search
// below a folder.
//
// Who can read through these roots: this computer, and your own devices, the computers you linked
// and the phones you paired, whose requests come over an end-to-end encrypted link only they have
// the keys to (relay.js, machines.js). They can already open a terminal here, which reads anything
// you can, so browsing your home folder gives them nothing they couldn't reach before. A web page
// can't: the server's guard (guard.js) turns other sites away, and a page's files (the HTML preview)
// are served from these roots only to Bridge AI's own preview. Kept out whatever the root:
// Bridge AI's own folder (it holds the link's keys) and your keys' folders (files.js KEPT_OUT). A
// root is only ever one of these (rootDir); anything else is refused. And Files only looks for now:
// nothing renames, moves or deletes through these roots (index.js refuses it).
//
// macOS asks before an app reads Desktop, Documents, Downloads, iCloud Drive or a removable or
// network drive, and holds that first read until you answer. So nothing here reads one before you
// open it: the sidebar names them without a look, a folder's listing doesn't look into them (their
// size and date wait until they're opened), and a search or a folder's size never goes into one
// macOS hasn't asked about (projects.mayLook). From another of your devices, one macOS hasn't asked
// about isn't opened at all (nobody would be at this computer to answer): it says so instead. And
// every read waits a bounded time (WAIT): one still held then (macOS's question up, a cloud drive
// fetching, a network drive gone quiet) answers "waiting", and asking again joins the same read
// rather than starting another. Nothing here blocks the server: every call is async.
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { safePath } from './files.js'
import { mayLook, noteAsked } from './projects.js'

const HOME = os.homedir()
const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'
// How long a read is waited for before the answer is "waiting" (a test makes it short).
const WAIT = Number(process.env.BRIDGE_FILES_WAIT_MS) || 8000
const MAX_LIST = 5000 // the most entries a folder lists (the rest are counted)
const STATS_AT_ONCE = 48
const SEARCH_MAX = 300 // the most a search finds
const SEARCH_DIRS = 20000 // the most folders a search goes through
const SEARCH_MS = 20000
const SIZE_ENTRIES = 400000 // the most a folder's size counts
const SIZE_MS = 60000

const err = (message, status, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
const under = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)
const slash = (p) => p.split(path.sep).join('/')
export const tilde = (p) => (under(p, HOME) ? `~${p.slice(HOME.length)}` : p)
// Where a folder is, said from your home folder (~) when it's in it: home is the home folder as its
// real path, which is how what's in it is named (links followed, Windows' own spelling of it).
const whereIs = (p, home) => (home && under(p, home) ? `~${p.slice(home.length)}` : tilde(p))

// ---------- What macOS asks about, and the cloud drives ----------
// The folder macOS asks about that p is in: Desktop, Documents, Downloads, iCloud Drive, or a drive
// in /Volumes (removable or network). Worked out from the path alone, so it's never a read.
const LIB = path.join(HOME, 'Library')
const ICLOUD = path.join(LIB, 'Mobile Documents')
const CLOUDS = path.join(LIB, 'CloudStorage')
export function guardOf(p) {
  if (!IS_MAC) return null
  for (const f of ['Desktop', 'Documents', 'Downloads']) if (under(p, path.join(HOME, f))) return f
  if (under(p, ICLOUD)) return 'iCloud Drive'
  if (under(p, '/Volumes') && p !== '/Volumes') return 'volume'
  return null
}
// The cloud drive p is in, if any: its files may only be stand-ins until opened (OneDrive's, iCloud's,
// Dropbox's files on demand), so nothing reads them to make a picture, and a search or a folder's size
// doesn't go into one from outside it. Its folder, or null.
const CLOUD_NAME = /^(OneDrive|Dropbox|Google ?Drive|GoogleDrive|Box|iCloud ?Drive)\b/i
export function cloudOf(p) {
  if (IS_MAC) {
    if (under(p, ICLOUD)) return ICLOUD
    if (under(p, CLOUDS) && p !== CLOUDS) return path.join(CLOUDS, path.relative(CLOUDS, p).split(path.sep)[0])
  }
  if (under(p, HOME) && p !== HOME) {
    const top = path.relative(HOME, p).split(path.sep)[0]
    if (CLOUD_NAME.test(top)) return path.join(HOME, top)
  }
  for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) if (process.env[v] && under(p, path.resolve(process.env[v]))) return path.resolve(process.env[v])
  return null
}

// ---------- Hidden, as Finder and Explorer hide them ----------
const LEFTOVERS = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '$RECYCLE.BIN', '$Recycle.Bin', 'System Volume Information', 'Icon\r', '.localized'])
// Finder hides these at the top of the startup disk, and your Library in your home folder.
const MAC_ROOT = new Set(['bin', 'cores', 'dev', 'etc', 'home', 'opt', 'private', 'sbin', 'tmp', 'usr', 'var', 'Volumes', 'System Volumes'])
// Windows marks these hidden (Node can't read the mark): the old names linked to new ones, and its own.
const WIN_HIDDEN = /^(ntuser\..*|AppData|Application Data|Cookies|Local Settings|My Documents|NetHood|PrintHood|Recent|SendTo|Start Menu|Templates|pagefile\.sys|hiberfil\.sys|swapfile\.sys|DumpStack\.log.*|Documents and Settings|Recovery|ProgramData|Config\.Msi|MSOCache)$/i
function hiddenIn(dir, name) {
  if (name.startsWith('.') || LEFTOVERS.has(name)) return true
  if (IS_MAC) return (dir === '/' && MAC_ROOT.has(name)) || (dir === HOME && name === 'Library')
  if (IS_WIN) return WIN_HIDDEN.test(name)
  return false
}
// A folder that's one thing on a Mac (an app, a Keynote deck): shown as a file, opened as one.
const PACKAGE = /\.(app|key|pages|numbers|bundle|photoslibrary|musiclibrary|tvlibrary|rtfd|framework|plugin|kext|xcodeproj|xcworkspace|playground|band|logicx|fcpbundle|imovielibrary)$/i
const isPackage = (name) => IS_MAC && PACKAGE.test(name)

// ---------- Waiting a bounded time ----------
// A read that hasn't answered in WAIT is answered "waiting" and goes on: asking again joins it, and
// once it's done, the next ask (within KEEP) takes its answer rather than reading all over again (a
// slow drive would be slow again).
const KEEP = 30000
const pending = new Map() // key -> { p, late, at }
function within(key, fn, ms = WAIT) {
  let x = pending.get(key)
  if (x?.at && Date.now() - x.at > KEEP) { pending.delete(key); x = null }
  if (!x) {
    x = { p: fn(), late: false, at: 0 }
    // Answered by whoever's waiting for it, or by nobody (so its failure isn't left uncaught).
    const settled = () => { if (x.late) x.at = Date.now(); else if (pending.get(key) === x) pending.delete(key) }
    x.p.then(settled, settled)
    pending.set(key, x)
  } else if (x.at) pending.delete(key) // a late answer, taken now
  let timer
  const late = new Promise((_, reject) => { timer = setTimeout(() => { x.late = true; reject(err('This folder hasn\'t answered yet', 504, 'waiting')) }, ms) })
  return Promise.race([x.p, late]).finally(() => clearTimeout(timer))
}
// What a read's error says, in words: macOS said no (EPERM), no permission (EACCES), gone.
function said(e) {
  if (e.status) return e
  if (e.code === 'EPERM') return err(IS_MAC ? 'macOS hasn\'t let Bridge AI in here' : 'Not allowed to open this', 403, 'EPERM')
  if (e.code === 'EACCES') return err('You don\'t have permission to open this', 403, 'EACCES')
  if (e.code === 'ENOENT' || e.message === 'Not found') return err('It isn\'t there any more', 404, 'gone')
  if (/Outside the agent folder/.test(e.message)) return err('That\'s outside this folder', 403, 'outside')
  if (e.code === 'keptOut') return err(e.message, 403, 'keptOut')
  if (e.code === 'ENOTDIR') return err('Not a folder', 400)
  return e
}
// A whole job bounded by time and number, and stopped when it's no longer wanted.
const limiter = (n) => {
  let busy = 0
  const queue = []
  return async (fn) => {
    if (busy >= n) await new Promise((r) => queue.push(r))
    busy++
    try { return await fn() } finally { busy--; queue.shift()?.() }
  }
}

// ---------- The roots ----------
// home: your home folder. drive:<key>: one of this computer's drives (drives()). Nothing else.
export const isFilesRoot = (id) => id === 'home' || String(id || '').startsWith('drive:')
const keyOf = (dir) => (dir === '/' ? 'root' : IS_WIN && /^[A-Z]:\\$/i.test(dir) ? dir[0].toUpperCase() : `b${Buffer.from(dir).toString('base64url')}`)
const run = (cmd, args, ms = 4000) => new Promise((resolve) => execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 1024 * 1024 }, (e, out) => resolve(e ? '' : String(out))))
const names = (dir) => fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
const isDir = (p, ms = 1500) => within(`isdir\n${p}`, () => fsp.stat(p).then((s) => s.isDirectory(), () => false), ms).catch(() => false)

// This computer's drives: the startup disk and every other one. On a Mac, /Volumes names them
// (read for its names alone; a drive's own folder isn't looked at until you open it). On Windows,
// each drive letter that answers. On Linux, / and what's mounted in /media, /run/media and /mnt.
let drivesAt = 0
let drivesWere = null
export async function drives() {
  if (drivesWere && Date.now() - drivesAt < 5000) return drivesWere
  const out = []
  if (IS_MAC) {
    const vols = await names('/Volumes')
    const boot = vols.find((d) => d.isSymbolicLink())
    out.push({ dir: '/', label: boot?.name || 'Macintosh HD', boot: true })
    for (const d of vols) if (!d.isSymbolicLink() && !d.name.startsWith('.')) out.push({ dir: path.join('/Volumes', d.name), label: d.name, guard: 'volume' })
  } else if (IS_WIN) {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    const there = await Promise.all(letters.map((l) => isDir(`${l}:\\`)))
    letters.forEach((l, i) => { if (there[i]) out.push({ dir: `${l}:\\`, label: `${l}:`, boot: `${l}:\\`.toUpperCase() === path.parse(HOME).root.toUpperCase() }) })
  } else {
    out.push({ dir: '/', label: 'Computer', boot: true })
    const user = os.userInfo().username
    for (const base of [path.join('/media', user), path.join('/run/media', user), '/mnt']) {
      for (const d of await names(base)) if (d.isDirectory() && !d.name.startsWith('.')) out.push({ dir: path.join(base, d.name), label: d.name })
    }
  }
  drivesWere = out.map((d) => ({ ...d, root: `drive:${keyOf(d.dir)}` }))
  drivesAt = Date.now()
  return drivesWere
}

// A root's folder: your home folder, or a drive that's here. Anything else is refused.
export async function rootDir(id) {
  if (id === 'home') return HOME
  let d = (await drives()).find((x) => x.root === id)
  if (!d) { drivesAt = 0; d = (await drives()).find((x) => x.root === id) } // one plugged in since
  if (!d) throw err('That drive isn\'t connected any more', 404, 'gone')
  return d.dir
}

// Where a folder is, as a root and a path in it: on a drive other than the startup disk, in your
// home folder, or on the startup disk. Worked out from the path alone.
export async function locate(dir) {
  const full = path.resolve(dir)
  const others = (await drives()).filter((d) => !d.boot && under(full, d.dir)).sort((a, b) => b.dir.length - a.dir.length)
  if (others[0]) return { root: others[0].root, path: slash(path.relative(others[0].dir, full)) }
  if (under(full, HOME)) return { root: 'home', path: slash(path.relative(HOME, full)) }
  const disk = (await drives()).find((d) => under(full, d.dir))
  return disk ? { root: disk.root, path: slash(path.relative(disk.dir, full)) } : null
}

// ---------- The sidebar ----------
// Your usual folders. On a Mac they're always there and macOS asks about three of them, so they're
// named without a look. On Windows they can have moved (to OneDrive, say): the registry says where.
// On Linux, the desktop's own list (user-dirs.dirs).
const WIN_SHELL = [['Desktop', 'Desktop', 'screen'], ['Personal', 'Documents', 'doc'], ['{374DE290-123F-4565-9164-39C4925E467B}', 'Downloads', 'download'], ['My Pictures', 'Pictures', 'image'], ['My Music', 'Music', 'volume'], ['My Video', 'Videos', 'video']]
const XDG = [['DESKTOP', 'Desktop', 'screen'], ['DOCUMENTS', 'Documents', 'doc'], ['DOWNLOAD', 'Downloads', 'download'], ['PICTURES', 'Pictures', 'image'], ['MUSIC', 'Music', 'volume'], ['VIDEOS', 'Videos', 'video']]
const envVar = (name) => Object.entries(process.env).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] || ''
async function usual() {
  if (IS_MAC) {
    return [['Desktop', 'screen'], ['Documents', 'doc'], ['Downloads', 'download']].map(([f, icon]) => ({ dir: path.join(HOME, f), label: f, icon, guard: f }))
      .concat([{ dir: '/Applications', label: 'Applications', icon: 'grid' }])
  }
  let found = []
  if (IS_WIN) {
    const reg = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'])
    const vals = Object.fromEntries([...reg.matchAll(/^\s+(.+?)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/gm)].map((m) => [m[1], m[2].replace(/%([^%]+)%/g, (_, v) => envVar(v) || `%${v}%`)]))
    found = WIN_SHELL.map(([key, label, icon]) => ({ dir: vals[key] && !vals[key].includes('%') ? vals[key] : path.join(HOME, label), label, icon }))
  } else {
    const conf = await fsp.readFile(path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'user-dirs.dirs'), 'utf8').catch(() => '')
    const vals = Object.fromEntries([...conf.matchAll(/^XDG_(\w+)_DIR="(.*)"/gm)].map((m) => [m[1], m[2].replace(/^\$HOME/, HOME)]))
    found = XDG.map(([key, label, icon]) => ({ dir: vals[key] || path.join(HOME, label), label: vals[key] ? path.basename(vals[key]) : label, icon })).filter((x) => x.dir !== HOME)
  }
  const there = await Promise.all(found.map((x) => isDir(x.dir)))
  return found.filter((_, i) => there[i])
}
// Your cloud drives: iCloud Drive and ~/Library/CloudStorage's on a Mac (named from the folders' own
// names: what's in them isn't looked at), OneDrive wherever Windows keeps it, and the ones in your
// home folder (Dropbox, Google Drive, Box).
const CLOUD_LABEL = [[/^OneDrive/i, 'OneDrive'], [/^(GoogleDrive|Google Drive)/i, 'Google Drive'], [/^Dropbox/i, 'Dropbox'], [/^Box\b/i, 'Box'], [/^iCloud ?Drive/i, 'iCloud Drive']]
function cloudLabel(name) {
  const hit = CLOUD_LABEL.find(([re]) => re.test(name))
  if (!hit) return { label: name, account: null }
  // OneDrive-Personal, OneDrive-Contoso, GoogleDrive-someone@example.com: the part after the name.
  const rest = name.replace(hit[0], '').replace(/^[-\s]+/, '')
  return { label: hit[1], account: rest || null }
}
async function clouds() {
  const out = []
  if (IS_MAC) {
    const lib = await names(LIB)
    if (lib.some((d) => d.name === 'Mobile Documents')) out.push({ dir: path.join(ICLOUD, 'com~apple~CloudDocs'), label: 'iCloud Drive', guard: 'iCloud Drive', icon: 'cloud' })
    if (lib.some((d) => d.name === 'CloudStorage')) {
      for (const d of await names(CLOUDS)) if (d.isDirectory() && !d.name.startsWith('.')) out.push({ dir: path.join(CLOUDS, d.name), ...cloudLabel(d.name), icon: 'cloud' })
    }
  }
  const seen = new Set(out.map((x) => x.dir))
  for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const d = process.env[v] && path.resolve(process.env[v])
    if (d && !seen.has(d) && await isDir(d)) { seen.add(d); out.push({ dir: d, ...cloudLabel(path.basename(d)), icon: 'cloud' }) }
  }
  for (const d of await names(HOME)) {
    const full = path.join(HOME, d.name)
    if (d.isDirectory() && CLOUD_NAME.test(d.name) && !seen.has(full)) { seen.add(full); out.push({ dir: full, ...cloudLabel(d.name), icon: 'cloud' }) }
  }
  return out
}

// The sidebar: Home, your usual folders, your cloud drives, your projects (agents' folders) and
// places, and this computer's drives. Each as a root and a path in it. asked: macOS has asked about
// it already (or never will), so opening it brings up no question. Nothing here reads a folder
// macOS asks about.
export async function sidebar({ projects = [], places = [] } = {}) {
  const at = async (x) => {
    const where = await locate(x.dir)
    return where && { ...where, label: x.label, icon: x.icon || 'folder', full: tilde(x.dir), ...(x.guard ? { guard: x.guard, asked: mayLook(x.dir) } : {}), ...(x.account ? { account: x.account } : {}), ...(x.id ? { id: x.id } : {}) }
  }
  const [favs, cl, ds] = await Promise.all([usual(), clouds(), drives()])
  const all = async (list) => (await Promise.all(list.map(at))).filter(Boolean)
  // One row per folder, however many agents work in it.
  const seen = new Set()
  const own = projects.filter((p) => p.dir && !seen.has(p.dir) && seen.add(p.dir))
  return {
    os: IS_MAC ? 'mac' : IS_WIN ? 'windows' : 'linux',
    home: { root: 'home', path: '', label: 'Home', icon: 'home', full: tilde(HOME) },
    favorites: await all(favs),
    clouds: await all(cl),
    projects: await all(own.map((p) => ({ dir: p.dir, label: p.label || path.basename(p.dir) || p.dir, icon: 'code' }))),
    places: await all(places.map((p) => ({ dir: p.dir, label: p.label, icon: 'pin', id: p.id }))),
    drives: ds.map((d) => ({ root: d.root, path: '', label: d.label, icon: 'drive', full: d.dir, boot: !!d.boot, ...(d.guard ? { guard: d.guard, asked: mayLook(d.dir) } : {}) })),
  }
}

// ---------- A folder ----------
// From another of your devices, a folder macOS hasn't asked about isn't opened: its question would
// come up here with nobody to answer it, and the read would wait until someone did.
export function notFromAfar(dir, { here }) {
  const g = guardOf(dir)
  if (here || !g || mayLook(dir)) return
  const name = g === 'volume' ? 'this drive' : g
  throw err(`macOS hasn't let Bridge AI into ${name} on this computer yet. Open it once in Bridge AI on the computer itself, and choose Allow.`, 403, 'notAsked')
}
export async function lexical(root, rel) { return path.resolve(await rootDir(root), String(rel || '').replace(/^\/+/, '')) }

// Its entries, as Finder lists them: hidden ones left out unless asked for, a folder macOS asks about
// named without a look, the first MAX_LIST by name (the rest counted). Each: its name, path in the
// root, whether it's a folder (or a package, shown as a file), size, when it changed and was made,
// whether it's a link, and on a cloud drive, whether it's only a stand-in for now (offline).
export function list(root, dir, rel, { hidden = false } = {}) {
  return within(`list\n${dir}\n${rel}\n${hidden}`, async () => {
    const { real, realRoot, rel: r } = await safePath(dir, rel).catch((e) => { throw said(e) })
    const g = guardOf(real)
    let ents
    try { ents = await fsp.readdir(real, { withFileTypes: true }) } catch (e) { throw e.code === 'ENOTDIR' ? err('Not a folder', 400, 'file') : said(e) } finally { if (g) noteAsked(real) } // macOS has asked now, whatever you said
    const cloud = cloudOf(real)
    const shown = ents.filter((e) => (hidden ? !LEFTOVERS.has(e.name) : !hiddenIn(real, e.name)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    const take = shown.slice(0, MAX_LIST)
    const one = limiter(STATS_AT_ONCE)
    const rows = await Promise.all(take.map((e) => one(async () => {
      const full = path.join(real, e.name)
      const base = { name: e.name, path: r ? `${slash(r)}/${e.name}` : e.name, ...(e.name.startsWith('.') || hiddenIn(real, e.name) ? { hidden: true } : {}) }
      // A folder macOS asks about (Desktop in your home folder, a drive in /Volumes): named, not looked at.
      const gg = guardOf(full)
      if (gg && gg !== g) return { ...base, dir: true, size: null, mtime: null, guard: gg, asked: mayLook(full) }
      if (!cloud && cloudOf(full)) return { ...base, dir: true, size: null, mtime: null, cloud: true }
      const st = await fsp.stat(full).catch(() => null)
      if (!st) return { ...base, dir: false, size: 0, mtime: null, link: e.isSymbolicLink(), broken: true }
      const dirEntry = st.isDirectory()
      return {
        ...base, dir: dirEntry && !isPackage(e.name), ...(dirEntry && isPackage(e.name) ? { pkg: true } : {}),
        size: dirEntry ? null : st.size, mtime: st.mtimeMs, btime: st.birthtimeMs || null, ...(e.isSymbolicLink() ? { link: true } : {}),
        // Stand-ins on a cloud drive take no room on disk until they're opened (not on Windows, where
        // Node can't tell): never read to make a picture, and opening one downloads it.
        ...(cloud && !IS_WIN && !dirEntry && st.size > 0 && st.blocks === 0 ? { offline: true } : {}),
      }
    })))
    return { root, path: slash(r), full: real, top: realRoot, name: path.basename(real) || real, entries: rows, total: shown.length, more: Math.max(0, shown.length - take.length), ...(g ? { guard: g } : {}), ...(cloud ? { cloud: true } : {}) }
  })
}

// Get Info: what it is, where, how big (a folder's size is worked out when asked: size()), when it
// was made, changed and last opened, and whether you can change it.
export function info(root, dir, rel) {
  return within(`info\n${dir}\n${rel}`, async () => {
    const { real, realRoot, rel: r } = await safePath(dir, rel).catch((e) => { throw said(e) })
    const st = await fsp.stat(real).catch((e) => { throw said(e) })
    const lst = await fsp.lstat(path.resolve(dir, String(rel || '').replace(/^\/+/, ''))).catch(() => null)
    const writable = await fsp.access(real, 2).then(() => true, () => false) // W_OK
    const name = path.basename(real) || real
    const folder = st.isDirectory() && !isPackage(name)
    const cloud = cloudOf(real)
    return {
      root, path: slash(r), name, full: real, where: whereIs(path.dirname(real), root === 'home' ? realRoot : null), dir: folder, ...(st.isDirectory() && isPackage(name) ? { pkg: true } : {}),
      size: folder ? null : st.size, created: st.birthtimeMs || null, modified: st.mtimeMs, opened: st.atimeMs, writable,
      ...(lst?.isSymbolicLink() ? { link: true } : {}), ...(guardOf(real) ? { guard: guardOf(real) } : {}), ...(cloud ? { cloud: true } : {}),
      ...(cloud && !IS_WIN && !st.isDirectory() && st.size > 0 && st.blocks === 0 ? { offline: true } : {}),
    }
  })
}

// ---------- Going through a folder: its size, a search ----------
// Folders a walk from above them doesn't go into: one macOS would ask about first, a cloud drive (its
// stand-ins would be listed from the network), your Library (other apps' own files: macOS asks about
// those too), other drives, and the system's own. Each is named in the answer, so it says what wasn't
// counted. A walk that starts inside one goes through it.
const SYSTEM = IS_MAC ? ['/System/Volumes', '/Volumes', '/dev', '/private/var/vm', '/cores'] : IS_WIN ? [] : ['/proc', '/sys', '/dev', '/run', '/media', '/mnt', '/snap']
function skipFor(start) {
  return (full) => {
    if (SYSTEM.some((s) => under(full, s) && !under(start, s))) return 'system'
    if (IS_MAC && full === LIB && !under(start, LIB)) return 'Library'
    const g = guardOf(full)
    if (g && !under(start, full) && !mayLook(full)) return g === 'volume' ? path.basename(full) : g
    const c = cloudOf(full)
    if (c && !under(start, c)) return path.basename(c)
    return null
  }
}
const NOISE = new Set(['node_modules', '.git'])

// A folder's size: every file in it, links not followed, up to SIZE_ENTRIES files or SIZE_MS
// (partial then), stopped when you close Get Info. What it didn't go into is named (skipped).
export async function size(dir, rel, { signal } = {}) {
  const { real } = await within(`real\n${dir}\n${rel}`, () => safePath(dir, rel)).catch((e) => { throw said(e) })
  const skip = skipFor(real)
  const until = Date.now() + SIZE_MS
  const one = limiter(16)
  let bytes = 0, files = 0, folders = 0, partial = false
  const skipped = new Set()
  const walk = async (d) => {
    if (signal?.aborted || partial) return
    if (Date.now() > until || files + folders > SIZE_ENTRIES) { partial = true; return }
    const ents = await one(() => within(`dir\n${d}`, () => fsp.readdir(d, { withFileTypes: true }), 5000)).catch(() => { partial = true; return [] })
    const subs = []
    await Promise.all(ents.map((e) => one(async () => {
      const full = path.join(d, e.name)
      if (e.isSymbolicLink()) return
      if (e.isDirectory()) {
        const why = skip(full)
        if (why) { skipped.add(why); return }
        folders++
        subs.push(full)
        return
      }
      const st = await fsp.lstat(full).catch(() => null)
      if (st) { bytes += st.size; files++ }
    })))
    await Promise.all(subs.map(walk))
  }
  await walk(real)
  if (signal?.aborted) throw err('Stopped', 499, 'stopped')
  skipped.delete('system')
  return { size: bytes, files, folders, partial, skipped: [...skipped] }
}

// Files and folders whose name has q in it, in a folder and below it: breadth first (the nearest
// first), up to SEARCH_MAX found, SEARCH_DIRS folders or SEARCH_MS (partial then), stopped as soon
// as you change it or leave. Hidden ones only when they're shown; never into node_modules or .git,
// nor into what a walk leaves alone (skipFor).
export async function search(root, dir, rel, q, { hidden = false, signal } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  if (!needle) return { results: [], partial: false, folders: 0, skipped: [] }
  const { real, rel: r } = await within(`real\n${dir}\n${rel}`, () => safePath(dir, rel)).catch((e) => { throw said(e) })
  const realRoot = (await safePath(dir, '')).realRoot
  const skip = skipFor(real)
  const until = Date.now() + SEARCH_MS
  const found = []
  const skipped = new Set()
  let queue = [real]
  let folders = 0
  let partial = false
  const one = limiter(12)
  while (queue.length && !signal?.aborted) {
    if (Date.now() > until || folders >= SEARCH_DIRS) { partial = true; break }
    const next = []
    await Promise.all(queue.splice(0, 64).map((d) => one(async () => {
      if (signal?.aborted || found.length >= SEARCH_MAX) return
      folders++
      const ents = await within(`dir\n${d}`, () => fsp.readdir(d, { withFileTypes: true }), 4000).catch(() => { partial = true; return [] })
      for (const e of ents) {
        if (!hidden && hiddenIn(d, e.name)) continue
        const full = path.join(d, e.name)
        if (e.name.toLowerCase().includes(needle) && found.length < SEARCH_MAX) found.push({ e, full, d })
        if (e.isDirectory() && !NOISE.has(e.name) && !isPackage(e.name)) {
          const why = skip(full)
          if (why) skipped.add(why); else next.push(full)
        }
      }
    })))
    if (found.length >= SEARCH_MAX) { partial = true; break }
    queue = queue.concat(next)
  }
  if (signal?.aborted) throw err('Stopped', 499, 'stopped')
  const st = limiter(24)
  const results = await Promise.all(found.map(({ e, full, d }) => st(async () => {
    const s = await fsp.stat(full).catch(() => null)
    const isFolder = !!s?.isDirectory() && !isPackage(e.name)
    const inRoot = slash(path.relative(realRoot, full))
    return { name: e.name, path: inRoot, dir: isFolder, size: isFolder ? null : s?.size ?? 0, mtime: s?.mtimeMs ?? null, where: slash(path.relative(real, d)), ...(s?.isDirectory() && isPackage(e.name) ? { pkg: true } : {}) }
  })))
  skipped.delete('system')
  return { root, path: slash(r), top: realRoot, q: needle, results, partial, folders, skipped: [...skipped] }
}
