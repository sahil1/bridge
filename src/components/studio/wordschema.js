import { Node, Mark, Extension, InputRule } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Underline from '@tiptap/extension-underline'
import Strike from '@tiptap/extension-strike'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader, TableView } from '@tiptap/extension-table'
import { UndoRedo, Dropcursor, Gapcursor } from '@tiptap/extensions'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import { t } from '../../i18n/index.js'
import { HIGHLIGHTS } from './ooxml.js'

// The editor's schema for a Word file (ooxml.js reads the file into it and writes it back). A
// paragraph is Word's: its style and the properties Studio edits (alignment, spacing, indents, its
// list) as attributes, beside its properties as written; a heading is a paragraph in a heading
// style. Run formatting is a mark each (font, size, colour, highlight…), with the run's properties
// as written in rpr. What Studio shows but doesn't edit (a field, a bookmark, a footnote's number,
// a chart, a table of contents) is an atom holding its XML.

export const tw = (v) => v / 15 // twips to CSS pixels at 96 dpi
const ALIGN = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify', justify: 'justify' }
// Word's single line spacing, for the fonts documents use: a little over the font's size.
export const SINGLE = 1.17
export function lineCss(ln) {
  if (!ln) return null
  const [rule, v] = ln.split(':')
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return rule === 'auto' ? (n / 240 * SINGLE).toFixed(3) : `${(n / 20).toFixed(1)}pt`
}

const attr = (def = null, keepOnSplit = true) => ({ default: def, rendered: false, keepOnSplit })
const PARA = { x: attr(null, false), pa: attr('', false), ppr: attr(''), s: attr(), al: attr(), ln: attr(), sb: attr(), sa: attr(), il: attr(), ir: attr(), fi: attr(), num: attr(), lvl: attr(), pbb: attr(false, false), sect: attr(null, false), mz: attr() }

