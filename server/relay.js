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
//
// Messages a phone sent while this computer was offline wait in the relay, sealed for this
// computer; it takes them as soon as it's connected again (inbox.js opens, checks and sends each).
//
// Or, with no Cloudflare account at all, Bridge AI's own relay (relay/HOSTED.md): the same relay,
// run by the project for many computers, each with an address of its own. It's offered only once
// hosted.js says where it is.
//
// Your other devices connect the same way a phone does (machines.js): with a one-time code from
// invite() (when one device links another, or introduces two), or by asking. An ask waits here
// until you allow it, on this computer or a paired phone, after checking both devices show the
// same six digits (checkCode). The asking device commits to a random number first and shows it only
// after this one has sent its own, so a relay in between can't try keys until the digits match.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile, execFileSync } from 'node:child_process'
import net from 'node:net'
import { randomBytes, webcrypto } from 'node:crypto'
import QRCode from 'qrcode'
import WebSocket from 'ws'
import { dataFile, ensureDir, ROOT, IS_MAC, IS_WIN, nodeShimDir } from './paths.js'
import { hostedBase } from './hosted.js'
import { loginPath, which } from './agents.js'
import { bundle } from '../relay/build.js'
import { computerWelcome, newPairCode, splitCode, formatCode, plainFrame, readPlain, b64u, boxId, K, pack, unpack, json, utf8, CHUNK } from '../relay/web/link.js'
import * as inbox from './inbox.js'

const FILE = dataFile('relay.json')
const WRANGLER = 'wrangler@4.149.0'
const CF = 'https://api.cloudflare.com/client/v4'
const OP = { DATA: 1, OPEN: 2, CLOSE: 3, OK: 4 }
const HELLO_SECONDS = 15
const PAIR_MINUTES = 15
const PAIR_USES = 3
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

