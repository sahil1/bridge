// Your Bold Bridge account (account/API.md): one per email, for the two things Bold Bridge runs for
// you, Early Access and Bridge AI's relay, and nothing else. Bridge AI works the same without it,
// and setup never asks for it: it's in Settings › Account, once the accounts service exists.
//
// Signing in is your email and a 6-digit code it's sent; no password. This computer is then one of
// the account's devices (5 at most, computers and phones) and keeps its device token in
// ~/.bridge-ai/account.json (only you can read it), with what the account last said: your email,
// its devices, whether it's a tester (then the updater's Early Access takes its code), and whether it
// may use the relay (then relay.js registers and connects with its relay token). Asked at start,
// every 6 hours, and whenever Settings › Account is opened. Once signed in, the computers linked to
// this one can be signed in too, without the email (a one-time grant, handed over the link between
// them, machines.js); one that would rather not says so, and is left alone after.
//
// What goes to the accounts service: your email, this computer's name, that it's a computer and
// which system, and what you ask for. Never anything else from this computer.
import fs from 'node:fs'
import path from 'node:path'
import { dataFile, ensureDir, writeFileAtomic, loadConfig } from './paths.js'

// Where the accounts service is. Empty, nothing about accounts shows anywhere (Settings, the relay,
// the command line), and Early Access and the relay work as they do without one. One computer can point at another with "account": { "url":
// "https://…" } in its config.json, and BRIDGE_ACCOUNTS_URL stands in for this one (the tests set it
// empty, so none reaches the project's).
export const ACCOUNTS_URL = 'https://accounts.boldbridge.ai'
// Its public key (account/key.js --public), which an Early Access code from the account is checked
// with: one, or several separated by commas while the service's key is being changed (the new one
// added before the service signs with it, the old one kept until what it signed has ended:
// account/README.md, Changing the signing key). BRIDGE_ACCOUNTS_KEY, or "account": { "publicKey" }
// in config.json (a string, or a list), stands in for it.
export const ACCOUNTS_PUBLIC_KEY = 'FqJDwoi18T2Ip2TSLiPxhoP0L56mGOOu_0Zfu4jjr_s'

export function accountsBase() {
  const u = String(loadConfig().account?.url ?? process.env.BRIDGE_ACCOUNTS_URL ?? ACCOUNTS_URL).trim().replace(/\/+$/, '')
  return /^https:\/\/[a-z0-9.-]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u) ? u : null
}
// Its public keys, as a list.
export const accountsKeys = () => [].concat(loadConfig().account?.publicKey ?? process.env.BRIDGE_ACCOUNTS_KEY ?? ACCOUNTS_PUBLIC_KEY).flatMap((k) => String(k ?? '').split(',')).map((k) => k.trim()).filter(Boolean)
// ...and as one setting, comma separated (server/earlyaccess.js tries each).
export const accountsKey = () => accountsKeys().join(',')
export const available = () => !!accountsBase()

const FILE = dataFile('account.json')
const EVERY = 6 * 3600 * 1000
const read = () => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return d && typeof d === 'object' ? d : {} } catch { return {} } }
let conf = read()
const save = () => { ensureDir(path.dirname(FILE)); writeFileAtomic(FILE, JSON.stringify(conf, null, 2), { mode: 0o600 }) }

// What the rest of Bridge AI gives this: this computer's name and system, what to do with an Early
// Access code from the account (index.js puts it in the settings), and who to tell when it changes
// (the relay, the open windows).
let hooks = { name: () => 'Computer', os: () => 'unknown', early: () => {}, changed: () => {} }
export const use = (h) => { hooks = { ...hooks, ...h } }

let lastError = null // { text, at }: the last time the service couldn't be asked
let asking = null

