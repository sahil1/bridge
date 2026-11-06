// Studio, on any platform, in the browser named by BRIDGE_TEST_BROWSER. A folder you added to Files
// (a place) with a Word file, an Excel file, a Markdown file, a Markdown deck, a page, a CSV and a
// PDF, all made here. The server: each opens as its kind; a save keeps a version, and one over a
// change made meanwhile is refused; a change from outside, or from an agent asked, is kept as a
// version by them; an older version put back keeps the one before too; a new file never
// overwrites; design packs. The page: Studio's home with New and Recent; a Markdown file edited
// and saved; a Word file's text; a sheet, still saved until a value's typed in, then saved with it; a deck drawn, and its PowerPoint beside it; a page drawn
// as it's typed; versions and Put back; Ask an agent queueing the change for the agent you pick.
// The editors finished: a Markdown file's toolbar (only what Markdown keeps), a Word file in its own
// look saved with every other part as it was (its editor in full is studio-docs.mjs); the header's
// kind, size and folder never cut off; the status line; each kind saying what it is and what it
// can't do; on 375 and 430 px phones, Studio's home and a document fitting.
// A sheet: Excel's ribbon with Ask AI first, the name box and tabs; Ask AI on the cells picked,
// the agent told to answer with the change, which is shown on the sheet before it's made, kept and
// saved, or put back; a summary beside it; a chart drawn first, then in Charts and saved as an
// Excel chart; an answer that isn't JSON said. An Excel file with a chart, a note, a dropdown and
// more, one cell changed and saved: every other part the same bytes, and read back the same. A CSV
// in semicolons with a BOM and Windows line endings, saved back the same but for the one field.
// On phones, a sheet and Ask AI fitting; a sheet in the dark look.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults, TEST, ROOT } from '../lib/harness.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const { ok, done } = checks('studio')
const kit = await startKit('studio', { env: { CLAUDE_STAND_IN_TYPED: '1' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const model = await startModel('studio')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const err = (p, body, method) => api(p, body, method).then(() => null, (e) => e)
const q = (f) => `root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`
const put = (f, body, mtime) => fetch(`${kit.url}/api/studio/file?${q(f)}&mtime=${mtime}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
const pages = []
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
// Controls on a file's page that are bare: no name, or only an icon and no tooltip (Univer's own
// sheet controls aside).
const bare = (p) => p.locator('.sd-file').evaluateAll((els) => els.flatMap((root) => [...root.querySelectorAll('button, a[href], select')]
  .filter((b) => !b.closest('.sd-univer') && b.getClientRects().length)
  .filter((b) => { const text = b.innerText.trim(); return !(b.getAttribute('aria-label') || text) || (!text && !b.title) })
  .map((b) => b.outerHTML.slice(0, 140))))
try {
  await api('/setup', { name: 'Tester' })
  await api('/agents/catalog')
  // A beta feature: off to start with, its routes refused and nothing leading to it, until it's
  // turned on (Settings › About & Updates › Beta Features, checked on the page below).
  ok((await api('/config')).trials?.studio === false && /beta feature/.test((await err('/studio/recent'))?.message || ''), 'Studio is a beta feature, off to start with: its routes say how to turn it on', (await api('/config')).trials)
  await api('/settings', { trials: { studio: true } }, 'PATCH')
  ok((await api('/config')).trials?.studio === true && Array.isArray((await api('/studio/recent')).files), 'turned on, it answers')
  // ---------- The files ----------
  const dir = path.join(kit.home, 'Work', 'q4')
  fs.mkdirSync(dir, { recursive: true })
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx')
  // In its own look: Arial 12pt, its headings Georgia in dark red.
  fs.writeFileSync(path.join(dir, 'plan.docx'), await Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: 'Arial', size: 24 } }, heading1: { run: { font: 'Georgia', color: 'C00000', size: 36, bold: true } } } }, sections: [{ children: [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Q4 plan')] }), new Paragraph({ children: [new TextRun({ text: 'Ship the pricing page by November.', bold: true })] })] }] })))
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Budget')
  ws.addRow(['Item', 'Cost']); ws.addRow(['Hosting', 120]); ws.addRow(['Design', 900]); ws.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 1020 }; ws.getCell('A1').font = { bold: true }
  await wb.xlsx.writeFile(path.join(dir, 'budget.xlsx'))
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nFirst draft.\n')
  fs.writeFileSync(path.join(dir, 'pitch.md'), '---\nmarp: true\n---\n\n# Pitch\n\n## Q4\n\n---\n\n# Why now\n\n- Customers asked\n- It is ready\n\n<!-- Say the numbers -->\n')
  fs.writeFileSync(path.join(dir, 'dash.html'), '<!doctype html><title>Dash</title><h1 id="h">Dashboard</h1>')
  fs.writeFileSync(path.join(dir, 'data.csv'), 'a,b\n1,"x, y"\n')
  // A CSV as Excel writes one in much of Europe: a byte order mark, semicolons, Windows line
  // endings, a quoted field with the separator in it, and codes with leading zeros.
  const peopleCsv = '﻿Name;Town;Code\r\nAda Example;Springfield;007\r\nBo Sample;"Rivertown; North";0042\r\n'
  fs.writeFileSync(path.join(dir, 'people.csv'), peopleCsv)
  // A workbook with more in it than the editor shows: two sheets, styles, a merged title, frozen
  // rows, a conditional format, a dropdown, a link, a note, a name, and a chart (Excel's own XML,
  // put in as Excel puts it, since ExcelJS can't make charts).
  const lw = new ExcelJS.Workbook()
  const ls = lw.addWorksheet('Ledger', { views: [{ state: 'frozen', ySplit: 1 }] })
  ls.addRow(['Month', 'Spend', 'Note']); ls.addRow(['Jan', 410, 'ok']); ls.addRow(['Feb', 380, 'ok']); ls.addRow(['Mar', 520, 'high'])
  ls.getCell('B5').value = { formula: 'SUM(B2:B4)', result: 1310 }
  ls.getRow(1).font = { bold: true, color: { argb: 'FF1F3864' } }
  ls.getCell('B2').numFmt = '#,##0.00'; ls.getCell('B2').border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } }
  ls.getColumn(1).width = 18
  ls.addConditionalFormatting({ ref: 'B2:B4', rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: [500], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } }, priority: 1 }] })
  ls.getCell('C2').dataValidation = { type: 'list', allowBlank: true, formulae: ['"ok,high"'] }
  ls.getCell('C4').note = 'Checked with the team'
  ls.getCell('A7').value = { text: 'Policy', hyperlink: 'https://example.com/policy' }
  ls.mergeCells('D1:E1'); ls.getCell('D1').value = 'Quarter one'
  lw.definedNames.add('Ledger!$B$2:$B$4', 'Spend')
  lw.addWorksheet('Notes').getCell('A1').value = 'Kept'
  const JSZipX = require('jszip')
  const lz = await JSZipX.loadAsync(await lw.xlsx.writeBuffer())
  lz.file('xl/charts/chart1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Spend by month</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Ledger!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Spend</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Ledger!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt><c:pt idx="2"><c:v>Mar</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Ledger!$B$2:$B$4</c:f><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>410</c:v></c:pt><c:pt idx="1"><c:v>380</c:v></c:pt><c:pt idx="2"><c:v>520</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`)
  lz.file('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>')
  lz.file('xl/drawings/_rels/drawing1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>')
  const sheetRels = 'xl/worksheets/_rels/sheet1.xml.rels'
  const relsXml = lz.file(sheetRels) ? await lz.file(sheetRels).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  lz.file(sheetRels, relsXml.replace('</Relationships>', '<Relationship Id="rIdChart9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'))
  const s1 = await lz.file('xl/worksheets/sheet1.xml').async('string')
  const at = ['<legacyDrawing', '<tableParts', '<extLst', '</worksheet>'].map((x) => s1.indexOf(x)).filter((i) => i >= 0).sort((a, b) => a - b)[0]
  lz.file('xl/worksheets/sheet1.xml', `${s1.slice(0, at)}<drawing r:id="rIdChart9"/>${s1.slice(at)}`)
  const types = await lz.file('[Content_Types].xml').async('string')
  lz.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'))
  fs.writeFileSync(path.join(dir, 'ledger.xlsx'), await lz.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  fs.writeFileSync(path.join(dir, 'report.pdf'), '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
  const place = (await api('/places', { path: dir })).place
  const root = `place:${place.id}`
  const F = (p) => ({ root, path: p })

  // ---------- The server ----------
  const kinds = {}
  for (const n of ['plan.docx', 'budget.xlsx', 'notes.md', 'pitch.md', 'dash.html', 'data.csv', 'report.pdf']) kinds[n] = (await api(`/studio/open?${q(F(n))}`)).kind
  ok(JSON.stringify(kinds) === JSON.stringify({ 'plan.docx': 'doc', 'budget.xlsx': 'sheet', 'notes.md': 'doc', 'pitch.md': 'deck', 'dash.html': 'page', 'data.csv': 'sheet', 'report.pdf': 'pdf' }), 'each opens as its kind: a Markdown file with marp: true is a deck', kinds)
  ok(/Not a file/.test((await err(`/studio/open?${q(F('../q4'))}`))?.message || ''), 'a folder is no file to open')
  ok(!!(await err(`/studio/open?${q({ root, path: '../../.bridge-ai/config.json' })}`)), 'nothing outside the place opens')
  let m = await api(`/studio/open?${q(F('notes.md'))}`)
  ok(m.versions.length === 1 && m.versions[0].by === 'opened', 'opened the first time: kept as it was', m.versions)
  let r = await put(F('notes.md'), '# Notes\n\nSecond draft.\n', m.mtime)
  ok(r.status === 200 && fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').includes('Second draft') && r.versions[0].by === 'you' && r.versions.length === 2, 'saved: the file, and a version by you', r.versions)
  const stale = await put(F('notes.md'), '# Mine\n', m.mtime)
  ok(stale.status === 409 && /changed since you opened it/.test(stale.error), 'a save over a change made meanwhile is refused, saying why', stale)
  await sleep(30)
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nThird draft, from another app.\n')
  r = await api(`/studio/changed?${q(F('notes.md'))}&since=${r.mtime}`)
  ok(r.changed && r.by === 'outside' && r.versions[0].by === 'outside', 'changed from outside: noticed, and kept as a version', r)
  // Asked of an agent: the change it makes is its version, with its name.
  const d2 = path.join(kit.home, 'code', 'site')
  fs.mkdirSync(d2, { recursive: true })
  const agent = await api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Writer', prompt: 'idle' })
  await until(async () => (await api('/fleet')).agents.find((a) => a.paneId === agent.paneId)?.status === 'idle', 30000)
  const asked = await api('/studio/ask', { ...F('notes.md'), kind: 'doc', instruction: 'make it shorter', selection: 'Third draft', where: 'under "Notes"', pane: agent.paneId })
  const typed = () => { try { return fs.readFileSync(path.join(kit.home, 'claude-typed.log'), 'utf8') } catch { return '' } }
  const sent = (x) => /In notes\.md: make it shorter/.test(x) && /Third draft/.test(x) && /Edit the file itself/.test(x)
  const got = await until(async () => sent(typed()) || Object.values((await api('/fleet')).queue || {}).flat().some((i) => sent(i.text || '')), 20000)
  ok(asked.paneId === agent.paneId && !!got, 'Ask an agent: the change, the part and the file go to the agent you picked', { asked, typed: typed().slice(-400), queue: (await api('/fleet')).queue })
  const before = r.mtime
  await sleep(30)
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nShort.\n')
  r = await api(`/studio/changed?${q(F('notes.md'))}&since=${before}`)
  ok(r.changed && r.by === 'agent' && /Writer|Claude/.test(r.name || ''), "the change after it is the agent's version, by its name", r)
  const first = r.versions.find((v) => v.by === 'you')
  r = await api('/studio/restore', { ...F('notes.md'), id: first.id })
  ok(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').includes('Second draft') && r.versions[0].by === 'restored' && r.versions[1].by === 'agent', 'Put back: the older version is the file again, and what was there before stays a version', r.versions.slice(0, 3))
  const n1 = await api('/studio/new', { root, dir: '', name: 'notes.md', text: '# Another\n' })
  ok(n1.name === 'notes 2.md' && fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').includes('Second draft'), 'a new file never overwrites one: notes 2.md', n1)
  ok(!!(await err('/studio/new', { root, dir: '', name: 'run.sh', text: 'x' })), "a kind Studio doesn't open isn't made")
  let packs = await api('/studio/packs', { name: 'Bold', colors: { background: '#101418', text: '#eeeeee', accent: '#ff8800' }, fonts: { heading: 'Georgia', body: 'Inter' } })
  ok(packs.packs.length === 1 && packs.packs[0].isDefault && packs.packs[0].colors.accent === '#ff8800', 'a design pack: the first is the default', packs.packs)
  packs = await api('/studio/packs', { name: 'Light', colors: { background: 'not a colour', accent: '#123456' }, isDefault: true })
  ok(packs.packs.length === 2 && packs.packs.find((p) => p.name === 'Light').isDefault && !packs.packs.find((p) => p.name === 'Bold').isDefault && !packs.packs.find((p) => p.name === 'Light').colors.background, 'another made default; a colour that isn\'t one is left out', packs.packs)
  packs = await api(`/studio/packs/${packs.packs.find((p) => p.name === 'Light').id}`, null, 'DELETE')
  ok(packs.packs.length === 1 && packs.packs[0].isDefault, 'deleted: the one left is the default', packs.packs)
  ok((await api('/studio/recent')).files.some((f) => f.path === 'notes.md' && f.root === root), 'what you opened is in Recent')
  // A deck from a meeting: written by the notes model from its summary, in Studio's own folder.
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { model: 'openai:gpt-5', autoSummary: false } }, 'PATCH')
  const mt = await api('/meetings', { title: 'Pricing review', call: false })
  await api(`/meetings/${mt.id}/stop`, {})
  fs.writeFileSync(path.join(kit.data, 'meetings', mt.id, 'summary.md'), '## Summary\nWe agreed the pricing page ships in November.\n')
  const dk = await api(`/meetings/${mt.id}/deck`, {})
  const deckFile = path.join(kit.data, 'studio', 'files', dk.path || 'none')
  ok(dk.root === 'studio' && /^Pricing review deck\.md$/.test(dk.path) && /^---\nmarp: true/.test(fs.readFileSync(deckFile, 'utf8')) && /# Pricing review/.test(fs.readFileSync(deckFile, 'utf8')), 'Make a deck: a Marp deck of the meeting in Studio\'s own folder', dk)
  ok(model.asked(/Write a slide deck of this meeting/).some((x) => /pricing page ships in November/.test(x)), 'written from its summary', model.asked(/Write a slide deck/).slice(-1)[0]?.slice(0, 300))
  ok((await api(`/studio/open?root=studio&path=${encodeURIComponent(dk.path)}`)).kind === 'deck', 'and it opens in Studio as a deck')

  // ---------- The page ----------
  const w = await page(b, kit.url, { width: 1400, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  // Settings › About & Updates: Studio's switch under Beta Features, and every button there one
  // size. Off, Studio leaves the sidebar; on, it's back.
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
  const trial = p.locator('.st-check', { has: p.locator('b', { hasText: /^Studio$/ }) }).locator('input')
  await trial.waitFor({ timeout: 15000 })
  // The switch is off and disabled until the settings have come (a slow computer shows that first).
  await until(async () => !(await trial.isDisabled()), 10000)
  ok(await trial.isChecked(), 'Settings › About & Updates › Beta Features: Studio, on')
  const sizes = await p.locator('.st-sections .st-sec .btn').evaluateAll((bs) => [...new Set(bs.map((x) => Math.round(x.getBoundingClientRect().height)))])
  ok(sizes.length === 1, `every button on About & Updates is one size (${sizes.join(', ')} px)`, sizes)
  await shot(p, `${tag}studio-trial`)
  const inRail = () => p.locator('.rail-nav-btn', { hasText: 'Studio' }).count()
  await trial.uncheck()
  ok(!!(await until(async () => (await inRail()) === 0, 8000)), 'turned off: Studio leaves the sidebar')
  await trial.check()
  ok(!!(await until(async () => (await inRail()) > 0, 8000)), 'turned on again: it is back')
  await p.locator('button[aria-label="Close settings"]').click()
  // Studio's home, from the rail (clicked again until it shows: WebKit can take a click before the
  // app is listening).
  const home = () => until(async () => { await p.locator('.rail-nav-btn', { hasText: 'Studio' }).click(); return p.locator('.sd-home').waitFor({ timeout: 1500 }).then(() => true, () => false) }, 20000, 300)
  ok(!!(await home()), "Studio opens from the rail")
  ok(await p.locator('.sd-new-btn').count() === 5 && !!(await until(async () => (await p.locator('.sd-files-row', { hasText: 'notes.md' }).count()) > 0, 10000)), "Studio's home: New (document, Markdown, sheet, deck, page) and your recent files")
  await shot(p, `${tag}studio-home`)
  // A Markdown file, edited and saved.
  await p.locator('.sd-file-name', { hasText: 'notes.md' }).first().click()
  const pm = p.locator('.sd-page .ProseMirror')
  ok(!!(await until(async () => /Second draft/.test(await pm.innerText().catch(() => '')), 15000)), 'a Markdown file opens as a document')
  const mdTools = await p.locator('.sd-doc-tools button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')))
  ok(!mdTools.includes('Underline') && mdTools.includes('Inline code') && mdTools.includes('Code block'), "a Markdown file's toolbar: code and code blocks, and no underline (Markdown has none)", mdTools)
  ok(!!(await until(async () => { const x = await p.locator('.sd-status').innerText(); return /^\d+ words?/.test(x) && /Markdown/.test(x) && /Saved/.test(x) }, 5000)) && /^Markdown · \d+ KB$/.test(await p.locator('.sd-sub-kind').innerText()), 'its header says Markdown and its size; its status line its words, and Saved', await p.locator('.sd-status').innerText())
  await pm.click()
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await p.keyboard.type(' Edited here.')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  ok(!!(await until(() => fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').includes('Edited here.'), 8000)) && /^# Notes/.test(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8')), 'typed and saved: still Markdown, with the change', fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'))
  await p.locator('button[aria-label="Versions"]').click()
  // The save is kept as your version just after the file is written, so the list can show the
  // version before it for a moment.
  ok(!!(await until(async () => (await p.locator('.sd-versions li').count()) >= 5 && /You/.test(await p.locator('.sd-versions li').first().innerText()), 5000)), 'Versions: yours on top, the agent\'s and the others under it', await p.locator('.sd-versions').innerText().catch(() => ''))
  // Compare: an older version against the file as it is now.
  await p.locator('.sd-versions li').nth(1).locator('button', { hasText: 'Compare' }).click()
  ok(!!(await until(async () => (await p.locator('.sd-diff .add').count()) > 0 && /Edited here/.test(await p.locator('.sd-diff .add').allInnerTexts().then((x) => x.join(' ')).catch(() => '')), 8000)), "Compare: what's new since that version, marked", { text: await p.locator('.sd-compare').innerText().catch(() => ''), errors: w.errors })
  await shot(p, `${tag}studio-compare`)
  await p.locator('.sd-compare button[aria-label="Close"]').click()
  await shot(p, `${tag}studio-doc`)
  // A change from outside while it's open, with nothing unsaved: shown within seconds.
  await sleep(50)
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nChanged by another app.\n')
  ok(!!(await until(async () => /Changed by another app/.test(await pm.innerText().catch(() => '')) && /changed it/.test(await p.locator('.sd-bar').innerText().catch(() => '')), 15000)), 'a change from outside while open is shown, and said')
  // Ask an agent, from the page.
  await p.locator('.pane-head button', { hasText: 'Ask an agent' }).click()
  await p.locator('.sd-ask textarea').fill('add a summary at the top')
  await p.locator('.sd-ask-to select').selectOption(agent.paneId)
  await p.locator('.sd-ask button', { hasText: 'Send' }).click()
  ok(!!(await until(async () => /Sent to/.test(await p.locator('.sd-bar').innerText().catch(() => '')), 5000)), 'Ask an agent: sent to the agent picked, and it says so')
  // A Word file's text.
  const open = async (name) => p.evaluate(({ root, name }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: name } })), { root, name })
  await open('plan.docx')
  ok(!!(await until(async () => /Q4 plan/.test(await p.locator('.sd-w').innerText().catch(() => '')) && /Ship the pricing page/.test(await p.locator('.sd-w').innerText().catch(() => '')), 20000)), 'a Word file opens with its heading and text')
  const h1 = await p.locator('.sd-w h1').first().evaluate((e) => { const c = getComputedStyle(e), b = getComputedStyle(e.closest('.sd-w')); return { color: c.color, font: c.fontFamily, size: c.fontSize, body: b.fontFamily, paper: b.backgroundColor } })
  ok(h1.color === 'rgb(192, 0, 0)' && /Georgia/.test(h1.font) && h1.size === '24px' && /Arial/.test(h1.body) && h1.paper === 'rgb(255, 255, 255)', 'in its own look: its fonts, sizes and colours, on white paper', h1)
  await shot(p, `${tag}studio-word`)
  // Saved here: only what changed is written; its styles as they were, byte for byte. (A Word
  // file's editor is checked in studio-docs.mjs.)
  const JSZip = require('jszip')
  const partsOf = async (file) => { const z = await JSZip.loadAsync(fs.readFileSync(file)); const o = {}; for (const n of Object.keys(z.files)) if (!z.files[n].dir) o[n] = await z.file(n).async('string'); return o }
  const stylesOf = async (file) => { try { return await (await JSZip.loadAsync(fs.readFileSync(file))).file('word/styles.xml').async('string') } catch { return '' } }
  const was = await partsOf(path.join(dir, 'plan.docx'))
  await p.locator('.sd-w p', { hasText: 'Ship the pricing page' }).click()
  await p.keyboard.press('End')
  await p.keyboard.type(' Agreed.')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  ok(!(await p.locator('.sd-conflict[role="alertdialog"]').count()), "a Word file saves at once: nothing to warn about, as it keeps everything")
  const kept = await until(async () => { const x = await partsOf(path.join(dir, 'plan.docx')); return /Agreed/.test(x['word/document.xml']) && x }, 10000)
  const changedParts = kept ? Object.keys({ ...was, ...kept }).filter((k) => was[k] !== kept[k]) : null
  ok(!!kept && changedParts.join() === 'word/document.xml', 'saved: the change, and every other part of the file (its styles too) as it was', changedParts)
  ok(!!(await until(async () => /Saved/.test(await p.locator('.sd-status .sd-state').innerText()), 5000)), 'and then the status line says Saved')
  // The header at the width of the owner's window: the kind and size whole, then the folder.
  await p.setViewportSize({ width: 1230, height: 820 })
  await sleep(300)
  const sub = await p.locator('.sd-file .pane-sub').evaluate((e) => { const k = e.querySelector('.sd-sub-kind'), w = e.querySelector('.sd-sub-where'); return { kind: k?.innerText, whole: !!k && k.scrollWidth <= k.clientWidth + 1 && k.getBoundingClientRect().right <= e.getBoundingClientRect().right + 1, where: w?.title || '' } })
  ok(/^Word document · \d+ KB$/.test(sub.kind) && sub.whole && /q4$/.test(sub.where), 'at 1230 px: the header says "Word document · its size" whole, and where it is', sub)
  await shot(p, `${tag}studio-word-1230`)
  await p.setViewportSize({ width: 1400, height: 900 })
  // The status line: its words, what kind of file (tapped: what saving keeps), its versions.
  const status = await p.locator('.sd-status').innerText()
  ok(/\d+ words/.test(status) && /Word document/.test(status) && /\d+ versions/.test(status) && /Saved/.test(status), 'the status line: words, the kind of file, its versions, saved', status)
  await p.locator('.sd-status button', { hasText: 'Word document' }).click()
  ok(/writes only what you changed/.test(await p.locator('.sd-note-bar').innerText().catch(() => '')), 'and tapped, the kind says what saving keeps', await p.locator('.sd-note-bar').innerText().catch(() => ''))
  await p.locator('.sd-note-bar button[aria-label="Close"]').click()
  // A sheet.
  await open('budget.xlsx')
  ok(!!(await until(async () => (await p.locator('.sd-univer canvas').count()) > 0, 30000)), 'an Excel file opens in the sheet')
  ok(!!(await until(async () => { const x = await p.locator('.sd-status').innerText(); return /1 sheet/.test(x) && /Excel workbook/.test(x) }, 5000)) && !(await bare(p)).length, 'a sheet: its status line says how many sheets and what it is; no bare controls', { status: await p.locator('.sd-status').innerText(), bare: await bare(p) })
  await shot(p, `${tag}studio-sheet`)
  // Quick: a window with a sheet open, left alone, keeps its main thread free and asks the server
  // little (the change watcher, every few seconds). Generous, for a slow CI computer.
  const reqs = []
  const count = (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) reqs.push(new URL(r.url()).pathname) }
  const cdp = which === 'chromium' ? await w.ctx.newCDPSession(p) : null
  if (cdp) await cdp.send('Performance.enable')
  const busy = async () => (cdp ? (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value : 0)
  await sleep(1500)
  const b0 = await busy()
  p.on('request', count)
  await sleep(10_000)
  p.off('request', count)
  const share = Math.round(((await busy()) - b0) * 100) / 10
  if (cdp) ok(share < 8, `a window with a sheet open, idle, keeps its main thread free (${share}% busy)`, share)
  const looks = reqs.filter((x) => x === '/api/studio/changed').length
  ok(looks <= 2 && reqs.length <= 15, `and asks the server little: whether the file changed ${looks} time${looks === 1 ? '' : 's'} in 10 s, ${reqs.length} requests in all (at most 90 a minute, as everywhere)`, [...new Set(reqs)])
  // A cell picked by its name, as in Excel's name box (the mouse would need the grid's sizes).
  const goTo = async (a1) => {
    await p.evaluate(() => { const i = [...document.querySelectorAll('.sd-univer input')].find((x) => /^[A-Z]+[0-9]+(:[A-Z]+[0-9]+)?$/.test(x.value)); document.querySelectorAll('[data-name-box]').forEach((x) => x.removeAttribute('data-name-box')); i?.setAttribute('data-name-box', '1') })
    const nb = p.locator('input[data-name-box]')
    await nb.click(); await nb.fill(a1); await nb.press('Enter')
    await sleep(250)
  }
  // Edited and saved. Left alone and its cells picked, it's still Saved (Univer's own setting up,
  // and its cell editor filled as a cell is picked, aren't changes). A value typed in B3 (Design's
  // cost) is: Unsaved changes and Save on, and saved, the file has it with its total worked out
  // again. Nothing in it is lost by saving here, so there's nothing to say first.
  const sheetState = () => p.locator('.sd-status .sd-state').innerText().catch(() => '')
  await goTo('B3')
  ok((await sheetState()) === 'Saved', 'a sheet opened, left alone and a cell picked: still Saved', await sheetState())
  await p.keyboard.type('950')
  await p.keyboard.press('Enter')
  ok(!!(await until(async () => (await sheetState()) === 'Unsaved changes' && (await p.locator('.pane-head button[aria-label="Save"]').isEnabled().catch(() => false)), 5000)), 'a value typed in a cell: Unsaved changes, and Save is on', await sheetState())
  await p.locator('.pane-head button[aria-label="Save"]').click({ timeout: 3000 }).catch(() => {})
  const cellsOf = async () => { try { const x = new ExcelJS.Workbook(); await x.xlsx.readFile(path.join(dir, 'budget.xlsx')); const s = x.getWorksheet('Budget'); return { B3: s.getCell('B3').value, B4: s.getCell('B4').value, A1bold: !!s.getCell('A1').font?.bold } } catch { return null } }
  const sheetSaved = await until(async () => { const c = await cellsOf(); return c?.B3 === 950 && c.B4?.formula === 'SUM(B2:B3)' && c.B4.result === 1070 && c.A1bold && (await sheetState()) === 'Saved' && c }, 10000)
  ok(!!sheetSaved && !(await p.locator('.sd-conflict[role="alertdialog"]').count()), 'saved: the file has the value, its total worked out again (1070), and its bold heading; the status line says Saved, with nothing to warn of first', { cells: await cellsOf(), state: await sheetState() })
  // The ribbon as Excel's: Ask AI first, then the clipboard, fonts, alignment and number formats;
  // the formula bar with its name box; the sheet's tabs; Charts under Insert.
  const ribbon = await p.evaluate(() => {
    const u = document.querySelector('.sd-univer')
    const cmd = (id) => !!u.querySelector(`[data-u-command="${id}"]`)
    return { ask: cmd('bridge.sheet.ask-ai'), first: u.querySelector('[data-u-command]')?.getAttribute('data-u-command'), tabs: [...u.querySelectorAll('[role="tablist"] [role="tab"], [data-u-comp="ribbon-tab"]')].map((e) => e.textContent.trim()).filter(Boolean), names: [...u.querySelectorAll('input')].map((i) => i.value), sheets: u.innerText.includes('Budget') }
  })
  ok(ribbon.ask && ribbon.first === 'bridge.sheet.ask-ai' && ribbon.names.some((v) => /^[A-Z]+\d+$/.test(v)) && ribbon.sheets, 'a sheet\'s ribbon: Ask AI first; the formula bar\'s name box; its sheet\'s tab', ribbon)
  const sheetCell = async (file, sheet, a1) => { const x = new ExcelJS.Workbook(); await x.xlsx.load(fs.readFileSync(path.join(dir, file))); return x.getWorksheet(sheet).getCell(a1).value }
  // Ask an agent on a sheet: Ask AI beside it, about the cells picked, to the agent at work there.
  await goTo('B2')
  await p.locator('.pane-head button', { hasText: 'Ask an agent' }).click()
  const askAi = p.locator('.sh-ask')
  ok(!!(await until(async () => /B2/.test(await askAi.locator('.sh-picked').innerText().catch(() => '')) && /on Budget/.test(await askAi.innerText()) && /1 cell/.test(await askAi.innerText()), 5000)), 'Ask an agent on a sheet: Ask AI beside it, about the cell picked (B2 on Budget)', await askAi.innerText().catch(() => ''))
  ok(!!(await until(async () => (await askAi.locator('.sh-to select').inputValue()) === agent.paneId, 5000)), 'and it goes to the agent at work there unless you pick another', await askAi.locator('.sh-to select').inputValue().catch(() => ''))
  ok(JSON.stringify(await askAi.locator('.sh-chip').allInnerTexts()) === JSON.stringify(['Write a formula', 'Clean this column', 'Summarise', 'Chart this']) && !(await bare(p)).length, 'its quick asks: a formula, a cleaned-up column, a summary, a chart; no bare controls', { chips: await askAi.locator('.sh-chip').allInnerTexts(), bare: await bare(p) })
  await shot(p, `${tag}studio-sheet-ask`)
  // Asked in place: the agent is told to answer with the change, not to make it.
  await askAi.locator('.sh-chip', { hasText: 'Write a formula' }).click()
  ok(!!(await until(() => askAi.locator('textarea').evaluate((e) => e === document.activeElement && e.selectionStart === e.value.length), 2000, 50)), 'and the cursor waits at its end, to finish it in your words')
  await askAi.locator('textarea').press('End')
  await askAi.locator('textarea').pressSequentially('doubles the cost in column C')
  ok(/^Write a formula for the cells I picked that doubles the cost in column C$/.test(await askAi.locator('textarea').inputValue()), 'Write a formula starts the ask, to finish in your words', await askAi.locator('textarea').inputValue())
  await askAi.locator('.sh-send').click()
  const proposed = (x) => /In budget\.xlsx: Write a formula/.test(x) && /Don't change the file itself/.test(x) && /\.budget\.xlsx\.studio-change\.json/.test(x) && /B2 on Budget/.test(x) && /120/.test(x)
  const told = await until(async () => proposed(typed()) || Object.values((await api('/fleet')).queue || {}).flat().some((i) => proposed(i.text || '')), 20000)
  ok(!!told && /Asked/.test(await askAi.locator('.sh-wait').innerText().catch(() => '')), 'sent: the cell and its value, and to write the change beside the file rather than make it; Ask AI waits for it', { typed: typed().slice(-600), wait: await askAi.innerText().catch(() => '') })
  const change = path.join(dir, '.budget.xlsx.studio-change.json')
  fs.writeFileSync(change, JSON.stringify({ summary: 'Doubled each cost in column C', sheet: 'Budget', cells: { C1: 'Doubled', C2: '=B2*2', C3: '=B3*2' } }))
  const shown = p.locator('.sh-change')
  ok(!!(await until(async () => /Doubled each cost/.test(await shown.innerText().catch(() => '')) && /3 cells, marked on the sheet/.test(await shown.innerText()), 10000)) && !fs.existsSync(change), "the agent's change: shown on the sheet before it's made, said in words, and taken from beside the file", await shown.innerText().catch(() => ''))
  ok(/Unsaved changes/.test(await p.locator('.sd-status').innerText()) && fs.readFileSync(path.join(dir, 'budget.xlsx')).length > 0 && (await sheetCell('budget.xlsx', 'Budget', 'C2')) == null, "and the file isn't changed until it's kept and saved", await p.locator('.sd-status').innerText())
  await shot(p, `${tag}studio-sheet-proposal`)
  await shown.locator('button', { hasText: 'Keep' }).click()
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const c2 = await until(async () => { const v = await sheetCell('budget.xlsx', 'Budget', 'C2').catch(() => null); return v?.formula ? v : null }, 10000)
  ok(c2?.formula === 'B2*2' && c2.result === 240 && (await sheetCell('budget.xlsx', 'Budget', 'C1')) === 'Doubled', 'kept and saved: the formulas in the file, with their results', c2)
  // Another, put back: the cells as they were.
  await askAi.locator('textarea').fill('Rename the first column')
  await askAi.locator('.sh-send').click()
  await until(async () => /Asked/.test(await askAi.locator('.sh-wait').innerText().catch(() => '')), 10000)
  fs.writeFileSync(change, JSON.stringify({ summary: 'Renamed it', cells: { A1: 'Thing' } }))
  await until(async () => (await shown.count()) > 0, 10000)
  await shown.locator('button', { hasText: 'Put back' }).click()
  await p.locator('.pane-head button', { hasText: 'Save' }).click().catch(() => {})
  await sleep(1500)
  ok((await sheetCell('budget.xlsx', 'Budget', 'A1')) === 'Item', 'put back: nothing of it is left in the file', await sheetCell('budget.xlsx', 'Budget', 'A1'))
  // Summarise: an answer, said beside the sheet; nothing to keep.
  await askAi.locator('.sh-chip', { hasText: 'Summarise' }).click()
  await askAi.locator('.sh-send').click()
  await until(async () => /Asked/.test(await askAi.locator('.sh-wait').innerText().catch(() => '')), 10000)
  fs.writeFileSync(change, JSON.stringify({ answer: 'Two costs come to 1,020; design is most of it.' }))
  ok(!!(await until(async () => /Two costs come to 1,020/.test(await shown.innerText().catch(() => '')) && (await shown.locator('button', { hasText: 'Copy' }).count()) === 1, 10000)), 'Summarise: the answer beside the sheet, to copy', await shown.innerText().catch(() => ''))
  await shown.locator('button', { hasText: 'Done' }).click()
  // Chart this: drawn from the cells before it's added, then in Charts, and saved as an Excel chart.
  await goTo('A1:B3')
  await askAi.locator('.sh-chip', { hasText: 'Chart this' }).click()
  await askAi.locator('.sh-send').click()
  await until(async () => /Asked/.test(await askAi.locator('.sh-wait').innerText().catch(() => '')), 10000)
  fs.writeFileSync(change, JSON.stringify({ summary: 'A column chart of the costs', chart: { type: 'column', title: 'Costs', range: 'A1:B3' } }))
  ok(!!(await until(async () => (await shown.locator('svg .sc-bar').count()) === 2 && /Costs/.test(await shown.innerText()), 10000)), 'Chart this: the chart drawn from the cells, before it\'s added', await shown.innerHTML().catch(() => ''))
  await shot(p, `${tag}studio-sheet-chart`)
  await shown.locator('button', { hasText: 'Keep' }).click()
  await p.locator('.sd-univer [data-u-command="bridge.sheet.charts"]').click({ timeout: 3000 }).catch(async () => { await p.locator('.sd-univer [role="tab"]', { hasText: 'Insert' }).first().click(); await p.locator('.sd-univer [data-u-command="bridge.sheet.charts"]').click() })
  ok(!!(await until(async () => /Costs/.test(await p.locator('.sh-charts').innerText().catch(() => '')) && (await p.locator('.sh-charts svg .sc-bar').count()) === 2, 5000)), 'Charts: the one kept, drawn from its cells', await p.locator('.sh-charts').innerText().catch(() => ''))
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const JSZip0 = require('jszip')
  const chartIn = await until(async () => { try { const z = await JSZip0.loadAsync(fs.readFileSync(path.join(dir, 'budget.xlsx'))); const c = Object.keys(z.files).find((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)); return c ? z.file(c).async('string') : null } catch { return null } }, 10000)
  ok(!!chartIn && /<c:barChart>/.test(chartIn) && /Budget!\$B\$2:\$B\$3/.test(chartIn) && /Costs/.test(chartIn), 'saved as an Excel chart of those cells', chartIn && chartIn.slice(0, 400))
  // A filter, from the Data tab, saved as Excel's own.
  await goTo('A1:C3')
  await p.locator('.sd-univer [role="tab"]', { hasText: 'Data' }).click()
  await p.locator('.sd-univer [data-u-command="sheet.command.smart-toggle-filter"]').first().click()
  await until(async () => /Unsaved changes/.test(await p.locator('.sd-status').innerText()), 5000)
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const sheetXml = () => JSZip0.loadAsync(fs.readFileSync(path.join(dir, 'budget.xlsx'))).then((z) => z.file('xl/worksheets/sheet1.xml').async('string')).catch(() => '')
  ok(!!(await until(async () => /<autoFilter ref="A1:C3"/.test(await sheetXml()), 10000)), 'Data › Filter on the cells picked: saved as an Excel filter on them', (await sheetXml()).slice(-600))
  await p.locator('.sd-univer [role="tab"]', { hasText: 'Start' }).click()
  // A change that can't be read is said, not dropped.
  await p.locator('.sd-univer [data-u-command="bridge.sheet.ask-ai"]').click({ timeout: 3000 }).catch(async () => { await p.locator('.sd-univer [role="tab"]', { hasText: 'Start' }).first().click(); await p.locator('.sd-univer [data-u-command="bridge.sheet.ask-ai"]').click() })
  await askAi.locator('textarea').fill('Anything')
  await askAi.locator('.sh-send').click()
  await until(async () => /Asked/.test(await askAi.locator('.sh-wait').innerText().catch(() => '')), 10000)
  fs.writeFileSync(change, '{ not json')
  ok(!!(await until(async () => /isn't JSON Studio can read/.test(await askAi.locator('.sh-wait.bad').innerText().catch(() => '')), 10000)), "an agent's change that isn't JSON: said so", await askAi.innerText().catch(() => ''))
  await askAi.locator('.sh-wait.bad button', { hasText: 'OK' }).click()
  await p.locator('.sh-ask button[aria-label="Close"]').click()
  // An Excel file's round trip: opened, one cell changed, saved, opened again. Everything else in
  // it is the same bytes (its chart, its drawing, its styles, the other sheet), and what's read
  // back is what was there, with the one change.
  const JSZip1 = require('jszip')
  const entries = async (file) => { const z = await JSZip1.loadAsync(fs.readFileSync(file)); const out = {}; for (const n of Object.keys(z.files).sort()) if (!z.files[n].dir) out[n] = await z.file(n).async('nodebuffer'); return out }
  const ledgerWas = await entries(path.join(dir, 'ledger.xlsx'))
  await open('ledger.xlsx')
  await until(async () => (await p.locator('.sd-univer canvas').count()) > 0 && /Ledger/.test(await p.locator('.sd-univer').innerText().catch(() => '')), 30000)
  await sleep(800)
  await goTo('B3')
  await p.keyboard.type('395')
  await p.keyboard.press('Enter')
  await until(async () => /Unsaved changes/.test(await p.locator('.sd-status').innerText()), 5000)
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  await until(async () => /Saved/.test(await p.locator('.sd-status .sd-state').innerText()) && !(await p.locator('.sd-conflict').count()), 10000)
  const ledgerNow = await entries(path.join(dir, 'ledger.xlsx'))
  const differ = Object.keys({ ...ledgerWas, ...ledgerNow }).filter((n) => !ledgerWas[n] || !ledgerNow[n] || !ledgerWas[n].equals(ledgerNow[n]))
  ok(differ.every((n) => ['xl/worksheets/sheet1.xml', 'xl/workbook.xml', 'xl/calcChain.xml', 'xl/sharedStrings.xml', 'xl/styles.xml', '[Content_Types].xml', 'xl/_rels/workbook.xml.rels'].includes(n)) && differ.includes('xl/worksheets/sheet1.xml') && !!ledgerNow['xl/charts/chart1.xml'] && !!ledgerNow['xl/drawings/drawing1.xml'], 'an Excel file saved here: only the changed sheet is written again; its chart, drawing, styles and other sheet are the same bytes', differ)
  const lb = new ExcelJS.Workbook()
  await lb.xlsx.load(fs.readFileSync(path.join(dir, 'ledger.xlsx')))
  const lsh = lb.getWorksheet('Ledger')
  const back = { b3: lsh.getCell('B3').value, b5: lsh.getCell('B5').value, b2: [lsh.getCell('B2').numFmt, lsh.getCell('B2').border?.bottom?.style], bold: lsh.getCell('A1').font?.bold, cf: lsh.conditionalFormattings?.length, dv: lsh.getCell('C2').dataValidation?.type, note: lsh.getCell('C4').note, link: lsh.getCell('A7').value?.hyperlink, merged: lsh.getCell('E1').isMerged, frozen: lsh.views?.[0]?.state, name: lb.definedNames.getRanges('Spend')?.ranges?.[0], notes: lb.getWorksheet('Notes')?.getCell('A1').value, width: lsh.getColumn(1).width }
  ok(back.b3 === 395 && back.b5?.formula === 'SUM(B2:B4)' && back.b2[0] === '#,##0.00' && back.b2[1] === 'thin' && back.bold && back.cf === 1 && back.dv === 'list' && /Checked/.test(JSON.stringify(back.note)) && back.link === 'https://example.com/policy' && back.merged && back.frozen === 'frozen' && /\$B\$2:\$B\$4/.test(back.name || '') && back.notes === 'Kept' && back.width === 18, 'opened again: the change, and everything else as it was (formats, the formula, the conditional format, the dropdown, the note, the link, the merged title, the frozen row, the name, the other sheet, the widths)', back)
  // A CSV: read as it's written, its separator, encoding and line endings said, and written back
  // the same way, only the field changed different.
  await open('people.csv')
  const csvBar = p.locator('.sh-csv')
  ok(!!(await until(async () => (await csvBar.locator('select').first().inputValue().catch(() => '')) === ';' && (await csvBar.locator('select').nth(1).inputValue()) === 'utf-8-bom' && /Windows line endings/.test(await csvBar.innerText()), 15000)), "a CSV: its separator (semicolons), encoding (UTF-8 with a BOM) and line endings found, and said", await csvBar.innerText().catch(() => ''))
  ok(!(await p.locator('.sd-univer [data-u-command="sheet.command.set-range-bold"]').count()) && (await p.locator('.sd-univer [data-u-command="bridge.sheet.ask-ai"]').count()) === 1, "and its ribbon offers no formats, which a CSV can't keep")
  await shot(p, `${tag}studio-sheet-csv`)
  await sleep(500)
  await goTo('B2')
  await p.keyboard.type('Lakeside')
  await p.keyboard.press('Enter')
  await until(async () => /Unsaved changes/.test(await p.locator('.sd-status').innerText()), 5000)
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const wroteCsv = await until(() => { const x = fs.readFileSync(path.join(dir, 'people.csv'), 'utf8'); return x.includes('Lakeside') && x }, 10000)
  ok(wroteCsv === peopleCsv.replace('Springfield', 'Lakeside'), 'saved: the same bytes but the one field (its BOM, semicolons, Windows line endings, quotes and leading zeros kept)', JSON.stringify(wroteCsv))
  // A deck, drawn, and its PowerPoint beside it (the deck editor itself: studio-deck).
  await open('pitch.md')
  const slides = await until(async () => p.locator('.sd-strip .sd-thumb').count(), 15000)
  ok(slides === 2, 'a Markdown deck is drawn as its slides', slides)
  ok(!!(await until(async () => { const x = await p.locator('.sd-status').innerText(); return /Slide 1 of 2/.test(x) && /Markdown deck/.test(x) }, 5000)) && !(await bare(p)).length, 'its status line: slide 1 of 2, a Markdown deck; no bare controls', { status: await p.locator('.sd-status').innerText(), bare: await bare(p) })
  const mdToggle = p.locator('.sd-deck-tools button[aria-label="Markdown"]')
  await mdToggle.click()
  const both = !!(await until(async () => (await p.locator('.sd-deck-md').count()) === 1 && (await p.locator('.sd-canvas').count()) === 1, 3000, 100))
  ok(both && await p.locator('.sd-deck-md').evaluate((e) => getComputedStyle(e).fontVariantLigatures) === 'none', 'its Markdown beside the slides, showing what\'s typed: no ligatures (<!-- and --> as typed)')
  await p.locator('.sd-deck-tools button[aria-label="Export"]').click()
  await p.locator('.sd-tool-menu .menu-item', { hasText: 'PowerPoint, beside it' }).click()
  ok(!!(await until(() => fs.existsSync(path.join(dir, 'pitch.pptx')) && fs.readFileSync(path.join(dir, 'pitch.pptx')).subarray(0, 2).toString() === 'PK', 15000)), 'PowerPoint: pitch.pptx beside it')
  await shot(p, `${tag}studio-deck`)
  // Its look: the default pack, until the deck names another (pack: Board), which Theme writes.
  const drawn = () => p.locator('.sd-deck2 > style').innerText().catch(() => '')
  ok(/#ff8800/.test(await drawn()), 'a deck is drawn in your default design pack', (await drawn()).slice(0, 400))
  await api('/studio/packs', { name: 'Board', colors: { background: '#ffffff', text: '#222222', accent: '#0a7d4f' }, fonts: { heading: 'Georgia', body: 'Georgia' } })
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-refetch', { detail: '/studio/packs' })))
  const theme = async (name) => { await p.locator('.sd-deck-tools button[aria-label="Theme"]').click(); await p.locator('.sd-themes button', { hasText: name }).first().click() }
  await until(async () => { await p.locator('.sd-deck-tools button[aria-label="Theme"]').click(); const n = await p.locator('.sd-themes button', { hasText: 'Board' }).count(); await p.keyboard.press('Escape'); return n > 0 }, 15000, 500)
  await theme('Board')
  const deckMd = () => p.locator('.sd-deck-md').inputValue()
  ok(!!(await until(async () => /^---\nmarp: true\npack: Board\n---\n/.test(await deckMd()) && /#0a7d4f/.test(await drawn()), 5000)), 'Theme: another pack, written in its front matter and drawn in it', await deckMd())
  await shot(p, `${tag}studio-look`)
  await theme('Bold (your default)')
  ok(!!(await until(async () => !/pack:/.test(await deckMd()) && /#ff8800/.test(await drawn()), 5000)), 'and back to the default: the line is gone', await deckMd())
  await p.locator('.sd-deck-md').fill('---\nmarp: true\npack: "board"\n---\n\n# Pitch\n')
  ok(!!(await until(async () => /#0a7d4f/.test(await drawn()), 5000)), 'a deck that names its pack (any case, quoted or not) is drawn in it')
  await p.locator('.sd-deck-md').fill('---\nmarp: true\npack: Nowhere\n---\n\n# Pitch\n')
  ok(!!(await until(async () => /#ff8800/.test(await drawn()) && (await p.locator('.sd-toolbar', { hasText: 'No pack "Nowhere"' }).count()) > 0, 5000)), "a pack you don't have: your default, and it says so")
  // New, in your default pack's look (Bold: Georgia headings in orange; its near-white text isn't
  // used on a white Word page).
  const make = async (label, name) => {
    await home()
    await p.locator('.sd-new-btn', { hasText: label }).first().click()
    await p.locator('.sd-new-form input').fill(name)
    await p.locator('.sd-new-form select').selectOption(root)
    await p.locator('.sd-new-form button', { hasText: 'Make it' }).click()
  }
  await make('Document', 'Brief')
  const brief = await until(async () => fs.existsSync(path.join(dir, 'Brief.docx')) && stylesOf(path.join(dir, 'Brief.docx')), 10000)
  ok(!!brief && /w:ascii="Georgia"/.test(brief) && /w:val="FF8800"/.test(brief) && /w:ascii="Inter"/.test(brief) && !/EEEEEE/.test(brief), "a new document: your design pack's fonts and accent, and a text colour that reads on white", brief && brief.slice(0, 300))
  await make('Page', 'Pulse')
  const pulse = await until(() => fs.existsSync(path.join(dir, 'Pulse.html')) && fs.readFileSync(path.join(dir, 'Pulse.html'), 'utf8'), 10000)
  ok(!!pulse && /--accent: #ff8800/.test(pulse) && /--bg: #101418/.test(pulse) && /font-family: 'Georgia'/.test(pulse) && /<h1>Pulse<\/h1>/.test(pulse), "a new page: your design pack's colours as CSS variables, and its fonts", pulse)
  // A page, drawn as it's typed.
  await open('dash.html')
  const code = p.locator('.sd-code')
  await code.waitFor({ timeout: 15000 })
  await code.fill('<!doctype html><title>Dash</title><h1 id="h">Revenue</h1>')
  ok(!!(await until(async () => /Revenue/.test(await p.locator('.sd-page-view').getAttribute('srcdoc').catch(() => '')), 5000)), 'a page is drawn as you type it')
  ok(!!(await until(async () => { const x = await p.locator('.sd-status').innerText(); return /HTML page/.test(x) && /Unsaved changes/.test(x) }, 5000)) && !(await bare(p)).length, 'its status line: an HTML page, with unsaved changes; no bare controls', { status: await p.locator('.sd-status').innerText(), bare: await bare(p) })
  // A PDF: drawn in the page by pdf.js, in every browser (studio-pdf.mjs has the rest). Nothing to
  // save, and it says so.
  await open('report.pdf')
  const pdf = await until(async () => (await p.locator('.sd-pdf .pdfViewer .page canvas').count()) > 0, 15000)
  ok(!!pdf && !!(await until(async () => /Read only/.test(await p.locator('.sd-status').innerText()), 5000)) && (await p.locator('.pane-head button', { hasText: 'Save' }).count()) === 0 && !(await bare(p)).length, 'a PDF: drawn in the page; read only, no Save', { pdf, status: await p.locator('.sd-status').innerText().catch(() => ''), bare: await bare(p) })
  await shot(p, `${tag}studio-pdf`)
  ok(w.errors.length === 0, 'no page errors', w.errors)
  // On a phone, 375 and 430 px: Studio from More, its home and a document fitting the screen.
  for (const width of [375, 430]) {
    const ph = await page(b, kit.url, { phone: true })
    pages.push(ph)
    await ph.p.setViewportSize({ width, height: width === 375 ? 812 : 932 })
    await ph.p.locator('nav.tabbar button', { hasText: 'More' }).first().click({ timeout: 20000 })
    await ph.p.locator('button, .m-more-row', { hasText: 'Studio' }).first().click({ timeout: 10000 })
    await ph.p.waitForSelector('.sd-home', { timeout: 15000 })
    await until(async () => (await ph.p.locator('.sd-files-row', { hasText: 'notes.md' }).count()) > 0, 10000)
    await sleep(400)
    let f = await phoneFaults(ph.p, '.sd-home')
    ok(!Object.keys(f).length, `phone ${width}: Studio's home fits (nothing wider, past its edge or cut off; each control a whole 40 px target, each field 16 px)`, f)
    await shot(ph.p, `${tag}studio-home-phone-${width}`)
    await ph.p.locator('.sd-file-name', { hasText: 'notes.md' }).first().click()
    ok(!!(await until(async () => /Notes/.test(await ph.p.locator('.sd-page .ProseMirror').innerText().catch(() => '')), 15000)), `phone ${width}: Studio in More, a document opened`)
    await sleep(400)
    f = await phoneFaults(ph.p, '.sd-file')
    ok(!Object.keys(f).length && await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `phone ${width}: a document fits, its toolbar wrapping rather than scrolling sideways, each button a whole 40 px target`, f)
    await shot(ph.p, `${tag}studio-phone-${width}`)
    // Its versions over the editor (the header still there), and Ask an agent, fitting too.
    await ph.p.locator('.pane-head button[aria-label="Versions"]').click()
    await ph.p.locator('.sd-panel .sd-versions li').first().waitFor({ timeout: 5000 })
    f = await phoneFaults(ph.p, '.sd-panel')
    ok(!Object.keys(f).length && await ph.p.locator('.pane-head h2').isVisible(), `phone ${width}: Versions fits, each Compare, Open and Put back a whole target, under the file's header`, f)
    await shot(ph.p, `${tag}studio-versions-phone-${width}`)
    await ph.p.locator('.sd-panel button[aria-label="Close"]').click()
    await ph.p.locator('.pane-head button[aria-label="Ask an agent"]').click()
    await ph.p.locator('.sd-ask textarea').waitFor({ timeout: 5000 })
    f = await phoneFaults(ph.p, '.sd-ask')
    ok(!Object.keys(f).length, `phone ${width}: Ask an agent fits, its fields at 16 px`, f)
    await ph.p.locator('.sd-ask button', { hasText: 'Cancel' }).click()
    // A sheet: the grid with its tabs, and Ask AI over it from the bottom, fitting.
    await ph.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'budget.xlsx' } })), { root })
    ok(!!(await until(async () => (await ph.p.locator('.sd-univer canvas').count()) > 0 && /Budget/.test(await ph.p.locator('.sd-univer').innerText().catch(() => '')), 30000)), `phone ${width}: a sheet opens, with its tabs`)
    await sleep(600)
    ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `phone ${width}: the sheet fits the screen`)
    await shot(ph.p, `${tag}studio-sheet-phone-${width}`)
    await ph.p.locator('.pane-head button[aria-label="Ask an agent"]').click()
    await ph.p.locator('.sh-ask textarea').waitFor({ timeout: 5000 })
    f = await phoneFaults(ph.p, '.sh-side')
    ok(!Object.keys(f).length, `phone ${width}: Ask AI fits over the sheet, each button a whole target, its fields at 16 px`, f)
    await shot(ph.p, `${tag}studio-sheet-ask-phone-${width}`)
    await ph.p.locator('.sh-ask button[aria-label="Close"]').click()
  }
  // Dark: a sheet in the app's dark look, Ask AI beside it.
  const night = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark' })
  pages.push(night)
  await night.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  // Asked again until it opens (a page just loaded may not be listening yet).
  await until(async () => { if (!(await night.p.locator('.sd-univer').count())) await night.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'ledger.xlsx' } })), { root }); return (await night.p.locator('.sd-univer canvas').count()) > 0 }, 30000, 1000)
  await sleep(1200)
  await night.p.locator('.sd-univer [data-u-command="bridge.sheet.ask-ai"]').click()
  await night.p.locator('.sh-ask').waitFor({ timeout: 5000 })
  await shot(night.p, `${tag}studio-sheet-dark`)
  ok(night.errors.length === 0, 'dark: no page errors', night.errors)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
