// Bold Bridge accounts (accounts.boldbridge.ai): a Cloudflare Worker, run once by the project, for
// the account a person signs into with their email, one per email, for the two things Bold Bridge
// runs for them: Early Access and Bridge AI's hosted relay. API.md in this folder is the contract it
// keeps with the relay, Bridge AI and the admin view; README.md is how it goes live.
//
// Sign-in is a 6-digit code sent to the email (Cloudflare's Email Service, the EMAIL binding), never
// a password. A device signed in gets a device token, a computer whose account may use the relay a
// relay token, and a tester's computer an Early Access code: all signed with Ed25519 (SIGNING_KEY, a
// secret), so the relay and Bridge AI check them offline with the public half.
//
// What's kept, in D1: each account's email, whether it's a tester and may use the relay, its status,
// its devices (the name it was given, computer or phone, the platform, when it was added and last
// seen, a hash of its token), its requests, what was done to it and by whom, and the relay's counts
// for it. Never anything from the person's computer. The IP address is read only to limit codes per
// network, kept an hour as a hash of its network, and the Worker's logs are off (wrangler.toml).
//
// The admin view reaches /admin/... (and /internal/...) through a service binding to its Internal
// entrypoint, and the relay only /internal/... through its Relay entrypoint; nothing on the internet
// can reach either, and the public address has only /v1/....
import { WorkerEntrypoint } from 'cloudflare:workers'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const CODE_MINUTES = 10
const CODE_TRIES = 5
const WRONG_PER_DAY = 20 // wrong codes for an email in a day, past which it gets none for a day
const CODES_PER_EMAIL = 5 // an hour
const CODES_PER_NETWORK = 20 // an hour
const FORMS_PER_NETWORK = 5 // requests from the website's form, an hour
const MAX_DEVICES = 5
const GRANT_MINUTES = 5
const DEVICE_DAYS = 180
const RELAY_DAYS = 7
const EARLY_DAYS = 30
const KEEP_USE_DAYS = 90 // the relay's use by day, for the admin view
const MAX_BYTES = 4096
// The relay's limits until it has said its own (its usage reports carry them), and how many
// accounts it takes (MAX_ACCOUNTS, relay/wrangler.hosted.toml) unless RELAY_MAX_ACCOUNTS says.
const RELAY_LIMITS = { window: { hours: 8, messages: 150000 }, week: { messages: 1000000 } }
const RELAY_ACCOUNTS = 500
const TESTER = ['none', 'requested', 'yes', 'declined']
const RELAY = ['none', 'requested', 'approved', 'declined']
const STATUS = ['active', 'suspended']
const ID = /^[a-z0-9]{12}$/
// Throwaway email domains, refused, saying why: a short list of the common ones (and anything under
// them), not a complete one. A person who gets past it still needs an admin to say yes.
export const THROWAWAY = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.info', 'guerrillamailblock.com', 'sharklasers.com', 'grr.la',
  'pokemail.net', 'spam4.me', '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmailo.com',
  'yopmail.com', 'yopmail.net', 'trashmail.com', 'trashmail.de', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com',
  'mintemail.com', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com', 'tempr.email', 'discard.email', 'mailnesia.com', 'spamgourmet.com', 'mailcatch.com',
  'mytemp.email', 'tempinbox.com', 'burnermail.io', 'moakt.com', 'emailfake.com', 'fakemail.net', 'mailpoof.com', 'inboxkitten.com', 'mail.tm', 'tmail.ws',
])

// The tables, made the first time they're needed (so a new database needs nothing run by hand).
export const TABLES = [
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, tester TEXT NOT NULL, relay TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // A device's token is kept as a hash (and the one before it, while a renewed one is on its way),
  // so signing out or removing a device ends it at once.
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, account TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, platform TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, token_hash TEXT NOT NULL, prev_hash TEXT)`,
  'CREATE INDEX IF NOT EXISTS devices_by_account ON devices (account)',
  // One code at a time per email, kept as a hash: for signing in, or to confirm a request from the
  // website (purpose 'request', with what was asked in data).
  'CREATE TABLE IF NOT EXISTS codes (email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL, purpose TEXT NOT NULL, data TEXT)',
  // Codes sent in the last hour, by a hash of the email and of the network (gone after an hour).
  'CREATE TABLE IF NOT EXISTS sent (key TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS sent_by_key ON sent (key, at)',
  // Wrong codes in the last day, and when an email was stopped for a day, by a hash of the email.
  'CREATE TABLE IF NOT EXISTS misses (key TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS misses_by_key ON misses (key, at)',
  'CREATE TABLE IF NOT EXISTS grants (hash TEXT PRIMARY KEY, account TEXT NOT NULL, device TEXT NOT NULL, expires INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, account TEXT NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL, os TEXT NOT NULL,
    via TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT)`,
  'CREATE INDEX IF NOT EXISTS requests_by_state ON requests (state, created_at)',
  'CREATE TABLE IF NOT EXISTS history (account TEXT NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL, what TEXT NOT NULL, note TEXT)',
  'CREATE INDEX IF NOT EXISTS history_by_account ON history (account, at)',
  // The relay's counts for each account (its last report, with its week's messages and when that
  // week ends, to sort by), and its use by day.
  'CREATE TABLE IF NOT EXISTS usage (account TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL, week INTEGER NOT NULL, week_end INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS usage_days (account TEXT NOT NULL, day TEXT NOT NULL, messages INTEGER NOT NULL, PRIMARY KEY (account, day))',
  // What the relay last said of its limits (relayLimits), and codes sent each day.
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, what TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, what))',
]
const ready = new WeakMap() // a database whose tables are made
function tables(db) {
  if (!ready.has(db)) ready.set(db, db.batch(TABLES.map((s) => db.prepare(s))).catch((e) => { ready.delete(db); throw e }))
  return ready.get(db)
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })
// A refusal: a sentence for the person, a word for the app, and whatever else it needs to help.
class Refusal extends Error { constructor(status, code, error, more = {}) { super(error); Object.assign(this, { status, code, more }) } }
const refuse = (status, code, error, more) => { throw new Refusal(status, code, error, more) }

const enc = new TextEncoder()
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const iso = (t) => (t ? new Date(t).toISOString() : null)
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789'
// An account's or a device's id: 12 lowercase letters and digits.
function newId() {
  let s = ''
  while (s.length < 12) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 252 && s.length < 12) s += ALNUM[b % 36]
  return s
}
// Six digits, each as likely as the next.
function sixDigits() {
  for (;;) { const n = crypto.getRandomValues(new Uint32Array(1))[0]; if (n < 4294000000) return String(n % 1000000).padStart(6, '0') }
}
const minutes = (s) => (s <= 60 ? 'a minute' : `${Math.ceil(s / 60)} minutes`)

