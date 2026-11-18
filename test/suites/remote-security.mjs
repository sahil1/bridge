// What a security review of remote access found, each kept found: two Bridge AIs ("Studio", seen,
// and "Laptop"), each on a relay of its own and linked, phones paired with each (the link client),
// Tailscale stood in for (BRIDGE_TAILNET_OWNER, and a stand-in `tailscale` that says it serves
// Studio), and nothing real taken or pressed (BRIDGE_TEST_SCREEN=fake, BRIDGE_TEST_INPUT). Checked:
//   Tailscale: what it says about who's asking never lets a request in without the key, as any
//     program on Studio can send the same to 127.0.0.1; a phone through it is let in by the code in
//     Settings (a one-time link, or that link pasted), and is never "at this computer".
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import WebSocket from 'ws'
import { startKit, startRelay, checks, until, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('remote-security')
const relays = []
const kits = []
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
  const studio = await kitWith('Studio', ra, { BRIDGE_TEST_SCREEN: 'fake', BRIDGE_TEST_INPUT: inputs, BRIDGE_TAILNET_OWNER: OWNER })
  studio.program('tailscale', TAILSCALE)

  // ---------- Tailscale's headers, sent by a program on this computer ----------
  {
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

    // A phone let in by the code in Settings: a one-time link through Tailscale.
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
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-2500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
