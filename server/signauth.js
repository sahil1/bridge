// Ask Before Signing (Settings › Studio, off until you turn it on: placeEn('ask-before-signing')): before a signed copy is made,
// Bridge AI asks that it's you, once for the whole document, however many places it signs.
//   On this computer   a Mac: Touch ID, or its password (LocalAuthentication, through
//                      native/bridgesign). Windows: Windows Hello where it's set up. Elsewhere, or
//                      where neither can be asked: your signing PIN.
//   From your phone    your signing PIN (what a phone says it did can't be checked here, a PIN
//                      can). Only a phone paired here, kept and let in, that the relay proves it's
//                      running the request for (relayproof.js); never another computer, a device
//                      not kept yet, one a request only names, nor Tailscale.
// Only your own windows (windowkey.js) and those phones ask at all (signing.js), never a program that
// only has the key.
// What's asked is asked here, by the server, never taken from the page: the page gets a grant, a
// random token for that one document, for 2 minutes, used once, by the device that asked; signing
// (signing.js) refuses without it while this is on. The setting and the PIN's hash are in the
// sealed list beside the signatures (signstore.js), not in config.json, with a mark beside it that
// keeps signing closed if the list can't be read; turning it off or setting a PIN is asked for the
// same way first. The way this computer asked when it was turned on is kept with it and never
// lowered. PIN tries go one at a time, each counted before it's checked, slower after each wrong
// one; 5 wrong lock it for 5 minutes, longer each time after.
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { IS_WIN } from './paths.js'
import * as store from './signstore.js'
import { signBin, probe, deviceAuth, limiter } from './signhelper.js'
import { placeEn } from '../shared/places.js'

const GRANT_MS = 2 * 60_000
const TRIES = 5
const err = (message, status, code, data) => Object.assign(new Error(message), { status, code, ...(data ? { data } : {}) })

// ---------- Windows Hello ----------
// Windows' own verifier (UserConsentVerifier), from PowerShell: its face, fingerprint or PIN.
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const psq = (s) => `'${String(s).replace(/['‘’‚‛]/g, '$&$&')}'`
const HELLO = (reason) => `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$as = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Wait($op, [Type]$t) { $task = $as.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
$v = [Windows.Security.Credentials.UI.UserConsentVerifier]
$a = Wait ($v::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ("$a" -ne 'Available') { "none $a"; exit }
${reason == null ? "'available'" : `$r = Wait ($v::RequestVerificationAsync(${psq(reason)})) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
"result $r"`}`
const hello = (reason) => new Promise((resolve) => {
  execFile(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(HELLO(reason), 'utf16le').toString('base64')], { timeout: reason == null ? 20000 : 180000, windowsHide: true }, (_e, out) => resolve(String(out || '').trim().split(/\r?\n/).pop() || ''))
})
let helloHere = null
const helloAvailable = () => {
  if (!IS_WIN || process.env.BRIDGE_FIX_DRYRUN) return Promise.resolve(false)
  if (helloHere && Date.now() - helloHere.at < 60_000) return helloHere.p
  const p = hello(null).then((s) => s === 'available', () => false)
  helloHere = { at: Date.now(), p }
  return p
}

// ---------- Who's asking, and how they're asked ----------
// here: one of the app's own windows on this computer (windowkey.js), never a program that only has
// the key. Else a phone of yours, paired here, kept and let in, the relay proving it (signing.js
// decides who may ask at all). who: whose a grant is.
export const who = ({ here, device }) => (here ? 'here' : device ? `d:${device}` : 'other')
// How this computer can ask now: 'device' (Touch ID or the Mac's password), 'hello', or 'pin';
// null when the helper didn't answer (asked again next time).
async function wayHere() {
  const p = await probe()
  if (p.failed) return null
  if (p.auth) return 'device'
  if (await helloAvailable()) return 'hello'
  return 'pin'
}
// The way this one is asked. Here: the way this computer had when Ask Before Signing was turned on,
// kept with it (a.way), and never less: with Touch ID or the password kept, a PIN is never taken
// here, and the helper not answering is "try again", not "there's nothing to ask with". A phone:
// the PIN.
async function wayFor(here, a) {
  if (!here) return 'pin'
  const now = await wayHere()
  if (!now) throw err('Touch ID couldn\'t be asked just now. Try again.', 503, 'try-again')
  if (a?.way === 'device' && now !== 'device') throw err('This Mac can\'t ask for Touch ID or its password just now (it was set to). Try again.', 503, 'try-again')
  if (a?.way === 'hello' && now === 'pin') return 'hello' // (Windows Hello asked, and a PIN where it can't be just then: ask())
  return now
}
// For Settings and the pad: whether it's on, whether there's a PIN, how this one would be asked,
// and what this computer can ask at all.
export async function status(here) {
  const a = await store.askOf().catch(() => null)
  const p = await probe()
  // (On as signing sees it: also while a list set aside, or older than the app last heard, keeps it
  // asking, so the page asks first rather than being turned away.)
  const on = await needed()
  let way = null
  try { way = await wayFor(here, a) } catch { way = null }
  return { on, pin: !!a?.pin, way, recorded: a?.way || null, touchID: p.touchID, deviceAuth: p.auth, hello: await helloAvailable(), locked: a?.lockUntil > Date.now() ? a.lockUntil : null, closed: !a }
}

