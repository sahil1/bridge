// Share Links: a link you give people outside your own devices, to see a file, a folder (a site,
// read-only), a Studio document (view-only, always its latest) or an agent's running app (usable,
// buttons included), from this computer, through its relay (relay.js), end-to-end encrypted.
//
// The link is the relay's share address (relay/worker.js: never the phone page's), with the share's
// secret in its fragment (#s=…), which browsers never send, so the relay never has it. The page it
// opens (relay/web/share.js) proves it holds the secret, and this computer proves it does too
// (relay/web/link.js, share links), so the relay passes on bytes it can't read. Who may open it is
// asked here, inside that link, never of the relay: anyone with the link (and its password, when it
// has one: 5 wrong tries lock it for 15 minutes), or only the people named, by a 6-digit code sent to
// their email (Bold Bridge's accounts service sends it for a computer signed in to its account: it
// sees that email and the code, never what's shared; without that, your devices get the code to pass
// on). A page let in gets a pass for this tab, kept hashed here, so a reload doesn't ask again.
//
// What a link reaches, and nothing else: one file; inside one folder (no name starting with a dot, no
// link that leads out of it, nothing written); one Studio document, shown as a page made here from
// its latest version; or one app's port, while an agent's terminal still serves it (servers.js
// ownedBy), never Bridge AI's own ports, its cookies and Bridge AI's never passed on. Never /api nor
// anything else of Bridge AI: what a link's page asks for is answered here (answer()), never by this
// server. Everything shown is sandboxed (CSP), at the share's own address.
//
// Kept in ~/.bridge-ai/shares.json (only you can read it): each link, its secret until it ends, a hash
// of its password, who it names, and when it was opened, from where (the country the relay says) and
// by which email. A link that ends (Stop Sharing, or its time) ends its open pages at once and forgets
// its secret, so nothing opens it again; it's listed 30 days more, then forgotten.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { Readable } from 'node:stream'
import { randomBytes, randomInt, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { totalmem } from 'node:os'
import QRCode from 'qrcode'
import { dataFile, ensureDir, writeFileAtomic, DATA, HOME, IS_WIN } from './paths.js'
import { safePath } from './files.js'
import { newShareSecret, shareId } from '../relay/web/link.js'
import { LASTS, LAST_DEFAULT, LIMITS, cleanEmail, isEmail } from '../shared/shares.js'
import { plainName } from '../shared/remote.js'

const FILE = dataFile('shares.json')
// An hour, as links count it (tests make it seconds).
const HOUR = Number(process.env.BRIDGE_TEST_SHARE_HOUR_MS) || 3600000
const KEEP_ENDED = 30 * 24 * 3600000
const MAX_OPENS = 100
const MAX_PASSES = 100
const MAX_BODY = 10 * 1024 * 1024 // what a page sends an app at once
const sha = (s) => createHash('sha256').update(s).digest('base64url')
const now = () => Date.now()

let conf = (() => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d?.shares) ? d : { shares: [] } } catch { return { shares: [] } } })()
const save = () => { ensureDir(path.dirname(FILE)); writeFileAtomic(FILE, JSON.stringify(conf, null, 2), { mode: 0o600 }) }

// What the rest of Bridge AI gives this (index.js): where links open (relay.js shareAt), who shares
// (your name, else this computer's), an app's port checked (isDevPort), the pages open on a link
// ended (endViewers) and counted (viewersOf), your devices told (notify), a code emailed (sendCode,
// account.js), and whether an email can be sent at all (canEmail).
let hooks = {
  shareAt: () => ({ why: 'relay' }), owner: () => '', computer: () => 'This computer', isDevPort: async () => false, ownPorts: () => [],
  endViewers: () => {}, viewersOf: () => 0, notify: () => {}, sendCode: async () => { throw new Error('No email') }, canEmail: () => false, changed: () => {},
}
export const use = (h) => { hooks = { ...hooks, ...h } }

const live = (s) => !s.endedAt && s.ends > now()
const active = () => conf.shares.filter(live)
const byId = (id) => conf.shares.find((s) => s.id === id) || null

// ---------- the list, for you ----------
// What Settings › Sharing and Studio's Shared show: each link (and its QR code) while it works, what
// it shows, who may open it, when it ends, how many have it open, and its last opens.
export async function list() {
  sweep()
  const out = []
  for (const s of [...conf.shares].sort((a, b) => b.createdAt - a.createdAt)) out.push(await view(s))
  return { shares: out, can: can(), limits: LIMITS, email: hooks.canEmail() }
}
async function view(s) {
  const on = live(s)
  const link = on && s.secret ? linkOf(s) : null
  return {
    id: s.id, kind: s.kind, title: s.title, what: s.what || null, who: s.who, emails: s.who === 'people' ? s.emails : [], password: !!s.password,
    createdAt: s.createdAt, ends: s.ends, endedAt: s.endedAt || null, ended: s.endedAt ? s.why || 'stopped' : on ? null : 'expired',
    by: s.by || null, link, qr: link ? await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null,
    open: on ? hooks.viewersOf(s.id) : 0, locked: s.tries?.until > now() ? s.tries.until : null,
    opens: (s.opens || []).slice(-20).reverse(),
  }
}
const linkOf = (s) => `${s.at}/v/${s.id}#s=${s.secret}${hooks.owner() ? `&n=${encodeURIComponent(hooks.owner())}` : ''}`

