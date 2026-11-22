// Studio's signing held to its owner: what a program that has only Bridge AI's key (the CLI, a
// script, an agent or a bot with a shell), a device that isn't yours (not kept yet, another
// computer), a browser tab, or a server started with keys that aren't the app's can't do, and Ask
// Before Signing that can't be gone round. No browser: the server's answers, a phone through the
// relay stand-in (test/lib/linkclient.mjs), the app's own side of the window check
// (desktop/windowauth.js), and a stand-in for native/bridgesign (stand-ins/bridgesign.cjs; on a Mac,
// the real one is also built for release and signed with throwaway certificates).
//   The key alone: no signature's picture (nor with the windows' cookie, which the key makes), none
//   into a backup, no signing (Ask Before Signing off or on), no change to them, no trackpad (the
//   helper never started), no Sign on Phone, no Touch ID asked, no PIN planted.
//   The app's window: each request a MAC of its secret (not the secret, not used twice, not for
//   another path); the app checks the server is the one it started before it sends any (proof), and
//   that it has the app's secret without sending it (hello). A server started without the app's keys,
//   or with another secret or key on its pipe, gets no signature, and the app's own come back.
//   Devices: one paired and not kept yet, and another computer, get none of it; only the pad that
//   asked follows its phone request; asks and notifications limited, each asker its own.
//   The PIN: tries at once are tries one after another, from a phone and from this computer where
//   the PIN is the way; a helper that doesn't answer is "try again", never the PIN; turned on from a
//   phone, this Mac's own way is kept.
//   The document: signing has to find the bytes you were shown and confirmed, or signs nothing.
//   The record: its MAC bound to its two files (one copied into another file's history, or made with
//   another key, isn't trusted).
//   At rest: a signature kept open before (with an index.json half written) sealed at start; no key
//   in the data folder; a signed copy never kept in the data folder, wherever it's moved or changed;
//   a sealed list changed on disk, or an older copy put back, leaves signing asking first.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import net from 'node:net'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { startKit, startRelay, checks, until, sleep, rawFetch, freePort, ROOT, IS_WIN, IS_MAC, appKeysFor, windowHeader } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'
import { K, json, text } from '../../relay/web/link.js'

const require = createRequire(path.join(ROOT, 'package.json'))
const { PDFDocument, StandardFonts } = require('pdf-lib')
const windowAuth = require(path.join(ROOT, 'desktop', 'windowauth.js'))
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

// A kit with the stand-in helper (told what to do in bridgesign.json), the app's keys given at start
// (as the app gives them on its pipe: appKeysFor; more: in place of some of them), and before: what's
// in its data folder as it starts.
async function signKit(name, { probe = null, before = null, relay = null, more = {}, config = {}, listen = false } = {}) {
  let state = null, log = null, push = null, keys = null
  const kit = await startKit(name, {
    config,
    env: ({ bin, data, port }) => {
      if (relay) fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile))
      before?.(data)
      state = path.join(bin, 'bridgesign.json'); log = path.join(bin, 'bridgesign.log'); push = path.join(bin, 'push.jsonl')
      fs.writeFileSync(state, JSON.stringify({ auth: { ok: true, how: 'touchid' }, ...(probe ? { probe } : {}) }))
      // (listen: where the app talks to it, as the app hands it: 127.0.0.1 and its port.)
      keys = appKeysFor(bin, { store: 'keychain', ...(listen ? { listen: { host: '127.0.0.1', port } } : {}), ...more })
      const env = { BRIDGE_COMPUTER_NAME: 'Studio Mac', BRIDGE_TEST_PUSH: push, BRIDGE_TEST_WINDOW_FILE: keys.file }
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
    const url = `${kit.url}/api${p}`
    const sent = body ? JSON.stringify(body) : undefined
    try { r = await rawFetch(url, { method, headers: { 'content-type': 'application/json', ...headers(method, url, sent ?? null), ...extra }, body: sent }) } catch (e) { return { status: 0, error: e.cause?.code || e.message, j: null, buf: Buffer.alloc(0) } }
    const buf = Buffer.from(await r.arrayBuffer())
    let j = null
    try { j = JSON.parse(buf.toString('utf8')) } catch { /* a picture */ }
    return { status: r.status, j, buf }
  }
  const me = {
    kit, keys,
    // A program with the key alone (Bearer, nothing else), and the app's own window (a MAC of its
    // secret on each request, as the app adds it: winAs, another secret's).
    prog: call(() => ({ authorization: `Bearer ${kit.key}` })),
    win: call((m, u, b) => ({ authorization: `Bearer ${kit.key}`, 'x-bridge-window': windowHeader(keys.window, m, u, b) })),
    winAs: (secret) => call((m, u, b) => ({ authorization: `Bearer ${kit.key}`, 'x-bridge-window': windowHeader(secret, m, u, b) })),
    helper: (o) => fs.writeFileSync(state, JSON.stringify({ auth: { ok: true, how: 'touchid' }, ...o })),
    started: () => { try { return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } },
    pushes: () => { try { return fs.readFileSync(push, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } },
    // What the app's own feed says of the signatures' list ({ v, ask }), as the app hears it.
    async heard() {
      const ctl = new AbortController()
      try {
        const r = await rawFetch(`${kit.url}/api/events`, { headers: { authorization: `Bearer ${kit.key}`, 'x-bridge-desktop': '1' }, signal: ctl.signal })
        let buf = ''
        for await (const c of r.body) {
          buf += Buffer.from(c).toString('utf8')
          const m = /event: sign-state\ndata: (.*)\n/.exec(buf)
          if (m) return JSON.parse(m[1])
        }
      } catch { /* none */ } finally { ctl.abort() }
      return null
    },
  }
  return me
}
// A PDF in a place of its own: its root and a query for it.
async function aPdf(s, name = 'x.pdf', line = null) {
  const dir = path.join(s.kit.home, 'Deals')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), await pdfSaying(line))
  const root = `place:${(await s.win('POST', '/places', { path: dir })).j.place.id}`
  return { dir, root, q: `root=${encodeURIComponent(root)}&path=${encodeURIComponent(name)}`, body: { root, path: name }, shown: () => sha(fs.readFileSync(path.join(dir, name))) }
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
// A PDF of one page, saying line (or nothing).
async function pdfSaying(line) {
  const d = await PDFDocument.create()
  const pg = d.addPage([612, 792])
  if (line) pg.drawText(line, { x: 72, y: 700, size: 14, font: await d.embedFont(StandardFonts.Helvetica) })
  return d.save()
}
const MARKS = [{ kind: 'signature', page: 1, x: 10, y: 10, w: 300, h: 90 }]
const tally = (list) => list.reduce((o, x) => { const k = (x?.j || x?.json)?.grant ? 'GRANT' : (x?.j || x?.json)?.code || x?.error || x?.status; o[k] = (o[k] || 0) + 1; return o }, {})

