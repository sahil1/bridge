// Studio's sheets as someone coming from Google Sheets uses them, in the browser named by
// BRIDGE_TEST_BROWSER (studio.mjs has the rest of Studio, studio-xlsx the Excel engine). A
// 50,000-row CSV and a 20-sheet workbook open in seconds and scroll smoothly; a CSV's numbers,
// percents, amounts and dates are numbers that add up (its codes with leading zeros stay text),
// written back exactly as they were, and a date or percent typed in is saved as it shows, not as a
// serial number; one cell changed in the big CSV changes one line. The keys Google Sheets users
// reach for (Home, End, ⌘Home, ⌘End, Page Down, Shift+Space, Ctrl+Space, ⌥↓, Ctrl+Shift+1/4/5,
// ⌘;, ⌘\, ⇧⌘V, ⌘K for a link rather than the app's search, ⇧⌘H, ⌘P); undo 70 steps back;
// what's typed keeps no colour of its own, and a word added to a cell keeps it plain text; a
// formula's error says why when its cell is picked; Insert › Chart of the cells picked, its kind and title
// changed beside the sheet, saved as Excel's own chart; the status line counting a sheet added;
// Focus keeping the sheet's keys (Esc ends a cell's typing first, ⌘K still its link); AI Assist
// answered by its model (the stand-in) in seconds: saying how to add one when there's none, Write a
// formula and Clean this column as suggestions outlined on the sheet, discarded or kept (Keep all),
// Summarise said beside it, Chart this drawn first, an answer that isn't a change said, and Hand to
// an agent still there; Make a sheet (Make a Sheet, a beta feature): New › Sheet said what it's for
// (or the empty sheet's Make a sheet) gives a whole workbook shown first, Discard emptying it again,
// Keep saving it as an Excel file with its sheets, formulas, formats, a dropdown and the heading
// row frozen, and no model said; with the beta off, nothing new; light and dark; no page errors.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startKit, startModel, checks, until, sleep, browser, page, shot, ROOT } from '../lib/harness.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const ExcelJS = require('exceljs')
const JSZip = require('jszip')
const { ok, skip, done } = checks('studio-sheets')
const kit = await startKit('studio-sheets')
const model = await startModel('studio-sheets')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const pages = []
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/settings', { trials: { studio: true } }, 'PATCH')
  const dir = path.join(kit.home, 'Work', 'sheets')
  fs.mkdirSync(dir, { recursive: true })
  // 50,000 rows: codes with leading zeros, names, amounts with two decimals, dates, percents.
  const towns = ['Springfield', 'Rivertown', 'Lakeside', 'Hillview', 'Brookfield']
  const lines = ['Id,Name,Town,Amount,Date,Share']
  for (let i = 1; i <= 50000; i++) lines.push([String(i).padStart(6, '0'), `Person ${i}`, towns[i % 5], (i * 3.7 % 1000).toFixed(2), `2026-0${(i % 9) + 1}-1${i % 10}`, `${i % 100}%`].join(','))
  const bigCsv = `${lines.join('\n')}\n`
  fs.writeFileSync(path.join(dir, 'big.csv'), bigCsv)
  // 20 sheets of 300 rows, each with a total down the side and at the foot.
  const big = new ExcelJS.Workbook()
  for (let s = 1; s <= 20; s++) {
    const ws = big.addWorksheet(`Region ${s}`)
    ws.addRow(['Month', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'Total'])
    for (let r = 2; r <= 301; r++) { ws.addRow([`M${r - 1}`, ...Array.from({ length: 10 }, (_, c) => (r * (c + 1) * s) % 997)]); ws.getCell(`L${r}`).value = { formula: `SUM(B${r}:K${r})` } }
    ws.getCell('L302').value = { formula: 'SUM(L2:L301)' }
  }
  await big.xlsx.writeFile(path.join(dir, 'regions.xlsx'))
  const small = new ExcelJS.Workbook()
  const ss = small.addWorksheet('Budget')
  ss.addRow(['Item', 'Cost', 'Qty'])
  for (const r of [['Hosting', 120, 1], ['Design', 900, 2], ['Fonts', 45, 3], ['Legal', 610, 1], ['Travel', 300, 4]]) ss.addRow(r)
  ss.getCell('A7').value = 'Total'; ss.getCell('B7').value = { formula: 'SUM(B2:B6)', result: 1975 }
  small.addWorksheet('Notes').getCell('A1').value = 'Second sheet'
  await small.xlsx.writeFile(path.join(dir, 'budget.xlsx'))
  // For AI Assist: costs whose names want cleaning up.
  const costs = new ExcelJS.Workbook()
  const cs = costs.addWorksheet('Costs')
  for (const r of [['Item', 'Cost', 'Qty'], ['  hosting', 120, 1], ['design ', 900, 2], ['Fonts', 45, 3], ['legal', 610, 1], ['Travel', 300, 4]]) cs.addRow(r)
  await costs.xlsx.writeFile(path.join(dir, 'costs.xlsx'))
  const quirks = 'Code,When,Price,Pct\n007,2026-01-05,1200,10%\n0042,05/01/2026,"1,200.50",3.5%\n'
  fs.writeFileSync(path.join(dir, 'quirks.csv'), quirks)
  const root = `place:${(await kit.api('/places', { path: dir })).place.id}`

  const w = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push(w)
  const p = w.p
  if (which === 'chromium') await w.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: kit.url })
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  const sheetState = () => p.locator('.sd-status .sd-state').innerText().catch(() => '')
  // A file opened as from Files: the time until its grid is drawn and Studio's done opening it.
  const open = async (name) => {
    const t0 = Date.now()
    // Asked again until it's on its way (a page just loaded may not be listening yet).
    const asked = () => p.locator('.sd-file .pane-head', { hasText: name }).count().then((n) => n > 0)
    await until(async () => { await p.evaluate(({ root, name }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: name } })), { root, name }); return until(asked, 2000, 100) }, 30000, 0)
    await until(async () => (await asked()) && (await p.locator('.sd-file .sd-univer canvas').count()) > 0 && !(await p.locator('.sd-loading').count()), 60000, 100)
    const ms = Date.now() - t0
    await sleep(400)
    // The name box: the formula bar's first field, holding the cell picked (A1 when it opens).
    await until(() => p.evaluate(() => { document.querySelectorAll('[data-name-box]').forEach((x) => x.removeAttribute('data-name-box')); const i = [...document.querySelectorAll('.sd-file .sd-univer [data-u-comp="defined-name"] input, .sd-file .sd-univer input')].find((x) => /^[A-Z]+[0-9]+$/.test(x.value)); i?.setAttribute('data-name-box', '1'); return !!i }), 15000, 200)
    return ms
  }
  const nameBox = () => p.locator('input[data-name-box]').inputValue().catch(() => '')
  // A cell picked by its name, as in the name box (the mouse would need the grid's sizes).
  const goTo = async (a1) => { const nb = p.locator('input[data-name-box]'); await nb.click(); await nb.fill(a1); await nb.press('Enter'); await sleep(200) }
  // Saved with ⌘S; what it says instead, when it doesn't (and a picture of it).
  let unsaved = null
  const save = async () => {
    await p.keyboard.press(`${MOD}+s`)
    if (await until(async () => (await sheetState()) === 'Saved', 20000)) return true
    unsaved = { state: await sheetState(), said: await p.locator('.sd-file [role="alert"], .sd-file [role="alertdialog"], .sd-note-bar').allInnerTexts().catch(() => []), focus: await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)) }
    await shot(p, `${tag}studio-sheets-unsaved`)
    return false
  }
  const typeIn = async (a1, text) => { await goTo(a1); await p.keyboard.type(text); await p.keyboard.press('Enter'); await sleep(150) }
  const grid = async () => { const c = await p.locator('.sd-univer canvas').evaluateAll((cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }).sort((a, b) => b.w * b.h - a.w * a.h)[0]); return c }

  // ---------- Big files ----------
  const bigMs = await open('big.csv')
  ok(bigMs < 12000 && /1 sheet/.test(await p.locator('.sd-status').innerText()), `a 50,000-row CSV opens in seconds (${bigMs} ms)`, bigMs)
  // Smooth to scroll: frames counted while the wheel goes down the rows, then across.
  const g = await grid()
  await p.mouse.move(g.x + g.w / 2, g.y + g.h / 2)
  await p.evaluate(() => { window.__frames = []; let last = performance.now(); const tick = (t) => { window.__frames.push(t - last); last = t; if (!window.__stop) requestAnimationFrame(tick) }; window.__stop = false; requestAnimationFrame(tick) })
  for (let i = 0; i < 60; i++) { await p.mouse.wheel(i < 40 ? 0 : 300, i < 40 ? 500 : 0); await sleep(16) }
  const frames = await p.evaluate(() => { window.__stop = true; const f = window.__frames.slice(2); return { n: f.length, avg: f.reduce((a, b) => a + b, 0) / f.length, worst: Math.max(...f) } })
  ok(frames.avg < 50 && frames.worst < 1000, `and scrolls smoothly: a frame every ${Math.round(frames.avg)} ms on average, the slowest ${Math.round(frames.worst)} ms`, frames)
  await goTo('A1')
  await p.keyboard.press(`${MOD}+ArrowDown`)
  ok(!!(await until(async () => (await nameBox()) === 'A50001', 5000)), '⌘↓ goes to its last row, 50,001', await nameBox())
  await shot(p, `${tag}studio-sheets-big-csv`)
  // One cell changed and saved: that line, and no other, is different.
  await typeIn('B3', 'Changed name')
  const t0 = Date.now()
  ok(!!(await save()), 'the big CSV saved')
  const after = fs.readFileSync(path.join(dir, 'big.csv'), 'utf8').split('\n')
  const differ = bigCsv.split('\n').map((l, i) => (l !== after[i] ? i : -1)).filter((i) => i >= 0)
  ok(differ.length === 1 && differ[0] === 2 && after[2] === '000002,Changed name,Lakeside,7.40,2026-03-12,2%', `one cell changed and saved (${Date.now() - t0} ms): that line alone is different, its amount, date and percent written as they were`, { differ: differ.slice(0, 5), line: after[2] })
  const regionsMs = await open('regions.xlsx')
  ok(regionsMs < 8000 && /20 sheets/.test(await p.locator('.sd-status').innerText()), `a 20-sheet workbook opens in seconds (${regionsMs} ms)`, regionsMs)
  // ⌥↓ and ⌥↑ go from sheet to sheet, as in Google Sheets: down three, up one, and a word typed
  // there (in its own cell picked, A1 on a sheet not visited yet) is on Region 3.
  await goTo('B2')
  for (const k of ['Alt+ArrowDown', 'Alt+ArrowDown', 'Alt+ArrowDown', 'Alt+ArrowUp']) { await p.keyboard.press(k); await sleep(250) }
  await p.keyboard.type('Here'); await p.keyboard.press('Enter')
  ok(await save(), 'saved', unsaved)
  const regions = new ExcelJS.Workbook()
  await regions.xlsx.readFile(path.join(dir, 'regions.xlsx'))
  ok(regions.worksheets.filter((x) => x.getCell('A1').value === 'Here').map((x) => x.name).join() === 'Region 3', '⌥↓ and ⌥↑: the next sheet and the one before', regions.worksheets.map((x) => [x.name, x.getCell('A1').value]).slice(0, 5))

  // ---------- A CSV's numbers ----------
  await open('quirks.csv')
  await shot(p, `${tag}studio-sheets-csv`)
  await typeIn('E1', 'Sum')
  await typeIn('E2', '=SUM(C2:C3)')
  await typeIn('E3', '=SUM(D2:D3)')
  await typeIn('F2', '2026-04-01')
  await typeIn('F3', '15%')
  ok(!!(await save()), 'a CSV with a sum, a date and a percent typed in, saved')
  ok(fs.readFileSync(path.join(dir, 'quirks.csv'), 'utf8') === 'Code,When,Price,Pct,Sum\n007,2026-01-05,1200,10%,2400.5,2026-04-01\n0042,05/01/2026,"1,200.50",3.5%,0.135,15%\n',
    'a CSV\'s amounts and percents add up ("1,200.50" is 1200.5, "3.5%" is 0.035), its codes keep their leading zeros, and a date and a percent typed in are saved as they show, every field as it was written', fs.readFileSync(path.join(dir, 'quirks.csv'), 'utf8'))

  // ---------- The keys Google Sheets users reach for ----------
  await open('budget.xlsx')
  await goTo('C3'); await p.keyboard.press('Home'); const home = await nameBox()
  await p.keyboard.press('End'); const end = await nameBox()
  await p.keyboard.press(`${MOD}+End`); const sheetEnd = await nameBox()
  await p.keyboard.press(`${MOD}+Home`); const sheetStart = await nameBox()
  ok(home === 'A3' && end === 'C3' && sheetEnd === 'C7' && sheetStart === 'A1', 'Home, End, ⌘End and ⌘Home: the row\'s first and last filled cells, the sheet\'s last and first', { home, end, sheetEnd, sheetStart })
  await p.keyboard.press('PageDown'); const down = await nameBox()
  await p.keyboard.press('PageUp')
  ok(/^A(1[5-9]|[2-4]\d)$/.test(down) && (await nameBox()) === 'A1', 'Page Down and Page Up: a screen down and back', { down, up: await nameBox() })
  await goTo('B3'); await p.keyboard.press('Shift+Space'); const row = await nameBox()
  await goTo('B3'); await p.keyboard.press('Control+Space'); const col = await nameBox()
  ok(row === '3:3' && col === 'B:B', 'Shift+Space picks the whole row, Ctrl+Space the whole column', { row, col })
  await goTo('B3'); await p.keyboard.press('Control+Shift+4')
  await goTo('B4'); await p.keyboard.press('Control+Shift+5')
  await goTo('B5'); await p.keyboard.press('Control+Shift+1')
  await goTo('B6'); await p.keyboard.press('Control+Shift+4'); await sleep(200); await p.keyboard.press(`${MOD}+\\`)
  await goTo('E2'); await p.keyboard.press(`${MOD}+;`)
  // Paste the values only: the total's 1975, not its formula. Where the browser won't let the page
  // read what was copied (WebKit's test build), it says so rather than doing nothing.
  await goTo('B7'); await p.keyboard.press(`${MOD}+c`); await sleep(300)
  await goTo('D9'); await p.keyboard.press(`${MOD}+Shift+v`); await sleep(800)
  const pasteSaid = await p.locator('.sh-note[role="alert"]').innerText().catch(() => '')
  await p.locator('.sh-note[role="alert"] .link-btn').click({ timeout: 1000 }).catch(() => {})
  // ⌘K is the sheet's: Insert link, not the app's search.
  await goTo('A2'); await p.keyboard.press(`${MOD}+k`); await sleep(500)
  const link = { palette: await p.locator('.palette').count(), field: await p.locator('input[placeholder="Enter link"]').count() }
  await shot(p, `${tag}studio-sheets-link`)
  await p.keyboard.press('Escape'); await sleep(150); await p.locator('button', { hasText: /^Cancel$/ }).first().click({ timeout: 1000 }).catch(() => {})
  ok(link.palette === 0 && link.field === 1, '⌘K on a sheet adds a link to the cell, as in Google Sheets, rather than opening the app\'s search', link)
  await goTo('A2'); await p.keyboard.press(`${MOD}+Shift+h`)
  ok(!!(await until(async () => (await p.locator('.sd-univer, body').getByText('Replace', { exact: false }).count()) > 0, 3000)), '⇧⌘H opens find and replace')
  await p.keyboard.press('Escape'); await sleep(150)
  // ⌘P: a page of the sheet's cells as they show, to the system's Print (Save as PDF there).
  await goTo('A2'); await p.keyboard.press(`${MOD}+p`)
  const printed = await until(async () => p.locator('iframe.sh-print-frame').last().evaluate((f) => f.contentDocument?.body?.innerText || '').catch(() => ''), 5000)
  ok(/Item\s+Cost\s+Qty/.test(printed || '') && /Total\s+1975/.test(printed || ''), '⌘P (and Print beside undo and redo): the sheet\'s cells as they show, to print or save as PDF', (printed || '').slice(0, 200))
  ok((await p.locator('.sd-univer [data-u-command="bridge.sheet.print-button"]').count()) === 1, 'Print is in the ribbon beside undo and redo')

  // ---------- Focus ----------
  // A sheet in Focus keeps its keys: Focus's own types nothing into the cell picked, Esc while a
  // cell is typed in puts it back and stays in Focus, ⌘K is still the sheet's link, and Esc with a
  // cell picked leaves.
  const sheetFocus = () => p.locator('.sd-file.focus').count().then((n) => n === 1)
  ok(await save(), 'saved', unsaved)
  await goTo('A2')
  await p.keyboard.press(`${MOD}+Alt+f`)
  ok(!!(await until(sheetFocus, 3000, 100)) && (await sheetState()) === 'Saved', 'a sheet: Focus by its key, nothing typed into the cell', await sheetState())
  await p.keyboard.type('Draft')
  await sleep(200)
  await p.keyboard.press('Escape')
  await sleep(400)
  ok(await sheetFocus() && (await sheetState()) === 'Saved', 'Esc while a cell is typed in: the cell put back, still in Focus', await sheetState())
  await goTo('A2'); await p.keyboard.press(`${MOD}+k`); await sleep(500)
  const linkInFocus = { palette: await p.locator('.palette').count(), field: await p.locator('input[placeholder="Enter link"]').count() }
  await shot(p, `${tag}studio-sheets-focus`)
  await p.keyboard.press('Escape'); await sleep(150); await p.locator('button', { hasText: /^Cancel$/ }).first().click({ timeout: 1000 }).catch(() => {})
  ok(linkInFocus.palette === 0 && linkInFocus.field === 1 && await sheetFocus(), "⌘K in Focus: still the sheet's link", linkInFocus)
  await goTo('A2')
  await p.keyboard.press('Escape')
  ok(!!(await until(async () => !(await sheetFocus()), 3000, 100)), 'Esc with a cell picked: out of Focus')

  // ---------- Undo, and what's typed ----------
  // 70 values typed into H1 one after another, each undone, then each redone.
  await goTo('H1')
  for (let i = 1; i <= 70; i++) { await p.keyboard.type(String(i)); await p.keyboard.press('Enter'); await p.keyboard.press('ArrowUp') }
  for (let i = 0; i < 70; i++) await p.keyboard.press(`${MOD}+z`)
  await sleep(300)
  ok(await save(), 'saved', unsaved)
  const h1 = async () => { const x = new ExcelJS.Workbook(); await x.xlsx.readFile(path.join(dir, 'budget.xlsx')); return x.getWorksheet('Budget').getCell('H1').value }
  const undone = await h1()
  // Redone with both of redo's keys, on every system: ⇧⌘Z and ⌘Y (Ctrl+Shift+Z and Ctrl+Y).
  for (let i = 0; i < 70; i++) await p.keyboard.press(i % 2 ? `${MOD}+y` : `${MOD}+Shift+z`)
  await sleep(300)
  ok(await save(), 'saved', unsaved)
  const redone = await h1()
  ok(undone == null && redone === 70, 'undo goes back 70 steps (Univer alone kept 50), and redo (both its keys) forward again', { undone, redone })
  await goTo('H1'); await p.keyboard.press('Delete')
  // A word added to a cell's text, and a new cell typed in: plain text, in no colour of its own.
  await goTo('A3'); await p.keyboard.press('F2'); await p.keyboard.type(' work'); await p.keyboard.press('Enter')
  await typeIn('A9', 'New line')

  // ---------- Errors, explained ----------
  // Picked, each says what went wrong (Univer's own alert, in plain words rather than its "Divide
  // by zero error").
  await typeIn('G1', '=1/0')
  await typeIn('G2', '=SUMM(B2:B3)')
  const alertText = async (words) => (await until(async () => (await p.getByText(words).count()) > 0, 3000)) ? p.getByText(words).first().evaluate((e) => e.parentElement.parentElement.innerText) : ''
  await goTo('G1')
  const alert = await alertText(/divides by zero/)
  await shot(p, `${tag}studio-sheets-error`)
  await goTo('G2')
  const alert2 = await alertText(/a name Studio doesn't know/)
  await goTo('J20')
  ok(/What went wrong/.test(alert) && /#DIV\/0!: it divides by zero, or by an empty cell/.test(alert), 'a formula\'s #DIV/0!, picked, says what went wrong in plain words', alert)
  ok(/#NAME\?: it uses a name Studio doesn't know/.test(alert2), 'and #NAME? that it uses a name Studio doesn\'t know', alert2)

  // ---------- Insert › Chart ----------
  await goTo('A1:B6')
  await p.locator('.sd-univer [role="tab"]', { hasText: 'Insert' }).first().click()
  await p.locator('.sd-univer [data-u-command="bridge.sheet.insert-chart"]').first().click()
  ok(!!(await until(async () => (await p.locator('.sh-charts .sh-fig svg').count()) === 1, 5000)), 'Insert › Chart: the cells picked, drawn beside the sheet at once')
  await p.locator('.sh-fig-tools select').selectOption('pie')
  await p.locator('.sh-fig-tools input').fill('Costs')
  ok(!!(await until(async () => (await p.locator('.sh-charts .sh-fig .sc-slice').count()) === 5 && /Costs/.test(await p.locator('.sh-charts figcaption').innerText()), 3000)), 'its kind (a pie) and title changed there')
  await shot(p, `${tag}studio-sheets-chart`)
  await p.locator('.sd-univer [role="tab"]', { hasText: 'Start' }).first().click()
  // A sheet added with + by the tabs: the status line counts it.
  await p.locator('.sd-univer [data-u-comp="sheet-bar-append-button"]').first().click()
  ok(!!(await until(async () => /3 sheets/.test(await p.locator('.sd-status').innerText()), 5000)), 'a sheet added: the status line counts 3 sheets', await p.locator('.sd-status').innerText())
  ok(await save(), 'saved', unsaved)
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(path.join(dir, 'budget.xlsx'))
  const s = back.getWorksheet('Budget')
  const cell = (a) => ({ v: s.getCell(a).value, fmt: s.getCell(a).numFmt, color: s.getCell(a).font?.color })
  const got = { B3: cell('B3'), B4: cell('B4'), B5: cell('B5'), B6: cell('B6'), E2: cell('E2'), D9: cell('D9'), A3: cell('A3'), A9: cell('A9') }
  ok(/\$/.test(got.B3.fmt || '') && /%/.test(got.B4.fmt || '') && got.B5.fmt === '#,##0.00' && !/\$/.test(got.B6.fmt || ''), 'Ctrl+Shift+4, 5 and 1: currency, percent and number, and ⌘\\ clears the formatting', got)
  // Today where the sheet is (the local date), as Excel keeps a date: midnight UTC of that day.
  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset())
  ok(got.E2.v instanceof Date && today.toISOString().slice(0, 10) === got.E2.v.toISOString().slice(0, 10), '⌘; puts in today\'s date, as a date', got.E2)
  if (which === 'chromium') ok(got.D9.v === 1975 && !pasteSaid, '⇧⌘V pastes the values only: the total\'s 1975, not its formula', { D9: got.D9, pasteSaid })
  else ok(got.D9.v == null && /Couldn't paste the values: .+ Paste with (⌘V|Ctrl\+V), then pick Values only/.test(pasteSaid), '⇧⌘V where the page can\'t read what was copied: it says so, and how else', pasteSaid)
  ok(got.A3.v === 'Design work' && !got.A3.color && got.A9.v === 'New line' && !got.A9.color, 'what\'s typed is plain text in no colour of its own (Univer gave it its theme\'s ink, kept in the file)', { A3: got.A3, A9: got.A9 })
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'budget.xlsx')))
  const chartPart = Object.keys(zip.files).find((n) => /^xl\/charts\/chart\d*\.xml$/.test(n))
  const chartXml = chartPart ? await zip.file(chartPart).async('string') : ''
  ok(/<c:pieChart>/.test(chartXml) && /<a:t>Costs<\/a:t>/.test(chartXml) && /Budget!\$B\$2:\$B\$6/.test(chartXml) && back.worksheets.length === 3, 'saved as Excel\'s own pie chart of B2:B6, titled Costs, with the sheet added', { chartPart, xml: chartXml.slice(0, 300), sheets: back.worksheets.map((x) => x.name) })

  // ---------- AI Assist ----------
  // Answered by AI Assist's model in seconds, not by an agent: its change outlined on the sheet as
  // a suggestion, kept or discarded, one or all at once. With no model it says how to add one.
  await open('costs.xlsx')
  const askAi = p.locator('.sh-ask')
  // A verb from AI Assist's menu: its panel, with the ask started (once the panel has put it in).
  const assist = async (verb) => {
    await p.locator('.pane-head button[aria-label="AI Assist"]').click()
    await p.locator('.ai-menu button', { hasText: verb }).click()
    await askAi.waitFor({ timeout: 5000 })
    await until(async () => (await askAi.locator('textarea').inputValue()).startsWith(verb), 3000, 50)
  }
  const costCell = async (a1) => { const x = new ExcelJS.Workbook(); await x.xlsx.readFile(path.join(dir, 'costs.xlsx')); return x.getWorksheet('Costs').getCell(a1).value }
  await goTo('A1:C6')
  await assist('Write a formula')
  const noModel = await until(async () => /No model to answer with yet: sign in to an agent \(Claude Code, Codex…\) or add a key in Settings › Model Providers/.test(await askAi.innerText()), 8000)
  ok(!!noModel && await askAi.locator('.sh-send').isDisabled() && (await askAi.locator('.sh-goes button', { hasText: 'Model Providers' }).count()) === 1 && (await askAi.locator('.sh-hand-toggle', { hasText: 'Hand to an agent' }).count()) === 1, 'with no model, AI Assist on a sheet says how to add one, with Model Providers a click away, and Hand to an agent still there', await askAi.innerText())
  await shot(p, `${tag}studio-sheets-ai-no-model`)
  await askAi.locator('button[aria-label="Close AI Assist"]').click()
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await assist('Write a formula')
  ok(!!(await until(async () => /go to gpt-5 \(OpenAI\)\. Nothing else leaves this computer/.test(await askAi.innerText()) && await askAi.locator('.sh-model-one, .sh-model').count() === 1, 8000)), 'a model added: the panel says which answers, and where the cells go', await askAi.innerText())
  await askAi.locator('textarea').press('End')
  await askAi.locator('textarea').pressSequentially('doubles the cost in a new column')
  const asked0 = Date.now()
  await askAi.locator('.sh-send').click()
  const card = askAi.locator('.sh-suggestion')
  const formula = await until(async () => /Doubled each cost in column D/.test(await card.first().innerText().catch(() => '')) && /6 cells, outlined on the sheet/.test(await card.first().innerText()), 15000, 100)
  const took = Date.now() - asked0
  ok(!!formula && took < 10000 && /Suggested by gpt-5/.test(await card.first().innerText()), `Write a formula: AI Assist's model answers in seconds (${took} ms), its change a suggestion outlined on the sheet, by the model named`, await askAi.innerText())
  const sent = model.asked(/^In the spreadsheet costs\.xlsx/).at(-1) || ''
  ok(/on the sheet "Costs": Write a formula for the cells I picked that doubles the cost in a new column/.test(sent) && /A1:C6 on Costs/.test(sent) && /hosting/.test(sent) && /"cells"/.test(sent), 'the model is sent what was asked, the cells picked with their values, and the change\'s shape', sent.slice(0, 600))
  ok(/Unsaved changes/.test(await p.locator('.sd-status').innerText()) && (await costCell('D2')) == null, 'and the file isn\'t changed until it\'s kept and saved', await p.locator('.sd-status').innerText())
  await card.first().locator('button', { hasText: 'Discard' }).click()
  ok(!!(await until(async () => !(await card.count()), 3000)), 'Discard takes the suggestion off the sheet')
  ok(await save(), 'saved', unsaved)
  ok((await costCell('D2')) == null && (await costCell('D1')) == null, 'discarded: nothing of it is in the file', [await costCell('D1'), await costCell('D2')])
  // Two at once: Keep all keeps both.
  await assist('Write a formula')
  await askAi.locator('textarea').press('End')
  await askAi.locator('textarea').pressSequentially('doubles the cost in a new column')
  await askAi.locator('.sh-send').click()
  await until(async () => (await card.count()) === 1, 15000, 100)
  await goTo('A1:A6')
  await askAi.locator('.sh-chip', { hasText: 'Clean this column' }).click()
  await askAi.locator('.sh-send').click()
  const two = await until(async () => (await card.count()) === 2 && /Trimmed and capitalised 3 names/.test(await askAi.innerText()), 15000, 100)
  ok(!!two && /2 suggestions, outlined on the sheet/.test(await askAi.locator('.sh-all').innerText().catch(() => '')) && (await askAi.locator('.sh-all button', { hasText: 'Keep all' }).count()) === 1, 'Clean this column while the formula waits: two suggestions, each with Keep and Discard, and Keep all for both', await askAi.innerText())
  await shot(p, `${tag}studio-sheets-ai-suggestions`)
  await askAi.locator('.sh-all button', { hasText: 'Keep all' }).click()
  ok(!!(await until(async () => !(await card.count()) && /Kept\. Save to write it to the file/.test(await askAi.innerText()), 3000)), 'Keep all keeps both, and says to save')
  ok(await save(), 'saved', unsaved)
  const c2 = await costCell('D2'), a2 = await costCell('A2'), a3 = await costCell('A3'), a4 = await costCell('A4')
  ok(c2?.formula === 'B2*2' && c2.result === 240 && a2 === 'Hosting' && a3 === 'Design' && a4 === 'Fonts', 'kept and saved: the formulas in the file with their results, and the names cleaned up', { c2, a2, a3, a4 })
  // Summarise: an answer, said beside the sheet; nothing to keep.
  await goTo('B2:B6')
  await askAi.locator('.sh-chip', { hasText: 'Summarise' }).click()
  await askAi.locator('.sh-send').click()
  ok(!!(await until(async () => /5 numbers come to 1975; the highest is 900/.test(await askAi.locator('.sh-answer-card').innerText().catch(() => '')) && (await askAi.locator('.sh-answer-card button', { hasText: 'Copy' }).count()) === 1, 15000, 100)), 'Summarise: the answer beside the sheet, to copy, with nothing to keep', await askAi.innerText())
  await askAi.locator('.sh-answer-card button', { hasText: 'Done' }).click()
  // Chart this: drawn from the cells before it's added.
  await goTo('A1:B4')
  await askAi.locator('.sh-chip', { hasText: 'Chart this' }).click()
  await askAi.locator('.sh-send').click()
  ok(!!(await until(async () => (await card.locator('svg .sc-bar').count()) === 3, 15000, 100)), 'Chart this: the chart drawn from the cells, before it\'s added', await askAi.innerText())
  await card.first().locator('button', { hasText: 'Keep' }).click()
  ok(!!(await until(async () => /Kept, with its chart \(in Charts\)/.test(await askAi.innerText()), 3000)), 'kept: it goes in Charts')
  // An answer that isn't a change, and nothing found to change: each said, nothing put on the sheet.
  await askAi.locator('textarea').fill('This is not a change')
  await askAi.locator('.sh-send').click()
  ok(!!(await until(async () => /The model's answer wasn't a change Studio can show/.test(await askAi.locator('.sh-wait.bad').innerText().catch(() => '')), 15000, 100)) && !(await card.count()), 'a model\'s answer that isn\'t a change: said so, and nothing is put on the sheet', await askAi.innerText())
  await askAi.locator('.sh-wait.bad button', { hasText: 'OK' }).click()
  await goTo('A1:A6')
  await askAi.locator('.sh-chip', { hasText: 'Clean this column' }).click()
  await askAi.locator('.sh-send').click()
  ok(!!(await until(async () => /found nothing to change there/.test(await askAi.locator('.sh-wait.bad').innerText().catch(() => '')), 15000, 100)), 'a column already clean: the model found nothing to change, said so', await askAi.innerText())
  await askAi.locator('.sh-wait.bad button', { hasText: 'OK' }).click()
  // Hand to an agent stays, for a bigger job.
  await askAi.locator('.sh-hand-toggle').click()
  ok(await askAi.locator('.sh-to select').isVisible() && (await askAi.locator('.sh-to option').allInnerTexts()).includes('A new agent in this folder') && (await askAi.locator('.sh-hand-send', { hasText: 'Send to the agent' }).count()) === 1, 'Hand to an agent, for a bigger job: an agent there or a new one', await askAi.locator('.sh-hand').innerText())
  await askAi.locator('.sh-hand-toggle').click()
  await askAi.locator('button[aria-label="Close AI Assist"]').click()
  ok(await save(), 'saved', unsaved)
  ok(w.errors.length === 0, 'no page errors', w.errors)

  // ---------- Make a sheet ----------
  // With Make a Sheet on (a beta feature, off to start): an empty Excel sheet made from what it's for, by AI Assist's model
  // on the sheet's fast path, from New › Sheet or the empty sheet itself; shown on the sheet
  // before it's kept (Discard empties it again), then saved as an Excel file with its sheets,
  // formulas, formats, dropdowns and frozen headings. With the beta off, the empty sheet as before.
  const offBook = await kit.api('/studio/sheet/ai', { root, path: 'costs.xlsx', mode: 'book', instruction: 'A budget' }).catch((e) => e)
  ok(offBook?.status === 404 && offBook.j?.trial === 'make-sheet' && /^Make a Sheet is a beta feature/.test(offBook.message), 'with Make a Sheet off (as it starts), its route isn\'t there', offBook?.message)
  const studioHome = () => until(async () => { await p.locator('.rail-nav-btn', { hasText: 'Studio' }).click(); return p.locator('.sd-home').waitFor({ timeout: 1500 }).then(() => true, () => false) }, 20000, 300)
  const newSheet = async (name, forWhat) => {
    await studioHome()
    await p.locator('.sd-new-open').click()
    await p.locator('.sd-new-menu [role="menuitem"]', { hasText: 'Sheet' }).first().click()
    await p.locator('.sd-new-form input').first().fill(name)
    if (forWhat != null) await p.locator('.sd-new-for input').fill(forWhat)
    await p.locator('.sd-new-form select').selectOption(root)
    await p.locator('.sd-new-form button', { hasText: 'Make it' }).click()
  }
  await studioHome()
  await p.locator('.sd-new-open').click()
  await p.locator('.sd-new-menu [role="menuitem"]', { hasText: 'Sheet' }).first().click()
  ok((await p.locator('.sd-new-for').count()) === 0, 'and New › Sheet asks only its name and folder, as before')
  await p.locator('.sd-new-form button', { hasText: 'Cancel' }).click()
  await kit.api('/settings', { trials: { 'make-sheet': true } }, 'PATCH')
  const booksAsked = model.asked(/^Make a spreadsheet: /).length
  await newSheet('Team budget', 'A budget for a team of five')
  const made = p.locator('.sh-make')
  ok(!!(await until(async () => /Suggested by gpt-5, not kept yet/.test(await made.locator('.sh-made').innerText().catch(() => '')), 30000, 200)), 'New › Sheet, said what it\'s for: AI Assist makes it as it opens, shown as a suggestion, by the model named', await made.innerText().catch(() => ''))
  const madeText = await made.locator('.sh-made').innerText()
  const tabsOf = () => p.locator('.sd-univer [data-u-comp="slide-tab-item"], .sd-univer .univer-sheet-bar [data-id]').allInnerTexts().catch(() => [])
  ok(/A monthly and yearly budget for a team of five/.test(madeText) && /2 sheets, \d+ cells, outlined/.test(madeText) && model.asked(/^Make a spreadsheet: A budget for a team of five\n/).length === booksAsked + 1, 'its two sheets and their cells, outlined on the sheet, with what it is; the model asked once, with what it\'s for', { madeText, tabs: await tabsOf() })
  ok((await made.locator('.sh-made button', { hasText: 'Keep' }).count()) === 1 && (await made.locator('.sh-made button', { hasText: 'Discard' }).count()) === 1 && /Unsaved changes/.test(await p.locator('.sd-status').innerText()), 'with Keep and Discard; nothing written to the file yet')
  await shot(p, `${tag}studio-sheets-make`)
  const budgetFile = path.join(dir, 'Team budget.xlsx')
  const booked = async () => { const x = new ExcelJS.Workbook(); await x.xlsx.readFile(budgetFile); return x }
  await made.locator('.sh-made button', { hasText: 'Discard' }).click()
  ok(!!(await until(async () => (await made.locator('.sh-made').count()) === 0 && /1 sheet\b/.test(await p.locator('.sd-status').innerText()), 5000, 100)), 'Discard: the sheet empty again, one sheet as it was', await p.locator('.sd-status').innerText())
  await made.locator('button[aria-label="Close AI Assist"]').click()
  ok(!!(await until(() => p.locator('.sh-start .sh-make-open').isVisible(), 5000, 100)), 'and the empty sheet offers Make a sheet')
  // From the empty sheet: Make a sheet, then Keep and save.
  await p.locator('.sh-start .sh-make-open').click()
  await made.locator('textarea').fill('A budget for a team of five')
  await made.locator('.sh-send').click()
  ok(!!(await until(async () => (await made.locator('.sh-made').count()) === 1, 30000, 200)), 'Make a sheet from the empty sheet: the same, shown first')
  await made.locator('.sh-made button', { hasText: 'Keep' }).click()
  ok(!!(await until(async () => /Kept\. Save to write it to the file/.test(await made.innerText()), 3000, 100)), 'Keep: kept, and it says to save')
  ok(await save(), 'saved', unsaved)
  const bk = await booked()
  const bs = bk.getWorksheet('Budget'), ts = bk.getWorksheet('Team')
  const dv = bs?.getCell('D2').dataValidation
  ok(!!bs && !!ts && bk.worksheets.length === 2 && bs.getCell('B2').value?.formula === 'SUM(Team!C2:C6)' && bs.getCell('C3').value?.formula === 'B3*12' && bs.getCell('B6').value?.formula === 'SUM(B2:B5)', 'saved as an Excel file: its two sheets, the totals and yearly figures as formulas, salaries summed from the Team sheet', { sheets: bk.worksheets.map((x) => x.name), B2: bs?.getCell('B2').value, C3: bs?.getCell('C3').value })
  ok(/\$#,##0/.test(bs?.getCell('B3').numFmt || '') && bs?.getCell('A1').font?.bold && dv?.type === 'list' && /Approved,Pending/.test((dv.formulae || []).join()) && bs?.views?.[0]?.state === 'frozen' && bs.views[0].ySplit === 1 && ts.getCell('C2').value === 9000, 'with its money format, bold headings, a Status dropdown and the heading row frozen', { fmt: bs?.getCell('B3').numFmt, bold: bs?.getCell('A1').font, dv, views: bs?.views })
  // No model: said, with Model Providers.
  await kit.api('/providers/openai', {}, 'DELETE')
  await newSheet('Reading log', null)
  ok(!!(await until(() => p.locator('.sh-start .sh-make-open').isVisible(), 20000, 200)), 'a new sheet said nothing about: empty, offering Make a sheet')
  await p.locator('.sh-start .sh-make-open').click()
  ok(!!(await until(async () => /No model to answer with yet/.test(await made.innerText().catch(() => '')) && await made.locator('.sh-send').isDisabled() && (await made.locator('.sh-goes button', { hasText: 'Model Providers' }).count()) === 1, 8000, 200)), 'with no model, Make a sheet says how to add one', await made.innerText().catch(() => ''))
  await made.locator('button[aria-label="Close AI Assist"]').click()
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  ok(w.errors.length === 0, 'no page errors', w.errors)

  // ---------- Dark ----------
  const night = await page(b, kit.url, { width: 1440, height: 900, mode: 'dark' })
  pages.push(night)
  await night.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await until(async () => { if (!(await night.p.locator('.sd-univer').count())) await night.p.evaluate(({ root }) => window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root, path: 'budget.xlsx' } })), { root }); return (await night.p.locator('.sd-univer canvas').count()) > 0 }, 30000, 1000)
  await sleep(1200)
  await night.p.locator('.sd-univer [role="tab"]', { hasText: 'Insert' }).first().click()
  await night.p.locator('.sd-univer [data-u-command="bridge.sheet.charts"]').first().click()
  await night.p.locator('.sh-charts').waitFor({ timeout: 5000 })
  // Its five costs, $900.00 and 4500% among them, each a slice: the numbers, not as they show.
  ok((await night.p.locator('.sh-charts .sh-fig svg').count()) === 1 && (await night.p.locator('.sh-charts .sc-slice').count()) === 5, 'dark: the chart saved in the file, in Charts, a slice for each of its five costs however they\'re formatted', await night.p.locator('.sh-charts').innerText())
  await shot(night.p, `${tag}studio-sheets-dark`)
  // AI Assist's suggestion, dark.
  await night.p.locator('.pane-head button[aria-label="AI Assist"]').click()
  await night.p.locator('.ai-menu button', { hasText: 'Write a formula' }).click()
  const nightAsk = night.p.locator('.sh-ask')
  await until(async () => (await nightAsk.locator('textarea').inputValue().catch(() => '')).startsWith('Write a formula'), 5000, 50)
  await nightAsk.locator('textarea').press('End')
  await nightAsk.locator('textarea').pressSequentially('doubles the cost in a new column')
  await nightAsk.locator('.sh-send').click()
  ok(!!(await until(async () => (await nightAsk.locator('.sh-suggestion').count()) === 1, 15000, 100)), 'dark: AI Assist\'s suggestion beside the sheet', await nightAsk.innerText().catch(() => ''))
  await shot(night.p, `${tag}studio-sheets-ai-dark`)
  await nightAsk.locator('.sh-suggestion button', { hasText: 'Discard' }).click()
  ok(night.errors.length === 0, 'dark: no page errors', night.errors)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