// ---------- The PIN ----------
const scrypt = (pin, salt) => new Promise((resolve, reject) => crypto.scrypt(String(pin), Buffer.from(salt, 'base64'), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))))
export const okPin = (pin) => /^\d{4,12}$/.test(String(pin ?? ''))
async function hashPin(pin) {
  if (!okPin(pin)) throw err('A signing PIN is 4 to 12 digits', 400, 'pin-shape')
  const salt = crypto.randomBytes(16).toString('base64')
  return { salt, hash: (await scrypt(pin, salt)).toString('base64') }
}
const when = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
// Checked one at a time, in the list's own turn: the try counted (and kept) before it's checked, so
// tries at once are tries one after another. A wrong one waits a little longer each time before
// the next (1, 2, 4, 8 s), and 5 wrong lock it for 5 minutes, twice as long each time after.
async function checkPin(pin) {
  return store.withAsk(async (a, save) => {
    if (!a.pin) throw err(`There's no signing PIN yet. Set one in ${placeEn('ask-before-signing')}, on the computer.`, 409, 'no-pin')
    const now = Date.now()
    if (a.lockUntil > now) throw err(`The signing PIN was wrong ${TRIES} times, so it's locked until ${when(a.lockUntil)}.`, 429, 'pin-locked', { until: a.lockUntil })
    if (a.nextTry > now) throw err('Wait a moment before trying the PIN again.', 429, 'pin-wait', { until: a.nextTry })
    const fails = (a.fails || 0) + 1
    const lock = fails >= TRIES
    const locks = (a.locks || 0) + (lock ? 1 : 0)
    // (Counted as wrong first; put right below when it isn't.)
    await save({ fails: lock ? 0 : fails, locks, lockUntil: lock ? now + 5 * 60_000 * 2 ** Math.min(6, locks - 1) : a.lockUntil, nextTry: now + 1000 * 2 ** Math.min(4, fails - 1) })
    const good = okPin(pin) && crypto.timingSafeEqual(await scrypt(pin, a.pin.salt), Buffer.from(a.pin.hash, 'base64'))
    if (good) { await save({ fails: 0, nextTry: 0, lockUntil: 0 }); return true }
    if (lock) throw err(`That PIN isn't right, and it was wrong ${TRIES} times, so it's locked until ${when(a.lockUntil)}.`, 429, 'pin-locked', { until: a.lockUntil })
    throw err(`That PIN isn't right (${TRIES - fails} ${TRIES - fails === 1 ? 'try' : 'tries'} left).`, 401, 'pin-wrong', { left: TRIES - fails })
  })
}

