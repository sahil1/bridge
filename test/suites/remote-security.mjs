// What a security review of remote access found, each kept found: two Bridge AIs ("Studio", seen,
// and "Laptop"), each on a relay of its own and linked, phones paired with each (the link client),
// Tailscale stood in for (BRIDGE_TAILNET_OWNER, and a stand-in `tailscale` that says it serves
// Studio), and nothing real taken or pressed (BRIDGE_TEST_SCREEN=fake, BRIDGE_TEST_INPUT). Checked:
//   Tailscale: what it says about who's asking never lets a request in without the key, as any
//     program on Studio can send the same to 127.0.0.1; a phone through it is let in by the code in
//     Settings (a one-time link, or that link pasted), and is never "at this computer";
//   the lockout: wrong passwords at once still lock a device out after 5 (each counted before it's
//     checked, two sessions of one device waiting at most), the right one isn't asked for meanwhile,
//     and trying again doesn't end it early; many turned away are one line in Screen Activity, and
//     don't push out a session that ran;
//   Which Devices May Connect: through Laptop, Laptop's own list and lockout first; Studio keeps a
//     lockout for Laptop and the device it speaks for, not Laptop itself, and says both; unticked at
//     the password or waiting for Allow, it ends; a device paired once a guardrail is set (a phone,
//     or a computer a phone links) starts unticked, its name without what turns text around;
//   Ask Here First: allowed to view, control is asked for again; after it went idle, the password
//     and Allow again;
//   a device asking is told its own standing (behind a guardrail, not even which screens), not the
//     record; the cards of who's viewing carry no window titles; Which screen?'s stills come only in
//     a session; Block This Device from a phone unticks a device at the computer it came through,
//     and one paired there after that starts unticked;
//   previews: only a server an agent's terminal started (not one in the home folder, nor one no
//     terminal started), past the password (a session for the app), in a sandbox beside a phone's
//     page, at an address of its own on Laptop, never under Laptop's own address;
//   unticked, a device gets nothing of Studio's (letin.js): no launch, terminal, file, copy, event
//     feed, preview or notification, nor a route written later; told only that Studio hasn't let it
//     in and where, it can still load the page that says so and unpair itself; Studio itself never
//     is refused, Tailscale isn't Studio, and the list applies while the Beta Feature is on;
//     unticked with a terminal, the app's feed and a copy open, each ends then; through Laptop,
//     Laptop's list first, then Studio's for Laptop, saying which one isn't let in;
//   the password changed or taken off ends sessions; a picture for a session that isn't there goes
//     to no other; the password's hash at OWASP's cost, an older one made again once typed; an app
//     drawn off screen follows no redirect or frame to anything else on the computer;
//   in the app (Chromium, or WebKit as the iPhone app): a phone paired once a password is set is
//     one card saying Studio hasn't let it in and where; Allow in Studio's Needs You lets it in, and
//     its page opens by itself.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import WebSocket from 'ws'
import { startKit, startRelay, checks, until, sleep, freePort, stopTree, browser, page, TEST, ROOT, IS_WIN } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'
import { K, json, text, newKey } from '../../relay/web/link.js'
import { unpackFrame, packFrame, ACCESS } from '../../shared/remote.js'

