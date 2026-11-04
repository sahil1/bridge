// Studio, on any platform, in the browser named by BRIDGE_TEST_BROWSER. A folder you added to Files
// (a place) with a Word file, an Excel file, a Markdown file, a Markdown deck, a page, a CSV and a
// PDF, all made here. The server: each opens as its kind; a save keeps a version, and one over a
// change made meanwhile is refused; a change from outside, or from an agent asked, is kept as a
// version by them; an older version put back keeps the one before too; a new file never
// overwrites; design packs. The page: Studio's home with New and Recent; a Markdown file edited
// and saved; a Word file's text; a sheet; a deck drawn, and its PowerPoint beside it; a page drawn
// as it's typed; versions and Put back; Ask an agent queueing the change for the agent you pick.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startKit, checks, until, sleep, browser, page, shot, TEST, ROOT } from '../lib/harness.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const { ok, done } = checks('studio')
const kit = await startKit('studio', { env: { CLAUDE_STAND_IN_TYPED: '1' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const err = (p, body, method) => api(p, body, method).then(() => null, (e) => e)
const q = (f) => `root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`
const put = (f, body, mtime) => fetch(`${kit.url}/api/studio/file?${q(f)}&mtime=${mtime}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
const pages = []
try {
  await api('/setup', { name: 'Tester' })
  await api('/agents/catalog')
  // ---------- The files ----------
  const dir = path.join(kit.home, 'Work', 'q4')
  fs.mkdirSync(dir, { recursive: true })
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx')
  fs.writeFileSync(path.join(dir, 'plan.docx'), await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Q4 plan')] }), new Paragraph({ children: [new TextRun({ text: 'Ship the pricing page by November.', bold: true })] })] }] })))
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Budget')
  ws.addRow(['Item', 'Cost']); ws.addRow(['Hosting', 120]); ws.addRow(['Design', 900]); ws.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 1020 }; ws.getCell('A1').font = { bold: true }
  await wb.xlsx.writeFile(path.join(dir, 'budget.xlsx'))
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nFirst draft.\n')
  fs.writeFileSync(path.join(dir, 'pitch.md'), '---\nmarp: true\n---\n\n# Pitch\n\n## Q4\n\n---\n\n# Why now\n\n- Customers asked\n- It is ready\n\n<!-- Say the numbers -->\n')
  fs.writeFileSync(path.join(dir, 'dash.html'), '<!doctype html><title>Dash</title><h1 id="h">Dashboard</h1>')
  fs.writeFileSync(path.join(dir, 'data.csv'), 'a,b\n1,"x, y"\n')
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

  // ---------- The page ----------
  const w = await page(b, kit.url, { width: 1400, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await p.locator('.rail-nav-btn', { hasText: 'Studio' }).click()
  await p.waitForSelector('.sd-home', { timeout: 15000 })
  ok(await p.locator('.sd-new-btn').count() === 5 && await p.locator('.sd-recent li', { hasText: 'notes.md' }).count() > 0, "Studio's home: New (document, Markdown, sheet, deck, page) and Recent")
  await shot(p, `${tag}studio-home`)
  // A Markdown file, edited and saved.
  await p.locator('.sd-recent-open', { hasText: 'notes.md' }).first().click()
  const pm = p.locator('.sd-page .ProseMirror')
  ok(!!(await until(async () => /Second draft/.test(await pm.innerText().catch(() => '')), 15000)), 'a Markdown file opens as a document')
  await pm.click()
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await p.keyboard.type(' Edited here.')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  ok(!!(await until(() => fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').includes('Edited here.'), 8000)) && /^# Notes/.test(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8')), 'typed and saved: still Markdown, with the change', fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'))
  await p.locator('button[aria-label="Versions"]').click()
  ok(!!(await until(async () => (await p.locator('.sd-versions li').count()) >= 5, 5000)) && /You/.test(await p.locator('.sd-versions li').first().innerText()), 'Versions: yours on top, the agent\'s and the others under it', await p.locator('.sd-versions').innerText().catch(() => ''))
  await shot(p, `${tag}studio-doc`)
  // A change from outside while it's open, with nothing unsaved: shown at once.
  await sleep(50)
  fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n\nChanged by another app.\n')
  ok(!!(await until(async () => /Changed by another app/.test(await pm.innerText().catch(() => '')) && /changed it/.test(await p.locator('.sd-bar').innerText().catch(() => '')), 10000)), 'a change from outside while open is shown, and said')
  // Ask an agent, from the page.
  await p.locator('.pane-head button', { hasText: 'Ask an agent' }).click()
  await p.locator('.sd-ask textarea').fill('add a summary at the top')
  await p.locator('.sd-ask-to select').selectOption(agent.paneId)
  await p.locator('.sd-ask button', { hasText: 'Send' }).click()
  ok(!!(await until(async () => /Sent to/.test(await p.locator('.sd-bar').innerText().catch(() => '')), 5000)), 'Ask an agent: sent to the agent picked, and it says so')
  // A Word file's text.
  const open = async (name) => p.evaluate(({ root, name }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: name } })), { root, name })
  await open('plan.docx')
  ok(!!(await until(async () => /Q4 plan/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')) && /Ship the pricing page/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')), 20000)), 'a Word file opens with its heading and text')
  // A sheet.
  await open('budget.xlsx')
  ok(!!(await until(async () => (await p.locator('.sd-univer canvas').count()) > 0, 30000)), 'an Excel file opens in the sheet')
  await shot(p, `${tag}studio-sheet`)
  // A deck, drawn, and its PowerPoint beside it.
  await open('pitch.md')
  const slides = await until(async () => { const h = await p.locator('.sd-deck-view').getAttribute('srcdoc').catch(() => ''); return (h.match(/<svg data-marpit-svg/g) || []).length }, 15000)
  ok(slides === 2, 'a Markdown deck is drawn as its slides', slides)
  await p.locator('.sd-toolbar button', { hasText: 'PowerPoint' }).click()
  ok(!!(await until(() => fs.existsSync(path.join(dir, 'pitch.pptx')) && fs.readFileSync(path.join(dir, 'pitch.pptx')).subarray(0, 2).toString() === 'PK', 15000)), 'PowerPoint: pitch.pptx beside it')
  await shot(p, `${tag}studio-deck`)
  // A page, drawn as it's typed.
  await open('dash.html')
  const code = p.locator('.sd-code')
  await code.waitFor({ timeout: 15000 })
  await code.fill('<!doctype html><title>Dash</title><h1 id="h">Revenue</h1>')
  ok(!!(await until(async () => /Revenue/.test(await p.locator('.sd-page-view').getAttribute('srcdoc').catch(() => '')), 5000)), 'a page is drawn as you type it')
  ok(w.errors.length === 0, 'no page errors', w.errors)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
