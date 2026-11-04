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
import { startKit, startModel, checks, until, sleep, browser, page, shot, TEST, ROOT } from '../lib/harness.mjs'

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
  ok(!!(await until(async () => /Q4 plan/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')) && /Ship the pricing page/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')), 20000)), 'a Word file opens with its heading and text')
  // A sheet.
  await open('budget.xlsx')
  ok(!!(await until(async () => (await p.locator('.sd-univer canvas').count()) > 0, 30000)), 'an Excel file opens in the sheet')
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
  // Ask an agent on the cells picked: B2 (Hosting's cost), clicked in the sheet's drawing (its
  // row numbers 46 wide, its column letters 20 high, columns 88 by rows 24).
  const grid = await p.locator('.sd-univer canvas').evaluateAll((cs) => cs.map((c) => c.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, a: r.width * r.height })).sort((a, b) => b.a - a.a)[0])
  await p.mouse.click(grid.x + 46 + 88 + 44, grid.y + 20 + 24 + 12)
  await sleep(300)
  await p.locator('.pane-head button', { hasText: 'Ask an agent' }).click()
  const picked = await p.locator('.sd-ask-sel').innerText({ timeout: 5000 }).catch(() => '')
  ok(/B2 on Budget/.test(picked) && /120/.test(picked), 'Ask an agent on a sheet: the cells picked, where they are, and their values', picked)
  ok(await p.locator('.sd-ask-to select').inputValue() === agent.paneId, 'and it goes to the agent at work there unless you pick another', await p.locator('.sd-ask-to select').inputValue())
  await shot(p, `${tag}studio-sheet-ask`)
  await p.locator('.sd-ask button', { hasText: 'Cancel' }).click()
  ok(looks <= 2 && reqs.length <= 15, `and asks the server little: whether the file changed ${looks} time${looks === 1 ? '' : 's'} in 10 s, ${reqs.length} requests in all (at most 90 a minute, as everywhere)`, [...new Set(reqs)])
  // A deck, drawn, and its PowerPoint beside it.
  await open('pitch.md')
  const slides = await until(async () => { const h = await p.locator('.sd-deck-view').getAttribute('srcdoc').catch(() => ''); return (h.match(/<svg data-marpit-svg/g) || []).length }, 15000)
  ok(slides === 2, 'a Markdown deck is drawn as its slides', slides)
  await p.locator('.sd-toolbar button', { hasText: 'PowerPoint' }).click()
  ok(!!(await until(() => fs.existsSync(path.join(dir, 'pitch.pptx')) && fs.readFileSync(path.join(dir, 'pitch.pptx')).subarray(0, 2).toString() === 'PK', 15000)), 'PowerPoint: pitch.pptx beside it')
  await shot(p, `${tag}studio-deck`)
  // Its look: the default pack, until the deck names another (pack: Board), which Look writes.
  const drawn = () => p.locator('.sd-deck-view').getAttribute('srcdoc').catch(() => '')
  ok(/#ff8800!important/.test(await drawn()), 'a deck is drawn in your default design pack', (await drawn()).slice(-400))
  await api('/studio/packs', { name: 'Board', colors: { background: '#ffffff', text: '#222222', accent: '#0a7d4f' }, fonts: { heading: 'Georgia', body: 'Georgia' } })
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-refetch', { detail: '/studio/packs' })))
  const look = p.locator('.sd-look select')
  await look.waitFor({ timeout: 15000 })
  await look.selectOption({ label: 'Board' })
  const deckMd = () => p.locator('.sd-deck-md').inputValue()
  ok(!!(await until(async () => /^---\nmarp: true\npack: Board\n---\n/.test(await deckMd()) && /#0a7d4f!important/.test(await drawn()), 5000)), 'Look: another pack, written in its front matter and drawn in it', await deckMd())
  await shot(p, `${tag}studio-look`)
  await look.selectOption({ label: 'Bold (your default)' })
  ok(!!(await until(async () => !/pack:/.test(await deckMd()) && /#ff8800!important/.test(await drawn()), 5000)), 'and back to the default: the line is gone', await deckMd())
  await p.locator('.sd-deck-md').fill('---\nmarp: true\npack: "board"\n---\n\n# Pitch\n')
  ok(!!(await until(async () => /#0a7d4f!important/.test(await drawn()), 5000)), 'a deck that names its pack (any case, quoted or not) is drawn in it')
  await p.locator('.sd-deck-md').fill('---\nmarp: true\npack: Nowhere\n---\n\n# Pitch\n')
  ok(!!(await until(async () => /#ff8800!important/.test(await drawn()) && (await p.locator('.sd-toolbar', { hasText: 'No pack "Nowhere"' }).count()) > 0, 5000)), "a pack you don't have: your default, and it says so")
  // A page, drawn as it's typed.
  await open('dash.html')
  const code = p.locator('.sd-code')
  await code.waitFor({ timeout: 15000 })
  await code.fill('<!doctype html><title>Dash</title><h1 id="h">Revenue</h1>')
  ok(!!(await until(async () => /Revenue/.test(await p.locator('.sd-page-view').getAttribute('srcdoc').catch(() => '')), 5000)), 'a page is drawn as you type it')
  ok(w.errors.length === 0, 'no page errors', w.errors)
  // On a phone: Studio from More, a file open, nothing wider than the screen.
  const ph = await page(b, kit.url, { phone: true })
  pages.push(ph)
  await ph.p.locator('nav.tabbar button', { hasText: 'More' }).first().click({ timeout: 20000 })
  await ph.p.locator('button, .m-more-row', { hasText: 'Studio' }).first().click({ timeout: 10000 })
  await ph.p.waitForSelector('.sd-home', { timeout: 15000 })
  await ph.p.locator('.sd-recent-open', { hasText: 'notes.md' }).first().click()
  ok(!!(await until(async () => /Notes/.test(await ph.p.locator('.sd-page .ProseMirror').innerText().catch(() => '')), 15000)), 'on a phone: Studio in More, a document opened')
  ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'and nothing wider than the screen')
  await shot(ph.p, `${tag}studio-phone`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