// Whether a link can be made here now, and why not.
export function can() {
  const at = hooks.shareAt()
  if (at.why === 'relay') return { ok: false, why: 'relay', text: 'Share Links go through a relay. Set one up in Settings › Devices first.' }
  if (at.why === 'hosted') return { ok: false, why: 'hosted', text: 'Bridge AI\'s relay doesn\'t open Share Links yet: links work there once it\'s updated. A relay on your own Cloudflare account opens them now (Settings › Devices).' }
  if (at.why === 'update') return { ok: false, why: 'update', text: `Your relay needs updating for Share Links: Update relay, in Settings › Devices.${at.error ? ` (Last try: ${at.error})` : ''}` }
  if (active().length >= LIMITS.shares) return { ok: false, why: 'full', text: `${LIMITS.shares} links are shared at once already. Stop one first.` }
  return { ok: true }
}

// ---------- making one ----------
// o: { kind, real (the file or folder, its real path), title, port, pane, folder (an app's), who:
// 'link' | 'people', password, emails, lasts: 'hour' | 'day' | 'week', by (the device it was made on) }.
export async function create(o) {
  sweep()
  const c = can()
  if (!c.ok) throw Object.assign(new Error(c.text), { status: 409, code: c.why })
  const kind = ['file', 'folder', 'doc', 'app'].includes(o.kind) ? o.kind : null
  if (!kind) throw bad('Share a file, a folder, a Studio document or an app')
  const lasts = LASTS.find((l) => l.id === (o.lasts || LAST_DEFAULT))
  if (!lasts) throw bad('A link lasts an hour, a day or a week')
  const who = o.who === 'people' ? 'people' : 'link'
  let emails = []
  if (who === 'people') {
    emails = [...new Set((Array.isArray(o.emails) ? o.emails : String(o.emails || '').split(/[\s,;]+/)).map(cleanEmail).filter(Boolean))]
    const wrong = emails.filter((e) => !isEmail(e))
    if (wrong.length) throw bad(`${wrong[0]} isn't an email address`)
    if (!emails.length) throw bad('Name at least one person, by their email')
    if (emails.length > LIMITS.people) throw bad(`A link names ${LIMITS.people} people at most`)
  }
  const pw = who === 'link' && typeof o.password === 'string' && o.password ? o.password : null
  if (pw && (pw.length < LIMITS.password.min || pw.length > 200)) throw bad(`A password needs at least ${LIMITS.password.min} characters`)
  let target
  let title
  if (kind === 'app') {
    const port = Number(o.port)
    if (!(port > 1023 && port < 65536) || hooks.ownPorts().includes(port) || !(await hooks.isDevPort(port))) throw Object.assign(new Error(`Port ${port} isn't an app one of your agents' terminals started, so it can't be shared.`), { status: 403 })
    target = { port, pane: String(o.pane || ''), folder: String(o.folder || '') }
    title = plainName(o.title, 80) || `Port ${port}`
  } else {
    const real = await fsp.realpath(String(o.real || '')).catch(() => null)
    const st = real && await fsp.stat(real).catch(() => null)
    if (!st) throw bad('That isn\'t there any more')
    if (kind === 'folder' ? !st.isDirectory() : !st.isFile()) throw bad(kind === 'folder' ? 'That isn\'t a folder' : 'That isn\'t a file')
    const why = await keptOut(real, kind === 'folder')
    if (why) throw Object.assign(new Error(why), { status: 403 })
    target = { path: real }
    title = plainName(o.title, 80) || path.basename(real) || real
  }
  const at = hooks.shareAt()
  const secret = newShareSecret()
  const s = {
    id: await shareId(secret), secret, at: at.at(), kind, title, what: kind === 'app' ? `Port ${target.port}` : null, target, who, emails,
    password: pw ? await makePassword(pw) : null, createdAt: now(), ends: now() + lasts.hours * HOUR, by: plainName(o.by, 60) || null,
    passes: [], tries: { n: 0, until: 0 }, codes: {}, sent: {}, opens: [],
  }
  conf.shares.push(s)
  save()
  schedule()
  hooks.changed()
  return { share: await view(s), shares: (await list()).shares }
}
const bad = (msg) => Object.assign(new Error(msg), { status: 400 })

// What can't be shared: anything in Bridge AI's own folder or your keys' (or a folder holding one),
// your home folder or a drive itself, or a name starting with a dot (and a folder in one).
async function keptOut(real, folder) {
  const realOf = (p) => fsp.realpath(p).catch(() => path.resolve(p))
  const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)
  const keys = await Promise.all([DATA, ...['.ssh', '.gnupg', path.join('Library', 'Keychains')].map((d) => path.join(HOME, d))].map(realOf))
  const studio = await realOf(path.join(DATA, 'studio', 'files')) // Studio's own folder (decks from meetings) is yours to share
  if (!within(real, studio) && keys.some((k) => within(real, k) || (folder && within(k, real)))) return 'Bridge AI keeps this out of links: it holds keys, or holds a folder that does. Share what\'s in it instead.'
  if (folder && (real === await realOf(HOME) || path.parse(real).root === real)) return 'A whole home folder or drive can\'t be shared. Share a folder in it instead.'
  if (path.basename(real).startsWith('.')) return 'Names starting with a dot are hidden files, and aren\'t shared.'
  return null
}