// ---------- Signing ----------
// SIGNING_KEY is the private key as PKCS #8 PEM (account/key.js makes it); its public half, which
// the relay and Bridge AI hold, is worked out from it here. Each token says which key signed it (kid,
// keyId of its public half), so the key can be changed without anyone signing in again (README.md,
// Changing the signing key): OLD_KEYS, the public halves of keys signed with before (comma
// separated), are still taken for the tokens they signed until those end. A token without a kid,
// from before tokens had one, is checked with SIGNING_KEY's.
export const keyId = async (x) => b64u(await crypto.subtle.digest('SHA-256', unb64(x))).slice(0, 8)
let keys = null // [the settings, { priv, pub, x, kid, all: kid -> public key }]
async function keysOf(env) {
  const pem = String(env.SIGNING_KEY || '')
  const old = String(env.OLD_KEYS || '')
  if (keys?.[0] === `${pem}\n${old}`) return keys[1]
  if (!pem) throw new Error('SIGNING_KEY isn\'t set (README.md, Going live)')
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  const priv = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign'])
  const { x } = await crypto.subtle.exportKey('jwk', priv)
  const pub = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x }, { name: 'Ed25519' }, false, ['verify'])
  const kid = await keyId(x)
  const all = new Map([[kid, pub]])
  for (const o of old.split(',').map((s) => s.trim()).filter(Boolean)) {
    try { all.set(await keyId(o), await crypto.subtle.importKey('raw', unb64(o), { name: 'Ed25519' }, false, ['verify'])) } catch { /* not a key: left out */ }
  }
  keys = [`${pem}\n${old}`, { priv, pub, x, kid, all }]
  return keys[1]
}
const signText = async (env, text) => b64u(await crypto.subtle.sign({ name: 'Ed25519' }, (await keysOf(env)).priv, enc.encode(text)))
// A token: base64url(JSON payload, with the kid of the key that signs it) + "." + base64url(its
// signature).
async function sign(env, payload) {
  const text = b64u(enc.encode(JSON.stringify({ ...payload, kid: (await keysOf(env)).kid })))
  return `${text}.${await signText(env, text)}`
}
// A token's payload when it's signed here (by the key its kid names), of this kind, and not past its
// end; else null.
export async function readToken(env, token, kind) {
  const m = /^([A-Za-z0-9_-]{10,800})\.([A-Za-z0-9_-]{86})$/.exec(String(token || ''))
  if (!m) return null
  let p = null
  try { p = JSON.parse(new TextDecoder().decode(unb64(m[1]))) } catch { return null }
  const k = await keysOf(env)
  const key = p?.kid == null ? k.pub : k.all.get(String(p.kid))
  let good = false
  try { good = !!key && await crypto.subtle.verify({ name: 'Ed25519' }, key, unb64(m[2]), enc.encode(m[1])) } catch { good = false }
  if (!good) return null
  return p?.k === kind && ID.test(p.a) && ID.test(p.d) && Number.isInteger(p.exp) && p.exp * 1000 > Date.now() ? p : null
}
const seconds = (t) => Math.floor(t / 1000)
const deviceToken = (env, a, d, now, iat = seconds(now)) => sign(env, { k: 'device', a, d, iat, exp: iat + DEVICE_DAYS * 86400 })
// A renewed one starts at the beginning of its day, so the same one comes back all that day: the
// one it replaces, used again (its answer lost, or two asks at once), gets that one again, rather
// than another put in its place that signs out the device holding the first.
const renewedToken = (env, a, d, now) => deviceToken(env, a, d, now, Math.floor(seconds(now) / 86400) * 86400)
// The relay token and the Early Access code start at the beginning of a half of their life, so the
// same one comes back until it's past half its life, and then a new one: renewed by GET /v1/me with
// nothing kept here (Ed25519 signs the same text the same way).
async function relayToken(env, a, d, now) {
  const half = (RELAY_DAYS / 2) * 86400
  const iat = Math.floor(seconds(now) / half) * half
  return sign(env, { k: 'relay', a, d, iat, exp: iat + RELAY_DAYS * 86400 })
}
// In server/earlyaccess.js's format (ea1.<details>.<signature>). Who it's for is the account's id: it
// goes with the usage stats, which never carry an email.
async function earlyCode(env, a, now) {
  const half = (EARLY_DAYS / 2) * 86400
  const made = Math.floor(seconds(now) / half) * half
  const text = b64u(enc.encode(JSON.stringify({ id: a, for: a, made, until: made + EARLY_DAYS * 86400 })))
  return `ea1.${text}.${await signText(env, text)}`
}

// ---------- Emails ----------
const clean = (e) => String(e ?? '').trim().toLowerCase()
const EMAIL = /^[^\s@]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/
const throwaway = (domain) => { const p = domain.split('.'); for (let i = 0; i < p.length - 1; i++) if (THROWAWAY.has(p.slice(i).join('.'))) return true; return false }
function emailOf(v) {
  const e = clean(v)
  if (e.length > 254 || !EMAIL.test(e)) refuse(400, 'invalid', 'That doesn\'t look like an email address. Check it and try again.')
  const domain = e.split('@')[1]
  if (throwaway(domain)) refuse(400, 'throwaway', `Bold Bridge doesn't take throwaway addresses (${domain}). Your code, and news about your account, go to this email, so use one you keep.`)
  return e
}
// An email from Bold Bridge. A failure throws, and the caller says so.
async function mail(env, to, subject, text) {
  if (!env.EMAIL || !env.FROM) throw new Error('email isn\'t set up (README.md, Going live)')
  await env.EMAIL.send({ to, from: { email: env.FROM, name: 'Bold Bridge' }, subject, text })
}
const WHAT = { early: 'Early Access', relay: 'Bridge AI\'s relay' }

