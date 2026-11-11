// Studio's Excel engine (src/components/studio/xlsxbook.js), in Node, on a workbook made here with
// a bit of everything: sheets hidden and coloured, strings plain and rich, numbers, dates, true and
// false, errors, formulas (shared ones, one from another sheet), fonts in the theme's colours,
// fills, borders, alignment, number formats, merges, sizes, hidden rows and columns, frozen panes,
// conditional formats, validation, a filter, links out and in, a note, names, a picture, a chart,
// and parts this code knows nothing about. Read: shown as Excel shows it. Saved with nothing
// changed: every part exactly as it was. One cell changed: only that cell. A style changed: a new
// format, derived. Reopened (here and by ExcelJS): the same but for the edit. Rows and columns added,
// removed and moved: what points at them moves too. Sheets added, renamed, moved and deleted. A
// new workbook. Threaded comments as Excel 365 writes them (lib/sheetfile.mjs): kept as they are
// unless asked for, then read as threads and written back as Excel writes them (a new thread and
// reply shaped as its own, the persons, each thread's placeholder note), moving with their rows.
// And quick on a big one.
import path from 'node:path'
import { createRequire } from 'node:module'
import { checks, ROOT } from '../lib/harness.mjs'
import { readBook, writeBook, newBook, wellFormed } from '../../src/components/studio/xlsxbook.js'
import { threadsXlsx, SHEET_THREADS, PEOPLE } from '../lib/sheetfile.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const ExcelJS = require('exceljs')
const JSZip = require('jszip')
const { ok, done } = checks('studio-xlsx')
const clone = (x) => JSON.parse(JSON.stringify(x))
const entries = async (bytes) => { const z = await JSZip.loadAsync(bytes); const out = {}; for (const f of Object.values(z.files)) if (!f.dir) out[f.name] = Buffer.from(await f.async('uint8array')); return out }
const diffParts = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !a[k] || !b[k] || !a[k].equals(b[k])).sort()
const cellsOf = (xml) => [...xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map((m) => [m[1], m[0]])
const res = (data, name) => JSON.parse(data.resources.find((r) => r.name === name)?.data || '{}')
const setRes = (data, name, v) => { data.resources.find((r) => r.name === name).data = JSON.stringify(v) }
const sheetId = (data, name) => data.sheetOrder.find((id) => data.sheets[id].name === name)
const xmlOf = async (bytes, part) => (await JSZip.loadAsync(bytes)).file(part)?.async('string')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// ---------- The workbook ----------
async function fixture() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Budget', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] })
  ws.columns = [{ width: 20 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 10, hidden: true }]
  ws.addRow(['Item', 'Cost', 'Due', 'Double', 'Ok'])
  const items = [['Hosting', 120], ['Design', 900], ['Fonts', 45], ['Legal', 610], ['Travel', 300]]
  items.forEach(([n, c], i) => ws.addRow([n, c, new Date(Date.UTC(2026, 0, 10 + i)), null, null]))
  ws.getCell('D2').value = { formula: 'B2*2', result: 240, shareType: 'shared', ref: 'D2:D6' }
  for (let r = 3; r <= 6; r++) ws.getCell(`D${r}`).value = { sharedFormula: 'D2', result: items[r - 2][1] * 2 }
  ws.getCell('B7').value = { formula: 'SUM(B2:B6)', result: 1975 }
  ws.getCell('A7').value = 'Total'
  ws.getCell('E2').value = true
  ws.getCell('E3').value = { error: '#N/A' }
  ws.getCell('A8').value = { richText: [{ text: 'Plain ' }, { font: { bold: true, color: { argb: 'FFC00000' } }, text: 'red bold' }] }
  ws.getCell('A9').value = 'Merged note'
  ws.mergeCells('A9:C9')
  for (let c = 1; c <= 5; c++) {
    const h = ws.getCell(1, c)
    h.font = { bold: true, color: { theme: 0 } }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { theme: 4, tint: -0.25 } }
    h.border = { bottom: { style: 'medium', color: { argb: 'FF1F3864' } } }
    h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  }
  for (let r = 2; r <= 6; r++) { ws.getCell(`C${r}`).numFmt = 'yyyy-mm-dd'; ws.getCell(`B${r}`).numFmt = '#,##0.00' }
  ws.getRow(1).height = 30
  ws.getRow(10).hidden = true
  ws.getCell('A10').value = 'Hidden row'
  ws.addConditionalFormatting({ ref: 'B2:B6', rules: [
    { type: 'cellIs', operator: 'greaterThan', formulae: [500], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } }, font: { color: { argb: 'FF9C0006' } } } },
    { type: 'colorScale', priority: 2, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFF8696B' }, { argb: 'FF63BE7B' }] },
    { type: 'top10', priority: 3, rank: 2, style: { font: { bold: true } } },
  ] })
  ws.addConditionalFormatting({ ref: 'A2:A6', rules: [{ type: 'containsText', operator: 'containsText', text: 'Host', priority: 4, style: { font: { italic: true } } }, { type: 'expression', formulae: ['$B2>500'], priority: 5, style: { font: { underline: true } } }] })
  ws.getCell('E4').dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No,Maybe"'], showErrorMessage: true }
  ws.getCell('E5').dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [1, 10], showErrorMessage: true, error: 'One to ten' }
  ws.autoFilter = 'A1:D6'
  ws.getCell('A11').value = { text: 'Our site', hyperlink: 'https://example.com/plan' }
  ws.getCell('A12').value = { text: 'To the plan', hyperlink: "#'Plan Two'!A1" }
  ws.getCell('A2').note = 'Check the renewal'
  const img = wb.addImage({ buffer: PNG, extension: 'png' })
  ws.addImage(img, { tl: { col: 7, row: 1 }, ext: { width: 40, height: 40 } })
  const p2 = wb.addWorksheet('Plan Two', { properties: { tabColor: { argb: 'FF00B050' } } })
  p2.getCell('A1').value = 'Twice the total'
  p2.getCell('B1').value = { formula: 'Budget!B7*2', result: 3950 }
  p2.getCell('A2').value = 'Spare'
  p2.getCell('A3').value = { text: 'Back to the budget', hyperlink: '#Budget!A1' }
  const hid = wb.addWorksheet('Archive', { state: 'hidden' })
  hid.getCell('A1').value = 'old'
  wb.definedNames.add("'Budget'!$B$2:$B$6", 'Costs')
  const buf = await wb.xlsx.writeBuffer()
  // What ExcelJS can't make: a chart beside the picture, a part nothing points at, macros' bytes,
  // and x14 extensions in the sheet.
  const z = await JSZip.loadAsync(buf)
  const sheetPath = 'xl/worksheets/sheet1.xml'
  const drawing = Object.keys(z.files).find((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n))
  const drels = drawing.replace('drawings/', 'drawings/_rels/') + '.rels'
  let dx = await z.file(drawing).async('string')
  dx = dx.replace(/<\/xdr:wsDr>/, '<xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>18</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="9" name="Costs chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>')
  if (!/xmlns:a=/.test(dx)) dx = dx.replace('<xdr:wsDr ', '<xdr:wsDr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ')
  z.file(drawing, dx)
  z.file(drels, (await z.file(drels).async('string')).replace('</Relationships>', '<Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>'))
  z.file('xl/charts/chart1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Costs</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Budget!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Cost</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Budget!$A$2:$A$6</c:f><c:strCache><c:ptCount val="5"/><c:pt idx="0"><c:v>Hosting</c:v></c:pt><c:pt idx="1"><c:v>Design</c:v></c:pt><c:pt idx="2"><c:v>Fonts</c:v></c:pt><c:pt idx="3"><c:v>Legal</c:v></c:pt><c:pt idx="4"><c:v>Travel</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Budget!$B$2:$B$6</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="5"/><c:pt idx="0"><c:v>120</c:v></c:pt><c:pt idx="1"><c:v>900</c:v></c:pt><c:pt idx="2"><c:v>45</c:v></c:pt><c:pt idx="3"><c:v>610</c:v></c:pt><c:pt idx="4"><c:v>300</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>')
  let ct = await z.file('[Content_Types].xml').async('string')
  ct = ct.replace('</Types>', '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/custom/thing.xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>')
  z.file('[Content_Types].xml', ct)
  z.file('xl/custom/thing.xml', '<?xml version="1.0"?><thing xmlns="urn:invented:thing"><kept>yes</kept></thing>')
  z.file('xl/vbaProject.bin', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4, 5]))
  let sx = await z.file(sheetPath).async('string')
  sx = sx.replace('</worksheet>', '<extLst><ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:sparklineGroup><x14:colorSeries rgb="FF376092"/><x14:sparklines><x14:sparkline><xm:f>Budget!B2:B6</xm:f><xm:sqref>F12</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup></x14:sparklineGroups></ext></extLst></worksheet>')
  z.file(sheetPath, sx)
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// Rows added the way Univer does it in its own workbook: cells, sizes, merges and rules move down,
// and formulas that point past them follow.
function shiftRefs(f, sheet, here, at, n) {
  return f.replace(/((?:'[^']+'|[A-Za-z][\w ]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, sh, d1, col, d2, row) => {
    const target = sh ? sh.replace(/!$/, '').replace(/^'|'$/g, '') : here
    if (target !== sheet) return m
    const r = Number(row) - 1
    return `${sh || ''}${d1}${col}${d2}${r >= at ? r + n + 1 : r + 1}`
  })
}
function univerInsertRows(data, id, at, n) {
  const sh = data.sheets[id]
  const name = sh.name
  const move = (obj) => { const out = {}; for (const [k, v] of Object.entries(obj || {})) out[Number(k) >= at ? Number(k) + n : k] = v; return out }
  sh.cellData = move(sh.cellData)
  sh.rowData = move(sh.rowData)
  const mr = (g) => ({ ...g, startRow: g.startRow >= at ? g.startRow + n : g.startRow, endRow: g.endRow >= at ? g.endRow + n : g.endRow })
  sh.mergeData = sh.mergeData.map(mr)
  for (const s of Object.values(data.sheets)) for (const row of Object.values(s.cellData)) for (const cell of Object.values(row)) if (cell?.f) cell.f = shiftRefs(cell.f, name, s.name, at, n)
  for (const r of ['SHEET_CONDITIONAL_FORMATTING_PLUGIN', 'SHEET_DATA_VALIDATION_PLUGIN']) { const v = res(data, r); for (const rule of v[id] || []) { rule.ranges = rule.ranges.map(mr); if (rule.rule?.value && typeof rule.rule.value === 'string') rule.rule.value = shiftRefs(rule.rule.value, name, name, at, n) } setRes(data, r, v) }
  const f = res(data, 'SHEET_FILTER_PLUGIN'); if (f[id]) f[id].ref = mr(f[id].ref); setRes(data, 'SHEET_FILTER_PLUGIN', f)
  const notes = res(data, 'SHEET_NOTE_PLUGIN'); if (notes[id]) { const m = {}; for (const [r, cols] of Object.entries(notes[id])) { const nr = Number(r) >= at ? Number(r) + n : Number(r); m[nr] = Object.fromEntries(Object.entries(cols).map(([c, x]) => [c, { ...x, row: nr }])) } notes[id] = m } setRes(data, 'SHEET_NOTE_PLUGIN', notes)
}
function univerRemoveRows(data, id, at, n) {
  const sh = data.sheets[id]
  const move = (obj) => { const out = {}; for (const [k, v] of Object.entries(obj || {})) { const r = Number(k); if (r < at) out[r] = v; else if (r >= at + n) out[r - n] = v } return out }
  sh.cellData = move(sh.cellData)
  sh.rowData = move(sh.rowData)
  const mr = (g) => ({ ...g, startRow: g.startRow >= at + n ? g.startRow - n : g.startRow, endRow: g.endRow >= at + n ? g.endRow - n : g.endRow })
  sh.mergeData = sh.mergeData.filter((g) => g.startRow >= at + n || g.endRow < at).map(mr)
  for (const r of ['SHEET_CONDITIONAL_FORMATTING_PLUGIN', 'SHEET_DATA_VALIDATION_PLUGIN']) { const v = res(data, r); for (const rule of v[id] || []) rule.ranges = rule.ranges.map(mr); setRes(data, r, v) }
  const f = res(data, 'SHEET_FILTER_PLUGIN'); if (f[id]) f[id].ref = mr(f[id].ref); setRes(data, 'SHEET_FILTER_PLUGIN', f)
}