// ---------- ending ----------
// Stop Sharing: its open pages end at once (told so, sealed), and its secret goes, so nothing opens
// it again.
export async function stop(id, why = 'stopped') {
  const s = byId(id)
  if (!s) throw Object.assign(new Error('No such link'), { status: 404 })
  if (!s.endedAt) end(s, why)
  return list()
}
// An ended link off the list.
export async function forget(id) {
  const s = byId(id)
  if (s && live(s)) end(s, 'stopped')
  conf.shares = conf.shares.filter((x) => x.id !== id)
  save()
  hooks.changed()
  return list()
}
function end(s, why) {
  s.endedAt = now()
  s.why = why
  delete s.secret
  s.passes = []
  s.codes = {}
  const text = why === 'expired' ? 'This link\'s time ran out.' : `${hooks.owner() || 'Whoever shared it'} stopped sharing it.`
  hooks.endViewers(s.id, { title: 'This link has ended', text: `${text} Ask for a new link if you still need it.` })
  stopWatch(s.id)
  save()
  hooks.changed()
}
// Links whose time ran out end (their pages too); those ended long ago are forgotten.
function sweep() {
  let changed = false
  for (const s of conf.shares) if (!s.endedAt && s.ends <= now()) { end(s, 'expired'); changed = true }
  const keep = conf.shares.filter((s) => !s.endedAt || s.endedAt > now() - KEEP_ENDED)
  if (keep.length !== conf.shares.length) { conf.shares = keep; changed = true }
  if (changed) save()
}
let timer = null
function schedule() {
  clearTimeout(timer)
  const next = Math.min(...active().map((s) => s.ends), now() + 3600000)
  timer = setTimeout(() => { sweep(); schedule() }, Math.max(200, Math.min(next - now() + 50, 2 ** 31 - 1)))
  timer.unref?.()
}
export function start() { sweep(); schedule() }

// ---------- the link's page: in ----------
// The relay's connection said it holds this link's secret (the handshake): its secret, for that.
export const secretOf = (id) => { const s = byId(String(id)); return s && live(s) && s.secret ? s.secret : null }
// Room for one more page on it.
export const room = (id) => hooks.viewersOf(id) < LIMITS.viewers

// One page with the link open (relay.js keeps it with its connection): let in yet, and as whom.
export function viewer(id, { country = null } = {}) {
  return { id, passed: false, email: null, country: /^[A-Z]{2}$/.test(String(country || '')) ? country : null, tokens: 200, at: now(), asks: [] }
}

// What each try and open was, for you: when, from roughly where, and which email.
function opened(s, v, what, email = v.email) {
  s.opens = [...(s.opens || []), { at: now(), what, ...(v.country ? { country: v.country } : {}), ...(email ? { email } : {}) }].slice(-MAX_OPENS)
  save()
  hooks.changed()
}
// Let in: the first time anyone is, your devices hear it.
function letIn(s, v) {
  v.passed = true
  opened(s, v, 'opened')
  if (!s.first) {
    s.first = now()
    save()
    const where = countryName(v.country)
    hooks.notify({ kind: 'share', title: `${s.title} was opened`, body: `${v.email || 'Someone with the link'}${where ? ` in ${where}` : ''} opened it. Stop Sharing is in Settings › Sharing.`, url: '/?settings=sharing', tag: `share-${s.id}` })
  }
}
const countryName = (c) => { if (!c) return null; try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) || c } catch { return c } }
function passFor(s) {
  const pass = randomBytes(24).toString('base64url')
  s.passes = [...(s.passes || []), { h: sha(`${s.id} ${pass}`), at: now() }].slice(-MAX_PASSES)
  save()
  return pass
}

