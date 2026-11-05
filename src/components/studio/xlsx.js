// Excel files (ExcelJS) to the workbook Univer shows, and back: values and formulas (with their last
// results), bold, italic, underline and strikethrough, font size and colour, fills, alignment,
// number formats, merged cells, column widths and row heights, and every sheet in its order. A
// CSV is one sheet of values. What an Excel file has beyond that (charts, pivot tables,
// conditional formats, comments) isn't in Univer's workbook here, so Studio says it isn't kept
// before the first save, and the file as it was stays a version.
const loadExcel = () => import('exceljs/dist/exceljs.min.js').then((m) => m.default || m)

const colourOf = (c) => (c?.argb ? `#${c.argb.slice(-6)}` : null)
const argbOf = (rgb) => (rgb ? `FF${rgb.replace('#', '').toUpperCase().padStart(6, '0')}` : undefined)
const H_ALIGN = { left: 1, center: 2, right: 3, justify: 4 }
const H_BACK = Object.fromEntries(Object.entries(H_ALIGN).map(([k, v]) => [v, k]))
const V_ALIGN = { top: 1, middle: 2, bottom: 3 }
const V_BACK = Object.fromEntries(Object.entries(V_ALIGN).map(([k, v]) => [v, k]))

function styleOf(cell) {
  const f = cell.font || {}
  const s = {}
  if (f.bold) s.bl = 1
  if (f.italic) s.it = 1
  if (f.underline) s.ul = { s: 1 }
  if (f.strike) s.st = { s: 1 }
  if (f.size) s.fs = f.size
  if (f.name) s.ff = f.name
  if (colourOf(f.color)) s.cl = { rgb: colourOf(f.color) }
  const bg = cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' ? colourOf(cell.fill.fgColor) : null
  if (bg) s.bg = { rgb: bg }
  if (H_ALIGN[cell.alignment?.horizontal]) s.ht = H_ALIGN[cell.alignment.horizontal]
  if (V_ALIGN[cell.alignment?.vertical]) s.vt = V_ALIGN[cell.alignment.vertical]
  if (cell.alignment?.wrapText) s.tb = 3
  if (cell.numFmt && cell.numFmt !== 'General') s.n = { pattern: cell.numFmt }
  return Object.keys(s).length ? s : null
}

function valueOf(v) {
  if (v == null) return null
  if (typeof v === 'number') return { v, t: 2 }
  if (typeof v === 'boolean') return { v: v ? 1 : 0, t: 3 }
  if (v instanceof Date) return { v: (v.getTime() / 86400000) + 25569, t: 2 }
  if (typeof v === 'string') return { v, t: 1 }
  if (v.formula || v.sharedFormula) return { f: `=${v.formula || v.sharedFormula}`, ...valueOf(v.result instanceof Date || typeof v.result !== 'object' ? v.result : null) }
  if (v.richText) return { v: v.richText.map((r) => r.text).join(''), t: 1 }
  if (v.text != null) return { v: String(v.text), t: 1 }
  if (v.error) return { v: v.error, t: 1 }
  return { v: String(v), t: 1 }
}

