// The encrypted link between your phone and your computer, shared by both ends: the phone loads it
// from your relay, and Bridge AI imports it on the computer. The relay only ever sees what this
// makes: a handshake with public keys, then sealed records it can't read.
//
// Keys (P-256, WebCrypto everywhere):
//   H  the computer's own key, made once, kept in ~/.bridge-ai/relay.json
//   D  the phone's own key, made when it pairs, kept on the phone (the private half can't be read out)
//   eP, eH  fresh keys for each connection, so a key stolen later doesn't open old traffic
// Session keys = HKDF(ECDH(eP,eH) | ECDH(D,eH) | ECDH(eP,H)): only the real computer (H) and a
// paired phone (D) can work them out. The first time a phone pairs, the one-time code from the
// computer proves each side to the other (an HMAC over the handshake), so the relay can't step in.
// Messages that wait in the relay while the computer is offline are sealed on their own: see notes.
const subtle = globalThis.crypto.subtle
const ALG = { name: 'ECDH', namedCurve: 'P-256' }
const enc = new TextEncoder()
const dec = new TextDecoder()

export const b64u = (buf) => {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
const bytes = (p) => (p instanceof Uint8Array ? p : ArrayBuffer.isView(p) ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength) : p instanceof ArrayBuffer ? new Uint8Array(p) : Uint8Array.from(p))
const cat = (...parts) => {
  const bs = parts.map(bytes)
  const out = new Uint8Array(bs.reduce((n, b) => n + b.byteLength, 0))
  let o = 0
  for (const b of bs) { out.set(b, o); o += b.byteLength }
  return out
}
const same = (a, b) => {
  if (a.byteLength !== b.byteLength) return false
  let d = 0
  for (let i = 0; i < a.byteLength; i++) d |= a[i] ^ b[i]
  return d === 0
}

export const newKey = (extractable = false) => subtle.generateKey(ALG, extractable, ['deriveBits'])
export const rawPublic = async (pair) => new Uint8Array(await subtle.exportKey('raw', pair.publicKey))
export const importPublic = (raw) => subtle.importKey('raw', raw, ALG, true, [])
const dh = async (priv, pubRaw) => new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await importPublic(pubRaw) }, priv, 256))
const sha256 = async (data) => new Uint8Array(await subtle.digest('SHA-256', data))
const hkdf = async (ikm, salt, info, usage) => {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits'])
  const params = { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }
  return usage === 'bits' ? new Uint8Array(await subtle.deriveBits(params, base, 256))
    : subtle.deriveKey(params, base, usage === 'hmac' ? { name: 'HMAC', hash: 'SHA-256', length: 256 } : { name: 'AES-GCM', length: 256 }, false, usage === 'hmac' ? ['sign', 'verify'] : ['encrypt', 'decrypt'])
}

// ---------- pairing codes ----------
// Shown on the computer as a QR code and as text: <id>-<secret>, 4 + 16 letters and digits.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789' // no 0/O, 1/I/L, U
export function newPairCode() {
  const r = globalThis.crypto.getRandomValues(new Uint8Array(20))
  const s = Array.from(r, (x) => ALPHABET[x % ALPHABET.length]).join('')
  return `${s.slice(0, 4)}-${s.slice(4)}`
}
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const splitCode = (code) => { const c = normCode(code); return { id: c.slice(0, 4), secret: c.slice(4) } }
export const formatCode = (code) => { const c = normCode(code); return [c.slice(0, 4), c.slice(4, 8), c.slice(8, 12), c.slice(12, 16), c.slice(16)].filter(Boolean).join('-') }
const pairKey = (secret) => hkdf(enc.encode(normCode(secret)), new Uint8Array(32), 'bridge pair v1', 'hmac')
const mac = async (key, label, data) => new Uint8Array(await subtle.sign('HMAC', key, cat(enc.encode(label), data)))
const macOk = async (key, label, data, tag) => same(await mac(key, label, data), tag)

// ---------- the handshake ----------
async function sessionKeys(ikm, th, mine) {
  const p2h = await hkdf(ikm, th, 'bridge link v1 phone to computer')
  const h2p = await hkdf(ikm, th, 'bridge link v1 computer to phone')
  return mine === 'phone' ? new Session(p2h, h2p) : new Session(h2p, p2h)
}

// Phone, step 1. `device` is its own key pair; `pair` ({ id, secret }) only the first time.
export async function phoneHello(device, pair, name) {
  const eph = await newKey(true)
  const e = await rawPublic(eph)
  const d = await rawPublic(device)
  const hello = { t: 'hello', v: 1, e: b64u(e), d: b64u(d), name: String(name || '').slice(0, 60) }
  if (pair) hello.pair = { id: pair.id, proof: b64u(await mac(await pairKey(pair.secret), 'phone', cat(e, d))) }
  return { hello, eph, e, d }
}