// The password: scrypt, salted, as the Remote Access Password is kept (remote.js).
const GB = 2 ** 30
const SCRYPT = totalmem() >= 4 * GB ? { N: 2 ** 17, r: 8, p: 1 } : totalmem() >= 2 * GB ? { N: 2 ** 16, r: 8, p: 2 } : { N: 2 ** 15, r: 8, p: 3 }
const hashOf = (pw, salt, o = SCRYPT) => new Promise((resolve, reject) => scrypt(String(pw).normalize('NFC'), salt, 32, { N: o.N, r: o.r, p: o.p, maxmem: 256 * o.N * o.r + 2 ** 20 }, (e, k) => (e ? reject(e) : resolve(k))))
async function makePassword(pw) { const salt = randomBytes(16); return { ...SCRYPT, salt: salt.toString('base64'), hash: (await hashOf(pw, salt)).toString('base64') } }
async function matches(stored, pw) {
  if (!stored || typeof pw !== 'string' || !pw || pw.length > 1024) return false
  const want = Buffer.from(stored.hash, 'base64')
  const got = await hashOf(pw, Buffer.from(stored.salt, 'base64'), stored).catch(() => null)
  return !!got && got.length === want.length && timingSafeEqual(got, want)
}
// Checked one at a time (scrypt takes memory). Each try is counted before it's checked, so tries at
// once can't get past the limit; at the limit there's no check at all until the lock is over.
let checking = Promise.resolve()
function checkPassword(s, v, pw) {
  const run = checking.then(async () => {
    const t = s.tries || (s.tries = { n: 0, until: 0 })
    if (t.until > now()) return { locked: t.until }
    if (t.until) { t.n = 0; t.until = 0 }
    t.n++
    save()
    if (await matches(s.password, pw)) { t.n = 0; save(); return { ok: true } }
    opened(s, v, 'wrong password')
    if (t.n >= LIMITS.password.tries) {
      t.until = now() + LIMITS.password.lockMinutes * 60000
      save()
      opened(s, v, 'locked')
      hooks.notify({ kind: 'share', title: `${s.title}: wrong password ${LIMITS.password.tries} times`, body: `It's locked for ${LIMITS.password.lockMinutes} minutes. If that wasn't someone you shared it with, Stop Sharing in Settings › Sharing.`, url: '/?settings=sharing', tag: `share-lock-${s.id}` })
      return { locked: t.until, now: true }
    }
    return { wrong: LIMITS.password.tries - t.n }
  })
  checking = run.catch(() => {})
  return run
}

// A code for an email the link names: 6 digits, kept hashed, CODE minutes and tries; perHour an hour
// to one email. Emailed by Bold Bridge's accounts service when this computer is signed in to it;
// otherwise (or when it can't be sent just now) your devices get it, to pass on yourself.
// Sent after the page has its answer, so how long that takes says nothing of whether the link names
// the email.
function sendCode(s, v, email) {
  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  s.codes[email] = { h: sha(`${s.id} ${email} ${code}`), until: now() + LIMITS.code.minutes * 60000, tries: 0 }
  save()
  opened(s, v, 'code asked', email)
  const toOwner = () => hooks.notify({ kind: 'share', title: `${email} asked to open ${s.title}`, body: `Their code is ${code} (for ${LIMITS.code.minutes} minutes). It couldn't be emailed, so pass it on if that's who you shared it with.`, url: '/?settings=sharing', tag: `share-code-${s.id}` })
  setImmediate(() => { if (!hooks.canEmail()) return toOwner(); Promise.resolve().then(() => hooks.sendCode(email, code, s.title)).catch(toOwner) })
}

