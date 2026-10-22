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

const readJSON = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } }

// Defaults from the repo, then your settings: ~/.bridge-ai/config.json (and config.local.json
// next to the code, for people who prefer keeping it there; it's gitignored).
export function loadConfig() {
  const merged = { ...readJSON(path.join(ROOT, 'config.example.json')), ...readJSON(dataFile('config.json')), ...readJSON(path.join(ROOT, 'config.local.json')) }
  if (process.env.BRIDGE_PORT) merged.port = Number(process.env.BRIDGE_PORT)
  // Only for a container whose port is published to 127.0.0.1 on its machine (docker-compose.yml):
  // there the server has to listen on the container's own network to be reached at all.
  if (process.env.BRIDGE_HOST) merged.host = process.env.BRIDGE_HOST
  return merged
}

// A program installed by npm in this repo (ccusage, quota-axi). Windows names it <bin>.cmd.
export const localBin = (name) => path.join(ROOT, 'node_modules', '.bin', IS_WIN ? `${name}.cmd` : name)

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
export const withNodeShim = (PATH = '') => { const d = nodeShimDir(); return d ? [PATH, d].filter(Boolean).join(path.delimiter) : PATH }
if (IN_APP) process.env.PATH = withNodeShim(process.env.PATH)
