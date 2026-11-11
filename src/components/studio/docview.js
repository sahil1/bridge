import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import { builtinStyle, listKindOf, listNum } from './ooxml.js'
import { tw, lineCss, fontStack, hlCss } from './wordschema.js'

// How a Word file looks in Studio's page view: its styles as CSS, its lists' numbers and bullets,
// and its pages (size, margins, headers and footers, and where each page ends).

// ---------- What the file says about itself ----------
// The file as the editor needs it: its styles (and Word's own, for a document without them), which
// are headings, which have a list.
export function docInfo(m) {
  const styles = m.styles
  const offer = new Map()
  for (const id of ['Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Quote', 'NoSpacing']) if (!styles.byId.has(id)) { const s = builtinStyle(id, m.theme); if (s) offer.set(id, s) }
  const get = (id) => styles.byId.get(id) || offer.get(id) || null
  const levelOf = (id) => {
    const s = get(id)
    if (!s) return null
    if (s.look?.para?.ol != null && s.look.para.ol < 9) return s.look.para.ol
    const n = /^heading (\d)$/i.exec(s.name || '')
    return n ? Number(n[1]) - 1 : null
  }
  // A list pasted in: each of its own (a numbered one counted from 1), by the id the paste gave it.
  const pasted = new Map()
  return {
    styles, offer, get, levelOf,
    headingStyle: (n) => [...styles.list, ...offer.values()].find((s) => s.type === 'paragraph' && levelOf(s.id) === n - 1)?.id || null,
    styleNum: (id) => get(id)?.look?.para?.numId ?? null,
    // What kind of list a paragraph is in (bullet, number, check, checked), and one of a kind to use.
    listKind: (num, lvl) => (num ? listKindOf(m, num, lvl) : null),
    hasNum: (num) => m.numbering.nums.has(num),
    listNum: (kind, o) => listNum(m, kind, o),
    pastedNum: (kind, id) => {
      const key = `${id}:${kind}`
      if (!pasted.has(key)) pasted.set(key, listNum(m, kind, { fresh: true }))
      return pasted.get(key)
    },
    comments: m.comments, footnotes: m.footnotes, endnotes: m.endnotes,
  }
}

// ---------- Styles as CSS ----------
const ALIGN = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }
const q = (s) => JSON.stringify(String(s))
function runCss(r) {
  const o = []
  if (r.font) o.push(`font-family:${fontStack(r.font)}`)
  if (r.size) o.push(`font-size:${r.size / 2}pt`)
  if (r.color && r.color !== 'auto') o.push(`color:#${r.color}`)
  if (r.bold != null) o.push(`font-weight:${r.bold ? 700 : 400}`)
  if (r.italic != null) o.push(`font-style:${r.italic ? 'italic' : 'normal'}`)
  const deco = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean)
  if (deco.length) o.push(`text-decoration:${deco.join(' ')}`)
  if (r.caps) o.push('text-transform:uppercase')
  if (r.smallCaps) o.push('font-variant:small-caps')
  if (r.highlight) o.push(`background-color:${hlCss(r.highlight)}`)
  return o
}
function paraCss(p) {
  const o = []
  if (p.jc && ALIGN[p.jc]) o.push(`text-align:${ALIGN[p.jc]}`)
  if (p.before != null) o.push(`padding-top:${tw(p.before)}px`)
  if (p.after != null) o.push(`padding-bottom:${tw(p.after)}px`)
  const lh = p.line != null ? lineCss(`${p.rule || 'auto'}:${p.line}`) : null
  if (lh) o.push(`line-height:${lh}`)
  if (p.left != null) o.push(`margin-left:${tw(p.left)}px`)
  if (p.right != null) o.push(`margin-right:${tw(p.right)}px`)
  if (p.first != null) o.push(`text-indent:${tw(p.first)}px`)
  if (p.border) o.push(`border-bottom:${Math.max(1, p.border.size / 8 * 1.33).toFixed(1)}px solid #${p.border.color === 'auto' ? '000000' : p.border.color}`, `margin-bottom:${p.border.space * 1.33}px`)
  if (p.shade) o.push(`background-color:#${p.shade}`)
  return o
}
// scope: the editor's own class, so a file's styles are only its own.
export function wordCss(m, info, scope) {
  const d = m.styles.defaults
  const out = []
  const base = [...runCss({ font: d.run.font || m.theme.fonts.minor || 'Calibri', size: d.run.size || 20, color: d.run.color }), `line-height:${lineCss(`${d.para.rule || 'auto'}:${d.para.line ?? 240}`) || 1.17}`]
  out.push(`${scope}{${base.join(';')}}`)
  out.push(`${scope} :is(p,h1,h2,h3,h4,h5,h6){margin:0;font:inherit;line-height:inherit;color:inherit;${d.para.after != null ? `padding-bottom:${tw(d.para.after)}px;` : ''}${d.para.before != null ? `padding-top:${tw(d.para.before)}px;` : ''}}`)
  const all = [...m.styles.list, ...info.offer.values()]
  for (const s of all) {
    if (s.type !== 'paragraph' && s.type !== 'character') continue
    const r = runCss(s.look.run)
    const p = s.type === 'paragraph' ? paraCss(s.look.para) : []
    if (!r.length && !p.length) continue
    out.push(`${scope} [${s.type === 'paragraph' ? 'data-s' : 'data-rs'}=${q(s.id)}]{${[...r, ...p].join(';')}}`)
    // Word's contextual spacing: no space between paragraphs of this style (a list's items).
    if (s.type === 'paragraph' && s.look.para.contextual) out.push(`${scope} [data-s=${q(s.id)}]:has(+ [data-s=${q(s.id)}]){padding-bottom:0}${scope} [data-s=${q(s.id)}] + [data-s=${q(s.id)}]{padding-top:0}`)
  }
  // A table style's paragraphs (Table Grid's: no space after), in its tables.
  for (const s of m.styles.list) {
    if (s.type !== 'table') continue
    const p = paraCss(s.look.para)
    if (p.length) out.push(`${scope} table[data-ts=${q(s.id)}] td > :is(p,h1,h2,h3,h4,h5,h6){${p.join(';')}}`)
  }
  return out.join('\n')
}