const { ok, skip, done } = checks('remote-security')
const relays = []
const kits = []
const procs = []
const PW = 'correct horse 42'
// A command line for a terminal's shell: PowerShell on Windows (& runs a quoted path), sh elsewhere.
const typed = (argv) => (IS_WIN ? `& ${argv.map((a) => `'${a}'`).join(' ')}` : argv.map((a) => `"${a}"`).join(' '))
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: ${String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')}`) } }
const OWNER = 'owner@example.com'
const TS = 'my-mac.tail1234.ts.net'
// Tailscale, stood in for: running, signed in as OWNER, serving this server at :8443.
const TAILSCALE = String.raw`
const a = process.argv.slice(2).join(' ')
if (a === 'status --json') console.log(JSON.stringify({ BackendState: 'Running', Self: { DNSName: '${TS}.', UserID: 1 }, User: { 1: { LoginName: '${OWNER}' } } }))
else if (a === 'serve status --json') console.log(JSON.stringify({ Web: { '${TS}:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:' + process.env.BRIDGE_PORT } } } } }))
else process.exit(1)
`

// A request straight to a kit's port, with any Host and headers, and no key unless given.
const raw = (kit, method, p, { headers = {}, body } = {}) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: kit.port, method, path: p, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
    let b = ''
    res.on('data', (c) => { b += c })
    res.on('end', () => { let j = null; try { j = JSON.parse(b) } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, json: j, text: b }) })
  })
  r.on('error', (e) => resolve({ error: e.message }))
  if (body) r.write(JSON.stringify(body))
  r.end()
})
// A WebSocket's answer to the upgrade: 101, or the status it was refused with.
const upgrade = (kit, p, headers) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${kit.port}${p}`, { headers })
  ws.on('open', () => { resolve(101); ws.close() })
  ws.on('unexpected-response', (_q, r) => resolve(r.statusCode))
  ws.on('error', () => resolve(0))
})

// ---------- a paired device's link, spoken for: requests and WebSockets over one session ----------
function over(c) {
  const by = new Map()
  let ids = 1000
  let live = true
  ;(async () => {
    while (live) {
      let r
      try { r = await c.next(3600_000) } catch (e) { if (/closed/.test(e.message)) break; continue }
      by.get(r.id)?.(r)
    }
  })()
  const request = (m, u, body, headers = []) => new Promise((resolve) => {
    const id = ids++
    let head = null
    const parts = []
    by.set(id, (r) => {
      if (r.kind === K.HEAD) head = json(r.body)
      else if (r.kind === K.BODY) parts.push(Buffer.from(r.body))
      else if (r.kind === K.ERR) { by.delete(id); resolve({ error: text(r.body) }) } else if (r.kind === K.END) {
        by.delete(id)
        const b = Buffer.concat(parts)
        let j = null
        try { j = JSON.parse(b.toString('utf8')) } catch { /* not JSON */ }
        resolve({ status: head?.s, headers: head?.h || [], json: j, text: b.toString('utf8') })
      }
    })
    ;(async () => {
      await c.send(K.REQ, id, { m, u, h: [['content-type', 'application/json'], ...headers], body: !!body })
      if (body) { await c.send(K.BODY, id, new TextEncoder().encode(JSON.stringify(body))); await c.send(K.END, id) }
    })()
  })
  // term: a terminal's, whose output (text or not) is kept as text, apart from what's JSON.
  const socket = (u, { term = false } = {}) => {
    const id = ids++
    const s = { msgs: [], frames: [], text: '', opened: false, closed: null }
    by.set(id, (r) => {
      if (r.kind === K.WS_OPENED) s.opened = true
      else if (r.kind === K.WS_MSG) {
        const bin = r.body[0] !== 1
        const d = Buffer.from(r.body.subarray(1))
        if (bin && !term) s.frames.push({ at: Date.now(), f: unpackFrame(new Uint8Array(d)) })
        else { try { s.msgs.push(JSON.parse(d.toString('utf8'))) } catch { if (term) s.text += d.toString('utf8'); else s.msgs.push(d.toString('utf8')) } }
      } else if (r.kind === K.WS_CLOSE) { s.closed = json(r.body); by.delete(id) }
    })
    s.send = (m) => c.send(K.WS_MSG, id, Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(m))]))
    s.close = () => c.send(K.WS_CLOSE, id, { c: 1000, r: '' })
    s.wait = (fn, ms = 10000) => until(async () => fn(s), ms, 30)
    c.send(K.WS_OPEN, id, { u })
    return s
  }
  return { request, socket, stop: () => { live = false; c.close() } }
}
// A WebSocket of a kit's own (its own page, or Laptop's user through its link), with the key.
function local(kit, u) {
  const s = { msgs: [], frames: [], closed: null }
  const ws = new WebSocket(`${kit.url.replace(/^http/, 'ws')}${u}`, { headers: { authorization: `Bearer ${kit.key}` } })
  s.ws = ws
  ws.on('message', (d, bin) => { if (bin) s.frames.push({ at: Date.now(), f: unpackFrame(new Uint8Array(d)) }); else { try { s.msgs.push(JSON.parse(String(d))) } catch { s.msgs.push(String(d)) } } })
  ws.on('close', (c) => { s.closed = { c } })
  ws.on('error', () => {})
  s.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m))
  s.close = () => ws.close()
  s.wait = (fn, ms = 10000) => until(async () => fn(s), ms, 30)
  return s
}
const msg = (s, t) => s.msgs.find((m) => m.t === t)
const msgs = (s, t) => s.msgs.filter((m) => m.t === t)
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
// Through the password, when it's asked: the session's hello, or null.
async function through(v, pw = PW) {
  await v.wait((s) => msg(s, 'password') || msg(s, 'hello') || msg(s, 'error'))
  if (msg(v, 'password') && !msg(v, 'hello') && !msg(v, 'error')) {
    const n = msgs(v, 'password').length
    await v.send({ t: 'password', p: pw })
    await v.wait((s) => msg(s, 'hello') || msg(s, 'error') || msgs(s, 'password').length > n)
  }
  return msg(v, 'hello') || null
}

try {
  const ra = await startRelay('sec-studio')
  relays.push(ra)
  const kitWith = async (name, rel, env = {}) => {
    const k = await startKit(`sec-${name.toLowerCase()}`, { config: { trials: { 'remote-screen': true } }, env: (dirs) => { fs.writeFileSync(path.join(dirs.data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_REMOTE_ICE: 'none', ...env } } })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }
  const inputs = path.join(TEST, '.out', `remote-security-input-${process.pid}.jsonl`)
  fs.rmSync(inputs, { force: true })
  const pushed = path.join(TEST, '.out', `remote-security-push-${process.pid}.jsonl`)
  fs.rmSync(pushed, { force: true })
  // Ask Here First waits 3 s for an answer here, and control idles back to view-only after 4 s.
  const studio = await kitWith('Studio', ra, { BRIDGE_TEST_SCREEN: 'fake', BRIDGE_TEST_INPUT: inputs, BRIDGE_TEST_PUSH: pushed, BRIDGE_TAILNET_OWNER: OWNER, BRIDGE_REMOTE_ASK_MS: '3000', BRIDGE_REMOTE_CONTROL_IDLE_MS: '4000' })
  studio.program('tailscale', TAILSCALE)

  // ---------- Tailscale's headers, sent by a program on this computer ----------
  await part('Tailscale', async () => {
    const you = { host: TS, 'tailscale-user-login': OWNER }
    const fwd = { host: `127.0.0.1:${studio.port}`, 'x-forwarded-host': TS, 'tailscale-user-login': OWNER }
    const st = await raw(studio, 'GET', '/api/remote', { headers: you })
    ok(st.status === 401 && !st.json?.access, 'Tailscale\'s name and your login, without the key: refused (any program on this computer can send them)', st.status)
    ok((await raw(studio, 'GET', '/api/remote', { headers: fwd })).status === 401, 'nor as Tailscale says it passed one on (X-Forwarded-Host)')
    const cleared = await raw(studio, 'POST', '/api/remote/password', { headers: you, body: { remove: true } })
    ok(cleared.status === 401, 'nor can it take the Remote Access Password off', cleared.status)
    ok(await upgrade(studio, '/api/remote/view?source=screen:&control=1', { ...you, 'x-bridge-relay': 'Phone2' }) === 401, 'nor open a screen as a device (x-bridge-relay)')
    ok(await upgrade(studio, '/api/panes/w1:p1/attach', you) === 401, 'nor a terminal')
    ok((await raw(studio, 'GET', '/api/remote', { headers: { ...you, 'tailscale-user-login': 'someone@example.com', authorization: `Bearer ${studio.key}` } })).status === 403, 'and someone else Tailscale names is still turned away, key or not')

    // With what a phone let in carries (the cookie; the key here): never this computer itself.
    const keyed = { ...you, authorization: `Bearer ${studio.key}` }
    const seen = await raw(studio, 'GET', '/api/remote', { headers: keyed })
    ok(seen.status === 200 && seen.json?.here === false, 'a phone through Tailscale, let in: not this computer', seen.json?.here)
    const pw = await raw(studio, 'POST', '/api/remote/password', { headers: keyed, body: { password: 'attacker-pw' } })
    ok(pw.status === 403 && pw.json?.code === 'here', 'so it can\'t set the Remote Access Password', pw.json)
    const fpw = await raw(studio, 'POST', '/api/remote/password', { headers: { ...fwd, authorization: `Bearer ${studio.key}` }, body: { password: 'attacker-pw' } })
    ok(fpw.status === 403, 'nor through Tailscale\'s X-Forwarded-Host', fpw.json)
    // (Refused as the app's other errors are said: not 200, and why.)
    const refused = (r) => r.status >= 400 && /on your computer/.test(r.json?.error || '')
    const pair = await raw(studio, 'POST', '/api/relay/pair', { headers: keyed, body: {} })
    ok(refused(pair), 'nor pair a device (what only the computer does)', pair.json)
    ok((await raw(studio, 'POST', '/api/browser-link', { headers: keyed, body: {} })).status === 403, 'nor make a link that lets a browser in')
    const another = await raw(studio, 'POST', '/api/phone/link', { headers: keyed, body: {} })
    ok(refused(another), 'nor a code for another phone', another.json)
    ok(!(await studio.api('/remote')).access.password, 'nothing changed at Studio')

    // A phone let in by the code in Settings: a one-time link through Tailscale. (Bridge AI looks
    // for tailscale.exe on Windows, which a stand-in script can't be.)
    if (IS_WIN) return skip('a phone let in by a one-time link through Tailscale', 'Windows runs tailscale.exe, which the stand-in (a script) can\'t be')
    const ph = await studio.api('/phone')
    ok(ph.enabled === true && ph.url === `https://${TS}:8443/`, 'Studio says Tailscale serves it (the stand-in)', ph)
    const code = await studio.api('/phone/link', {})
    const at = new URL(code.url)
    ok(at.origin === `https://${TS}:8443` && /^[\w-]{20,}$/.test(at.searchParams.get('open') || '') && /^<svg/.test(code.qr || ''), 'Settings\' code holds a one-time link at Tailscale\'s address', { url: code.url && `${at.origin}/?open=…` })
    const page = await raw(studio, 'GET', '/', { headers: { ...you, accept: 'text/html', 'sec-fetch-mode': 'navigate' } })
    ok(page.status === 401 && /Scan the code there with this phone's camera/.test(page.text) && /name="open"/.test(page.text), 'a phone not let in yet: told to scan the code, or paste its link', page.text.slice(0, 200))
    const open = await raw(studio, 'GET', `/?open=${at.searchParams.get('open')}`, { headers: you })
    const cookie = String(open.headers['set-cookie'] || '').split(';')[0]
    ok(open.status === 303 && /^bridge-ai-\d+=/.test(cookie) && /HttpOnly/.test(String(open.headers['set-cookie'])), 'the link lets the phone in: its cookie', open.status)
    ok((await raw(studio, 'GET', '/api/config', { headers: { ...you, cookie } })).status === 200, 'which the phone then uses through Tailscale')
    const again = await raw(studio, 'GET', `/?open=${at.searchParams.get('open')}`, { headers: { ...you, accept: 'text/html' } })
    ok(again.status === 401 && /That link has been used/.test(again.text), 'once only')
    const pasted = (await studio.api('/phone/link', {})).url
    const viaPaste = await raw(studio, 'GET', `/?open=${encodeURIComponent(pasted)}`, { headers: you })
    ok(viaPaste.status === 303 && /^bridge-ai-\d+=/.test(String(viaPaste.headers['set-cookie'] || '')), 'its whole link, pasted on that page, lets the phone in too', viaPaste.status)
  })

  // ---------- Laptop, linked; Phone and Phone2 paired with Studio, Pocket with Laptop ----------
  const rb = await startRelay('sec-laptop')
  relays.push(rb)
  const pushedL = path.join(TEST, '.out', `remote-security-push-laptop-${process.pid}.jsonl`)
  fs.rmSync(pushedL, { force: true })
  const laptop = await kitWith('Laptop', rb, { BRIDGE_TEST_SCREEN: 'fake', BRIDGE_TEST_PUSH: pushedL })
  ok(!!(await until(async () => (await studio.api('/relay')).online && (await laptop.api('/relay')).online, 20000)), 'each is connected to its own relay')
  await laptop.api('/machines', { link: `${ra.url} ${(await studio.api('/relay/pair', {})).pairing.code}` })
  const S = await until(async () => (await laptop.api('/machines')).machines.find((m) => m.name === 'Studio' && m.online), 30000, 300)
  ok(!!S && !!(await until(async () => (await studio.api('/machines')).machines.find((m) => m.name === 'Laptop' && m.online), 30000, 300)), 'Laptop and Studio are linked')
  const ph = over(await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Phone', about: { name: 'Phone' } }))
  const ph2 = over(await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Phone2', about: { name: 'Phone2' } }))
  const pk = over(await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Pocket', about: { name: 'Pocket' } }))
  const devs = await until(async () => { const d = (await studio.api('/remote')).access.devices; return ['Phone', 'Phone2', 'Laptop'].every((n) => d.some((x) => x.name === n)) ? d : null }, 8000, 200)
  const PHONE = devs.find((d) => d.name === 'Phone').id
  const PHONE2 = devs.find((d) => d.name === 'Phone2').id
  const LAPTOP = devs.find((d) => d.name === 'Laptop').id
  const POCKET = (await until(async () => (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Pocket'), 8000, 200)).id
  ok(devs.every((d) => d.allowed) && !devs.some((d) => d.fresh), 'paired before any guardrail: every device may connect')
  await studio.api('/remote/password', { password: PW })
  const idle = () => until(async () => !(await studio.api('/remote')).sessions.length, 6000, 100)
  const V = '/api/remote/view?source=screen:'
  // A device of Laptop's, seen at Studio through Laptop (once it asks something there), and let in
  // there when it's New: its entry as it was first listed.
  const letInVia = async (dev, name) => {
    await dev.request('GET', `/m/${S.id}/api/fleet`)
    const e = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === name && d.through === 'Laptop'), 6000, 200)
    if (e && !e.allowed) await studio.api('/remote/devices', { id: e.id, allowed: true })
    return e
  }

  // ---------- the lockout, raced ----------
  await part('wrong passwords at once can\'t get past the lockout', async () => {
    const at = [ph.socket(V), ph.socket(V), ph.socket(V)]
    await Promise.all(at.map((v) => v.wait((s) => msg(s, 'password') || msg(s, 'error'))))
    const busy = at.filter((v) => msg(v, 'error')?.code === 'busy')
    ok(busy.length === 1 && at.filter((v) => msg(v, 'password')).length === 2, 'one device has two sessions waiting at the password at most', at.map((v) => msg(v, 'error')?.code || 'password'))
    let open = at.filter((v) => !msg(v, 'error'))
    let wrong = 0
    let locked = null
    for (let round = 0; round < 8 && !locked; round++) {
      while (open.length < 2) { const v = ph.socket(V); await v.wait((s) => msg(s, 'password') || msg(s, 'error')); if (msg(v, 'error')) { locked = msg(v, 'error'); break } open.push(v) }
      if (locked) break
      const before = new Map(open.map((v) => [v, msgs(v, 'password').length]))
      await Promise.all(open.map((v, i) => v.send({ t: 'password', p: `guess-${round}-${i}` })))
      await Promise.all(open.map((v) => v.wait((s) => msgs(s, 'password').length > before.get(v) || msg(s, 'error'), 8000)))
      for (const v of open) { if (msg(v, 'error')?.code === 'locked') locked = msg(v, 'error'); else if (msgs(v, 'password').at(-1)?.wrong) wrong++ }
      open = open.filter((v) => !msg(v, 'error'))
    }
    const lock = JSON.parse(fs.readFileSync(path.join(studio.data, 'remote.json'), 'utf8')).locks[PHONE]
    ok(!!locked && wrong <= ACCESS.tries - 1 && lock?.fails === ACCESS.tries, `guessed two at a time, it's locked out after ${ACCESS.tries} wrong in all (${wrong} said wrong, then locked), each counted before it was checked`, { wrong, lock })
    const until0 = lock?.until
    ok(until0 - Date.now() > 14 * 60000, 'for 15 minutes', until0 && new Date(until0).toISOString())
    for (const v of open) await v.close()
    const right = ph.socket(V)
    await right.wait((s) => msg(s, 'error') || msg(s, 'password'))
    ok(msg(right, 'error')?.code === 'locked' && !msg(right, 'password'), 'then even the right password isn\'t asked for', msg(right, 'error'))
    await Promise.all([ph.socket(V), ph.socket(V)].map((v) => v.wait((s) => msg(s, 'error'))))
    ok(JSON.parse(fs.readFileSync(path.join(studio.data, 'remote.json'), 'utf8')).locks[PHONE]?.until === until0, 'and trying again doesn\'t end the lockout early')
    await studio.api(`/remote/locks/${encodeURIComponent(PHONE)}/clear`, {})
    const back = ph.socket(V)
    ok(!!(await through(back)) && msg(back, 'password')?.left === ACCESS.tries, 'Unlock at Studio: its tries again, and the right password gets in')
    await back.close()
    await idle()
  })

  await part('many turned away don\'t push a session out of Screen Activity', async () => {
    const v = ph.socket(V)
    const h = await through(v)
    await v.close()
    await idle()
    await studio.api('/remote/devices', { id: PHONE2, allowed: false })
    for (let i = 0; i < 25; i++) { const x = ph2.socket(V); await x.wait((s) => msg(s, 'error')) }
    const st = await studio.api('/remote')
    const lines = st.log.filter((e) => e.end === 'device' && e.by.name === 'Phone2')
    ok(lines.length === 1 && lines[0].count >= 25, 'the same again from one device is one line, counting them', lines.map((e) => e.count))
    ok(st.log.some((e) => e.id === h?.session), 'and the session before it is still in the record', st.log.length)
    const kept = JSON.parse(fs.readFileSync(path.join(studio.data, 'remote.json'), 'utf8'))
    ok(kept.log.some((e) => e.id === h?.session) && kept.refused.every((e) => !e.source), 'kept apart from those turned away', { log: kept.log.length, refused: kept.refused.length })
    await studio.api('/remote/devices', { id: PHONE2, allowed: true })
  })

  // ---------- Which Devices May Connect ----------
  await part('through a linked computer, its own list and lockout first', async () => {
    await laptop.api('/remote/devices', { id: POCKET, allowed: false })
    const v = pk.socket(`/m/${S.id}${V}`)
    await v.wait((s) => msg(s, 'error'))
    ok(msg(v, 'error')?.code === 'device' && /Laptop doesn't let Pocket connect/.test(msg(v, 'error').why) && !msg(v, 'password'), 'Pocket, unticked at Laptop, can\'t reach Studio\'s screen through it', msg(v, 'error'))
    ok(!(await studio.api('/remote')).log.some((e) => e.for === 'Pocket'), 'it never reached Studio')
    await laptop.api('/remote/devices', { id: POCKET, allowed: true })
    // First seen at Studio through Laptop, with Studio's password set: New there, let in at Studio.
    const pkAt = await letInVia(pk, 'Pocket')
    ok(pkAt?.fresh === true && pkAt.through === 'Laptop', 'Pocket, first seen at Studio through Laptop with a password set: New there, until let in at Studio', pkAt)
    // Wrong passwords through Laptop: that device locked out through it, never Laptop itself.
    for (let i = 0; i < ACCESS.tries; i++) {
      const x = pk.socket(`/m/${S.id}${V}`)
      await x.wait((s) => msg(s, 'password'))
      await x.send({ t: 'password', p: `wrong-${i}` })
      await x.wait((s) => msgs(s, 'password').length > 1 || msg(s, 'error'))
      await x.close()
    }
    const st = await studio.api('/remote')
    const lk = st.access.locks.find((l) => l.for === 'Pocket')
    ok(!!lk && lk.id === `${LAPTOP}/${POCKET}` && lk.name === 'Laptop', 'Studio keeps that lockout for Laptop and Pocket together', st.access.locks)
    ok(!st.access.devices.find((d) => d.id === LAPTOP)?.locked, 'not for Laptop')
    const lv = local(laptop, `/m/${S.id}${V}`)
    ok(!!(await through(lv)), 'Laptop\'s own user still gets in')
    lv.close()
    await idle()
    await studio.api(`/remote/locks/${encodeURIComponent(lk.id)}/clear`, {})
    // And locked out at Laptop: not on through it either.
    await laptop.api('/remote/password', { password: PW })
    for (let i = 0; i < ACCESS.tries; i++) {
      const x = pk.socket(V)
      await x.wait((s) => msg(s, 'password'))
      await x.send({ t: 'password', p: `wrong-${i}` })
      await x.wait((s) => msgs(s, 'password').length > 1 || msg(s, 'error'))
      await x.close()
    }
    const on = pk.socket(`/m/${S.id}${V}`)
    await on.wait((s) => msg(s, 'error') || msg(s, 'password'))
    ok(msg(on, 'error')?.code === 'locked', 'Pocket locked out at Laptop: not on to Studio through it', msg(on, 'error'))
    await laptop.api(`/remote/locks/${encodeURIComponent(POCKET)}/clear`, {})
    await laptop.api('/remote/password', { remove: true })
    // Looking at Studio through Laptop, unticked at Laptop: cut off.
    const w = pk.socket(`/m/${S.id}${V}`)
    await through(w)
    await w.wait((s) => s.frames.length, 5000)
    const seen = (await studio.api('/remote')).sessions.find((x) => x.for === 'Pocket')
    ok(!!seen && seen.by.name === 'Laptop', 'Studio\'s sessions say both: Laptop, for Pocket', seen && { by: seen.by.name, for: seen.for })
    await laptop.api('/remote/devices', { id: POCKET, allowed: false })
    await w.wait((s) => msg(s, 'error') && s.closed, 5000)
    ok(msg(w, 'error')?.code === 'device' && !!(await idle()), 'unticked at Laptop while it looks: its session through Laptop ends', msg(w, 'error'))
    await laptop.api('/remote/devices', { id: POCKET, allowed: true })
  })

  await part('unticked while at the password, or waiting for Allow', async () => {
    const v = ph.socket(V)
    await v.wait((s) => msg(s, 'password'))
    await studio.api('/remote/devices', { id: PHONE, allowed: false })
    await v.wait((s) => msg(s, 'error'), 4000)
    await v.send({ t: 'password', p: PW })
    await sleep(600)
    ok(msg(v, 'error')?.code === 'device' && !msg(v, 'hello') && !v.frames.length, 'at the password: it ends there, and the password typed after gets nothing', msg(v, 'error'))
    await studio.api('/remote/devices', { id: PHONE, allowed: true })
    await studio.api('/remote/ask-first', { on: true })
    const a = ph.socket(V)
    await a.wait((s) => msg(s, 'password'))
    await a.send({ t: 'password', p: PW })
    await a.wait((s) => msg(s, 'asking'))
    await studio.api('/remote/devices', { id: PHONE, allowed: false })
    await a.wait((s) => msg(s, 'error'), 4000)
    ok(msg(a, 'error')?.code === 'device' && !(await studio.api('/remote')).asks.length && !msg(a, 'hello'), 'waiting for Allow: the ask goes, and it ends', msg(a, 'error'))
    await studio.api('/remote/ask-first', { on: false })
    await studio.api('/remote/devices', { id: PHONE, allowed: true })
  })

  await part('a device paired once a guardrail is set starts unticked', async () => {
    // (Its name says it's someone else, with a character that turns text around.)
    const RLO = String.fromCharCode(0x202e)
    const p3 = over(await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: `Phone3${RLO}x`, about: { name: `Phone3${RLO}x` } }))
    const d = await until(async () => (await studio.api('/remote')).access.devices.find((x) => x.name.startsWith('Phone3')), 8000, 200)
    ok(d && !d.allowed && d.fresh, 'with a password set, a phone paired after it isn\'t let connect until it\'s ticked here', d)
    ok(d?.name === 'Phone3x', 'and its name comes without what turns text around', d?.name)
    const v = p3.socket(V)
    await v.wait((s) => msg(s, 'error'))
    ok(msg(v, 'error')?.code === 'device' && !msg(v, 'password'), 'so it\'s turned away', msg(v, 'error'))
    // A paired phone linking a computer of its own choosing: that computer starts unticked too.
    const rc = await startRelay('sec-other')
    relays.push(rc)
    const other = await kitWith('Other', rc)
    await until(async () => (await other.api('/relay')).online, 20000)
    await ph.request('POST', '/api/machines', { link: `${rc.url} ${(await other.api('/relay/pair', {})).pairing.code}` })
    const o = await until(async () => (await studio.api('/remote')).access.devices.find((x) => x.name === 'Other'), 30000, 300)
    ok(o && !o.allowed && o.fresh, 'a computer a phone links to Studio starts unticked too', o)
    const OS = await until(async () => (await other.api('/machines')).machines.find((m) => m.name === 'Studio' && m.online), 30000, 300)
    const ov = local(other, `/m/${OS?.id}${V}`)
    await ov.wait((s) => msg(s, 'error') || msg(s, 'password'), 10000)
    ok(msg(ov, 'error')?.code === 'device', 'and can\'t open Studio\'s screen', msg(ov, 'error'))
    ov.close()
    await studio.api('/remote/devices', { id: d.id, allowed: true })
    const t = p3.socket(V)
    ok(!!(await through(t)) && !(await studio.api('/remote')).access.devices.find((x) => x.id === d.id).fresh, 'ticked here: it may, and it isn\'t new any more')
    await t.close()
    await idle()
    p3.stop()
  })

  // ---------- Ask Here First: what was allowed ----------
  await part('Ask Here First: control is asked for, and asked again after it went idle', async () => {
    await studio.api('/remote/control', { on: true })
    await studio.api('/remote/ask-first', { on: true })
    const v = ph.socket(V) // to view only
    await v.wait((s) => msg(s, 'password'))
    await v.send({ t: 'password', p: PW })
    await v.wait((s) => msg(s, 'asking'))
    const a = await until(async () => (await studio.api('/remote')).asks[0], 4000, 100)
    ok(a && a.control === false && a.by.kind === 'phone' && !a.for, 'Studio is asked to let Phone (a phone, straight to it) view', a)
    await studio.api(`/remote/asks/${a.id}`, { allow: true })
    await v.wait((s) => msg(s, 'hello'))
    ok(msg(v, 'hello').control.allowed === false, 'allowed to view, not to control')
    const n = lines(inputs).length
    const take = async (answer) => {
      const c = msgs(v, 'control').length
      await v.send({ t: 'control', on: true })
      const q = await until(async () => (await studio.api('/remote')).asks[0], 4000, 100)
      if (q && answer != null) await studio.api(`/remote/asks/${q.id}`, { allow: answer })
      await v.wait((s) => msgs(s, 'control').length > c, 6000)
      return { q, said: msgs(v, 'control').at(-1) }
    }
    const no = await take(false)
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.5, y: 0.5 }, { t: 'down', b: 0, x: 0.5, y: 0.5 }] })
    await sleep(500)
    ok(no.q?.control === true && no.said?.allowed === false && lines(inputs).length === n, 'control asked for: Studio is asked again; told no, nothing is pressed', { ask: no.q, said: no.said })
    const yes = await take(true)
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.5, y: 0.5 }] })
    ok(yes.said?.allowed === true && !!(await until(() => lines(inputs).length > n, 3000, 100)), 'allowed there: control', yes.said)
    // Nothing pressed for a while (4 s here): view only; taken back, the password and Allow again.
    await v.wait((s) => msgs(s, 'control').some((m) => m.idle), 9000)
    const pw0 = msgs(v, 'password').length
    await v.send({ t: 'control', on: true })
    await v.wait((s) => msgs(s, 'password').length > pw0)
    ok(msgs(v, 'password').at(-1)?.again === true, 'after it went idle, taking it back asks for the password again', msgs(v, 'password').at(-1))
    await v.send({ t: 'password', p: 'not it' })
    await v.wait((s) => msgs(s, 'password').length > pw0 + 1)
    await v.send({ t: 'password', p: PW })
    await v.wait((s) => msgs(s, 'asking').length > 1)
    const again = await until(async () => (await studio.api('/remote')).asks[0], 4000, 100)
    ok(again?.control === true, 'and Allow at Studio again', again)
    const c0 = msgs(v, 'control').length
    await studio.api(`/remote/asks/${again.id}`, { allow: true })
    await v.wait((s) => msgs(s, 'control').length > c0)
    ok(msgs(v, 'control').at(-1)?.allowed === true, 'then it has control again')
    await v.close()
    await idle()
    await studio.api('/remote/ask-first', { on: false })
    await studio.api('/remote/control', { on: false })
  })

  // ---------- what a device is told ----------
  await part('a device is told its own standing, not the record', async () => {
    const lv = local(laptop, `/m/${S.id}/api/remote/view?source=window:fake-w1`)
    await through(lv)
    await lv.wait((s) => s.frames.length, 5000)
    const st = (await ph2.request('GET', '/api/remote?sources=1')).json
    ok(st && !('sessions' in st) && !('log' in st) && !('asks' in st) && !('unseen' in st) && !st.access.devices && !st.access.locks, 'a phone asking isn\'t told who looks, the record, what\'s asked here, nor the other devices', st && Object.keys(st))
    ok(st?.access.you?.allowed === true && st.access.password === true && !st.screen.sources?.length && st.notify?.on === true && !st.notify.devices && !st.notify.computers, 'only its own standing; behind a password, not even which screens (Which screen? comes in the session), nor where notifications go', { access: st?.access, sources: st?.screen.sources, notify: st?.notify })
    // The cards (who's viewing a screen of yours): which computer, which device, its kind and how it
    // came, since when; never what's on it.
    const card = (await ph2.request('GET', '/api/remote/live')).json?.list || []
    const mine = card.find((x) => x.machine === null && x.by.name === 'Laptop')
    const keys = new Set(['id', 'by', 'for', 'forKind', 'control', 'controlled', 'started', 'machine', 'computer', 'ask'])
    ok(!!mine && card.every((x) => Object.keys(x).every((k) => keys.has(k))) && !JSON.stringify(card).includes('Test window') && mine.computer === 'Studio' && mine.by.kind === 'computer', 'the card a phone gets: who, from which computer, how it came and since when; no window titles, no record', card)
    const here = await studio.api('/remote')
    ok(here.sessions.length === 1 && here.log.length > 0 && here.access.devices.length >= 3, 'Studio itself sees all of it')
    lv.close()
    await idle()
  })

  await part('Which screen?\'s stills only in a session, past the password', async () => {
    const v = ph.socket(V)
    await v.wait((s) => msg(s, 'password'))
    await v.send({ t: 'thumbs?' })
    await sleep(600)
    ok(!msg(v, 'thumb') && !msg(v, 'hello'), 'asked for at the password: none come', v.msgs.map((m) => m.t))
    const h = await through(v)
    await v.send({ t: 'thumbs?' })
    await v.wait((s) => msgs(s, 'thumb').length >= 2, 5000)
    ok(!!h && msgs(v, 'thumb').every((m) => /^data:image\//.test(m.data) && h.sources.some((x) => x.id === m.id && x.kind === 'screen')), 'in the session: a still of each screen', msgs(v, 'thumb').length)
    await v.close()
    await idle()
  })

  await part('Block This Device from a phone, on a device that came through Laptop', async () => {
    const w = pk.socket(`/m/${S.id}${V}`)
    await through(w)
    const s = await until(async () => (await studio.api('/remote')).sessions.find((x) => x.for === 'Pocket'), 5000, 100)
    const r = await ph.request('POST', `/api/remote/sessions/${s?.id}/end`, { block: true })
    await w.wait((x) => msg(x, 'error') || x.closed, 6000)
    const onLaptop = (await laptop.api('/remote')).access.devices.find((d) => d.id === POCKET)
    ok(r.json?.ok === true && onLaptop?.allowed === false && (await studio.api('/remote')).access.devices.find((d) => d.id === LAPTOP)?.allowed, 'Pocket is unticked at Laptop, the computer it came through; Laptop itself still may connect to Studio', [r.json, onLaptop])
    const again = pk.socket(`/m/${S.id}${V}`)
    await again.wait((x) => msg(x, 'error'))
    ok(msg(again, 'error')?.code === 'device' && /Laptop doesn't let Pocket/.test(msg(again, 'error').why), 'so it can\'t come through Laptop again: Laptop turns it away itself', msg(again, 'error'))
    // With a device unticked at Laptop, one paired there after it starts unticked too.
    const pk2 = over(await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Pocket2', about: { name: 'Pocket2' } }))
    const d2 = await until(async () => (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Pocket2'), 8000, 200)
    const v2 = pk2.socket(`/m/${S.id}${V}`)
    await v2.wait((x) => msg(x, 'error') || msg(x, 'password'), 8000)
    ok(d2 && !d2.allowed && d2.fresh && msg(v2, 'error')?.code === 'device', 'and a phone paired with Laptop after that starts unticked there, so it doesn\'t reach Studio through it either', [d2, msg(v2, 'error')])
    pk2.stop()
    await laptop.api('/remote/devices', { id: POCKET, allowed: true })
    await idle()
  })

  // ---------- previews ----------
  await part('previews: only an agent terminal\'s server, past the password, never as Bridge AI', async () => {
    const DEV = 'require("http").createServer((q, r) => { r.setHeader("content-type", "text/html"); r.setHeader("clear-site-data", "\\"cookies\\""); r.end("<p>app " + q.url + "</p>") }).listen(Number(process.argv[2]), "127.0.0.1")'
    const project = path.join(studio.home, 'webapp')
    fs.mkdirSync(project, { recursive: true })
    fs.writeFileSync(path.join(project, 'dev.cjs'), DEV)
    // Started by an agent's terminal in its project; one in the home folder (as Install's is); one by no terminal.
    const inPane = async (cwd, port) => {
      const pane = (await studio.api('/agents/launch', { kind: 'shell', cwd, label: 'Dev' })).paneId
      await sleep(800)
      await studio.api(`/panes/${encodeURIComponent(pane)}/text`, { text: typed([process.execPath, path.join(project, 'dev.cjs'), port]), enter: true })
      return pane
    }
    const P = await freePort()
    await inPane(project, P)
    const H = await freePort()
    await inPane(studio.home, H)
    const N = await freePort()
    procs.push(spawn(process.execPath, [path.join(project, 'dev.cjs'), String(N)], { cwd: project, stdio: 'ignore' }))
    ok(!!(await until(async () => { for (const p of [P, H, N]) if (!(await fetch(`http://127.0.0.1:${p}/`).then((r) => r.ok, () => false))) return false; return true }, 15000, 200)), 'three servers run on Studio')
    const ask = (port) => fetch(`${laptop.url}/api/machines/${S.id}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ port }) }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
    const [p, h, n] = [await ask(P), await ask(H), await ask(N)]
    ok(h.code === 'refused' && /isn't one of the apps/.test(h.error) && n.code === 'refused', 'one a terminal in the home folder started, or none did: not one of its apps', { h, n })
    ok(p.code === 'gate', 'one an agent\'s terminal started in its project: one of its apps, once past the password', p)
    // A phone: through the link beside its page, only with a session for that app open.
    const no = await ph.request('GET', `/_preview/${P}/x`)
    ok(no.status === 403 && no.json?.code === 'gate', 'a phone without one is refused', no.json)
    const g = ph.socket(`/api/remote/view?source=preview:${P}`)
    const gh = await through(g)
    ok(gh?.grant === true && !g.frames.length, 'a session for the app, past the password', gh)
    const yes = await ph.request('GET', `/_preview/${P}/x`)
    const head = (k) => yes.headers.find(([x]) => x.toLowerCase() === k)?.[1]
    ok(yes.status === 200 && /^sandbox /.test(head('content-security-policy') || '') && !/allow-same-origin/.test(head('content-security-policy')) && !head('clear-site-data'), 'then it comes, in a sandbox (an origin of no one\'s), and can\'t clear anything', yes.headers)
    await g.close()
    ok(!!(await until(async () => (await ph.request('GET', `/_preview/${P}/x`)).status === 403, 4000, 200)), 'closed: refused again')
    // A page session (pictures) is behind the password too.
    const pg = ph.socket(`/api/remote/view?source=page:${P}&w=390&h=700`)
    await pg.wait((s) => msg(s, 'password') || msg(s, 'hello'))
    ok(!!msg(pg, 'password') && !msg(pg, 'hello'), 'its pictures on a phone: the password first', pg.msgs.map((m) => m.t))
    await pg.close()
    // Laptop: a session through its link, then its address of its own (as Preview.jsx does).
    const lg = local(laptop, `/m/${S.id}/api/remote/view?source=preview:${P}`)
    await through(lg)
    const a = await ask(P)
    const page = a.url ? await fetch(`${a.url}x`) : null
    ok(!!a.url && page?.status === 200 && !page.headers.get('clear-site-data') && !/sandbox/.test(page.headers.get('content-security-policy') || ''), 'Laptop, past it: the app at an address of its own, as it is (a site of its own there)', a)
    lg.close()
    const under = await fetch(`${laptop.url}/m/${S.id}/_preview/${P}/x`)
    ok(under.status === 404 && (await under.json()).code === 'preview', 'never under Laptop\'s own address, where it would run as Bridge AI', under.status)
    // Ask Here First names the app.
    await studio.api('/remote/password', { remove: true })
    await studio.api('/remote/ask-first', { on: true })
    const q = ph.socket(`/api/remote/view?source=page:${P}`)
    await q.wait((s) => msg(s, 'asking'))
    const qa = (await studio.api('/remote')).asks[0]
    ok(qa?.port === P, 'Ask Here First says which app', qa)
    await studio.api(`/remote/asks/${qa.id}`, { allow: false })
    await studio.api('/remote/ask-first', { on: false })
    await studio.api('/remote/password', { password: PW })
    await q.close()
  })

  // ---------- Which Devices May Connect, for everything ----------
  // A terminal of Studio's own, in a folder with a file in it.
  const shellDir = path.join(studio.home, 'letin')
  fs.mkdirSync(shellDir, { recursive: true })
  fs.writeFileSync(path.join(shellDir, 'notes.txt'), 'only for devices let in')
  const SHELL = (await studio.api('/agents/launch', { kind: 'shell', cwd: shellDir, label: 'Shell' })).paneId
  const ATTACH = `/api/panes/${encodeURIComponent(SHELL)}/attach?cols=80&rows=24`
  // Studio's answer to a device it hasn't let in: which computer and where, nothing more.
  const shut = (r, computer = 'Studio') => r.status === 403 && r.json?.code === 'notLetIn' && r.json.computer === computer && /hasn't let/.test(r.json.error) && /Settings › Remote Access › Which Devices May Connect/.test(r.json.error)

  await part('unticked, a device gets nothing of this computer\'s: agents, terminals, files, events, previews', async () => {
    await studio.api('/remote/devices', { id: PHONE2, allowed: false })
    const launch = await ph2.request('POST', '/api/agents/launch', { kind: 'shell', cwd: shellDir, label: 'Unticked try' })
    ok(shut(launch) && launch.json.error === "Studio hasn't let this device in. On Studio: Settings › Remote Access › Which Devices May Connect.", 'launch: refused, saying Studio hasn\'t let it in and where that\'s changed', launch.json)
    ok(!JSON.stringify(await studio.api('/fleet')).includes('Unticked try'), 'and nothing was launched')
    const t = ph2.socket(ATTACH, { term: true })
    await t.wait((x) => x.closed, 6000)
    ok(t.msgs.length === 1 && t.msgs[0].type === 'error' && t.msgs[0].code === 'notLetIn' && !t.text, 'attach: its terminal says why and closes, with nothing of the pane', [t.msgs, t.text.slice(0, 80)])
    const file = await ph2.request('GET', `/api/agents/${encodeURIComponent(SHELL)}/file?path=notes.txt`)
    const dl = await ph2.request('GET', `/api/agents/${encodeURIComponent(SHELL)}/raw?path=notes.txt`)
    const list = await ph2.request('GET', `/api/agents/${encodeURIComponent(SHELL)}/files?path=`)
    ok(shut(file) && shut(dl) && shut(list) && ![file, dl, list].some((r) => r.text.includes('only for devices')), 'files: not read, downloaded or listed', [file.status, dl.status, list.status])
    const send = await ph2.request('POST', '/api/transfers/in', { key: 'unticked-send', name: 'in.txt', files: [{ size: 3 }], to: { where: 'pane', pane: SHELL } })
    const copy = await ph2.request('POST', '/api/transfers', { from: S.id, src: { pane: 'x', path: 'y' } })
    ok(shut(send) && shut(copy) && !fs.readdirSync(shellDir).some((f) => f.includes('in.txt')), 'Send to and Copy to this computer: refused, nothing written', [send.status, copy.status])
    // (A feed let through never ends: it's given 5 s.)
    const ev = await Promise.race([ph2.request('GET', '/api/events'), sleep(5000).then(() => ({ status: 'still open' }))])
    ok(shut(ev), 'events: refused, not a feed', ev.status)
    const pv = await ph2.request('GET', '/_preview/5173/')
    ok(shut(pv), 'previews: refused', pv.json)
    const pg = ph2.socket('/api/remote/view?source=page:5173&w=390&h=700')
    const sc = ph2.socket(V)
    await Promise.all([pg, sc].map((x) => x.wait((y) => msg(y, 'error'))))
    ok(msg(pg, 'error')?.code === 'device' && msg(sc, 'error')?.code === 'device' && !msg(sc, 'password'), 'a page session and the screen: turned away by the screen itself, as before', [msg(pg, 'error'), msg(sc, 'error')])
    const later = await ph2.request('GET', '/api/a-route-added-later')
    ok(shut(later), 'and a route nobody has written yet: refused too, not a 404', later.status)
    // The app's own files are let through by their plain names only: not a route in other capitals
    // that ends in one, encoded; nor, with no key at all, as if public.
    const odd = ['/API/crashes/sent/..%2F..%2F..%2Fsw.js', '/API/meetings/nope/captures/..%2F..%2F..%2F..%2Fsw.js', '/assets/..%2Fsw.js']
    const odds = await Promise.all(odd.map((u) => ph2.request('GET', u)))
    ok(odds.every((r) => shut(r)), 'a route in other capitals ending in an encoded built file: refused', odds.map((r) => [r.status, r.json]))
    const sw = await ph2.request('GET', '/sw.js')
    ok(sw.status === 200, 'a built file by its own name still loads', sw.status)
    const nokey = await Promise.all([{}, { 'sec-fetch-site': 'cross-site' }].map((h) => raw(studio, 'GET', odd[0], { headers: { host: `127.0.0.1:${studio.port}`, ...h } })))
    ok(nokey.every((r) => r.status === 401 || r.status === 403), 'and with no key, it isn\'t public', nokey.map((r) => r.status))
    // What it may still do: load the app's page (to say so), be told, and unpair itself.
    const pageOf = await ph2.request('GET', '/')
    ok(pageOf.status === 200 && /<div id="root">/.test(pageOf.text), 'the app\'s own page still loads, to show why', pageOf.status)
    const told = await ph2.request('GET', '/api/relay')
    ok(shut(told) && told.json.here === PHONE2 && Object.keys(told.json).sort().join() === 'code,computer,error,here', 'GET /api/relay: told it isn\'t let in, with its own id (to forget Studio), nothing of the relay', told.json && Object.keys(told.json))
    // This computer itself never is; a browser through Tailscale isn't a paired device, but one
    // that says it's an unticked device is that device.
    ok(!!(await studio.api('/fleet')), 'Studio itself: never refused')
    const ts = { host: TS, 'tailscale-user-login': OWNER, authorization: `Bearer ${studio.key}` }
    const tsOwn = await raw(studio, 'GET', '/api/fleet', { headers: ts })
    const tsAs = await raw(studio, 'GET', '/api/fleet', { headers: { ...ts, 'x-bridge-relay': PHONE2 } })
    ok(tsOwn.status === 200 && shut(tsAs), 'through Tailscale: not this computer, and as an unticked device, refused', [tsOwn.status, tsAs.status])
    // The Beta Feature is a guardrail too: switched at Studio itself only, by either way of changing
    // the settings, from a device, another computer's window or Tailscale.
    const trial = async () => (await studio.api('/settings')).effective.trials['remote-screen']
    const fromPhone = await ph.request('PATCH', '/api/settings', { trials: { 'remote-screen': false } })
    const gone0 = await ph.request('PATCH', '/api/settings', { trials: null })
    const rawOff = await ph.request('PUT', '/api/settings/raw', { text: JSON.stringify({ ...(await studio.api('/settings')).user, trials: {} }) })
    const fromLaptop = await fetch(`${laptop.url}/m/${S.id}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ trials: { 'remote-screen': false } }) })
    const fromTs = await raw(studio, 'PATCH', '/api/settings', { headers: ts, body: { trials: { 'remote-screen': false } } })
    ok([fromPhone.status, gone0.status, rawOff.status, fromLaptop.status, fromTs.status].every((x) => x === 403) && await trial() === true, 'Remote Screen and Preview can\'t be turned off from a phone (nor its settings file, nor trials taken away), Laptop\'s window or Tailscale', [fromPhone.status, gone0.status, rawOff.status, fromLaptop.status, fromTs.status])
    ok((await ph.request('PATCH', '/api/settings', { trials: { home: false } })).status === 200, 'another Beta Feature still changes from a phone')
    // Turned off at Studio: one you unticked stays out; a New one is let in until it's on again.
    const p5 = over(await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Phone5', about: { name: 'Phone5' } }))
    const d5 = await until(async () => (await studio.api('/remote')).access.devices.find((x) => x.name === 'Phone5'), 8000, 200)
    ok(d5?.fresh && !d5.out && shut(await p5.request('GET', '/api/fleet')), 'Phone5, paired with a password set: New, waiting')
    await studio.api('/settings', { trials: { 'remote-screen': false } }, 'PATCH')
    const off = await ph2.request('GET', '/api/fleet')
    const offFile = await ph2.request('GET', `/api/agents/${encodeURIComponent(SHELL)}/file?path=notes.txt`)
    const offNew = await p5.request('GET', '/api/fleet')
    const listed = (await studio.api('/remote')).access.devices.find((x) => x.id === PHONE2)
    await studio.api('/settings', { trials: { 'remote-screen': true } }, 'PATCH')
    const on = await ph2.request('GET', '/api/fleet')
    const onNew = await p5.request('GET', '/api/fleet')
    ok(shut(off) && shut(offFile) && listed?.out === true && shut(on), 'Phone2, unticked: still refused with Remote Screen and Preview off at Studio, and listed as kept out (for Settings to show with Allow)', [off.status, offFile.status, listed])
    ok(offNew.status === 200 && shut(onNew), 'Phone5, New: let in while it\'s off, waiting again once it\'s on', [offNew.status, onNew.status])
    await p5.request('DELETE', `/api/relay/devices/${encodeURIComponent(d5.id)}`)
    p5.stop()
    // None of Studio's notifications either.
    await ph.request('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/phone', keys: { p256dh: 'p', auth: 'a' } }, label: 'Phone' })
    await studio.api('/remote/devices', { id: PHONE2, allowed: true })
    await ph2.request('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/phone2', keys: { p256dh: 'p', auth: 'a' } }, label: 'Phone2' })
    await studio.api('/remote/devices', { id: PHONE2, allowed: false })
    const n0 = lines(pushed).length
    await studio.api('/push/test', {})
    const sent = lines(pushed).slice(n0).map((x) => x.device)
    ok(sent.includes(PHONE) && !sent.includes(PHONE2), 'a notification goes to Phone, not to Phone2 while it\'s unticked', sent)
    // Unpaired by itself: its Bridge AI asks for its id, then removes itself.
    const gone = await ph2.request('DELETE', `/api/relay/devices/${encodeURIComponent(PHONE2)}`)
    ok(gone.status === 200 && !(await studio.api('/relay')).devices.some((d) => d.id === PHONE2), 'and it can still unpair itself', gone.status)
    ph2.stop()
  })

  await part('unticked while a terminal, the app\'s feed and a copy are open: each ends then', async () => {
    const t = ph.socket(ATTACH, { term: true })
    await t.wait((x) => x.opened, 6000)
    await t.send({ type: 'input', data: 'echo letin-on\r' })
    const screen = async () => JSON.stringify(await studio.api(`/agents/${encodeURIComponent(SHELL)}/screen?lines=40`))
    ok(!!(await t.wait((x) => /letin-on/.test(x.text), 10000)) && !!(await until(async () => (await screen()).includes('letin-on'), 5000, 200)), 'Phone, let in: its terminal on Studio is live, and what it types is on the pane', t.text.slice(-120))
    let fed = null
    ph.request('GET', '/api/events').then((r) => { fed = r })
    const begun = await ph.request('POST', '/api/transfers/in', { key: 'letin-copy', name: 'photo.txt', files: [{ size: 10 }], to: { where: 'pane', pane: SHELL } })
    const parts = () => fs.readdirSync(shellDir).filter((f) => f.endsWith('.part'))
    ok(begun.status === 200 && parts().length === 1, 'a copy from it is coming in', begun.json)
    await sleep(500)
    const t0 = Date.now()
    await studio.api('/remote/devices', { id: PHONE, allowed: false })
    await t.wait((x) => x.closed, 5000)
    ok(!!t.closed && Date.now() - t0 < 5000, 'unticked: its terminal closes then', t.closed)
    await t.send({ type: 'input', data: 'echo letin-after\r' })
    await sleep(500)
    ok(!(await screen()).includes('letin-after'), 'and nothing typed after reaches the pane')
    ok(!!(await until(() => fed, 5000, 50)) && !!fed.error, 'the app\'s feed through its link ends, told why', fed)
    ok(!!(await until(() => !parts().length, 5000, 100)) && !(await studio.api('/transfers')).incoming.some((x) => x.name === 'photo.txt'), 'the copy it was sending is let go, and what came of it thrown away', parts())
    const again = ph.socket(ATTACH, { term: true })
    await again.wait((x) => x.closed, 6000)
    ok(again.msgs[0]?.code === 'notLetIn' && !again.text, 'opened again: refused', again.msgs)
    await studio.api('/remote/devices', { id: PHONE, allowed: true })
    const back = await ph.request('GET', '/api/fleet')
    ok(back.status === 200, 'ticked again: it may', back.status)
  })

  await part('through a linked computer: its own list first, then this one checks that computer', async () => {
    // Pocket, unticked at Laptop: nothing of Laptop's, nor of Studio's through Laptop.
    await laptop.api('/remote/devices', { id: POCKET, allowed: false })
    const own = await pk.request('GET', '/api/fleet')
    const on = await pk.request('GET', `/m/${S.id}/api/fleet`)
    const term = pk.socket(`/m/${S.id}${ATTACH}`, { term: true })
    await term.wait((x) => x.closed, 6000)
    ok(shut(own, 'Laptop') && shut(on, 'Laptop') && term.msgs[0]?.code === 'notLetIn' && term.msgs[0].computer === 'Laptop' && !term.text, 'Pocket, unticked at Laptop: Laptop turns it away, from Laptop\'s things and from Studio\'s through it', [own.json, on.json, term.msgs])
    await laptop.api('/remote/devices', { id: POCKET, allowed: true })
    // Laptop unticked at Studio: Laptop gets nothing of Studio's, nor does Pocket through it.
    await studio.api('/remote/devices', { id: LAPTOP, allowed: false })
    const via = await pk.request('GET', `/m/${S.id}/api/fleet`)
    ok(shut(via) && via.json.through === 'Laptop' && /Studio hasn't let Laptop in, which this device comes through/.test(via.json.error), 'Pocket through Laptop: Studio says it hasn\'t let Laptop in, which Pocket comes through', via.json)
    const mine = await fetch(`${laptop.url}/m/${S.id}/api/fleet`, { headers: { authorization: `Bearer ${laptop.key}` } }).then(async (r) => ({ status: r.status, json: await r.json() }))
    ok(shut(mine) && !mine.json.through, 'Laptop\'s own window on Studio: Studio hasn\'t let this device in', mine.json)
    ok((await pk.request('GET', '/api/fleet')).status === 200, 'Pocket still uses Laptop itself')
    const lt = local(laptop, `/m/${S.id}${ATTACH}`)
    await lt.wait((x) => x.closed, 6000)
    ok(lt.msgs.some((m) => m?.code === 'notLetIn' && m.computer === 'Studio'), 'nor a terminal of Studio\'s from Laptop', lt.msgs)
    const said = await until(async () => { await laptop.api(`/needs-you?fresh=${S.id}`); return (await laptop.api('/machines')).machines.find((m) => m.id === S.id && m.notLetIn) }, 15000, 500)
    ok(!!said, 'Laptop\'s list of its computers says Studio hasn\'t let it in', said && { name: said.name, notLetIn: said.notLetIn })
    const mapped = (await laptop.api('/agent-map')).devices.find((d) => d.id === S.id)
    ok(!said.agents?.length && !said.needs?.length && mapped?.notLetIn && !mapped.agents.length, 'and keeps nothing Studio told it before: no agents, nothing waiting, said as not let in', { agents: said.agents?.length, map: mapped && { notLetIn: mapped.notLetIn, agents: mapped.agents.length } })
    await studio.api('/remote/devices', { id: LAPTOP, allowed: true })
    const back = await until(async () => { await laptop.api(`/needs-you?fresh=${S.id}`); return !(await laptop.api('/machines')).machines.find((m) => m.id === S.id)?.notLetIn }, 15000, 500)
    ok(!!back && (await pk.request('GET', `/m/${S.id}/api/fleet`)).status === 200, 'ticked again at Studio: Laptop, and Pocket through it, may again')
  })

  await part('a device through a linked computer is checked as itself too', async () => {
    // Pocket, seen at Studio through Laptop: listed there as coming through it, and kept out that way.
    const entry = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'Pocket' && d.through === 'Laptop'), 6000, 200)
    ok(entry?.id === `${LAPTOP}/${POCKET}` && entry.allowed, 'Studio lists Pocket, through Laptop (Laptop and its id there, as the lockout keeps it)', entry)
    await studio.api('/remote/devices', { id: entry.id, allowed: false })
    const via = await pk.request('GET', `/m/${S.id}/api/agents/${encodeURIComponent(SHELL)}/file?path=notes.txt`)
    const term = pk.socket(`/m/${S.id}${ATTACH}`, { term: true })
    await term.wait((x) => x.closed, 6000)
    ok(shut(via) && !via.json.through && !via.text.includes('only for devices') && term.msgs[0]?.code === 'notLetIn' && !term.text, 'unticked at Studio as it comes through Laptop: refused there, files and terminal', [via.json, term.msgs])
    const fake = await pk.request('GET', `/m/${S.id}/api/fleet`, null, [['x-bridge-for-id', 'someone-else'], ['x-bridge-for-key', 'nobody']])
    ok(shut(fake), 'saying it\'s for another device doesn\'t help: Laptop says which one it is', fake.status)
    const lv = await fetch(`${laptop.url}/m/${S.id}/api/fleet`, { headers: { authorization: `Bearer ${laptop.key}` } })
    ok((await pk.request('GET', '/api/fleet')).status === 200 && lv.status === 200, 'Pocket still uses Laptop, and Laptop still uses Studio')
    await studio.api('/remote/devices', { id: entry.id, allowed: true })
    ok((await pk.request('GET', `/m/${S.id}/api/fleet`)).status === 200, 'ticked again: in again')
    // Paired with both with the same key: unticked at Studio, it's kept out through Laptop as well,
    // and what it has open through Laptop ends then.
    const key = await newKey(true)
    const bothS = over(await linkAs(ra.url, { device: key, code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Both', about: { name: 'Both' } }))
    const bothL = over(await linkAs(rb.url, { device: key, code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Both', about: { name: 'Both' } }))
    const atS = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'Both' && !d.through), 8000, 200)
    const atL = await until(async () => (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Both'), 8000, 200)
    for (const [k, d] of [[studio, atS], [laptop, atL]]) if (d && !d.allowed) await k.api('/remote/devices', { id: d.id, allowed: true })
    const t = bothL.socket(`/m/${S.id}${ATTACH}`, { term: true })
    ok(!!(await t.wait((x) => x.opened, 8000)) && (await bothL.request('GET', `/m/${S.id}/api/fleet`)).status === 200, 'Both, let in at each: Studio through Laptop', t.msgs)
    await studio.api('/remote/devices', { id: atS.id, allowed: false })
    await t.wait((x) => x.closed, 5000)
    const viaL = await bothL.request('GET', `/m/${S.id}/api/fleet`)
    ok(!!t.closed && shut(viaL) && shut(await bothS.request('GET', '/api/fleet')), 'unticked at Studio: refused there through Laptop too, as the same device, and its terminal through Laptop ends', [t.closed, viaL.json])
    ok((await bothL.request('GET', '/api/fleet')).status === 200, 'it still uses Laptop itself')
    bothS.stop()
    bothL.stop()
  })

  await part('kept out through Laptop: none of Studio through Laptop\'s own routes either', async () => {
    // An agent on Studio (the stand-in Claude), which Laptop's agent map and devices list show.
    studio.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
    await studio.api('/agents/catalog')
    const proj = path.join(studio.home, 'code', 'studio-project')
    fs.mkdirSync(proj, { recursive: true })
    await studio.api('/agents/launch', { kind: 'claude', cwd: proj, label: 'Studio-Agent', newSpace: 'studio-project', prompt: 'idle' })
    const seen = async (dev) => JSON.stringify((await dev.request('GET', '/api/agent-map?live=1')).json?.devices?.find((d) => d.id === S.id) || {}).includes('Studio-Agent')
    ok(!!(await until(() => seen(pk), 20000, 500)), 'Pocket, let in at Studio through Laptop: Laptop\'s agent map shows Studio\'s agent')
    const entry = (await studio.api('/remote')).access.devices.find((d) => d.id === `${LAPTOP}/${POCKET}`)
    await studio.api('/remote/devices', { id: entry.id, allowed: false })
    await laptop.api(`/needs-you?fresh=${S.id}`)
    const map = (await pk.request('GET', '/api/agent-map?live=1')).json?.devices?.find((d) => d.id === S.id)
    const ms = (await pk.request('GET', '/api/machines')).json?.machines?.find((m) => m.id === S.id)
    const ny = (await pk.request('GET', '/api/needs-you')).json
    ok(map?.notLetIn && !map.agents.length && ms?.notLetIn && !ms.agents.length && !(ny?.items || []).some((i) => i.machine === S.id), 'kept out at Studio as it comes through Laptop: Laptop shows it nothing of Studio (agent map, devices, Needs You), said as not let in', { map: map && { notLetIn: map.notLetIn, agents: map.agents.length }, ms: ms && { notLetIn: ms.notLetIn, agents: ms.agents.length } })
    ok(JSON.stringify((await laptop.api('/agent-map')).devices.find((d) => d.id === S.id) || {}).includes('Studio-Agent'), 'Laptop\'s own window still shows Studio\'s agent')
    const name0 = (await studio.api('/machines')).here.name
    const rn = await pk.request('POST', `/api/machines/${S.id}/name`, { name: 'Renamed-From-Pocket' })
    const pv = await pk.request('POST', `/api/machines/${S.id}/preview`, { port: 5173 })
    ok(rn.status >= 400 && (await studio.api('/machines')).here.name === name0 && pv.status >= 400 && /hasn't let this device in/.test(pv.json?.error || ''), 'nor can it rename Studio through Laptop, or ask Studio for a preview: Studio is told which device asks', [rn.status, rn.json?.error, pv.status, pv.json?.error])
    const snd = await pk.request('POST', '/api/alerts/sound', { on: false })
    ok(snd.status === 200 && (await studio.api('/settings')).effective.alertSounds !== false, 'turning alert sounds off from it changes Laptop\'s, not Studio\'s', snd.status)
    await laptop.api('/alerts/sound', { on: true })
    // A session on Studio's screen meanwhile: Laptop's event feed and its notifications leave it out
    // for Pocket, and keep it for Laptop itself.
    const feedOf = async (headers) => {
      const ac = new AbortController()
      let got = ''
      fetch(`${laptop.url}/api/events`, { headers: { accept: 'text/event-stream', authorization: `Bearer ${laptop.key}`, ...headers }, signal: ac.signal })
        .then(async (r) => { for await (const c of r.body) got += Buffer.from(c).toString('utf8') }).catch(() => {})
      await until(() => /event: screen\ndata: /.test(got), 5000, 50)
      ac.abort()
      const line = /event: screen\ndata: (.*)\n/.exec(got)?.[1]
      return line ? JSON.parse(line).list : null
    }
    await pk.request('POST', '/api/push/subscribe', { subscription: { endpoint: `https://push.example/pocket-${Date.now()}`, keys: { p256dh: 'p', auth: 'a' } }, label: 'Pocket' })
    const n0 = lines(pushedL).length
    const v = ph.socket(V)
    await through(v)
    await until(async () => (await laptop.api('/remote/live')).list.some((x) => x.machine === S.id), 8000, 200)
    const asPocket = await feedOf({ 'x-bridge-relay': POCKET })
    const asLaptop = await feedOf({})
    const live = (await pk.request('GET', '/api/remote/live')).json?.list || []
    await sleep(1500)
    const toPocket = lines(pushedL).slice(n0).filter((x) => x.device === POCKET)
    ok(asPocket && !asPocket.some((x) => x.machine === S.id) && asLaptop?.some((x) => x.machine === S.id) && !live.some((x) => x.machine === S.id), 'a session on Studio\'s screen: not in Laptop\'s event feed or cards for Pocket; in Laptop\'s own', { pocket: asPocket?.length, laptop: asLaptop?.length })
    ok(!toPocket.length, 'nor is Pocket notified of it through Laptop', toPocket.map((x) => x.note?.title))
    await v.close()
    await idle()
    await studio.api('/remote/devices', { id: entry.id, allowed: true })
    ok(!!(await until(async () => { await laptop.api(`/needs-you?fresh=${S.id}`); return seen(pk) }, 15000, 500)), 'let in again: shown again')
    // A device new at Laptop that hasn't asked Studio anything yet: with Studio's guardrails set,
    // Laptop shows it nothing of Studio until Studio lets it in.
    const nu = over(await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Newcomer', about: { name: 'Newcomer' } }))
    const nd = await until(async () => (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Newcomer'), 8000, 200)
    if (nd && !nd.allowed) await laptop.api('/remote/devices', { id: nd.id, allowed: true })
    await laptop.api(`/needs-you?fresh=${S.id}`)
    const before = (await nu.request('GET', '/api/agent-map?live=1')).json?.devices?.find((d) => d.id === S.id)
    ok(before?.notLetIn && !before.agents.length, 'a device new at Laptop, never seen at Studio: Laptop shows it nothing of Studio while Studio has a guardrail', before && { notLetIn: before.notLetIn, agents: before.agents.length })
    await letInVia(nu, 'Newcomer')
    ok(!!(await until(async () => { await laptop.api(`/needs-you?fresh=${S.id}`); return seen(nu) }, 15000, 500)), 'let in at Studio: Studio\'s agents shown to it')
    nu.stop()
  })

  await part('a device first seen through Laptop, Laptop too old to say which, and one kept out pairing again', async () => {
    // Dual, paired with Laptop only (a key of its own): New at Studio the first time it comes through.
    const dual = over(await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Dual', about: { name: 'Dual' } }))
    const dl = await until(async () => (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Dual'), 8000, 200)
    if (!dl.allowed) await laptop.api('/remote/devices', { id: dl.id, allowed: true })
    const first = await dual.request('GET', `/m/${S.id}/api/fleet`)
    const e = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'Dual' && d.through === 'Laptop'), 6000, 200)
    const waits = (await studio.api('/needs-you')).letIn.find((x) => x.id === e?.id)
    ok(shut(first) && e?.fresh && !e.allowed && waits?.through === 'Laptop', 'Dual, first seen at Studio through Laptop with a password set: New, refused, and waiting in Studio\'s Needs You', [first.status, e, waits])
    await studio.api('/remote/devices', { id: e.id, allowed: true })
    ok((await dual.request('GET', `/m/${S.id}/api/fleet`)).status === 200, 'allowed at Studio: in')
    // Paired with Studio directly too, with a key of its own: listed twice, each offered as the other.
    const dualS = over(await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Dual', about: { name: 'Dual' } }))
    const both = await until(async () => { const l = (await studio.api('/remote')).access.devices.filter((d) => d.name === 'Dual'); return l.length === 2 ? l : null }, 8000, 200)
    const direct = both?.find((d) => !d.through)
    ok(!!direct && direct.same.includes(e.id) && both.find((d) => d.through).same.includes(direct.id), 'the same phone, paired here and through Laptop: two entries, each naming the other as maybe the same', both?.map((d) => ({ id: d.id, through: d.through, same: d.same })))
    await dualS.request('DELETE', `/api/relay/devices/${encodeURIComponent(direct.id)}`)
    dualS.stop()
    dual.stop()
    // A computer too old to say which of its devices it's for: its devices are told to update it;
    // what it asks as itself goes on.
    const old = over(await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'OldBox', about: { name: 'OldBox', kind: 'computer' }, hello: { kind: 'computer' } }))
    const od = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'OldBox'), 8000, 200)
    if (!od.allowed) await studio.api('/remote/devices', { id: od.id, allowed: true })
    const itself = await old.request('GET', '/api/fleet')
    const forOne = await old.request('GET', '/api/fleet', null, [['x-bridge-for', '1']])
    ok(od.kind === 'computer' && itself.status === 200 && forOne.status === 403 && forOne.json?.code === 'notLetIn' && forOne.json.through === 'OldBox' && /Update Bridge AI on OldBox to use Studio from its devices/.test(forOne.json.error), 'a computer that says a request is for one of its devices but not which: refused, saying to update it; as itself, in', [itself.status, forOne.json])
    const lap = (await studio.api('/remote')).access.devices.find((d) => d.id === LAPTOP)
    ok(od.older === true && !lap?.older, 'a computer on a Bridge AI from before (no word that it tells its devices apart) is listed as older; Laptop isn\'t', [od, lap && { older: lap.older }])
    await old.request('DELETE', `/api/relay/devices/${encodeURIComponent(od.id)}`)
    old.stop()
    // Kept out, then unpairing and pairing again with the same key: kept out again, with the switch off too.
    const key = await newKey(true)
    const k1 = over(await linkAs(ra.url, { device: key, code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Again', about: { name: 'Again' } }))
    const a1 = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'Again'), 8000, 200)
    await studio.api('/remote/devices', { id: a1.id, allowed: false })
    await k1.request('DELETE', `/api/relay/devices/${encodeURIComponent(a1.id)}`)
    k1.stop()
    const k2 = over(await linkAs(ra.url, { device: key, code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Again', about: { name: 'Again' } }))
    const a2 = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'Again'), 8000, 200)
    await studio.api('/settings', { trials: { 'remote-screen': false } }, 'PATCH')
    const off = await k2.request('GET', '/api/fleet')
    await studio.api('/settings', { trials: { 'remote-screen': true } }, 'PATCH')
    ok(a2?.out && !a2.fresh && shut(off), 'kept out, it unpairs and pairs again with the same key: kept out again (not New), with Remote Screen and Preview off too', [a2, off.status])
    await k2.request('DELETE', `/api/relay/devices/${encodeURIComponent(a2.id)}`)
    k2.stop()
  })

  await part('an unticked device that unpairs itself leaves the guardrail', async () => {
    const was = JSON.parse(fs.readFileSync(path.join(laptop.data, 'remote.json'), 'utf8'))
    ok(!was.password && !was.askFirst && !(was.blocked || []).length, 'Laptop: no password, no Ask Here First, nobody kept out', { password: !!was.password, askFirst: was.askFirst, blocked: was.blocked })
    const x = over(await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Xphone', about: { name: 'Xphone' } }))
    const xd = await until(async () => (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Xphone'), 8000, 200)
    ok(xd?.allowed && !xd.fresh, 'Xphone, paired at Laptop with no guardrail: let in', xd)
    await laptop.api('/remote/devices', { id: xd.id, allowed: false })
    const gone = await x.request('DELETE', `/api/relay/devices/${encodeURIComponent(xd.id)}`)
    const z = over(await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Zphone', about: { name: 'Zphone' } }))
    const zd = await until(async () => (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Zphone'), 8000, 200)
    ok(gone.status === 200 && zd?.fresh && !zd.allowed && shut(await z.request('GET', '/api/fleet'), 'Laptop'), 'kept out, then unpairing itself: the next one paired at Laptop still starts New', [gone.status, zd])
    await laptop.api('/remote/devices', { id: zd.id, allowed: true })
    x.stop()
    z.stop()
  })

  // ---------- smaller ones ----------
  await part('the password changed or taken off: sessions end', async () => {
    const v = ph.socket(V)
    await through(v)
    await studio.api('/remote/password', { password: `${PW}!` })
    await v.wait((s) => msg(s, 'error') && s.closed, 4000)
    ok(msg(v, 'error')?.code === 'changed', 'changed: the session ends, told why', msg(v, 'error'))
    const w = ph.socket(V)
    await through(w, `${PW}!`)
    await studio.api('/remote/password', { remove: true })
    await w.wait((s) => msg(s, 'error') && s.closed, 4000)
    ok(msg(w, 'error')?.code === 'changed', 'taken off: the same', msg(w, 'error'))
    await studio.api('/remote/password', { password: PW })
    await idle()
  })

  await part('pictures go only to the session they\'re for', async () => {
    const cap = local(studio, '/api/remote/capture')
    await until(() => cap.ws.readyState === 1, 4000, 50)
    cap.send({ t: 'hello', sources: [{ id: 'cap-1', name: 'Captured', kind: 'screen', w: 640, h: 400, primary: true }], permission: 'ok', p2p: false })
    const v = ph.socket(V)
    await through(v)
    await cap.wait((s) => s.msgs.some((m) => m.t === 'start'))
    const sid = cap.msgs.find((m) => m.t === 'start').session
    cap.send({ t: 'frame', session: sid })
    cap.ws.send(Buffer.from(packFrame('image/svg+xml', 1, 1, Buffer.from('<svg>first</svg>'))))
    await v.wait((s) => s.frames.length >= 1)
    await v.send({ t: 'ack' })
    cap.send({ t: 'frame', session: 'gone-session' })
    cap.ws.send(Buffer.from(packFrame('image/svg+xml', 1, 1, Buffer.from('<svg>not yours</svg>'))))
    await sleep(800)
    ok(v.frames.length === 1, 'a picture for a session that isn\'t there goes to no other', v.frames.map((f) => Buffer.from(f.f.bytes).toString()))
    await v.close()
    cap.close()
    await idle()
  })

  // macOS gives an app no screens until it's reopened after Screen Recording is turned on for it:
  // said as that, and Reopen offered to the session, which the guardrails let in, and only to it.
  await part('no screens to share: why, and Reopen Bridge AI from the session', async () => {
    const ac = new AbortController()
    const heard = []
    const feed = fetch(`${studio.url}/api/events`, { headers: { Accept: 'text/event-stream', 'x-bridge-desktop': '3.21.0', authorization: `Bearer ${studio.key}` }, signal: ac.signal }).then(async (r) => {
      const dec = new TextDecoder()
      for await (const c of r.body) heard.push(dec.decode(c))
    }).catch(() => {})
    const cap = local(studio, '/api/remote/capture')
    await until(() => cap.ws.readyState === 1, 4000, 50)
    cap.send({ t: 'hello', sources: [], permission: 'ok', none: 'reopen', p2p: false })
    const v = ph.socket(V)
    await through(v)
    await v.wait((s) => msg(s, 'error'), 12000)
    const e = msg(v, 'error')
    ok(e?.code === 'reopen' && e.reopen === true && /only once it's reopened/.test(e.why) && !v.closed, 'turned on since Bridge AI opened there: said so, with Reopen offered, the session kept open for it', e)
    ok(cap.msgs.some((m) => m.t === 'sources?'), 'its screens asked for again before that was said')
    await v.send({ t: 'reopen' })
    await v.wait((s) => msgs(s, 'error').length >= 2, 4000)
    ok(msgs(v, 'error')[1]?.code === 'reopening', 'Reopen: the device is told it\'s reopening', msgs(v, 'error')[1])
    ok(!!(await until(() => /event: remote\ndata: \{"t":"reopen"\}/.test(heard.join('')), 4000, 100)), 'and the desktop app here is asked to reopen')
    const rec = await until(async () => (await studio.api('/remote')).log?.find((x) => x.end === 'reopened'), 4000, 100)
    ok(rec?.by?.name === 'Phone', 'Screen Activity says who reopened it', rec)
    ac.abort()
    await feed
    cap.close()
    await idle()
  })

  await part('the password\'s hash: OWASP\'s cost, and an older one made again once it\'s typed', async () => {
    const stored = JSON.parse(fs.readFileSync(path.join(studio.data, 'remote.json'), 'utf8')).password
    ok(stored.kdf === 'scrypt' && stored.N * stored.p >= 2 ** 17 && stored.r === 8, 'N=2^17, r=8, p=1 (or its equal at less memory)', { N: stored.N, r: stored.r, p: stored.p })
    // One made by Bridge AI before (N=2^14), as remote.json kept it.
    await studio.restart(() => {
      const salt = crypto.randomBytes(16)
      const hash = crypto.scryptSync(PW, salt, 32, { N: 16384, r: 8, p: 1 })
      const f = path.join(studio.data, 'remote.json')
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      j.password = { kdf: 'scrypt', N: 16384, r: 8, p: 1, salt: salt.toString('base64'), hash: hash.toString('base64'), at: '2026-01-01T00:00:00.000Z' }
      fs.writeFileSync(f, JSON.stringify(j))
    })
    await until(async () => (await studio.api('/relay')).online, 20000)
    // (A phone paired now: those from before the restart don't reconnect in the link client.)
    const p4 = over(await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Phone4', about: { name: 'Phone4' } }))
    const d4 = await until(async () => (await studio.api('/remote')).access.devices.find((x) => x.name === 'Phone4'), 8000, 200)
    await studio.api('/remote/devices', { id: d4.id, allowed: true })
    const v = p4.socket(V)
    ok(!!(await through(v)), 'the older one still lets the right password in')
    const now = JSON.parse(fs.readFileSync(path.join(studio.data, 'remote.json'), 'utf8')).password
    ok(now.N * now.p >= 2 ** 17 && now.hash !== stored.hash && now.at === '2026-01-01T00:00:00.000Z', 'and is made again at the new cost, keeping when it was set', { N: now.N, p: now.p, at: now.at })
    await v.close()
    p4.stop()
  })

  await part('an app drawn off screen stays on its own app', async () => {
    const { create } = createRequire(import.meta.url)(path.join(ROOT, 'desktop', 'remote.js'))
    const wins = []
    class Win {
      constructor(o) { this.o = o; wins.push(this); const wc = { on_: {}, on: (e, f) => { wc.on_[e] = f }, setWindowOpenHandler: () => {}, setFrameRate: () => {} }; this.webContents = wc }
      loadURL(u) { this.url = u; return Promise.resolve() }
      on() {}
      once() {}
      isDestroyed() { return false }
      destroy() {}
    }
    const desk = create({
      BrowserWindow: Win, desktopCapturer: { getSources: async () => [] }, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: {} }) },
      session: { fromPartition: (n) => ({ name: n, setPermissionRequestHandler: () => {} }) }, systemPreferences: { getMediaAccessStatus: () => 'granted' },
      nativeTheme: { shouldUseDarkColors: false }, URL_BASE: 'http://127.0.0.1:1', preload: '/preload.js', platform: 'darwin', keyFor: () => null, fetch: async () => ({ status: 200 }),
    })
    desk.onEvent({ t: 'page-start', session: 'p1', port: 5173, w: 390, h: 700, rate: 2 })
    const on = wins.find((w) => w.url === 'http://localhost:5173/')?.webContents.on_ || {}
    const stops = (ev, ...a) => { let s = false; on[ev]?.({ preventDefault: () => { s = true }, ...a[0] }, ...a.slice(1)); return s }
    ok(stops('will-redirect', { url: 'http://127.0.0.1:7420/' }, 'http://127.0.0.1:7420/', false, true) && !stops('will-redirect', { url: 'http://localhost:5173/next' }, 'http://localhost:5173/next', false, true), 'a redirect elsewhere isn\'t followed (to its own app, it is)')
    ok(stops('will-frame-navigate', { url: 'http://127.0.0.1:7420/api/relay', isMainFrame: false }) && !stops('will-frame-navigate', { url: 'http://localhost:5173/frame', isMainFrame: false }), 'nor a frame in it to anything else on this computer')
    ok(stops('will-frame-navigate', { url: 'https://elsewhere.example/', isMainFrame: true }), 'nor the page itself, any way it goes')
  })

  // ---------- in the app: the phone told, and Allow at the computer ----------
  // A phone paired through its relay page (the apps' page) once Studio has a password: it starts
  // unticked, so its page is one card saying so; Studio's Needs You lists it with Allow, and once
  // it's allowed there the phone's page opens by itself.
  await part('the card on a phone not let in, and Allow from the computer', async () => {
    const { b, which } = await browser()
    try {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2 })
      await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })) } catch { /* no storage */ } })
      const p = await ctx.newPage()
      await p.goto((await studio.api('/relay/pair', {})).pairing.link, { waitUntil: 'commit' })
      await p.locator('#pair-go').click({ timeout: 20000 })
      const f = await until(() => p.frames().find((x) => x !== p.mainFrame() && x.url().startsWith(ra.url)), 30000, 100)
      const card = f.locator('.letin-screen')
      await card.waitFor({ timeout: 30000 })
      const said = (await card.innerText()).replace(/\s+/g, ' ')
      ok(/Studio hasn't let this device in/.test(said) && /On Studio: Settings › Remote Access › Which Devices May Connect\./.test(said), `${which}: the phone's page is one card, saying Studio hasn't let it in and where that's changed`, said)
      ok(!(await f.locator('.settings-btn, .error-text').count()), 'and none of the app behind it, nor its panels failing')
      const d = (await studio.api('/remote')).access.devices.filter((x) => x.fresh && !x.allowed && x.kind === 'phone' && !x.through).at(-1)
      const s = await page(b, studio.url)
      await s.p.locator('.top-right .needs-chip').click({ timeout: 20000 })
      const item = s.p.locator('.ny-panel .t-letin', { hasText: d?.name || 'none' })
      await item.waitFor({ timeout: 15000 })
      ok(/waits to be let in/.test(await item.innerText()), 'Studio\'s Needs You lists it, waiting to be let in, with Allow', (await item.innerText()).replace(/\s+/g, ' '))
      await item.getByRole('button', { name: 'Allow' }).click()
      ok(!!(await until(async () => (await studio.api('/remote')).access.devices.find((x) => x.id === d.id)?.allowed, 5000, 100)), 'Allow lets it in: ticked in Which Devices May Connect')
      ok(!!(await f.locator('.settings-btn').waitFor({ timeout: 20000 }).then(() => true, () => false)), 'and the phone\'s page opens Bridge AI by itself')
      // A computer on an older Bridge AI, paired with Studio: Settings says its devices can't be kept out apart from it.
      const older = over(await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'OldBox2', about: { name: 'OldBox2', kind: 'computer', version: '3.21.0' }, hello: { kind: 'computer' } }))
      await s.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))
      const list = s.p.locator('[data-setting="remote-devices"]')
      const oldSaid = /OldBox2 runs an older Bridge AI: devices reaching this computer through it can't be told apart from OldBox2 itself, so the list can't keep them out separately\. Update Bridge AI on OldBox2\./
      ok(!!(await until(async () => oldSaid.test((await list.innerText().catch(() => '')).replace(/\s+/g, ' ')), 15000, 300)), 'Settings › Remote Access says a computer on an older Bridge AI can\'t have its devices kept out apart from it', (await list.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600))
      // Unticked, then Remote Screen and Preview turned off at Studio: it stays out, and Studio's
      // Settings lists it with Allow where the Beta Feature's settings were.
      await studio.api('/remote/devices', { id: d.id, allowed: false })
      await studio.api('/settings', { trials: { 'remote-screen': false } }, 'PATCH')
      await s.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } })))
      const kept = s.p.locator('[data-setting="remote-kept-out"]')
      await kept.waitFor({ timeout: 15000 })
      ok((await kept.innerText()).includes(d.name), 'with Remote Screen and Preview off, Studio\'s Settings lists it as kept out', (await kept.innerText()).replace(/\s+/g, ' '))
      await kept.locator('li', { hasText: d.name }).getByRole('button', { name: 'Allow' }).click()
      ok(!!(await until(async () => !(await studio.api('/remote')).access.devices.find((x) => x.id === d.id)?.out, 5000, 100)), 'and Allow there lets it back in')
      const od2 = (await studio.api('/remote')).access.devices.find((x) => x.name === 'OldBox2')
      if (od2) await older.request('DELETE', `/api/relay/devices/${encodeURIComponent(od2.id)}`)
      older.stop()
      await studio.api('/settings', { trials: { 'remote-screen': true } }, 'PATCH')
      await s.ctx.close()
      await ctx.close()
    } finally { await b.close() }
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-2500))
} finally {
  for (const p of procs) stopTree(p)
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