// Phone, step 2: check the computer's answer and make the session. `hostKey` is the computer's
// key from an earlier pairing (or null the first time, when the code vouches for it).
export async function phoneFinish(state, device, welcome, { hostKey, pair }) {
  if (welcome?.t !== 'welcome') throw new Error(welcome?.why || 'The computer refused this phone')
  const eH = unb64u(welcome.e)
  const H = unb64u(welcome.h)
  const th = await sha256(cat(state.e, state.d, eH, H))
  if (hostKey) {
    if (!same(unb64u(hostKey), H)) throw new Error('This isn\'t the computer this phone was paired with')
  } else {
    if (!pair || !welcome.proof || !(await macOk(await pairKey(pair.secret), 'computer', th, unb64u(welcome.proof)))) throw new Error('Couldn\'t confirm the computer. Pair again with a new code.')
  }
  const ikm = cat(await dh(state.eph.privateKey, eH), await dh(device.privateKey, eH), await dh(state.eph.privateKey, H))
  return { session: await sessionKeys(ikm, th, 'phone'), hostKey: welcome.h, deviceId: welcome.device }
}

// Computer: answer a hello. `host` is its key pair (private key CryptoKey + raw public bytes);
// `known(d)` finds a paired phone by its key; `pairing(id)` returns a live code ({ secret }) or null.
export async function computerWelcome(host, hello, { known, pairing }) {
  if (hello?.t !== 'hello' || hello.v !== 1) return { refuse: 'unsupported' }
  const e = unb64u(hello.e)
  const d = unb64u(hello.d)
  if (e.byteLength !== 65 || d.byteLength !== 65) return { refuse: 'bad-key' }
  let device = known(hello.d)
  let pk = null
  if (!device) {
    const p = hello.pair && pairing(hello.pair.id)
    if (!p) return { refuse: hello.pair ? 'code-expired' : 'not-paired' }
    pk = await pairKey(p.secret)
    if (!(await macOk(pk, 'phone', cat(e, d), unb64u(hello.pair.proof)))) return { refuse: 'wrong-code', pairId: hello.pair.id }
  }
  const eph = await newKey(true)
  const eH = await rawPublic(eph)
  const th = await sha256(cat(e, d, eH, host.public))
  const ikm = cat(await dh(eph.privateKey, e), await dh(eph.privateKey, d), await dh(host.privateKey, e))
  const welcome = { t: 'welcome', e: b64u(eH), h: b64u(host.public) }
  if (pk) welcome.proof = b64u(await mac(pk, 'computer', th))
  return { welcome, session: await sessionKeys(ikm, th, 'computer'), newDevice: !device && { key: hello.d, name: hello.name, pairId: hello.pair.id }, device }
}

// ---------- sealed records ----------
// AES-256-GCM, a key each way, the nonce a counter: the link is ordered, so a record replayed,
// dropped or reordered by the relay fails to open and ends the session.
export class Session {
  constructor(sendKey, recvKey) { this.sk = sendKey; this.rk = recvKey; this.sn = 0n; this.rn = 0n; this.q = Promise.resolve() }
  static nonce(n) { const iv = new Uint8Array(12); new DataView(iv.buffer).setBigUint64(4, n); return iv }
  // Sealing is async; chain it so records go out in the order they were sealed.
  seal(plain) {
    const n = this.sn++
    const p = this.q.then(async () => cat([1], await subtle.encrypt({ name: 'AES-GCM', iv: Session.nonce(n) }, this.sk, plain)))
    this.q = p.catch(() => {})
    return p
  }
  async open(record) {
    const r = new Uint8Array(record)
    if (r[0] !== 1) throw new Error('not a sealed record')
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: Session.nonce(this.rn++) }, this.rk, r.subarray(1)))
  }
}
// Handshake messages travel as [0][JSON]; sealed records as [1][ciphertext].
export const plainFrame = (obj) => cat([0], enc.encode(JSON.stringify(obj)))
export const readPlain = (buf) => { const b = new Uint8Array(buf); return b[0] === 0 ? JSON.parse(dec.decode(b.subarray(1))) : null }