// ---------- Codes ----------
// A network, as codes are limited by: an IPv4 address's /24, or an IPv6 address's /48.
function networkOf(req) {
  const ip = String(req.headers.get('CF-Connecting-IP') || '').toLowerCase()
  if (!ip.includes(':')) return ip.split('.').slice(0, 3).join('.')
  const [a, b = ''] = ip.split('::')
  const head = a ? a.split(':') : []
  const tail = b ? b.split(':') : []
  return [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail].slice(0, 3).map((x) => x.replace(/^0+(?=.)/, '')).join(':')
}
// The limits a code is sent under, as keys of the sent table: this email, this network and, for the
// website's form, its own. Past one: refused, saying when to try again. An email stopped for a day
// (WRONG_PER_DAY wrong codes) gets none until then.
async function mayCode(db, req, email, now, form) {
  const until = await stoppedUntil(db, email, now)
  if (until > now) stopped(until, now)
  const net = networkOf(req)
  const limits = [[`e:${(await sha(`email ${email}`)).slice(0, 32)}`, CODES_PER_EMAIL, 'this email'], [`n:${(await sha(`net ${net}`)).slice(0, 32)}`, CODES_PER_NETWORK, 'this network']]
  if (form) limits.push([`f:${(await sha(`form ${net}`)).slice(0, 32)}`, FORMS_PER_NETWORK, 'this network'])
  for (const [key, max, who] of limits) {
    const r = await db.prepare('SELECT COUNT(*) AS n, MIN(at) AS first FROM sent WHERE key = ? AND at > ?').bind(key, now - HOUR).first()
    if ((r?.n || 0) >= max) {
      const retryAfter = Math.max(1, Math.ceil((r.first + HOUR - now) / 1000))
      refuse(429, 'too-many', `Too many codes for ${who} in the last hour. Try again in ${minutes(retryAfter)}.`, { retryAfter })
    }
  }
  return limits.map(([k]) => k)
}
// A suspended account's email is answered as any other's (whoever asked can't tell it has an
// account, or that it's suspended), under the same limits; the email itself says it's suspended,
// with no code in it.
async function sendCode(req, env, email, purpose, data = null) {
  const db = env.DB
  const now = Date.now()
  const acct = await byEmail(db, email)
  const off = acct?.status === 'suspended'
  const keys = await mayCode(db, req, email, now, purpose === 'request')
  const code = sixDigits()
  if (off) await db.prepare('DELETE FROM codes WHERE email = ?').bind(email).run()
  else {
    await db.prepare('INSERT INTO codes (email, hash, expires, tries, purpose, data) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT (email) DO UPDATE SET hash = excluded.hash, expires = excluded.expires, tries = 0, purpose = excluded.purpose, data = excluded.data')
      .bind(email, await sha(`code ${email} ${code}`), now + CODE_MINUTES * 60000, purpose, data ? JSON.stringify(data) : null).run()
  }
  try {
    if (off) await mail(env, email, 'Your Bold Bridge account is suspended', 'Someone, probably you, asked for a code for your Bold Bridge account. It\'s suspended, so there\'s no code to sign in with for now. If you think that\'s a mistake, reply to this email.\n\nBold Bridge')
    else {
      await mail(env, email, `${code} is your Bold Bridge code`, purpose === 'request'
        ? `To confirm your request for ${WHAT[data.kind]}, enter this code on boldbridge.ai:\n\n${code}\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask, ignore this email: nothing happens without the code.\n\nBold Bridge`
        : `Your code to sign in to Bold Bridge is:\n\n${code}\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email: nobody can sign in without the code.\n\nBold Bridge`)
    }
  } catch (e) {
    await db.prepare('DELETE FROM codes WHERE email = ?').bind(email).run()
    refuse(502, 'unsent', `The email with your code couldn't be sent just now (${e.message}). Try again in a minute.`)
  }
  await db.batch([
    ...keys.map((k) => db.prepare('INSERT INTO sent (key, at) VALUES (?, ?)').bind(k, now)),
    db.prepare('DELETE FROM sent WHERE at < ?').bind(now - HOUR),
    db.prepare('INSERT INTO daily (day, what, n) VALUES (?, \'codes\', 1) ON CONFLICT DO UPDATE SET n = n + 1').bind(iso(now).slice(0, 10)),
  ])
}
// The code waiting for this email, checked. A wrong one is a try, counted in the same statement that
// finds it wrong (and only while it has tries left and hasn't run out), so guesses sent all at once
// can't each find it untried: five are checked at most, and the fifth ends it. A wrong one counts
// towards the email's day too (missed). The right one is used up by used(): a delete that must find
// it, so the same code can't sign in twice at once.
async function checkCode(db, email, code, purpose) {
  const now = Date.now()
  const given = String(code ?? '').replace(/\s+/g, '')
  const hash = /^\d{6}$/.test(given) ? await sha(`code ${email} ${given}`) : ''
  const wrong = await db.prepare('UPDATE codes SET tries = tries + 1 WHERE email = ? AND purpose = ? AND tries < ? AND expires > ? AND hash != ? RETURNING tries')
    .bind(email, purpose, CODE_TRIES, now, hash).first()
  if (wrong) {
    const left = CODE_TRIES - wrong.tries
    if (await missed(db, email, now)) stopped(now + DAY, now, true)
    if (left <= 0) {
      await db.prepare('DELETE FROM codes WHERE email = ? AND tries >= ?').bind(email, CODE_TRIES).run()
      refuse(400, 'expired', `That was the ${CODE_TRIES === 5 ? 'fifth' : `${CODE_TRIES}th`} wrong try, so the code no longer works. Ask for a new one.`)
    }
    refuse(400, 'wrong', `That code isn't right. ${left === 1 ? '1 more try' : `${left} more tries`} with this one.`, { triesLeft: left })
  }
  const row = await db.prepare('SELECT hash, data FROM codes WHERE email = ? AND purpose = ? AND tries < ? AND expires > ? AND hash = ?')
    .bind(email, purpose, CODE_TRIES, now, hash).first()
  if (!row) {
    // Why not, said as well as it can be: none (or one for something else), ran out, or used up.
    const was = await db.prepare('SELECT expires, purpose FROM codes WHERE email = ?').bind(email).first()
    if (!was || was.purpose !== purpose) refuse(400, 'expired', 'There\'s no code waiting for this email: it ran out, or a newer one was sent. Ask for a new one.')
    await db.prepare('DELETE FROM codes WHERE email = ? AND expires = ?').bind(email, was.expires).run()
    if (was.expires <= now) refuse(400, 'expired', `That code ran out (a code lasts ${CODE_MINUTES} minutes). Ask for a new one.`)
    refuse(400, 'expired', `That code has had its ${CODE_TRIES} tries, so it no longer works. Ask for a new one.`)
  }
  const used = async () => {
    const r = await db.prepare('DELETE FROM codes WHERE email = ? AND hash = ?').bind(email, row.hash).run()
    if (r?.meta?.changes !== 1) refuse(400, 'expired', 'That code was used already, or a newer one was sent. Ask for a new one.')
  }
  return { row, used }
}