// ---------- the link's page: what it asks ----------
// The page's own requests (/.share/…), and what's shared (/c/…): a WHATWG Response, never anything
// of this server's. v: the page (viewer()); req: { m, u, h, body }.
export async function answer(v, { m, u, h = [], body = null }) {
  const s = byId(v.id)
  if (!s || !live(s) || !s.secret) return json(410, { error: 'This link has ended.' })
  // A page asking too much at once (a script in a loop): slowed to LIMITS.perSecond, said.
  const t = now()
  v.tokens = Math.min(200, v.tokens + ((t - (v.last || t)) * LIMITS.perSecond) / 1000)
  v.last = t
  if (v.tokens < 1) return json(429, { error: 'Too many requests at once. Slow down a little.' })
  v.tokens--
  // A link with no password and naming no one: the link is all it takes (the handshake proved it).
  if (!v.passed && !s.password && s.who !== 'people') letIn(s, v)
  const url = new URL(String(u || '/'), 'http://share')
  const p = url.pathname
  const method = String(m || 'GET').toUpperCase()
  const said = body ? (() => { try { return JSON.parse(Buffer.from(body).toString('utf8')) } catch { return {} } })() : {}
  if (p === '/.share/about' && method === 'GET') {
    // What it is, only once let in: before, a password or a code is all the page hears is needed.
    const needs = v.passed ? null : s.password ? 'password' : s.who === 'people' ? 'email' : null
    return json(200, needs ? { needs, name: hooks.owner() || hooks.computer() } : { title: s.title, kind: s.kind, name: hooks.owner() || hooks.computer(), needs, ends: s.ends, entry: entryOf(s), live: s.kind === 'doc' })
  }
  if (p === '/.share/pass' && method === 'POST') {
    const h2 = sha(`${s.id} ${String(said.pass || '')}`)
    const ok = (s.passes || []).some((x) => x.h.length === h2.length && timingSafeEqual(Buffer.from(x.h), Buffer.from(h2)))
    if (!ok) return json(403, { error: 'Not let in yet' })
    v.passed = true
    return json(200, { ok: true })
  }
  if (p === '/.share/password' && method === 'POST') {
    if (!s.password) return json(400, { error: 'This link has no password' })
    const r = await checkPassword(s, v, typeof said.password === 'string' ? said.password : '')
    if (r.ok) { letIn(s, v); return json(200, { ok: true, pass: passFor(s) }) }
    if (r.locked) return json(429, { error: `Too many wrong tries, so this link is locked for now. Try again in ${Math.max(1, Math.ceil((r.locked - now()) / 60000))} minutes.` })
    return json(403, { error: `That isn't the password. ${r.wrong === 1 ? '1 more try' : `${r.wrong} more tries`} before it locks for ${LIMITS.password.lockMinutes} minutes.` })
  }
  if (p === '/.share/email' && method === 'POST') {
    if (s.who !== 'people') return json(400, { error: 'This link isn\'t for named people' })
    const email = cleanEmail(said.email)
    if (!isEmail(email)) return json(400, { error: 'That doesn\'t look like an email address.' })
    // Asked too often from this page: said, whichever email.
    v.asks = v.asks.filter((x) => x > now() - 60000)
    if (v.asks.length >= 3) return json(429, { error: 'Wait a minute before asking for another code.' })
    v.asks.push(now())
    // The same answer, and the same limit (LIMITS.code.perHour to one email), whether or not the link
    // names it: the page can't tell who's on the list.
    const sent = (s.sent[email] || []).filter((t) => t > now() - 3600000)
    if (sent.length >= LIMITS.code.perHour) return json(429, { error: 'Too many codes for this email in the last hour. Try again later.' })
    s.sent = Object.fromEntries([...Object.entries(s.sent).filter(([, x]) => x.some((t) => t > now() - 3600000)), [email, [...sent, now()]]].slice(-200))
    const who = hooks.owner() || 'whoever shared it'
    const said2 = `If ${email} is one this was shared with, a code to open it is on its way: by email, or from ${who}. It works for ${LIMITS.code.minutes} minutes.`
    if (s.emails.includes(email)) sendCode(s, v, email)
    else opened(s, v, 'not on the list', email)
    return json(200, { said: said2 })
  }
  if (p === '/.share/code' && method === 'POST') {
    if (s.who !== 'people') return json(400, { error: 'This link isn\'t for named people' })
    const email = cleanEmail(said.email)
    const c = s.codes[email]
    const given = String(said.code || '').replace(/\s+/g, '')
    if (!c || c.until <= now() || c.tries >= LIMITS.code.tries) {
      if (c) { delete s.codes[email]; save() }
      return json(403, { error: 'That code doesn\'t work any more (a code lasts 10 minutes and allows 5 tries). Ask for a new one.' })
    }
    c.tries++
    save()
    const h2 = sha(`${s.id} ${email} ${given}`)
    if (!/^\d{6}$/.test(given) || h2.length !== c.h.length || !timingSafeEqual(Buffer.from(h2), Buffer.from(c.h))) {
      opened(s, v, 'wrong code', email)
      const left = LIMITS.code.tries - c.tries
      return json(403, { error: left > 0 ? `That code isn't right. ${left === 1 ? '1 more try' : `${left} more tries`} with it.` : 'That was the last try with this code. Ask for a new one.' })
    }
    delete s.codes[email]
    v.email = email
    letIn(s, v)
    return json(200, { ok: true, pass: passFor(s) })
  }
  if (p.startsWith('/.share/')) return json(404, { error: 'Not found' })
  if (!v.passed) return page(401, 'Not let in yet: open the link again.')
  if (!p.startsWith('/c/') && p !== '/c') return page(404, 'This isn\'t part of what was shared.')
  const rest = p === '/c' ? '' : p.slice(3)
  try {
    if (s.kind === 'app') return await toApp(s, { method, rest, search: url.search, h, body })
    if (method !== 'GET' && method !== 'HEAD') return page(405, 'What\'s shared here can only be looked at.')
    if (s.kind === 'doc') return await docOf(s, rest, method, h)
    if (s.kind === 'file') return await fileOf(s, rest, method, h)
    return await folderOf(s, rest, method, h)
  } catch (e) {
    return page(e.status || 404, e.status ? e.message : 'That isn\'t there any more.')
  }
}
const entryOf = (s) => (s.kind === 'file' ? encodeURIComponent(path.basename(s.target.path)) : '')
const json = (status, o) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }))

