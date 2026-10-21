// Your phone, from anywhere, through your own relay: a small Cloudflare Worker on your own
// (free) Cloudflare account (relay/). Bridge AI deploys it for you, keeps one outgoing connection
// to it, and answers paired phones through it. No VPN, no open port, and nothing to remember to
// start: it connects whenever Bridge AI is running.
//
// Everything between phone and computer is end-to-end encrypted (relay/web/link.js), so neither
// the relay nor Cloudflare can read it. A phone's requests are run here against this server, as
// if made on this computer, so only phones you paired get in; remove one and it's out.
//
// Kept in ~/.bridge-ai/relay.json (only you can read it): the relay's address and the token that
// lets this computer (and only it) connect to it, this computer's key, the phones you paired, and
// how to reach Cloudflare to update the relay.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes, webcrypto } from 'node:crypto'
import QRCode from 'qrcode'
import WebSocket from 'ws'
import { dataFile, ensureDir, IS_MAC, IS_WIN } from './paths.js'
import { loginPath } from './agents.js'
import { bundle } from '../relay/build.js'
import { computerWelcome, newPairCode, splitCode, formatCode, plainFrame, readPlain, b64u, K, pack, unpack, json, utf8, CHUNK } from '../relay/web/link.js'

const FILE = dataFile('relay.json')
const WRANGLER = 'wrangler@4.149.0'
const CF = 'https://api.cloudflare.com/client/v4'
const OP = { DATA: 1, OPEN: 2, CLOSE: 3, OK: 4 }
const HELLO_SECONDS = 15
const PAIR_MINUTES = 15
const PAIR_USES = 3

let built = null
const relayCode = () => (built ||= bundle())
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} } }
const write = (d) => { ensureDir(path.dirname(FILE)); fs.writeFileSync(FILE, JSON.stringify(d, null, 2), { mode: 0o600 }) }
let conf = read()
const save = () => write(conf)

let base = 'http://127.0.0.1:7420' // this server, where phones' requests go
let link = null // the WebSocket to the relay
let online = false
let lastError = null
let busy = null // what's being done right now ('signing in', 'deploying', …)
let loginUrl = null
let relayBuild = null
let pairing = null // { id, secret, code, expires, uses, tries }
let retry = null
let backoff = 2000
let pinger = null
let hostKey = null // { privateKey, public }
const conns = new Map() // phone connection id -> Conn

