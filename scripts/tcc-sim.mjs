// Test hook for the server: acts like macOS holding a file call while its "allow access to your
// Desktop folder" prompt waits. Load with: node --import ./scripts/tcc-sim.mjs server/index.js
//   SIM_PROTECTED=dir1:dir2   folders to treat as protected (and everything inside them)
//   SIM_MS=20000              how long each call is held
// A blocking (sync) call on a protected path freezes the whole process for SIM_MS, exactly like the
// real prompt, and logs "[tcc-sim] FROZE <call>(<path>)" with a stack. A non-blocking (async) call
// is only delayed, so only the request that made it waits.
import fs from 'node:fs'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const MS = Number(process.env.SIM_MS || 20000)
const real = (p) => { try { return fs.realpathSync.native(p) } catch { return p } }
const DIRS = String(process.env.SIM_PROTECTED || '').split(':').filter(Boolean).flatMap((d) => [d, real(d)])
const pathOf = (p) => (p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : typeof p === 'string' ? p : '')
const hit = (p) => { const s = pathOf(p); return !!s && DIRS.some((d) => s === d || s.startsWith(d + '/')) }
const freeze = (call, p) => {
  console.error(`[tcc-sim] FROZE ${call}(${pathOf(p)})\n${new Error().stack.split('\n').slice(3, 9).join('\n')}`)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, MS)
}
const hold = () => new Promise((r) => setTimeout(r, MS))

const SYNC = ['readdirSync', 'statSync', 'lstatSync', 'readFileSync', 'existsSync', 'realpathSync', 'opendirSync', 'accessSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'readlinkSync', 'openSync', 'rmSync', 'rmdirSync', 'renameSync', 'copyFileSync', 'cpSync', 'unlinkSync', 'utimesSync', 'mkdtempSync']
for (const name of SYNC) {
  const orig = fs[name]
  if (!orig) continue
  const wrapped = function (p, ...rest) { if (hit(p) || (name.match(/^(rename|copyFile|cp)Sync$/) && hit(rest[0]))) freeze(name, p); return orig.call(this, p, ...rest) }
  if (orig.native) wrapped.native = function (p, ...rest) { if (hit(p)) freeze(`${name}.native`, p); return orig.native.call(this, p, ...rest) }
  fs[name] = wrapped
}
const ASYNC = ['readdir', 'stat', 'lstat', 'readFile', 'realpath', 'opendir', 'access', 'writeFile', 'appendFile', 'mkdir', 'readlink', 'open', 'rm', 'rmdir', 'rename', 'copyFile', 'cp', 'unlink', 'utimes', 'statfs', 'link', 'truncate']
// SIM_LOG=1: each of these logged too ("[tcc-sim] HELD <call>(<path>)"), so a test can tell that
// nothing looked into a folder at all, not only that nothing froze.
const held = (call, p) => { if (process.env.SIM_LOG) console.error(`[tcc-sim] HELD ${call}(${pathOf(p)})`) }
for (const name of ASYNC) {
  const orig = fs.promises[name]
  if (orig) fs.promises[name] = async function (p, ...rest) { if (hit(p)) { held(name, p); await hold() } return orig.call(this, p, ...rest) }
  const cb = fs[name]
  if (cb) fs[name] = function (p, ...rest) { if (!hit(p)) return cb.call(this, p, ...rest); held(name, p); setTimeout(() => cb.call(this, p, ...rest), MS) }
}
// A program started synchronously in a protected folder blocks the server until it ends.
for (const name of ['execFileSync', 'execSync', 'spawnSync']) {
  const orig = cp[name]
  cp[name] = function (cmd, ...rest) {
    const opts = rest.find((x) => x && typeof x === 'object' && !Array.isArray(x)) || {}
    const args = rest.find(Array.isArray) || []
    if (hit(opts.cwd) || args.some(hit)) freeze(`${name}:${cmd}`, opts.cwd || args.find(hit))
    return orig.call(this, cmd, ...rest)
  }
}
syncBuiltinESMExports()
console.error(`[tcc-sim] protecting ${DIRS.length ? [...new Set(DIRS)].join(', ') : '(nothing)'} for ${MS} ms per call`)