// ---------- what's shared ----------
// Every answer shown in the page's frame: sandboxed (a PDF aside, which a sandbox stops showing),
// framed only by the page's own address, never sniffed as something else, its address kept to the
// page's own (Referrer-Policy), never cached.
const SANDBOX = 'sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads'
// A page made here (a document, a folder's list, why something didn't open): nothing in it runs
// (script-src 'none'), and it loads nothing from anywhere else. (Its sandbox lets scripts as the
// others' does, and script-src stops them: in WebKit, a frame whose page was sandboxed without
// scripts goes past the service worker for the next page it opens.)
const STATIC = "sandbox allow-scripts allow-same-origin allow-popups; default-src 'none'; script-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'; font-src data:; media-src 'self'; form-action 'none'; base-uri 'none'"
function shownHeaders(type, { csp = SANDBOX, more = {} } = {}) {
  return { 'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'cache-control': 'no-store', ...(/^application\/pdf\b/i.test(type) ? {} : { 'content-security-policy': csp }), ...more }
}
function page(status, text) {
  const t = String(text).replace(/[<&>]/g, '')
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:0 16px;text-align:center;color:#666"><p>${t}</p></body>`, { status, headers: shownHeaders('text/html; charset=utf-8', { csp: STATIC }) })
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A path inside what's shared, as the page asked for it: each part decoded once, and none that's
// empty, . or .., has a separator, a colon or a NUL in it, starts with a dot, or (on Windows) is a
// short name (GIT~1) or ends in a dot or a space, which Windows would take as another name.
function partsOf(rest) {
  const raw = String(rest).split('/')
  const parts = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '' && i === raw.length - 1) break // a folder's trailing /
    let x
    try { x = decodeURIComponent(raw[i]) } catch { return null }
    if (!x || x === '.' || x === '..' || x.startsWith('.') || /[\\/:\0]/.test(x)) return null
    if (IS_WIN && (/~\d/.test(x) || /[. ]$/.test(x))) return null
    parts.push(x)
  }
  return parts
}
const notThere = (why = 'That isn\'t part of what was shared.') => Object.assign(new Error(why), { status: 404 })
// The real path of what's asked for, inside root (safePath: links followed, and none out of it, nor
// into Bridge AI's folder or your keys'), and no part of it, as it really is, starting with a dot.
async function inside(root, parts) {
  if (!parts) throw notThere()
  const r = await safePath(root, parts.join('/')).catch(() => { throw notThere() })
  if (r.rel && r.rel.split(/[\\/]/).some((x) => x.startsWith('.'))) throw notThere()
  return r.real
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.xml': 'text/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
}
const typeOf = (f) => TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream'

// A file, as it is: a part of it when asked (Range: a video), nothing written, and not one over
// LIMITS.fileMB (said instead).
async function send(file, method, h) {
  const fh = await fsp.open(file, 'r')
  let handed = false
  try {
    const st = await fh.stat()
    if (!st.isFile()) throw notThere()
    if (st.size > LIMITS.fileMB * 1024 * 1024) return page(413, `${path.basename(file)} is bigger than a link sends (${LIMITS.fileMB / 1024} GB at most).`)
    const type = typeOf(file)
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(h.find(([k]) => String(k).toLowerCase() === 'range')?.[1] || ''))
    let start = 0
    let end = st.size - 1
    if (range && st.size) {
      start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]))
      end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1
      if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${st.size}` } })
    }
    const part = !!range && st.size > 0
    const len = st.size ? end - start + 1 : 0
    const headers = shownHeaders(type, { more: { 'accept-ranges': 'bytes', 'content-length': String(len), ...(part ? { 'content-range': `bytes ${start}-${end}/${st.size}` } : {}) } })
    if (method === 'HEAD' || !len) return new Response(null, { status: part ? 206 : 200, headers })
    const stream = fh.createReadStream({ start, end, highWaterMark: 64 * 1024 })
    handed = true
    return new Response(Readable.toWeb(stream), { status: part ? 206 : 200, headers })
  } finally { if (!handed) await fh.close().catch(() => {}) }
}

async function fileOf(s, rest, method, h) {
  const parts = partsOf(rest)
  const name = path.basename(s.target.path)
  if (!parts || parts.length !== 1 || parts[0] !== name) throw notThere(`Only ${name} is shared here, not what it links to.`)
  const real = await fsp.realpath(s.target.path).catch(() => { throw notThere('It isn\'t there any more.') })
  if (real !== s.target.path) throw notThere('It isn\'t there any more.')
  return send(real, method, h)
}

async function folderOf(s, rest, method, h) {
  const root = s.target.path
  const parts = partsOf(rest)
  const real = await inside(root, parts)
  const st = await fsp.stat(real)
  if (!st.isDirectory()) return send(real, method, h)
  // A folder asked for without its /: there, so its own links work.
  if (rest && !rest.endsWith('/')) return new Response(null, { status: 302, headers: { location: `/_c/${s.id}/${rest}/`, 'cache-control': 'no-store' } })
  const index = path.join(real, 'index.html')
  if (await fsp.stat(index).then((x) => x.isFile(), () => false)) return send(await inside(root, [...parts, 'index.html']), method, h)
  return listing(s, real, parts)
}

// A folder with no index.html: what's in it, as links (names starting with a dot left out).
async function listing(s, real, parts) {
  const all = (await fsp.readdir(real, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'))
  const rows = all.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, LIMITS.listed)
  const name = parts.length ? parts.at(-1) : s.title
  const items = rows.map((e) => `<li><a href="${esc(encodeURIComponent(e.name))}${e.isDirectory() ? '/' : ''}">${esc(e.name)}${e.isDirectory() ? '/' : ''}</a></li>`).join('')
  const more = all.length > rows.length ? `<p class="m">And ${all.length - rows.length} more, not listed.</p>` : ''
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title><style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0 auto;max-width:760px;padding:20px 16px;color:#15171c;background:#fff}h1{font-size:18px;margin:0 0 12px;overflow-wrap:anywhere}ul{list-style:none;padding:0;margin:0}li{border-bottom:1px solid #eee}a{display:block;padding:9px 4px;color:#1d4ed8;text-decoration:none;overflow-wrap:anywhere}a:hover{background:#f5f7fb}.m{color:#666}@media (prefers-color-scheme:dark){body{background:#0f1115;color:#e6e8ec}li{border-color:#262a33}a{color:#93b4ff}a:hover{background:#171a21}}</style></head><body><h1>${esc(name)}</h1>${parts.length ? '<p><a href="../">← Up</a></p>' : ''}<ul>${items || '<li class="m">Nothing here.</li>'}</ul>${more}</body></html>`
  return new Response(html, { status: 200, headers: shownHeaders('text/html; charset=utf-8', { csp: STATIC }) })
}