let built = null
const relayCode = () => (built ||= bundle())
// Written whole or not at all (a crash mid-write left half a file, and with it a new key and
// relay); one that can't be read is kept beside it, not silently replaced.
const read = () => {
  let text
  try { text = fs.readFileSync(FILE, 'utf8') } catch { return {} }
  try { return JSON.parse(text) } catch {
    try { fs.renameSync(FILE, `${FILE}.unreadable-${Date.now()}`) } catch { /* leave it */ }
    console.error('relay: relay.json couldn\'t be read; kept aside, starting fresh')
    return {}
  }
}
const write = (d) => { ensureDir(path.dirname(FILE)); const tmp = `${FILE}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 }); fs.renameSync(tmp, FILE) }
let conf = read()
// Every change can change whether a phone can reach this computer, and so whether it stays awake.
const save = () => { write(conf); holdAwake() }

let base = 'http://127.0.0.1:7420' // this server, where phones' requests go
let link = null // the WebSocket to the relay
let online = false
let lastError = null
let lastNeeds = null // what the last sign-in needed first ('node'), for the app to offer it
let busy = null // what's being done right now ('signing in', 'deploying', …)
let loginUrl = null
let relayBuild = null
let pairing = null // { id, secret, code, expires, uses, tries }
let retry = null
let backoff = 2000
let limit = null // what Bridge AI's relay last said about its limits: { why, text, until }
let pinger = null
let hostKey = null // { privateKey, public }
let awakeProc = null // what keeps this computer awake, while it does (holdAwake)
let awakeBroken = false // it couldn't (no systemd-inhibit, say): not tried again until turned on again
let tailnet = false // Tailscale publishes this computer to your phone (phone.js)
const conns = new Map() // phone connection id -> Conn
let invites = [] // one-time codes for another of your devices: { id, secret, expires, uses, tries }
const asks = new Map() // device key -> another device asking to link: { id, key, name, os, relay, at, c, n, code }
const askTries = [] // when each ask (or a new commit for one) came, over the last hour
const denied = new Map() // device key -> until when its asks are turned away
let onAsk = () => {} // tells you a device is asking (index.js)
const ASK_MINUTES = 15

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
// What a phone with several computers calls this one: the name you gave it in Bridge AI (Settings ›
// Devices, from any of your devices), else the one you gave it on a Mac ("Sam's MacBook Pro"), or
// its host name.
let computer = null
let given = () => null
export const useName = (fn) => { given = fn }
function computerName() {
  const g = String(given() || '').trim()
  return g ? g.slice(0, 60) : systemName()
}
// The computer's own name, what an empty name in Bridge AI goes back to.
export function systemName() {
  if (computer) return computer
  if (process.env.BRIDGE_COMPUTER_NAME) return (computer = String(process.env.BRIDGE_COMPUTER_NAME).slice(0, 60))
  if (IS_MAC) try { computer = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim() } catch { /* use the host name */ }
  return (computer ||= os.hostname().replace(/\.local$/, '') || 'Computer')
}

export const thisName = () => computerName()
// This device's public key, for the security code your devices show for it.
export const publicKey = () => conf.key?.public || null

export function status() {
  const live = new Set([...conns.values()].filter((c) => c.session).map((c) => c.device?.id))
  return {
    configured: !!(conf.url && conf.token),
    computer: computerName(),
    url: conf.url || null,
    online,
    error: lastError,
    needs: lastError ? lastNeeds : null,
    busy,
    loginUrl: busy ? loginUrl : null,
    method: conf.hosted ? 'hosted' : conf.cf?.method || null,
    account: conf.hosted ? null : conf.cf?.accountName || null,
    hosted: !!conf.hosted, // on Bridge AI's relay
    hostedAvailable: !!hostedBase(), // Bridge AI's relay is offered at all
    limit: limit && limit.until > Date.now() ? limit : null,
    needsUpdate: !!(!conf.hosted && online && relayBuild && relayBuild !== relayCode().build),
    devices: (conf.devices || []).map(({ id, name, kind, relay, addedAt, lastSeen }) => ({ id, name, kind: kind || 'phone', relay: relay || null, addedAt, lastSeen, connected: live.has(id) })),
    asks: [...asks.values()].filter((a) => a.code && a.at > Date.now() - ASK_MINUTES * 60000).map(({ id, name, os, relay, at, code }) => ({ id, name, os, relay, at, code })),
    pairing: pairing && pairing.expires > Date.now() && pairing.uses < PAIR_USES ? { code: pairing.code, expires: pairing.expires, link: pairing.link, qr: pairing.qr } : null,
    awake: conf.awake !== false,
    awakeNow: !!awakeProc,
    canAwake: CAN_AWAKE,
  }
}

// ---------- the connection to the relay ----------
export function start(serverBase) {
  base = serverBase
  holdAwake()
  if (conf.url && conf.token) connect()
}

function connect() {
  clearTimeout(retry)
  if (!conf.url || !conf.token) return
  if (link && link.readyState <= 1) return
  // (Bridge AI's relay hears which version this is, for its counts: HOSTED.md.)
  const ws = new WebSocket(`${conf.url.replace(/^http/, 'ws').replace(/\/$/, '')}/_relay/host`, { headers: { Authorization: `Bearer ${conf.token}`, ...(conf.hosted ? { 'X-Bridge-Version': VERSION } : {}) }, handshakeTimeout: 15000 })
  link = ws
  let pongAt = Date.now()
  ws.on('open', () => {
    online = true
    lastError = null
    limit = null
    backoff = 2000
    clearInterval(pinger)
    pinger = setInterval(() => {
      if (Date.now() - pongAt > 75000) return ws.terminate() // the relay went quiet: start over
      try { ws.send('ping') } catch { /* closing */ }
    }, 25000)
    roster('take').catch(() => {})
    checkBuild().catch(() => {})
  })
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      pongAt = Date.now()
      const s = String(data)
      if (s[0] === '{') try { const m = JSON.parse(s); if (m.t === 'note' && m.note) onNote(m.box, m.note); else if (m.t === 'limit') onLimit(m) } catch { /* not ours */ }
      return
    }
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
    if (conf.hosted && (res.statusCode === 403 || res.statusCode === 404)) {
      // Removed there (forgotten, or unused for months): no use asking every minute.
      lastError = 'Bridge AI\'s relay doesn\'t know this computer any more (it removes computers it hasn\'t seen for 90 days). Set it up again here; phones then pair again.'
      limit = { why: 'gone', text: lastError, until: Date.now() + 3600000 }
    } else lastError = res.statusCode === 403 ? 'The relay didn\'t accept this computer. Deploy it again from here.' : `The relay answered ${res.statusCode}`
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
    // Bridge AI's relay said to wait (it's switched off, or doesn't know this computer): until then.
    const wait = conf.hosted && limit?.until > Date.now() && limit.why !== 'day' ? limit.until - Date.now() + Math.random() * 60000 : 0
    retry = setTimeout(connect, Math.max(backoff, wait))
    backoff = Math.min(backoff * 2, 60000)
  })
}

// Bridge AI's relay says this computer has used up today's allowance (phones are turned away until
// it resets), or that it's switched off. Shown in Settings.
function onLimit(m) {
  if (!conf.hosted) return
  limit = { why: String(m.why || ''), text: String(m.text || '').slice(0, 400), until: Math.min(Number(m.until) || 0, Date.now() + 26 * 3600000) }
}

function disconnect() {
  clearTimeout(retry)
  clearInterval(pinger)
  const ws = link
  link = null
  online = false
  try { ws?.close() } catch { /* closed */ }
  // Its phones' and devices' connections went with it (they showed as connected until a restart).
  for (const c of conns.values()) c.end()
  conns.clear()
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
const toRelayText = (obj) => { if (link?.readyState === 1) link.send(JSON.stringify(obj)) }
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
    if (this.told) this.proven()
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
    // The phone's code, or a one-time code for another of your devices.
    const code = (pid) => (pairing && pairing.id === pid && pairing.expires > Date.now() && pairing.uses < PAIR_USES && pairing.tries < 5 ? pairing : null)
      || invites.find((p) => p.id === pid && p.expires > Date.now() && p.uses < 1 && p.tries < 5) || null
    // With a code, it's checked as a new pairing even when its key is known here, so the answer
    // proves this computer by the code: what puts it right for a device that has an old key for
    // this one (after this one was set up again).
    const fresh = !!msg?.pair
    const r = await computerWelcome(await key(), msg, { known: (k) => (fresh ? null : (conf.devices || []).find((d) => d.key === k) || null), pairing: code })
    if (r.refuse) {
      if (r.refuse === 'wrong-code') { const p = [pairing, ...invites].find((x) => x?.id === r.pairId); if (p) p.tries++ }
      // Another of your devices asking to link, with no code: it waits for you (askFrom).
      const a = r.refuse === 'not-paired' && msg?.ask && msg.kind === 'computer' ? await askFrom(msg) : { why: r.refuse }
      toRelay(OP.DATA, this.id, plainFrame({ t: 'refuse', why: a.why, ...(a.why === 'asked' ? { h: b64u((await key()).public), n: a.n } : {}) }))
      setTimeout(() => this.close(), 500)
      return
    }
    let device = r.device
    if (r.newDevice) {
      const used = [pairing, ...invites].find((p) => p?.id === r.newDevice.pairId)
      if (used) used.uses++
      // Paired again: the same device, not a second copy of it.
      device = (conf.devices || []).find((d) => d.key === r.newDevice.key)
      if (!device) {
        device = { id: randomBytes(6).toString('base64url'), key: r.newDevice.key, name: r.newDevice.name || 'Phone', addedAt: new Date().toISOString() }
        conf.devices = [...(conf.devices || []), device]
        roster().catch(() => {})
        onPaired(device)
      }
    }
    device = (conf.devices || []).find((d) => d.id === device.id)
    device.lastSeen = new Date().toISOString()
    save()
    this.device = device
    // What it says about itself (its name, that it's a computer, where it's reached) is kept once its
    // first sealed message proves it holds its key: anyone who saw the key (its relay) could send this.
    this.told = { name: typeof msg.name === 'string' ? msg.name.trim().slice(0, 80) : null, kind: msg.kind, relay: msg.relay }
    toRelay(OP.DATA, this.id, plainFrame({ ...r.welcome, device: device.id }))
    this.session = r.session
    clearTimeout(this.timer)
    toRelay(OP.OK, this.id) // tells the relay this one is yours, so it's never the one dropped
  }

  // Its hello, now that it's proven. Another of your devices (machines.js), not a phone: where it's
  // reached, so unlinking it here can tell it, and its own name.
  proven() {
    const { name, kind, relay } = this.told
    this.told = null
    const device = (conf.devices || []).find((d) => d.id === this.device?.id)
    if (!device) return
    if (name) device.name = name
    if (kind === 'computer') {
      const was = device.relay
      device.kind = 'computer'
      device.relay = cleanRelay(relay) || device.relay || null
      if (was && device.relay && was !== device.relay) onMoved(was, device.relay)
    }
    save()
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
        // Its own x-bridge-relay goes, in any capitals: fetch would join it to the real one below.
        const headers = Object.fromEntries((h || []).filter(([k]) => !DROP.has(k.toLowerCase()) && !/^(sec-|x-bridge-relay$)/i.test(k)))
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
    const ws = new WebSocket(target.href.replace(/^http/, 'ws'), { headers: { 'x-bridge-relay': this.device.id } })
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

// ---------- your other devices ----------
// A relay address as machines.js compares them: https (or a test relay on this computer), no path.
export function cleanRelay(u) {
  try { const x = new URL(String(u || '')); return (x.protocol === 'https:' || (x.protocol === 'http:' && x.hostname === '127.0.0.1')) ? x.origin : null } catch { return null }
}
export const relayUrl = () => (conf.url ? conf.url.replace(/\/$/, '') : null)
export const hostPublic = async () => b64u((await key()).public)

// A one-time code for another of your devices: when one links to this one, it hands this one a
// code to link back; when one introduces another, it asks this one for a code to hand on.
export async function invite() {
  if (!conf.url) throw new Error('This device has no relay yet. Set it up in Settings › Devices.')
  await key()
  const c = newPairCode()
  const { id, secret } = splitCode(c)
  invites = [...invites.filter((p) => p.expires > Date.now() && p.uses < 1), { id, secret, expires: Date.now() + 10 * 60000, uses: 0, tries: 0 }].slice(-10)
  return { link: `${relayUrl()}/#pair=${formatCode(c)}`, name: computerName() }
}