// ---------- this computer's key ----------
async function key() {
  if (hostKey) return hostKey
  const subtle = webcrypto.subtle
  if (!conf.key) {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    conf.key = { private: await subtle.exportKey('jwk', kp.privateKey), public: b64u(await subtle.exportKey('raw', kp.publicKey)) }
    save()
  }
  hostKey = {
    privateKey: await subtle.importKey('jwk', conf.key.private, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    public: Uint8Array.from(Buffer.from(conf.key.public, 'base64url')),
  }
  return hostKey
}

// ---------- status ----------
// What a phone with several computers calls this one: the name you gave it on a Mac ("Sam's
// MacBook Pro"), or its host name.
let computer = null
function computerName() {
  if (computer) return computer
  if (IS_MAC) try { computer = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim() } catch { /* use the host name */ }
  return (computer ||= os.hostname().replace(/\.local$/, '') || 'Computer')
}

export function status() {
  const live = new Set([...conns.values()].filter((c) => c.session).map((c) => c.device?.id))
  return {
    configured: !!(conf.url && conf.token),
    computer: computerName(),
    url: conf.url || null,
    online,
    error: lastError,
    busy,
    loginUrl: busy ? loginUrl : null,
    method: conf.cf?.method || null,
    account: conf.cf?.accountName || null,
    needsUpdate: !!(online && relayBuild && relayBuild !== relayCode().build),
    devices: (conf.devices || []).map(({ id, name, addedAt, lastSeen }) => ({ id, name, addedAt, lastSeen, connected: live.has(id) })),
    pairing: pairing && pairing.expires > Date.now() && pairing.uses < PAIR_USES ? { code: pairing.code, expires: pairing.expires, link: pairing.link, qr: pairing.qr } : null,
    awake: !!conf.awake,
    canAwake: !IS_WIN,
  }
}

// ---------- the connection to the relay ----------
export function start(serverBase) {
  base = serverBase
  if (conf.awake) awake(true)
  if (conf.url && conf.token) connect()
}

function connect() {
  clearTimeout(retry)
  if (!conf.url || !conf.token) return
  if (link && link.readyState <= 1) return
  const ws = new WebSocket(`${conf.url.replace(/^http/, 'ws').replace(/\/$/, '')}/_relay/host`, { headers: { Authorization: `Bearer ${conf.token}` }, handshakeTimeout: 15000 })
  link = ws
  let pongAt = Date.now()
  ws.on('open', () => {
    online = true
    lastError = null
    backoff = 2000
    clearInterval(pinger)
    pinger = setInterval(() => {
      if (Date.now() - pongAt > 75000) return ws.terminate() // the relay went quiet: start over
      try { ws.send('ping') } catch { /* closing */ }
    }, 25000)
    checkBuild().catch(() => {})
  })
  ws.on('message', (data, isBinary) => {
    if (!isBinary) { pongAt = Date.now(); return }
    const b = new Uint8Array(data)
    const id = Buffer.from(b.buffer, b.byteOffset, b.byteLength).readUInt32BE(1)
    if (b[0] === OP.OPEN) conns.set(id, new Conn(id))
    else if (b[0] === OP.CLOSE) { conns.get(id)?.end(); conns.delete(id) }
    else if (b[0] === OP.DATA) {
      let c = conns.get(id)
      if (!c) conns.set(id, (c = new Conn(id)))
      c.receive(b.slice(5))
    }
  })
  ws.on('unexpected-response', (req, res) => {
    lastError = res.statusCode === 403 ? 'The relay didn\'t accept this computer. Deploy it again from here.' : `The relay answered ${res.statusCode}`
    res.resume()
  })
  ws.on('error', (e) => { if (!lastError || online) lastError = `Can't reach the relay: ${e.message}` })
  ws.on('close', () => {
    if (link !== ws) return
    online = false
    clearInterval(pinger)
    for (const c of conns.values()) c.end()
    conns.clear()
    link = null
    if (!conf.url || !conf.token) return
    retry = setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, 60000)
  })
}

function disconnect() {
  clearTimeout(retry)
  const ws = link
  link = null
  online = false
  try { ws?.close() } catch { /* closed */ }
}

const toRelay = (op, id, payload) => {
  if (!link || link.readyState !== 1) return false
  const p = payload ? Buffer.from(payload) : Buffer.alloc(0)
  const h = Buffer.alloc(5)
  h[0] = op
  h.writeUInt32BE(id, 1)
  link.send(Buffer.concat([h, p]))
  return true
}
// Big answers (a picture, a PDF) go out in pieces; wait while the connection is backed up.
const drained = async () => { while (link && link.bufferedAmount > 4 * 1024 * 1024) await new Promise((r) => setTimeout(r, 20)) }

// ---------- one phone ----------
const DROP = new Set(['host', 'connection', 'origin', 'referer', 'cookie', 'content-length', 'accept-encoding', 'upgrade', 'keep-alive', 'transfer-encoding'])
const DROP_BACK = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie'])

class Conn {
  constructor(id) {
    this.id = id
    this.session = null
    this.device = null
    this.q = Promise.resolve()
    this.out = Promise.resolve()
    this.streams = new Map() // id -> { abort, body: [], ws }
    // Anyone can open a connection to the relay; one that hasn't shown it's a paired phone in time
    // is closed, so strangers can't sit on the relay's connections.
    this.timer = setTimeout(() => { if (!this.session) this.close() }, HELLO_SECONDS * 1000)
  }

  receive(buf) { this.q = this.q.then(() => this.handle(buf)).catch((e) => { console.error('relay:', e.message); this.close() }) }

  close() { toRelay(OP.CLOSE, this.id); this.end(); conns.delete(this.id) }

