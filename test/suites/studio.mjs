// Studio, on any platform, in the browser named by BRIDGE_TEST_BROWSER. A folder you added to Files
// (a place) with a Word file, an Excel file, a Markdown file, a Markdown deck, a page, a CSV and a
// PDF, all made here. The server: each opens as its kind; a save keeps a version, and one over a
// change made meanwhile is refused; a change from outside, or from an agent asked, is kept as a
// version by them; an older version put back keeps the one before too; a new file never
// overwrites; design packs. The page: Studio's home with New and Recent; a Markdown file edited
// and saved; a Word file's text; a sheet; a deck drawn, and its PowerPoint beside it; a page drawn
// as it's typed; versions and Put back; Ask an agent queueing the change for the agent you pick.
// The editors finished: a document's toolbar (each button named, with its shortcut in its tooltip,
// doing what it says and showing it, only what the format keeps), heading levels, links, a table's
// rows, undo and redo, the shortcuts; a quote, an underline and a link kept through a save; the
// header's kind, size and folder never cut off; the status line; each kind saying what it is and
// what it can't do; on 375 and 430 px phones, Studio's home and a document fitting.
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
  const trial = p.locator('.st-check', { hasText: 'Studio' }).locator('input')
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
  ok(await p.locator('.sd-new-btn').count() === 5 && await p.locator('.sd-recent li', { hasText: 'notes.md' }).count() > 0, "Studio's home: New (document, Markdown, sheet, deck, page) and Recent")
  await shot(p, `${tag}studio-home`)
  // A Markdown file, edited and saved.
  await p.locator('.sd-recent-open', { hasText: 'notes.md' }).first().click()
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
  ok(!!(await until(async () => /Q4 plan/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')) && /Ship the pricing page/.test(await p.locator('.sd-page .ProseMirror').innerText().catch(() => '')), 20000)), 'a Word file opens with its heading and text')
  const h1 = await p.locator('.sd-page.word h1').first().evaluate((e) => { const c = getComputedStyle(e), b = getComputedStyle(e.closest('.sd-page')); return { color: c.color, font: c.fontFamily, size: c.fontSize, body: b.fontFamily, paper: b.backgroundColor } })
  ok(h1.color === 'rgb(192, 0, 0)' && /Georgia/.test(h1.font) && h1.size === '24px' && /Arial/.test(h1.body) && h1.paper === 'rgb(255, 255, 255)', 'in its own look: its fonts, sizes and colours, on white paper', h1)
  await shot(p, `${tag}studio-word`)
  // Saved here: the same look in the file (docx would have put its own in).
  const docText = p.locator('.sd-page .ProseMirror')
  await docText.click()
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await p.keyboard.type(' Agreed.')
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const said = await p.locator('.sd-conflict[role="alertdialog"]').innerText({ timeout: 5000 }).catch(() => '')
  ok(/fonts and colours/.test(said), "a Word file's first save here says what's kept", said)
  await p.locator('.sd-conflict[role="alertdialog"] button', { hasText: 'Save' }).click()
  const JSZip = require('jszip')
  const stylesOf = async (file) => { try { return await (await JSZip.loadAsync(fs.readFileSync(file))).file('word/styles.xml').async('string') } catch { return '' } }
  const kept = await until(async () => { const x = await stylesOf(path.join(dir, 'plan.docx')); return /Agreed/.test(await (await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'plan.docx')))).file('word/document.xml').async('string')) && x }, 10000)
  ok(!!kept && /w:ascii="Georgia"/.test(kept) && /w:val="C00000"/.test(kept) && /w:ascii="Arial"/.test(kept) && /w:sz w:val="36"/.test(kept) && !/2E74B5/.test(kept.split('Heading1')[1]?.split('</w:style>')[0] || ''), 'saved: the change, in the same fonts, sizes and colours', kept && kept.slice(0, 300))
  // ---------- A document's toolbar (a Word file) ----------
  // Each button named, with its shortcut in its tooltip; only what a Word file keeps (no code,
  // which docx.js would write as plain text); undo and redo with nothing done yet, off.
  const tb = p.locator('.sd-doc-tools')
  const tools = await tb.locator('button').evaluateAll((bs) => bs.map((b) => ({ name: b.getAttribute('aria-label'), title: b.title, pressed: b.getAttribute('aria-pressed'), off: b.disabled })))
  const names = tools.map((x) => x.name)
  ok(JSON.stringify(names) === JSON.stringify(['Bold', 'Italic', 'Underline', 'Strikethrough', 'Bulleted list', 'Numbered list', 'Quote', 'Insert link', 'Table', 'Undo', 'Redo']), "a Word file's toolbar: marks, lists, quote, link, table, undo and redo, in that order (no code: a Word file wouldn't keep it)", names)
  const key = process.platform === 'darwin' ? '⌘' : 'Ctrl'
  ok(tools.every((x) => x.title.startsWith(x.name)) && ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Bulleted list', 'Numbered list', 'Quote', 'Undo', 'Redo'].every((n) => tools.find((x) => x.name === n).title.includes(key)), 'every button has a tooltip with its name, and its shortcut where it has one', tools.map((x) => x.title))
  ok(tools.filter((x) => x.pressed !== null).map((x) => x.name).join() === 'Bold,Italic,Underline,Strikethrough,Bulleted list,Numbered list,Quote,Insert link', 'each mark and block says whether it is on (aria-pressed)', tools)
  const styles = await tb.locator('select.sd-style option').allInnerTexts()
  ok(styles.join() === 'Paragraph,Heading 1,Heading 2,Heading 3' && /Text style/.test(await tb.locator('select.sd-style').getAttribute('title')), 'a Text style menu: Paragraph and Heading 1 to 3', styles)
  ok(!!(await bare(p).then((x) => !x.length)), 'nothing on the page is a bare control: each has a name, and an icon-only one a tooltip', await bare(p))
  // A line of its own, picked, then each mark and block on and off: shown in the text and on its button.
  const btn = (name) => tb.locator(`button[aria-label="${name}"]`)
  const pressed = async (name) => (await btn(name).getAttribute('aria-pressed')) === 'true'
  await docText.click()
  await p.keyboard.press(`${MOD}+End`)
  await p.keyboard.press('Enter')
  await p.keyboard.type('Toggle me')
  // The line picked whole (a triple click), whatever it's in by then.
  const pick = () => docText.locator('p', { hasText: 'Toggle me' }).click({ clickCount: 3 })
  await pick()
  const has = (sel) => docText.locator(sel, { hasText: 'Toggle me' }).count()
  // It carries on in bold from the line before (" Agreed.", typed after bold words): the button
  // says so, and takes it off.
  if (await pressed('Bold')) { await btn('Bold').click(); await until(async () => (await has('strong')) === 0, 3000, 100) }
  const toggles = []
  for (const [name, sel] of [['Bold', 'strong'], ['Italic', 'em'], ['Underline', 'u'], ['Strikethrough', 's'], ['Bulleted list', 'ul'], ['Numbered list', 'ol'], ['Quote', 'blockquote']]) {
    await btn(name).click()
    const on = !!(await until(async () => (await has(sel)) === 1 && await pressed(name), 3000, 100))
    await btn(name).click()
    const off = !!(await until(async () => (await has(sel)) === 0 && !(await pressed(name)), 3000, 100))
    toggles.push(`${name} ${on ? 'on' : 'NOT ON'} ${off ? 'off' : 'NOT OFF'}`)
  }
  ok(toggles.every((x) => /on off$/.test(x)), 'each mark and block does what it says, and its button shows it on, then off again', toggles)
  // Heading levels, from the menu and from the keyboard (⌥⌘1, which the app's own ⌥1 doesn't take).
  const style = tb.locator('select.sd-style')
  const levels = []
  for (const v of ['h2', 'h3', 'p']) { await style.selectOption(v); levels.push(await until(async () => (await has(v)) === 1 && (await style.inputValue()) === v, 3000, 100) ? v : `not ${v}`) }
  await docText.locator('p', { hasText: 'Toggle me' }).click()
  await p.keyboard.press(`${MOD}+Alt+Digit1`)
  levels.push(await until(async () => (await has('h1')) === 1 && (await style.inputValue()) === 'h1', 3000, 100) ? 'keys h1' : 'keys not h1')
  await p.keyboard.press(`${MOD}+Alt+Digit0`)
  levels.push(await until(async () => (await has('p')) === 1 && (await style.inputValue()) === 'p', 3000, 100) ? 'keys p' : 'keys not p')
  ok(levels.join() === 'h2,h3,p,keys h1,keys p', 'Text style: Heading 2, Heading 3 and back to Paragraph; and from the keyboard', levels)
  await pick()
  await p.keyboard.press(`${MOD}+b`)
  const boldKeys = !!(await until(async () => (await has('strong')) === 1 && await pressed('Bold'), 3000, 100))
  await p.keyboard.press(`${MOD}+b`)
  ok(boldKeys && !!(await until(async () => (await has('strong')) === 0, 3000, 100)), 'the shortcuts work too: ⌘B bold, and off again')
  // A link: added from the link bar to what's picked (example.com made https://example.com), shown
  // on its button, and taken back with Undo, put back with Redo.
  ok(!!(await until(async () => !(await btn('Undo').isDisabled()) && await btn('Redo').isDisabled(), 3000, 100)), 'Undo is there once something is done; Redo is not, until something is undone')
  // Clicked again until the link bar shows (WebKit can take a click while the toolbar redraws).
  await until(async () => { if (!(await p.locator('.sd-linkbar input').count())) await btn('Insert link').click(); return p.locator('.sd-linkbar input').waitFor({ timeout: 1500 }).then(() => true, () => false) }, 10000, 300)
  await p.locator('.sd-linkbar input').fill('example.com')
  await p.locator('.sd-linkbar input').press('Enter')
  const link = docText.locator('a[href="https://example.com"]', { hasText: 'Toggle me' })
  ok(!!(await until(async () => (await link.count()) === 1 && (await p.locator('.sd-linkbar').count()) === 0, 3000, 100)), 'Link: the address typed (made whole) on what is picked, and the bar gone')
  await link.click()
  ok(!!(await until(() => pressed('Insert link'), 3000, 100)), 'in the link, its button shows it')
  await btn('Undo').click()
  const undone = !!(await until(async () => (await link.count()) === 0, 3000, 100))
  await btn('Redo').click()
  ok(undone && !!(await until(async () => (await link.count()) === 1, 3000, 100)), 'Undo takes the link back, Redo puts it back')
  // A table: added, a row added and the table deleted from its button's menu.
  const tables = await docText.locator('table').count()
  await pick()
  await p.keyboard.press('ArrowRight')
  await btn('Table').click()
  const added = !!(await until(async () => (await docText.locator('table').count()) === tables + 1, 3000, 100))
  const table = docText.locator('table').last()
  const rows = await table.locator('tr').count()
  await btn('Table').click()
  await p.locator('.sd-tool-menu button', { hasText: 'Add a row below' }).click()
  const more = !!(await until(async () => (await table.locator('tr').count()) === rows + 1, 3000, 100))
  await btn('Table').click()
  await p.locator('.sd-tool-menu button', { hasText: 'Delete the table' }).click()
  ok(added && rows === 3 && more && !!(await until(async () => (await docText.locator('table').count()) === tables, 3000, 100)), 'Table: a 3 by 3 table with a header row, a row added below, and deleted, from its menu', { added, rows, more })
  // Kept through a save: the line as a quote, underlined, with its link; read back as they were.
  await pick()
  await btn('Underline').click()
  await btn('Quote').click()
  ok(/Unsaved changes/.test(await p.locator('.sd-status').innerText()), 'the status line says there are unsaved changes', await p.locator('.sd-status').innerText())
  await p.locator('.pane-head button', { hasText: 'Save' }).click()
  const xml = () => JSZip.loadAsync(fs.readFileSync(path.join(dir, 'plan.docx'))).then((z) => z.file('word/document.xml').async('string')).catch(() => '')
  const wrote = await until(async () => { const x = await xml(); return /Toggle me/.test(x) && x }, 10000)
  ok(!!wrote && /<w:pStyle w:val="Quote"\/>/.test(wrote) && /<w:u /.test(wrote) && /<w:hyperlink/.test(wrote), "saved as Word's own: a quote in its Quote style, the underline, the link", wrote && wrote.slice(wrote.indexOf('Toggle') - 400, wrote.indexOf('Toggle') + 40))
  ok(!!(await until(async () => /Saved/.test(await p.locator('.sd-status .sd-state').innerText()), 5000)), 'and then the status line says Saved')
  await p.locator('.sd-file button[aria-label="Back to Studio"]').click()
  await p.locator('.sd-home').waitFor({ timeout: 10000 })
  await open('plan.docx')
  ok(!!(await until(async () => (await docText.locator('blockquote u', { hasText: 'Toggle me' }).count()) === 1 && (await docText.locator('blockquote a[href="https://example.com"]').count()) === 1, 15000)), 'opened again: still a quote, underlined, with its link', await docText.innerHTML().catch(() => ''))
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
  ok(/keeps its text, headings, lists, tables, links, quotes/.test(await p.locator('.sd-note-bar').innerText().catch(() => '')), 'and tapped, the kind says what saving keeps', await p.locator('.sd-note-bar').innerText().catch(() => ''))
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
  // Ask an agent on the cells picked: B2 (Hosting's cost), clicked in the sheet's drawing (its
  // row numbers 46 wide, its column letters 20 high, columns 88 by rows 24).
  const grid = await p.locator('.sd-univer canvas').evaluateAll((cs) => cs.map((c) => c.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, a: r.width * r.height })).sort((a, b) => b.a - a.a)[0])
  await p.mouse.click(grid.x + 46 + 88 + 44, grid.y + 20 + 24 + 12)
  await sleep(300)
  await p.locator('.pane-head button', { hasText: 'Ask an agent' }).click()
  const picked = await p.locator('.sd-ask-sel').innerText({ timeout: 5000 }).catch(() => '')
  ok(/B2 on Budget/.test(picked) && /120/.test(picked), 'Ask an agent on a sheet: the cells picked, where they are, and their values', picked)
  ok(!!(await until(async () => (await p.locator('.sd-ask-to select').inputValue()) === agent.paneId, 5000)), 'and it goes to the agent at work there unless you pick another', await p.locator('.sd-ask-to select').inputValue())
  await shot(p, `${tag}studio-sheet-ask`)
  await p.locator('.sd-ask button', { hasText: 'Cancel' }).click()
  ok(looks <= 2 && reqs.length <= 15, `and asks the server little: whether the file changed ${looks} time${looks === 1 ? '' : 's'} in 10 s, ${reqs.length} requests in all (at most 90 a minute, as everywhere)`, [...new Set(reqs)])
  // A deck, drawn, and its PowerPoint beside it.
  await open('pitch.md')
  const slides = await until(async () => { const h = await p.locator('.sd-deck-view').getAttribute('srcdoc').catch(() => ''); return (h.match(/<svg data-marpit-svg/g) || []).length }, 15000)
  ok(slides === 2, 'a Markdown deck is drawn as its slides', slides)
  ok(!!(await until(async () => { const x = await p.locator('.sd-status').innerText(); return /2 slides/.test(x) && /Markdown deck/.test(x) }, 5000)) && !(await bare(p)).length, 'its status line: 2 slides, a Markdown deck; no bare controls', { status: await p.locator('.sd-status').innerText(), bare: await bare(p) })
  await p.locator('.sd-toolbar [role="tab"]', { hasText: 'Slides' }).click()
  const alone = !!(await until(async () => (await p.locator('.sd-deck-md').count()) === 0 && (await p.locator('.sd-deck-view').count()) === 1, 3000, 100))
  await p.locator('.sd-toolbar [role="tab"]', { hasText: 'Both' }).click()
  ok(alone && !!(await until(async () => (await p.locator('.sd-deck-md').count()) === 1, 3000, 100)), 'Slides alone, for room, and back to both')
  ok(await p.locator('.sd-deck-md').evaluate((e) => getComputedStyle(e).fontVariantLigatures) === 'none', 'the deck\'s Markdown shows what\'s typed: no ligatures (<!-- and --> as typed)')
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
  // A PDF: shown, or where the browser shows one only on its own, saying so with it a tap away.
  // Nothing to save, and it says so.
  await open('report.pdf')
  const pdf = await until(async () => ((await p.locator('iframe.sd-pdf').count()) ? 'inline' : (await p.locator('.sd-empty', { hasText: 'shows a PDF on its own' }).locator('a', { hasText: 'Open it' }).count()) ? 'said' : null), 10000)
  ok(!!pdf && !!(await until(async () => /Read only/.test(await p.locator('.sd-status').innerText()), 5000)) && (await p.locator('.pane-head button', { hasText: 'Save' }).count()) === 0 && !(await bare(p)).length, `a PDF: ${pdf === 'said' ? 'this browser shows one only on its own, which it says, with Open it' : 'shown in the page'}; read only, no Save`, { pdf, status: await p.locator('.sd-status').innerText().catch(() => ''), bare: await bare(p) })
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
    await until(async () => (await ph.p.locator('.sd-recent li').count()) > 0, 10000)
    await sleep(400)
    let f = await phoneFaults(ph.p, '.sd-home')
    ok(!Object.keys(f).length, `phone ${width}: Studio's home fits (nothing wider, past its edge or cut off; each control a whole 40 px target, each field 16 px)`, f)
    await shot(ph.p, `${tag}studio-home-phone-${width}`)
    await ph.p.locator('.sd-recent-open', { hasText: 'notes.md' }).first().click()
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
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
