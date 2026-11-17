// Remote Screen and Preview (a Beta Feature: server/remote.js, server/devpreview.js, src/components/remote/),
// end to end through the relay stand-in (stand-ins/relay.mjs), with nothing real taken or pressed:
// the screen is BRIDGE_TEST_SCREEN=fake (pictures drawn by the server), or the capture page with ?fake=1
// (a canvas), the mouse and keyboard BRIDGE_TEST_INPUT (a file), the clipboard BRIDGE_TEST_CLIPBOARD.
// Two Bridge AIs, "Studio" (seen) and "Laptop" (looking), each on a relay of its own and linked, and a
// phone paired with each (the link client, relay/web/link.js as the phone page uses it). Checked:
//   only your devices: Studio's own page can't open a session of its screen; a key Studio never paired
//     gets no further than the relay; a phone paired with it, and Laptop through its link, can;
//   nothing in the clear: what crosses the relay for a phone watching is sealed (no picture, no word of
//     what it asks, in what the relay carries);
//   pictures through the relay, each sent only once the last one was shown, no faster than the rate;
//   control off until it's turned on at Studio itself (not from a phone or another computer), its
//     input then pressed at the screen's own coordinates, held keys let go when a session ends, the
//     clipboard both ways, and someone at Studio pausing it (the emergency stop);
//   Stop at Studio ends a session, which the viewer is told; every session in the log (who, from which
//     device and for which, what, how long, whether it controlled, how it came), and the notice after,
//     cleared only at Studio;
//   the Beta Feature off at Studio: nothing seen, and said why;
//   a project's app on Studio, at an address of its own on Laptop: its page, its absolute paths, a
//     redirect to itself, its cookies (never Bridge AI's own), a POST, its hot reload's WebSocket (with
//     the subprotocol it asks for); only a port Studio lists as one of an agent's dev servers, never
//     Bridge AI's own nor one started elsewhere; a Host that isn't the address turned away; its page
//     can't use Laptop's API; on a phone, as pictures drawn at Studio, taps going to that page;
//   in the browser (BRIDGE_TEST_BROWSER): Settings › Devices › Computers on Laptop, View screen, the
//     pictures through the relay (said slower), Control once Studio allows it; on Studio, the line saying
//     it's being seen, Stop, the notice after and the log in Settings; peer-to-peer between two pages
//     where the browser can (the capture page on Studio, with a canvas), said Direct; the agent's
//     Preview tab on Laptop showing Studio's app at its own address, never Laptop's localhost.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import WebSocket, { WebSocketServer } from 'ws'
import { startKit, startRelay, checks, until, browser, page, sleep, shot, ROOT, TEST, IS_WIN, freePort, stopTree } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'
import { K, json, text } from '../../relay/web/link.js'
import { unpackFrame, keyFor } from '../../shared/remote.js'

const { ok, skip, done } = checks('remote-screen')
const say = (...a) => console.log(...a)
const enc = encodeURIComponent
const relays = []
const kits = []
const procs = []
let b = null
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: ${String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')}`) } }

// ---------- the link, spoken for: requests and WebSockets over one session ----------
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
        const raw = Buffer.concat(parts)
        let j = null
        try { j = JSON.parse(raw.toString('utf8')) } catch { /* not JSON */ }
        resolve({ status: head?.s, headers: head?.h || [], json: j, text: raw.toString('utf8') })
      }
    })
    ;(async () => {
      await c.send(K.REQ, id, { m, u, h: [['content-type', 'application/json'], ...headers], body: !!body })
      if (body) { await c.send(K.BODY, id, new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body))); await c.send(K.END, id) }
    })()
  })
  // A WebSocket there: { msgs (text, parsed), frames (binary), send(obj), close(), wait(fn, ms) }.
  const socket = (u) => {
    const id = ids++
    const s = { msgs: [], frames: [], opened: false, closed: null }
    by.set(id, (r) => {
      if (r.kind === K.WS_OPENED) s.opened = true
      else if (r.kind === K.WS_MSG) { const bin = r.body[0] !== 1; const d = Buffer.from(r.body.subarray(1)); if (bin) s.frames.push({ at: Date.now(), f: unpackFrame(new Uint8Array(d)) }); else { try { s.msgs.push(JSON.parse(d.toString('utf8'))) } catch { s.msgs.push(d.toString('utf8')) } } } else if (r.kind === K.WS_CLOSE) { s.closed = json(r.body); by.delete(id) }
    })
    s.send = (m) => c.send(K.WS_MSG, id, Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(m))]))
    s.close = () => c.send(K.WS_CLOSE, id, { c: 1000, r: '' })
    s.wait = (fn, ms = 10000) => until(async () => fn(s), ms, 50)
    c.send(K.WS_OPEN, id, { u })
    return s
  }
  return { request, socket, stop: () => { live = false; c.close() } }
}
// The same from a computer's own page (its key), straight to its server.
function local(kit, u) {
  const s = { msgs: [], frames: [], closed: null }
  const ws = new WebSocket(`${kit.url.replace(/^http/, 'ws')}${u}`, { headers: { authorization: `Bearer ${kit.key}` } })
  ws.on('message', (d, bin) => { if (bin) s.frames.push({ at: Date.now(), f: unpackFrame(new Uint8Array(d)) }); else { try { s.msgs.push(JSON.parse(String(d))) } catch { s.msgs.push(String(d)) } } })
  ws.on('close', (c) => { s.closed = { c } })
  ws.on('error', () => {})
  s.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m))
  s.close = () => ws.close()
  s.wait = (fn, ms = 10000) => until(async () => fn(s), ms, 50)
  return s
}
const msg = (s, t) => s.msgs.find((m) => m.t === t)
// Once the app is there (its top bar), Settings › Devices › Computers.
const ready = (p) => p.locator('.settings-btn').waitFor({ timeout: 20000 })
const devices = async (p) => { await ready(p); await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'machines' } }))) }
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }

// A tap between a phone and its relay: every message, both ways, as the relay carries it.
async function tap(relayUrl) {
  const port = await freePort()
  const seen = []
  const wss = new WebSocketServer({ port, host: '127.0.0.1' })
  wss.on('connection', (client, req) => {
    const up = new WebSocket(`${relayUrl.replace(/^http/, 'ws')}${req.url}`)
    const early = []
    up.on('open', () => { for (const [d, bin] of early.splice(0)) up.send(d, { binary: bin }) })
    client.on('message', (d, bin) => { seen.push(Buffer.from(d)); if (up.readyState === 1) up.send(d, { binary: bin }); else early.push([d, bin]) })
    up.on('message', (d, bin) => { seen.push(Buffer.from(d)); if (client.readyState === 1) client.send(d, { binary: bin }) })
    client.on('close', () => up.close())
    up.on('close', () => client.close())
    up.on('error', () => {})
    client.on('error', () => {})
  })
  return { url: `http://127.0.0.1:${port}`, seen, stop: () => wss.close() }
}

// A project's dev server (what an agent's `npm run dev` would be), with what a preview needs to carry.
const DEV = String.raw`
import http from 'node:http'
import { WebSocketServer } from 'ws'
const port = Number(process.argv[2])
const laptop = process.argv[3] || ''
const page = '<!doctype html><html><head><meta charset="utf-8"><title>Dev App</title></head><body><h1 id="hello">Hello from the dev app</h1><script type="module" src="/src/main.js"></script></body></html>'
const main = 'const h = document.getElementById("hello"); h.dataset.js = "ran";' +
  'fetch(' + JSON.stringify(laptop + '/api/config') + ').then((r) => { h.dataset.api = String(r.status) }, () => { h.dataset.api = "blocked" });' +
  'const ws = new WebSocket("ws://" + location.host + "/hmr", "vite-hmr"); ws.onmessage = (e) => { h.dataset.hmr = e.data }; ws.onopen = () => ws.send("ping");'
const s = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(page) }
  if (u.pathname === '/src/main.js') { res.setHeader('content-type', 'text/javascript'); return res.end(main) }
  if (u.pathname === '/login') { res.setHeader('set-cookie', ['sid=abc123; Path=/; HttpOnly', 'theme=dark; Path=/; Domain=localhost']); res.setHeader('content-type', 'application/json'); return res.end('{"ok":true}') }
  if (u.pathname === '/whoami') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ cookie: req.headers.cookie || '', host: req.headers.host, origin: req.headers.origin || null, auth: req.headers.authorization || null, bridge: Object.keys(req.headers).filter((k) => k.startsWith('x-bridge')) })) }
  if (u.pathname === '/go') { res.statusCode = 302; res.setHeader('location', 'http://localhost:' + port + '/landed?x=1'); return res.end() }
  if (u.pathname === '/landed') return res.end('landed')
  if (u.pathname === '/echo' && req.method === 'POST') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ got: b, type: req.headers['content-type'] })) }); return }
  res.statusCode = 404; res.end('nope')
})
const wss = new WebSocketServer({ noServer: true })
s.on('upgrade', (req, sock, head) => {
  if (req.headers['sec-websocket-protocol'] !== 'vite-hmr' || !req.url.startsWith('/hmr')) { sock.write('HTTP/1.1 400 Bad Request\r\n\r\n'); return sock.destroy() }
  wss.handleUpgrade(req, sock, head, (ws) => ws.on('message', (d) => ws.send('pong:' + String(d) + ':' + req.headers['sec-websocket-protocol'])))
})
s.listen(port, '127.0.0.1', () => console.log('dev server on', port))
`

