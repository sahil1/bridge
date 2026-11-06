// A sheet's file to the workbook Univer shows, and back to the same kind of file. A CSV or TSV is
// one sheet of values, read and written back as it's written (csv.js). An Excel file: see
// readSheet below.
import { readCsv, writeCsv, writesBack, asCell, SEPARATORS } from './csv.js'

const loadExcel = () => import('exceljs/dist/exceljs.min.js').then((m) => m.default || m)
const isCsv = (ext) => ext === '.csv' || ext === '.tsv'

let n = 0
const id = (p) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`

export function blankWorkbook(name = 'Sheet') {
  const sid = id('s')
  return { data: { id: id('w'), name, appVersion: '', locale: 'enUS', styles: {}, sheetOrder: [sid], sheets: { [sid]: { id: sid, name: 'Sheet1', rowCount: 100, columnCount: 26, cellData: {}, mergeData: [], columnData: {}, rowData: {}, defaultColumnWidth: 88, defaultRowHeight: 24 } } }, lost: [] }
}

// Office's fonts, which a Mac or Linux computer may not have: drawn in the nearest one it does,
// and kept by name in the file.
const LOOKALIKE = { Calibri: 'Calibri, Carlito, "Helvetica Neue", Arial, sans-serif', Cambria: 'Cambria, Caladea, Georgia, serif', Aptos: 'Aptos, "Helvetica Neue", Arial, sans-serif', 'Aptos Narrow': '"Aptos Narrow", "Arial Narrow", "Helvetica Neue", Arial, sans-serif', Arial: 'Arial, "Helvetica Neue", sans-serif', 'Times New Roman': '"Times New Roman", Times, serif', Consolas: 'Consolas, Menlo, monospace' }
export const lookalike = (ff) => LOOKALIKE[ff] || ff
function withLookalikes(data) {
  for (const st of Object.values(data.styles || {})) if (st?.ff) st.ff = lookalike(st.ff)
  if (data.defaultStyle && typeof data.defaultStyle === 'object' && data.defaultStyle.ff) data.defaultStyle.ff = lookalike(data.defaultStyle.ff)
  return data
}

// ---------- Reading ----------
// What a file is read into: { kind, data (Univer's workbook), lost (what it has that isn't shown
// here, kept in the file), keep (what the writer needs), charts (the file's own, to draw beside
// the sheet), csv (how a CSV is written) }. opts: a CSV's separator and encoding, when picked.
export async function readSheet(buf, name, ext, opts = {}) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (isCsv(ext)) {
    const csv = readCsv(bytes, { ext, sep: opts.sep, enc: opts.enc })
    const w = blankWorkbook(name)
    const sh = Object.values(w.data.sheets)[0]
    let cols = 0
    const widest = []
    csv.rows.forEach((r, i) => {
      cols = Math.max(cols, r.length)
      r.forEach((f, j) => {
        if (f.v === '') return
        ;(sh.cellData[i] ||= {})[j] = asCell(f.v)
        if (i < 1000) widest[j] = Math.max(widest[j] || 0, Math.min(48, f.v.length))
      })
    })
    // Each column wide enough for what's in it (a CSV has no widths of its own; none are saved).
    widest.forEach((n, j) => { if (n > 11) sh.columnData[j] = { w: Math.round(n * 7.2 + 14) } })
    sh.rowCount = Math.max(100, csv.rows.length + 50)
    sh.columnCount = Math.max(26, cols + 10)
    return { kind: 'csv', data: w.data, lost: [], charts: [], csv, base: JSON.stringify(w.data.sheets) }
  }
  const r = await legacyRead(bytes, name)
  return { kind: 'xlsx', data: withLookalikes(r.data), lost: r.lost, charts: [], keep: null, original: bytes }
}

// ---------- Writing ----------
// Back to the file's own kind: { bytes, notKept }. A CSV keeps its first sheet's values (a
// formula as its result), in its own separator, encoding and line endings. as: a CSV's separator
// and encoding picked to save it in.
export async function writeSheet(book, now, { ops = [], charts = [], as = {} } = {}) {
  if (book.kind === 'csv') {
    const sh = now.sheets[now.sheetOrder[0]]
    const rows = Object.keys(sh.cellData || {}).map(Number).filter((r) => Object.values(sh.cellData[r] || {}).some((c) => c && (c.v != null && c.v !== '')))
    const last = Math.max(rows.length ? Math.max(...rows) : -1, book.csv.rows.length - 1)
    const lines = []
    for (let r = 0; r <= last; r++) {
      const cells = sh.cellData?.[r] || {}
      const cols = Object.keys(cells).map(Number).filter((c) => cells[c]?.v != null && cells[c].v !== '')
      const end = cols.length ? Math.max(...cols) : -1
      lines.push(Array.from({ length: end + 1 }, (_, c) => textOf(cells[c])))
    }
    const out = writeCsv(book.csv, lines, as)
    const notKept = []
    if (now.sheetOrder.length > 1) notKept.push(`the other ${now.sheetOrder.length - 1 === 1 ? 'sheet' : `${now.sheetOrder.length - 1} sheets`} (a ${book.csv.sep === '\t' ? 'TSV' : 'CSV'} file is one sheet)`)
    if (!writesBack(as.enc || book.csv.enc)) notKept.push(`its ${as.enc || book.csv.enc} encoding (saved as UTF-8)`)
    if (!out.fits) notKept.push('characters Windows-1252 has no place for (saved as ?)')
    return { bytes: out.bytes, notKept }
  }
  return { bytes: await bytesOf(now, '.xlsx'), notKept: [] }
}
// A cell as a CSV has it: its value (a formula's result), true and false as Excel writes them.
function textOf(cell) {
  if (!cell || cell.v == null) return ''
  if (cell.t === 3) return cell.v ? 'TRUE' : 'FALSE'
  return String(cell.v)
}
export const separatorName = (sep) => SEPARATORS[sep] || sep

// ---------- Excel files, through ExcelJS (until the engine replaces it) ----------
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
async function legacyRead(buf, name) {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const styles = {}
  const sheets = {}
  const order = []
  const kinds = new Set()
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
  return { data: { id: id('w'), name, appVersion: '', locale: 'enUS', styles, sheetOrder: order, sheets, defaultStyle: { ff: 'Calibri', fs: 11 } }, lost: [...kinds] }
}
export async function bytesOf(data) {
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
