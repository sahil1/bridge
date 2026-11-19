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
//   the guardrails, each set at Studio only: the Remote Access Password (kept as a salted scrypt hash,
//     never sent to a device nor in a log nor in the clear through the relay), asked of every screen
//     session before anything is taken; 5 wrong tries lock that device out for 15 minutes (in the
//     record, Unlock at Studio); control needs the password; Ask Here First (Deny, Allow, no answer is
//     a no); which devices may connect (one unticked mid-session is cut off); control back to
//     view-only without input, and taken again;
//   another screen in the same session (no reconnect), and the pointer at the right place on a 5K
//     display at twice its points, a portrait one left of the main one, and a 1440 x 900 one, with
//     fitting and pointer maths at those sizes, the capture size, bitrate and the answer's codecs;
//   the Beta Feature off at Studio: nothing seen, and said why;
//   a screen that doesn't start ("Desk", its desktop app stood in for): a cold start slower than one
//     wait, a capture window that never loads, the app's feed coming back, each waited for and
//     healed with nothing said; no capture page, one that never lists its screens, the app closed,
//     Screen Recording turned down, each said exactly, with the fix (Reopen, Open, Allow Screen
//     Recording) carried out in the same session, the password not asked again; Reopen as a device
//     from before fixes knows it; each in Desk's log, and what the viewer showed in its own;
//   a project's app on Studio, at an address of its own on Laptop: its page, its absolute paths, a
//     redirect to itself, its cookies (never Bridge AI's own), a POST, its hot reload's WebSocket (with
//     the subprotocol it asks for); only a port Studio lists as one of an agent's dev servers, never
//     Bridge AI's own nor one started elsewhere; a Host that isn't the address turned away; its page
//     can't use Laptop's API; on a phone, as pictures drawn at Studio, taps going to that page;
//   the desktop app's side: the badge for an ask, the viewer's window of its own on the display it's
//     asked from, fitted to the screen's shape, sized by hand kept for that computer; the capture
//     window opened fresh when asked, loaded again or closed when it doesn't load or hangs, the app
//     kept from napping meanwhile, the display woken and kept awake while viewed;
//   in the browser (BRIDGE_TEST_BROWSER): Settings › Devices › Computers on Laptop, View screen, the
//     password asked for (a wrong one said), the pictures through the relay (said slower), filling the
//     stage with their shape kept, another screen picked in the session, Control once Studio allows
//     it, the pointer right in Fit and Actual Size on a 5K and a portrait screen; light and dark, the
//     states centred and readable (macOS not allowing it, with Try again); at a phone's width, fitted,
//     pinched to zoom, locked out and told no with why; the badge's Allow; on Studio, the line saying
//     it's being seen, Stop, the notice after, Remote Access set in Settings (and shown, not changed,
//     from another computer's window) and Screen Activity; each reason a screen doesn't
//     show, said with the button that fixes it (Reopen, Open, Allow Screen Recording, Update), on a
//     computer and a phone; peer-to-peer between two pages where the
//     browser can (the capture page on Studio, with a canvas), said Direct; the agent's Preview tab
//     on Laptop showing Studio's app at its own address, never Laptop's localhost;
//   Which screen?: each display by its own name and size (desktop/remote.js, Electron stood in for, as
//     a Mac, Windows and Linux give them), a still of each in a session only, asked first on a phone;
//   your other devices told (BRIDGE_TEST_PUSH: what each would be sent): a session, control taken and
//     an ask, never to the device viewing, with Stop and Block This Device carried out at Studio, and
//     a device through Laptop blocked on Laptop; the card in every other window; Settings saying where
//     they go, and with nowhere set up, saying so;
//   a phone through its relay page (the apps' page), end to end, through the relay and peer-to-peer.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import WebSocket, { WebSocketServer } from 'ws'
import { startKit, startRelay, checks, until, browser, page, sleep, shot, changeAnswer, noServiceWorker, phoneFaults, ROOT, TEST, IS_WIN, freePort, stopTree } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'
import { K, json, text } from '../../relay/web/link.js'
import { unpackFrame, keyFor, fitIn, pointAt, captureSize, bitrateFor, sdpBitrate } from '../../shared/remote.js'

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
  s.ws = ws
  ws.on('message', (d, bin) => { if (bin) s.frames.push({ at: Date.now(), f: unpackFrame(new Uint8Array(d)) }); else { try { s.msgs.push(JSON.parse(String(d))) } catch { s.msgs.push(String(d)) } } })
  ws.on('close', (c) => { s.closed = { c } })
  ws.on('error', () => {})
  s.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m))
  s.close = () => ws.close()
  s.wait = (fn, ms = 10000) => until(async () => fn(s), ms, 50)
  return s
}
const msg = (s, t) => s.msgs.find((m) => m.t === t)
const msgs = (s, t) => s.msgs.filter((m) => m.t === t)

