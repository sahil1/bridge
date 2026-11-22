// Studio's big files, opened in parts (server/studioparts.js, src/components/studio/files.js
// loadFile), in the browser named by BRIDGE_TEST_BROWSER. A folder of decks as the owner's is: a
// 97 MB PowerPoint of site photos ("Avathon Autonomy Platform for Renewables v5.pptx",
// lib/bigdeck.mjs) and six more named alike, Office's and LibreOffice's lock files beside it, a
// 90 MB PDF of scans, an 11 MB Word file with a photo, a 310 MB deck, a 1.1 GB one and a 90 MB CSV.
// The server: the deck's parts listed with each photo's size; the file as the page gets it (its XML,
// a marker for each photo: tens of KB); a photo at the width it's drawn at (on a Mac, made smaller by
// sips); a save of a file opened in parts with each marker put back as its photo, byte for byte (one
// copied to a new name too), and one naming a part that's nowhere refused with nothing written; a
// big file keeping fewer versions (6 of a 97 MB deck), said; over the limits, said with the real
// reason (1.1 GB over the 1 GB Studio opens, a CSV over the 80 MB a page holds whole, a 310 MB deck
// opening to read only with no versions, its save refused); a lock file never opened, and listed
// only with Show hidden.
// A phone paired through the relay (the owner's case): the deck opens and shows its first slide
// with its photo with only a few percent of the file sent through the relay (measured against the
// whole file through the same link, as Studio fetched it until now), the next slides' photos as you
// go; the PDF's first page with a few percent of it. Its Files on a phone: the seven names cut in
// the middle so each one's end shows, a long press giving the whole name, the lock files hidden;
// light and dark. On a computer: the deck's title cut in the middle with the whole name as its
// tooltip, typed in and saved with its photos kept, the version list saying how many it keeps, the
// Word file's photo from its computer, and the 1.1 GB deck's message with Download.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { startKit, startRelay, checks, until, sleep, browser, page, shot, browserNotice, phoneNotes, phoneSaw, phoneFaults, noServiceWorker, ROOT, IS_MAC } from '../lib/harness.mjs'
import { bigDeck, withMore, bigPdf, photoPng } from '../lib/bigdeck.mjs'
import { deckPptx, boardSlides } from '../lib/deckfile.mjs'
import { richDocx } from '../lib/wordfile.mjs'
import { imageSize } from '../../shared/imagesize.js'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, skip, done } = checks('studio-big')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const say = (...a) => console.log(...a)
const MB = 1e6
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const enc = encodeURIComponent
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const MARK = 'BRIDGE-STUDIO-PART/1\n'