// Six digits shown on both devices, from both keys and a random number from each: the same on each
// means no one in between (the relay) put a key of its own in. h: this device's key; d: the asking
// device's; n: this device's number; r: the asking device's, which it committed to (askCommit)
// before it saw n. So whoever is in between gets one guess at the digits per ask, not as many as
// it can try.
const sha = async (label, ...parts) => new Uint8Array(await webcrypto.subtle.digest('SHA-256', Buffer.concat([Buffer.from(label), ...parts.map((x) => Buffer.from(String(x), 'base64url'))])))
export async function checkCode(h, d, n, r) {
  const x = await sha('bridge check v2', h, d, n, r)
  const s = String(new DataView(x.buffer).getUint32(0) % 1000000).padStart(6, '0')
  return `${s.slice(0, 3)} ${s.slice(3)}`
}
export const askCommit = async (d, r) => b64u(await sha('bridge ask v2', d, r))

// An ask, from a hello with no code. First its commit (c): this device answers with its number, and
// the ask waits. Then the asking device's number (r), which has to match the commit: now there are
// six digits, and you're told it's asking. Kept 15 minutes; ten at most, and thirty asks or new
// commits an hour; one turned down is turned away for an hour. { why, n }
async function askFrom(msg) {
  const now = Date.now()
  for (const [k, a] of asks) if (a.at < now - ASK_MINUTES * 60000) asks.delete(k)
  while (askTries.length && askTries[0] < now - 3600000) askTries.shift()
  if ((denied.get(msg.d) || 0) > now) return { why: 'denied' }
  // Bridge AI 3.3 or earlier asks with no commit: it can still link with a code from here.
  if (typeof msg.c !== 'string' || !msg.c) return { why: `Update Bridge AI on this device to ask ${thisName()}, or link it with a code from ${thisName()}.` }
  let a = asks.get(msg.d)
  if (a?.c !== msg.c) {
    if (askTries.length >= 30 || (!a && asks.size >= 10)) return { why: 'busy' }
    askTries.push(now)
    const os = ['mac', 'windows', 'linux'].includes(msg.os) ? msg.os : null
    a = { id: a?.id || randomBytes(6).toString('base64url'), key: msg.d, name: String(msg.name || 'Another device').slice(0, 60), os, relay: cleanRelay(msg.relay), at: a?.at || now, c: msg.c, n: randomBytes(16).toString('base64url'), code: null }
    asks.set(msg.d, a)
  } else if (!a.code && typeof msg.r === 'string' && (await askCommit(msg.d, msg.r)) === a.c) {
    a.code = await checkCode(b64u((await key()).public), msg.d, a.n, msg.r)
    onAsk(a)
  }
  return { why: 'asked', n: a.n }
}
export const whenAsked = (fn) => { onAsk = fn }
// A device paired with a code (the QR, or a one-time code), so you hear of one you didn't pair.
let onPaired = () => {}
export const whenPaired = (fn) => { onPaired = fn }
// Another of your devices now has a different relay address (machines.js follows it).
let onMoved = () => {}
export const whenMoved = (fn) => { onMoved = fn }

