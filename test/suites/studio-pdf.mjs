// Studio's PDFs and AI Assist's Sign this, in the browser named by BRIDGE_TEST_BROWSER. PDFs made here
// with pdf-lib: an agreement (a page of terms, then a page with a form's signature field and date
// field), a letter with "Signature: ____" and "Date: ____" in its text, a page with no text, and a
// locked one. The server: Sign PDFs is a beta feature under Studio, off to start with; a
// signature kept only for you, and removed; the explanation asked of the model picked, with the
// document's text; a signed copy in _signed, the picture on the right page where it was put, the
// form's date field filled and its signature field done with, never over a copy that's there, the
// original untouched; a locked PDF and a mark off the page refused, saying why. The page: the PDF
// drawn by pdf.js with thumbnails, its text to select, find with matches marked, pages and zoom;
// AI Assist's Sign this (at the right end of the header), step by step: what you're signing (and
// which model read it), a signature drawn on the pad,
// the places found on their pages (the form's fields, the words next to a line), approved, and the
// signed copy saved and opened; in Focus, its pages with the whole window, still read-only; on a
// phone, all of it fitting.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults, ROOT } from '../lib/harness.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const { PDFDocument, StandardFonts, PDFName, PDFString, PDFSignature, PDFTextField, PDFRawStream, decodePDFRawStream, PDFArray } = require('pdf-lib')
const { ok, skip, done } = checks('studio-pdf')
// AI Assist's Sign this, from the right end of the PDF's header.
const signThis = async (pg) => {
  await pg.locator('.sd-file .pane-head button[aria-label="AI Assist"]').click()
  await pg.locator('.ai-menu button', { hasText: 'Sign this' }).click()
}
// No Ollama or LM Studio of this computer's own: the models are only the stand-in, once it's added.
const kit = await startKit('studio-pdf', { env: { OLLAMA_HOST: 'http://127.0.0.1:9', LM_STUDIO_BASE_URL: 'http://127.0.0.1:9/v1' } })
const model = await startModel('studio-pdf')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const err = (p, body, method) => api(p, body, method).then(() => null, (e) => e)
const q = (f) => `root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`
const pages = []
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const near = (a, b, by = 1.5) => Math.abs(a - b) <= by