const relay = await startRelay('sign-security')
const OLD = png(210, 70)
const A_ = await signKit('sign-security', {
  relay,
  more: { testHeader: false }, // (as the app's pipe: no test pages' header)
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
let C_ = null
try {
  await prog('POST', '/setup', { name: 'Tester' })
  const sd = path.join(kit.data, 'studio', 'signatures')

  // ---------- At rest ----------
  const sealedAtStart = await until(() => !fs.existsSync(path.join(sd, 'signature.png')) && !fs.existsSync(path.join(sd, 'index.json')), 15000)
  const s0 = (await win('GET', '/studio/sign/setup')).j
  ok(!!sealedAtStart && s0.list?.length === 1 && s0.list[0].width === 210 && !everything(sd).some((f) => fs.readFileSync(f).includes(OLD.subarray(0, 64))), 'a signature kept open before, its index.json half written: sealed at start, the open one gone', { files: fs.readdirSync(sd), list: s0.list })
  ok(s0.sealed?.by === 'app' && s0.sealed.store === 'keychain' && !fs.existsSync(path.join(sd, 'key')) && !everything(kit.data).some((f) => fs.readFileSync(f).includes(Buffer.from(A_.keys.key, 'base64'))), 'sealed with the app\'s key (kept by the app, given at start): no key anywhere in the data folder', { sealed: s0.sealed })
  const mine = png(300, 90)
  const add = await win('POST', '/studio/signatures', { kind: 'signature', name: 'Mine', png: dataUrl(mine), default: true })
  ok(add.status === 200, 'the app\'s window keeps a signature', add.status)
  // (A copy of the list as it is now, Ask Before Signing off, for one put back later.)
  const oldStore = fs.readFileSync(path.join(sd, 'store.bin'))
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
  // The window: a MAC of its secret, made for each request, never the secret itself.
  const picUrl = `${kit.url}/api/studio/signature/signature`
  const raw = await rawFetch(picUrl, { headers: { authorization: `Bearer ${kit.key}`, 'x-bridge-window': A_.keys.window } })
  const one = windowHeader(A_.keys.window, 'GET', picUrl)
  const first0 = await rawFetch(picUrl, { headers: { authorization: `Bearer ${kit.key}`, 'x-bridge-window': one } })
  const again0 = await rawFetch(picUrl, { headers: { authorization: `Bearer ${kit.key}`, 'x-bridge-window': one } })
  const forOther = await rawFetch(`${kit.url}/api/studio/signature/initials`, { headers: { authorization: `Bearer ${kit.key}`, 'x-bridge-window': windowHeader(A_.keys.window, 'GET', picUrl) } })
  const testForm = await rawFetch(picUrl, { headers: { authorization: `Bearer ${kit.key}`, 'x-bridge-window': `test.${A_.keys.window}` } })
  ok(raw.status === 403 && testForm.status === 403 && first0.status === 200 && again0.status === 403 && forOther.status === 403, 'the window\'s requests: a MAC for that one request, once; the secret itself is no use (nor the tests\' own form of it)', { raw: raw.status, test: testForm.status, first: first0.status, again: again0.status, other: forOther.status })
  // The app's own checks (desktop/windowauth.js, as main.js runs them): the server proves it's the one
  // the app started, and has its window secret, which never goes over the wire.
  const appFetch = (u, o = {}) => rawFetch(u, { ...o, headers: { ...(o.headers || {}), authorization: `Bearer ${kit.key}` } })
  const proven = await windowAuth.proves({ port: kit.port, launch: A_.keys.launch, headers: { authorization: `Bearer ${kit.key}` } })
  const notThat = await windowAuth.proves({ port: kit.port, launch: crypto.randomBytes(32).toString('base64url'), headers: { authorization: `Bearer ${kit.key}` } })
  const has = await windowAuth.hello(appFetch, kit.url, A_.keys.window)
  const hasNot = await windowAuth.hello(appFetch, kit.url, crypto.randomBytes(32).toString('base64url'))
  const given = await prog('POST', '/window/hello', { secret: crypto.randomBytes(32).toString('base64url') })
  ok(proven && !notThat && has && !hasNot && given.status === 403, 'the app checks the server is the one it started, and that it has the app\'s window secret, without sending it; no secret is taken over the wire', { proven, notThat, has, hasNot, given: given.status })
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
  const B = await pairAs('Phone B') // (one phone asks another: Sign on Phone from a phone)
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
  // One phone asking again and again uses up its own budget, not the window's.
  const byPhone = []
  for (let i = 0; i < 12; i++) { const r = await A.request('POST', '/api/studio/sign/phone', { what: 'signature', doc: `from A ${i}` }); byPhone.push(r.json?.code || r.status); if (r.json?.id) await A.request('POST', `/api/studio/sign/phone/${r.json.id}/cancel`, { pad: r.json.pad }) }
  const winAfter = await win('POST', '/studio/sign/phone', { what: 'signature', doc: 'contract.pdf' })
  ok(byPhone.includes('too-often') && winAfter.status === 200, 'a phone asking again and again runs out of its own asks; the window still has its own', { phone: byPhone, window: winAfter.status })
  if (winAfter.j?.id) await win('POST', `/studio/sign/phone/${winAfter.j.id}/cancel`, { pad: winAfter.j.pad })
  // Asked again and again: limited, and so are the notifications.
  const pushed0 = A_.pushes().filter((x) => x.note?.kind === 'sign').length
  const spam = []
  for (let i = 0; i < 12; i++) spam.push(await win('POST', '/studio/sign/phone', { what: 'signature', doc: `spam ${i}` }))
  const pushed = A_.pushes().filter((x) => x.note?.kind === 'sign').length - pushed0
  ok(spam.some((x) => x.status === 429) && spam.filter((x) => x.status === 200).length <= 3 && pushed <= 4, 'asked again and again: a few at once, a few a minute, a few notifications', { codes: tally(spam), pushed })
  for (const x of spam.filter((y) => y.status === 200)) await win('POST', `/studio/sign/phone/${x.j.id}/cancel`, { pad: x.j.pad })

  // ---------- The PIN ----------
  // Turned on from your phone: this Mac's own way kept (Touch ID), not the phone's PIN.
  const fromPhone = await A.request('POST', '/api/studio/sign/ask/setting', { on: true })
  ok(fromPhone.status === 200 && fromPhone.json?.on && fromPhone.json.recorded === 'device', 'turned on from your phone: this Mac\'s own way (Touch ID) is the one kept', fromPhone.json)
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

  // ---------- The document you confirmed ----------
  // Confirmed for what it said, then changed (by an agent in that folder): nothing signed.
  fs.writeFileSync(path.join(pdf.dir, 'contract.pdf'), await pdfSaying('Fee: $1,200 a year'))
  const cq = `root=${encodeURIComponent(pdf.root)}&path=contract.pdf`
  const shownSha = sha(fs.readFileSync(path.join(pdf.dir, 'contract.pdf')))
  const gc = (await win('POST', `/studio/sign/ask?${cq}`, { sha256: shownSha })).j
  const reason = A_.started().filter((x) => x.args[0] === 'auth').at(-1)?.said?.reason
  fs.writeFileSync(path.join(pdf.dir, 'contract.pdf'), await pdfSaying('Fee: $1,200,000 a year'))
  const inSigned = () => (fs.existsSync(path.join(pdf.dir, '_signed')) ? fs.readdirSync(path.join(pdf.dir, '_signed')).filter((f) => f.startsWith('contract')).length : 0)
  const swapped = await win('POST', `/studio/sign?${cq}`, { grant: gc.grant, sha256: shownSha, marks: MARKS })
  const swappedNoSha = await win('POST', `/studio/sign?${cq}`, { grant: (await win('POST', `/studio/sign/ask?${cq}`, {})).j.grant, sha256: sha(fs.readFileSync(path.join(pdf.dir, 'contract.pdf'))), marks: MARKS }).then(async (x) => (fs.writeFileSync(path.join(pdf.dir, 'contract.pdf'), await pdfSaying('Fee: $1,200 a year')), x))
  ok(/^sign "contract\.pdf"$/.test(reason || '') && !!gc.grant && swapped.status === 409 && swapped.j?.code === 'changed' && inSigned() <= 1, 'confirmed for one document, then that file changed: nothing signed, it says the document changed', { reason, swapped: swapped.j, signed: inSigned() })
  const stale = await win('POST', `/studio/sign/ask?${cq}`, { sha256: shownSha.replace(/^./, (c) => (c === '0' ? '1' : '0')) })
  const g2 = (await win('POST', `/studio/sign/ask?${cq}`, {})).j
  const beforeAppend = sha(fs.readFileSync(path.join(pdf.dir, 'contract.pdf')))
  fs.appendFileSync(path.join(pdf.dir, 'contract.pdf'), '\n% changed\n')
  const afterAsk = await win('POST', `/studio/sign?${cq}`, { grant: g2.grant, sha256: beforeAppend, marks: MARKS })
  // Nothing said of what was shown (a page from before, a program): nothing signed. A PDF opened in
  // Studio comes with its SHA-256, for a page that reads a big one in parts to send.
  const g3 = (await win('POST', `/studio/sign/ask?${cq}`, {})).j
  const noShown = await win('POST', `/studio/sign?${cq}`, { grant: g3.grant, marks: MARKS })
  const opened = (await win('GET', `/studio/open?${cq}`)).j
  ok(noShown.status === 400 && noShown.j?.code === 'need-sha' && opened.sha256 === sha(fs.readFileSync(path.join(pdf.dir, 'contract.pdf'))), 'signing with nothing said of what was shown: refused; Studio gives the PDF\'s hash as it opens it, for a page that reads it in parts', { noShown: noShown.j, opened: opened.sha256 })
  ok(stale.status === 409 && stale.j?.code === 'changed' && afterAsk.status === 409 && afterAsk.j?.code === 'changed' && swappedNoSha.status === 200, 'shown one way and changed before you were asked: not asked; changed after (whatever the page sends): not signed', { stale: stale.j?.code, afterAsk: afterAsk.j?.code })

  // ---------- The record ----------
  for (const n of ['a.pdf', 'b.pdf']) fs.writeFileSync(path.join(pdf.dir, n), await pdfSaying(n))
  const signAs = async (n) => { const qn = `root=${encodeURIComponent(pdf.root)}&path=${encodeURIComponent(n)}`; const gg = (await win('POST', `/studio/sign/ask?${qn}`, {})).j; return win('POST', `/studio/sign?${qn}`, { grant: gg.grant, sha256: sha(fs.readFileSync(path.join(pdf.dir, n))), marks: MARKS }) }
  const sa = await signAs('a.pdf'), sb = await signAs('b.pdf')
  const idxOf = (n) => path.join(kit.data, 'studio', 'versions', crypto.createHash('sha1').update(fs.realpathSync(path.join(pdf.dir, n))).digest('hex').slice(0, 20), 'index.json')
  const ia = JSON.parse(fs.readFileSync(idxOf('a.pdf'), 'utf8')), ib = JSON.parse(fs.readFileSync(idxOf('b.pdf'), 'utf8'))
  const canon = (o) => JSON.stringify(Object.keys(o).sort().reduce((x, k) => { x[k] = o[k]; return x }, {}))
  const otherKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.alloc(32, 7), Buffer.alloc(0), Buffer.from('bridge-ai signing record'), 32))
  const forged = { ...ib.signed[0], id: 'sforged1', how: 'touchid', at: '2026-11-01T09:00:00.000Z' }
  forged.mac = crypto.createHmac('sha256', otherKey).update(canon(forged)).digest('base64url')
  ib.signed = [{ ...ia.signed[0] }, forged, ...ib.signed]
  fs.writeFileSync(idxOf('b.pdf'), JSON.stringify(ib, null, 1))
  const vb = (await win('GET', `/studio/versions?root=${encodeURIComponent(pdf.root)}&path=b.pdf`)).j
  const byId = (id) => vb.signings.find((x) => x.id === id)
  ok(sa.status === 200 && sb.status === 200 && byId(ia.signed[0].id)?.verified === false && byId('sforged1')?.verified === false && byId(sb.j.record.id)?.verified === true && sb.j.record.fromSha256 === sha(fs.readFileSync(path.join(pdf.dir, 'b.pdf'))), 'a.pdf\'s record copied into b.pdf\'s history, or one made with another key: not trusted; b.pdf\'s own is, with both files\' hashes', vb.signings.map((x) => ({ id: x.id, from: x.from, verified: x.verified })))

  // ---------- A signed copy, wherever it goes ----------
  const copy = path.join(pdf.dir, sa.j.path)
  fs.copyFileSync(copy, path.join(pdf.dir, 'moved.pdf'))
  const edited = await PDFDocument.load(fs.readFileSync(copy), { updateMetadata: false })
  edited.addPage([612, 792])
  fs.writeFileSync(path.join(pdf.dir, 'edited.pdf'), await edited.save({ useObjectStreams: true })) // (its mark packed away)
  for (const n of [sa.j.path, 'moved.pdf', 'edited.pdf']) await win('GET', `/studio/open?root=${encodeURIComponent(pdf.root)}&path=${encodeURIComponent(n)}`)
  const signedBytes = [copy, path.join(pdf.dir, 'edited.pdf')].map((f) => sha(fs.readFileSync(f)))
  const kept = everything(kit.data).filter((f) => signedBytes.includes(sha(fs.readFileSync(f))))
  ok(!kept.length && !fs.readFileSync(path.join(pdf.dir, 'edited.pdf')).includes('BridgeAISigned'), 'a signed copy opened in its _signed folder, copied out of it, or changed (a page added, its objects packed so its mark isn\'t in its bytes): none kept in Bridge AI\'s data folder', kept.map((f) => path.relative(kit.data, f)))

  // ---------- A copy of the list from before, put back ----------
  const state = await A_.heard()
  await kit.restart(() => {
    fs.writeFileSync(path.join(sd, 'store.bin'), oldStore)
    fs.rmSync(path.join(sd, 'ask-before-signing'), { force: true })
    A_.keys.write({ ...A_.keys, file: undefined, write: undefined, state })
  })
  const afterOld = (await win('GET', '/studio/sign/setup')).j
  const noGrant0 = await win('POST', `/studio/sign?${pdf.q}`, { marks: MARKS })
  const confirm = (await win('POST', `/studio/sign/ask?${pdf.q}`, {})).j
  const st2 = (await win('GET', '/studio/sign/ask')).j
  ok(state?.ask === true && state.v > 0 && !!afterOld.older && noGrant0.status === 403 && noGrant0.j?.code === 'ask' && !!confirm.grant && st2.on === true && !(await win('GET', '/studio/sign/setup')).j.older, 'a copy of the list from before Ask Before Signing was on, put back with its mark gone: older than the app last heard, so signing asks first; once you confirm, it\'s on again', { state, older: afterOld.older, sign: noGrant0.j?.code, on: st2.on })

  // ---------- Started with keys that aren't the app's ----------
  const real = { window: A_.keys.window, key: A_.keys.key, launch: A_.keys.launch, store: 'keychain' }
  const mineOk = async () => (await win('GET', '/studio/signature/signature')).buf.equals(mine)
  // (a) No keys at all (npm start, a program starting it): its window can't sign; nothing is given over the wire.
  await kit.restart(() => A_.keys.write(''))
  const bare = (await win('GET', '/studio/sign/setup')).j
  const bareHello = await prog('POST', '/window/hello', { secret: real.window })
  const barePic = await win('GET', '/studio/signature/signature')
  ok(bare.canSign === false && bareHello.status === 403 && barePic.status === 403 && !(await windowAuth.proves({ port: kit.port, launch: real.launch, headers: { authorization: `Bearer ${kit.key}` } })), 'started without the app\'s keys: the window can\'t sign, its secret isn\'t taken over the wire, and the app finds it isn\'t the server it started', { canSign: bare.canSign, hello: bareHello.status, pic: barePic.status })
  // (b) Another window secret on the pipe, no key: that window gets no signature.
  const EVIL = crypto.randomBytes(32).toString('base64url')
  await kit.restart(() => A_.keys.write({ window: EVIL, launch: crypto.randomBytes(32).toString('base64url') }))
  const evilPic = await A_.winAs(EVIL)('GET', '/studio/signature/signature')
  // (c) Another window secret and another key: the list it can't open set aside, its own empty.
  await kit.restart(() => A_.keys.write({ window: EVIL, key: crypto.randomBytes(32).toString('base64'), launch: crypto.randomBytes(32).toString('base64url') }))
  const evilPic2 = await A_.winAs(EVIL)('GET', '/studio/signature/signature')
  const evilList = (await A_.winAs(EVIL)('GET', '/studio/sign/setup')).j
  // ...then the app's own again: yours come back.
  await kit.restart(() => A_.keys.write(real))
  const back = (await win('GET', '/studio/sign/setup')).j
  ok(evilPic.status !== 200 && evilPic2.status !== 200 && !evilList.list?.length && back.canSign && back.list.some((x) => x.name === 'Mine') && await mineOk(), 'started with another window secret (and another key): it gets none of your signatures; the app\'s own again, and they\'re back', { evil: [evilPic.status, evilPic2.status], evilList: evilList.list?.length, back: back.list?.map((x) => x.name) })

  // ---------- A sealed list changed on disk ----------
  // One byte of the sealed list changed while it's closed: signing stays closed until you confirm.
  await kit.restart(() => { const f = path.join(sd, 'store.bin'); const b = fs.readFileSync(f); b[b.length - 1] ^= 1; fs.writeFileSync(f, b) })
  const after3 = (await win('GET', '/studio/sign/setup')).j
  const noGrant = await win('POST', `/studio/sign?${pdf.q}`, { marks: [{ kind: 'date', page: 1, x: 10, y: 10, w: 100, h: 20, text: 'today' }] })
  ok(after3.ask?.on === true && after3.setAside?.n >= 0 && !!after3.setAside && noGrant.status === 403 && noGrant.j?.code === 'ask', 'the sealed list changed on disk: set aside, and signing still asks first (not open)', { ask: after3.ask, setAside: after3.setAside, sign: noGrant.status })

  // ---------- A list sealed with a key file put beside yours ----------
  // (A program with your files only: a key file of its own, and a list sealed with it naming your
  // pictures, with Ask Before Signing off and a high version, the mark beside it gone.)
  const appState = { v: 5, ask: true }
  const KF = crypto.randomBytes(32)
  const sealAs = (k, name, buf) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', k, iv); c.setAAD(Buffer.from(name)); const b = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([Buffer.from('BSIG1'), iv, c.getAuthTag(), b]) }
  const ids = fs.readdirSync(sd).filter((f) => /^[a-z0-9]{8,32}\.bin$/.test(f)).map((f) => f.slice(0, -4))
  const notYours = { list: ids.map((id) => ({ id, kind: 'signature', name: 'Not yours', at: new Date().toISOString(), width: 300, height: 90 })), defaults: { signature: ids[0] || null }, v: 1_000_000_000, ask: { on: false, way: 'device', pin: null, fails: 0, lockUntil: 0, locks: 0, nextTry: 0 } }
  await kit.restart(() => {
    fs.writeFileSync(path.join(sd, 'store.bin'), sealAs(KF, 'store', Buffer.from(JSON.stringify(notYours))))
    fs.writeFileSync(path.join(sd, 'key'), KF.toString('base64'))
    fs.rmSync(path.join(sd, 'ask-before-signing'), { force: true })
    A_.keys.write({ ...real, state: appState })
  })
  const injected = (await win('GET', '/studio/sign/setup')).j
  const injSign = await win('POST', `/studio/sign?${pdf.q}`, { sha256: pdf.shown(), marks: [{ kind: 'date', page: 1, x: 10, y: 10, w: 100, h: 20, text: 'today' }] })
  ok(injected.sealed?.by === 'app' && !fs.existsSync(path.join(sd, 'key')) && !injected.list?.some((x) => x.name === 'Not yours') && !!injected.setAside && injSign.status === 403 && injSign.j?.code === 'ask', 'a list sealed with a key file another program put beside yours: never sealed again with the app\'s key, set aside, and signing asks first', { sealed: injected.sealed, list: injected.list?.map((x) => x.name), setAside: injected.setAside, sign: injSign.j?.code })
  // The app last heard Ask Before Signing was on; the list says off, at whatever version: asks first.
  const offList = { list: [], defaults: {}, v: 1_000_000_000, ask: { on: false, way: 'device', pin: null, fails: 0, lockUntil: 0, locks: 0, nextTry: 0 } }
  await kit.restart(() => {
    fs.writeFileSync(path.join(sd, 'store.bin'), sealAs(Buffer.from(A_.keys.key, 'base64'), 'store', Buffer.from(JSON.stringify(offList))))
    fs.rmSync(path.join(sd, 'ask-before-signing'), { force: true })
  })
  const offSetup = (await win('GET', '/studio/sign/setup')).j
  const offSign = await win('POST', `/studio/sign?${pdf.q}`, { sha256: pdf.shown(), marks: [{ kind: 'date', page: 1, x: 10, y: 10, w: 100, h: 20, text: 'today' }] })
  ok(!!offSetup.older && offSign.status === 403 && offSign.j?.code === 'ask', 'the app last heard Ask Before Signing was on, and the list says off at a higher version: signing asks first until you confirm', { older: offSetup.older, sign: offSign.j?.code })

  // ---------- The app's server and SIGUSR1 ----------
  // The app starts its server with flags that keep SIGUSR1 from opening Node's inspector
  // (desktop/serverflags.js, main.js); without them the signal opens it and the process's memory can
  // be read from there.
  const { SERVER_NODE_FLAGS } = require(path.join(ROOT, 'desktop', 'serverflags.js'))
  const idle = path.join(kit.dir, 'idle.cjs')
  fs.writeFileSync(idle, 'globalThis.SECRET = "in memory"; setInterval(() => {}, 1000)\n')
  const opens = (port) => new Promise((resolve) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); resolve(true) }); c.once('error', () => resolve(false)) })
  const usr1 = async (flags) => {
    const port = await freePort()
    const c = spawn(process.execPath, [`--inspect-port=${port}`, ...flags, idle], { stdio: 'ignore' })
    await sleep(500)
    c.kill('SIGUSR1')
    await sleep(1500)
    const r = { inspector: await opens(port), alive: c.exitCode == null && c.signalCode == null }
    c.kill()
    return r
  }
  if (IS_WIN) skip('SIGUSR1 opens no inspector on the app\'s server', 'no signals on Windows')
  else {
    const bare = await usr1([]), flagged = await usr1(SERVER_NODE_FLAGS)
    const mainSrc = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8')
    ok(bare.inspector && !flagged.inspector && flagged.alive && /require\('\.\/serverflags\.js'\)\.SERVER_NODE_FLAGS, path\.join\(ROOT, 'server', 'index\.js'\)/.test(mainSrc), 'the app\'s server: SIGUSR1 opens no inspector (without its flags, it does), and it carries on', { bare, flagged })
  }

  // ---------- Where the PIN is this computer's way ----------
  B_ = await signKit('sign-security-pin', { probe: { trackpad: false, touchID: false, auth: false }, more: { key: null, store: null } })
  await B_.prog('POST', '/setup', { name: 'Tester' })
  const bSealed = (await B_.win('GET', '/studio/sign/setup')).j.sealed
  ok(bSealed?.by === 'file', 'with no key from the app: a key file, and Settings says so', bSealed)
  // An app with no keychain makes a new window secret each time it starts: with a key file, it's
  // taken, so signing still works in its window.
  const NEW = crypto.randomBytes(32).toString('base64url')
  await B_.kit.restart(() => B_.keys.write({ window: NEW, launch: crypto.randomBytes(32).toString('base64url'), testHeader: true }))
  const bAfter = (await B_.winAs(NEW)('GET', '/studio/sign/setup')).j
  // ...and a start where the app couldn't read its own keys: nothing opened, no key made, and said.
  const keyFiles = () => fs.readdirSync(path.join(B_.kit.data, 'studio', 'signatures')).filter((f) => /^key/.test(f))
  const filesBefore = keyFiles()
  await B_.kit.restart(() => B_.keys.write({ window: NEW, launch: crypto.randomBytes(32).toString('base64url'), unreadable: true }))
  const bUnread = (await B_.winAs(NEW)('GET', '/studio/sign/setup')).j
  ok(bAfter.canSign === true && bUnread.keysUnreadable === true && JSON.stringify(keyFiles()) === JSON.stringify(filesBefore), 'with a key file: the app\'s new window secret taken; a start where the app couldn\'t read its keys: none used, none made, and it says so', { canSign: bAfter.canSign, unreadable: bUnread.keysUnreadable, keyFiles: keyFiles() })
  await B_.kit.restart(() => B_.keys.write({ window: B_.keys.window, launch: crypto.randomBytes(32).toString('base64url'), testHeader: true }))
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

  // ---------- Where the app talks to its server ----------
  // config.json says another address (::1), the app's pipe says 127.0.0.1 and its port: it listens
  // there and nowhere else.
  C_ = await signKit('sign-security-port', { config: { host: '::1' }, listen: true, more: { testHeader: false } })
  const ck = C_.kit
  const reach6 = await new Promise((resolve) => { const c = net.connect(ck.port, '::1'); c.once('connect', () => { c.destroy(); resolve(true) }); c.once('error', () => resolve(false)) })
  ok(!reach6 && (await C_.prog('GET', '/version')).status === 200, 'started by the app: it listens where the app talks to it (127.0.0.1 and its port), not where config.json says', { onV6: reach6 })
  await C_.prog('POST', '/setup', { name: 'Tester' })
  const cmine = png(260, 80)
  await C_.win('POST', '/studio/signatures', { kind: 'signature', name: 'Mine', png: dataUrl(cmine), default: true })
  // Another program on another port, passing everything on to it: the app's check of the server
  // fails through it, and a window's request sent to it is refused.
  const Q = await freePort()
  const passed = { proofs: 0, pictures: 0 }
  const fwd = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      if (req.url.startsWith('/api/window/proof')) passed.proofs++
      const up = http.request({ host: '127.0.0.1', port: ck.port, method: req.method, path: req.url, headers: req.headers }, (r) => {
        const back = []
        r.on('data', (c) => back.push(c))
        r.on('end', () => { const b = Buffer.concat(back); if (/image\/png/.test(r.headers['content-type'] || '')) passed.pictures++; res.writeHead(r.statusCode, r.headers); res.end(b) })
      })
      up.on('error', () => { res.writeHead(502); res.end() })
      up.end(Buffer.concat(chunks))
    })
  }).listen(Q, '127.0.0.1')
  await new Promise((r) => fwd.once('listening', r))
  const auth = { authorization: `Bearer ${ck.key}` }
  const direct = await windowAuth.proves({ port: ck.port, launch: C_.keys.launch, headers: auth })
  const through = await windowAuth.proves({ port: Q, launch: C_.keys.launch, headers: auth })
  const viaQ = `http://127.0.0.1:${Q}/api/studio/signature/signature`
  const picThrough = await rawFetch(viaQ, { headers: { ...auth, 'x-bridge-window': windowHeader(C_.keys.window, 'GET', viaQ) } })
  fwd.close()
  ok(direct && !through && passed.proofs === 1 && picThrough.status === 403 && passed.pictures === 0, 'through another program passing it on: the app\'s check of the server fails, and a window\'s request sent there gets no picture', { direct, through, picture: picThrough.status })
  // The body is in the window's MAC: one changed on the way is refused.
  const addUrl = `${ck.url}/api/studio/signatures`
  const meant = JSON.stringify({ kind: 'signature', name: 'Drawn again', png: dataUrl(png(250, 80)), default: true })
  const swappedBody = JSON.stringify({ kind: 'signature', name: 'Drawn again', png: dataUrl(png(120, 40)), default: true })
  const changedOnWay = await rawFetch(addUrl, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'x-bridge-window': windowHeader(C_.keys.window, 'POST', addUrl, meant) }, body: swappedBody })
  const asMeant = await rawFetch(addUrl, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'x-bridge-window': windowHeader(C_.keys.window, 'POST', addUrl, meant) }, body: meant })
  ok(changedOnWay.status === 403 && asMeant.status === 200, 'a window\'s request with its body changed on the way: refused; as sent: kept', { changed: changedOnWay.status, asSent: asMeant.status })

  // ---------- The app's keys file it can't open ----------
  // (safeStorage stood in for: once working, once refused, as a denied Keychain prompt is.)
  const kdir = path.join(kit.dir, 'app-keys-test')
  fs.mkdirSync(kdir, { recursive: true })
  const works = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(`ENC:${t}`), decryptString: (b) => { const t = b.toString(); if (!t.startsWith('ENC:')) throw new Error('not ours'); return t.slice(4) } }
  const refuses = { ...works, decryptString: () => { throw new Error('Keychain access denied') } }
  const kf = path.join(kdir, 'signing-keys')
  const firstKeys = JSON.parse(windowAuth.keysAt(kf, works).forStart())
  const denied = windowAuth.keysAt(kf, refuses)
  const deniedStart = JSON.parse(denied.forStart())
  const asideNow = fs.existsSync(`${kf}.unreadable`) && !fs.existsSync(kf)
  const again = windowAuth.keysAt(kf, works)
  const againStart = JSON.parse(again.forStart())
  ok(denied.unreadable && deniedStart.unreadable && deniedStart.key === null && asideNow && againStart.key === firstKeys.key && againStart.window === firstKeys.window && !again.unreadable, 'the app\'s keys it can\'t open this time: moved aside, never written over, that run without a key (and said); the next run opens them again', { denied: { unreadable: deniedStart.unreadable, key: deniedStart.key }, asideNow, sameKeyAfter: againStart.key === firstKeys.key })

  // ---------- The helper itself, built for release (a Mac) ----------
  if (!IS_MAC) skip('native/bridgesign answers only Bridge AI', 'macOS only')
  else if (spawnSync('swiftc', ['--version']).status !== 0 && !process.env.CI) skip('native/bridgesign answers only Bridge AI', 'no swiftc here')
  else {
    const nb = path.join(kit.dir, 'release-bin')
    const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'calltap.js'), nb, '--only', 'bridgesign', '--strict', '--release'], { encoding: 'utf8' })
    const helper = path.join(nb, 'bridgesign')
    const key = fs.existsSync(helper) ? spawnSync(helper, ['key'], { encoding: 'utf8', timeout: 10000 }) : null // (no such thing now)
    const auth = fs.existsSync(helper) ? spawnSync(helper, ['auth'], { input: '{"reason":"sign x.pdf"}\n', encoding: 'utf8', timeout: 10000 }) : null
    const probe = fs.existsSync(helper) ? spawnSync(helper, ['probe'], { encoding: 'utf8', timeout: 10000 }) : null
    ok(built.status === 0 && key?.status === 2 && !/"key"/.test(key?.stdout || '') && /"code":"parent"/.test(auth?.stdout || '') && /"auth":false/.test(probe?.stdout || '') && /"parent":false/.test(probe?.stdout || ''), 'built for release, the helper holds no key, and asks for Touch ID only for Bridge AI: this test process gets neither', { built: built.status, key: key?.status, auth: auth?.stdout, probe: probe?.stdout })
    // Its parent check, with two throwaway certificates (made here, in a keychain file of the test's
    // own that's never on the keychain list, then deleted): the helper and one small parent signed
    // with one, another parent with the other. Same certificate: Bridge AI. The other: refused.
    const t = parentCheck(nb, kit.dir)
    if (t.skip) skip('the helper\'s parent check with throwaway certificates', t.skip)
    else ok(/"parent":true/.test(t.same) && /"auth":true/.test(t.same) && /"parent":false/.test(t.other) && /"auth":false/.test(t.other) && /"code":"parent"/.test(t.otherAuth), 'the helper\'s parent check: a parent signed with its own certificate is Bridge AI; one signed with another certificate is refused', t)
  }
  // The stand-in only in the tests: without BRIDGE_FIX_DRYRUN, BRIDGE_SIGNHELPER is never used.
  const prod = spawnSync(process.execPath, ['--input-type=module', '-e', `const { signBin } = await import(${JSON.stringify(path.join(ROOT, 'server', 'signhelper.js'))}); console.log(JSON.stringify(signBin()))`], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: kit.home, BRIDGE_HOME: kit.data, BRIDGE_SIGNHELPER: '/bin/echo' } })
  ok(prod.status === 0 && !/\/bin\/echo/.test(prod.stdout), 'outside the tests, the helper is never taken from the environment', prod.stdout + prod.stderr)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const c of links) c.close?.()
  kit.stop(); B_?.kit.stop(); C_?.kit.stop(); relay.stop()
}
process.exit(done().fail ? 1 : 0)

