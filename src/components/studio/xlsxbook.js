// The Excel engine behind Studio's sheets. readBook turns an .xlsx file into the workbook Univer
// shows; writeBook patches the file itself with what changed, so everything Studio doesn't show or
// change (charts, pivot tables, pictures, macros, page setup, parts newer than this code) stays
// exactly as it was, byte for byte. Only what changed is rewritten: an edited cell (a new style is
// derived from the one it had, so its borders and protection survive), a sheet's merges, sizes,
// freeze, filter, conditional formats, validation, links and notes, and the workbook's sheets.
// Rows and columns added, removed or moved shift what points at them (pictures and charts, notes,
// names, tables). What can't be kept exactly is said (notKept), never dropped quietly.
// Plain JS with JSZip and string matching, so it runs in the page and in Node (the tests).
import JSZip from 'jszip'

// ---------- XML ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unx = (s) => (s && s.includes('&') ? s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m)) : s ?? '')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// Excel writes characters XML can't hold as _xHHHH_; read them back, and write them so.
const unxl = (s) => (s.includes('_x') ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16))) : s)
const escText = (s) => esc(String(s).replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\uFFFE\uFFFF]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`))
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The attributes of an opening tag.
function attrs(tag) {
  const o = {}
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(tag))) o[m[1]] = unx(m[2] ?? m[3])
  return o
}
// An opening tag with one attribute set (or taken off, for null).
function setAttr(tag, name, value) {
  const re = new RegExp(`\\s${reEsc(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`)
  if (value == null) return tag.replace(re, '')
  const a = ` ${name}="${esc(value)}"`
  return re.test(tag) ? tag.replace(re, a) : tag.replace(/\s*(\/?>)$/, `${a}$1`)
}
// Where an element that opened at `from` (just after its tag) closes, counting ones of the same
// name inside it.
function closeOf(xml, qname, from) {
  const re = new RegExp(`<(/?)${reEsc(qname)}(?=[\\s/>])[^>]*?(/?)>`, 'g')
  re.lastIndex = from
  let depth = 1, m
  while ((m = re.exec(xml))) {
    if (m[1]) { if (--depth === 0) return { k: m.index, j: re.lastIndex } } else if (!m[2]) depth++
  }
  return null
}
// Every element named `name` (with any prefix) in xml, each with its tag, inside and whole text.
function each(xml, name, from = 0, to = xml.length, max = Infinity) {
  const out = []
  const re = new RegExp(`<((?:[\\w.-]+:)?${reEsc(name)})(?=[\\s/>])[^>]*>`, 'g')
  re.lastIndex = from
  let m
  while (out.length < max && (m = re.exec(xml)) && m.index < to) {
    const open = m[0]
    if (open.endsWith('/>')) { out.push({ i: m.index, j: m.index + open.length, open, inner: '', xml: open }); continue }
    const c = closeOf(xml, m[1], re.lastIndex)
    if (!c) break
    out.push({ i: m.index, j: c.j, open, inner: xml.slice(re.lastIndex, c.k), xml: xml.slice(m.index, c.j) })
    re.lastIndex = c.j
  }
  return out
}
const one = (xml, name, from, to) => each(xml, name, from, to, 1)[0] || null
// The text of an element's <t> runs, leaving out phonetic guides (<rPh>), which Excel doesn't show.
const textOf = (inner) => unxl(each(inner.replace(/<(\w+:)?rPh[\s>][\s\S]*?<\/(\w+:)?rPh>/g, ''), 't').map((t) => unx(t.inner)).join(''))

// A part's root element and the elements right under it, in order, so one can be swapped, added or
// dropped and the rest written back exactly as they were.
function split(xml) {
  // past the declaration and any comments, to the root
  const r = /<(?:\?[\s\S]*?\?>|!--[\s\S]*?-->|([\w.-]+:)?([\w.-]+)[^>]*>)/g
  let root
  while ((root = r.exec(xml)) && !root[2]);
  const pre = root[1] || ''
  const close = xml.lastIndexOf(`</${pre}${root[2]}`)
  const head = xml.slice(0, r.lastIndex)
  const tail = xml.slice(close)
  const items = []
  let i = r.lastIndex
  while (i < close) {
    const lt = xml.indexOf('<', i)
    if (lt < 0 || lt >= close) break
    const ws = xml.slice(i, lt)
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt) + 3; items.push({ name: '#comment', pre: ws, xml: xml.slice(lt, e) }); i = e; continue }
    const t = /<([\w.-]+:)?([\w.-]+)[^>]*?(\/?)>/y
    t.lastIndex = lt
    const m = t.exec(xml)
    let e = t.lastIndex
    if (!m[3]) e = closeOf(xml, `${m[1] || ''}${m[2]}`, t.lastIndex).j
    items.push({ name: m[2], pre: ws, xml: xml.slice(lt, e) })
    i = e
  }
  return { head, items, end: xml.slice(i, close), tail, prefix: pre }
}
const joinParts = (s) => s.head + s.items.map((x) => x.pre + x.xml).join('') + s.end + s.tail
// Put an element in its place by the schema's order (the names in `order`), replacing any there.
function place(s, name, xml, order) {
  const at = s.items.findIndex((x) => x.name === name)
  if (xml == null) { if (at >= 0) s.items.splice(at, 1); return }
  if (at >= 0) { s.items[at] = { ...s.items[at], xml }; return }
  const rank = order.indexOf(name)
  let k = s.items.length
  let last = -1
  for (let n = 0; n < s.items.length; n++) {
    const r = order.indexOf(s.items[n].name)
    const eff = r < 0 ? last : r
    if (r >= 0) last = r
    if (eff > rank) { k = n; break }
  }
  s.items.splice(k, 0, { name, pre: '', xml })
}
const WS_ORDER = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst']
const WB_ORDER = ['fileVersion', 'fileSharing', 'workbookPr', 'workbookProtection', 'bookViews', 'sheets', 'functionGroups', 'externalReferences', 'definedNames', 'calcPr', 'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']
const ST_ORDER = ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles', 'colors', 'extLst']
// Well formed: every tag closes in order (for the tests, and to refuse to write a broken part).
export function wellFormed(xml) {
  const stack = []
  const re = /<(\/?)([\w.:-]+)[^>]*?(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g
  let m
  while ((m = re.exec(xml))) {
    if (!m[2]) continue
    if (m[1]) { if (stack.pop() !== m[2]) return false } else if (!m[3]) stack.push(m[2])
  }
  return stack.length === 0
}

// ---------- References: A1, columns, ranges ----------
const MAX_ROW = 1048576, MAX_COL = 16384
export const colName = (c) => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const colNum = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
const a1 = (r, c) => `${colName(c)}${r + 1}`
const cellAt = (ref) => { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref); return m ? { r: Number(m[2]) - 1, c: colNum(m[1]) } : null }
// "A1:C3", "B2", "A:C", "2:5" to a Univer range (0-based, inclusive).
function rangeOf(ref) {
  const [x, y = x] = String(ref).replace(/\$/g, '').split(':')
  const p = cellAt(x), q = cellAt(y)
  if (p && q) return { startRow: Math.min(p.r, q.r), endRow: Math.max(p.r, q.r), startColumn: Math.min(p.c, q.c), endColumn: Math.max(p.c, q.c) }
  if (/^[A-Za-z]{1,3}$/.test(x) && /^[A-Za-z]{1,3}$/.test(y)) return { startRow: 0, endRow: MAX_ROW - 1, startColumn: colNum(x), endColumn: colNum(y), rangeType: 2 }
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return { startRow: Number(x) - 1, endRow: Number(y) - 1, startColumn: 0, endColumn: MAX_COL - 1, rangeType: 1 }
  return null
}
const refOf = (g) => {
  if (g.startRow === 0 && g.endRow >= MAX_ROW - 1) return `${colName(g.startColumn)}:${colName(g.endColumn)}`
  if (g.startColumn === 0 && g.endColumn >= MAX_COL - 1) return `${g.startRow + 1}:${g.endRow + 1}`
  const p = a1(g.startRow, g.startColumn), q = a1(g.endRow, g.endColumn)
  return p === q ? p : `${p}:${q}`
}
const rangesOf = (sqref) => String(sqref || '').trim().split(/\s+/).filter(Boolean).map(rangeOf).filter(Boolean)
const sqrefOf = (ranges) => ranges.map(refOf).join(' ')
const quoteSheet = (n) => (/^[A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) && !/^(R|C|RC)(\d+)?$/i.test(n) ? n : `'${n.replace(/'/g, "''")}'`)
const unquote = (s) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s)

// Every cell reference in a formula (outside "strings"), handed to fn({ sheet, kind, ... }) which
// gives back its new text, or undefined to leave it. kind: cell (r, c, ar, ac: absolute row/col),
// range (two cells), cols, rows. External refs ([1]Sheet!A1) and structured refs are left alone.
const REF_AT = /(?:('(?:[^']|'')+'|[A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*)!)?(?:(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?|(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})|(\$?)(\d+):(\$?)(\d+))(?![\w(!.[\u00C0-\uFFFF])/y
export function mapRefs(f, fn) {
  let out = '', i = 0
  const s = String(f)
  while (i < s.length) {
    const ch = s[i]
    if (ch === '"') { let j = i + 1; while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue } break } j++ } out += s.slice(i, j + 1); i = j + 1; continue }
    const prev = i ? s[i - 1] : ''
    if (!/[\w.$\]'!:\u00C0-\uFFFF]/.test(prev)) {
      REF_AT.lastIndex = i
      const m = REF_AT.exec(s)
      if (m) {
        const sheet = m[1] != null ? unquote(m[1]) : null
        let ref = null
        if (m[3]) {
          const p = { r: Number(m[5]) - 1, c: colNum(m[3]), ar: !!m[4], ac: !!m[2] }
          if (p.r < MAX_ROW && p.c < MAX_COL) ref = m[7] ? { kind: 'range', a: p, b: { r: Number(m[9]) - 1, c: colNum(m[7]), ar: !!m[8], ac: !!m[6] } } : { kind: 'cell', a: p }
          if (ref?.b && (ref.b.r >= MAX_ROW || ref.b.c >= MAX_COL)) ref = null
        } else if (m[11]) ref = { kind: 'cols', a: { c: colNum(m[11]), ac: !!m[10] }, b: { c: colNum(m[13]), ac: !!m[12] } }
        else if (m[15]) ref = { kind: 'rows', a: { r: Number(m[15]) - 1, ar: !!m[14] }, b: { r: Number(m[17]) - 1, ar: !!m[16] } }
        if (ref) {
          const got = fn({ sheet, prefix: m[1] != null ? `${m[1]}!` : '', ...ref })
          out += got === undefined ? m[0] : got
          i = REF_AT.lastIndex
          continue
        }
      }
    }
    if (ch === "'") {
      // a quoted name that isn't a sheet reference: copy it whole
      let j = i + 1; while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue } break } j++ }
      out += s.slice(i, j + 1); i = j + 1; continue
    }
    out += ch
    i++
  }
  return out
}
const pt = (p) => `${p.ac ? '$' : ''}${colName(p.c)}${p.ar ? '$' : ''}${p.r + 1}`
const refText = (ref) => (ref.kind === 'cell' ? pt(ref.a) : ref.kind === 'range' ? `${pt(ref.a)}:${pt(ref.b)}` : ref.kind === 'cols' ? `${ref.a.ac ? '$' : ''}${colName(ref.a.c)}:${ref.b.ac ? '$' : ''}${colName(ref.b.c)}` : `${ref.a.ar ? '$' : ''}${ref.a.r + 1}:${ref.b.ar ? '$' : ''}${ref.b.r + 1}`)
// A formula moved by (dr, dc), as a shared formula's other cells read it: relative parts move.
export function moveFormula(f, dr, dc) {
  if (!dr && !dc) return f
  return mapRefs(f, (ref) => {
    const mv = (p) => ({ ...p, r: p.r == null ? p.r : p.ar ? p.r : p.r + dr, c: p.c == null ? p.c : p.ac ? p.c : p.c + dc })
    const n = { ...ref, a: mv(ref.a), b: ref.b && mv(ref.b) }
    const bad = (p) => p && ((p.r != null && (p.r < 0 || p.r >= MAX_ROW)) || (p.c != null && (p.c < 0 || p.c >= MAX_COL)))
    return ref.prefix + (bad(n.a) || bad(n.b) ? '#REF!' : refText(n))
  })
}

// ---------- Rows and columns added, removed, moved ----------
// One structural edit as a function on an index (rows or columns): the new index, or null when it
// was removed.
function stepOf(op) {
  const { start = 0, count = 0, from = 0, to = 0 } = op
  if (/^insert/.test(op.op)) return (i) => (i >= start ? i + count : i)
  if (/^remove/.test(op.op)) return (i) => (i < start ? i : i >= start + count ? i - count : null)
  if (/^move/.test(op.op)) {
    return (i) => {
      if (to > from) { if (i >= from && i < from + count) return i + (to - from - count); if (i >= from + count && i < to) return i - count; return i }
      if (to < from) { if (i >= from && i < from + count) return i - (from - to); if (i >= to && i < from) return i + count; return i }
      return i
    }
  }
  return (i) => i
}
// The ops on one sheet along one axis, composed.
function axisMap(ops, sheet, axis) {
  const mine = ops.filter((o) => o.sheet === sheet && (axis === 'row' ? /-rows$/.test(o.op) : /-cols$/.test(o.op))).map(stepOf)
  if (!mine.length) return null
  return (i) => { let x = i; for (const f of mine) { if (x == null) return null; x = f(x) } return x }
}
// A range through a map: each end moved; a range whose cells all went is gone (null). Inserting at
// a range's first row moves it; inside it, the range grows, as in Excel.
function mapSpan(a, b, map, kind) {
  if (!map) return [a, b]
  if (kind === 'move') {
    const x = map(a), y = map(b)
    return x <= y ? [x, y] : [a, b]
  }
  let x = map(a), y = map(b)
  if (x == null) { let k = a; while (k <= b && map(k) == null) k++; if (k > b) return null; x = map(k) }
  if (y == null) { let k = b; while (k >= a && map(k) == null) k--; if (k < a) return null; y = map(k) }
  return [x, y]
}
// The references in a formula on sheet `here` (null: it names its sheets) to sheet `name`, moved by
// the ops on that sheet; one into what was removed becomes #REF!, as Excel does.
function shiftFormula(f, ops, sheetId, name, here) {
  const rows = axisMap(ops, sheetId, 'row'), cols = axisMap(ops, sheetId, 'col')
  if (!rows && !cols) return f
  const move = ops.some((o) => o.sheet === sheetId && /^move/.test(o.op))
  return mapRefs(f, (ref) => {
    const target = ref.sheet != null ? ref.sheet : here
    if (target == null || target.toLowerCase() !== name.toLowerCase()) return undefined
    const n = { ...ref, a: { ...ref.a }, b: ref.b && { ...ref.b } }
    if (ref.kind === 'cell') {
      const r = rows && n.a.r != null ? rows(n.a.r) : n.a.r, c = cols && n.a.c != null ? cols(n.a.c) : n.a.c
      if (r == null || c == null) return `${ref.prefix}#REF!`
      n.a.r = r; n.a.c = c
    } else {
      if (rows && ref.kind !== 'cols') { const s = mapSpan(n.a.r, n.b.r, rows, move ? 'move' : ''); if (!s) return `${ref.prefix}#REF!`; [n.a.r, n.b.r] = s }
      if (cols && ref.kind !== 'rows') { const s = mapSpan(n.a.c, n.b.c, cols, move ? 'move' : ''); if (!s) return `${ref.prefix}#REF!`; [n.a.c, n.b.c] = s }
    }
    return ref.prefix + refText(n)
  })
}
// A sheet's name changed in what names it.
function renameIn(f, from, to) {
  return mapRefs(f, (ref) => (ref.sheet != null && ref.sheet.toLowerCase() === from.toLowerCase() ? `${quoteSheet(to)}!${refText(ref)}` : undefined))
}
// A plain range ("A1:B5", for sqref and the like) through the ops: null when it's gone.
function shiftRange(g, rows, cols, move) {
  const out = { ...g }
  if (rows && g.rangeType !== 2) { const s = mapSpan(g.startRow, g.endRow, rows, move ? 'move' : ''); if (!s) return null; [out.startRow, out.endRow] = s }
  if (cols && g.rangeType !== 1) { const s = mapSpan(g.startColumn, g.endColumn, cols, move ? 'move' : ''); if (!s) return null; [out.startColumn, out.endColumn] = s }
  return out
}
const shiftSqref = (sqref, rows, cols, move) => sqrefOf(rangesOf(sqref).map((g) => shiftRange(g, rows, cols, move)).filter(Boolean))