// Wrong codes for an email, kept a day under a hash of it. The WRONG_PER_DAY-th stops it for a day
// (its waiting code goes too): whoever is guessing has had their tries at a million, and the person
// whose email it is can still use the devices they're signed in on. true: stopped now.
const missKey = async (email) => (await sha(`wrong ${email}`)).slice(0, 32)
async function missed(db, email, now) {
  const k = await missKey(email)
  await db.prepare('INSERT INTO misses (key, at) VALUES (?, ?)').bind(`w:${k}`, now).run()
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM misses WHERE key = ? AND at > ?').bind(`w:${k}`, now - DAY).first())?.n || 0
  if (n < WRONG_PER_DAY) return false
  await db.batch([db.prepare('INSERT INTO misses (key, at) VALUES (?, ?)').bind(`x:${k}`, now), db.prepare('DELETE FROM codes WHERE email = ?').bind(email)])
  return true
}
// Until when an email is stopped (0: it isn't).
async function stoppedUntil(db, email, now) {
  const r = await db.prepare('SELECT MAX(at) AS at FROM misses WHERE key = ? AND at > ?').bind(`x:${await missKey(email)}`, now - DAY).first()
  return r?.at ? r.at + DAY : 0
}
function stopped(until, now, already = false) {
  const retryAfter = Math.max(1, Math.ceil((until - now) / 1000))
  const when = retryAfter <= 3600 ? minutes(retryAfter) : `${Math.ceil(retryAfter / 3600)} hours`
  refuse(429, 'stopped', `${already ? `That's ${WRONG_PER_DAY} wrong codes for this email today, so no more` : `There were ${WRONG_PER_DAY} wrong codes for this email today, so no more`} go to it for now. Try again in ${when}; where you're signed in already, nothing changes.`, { retryAfter })
}

// ---------- Accounts and devices ----------
const byEmail = (db, email) => db.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first()
const byId = (db, id) => db.prepare('SELECT * FROM accounts WHERE id = ?').bind(String(id)).first()
const devicesOf = async (db, a) => (await db.prepare('SELECT * FROM devices WHERE account = ? ORDER BY created_at').bind(a).all()).results || []
const accountView = (a) => ({ id: a.id, email: a.email, tester: a.tester, relay: a.relay, status: a.status, createdAt: iso(a.created_at) })
const deviceView = (d, me = null) => ({ id: d.id, name: d.name, kind: d.kind, platform: d.platform, createdAt: iso(d.created_at), lastSeen: iso(d.last_seen), thisOne: d.id === me })
// A line in the account's history: who (the person, an admin's email, the service), what, and why.
const noted = (db, a, by, what, note = null) => db.prepare('INSERT INTO history (account, at, by, what, note) VALUES (?, ?, ?, ?, ?)').bind(a, Date.now(), by, what.slice(0, 500), note || null)
function suspended() { refuse(403, 'suspended', 'This Bold Bridge account is suspended, so it can\'t be used for now. If you think that\'s a mistake, reply to an email from Bold Bridge.') }
const active = (acct) => { if (acct.status !== 'active') suspended() }

// An email's first sign-in (or an admin's invitation) makes its account.
async function create(db, email, by = 'self') {
  const id = newId()
  const now = Date.now()
  await db.batch([
    db.prepare('INSERT INTO accounts (id, email, tester, relay, status, created_at) VALUES (?, ?, \'none\', \'none\', \'active\', ?) ON CONFLICT (email) DO NOTHING').bind(id, email, now),
  ])
  const acct = await byEmail(db, email)
  if (acct.id === id) await noted(db, id, by, by === 'self' ? 'made the account' : 'invited').run()
  return acct
}

function deviceOf(d) {
  const name = String(d?.name ?? '').trim().slice(0, 60)
  const platform = String(d?.platform ?? '').trim().slice(0, 24) || 'unknown'
  if (!name || !['computer', 'phone'].includes(d?.kind)) refuse(400, 'invalid', 'Say which device this is: its name, and whether it\'s a computer or a phone.')
  return { name, kind: d.kind, platform }
}
// A device added to the account (a sign-in, or a grant redeemed): at most MAX_DEVICES, past which
// it's refused with the list, so one can be removed first (replace: the id of one to remove and
// put this one in its place, with the same code or grant). claim uses up the code or grant once
// there's room, before anything is written: a second sign-in with it at the same moment finds it gone.
async function addDevice(env, acct, device, replace = null, claim = null) {
  const db = env.DB
  active(acct)
  const list = await devicesOf(db, acct.id)
  const out = replace && list.find((x) => x.id === replace)
  if (list.length >= MAX_DEVICES && !out) refuse(409, 'devices', `Your account has ${MAX_DEVICES} devices, as many as it takes. Remove one to sign in here.`, { devices: list.map((x) => deviceView(x)) })
  if (claim) await claim()
  const id = newId()
  const now = Date.now()
  const token = await deviceToken(env, acct.id, id, now)
  await db.batch([
    ...(out ? [db.prepare('DELETE FROM devices WHERE id = ?').bind(out.id), noted(db, acct.id, 'self', `removed ${out.name} to sign in on ${device.name}`)] : []),
    db.prepare('INSERT INTO devices (id, account, name, kind, platform, created_at, last_seen, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, acct.id, device.name, device.kind, device.platform, now, now, await sha(token)),
    noted(db, acct.id, 'self', `signed in on ${device.name} (${device.kind}, ${device.platform})`),
  ])
  // The account's email hears of each device signed in after its first, so one that wasn't the
  // person's own doing doesn't go unseen. Not sent: written in its history, and the sign-in stands.
  if (list.length) {
    const at = new Date(now)
    const when = `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}, ${at.toISOString().slice(11, 16)} UTC`
    await mail(env, acct.email, 'A new sign-in to your Bold Bridge account', `"${device.name}" (a ${device.kind}, ${device.platform}) was signed in to your Bold Bridge account (${acct.email}) on ${when}.\n\nIf that was you, there's nothing to do. If it wasn't, remove it in Bridge AI on one of your computers (Settings › Account), and change your email's password: whoever signed in had a code sent to this email, or one of your computers signed in already.\n\nBold Bridge`)
      .catch(() => noted(db, acct.id, 'service', `the email about ${device.name} signing in couldn't be sent`).run())
  }
  return { account: accountView(acct), device: deviceView({ id, ...device, created_at: now, last_seen: now }, id), deviceToken: token }
}

// The device a request comes from, by its token (Authorization: Bearer): signed here, not past its
// end, and still on its account (signing out or removing it ends it at once).
async function signedIn(req, env) {
  const t = /^Bearer (\S{20,1000})$/.exec(req.headers.get('Authorization') || '')?.[1]
  const out = () => refuse(401, 'signed-out', 'This device isn\'t signed in to Bold Bridge any more: it was signed out, or removed from the account. Sign in again.')
  const p = t ? await readToken(env, t, 'device') : null
  if (!p) out()
  const hash = await sha(t)
  const dev = await env.DB.prepare('SELECT * FROM devices WHERE id = ? AND account = ?').bind(p.d, p.a).first()
  if (!dev || (dev.token_hash !== hash && dev.prev_hash !== hash)) out()
  const acct = await byId(env.DB, p.a)
  if (!acct) out()
  return { acct, dev, p, hash }
}

// What the relay last reported of an account's use, as of now (a window or week that has ended
// since is back to nothing); null before it has reported any.
async function usedOf(db, a, now = Date.now()) {
  const row = await db.prepare('SELECT data FROM usage WHERE account = ?').bind(a).first()
  if (!row) return null
  let d = {}
  try { d = JSON.parse(row.data) } catch { return null }
  const part = (w) => (w?.resetsAt && Date.parse(w.resetsAt) > now ? { messages: Number(w.messages) || 0, resetsAt: w.resetsAt } : { messages: 0, resetsAt: null })
  return { window: part(d.window), week: part(d.week) }
}
const setting = async (db, key) => (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first())?.value ?? null
async function limitsOf(db) {
  let l = null
  try { l = JSON.parse(await setting(db, 'relayLimits')) } catch { l = null }
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  return { window: { hours: n(l?.window?.hours, RELAY_LIMITS.window.hours), messages: n(l?.window?.messages, RELAY_LIMITS.window.messages) }, week: { messages: n(l?.week?.messages, RELAY_LIMITS.week.messages) }, devices: MAX_DEVICES }
}