try {
  const ra = await startRelay('remote-screen-studio')
  const rb = await startRelay('remote-screen-laptop')
  relays.push(ra, rb)
  const inputs = path.join(TEST, '.out', `remote-screen-input-${process.pid}.jsonl`)
  const clip = path.join(TEST, '.out', `remote-screen-clip-${process.pid}.txt`)
  for (const f of [inputs, clip, `${inputs}.local`]) fs.rmSync(f, { force: true })
  const kitWith = async (name, rel, env = {}) => {
    const k = await startKit(`remote-screen-${name.toLowerCase()}`, { config: { trials: { 'remote-screen': true } }, env: (dirs) => { fs.writeFileSync(path.join(dirs.data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_REMOTE_ICE: 'none', ...env } } })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }
  const studio = await kitWith('Studio', ra, { BRIDGE_TEST_SCREEN: 'fake', BRIDGE_TEST_INPUT: inputs, BRIDGE_TEST_CLIPBOARD: clip })
  const laptop = await kitWith('Laptop', rb)
  ok(!!(await until(async () => (await studio.api('/relay')).online && (await laptop.api('/relay')).online, 20000)), 'each is connected to its own relay')
  const p = (await studio.api('/relay/pair', {})).pairing
  await laptop.api('/machines', { link: `${ra.url} ${p.code}` })
  const S = await until(async () => (await laptop.api('/machines')).machines.find((m) => m.name === 'Studio' && m.online), 30000, 300)
  ok(!!S && !!(await until(async () => (await studio.api('/machines')).machines.find((m) => m.name === 'Laptop' && m.online), 30000, 300)), 'Laptop and Studio are linked, each way')
  // A phone paired with Studio, through a tap that records what its relay carries.
  const t1 = await tap(ra.url)
  const phone = await linkAs(t1.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Phone', about: { name: 'Phone' } })
  ok(!phone.refused && !!phone.deviceId, 'a phone pairs with Studio', phone.refused)
  const ph = over(phone)

  // ---------- only your devices ----------
  await part('only your devices', async () => {
    const st = await studio.api('/remote')
    ok(st.on && st.screen.can && st.screen.sources?.length >= 2 && st.control.on === false && st.here === true, 'Studio says its screen can be seen (two screens, the stand-in\'s), control off', { screen: st.screen, control: st.control })
    const self = local(studio, '/api/remote/view?source=screen:')
    await self.wait((s) => msg(s, 'error') && s.closed)
    ok(msg(self, 'error')?.code === 'here', 'Studio\'s own page can\'t open a session of its own screen', self.msgs)
    const stranger = await linkAs(ra.url, { name: 'Stranger' })
    ok(!!stranger.refused || !!stranger.offline, 'a key Studio never paired is turned away at the hello, before anything else', stranger.refused)
    const viaPhone = await ph.request('GET', '/api/remote')
    ok(viaPhone.status === 200 && viaPhone.json.here === false && viaPhone.json.screen.can, 'the phone, paired, is told what Studio\'s screen can do', viaPhone.json && { here: viaPhone.json.here })
  })

  // ---------- a session through the relay ----------
  let sid = null
  await part('pictures through the relay', async () => {
    const v = ph.socket('/api/remote/view?source=screen:&control=1')
    await v.wait((s) => msg(s, 'hello') && s.frames.length >= 1)
    const h = msg(v, 'hello')
    sid = h?.session
    ok(!!h && h.name === 'Studio' && h.source.name === 'Test screen' && !h.p2p && h.control.allowed === false && /Control is off on Studio/.test(h.control.why || ''), 'the phone\'s session: its main screen, as pictures (no peer-to-peer from the stand-in), and control off, saying where to turn it on', h)
    const f = v.frames[0]?.f
    ok(f?.type === 'image/svg+xml' && f.w === 1280 && f.h === 800 && /Test screen/.test(Buffer.from(f.bytes).toString('utf8')), 'a picture comes, with its size and type', f && { type: f.type, w: f.w, h: f.h })
    await sleep(1500)
    ok(v.frames.length === 1, 'and no more until it\'s been shown (ack)', v.frames.length)
    for (let i = 0; i < 6; i++) { await v.send({ t: 'ack' }); await v.wait((s) => s.frames.length >= i + 2, 4000) }
    // (On average: one picture held up on the way and the next not makes a short gap between them.)
    const gaps = v.frames.slice(2).map((x, i) => x.at - v.frames[i + 1].at)
    const avg = gaps.reduce((a, g) => a + g, 0) / Math.max(1, gaps.length)
    ok(v.frames.length >= 7 && avg >= 1000 / 4 - 15, `each acked, the next comes, no faster than 4 a second through a relay of your own (${Math.round(avg)} ms apart on average)`, gaps)
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.5, y: 0.5 }, { t: 'down', b: 0, x: 0.5, y: 0.5 }] })
    await sleep(600)
    ok(!lines(inputs).length, 'with control off, nothing it sends is pressed', lines(inputs))
    const plain = Buffer.concat(t1.seen).toString('latin1')
    // (The handshake's hello and welcome are in the clear, as they always are: public keys.)
    ok(t1.seen.length > 20 && !/Test screen|<svg|remote\/view|"session"|"evs"|"source"|control/.test(plain), `nothing in the clear through the relay: ${t1.seen.length} messages, no picture and no word of what was asked`, (plain.match(/Test screen|<svg|remote\/view|"session"|"evs"|"source"|control/) || [])[0])
    await v.close()
    await until(async () => !(await studio.api('/remote')).sessions.length, 5000, 100)
    const log = (await studio.api('/remote')).log[0]
    ok(log?.id === sid && log.by.name === 'Phone' && log.by.kind === 'phone' && log.kind === 'screen' && log.source.name === 'Test screen' && log.via === 'relay' && log.ended && log.end === 'viewer' && log.controlled === false && log.seconds >= 1, 'Studio keeps it: who, from which device, what, how it came, how long, and that nothing was controlled', log)
  })

  // ---------- control ----------
  await part('control, turned on at Studio only', async () => {
    const fromPhone = await ph.request('POST', '/api/remote/control', { on: true })
    const fromLaptop = await fetch(`${laptop.url}/m/${S.id}/api/remote/control`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ on: true }) })
    ok(fromPhone.status === 403 && /at Studio itself/.test(fromPhone.json?.error) && fromLaptop.status === 403 && !(await studio.api('/remote')).control.on, 'a phone or another computer can\'t turn control on: only Studio itself', [fromPhone.json, fromLaptop.status])
    const on = await studio.api('/remote/control', { on: true })
    ok(on.on === true && on.can && on.via === 'test', 'turned on at Studio', on)
    const v = ph.socket('/api/remote/view?source=screen:fake-2&control=1')
    await v.wait((s) => msg(s, 'hello'))
    ok(msg(v, 'hello').control.allowed === true && msg(v, 'hello').source.name === 'Second screen', 'a session now may control (the screen picked: the second)', msg(v, 'hello'))
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.5, y: 0.25 }, { t: 'down', b: 0, x: 0.5, y: 0.25 }, { t: 'up', b: 0, x: 0.5, y: 0.25 }, { t: 'key', code: 'MetaLeft', down: true }, { t: 'key', code: 'KeyC', down: true }, { t: 'text', s: 'héllo' }, { t: 'key', code: 'Nope', down: true }, { t: 'wheel', dx: 0, dy: 120 }] })
    const got = await until(() => (lines(inputs).length >= 7 ? lines(inputs) : null), 5000, 100)
    const mv = got?.find((x) => x.t === 'move')
    ok(mv && mv.x === 1280 + 512 && mv.y === 192, 'the pointer goes to that point of the screen itself (the second screen\'s own place on the desktop)', mv)
    ok(got?.some((x) => x.t === 'down' && x.b === 0) && got.some((x) => x.t === 'up') && got.some((x) => x.t === 'key' && x.code === 'KeyC' && x.k === 8 && x.down) && got.some((x) => x.t === 'text' && x.s === 'héllo') && got.some((x) => x.t === 'wheel' && x.dy === 120) && !got.some((x) => x.code === 'Nope'), 'a click, a key (its macOS code), text and the wheel are pressed; a key it doesn\'t know isn\'t', got)
    // Clipboard, both ways.
    await v.send({ t: 'clip', text: 'from the phone' })
    await v.wait((s) => msg(s, 'clip-sent'))
    ok(fs.readFileSync(clip, 'utf8') === 'from the phone', 'the phone\'s clipboard goes onto Studio\'s')
    fs.writeFileSync(clip, 'from Studio ✓')
    await v.send({ t: 'clip?' })
    await v.wait((s) => msg(s, 'clip'))
    ok(msg(v, 'clip')?.text === 'from Studio ✓', 'and Studio\'s comes back', msg(v, 'clip'))
    // Someone at Studio: everything waits a moment, and keys held are let go.
    const before = lines(inputs).length
    fs.writeFileSync(`${inputs}.local`, String(Date.now()))
    await v.wait((s) => msg(s, 'paused'), 3000)
    await sleep(150)
    const released = lines(inputs).slice(before)
    ok(!!msg(v, 'paused') && released.some((x) => x.t === 'key' && x.code === 'MetaLeft' && !x.down) && released.some((x) => x.t === 'key' && x.code === 'KeyC' && !x.down), 'someone at Studio moves its mouse: the viewer is told it\'s paused, and the keys it held are let go', { paused: msg(v, 'paused'), released })
    const mid = lines(inputs).length
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.1, y: 0.1 }] })
    await sleep(500)
    ok(lines(inputs).length === mid, 'while paused, nothing it sends is pressed')
    await sleep(3000)
    await v.send({ t: 'input', evs: [{ t: 'key', code: 'ShiftLeft', down: true }] })
    ok(!!(await until(() => lines(inputs).length > mid, 3000, 100)), 'a moment later, it is again')
    // Stop at Studio.
    const st = await studio.api('/remote')
    const s = st.sessions[0]
    ok(st.sessions.length === 1 && s.by.name === 'Phone' && s.controlled, 'Studio lists the session, with who and that it\'s controlling', st.sessions)
    const stopFromPhone = await ph.request('POST', `/api/remote/sessions/${s.id}/stop`)
    ok(stopFromPhone.status === 403, 'a session is stopped at Studio, not from a device', stopFromPhone.json)
    const n = lines(inputs).length
    await studio.api(`/remote/sessions/${s.id}/stop`, {})
    await v.wait((x) => msg(x, 'ended') && x.closed, 5000)
    ok(msg(v, 'ended')?.why === 'here' && /Stopped on Studio/.test(msg(v, 'ended').text), 'Stop at Studio: the viewer is told, and the session ends', v.msgs.slice(-3))
    ok(lines(inputs).slice(n).some((x) => x.t === 'key' && x.code === 'ShiftLeft' && !x.down), 'with any key still held let go')
    const e = (await studio.api('/remote')).log[0]
    ok(e.end === 'here' && e.controlled === true && e.control === true, 'the log says it was stopped at Studio, and controlled', e)
    await studio.api('/remote/control', { on: false })
  })

  // ---------- through Laptop, and the notice after ----------
  await part('through another computer, and the notice after', async () => {
    const v = local(laptop, `/m/${S.id}/api/remote/view?source=screen:`)
    await v.wait((s) => msg(s, 'hello') && s.frames.length)
    ok(!!msg(v, 'hello') && v.frames[0]?.f?.w === 1280, 'Laptop sees Studio\'s screen through its link')
    v.close()
    // A phone paired with Laptop, looking at Studio through it.
    const lp = await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Pocket', about: { name: 'Pocket' } })
    const lph = over(lp)
    const v2 = lph.socket(`/m/${S.id}/api/remote/view?source=screen:`)
    await v2.wait((s) => msg(s, 'hello'))
    ok(!!msg(v2, 'hello'), 'a phone paired with Laptop sees Studio through it')
    await v2.close()
    await until(async () => !(await studio.api('/remote')).sessions.length, 5000, 100)
    const st = await studio.api('/remote')
    const viaLaptop = st.log.find((x) => x.by.name === 'Laptop' && x.for === 'Pocket')
    ok(!!viaLaptop && viaLaptop.by.kind === 'computer' && st.log.some((x) => x.by.name === 'Laptop' && !x.for), 'Studio\'s log: Laptop, and Laptop for Pocket', st.log.slice(0, 3).map((x) => [x.by.name, x.for]))
    ok(st.unseen.length >= 3, 'each is a notice at Studio until it\'s seen', st.unseen.length)
    const fromPhone = await ph.request('POST', '/api/remote/seen')
    ok(fromPhone.status === 403 && (await studio.api('/remote')).unseen.length >= 3, 'a device can\'t clear them')
    await studio.api('/remote/seen', {})
    ok(!(await studio.api('/remote')).unseen.length, 'Studio itself can')
    lph.stop()
  })

  // ---------- the Beta Feature off ----------
  await part('the Beta Feature off at Studio', async () => {
    await studio.api('/settings', { trials: { 'remote-screen': false } }, 'PATCH')
    const v = ph.socket('/api/remote/view?source=screen:')
    await v.wait((s) => msg(s, 'error'))
    ok(msg(v, 'error')?.code === 'trial' && /Remote Screen and Preview is off on Studio/.test(msg(v, 'error').why), 'nothing is seen, and the viewer is told why', msg(v, 'error'))
    const pv = await ph.request('GET', '/_preview/5173/')
    ok(pv.status === 404 && pv.json?.trial === 'remote-screen', 'nor any app', pv.json)
    await studio.api('/settings', { trials: { 'remote-screen': true } }, 'PATCH')
  })

  // ---------- a project's app ----------
  const project = path.join(studio.home, 'webapp')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'dev.mjs'), DEV)
  studio.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await studio.api('/agents/catalog')
  const pane = (await studio.api('/agents/launch', { kind: 'claude', cwd: project, label: 'Web app', newSpace: 'Web app' })).paneId
  const dport = await freePort()
  const dev = spawn(process.execPath, [path.join(project, 'dev.mjs'), String(dport), laptop.url], { cwd: project, stdio: 'ignore', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } })
  procs.push(dev)
  // ...and one that isn't any agent's (started elsewhere).
  const elsewhere = path.join(studio.home, 'elsewhere')
  fs.mkdirSync(elsewhere, { recursive: true })
  fs.copyFileSync(path.join(project, 'dev.mjs'), path.join(elsewhere, 'dev.mjs'))
  const oport = await freePort()
  const other = spawn(process.execPath, [path.join(elsewhere, 'dev.mjs'), String(oport)], { cwd: elsewhere, stdio: 'ignore' })
  procs.push(other)
  ok(!!(await until(async () => (await fetch(`http://127.0.0.1:${dport}/landed`).then((r) => r.ok, () => false)) && (await fetch(`http://127.0.0.1:${oport}/landed`).then((r) => r.ok, () => false)), 15000, 200)), 'a dev server runs in the agent\'s folder on Studio, and another elsewhere')
  const listed = await until(async () => (await studio.api(`/agents/${enc(pane)}/servers`)).servers.find((s) => s.port === dport), 15000, 500)
  ok(!!listed, 'Studio lists it as the agent\'s', listed)

  let addr = null
  await part('a project\'s app at an address of its own on Laptop', async () => {
    addr = await laptop.api(`/machines/${S.id}/preview`, { port: dport })
    ok(/^http:\/\/127\.0\.0\.1:\d+\/$/.test(addr.url) && addr.port !== dport, 'Laptop gives it an address on 127.0.0.1, a port of its own', addr)
    const pageRes = await fetch(addr.url)
    ok(pageRes.status === 200 && /Hello from the dev app/.test(await pageRes.text()), 'its page, through the link')
    const js = await fetch(`${addr.url}src/main.js`).then((r) => r.text())
    ok(/dataset\.js = "ran"/.test(js), 'and its own files at their absolute paths')
    const go = await fetch(`${addr.url}go`, { redirect: 'manual' })
    ok(go.status === 302 && go.headers.get('location') === '/landed?x=1', 'a redirect to itself stays on its address', go.headers.get('location'))
    const login = await fetch(`${addr.url}login`)
    const set = login.headers.getSetCookie?.() || []
    ok(set.some((c) => /^sid=abc123/.test(c)) && set.some((c) => /^theme=dark/.test(c) && !/domain=/i.test(c)), 'its cookies come back as its own (a Domain left off, so they stick to its address)', set)
    const who = await fetch(`${addr.url}whoami`, { headers: { cookie: `sid=abc123; bridge-ai-${laptop.port}=secret-of-laptop; bridge-ai-7420=another`, authorization: 'Bearer app-token', origin: addr.url.replace(/\/$/, '') } }).then((r) => r.json())
    ok(who.cookie === 'sid=abc123' && who.auth === 'Bearer app-token' && who.host === `localhost:${dport}` && who.origin === `http://localhost:${dport}` && !who.bridge.length, 'it gets its cookies and its Authorization, never Bridge AI\'s cookie or key; its Host and Origin are its own', who)
    const echo = await fetch(`${addr.url}echo`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'posted body' }).then((r) => r.json())
    ok(echo.got === 'posted body' && echo.type === 'text/plain', 'a POST, with its body', echo)
    const hmr = await new Promise((resolve) => {
      const ws = new WebSocket(`${addr.url.replace(/^http/, 'ws')}hmr`, 'vite-hmr')
      const tm = setTimeout(() => resolve({ timeout: true }), 10000)
      ws.on('open', () => ws.send('ping'))
      ws.on('message', (d) => { clearTimeout(tm); resolve({ said: String(d), proto: ws.protocol }); ws.close() })
      ws.on('error', (e) => { clearTimeout(tm); resolve({ error: e.message }) })
    })
    ok(hmr.said === 'pong:ping:vite-hmr' && hmr.proto === 'vite-hmr', 'its hot reload: a WebSocket, with the subprotocol it asks for, both ways', hmr)
    const evil = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: addr.port, path: '/', headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode) }).on('error', () => resolve(0)))
    ok(evil === 403, 'a Host that isn\'t its address (a name pointed at 127.0.0.1) is turned away', evil)
    const api = await fetch(`${laptop.url}/api/config`, { headers: { origin: addr.url.replace(/\/$/, ''), cookie: `bridge-ai-${laptop.port}=x` } })
    ok(api.status === 403, 'Laptop\'s API refuses a request from its page', api.status)
  })

  await part('only an agent\'s dev servers', async () => {
    const own = await fetch(`${laptop.url}/api/machines/${S.id}/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ port: studio.port }) })
    const ownJ = await own.json()
    ok(own.status === 409 && new RegExp(`Port ${studio.port} isn't one of the apps Studio serves`).test(ownJ.error), 'Bridge AI\'s own port on Studio: refused, saying why', ownJ)
    if (IS_WIN) skip('a server started outside every agent\'s folder is refused', 'Windows can\'t tell which folder a process started in, so every local web server is listed there')
    else {
      const o = await fetch(`${laptop.url}/api/machines/${S.id}/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ port: oport }) })
      ok(o.status === 409, 'a server started outside every agent\'s folder: refused', await o.json())
    }
    const direct = await ph.request('GET', `/_preview/${studio.port}/api/config`)
    ok(direct.status === 403, 'nor straight through the link', direct.json)
    const local1 = await fetch(`${studio.url}/_preview/${dport}/`, { headers: { authorization: `Bearer ${studio.key}` } })
    ok(local1.status === 403, 'Studio\'s /_preview/ is for its other devices only, not a page of its own', local1.status)
    const viaLink = await ph.request('GET', `/_preview/${dport}/go`)
    const loc = viaLink.headers.find(([k]) => k === 'location')?.[1]
    ok(viaLink.status === 302 && loc === `/_preview/${dport}/landed?x=1`, 'through the link beside Bridge AI\'s page, a redirect stays under its own path', loc)
    const cookieBack = (await ph.request('GET', `/_preview/${dport}/login`)).headers.find(([k]) => k === 'x-bridge-preview-set-cookie')
    ok(!!cookieBack && JSON.parse(cookieBack[1]).length === 2, 'and its cookies come in a header of their own (the link carries no Set-Cookie)', cookieBack)
  })

  await part('on a phone: pictures drawn at Studio', async () => {
    const v = ph.socket(`/api/remote/view?source=page:${dport}&w=390&h=700`)
    await v.wait((s) => msg(s, 'hello') && s.frames.length)
    ok(msg(v, 'hello')?.source.kind === 'page' && /Preview of port/.test(Buffer.from(v.frames[0].f.bytes).toString('utf8')), 'the phone gets the app as pictures (the stand-in\'s)', msg(v, 'hello'))
    await v.send({ t: 'input', evs: [{ t: 'down', b: 0, x: 0.2, y: 0.2 }, { t: 'text', s: 'typed' }] })
    ok(!!(await until(() => lines(inputs).some((x) => x.page === dport && x.t === 'text' && x.s === 'typed'), 4000, 100)), 'its taps and typing go to that page, without control being on (it\'s the app, not the computer)')
    await v.close()
    const bad = ph.socket(`/api/remote/view?source=page:${studio.port}`)
    await bad.wait((s) => msg(s, 'error'))
    ok(msg(bad, 'error')?.code === 'port', 'Bridge AI\'s own port: refused', msg(bad, 'error'))
    await until(async () => !(await studio.api('/remote')).sessions.length, 5000, 100)
    ok((await studio.api('/remote')).log.some((e) => e.kind === 'page' && e.source.port === dport && e.controlled), 'kept in the log too')
  })

  // ---------- the desktop app's side, with Electron stood in for ----------
  await part('the desktop app: capture window, badge, an app drawn off screen', async () => {
    const { create } = createRequire(import.meta.url)(path.join(ROOT, 'desktop', 'remote.js'))
    const wins = []
    const sent = []
    const posts = []
    class Win {
      constructor(o) {
        this.o = o; this.on_ = {}; wins.push(this)
        const wc = { on_: {}, on: (e, f) => { wc.on_[e] = f }, setWindowOpenHandler: (f) => { wc.open = f }, setFrameRate: (r) => { wc.rate = r }, sendInputEvent: (ev) => sent.push(ev) }
        this.webContents = wc
      }
      loadURL(u) { this.url = u; return Promise.resolve() }
      on(e, f) { this.on_[e] = f }
      once(e, f) { this.on_[e] = f }
      isDestroyed() { return !!this.gone }
      destroy() { this.gone = true; this.on_.closed?.() }
      setAlwaysOnTop(...a) { this.top = a }
      setVisibleOnAllWorkspaces() {}
      showInactive() { this.shown = true }
      setContentSize(w, h) { this.size = [w, h] }
    }
    let access = 'granted'
    const desk = create({
      BrowserWindow: Win,
      desktopCapturer: { getSources: async () => [{ id: 'screen:1:0', name: 'Entire Screen', display_id: '1' }, { id: 'window:42:0', name: 'Notes' }, { id: 'window:43:0', name: 'Bridge AI screen sharing' }] },
      screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, size: { width: 1512, height: 982 }, scaleFactor: 2 }], getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 25, width: 1512, height: 900 } }) },
      systemPreferences: { getMediaAccessStatus: () => access },
      session: { fromPartition: (n) => ({ name: n, setPermissionRequestHandler: (f) => { f(null, 'media', (ok) => { posts.push(['perm', ok]) }) } }) },
      nativeTheme: { shouldUseDarkColors: false }, URL_BASE: 'http://127.0.0.1:1', preload: '/preload.js', platform: 'darwin', keyFor,
      fetch: async (u, o) => { posts.push([u, o]); return { status: 200 } },
    })
    const src = await desk.sources()
    ok(src.permission === 'ok' && src.sources.length === 2 && src.sources[0].kind === 'screen' && src.sources[0].w === 3024 && src.sources[0].primary && src.sources[0].bounds.width === 1512 && src.sources[1].name === 'Notes', 'its screens (in pixels, with where each sits, in points) and windows, never its own', src)
    access = 'not-determined'
    ok(desk.permission() === 'ask', 'macOS not asked yet: said so (asked the first time someone looks)')
    access = 'granted'
    desk.onEvent({ t: 'need-capture' })
    const cap = wins.find((w) => /remote=capture/.test(w.url || ''))
    ok(!!cap && cap.o.show === false && cap.o.webPreferences.backgroundThrottling === false && cap.o.webPreferences.sandbox, 'the capture page opens in a window that never shows, sandboxed', cap?.o)
    desk.onEvent({ t: 'capture-idle' })
    ok(cap.gone, 'and closes when nothing has been seen for a while')
    desk.onEvent({ t: 'sessions', list: [{ id: 'a', kind: 'screen' }] })
    const badge = wins.find((w) => /remote=badge/.test(w.url || ''))
    badge?.on_['ready-to-show']?.()
    ok(!!badge && badge.top?.[0] === true && badge.top[1] === 'screen-saver' && badge.o.frame === false && badge.shown, 'while anyone looks, the badge: over everything, without taking the focus', badge?.o)
    desk.onEvent({ t: 'sessions', list: [] })
    ok(badge.gone, 'and it goes when nobody does')
    desk.onEvent({ t: 'control', on: true })
    ok(desk.controlOn() === true, 'control on here: the Accessibility question is about it too (permissions.js control)')
    desk.onEvent({ t: 'page-start', session: 's1', port: 5173, w: 390, h: 700, rate: 2 })
    const pg = wins.find((w) => w.url === 'http://localhost:5173/')
    ok(!!pg && pg.o.webPreferences.offscreen === true && pg.o.webPreferences.session?.name === 'persist:bridge-preview' && posts.some((x) => x[0] === 'perm' && x[1] === false), 'a project\'s app for a phone: drawn off screen, in a session of its own that asks for nothing', pg?.o)
    let stopped = false
    pg.webContents.on_['will-navigate']({ preventDefault: () => { stopped = true } }, 'https://elsewhere.example/')
    ok(stopped && pg.webContents.open?.().action === 'deny', 'it stays on its own app: a link elsewhere isn\'t followed, nor a new window opened')
    pg.webContents.on_.paint({}, {}, { toJPEG: () => Buffer.from('jpeg!'), getSize: () => ({ width: 390, height: 700 }) })
    await until(() => posts.some((x) => /\/api\/remote\/sessions\/s1\/frame$/.test(x[0])), 3000, 50)
    const post = posts.find((x) => /\/frame$/.test(String(x[0])))
    ok(!!post && post[1].headers['x-frame-w'] === '390' && String(post[1].body) === 'jpeg!', 'what it draws goes to the server as pictures', post?.[1]?.headers)
    desk.onEvent({ t: 'page-input', session: 's1', evs: [{ t: 'down', b: 0, x: 0.5, y: 0.5 }, { t: 'key', code: 'Enter', down: true }, { t: 'text', s: 'hi' }, { t: 'wheel', dx: 0, dy: 100, x: 0.5, y: 0.5 }] })
    ok(sent.some((e) => e.type === 'mouseDown' && e.x === 195 && e.y === 350 && e.button === 'left') && sent.some((e) => e.type === 'keyDown' && e.keyCode === 'Enter') && sent.filter((e) => e.type === 'char').map((e) => e.keyCode).join('') === 'hi' && sent.some((e) => e.type === 'mouseWheel' && e.deltaY === -100), 'taps, keys, typing and scrolling go to that page', sent)
    desk.onEvent({ t: 'page-stop', session: 's1' })
    ok(pg.gone, 'and it closes when the phone stops looking')
  })

  // ---------- in the browser ----------
  ;({ b } = await browser())
  const which = b.browserType().name()
  const tag = which === 'webkit' ? 'webkit-' : ''
  const errors = []
  await part('Laptop: View screen, pictures through the relay, Control', async () => {
    const { p, errors: e1 } = await page(b, laptop.url)
    errors.push(...e1)
    await devices(p)
    const view = p.locator('.mch-row', { hasText: 'Studio' }).getByRole('button', { name: 'View screen' })
    await view.waitFor({ timeout: 15000 })
    await view.click()
    const img = p.locator('.rs-view img.rs-media')
    ok(!!(await until(async () => (await img.getAttribute('src').catch(() => ''))?.startsWith('blob:'), 15000)), 'View screen opens Studio\'s screen, its pictures shown')
    ok(/Through the relay \(slower\)/.test(await p.locator('.rs-mode').innerText()), 'and says it comes through the relay, slower')
    ok(await p.locator('.rs-view').getByText('View only').isVisible(), 'View only: Studio hasn\'t allowed control')
    await shot(p, `${tag}remote-screen-view`)
    await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    await studio.api('/remote/control', { on: true })
    await devices(p)
    await view.click()
    const control = p.locator('.rs-bar').getByRole('button', { name: 'Control' })
    await control.waitFor({ timeout: 15000 })
    await control.click()
    await until(async () => (await img.getAttribute('src').catch(() => ''))?.startsWith('blob:'), 10000)
    const n = lines(inputs).length
    const box = await p.locator('.rs-stage').boundingBox()
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await p.keyboard.press('KeyA')
    const got = await until(() => { const l = lines(inputs).slice(n); return l.some((x) => x.t === 'up') && l.some((x) => x.code === 'KeyA') ? l : null }, 8000, 100)
    ok(!!got, 'Control: a click and a key on Studio\'s screen are pressed there', lines(inputs).slice(n))
    // Studio: the line saying it's being seen, with Stop.
    const st = await page(b, studio.url)
    errors.push(...st.errors)
    const line = st.p.locator('.rs-here')
    await line.waitFor({ timeout: 10000 })
    ok(/Laptop is controlling this screen|Laptop is viewing this screen/.test(await line.innerText()), 'Studio says it\'s being seen, and by which device', await line.innerText())
    await shot(st.p, `${tag}remote-screen-studio-seen`)
    // The desktop app's badge, the same page in a window of its own.
    const badge = await page(b, `${studio.url}/?remote=badge`, { width: 460, height: 58 })
    ok(!!(await until(async () => /Laptop is (viewing|controlling) this screen/.test(await badge.p.locator('.rs-badge').innerText().catch(() => '')), 8000)) && await badge.p.getByRole('button', { name: 'Stop' }).isVisible(), 'the desktop app\'s badge says who, with Stop', await badge.p.locator('.rs-badge').innerText().catch(() => ''))
    await shot(badge.p, `${tag}remote-screen-badge`)
    await badge.ctx.close()
    await line.getByRole('button', { name: 'Stop' }).click()
    ok(!!(await until(async () => /Stopped on Studio/.test(await p.locator('.rs-view').innerText()), 8000)), 'Stop on Studio: the viewer says so')
    const notice = st.p.locator('.rs-here')
    ok(!!(await until(async () => /Laptop (viewed|controlled) this screen for/.test(await notice.innerText().catch(() => '')), 8000)), 'and Studio says afterwards who looked, and for how long', await notice.innerText().catch(() => ''))
    await notice.getByRole('button', { name: 'Got it' }).click()
    ok(!!(await until(async () => !(await st.p.locator('.rs-here').count()), 6000)), 'Got it clears it')
    await devices(st.p)
    const sec = st.p.locator('[data-setting=remote-screen]')
    await sec.waitFor({ timeout: 10000 })
    ok(await sec.getByRole('switch', { name: /Let my other devices control this computer/ }).isChecked(), 'Studio\'s Settings: "Let my other devices control this computer", on')
    ok(/Laptop/.test(await st.p.locator('[data-setting=remote-sessions]').innerText()), 'and the record of each session')
    await sec.getByRole('switch', { name: /Let my other devices control this computer/ }).click()
    ok(!!(await until(async () => !(await studio.api('/remote')).control.on, 5000)), 'turned off there')
    await shot(st.p, `${tag}remote-screen-settings`)
    await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    await st.ctx.close()
    await p.context().close()
  })

  await part('peer-to-peer, where the browser can', async () => {
    const cap = await page(b, `${studio.url}/?remote=capture&fake=1`)
    const can = await cap.p.evaluate(() => typeof RTCPeerConnection === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function')
    if (!can) { skip('peer-to-peer between two pages', `${which} here has no WebRTC or canvas capture`); await cap.ctx.close(); return }
    await until(async () => (await studio.api('/remote')).screen.p2p, 8000)
    const { p } = await page(b, laptop.url)
    await ready(p)
    await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-view-screen', { detail: { machine: id, name: 'Studio' } })), S.id)
    // Direct, or (where this browser can't connect two of its pages peer-to-peer: WebKit hides its own
    // addresses behind names only it can look up) the relay after the wait, with pictures.
    const mode = await until(async () => { const m = await p.locator('.rs-mode').innerText().catch(() => ''); return /Direct|Through the relay/.test(m) ? m : null }, 20000)
    if (/Direct/.test(mode || '')) {
      ok(true, 'the capture page on Studio and the viewer meet peer-to-peer: Direct')
      ok(!!(await until(async () => p.locator('.rs-view video').evaluate((v) => v.videoWidth > 0 && !v.hidden), 10000)), 'and the screen plays as video')
      await sleep(500)
      await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
      await until(async () => !(await studio.api('/remote')).sessions.length, 5000, 100)
      ok((await studio.api('/remote')).log[0].via === 'p2p', 'Studio\'s log says it went direct', (await studio.api('/remote')).log[0])
    } else {
      skip('peer-to-peer between two pages', `${which} here didn't connect two of its own pages peer-to-peer`)
      ok(/Through the relay/.test(mode || '') && !!(await until(async () => (await p.locator('.rs-view img.rs-media').getAttribute('src').catch(() => ''))?.startsWith('blob:'), 15000)), 'peer-to-peer failing, the capture page\'s pictures come through the relay instead, and say so', mode)
      await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
      await until(async () => !(await studio.api('/remote')).sessions.length, 5000, 100)
      ok((await studio.api('/remote')).log[0].via === 'relay', 'Studio\'s log says it came through the relay', (await studio.api('/remote')).log[0])
    }
    await cap.ctx.close()
    await p.context().close()
  })

  await part('the agent\'s Preview tab on Laptop', async () => {
    const port = (await laptop.api('/machines')).machines.find((m) => m.id === S.id)?.port
    const { p, errors: e2 } = await page(b, `http://127.0.0.1:${port}/m/${S.id}/?window=${enc(pane)}`)
    errors.push(...e2)
    await p.getByRole('tab', { name: 'Preview' }).or(p.getByRole('button', { name: 'Preview' })).first().click()
    const frame = p.locator('iframe.preview-frame')
    await frame.waitFor({ timeout: 20000 })
    const src = await frame.getAttribute('src')
    ok(src?.startsWith(addr?.url || 'http://127.0.0.1:') && !src.includes(`:${dport}/`), 'the Preview of Studio\'s agent shows Studio\'s app at its own address on Laptop, not Laptop\'s localhost', src)
    const inner = p.frameLocator('iframe.preview-frame').locator('#hello')
    ok(!!(await until(async () => (await inner.getAttribute('data-js')) === 'ran' && (await inner.getAttribute('data-hmr')) === 'pong:ping:vite-hmr', 15000)), 'it runs there, its hot reload connected')
    const api = await until(async () => inner.getAttribute('data-api'), 8000)
    ok(api === 'blocked' || api === '403', 'and its page can\'t use Laptop\'s API', api)
    ok(!!(await p.locator('.preview-bar a[href^="http://127.0.0.1:"]').count()), 'Open in a browser on this computer: its address here')
    await shot(p, `${tag}remote-screen-preview`)
    await p.context().close()
  })
  ok(!errors.length, 'no page errors', errors.slice(0, 3))
  t1.stop()
  ph.stop()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) say(k.log().slice(-2500))
} finally {
  for (const x of procs) stopTree(x)
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  await b?.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