// ---------- Lists ----------
// Each list paragraph's number or bullet, counted as Word counts: per list, a level restarting
// when one above it comes again. Drawn before the paragraph, in its hanging indent.
const SYM = { '\uF0B7': '•', '\uF0A7': '▪', '\uF0D8': '➢', '\uF0FC': '✓', '\uF076': '❖', '\uF0A8': '□', '\uF06C': '●', '\uF06E': '■', '\uF0E0': '→', '\uF0D7': '◆', '\uF0FB': '✗' }
const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
const roman = (n) => { let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v } return s }
const letters = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) } return s }
function fmt(n, f) {
  switch (f) {
    case 'lowerLetter': return letters(n)
    case 'upperLetter': return letters(n).toUpperCase()
    case 'lowerRoman': return roman(n)
    case 'upperRoman': return roman(n).toUpperCase()
    case 'decimalZero': return String(n).padStart(2, '0')
    case 'none': return ''
    case 'bullet': return ''
    default: return String(n)
  }
}
export const listKey = new PluginKey('sd-lists')
export function listPlugin(m, info) {
  const build = (doc) => {
    const decos = []
    const count = new Map() // abstract list -> [counts by level]
    const begun = new Set() // nums seen, for their start overrides
    doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') return true
      const a = node.attrs
      const st = info.get(a.s || m.styles.normal)?.look?.para || {}
      const numId = a.num ?? st.numId ?? null
      if (!numId) return false
      const ilvl = a.lvl ?? st.ilvl ?? 0
      const n = m.numbering.nums.get(numId)
      const abs = n ? m.numbering.abs.get(n.abs) : null
      const lvl = abs?.levels?.[ilvl]
      if (!lvl) return false
      let c = count.get(n.abs)
      if (!c) { c = []; count.set(n.abs, c) }
      if (!begun.has(numId)) { begun.add(numId); for (const [l, s] of Object.entries(n.starts || {})) c[l] = s - 1 }
      c[ilvl] = (c[ilvl] ?? (lvl.start - 1)) + 1
      for (let k = ilvl + 1; k < 9; k++) c[k] = undefined
      let text = lvl.text
      if (lvl.fmt === 'bullet') text = /Courier/i.test(lvl.font || '') && text === 'o' ? '◦' : SYM[text] || text || '•'
      else text = text.replace(/%(\d)/g, (_, k) => { const i = Number(k) - 1; const L = abs.levels[i]; return fmt(c[i] ?? (L?.start ?? 1), L?.fmt || 'decimal') })
      const left = a.il ?? lvl.left ?? st.left ?? 0
      const hang = a.fi != null ? -a.fi : lvl.hanging ?? 360
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-mk': text, style: `margin-left:${tw(left)}px;text-indent:${-tw(hang)}px;--mk-w:${tw(Math.max(hang, 0))}px` }))
      return false
    })
    return DecorationSet.create(doc, decos)
  }
  return new Plugin({
    key: listKey,
    state: { init: (_, s) => build(s.doc), apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old) },
    props: { decorations: (s) => listKey.getState(s) },
  })
}