// ---------- /v1: Bridge AI, the website's form ----------
async function body(req) {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) refuse(415, 'invalid', 'Send JSON.')
  const text = await req.text()
  if (text.length > MAX_BYTES) refuse(413, 'invalid', 'That\'s too much at once.')
  let b = null
  try { b = JSON.parse(text || '{}') } catch { refuse(400, 'invalid', 'Send JSON.') }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {}
}

// Asked for Early Access or the relay (in Bridge AI, the website's form): kept for the admin view
// (one open request of a kind per account; asking again updates its note), and the admins' emails
// get a short note. Already given, nothing changes.
async function ask(env, acct, kind, note, via, os) {
  const db = env.DB
  const col = kind === 'early' ? 'tester' : 'relay'
  if (acct[col] === (kind === 'early' ? 'yes' : 'approved')) return acct
  const now = Date.now()
  const open = await db.prepare('SELECT id FROM requests WHERE account = ? AND kind = ? AND state = \'open\'').bind(acct.id, kind).first()
  await db.batch([
    db.prepare(`UPDATE accounts SET ${col} = 'requested' WHERE id = ?`).bind(acct.id),
    open ? db.prepare('UPDATE requests SET note = ?, os = ?, via = ?, created_at = ? WHERE id = ?').bind(note, os, via, now, open.id)
      : db.prepare('INSERT INTO requests (id, account, kind, note, os, via, state, created_at) VALUES (?, ?, ?, ?, ?, ?, \'open\', ?)').bind(newId(), acct.id, kind, note, os, via, now),
    noted(db, acct.id, 'self', `asked for ${WHAT[kind]}${via === 'site' ? ' on the website' : ''}`),
  ])
  const admins = String(env.ADMINS || '').split(',').map(clean).filter((e) => EMAIL.test(e))
  for (const to of admins) {
    await mail(env, to, `Request for ${WHAT[kind]}: ${acct.email}`, `${acct.email} asked for ${WHAT[kind]}${via === 'site' ? ' on the website' : ' in Bridge AI'}${os ? ` (${os})` : ''}.\n\n${note ? `Their note: ${note}\n\n` : ''}Approve or decline it in the admin view.`)
      .catch(() => noted(db, acct.id, 'service', `the note to ${to} couldn't be sent`).run())
  }
  return { ...acct, [col]: 'requested' }
}
const kindOf = (k) => (['early', 'relay'].includes(k) ? k : refuse(400, 'invalid', 'Ask for "early" (Early Access) or "relay" (Bridge AI\'s relay).'))

async function v1(req, env, url) {
  const db = env.DB
  const p = url.pathname
  const post = req.method === 'POST'
  if (p === '/v1/code' && post) {
    const b = await body(req)
    const email = emailOf(b.email)
    await sendCode(req, env, email, 'signin')
    return json({ sent: true })
  }
  if (p === '/v1/verify' && post) {
    const b = await body(req)
    const email = emailOf(b.email)
    const device = deviceOf(b.device)
    const { used } = await checkCode(db, email, b.code, 'signin')
    const acct = (await byEmail(db, email)) || (await create(db, email))
    return json(await addDevice(env, acct, device, b.replace, used)) // the code stays, refused for devices, to pick one to replace
  }
  if (p === '/v1/grant' && post) {
    const { acct, dev } = await signedIn(req, env)
    active(acct)
    const grant = b64u(crypto.getRandomValues(new Uint8Array(32)))
    const expires = Date.now() + GRANT_MINUTES * 60000
    await db.batch([
      db.prepare('DELETE FROM grants WHERE expires < ?').bind(Date.now()),
      db.prepare('INSERT INTO grants (hash, account, device, expires) VALUES (?, ?, ?, ?)').bind(await sha(`grant ${grant}`), acct.id, dev.id, expires),
    ])
    return json({ grant, expires: iso(expires) })
  }
  if (p === '/v1/redeem' && post) {
    const b = await body(req)
    const device = deviceOf(b.device)
    const hash = await sha(`grant ${String(b.grant || '')}`)
    const g = await db.prepare('SELECT * FROM grants WHERE hash = ?').bind(hash).first()
    if (!g || g.expires <= Date.now()) refuse(400, 'expired', `That sign-in from your other computer ran out (it lasts ${GRANT_MINUTES} minutes). Sign in here with your email instead, in Settings › Account.`)
    const acct = await byId(db, g.account)
    if (!acct) refuse(400, 'expired', 'That account isn\'t there any more.')
    const claim = async () => { if ((await db.prepare('DELETE FROM grants WHERE hash = ?').bind(hash).run())?.meta?.changes !== 1) refuse(400, 'expired', 'That sign-in from your other computer was used already. Sign in here with your email instead, in Settings › Account.') }
    return json(await addDevice(env, acct, device, b.replace, claim))
  }
  if (p === '/v1/me' && req.method === 'GET') {
    const { acct, dev, p: tok, hash } = await signedIn(req, env)
    const now = Date.now()
    const ok = acct.status === 'active'
    // Past half its life, or signed with a key before this one (or before tokens said which), a new
    // device token; the one this came with works until the new one is used.
    const renew = ok && (seconds(now) > tok.iat + (DEVICE_DAYS * 86400) / 2 || tok.kid !== (await keysOf(env)).kid) ? await renewedToken(env, acct.id, dev.id, now) : null
    await db.batch([
      db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(now, dev.id),
      ...(renew ? [db.prepare('UPDATE devices SET token_hash = ?, prev_hash = ? WHERE id = ?').bind(await sha(renew), hash, dev.id)] : []),
    ])
    return json({
      account: accountView(acct),
      devices: (await devicesOf(db, acct.id)).map((x) => deviceView({ ...x, last_seen: x.id === dev.id ? now : x.last_seen }, dev.id)),
      earlyAccess: ok && acct.tester === 'yes' ? { code: await earlyCode(env, acct.id, now) } : null,
      relay: ok && acct.relay === 'approved' && dev.kind === 'computer' ? { token: await relayToken(env, acct.id, dev.id, now), limits: await limitsOf(db), used: await usedOf(db, acct.id, now) } : null,
      ...(renew ? { deviceToken: renew } : {}),
    })
  }
  if (p === '/v1/request' && post) {
    const { acct, dev } = await signedIn(req, env)
    active(acct)
    const b = await body(req)
    const kind = kindOf(b.kind)
    return json({ account: accountView(await ask(env, acct, kind, String(b.note ?? '').trim().slice(0, 500), 'app', dev.platform)) })
  }
  if (p === '/v1/request-public' && post) return requestPublic(req, env)
  const del = /^\/v1\/devices\/([a-z0-9]{12})$/.exec(p)
  if (del && req.method === 'DELETE') {
    const { acct, dev } = await signedIn(req, env)
    const gone = (await devicesOf(db, acct.id)).find((x) => x.id === del[1])
    if (!gone) refuse(404, 'none', 'That device isn\'t on your account (it was removed already).')
    await db.batch([db.prepare('DELETE FROM devices WHERE id = ?').bind(gone.id), noted(db, acct.id, 'self', `removed ${gone.name}${gone.id === dev.id ? '' : ` from ${dev.name}`}`)])
    return json({ account: accountView(acct), devices: (await devicesOf(db, acct.id)).map((x) => deviceView(x, dev.id)) })
  }
  if (p === '/v1/signout' && post) {
    const { acct, dev } = await signedIn(req, env)
    await db.batch([db.prepare('DELETE FROM devices WHERE id = ?').bind(dev.id), noted(db, acct.id, 'self', `signed out on ${dev.name}`)])
    return json({ ok: true })
  }
  if (p === '/v1/account' && req.method === 'DELETE') {
    const { acct } = await signedIn(req, env)
    const b = await body(req)
    if (clean(b.email) !== acct.email) refuse(400, 'mismatch', 'Type the account\'s email exactly as it is, to say you mean to delete it.')
    await forget(db, acct)
    return json({ deleted: true })
  }
  return new Response('Not found\n', { status: 404 })
}