const relay = await startRelay('studio-big')
const kit = await startKit('studio-big', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile)); return { BRIDGE_COMPUTER_NAME: 'SM-A-1' } } })
const relayTest = (what, q = '') => fetch(`${relay.url}/_test/${what}${q}`, { method: what === 'state' ? 'GET' : 'POST' }).then((r) => r.json())
const contexts = []
try {
  await kit.api('/setup', { name: 'Tester' })
  // ---------- the files ----------
  const dir = path.join(kit.home, 'Decks')
  fs.mkdirSync(dir, { recursive: true })
  const NAME = 'Avathon Autonomy Platform for Renewables v5.pptx'
  const file = path.join(dir, NAME)
  let t0 = Date.now()
  const { bytes: deck, photos } = await bigDeck()
  fs.writeFileSync(file, deck)
  const original = await JSZip.loadAsync(deck)
  const photoSha = Object.fromEntries(await Promise.all(photos.map(async (n) => [n, sha(await original.file(`ppt/media/photo${n}.png`).async('nodebuffer'))])))
  const small = await deckPptx({ slides: boardSlides(3) })
  const ALIKE = ['v1', 'v2', 'v3 final', 'v4', 'v4 (Maya edits)', '(2)']
  for (const n of ALIKE) fs.writeFileSync(path.join(dir, `Avathon Autonomy Platform for Renewables ${n}.pptx`), small)
  fs.writeFileSync(path.join(dir, `~$${NAME}`), Buffer.alloc(165, 0x20))
  fs.writeFileSync(path.join(dir, `.~lock.${NAME}#`), 'Tester,SM-A-1,21.11.2026 10:00\n')
  const sparse = (name, n) => { fs.closeSync(fs.openSync(path.join(dir, name), 'w')); fs.truncateSync(path.join(dir, name), n) }
  sparse('Fleet archive.pptx', 1.1e9)
  sparse('Turbine readings.csv', 90 * MB)
  const photo = photoPng(2400, 1500, 99)
  await withMore(deck, Array.from({ length: 20 }, (_, i) => ({ name: `ppt/media/extra${i + 1}.png`, bytes: photo })), path.join(dir, 'Site photos 2025.pptx'))
  fs.writeFileSync(path.join(dir, 'Site survey.pdf'), bigPdf({ pages: 24, w: 900, h: 1400 }))
  const word = await JSZip.loadAsync(await richDocx())
  const wordPic = Object.keys(word.files).find((n) => /^word\/media\/.*\.png$/.test(n))
  word.file(wordPic, photoPng(2400, 1500, 7), { compression: 'STORE' })
  fs.writeFileSync(path.join(dir, 'Site report.docx'), await word.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  // A long Word file whose photos are at its end, a few screens down (printed: each of them there).
  const D = require('docx')
  const logBody = [new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun('Site log')] })]
  for (let i = 0; i < 120; i++) logBody.push(new D.Paragraph({ children: [new D.TextRun(`Line ${i + 1}: the turbines at the site were checked, and each one's output written down.`)] }))
  for (let k = 0; k < 3; k++) logBody.push(new D.Paragraph({ children: [new D.ImageRun({ type: 'png', data: photoPng(2400, 1500, 3 + k), transformation: { width: 480, height: 300 } })] }))
  fs.writeFileSync(path.join(dir, 'Site log.docx'), await D.Packer.toBuffer(new D.Document({ sections: [{ children: logBody }] })))
  // A workbook with a photo in it (ExcelJS): its cells in its XML, the photo in xl/media.
  const ExcelJS = require('exceljs')
  const book = new ExcelJS.Workbook()
  const ws = book.addWorksheet('Turbines')
  ws.addRows([['Turbine', 'Output (MWh)'], ...Array.from({ length: 40 }, (_, i) => [`T-${i + 1}`, 1000 + i * 37])])
  ws.addImage(book.addImage({ buffer: photoPng(3000, 2000, 11), extension: 'png' }), 'D2:K20')
  await book.xlsx.writeFile(path.join(dir, 'Turbine output.xlsx'))
  const sizes = Object.fromEntries(fs.readdirSync(dir).map((n) => [n, fs.statSync(path.join(dir, n)).size]))
  say(`the files, made in ${Date.now() - t0} ms: the deck ${(sizes[NAME] / MB).toFixed(1)} MB, its ${photos.length} photos ${(photo.length / MB).toFixed(1)} MB each; the PDF ${(sizes['Site survey.pdf'] / MB).toFixed(1)} MB; the Word file ${(sizes['Site report.docx'] / MB).toFixed(1)} MB; the archive ${(sizes['Site photos 2025.pptx'] / MB).toFixed(0)} MB`)
  const q = (name) => `root=home&path=${enc(`Decks/${name}`)}`
  const get = async (u, o) => { const r = await fetch(u, o); return { r, buf: Buffer.from(await r.arrayBuffer()) } }

  // ---------- the server ----------
  const meta = await kit.api(`/studio/open?${q(NAME)}`)
  ok(meta.inParts && meta.left?.length === photos.length && meta.left.every((x) => x.pw === 2400 && x.ph === 1500 && x.size === photo.length) && meta.model < 300_000, 'a 97 MB deck opens in parts: its photos left on its computer, each with its size (2400 by 1500), its XML a few KB', { inParts: meta.inParts, left: meta.left?.length, model: meta.model })
  ok(meta.saves === true && meta.keep === 6 && meta.versions.length === 1, 'it can be saved, and keeps 6 versions (600 MB of copies at most), not 60', { saves: meta.saves, keep: meta.keep })
  let x = await get(`${kit.url}/api/studio/slim?${q(NAME)}&mtime=${meta.mtime}`)
  const slim = await JSZip.loadAsync(x.buf)
  const names = (z) => Object.keys(z.files).filter((n) => !z.files[n].dir).sort()
  const marker = (await slim.file('ppt/media/photo1.png').async('nodebuffer')).toString('utf8')
  ok(x.r.ok && x.buf.length < 200_000 && JSON.stringify(names(slim)) === JSON.stringify(names(original)) && marker.startsWith(MARK) && marker.includes('ppt/media/photo1.png'), `the deck as the page gets it: ${(x.buf.length / 1000).toFixed(0)} KB, every part the deck has, each photo a marker naming it`, { size: x.buf.length, marker: marker.slice(0, 80) })
  ok((await slim.file('ppt/slides/slide2.xml').async('string')) === (await original.file('ppt/slides/slide2.xml').async('string')), 'its slides\' XML as it is in the file')
  x = await get(`${kit.url}/api/studio/slim?${q(NAME)}&mtime=1`)
  ok(x.r.status === 409, 'asked for as it was at another time (it changed since): refused, to open it again', x.r.status)
  x = await get(`${kit.url}/api/studio/part?${q(NAME)}&name=${enc('ppt/media/photo1.png')}`)
  ok(x.r.ok && sha(x.buf) === photoSha[photos[0]], 'a photo, asked for whole: its own bytes')
  x = await get(`${kit.url}/api/studio/part?${q(NAME)}&name=${enc('ppt/media/photo1.png')}&w=1170&v=1`)
  const fit = imageSize(x.buf)
  if (IS_MAC) ok(x.r.headers.get('content-type') === 'image/jpeg' && fit?.pw === 1280 && x.buf.length < photo.length / 10, `a photo at the width it's drawn at on a phone: 1280 px wide (of 2400), ${(x.buf.length / 1000).toFixed(0)} KB of ${(photo.length / MB).toFixed(1)} MB (sips)`, { type: x.r.headers.get('content-type'), fit, n: x.buf.length })
  else ok(x.r.ok && (fit?.pw === 1280 || sha(x.buf) === photoSha[photos[0]]), `a photo at the width it's drawn at: ${fit?.pw === 1280 ? 'made smaller (ImageMagick)' : 'as it is (nothing here makes a picture smaller)'}`, fit)
  x = await get(`${kit.url}/api/studio/part?${q(NAME)}&name=${enc('ppt/media/nothing.png')}`)
  ok(x.r.status === 404, 'a part the file doesn\'t have: 404', x.r.status)

  // A save of the deck opened in parts: slide 2 changed, slide 1's photo copied to a new name; the
  // rest are markers, put back as the photos they name.
  slim.file('ppt/slides/slide2.xml', (await slim.file('ppt/slides/slide2.xml').async('string')).replace('Site 2 results', 'Site 2 results, checked'))
  slim.file('ppt/media/photo1-copy.png', await slim.file('ppt/media/photo1.png').async('nodebuffer'))
  let up = await slim.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const save = (body, mtime) => get(`${kit.url}/api/studio/file?${q(NAME)}&mtime=${mtime}&parts=1`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body })
  x = await save(up, meta.mtime)
  let saved = JSON.parse(x.buf.toString() || '{}')
  let now = await JSZip.loadAsync(fs.readFileSync(file))
  const same = await Promise.all(photos.map(async (n) => sha(await now.file(`ppt/media/photo${n}.png`).async('nodebuffer')) === photoSha[n]))
  ok(x.r.ok && same.every(Boolean) && sha(await now.file('ppt/media/photo1-copy.png').async('nodebuffer')) === photoSha[photos[0]] && /Site 2 results, checked/.test(await now.file('ppt/slides/slide2.xml').async('string')), `saved from parts (${(up.length / 1000).toFixed(0)} KB sent for a ${(sizes[NAME] / MB).toFixed(0)} MB file): slide 2 changed, every photo byte for byte, and the copied one too`, { status: x.r.status, same, error: saved.error })
  // A marker naming a part that's nowhere: refused, and nothing written.
  const before = sha(fs.readFileSync(file))
  const bad = await JSZip.loadAsync(up)
  bad.file('ppt/media/lost.png', `${MARK}1234abcd\n4242\nppt/media/lost.png\n`)
  x = await save(await bad.generateAsync({ type: 'nodebuffer' }), saved.mtime)
  ok(x.r.status === 502 && /isn't in the file any more/.test(x.buf.toString()) && sha(fs.readFileSync(file)) === before, 'a save naming a part that\'s nowhere (not in the file, nor its versions): refused, saying so, the file as it was', { status: x.r.status, said: x.buf.toString().slice(0, 160) })
  // Saved again and again: the oldest versions go, 6 kept.
  for (let i = 0; i < 7; i++) {
    const z = await JSZip.loadAsync(up)
    z.file('ppt/slides/slide2.xml', (await z.file('ppt/slides/slide2.xml').async('string')).replace(/Site 2 results, checked[^<]*/, `Site 2 results, checked ${i + 2} times`))
    x = await save(await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), saved.mtime)
    saved = JSON.parse(x.buf.toString() || '{}')
  }
  const vs = await kit.api(`/studio/versions?${q(NAME)}`)
  now = await JSZip.loadAsync(fs.readFileSync(file))
  const keepNow = Math.floor(600e6 / fs.statSync(file).size)
  ok(x.r.ok && vs.versions.length === keepNow && vs.keep === keepNow && keepNow < 60 && /checked 8 times/.test(await now.file('ppt/slides/slide2.xml').async('string')), `saved 8 more times (${(fs.statSync(file).size / MB).toFixed(0)} MB now, with the copy): ${vs.versions.length} versions kept, the newest its last save`, { n: vs.versions.length, keep: vs.keep, keepNow })
  const oldest = vs.versions.at(-1)
  x = await get(`${kit.url}/api/studio/version?${q(NAME)}&id=${enc(oldest.id)}`)
  ok(x.r.ok && x.buf.length > 90 * MB, 'its oldest version kept is the whole file, photos and all', x.buf.length)

  // A workbook in parts: a cell changed and saved, its photo kept byte for byte.
  const XL = 'Turbine output.xlsx'
  const xm = await kit.api(`/studio/open?${q(XL)}`)
  const xlPic = xm.left?.find((y) => /^xl\/media\//.test(y.name))
  x = await get(`${kit.url}/api/studio/slim?${q(XL)}&mtime=${xm.mtime}`)
  const xz = await JSZip.loadAsync(x.buf)
  const sheetPath = Object.keys(xz.files).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const picWas = sha(await (await JSZip.loadAsync(fs.readFileSync(path.join(dir, XL)))).file(xlPic?.name || 'none')?.async('nodebuffer') || Buffer.alloc(0))
  xz.file(sheetPath, (await xz.file(sheetPath).async('string')).replace('<v>1000</v>', '<v>1234</v>'))
  x = await get(`${kit.url}/api/studio/file?${q(XL)}&mtime=${xm.mtime}&parts=1`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: await xz.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) })
  const xb = await JSZip.loadAsync(fs.readFileSync(path.join(dir, XL)))
  ok(xm.inParts && !!xlPic && x.r.ok && /<v>1234<\/v>/.test(await xb.file(sheetPath).async('string')) && sha(await xb.file(xlPic.name).async('nodebuffer')) === picWas, `an ${(sizes[XL] / MB).toFixed(0)} MB workbook opens in parts (its photo left on its computer); a cell changed and saved, the photo byte for byte`, { inParts: xm.inParts, pic: xlPic?.name, status: x.r.status })

  // Over the limits: each said with the real reason and what to do.
  let e = await kit.api(`/studio/open?${q('Fleet archive.pptx')}`).then(() => null, (y) => y)
  ok(e?.j?.code === 'too-big' && e.j.size === 1.1e9 && e.j.max === 1e9 && /1\.1 GB, and Studio opens files up to 1 GB\. Open it on its computer in PowerPoint, or download it/.test(e.j.error), 'a 1.1 GB deck: not opened, "It\'s 1.1 GB, and Studio opens files up to 1 GB. Open it on its computer in PowerPoint, or download it."', e?.j)
  e = await kit.api(`/studio/open?${q('Turbine readings.csv')}`).then(() => null, (y) => y)
  ok(e?.j?.code === 'too-big' && e.j.whole === true && e.j.max === 80 * MB && /a page holds a file of this kind whole, so Studio opens one up to 80 MB/.test(e.j.error), 'a 90 MB CSV (a page holds it whole): not opened, saying a page holds one up to 80 MB', e?.j?.error)
  const arch = await kit.api(`/studio/open?${q('Site photos 2025.pptx')}`)
  ok(arch.inParts && arch.saves === false && arch.keep === 0 && arch.versions.length === 0, `a ${(sizes['Site photos 2025.pptx'] / MB).toFixed(0)} MB deck: opens, to read only, and Studio keeps none of its versions`, { inParts: arch.inParts, saves: arch.saves, keep: arch.keep, versions: arch.versions.length })
  x = await get(`${kit.url}/api/studio/file?${q('Site photos 2025.pptx')}&mtime=${arch.mtime}&parts=1`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: up })
  const said = JSON.parse(x.buf.toString() || '{}')
  ok(x.r.status === 413 && said.code === 'too-big-to-save' && /Studio saves files up to 250 MB/.test(said.error), 'and its save refused: "Studio saves files up to 250 MB … Change it on its computer in PowerPoint, or ask an agent to"', said.error)
  // Office's lock file: never opened, listed only with Show hidden.
  e = await kit.api(`/studio/open?${q(`~$${NAME}`)}`).then(() => null, (y) => y)
  ok(e?.j?.code === 'lock-file' && /Office's lock file/.test(e.j.error), 'Office\'s lock file: Studio doesn\'t open it, saying what it is', e?.j?.error)
  const listed = (await kit.api('/files/list?root=home&path=Decks')).entries.map((y) => y.name)
  const withHidden = (await kit.api('/files/list?root=home&path=Decks&hidden=1')).entries
  ok(!listed.some((n) => n.startsWith('~$') || n.startsWith('.~lock')) && listed.includes(NAME), 'Files lists the folder without the lock files', listed)
  ok(withHidden.filter((y) => y.name.startsWith('~$') || y.name.startsWith('.~lock')).length === 2 && withHidden.filter((y) => y.name.startsWith('~$') || y.name.startsWith('.~lock')).every((y) => y.hidden), 'with Show hidden, both lock files there, marked hidden as a dotfile is')

  // The deck as it was made (97 MB, without the copied photo), for what's measured from here on.
  fs.writeFileSync(file, deck)

  // ---------- the phone, paired through the relay ----------
  const code = (await kit.api('/relay/pair', {})).pairing.code
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 3 })
  contexts.push(ctx)
  await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'light', theme: 'sky', text: 'm' })) } catch { /* no storage */ } })
  await phoneNotes(ctx)
  const phone = await ctx.newPage()
  const errors = []
  phone.on('pageerror', (y) => { if (!browserNotice(y.message)) errors.push(y.message) })
  await phone.goto(`${relay.url}/#pair=${code}`, { waitUntil: 'commit' })
  await phone.locator('#pair-go').click({ timeout: 15000 })
  const app = () => phone.frames().find((f) => f !== phone.mainFrame() && f.url().startsWith(relay.url))
  const opened = await until(() => app()?.evaluate(() => fetch('/api/version').then((r) => r.ok)), 30000, 200)
  if (!opened) console.log('the phone page, as far as it got:', JSON.stringify(await phoneSaw(phone)))
  ok(!!opened, 'the phone is paired, and Bridge AI is open in it')
  if (!opened) throw new Error('the phone didn\'t open Bridge AI')
  const sent = async () => (await relayTest('state')).sent.downBytes
  // As Studio opened it until now: the whole file, through the same link.
  await relayTest('count')
  const whole = await app().evaluate((u) => fetch(u).then((r) => r.arrayBuffer()).then((y) => y.byteLength), `/api/agents/${enc('home')}/raw?path=${enc(`Decks/${NAME}`)}`)
  const wholeSent = await sent()
  // Now: in parts, its first slide and its photo.
  await sleep(500)
  await relayTest('count')
  t0 = Date.now()
  await until(async () => {
    await app().evaluate((detail) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail })), { root: 'home', path: `Decks/${NAME}` })
    return app().evaluate(() => !!document.querySelector('.sd-file'))
  }, 20000, 700)
  const firstPhoto = await until(() => app().evaluate(() => { const img = document.querySelector('.px-stage .px-canvas img, .sd-stage .px-canvas img'); return img && img.complete && img.naturalWidth > 0 ? { w: img.naturalWidth, src: img.getAttribute('src') } : null }), 30000, 100)
  const ms = Date.now() - t0
  await sleep(800) // what was asked for ahead (the next two slides' photos), counted too
  const firstSent = await sent()
  const resized = !!firstPhoto && firstPhoto.w < 2400
  say(`the deck on the phone, through the relay: until now ${(wholeSent / MB).toFixed(1)} MB (the whole file, ${(whole / MB).toFixed(1)} MB) to show its first slide; now ${(firstSent / MB).toFixed(2)} MB (${((firstSent / wholeSent) * 100).toFixed(1)}%), the first slide's photo ${firstPhoto?.w} px wide, in ${ms} ms`)
  ok(!!firstPhoto && /\/api\/studio\/part\?/.test(firstPhoto.src), 'on the phone, the deck opens at its first slide, its photo from the computer', firstPhoto)
  ok(firstSent < wholeSent * (resized ? 0.06 : 0.4), `and only ${((firstSent / wholeSent) * 100).toFixed(1)}% of the file came through the relay for it (${(firstSent / MB).toFixed(2)} MB of ${(wholeSent / MB).toFixed(1)} MB; the limit ${resized ? '6% with its photos made smaller' : '40% with photos as they are'})`, { firstSent, wholeSent })
  await shot(phone, `${tag}studio-big-phone-deck`)
  // On to the third slide (the next with a photo): its photo comes then.
  const stageFocus = () => app().evaluate(() => (document.querySelector('.px-stage') || document.querySelector('.sd-stage'))?.focus())
  await stageFocus()
  for (let i = 0; i < 2; i++) { await phone.keyboard.press('PageDown'); await sleep(250) }
  const third = await until(() => app().evaluate(() => { const img = document.querySelector('.px-stage .px-canvas img, .sd-stage .px-canvas img'); return img && img.complete && img.naturalWidth > 0 && /photo3\.png/.test(decodeURIComponent(img.getAttribute('src') || '')) ? img.naturalWidth : null }), 15000, 100)
  const thirdSent = await sent()
  ok(!!third && thirdSent > firstSent && thirdSent < wholeSent * (resized ? 0.1 : 0.5), `on to slide 3: its photo comes then (${(thirdSent / MB).toFixed(2)} MB in all now)`, { third, thirdSent })
  // The PDF of scans: its first page, with a few percent of it.
  await relayTest('count')
  await until(async () => {
    await app().evaluate((detail) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail })), { root: 'home', path: 'Decks/Site survey.pdf' })
    return app().evaluate(() => !!document.querySelector('.sd-pdf'))
  }, 20000, 700)
  const page1 = await until(() => app().evaluate(() => { const c = document.querySelector('.sd-pdf .page[data-page-number="1"] canvas'); return c && c.width > 0 ? c.width : null }), 30000, 150)
  await sleep(500)
  const pdfSent = await sent()
  say(`the PDF on the phone: ${(pdfSent / MB).toFixed(2)} MB of ${(sizes['Site survey.pdf'] / MB).toFixed(1)} MB to show its first page`)
  ok(!!page1 && pdfSent < sizes['Site survey.pdf'] * 0.25, `the ${(sizes['Site survey.pdf'] / MB).toFixed(0)} MB PDF on the phone: its first page drawn with ${((pdfSent / sizes['Site survey.pdf']) * 100).toFixed(1)}% of it sent`, { page1, pdfSent })
  ok(!errors.length, 'no page errors on the phone', errors.slice(0, 3))

  // ---------- Files on a phone: the names ----------
  const DECKS = { 'cc-mtab': 'more', 'cc-more-view': 'view:studio', 'cc-fx-where:here': { root: 'home', path: 'Decks' }, 'cc-fx-view': 'list' }
  for (const mode of ['light', 'dark']) {
    const ph = await page(b, kit.url, { phone: true, mode, store: DECKS })
    contexts.push(ph.ctx)
    const p = ph.p
    const row = (n) => p.locator(`.fx-row[data-name="${n}"]`)
    await row(NAME).waitFor({ timeout: 15000 })
    // (What's drawn is its ::before, cut with …, and its ::after, the end: the name is whole in .mid-text.)
    const rows = await p.locator('.fx-row').evaluateAll((els) => els.map((r) => {
      const n = r.querySelector('.mid-name'), whole = n?.querySelector('.mid-text')
      const after = n ? getComputedStyle(n, '::after') : null
      return { name: r.dataset.name, tail: n?.dataset.tail || '', text: n?.innerText, cut: !!whole && whole.scrollWidth > n.clientWidth + 1, tailShown: !!n && n.scrollWidth <= n.clientWidth + 1 && after?.content !== 'none' && parseFloat(after.width) > 10, title: n?.getAttribute('title') }
    }))
    const alike = rows.filter((r) => r.name.startsWith('Avathon'))
    ok(alike.length === 7 && alike.every((r) => r.cut && r.tailShown && r.name.endsWith(r.tail) && r.text === r.name) && new Set(alike.map((r) => r.tail)).size === 7, `${mode}: the seven decks named alike, each cut in the middle with its end shown ("… v5.pptx", "… v3 final.pptx"), so they can be told apart; the name whole in the page (read aloud, copied)`, alike.map((r) => [r.tail, r.cut, r.tailShown, r.text === r.name]))
    ok(!rows.some((r) => r.name.startsWith('~$') || r.name.startsWith('.~lock')), `${mode}: Office's and LibreOffice's lock files aren't listed`, rows.map((r) => r.name))
    const f = await phoneFaults(p, '.fx')
    ok(!f.wider && !f.past && !f.sideways, `${mode}: the list fits the phone`, f)
    await shot(p, `${tag}studio-big-phone-names${mode === 'dark' ? '-dark' : ''}`)
    if (mode === 'light') {
      // A long press on a row: its menu, headed by its whole name, wrapped; the tap that ends it opens nothing.
      const hold = async (loc) => {
        const at = await loc.boundingBox()
        await loc.evaluate((el, { x, y }) => el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true })), { x: at.x + 60, y: at.y + at.height / 2 })
        await sleep(700)
        await loc.evaluate((el, { x, y }) => { el.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true })); el.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true })) }, { x: at.x + 60, y: at.y + at.height / 2 })
      }
      const long = `Avathon Autonomy Platform for Renewables v4 (Maya edits).pptx`
      await hold(row(long))
      const head = await p.locator('.ctx-menu .ctx-heading').evaluate((h) => ({ text: h.textContent, whole: h.scrollWidth <= h.clientWidth + 1 && h.scrollHeight <= h.clientHeight + 1, lines: Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)) })).catch(() => null)
      ok(head?.text === long && head.whole, 'a long press on a row: its menu, headed by its whole name, all of it shown (wrapped)', head)
      ok(!(await p.locator('.sd-file').count()), 'and the tap that ends the press opens nothing')
      await shot(p, `${tag}studio-big-phone-hold`)
      await p.keyboard.press('Escape')
    }
    ok(!ph.errors.length, `${mode}: no page errors`, ph.errors.slice(0, 3))
    await ph.ctx.close()
  }
  // Studio's Recent list on a phone: the same names cut in the middle; a long press shows the whole one.
  {
    const ph = await page(b, kit.url, { phone: true, store: { ...DECKS, 'cc-fx-where:here': { root: 'shelf:recent' } } })
    contexts.push(ph.ctx)
    const p = ph.p
    const rec = p.locator('.sd-files-row', { hasText: 'Renewables' }).first()
    if (await rec.waitFor({ timeout: 12000 }).then(() => true, () => false)) {
      const at = await rec.boundingBox()
      await rec.evaluate((el, { x, y }) => el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: x, clientY: y, bubbles: true })), { x: at.x + 80, y: at.y + at.height / 2 })
      await sleep(700)
      await rec.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true })))
      const bubble = await p.locator('.name-bubble.on').innerText().catch(() => '')
      ok(bubble === NAME, 'Studio\'s Recent on a phone: a long press shows the whole name over the row', bubble)
      await shot(p, `${tag}studio-big-phone-recent-hold`)
    } else skip('Studio\'s Recent on a phone', 'its list didn\'t show here')
    await ph.ctx.close()
  }

  // ---------- on a computer ----------
  // What a test turns on: the PDF's parts not coming (the link dropped), a version that can't be put back.
  const fail = { ranges: false, restore: false }
  // (No service worker, whose fetches WebKit's routes don't see.)
  const dk = await page(b, kit.url, { width: 1440, height: 900, before: async (c) => {
    await noServiceWorker(c)
    await c.route(/\/raw\?path=Decks%2FSite%20survey\.pdf/, (r) => (fail.ranges && r.request().headers().range ? r.abort('failed') : r.continue()))
    await c.route(/\/api\/studio\/restore/, (r) => (fail.restore ? r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'No such version' }) }) : r.continue()))
  } })
  contexts.push(dk.ctx)
  const p = dk.p
  // Asked again until it's open (the page may not be listening yet as it loads).
  const openHere = (rel) => until(async () => {
    await p.evaluate((detail) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail })), { root: 'home', path: rel })
    return p.evaluate((name) => document.querySelector('.sd-file .pane-head h2 .mid-name')?.getAttribute('title') === name, rel.split('/').pop())
  }, 20000, 700)
  await openHere(`Decks/${NAME}`)
  const shown = await until(() => p.evaluate(() => { const i = document.querySelector('.px-canvas img'); return i && i.complete && i.naturalWidth > 0 }), 30000, 200)
  if (!shown) { console.log('the deck on the computer, as far as it got:', JSON.stringify(await p.evaluate(() => ({ head: document.querySelector('.sd-file .pane-head')?.innerText, imgs: [...document.querySelectorAll('.px-canvas img, .sd-strip img')].slice(0, 4).map((i) => ({ src: i.getAttribute('src')?.slice(0, 90), complete: i.complete, w: i.naturalWidth, r: JSON.stringify(i.getBoundingClientRect()) })), body: document.querySelector('.sd-file')?.innerText.slice(0, 200) })))); await shot(p, `${tag}studio-big-desktop-stuck`) }
  ok(!!shown, 'on a computer, the deck opens at its first slide, its photo from the computer')
  const heap = await p.evaluate(() => performance.memory?.usedJSHeapSize || null)
  if (heap) say(`the page's memory with the 97 MB deck open: ${(heap / MB).toFixed(0)} MB`)
  const title = await p.locator('.sd-file .pane-head h2 .mid-name').evaluate((n) => ({ title: n.getAttribute('title'), tail: n.dataset.tail, text: n.closest('h2').innerText })).catch(() => null)
  ok(title?.title === NAME && title.tail === ' v5.pptx' && title.text === NAME, 'on a computer, its title in the header: cut in the middle where it must be, the whole name its tooltip', title)
  // Typed in slide 2's title and saved: the file changes there, its photos as they were.
  await p.locator('.sd-strip .sd-thumb').nth(1).locator('.sd-thumb-btn').click()
  const objs = p.locator('.px-canvas .px-draw > .px-slide > [data-o]')
  const tb = await objs.nth(0).boundingBox()
  await p.mouse.click(tb.x + tb.width * 0.2, tb.y + tb.height / 2)
  await p.locator('.px-edit-body').waitFor({ timeout: 5000 })
  await p.locator('.px-edit-body').evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })
  await p.keyboard.type(' on site')
  await p.keyboard.press('Escape')
  await p.keyboard.press(`${MOD}+s`)
  const typed = await until(async () => { const z = await JSZip.loadAsync(fs.readFileSync(file)); return /on site/.test(await z.file('ppt/slides/slide2.xml').async('string')) ? z : null }, 15000, 300)
  const kept = typed && await Promise.all(photos.map(async (n) => sha(await typed.file(`ppt/media/photo${n}.png`).async('nodebuffer')) === photoSha[n]))
  ok(!!typed && kept.every(Boolean), 'typed in on a computer and saved (⌘S): the file has it, every photo byte for byte', kept)
  await p.locator('.sd-head-icons button[aria-label="Versions"]').click()
  const note = await p.locator('.sd-panel .sd-v-note').innerText().catch(() => '')
  ok(/This file is big \(9\d\.\d MB\), so Studio keeps its last 6 versions, not 60\./.test(note), 'its versions say how many a file this big keeps', note)
  await shot(p, `${tag}studio-big-desktop-deck`)
  // A version that can't be put back (gone meanwhile, its computer away): said, the file as it was.
  fail.restore = true
  const fileWas = sha(fs.readFileSync(file))
  await p.locator('.sd-panel button', { hasText: 'Restore' }).first().click()
  const notRestored = await p.locator('.sd-note-bar[role="alert"]').innerText({ timeout: 8000 }).catch(() => '')
  fail.restore = false
  ok(/Couldn't restore that version: No such version/.test(notRestored) && sha(fs.readFileSync(file)) === fileWas && !dk.errors.some((y) => /No such version/.test(y)), 'a version that can\'t be restored: "Couldn\'t restore that version", the file as it was', { said: notRestored, errors: dk.errors.slice(0, 2) })
  await p.locator('.sd-panel button[aria-label="Close"]').first().click()
  // Export › This slide as a picture: the slide whole, its photo in it, on the PNG (WebKit drew it
  // in the top left quarter, without its photo).
  const download = p.waitForEvent('download', { timeout: 30000 })
  await p.locator('.sd-strip .sd-thumb').nth(0).locator('.sd-thumb-btn').click()
  await p.locator('button[aria-label="Export"]').click()
  await p.locator('[role="menu"] >> text=This slide as a picture').click()
  const png = await download.then((d) => d.path()).then((f) => fs.readFileSync(f).toString('base64'), () => null)
  const px = png && await p.evaluate(async (data) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const at = (x, y) => [...g.getImageData(Math.round(x * img.width), Math.round(y * img.height), 1, 1).data]
    return { w: img.width, h: img.height, photo: at(0.5, 0.58), corner: at(0.97, 0.97) }
  }, png)
  const photoShown = !!px && px.photo[3] === 255 && px.photo.slice(0, 3).some((v) => v < 200)
  ok(!!px && px.w === 2560 && photoShown && px.corner.every((v) => v === 255), 'Export › This slide as a picture: the whole slide at twice its size, its photo in it, its corner the slide\'s white', px)
  // The Word file: its photo from its computer, as it's scrolled to.
  await openHere('Decks/Site report.docx')
  const wimg = await until(() => p.evaluate(() => { const i = document.querySelector('.sd-file .ProseMirror img[src*="/api/studio/part"]'); return i ? { src: i.getAttribute('src'), lazy: i.getAttribute('loading'), shown: i.complete && i.naturalWidth > 0 } : null }), 20000, 200)
  ok(!!wimg && /\/api\/studio\/part\?/.test(wimg.src) && wimg.lazy === 'lazy', 'an 11 MB Word file opens in parts: its photo from its computer, when it\'s scrolled to', wimg || await p.evaluate(() => ({ text: document.querySelector('.sd-file')?.innerText.slice(0, 300), imgs: [...document.querySelectorAll('.sd-file img')].map((i) => i.getAttribute('src')?.slice(0, 80)) })))
  // Compare, on a big Word file: its words, not the two files whole (a phone got 2 x 11 MB for it).
  await p.locator('.sd-file .ProseMirror p', { hasText: 'Revenue grew' }).first().click()
  await p.keyboard.press('Home')
  await p.keyboard.type('Checked on site. ')
  await p.keyboard.press(`${MOD}+s`)
  await until(async () => /Checked on site/.test(await (await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'Site report.docx')))).file('word/document.xml').async('string')), 15000, 300)
  await p.locator('.sd-head-icons button[aria-label="Versions"]').click()
  let compared = 0
  const counting = (r) => { if (/\/api\/(studio\/(version|slim)|agents\/home\/raw)\?/.test(r.url())) compared += Number(r.headers()['content-length'] || 0) }
  p.on('response', counting)
  await p.locator('.sd-panel button', { hasText: 'Compare' }).first().click()
  const diff = await p.locator('.sd-compare .sd-diff').innerText({ timeout: 20000 }).catch(() => '')
  p.off('response', counting)
  ok(/\+ .*Checked on site\./.test(diff) && compared < 1e6, `Compare on an 11 MB Word file opened in parts: the change shown, from ${(compared / 1000).toFixed(0)} KB of its words (not the two files whole)`, { compared, diff: diff.slice(0, 200) })
  await p.locator('.sd-compare button[aria-label="Close"]').click()
  await p.locator('.sd-panel button[aria-label="Close"]').first().click()
  // Printed, a long Word file's photos a few screens down: each one there when it prints (WebKit
  // left a lazy one out, a blank where it was).
  await openHere('Decks/Site log.docx')
  await p.locator('.sd-file .ProseMirror p').first().waitFor({ timeout: 20000 })
  await p.locator('.sd-file .ProseMirror p').first().click()
  await p.keyboard.press(`${MOD}+p`)
  await until(() => p.evaluate(() => !!document.querySelector('iframe.sd-print-frame')), 5000, 20)
  await p.evaluate(() => { const f = [...document.querySelectorAll('iframe.sd-print-frame')].pop(); const hook = () => { try { f.contentWindow.print = () => { window.printedPictures = [...f.contentDocument.images].map((i) => i.complete && i.naturalWidth > 0) } } catch { /* not yet */ } }; hook(); f.addEventListener('load', hook) })
  const printedPictures = await until(() => p.evaluate(() => window.printedPictures), 20000, 100)
  ok(printedPictures?.length === 3 && printedPictures.every(Boolean), 'Print, on a long Word file: its three photos at the end each there as it prints', printedPictures)
  // The workbook: its cells, as Excel has them.
  await openHere(`Decks/${XL}`)
  const cells = await until(() => p.evaluate(() => !!document.querySelector('.sd-univer canvas')), 30000, 300)
  ok(!!cells && !(await p.locator('.sd-file .sd-empty[role="alert"]').count()), 'the workbook opens on a computer, in parts, as a sheet')
  // Too big: said, with Download.
  await openHere('Decks/Fleet archive.pptx')
  const big = await p.locator('.sd-file .sd-empty[role="alert"]').innerText({ timeout: 15000 }).catch(() => '')
  ok(/It's 1\.1 GB, and Studio opens files up to 1 GB\. Open it on its computer in PowerPoint, or download it\./.test(big) && await p.locator('.sd-file .sd-empty a', { hasText: 'Download' }).count() === 1 && !(await p.locator('.sd-file .sd-empty button', { hasText: 'Try again' }).count()), 'a 1.1 GB deck: "It\'s 1.1 GB, and Studio opens files up to 1 GB…", with Download and no Try again', big)
  await shot(p, `${tag}studio-big-desktop-too-big`)
  // 310 MB: read-only, said.
  await openHere('Decks/Site photos 2025.pptx')
  const ro = await p.locator('.sd-big-bar').innerText({ timeout: 30000 }).catch(() => '')
  ok(/Read-only here: it's 3\d\d\.\d MB, and Studio saves files up to 250 MB/.test(ro) && /Read-only/.test(await p.locator('.sd-status').innerText()), 'a 310 MB deck opens to read only, saying why and what to do', ro)
  // The PDF of scans, its parts not coming (the link dropped): said, with Try again, which opens it
  // once they come (pdf.js waited for them for ever, "Opening…").
  fail.ranges = true
  await openHere('Decks/Site survey.pdf')
  const stuck = await p.locator('.sd-pdf-cover[role="alert"]').innerText({ timeout: 30000 }).catch(() => '')
  ok(/Couldn't show this PDF/.test(stuck) && /the connection dropped/.test(stuck) && await p.locator('.sd-pdf-cover button', { hasText: 'Try again' }).count() === 1, 'a big PDF whose parts stop coming: "Couldn\'t show this PDF … the connection dropped", with Try again', stuck)
  await shot(p, `${tag}studio-big-desktop-pdf-dropped`)
  fail.ranges = false
  await p.locator('.sd-pdf-cover button', { hasText: 'Try again' }).click()
  const again = await until(() => p.evaluate(() => { const c = document.querySelector('.sd-pdf .page[data-page-number="1"] canvas'); return c && c.width > 0 }), 30000, 150)
  ok(!!again && !(await p.locator('.sd-pdf-cover[role="alert"]').count()), 'Try again, once they come: its first page drawn')
  ok(!dk.errors.length, 'no page errors on the computer', dk.errors.slice(0, 3))
} catch (err) {
  ok(false, `crashed: ${err.stack}`)
  console.log(kit.log().slice(-2000))
} finally {
  for (const c of contexts) await c.close().catch(() => {})
  kit.stop()
  relay.stop()
  await b.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