// A PNG of a stroke, made here (RGBA, a diagonal line), as the page's pad would send.
function png(w = 240, h = 80) {
  const crc = (buf) => zlib.crc32(buf) >>> 0
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(y - (x * h) / w) < 3) raw.writeUInt32BE(0x101820ff, y * (w * 4 + 1) + 1 + x * 4)
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`
}

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
const images = async (file, n) => { const doc = await PDFDocument.load(fs.readFileSync(file)); const xo = doc.getPage(n - 1).node.Resources()?.lookup(PDFName.of('XObject')); return xo ? xo.keys().length : 0 }

try {
  await api('/setup', { name: 'Tester' })
  await api('/settings', { trials: { studio: true } }, 'PATCH')
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
  const F = (p) => ({ root, path: p })
  const before = sha(path.join(dir, 'agreement.pdf'))

  // ---------- The server ----------
  ok((await api('/config')).trials?.['signature-assist'] === false && /Sign PDFs is a beta feature/.test((await err('/studio/sign/setup'))?.message || ''), 'Sign PDFs is a beta feature, off to start with: its routes say how to turn it on')
  await api('/settings', { trials: { 'signature-assist': true } }, 'PATCH')
  // No model yet: it says so, and where to add one, rather than nothing.
  const none = await api('/studio/sign/setup')
  const noModel = await err('/studio/sign/explain', { ...F('agreement.pdf'), pages: [{ n: 1, text: 'Terms' }] })
  ok(none.model === null && /No model to read it with.*Settings › Model Providers/.test(noModel?.message || ''), 'no model to read with yet: said, with where to add one', { model: none.model, said: noModel?.message })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { model: 'openai:gpt-5' } }, 'PATCH')
  let setup = await api('/studio/sign/setup')
  ok(setup.signature === null && setup.initials === null && setup.model?.id === 'openai:gpt-5' && /gpt-5/.test(setup.model.label), 'turned on: nothing drawn yet, and the model it reads with is the one meeting notes use, by name', setup)
  ok(/Expected a drawing/.test((await err('/studio/signature/signature', { png: 'data:image/png;base64,AAAA' }, 'PUT'))?.message || '') && !!(await err('/studio/signature/stamp', { png: png() }, 'PUT')), 'what isn\'t a PNG drawing, or isn\'t a signature or initials, isn\'t kept')
  setup = await api('/studio/signature/signature', { png: png() }, 'PUT')
  const sigFile = path.join(kit.data, 'studio', 'signatures', 'signature.png')
  ok(setup.signature?.width === 240 && setup.signature?.height === 80 && fs.existsSync(sigFile) && (process.platform === 'win32' || (fs.statSync(sigFile).mode & 0o777) === 0o600), 'a signature kept in Bridge AI\'s data folder, for you alone to read', { setup, mode: fs.existsSync(sigFile) && (fs.statSync(sigFile).mode & 0o777).toString(8) })
  await api('/studio/signature/initials', { png: png(90, 60) }, 'PUT')
  setup = await api('/studio/signature/initials', null, 'DELETE')
  ok(setup.initials === null && !fs.existsSync(path.join(kit.data, 'studio', 'signatures', 'initials.png')) && !!setup.signature, 'initials removed: gone from the computer, the signature kept')
  // What you're signing: the text the page read, to the model.
  const said = await api('/studio/sign/explain', { ...F('agreement.pdf'), pages: [{ n: 1, text: lines.join('\n') }, { n: 2, text: 'Signed for Contoso Ltd' }], total: 2, lang: 'en' })
  const asked = model.asked(/^Explain this document, which I have been asked to sign/).at(-1) || ''
  ok(said.model?.id === 'openai:gpt-5' && said.explained?.kind === 'Mutual NDA' && said.explained.parties.length === 2 && said.explained.watch[0]?.page === 1 && said.pagesRead === 2 && said.pagesAll === 2, 'explained by the model picked: what it is, who, and what to look at, with its page', said)
  ok(/--- Page 1 ---/.test(asked) && /renews automatically/.test(asked) && /--- Page 2 ---/.test(asked) && !/sk-test/.test(asked), "the model was sent the document's text, page by page", asked.slice(0, 400))
  const scanSaid = await err('/studio/sign/explain', { ...F('scan.pdf'), pages: [{ n: 1, text: '' }] })
  if (setup.readsScans) skip('a scan with no text says so', 'this computer reads scans')
  else ok(/pictures of pages, with no text in it to read\. Bridge AI reads those on a Mac/.test(scanSaid?.message || ''), 'a PDF with no text in it: said, and that a Mac reads those', scanSaid?.message)
  // The signed copy, from the API.
  const letterBefore = sha(path.join(dir, 'letter.pdf'))
  const signed = await api('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46, align: 'left' }, { kind: 'date', page: 1, x: 375, y: 199, w: 80, h: 18, text: 'November 6, 2026' }] })
  const out1 = path.join(dir, '_signed', 'letter (signed).pdf')
  const ops = fs.existsSync(out1) ? await drawn(out1, 1) : ''
  // 240 by 80 in a 150 by 46 box: 138 by 46, on the left.
  ok(signed.path === '_signed/letter (signed).pdf' && fs.existsSync(out1) && sha(path.join(dir, 'letter.pdf')) === letterBefore, 'signed: a new PDF in _signed beside it, named (signed), the original untouched', signed)
  const hex = Buffer.from('November 6, 2026', 'latin1').toString('hex').toUpperCase()
  ok(await images(out1, 1) === 1 && /1 0 0 1 150 199 cm\n1 0 0 1 0 0 cm\n138 0 0 46 0 0 cm\n1 0 0 1 0 0 cm\n\/\S+ Do/.test(ops) && ops.includes(`<${hex}> Tj`), 'its signature drawn where it was put, as large as fits, and the date written', ops.slice(-600))
  const signed2 = await api('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'signature', page: 1, x: 150, y: 199, w: 150, h: 46 }] })
  ok(signed2.name === 'letter (signed 2).pdf' && fs.existsSync(path.join(dir, '_signed', 'letter (signed 2).pdf')), 'signed again: (signed 2), never over the copy that\'s there', signed2)
  ok(/no page 3/.test((await err('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'signature', page: 3, x: 1, y: 1, w: 50, h: 20 }] }))?.message || '') && /Draw your initials first/.test((await err('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'initials', page: 1, x: 1, y: 1, w: 50, h: 20 }] }))?.message || ''), 'a place on a page it hasn\'t, or initials not drawn yet, refused with why')
  ok(/letters the PDF's own font can't write/.test((await err('/studio/sign', { ...F('letter.pdf'), marks: [{ kind: 'date', page: 1, x: 300, y: 100, w: 120, h: 18, text: '2026年11月6日' }] }))?.message || ''), 'a date its font can\'t write is refused, saying to use digits')
  const check = await api(`/studio/sign/check?${q(F('locked.pdf'))}`)
  const locked = await err('/studio/sign', { ...F('locked.pdf'), marks: [{ kind: 'signature', page: 1, x: 100, y: 100, w: 100, h: 40 }] })
  ok(check.encrypted === true && /locked against changes/.test(locked?.message || '') && !fs.existsSync(path.join(dir, '_signed', 'locked (signed).pdf')), 'a locked PDF: known before, and signing it says why it can\'t', { check, locked: locked?.message })

  // ---------- The page ----------
  const w = await page(b, kit.url, { width: 1440, height: 900 })
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
  ok(/AI Assist/.test(await p.locator('.sd-sign-head').innerText()) && /Sign this/.test(await p.locator('.sd-sign-head').innerText()), 'its panel says it\'s AI Assist, signing this', await p.locator('.sd-sign-head').innerText().catch(() => ''))
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
  const kept = await until(async () => { const s = await api('/studio/sign/setup'); return s.signature?.at !== setup.signature.at ? s.signature : null }, 8000)
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
  await p.locator('.sd-save button', { hasText: 'Sign and save a copy' }).click()
  const out2 = path.join(dir, '_signed', 'agreement (signed).pdf')
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
  ok(!!(await until(async () => (await marks()).some((m) => m.kind === 'initials' && m.page === 1), 3000)) && (await p.locator('.sd-place .sd-pad.initials').count()) === 1, 'Add Initials: a place on the page, and a pad to draw them on, as there are none yet')
  await p.locator('.sd-places li', { hasText: 'Initials' }).locator('button[aria-label="Take this place away"]').click()
  ok(!!(await until(async () => !(await marks()).some((m) => m.kind === 'initials'), 3000)), 'taken away again')
  // Studio's home: your signature, kept here, to draw again or remove. While it's still asking
  // the server, it says neither "not drawn yet" nor offers a pad (the answer held back here; only
  // Chromium takes a route added after the page opened).
  const slow = which === 'chromium' ? async (r) => { await sleep(1500); await r.continue().catch(() => {}) } : null
  if (slow) await p.route('**/api/studio/sign/setup*', slow)
  await p.locator('.sd-file .sd-tabs [role="tab"]', { hasText: 'Files' }).click()
  if (slow) {
    await p.locator('.sd-sign-home[aria-busy="true"]').waitFor({ timeout: 10000 })
    const waiting = await p.locator('.sd-sign-home').innerText()
    ok(!/Not drawn yet/.test(waiting) && !(await p.locator('.sd-sign-home .sd-pad, .sd-sign-home button', { hasText: /Draw/ }).count()), 'before it knows: no "not drawn yet", nothing to draw on', waiting)
    await p.unroute('**/api/studio/sign/setup*', slow)
  } else skip('before it knows, nothing half-ready', 'WebKit takes no route added after the page opened')
  // Read once it knows what's drawn (it asks the server after it shows).
  await p.locator('.sd-sign-home[aria-busy="false"]').waitFor({ timeout: 10000 })
  ok((await p.locator('.sd-sign-home .sd-sigcard img').count()) === 1 && /Kept only on this computer/.test(await p.locator('.sd-sign-home').innerText()) && (await p.locator('.sd-sign-home button[aria-label="Remove your signature"]').count()) === 1, "Studio's home: Your Signature, your signature and initials, where they're kept, and Remove", await p.locator('.sd-sign-home').innerText())
  await p.locator('.sd-sign-home').scrollIntoViewIfNeeded()
  await shot(p, `${tag}studio-sign-home`)
  // Settings: part of Studio, so off with it, saying so.
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
  const trial = (name) => p.locator('.st-check', { has: p.locator('b', { hasText: new RegExp(`^${name}$`) }) })
  await trial('Sign PDFs').waitFor({ timeout: 15000 })
  await until(async () => !(await trial('Studio').locator('input').isDisabled()), 10000)
  ok(await trial('Sign PDFs').locator('input').isChecked() && /AI Assist's Sign this/.test(await trial('Sign PDFs').innerText()), 'Settings › About & Updates › Beta Features: Sign PDFs, on, saying it\'s AI Assist\'s Sign this')
  await trial('Studio').locator('input').uncheck()
  ok(!!(await until(async () => (await trial('Sign PDFs').locator('input').isDisabled()) && !(await trial('Sign PDFs').locator('input').isChecked()) && /It needs Studio on/.test(await trial('Sign PDFs').innerText()), 5000)), 'Studio off: Sign PDFs off too, saying it needs Studio', await trial('Sign PDFs').innerText())
  await shot(p, `${tag}studio-sign-trial`)
  await trial('Studio').locator('input').check()
  ok(!!(await until(async () => !(await trial('Sign PDFs').locator('input').isDisabled()) && await trial('Sign PDFs').locator('input').isChecked(), 5000)), 'and back on with it')
  await p.locator('button[aria-label="Close settings"]').click()
  ok(w.errors.length === 0, 'no page errors', w.errors)
  // Dark.
  const dk = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark' })
  pages.push(dk)
  await dk.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  ok(!!(await openIn(dk.p, root, 'letter.pdf')), 'dark: the PDF is drawn', { errors: dk.errors })
  await signThis(dk.p)
  await dk.p.locator('.sd-step-head', { hasText: 'Where to sign' }).click()
  await until(async () => (await dk.p.locator('.sd-mark').count()) === 2, 15000)
  await sleep(400)
  await shot(dk.p, `${tag}studio-sign-dark`)
  ok(dk.errors.length === 0, 'dark: no page errors', dk.errors)
  // ---------- On a phone ----------
  for (const mode of ['light', 'dark']) {
    const ph = await page(b, kit.url, { phone: true, mode })
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
    ok(ph.errors.length === 0, `phone, ${mode}: no page errors`, ph.errors)
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