// ---------- notes: messages that wait in the relay ----------
// A message you send while your computer is offline waits in your relay until it's back, even if
// the phone is closed by then; what became of it goes back the same way. The link above needs both
// ends online, so each note is sealed on its own, to the other end's long-term key:
//   phone to computer: HKDF(ECDH(n,H) | ECDH(D,H)), n a fresh key for each note
//   computer to phone: HKDF(ECDH(n,D) | ECDH(H,D))
// Only this phone (D) and the computer (H) can work out ECDH(D,H), so a note that opens was sealed
// by one of them: the relay can't read one or make one up, and the computer still checks that D is
// a phone it paired and hasn't removed. With n, a key leaked for one note opens no other. A note's
// id and time are sealed in too (AES-GCM's additional data), so the relay can't change them; it
// can only hold a note back, drop it or hand it over again, and the computer acts on each id once
// and refuses one older than the 7 days a note may wait (server/inbox.js).
export const NOTE_DAYS = 7
export const newNoteId = () => b64u(globalThis.crypto.getRandomValues(new Uint8Array(16)))
// The phone's box in the relay, where its notes and their answers wait: named by its key, but not the key.
export const boxId = async (d) => b64u((await sha256(cat(enc.encode('bridge box v1'), typeof d === 'string' ? unb64u(d) : d))).subarray(0, 16))
const noteAad = (n, dir) => enc.encode(JSON.stringify(['bridge note v1', dir, n.id, n.at, n.d || null, n.e]))
const noteKey = async (ikm, e, from, to, dir) => hkdf(ikm, await sha256(cat(e, from, to)), `bridge note v1 ${dir}`)

// `me` is this end's key ({ privateKey, public: raw bytes }), `to` the other end's public key (raw).
// dir: 'up' (phone to computer: the note says which phone, d) or 'down' (computer to phone).
export async function sealNote(me, to, plain, dir, { id, at } = {}) {
  const n = await newKey()
  const e = await rawPublic(n)
  const note = { v: 1, id: id || newNoteId(), at: at || Date.now(), e: b64u(e) }
  if (dir === 'up') note.d = b64u(me.public)
  const key = await noteKey(cat(await dh(n.privateKey, to), await dh(me.privateKey, to)), e, me.public, to, dir)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  note.c = b64u(cat(iv, await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: noteAad(note, dir) }, key, typeof plain === 'string' ? enc.encode(plain) : plain)))
  return note
}

// Throws if it doesn't open: not sealed by `from` for `me`, or changed on the way.
export async function openNote(me, from, note, dir) {
  if (note?.v !== 1 || typeof note.id !== 'string' || !Number.isFinite(note.at) || typeof note.e !== 'string' || typeof note.c !== 'string') throw new Error('not a note')
  const e = unb64u(note.e)
  const c = unb64u(note.c)
  if (e.byteLength !== 65 || c.byteLength < 29) throw new Error('not a note')
  const key = await noteKey(cat(await dh(me.privateKey, e), await dh(me.privateKey, from)), e, from, me.public, dir)
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: c.subarray(0, 12), additionalData: noteAad(note, dir) }, key, c.subarray(12)))
}

// ---------- what goes inside: requests, responses and sockets ----------
// [kind][stream id, 4 bytes][body]. JSON bodies for headers; raw bytes for content.
export const K = { REQ: 1, BODY: 2, END: 3, HEAD: 4, ERR: 5, CANCEL: 6, WS_OPEN: 7, WS_MSG: 8, WS_CLOSE: 9, WS_OPENED: 10, PING: 11, PONG: 12, MORE: 13 }
export const CHUNK = 192 * 1024
// An answer comes no faster than whoever asked takes it in (a video that's paused, a download to a
// slow disk), so a big one never piles up in memory on the way. A request says how much may be on
// its way at once (w: WINDOW); as the asker's reader takes it in, the asker gives that much back
// (MORE, with 4 bytes: how much). An end that doesn't know MORE leaves w out, or ignores it, and
// answers come as fast as they can, as before.
export const WINDOW = 512 * 1024
export const GRANT = 128 * 1024
export const more = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b }
export const moreOf = (body) => (body.byteLength >= 4 ? new DataView(body.buffer, body.byteOffset, 4).getUint32(0) : 0)
// The asker's side: counts what its reader took in and gives it back GRANT at a time.
export function granter(give) {
  let owed = 0
  return (n) => { owed += n; if (owed >= GRANT) { give(owed); owed = 0 } }
}
export function pack(kind, id, body) {
  const b = body == null ? new Uint8Array(0) : body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : enc.encode(JSON.stringify(body))
  const out = new Uint8Array(5 + b.byteLength)
  out[0] = kind
  new DataView(out.buffer).setUint32(1, id)
  out.set(b, 5)
  return out
}
export function unpack(buf) {
  const b = new Uint8Array(buf)
  return { kind: b[0], id: new DataView(b.buffer, b.byteOffset).getUint32(1), body: b.subarray(5) }
}
export const json = (body) => JSON.parse(dec.decode(body))
export const text = (body) => dec.decode(body)
export const utf8 = (s) => enc.encode(s)