// Everything kept for an account goes: the account, its devices, requests, history and counts.
async function forget(db, acct) {
  await db.batch([
    ...['devices', 'grants', 'requests', 'history', 'usage', 'usage_days'].map((t) => db.prepare(`DELETE FROM ${t} WHERE account = ?`).bind(acct.id)),
    db.prepare('DELETE FROM codes WHERE email = ?').bind(acct.email),
    db.prepare('DELETE FROM accounts WHERE id = ?').bind(acct.id),
  ])
}

// From the form on boldbridge.ai, without a sign-in: { email, kind, note, os } sends a code to the
// email, and the same with the code counts the request (the account is made if it's new).
async function requestPublic(req, env) {
  const db = env.DB
  const b = await body(req)
  const email = emailOf(b.email)
  const kind = kindOf(b.kind)
  const note = String(b.note ?? '').trim().slice(0, 500)
  const os = String(b.os ?? '').trim().slice(0, 24)
  if (b.code == null) {
    await sendCode(req, env, email, 'request', { kind, note, os })
    return json({ sent: true })
  }
  const { row, used } = await checkCode(db, email, b.code, 'request')
  let asked = {}
  try { asked = JSON.parse(row.data || '{}') } catch { asked = {} }
  const acct = (await byEmail(db, email)) || (await create(db, email))
  active(acct)
  await used()
  return json({ account: accountView(await ask(env, acct, asked.kind || kind, asked.note ?? note, 'site', asked.os || os)) })
}