// Allow (it's paired, as a device) or turn down an ask.
export function answerAsk(id, allow) {
  const a = [...asks.values()].find((x) => x.id === id)
  if (!a) throw new Error('That ask is gone (asks wait 15 minutes). Ask again from the other device.')
  asks.delete(a.key)
  if (!allow) { denied.set(a.key, Date.now() + 3600000); return status() }
  if (!(conf.devices || []).some((d) => d.key === a.key)) {
    conf.devices = [...(conf.devices || []), { id: randomBytes(6).toString('base64url'), key: a.key, name: a.name, kind: 'computer', relay: a.relay, addedAt: new Date().toISOString() }]
    save()
    roster().catch(() => {})
  }
  return status()
}

// Unlinked from a device: it can't connect here any more.
export function removeMachine(relayAt) {
  const r = cleanRelay(relayAt)
  const gone = (conf.devices || []).filter((d) => d.kind === 'computer' && r && d.relay === r)
  for (const d of gone) removeDevice(d.id)
  return gone.length
}
// Which of the paired devices are machines (requests through the relay say which device).
export const deviceOf = (id) => (id && (conf.devices || []).find((d) => d.id === id)) || null
export const isMachine = (deviceId) => !!deviceId && (conf.devices || []).some((d) => d.id === deviceId && d.kind === 'computer')