// A call to the accounts service. A refusal throws its own words, with its code and what came
// with it (data: triesLeft, retryAfter, devices); not reaching it throws saying so (code offline).
async function call(method, p, body, token = conf.deviceToken) {
  const base = accountsBase()
  if (!base) throw Object.assign(new Error('Bold Bridge accounts aren\'t available in this version of Bridge AI.'), { code: 'account-none' })
  let res
  try {
    res = await fetch(`${base}${p}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) })
  } catch (e) {
    lastError = { text: e.name === 'TimeoutError' ? 'Bold Bridge didn\'t answer' : 'Can\'t reach Bold Bridge', at: Date.now() }
    throw Object.assign(new Error(`${lastError.text} just now. Check the internet connection and try again.`), { code: 'offline' })
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const { error, code, ...data } = j || {}
    throw Object.assign(new Error(error || `Bold Bridge answered ${res.status}. Try again in a minute.`), { code: code ? `account-${code}` : 'account-error', data })
  }
  lastError = null
  return j
}

const device = () => ({ name: String(hooks.name() || 'Computer').slice(0, 60), kind: 'computer', platform: hooks.os() })
// Signed in: what the service said, kept, and everyone told.
function took(me, by = null) {
  const relayWas = conf.relay?.token || null
  conf = {
    ...conf, ...(me.deviceToken ? { deviceToken: me.deviceToken } : {}),
    account: me.account, devices: me.devices || conf.devices || [], device: me.device || conf.device || null,
    earlyAccess: me.earlyAccess ?? null, relay: me.relay ?? null, at: Date.now(),
    ...(by ? { signedInBy: by } : {}),
  }
  if (me.devices) conf.device = me.devices.find((d) => d.thisOne) || conf.device
  delete conf.pending
  save()
  hooks.early(conf.account?.status === 'active' ? conf.earlyAccess?.code || null : null)
  hooks.changed({ relay: (conf.relay?.token || null) !== relayWas })
}
// Signed out here (by you, or because the account no longer has this computer): everything kept goes.
function out(why = null) {
  const { declined } = conf
  conf = { ...(declined ? { declined } : {}), ...(why ? { signedOut: { why, at: Date.now() } } : {}) }
  save()
  hooks.early(null)
  hooks.changed({ relay: true })
}

// What the account says now (GET /v1/me), which also renews the tokens that are past half their
// life. One at a time; asked again by Settings, it waits on the one under way.
export function refresh() {
  if (!conf.deviceToken) return Promise.resolve(status())
  asking ||= (async () => {
    try {
      took(await call('GET', '/v1/me'))
    } catch (e) {
      // Removed on another device, or the account deleted: this computer isn't signed in any more.
      if (e.code === 'account-signed-out') out('This computer was signed out of Bold Bridge: it was removed from your account on another device, or the account was deleted.')
      else if (e.code !== 'offline') lastError = { text: e.message, at: Date.now() }
    } finally { asking = null }
    return status()
  })()
  return asking
}

// For Settings › Account (and /api/account): signed in or not, the account, its devices, Early
// Access and the relay, and the last thing that went wrong.
export function status() {
  if (!available()) return { available: false }
  const a = conf.account
  const relay = conf.relay
  return {
    available: true,
    signedIn: !!conf.deviceToken && !!a,
    account: a || null,
    device: conf.device || null,
    devices: conf.devices || [],
    early: a ? { state: a.tester, on: !!conf.earlyAccess?.code } : null,
    relay: a ? { state: a.relay, on: !!relay?.token, limits: relay?.limits || null, used: relay?.used || null } : null,
    checkedAt: conf.at ? new Date(conf.at).toISOString() : null,
    pending: conf.pending || null,
    signedInBy: conf.signedInBy || null,
    signedOut: conf.signedOut || null,
    declined: !!conf.declined,
    error: lastError?.text || null,
  }
}

// What the relay needs to know (relay.js): whether accounts exist at all, whether this computer is
// signed in and its account may use the relay ('approved'), and what's missing if not.
export function relayState() {
  if (!available()) return { available: false }
  const a = conf.deviceToken ? conf.account : null
  return { available: true, signedIn: !!a, relay: a?.relay || null, status: a?.status || null, token: conf.relay?.token || null }
}
// The relay token to register and connect with: the one kept while it has an hour left, else the
// account asked for a new one first. null when there's none (signed out, or no relay).
const expOf = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[0], 'base64url').toString('utf8')).exp * 1000 } catch { return 0 } }
export async function relayToken() {
  if (conf.relay?.token && expOf(conf.relay.token) > Date.now() + 3600000) return conf.relay.token
  await refresh()
  return conf.relay?.token && expOf(conf.relay.token) > Date.now() ? conf.relay.token : null
}
export const relayTokenNow = () => (conf.relay?.token && expOf(conf.relay.token) > Date.now() ? conf.relay.token : null)
// The relay's own word on the account's use, fresher than the account's (relay.js hears it).
export function relayUse(u) {
  if (!conf.relay || !u) return
  const at = (t) => (t ? new Date(t).toISOString() : null)
  conf.relay.used = { window: { messages: u.window?.messages || 0, resetsAt: at(u.window?.resetsAt) }, week: { messages: u.week?.messages || 0, resetsAt: at(u.week?.resetsAt) } }
  if (u.window?.limit && u.week?.limit) conf.relay.limits = { window: { hours: u.window.hours, messages: u.window.limit }, week: { messages: u.week.limit }, devices: conf.relay.limits?.devices || 5 }
}

// ---------- signing in ----------
export async function sendCode(email) {
  const e = String(email || '').trim()
  await call('POST', '/v1/code', { email: e }, null)
  conf.pending = { email: e.toLowerCase(), at: Date.now() }
  save()
  return status()
}
// replace: one of the account's devices to remove, to sign in here when it has as many as it takes.
export async function verify({ email, code, replace }) {
  const r = await call('POST', '/v1/verify', { email: String(email || '').trim(), code: String(code || '').replace(/\s+/g, ''), device: device(), ...(replace ? { replace } : {}) }, null)
  conf = { deviceToken: r.deviceToken }
  took({ account: r.account, device: r.device, devices: [r.device] })
  return refresh()
}
export function cancelCode() { delete conf.pending; save(); return status() }

// ---------- linked computers follow ----------
// A one-time grant to sign another of your computers in (machines.js hands it over their link).
export const grant = () => call('POST', '/v1/grant')
// Another of your computers handed this one a grant: signed in with it, unless this one is signed in
// already or said it would rather not (declined). by: that computer's name.
export async function redeem({ grant: g, by, replace }) {
  if (!available()) return { ok: false, why: 'none', text: 'This Bridge AI has no Bold Bridge accounts.' }
  if (conf.deviceToken && conf.account) return { ok: false, why: 'signed-in', text: `Signed in already, as ${conf.account.email}.` }
  if (conf.declined) return { ok: false, why: 'declined', text: 'It said not to sign it in from your other computers. Sign in there by hand, in Settings › Account.' }
  try {
    const r = await call('POST', '/v1/redeem', { grant: g, device: device(), ...(replace ? { replace } : {}) }, null)
    conf = { deviceToken: r.deviceToken }
    took({ account: r.account, device: r.device, devices: [r.device] }, { name: String(by || 'another computer').slice(0, 60), at: Date.now() })
    await refresh()
    return { ok: true }
  } catch (e) {
    return { ok: false, why: e.code === 'account-devices' ? 'devices' : 'error', text: e.message, ...(e.data?.devices ? { devices: e.data.devices } : {}) }
  }
}
// Signed in by another computer, and you'd rather it weren't: signed out, and not again that way
// until you sign in here by hand. Or, kept: the note goes.
export async function followed(keep) {
  if (keep) { delete conf.signedInBy; save(); return status() }
  conf.declined = true
  return signOut()
}
// Signed in by hand clears that, and so does saying yes again.
export function follow() { delete conf.declined; save(); return status() }

// ---------- the account ----------
export async function request(kind, note = '') {
  const r = await call('POST', '/v1/request', { kind, note: String(note || '').slice(0, 500) })
  took({ ...r, devices: conf.devices, earlyAccess: conf.earlyAccess, relay: conf.relay })
  return refresh()
}
export async function removeDevice(id) {
  if (id === conf.device?.id) return signOut()
  const r = await call('DELETE', `/v1/devices/${encodeURIComponent(id)}`)
  took({ account: r.account, devices: r.devices, earlyAccess: conf.earlyAccess, relay: conf.relay })
  return status()
}
// Signed out here at once; the service is told too, and if it can't be reached just then, this
// computer stays on the account's list until it's removed from another device (said so).
export async function signOut() {
  let warn = null
  if (conf.deviceToken) await call('POST', '/v1/signout').catch((e) => { if (e.code === 'offline') warn = 'Signed out here. Bold Bridge couldn\'t be reached, so this computer stays on your account\'s list until you remove it from another device.' })
  out()
  return { ...status(), ...(warn ? { warning: warn } : {}) }
}
// The account and everything kept for it, deleted: email typed again to say so.
export async function deleteAccount(email) {
  await call('DELETE', '/v1/account', { email: String(email || '').trim() })
  out()
  return status()
}

// At start, then every 6 hours.
export function start() {
  if (!available()) return
  refresh().catch(() => {})
  setInterval(() => refresh().catch(() => {}), EVERY).unref()
}