// options.doc: the file as read (its styles, for which paragraphs are headings and its default).
export const WordParagraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  priority: 1000,
  addOptions() { return { doc: null } },
  addAttributes() { return PARA },
  parseHTML() {
    // A list paragraph: its own list when it's this document's (copied within it), else one of its
    // kind (data-list: from another document, or a list pasted in; paste.js), each pasted list its own.
    const listOf = (el) => {
      const d = this.options.doc
      const n = el.getAttribute('data-num') ? Number(el.getAttribute('data-num')) : null
      const kind = el.getAttribute('data-list')
      const lvl = Math.max(0, Math.min(8, Number(el.getAttribute('data-lvl')) || 0))
      if (n != null && (n === 0 || !d?.hasNum || d.hasNum(n))) return { num: n, lvl: n ? lvl : null }
      // In a style that's a list here (List Bullet), its style says so.
      const s = el.getAttribute('data-s')
      if (!kind || !d?.listNum || (s && d.get?.(s) && d.styleNum(s))) return { num: null, lvl: null }
      const id = el.getAttribute('data-lid')
      return { num: id && kind === 'number' ? d.pastedNum(kind, id) : d.listNum(kind), lvl }
    }
    const own = (el) => ({ s: el.getAttribute('data-s') || null, al: el.getAttribute('data-al') || null, ...listOf(el) })
    const heading = (n) => (el) => ({ ...own(el), s: el.getAttribute('data-s') || this.options.doc?.headingStyle?.(n) || null })
    return [{ tag: 'p', getAttrs: own }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}`, getAttrs: heading(n) }))]
  },
  renderHTML({ node }) {
    const a = node.attrs
    const d = this.options.doc
    const s = a.s || d?.styles?.normal || null
    const level = d?.levelOf?.(s)
    const tag = level != null && level < 6 ? `h${level + 1}` : 'p'
    // Its list's kind, for what's copied out of it (another app gets a list: paste.js).
    const numId = a.num === 0 ? null : a.num ?? d?.styleNum?.(s) ?? null
    const kind = numId ? d?.listKind?.(numId, a.lvl || 0) : null
    const css = []
    if (a.al && ALIGN[a.al]) css.push(`text-align:${ALIGN[a.al]}`)
    const lh = lineCss(a.ln)
    if (lh) css.push(`line-height:${lh}`)
    if (a.sb != null) css.push(`padding-top:${tw(a.sb)}px`)
    if (a.sa != null) css.push(`padding-bottom:${tw(a.sa)}px`)
    if (a.num == null) {
      if (a.il != null) css.push(`margin-left:${tw(a.il)}px`)
      if (a.fi != null) css.push(`text-indent:${tw(a.fi)}px`)
    }
    if (a.ir != null) css.push(`margin-right:${tw(a.ir)}px`)
    if (a.mz && !node.content.size) css.push(`font-size:${a.mz / 2}pt`)
    return [tag, { ...(s ? { 'data-s': s } : {}), ...(a.al ? { 'data-al': a.al } : {}), ...(a.num != null ? { 'data-num': a.num, 'data-lvl': a.lvl || 0 } : {}), ...(kind ? { 'data-list': kind, ...(a.num == null ? { 'data-lvl': a.lvl || 0 } : {}) } : {}), ...(css.length ? { style: css.join(';') } : {}) }, 0]
  },
})

// ---------- Marks ----------
const markAttrs = (o) => Object.fromEntries(Object.entries(o).map(([k, d]) => [k, { default: d, rendered: false }]))
// The run's properties as written: kept so what Studio doesn't show stays.
const Rpr = Mark.create({ name: 'rpr', priority: 200, addAttributes: () => markAttrs({ raw: '' }), parseHTML: () => [], renderHTML: () => ['span', 0] })
const Va = Mark.create({
  name: 'va', excludes: 'va', addAttributes: () => markAttrs({ v: 'superscript' }),
  parseHTML: () => [{ tag: 'sup', attrs: { v: 'superscript' } }, { tag: 'sub', attrs: { v: 'subscript' } }],
  renderHTML: ({ mark }) => [mark.attrs.v === 'subscript' ? 'sub' : 'sup', 0],
})
const cleanFont = (f) => String(f || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '')
const FontFamily = Mark.create({
  name: 'ff', excludes: 'ff', addAttributes: () => markAttrs({ f: null }),
  parseHTML: () => [{ style: 'font-family', getAttrs: (v) => (cleanFont(v) && !/^(inherit|initial|var\()/.test(v) ? { f: cleanFont(v) } : false) }],
  renderHTML: ({ mark }) => ['span', { style: `font-family:${fontStack(mark.attrs.f)}` }, 0],
})
const FontSize = Mark.create({
  name: 'fs', excludes: 'fs', addAttributes: () => markAttrs({ hp: 22 }),
  parseHTML: () => [{ style: 'font-size', getAttrs: (v) => { const m = /^([\d.]+)(pt|px)$/.exec(String(v).trim()); if (!m) return false; const pt = m[2] === 'pt' ? Number(m[1]) : Number(m[1]) * 0.75; return pt > 1 && pt < 400 ? { hp: Math.round(pt * 2) } : false } }],
  renderHTML: ({ mark }) => ['span', { style: `font-size:${mark.attrs.hp / 2}pt` }, 0],
})
const hexOf = (v) => {
  const s = String(v || '').trim()
  let m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return m[1].toUpperCase()
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (m) return `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase()
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(s)
  if (m && (m[4] == null || Number(m[4]) > 0.5)) return [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}
const FontColor = Mark.create({
  name: 'fc', excludes: 'fc', addAttributes: () => markAttrs({ c: '000000' }),
  parseHTML: () => [{ style: 'color', getAttrs: (v) => { const c = hexOf(v); return c ? { c } : false } }],
  renderHTML: ({ mark }) => ['span', { style: `color:#${mark.attrs.c}` }, 0],
})
export const hlCss = (c) => (c?.startsWith('#') ? c : HIGHLIGHTS[c] ? `#${HIGHLIGHTS[c]}` : null)
const Highlight = Mark.create({
  name: 'hl', excludes: 'hl', addAttributes: () => markAttrs({ c: 'yellow' }),
  parseHTML: () => [{ tag: 'mark', attrs: { c: 'yellow' } }, { style: 'background-color', getAttrs: (v) => { const c = hexOf(v); if (!c || c === 'FFFFFF') return false; const named = Object.entries(HIGHLIGHTS).find(([, h]) => h === c)?.[0]; return { c: named || `#${c}` } } }],
  renderHTML: ({ mark }) => ['mark', { style: `background-color:${hlCss(mark.attrs.c) || 'transparent'};color:inherit` }, 0],
})
const CharStyle = Mark.create({ name: 'rs', addAttributes: () => markAttrs({ id: null }), parseHTML: () => [{ tag: 'span[data-rs]', getAttrs: (el) => ({ id: el.getAttribute('data-rs') }) }], renderHTML: ({ mark }) => ['span', { 'data-rs': mark.attrs.id }, 0] })
const Caps = Mark.create({ name: 'caps', addAttributes: () => markAttrs({ small: false }), parseHTML: () => [], renderHTML: ({ mark }) => ['span', { style: mark.attrs.small ? 'font-variant:small-caps' : 'text-transform:uppercase' }, 0] })
// A tracked change (an insertion or deletion, by whom and when), shown as Word shows it.
const Rev = Mark.create({
  name: 'rev', inclusive: false, excludes: '', addAttributes: () => markAttrs({ k: 'ins', tag: '', by: null, at: null }),
  parseHTML: () => [],
  renderHTML: ({ mark }) => {
    const del = mark.attrs.k === 'del' || mark.attrs.k === 'moveFrom'
    const when = mark.attrs.at ? new Date(mark.attrs.at).toLocaleDateString() : ''
    return [del ? 'del' : 'ins', { class: 'sd-rev', title: [del ? t('Deleted') : t('Inserted'), mark.attrs.by, when].filter(Boolean).join(' · ') }, 0]
  },
})
// A link: its address, and how the file had it (its relationship, or a place in the document).
const WordLink = Link.extend({
  addAttributes() { return { ...this.parent?.(), rid: { default: null, rendered: false }, anchor: { default: null, rendered: false }, tag: { default: '', rendered: false } } },
})

// Fonts as CSS: the font, then ones like it, for a computer that doesn't have it.
const LIKE = {
  calibri: "Calibri, Carlito, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  aptos: "Aptos, Calibri, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  cambria: "Cambria, Caladea, Georgia, 'Times New Roman', serif",
  'times new roman': "'Times New Roman', Times, 'Liberation Serif', serif",
  arial: "Arial, Helvetica, 'Liberation Sans', sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  georgia: 'Georgia, serif',
  garamond: "Garamond, 'EB Garamond', Georgia, serif",
  'courier new': "'Courier New', Courier, monospace",
  consolas: "Consolas, Menlo, monospace",
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
}
export function fontStack(name) {
  const n = cleanFont(name)
  if (!n) return 'inherit'
  if (LIKE[n.toLowerCase()]) return LIKE[n.toLowerCase()]
  const serif = /serif|times|georgia|garamond|cambria|book|minion|palatino|baskerville/i.test(n) && !/sans/i.test(n)
  return `'${n.replace(/['"\\]/g, '')}', ${serif ? "Georgia, serif" : "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"}`
}

// ---------- Inline nodes ----------
// A tab: the tab character itself, set to Word's default stops (half an inch) by the page's CSS.
const Tab = Node.create({
  name: 'tab', group: 'inline', inline: true, atom: true, selectable: false,
  parseHTML: () => [{ tag: 'span.sd-tab' }],
  renderHTML: () => ['span', { class: 'sd-tab' }, '\t'],
  renderText: () => '\t',
  addKeyboardShortcuts() {
    return {
      // In a list, Tab moves it a level in; elsewhere, it's a tab.
      Tab: ({ editor }) => {
        const p = editor.state.selection.$from.parent
        if (editor.isActive('table') && !editor.state.selection.empty) return false
        if (p.type.name === 'paragraph' && p.attrs.num != null && p.attrs.num !== 0) return editor.commands.updateAttributes('paragraph', { lvl: Math.min(8, (p.attrs.lvl || 0) + 1) })
        if (editor.isActive('table') && editor.state.selection.$from.parentOffset === 0 && !p.content.size) return false
        return editor.commands.insertContent({ type: 'tab' })
      },
      'Shift-Tab': ({ editor }) => {
        const p = editor.state.selection.$from.parent
        if (p.type.name === 'paragraph' && p.attrs.num != null && p.attrs.num !== 0 && (p.attrs.lvl || 0) > 0) return editor.commands.updateAttributes('paragraph', { lvl: p.attrs.lvl - 1 })
        return false
      },
    }
  },
})
// A page break, where Word has one in a paragraph: the page view starts a new page after it.
const PageBreak = Node.create({
  name: 'pbr', group: 'inline', inline: true, atom: true,
  parseHTML: () => [{ tag: 'span.sd-pbr' }],
  renderHTML: () => ['span', { class: 'sd-pbr', 'data-label': t('Page break'), contenteditable: 'false' }],
  renderText: () => '\n',
})
// What Studio keeps as written and only shows: k says what it is, t what it shows.
const LABEL = { chart: () => t('Chart'), diagram: () => t('Diagram'), shape: () => t('Shape') }
const Opaque = Node.create({
  name: 'xin', group: 'inline', inline: true, atom: true, selectable: false,
  addOptions() { return { doc: null } },
  addAttributes: () => ({ raw: attr(''), k: attr('other'), t: attr(''), id: attr(), f: attr(), w: attr(), h: attr() }),
  parseHTML: () => [],
  renderText: ({ node }) => node.attrs.t || '',
  renderHTML({ node }) {
    const a = node.attrs
    const d = this.options.doc
    const base = { class: `sd-x sd-x-${a.k}`, contenteditable: 'false' }
    switch (a.k) {
      case 'fn': case 'en': { const n = (a.k === 'fn' ? d?.footnotes : d?.endnotes)?.get(String(a.id)); return ['sup', { ...base, title: n?.text || '' }, a.t] }
      case 'cr': { const c = d?.comments?.get(String(a.id)); return ['span', { ...base, 'data-id': a.id, title: c ? `${c.author || ''}: ${c.text}` : t('Comment') }] }
      case 'fld': return ['span', { ...base, 'data-f': a.f || '' }, a.t || '']
      case 'shape': {
        const w = a.w ? Math.min(a.w, 600) : 120, h = a.h ? Math.min(a.h, 400) : 60
        return ['span', { ...base, title: t('Kept as it is. Change it in Word.'), style: `width:${w}px;height:${h}px`, 'data-label': (LABEL[a.t] || LABEL.shape)() }]
      }
      case 'bm': case 'cs': case 'ce': case 'fc': return ['span', { ...base, ...(a.id != null ? { 'data-id': a.id } : {}) }]
      default: return ['span', base, a.t || '']
    }
  },
})
// A block Studio keeps as written and only shows (a table of contents, a content control): what's
// in it drawn as the editor would, but not edited here.
const BLOCK_LABEL = { contents: () => t('Table of contents'), cover: () => t('Cover page'), bibliography: () => t('Bibliography'), control: () => t('Content control'), other: () => t('Kept as it is') }
const OpaqueBlock = Node.create({
  name: 'xbl', group: 'block', atom: true, selectable: true, draggable: false,
  addAttributes: () => ({ x: attr(null, false), raw: attr(''), k: attr('other'), inner: attr() }),
  parseHTML: () => [],
  renderHTML: ({ node }) => ['div', { class: `sd-xbl sd-xbl-${node.attrs.k}`, contenteditable: 'false' }],
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('div')
      dom.className = `sd-xbl sd-xbl-${node.attrs.k}`
      dom.contentEditable = 'false'
      if (node.attrs.k === 'mark') return { dom }
      const label = document.createElement('span')
      label.className = 'sd-xbl-label'
      label.textContent = (BLOCK_LABEL[node.attrs.k] || BLOCK_LABEL.other)()
      label.title = t('Kept as it is. Change it in Word.')
      dom.append(label)
      if (node.attrs.inner?.length) {
        try { dom.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.fromJSON(editor.schema, node.attrs.inner))) } catch { /* drawn without what's in it */ }
      }
      return { dom, ignoreMutation: () => true, stopEvent: () => false }
    }
  },
})