export function removeDevice(id) {
  conf.devices = (conf.devices || []).filter((d) => d.id !== id)
  save()
  roster().catch(() => {})
  // A moment later, so a phone removing itself still gets the answer.
  setTimeout(() => { for (const c of [...conns.values()]) if (c.device?.id === id) c.close() }, 500)
  return status()
}

// ---------- messages a phone left while this computer was offline ----------
// Taken from the relay when this computer connects (the relay also hears which phones are paired,
// so no one else can leave any), and as they come while it stays connected. One at a time, oldest
// first. Done with each, the relay deletes it and keeps the receipt for the phone.
const boxes = () => Promise.all((conf.devices || []).map((d) => boxId(d.key)))
async function roster(t = 'roster') { if (link?.readyState === 1) toRelayText({ t, boxes: await boxes() }) }
let notes = Promise.resolve()
function onNote(box, note) {
  notes = notes.then(async () => {
    const r = await inbox.receive(note, { host: await key(), devices: conf.devices, base })
    if (r.id) toRelayText({ t: 'ack', box, id: r.id, receipt: r.receipt || null })
  }).catch((e) => console.error('relay:', e.message))
}

// The same notes over a phone's own link: an older relay can't keep them, so the phone holds them
// until both are online; and a phone that hasn't had a receipt yet sends them again (each is still
// acted on once). The relay is told too, so it drops its copy.
export async function fromPhone(deviceId, body) {
  const device = deviceId && (conf.devices || []).find((d) => d.id === deviceId)
  if (!device) throw Object.assign(new Error('Only a paired phone sends these'), { status: 403 })
  const box = await boxId(device.key)
  const results = []
  for (const note of (Array.isArray(body?.notes) ? body.notes : []).slice(0, 50)) {
    const r = await inbox.receive(note, { host: await key(), devices: conf.devices, base, from: device.id })
    if (r.id && r.receipt) toRelayText({ t: 'ack', box, id: r.id, receipt: r.receipt })
    results.push({ id: r.id, ok: r.ok, ...(r.ok ? { held: r.held } : { why: r.why, text: r.text }) })
  }
  return { results }
}

// ---------- keeping the computer awake ----------
// While a paired phone or another of your computers can reach this one (through the relay or
// Tailscale), it doesn't go to sleep when you walk away, so your agents stay a tap away. The screen
// still turns off and locks. On unless you turn it off (conf.awake: false). Each way ends with this
// server, so a crash never leaves the computer kept awake. In Docker the host decides.
const CAN_AWAKE = !process.env.BRIDGE_DOCKER
const reachable = () => tailnet || (!!(conf.url && conf.token) && (conf.devices || []).length > 0)
// Windows: the system-required flag, which holds while the thread that set it runs: a hidden
// PowerShell that waits for this server to end. Encoded, so nothing in it needs quoting.
const winAwake = (pid) => Buffer.from([
  '$k = Add-Type -Name Power -Namespace BridgeAI -PassThru -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\'',
  '[void]$k::SetThreadExecutionState(2147483649)', // ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 30 }`,
].join('\n'), 'utf16le').toString('base64')
function holdAwake() {
  if (!(CAN_AWAKE && conf.awake !== false && reachable()) || awakeBroken) { awakeProc?.kill(); awakeProc = null; return }
  if (awakeProc) return
  const pid = String(process.pid)
  // macOS: -i, no idle sleep (on battery too); -s, no sleep at all while on power. Linux: systemd's
  // inhibitor, around a wait for this server to end.
  const p = IS_MAC ? spawn('caffeinate', ['-i', '-s', '-w', pid], { stdio: 'ignore' })
    : IS_WIN ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', winAwake(pid)], { stdio: 'ignore', windowsHide: true })
      : spawn('systemd-inhibit', ['--what=idle:sleep', '--who=Bridge AI', '--why=Keeping your agents reachable from your phone', 'tail', `--pid=${pid}`, '-f', '/dev/null'], { stdio: 'ignore' })
  const at = Date.now()
  awakeProc = p
  // Gone at once (no such program, or PowerShell not allowed to load the flag): don't try on every save.
  const gone = () => { if (awakeProc !== p) return; awakeProc = null; if (Date.now() - at < 5000) awakeBroken = true }
  p.on('error', gone)
  p.on('exit', gone)
}
process.on('exit', () => awakeProc?.kill())

