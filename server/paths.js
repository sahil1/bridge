// Where things live. The repo holds code only; everything that's yours (settings, routines,
// ideas, the chief of staff's memory, caches) lives in the data folder, ~/.bridge-ai by default
// (set BRIDGE_HOME to move it). Nothing personal ever lands in the repo.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const HOME = os.homedir()
export const DATA = path.resolve(process.env.BRIDGE_HOME || path.join(HOME, '.bridge-ai'))
export const CACHE = path.join(DATA, 'cache')
export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

// Inside the desktop app the server runs on the app's own Node (Electron as Node), so nobody
// needs Node installed. NODE says how to run a Node script either way. The flag that makes
// Electron act as Node is dropped from our own environment so programs we start (an agent opening
// VS Code, say) don't inherit it.
export const IN_APP = !!process.versions.electron
if (IN_APP) delete process.env.ELECTRON_RUN_AS_NODE
export const NODE = { bin: process.execPath, env: IN_APP ? { ELECTRON_RUN_AS_NODE: '1' } : {} }

export const expand = (p) => (typeof p === 'string' && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p)
export const dataFile = (...parts) => path.join(DATA, ...parts)
export const cacheFile = (...parts) => path.join(CACHE, ...parts)
export const ensureDir = (dir) => { fs.mkdirSync(dir, { recursive: true }); return dir }

// Saves a file whole or not at all: written next to it, flushed to disk and renamed over it, so a
// crash or a power cut leaves the last save or this one, never half of each. mode: as
// writeFileSync's (0o600 for a file with keys or tokens); without one, the file keeps the mode it
// has. A rename onto a file another program has open (on Windows: an antivirus scan, a backup, an
// editor) can be refused for a moment: it's tried again briefly, then written in place as before.
// A file that's a link (to a dotfiles folder, say) stays one: the file it leads to is replaced.
let saves = 0
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
export function writeFileAtomic(to, data, { mode } = {}) {
  let file = to
  try { file = fs.realpathSync(to) } catch { /* a new file */ }
  let keep = mode
  if (keep == null) { try { keep = fs.statSync(file).mode & 0o777 } catch { /* a new file */ } }
  const tmp = `${file}.${process.pid}-${(saves++).toString(36)}.tmp`
  let fd = null
  try {
    fd = fs.openSync(tmp, 'w', keep ?? 0o666)
    if (keep != null && !IS_WIN) fs.fchmodSync(fd, keep) // exactly, whatever the umask
    fs.writeFileSync(fd, data)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    for (const wait of [15, 30, 60, 120, null]) {
      try { fs.renameSync(tmp, file); return } catch (e) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e
        if (wait) { pause(wait); continue }
        fs.writeFileSync(file, data, keep == null ? undefined : { mode: keep })
        fs.rmSync(tmp, { force: true })
      }
    }
  } catch (e) {
    if (fd != null) try { fs.closeSync(fd) } catch { /* closed */ }
    try { fs.rmSync(tmp, { force: true }) } catch { /* not there */ }
    throw e
  }
}

const readJSON = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } }

// Defaults from the repo, then your settings: ~/.bridge-ai/config.json (and config.local.json
// next to the code, for people who prefer keeping it there; it's gitignored).
export function loadConfig() {
  const yours = { ...readJSON(dataFile('config.json')), ...readJSON(path.join(ROOT, 'config.local.json')) }
  // Show more models was saved as chinaModels before 3.0.1: one saved that way still counts.
  if (yours.moreModels === undefined && yours.chinaModels !== undefined) yours.moreModels = yours.chinaModels
  const merged = { ...readJSON(path.join(ROOT, 'config.example.json')), ...yours }
  if (process.env.BRIDGE_PORT) merged.port = Number(process.env.BRIDGE_PORT)
  // Only for a container whose port is published to 127.0.0.1 on its machine (docker-compose.yml):
  // there the server has to listen on the container's own network to be reached at all.
  if (process.env.BRIDGE_HOST) merged.host = process.env.BRIDGE_HOST
  return merged
}

// A program installed by npm in this repo (ccusage, quota-axi). Windows names it <bin>.cmd.
export const localBin = (name) => path.join(ROOT, 'node_modules', '.bin', IS_WIN ? `${name}.cmd` : name)

// A Homebrew install, typed into a terminal tab. Homebrew now stops before installing anything
// that brings other packages along ("Do you want to proceed with the installation? [y/n]"), and in
// a Setup tab nobody is looking at, that waits forever. HOMEBREW_NO_ASK says go ahead; an older
// Homebrew ignores it, where its --yes flag would be refused. brew: as the caller quotes it.
export const brewInstall = (brew, pkgs) => `HOMEBREW_NO_ASK=1 ${brew} install ${pkgs}`

// A `node` command for computers without Node, for the tools Bridge AI runs that expect one (the
// chief of staff's `bridge` helper, usage stats). It goes at the END of PATH, so an installed Node
// always wins. Only inside the desktop app; returns null otherwise.
let shimDir = null
export function nodeShimDir() {
  if (!IN_APP) return null
  if (shimDir) return shimDir
  const dir = ensureDir(cacheFile('node'))
  if (IS_WIN) fs.writeFileSync(path.join(dir, 'node.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" %*\r\n`)
  else fs.writeFileSync(path.join(dir, 'node'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`, { mode: 0o755 })
  return (shimDir = dir)
}
// Node.js that Bridge AI installed for you (nodejs.js), when the computer has none of its own: after
// your PATH, before the shim. The shim always goes last, also when Node.js was installed while
// Bridge AI ran: a PATH read then already has the shim, and Node.js went after it, so tools found
// npx in Node.js's folder but ran on the shim.
export const OWN_NODE = dataFile('tools', 'node')
const ownNodeBin = () => { const d = path.join(OWN_NODE, 'bin'); return fs.existsSync(path.join(d, IS_WIN ? 'node.exe' : 'node')) ? d : null }
export const withNodeShim = (PATH = '') => {
  const shim = nodeShimDir()
  const dirs = PATH.split(path.delimiter).filter((d) => d && d !== shim)
  const own = ownNodeBin()
  return [...dirs, ...(own && !dirs.includes(own) ? [own] : []), shim].filter(Boolean).join(path.delimiter)
}
if (IN_APP) process.env.PATH = withNodeShim(process.env.PATH)
