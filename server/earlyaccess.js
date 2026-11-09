// Early Access: pre-releases for testers, before everyone else (Settings › About & Updates). A
// tester joins with a code the project's owner made for them (scripts/early-access-code.js): who
// it's for (a first name or nickname the owner picks), when it was made and, if it ends, when,
// signed with the owner's Ed25519 private key, which never leaves the owner's computer. Bridge AI
// checks it with the public half, built in below. A code is
//   ea1.<its details, as JSON in base64url>.<the signature of that text, in base64url>
// Nothing here reads or writes a file, so the code script and the tests use it as the server does.
import crypto from 'node:crypto'

// The public half of the owner's key: its 32 bytes in base64url. `node scripts/early-access-code.js
// --new-key` makes the pair and writes this line. Empty: this build takes no codes, and Early Access
// isn't offered anywhere in it.
export const PUBLIC_KEY = ''
// Codes taken back before they end, by id, for good. A release's notes can take one back at once,
// without a new version (<!-- revoked: id -->, shared/rollout.js), while they're among the newest.
export const REVOKED = []

// BRIDGE_EARLY_ACCESS_KEY (tests): a public key of their own instead of the one built in.
export const publicKey = () => process.env.BRIDGE_EARLY_ACCESS_KEY ?? PUBLIC_KEY
// A tester's Bold Bridge account hands this computer a code of its own (server/account.js), signed by
// the accounts service's key, which the server gives here (useAccountsKey; several, comma separated,
// while that key is being changed): codes signed with any of them are good. With none, Early Access
// isn't offered.
let accountsKey = () => ''
export const useAccountsKey = (fn) => { accountsKey = fn }
export const anyKey = () => !!publicKey() || !!accountsKey()

// Who a code is for: letters and numbers, with spaces, dots, apostrophes and dashes between, up to
// 32. It goes with the usage stats (PRIVACY.md), so it's a name the owner picks, never an email.
const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N} .'_-]{0,30}[\p{L}\p{N}.])?$/u
export const labelOk = (s) => typeof s === 'string' && LABEL.test(s)
const CODE = /^ea1\.([A-Za-z0-9_-]{16,400})\.([A-Za-z0-9_-]{86})$/

const b64 = (buf) => Buffer.from(buf).toString('base64url')
let made = null // [base64url, KeyObject]: the public key, read once
const keyOf = (x) => {
  if (made?.[0] !== x) made = [x, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' })]
  return made[1]
}

// A new code for label, ending after days (none: it doesn't end), signed with privateKey (a
// KeyObject, or the PEM text).
export function makeCode({ label, days = null, privateKey, now = Date.now() }) {
  if (!labelOk(label)) throw new Error(`"${label}" can't be a code's name: use letters and numbers (a first name or a nickname), 32 at most`)
  if (days != null && !(days > 0)) throw new Error('--days needs a number of days, more than 0')
  const at = Math.floor(now / 1000)
  const details = { id: crypto.randomBytes(4).toString('hex'), for: label, made: at, ...(days ? { until: at + Math.round(days * 86400) } : {}) }
  const text = b64(JSON.stringify(details))
  return `ea1.${text}.${b64(crypto.sign(null, Buffer.from(text), privateKey))}`
}

// The public half of a private key, as PUBLIC_KEY holds it.
export const publicOf = (privateKey) => crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x

// What a code says, checked: { ok: true, id, for, made, until } (dates as ISO, until null when it
// doesn't end), or { ok: false, why } with what's known of it:
//   none       this build takes no codes (no PUBLIC_KEY)
//   malformed  not a code, or only part of one
//   forged     not signed with the owner's key, or changed since
//   expired    past its end
//   revoked    taken back (REVOKED, or the ids in revoked)
export function readCode(code, { now = Date.now(), revoked = [], key = publicKey() } = {}) {
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
  if ([...REVOKED, ...revoked].includes(d.id)) return { ok: false, why: 'revoked', ...info }
  if (d.until != null && now >= d.until * 1000) return { ok: false, why: 'expired', ...info }
  return { ok: true, ...info }
}

// Why a code can't be used, in words, for the person who pasted it.
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
export function whyNot(r) {
  if (r.why === 'none') return "This version of Bridge AI doesn't take early-access codes."
  if (r.why === 'malformed') return "That isn't a whole early-access code. Paste all of it, from ea1. to the end."
  if (r.why === 'forged') return "That code doesn't check out: it wasn't made by the Bridge AI project, or it changed on the way. Paste it exactly as you got it."
  if (r.why === 'expired') return `That code, for ${r.for}, ended on ${day(r.until)}. Ask for a new one.`
  if (r.why === 'revoked') return `That code, for ${r.for}, was taken back. Ask for a new one.`
  return "That code can't be used."
}