export function setAwake(on) {
  conf.awake = !!on
  awakeBroken = false
  save()
  return status()
}

// Tailscale started or stopped publishing this computer to your phone (phone.js, via index.js).
export function setTailnet(on) {
  if (tailnet === !!on) return
  tailnet = !!on
  holdAwake()
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
// npx runs npm, which runs wrangler: three processes. Stopping only npx left wrangler's sign-in
// waiting on its port (8976) for good, and every later sign-in then failed. So each run is a
// process group (a tree on Windows), stopped whole, and the one signing in is written down, so a
// Bridge AI started later stops it too.
const LOGIN_PID = path.join(CF_HOME, 'login.pid')
// Never a blocking call here: the server goes on answering while these run.
const run = (bin, args) => new Promise((resolve) => execFile(bin, args, { timeout: 15000, windowsHide: true }, (err, out) => resolve(String(out || ''))))
async function stopTree(pid) {
  if (!pid) return
  if (IS_WIN) { await run('taskkill', ['/pid', String(pid), '/T', '/F']); return }
  try { process.kill(-pid, 'SIGTERM') } catch { /* gone */ }
}
// A process number written down by an earlier run can belong to something else by now. It's ours
// when its command line says wrangler. On Windows, where only PowerShell can read a command line
// and PowerShell can take 20 s or more just to start: when it's still node or cmd (tasklist) and
// was written down in the last day. Only asked while the sign-in's port is taken.
async function isOurs({ pid, at }) {
  if (!pid) return false
  if (!IS_WIN) return /wrangler/i.test(await run('ps', ['-o', 'command=', '-p', String(Number(pid))]))
  if (!at || Date.now() - at > 86400e3) return false
  return /^"(node|cmd)\.exe"/im.test((await run('tasklist', ['/FI', `PID eq ${Number(pid)}`, '/FO', 'CSV', '/NH'])).trim())
}
// What went wrong, in words: wrangler's "✘ [ERROR]" line, or npm's when it stopped before wrangler
// could start (it couldn't download or unpack it). Never where either wrote its log.
const LOG_LINE = /Logs were written to|A complete log of this run can be found|^npm (warn|notice)\b/i
function whatWentWrong(text, code) {
  const lines = String(text).replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !LOG_LINE.test(l))
  const e = lines.find((l) => /\[ERROR\]/.test(l))
  if (e) return e.replace(/^.*?\[ERROR\]\s*/, '')
  const npm = lines.filter((l) => /^npm (error|ERR!)/i.test(l)).map((l) => l.replace(/^npm (error|ERR!)\s*/i, ''))
  if (npm.length) return npmTrouble(npm)
  return lines.pop() || `wrangler stopped (${code})`
}
function npmTrouble(lines) {
  const all = lines.join('\n')
  const tool = 'Couldn\'t download Cloudflare\'s sign-in tool'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|proxy/i.test(all)) return `${tool}: npm can't reach its registry. Check your internet connection (and your proxy, if you use one, in ~/.npmrc), then try again.`
  const where = /(?:path|dest) (\S+)/.exec(all)?.[1]
  if (/EACCES|EPERM/.test(all)) return `${tool}: npm isn't allowed to write to ${where || 'a folder it needs'}. ${where && !IS_WIN ? `Make it yours (in Terminal: sudo chown -R "$USER" "${where}"), then try again.` : 'Check that your account can change it, then try again.'}`
  return `${tool}: ${lines.find((l) => !/^(code|syscall|path|dest|errno)\b/.test(l)) || 'npm stopped'}`
}
const NEEDS_NODE = 'Signing in with the browser needs Node.js, and this computer doesn\'t have it yet. Install it here, or use an API token instead.'
async function wrangler(args, { timeout = 60000, onOut, login = false } = {}) {
  // On a real Node.js, never on Bridge AI's stand-in (the app as Node, paths.js): on that, wrangler
  // takes its own file for an argument ("Unknown arguments: …/wrangler-dist/cli.js, login"). So no
  // stand-in, and npx's own folder first, so the node next to it is the one wrangler runs on.
  const dirs = (await loginPath()).split(path.delimiter).filter((d) => d && d !== nodeShimDir())
  const npx = await which('npx', dirs.join(path.delimiter))
  if (!npx) throw Object.assign(new Error(NEEDS_NODE), { code: 'needs:node' })
  const PATH = [path.dirname(npx), ...dirs.filter((d) => d !== path.dirname(npx))].join(path.delimiter)
  ensureDir(CF_HOME)
  // Its own home, so its sign-in is Bridge AI's, and its own npm cache: npm's shared one (~/.npm) can
  // hold files you can't change, left by an earlier `sudo npm`, and then npx stops before wrangler
  // starts. Your ~/.npmrc still counts (a proxy, your company's registry).
  const env = {
    ...process.env, PATH, HOME: CF_HOME, USERPROFILE: CF_HOME, XDG_CONFIG_HOME: path.join(CF_HOME, '.config'), WRANGLER_SEND_METRICS: 'false',
    npm_config_cache: path.join(CF_HOME, 'npm-cache'), npm_config_userconfig: path.join(os.homedir(), '.npmrc'), npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false',
  }
  if (IS_WIN) env.APPDATA = path.join(CF_HOME, 'AppData')
  return new Promise((resolve, reject) => {
    const p = spawn(IS_WIN ? 'npx.cmd' : 'npx', ['-y', WRANGLER, ...args], { env, cwd: CF_HOME, shell: IS_WIN, windowsHide: true, detached: !IS_WIN })
    if (login && p.pid) try { fs.writeFileSync(LOGIN_PID, JSON.stringify({ pid: p.pid, at: Date.now() })) } catch { /* only for a later start to tidy up */ }
    let out = ''
    let err = ''
    const end = () => { clearTimeout(t); if (login) fs.rmSync(LOGIN_PID, { force: true }) }
    const t = setTimeout(() => { stopTree(p.pid); reject(new Error(login ? 'The Cloudflare sign-in wasn\'t finished in the browser within 5 minutes. Try again, and finish it in the tab that opens.' : 'Cloudflare\'s tool took too long. Try again.')) }, timeout)
    p.stdout.on('data', (d) => { out += d; onOut?.(String(d)) })
    p.stderr.on('data', (d) => { err += d; onOut?.(String(d)) })
    p.on('error', (e) => { end(); reject(e.code === 'ENOENT' ? Object.assign(new Error(NEEDS_NODE), { code: 'needs:node' }) : e) })
    p.on('close', (code) => {
      end()
      if (code === 0) return resolve(out)
      stopTree(p.pid)
      const why = whatWentWrong(err || out, code)
      reject(new Error(/could not bind to localhost:\d+|port is already in use/i.test(why) ? 'Another Cloudflare sign-in is still waiting for its browser tab. Close it, or finish it, and try again.' : why))
    })
  })
}
// Is this port free on this computer, on both of its own addresses (wrangler waits on "localhost",
// which can be either)?
const bindable = (port, host) => new Promise((resolve) => {
  const s = net.createServer()
  s.once('error', (e) => resolve(e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT')) // no IPv6 here
  s.listen(port, host, () => s.close(() => resolve(true)))
})
const portFree = async (port) => (await bindable(port, '127.0.0.1')) && (await bindable(port, '::1'))
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, 'localhost', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })

