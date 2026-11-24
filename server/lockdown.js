// The built app's server loads only its own code (app-root), before anything else of it loads: the
// app starts it with `--import` this file, and index.js imports it first too. Node looks further for
// a package it doesn't find beside the code: in NODE_PATH, ~/.node_modules, ~/.node_libraries, and
// every parent folder's node_modules (the app's own, /Applications/node_modules, /node_modules). A
// package asked for and missing here (ws's optional bufferutil, say) would then be another program's
// code running inside the server, with its keys. So, on Electron's Node (the built app):
//   - those global folders are made again with HOME (USERPROFILE on Windows) and NODE_PATH empty,
//     then HOME put back for everything else (the agents and terminals the server starts);
//   - anything require() or import resolves to outside app-root is refused, with why.
// From source (Node itself) nothing here applies.
import Module from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = Symbol.for('bridge-ai.server-lockdown')
const ROOT = (() => { const r = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); try { return fs.realpathSync(r) } catch { return r } })()

// Whether file is inside root (both real paths).
export function inside(root, file) {
  let real = file
  try { real = fs.realpathSync(file) } catch { /* as given */ }
  const rel = path.relative(root, real)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}
const refused = (request, where) => Object.assign(new Error(`Bridge AI's server loads only its own code: "${request}" would come from ${where}`), { code: 'ERR_BRIDGE_OUTSIDE' })

// Node's global folders made again with no home and no NODE_PATH (Module._initPaths reads them).
export function noGlobalFolders() {
  const keys = process.platform === 'win32' ? ['USERPROFILE', 'HOME'] : ['HOME']
  const kept = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  delete process.env.NODE_PATH
  for (const k of keys) process.env[k] = ''
  try { Module._initPaths() } finally { for (const k of keys) { if (kept[k] == null) delete process.env[k]; else process.env[k] = kept[k] } }
}
// Everything resolved from here on, by require() or import, inside root (or one of Node's own).
export function onlyFrom(root) {
  const resolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    const f = resolve.call(this, request, ...rest)
    if (Module.isBuiltin(f) || inside(root, f)) return f
    throw refused(request, f)
  }
  if (typeof Module.registerHooks === 'function') {
    Module.registerHooks({
      resolve(specifier, context, next) {
        const r = next(specifier, context)
        if (!r?.url || r.url.startsWith('node:') || Module.isBuiltin(specifier)) return r
        if (!r.url.startsWith('file:')) throw refused(specifier, r.url)
        const f = fileURLToPath(r.url)
        if (!inside(root, f)) throw refused(specifier, f)
        return r
      },
    })
  }
}

if (process.versions.electron && !globalThis[KEY]) {
  globalThis[KEY] = true
  noGlobalFolders()
  onlyFrom(ROOT)
}
