// Save as Word or PDF: a meeting as one file to share, its pictures in it (src/components/meetings/
// exporting.js, Studio's docx.js and docpdf.js; meetings.js exportOf and saveExport). A meeting with
// people, a summary with action items, your notes with a picture pasted in, two pictures of the
// screen (a wide JPEG with a note, a tall PNG) and a long transcript (2,400 lines, one in Japanese).
// The right-click menu and the open meeting's ⋯ menu offer Markdown, Word and PDF. The Word file,
// beside the meeting's note as the note is named, is a zip whose document has the title, the people,
// the summary, the action items, your notes, the pictures' notes and the transcript in the note's
// order, a picture in word/media for each, each no wider than the page. The PDF reads back with
// pdf-lib and pdf.js: its pages, the words on the first and the last, every picture in it and none
// drawn wider than the page; the line in Japanese is a picture of its words, and it says so. The page
// keeps going while a long one is made. Show in Finder shows the file. On a phone, paired through
// the relay (stand-ins/relay.mjs), Save as PDF downloads it to the phone. A picture that can't be
// read is left out and said; a folder that can't be written says why; Save as Markdown still writes
// its note with the pictures beside it.
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { PDFDocument, PDFName, PDFRawStream, PDFArray, decodePDFRawStream } from 'pdf-lib'
import { startKit, startRelay, checks, until, browser, page, shot, browserNotice, phoneNotes, phoneSaw, ROOT } from '../lib/harness.mjs'
import { chartPng } from '../lib/wordfile.mjs'

const { ok, done } = checks('meeting-export')
const relay = await startRelay('meeting-export')
const kit = await startKit('meeting-export', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile)); return {} } })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const LINES = 2400