// The desktop app on a computer being seen, stood in for (desktop/remote.js and main.js): its own
// feed (/api/events, as the app's), and on need-capture its capture page (/api/remote/capture),
// as how says: after (ms before the page connects), list (ms before it says its screens), hang (it
// never connects), hangFirst (only the first time it's asked), mute (it connects and never says),
// and the permission and screens it says. drop(): the page gone (its window closed); quit(): the
// app gone. events: what the server told the app.
const DESK_SCREENS = [{ id: 'screen:1:0', name: 'Built-in Retina Display', kind: 'screen', w: 3024, h: 1964, primary: true, scale: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } }]
function deskApp(kit, how = {}) {
  const d = { how, events: [], page: null, gone: false, asked: 0 }
  const ac = new AbortController()
  let opening = false
  const say = (cap, t) => cap.send({ t, sources: d.how.sources || DESK_SCREENS, permission: d.how.permission || 'ok', ...(d.how.none ? { none: d.how.none } : {}), p2p: false })
  const open = () => {
    if (d.how.hang || (d.how.hangFirst && d.asked === 1)) return
    opening = true
    setTimeout(() => {
      opening = false
      if (d.gone) return
      const cap = local(kit, '/api/remote/capture')
      d.page = cap
      cap.ws.on('open', () => { if (!d.how.mute) setTimeout(() => say(cap, 'hello'), d.how.list || 0) })
      cap.ws.on('message', (m) => { let x = null; try { x = JSON.parse(String(m)) } catch { /* not JSON */ } if (x?.t === 'sources?' && !d.how.mute) say(cap, 'sources') })
    }, d.how.after || 0)
  }
  d.drop = () => { const p = d.page; d.page = null; p?.close() }
  d.quit = () => { d.gone = true; ac.abort(); d.drop() }
  fetch(`${kit.url}/api/events`, { headers: { Accept: 'text/event-stream', 'x-bridge-desktop': '3.22.0', authorization: `Bearer ${kit.key}` }, signal: ac.signal }).then(async (r) => {
    const dec = new TextDecoder()
    let buf = ''
    for await (const c of r.body) {
      buf += dec.decode(c, { stream: true })
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (!/^event: remote$/m.test(block)) continue
        let ev = null
        try { ev = JSON.parse(block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')) } catch { continue }
        d.events.push(ev)
        if (ev.t !== 'need-capture') continue
        d.asked++
        if (ev.fresh) d.drop()
        if (!opening && (!d.page || d.page.closed)) open()
      }
    }
  }).catch(() => {})
  return d
}
// Studio's Remote Access Password, once it's set.
const PW = 'correct horse 42'
// A session past the password when Studio asks for one: its hello, or null (what it was told is in
// its messages).
async function through(v, pw = PW) {
  await v.wait((s) => msg(s, 'password') || msg(s, 'hello') || msg(s, 'error'))
  if (msg(v, 'password') && !msg(v, 'hello') && !msg(v, 'error')) {
    const n = msgs(v, 'password').length
    await v.send({ t: 'password', p: pw })
    await v.wait((s) => msg(s, 'hello') || msg(s, 'error') || msgs(s, 'password').length > n)
  }
  return msg(v, 'hello') || null
}
// The newest line written for each pointer move since n.
const movesSince = (f, n) => lines(f).slice(n).filter((x) => x.t === 'move')
// Once the app is there (its top bar), Settings › Devices › Computers.
const ready = (p) => p.locator('.settings-btn').waitFor({ timeout: 20000 })
// One of the app's own events, sent again until what it opens is there: the app listens from an
// effect, after it's first drawn, so one sent the moment the top bar shows can come before that.
const sendUntil = async (p, name, detail, shows) => {
  for (let i = 0; i < 20; i++) {
    await p.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n, { detail: d })), [name, detail])
    if (await p.locator(shows).first().waitFor({ timeout: 500 }).then(() => true, () => false)) return
  }
}
const devices = async (p) => { await ready(p); await sendUntil(p, 'bridge-open-settings', { section: 'machines' }, '.modal.settings') }
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
  // What each would send its devices as notifications (BRIDGE_TEST_PUSH: push.js writes them here).
  const pushS = path.join(TEST, '.out', `remote-screen-push-studio-${process.pid}.jsonl`)
  const pushL = path.join(TEST, '.out', `remote-screen-push-laptop-${process.pid}.jsonl`)
  for (const f of [inputs, clip, `${inputs}.local`, pushS, pushL]) fs.rmSync(f, { force: true })
  const kitWith = async (name, rel, env = {}) => {
    const k = await startKit(`remote-screen-${name.toLowerCase()}`, { config: { trials: { 'remote-screen': true } }, env: (dirs) => { fs.writeFileSync(path.join(dirs.data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_REMOTE_ICE: 'none', ...env } } })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }
  // Ask Here First waits 3 s for an answer here, and control idles back to view-only after 6 s.
  const studio = await kitWith('Studio', ra, { BRIDGE_TEST_SCREEN: 'fake', BRIDGE_TEST_INPUT: inputs, BRIDGE_TEST_CLIPBOARD: clip, BRIDGE_REMOTE_ASK_MS: '3000', BRIDGE_REMOTE_CONTROL_IDLE_MS: '6000', BRIDGE_TEST_PUSH: pushS })
  const laptop = await kitWith('Laptop', rb, { BRIDGE_TEST_PUSH: pushL })
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
    // (The phone paired a moment ago: its name is in once it has said hello.)
    const a = (await until(async () => { const x = (await studio.api('/remote')).access; return x?.devices.some((d) => d.name === 'Phone') ? x : null }, 5000, 100)) || st.access
    ok(a && a.password === false && a.askFirst === false && a.devices.some((d) => d.name === 'Phone' && d.kind === 'phone' && d.allowed) && a.devices.some((d) => d.name === 'Laptop' && d.kind === 'computer' && d.allowed) && a.limits.tries === 5 && a.limits.lockMinutes === 15, 'its guardrails to begin with: no password, Ask Here First off, every paired phone and linked computer allowed', a)
  })

  // ---------- a session through the relay ----------
  let sid = null
  await part('pictures through the relay', async () => {
    const v = ph.socket('/api/remote/view?source=screen:&control=1')
    await v.wait((s) => msg(s, 'hello') && s.frames.length >= 1)
    const h = msg(v, 'hello')
    sid = h?.session
    ok(!!h && h.name === 'Studio' && h.source.name === 'Test screen' && !h.p2p && h.control.allowed === false && /Control needs a Remote Access Password on Studio/.test(h.control.why || ''), 'the phone\'s session: its main screen, as pictures (no peer-to-peer from the stand-in), and control off, saying it needs a password set there first', h)
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

  // ---------- the Remote Access Password ----------
  await part('the Remote Access Password, set at Studio only', async () => {
    const noPw = await studio.api('/remote/control', { on: true }).catch((e) => e)
    ok(noPw.status === 400 && noPw.j?.code === 'needsPassword' && !(await studio.api('/remote')).control.on, 'control can\'t be turned on before a password is set', noPw.j)
    const st0 = await studio.api('/remote')
    ok(st0.control.needs === 'password' && /Remote Access Password/.test(st0.control.why || '') && st0.access.password === false, 'Studio says control needs a password first', st0.control)
    const fromPhone = await ph.request('POST', '/api/remote/password', { password: PW })
    const fromLaptop = await fetch(`${laptop.url}/m/${S.id}/api/remote/password`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ password: PW }) })
    ok(fromPhone.status === 403 && /at Studio itself/.test(fromPhone.json?.error) && fromLaptop.status === 403 && !(await studio.api('/remote')).access.password, 'a phone or another computer can\'t set it: only Studio itself', [fromPhone.json, fromLaptop.status])
    const short = await studio.api('/remote/password', { password: 'abc12' }).catch((e) => e)
    ok(short.status === 400 && /at least 6 characters/.test(short.message), 'too short: refused, saying how long it has to be', short.message)
    const set = await studio.api('/remote/password', { password: PW })
    ok(set.password === true && !!set.passwordAt, 'set at Studio', set)
    const file = path.join(studio.data, 'remote.json')
    const saved = fs.readFileSync(file, 'utf8')
    const pw = JSON.parse(saved).password
    ok(!saved.includes(PW) && pw?.kdf === 'scrypt' && pw.N >= 16384 && Buffer.from(pw.salt, 'base64').length === 16 && Buffer.from(pw.hash, 'base64').length === 32, 'kept as a salted scrypt hash, never as typed', pw && { kdf: pw.kdf, N: pw.N })
    if (!IS_WIN) ok((fs.statSync(file).mode & 0o077) === 0, 'in a file only you can read', (fs.statSync(file).mode & 0o777).toString(8))
    const told = await ph.request('GET', '/api/remote')
    ok(told.json?.access?.password === true && !told.text.includes(pw.hash) && !told.text.includes(pw.salt) && !/"(hash|salt)"/.test(told.text), 'a device is told there is one, never its hash nor its salt')
    const before = await ph.request('GET', '/api/remote?sources=1')
    const own = await studio.api('/remote?sources=1')
    ok(!before.json?.screen?.sources?.length && !before.text.includes('Test window') && !before.text.includes('Studio Display') && own.screen.sources.some((x) => x.kind === 'window'), 'behind the password, a device asking isn\'t told its screens nor its windows\' titles (Which screen? comes in the session); Studio itself is', before.json?.screen?.sources)
    const again = await studio.api('/remote/password', { password: `${PW}!` })
    const hash2 = JSON.parse(fs.readFileSync(file, 'utf8')).password.hash
    ok(again.password && hash2 !== pw.hash, 'changed at Studio: a new hash')
    await studio.api('/remote/password', { password: PW })
  })

  // ---------- control ----------
  await part('control, turned on at Studio only', async () => {
    const fromPhone = await ph.request('POST', '/api/remote/control', { on: true })
    const fromLaptop = await fetch(`${laptop.url}/m/${S.id}/api/remote/control`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ on: true }) })
    ok(fromPhone.status === 403 && /at Studio itself/.test(fromPhone.json?.error) && fromLaptop.status === 403 && !(await studio.api('/remote')).control.on, 'a phone or another computer can\'t turn control on: only Studio itself', [fromPhone.json, fromLaptop.status])
    const on = await studio.api('/remote/control', { on: true })
    ok(on.on === true && on.can && on.via === 'test', 'turned on at Studio', on)
    const v = ph.socket('/api/remote/view?source=screen:fake-2&control=1')
    await through(v)
    ok(!!msg(v, 'password') && msg(v, 'hello')?.control.allowed === true && msg(v, 'hello').source.name === 'Second screen', 'the password first; then a session may control (the screen picked: the second)', msg(v, 'hello'))
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
  })

  // ---------- control back to view-only ----------
  await part('control goes back to view-only without input, and is taken again', async () => {
    await studio.api('/remote/control', { on: true })
    const v = ph.socket('/api/remote/view?source=screen:fake-1&control=1')
    ok((await through(v))?.control.allowed === true, 'a session that may control')
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.1, y: 0.1 }] })
    await v.wait((s) => s.msgs.some((m) => m.t === 'control' && m.idle), 15000)
    const c = v.msgs.find((m) => m.t === 'control' && m.idle)
    ok(c?.allowed === false && /View only now: nothing was pressed/.test(c.why || ''), 'after the idle time without input (6 s here, 10 minutes for real), view-only, and told so', c)
    const n = lines(inputs).length
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.2, y: 0.2 }] })
    await sleep(400)
    ok(lines(inputs).length === n, 'nothing it sends is pressed then')
    const pw0 = msgs(v, 'password').length
    await v.send({ t: 'control', on: true })
    await v.wait((s) => msgs(s, 'password').length > pw0, 5000)
    ok(msgs(v, 'password').at(-1)?.again === true, 'taken again from the viewer, the password first', msgs(v, 'password').at(-1))
    await v.send({ t: 'password', p: PW })
    await v.wait((s) => msgs(s, 'control').at(-1)?.allowed === true, 5000)
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.3, y: 0.3 }] })
    ok(!!(await until(() => lines(inputs).length > n, 3000, 100)), 'Control again from the viewer: it is')
    await v.close()
  })

  // ---------- another screen, and the pointer on each ----------
  await part('another screen in the same session, and the pointer on each', async () => {
    const v = ph.socket('/api/remote/view?source=screen:fake-5k&control=1')
    const h = await through(v)
    ok(h?.source.id === 'fake-5k' && h.source.w === 5120 && h.source.h === 2880 && h.sources.filter((x) => x.kind === 'screen').length === 5 && h.sources.find((x) => x.primary)?.id === 'fake-1', 'a 5K screen picked; its own pixels, and every screen said, the main one marked', h && h.source)
    const at = async (x, y) => { const n = lines(inputs).length; await v.send({ t: 'input', evs: [{ t: 'move', x, y }] }); return until(() => movesSince(inputs, n).at(-1), 4000, 50) }
    const m1 = await at(0.5, 0.5)
    ok(m1?.x === 3584 && m1.y === 720, '5K at twice its points (2560 x 1440, right of the others): the middle of the picture is the middle of that display', m1)
    const m2 = await at(0, 0)
    ok(m2?.x === 2304 && m2.y === 0, 'and its top left corner, its own', m2)
    await v.send({ t: 'source', source: 'screen:fake-portrait' })
    await v.wait((s) => msg(s, 'source'))
    for (let i = 0; i < 6 && v.frames.at(-1)?.f?.h !== 1920; i++) { await v.send({ t: 'ack' }); await sleep(300) }
    const st = await studio.api('/remote')
    ok(msg(v, 'source')?.source.id === 'fake-portrait' && msgs(v, 'hello').length === 1 && v.frames.at(-1)?.f?.w === 1080 && v.frames.at(-1)?.f?.h === 1920 && st.sessions.length === 1 && st.sessions[0].id === h.session, 'another screen (portrait, left of the main one) in the same session: its pictures, with nothing to connect again', { source: msg(v, 'source'), last: v.frames.at(-1)?.f && { w: v.frames.at(-1).f.w, h: v.frames.at(-1).f.h } })
    const m3 = await at(0.25, 0.75)
    ok(m3?.x === -810 && m3.y === 1039, 'the pointer on it: a quarter across and three quarters down that display, left of and above the main one', m3)
    await v.send({ t: 'source', source: 'screen:fake-air' })
    await v.wait((s) => msgs(s, 'source').length === 2)
    const m4 = await at(1, 1)
    ok(m4?.x === 1439 && m4.y === 1699, 'a 1440 x 900 one below: its bottom right corner', m4)
    await v.send({ t: 'source', source: 'window:fake-w1' })
    await v.wait((s) => msgs(s, 'source').length === 3)
    const w = msgs(v, 'source').at(-1)
    const n = lines(inputs).length
    await v.send({ t: 'input', evs: [{ t: 'move', x: 0.5, y: 0.5 }] })
    await sleep(400)
    ok(w.control?.allowed === false && /whole screen/.test(w.control.why || '') && lines(inputs).length === n, 'a window: view-only, saying control works on a whole screen', w.control)
    await v.send({ t: 'source', source: 'screen:fake-1' })
    await v.wait((s) => msgs(s, 'source').length === 4)
    ok(msgs(v, 'source').at(-1).control?.allowed === true, 'and back on a screen, control again')
    const bad = msgs(v, 'error').length
    await v.send({ t: 'source', source: 'screen:nope' })
    await v.wait((s) => msgs(s, 'error').length > bad, 3000)
    ok(msgs(v, 'error').at(-1)?.code === 'source' && msgs(v, 'error').at(-1).keep && !v.closed, 'a screen that isn\'t there: said, and the session goes on')
    await v.close()
    await until(async () => !(await studio.api('/remote')).sessions.length, 5000, 100)
    const e = (await studio.api('/remote')).log[0]
    ok(e.source.name === 'Studio Display' && ['Portrait screen', 'MacBook Air', 'Test window', 'Test screen'].every((x) => e.also?.includes(x)), 'the record says each screen it showed', e)
    await studio.api('/remote/control', { on: false })
  })

  // ---------- a lockout ----------
  let phoneId = null
  await part('five wrong passwords lock that device out for 15 minutes', async () => {
    phoneId = (await studio.api('/remote')).access.devices.find((d) => d.name === 'Phone')?.id
    const v = ph.socket('/api/remote/view?source=screen:')
    await v.wait((s) => msg(s, 'password'))
    const first = msg(v, 'password')
    ok(first.left === 5 && first.tries === 5 && first.lockMinutes === 15 && !first.wrong && !msg(v, 'hello') && !v.frames.length, 'Studio asks for the password before anything of its screen comes: 5 tries', first)
    for (let i = 1; i <= 4; i++) { await v.send({ t: 'password', p: `wrong ${i}` }); await v.wait((s) => msgs(s, 'password').length === i + 1) }
    const fourth = msgs(v, 'password').at(-1)
    ok(fourth.wrong === true && fourth.left === 1, 'each wrong one is said, with the tries left', fourth)
    await v.send({ t: 'password', p: 'wrong 5' })
    await v.wait((s) => msg(s, 'error') && s.closed)
    const e = msg(v, 'error')
    const until15 = new Date(e?.until).getTime() - Date.now()
    ok(e?.code === 'locked' && until15 > 14 * 60000 && until15 <= 15 * 60000 && /Too many wrong passwords/.test(e.why) && !msg(v, 'hello'), 'the fifth: locked out for 15 minutes, told so and until when, and the session goes', e)
    const again = ph.socket('/api/remote/view?source=screen:')
    await again.wait((s) => msg(s, 'error'))
    ok(msg(again, 'error').code === 'locked' && !msg(again, 'password'), 'while locked out it isn\'t even asked: told when it can try again', msg(again, 'error'))
    const st = await studio.api('/remote')
    const entry = st.log.find((x) => x.end === 'locked')
    ok(entry?.by.name === 'Phone' && entry.tries === 5 && !!entry.until && st.access.locks.some((l) => l.id === phoneId) && !!st.access.devices.find((d) => d.id === phoneId)?.locked, 'Studio\'s record says who was locked out, after how many tries, until when, and Settings shows it by the device', entry)
    ok(st.unseen.some((x) => x.end === 'locked'), 'and it\'s a notice at Studio until it\'s seen')
    const lv = local(laptop, `/m/${S.id}/api/remote/view?source=screen:`)
    ok(!!(await through(lv)), 'another device isn\'t locked out by it')
    lv.close()
    const fromPhone = await ph.request('POST', `/api/remote/locks/${encodeURIComponent(phoneId)}/clear`)
    ok(fromPhone.status === 403, 'a device can\'t lift it')
    await studio.api(`/remote/locks/${encodeURIComponent(phoneId)}/clear`, {})
    const back = ph.socket('/api/remote/view?source=screen:')
    const bh = await through(back)
    ok(!!bh && msg(back, 'password')?.left === 5, 'Unlock at Studio: the phone has its 5 tries again, and with the right password sees the screen')
    await back.close()
    ok(!Buffer.concat(t1.seen).toString('latin1').includes(PW) && !studio.log().includes(PW) && !laptop.log().includes(PW), 'the password is never in the clear through the relay, nor in either computer\'s log')
  })

  // ---------- Ask Here First ----------
  await part('Ask Here First', async () => {
    const fromPhone = await ph.request('POST', '/api/remote/ask-first', { on: true })
    ok(fromPhone.status === 403 && !(await studio.api('/remote')).access.askFirst, 'turned on at Studio only')
    await studio.api('/remote/control', { on: true })
    await studio.api('/remote/ask-first', { on: true })
    const asking = async () => {
      const v = ph.socket('/api/remote/view?source=screen:&control=1')
      await v.wait((s) => msg(s, 'password'))
      await v.send({ t: 'password', p: PW })
      await v.wait((s) => msg(s, 'asking') || msg(s, 'error'))
      return v
    }
    const v1 = await asking()
    const a1 = await until(async () => (await studio.api('/remote')).asks[0], 3000, 100)
    ok(!!msg(v1, 'asking') && a1?.by.name === 'Phone' && a1.control === true && !msg(v1, 'hello') && !v1.frames.length, 'after the password, Studio shows Allow or Deny (who, and that it could control); nothing of the screen yet', a1)
    const self = await ph.request('POST', `/api/remote/asks/${a1.id}`, { allow: true })
    ok(self.status === 403, 'the device asking can\'t answer it')
    await studio.api(`/remote/asks/${a1.id}`, { allow: false })
    await v1.wait((s) => msg(s, 'error'))
    ok(msg(v1, 'error').code === 'denied' && /said no/.test(msg(v1, 'error').why) && !msg(v1, 'hello'), 'Deny: told no, and why', msg(v1, 'error'))
    const v2 = await asking()
    const a2 = await until(async () => (await studio.api('/remote')).asks[0], 3000, 100)
    await studio.api(`/remote/asks/${a2.id}`, { allow: true })
    await v2.wait((s) => msg(s, 'hello') && s.frames.length)
    ok(!!msg(v2, 'hello') && v2.frames.length > 0, 'Allow: the screen comes')
    await v2.close()
    const v3 = await asking()
    const t0 = Date.now()
    await v3.wait((s) => msg(s, 'error'), 8000)
    ok(msg(v3, 'error')?.code === 'unanswered' && Date.now() - t0 >= 2000 && /Nobody at Studio answered within 3 seconds/.test(msg(v3, 'error').why), 'no answer in time (3 s here, 30 for real) is a no, said so', msg(v3, 'error'))
    ok(!(await studio.api('/remote')).asks.length, 'and the ask goes from Studio')
    const log = (await studio.api('/remote')).log
    ok(log.some((x) => x.end === 'denied' && x.by.name === 'Phone') && log.some((x) => x.end === 'unanswered' && x.by.name === 'Phone'), 'Studio\'s record keeps each no, and who asked')
    await studio.api('/remote/ask-first', { on: false })
    await studio.api('/remote/control', { on: false })
  })

  // ---------- which devices ----------
  await part('which devices may connect', async () => {
    const devs = (await studio.api('/remote')).access.devices
    const P = devs.find((d) => d.name === 'Phone')
    const L = devs.find((d) => d.name === 'Laptop')
    const fromPhone = await ph.request('POST', '/api/remote/devices', { id: P.id, allowed: false })
    ok(fromPhone.status === 403 && (await studio.api('/remote')).access.devices.every((d) => d.allowed), 'changed at Studio only')
    const lv = local(laptop, `/m/${S.id}/api/remote/view?source=screen:`)
    await through(lv)
    await lv.wait((s) => s.frames.length)
    await studio.api('/remote/devices', { id: L.id, allowed: false })
    await lv.wait((s) => msg(s, 'error') && s.closed, 5000)
    ok(msg(lv, 'error')?.code === 'device' && /stopped letting this device connect/.test(msg(lv, 'error').why), 'Laptop unticked while it looks: its session ends, and it\'s told why', msg(lv, 'error'))
    const again = local(laptop, `/m/${S.id}/api/remote/view?source=screen:`)
    await again.wait((s) => msg(s, 'error'))
    ok(msg(again, 'error').code === 'device' && !msg(again, 'password') && /doesn't let Laptop connect/.test(msg(again, 'error').why), 'and it can\'t connect again, not even asked for the password', msg(again, 'error'))
    await studio.api('/remote/devices', { id: P.id, allowed: false })
    const pv = await ph.request('GET', '/_preview/5173/')
    ok(pv.status === 403 && pv.json?.code === 'notLetIn', 'nor see its apps', pv.json)
    const st = await studio.api('/remote')
    ok(!st.access.devices.find((d) => d.id === L.id).allowed && st.log.some((x) => x.end === 'device' && x.by.name === 'Laptop' && !x.source) && st.log.some((x) => x.end === 'device' && x.source), 'Studio\'s record: the session cut off, and the try after it', st.log.slice(0, 3).map((x) => [x.by.name, x.end]))
    await studio.api('/remote/devices', { id: L.id, allowed: true })
    await studio.api('/remote/devices', { id: P.id, allowed: true })
    const back = local(laptop, `/m/${S.id}/api/remote/view?source=screen:`)
    ok(!!(await through(back)), 'ticked again: it can')
    back.close()
  })

  // ---------- through Laptop, and the notice after ----------
  await part('through another computer, and the notice after', async () => {
    const v = local(laptop, `/m/${S.id}/api/remote/view?source=screen:`)
    await through(v)
    await v.wait((s) => msg(s, 'hello') && s.frames.length)
    ok(!!msg(v, 'hello') && v.frames[0]?.f?.w === 1280, 'Laptop sees Studio\'s screen through its link')
    v.close()
    // A phone paired with Laptop, looking at Studio through it.
    const lp = await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Pocket', about: { name: 'Pocket' } })
    const lph = over(lp)
    // First seen at Studio through Laptop with a password set there: New, let in at Studio.
    await lph.request('GET', `/m/${S.id}/api/fleet`)
    const pkS = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'Pocket' && d.through), 6000, 200)
    ok(pkS?.fresh === true, 'Pocket, first seen at Studio through Laptop: New there', pkS)
    if (pkS && !pkS.allowed) await studio.api('/remote/devices', { id: pkS.id, allowed: true })
    const v2 = lph.socket(`/m/${S.id}/api/remote/view?source=screen:`)
    await through(v2)
    ok(!!msg(v2, 'password') && !!msg(v2, 'hello'), 'a phone paired with Laptop sees Studio through it, asked for the password too')
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

  // ---------- Which screen?: a still of each, in a session only ----------
  await part('Which screen?: a still of each screen, only in a session', async () => {
    const v = ph.socket('/api/remote/view?source=screen:')
    const h = await through(v)
    await v.send({ t: 'thumbs?' })
    await v.wait((s) => msgs(s, 'thumb').length >= 5, 6000)
    const th = msgs(v, 'thumb')
    const screens = h.sources.filter((x) => x.kind === 'screen').map((x) => x.id).sort()
    ok(th.length === 5 && th.map((x) => x.id).sort().join() === screens.join() && th.every((x) => /^data:image\/svg\+xml;base64,/.test(x.data)), 'asked in the session, a still of each of its screens comes (never its windows)', th.map((x) => x.id))
    await v.send({ t: 'thumbs?' })
    await sleep(600)
    ok(msgs(v, 'thumb').length === 5, 'asked again at once: not taken again (a few seconds apart at most)')
    await v.close()
    const before = ph.socket('/api/remote/view?source=screen:')
    await before.wait((s) => msg(s, 'password'))
    await before.send({ t: 'thumbs?' })
    await sleep(500)
    ok(!msgs(before, 'thumb').length && !msg(before, 'hello'), 'before the password: nothing of the screen, nor a still of it')
    await before.close()
  })

  // ---------- your other devices, told ----------
  await part('your other devices told: each session, control taken and an ask, with Stop and Block This Device', async () => {
    const tb = await linkAs(rb.url, { code: (await laptop.api('/relay/pair', {})).pairing.code, name: 'Tablet', about: { name: 'Tablet' } })
    const tbh = over(tb)
    // Let in at Laptop, and at Studio, where it's first seen through Laptop with a password set (New).
    const tbL = await until(async () => (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Tablet'), 8000, 200)
    if (tbL && !tbL.allowed) await laptop.api('/remote/devices', { id: tbL.id, allowed: true })
    await tbh.request('GET', `/m/${S.id}/api/fleet`)
    const tbS = await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'Tablet' && d.through), 6000, 200)
    if (tbS && !tbS.allowed) await studio.api('/remote/devices', { id: tbS.id, allowed: true })
    await laptop.api(`/needs-you?fresh=${S.id}`) // (Laptop hears from Studio that it's let in there)
    const sees = (s) => s.sessions.find((x) => x.by.name === 'Phone')
    // Nothing set up anywhere: never silent all the same.
    const v0 = ph.socket('/api/remote/view?source=screen:')
    await through(v0)
    const t0 = await until(async () => { const x = sees(await studio.api('/remote'))?.told?.[0]; return x && 'sent' in x ? x : null }, 10000, 100)
    ok(t0?.what === 'view' && t0.sent === 0 && t0.computers?.length === 1 && t0.computers[0].name === 'Laptop' && t0.computers[0].sent === 0, 'no notification channel set up anywhere: the session is recorded as told to nobody (Laptop asked, with none of its own either)', t0)
    await v0.close()
    // Each sets up notifications: Studio's own browser, the Phone (paired with Studio), Laptop's own
    // browser, and the Tablet (paired with Laptop).
    const sub = (n) => ({ subscription: { endpoint: `https://push.test/${n}/${Date.now()}`, keys: { p256dh: 'test', auth: 'test' } }, label: n })
    await studio.api('/push/subscribe', sub('Studio browser'))
    await ph.request('POST', '/api/push/subscribe', sub('Phone'))
    await laptop.api('/push/subscribe', sub('Laptop browser'))
    await tbh.request('POST', '/api/push/subscribe', sub('Tablet'))
    const LM = (await studio.api('/machines')).machines.find((m) => m.name === 'Laptop')
    await studio.api(`/needs-you?fresh=${LM.id}`)
    const nt = await until(async () => { const n = (await studio.api('/remote')).notify; return n?.computers?.[0]?.devices === 2 ? n : null }, 20000, 300)
    ok(nt?.on === true && nt.devices.map((d) => d.label).sort().join() === 'Phone,Studio browser' && nt.computers[0].name === 'Laptop' && nt.computers[0].devices === 2, 'Studio says where they go: its own 2 devices, and 2 through Laptop', nt)
    const toPhone = (await ph.request('GET', '/api/remote')).json?.notify
    ok(toPhone?.on === true && !toPhone.devices && !toPhone.computers, 'a device is told only whether they\'re on, not where they go', toPhone)
    await studio.api('/remote/control', { on: true })

    // The Phone views Studio, and takes control.
    let n = { s: lines(pushS).length, l: lines(pushL).length }
    const v1 = ph.socket('/api/remote/view?source=screen:&control=1')
    const h1 = await through(v1)
    const s1 = await until(() => { const x = lines(pushS).slice(n.s); return x.length ? x : null }, 8000, 100)
    const l1 = await until(() => { const x = lines(pushL).slice(n.l); return x.length >= 2 ? x : null }, 8000, 100)
    await sleep(300)
    const st = lines(pushS).slice(n.s)
    ok(st.length === 1 && st[0].to === 'Studio browser' && st[0].note.kind === 'screen' && st[0].note.title === 'Studio\'s screen is being viewed' && /^From Phone \(phone\), who may control it too\. Not you\?/.test(st[0].note.body) && st[0].note.actions?.map((a) => a.title).join() === 'Stop,Block This Device' && st[0].note.tag === `screen-${h1.session}`, 'Studio\'s devices told: which computer, from which device (its kind), view or control, with Stop and Block This Device; never the Phone doing the viewing', s1)
    ok(l1.map((x) => x.to).sort().join() === 'Laptop browser,Tablet' && l1.every((x) => x.note.title === 'Studio\'s screen is being viewed' && /From Phone \(phone\)/.test(x.note.body)), 'and Laptop\'s, through Laptop', l1)
    const told1 = await until(async () => { const x = sees(await studio.api('/remote'))?.told?.[0]; return x && 'sent' in x ? x : null }, 6000, 100)
    ok(told1?.sent === 1 && told1.computers?.[0]?.sent === 2, 'Studio\'s record: told 1 of its devices, and 2 through Laptop', told1)
    await v1.send({ t: 'input', evs: [{ t: 'move', x: 0.5, y: 0.5 }] })
    const ctl = await until(() => lines(pushL).slice(n.l).find((x) => x.to === 'Tablet' && x.note.title === 'Studio is being controlled'), 8000, 100)
    ok(!!ctl && /^From Phone \(phone\), with its mouse and keyboard\./.test(ctl.note.body) && ctl.note.tag === `screen-${h1.session}`, 'control taken: told again, in the same notification\'s place', ctl)
    // Stop, from the Tablet's notification: through Laptop, carried out at Studio.
    const stopT = ctl.note.actions.find((a) => a.action === 'stop').token
    const r1 = await tbh.request('POST', '/api/notify/answer', { token: stopT })
    ok(r1.json?.ok === true && r1.json.said === 'Stopped: Phone isn\'t viewing Studio\'s screen now.', 'Stop on the Tablet\'s notification: done, and said', r1.json)
    await v1.wait((s) => msg(s, 'ended') || s.closed, 6000)
    ok(msg(v1, 'ended')?.why === 'stopped' && msg(v1, 'ended').by === 'Tablet, through Laptop', 'the Phone viewing is told it was stopped, and from where', msg(v1, 'ended'))
    const e1 = await until(async () => (await studio.api('/remote')).log.find((x) => x.id === h1.session && x.ended), 5000, 100)
    ok(e1?.end === 'stopped' && e1.stoppedBy === 'Tablet, through Laptop' && e1.told?.map((x) => x.what).join() === 'view,control', 'Studio\'s record: stopped from the Tablet through Laptop, and each notification it sent', e1)
    const r1b = await tbh.request('POST', '/api/notify/answer', { token: stopT })
    ok(r1b.json?.ok === false && r1b.json.why === 'used', 'the same button again does nothing', r1b.json)

    // Block This Device, from Studio's own notification.
    n = { s: lines(pushS).length, l: lines(pushL).length }
    const v2 = ph.socket('/api/remote/view?source=screen:')
    const h2 = await through(v2)
    const b2 = await until(() => lines(pushS).slice(n.s).find((x) => x.note.tag === `screen-${h2.session}`), 8000, 100)
    const r2 = await studio.api('/notify/answer', { token: b2.note.actions.find((a) => a.action === 'block').token })
    ok(r2.ok === true && r2.said === 'Phone can\'t connect to Studio any more.', 'Block This Device: done, and said', r2)
    await v2.wait((s) => msg(s, 'error'), 6000)
    const P = (await studio.api('/remote')).access.devices.find((d) => d.name === 'Phone')
    ok(msg(v2, 'error')?.code === 'blocked' && P.allowed === false, 'the Phone\'s session ends, and it\'s unticked in Which Devices May Connect', [msg(v2, 'error'), P])
    const v3 = ph.socket('/api/remote/view?source=screen:')
    await v3.wait((s) => msg(s, 'error'))
    ok(msg(v3, 'error').code === 'device', 'and it can\'t connect again', msg(v3, 'error'))
    const back = await ph.request('POST', '/api/remote/devices', { id: P.id, allowed: true })
    ok(back.status === 403 && !(await studio.api('/remote')).access.devices.find((d) => d.id === P.id).allowed, 'letting it back in is done at Studio only', back.json)
    const e2 = (await studio.api('/remote')).log.find((x) => x.id === h2.session)
    ok(e2?.end === 'blocked' && e2.stoppedBy === 'Studio', 'Studio\'s record: blocked, and from where', e2)
    await studio.api('/remote/devices', { id: P.id, allowed: true })

    // The Tablet views Studio through Laptop: everyone but the Tablet is told, with how it came.
    n = { s: lines(pushS).length, l: lines(pushL).length }
    const v4 = tbh.socket(`/m/${S.id}/api/remote/view?source=screen:`)
    const h4 = await through(v4)
    const s4 = await until(() => { const x = lines(pushS).slice(n.s); return x.length >= 2 ? x : null }, 8000, 100)
    await until(() => lines(pushL).slice(n.l).length >= 1, 8000, 100)
    await sleep(500)
    const l4 = lines(pushL).slice(n.l)
    ok(s4.map((x) => x.to).sort().join() === 'Phone,Studio browser' && s4.every((x) => /^From Tablet \(phone\) · through Laptop\./.test(x.note.body)), 'the Tablet through Laptop: Studio\'s devices told, saying which device, its kind and how it came', s4)
    ok(l4.length === 1 && l4[0].to === 'Laptop browser', 'Laptop\'s too, all but the Tablet doing the viewing', l4)
    // Block This Device on it, from the Phone: the Tablet is unticked on Laptop, the computer it came
    // through, not Laptop on Studio.
    const b4 = s4.find((x) => x.to === 'Phone')
    const r4 = await ph.request('POST', '/api/notify/answer', { token: b4.note.actions.find((a) => a.action === 'block').token })
    ok(r4.json?.ok === true && r4.json.said === 'Tablet can\'t connect through Laptop any more.', 'Block on a device that came through Laptop: said so', r4.json)
    await v4.wait((s) => msg(s, 'error') || s.closed, 6000)
    ok(msg(v4, 'error')?.code === 'blocked' && msg(v4, 'error').at === 'Laptop' && /^Laptop stopped letting this device connect/.test(msg(v4, 'error').why), 'the Tablet is told Laptop stopped letting it connect', msg(v4, 'error'))
    const onLaptop = (await laptop.api('/remote')).access.devices.find((d) => d.name === 'Tablet')
    const onStudio = (await studio.api('/remote')).access.devices.find((d) => d.name === 'Laptop')
    ok(onLaptop?.allowed === false && onStudio?.allowed === true, 'the Tablet is unticked on Laptop; Laptop itself still may connect to Studio', [onLaptop, onStudio])
    ok((await studio.api('/remote')).log.find((x) => x.id === h4.session)?.stoppedBy === 'Phone', 'Studio\'s record says the Phone blocked it')
    await laptop.api('/remote/devices', { id: onLaptop.id, allowed: true })

    // Laptop itself views Studio: its own browser isn't told (it's the one viewing), the Tablet is.
    n = { s: lines(pushS).length, l: lines(pushL).length }
    const v5 = local(laptop, `/m/${S.id}/api/remote/view?source=screen:`)
    await through(v5)
    await until(() => lines(pushL).slice(n.l).length >= 1, 8000, 100)
    await sleep(500)
    ok(lines(pushL).slice(n.l).map((x) => x.to).join() === 'Tablet' && /^From Laptop \(computer\)\./.test(lines(pushL).slice(n.l)[0].note.body), 'Laptop itself viewing: Laptop\'s own browser isn\'t told, the Tablet is', lines(pushL).slice(n.l))
    v5.close()

    // Ask Here First: told while it waits, with Deny and Block This Device; Deny from the Tablet.
    await studio.api('/remote/ask-first', { on: true })
    n = { s: lines(pushS).length, l: lines(pushL).length }
    const v6 = ph.socket('/api/remote/view?source=screen:&control=1')
    await v6.wait((s) => msg(s, 'password'))
    await v6.send({ t: 'password', p: PW })
    await v6.wait((s) => msg(s, 'asking'))
    const a6 = await until(() => lines(pushL).slice(n.l).find((x) => x.to === 'Tablet'), 8000, 100)
    ok(a6?.note.title === 'Phone (phone) asks to see and control Studio\'s screen' && /allowed or denied at Studio itself/.test(a6.note.body) && a6.note.actions.map((x) => x.title).join() === 'Deny,Block This Device', 'an ask waiting on Ask Here First: told, with Deny and Block This Device (allowing is for Studio itself)', a6?.note)
    const r6 = await tbh.request('POST', '/api/notify/answer', { token: a6.note.actions.find((x) => x.action === 'stop').token })
    await v6.wait((s) => msg(s, 'error'), 6000)
    ok(r6.json?.ok && msg(v6, 'error')?.code === 'stopped' && msg(v6, 'error').by === 'Tablet, through Laptop' && !msg(v6, 'hello'), 'Deny from the Tablet: the Phone is told no, and from where', [r6.json, msg(v6, 'error')])
    const e6 = (await studio.api('/remote')).log.find((x) => x.end === 'stopped' && !x.source)
    ok(!!e6 && e6.stoppedBy === 'Tablet, through Laptop' && e6.told?.[0]?.what === 'ask', 'Studio\'s record keeps it, with the notification', e6)
    await studio.api('/remote/ask-first', { on: false })

    // What's live, for the cards: Laptop knows, and stops it from there.
    const v7 = ph.socket('/api/remote/view?source=screen:')
    await through(v7)
    const lv = await until(async () => (await laptop.api('/remote/live')).list.find((x) => x.machine === S.id && x.by.name === 'Phone'), 6000, 100)
    ok(lv?.computer === 'Studio' && lv.by.kind === 'phone' && !lv.ask && !!lv.started && !('source' in lv), 'Laptop knows Studio\'s screen is being viewed, by whom and since when (not what\'s on it)', lv)
    const own = await ph.request('GET', '/api/remote/live')
    ok(own.json?.list?.some((x) => x.machine === null && x.computer === 'Studio' && x.by.name === 'Phone'), 'and so does a phone paired with Studio', own.json)
    const hop = await fetch(`${laptop.url}/m/${S.id}/api/remote/live/end`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ machine: 'x', id: lv.id }) })
    ok(hop.status === 403, 'one hop only: Studio won\'t pass it on to a third', hop.status)
    const heard = await ph.request('POST', '/api/remote/heard', { sessions: [{ id: 'x', by: { name: 'Fake' } }] })
    ok(heard.status === 403, 'only another of your computers says what\'s live there', heard.json)
    const blk = await ph.request('POST', '/api/remote/devices/block', { id: P.id })
    ok(blk.status === 403, 'and only one asks to block a device that came through this one', blk.json)
    const r7 = await laptop.api('/remote/live/end', { machine: S.id, id: lv.id })
    await v7.wait((s) => msg(s, 'ended') || s.closed, 6000)
    ok(r7.ok && msg(v7, 'ended')?.by === 'Laptop', 'Stop from Laptop: the session ends at Studio', [r7, msg(v7, 'ended')])
    ok(!!(await until(async () => !(await laptop.api('/remote/live')).list.some((x) => x.machine === S.id), 5000, 100)), 'and Laptop\'s card goes')

    // Off at Studio (only there): nobody told, and the record says so.
    const offPhone = await ph.request('POST', '/api/remote/notify', { on: false })
    ok(offPhone.status === 403, 'turned off at Studio only', offPhone.json)
    await studio.api('/remote/notify', { on: false })
    n = { s: lines(pushS).length, l: lines(pushL).length }
    const v8 = ph.socket('/api/remote/view?source=screen:')
    await through(v8)
    await sleep(1200)
    const t8 = sees(await studio.api('/remote'))?.told?.[0]
    ok(lines(pushS).length === n.s && lines(pushL).length === n.l && t8?.off === true, 'off: nobody told, and the record says they were off', t8)
    await v8.close()
    await studio.api('/remote/notify', { on: true })
    await studio.api('/remote/control', { on: false })
    tbh.stop()
  })

  // ---------- each screen by its display's own name ----------
  await part('each screen by its display\'s own name and size, on a Mac, Windows and Linux', async () => {
    const { create, displayFor } = createRequire(import.meta.url)(path.join(ROOT, 'desktop', 'remote.js'))
    const d = (id, label, w, h, k, more = {}) => ({ id, label, bounds: { x: 0, y: 0, width: w, height: h }, size: { width: w, height: h }, workArea: { x: 0, y: 0, width: w, height: h }, scaleFactor: k, ...more })
    const names = (screens, displays, primary) => [...displayFor(screens, displays, primary).values()].map((x) => `${x.name}@${x.d?.id ?? '-'}`)
    // A Mac: display_id, and its labels.
    const mb = d(1, 'Built-in Retina Display', 1512, 982, 2, { internal: true })
    const lg = d(2, 'LG UltraFine', 2560, 1440, 2)
    ok(names([{ id: 'screen:1:0', name: 'Screen 1', display_id: '1' }, { id: 'screen:2:0', name: 'Screen 2', display_id: '2' }], [mb, lg], mb).join() === 'Built-in Retina Display@1,LG UltraFine@2', 'a Mac: each by its display\'s own name, matched by display_id')
    // Windows: no display_id, as many screens as displays, in order; the monitors' own names.
    const w1 = d(2779098405, 'DELL U2723QE', 3840, 2160, 1.5)
    const w2 = d(2528732444, 'Generic PnP Monitor', 1920, 1080, 1)
    ok(names([{ id: 'screen:0:0', name: 'Screen 1', display_id: '' }, { id: 'screen:1:0', name: 'Screen 2', display_id: '' }], [w1, w2], w1).join() === `DELL U2723QE@${w1.id},Generic PnP Monitor@${w2.id}`, 'Windows without display_id: in the displays\' order, by their names')
    // Linux: no labels; a laptop's own said so, another by its place.
    const x1 = d(10, '', 1920, 1200, 1, { internal: true })
    const x2 = d(11, '', 2560, 1440, 1)
    ok(names([{ id: 'screen:10:0', name: 'Entire screen', display_id: '10' }, { id: 'screen:11:0', name: 'Screen 2', display_id: '11' }], [x1, x2], x1).join() === 'Built-in Display@10,Display 2@11', 'Linux without labels: "Built-in Display" for a laptop\'s own, "Display 2" by its place, never "Screen 2"')
    // Two of the same model, numbered as macOS does; Wayland's one stream, the main display.
    ok(names([{ id: 'screen:1:0', display_id: '1' }, { id: 'screen:2:0', display_id: '2' }], [d(1, 'LG UltraFine', 2560, 1440, 2), d(2, 'LG UltraFine', 2560, 1440, 2)], null).join() === 'LG UltraFine (1)@1,LG UltraFine (2)@2', 'two of the same model: numbered')
    ok(names([{ id: 'screen:0:0', name: 'Entire screen', display_id: '' }], [x1, x2], x1).join() === 'Built-in Display@10', 'one stream with no display (Wayland\'s portal): the main display')
    // sources() and thumbs(), Electron stood in for.
    const shotOf = (n) => ({ isEmpty: () => false, toJPEG: () => Buffer.from(`jpeg ${n}`) })
    const desk = create({
      BrowserWindow: class {}, systemPreferences: { getMediaAccessStatus: () => 'granted' }, session: {}, nativeTheme: {}, URL_BASE: '', preload: '', fetch: async () => ({}), platform: 'darwin', keyFor,
      desktopCapturer: { getSources: async (o) => [{ id: 'screen:1:0', name: 'Screen 1', display_id: '1', thumbnail: shotOf(1) }, { id: 'screen:2:0', name: 'Screen 2', display_id: '2', thumbnail: shotOf(2) }, ...(o.types.includes('window') ? [{ id: 'window:9:0', name: 'Notes' }] : [])] },
      screen: { getAllDisplays: () => [mb, lg], getPrimaryDisplay: () => mb },
    })
    const src = (await desk.sources()).sources
    ok(src.map((x) => `${x.name} ${x.w}×${x.h}${x.primary ? ' main' : ''}`).join() === 'Built-in Retina Display 3024×1964 main,LG UltraFine 5120×2880,Notes 0×0', 'the capture page\'s screens: each by name, at its own pixels, the main one marked', src)
    const th = await desk.thumbs()
    ok(th.length === 2 && th[0].id === 'screen:1:0' && th[0].data === `data:image/jpeg;base64,${Buffer.from('jpeg 1').toString('base64')}`, 'and a still of each screen, as a JPEG', th)
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

  // ---------- a screen that doesn't start: self-healed, or said with the fix ----------
  // "Desk", a computer whose screen is taken by its desktop app (stood in for: deskApp), with short
  // waits: 1.5 s for the capture page to connect and as long to list its screens, 2.5 s for the app
  // to report in, 10 s to reopen. A phone ("Pocket") views it through its relay, past its password.
  // Each way it can stall: self-healed before anything is said when it can be (a cold start slower
  // than one wait, a window that never loads, the app's feed coming back), and otherwise said as it
  // is, with the fix (Open, Reopen, Allow Screen Recording) carried out in the same session, the
  // password not asked again; a line in Desk's log for each.
  await part('a screen that doesn\'t start: self-healed, or said with the fix, in the same session', async () => {
    const rd = await startRelay('remote-screen-desk')
    relays.push(rd)
    const desk = await kitWith('Desk', rd, { BRIDGE_REMOTE_CAPTURE_WAIT_MS: '1500', BRIDGE_REMOTE_APP_BACK_MS: '2500', BRIDGE_REMOTE_REOPEN_MS: '10000', BRIDGE_REMOTE_ALLOW_MS: '8000', BRIDGE_TEST_APP: '1', ...(process.platform === 'linux' ? { DISPLAY: ':0' } : {}) })
    ok(!!(await until(async () => (await desk.api('/relay')).online, 20000)), 'Desk is on its relay')
    const pocket = await linkAs(rd.url, { code: (await desk.api('/relay/pair', {})).pairing.code, name: 'Pocket', about: { name: 'Pocket' } })
    const dp = over(pocket)
    await until(async () => (await desk.api('/remote')).access.devices.some((x) => x.name === 'Pocket'), 8000, 100)
    await desk.api('/remote/password', { password: PW })
    const FX = '/api/remote/view?source=screen:&fixes=1'
    const ended = () => until(async () => !(await desk.api('/remote')).sessions.length, 6000, 100)
    const logged = (re) => until(() => re.test(desk.log()), 4000, 100)
    const apps = []
    const app = (how) => { const a = deskApp(desk, how); apps.push(a); return a }
    const appOpen = () => until(async () => (await desk.api('/remote')).preview.can, 6000, 100)
    try {
      // No app at all: said with Open Bridge AI there; chosen, it's opened (past the password) and
      // the screen shows when it reports in.
      await sleep(2600)
      const st = (await dp.request('GET', '/api/remote?sources=1')).json
      ok(st?.screen?.can === false && st.screen.code === 'noApp' && st.screen.fix === 'open' && !!st.version, 'the app closed on Desk: the phone is told so, with Open Bridge AI there (and Desk\'s version)', st?.screen)
      const v0 = dp.socket(FX)
      await v0.wait((s) => msg(s, 'error'))
      ok(msg(v0, 'error')?.code === 'noApp' && msg(v0, 'error').fix === 'open' && !msg(v0, 'error').waits && !msg(v0, 'password'), 'a session for it: said before the password, with Open offered (connecting again with it chosen)', msg(v0, 'error'))
      const v1 = dp.socket(`${FX}&fix=open`)
      await v1.wait((s) => msg(s, 'password') || msg(s, 'error'))
      await v1.send({ t: 'password', p: PW })
      await v1.wait((s) => msg(s, 'wait') || msg(s, 'error'))
      ok(msg(v1, 'wait')?.why === 'open' && !!(await logged(/\[fix dry-run\] open Bridge AI/)), 'Open chosen: past the password, Bridge AI is opened on Desk, and the phone told it\'s opening', msg(v1, 'wait'))
      const a1 = app()
      await v1.wait((s) => msg(s, 'hello'), 8000)
      ok(msg(v1, 'hello')?.source?.id === 'screen:1:0' && msgs(v1, 'password').length === 1, 'the app reports in: its screen, in the same session, the password not asked again', msg(v1, 'hello')?.source)
      const rec = await until(async () => (await desk.api('/remote')).log.find((x) => x.end === 'opened'), 4000, 100)
      ok(rec?.by?.name === 'Pocket' && !!(await logged(/Remote Screen: Pocket: opened the Bridge AI app here/)), 'Screen Activity and the log say who opened it', rec)
      await v1.close()
      await ended()

      // A cold start slower than one wait (the window loads for 0.9 s, macOS lists the screens 1.3 s
      // later): waited for, once the page has connected, not said as a failure.
      a1.drop()
      a1.how = { after: 900, list: 1300 }
      await until(async () => !(await desk.api('/remote')).screen.sources, 3000, 100)
      const fresh0 = a1.events.filter((e) => e.fresh).length
      const t0 = Date.now()
      const v2 = dp.socket(FX)
      await through(v2)
      await v2.wait((s) => msg(s, 'hello') || msg(s, 'error'), 8000)
      ok(!!msg(v2, 'hello') && !msg(v2, 'error') && a1.events.filter((e) => e.fresh).length === fresh0, 'a cold start longer than one wait: the screen shows, nothing said, no second window', { took: Date.now() - t0, error: msg(v2, 'error') })
      await v2.close()
      await ended()

      // A window that never loads the first time (the server restarting just then): a fresh one is
      // asked for, and the screen shows.
      a1.drop()
      a1.how = { hangFirst: true }
      a1.asked = 0
      const v3 = dp.socket(FX)
      await through(v3)
      await v3.wait((s) => msg(s, 'hello') || msg(s, 'error'), 10000)
      ok(!!msg(v3, 'hello') && a1.events.some((e) => e.t === 'need-capture' && e.fresh) && !!(await logged(/the capture window didn't connect within 2 seconds: asked the app for a fresh one/)), 'the capture window never connects: a fresh one is asked for, and the screen shows; the log says so', { error: msg(v3, 'error'), events: a1.events.slice(-3) })
      await v3.close()
      await ended()

      // The app's feed gone a moment (its server restarted, the app connecting again): waited for.
      a1.quit()
      const v4 = dp.socket(FX)
      setTimeout(() => app(), 1200)
      await through(v4)
      await v4.wait((s) => msg(s, 'hello') || msg(s, 'error'), 10000)
      ok(!!msg(v4, 'hello') && !msg(v4, 'error'), 'the app reporting in again after its feed dropped: waited for, not said as closed', msg(v4, 'error'))
      await v4.close()
      await ended()

      // Never a capture page: said exactly so, with Reopen Bridge AI there; chosen, the app reopens
      // and the screen shows in the same session.
      const a2 = apps.at(-1)
      a2.drop()
      a2.how = { hang: true }
      const v5 = dp.socket(FX)
      await through(v5)
      await v5.wait((s) => msg(s, 'error'), 10000)
      const e5 = msg(v5, 'error')
      ok(e5?.code === 'noCapture' && e5.cause === 'window' && e5.fix === 'reopen' && e5.waits && e5.why === 'The Bridge AI app on Desk didn\'t open its screen sharing.' && !v5.closed, 'no capture page even with a fresh window: said exactly so, with Reopen Bridge AI there, the session kept for it', e5)
      ok(!!(await logged(/Remote Screen: Pocket: couldn't see this screen \(noCapture, window\): The Bridge AI app on Desk didn't open its screen sharing\. Offered: reopen\./)), 'and a line in Desk\'s log, with the cause')
      await v5.send({ t: 'fix', fix: 'reopen' })
      ok(!!(await until(() => a2.events.some((e) => e.t === 'reopen'), 4000, 50)), 'Reopen: Desk\'s app is asked to reopen')
      a2.quit()
      const a3 = app()
      await v5.wait((s) => msg(s, 'hello') || msgs(s, 'error').length > 1, 10000)
      ok(msg(v5, 'wait')?.why === 'reopen' && !!msg(v5, 'hello') && msgs(v5, 'password').length === 1, 'the phone told it\'s reopening, then the screen, in the same session (no password again)', { wait: msg(v5, 'wait'), errors: msgs(v5, 'error') })
      ok(!!(await until(async () => (await desk.api('/remote')).log.find((x) => x.end === 'reopened' && x.by?.name === 'Pocket'), 4000, 100)), 'Screen Activity says who reopened it')
      await v5.close()
      await ended()

      // A page that connects and never lists its screens: said so, with Reopen; one from before
      // fixes (no fixes=1) gets Reopen as it knows it.
      a3.drop()
      a3.how = { mute: true }
      const v6 = dp.socket(FX)
      await through(v6)
      await v6.wait((s) => msg(s, 'error'), 12000)
      ok(msg(v6, 'error')?.code === 'noCapture' && msg(v6, 'error').cause === 'list' && msg(v6, 'error').fix === 'reopen' && /never said which screens there are/.test(msg(v6, 'error').why), 'a page that never says its screens: said so, with Reopen', msg(v6, 'error'))
      await v6.close()
      await ended()
      a3.drop()
      const v7 = dp.socket('/api/remote/view?source=screen:')
      await through(v7)
      await v7.wait((s) => msg(s, 'error'), 12000)
      ok(msg(v7, 'error')?.code === 'noCapture' && msg(v7, 'error').reopen === true && !msg(v7, 'error').fix, 'a device from before fixes: the same, with Reopen as it knows it', msg(v7, 'error'))
      await v7.close()
      await ended()

      // macOS turned Screen Recording down there: said, with Allow Screen Recording there; chosen,
      // System Settings opens there, and once it's on (the app reopening, as macOS has it) the screen.
      a3.how = { permission: 'denied', sources: [] }
      a3.drop()
      const v8 = dp.socket(FX)
      await through(v8)
      await v8.wait((s) => msg(s, 'error'), 10000)
      const e8 = msg(v8, 'error')
      if (process.platform !== 'darwin') ok(e8?.code === 'screenPermission' && !e8.fix, 'not a Mac: no Screen Recording to allow, said as it is', e8)
      else {
        ok(e8?.code === 'screenPermission' && e8.fix === 'allow' && e8.waits && /System Settings › Privacy & Security › Screen & System Audio Recording/.test(e8.why), 'Screen Recording turned down on Desk: said, with Allow Screen Recording there', e8)
        const st8 = (await dp.request('GET', '/api/remote')).json
        ok(st8?.screen?.code === 'screenPermission' && st8.screen.fix === 'allow', 'and the phone\'s next look says it too, with the same fix', st8?.screen)
        await v8.send({ t: 'fix', fix: 'allow' })
        ok(!!(await until(() => a3.events.some((e) => e.t === 'allow-screen'), 4000, 50)) && !!(await v8.wait((s) => msg(s, 'wait')?.why === 'allow', 4000)), 'Allow: Desk opens System Settings there, and the phone waits for someone there', msg(v8, 'wait'))
        a3.quit()
        app()
        await v8.wait((s) => msg(s, 'hello') || msgs(s, 'error').length > 1, 10000)
        ok(!!msg(v8, 'hello') && msgs(v8, 'password').length === 1, 'turned on there and Bridge AI reopened: the screen, in the same session', msgs(v8, 'error'))
        ok(!!(await until(async () => (await desk.api('/remote')).log.find((x) => x.end === 'allow' && x.by?.name === 'Pocket'), 4000, 100)), 'Screen Activity says who asked for it')
      }
      await v8.close()
      await ended()
      ok(!!(await appOpen()), 'and Desk\'s app is there at the end')

      // What the viewer showed, in its own computer's log too (ScreenView.jsx says).
      await laptop.api('/remote/didnt-show', { name: 'Desk', code: 'noCapture', cause: 'window', why: 'The Bridge AI app on Desk didn\'t open its screen sharing.\nInjected line', version: '3.21.0' })
      ok(/Remote Screen: Desk's screen didn't show here \(noCapture, window; it has Bridge AI 3\.21\.0\): The Bridge AI app on Desk didn't open its screen sharing\. ?Injected line\n/.test(laptop.log()), 'the viewer\'s computer logs what it showed, on one line', laptop.log().split('\n').filter((l) => /Remote Screen/.test(l)).slice(-2))
    } finally {
      for (const a of apps) a.quit()
      dp.stop()
    }
  })

  // ---------- a project's app ----------
  const project = path.join(studio.home, 'webapp')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'dev.mjs'), DEV)
  studio.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await studio.api('/agents/catalog')
  const pane = (await studio.api('/agents/launch', { kind: 'claude', cwd: project, label: 'Web app', newSpace: 'Web app' })).paneId
  const dport = await freePort()
  // Started in a terminal of the agent's, as its `npm run dev` would be (only what an agent's terminal
  // starts is one of its apps)...
  const devPane = (await studio.api('/agents/launch', { kind: 'shell', cwd: project, label: 'Dev server' })).paneId
  await sleep(800)
  // (PowerShell on Windows: $env: for the variable, & to run a quoted path.)
  const nodePath = path.join(ROOT, 'node_modules')
  const line = IS_WIN
    ? `$env:NODE_PATH='${nodePath}'; & '${process.execPath}' '${path.join(project, 'dev.mjs')}' ${dport} ${laptop.url}`
    : `NODE_PATH="${nodePath}" "${process.execPath}" "${path.join(project, 'dev.mjs')}" ${dport} ${laptop.url}`
  await studio.api(`/panes/${enc(devPane)}/text`, { text: line, enter: true })
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
  // With a password set at Studio, its apps are seen while a session for that app is open (past the
  // password), as the Preview tab keeps one.
  const grant = local(laptop, `/m/${S.id}/api/remote/view?source=preview:${dport}`)
  await through(grant)
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

  grant.close()
  await part('only an agent\'s dev servers', async () => {
    const own = await fetch(`${laptop.url}/api/machines/${S.id}/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ port: studio.port }) })
    const ownJ = await own.json()
    ok(own.status === 409 && new RegExp(`Port ${studio.port} isn't one of the apps Studio serves`).test(ownJ.error), 'Bridge AI\'s own port on Studio: refused, saying why', ownJ)
    const o = await fetch(`${laptop.url}/api/machines/${S.id}/preview`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${laptop.key}` }, body: JSON.stringify({ port: oport }) })
    ok(o.status === 409, 'a server no agent\'s terminal started: refused', await o.json())
    const direct = await ph.request('GET', `/_preview/${studio.port}/api/config`)
    ok(direct.status === 403, 'nor straight through the link', direct.json)
    const local1 = await fetch(`${studio.url}/_preview/${dport}/`, { headers: { authorization: `Bearer ${studio.key}` } })
    ok(local1.status === 403, 'Studio\'s /_preview/ is for its other devices only, not a page of its own', local1.status)
    const pg = ph.socket(`/api/remote/view?source=preview:${dport}`)
    await through(pg)
    const viaLink = await ph.request('GET', `/_preview/${dport}/go`)
    const loc = viaLink.headers.find(([k]) => k === 'location')?.[1]
    ok(viaLink.status === 302 && loc === `/_preview/${dport}/landed?x=1`, 'through the link beside Bridge AI\'s page, a redirect stays under its own path', loc)
    const cookieBack = (await ph.request('GET', `/_preview/${dport}/login`)).headers.find(([k]) => k === 'x-bridge-preview-set-cookie')
    ok(!!cookieBack && JSON.parse(cookieBack[1]).length === 2, 'and its cookies come in a header of their own (the link carries no Set-Cookie)', cookieBack)
    await pg.close()
  })

  await part('on a phone: pictures drawn at Studio', async () => {
    const v = ph.socket(`/api/remote/view?source=page:${dport}&w=390&h=700`)
    await through(v)
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
    const { create, fitWindow } = createRequire(import.meta.url)(path.join(ROOT, 'desktop', 'remote.js'))
    const wins = []
    const sent = []
    const posts = []
    class Win {
      constructor(o) {
        this.o = o; this.on_ = {}; wins.push(this)
        const wc = { on_: {}, on: (e, f) => { wc.on_[e] = f }, setWindowOpenHandler: (f) => { wc.open = f }, setFrameRate: (r) => { wc.rate = r }, sendInputEvent: (ev) => sent.push(ev) }
        this.webContents = wc
      }
      loadURL(u) { this.url = u; this.loads = (this.loads || 0) + 1; return Promise.resolve() }
      on(e, f) { this.on_[e] = f }
      once(e, f) { this.on_[e] = f }
      isDestroyed() { return !!this.gone }
      destroy() { this.gone = true; this.on_.closed?.() }
      setAlwaysOnTop(...a) { this.top = a }
      setVisibleOnAllWorkspaces() {}
      showInactive() { this.shown = true }
      setContentSize(w, h) { this.size = [w, h] }
      show() { this.shown = true }
      focus() { this.focused = true }
      getBounds() { return this.b || { x: this.o.x, y: this.o.y, width: this.o.width, height: this.o.height } }
      getContentBounds() { return this.getBounds() }
      getNormalBounds() { return this.getBounds() }
      setBounds(b) { this.b = b }
      isMinimized() { return false }
      isMaximized() { return false }
      isFullScreen() { return false }
    }
    // This Mac's display, and an external one to its right at a resolution of its own.
    const main = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 25, width: 1512, height: 900 }, size: { width: 1512, height: 982 }, scaleFactor: 2 }
    const ext = { id: 2, bounds: { x: 1512, y: -300, width: 2560, height: 1440 }, workArea: { x: 1512, y: -275, width: 2560, height: 1415 }, size: { width: 2560, height: 1440 }, scaleFactor: 1 }
    const onExt = (r) => r.x >= 1512
    const kept = new Map()
    let access = 'granted'
    const desk = create({
      BrowserWindow: Win,
      desktopCapturer: { getSources: async () => [{ id: 'screen:1:0', name: 'Entire Screen', display_id: '1' }, { id: 'window:42:0', name: 'Notes' }, { id: 'window:43:0', name: 'Bridge AI screen sharing' }] },
      screen: { getAllDisplays: () => [main, ext], getPrimaryDisplay: () => main, getDisplayMatching: (r) => (onExt(r) ? ext : main), getDisplayNearestPoint: (pt) => (onExt(pt) ? ext : main), getCursorScreenPoint: () => ({ x: 100, y: 100 }) },
      sizes: { get: (k) => kept.get(k) || null, set: (k, b) => kept.set(k, b) },
      systemPreferences: { getMediaAccessStatus: () => access },
      session: { fromPartition: (n) => ({ name: n, setPermissionRequestHandler: (f) => { f(null, 'media', (ok) => { posts.push(['perm', ok]) }) } }) },
      nativeTheme: { shouldUseDarkColors: false }, URL_BASE: 'http://127.0.0.1:1', preload: '/preload.js', platform: 'darwin', keyFor,
      fetch: async (u, o) => { posts.push([u, o]); return { status: 200 } },
    })
    const src = await desk.sources()
    ok(src.permission === 'ok' && src.sources.length === 2 && src.sources[0].kind === 'screen' && src.sources[0].w === 3024 && src.sources[0].primary && src.sources[0].bounds.width === 1512 && src.sources[1].name === 'Notes', 'its screens (in pixels, with where each sits, in points) and windows, never its own', src)
    // Screens apart from windows: windows that can't be listed don't hide them. No screens at all, with
    // Screen Recording turned on since the app started: 'reopen' (macOS lets it record once reopened).
    const deskOf = (getSources, at = 'granted') => { access = at; const d = create({ BrowserWindow: Win, desktopCapturer: { getSources }, screen: { getAllDisplays: () => [main, ext], getPrimaryDisplay: () => main }, systemPreferences: { getMediaAccessStatus: () => access }, session: { fromPartition: () => ({ setPermissionRequestHandler: () => {} }) }, nativeTheme: { shouldUseDarkColors: false }, URL_BASE: 'http://127.0.0.1:1', preload: '/preload.js', platform: 'darwin', keyFor, fetch: async () => ({ status: 200 }) }); access = 'granted'; return d }
    const noWindows = await deskOf(async (o) => { if (o.types.includes('window')) throw new Error('window list failed'); return [{ id: 'screen:1:0', name: 'Entire Screen', display_id: '1' }] }).sources()
    ok(noWindows.sources.length === 1 && noWindows.sources[0].kind === 'screen' && !noWindows.none, 'windows that can\'t be listed: the screens are still there', noWindows)
    let asked = 0
    const late = await deskOf(async (o) => (o.types.includes('screen') && ++asked >= 2 ? [{ id: 'screen:1:0', name: 'Entire Screen', display_id: '1' }] : [])).sources()
    ok(late.sources.length === 1 && asked === 2, 'none at first: asked again a moment later, and there', { asked, n: late.sources.length })
    const since = await deskOf(async () => [], 'denied').sources()
    ok(since.sources.length === 0 && since.none === 'reopen' && since.permission === 'ok', 'none, and Screen Recording turned on since it opened: reopen', since)
    const never = await deskOf(async () => { throw new Error('no capture here') }).sources()
    ok(never.none === 'none' && /no capture here/.test(never.problem || ''), 'none, and on from the start: none, with what macOS said', never)
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
    desk.onEvent({ t: 'sessions', list: [], asks: [{ id: 'q1', by: { name: 'Phone' } }] })
    const askBadge = wins.filter((w) => /remote=badge/.test(w.url || '')).at(-1)
    ok(askBadge && askBadge !== badge && !askBadge.gone && askBadge.o.alwaysOnTop && askBadge.o.width >= 500, 'Ask Here First: the badge shows for an ask too (Allow or Deny there), wide enough for both', askBadge?.o)
    desk.onEvent({ t: 'sessions', list: [], asks: [] })
    ok(askBadge.gone, 'and goes once it\'s answered')
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

    // Another computer's screen, in a window of its own, from this Mac with an external display.
    const inside = (a, r) => r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width && r.y + r.height <= a.y + a.height
    const vw = desk.view({ machine: 'm1', name: 'Studio', near: { x: 1700, y: 0, width: 1200, height: 800 } })
    ok(/\/\?remote=view&machine=m1&name=Studio$/.test(vw.url || '') && vw.o.titleBarStyle === 'hiddenInset' && vw.o.trafficLightPosition?.x === 14 && vw.o.webPreferences.sandbox, 'View screen opens a window of its own (its title bar the page\'s toolbar, clear of the window\'s buttons)', vw.o)
    ok(inside(ext.workArea, vw.getBounds()), 'on the display the window asking is on (the external one), inside its work area', vw.getBounds())
    const shape = (b, w, h, chrome) => Math.abs((b.height - chrome) / b.width - h / w) < 0.01
    ok(desk.fit(vw, { w: 5120, h: 2880, chrome: 52 }) && shape(vw.getBounds(), 5120, 2880, 52) && inside(ext.workArea, vw.getBounds()) && vw.getBounds().width > 2000, 'fitted to a 5K screen\'s shape (its picture 16:9 under the toolbar), as big as fits there', vw.getBounds())
    ok(desk.fit(vw, { w: 1080, h: 1920, chrome: 52 }) && shape(vw.getBounds(), 1080, 1920, 52) && inside(ext.workArea, vw.getBounds()), 'then a portrait one: tall and narrow, still inside the work area', vw.getBounds())
    ok(desk.view({ machine: 'm1', name: 'Studio' }) === vw && vw.focused, 'asked again while it\'s open: that window, to the front')
    vw.on_['will-resize']()
    vw.b = { x: 1600, y: -200, width: 1000, height: 700 }
    vw.on_.resized()
    ok(kept.get('m1')?.width === 1000 && !desk.fit(vw, { w: 1440, h: 900, chrome: 52 }) && vw.getBounds().width === 1000, 'sized by hand: kept for that computer, and not fitted over', kept.get('m1'))
    vw.on_.close()
    vw.destroy()
    const vw2 = desk.view({ machine: 'm1', name: 'Studio' })
    ok(vw2 !== vw && vw2.o.width === 1000 && vw2.o.height === 700 && vw2.o.x === 1600, 'opened again: as it was left for that computer', vw2.o)
    const vw3 = desk.view({ machine: 'm2', name: 'Desk' })
    ok(inside(main.workArea, vw3.getBounds()) && vw3.getBounds().width <= main.workArea.width, 'another computer: its own window, on the display the pointer is on (this Mac\'s), inside its work area', vw3.getBounds())
    ok(desk.fit(vw3, { w: 1440, h: 900, chrome: 52 }) && shape(vw3.getBounds(), 1440, 900, 52), 'and a 1440 x 900 screen\'s shape', vw3.getBounds())
    kept.set('m3', { x: 9000, y: 9000, width: 800, height: 600 })
    const vw4 = desk.view({ machine: 'm3', name: 'Gone' })
    ok(inside(main.workArea, vw4.getBounds()), 'left on a display that isn\'t there any more: opened where it can be seen instead', vw4.getBounds())
    // The shape maths at several sizes.
    const area = { x: 0, y: 25, width: 1440, height: 875 }
    const f5 = fitWindow(area, 5120, 2880, { w: 0, h: 52 })
    const fp = fitWindow(area, 1080, 1920, { w: 0, h: 52 })
    const fa = fitWindow(area, 1440, 900, { w: 2, h: 80 })
    ok(shape(f5, 5120, 2880, 52) && inside(area, f5) && Math.abs(f5.x + f5.width / 2 - 720) <= 1 && f5.width >= 1290, '5K on a 1440 x 900 Mac: 90% of it, centred, its shape kept', f5)
    ok(inside(area, fp) && fp.width >= 520 && fp.height <= area.height, 'portrait: within the height, never narrower than the toolbar needs', fp)
    ok(Math.abs((fa.height - 80) / (fa.width - 2) - 900 / 1440) < 0.01 && inside(area, fa), 'a window frame and a taller toolbar counted', fa)
    // The capture window kept working: a fresh one when the server asks (the last never connected),
    // one that doesn't load loaded again and then closed, one that hangs closed; macOS kept from
    // napping the app while it's open; the display woken and kept awake while someone views; macOS
    // never listing the screens said within a moment; Allow Screen Recording opening it there.
    const blocks = []
    let woke = 0
    let allowed = 0
    const power = { start: (kind) => { blocks.push({ kind, on: true }); return blocks.length - 1 }, stop: (id) => { blocks[id].on = false } }
    const blocked = (kind) => blocks.some((x) => x.kind === kind && x.on)
    const d2 = create({ BrowserWindow: Win, desktopCapturer: { getSources: () => new Promise(() => {}) }, screen: { getAllDisplays: () => [main, ext], getPrimaryDisplay: () => main }, systemPreferences: { getMediaAccessStatus: () => 'granted' }, session: { fromPartition: () => ({ setPermissionRequestHandler: () => {} }) }, nativeTheme: { shouldUseDarkColors: false }, URL_BASE: 'http://127.0.0.1:1', preload: '/preload.js', platform: 'darwin', keyFor, fetch: async () => ({ status: 200 }), power, wake: () => { woke++ }, allowScreen: () => { allowed++ }, listMs: 200 })
    const hung = await d2.sources()
    ok(hung.sources.length === 0 && hung.none === 'none' && /macOS didn't list the screens within/.test(hung.problem || ''), 'macOS never listing the screens: said within a moment, with why', hung)
    const caps = () => wins.filter((w) => /remote=capture/.test(w.url || ''))
    const before = caps().length
    d2.onEvent({ t: 'need-capture' })
    const c1 = caps().at(-1)
    ok(caps().length === before + 1 && blocked('prevent-app-suspension'), 'a capture window, and macOS doesn\'t nap the app meanwhile')
    c1.webContents.on_['did-fail-load']({}, -102, 'refused', c1.url, true)
    ok(!!(await until(() => c1.loads >= 2, 3000, 50)) && !c1.gone, 'its page not loading (the server restarting just then): loaded again a moment later', c1.loads)
    for (let i = 0; i < 3; i++) c1.webContents.on_['did-fail-load']({}, -102, 'refused', c1.url, true)
    ok(c1.gone, 'and closed when it still doesn\'t, for the next ask to open another')
    d2.onEvent({ t: 'need-capture' })
    const c2 = caps().at(-1)
    d2.onEvent({ t: 'need-capture' })
    ok(c2 !== c1 && caps().at(-1) === c2, 'asked again: a new one, once')
    d2.onEvent({ t: 'need-capture', fresh: true })
    const c3 = caps().at(-1)
    ok(c2.gone && c3 !== c2 && !c3.gone, 'asked for a fresh one (the server never heard from that one): closed, and another opened')
    c3.on_.unresponsive()
    ok(c3.gone && !blocked('prevent-app-suspension'), 'one that hangs: closed, and the app may nap again')
    d2.onEvent({ t: 'sessions', list: [{ id: 'a', kind: 'screen' }] })
    ok(woke === 1 && blocked('prevent-display-sleep'), 'someone viewing: the display woken, and kept awake')
    d2.onEvent({ t: 'sessions', list: [{ id: 'a', kind: 'screen' }, { id: 'b', kind: 'screen' }] })
    d2.onEvent({ t: 'sessions', list: [] })
    ok(woke === 1 && !blocked('prevent-display-sleep'), 'and let sleep once nobody is')
    d2.onEvent({ t: 'allow-screen' })
    ok(allowed === 1, 'Allow Screen Recording from a device: System Settings there, with the tile')
  })

  // ---------- the picture's size and the pointer, as maths ----------
  await part('fit, the pointer, the capture size and the bitrate at several screens', async () => {
    const room = { left: 0, top: 52, width: 1440, height: 848 }
    for (const [w, h] of [[5120, 2880], [1440, 900], [1080, 1920]]) {
      const f = fitIn(room.width, room.height, w, h)
      const x0 = room.left + (room.width - f.w) / 2
      const y0 = room.top + (room.height - f.h) / 2
      const mid = pointAt(room, w, h, room.left + room.width / 2, room.top + room.height / 2)
      const q = pointAt(room, w, h, x0 + f.w * 0.25, y0 + f.h * 0.75)
      const out = pointAt(room, w, h, x0 - 3, y0 - 3)
      ok(Math.abs(f.w / f.h - w / h) < 0.01 && (Math.abs(f.w - room.width) < 0.5 || Math.abs(f.h - room.height) < 0.5) && Math.abs(mid.x - 0.5) < 1e-9 && Math.abs(mid.y - 0.5) < 1e-9 && Math.abs(q.x - 0.25) < 1e-9 && Math.abs(q.y - 0.75) < 1e-9 && out === null, `${w} x ${h} in a 1440 x 848 room: fitted, its shape kept; the middle and a quarter point land there, the letterbox nowhere`, { f, mid, q, out })
    }
    ok(pointAt(room, 1080, 1920, 10, 400) === null, 'the letterbox beside a portrait screen is no point on it')
    ok(JSON.stringify(captureSize(5120, 2880)) === '{"w":3840,"h":2160}' && JSON.stringify(captureSize(3024, 1964)) === '{"w":3024,"h":1964}' && JSON.stringify(captureSize(1080, 1920)) === '{"w":1080,"h":1920}' && JSON.stringify(captureSize(6016, 3384)) === '{"w":3840,"h":2160}', 'taken at the screen\'s own pixels (a Retina MacBook\'s whole), a 5K and a 6K at 3840 x 2160, a portrait one as it is')
    ok(bitrateFor(3840, 2160) === 12_000_000 && bitrateFor(1440, 900) === 3_240_000 && bitrateFor(640, 400) === 2_500_000, 'a bitrate for the size, from 2.5 to 12 Mbit/s')
    const sdp = ['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98', 'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96', 'a=rtpmap:98 H264/90000', 'a=fmtp:98 profile-level-id=42e01f', ''].join('\r\n')
    const out = sdpBitrate(sdp, { startKbps: 4000, minKbps: 1000 })
    ok(out.includes('a=rtpmap:96 VP8/90000\r\na=fmtp:96 x-google-start-bitrate=4000;x-google-min-bitrate=1000') && out.includes('a=fmtp:98 profile-level-id=42e01f;x-google-start-bitrate=4000;x-google-min-bitrate=1000') && out.includes('a=fmtp:97 apt=96\r\n') && sdpBitrate(out, { startKbps: 1, minKbps: 1 }) === out, 'the answer\'s video codecs start sharp with a floor (one without settings gets a line), the rest left as it was, never twice', out)
  })

  // ---------- in the browser ----------
  ;({ b } = await browser())
  const which = b.browserType().name()
  const tag = which === 'webkit' ? 'webkit-' : ''
  const errors = []
  // The viewer, in the browser: the password asked, the picture, the stage's and the picture's boxes.
  const enterPw = async (p, pw = PW) => { const box = p.locator('.rs-card.c-password input'); await box.waitFor({ timeout: 15000 }); await until(async () => box.isEnabled(), 5000, 50); await box.fill(pw); await box.press('Enter') }
  const picture = (p) => until(async () => (await p.locator('.rs-view img.rs-media').getAttribute('src').catch(() => ''))?.startsWith('blob:'), 15000)
  const boxes = (p) => p.evaluate(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }
    const st = document.querySelector('.rs-stage')
    return { stage: { ...r(st), cw: st.clientWidth, ch: st.clientHeight }, canvas: r(document.querySelector('.rs-canvas')), view: r(document.querySelector('.rs-view')), mode: st.dataset.mode, wide: document.documentElement.scrollWidth }
  })
  // The picture fills the room under the toolbar, its shape kept and centred, the room reaching the
  // window's foot.
  const fills = (b, w, h) => Math.abs(b.canvas.w / b.canvas.h - w / h) < 0.02 && (Math.abs(b.canvas.w - b.stage.cw) <= 2 || Math.abs(b.canvas.h - b.stage.ch) <= 2)
    && Math.abs((b.canvas.x - b.stage.x) * 2 + b.canvas.w - b.stage.cw) <= 2 && Math.abs((b.canvas.y - b.stage.y) * 2 + b.canvas.h - b.stage.ch) <= 2 && Math.abs(b.stage.y + b.stage.h - (b.view.y + b.view.h)) <= 1
  // How far apart a text's colour and what's behind it are (WCAG's ratio), whatever the colours are written as.
  const contrast = (loc) => loc.evaluate((el) => {
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const rgb = (css) => { c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = css; c.fillRect(0, 0, 1, 1); const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data; return a ? [r, g, b] : null }
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
    let bg = null
    for (let e = el; e && !bg; e = e.parentElement) { const x = getComputedStyle(e).backgroundColor; if (x && x !== 'transparent' && !/^rgba\(.*, 0\)$/.test(x)) bg = rgb(x) }
    const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(bg || [255, 255, 255])].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
  })
  const downSince = (n) => lines(inputs).slice(n).find((x) => x.t === 'down')
  const near = (a, x, y, d = 3) => !!a && Math.abs(a.x - x) <= d && Math.abs(a.y - y) <= d
  const viewOn = (p) => sendUntil(p, 'bridge-view-screen', { machine: S.id, name: 'Studio' }, '.rs-view')
  // Which screen?: opened from the toolbar (unless it's up already), and a screen picked by its name.
  const chooser = (p) => p.locator('.rs-pick')
  const pickScreen = async (p, name) => {
    if (!(await chooser(p).isVisible().catch(() => false))) await p.locator('.rs-bar .rs-source').click()
    await chooser(p).waitFor({ timeout: 8000 })
    await chooser(p).locator('.rs-pick-item').filter({ has: p.locator('b', { hasText: new RegExp(`^${name}$`) }) }).click()
    await chooser(p).waitFor({ state: 'hidden', timeout: 8000 })
  }
  // Its rows as shown: name, what's under it, whether it's showing, and whether its still came.
  const rows = (p) => chooser(p).locator('.rs-pick-list').first().locator('.rs-pick-item').evaluateAll((els) => els.map((e) => ({ name: e.querySelector('b').textContent, sub: e.querySelector('small').textContent, on: e.getAttribute('aria-pressed') === 'true', still: !!e.querySelector('.rs-thumb img')?.complete && (e.querySelector('.rs-thumb img')?.naturalWidth || 0) > 0, box: (() => { const r = e.querySelector('.rs-thumb > span').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })() })))
  const L = (await studio.api('/remote')).access.devices.find((d) => d.name === 'Laptop')

  await part('Laptop: View screen, the password, the picture filling the window, Control on each screen', async () => {
    const { p, errors: e1 } = await page(b, laptop.url)
    errors.push(...e1)
    await devices(p)
    const view = p.locator('.mch-row', { hasText: 'Studio' }).getByRole('button', { name: 'View screen' })
    await view.waitFor({ timeout: 15000 })
    await view.click()
    const card = p.locator('.rs-card.c-password')
    await card.waitFor({ timeout: 15000 })
    ok(/Studio asks for its password before it shows its screen/.test(await card.innerText()) && !(await p.locator('.rs-view img.rs-media').getAttribute('src')), 'View screen: Studio asks for its Remote Access Password first, and nothing shows before it', await card.innerText())
    const b0 = await boxes(p)
    const cb = await card.boundingBox()
    ok(Math.abs(cb.x + cb.width / 2 - (b0.stage.x + b0.stage.cw / 2)) <= 2 && Math.abs(cb.y + cb.height / 2 - (b0.stage.y + b0.stage.ch / 2)) <= 2, 'the question in the middle of the viewer', { card: cb, stage: b0.stage })
    await shot(p, `${tag}remote-screen-password`)
    await enterPw(p, 'not it at all')
    await p.locator('.rs-card-bad').waitFor({ timeout: 8000 })
    ok(/Wrong password\. 4 more wrong tries lock this device out for 15 minutes/.test(await p.locator('.rs-card-bad').innerText()), 'a wrong one: said, with the tries left', await p.locator('.rs-card-bad').innerText())
    await enterPw(p)
    ok(!!(await picture(p)), 'the right one: Studio\'s screen, its pictures shown')
    ok(fills(await boxes(p), 1280, 800), 'the picture fills the viewer under the toolbar, its shape kept, centred on the letterbox', await boxes(p))
    ok(/Through the relay \(slower\)/.test(await p.locator('.rs-mode').innerText()), 'and says it comes through the relay, slower')
    ok(await p.locator('.rs-view').getByText('View only').isVisible(), 'View only: Studio hasn\'t allowed control')
    await shot(p, `${tag}remote-screen-view`)
    const first = (await studio.api('/remote')).sessions[0]?.id
    // Studio turns control on meanwhile: Control, here, without connecting again.
    await studio.api('/remote/control', { on: true })
    const control = p.locator('.rs-bar').getByRole('button', { name: 'Control', exact: true })
    await control.waitFor({ timeout: 10000 })
    await control.click()
    await p.locator('.rs-bar').getByRole('button', { name: 'Controlling' }).waitFor({ timeout: 8000 })
    // Another of its screens, picked in the same session: a 5K one.
    ok(/Test screen/.test(await p.locator('.rs-bar .rs-source').innerText()) && !(await chooser(p).count()), 'on a computer, the toolbar says which screen shows (no question first)', await p.locator('.rs-bar .rs-source').innerText())
    await pickScreen(p, 'Studio Display')
    ok(!!(await until(async () => { const x = await boxes(p); return fills(x, 5120, 2880) ? x : null }, 10000)), 'Studio Display picked: the picture is that screen, 16:9, fitted', await boxes(p))
    const st0 = await studio.api('/remote')
    ok(st0.sessions.length === 1 && st0.sessions[0].id === first, 'in the same session (nothing to connect again, nor the password asked again)', st0.sessions)
    await p.locator('.rs-bar').getByRole('button', { name: 'Controlling' }).waitFor({ timeout: 4000 }).catch(() => {})
    if (!(await p.locator('.rs-bar').getByRole('button', { name: 'Controlling' }).count())) await p.locator('.rs-bar').getByRole('button', { name: 'Control', exact: true }).click()
    let x = await boxes(p)
    let n = lines(inputs).length
    await p.mouse.click(x.canvas.x + x.canvas.w / 2, x.canvas.y + x.canvas.h / 2)
    const d1 = await until(() => downSince(n), 5000, 50)
    ok(near(d1, 3584, 720), 'Fit: a click in the middle of the picture is the middle of that 5K display (at twice its points, right of the others)', d1)
    n = lines(inputs).length
    await p.mouse.click(x.canvas.x + x.canvas.w * 0.25, x.canvas.y + x.canvas.h * 0.75)
    const d2 = await until(() => downSince(n), 5000, 50)
    ok(near(d2, 2944, 1079), 'and a quarter across, three quarters down', d2)
    n = lines(inputs).length
    await p.keyboard.press('KeyA')
    ok(!!(await until(() => lines(inputs).slice(n).some((y) => y.code === 'KeyA'), 5000, 100)), 'a key on Studio\'s screen is pressed there')
    // Actual Size: one of its pixels to one of this screen's, scrolled about.
    await p.locator('.rs-size').getByRole('button', { name: 'Actual Size' }).click()
    x = await until(async () => { const y = await boxes(p); return y.mode === 'actual' && Math.abs(y.canvas.w - 5120) <= 2 ? y : null }, 5000)
    ok(!!x && Math.abs(x.canvas.h - 2880) <= 2, 'Actual Size: the picture at its own pixels (5120 x 2880), bigger than the window, scrolled', x)
    await p.locator('.rs-stage').evaluate((el) => { el.scrollLeft = 1000; el.scrollTop = 500 })
    await sleep(100)
    x = await boxes(p)
    n = lines(inputs).length
    await p.mouse.click(x.stage.x + 200, x.stage.y + 150)
    const d3 = await until(() => downSince(n), 5000, 50)
    ok(near(d3, 2904, 325), 'and a click there lands on that pixel of the display, scrolled to', d3)
    await shot(p, `${tag}remote-screen-actual-size`)
    await p.locator('.rs-size').getByRole('button', { name: 'Fit' }).click()
    // A portrait screen, fitted: tall in the middle, the letterbox either side.
    await pickScreen(p, 'Portrait screen')
    x = await until(async () => { const y = await boxes(p); return y.mode === 'fit' && fills(y, 1080, 1920) ? y : null }, 10000)
    ok(!!x && x.canvas.w < x.stage.cw / 2, 'a portrait screen: fitted to the height, its shape kept', x)
    n = lines(inputs).length
    await p.mouse.click(x.canvas.x + 2, x.canvas.y + 2)
    const d4 = await until(() => downSince(n), 5000, 50)
    ok(near(d4, Math.round(-1080 + (2 / x.canvas.w) * 1079), Math.round(-400 + (2 / x.canvas.h) * 1919)), 'its top left corner: where that display starts, left of and above the main one', d4)
    n = lines(inputs).length
    await p.mouse.click(x.stage.x + 10, x.stage.y + x.stage.ch / 2)
    await sleep(500)
    ok(!downSince(n), 'a click on the letterbox beside it presses nothing')
    await shot(p, `${tag}remote-screen-portrait`)
    await pickScreen(p, 'Test screen')
    await until(async () => fills(await boxes(p), 1280, 800), 8000)
    // Studio: the line saying it's being seen, with Stop.
    const st = await page(b, studio.url)
    errors.push(...st.errors)
    const line = st.p.locator('.rs-here')
    await line.waitFor({ timeout: 10000 })
    ok(/Laptop is controlling this screen|Laptop is viewing this screen/.test(await line.innerText()), 'Studio says it\'s being seen, and by which device', await line.innerText())
    await shot(st.p, `${tag}remote-screen-studio-seen`)
    // The desktop app's badge, the same page in a window of its own.
    const badge = await page(b, `${studio.url}/?remote=badge`, { width: 520, height: 58 })
    ok(!!(await until(async () => /Laptop is (viewing|controlling) this screen/.test(await badge.p.locator('.rs-badge').innerText().catch(() => '')), 8000)) && await badge.p.getByRole('button', { name: 'Stop' }).isVisible(), 'the desktop app\'s badge says who, with Stop', await badge.p.locator('.rs-badge').innerText().catch(() => ''))
    await shot(badge.p, `${tag}remote-screen-badge`)
    await badge.ctx.close()
    await line.getByRole('button', { name: 'Stop' }).click()
    ok(!!(await until(async () => /Stopped on Studio/.test(await p.locator('.rs-view').innerText()), 8000)), 'Stop on Studio: the viewer says so, in the middle, with View again')
    ok(await p.locator('.rs-card.c-ended').getByRole('button', { name: 'View again' }).isVisible(), 'View again there')
    await shot(p, `${tag}remote-screen-ended`)
    const notice = st.p.locator('.rs-here')
    ok(!!(await until(async () => /Laptop (viewed|controlled) this screen for/.test(await notice.innerText().catch(() => '')), 8000)), 'and Studio says afterwards who looked, and for how long', await notice.innerText().catch(() => ''))
    await notice.getByRole('button', { name: 'Got it' }).click()
    ok(!!(await until(async () => !(await st.p.locator('.rs-here').count()), 6000)), 'Got it clears it')
    await devices(st.p)
    const sec = st.p.locator('[data-setting=remote-access]')
    await sec.waitFor({ timeout: 10000 })
    ok(await sec.getByRole('switch', { name: /Let my other devices control this computer/ }).isChecked(), 'Studio\'s Settings: "Let my other devices control this computer", on')
    const rec = await st.p.locator('[data-setting=remote-sessions]').innerText()
    ok(/Screen Activity/.test(rec) && /Laptop/.test(rec) && /controlled/.test(rec) && /locked out for 15 minutes after 5 wrong passwords/.test(rec) && /told no here/.test(rec) && /Nobody answered/.test(rec), 'and Screen Activity: each session (who, which device, when, how long, whether it controlled), each lockout and each no', rec.slice(0, 600))
    await sec.getByRole('switch', { name: /Let my other devices control this computer/ }).click()
    ok(!!(await until(async () => !(await studio.api('/remote')).control.on, 5000)), 'turned off there')
    await shot(st.p, `${tag}remote-screen-settings`)
    await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    await st.ctx.close()
    await p.context().close()
  })

  await part('light and dark: every state in the middle, readable, in the app\'s own buttons', async () => {
    for (const mode of ['light', 'dark']) {
      const sfx = mode === 'dark' ? '-dark' : ''
      const { p, errors: e1 } = await page(b, laptop.url, { mode })
      errors.push(...e1)
      await ready(p)
      await viewOn(p)
      await p.locator('.rs-card.c-password').waitFor({ timeout: 15000 })
      if (mode === 'dark') await shot(p, `${tag}remote-screen-password${sfx}`)
      ok(await contrast(p.locator('.rs-card.c-password p').first()) >= 4.5 && await contrast(p.locator('.rs-card.c-password .btn').first()) >= 4.5, `${mode}: the password question and its buttons are readable`)
      await enterPw(p)
      await picture(p)
      ok(fills(await boxes(p), 1280, 800), `${mode}: the picture fills the viewer`)
      if (mode === 'dark') await shot(p, `${tag}remote-screen-view${sfx}`)
      await p.context().close()
      // macOS not letting Bridge AI record the screen there (the owner's case), as Studio says it.
      const why = "macOS doesn't let Bridge AI record the screen on Studio. On Studio, turn on Bridge AI in System Settings › Privacy & Security › Screen & System Audio Recording, then open Bridge AI again there."
      const q = await page(b, laptop.url, { mode, before: (ctx) => changeAnswer(ctx, /\/api\/remote\?sources=1/, (j) => ({ ...j, screen: { can: false, code: 'screenPermission', permission: 'denied', why } })) })
      errors.push(...q.errors)
      await ready(q.p)
      await viewOn(q.p)
      const card = q.p.locator('.rs-card.c-screenPermission')
      // (What the viewer showed instead, when it doesn't come.)
      await card.waitFor({ timeout: 15000 }).catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} (the viewer: ${await q.p.locator('.rs-view').innerText({ timeout: 1000 }).then((s) => s.replace(/\s+/g, ' ').slice(0, 200), () => 'not there')})`) })
      const x = await boxes(q.p)
      const cb = await card.boundingBox()
      const again = card.getByRole('button', { name: 'Try again' })
      ok(/System Settings › Privacy & Security › Screen & System Audio Recording/.test(await card.innerText()) && Math.abs(cb.x + cb.width / 2 - (x.stage.x + x.stage.cw / 2)) <= 2 && Math.abs(cb.y + cb.height / 2 - (x.stage.y + x.stage.ch / 2)) <= 2 && Math.abs(x.stage.y + x.stage.h - (x.view.y + x.view.h)) <= 1, `${mode}: macOS not allowing it, said in the middle of the viewer, which fills the window`, { card: cb, stage: x.stage })
      ok(await contrast(card.locator('p')) >= 4.5 && await contrast(again) >= 4.5 && await again.evaluate((el) => el.classList.contains('btn')), `${mode}: its words and Try again readable, in the app's own button`, [await contrast(card.locator('p')), await contrast(again)])
      await shot(q.p, `${tag}remote-screen-permission${sfx}`)
      await q.ctx.close()
    }
  })

  // Each reason Studio's screen doesn't show, as Studio would say it (its status, and its session's
  // messages, stood in for): said as it is, with the button that fixes it, which does; on a computer
  // and at a phone's width. Never a bare Try again when the reason is known.
  await part('each reason the screen doesn\'t show: said, with the button that fixes it, on a computer and a phone', async () => {
    const H = { t: 'hello', session: 'x1', name: 'Studio', os: 'mac', source: { kind: 'screen', id: 'fake-1', name: 'Test screen', w: 1280, h: 800 }, sources: [{ id: 'fake-1', name: 'Test screen', kind: 'screen', w: 1280, h: 800, primary: true }], p2p: null, rate: 2, control: { on: false, allowed: false, why: null } }
    const OLD_SOURCE = "Studio didn't say which screens it has. Try again in a moment."
    const OLD_CAPTURE = "The Bridge AI app on Studio didn't start sharing its screen. Try again; if it keeps happening, restart Bridge AI there."
    const PERMISSION = "macOS doesn't let Bridge AI record the screen on Studio. On Studio, turn on Bridge AI in System Settings › Privacy & Security › Screen & System Audio Recording, then open Bridge AI again there."
    for (const phone of [false, true]) {
      const sfx = phone ? '-phone' : ''
      let status = (j) => j
      let statusCode = 0
      let onView = () => {}
      let onSent = () => {}
      const urls = []
      const sent = []
      let installs = 0
      const q = await page(b, laptop.url, {
        phone,
        before: async (ctx) => {
          // (The later route first: a 404 when asked, else Studio's real answer, changed.)
          // (No service worker, as in the desktop app: WebKit's test build doesn't route what one fetches.)
          await noServiceWorker(ctx)
          await changeAnswer(ctx, /\/api\/remote\?sources=1/, (j) => status(j))
          await ctx.route(/\/api\/remote\?sources=1/, (r) => (statusCode ? r.fulfill({ status: statusCode, json: { error: 'Not found' } }) : r.fallback()))
          await ctx.route(/\/api\/updates\/install/, (r) => { installs++; return r.fulfill({ json: { started: true } }) })
          // (One handler for what the page sends: Playwright keeps the last one given.)
          await ctx.routeWebSocket(/\/api\/remote\/view/, (ws) => {
            urls.push(ws.url())
            ws.onMessage((m) => { let x = null; try { x = JSON.parse(String(m)) } catch { /* not JSON */ } if (x) { sent.push(x); onSent(ws, x) } })
            onView(ws)
          })
        },
      })
      errors.push(...q.errors)
      const p = q.p
      await ready(p)
      const say = (ws, m, ms = 80) => setTimeout(() => ws.send(JSON.stringify(m)), ms)
      const card = () => p.locator('.rs-view .rs-card').first()
      // One reason: Studio's view stood in for, the card it shows, then Stop viewing.
      const shows = async (name, set, check) => {
        status = set.status || ((j) => j)
        statusCode = set.code || 0
        onView = set.view || (() => {})
        onSent = set.sent || (() => {})
        urls.length = 0
        sent.length = 0
        await viewOn(p)
        await card().waitFor({ timeout: 10000 }).catch(() => {})
        await p.locator('.rs-view .rs-card[role=alert]').waitFor({ timeout: 8000 }).catch(() => {})
        await shot(p, `${tag}remote-screen-why-${name}${sfx}`)
        await check()
        await p.locator('.rs-view').getByRole('button', { name: 'Stop viewing' }).click()
        await p.locator('.rs-view').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
      }
      const text = async (sel) => (await p.locator(sel).first().innerText({ timeout: 8000 }).catch(() => '')).replace(/\s+/g, ' ').trim()
      // (What a card says once it says it: the one saying it's connecting comes first.)
      const says = async (sel, re) => !!(await until(async () => re.test(await text(sel)), 6000, 100))
      const button = (name) => p.locator('.rs-view .rs-card').getByRole('button', { name, exact: true })

      // No capture page even with a second window: said so, with Reopen; chosen, it's carried out
      // in the same session, and the screen follows.
      await shows('no-capture', {
        view: (ws) => say(ws, { t: 'error', code: 'noCapture', cause: 'window', fix: 'reopen', waits: true, why: "The Bridge AI app on Studio didn't open its screen sharing." }),
        sent: (ws, m) => { if (m.t === 'fix') { say(ws, { t: 'wait', why: 'reopen' }); say(ws, H, 900) } },
      }, async () => {
        ok(/The Bridge AI app on Studio didn't open its screen sharing, even with a second try\./.test(await text('.rs-card.c-noCapture p')) && await button('Reopen Bridge AI on Studio').isVisible() && !(await button('Try again').count()), `${phone ? 'phone' : 'computer'}: no capture page: said so, with Reopen Bridge AI on Studio (no bare Try again)`, await text('.rs-card'))
        ok(/fixes=1/.test(urls[0] || ''), 'its session takes fixes', urls)
        await button('Reopen Bridge AI on Studio').click()
        ok(await says('.rs-card.c-wait', /Reopening Bridge AI on Studio…/) && sent.some((m) => m.t === 'fix' && m.fix === 'reopen'), 'Reopen: asked of Studio in the session, and said while it reopens', sent)
        ok(!!(await until(async () => (await p.locator('.rs-view .rs-mode').count()) && !(await p.locator('.rs-view .rs-card').count()), 8000)), 'and the screen, in the same session')
      })
      await shows('no-list', {
        view: (ws) => say(ws, { t: 'error', code: 'noCapture', cause: 'list', fix: 'reopen', waits: true, why: 'Bridge AI on Studio opened its screen sharing but never said which screens there are: macOS didn\'t list them in time.' }),
      }, async () => {
        ok(/Bridge AI on Studio opened its screen sharing, but the list of its screens didn't come in time\./.test(await text('.rs-card.c-noCapture p')) && await button('Reopen Bridge AI on Studio').isVisible(), 'the screens never listed: said so, with Reopen', await text('.rs-card'))
      })
      // The app closed there: said before connecting, with Open Bridge AI there, which connects with it.
      await shows('no-app', {
        status: (j) => ({ ...j, screen: { can: false, code: 'noApp', fix: 'open', why: 'Open the Bridge AI app on Studio: its screen can be seen while the app runs there.' } }),
        view: (ws) => say(ws, { t: 'wait', why: 'open' }),
      }, async () => {
        ok(/The Bridge AI app isn't open on Studio\. Its screen can be seen while the app runs there\./.test(await text('.rs-card.c-noApp p')) && await button('Open Bridge AI on Studio').isVisible() && !urls.length, 'the app closed on Studio: said so, with Open Bridge AI on Studio, nothing connected yet', { card: await text('.rs-card'), urls })
        await button('Open Bridge AI on Studio').click()
        ok(await says('.rs-card.c-wait', /Opening Bridge AI on Studio…/) && /fixes=1/.test(urls[0] || '') && /fix=open/.test(urls[0] || ''), 'Open: a session that carries it out past the password, said while it opens', urls)
      })
      // Screen Recording turned down there: said, with Allow Screen Recording there.
      await shows('permission', {
        status: (j) => ({ ...j, screen: { can: false, code: 'screenPermission', permission: 'denied', fix: 'allow', why: PERMISSION } }),
        view: (ws) => say(ws, { t: 'wait', why: 'allow', until: new Date(Date.now() + 180000).toISOString() }),
      }, async () => {
        ok((await text('.rs-card.c-screenPermission p')) === PERMISSION && await button('Allow Screen Recording on Studio').isVisible(), 'Screen Recording turned down on Studio: said, with Allow Screen Recording on Studio', await text('.rs-card'))
        await button('Allow Screen Recording on Studio').click()
        ok(await says('.rs-card.c-wait', /System Settings is open on Studio at Screen & System Audio Recording\. Waiting for someone there to turn on Bridge AI…/) && /fix=allow/.test(urls[0] || ''), 'Allow: System Settings opened there, and waited for', await text('.rs-card'))
      })
      // An older Bridge AI there (no version said): what it said, and Update Bridge AI there, which
      // fixes it (it reopens), beside Try again.
      for (const [name, code, why] of [['old-no-screens', 'source', OLD_SOURCE], ['old-no-capture', 'noCapture', OLD_CAPTURE]]) {
        await shows(name, {
          status: ({ version, ...j }) => j,
          view: (ws) => say(ws, { t: 'error', code, why }),
        }, async () => {
          const said = await text(`.rs-card.c-${code}`)
          ok(said.includes(why) && /Studio has an older Bridge AI\. Updating it reopens it there, which usually sorts this\./.test(said) && await button('Update Bridge AI on Studio').isVisible() && await button('Try again').isVisible(), `an older Bridge AI on Studio (${code}): what it said, with Update Bridge AI on Studio`, said)
          if (code !== 'source') return
          await button('Update Bridge AI on Studio').click()
          ok(!!(await until(() => installs > 0, 4000, 50)) && await says('.rs-card.c-wait', /Updating Bridge AI on Studio….*It reopens by itself when it's done/), 'Update: Studio is asked to update, and the viewer says so while it does', installs)
        })
      }
      await shows('too-old', { code: 404 }, async () => {
        ok(/Update Bridge AI on Studio to see its screen from here\./.test(await text('.rs-card.c-update')) && await button('Update Bridge AI on Studio').isVisible(), 'a Bridge AI there too old for this at all: Update Bridge AI on Studio', await text('.rs-card'))
      })
      await shows('offline', {
        view: (ws) => say(ws, { t: 'error', code: 'offline', why: 'Studio is offline' }),
      }, async () => {
        ok(/Studio isn't reachable just now: it may be asleep, or offline\./.test(await text('.rs-card.c-offline p')) && await button('Try again').isVisible(), 'not reachable: said so', await text('.rs-card'))
      })
      // Closed before it said anything: connected again once by itself, then said.
      await shows('closed', {
        view: (ws) => setTimeout(() => ws.close(), 50),
      }, async () => {
        ok(/The connection to Studio closed before its screen showed\./.test(await text('.rs-card.c-closed p')) && urls.length === 2, 'closed before anything was said: tried again once by itself, then said so', { urls: urls.length, said: await text('.rs-card') })
      })
      await q.ctx.close()
    }
    ok(/Remote Screen: Studio's screen didn't show here \(noCapture, window; it has Bridge AI [\w.-]+\): The Bridge AI app on Studio didn't open its screen sharing\./.test(laptop.log()), 'each reason in the viewer\'s own log too', laptop.log().split('\n').filter((l) => /Remote Screen/.test(l)).slice(-3))
  })

  await part('the desktop app\'s window of its own: its toolbar the title bar, clear of the window\'s buttons', async () => {
    // As preload.js marks a page of the desktop app's on a Mac (its window's buttons drawn over the
    // page at 14, 17: main.js and desktop/remote.js trafficLightPosition).
    const mac = (ctx) => ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', 'platform-darwin')))
    for (const mode of ['light', 'dark']) {
      const { p, errors: e1 } = await page(b, `${laptop.url}/?remote=view&${new URLSearchParams({ machine: S.id, name: 'Studio' })}`, { mode, width: 1296, height: 781, before: mac })
      errors.push(...e1)
      await enterPw(p)
      await picture(p)
      const look = await p.evaluate(() => {
        const r = (e) => e.getBoundingClientRect()
        const bar = document.querySelector('.rs-bar')
        return { bar: r(bar).toJSON(), title: r(document.querySelector('.rs-title')).toJSON(), drag: getComputedStyle(bar).getPropertyValue('-webkit-app-region') || getComputedStyle(bar).webkitAppRegion || '', button: getComputedStyle(document.querySelector('.rs-stop')).getPropertyValue('-webkit-app-region') || '', doc: document.title }
      })
      // The window's three buttons take x 14 to about 68, around y 23.
      ok(look.title.left >= 76 && look.bar.height >= 52 && Math.abs(look.title.top + look.title.height / 2 - 26) <= 4 && /Studio's Screen · Bridge AI/.test(look.doc), `${mode}: the title clears the window's buttons, on their line, and names the window`, look)
      // (A browser that doesn't know the property says nothing of it either way.)
      ok(look.drag === 'drag' ? look.button === 'no-drag' : !look.drag && !look.button, `${mode}: the toolbar moves the window, its buttons stay buttons`, look)
      ok(fills(await boxes(p), 1280, 800), `${mode}: the picture fills the window under it`)
      ok(!(await p.locator('.rs-view').getByRole('button', { name: 'Close' }).count()), `${mode}: no Close of its own beside the window's`)
      await shot(p, `${tag}remote-screen-window${mode === 'dark' ? '-dark' : ''}`)
      await p.context().close()
    }
  })

  await part('at a phone\'s width: fitted, pinched to zoom, a tap a click, locked out and told no', async () => {
    const { p, errors: e1 } = await page(b, laptop.url, { phone: true })
    errors.push(...e1)
    await ready(p)
    await viewOn(p)
    await p.locator('.rs-card.c-password').waitFor({ timeout: 15000 })
    const fs16 = await p.locator('.rs-card.c-password input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    ok(fs16 >= 16 && (await boxes(p)).wide <= 390, 'the password question fits the phone, its field not zoomed into', fs16)
    await shot(p, `${tag}remote-screen-phone-password`)
    await enterPw(p)
    await picture(p)
    // Several screens: Which screen? first, each by name and size, the main one marked, a still of each.
    await chooser(p).waitFor({ timeout: 8000 })
    const r0 = await until(async () => { const r = await rows(p); return r.length === 5 && r.every((y) => y.still) ? r : null }, 8000)
    ok(!!r0 && r0[0].name === 'Test screen' && /^1280×800 · Main screen$/.test(r0[0].sub) && r0[0].on && r0.some((y) => y.name === 'Studio Display' && y.sub === '5120×2880') && r0.some((y) => y.name === 'Portrait screen' && y.sub === '1080×1920'), 'at a phone\'s width with several screens, Which screen? first: each by name and size, the main one marked and showing, a still of each', r0 || await rows(p))
    const tall = r0?.find((y) => y.name === 'Portrait screen')
    ok(!!tall && tall.box.h > tall.box.w && r0[0].box.w > r0[0].box.h, 'each still in its screen\'s own shape (the portrait one tall)', r0?.map((y) => y.box))
    ok(JSON.stringify(await phoneFaults(p, '.rs-pick')) === '{}', 'it fits the phone, each row a whole 40 px target', await phoneFaults(p, '.rs-pick'))
    await shot(p, `${tag}remote-screen-phone-which`)
    await pickScreen(p, 'Test screen')
    let x = await boxes(p)
    ok(fills(x, 1280, 800) && Math.abs(x.canvas.w - x.stage.cw) <= 2 && x.wide <= 390, 'fitted to the phone\'s width, its shape kept, nothing wider than the screen', x)
    const small = await p.locator('.rs-bar').evaluate((el) => [...el.querySelectorAll('button, select')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 40 || b.getBoundingClientRect().width < 40)).map((b) => b.getAttribute('aria-label') || b.textContent))
    ok(!small.length, 'every button on the toolbar a whole 40 px target', small)
    await shot(p, `${tag}remote-screen-phone`)
    // Pinched open with two fingers.
    const z = await p.evaluate(async () => {
      try { new Touch({ identifier: 0, target: document.body, clientX: 0, clientY: 0 }) } catch { return null }
      const el = document.querySelector('.rs-stage')
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + Math.min(r.height / 2, 120)
      const t = (id, x0) => new Touch({ identifier: id, target: el, clientX: x0, clientY: cy })
      const fire = (type, ts) => el.dispatchEvent(new TouchEvent(type, { touches: ts, targetTouches: ts, changedTouches: ts, bubbles: true, cancelable: true }))
      fire('touchstart', [t(1, cx - 30), t(2, cx + 30)])
      for (let i = 1; i <= 10; i++) { fire('touchmove', [t(1, cx - 30 - i * 9), t(2, cx + 30 + i * 9)]); await new Promise((ok) => requestAnimationFrame(ok)) }
      fire('touchend', [])
      await new Promise((ok) => setTimeout(ok, 150))
      return { mode: el.dataset.mode, canvas: document.querySelector('.rs-canvas').getBoundingClientRect().width, stage: el.clientWidth, left: el.scrollLeft }
    })
    if (!z) skip('a pinch to zoom', `${which} here makes no touch events from a page`)
    else {
      ok(z.mode === 'zoom' && z.canvas > z.stage * 2.2 && z.left > 0, 'pinched open: zoomed in about the fingers (2.5 times), scrolled to them', z)
      await shot(p, `${tag}remote-screen-phone-zoom`)
      await p.locator('.rs-bar').getByRole('button', { name: 'Fit' }).click()
      ok(!!(await until(async () => (await boxes(p)).mode === 'fit', 3000)), 'Fit puts it back')
    }
    // A tap with control on: a click there.
    await studio.api('/remote/control', { on: true })
    const control = p.locator('.rs-bar').getByRole('button', { name: 'Control', exact: true })
    await control.waitFor({ timeout: 10000 })
    await control.click()
    await p.locator('.rs-bar').getByRole('button', { name: 'Controlling' }).waitFor({ timeout: 8000 })
    x = await boxes(p)
    const n = lines(inputs).length
    await p.touchscreen.tap(x.canvas.x + x.canvas.w / 2, x.canvas.y + x.canvas.h / 2)
    const tap = await until(() => { const l = lines(inputs).slice(n); return l.some((y) => y.t === 'up') ? l : null }, 5000, 50)
    ok(near(tap?.find((y) => y.t === 'down'), 640, 400), 'a tap in the middle of the picture: a click in the middle of Studio\'s screen', tap)
    ok(await p.locator('.rs-type input').isVisible(), 'with a field to type on Studio, and the clipboard beside it')
    await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    await studio.api('/remote/control', { on: false })
    // Locked out after 5 wrong passwords: said, with when it can try again.
    await viewOn(p)
    for (let i = 0; i < 5; i++) { await enterPw(p, `wrong ${i}`); if (i < 4) await p.locator('.rs-card-bad').waitFor({ timeout: 8000 }) }
    const locked = p.locator('.rs-card.c-locked')
    await locked.waitFor({ timeout: 8000 })
    ok(/Too many wrong passwords\. Studio lets this device try again at/.test(await locked.innerText()) && await locked.getByRole('button', { name: 'Try again' }).isDisabled(), 'locked out: said, with when, and Try again only then', await locked.innerText())
    await shot(p, `${tag}remote-screen-phone-locked`)
    await studio.api(`/remote/locks/${encodeURIComponent(L.id)}/clear`, {})
    await p.locator('.rs-card.c-locked').getByRole('button', { name: 'Close' }).click()
    // Ask Here First, and a no.
    await studio.api('/remote/ask-first', { on: true })
    await viewOn(p)
    await enterPw(p)
    const asking = p.locator('.rs-card.c-asking')
    await asking.waitFor({ timeout: 8000 })
    ok(/Waiting for someone at Studio to allow this/.test(await asking.innerText()) && /seconds left\. No answer is a no\./.test(await asking.innerText()), 'Ask Here First: waiting on Studio, saying so', await asking.innerText())
    await shot(p, `${tag}remote-screen-phone-asking`)
    const a = await until(async () => (await studio.api('/remote')).asks[0], 3000, 100)
    await studio.api(`/remote/asks/${a.id}`, { allow: false })
    const denied = p.locator('.rs-card.c-denied')
    await denied.waitFor({ timeout: 8000 })
    ok(/Someone at Studio said no to this/.test(await denied.innerText()), 'told no: said so, with why', await denied.innerText())
    await shot(p, `${tag}remote-screen-phone-denied`)
    await p.context().close()
    const d = await page(b, laptop.url, { phone: true, mode: 'dark' })
    errors.push(...d.errors)
    await ready(d.p)
    await viewOn(d.p)
    await enterPw(d.p)
    await d.p.locator('.rs-card.c-asking').waitFor({ timeout: 8000 })
    await studio.api(`/remote/asks/${(await until(async () => (await studio.api('/remote')).asks[0], 3000, 100)).id}`, { allow: true })
    await picture(d.p)
    await chooser(d.p).waitFor({ timeout: 8000 })
    await until(async () => (await rows(d.p)).every((y) => y.still), 6000)
    await shot(d.p, `${tag}remote-screen-phone-which-dark`)
    await pickScreen(d.p, 'MacBook Air')
    ok(!!(await until(async () => fills(await boxes(d.p), 1440, 900), 8000)), 'dark: MacBook Air picked, its picture fitted')
    await shot(d.p, `${tag}remote-screen-phone-dark`)
    await d.ctx.close()
  })

  await part('Ask Here First on the badge: Allow', async () => {
    const { p, errors: e1 } = await page(b, laptop.url)
    errors.push(...e1)
    await ready(p)
    const badge = await page(b, `${studio.url}/?remote=badge`, { width: 520, height: 58 })
    await viewOn(p)
    await enterPw(p)
    await p.locator('.rs-card.c-asking').waitFor({ timeout: 8000 })
    const allow = badge.p.getByRole('button', { name: 'Allow' })
    await allow.waitFor({ timeout: 5000 })
    ok(/Laptop \(a computer, connected directly\) asks to see (and control )?this screen/.test(await badge.p.locator('.rs-badge').innerText()) && await badge.p.getByRole('button', { name: 'Deny' }).isVisible(), 'the badge: who asks (what kind of device, and how it came), with Deny and Allow', await badge.p.locator('.rs-badge').innerText())
    await shot(badge.p, `${tag}remote-screen-badge-ask`)
    await allow.click()
    ok(!!(await picture(p)), 'Allow there: the screen comes')
    await studio.api('/remote/ask-first', { on: false })
    await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    await badge.ctx.close()
    await p.context().close()
  })

  await part('Remote Access in Studio\'s Settings, and shown from another computer\'s window', async () => {
    const { p, errors: e1 } = await page(b, studio.url)
    errors.push(...e1)
    await devices(p)
    const sec = p.locator('[data-setting=remote-access]')
    await sec.waitFor({ timeout: 10000 })
    ok(/Set on /.test(await sec.locator('[data-setting=remote-password]').innerText()), 'the password: set, and when')
    await sec.getByRole('button', { name: 'Remove', exact: true }).click()
    await sec.getByRole('button', { name: 'Remove Password' }).click()
    const sw = sec.getByRole('switch', { name: /Let my other devices control this computer/ })
    ok(!!(await until(async () => !(await studio.api('/remote')).access.password && await sw.isDisabled(), 5000)) && /Set a Remote Access Password first: control needs one/.test(await sec.innerText()), 'Remove: no password, and control can\'t be turned on until there is one')
    await sec.getByRole('button', { name: 'Set Password' }).click()
    await sec.getByLabel('New password').fill(PW)
    await sec.getByLabel('The same again').fill(`${PW}x`)
    await sec.getByRole('button', { name: 'Save Password' }).click()
    ok(/aren't the same/.test(await sec.locator('.error-text').innerText()), 'two that differ: said so')
    await sec.getByLabel('The same again').fill(PW)
    await sec.getByRole('button', { name: 'Save Password' }).click()
    ok(!!(await until(async () => (await studio.api('/remote')).access.password && await sw.isEnabled(), 6000)), 'Set Password: set, and control can be turned on')
    await sec.getByRole('switch', { name: /^Ask Here First/ }).click()
    ok(!!(await until(async () => (await studio.api('/remote')).access.askFirst, 5000)), 'Ask Here First turned on there')
    await sec.locator('.rs-devices').getByRole('checkbox', { name: 'Phone phone', exact: true }).click()
    ok(!!(await until(async () => (await studio.api('/remote')).access.devices.find((d) => d.name === 'Phone')?.allowed === false, 5000)), 'a device unticked there')
    await shot(p, `${tag}remote-screen-remote-access`)
    const dk = await page(b, studio.url, { mode: 'dark' })
    errors.push(...dk.errors)
    await devices(dk.p)
    await dk.p.locator('[data-setting=remote-access]').waitFor({ timeout: 10000 })
    await dk.p.locator('[data-setting=remote-access]').scrollIntoViewIfNeeded()
    await shot(dk.p, `${tag}remote-screen-remote-access-dark`)
    await dk.ctx.close()
    // From Laptop's window showing Studio: as it is, saying where it's changed.
    const port = (await laptop.api('/machines')).machines.find((m) => m.id === S.id)?.port
    const el = await page(b, `http://127.0.0.1:${port}/m/${S.id}/`)
    errors.push(...el.errors)
    await devices(el.p)
    const rs = el.p.locator('[data-setting=remote-access]')
    await rs.waitFor({ timeout: 15000 })
    const said = await rs.innerText()
    ok(/The password is set at Studio itself, never from another device/.test(said) && /Changed at Studio itself/.test(said) && !(await rs.getByRole('button', { name: /Set Password|Change Password/ }).count()) && await rs.getByRole('switch', { name: /^Ask Here First/ }).isDisabled() && await rs.getByRole('switch', { name: /^Ask Here First/ }).isChecked(), 'from another computer\'s window: shown as it is (Ask Here First on), nothing changed there, saying where it is', said.slice(0, 400))
    ok(!(await rs.locator('.rs-devices').count()) && /Kept at Studio itself/.test(await el.p.locator('[data-setting=remote-sessions]').innerText()), 'Studio\'s devices and its record aren\'t shown there: they\'re Studio\'s own to see')
    await rs.scrollIntoViewIfNeeded()
    await shot(el.p, `${tag}remote-screen-remote-access-elsewhere`)
    await el.ctx.close()
    await sec.getByRole('switch', { name: /^Ask Here First/ }).click()
    await sec.locator('.rs-devices').getByRole('checkbox', { name: 'Phone phone', exact: true }).click()
    ok(!!(await until(async () => { const a = (await studio.api('/remote')).access; return !a.askFirst && a.devices.every((d) => d.allowed) }, 5000)), 'and back as they were')
    await p.context().close()
  })

  await part('the card in every other window: which computer, from which device, for how long, with Stop and Block This Device', async () => {
    const { p, errors: e1 } = await page(b, laptop.url)
    errors.push(...e1)
    await ready(p)
    const v = ph.socket('/api/remote/view?source=screen:')
    await through(v)
    const card = p.locator('.rs-live .ask-row', { hasText: 'Phone' })
    await card.waitFor({ timeout: 10000 })
    const said = await card.innerText()
    ok(/Studio's screen is being viewed from Phone \(phone\)/.test(said) && /· 1 min/.test(said) && await card.getByRole('button', { name: 'Stop', exact: true }).isVisible() && await card.getByRole('button', { name: 'Block This Device' }).isVisible(), 'Laptop\'s window: a card saying Studio\'s screen is being viewed from Phone, for how long, with Stop and Block This Device', said)
    ok(await card.getByRole('button', { name: 'Stop', exact: true }).evaluate((el) => getComputedStyle(el).color) === 'rgb(255, 255, 255)', 'its Stop in white on red, whatever else Bridge AI has loaded')
    await shot(p, `${tag}remote-screen-card`)
    // Studio's own window says it in its own line (with its Stop), not the card as well.
    const st = await page(b, studio.url)
    errors.push(...st.errors)
    await ready(st.p)
    await st.p.locator('.rs-here').waitFor({ timeout: 10000 })
    ok(!(await st.p.locator('.rs-live').count()), 'Studio\'s own window: its own line, not the card too')
    await st.ctx.close()
    await card.getByRole('button', { name: 'Stop', exact: true }).click()
    await v.wait((s) => msg(s, 'ended') || s.closed, 8000)
    ok(msg(v, 'ended')?.why === 'stopped' && msg(v, 'ended').by === 'Laptop', 'Stop on Laptop\'s card: the session ends at Studio, the phone told it was stopped from Laptop', msg(v, 'ended'))
    ok(!!(await until(async () => !(await p.locator('.rs-live .ask-row').count()), 8000)), 'and the card goes')
    // The window viewing it shows no card of its own session.
    await viewOn(p)
    await enterPw(p)
    await picture(p)
    await sleep(1200)
    ok(!(await p.locator('.rs-live .ask-row').count()), 'the window doing the viewing shows no card of its own session')
    await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    await p.context().close()
    // At a phone's width, dark: the card fits, and Block This Device.
    for (const mode of ['light', 'dark']) {
      const d = await page(b, laptop.url, { phone: true, mode })
      errors.push(...d.errors)
      await ready(d.p)
      const v2 = ph.socket('/api/remote/view?source=screen:')
      await through(v2)
      const c2 = d.p.locator('.rs-live')
      await c2.locator('.ask-row', { hasText: 'Phone' }).waitFor({ timeout: 10000 })
      ok(JSON.stringify(await phoneFaults(d.p, '.rs-live')) === '{}', `${mode}: at a phone's width the card fits, its buttons whole 40 px targets`, await phoneFaults(d.p, '.rs-live'))
      await shot(d.p, `${tag}remote-screen-card-phone${mode === 'dark' ? '-dark' : ''}`)
      if (mode === 'light') { await c2.locator('.ask-row', { hasText: 'Phone' }).getByRole('button', { name: 'Stop', exact: true }).click(); await v2.wait((s) => s.closed, 8000); await d.ctx.close(); continue }
      await c2.locator('.ask-row', { hasText: 'Phone' }).getByRole('button', { name: 'Block This Device' }).click()
      await v2.wait((s) => msg(s, 'error'), 8000)
      const P = (await studio.api('/remote')).access.devices.find((x) => x.name === 'Phone')
      // (The card says so once Laptop has heard back from Studio, which can be after the phone was told.)
      const said = !!(await until(async () => /Phone can't connect to Studio any more/.test(await c2.innerText().catch(() => '')), 8000, 100))
      ok(msg(v2, 'error')?.code === 'blocked' && P.allowed === false && said, 'Block This Device on the card: the Phone is unticked at Studio, and the card says where it\'s let back in', [msg(v2, 'error'), await c2.innerText().catch(() => '')])
      await studio.api('/remote/devices', { id: P.id, allowed: true })
      await d.ctx.close()
    }
  })

  await part('Screen Sharing Notifications in Settings, and never silent', async () => {
    const { p, errors: e1 } = await page(b, studio.url)
    errors.push(...e1)
    await devices(p)
    const sec = p.locator('[data-setting=remote-notify]')
    await sec.waitFor({ timeout: 10000 })
    const said = await sec.innerText()
    ok(await sec.getByRole('switch', { name: /Screen Sharing Notifications/ }).isChecked() && /On this computer: (Studio browser, Phone|Phone, Studio browser)\./.test(said) && /Through Laptop: 2 devices\./.test(said), 'Settings › Remote Access: on, and where they go (this computer\'s devices, and Laptop\'s through it)', said)
    await sec.scrollIntoViewIfNeeded()
    await shot(p, `${tag}remote-screen-notify-settings`)
    // Nobody set up anywhere: said, with the way to set one up, and a session still recorded.
    for (const k of [studio, laptop]) for (const x of await k.api('/push/devices')) await k.api('/push/unsubscribe', { id: x.id })
    const LM = (await studio.api('/machines')).machines.find((m) => m.name === 'Laptop')
    await studio.api(`/needs-you?fresh=${LM.id}`)
    await until(async () => (await studio.api('/remote')).notify.computers[0]?.devices === 0, 20000, 300)
    const nowhere = sec.locator('.rs-nowhere')
    await nowhere.waitFor({ timeout: 10000 })
    ok(/No notification channel is set up on this computer or your other computers, so nobody would be told/.test(await nowhere.innerText()) && await nowhere.getByRole('button', { name: 'Set Up Notifications' }).isVisible(), 'none set up anywhere: Settings says nobody would be told, with Set Up Notifications', await nowhere.innerText())
    await nowhere.scrollIntoViewIfNeeded()
    await shot(p, `${tag}remote-screen-notify-nowhere`)
    const v = ph.socket('/api/remote/view?source=screen:')
    await through(v)
    const here = await page(b, studio.url)
    errors.push(...here.errors)
    const line = here.p.locator('.rs-here')
    ok(!!(await until(async () => /Your other devices weren't told: no notification channel is set up/.test(await line.innerText().catch(() => '')), 10000)), 'a session meanwhile: Studio\'s own line says your other devices weren\'t told, with Set Up Notifications', await line.innerText().catch(() => ''))
    await shot(here.p, `${tag}remote-screen-notify-untold`)
    await here.ctx.close()
    await v.close()
    await until(async () => !(await studio.api('/remote')).sessions.length, 5000, 100)
    const rec = p.locator('[data-setting=remote-sessions]')
    ok(!!(await until(async () => /No notification went out: no notification channel is set up/.test(await rec.innerText()), 8000)) && /Notified 3 of your devices/.test(await rec.innerText()), 'Screen Activity says, for each session, how many of your devices were told, or that none were', (await rec.innerText()).slice(0, 500))
    await nowhere.getByRole('button', { name: 'Set Up Notifications' }).click()
    ok(!!(await until(async () => p.locator('[data-setting=this-device]').isVisible(), 6000)), 'Set Up Notifications opens Settings › Notifications')
    const dk = await page(b, studio.url, { mode: 'dark' })
    errors.push(...dk.errors)
    await devices(dk.p)
    await dk.p.locator('[data-setting=remote-notify]').scrollIntoViewIfNeeded()
    await shot(dk.p, `${tag}remote-screen-notify-nowhere-dark`)
    await dk.ctx.close()
    // From Laptop's window showing Studio: whether they're on, changed at Studio only.
    const port = (await laptop.api('/machines')).machines.find((m) => m.id === S.id)?.port
    const el = await page(b, `http://127.0.0.1:${port}/m/${S.id}/`)
    errors.push(...el.errors)
    await devices(el.p)
    const rs = el.p.locator('[data-setting=remote-notify]')
    await rs.waitFor({ timeout: 15000 })
    ok(await rs.getByRole('switch', { name: /Screen Sharing Notifications/ }).isDisabled() && /Turned on and off at Studio itself/.test(await rs.innerText()) && !/On this computer:|No notification channel/.test(await rs.innerText()), 'from another computer\'s window: on, changed at Studio only, and not where they go', await rs.innerText())
    await el.ctx.close()
    await p.context().close()
  })

  ok(!!(await until(async () => !(await studio.api('/remote')).sessions.length, 8000, 200)), 'every viewer gone (closed, stopped, its page shut): no session left open on Studio', (await studio.api('/remote')).sessions)

  await part('peer-to-peer, where the browser can', async () => {
    const cap = await page(b, `${studio.url}/?remote=capture&fake=1`)
    const can = await cap.p.evaluate(() => typeof RTCPeerConnection === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function')
    if (!can) { skip('peer-to-peer between two pages', `${which} here has no WebRTC or canvas capture`); await cap.ctx.close(); return }
    await until(async () => (await studio.api('/remote')).screen.p2p, 8000)
    const { p } = await page(b, laptop.url)
    await ready(p)
    await viewOn(p)
    await enterPw(p)
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

  // A viewed computer can't put anything on the viewer's clipboard it didn't ask for; the capture page
  // told to stop a session while it was still starting doesn't take the screen for it after all.
  await part('nothing put on the clipboard unasked, nor a screen taken after a stop', async () => {
    const { p } = await page(b, laptop.url)
    await ready(p)
    let viewer = null
    await p.routeWebSocket(/\/api\/remote\/view/, (ws) => { viewer = ws; ws.connectToServer() })
    await viewOn(p)
    await enterPw(p)
    await picture(p)
    viewer.send(JSON.stringify({ t: 'clip', text: 'put there unasked' }))
    await sleep(800)
    const note = await p.locator('.rs-note').innerText().catch(() => '')
    ok(!/clipboard/i.test(note) && !note.includes('put there unasked'), 'a clipboard Studio sends unasked: not put on this device\'s', note)
    await p.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    await p.context().close()
    await until(async () => !(await studio.api('/remote')).sessions.length, 5000, 100)
    const cap = await page(b, `${studio.url}/?remote=capture&fake=1`)
    const said = []
    let to = null
    await cap.p.routeWebSocket(/\/api\/remote\/capture/, (ws) => { to = ws; const server = ws.connectToServer(); ws.onMessage((m) => { said.push(String(m)); server.send(m) }) })
    await cap.p.reload()
    await until(() => to && said.some((m) => /"t":"hello"/.test(m)), 8000, 50)
    to.send(JSON.stringify({ t: 'start', session: 'stopped-1', source: { kind: 'screen', id: 'fake-1', name: 'Test screen', w: 640, h: 400 }, p2p: null, rate: 1, max: 180000 }))
    to.send(JSON.stringify({ t: 'stop', session: 'stopped-1' }))
    await sleep(1500)
    ok(!said.some((m) => /"started"/.test(m) && /stopped-1/.test(m)) && !(await cap.p.locator('.rs-capture').getAttribute('data-sessions')), 'stopped while it started: the screen isn\'t taken for it', said.filter((m) => /stopped-1/.test(m)))
    await cap.ctx.close()
  })

  // ---------- a phone, end to end, as the apps run it ----------
  // The phone page (relay/web, which the iPhone and Android apps carry) paired with Studio, Bridge AI
  // in its frame, at 390 px with touch: in WebKit, the iPhone app's engine (WKWebView); in Chromium,
  // the Android app's WebView.
  const relayPhone = async (mode = 'light') => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2, colorScheme: mode })
    await ctx.addInitScript(({ mode }) => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode, theme: 'sky', text: 'm' })) } catch { /* no storage */ } }, { mode })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push(e.message))
    await p.goto((await studio.api('/relay/pair', {})).pairing.link, { waitUntil: 'commit' })
    await p.locator('#pair-go').click({ timeout: 20000 })
    const f = await until(() => p.frames().find((x) => x !== p.mainFrame() && x.url().startsWith(ra.url)), 30000, 100)
    // Paired once Studio has a password: it starts unticked there (from its first request, its page),
    // and gets nothing until it's ticked at Studio; then its page opens by itself. (The app's top bar
    // can show for a moment before the card does, so the list is looked at first.)
    const fresh = await until(async () => {
      const l = (await studio.api('/remote')).access.devices.filter((d) => d.fresh && !d.allowed)
      if (l.length) return l
      return (await f.locator('.settings-btn').isVisible().catch(() => false)) ? [] : null
    }, 30000, 200)
    for (const d of fresh || []) await studio.api('/remote/devices', { id: d.id, allowed: true })
    await f.locator('.settings-btn').waitFor({ timeout: 30000 })
    const at = await (await f.frameElement()).boundingBox()
    return { ctx, p, f, errs, at }
  }
  // Where on the phone's screen a point of the frame's page is.
  const onPhone = async (r, x, y) => { const at = await (await r.f.frameElement()).boundingBox(); return { x: at.x + x, y: at.y + y } }
  const pinch = (f) => f.evaluate(async () => {
    try { new Touch({ identifier: 0, target: document.body, clientX: 0, clientY: 0 }) } catch { return null }
    const el = document.querySelector('.rs-stage')
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + Math.min(r.height / 2, 120)
    const t = (id, x0) => new Touch({ identifier: id, target: el, clientX: x0, clientY: cy })
    const fire = (type, ts) => el.dispatchEvent(new TouchEvent(type, { touches: ts, targetTouches: ts, changedTouches: ts, bubbles: true, cancelable: true }))
    fire('touchstart', [t(1, cx - 30), t(2, cx + 30)])
    for (let i = 1; i <= 10; i++) { fire('touchmove', [t(1, cx - 30 - i * 9), t(2, cx + 30 + i * 9)]); await new Promise((ok) => requestAnimationFrame(ok)) }
    fire('touchend', [])
    await new Promise((ok) => setTimeout(ok, 150))
    return { mode: el.dataset.mode, canvas: document.querySelector('.rs-canvas').getBoundingClientRect().width, stage: el.clientWidth }
  })

  await part('a phone through its relay page, end to end: connect, the password, Which screen?, pinch, switch, control on and off, stop', async () => {
    const r = await relayPhone()
    const { p, f } = r
    // Settings › Computers on the phone: View screen for the computer it's paired with.
    await devices(f)
    const view = f.locator('.mch-row.here').getByRole('button', { name: 'View screen' })
    await view.waitFor({ timeout: 15000 })
    await view.click()
    await enterPw(f)
    await chooser(f).waitFor({ timeout: 15000 })
    const r0 = await until(async () => { const x = await rows(f); return x.length === 5 && x.every((y) => y.still) ? x : null }, 10000)
    ok(!!r0 && r0[0].name === 'Test screen' && r0[0].sub === '1280×800 · Main screen' && r0[0].on && r0.some((y) => y.name === 'Studio Display' && y.sub === '5120×2880'), `${which}, through the relay page: the password, then Which screen?, each by name and size with a still`, r0 || await rows(f))
    await shot(p, `${tag}remote-screen-relay-phone-which`)
    await pickScreen(f, 'Studio Display')
    ok(!!(await until(async () => { const x = await boxes(f); return fills(x, 5120, 2880) && Math.abs(x.canvas.w - x.stage.cw) <= 2 ? x : null }, 10000)) && !!(await picture(f)), 'Studio Display (twice its points) picked: its pictures fitted to the phone\'s width', await boxes(f))
    const st0 = await studio.api('/remote')
    ok(st0.sessions.length === 1 && st0.sessions[0].source.name === 'Studio Display' && st0.sessions[0].via === 'relay', 'one session at Studio, on that screen, through the relay', st0.sessions)
    const z = await pinch(f)
    if (!z) skip('a pinch to zoom through the relay page', `${which} here makes no touch events from a page`)
    else ok(z.mode === 'zoom' && z.canvas > z.stage * 2.2, 'pinched open', z)
    if (z) await f.locator('.rs-bar').getByRole('button', { name: 'Fit' }).click()
    await shot(p, `${tag}remote-screen-relay-phone`)
    // Another screen: one tap on the toolbar, the same Which screen?.
    await f.locator('.rs-bar .rs-source').click()
    await chooser(f).waitFor({ timeout: 5000 })
    ok((await rows(f)).find((y) => y.name === 'Studio Display')?.on, 'the toolbar opens the same Which screen?, the one showing ticked')
    await pickScreen(f, 'Portrait screen')
    let x = await until(async () => { const y = await boxes(f); return fills(y, 1080, 1920) ? y : null }, 10000)
    ok(!!x && x.canvas.h > x.canvas.w, 'Portrait screen: tall, fitted to the phone', x)
    ok((await studio.api('/remote')).sessions.length === 1, 'still the one session')
    // Control on at Studio, taken on the phone: a tap is a click; turned off again, nothing is.
    await studio.api('/remote/control', { on: true })
    const control = f.locator('.rs-bar').getByRole('button', { name: 'Control', exact: true })
    await control.waitFor({ timeout: 10000 })
    await control.click()
    await f.locator('.rs-bar').getByRole('button', { name: 'Controlling' }).waitFor({ timeout: 8000 })
    x = await boxes(f)
    let n = lines(inputs).length
    const mid = await onPhone(r, x.canvas.x + x.canvas.w / 2, x.canvas.y + x.canvas.h / 2)
    await p.touchscreen.tap(mid.x, mid.y)
    const tap = await until(() => { const l = lines(inputs).slice(n); return l.some((y) => y.t === 'up') ? l : null }, 5000, 50)
    ok(near(tap?.find((y) => y.t === 'down'), -540, 560), 'control on: a tap in the middle of the portrait screen is a click in its middle (left of and above the main one)', tap)
    await f.locator('.rs-bar').getByRole('button', { name: 'Controlling' }).click()
    await f.locator('.rs-bar').getByRole('button', { name: 'Control', exact: true }).waitFor({ timeout: 5000 })
    n = lines(inputs).length
    await p.touchscreen.tap(mid.x, mid.y)
    await sleep(700)
    ok(!lines(inputs).slice(n).some((y) => y.t === 'down'), 'control off again: a tap presses nothing')
    await f.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    ok(!!(await until(async () => !(await studio.api('/remote')).sessions.length, 6000, 100)), 'Stop viewing: the session ends at Studio')
    await studio.api('/remote/control', { on: false })
    ok(!r.errs.length, 'no page errors on the phone', r.errs.slice(0, 3))
    // Dark, the same question.
    const d = await relayPhone('dark')
    await devices(d.f)
    await d.f.locator('.mch-row.here').getByRole('button', { name: 'View screen' }).click()
    await enterPw(d.f)
    await chooser(d.f).waitFor({ timeout: 15000 })
    await until(async () => (await rows(d.f)).every((y) => y.still), 8000)
    await shot(d.p, `${tag}remote-screen-relay-phone-which-dark`)
    await d.f.locator('.rs-pick').getByRole('button', { name: 'Close' }).click()
    await d.f.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
    await d.ctx.close()
    await r.ctx.close()
  })

  await part('a phone through its relay page, peer-to-peer: the capture page\'s screens, picked and switched', async () => {
    // The screen is taken by the desktop app's capture page, which is Chromium (Electron) whatever the
    // phone is: in a WebKit run, a Chromium of its own, its addresses not hidden behind names.
    let cb = null
    let capCtx
    if (which === 'chromium') capCtx = (await page(b, `${studio.url}/?remote=capture&fake=1`)).ctx
    else {
      const pw = await import('playwright-core')
      cb = await pw.chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] })
      capCtx = await cb.newContext()
      const cookie = await b.newContext()
      await capCtx.addCookies(await cookie.cookies())
      await cookie.close()
      await (await capCtx.newPage()).goto(`${studio.url}/?remote=capture&fake=1`)
    }
    try {
      ok(!!(await until(async () => (await studio.api('/remote?sources=1')).screen.sources?.some((y) => y.name === 'LG UltraFine'), 10000)), 'the capture page on Studio says its screens')
      const r = await relayPhone()
      const { p, f } = r
      await devices(f)
      await f.locator('.mch-row.here').getByRole('button', { name: 'View screen' }).click()
      await enterPw(f)
      await chooser(f).waitFor({ timeout: 15000 })
      const r0 = await until(async () => { const y = await rows(f); return y.length === 3 && y.every((z) => z.still) ? y : null }, 10000)
      ok(!!r0 && r0[0].name === 'Built-in Retina Display' && r0[0].sub === '3024×1964 · Main screen' && r0[1].name === 'LG UltraFine' && r0[1].sub === '2560×1440' && r0[2].sub === '1080×1920', 'Which screen?: the capture page\'s three, by their names and sizes, with a still of each from it', r0 || await rows(f))
      await shot(p, `${tag}remote-screen-relay-phone-which-p2p`)
      await pickScreen(f, 'LG UltraFine')
      const mode = await until(() => f.evaluate(() => { const v = document.querySelector('.rs-view video'); const i = document.querySelector('.rs-view img.rs-media'); return v && !v.hidden && v.videoWidth ? 'p2p' : i && !i.hidden && i.src.startsWith('blob:') ? 'relay' : null }), 25000)
      const v = () => f.evaluate(() => { const x = document.querySelector('.rs-view video'); return { w: x.videoWidth, h: x.videoHeight } })
      const img = () => f.evaluate(() => { const x = document.querySelector('.rs-view img.rs-media'); return { w: x.naturalWidth, h: x.naturalHeight } })
      if (mode === 'p2p') {
        ok(true, `${which}: Studio's capture page and the phone meet peer-to-peer`)
        ok(!!(await until(async () => { const s = await v(); return s.w > s.h * 1.5 ? s : null }, 8000)), 'LG UltraFine plays as video, in its shape', await v())
        await pickScreen(f, 'Portrait screen')
        ok(!!(await until(async () => { const s = await v(); return s.h > s.w ? s : null }, 10000)), 'Portrait screen picked: the video turns tall, over the same connection', await v())
      } else {
        skip('peer-to-peer from the phone page', `${which} here didn't connect peer-to-peer to Chromium's capture page`)
        ok(mode === 'relay', 'peer-to-peer failing, the capture page\'s pictures come through the relay instead', mode)
        await pickScreen(f, 'Portrait screen')
        ok(!!(await until(async () => { const s = await img(); return s.h > s.w ? s : null }, 15000)), 'Portrait screen picked: its pictures tall', await img())
      }
      ok((await studio.api('/remote')).sessions.length === 1, 'one session throughout')
      await shot(p, `${tag}remote-screen-relay-phone-p2p`)
      await f.locator('.rs-bar').getByRole('button', { name: 'Stop viewing' }).click()
      ok(!!(await until(async () => !(await studio.api('/remote')).sessions.length, 6000, 100)), 'Stop viewing: ended at Studio')
      ok((await studio.api('/remote')).log[0].via === mode, 'and its record says how it came', (await studio.api('/remote')).log[0].via)
      await r.ctx.close()
    } finally {
      await capCtx?.close().catch(() => {})
      await cb?.close().catch(() => {})
    }
  })

  await part('the agent\'s Preview tab on Laptop', async () => {
    const port = (await laptop.api('/machines')).machines.find((m) => m.id === S.id)?.port
    const { p, errors: e2 } = await page(b, `http://127.0.0.1:${port}/m/${S.id}/?window=${enc(pane)}`)
    errors.push(...e2)
    await p.getByRole('tab', { name: 'Preview' }).or(p.getByRole('button', { name: 'Preview' })).first().click()
    // Its server picked (on Windows, which can't tell which folder a server started in, every local one is listed).
    const chip = p.locator('.preview-chip', { hasText: `:${dport}` })
    await chip.waitFor({ timeout: 20000 })
    await chip.click()
    // Studio asks for its password first, in the tab.
    await enterPw(p)
    const frame = p.locator('iframe.preview-frame')
    await frame.waitFor({ timeout: 20000 })
    await until(async () => (await frame.getAttribute('src'))?.startsWith(addr?.url || 'http://127.0.0.1:'), 10000)
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
