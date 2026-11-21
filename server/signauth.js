// Ask Before Signing (Settings › Studio, off until you turn it on: placeEn('ask-before-signing')): before a signed copy is made,
// Bridge AI asks that it's you, once for the whole document, however many places it signs.
//   On this computer   a Mac: Touch ID, or its password (LocalAuthentication, through
//                      native/bridgesign). Windows: Windows Hello where it's set up. Elsewhere, or
//                      where neither can be asked: your signing PIN.
//   From your phone    your signing PIN (what a device says it did can't be checked here, a PIN
//   or another device  can). Only a device the relay proves it's running the request for
//                      (relayproof.js), never one a request only names, nor through Tailscale.
// What's asked is asked here, by the server, never taken from the page: the page gets a grant, a
// random token for that one document, for 2 minutes, used once, by the device that asked; signing
// (signing.js) refuses without it while this is on. The setting and the PIN's hash are in the
// sealed list beside the signatures (signstore.js), not in config.json, so turning it off or
// changing the PIN is asked for the same way first. A PIN wrong 5 times locks it for 5 minutes,
// longer each time after.
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { IS_WIN } from './paths.js'
import * as store from './signstore.js'
import { signBin, probe, deviceAuth } from './signhelper.js'
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
// here: this computer itself (no relay, not another computer's page, not Tailscale). Another device
// by its relay id (and the device a computer said it asks for).
export const who = ({ here, device, forId }) => (here ? 'here' : device ? `d:${device}${forId ? `/${forId}` : ''}` : 'other')
// The way this one is asked: 'device' (Touch ID or the password), 'hello', or 'pin'.
export async function wayFor(here) {
  if (here && (await probe()).auth) return 'device'
  if (here && await helloAvailable()) return 'hello'
  return 'pin'
}
// For Settings and the pad: whether it's on, whether there's a PIN, how this one would be asked,
// and what this computer can ask at all.
export async function status(here) {
  const a = await store.askOf()
  const p = await probe()
  return { on: !!a.on, pin: !!a.pin, way: await wayFor(here), touchID: p.touchID, deviceAuth: p.auth, hello: await helloAvailable(), locked: a.lockUntil > Date.now() ? a.lockUntil : null }
}

// ---------- The PIN ----------
const scrypt = (pin, salt) => new Promise((resolve, reject) => crypto.scrypt(String(pin), Buffer.from(salt, 'base64'), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))))
export const okPin = (pin) => /^\d{4,12}$/.test(String(pin ?? ''))
async function hashPin(pin) {
  if (!okPin(pin)) throw err('A signing PIN is 4 to 12 digits', 400, 'pin-shape')
  const salt = crypto.randomBytes(16).toString('base64')
  return { salt, hash: (await scrypt(pin, salt)).toString('base64') }
}
async function checkPin(pin) {
  const a = await store.askOf()
  if (!a.pin) throw err(`There's no signing PIN yet. Set one in ${placeEn('ask-before-signing')}, on the computer.`, 409, 'no-pin')
  if (a.lockUntil > Date.now()) throw err(`The signing PIN was wrong ${TRIES} times, so it's locked until ${new Date(a.lockUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`, 429, 'pin-locked', { until: a.lockUntil })
  const good = okPin(pin) && crypto.timingSafeEqual(await scrypt(pin, a.pin.salt), Buffer.from(a.pin.hash, 'base64'))
  if (good) { if (a.fails) await store.setAsk(() => ({ fails: 0 })); return true }
  const next = await store.setAsk((x) => {
    const fails = (x.fails || 0) + 1
    if (fails < TRIES) return { fails }
    const locks = (x.locks || 0) + 1
    return { fails: 0, locks, lockUntil: Date.now() + 5 * 60_000 * 2 ** Math.min(6, locks - 1) }
  })
  if (next.lockUntil > Date.now()) throw err(`That PIN isn't right, and it was wrong ${TRIES} times, so it's locked until ${new Date(next.lockUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`, 429, 'pin-locked', { until: next.lockUntil })
  throw err(`That PIN isn't right (${TRIES - next.fails} ${TRIES - next.fails === 1 ? 'try' : 'tries'} left).`, 401, 'pin-wrong', { left: TRIES - next.fails })
}