try {
  const notes = path.join(kit.home, 'Meeting notes')
  await api('/setup', { name: 'Tester' })
  await api('/settings', { meetings: { autoSummary: false, folder: notes } }, 'PATCH')
  const M = await api('/meetings', { title: 'Pricing review', call: false, event: { title: 'Pricing review', attendees: ['Priya Shah', 'Dan Ruiz'] } })
  await api(`/meetings/${M.id}/stop`, {})
  const dir = path.join(kit.data, 'meetings', M.id)
  const said = Array.from({ length: LINES }, (_, i) => ({ src: i % 2 ? 'them' : 'you', t0: 5 + i * 4, t1: 8 + i * 4, text: i === 7 ? '来月の予算について話しましょう。' : i % 2 ? `Line ${i} about the budget for next year, and what each team needs before March.` : `Okay ${i}, I will write that down and send everyone my numbers tomorrow.`, engine: 'test' }))
  fs.appendFileSync(path.join(dir, 'transcript.jsonl'), `${said.map((x) => JSON.stringify(x)).join('\n')}\n`)
  fs.writeFileSync(path.join(dir, 'summary.md'), '## Summary\n- Pricing goes up in March.\n\n## Action items\n- [ ] You: send the deck to Priya\n- [x] Dan Ruiz: book the room\n')
  // The pictures: a wide JPEG of the screen (made in the page), a tall PNG, and one pasted in your notes.
  const pic = async (buf, type, q) => (await fetch(`${kit.url}/api/meetings/${M.id}/captures?${new URLSearchParams(q)}`, { method: 'POST', headers: { 'content-type': type }, body: buf })).json()
  const { p, errors } = await page(b, kit.url, { store: { 'cc-rail-meetings': true } })
  const jpeg = Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 900; const x = c.getContext('2d'); x.fillStyle = '#2b6cde'; x.fillRect(0, 0, 1600, 900); x.fillStyle = '#fff'; x.font = '120px sans-serif'; x.fillText('Q3 pricing', 200, 450); return c.toDataURL('image/jpeg', 0.9).split(',')[1] }), 'base64')
  const wide = await pic(jpeg, 'image/jpeg', { kind: 'screen', t: 12, note: 'Pricing slide' })
  const tall = await pic(chartPng(700, 2100), 'image/png', { kind: 'screen', t: 40 })
  const pasted = await pic(chartPng(500, 300), 'image/png', { kind: 'paste' })
  await api(`/meetings/${M.id}/notes`, { text: `Agenda first.\n\n![whiteboard](${pasted.file})\n\nThen the budget.` }, 'PUT')
  ok(!!(wide.id && tall.id && pasted.id), 'a meeting with three pictures: two of the screen, one pasted in its notes', { wide, tall, pasted })

  // ---------- The right-click menu ----------
  await p.reload()
  const row = p.locator('.rail-meetings .rm-row', { hasText: 'Pricing review' }).first()
  await row.waitFor({ timeout: 15000 }).catch(() => {})
  await row.click({ button: 'right' })
  await p.waitForSelector('.ctx-menu', { timeout: 4000 }).catch(() => {})
  const items = await p.locator('.ctx-menu button').allInnerTexts()
  ok(['Save as Markdown', 'Save as Word (.docx)', 'Save as PDF'].every((x) => items.includes(x)), 'right-click a meeting: Save as Markdown, Word (.docx) or PDF', items)
  await shot(p, `${tag}export-menu`)

  // ---------- Word ----------
  // How long the page went without a turn while it worked (a timer every 50 ms).
  const watch = () => p.evaluate(() => { window.__gap = 0; let last = performance.now(); clearInterval(window.__tick); window.__tick = setInterval(() => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - last); last = n }, 50) })
  const gap = () => p.evaluate(() => { clearInterval(window.__tick); return Math.round(window.__gap) })
  await watch()
  const t0 = Date.now()
  await p.locator('.ctx-menu button', { hasText: 'Save as Word (.docx)' }).click()
  const said1 = await until(async () => { const x = await p.locator('.rm-msg').innerText().catch(() => ''); return /Saved to /.test(x) && x }, 60000, 200)
  const wordMs = Date.now() - t0
  const wordGap = await gap()
  const meta1 = await api(`/meetings/${M.id}`)
  const docx = meta1.exported?.docx
  const expect = path.join(notes, ...new Date(meta1.startedAt).toISOString().slice(0, 10).split('-'), 'Pricing review-summary.docx')
  ok(!!said1 && /\.docx/.test(said1) && docx && fs.existsSync(docx), 'Save as Word: made, and it says where it saved it', { said: said1, docx })
  ok(docx === expect || path.basename(docx) === 'Pricing review-summary.docx', 'beside the meeting\'s note, named as the note is (Settings › Voice & Meetings)', { docx, expect })
  console.log(`the Word file of ${LINES} lines: ${wordMs} ms, the page at most ${wordGap} ms without a turn`)
  if (docx && fs.existsSync(docx)) {
    const zip = await JSZip.loadAsync(fs.readFileSync(docx))
    const xml = (await zip.file('word/document.xml')?.async('string')) || ''
    const text = xml.replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')
    const media = Object.keys(zip.files).filter((f) => /^word\/media\/.+\.(jpe?g|png)$/.test(f))
    const order = ['Pricing review', 'Attendees: Priya Shah, Dan Ruiz', 'Pricing goes up in March.', 'You: send the deck to Priya', 'Agenda first.', 'Then the budget.', 'From the screen', 'Pricing slide', 'Transcript', 'Tester: Okay 0, I will write', 'Line 1 about the budget', `Line ${LINES - 1} about the budget`]
    const at = order.map((s) => text.indexOf(s))
    ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), 'the Word file: the title, who was there, the summary, the action items, your notes, the pictures\' notes and the whole transcript, in the note\'s order', order.map((s, k) => `${s}: ${at[k]}`))
    ok(text.includes('来月の予算について話しましょう。'), 'a line in Japanese is there as words')
    ok(media.length === 3, 'a picture in word/media for each of the meeting\'s three', Object.keys(zip.files).filter((f) => f.startsWith('word/media')))
    // Sized to the page: 600 px wide at most (A4 less Word's margins), 860 px tall (EMU: 9,525 a pixel).
    const ext = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map((m) => [Number(m[1]) / 9525, Number(m[2]) / 9525])
    ok(ext.length === 3 && ext.every(([w, h]) => w <= 600.5 && h <= 860.5) && ext.some(([w]) => w > 590), 'each picture as wide as the page at most, and a tall one no taller than it', ext)
  }
  ok(wordGap < 1500, 'the page kept going while it was made', wordGap)
  // Show in Finder (BRIDGE_FIX_DRYRUN: what it would run).
  const reveal = p.waitForResponse((r) => /\/reveal$/.test(r.url()), { timeout: 8000 }).catch(() => null)
  await p.locator('.rm-msg .link-btn').click({ timeout: 4000 }).catch(() => {})
  const shown = await (await reveal)?.json().catch(() => null)
  ok(shown?.dry?.includes(docx), 'Show in Finder beside it shows the Word file', shown)

  // ---------- PDF, from the open meeting's ⋯ menu ----------
  await row.click()
  await p.waitForSelector('button[aria-label="More actions"]', { timeout: 10000 }).catch(() => {})
  await p.locator('button[aria-label="More actions"]').click()
  const more = await p.locator('.menu .menu-item').allInnerTexts()
  ok(['Save as Markdown', 'Save as Word (.docx)', 'Save as PDF'].every((x) => more.some((y) => y.trim() === x)), 'the open meeting\'s ⋯ menu offers the same', more)
  await watch()
  const t1 = Date.now()
  await p.locator('.menu .menu-item', { hasText: 'Save as PDF' }).click()
  const making = await until(async () => /Making a PDF of Pricing review/.test(await p.locator('.mt-msg').innerText().catch(() => '')), 5000, 50)
  const said2 = await until(async () => { const x = await p.locator('.mt-msg').innerText().catch(() => ''); return /Saved to /.test(x) && x }, 90000, 200)
  const pdfMs = Date.now() - t1
  const pdfGap = await gap()
  console.log(`the PDF of ${LINES} lines: ${pdfMs} ms, the page at most ${pdfGap} ms without a turn`)
  ok(!!making && !!said2 && /\.pdf/.test(said2), 'Save as PDF: it says it\'s making it, then where it saved it', { making, said: said2 })
  ok(/as pictures of them/.test(said2 || ''), 'and that words its font can\'t show (the line in Japanese) are in it as pictures', said2)
  ok(pdfGap < 1500, 'the page kept going while it was made', pdfGap)
  await shot(p, `${tag}export-pdf-saved`)
  const pdfFile = (await api(`/meetings/${M.id}`)).exported?.pdf
  const bytes = pdfFile && fs.existsSync(pdfFile) ? fs.readFileSync(pdfFile) : Buffer.alloc(0)
  ok(bytes.subarray(0, 5).toString('latin1') === '%PDF-' && path.basename(pdfFile) === 'Pricing review-summary.pdf' && path.dirname(pdfFile) === path.dirname(docx || ''), 'a PDF, beside the Word file and the note', pdfFile)
  if (bytes.length) {
    const d = await PDFDocument.load(bytes)
    const pages = d.getPageCount()
    ok(pages >= 60 && pages <= 300, `its pages: ${pages} for ${LINES} lines`, pages)
    // Every picture in it, and where each is drawn (a page's "w 0 0 h x y cm /I Do").
    const images = d.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    ok(images.length >= 3 + 1, 'every picture in it (three, and the Japanese line\'s words as one)', images.length)
    const W = d.getPage(0).getWidth()
    const drawn = []
    for (const pg of d.getPages()) {
      const c = pg.node.Contents()
      const parts = c instanceof PDFArray ? c.asArray().map((r) => d.context.lookup(r)) : [c]
      for (const s of parts) {
        const ops = Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString('latin1')
        for (const m of ops.matchAll(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.-]+) cm\s*\/I\w* Do/g)) drawn.push([Number(m[1]), Number(m[2]), Number(m[3])])
      }
    }
    ok(drawn.length >= 4 && drawn.every(([w, , x]) => x >= 53 && x + w <= W - 53), 'each picture drawn inside the page\'s margins', { W, drawn: drawn.slice(0, 8) })
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: `${path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts')}${path.sep}` }).promise
    const words = async (n) => (await (await doc.getPage(n)).getTextContent()).items.map((x) => x.str).join(' ').replace(/\s+/g, ' ')
    const first = await words(1)
    const last = await words(pages)
    ok(['Pricing review', 'Attendees: Priya Shah, Dan Ruiz', 'Pricing goes up in March.', 'send the deck to Priya'].every((x) => first.includes(x)), 'its first page: the title, who was there, the summary and the action items, as words', first.slice(0, 500))
    ok(last.includes(`Line ${LINES - 1} about the budget`) && last.includes(`${pages} / ${pages}`), 'its last page: the transcript\'s last line, and its page number', last.slice(-300))
  }
  // The iPhone app takes it from here (its share sheet).
  const got = await fetch(`${kit.url}/api/meetings/${M.id}/export/pdf`)
  ok(got.ok && (await got.arrayBuffer()).byteLength === bytes.length, 'the PDF, for the iPhone app to take to the phone', got.status)

  // ---------- Save as Markdown, as before ----------
  const md = await api(`/meetings/${M.id}/save`, {})
  const note = fs.readFileSync(md.file, 'utf8')
  ok(note.includes('## My notes\n\nAgenda first.') && note.includes(`![0:12 Pricing slide](attachments/${path.basename(wide.file)})\nPricing slide`) && fs.existsSync(path.join(path.dirname(md.file), 'attachments', path.basename(tall.file))), 'Save as Markdown still writes its note, the pictures beside it in attachments', note.slice(0, 600))

  // ---------- On a phone, through the relay: it comes to the phone ----------
  try {
    ok(!!(await until(async () => (await api('/relay')).online, 20000)), 'connected to its relay')
    const code = (await api('/relay/pair', {})).pairing.code
    const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true })
    await pctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'light', theme: 'sky', text: 'm' })) } catch { /* no storage */ } })
    await phoneNotes(pctx)
    const phone = await pctx.newPage()
    phone.on('pageerror', (e) => { if (!browserNotice(e.message)) errors.push(e.message) })
    await phone.goto(`${relay.url}/#pair=${code}`, { waitUntil: 'commit' })
    await phone.locator('#pair-go').click({ timeout: 15000 }) // a pairing link asks first: one tap
    const app = () => phone.frames().find((f) => f !== phone.mainFrame() && f.url().startsWith(relay.url))
    const opened = await until(() => app()?.evaluate(() => fetch('/api/version').then((x) => x.ok)), 30000, 200)
    ok(!!opened, 'a phone paired through the relay, Bridge AI open in it', opened ? undefined : await phoneSaw(phone))
    if (opened) {
      const f = app()
      await f.locator('.tabbar button', { hasText: 'Meetings' }).click({ timeout: 15000 })
      await f.locator('.mt-row-open', { hasText: 'Pricing review' }).click({ timeout: 15000 })
      await f.locator('.pane-head button[aria-label="More actions"]').click({ timeout: 15000 })
      const dl = phone.waitForEvent('download', { timeout: 90000 }).catch(() => null)
      await f.locator('.menu .menu-item', { hasText: 'Save as PDF' }).click()
      const d = await dl
      const got = d && await d.path().then((x) => fs.readFileSync(x), () => null)
      const said5 = await until(async () => { const x = await f.locator('.mt-msg').innerText().catch(() => ''); return /Downloading /.test(x) && x }, 10000, 200)
      ok(d?.suggestedFilename() === 'Pricing review-summary.pdf' && got?.subarray(0, 5).toString('latin1') === '%PDF-' && (await PDFDocument.load(got)).getPageCount() >= 60, 'on the phone, Save as PDF downloads the whole PDF to the phone', { name: d?.suggestedFilename(), size: got?.length })
      ok(/Downloading Pricing review-summary\.pdf to this device\.$/.test(said5 || ''), 'and says so', said5)
      await shot(phone, `${tag}export-phone`)
    }
    await pctx.close()
  } catch (e) { ok(false, `the phone: ${String(e.message).split('\n')[0]}`) }

  // ---------- When something's wrong, it says so ----------
  // A picture whose file has gone: left out, and said.
  const B = await api('/meetings', { title: 'Vendor call', call: false })
  await api(`/meetings/${B.id}/stop`, {})
  const lostPic = await (await fetch(`${kit.url}/api/meetings/${B.id}/captures?kind=screen&t=3`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: chartPng(300, 200) })).json()
  fs.rmSync(path.join(kit.data, 'meetings', B.id, lostPic.file), { force: true })
  await p.reload()
  const rowB = p.locator('.rail-meetings .rm-row', { hasText: 'Vendor call' }).first()
  await rowB.waitFor({ timeout: 15000 }).catch(() => {})
  await rowB.click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Save as Word (.docx)' }).click()
  const said3 = await until(async () => { const x = await p.locator('.rm-msg.error-text').innerText().catch(() => ''); return /Saved to /.test(x) && x }, 30000, 200)
  ok(/A picture couldn't be read, so it isn't in it\./.test(said3 || ''), 'a picture that can\'t be read: the file is made without it, and it says so', said3)
  // A notes folder that can't be written (a file where the folder would be): why.
  fs.writeFileSync(path.join(kit.home, 'not-a-folder'), 'x')
  await api('/settings', { meetings: { folder: path.join(kit.home, 'not-a-folder', 'Meeting notes') } }, 'PATCH')
  await rowB.click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Save as PDF' }).click()
  const said4 = await until(async () => { const x = await p.locator('.rm-msg.error-text').innerText().catch(() => ''); return /^Couldn't save the PDF: \S/.test(x) && x }, 30000, 200)
  ok(!!said4, 'a folder it can\'t write to: it says it couldn\'t save the PDF, and why', said4 || await p.locator('.rm-msg').innerText().catch(() => ''))
  await shot(p, `${tag}export-error`)
  ok(errors.length === 0, 'no errors in the page', errors)
} finally {
  await b.close()
  await kit.stop()
  relay.stop()
}
process.exit(done().fail ? 1 : 0)
