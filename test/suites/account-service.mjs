// Bold Bridge's accounts service (account/worker.js, account/API.md), run in Node with SQLite for D1
// and a mailbox for the Email Service, signed with a key made here, so nothing reaches Cloudflare.
// Where it is (accounts.boldbridge.ai, its logs off, a browser sent to the policy). Codes: a code
// emailed, wrong ones counted down to the fifth (then it's done), one that ran out after 10 minutes,
// a new one replacing the last, 5 an hour for an email and 20 for a network (IPv4 /24, IPv6 /48) with
// when to try again, throwaway domains refused naming the domain, an email that couldn't be sent
// said and not counted. Signing in: one account per email (case and spaces aside), a device token
// that checks out with the public key, ends at its end, is renewed past half its life (the old one
// working until the new one's used), and ends at once when signed out or removed. Five devices: the
// sixth refused with the list, and the same code removing one to make room. Grants: one-time, 5
// minutes, the same limit. Requests, from Bridge AI and from the website (confirmed by a code, its
// network limited, CORS for the site only), noted for the admins. The admin routes only through the
// binding (a 404 on the internet), each needing who's asking and writing it to the history: stats,
// requests, accounts (searched, filtered, sorted by use), one account, approving (the person emailed,
// requests closed, emailed false when it couldn't go), the relay full at RELAY_MAX_ACCOUNTS (409),
// suspending and restoring only with a note, inviting, removing a device. The relay's tokens and the
// Early Access code (read by server/earlyaccess.js with the public key, for the account's id), each
// given only while allowed; suspension stopping everything; the relay's status and usage reports.
// Deleting the account (its email typed again) leaves nothing of it. Nothing kept is an IP address
// or a code. And the one switch: server/account.js's ACCOUNTS_URL set only with PRIVACY.md and
// TERMS.md saying what an account keeps and how to delete it; README.md's drafts quote the policy as
// it is and, pasted in, pass.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { d1, mailbox } from '../lib/workers.mjs'
import { ROOT, checks } from '../lib/harness.mjs'

const { ok, done } = checks('account-service')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')
const worker = await import('../../account/worker.js')
const earlyAccess = await import('../../server/earlyaccess.js')

// The clock, moved on in the test (the Worker reads Date.now).
const realNow = Date.now
let shift = 0
Date.now = () => realNow() + shift
const MIN = 60000
const DAY = 864e5

const { privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC = privateKey.export({ format: 'jwk' }).x
const service = (more = {}) => {
  const mail = mailbox()
  const env = { DB: d1(), EMAIL: mail, FROM: 'accounts@example.com', ADMINS: 'admins@example.com', SITE: 'https://boldbridge.example', RELAY_MAX_ACCOUNTS: '500', SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), ...more }
  const internal = new worker.Internal({}, env)
  const relayBound = new worker.Relay({}, env)
  // A request from the internet (from ip), or through the admin view's binding (bound), as it makes
  // it, or the relay's (relay).
  const call = async (p, { method = 'GET', body, token, ip = '203.0.113.7', bound = false, relay = false, admin = 'admin@example.com', headers = {} } = {}) => {
    const req = new Request(`https://accounts.boldbridge.ai${p}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...(bound && admin ? { 'X-Admin-Email': admin } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined })
    const r = relay ? await relayBound.fetch(req) : bound ? await internal.fetch(req) : await worker.default.fetch(req, env)
    return { status: r.status, headers: r.headers, j: await r.clone().json().catch(() => null), text: await r.text() }
  }
  const codeFor = (email) => /\b(\d{6})\b/.exec(mail.sent.filter((m) => m.to === email).at(-1)?.text || '')?.[1]
  const device = (name, kind = 'computer') => ({ name, kind, platform: kind === 'phone' ? 'ios' : 'mac' })
  // Signed in, with a new code: { account, device, deviceToken }.
  const signIn = async (email, name = 'Studio', kind = 'computer', ip) => {
    await call('/v1/code', { method: 'POST', body: { email }, ip })
    return (await call('/v1/verify', { method: 'POST', body: { email, code: codeFor(email.trim().toLowerCase()), device: device(name, kind) }, ip })).j
  }
  const rows = (table) => env.DB.sql.prepare(`SELECT * FROM ${table}`).all().map((r) => ({ ...r }))
  return { env, mail, call, codeFor, device, signIn, rows }
}
const payload = (t) => JSON.parse(Buffer.from(String(t).split('.')[0], 'base64url').toString('utf8'))
const verifies = (t) => { const [p, s] = String(t).split('.'); return crypto.verify(null, Buffer.from(p), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: PUBLIC }, format: 'jwk' }), Buffer.from(s, 'base64url')) }

try {
  // ---------- Where it is ----------
  {
    const toml = read('account', 'wrangler.toml')
    ok(/pattern = "accounts\.boldbridge\.ai", custom_domain = true/.test(toml) && /workers_dev = false/.test(toml) && /preview_urls = false/.test(toml) && /\[observability\]\nenabled = false/.test(toml), 'wrangler.toml: accounts.boldbridge.ai only (no workers.dev, no previews), with the Worker\'s logs off')
    ok(/binding = "DB"/.test(toml) && /\[\[send_email\]\]\nname = "EMAIL"/.test(toml) && /crons = /.test(toml) && /^RELAY_MAX_ACCOUNTS = "500"/m.test(toml), 'its database, Email Service, the daily clean-up and RELAY_MAX_ACCOUNTS')
    ok(/binding = "ACCOUNTS"\nservice = "bridge-accounts"\nentrypoint = "Relay"/.test(read('relay', 'wrangler.hosted.toml')), 'the relay binds to its Relay entrypoint, not the admin view\'s')
    const s = service()
    const page = await s.call('/')
    ok(page.status === 301 && /boldbridge\.ai\/privacy#your-bold-bridge-account-optional/.test(page.headers.get('location')), 'its own address shows nothing: a browser goes to the privacy policy', page.headers.get('location'))
    const admin = await s.call('/admin/stats', { headers: { 'X-Admin-Email': 'admin@example.com' } })
    const internal = await s.call('/internal/status?a=aaaaaaaaaaaa')
    ok(admin.status === 404 && internal.status === 404, 'the admin view\'s and the relay\'s routes aren\'t on the internet, whatever a request says', [admin.status, internal.status])
    ok((await s.call('/v1/me', { bound: true })).status === 404, 'and the binding has only those')
    const viaRelay = await Promise.all(['/internal/status?a=aaaaaaaaaaaa', '/admin/stats', '/admin/accounts', '/v1/me'].map((p) => s.call(p, { relay: true, headers: { 'X-Admin-Email': 'admin@example.com' } })))
    ok(viaRelay[0].status === 200 && viaRelay[0].j.status === 'gone' && viaRelay.slice(1).every((x) => x.status === 404), 'the relay\'s binding reaches /internal and nothing else: no admin route, whatever it says', viaRelay.map((x) => x.status))
  }

  // ---------- Codes ----------
  {
    const s = service()
    const bad = await s.call('/v1/code', { method: 'POST', body: { email: 'not an email' } })
    ok(bad.status === 400 && bad.j.code === 'invalid' && /doesn't look like an email/.test(bad.j.error), 'not an email: refused, saying so', bad.j)
    const toss = await s.call('/v1/code', { method: 'POST', body: { email: 'sam@mailinator.com' } }) // private-ok: a made-up address at a throwaway domain
    const sub = await s.call('/v1/code', { method: 'POST', body: { email: 'sam@x.yopmail.com' } }) // private-ok: a made-up address at a throwaway domain
    ok(toss.j.code === 'throwaway' && /mailinator\.com/.test(toss.j.error) && sub.j.code === 'throwaway', 'a throwaway domain (or a name under one) is refused, naming it and why', toss.j)
    ok(!s.mail.sent.length, 'and nothing is sent for either')
    const sent = await s.call('/v1/code', { method: 'POST', body: { email: ' Sam@Example.COM ' } })
    const m = s.mail.sent.at(-1)
    ok(sent.status === 200 && sent.j.sent === true && m?.to === 'sam@example.com' && /^\d{6} is your Bold Bridge code$/.test(m.subject) && /works for 10 minutes/.test(m.text) && m.from.email === 'accounts@example.com', 'a code is emailed, to the email lowercased and trimmed, from FROM', m)
    const kept = s.rows('codes')
    ok(kept.length === 1 && !JSON.stringify(kept).includes(s.codeFor('sam@example.com')), 'kept as a hash, never the code', kept)
    const dev = s.device('Studio')
    let r = null
    for (let i = 4; i >= 1; i--) {
      r = await s.call('/v1/verify', { method: 'POST', body: { email: 'sam@example.com', code: '000000', device: dev } })
      if (!(r.status === 400 && r.j.code === 'wrong' && r.j.triesLeft === i)) break
    }
    ok(r.j.code === 'wrong' && r.j.triesLeft === 1 && /1 more try/.test(r.j.error), 'a wrong code: refused, with the tries left (4, 3, 2, 1)', r.j)
    r = await s.call('/v1/verify', { method: 'POST', body: { email: 'sam@example.com', code: '000000', device: dev } })
    const right = await s.call('/v1/verify', { method: 'POST', body: { email: 'sam@example.com', code: s.codeFor('sam@example.com'), device: dev } })
    ok(r.j.code === 'expired' && /fifth wrong try/.test(r.j.error) && right.j.code === 'expired', 'the fifth wrong try ends it, saying so: even the right code is too late then', [r.j, right.j])
    // Guesses sent all at once (from many networks): five are checked at most, however they
    // interleave, and the right one sent after them is too late.
    const race = service()
    await race.call('/v1/code', { method: 'POST', body: { email: 'race@example.com' } })
    const real = race.codeFor('race@example.com')
    const guesses = Array.from({ length: 60 }, (_, i) => String((Number(real) + 1 + i) % 1e6).padStart(6, '0'))
    const burst = await Promise.all([...guesses, real].map((g, i) => race.call('/v1/verify', { method: 'POST', body: { email: 'race@example.com', code: g, device: dev }, ip: `198.51.${i}.9` })))
    const checked = burst.filter((x) => x.j?.code === 'wrong' || /fifth wrong try/.test(x.j?.error || '')).length
    ok(checked <= 5 && !burst.some((x) => x.j?.deviceToken) && !race.rows('devices').length, '61 guesses at one code at once: 5 checked at most, the rest refused, and the right one, sent last, doesn\'t sign in', { checked, codes: [...new Set(burst.map((x) => x.j?.code))] })
    // The right code twice at once: one sign-in.
    await race.call('/v1/code', { method: 'POST', body: { email: 'twice@example.com' } })
    const once = race.codeFor('twice@example.com')
    const both = await Promise.all(['Studio', 'Desk'].map((n) => race.call('/v1/verify', { method: 'POST', body: { email: 'twice@example.com', code: once, device: race.device(n) } })))
    ok(both.filter((x) => x.j?.deviceToken).length === 1 && both.some((x) => x.j?.code === 'expired') && race.rows('devices').length === 1, 'the right code sent twice at once signs in once: the other is told it\'s no good now', both.map((x) => x.j?.code || x.status))
    // 20 wrong codes for an email in a day: no more codes for it for a day.
    const wrongOf = (c) => String((Number(c) + 1) % 1e6).padStart(6, '0')
    const g = service()
    let last = null
    for (let c = 0; c < 4; c++) {
      await g.call('/v1/code', { method: 'POST', body: { email: 'guess@example.com' } })
      for (let i = 0; i < 5; i++) last = await g.call('/v1/verify', { method: 'POST', body: { email: 'guess@example.com', code: wrongOf(g.codeFor('guess@example.com')), device: dev } })
    }
    ok(last.status === 429 && last.j.code === 'stopped' && /20 wrong codes for this email today/.test(last.j.error) && last.j.retryAfter > 86000 && /24 hours/.test(last.j.error), 'the 20th wrong code for an email in a day: said, with when it may have codes again (a day)', last.j)
    const mailed = g.mail.sent.length
    const asked = await g.call('/v1/code', { method: 'POST', body: { email: 'guess@example.com' } })
    ok(asked.status === 429 && asked.j.code === 'stopped' && asked.j.retryAfter > 86000 && g.mail.sent.length === mailed && !g.rows('codes').length, 'then no code goes to it, saying until when, and none is waiting', asked.j)
    ok(!JSON.stringify(g.rows('misses')).includes('guess@'), 'what\'s kept for it is a hash of the email', g.rows('misses').slice(0, 2))
    shift += DAY + MIN
    ok((await g.call('/v1/code', { method: 'POST', body: { email: 'guess@example.com' } })).status === 200, 'a day on, it has codes again')
    await worker.default.scheduled({}, g.env)
    ok(!g.rows('misses').length, 'and the daily clean-up takes what ran out')
    shift = 0
    await s.call('/v1/code', { method: 'POST', body: { email: 'sam@example.com' } })
    const first = s.codeFor('sam@example.com')
    await s.call('/v1/code', { method: 'POST', body: { email: 'sam@example.com' } })
    r = await s.call('/v1/verify', { method: 'POST', body: { email: 'sam@example.com', code: first === s.codeFor('sam@example.com') ? '999999' : first, device: dev } })
    ok(r.j.code === 'wrong', 'a new code replaces the last', r.j)
    shift += 11 * MIN
    r = await s.call('/v1/verify', { method: 'POST', body: { email: 'sam@example.com', code: s.codeFor('sam@example.com'), device: dev } })
    ok(r.j.code === 'expired' && /lasts 10 minutes/.test(r.j.error), 'after 10 minutes it has run out, saying how long a code lasts', r.j)
    const none = await s.call('/v1/verify', { method: 'POST', body: { email: 'nobody@example.com', code: '123456', device: dev } })
    ok(none.j.code === 'expired' && /no code waiting/.test(none.j.error), 'no code asked for: said so', none.j)
    // 5 an hour for an email (4 sent so far, all within the hour).
    shift = 0
    const t = service()
    for (let i = 0; i < 5; i++) await t.call('/v1/code', { method: 'POST', body: { email: 'max@example.com' } })
    const sixth = await t.call('/v1/code', { method: 'POST', body: { email: 'max@example.com' } })
    ok(sixth.status === 429 && sixth.j.code === 'too-many' && /for this email/.test(sixth.j.error) && sixth.j.retryAfter > 3500 && sixth.j.retryAfter <= 3600 && /60 minutes/.test(sixth.j.error), 'the sixth code for an email in an hour: refused, with when to try again (retryAfter, in seconds)', sixth.j)
    shift += 61 * MIN
    ok((await t.call('/v1/code', { method: 'POST', body: { email: 'max@example.com' } })).status === 200, 'and an hour on, it goes')
    shift = 0
    // 20 an hour for a network: an IPv4 /24, an IPv6 /48.
    const n = service()
    for (let i = 0; i < 20; i++) await n.call('/v1/code', { method: 'POST', body: { email: `p${i}@example.com` }, ip: `198.51.100.${i + 1}` })
    const net = await n.call('/v1/code', { method: 'POST', body: { email: 'q@example.com' }, ip: '198.51.100.200' })
    const other = await n.call('/v1/code', { method: 'POST', body: { email: 'q@example.com' }, ip: '198.51.101.1' })
    ok(net.j?.code === 'too-many' && /this network/.test(net.j.error) && other.status === 200, 'the 21st from one /24 in an hour is refused, saying it\'s the network; the next /24 is another', net.j)
    for (let i = 0; i < 20; i++) await n.call('/v1/code', { method: 'POST', body: { email: `v${i}@example.com` }, ip: `2001:db8:1:${i.toString(16)}::5` })
    const v6 = await n.call('/v1/code', { method: 'POST', body: { email: 'w@example.com' }, ip: '2001:db8:1:ffff::9' })
    const v6b = await n.call('/v1/code', { method: 'POST', body: { email: 'w@example.com' }, ip: '2001:db8:2::9' })
    ok(v6.j?.code === 'too-many' && v6b.status === 200, 'and for IPv6, a /48', [v6.j, v6b.status])
    // An email that can't be sent: said, and not counted.
    const f = service()
    f.mail.fail('E_SENDER_NOT_VERIFIED')
    const unsent = await f.call('/v1/code', { method: 'POST', body: { email: 'sam@example.com' } })
    ok(unsent.status === 502 && unsent.j.code === 'unsent' && /couldn't be sent/.test(unsent.j.error) && !f.rows('codes').length && !f.rows('sent').length, 'an email that couldn\'t be sent is said, with no code kept and nothing counted against the limits', unsent.j)
    const kept2 = JSON.stringify([...n.rows('sent'), ...n.rows('codes')])
    ok(!/198\.51|2001:db8/.test(kept2), 'nothing kept for the limits is an address (hashes, gone after an hour)', kept2.slice(0, 200))
    await n.env.DB.prepare('INSERT INTO sent (key, at) VALUES (\'x\', 1)').run()
    await worker.default.scheduled({}, n.env)
    ok(!n.rows('sent').some((x) => x.at === 1), 'the daily clean-up takes the hour\'s counts that ran out')
  }

  // ---------- Signing in, tokens, devices ----------
  {
    const s = service()
    const a = await s.signIn('sam@example.com', 'Studio')
    ok(/^[a-z0-9]{12}$/.test(a.account?.id) && a.account.email === 'sam@example.com' && a.account.tester === 'none' && a.account.relay === 'none' && a.account.status === 'active' && a.device?.name === 'Studio' && a.device.kind === 'computer' && a.device.thisOne, 'the first sign-in makes the account: its id, email, flags and status, and this device', a)
    const t = payload(a.deviceToken)
    ok(verifies(a.deviceToken) && t.k === 'device' && t.a === a.account.id && t.d === a.device.id && t.exp - t.iat === 180 * 86400, 'a device token: signed with the key, the account and device, 180 days', t)
    const notices = () => s.mail.sent.filter((m) => m.to === 'sam@example.com' && /new sign-in/.test(m.subject))
    ok(!notices().length, 'the sign-in that makes the account emails no notice of itself')
    const again = await s.signIn('SAM@example.com ', 'Desk')
    ok(again.account.id === a.account.id, 'one account per email: signing in again, however it\'s typed, is the same account', again.account)
    const notice = notices().at(-1)
    ok(notices().length === 1 && /"Desk" \(a computer, mac\) was signed in to your Bold Bridge account \(sam@example\.com\) on \d{1,2} \w+ \d{4}, \d\d:\d\d UTC/.test(notice.text) && /remove it in Bridge AI/.test(notice.text) && !/\b\d{6}\b/.test(notice.text), 'another device signed in: the account\'s email hears which, and when, and what to do if it wasn\'t them', notice?.text)
    const me = await s.call('/v1/me', { token: a.deviceToken })
    ok(me.status === 200 && me.j.devices.length === 2 && me.j.devices.find((d) => d.thisOne)?.name === 'Studio' && me.j.earlyAccess === null && me.j.relay === null && !me.j.deviceToken, '/v1/me: the account, its devices (this one marked), and nothing given yet', me.j)
    const forged = `${a.deviceToken.split('.')[0]}.${Buffer.alloc(64).toString('base64url')}`
    const changed = `${Buffer.from(JSON.stringify({ ...t, a: 'aaaaaaaaaaaa' })).toString('base64url')}.${a.deviceToken.split('.')[1]}`
    ok((await s.call('/v1/me', { token: forged })).j.code === 'signed-out' && (await s.call('/v1/me', { token: changed })).status === 401 && (await s.call('/v1/me')).status === 401, 'a token not signed with the key, one changed since, or none: refused (401, signed-out)')
    // Five devices, the sixth refused with the list; the same code removes one to make room.
    for (const n of ['Laptop', 'Phone', 'Air']) await s.signIn('sam@example.com', n, n === 'Phone' ? 'phone' : 'computer')
    shift = 61 * MIN // (5 codes for this email this hour already)
    await s.call('/v1/code', { method: 'POST', body: { email: 'sam@example.com' } })
    const code = s.codeFor('sam@example.com')
    const sixth = await s.call('/v1/verify', { method: 'POST', body: { email: 'sam@example.com', code, device: s.device('Mini') } })
    ok(sixth.status === 409 && sixth.j.code === 'devices' && sixth.j.devices?.length === 5 && sixth.j.devices.some((d) => d.name === 'Phone' && d.kind === 'phone') && /Remove one/.test(sixth.j.error), 'a sixth device: refused, with the five, so one can be removed first', sixth.j)
    const desk = sixth.j.devices.find((d) => d.name === 'Desk')
    const swapped = await s.call('/v1/verify', { method: 'POST', body: { email: 'sam@example.com', code, device: s.device('Mini'), replace: desk.id } })
    const list = (await s.call('/v1/me', { token: a.deviceToken })).j.devices.map((d) => d.name)
    ok(swapped.status === 200 && list.length === 5 && list.includes('Mini') && !list.includes('Desk'), 'the same code, naming one to replace: that one\'s out and this one\'s in', list)
    ok((await s.call('/v1/me', { token: again.deviceToken })).j.code === 'signed-out', 'and the device taken out is signed out at once')
    // Renewed past half its life; ended at its end.
    shift = 91 * DAY
    const renew = await s.call('/v1/me', { token: a.deviceToken })
    ok(renew.status === 200 && renew.j.deviceToken && payload(renew.j.deviceToken).iat > t.iat && verifies(renew.j.deviceToken), 'past half its life, /v1/me gives a new device token', payload(renew.j.deviceToken || ''))
    ok((await s.call('/v1/me', { token: a.deviceToken })).status === 200 && (await s.call('/v1/me', { token: renew.j.deviceToken })).status === 200, 'the old one works until the new one is used, and the new one works')
    shift = 181 * DAY
    const mini = (await s.call('/v1/me', { token: renew.j.deviceToken })).j.devices.find((d) => d.name === 'Mini')
    ok(mini && (await s.call('/v1/me', { token: swapped.j.deviceToken })).j.code === 'signed-out', 'a token past its 180 days is refused', null)
    shift = 0
    // Signing out and removing.
    const air = (await s.call('/v1/me', { token: renew.j.deviceToken })).j.devices.find((d) => d.name === 'Air')
    const rm = await s.call(`/v1/devices/${air.id}`, { method: 'DELETE', token: renew.j.deviceToken })
    ok(rm.status === 200 && !rm.j.devices.some((d) => d.name === 'Air') && rm.j.devices.find((d) => d.thisOne)?.name === 'Studio', 'Remove: another of the account\'s devices goes', rm.j?.devices?.map((d) => d.name))
    const out = await s.call('/v1/signout', { method: 'POST', token: renew.j.deviceToken })
    ok(out.j?.ok && (await s.call('/v1/me', { token: renew.j.deviceToken })).status === 401 && (await s.call('/v1/me', { token: a.deviceToken })).status === 401, 'Sign out: this device\'s tokens end at once', out.j)
  }

  // ---------- Linked computers follow: grants ----------
  {
    const s = service()
    const a = await s.signIn('lee@example.com', 'Studio')
    const g = await s.call('/v1/grant', { method: 'POST', token: a.deviceToken })
    ok(g.status === 200 && g.j.grant?.length >= 40 && Date.parse(g.j.expires) - Date.now() <= 5 * MIN + 1000, 'a signed-in computer gets a one-time grant, good for 5 minutes', g.j)
    ok(!JSON.stringify(s.rows('grants')).includes(g.j.grant), 'kept as a hash')
    const r = await s.call('/v1/redeem', { method: 'POST', body: { grant: g.j.grant, device: s.device('Desk') } })
    ok(r.status === 200 && r.j.account.id === a.account.id && r.j.device.name === 'Desk' && verifies(r.j.deviceToken), 'another computer redeems it: signed in to the same account, no email', r.j?.device)
    const twice = await s.call('/v1/redeem', { method: 'POST', body: { grant: g.j.grant, device: s.device('Laptop') } })
    ok(twice.j.code === 'expired', 'used once, it\'s done', twice.j)
    const g1 = (await s.call('/v1/grant', { method: 'POST', token: a.deviceToken })).j.grant
    const pair = await Promise.all(['Laptop', 'Air'].map((n) => s.call('/v1/redeem', { method: 'POST', body: { grant: g1, device: s.device(n) } })))
    ok(pair.filter((x) => x.status === 200).length === 1 && pair.some((x) => x.j?.code === 'expired'), 'two computers redeeming the same grant at once: one signs in, the other is told it\'s no good now', pair.map((x) => x.j?.code || x.status))
    const g2 = (await s.call('/v1/grant', { method: 'POST', token: a.deviceToken })).j.grant
    shift = 6 * MIN
    const late = await s.call('/v1/redeem', { method: 'POST', body: { grant: g2, device: s.device('Laptop') } })
    shift = 0
    ok(late.j.code === 'expired' && /lasts 5 minutes/.test(late.j.error), 'after 5 minutes it has run out, saying so', late.j)
    for (const n of ['Laptop', 'Phone', 'Air']) await s.signIn('lee@example.com', n)
    const full = await s.call('/v1/redeem', { method: 'POST', body: { grant: (await s.call('/v1/grant', { method: 'POST', token: a.deviceToken })).j.grant, device: s.device('Mini') } })
    ok(full.j.code === 'devices' && full.j.devices.length === 5, 'and it\'s held to the 5 devices too', full.j)
  }

  // ---------- Requests, the admin view, tokens given ----------
  {
    const s = service()
    const a = await s.signIn('ana@example.com', 'Studio')
    const req = await s.call('/v1/request', { method: 'POST', token: a.deviceToken, body: { kind: 'relay', note: 'For my phone on the train' } })
    ok(req.status === 200 && req.j.account.relay === 'requested', 'Request access: the account says requested', req.j)
    const note = s.mail.sent.find((m) => m.to === 'admins@example.com')
    ok(note && /Request for Bridge AI's relay: ana@example\.com/.test(note.subject) && /For my phone on the train/.test(note.text), 'and the admins get a short note, with theirs', note)
    ok((await s.call('/v1/request', { method: 'POST', token: a.deviceToken, body: { kind: 'other' } })).j.code === 'invalid', 'a kind that isn\'t early or relay is refused')
    const noAdmin = await s.call('/admin/requests', { bound: true, admin: null })
    ok(noAdmin.status === 400 && noAdmin.j.code === 'admin', 'the admin routes say who\'s asking (X-Admin-Email), or are refused', noAdmin.j)
    const open = await s.call('/admin/requests', { bound: true })
    ok(open.j.requests?.length === 1 && JSON.stringify(Object.keys(open.j.requests[0]).sort()) === JSON.stringify(['account', 'at', 'email', 'kind', 'note', 'os']) && open.j.requests[0].account === a.account.id && open.j.requests[0].os === 'mac' && open.j.requests[0].email === 'ana@example.com', 'GET /admin/requests: { account, email, kind, note, os, at }', open.j)
    const stats0 = (await s.call('/admin/stats', { bound: true })).j
    ok(stats0.accounts === 1 && stats0.devices === 1 && stats0.waiting?.relay === 1 && stats0.waiting.early === 0 && stats0.codesToday === 1 && stats0.codesMonth === 1 && stats0.relayMax === 500 && stats0.testers === 0 && stats0.relayAccounts === 0, 'GET /admin/stats: accounts, devices, testers, relay accounts, waiting by kind, codes today and this month, relayMax', stats0)
    // Approving: the person emailed, the request closed, and /v1/me gives the relay token.
    const ok1 = await s.call(`/admin/accounts/${a.account.id}`, { method: 'POST', bound: true, body: { relay: 'approved', note: 'Welcome' } })
    const told = s.mail.sent.filter((m) => m.to === 'ana@example.com').at(-1)
    ok(ok1.status === 200 && ok1.j.account.relay === 'approved' && ok1.j.emailed === true && /relay is on/.test(told.subject) && /Settings › Devices/.test(told.text), 'approving the relay: { account, emailed }, and the person is told where to turn it on', { r: ok1.j, told: told.subject })
    ok(!(await s.call('/admin/requests', { bound: true })).j.requests.length && (await s.call('/admin/requests?state=all', { bound: true })).j.requests.length === 1, 'its request is closed')
    const me = (await s.call('/v1/me', { token: a.deviceToken })).j
    const rt = payload(me.relay?.token)
    ok(me.relay && verifies(me.relay.token) && rt.k === 'relay' && rt.a === a.account.id && rt.d === me.devices[0].id && rt.exp - rt.iat === 7 * 86400 && rt.exp * 1000 - Date.now() > 3.4 * DAY, 'the relay token: signed, the account and this computer, 7 days, at least half of it left', rt)
    ok(JSON.stringify(me.relay.limits) === JSON.stringify({ window: { hours: 8, messages: 150000 }, week: { messages: 1000000 }, devices: 5 }) && me.relay.used === null, 'with the limits (the relay\'s defaults until it says its own) and no use yet', me.relay)
    ok((await s.call('/v1/me', { token: a.deviceToken })).j.relay.token === me.relay.token, 'the same token comes back until it\'s past half its life')
    shift = 4 * DAY
    const later = (await s.call('/v1/me', { token: a.deviceToken })).j.relay.token
    shift = 0
    ok(later !== me.relay.token && payload(later).iat > rt.iat, 'then a new one', payload(later))
    const phone = await s.signIn('ana@example.com', 'Phone', 'phone')
    ok((await s.call('/v1/me', { token: phone.deviceToken })).j.relay === null, 'a phone gets no relay token: only computers register with the relay')
    // Early Access: the code in server/earlyaccess.js's format, for the account's id.
    await s.call(`/admin/accounts/${a.account.id}`, { method: 'POST', bound: true, body: { tester: 'yes' } })
    const code = (await s.call('/v1/me', { token: a.deviceToken })).j.earlyAccess?.code
    earlyAccess.useAccountsKey(() => PUBLIC)
    const read2 = earlyAccess.readCode(code, { key: '' })
    ok(read2.ok && read2.for === a.account.id && read2.id === a.account.id && Date.parse(read2.until) - Date.now() > 14 * DAY, 'tester yes: an Early Access code server/earlyaccess.js reads with the accounts key, for the account\'s id (never the email), 15 days left at least', read2)
    ok(earlyAccess.readCode(code, { key: earlyAccess.publicKey() || '' }).ok, 'and it checks out beside the owner\'s own key too')
    earlyAccess.useAccountsKey(() => '')
    // Suspended: nothing works, and the relay hears it.
    const noNote = await s.call(`/admin/accounts/${a.account.id}`, { method: 'POST', bound: true, body: { status: 'suspended' } })
    ok(noNote.status === 400 && noNote.j.code === 'note', 'suspending without a note is refused', noNote.j)
    await s.call(`/admin/accounts/${a.account.id}`, { method: 'POST', bound: true, body: { status: 'suspended', note: 'Sharing it' } })
    const sus = (await s.call('/v1/me', { token: a.deviceToken })).j
    ok(sus.account.status === 'suspended' && sus.relay === null && sus.earlyAccess === null, 'suspended: /v1/me says so, with no relay token and no Early Access code', sus)
    ok((await s.call('/v1/grant', { method: 'POST', token: a.deviceToken })).j.code === 'suspended' && (await s.call('/v1/request', { method: 'POST', token: a.deviceToken, body: { kind: 'early' } })).j.code === 'suspended', 'a grant and a request each say it\'s suspended')
    // Asking for a code: the same answer as for any email, so whoever asked can't tell; the email
    // itself says it's suspended, with no code, and none is waiting.
    const asks = await Promise.all(['ana@example.com', 'nobody-yet@example.com'].map((email) => s.call('/v1/code', { method: 'POST', body: { email } })))
    const form = await s.call('/v1/request-public', { method: 'POST', body: { email: 'ana@example.com', kind: 'early' }, ip: '192.0.2.77' })
    const toAna = s.mail.sent.filter((m) => m.to === 'ana@example.com').slice(-2)
    ok(asks.every((x) => x.status === 200 && JSON.stringify(x.j) === '{"sent":true}') && form.status === 200 && JSON.stringify(form.j) === '{"sent":true}', 'a code for a suspended account\'s email (from Bridge AI or the website) is answered as for anyone\'s', [asks.map((x) => x.j), form.j])
    ok(toAna.length === 2 && toAna.every((m) => /suspended/.test(m.subject) && !/\b\d{6}\b/.test(m.text)) && !s.rows('codes').some((c) => c.email === 'ana@example.com'), 'its email says it\'s suspended, with no code, and none is waiting', toAna.map((m) => m.subject))
    const st = (await s.call(`/internal/status?a=${a.account.id}`, { bound: true, admin: null })).j
    ok(st.status === 'suspended' && st.relay === 'approved', 'the relay asks (/internal/status) and hears it', st)
    ok((await s.call(`/admin/accounts/${a.account.id}`, { method: 'POST', bound: true, body: { status: 'active' } })).status === 400, 'restoring without a note is refused too')
    await s.call(`/admin/accounts/${a.account.id}`, { method: 'POST', bound: true, body: { status: 'active', note: 'Sorted' } })
    ok((await s.call('/v1/me', { token: a.deviceToken })).j.relay?.token, 'restored, the relay token is back')
    const one = (await s.call(`/admin/accounts/${a.account.id}`, { bound: true })).j
    const susp = one.history.find((h) => /status: active → suspended/.test(h.what))
    ok(susp?.by === 'admin@example.com' && susp.note === 'Sharing it' && one.devices.length === 2 && Array.isArray(one.usage) && one.limits?.devices === 5 && 'used' in one, 'GET /admin/accounts/:id: devices, history with who and why, usage by day, used, limits', { susp, keys: Object.keys(one) })
    ok((await s.call(`/admin/accounts/${a.account.id}`, { method: 'POST', bound: true, body: { relay: 'requested' } })).status === 400, 'a value the admin can\'t set is refused')
    // The relay full: RELAY_MAX_ACCOUNTS approved already.
    const full = service({ RELAY_MAX_ACCOUNTS: '1' })
    const x = await full.signIn('x@example.com')
    const y = await full.signIn('y@example.com')
    await full.call(`/admin/accounts/${x.account.id}`, { method: 'POST', bound: true, body: { relay: 'approved' } })
    const no = await full.call(`/admin/accounts/${y.account.id}`, { method: 'POST', bound: true, body: { relay: 'approved' } })
    ok(no.status === 409 && no.j.code === 'full' && /relay is full/.test(no.j.error) && /MAX_ACCOUNTS/.test(no.j.error), 'approving the relay past RELAY_MAX_ACCOUNTS: 409 full, saying what to raise', no.j)
    // An email that couldn't go: emailed false, and the history says so.
    full.mail.fail('E_DELIVERY_FAILED')
    const quiet = await full.call(`/admin/accounts/${y.account.id}`, { method: 'POST', bound: true, body: { tester: 'yes' } })
    full.mail.fail(null)
    ok(quiet.status === 200 && quiet.j.emailed === false && quiet.j.account.tester === 'yes', 'approved with the email not going: done, and emailed false', quiet.j)
    // Inviting.
    const inv = await s.call('/admin/invite', { method: 'POST', bound: true, body: { email: 'New@Example.com', tester: 'yes', note: 'From the meetup' } })
    const invited = s.mail.sent.filter((m) => m.to === 'new@example.com').at(-1)
    ok(inv.status === 200 && inv.j.created === true && inv.j.emailed === true && inv.j.account.tester === 'yes' && /invitation/i.test(invited.subject) && /Settings › Account/.test(invited.text), 'POST /admin/invite: the account made and marked, and an invitation emailed', { j: inv.j, invited: invited?.subject })
    ok((await s.call('/admin/invite', { method: 'POST', bound: true, body: { email: 'new@example.com', tester: 'yes' } })).j.created === false, 'inviting again: not made twice')
    // Accounts: searched, filtered, sorted by the week's use.
    await s.call('/internal/usage', { method: 'POST', bound: true, admin: null, body: { a: a.account.id, window: { messages: 120, resetsAt: new Date(Date.now() + 3600000).toISOString() }, week: { messages: 5000, resetsAt: new Date(Date.now() + 3 * DAY).toISOString() }, days: { [new Date().toISOString().slice(0, 10)]: 5000 }, limits: { window: { hours: 8, messages: 200000 }, week: { messages: 1000000 } } } })
    const list = (await s.call('/admin/accounts?sort=use', { bound: true })).j
    ok(list.accounts[0].id === a.account.id && list.accounts[0].used?.week.messages === 5000 && list.accounts[0].lastSeen && list.total === 2 && list.pages === 1 && list.limits.window.messages === 200000, 'GET /admin/accounts?sort=use: the heaviest first, with used, lastSeen, and the relay\'s limits as it reported them', list.accounts.map((x) => [x.email, x.used]))
    ok((await s.call('/admin/accounts?q=new@', { bound: true })).j.accounts.map((x) => x.email).join() === 'new@example.com' && (await s.call('/admin/accounts?tester=yes&relay=approved', { bound: true })).j.total === 1, 'and searched by email, and filtered by flags')
    const me2 = (await s.call('/v1/me', { token: a.deviceToken })).j
    ok(me2.relay.used?.window.messages === 120 && me2.relay.used.week.messages === 5000 && me2.relay.limits.window.messages === 200000, '/v1/me passes on the relay\'s count and limits', me2.relay)
    shift = 2 * 3600000
    ok((await s.call('/v1/me', { token: a.deviceToken })).j.relay.used.window.messages === 0, 'a window that has ended since reads 0')
    shift = 0
    const day = (await s.call(`/admin/accounts/${a.account.id}`, { bound: true })).j.usage
    ok(day[0]?.messages === 5000, 'and the use by day is in the account\'s view', day)
    const devs = (await s.call(`/admin/accounts/${a.account.id}`, { bound: true })).j.devices
    const phoneId = devs.find((d) => d.name === 'Phone').id
    const before = (await s.call(`/internal/status?a=${a.account.id}&d=${phoneId}`, { relay: true })).j
    const gone = await s.call(`/admin/accounts/${a.account.id}/devices/${phoneId}`, { method: 'DELETE', bound: true })
    ok(gone.j.devices.length === 1 && (await s.call('/v1/me', { token: phone.deviceToken })).status === 401, 'DELETE /admin/accounts/:id/devices/:dev: gone, and signed out there', gone.j)
    const after = (await s.call(`/internal/status?a=${a.account.id}&d=${phoneId}`, { relay: true })).j
    const other = (await s.call(`/internal/status?a=${a.account.id}&d=${devs.find((d) => d.name === 'Studio').id}`, { relay: true })).j
    ok(before.device === true && after.device === false && after.status === 'active' && other.device === true && !('device' in (await s.call(`/internal/status?a=${a.account.id}`, { relay: true })).j), '/internal/status?a=&d= says whether that device is still on the account (removed: no), so the relay lets it go then', { before, after, other })
    // Deleting the account.
    const wrong = await s.call('/v1/account', { method: 'DELETE', token: a.deviceToken, body: { email: 'other@example.com' } })
    ok(wrong.j.code === 'mismatch', 'deleting needs the account\'s email typed again', wrong.j)
    const del = await s.call('/v1/account', { method: 'DELETE', token: a.deviceToken, body: { email: 'Ana@example.com' } })
    ok(del.j.deleted === true && (await s.call(`/internal/status?a=${a.account.id}`, { bound: true, admin: null })).j.status === 'gone', 'deleted: the relay hears the account is gone', del.j)
    const left = ['accounts', 'devices', 'requests', 'history', 'usage', 'usage_days', 'grants', 'codes'].flatMap((tb) => s.rows(tb)).filter((r) => JSON.stringify(r).includes(a.account.id) || JSON.stringify(r).includes('ana@example.com'))
    ok(!left.length, 'and nothing kept is of it any more', left)
  }

  // ---------- The website's form ----------
  {
    const s = service()
    const pre = await s.call('/v1/request-public', { method: 'OPTIONS', headers: { Origin: 'https://boldbridge.example' } })
    ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://boldbridge.example', 'the form\'s request answers the website (CORS), and only it', pre.headers.get('access-control-allow-origin'))
    ok(!(await s.call('/v1/code', { method: 'POST', body: { email: 'x' } })).headers.get('access-control-allow-origin'), 'no other route does')
    const sent = await s.call('/v1/request-public', { method: 'POST', body: { email: 'kim@example.com', kind: 'early', note: 'Tester at heart', os: 'windows' } })
    ok(sent.j.sent === true && /confirm your request for Early Access/.test(s.mail.sent.at(-1).text) && !s.rows('accounts').length, 'from the form: a code to confirm, and nothing counts yet', sent.j)
    const done2 = await s.call('/v1/request-public', { method: 'POST', body: { email: 'kim@example.com', kind: 'early', code: s.codeFor('kim@example.com') } })
    const req = (await s.call('/admin/requests', { bound: true })).j.requests[0]
    ok(done2.j.account?.tester === 'requested' && req?.email === 'kim@example.com' && req.note === 'Tester at heart' && req.os === 'windows', 'confirmed with the code: the account made, and the request counts as it was asked', { done2: done2.j, req })
    for (let i = 0; i < 5; i++) await s.call('/v1/request-public', { method: 'POST', body: { email: `f${i}@example.com`, kind: 'relay' }, ip: '192.0.2.9' })
    const sixth = await s.call('/v1/request-public', { method: 'POST', body: { email: 'f9@example.com', kind: 'relay' }, ip: '192.0.2.10' })
    ok(sixth.j.code === 'too-many' && sixth.headers.get('access-control-allow-origin'), 'the form is limited per network (5 an hour), and says so to the website', sixth.j)
  }

  // ---------- The one switch: ACCOUNTS_URL, and the policy ----------
  {
    const src = read('server', 'account.js')
    const URL_ = /export const ACCOUNTS_URL = '([^']*)'/.exec(src)?.[1]
    ok(URL_ !== undefined && /export const ACCOUNTS_PUBLIC_KEY = '/.test(src), 'server/account.js has ACCOUNTS_URL and ACCOUNTS_PUBLIC_KEY, the one place accounts are switched on', null)
    const privacy = read('PRIVACY.md')
    const terms = read('TERMS.md')
    const section = (doc, heading) => { const i = doc.search(new RegExp(`^## ${heading}`, 'm')); if (i < 0) return null; const rest = doc.slice(i + 3); const j = rest.search(/^## /m); return j < 0 ? rest : rest.slice(0, j) }
    const ready = (p, t) => {
      const s = section(p, 'Your Bold Bridge account')
      if (!s) return ['PRIVACY.md has no "## Your Bold Bridge account" section']
      const need = [['the email', /your email/], ['the devices', /devices/], ['the flags', /Early Access and the\s+relay/], ['the relay\'s counts', /counts/], ['that nothing from the computer is kept', /Never\s+anything from your computer/], ['how to delete it', /Delete account/], ['where it is', /accounts\.boldbridge\.ai/], ['the account\'s id in the usage stats', /account's id/]]
      const tSec = section(t, 'Your Bold Bridge account')
      return [...need.filter(([, re]) => !re.test(s)).map(([w]) => `PRIVACY.md's section doesn't say ${w}`), ...(!tSec ? ['TERMS.md has no "## Your Bold Bridge account" section'] : /delete/.test(tSec) ? [] : ['TERMS.md\'s section doesn\'t say it can be deleted']), ...(/There is no account/.test(p) ? ['PRIVACY.md still says there is no account'] : [])]
    }
    ok(!(URL_ ? ready(privacy, terms) : []).length, 'ACCOUNTS_URL is set only with PRIVACY.md and TERMS.md saying what an account keeps and how to delete it', URL_ ? ready(privacy, terms) : null)
    ok(URL_ || !section(privacy, 'Your Bold Bridge account'), 'and while it\'s empty, PRIVACY.md doesn\'t describe accounts that aren\'t there', null)
    ok(ready(URL_ ? privacy.replace(/^## Your Bold Bridge account[\s\S]*?(?=^## )/m, '') : privacy, terms).length > 0, 'the check itself: without the section, it fails', null)
    const md = read('account', 'README.md')
    const at = md.indexOf('## Policy text to add when it goes live')
    if (URL_) ok(at < 0, 'live: README.md no longer holds the drafts', null)
    else {
      const unquote = (s) => s.split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^> ?/, '')).join('\n').trim()
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const loose = (s) => new RegExp(s.trim().split(/\s+/).map(esc).join('\\s+'))
      const docs = { 'PRIVACY.md': privacy, 'TERMS.md': terms }
      const stale = []
      let parts = 0
      for (const m of md.slice(at).matchAll(/^### (PRIVACY\.md|TERMS\.md): (.+)\n([\s\S]*?)(?=^### |^## |(?![\s\S]))/gm)) {
        const [, file, where, body] = m
        parts++
        const rep = /^Replace:?\n([\s\S]*?)\nwith:?\n([\s\S]*)$/m.exec(body)
        if (rep) {
          const from = unquote(rep[1])
          if (!loose(from).test(docs[file])) stale.push(`${file} (${where}): "${from.slice(0, 80)}…" isn't in it any more`)
          else docs[file] = docs[file].replace(loose(from), () => unquote(rep[2]))
          continue
        }
        const after = /a new section after "([^"]+)"/.exec(where)?.[1]
        const i = after ? docs[file].search(new RegExp(`^## ${esc(after)}`, 'm')) : -1
        if (i < 0) { stale.push(`${file}: no "## ${after}" to put a section after`); continue }
        const next = docs[file].slice(i + 3).search(/^## /m)
        const end = next < 0 ? docs[file].length : i + 3 + next
        docs[file] = `${docs[file].slice(0, end)}${unquote(body)}\n\n${docs[file].slice(end)}`
      }
      ok(parts >= 6 && !stale.length, 'README.md\'s policy drafts still quote PRIVACY.md and TERMS.md as they are', { parts, stale })
      const pasted = ready(docs['PRIVACY.md'], docs['TERMS.md'])
      ok(!pasted.length, 'and pasted in, they pass the check', pasted)
    }
  }
} catch (e) {
  ok(false, `the test ran to the end: ${e.stack}`)
}
process.exit(done().fail ? 1 : 0)