// ---------- Grants ----------
const grants = new Map() // token -> { purpose, doc, who, how, until }
const sweep = () => { for (const [k, g] of grants) if (g.until < Date.now()) grants.delete(k) }
// Asked as this one is asked (pin: what they typed, when that's the way, or they chose it), then a
// grant for purpose ('sign' and the document, or 'settings'). how says which it was, for the record.
export async function ask({ here, device, forId, purpose = 'sign', doc = null, reason = 'sign a document', pin = null }) {
  if (!['sign', 'settings'].includes(purpose)) throw err('Not something to ask for', 400)
  const a = await store.askOf()
  if (purpose === 'sign' && !a.on) return { needed: false }
  const way = await wayFor(here)
  // The PIN only where it's the way: on a Mac with Touch ID or its password, those are asked here,
  // never a PIN in their place (a program on this computer could guess one). Windows Hello, or the
  // PIN when Hello can't be used just then.
  if (pin != null && way === 'device') throw err('This Mac asks for Touch ID or its password, not the PIN.', 400, 'use-device')
  let how
  if (way === 'pin' || pin != null) {
    if (pin == null) throw err(a.pin ? 'Type your signing PIN' : `There's no signing PIN yet. Set one in ${placeEn('ask-before-signing')}, on the computer.`, a.pin ? 428 : 409, a.pin ? 'pin' : 'no-pin')
    await checkPin(pin)
    how = 'pin'
  } else if (way === 'device') {
    const r = await deviceAuth(reason)
    if (!r.ok) throw err(r.code === 'cancel' ? 'Not signed: Touch ID or the password was cancelled' : `Not signed: ${r.error}`, 401, r.code === 'cancel' ? 'cancelled' : 'refused')
    how = r.how
  } else {
    const said = await hello(reason)
    if (said !== 'result Verified') throw err(/Canceled/.test(said) ? 'Not signed: Windows Hello was cancelled' : `Not signed: Windows Hello said ${said.replace(/^result /, '') || 'nothing'}`, 401, /Canceled/.test(said) ? 'cancelled' : 'refused')
    how = 'hello'
  }
  sweep()
  const token = crypto.randomBytes(32).toString('base64url')
  grants.set(token, { purpose, doc, who: who({ here, device, forId }), how, until: Date.now() + GRANT_MS })
  return { needed: true, grant: token, how, until: Date.now() + GRANT_MS }
}
// The grant a signing (or a change to the setting) came with: for that, by that one, in time; used
// up either way. null when it isn't.
export function use(token, { purpose, doc = null, here, device, forId }) {
  sweep()
  const g = typeof token === 'string' ? grants.get(token) : null
  if (!g) return null
  grants.delete(token)
  if (g.purpose !== purpose || g.who !== who({ here, device, forId }) || g.until < Date.now()) return null
  if (purpose === 'sign' && (g.doc?.root !== doc?.root || g.doc?.path !== doc?.path)) return null
  return g
}
// Whether signing needs one now.
export const needed = async () => !!(await store.askOf()).on

// ---------- The setting ----------
// Turned on: from anywhere you are (it only asks more). With no way to ask on this computer but the
// PIN, a PIN to turn it on with. Off, a new PIN, or none: once it's on, only with a grant for
// 'settings', asked first as signing would be.
export async function set({ on, pin, removePin = false, grant, here, device, forId }) {
  const a = await store.askOf()
  const asked = a.on ? use(grant, { purpose: 'settings', here, device, forId }) : null
  if (a.on && !asked) throw err('Confirm it\'s you first: Ask Before Signing is on, so changing it is asked for too.', 403, 'ask')
  const change = {}
  if (pin != null) change.pin = await hashPin(pin)
  if (removePin) change.pin = null
  if (typeof on === 'boolean') change.on = on
  const pinAfter = 'pin' in change ? change.pin : a.pin
  const onAfter = 'on' in change ? change.on : a.on
  if (onAfter && !pinAfter && (await wayFor(true)) === 'pin') throw err('This computer can only ask for a signing PIN: set one to turn this on.', 400, 'need-pin')
  if ('pin' in change) Object.assign(change, { fails: 0, lockUntil: 0, locks: 0 })
  await store.setAsk(() => change)
  return status(here)
}
export const helperHere = () => !!signBin()
