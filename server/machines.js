// Your other devices (Macs, Windows and Linux computers running Bridge AI), each with its own
// relay. This one connects to each the way a phone does (relay/web/link.js): the same handshake and
// the same end-to-end encryption, through that device's relay, so the relay can't read it. Then:
//   /m/<id>/... on this server is that device's own Bridge AI (its page, its API, its terminals),
//     so the app here, a browser, or a phone paired with this device can switch to it;
//   its agents show in this device's sidebar (summary(), every 15 seconds).
//
// Linking: with a one-time code from the other device (its pairing link, as for a phone), or by
// asking, which waits until you allow it there after checking both show the same six digits
// (relay.js: this device commits to a random number, the other answers with its own, then this one
// shows its number). Once linked one way, this device hands the other a code of its own, so each reaches
// the other; and a device you link is introduced to the ones this device already has, so all of
// them reach each other.
//
// The other device sees this one as a paired device ("Studio Mac, machine" in its Settings) and
// treats its requests like a phone's: nothing that's only for someone at that computer.
//
// Kept in ~/.bridge-ai/machines.json (only you can read it): each device's relay, name, its key,
// and this device's key for it.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomBytes, webcrypto } from 'node:crypto'
import WebSocket, { WebSocketServer } from 'ws'
import { cacheFile, dataFile, ensureDir, ROOT, writeFileAtomic } from './paths.js'
import * as relay from './relay.js'
import { hostedBase } from './hosted.js'
import { phoneHello, phoneFinish, splitCode, normCode, plainFrame, readPlain, b64u, K, pack, unpack, json, utf8, CHUNK, WINDOW, more, granter } from '../relay/web/link.js'

const FILE = dataFile('machines.json')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
export const OS = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
const subtle = webcrypto.subtle
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }

const read = () => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { machines: Array.isArray(d.machines) ? d.machines : [] } } catch { return { machines: [] } } }
let conf = read()
const save = () => { ensureDir(path.dirname(FILE)); writeFileAtomic(FILE, JSON.stringify(conf, null, 2), { mode: 0o600 }) }
const links = new Map() // machine id -> Link
// How often a link checks it's still alive: the relay answers every ping, so one that's gone quiet
// this long is dead though it looks open (a Mac that slept, a network that changed).
const PING_MS = Number(process.env.BRIDGE_LINK_PING_MS) || 30000
const QUIET_MS = PING_MS * 2.5
const HELLO_MS = Math.min(15000, QUIET_MS)
const byId = (id) => conf.machines.find((m) => m.id === id) || null
const byRelay = (r) => conf.machines.find((m) => m.relay === r) || null

// This device's key for one of yours (made when they link, kept here).
async function deviceKey(m) {
  if (!m.device) {
    const kp = await subtle.generateKey(ECDH, true, ['deriveBits'])
    m.device = { jwk: await subtle.exportKey('jwk', kp.privateKey), pub: b64u(await subtle.exportKey('raw', kp.publicKey)) }
    save()
  }
  return {
    privateKey: await subtle.importKey('jwk', m.device.jwk, ECDH, false, ['deriveBits']),
    publicKey: await subtle.importKey('raw', Buffer.from(m.device.pub, 'base64url'), ECDH, true, []),
  }
}

// ---------- one device ----------
class Link {
  constructor(m) {
    this.m = m
    this.ws = null
    this.session = null
    this.waiting = null
    this.code = null // a one-time code, while linking with one
    this.streams = new Map()
    this.next = 1
    this.q = Promise.resolve()
    this.out = Promise.resolve()
    this.waiters = []
    this.backoff = 2000
    this.stopped = false
    this.hostOnline = false
    this.error = null
  }