async function wranglerToken({ login }) {
  const get = async () => { try { return JSON.parse(await wrangler(['auth', 'token', '--json'])).token || null } catch { return null } }
  let token = await get()
  if (!token && login) {
    busy = 'Waiting for you to sign in to Cloudflare in your browser…'
    // A sign-in of ours left waiting (by an earlier run of Bridge AI) goes first. Its port still
    // taken (your own wrangler, say): another free one.
    const old = await fs.promises.readFile(LOGIN_PID, 'utf8').then(JSON.parse, () => null).catch(() => null)
    if (old && !(await portFree(8976)) && await isOurs(old)) await stopTree(old.pid)
    await fs.promises.rm(LOGIN_PID, { force: true })
    let port = 8976
    for (let i = 0; i < 10 && !(await portFree(port)); i++) await new Promise((r) => setTimeout(r, 300))
    if (!(await portFree(port))) port = await freePort()
    await wrangler(['login', ...(port === 8976 ? [] : ['--callback-port', String(port)])], { login: true, timeout: 5 * 60000, onOut: (s) => { loginUrl = s.match(/https:\/\/dash\.cloudflare\.com\/oauth2\/auth\S+/)?.[0] || loginUrl } })
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
  const hostToken = (!conf.hosted && conf.token) || randomBytes(32).toString('base64url')

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
  if (conf.hosted) leave() // from Bridge AI's relay: phones pair again with this one
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

// ---------- Bridge AI's hosted relay ----------
// No account and no deploying: the relay gives this computer an address of its own and a token
// (once), and Bridge AI connects to it as to any relay. The project keeps it up to date.
async function useHosted() {
  const where = hostedBase()
  if (!where) throw new Error('Bridge AI\'s relay isn\'t available yet. Use your own Cloudflare account, or Tailscale.')
  if (conf.hosted && conf.url && limit?.why !== 'gone') return status() // (gone: it forgot this computer, so again)
  busy = 'Setting up Bridge AI\'s relay…'
  try {
    const res = await fetch(`${where}/_relay/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: VERSION }), signal: AbortSignal.timeout(20000) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || !d.id || !d.url || !d.token) throw new Error(d.error || `Bridge AI's relay answered ${res.status}. Try again in a minute.`)
    let ok = false
    try { const u = new URL(d.url); ok = u.protocol === new URL(where).protocol && u.host === `${d.id}.${new URL(where).host}` } catch { /* not a URL */ }
    if (!ok) throw new Error('Bridge AI\'s relay gave an address that isn\'t its own')
    // From another relay: its phones pair again with this one (each relay is its own address).
    leave()
    conf = { ...conf, url: d.url.replace(/\/$/, ''), token: d.token, hosted: { id: d.id, at: new Date().toISOString() } }
    save()
    connect()
  } catch (e) {
    lastError = e.name === 'TimeoutError' ? 'Bridge AI\'s relay didn\'t answer. Try again in a minute.' : /fetch failed|ENOTFOUND|ECONNREFUSED/.test(e.message) ? 'Can\'t reach Bridge AI\'s relay. Check the internet connection and try again.' : e.message
    throw new Error(lastError)
  } finally {
    busy = null
  }
  return status()
}

// Done with this relay, for another: disconnected, its phones forgotten (they pair again with the
// new one), and if it was Bridge AI's relay, this computer's address there is removed.
function leave() {
  const was = conf
  disconnect()
  for (const c of conns.values()) c.end()
  conns.clear()
  pairing = null
  limit = null
  relayBuild = null
  // (Which Worker was yours on Cloudflare stays, so going back to it updates that one.)
  conf = { key: was.key, awake: was.awake, ...(was.cf?.script ? { cf: { account: was.cf.account, accountName: was.cf.accountName, script: was.cf.script } } : {}) }
  save()
  if (was.hosted) unregister(was)
}

function unregister(was) {
  if (!was.url || !was.token) return
  fetch(`${was.url}/_relay/forget`, { method: 'POST', headers: { Authorization: `Bearer ${was.token}` }, signal: AbortSignal.timeout(10000) }).catch(() => { /* it goes by itself after 90 days unused */ })
}

// method: 'hosted' (Bridge AI's relay), 'browser' (sign in with wrangler) or 'token' (an API token
// you paste). When the sign-in has several Cloudflare accounts, the answer lists them; ask again
// with the one to use.
export async function deploy({ method, token, account }) {
  if (busy) throw new Error('Already working on it')
  if (method === 'hosted') { lastError = null; return useHosted() }
  lastError = null
  lastNeeds = null
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
    lastNeeds = e.code === 'needs:node' ? 'node' : null
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
  if (conf.hosted) return // Bridge AI's relay: the project keeps it up to date
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
  if (conf.hosted) throw new Error('Bridge AI\'s relay is kept up to date by the project. Nothing to do here.')
  if (!conf.url || !conf.cf?.script || !conf.cf?.method) throw new Error('Set up the relay from here first')
  // (A sign-in that fails or times out mustn't leave it busy: nothing could deploy until a restart.)
  try {
    const token = conf.cf?.method === 'token' ? conf.cf.apiToken : await wranglerToken({ login: true })
    busy = 'Updating your relay…'
    await deployWith(token)
  } finally { busy = null; loginUrl = null }
  return status()
}

// Stop using the relay on this computer. The Worker stays on your Cloudflare account (delete it
// there if you like); phones paired with it are forgotten. On Bridge AI's relay, this computer's
// address there is removed, with anything it kept.
export function forget() {
  if (conf.hosted) unregister(conf)
  limit = null
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