// A picture: resized by its corner, kept as written but for its new size.
const WordImage = Image.extend({
  addAttributes() { return { ...this.parent?.(), rid: attr(null, false), raw: attr('', false), w0: attr(null, false), h0: attr(null, false), float: attr(false, false) } },
}).configure({ inline: true, allowBase64: true, resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 24, minHeight: 16 } })

// ---------- Tables ----------
// Its borders (its own, or its style's), its style and alignment, on the table the editor draws.
class WordTableView extends TableView {
  constructor(node, ...rest) { super(node, ...rest); this.look(node) }
  update(node) { const ok = super.update(node); if (ok) this.look(node); return ok }
  look(node) {
    const a = node.attrs
    this.table.className = `sd-tb${a.bd ? ' bd' : ''}`
    if (a.ts) this.table.setAttribute('data-ts', a.ts); else this.table.removeAttribute('data-ts')
    if (a.al === 'center') this.table.setAttribute('data-al', 'center'); else this.table.removeAttribute('data-al')
  }
}
const WordTable = Table.extend({
  addAttributes() { return { ...this.parent?.(), x: attr(null, false), ta: attr(''), tpr: attr(''), grid: attr(''), bd: attr(true), al: attr(), ts: attr() } },
  renderHTML({ node, HTMLAttributes }) {
    const out = this.parent?.({ node, HTMLAttributes })
    const a = node.attrs
    if (Array.isArray(out)) out[1] = { ...out[1], class: `sd-tb${a.bd ? ' bd' : ''}`, ...(a.ts ? { 'data-ts': a.ts } : {}), ...(a.al === 'center' ? { 'data-al': 'center' } : {}) }
    return out
  },
}).configure({ resizable: true, cellMinWidth: 24, lastColumnResizable: false, allowTableNodeSelection: true, View: WordTableView })
const WordRow = TableRow.extend({ addAttributes() { return { ...this.parent?.(), x: attr(null, false), ra: attr('', false), trpr: attr(''), head: attr(false) } } })
const WordCell = TableCell.extend({
  content: 'block+',
  addAttributes() {
    return {
      ...this.parent?.(), x: attr(null, false), ca: attr('', false), tcpr: attr(''),
      bg: { default: null, keepOnSplit: false, parseHTML: (el) => hexOf(el.style.backgroundColor), renderHTML: (a) => (a.bg ? { style: `background-color:#${a.bg}` } : {}) },
      va: { default: null, parseHTML: () => null, renderHTML: (a) => (a.va ? { style: `vertical-align:${a.va === 'center' ? 'middle' : a.va}` } : {}) },
    }
  },
})