  end() {
    clearTimeout(this.timer)
    for (const s of this.streams.values()) { s.abort?.abort(); try { s.ws?.close() } catch { /* closed */ } }
    this.streams.clear()
    this.session = null
  }

  // Records must leave in the order they were sealed (the counter in each nonce), so one at a time.
  send(kind, sid, body) {
    const session = this.session
    if (!session) return Promise.resolve()
    const p = this.out.then(async () => {
      const rec = await session.seal(pack(kind, sid, body))
      await drained()
      if (this.session === session) toRelay(OP.DATA, this.id, rec)
    })
    this.out = p.catch(() => {})
    return p
  }

  async handle(buf) {
    if (!this.session) return this.hello(buf)
    const { kind, id, body } = unpack(await this.session.open(buf))
    if (kind === K.REQ) return this.request(id, json(body))
    if (kind === K.BODY) { this.streams.get(id)?.body?.push(Buffer.from(body)); return }
    if (kind === K.END) { const s = this.streams.get(id); if (s?.run) s.run(); return }
    if (kind === K.CANCEL) { this.streams.get(id)?.abort?.abort(); this.streams.delete(id); return }
    if (kind === K.WS_OPEN) return this.socket(id, json(body))
    if (kind === K.WS_MSG) { const s = this.streams.get(id)?.ws; if (s?.readyState === 1) s.send(body[0] === 1 ? Buffer.from(body.subarray(1)).toString('utf8') : Buffer.from(body.subarray(1))); return }
    if (kind === K.WS_CLOSE) { const s = this.streams.get(id); this.streams.delete(id); try { s?.ws?.close() } catch { /* closed */ } }
  }

  async hello(buf) {
    let msg
    try { msg = readPlain(buf) } catch { msg = null }
    const r = await computerWelcome(await key(), msg, {
      known: (k) => (conf.devices || []).find((d) => d.key === k) || null,
      pairing: (pid) => (pairing && pairing.id === pid && pairing.expires > Date.now() && pairing.uses < PAIR_USES && pairing.tries < 5 ? pairing : null),
    })
    if (r.refuse) {
      if (r.refuse === 'wrong-code' && pairing?.id === r.pairId) pairing.tries++
      toRelay(OP.DATA, this.id, plainFrame({ t: 'refuse', why: r.refuse }))
      setTimeout(() => this.close(), 500)
      return
    }
    let device = r.device
    if (r.newDevice) {
      pairing.uses++
      device = { id: randomBytes(6).toString('base64url'), key: r.newDevice.key, name: r.newDevice.name || 'Phone', addedAt: new Date().toISOString() }
      conf.devices = [...(conf.devices || []), device]
    }
    device = (conf.devices || []).find((d) => d.id === device.id)
    device.lastSeen = new Date().toISOString()
    if (msg.name) device.name = msg.name
    save()
    this.device = device
    toRelay(OP.DATA, this.id, plainFrame({ ...r.welcome, device: device.id }))
    this.session = r.session
    clearTimeout(this.timer)
    toRelay(OP.OK, this.id) // tells the relay this one is yours, so it's never the one dropped
  }

  // A request from the phone, run against this server.
  request(sid, { m, u, h, body }) {
    const target = new URL(String(u || '/'), base)
    if (target.origin !== new URL(base).origin) return this.send(K.ERR, sid, utf8('Not allowed'))
    const abort = new AbortController()
    const s = { abort, body: body ? [] : null }
    this.streams.set(sid, s)
    s.run = async () => {
      try {
        const headers = Object.fromEntries((h || []).filter(([k]) => !DROP.has(k.toLowerCase()) && !k.toLowerCase().startsWith('sec-')))
        headers['x-bridge-relay'] = this.device.id
        const res = await fetch(target, { method: m || 'GET', headers, body: s.body ? Buffer.concat(s.body) : undefined, signal: abort.signal, redirect: 'manual' })
        await this.send(K.HEAD, sid, { s: res.status, h: [...res.headers].filter(([k]) => !DROP_BACK.has(k)) })
        if (res.body) {
          for await (const chunk of res.body) {
            if (abort.signal.aborted) break
            for (let o = 0; o < chunk.byteLength; o += CHUNK) await this.send(K.BODY, sid, chunk.subarray(o, o + CHUNK))
          }
        }
        if (!abort.signal.aborted) await this.send(K.END, sid)
      } catch (e) {
        if (!abort.signal.aborted) await this.send(K.ERR, sid, utf8(e.message))
      }
      this.streams.delete(sid)
    }
    if (!body) s.run()
  }

