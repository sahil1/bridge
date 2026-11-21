// native/bridgesign on a Mac (Studio's signing): whether this Mac has a trackpad and Touch ID, the
// trackpad's finger streamed while you sign on it, Touch ID or the Mac's password asked for (Ask
// Before Signing), and the Keychain's key for the saved signatures (signstore.js). See the helper's
// own comment for what each says. null with no helper (a copy run from a clone that didn't build the
// helpers, any other system), where none of it is offered. BRIDGE_SIGNHELPER: a stand-in; tests use no
// real one without it (no window over the screen, no Touch ID, nothing in the Keychain).
import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { ROOT, IS_MAC } from './paths.js'

export const signBin = () => {
  if (process.env.BRIDGE_FIX_DRYRUN && !process.env.BRIDGE_SIGNHELPER) return null
  const f = process.env.BRIDGE_SIGNHELPER || path.join(ROOT, 'native', 'bin', 'bridgesign')
  return (IS_MAC || process.env.BRIDGE_SIGNHELPER) && fs.existsSync(f) ? f : null
}
const lastJson = (out) => { for (const line of String(out || '').trim().split('\n').reverse()) { try { return JSON.parse(line) } catch { /* the one before */ } } return null }

// What this Mac has: { trackpad, touchID, auth }, asked again after a while (a Magic Trackpad comes
// and goes, the lid closes). All false without the helper.
let probed = null
const NONE = { trackpad: false, touchID: false, auth: false }
export function probe() {
  const bin = signBin()
  if (!bin) return Promise.resolve(NONE)
  if (probed && Date.now() - probed.at < 15000) return probed.p
  const p = new Promise((resolve) => execFile(bin, ['probe'], { timeout: 8000 }, (_e, out) => { const j = lastJson(out); resolve(j ? { trackpad: !!j.trackpad, touchID: !!j.touchID, auth: !!j.auth } : NONE) }))
  probed = { at: Date.now(), p }
  return p
}

// Touch ID or the Mac's password, for reason ("sign contract.pdf"): { ok, how: 'touchid'|'password' }
// or { ok: false, code, error }. One at a time: a second ask while one is up waits for it to end.
let asking = Promise.resolve()
export function deviceAuth(reason) {
  const bin = signBin()
  if (!bin) return Promise.resolve({ ok: false, code: 'none', error: 'This Mac can\'t ask for Touch ID or its password here' })
  const run = () => new Promise((resolve) => execFile(bin, ['auth', '--reason', String(reason).slice(0, 140)], { timeout: 180000 }, (e, out) => {
    const j = lastJson(out)
    if (j && typeof j.ok === 'boolean') return resolve(j.ok ? { ok: true, how: j.how === 'password' ? 'password' : 'touchid' } : { ok: false, code: j.code || 'failed', error: j.error || 'Not confirmed' })
    resolve({ ok: false, code: 'failed', error: e?.killed ? 'Nobody answered in time' : 'The Mac didn\'t answer' })
  }))
  const p = asking.then(run, run)
  asking = p.catch(() => {})
  return p
}

// The trackpad, while you sign on it: each line the helper prints (onLine), until it ends (onEnd
// with its last line: { done } or { cancel }). stop() ends it, as Esc would without the strokes.
let current = null
export function trackpad({ hint, seconds = 120, onLine, onEnd }) {
  const bin = signBin()
  if (!bin) { onEnd({ cancel: 'none' }); return { stop: () => {} } }
  current?.stop()
  const child = spawn(bin, ['trackpad', '--seconds', String(seconds), ...(hint ? ['--hint', String(hint).slice(0, 160)] : [])], { stdio: ['pipe', 'pipe', 'ignore'] })
  let buf = ''
  let ended = false
  const end = (line) => { if (ended) return; ended = true; if (current === me) current = null; onEnd(line) }
  child.stdout.on('data', (d) => {
    buf += d
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      let j
      try { j = JSON.parse(line) } catch { continue }
      if (j.done || j.cancel) end(j)
      else onLine(j)
    }
  })
  child.on('exit', () => end({ cancel: 'stop' }))
  child.on('error', () => end({ cancel: 'none' }))
  child.stdin.on('error', () => {})
  const me = {
    stop: () => {
      try { child.stdin.write('stop\n') } catch { /* gone */ }
      setTimeout(() => { try { child.kill() } catch { /* gone */ } }, 1500).unref()
    },
  }
  current = me
  return me
}