// ---------- Colours ----------
// Excel's 64 indexed colours (a file can give its own in <colors>).
const PALETTE = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333']
// The theme's colours in the order Excel numbers them (light 1 and dark 1 swapped from the file's).
function themeColours(xml) {
  const scheme = one(xml || '', 'clrScheme')
  if (!scheme) return []
  const pick = (name) => { const e = one(scheme.inner, name); if (!e) return null; const c = /(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"/.exec(e.inner); return c ? c[1].toUpperCase() : null }
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(pick)
}
function tinted(hex, tint) {
  if (!tint) return hex
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
  if (!s) r = g = b = l
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3) }
  return [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}
// A colour element (<color rgb|theme|indexed tint>) to #rrggbb, or null for automatic.
function colourOf(tag, ctx) {
  if (!tag) return null
  const a = attrs(tag)
  let hex = null
  if (a.rgb) hex = a.rgb.length === 8 ? a.rgb.slice(2) : a.rgb
  else if (a.theme != null) hex = ctx.theme[Number(a.theme)] || null
  else if (a.indexed != null) { const i = Number(a.indexed); hex = i >= 64 ? null : ctx.palette[i] || null }
  if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return null
  return `#${tinted(hex.toUpperCase(), Number(a.tint) || 0).toLowerCase()}`
}
// Colours as Univer gives them (#abc, #aabbcc, rgb(...)) to #rrggbb.
function hexOf(c) {
  if (!c) return null
  const s = String(c).trim().toLowerCase()
  let m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s)
  if (m) return `#${m[1]}`
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s)
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}`
  return null
}
const argb = (c) => `FF${(hexOf(c) || '#000000').slice(1).toUpperCase()}`

// ---------- Number formats ----------
const BUILTIN = { 0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@' }
const BUILTIN_ID = Object.fromEntries(Object.entries(BUILTIN).map(([k, v]) => [v, Number(k)]))

// ---------- Styles ----------
const BORDER = ['none', 'thin', 'hair', 'dotted', 'dashed', 'dashDot', 'dashDotDot', 'double', 'medium', 'mediumDashed', 'mediumDashDot', 'mediumDashDotDot', 'slantDashDot', 'thick']
const H_ALIGN = { left: 1, center: 2, right: 3, justify: 4, distributed: 6, centerContinuous: 2, fill: 1 }
const H_BACK = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'justify', 6: 'distributed' }
const V_ALIGN = { top: 1, center: 2, bottom: 3, justify: 2, distributed: 2 }
const V_BACK = { 1: 'top', 2: 'center', 3: 'bottom' }
const INDENT_PX = 9 // one step of Excel's indent, about three spaces

// The children of a styles.xml list (<fonts>, <cellXfs>...), each as written.
const listOf = (xml, list, item) => { const l = one(xml, list); return l ? each(l.inner, item).map((e) => e.xml) : [] }
function parseStyles(xml, theme) {
  const numFmts = new Map()
  for (const e of each(one(xml, 'numFmts')?.inner || '', 'numFmt')) { const a = attrs(e.open); numFmts.set(Number(a.numFmtId), a.formatCode) }
  const custom = one(xml, 'indexedColors')
  const palette = custom ? each(custom.inner, 'rgbColor').map((e) => (attrs(e.open).rgb || 'FF000000').slice(-6)) : PALETTE
  return { xml, numFmts, fonts: listOf(xml, 'fonts', 'font'), fills: listOf(xml, 'fills', 'fill'), borders: listOf(xml, 'borders', 'border'), xfs: listOf(xml, 'cellXfs', 'xf'), dxfs: listOf(xml, 'dxfs', 'dxf'), theme, palette }
}
// A <font> (or a dxf's font, or a rich run's <rPr>) as Univer's style.
function fontStyle(xml, ctx, s = {}) {
  if (!xml) return s
  const v = (name) => { const e = one(xml, name); return e ? attrs(e.open) : null }
  const on = (name) => { const a = v(name); return !!a && a.val !== '0' && a.val !== 'false' }
  const name = v('name') || v('rFont')
  if (name?.val) s.ff = name.val
  const sz = v('sz')
  if (sz?.val) s.fs = Number(sz.val)
  if (on('b')) s.bl = 1
  if (on('i')) s.it = 1
  const u = v('u')
  if (u && u.val !== 'none') s.ul = u.val === 'double' || u.val === 'doubleAccounting' ? { s: 1, t: 10 } : { s: 1 }
  if (on('strike')) s.st = { s: 1 }
  const va = v('vertAlign')?.val
  if (va === 'superscript') s.va = 3
  else if (va === 'subscript') s.va = 2
  const c = colourOf(one(xml, 'color')?.open, ctx)
  if (c) s.cl = { rgb: c }
  return s
}
function fillStyle(xml, ctx, dxf = false) {
  const p = one(xml || '', 'patternFill')
  if (!p) {
    // a gradient: its first stop's colour, as near as a cell's fill gets
    const stop = one(xml || '', 'stop')
    const c = stop && colourOf(one(stop.inner, 'color')?.open, ctx)
    return c ? { rgb: c } : null
  }
  const type = attrs(p.open).patternType
  if (!dxf && (!type || type === 'none')) return null
  // a solid fill's colour is its foreground; a dxf's its background (Excel writes both ways)
  const fg = colourOf(one(p.inner, 'fgColor')?.open, ctx), bg = colourOf(one(p.inner, 'bgColor')?.open, ctx)
  const c = dxf ? bg || fg : fg || bg
  return c ? { rgb: c } : null
}
function borderStyle(xml, ctx) {
  if (!xml) return null
  const bd = {}
  const edge = (name) => {
    const e = one(xml, name)
    if (!e) return null
    const st = BORDER.indexOf(attrs(e.open).style || 'none')
    if (st <= 0) return null
    return { s: st, cl: { rgb: colourOf(one(e.inner, 'color')?.open, ctx) || '#000000' } }
  }
  for (const [k, name, alt] of [['l', 'left', 'start'], ['r', 'right', 'end'], ['t', 'top'], ['b', 'bottom']]) { const x = edge(name) || (alt && edge(alt)); if (x) bd[k] = x }
  const a = attrs(/<(\w+:)?border\b[^>]*>/.exec(xml)?.[0] || '')
  const diag = edge('diagonal')
  if (diag && (a.diagonalDown === '1' || a.diagonalDown === 'true')) bd.tl_br = diag
  if (diag && (a.diagonalUp === '1' || a.diagonalUp === 'true')) bd.bl_tr = diag
  return Object.keys(bd).length ? bd : null
}
function alignStyle(tag, s = {}) {
  if (!tag) return s
  const a = attrs(tag)
  if (H_ALIGN[a.horizontal]) s.ht = H_ALIGN[a.horizontal]
  if (V_ALIGN[a.vertical]) s.vt = V_ALIGN[a.vertical]
  if (a.wrapText === '1' || a.wrapText === 'true') s.tb = 3
  const rot = Number(a.textRotation) || 0
  if (rot === 255) s.tr = { a: 0, v: 1 }
  else if (rot) s.tr = { a: rot <= 90 ? rot : -(rot - 90) }
  if (Number(a.indent) > 0) s.pd = { l: Number(a.indent) * INDENT_PX }
  return s
}
const fmtOf = (id, st) => (st.numFmts.has(id) ? st.numFmts.get(id) : BUILTIN[id])
const xfAttrs = (x) => attrs(/^<[^>]*>/.exec(x)[0])
// One cell format (an xf of cellXfs) as Univer's style.
function xfStyle(st, i, ctx) {
  const x = st.xfs[i]
  if (!x) return null
  const a = xfAttrs(x)
  const s = fontStyle(st.fonts[Number(a.fontId) || 0], ctx)
  const bg = fillStyle(st.fills[Number(a.fillId) || 0], ctx)
  if (bg) s.bg = bg
  const bd = borderStyle(st.borders[Number(a.borderId) || 0], ctx)
  if (bd) s.bd = bd
  const code = fmtOf(Number(a.numFmtId) || 0, st)
  if (code && code !== 'General') s.n = { pattern: code }
  alignStyle(one(x, 'alignment')?.open, s)
  return s
}
function dxfStyle(xml, ctx) {
  const f = one(xml, 'font')
  const s = fontStyle(f ? f.xml : '', ctx)
  delete s.ff
  delete s.fs
  const bg = fillStyle(one(xml, 'fill')?.xml, ctx, true)
  if (bg) s.bg = bg
  const bd = borderStyle(one(xml, 'border')?.xml, ctx)
  if (bd) s.bd = bd
  const nf = one(xml, 'numFmt')
  if (nf) s.n = { pattern: attrs(nf.open).formatCode }
  return s
}

// A style made comparable: what doesn't show (off, empty, General) left out, colours one way, keys
// in order. Two cells whose styles compare equal look the same.
function normStyle(s) {
  if (!s || typeof s !== 'object') return null
  const o = {}
  const off = (d) => !d || !d.s
  for (const k of Object.keys(s).sort()) {
    const v = s[k]
    if (v == null || v === '') continue
    if ((k === 'bl' || k === 'it' || k === 'stf') && !v) continue
    if ((k === 'ul' || k === 'st' || k === 'ol' || k === 'bbl') && off(v)) continue
    if ((k === 'ht' || k === 'vt' || k === 'tb' || k === 'td') && !v) continue
    if (k === 'va' && (!v || v === 1)) continue
    if (k === 'cl' || k === 'bg') { const c = hexOf(v?.rgb); if (c) o[k] = { rgb: c }; continue }
    if (k === 'n') { if (v?.pattern && v.pattern !== 'General') o.n = { pattern: v.pattern }; continue }
    if (k === 'tr') { if (v && (v.a || v.v)) o.tr = v.v ? { a: 0, v: 1 } : { a: v.a }; continue }
    if (k === 'pd') { if (v?.l) o.pd = { l: v.l }; continue }
    if (k === 'bd') {
      const b = {}
      for (const e of Object.keys(v || {}).sort()) { const x = v[e]; if (x && x.s) b[e] = { s: x.s, cl: { rgb: hexOf(x.cl?.rgb) || '#000000' } } }
      if (Object.keys(b).length) o.bd = b
      continue
    }
    if (k === 'ul' || k === 'st') { o[k] = v.t === 10 ? { s: 1, t: 10 } : { s: 1 }; continue }
    if (typeof v === 'object') { const n = JSON.parse(JSON.stringify(v)); if (Object.keys(n).length) o[k] = n; continue }
    o[k] = v
  }
  return Object.keys(o).length ? o : null
}
const styleIn = (data, s) => normStyle(typeof s === 'string' ? data.styles?.[s] : s)

// ---------- The package ----------
const relType = (t) => String(t || '').slice(String(t || '').lastIndexOf('/'))
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1)
const relsPathOf = (p) => `${dirOf(p)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1)
  const out = []
  for (const x of (dirOf(base) + target).split('/')) { if (x === '..') out.pop(); else if (x !== '.') out.push(x) }
  return out.join('/')
}
// A part's path as a relationship from `base` names it.
function relTarget(base, path) {
  const from = dirOf(base).split('/').filter(Boolean), to = path.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')
}
const text = async (zip, path) => { const f = path && zip.file(path); return f ? f.async('string') : null }
function parseRels(xml, base) {
  return each(xml || '', 'Relationship').map((e) => {
    const a = attrs(e.open)
    const external = a.TargetMode === 'External'
    return { id: a.Id, type: relType(a.Type), Type: a.Type, target: a.Target, external, path: external ? null : resolve(base, a.Target || ''), xml: e.xml }
  })
}
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const relsXml = (rels) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => r.xml).join('')}</Relationships>`
const relXml = (id, type, target, external) => `<Relationship Id="${esc(id)}" Type="${esc(type)}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`
const nextRelId = (rels) => { let n = rels.length + 1; const have = new Set(rels.map((r) => r.id)); while (have.has(`rId${n}`)) n++; return `rId${n}` }
// The prefix a root binds to the relationships namespace (usually r).
const rPrefix = (head) => /xmlns:([\w.-]+)="http:\/\/(?:schemas\.openxmlformats\.org\/officeDocument\/2006|purl\.oclc\.org\/ooxml\/officeDocument)\/relationships"/.exec(head)?.[1] || null
const rIdOf = (a) => a[Object.keys(a).find((k) => /:id$/.test(k))]

// ---------- Cells ----------
const ERRORS = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!', '#FIELD!', '#BLOCKED!', '#UNKNOWN!', '#BUSY!', '#CONNECT!', '#EXTERNAL!'])
// Functions newer than Excel 2007 are written with _xlfn. in the file, or Excel reads #NAME?.
const NEWER = 'AGGREGATE ARRAYTOTEXT BETA.DIST BETA.INV BINOM.DIST BINOM.DIST.RANGE BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT BITXOR BYCOL BYROW CEILING.MATH CEILING.PRECISE CHIDIST CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT COTH COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FILTER FILTERXML FLOOR.MATH FLOOR.PRECISE FORECAST.ETS FORECAST.ETS.CONFINT FORECAST.ETS.SEASONALITY FORECAST.ETS.STAT FORECAST.LINEAR FORMULATEXT GAMMA GAMMA.DIST GAMMA.INV GAMMALN.PRECISE GAUSS HSTACK HYPGEOM.DIST IFNA IFS IMAGE IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA ISOMITTED ISOWEEKNUM LAMBDA LET LOGNORM.DIST LOGNORM.INV MAKEARRAY MAP MAXIFS MINIFS MODE.MULT MODE.SNGL MUNIT NEGBINOM.DIST NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NUMBERVALUE PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC PERMUTATIONA PHI POISSON.DIST QUARTILE.EXC QUARTILE.INC RANDARRAY RANK.AVG RANK.EQ REDUCE RRI SCAN SEC SECH SEQUENCE SHEET SHEETS SKEW.P SORT SORTBY STDEV.P STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW UNICHAR UNICODE UNIQUE VALUETOTEXT VAR.P VAR.S VSTACK WEBSERVICE WEIBULL.DIST WRAPCOLS WRAPROWS XLOOKUP XMATCH XOR Z.TEST'.split(' ')
const NEWER_RE = new RegExp(`(^|[^\\w.])(${NEWER.map(reEsc).sort((a, b) => b.length - a.length).join('|')})\\(`, 'gi')
const plainFormula = (f) => f.replace(/_xlfn\._xlws\.|_xlfn\.|_xlws\.|_xlpm\./g, '')
// Outside strings only: a formula's text with each newer function marked as Excel wants it.
const fileFormula = (f) => f.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(NEWER_RE, (m, pre, fn) => `${pre}_xlfn.${['FILTER', 'SORT', 'SORTBY'].includes(fn.toUpperCase()) ? '_xlws.' : ''}${fn.toUpperCase()}(`))).join('')
const numText = (n) => (Number.isFinite(n) ? String(n) : '0')

// A cell's text and runs as Univer's rich text (with its link), for strings with formatting.
function docOf(text, runs, link) {
  const body = { dataStream: `${text}\r\n`, textRuns: runs || [], paragraphs: [{ startIndex: text.length }], customRanges: [] }
  if (link && text.length) body.customRanges.push({ startIndex: 0, endIndex: text.length - 1, rangeType: 0, rangeId: link.id, properties: { url: link.url } })
  return { id: 'd', body, documentStyle: {} }
}
// What shows in a rich cell, for comparing: its text, runs and link.
function docBits(p) {
  const b = p?.body
  if (!b) return null
  const text = String(b.dataStream || '').replace(/\r?\n$/, '').replace(/\r$/, '')
  const runs = (b.textRuns || []).map((r) => [r.st, r.ed, normStyle(r.ts)]).filter((r) => r[2] && r[1] > r[0])
  const link = (b.customRanges || []).find((r) => r.rangeType === 0 && r.properties?.url)
  return { text, runs: runs.length ? JSON.stringify(runs) : '', url: link ? String(link.properties.url) : '' }
}
// A cell made comparable: its formula (whatever its last result), else its value, its look, its
// rich text and link. Empty and unstyled is ''.
function cellKey(cell, data) {
  if (!cell) return ''
  const st = styleIn(data, cell.s)
  const f = cell.f ? String(cell.f).replace(/^=/, '') : ''
  const d = cell.p ? docBits(cell.p) : null
  let v = ''
  if (!f) {
    if (d) v = `s:${d.text}`
    else if (cell.v != null && cell.v !== '') v = valueKey(cell.v, cell.t)
  }
  if (!f && !v && !st) return ''
  return JSON.stringify([f, v, st, d?.runs || '', d?.url || ''])
}
function valueKey(v, t) {
  if (t === 3 || typeof v === 'boolean') return `b:${v === true || v === 1 || v === '1' || /^true$/i.test(String(v)) ? 1 : 0}`
  if ((t === 2 || typeof v === 'number') && v !== '' && Number.isFinite(Number(v))) return `n:${Number(v)}`
  return `s:${v}`
}

// ---------- Conditional formats ----------
const CF_NUM_OPS = ['lessThan', 'lessThanOrEqual', 'equal', 'notEqual', 'greaterThanOrEqual', 'greaterThan', 'between', 'notBetween']
const TEXT_TYPES = { containsText: 'containsText', notContainsText: 'notContainsText', beginsWith: 'beginsWith', endsWith: 'endsWith', containsBlanks: 'containsBlanks', notContainsBlanks: 'notContainsBlanks', containsErrors: 'containsErrors', notContainsErrors: 'notContainsErrors' }
const PERIODS = ['today', 'yesterday', 'tomorrow', 'last7Days', 'thisMonth', 'lastMonth', 'nextMonth', 'thisWeek', 'lastWeek', 'nextWeek']
const ICON_SETS = ['3Arrows', '3ArrowsGray', '4Arrows', '4ArrowsGray', '5Arrows', '5ArrowsGray', '3Triangles', '3TrafficLights1', '3Signs', '3TrafficLights2', '4RedToBlack', '4TrafficLights', '3Symbols', '3Symbols2', '3Flags', '4Rating', '5Rating', '5Quarters', '5Boxes', '3Stars']
const isNum = (s) => s != null && s !== '' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(String(s).trim())
const cfvoOf = (e) => { const a = attrs(e.open); const type = { num: 'num', min: 'min', max: 'max', percent: 'percent', percentile: 'percentile', formula: 'formula' }[a.type] || 'num'; return { type, ...(a.val != null ? { value: type === 'formula' ? `=${a.val}` : isNum(a.val) ? Number(a.val) : `=${a.val}` } : {}) } }
// One <cfRule> as Univer's rule, or null where Univer has nothing like it (it's kept as it is).
function cfToUniver(open, inner, ranges, cfId, st, ctx) {
  const a = attrs(open)
  const fs = each(inner, 'formula').map((e) => unx(e.inner))
  const style = a.dxfId != null && st.dxfs[Number(a.dxfId)] ? dxfStyle(st.dxfs[Number(a.dxfId)], ctx) : {}
  const top = ranges[0] ? a1(ranges[0].startRow, ranges[0].startColumn) : 'A1'
  const base = { ranges, cfId, stopIfTrue: a.stopIfTrue === '1' || a.stopIfTrue === 'true' }
  const hl = (subType, more) => ({ ...base, rule: { type: 'highlightCell', subType, style, ...more } })
  switch (a.type) {
    case 'cellIs': {
      const op = a.operator || 'equal'
      if (!CF_NUM_OPS.includes(op)) return null
      if (fs.every(isNum) && fs.length >= (op.endsWith('etween') ? 2 : 1)) return hl('number', { operator: op, value: op.endsWith('etween') ? [Number(fs[0]), Number(fs[1])] : Number(fs[0]) })
      const str = /^"((?:[^"]|"")*)"$/.exec(fs[0] || '')
      if (str && (op === 'equal' || op === 'notEqual')) return hl('text', { operator: op, value: str[1].replace(/""/g, '"') })
      const cmp = { lessThan: '<', lessThanOrEqual: '<=', equal: '=', notEqual: '<>', greaterThanOrEqual: '>=', greaterThan: '>' }[op]
      const expr = op === 'between' ? `AND(${top}>=${fs[0]},${top}<=${fs[1]})` : op === 'notBetween' ? `OR(${top}<${fs[0]},${top}>${fs[1]})` : `${top}${cmp}${fs[0]}`
      return hl('formula', { value: `=${expr}` })
    }
    case 'containsText': case 'notContainsText': case 'beginsWith': case 'endsWith':
      return hl('text', { operator: TEXT_TYPES[a.type], value: a.text ?? '' })
    case 'containsBlanks': case 'notContainsBlanks': case 'containsErrors': case 'notContainsErrors':
      return hl('text', { operator: TEXT_TYPES[a.type] })
    case 'timePeriod': return PERIODS.includes(a.timePeriod) ? hl('timePeriod', { operator: a.timePeriod }) : null
    case 'duplicateValues': return hl('duplicateValues')
    case 'uniqueValues': return hl('uniqueValues')
    case 'top10': return hl('rank', { isBottom: a.bottom === '1', isPercent: a.percent === '1', value: Number(a.rank) || 10 })
    case 'aboveAverage': {
      if (a.stdDev) return null
      const above = a.aboveAverage !== '0', eq = a.equalAverage === '1'
      return hl('average', { operator: above ? (eq ? 'greaterThanOrEqual' : 'greaterThan') : (eq ? 'lessThanOrEqual' : 'lessThan') })
    }
    case 'expression': return fs[0] != null ? hl('formula', { value: `=${fs[0]}` }) : null
    case 'colorScale': {
      const cs = one(inner, 'colorScale')
      if (!cs) return null
      const vos = each(cs.inner, 'cfvo').map(cfvoOf), cols = each(cs.inner, 'color').map((e) => colourOf(e.open, ctx) || '#000000')
      return { ...base, rule: { type: 'colorScale', config: vos.map((value, index) => ({ index, color: cols[index] || '#000000', value })) } }
    }
    case 'dataBar': {
      const db = one(inner, 'dataBar')
      if (!db) return null
      const vos = each(db.inner, 'cfvo').map(cfvoOf)
      const c = colourOf(one(db.inner, 'color')?.open, ctx) || '#638ec6'
      return { ...base, rule: { type: 'dataBar', isShowValue: attrs(db.open).showValue !== '0', config: { min: vos[0] || { type: 'min' }, max: vos[1] || { type: 'max' }, isGradient: true, positiveColor: c, nativeColor: '#ff0000' } } }
    }
    case 'iconSet': {
      const is = one(inner, 'iconSet')
      if (!is) return null
      const ia = attrs(is.open)
      const set = ia.iconSet || '3TrafficLights1'
      if (!ICON_SETS.includes(set) || one(is.inner, 'cfIcon')) return null
      const vos = each(is.inner, 'cfvo').map((e) => ({ ...cfvoOf(e), gte: attrs(e.open).gte !== '0' }))
      const n = vos.length, rev = ia.reverse === '1'
      // Univer lists the top icon first; Excel lists thresholds from the bottom up
      const config = vos.map((_, k) => {
        const vo = vos[n - 1 - k]
        const iconId = String(rev ? n - 1 - k : k)
        if (k === n - 1) return { operator: 'lessThanOrEqual', value: { type: 'num', value: Number.MAX_SAFE_INTEGER }, iconType: set, iconId }
        return { operator: vo.gte ? 'greaterThanOrEqual' : 'greaterThan', value: { type: vo.type, ...(vo.value != null ? { value: vo.value } : {}) }, iconType: set, iconId }
      })
      return { ...base, rule: { type: 'iconSet', isShowValue: ia.showValue !== '0', config } }
    }
    default: return null
  }
}