// ---------- Comments ----------
// What a comment is about, marked from its start to its end; the one picked, more strongly. With
// threads (doccomments.jsx): skip(id) for a reply's marks (its words are its thread's) and a
// resolved thread's; busy(id) for one AI Assist is answering; and the words picked for a comment
// being written (draft: { from, to }), marked while its box has the focus.
export const commentKey = new PluginKey('sd-comments')
export function commentPlugin({ skip = () => false, busy = () => false } = {}) {
  const build = (doc, on, draft) => {
    const starts = new Map()
    const decos = []
    doc.descendants((node, pos) => {
      if (node.type.name !== 'xin') return true
      const { k, id } = node.attrs
      if (k === 'cs') starts.set(id, pos)
      // A reply's mark (and a resolved thread's) isn't shown: its thread's is.
      else if (k === 'cr' && skip(String(id))) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'sd-cr-hid' }))
      else if (k === 'ce' && starts.has(id)) {
        if (!skip(String(id))) decos.push(Decoration.inline(starts.get(id) + 1, pos, { class: `sd-cmt${id === on ? ' on' : ''}${busy(String(id)) ? ' busy' : ''}`, 'data-cid': id }))
        starts.delete(id)
      }
      return false
    })
    if (draft && draft.to > draft.from && draft.to <= doc.content.size) decos.push(Decoration.inline(draft.from, draft.to, { class: 'sd-cmt on draft' }))
    return DecorationSet.create(doc, decos)
  }
  return new Plugin({
    key: commentKey,
    state: {
      init: (_, s) => ({ on: null, draft: null, set: build(s.doc, null, null) }),
      apply: (tr, old) => {
        const meta = tr.getMeta(commentKey)
        const on = meta && 'on' in meta ? meta.on : old.on
        const draft = meta && 'draft' in meta ? meta.draft : old.draft && tr.docChanged ? { from: tr.mapping.map(old.draft.from), to: tr.mapping.map(old.draft.to) } : old.draft
        return tr.docChanged || meta ? { on, draft, set: build(tr.doc, on, draft) } : old
      },
    },
    props: { decorations: (s) => commentKey.getState(s).set },
  })
}

// ---------- Pages ----------
// The page as CSS pixels: its size, margins, and how far its header and footer are from its edges.
export const pageOf = (p) => ({ w: tw(p.w), h: tw(p.h), top: tw(p.top), bottom: tw(p.bottom), left: tw(p.left), right: tw(p.right), header: tw(p.header), footer: tw(p.footer) })
export const GAP = 20 // between pages, as the desk shows them

// A header or footer, drawn for a page: its page number and the number of pages filled in.
export function hfRenderer(schema) {
  const ser = DOMSerializer.fromSchema(schema)
  const cache = new Map()
  return (json, page, total) => {
    if (!json) return null
    let frag = cache.get(json)
    if (!frag) { try { frag = ser.serializeFragment(Fragment.fromJSON(schema, json.content || [])) } catch { frag = document.createDocumentFragment() } cache.set(json, frag) }
    const el = document.createElement('div')
    el.append(frag.cloneNode(true))
    for (const f of el.querySelectorAll('.sd-x-fld')) {
      const k = f.getAttribute('data-f')
      if (k === 'PAGE') f.textContent = String(page)
      else if (k === 'NUMPAGES' || k === 'SECTIONPAGES') f.textContent = String(total)
    }
    for (const x of el.querySelectorAll('[contenteditable]')) x.removeAttribute('contenteditable')
    return el
  }
}