// ---------- Grants ----------
const grants = new Map() // token -> { purpose, doc, who, how, until }
const MAX_GRANTS = 50
const sweep = () => { for (const [k, g] of grants) if (g.until < Date.now()) grants.delete(k) }
// Touch ID (or Windows Hello) asked at most so often: a prompt is the person's, not a program's to repeat.
const prompts = limiter(8, 60_000)
// What a grant is for: 'sign' (one document), 'settings' (Ask Before Signing itself, the PIN),
// 'change' (your saved signatures, while it's on) and 'export' (them, into a backup or a move).
const PURPOSES = ['sign', 'settings', 'change', 'export']
// Whether it's on: as the sealed list says, or (it can't be read) as the mark beside it says, or the
// list was set aside, or is older than the app last heard (a copy put back): closed until you confirm.
export async function needed() {
  const a = await store.askOf().catch(() => null)
  if (a?.on || store.askMarked()) return true
  if (!a) return true
  if (await store.olderNote().catch(() => null)) return true
  return !!(await store.setAsideNote().catch(() => null))
}
// Asked as this one is asked (pin: what they typed, where that's the way), then a grant for
// purpose. how says which it was, for the record. reason: what Touch ID says it's for, written by
// signing.js from the document itself; sha256: the document's bytes as they were when you were
// asked, which signing then has to find (signing.js). Export asks even with Ask Before Signing off.
export async function ask({ here, device, purpose = 'sign', doc = null, sha256 = null, reason = 'sign a document', pin = null }) {
  if (!PURPOSES.includes(purpose)) throw err('Not something to ask for', 400)
  const a = await store.askOf().catch(() => null)
  const on = await needed()
  if ((purpose === 'sign' || purpose === 'change') && !on) return { needed: false }
  const way = await wayFor(here, a)
  // The PIN only where it's the way: with Touch ID or the Mac's password, they are asked, never a
  // PIN in their place. Windows Hello, or the PIN when Hello can't be used just then.
  if (pin != null && way === 'device') throw err('This Mac asks for Touch ID or its password, not the PIN.', 400, 'use-device')
  let how
  if (way === 'pin' || pin != null) {
    // Exporting where only a PIN could be asked and there's none: your own window is enough.
    if (pin == null && purpose === 'export' && here && !a?.pin) how = 'window'
    else {
      if (pin == null) throw err(a?.pin ? 'Type your signing PIN' : `There's no signing PIN yet. Set one in ${placeEn('ask-before-signing')}, on the computer.`, a?.pin ? 428 : 409, a?.pin ? 'pin' : 'no-pin')
      await checkPin(pin)
      how = 'pin'
    }
  } else {
    if (!prompts()) throw err('Asked too often just now. Wait a minute and try again.', 429, 'too-often')
    if (way === 'device') {
      const r = await deviceAuth(reason)
      if (!r.ok) throw err(r.code === 'cancel' ? 'Not done: Touch ID or the password was cancelled' : `Not done: ${r.error}`, 401, r.code === 'cancel' ? 'cancelled' : 'refused')
      how = r.how
    } else {
      const said = await hello(reason)
      if (said !== 'result Verified') throw err(/Canceled/.test(said) ? 'Not done: Windows Hello was cancelled' : `Not done: Windows Hello said ${said.replace(/^result /, '') || 'nothing'}`, 401, /Canceled/.test(said) ? 'cancelled' : 'refused')
      how = 'hello'
    }
  }
  // Confirmed by you: a list set aside, or older than the app last heard, no longer keeps signing
  // closed (signstore.js clearSetAside).
  if (how !== 'window') await store.clearSetAside().catch(() => {})
  sweep()
  if (grants.size >= MAX_GRANTS) grants.delete(grants.keys().next().value)
  const token = crypto.randomBytes(32).toString('base64url')
  grants.set(token, { purpose, doc, sha256, who: who({ here, device }), how, until: Date.now() + GRANT_MS })
  return { needed: true, grant: token, how, until: Date.now() + GRANT_MS }
}
// The grant a signing (or a change) came with: for that, by that one, in time; used up either way.
// null when it isn't.
export function use(token, { purpose, doc = null, here, device }) {
  sweep()
  const g = typeof token === 'string' ? grants.get(token) : null
  if (!g) return null
  grants.delete(token)
  if (g.purpose !== purpose || g.who !== who({ here, device }) || g.until < Date.now()) return null
  if (purpose === 'sign' && (g.doc?.root !== doc?.root || g.doc?.path !== doc?.path)) return null
  return g
}

// ---------- The setting ----------
// Turned on: from your window or phone (it only asks more), with the way this computer asks then
// kept (and a PIN to turn it on with where that's the only way). Off, or a PIN set, changed or taken
// away: asked first, whether it's on or not (a PIN planted while it's off would be one more way in
// later): with Touch ID or the password where the computer has them (in your window there), else
// the current PIN, or, with none yet, your own window.
export async function set({ on, pin, removePin = false, grant, here, device }) {
  const a = await store.askOf().catch(() => null)
  if (!a) throw err('Your signatures can\'t be opened just now, so neither can this. Try again once they open.', 503, 'closed')
  const touchesPin = pin != null || removePin
  const asks = (await needed()) || touchesPin
  // (This computer's own way, whoever is asking: kept when it's turned on, from a phone too.)
  const wayComputer = await wayHere()
  const wayNow = here ? wayComputer : 'pin'
  if ((here || on === true) && !wayComputer) throw err('Touch ID couldn\'t be asked just now. Try again.', 503, 'try-again')
  // Setting a PIN where the computer has Touch ID or its password: only at the computer, with them.
  if (touchesPin && !here && (a.way === 'device' || a.way === 'hello')) throw err('Set or change the signing PIN on the computer, where Touch ID or its password is asked.', 403, 'here')
  const asked = grant ? use(grant, { purpose: 'settings', here, device }) : null
  const firstPinHere = here && wayNow === 'pin' && !a.pin && pin != null && removePin === false && !a.on
  if (asks && !asked && !firstPinHere) throw err('Confirm it\'s you first: changing this is asked for too.', 403, 'ask')
  if (asked && asked.how === 'pin' && here && (wayNow === 'device' || wayNow === 'hello')) throw err('This computer asks for Touch ID or its password for this, not the PIN.', 403, 'ask')
  const change = {}
  if (pin != null) change.pin = await hashPin(pin)
  if (removePin) change.pin = null
  if (typeof on === 'boolean') {
    change.on = on
    if (on) change.way = wayComputer
  }
  const pinAfter = 'pin' in change ? change.pin : a.pin
  const onAfter = 'on' in change ? change.on : a.on
  const wayAfter = change.way || a.way
  if (onAfter && !pinAfter && wayAfter === 'pin') throw err('This computer can only ask for a signing PIN: set one to turn this on.', 400, 'need-pin')
  if ('pin' in change) Object.assign(change, { fails: 0, lockUntil: 0, locks: 0, nextTry: 0 })
  await store.setAsk(() => change)
  if (asked) await store.clearSetAside().catch(() => {})
  return status(here)
}
export const helperHere = () => !!signBin()