  // A WebSocket from the phone (the live terminal), opened here.
  socket(sid, { u }) {
    const target = new URL(String(u || '/'), base)
    if (target.origin !== new URL(base).origin) return this.send(K.WS_CLOSE, sid, { c: 1008, r: 'Not allowed' })
    const ws = new WebSocket(target.href.replace(/^http/, 'ws'))
    this.streams.set(sid, { ws })
    ws.on('open', () => this.send(K.WS_OPENED, sid))
    ws.on('message', (data, isBinary) => {
      const b = Buffer.isBuffer(data) ? data : Buffer.from(data)
      this.send(K.WS_MSG, sid, Buffer.concat([Buffer.from([isBinary ? 0 : 1]), b]))
    })
    ws.on('close', (c, r) => { if (this.streams.delete(sid)) this.send(K.WS_CLOSE, sid, { c, r: String(r || '') }) })
    ws.on('error', () => {})
  }
}

// ---------- pairing a phone ----------
export async function pair() {
  if (!conf.url) throw new Error('Set up the relay first')
  await key()
  const code = newPairCode()
  const { id, secret } = splitCode(code)
  const link = `${conf.url.replace(/\/$/, '')}/#pair=${formatCode(code)}`
  pairing = { id, secret, code: formatCode(code), link, expires: Date.now() + PAIR_MINUTES * 60000, uses: 0, tries: 0 }
  pairing.qr = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return status()
}

export function stopPairing() { pairing = null; return status() }

export function removeDevice(id) {
  conf.devices = (conf.devices || []).filter((d) => d.id !== id)
  save()
  // A moment later, so a phone removing itself still gets the answer.
  setTimeout(() => { for (const c of [...conns.values()]) if (c.device?.id === id) c.close() }, 500)
  return status()
}

// ---------- keeping the computer awake ----------
let awakeProc = null
function awake(on) {
  if (!on) { awakeProc?.kill(); awakeProc = null; return }
  if (awakeProc || IS_WIN) return
  // macOS: no sleeping while on power (the display can still turn off). Linux: systemd's inhibitor.
  awakeProc = IS_MAC
    ? spawn('caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' })
    : spawn('systemd-inhibit', ['--what=idle:sleep', '--who=Bridge AI', '--why=Keeping your agents reachable from your phone', 'sleep', 'infinity'], { stdio: 'ignore' })
  awakeProc.on('error', () => { awakeProc = null })
  awakeProc.on('exit', () => { awakeProc = null })
}
process.on('exit', () => awakeProc?.kill())

export function setAwake(on) {
  conf.awake = !!on
  save()
  awake(conf.awake)
  return status()
}

