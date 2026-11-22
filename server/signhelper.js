// native/bridgesign on a Mac (Studio's signing): whether this Mac has a trackpad and Touch ID, the
// trackpad's finger streamed while you sign on it, and Touch ID or the Mac's password asked for (Ask
// Before Signing). It holds no key: the saved signatures' is the app's (appkeys.js). See the helper's
// own comment for what each says. null with no helper (a copy run from a clone that didn't build the
// helpers, any other system), where none of it is offered. What a call says (a reason, the trackpad's
// hint) goes on the helper's stdin, never in its arguments, which any program can list.
// BRIDGE_SIGNHELPER: a stand-in, in the tests only (BRIDGE_FIX_DRYRUN); they use no real one without
// it (no window over the screen, no Touch ID).
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { ROOT, IS_MAC } from './paths.js'
import { appKeys } from './appkeys.js'

const TESTS = !!process.env.BRIDGE_FIX_DRYRUN
export const signBin = () => {
  if (TESTS && !process.env.BRIDGE_SIGNHELPER) return null
  const f = (TESTS && process.env.BRIDGE_SIGNHELPER) || path.join(ROOT, 'native', 'bin', 'bridgesign')
  return (IS_MAC || (TESTS && process.env.BRIDGE_SIGNHELPER)) && fs.existsSync(f) ? f : null
}
// Started by the Mac app: the helper must be signed as the app is (its requirement, on the app's pipe:
// appkeys.js code) before anything it says is taken, checked each time it's run, as it could be
// swapped for another program (one that says Touch ID said yes). Not signed so: no helper.
const holds = (bin, req) => new Promise((resolve) => execFile('/usr/bin/codesign', ['--verify', '--strict', '-R', `=${req}`, bin], { timeout: 20000 }, (err) => resolve(!err)))
async function trusted() {
  const bin = signBin()
  if (!bin) return null
  const req = appKeys().code
  if (!req || TESTS) return bin
  if (await holds(bin, req)) return bin
  console.error(`signing: ${bin} isn't signed as Bridge AI is, so it isn't used`)
  return null
}
const lastJson = (out) => { for (const line of String(out || '').trim().split('\n').reverse()) { try { return JSON.parse(line) } catch { /* the one before */ } } return null }
// The helper run with what it's told on stdin (first line, JSON), its last line back.
export async function runHelper(args, said = null, ms = 15000) {
  const bin = await trusted()
  if (!bin) return null
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => { try { child.kill() } catch { /* gone */ } }, ms)
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', () => { clearTimeout(timer); resolve(lastJson(out)) })
    child.stdin.on('error', () => {})
    child.stdin.end(said ? `${JSON.stringify(said)}\n` : '')
  })
}

// One budget for each of them (who: a key), so one can't use up another's (limiter, below).
export function limiterBy(n, ms) {
  const each = new Map()
  return (who) => {
    if (!each.has(who)) {
      if (each.size >= 200) each.delete(each.keys().next().value)
      each.set(who, limiter(n, ms))
    }
    return each.get(who)()
  }
}
// So many in so long, for what could otherwise be asked again and again (Touch ID asked, the
// trackpad started): true while under.
export function limiter(n, ms) {
  const times = []
  return () => {
    const now = Date.now()
    while (times.length && now - times[0] > ms) times.shift()
    if (times.length >= n) return false
    times.push(now)
    return true
  }
}

// What this Mac has: { trackpad, touchID, auth }, asked again after a while (a Magic Trackpad comes
// and goes, the lid closes). All false without the helper. An answer that didn't come is never kept
// (failed: true): the next look asks again, and Ask Before Signing says "try again" rather than
// taking it to mean there's nothing to ask with.
let probed = null
const NONE = { trackpad: false, touchID: false, auth: false }
export function probe() {
  if (!signBin()) return Promise.resolve(NONE)
  if (probed && Date.now() - probed.at < 15000) return probed.p
  const p = runHelper(['probe'], null, 8000).then((j) => {
    if (!j || typeof j.auth !== 'boolean') { probed = null; return { ...NONE, failed: true } }
    return { trackpad: !!j.trackpad, touchID: !!j.touchID, auth: !!j.auth }
  })
  probed = { at: Date.now(), p }
  return p
}

// Touch ID or the Mac's password, for reason ("sign contract.pdf", written here from the document
// itself): { ok, how: 'touchid'|'password' } or { ok: false, code, error }. One at a time.
let asking = Promise.resolve()
export function deviceAuth(reason) {
  if (!signBin()) return Promise.resolve({ ok: false, code: 'none', error: 'This Mac can\'t ask for Touch ID or its password here' })
  const go = async () => {
    const j = await runHelper(['auth'], { reason: String(reason).slice(0, 140) }, 180000)
    if (j && typeof j.ok === 'boolean') return j.ok ? { ok: true, how: j.how === 'password' ? 'password' : 'touchid' } : { ok: false, code: j.code || 'failed', error: j.error || 'Not confirmed' }
    return { ok: false, code: 'failed', error: 'The Mac didn\'t answer' }
  }
  const p = asking.then(go, go)
  asking = p.catch(() => {})
  return p
}

// The trackpad, while you sign on it: each line the helper prints (onLine), until it ends (onEnd
// with its last line: { done } or { cancel }). stop() ends it, as Esc would without the strokes.
// One at a time; its hint is written here (signing.js), never taken from the request.
let current = null
export function trackpad({ hint, seconds = 120, onLine, onEnd }) {
  if (!signBin()) { onEnd({ cancel: 'none' }); return { stop: () => {} } }
  current?.stop()
  let child = null
  let stopped = false
  let ended = false
  const end = (line) => { if (ended) return; ended = true; if (current === me) current = null; onEnd(line) }
  const me = {
    stop: () => {
      stopped = true
      if (!child) { end({ cancel: 'stop' }); return }
      try { child.stdin.write('stop\n') } catch { /* gone */ }
      setTimeout(() => { try { child.kill() } catch { /* gone */ } }, 1500).unref()
    },
  }
  current = me
  // (The helper as signed as the app is first: trusted.)
  trusted().then((bin) => {
    if (stopped || ended) { end({ cancel: 'stop' }); return }
    if (!bin) { end({ cancel: 'none' }); return }
    child = spawn(bin, ['trackpad'], { stdio: ['pipe', 'pipe', 'ignore'] })
    let buf = ''
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
    child.stdin.write(`${JSON.stringify({ hint: hint ? String(hint).slice(0, 160) : null, seconds })}\n`)
  }, () => end({ cancel: 'none' }))
  return me
}