try {
  const orig = await fixture()
  const before = await entries(orig)
  const t0 = Date.now()
  const book = await readBook(orig, 'budget.xlsx')
  const { data, lost, keep, charts } = book
  ok(Date.now() - t0 < 3000, `read in ${Date.now() - t0} ms`)
  // ---------- Read: as Excel shows it ----------
  ok(data.sheetOrder.map((id) => data.sheets[id].name).join() === 'Budget,Plan Two,Archive', 'every sheet, in order', data.sheetOrder.map((id) => data.sheets[id].name))
  const B = data.sheets[sheetId(data, 'Budget')], P2 = data.sheets[sheetId(data, 'Plan Two')], AR = data.sheets[sheetId(data, 'Archive')]
  ok(AR.hidden === 1 && P2.hidden === 0 && P2.tabColor === '#00b050', 'a hidden sheet is hidden; a tab keeps its colour', { ar: AR.hidden, tab: P2.tabColor })
  const st = (cell) => (typeof cell?.s === 'string' ? data.styles[cell.s] : cell?.s) || {}
  const h = st(B.cellData[0][0])
  ok(B.cellData[0][0].v === 'Item' && h.bl === 1 && h.cl?.rgb === '#ffffff' && /^#[0-9a-f]{6}$/.test(h.bg?.rgb || '') && h.bg.rgb !== '#4472c4' && h.bd?.b?.s === 8 && h.bd.b.cl.rgb === '#1f3864' && h.ht === 2 && h.vt === 2 && h.tb === 3, "a header: bold, the theme's light text, its accent darkened by its tint, a medium border, centred and wrapped", h)
  ok(B.cellData[1][1].v === 120 && st(B.cellData[1][1]).n?.pattern === '#,##0.00' && st(B.cellData[1][2]).n?.pattern === 'yyyy-mm-dd' && Math.round(B.cellData[1][2].v) === 46032, 'numbers and dates, with their formats', [B.cellData[1][1], B.cellData[1][2]])
  ok(B.cellData[1][3].f === '=B2*2' && B.cellData[3][3].f === '=B4*2' && B.cellData[5][3].f === '=B6*2' && B.cellData[3][3].v === 90, "a shared formula's cells each read their own formula, with Excel's last result", [B.cellData[1][3], B.cellData[3][3], B.cellData[5][3]])
  ok(B.cellData[6][1].f === '=SUM(B2:B6)' && P2.cellData[0][1].f === '=Budget!B7*2', 'formulas, one from another sheet', P2.cellData[0][1])
  ok(B.cellData[1][4].t === 3 && B.cellData[1][4].v === 1 && B.cellData[2][4].v === '#N/A', 'true and an error', [B.cellData[1][4], B.cellData[2][4]])
  const rich = B.cellData[7][0]
  ok(rich.v === 'Plain red bold' && rich.p?.body?.dataStream === 'Plain red bold\r\n' && rich.p.body.textRuns.some((r) => r.st === 6 && r.ed === 14 && r.ts.bl === 1 && r.ts.cl?.rgb === '#c00000'), 'rich text, with its bold red run', rich.p?.body)
  ok(B.mergeData.some((g) => g.startRow === 8 && g.endRow === 8 && g.startColumn === 0 && g.endColumn === 2), 'a merge', B.mergeData)
  ok(B.columnData[0]?.w === 140 && B.columnData[5]?.hd === 1 && B.rowData[0]?.h === 40 && B.rowData[9]?.hd === 1, 'column widths in pixels, row heights, hidden rows and columns', { c0: B.columnData[0], c5: B.columnData[5], r0: B.rowData[0], r9: B.rowData[9] })
  ok(B.freeze.xSplit === 1 && B.freeze.ySplit === 1 && B.freeze.startRow === 1 && B.freeze.startColumn === 1, 'frozen first row and column', B.freeze)
  const cf = res(data, 'SHEET_CONDITIONAL_FORMATTING_PLUGIN')[sheetId(data, 'Budget')] || []
  const kinds = cf.map((r) => (r.rule.type === 'highlightCell' ? `${r.rule.subType}${r.rule.operator ? `:${r.rule.operator}` : ''}` : r.rule.type))
  ok(kinds.join() === 'number:greaterThan,colorScale,rank,text:containsText,formula' && cf[0].rule.value === 500 && cf[0].rule.style.bg?.rgb === '#ffc7ce' && cf[0].rule.style.cl?.rgb === '#9c0006' && cf[4].rule.value === '=$B2>500' && cf[1].rule.config.length === 2, 'conditional formats as Univer keeps them: a number rule with its colours, a colour scale, a top 2, text, a formula', kinds)
  const dv = res(data, 'SHEET_DATA_VALIDATION_PLUGIN')[sheetId(data, 'Budget')] || []
  ok(dv.length === 2 && dv[0].type === 'list' && dv[0].formula1 === 'Yes,No,Maybe' && dv[1].type === 'whole' && dv[1].formula1 === '1' && dv[1].formula2 === '10' && dv[1].error === 'One to ten', 'validation: a list and whole numbers', dv)
  const flt = res(data, 'SHEET_FILTER_PLUGIN')[sheetId(data, 'Budget')]
  ok(flt?.ref?.startRow === 0 && flt.ref.endRow === 5 && flt.ref.endColumn === 3, 'the filter', flt)
  const urlAt = (cell) => cell?.p?.body?.customRanges?.find((r) => r.rangeType === 0)?.properties?.url
  ok(urlAt(B.cellData[10][0]) === 'https://example.com/plan' && urlAt(B.cellData[11][0]) === `#gid=${sheetId(data, 'Plan Two')}&range=A1` && B.cellData[10][0].v === 'Our site', 'links: one out, one to a place in the workbook', [urlAt(B.cellData[10][0]), urlAt(B.cellData[11][0])])
  const notes = res(data, 'SHEET_NOTE_PLUGIN')[sheetId(data, 'Budget')]
  ok(notes?.[1]?.[0]?.note === 'Check the renewal', 'a note', notes)
  ok(['charts', 'pictures', 'macros', 'sparklines'].every((k) => lost.includes(k)), "what's kept but not shown is named: charts, pictures, macros, sparklines", lost)
  ok(charts.length === 1 && charts[0].type === 'column' && charts[0].title === 'Costs' && charts[0].series[0].vals.join() === '120,900,45,610,300' && charts[0].series[0].valRef === 'Budget!$B$2:$B$6' && charts[0].from.row === 4, 'its chart, to draw beside the grid: kind, title, values, where', charts[0])

  // ---------- Saved with nothing changed ----------
  let out = await writeBook(orig, keep, data)
  ok(diffParts(before, await entries(out.bytes)).length === 0 && !out.notKept.length, 'saved unchanged: every part exactly as it was', diffParts(before, await entries(out.bytes)))
  // Univer's own copy of the same workbook: style ids renamed, off switches spelled out, row sizes
  // it worked out, rules re-keyed. Still nothing to write.
  const noisy = clone(data)
  const ids = Object.keys(noisy.styles)
  const ren = Object.fromEntries(ids.map((k, i) => [k, `u${i}`]))
  noisy.styles = Object.fromEntries(ids.map((k) => [ren[k], { ...noisy.styles[k], it: noisy.styles[k].it || 0, st: noisy.styles[k].st || { s: 0 } }]))
  for (const s of Object.values(noisy.sheets)) { for (const row of Object.values(s.cellData)) for (const c of Object.values(row)) if (typeof c.s === 'string') c.s = ren[c.s]; for (const [r, rd] of Object.entries(s.rowData)) s.rowData[r] = { ...rd, ah: 20 }; s.rowData[40] = { ah: 20 }; s.zoomRatio = 1 }
  noisy.resources = noisy.resources.map((r) => ({ ...r, data: JSON.stringify(JSON.parse(r.data), (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)) }))
  out = await writeBook(orig, keep, noisy)
  ok(diffParts(before, await entries(out.bytes)).length === 0, "Univer's copy of an unchanged workbook (its own style ids, keys in another order) saves nothing new", diffParts(before, await entries(out.bytes)))

  // ---------- One cell changed ----------
  const one = clone(data)
  one.sheets[sheetId(data, 'Budget')].cellData[2][1] = { ...one.sheets[sheetId(data, 'Budget')].cellData[2][1], v: 950 }
  out = await writeBook(orig, keep, one)
  let after = await entries(out.bytes)
  const changedParts = diffParts(before, after)
  ok(changedParts.join() === 'xl/workbook.xml,xl/worksheets/sheet1.xml', 'one cell changed: only its sheet, and the workbook told to work formulas out again on opening', changedParts)
  const c0 = cellsOf(before['xl/worksheets/sheet1.xml'].toString()), c1 = cellsOf(after['xl/worksheets/sheet1.xml'].toString())
  const cd = c1.filter(([r, x], i) => c0[i]?.[0] !== r || c0[i][1] !== x)
  ok(c0.length === c1.length && cd.length === 1 && cd[0][0] === 'B3' && /<v>950<\/v>/.test(cd[0][1]) && cd[0][1].includes(`s="${/<c r="B3" s="(\d+)"/.exec(before['xl/worksheets/sheet1.xml'].toString())[1]}"`), 'inside it, only that cell, with its format as it was', cd)
  ok(/fullCalcOnLoad="1"/.test(after['xl/workbook.xml'].toString()), 'Excel works the formulas out again on opening')
  const notCells = (x) => x.toString().replace(/<sheetData>[\s\S]*<\/sheetData>/, '')
  ok(notCells(before['xl/worksheets/sheet1.xml']) === notCells(after['xl/worksheets/sheet1.xml']), 'the rest of the sheet (views, columns, merges, rules, links, the extension Excel added) is as it was')

  // The formulas that use it worked out again (as Univer does): their new results written, each
  // formula as it was (a shared formula still shared); one Univer can't work out keeps Excel's.
  const calc = clone(one)
  const cb = calc.sheets[sheetId(data, 'Budget')]
  cb.cellData[2][3] = { ...cb.cellData[2][3], v: 1900 }
  cb.cellData[6][1] = { ...cb.cellData[6][1], v: 2025 }
  calc.sheets[sheetId(data, 'Plan Two')].cellData[0][1] = { ...calc.sheets[sheetId(data, 'Plan Two')].cellData[0][1], v: 4050 }
  out = await writeBook(orig, keep, calc)
  after = await entries(out.bytes)
  const fx = (xml, ref) => new RegExp(`<c r="${ref}"[^>]*>([\\s\\S]*?)</c>`).exec(xml.toString())
  const s1x = after['xl/worksheets/sheet1.xml'], s0x = before['xl/worksheets/sheet1.xml']
  ok(/<v>2025<\/v>/.test(fx(s1x, 'B7')[1]) && /<v>1900<\/v>/.test(fx(s1x, 'D3')[1]) && /<v>4050<\/v>/.test(fx(after['xl/worksheets/sheet2.xml'], 'B1')[1]), 'formulas using it: their new results written, on this sheet and another', [fx(s1x, 'B7')[0], fx(s1x, 'D3')[0]])
  const fOf = (m) => /<f[^>]*?(?:\/>|>[^<]*<\/f>)/.exec(m[1])[0]
  ok(fOf(fx(s1x, 'D3')) === fOf(fx(s0x, 'D3')) && /t="shared"/.test(fOf(fx(s1x, 'D3'))) && fOf(fx(s1x, 'B7')) === fOf(fx(s0x, 'B7')) && cellsOf(s1x.toString()).filter(([r, x], i) => cellsOf(s0x.toString())[i][1] !== x).map(([r]) => r).join() === 'B3,D3,B7', 'each formula exactly as it was, a shared one still shared; only those three cells differ', fOf(fx(s1x, 'D3')))
  const nameErr = clone(data)
  nameErr.sheets[sheetId(data, 'Budget')].cellData[6][1] = { ...nameErr.sheets[sheetId(data, 'Budget')].cellData[6][1], v: '#NAME?' }
  out = await writeBook(orig, keep, nameErr)
  ok(diffParts(before, await entries(out.bytes)).length === 0, "a formula Univer can't work out (#NAME?) keeps Excel's result")

  // ---------- A style changed ----------
  const bold = clone(data)
  const bs = bold.sheets[sheetId(data, 'Budget')]
  const was = bs.cellData[3][1]
  bs.cellData[3][1] = { ...was, s: { ...data.styles[was.s], bl: 1, bg: { rgb: '#FFEB9C' } } }
  out = await writeBook(orig, keep, bold)
  after = await entries(out.bytes)
  const xfs = (x) => (/<cellXfs count="(\d+)"/.exec(x.toString()) || [])[1]
  const s0 = /<c r="B4" s="(\d+)"/.exec(before['xl/worksheets/sheet1.xml'].toString())[1], s1 = /<c r="B4" s="(\d+)"/.exec(after['xl/worksheets/sheet1.xml'].toString())[1]
  ok(Number(xfs(after['xl/styles.xml'])) === Number(xfs(before['xl/styles.xml'])) + 1 && Number(s1) === Number(xfs(before['xl/styles.xml'])) && s0 !== s1, 'a style changed: a new format added, the cell pointed at it', { s0, s1, before: xfs(before['xl/styles.xml']), after: xfs(after['xl/styles.xml']) })
  const others = (x) => cellsOf(x.toString()).filter(([r]) => r !== 'B4')
  ok(JSON.stringify(others(before['xl/worksheets/sheet1.xml'])) === JSON.stringify(others(after['xl/worksheets/sheet1.xml'])), 'every other cell keeps its format')
  const reread = await readBook(out.bytes, 'budget.xlsx')
  const rb = reread.data.sheets[sheetId(reread.data, 'Budget')].cellData[3][1]
  const rbs = reread.data.styles[rb.s]
  ok(rbs.bl === 1 && rbs.bg?.rgb === '#ffeb9c' && rbs.n?.pattern === '#,##0.00' && rb.v === 45, 'reopened: bold and filled, its number format kept from the format it had', rbs)

  // ---------- Reopened: the same, but for the edits ----------
  const edited = clone(data)
  const E = edited.sheets[sheetId(data, 'Budget')]
  E.cellData[2][1] = { ...E.cellData[2][1], v: 950 }
  E.cellData[12] = { 0: { v: 'New line', t: 1 }, 1: { v: 7, t: 2, s: { bl: 1 } }, 2: { f: '=B13*3', v: 21, t: 2 } }
  E.cellData[13] = { 0: { v: 'Ünïcödé & <tags> "quoted"', t: 1 } }
  E.columnData[1] = { w: 200 }
  E.rowData[2] = { h: 36 }
  E.mergeData.push({ startRow: 14, endRow: 15, startColumn: 0, endColumn: 1 })
  E.freeze = { xSplit: 0, ySplit: 2, startRow: 2, startColumn: 0 }
  const ecf = res(edited, 'SHEET_CONDITIONAL_FORMATTING_PLUGIN')
  ecf[sheetId(data, 'Budget')].push({ cfId: 'new1', stopIfTrue: false, ranges: [{ startRow: 1, endRow: 5, startColumn: 3, endColumn: 3 }], rule: { type: 'dataBar', isShowValue: true, config: { min: { type: 'min' }, max: { type: 'max' }, isGradient: true, positiveColor: '#5b9bd5', nativeColor: '#ff0000' } } })
  ecf[sheetId(data, 'Budget')].splice(2, 1)
  setRes(edited, 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', ecf)
  const edv = res(edited, 'SHEET_DATA_VALIDATION_PLUGIN')
  edv[sheetId(data, 'Budget')][0].formula1 = 'Yes,No'
  setRes(edited, 'SHEET_DATA_VALIDATION_PLUGIN', edv)
  const ef = res(edited, 'SHEET_FILTER_PLUGIN')
  ef[sheetId(data, 'Budget')] = { ref: { startRow: 0, endRow: 6, startColumn: 0, endColumn: 4 }, filterColumns: [{ colId: 0, filters: { filters: ['Design', 'Legal'] } }], cachedFilteredOut: [1, 3, 5] }
  setRes(edited, 'SHEET_FILTER_PLUGIN', ef)
  E.cellData[11][0].p.body.customRanges[0].properties.url = 'https://example.com/other'
  E.cellData[15] = { 0: { v: 'Docs', t: 1, p: { id: 'd', body: { dataStream: 'Docs\r\n', paragraphs: [{ startIndex: 4 }], customRanges: [{ startIndex: 0, endIndex: 3, rangeType: 0, rangeId: 'x', properties: { url: 'https://example.com/docs' } }] }, documentStyle: {} } } }
  const en = res(edited, 'SHEET_NOTE_PLUGIN')
  en[sheetId(data, 'Budget')][1][0].note = 'Renewed for a year'
  en[sheetId(data, 'Budget')][4] = { 1: { id: 'n2', row: 4, col: 1, width: 216, height: 92, note: 'Ask about this', show: false } }
  setRes(edited, 'SHEET_NOTE_PLUGIN', en)
  edited.sheets[sheetId(data, 'Plan Two')].tabColor = '#7030a0'
  out = await writeBook(orig, keep, edited)
  after = await entries(out.bytes)
  const bad = Object.entries(after).filter(([k, v]) => /\.(xml|rels|vml)$/.test(k) && !wellFormed(v.toString())).map(([k]) => k)
  ok(!bad.length, 'every XML part written is well formed', bad)
  ok(['xl/charts/chart1.xml', 'xl/vbaProject.bin', 'xl/custom/thing.xml', 'xl/theme/theme1.xml'].every((k) => after[k] && after[k].equals(before[k])), "what Studio doesn't touch (the chart, the macros, an unknown part, the theme) is byte for byte as it was")
  const R = await readBook(out.bytes, 'budget.xlsx')
  const RB = R.data.sheets[sheetId(R.data, 'Budget')]
  const RS = (cell) => (typeof cell?.s === 'string' ? R.data.styles[cell.s] : cell?.s) || {}
  ok(RB.cellData[2][1].v === 950 && RB.cellData[12][0].v === 'New line' && RB.cellData[12][1].v === 7 && RS(RB.cellData[12][1]).bl === 1 && RB.cellData[12][2].f === '=B13*3' && RB.cellData[13][0].v === 'Ünïcödé & <tags> "quoted"', 'reopened: edited and new cells, a new style, a new formula, characters XML escapes', [RB.cellData[12], RB.cellData[13]])
  ok(RB.cellData[1][3].f === '=B2*2' && RB.cellData[4][3].f === '=B5*2' && RB.cellData[6][1].f === '=SUM(B2:B6)' && RB.cellData[7][0].p && RS(RB.cellData[0][0]).bl === 1, 'and what wasn\'t edited the same: shared formulas, the total, rich text, the header', RB.cellData[4][3])
  ok(RB.columnData[1]?.w === 200 && RB.columnData[0]?.w === 140 && RB.rowData[2]?.h === 36 && RB.rowData[9]?.hd === 1 && RB.columnData[5]?.hd === 1, 'sizes: the changed ones and the rest', { c1: RB.columnData[1], r2: RB.rowData[2] })
  ok(RB.mergeData.length === 2 && RB.freeze.ySplit === 2 && RB.freeze.xSplit === 0, 'merges and the new freeze', { m: RB.mergeData, f: RB.freeze })
  const rcf = res(R.data, 'SHEET_CONDITIONAL_FORMATTING_PLUGIN')[sheetId(R.data, 'Budget')].map((r) => r.rule.type === 'highlightCell' ? r.rule.subType : r.rule.type)
  ok(rcf.join() === 'number,colorScale,text,formula,dataBar', 'conditional formats: one deleted, one added, the rest as they were', rcf)
  const rdv = res(R.data, 'SHEET_DATA_VALIDATION_PLUGIN')[sheetId(R.data, 'Budget')]
  ok(rdv[0].formula1 === 'Yes,No' && rdv[1].formula1 === '1' && rdv[1].error === 'One to ten', 'validation: the changed list, the rest kept', rdv)
  const rf = res(R.data, 'SHEET_FILTER_PLUGIN')[sheetId(R.data, 'Budget')]
  const sx = after['xl/worksheets/sheet1.xml'].toString()
  ok(rf?.ref?.endColumn === 4 && rf.filterColumns?.[0]?.filters?.filters.join() === 'Design,Legal' && /<row r="2"[^>]*hidden="1"/.test(sx) && !/<row r="3"[^>]*hidden="1"/.test(sx), 'the filter: its range and values, the rows it hides hidden', rf)
  ok(urlAt(RB.cellData[11][0]) === 'https://example.com/other' && urlAt(RB.cellData[10][0]) === 'https://example.com/plan' && urlAt(RB.cellData[15][0]) === 'https://example.com/docs', 'links: one changed, one kept, one new', [urlAt(RB.cellData[11][0]), urlAt(RB.cellData[15][0])])
  const rn = res(R.data, 'SHEET_NOTE_PLUGIN')[sheetId(R.data, 'Budget')]
  ok(rn?.[1]?.[0]?.note === 'Renewed for a year' && rn?.[4]?.[1]?.note === 'Ask about this', 'notes: one changed, one new', rn)
  const vml = Object.keys(after).find((k) => /\.vml$/.test(k))
  ok(vml && (after[vml].toString().match(/ObjectType="Note"/g) || []).length === 2, 'and a box drawn for each', vml)
  ok(R.data.sheets[sheetId(R.data, 'Plan Two')].tabColor === '#7030a0', 'a new tab colour')
  const ej = new ExcelJS.Workbook()
  let loaded = true
  try { await ej.xlsx.load(Buffer.from(out.bytes)) } catch (e) { loaded = e.message }
  const ejb = loaded === true ? ej.getWorksheet('Budget') : null
  ok(loaded === true && ejb.getCell('B3').value === 950 && ejb.getCell('A13').value === 'New line' && ejb.getCell('C13').formula === 'B13*3' && ejb.getCell('B4').numFmt === '#,##0.00' && ejb.getCell('A1').font?.bold && ejb.getColumn(2).width > 20 && /^'?Budget'?!\$B\$2:\$B\$6$/.test(ej.definedNames.getRanges('Costs').ranges[0]), 'ExcelJS opens it too, with the same values, formulas, formats, widths and names', loaded === true ? { B3: ejb.getCell('B3').value, A13: ejb.getCell('A13').value, C13: ejb.getCell('C13').formula, B4: ejb.getCell('B4').numFmt, A1: ejb.getCell('A1').font, w: ejb.getColumn(2).width, costs: ej.definedNames.getRanges('Costs') } : loaded)

  // ---------- Rows added, removed ----------
  const ins = clone(data)
  const bid = sheetId(data, 'Budget')
  univerInsertRows(ins, bid, 3, 2)
  out = await writeBook(orig, keep, ins, { ops: [{ sheet: bid, op: 'insert-rows', start: 3, count: 2 }] })
  after = await entries(out.bytes)
  const R2 = await readBook(out.bytes, 'budget.xlsx')
  const B2 = R2.data.sheets[bid]
  const dx = after[Object.keys(after).find((k) => /^xl\/drawings\/drawing\d+\.xml$/.test(k))].toString()
  const rowsOf = (x) => [...x.matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/g)].map((m) => Number(m[2]))
  ok(B2.cellData[5][0].v === 'Fonts' && B2.cellData[8][1].f === '=SUM(B2:B8)' && B2.mergeData.some((g) => g.startRow === 10) && B2.rowData[11]?.hd === 1, 'two rows added: cells, the total, the merge and the hidden row moved down', { total: B2.cellData[8][1], m: B2.mergeData })
  ok(rowsOf(dx).join() === '1,6', 'the picture above stays; the chart below moves down two rows', rowsOf(dx))
  ok(/Budget!\$B\$2:\$B\$8/.test(after['xl/charts/chart1.xml'].toString()) && /Budget!\$A\$2:\$A\$8/.test(after['xl/charts/chart1.xml'].toString()), "the chart's series grow with them", after['xl/charts/chart1.xml'].toString().match(/<c:f>[^<]*<\/c:f>/g))
  ok(/'Budget'!\$B\$2:\$B\$8|Budget!\$B\$2:\$B\$8/.test(after['xl/workbook.xml'].toString()), 'and the name Costs', after['xl/workbook.xml'].toString().match(/<definedName[^>]*>[^<]*/g))
  ok(/<xm:f>Budget!B2:B8<\/xm:f>/.test(after['xl/worksheets/sheet1.xml'].toString()) && /<xm:sqref>F14<\/xm:sqref>/.test(after['xl/worksheets/sheet1.xml'].toString()), 'and the sparkline Excel added, its data and its cell')
  const commentsPart = Object.keys(after).find((k) => /comments\d*\.xml$/.test(k))
  ok(/ref="A2"/.test(after[commentsPart].toString()), 'a note above them stays', after[commentsPart].toString().match(/ref="[^"]+"/g))
  const p2b = R2.data.sheets[sheetId(R2.data, 'Plan Two')]
  ok(p2b.cellData[0][1].f === '=Budget!B9*2', 'another sheet\'s formula follows the total', p2b.cellData[0][1])
  const rem = clone(data)
  univerRemoveRows(rem, bid, 9, 1)
  out = await writeBook(orig, keep, rem, { ops: [{ sheet: bid, op: 'remove-rows', start: 9, count: 1 }] })
  const R3 = await readBook(out.bytes, 'budget.xlsx')
  const B3 = R3.data.sheets[bid]
  ok(B3.cellData[9][0].v === 'Our site' && !B3.mergeData.some((g) => g.startRow > 8) && urlAt(B3.cellData[9][0]) === 'https://example.com/plan', 'a row removed: the rows under it move up, links with them', B3.cellData[9])
  // A note in a removed row is gone, and the ref to a removed cell becomes #REF!
  const rem2 = clone(data)
  univerRemoveRows(rem2, bid, 1, 1)
  const n2 = res(rem2, 'SHEET_NOTE_PLUGIN'); n2[bid] = {}; setRes(rem2, 'SHEET_NOTE_PLUGIN', n2)
  out = await writeBook(orig, keep, rem2, { ops: [{ sheet: bid, op: 'remove-rows', start: 1, count: 1 }] })
  const wb2 = await xmlOf(out.bytes, 'xl/workbook.xml')
  ok(/Budget'?!\$B\$2:\$B\$5/.test(wb2) && !Object.keys(await entries(out.bytes)).some((k) => /comments\d*\.xml$/.test(k)), 'the first row of a range removed: the range shrinks; the only note removed: its part goes', wb2.match(/<definedName[^>]*>[^<]*/g))

  // A row moved down two (Univer's move: the block lands before row 5): the rows between move up,
  // and so does the chart anchored among them.
  const mv = clone(data)
  const perm = (i) => (i === 2 ? 4 : i === 3 || i === 4 ? i - 1 : i)
  const pk = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [perm(Number(k)), v]))
  mv.sheets[bid].cellData = pk(mv.sheets[bid].cellData)
  mv.sheets[bid].rowData = pk(mv.sheets[bid].rowData)
  for (const row of Object.values(mv.sheets[bid].cellData)) for (const cell of Object.values(row)) if (cell?.f) cell.f = cell.f.replace(/^=B(\d)\*2$/, (m, r) => `=B${perm(Number(r) - 1) + 1}*2`)
  out = await writeBook(orig, keep, mv, { ops: [{ sheet: bid, op: 'move-rows', from: 2, count: 1, to: 5 }] })
  const R7 = await readBook(out.bytes, 'budget.xlsx')
  const dx7 = (await entries(out.bytes))[Object.keys(after).find((k) => /^xl\/drawings\/drawing\d+\.xml$/.test(k))].toString()
  ok(R7.data.sheets[bid].cellData[4][0].v === 'Design' && R7.data.sheets[bid].cellData[2][0].v === 'Fonts' && R7.data.sheets[bid].cellData[4][3].f === '=B5*2' && rowsOf(dx7).join() === '1,3', 'a row moved: the rows between move up, its formula with it, and the chart among them', { r4: R7.data.sheets[bid].cellData[4], anchors: rowsOf(dx7) })

  // ---------- A new chart ("chart this") ----------
  out = await writeBook(orig, keep, data, { charts: [{ sheet: bid, type: 'line', title: 'Costs by item', ref: 'A1:B6', at: { col: 7, row: 20 }, size: { cols: 6, rows: 12 } }, { sheet: sheetId(data, 'Plan Two'), type: 'pie', title: 'Share', ref: 'A1:B2' }] })
  after = await entries(out.bytes)
  const newCharts = Object.keys(after).filter((k) => /^xl\/charts\/chart\d+\.xml$/.test(k) && !before[k])
  const R6 = await readBook(out.bytes, 'budget.xlsx')
  const lineChart = R6.charts.find((c) => c.title === 'Costs by item'), pie = R6.charts.find((c) => c.title === 'Share')
  ok(newCharts.length === 2 && newCharts.every((k) => wellFormed(after[k].toString())) && after['xl/charts/chart1.xml'].equals(before['xl/charts/chart1.xml']), 'two new charts, well formed; the one there already untouched', newCharts)
  ok(lineChart?.type === 'line' && lineChart.series[0].name === 'Cost' && lineChart.series[0].cats.join() === 'Hosting,Design,Fonts,Legal,Travel' && lineChart.series[0].vals.join() === '120,900,45,610,300' && lineChart.series[0].valRef === 'Budget!$B$2:$B$6' && lineChart.from.col === 7 && lineChart.from.row === 20 && lineChart.to.col === 13, 'read back: a line chart of the costs, by item, where it was asked for', lineChart)
  ok(pie?.type === 'pie' && pie.sheet === sheetId(data, 'Plan Two') && R6.charts.length === 3, 'and a pie on a sheet that had no drawing, given one', pie)
  const ejc = new ExcelJS.Workbook()
  let lc = true
  try { await ejc.xlsx.load(Buffer.from(out.bytes)) } catch (e) { lc = e.message }
  ok(lc === true && /<drawing r:id="rId\d+"\/>/.test(after['xl/worksheets/sheet2.xml'].toString()), 'ExcelJS still opens it; the sheet points at its new drawing', lc)

  // ---------- Sheets added, renamed, moved, deleted ----------
  const sheets = clone(data)
  sheets.sheets.newsheet = { id: 'newsheet', name: 'Forecast', cellData: { 0: { 0: { v: 'Next year', t: 1 }, 1: { f: '=Budget!B7*1.1', v: 2172.5, t: 2 } } }, rowData: {}, columnData: { 0: { w: 120 } }, mergeData: [], defaultRowHeight: 24, defaultColumnWidth: 88, freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 } }
  sheets.sheetOrder = [sheetId(data, 'Plan Two'), 'newsheet', bid, sheetId(data, 'Archive')]
  sheets.sheets[bid].name = 'Costs 2026'
  for (const s of Object.values(sheets.sheets)) for (const row of Object.values(s.cellData)) for (const cell of Object.values(row)) if (cell.f) cell.f = cell.f.replace(/Budget!/g, "'Costs 2026'!")
  out = await writeBook(orig, keep, sheets)
  const R4 = await readBook(out.bytes, 'budget.xlsx')
  const names = R4.data.sheetOrder.map((id) => R4.data.sheets[id].name)
  const wb4 = await xmlOf(out.bytes, 'xl/workbook.xml')
  const ch4 = await xmlOf(out.bytes, 'xl/charts/chart1.xml')
  const fc = R4.data.sheets[R4.data.sheetOrder[1]]
  ok(names.join() === 'Plan Two,Forecast,Costs 2026,Archive' && fc.cellData[0][1].f === "='Costs 2026'!B7*1.1" && fc.columnData[0]?.w === 120 && fc.freeze.ySplit === 1 && fc.defaultColumnWidth === 88, 'sheets: a new one (its cells, width and freeze), one renamed, moved in order', { names, f: fc.cellData[0][1] })
  ok(/'Costs 2026'!\$B\$2:\$B\$6/.test(wb4) && /'Costs 2026'!\$B\$2:\$B\$6/.test(ch4) && /location="#?'Costs 2026'!A1"/.test(await xmlOf(out.bytes, 'xl/worksheets/sheet2.xml')), 'renamed: its name in names, the chart and links', { wb: wb4.match(/<definedName[^>]*>[^<]*/g), ch: ch4.match(/<c:f>[^<]*/g) })
  ok(R4.data.sheets[R4.data.sheetOrder[0]].cellData[0][1].f === "='Costs 2026'!B7*2", "another sheet's formula names it by its new name")
  const ej4 = new ExcelJS.Workbook()
  let l4 = true
  try { await ej4.xlsx.load(Buffer.from(out.bytes)) } catch (e) { l4 = e.message }
  ok(l4 === true && ej4.worksheets.map((w) => w.name).join() === 'Plan Two,Forecast,Costs 2026,Archive', 'ExcelJS opens it, in the same order', l4)
  const del = clone(data)
  del.sheetOrder = del.sheetOrder.filter((id) => id !== bid)
  delete del.sheets[bid]
  out = await writeBook(orig, keep, del)
  const after5 = await entries(out.bytes)
  ok(!after5['xl/worksheets/sheet1.xml'] && !after5['xl/charts/chart1.xml'] && !/Budget/.test(after5['xl/workbook.xml'].toString().replace(/<definedName[\s\S]*?<\/definedName>/g, '')) && out.notKept.length === 0, 'a sheet deleted: its part, its chart and the picture with it go', { parts: Object.keys(after5).filter((k) => /sheet|chart|drawing/.test(k)), notKept: out.notKept })
  const R5 = await readBook(out.bytes, 'budget.xlsx')
  ok(R5.data.sheetOrder.length === 2 && /#REF!/.test(after5['xl/workbook.xml'].toString()), 'what named it now says #REF!, as in Excel', after5['xl/workbook.xml'].toString().match(/<definedName[^>]*>[^<]*/g))

  // ---------- A new workbook ----------
  const nb = await newBook()
  const ejn = new ExcelJS.Workbook()
  let ln = true
  try { await ejn.xlsx.load(Buffer.from(nb)) } catch (e) { ln = e.message }
  const rn2 = await readBook(nb, 'new.xlsx')
  ok(ln === true && ejn.worksheets[0]?.name === 'Sheet1' && rn2.data.sheetOrder.length === 1 && !rn2.lost.length, 'a new workbook: one sheet, Sheet1, that ExcelJS opens', ln)
  const nd = clone(rn2.data)
  nd.sheets[nd.sheetOrder[0]].cellData = { 0: { 0: { v: 'Hello', t: 1 }, 1: { v: 3, t: 2 } }, 1: { 1: { f: '=B1*2', v: 6, t: 2 } } }
  out = await writeBook(nb, rn2.keep, nd)
  const rn3 = await readBook(out.bytes, 'new.xlsx')
  ok(rn3.data.sheets[rn3.data.sheetOrder[0]].cellData[1][1].f === '=B1*2', 'and filled in and saved', rn3.data.sheets[rn3.data.sheetOrder[0]].cellData)

  // ---------- Threaded comments, as Excel 365 writes them ----------
  const tx = await threadsXlsx()
  const txParts = await entries(tx)
  const off = await readBook(tx, 'threads.xlsx')
  ok(off.lost.includes('threaded comments') && Object.keys(res(off.data, 'SHEET_NOTE_PLUGIN').sheet1 || {}).length === 3 && !Object.keys(off.threads).length, 'read without threads (Comments and @bridge off): kept in the file and said so, their placeholders shown as notes, as before', off.lost)
  const on = await readBook(tx, 'threads.xlsx', { threads: true })
  const ts = on.threads.sheet1 || []
  ok(!on.lost.includes('threaded comments') && JSON.stringify(ts.map((x) => [x.r, x.c, x.author, x.text, !!x.parent, x.done])) === JSON.stringify(SHEET_THREADS.map((x) => [Number(x.ref.slice(1)) - 1, 1, PEOPLE[x.who].name, x.text, !!x.parent, !!x.done])), 'read with threads: each comment\'s cell, who wrote it (from the persons part), its words, which it answers and which are resolved', ts)
  const notesOn = res(on.data, 'SHEET_NOTE_PLUGIN').sheet1 || {}
  ok(Object.keys(notesOn).length === 1 && /Ask finance/.test(notesOn[1]?.[0]?.note), 'and the plain note a note still, the threads\' placeholders not', notesOn)
  out = await writeBook(tx, on.keep, clone(on.data), { threads: { sheet1: ts } })
  ok(!diffParts(txParts, await entries(out.bytes)).length, 'saved with nothing changed: every part exactly as it was')
  const mine = { id: '{C0000001-0000-4000-8000-00000000000A}', r: 1, c: 2, author: 'Tester', date: '2026-11-10T09:30:00.000Z', text: 'Where is the\nyearly cost?', parent: null, done: false }
  const reply = { id: '{C0000001-0000-4000-8000-00000000000B}', r: 1, c: 2, author: 'AI Assist', date: '2026-11-10T09:31:00.000Z', text: 'In row 7.', parent: mine.id, done: false }
  out = await writeBook(tx, on.keep, clone(on.data), { threads: { sheet1: [...ts.map((x) => (x.id === SHEET_THREADS[0].id ? { ...x, done: true } : x)), mine, reply] } })
  const tp = await entries(out.bytes)
  const tc = tp['xl/threadedComments/threadedComment1.xml'].toString()
  const shapeOf = (x) => String(x || '').replace(/="[^"]*"/g, '=""').replace(/>[^<]+</g, '><')
  const tcOf = (xml, id) => new RegExp(`<threadedComment [^>]*id="${id.replace(/[{}]/g, '\\$&')}"[\\s\\S]*?</threadedComment>`).exec(xml)?.[0] || ''
  const theirs = txParts['xl/threadedComments/threadedComment1.xml'].toString()
  ok(shapeOf(tcOf(tc, mine.id)) === shapeOf(tcOf(theirs, SHEET_THREADS[0].id)) && shapeOf(tcOf(tc, reply.id)) === shapeOf(tcOf(theirs, SHEET_THREADS[1].id)), 'a new thread and its reply, each shaped as Excel writes one (cell, time, person, id, the one it answers)', [tcOf(tc, mine.id), tcOf(tc, reply.id)])
  ok(/ref="C2" dT="2026-11-10T09:30:00\.00" personId="\{[0-9A-F-]{36}\}"/.test(tcOf(tc, mine.id)) && /<text>Where is the\nyearly cost\?<\/text>/.test(tcOf(tc, mine.id)), 'on its cell, at its time in Excel\'s form, its lines kept', tcOf(tc, mine.id))
  ok(SHEET_THREADS.slice(1).every((x) => tc.includes(tcOf(theirs, x.id))) && /id="\{A0000001-0000-4000-8000-000000000001\}" done="1"/.test(tc), 'every comment it didn\'t change written as Excel had it, and the one resolved marked done', tc.slice(0, 600))
  const ppl = tp['xl/persons/person.xml'].toString()
  ok(/<person displayName="Tester" id="\{[0-9A-F-]{36}\}" userId="Tester" providerId="None"\/>/.test(ppl) && /<person displayName="AI Assist" id="\{[0-9A-F-]{36}\}" userId="AI Assist" providerId="None"\/>/.test(ppl) && ppl.includes('displayName="Avery Stone"'), 'you and AI Assist added to the persons, as Excel adds a person', ppl)
  const cm = tp['xl/comments1.xml'].toString()
  const holder = /<comment ref="C2" authorId="(\d+)" shapeId="0" xr:uid="\{C0000001-0000-4000-8000-00000000000A\}"><text><t>([\s\S]*?)<\/t><\/text><\/comment>/.exec(cm)
  const authorsOf = (x) => [...x.matchAll(/<author>([^<]*)<\/author>/g)].map((m) => m[1])
  ok(!!holder && authorsOf(cm)[Number(holder[1])] === `tc=${mine.id}` && holder[2].startsWith('[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment;') && /Comment:\n {4}Where is the\n {4}yearly cost\?\nReply:\n {4}In row 7\.$/.test(holder[2]), 'its placeholder for older Excels in the comments part: written by tc={its id}, in Excel\'s words, the comment and its reply', holder?.[0])
  ok(cm.includes(txParts['xl/comments1.xml'].toString().match(/<comment ref="A2"[\s\S]*?<\/comment>/)[0]) && cm.includes(txParts['xl/comments1.xml'].toString().match(/<comment ref="B6"[\s\S]*?<\/comment>/)[0]), 'the plain note and the placeholders it didn\'t change as they were')
  ok((tp['xl/drawings/vmlDrawing1.vml'].toString().match(/ObjectType="Note"/g) || []).length === 5 && /<x:Row>1<\/x:Row><x:Column>2<\/x:Column>/.test(tp['xl/drawings/vmlDrawing1.vml'].toString()), 'a box in the VML for each, the new one\'s on its cell')
  ok(JSON.stringify(diffParts(txParts, tp)) === JSON.stringify(['xl/comments1.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/persons/person.xml', 'xl/threadedComments/threadedComment1.xml']), 'and nothing else changed', diffParts(txParts, tp))
  const back = await readBook(out.bytes, 'threads.xlsx', { threads: true })
  ok(JSON.stringify(back.threads.sheet1.map((x) => [x.id, x.r, x.c, x.author, x.text, x.parent, x.done])) === JSON.stringify([...ts.map((x) => (x.id === SHEET_THREADS[0].id ? { ...x, done: true } : x)), mine, reply].map((x) => [x.id, x.r, x.c, x.author, x.text, x.parent, x.done])), 'read back: the same threads, replies and resolved one', back.threads.sheet1)
  const ejt = new ExcelJS.Workbook()
  let lt = true
  try { await ejt.xlsx.load(Buffer.from(out.bytes)) } catch (e) { lt = e.message }
  ok(lt === true && ejt.getWorksheet('Budget').getCell('B7').value?.formula === 'SUM(B2:B6)', 'ExcelJS opens it', lt)
  // A file with no threads: given its parts, as Excel adds them.
  const plain = await readBook(orig, 'budget.xlsx', { threads: true })
  out = await writeBook(orig, plain.keep, clone(plain.data), { threads: { [sheetId(plain.data, 'Budget')]: [{ ...mine, author: 'Tester' }] } })
  const pp = await entries(out.bytes)
  const tcPath = Object.keys(pp).find((k) => /^xl\/threadedComments\/threadedComment\d+\.xml$/.test(k))
  ok(!!tcPath && !!pp['xl/persons/person.xml'] && /Type="http:\/\/schemas\.microsoft\.com\/office\/2017\/10\/relationships\/person" Target="persons\/person\.xml"/.test(pp['xl/_rels/workbook.xml.rels'].toString()) && /Type="http:\/\/schemas\.microsoft\.com\/office\/2017\/10\/relationships\/threadedComment" Target="\.\.\/threadedComments\/threadedComment\d+\.xml"/.test(pp['xl/worksheets/_rels/sheet1.xml.rels'].toString()) && /PartName="\/xl\/persons\/person\.xml" ContentType="application\/vnd\.ms-excel\.person\+xml"/.test(pp['[Content_Types].xml'].toString()) && new RegExp(`PartName="/${tcPath}" ContentType="application/vnd\\.ms-excel\\.threadedcomments\\+xml"`).test(pp['[Content_Types].xml'].toString()), 'a file without threads given the parts as Excel adds them: the thread\'s, the persons\', their relationships and content types', tcPath)
  ok(/mc:Ignorable="[^"]*\bxr\b/.test(Object.entries(pp).find(([k]) => /^xl\/comments\d*\.xml$/.test(k))?.[1].toString() || ''), 'and xr:uid\'s namespace on its comments part, as Excel marks it')
  // Rows added and removed: each comment moves with its cell; one on a row removed goes with it.
  const tops = { sheet: 'sheet1' }
  const shifted = clone(on.data)
  setRes(shifted, 'SHEET_NOTE_PLUGIN', { sheet1: { 3: { 0: { ...notesOn[1][0], row: 3 } } } }) // the note, moved by Univer
  out = await writeBook(tx, on.keep, shifted, { ops: [{ ...tops, op: 'insert-rows', start: 1, count: 2 }, { ...tops, op: 'remove-rows', start: 7, count: 1 }] })
  const mp = await entries(out.bytes)
  const refs = (x) => (x.match(/<(?:threadedComment|comment) ref="([A-Z]+\d+)"/g) || []).map((m) => /"([^"]+)"/.exec(m)[1])
  ok(JSON.stringify(refs(mp['xl/threadedComments/threadedComment1.xml'].toString())) === '["B4","B4","B5"]' && JSON.stringify(refs(mp['xl/comments1.xml'].toString())) === '["A4","B4","B5"]', 'rows added above: the threads and their placeholders move with their cells; Travel\'s row removed: its thread goes with it', { threads: refs(mp['xl/threadedComments/threadedComment1.xml'].toString()), comments: refs(mp['xl/comments1.xml'].toString()) })

  // ---------- A big one ----------
  const big = new ExcelJS.Workbook()
  const bw = big.addWorksheet('Data')
  for (let r = 1; r <= 2000; r++) bw.addRow(Array.from({ length: 10 }, (_, c) => (c === 0 ? `Row ${r}` : r * c)))
  const bigBytes = await big.xlsx.writeBuffer()
  let t = Date.now()
  const bb = await readBook(bigBytes, 'big.xlsx')
  const readMs = Date.now() - t
  const bd = clone(bb.data)
  bd.sheets[bd.sheetOrder[0]].cellData[500][3] = { v: 1, t: 2 }
  t = Date.now()
  out = await writeBook(bigBytes, bb.keep, bd)
  const writeMs = Date.now() - t
  ok(readMs < 2000 && writeMs < 2000, `20,000 cells: read in ${readMs} ms, one changed and written in ${writeMs} ms`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
}
process.exit(done().fail ? 1 : 0)
