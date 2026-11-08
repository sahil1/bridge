// Studio's documents against Google Docs' everyday basics, in the browser named by
// BRIDGE_TEST_BROWSER: a Word file (lib/wordfile.mjs) and a Markdown file written in as someone
// coming from Google Docs would. Saved as you type (no Save to remember), a few minutes' saves one
// version and ⌘S keeping its own, a change from elsewhere stopping it, and a file left with a save
// waiting saved. Pasted from Google Docs, Word and a web page: headings, bold, lists and their
// levels (Word's typed-in bullets taken out), a checklist, a quote, and the page's pictures brought
// in (one the web won't give, taken out and said); ⇧⌘V plain; a picture pasted and dropped in, and a
// file that isn't one said. "- ", "1. " and "[] " typed starting lists, Backspace putting them back;
// checklists (⇧⌘9, ticked with a click, kept as Word keeps them); the link the cursor is in, with
// Copy, Change and Remove; ⇧⌘X, ⇧⌘> and ⇧⌘<, ⌘G; lists copied out as lists. Page setup saved into
// the file; Print (⌘P) as its pages; a Markdown copy of the Word file. In Markdown: checklists, a
// picture pasted (saved beside it), Word's lists pasted, a list of plain and checklist items shown and
// saved as written, and a Word copy of it. Written in Focus
// (⌘. still superscript, saved as you type, Esc out). In the dark too.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { startKit, checks, until, sleep, browser, page, shot, freePort, ROOT } from '../lib/harness.mjs'
import { richDocx, chartPng } from '../lib/wordfile.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, done } = checks('studio-writing')
const kit = await startKit('studio-writing')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
// A web page's pictures: one any page may have (as a picture host gives them), one that isn't there.
const picPort = await freePort()
const pics = http.createServer((req, res) => {
  if (req.url === '/chart.png') { res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' }); res.end(chartPng(90, 50)); return }
  res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end()
})
await new Promise((r) => pics.listen(picPort, '127.0.0.1', r))
const PICS = `http://127.0.0.1:${picPort}`
const pages = []
const partsOf = async (file) => { const z = await JSZip.loadAsync(fs.readFileSync(file)); const o = {}; for (const n of Object.keys(z.files)) if (!z.files[n].dir) o[n] = await z.file(n).async('string'); return o }
const changed = (a, c) => Object.keys({ ...a, ...c }).filter((k) => a[k] !== c[k]).sort()

// What Google Docs, Word and a web page put on the clipboard (their HTML, cut down).
// Google Docs writes its look on every word: Arial, a size (16 pt in its Heading 2) and black.
const gd = (s, w = 400, size = 11) => `<span style="font-size:${size}pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:${w};font-style:normal;white-space:pre-wrap;">${s}</span>`
const GDOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d"><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;">${gd('GD heading', 400, 16)}</h2><p dir="ltr">${gd('GD words and ')}${gd('bold', 700)}</p><ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation">${gd('GD bullet one')}</p></li><li dir="ltr" style="list-style-type:circle;" aria-level="2"><p dir="ltr" role="presentation">${gd('GD bullet nested')}</p></li></ul><ol><li dir="ltr" style="list-style-type:decimal;" aria-level="1"><p dir="ltr" role="presentation">${gd('GD number one')}</p></li><li dir="ltr" style="list-style-type:decimal;" aria-level="1"><p dir="ltr" role="presentation">${gd('GD number two')}</p></li></ol><ul><li role="checkbox" aria-checked="false" aria-level="1"><p dir="ltr" role="presentation">${gd('GD task')}</p></li></ul><p dir="ltr">${gd('GD after')}</p></b>`
const marker = (m) => `<![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>${m}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>`
const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"></head><body lang=EN-US><!--StartFragment--><p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'>${marker('·')}<span lang=EN-US>Word bullet one<o:p></o:p></span></p><p class=MsoListParagraphCxSpLast style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level2 lfo1'>${marker('o')}<span lang=EN-US>Word bullet two<o:p></o:p></span></p><p class=MsoListParagraph style='text-indent:-.25in;mso-list:l1 level1 lfo2'>${marker('1.')}<span lang=EN-US>Word number one<o:p></o:p></span></p><p class=MsoNormal>Word after<o:p></o:p></p><!--EndFragment--></body></html>`
const WEB = `<h3>Web heading</h3><ul><li>Web bullet</li><li>Web bullet two<ul><li>Web nested</li></ul></li></ul><blockquote><p>Web quote</p></blockquote><p>Web picture <img src="${PICS}/chart.png" alt="chart"> and a missing one <img src="${PICS}/gone.png" alt="gone"></p>`

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/settings', { trials: { studio: true } }, 'PATCH')
  const dir = path.join(kit.home, 'Work', 'drafts')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'report.docx'), await richDocx({ pages: 2 }))
  fs.writeFileSync(path.join(dir, 'other.docx'), await richDocx({ pages: 1 }))
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nA first line.\n')
  // A list of plain items and checklist items together, as people write them by hand.
  const MIXED = '# Northwind\n\n- Renewal in March\n- [ ] Send the pricing doc\n- [x] Book the call\n- Ask about seats\n\nShip it.\n'
  fs.writeFileSync(path.join(dir, 'mixed.md'), MIXED)
  const root = `place:${(await kit.api('/places', { path: dir })).place.id}`
  const file = (n) => path.join(dir, n)
  const w = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const open = async (rel, sel) => until(async () => { await p.evaluate(({ root, rel }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: rel } })), { root, rel }); return p.locator(sel).first().waitFor({ timeout: 2500 }).then(() => true, () => false) }, 25000, 300)
  // The editor itself, for where the cursor goes and what a paragraph is.
  const E = (fn, arg) => p.evaluate(({ fn, arg }) => { const ed = (document.querySelector('.sd-w') || document.querySelector('.sd-page .ProseMirror')).editor; return new Function('ed', 'arg', `return (${fn})(ed, arg)`)(ed, arg) }, { fn: String(fn), arg })
  // A new line at the end, out of any list.
  const atEnd = async () => {
    await E((ed) => { ed.view.focus(); ed.commands.focus('end') })
    await p.keyboard.press('Enter')
    if (await E((ed) => { const $f = ed.state.selection.$from; const a = $f.parent.attrs; return (a.num != null && a.num !== 0) || /item$/i.test($f.node(-1)?.type.name || '') })) await p.keyboard.press('Enter')
  }
  const caret = (text, at = 'end') => E((ed, a) => { let r = null; ed.state.doc.descendants((n, pos) => { if (r == null && n.isTextblock && n.textContent.includes(a.text)) r = a.at === 'end' ? pos + n.nodeSize - 1 : pos + 1 + n.textContent.indexOf(a.text) + a.at; return r == null }); ed.view.focus(); ed.commands.setTextSelection(r) }, { text, at })
  const pick = (text) => E((ed, t) => { let r = null; ed.state.doc.descendants((n, pos) => { if (!r && n.isTextblock && n.textContent.includes(t)) { const i = n.textContent.indexOf(t); r = { from: pos + 1 + i, to: pos + 1 + i + t.length } } return !r }); ed.view.focus(); ed.commands.setTextSelection(r) }, text)
  // A paragraph with some words in it: its style, list and level, its marks, and its bullet or number as drawn.
  const para = async (text) => { await sleep(60); return E((ed, t) => { let r = null; ed.state.doc.descendants((n) => { if (!r && n.isTextblock && n.textContent.includes(t)) r = { text: n.textContent, s: n.attrs.s ?? null, num: n.attrs.num ?? null, lvl: n.attrs.lvl ?? null, marks: [...new Set(n.content.content.flatMap((c) => c.marks.map((m) => m.type.name)))] }; return !r }); if (r) r.mk = [...document.querySelectorAll('.sd-w [data-mk]')].find((x) => x.textContent.includes(t))?.getAttribute('data-mk') ?? null; return r }, text) }
  const images = () => E((ed) => { const r = []; ed.state.doc.descendants((n) => { if (n.type.name === 'image') r.push(n.attrs.src.slice(0, 40)) }); return r })
  // What the clipboard has, as an app's paste event (and a drop) brings it.
  const clip = (type, o) => p.evaluate(({ type, o }) => {
    const el = document.querySelector('.sd-w') || document.querySelector('.sd-page .ProseMirror')
    const dt = new DataTransfer()
    if (o.html) dt.setData('text/html', o.html)
    if (o.text) dt.setData('text/plain', o.text)
    if (o.file) { const bin = atob(o.file.data); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], o.file.name, { type: o.file.type })) }
    if (type === 'drop') {
      const r = el.querySelector('p').getBoundingClientRect()
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }))
      return null
    }
    let e = null
    try { e = new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }) } catch { /* below */ }
    if (!e?.clipboardData) { e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'clipboardData', { value: dt }) }
    el.dispatchEvent(e)
    return type === 'copy' ? dt.getData('text/html') : null
  }, { type, o })
  const png = (w0, h0) => ({ name: 'Screenshot.png', type: 'image/png', data: chartPng(w0, h0).toString('base64') })
  const tb = p.locator('.sd-doc-tools')
  const versions = async (rel) => (await kit.api(`/studio/versions?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`)).versions

  // ---------- A Word file ----------
  ok(!!(await open('report.docx', '.sd-pb')), 'a Word file opens')
  await sleep(500)
  const was = await partsOf(file('report.docx'))
  const xml = async () => (await partsOf(file('report.docx')))['word/document.xml']

  // Pasted from Google Docs, on an empty line: its heading, words, lists and checklist as they were.
  await atEnd()
  await clip('paste', { html: GDOCS, text: 'GD heading' })
  const gdH = await para('GD heading'), gdB = await para('GD words'), gd1 = await para('GD bullet one'), gd2 = await para('GD bullet nested'), gdN1 = await para('GD number one'), gdN2 = await para('GD number two'), gdT = await para('GD task')
  ok(gdH?.s === 'Heading2' && gdB?.marks.includes('bold') && !gdB.num, 'from Google Docs, on an empty line: its heading a heading (Heading 2), its bold bold', { gdH, gdB })
  // Drawn as the document's own Heading 2 ("What we did"): its font, size, weight and colour, not
  // the ones Google Docs wrote on its words.
  const lookOf = (text) => p.evaluate((text) => { const el = [...document.querySelectorAll('.sd-w :is(h1, h2, h3, p)')].find((x) => x.textContent === text); const w = el && document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(); if (!w) return null; const c = getComputedStyle(w.parentElement); return { size: c.fontSize, weight: c.fontWeight, color: c.color, font: c.fontFamily } }, text)
  const pastedLook = await lookOf('GD heading'), ownLook = await lookOf('What we did')
  ok(!!pastedLook && JSON.stringify(pastedLook) === JSON.stringify(ownLook) && !gdH.marks.some((m) => ['ff', 'fs', 'fc'].includes(m)), "and it looks like the document's own Heading 2 (its font, size, weight and colour)", { pastedLook, ownLook, marks: gdH.marks })
  ok(gd1?.num > 0 && gd1.lvl === 0 && /^[•●◦▪■]$/.test(gd1.mk) && gd2?.num === gd1.num && gd2.lvl === 1 && gdN1?.mk === '1.' && gdN2?.mk === '2.' && gdT?.mk === '☐', 'and its bulleted list (a level in where it was), its numbered list from 1, and its checklist', { gd1, gd2, gdN1, gdN2, gdT })
  await shot(p, `${tag}studio-writing-pasted`)
  // From Word: its list paragraphs, without the bullets Word types in front of them.
  await atEnd()
  await clip('paste', { html: WORD, text: 'Word bullet one' })
  const wb1 = await para('Word bullet one'), wb2 = await para('Word bullet two'), wn = await para('Word number one'), wa = await para('Word after')
  ok(wb1?.text === 'Word bullet one' && wb1.num > 0 && wb2?.text === 'Word bullet two' && wb2.lvl === 1 && wn?.text === 'Word number one' && wn.mk === '1.' && !wa?.num, "from Word: its lists as lists, levels kept, without the bullets and numbers Word types in front", { wb1, wb2, wn, wa })
  // From a web page: lists, a quote in the Quote style, and its picture brought into the file; one
  // the web doesn't give is taken out, saying so.
  await atEnd()
  await clip('paste', { html: WEB, text: 'Web heading' })
  const wq = await para('Web quote'), wnest = await para('Web nested')
  ok(wq?.s === 'Quote' && wnest?.num > 0 && wnest.lvl === 1 && (await para('Web heading'))?.s === 'Heading3', 'from a web page: its heading, its nested list, and its quote in the Quote style', { wq, wnest })
  ok(!!(await until(async () => { const im = await images(); return im.some((s) => s.startsWith('data:image/png')) && !im.some((s) => /^http/.test(s)) }, 8000, 150)) && /couldn't be brought in/.test(await p.locator('.sd-doc-said').innerText().catch(() => '')), "its picture brought into the file; the one the web didn't give taken out, and said", { images: await images(), said: await p.locator('.sd-doc-said').innerText().catch(() => '') })
  await p.locator('.sd-doc-said button[aria-label="Close"]').click()
  // ⇧⌘V: as plain text.
  await atEnd()
  await p.keyboard.down('Shift')
  await clip('paste', { html: '<p>Plain <b>paste</b> here</p>', text: 'Plain paste here' })
  await p.keyboard.up('Shift')
  const plain = await para('Plain paste here')
  ok(!!plain && !plain.marks.includes('bold'), '⇧⌘V: pasted without its formatting', plain)
  // A picture on the clipboard (a screenshot), and one dropped on the page.
  const n0 = (await images()).length
  await atEnd()
  await clip('paste', { file: png(120, 60) })
  ok(!!(await until(async () => (await images()).length === n0 + 1, 4000, 100)), 'a picture pasted in', await images())
  await clip('drop', { file: png(60, 40) })
  ok(!!(await until(async () => (await images()).length === n0 + 2, 4000, 100)), 'a picture dropped on the page', await images())
  await clip('drop', { file: { name: 'Budget.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') } })
  ok(!!(await until(async () => /Budget\.pdf isn't a picture/.test(await p.locator('.sd-doc-said').innerText().catch(() => '')), 3000, 100)) && (await images()).length === n0 + 2, "a file that isn't a picture, dropped: said, not put in", await p.locator('.sd-doc-said').innerText().catch(() => ''))
  await p.locator('.sd-doc-said button[aria-label="Close"]').click()

  // Typed as Google Docs takes it: "- ", "1. " and "[] " start lists; Backspace straight after
  // gives back what was typed.
  await atEnd()
  await p.keyboard.type('- Dashed item')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Next dashed')
  const d1 = await para('Dashed item'), d2 = await para('Next dashed')
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter')
  await p.keyboard.type('1. Counted')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Counted again')
  const c1 = await para('Counted'), c2 = await para('Counted again')
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter')
  await p.keyboard.type('[] Pack the bags')
  const t1 = await para('Pack the bags')
  ok(d1?.text === 'Dashed item' && /^[•●◦▪■]$/.test(d1.mk) && d2?.num === d1.num && c1?.mk === '1.' && c2?.mk === '2.' && t1?.mk === '☐' && t1.text === 'Pack the bags', '"- " starts a bulleted list, "1. " a numbered one from 1, "[] " a checklist; Enter goes on with each', { d1, d2, c1, c2, t1 })
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter')
  await p.keyboard.type('- ')
  await p.keyboard.press('Backspace')
  await p.keyboard.type('not a list')
  const back = await para('not a list')
  ok(back?.text === '- not a list' && !back.num, 'Backspace straight after gives back the "- " as typed', back)
  // A checklist: ⇧⌘9 and its button; a box clicked is ticked (and crossed out), clicked again isn't.
  await p.keyboard.press('Enter')
  await p.keyboard.type('Call the venue')
  await p.keyboard.press(`${MOD}+Shift+Digit9`)
  ok((await para('Call the venue'))?.mk === '☐' && (await tb.locator('button[aria-label="Checklist"]').getAttribute('aria-pressed')) === 'true', '⇧⌘9: a checklist, shown on its button', await para('Call the venue'))
  const item = p.locator('.sd-w [data-mk]', { hasText: 'Call the venue' })
  const box = await item.boundingBox()
  await p.mouse.click(box.x - 8, box.y + 6)
  const ticked = await until(async () => (await para('Call the venue'))?.mk === '☑', 3000, 100)
  const look = await item.evaluate((e) => ({ line: getComputedStyle(e).textDecorationLine, color: getComputedStyle(e).color }))
  await p.mouse.click(box.x - 8, box.y + 6)
  ok(!!ticked && look.line === 'line-through' && !!(await until(async () => (await para('Call the venue'))?.mk === '☐', 3000, 100)), 'its box clicked: ticked and crossed out; clicked again, not', look)
  // Shortcuts Google Docs and Word have: ⇧⌘X, ⇧⌘> and ⇧⌘<.
  await atEnd()
  await p.keyboard.type('Sized words')
  await pick('Sized words')
  await p.keyboard.press(`${MOD}+Shift+KeyX`)
  const struck = (await para('Sized words'))?.marks.includes('strike')
  const size = () => p.locator('.sd-size-box input').inputValue()
  const s0 = await size()
  await p.keyboard.press(`${MOD}+Shift+Period`)
  const s1 = await until(async () => { const v = await size(); return v !== s0 && v }, 3000, 100)
  await p.keyboard.press(`${MOD}+Shift+Comma`)
  const s2 = await until(async () => { const v = await size(); return v === s0 && v }, 3000, 100)
  ok(struck && Number(s1) > Number(s0) && s2 === s0, '⇧⌘X strikes through; ⇧⌘> a size bigger, ⇧⌘< back', { struck, s0, s1, s2 })
  // A link the cursor is in: its address, Copy, Change and Remove.
  await atEnd()
  await p.keyboard.type('See our roadmap here')
  await pick('our roadmap')
  await p.keyboard.press(`${MOD}+k`)
  await p.locator('.sd-linkbar input').fill('example.com/roadmap')
  await p.keyboard.press('Enter')
  await caret('See our roadmap here', 6)
  const bubble = p.locator('.sd-link-pop')
  ok(!!(await until(async () => /example\.com\/roadmap/.test(await bubble.innerText().catch(() => '')), 3000, 100)) && (await bubble.locator('a').getAttribute('href')) === 'https://example.com/roadmap' && (await bubble.locator('button').evaluateAll((x) => x.map((e) => e.getAttribute('aria-label')))).join() === 'Copy the address,Change the link,Remove the link', 'the cursor in a link: its address (to open), with Copy, Change and Remove', await bubble.innerText().catch(() => ''))
  await shot(p, `${tag}studio-writing-link`)
  await bubble.locator('button[aria-label="Remove the link"]').click()
  ok(!!(await until(async () => !(await para('See our roadmap'))?.marks.includes('link') && !(await bubble.count()), 3000, 100)), 'Remove: the link taken off, the bubble gone')
  // ⌘G: the next match, with find open.
  await p.keyboard.press(`${MOD}+f`)
  await p.locator('.sd-findbar input').first().fill('the')
  const total = async () => Number(/of (\d+)/.exec(await p.locator('.sd-find-count').innerText())?.[1] || 0)
  await until(async () => (await total()) > 5, 3000, 100)
  const f0 = await p.locator('.sd-find-count').innerText()
  await p.keyboard.press(`${MOD}+g`)
  const f1 = await until(async () => { const v = await p.locator('.sd-find-count').innerText(); return v !== f0 && v }, 3000, 50) || f0
  ok(Number(f1.split(' ')[0]) === Number(f0.split(' ')[0]) % Number(f0.split(' ').pop()) + 1, '⌘G: the next match', { f0, f1 })
  await p.keyboard.press('Escape')
  // ⌘/: the keyboard shortcuts, this computer's way.
  await caret('Next dashed')
  await p.keyboard.press(`${MOD}+Slash`)
  const help = await until(async () => p.locator('.sd-shortcuts').innerText().catch(() => ''), 3000, 100)
  const cmd = (s) => (MOD === 'Meta' ? s : s.replace('⇧⌘', 'Ctrl+Shift+').replace('⌘', 'Ctrl+'))
  ok(!!help && help.includes('Strikethrough') && help.includes(cmd('⇧⌘X')) && help.includes('Checklist') && help.includes(cmd('⇧⌘9')) && /"\[\] " a checklist/.test(help), '⌘/: the keyboard shortcuts, as this computer writes them', help.slice(0, 300))
  await shot(p, `${tag}studio-writing-shortcuts`)
  await p.keyboard.press('Escape')
  // Copied out: its lists as lists, for Google Docs, Word or Mail.
  await E((ed) => { let a = null, z = null; ed.state.doc.descendants((n, pos) => { if (!n.isTextblock) return true; if (a == null && n.textContent === 'Dashed item') a = pos + 1; if (n.textContent === 'Counted again') z = pos + n.nodeSize - 1; return false }); ed.view.focus(); ed.commands.setTextSelection({ from: a, to: z }) })
  const copied = await clip('copy', {})
  ok(/<ul[^>]*><li><p[^>]*>Dashed item<\/p><\/li><li><p[^>]*>Next dashed<\/p><\/li><\/ul><ol[^>]*><li><p[^>]*>Counted<\/p><\/li><li><p[^>]*>Counted again<\/p><\/li><\/ol>/.test(copied), 'copied out: its lists as HTML lists, which other apps take as lists', copied.slice(0, 600))

  // Saved as it was typed: in the file without a Save, and the status line says Saved.
  const typed = await until(async () => { const x = await xml(); return /Counted again/.test(x) && /GD bullet nested/.test(x) && x }, 10000, 200)
  ok(!!typed && !!(await until(async () => /Saved/.test(await p.locator('.sd-status .sd-state').innerText()), 5000, 100)), 'all of it saved as it was typed, without a Save; the status line says Saved', await p.locator('.sd-status').innerText())
  const now = await partsOf(file('report.docx'))
  const listed = (x, t) => (x.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).find((q) => q.includes(t)) || ''
  ok(/<w:numPr><w:ilvl w:val="1"\/>/.test(listed(now['word/document.xml'], 'GD bullet nested')) && /<w:pStyle w:val="Quote"\/>/.test(listed(now['word/document.xml'], 'Web quote')) && /w:lvlText w:val="☐"/.test(now['word/numbering.xml']) && /<w:startOverride w:val="1"\/>/.test(now['word/numbering.xml']) && /<w:drawing>/.test(listed(now['word/document.xml'], 'Web picture')), "saved as Word has them: the lists' levels, the Quote style, the checklist's box, a new list counted from 1, the picture in the file", { nested: listed(now['word/document.xml'], 'GD bullet nested').slice(0, 300) })
  const parts = changed(was, now)
  ok(parts.every((k) => /^word\/(document\.xml|numbering\.xml|styles\.xml|_rels\/document\.xml\.rels|media\/studio)|^\[Content_Types\]\.xml$/.test(k)) && !parts.some((k) => /header|footer|comments|footnotes|settings/.test(k)), 'and nothing else in the file changed: its header, footer, comments and footnotes as they were', parts)
  // A few minutes' saves are one version; ⌘S keeps one where it is.
  const mine = (vs) => vs.filter((v) => v.by === 'you').length
  const v1 = mine(await versions('report.docx'))
  await caret('Next dashed'); await p.keyboard.type(' Ottawa')
  await until(async () => / Ottawa/.test(await xml()), 6000, 150)
  await caret('Next dashed'); await p.keyboard.type(' Quito')
  await until(async () => / Quito/.test(await xml()), 6000, 150)
  const v2 = mine(await versions('report.docx'))
  await p.keyboard.press(`${MOD}+s`)
  await sleep(600)
  await caret('Next dashed'); await p.keyboard.type(' Lima')
  await until(async () => / Lima/.test(await xml()), 6000, 150)
  const v3 = mine(await versions('report.docx'))
  ok(v1 === 1 && v2 === 1 && v3 === 2, 'its saves as you type kept as one version, and ⌘S keeps the one it saved', { v1, v2, v3 })
  // Written in Focus, as in Google Docs' full screen or Word's Focus: ⌘. is still superscript (it
  // doesn't leave), saving as you type goes on and says so, and Esc leaves.
  await caret('Next dashed')
  await p.keyboard.press(`${MOD}+Alt+f`)
  const inFocus = () => p.locator('.sd-file.focus').count().then((n) => n === 1)
  ok(!!(await until(inFocus, 3000, 100)), 'Focus, by its key, while writing')
  await p.keyboard.type(' Bogota')
  await p.keyboard.press(`${MOD}+Period`)
  await p.keyboard.type('2')
  await p.keyboard.press(`${MOD}+Period`)
  await sleep(300)
  const sup = await para('Bogota2')
  ok(await inFocus() && !!sup?.marks.includes('va'), `${MOD === 'Meta' ? '⌘.' : 'Ctrl+.'} while writing: superscript, as in Google Docs and Word, still in Focus`, sup)
  ok(!!(await until(async () => /Bogota/.test(await xml()), 6000, 150)) && !!(await until(async () => /Saved/.test(await p.locator('.sd-file.focus .sd-status .sd-state').innerText()), 5000, 100)), 'in Focus it saves as you type, and the status line says Saved')
  await shot(p, `${tag}studio-writing-focus`)
  await p.keyboard.press('Escape')
  ok(!!(await until(async () => !(await inFocus()), 3000, 100)), 'Esc: out of Focus')
  // And ⌘/ lists its key with the others.
  await p.keyboard.press(`${MOD}+Slash`)
  const keysText = await p.locator('.sd-modal[aria-label="Keyboard shortcuts"]').innerText({ timeout: 5000 }).catch(() => '')
  ok(/Focus: the page alone, Esc to leave/.test(keysText), `${MOD === 'Meta' ? '⌘/' : 'Ctrl+/'}: Focus is among the keyboard shortcuts`, keysText.slice(-400))
  await p.keyboard.press('Escape')

  // Page setup: turned, on A4, a smaller left margin; saved into the file's section.
  const before = await partsOf(file('report.docx'))
  const sheetW = () => p.locator('.sd-sheet').evaluate((e) => e.getBoundingClientRect().width / (parseFloat(e.style.zoom) || 1))
  const w0 = await sheetW()
  await tb.locator('button[aria-label="File"]').click()
  await p.locator('.sd-drop .sd-item', { hasText: 'Page setup' }).click()
  const setup = p.locator('.sd-page-setup')
  await setup.locator('input[value="landscape"]').check()
  await setup.locator('select').selectOption('A4')
  await setup.locator('input[aria-label="Left margin"]').fill(await setup.locator('input[aria-label="Left margin"]').inputValue().then((v) => String(Number(v) / 2)))
  await shot(p, `${tag}studio-writing-page-setup`)
  await setup.locator('button[type="submit"]').click()
  ok(!!(await until(async () => (await sheetW()) > w0 + 200, 3000, 100)), 'Page setup: the page drawn turned', { w0, w1: await sheetW() })
  const sect = await until(async () => { const x = (await partsOf(file('report.docx')))['word/document.xml']; const s = /<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*<\/w:body>/.exec(x)?.[0]; return s && /w:orient="landscape"/.test(s) && s }, 8000, 200)
  const after = await partsOf(file('report.docx'))
  ok(!!sect && /<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"\/>/.test(sect) && /<w:pgMar [^>]*w:left="720"/.test(sect) && /<w:headerReference/.test(sect) && changed(before, after).join() === 'word/document.xml', "saved in the file's section (A4, landscape, the margin), its header and footer still there; nothing else changed", { sect, parts: changed(before, after) })
  await shot(p, `${tag}studio-writing-landscape`)
  // Print (⌘P): its pages on a page of their own, at their size, its header and footer at the top
  // and bottom of each, and the browser's Print.
  await p.evaluate(() => { window.printed = 0; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('sd-print-frame')) n.addEventListener('load', () => { n.contentWindow.print = () => { window.printed++ } }) }).observe(document.body, { childList: true }) })
  await caret('Dashed item')
  await p.keyboard.press(`${MOD}+p`)
  const printed = await until(async () => p.evaluate(() => { const f = document.querySelector('.sd-print-frame'); const d = f?.contentDocument; return window.printed && d ? { text: d.body.innerText.includes('Dashed item'), bands: d.querySelectorAll('.sd-pb').length, style: d.querySelector('style').textContent.match(/@page\{[^}]*\{?[^}]*/)?.[0] } : null }), 6000, 150)
  ok(!!printed && printed.text && printed.bands === 0 && /size:1122\.\d+px 793\.\d+px/.test(printed.style) && /Quarterly plan · internal/.test(printed.style), '⌘P: printed as its pages, at their size, with its header, from the browser\'s Print', printed)
  // A Markdown copy beside it: its headings, lists, checklist, table and picture as Markdown has them.
  await tb.locator('button[aria-label="File"]').click()
  await p.locator('.sd-drop .sd-item', { hasText: 'Markdown copy' }).click()
  ok(!!(await until(async () => /Saved as report\.md, beside it/.test(await p.locator('.sd-doc-said').innerText().catch(() => '')), 10000, 150)), 'a Markdown copy, saved beside it, and said', await p.locator('.sd-doc-said').innerText().catch(() => ''))
  const md = fs.existsSync(file('report.md')) ? fs.readFileSync(file('report.md'), 'utf8') : ''
  const pic = /!\[[^\]]*\]\((images\/report-\d+\.png)\)/.exec(md)?.[1]
  ok(/^## What we did$/m.test(md) && /^- A faster editor/m.test(md) && /^1\. Write the first-hour guide$/m.test(md) && /^- \[ \] Pack the bags$/m.test(md) && /<table/.test(md) && !!pic && fs.existsSync(path.join(dir, pic)) && /pricing page in November/.test(md) && !/in December/.test(md), 'its headings, lists and checklist, its table, its pictures (in images, beside it), and its words as they read now', md.slice(0, 900))

  // A change from elsewhere while you type: saving stops, and it's said; theirs isn't written over.
  await caret('Next dashed'); await p.keyboard.type(' mine')
  const z = await JSZip.loadAsync(fs.readFileSync(file('report.docx')))
  z.file('word/document.xml', (await z.file('word/document.xml').async('string')).replace('Quarterly plan', 'Quarterly plan (theirs)'))
  fs.writeFileSync(file('report.docx'), await z.generateAsync({ type: 'nodebuffer' }))
  ok(!!(await until(async () => /changed this file/.test(await p.locator('.sd-conflict').innerText().catch(() => '')), 8000, 200)) && /theirs/.test(await xml()) && !/ mine/.test(await xml()), 'a change from elsewhere while typing: said, and not written over', await p.locator('.sd-conflict').innerText().catch(() => ''))
  await p.locator('.sd-conflict button', { hasText: 'Show theirs' }).click()
  await until(async () => /theirs/.test(await p.locator('.sd-w').innerText().catch(() => '')), 10000)
  // Left with a save still waiting (another file opened at once): saved all the same.
  await caret('Next dashed'); await p.keyboard.type(' leaving')
  await open('other.docx', '.sd-pb')
  ok(!!(await until(async () => / leaving/.test(await xml()), 6000, 150)), 'another file opened straight after typing: what was typed saved all the same')

  // ---------- Markdown ----------
  ok(!!(await open('notes.md', '.sd-page .ProseMirror')), 'a Markdown file opens')
  await atEnd()
  await p.keyboard.type('[ ] Buy milk')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Call the bank')
  await p.locator('.sd-page li[data-checked] input[type="checkbox"]').first().click()
  await atEnd()
  await p.keyboard.type('Then this')
  await p.keyboard.press(`${MOD}+Shift+Digit9`)
  await atEnd()
  await clip('paste', { html: WORD, text: 'Word bullet one' })
  await atEnd()
  await clip('paste', { file: png(100, 50) })
  await until(async () => (await p.locator('.sd-page img').count()) > 0, 5000, 100)
  const shown = await until(() => p.locator('.sd-page img').first().evaluate((i) => (i.naturalWidth ? { w: i.naturalWidth, src: i.getAttribute('src') } : null)), 5000, 100) || {}
  const saved = await until(async () => { const x = fs.readFileSync(file('notes.md'), 'utf8'); return /Word bullet two/.test(x) && /Screenshot/.test(x) && x }, 8000, 200)
  const kept = fs.existsSync(path.join(dir, 'images')) ? fs.readdirSync(path.join(dir, 'images')) : []
  ok(!!saved && /^- \[x\] Buy milk\n- \[ \] Call the bank$/m.test(saved) && /^- \[ \] Then this$/m.test(saved), 'Markdown: "[ ] " and ⇧⌘9 make a checklist, a box clicked is ticked; saved as Markdown checklists', saved)
  ok(shown.w === 100 && kept.includes('Screenshot.png') && /!\[\]\(images\/Screenshot\.png\)/.test(saved || ''), 'a picture pasted: saved beside it in images, shown, and named in the Markdown', { shown, kept, saved })
  ok(/^- Word bullet one\n {2}- Word bullet two$/m.test(saved || '') && /^1\. Word number one$/m.test(saved || '') && !/·/.test(saved || ''), "Word's lists pasted in as Markdown lists, without its typed-in bullets", saved)
  await shot(p, `${tag}studio-writing-markdown`)
  // A Word copy beside it: its checklist and its picture in the Word file.
  await tb.locator('button[aria-label="File"]').click()
  await p.locator('.sd-drop .sd-item', { hasText: 'Word copy' }).click()
  ok(!!(await until(async () => /Saved as notes\.docx, beside it/.test(await p.locator('.sd-doc-said').innerText().catch(() => '')), 10000, 150)), 'a Word copy, saved beside it, and said')
  const wc = fs.existsSync(file('notes.docx')) ? await partsOf(file('notes.docx')) : {}
  ok(/Buy milk/.test(wc['word/document.xml'] || '') && /<w:drawing>/.test(wc['word/document.xml'] || '') && /w:lvlText w:val="☑"/.test(wc['word/numbering.xml'] || '') && Object.keys(wc).some((k) => /^word\/media\//.test(k)), 'with its checklist (ticked and not) and its picture in it', Object.keys(wc))
  // A list with checklist items among plain ones: shown as written (no empty box for a plain item),
  // and saved as it was.
  const mix = p.locator('.sd-file', { has: p.locator('.pane-head', { hasText: 'mixed.md' }) })
  ok(!!(await open('mixed.md', '.sd-file:has(.pane-head :text("mixed.md")) .sd-page .ProseMirror li')), 'a Markdown file with a mixed list opens')
  const rows = await mix.locator('.sd-page .ProseMirror li').evaluateAll((els) => els.map((e) => `${e.hasAttribute('data-checked') ? `[${e.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ` : ''}${((e.querySelector(':scope > div') || e).querySelector('p')?.innerText || '').trim()}`))
  ok(JSON.stringify(rows) === JSON.stringify(['Renewal in March', '[ ] Send the pricing doc', '[x] Book the call', 'Ask about seats']), 'a list with checklist items among plain ones: each item as written, no empty box for a plain one', rows)
  await mix.locator('.sd-page .ProseMirror p', { hasText: 'Ship it.' }).click()
  await p.keyboard.press('End')
  await p.keyboard.type(' Today.')
  const mixed = await until(() => { const x = fs.readFileSync(file('mixed.md'), 'utf8'); return /Today\./.test(x) && x }, 8000, 200)
  ok(!!mixed && mixed.includes('- Renewal in March\n- [ ] Send the pricing doc\n- [x] Book the call\n- Ask about seats\n'), 'and saved as it was written, one list, after typing elsewhere in it', mixed)
  ok(w.errors.length === 0, 'no page errors', w.errors)

  // ---------- Dark ----------
  const dark = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark' })
  pages.push(dark)
  await dark.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await until(async () => { await dark.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'report.docx' } })), { root }); return dark.p.locator('.sd-pb').first().waitFor({ timeout: 2000 }).then(() => true, () => false) }, 25000, 300)
  // The cursor in the file's link, its checklist on the page.
  await dark.p.evaluate(() => { const ed = document.querySelector('.sd-w').editor; let r = null; ed.state.doc.descendants((n, pos) => { if (r == null && n.isText && n.marks.some((m) => m.type.name === 'link')) r = pos + 1; return r == null }); ed.view.focus(); ed.commands.setTextSelection(r); ed.commands.scrollIntoView() })
  await sleep(400)
  const pop = await dark.p.locator('.sd-link-pop').evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => null)
  ok(!!pop && pop !== 'rgb(255, 255, 255)', 'dark: the link bubble in the dark look', pop)
  await shot(dark.p, `${tag}studio-writing-dark`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  pics.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
