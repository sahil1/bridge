// Early-access codes, from before anyone could pick Early Access in Settings › About & Updates with
// no code (server/updates.js). A tester's Bold Bridge account still hands each of its computers one
// (server/account.js), signed by the accounts service's key, and a computer with one is on Early
// Access. The code no longer decides that: it says who the tester is (the account's id), in the
// usage stats and crash reports (PRIVACY.md), once it checks out. A code is
//   ea1.<its details, as JSON in base64url>.<the signature of that text, in base64url>
// Nothing here reads or writes a file, so the tests use it as the server does.
import crypto from 'node:crypto'

// The accounts service's public key, which the server gives here (useAccountsKey; several, comma
// separated, while that key is being changed): codes signed with any of them check out.
let accountsKey = () => ''
export const useAccountsKey = (fn) => { accountsKey = fn }

// Who a code is for: letters and numbers, with spaces, dots, apostrophes and dashes between, up to
// 32. It goes with the usage stats (PRIVACY.md), so it's never an email.
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N} .'_-]{0,30}[\p{L}\p{N}.])?$/u
export const labelOk = (s) => typeof s === 'string' && LABEL.test(s)
const CODE = /^ea1\.([A-Za-z0-9_-]{16,400})\.([A-Za-z0-9_-]{86})$/

let made = null // [base64url, KeyObject]: the public key, read once
const keyOf = (x) => {
  if (made?.[0] !== x) made = [x, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' })]
  return made[1]
}

// What a code says, checked: { ok: true, id, for, made, until } (dates as ISO, until null when it
// doesn't end), or { ok: false, why } with what's known of it:
//   none       nothing to check it with (a build with no accounts service)
//   malformed  not a code, or only part of one
//   forged     not signed with the accounts service's key, or changed since
//   expired    past its end (the account renews its code while it has Early Access)
// key: one more key to check it with (the tests' own).
export function readCode(code, { now = Date.now(), key = '' } = {}) {
  const keys = [key, ...String(accountsKey() || '').split(',')].map((k) => String(k || '').trim()).filter(Boolean)
  if (!keys.length) return { ok: false, why: 'none' }
  const m = CODE.exec(String(code || '').replace(/\s+/g, ''))
  let d = null
  try { d = m && JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) } catch { d = null }
  if (!d || typeof d.id !== 'string' || !labelOk(d.for) || !Number.isInteger(d.made) || (d.until != null && !Number.isInteger(d.until))) return { ok: false, why: 'malformed' }
  let signed = false
  for (const k of keys) { try { signed ||= crypto.verify(null, Buffer.from(m[1]), keyOf(k), Buffer.from(m[2], 'base64url')) } catch { /* not this one */ } }
  if (!signed) return { ok: false, why: 'forged' }
  const info = { id: d.id, for: d.for, made: new Date(d.made * 1000).toISOString(), until: d.until != null ? new Date(d.until * 1000).toISOString() : null }
  if (d.until != null && now >= d.until * 1000) return { ok: false, why: 'expired', ...info }
  return { ok: true, ...info }
}