// ---------- Data validation ----------
const DV_TYPES = { whole: 'whole', decimal: 'decimal', list: 'list', date: 'date', time: 'time', textLength: 'textLength', custom: 'custom', none: 'any' }
const ERR_STYLE = { stop: 1, warning: 2, information: 0 }
const dvFormula = (type, f) => {
  if (f == null) return undefined
  if (type === 'list') { const m = /^"((?:[^"]|"")*)"$/.exec(f); return m ? m[1].replace(/""/g, '"') : `=${f}` }
  if (type === 'custom') return `=${f}`
  return isNum(f) ? String(Number(f)) : `=${f}`
}
function dvToUniver(open, inner, uid) {
  const a = attrs(open)
  const type = DV_TYPES[a.type || 'none']
  if (!type) return null
  const ranges = rangesOf(a.sqref)
  if (!ranges.length) return null
  const f1 = one(inner, 'formula1'), f2 = one(inner, 'formula2')
  const on = (k) => a[k] === '1' || a[k] === 'true'
  const rule = { uid, type, ranges, allowBlank: on('allowBlank'), showErrorMessage: on('showErrorMessage'), showInputMessage: on('showInputMessage'), errorStyle: ERR_STYLE[a.errorStyle || 'stop'] }
  const fv1 = dvFormula(a.type, f1 ? unx(f1.inner) : null), fv2 = dvFormula(a.type, f2 ? unx(f2.inner) : null)
  if (fv1 != null) rule.formula1 = fv1
  if (fv2 != null) rule.formula2 = fv2
  if (!['list', 'custom', 'none', undefined].includes(a.type)) rule.operator = a.operator || 'between'
  // Excel's showDropDown means the opposite: true hides the list's arrow
  if (a.type === 'list') { rule.showDropDown = !on('showDropDown'); rule.renderMode = 1 }
  for (const k of ['error', 'errorTitle', 'prompt', 'promptTitle']) if (a[k] != null) rule[k] = a[k]
  return rule
}

// ---------- Filters ----------
function filterToUniver(af) {
  const a = attrs(af.open)
  const ref = rangeOf(a.ref)
  if (!ref) return null
  const columns = []
  for (const fc of each(af.inner, 'filterColumn')) {
    const colId = ref.startColumn + Number(attrs(fc.open).colId || 0)
    const fl = one(fc.inner, 'filters'), cf = one(fc.inner, 'customFilters')
    if (fl) {
      const fa = attrs(fl.open)
      const vals = each(fl.inner, 'filter').map((e) => attrs(e.open).val)
      if (each(fl.inner, 'dateGroupItem').length) return { ref, unsupported: true }
      columns.push({ colId, filters: { ...(fa.blank === '1' || fa.blank === 'true' ? { blank: true } : {}), ...(vals.length ? { filters: vals } : {}) } })
    } else if (cf) {
      const list = each(cf.inner, 'customFilter').map((e) => { const x = attrs(e.open); return { val: isNum(x.val) ? Number(x.val) : x.val ?? '', ...(x.operator && x.operator !== 'equal' ? { operator: x.operator } : {}) } })
      columns.push({ colId, customFilters: { ...(attrs(cf.open).and === '1' ? { and: 1 } : {}), customFilters: list.slice(0, 2) } })
    } else if (one(fc.inner, 'top10') || one(fc.inner, 'dynamicFilter') || one(fc.inner, 'colorFilter') || one(fc.inner, 'iconFilter')) return { ref, unsupported: true }
  }
  return { ref, ...(columns.length ? { filterColumns: columns } : {}) }
}

// ---------- Charts (to draw them beside the grid) ----------
const CHART_KINDS = { barChart: 'column', bar3DChart: 'column', lineChart: 'line', line3DChart: 'line', areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut', scatterChart: 'scatter', bubbleChart: 'scatter', radarChart: 'other', stockChart: 'other', surfaceChart: 'other', surface3DChart: 'other' }
function chartOf(xml) {
  const plot = one(xml, 'plotArea')
  if (!plot) return null
  let type = 'other', group = null
  for (const k of Object.keys(CHART_KINDS)) { const g = one(plot.inner, k); if (g) { type = CHART_KINDS[k]; group = g; break } }
  if (group && type === 'column' && attrs(one(group.inner, 'barDir')?.open || '').val === 'bar') type = 'bar'
  const titleEl = one(xml, 'title')
  const title = titleEl ? each(titleEl.inner, 't').map((t) => unx(t.inner)).join('') : ''
  const cache = (el) => (el ? each(el.inner, 'pt').sort((p, q) => Number(attrs(p.open).idx) - Number(attrs(q.open).idx)).map((p) => unx(one(p.inner, 'v')?.inner || '')) : [])
  const series = each(plot.inner, 'ser').map((s) => {
    const tx = one(s.inner, 'tx'), cat = one(s.inner, 'cat') || one(s.inner, 'xVal'), val = one(s.inner, 'val') || one(s.inner, 'yVal')
    const f = (el) => (el ? unx(one(el.inner, 'f')?.inner || '') : '')
    return { name: tx ? (cache(tx)[0] ?? unx(one(tx.inner, 'v')?.inner || '')) : '', catRef: f(cat), valRef: f(val), cats: cache(cat), vals: cache(val).map(Number) }
  })
  return { title, type, series }
}
const anchorAt = (xml, name) => { const e = one(xml, name); if (!e) return null; return { col: Number(one(e.inner, 'col')?.inner) || 0, row: Number(one(e.inner, 'row')?.inner) || 0 } }

// ---------- Reading ----------
const STYLES_MIN = '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
// Excel's column width (characters, as stored) and pixels, at the default font's 7 px digits.
const pxOfWidth = (w) => Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7)
function widthOfPx(px) {
  let w = Math.max(0, Math.floor(((px / 7) * 256 - Math.trunc(128 / 7))) / 256)
  for (let k = 0; k < 4 && pxOfWidth(w) < px; k++) w += 1 / 256
  return Math.round(w * 256) / 256
}
const pxOfPt = (pt) => Math.round((pt * 4) / 3)

