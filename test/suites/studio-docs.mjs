// Studio's documents and its home, on any platform, in the browser named by BRIDGE_TEST_BROWSER.
// A Word file with most of what Word puts in one (lib/wordfile.mjs: headers and footers with page
// numbers, a comment, tracked changes, a footnote, lists, a table with a merged cell, a picture,
// a bookmark, a link) opened as pages, edited and saved back with everything it didn't change
// exactly as it was, part by part and paragraph by paragraph; its toolbar (styles, fonts, sizes,
// colours, highlight, alignment, spacing, lists), pictures put in and resized, tables, its header
// edited, find and replace, the outline, the word count; Ask AI in place on a Markdown file (the
// change shown before it's taken, and a model that can't answer saying why). Studio's home: your
// files from wherever they are (Spotlight on a Mac, the recently used list on Linux, a look in the
// usual folders elsewhere), each with its folder, when it changed and Open, looked for only once
// Studio is opened; a folder added. On a phone: the home and a Word file as one column, fitting.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults, TEST, ROOT } from '../lib/harness.mjs'
import { richDocx, chartPng } from '../lib/wordfile.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const JSZip = require('jszip')
const { ok, done } = checks('studio-docs')
const kit = await startKit('studio-docs', { env: { CLAUDE_STAND_IN_TYPED: '1' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
// Spotlight, standing in: the kit's home's documents as mdfind prints them, each run noted.
const asked = path.join(kit.home, 'mdfind.log')
kit.program('mdfind', `const fs=require('fs'),path=require('path');fs.appendFileSync(${JSON.stringify(asked)},process.argv.slice(2).join(' ')+'\\n');const home=${JSON.stringify(kit.home)};const out=[];const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\\.(docx|xlsx|pptx|pdf)$/.test(e.name))out.push(p+'   kMDItemLastUsedDate = 2026-11-05 10:00:00 +0000   kMDItemFSContentChangeDate = 2026-11-04 09:00:00 +0000')}};walk(home);console.log(out.join('\\n'))`)
const model = await startModel('studio-docs')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const api = kit.api
const pages = []
const partsOf = async (file) => { const z = await JSZip.loadAsync(fs.readFileSync(file)); const o = {}; for (const n of Object.keys(z.files)) if (!z.files[n].dir) o[n] = await z.file(n).async('string'); return o }
const changed = (a, c) => Object.keys({ ...a, ...c }).filter((k) => a[k] !== c[k]).sort()
// The caret put at the end of the paragraph with some words in it (or of the document), through the
// editor itself: a keyboard's way to the end of a document isn't the same in every browser a test runs.
const caret = (p, where, sel = '.sd-w') => p.evaluate(({ where, sel }) => {
  const e = document.querySelector(sel).editor
  let at = null
  if (where !== 'end') e.state.doc.descendants((n, pos) => { if (at == null && n.isTextblock && n.textContent.includes(where)) at = pos + n.nodeSize - 1; return at == null })
  // Focused now (the editor's own focus waits a frame, and a key pressed meanwhile goes elsewhere).
  e.view.focus()
  e.commands.focus(where === 'end' ? 'end' : at)
}, { where, sel })
// The words of the paragraph with some words in it, picked whole (two triple clicks in a row are
// counted on by the editor as more clicks, so a test picks them this way).
const pickAll = (p, where, sel = '.sd-w') => p.evaluate(({ where, sel }) => {
  const e = document.querySelector(sel).editor
  let r = null
  e.state.doc.descendants((n, pos) => { if (!r && n.isTextblock && n.textContent.includes(where)) r = { from: pos + 1, to: pos + n.nodeSize - 1 }; return !r })
  e.view.focus()
  e.commands.setTextSelection(r)
}, { where, sel })
const paras = (xml) => xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []
const bare = (p, scope = '.sd-file') => p.locator(scope).evaluateAll((els) => els.flatMap((root) => [...root.querySelectorAll('button, a[href], select, input')]
  .filter((x) => x.getClientRects().length && x.type !== 'file')
  .filter((x) => { const text = x.innerText?.trim(); return !(x.getAttribute('aria-label') || text) || (x.tagName === 'BUTTON' && !text && !x.title) })
  .map((x) => x.outerHTML.slice(0, 140))))
try {
  await api('/setup', { name: 'Tester' })
  await api('/settings', { trials: { studio: true } }, 'PATCH')
  const dir = path.join(kit.home, 'Work', 'plans')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'report.docx'), await richDocx({ pages: 3 }))
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nThis is teh plan for the week.\n\nIt will fail on purpose here.\n')
  const downloads = path.join(kit.home, 'Downloads')
  fs.mkdirSync(downloads, { recursive: true })
  fs.writeFileSync(path.join(downloads, 'Contract.docx'), await richDocx({ pages: 1 }))
  fs.writeFileSync(path.join(downloads, 'Budget 2027.xlsx'), 'x')
  // Linux: the desktop's list of recently used files says so too.
  if (process.platform === 'linux') {
    fs.mkdirSync(path.join(kit.home, '.local', 'share'), { recursive: true })
    fs.writeFileSync(path.join(kit.home, '.local', 'share', 'recently-used.xbel'), `<?xml version="1.0"?>\n<xbel version="1.0"><bookmark href="file://${encodeURI(path.join(downloads, 'Contract.docx'))}" added="2026-11-04T09:00:00Z" modified="2026-11-04T09:00:00Z" visited="2026-11-05T10:00:00Z"></bookmark></xbel>\n`)
  }
  const place = (await api('/places', { path: dir })).place
  const root = `place:${place.id}`
  const F = (p) => ({ root, path: p })
  const file = (n) => path.join(dir, n)

  // ---------- The server ----------
  // Your files: found only when asked, a place's through the place, others through their folder.
  ok(!fs.existsSync(asked), 'nothing is looked for before Studio asks (Spotlight not asked)')
  const found = await api('/studio/found')
  const contract = found.files.find((f) => f.name === 'Contract.docx')
  const report = found.files.find((f) => f.name === 'report.docx')
  // Its folder as the computer writes it (~\Downloads on Windows).
  const downloadsShown = `~${path.sep}Downloads`
  ok(!!contract && /^found:[0-9a-f]{12}$/.test(contract.root) && contract.dir === downloadsShown && contract.where === null && contract.kind === 'doc' && !Number.isNaN(Date.parse(contract.at)), 'Studio\'s home finds a document in Downloads, with its folder and when it changed, to open through its folder', contract)
  ok(!!report && report.root === root && report.path === 'report.docx', 'one in a place opens through the place', report)
  ok(found.sources.includes(process.platform === 'darwin' ? 'spotlight' : process.platform === 'linux' ? 'xbel' : 'folders') && (process.platform !== 'darwin' || fs.existsSync(asked)), `found by ${found.sources.join(', ')}`, found)
  ok((await api(`/studio/open?root=${encodeURIComponent(contract.root)}&path=${encodeURIComponent(contract.path)}`)).kind === 'doc', 'a file found in Downloads opens')
  ok(/didn't find that folder/.test((await api('/studio/open?root=found:000000000000&path=x.docx').catch((e) => e)).message || ''), 'a folder Studio never found doesn\'t open, saying so')
  // Edit in place: the model picked for Studio rewrites what's picked; a model that can't, says why.
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { studio: { model: 'openai:gpt-5' } }, 'PATCH')
  const rw = await api('/studio/rewrite', { text: 'teh plan', instruction: 'Fix the spelling.' })
  ok(rw.text === 'The plan' && rw.model === 'openai:gpt-5' && model.asked(/^Instruction: Fix the spelling/).length > 0, 'Edit in place: the words picked, rewritten by the model picked for Studio', rw)
  ok(/Pick the words/.test((await api('/studio/rewrite', { text: ' ', instruction: 'x' }).catch((e) => e)).message || ''), 'nothing picked: it says so')
  const writer = await api('/studio/writer')
  ok(writer.model?.id === 'openai:gpt-5' && writer.picked && writer.models.some((m) => m.id === 'openai:gpt-5'), 'which model writes, and the others to pick from', writer)

  // ---------- Studio's home ----------
  const w = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const home = () => until(async () => { await p.locator('.rail-nav-btn', { hasText: 'Studio' }).click(); return p.locator('.sd-home').waitFor({ timeout: 1500 }).then(() => true, () => false) }, 20000, 300)
  ok(!!(await home()), 'Studio opens from the rail')
  const row = (name) => p.locator('.sd-files-row', { hasText: name })
  ok(!!(await until(async () => (await row('Contract.docx').count()) === 1 && (await row('report.docx').count()) === 1, 10000)), 'its home lists your files from wherever they are')
  const cells = await row('Contract.docx').evaluate((r) => ({ dir: r.querySelector('.sd-file-dir')?.innerText, when: r.querySelector('.sd-file-when')?.innerText, open: !!r.querySelector('.sd-file-acts .btn') }))
  ok(cells.dir === downloadsShown && !!cells.when && cells.open, 'each with its folder, when it changed, and Open', cells)
  await p.locator('.sd-filter button', { hasText: 'Sheets' }).click()
  ok(!!(await until(async () => (await row('Budget 2027.xlsx').count()) === 1 && (await row('report.docx').count()) === 0, 3000, 100)), 'filtered by kind: Sheets')
  await p.locator('.sd-filter button', { hasText: 'All' }).click()
  await p.locator('.sd-files-search input').fill('contr')
  ok(!!(await until(async () => (await p.locator('.sd-files-row:not(.head)').count()) === 1, 3000, 100)), 'and by name')
  await p.locator('.sd-files-search input').fill('')
  ok(/Spotlight|recently used|folders/.test(await p.locator('.sd-files-src').innerText()), 'it says where it looked', await p.locator('.sd-files-src').innerText())
  // Add a folder (a browser on this computer: typed), and its files are looked for.
  const extra = path.join(kit.home, 'Projects', 'site')
  fs.mkdirSync(extra, { recursive: true })
  fs.writeFileSync(path.join(extra, 'Brief.md'), '# Brief\n')
  await p.locator('.sd-add-folder button', { hasText: 'Add a folder' }).click()
  await p.locator('.sd-add-form input').fill(extra)
  await p.locator('.sd-add-form button', { hasText: 'Add' }).first().click()
  ok(!!(await until(async () => (await api('/places')).places.some((x) => /Projects[\\/]site$/.test(x.path)) && (await row('Brief.md').count()) === 1, 10000)), 'Add a folder: a place in Files, and its files in the list')
  await shot(p, `${tag}studio-docs-home`)
  ok(!(await bare(p, '.sd-home')).length, 'nothing on the home is a bare control', await bare(p, '.sd-home'))

  // ---------- A Word file, as pages ----------
  await row('report.docx').locator('.sd-file-acts .btn').click()
  const doc = p.locator('.sd-w')
  ok(!!(await until(async () => (await p.locator('.sd-pb').count()) > 0, 20000)), 'a Word file opens as pages')
  const look = await p.evaluate(() => ({
    head: document.querySelector('.sd-pb-top .sd-pb-head')?.innerText, foot: document.querySelector('.sd-pb-end .sd-pb-foot')?.innerText,
    comment: !!document.querySelector('.sd-w .sd-cmt'), ins: document.querySelector('.sd-w ins.sd-rev')?.innerText, del: document.querySelector('.sd-w del.sd-rev')?.innerText,
    note: !!document.querySelector('.sd-w .sd-x-fn'), merged: !!document.querySelector('.sd-w td[rowspan="2"]'), picture: !!document.querySelector('.sd-w img'),
    bullet: !!document.querySelector('.sd-w [data-mk="•"]'), number: !!document.querySelector('.sd-w [data-mk="1."]'), status: document.querySelector('.sd-status')?.innerText,
  }))
  ok(/Quarterly plan · internal/.test(look.head || '') && /^Page \d+ of \d+$/.test(look.foot || ''), 'its header on the page, its footer with the page number and the number of pages', look)
  ok(look.comment && /November/.test(look.ins || '') && /December/.test(look.del || '') && look.note && look.merged && look.picture && look.bullet && look.number, 'its comment, tracked changes, footnote, merged cell, picture and lists, as Word shows them', look)
  const status = await until(async () => { const x = await p.locator('.sd-status').innerText(); return /^Page 1 of [2-9]/.test(x) && x }, 5000, 100)
  ok(!!status && /Saved/.test(status), 'the status line: the page you\'re on of how many, and opened is not changed', status || await p.locator('.sd-status').innerText())
  await shot(p, `${tag}studio-docs-word`)
  // The toolbar: each control named, with its shortcut in its tooltip.
  const tb = p.locator('.sd-doc-tools')
  const names = await tb.locator('button').evaluateAll((bs) => bs.map((x) => x.getAttribute('aria-label')))
  const want = ['Undo', 'Redo', 'Text style', 'Font', 'Smaller', 'Bigger', 'Bold', 'Italic', 'Underline', 'More text formatting', 'Text colour', 'Highlight', 'Alignment', 'Line and paragraph spacing', 'Bulleted list', 'Numbered list', 'Decrease indent', 'Increase indent', 'Insert link', 'Insert picture', 'Table', 'Insert', 'Tracked changes', 'Comments', 'Outline', 'Find and replace', 'Zoom']
  ok(want.every((n) => names.includes(n)) && !names.includes('Inline code'), "a Word file's toolbar: styles, fonts and sizes, marks, colours, alignment and spacing, lists, links, pictures, tables, and the view", names)
  const tips = await tb.locator('button[aria-label="Bold"], button[aria-label="Numbered list"], button[aria-label="Find and replace"]').evaluateAll((bs) => bs.map((x) => x.title))
  ok(tips.every((x) => /\(.*(⌘|Ctrl)/.test(x)), 'with their shortcuts in their tooltips', tips)
  ok(!(await bare(p)).length, 'nothing on the page is a bare control', await bare(p))
  // The outline: its headings; one tapped is where you are.
  ok((await p.locator('.sd-outline-item').allInnerTexts()).join('|').startsWith('Summary|What we did|Numbers|Next steps'), 'the outline: the document\'s headings', await p.locator('.sd-outline-item').allInnerTexts())
  await p.locator('.sd-outline-item', { hasText: 'Next steps' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-outline-item.on').innerText().catch(() => '')) === 'Next steps', 3000, 100)), 'a heading tapped in the outline is where you are')

  // ---------- Saved, exactly ----------
  const was = await partsOf(file('report.docx'))
  await caret(p, 'We ship the pricing page')
  await p.keyboard.type(' Agreed.')
  ok(/Unsaved changes/.test(await p.locator('.sd-status').innerText()), 'typed: unsaved changes')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const now = await until(async () => { const x = await partsOf(file('report.docx')); return /Agreed/.test(x['word/document.xml']) && x }, 10000)
  ok(!!now && changed(was, now).join() === 'word/document.xml', 'saved: only the document part changed; styles, numbering, comments, footnotes, header, footer, settings and the picture as they were, byte for byte', now && changed(was, now))
  const gone = paras(was['word/document.xml']).filter((x) => !now['word/document.xml'].includes(x))
  const edited = paras(now['word/document.xml']).find((x) => /Agreed/.test(x)) || ''
  ok(gone.length === 1 && /pricing page/.test(gone[0]) && /<w:ins /.test(edited) && /<w:del /.test(edited) && /footnoteReference/.test(edited), 'every paragraph but the one edited as it was; that one keeps its tracked changes and footnote', { gone: gone.length, edited: edited.slice(0, 600) })
  // Typed and taken back, saved: the file as it was before.
  await caret(p, 'Agreed.')
  for (let i = 0; i < 8; i++) await p.keyboard.press('Backspace')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const back = await until(async () => { const x = await partsOf(file('report.docx')); return !/Agreed/.test(x['word/document.xml']) && x }, 10000)
  ok(!!back && !changed(was, back).length, 'the edit taken back and saved: every part exactly as it was', back && changed(was, back))

  // ---------- Formatting ----------
  await caret(p, 'end')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Toggle me')
  const line = () => doc.locator(':is(p,h1,h2,h3)', { hasText: 'Toggle me' })
  const pick = () => pickAll(p, 'Toggle me')
  const drop = async (name, item) => { await tb.locator(`button[aria-label="${name}"]`).click(); await p.locator('.sd-drop .sd-item, .sd-drop .sd-sw', { hasText: item }).first().click() }
  await pick()
  const btn = (n) => tb.locator(`button[aria-label="${n}"]`)
  const marks = []
  for (const [n, sel] of [['Bold', 'strong'], ['Italic', 'em'], ['Underline', 'u']]) {
    await btn(n).click()
    const on = !!(await until(async () => (await line().locator(sel).count()) === 1 && (await btn(n).getAttribute('aria-pressed')) === 'true', 3000, 100))
    await btn(n).click()
    const off = !!(await until(async () => (await line().locator(sel).count()) === 0, 3000, 100))
    marks.push(`${n} ${on ? 'on' : 'NOT ON'} ${off ? 'off' : 'NOT OFF'}`)
  }
  ok(marks.every((x) => /on off$/.test(x)), 'Bold, Italic and Underline do what they say, shown on their buttons', marks)
  await pick()
  await btn('Text colour').click()
  await p.locator('.sd-drop .sd-sw[aria-label="#CC0000"]').click()
  await btn('Highlight').click()
  await p.locator('.sd-drop .sd-sw[aria-label="yellow"]').click()
  await btn('Bigger').click()
  await drop('Font', 'Calibri Light')
  await drop('Alignment', 'Center')
  await drop('Line and paragraph spacing', 'Double')
  await drop('More text formatting', 'Strikethrough')
  // Read where the words are: the innermost of the marks' elements around them.
  const st = await line().evaluate((e) => { const t = document.createTreeWalker(e, NodeFilter.SHOW_TEXT).nextNode(); const c = getComputedStyle(t.parentElement); return { color: c.color, bg: getComputedStyle(e.querySelector('mark') || e).backgroundColor, size: c.fontSize, font: c.fontFamily, align: getComputedStyle(e).textAlign, lh: e.style.lineHeight, strike: !!e.querySelector('s') } })
  ok(st.color === 'rgb(204, 0, 0)' && st.bg === 'rgb(255, 255, 0)' && st.size === '16px' && /Calibri Light/.test(st.font) && st.align === 'center' && !!st.lh && st.strike, 'colour, highlight, size, font, alignment, line spacing and strikethrough, on what\'s picked', st)
  await drop('Text style', 'Heading 2')
  ok(!!(await until(async () => (await doc.locator('h2', { hasText: 'Toggle me' }).count()) === 1, 3000, 100)), 'Text style: Heading 2')
  await line().click()
  await p.keyboard.press(`${MOD}+Alt+Digit0`)
  ok(!!(await until(async () => (await doc.locator('p', { hasText: 'Toggle me' }).count()) === 1, 3000, 100)), 'and back to Normal from the keyboard')
  await btn('Bulleted list').click()
  const bullet = !!(await until(async () => /^[•●◦▪■]$/.test(await line().getAttribute('data-mk') || ''), 3000, 100))
  await btn('Numbered list').click()
  ok(bullet && !!(await until(async () => /^\d+\.$/.test(await line().getAttribute('data-mk') || ''), 3000, 100)), 'a bulleted list, then numbered')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const fmt = await until(async () => { const x = (await partsOf(file('report.docx')))['word/document.xml']; const q = paras(x).find((y) => /Toggle me/.test(y)); return q && /<w:numPr>/.test(q) && q }, 10000)
  ok(!!fmt && /<w:jc w:val="center"\/>/.test(fmt) && /w:line="480"/.test(fmt) && /<w:color w:val="CC0000"\/>/.test(fmt) && /<w:highlight w:val="yellow"\/>/.test(fmt) && /w:ascii="Calibri Light"/.test(fmt) && /<w:sz w:val="24"\/>/.test(fmt) && /<w:strike\/>/.test(fmt), 'saved as Word has them: alignment, spacing, colour, highlight, font, size, strikethrough and the list', fmt)

  // ---------- Pictures, tables, header ----------
  await caret(p, 'Toggle me')
  await p.keyboard.press('Enter')
  await tb.locator('input[type="file"]').setInputFiles({ name: 'chart.png', mimeType: 'image/png', buffer: chartPng(120, 70) })
  ok(!!(await until(async () => (await doc.locator('img[src^="data:image/png"]').count()) === 1, 5000, 100)), 'a picture put in')
  // The chart already there, made smaller by its corner.
  const chart = doc.locator('img[src^="blob:"]').first()
  await chart.click()
  const box = await chart.boundingBox()
  const handle = p.locator('.sd-w [data-resize-container]:has(img[src^="blob:"])').first().locator('[data-resize-handle="bottom-right"]')
  const hb = await handle.boundingBox()
  if (hb) { await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x - 80, hb.y - 40, { steps: 6 }); await p.mouse.up() }
  ok(!!hb && !!(await until(async () => ((await chart.boundingBox())?.width || box.width) < box.width - 40, 3000, 100)), 'a picture resized by its corner', { box, after: await chart.boundingBox() })
  await caret(p, 'end')
  await tb.locator('button[aria-label="Table"]').click()
  await p.locator('.sd-grid-cell[aria-label="2 by 3"]').click()
  const tables = await doc.locator('table').count()
  await p.keyboard.type('Cell one')
  await tb.locator('button[aria-label="Table"]').click()
  await p.locator('.sd-drop .sd-item', { hasText: 'Add a row below' }).click()
  // Its own rows: where a page ends inside a table (as it can with another computer's fonts), the
  // page's band is a row of its own between them.
  const rowsOf = () => doc.locator('table').last().locator('tr:not(.sd-pb-row)').count()
  ok(tables === 2 && (await rowsOf()) === 3, 'a table picked by its size from a grid, and a row added', { tables, rows: await rowsOf() })
  // The header, edited (a double click on it).
  await p.locator('.sd-desk').evaluate((e) => { e.scrollTop = 0 })
  await p.locator('.sd-pb-top').dblclick()
  const hed = p.locator('.sd-hf .ProseMirror').first()
  await hed.waitFor({ timeout: 5000 })
  await hed.click()
  await p.keyboard.press('End')
  await p.keyboard.type(' (draft)')
  await shot(p, `${tag}studio-docs-header`)
  await p.locator('.sd-hf button', { hasText: 'Done' }).click()
  ok(!!(await until(async () => /\(draft\)/.test(await p.locator('.sd-pb-top .sd-pb-head').innerText().catch(() => '')), 5000, 100)), 'the header changed, on every page')
  const before = await partsOf(file('report.docx'))
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const after = await until(async () => { const x = await partsOf(file('report.docx')); return Object.values(x).some((v) => /\(draft\)/.test(v)) && x }, 10000)
  const parts = after ? changed(before, after) : []
  const stylesKept = after && (after['word/styles.xml'] === before['word/styles.xml'] || after['word/styles.xml'].replace(/<w:style [^>]*w:styleId="TableGrid"[\s\S]*?<\/w:style>/, '') === before['word/styles.xml'])
  ok(!!after && parts.includes('word/header1.xml') && !parts.some((k) => /footer|comments|footnotes|numbering|settings/.test(k)) && stylesKept && parts.some((k) => /^word\/media\/studio/.test(k)) && /Extension="png"/i.test(after['[Content_Types].xml']), 'saved: the header part, the document and the new picture (with its relationship and type); nothing else but the table style it now uses', parts)
  const drawn = after?.['word/document.xml'] || ''
  const made = (drawn.match(/<w:tbl>(?:(?!<\/w:tbl>)[\s\S])*Cell one[\s\S]*?<\/w:tbl>/) || [''])[0]
  const cols = [...made.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]))
  ok(!drawn.includes('cx="2286000"') && cols.length === 3 && cols.every((w) => w > 1000) && !/<w:tcW w:w="0"/.test(made) && /TableGrid/.test(after['word/styles.xml']), 'the picture\'s new size, and the new table in Word\'s Table Grid style, its columns sharing the page\'s width', { hasOldSize: drawn.includes('cx="2286000"'), cols })

  // ---------- Find and replace, word count ----------
  await doc.click()
  await p.keyboard.press(`${MOD}+f`)
  await p.locator('.sd-findbar input').first().fill('quarter')
  ok(!!(await until(async () => /of \d+/.test(await p.locator('.sd-find-count').innerText()), 3000, 100)) && (await doc.locator('.sd-find').count()) > 2, 'Find: every match marked, and which one of how many', await p.locator('.sd-find-count').innerText())
  await p.locator('.sd-findbar button[aria-label="Replace"]').click()
  await p.locator('.sd-findbar input').nth(1).fill('term')
  await p.locator('.sd-findbar button', { hasText: 'Replace all' }).click()
  ok(!!(await until(async () => /Replaced \d+/.test(await p.locator('.sd-findbar').innerText()) && !/quarter/.test(await doc.innerText()), 3000, 100)), 'Replace all, and how many it replaced')
  await p.keyboard.press('Escape')
  await doc.click()
  await p.keyboard.press(`${MOD}+z`)
  ok(!!(await until(async () => /quarter/.test(await doc.innerText()), 3000, 100)), 'and undone in one step')
  await p.locator('.sd-status button.sd-stat').click()
  ok(!!(await until(async () => /Words\s*[\d,]+/.test(await p.locator('.sd-count').innerText().catch(() => '')), 3000, 100)), 'the word count, from the status line', await p.locator('.sd-count').innerText().catch(() => ''))
  await p.keyboard.press('Escape')
  ok(w.errors.length === 0, 'no page errors', w.errors)

  // ---------- Ask AI, in place (Markdown) ----------
  await p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'notes.md' } })), { root })
  const md = p.locator('.sd-page .ProseMirror')
  await until(async () => /teh plan/.test(await md.innerText().catch(() => '')), 15000)
  await md.locator('p', { hasText: 'teh plan' }).click({ clickCount: 3 })
  await p.mouse.move(5, 5)
  await p.locator('.sd-bubble-ai').click()
  ok(!!(await until(async () => (await p.locator('.sd-ask-model select').inputValue().catch(() => '')) === 'openai:gpt-5', 5000, 100)), 'Ask AI: which model writes, there to change')
  await p.locator('.sd-ask-menu .sd-item', { hasText: 'Fix spelling and grammar' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-ask-diff del').count()) > 0 && /the/.test(await p.locator('.sd-ask-diff ins').allInnerTexts().then((x) => x.join(' '))), 15000)), 'Ask AI: the change shown against your words before it\'s taken', await p.locator('.sd-ask-card').innerText().catch(() => ''))
  ok(/gpt-5/.test(await p.locator('.sd-ask-card-head').innerText()), 'and which model wrote it')
  await shot(p, `${tag}studio-docs-ask`)
  await p.locator('.sd-ask-card button', { hasText: 'Replace' }).click()
  ok(!!(await until(async () => /This is the plan/.test(await md.innerText()), 3000, 100)) && /Unsaved/.test(await p.locator('.sd-status').innerText()), 'Replace: taken, as a change to save')
  await api('/settings', { studio: { model: 'anthropic:claude-test' } }, 'PATCH')
  await pickAll(p, 'fail on purpose', '.sd-page .ProseMirror')
  await p.locator('.sd-bubble-ai').click()
  await p.locator('.sd-ask-menu .sd-item', { hasText: 'Shorten' }).click()
  ok(!!(await until(async () => /Anthropic key/.test(await p.locator('.sd-ask-card [role="alert"]').innerText().catch(() => '')), 10000)), 'a model that can\'t answer says why', await p.locator('.sd-ask-card').innerText().catch(() => ''))
  await p.locator('.sd-ask-card button', { hasText: 'Discard' }).click()

  // ---------- Dark ----------
  const dark = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark' })
  pages.push(dark)
  await dark.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  // Asked again until it opens: a page can take the event before the app is listening.
  await until(async () => { await dark.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'report.docx' } })), { root }); return dark.p.locator('.sd-pb').first().waitFor({ timeout: 2000 }).then(() => true, () => false) }, 25000, 300)
  ok(await dark.p.locator('.sd-w').evaluate((e) => getComputedStyle(e).backgroundColor) === 'rgb(255, 255, 255)', 'in the dark look, the page is still paper')
  await shot(dark.p, `${tag}studio-docs-word-dark`)

  // ---------- A phone ----------
  const ph = await page(b, kit.url, { phone: true })
  pages.push(ph)
  await ph.p.locator('nav.tabbar button', { hasText: 'More' }).first().click({ timeout: 20000 })
  await ph.p.locator('button, .m-more-row', { hasText: 'Studio' }).first().click({ timeout: 10000 })
  await ph.p.waitForSelector('.sd-home', { timeout: 15000 })
  await until(async () => (await ph.p.locator('.sd-files-row', { hasText: 'report.docx' }).count()) > 0, 10000)
  await sleep(400)
  let f = await phoneFaults(ph.p, '.sd-home')
  ok(!Object.keys(f).length, 'phone: Studio\'s home fits, each control a whole target', f)
  await shot(ph.p, `${tag}studio-docs-home-phone`)
  await ph.p.locator('.sd-files-row', { hasText: 'report.docx' }).locator('.sd-file-name').click()
  await until(async () => (await ph.p.locator('.sd-word.flow .sd-w').count()) > 0, 15000)
  await sleep(600)
  f = await phoneFaults(ph.p, '.sd-file')
  ok(!Object.keys(f).length && (await ph.p.locator('.sd-pb').count()) === 0 && await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: a Word file as one column, no pages, fitting the screen', f)
  await shot(ph.p, `${tag}studio-docs-word-phone`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