// ---------- deploying the relay to your Cloudflare account ----------
async function cf(token, method, p, body) {
  const form = body instanceof FormData
  const res = await fetch(`${CF}${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body && !form ? { 'Content-Type': 'application/json' } : {}) }, body: form ? body : body ? JSON.stringify(body) : undefined })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || d.success === false) {
    const e = new Error(d.errors?.[0]?.message || `Cloudflare answered ${res.status}`)
    e.code = d.errors?.[0]?.code
    e.status = res.status
    throw e
  }
  return d.result
}

// Run Cloudflare's own command line tool (wrangler), for signing in. Needs Node's npx.
// It keeps its sign-in in a folder of Bridge AI's own (~/.bridge-ai/cloudflare), apart from any
// wrangler you use yourself, so Bridge AI never deploys with an account you signed in to for
// something else.
const CF_HOME = dataFile('cloudflare')
async function wrangler(args, { timeout = 60000, onOut } = {}) {
  const PATH = await loginPath()
  ensureDir(CF_HOME)
  const env = { ...process.env, PATH, HOME: CF_HOME, USERPROFILE: CF_HOME, XDG_CONFIG_HOME: path.join(CF_HOME, '.config'), npm_config_cache: path.join(os.homedir(), '.npm'), WRANGLER_SEND_METRICS: 'false' }
  if (IS_WIN) env.APPDATA = path.join(CF_HOME, 'AppData')
  return new Promise((resolve, reject) => {
    const p = spawn(IS_WIN ? 'npx.cmd' : 'npx', ['-y', WRANGLER, ...args], { env, cwd: CF_HOME, shell: IS_WIN, windowsHide: true })
    let out = ''
    let err = ''
    const t = setTimeout(() => { p.kill(); reject(new Error('Cloudflare sign-in timed out')) }, timeout)
    p.stdout.on('data', (d) => { out += d; onOut?.(String(d)) })
    p.stderr.on('data', (d) => { err += d; onOut?.(String(d)) })
    p.on('error', (e) => { clearTimeout(t); reject(new Error(e.code === 'ENOENT' ? 'Signing in with the browser needs Node.js (npx). Use an API token instead.' : e.message)) })
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error((err || out).split('\n').map((l) => l.trim()).filter((l) => l && !/^npm warn/i.test(l)).pop() || `wrangler exited with ${code}`)) })
  })
}

async function wranglerToken({ login }) {
  const get = async () => { try { return JSON.parse(await wrangler(['auth', 'token', '--json'])).token || null } catch { return null } }
  let token = await get()
  if (!token && login) {
    busy = 'Waiting for you to sign in to Cloudflare in your browser…'
    await wrangler(['login'], { timeout: 5 * 60000, onOut: (s) => { loginUrl = s.match(/https:\/\/dash\.cloudflare\.com\/oauth2\/auth\S+/)?.[0] || loginUrl } })
    token = await get()
  }
  if (!token) throw new Error('Not signed in to Cloudflare')
  return token
}

async function deployWith(token, account) {
  busy = 'Finding your Cloudflare account…'
  const accounts = await cf(token, 'GET', '/accounts?per_page=50')
  if (!accounts?.length) throw new Error('This Cloudflare sign-in has no account to deploy to')
  const acct = accounts.find((a) => a.id === (account || conf.cf?.account)) || (accounts.length === 1 ? accounts[0] : null)
  // Several accounts: you pick (see deploy()).
  if (!acct) return { accounts: accounts.map((a) => ({ id: a.id, name: a.name })) }
  // A random name: the address is public, so it shouldn't say whose computer it is.
  const script = conf.cf?.script || `bridge-${randomBytes(5).toString('hex')}`
  const scripts = await cf(token, 'GET', `/accounts/${acct.id}/workers/scripts`).catch(() => [])
  const existing = (scripts || []).find((s) => s.id === script)
  const hostToken = conf.token || randomBytes(32).toString('base64url')

  // Its address: <script>.<your subdomain>.workers.dev. A new account has no subdomain yet, and
  // Cloudflare won't take a Worker until it has one, so pick one first.
  let sub = await cf(token, 'GET', `/accounts/${acct.id}/workers/subdomain`).then((r) => r?.subdomain).catch(() => null)
  if (!sub) {
    for (let i = 0; i < 4 && !sub; i++) {
      const want = `bridge-${randomBytes(4).toString('hex')}`
      sub = await cf(token, 'PUT', `/accounts/${acct.id}/workers/subdomain`, { subdomain: want }).then((r) => r?.subdomain || want).catch(() => null)
    }
    if (!sub) throw new Error('Couldn\'t set up a workers.dev address on your Cloudflare account. Open Workers & Pages in the Cloudflare dashboard once, then try again.')
  }

  busy = 'Deploying your relay…'
  const { code, build } = relayCode()
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: '2025-06-01',
    bindings: [
      { type: 'durable_object_namespace', name: 'HUB', class_name: 'Hub' },
      { type: 'secret_text', name: 'HOST_TOKEN', text: hostToken },
    ],
    ...(existing?.migration_tag === 'v1' ? {} : { migrations: { new_tag: 'v1', new_sqlite_classes: ['Hub'] } }),
  }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js')
  await cf(token, 'PUT', `/accounts/${acct.id}/workers/scripts/${script}`, form)
  await cf(token, 'POST', `/accounts/${acct.id}/workers/scripts/${script}/subdomain`, { enabled: true, previews_enabled: false })

  const url = `https://${script}.${sub}.workers.dev`
  const changed = conf.url !== url || conf.token !== hostToken
  conf = { ...conf, url, token: hostToken, cf: { ...conf.cf, account: acct.id, accountName: acct.name, script } }
  save()
  relayBuild = build

  // A brand-new address can take a minute to start answering.
  busy = 'Waiting for your relay to come online…'
  for (let i = 0; i < 45; i++) {
    const ok = await fetch(`${url}/_relay/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false)
    if (ok) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (changed) disconnect()
  connect()
  return {}
}

// method: 'browser' (sign in with wrangler) or 'token' (an API token you paste). When the sign-in
// has several Cloudflare accounts, the answer lists them; ask again with the one to use.
export async function deploy({ method, token, account }) {
  if (busy) throw new Error('Already working on it')
  lastError = null
  loginUrl = null
  try {
    busy = 'Signing in to Cloudflare…'
    let t = token
    if (method === 'token') {
      if (!t || t.length < 20) throw new Error('Paste a Cloudflare API token')
    } else {
      t = await wranglerToken({ login: true })
    }
    const r = await deployWith(t, account)
    if (r.accounts) return { ...status(), chooseAccount: r.accounts }
    conf.cf = { ...conf.cf, method: method === 'token' ? 'token' : 'browser', ...(method === 'token' ? { apiToken: t } : { apiToken: undefined }) }
    save()
  } catch (e) {
    lastError = e.code === 10000 || /permission|not authori[sz]ed|authentication/i.test(e.message) ? `Cloudflare said no: ${e.message}. The token needs the "Edit Cloudflare Workers" permissions.` : e.status ? `Cloudflare said no: ${e.message}` : e.message
    throw new Error(lastError)
  } finally {
    busy = null
    loginUrl = null
  }
  return status()
}

// After an update of Bridge AI, update the relay too (quietly, if Cloudflare still lets us in).
async function checkBuild() {
  const h = await fetch(`${conf.url}/_relay/health`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null)
  relayBuild = h?.build || null
  // Only a relay Bridge AI deployed itself, with the sign-in it was deployed with, is updated.
  if (!relayBuild || relayBuild === relayCode().build || busy || !conf.cf?.script || !conf.cf?.method) return
  const token = conf.cf?.method === 'token' ? conf.cf.apiToken : await wranglerToken({ login: false }).catch(() => null)
  if (!token) return
  busy = 'Updating your relay…'
  try { await deployWith(token) } catch (e) { lastError = `Couldn't update the relay: ${e.message}` } finally { busy = null }
}

export async function update() {
  if (!conf.url || !conf.cf?.script || !conf.cf?.method) throw new Error('Set up the relay from here first')
  const token = conf.cf?.method === 'token' ? conf.cf.apiToken : await wranglerToken({ login: true })
  busy = 'Updating your relay…'
  try { await deployWith(token) } finally { busy = null }
  return status()
}

// Stop using the relay on this computer. The Worker stays on your Cloudflare account (delete it
// there if you like); phones paired with it are forgotten.
export function forget() {
  disconnect()
  for (const c of conns.values()) c.end()
  conns.clear()
  pairing = null
  const { key: k, awake: a } = conf
  conf = { key: k, awake: a }
  save()
  fs.rmSync(CF_HOME, { recursive: true, force: true }) // and sign Bridge AI out of Cloudflare
  return status()
}