// ---------- a Studio document: its latest, as a page ----------
// Made here from the file as it is now (a Word document, a Markdown one or a deck, a sheet, a
// PowerPoint deck's words), with nothing in it that runs; a PDF or a page goes as it is. The page
// shows it again whenever the file changes (live()).
const DOC_CSS = 'body{font:16px/1.6 -apple-system,system-ui,"Segoe UI",sans-serif;margin:0 auto;max-width:820px;padding:28px 20px 60px;color:#15171c;background:#fff}img{max-width:100%;height:auto}table{border-collapse:collapse;margin:12px 0;font-size:14px}td,th{border:1px solid #d5d9e0;padding:4px 8px;vertical-align:top}th{background:#f3f4f6}pre{white-space:pre-wrap;background:#f6f7f9;padding:12px;border-radius:8px}h1,h2,h3{line-height:1.25}.slide{border:1px solid #d5d9e0;border-radius:10px;padding:18px 22px;margin:0 0 18px;background:#fff}.slide h2{margin-top:0}.notes{color:#5d6470;font-size:14px;border-top:1px dashed #d5d9e0;margin-top:12px;padding-top:8px}.sheet-name{margin-top:28px}.m{color:#5d6470}@media (prefers-color-scheme:dark){body,.slide{background:#0f1115;color:#e6e8ec}th{background:#1a1d24}td,th,.slide{border-color:#2c313b}pre{background:#171a21}}'
async function docOf(s, rest, method, h) {
  if (rest) throw notThere('Only the document itself is shared here.')
  const file = s.target.path
  const real = await fsp.realpath(file).catch(() => { throw notThere('It isn\'t there any more.') })
  if (real !== file) throw notThere('It isn\'t there any more.')
  const ext = path.extname(file).toLowerCase()
  if (ext === '.pdf' || ext === '.html' || ext === '.htm') return send(real, method, h)
  const st = await fsp.stat(real)
  if (st.size > 80 * 1024 * 1024) return page(413, 'This document is too big to show here.')
  const body = await rendered(real, ext, st)
  served.set(s.id, `${st.size}:${st.mtimeMs}`)
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.title)}</title><style>${DOC_CSS}${body.css || ''}</style></head><body>${body.html}</body></html>`
  return new Response(method === 'HEAD' ? null : html, { status: 200, headers: shownHeaders('text/html; charset=utf-8', { csp: STATIC }) })
}
const made = new Map() // file -> { key, out }: the last page made of it, until it changes
const served = new Map() // share id -> the version of its document last shown
async function rendered(file, ext, st) {
  const key = `${st.size}:${st.mtimeMs}`
  const had = made.get(file)
  if (had?.key === key) return had.out
  let out
  const text = () => fsp.readFile(file, 'utf8')
  if (ext === '.md' || ext === '.markdown') {
    const md = await text()
    if (/^---\s*\n[\s\S]*?\bmarp:\s*true\b[\s\S]*?\n---/.test(md)) {
      const { Marp } = await import('@marp-team/marp-core')
      const r = new Marp({ html: false, script: false }).render(md)
      out = { html: r.html, css: `${r.css}body{max-width:980px}.marpit>svg{display:block;margin:0 0 18px;border:1px solid #d5d9e0;border-radius:8px}` }
    // (A <meta> in it, which could send the frame elsewhere, is left out: the CSP stops the rest.)
    } else out = { html: (await import('marked')).marked.parse(md, { async: false }).replace(/<meta\b[^>]*>/gi, '') }
  } else if (ext === '.txt') out = { html: `<pre>${esc(await text())}</pre>` }
  else if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default
    out = { html: (await mammoth.convertToHtml({ path: file })).value }
  } else if (['.xlsx', '.xlsm', '.csv', '.tsv'].includes(ext)) {
    const { sheet } = await import('./office.js')
    const { sheets } = await sheet(file)
    out = { html: sheets.map((x) => `${sheets.length > 1 ? `<h2 class="sheet-name">${esc(x.name)}</h2>` : ''}<table>${x.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</table>${x.truncated ? '<p class="m">Only the first rows and columns are shown.</p>' : ''}`).join('') }
  } else if (ext === '.pptx') {
    const { outline } = await import('./office.js')
    const o = await outline(file)
    out = { html: o.sections.map((x, i) => `<section class="slide"><h2>${esc(x.title || `Slide ${i + 1}`)}</h2>${x.blocks.map((b) => `<p>${esc(b.text)}</p>`).join('')}${x.notes ? `<div class="notes">${esc(x.notes)}</div>` : ''}</section>`).join('') || '<p class="m">No words in this deck.</p>' }
  } else out = { html: '<p class="m">This kind of document can\'t be shown here.</p>' }
  made.set(file, { key, out })
  if (made.size > 20) made.delete(made.keys().next().value)
  return out
}