// The whole file, read once: the workbook Univer shows (data), and for the writer each sheet's
// rows and cells as written, its rules and links with the XML they came from.
async function parseBook(bytes) {
  let zip
  try { zip = await JSZip.loadAsync(bytes) } catch { throw new Error("This isn't an Excel workbook (.xlsx), or it's damaged") }
  const rootRels = parseRels(await text(zip, '_rels/.rels'), '')
  const wbPath = rootRels.find((r) => r.type === '/officeDocument')?.path || 'xl/workbook.xml'
  const wbXml = await text(zip, wbPath)
  if (!wbXml) throw new Error("This isn't an Excel workbook (.xlsx), or it's damaged")
  const wbRels = parseRels(await text(zip, relsPathOf(wbPath)), wbPath)
  const theme = themeColours(await text(zip, wbRels.find((r) => r.type === '/theme')?.path))
  const stylesPath = wbRels.find((r) => r.type === '/styles')?.path || null
  const st = parseStyles((await text(zip, stylesPath)) || STYLES_MIN, theme)
  const ctx = { theme, palette: st.palette }
  const sst = each(one((await text(zip, wbRels.find((r) => r.type === '/sharedStrings')?.path)) || '', 'sst')?.inner || '', 'si').map((si) => {
    const runs = each(si.inner, 'r')
    if (!runs.length) return { text: textOf(si.inner) }
    let at = 0
    const tr = []
    const out = runs.map((r) => {
      const t = textOf(r.inner)
      const pr = one(r.inner, 'rPr')
      const ts = pr ? fontStyle(pr.xml, ctx) : null
      if (ts && Object.keys(ts).length && t.length) tr.push({ st: at, ed: at + t.length, ts })
      at += t.length
      return t
    })
    return { text: out.join(''), runs: tr }
  })
  const wbPr = attrs(one(wbXml, 'workbookPr')?.open || '')
  const entries = each(one(wbXml, 'sheets')?.inner || '', 'sheet').map((e) => { const a = attrs(e.open); return { ...a, rid: rIdOf(a), open: e.open } })
  const names = each(one(wbXml, 'definedNames')?.inner || '', 'definedName').map((e) => ({ ...attrs(e.open), text: unx(e.inner), xml: e.xml }))
  const book = { zip, wbPath, wbXml, wbRels, stylesPath, st, ctx, sst, entries, names, sheets: [], lost: new Set(), charts: [], date1904: wbPr.date1904 === '1' || wbPr.date1904 === 'true' }
  if (zip.file(/vbaProject\.bin$/i).length) book.lost.add('macros')
  if (zip.file(/^xl\/slicers\//).length || zip.file(/^xl\/slicerCaches\//).length) book.lost.add('slicers')
  if (zip.file(/^xl\/externalLinks\//).length) book.lost.add('links to other workbooks')
  if (zip.file(/^xl\/connections\.xml$/).length || zip.file(/^xl\/queryTables\//).length) book.lost.add('data connections')
  let n = 0
  for (const e of entries) {
    const rel = wbRels.find((r) => r.id === e.rid)
    e.kind = rel?.type.slice(1) || 'missing'
    e.path = rel?.path || null
    if (e.kind === 'chartsheet') { book.lost.add('chart sheets'); continue }
    if (e.kind !== 'worksheet' || !e.path) { if (e.kind !== 'missing') book.lost.add('macro or dialog sheets'); continue }
    const xml = await text(zip, e.path)
    if (xml == null) continue
    book.sheets.push(await parseSheet(book, e, xml, `sheet${++n}`))
  }
  book.data = univerOf(book)
  return book
}

async function parseSheet(book, entry, xml, id) {
  const { zip, st, ctx, sst } = book
  const relsPath = relsPathOf(entry.path)
  const rels = parseRels(await text(zip, relsPath), entry.path)
  const sh = { id, entry, name: entry.name, part: entry.path, xml, relsPath, rels, rows: new Map(), shared: new Map(), cf: [], cfHidden: [], dv: [], dvHidden: [], links: new Map(), linksHidden: [], notes: null }
  const S = split(xml)
  const item = (name) => S.items.find((x) => x.name === name)?.xml || ''
  // The sheet's own settings
  const pr = item('sheetPr')
  const tab = pr && colourOf(one(pr, 'tabColor')?.open, ctx)
  const view = one(item('sheetViews'), 'sheetView')
  const va = attrs(view?.open || '')
  const pane = view && one(view.inner, 'pane')
  const pa = attrs(pane?.open || '')
  let freeze = { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 }
  if (pane && /frozen/i.test(pa.state || '')) {
    // Univer's freeze: how many columns and rows, and where the part that scrolls starts
    const x = Math.round(Number(pa.xSplit) || 0), y = Math.round(Number(pa.ySplit) || 0)
    if (x || y) freeze = { xSplit: x, ySplit: y, startRow: y, startColumn: x }
  }
  const fmt = attrs(/<(\w+:)?sheetFormatPr\b[^>]*>/.exec(item('sheetFormatPr'))?.[0] || '')
  const defaultRowHeight = pxOfPt(Number(fmt.defaultRowHeight) || 15)
  const base = Number(fmt.baseColWidth) || 8
  const defaultColumnWidth = fmt.defaultColWidth ? pxOfWidth(Number(fmt.defaultColWidth)) : Math.ceil((base * 7 + 5) / 8) * 8
  // Filter first: rows it hides aren't hidden by hand
  const af = one(item('autoFilter'), 'autoFilter')
  sh.filter = af ? filterToUniver(af) : null
  if (sh.filter?.unsupported) book.lost.add('some filters')
  sh.filterXml = af?.xml || null
  const filtered = sh.filter?.filterColumns ? sh.filter.ref : null
  // Rows and cells
  const cellData = {}, rowData = {}
  const styleId = (s) => { if (!s) return null; const k = `x${s}`; if (!book.styles[k]) book.styles[k] = xfStyle(st, s, ctx) || {}; return k }
  book.styles ||= {}
  let maxR = -1, maxC = -1
  const sdItem = S.items.find((x) => x.name === 'sheetData')
  const sd = sdItem && !sdItem.xml.endsWith('/>') ? sdItem.xml : ''
  const reRow = /<((?:[\w.-]+:)?)row(?=[\s>/])[^>]*?(\/?)>/g
  const pending = []
  let nextRow = 0
  let m
  while ((m = reRow.exec(sd))) {
    const open = m[0]
    const ra = attrs(open)
    const r = ra.r ? Number(ra.r) - 1 : nextRow
    nextRow = r + 1
    const row = { open, cells: new Map(), attrs: ra }
    sh.rows.set(r, row)
    const rd = {}
    if (ra.ht != null) rd.h = pxOfPt(Number(ra.ht))
    if ((ra.hidden === '1' || ra.hidden === 'true') && !(filtered && r > filtered.startRow && r <= filtered.endRow)) rd.hd = 1
    if (ra.customFormat === '1' && Number(ra.s)) rd.s = styleId(Number(ra.s))
    if (Object.keys(rd).length) rowData[r] = rd
    if (m[2]) continue
    const end = sd.indexOf(`</${m[1]}row>`, reRow.lastIndex)
    const inner = sd.slice(reRow.lastIndex, end)
    reRow.lastIndex = end
    const reC = /<((?:[\w.-]+:)?)c(?=[\s>/])[^>]*?(\/?)>/g
    let cm, nextC = 0
    while ((cm = reC.exec(inner))) {
      const copen = cm[0]
      let cin = ''
      let cend = reC.lastIndex
      if (!cm[2]) { const k = inner.indexOf(`</${cm[1]}c>`, reC.lastIndex); cin = inner.slice(reC.lastIndex, k); cend = k + cm[1].length + 4; reC.lastIndex = cend }
      const ca = attrs(copen)
      const at = ca.r ? cellAt(ca.r) : { r, c: nextC }
      const c = at ? at.c : nextC
      nextC = c + 1
      const s = Number(ca.s) || 0
      const t = ca.t || 'n'
      const fm = /<(?:[\w.-]+:)?f(?=[\s>/])([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?f>)/.exec(cin)
      const vm = /<(?:[\w.-]+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?v>/.exec(cin)
      const raw = vm ? unx(vm[1]) : null
      const rec = { xml: inner.slice(cm.index, cend), s, t }
      row.cells.set(c, rec)
      const cell = {}
      // its value, as Excel last worked it out
      if (t === 's') { const x = sst[Number(raw)]; if (x) { cell.v = x.text; cell.t = 1; if (x.runs?.length) cell.p = docOf(x.text, x.runs) } }
      else if (t === 'inlineStr') {
        const is = one(cin, 'is')
        if (is) {
          const runs = each(is.inner, 'r')
          const txt = textOf(is.inner)
          cell.v = txt; cell.t = 1
          if (runs.length) { let at2 = 0; const tr = []; for (const rr of runs) { const tt = textOf(rr.inner); const pr2 = one(rr.inner, 'rPr'); const ts = pr2 ? fontStyle(pr2.xml, ctx) : null; if (ts && Object.keys(ts).length && tt.length) tr.push({ st: at2, ed: at2 + tt.length, ts }); at2 += tt.length } if (tr.length) cell.p = docOf(txt, tr) }
        }
      } else if (t === 'b') { if (raw != null) { cell.v = raw === '1' || raw === 'true' ? 1 : 0; cell.t = 3 } }
      else if (t === 'e' || t === 'str') { if (raw != null) { cell.v = unxl(raw); cell.t = 1 } }
      else if (t === 'd') { if (raw) { const d = Date.parse(raw.length <= 10 ? `${raw}T00:00:00Z` : /Z|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`); if (Number.isFinite(d)) { cell.v = d / 86400000 + 25569; cell.t = 2 } } }
      else if (raw != null && raw !== '') { const num = Number(raw); if (Number.isFinite(num)) { cell.v = num; cell.t = 2 } }
      // its formula: a shared one's other cells read the first's, moved
      if (fm) {
        const fa = attrs(`<f${fm[1]}>`)
        const ftxt = unx(fm[2] || '')
        rec.f = { t: fa.t || 'normal', si: fa.si, ref: fa.ref }
        if (fa.t === 'shared' && fa.si != null) {
          if (ftxt) { sh.shared.set(fa.si, { r, c, f: ftxt, ref: fa.ref }); cell.f = `=${plainFormula(ftxt)}` } else pending.push({ r, c, si: fa.si, cell })
        } else if (fa.t === 'dataTable') rec.f.keep = true
        else if (ftxt) cell.f = `=${plainFormula(ftxt)}`
      }
      const sid = styleId(s)
      if (sid) cell.s = sid
      if (Object.keys(cell).length) {
        ;(cellData[r] ||= {})[c] = cell
        if (cell.v != null || cell.f) { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c) }
      }
    }
  }
  for (const p of pending) { const m0 = sh.shared.get(p.si); if (m0) p.cell.f = `=${plainFormula(moveFormula(m0.f, p.r - m0.r, p.c - m0.c))}` }
  // Columns
  const columnData = {}
  sh.cols = each(item('cols'), 'col').map((e) => ({ ...attrs(e.open), xml: e.xml }))
  const colCount = Math.max(26, maxC + 11)
  for (const col of sh.cols) {
    const lo = Number(col.min) - 1, hi = Math.min(Number(col.max) - 1, colCount + 50)
    for (let c = lo; c <= hi; c++) {
      const cd = {}
      if (col.width != null && (col.customWidth === '1' || col.customWidth === 'true' || Number(col.width) > 0)) cd.w = pxOfWidth(Number(col.width))
      if (col.hidden === '1' || col.hidden === 'true') cd.hd = 1
      if (Number(col.style)) cd.s = styleId(Number(col.style))
      if (Object.keys(cd).length) columnData[c] = cd
    }
  }
  // Merges
  const mergeData = each(item('mergeCells'), 'mergeCell').map((e) => rangeOf(attrs(e.open).ref)).filter(Boolean)
  for (const g of mergeData) { maxR = Math.max(maxR, g.endRow); maxC = Math.max(maxC, g.endColumn) }
  // Conditional formats: one Univer rule for each <cfRule> Univer has, the rest kept as they are
  let k = 0
  for (const block of S.items.filter((x) => x.name === 'conditionalFormatting')) {
    const ba = attrs(/^<[^>]*>/.exec(block.xml)[0])
    const ranges = rangesOf(ba.sqref)
    for (const rule of each(block.xml, 'cfRule')) {
      const cfId = `cf${++k}`
      const u = ranges.length && !ba.pivot ? cfToUniver(rule.open, rule.inner, ranges, cfId, st, ctx) : null
      const pri = Number(attrs(rule.open).priority) || k
      if (u) sh.cf.push({ cfId, rule: u, xml: rule.xml, pri, sqref: ba.sqref })
      else { sh.cfHidden.push({ sqref: ba.sqref, xml: rule.xml, pri, open: /^<[^>]*>/.exec(block.xml)[0] }); book.lost.add('some conditional formats') }
    }
  }
  sh.cf.sort((a, b) => a.pri - b.pri)
  if (/<x14:conditionalFormatting[\s>]/.test(item('extLst'))) book.lost.add('some conditional formats')
  // Data validation
  const dvs = one(item('dataValidations'), 'dataValidations')
  k = 0
  for (const e of each(dvs?.inner || '', 'dataValidation')) {
    const uid = `dv${++k}`
    const u = dvToUniver(e.open, e.inner, uid)
    if (u) sh.dv.push({ uid, rule: u, xml: e.xml })
    else sh.dvHidden.push({ xml: e.xml })
  }
  sh.dvsOpen = dvs?.open || null
  // Links: on text cells (or empty ones) as Univer's rich text; the rest kept as they are
  const linkId = (r, c) => `link-${id}-${r}-${c}`
  for (const e of each(item('hyperlinks'), 'hyperlink')) {
    const a = attrs(e.open)
    const g = rangeOf(a.ref)
    const rel = rIdOf(a) && rels.find((x) => x.id === rIdOf(a))
    // a link to a place in the workbook is a location (some writers put it in the target too)
    const inside = rel?.target?.startsWith('#') ? rel.target.slice(1) : null
    const loc = a.location ? a.location.replace(/^#/, '') : null
    let url = rel?.external && !inside ? rel.target + (loc ? `#${loc}` : '') : null
    if (!url && (loc || inside)) url = { location: loc || inside }
    const cell = g && g.startRow === g.endRow && g.startColumn === g.endColumn ? cellData[g.startRow]?.[g.startColumn] : null
    const textCell = g && g.startRow === g.endRow && g.startColumn === g.endColumn && (!cell || cell.t === 1 || cell.v == null) && !cell?.f
    if (!url || !textCell) { sh.linksHidden.push({ xml: e.xml, ref: a.ref }); continue }
    const r = g.startRow, c = g.startColumn
    sh.links.set(`${r},${c}`, { url, xml: e.xml, rid: rIdOf(a) || null, a })
    const target = typeof url === 'string' ? url : null
    const t0 = cell?.v != null ? String(cell.v) : a.display || (target || a.location)
    const cc = (cellData[r] ||= {})[c] ||= {}
    if (cc.v == null) { cc.v = t0; cc.t = 1 }
    cc.p = docOf(t0, cc.p?.body?.textRuns, { id: linkId(r, c), url: target ?? `#internal:${a.location}` })
  }
  // Notes: Excel's comments, from their part
  const cm = rels.find((r) => r.type === '/comments')
  if (cm) {
    const cx = await text(zip, cm.path)
    const vml = rels.find((r) => r.type === '/vmlDrawing')
    sh.notes = { rel: cm, xml: cx, vml, list: [] }
    for (const e of each(one(cx || '', 'commentList')?.inner || '', 'comment')) {
      const a = attrs(e.open)
      const at = cellAt(a.ref || '')
      if (!at) continue
      sh.notes.list.push({ r: at.r, c: at.c, text: textOf(one(e.inner, 'text')?.inner || ''), xml: e.xml })
    }
    if (rels.some((r) => r.type === '/threadedComment')) book.lost.add('threaded comments')
  }
  // What's kept but not shown: pictures and charts, tables, pivot tables, sparklines, controls
  for (const d of rels.filter((r) => r.type === '/drawing')) {
    const dx = (await text(zip, d.path)) || ''
    const drels = parseRels(await text(zip, relsPathOf(d.path)), d.path)
    if (/<(\w+:)?pic[\s>]/.test(dx)) book.lost.add('pictures')
    if (/<(\w+:)?sp[\s>]/.test(dx) || /<(\w+:)?cxnSp[\s>]/.test(dx)) book.lost.add('shapes')
    for (const anchor of [...each(dx, 'twoCellAnchor'), ...each(dx, 'oneCellAnchor')]) {
      const ch = /<(?:[\w.-]+:)?chart\b[^>]*?(?:[\w.-]+:)?id="([^"]+)"/.exec(anchor.inner)
      if (!ch) continue
      book.lost.add('charts')
      const cr = drels.find((r) => r.id === ch[1])
      const cxml = cr && (await text(zip, cr.path))
      const info = cxml && chartOf(cxml)
      if (info) book.charts.push({ sheet: id, ...info, from: anchorAt(anchor.inner, 'from'), to: anchorAt(anchor.inner, 'to') || anchorAt(anchor.inner, 'from') })
    }
    if (/<(\w+:)?graphicFrame[\s>]/.test(dx) && !/<(?:[\w.-]+:)?chart\b/.test(dx)) book.lost.add('charts')
  }
  if (rels.some((r) => r.type === '/table')) book.lost.add('tables')
  if (rels.some((r) => r.type === '/pivotTable')) book.lost.add('pivot tables')
  if (/sparklineGroups/.test(item('extLst'))) book.lost.add('sparklines')
  if (item('controls') || item('oleObjects') || S.items.some((x) => x.name === 'AlternateContent' && /control|oleObject/.test(x.xml))) book.lost.add('form controls')
  sh.univer = {
    id,
    name: entry.name,
    tabColor: tab || '',
    hidden: entry.state === 'hidden' || entry.state === 'veryHidden' ? 1 : 0,
    freeze,
    rowCount: Math.max(1000, maxR + 101),
    columnCount: colCount,
    zoomRatio: Number(va.zoomScale) ? Number(va.zoomScale) / 100 : 1,
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth,
    defaultRowHeight,
    mergeData,
    cellData,
    rowData,
    columnData,
    rowHeader: { width: 46 },
    columnHeader: { height: 20 },
    showGridlines: va.showGridLines === '0' || va.showGridLines === 'false' ? 0 : 1,
    rightToLeft: va.rightToLeft === '1' ? 1 : 0,
  }
  return sh
}

// The workbook as Univer takes it, with its rules as Univer's plugins keep them.
function univerOf(book) {
  const sheets = {}
  const cf = {}, dv = {}, filter = {}, notes = {}
  for (const sh of book.sheets) {
    sheets[sh.id] = sh.univer
    if (sh.cf.length) cf[sh.id] = sh.cf.map((x) => x.rule)
    if (sh.dv.length) dv[sh.id] = sh.dv.map((x) => x.rule)
    if (sh.filter && !sh.filter.unsupported) filter[sh.id] = sh.filter
    if (sh.notes?.list.length) {
      const m = {}
      for (const n of sh.notes.list) (m[n.r] ||= {})[n.c] = { id: `note-${sh.id}-${n.r}-${n.c}`, row: n.r, col: n.c, width: 216, height: 92, note: n.text, show: false }
      notes[sh.id] = m
    }
  }
  // Links to a place in the workbook, as Univer names them (#gid=sheet&range=A1)
  for (const sh of book.sheets) {
    for (const [key, l] of sh.links) {
      if (typeof l.url === 'string') continue
      const [r, c] = key.split(',').map(Number)
      const cell = sh.univer.cellData[r][c]
      cell.p.body.customRanges[0].properties.url = internalUrl(book, l.url.location)
    }
  }
  const x0 = book.st.xfs.length ? xfStyle(book.st, 0, book.ctx) : null
  const resources = [
    { name: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', data: JSON.stringify(cf) },
    { name: 'SHEET_DATA_VALIDATION_PLUGIN', data: JSON.stringify(dv) },
    { name: 'SHEET_FILTER_PLUGIN', data: JSON.stringify(filter) },
    { name: 'SHEET_NOTE_PLUGIN', data: JSON.stringify(notes) },
  ]
  return {
    id: 'workbook',
    name: '',
    appVersion: '',
    locale: 'enUS',
    styles: book.styles || {},
    sheetOrder: book.sheets.map((s) => s.id),
    sheets,
    resources,
    ...(book.date1904 ? { dateSystem: 'date1904' } : {}),
    ...(x0 && (x0.ff || x0.fs) ? { defaultStyle: { ...(x0.ff ? { ff: x0.ff } : {}), ...(x0.fs ? { fs: x0.fs } : {}) } } : {}),
  }
}
function internalUrl(book, location) {
  const m = /^(?:('(?:[^']|'')+'|[^!]+)!)?(.+)$/.exec(location || '')
  const name = m?.[1] ? unquote(m[1]) : null
  const sh = name ? book.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase()) : null
  if (!sh) return `#definedname=${location}`
  return `#gid=${sh.id}&range=${String(m[2]).replace(/\$/g, '')}`
}

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)))
const resourceOf = (data, name) => { const r = (data.resources || []).find((x) => x.name === name); if (!r?.data) return {}; try { return typeof r.data === 'string' ? JSON.parse(r.data) || {} : r.data } catch { return {} } }

export async function readBook(bytes, name = '') {
  const book = await parseBook(bytes)
  book.data.name = String(name || '').replace(/\.\w+$/, '')
  const data = clone(book.data)
  return { data, lost: [...book.lost], keep: { book }, charts: book.charts }
}

// ---------- Writing styles ----------
// New formats are derived from the ones cells had (copy on write) and added to styles.xml once each;
// what's there already is never changed, so every cell that wasn't edited keeps its look exactly.
const FONT_KEYS = ['ff', 'fs', 'bl', 'it', 'ul', 'st', 'cl', 'va']
const ALIGN_KEYS = ['ht', 'vt', 'tb', 'tr', 'pd']
const FONT_ORDER = ['b', 'i', 'strike', 'condense', 'extend', 'outline', 'shadow', 'u', 'vertAlign', 'sz', 'color', 'name', 'family', 'charset', 'scheme']
const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null)
// The elements inside an element, each with its local name.
function kids(inner) {
  const out = []
  const re = /<([\w.-]+:)?([\w.-]+)[^>]*?(\/?)>/g
  let m
  while ((m = re.exec(inner))) {
    if (m[0].startsWith('</')) continue
    let end = re.lastIndex
    if (!m[3]) { const c = closeOf(inner, `${m[1] || ''}${m[2]}`, re.lastIndex); end = c ? c.j : end }
    out.push({ name: m[2], xml: inner.slice(m.index, end) })
    re.lastIndex = end
  }
  return out
}
const parts = (xml) => { const open = /^<[^>]*>/.exec(xml)[0]; const selfClose = open.endsWith('/>'); return { open, inner: selfClose ? '' : xml.slice(open.length, xml.lastIndexOf('</')), name: /^<([\w.:-]+)/.exec(open)[1] } }
const build = (open, inner) => (inner ? `${open.replace(/\s*\/>$/, '>')}${inner}</${/^<([\w.:-]+)/.exec(open)[1]}>` : open.endsWith('/>') ? open : open.replace(/>$/, '/>'))

function styleWriter(st, prefix = '') {
  const lists = { fonts: [...st.fonts], fills: [...st.fills], borders: [...st.borders], cellXfs: [...st.xfs], dxfs: [...st.dxfs] }
  const maps = Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, new Map(l.map((x, i) => [x, i]).reverse())]))
  const numFmts = new Map(st.numFmts)
  const added = { numFmts: [] }
  let dirty = false
  const add = (k, xml) => { if (maps[k].has(xml)) return maps[k].get(xml); lists[k].push(xml); maps[k].set(xml, lists[k].length - 1); dirty = true; return lists[k].length - 1 }
  const P = prefix
  const colourXml = (name, rgb) => `<${P}${name} rgb="${argb(rgb)}"/>`
  function numFmt(pattern) {
    if (!pattern || pattern === 'General') return 0
    for (const [id, code] of numFmts) if (code === pattern) return id
    if (BUILTIN_ID[pattern] != null) return BUILTIN_ID[pattern]
    let id = 164
    while (numFmts.has(id)) id++
    numFmts.set(id, pattern)
    added.numFmts.push(id)
    dirty = true
    return id
  }
  function font(xml, b, n) {
    const { open, inner } = parts(xml || `<${P}font/>`)
    const have = new Map(kids(inner).map((k) => [k.name, k.xml]))
    const set = (name, x) => { if (x == null) have.delete(name); else have.set(name, x) }
    if (!same(b?.bl, n?.bl)) set('b', n?.bl ? `<${P}b/>` : null)
    if (!same(b?.it, n?.it)) set('i', n?.it ? `<${P}i/>` : null)
    if (!same(b?.st, n?.st)) set('strike', n?.st ? `<${P}strike/>` : null)
    if (!same(b?.ul, n?.ul)) set('u', n?.ul ? (n.ul.t === 10 ? `<${P}u val="double"/>` : `<${P}u/>`) : null)
    if (!same(b?.va, n?.va)) set('vertAlign', n?.va === 3 ? `<${P}vertAlign val="superscript"/>` : n?.va === 2 ? `<${P}vertAlign val="subscript"/>` : null)
    if (!same(b?.fs, n?.fs)) set('sz', n?.fs ? `<${P}sz val="${n.fs}"/>` : null)
    if (!same(b?.cl, n?.cl)) set('color', n?.cl ? colourXml('color', n.cl.rgb) : null)
    if (!same(b?.ff, n?.ff)) { set('name', n?.ff ? `<${P}name val="${esc(n.ff)}"/>` : null); have.delete('scheme'); have.delete('family'); have.delete('charset') }
    const ordered = [...FONT_ORDER.filter((k) => have.has(k)).map((k) => have.get(k)), ...[...have.keys()].filter((k) => !FONT_ORDER.includes(k)).map((k) => have.get(k))]
    return build(open, ordered.join(''))
  }
  const edgeXml = (name, e) => (e?.s ? `<${P}${name} style="${BORDER[e.s] || 'thin'}">${colourXml('color', e.cl?.rgb)}</${P}${name}>` : `<${P}${name}/>`)
  function border(xml, b, n) {
    let { open, inner } = parts(xml || `<${P}border><${P}left/><${P}right/><${P}top/><${P}bottom/><${P}diagonal/></${P}border>`)
    const have = new Map(kids(inner).map((k) => [k.name, k.xml]))
    for (const [k, name, alt] of [['l', 'left', 'start'], ['r', 'right', 'end'], ['t', 'top'], ['b', 'bottom']]) {
      if (same(b?.[k], n?.[k])) continue
      have.delete(alt)
      have.set(name, edgeXml(name, n?.[k]))
    }
    if (!same(b?.tl_br, n?.tl_br) || !same(b?.bl_tr, n?.bl_tr)) {
      const d = n?.tl_br || n?.bl_tr
      have.set('diagonal', edgeXml('diagonal', d))
      open = setAttr(setAttr(open, 'diagonalDown', n?.tl_br ? '1' : null), 'diagonalUp', n?.bl_tr ? '1' : null)
    }
    const order = ['start', 'left', 'end', 'right', 'top', 'bottom', 'diagonal', 'vertical', 'horizontal']
    for (const k of ['left', 'right', 'top', 'bottom', 'diagonal']) if (!have.has(k) && !(k === 'left' && have.has('start')) && !(k === 'right' && have.has('end'))) have.set(k, `<${P}${k}/>`)
    return build(open, [...order.filter((k) => have.has(k)).map((k) => have.get(k)), ...[...have.keys()].filter((k) => !order.includes(k)).map((k) => have.get(k))].join(''))
  }
  function alignment(tag, b, n) {
    let t = tag || `<${P}alignment/>`
    if (!same(b?.ht, n?.ht)) t = setAttr(t, 'horizontal', H_BACK[n?.ht] || null)
    if (!same(b?.vt, n?.vt)) t = setAttr(t, 'vertical', V_BACK[n?.vt] || null)
    if (!same(b?.tb, n?.tb)) t = setAttr(t, 'wrapText', n?.tb === 3 ? '1' : null)
    if (!same(b?.tr, n?.tr)) t = setAttr(t, 'textRotation', n?.tr?.v ? '255' : n?.tr?.a ? String(n.tr.a > 0 ? Math.min(90, n.tr.a) : 90 + Math.min(90, -n.tr.a)) : null)
    if (!same(b?.pd, n?.pd)) t = setAttr(t, 'indent', n?.pd?.l ? String(Math.max(1, Math.round(n.pd.l / INDENT_PX))) : null)
    return Object.keys(attrs(t)).length ? t : null
  }
  // A format for a cell whose look went from b to n, from the format it had (orig).
  function xf(orig, b, n) {
    if (!n) return 0
    const x = lists.cellXfs[orig] || lists.cellXfs[0] || `<${P}xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    let { open, inner } = parts(x)
    const a = xfAttrs(x)
    const diff = (k) => !same(b?.[k], n?.[k])
    if (FONT_KEYS.some(diff)) open = setAttr(setAttr(open, 'fontId', String(add('fonts', font(lists.fonts[Number(a.fontId) || 0], b, n)))), 'applyFont', '1')
    if (diff('bg')) open = setAttr(setAttr(open, 'fillId', String(n.bg ? add('fills', `<${P}fill><${P}patternFill patternType="solid">${colourXml('fgColor', n.bg.rgb)}<${P}bgColor indexed="64"/></${P}patternFill></${P}fill>`) : 0)), 'applyFill', '1')
    if (diff('bd')) open = setAttr(setAttr(open, 'borderId', String(add('borders', border(lists.borders[Number(a.borderId) || 0], b?.bd, n?.bd)))), 'applyBorder', '1')
    if (diff('n')) open = setAttr(setAttr(open, 'numFmtId', String(numFmt(n?.n?.pattern))), 'applyNumberFormat', '1')
    if (ALIGN_KEYS.some(diff)) {
      const ks = kids(inner)
      const al = alignment(ks.find((k) => k.name === 'alignment')?.xml.match(/^<[^>]*>/)[0], b, n)
      inner = [...(al ? [al] : []), ...ks.filter((k) => k.name !== 'alignment').map((k) => k.xml)].join('')
      open = setAttr(open, 'applyAlignment', '1')
    }
    return add('cellXfs', build(open, inner))
  }
  // A conditional format's look.
  function dxf(s) {
    const f = []
    if (s?.bl) f.push(`<${P}b/>`)
    if (s?.it) f.push(`<${P}i/>`)
    if (s?.st) f.push(`<${P}strike/>`)
    if (s?.ul) f.push(`<${P}u/>`)
    if (s?.cl) f.push(colourXml('color', s.cl.rgb))
    const nf = s?.n?.pattern ? `<${P}numFmt numFmtId="${numFmt(s.n.pattern)}" formatCode="${esc(s.n.pattern)}"/>` : ''
    const fill = s?.bg ? `<${P}fill><${P}patternFill>${colourXml('bgColor', s.bg.rgb)}</${P}patternFill></${P}fill>` : ''
    return add('dxfs', `<${P}dxf>${f.length ? `<${P}font>${f.join('')}</${P}font>` : ''}${nf}${fill}</${P}dxf>`)
  }
  function write(xml) {
    if (!dirty) return null
    const S = split(xml)
    const setList = (name, item, list) => {
      const at = S.items.find((x) => x.name === name)
      const open = at ? /^<[^>]*>/.exec(at.xml)[0] : `<${P}${name}>`
      place(S, name, `${setAttr(open.replace(/\s*\/>$/, '>'), 'count', String(list.length))}${list.join('')}</${P}${name}>`, ST_ORDER)
    }
    if (added.numFmts.length) {
      const at = S.items.find((x) => x.name === 'numFmts')
      const extra = added.numFmts.map((id) => `<${P}numFmt numFmtId="${id}" formatCode="${esc(numFmts.get(id))}"/>`)
      const have = at ? each(at.xml, 'numFmt').map((e) => e.xml) : []
      setList('numFmts', 'numFmt', [...have, ...extra])
    }
    for (const k of ['fonts', 'fills', 'borders', 'cellXfs', 'dxfs']) if (lists[k].length !== (k === 'cellXfs' ? st.xfs : st[k]).length) setList(k, null, lists[k])
    return joinParts(S)
  }
  return { xf, dxf, numFmt, write, get dirty() { return dirty } }
}

// ---------- Writing rules ----------
const qs = (s) => `"${String(s).replace(/"/g, '""')}"`
const cfvoXml = (v, P, extra = '') => {
  const type = v?.type || 'num'
  if (type === 'min' || type === 'max') return `<${P}cfvo type="${type}"${extra}/>`
  const val = v?.value
  const isF = typeof val === 'string' && val.startsWith('=')
  return `<${P}cfvo type="${isF && type === 'num' ? 'formula' : type}" val="${esc(isF ? val.slice(1) : val ?? 0)}"${extra}/>`
}
const PERIOD_F = {
  today: 'FLOOR(T,1)=TODAY()', yesterday: 'FLOOR(T,1)=TODAY()-1', tomorrow: 'FLOOR(T,1)=TODAY()+1',
  last7Days: 'AND(TODAY()-FLOOR(T,1)<=6,FLOOR(T,1)<=TODAY())',
  thisMonth: 'AND(MONTH(T)=MONTH(TODAY()),YEAR(T)=YEAR(TODAY()))',
  lastMonth: 'AND(MONTH(T)=MONTH(EDATE(TODAY(),0-1)),YEAR(T)=YEAR(EDATE(TODAY(),0-1)))',
  nextMonth: 'AND(MONTH(T)=MONTH(EDATE(TODAY(),0+1)),YEAR(T)=YEAR(EDATE(TODAY(),0+1)))',
  thisWeek: 'AND(TODAY()-ROUNDDOWN(T,0)<=WEEKDAY(TODAY())-1,ROUNDDOWN(T,0)-TODAY()<=7-WEEKDAY(TODAY()))',
  lastWeek: 'AND(TODAY()-ROUNDDOWN(T,0)>=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN(T,0)<(WEEKDAY(TODAY())+7))',
  nextWeek: 'AND(ROUNDDOWN(T,0)-TODAY()>(7-WEEKDAY(TODAY())),ROUNDDOWN(T,0)-TODAY()<(15-WEEKDAY(TODAY())))',
}
// One Univer rule as a <cfRule>, or null with why when Excel has nothing like it.
function cfRuleXml(u, pri, SW, P, why) {
  const r = u.rule || {}
  const g = u.ranges?.[0]
  const T = g ? a1(g.startRow, g.startColumn) : 'A1'
  const stop = u.stopIfTrue ? ' stopIfTrue="1"' : ''
  const F = (x) => `<${P}formula>${esc(String(x).replace(/^=/, ''))}</${P}formula>`
  const head = (type, more = '', withDxf = true) => `<${P}cfRule type="${type}"${withDxf ? ` dxfId="${SW.dxf(normStyle(r.style))}"` : ''} priority="${pri}"${stop}${more}`
  if (r.type === 'highlightCell') {
    switch (r.subType) {
      case 'number': {
        const op = r.operator || 'equal'
        if (!CF_NUM_OPS.includes(op)) return why('a conditional format with a rule Excel has no form of')
        const vs = Array.isArray(r.value) ? r.value : [r.value ?? 0]
        return `${head('cellIs', ` operator="${op}"`)}>${(op.endsWith('etween') ? vs.slice(0, 2) : vs.slice(0, 1)).map(F).join('')}</${P}cfRule>`
      }
      case 'text': {
        const v = String(r.value ?? '')
        const op = r.operator
        if (op === 'equal' || op === 'notEqual') return `${head('cellIs', ` operator="${op}"`)}>${F(qs(v))}</${P}cfRule>`
        const map = {
          containsText: ['containsText', ` operator="containsText" text="${esc(v)}"`, `NOT(ISERROR(SEARCH(${qs(v)},${T})))`],
          notContainsText: ['notContainsText', ` operator="notContains" text="${esc(v)}"`, `ISERROR(SEARCH(${qs(v)},${T}))`],
          beginsWith: ['beginsWith', ` operator="beginsWith" text="${esc(v)}"`, `LEFT(${T},LEN(${qs(v)}))=${qs(v)}`],
          endsWith: ['endsWith', ` operator="endsWith" text="${esc(v)}"`, `RIGHT(${T},LEN(${qs(v)}))=${qs(v)}`],
          containsBlanks: ['containsBlanks', '', `LEN(TRIM(${T}))=0`],
          notContainsBlanks: ['notContainsBlanks', '', `LEN(TRIM(${T}))>0`],
          containsErrors: ['containsErrors', '', `ISERROR(${T})`],
          notContainsErrors: ['notContainsErrors', '', `NOT(ISERROR(${T}))`],
        }[op]
        if (!map) return why('a conditional format with a rule Excel has no form of')
        return `${head(map[0], map[1])}>${F(map[2])}</${P}cfRule>`
      }
      case 'timePeriod': {
        const f = PERIOD_F[r.operator]
        if (!f) return why('a conditional format with a rule Excel has no form of')
        return `${head('timePeriod', ` timePeriod="${r.operator}"`)}>${F(f.replace(/\bT\b/g, T))}</${P}cfRule>`
      }
      case 'duplicateValues': return `${head('duplicateValues')}/>`
      case 'uniqueValues': return `${head('uniqueValues')}/>`
      case 'rank': return `${head('top10', `${r.isPercent ? ' percent="1"' : ''}${r.isBottom ? ' bottom="1"' : ''} rank="${Math.max(1, Math.round(Number(r.value) || 10))}"`)}/>`
      case 'average': {
        const more = { greaterThan: '', greaterThanOrEqual: ' equalAverage="1"', lessThan: ' aboveAverage="0"', lessThanOrEqual: ' aboveAverage="0" equalAverage="1"' }[r.operator]
        if (more == null) return why('a conditional format comparing with the average in a way Excel has no form of')
        return `${head('aboveAverage', more)}/>`
      }
      case 'formula': return `${head('expression')}>${F(r.value || 'FALSE')}</${P}cfRule>`
      default: return why('a conditional format with a rule Excel has no form of')
    }
  }
  if (r.type === 'colorScale') {
    const list = [...(r.config || [])].sort((a, b) => a.index - b.index)
    return `${head('colorScale', '', false)}><${P}colorScale>${list.map((c) => cfvoXml(c.value, P)).join('')}${list.map((c) => `<${P}color rgb="${argb(c.color)}"/>`).join('')}</${P}colorScale></${P}cfRule>`
  }
  if (r.type === 'dataBar') {
    const c = r.config || {}
    return `${head('dataBar', '', false)}><${P}dataBar${r.isShowValue === false ? ' showValue="0"' : ''}>${cfvoXml(c.min || { type: 'min' }, P)}${cfvoXml(c.max || { type: 'max' }, P)}<${P}color rgb="${argb(c.positiveColor || '#638ec6')}"/></${P}dataBar></${P}cfRule>`
  }
  if (r.type === 'iconSet') {
    const list = r.config || []
    const n = list.length
    const set = list[0]?.iconType
    if (!n || !ICON_SETS.includes(set) || list.some((c) => c.iconType !== set)) why('icons in a conditional format that Excel has no set of')
    const plain = list.every((c, k) => c.iconId === String(k)), rev = list.every((c, k) => c.iconId === String(n - 1 - k))
    if (!plain && !rev) why('icons in a conditional format in an order Excel has no form of')
    const vos = [cfvoXml({ type: 'percent', value: 0 }, P)]
    for (let k = 1; k < n; k++) { const c = list[n - 1 - k]; vos.push(cfvoXml(c.value, P, c.operator === 'greaterThan' ? ' gte="0"' : '')) }
    return `${head('iconSet', '', false)}><${P}iconSet iconSet="${ICON_SETS.includes(set) ? set : '3TrafficLights1'}"${r.isShowValue === false ? ' showValue="0"' : ''}${rev && !plain ? ' reverse="1"' : ''}>${vos.join('')}</${P}iconSet></${P}cfRule>`
  }
  return why('a conditional format of a kind Excel has no form of')
}

const DV_BACK = { whole: 'whole', decimal: 'decimal', list: 'list', listMultiple: 'list', date: 'date', time: 'time', textLength: 'textLength', custom: 'custom', any: 'none', checkbox: 'list' }
const ERR_BACK = { 0: 'information', 1: 'stop', 2: 'warning' }
function dvValue(type, f) {
  if (f == null || f === '') return null
  const s = String(f)
  if (s.startsWith('=')) return s.slice(1)
  if (type === 'list' || type === 'listMultiple') return qs(s)
  if ((type === 'date' || type === 'time') && !isNum(s)) {
    const d = Date.parse(/T|\d:\d/.test(s) && type === 'date' ? s : type === 'time' ? `1970-01-01T${s}Z` : `${s}T00:00:00Z`)
    if (Number.isFinite(d)) return String(type === 'time' ? (d / 86400000) % 1 : d / 86400000 + 25569)
  }
  return s
}
function dvXml(u, P, why) {
  const type = DV_BACK[u.type] || 'none'
  if (u.type === 'checkbox') why('a checkbox, which Excel keeps as a list of two values')
  if (!DV_BACK[u.type]) why('a validation rule Excel has no form of')
  let f1 = dvValue(u.type, u.formula1), f2 = dvValue(u.type, u.formula2)
  if (u.type === 'checkbox') { f1 = qs(`${u.formula1 ?? 'TRUE'},${u.formula2 ?? 'FALSE'}`); f2 = null }
  const a = [`type="${type}"`]
  if (u.errorStyle != null && u.errorStyle !== 1) a.push(`errorStyle="${ERR_BACK[u.errorStyle] || 'stop'}"`)
  if (u.operator && !['list', 'custom', 'none'].includes(type) && u.operator !== 'between') a.push(`operator="${u.operator}"`)
  if (u.allowBlank) a.push('allowBlank="1"')
  if (type === 'list' && u.showDropDown === false) a.push('showDropDown="1"')
  if (u.showInputMessage) a.push('showInputMessage="1"')
  if (u.showErrorMessage) a.push('showErrorMessage="1"')
  for (const k of ['errorTitle', 'error', 'promptTitle', 'prompt']) if (u[k] != null && u[k] !== '') a.push(`${k}="${esc(u[k])}"`)
  a.push(`sqref="${sqrefOf(u.ranges || [])}"`)
  const body = `${f1 != null ? `<${P}formula1>${esc(f1)}</${P}formula1>` : ''}${f2 != null && /between/i.test(u.operator || 'between') ? `<${P}formula2>${esc(f2)}</${P}formula2>` : ''}`
  return `<${P}dataValidation ${a.join(' ')}${body ? `>${body}</${P}dataValidation>` : '/>'}`
}
function filterXml(f, P) {
  const g = f.ref
  const cols = (f.filterColumns || []).filter((c) => c.colId >= g.startColumn && c.colId <= g.endColumn).sort((a, b) => a.colId - b.colId).map((c) => {
    let inner = ''
    if (c.filters) inner = `<${P}filters${c.filters.blank ? ' blank="1"' : ''}>${(c.filters.filters || []).map((v) => `<${P}filter val="${esc(v)}"/>`).join('')}</${P}filters>`
    else if (c.customFilters) inner = `<${P}customFilters${c.customFilters.and ? ' and="1"' : ''}>${(c.customFilters.customFilters || []).map((x) => `<${P}customFilter${x.operator && x.operator !== 'equal' ? ` operator="${x.operator}"` : ''} val="${esc(x.val)}"/>`).join('')}</${P}customFilters>`
    else return ''
    return `<${P}filterColumn colId="${c.colId - g.startColumn}">${inner}</${P}filterColumn>`
  }).join('')
  return `<${P}autoFilter ref="${refOf(g)}"${cols ? `>${cols}</${P}autoFilter>` : '/>'}`
}
const filterKey = (f) => (f ? JSON.stringify({ ref: [f.ref.startRow, f.ref.endRow, f.ref.startColumn, f.ref.endColumn], cols: (f.filterColumns || []).map((c) => ({ colId: c.colId, filters: c.filters ? { blank: !!c.filters.blank, filters: [...(c.filters.filters || [])].map(String) } : null, custom: c.customFilters ? { and: !!c.customFilters.and, list: c.customFilters.customFilters.map((x) => [x.operator || 'equal', String(x.val)]) } : null })).sort((a, b) => a.colId - b.colId) }) : '')
// What a rule says, leaving out where it is (its ranges and id).
const ruleKey = (u, drop = ['ranges', 'cfId', 'uid']) => JSON.stringify(u, (k, v) => (drop.includes(k) ? undefined : v))
const rangesKey = (rs) => JSON.stringify((rs || []).map((g) => [g.startRow, g.endRow, g.startColumn, g.endColumn]))

// A value written the same whatever order its keys came in, without empty ones.
const canon = (x) => JSON.stringify(x, function (k, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().filter((key) => v[key] != null && v[key] !== '').map((key) => [key, v[key]]))
  return v
})
const cfKey = (u) => canon({ rule: u.rule, stop: !!u.stopIfTrue })
const DV_FIELDS = ['type', 'formula1', 'formula2', 'operator', 'error', 'errorTitle', 'prompt', 'promptTitle']
const dvKey = (u) => canon({ ...Object.fromEntries(DV_FIELDS.map((k) => [k, u[k] == null ? '' : String(u[k])])), allowBlank: !!u.allowBlank, showErrorMessage: !!u.showErrorMessage, showInputMessage: !!u.showInputMessage, errorStyle: u.errorStyle ?? 1, showDropDown: u.type === 'list' ? u.showDropDown !== false : true })
const noteKey = (list) => canon(list.map((n) => [n.r, n.c, n.text]).sort((a, b) => a[0] - b[0] || a[1] - b[1]))

// ---------- Notes (Excel's comments and the boxes it draws them in) ----------
const VML_NS = 'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"'
const NOTE_TYPE = '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>'
const noteShape = (n, id) => `<v:shape id="_x0000_s${id}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:${id % 1024};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${n.c + 1}, 15, ${Math.max(0, n.r - 1)}, 2, ${n.c + 3}, 15, ${n.r + 3}, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${n.r}</x:Row><x:Column>${n.c}</x:Column></x:ClientData></v:shape>`
// The notes' boxes: the old ones out, one for each note in; anything else drawn there (a button) stays.
function vmlWith(vml, notes, block) {
  block = Number(/<o:idmap\b[^>]*data="(\d+)/.exec(vml || '')?.[1]) || block
  let x = vml || `<xml ${VML_NS}><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${block}"/></o:shapelayout>${NOTE_TYPE}</xml>`
  for (const s of each(x, 'shape').filter((s) => /ObjectType="Note"/.test(s.inner)).reverse()) x = x.slice(0, s.i) + x.slice(s.j)
  if (!/_x0000_t202/.test(x)) x = x.replace(/<\/xml>\s*$/, `${NOTE_TYPE}</xml>`)
  const used = new Set([...x.matchAll(/_x0000_s(\d+)/g)].map((m) => Number(m[1])))
  let id = block * 1024 + 1
  const shapes = notes.map((n) => { while (used.has(id)) id++; used.add(id); return noteShape(n, id) }).join('')
  return x.replace(/<\/xml>\s*$/, `${shapes}</xml>`)
}
const commentXml = (n, P) => `<${P}comment ref="${a1(n.r, n.c)}" authorId="0"><${P}text><${P}r><${P}t xml:space="preserve">${escText(n.text)}</${P}t></${P}r></${P}text></${P}comment>`
// Notes' places moved with rows and columns: in comments, ref; in their boxes, row, column and anchor.
function shiftComments(xml, rows, cols) {
  return xml.replace(/(<(?:[\w.-]+:)?comment\b[^>]*?\sref=")([^"]+)(")/g, (m, a, ref, b) => { const g = rangeOf(ref); const s = g && shiftRange(g, rows, cols); return s ? `${a}${refOf(s)}${b}` : m })
}
function shiftVml(xml, rows, cols) {
  return xml.replace(/<x:ClientData\b[\s\S]*?<\/x:ClientData>/g, (cd) => {
    if (!/ObjectType="Note"/.test(cd)) return cd
    return cd.replace(/<x:Row>(\d+)<\/x:Row>/, (m, r) => `<x:Row>${rows ? rows(Number(r)) ?? Number(r) : r}</x:Row>`)
      .replace(/<x:Column>(\d+)<\/x:Column>/, (m, c) => `<x:Column>${cols ? cols(Number(c)) ?? Number(c) : c}</x:Column>`)
      .replace(/<x:Anchor>([^<]*)<\/x:Anchor>/, (m, a) => { const v = a.split(',').map((x) => Number(x.trim())); if (v.length !== 8) return m; const C = (i) => (cols ? cols(v[i]) ?? v[i] : v[i]), R = (i) => (rows ? rows(v[i]) ?? v[i] : v[i]); return `<x:Anchor>${[C(0), v[1], R(2), v[3], C(4), v[5], R(6), v[7]].join(', ')}</x:Anchor>` })
  })
}
// Pictures and charts anchored to cells: their corners move with rows and columns.
function shiftAnchors(xml, rows, cols) {
  return xml.replace(/<((?:[\w.-]+:)?)(from|to)>([\s\S]*?)<\/\1\2>/g, (m, p, tag, inner) => {
    let s = inner
    if (rows) s = s.replace(new RegExp(`<${reEsc(p)}row>(\\d+)</${reEsc(p)}row>`), (x, r) => { let n = rows(Number(r)); if (n == null) { let k = Number(r); while (k > 0 && rows(k) == null) k--; n = rows(k) ?? 0 } return `<${p}row>${n}</${p}row>` })
    if (cols) s = s.replace(new RegExp(`<${reEsc(p)}col>(\\d+)</${reEsc(p)}col>`), (x, c) => { let n = cols(Number(c)); if (n == null) { let k = Number(c); while (k > 0 && cols(k) == null) k--; n = cols(k) ?? 0 } return `<${p}col>${n}</${p}col>` })
    return `<${p}${tag}>${s}</${p}${tag}>`
  })
}

// ---------- Writing ----------
const CT = {
  sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  comments: 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml',
  vml: 'application/vnd.openxmlformats-officedocument.vmlDrawing',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
}
const RT = (t) => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`
function contentTypes(xml) {
  let x = xml
  return {
    get xml() { return x },
    override(path, type) { const p = `/${path}`; x = x.replace(new RegExp(`<Override[^>]*PartName="${reEsc(p)}"[^>]*/>`), ''); if (type) x = x.replace(/<\/Types>\s*$/, `<Override PartName="${esc(p)}" ContentType="${esc(type)}"/></Types>`) },
    has(path) { return x.includes(`PartName="/${path}"`) },
    def(ext, type) { if (!new RegExp(`<Default[^>]*Extension="${reEsc(ext)}"`, 'i').test(x)) x = x.replace(/<\/Types>\s*$/, `<Default Extension="${ext}" ContentType="${type}"/></Types>`) },
  }
}

// A cell as Excel writes it, from Univer's: its formula and last result, or its value; s its format.
function cellXmlOf(ref, cell, s, P, wasError) {
  const sa = s ? ` s="${s}"` : ''
  const d = cell.p ? docBits(cell.p) : null
  const f = cell.f ? String(cell.f).replace(/^=/, '') : ''
  const v = cell.v
  if (f) {
    const ff = `<${P}f>${escText(fileFormula(f))}</${P}f>`
    if (v == null || v === '') return `<${P}c r="${ref}"${sa}>${ff}</${P}c>`
    if (cell.t === 3 || typeof v === 'boolean') return `<${P}c r="${ref}"${sa} t="b">${ff}<${P}v>${valueKey(v, 3).endsWith('1') ? 1 : 0}</${P}v></${P}c>`
    if (typeof v === 'number' || (cell.t === 2 && Number.isFinite(Number(v)))) return `<${P}c r="${ref}"${sa}>${ff}<${P}v>${numText(Number(v))}</${P}v></${P}c>`
    if (ERRORS.has(String(v))) return `<${P}c r="${ref}"${sa} t="e">${ff}<${P}v>${esc(v)}</${P}v></${P}c>`
    return `<${P}c r="${ref}"${sa} t="str">${ff}<${P}v>${escText(v)}</${P}v></${P}c>`
  }
  if (d) {
    const runs = (cell.p.body.textRuns || []).filter((r) => r.ed > r.st && normStyle(r.ts)).sort((a, b) => a.st - b.st)
    if (!runs.length) return `<${P}c r="${ref}"${sa} t="inlineStr"><${P}is><${P}t xml:space="preserve">${escText(d.text)}</${P}t></${P}is></${P}c>`
    const out = []
    let at = 0
    const run = (t, ts) => { if (!t) return; const n = normStyle(ts); const pr = n ? `<${P}rPr>${[n.bl && `<${P}b/>`, n.it && `<${P}i/>`, n.st && `<${P}strike/>`, n.ul && `<${P}u/>`, n.va === 3 && `<${P}vertAlign val="superscript"/>`, n.va === 2 && `<${P}vertAlign val="subscript"/>`, n.fs && `<${P}sz val="${n.fs}"/>`, n.cl && `<${P}color rgb="${argb(n.cl.rgb)}"/>`, n.ff && `<${P}rFont val="${esc(n.ff)}"/>`].filter(Boolean).join('')}</${P}rPr>` : ''; out.push(`<${P}r>${pr}<${P}t xml:space="preserve">${escText(t)}</${P}t></${P}r>`) }
    for (const r of runs) { run(d.text.slice(at, Math.max(at, r.st)), null); run(d.text.slice(Math.max(at, r.st), r.ed), r.ts); at = Math.max(at, r.ed) }
    run(d.text.slice(at), null)
    return `<${P}c r="${ref}"${sa} t="inlineStr"><${P}is>${out.join('')}</${P}is></${P}c>`
  }
  if (v == null || v === '') return `<${P}c r="${ref}"${sa}/>`
  if (cell.t === 3 || typeof v === 'boolean') return `<${P}c r="${ref}"${sa} t="b"><${P}v>${valueKey(v, 3).endsWith('1') ? 1 : 0}</${P}v></${P}c>`
  if (typeof v === 'number' || (cell.t === 2 && v !== '' && Number.isFinite(Number(v)))) return `<${P}c r="${ref}"${sa}><${P}v>${numText(Number(v))}</${P}v></${P}c>`
  if (wasError && ERRORS.has(String(v))) return `<${P}c r="${ref}"${sa} t="e"><${P}v>${esc(v)}</${P}v></${P}c>`
  return `<${P}c r="${ref}"${sa} t="inlineStr"><${P}is><${P}t xml:space="preserve">${escText(v)}</${P}t></${P}is></${P}c>`
}

// A formula's last result, as Univer worked it out: the same when the numbers agree to 12 digits.
// Excel's is kept where Univer couldn't work one out (#NAME?, a function it doesn't have) or the
// formula changes every time (TODAY, RAND), which Excel works out again on opening anyway.
const VOLATILE = /(^|[^\w.])(TODAY|NOW|RAND|RANDBETWEEN|RANDARRAY|OFFSET|INDIRECT|CELL|INFO)\s*\(/i
const resultKey = (v, t) => { const k = valueKey(v, t); return k.startsWith('n:') ? `n:${Number(Number(k.slice(2)).toPrecision(12))}` : k }
function resultSame(bc, nc) {
  if (!nc?.f || VOLATILE.test(nc.f)) return true
  const nv = nc.v
  if (nv == null || nv === '' || nv === '#NAME?') return true
  return resultKey(bc?.v, bc?.t) === resultKey(nv, nc.t)
}
// A formula cell as written, with a new last result (and its type) in place of the old.
function withResult(x, nc) {
  const v = nc.v
  let t = null, txt
  if (nc.t === 3 || typeof v === 'boolean') { t = 'b'; txt = valueKey(v, 3).endsWith('1') ? '1' : '0' }
  else if (typeof v === 'number' || (nc.t === 2 && v !== '' && Number.isFinite(Number(v)))) txt = numText(Number(v))
  else if (ERRORS.has(String(v))) { t = 'e'; txt = esc(v) }
  else { t = 'str'; txt = escText(v) }
  const pfx = (/^<((?:[\w.-]+:)?)c\b/.exec(x) || [])[1] || ''
  const nv = `<${pfx}v>${txt}</${pfx}v>`
  x = x.replace(/^<[^>]*>/, (o) => setAttr(o, 't', t))
  const vre = /<((?:[\w.-]+:)?)v(?:\s[^>]*)?>[\s\S]*?<\/\1v>|<(?:[\w.-]+:)?v\s*\/>/
  if (vre.test(x)) return x.replace(vre, nv)
  return x.replace(/(<\/(?:[\w.-]+:)?f>|<(?:[\w.-]+:)?f\b[^>]*\/>)/, `$1${nv}`)
}

// Univer's copied formulas (cells with only si) written out from the first cell with it.
function expandShared(sheet) {
  const firsts = new Map()
  for (const [r, row] of Object.entries(sheet.cellData || {})) for (const [c, cell] of Object.entries(row || {})) if (cell?.si && cell.f) firsts.set(cell.si, { r: Number(r), c: Number(c), f: String(cell.f).replace(/^=/, '') })
  for (const [r, row] of Object.entries(sheet.cellData || {})) {
    for (const [c, cell] of Object.entries(row || {})) {
      if (!cell?.si || cell.f) continue
      const m = firsts.get(cell.si)
      if (m) row[c] = { ...cell, f: `=${moveFormula(m.f, Number(r) - m.r, Number(c) - m.c)}` }
    }
  }
}
const linkOf = (cell) => { const r = (cell?.p?.body?.customRanges || []).find((x) => x.rangeType === 0 && x.properties?.url); return r ? String(r.properties.url) : null }
const notesIn = (res, id) => Object.values(res[id] || {}).flatMap((cols) => Object.values(cols || {})).filter((n) => n && n.note != null && String(n.note) !== '').map((n) => ({ r: Number(n.row), c: Number(n.col), text: String(n.note) }))

// One sheet's XML patched to match Univer's sheet: only what changed is rewritten.
function patchSheet(W, sh, now) {
  const { book, data, ops, SW } = W
  const b = sh.univer
  const rows = axisMap(ops, sh.id, 'row'), cols = axisMap(ops, sh.id, 'col')
  const moved = ops.some((o) => o.sheet === sh.id && /^move/.test(o.op))
  const S = split(sh.xml)
  const P = S.prefix
  const name = now.name || sh.name
  const why = (m) => W.why(`${m} on ${name}`)
  const item = (n) => S.items.find((x) => x.name === n)
  const put = (n, xml) => place(S, n, xml, WS_ORDER)
  const fixF = (f) => W.fixFormula(f, sh.name)
  // formulas inside XML kept as it was: moved and renamed as the sheets were
  const fixIn = (xml) => (W.fixing ? xml.replace(/(<((?:[\w.-]+:)?)(formula|formula1|formula2|f)>)([\s\S]*?)(<\/\2\3>)/g, (m, o, p, t, inner, c) => `${o}${esc(fixF(unx(inner)))}${c}`).replace(/(\slocation=")([^"]*)(")/g, (m, a, v, z) => `${a}${esc(fixF(unx(v)))}${z}`) : xml)
  const res = W.res
  // ---------- Cells ----------
  const fwd = (r, c) => [rows ? rows(r) : r, cols ? cols(c) : c]
  const origin = new Map()
  const addOrigin = (r0, c0) => { const [r, c] = fwd(r0, c0); if (r != null && c != null) origin.set(`${r},${c}`, [r0, c0]) }
  for (const [r0, row] of sh.rows) for (const c0 of row.cells.keys()) addOrigin(r0, c0)
  for (const [r0, row] of Object.entries(b.cellData)) for (const c0 of Object.keys(row)) addOrigin(Number(r0), Number(c0))
  const nowCells = now.cellData || {}
  const keys = new Set(origin.keys())
  for (const [r, row] of Object.entries(nowCells)) for (const c of Object.keys(row || {})) if (row[c]) keys.add(`${r},${c}`)
  const verdict = new Map() // key -> { o, rec, bc, nc, same }
  const broken = new Set() // shared formula groups with a cell changed or moved
  for (const key of keys) {
    const [r, c] = key.split(',').map(Number)
    const o = origin.get(key)
    const rec = o ? sh.rows.get(o[0])?.cells.get(o[1]) : null
    const bc = o ? b.cellData[o[0]]?.[o[1]] : null
    const nc = nowCells[r]?.[c] || null
    const bcNow = bc?.f ? { ...bc, f: `=${fixF(bc.f.slice(1))}` } : bc
    const same = cellKey(bcNow, book.data) === cellKey(nc, data)
    const shared = rec?.f?.t === 'shared' ? rec.f.si : null
    const shift = !!o && (o[0] !== r || o[1] !== c)
    if (shared != null && (!same || shift || (bc?.f && bcNow.f !== bc.f))) broken.add(shared)
    const fresh = same && !!rec?.f && !rec.f.keep && !resultSame(bc, nc)
    verdict.set(key, { r, c, o, rec, bc, nc, same, shared, shift, fresh })
  }
  // Shared formulas a cell of which went away entirely
  for (const [r0, row] of sh.rows) for (const [c0, rec] of row.cells) if (rec.f?.t === 'shared') { const [r, c] = fwd(r0, c0); if (r == null || c == null) broken.add(rec.f.si) }
  const out = new Map() // r -> [[c, xml]]
  let cellsChanged = false
  const rowsTouched = new Set()
  const emit = (r, c, xml) => { if (!out.has(r)) out.set(r, []); out.get(r).push([c, xml]) }
  for (const v of verdict.values()) {
    const { r, c, rec, bc, nc, same, shared, shift, fresh } = v
    if (same && !(shared != null && broken.has(shared))) {
      if (!rec) continue
      let x = rec.xml
      if (shift) x = x.replace(/^<[^>]*>/, (open) => setAttr(open, 'r', a1(r, c)))
      if (rec.f && !rec.f.keep) {
        x = x.replace(/(<((?:[\w.-]+:)?)f\b)([^>]*?)(\/>|>([\s\S]*?)<\/\2f>)/, (m, start, p, at, rest, inner) => {
          let a2 = at
          if (rec.f.ref && (rows || cols)) { const g = rangeOf(rec.f.ref); const s2 = g && shiftRange(g, rows, cols, moved); if (s2) a2 = setAttr(`<f${at}>`, 'ref', refOf(s2)).slice(2, -1) }
          if (inner == null) return `${start}${a2}${rest}`
          return `${start}${a2}>${escText(fixF(unxl(unx(inner))))}</${p}f>`
        })
        // the same formula with a new result (an input changed): only its last result is new
        if (fresh) x = withResult(x, nc)
        if (x !== rec.xml && !shift) { cellsChanged = true; rowsTouched.add(r) }
      }
      if (shift) { cellsChanged = true; rowsTouched.add(r) }
      emit(r, c, x)
      continue
    }
    cellsChanged = true
    rowsTouched.add(r)
    if (bc?.f || nc?.f || rec?.f) W.formulasChanged = true
    if (!nc) continue
    const bs = styleIn(book.data, bc?.s), ns = styleIn(data, nc.s)
    if (!nc.f && !nc.p && (nc.v == null || nc.v === '') && !ns) continue
    const s = same || canon(bs) === canon(ns) ? rec?.s || 0 : SW.xf(rec?.s || 0, bs, ns)
    emit(r, c, cellXmlOf(a1(r, c), nc, s, P, rec?.t === 'e'))
  }
  // ---------- Rows ----------
  const invRow = new Map()
  for (const r0 of sh.rows.keys()) { const r = rows ? rows(r0) : r0; if (r != null) invRow.set(r, r0) }
  const rowKeys = new Set([...invRow.keys(), ...out.keys(), ...Object.keys(now.rowData || {}).map(Number)])
  const filterRows = W.filterRows.get(sh.id)
  if (filterRows) for (const r of filterRows.scope) rowKeys.add(r)
  const defB = b.defaultRowHeight || 20, defN = now.defaultRowHeight || defB
  let rowsChanged = false
  const rowXml = []
  for (const r of [...rowKeys].sort((x, y) => x - y)) {
    const r0 = invRow.get(r)
    const rec = r0 != null ? sh.rows.get(r0) : null
    const rdb = r0 != null ? b.rowData[r0] : null
    const rdn = now.rowData?.[r] || null
    let open = rec ? rec.open : `<${P}row r="${r + 1}">`
    const was = open
    if (rec && r0 !== r) open = setAttr(open, 'r', String(r + 1))
    const eb = rdb?.h ?? defB, en = rdn?.h ?? defN
    if (Math.abs(eb - en) >= 1) open = setAttr(setAttr(open, 'ht', String(Math.round(en * 0.75 * 100) / 100)), 'customHeight', '1')
    let hide = !!rdn?.hd
    if (!!rdb?.hd !== hide) open = setAttr(open, 'hidden', hide ? '1' : null)
    if (filterRows?.scope.has(r)) { hide = hide || filterRows.hide.has(r); open = setAttr(open, 'hidden', hide ? '1' : null) }
    const sb = styleIn(book.data, rdb?.s), sn = styleIn(data, rdn?.s)
    if (canon(sb) !== canon(sn)) { const s = sn ? SW.xf(Number(rec?.attrs.s) || 0, sb, sn) : 0; open = setAttr(setAttr(open, 's', s ? String(s) : null), 'customFormat', s ? '1' : null) }
    const cells = (out.get(r) || []).sort((x, y) => x[0] - y[0])
    if (open !== was) rowsChanged = true
    if (rowsTouched.has(r) || cols) open = setAttr(open, 'spans', null)
    const extra = Object.keys(attrs(open)).filter((k) => k !== 'r' && k !== 'spans')
    if (!cells.length && !extra.length) continue
    rowXml.push(cells.length ? `${open.replace(/\s*\/>$/, '>')}${cells.map((x) => x[1]).join('')}</${P}row>` : open.endsWith('/>') ? open : open.replace(/>$/, '/>'))
  }
  if (cellsChanged || rowsChanged || rows || cols) {
    const sd = item('sheetData')
    const sdOpen = sd ? /^<[^>]*>/.exec(sd.xml)[0].replace(/\s*\/>$/, '>') : `<${P}sheetData>`
    const xml = rowXml.length ? `${sdOpen}${rowXml.join('')}</${P}sheetData>` : sdOpen.replace(/>$/, '/>')
    if (!sd || sd.xml !== xml) {
      put('sheetData', xml)
      W.cellsChanged = W.cellsChanged || cellsChanged
      let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1
      for (const [r, list] of out) for (const [c] of list) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c) }
      const dim = r1 < 0 ? 'A1' : refOf({ startRow: r0, endRow: r1, startColumn: c0, endColumn: c1 })
      const d = item('dimension')
      put('dimension', d ? d.xml.replace(/^<[^>]*>/, (o) => setAttr(o, 'ref', dim)) : `<${P}dimension ref="${dim}"/>`)
    }
  }
  // ---------- Columns ----------
  patchCols(W, sh, now, S, cols, P)
  // ---------- Merges ----------
  const bm = b.mergeData.map((g) => shiftRange(g, rows, cols, moved)).filter(Boolean).map(refOf).sort()
  const nm = (now.mergeData || []).map(refOf).sort()
  if (bm.join() !== nm.join() || ((rows || cols) && nm.length)) put('mergeCells', nm.length ? `<${P}mergeCells count="${nm.length}">${nm.map((x) => `<${P}mergeCell ref="${x}"/>`).join('')}</${P}mergeCells>` : null)
  // ---------- How it's shown: frozen rows and columns, gridlines, zoom, right to left ----------
  const fb = b.freeze || {}, fn = now.freeze || {}
  const fx = Math.max(0, fn.xSplit | 0), fy = Math.max(0, fn.ySplit | 0)
  const freezeChanged = (fb.xSplit | 0) !== fx || (fb.ySplit | 0) !== fy
  const grid = (x) => (x === 0 || x === false ? 0 : 1)
  const gridChanged = grid(b.showGridlines) !== grid(now.showGridlines)
  const zoomChanged = now.zoomRatio != null && Math.abs((b.zoomRatio || 1) - (now.zoomRatio || 1)) > 0.001
  const rtlChanged = !!b.rightToLeft !== !!now.rightToLeft
  if (freezeChanged || gridChanged || zoomChanged || rtlChanged) {
    const sv = item('sheetViews')
    let svXml = sv ? sv.xml : `<${P}sheetViews><${P}sheetView workbookViewId="0"/></${P}sheetViews>`
    const v = one(svXml, 'sheetView')
    let { open, inner } = parts(v.xml)
    if (gridChanged) open = setAttr(open, 'showGridLines', grid(now.showGridlines) ? null : '0')
    if (zoomChanged) open = setAttr(open, 'zoomScale', Math.round((now.zoomRatio || 1) * 100) === 100 ? null : String(Math.round((now.zoomRatio || 1) * 100)))
    if (rtlChanged) open = setAttr(open, 'rightToLeft', now.rightToLeft ? '1' : null)
    if (freezeChanged) {
      const ks = kids(inner).filter((k) => k.name !== 'pane' && !(k.name === 'selection' && /\spane=/.test(k.xml)))
      const pane = fx || fy ? `<${P}pane${fx ? ` xSplit="${fx}"` : ''}${fy ? ` ySplit="${fy}"` : ''} topLeftCell="${a1(fy, fx)}" activePane="${fx && fy ? 'bottomRight' : fy ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : ''
      inner = pane + ks.map((k) => k.xml).join('')
    }
    svXml = svXml.slice(0, v.i) + build(open, inner) + svXml.slice(v.j)
    put('sheetViews', svXml)
  }
  // ---------- Tab colour ----------
  if ((hexOf(b.tabColor) || '') !== (hexOf(now.tabColor) || '')) {
    const pr = item('sheetPr')
    let { open, inner } = parts(pr ? pr.xml : `<${P}sheetPr/>`)
    const ks = kids(inner).filter((k) => k.name !== 'tabColor')
    inner = (hexOf(now.tabColor) ? `<${P}tabColor rgb="${argb(now.tabColor)}"/>` : '') + ks.map((k) => k.xml).join('')
    put('sheetPr', inner || Object.keys(attrs(open)).length ? build(open, inner) : null)
  }
  // ---------- Filter ----------
  const fbase = sh.filter && !sh.filter.unsupported ? sh.filter : null
  const fnowRaw = W.has.filter ? res.filter[sh.id] : fbase
  const fnow = fnowRaw?.ref ? fnowRaw : null
  const shiftF = (f) => { if (!f) return null; const ref = shiftRange(f.ref, rows, cols, moved); if (!ref) return null; return { ...f, ref, filterColumns: (f.filterColumns || []).map((c) => ({ ...c, colId: cols ? cols(c.colId) : c.colId })).filter((c) => c.colId != null) } }
  const fwas = shiftF(fbase)
  if (fnow) {
    if (filterKey(fwas) !== filterKey(fnow) || rows || cols) { put('autoFilter', filterXml(fnow, P)); W.filterNames.set(sh.id, fnow.ref) }
  } else if (sh.filter?.unsupported && (W.has.filter ? !res.filter[sh.id] : true)) {
    // a filter Univer can't show (by colour, by date group) stays as Excel had it
    if (rows || cols) put('autoFilter', sh.filterXml.replace(/^<[^>]*>/, (o) => { const g = shiftRange(rangeOf(attrs(o).ref), rows, cols, moved); return g ? setAttr(o, 'ref', refOf(g)) : o }))
  } else if (fbase) { put('autoFilter', null); W.filterNames.set(sh.id, null) }
  // ---------- Conditional formats ----------
  patchCf(W, sh, S, P, rows, cols, moved, fixIn, why)
  // ---------- Data validation ----------
  patchDv(W, sh, S, P, rows, cols, moved, fixIn, why)
  // ---------- Links ----------
  patchLinks(W, sh, now, S, P, rows, cols, moved, fixIn)
  // ---------- Notes ----------
  patchNotes(W, sh, S, P, rows, cols)
  // ---------- Rows and columns moved: the rest of the sheet that names cells ----------
  if (rows || cols) {
    for (const n of ['ignoredErrors', 'protectedRanges']) {
      const it = item(n)
      if (it) put(n, it.xml.replace(/(\ssqref=")([^"]*)(")/g, (m, a, v, z) => `${a}${shiftSqref(v, rows, cols, moved)}${z}`))
    }
    const sv = item('sheetViews')
    if (sv) put('sheetViews', sv.xml.replace(/<((?:[\w.-]+:)?)selection\b[^>]*?\/>/g, (s) => { const a = attrs(s); let t = s; if (a.activeCell) { const g = shiftRange(rangeOf(a.activeCell) || {}, rows, cols, moved); t = setAttr(t, 'activeCell', g ? refOf({ ...g, endRow: g.startRow, endColumn: g.startColumn }) : 'A1') } if (a.sqref) t = setAttr(t, 'sqref', shiftSqref(a.sqref, rows, cols, moved) || 'A1'); return t }))
    for (const [n, map] of [['rowBreaks', rows], ['colBreaks', cols]]) {
      const it = item(n)
      if (it && map) put(n, it.xml.replace(/(<(?:[\w.-]+:)?brk\b[^>]*?\sid=")(\d+)(")/g, (m, a, v, z) => `${a}${map(Number(v)) ?? v}${z}`))
    }
    const ext = item('extLst')
    if (ext) put('extLst', ext.xml.replace(/(<xm:sqref>)([^<]*)(<\/xm:sqref>)/g, (m, a, v, z) => `${a}${shiftSqref(v, rows, cols, moved)}${z}`))
  }
  // x14 rules and sparklines name cells in formulas too
  const ext = item('extLst')
  if (ext && W.fixing) put('extLst', ext.xml.replace(/(<xm:f>)([\s\S]*?)(<\/xm:f>)/g, (m, a, v, z) => `${a}${esc(fixF(unx(v)))}${z}`))
  const xml = joinParts(S)
  if (!wellFormed(xml)) throw new Error(`Couldn't write the sheet ${name}: its XML came out broken`)
  return xml === sh.xml ? null : xml
}

// <cols>: each column's width, hidden state and format, kept as written where nothing changed.
const COL_ATTRS = ['min', 'max', 'width', 'style', 'hidden', 'bestFit', 'customWidth', 'phonetic', 'outlineLevel', 'collapsed']
function patchCols(W, sh, now, S, cols, P) {
  const b = sh.univer
  const cap = b.columnCount + 50
  const defB = b.defaultColumnWidth || 64, defN = now.defaultColumnWidth || defB
  const inv = new Map()
  const last = cols ? (() => { let m = cap; for (let o = 0; o <= cap; o++) { const n = cols(o); if (n != null) { inv.set(n, o); m = Math.max(m, n) } } return m })() : cap
  if (!cols) for (let o = 0; o <= cap; o++) inv.set(o, o)
  const origAt = (o) => sh.cols.find((x) => Number(x.min) - 1 <= o && o <= Number(x.max) - 1) || null
  let changed = !!cols
  const want = []
  for (let c = 0; c <= last; c++) {
    const o = inv.has(c) ? inv.get(c) : null
    const oc = o != null ? origAt(o) : null
    const a = oc ? Object.fromEntries(Object.entries(oc).filter(([k]) => k !== 'xml' && k !== 'min' && k !== 'max')) : {}
    const bd = o != null ? b.columnData[o] : null, nd = now.columnData?.[c] || null
    const wb = bd?.w ?? defB, wn = nd?.w ?? defN
    if (Math.abs(wb - wn) >= 1) { changed = true; if (Math.abs(wn - defN) < 1 && !oc?.width) { delete a.width; delete a.customWidth } else { a.width = String(widthOfPx(wn)); a.customWidth = '1' } }
    if (!!bd?.hd !== !!nd?.hd) { changed = true; if (nd?.hd) a.hidden = '1'; else delete a.hidden }
    const sb = styleIn(W.book.data, bd?.s), sn = styleIn(W.data, nd?.s)
    if (canon(sb) !== canon(sn)) { changed = true; const s = sn ? W.SW.xf(Number(oc?.style) || 0, sb, sn) : 0; if (s) a.style = String(s); else delete a.style }
    want.push({ c, o, oc, a })
  }
  if (!changed) return
  // Columns past what Univer showed, as they were (moved along)
  const shift = cols ? cols(cap) - cap : 0
  const out = []
  let run = null
  const flush = () => {
    if (!run) return
    const { lo, hi, a, oc, same } = run
    if (Object.keys(a).length) {
      if (same && oc && Number(oc.min) - 1 === lo && Number(oc.max) - 1 === hi) out.push(oc.xml)
      else out.push(`<${P}col ${[`min="${lo + 1}"`, `max="${hi + 1}"`, ...COL_ATTRS.slice(2).filter((k) => a[k] != null).map((k) => `${k}="${esc(a[k])}"`), ...Object.keys(a).filter((k) => !COL_ATTRS.includes(k)).map((k) => `${k}="${esc(a[k])}"`)].join(' ')}/>`)
    }
    run = null
  }
  for (const w of want) {
    const key = JSON.stringify(w.a)
    const sameAsOrig = w.oc && w.o === w.c && key === JSON.stringify(Object.fromEntries(Object.entries(w.oc).filter(([k]) => k !== 'xml' && k !== 'min' && k !== 'max')))
    if (run && run.key === key && run.hi === w.c - 1 && run.oc === w.oc && run.same === sameAsOrig) { run.hi = w.c; continue }
    flush()
    run = { lo: w.c, hi: w.c, key, a: w.a, oc: w.oc, same: sameAsOrig }
  }
  flush()
  for (const oc of sh.cols) {
    const hi = Number(oc.max) - 1
    if (hi <= cap) continue
    const lo = Math.max(Number(oc.min) - 1, cap + 1)
    const a = Object.fromEntries(Object.entries(oc).filter(([k]) => k !== 'xml' && k !== 'min' && k !== 'max'))
    const nlo = Math.min(MAX_COL - 1, lo + shift), nhi = Math.min(MAX_COL - 1, hi + shift)
    if (nlo <= nhi) out.push(`<${P}col ${[`min="${nlo + 1}"`, `max="${nhi + 1}"`, ...Object.keys(a).map((k) => `${k}="${esc(a[k])}"`)].join(' ')}/>`)
  }
  const have = S.items.find((x) => x.name === 'cols')
  const xml = out.length ? `<${P}cols>${out.join('')}</${P}cols>` : null
  if ((have?.xml || null) !== xml) place(S, 'cols', xml, WS_ORDER)
}

function patchCf(W, sh, S, P, rows, cols, moved, fixIn, why) {
  const blocks = S.items.filter((x) => x.name === 'conditionalFormatting')
  const managed = W.has.cf
  const list = managed ? W.res.cf[sh.id] || [] : null
  const unchanged = !rows && !cols && (!managed || (list.length === sh.cf.length && list.every((u, i) => u.cfId === sh.cf[i].cfId && cfKey(u) === cfKey(sh.cf[i].rule) && rangesKey(u.ranges) === rangesKey(sh.cf[i].rule.ranges))))
  if (unchanged) {
    if (W.fixing) for (const bl of blocks) bl.xml = fixIn(bl.xml)
    return
  }
  const out = []
  let pri = 1
  const reprio = (xml) => xml.replace(/^<[^>]*>/, (o) => setAttr(o, 'priority', String(pri++)))
  if (managed) {
    for (const u of list) {
      if (!u?.ranges?.length || !u.rule) continue
      const was = sh.cf.find((x) => x.cfId === u.cfId)
      let x
      if (was && cfKey(was.rule) === cfKey(u)) x = reprio(fixIn(was.xml))
      else { x = cfRuleXml(u, pri++, W.SW, P, why); if (!x) continue }
      out.push(`<${P}conditionalFormatting sqref="${sqrefOf(u.ranges)}">${x}</${P}conditionalFormatting>`)
    }
  } else {
    for (const c of sh.cf) { const sq = shiftSqref(c.sqref, rows, cols, moved); if (sq) out.push(`<${P}conditionalFormatting sqref="${sq}">${reprio(fixIn(c.xml))}</${P}conditionalFormatting>`) }
  }
  for (const h of sh.cfHidden) {
    const sq = shiftSqref(h.sqref, rows, cols, moved)
    if (sq) out.push(`${setAttr(h.open, 'sqref', sq).replace(/\s*\/>$/, '>')}${reprio(fixIn(h.xml))}</${P}conditionalFormatting>`)
  }
  replaceAll(S, 'conditionalFormatting', out)
}
// All the elements of one name swapped for a new list, where the first was (or by the order).
function replaceAll(S, name, xmls) {
  let at = S.items.findIndex((x) => x.name === name)
  S.items = S.items.filter((x) => x.name !== name)
  if (!xmls.length) return
  if (at < 0) { place(S, name, xmls[0], WS_ORDER); at = S.items.findIndex((x) => x.name === name); S.items.splice(at + 1, 0, ...xmls.slice(1).map((x) => ({ name, pre: '', xml: x }))); return }
  S.items.splice(at, 0, ...xmls.map((x) => ({ name, pre: '', xml: x })))
}

function patchDv(W, sh, S, P, rows, cols, moved, fixIn, why) {
  const it = S.items.find((x) => x.name === 'dataValidations')
  const managed = W.has.dv
  const list = managed ? (W.res.dv[sh.id] || []).filter((u) => u?.ranges?.length) : null
  const unchanged = !rows && !cols && (!managed || (list.length === sh.dv.length && list.every((u, i) => u.uid === sh.dv[i].uid && dvKey(u) === dvKey(sh.dv[i].rule) && rangesKey(u.ranges) === rangesKey(sh.dv[i].rule.ranges))))
  if (unchanged) { if (it && W.fixing) it.xml = fixIn(it.xml); return }
  const out = []
  if (managed) {
    for (const u of list) {
      const was = sh.dv.find((x) => x.uid === u.uid)
      if (was && dvKey(was.rule) === dvKey(u)) out.push(fixIn(was.xml).replace(/^<[^>]*>/, (o) => setAttr(o, 'sqref', sqrefOf(u.ranges))))
      else out.push(dvXml(u, P, why))
    }
  } else for (const d of sh.dv) { const sq = shiftSqref(attrs(/^<[^>]*>/.exec(d.xml)[0]).sqref, rows, cols, moved); if (sq) out.push(fixIn(d.xml).replace(/^<[^>]*>/, (o) => setAttr(o, 'sqref', sq))) }
  for (const h of sh.dvHidden) { const sq = shiftSqref(attrs(/^<[^>]*>/.exec(h.xml)[0]).sqref, rows, cols, moved); if (sq) out.push(fixIn(h.xml).replace(/^<[^>]*>/, (o) => setAttr(o, 'sqref', sq))) }
  const open = setAttr((sh.dvsOpen || `<${P}dataValidations>`).replace(/\s*\/>$/, '>'), 'count', String(out.length))
  place(S, 'dataValidations', out.length ? `${open}${out.join('')}</${P}dataValidations>` : null, WS_ORDER)
}

function patchLinks(W, sh, now, S, P, rows, cols, moved, fixIn) {
  const it = S.items.find((x) => x.name === 'hyperlinks')
  const nowLinks = new Map()
  for (const [r, row] of Object.entries(now.cellData || {})) for (const [c, cell] of Object.entries(row || {})) { const u = linkOf(cell); if (u) nowLinks.set(`${r},${c}`, u) }
  const baseLinks = new Map()
  for (const [key, l] of sh.links) {
    const [r0, c0] = key.split(',').map(Number)
    const r = rows ? rows(r0) : r0, c = cols ? cols(c0) : c0
    if (r == null || c == null) continue
    baseLinks.set(`${r},${c}`, { ...l, url: linkOf(sh.univer.cellData[r0]?.[c0]) })
  }
  const same = !rows && !cols && nowLinks.size === baseLinks.size && [...nowLinks].every(([k, u]) => baseLinks.get(k)?.url === u)
  if (same) { if (it && W.fixing) it.xml = fixIn(it.xml); return }
  const rels = W.relsOf(sh)
  const used = new Set()
  const out = []
  const rp = rPrefix(S.head) || 'r'
  if (!rPrefix(S.head)) S.head = S.head.replace(/>$/, ` xmlns:r="${REL_NS}">`)
  for (const [key, url] of [...nowLinks].sort((x, y) => { const [a, b] = x[0].split(',').map(Number), [c, d] = y[0].split(',').map(Number); return a - c || b - d })) {
    const [r, c] = key.split(',').map(Number)
    const ref = a1(r, c)
    const was = baseLinks.get(key)
    if (was && was.url === url) { if (was.rid) used.add(was.rid); out.push(fixIn(was.xml).replace(/^<[^>]*>/, (o) => setAttr(o, 'ref', ref))); continue }
    const m = /^#gid=([^&]+)&range=(.+)$/.exec(url)
    if (m) { const target = W.data.sheets[m[1]]; out.push(`<${P}hyperlink ref="${ref}" location="${esc(`${quoteSheet(target?.name || m[1])}!${m[2]}`)}" display="${esc(docBits(now.cellData[r][c].p)?.text || '')}"/>`); continue }
    if (url.startsWith('#internal:')) { out.push(`<${P}hyperlink ref="${ref}" location="${esc(url.slice(10))}"/>`); continue }
    if (url.startsWith('#definedname=')) { out.push(`<${P}hyperlink ref="${ref}" location="${esc(url.slice(13))}"/>`); continue }
    const id = nextRelId(rels.list)
    rels.list.push({ id, type: '/hyperlink', external: true, target: url, xml: relXml(id, RT('hyperlink'), url, true) })
    rels.dirty = true
    used.add(id)
    out.push(`<${P}hyperlink ref="${ref}" ${rp}:id="${id}"/>`)
  }
  for (const h of sh.linksHidden) {
    const sq = shiftSqref(h.ref, rows, cols, moved)
    if (!sq) continue
    const rid = rIdOf(attrs(/^<[^>]*>/.exec(h.xml)[0]))
    if (rid) used.add(rid)
    out.push(fixIn(h.xml).replace(/^<[^>]*>/, (o) => setAttr(o, 'ref', sq)))
  }
  // Links no cell uses any more lose their relationship
  for (const l of sh.links.values()) if (l.rid && !used.has(l.rid)) { rels.list = rels.list.filter((x) => x.id !== l.rid); rels.dirty = true }
  place(S, 'hyperlinks', out.length ? `<${P}hyperlinks>${out.join('')}</${P}hyperlinks>` : null, WS_ORDER)
}

function patchNotes(W, sh, S, P, rows, cols) {
  const managed = W.has.notes
  const all = (sh.notes?.list || []).map((n) => ({ ...n, r: rows ? rows(n.r) : n.r, c: cols ? cols(n.c) : n.c }))
  const base = all.filter((n) => n.r != null && n.c != null)
  const now = managed ? notesIn(W.res.notes, sh.id) : base
  if (noteKey(base) === noteKey(now) && base.length === all.length) {
    if ((rows || cols) && sh.notes) {
      W.put(sh.notes.rel.path, shiftComments(sh.notes.xml, rows, cols))
      if (sh.notes.vml) W.edit(sh.notes.vml.path, (x) => shiftVml(x, rows, cols))
    }
    return
  }
  if (sh.rels.some((r) => r.type === '/threadedComment')) W.why(`threaded comments on ${sh.name} are kept as Excel had them, not as changed here`)
  const rels = W.relsOf(sh)
  const ns = sh.notes
  const cPath = ns?.rel.path || W.newPath('xl/comments', '.xml')
  let vPath = ns?.vml?.path || rels.list.find((r) => r.type === '/vmlDrawing')?.path || null
  const cx = ns?.xml || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author></author></authors><commentList></commentList></comments>`
  const CP = split(cx).prefix
  const entries = now.sort((x, y) => x.r - y.r || x.c - y.c).map((n) => { const was = base.find((x) => x.r === n.r && x.c === n.c && x.text === n.text); return was ? was.xml.replace(/^<[^>]*>/, (o) => setAttr(o, 'ref', a1(n.r, n.c))) : commentXml(n, CP) })
  const index = W.book.sheets.indexOf(sh) + 1 || W.data.sheetOrder.indexOf(sh.id) + 1
  if (!entries.length) {
    // no notes left: their parts go
    if (ns) { W.drop(cPath); rels.list = rels.list.filter((r) => r.id !== ns.rel.id); rels.dirty = true }
    if (vPath) W.edit(vPath, (x) => vmlWith(x, [], index))
    return
  }
  const list = one(cx, 'commentList')
  const newCx = list ? cx.slice(0, list.i) + `${list.open.replace(/\s*\/>$/, '>')}${entries.join('')}</${CP}commentList>` + cx.slice(list.j) : cx
  W.put(cPath, newCx)
  W.ct.override(cPath, CT.comments)
  if (!ns) { const id = nextRelId(rels.list); rels.list.push({ id, type: '/comments', path: cPath, xml: relXml(id, RT('comments'), relTarget(sh.part, cPath)) }); rels.dirty = true }
  if (!vPath) {
    vPath = W.newPath('xl/drawings/vmlDrawing', '.vml')
    const id = nextRelId(rels.list)
    rels.list.push({ id, type: '/vmlDrawing', path: vPath, xml: relXml(id, RT('vmlDrawing'), relTarget(sh.part, vPath)) })
    rels.dirty = true
    W.ct.def('vml', CT.vml)
    if (!rPrefix(S.head)) S.head = S.head.replace(/>$/, ` xmlns:r="${REL_NS}">`)
    place(S, 'legacyDrawing', `<${P}legacyDrawing ${rPrefix(S.head)}:id="${id}"/>`, WS_ORDER)
    W.put(vPath, vmlWith(null, now, index))
  } else W.edit(vPath, (x) => vmlWith(x, now, index))
}

// ---------- The workbook ----------
const NEW_SHEET = (P, rowPt, colW) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL_NS}"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr ${colW ? `defaultColWidth="${colW}" ` : ''}defaultRowHeight="${rowPt}"${rowPt !== 15 ? ' customHeight="1"' : ''}/><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
// A sheet made in the editor: written as one that was empty, so everything in it is new.
function blankSheet(now, path) {
  const rowPx = now.defaultRowHeight || 20, colPx = now.defaultColumnWidth || 64
  const xml = NEW_SHEET('', Math.round(rowPx * 0.75 * 100) / 100, colPx === 64 ? null : widthOfPx(colPx))
  return {
    id: now.id, entry: { name: now.name }, name: now.name, part: path, xml, relsPath: relsPathOf(path), rels: [], rows: new Map(), shared: new Map(),
    cf: [], cfHidden: [], dv: [], dvHidden: [], links: new Map(), linksHidden: [], notes: null, cols: [], filter: null, filterXml: null, dvsOpen: null, isNew: true,
    univer: { cellData: {}, rowData: {}, columnData: {}, mergeData: [], freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 }, defaultRowHeight: rowPx, defaultColumnWidth: colPx, columnCount: Math.max(26, now.columnCount || 26), rowCount: now.rowCount || 1000, showGridlines: 1, zoomRatio: 1, tabColor: '', rightToLeft: 0 },
  }
}

export async function writeBook(original, keep, data, { ops = [], charts = [] } = {}) {
  const book = keep?.book || await parseBook(original)
  const zip = await JSZip.loadAsync(original)
  data = clone(data)
  for (const s of Object.values(data.sheets || {})) expandShared(s)
  const notKept = []
  const W = {
    book, data, ops: ops.filter((o) => o && o.sheet && o.op && (o.count > 0)), zip,
    res: { cf: resourceOf(data, 'SHEET_CONDITIONAL_FORMATTING_PLUGIN'), dv: resourceOf(data, 'SHEET_DATA_VALIDATION_PLUGIN'), filter: resourceOf(data, 'SHEET_FILTER_PLUGIN'), notes: resourceOf(data, 'SHEET_NOTE_PLUGIN') },
    // a plugin Univer didn't have leaves its rules as they were
    has: Object.fromEntries([['cf', 'SHEET_CONDITIONAL_FORMATTING_PLUGIN'], ['dv', 'SHEET_DATA_VALIDATION_PLUGIN'], ['filter', 'SHEET_FILTER_PLUGIN'], ['notes', 'SHEET_NOTE_PLUGIN']].map(([k, n]) => [k, (data.resources || []).some((r) => r.name === n)])),
    SW: styleWriter(book.st, book.stylesPath ? split(book.st.xml).prefix : ''),
    ctWas: (await text(zip, '[Content_Types].xml')) || '',
    ct: null,
    written: new Map(), dropped: new Set(), rels: new Map(), filterRows: new Map(), filterNames: new Map(),
    cellsChanged: false, formulasChanged: false,
    why: (m) => { if (!notKept.includes(m)) notKept.push(m) },
    whyOnce: (m, where) => W.why(`${m} on ${where}`),
    put: (path, x) => { W.written.set(path, x); W.dropped.delete(path) },
    drop: (path) => { if (!path) return; W.written.delete(path); W.dropped.add(path); W.ct.override(path, null) },
    edit: async () => {},
    read: async (path) => (W.written.has(path) ? W.written.get(path) : text(zip, path)),
    relsOf: (sh) => { if (!W.rels.has(sh.part)) W.rels.set(sh.part, { path: sh.relsPath, list: sh.rels.map((r) => ({ ...r })), dirty: false }); return W.rels.get(sh.part) },
    reserved: new Set(),
    newPath: (stem, ext) => { let n = 1; while (zip.file(`${stem}${n}${ext}`) || W.written.has(`${stem}${n}${ext}`) || W.reserved.has(`${stem}${n}${ext}`)) n++; const p = `${stem}${n}${ext}`; W.reserved.add(p); return p },
  }
  W.ct = contentTypes(W.ctWas)
  // Edits to parts that need reading first are queued, then done in order
  const edits = []
  W.edit = (path, fn) => edits.push({ path, fn })
  // Sheets: kept, renamed, new, gone
  const nowIds = (data.sheetOrder || []).filter((id) => data.sheets?.[id])
  const byId = new Map(book.sheets.map((s) => [s.id, s]))
  const gone = book.sheets.filter((s) => !nowIds.includes(s.id))
  const renames = book.sheets.filter((s) => nowIds.includes(s.id) && data.sheets[s.id].name && data.sheets[s.id].name !== s.name).map((s) => ({ from: s.name, to: data.sheets[s.id].name }))
  const opSheets = book.sheets.filter((s) => W.ops.some((o) => o.sheet === s.id))
  W.fixing = !!(renames.length || opSheets.length || gone.length)
  W.fixFormula = (f, here) => {
    let x = f
    for (const s of opSheets) x = shiftFormula(x, W.ops, s.id, s.name, here)
    for (const s of gone) x = mapRefs(x, (ref) => (ref.sheet != null && ref.sheet.toLowerCase() === s.name.toLowerCase() ? '#REF!' : undefined))
    for (const r of renames) x = renameIn(x, r.from, r.to)
    return x
  }
  // Filters first: the rows they hide are written with the rows
  for (const id of nowIds) {
    const sh = byId.get(id)
    if (!sh || !W.has.filter) continue
    const now = W.res.filter[id]
    const was = sh.filter && !sh.filter.unsupported ? sh.filter : null
    const rows = axisMap(W.ops, id, 'row')
    const wasRef = was ? shiftRange(was.ref, rows, axisMap(W.ops, id, 'col')) : null
    if (filterKey(was && wasRef ? { ...was, ref: wasRef } : null) === filterKey(now?.ref ? now : null) && !rows) continue
    const scope = new Set()
    for (const g of [wasRef, now?.ref].filter(Boolean)) for (let r = g.startRow + 1; r <= Math.min(g.endRow, g.startRow + 100000); r++) scope.add(r)
    if (now?.ref && !now.cachedFilteredOut && now.filterColumns?.length) continue // Univer didn't say which rows it hides
    W.filterRows.set(id, { scope, hide: new Set((now?.cachedFilteredOut || []).map(Number)) })
  }
  // Each sheet's XML
  const out = []
  for (const id of nowIds) {
    const now = data.sheets[id]
    let sh = byId.get(id)
    if (!sh) {
      const path = W.newPath('xl/worksheets/sheet', '.xml')
      sh = blankSheet({ ...now, id }, path)
      W.ct.override(path, CT.sheet)
    }
    const xml = patchSheet(W, sh, { ...now, id })
    if (xml != null || sh.isNew) W.put(sh.part, xml ?? sh.xml)
    out.push(sh)
  }
  // Sheets gone, with what was theirs alone
  for (const sh of gone) await dropSheet(W, sh)
  // Rows and columns moved: pictures, charts' anchors, tables and pivot tables on those sheets
  for (const sh of opSheets) if (nowIds.includes(sh.id)) await shiftSatellites(W, sh)
  // Sheets renamed or moved: charts and pivot tables that draw from them
  if (W.fixing) await fixCharts(W, gone)
  for (const e of edits) { const x = await W.read(e.path); if (x != null) W.put(e.path, e.fn(x)) }
  // New charts ("chart this"), where they're asked for, after the rest has moved
  for (const c of charts || []) await addChart(W, c, out)
  // The workbook: its sheets in order, names, recalculation
  const wb = patchWorkbook(W, out, gone)
  if (wb !== book.wbXml) W.put(book.wbPath, wb)
  // Formulas changed: Excel works them all out again on opening, and its calculation chain goes
  if (W.formulasChanged || W.ops.length || gone.length) {
    const cc = book.wbRels.find((r) => r.type === '/calcChain')
    if (cc) { W.drop(cc.path); W.wbRels = (W.wbRels || book.wbRels).filter((r) => r.id !== cc.id) }
  }
  const styles = W.SW.write(book.st.xml)
  if (styles) {
    if (book.stylesPath) W.put(book.stylesPath, styles)
    else W.why('formats, as the file had no styles to add them to')
  }
  // Relationships
  for (const r of W.rels.values()) if (r.dirty) { if (r.list.length) W.put(r.path, relsXml(r.list)); else W.drop(r.path) }
  if (W.wbRels && W.wbRels.map((r) => r.xml).join() !== book.wbRels.map((r) => r.xml).join()) W.put(relsPathOf(book.wbPath), relsXml(W.wbRels))
  const ct = W.ct.xml
  if (ct !== W.ctWas) W.put('[Content_Types].xml', ct)
  if (!W.written.size && !W.dropped.size) return { bytes: original instanceof Uint8Array ? original : new Uint8Array(original), notKept }
  for (const [path, x] of W.written) {
    if (/\.(xml|rels|vml)$/i.test(path) && typeof x === 'string' && !wellFormed(x)) throw new Error(`Couldn't write ${path}: its XML came out broken`)
    zip.file(path, x)
  }
  for (const path of W.dropped) zip.remove(path)
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { bytes, notKept }
}

function patchWorkbook(W, out, gone) {
  const { book, data } = W
  const S = split(book.wbXml)
  const P = S.prefix
  let rp = rPrefix(S.head)
  if (!rp) { S.head = S.head.replace(/>$/, ` xmlns:r="${REL_NS}">`); rp = 'r' }
  const item = (n) => S.items.find((x) => x.name === n)
  // The entries: worksheets in the editor's order; chart sheets and the like where they were
  const old = book.entries
  const idOf = new Map(book.sheets.map((s) => [s.entry, s.id]))
  const anchors = new Map()
  let prev = null
  for (const e of old) { if (idOf.has(e)) prev = idOf.get(e); else (anchors.get(prev) || anchors.set(prev, []).get(prev)).push(e) }
  const list = [...(anchors.get(null) || [])]
  let maxId = Math.max(0, ...old.map((e) => Number(e.sheetId) || 0))
  W.wbRels ||= book.wbRels.map((r) => ({ ...r }))
  for (const sh of out) {
    const now = data.sheets[sh.id]
    let tag
    if (sh.isNew) {
      const id = nextRelId(W.wbRels)
      W.wbRels.push({ id, type: '/worksheet', path: sh.part, xml: relXml(id, RT('worksheet'), relTarget(book.wbPath, sh.part)) })
      tag = `<${P}sheet name="${esc(now.name)}" sheetId="${++maxId}" ${rp}:id="${id}"/>`
    } else {
      tag = sh.entry.open
      if (now.name && now.name !== sh.name) tag = setAttr(tag, 'name', now.name)
      const hidden = now.hidden === 1 || now.hidden === 2 || now.hidden === true
      const was = sh.entry.state === 'hidden' || sh.entry.state === 'veryHidden'
      if (hidden !== was) tag = setAttr(tag, 'state', hidden ? (now.hidden === 2 ? 'veryHidden' : 'hidden') : null)
    }
    list.push({ tag, entry: sh.isNew ? null : sh.entry, sh })
    for (const e of anchors.get(sh.id) || []) list.push(e)
  }
  for (const g of gone) for (const e of anchors.get(g.id) || []) list.push(e)
  const tags = list.map((x) => x.tag || x.open)
  const sheetsItem = item('sheets')
  const sheetsXml = `${/^<[^>]*>/.exec(sheetsItem.xml)[0]}${tags.join('')}</${P}sheets>`
  if (sheetsXml !== sheetsItem.xml) sheetsItem.xml = sheetsXml
  // Where each old entry is now, for names scoped to a sheet and the active tab
  const newIndex = (oldIndex) => { const e = old[oldIndex]; return list.findIndex((x) => (x.entry || x) === e) }
  // Defined names
  const dn = item('definedNames')
  if (dn || W.filterNames.size) {
    const names = dn ? each(dn.xml, 'definedName') : []
    const kept = []
    const filterDone = new Set()
    for (const n of names) {
      const a = attrs(n.open)
      let open = n.open
      let body = unx(n.inner)
      if (a.localSheetId != null) {
        const ni = newIndex(Number(a.localSheetId))
        if (ni < 0) continue
        if (String(ni) !== a.localSheetId) open = setAttr(open, 'localSheetId', String(ni))
        if (a.name === '_xlnm._FilterDatabase') {
          const sh = list[ni]?.sh
          if (sh && W.filterNames.has(sh.id)) {
            filterDone.add(sh.id)
            const ref = W.filterNames.get(sh.id)
            if (!ref) continue
            body = `${quoteSheet(data.sheets[sh.id].name)}!${refOf({ ...ref }).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`
          }
        }
      }
      const fixed = W.fixing ? W.fixFormula(body, null) : body
      kept.push(fixed === unx(n.inner) && open === n.open ? n.xml : `${open.replace(/\s*\/>$/, '>')}${esc(fixed)}</${P}definedName>`)
    }
    for (const [id, ref] of W.filterNames) {
      if (!ref || filterDone.has(id)) continue
      const ni = list.findIndex((x) => x.sh?.id === id)
      kept.push(`<${P}definedName name="_xlnm._FilterDatabase" localSheetId="${ni}" hidden="1">${esc(`${quoteSheet(data.sheets[id].name)}!${refOf(ref).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`)}</${P}definedName>`)
    }
    const xml = kept.length ? `${(dn ? /^<[^>]*>/.exec(dn.xml)[0] : `<${P}definedNames>`).replace(/\s*\/>$/, '>')}${kept.join('')}</${P}definedNames>` : null
    if ((dn?.xml || null) !== xml) place(S, 'definedNames', xml, WB_ORDER)
  }
  // The tab shown on opening stays the same sheet
  const bv = item('bookViews')
  if (bv) {
    const v = one(bv.xml, 'workbookView')
    if (v) {
      const a = attrs(v.open)
      let open = v.open
      const at = Number(a.activeTab) || 0
      const ni = newIndex(at)
      const want = ni >= 0 ? ni : 0
      if (want !== at) open = setAttr(open, 'activeTab', want ? String(want) : null)
      if (Number(a.firstSheet) >= list.length) open = setAttr(open, 'firstSheet', null)
      if (open !== v.open) bv.xml = bv.xml.slice(0, v.i) + open + bv.xml.slice(v.i + v.open.length)
    }
  }
  if (W.cellsChanged) {
    const cp = item('calcPr')
    if (!cp) place(S, 'calcPr', `<${P}calcPr fullCalcOnLoad="1"/>`, WB_ORDER)
    else if (attrs(cp.xml).fullCalcOnLoad !== '1') cp.xml = cp.xml.replace(/^<[^>]*>/, (o) => setAttr(o, 'fullCalcOnLoad', '1'))
  }
  return joinParts(S)
}

// A sheet deleted: its part and what only it used (drawings and their charts, notes, tables).
async function dropSheet(W, sh) {
  const { book } = W
  W.drop(sh.part)
  W.drop(sh.relsPath)
  W.wbRels ||= book.wbRels.map((r) => ({ ...r }))
  W.wbRels = W.wbRels.filter((r) => r.path !== sh.part)
  for (const r of sh.rels) {
    if (r.external || !r.path) continue
    if (['/drawing', '/comments', '/vmlDrawing', '/table', '/threadedComment', '/pivotTable', '/printerSettings'].includes(r.type)) {
      if (r.type === '/drawing') {
        for (const d of parseRels(await text(W.zip, relsPathOf(r.path)), r.path)) if (d.type === '/chart' && d.path) { W.drop(d.path); W.drop(relsPathOf(d.path)) }
      }
      if (r.type === '/pivotTable') W.why(`the pivot table on ${sh.name}, deleted with it`)
      W.drop(r.path)
      W.drop(relsPathOf(r.path))
    }
  }
}

// Rows and columns added, removed or moved on a sheet: its pictures and charts stay by their cells,
// its tables and pivot tables move with them.
async function shiftSatellites(W, sh) {
  const rows = axisMap(W.ops, sh.id, 'row'), cols = axisMap(W.ops, sh.id, 'col')
  const moved = W.ops.some((o) => o.sheet === sh.id && /^move/.test(o.op))
  for (const r of sh.rels) {
    if (!r.path) continue
    if (r.type === '/drawing') W.edit(r.path, (x) => shiftAnchors(x, rows, cols))
    if (r.type === '/table') {
      const x = await text(W.zip, r.path)
      if (!x) continue
      const t = attrs(/<(?:[\w.-]+:)?table\b[^>]*>/.exec(x)?.[0] || '')
      const g = rangeOf(t.ref)
      if (g && cols) {
        const inside = W.ops.filter((o) => o.sheet === sh.id && /-cols$/.test(o.op)).some((o) => { const s = o.start ?? o.from; return s > g.startColumn && s <= g.endColumn })
        if (inside) W.why(`the table ${t.displayName || t.name || ''} on ${sh.name} (columns were added or removed inside it)`.replace('  ', ' '))
      }
      W.put(r.path, x.replace(/(<(?:[\w.-]+:)?(?:table|autoFilter|sortState|sortCondition)\b[^>]*?\sref=")([^"]+)(")/g, (m, a, v, z) => { const s = shiftRange(rangeOf(v), rows, cols, moved); return s ? `${a}${refOf(s)}${z}` : m }))
    }
    if (r.type === '/pivotTable') {
      const x = await text(W.zip, r.path)
      if (x) W.put(r.path, x.replace(/(<(?:[\w.-]+:)?location\b[^>]*?\sref=")([^"]+)(")/, (m, a, v, z) => { const s = shiftRange(rangeOf(v), rows, cols, moved); return s ? `${a}${refOf(s)}${z}` : m }))
    }
  }
}

// Charts and pivot caches name the sheets they draw from: renamed, moved, or gone (which is said).
async function fixCharts(W, gone) {
  for (const f of W.zip.file(/^xl\/charts\/chart[^/]*\.xml$/)) {
    if (W.dropped.has(f.name)) continue
    const x = await f.async('string')
    const y = x.replace(/(<((?:[\w.-]+:)?)f>)([\s\S]*?)(<\/\2f>)/g, (m, a, p, v, z) => `${a}${esc(W.fixFormula(unx(v), null))}${z}`)
    if (y !== x) { W.put(f.name, y); if (/#REF!/.test(y) && !/#REF!/.test(x)) W.why(`a chart that drew from ${gone.map((g) => g.name).join(', ') || 'a deleted sheet'}`) }
  }
  for (const f of W.zip.file(/^xl\/pivotCache\/pivotCacheDefinition[^/]*\.xml$/)) {
    if (W.dropped.has(f.name)) continue
    const x = await f.async('string')
    const y = x.replace(/<((?:[\w.-]+:)?)worksheetSource\b[^>]*?\/>/, (tag) => {
      const a = attrs(tag)
      if (!a.sheet || !a.ref) return tag
      const fixed = W.fixFormula(`${quoteSheet(a.sheet)}!${a.ref}`, null)
      const m = /^(?:('(?:[^']|'')+'|[^!]+)!)?(.+)$/.exec(fixed)
      if (/#REF!/.test(fixed)) { W.why(`a pivot table whose data was on ${a.sheet}`); return tag }
      return setAttr(setAttr(tag, 'sheet', m[1] ? unquote(m[1]) : a.sheet), 'ref', m[2])
    })
    if (y !== x) W.put(f.name, y)
  }
}

// ---------- New charts ("chart this") ----------
// A native Excel chart of a range (first column the categories, first row the series' names), put
// in the sheet's drawing, with its values cached so anything that reads the file shows it.
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const XDR_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
function chartXml(c, sheetName, cells, g) {
  const q = quoteSheet(sheetName)
  const abs = (r0, c0, r1, c1) => `${q}!${`$${colName(c0)}$${r0 + 1}`}${r1 != null ? `:$${colName(c1)}$${r1 + 1}` : ''}`
  const at = (r, col) => cells?.[r]?.[col]
  const textAt = (r, col) => { const x = at(r, col); return x?.p ? docBits(x.p).text : x?.v == null ? '' : String(x.v) }
  const numAt = (r, col) => { const v = Number(at(r, col)?.v); return Number.isFinite(v) ? v : null }
  const oneCol = g.startColumn === g.endColumn
  const first = g.startRow + 1, last = Math.max(first, g.endRow)
  const catCol = oneCol ? null : g.startColumn
  let seriesCols = []
  for (let col = oneCol ? g.startColumn : g.startColumn + 1; col <= g.endColumn; col++) seriesCols.push(col)
  if (c.type === 'pie') seriesCols = seriesCols.slice(0, 1)
  const pts = (vals, num) => `<c:ptCount val="${vals.length}"/>${vals.map((v, i) => (v == null || v === '' ? '' : `<c:pt idx="${i}"><c:v>${num ? numText(v) : escText(v)}</c:v></c:pt>`)).join('')}`
  const rowsIdx = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const cats = catCol == null ? null : rowsIdx.map((r) => (numAt(r, catCol) != null && at(r, catCol)?.t !== 1 ? numAt(r, catCol) : textAt(r, catCol)))
  const catNum = cats && cats.every((v) => typeof v === 'number')
  const catXml = cats ? `<c:cat>${catNum ? `<c:numRef><c:f>${esc(abs(first, catCol, last, catCol))}</c:f><c:numCache><c:formatCode>General</c:formatCode>${pts(cats, true)}</c:numCache></c:numRef>` : `<c:strRef><c:f>${esc(abs(first, catCol, last, catCol))}</c:f><c:strCache>${pts(cats)}</c:strCache></c:strRef>`}</c:cat>` : ''
  const sers = seriesCols.map((col, i) => {
    const name = textAt(g.startRow, col)
    const tx = `<c:tx><c:strRef><c:f>${esc(abs(g.startRow, col))}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escText(name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
    const val = `<c:val><c:numRef><c:f>${esc(abs(first, col, last, col))}</c:f><c:numCache><c:formatCode>General</c:formatCode>${pts(rowsIdx.map((r) => numAt(r, col)), true)}</c:numCache></c:numRef></c:val>`
    const head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}`
    if (c.type === 'line') return `<c:ser>${head}<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${catXml}${val}<c:smooth val="0"/></c:ser>`
    if (c.type === 'pie') return `<c:ser>${head}${catXml}${val}</c:ser>`
    return `<c:ser>${head}<c:invertIfNegative val="0"/>${catXml}${val}</c:ser>`
  }).join('')
  const axes = '<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>'
  const ax = '<c:axId val="5001"/><c:axId val="5002"/>'
  const plot = c.type === 'pie' ? `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/></c:pieChart>`
    : c.type === 'line' ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${ax}</c:lineChart>${axes}`
      : `<c:barChart><c:barDir val="${c.type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers}<c:gapWidth val="150"/>${ax}</c:barChart>${axes.replace('<c:axPos val="b"/>', `<c:axPos val="${c.type === 'bar' ? 'l' : 'b'}"/>`).replace('<c:axPos val="l"/><c:majorGridlines/>', `<c:axPos val="${c.type === 'bar' ? 'b' : 'l'}"/><c:majorGridlines/>`)}`
  const title = c.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escText(c.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${REL_NS}"><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="${c.type === 'pie' ? 'r' : 'b'}"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
}
async function addChart(W, c, sheets) {
  const sh = sheets.find((s) => s.id === c?.sheet)
  const now = sh && W.data.sheets[sh.id]
  const g = c && rangeOf(c.ref || '')
  if (!sh || !g || g.rangeType) { W.why(`the new chart${c?.title ? ` "${c.title}"` : ''} (its sheet or range wasn't found)`); return }
  const type = ['column', 'bar', 'line', 'pie'].includes(c.type) ? c.type : 'column'
  const chartPath = W.newPath('xl/charts/chart', '.xml')
  W.put(chartPath, chartXml({ ...c, type }, now.name || sh.name, now.cellData, g))
  W.ct.override(chartPath, CT.chart)
  // The sheet's drawing, or a new one
  const rels = W.relsOf(sh)
  let d = rels.list.find((r) => r.type === '/drawing' && r.path)
  let sheetXml = await W.read(sh.part)
  if (!d) {
    const path = W.newPath('xl/drawings/drawing', '.xml')
    W.put(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${XDR_NS}" xmlns:a="${A_NS}"></xdr:wsDr>`)
    W.ct.override(path, CT.drawing)
    const id = nextRelId(rels.list)
    d = { id, type: '/drawing', path, xml: relXml(id, RT('drawing'), relTarget(sh.part, path)) }
    rels.list.push(d)
    rels.dirty = true
    const S = split(sheetXml)
    if (!rPrefix(S.head)) S.head = S.head.replace(/>$/, ` xmlns:r="${REL_NS}">`)
    place(S, 'drawing', `<${S.prefix}drawing ${rPrefix(S.head)}:id="${id}"/>`, WS_ORDER)
    sheetXml = joinParts(S)
    W.put(sh.part, sheetXml)
  }
  const drelsPath = relsPathOf(d.path)
  const drels = parseRels(await W.read(drelsPath), d.path)
  const rid = nextRelId(drels)
  drels.push({ id: rid, xml: relXml(rid, RT('chart'), relTarget(d.path, chartPath)) })
  W.put(drelsPath, relsXml(drels))
  const dx = await W.read(d.path)
  const S = split(dx)
  const X = S.prefix
  const aPre = /xmlns:([\w.-]+)="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/main"/.exec(S.head)?.[1]
  const A = aPre ? `${aPre}:` : 'a:'
  const decl = aPre ? '' : ` xmlns:a="${A_NS}"`
  const nextId = Math.max(0, ...[...dx.matchAll(/<(?:[\w.-]+:)?cNvPr\b[^>]*\sid="(\d+)"/g)].map((m) => Number(m[1]))) + 1
  const col = Math.max(0, c.at?.col ?? g.endColumn + 2), row = Math.max(0, c.at?.row ?? g.startRow)
  const size = { cols: c.size?.cols || 8, rows: c.size?.rows || 16 }
  const pos = (cc, rr) => `<${X}col>${cc}</${X}col><${X}colOff>0</${X}colOff><${X}row>${rr}</${X}row><${X}rowOff>0</${X}rowOff>`
  const anchor = `<${X}twoCellAnchor editAs="oneCell"${decl}><${X}from>${pos(col, row)}</${X}from><${X}to>${pos(col + size.cols, row + size.rows)}</${X}to><${X}graphicFrame macro=""><${X}nvGraphicFramePr><${X}cNvPr id="${nextId}" name="${esc(c.title || `Chart ${nextId}`)}"/><${X}cNvGraphicFramePr/></${X}nvGraphicFramePr><${X}xfrm><${A}off x="0" y="0"/><${A}ext cx="0" cy="0"/></${X}xfrm><${A}graphic><${A}graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" xmlns:r="${REL_NS}" r:id="${rid}"/></${A}graphicData></${A}graphic></${X}graphicFrame><${X}clientData/></${X}twoCellAnchor>`
  S.items.push({ name: 'twoCellAnchor', pre: '', xml: anchor })
  W.put(d.path, joinParts(S))
}

// ---------- A new workbook ----------
// The least Excel opens without a word: one empty sheet, Sheet1, its styles and theme-free look.
export async function newBook() {
  const zip = new JSZip()
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT('officeDocument')}" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${MAIN}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT('worksheet')}" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${RT('styles')}" Target="styles.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml', NEW_SHEET('', 15, null))
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${STYLES_MIN}`)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