// Enter after a heading starts a paragraph in the style the heading names next (Normal), as Word
// does; Enter or Backspace in an empty list item takes it out of the list, and Enter after a ticked
// item starts one that isn't. Typed at the start of a paragraph, as Google Docs and Word take them:
// "- " or "* " starts a bulleted list, "1. " a numbered one (going on from one just above), "[] " a
// checklist; Backspace straight after puts back what was typed.
const listed = (p) => p.attrs.num != null && p.attrs.num !== 0
const WordKeys = Extension.create({
  name: 'wordKeys',
  addOptions() { return { doc: null } },
  addInputRules() {
    const d = this.options.doc
    const rule = (find, kind) => new InputRule({
      find,
      handler: ({ state, range }) => {
        const $from = state.doc.resolve(range.from)
        const p = $from.parent
        if (p.type.name !== 'paragraph' || listed(p) || !d?.listNum) return null
        const i = $from.index($from.depth - 1)
        const above = i > 0 ? $from.node($from.depth - 1).child(i - 1) : null
        const was = above?.type.name === 'paragraph' && listed(above) ? d.listKind(above.attrs.num, above.attrs.lvl) : null
        const same = was === kind || (kind === 'check' && was === 'checked')
        const num = same && was === kind ? above.attrs.num : d.listNum(kind, { fresh: true })
        state.tr.delete(range.from, range.to).setNodeMarkup($from.before(), null, { ...p.attrs, num, lvl: same ? above.attrs.lvl || 0 : 0 })
        return undefined
      },
    })
    return [rule(/^\s*[-*•]\s$/, 'bullet'), rule(/^\d{1,3}[.)]\s$/, 'number'), rule(/^\[ ?\]\s$/, 'check')]
  },
  addKeyboardShortcuts() {
    const plain = { s: null, ppr: '', al: null, ln: null, sb: null, sa: null, il: null, ir: null, fi: null, num: null, lvl: null }
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        const p = $from.parent
        if (p.type.name !== 'paragraph' || !empty) return false
        if (listed(p) && !p.content.size) return editor.commands.updateAttributes('paragraph', { num: this.options.doc?.styleNum?.(p.attrs.s) ? 0 : null, lvl: null })
        if (listed(p) && this.options.doc?.listKind?.(p.attrs.num, p.attrs.lvl) === 'checked') return editor.chain().splitBlock().updateAttributes('paragraph', { num: this.options.doc.listNum('check') }).run()
        if ($from.parentOffset !== p.content.size) return false
        const d = this.options.doc
        const s = p.attrs.s || d?.styles?.normal
        const next = d?.styles?.byId?.get(s)?.next
        if (!next || next === s) return false
        return editor.chain().splitBlock().updateAttributes('paragraph', { ...plain, s: next === d.styles.normal ? null : next }).run()
      },
      Backspace: ({ editor }) => {
        if (editor.commands.undoInputRule()) return true
        const { $from, empty } = editor.state.selection
        const p = $from.parent
        if (!empty || $from.parentOffset !== 0 || p.type.name !== 'paragraph' || !listed(p)) return false
        return editor.commands.updateAttributes('paragraph', { num: this.options.doc?.styleNum?.(p.attrs.s) ? 0 : null, lvl: null })
      },
    }
  },
})

export function wordExtensions(doc) {
  return [
    Document, WordParagraph.configure({ doc }), Text, HardBreak, Tab, PageBreak, Opaque.configure({ doc }), OpaqueBlock, WordImage,
    WordTable, WordRow, WordCell, TableHeader,
    Bold, Italic, Underline, Strike, Va, FontFamily, FontSize, FontColor, Highlight, CharStyle, Caps, Rpr, Rev,
    WordLink.configure({ openOnClick: false, enableClickSelection: true, defaultProtocol: 'https', autolink: true }),
    UndoRedo, Dropcursor.configure({ color: 'var(--accent)', width: 2 }), Gapcursor, WordKeys.configure({ doc }),
  ]
}