// ---------- /admin and /internal: the admin view and the relay, through a service binding ----------
// Only through the entrypoints below, which a service binding names and the internet can't reach;
// the public address refuses both (404). /internal is the relay's (account/API.md, The relay's side),
// through Relay, which has nothing else; /admin the admin view's, through Internal, each call saying
// which admin is asking (X-Admin-Email), which goes in the account's history.
async function inside(req, env, url) {
  const db = env.DB
  const p = url.pathname
  if (p === '/internal/status' && req.method === 'GET') return json(await statusOf(db, url.searchParams.get('a'), url.searchParams.get('d')))
  if (p === '/internal/usage' && req.method === 'POST') return json(await usage(db, await body(req)))
  if (!p.startsWith('/admin/')) return new Response('Not found\n', { status: 404 })
  const by = clean(req.headers.get('X-Admin-Email'))
  if (!EMAIL.test(by)) refuse(400, 'admin', 'Say which admin is asking (X-Admin-Email): it goes in the account\'s history.')
  const q = url.searchParams
  const now = Date.now()
  if (p === '/admin/stats' && req.method === 'GET') {
    const n = async (sql, ...a) => (await db.prepare(sql).bind(...a).first())?.n || 0
    const today = iso(now).slice(0, 10)
    return json({
      accounts: await n('SELECT COUNT(*) AS n FROM accounts'),
      devices: await n('SELECT COUNT(*) AS n FROM devices'),
      testers: await n('SELECT COUNT(*) AS n FROM accounts WHERE tester = \'yes\''),
      relayAccounts: await n('SELECT COUNT(*) AS n FROM accounts WHERE relay = \'approved\''),
      waiting: { early: await n('SELECT COUNT(*) AS n FROM requests WHERE state = \'open\' AND kind = \'early\''), relay: await n('SELECT COUNT(*) AS n FROM requests WHERE state = \'open\' AND kind = \'relay\'') },
      codesToday: await n('SELECT SUM(n) AS n FROM daily WHERE what = \'codes\' AND day = ?', today),
      codesMonth: await n('SELECT SUM(n) AS n FROM daily WHERE what = \'codes\' AND day >= ?', `${today.slice(0, 7)}-01`),
      relayMax: relayMax(env),
    })
  }
  if (p === '/admin/requests' && req.method === 'GET') {
    const state = q.get('state') || 'open'
    const kind = q.get('kind') || ''
    const rows = (await db.prepare(`SELECT r.*, a.email FROM requests r JOIN accounts a ON a.id = r.account
      WHERE (? = 'all' OR r.state = ?) AND (? = '' OR r.kind = ?) ORDER BY r.created_at DESC LIMIT 200`).bind(state, state, kind, kind).all()).results || []
    return json({ requests: rows.map((r) => ({ account: r.account, email: r.email, kind: r.kind, note: r.note, os: r.os, at: iso(r.created_at) })) })
  }
  if (p === '/admin/accounts' && req.method === 'GET') {
    const text = String(q.get('q') || '').trim().toLowerCase()
    const page = Math.max(1, Math.floor(Number(q.get('page')) || 1))
    const where = '(? = \'\' OR a.email LIKE ? OR a.id = ?) AND (? = \'\' OR a.tester = ?) AND (? = \'\' OR a.relay = ?)'
    const tester = TESTER.includes(q.get('tester')) ? q.get('tester') : ''
    const relay = RELAY.includes(q.get('relay')) ? q.get('relay') : ''
    const args = [text, `%${text.replace(/[%_]/g, '')}%`, text, tester, tester, relay, relay]
    // sort=use: the week's relay use, heaviest first (a week that has ended counts as nothing).
    const order = q.get('sort') === 'use' ? 'CASE WHEN u.week_end > ? THEN u.week ELSE 0 END DESC, a.created_at DESC' : 'a.created_at DESC'
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM accounts a WHERE ${where}`).bind(...args).first())?.n || 0
    const rows = (await db.prepare(`SELECT a.* FROM accounts a LEFT JOIN usage u ON u.account = a.id WHERE ${where} ORDER BY ${order} LIMIT 50 OFFSET ?`)
      .bind(...args, ...(q.get('sort') === 'use' ? [now] : []), (page - 1) * 50).all()).results || []
    const accounts = []
    for (const a of rows) {
      const devices = await devicesOf(db, a.id)
      accounts.push({ ...accountView(a), devices: devices.map((d) => deviceView(d)), lastSeen: iso(Math.max(0, ...devices.map((d) => d.last_seen)) || null), used: await usedOf(db, a.id, now) })
    }
    return json({ accounts, limits: await limitsOf(db), page, pages: Math.max(1, Math.ceil(total / 50)), total })
  }
  const one = /^\/admin\/accounts\/([a-z0-9]{12})(?:\/devices\/([a-z0-9]{12}))?$/.exec(p)
  if (one) {
    const acct = await byId(db, one[1])
    if (!acct) refuse(404, 'none', 'No such account.')
    if (one[2] && req.method === 'DELETE') {
      const dev = (await devicesOf(db, acct.id)).find((d) => d.id === one[2])
      if (!dev) refuse(404, 'none', 'That device isn\'t on this account.')
      await db.batch([db.prepare('DELETE FROM devices WHERE id = ?').bind(dev.id), noted(db, acct.id, by, `removed ${dev.name}`)])
      return json({ devices: (await devicesOf(db, acct.id)).map((d) => deviceView(d)) })
    }
    if (one[2]) return new Response('Not found\n', { status: 404 })
    if (req.method === 'GET') {
      const history = (await db.prepare('SELECT at, by, what, note FROM history WHERE account = ? ORDER BY at DESC LIMIT 200').bind(acct.id).all()).results || []
      const days = (await db.prepare('SELECT day, messages FROM usage_days WHERE account = ? ORDER BY day DESC LIMIT ?').bind(acct.id, KEEP_USE_DAYS).all()).results || []
      return json({
        account: accountView(acct),
        devices: (await devicesOf(db, acct.id)).map((d) => deviceView(d)),
        history: history.map((h) => ({ at: iso(h.at), by: h.by, what: h.what, note: h.note || null })),
        usage: days.map((d) => ({ day: d.day, messages: d.messages })),
        used: await usedOf(db, acct.id, now),
        limits: await limitsOf(db),
      })
    }
    if (req.method === 'POST') return json(await change(env, acct, await body(req), by))
  }
  if (p === '/admin/invite' && req.method === 'POST') {
    const b = await body(req)
    const email = emailOf(b.email)
    const was = await byEmail(db, email)
    const acct = was || (await create(db, email, by))
    const { account, emailed } = await change(env, acct, { tester: b.tester ?? (b.relay == null ? 'yes' : undefined), relay: b.relay, note: b.note }, by, { invite: true })
    return json({ account, created: !was, emailed })
  }
  return new Response('Not found\n', { status: 404 })
}
// How many accounts the relay takes (its MAX_ACCOUNTS, the same number in this Worker's settings).
const relayMax = (env) => (Number.isFinite(Number(env.RELAY_MAX_ACCOUNTS)) && env.RELAY_MAX_ACCOUNTS !== '' ? Number(env.RELAY_MAX_ACCOUNTS) : RELAY_ACCOUNTS)

// An admin's change to an account ({ tester, relay, status, note }), each written to its history with
// who made it and the note. Open requests of that kind are closed with it, and the person is emailed
// when Early Access or the relay is given (an invitation, for invite). Suspending or restoring needs
// a note, to say why later. Giving the relay to one account more than it takes is refused: it's full.
// emailed: whether an email went (false when none was due, or it couldn't be sent).
async function change(env, acct, b, by, { invite = false } = {}) {
  const db = env.DB
  const want = {}
  const ADMIN = { tester: ['none', 'yes', 'declined'], relay: ['none', 'approved', 'declined'], status: STATUS }
  for (const [k, allowed] of Object.entries(ADMIN)) {
    if (b[k] == null) continue
    if (!allowed.includes(b[k])) refuse(400, 'invalid', `${k} is one of: ${allowed.join(', ')}.`)
    if (b[k] !== acct[k]) want[k] = b[k]
  }
  const note = String(b.note ?? '').trim().slice(0, 500)
  if (want.status && !note) refuse(400, 'note', want.status === 'suspended' ? 'Say why it\'s suspended (a note): it goes in the account\'s history.' : 'Say why it\'s restored (a note): it goes in the account\'s history.')
  if (want.relay === 'approved') {
    const max = relayMax(env)
    const n = (await db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE relay = \'approved\' AND status = \'active\' AND id != ?').bind(acct.id).first())?.n || 0
    if (n >= max) refuse(409, 'full', `Bridge AI's relay is full: ${n} accounts may use it, as many as it takes (MAX_ACCOUNTS). Raise it in relay/wrangler.hosted.toml and RELAY_MAX_ACCOUNTS in account/wrangler.toml, deploy both, or decline this one.`)
  }
  const now = Date.now()
  const done = { tester: { yes: 'approved', declined: 'declined' }, relay: { approved: 'approved', declined: 'declined' } }
  if (Object.keys(want).length || note) {
    await db.batch([
      ...Object.entries(want).map(([k, v]) => db.prepare(`UPDATE accounts SET ${k} = ? WHERE id = ?`).bind(v, acct.id)),
      ...Object.entries(want).map(([k, v]) => noted(db, acct.id, by, `${k}: ${acct[k]} → ${v}`, note)),
      ...(!Object.keys(want).length ? [noted(db, acct.id, by, 'note', note)] : []),
      ...['tester', 'relay'].filter((k) => done[k][want[k]]).map((k) => db.prepare('UPDATE requests SET state = ?, decided_at = ?, decided_by = ? WHERE account = ? AND kind = ? AND state = \'open\'')
        .bind(done[k][want[k]], now, by, acct.id, k === 'tester' ? 'early' : 'relay')),
    ])
  }
  const after = { ...acct, ...want }
  const gave = [want.tester === 'yes' && 'early', want.relay === 'approved' && 'relay'].filter(Boolean)
  let emailed = false
  if (gave.length) {
    const [subject, text] = invite
      ? ['An invitation from Bold Bridge', `You're invited to ${gave.map((k) => WHAT[k]).join(' and ')}, for Bridge AI.\n\nTo start, open Bridge AI on your computer, go to Settings › Account and sign in with this email address (${acct.email}). There's no password: Bold Bridge emails you a code.\n\nNo Bridge AI yet? It's at https://boldbridge.ai\n\nBold Bridge`]
      : gave.includes('early') && gave.includes('relay') ? ['Early Access and Bridge AI\'s relay are on for your account', `Early Access and Bridge AI's relay are on for your Bold Bridge account (${acct.email}).\n\n${EARLY_ON}\n\n${RELAY_ON}\n\nBold Bridge`]
        : gave.includes('early') ? ['Early Access is on for your Bold Bridge account', `Early Access is on for your Bold Bridge account (${acct.email}).\n\n${EARLY_ON}\n\nBold Bridge`]
          : ['Bridge AI\'s relay is on for your account', `Bridge AI's relay is on for your Bold Bridge account (${acct.email}).\n\n${RELAY_ON}\n\nBold Bridge`]
    try { await mail(env, acct.email, subject, text); emailed = true } catch { await noted(db, acct.id, 'service', `the email (${subject}) couldn't be sent`).run() }
  }
  return { account: accountView(after), emailed }
}
const EARLY_ON = 'Bridge AI on your computers picks it up by itself within a few hours, or straight away when you open Settings › Account: from then on they get new versions before everyone else. To leave, open Settings › About & Updates.'
const RELAY_ON = 'In Bridge AI on your computer, open Settings › Devices, pick Bridge AI\'s relay, then pair your phone.'

