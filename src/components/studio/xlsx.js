// A sheet's file to the workbook Univer shows, and back to the same kind of file. A CSV or TSV is
// one sheet of values, read and written back as it's written (csv.js). An Excel file is read and
// written by xlsxbook.js: written back into itself, so what wasn't changed here (charts,
// pictures, pivot tables, comments, macros, its own XML) stays exactly as it was.
import { readCsv, writeCsv, writesBack, asCell, textOf } from './csv.js'
import { t, tx } from '../../i18n/index.js'

const isCsv = (ext) => ext === '.csv' || ext === '.tsv'
const loadBook = () => import('./xlsxbook.js')

let n = 0
const id = (p) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`

export function blankWorkbook(name = 'Sheet') {
  const sid = id('s')
  return { data: { id: id('w'), name, appVersion: '', locale: 'enUS', styles: {}, sheetOrder: [sid], sheets: { [sid]: { id: sid, name: 'Sheet1', rowCount: 100, columnCount: 26, cellData: {}, mergeData: [], columnData: {}, rowData: {}, defaultColumnWidth: 88, defaultRowHeight: 24 } } }, lost: [] }
}

// What a file has that isn't shown here, in words, translated.
const KINDS = {
  macros: tx('macros'), slicers: tx('slicers'), 'links to other workbooks': tx('links to other workbooks'), 'data connections': tx('data connections'),
  'chart sheets': tx('chart sheets'), 'macro or dialog sheets': tx('macro or dialog sheets'), 'some filters': tx('some filters'),
  'some conditional formats': tx('some conditional formats'), 'threaded comments': tx('threaded comments'), pictures: tx('pictures'),
  shapes: tx('shapes'), charts: tx('charts'), tables: tx('tables'), 'pivot tables': tx('pivot tables'), sparklines: tx('sparklines'),
  'form controls': tx('form controls'), comments: tx('comments'),
}
export const kindWords = (k) => (KINDS[k] ? t(KINDS[k]) : k)

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
    // A number's format once for every cell written that way (1,200.50, 15%, a date).
    const styleOf = {}
    const named = (s) => { const k = s.n.pattern; if (!styleOf[k]) { styleOf[k] = `n${Object.keys(styleOf).length}`; w.data.styles[styleOf[k]] = s } return styleOf[k] }
    csv.rows.forEach((r, i) => {
      cols = Math.max(cols, r.length)
      r.forEach((f, j) => {
        if (f.v === '') return
        const cell = asCell(f.v)
        if (cell.s) cell.s = named(cell.s)
        ;(sh.cellData[i] ||= {})[j] = cell
        if (i < 1000) widest[j] = Math.max(widest[j] || 0, Math.min(48, f.v.length))
      })
    })
    // Each column wide enough for what's in it (a CSV has no widths of its own; none are saved).
    widest.forEach((w2, j) => { const w = Math.round(w2 * 7.2 + 16); if (w > 88) sh.columnData[j] = { w } })
    sh.rowCount = Math.max(100, csv.rows.length + 50)
    sh.columnCount = Math.max(26, cols + 10)
    return { kind: 'csv', data: w.data, lost: [], charts: [], csv }
  }
  const { readBook } = await loadBook()
  const r = await readBook(bytes, name)
  // Its charts are drawn in Charts, so they aren't among what isn't shown.
  const lost = r.lost.filter((k) => !(k === 'charts' && r.charts?.length))
  return { kind: 'xlsx', data: r.data, lost, charts: r.charts || [], keep: r.keep, original: bytes }
}

// ---------- Writing ----------
// Back to the file's own kind: { bytes, notKept (in words, said before it's saved) }. A CSV keeps
// its first sheet's values (a formula as its result) in its own separator, encoding and line
// endings; an Excel file everything, unless a change can't be kept, which the writer says.
export async function writeSheet(book, now, { ops = [], charts = [] } = {}) {
  if (book.kind === 'csv') {
    const sh = now.sheets[now.sheetOrder[0]]
    const filled = (c) => c && c.v != null && c.v !== ''
    const rows = Object.keys(sh.cellData || {}).map(Number).filter((r) => Object.values(sh.cellData[r] || {}).some(filled))
    const last = Math.max(rows.length ? Math.max(...rows) : -1, book.csv.rows.length - 1)
    const lines = []
    for (let r = 0; r <= last; r++) {
      const cells = sh.cellData?.[r] || {}
      const cols = Object.keys(cells).map(Number).filter((c) => filled(cells[c]))
      const end = cols.length ? Math.max(...cols) : -1
      lines.push(Array.from({ length: end + 1 }, (_, c) => textOf(cells[c], now.styles)))
    }
    const out = writeCsv(book.csv, lines)
    const kind = book.csv.sep === '\t' ? 'TSV' : 'CSV'
    const notKept = []
    if (now.sheetOrder.length > 1) notKept.push(t('the other sheets (a {kind} file is one sheet)', { kind }))
    if (!writesBack(book.csv.enc)) notKept.push(t('its encoding, {enc} (it\'s saved as UTF-8)', { enc: book.csv.enc }))
    if (!out.fits) notKept.push(t('letters Windows-1252 has no place for (each is saved as ?)'))
    return { bytes: out.bytes, notKept }
  }
  const { writeBook } = await loadBook()
  const r = await writeBook(book.original, book.keep, now, { ops, charts })
  return { bytes: r.bytes, notKept: r.notKept.map(sayWhy) }
}
// The writer's reasons, in the app's language: "{what} on {sheet}" and the rest as they are.
const WHY = {
  'a checkbox, which Excel keeps as a list of two values': tx('a checkbox, which Excel keeps as a list of two values'),
  'a conditional format comparing with the average in a way Excel has no form of': tx('a conditional format comparing with the average in a way Excel has no form of'),
  'a conditional format of a kind Excel has no form of': tx('a conditional format of a kind Excel has no form of'),
  'a conditional format with a rule Excel has no form of': tx('a conditional format with a rule Excel has no form of'),
  'a validation rule Excel has no form of': tx('a validation rule Excel has no form of'),
  'formats, as the file had no styles to add them to': tx('formats, as the file had no styles to add them to'),
  'icons in a conditional format in an order Excel has no form of': tx('icons in a conditional format in an order Excel has no form of'),
  'icons in a conditional format that Excel has no set of': tx('icons in a conditional format that Excel has no set of'),
}
const WHY_ON = [
  [/^threaded comments on (.+) are kept as Excel had them, not as changed here$/, tx('the threaded comments on {a}, which are kept as Excel had them, not as changed here')],
  [/^the pivot table on (.+), deleted with it$/, tx('the pivot table on {a}, deleted with it')],
  [/^the table (.*) on (.+) \(columns were added or removed inside it\)$/, tx('the table {a} on {b} (columns were added or removed inside it)')],
  [/^a chart that drew from (.+)$/, tx('a chart that drew from {a}')],
  [/^a pivot table whose data was on (.+)$/, tx('a pivot table whose data was on {a}')],
  [/^the new chart(?: "(.*)")? \(its sheet or range wasn't found\)$/, tx('the new chart {a} (its sheet or range wasn\'t found)')],
]
function sayWhy(m) {
  if (WHY[m]) return t(WHY[m])
  const on = /^(.*) on ([^,]+)$/.exec(m)
  if (on && WHY[on[1]]) return t('{what} on {sheet}', { what: t(WHY[on[1]]), sheet: on[2] })
  for (const [re, say] of WHY_ON) { const x = re.exec(m); if (x) return t(say, { a: x[1] || '', b: x[2] || '' }).replace(/ {2,}/g, ' ') }
  return m
}

// A new Excel file (Studio's New › Sheet): an empty workbook, with what's given written in.
export async function bytesOf(data) {
  const { newBook, readBook, writeBook } = await loadBook()
  const blank = await newBook()
  const r = await readBook(blank, 'Sheet')
  const first = r.data.sheetOrder[0]
  const mine = data.sheets[data.sheetOrder[0]]
  const now = { ...r.data, sheets: { [first]: { ...r.data.sheets[first], cellData: mine.cellData || {} } } }
  return (await writeBook(blank, r.keep, now)).bytes
}
