import JSZip from 'jszip'

// A Word file as Studio edits it, and back, keeping everything it doesn't change exactly as it was.
// The file is read part by part: the document's body (and each header and footer) into blocks
// (paragraphs, tables, and what Studio only shows, like a table of contents), each tied to its own
// XML. Saving writes a block Studio didn't change as its original XML, byte for byte, and only a
// changed one anew, from its original properties with what you changed set on them; every other
// part of the file (styles, numbering, comments, footnotes, settings, pictures) is copied as it
// was. So comments, tracked changes, fields, bookmarks, equations and section setup all survive a
// save, even in a paragraph you edited. No browser APIs here, so the tests read and write in Node.

// ---------- XML ----------
// A small scanner that keeps where each element starts and ends in its source, so an element can
// be written back as it was. Names are put in the usual prefixes (w:, r:, wp:, a:, pic:, m:) by
// their namespace, so a file that names them differently reads the same.
const URI = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
}
const NS = Object.fromEntries(Object.entries(URI).map(([u, p]) => [p, u]))
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unent = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m)))
// Text as XML takes it: escaped, without the control characters XML can't hold.
export const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const TAG = /<(\/?)([A-Za-z_][\w.\-:]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>/g
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

// { name, attrs, kids, s, e, st } an element (s..e its whole source, st where its start tag
// ends), { text } a run of text. scope: the prefixes already declared, for a piece of a file.
export function parseXml(src, scope0 = {}) {
  const top = { name: '#doc', attrs: {}, kids: [], s: 0, e: src.length, st: 0, src }
  const stack = [top]
  const scopes = [scope0]
  let last = 0
  let m
  const re = new RegExp(TAG.source, 'g')
  while ((m = re.exec(src))) {
    const cur = stack[stack.length - 1]
    if (m.index > last && cur !== top) cur.kids.push({ text: unent(src.slice(last, m.index)), s: last, e: m.index })
    last = re.lastIndex
    if (m[5] !== undefined) { cur.kids.push({ text: m[5], s: m.index, e: last }); continue }
    if (!m[2]) continue
    if (m[1]) { const n = stack.pop(); scopes.pop(); if (n) n.e = last; continue }
    let scope = scopes[scopes.length - 1]
    const pairs = []
    if (m[3]) { const ar = new RegExp(ATTR.source, 'g'); let a; while ((a = ar.exec(m[3]))) pairs.push([a[1], unent(a[2] ?? a[3])]) }
    const decl = pairs.filter(([k]) => k === 'xmlns' || k.startsWith('xmlns:'))
    if (decl.length) { scope = { ...scope }; for (const [k, v] of decl) scope[k === 'xmlns' ? '' : k.slice(6)] = v }
    const canon = (q, el) => {
      const i = q.indexOf(':')
      const p = i < 0 ? (el ? '' : null) : q.slice(0, i)
      if (p === null) return q
      const c = URI[scope[p]]
      return c ? `${c}:${i < 0 ? q : q.slice(i + 1)}` : q
    }
    const attrs = {}
    for (const [k, v] of pairs) if (!(k === 'xmlns' || k.startsWith('xmlns:'))) attrs[canon(k, false)] = v
    const n = { name: canon(m[2], true), q: m[2], attrs, kids: [], s: m.index, e: last, st: last, src, ...(decl.length ? { scope } : {}) }
    cur.kids.push(n)
    if (!m[4]) { stack.push(n); scopes.push(scope) }
  }
  return top
}
export const raw = (n) => (n ? n.src.slice(n.s, n.e) : '')
const startTag = (n) => n.src.slice(n.s, n.st)
// What's in an element's start tag after its name (" w:rsidR=\"00A1\" …"), as written.
const attrText = (n) => { const t = startTag(n); return t.slice(1 + n.q.length, t.endsWith('/>') ? -2 : -1).replace(/\s+$/, '') }
const closeTag = (n) => `</${n.q}>`
export const els = (n) => (n?.kids || []).filter((k) => k.name)
export const kid = (n, name) => n?.kids.find((k) => k.name === name) || null
const kids = (n, name) => (n?.kids || []).filter((k) => k.name === name)
function find(n, name) {
  for (const k of n?.kids || []) { if (!k.name) continue; if (k.name === name) return k; const f = find(k, name); if (f) return f }
  return null
}
function findAll(n, name, out = []) {
  for (const k of n?.kids || []) { if (!k.name) continue; if (k.name === name) out.push(k); findAll(k, name, out) }
  return out
}
const textIn = (n) => (n.text != null ? n.text : n.kids.map(textIn).join(''))
const av = (n, a = 'w:val') => n?.attrs?.[a] ?? null
const on = (n) => !!n && !['0', 'false', 'off'].includes(av(n) ?? '')
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const local = (name) => name.slice(name.indexOf(':') + 1)

// ---------- The package ----------
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const relsPath = (p) => { const i = p.lastIndexOf('/'); return `${p.slice(0, i + 1)}_rels/${p.slice(i + 1)}.rels` }
function resolve(from, target) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = from.slice(0, from.lastIndexOf('/') + 1).split('/').filter(Boolean)
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg) }
  return parts.join('/')
}
function relsOf(xml) {
  if (!xml) return []
  return findAll(parseXml(xml), 'Relationship').map((r) => ({ id: r.attrs.Id, type: r.attrs.Type || '', target: r.attrs.Target || '', mode: r.attrs.TargetMode || null }))
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf' }
export const mimeOf = (p) => MIME[String(p).split('.').pop().toLowerCase()] || 'application/octet-stream'

// ---------- Styles, theme, numbering ----------
// A run's look, as Word says it: { font, size (half-points), color (RRGGBB), bold, italic,
// underline, strike, caps, smallCaps, va (superscript, subscript), highlight }.
const HIGHLIGHT = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF' }
export const HIGHLIGHTS = HIGHLIGHT
function themeOf(xml) {
  if (!xml) return { fonts: {}, colors: {} }
  const t = parseXml(xml)
  const latin = (n) => av(kid(n, 'a:latin'), 'typeface') || null
  const colors = {}
  const scheme = find(t, 'a:clrScheme')
  for (const c of els(scheme)) { const v = kid(c, 'a:srgbClr'); const s = kid(c, 'a:sysClr'); colors[local(c.name)] = (av(v, 'val') || av(s, 'lastClr') || '').toUpperCase() || null }
  return { fonts: { major: latin(find(t, 'a:majorFont')), minor: latin(find(t, 'a:minorFont')) }, colors }
}
const THEME_COLOR = { text1: 'dk1', text2: 'dk2', background1: 'lt1', background2: 'lt2', dark1: 'dk1', dark2: 'dk2', light1: 'lt1', light2: 'lt2', hyperlink: 'hlink', followedHyperlink: 'folHlink' }
function shadeOf(hex, shade, tint) {
  if (!hex) return null
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  if (shade) { const f = parseInt(shade, 16) / 255; [r, g, b] = [r, g, b].map((v) => Math.round(v * f)) }
  if (tint) { const f = parseInt(tint, 16) / 255; [r, g, b] = [r, g, b].map((v) => Math.round(v * f + 255 * (1 - f))) }
  return [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}
function runLook(rPr, theme) {
  if (!rPr) return {}
  const o = {}
  const f = kid(rPr, 'w:rFonts')
  if (f) {
    const named = av(f, 'w:asciiTheme') || av(f, 'w:hAnsiTheme')
    const font = av(f, 'w:ascii') || av(f, 'w:hAnsi') || (named ? theme.fonts[/^major/.test(named) ? 'major' : 'minor'] : null)
    if (font) o.font = font
  }
  const sz = num(av(kid(rPr, 'w:sz')))
  if (sz) o.size = sz
  const c = kid(rPr, 'w:color')
  if (c) {
    const tc = av(c, 'w:themeColor')
    const hex = tc ? shadeOf(theme.colors[THEME_COLOR[tc] || tc] || av(c), av(c, 'w:themeShade'), av(c, 'w:themeTint')) : av(c)
    if (hex && /^[0-9a-f]{6}$/i.test(hex)) o.color = hex.toUpperCase()
    else if (av(c) === 'auto') o.color = 'auto'
  }
  for (const [tag, k] of [['w:b', 'bold'], ['w:i', 'italic'], ['w:caps', 'caps'], ['w:smallCaps', 'smallCaps']]) { const e = kid(rPr, tag); if (e) o[k] = on(e) }
  const st = kid(rPr, 'w:strike') || kid(rPr, 'w:dstrike')
  if (st) o.strike = on(st)
  const u = kid(rPr, 'w:u')
  if (u) o.underline = av(u) !== 'none'
  const va = av(kid(rPr, 'w:vertAlign'))
  if (va) o.va = va === 'baseline' ? null : va
  const hl = av(kid(rPr, 'w:highlight'))
  if (hl && hl !== 'none') o.highlight = hl
  else { const fill = av(kid(rPr, 'w:shd'), 'w:fill'); if (fill && /^[0-9a-f]{6}$/i.test(fill)) o.highlight = `#${fill.toUpperCase()}` }
  return o
}
// A paragraph's layout, as Word says it: { jc, before, after, line, rule, left, right, first
// (negative: hanging), ol (outline level), numId, ilvl, pbb, keep, contextual, border, shade }.
function paraLook(pPr) {
  if (!pPr) return {}
  const o = {}
  const jc = av(kid(pPr, 'w:jc'))
  if (jc) o.jc = jc
  const sp = kid(pPr, 'w:spacing')
  if (sp) {
    if (num(av(sp, 'w:before')) != null) o.before = num(av(sp, 'w:before'))
    if (num(av(sp, 'w:after')) != null) o.after = num(av(sp, 'w:after'))
    if (num(av(sp, 'w:line')) != null) { o.line = num(av(sp, 'w:line')); o.rule = av(sp, 'w:lineRule') || 'auto' }
  }
  const ind = kid(pPr, 'w:ind')
  if (ind) {
    const l = num(av(ind, 'w:left') ?? av(ind, 'w:start')), r = num(av(ind, 'w:right') ?? av(ind, 'w:end'))
    if (l != null) o.left = l
    if (r != null) o.right = r
    if (num(av(ind, 'w:hanging')) != null) o.first = -num(av(ind, 'w:hanging'))
    else if (num(av(ind, 'w:firstLine')) != null) o.first = num(av(ind, 'w:firstLine'))
  }
  const ol = num(av(kid(pPr, 'w:outlineLvl')))
  if (ol != null) o.ol = ol
  const np = kid(pPr, 'w:numPr')
  if (np) { const id = num(av(kid(np, 'w:numId'))); const lvl = num(av(kid(np, 'w:ilvl'))); if (id != null) o.numId = id; if (lvl != null) o.ilvl = lvl }
  if (kid(pPr, 'w:pageBreakBefore')) o.pbb = on(kid(pPr, 'w:pageBreakBefore'))
  if (kid(pPr, 'w:keepNext')) o.keep = on(kid(pPr, 'w:keepNext'))
  if (kid(pPr, 'w:contextualSpacing')) o.contextual = on(kid(pPr, 'w:contextualSpacing'))
  const bottom = kid(kid(pPr, 'w:pBdr'), 'w:bottom')
  if (bottom && !['nil', 'none'].includes(av(bottom))) o.border = { size: num(av(bottom, 'w:sz')) || 4, color: /^[0-9a-f]{6}$/i.test(av(bottom, 'w:color') || '') ? av(bottom, 'w:color') : '000000', space: num(av(bottom, 'w:space')) || 1 }
  const fill = av(kid(pPr, 'w:shd'), 'w:fill')
  if (fill && /^[0-9a-f]{6}$/i.test(fill)) o.shade = fill.toUpperCase()
  return o
}
// Every style: { id, name, type, basedOn, next, quick, hidden, prio, run, para, look (with what
// it's based on), num }, the document's defaults, and the default paragraph style's id.
function stylesOf(xml, theme) {
  const out = { list: [], byId: new Map(), defaults: { run: {}, para: {} }, normal: null, table: new Map() }
  if (!xml) return out
  const d = parseXml(xml)
  const dd = find(d, 'w:docDefaults')
  out.defaults = { run: runLook(kid(kid(dd, 'w:rPrDefault'), 'w:rPr'), theme), para: paraLook(kid(kid(dd, 'w:pPrDefault'), 'w:pPr')) }
  for (const s of findAll(d, 'w:style')) {
    const st = {
      id: av(s, 'w:styleId'), name: av(kid(s, 'w:name')) || av(s, 'w:styleId'), type: av(s, 'w:type') || 'paragraph',
      basedOn: av(kid(s, 'w:basedOn')), next: av(kid(s, 'w:next')), quick: !!kid(s, 'w:qFormat'),
      hidden: !!kid(s, 'w:semiHidden') || !!kid(s, 'w:hidden'), prio: num(av(kid(s, 'w:uiPriority'))) ?? 99,
      isDefault: on({ attrs: { 'w:val': s.attrs['w:default'] } }) && s.attrs['w:default'] != null,
      run: runLook(kid(s, 'w:rPr'), theme), para: paraLook(kid(s, 'w:pPr')),
    }
    if (!st.id) continue
    if (st.type === 'table') {
      const b = kid(kid(s, 'w:tblPr'), 'w:tblBorders')
      st.borders = !!b && els(b).some((x) => !['nil', 'none'].includes(av(x)))
    }
    out.list.push(st)
    out.byId.set(st.id, st)
    if (st.type === 'paragraph' && st.isDefault) out.normal = st.id
  }
  // What each style looks like with what it's based on (a heading's font from Normal's).
  const look = (st, seen = new Set()) => {
    if (!st || seen.has(st.id)) return { run: {}, para: {} }
    seen.add(st.id)
    const base = st.basedOn ? look(out.byId.get(st.basedOn), seen) : { run: {}, para: {} }
    return { run: { ...base.run, ...st.run }, para: { ...base.para, ...st.para } }
  }
  for (const st of out.list) st.look = look(st)
  if (!out.normal) out.normal = out.byId.has('Normal') ? 'Normal' : null
  return out
}
// Lists: each num's levels ({ fmt, text, start, left, hanging, font }), through its abstractNum.
function numberingOf(xml) {
  const out = { abs: new Map(), nums: new Map(), maxAbs: -1, maxNum: 0 }
  if (!xml) return out
  const d = parseXml(xml)
  for (const a of findAll(d, 'w:abstractNum')) {
    const id = num(av(a, 'w:abstractNumId'))
    out.maxAbs = Math.max(out.maxAbs, id ?? -1)
    const levels = []
    for (const l of kids(a, 'w:lvl')) {
      const i = num(av(l, 'w:ilvl')) ?? levels.length
      const ind = kid(kid(l, 'w:pPr'), 'w:ind')
      const f = kid(kid(l, 'w:rPr'), 'w:rFonts')
      levels[i] = { fmt: av(kid(l, 'w:numFmt')) || 'decimal', text: av(kid(l, 'w:lvlText')) ?? '', start: num(av(kid(l, 'w:start'))) ?? 1, left: num(av(ind, 'w:left') ?? av(ind, 'w:start')), hanging: num(av(ind, 'w:hanging')), font: av(f, 'w:ascii') || av(f, 'w:hAnsi') || null }
    }
    out.abs.set(id, { levels, link: av(kid(a, 'w:numStyleLink')) || av(kid(a, 'w:styleLink')) })
  }
  for (const n of findAll(d, 'w:num')) {
    const id = num(av(n, 'w:numId'))
    out.maxNum = Math.max(out.maxNum, id ?? 0)
    const starts = {}
    for (const o of kids(n, 'w:lvlOverride')) { const s = num(av(kid(o, 'w:startOverride'))); if (s != null) starts[num(av(o, 'w:ilvl')) ?? 0] = s }
    out.nums.set(id, { abs: num(av(kid(n, 'w:abstractNumId'))), starts })
  }
  return out
}
// The words of each comment, footnote and endnote, by id.
function notesOf(xml, tag) {
  const out = new Map()
  if (!xml) return out
  for (const c of findAll(parseXml(xml), tag)) {
    const text = findAll(c, 'w:p').map((p) => findAll(p, 'w:t').map(textIn).join('')).filter(Boolean).join('\n')
    out.set(String(av(c, 'w:id')), { author: av(c, 'w:author'), date: av(c, 'w:date'), initials: av(c, 'w:initials'), text, type: av(c, 'w:type') })
  }
  return out
}

// ---------- Reading ----------
// A part with blocks in it (the document's body, a header, a footer): what comes before them and
// after them as written, and each block's XML and the text before it, by id.
function partOf(path, xml, container, blocks, tailFrom) {
  return { path, xml, head: xml.slice(0, container.st), tail: xml.slice(tailFrom), raws: new Map(), fp: new Map(), n: 0 }
}

// The document as Studio's editor holds it (ProseMirror JSON), from a part's blocks. cx: the part,
// its relationships and pictures, and the file's styles, lists, comments and notes.
function blocksOf(list, cx) {
  return list.map((n) => blockOf(n, cx)).filter(Boolean)
}
// A block kept by id: its XML, and the white space before it (so a file saved with nothing changed
// is the same, byte for byte).
function keep(n, cx) {
  if (!cx.part) return null
  const id = `${cx.tag}${++cx.part.n}`
  let i = n.s
  while (i > 0 && /\s/.test(n.src[i - 1])) i--
  cx.part.raws.set(id, { raw: raw(n), gap: n.src.slice(i, n.s) })
  return id
}
function blockOf(n, cx) {
  if (n.name === 'w:p') return paraOf(n, cx)
  if (n.name === 'w:tbl') return tableOf(n, cx)
  return opaqueBlock(n, cx)
}

const BLOCK_LABEL = { 'Table of Contents': 'contents', 'Cover Pages': 'cover', Bibliographies: 'bibliography' }
function opaqueBlock(n, cx) {
  const x = keep(n, cx)
  let label = 'other', inner = []
  if (n.name === 'w:sdt' || n.name === 'w:customXml') {
    const pr = kid(n, 'w:sdtPr')
    const gallery = av(find(pr, 'w:docPartGallery'))
    label = BLOCK_LABEL[gallery] || 'control'
    const content = n.name === 'w:sdt' ? kid(n, 'w:sdtContent') : n
    inner = blocksOf(els(content).filter((k) => k.name !== 'w:customXmlPr'), { ...cx, part: null })
  } else if (/^w:bookmark|^w:comment|^w:perm|^w:proofErr|^w:moveFrom|^w:moveTo/.test(n.name)) label = 'mark'
  return { type: 'xbl', attrs: { x, raw: raw(n), k: label, inner: inner.length ? inner : null } }
}

// A paragraph: its properties as written (ppr) and as the editor uses them, then its contents.
function pAttrs(pPr) {
  const l = paraLook(pPr)
  const sect = kid(pPr, 'w:sectPr')
  const mark = num(av(kid(kid(pPr, 'w:rPr'), 'w:sz')))
  return {
    s: av(kid(pPr, 'w:pStyle')), al: l.jc || null, ln: l.line != null ? `${l.rule}:${l.line}` : null, sb: l.before ?? null, sa: l.after ?? null,
    il: l.left ?? null, ir: l.right ?? null, fi: l.first ?? null, num: l.numId ?? null, lvl: l.ilvl ?? null, pbb: !!l.pbb,
    sect: sect ? (av(kid(sect, 'w:type')) || 'nextPage') : null, mz: mark,
  }
}
function paraOf(n, cx) {
  const x = keep(n, cx)
  const pPr = kid(n, 'w:pPr')
  const content = inlinesOf(n.kids, cx, [])
  return { type: 'paragraph', attrs: { x, pa: attrText(n), ppr: pPr ? raw(pPr) : '', ...pAttrs(pPr) }, ...(content.length ? { content } : {}) }
}

// A run's look as marks: what Studio changes (bold, a font…) as their own marks, and the run's
// properties as written in rpr, so what Studio doesn't show is kept when it's written again.
function runMarks(rPr, cx) {
  if (!rPr) return []
  const l = runLook(rPr, cx.theme)
  const m = [{ type: 'rpr', attrs: { raw: raw(rPr) } }]
  if (l.bold) m.push({ type: 'bold' })
  if (l.italic) m.push({ type: 'italic' })
  if (l.underline) m.push({ type: 'underline' })
  if (l.strike) m.push({ type: 'strike' })
  if (l.va === 'superscript' || l.va === 'subscript') m.push({ type: 'va', attrs: { v: l.va } })
  if (l.font) m.push({ type: 'ff', attrs: { f: l.font } })
  if (l.size) m.push({ type: 'fs', attrs: { hp: l.size } })
  if (l.color && l.color !== 'auto') m.push({ type: 'fc', attrs: { c: l.color } })
  if (l.highlight) m.push({ type: 'hl', attrs: { c: l.highlight } })
  const rs = av(kid(rPr, 'w:rStyle'))
  if (rs) m.push({ type: 'rs', attrs: { id: rs } })
  if (l.caps || l.smallCaps) m.push({ type: 'caps', attrs: { small: !l.caps } })
  return m
}
const withMarks = (node, marks) => (marks.length ? { ...node, marks } : node)
// A thing in a paragraph Studio shows but doesn't edit (a bookmark, a field, a footnote's number,
// a shape): kept as written. k: what it is, t: what it shows.
const opaque = (rawXml, k, t, marks, more = {}) => withMarks({ type: 'xin', attrs: { raw: rawXml, k, t: t || '', ...more } }, marks)

function fieldEnd(list, i) {
  let depth = 0
  for (let j = i; j < list.length; j++) {
    const k = list[j]
    if (k.name !== 'w:r') { if (k.name && k.name !== 'w:bookmarkStart' && k.name !== 'w:bookmarkEnd' && k.name !== 'w:proofErr') return -1; continue }
    for (const c of els(k)) {
      if (c.name !== 'w:fldChar') continue
      const t = av(c, 'w:fldCharType')
      if (t === 'begin') depth++
      else if (t === 'end' && --depth === 0) return j
    }
  }
  return -1
}
const fieldBegins = (r) => els(r).some((c) => c.name === 'w:fldChar' && av(c, 'w:fldCharType') === 'begin')
function fieldOf(list, i, j, cx, marks) {
  let instr = '', result = '', phase = 0, depth = 0
  for (let k = i; k <= j; k++) {
    for (const c of els(list[k])) {
      if (c.name === 'w:fldChar') { const t = av(c, 'w:fldCharType'); if (t === 'begin') depth++; else if (t === 'separate' && depth === 1) phase = 1; else if (t === 'end') depth-- }
      else if (c.name === 'w:instrText' && depth === 1 && phase === 0) instr += textIn(c)
      else if (c.name === 'w:t' && phase === 1) result += textIn(c)
      else if (c.name === 'w:tab' && phase === 1) result += '\t'
    }
  }
  const src = list[i].src
  const f = instr.trim().split(/\s+/)[0]?.toUpperCase() || ''
  // Shown in its first run's look (a page number in the footer's size), kept as written.
  const look = runMarks(kid(list[i], 'w:rPr'), cx).filter((x) => x.type !== 'rpr')
  return opaque(src.slice(list[i].s, list[j].e), 'fld', result, [...marks, ...look], { f })
}

function inlinesOf(list, cx, marks) {
  const out = []
  for (let i = 0; i < list.length; i++) {
    const k = list[i]
    if (!k.name) continue
    switch (k.name) {
      case 'w:pPr': break
      case 'w:r': {
        if (fieldBegins(k)) { const j = fieldEnd(list, i); if (j > 0) { out.push(fieldOf(list, i, j, cx, marks)); i = j; break } }
        out.push(...runOf(k, cx, marks))
        break
      }
      case 'w:hyperlink': {
        const rid = av(k, 'r:id'), anchor = av(k, 'w:anchor')
        const rel = rid ? cx.rels.find((r) => r.id === rid) : null
        const href = rel ? rel.target : anchor ? `#${anchor}` : ''
        out.push(...inlinesOf(k.kids, cx, [...marks, { type: 'link', attrs: { href, rid, anchor, tag: startTag(k) } }]))
        break
      }
      case 'w:ins': case 'w:del': case 'w:moveTo': case 'w:moveFrom':
        out.push(...inlinesOf(k.kids, cx, [...marks, { type: 'rev', attrs: { k: local(k.name), tag: startTag(k), by: av(k, 'w:author'), at: av(k, 'w:date') } }]))
        break
      case 'w:smartTag': case 'w:customXml':
        out.push(...inlinesOf(k.kids.filter((c) => !/Pr$/.test(c.name || '')), cx, marks))
        break
      case 'w:proofErr': break
      case 'w:bookmarkStart': case 'w:bookmarkEnd': out.push(opaque(raw(k), 'bm', '', marks, { id: av(k, 'w:name') || av(k, 'w:id') })); break
      case 'w:commentRangeStart': case 'w:commentRangeEnd': out.push(opaque(raw(k), k.name === 'w:commentRangeStart' ? 'cs' : 'ce', '', marks, { id: av(k, 'w:id') })); break
      case 'w:fldSimple': { const instr = av(k, 'w:instr') || ''; out.push(opaque(raw(k), 'fld', findAll(k, 'w:t').map(textIn).join(''), marks, { f: instr.trim().split(/\s+/)[0]?.toUpperCase() || '' })); break }
      case 'm:oMath': case 'm:oMathPara': out.push(opaque(raw(k), 'math', findAll(k, 'm:t').map(textIn).join(''), marks)); break
      default: out.push(opaque(raw(k), 'other', findAll(k, 'w:t').map(textIn).join(''), marks))
    }
  }
  return out
}

function runOf(r, cx, wrap) {
  const rPr = kid(r, 'w:rPr')
  const marks = [...wrap, ...runMarks(rPr, cx)]
  const pre = `${startTag(r)}${rPr ? raw(rPr) : ''}`
  const whole = (c) => `${pre}${raw(c)}${closeTag(r)}`
  const out = []
  let text = ''
  const flush = () => { if (text) { out.push(withMarks({ type: 'text', text }, marks)); text = '' } }
  for (const c of els(r)) {
    switch (c.name) {
      case 'w:rPr': case 'w:lastRenderedPageBreak': break
      case 'w:t': case 'w:delText': text += textIn(c); break
      case 'w:noBreakHyphen': text += '\u2011'; break
      case 'w:softHyphen': text += '\u00AD'; break
      case 'w:tab': case 'w:ptab': flush(); out.push(withMarks({ type: 'tab' }, marks)); break
      case 'w:cr': flush(); out.push(withMarks({ type: 'hardBreak' }, marks)); break
      case 'w:br': {
        flush()
        const t = av(c, 'w:type')
        if (t === 'page') out.push({ type: 'pbr' })
        else if (!t || t === 'textWrapping') out.push(withMarks({ type: 'hardBreak' }, marks))
        else out.push(opaque(whole(c), 'other', '', wrap))
        break
      }
      case 'w:drawing': { flush(); out.push(imageOf(c, cx, marks, wrap, whole(c))); break }
      case 'w:footnoteReference': case 'w:endnoteReference': {
        flush()
        const id = String(av(c, 'w:id'))
        const foot = c.name === 'w:footnoteReference'
        const n = foot ? ++cx.notes.foot : ++cx.notes.end
        out.push(opaque(whole(c), foot ? 'fn' : 'en', foot ? String(n) : roman(n), wrap, { id }))
        break
      }
      case 'w:commentReference': flush(); out.push(opaque(whole(c), 'cr', '', wrap, { id: av(c, 'w:id') })); break
      case 'w:fldChar': case 'w:instrText': flush(); out.push(opaque(whole(c), 'fc', '', wrap)); break
      case 'w:sym': flush(); out.push(opaque(whole(c), 'sym', symbol(c), marks.filter((x) => x.type !== 'rpr'))); break
      default: flush(); out.push(opaque(whole(c), 'shape', '', wrap))
    }
  }
  flush()
  return out
}
const roman = (n) => ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][n - 1] || String(n)
// Word's symbols from Symbol and Wingdings, as near as Unicode has them.
const SYM = { F0B7: '•', F0A7: '▪', F0D8: '➢', F0FC: '✓', F076: '❖', F0A8: '□', F06C: '●', F06E: '■', F0E0: '→', F0E8: '➔', F0FB: '✗', F071: '❑', F0D7: '◆' }
const symbol = (c) => SYM[(av(c, 'w:char') || '').toUpperCase()] || '□'

// A picture: shown from its file in the package, at its size (EMUs: 9525 a pixel at 96 dpi).
// Kept as written, its size changed in place when you resize it. A chart or shape: kept, shown as
// a box saying what it is.
const EMU = 9525
function imageOf(d, cx, marks, wrap, whole) {
  const blip = find(d, 'a:blip')
  const rid = av(blip, 'r:embed')
  const ext = kid(kid(d, 'wp:inline') || kid(d, 'wp:anchor'), 'wp:extent')
  const w = Math.round((num(av(ext, 'cx')) || 0) / EMU), h = Math.round((num(av(ext, 'cy')) || 0) / EMU)
  const media = rid ? cx.media(rid) : null
  if (!media) {
    const chart = find(d, 'a:graphicData')?.attrs.uri || ''
    return opaque(whole, 'shape', /chart/.test(chart) ? 'chart' : /diagram/.test(chart) ? 'diagram' : 'shape', wrap, { w, h })
  }
  const pr = find(d, 'wp:docPr')
  return withMarks({ type: 'image', attrs: { src: media.url, alt: av(pr, 'descr') || av(pr, 'title') || null, title: null, width: w || null, height: h || null, rid, raw: raw(d), w0: w, h0: h, float: !!kid(d, 'wp:anchor') } }, marks)
}

// A table: its properties and grid as written, each row's and cell's too; a cell merged down
// (vMerge) is one cell spanning those rows, as the editor has it.
function tableOf(n, cx) {
  const x = keep(n, cx)
  const tblPr = kid(n, 'w:tblPr')
  const grid = kids(kid(n, 'w:tblGrid'), 'w:gridCol').map((g) => num(av(g, 'w:w')) || 0)
  const rowsXml = kids(n, 'w:tr')
  // Something else among its rows (a content control around some): kept whole, shown only.
  if (els(n).some((k) => !['w:tblPr', 'w:tblGrid', 'w:tr', 'w:bookmarkStart', 'w:bookmarkEnd'].includes(k.name))) return opaqueBlock(n, cx)
  const styleId = av(kid(tblPr, 'w:tblStyle'))
  const ownBorders = kid(tblPr, 'w:tblBorders')
  const borders = ownBorders ? els(ownBorders).some((b) => !['nil', 'none'].includes(av(b))) : !!cx.styles.byId.get(styleId)?.borders
  // Each cell's place in the grid, and how many rows it spans down.
  const rows = rowsXml.map((tr) => {
    let col = num(av(kid(kid(tr, 'w:trPr'), 'w:gridBefore'))) || 0
    return kids(tr, 'w:tc').map((tc) => {
      const pr = kid(tc, 'w:tcPr')
      const span = num(av(kid(pr, 'w:gridSpan'))) || 1
      const vm = kid(pr, 'w:vMerge')
      const c = { tc, col, span, merge: vm ? (av(vm) === 'restart' ? 'restart' : 'continue') : null, down: 1 }
      col += span
      return c
    })
  })
  rows.forEach((cells, r) => cells.forEach((c) => {
    if (c.merge !== 'restart') return
    for (let k = r + 1; k < rows.length; k++) { const below = rows[k].find((b) => b.col === c.col); if (below?.merge === 'continue') { below.covered = true; c.down++ } else break }
  }))
  const px = (tw) => Math.max(8, Math.round(tw / 15))
  const content = rows.map((cells, r) => {
    const tr = rowsXml[r]
    const trPr = kid(tr, 'w:trPr')
    const rowX = keep(tr, cx)
    return {
      type: 'tableRow', attrs: { x: rowX, ra: attrText(tr), trpr: trPr ? raw(trPr) : '', head: !!kid(trPr, 'w:tblHeader') },
      content: cells.filter((c) => !c.covered).map((c) => {
        const pr = kid(c.tc, 'w:tcPr')
        const fill = av(kid(pr, 'w:shd'), 'w:fill')
        const widths = grid.length >= c.col + c.span ? grid.slice(c.col, c.col + c.span).map(px) : null
        const inner = blocksOf(els(c.tc).filter((k) => k.name !== 'w:tcPr'), cx)
        return {
          type: 'tableCell',
          attrs: { x: keep(c.tc, cx), ca: attrText(c.tc), tcpr: pr ? raw(pr) : '', colspan: c.span, rowspan: c.down, colwidth: widths, bg: fill && /^[0-9a-f]{6}$/i.test(fill) ? fill.toUpperCase() : null, va: av(kid(pr, 'w:vAlign')) },
          content: inner.length ? inner : [{ type: 'paragraph', attrs: { x: null, pa: '', ppr: '' } }],
        }
      }),
    }
  }).filter((r) => r.content.length)
  if (!content.length) return opaqueBlock(n, cx)
  return { type: 'table', attrs: { x, ta: attrText(n), tpr: tblPr ? raw(tblPr) : '', grid: grid.join(','), bd: borders, al: av(kid(tblPr, 'w:jc')), ts: styleId }, content }
}

// A header's or footer's part, read like the body.
function hfPart(path, xml, cx) {
  const top = parseXml(xml)
  const root = els(top)[0]
  if (!root) return null
  const list = els(root)
  const part = partOf(path, xml, root, list, list.length ? list[list.length - 1].e : root.st)
  const c = { ...cx, part, tag: `${path.split('/').pop().replace(/\.xml$/, '')}:`, rels: cx.relsFor(path), media: cx.mediaFor(path) }
  const content = blocksOf(list, c)
  return { part, json: { type: 'doc', content: content.length ? content : [{ type: 'paragraph', attrs: { x: null, pa: '', ppr: '' } }] } }
}

// The page: its size and margins in twips (1440 an inch), from the section's properties.
function pageOf(sect) {
  const sz = kid(sect, 'w:pgSz'), mar = kid(sect, 'w:pgMar')
  const g = (n, a, d) => num(av(n, a)) ?? d
  return {
    w: g(sz, 'w:w', 12240), h: g(sz, 'w:h', 15840), orient: av(sz, 'w:orient') || 'portrait',
    top: Math.abs(g(mar, 'w:top', 1440)), bottom: Math.abs(g(mar, 'w:bottom', 1440)), left: g(mar, 'w:left', 1440), right: g(mar, 'w:right', 1440),
    header: g(mar, 'w:header', 720), footer: g(mar, 'w:footer', 720), gutter: g(mar, 'w:gutter', 0),
    cols: num(av(kid(sect, 'w:cols'), 'w:num')) || 1,
  }
}

// urlOf(bytes, mime): how the editor shows a picture (a blob: URL in the browser).
export async function readDocx(buf, { urlOf = () => '' } = {}) {
  const zip = await JSZip.loadAsync(buf)
  const str = (p) => (zip.file(p) ? zip.file(p).async('string') : Promise.resolve(null))
  const top = relsOf(await str('_rels/.rels'))
  const docPath = (top.find((r) => /\/officeDocument$/.test(r.type))?.target || 'word/document.xml').replace(/^\//, '')
  const xml = await str(docPath)
  if (!xml) throw new Error('There\'s no document in this Word file')
  const relsXml = {}
  const relsCache = new Map()
  const relsFor = (p) => relsCache.get(p) || []
  const loadRels = async (p) => { const x = await str(relsPath(p)); relsXml[p] = x; relsCache.set(p, relsOf(x)) }
  await loadRels(docPath)
  const rels = relsFor(docPath)
  const byType = (t) => rels.find((r) => r.type === `${REL}/${t}` || r.type.endsWith(`/${t}`))
  const partPath = (t) => { const r = byType(t); return r ? resolve(docPath, r.target) : null }
  const theme = themeOf(await str(partPath('theme') || 'word/theme/theme1.xml'))
  const stylesPath = partPath('styles'), numberingPath = partPath('numbering')
  const styles = stylesOf(await str(stylesPath), theme)
  const numbering = numberingOf(await str(numberingPath))
  const comments = notesOf(await str(partPath('comments')), 'w:comment')
  const footnotes = notesOf(await str(partPath('footnotes')), 'w:footnote')
  const endnotes = notesOf(await str(partPath('endnotes')), 'w:endnote')
  // Each part's pictures, read before the part is: by relationship id, { path, url }.
  const mediaCache = new Map()
  const loadMedia = async (p) => {
    const m = new Map()
    for (const r of relsFor(p)) {
      if (!/\/image$/.test(r.type) || r.mode === 'External') continue
      const path = resolve(p, r.target)
      const f = zip.file(path)
      if (!f) continue
      const bytes = await f.async('uint8array')
      m.set(r.id, { path, url: urlOf(bytes, mimeOf(path)) })
    }
    mediaCache.set(p, m)
  }
  await loadMedia(docPath)
  const mediaFor = (p) => (rid) => mediaCache.get(p)?.get(rid) || null

  const d = parseXml(xml)
  const docEl = els(d)[0]
  const body = kid(docEl, 'w:body')
  if (!body) throw new Error('This Word file\'s document has no body')
  const list = els(body)
  const sect = list.length && list[list.length - 1].name === 'w:sectPr' ? list[list.length - 1] : null
  const blocks = sect ? list.slice(0, -1) : list
  const main = partOf(docPath, xml, body, blocks, blocks.length ? blocks[blocks.length - 1].e : body.st)
  main.sect = sect ? { raw: raw(sect), at: sect.s - (blocks.length ? blocks[blocks.length - 1].e : body.st) } : null
  const cx = { part: main, tag: '', rels, media: mediaFor(docPath), theme, styles, numbering, notes: { foot: 0, end: 0 }, relsFor, mediaFor }
  const content = blocksOf(blocks, cx)
  // Headers and footers, from the last section's properties (the one the document ends with).
  const hf = { header: {}, footer: {}, titlePg: !!kid(sect, 'w:titlePg') }
  for (const ref of [...kids(sect, 'w:headerReference'), ...kids(sect, 'w:footerReference')]) {
    const rel = rels.find((r) => r.id === av(ref, 'r:id'))
    if (!rel) continue
    const p = resolve(docPath, rel.target)
    const x = await str(p)
    if (!x) continue
    await loadRels(p)
    await loadMedia(p)
    const h = hfPart(p, x, cx)
    if (h) hf[ref.name === 'w:headerReference' ? 'header' : 'footer'][av(ref, 'w:type') || 'default'] = { path: p, ...h }
  }
  const ns = { ...(docEl.scope || {}) }
  const maxRid = Math.max(0, ...rels.map((r) => num(/^rId(\d+)$/.exec(r.id)?.[1]) || 0))
  const maxDocPr = Math.max(0, ...[...xml.matchAll(/<wp:docPr\b[^>]*?\sid="(\d+)"/g)].map((m) => Number(m[1])))
  return {
    zip, docPath, relsXml, rels: relsCache, main, hf, json: { type: 'doc', content: content.length ? content : [{ type: 'paragraph', attrs: { x: null, pa: '', ppr: '' } }] },
    styles, numbering, theme, comments, footnotes, endnotes, page: pageOf(sect), stylesPath, numberingPath, ns,
    added: { rels: new Map(), media: new Map(), styles: new Map(), abs: [], nums: [], next: { rid: maxRid, docPr: maxDocPr, abs: numbering.maxAbs, num: numbering.maxNum } },
  }
}

// What each block was when the editor first had it (its JSON), by id: a block the same when it's
// saved is written as it was read.
export function fingerprint(part, json) {
  part.fp.clear()
  const walk = (n) => { if (n.attrs?.x) part.fp.set(n.attrs.x, JSON.stringify(n)); for (const c of n.content || []) walk(c) }
  walk(json)
}

// ---------- Writing ----------
// The order Word's schema puts each property in; Word turns a file down when they're out of order.
const RPR = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange']
const PPR = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange']
const TCPR = ['cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark', 'headers', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange']

// Properties as written, with some changed: each child kept as written unless set (xml) or taken
// out (null), in the schema's order.
function props(rawXml, tag, order, changes, scope) {
  const el = rawXml ? els(parseXml(rawXml, scope))[0] : null
  const have = new Map()
  for (const k of els(el)) { const n = local(k.name); if (!have.has(n)) have.set(n, []); have.get(n).push(raw(k)) }
  for (const [n, xml] of Object.entries(changes)) { if (xml == null) have.delete(n); else have.set(n, [xml]) }
  if (!have.size) return ''
  const rank = (n) => { const i = order.indexOf(n); return i < 0 ? order.length : i }
  const body = [...have.keys()].sort((a, b) => rank(a) - rank(b)).map((n) => have.get(n).join('')).join('')
  return `<w:${tag}${el ? attrText(el) : ''}>${body}</w:${tag}>`
}
// An element's attributes changed (null takes one out), the rest as written.
function withAttrs(rawXml, name, set, scope) {
  const el = rawXml ? els(parseXml(rawXml, scope))[0] : null
  const a = { ...(el?.attrs || {}) }
  for (const [k, v] of Object.entries(set)) { if (v == null) delete a[k]; else a[k] = String(v) }
  const keys = Object.keys(a)
  return keys.length ? `<w:${name}${keys.map((k) => ` ${k}="${esc(a[k])}"`).join('')}/>` : null
}

export class Writer {
  // A new picture's id counts on from the file's own, the same way each save, so a file saved again
  // as it is comes out the same.
  constructor(model) { this.m = model; this.scope = { ...NS, ...model.ns }; this.docPr = model.added.next.docPr }
  relsAdd(from, type, target, external = false) {
    const key = `${from}\n${type}\n${target}`
    const a = this.m.added.rels
    if (a.has(key)) return a.get(key).id
    const id = `rId${++this.m.added.next.rid + 1000}`
    a.set(key, { from, id, type: `${REL}/${type}`, target, external })
    return id
  }
  // A run's properties: as written, with what the marks change.
  rpr(marks) {
    const by = Object.fromEntries((marks || []).map((m) => [m.type, m.attrs || true]))
    const was = by.rpr?.raw ? runLook(els(parseXml(by.rpr.raw, this.scope))[0], this.m.theme) : {}
    const wasRs = by.rpr?.raw ? av(kid(els(parseXml(by.rpr.raw, this.scope))[0], 'w:rStyle')) : null
    const c = {}
    const flag = (k, tags, mark) => { if (!!was[k] !== !!mark) { c[tags[0]] = mark ? `<w:${tags[0]}/>` : null; for (const t of tags.slice(1)) c[t] = null } }
    flag('bold', ['b', 'bCs'], by.bold)
    flag('italic', ['i', 'iCs'], by.italic)
    flag('strike', ['strike', 'dstrike'], by.strike)
    if (!!was.underline !== !!by.underline) c.u = by.underline ? '<w:u w:val="single"/>' : null
    if ((was.va || null) !== (by.va?.v || null)) c.vertAlign = by.va?.v ? `<w:vertAlign w:val="${by.va.v}"/>` : null
    if ((was.font || null) !== (by.ff?.f || null)) c.rFonts = by.ff?.f ? `<w:rFonts w:ascii="${esc(by.ff.f)}" w:hAnsi="${esc(by.ff.f)}" w:cs="${esc(by.ff.f)}"/>` : null
    if ((was.size || null) !== (by.fs?.hp || null)) { c.sz = by.fs?.hp ? `<w:sz w:val="${Math.round(by.fs.hp)}"/>` : null; c.szCs = by.fs?.hp ? `<w:szCs w:val="${Math.round(by.fs.hp)}"/>` : null }
    const wasColor = was.color && was.color !== 'auto' ? was.color : null
    if (wasColor !== (by.fc?.c || null)) c.color = by.fc?.c ? `<w:color w:val="${by.fc.c}"/>` : null
    if ((was.highlight || null) !== (by.hl?.c || null)) {
      const h = by.hl?.c || null
      c.highlight = h && !h.startsWith('#') ? `<w:highlight w:val="${h}"/>` : null
      if (h?.startsWith('#')) c.shd = `<w:shd w:val="clear" w:color="auto" w:fill="${h.slice(1)}"/>`
      else if (was.highlight?.startsWith('#')) c.shd = null
    }
    if ((wasRs || null) !== (by.rs?.id || null)) c.rStyle = by.rs?.id ? `<w:rStyle w:val="${esc(by.rs.id)}"/>` : null
    return props(by.rpr?.raw || '', 'rPr', RPR, c, this.scope)
  }
  // A paragraph's properties: as written, with what the editor changed.
  ppr(a, part) {
    const el = a.ppr ? els(parseXml(a.ppr, this.scope))[0] : null
    const was = pAttrs(el)
    const c = {}
    if ((a.s || null) !== (was.s || null)) { c.pStyle = a.s ? `<w:pStyle w:val="${esc(a.s)}"/>` : null; if (a.s) this.needStyle(a.s) }
    if ((a.al || null) !== (was.al || null)) c.jc = a.al ? `<w:jc w:val="${a.al}"/>` : null
    if (a.ln !== was.ln || a.sb !== was.sb || a.sa !== was.sa) {
      const [rule, line] = a.ln ? a.ln.split(':') : [null, null]
      c.spacing = withAttrs(el ? raw(kid(el, 'w:spacing')) : '', 'spacing', { 'w:before': a.sb, 'w:after': a.sa, 'w:line': line, 'w:lineRule': line ? rule : null, ...(a.sb !== was.sb ? { 'w:beforeAutospacing': null } : {}), ...(a.sa !== was.sa ? { 'w:afterAutospacing': null } : {}) }, this.scope)
    }
    if (a.il !== was.il || a.ir !== was.ir || a.fi !== was.fi) {
      c.ind = withAttrs(el ? raw(kid(el, 'w:ind')) : '', 'ind', { 'w:start': null, 'w:end': null, 'w:left': a.il, 'w:right': a.ir, 'w:firstLine': a.fi != null && a.fi > 0 ? a.fi : null, 'w:hanging': a.fi != null && a.fi < 0 ? -a.fi : null }, this.scope)
    }
    if (a.num !== was.num || a.lvl !== was.lvl) c.numPr = a.num != null ? `<w:numPr><w:ilvl w:val="${a.lvl || 0}"/><w:numId w:val="${a.num}"/></w:numPr>` : null
    if (!!a.pbb !== !!was.pbb) c.pageBreakBefore = a.pbb ? '<w:pageBreakBefore/>' : null
    return props(a.ppr || '', 'pPr', PPR, c, this.scope)
  }
  text(t, rev) {
    const sp = /^\s|\s$|\s\s/.test(t) ? ' xml:space="preserve"' : ''
    return rev === 'del' || rev === 'moveFrom' ? `<w:delText${sp}>${esc(t)}</w:delText>` : `<w:t${sp}>${esc(t)}</w:t>`
  }
  inline(list, part) {
    let out = ''
    let link = null, rev = null
    const close = () => { if (rev) { out += `</w:${rev.attrs.k}>`; rev = null } }
    const closeLink = () => { close(); if (link) { out += '</w:hyperlink>'; link = null } }
    const same = (a, b) => JSON.stringify(a?.attrs) === JSON.stringify(b?.attrs)
    for (const n of list) {
      const marks = n.marks || []
      const l = marks.find((m) => m.type === 'link') || null
      const r = marks.find((m) => m.type === 'rev') || null
      if (!same(l, link) || (!l) !== (!link)) {
        closeLink()
        if (l) { out += this.linkOpen(l.attrs, part); link = l }
      }
      if (!same(r, rev) || (!r) !== (!rev)) {
        close()
        if (r) { out += r.attrs.tag || `<w:${r.attrs.k}>`; rev = r }
      }
      out += this.node(n, part, r?.attrs.k)
    }
    closeLink()
    return out
  }
  linkOpen(a, part) {
    const href = a.href || ''
    const rel = a.rid ? this.m.rels.get(part.path)?.find((x) => x.id === a.rid) : null
    if (a.tag && ((rel && rel.target === href) || (!a.rid && a.anchor && href === `#${a.anchor}`))) return a.tag
    if (href.startsWith('#')) return `<w:hyperlink w:anchor="${esc(href.slice(1))}" w:history="1">`
    return `<w:hyperlink r:id="${this.relsAdd(part.path, 'hyperlink', href, true)}" w:history="1">`
  }
  node(n, part, rev) {
    const own = (n.marks || []).filter((m) => m.type !== 'link' && m.type !== 'rev')
    switch (n.type) {
      case 'text': return `<w:r>${this.rpr(own)}${this.text(n.text, rev)}</w:r>`
      case 'hardBreak': return `<w:r>${this.rpr(own)}<w:br/></w:r>`
      case 'tab': return `<w:r>${this.rpr(own)}<w:tab/></w:r>`
      case 'pbr': return '<w:r><w:br w:type="page"/></w:r>'
      case 'image': return `<w:r>${this.rpr(own)}${this.drawing(n.attrs, part)}</w:r>`
      case 'xin': return n.attrs.raw
      default: return ''
    }
  }
  drawing(a, part) {
    const cx = Math.round((a.width || a.w0 || 100) * EMU), cy = Math.round((a.height || a.h0 || 100) * EMU)
    if (a.raw) {
      if (a.width === a.w0 && a.height === a.h0) return a.raw
      const size = (tag) => (s) => s.replace(new RegExp(`(<${tag}\\b[^>]*?\\scx=")\\d+(")`), `$1${cx}$2`).replace(new RegExp(`(<${tag}\\b[^>]*?\\scy=")\\d+(")`), `$1${cy}$2`)
      return size('a:ext')(size('wp:extent')(a.raw))
    }
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(a.src || '')
    if (!m) return ''
    const ext = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[m[1]] || 'png'
    const key = a.src.length + m[2].slice(0, 64) + m[2].slice(-64)
    let media = this.m.added.media.get(key)
    if (!media) {
      const name = `media/studio${this.m.added.media.size + 1}-${Date.now().toString(36)}.${ext}`
      media = { path: resolve(this.m.docPath, name), data: m[2], ext, mime: m[1] }
      this.m.added.media.set(key, media)
    }
    const rid = this.relsAdd(part.path, 'image', relTarget(part.path, media.path))
    const id = ++this.docPr
    const A = NS.a, PIC = NS.pic
    return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}"${a.alt ? ` descr="${esc(a.alt)}"` : ''}/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  }
  blocks(list, part, seen = new Set()) {
    let out = ''
    for (const n of list) out += this.block(n, part, seen)
    return out
  }
  // A block as it was read when it's the same (once: a copy is written anew), else written anew.
  same(n, part, seen) {
    const x = n.attrs?.x
    if (!x) return null
    if (seen.has(x)) return false
    seen.add(x)
    return part.fp.get(x) === JSON.stringify(n) ? part.raws.get(x) : null
  }
  block(n, part, seen) {
    const was = this.same(n, part, seen)
    if (was) return was.gap + was.raw
    const copy = was === false
    if (n.type === 'paragraph') { const a = n.attrs || {}; return `<w:p${copy ? noIds(a.pa) : a.pa || ''}>${this.ppr(a, part)}${this.inline(n.content || [], part)}</w:p>` }
    if (n.type === 'table') return this.table(n, part, seen)
    if (n.type === 'xbl') return n.attrs.raw || ''
    return ''
  }
  table(n, part, seen) {
    const a = n.attrs
    const rows = n.content || []
    // The grid: the column widths the cells say (resized), else as written.
    const was = (a.grid || '').split(',').filter(Boolean).map(Number)
    const cols = []
    rows.forEach((r) => { let c = 0; for (const cell of r.content || []) { const w = cell.attrs.colwidth; for (let i = 0; i < (cell.attrs.colspan || 1); i++) { if (w?.[i] && cols[c + i] == null) cols[c + i] = w[i] } c += cell.attrs.colspan || 1 } })
    let resized = cols.length !== was.length || cols.some((w, i) => w !== Math.max(8, Math.round(was[i] / 15)))
    let grid = resized ? cols.map((w, i) => (w ? w * 15 : was[i] || 1440)) : was
    // A table made here (or given more columns) has no width for some: the page's width shared out,
    // as Word gives a new table. Word wants a width for every column in the grid.
    const wide = Math.max(0, ...rows.map((r) => (r.content || []).reduce((sum, c) => sum + (c.attrs.colspan || 1), 0)))
    if (grid.length < wide || (!a.x && grid.some((w) => !w))) {
      const pg = this.m.page
      const each = Math.round(Math.max(1440, pg.w - pg.left - pg.right) / wide)
      grid = Array.from({ length: wide }, (_, i) => grid[i] || each)
      resized = true
    }
    this.resized = resized
    let out = `<w:tbl${a.ta || ''}>${a.tpr || '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr>'}<w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${Math.round(w)}"/>`).join('')}</w:tblGrid>`
    if (!a.tpr) this.needStyle('TableGrid')
    // Cells merged down: written as Word has them, a cell in each row the merge covers. cover: by
    // the grid column a merge starts in, the rows it has still to cover.
    const cover = []
    for (const r of rows) {
      const same = resized ? null : this.same(r, part, seen)
      let row = '', c = 0
      const starts = []
      const skip = () => { while (cover[c]?.left > 0) { if (!same) row += this.cont(cover[c], grid, c); c += cover[c].span } }
      for (const cell of r.content || []) {
        skip()
        const span = cell.attrs.colspan || 1, down = cell.attrs.rowspan || 1
        if (down > 1) starts.push([c, { left: down - 1, span, tcpr: cell.attrs.tcpr }])
        if (!same) row += this.cell(cell, part, seen, grid, c, down > 1, resized)
        c += span
      }
      while (c < cover.length) { if (cover[c]?.left > 0) skip(); else c++ }
      for (const cv of cover) if (cv?.left > 0) cv.left--
      for (const [col, cv] of starts) cover[col] = cv
      out += same ? same.gap + same.raw : `<w:tr${same === false ? noIds(r.attrs.ra) : r.attrs.ra || ''}>${r.attrs.trpr || ''}${row}</w:tr>`
    }
    return `${out}</w:tbl>`
  }
  cell(cell, part, seen, grid, col, restart, resized) {
    const same = this.same(cell, part, seen)
    if (same && !resized) return same.gap + same.raw
    const a = cell.attrs
    const span = a.colspan || 1
    const w = grid.slice(col, col + span).reduce((s, x) => s + x, 0)
    const pr = props(a.tcpr || '', 'tcPr', TCPR, {
      ...(resized || !a.tcpr ? { tcW: `<w:tcW w:w="${Math.round(w)}" w:type="dxa"/>` } : {}),
      gridSpan: span > 1 ? `<w:gridSpan w:val="${span}"/>` : null,
      vMerge: restart ? '<w:vMerge w:val="restart"/>' : null,
      ...(a.bg !== shadeOfCell(a.tcpr, this.scope) ? { shd: a.bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${a.bg}"/>` : null } : {}),
    }, this.scope)
    let inner = this.blocks(cell.content || [], part, seen)
    if (!(cell.content || []).length || cell.content[cell.content.length - 1].type !== 'paragraph') inner += '<w:p/>'
    return `<w:tc${a.ca || ''}>${pr}${inner}</w:tc>`
  }
  cont(cv, grid, col) {
    const w = grid.slice(col, col + cv.span).reduce((s, x) => s + x, 0)
    const pr = props(cv.tcpr || '', 'tcPr', TCPR, { ...(this.resized ? { tcW: `<w:tcW w:w="${Math.round(w)}" w:type="dxa"/>` } : {}), gridSpan: cv.span > 1 ? `<w:gridSpan w:val="${cv.span}"/>` : null, vMerge: '<w:vMerge/>' }, this.scope)
    return `<w:tc>${pr}<w:p/></w:tc>`
  }
  // A style the document uses that its styles don't have (a Quote, a Title): added from Word's own.
  needStyle(id) {
    if (this.m.styles.byId.has(id) || !BUILTIN[id]) return
    this.m.added.styles.set(id, BUILTIN[id])
  }
}
const noIds = (t) => String(t || '').replace(/\s+w14:(paraId|textId)="[^"]*"/g, '')
const shadeOfCell = (tcpr, scope) => { if (!tcpr) return null; const f = av(kid(els(parseXml(tcpr, scope))[0], 'w:shd'), 'w:fill'); return f && /^[0-9a-f]{6}$/i.test(f) ? f.toUpperCase() : null }
const relTarget = (from, to) => {
  const a = from.split('/').slice(0, -1), b = to.split('/')
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

// Word's own definitions of the styles Studio offers, for a document that doesn't have one yet.
const H = (n, size, color) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 360 : 160}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
export const BUILTIN = {
  Title: '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>',
  Subtitle: '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="11"/><w:qFormat/><w:rPr><w:color w:val="595959"/><w:spacing w:val="15"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>',
  Heading1: H(1, 40, '0F4761'), Heading2: H(2, 32, '0F4761'), Heading3: H(3, 28, '0F4761'), Heading4: H(4, 24, '0F4761'),
  Quote: '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:spacing w:before="160"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040"/></w:rPr></w:style>',
  ListParagraph: '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>',
  NoSpacing: '<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:uiPriority w:val="1"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
  TableGrid: '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>',
}
// The looks of those styles, for the editor before the file has them.
export function builtinStyle(id, theme = { fonts: {}, colors: {} }) {
  const x = BUILTIN[id]
  if (!x) return null
  return stylesOf(`<w:styles xmlns:w="${NS.w}">${x}</w:styles>`, theme).list[0]
}