// For the relay: whether an account may use it ('gone': there's no such account any more), and with
// d, whether that device is still on it (device: false once it's removed or signed out, so the relay
// lets it go then, not when its relay token ends).
async function statusOf(db, a, d = null) {
  const acct = ID.test(String(a)) ? await byId(db, a) : null
  if (!acct) return { status: 'gone' }
  const out = { status: acct.status, relay: acct.relay, tester: acct.tester }
  if (d != null) out.device = ID.test(String(d)) && !!(await db.prepare('SELECT id FROM devices WHERE id = ? AND account = ?').bind(String(d), acct.id).first())
  return out
}
// The relay's report of an account's use: { a, window: { messages, resetsAt }, week, days: { day:
// messages }, limits }, kept for GET /v1/me and the admin view. Answered with the account's status,
// so the relay hears of a suspension then too.
async function usage(db, r) {
  const a = String(r?.a || '')
  const st = await statusOf(db, a)
  if (st.status === 'gone') return st
  const part = (w) => ({ messages: Math.max(0, Number(w?.messages) || 0), resetsAt: w?.resetsAt && Date.parse(w.resetsAt) ? iso(Date.parse(w.resetsAt)) : null })
  const now = Date.now()
  const used = { window: part(r.window), week: part(r.week) }
  const days = Object.entries(r?.days && typeof r.days === 'object' ? r.days : {}).filter(([d]) => /^\d{4}-\d\d-\d\d$/.test(d)).slice(0, 7)
  const limits = r?.limits && typeof r.limits === 'object' ? JSON.stringify({ window: r.limits.window, week: r.limits.week }) : null
  const same = limits == null || (await setting(db, 'relayLimits')) === limits
  await db.batch([
    db.prepare('INSERT INTO usage (account, data, at, week, week_end) VALUES (?, ?, ?, ?, ?) ON CONFLICT (account) DO UPDATE SET data = excluded.data, at = excluded.at, week = excluded.week, week_end = excluded.week_end')
      .bind(a, JSON.stringify(used), now, used.week.messages, used.week.resetsAt ? Date.parse(used.week.resetsAt) : 0),
    ...days.map(([d, n]) => db.prepare('INSERT INTO usage_days (account, day, messages) VALUES (?, ?, ?) ON CONFLICT (account, day) DO UPDATE SET messages = excluded.messages').bind(a, d, Math.max(0, Number(n) || 0))),
    ...(same ? [] : [db.prepare('INSERT INTO settings (key, value) VALUES (\'relayLimits\', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(limits)]),
  ])
  return st
}

// ---------- The Worker ----------
// The website's form is on boldbridge.ai, another origin: only its request is open to it.
const cors = (env) => ({ 'access-control-allow-origin': env.SITE || 'https://boldbridge.ai', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' })
// Nothing to read here: a browser opening the address goes to what the privacy policy says.
const PRIVACY = 'https://boldbridge.ai/privacy#your-bold-bridge-account-optional'

// A request, from the internet (only /v1, and / to the policy) or through a binding (bound: 'admin',
// /admin and /internal; 'relay', /internal only): refusals answered with their words, anything else
// with a sentence of its own.
async function answer(req, env, bound) {
  const url = new URL(req.url)
  const form = !bound && url.pathname === '/v1/request-public'
  const extra = form ? cors(env) : {}
  try {
    if (form && req.method === 'OPTIONS') return new Response(null, { status: 204, headers: extra })
    if (!bound && url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) return new Response(null, { status: 301, headers: { location: PRIVACY, 'cache-control': 'public, max-age=3600' } })
    const mine = bound === 'relay' ? url.pathname.startsWith('/internal/') : bound ? /^\/(admin|internal)\//.test(url.pathname) : url.pathname.startsWith('/v1/')
    if (!mine) return new Response('Not found\n', { status: 404 })
    await tables(env.DB)
    const r = bound ? await inside(req, env, url) : await v1(req, env, url)
    for (const [k, v] of Object.entries(extra)) r.headers.set(k, v)
    return r
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.message, code: e.code, ...e.more }, e.status, extra)
    return json({ error: 'Something went wrong on Bold Bridge\'s side. Try again in a minute.', code: 'error' }, 500, extra)
  }
}

// What the admin view binds to (services: { binding = "ACCOUNTS", service = "bridge-accounts",
// entrypoint = "Internal" }): /admin and /internal, at any address.
export class Internal extends WorkerEntrypoint {
  fetch(req) { return answer(req, this.env, 'admin') }
}
// What the relay binds to (the same, with entrypoint = "Relay"): /internal only, so the relay, or
// anyone who takes over its Worker, can't reach the admin routes.
export class Relay extends WorkerEntrypoint {
  fetch(req) { return answer(req, this.env, 'relay') }
}

export default {
  fetch: (req, env) => answer(req, env, false),
  // Once a day: codes, grants, the hour's counts and the day's wrong codes that ran out go, and the
  // relay's use by day after 90 days.
  async scheduled(_event, env) {
    const db = env.DB
    await tables(db)
    const now = Date.now()
    await db.batch([
      db.prepare('DELETE FROM codes WHERE expires < ?').bind(now),
      db.prepare('DELETE FROM grants WHERE expires < ?').bind(now),
      db.prepare('DELETE FROM sent WHERE at < ?').bind(now - HOUR),
      db.prepare('DELETE FROM misses WHERE at < ?').bind(now - DAY),
      db.prepare('DELETE FROM usage_days WHERE day < ?').bind(iso(now - KEEP_USE_DAYS * DAY).slice(0, 10)),
      db.prepare('DELETE FROM daily WHERE day < ?').bind(iso(now - 400 * DAY).slice(0, 10)),
    ])
  },
}