// Two throwaway code-signing certificates (openssl), in a keychain file of their own (security, never
// added to the keychain list), the release-built helper and two copies of a small parent (it starts
// what it's given and waits) signed with them (codesign), the helper run by each. Mac only, with
// Xcode's command line tools. { same, other, otherAuth } or { skip }.
function parentCheck(nb, dir) {
  const has = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).status === 0
  if (!has('/usr/bin/openssl', ['version']) || !has('/usr/bin/xcrun', ['--find', 'clang'])) return { skip: 'no openssl or Xcode\'s clang here' }
  const d = path.join(dir, 'parent-check')
  fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d)
  const run = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { cwd: d, encoding: 'utf8', ...o }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr || r.stdout}`); return r.stdout }
  const kc = path.join(d, 'test.keychain-db')
  // (The keychain list as it is, put back as it was after, whatever happens in between.)
  const listed = spawnSync('/usr/bin/security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' }).stdout.split('\n').map((l) => l.trim().replace(/^"|"$/g, '')).filter(Boolean)
  try {
    fs.writeFileSync(path.join(d, 'ext.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = Bridge AI Test\n[ext]\nbasicConstraints = critical,CA:false\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = critical,codeSigning\n')
    const hashes = {}
    for (const n of ['a', 'b']) {
      run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${n}.key`, '-out', `${n}.crt`, '-days', '2', '-config', 'ext.cnf', '-extensions', 'ext'])
      run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', `${n}.key`, '-in', `${n}.crt`, '-out', `${n}.p12`, '-passout', 'pass:test', '-name', `Bridge AI Test ${n}`])
      hashes[n] = run('/usr/bin/openssl', ['x509', '-in', `${n}.crt`, '-noout', '-fingerprint', '-sha1']).replace(/.*=/, '').replace(/:/g, '').trim()
    }
    run('/usr/bin/security', ['create-keychain', '-p', 'kc', kc])
    run('/usr/bin/security', ['unlock-keychain', '-p', 'kc', kc])
    for (const n of ['a', 'b']) run('/usr/bin/security', ['import', `${n}.p12`, '-k', kc, '-P', 'test', '-T', '/usr/bin/codesign'])
    run('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', 'kc', kc])
    fs.writeFileSync(path.join(d, 'parent.c'), '#include <spawn.h>\n#include <sys/wait.h>\nextern char **environ;\nint main(int argc, char **argv) { pid_t p; int s; if (argc < 2 || posix_spawn(&p, argv[1], 0, 0, argv + 1, environ)) return 127; waitpid(p, &s, 0); return WEXITSTATUS(s); }\n')
    run('/usr/bin/xcrun', ['clang', '-O2', '-o', 'parentA', 'parent.c'])
    fs.copyFileSync(path.join(d, 'parentA'), path.join(d, 'parentB'))
    fs.copyFileSync(path.join(nb, 'bridgesign'), path.join(d, 'helper'))
    run('/usr/bin/codesign', ['--force', '--sign', hashes.a, '--keychain', kc, 'helper'])
    run('/usr/bin/codesign', ['--force', '--sign', hashes.a, '--keychain', kc, 'parentA'])
    run('/usr/bin/codesign', ['--force', '--sign', hashes.b, '--keychain', kc, 'parentB'])
    const go = (parent, mode, input = '') => spawnSync(path.join(d, parent), [path.join(d, 'helper'), mode], { input, encoding: 'utf8', timeout: 10000 }).stdout
    // (auth only from the other certificate's parent: from Bridge AI's it would ask for Touch ID.)
    return { same: go('parentA', 'probe'), other: go('parentB', 'probe'), otherAuth: go('parentB', 'auth', '{"reason":"sign x.pdf"}\n') }
  } catch (e) {
    return { skip: `couldn't make throwaway certificates here: ${e.message.slice(0, 200)}` }
  } finally {
    spawnSync('/usr/bin/security', ['delete-keychain', kc])
    if (listed.length) spawnSync('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...listed])
  }
}