export const pageKey = new PluginKey('sd-pages')
// The page view: where each page ends, worked out from where the document's blocks (and a table's
// rows) fall, and drawn there as the bottom of one page (its footer), the desk between, and the top
// of the next (its header). A block is never split: one that doesn't fit starts the next page,
// with the heading before it when that heading keeps with it (Word's keep with next). opts: page()
// the page in pixels, or null for no pages (a narrow screen); chrome(page, total) the header and
// footer to draw; onPages({ total, current }) what the status line says.
export function pagePlugin(opts) {
  const make = (doc, breaks, g, total) => {
    if (!g) return DecorationSet.empty
    const decos = []
    const band = (fill, page, row, shift = 0) => (view) => {
      const inner = document.createElement('div')
      inner.className = 'sd-pb'
      inner.contentEditable = 'false'
      const h = fill + g.bottom + GAP + g.top
      inner.style.cssText = `height:${h}px;width:${g.w}px;margin-left:${-(g.left + shift)}px`
      const end = fill + g.bottom
      const c = opts.chrome(page, total)
      if (c.foot) { c.foot.className = 'sd-pb-foot'; c.foot.style.cssText = `left:${g.left}px;right:${g.right}px;bottom:${h - end + g.footer}px`; inner.append(c.foot) }
      const gap = document.createElement('div')
      gap.className = 'sd-pb-gap'
      gap.style.cssText = `top:${end}px;height:${GAP}px`
      gap.setAttribute('data-page', String(page + 1))
      inner.append(gap)
      const n = opts.chrome(page + 1, total)
      if (n.head) { n.head.className = 'sd-pb-head'; n.head.style.cssText = `left:${g.left}px;right:${g.right}px;top:${end + GAP + g.header}px`; inner.append(n.head) }
      inner.addEventListener('dblclick', (e) => { e.preventDefault(); opts.onChrome?.(e.target.closest('.sd-pb-foot') ? 'footer' : 'header') })
      if (!row) return inner
      const tr = document.createElement('tr')
      tr.className = 'sd-pb-row'
      const td = document.createElement('td')
      td.colSpan = 99
      td.append(inner)
      tr.append(td)
      void view
      return tr
    }
    // The first page's top margin and header, and the last page's bottom and footer.
    decos.push(Decoration.widget(0, () => {
      const el = document.createElement('div')
      el.className = 'sd-pb-top'
      el.contentEditable = 'false'
      el.style.cssText = `height:${g.top}px;width:${g.w}px;margin-left:${-g.left}px`
      const c = opts.chrome(1, total)
      if (c.head) { c.head.className = 'sd-pb-head'; c.head.style.cssText = `left:${g.left}px;right:${g.right}px;top:${g.header}px`; el.append(c.head) }
      el.addEventListener('dblclick', (e) => { e.preventDefault(); opts.onChrome?.('header') })
      return el
    }, { side: -1, key: `top:${total}:${g.top}:${opts.stamp?.() || ''}`, ignoreSelection: true }))
    breaks.forEach((b, i) => decos.push(Decoration.widget(b.pos, band(b.fill, i + 1, b.row, b.shift), { side: -1, key: `pb:${b.pos}:${b.fill}:${i}:${total}:${b.row ? 1 : 0}:${b.shift || 0}:${opts.stamp?.() || ''}`, ignoreSelection: true, marks: [] })))
    const endFill = breaks.endFill ?? 0
    decos.push(Decoration.widget(doc.content.size, () => {
      const el = document.createElement('div')
      el.className = 'sd-pb-end'
      el.contentEditable = 'false'
      const h = endFill + g.bottom
      el.style.cssText = `height:${h}px;width:${g.w}px;margin-left:${-g.left}px`
      const c = opts.chrome(total, total)
      if (c.foot) { c.foot.className = 'sd-pb-foot'; c.foot.style.cssText = `left:${g.left}px;right:${g.right}px;bottom:${g.footer}px`; el.append(c.foot) }
      el.addEventListener('dblclick', (e) => { e.preventDefault(); opts.onChrome?.('footer') })
      return el
    }, { side: 1, key: `end:${endFill}:${total}:${g.bottom}:${opts.stamp?.() || ''}`, ignoreSelection: true }))
    return DecorationSet.create(doc, decos)
  }
  // Each view its own: the frame it's waiting for, and what it last drew.
  const measure = (view, st) => {
    st.frame = 0
    const g = opts.page()
    const root = view.dom
    if (!g || !root.isConnected || !root.offsetHeight) {
      if (!g && pageKey.getState(view.state)?.g) view.dispatch(view.state.tr.setMeta(pageKey, { breaks: [], g: null, total: 1 }).setMeta('addToHistory', false))
      return
    }
    const r0 = root.getBoundingClientRect()
    const scale = r0.width / root.offsetWidth || 1
    const yOf = (el) => (el.getBoundingClientRect().top - r0.top) / scale
    // What the bands drawn now add above each place, to take back out.
    const bands = []
    for (const el of root.querySelectorAll(':scope > .sd-pb, :scope .sd-pb-row')) bands.push({ y: yOf(el), h: el.getBoundingClientRect().height / scale })
    const unshift = (y) => { let s = 0; for (const b of bands) if (b.y < y - 0.5) s += b.h; return y - s }
    const items = []
    view.state.doc.forEach((node, offset) => {
      const dom = view.nodeDOM(offset)
      if (!dom || dom.nodeType !== 1) return
      if (node.type.name === 'table') {
        const table = dom.querySelector?.('table') || dom
        const shift = (table.getBoundingClientRect().left - r0.left) / scale - g.left
        node.forEach((row, rOff) => {
          const tr = view.nodeDOM(offset + 1 + rOff)
          if (!tr || tr.nodeType !== 1) return
          const y = unshift(yOf(tr))
          items.push({ pos: offset + 1 + rOff, top: y, bottom: y + tr.getBoundingClientRect().height / scale, row: rOff > 0, shift: rOff > 0 ? shift : 0 })
        })
        return
      }
      const y = unshift(yOf(dom))
      const a = node.attrs || {}
      const hasBreak = node.type.name === 'paragraph' && (() => { let b = false; node.forEach((c) => { if (c.type.name === 'pbr') b = true }); return b })()
      const st = opts.styleOf?.(a.s)
      items.push({ pos: offset, top: y, bottom: y + dom.getBoundingClientRect().height / scale, before: !!a.pbb || !!st?.pbb, after: hasBreak || (a.sect && a.sect !== 'continuous'), keep: !!st?.keep })
    })
    const C = g.h - g.top - g.bottom
    const breaks = []
    let pageTop = g.top
    let forced = false
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const first = it.top <= pageTop + 0.5
      if (!first && (forced || it.before || it.bottom - pageTop > C)) {
        const prev = items[i - 1]
        // A heading that keeps with what follows it goes over with it.
        if (!forced && !it.before && prev?.keep && prev.top > pageTop + 0.5 && !prev.row) {
          breaks.push({ pos: prev.pos, fill: Math.max(0, Math.round(C - (prev.top - pageTop))), row: prev.row, shift: prev.shift })
          pageTop = prev.top
        } else {
          breaks.push({ pos: it.pos, fill: Math.max(0, Math.round(C - (it.top - pageTop))), row: it.row, shift: Math.round(it.shift || 0) })
          pageTop = it.top
        }
      }
      forced = it.after
    }
    const lastBottom = items.length ? items[items.length - 1].bottom : g.top
    breaks.endFill = Math.max(0, Math.round(C - (lastBottom - pageTop)))
    const total = breaks.length + 1
    const sig = JSON.stringify([breaks.map((b) => [b.pos, b.fill, b.row ? 1 : 0, b.shift || 0]), breaks.endFill, g, opts.stamp?.() || ''])
    if (sig === st.last) return
    st.last = sig
    view.dispatch(view.state.tr.setMeta(pageKey, { breaks, g, total }).setMeta('addToHistory', false))
  }
  return new Plugin({
    key: pageKey,
    state: {
      init: () => ({ set: DecorationSet.empty, breaks: [], g: null, total: 1 }),
      apply: (tr, old, _, state) => {
        const m = tr.getMeta(pageKey)
        if (m) return { ...m, set: make(state.doc, m.breaks, m.g, m.total) }
        if (!tr.docChanged) return old
        // Until it's measured again, the bands stay where they map to.
        return { ...old, set: old.set.map(tr.mapping, tr.doc), breaks: Object.assign(old.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos) })), { endFill: old.breaks.endFill }) }
      },
    },
    props: { decorations: (s) => pageKey.getState(s).set },
    view(view) {
      const st = { frame: 0, last: '' }
      // Measured once the browser has laid it out; a long document a moment after typing stops, so
      // typing in it stays quick.
      const schedule = (v) => {
        if (st.frame) return
        if (v.state.doc.childCount > 400) st.frame = setTimeout(() => requestAnimationFrame(() => measure(v, st)), 250)
        else st.frame = requestAnimationFrame(() => measure(v, st))
      }
      const again = () => { st.last = ''; schedule(view) }
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule(view)) : null
      ro?.observe(view.dom)
      const loaded = (e) => { if (e.target?.tagName === 'IMG') schedule(view) }
      view.dom.addEventListener('load', loaded, true)
      document.fonts?.ready?.then(() => schedule(view))
      opts.bind?.(again)
      schedule(view)
      return {
        update: (v, prev) => {
          if (v.state.doc !== prev.doc) schedule(v)
          const st = pageKey.getState(v.state)
          if (opts.onPages) {
            const at = v.state.selection.from
            const current = 1 + (st.breaks || []).filter((b) => b.pos <= at).length
            opts.onPages({ total: st.total || 1, current })
          }
        },
        destroy: () => { ro?.disconnect(); view.dom.removeEventListener('load', loaded, true); if (st.frame) { cancelAnimationFrame(st.frame); clearTimeout(st.frame) } st.frame = -1 },
      }
    },
  })
}