  start() { this.stopped = false; this.connect() }
  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    clearInterval(this.pinger)
    const ws = this.ws
    this.ws = null
    try { ws?.close() } catch { /* closed */ }
    this.drop('Unlinked')
  }

  connect() {
    clearTimeout(this.timer)
    if (this.stopped || (this.ws && this.ws.readyState <= 1)) return
    const ws = new WebSocket(`${this.m.relay.replace(/^http/, 'ws')}/_relay/link`, { handshakeTimeout: 15000 })
    this.ws = ws
    this.heard = Date.now()
    ws.on('open', () => {
      clearInterval(this.pinger)
      this.heard = Date.now()
      // Gone quiet: start over, rather than wait on a dead connection until Bridge AI restarts.
      this.pinger = setInterval(() => {
        if (Date.now() - this.heard > QUIET_MS) { this.error = `Lost the connection to ${this.m.name}. Connecting again…`; return ws.terminate() }
        try { ws.send('ping') } catch { /* closing */ }
      }, PING_MS)
    })
    ws.on('message', (data, isBinary) => {
      this.heard = Date.now()
      this.q = this.q.then(() => (isBinary ? this.onData(data) : this.onText(String(data)))).catch((e) => { this.error = e.message; try { ws.close() } catch { /* closed */ } })
    })
    ws.on('error', (e) => { this.error = `Can't reach its relay: ${e.message}` })
    ws.on('close', () => {
      if (this.ws !== ws) return
      clearInterval(this.pinger)
      clearTimeout(this.helloTimer)
      this.ws = null
      this.hostOnline = false
      this.drop(`${this.m.name} is offline`)
      if (this.stopped) return
      // Asking: look again every few seconds, so it links as soon as you allow it.
      const wait = this.m.state === 'asking' ? 5000 : this.backoff
      this.backoff = Math.min(this.backoff * 2, 60000)
      this.timer = setTimeout(() => { this.timer = null; this.connect() }, wait)
    })
  }

  // The relay says whether that device is connected to it.
  async onText(s) {
    if (s[0] !== '{') return // its answer to a ping
    const st = JSON.parse(s)
    if (st.t) return // about notes or limits: for phones
    this.hostOnline = !!st.host
    if (st.seen) this.m.lastSeen = new Date(st.seen).toISOString()
    if (!st.host) { this.error = `${this.m.name} is offline`; this.drop(this.error); return }
    await this.hello()
  }

  async hello() {
    const device = await deviceKey(this.m)
    const pair = this.code ? splitCode(this.code) : null
    const state = await phoneHello(device, pair, `${relay.thisName()}`)
    // A device, not a phone: where it's reached (so the other can unlink it), and whether it's
    // asking: with its commit, and its number once the other has sent its own.
    let asking = {}
    if (this.m.state === 'asking') {
      if (!this.m.ask?.c) {
        const r = randomBytes(16).toString('base64url')
        this.m.ask = { at: this.m.ask?.at || Date.now(), changes: this.m.ask?.changes || 0, r, c: await relay.askCommit(this.m.device.pub, r) }
        save()
      }
      asking = { ask: 1, c: this.m.ask.c, ...(this.m.ask.n ? { r: this.m.ask.r } : {}) }
    }
    Object.assign(state.hello, { kind: 'computer', os: OS, version: VERSION, relay: relay.relayUrl(), ...asking })
    this.waiting = { state, pair, device }
    const ws = this.ws
    ws.send(plainFrame(state.hello))
    // No answer: that device's end is stuck. Start over rather than wait forever.
    clearTimeout(this.helloTimer)
    this.helloTimer = setTimeout(() => { if (this.waiting && this.ws === ws) { this.error = `${this.m.name} didn't answer`; ws.terminate() } }, HELLO_MS)
  }

  async onData(data) {
    const buf = new Uint8Array(data)
    if (this.waiting) {
      const msg = readPlain(buf)
      const { state, pair, device } = this.waiting
      this.waiting = null
      clearTimeout(this.helloTimer)
      if (msg?.t === 'refuse') return this.refused(msg)
      // Its key: proved by a code you just gave it (which also puts right a key that changed), else
      // from before, or from its answer to the ask (and the six digits you checked).
      const vouched = !!(pair && msg?.proof)
      let done
      try {
        done = await phoneFinish(state, device, msg, { hostKey: vouched ? null : this.m.hostKey || this.m.ask?.h || null, pair })
      } catch (e) {
        // A different key than the one it was linked with: reinstalled or reset there, or
        // something in between. Not tried again and again: you link again, checking six digits.
        if (this.m.state === 'linked' && this.m.hostKey && !vouched) {
          this.m.state = 'changed'
          save()
          this.error = `${this.m.name} doesn't have the key it was linked with (it was reinstalled or reset, or something is in between). Link again to check it's really ${this.m.name}.`
          for (const w of this.waiters.splice(0)) w.no(new Error(this.error))
          this.stop()
          return
        }
        throw e
      }
      const first = this.m.state !== 'linked'
      Object.assign(this.m, { hostKey: done.hostKey, deviceId: done.deviceId, state: 'linked', lastSeen: new Date().toISOString() })
      delete this.m.ask
      this.code = null
      save()
      this.session = done.session
      this.error = null
      this.backoff = 2000
      for (const w of this.waiters.splice(0)) w.ok()
      // Its agents, straight away: the sidebar and the top bar show them as soon as it's online.
      if (first) onLinked(this.m)
      else refresh(this.m).catch(() => {})
      return
    }
    if (!this.session) return
    const { kind, id, body } = unpack(await this.session.open(buf))
    if (kind === K.PING) return this.send(K.PONG, 0)
    const s = this.streams.get(id)
    if (!s) return
    if (kind === K.HEAD) s.onHead?.(json(body))
    else if (kind === K.BODY) s.onChunk?.(Buffer.from(body))
    else if (kind === K.END) { this.streams.delete(id); s.onEnd?.() }
    else if (kind === K.ERR) { this.streams.delete(id); s.onError?.(Buffer.from(body).toString('utf8')) }
    else if (kind === K.WS_OPENED) s.onOpen?.()
    else if (kind === K.WS_MSG) s.onMessage?.(body[0] === 1 ? Buffer.from(body.subarray(1)).toString('utf8') : Buffer.from(body.subarray(1)), body[0] !== 1)
    else if (kind === K.WS_CLOSE) { this.streams.delete(id); s.onClose?.(json(body)) }
  }

  async refused(msg) {
    // Bridge AI 3.3 or earlier there: it would show six digits a relay could match. A code from it
    // still links.
    const why = msg.why === 'asked' && !msg.n ? 'unsupported' : msg.why
    if (why === 'asked' && this.m.ask?.c) {
      // Waiting for you there. The six digits to check, from both keys and both numbers.
      const a = this.m.ask
      const h = String(msg.h || ''), n = String(msg.n)
      if (!a.n) {
        Object.assign(a, { h, n, code: await relay.checkCode(h, this.m.device.pub, n, a.r) })
        save()
      } else if (a.h !== h || a.n !== n) {
        // A different answer once this device's number was out (that device restarted, or
        // something in between is trying its luck): a new number and commit, a few times at most.
        if (++a.changes > 3) {
          this.m.state = 'expired'
          this.error = `The six digits from ${this.m.name} kept changing, so something between the two devices may not be right. Link with a code from ${this.m.name} instead.`
          save()
          for (const w of this.waiters.splice(0)) w.no(new Error(this.error))
          this.stop()
          return
        }
        this.m.ask = { at: a.at, changes: a.changes }
        save()
      }
      for (const w of this.waiters.splice(0)) w.asked?.()
      if (Date.now() - a.at > 15 * 60000) { this.m.state = 'expired'; save(); this.stop() }
      return
    }
    const text = {
      denied: `${this.m.name} turned this device down`,
      busy: `${this.m.name} has too many machines asking right now. Try again in a few minutes.`,
      'not-paired': this.m.state === 'linked' ? `${this.m.name} unlinked this device` : `${this.m.name} doesn't know this device`,
      'code-expired': 'That link has expired or was used up. Make a new one on the other device.',
      'wrong-code': 'That link isn\'t right. Copy it again on the other device.',
      unsupported: `Update Bridge AI on ${this.m.name}, then try again.`,
    }[why] || why
    this.error = text
    for (const w of this.waiters.splice(0)) w.no(new Error(text))
    if (why === 'busy') return
    // Already linked: a new code that didn't work, or a version that can't talk yet, doesn't end
    // the link. It carries on with the keys it has (it used to stop until Bridge AI restarted).
    if (this.m.state === 'linked' && (this.code || why === 'unsupported')) {
      this.code = null
      if (why === 'unsupported') this.backoff = 60000
      return
    }
    this.m.state = why === 'denied' ? 'denied' : why === 'not-paired' && this.m.state === 'linked' ? 'removed' : this.m.state
    save()
    this.stop()
  }

  drop(msg) {
    this.session = null
    this.waiting = null
    clearTimeout(this.helloTimer)
    for (const s of this.streams.values()) { s.onError?.(msg || 'Connection lost'); s.onClose?.({ c: 1006, r: 'connection lost' }) }
    this.streams.clear()
  }

  // Linked and connected, within ms.
  ready(ms = 15000) {
    if (this.session) return Promise.resolve()
    return new Promise((ok, no) => {
      const w = { ok: () => { clearTimeout(t); ok() }, no: (e) => { clearTimeout(t); no(e) } }
      const t = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); no(new Error(this.error || `${this.m.name} is offline`)) }, ms)
      this.waiters.push(w)
      this.connect()
    })
  }

  send(kind, id, body) {
    const session = this.session
    if (!session) return Promise.reject(new Error(`${this.m.name} is offline`))
    const p = this.out.then(async () => {
      const rec = await session.seal(pack(kind, id, body))
      while (this.ws && this.ws.bufferedAmount > 4 * 1024 * 1024) await new Promise((r) => setTimeout(r, 20))
      if (this.session === session) this.ws.send(rec)
    })
    this.out = p.catch(() => {})
    return p
  }

  // A file going to that device waits for the connection to be nearly clear before each piece, so
  // a chat or a terminal on it goes ahead rather than behind megabytes of the file.
  async clear() {
    const session = this.session
    while (this.session === session && this.ws && this.ws.bufferedAmount > 256 * 1024) await new Promise((r) => setTimeout(r, 10))
  }

  // A request to that device: handlers get { s, h }, then pieces, then the end (or an error).
  // w: how much of the answer may be on its way at once; more(n) once n of it has been taken in.
  request({ m, u, h, body, w }, handlers) {
    const id = this.next++
    this.streams.set(id, handlers)
    const started = this.send(K.REQ, id, { m, u, h, body: !!body, ...(w ? { w } : {}) })
    return {
      id,
      started,
      write: (chunk, { bulk = false } = {}) => (async () => { for (let o = 0; o < chunk.byteLength; o += CHUNK) { if (bulk) await this.clear(); await this.send(K.BODY, id, chunk.subarray(o, o + CHUNK)) } })(),
      end: () => this.send(K.END, id),
      cancel: () => { if (this.streams.delete(id)) this.send(K.CANCEL, id).catch(() => {}) },
      more: (n) => { if (this.streams.has(id)) this.send(K.MORE, id, more(n)).catch(() => {}) },
    }
  }

  // { status, json } of an API call on that device.
  async call(method, u, body, ms = 20000) {
    await this.ready(ms)
    return new Promise((resolve, reject) => {
      let head = null
      const parts = []
      const t = setTimeout(() => { r.cancel(); reject(new Error(`${this.m.name} didn't answer`)) }, ms)
      const b = body === undefined ? null : utf8(JSON.stringify(body))
      const r = this.request({ m: method, u, h: [['content-type', 'application/json'], ['x-bridge-machine', relay.thisName()]], body: !!b }, {
        onHead: (x) => { head = x },
        onChunk: (c) => parts.push(c),
        onEnd: () => {
          clearTimeout(t)
          let j = null
          try { j = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { /* not JSON */ }
          if (head?.s >= 400) reject(new Error(j?.error || `${this.m.name} answered ${head.s}`))
          else resolve(j)
        },
        onError: (msg) => { clearTimeout(t); reject(new Error(msg)) },
      })
      r.started.then(async () => { if (b) { await r.write(b); await r.end() } }).catch((e) => { clearTimeout(t); reject(e) })
    })
  }

  // A WebSocket on that device (a live terminal).
  socket(u, handlers) {
    const id = this.next++
    this.streams.set(id, handlers)
    this.send(K.WS_OPEN, id, { u }).catch((e) => { this.streams.delete(id); handlers.onClose?.({ c: 1011, r: e.message }) })
    return {
      send: (data, binary) => this.send(K.WS_MSG, id, Buffer.concat([Buffer.from([binary ? 0 : 1]), Buffer.isBuffer(data) ? data : Buffer.from(String(data))])).catch(() => {}),
      close: (c = 1000, r = '') => { if (this.streams.delete(id)) this.send(K.WS_CLOSE, id, { c, r }).catch(() => {}) },
    }
  }
}

