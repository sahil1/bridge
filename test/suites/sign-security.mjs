// Studio's signing held to its owner: what a program that has only Bridge AI's key (the CLI, a
// script, an agent or a bot with a shell), a device that isn't yours (not kept yet, another
// computer) or a browser tab can't do, and Ask Before Signing that can't be gone round. No browser:
// the server's answers, a phone through the relay stand-in (test/lib/linkclient.mjs), and a stand-in
// for native/bridgesign (stand-ins/bridgesign.cjs; on a Mac, the real one is also built for release
// and asked for its key and Touch ID by this process, which it refuses).
//   The key alone: no signature's picture (nor with the windows' cookie, which the key makes), none
//   into a backup, no signing (Ask Before Signing off or on), no change to them, no trackpad (the
//   helper never started), no Sign on Phone, no Touch ID asked, no PIN planted.
//   Devices: one paired and not kept yet, and another computer, get none of it; only the pad that
//   asked follows its phone request and gets the ink (a second pad's request ends nobody else's),
//   asks are limited and so are their notifications.
//   The PIN: tries at once are tries one after another, from a phone and from this computer where
//   the PIN is the way (many at once: no grant); on a Mac set to ask for Touch ID, a helper that
//   doesn't answer is "try again", never the PIN.
//   At rest: a signature kept open before (with an index.json half written) sealed at start; a
//   signed copy never kept in the data folder; a sealed list changed on disk leaves signing closed
//   (Ask Before Signing still asked) until you confirm.
//   The app's window secret: taken again after a restart only when it's the same one (its sealed
//   hash), never another.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { startKit, startRelay, checks, until, sleep, rawFetch, ROOT, IS_WIN, IS_MAC } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'
import { K, json, text } from '../../relay/web/link.js'

const require = createRequire(path.join(ROOT, 'package.json'))
const { PDFDocument } = require('pdf-lib')
const { ok, skip, done } = checks('sign-security')

function png(w = 240, h = 80) {
  const crc = (buf) => zlib.crc32(buf) >>> 0
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(y - (x * h) / w) < 3) raw.writeUInt32BE(0x101820ff, y * (w * 4 + 1) + 1 + x * 4)
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const dataUrl = (b) => `data:image/png;base64,${b.toString('base64')}`
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const everything = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? everything(path.join(d, e.name)) : [path.join(d, e.name)]))