// A document's page asks to hear when it changes (/.share/live, a socket over the link): the file
// looked at every 2 seconds while any page listens, and each told when it isn't the version last
// shown (a change just before it asked counts too).
const watches = new Map() // share id -> { timer, key, socks: Set }
export function socket(v, u, sock) {
  const s = byId(v.id)
  if (!s || !live(s) || !v.passed || s.kind !== 'doc' || new URL(String(u || '/'), 'http://share').pathname !== '/.share/live') return sock.close(1008, s?.kind === 'app' ? 'A shared app\'s live connections aren\'t carried' : 'Not found')
  let w = watches.get(s.id)
  if (!w) {
    w = { socks: new Set(), key: served.get(s.id) || null }
    const look = async () => {
      const st = await fsp.stat(s.target.path).catch(() => null)
      const key = st ? `${st.size}:${st.mtimeMs}` : 'gone'
      if (w.key && key !== w.key) for (const x of w.socks) x.send(JSON.stringify({ changed: now() }))
      w.key = key
    }
    look()
    w.timer = setInterval(look, 2000)
    w.timer.unref?.()
    watches.set(s.id, w)
  }
  w.socks.add(sock)
  sock.opened()
  return { close: () => { w.socks.delete(sock); if (!w.socks.size) stopWatch(s.id) } }
}
function stopWatch(id) { const w = watches.get(id); if (w) { clearInterval(w.timer); watches.delete(id) } }

// ---------- an agent's app ----------
// Its port on this computer, while an agent's terminal still serves it, as the Preview tab shows it:
// what the page sends (no cookies, no Authorization, nothing of Bridge AI's), and its answer with its
// cookies and anything that would reach past itself taken out, sandboxed, and a redirect to itself
// kept under the link.
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'host', 'content-length', 'accept-encoding', 'cookie', 'authorization', 'origin', 'referer'])
const AWAY = new Set(['set-cookie', 'clear-site-data', 'service-worker-allowed', 'content-length', 'strict-transport-security', 'alt-svc'])
const NO_BODY = new Set([204, 205, 304])
async function toApp(s, { method, rest, search, h, body }) {
  const port = s.target.port
  if (hooks.ownPorts().includes(port) || !(await hooks.isDevPort(port))) return page(503, 'The app isn\'t running from an agent\'s terminal any more, so it can\'t be shown. Ask whoever shared it to start it again.')
  if (body && body.byteLength > MAX_BODY) return page(413, 'That\'s more than a shared app takes at once (10 MB).')
  const headers = {}
  for (const [k0, v] of h) {
    const k = String(k0).toLowerCase()
    if (HOP.has(k) || k.startsWith('x-bridge-') || k.startsWith('sec-') || k.startsWith('proxy-')) continue
    headers[k] = String(v)
  }
  headers.host = `localhost:${port}`
  headers['accept-encoding'] = 'identity'
  const target = `/${rest}${search || ''}`
  return new Promise((resolve) => {
    const up = http.request({ host: 'localhost', port, method, path: target, headers, autoSelectFamily: true, timeout: 60000 }, (r) => {
      const out = new Headers()
      for (const [k, v] of Object.entries(r.headers)) {
        if (HOP.has(k) || AWAY.has(k)) continue
        if (k === 'location') { out.set(k, where(String(v), s)); continue }
        if (k === 'content-security-policy') continue // put again below, after the sandbox
        for (const x of [].concat(v)) { try { out.append(k, x) } catch { /* not a header */ } }
      }
      out.set('content-security-policy', SANDBOX)
      for (const x of [].concat(r.headers['content-security-policy'] || [])) out.append('content-security-policy', x)
      out.set('x-content-type-options', 'nosniff')
      out.set('referrer-policy', 'same-origin')
      const empty = NO_BODY.has(r.statusCode) || method === 'HEAD'
      if (empty) r.resume()
      resolve(new Response(empty ? null : Readable.toWeb(r), { status: r.statusCode < 200 ? 502 : r.statusCode, headers: out }))
    })
    up.on('error', (e) => resolve(page(502, `Nothing answered on the app's port (${e.code || e.message}). Is it still running?`)))
    up.on('timeout', () => up.destroy(new Error('it took too long')))
    up.end(body ? Buffer.from(body) : undefined)
  })
}
// A redirect to the app itself stays under the link; anywhere else, as it is.
function where(loc, s) {
  let u
  try { u = new URL(loc, `http://localhost:${s.target.port}/`) } catch { return loc }
  const own = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && Number(u.port || 80) === s.target.port
  if (!own && /^[a-z]+:/i.test(loc)) return loc
  return `/_c/${s.id}${u.pathname}${u.search}${u.hash}`
}

start()