const linkOf = (m) => {
  let l = links.get(m.id)
  if (!l) { l = new Link(m); links.set(m.id, l) }
  return l
}

// ---------- the list ----------
// What each device last said (its agents, what waits on you there), kept in the cache folder too,
// so one that's offline still shows it after this one restarts, with when it said it.
const SEEN = cacheFile('machines-seen.json')
const kept = new Map() // machine id -> its last summary
try { for (const [id, s] of Object.entries(JSON.parse(fs.readFileSync(SEEN, 'utf8')))) if (s && typeof s === 'object') kept.set(id, s) } catch { /* none yet */ }
let seenTimer = null
const keep = (id, s) => {
  kept.set(id, s)
  clearTimeout(seenTimer)
  seenTimer = setTimeout(() => {
    try { ensureDir(path.dirname(SEEN)); writeFileAtomic(SEEN, JSON.stringify(Object.fromEntries([...kept].filter(([k]) => byId(k))))) } catch { /* next time */ }
  }, 2000)
  seenTimer.unref?.()
}
export function list() {
  return conf.machines.map((m) => {
    const l = links.get(m.id)
    const s = kept.get(m.id)
    return {
      id: m.id, name: s?.name || m.name, relay: m.relay, os: s?.os || m.os || null, version: s?.version || m.version || null,
      state: m.state, online: !!l?.session, lastSeen: m.lastSeen || null, addedAt: m.addedAt,
      code: m.state === 'asking' ? m.ask?.code || null : null, error: m.state === 'linked' && l?.session ? null : l?.error || null,
      counts: s?.counts || {}, agents: s?.agents || [],
      // What waits on you there (null from a Bridge AI too old to say), and when it last said.
      needs: s?.needs || null, at: s?.at ? new Date(s.at).toISOString() : null,
      about: s?.about || null, systemName: s?.systemName || null, safety: safety(m.hostKey),
    }
  })
}
export const here = () => ({ name: relay.thisName(), systemName: relay.systemName(), os: OS, version: VERSION, relay: relay.relayUrl(), safety: safety(relay.publicKey()) })