// A kit with the stand-in helper (told what to do in bridgesign.json), a window secret given at
// start (as the app gives it), and before: what's in its data folder as it starts.
async function signKit(name, { probe = null, before = null, relay = null } = {}) {
  const WINDOW = crypto.randomBytes(32).toString('base64url')
  let state = null, log = null, push = null, secretFile = null
  const kit = await startKit(name, {
    env: ({ bin, data }) => {
      if (relay) fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile))
      before?.(data)
      state = path.join(bin, 'bridgesign.json'); log = path.join(bin, 'bridgesign.log'); push = path.join(bin, 'push.jsonl'); secretFile = path.join(bin, 'window-secret')
      fs.writeFileSync(state, JSON.stringify({ auth: { ok: true, how: 'touchid' }, ...(probe ? { probe } : {}) }))
      fs.writeFileSync(secretFile, WINDOW)
      const env = { BRIDGE_COMPUTER_NAME: 'Studio Mac', BRIDGE_TEST_PUSH: push, BRIDGE_TEST_WINDOW_FILE: secretFile }
      if (!IS_WIN) {
        fs.writeFileSync(path.join(bin, 'bridgesign'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'test', 'stand-ins', 'bridgesign.cjs')}" "$@"\n`, { mode: 0o755 })
        Object.assign(env, { BRIDGE_SIGNHELPER: path.join(bin, 'bridgesign'), BRIDGESIGN_STATE: state, BRIDGESIGN_LOG: log })
      }
      return env
    },
  })
  // (Hundreds at once can find the computer's queue of new connections full: those come back with
  // no answer, error, and are tries that never reached a PIN.)
  const call = (headers) => async (method, p, body, extra = {}) => {
    let r
    try { r = await rawFetch(`${kit.url}/api${p}`, { method, headers: { 'content-type': 'application/json', ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined }) } catch (e) { return { status: 0, error: e.cause?.code || e.message, j: null, buf: Buffer.alloc(0) } }
    const buf = Buffer.from(await r.arrayBuffer())
    let j = null
    try { j = JSON.parse(buf.toString('utf8')) } catch { /* a picture */ }
    return { status: r.status, j, buf }
  }
  return {
    kit, WINDOW,
    // A program with the key alone (Bearer, nothing else), and the app's own window (its secret too).
    prog: call({ authorization: `Bearer ${kit.key}` }),
    win: call({ authorization: `Bearer ${kit.key}`, 'x-bridge-window': WINDOW }),
    helper: (o) => fs.writeFileSync(state, JSON.stringify({ auth: { ok: true, how: 'touchid' }, ...o })),
    started: () => { try { return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } },
    pushes: () => { try { return fs.readFileSync(push, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } },
    secretFile: () => secretFile,
  }
}
// A PDF in a place of its own: its root and a query for it.
async function aPdf(s, name = 'x.pdf') {
  const dir = path.join(s.kit.home, 'Deals')
  fs.mkdirSync(dir, { recursive: true })
  const d = await PDFDocument.create(); d.addPage([612, 792])
  fs.writeFileSync(path.join(dir, name), await d.save())
  const root = `place:${(await s.win('POST', '/places', { path: dir })).j.place.id}`
  return { dir, root, q: `root=${encodeURIComponent(root)}&path=${encodeURIComponent(name)}`, body: { root, path: name } }
}
// Many requests at once over one phone's link (the relay carries them side by side).
async function many(c, list) {
  let id = 200000
  const ids = []
  for (const { m, u, body } of list) {
    const i = id++
    ids.push(i)
    await c.send(K.REQ, i, { m, u, h: [['content-type', 'application/json']], body: !!body })
    if (body) { await c.send(K.BODY, i, new TextEncoder().encode(JSON.stringify(body))); await c.send(K.END, i) }
  }
  const res = new Map(), acc = new Map()
  while (res.size < ids.length) {
    const r = await c.next(120000)
    if (!ids.includes(r.id)) continue
    const a = acc.get(r.id) || { out: '' }
    if (r.kind === K.HEAD) a.head = json(r.body)
    else if (r.kind === K.BODY) a.out += text(r.body)
    else if (r.kind === K.ERR) res.set(r.id, { error: text(r.body) })
    else if (r.kind === K.END) { let j = null; try { j = JSON.parse(a.out) } catch { /* not JSON */ } res.set(r.id, { status: a.head?.s, json: j }) }
    acc.set(r.id, a)
  }
  return ids.map((i) => res.get(i))
}
const tally = (list) => list.reduce((o, x) => { const k = (x?.j || x?.json)?.grant ? 'GRANT' : (x?.j || x?.json)?.code || x?.error || x?.status; o[k] = (o[k] || 0) + 1; return o }, {})

const relay = await startRelay('sign-security')
const OLD = png(210, 70)
const A_ = await signKit('sign-security', {
  relay,
  // Before 3.22: a signature kept open, its index.json half written.
  before: (data) => {
    const sd = path.join(data, 'studio', 'signatures')
    fs.mkdirSync(sd, { recursive: true })
    fs.writeFileSync(path.join(sd, 'signature.png'), OLD, { mode: 0o600 })
    fs.writeFileSync(path.join(sd, 'index.json'), '{"signature": {"at": "2026-01-02')
  },
})
const { kit, prog, win } = A_
const links = []
let B_ = null
try {
  await prog('POST', '/setup', { name: 'Tester' })
  const sd = path.join(kit.data, 'studio', 'signatures')

  // ---------- At rest ----------
  const sealedAtStart = await until(() => !fs.existsSync(path.join(sd, 'signature.png')) && !fs.existsSync(path.join(sd, 'index.json')), 15000)
  const s0 = (await win('GET', '/studio/sign/setup')).j
  ok(!!sealedAtStart && s0.list?.length === 1 && s0.list[0].width === 210 && !everything(sd).some((f) => fs.readFileSync(f).includes(OLD.subarray(0, 64))), 'a signature kept open before, its index.json half written: sealed at start, the open one gone', { files: fs.readdirSync(sd), list: s0.list })
  const mine = png(300, 90)
  const add = await win('POST', '/studio/signatures', { kind: 'signature', name: 'Mine', png: dataUrl(mine), default: true })
  ok(add.status === 200, 'the app\'s window keeps a signature', add.status)
  const big = await win('POST', '/studio/signatures', { kind: 'signature', png: `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}` })
  ok(big.status === 413, 'a body bigger than any drawing is turned away before it\'s read', big.status)

  // ---------- A program with the key alone ----------
  const pdf = await aPdf(A_)
  const cookie = `bridge-ai-${kit.port}=${crypto.createHmac('sha256', kit.key).update('bridge-ai browser').digest('base64url')}`
  const img = await prog('GET', '/studio/signature/signature')
  const imgCookie = await prog('GET', '/studio/signature/signature', null, { cookie })
  const imgWin = await win('GET', '/studio/signature/signature')
  ok(img.status === 403 && imgCookie.status === 403 && !imgCookie.buf.equals(mine) && imgWin.status === 200 && imgWin.buf.equals(mine), 'the key alone, or with the windows\' cookie made from it: no picture; the app\'s window: the picture', { key: img.status, cookie: imgCookie.status, window: imgWin.status })
  const bk = await prog('POST', '/backup/file', { passphrase: 'a passphrase of its own', signatures: true })
  const bkWin = await win('POST', '/backup/file', { passphrase: 'a passphrase of its own', signatures: true })
  const ex = await win('POST', '/studio/sign/ask', { purpose: 'export' })
  const bkOk = await win('POST', '/backup/file', { passphrase: 'a passphrase of its own', signatures: true, grant: ex.j?.grant })
  ok(bk.status === 403 && bkWin.status === 403 && bkWin.j?.code === 'ask' && ex.j?.how === 'touchid' && bkOk.status === 200, 'your signatures into a backup: never for the key alone; from the app\'s window, only once Touch ID was asked', { key: bk.j, window: bkWin.j, ask: ex.j?.how, withGrant: bkOk.status })
  const before = fs.readdirSync(pdf.dir).length
  const signed = await prog('POST', `/studio/sign?${pdf.q}`, { marks: [{ kind: 'signature', page: 1, x: 10, y: 10, w: 300, h: 90 }] })
  ok(signed.status === 403 && signed.j?.code === 'not-yours' && fs.readdirSync(pdf.dir).length === before && !fs.existsSync(path.join(pdf.dir, '_signed')), 'the key alone can\'t sign, even with Ask Before Signing off: nothing made', signed.j)
  const changes = [await prog('PUT', '/studio/signature/signature', { png: dataUrl(png(120, 40)) }), await prog('POST', '/studio/signatures', { kind: 'signature', png: dataUrl(png(120, 40)) }), await prog('PATCH', `/studio/signatures/${add.j.id}`, { name: 'x' }), await prog('DELETE', `/studio/signatures/${add.j.id}`)]
  ok(changes.every((x) => x.status === 403) && (await win('GET', '/studio/sign/setup')).j.signature?.id === add.j.id, 'the key alone can\'t add, replace, rename or remove one', changes.map((x) => x.status))
  const startsBefore = A_.started().filter((x) => x.args[0] === 'trackpad').length
  const tp = await prog('GET', `/studio/sign/trackpad?hint=${encodeURIComponent('macOS needs your signature to continue')}`)
  ok(tp.status === 403 && A_.started().filter((x) => x.args[0] === 'trackpad').length === startsBefore, 'the key alone can\'t start the trackpad: the helper never runs', tp.j)
  const asks = [await prog('POST', '/studio/sign/phone', { what: 'signature' }), await prog('POST', `/studio/sign/ask?${pdf.q}`, {}), await prog('POST', '/studio/sign/ask', { purpose: 'export' }), await prog('POST', '/studio/sign/ask/setting', { on: true, pin: '7391' })]
  const authBefore = A_.started().filter((x) => x.args[0] === 'auth').length
  ok(asks.every((x) => x.status === 403 && x.j?.code === 'not-yours') && A_.started().filter((x) => x.args[0] === 'auth').length === authBefore && !(await win('GET', '/studio/sign/ask')).j.pin, 'the key alone can\'t ask your phone, ask for Touch ID, or plant a PIN', asks.map((x) => x.j?.code))

  // ---------- Devices ----------
  await until(async () => (await prog('GET', '/relay')).j?.online, 20000)
  const pairAs = async (name, { keep = true, hello = {} } = {}) => {
    const c = await linkAs(relay.url, { code: (await prog('POST', '/relay/pair', {})).j.pairing.code, name, about: { name, ...hello }, hello })
    links.push(c)
    if (keep) await until(() => prog('POST', `/relay/devices/${c.deviceId}/keep`, {}).then((r) => r.status < 300), 10000, 100)
    return c
  }
  const A = await pairAs('Phone A')
  const N = await pairAs('New Phone', { keep: false })
  const C = await pairAs('Other Mac', { hello: { kind: 'computer' } })
  await A.request('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }, label: 'Phone A' })
  await sleep(300)
  const fresh = [await N.request('GET', '/api/studio/signature/signature'), await N.request('POST', `/api/studio/sign?${pdf.q}`, { marks: [{ kind: 'signature', page: 1, x: 10, y: 10, w: 300, h: 90 }] }), await N.request('POST', '/api/studio/sign/phone', { what: 'signature' }), await N.request('POST', `/api/studio/sign/ask?${pdf.q}`, { pin: '1234' })]
  ok(fresh.every((x) => x.status === 403 || x.gone || x.error), 'a device paired but not kept yet: no picture, no signing, no Sign on Phone, no PIN to try', fresh.map((x) => x.status || x.error))
  const cKind = (await prog('GET', '/relay')).j?.devices?.find((d) => d.id === C.deviceId)?.kind
  const comp = [await C.request('GET', '/api/studio/signature/signature'), await C.request('POST', `/api/studio/sign?${pdf.q}`, { marks: [{ kind: 'signature', page: 1, x: 10, y: 10, w: 300, h: 90 }] }), await C.request('POST', '/api/studio/sign/phone', { what: 'signature' })]
  ok(cKind === 'computer' && comp.every((x) => x.status === 403 || x.gone || x.error), 'another computer of yours, kept: none of it either (signing is the app\'s window here, or your phone)', comp.map((x) => x.status || x.error))
  const phonePic = await A.request('GET', '/api/studio/signature/signature')
  ok(phonePic.status === 200, 'your phone, kept and let in: sees the picture', phonePic.status)

  // Sign on Phone: only the pad that asked follows it; a second request ends nobody else's.
  const first = (await win('POST', '/studio/sign/phone', { what: 'signature', doc: 'contract.pdf' })).j
  const second = (await win('POST', '/studio/sign/phone', { what: 'signature', doc: 'contract.pdf' })).j
  const firstState = await win('GET', `/studio/sign/phone/${first.id}/state?pad=${first.pad}`)
  const noPad = await win('GET', `/studio/sign/phone/${first.id}/state`)
  const otherPad = await win('GET', `/studio/sign/phone/${first.id}/state?pad=${second.pad}`)
  ok(firstState.j?.state === 'waiting' && noPad.status === 404 && otherPad.status === 404 && first.code !== undefined, 'a second pad\'s request leaves the first one waiting; neither follows the other\'s', { first: firstState.j, noPad: noPad.status, otherPad: otherPad.status })
  const list = (await A.request('GET', '/api/studio/sign/phone')).json?.list || []
  const r2 = list.find((x) => x.id === second.id)
  await A.request('POST', `/api/studio/sign/phone/${second.id}/answer`, { nonce: r2.nonce, ink: { w: 600, h: 260, strokes: [[[0.1, 0.6, 2], [0.3, 0.4, 2]]] } })
  const got1 = (await win('GET', `/studio/sign/phone/${first.id}/state?pad=${first.pad}`)).j
  const got2 = (await win('GET', `/studio/sign/phone/${second.id}/state?pad=${second.pad}`)).j
  ok(got1.state === 'waiting' && !got1.ink && got2.state === 'answered' && got2.ink?.strokes?.length === 1 && r2.code === second.code, 'the phone\'s answer goes to the pad that asked for it, with the same code on both', { got1, got2: got2.state })
  await win('POST', `/studio/sign/phone/${first.id}/cancel`, { pad: first.pad })
  // Asked again and again: limited, and so are the notifications.
  const pushed0 = A_.pushes().filter((x) => x.note?.kind === 'sign').length
  const spam = []
  for (let i = 0; i < 12; i++) spam.push(await win('POST', '/studio/sign/phone', { what: 'signature', doc: `spam ${i}` }))
  const pushed = A_.pushes().filter((x) => x.note?.kind === 'sign').length - pushed0
  ok(spam.some((x) => x.status === 429) && spam.filter((x) => x.status === 200).length <= 3 && pushed <= 4, 'asked again and again: a few at once, a few a minute, a few notifications', { codes: tally(spam), pushed })
  for (const x of spam.filter((y) => y.status === 200)) await win('POST', `/studio/sign/phone/${x.j.id}/cancel`, { pad: x.j.pad })

  // ---------- The PIN ----------
  // On, with Touch ID (this Mac's way, kept), and a PIN for the phone.
  await win('POST', '/studio/sign/ask/setting', { on: true })
  const plant = await win('POST', '/studio/sign/ask/setting', { pin: '4821' })
  const g = (await win('POST', '/studio/sign/ask', { purpose: 'settings' })).j
  const setPin = await win('POST', '/studio/sign/ask/setting', { pin: '4821', grant: g.grant })
  ok(plant.status === 403 && plant.j?.code === 'ask' && setPin.status === 200 && setPin.j.pin && setPin.j.recorded === 'device', 'a PIN set only once Touch ID is asked (not planted), with Touch ID kept as this Mac\'s way', { plant: plant.j, set: setPin.j })
  const guesses = Array.from({ length: 400 }, (_, i) => String(4471 + i)) // the right one at 350
  const res = await many(A, guesses.map((pin) => ({ m: 'POST', u: `/api/studio/sign/ask?${pdf.q}`, body: { pin } })))
  const t1 = tally(res)
  ok(!t1.GRANT && (t1['pin-wrong'] || 0) <= 5 && (t1['pin-wait'] || 0) + (t1['pin-locked'] || 0) >= 390, '400 PINs at once from a phone: one at a time, waiting between, locked after 5: no grant', t1)
  // This computer, where Touch ID is the way: no PIN, and a helper that doesn't answer is "try again".
  A_.helper({ probe: 'fail' })
  await sleep(16000) // (its last answer kept 15 s)
  const st = (await win('GET', '/studio/sign/ask')).j
  const down = await Promise.all(Array.from({ length: 50 }, (_, i) => win('POST', `/studio/sign/ask?${pdf.q}`, { pin: String(4800 + i) })))
  const t2 = tally(down)
  ok(st.way === null && st.recorded === 'device' && !t2.GRANT && t2['try-again'] === 50, 'the helper not answering on a Mac set to Touch ID: "try again", never the PIN in its place', { way: st.way, tally: t2 })
  A_.helper({})
  await sleep(16000)

  // ---------- A signed copy, and a sealed list changed on disk ----------
  const gs = (await win('POST', `/studio/sign/ask?${pdf.q}`, {})).j
  const s1 = await win('POST', `/studio/sign?${pdf.q}`, { grant: gs.grant, marks: [{ kind: 'signature', page: 1, x: 10, y: 10, w: 300, h: 90 }] })
  const copy = path.join(pdf.dir, s1.j.path)
  await win('GET', `/studio/open?root=${encodeURIComponent(pdf.root)}&path=${encodeURIComponent(s1.j.path)}`)
  const copies = everything(kit.data).filter((f) => sha(fs.readFileSync(f)) === sha(fs.readFileSync(copy)))
  ok(s1.status === 200 && !copies.length, 'signed and opened: no copy of the signed PDF anywhere in Bridge AI\'s data folder', copies.map((f) => path.relative(kit.data, f)))
  // The app's window secret after a restart: taken again only when it's the same one.
  fs.renameSync(A_.secretFile(), `${A_.secretFile()}.kept`)
  await kit.restart()
  const before2 = await win('GET', '/studio/sign/setup')
  const wrong = await prog('POST', '/window/hello', { secret: crypto.randomBytes(32).toString('base64url') })
  const right = await prog('POST', '/window/hello', { secret: A_.WINDOW })
  const after2 = await win('GET', '/studio/sign/setup')
  ok(before2.j?.canSign === false && wrong.status === 403 && right.status === 200 && after2.j?.canSign === true, 'after a restart: the window can\'t sign until the app gives its secret again; another secret is refused, the same one taken', { before: before2.j?.canSign, wrong: wrong.status, right: right.status, after: after2.j?.canSign })
  fs.renameSync(`${A_.secretFile()}.kept`, A_.secretFile())
  // One byte of the sealed list changed while it's closed: signing stays closed until you confirm.
  await kit.restart(() => { const f = path.join(sd, 'store.bin'); const b = fs.readFileSync(f); b[b.length - 1] ^= 1; fs.writeFileSync(f, b) })
  const after3 = (await win('GET', '/studio/sign/setup')).j
  const noGrant = await win('POST', `/studio/sign?${pdf.q}`, { marks: [{ kind: 'date', page: 1, x: 10, y: 10, w: 100, h: 20, text: 'today' }] })
  ok(after3.ask?.on === true && after3.setAside?.n >= 1 && noGrant.status === 403 && noGrant.j?.code === 'ask', 'the sealed list changed on disk: set aside, and signing still asks first (not open)', { ask: after3.ask, setAside: after3.setAside, sign: noGrant.status })

  // ---------- Where the PIN is this computer's way ----------
  B_ = await signKit('sign-security-pin', { probe: { trackpad: false, touchID: false, auth: false } })
  await B_.prog('POST', '/setup', { name: 'Tester' })
  const pdfB = await aPdf(B_)
  const on = await B_.win('POST', '/studio/sign/ask/setting', { on: true, pin: '4821' })
  // (In waves of 100 at once, under the queue of new connections a computer keeps; the right one in
  // the first.)
  const bGuesses = Array.from({ length: 400 }, (_, i) => String(4821 - 50 + i))
  const bRes = []
  for (let i = 0; i < bGuesses.length; i += 100) bRes.push(...(await Promise.all(bGuesses.slice(i, i + 100).map((pin) => B_.win('POST', `/studio/sign/ask?${pdfB.q}`, { pin })))))
  const t3 = tally(bRes)
  const progB = await Promise.all(bGuesses.slice(0, 20).map((pin) => B_.prog('POST', `/studio/sign/ask?${pdfB.q}`, { pin })))
  ok(on.status === 200 && on.j.way === 'pin' && !t3.GRANT && (t3['pin-wrong'] || 0) <= 5 && (t3['pin-wait'] || 0) + (t3['pin-locked'] || 0) >= 395 && progB.every((x) => x.status === 403), '400 PINs at once where the PIN is the way: no grant; from the key alone, not even tried', { tally: t3, prog: tally(progB) })

  // ---------- The helper itself, built for release (a Mac) ----------
  if (!IS_MAC) skip('native/bridgesign answers only Bridge AI', 'macOS only')
  else if (spawnSync('swiftc', ['--version']).status !== 0 && !process.env.CI) skip('native/bridgesign answers only Bridge AI', 'no swiftc here')
  else {
    const nb = path.join(kit.dir, 'release-bin')
    const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'calltap.js'), nb, '--only', 'bridgesign', '--strict', '--release'], { encoding: 'utf8' })
    const helper = path.join(nb, 'bridgesign')
    const key = fs.existsSync(helper) ? spawnSync(helper, ['key'], { encoding: 'utf8', timeout: 10000 }) : null
    const auth = fs.existsSync(helper) ? spawnSync(helper, ['auth'], { input: '{"reason":"sign x.pdf"}\n', encoding: 'utf8', timeout: 10000 }) : null
    const probe = fs.existsSync(helper) ? spawnSync(helper, ['probe'], { encoding: 'utf8', timeout: 10000 }) : null
    ok(built.status === 0 && /"error":"parent"/.test(key?.stdout || '') && !/"key"/.test(key?.stdout || '') && /"code":"parent"/.test(auth?.stdout || '') && /"auth":false/.test(probe?.stdout || ''), 'built for release, the helper gives its key and asks for Touch ID only for Bridge AI: this test process gets neither', { built: built.status, key: key?.stdout, auth: auth?.stdout, probe: probe?.stdout })
  }
  // The stand-in only in the tests: without BRIDGE_FIX_DRYRUN, BRIDGE_SIGNHELPER is never used.
  const prod = spawnSync(process.execPath, ['--input-type=module', '-e', `const { signBin } = await import(${JSON.stringify(path.join(ROOT, 'server', 'signhelper.js'))}); console.log(JSON.stringify(signBin()))`], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: kit.home, BRIDGE_HOME: kit.data, BRIDGE_SIGNHELPER: '/bin/echo' } })
  ok(prod.status === 0 && !/\/bin\/echo/.test(prod.stdout), 'outside the tests, the helper is never taken from the environment', prod.stdout + prod.stderr)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const c of links) c.close?.()
  kit.stop(); B_?.kit.stop(); relay.stop()
}
process.exit(done().fail ? 1 : 0)