let n = 0
const id = (p) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`

export async function workbookOf(buf, name, ext) {
  if (ext === '.csv' || ext === '.tsv') return csvWorkbook(new TextDecoder().decode(buf), name, ext === '.tsv' ? '\t' : ',')
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const styles = {}
  const sheets = {}
  const order = []
  const kinds = new Set() // what isn't kept: charts, pivots, conditional formats, comments
  wb.eachSheet((ws) => {
    const sid = id('s')
    order.push(sid)
    const cellData = {}
    let rows = 0, cols = 0
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const v = valueOf(cell.value)
        const st = styleOf(cell)
        if (!v && !st) return
        if (cell.note) kinds.add('comments')
        const key = st ? JSON.stringify(st) : null
        let styleId = null
        if (key) { styleId = Object.keys(styles).find((k) => JSON.stringify(styles[k]) === key) || id('t'); styles[styleId] = st }
        ;(cellData[r - 1] ||= {})[c - 1] = { ...(v || {}), ...(styleId ? { s: styleId } : {}) }
        rows = Math.max(rows, r); cols = Math.max(cols, c)
      })
    })
    if (ws.conditionalFormattings?.length) kinds.add('conditional formats')
    const mergeData = (ws.model?.merges || []).map((m) => {
      const [a, b] = m.split(':').map((x) => ws.getCell(x))
      return { startRow: a.row - 1, startColumn: a.col - 1, endRow: b.row - 1, endColumn: b.col - 1 }
    })
    const columnData = {}
    ;(ws.columns || []).forEach((col, i) => { if (col?.width) columnData[i] = { w: Math.round(col.width * 7 + 5) } })
    const rowData = {}
    ws.eachRow({ includeEmpty: true }, (row, r) => { if (row.height) rowData[r - 1] = { h: Math.round(row.height * 4 / 3) } })
    sheets[sid] = { id: sid, name: ws.name, rowCount: Math.max(100, rows + 50), columnCount: Math.max(26, cols + 10), cellData, mergeData, columnData, rowData, defaultColumnWidth: 88, defaultRowHeight: 24 }
  })
  if (!order.length) return blankWorkbook(name)
  return { data: { id: id('w'), name, appVersion: '', locale: 'enUS', styles, sheetOrder: order, sheets }, lost: [...kinds] }
}

export function blankWorkbook(name = 'Sheet') {
  const sid = id('s')
  return { data: { id: id('w'), name, appVersion: '', locale: 'enUS', styles: {}, sheetOrder: [sid], sheets: { [sid]: { id: sid, name: 'Sheet1', rowCount: 100, columnCount: 26, cellData: {}, mergeData: [], columnData: {}, rowData: {}, defaultColumnWidth: 88, defaultRowHeight: 24 } } }, lost: [] }
}

// CSV: quoted fields with "" for a quote, a field over several lines in quotes.
function parseCsv(text, sep) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false } else field += ch; continue }
    if (ch === '"') quoted = true
    else if (ch === sep) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = '' }
    else field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}
function csvWorkbook(text, name, sep) {
  const w = blankWorkbook(name)
  const sh = Object.values(w.data.sheets)[0]
  const rows = parseCsv(text, sep)
  rows.forEach((r, i) => r.forEach((v, j) => {
    if (v === '') return
    const num = /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null
    ;(sh.cellData[i] ||= {})[j] = num != null ? { v: num, t: 2 } : { v, t: 1 }
  }))
  sh.rowCount = Math.max(100, rows.length + 50)
  sh.columnCount = Math.max(26, Math.max(0, ...rows.map((r) => r.length)) + 10)
  return w
}

const csvField = (v, sep) => { const s = v == null ? '' : String(v); return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s }

// Back to the file's own kind: a CSV keeps its first sheet's values, an Excel file everything above.
export async function bytesOf(data, ext) {
  if (ext === '.csv' || ext === '.tsv') {
    const sep = ext === '.tsv' ? '\t' : ','
    const sh = data.sheets[data.sheetOrder[0]]
    const rows = Object.keys(sh.cellData).map(Number)
    const last = rows.length ? Math.max(...rows) : -1
    const lines = []
    for (let r = 0; r <= last; r++) {
      const cells = sh.cellData[r] || {}
      const cols = Object.keys(cells).map(Number)
      const end = cols.length ? Math.max(...cols) : -1
      lines.push(Array.from({ length: end + 1 }, (_, c) => csvField(cells[c]?.v, sep)).join(sep))
    }
    return `${lines.join('\n')}\n`
  }
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  for (const sid of data.sheetOrder) {
    const sh = data.sheets[sid]
    const ws = wb.addWorksheet(String(sh.name || 'Sheet').slice(0, 31))
    for (const [r, cells] of Object.entries(sh.cellData || {})) {
      for (const [c, cell] of Object.entries(cells || {})) {
        if (!cell) continue
        const x = ws.getCell(Number(r) + 1, Number(c) + 1)
        const v = cell.t === 3 ? !!cell.v : cell.v
        x.value = cell.f ? { formula: String(cell.f).replace(/^=/, ''), result: v ?? undefined } : (v ?? null)
        const st = typeof cell.s === 'string' ? data.styles?.[cell.s] : cell.s
        if (st) {
          x.font = { bold: !!st.bl, italic: !!st.it, underline: !!st.ul?.s, strike: !!st.st?.s, ...(st.fs ? { size: st.fs } : {}), ...(st.ff ? { name: st.ff } : {}), ...(st.cl?.rgb ? { color: { argb: argbOf(st.cl.rgb) } } : {}) }
          if (st.bg?.rgb) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(st.bg.rgb) } }
          if (st.ht || st.vt || st.tb === 3) x.alignment = { ...(H_BACK[st.ht] ? { horizontal: H_BACK[st.ht] } : {}), ...(V_BACK[st.vt] ? { vertical: V_BACK[st.vt] } : {}), ...(st.tb === 3 ? { wrapText: true } : {}) }
          if (st.n?.pattern) x.numFmt = st.n.pattern
        }
      }
    }
    for (const m of sh.mergeData || []) ws.mergeCells(m.startRow + 1, m.startColumn + 1, m.endRow + 1, m.endColumn + 1)
    for (const [c, col] of Object.entries(sh.columnData || {})) if (col?.w) ws.getColumn(Number(c) + 1).width = Math.max(1, Math.round((col.w - 5) / 7))
    for (const [r, row] of Object.entries(sh.rowData || {})) if (row?.h) ws.getRow(Number(r) + 1).height = Math.round(row.h * 3 / 4)
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}
