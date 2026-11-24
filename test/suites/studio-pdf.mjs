// Studio's PDFs and AI Assist's Sign this, in the browser named by BRIDGE_TEST_BROWSER. PDFs made here
// with pdf-lib: an agreement (a page of terms, then a page with a form's signature field and date
// field), a letter with "Signature: ____" and "Date: ____" in its text, a page with no text, and a
// locked one. The server: Sign PDFs is part of Studio, with no Beta Feature to turn on; signatures
// and initials, several of each, kept sealed for you (no picture anywhere in the data folder, one
// from before sealed and the open one gone, the pictures for your own windows only), named, one the
// default, and removed; each place signed with the one it was given; Ask Before Signing (Touch ID,
// the Mac's password or the PIN, a stand-in for native/bridgesign): allowed, refused, the API without
// it refused, its grant for one document, used once, by the device that asked, and the setting itself
// changed only after asking; each signing in both files' versions ("Signed by you on … (Touch ID)");
// the trackpad's finger streamed (the stand-in's), only to this computer; Sign on Phone through the
// relay stand-in: only your phones let in are asked (a notification to them alone), the answer once,
// with its nonce, from a phone it went to (replayed, from another, or from one not let in: refused),
// cancelled on either side, and run out; the explanation asked of the model picked, with the
// document's text; a signed copy in _signed, the picture on the right page where it was put, the
// form's date field filled and its signature field done with, never over a copy that's there, the
// original untouched; a locked PDF and a mark off the page refused, saying why. The page: the PDF
// drawn by pdf.js with thumbnails, its text to select, find with matches marked, pages and zoom;
// AI Assist's Sign this (at the right end of the header), step by step: what you're signing (and
// which model read it), a signature drawn on the pad (a mouse; the trackpad, its ink drawn as it comes;
// your phone, through the relay, the pad over the phone's whole screen), several kept and picked,
// Sign everywhere it asks, Ask Before Signing as you save and the signing in the versions; Settings ›
// Studio; the pad's buttons never squeezed, in a narrow window, a wide one and on a phone, light and
// dark,
// the places found on their pages (the form's fields, the words next to a line), approved, and the
// signed copy saved and opened; in Focus, its pages with the whole window, still read-only; on a
// phone, all of it fitting.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { startKit, startModel, startRelay, checks, until, sleep, browser, page, shot, phoneFaults, noServiceWorker, rawFetch, ROOT, appKeysFor, windowHeader, windowFetch, asWindow as windowPage } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const { PDFDocument, StandardFonts, PDFName, PDFString, PDFSignature, PDFTextField, PDFRawStream, decodePDFRawStream, PDFArray } = require('pdf-lib')
const { ok, skip, done } = checks('studio-pdf')
// AI Assist's Sign this, from the right end of the PDF's header.
const signThis = async (pg) => {
  await pg.locator('.sd-file .pane-head button[aria-label="AI Assist"]').click()
  await pg.locator('.ai-menu button', { hasText: 'Sign this' }).click()
}
// A PNG of a stroke, made here (RGBA, a diagonal line), as the page's pad would send.
function png(w = 240, h = 80) {
  const crc = (buf) => zlib.crc32(buf) >>> 0
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(y - (x * h) / w) < 3) raw.writeUInt32BE(0x101820ff, y * (w * 4 + 1) + 1 + x * 4)
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`
}

// No Ollama or LM Studio of this computer's own: the models are only the stand-in, once it's added.
// native/bridgesign stood in for (stand-ins/bridgesign.cjs; not on Windows, where there's none),
// told what to do through bridgesign.json. A signature kept open, as before 3.22. A relay stand-in
// for the phones, push notifications written down, and Sign on Phone's 2 minutes 15 seconds here
// (BRIDGE_SIGN_PHONE_MS), to see one run out.
const IS_WIN = process.platform === 'win32'
const relay = await startRelay('studio-pdf')
let signState = null, signLog = null, pushLog = null
// The app's keys for this kit (given to its server at start, as the app gives them on a pipe): its
// window secret (WINDOW), the signatures' key and this start's own secret.
let keys = null, WINDOW = null
const kit = await startKit('studio-pdf', {
  env: ({ bin, data }) => {
    fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile))
    const sd = path.join(data, 'studio', 'signatures')
    fs.mkdirSync(sd, { recursive: true })
    fs.writeFileSync(path.join(sd, 'signature.png'), Buffer.from(png(200, 60).split(',')[1], 'base64'), { mode: 0o600 })
    fs.writeFileSync(path.join(sd, 'index.json'), JSON.stringify({ signature: { at: '2026-01-02T03:04:05.000Z', width: 200, height: 60 } }))
    signState = path.join(bin, 'bridgesign.json')
    signLog = path.join(bin, 'bridgesign.log')
    pushLog = path.join(bin, 'push.jsonl')
    keys = appKeysFor(bin, { store: 'keychain' })
    WINDOW = keys.window
    const env = { OLLAMA_HOST: 'http://127.0.0.1:9', LM_STUDIO_BASE_URL: 'http://127.0.0.1:9/v1', BRIDGE_COMPUTER_NAME: 'Studio Mac', BRIDGE_TEST_PUSH: pushLog, BRIDGE_SIGN_PHONE_MS: '15000', BRIDGE_TEST_WINDOW_FILE: keys.file }
    if (!IS_WIN) {
      fs.writeFileSync(path.join(bin, 'bridgesign'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'test', 'stand-ins', 'bridgesign.cjs')}" "$@"\n`, { mode: 0o755 })
      Object.assign(env, { BRIDGE_SIGNHELPER: path.join(bin, 'bridgesign'), BRIDGESIGN_STATE: signState, BRIDGESIGN_LOG: signLog })
    }
    return env
  },
})
const sign = (o) => fs.writeFileSync(signState, JSON.stringify(o))
// Each start of the helper: its arguments, and what it was told on stdin (said).
const signed1 = () => { try { return fs.readFileSync(signLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const pushes = () => { try { return fs.readFileSync(pushLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const model = await startModel('studio-pdf')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const err = (p, body, method) => api(p, body, method).then(() => null, (e) => e)
// As the app's own window asks (a MAC of its secret on each request, X-Bridge-Window:
// server/windowkey.js; the key is added by the harness): what signing takes. A page of the app's
// gets the same (asWindow).
const win = async (p, body, method) => {
  const r = await windowFetch(WINDOW)(`${kit.url}/api${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, j })
  return j
}
const werr = (p, body, method) => win(p, body, method).then(() => null, (e) => e)
const asWindow = (ctx) => windowPage(ctx, WINDOW)
const q = (f) => `root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`
const pages = []
const links = [] // the phones, through the relay
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const near = (a, b, by = 1.5) => Math.abs(a - b) <= by

// What a page of a PDF draws: its content streams' operators, as text.
async function drawn(file, n) {
  const doc = await PDFDocument.load(fs.readFileSync(file))
  const pg = doc.getPage(n - 1)
  const c = pg.node.Contents()
  const refs = c instanceof PDFArray ? c.asArray() : [c]
  return refs.map((r) => { const s = doc.context.lookup(r); return s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : Buffer.from(s.getContents?.() || []).toString('latin1') }).join('\n')
}
// A file opened in Studio, sent again until it shows (a page can take it before the app listens):
// its name in the header and its pages drawn, not the pages of the file shown before it, which are
// still there for a moment after it's asked for.
const openIn = (pg, root, name) => until(async () => {
  const head = pg.locator('.sd-file .pane-head h2', { hasText: name })
  if (!(await head.count())) await pg.evaluate(({ root, name }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: name } })), { root, name })
  return pg.locator('.sd-pdf .pdfViewer .page canvas').first().waitFor({ timeout: 2000 }).then(async () => (await head.count()) > 0, () => false)
}, 25000, 300)
// How much ink a pad's canvas has: its pixels with any paint on them.
const inked = (pg, sel) => pg.locator(sel).first().evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n })
// The buttons in a part of the page that are squeezed: their words on two lines, cut off, or the
// button narrower than its words. (The pad's buttons, at each width.)
const squeezed = (pg, scope) => pg.locator(scope).first().evaluate((root) => [...root.querySelectorAll('button, select, .btn')].filter((b) => b.offsetParent).map((b) => {
  // The lines its words take (its icon left out): each word's box, those more than half a line apart.
  const boxes = []
  const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent.trim()) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    boxes.push(...[...r.getClientRects()].filter((x) => x.width > 1))
  }
  const tops = boxes.map((x) => x.top).sort((x, y) => x - y)
  const lines = tops.length ? 1 + tops.slice(1).filter((t, i) => t - tops[i] > (boxes[0].height / 2)).length : 0
  return { text: b.innerText.trim() || b.getAttribute('aria-label') || b.tagName, lines, cut: b.scrollWidth > b.clientWidth + 1 }
}).filter((x) => x.lines > 1 || x.cut))
// The different pictures a page draws (one drawn twice is one), by the objects its names point to.
const pictures = async (file, n) => { const doc = await PDFDocument.load(fs.readFileSync(file)); const xo = doc.getPage(n - 1).node.Resources()?.lookup(PDFName.of('XObject')); return xo ? new Set(xo.keys().map((k) => String(xo.get(k)))).size : 0 }
const images = async (file, n) => { const doc = await PDFDocument.load(fs.readFileSync(file)); const xo = doc.getPage(n - 1).node.Resources()?.lookup(PDFName.of('XObject')); return xo ? xo.keys().length : 0 }

try {
  await api('/setup', { name: 'Tester' })
  // ---------- The files ----------
  const dir = path.join(kit.home, 'Deals')
  fs.mkdirSync(dir, { recursive: true })
  // An agreement: its terms, then a page to sign with a form's signature field and date field.
  const ag = await PDFDocument.create()
  const helv = await ag.embedFont(StandardFonts.Helvetica)
  const terms = ag.addPage([612, 792])
  const lines = ['Mutual Nondisclosure Agreement', '', 'This agreement is between Northwind Labs and Contoso Ltd.', 'Contoso Ltd pays a fee of $1,200 a year.', 'It renews automatically each year unless either side says no 30 days before.', 'Either party may end it with 30 days notice.']
  lines.forEach((l, i) => terms.drawText(l, { x: 72, y: 700 - i * 20, size: i ? 12 : 18, font: helv }))
  const sp = ag.addPage([612, 792])
  sp.drawText('Signed for Contoso Ltd', { x: 72, y: 260, size: 12, font: helv })
  const form = ag.getForm()
  const sig = ag.context.register(ag.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Signature1'), Rect: [100, 150, 300, 200], F: 4, P: sp.ref }))
  sp.node.addAnnot(sig)
  form.acroForm.addField(sig)
  const dateField = form.createTextField('Date')
  dateField.addToPage(sp, { x: 350, y: 160, width: 150, height: 20, font: helv })
  const dateRect = dateField.acroField.getWidgets()[0].getRectangle() // its border takes half a point each way
  fs.writeFileSync(path.join(dir, 'agreement.pdf'), await ag.save())
  // A letter: the places to sign only in its words.
  const le = await PDFDocument.create()
  const lf = await le.embedFont(StandardFonts.Helvetica)
  const lp = le.addPage([612, 792])
  lp.drawText('Please sign and return this letter.', { x: 72, y: 600, size: 12, font: lf })
  lp.drawText('Signature: ______________________', { x: 72, y: 200, size: 12, font: lf })
  lp.drawText('Date: ____________', { x: 340, y: 200, size: 12, font: lf })
  fs.writeFileSync(path.join(dir, 'letter.pdf'), await le.save())
  const letterSig = { x: 72 + lf.widthOfTextAtSize('Signature: ', 12), w: lf.widthOfTextAtSize('______________________', 12) }
  const letterDate = { x: 340 + lf.widthOfTextAtSize('Date: ', 12), w: lf.widthOfTextAtSize('____________', 12) }
  // A page with no words on it, as a scan would be.
  const sc = await PDFDocument.create()
  sc.addPage([612, 792]).drawRectangle({ x: 100, y: 100, width: 200, height: 100 })
  fs.writeFileSync(path.join(dir, 'scan.pdf'), await sc.save())
  // Locked: an encryption dictionary in its trailer.
  const lk = Buffer.from(await le.save({ useObjectStreams: false })).toString('latin1')
  fs.writeFileSync(path.join(dir, 'locked.pdf'), Buffer.from(lk.replace(/\nxref\n/, '\n99 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (aaaa) /U (bbbb) /P -4 >>\nendobj\nxref\n').replace(/trailer\n<</, 'trailer\n<< /Encrypt 99 0 R'), 'latin1'))
  const place = (await api('/places', { path: dir })).place
  const root = `place:${place.id}`
  // (With the PDF's SHA-256 as it is now, as the page sends what it showed: signing needs it.)
  const F = (p) => ({ root, path: p, ...(fs.existsSync(path.join(dir, p)) ? { sha256: sha(path.join(dir, p)) } : {}) })
  const before = sha(path.join(dir, 'agreement.pdf'))

  // ---------- The server ----------
  // Out of beta: no switch for it, and its routes answer from the start.
  ok(!('signature-assist' in ((await api('/config')).trials || {})), 'Sign PDFs isn\'t a Beta Feature', (await api('/config')).trials)
  // A signature kept open before 3.22: sealed the first time it's read, the open one gone.
  const sigDir = path.join(kit.data, 'studio', 'signatures')
  const old = await win('/studio/sign/setup')
  const oldOne = old.list?.find((x) => x.kind === 'signature')
  ok(!!oldOne && oldOne.width === 200 && oldOne.height === 60 && oldOne.default && !fs.existsSync(path.join(sigDir, 'signature.png')) && !fs.existsSync(path.join(sigDir, 'index.json')) && fs.existsSync(path.join(sigDir, `${oldOne.id}.bin`)), 'a signature kept open before: sealed the first time it\'s read, and the open picture gone', { list: old.list, files: fs.readdirSync(sigDir) })
  ok(old.sealed?.by === 'app' && old.sealed.store === 'keychain' && !fs.existsSync(path.join(sigDir, 'key')), 'sealed with the app\'s key (kept in its Keychain, given at start), none in the data folder', { sealed: old.sealed, files: fs.readdirSync(sigDir) })
  await win(`/studio/signatures/${oldOne.id}`, null, 'DELETE')
  // No model yet: it says so, and where to add one, rather than nothing.
  const none = await win('/studio/sign/setup')
  const noModel = await werr('/studio/sign/explain', { ...F('agreement.pdf'), pages: [{ n: 1, text: 'Terms' }] })
  ok(none.model === null && /No model to read it with.*Settings › Agents & Models › Model Providers/.test(noModel?.message || ''), 'no model to read with yet: said, with where to add one', { model: none.model, said: noModel?.message })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { model: 'openai:gpt-5' } }, 'PATCH')
  let setup = await win('/studio/sign/setup')
  ok(setup.signature === null && setup.initials === null && setup.model?.id === 'openai:gpt-5' && /gpt-5/.test(setup.model.label), 'turned on: nothing drawn yet, and the model it reads with is the one meeting notes use, by name', setup)
  ok(/Expected a drawing/.test((await werr('/studio/signature/signature', { png: 'data:image/png;base64,AAAA' }, 'PUT'))?.message || '') && !!(await werr('/studio/signature/stamp', { png: png() }, 'PUT')), 'what isn\'t a PNG drawing, or isn\'t a signature or initials, isn\'t kept')
  setup = await win('/studio/signature/signature', { png: png() }, 'PUT')
  const sigFile = path.join(sigDir, `${setup.signature?.id}.bin`)
  ok(setup.signature?.width === 240 && setup.signature?.height === 80 && fs.existsSync(sigFile) && (IS_WIN || (fs.statSync(sigFile).mode & 0o777) === 0o600), 'a signature kept in Bridge AI\'s data folder, sealed, for you alone to read', { setup, mode: fs.existsSync(sigFile) && (fs.statSync(sigFile).mode & 0o777).toString(8) })
  await win('/studio/signature/initials', { png: png(90, 60) }, 'PUT')
  const iniId = (await win('/studio/sign/setup')).initials?.id
  setup = await win('/studio/signature/initials', null, 'DELETE')
  ok(setup.initials === null && !fs.existsSync(path.join(sigDir, `${iniId}.bin`)) && !!setup.signature, 'initials removed: gone from the computer, the signature kept')
  // Sealed: no picture anywhere in the data folder, not as a PNG nor as the text the page sent; the
  // list sealed too (no name in the open).
  const plain = Buffer.from(png().split(',')[1], 'base64')
  // (Files only: the host's socket is in the data folder where its path is short enough.)
  const everything = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? everything(path.join(d, e.name)) : e.isFile() ? [path.join(d, e.name)] : []))
  const showing = everything(kit.data).filter((f) => { const b = fs.readFileSync(f); return b.includes(plain.subarray(0, 64)) || b.includes(Buffer.from(png().split(',')[1].slice(40, 140))) || (f.startsWith(sigDir) && (b.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47])) || b.includes(Buffer.from('Signature')))) })
  ok(!showing.length && fs.readFileSync(path.join(sigDir, 'store.bin')).subarray(0, 5).toString() === 'BSIG1', 'no signature in the open anywhere in the data folder: each picture and the list sealed (BSIG1)', showing)
  // The picture: to the app's own windows (their secret), never to the key alone (a program here,
  // MCP), nor the windows' cookie, which can be made from the key.
  const byKey = await fetch(`${kit.url}/api/studio/signature/${setup.signature.id}`)
  const byCookie = await rawFetch(`${kit.url}/api/studio/signature/${setup.signature.id}`, { headers: { cookie: `${kit.cookie.name}=${kit.cookie.value}` } })
  const picUrl = `${kit.url}/api/studio/signature/${setup.signature.id}`
  const byWindow = await windowFetch(WINDOW)(picUrl)
  const wrongWindow = await windowFetch(crypto.randomBytes(32).toString('base64url'))(picUrl)
  // The secret itself, as a window sent it before, isn't taken; nor a window's MAC used again, or for another request.
  const rawSecret = await fetch(picUrl, { headers: { 'x-bridge-window': WINDOW } })
  const once = windowHeader(WINDOW, 'GET', picUrl)
  const firstUse = await fetch(picUrl, { headers: { 'x-bridge-window': once } })
  const replayed = await fetch(picUrl, { headers: { 'x-bridge-window': once } })
  const elsewhere = await fetch(`${kit.url}/api/studio/signature/initials`, { headers: { 'x-bridge-window': windowHeader(WINDOW, 'GET', picUrl) } })
  ok(rawSecret.status === 403 && firstUse.status === 200 && replayed.status === 403 && elsewhere.status === 403, 'the window\'s MAC is for one request, once: not the secret itself, not used again, not for another path', { raw: rawSecret.status, first: firstUse.status, again: replayed.status, elsewhere: elsewhere.status })
  ok(byKey.status === 403 && byCookie.status === 403 && wrongWindow.status === 403 && byWindow.status === 200 && Buffer.from(await byWindow.arrayBuffer()).equals(plain), 'its picture only to the app\'s own windows: refused to the key alone, the windows\' cookie and a wrong window secret', { byKey: byKey.status, byCookie: byCookie.status, wrongWindow: wrongWindow.status, byWindow: byWindow.status })
  // What you're signing: the text the page read, to the model.
  const said = await win('/studio/sign/explain', { ...F('agreement.pdf'), pages: [{ n: 1, text: lines.join('\n') }, { n: 2, text: 'Signed for Contoso Ltd' }], total: 2, lang: 'en' })
  const asked = model.asked(/^Explain this document, which I have been asked to sign/).at(-1) || ''
  ok(said.model?.id === 'openai:gpt-5' && said.explained?.kind === 'Mutual NDA' && said.explained.parties.length === 2 && said.explained.watch[0]?.page === 1 && said.pagesRead === 2 && said.pagesAll === 2, 'explained by the model picked: what it is, who, and what to look at, with its page', said)
  ok(/--- Page 1 ---/.test(asked) && /renews automatically/.test(asked) && /--- Page 2 ---/.test(asked) && !/sk-test/.test(asked), "the model was sent the document's text, page by page", asked.slice(0, 400))
  const scanSaid = await werr('/studio/sign/explain', { ...F('scan.pdf'), pages: [{ n: 1, text: '' }] })
  if (setup.readsScans) skip('a scan with no text says so', 'this computer reads scans')
  else ok(/pictures of pages, with no text in it to read\. Bridge AI reads those on a Mac/.test(scanSaid?.message || ''), 'a PDF with no text in it: said, and that a Mac reads those', scanSaid?.message)
  // The signed copy, from the API.
  const letterBefore = sha(path.join(dir, 'letter.pdf'))
  const signed = await win('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46, align: 'left' }, { kind: 'date', page: 1, x: 375, y: 199, w: 80, h: 18, text: 'November 6, 2026' }] })
  const out1 = path.join(dir, '_signed', 'letter (signed).pdf')
  const ops = fs.existsSync(out1) ? await drawn(out1, 1) : ''
  // 240 by 80 in a 150 by 46 box: 138 by 46, on the left.
  ok(signed.path === '_signed/letter (signed).pdf' && fs.existsSync(out1) && sha(path.join(dir, 'letter.pdf')) === letterBefore, 'signed: a new PDF in _signed beside it, named (signed), the original untouched', signed)
  const hex = Buffer.from('November 6, 2026', 'latin1').toString('hex').toUpperCase()
  ok(await images(out1, 1) === 1 && /1 0 0 1 150 199 cm\n1 0 0 1 0 0 cm\n138 0 0 46 0 0 cm\n1 0 0 1 0 0 cm\n\/\S+ Do/.test(ops) && ops.includes(`<${hex}> Tj`), 'its signature drawn where it was put, as large as fits, and the date written', ops.slice(-600))
  const signed2 = await win('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46 }] })
  ok(signed2.name === 'letter (signed 2).pdf' && fs.existsSync(path.join(dir, '_signed', 'letter (signed 2).pdf')), 'signed again: (signed 2), never over the copy that\'s there', signed2)
  ok(/no page 3/.test((await werr('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'signature', page: 3, x: 1, y: 1, w: 50, h: 20 }] }))?.message || '') && /Draw your initials first/.test((await werr('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'initials', page: 1, x: 1, y: 1, w: 50, h: 20 }] }))?.message || ''), 'a place on a page it hasn\'t, or initials not drawn yet, refused with why')
  ok(/letters the PDF's own font can't write/.test((await werr('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'date', page: 1, x: 300, y: 100, w: 120, h: 18, text: '2026年11月6日' }] }))?.message || ''), 'a date its font can\'t write is refused, saying to use digits')
  const check = await win(`/studio/sign/check?${q(F('locked.pdf'))}`)
  const locked = await werr('/studio/sign', { ...F('locked.pdf'), marks: [{ kind: 'signature', page: 1, x: 100, y: 100, w: 100, h: 40 }] })
  ok(check.encrypted === true && /locked against changes/.test(locked?.message || '') && !fs.existsSync(path.join(dir, '_signed', 'locked (signed).pdf')), 'a locked PDF: known before, and signing it says why it can\'t', { check, locked: locked?.message })

  // ---------- Several signatures and initials ----------
  const formal = await win('/studio/signatures', { kind: 'signature', name: 'Formal', png: png(300, 70) })
  const short = await win('/studio/signatures', { kind: 'signature', png: png(160, 50) })
  const ini1 = await win('/studio/signatures', { kind: 'initials', name: 'SM', png: png(80, 50) })
  const ini2 = await win('/studio/signatures', { kind: 'initials', png: png(70, 40) })
  let all = (await win('/studio/sign/setup')).list
  const named = (id) => all.find((x) => x.id === id)
  ok(all.filter((x) => x.kind === 'signature').length === 3 && all.filter((x) => x.kind === 'initials').length === 2 && named(formal.id)?.name === 'Formal' && named(short.id)?.name === 'Signature 3' && named(ini2.id)?.name === 'Initials 2' && named(setup.signature.id)?.default && named(ini1.id)?.default, 'several signatures and initials kept, each named (a name of its own, or the next number), the first of each the default', all)
  await win(`/studio/signatures/${formal.id}`, { default: true, name: 'Formal one' }, 'PATCH')
  all = (await win('/studio/sign/setup')).list
  ok(named(formal.id)?.default && named(formal.id)?.name === 'Formal one' && !named(setup.signature.id)?.default && (await win('/studio/sign/setup')).signature?.id === formal.id, 'renamed, and made the default: the one new places get', all)
  // Each place with the one it was given; one not given any, the default.
  const many = await win('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'signature', page: 1, x: 100, y: 300, w: 150, h: 46, sig: short.id }, { kind: 'signature', page: 1, x: 100, y: 400, w: 150, h: 46 }, { kind: 'initials', page: 1, x: 400, y: 500, w: 60, h: 34, sig: ini2.id }, { kind: 'initials', page: 1, x: 400, y: 600, w: 60, h: 34 }, { kind: 'signature', page: 1, x: 300, y: 300, w: 150, h: 46, sig: short.id }] })
  const manyFile = path.join(dir, many.path)
  ok(await pictures(manyFile, 1) === 4 && await images(manyFile, 1) === 5 && many.marks === 5, 'five places, each with its own: four different pictures on the page (one used twice)', { pictures: await pictures(manyFile, 1), many })
  ok(!!(await werr('/studio/signatures', { kind: 'stamp', png: png() })) && !!(await werr('/studio/signatures/zzzzzzzzzz', { name: 'x' }, 'PATCH')), 'not a signature or initials, or no such one: refused')

  // ---------- Ask Before Signing ----------
  // (The stand-in for native/bridgesign: Touch ID that answers as bridgesign.json says.)
  if (IS_WIN) skip('Ask Before Signing with Touch ID', 'a Mac\'s, stood in for off Windows')
  else {
    sign({ auth: { ok: true, how: 'touchid' } })
    let st = await win('/studio/sign/ask')
    ok(st.on === false && st.way === 'device' && st.touchID === true && st.pin === false, 'Ask Before Signing: off until you turn it on; on this Mac it would ask for Touch ID', st)
    st = await win('/studio/sign/ask/setting', { on: true })
    ok(st.on === true, 'turned on')
    const noGrant = await werr('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46 }] })
    ok(noGrant?.status === 403 && noGrant.j?.code === 'ask', 'on: signing without asking first is refused, even straight to the API', { status: noGrant?.status, j: noGrant?.j })
    const beforeAsk = signed1().length
    const g = await win('/studio/sign/ask', { ...F('letter.pdf') })
    const asked = signed1().slice(beforeAsk)
    ok(g.needed && g.how === 'touchid' && typeof g.grant === 'string' && g.grant.length > 30 && asked.some((a) => a.args[0] === 'auth' && /^sign "letter\.pdf"$/.test(a.said?.reason || '') && !/letter/.test(a.args.join(' '))), 'asked: Touch ID on this Mac, for this document by name, and a grant for it', { g: { ...g, grant: !!g.grant }, asked })
    const withG = await win('/studio/sign', { ...F('letter.pdf'), grant: g.grant, marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46 }, { kind: 'initials', page: 1, x: 420, y: 100, w: 60, h: 34 }, { kind: 'date', page: 1, x: 375, y: 199, w: 80, h: 18, text: 'November 6, 2026' }] })
    ok(fs.existsSync(path.join(dir, withG.path)) && withG.record?.how === 'touchid' && withG.record?.on === 'Studio Mac' && withG.record.places.length === 3, 'with it: signed, every place at once, the record saying how', withG.record)
    const again = await werr('/studio/sign', { ...F('letter.pdf'), grant: g.grant, marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46 }] })
    ok(again?.status === 403, 'its grant used once: the same again is refused', again?.status)
    const g2 = await win('/studio/sign/ask', { ...F('agreement.pdf') })
    const other = await werr('/studio/sign', { ...F('letter.pdf'), grant: g2.grant, marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46 }] })
    ok(other?.status === 403, 'a grant for another document is refused', other?.status)
    sign({ auth: { ok: false, code: 'cancel', error: 'Canceled by user.' } })
    const no = await werr('/studio/sign/ask', { ...F('letter.pdf') })
    ok(no?.status === 401 && no.j?.code === 'cancelled', 'Touch ID cancelled: no grant, and it says so', { status: no?.status, j: no?.j })
    const offNo = await werr('/studio/sign/ask/setting', { on: false })
    ok(offNo?.status === 403 && (await win('/studio/sign/ask')).on === true, 'turning it off without asking first is refused: it stays on', offNo?.j)
    sign({ auth: { ok: true, how: 'password' } })
    // A PIN, for your phone: set once it's asked (here, the Mac's password).
    const pinG = await win('/studio/sign/ask', { purpose: 'settings' })
    st = await win('/studio/sign/ask/setting', { pin: '2468', grant: pinG.grant })
    ok(st.pin === true && pinG.how === 'password', 'a signing PIN set, once the Mac\'s password was asked')
    // Here, with Touch ID to ask, the PIN isn't taken in its place.
    const pinHere = await werr('/studio/sign/ask', { ...F('letter.pdf'), pin: '2468' })
    ok(pinHere?.status === 400 && pinHere.j?.code === 'use-device', 'the PIN isn\'t taken where Touch ID is the way', pinHere?.j)
    // The record, in both files' versions.
    const vOrig = await win(`/studio/versions?${q(F('letter.pdf'))}`)
    const vCopy = await win(`/studio/versions?${q(F(withG.path))}`)
    ok(vOrig.signings?.[0]?.how === 'touchid' && vOrig.signings[0].on === 'Studio Mac' && vOrig.signings[0].copy === withG.path && vOrig.signings[0].places.length === 3 && !!Date.parse(vOrig.signings[0].at), 'the original\'s versions: signed by you on Studio Mac with Touch ID, its places, the time and the copy', vOrig.signings?.[0])
    ok(vCopy.versions?.[0]?.by === 'signed' && vCopy.versions[0].signed?.how === 'touchid' && vCopy.versions[0].signed.places.length === 3, 'the copy\'s first version: signed, and how', vCopy.versions?.[0])
    const copySha = sha(path.join(dir, withG.path))
    ok(vOrig.signings[0].verified === true && vOrig.signings[0].via === 'window' && vOrig.signings[0].sha256 === copySha && vOrig.signings[0].fromSha256 === sha(path.join(dir, 'letter.pdf')) && vCopy.versions[0].signed.verified === true && vCopy.versions[0].kept === false, 'the record: which way it was signed (the app\'s window), the copy\'s and the original\'s sha256, its MAC checked; the copy\'s version a line, not a copy', { orig: vOrig.signings[0], copy: vCopy.versions[0] })
    // The record changed by hand in the versions' index: it says it can't be trusted.
    const idxFile = (await fs.promises.readdir(path.join(kit.data, 'studio', 'versions'), { recursive: true })).map((f) => path.join(kit.data, 'studio', 'versions', f)).find((f) => f.endsWith('index.json') && /"signed": \[/.test(fs.readFileSync(f, 'utf8')))
    const was = fs.readFileSync(idxFile, 'utf8')
    fs.writeFileSync(idxFile, was.replace('"how": "touchid"', '"how": "pin"'))
    const tampered = await win(`/studio/versions?${q(F('letter.pdf'))}`)
    fs.writeFileSync(idxFile, was)
    ok(tampered.signings[0].verified === false, 'a record changed outside Bridge AI: said not to be trusted', tampered.signings[0])
  }
  // No signed copy kept in Bridge AI's data folder (a signed copy's versions are lines, not copies).
  const signedHashes = new Set(fs.readdirSync(path.join(dir, '_signed')).map((f) => sha(path.join(dir, '_signed', f))))
  const keptCopies = everything(kit.data).filter((f) => signedHashes.has(sha(f)))
  ok(!keptCopies.length, 'no signed copy, byte for byte, anywhere in Bridge AI\'s data folder', keptCopies)

  // ---------- The trackpad (the stand-in's finger) ----------
  if (IS_WIN) skip('the trackpad streamed', 'a Mac\'s')
  else {
    sign({ trackpad: [{ d: [0.2, 0.5, 0] }, { m: [0.3, 0.4, 0] }, { m: [0.4, 0.6, 0.3] }, { u: 1 }, { done: true }], gap: 10 })
    // Only for the app's window; its hint is the server's own (in the page's language), whatever the
    // request says, and it goes to the helper on stdin, not in its arguments.
    const byKeyTp = await fetch(`${kit.url}/api/studio/sign/trackpad?hint=x`)
    const starts = signed1().filter((a) => a.args[0] === 'trackpad').length
    const r = await windowFetch(WINDOW)(`${kit.url}/api/studio/sign/trackpad?lang=de&hint=${encodeURIComponent('Something else')}`)
    const text = r.ok ? await r.text() : ''
    const tpRun = signed1().filter((a) => a.args[0] === 'trackpad')
    ok(byKeyTp.status === 403 && tpRun.length === starts + 1 && /^Zeichne mit einem Finger auf dem Trackpad/.test(tpRun.at(-1)?.said?.hint || '') && tpRun.at(-1).args.length === 1, 'the trackpad: not for a program with the key alone; its hint written by the server, in the page\'s language, given on stdin', { byKey: byKeyTp.status, run: tpRun.at(-1) })
    ok(r.status === 200 && /"ready":true,"w":160,"h":100/.test(text) && /"d":\[0\.2,0\.5,0\]/.test(text) && /"m":\[0\.4,0\.6,0\.3\]/.test(text) && /"u":1/.test(text) && /event: end\ndata: \{"done":true\}/.test(text), 'the trackpad: ready with its size, the finger down, moving (with pressure), lifted, and done, streamed as it comes', text.slice(0, 400))
    const setupHere = await win('/studio/sign/setup')
    ok(setupHere.trackpad === true, 'this Mac has a trackpad: Trackpad offered here')
  }

  // ---------- Sign on Phone, through the relay ----------
  await until(async () => (await api('/relay')).online, 20000)
  const pairPhone = async (name) => {
    const c = await linkAs(relay.url, { code: (await api('/relay/pair', {})).pairing.code, name, about: { name } })
    links.push(c)
    // (Paired once its first sealed message has come: kept then.)
    await until(() => api(`/relay/devices/${c.deviceId}/keep`, {}).then(() => true, () => false), 10000, 100)
    return c
  }
  const A = await pairPhone('Phone A')
  const B = await pairPhone('Phone B')
  const C = await pairPhone('Phone C')
  await A.request('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } }, label: 'Phone A' })
  await B.request('POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/b', keys: { p256dh: 'p', auth: 'b' } }, label: 'Phone B' })
  // B isn't let in any more (Which Devices May Connect).
  await api('/remote/devices', { id: B.deviceId, allowed: false })
  const reach = await until(async () => { const s2 = await win('/studio/sign/setup'); return s2.phones?.some((x) => x.id === A.deviceId) && s2.phones.some((x) => x.id === C.deviceId) ? s2 : null }, 15000)
  ok(!!reach && !reach.phones.some((x) => x.id === B.deviceId), 'the phones a pad can ask: yours, let in, and reachable; not one kept out', reach?.phones)
  const ink = { w: 600, h: 300, strokes: [[[0.1, 0.5, 2], [0.2, 0.4, 2.4], [0.35, 0.6, 2.1], [0.5, 0.45, 1.8]], [[0.6, 0.5, 2], [0.8, 0.52, 2]]] }
  const pushedBefore = pushes().length
  const ask1 = await win('/studio/sign/phone', { what: 'signature', doc: 'letter.pdf', to: A.deviceId })
  const toA = await A.request('GET', '/api/studio/sign/phone')
  const forA = toA.json?.list?.find((x) => x.id === ask1.id)
  const told = pushes().slice(pushedBefore).filter((x) => x.note?.kind === 'sign')
  ok(!!forA && forA.what === 'signature' && forA.doc === 'letter.pdf' && forA.computer === 'Studio Mac' && forA.nonce?.length > 20, 'asked: the phone it went to has it waiting, with what it\'s for and where from', toA.json)
  ok(told.length === 1 && told[0].device === A.deviceId && told[0].note.url === `/?sign=${ask1.id}` && /letter\.pdf/.test(told[0].note.body), 'a notification to that phone alone, opening the pad there', told)
  const toB = await B.request('GET', '/api/studio/sign/phone').catch((e) => ({ error: e.message }))
  ok(!toB.json?.list?.length && (toB.status === 403 || toB.gone || toB.error), 'a phone not let in sees none', toB)
  const fromC = await C.request('POST', `/api/studio/sign/phone/${ask1.id}/answer`, { nonce: forA.nonce, ink })
  const fromB = await B.request('POST', `/api/studio/sign/phone/${ask1.id}/answer`, { nonce: forA.nonce, ink }).catch((e) => ({ error: e.message }))
  const badNonce = await A.request('POST', `/api/studio/sign/phone/${ask1.id}/answer`, { nonce: 'x'.repeat(24), ink })
  const fromHere = await werr(`/studio/sign/phone/${ask1.id}/answer`, { nonce: forA.nonce, ink })
  // A program on this computer with the key, saying it's Phone A (without the relay's proof).
  const forged = await rawFetch(`${kit.url}/api/studio/sign/phone/${ask1.id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${kit.key}`, 'x-bridge-relay': A.deviceId }, body: JSON.stringify({ nonce: forA.nonce, ink }) })
  const forgedList = await rawFetch(`${kit.url}/api/studio/sign/phone`, { headers: { authorization: `Bearer ${kit.key}`, 'x-bridge-relay': A.deviceId } }).then((r) => r.json())
  ok(fromC.status === 404 && (fromB.status === 403 || fromB.gone || fromB.error) && badNonce.status === 409 && fromHere?.status === 404 && [403, 404].includes(forged.status) && !forgedList.list?.length, 'answered by a phone it didn\'t go to, one not let in, without its nonce, not by a phone at all, or by a program here naming the phone: refused', { fromC: fromC.status, fromB, badNonce: badNonce.status, fromHere: fromHere?.status, forged: forged.status, forgedList })
  const answered = await A.request('POST', `/api/studio/sign/phone/${ask1.id}/answer`, { nonce: forA.nonce, ink })
  const replay = await A.request('POST', `/api/studio/sign/phone/${ask1.id}/answer`, { nonce: forA.nonce, ink })
  const noPad = await werr(`/studio/sign/phone/${ask1.id}/state`)
  const st1 = await win(`/studio/sign/phone/${ask1.id}/state?pad=${ask1.pad}`)
  const st1b = await win(`/studio/sign/phone/${ask1.id}/state?pad=${ask1.pad}`)
  ok(noPad?.status === 404 && /^\d{4}$/.test(ask1.code) && forA.code === ask1.code, 'the ink only to the pad that asked (its own key), and the same code on both screens', { noPad: noPad?.status, code: ask1.code, phone: forA.code })
  ok(answered.status === 200 && replay.status === 409 && replay.json?.code === 'answered', 'answered once; the same answer again is refused', { answered: answered.status, replay: replay.json })
  ok(st1.state === 'answered' && st1.by === 'Phone A' && st1.ink?.strokes?.length === 2 && st1.ink.w === 600 && !st1b.ink, 'the pad that asked gets the ink, once, and who drew it', { st1: { ...st1, ink: !!st1.ink }, st1b })
  // Cancelled on the phone, and on the computer.
  const ask2 = await win('/studio/sign/phone', { what: 'initials', doc: 'letter.pdf' })
  const waits = win(`/studio/sign/phone/${ask2.id}/state?wait=1&pad=${ask2.pad}`)
  await A.request('POST', `/api/studio/sign/phone/${ask2.id}/cancel`, {})
  const st2 = await waits
  ok(st2.state === 'cancelled' && st2.cancelledBy === 'phone' && ask2.to.length === 2, 'cancelled on the phone: the pad hears it at once', { st2, to: ask2.to })
  const ask3 = await win('/studio/sign/phone', { what: 'signature', to: C.deviceId })
  await win(`/studio/sign/phone/${ask3.id}/cancel`, { pad: ask3.pad })
  const late = await C.request('POST', `/api/studio/sign/phone/${ask3.id}/answer`, { nonce: 'n'.repeat(24), ink })
  const cl = await C.request('GET', '/api/studio/sign/phone')
  ok(late.status === 409 && late.json?.code === 'cancelled' && !cl.json?.list?.some((x) => x.id === ask3.id), 'cancelled on the computer: gone from the phone, and an answer after is refused', { late: late.json, list: cl.json })
  // Run out (15 seconds here, 2 minutes for everyone).
  const ask4 = await win('/studio/sign/phone', { what: 'signature', to: A.deviceId })
  const n4 = (await A.request('GET', '/api/studio/sign/phone')).json?.list?.find((x) => x.id === ask4.id)?.nonce
  const out4 = await until(async () => { const s4 = await win(`/studio/sign/phone/${ask4.id}/state?wait=1&pad=${ask4.pad}`); return s4.state !== 'waiting' ? s4 : null }, 30000, 100)
  const tooLate = await A.request('POST', `/api/studio/sign/phone/${ask4.id}/answer`, { nonce: n4, ink })
  ok(out4?.state === 'expired' && tooLate.status === 409 && tooLate.json?.code === 'expired', 'not answered in time: it ends, and a late answer is refused', { out4, late: tooLate.json })
  // Asked from a phone (Ask Before Signing from there): its PIN, checked here.
  if (!IS_WIN) {
    const noPin = await A.request('POST', '/api/studio/sign/ask', { ...F('letter.pdf') })
    const wrongPin = await A.request('POST', '/api/studio/sign/ask', { ...F('letter.pdf'), pin: '1111' })
    const tooSoon = await A.request('POST', '/api/studio/sign/ask', { ...F('letter.pdf'), pin: '2468' })
    await sleep(1100) // (a wrong PIN: the next try waits a second, twice as long after each)
    const pinOk = await A.request('POST', '/api/studio/sign/ask', { ...F('letter.pdf'), pin: '2468' })
    ok(tooSoon.status === 429 && tooSoon.json?.code === 'pin-wait', 'right after a wrong PIN, even the right one waits a moment', tooSoon.json)
    // ...and not from a program on this computer naming the phone (without the relay's proof).
    const pinForged = await rawFetch(`${kit.url}/api/studio/sign/ask`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${kit.key}`, 'x-bridge-relay': A.deviceId }, body: JSON.stringify({ ...F('letter.pdf'), pin: '2468' }) })
    ok(pinForged.status === 403 && (await pinForged.json()).code === 'not-yours', 'a request only naming a phone can\'t ask with its PIN', pinForged.status)
    ok(noPin.status === 428 && noPin.json?.code === 'pin' && wrongPin.status === 401 && wrongPin.json?.code === 'pin-wrong' && wrongPin.json.left === 4 && pinOk.status === 200 && pinOk.json?.how === 'pin', 'from a phone: its signing PIN is asked for, a wrong one refused (tries left), the right one gives a grant', { noPin: noPin.json, wrongPin: wrongPin.json, pinOk: { ...pinOk.json, grant: !!pinOk.json?.grant } })
    const notHere = await werr('/studio/sign', { ...F('letter.pdf'), grant: pinOk.json.grant, marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46 }] })
    const pinG2 = await A.request('POST', '/api/studio/sign/ask', { ...F('letter.pdf'), pin: '2468' })
    const fromPhone = await A.request('POST', '/api/studio/sign', { ...F('letter.pdf'), grant: pinG2.json.grant, marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46 }] })
    ok(notHere?.status === 403 && fromPhone.status === 200 && fromPhone.json?.record?.how === 'pin' && fromPhone.json.record.on === 'Phone A', 'a phone\'s grant is the phone\'s: not used here; signed from the phone, the record says so', { notHere: notHere?.status, fromPhone: fromPhone.json?.record })
    // Off again, asked first.
    sign({ auth: { ok: true, how: 'touchid' } })
    const offG = await win('/studio/sign/ask', { purpose: 'settings' })
    const off = await win('/studio/sign/ask/setting', { on: false, grant: offG.grant })
    ok(off.on === false, 'turned off once it was asked')
  }

  // ---------- The page ----------
  const w = await page(b, kit.url, { width: 1440, height: 900, before: asWindow })
  pages.push(w)
  const p = w.p
  const logs = []
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text().slice(0, 300)) })
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await openIn(p, root, 'agreement.pdf')
  ok(!!(await until(async () => (await p.locator('.sd-pdf .pdfViewer .page canvas').count()) > 0 && (await p.locator('.sd-pdf-thumbs button').count()) === 2, 20000)), 'a PDF is drawn by pdf.js, with a thumbnail of each page', { errors: w.errors, html: (await p.locator('.sd-editor').innerHTML().catch(() => '')).slice(0, 400) })
  // Sharp: its canvas has the screen's own pixels (or more) for each CSS pixel.
  const sharp = await until(() => p.locator('.sd-pdf .pdfViewer .page canvas').first().evaluate((c) => { const r = c.width / c.getBoundingClientRect().width; return Number.isFinite(r) && r > 0 ? r : null }), 8000) || 0
  ok(sharp >= (await p.evaluate(() => devicePixelRatio)) - 0.05, `drawn at the screen's sharpness (${sharp.toFixed(2)} pixels a CSS pixel)`)
  ok(!!(await until(async () => /Northwind Labs/.test(await p.locator('.sd-pdf .textLayer').first().innerText().catch(() => '')), 10000)), 'its text is there to select, over the page')
  ok(!!(await until(async () => /2 pages/.test(await p.locator('.sd-status').innerText()) && /Read-only/.test(await p.locator('.sd-status').innerText()), 5000)), 'the status line: 2 pages, read-only', await p.locator('.sd-status').innerText())
  await p.locator('.sd-pdf-find input').fill('renews')
  ok(!!(await until(async () => /1 of 1/.test(await p.locator('.sd-pdf-hits').innerText()) && (await p.locator('.sd-pdf .textLayer .highlight').count()) > 0, 8000)), 'Find: the match counted and marked on the page', await p.locator('.sd-pdf-hits').innerText())
  await p.locator('.sd-pdf-find input').fill('')
  await p.locator('button[aria-label="Next page"]').click()
  ok(!!(await until(async () => (await p.locator('.sd-pdf-page').inputValue()) === '2' && (await p.locator('.sd-pdf-thumbs button.on').innerText()) === '2', 5000)), 'Next page: page 2, its thumbnail marked')
  await p.locator('.sd-pdf-zoomsel').selectOption('2')
  const wide = await until(async () => { const r = await p.locator('.sd-pdf .pdfViewer .page').first().evaluate((e) => e.getBoundingClientRect().width); return r > 1500 ? r : null }, 5000)
  await p.locator('.sd-pdf-zoomsel').selectOption('page-width')
  ok(!!wide, 'zoom: 200% makes the page twice as wide (816 px at 100%)', wide)
  await shot(p, `${tag}studio-pdf-view`)
  // In Focus: the whole window for its pages, still said to be read-only; Esc leaves.
  const viewW = () => p.locator('.sd-pdf-scroll').evaluate((e) => e.getBoundingClientRect().width)
  const vw0 = await viewW()
  await p.locator('.sd-file .pane-head .sd-focus-btn').click()
  const pdfFocus = () => p.locator('.sd-file.focus').count().then((n) => n === 1)
  ok(!!(await until(async () => (await pdfFocus()) && (await viewW()) > vw0 + 100, 5000, 100)) && /Read-only/.test(await p.locator('.sd-file.focus .sd-status').innerText()), 'a PDF in Focus: its pages have the whole window, and it still says read-only', { vw0, vw1: await viewW() })
  await shot(p, `${tag}studio-pdf-focus`)
  await p.keyboard.press('Escape')
  ok(!!(await until(async () => !(await pdfFocus()), 3000, 100)), 'Esc: out of Focus')
  // ---------- AI Assist's Sign this ----------
  const wand = p.locator('.sd-file .pane-head .pane-extras button[aria-label="AI Assist"]')
  ok(await wand.evaluate((e) => !e.nextElementSibling) && !(await p.locator('.sd-pdf-bar button', { hasText: /^\s*Sign\s*$/ }).count()), 'AI Assist at the right end of the header, and no Sign of its own in the PDF\'s toolbar')
  await wand.click()
  ok(/Sign this/.test(await p.locator('.ai-menu').innerText()), 'its menu on a PDF: Sign this', await p.locator('.ai-menu').innerText().catch(() => ''))
  await shot(p, `${tag}studio-pdf-ai-menu`)
  await p.locator('.ai-menu button', { hasText: 'Sign this' }).click()
  await p.locator('.sd-sign').waitFor({ timeout: 10000 })
  ok(/AI Assist/.test(await p.locator('.sd-sign-head').innerText()) && /Sign this/.test(await p.locator('.sd-sign-head').innerText()) && !/\bBeta\b/.test(await p.locator('.sd-sign-head').innerText()), 'its panel says it\'s AI Assist, signing this, with no Beta badge', await p.locator('.sd-sign-head').innerText().catch(() => ''))
  ok(/gpt-5/.test(await p.locator('.sd-model select').evaluate((s) => s.options[s.selectedIndex]?.text || '')) && /Its text goes to gpt-5/.test(await p.locator('.sd-sent').innerText()), "What you're signing: it says which model reads it, and that the text goes to it", await p.locator('.sd-sign').innerText())
  await shot(p, `${tag}studio-sign-start`)
  await p.locator('.sd-explain button', { hasText: 'Explain it' }).click()
  ok(!!(await until(async () => /Mutual NDA/.test(await p.locator('.sd-explained').innerText().catch(() => '')), 15000)), 'explained: what it is, in plain words')
  const ex = await p.locator('.sd-explained').innerText()
  ok(/Northwind Labs/.test(ex) && /\$1,200/.test(ex) && /renews by itself/i.test(ex) && /Worth a closer look/i.test(ex) && /Read by gpt-5/.test(ex) && /isn.t legal advice/.test(ex), 'who, the money, renewal, what to look at, and which model read it, with no claim of legal advice', ex)
  await p.locator('.sd-watch .link-btn').first().click()
  ok(!!(await until(async () => (await p.locator('.sd-pdf .textLayer .highlight').count()) > 0 && (await p.locator('.sd-pdf-page').inputValue()) === '1', 8000)), 'what to look at: a tap shows it on its page, marked')
  await shot(p, `${tag}studio-sign-explained`)
  await p.locator('.sd-explained button', { hasText: 'Next: where to sign' }).click()
  // The places: the form's signature field and its date field, in the PDF's own points.
  const marks = async () => p.locator('.sd-mark').evaluateAll((els) => els.map((e) => ({ kind: e.dataset.kind, page: Number(e.dataset.page), box: e.dataset.box.split(',').map(Number) })))
  const got = await until(async () => { const m = await marks(); return m.length === 2 ? m : null }, 15000)
  const fieldSig = got?.find((m) => m.kind === 'signature'), fieldDate = got?.find((m) => m.kind === 'date')
  ok(!!fieldSig && fieldSig.page === 2 && JSON.stringify(fieldSig.box) === '[100,150,200,50]' && !!fieldDate && JSON.stringify(fieldDate.box) === JSON.stringify([dateRect.x, dateRect.y, dateRect.width, dateRect.height]), "where to sign, from the form: its signature field and date field, on page 2, where they are", got || { said: await p.locator('.sd-place').innerText().catch(() => ''), errors: w.errors, console: logs.slice(-8) })
  ok(/2 places to sign/.test(await p.locator('.sd-found').innerText()) && /Its form's own field/.test(await p.locator('.sd-places').innerText()), 'it says how many, and where each came from', await p.locator('.sd-place').innerText())
  // The signature is drawn already (above); draw it again on the pad, as you would.
  await p.locator('.sd-place .sd-sigcard button', { hasText: 'Draw again' }).click()
  const pad = await p.locator('.sd-pad-canvas').boundingBox()
  await p.mouse.move(pad.x + 30, pad.y + 90)
  await p.mouse.down()
  for (let i = 0; i <= 30; i++) await p.mouse.move(pad.x + 30 + i * 8, pad.y + 90 - Math.sin(i / 4) * 30, { steps: 2 })
  await p.mouse.up()
  await shot(p, `${tag}studio-sign-pad`)
  await p.locator('.sd-pad button', { hasText: 'Keep it' }).click()
  const kept = await until(async () => { const s = await win('/studio/sign/setup'); return s.signature?.at !== setup.signature.at && s.signature?.width > 400 ? s.signature : null }, 8000)
  // (The server has it a moment before the page has its answer and shows it.)
  const shown = await until(async () => (await p.locator('.sd-place .sd-sigcard img').count()) === 1, 5000)
  ok(!!kept && kept.width > 400 && shown,'a signature drawn on the pad with the mouse, kept sharp (three times its size), and shown', kept)
  await p.locator('.sd-places li').first().locator('button', { hasText: 'Approve' }).click()
  await p.locator('.sd-places li').nth(1).locator('button', { hasText: 'Approve' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-mark.ok').count()) === 2, 5000)), 'each approved: shown on the page as it will be')
  await shot(p, `${tag}studio-sign-places`)
  await p.locator('.sd-place button', { hasText: 'Next: save a signed copy' }).click()
  await p.locator('.sd-save').waitFor({ timeout: 5000 })
  const saveText = await p.locator('.sd-save').innerText()
  ok(/1 signature, 1 date, on page 2/.test(saveText) && /agreement \(signed\)\.pdf/.test(saveText) && /original stays as it is/.test(saveText) && /simple electronic signature/.test(await p.locator('.sd-sign-honest').innerText()) && /isn.t a certificate-based digital signature/.test(await p.locator('.sd-sign-honest').innerText()), 'before saving: what goes where, the copy\'s name, the original kept, and that it\'s a drawn signature, not a digital one', saveText)
  await shot(p, `${tag}studio-sign-save`)
  // Changed on disk since the page showed it (an agent in that folder, say): nothing signed, and
  // Sign this says why. Put back, it signs.
  const out2 = path.join(dir, '_signed', 'agreement (signed).pdf')
  const agreementFile = path.join(dir, 'agreement.pdf')
  const agreementWas = fs.readFileSync(agreementFile)
  fs.appendFileSync(agreementFile, '\n% changed by something else\n')
  await p.locator('.sd-save button', { hasText: 'Sign and save a copy' }).click()
  const changedSaid = await until(async () => /The PDF changed since it was shown here/.test(await p.locator('.sd-save').innerText().catch(() => '')), 8000)
  fs.writeFileSync(agreementFile, agreementWas)
  ok(!!changedSaid && !fs.existsSync(out2), 'the PDF changed on disk after it was shown: nothing signed, and Sign this says why', await p.locator('.sd-save').innerText().catch(() => ''))
  await p.locator('.sd-save button', { hasText: 'Sign and save a copy' }).click()
  ok(!!(await until(async () => fs.existsSync(out2) && /agreement \(signed\)\.pdf/.test(await p.locator('.sd-file .pane-head h2').innerText().catch(() => '')), 15000)), 'Sign and save: the copy in _signed, opened in Studio', await p.locator('.sd-file .pane-head').innerText().catch(() => ''))
  const sd = fs.existsSync(out2) ? await PDFDocument.load(fs.readFileSync(out2)) : null
  const fields = sd ? sd.getForm().getFields() : []
  ok(!!sd && await images(out2, 2) === 1 && await images(out2, 1) === 0 && !fields.some((f) => f instanceof PDFSignature) && fields.find((f) => f instanceof PDFTextField && f.getName() === 'Date')?.getText()?.length > 5 && sha(path.join(dir, 'agreement.pdf')) === before, 'the copy: the signature on page 2 only, the signature field done with, the date in its field; the original untouched', fields.map((f) => [f.getName(), f.constructor.name, f.getText?.()]))
  await shot(p, `${tag}studio-sign-opened`)
  // The letter: its places only in its words, beside the lines.
  await openIn(p, root, 'letter.pdf')
  if (!(await p.locator('.sd-sign').count())) await signThis(p)
  await p.locator('.sd-step-head', { hasText: 'Where to sign' }).click()
  const lm = await until(async () => { const m = await marks(); return m.length === 2 ? m : null }, 15000)
  const ls = lm?.find((m) => m.kind === 'signature'), ld = lm?.find((m) => m.kind === 'date')
  ok(!!ls && near(ls.box[0], letterSig.x) && near(ls.box[1], 200 - 1.44 + 0.5, 1) && near(ls.box[2], letterSig.w) && ls.box[3] === 46 && !!ld && near(ld.box[0], letterDate.x) && near(ld.box[2], letterDate.w) && ld.box[3] === 18, `"Signature: ____" and "Date: ____": a box on each line, as wide as the line (signature at ${letterSig.x.toFixed(1)}, date at ${letterDate.x.toFixed(1)})`, lm)
  ok(/Next to "Signature"/.test(await p.locator('.sd-places').innerText()) && /Next to "Date"/.test(await p.locator('.sd-places').innerText()), 'and it says the words it found each by', await p.locator('.sd-places').innerText())
  // Moved with the keyboard: a point at a time.
  await p.locator('.sd-mark[data-kind="signature"]').focus()
  await p.keyboard.press('ArrowRight')
  await p.keyboard.press('Shift+ArrowUp')
  const moved = (await marks()).find((m) => m.kind === 'signature')
  ok(near(moved.box[0], ls.box[0] + 1, 0.15) && near(moved.box[1], ls.box[1] + 10, 0.15), 'the arrow keys move the one picked: a point, and ten with shift', moved)
  await shot(p, `${tag}studio-sign-letter`)
  // Added by hand, on the page in view, and taken away again.
  await p.locator('.sd-add button', { hasText: 'Initials' }).click()
  ok(!!(await until(async () => (await marks()).some((m) => m.kind === 'initials' && m.page === 1), 3000)) && (await p.locator('.sd-place .sd-sigcard[data-kind="initials"] img').count()) === 1 && (await p.locator('.sd-place .sd-sigcard[data-kind="initials"] select option').count()) === 2, 'Add Initials: a place on the page, and your initials beside it, with the other ones to pick')
  await p.locator('.sd-places li', { hasText: 'Initials' }).locator('button[aria-label="Take this place away"]').click()
  ok(!!(await until(async () => !(await marks()).some((m) => m.kind === 'initials'), 3000)), 'taken away again')
  // Studio's home, at Your Signatures in its sidebar: your signatures, kept here, to draw again or
  // remove. While it's still asking the server, it says neither "not drawn yet" nor offers a pad
  // (the answer held back here; only Chromium takes a route added after the page opened).
  const slow = which === 'chromium' ? async (r) => { await sleep(1500); await r.fallback().catch(() => {}) } : null
  if (slow) await p.context().route('**/api/studio/sign/setup*', slow)
  await p.locator('.sd-file .sd-tabs [role="tab"]', { hasText: 'Files' }).click()
  await p.locator('.fx-side-row[data-shelf="signature"]').click({ timeout: 10000 })
  if (slow) {
    await p.locator('.sd-sign-home[aria-busy="true"]').waitFor({ timeout: 10000 })
    const waiting = await p.locator('.sd-sign-home').innerText()
    ok(!/Not drawn yet/.test(waiting) && !(await p.locator('.sd-sign-home .sd-pad, .sd-sign-home button', { hasText: /Draw/ }).count()), 'before it knows: no "not drawn yet", nothing to draw on', waiting)
    await p.context().unroute('**/api/studio/sign/setup*', slow)
  } else skip('before it knows, nothing half-ready', 'WebKit takes no route added after the page opened')
  // Read once it knows what's drawn (it asks the server after it shows).
  await p.locator('.sd-sign-home[aria-busy="false"]').waitFor({ timeout: 10000 })
  const homeText = await p.locator('.sd-sign-home').innerText()
  const savedNow = (await win('/studio/sign/setup')).list
  ok((await p.locator('.sd-sign-home .sd-saved-sig img').count()) === savedNow.length && savedNow.length >= 5 && /Kept only on this computer, sealed/.test(homeText) && /Formal one/.test(homeText) && (await p.locator('.sd-sign-home .sd-saved-sig.default').count()) === 2 && (await p.locator('.sd-sign-home .sd-saved-sig button[aria-label^="Remove "]').count()) === savedNow.length, "Studio's home: Your Signatures, every signature and initials with its name, the default of each starred, where they're kept, and Remove", homeText)
  // Every picture shows (the app's window): none broken.
  ok(!!(await until(() => p.locator('.sd-sign-home .sd-saved-sig img').evaluateAll((els) => els.every((i) => i.complete && i.naturalWidth > 0)), 5000)), 'each picture shown in its own window')
  // Made the default here, and renamed in place.
  const shortRow = p.locator(`.sd-saved-sig[data-sig="${short.id}"]`)
  await shortRow.locator('button[aria-label="Make default"]').click()
  await shortRow.locator('.sd-sig-title').click()
  await shortRow.locator('input.sd-sig-name').fill('Quick')
  await shortRow.locator('input.sd-sig-name').press('Enter')
  const madeDefault = await until(async () => { const l = (await win('/studio/sign/setup')).list; const x = l.find((y) => y.id === short.id); return x?.default && x.name === 'Quick' ? l : null }, 5000)
  ok(!!madeDefault && (await shortRow.getAttribute('class')).includes('default'), 'Make default and a new name, from the list', madeDefault)
  await p.locator('.sd-sign-home').scrollIntoViewIfNeeded()
  await shot(p, `${tag}studio-sign-home`)
  ok(!(await squeezed(p, '.sd-sign-home')).length, 'the list\'s buttons: none squeezed', await squeezed(p, '.sd-sign-home'))
  // ---------- The pad, three ways ----------
  // A new signature from Sign this: Draw, Trackpad (this Mac has one: the stand-in's) and Phone (your
  // phones let in, through the relay).
  await openIn(p, root, 'letter.pdf')
  if (!(await p.locator('.sd-sign').count())) await signThis(p)
  await p.locator('.sd-step-head', { hasText: 'Where to sign' }).click().catch(() => {})
  const addSig = () => p.locator('.sd-place .sd-sigcard[data-kind="signature"] button[aria-label="Add a signature"]').click()
  await addSig()
  await p.locator('.sd-place .sd-pad .sd-pad-modes').waitFor({ timeout: 10000 })
  const modes = await p.locator('.sd-place .sd-pad-modes [role="tab"]').allInnerTexts()
  ok(IS_WIN ? modes.map((x) => x.trim()).join('|') === 'Draw|Phone' : modes.map((x) => x.trim()).join('|') === 'Draw|Trackpad|Phone', `the pad's ways: ${IS_WIN ? 'Draw and Phone (no trackpad on Windows)' : 'Draw, Trackpad and Phone'}`, modes)
  ok(!(await squeezed(p, '.sd-place .sd-pad')).length, 'wide window: the pad\'s buttons, none squeezed', await squeezed(p, '.sd-place .sd-pad'))
  await p.locator('.sd-place .sd-sigcard.drawing').scrollIntoViewIfNeeded()
  await shot(p, `${tag}studio-sign-pad-modes`)
  // A narrow window: the panel narrower, the buttons on lines of their own, never squeezed.
  await p.setViewportSize({ width: 980, height: 800 })
  await sleep(400)
  const narrowSq = await squeezed(p, '.sd-place .sd-pad')
  const rows = await p.locator('.sd-place .sd-pad-acts').evaluate((e) => { const a = e.querySelector('.sd-pad-tools').getBoundingClientRect(), b = e.querySelector('.sd-pad-done').getBoundingClientRect(); return { a: Math.round(a.top), b: Math.round(b.top), right: Math.round(e.getBoundingClientRect().right - b.right) } })
  ok(!narrowSq.length && rows.right <= 1, 'narrow window: the pad\'s buttons, none squeezed; Cancel and Keep it at the end of their line', { narrowSq, rows })
  await shot(p, `${tag}studio-sign-pad-narrow`)
  await p.setViewportSize({ width: 1440, height: 900 })
  if (!IS_WIN) {
    // The trackpad: the stand-in's finger, drawn as it comes; a key (its "done") finishes.
    const swirl = Array.from({ length: 50 }, (_, i) => ({ m: [0.15 + i * 0.014, 0.55 - Math.sin(i / 6) * 0.2, 0] }))
    sign({ trackpad: [{ d: [0.15, 0.55, 0] }, ...swirl, { u: 1 }, { d: [0.3, 0.75, 0] }, { m: [0.6, 0.72, 0] }, { m: [0.8, 0.74, 0] }, { u: 1 }, { done: true }], gap: 30 })
    await p.locator('.sd-place .sd-pad-modes [role="tab"]', { hasText: 'Trackpad' }).click()
    ok(/one finger draws/.test(await p.locator('.sd-place .sd-pad-how').innerText()), 'Trackpad: what it does, before it starts', await p.locator('.sd-place .sd-pad-how').innerText())
    await p.locator('.sd-place .sd-pad button', { hasText: 'Start on the trackpad' }).click()
    const listening = await until(async () => (await p.locator('.sd-place .sd-pad-box.listening').count()) && (await inked(p, '.sd-place .sd-pad-canvas')) > 50, 8000, 50)
    ok(!!listening && /press any key when done/.test(await p.locator('.sd-place .sd-pad-how').innerText()), 'listening: the ink drawn live as the finger moves, and how to finish', await p.locator('.sd-place .sd-pad-how').innerText())
    await shot(p, `${tag}studio-sign-trackpad`)
    const ended = await until(async () => !(await p.locator('.sd-place .sd-pad-box.listening').count()), 10000, 100)
    const ink1 = await inked(p, '.sd-place .sd-pad-canvas')
    ok(!!ended && ink1 > 300 && await p.locator('.sd-place .sd-pad button', { hasText: 'Keep it' }).isEnabled(), 'done (a key): both strokes on the pad, to keep', ink1)
    const n0 = (await win('/studio/sign/setup')).list.length
    await p.locator('.sd-place input.sd-sig-name').fill('From the trackpad')
    await p.locator('.sd-place .sd-pad button', { hasText: 'Keep it' }).click()
    ok(!!(await until(async () => (await win('/studio/sign/setup')).list.find((x) => x.name === 'From the trackpad' && x.width > 300), 8000)) && (await win('/studio/sign/setup')).list.length === n0 + 1, 'kept, with the name given', (await win('/studio/sign/setup')).list.map((x) => x.name))
    // A phone asking for the trackpad: refused (it's this computer's).
    const tpPhone = await A.request('GET', '/api/studio/sign/trackpad')
    ok(tpPhone.status === 403, 'the trackpad isn\'t offered to a phone', tpPhone.status)
    await addSig()
  }
  // Sign on Phone: asked from the pad, answered by Phone A (through the relay), the ink back here.
  await p.locator('.sd-place .sd-pad-modes [role="tab"]', { hasText: 'Phone' }).click()
  await p.locator('.sd-place select.sd-pad-to').selectOption({ label: 'Phone A' })
  await p.locator('.sd-place .sd-pad button', { hasText: 'Sign on Phone' }).click()
  const req = await until(async () => (await A.request('GET', '/api/studio/sign/phone')).json?.list?.[0], 8000, 200)
  await until(async () => /Waiting for Phone A/.test(await p.locator('.sd-place .sd-pad-how').innerText()), 5000)
  ok(!!req && /Waiting for Phone A/.test(await p.locator('.sd-place .sd-pad-how').innerText()) && (await p.locator('.sd-place .sd-pad-box.waiting').count()) === 1, 'Sign on Phone: the phone has it, and the pad waits for it, the time left shown', { req, how: await p.locator('.sd-place .sd-pad-how').innerText() })
  await shot(p, `${tag}studio-sign-phone-waiting`)
  await A.request('POST', `/api/studio/sign/phone/${req.id}/answer`, { nonce: req.nonce, ink: { w: 600, h: 260, strokes: [[[0.1, 0.6, 2.4], [0.25, 0.35, 2.6], [0.4, 0.65, 2], [0.55, 0.4, 1.8], [0.7, 0.62, 2.2]], [[0.2, 0.8, 1.6], [0.85, 0.78, 1.6]]] } })
  const back = await until(async () => /From Phone A/.test(await p.locator('.sd-place .sd-pad-how').innerText()) && (await inked(p, '.sd-place .sd-pad-canvas')) > 200, 30000, 100)
  ok(!!back, 'answered: its ink on the pad here, said to be from Phone A', await p.locator('.sd-place .sd-pad-how').innerText())
  await shot(p, `${tag}studio-sign-phone-back`)
  await p.locator('.sd-place .sd-pad button', { hasText: 'Keep it' }).click()
  ok(!!(await until(async () => (await win('/studio/sign/setup')).list.some((x) => x.kind === 'signature' && /^Signature \d+$/.test(x.name) && Date.parse(x.at) > req.until - 20000), 8000)), 'and kept from there, as any')
  // ---------- Settings › Studio ----------
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'studio' } })))
  await p.locator('.st-sec[data-setting="ask-before-signing"] .st-check').waitFor({ timeout: 10000 })
  await sleep(400) // (faded in)
  const stText = await p.locator('.modal.settings').innerText()
  ok(/Your Signatures/.test(stText) && /Ask Before Signing/.test(stText) && (await p.locator('.modal.settings .sd-saved-sig').count()) >= 6 && (IS_WIN || /Touch ID/.test(stText)), 'Settings › Studio: your signatures, and Ask Before Signing, saying how this computer asks', stText.slice(0, 600))
  if (!IS_WIN) {
    sign({ auth: { ok: true, how: 'touchid' } })
    await p.locator('.st-sec[data-setting="ask-before-signing"] .st-check input').click()
    ok(!!(await until(async () => (await win('/studio/sign/ask')).on, 5000)) && !!(await until(() => p.locator('.st-sec[data-setting="ask-before-signing"] .st-check input').isChecked(), 5000)), 'turned on from Settings, and shown on')
    await shot(p, `${tag}studio-settings-signing`)
    await until(async () => p.locator('.st-sec[data-setting="ask-before-signing"] .st-check input').isChecked(), 5000)
    await p.locator('.st-sec[data-setting="ask-before-signing"] .st-check input').click()
    ok(!!(await until(async () => !(await win('/studio/sign/ask')).on, 8000)) && signed1().filter((a) => a.args[0] === 'auth').length >= 1, 'and off again, Touch ID asked first')
  }
  ok(!(await squeezed(p, '.modal.settings .st-scroll')).length, 'Settings › Studio: no button squeezed', await squeezed(p, '.modal.settings .st-scroll'))
  await p.keyboard.press('Escape')
  ok(w.errors.length === 0, 'no page errors', w.errors)
  // Dark, and Sign this picked while the PDF is still opening (its reader held back here): signing
  // starts once it's open.
  let readerGo
  const reader = new Promise((r) => { readerGo = r })
  const dk = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark', before: async (ctx) => { await asWindow(ctx); await noServiceWorker(ctx); await ctx.route(/\/assets\/pdf_viewer-[\w-]+\.js$/, async (r) => { await reader; await r.continue().catch(() => {}) }) } })
  pages.push(dk)
  await dk.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const opening = await until(async () => {
    if (!(await dk.p.locator('.sd-file .pane-head h2', { hasText: 'letter.pdf' }).count())) await dk.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'letter.pdf' } })), { root })
    return dk.p.locator('.sd-pdf .sd-pdf-cover.sd-loading').waitFor({ timeout: 2000 }).then(() => true, () => false)
  }, 25000, 300)
  await dk.p.locator('.sd-file .pane-head button[aria-label="AI Assist"]').click()
  const early = dk.p.locator('.ai-menu button', { hasText: 'Sign this' })
  const pickable = await early.isEnabled({ timeout: 5000 }).catch(() => false)
  if (pickable) await early.click()
  readerGo()
  ok(!!opening && pickable && await dk.p.locator('.sd-sign').waitFor({ timeout: 15000 }).then(() => true, () => false) && await dk.p.locator('.sd-pdf .pdfViewer .page canvas').first().waitFor({ timeout: 15000 }).then(() => true, () => false), 'dark: Sign this, picked while the PDF is still opening, starts signing once it\'s open', { opening, pickable, errors: dk.errors })
  await dk.p.locator('.sd-step-head', { hasText: 'Where to sign' }).click()
  await until(async () => (await dk.p.locator('.sd-mark').count()) === 2, 15000)
  await sleep(400)
  await shot(dk.p, `${tag}studio-sign-dark`)
  // Sign everywhere it asks: each place it found approved at once.
  await dk.p.locator('.sd-all button', { hasText: 'Sign everywhere it asks' }).click()
  ok(!!(await until(async () => (await dk.p.locator('.sd-mark.ok').count()) === 2, 5000)) && /2 places approved|Approved/.test(await dk.p.locator('.sd-place').innerText()), 'Sign everywhere it asks: every place it found approved at once')
  // Another of yours for one place: picked on the page.
  await dk.p.locator('.sd-mark[data-kind="signature"]').click()
  const markSel = dk.p.locator('.sd-mark[data-kind="signature"] select.sd-mark-sig')
  await markSel.selectOption({ label: 'Formal one' })
  ok(/Formal one/.test(await dk.p.locator('.sd-places').innerText()), 'one place given another of your signatures: said beside it', await dk.p.locator('.sd-places').innerText())
  // Ask Before Signing, as you save: Touch ID, once, then the record.
  if (!IS_WIN) {
    // (Turned on after Sign this opened: the last step reads it as it is.)
    await win('/studio/sign/ask/setting', { on: true })
    sign({ auth: { ok: true, how: 'touchid' } })
  }
  await dk.p.locator('.sd-place button', { hasText: 'Next: save a signed copy' }).click()
  await dk.p.locator('.sd-save').waitFor({ timeout: 5000 })
  if (!IS_WIN) {
    await until(async () => /Touch ID/.test(await dk.p.locator('.sd-save button.primary').innerText()), 5000)
    ok(/Sign with Touch ID/.test(await dk.p.locator('.sd-save button.primary').innerText()) && /Touch ID is asked once, for every place/.test(await dk.p.locator('.sd-save').innerText()), 'Ask Before Signing on: Sign with Touch ID, asked once for every place', await dk.p.locator('.sd-save').innerText())
    await shot(dk.p, `${tag}studio-sign-ask-dark`)
    await dk.p.locator('.sd-save button', { hasText: 'Sign with Touch ID' }).click()
    const rec = await until(async () => { const t2 = await dk.p.locator('.sd-saved').innerText().catch(() => ''); return /Signed by you on Studio Mac \(Touch ID\)/.test(t2) ? t2 : null }, 10000)
    ok(!!rec && /2 signatures|1 signature/.test(rec), 'signed: by you on Studio Mac, with Touch ID, and its places', rec)
    await until(async () => /letter \(signed/.test(await dk.p.locator('.sd-file .pane-head h2').innerText().catch(() => '')), 10000)
    await dk.p.locator('.sd-file .pane-head button[aria-label="Versions"]').click()
    const vText = await until(async () => { const t3 = await dk.p.locator('.sd-panel').innerText().catch(() => ''); return /Signed by you on Studio Mac \(Touch ID\)/.test(t3) ? t3 : null }, 8000)
    ok(!!vText, 'the copy\'s versions: signed by you on Studio Mac (Touch ID), with its places', vText)
    await shot(dk.p, `${tag}studio-sign-versions-dark`)
    const offG = await win('/studio/sign/ask', { purpose: 'settings' })
    await win('/studio/sign/ask/setting', { on: false, grant: offG.grant })
  }
  ok(dk.errors.length === 0, 'dark: no page errors', dk.errors)
  // ---------- On a phone ----------
  for (const mode of ['light', 'dark']) {
    const ph = await page(b, kit.url, { phone: true, mode, before: asWindow })
    pages.push(ph)
    await ph.p.waitForSelector('nav.tabbar', { timeout: 20000 })
    ok(!!(await openIn(ph.p, root, 'agreement.pdf')), `phone, ${mode}: the PDF is drawn`, ph.errors)
    await sleep(500)
    const fit = await ph.p.locator('.sd-pdf .pdfViewer .page').first().evaluate((e) => e.getBoundingClientRect().width)
    let f = await phoneFaults(ph.p, '.sd-file')
    ok(!Object.keys(f).length && fit <= 390 && fit > 300, `phone, ${mode}: the page fits the screen's width (${Math.round(fit)} px), and so does everything around it, each control a whole 40 px target`, f)
    await shot(ph.p, `${tag}studio-pdf-phone-${mode}`)
    await signThis(ph.p)
    await ph.p.locator('.sd-sign').waitFor({ timeout: 10000 })
    await ph.p.locator('.sd-step-head', { hasText: 'Where to sign' }).click()
    await until(async () => (await ph.p.locator('.sd-mark').count()) === 2, 15000)
    await sleep(500)
    f = await phoneFaults(ph.p, '.sd-sign')
    ok(!Object.keys(f).length, `phone, ${mode}: AI Assist's Sign this fits under the PDF, each control a whole 40 px target, each field 16 px`, f)
    await shot(ph.p, `${tag}studio-sign-phone-${mode}`)
    // The pad on a phone: Draw alone (the trackpad is the Mac's, and this is the phone), said for a
    // finger; opened in view whole, its buttons whole targets, none squeezed; the panel one plain
    // sheet (no card's border inside another's down its sides).
    await ph.p.locator('.sd-place .sd-sigcard[data-kind="signature"] button', { hasText: 'Draw again' }).click()
    await ph.p.locator('.sd-place .sd-pad').waitFor({ timeout: 5000 })
    await sleep(400)
    const how = (await ph.p.locator('.sd-place .sd-pad-how').innerText()).trim()
    ok((await ph.p.locator('.sd-place .sd-pad-modes').count()) === 0 && how === 'Draw with your finger.', `phone, ${mode}: Draw only, said for a finger`, { modes: await ph.p.locator('.sd-place .sd-pad-modes').innerText().catch(() => null), how })
    const inView = await ph.p.evaluate(() => {
      const body = document.querySelector('.sd-sign-body').getBoundingClientRect()
      const box = document.querySelector('.sd-place .sd-pad-box').getBoundingClientRect()
      const acts = document.querySelector('.sd-place .sd-pad-acts').getBoundingClientRect()
      return { whole: box.top >= body.top - 1 && acts.bottom <= body.bottom + 1, body: [Math.round(body.top), Math.round(body.bottom)], box: Math.round(box.top), acts: Math.round(acts.bottom) }
    })
    const sides = await ph.p.evaluate(() => [...document.querySelectorAll('.sd-sign .sd-step, .sd-sign .sd-sigcard')].filter((e) => e.offsetParent).map((e) => getComputedStyle(e).borderLeftWidth).filter((w) => w !== '0px'))
    ok(inView.whole && !sides.length, `phone, ${mode}: the pad and its buttons in view together, and no border down the panel's sides inside it`, { inView, sides })
    f = await phoneFaults(ph.p, '.sd-place .sd-pad')
    const sq = await squeezed(ph.p, '.sd-place .sd-pad')
    ok(!Object.keys(f).length && !sq.length, `phone, ${mode}: the pad's buttons whole 40 px targets, none squeezed`, { f, sq })
    await shot(ph.p, `${tag}studio-sign-pad-phone-${mode}`)
    // Your signatures, in Studio's home on a phone.
    ok(ph.errors.length === 0, `phone, ${mode}: no page errors`, ph.errors)
  }
  // ---------- Sign on Phone, on the phone ----------
  // The phone page (relay/web, as the apps carry it) paired and kept, Bridge AI in its frame: the
  // computer asks, the pad comes over the whole screen, drawn on with a finger, and Use sends it back.
  for (const mode of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2, colorScheme: mode })
    await ctx.addInitScript(({ mode }) => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode, theme: 'sky', text: 'm' })) } catch { /* no storage */ } }, { mode })
    pages.push({ ctx })
    const pp = await ctx.newPage()
    const perr = []
    pp.on('pageerror', (e) => perr.push(e.message))
    await pp.goto((await api('/relay/pair', {})).pairing.link, { waitUntil: 'commit' })
    await pp.locator('#pair-go').click({ timeout: 20000 })
    const fr = await until(() => pp.frames().find((x) => x !== pp.mainFrame() && x.url().startsWith(relay.url)), 30000, 100)
    await fr.locator('.settings-btn, nav.tabbar').first().waitFor({ timeout: 30000 })
    const mine = await until(async () => (await api('/relay')).devices.filter((d) => d.fresh).at(-1), 10000)
    if (mine) await api(`/relay/devices/${mine.id}/keep`, {})
    const phoneId = mine?.id
    await until(async () => (await win('/studio/sign/setup')).phones.some((x) => x.id === phoneId), 15000)
    const ask = await win('/studio/sign/phone', { what: 'signature', doc: 'letter.pdf', to: phoneId })
    const shownPad = await fr.locator('.ps .ps-canvas').waitFor({ timeout: 15000 }).then(() => true, () => false)
    const head = shownPad ? await fr.locator('.ps').innerText() : ''
    ok(shownPad && /Your signature for Studio Mac/.test(head) && /letter\.pdf/.test(head) && /left/.test(head), `on the phone, ${mode}: the pad over the whole screen, what it's for, from where, and the time left`, { head, perr })
    const pf = await phoneFaults(fr, '.ps')
    ok(!Object.keys(pf).length, `on the phone, ${mode}: the pad fits the screen, its buttons whole targets`, pf)
    const box = await fr.locator('.ps-canvas').boundingBox()
    const at = await (await fr.frameElement()).boundingBox()
    await pp.mouse.move(at.x + box.x + 40, at.y + box.y + box.height * 0.6)
    await pp.mouse.down()
    for (let i = 0; i <= 24; i++) await pp.mouse.move(at.x + box.x + 40 + i * 11, at.y + box.y + box.height * 0.6 - Math.sin(i / 3) * 40, { steps: 2 })
    await pp.mouse.up()
    await shot(pp, `${tag}studio-sign-on-phone-${mode}`)
    await fr.locator('.ps button', { hasText: 'Use' }).click()
    const got2 = await until(async () => { const s5 = await win(`/studio/sign/phone/${ask.id}/state?pad=${ask.pad}`); return s5.state === 'answered' ? s5 : null }, 15000)
    ok(got2?.ink?.strokes?.length === 1 && got2.ink.strokes[0].length > 10 && !(await fr.locator('.ps').count()), `on the phone, ${mode}: Use sends the strokes back, and the pad goes`, { got: got2 && { ...got2, ink: got2.ink && { w: got2.ink.w, n: got2.ink.strokes.length } } })
    ok(perr.length === 0, `on the phone, ${mode}: no page errors`, perr)
  }
  // A browser tab on this computer (the key's cookie, not the app's window): signing isn't there,
  // and it says where it is.
  {
    const tab = await page(b, kit.url, { width: 1280, height: 800 })
    await tab.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await tab.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'studio' } })))
    const note = await until(async () => (await tab.p.locator('.modal.settings .sd-not-here').innerText().catch(() => '')).trim(), 8000)
    const addBtns = await tab.p.locator('.modal.settings button', { hasText: 'Add a signature' }).count()
    const imgs = await tab.p.locator('.modal.settings img').evaluateAll((l) => l.filter((x) => /\/api\/studio\/signature\//.test(x.src)).length)
    const askBox = tab.p.locator('[data-setting="ask-before-signing"] input[type="checkbox"]')
    const askOff = await askBox.isDisabled()
    const pinBtns = await tab.p.locator('[data-setting="ask-before-signing"] .sd-pin-row button').count()
    await shot(tab.p, `${tag}studio-sign-browser-tab`)
    ok(/^Signing is done in the Bridge AI app on this computer, or in the app on your phone/.test(note || '') && addBtns === 0 && imgs === 0 && askOff && pinBtns === 0, 'a browser tab: no signatures shown or added, Ask Before Signing shown but not changed there, and it says signing is done in the app', { note, addBtns, imgs, askOff, pinBtns })
    await tab.ctx.close()
  }
  // Signed in the app, opened, its versions looked at: still no signed copy and no signature picture
  // in Bridge AI's data folder.
  const signedNow = new Set(fs.readdirSync(path.join(dir, '_signed')).map((f) => sha(path.join(dir, '_signed', f))))
  const keptNow = everything(kit.data).filter((f) => signedNow.has(sha(f)) || (f.startsWith(path.join(kit.data, 'studio')) && fs.readFileSync(f).includes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))))
  ok(!keptNow.length, 'after signing in the app: no signed copy anywhere in Bridge AI\'s data folder, and no picture in Studio\'s', keptNow)
  // ---------- native/bridgesign itself (a Mac) ----------
  // Built for both chips, with its Info.plist inside (so macOS names it Bridge AI), and its probe
  // answers, asking nothing. Its trackpad, Touch ID and Keychain are never run here.
  if (process.platform !== 'darwin') skip('native/bridgesign', 'macOS only')
  else if (spawnSync('swiftc', ['--version']).status !== 0 && !process.env.CI) skip('native/bridgesign', 'no swiftc here (Xcode\'s command line tools)')
  else {
    const nb = path.join(kit.dir, 'native-bin')
    const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'calltap.js'), nb, '--only', 'bridgesign', '--strict'], { encoding: 'utf8' })
    const helper = path.join(nb, 'bridgesign')
    const lipo = fs.existsSync(helper) ? spawnSync('lipo', ['-archs', helper], { encoding: 'utf8' }).stdout.trim() : ''
    const plist = fs.existsSync(helper) ? spawnSync('otool', ['-s', '__TEXT', '__info_plist', helper], { encoding: 'utf8' }).stdout : ''
    ok(built.status === 0 && /arm64/.test(lipo) && /x86_64/.test(lipo) && /__info_plist/.test(plist), 'native/bridgesign builds, for Apple silicon and Intel, its Info.plist inside', `${built.stdout}${built.stderr}${lipo}`)
    const probe = fs.existsSync(helper) ? spawnSync(helper, ['probe'], { encoding: 'utf8', timeout: 10000 }) : null
    let pj = null
    try { pj = JSON.parse(probe.stdout.trim()) } catch { /* below */ }
    ok(!!pj && ['trackpad', 'touchID', 'auth'].every((k) => typeof pj[k] === 'boolean'), 'its probe says what this Mac has, asking nothing', probe?.stdout || probe?.stderr)
    const usage = fs.existsSync(helper) ? spawnSync(helper, [], { encoding: 'utf8', timeout: 10000 }) : null
    ok(usage?.status === 2 && /bridgesign probe/.test(usage.stderr), 'without a command it says how it\'s used', usage?.stderr)
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  for (const c of links) c.close?.()
  kit.stop(); model.stop(); relay.stop()
}
process.exit(done().fail ? 1 : 0)