// A device's security code: a short fingerprint of its key, the same on each of your devices that
// shows it, so you can check a device is the one it says.
const safety = (key) => (key ? createHash('sha256').update(Buffer.from(key, 'base64url')).digest('hex').slice(0, 12).toUpperCase().match(/.{4}/g).join(' ') : null)

// More about this device, for its details on each of yours: the system and its version, the chip,
// memory and how long it's been on.
let system = null
async function systemLabel() {
  if (system) return system
  try {
    if (process.platform === 'darwin') {
      const v = /<key>ProductVersion<\/key>\s*<string>([^<]+)</.exec(await fs.promises.readFile('/System/Library/CoreServices/SystemVersion.plist', 'utf8'))?.[1]
      system = v ? `macOS ${v}` : 'macOS'
    } else if (process.platform === 'linux') {
      system = /^PRETTY_NAME="?([^"\n]+)/m.exec(await fs.promises.readFile('/etc/os-release', 'utf8'))?.[1] || 'Linux'
    } else system = Number(os.release().split('.')[2]) >= 22000 ? 'Windows 11' : 'Windows 10'
  } catch { system = OS === 'mac' ? 'macOS' : OS === 'windows' ? 'Windows' : 'Linux' }
  return system
}
export async function about() {
  const cpus = os.cpus()
  return { system: await systemLabel(), arch: os.arch(), chip: cpus[0]?.model?.trim() || null, cores: cpus.length, memory: os.totalmem(), uptime: Math.round(os.uptime()), host: os.hostname().replace(/\.local$/, '') }
}