// Lists: a numbering definition for bullets, numbers or a checklist (a bullet that's a box, ticked
// or not: how a checklist is kept in a Word file), added when the document has none. kind: 'bullet',
// 'number', 'check' or 'checked' (true and false are bullets and numbers, as before). fresh: numbers
// that start again at 1, as a new list does, rather than going on from the document's last one.
export const CHECK = { check: '☐', checked: '☑' }
export function listKindOf(m, numId, lvl = 0) {
  const l = m.numbering.abs.get(m.numbering.nums.get(numId)?.abs)?.levels?.[lvl || 0]
  if (!l) return null
  if (l.fmt !== 'bullet') return 'number'
  return l.text === CHECK.check ? 'check' : l.text === CHECK.checked || l.text === '☒' ? 'checked' : 'bullet'
}
export function listNum(m, kind, { fresh = false } = {}) {
  if (kind === true) kind = 'bullet'
  if (kind === false || !kind) kind = 'number'
  let found = null
  for (const [id, n] of m.numbering.nums) {
    const a = m.numbering.abs.get(n.abs)
    const l0 = a?.levels?.[0]
    if (!l0 || a.link) continue
    const k = listKindOf(m, id)
    if (k === kind && (kind !== 'number' || l0.fmt === 'decimal')) { found = { id, abs: n.abs }; break }
  }
  if (found && !(fresh && kind === 'number')) return found.id
  // Numbers that start again: the same list's look, counted from 1 (a num of its own).
  if (found) {
    const id = ++m.added.next.num
    m.added.nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${found.abs}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`)
    m.numbering.nums.set(id, { abs: found.abs, starts: { 0: 1 } })
    return id
  }
  const abs = ++m.added.next.abs
  const id = ++m.added.next.num
  const marks = kind === 'check' || kind === 'checked' ? Array(9).fill(CHECK[kind]) : ['•', 'o', '▪', '•', 'o', '▪', '•', 'o', '▪']
  const bullets = kind !== 'number'
  const fmts = ['decimal', 'lowerLetter', 'lowerRoman']
  const fontOf = (t) => (t === 'o' ? 'Courier New' : t === CHECK.check || t === CHECK.checked ? 'Segoe UI Symbol' : null)
  const levels = Array.from({ length: 9 }, (_, i) => ({ fmt: bullets ? 'bullet' : fmts[i % 3], text: bullets ? marks[i] : `%${i + 1}.`, start: 1, left: 720 * (i + 1), hanging: 360, font: bullets ? fontOf(marks[i]) : null }))
  const xml = `<w:abstractNum w:abstractNumId="${abs}"><w:multiLevelType w:val="hybridMultilevel"/>${levels.map((l, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${l.fmt}"/><w:lvlText w:val="${esc(l.text)}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${l.left}" w:hanging="360"/></w:pPr>${l.font ? `<w:rPr><w:rFonts w:ascii="${l.font}" w:hAnsi="${l.font}" w:cs="${l.font}"/></w:rPr>` : ''}</w:lvl>`).join('')}</w:abstractNum>`
  m.added.abs.push(xml)
  m.added.nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${abs}"/></w:num>`)
  m.numbering.abs.set(abs, { levels, link: null })
  m.numbering.nums.set(id, { abs, starts: {} })
  return id
}

// A header or footer part, new: its paragraphs' XML.
const HF_NS = `xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}"`

// The section's page set (Page setup): its size and which way it's turned, and its margins; what
// else the section says as written. p: as pageOf reads it (twips).
const SECT_BEFORE = /<w:(headerReference|footerReference|footnotePr|endnotePr|type)\b[^>]*?(\/>|>[\s\S]*?<\/w:\1>)/g
function withPage(x, p, scope) {
  if (/^<w:sectPr\b[^>]*\/>$/.test(x)) x = x.replace(/\s*\/>$/, '></w:sectPr>')
  const put = (tag, attrs, after) => {
    const re = new RegExp(`<w:${tag}\\b[^>]*?(/>|>[\\s\\S]*?</w:${tag}>)`)
    const had = re.exec(x)
    const el = withAttrs(had ? had[0] : '', tag, attrs, scope)
    if (had) { x = x.replace(had[0], el); return }
    const at = after()
    x = x.slice(0, at) + el + x.slice(at)
  }
  const afterStart = () => x.indexOf('>') + 1
  const afterRefs = () => { let end = afterStart(); for (const m of x.matchAll(SECT_BEFORE)) end = Math.max(end, m.index + m[0].length); return end }
  put('pgSz', { 'w:w': p.w, 'w:h': p.h, 'w:orient': p.orient === 'landscape' ? 'landscape' : null }, afterRefs)
  put('pgMar', { 'w:top': p.top, 'w:right': p.right, 'w:bottom': p.bottom, 'w:left': p.left, 'w:header': p.header ?? 720, 'w:footer': p.footer ?? 720, 'w:gutter': p.gutter ?? 0 }, () => { const m = /<w:pgSz\b[^>]*?\/>/.exec(x); return m ? m.index + m[0].length : afterRefs() })
  return x
}

// The Word file again: the body (and any header or footer changed) written, every other part as it
// was. hf: { [part path]: json } the headers and footers edited; make: { header, footer } JSON of
// ones made new; page: the page's size and margins, set in Page setup. Bytes back.
export async function writeDocx(m, json, { hf = {}, make = {}, page = null } = {}) {
  const w = new Writer(m)
  const zip = m.zip
  const write = (part, body, sect = null) => {
    let tail = part.tail
    if (sect != null && part.sect) tail = tail.slice(0, part.sect.at) + sect + tail.slice(part.sect.at + part.sect.raw.length)
    return part.head + body + tail
  }
  m.added.parts = m.added.parts || {}
  // A part is written only when it isn't what the file has now (as read, or as saved last).
  m.written = m.written || {}
  const put = (path, x, was) => { if (x !== (m.written[path] ?? was)) { zip.file(path, x); m.written[path] = x } }
  // A header or footer made new: a part of its own, related to the document, named first in the
  // section's properties (where Word wants it).
  let sect = m.main.sect?.raw ?? null
  for (const which of ['header', 'footer']) {
    if (!make[which]) continue
    let path = m.added.made?.[which]
    for (let n = 1; !path; n++) if (!zip.file(resolve(m.docPath, `${which}${n}.xml`))) path = resolve(m.docPath, `${which}${n}.xml`)
    m.added.made = { ...(m.added.made || {}), [which]: path }
    const tag = which === 'header' ? 'hdr' : 'ftr'
    const part = { path, head: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${HF_NS}>`, tail: `</w:${tag}>`, raws: new Map(), fp: new Map(), xml: '' }
    put(path, part.head + w.blocks(make[which].content || [], part) + part.tail)
    const rid = w.relsAdd(m.docPath, which, relTarget(m.docPath, path))
    m.added.parts[path] = which
    const ref = `<w:${which}Reference w:type="default" r:id="${rid}"/>`
    if (!sect) sect = `<w:sectPr>${ref}</w:sectPr>`
    else if (/\/>$/.test(sect) && !/<\/w:sectPr>$/.test(sect)) sect = sect.replace(/\s*\/>$/, `>${ref}</w:sectPr>`)
    else sect = sect.replace(/^(<w:sectPr\b[^>]*>)/, `$1${ref}`)
  }
  if (page) sect = withPage(sect || '<w:sectPr></w:sectPr>', page, w.scope)
  const body = w.blocks(json.content || [], m.main)
  let doc = write(m.main, body, m.main.sect && sect !== m.main.sect.raw ? sect : null)
  if (sect && !m.main.sect) doc = doc.replace(/(<\/w:body>)/, `${sect}$1`)
  // A prefix the new XML uses (w:, r:, wp:) that the document declares under another name, or not at all.
  if (doc !== m.main.xml) doc = doc.replace(/^([\s\S]*?<[\w.-]*:?document\b)([^>]*)>/, (all, a, b) => `${a}${b}${['w', 'r', 'wp'].filter((p) => !new RegExp(`\\sxmlns:${p}=`).test(b)).map((p) => ` xmlns:${p}="${NS[p]}"`).join('')}>`)
  put(m.docPath, doc, m.main.xml)
  for (const [path, j] of Object.entries(hf)) {
    const h = [...Object.values(m.hf.header), ...Object.values(m.hf.footer)].find((x) => x.path === path)
    if (h) put(path, write(h.part, w.blocks(j.content || [], h.part)), h.part.xml)
  }
  // Lists the document now uses, when it had no numbering part.
  if (m.added.abs.length && !(m.numberingPath && zip.file(m.numberingPath))) {
    m.numberingPath = resolve(m.docPath, 'numbering.xml')
    w.relsAdd(m.docPath, 'numbering', relTarget(m.docPath, m.numberingPath))
    m.added.parts[m.numberingPath] = 'numbering'
  }
  // Pictures added, the relationships to them (and to links and parts), styles the document now uses.
  // Each written only when it's new or changed, so saving a file again as it is gives the same bytes.
  for (const md of m.added.media.values()) if (!zip.file(md.path)) zip.file(md.path, md.data, { base64: true })
  const byPart = new Map()
  for (const r of m.added.rels.values()) { if (!byPart.has(r.from)) byPart.set(r.from, []); byPart.get(r.from).push(r) }
  for (const [from, list] of byPart) {
    const was = m.relsXml[from] || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    const add = list.filter((r) => !was.includes(`Id="${r.id}"`)).map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')
    put(relsPath(from), was.replace(/<\/Relationships>\s*$/, `${add}</Relationships>`), was)
  }
  if (m.added.styles.size && m.stylesPath) {
    const s = await zip.file(m.stylesPath)?.async('string')
    if (s) {
      const missing = [...m.added.styles].filter(([id]) => !s.includes(`w:styleId="${id}"`)).map(([, x]) => x).join('')
      if (missing) zip.file(m.stylesPath, s.replace(/<\/w:styles>\s*$/, `${missing}</w:styles>`))
    }
  }
  if (m.added.abs.length) await addNumbering(m, zip)
  await contentTypes(m, zip)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
async function addNumbering(m, zip) {
  let x = await zip.file(m.numberingPath)?.async('string')
  if (!x) x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${NS.w}"></w:numbering>`
  const absNew = m.added.abs.filter((a) => !x.includes(/w:abstractNumId="\d+"/.exec(a)[0]))
  const numNew = m.added.nums.filter((n) => !x.includes(/w:numId="\d+"/.exec(n)[0]))
  if (!absNew.length && !numNew.length) return
  // Every abstractNum before the first num, as Word wants them.
  const firstNum = x.search(/<w:num\b/)
  x = firstNum >= 0 ? x.slice(0, firstNum) + absNew.join('') + x.slice(firstNum) : x.replace(/<\/w:numbering>\s*$/, `${absNew.join('')}</w:numbering>`)
  zip.file(m.numberingPath, x.replace(/<\/w:numbering>\s*$/, `${numNew.join('')}</w:numbering>`))
}
const CT = {
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
}
async function contentTypes(m, zip) {
  const was = await zip.file('[Content_Types].xml')?.async('string')
  if (!was) return
  let x = was
  for (const md of m.added.media.values()) if (!new RegExp(`Extension="${md.ext}"`, 'i').test(x)) x = x.replace(/<\/Types>\s*$/, `<Default Extension="${md.ext}" ContentType="${md.mime}"/></Types>`)
  for (const [path, kind] of Object.entries(m.added.parts || {})) if (!x.includes(`PartName="/${path}"`)) x = x.replace(/<\/Types>\s*$/, `<Override PartName="/${path}" ContentType="${CT[kind]}"/></Types>`)
  if (x !== was) zip.file('[Content_Types].xml', x)
}