// A new name for one of your devices, given on that device itself so it's the same everywhere: in
// its own Bridge AI, on your other devices and on your phones. '' goes back to the computer's own.
export async function rename(id, name) {
  const m = byId(id)
  if (!m) throw Object.assign(new Error('No such device'), { status: 404 })
  const l = links.get(m.id)
  if (m.state !== 'linked' || !l?.session) throw new Error(`${m.name} is offline. Rename it once it's back, or in Bridge AI on ${m.name}.`)
  try {
    await l.call('POST', '/api/machines/name', { name: String(name ?? '').slice(0, 60) }, 12000)
  } catch (e) {
    if (/\b404\b|Cannot POST/.test(e.message)) throw new Error(`Update Bridge AI on ${m.name} to rename it from here.`)
    throw e
  }
  await refresh(m).catch(() => {})
  return list().find((x) => x.id === m.id)
}

// A pairing link (https://<relay>/#pair=XXXX-…), or its address and code typed in (with or without
// https://, the code with or without its dashes), or an address alone to ask.
export function parseLink(text) {
  const raw = String(text || '').trim()
  const [first, ...rest] = raw.split(/\s+/)
  let u
  try { u = new URL(/^[a-z]+:\/\//i.test(first) ? first : `https://${first}`) } catch { u = null }
  const r = u && /\./.test(u.hostname) ? relay.cleanRelay(u.origin) : null
  if (!r) throw new Error('Paste the link from Pair a device on the other device, or type its address and code.')
  const code = normCode(new URLSearchParams(u.hash.slice(1)).get('pair') || rest.join(''))
  if (code && code.length !== 20) throw new Error('That code isn\'t complete: it has 20 letters and numbers.')
  return { relay: r, code: code || null }
}

// Link with a one-time code. via: 'you' (pasted here), 'back' (the other linking back), 'intro'
// (introduced by a device both are linked to).
export async function add({ link, name, via = 'you' }) {
  const { relay: r, code } = parseLink(link)
  if (r === relay.relayUrl()) throw new Error('That\'s this device\'s own link')
  if (!code) return ask({ relay: r, name })
  let m = byRelay(r)
  if (m?.state === 'linked' && links.get(m.id)?.session) return { machine: list().find((x) => x.id === m.id), already: true }
  if (!m) { m = { id: randomBytes(5).toString('base64url'), relay: r, name: String(name || 'Another device').slice(0, 60), addedAt: new Date().toISOString(), state: 'pairing' }; conf.machines.push(m); save() }
  else if (m.state !== 'linked') { m.state = 'pairing'; delete m.hostKey; delete m.ask; save() }
  const l = linkOf(m)
  l.code = code
  l.via = via
  l.start()
  try { await l.ready(30000) } catch (e) {
    if (m.state !== 'linked') { l.stop(); links.delete(m.id); conf.machines = conf.machines.filter((x) => x !== m); save() }
    throw e
  }
  await refresh(m).catch(() => {}) // its name and agents, for the answer
  return { machine: list().find((x) => x.id === m.id) }
}

// Ask to link, with no code: it waits until you allow it on that device. Comes back with the six
// digits to check there.
export async function ask({ relay: at, name }) {
  const r = relay.cleanRelay(at)
  if (!r) throw new Error('That isn\'t a Bridge AI relay address')
  if (r === relay.relayUrl()) throw new Error('That\'s this device')
  let m = byRelay(r)
  if (m?.state === 'linked') return { machine: list().find((x) => x.id === m.id), already: true }
  if (!m) { m = { id: randomBytes(5).toString('base64url'), relay: r, name: String(name || 'Another device').slice(0, 60), addedAt: new Date().toISOString() }; conf.machines.push(m) }
  m.state = 'asking'
  // Asking again (it unlinked this one, or its key changed): its key is the one you check now.
  delete m.ask
  delete m.hostKey
  save()
  const l = linkOf(m)
  l.via = 'ask'
  l.stop()
  l.start()
  await new Promise((ok) => {
    const t = setTimeout(ok, 15000)
    l.waiters.push({ ok: () => { clearTimeout(t); ok() }, no: () => { clearTimeout(t); ok() }, asked: () => { clearTimeout(t); ok() } })
  })
  return { machine: list().find((x) => x.id === m.id) }
}

// Fix: each step between here and that device, said plainly, starting it over on a fresh
// connection on the way (which puts most things right). { steps: [{ step, ok, text }], online }
export async function check(id) {
  const m = byId(id)
  if (!m) throw new Error('No such device')
  const steps = []
  const say = (step, ok, text) => steps.push({ step, ok, text })
  const end = () => ({ steps, online: !!links.get(m.id)?.session, machine: list().find((x) => x.id === m.id) || null })
  const name = m.name
  const host = (() => { try { return new URL(m.relay).host } catch { return m.relay } })()
  if (relay.relayUrl()) {
    const st = relay.status()
    say('here', st.online, st.online ? 'This device is connected to its relay.' : `This device isn't connected to its relay (${st.error || 'connecting'}), so ${name} can't reach it. It keeps trying by itself.`)
  }
  const reach = await fetch(`${m.relay}/_relay/health`, { signal: AbortSignal.timeout(6000) })
    .then((r) => (r.ok ? null : `it answered ${r.status}`), (e) => e.cause?.code || e.message)
  say('relay', !reach, !reach ? `${name}'s relay (${host}) answers.` : `Can't reach ${name}'s relay (${host}): ${reach}. Check this device is online. If ${name} was set up again with a new relay, link again from there.`)
  if (reach) return end()
  if (m.state === 'removed') { say('link', false, `${name} unlinked this device, or forgot it. Link again: it asks there, and you allow it after checking both show the same six digits.`); return end() }
  if (m.state === 'changed') { say('link', false, `${name} doesn't have the key it was linked with. Link again to check it's really ${name}.`); return end() }
  if (m.state !== 'linked') { say('link', false, `Not linked yet (${m.state}).`); return end() }
  const l = linkOf(m)
  l.stop()
  l.backoff = 2000
  l.error = null
  l.start()
  try {
    await l.ready(20000)
    say('link', true, `Connected to ${name}, end-to-end encrypted.`)
  } catch (e) {
    const seen = m.lastSeen ? ` (last seen ${new Date(m.lastSeen).toLocaleString()})` : ''
    say('link', false, !l.hostOnline && !l.session && /offline/.test(e.message)
      ? `${name} isn't connected to its relay${seen}: it may be asleep or off, or Bridge AI isn't running there. It connects by itself as soon as it's back.`
      : e.message)
    return end()
  }
  try { await refresh(m); say('answer', true, `${name} answers.`) } catch (e) { say('answer', false, `Connected, but ${name} didn't answer: ${e.message}`) }
  return end()
}

// Unlink: forgotten here, and told there (if it's online) so it forgets this one too.
export async function remove(id) {
  const m = byId(id)
  if (!m) throw new Error('No such device')
  const l = links.get(id)
  if (l?.session && relay.relayUrl()) await l.call('POST', '/api/machines/unlinked', { relay: relay.relayUrl() }, 8000).catch(() => {})
  forget(m)
  return { machines: list() }
}
function forget(m) {
  links.get(m.id)?.stop()
  links.delete(m.id)
  kept.delete(m.id)
  relay.removeMachine(m.relay)
  conf.machines = conf.machines.filter((x) => x !== m)
  save()
}
// The other device unlinked this one.
export function unlinked(fromRelay) {
  const m = byRelay(relay.cleanRelay(fromRelay))
  if (m) forget(m)
  else relay.removeMachine(fromRelay)
  return { ok: true }
}

// It moved to another relay (set up again there): it says so whenever it connects to this one, so
// this device follows it instead of waiting at the old address for ever.
relay.whenMoved((from, to) => {
  const m = byRelay(from)
  if (!m || byRelay(to)) return
  m.relay = to
  save()
  const l = links.get(m.id)
  if (l) { l.stop(); l.backoff = 2000; if (m.state === 'linked' || m.state === 'asking') l.start() }
})

// Computers that reach this one (they're in its paired devices) that this one isn't linked to: one
// that was linked before it was reinstalled, say. You can link back, or remove it.
export function strays() {
  return (relay.status().devices || []).filter((d) => d.kind === 'computer' && d.relay && !conf.machines.some((m) => m.relay === d.relay))
    .map(({ id, name, relay: r, lastSeen, connected }) => ({ id, name, relay: r, lastSeen, connected }))
}

// ---------- once linked ----------
// The other device gets a code to link back (unless it's linking back), and meets the others
// linked here (unless it was introduced: the one that introduced it does that).
function onLinked(m) {
  const via = links.get(m.id)?.via || 'you'
  ;(async () => {
    if (via !== 'back') await linkBack(m).catch((e) => console.error(`machines: linking back from ${m.name}:`, e.message))
    if (via !== 'intro') await introduce(m).catch((e) => console.error(`machines: introducing ${m.name}:`, e.message))
    await refresh(m).catch(() => {})
  })()
}

async function linkBack(m) {
  const mine = relay.relayUrl()
  if (!mine) return // no relay here: that device can't reach this one, only the other way round
  const l = links.get(m.id)
  const theirs = await l.call('GET', '/api/machines')
  if ((theirs?.machines || []).some((x) => x.relay === mine && x.state === 'linked')) return
  const inv = await relay.invite()
  await l.call('POST', '/api/machines', { link: inv.link, name: inv.name, via: 'back' }, 45000)
}

// Each device linked here that the new one doesn't know yet: a code from it, handed to the new one.
async function introduce(n) {
  const ln = links.get(n.id)
  const known = new Set(((await ln.call('GET', '/api/machines'))?.machines || []).filter((x) => x.state === 'linked').map((x) => x.relay))
  for (const k of conf.machines) {
    if (k === n || k.state !== 'linked' || known.has(k.relay)) continue
    const lk = links.get(k.id)
    if (!lk?.session) continue
    try {
      const inv = await lk.call('POST', '/api/machines/invite', {})
      await ln.call('POST', '/api/machines', { link: inv.link, name: inv.name, via: 'intro' }, 45000)
    } catch (e) { console.error(`machines: introducing ${n.name} to ${k.name}:`, e.message) }
  }
}

// ---------- what's on each ----------
// Its agents, for the sidebar here. getSummary: this device's own (index.js).
let getSummary = async () => ({})
export const useSummary = (fn) => { getSummary = fn }
export const summary = async () => {
  const s = await getSummary()
  return { ...here(), ...s, about: { ...(await about()), runtime: s.runtime || null } }
}
const asking = new Map() // machine id -> its summary on the way, so a burst of asks makes one call
function refresh(m) {
  if (!asking.has(m.id)) asking.set(m.id, refreshNow(m).finally(() => asking.delete(m.id)))
  return asking.get(m.id)
}
async function refreshNow(m) {
  const l = links.get(m.id)
  if (!l?.session) return
  const s = await l.call('GET', '/api/machines/summary', undefined, 12000)
  keep(m.id, { name: s.name, os: s.os, version: s.version, counts: s.counts || {}, agents: Array.isArray(s.agents) ? s.agents.slice(0, 40) : [], needs: Array.isArray(s.needs) ? s.needs.slice(0, 60) : null, about: s.about || null, systemName: s.systemName || null, at: Date.now() })
  if (s.name && s.name !== m.name) { m.name = String(s.name).slice(0, 60); save() }
  if (s.os !== m.os || s.version !== m.version) { m.os = s.os; m.version = s.version; save() }
}
setInterval(() => { for (const m of conf.machines) if (m.state === 'linked') refresh(m).catch(() => {}) }, 15000).unref()
// Fresher news while you're looking (the needs-you inbox): each device online whose last word is
// older than maxAge (or only the one named, after you answered something there) is asked again,
// waiting at most `wait` for the answers so a slow device doesn't hold up the rest.
export async function fresh({ only = null, maxAge = 6000, wait = 1500 } = {}) {
  const due = conf.machines.filter((m) => m.state === 'linked' && links.get(m.id)?.session && (!only || m.id === only) && Date.now() - (kept.get(m.id)?.at || 0) > maxAge)
  if (!due.length) return
  let t
  await Promise.race([Promise.allSettled(due.map((m) => refresh(m))), new Promise((r) => { t = setTimeout(r, wait) })])
  clearTimeout(t)
}

// ---------- a file to or from that device (transfers.js) ----------
// A request to that device whose answer is read as it comes: next() is its next piece (null at its
// end), and no more than `window` of it is on its way at once, as for a video (took(n) once n of it
// has been written where it goes). body: what goes with it, sent as the connection clears.
export async function exchange(id, { method = 'GET', u, headers = [], body = null, window = WINDOW, ms = 20000 }) {
  const m = byId(id)
  if (!m || m.state !== 'linked') throw Object.assign(new Error('That device isn\'t linked to this one any more'), { status: 404 })
  const l = linkOf(m)
  await l.ready(ms)
  return new Promise((resolve, reject) => {
    const parts = []
    let ended = false
    let failed = null
    let wake = null
    const nudge = () => { const w = wake; wake = null; w?.() }
    const grant = granter((n) => r.more(n))
    const t = setTimeout(() => { r.cancel(); reject(new Error(`${m.name} didn't answer`)) }, ms)
    const next = async () => {
      while (!parts.length && !ended && !failed) await new Promise((ok) => { wake = ok })
      if (parts.length) return parts.shift()
      if (failed) throw failed
      return null
    }
    const r = l.request({ m: method, u, h: [...headers, ['x-bridge-machine', relay.thisName()]], body: !!body, w: window }, {
      onHead: ({ s, h: hs }) => {
        clearTimeout(t)
        const header = (k) => (hs || []).find(([x]) => x.toLowerCase() === k)?.[1] ?? null
        const json = async () => { const all = []; for (let c = await next(); c; c = await next()) { all.push(c); grant(c.byteLength) } try { return JSON.parse(Buffer.concat(all).toString('utf8')) } catch { return {} } }
        resolve({ status: s, header, next, took: (n) => grant(n), cancel: () => r.cancel(), json })
      },
      onChunk: (c) => { parts.push(c); nudge() },
      onEnd: () => { ended = true; nudge() },
      onError: (msg) => { clearTimeout(t); failed = new Error(msg); reject(failed); nudge() },
    })
    r.started.then(async () => { if (body) { await r.write(body, { bulk: true }); await r.end() } }).catch((e) => { clearTimeout(t); failed = e; reject(e); nudge() })
  })
}
// Whether the link to that device goes through Bridge AI's hosted relay, which carries so much a
// day for each computer (relay/HOSTED.md): a big copy says so first.
export function viaHosted(id) {
  const base = hostedBase()
  const r = byId(id)?.relay
  if (!base || !r) return false
  try { const H = new URL(base).host; const h = new URL(r).host; return h === H || h.endsWith(`.${H}`) } catch { return false }
}

// ---------- start ----------
export function start() {
  for (const m of conf.machines) if (m.state === 'linked' || m.state === 'asking') linkOf(m).start()
}
// Every minute: a linked device with no connection and nothing on its way is started again.
setInterval(() => {
  for (const m of conf.machines) {
    if (m.state !== 'linked') continue
    const l = linkOf(m)
    if (l.stopped || (!l.ws && !l.timer)) { l.backoff = 2000; l.start() }
  }
}, 60000).unref()

// ---------- /m/<id>/...: that device's Bridge AI, through here ----------
const PASS = new Set(['content-type', 'accept', 'accept-language', 'range', 'if-range', 'if-none-match', 'if-modified-since', 'cache-control', 'last-event-id'])
// (Its length comes only when the answer comes as it is: a download's progress, a video's player.)
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'set-cookie'])
const MPATH = /^\/m\/([A-Za-z0-9_-]{1,20})(\/.*)?$/
const offlinePage = (name, why) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title>
<style>body{font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f4f5f7;color:#222}@media(prefers-color-scheme:dark){body{background:#111317;color:#e6e6e6}a{color:#8ab4ff}}div{max-width:420px;padding:24px;text-align:center}</style>
<div><h2>${name} isn't reachable</h2><p>${why}</p><p><a href="/">Back to this device</a></p></div>`
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export async function proxy(req, res) {
  const hit = MPATH.exec(req.originalUrl || req.url)
  const m = hit && byId(hit[1])
  const page = req.method === 'GET' && /text\/html/.test(req.headers.accept || '')
  if (!m || m.state !== 'linked') return page ? res.status(404).type('html').send(offlinePage('That device', 'It isn\'t linked to this one.')) : res.status(404).json({ error: 'No such device' })
  // Not on behalf of another device: one hop only.
  if (relay.isMachine(req.headers['x-bridge-relay'])) return res.status(403).json({ error: 'Not through another device' })
  const l = linkOf(m)
  try { await l.ready(page ? 20000 : 12000) } catch (e) {
    return page ? res.status(503).type('html').send(offlinePage(esc(m.name), esc(e.message))) : res.status(503).json({ error: e.message, offline: true })
  }
  const u = hit[2] || '/'
  const h = Object.entries(req.headers).filter(([k]) => PASS.has(k)).map(([k, v]) => [k, String(v)])
  h.push(['x-bridge-machine', relay.thisName()])
  const hasBody = !['GET', 'HEAD'].includes(req.method)
  let done = false
  // The answer comes as fast as the browser takes it (a video's player reads ahead only so far, then
  // waits): what's written here and not yet taken is given back only once it drains, so a big
  // file never piles up in this server's memory.
  const grant = granter((n) => r.more(n))
  let unread = 0
  const r = l.request({ m: req.method, u, h, body: hasBody, w: WINDOW }, {
    onHead: ({ s, h: hs }) => {
      res.status(s)
      for (const [k, v] of hs || []) {
        if (HOP.has(k.toLowerCase())) continue
        // Its own paths, as they are here.
        res.setHeader(k, k.toLowerCase() === 'location' && String(v).startsWith('/') ? `/m/${m.id}${v}` : v)
      }
    },
    onChunk: (c) => {
      if (res.write(c)) return grant(c.byteLength)
      if (!unread) res.once('drain', () => { const n = unread; unread = 0; grant(n) })
      unread += c.byteLength
    },
    onEnd: () => { done = true; res.end() },
    onError: (msg) => { done = true; if (!res.headersSent) res.status(502).json({ error: msg }); else res.destroy() },
  })
  res.on('close', () => { if (!done) r.cancel() })
  try {
    await r.started
    if (hasBody) {
      for await (const chunk of req) await r.write(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      await r.end()
    }
  } catch (e) { if (!done) { done = true; if (!res.headersSent) res.status(502).json({ error: e.message }); else res.destroy() } }
}

// A WebSocket to /m/<id>/... (a live terminal there).
const wss = new WebSocketServer({ noServer: true })
export function upgrade(req, socket, head) {
  const hit = MPATH.exec(req.url)
  const m = hit && byId(hit[1])
  const l = m && m.state === 'linked' && links.get(m.id)
  if (!l || relay.isMachine(req.headers['x-bridge-relay'])) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); return socket.destroy() }
  wss.handleUpgrade(req, socket, head, (client) => {
    let remote = null
    let open = false
    const pending = [] // what the page sent before the other end was open
    l.ready(12000).then(() => {
      remote = l.socket(hit[2] || '/', {
        onOpen: () => { open = true; for (const [d, b] of pending.splice(0)) remote.send(d, b) },
        onMessage: (data, binary) => { if (client.readyState === 1) client.send(data, { binary }) },
        onClose: (c) => { try { client.close(c?.c >= 1000 && c.c < 5000 && c.c !== 1005 && c.c !== 1006 ? c.c : 1011, String(c?.r || '').slice(0, 120)) } catch { /* closed */ } },
        onError: () => { try { client.close(1011) } catch { /* closed */ } },
      })
    }).catch((e) => { try { client.close(1011, String(e.message).slice(0, 120)) } catch { /* closed */ } })
    client.on('message', (data, binary) => { const d = Buffer.isBuffer(data) ? data : Buffer.from(data); if (open) remote.send(d, binary); else pending.push([d, binary]) })
    client.on('close', (c, r) => remote?.close(c, String(r || '')))
  })
}
export const isMachinePath = (u) => MPATH.test(String(u || ''))
