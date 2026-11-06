import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import Icon from '../../Icon.jsx'
import { t, locale } from '../../../i18n/index.js'
import { textOf } from '../files.js'
import { readDocx, writeDocx, fingerprint, listNum } from '../ooxml.js'
import { wordExtensions, fontStack } from '../wordschema.js'
import { docInfo, wordCss, listPlugin, commentPlugin, pagePlugin, pageOf, hfRenderer, commentKey } from '../docview.js'
import { findPlugin } from '../search.js'
import { keys } from '../keys.js'
import { Tool, Drop, Item, Glyph, Swatches, Markers, markerCss, FindBar, Outline, useHeadings, WordCount, AskInPlace, countWords, fontHere, COMMON_FONTS, SIZES } from '../doctools.jsx'
import '../doc.css'

// A document. A Word file is edited as Word has it (ooxml.js): its pages at their size and margins,
// its styles, fonts, lists, tables, pictures, headers and footers, and saved back with everything
// it doesn't change exactly as it was. Markdown is edited as Markdown (saved as written), and plain
// text as it is. handle: save() gives the bytes to write, selection() what's picked (for Ask an
// agent) and the heading it's under. onStats: pages and words, for the page's status line.
//
// Each toolbar offers only what its format keeps: a Word file has fonts, colours and alignment;
// Markdown has none of those, but has code.

export default function DocEditor({ file, data, onDirty, onStats, handle, readOnly = false }) {
  const md = file.ext === '.md' || file.ext === '.markdown'
  const plain = file.ext === '.txt'
  const [start, setStart] = useState(null) // { text } or { model } or { error }
  useEffect(() => {
    let on = true
    const urls = []
    if (md || plain) setStart({ text: textOf(data) })
    else {
      readDocx(data, { urlOf: (bytes, mime) => { const u = URL.createObjectURL(new Blob([bytes], { type: mime })); urls.push(u); return u } })
        .then((model) => on && setStart({ model }), (e) => on && setStart({ error: e.message }))
    }
    return () => { on = false; for (const u of urls) URL.revokeObjectURL(u) }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!start) return <div className="sd-empty sd-loading" role="status"><Icon name="refresh" size={16} className="spin" /><span className="muted">{t('Opening…')}</span></div>
  if (start.error) return <div className="sd-empty" role="alert"><Icon name="alert" size={18} /><b>{t("Couldn't read this Word file: {error}", { error: start.error })}</b><span className="muted small">{t('The file is as it was. Download it to open it in Word, or put back an earlier version.')}</span></div>
  if (plain) return <PlainText text={start.text} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} />
  if (md) return <MarkdownDoc file={file} text={start.text} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} />
  return <WordDoc file={file} model={start.model} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} />
}

// Words for the status line, and its tooltip: characters.
const fmtN = (x) => x.toLocaleString(locale())
const wordsText = (n) => (n === 1 ? t('1 word') : t('{n} words', { n: fmtN(n) }))

function PlainText({ text, onDirty, onStats, handle, readOnly }) {
  const [v, setV] = useState(text)
  useEffect(() => {
    if (!onStats) return undefined
    const id = setTimeout(() => onStats({ text: wordsText(countWords(v)), title: t('{n} characters', { n: fmtN(v.replace(/\s/g, '').length) }) }), 250)
    return () => clearTimeout(id)
  }, [v, onStats])
  handle.current = {
    save: async () => v,
    selection: () => { const el = document.activeElement; return el?.tagName === 'TEXTAREA' && el.selectionEnd > el.selectionStart ? { text: v.slice(el.selectionStart, el.selectionEnd) } : null },
  }
  return <div className="sd-plain-desk"><textarea className="sd-plain" value={v} readOnly={readOnly} onChange={(e) => { setV(e.target.value); onDirty(true) }} spellCheck aria-label={t('The text')} placeholder={t('Write here…')} /></div>
}

// A link's address as typed: a web address without its https://, or an email address, made whole.
const hrefOf = (s) => {
  const v = s.trim()
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('#') || v.startsWith('/')) return v
  return /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v) ? `mailto:${v}` : `https://${v}`
}

// ---------- Shared by both editors ----------
// Changed once you change it (a key, a paste, a drop, a press on the page or a button), not when
// the editor sets itself up with the file, which it reports as changes too.
function useTouched() {
  const touched = useRef(false)
  const touch = () => { touched.current = true; return false }
  return { touched, handlers: { keydown: touch, paste: touch, drop: touch, cut: touch, mousedown: touch } }
}
// Pages (a Word file) and words, a moment after typing stops; tapped, the word count.
function useStatus(editor, onStats, pages, openCount) {
  useEffect(() => {
    if (!editor || !onStats) return undefined
    let id = null
    const tell = () => {
      clearTimeout(id)
      id = setTimeout(() => {
        if (editor.isDestroyed) return
        const doc = editor.state.doc
        const words = countWords(doc.textBetween(0, doc.content.size, ' ', ' '))
        const { from, to, empty } = editor.state.selection
        const picked = empty ? null : countWords(doc.textBetween(from, to, ' ', ' '))
        const w = picked ? t('{n} of {total} words', { n: fmtN(picked), total: fmtN(words) }) : wordsText(words)
        const p = pages?.total ? t('Page {n} of {total}', { n: pages.current, total: pages.total }) : null
        onStats({ text: p ? `${p} · ${w}` : w, title: `${t('{n} characters', { n: fmtN(doc.textBetween(0, doc.content.size, '', '').replace(/\s/g, '').length) })} · ${t('Word count')} (${keys('mod', 'shift', 'c')})`, open: openCount })
      }, 200)
    }
    tell()
    editor.on('update', tell)
    editor.on('selectionUpdate', tell)
    return () => { clearTimeout(id); editor.off('update', tell); editor.off('selectionUpdate', tell) }
  }, [editor, onStats, pages?.total, pages?.current, openCount]) // eslint-disable-line react-hooks/exhaustive-deps
}
// What's picked and the text around it, for Ask AI; and the change put in, a paragraph for each
// paragraph of it, in the look of where it goes.
function pickedOf(editor) {
  const { from, to, empty } = editor.state.selection
  if (empty) return null
  const doc = editor.state.doc
  return { from, to, text: doc.textBetween(from, to, '\n\n', ' ').trim(), before: doc.textBetween(Math.max(0, from - 1500), from, '\n\n', ' '), after: doc.textBetween(to, Math.min(doc.content.size, to + 1000), '\n\n', ' ') }
}
function putIn(editor, range, text, below, paraAttrs) {
  const doc = editor.state.doc
  const $from = doc.resolve(range.from)
  const marks = $from.marksAcross(doc.resolve(range.to)) || $from.marks()
  const keep = marks.filter((m) => !['link', 'rev'].includes(m.type.name)).map((m) => m.toJSON())
  const parts = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  const p = $from.parent
  const attrs = p.type.name === 'paragraph' ? paraAttrs(p.attrs) : undefined
  const para = (s) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: s ? [{ type: 'text', text: s, ...(keep.length ? { marks: keep } : {}) }] : [] })
  const chain = editor.chain().focus()
  if (below) {
    const end = doc.resolve(range.to).end($from.depth > 0 ? Math.min($from.depth, doc.resolve(range.to).depth) : 0)
    chain.insertContentAt(end + 1, parts.map(para))
  } else if (parts.length <= 1 && $from.sameParent(doc.resolve(range.to))) {
    chain.insertContentAt({ from: range.from, to: range.to }, { type: 'text', text: parts[0] || '', ...(keep.length ? { marks: keep } : {}) })
  } else {
    chain.insertContentAt({ from: range.from, to: range.to }, parts.map(para))
  }
  chain.run()
}

// A document's frame: its toolbar and bars, then the outline, the desk with the page, and a side
// panel; Ask AI over the page.
function useFindKeys(setFinding, setCount) {
  return useCallback((e) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'f' && !e.shiftKey) { e.preventDefault(); setFinding('find') }
    else if (k === 'h' && e.shiftKey) { e.preventDefault(); setFinding('replace') }
    else if (k === 'c' && e.shiftKey) { e.preventDefault(); setCount(true) }
  }, [setFinding, setCount])
}
// An element's width, as it changes: [ref to put on it, its width].
function useWidth() {
  const [w, setW] = useState(0)
  const ro = useRef(null)
  const ref = useCallback((el) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    ro.current = new ResizeObserver(() => setW(el.clientWidth))
    ro.current.observe(el)
    setW(el.clientWidth)
  }, [])
  useEffect(() => () => ro.current?.disconnect(), [])
  return [ref, w]
}
// Panes beside the page open where there's room for them, and stay as you leave them.
function usePane(name, wide) {
  const key = `cc-studio-${name}`
  const [on, setOn] = useState(() => { try { const v = localStorage.getItem(key); return v == null ? wide : v === '1' } catch { return wide } })
  const set = (v) => { setOn(v); try { localStorage.setItem(key, v ? '1' : '0') } catch { /* this time only */ } }
  return [on, set]
}

// ---------- A Word file ----------
const TRANSPARENT = 'transparent'
let scopeN = 0
function WordDoc({ file, model, onDirty, onStats, handle, readOnly }) {
  const info = useMemo(() => docInfo(model), [model])
  const scope = useMemo(() => `sd-w${++scopeN}`, [])
  const css = useMemo(() => wordCss(model, info, `.${scope}`), [model, info, scope])
  const g = useMemo(() => pageOf(model.page), [model])
  const normal = model.styles.normal
  const { touched, handlers } = useTouched()
  const [pages, setPages] = useState({ total: 1, current: 1 })
  const desk = useRef(null)
  const [main, mainW] = useWidth()
  const flow = mainW > 0 && mainW < 560 // a phone: the text as one column, no pages
  const flowRef = useRef(flow)
  flowRef.current = flow
  // Headers and footers: as read, or as you changed them (made: ones the file didn't have).
  const [hf, setHf] = useState(() => ({ header: model.hf.header.default?.json || null, footer: model.hf.footer.default?.json || null, first: model.hf.titlePg ? { header: model.hf.header.first?.json || null, footer: model.hf.footer.first?.json || null } : null }))
  const hfRef = useRef(hf)
  hfRef.current = hf
  const stamp = useRef(0)
  const again = useRef(null)
  const [editingHf, setEditingHf] = useState(null)
  const renderHf = useRef(null)
  const pagesPlugin = useMemo(() => pagePlugin({
    page: () => (flowRef.current ? null : g),
    chrome: (page, total) => {
      const h = hfRef.current
      const use = page === 1 && h.first ? h.first : h
      const r = renderHf.current
      return { head: r?.(use.header, page, total) || null, foot: r?.(use.footer, page, total) || null }
    },
    onPages: (p) => setPages((was) => (was.total === p.total && was.current === p.current ? was : p)),
    styleOf: (s) => { const st = info.get(s || normal); return st ? { pbb: !!st.look.para.pbb, keep: !!st.look.para.keep } : null },
    stamp: () => stamp.current,
    bind: (fn) => { again.current = fn },
    onChrome: (which) => { if (!readOnly) setEditingHf(which) },
  }), [g, info, normal, readOnly])
  const plugins = useMemo(() => Extension.create({ name: 'wordView', addProseMirrorPlugins: () => [listPlugin(model, info), commentPlugin(), findPlugin(), pagesPlugin] }), [model, info, pagesPlugin])
  const editor = useEditor({
    extensions: [...wordExtensions(info), plugins],
    content: model.json,
    editable: !readOnly,
    editorProps: { handleDOMEvents: handlers, attributes: { 'aria-label': t('The document'), class: `sd-w ${scope}`, spellcheck: 'true' } },
    onUpdate: ({ transaction }) => { if (touched.current && transaction.docChanged) onDirty(true) },
    onCreate: ({ editor: e }) => { fingerprint(model.main, e.getJSON()); for (const h of [...Object.values(model.hf.header), ...Object.values(model.hf.footer)]) fingerprint(h.part, h.json) },
  }, [model])
  useEffect(() => { if (editor) renderHf.current = hfRenderer(editor.schema) }, [editor])
  useEffect(() => { editor?.setEditable(!readOnly) }, [editor, readOnly])
  useEffect(() => { again.current?.() }, [flow])

  const [finding, setFinding] = useState(null) // 'find' | 'replace'
  const [counting, setCount] = useState(false)
  const openCount = useCallback(() => setCount(true), [])
  useStatus(editor, onStats, flow ? null : pages, openCount)
  const onKeys = useFindKeys(setFinding, setCount)
  const levelOf = useCallback((n) => (n.type.name === 'paragraph' ? info.levelOf(n.attrs.s || normal) : null), [info, normal])
  const headings = useHeadings(editor, levelOf)
  const [outline, setOutline] = usePane('outline', true)
  const comments = useMemo(() => [...model.comments.entries()].filter(([, c]) => c.text), [model])
  const [showComments, setShowComments] = useState(false)
  // The page at its size where it fits beside the outline (and the comments), smaller where it
  // doesn't, and no pages on a phone; the outline only where there's room for both.
  const showOutline = outline && !flow && mainW >= g.w + 236 + 56 + (showComments ? 300 : 0)
  const deskW = mainW - (showOutline ? 236 : 0) - (showComments && mainW > 700 ? 300 : 0)
  const [zoom, setZoom] = useState('fit')
  const fit = deskW > 0 ? Math.min(1, Math.max(0.5, (deskW - 48) / g.w)) : 1
  const scale = flow ? 1 : zoom === 'fit' ? fit : zoom
  useEffect(() => { again.current?.() }, [scale])
  const [linking, setLinking] = useState(null)

  handle.current = {
    save: async () => {
      const edits = {}
      const make = {}
      for (const which of ['header', 'footer']) {
        const now = hf[which]
        const was = model.hf[which].default
        if (was) { if (now !== was.json) edits[was.path] = now || { type: 'doc', content: [{ type: 'paragraph' }] } } else if (now) make[which] = now
      }
      return writeDocx(model, editor.getJSON(), { hf: edits, make })
    },
    selection: () => {
      if (!editor) return null
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, '\n').trim()
      let heading = null
      editor.state.doc.nodesBetween(0, from, (n) => { if (levelOf(n) != null) heading = n.textContent; return n.type.name !== 'paragraph' })
      return text ? { text, where: heading ? t('under "{heading}"', { heading }) : null } : null
    },
  }

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const { $from } = e.state.selection
      const p = $from.parent.type.name === 'paragraph' ? $from.parent : null
      const a = p?.attrs || {}
      const sid = a.s || normal
      const st = info.get(sid)
      const run = { ...model.styles.defaults.run, ...(st?.look?.run || {}) }
      const para = { ...model.styles.defaults.para, ...(st?.look?.para || {}) }
      const numId = a.num ?? para.numId ?? null
      const lvl0 = numId ? model.numbering.abs.get(model.numbering.nums.get(numId)?.abs)?.levels?.[a.lvl ?? para.ilvl ?? 0] : null
      return {
        style: sid, font: e.getAttributes('ff').f || run.font || model.theme.fonts.minor || 'Calibri', size: (e.getAttributes('fs').hp || run.size || 22) / 2,
        color: e.getAttributes('fc').c || null, hl: e.getAttributes('hl').c || null,
        bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
        sup: e.isActive('va', { v: 'superscript' }), sub: e.isActive('va', { v: 'subscript' }),
        align: a.al || para.jc || 'left', line: a.ln || (para.line ? `${para.rule || 'auto'}:${para.line}` : 'auto:240'),
        sb: a.sb ?? para.before ?? 0, sa: a.sa ?? para.after ?? 0,
        list: lvl0 && numId ? (lvl0.fmt === 'bullet' ? 'bullet' : 'number') : null,
        link: e.isActive('link'), href: e.getAttributes('link').href || '', table: e.isActive('table'),
        undo: e.can().undo(), redo: e.can().redo(), empty: e.state.selection.empty,
      }
    },
  })
  const revs = useMemo(() => {
    if (!editor) return 0
    // A change each, however many runs of text it covers (each has its own id in the file).
    const seen = new Set()
    editor.state.doc.descendants((node) => { for (const m of node.marks || []) if (m.type.name === 'rev') seen.add(m.attrs.tag || m.attrs.at) })
    return seen.size
  }, [editor, editor?.state.doc]) // eslint-disable-line react-hooks/exhaustive-deps
  const fonts = useMemo(() => {
    const used = new Set([model.theme.fonts.major, model.theme.fonts.minor, model.styles.defaults.run.font, ...model.styles.list.map((x) => x.look?.run?.font)].filter(Boolean))
    editor?.state.doc.descendants((n) => { for (const m of n.marks || []) if (m.type.name === 'ff' && m.attrs.f) used.add(m.attrs.f) })
    return { used: [...used].sort(), common: COMMON_FONTS.filter((f) => !used.has(f)) }
  }, [model, editor, s?.font]) // eslint-disable-line react-hooks/exhaustive-deps

  const picker = useRef(null)
  const mark = useCallback((name, attrs) => { touched.current = true; const c = editor.chain().focus(); (attrs ? c.setMark(name, attrs) : c.unsetMark(name)).run() }, [editor, touched])
  const paras = useCallback((attrs) => { touched.current = true; editor.chain().focus().updateAttributes('paragraph', attrs).run() }, [editor, touched])
  if (!editor || !s) return null
  const c = () => { touched.current = true; return editor.chain().focus() }
  const styleName = (id) => { const st = info.get(id); return st ? displayName(st.name) : id }
  // The styles to offer: the file's own, those it uses, then Word's own it doesn't have yet.
  const quick = [...new Map([...model.styles.list.filter((x) => x.type === 'paragraph' && (x.quick || x.id === normal) && !x.hidden), ...info.offer.values()].map((x) => [x.id, x])).values()]
    .sort((a, b) => (a.id === normal ? -1 : b.id === normal ? 1 : (info.levelOf(a.id) ?? 50) - (info.levelOf(b.id) ?? 50) || a.prio - b.prio))
  if (!quick.some((x) => x.id === s.style) && info.get(s.style)) quick.push(info.get(s.style))
  const styleLook = (st) => {
    const r = { ...model.styles.defaults.run, ...(st.look?.run || {}) }
    return { fontFamily: fontStack(r.font || model.theme.fonts.minor || 'Calibri'), fontSize: `${Math.min(20, Math.max(12, (r.size || 22) / 2 * 1.1))}px`, fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? 'italic' : 'normal', color: r.color && r.color !== 'auto' && st.id !== normal ? `#${r.color}` : undefined }
  }
  const setStyle = (id) => paras({ s: id === normal ? null : id })
  const toggleList = (bullets) => {
    const want = bullets ? 'bullet' : 'number'
    if (s.list === want) paras({ num: info.styleNum(s.style) ? 0 : null, lvl: null })
    else paras({ num: listNum(model, bullets), lvl: 0 })
  }
  const indent = (dir) => {
    touched.current = true
    const { from, to } = editor.state.selection
    const tr = editor.state.tr
    editor.state.doc.nodesBetween(from, to, (n, pos) => {
      if (n.type.name !== 'paragraph') return true
      const a = n.attrs
      if (a.num != null && a.num !== 0) tr.setNodeMarkup(pos, null, { ...a, lvl: Math.max(0, Math.min(8, (a.lvl || 0) + dir)) })
      else tr.setNodeMarkup(pos, null, { ...a, il: Math.max(0, (a.il ?? info.get(a.s || normal)?.look?.para?.left ?? 0) + dir * 720) || null })
      return false
    })
    editor.view.dispatch(tr)
    editor.commands.focus()
  }
  const sizeTo = (pt) => { const v = Math.max(1, Math.min(400, Math.round(pt * 2) / 2)); mark('fs', { hp: v * 2 }) }
  const step = (dir) => sizeTo(dir > 0 ? SIZES.find((x) => x > s.size) ?? s.size + 12 : [...SIZES].reverse().find((x) => x < s.size) ?? Math.max(1, s.size - 1))
  const clear = () => { touched.current = true; const ch = editor.chain().focus(); for (const m of ['bold', 'italic', 'underline', 'strike', 'va', 'ff', 'fs', 'fc', 'hl', 'caps', 'rs', 'rpr']) ch.unsetMark(m); ch.run() }
  const insertImage = (f) => {
    if (!f || !/^image\/(png|jpe?g|gif)$/.test(f.type)) return
    const rd = new FileReader()
    rd.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const max = g.w - g.left - g.right
        const w = Math.min(img.naturalWidth, max), h = Math.round(img.naturalHeight * (w / img.naturalWidth))
        c().insertContent({ type: 'image', attrs: { src: rd.result, width: Math.round(w), height: h } }).run()
      }
      img.src = rd.result
    }
    rd.readAsDataURL(f)
  }
  const applyLink = (e) => {
    e.preventDefault()
    const href = hrefOf(linking || '')
    if (!href) c().extendMarkRange('link').unsetLink().run()
    else if (editor.state.selection.empty && !s.link) c().insertContent({ type: 'text', text: href.replace(/^mailto:/, ''), marks: [{ type: 'link', attrs: { href } }] }).run()
    else c().extendMarkRange('link').setLink({ href }).run()
    setLinking(null)
  }
  const resolveAll = (accept) => {
    touched.current = true
    const { state } = editor
    const type = state.schema.marks.rev
    const tr = state.tr
    const ranges = []
    state.doc.descendants((n, pos) => { if (!n.isInline) return true; const m = n.marks.find((x) => x.type === type); if (m) ranges.push({ from: pos, to: pos + n.nodeSize, ins: m.attrs.k === 'ins' || m.attrs.k === 'moveTo' }) })
    for (const r of ranges.reverse()) { if (r.ins === accept) tr.removeMark(r.from, r.to, type); else tr.delete(r.from, r.to) }
    editor.view.dispatch(tr)
  }
  const lines = [['auto:240', t('Single')], ['auto:276', '1.15'], ['auto:360', '1.5'], ['auto:480', t('Double')]]
  const ALIGN = [['left', t('Left'), 'align-left', 'l'], ['center', t('Center'), 'align-center', 'e'], ['right', t('Right'), 'align-right', 'r'], ['both', t('Justified'), 'align-justify', 'j']]
  const alignIcon = (ALIGN.find((x) => x[0] === s.align || (s.align === 'start' && x[0] === 'left') || (s.align === 'end' && x[0] === 'right')) || ALIGN[0])[2]
  const zooms = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2]

  const toolbar = !readOnly && (
    <div className="sd-toolbar sd-doc-tools" role="toolbar" aria-label={t('Formatting')}>
      <span className="sd-group">
        <Tool name={t('Undo')} icon="undo" run={() => c().undo().run()} keys={['mod', 'z']} disabled={!s.undo} />
        <Tool name={t('Redo')} icon="redo" run={() => c().redo().run()} keys={['mod', 'shift', 'z']} disabled={!s.redo} />
      </span>
      <span className="sd-group">
        <Drop name={t('Text style')} className="sd-style-drop" text={styleName(s.style)} tip={t('Text style: {paragraph} for normal text, {heading} for a heading', { paragraph: keys('mod', 'alt', '0'), heading: `${keys('mod', 'alt', '1')}–3` })} wide panel={(close) => quick.map((st) => (
          <Item key={st.id} label={displayName(st.name)} style={styleLook(st)} on={s.style === st.id} run={() => setStyle(st.id)} close={close} />
        ))} />
      </span>
      <span className="sd-group">
        <Drop name={t('Font')} className="sd-font-drop" text={s.font} tip={t('Font')} wide panel={(close) => (<>
          {fonts.used.length > 0 && <div className="sd-drop-head">{t('In this document')}</div>}
          {fonts.used.map((f) => <Item key={f} label={f} style={{ fontFamily: fontStack(f) }} hint={fontHere(f) ? null : t('not on this computer')} on={s.font === f} run={() => mark('ff', { f })} close={close} />)}
          <div className="sd-drop-head">{t('More fonts')}</div>
          {fonts.common.filter(fontHere).map((f) => <Item key={f} label={f} style={{ fontFamily: fontStack(f) }} on={s.font === f} run={() => mark('ff', { f })} close={close} />)}
        </>)} />
        <span className="sd-size">
          <Tool name={t('Smaller')} icon="minus" run={() => step(-1)} tip={t('Make the text smaller')} />
          <SizeBox value={s.size} onPick={sizeTo} />
          <Tool name={t('Bigger')} icon="plus" run={() => step(1)} tip={t('Make the text bigger')} />
        </span>
      </span>
      <span className="sd-group">
        <Tool name={t('Bold')} icon="bold" run={() => c().toggleBold().run()} on={s.bold} keys={['mod', 'b']} />
        <Tool name={t('Italic')} icon="italic" run={() => c().toggleItalic().run()} on={s.italic} keys={['mod', 'i']} />
        <Tool name={t('Underline')} icon="underline" run={() => c().toggleUnderline().run()} on={s.underline} keys={['mod', 'u']} />
        <Drop name={t('More text formatting')} icon="more" tip={t('Strikethrough, superscript, subscript, clear formatting')} panel={(close) => (<>
          <Item icon="strike" label={t('Strikethrough')} on={s.strike} keys={['mod', 'shift', 's']} run={() => c().toggleStrike().run()} close={close} />
          <Item icon="superscript" label={t('Superscript')} on={s.sup} keys={['mod', '.']} run={() => (s.sup ? mark('va') : mark('va', { v: 'superscript' }))} close={close} />
          <Item icon="subscript" label={t('Subscript')} on={s.sub} keys={['mod', ',']} run={() => (s.sub ? mark('va') : mark('va', { v: 'subscript' }))} close={close} />
          <div className="menu-sep" />
          <Item icon="eraser" label={t('Clear formatting')} keys={['mod', '\\']} run={clear} close={close} />
        </>)} />
        <Drop name={t('Text colour')} icon="text-color" swatch={s.color ? `#${s.color}` : 'currentColor'} panel={(close) => <Swatches value={s.color} auto={t('Automatic')} onPick={(v) => mark('fc', v ? { c: v } : null)} close={close} />} />
        <Drop name={t('Highlight')} className="sd-wide-only" icon="highlighter" swatch={markerCss(s.hl) || TRANSPARENT} panel={(close) => <Markers value={s.hl} onPick={(v) => mark('hl', v ? { c: v } : null)} close={close} />} />
      </span>
      <span className="sd-group">
        <Drop name={t('Alignment')} icon={alignIcon} panel={(close) => ALIGN.map(([v, label, icon, k]) => <Item key={v} label={label} icon={icon} on={alignIcon === icon} keys={['mod', 'shift', k]} run={() => paras({ al: v === 'left' && !info.get(s.style)?.look?.para?.jc ? null : v })} close={close} />)} />
        <Drop name={t('Line and paragraph spacing')} className="sd-wide-only" icon="line-spacing" panel={(close) => (<>
          {lines.map(([v, label]) => <Item key={v} label={label} on={s.line === v} run={() => paras({ ln: v })} close={close} />)}
          <div className="menu-sep" />
          <Item label={s.sb ? t('Remove space before paragraph') : t('Add space before paragraph')} run={() => paras({ sb: s.sb ? 0 : 240 })} close={close} />
          <Item label={s.sa ? t('Remove space after paragraph') : t('Add space after paragraph')} run={() => paras({ sa: s.sa ? 0 : 160 })} close={close} />
        </>)} />
        <Tool name={t('Bulleted list')} icon="list" run={() => toggleList(true)} on={s.list === 'bullet'} keys={['mod', 'shift', '8']} />
        <Tool name={t('Numbered list')} icon="list-ordered" run={() => toggleList(false)} on={s.list === 'number'} keys={['mod', 'shift', '7']} />
        <Tool name={t('Decrease indent')} className="sd-wide-only" icon="outdent" run={() => indent(-1)} keys={['mod', '[']} />
        <Tool name={t('Increase indent')} className="sd-wide-only" icon="indent" run={() => indent(1)} keys={['mod', ']']} />
      </span>
      <span className="sd-group">
        <Tool name={t('Insert link')} icon="link" run={() => setLinking(linking == null ? s.href || '' : null)} on={s.link || linking != null} tip={s.link ? t('Link: change it, open it or remove it') : t('Insert link')} keys={['mod', 'k']} />
        <Tool name={t('Insert picture')} icon="image" run={() => picker.current?.click()} tip={t('Insert a picture (PNG, JPEG or GIF)')} />
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={(e) => { insertImage(e.target.files?.[0]); e.target.value = '' }} />
        <TableTool editor={editor} c={c} on={s.table} />
        <Drop name={t('Insert')} className="sd-wide-only" icon="plus" tip={t('Insert a page break, header or footer')} panel={(close) => (<>
          <Item icon="page-break" label={t('Page break')} keys={['mod', 'enter']} run={() => c().insertContent([{ type: 'paragraph', content: [{ type: 'pbr' }] }]).run()} close={close} />
          <Item icon="header-footer" label={hf.header ? t('Edit the header') : t('Add a header')} run={() => setEditingHf('header')} close={close} />
          <Item icon="header-footer" label={hf.footer ? t('Edit the footer') : t('Add a footer')} run={() => setEditingHf('footer')} close={close} />
        </>)} />
      </span>
      <span className="sd-grow" />
      <span className="sd-group">
        {revs > 0 && <Drop name={t('Tracked changes')} className="sd-wide-only" icon="changes" text={String(revs)} tip={t('{n} tracked changes', { n: revs })} panel={(close) => (<>
          <div className="sd-drop-head">{t('{n} tracked changes', { n: revs })}</div>
          <Item icon="check" label={t('Accept all')} run={() => resolveAll(true)} close={close} />
          <Item icon="x" label={t('Reject all')} run={() => resolveAll(false)} close={close} />
        </>)} />}
        {comments.length > 0 && <Tool name={t('Comments')} icon="comment" on={showComments} run={() => setShowComments((x) => !x)} tip={t('{n} comments', { n: comments.length })}><span className="sd-tool-n">{comments.length}</span></Tool>}
        {!flow && <Tool name={t('Outline')} icon="outline" on={showOutline} run={() => setOutline(!showOutline)} tip={t('Outline: the headings, to go to')} />}
        <Tool name={t('Find and replace')} icon="search" on={!!finding} run={() => setFinding(finding ? null : 'find')} keys={['mod', 'f']} />
        {!flow && <Drop name={t('Zoom')} className="sd-zoom-drop" text={`${Math.round(scale * 100)}%`} tip={t('Zoom')} panel={(close) => (<>
          <Item label={t('Fit')} on={zoom === 'fit'} run={() => setZoom('fit')} close={close} />
          {zooms.map((z) => <Item key={z} label={`${Math.round(z * 100)}%`} on={zoom === z} run={() => setZoom(z)} close={close} />)}
        </>)} />}
      </span>
    </div>
  )
  return (
    <div className={`sd-doc sd-word${flow ? ' flow' : ''}`} onKeyDown={onKeys}>
      <style>{css}</style>
      <div className="sd-doc-head">
        {toolbar}
        {linking != null && <LinkBar value={linking} setValue={setLinking} link={s.link} href={s.href} onSubmit={applyLink} onRemove={() => { c().extendMarkRange('link').unsetLink().run(); setLinking(null) }} onClose={() => { setLinking(null); editor.commands.focus() }} />}
        {finding && <FindBar editor={editor} replace={finding === 'replace'} onClose={() => setFinding(null)} />}
      </div>
      <div className="sd-doc-main" ref={main}>
        {showOutline && <Outline editor={editor} headings={headings} onClose={() => setOutline(false)} />}
        <div className="sd-desk" ref={desk}>
          <div className="sd-sheet" style={{ zoom: scale !== 1 ? scale : undefined, ...(flow ? {} : { width: g.w, '--pg-l': `${g.left}px`, '--pg-r': `${g.right}px` }) }}>
            <EditorContent editor={editor} className="sd-page-host" />
          </div>
        </div>
        {showComments && <Comments editor={editor} comments={comments} onClose={() => setShowComments(false)} />}
      </div>
      {!readOnly && <AskInPlace editor={editor} file={file} scroller={desk} selection={() => pickedOf(editor)} apply={(range, text, below) => { touched.current = true; putIn(editor, range, text, below, (a) => ({ ...a, x: null, pa: '' })) }} />}
      {counting && <WordCount editor={editor} pages={flow ? null : pages.total} onClose={() => setCount(false)} />}
      {editingHf && <HfEditor which={editingHf} info={info} model={model} css={css} scope={scope} value={hf} onClose={() => setEditingHf(null)} onDone={(next) => { touched.current = true; setHf(next); hfRef.current = next; stamp.current++; setEditingHf(null); onDirty(true); again.current?.() }} />}
      <WordKeys editor={editor} setStyle={setStyle} info={info} toggleList={toggleList} paras={paras} mark={mark} s={s} indent={indent} openLink={() => setLinking(s.href || '')} c={c} clear={clear} />
    </div>
  )
}
// Word's built-in names as people know them: "heading 1" is Heading 1.
const displayName = (n) => String(n || '').replace(/^heading (\d)$/i, 'Heading $1').replace(/^([a-z])/, (x) => x.toUpperCase())

// The size box: the size at the cursor, typed or picked.
function SizeBox({ value, onPick }) {
  const [v, setV] = useState(String(value))
  const [open, setOpen] = useState(false)
  useEffect(() => setV(String(value)), [value])
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])
  const take = () => { const n = Number(String(v).replace(',', '.')); if (Number.isFinite(n) && n > 0) onPick(n); else setV(String(value)) }
  return (
    <span className="menu-anchor sd-size-box" ref={ref}>
      <input value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => { e.target.select(); setOpen(true) }} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); take(); setOpen(false) } if (e.key === 'Escape') { setV(String(value)); setOpen(false) } }} aria-label={t('Font size')} title={t('Font size')} inputMode="decimal" />
      {open && <div className="sd-drop narrow" role="menu" aria-label={t('Font size')}>{SIZES.map((n) => <Item key={n} label={String(n)} on={n === value} run={() => { onPick(n); setOpen(false) }} />)}</div>}
    </span>
  )
}

function LinkBar({ value, setValue, link, href, onSubmit, onRemove, onClose }) {
  return (
    <form className="sd-linkbar" onSubmit={onSubmit} aria-label={t('Link address')}>
      <Icon name="link" size={13} />
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }} placeholder={t('A web address, like example.com')} aria-label={t('Link address')} spellCheck={false} />
      <button type="submit" className="btn small primary">{link ? t('Change') : t('Add link')}</button>
      {link && href && <a className="btn small" href={href} target="_blank" rel="noreferrer" title={href}><Icon name="external" size={12} /> {t('Open')}</a>}
      {link && <button type="button" className="btn small" onClick={onRemove}>{t('Remove link')}</button>}
      <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button>
    </form>
  )
}

// A table: a grid to pick its size from; in one, what to add, take out or merge.
function TableTool({ editor, c, on }) {
  const [hover, setHover] = useState([0, 0])
  if (on) {
    return <Drop name={t('Table')} icon="table" tip={t('Table: add or delete rows and columns, merge cells')} panel={(close) => (<>
      <Item icon="plus" label={t('Add a row above')} run={() => c().addRowBefore().run()} close={close} />
      <Item icon="plus" label={t('Add a row below')} run={() => c().addRowAfter().run()} close={close} />
      <Item icon="plus" label={t('Add a column on the left')} run={() => c().addColumnBefore().run()} close={close} />
      <Item icon="plus" label={t('Add a column on the right')} run={() => c().addColumnAfter().run()} close={close} />
      <div className="menu-sep" />
      <Item icon="grid" label={t('Merge cells')} run={() => c().mergeCells().run()} disabled={!editor.can().mergeCells()} close={close} />
      <Item icon="grid" label={t('Split the cell')} run={() => c().splitCell().run()} disabled={!editor.can().splitCell()} close={close} />
      <div className="menu-sep" />
      <Item icon="minus" danger label={t('Delete the row')} run={() => c().deleteRow().run()} close={close} />
      <Item icon="minus" danger label={t('Delete the column')} run={() => c().deleteColumn().run()} close={close} />
      <Item icon="trash" danger label={t('Delete the table')} run={() => c().deleteTable().run()} close={close} />
    </>)} />
  }
  return <Drop name={t('Table')} icon="table" tip={t('Insert a table')} panel={(close) => (
    <div className="sd-grid-pick" onMouseLeave={() => setHover([0, 0])}>
      <div className="sd-grid-cells" role="grid" aria-label={t('Table size')}>
        {Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (__, k) => (
          <button key={`${r}-${k}`} type="button" className={`sd-grid-cell${r < hover[0] && k < hover[1] ? ' on' : ''}`} aria-label={t('{rows} by {cols}', { rows: r + 1, cols: k + 1 })} onMouseEnter={() => setHover([r + 1, k + 1])} onFocus={() => setHover([r + 1, k + 1])} onMouseDown={(e) => e.preventDefault()} onClick={() => { c().insertTable({ rows: r + 1, cols: k + 1, withHeaderRow: false }).run(); close() }} />
        )))}
      </div>
      <small className="muted">{hover[0] ? t('{rows} by {cols}', { rows: hover[0], cols: hover[1] }) : t('Pick its size')}</small>
    </div>
  )} />
}

// The shortcuts Word and Google Docs have that the editor doesn't by itself.
function WordKeys({ editor, setStyle, info, toggleList, paras, mark, s, indent, openLink, c, clear }) {
  useEffect(() => {
    const dom = editor.view.dom
    const key = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      const run = (fn) => { e.preventDefault(); e.stopPropagation(); fn() }
      if (e.altKey && /^Digit[0-6]$/.test(e.code)) { const n = Number(e.code.slice(5)); return run(() => setStyle(n === 0 ? info.styles.normal : info.headingStyle(n) || `Heading${n}`)) }
      if (e.shiftKey && e.code === 'Digit8') return run(() => toggleList(true))
      if (e.shiftKey && e.code === 'Digit7') return run(() => toggleList(false))
      if (e.shiftKey && ['l', 'e', 'r', 'j'].includes(k)) return run(() => paras({ al: { l: 'left', e: 'center', r: 'right', j: 'both' }[k] }))
      if (!e.shiftKey && k === '.') return run(() => (s.sup ? mark('va') : mark('va', { v: 'superscript' })))
      if (!e.shiftKey && k === ',') return run(() => (s.sub ? mark('va') : mark('va', { v: 'subscript' })))
      if (!e.shiftKey && k === 'k') return run(openLink)
      if (!e.shiftKey && k === '[') return run(() => indent(-1))
      if (!e.shiftKey && k === ']') return run(() => indent(1))
      if (!e.shiftKey && k === 'enter') return run(() => c().insertContent([{ type: 'paragraph', content: [{ type: 'pbr' }] }]).run())
      if (!e.shiftKey && k === '\\') return run(clear)
    }
    dom.addEventListener('keydown', key, true)
    return () => dom.removeEventListener('keydown', key, true)
  }, [editor, setStyle, info, toggleList, paras, mark, s, indent, openLink, c, clear])
  return null
}

// The comments in a Word file: who said what, in the order they come; a tap shows what it's about.
function Comments({ editor, comments, onClose }) {
  const [on, setOn] = useState(null)
  const at = useMemo(() => {
    const m = new Map()
    editor.state.doc.descendants((n, pos) => { if (n.type.name === 'xin' && (n.attrs.k === 'cs' || n.attrs.k === 'cr') && !m.has(String(n.attrs.id))) m.set(String(n.attrs.id), pos); return true })
    return m
  }, [editor])
  const list = [...comments].sort((a, b) => (at.get(a[0]) ?? 1e9) - (at.get(b[0]) ?? 1e9))
  const pick = (id) => {
    setOn(id)
    editor.view.dispatch(editor.state.tr.setMeta(commentKey, { on: id }))
    const pos = at.get(id)
    if (pos != null) { const d = editor.view.domAtPos(pos + 1).node; (d.nodeType === 1 ? d : d.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
  }
  useEffect(() => () => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentKey, { on: null })) }, [editor])
  return (
    <aside className="sd-comments-pane" aria-label={t('Comments')}>
      <div className="sd-pane-head"><b>{t('Comments')}</b><span className="muted small">{comments.length}</span><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close the comments')} title={t('Close the comments')}><Icon name="x" size={13} /></button></div>
      <p className="muted small sd-pane-none">{t('Kept as they are when you save. Answer them in Word.')}</p>
      <ol className="sd-comment-list">
        {list.map(([id, cm]) => (
          <li key={id}><button type="button" className={`sd-comment${on === id ? ' on' : ''}`} onClick={() => pick(id)}>
            <span className="sd-comment-who"><i>{(cm.initials || cm.author || '?').slice(0, 2).toUpperCase()}</i><b>{cm.author || t('Someone')}</b>{cm.date && <small className="muted">{new Date(cm.date).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}</small>}</span>
            <span className="sd-comment-text">{cm.text}</span>
          </button></li>
        ))}
      </ol>
    </aside>
  )
}

// The header and footer, edited as small documents in the file's own look; Page number puts in a
// field Word fills in on every page.
const PAGE_FIELD = { type: 'xin', attrs: { raw: '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>', k: 'fld', t: '1', f: 'PAGE' } }
function HfEditor({ which, info, model, css, scope, value, onClose, onDone }) {
  const empty = { type: 'doc', content: [{ type: 'paragraph' }] }
  const head = useEditor({ extensions: wordExtensions(info), content: value.header || empty, editorProps: { attributes: { class: `sd-w ${scope} sd-hf-ed`, 'aria-label': t('Header') } } }, [])
  const foot = useEditor({ extensions: wordExtensions(info), content: value.footer || empty, editorProps: { attributes: { class: `sd-w ${scope} sd-hf-ed`, 'aria-label': t('Footer') } } }, [])
  useEffect(() => { (which === 'footer' ? foot : head)?.commands.focus('end') }, [head, foot, which])
  const hasText = (e) => !!e && (e.state.doc.textContent.trim() || (() => { let f = false; e.state.doc.descendants((n) => { if (n.type.name === 'xin' || n.type.name === 'image') f = true }); return f })())
  const done = () => {
    const out = (e, was) => (hasText(e) ? (was && JSON.stringify(e.getJSON()) === JSON.stringify(was) ? was : e.getJSON()) : was ? empty : null)
    onDone({ ...value, header: out(head, value.header), footer: out(foot, value.footer) })
  }
  const g = pageOf(model.page)
  const field = (e) => e?.chain().focus().insertContent(PAGE_FIELD).run()
  return createPortal(
    <div className="sd-modal" role="dialog" aria-label={t('Header and footer')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <style>{css}</style>
      <div className="sd-hf">
        <div className="sd-panel-head"><b>{t('Header and footer')}</b><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button></div>
        {model.hf.titlePg && <p className="muted small sd-hf-note">{t('The first page has a header and footer of its own, kept as they are. These are on the other pages.')}</p>}
        {[['header', t('Header'), head], ['footer', t('Footer'), foot]].map(([k, label, ed]) => (
          <div key={k} className="sd-hf-part">
            <div className="sd-hf-label"><b>{label}</b><span className="sd-grow" /><button type="button" className="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => field(ed)}><Glyph name="words" size={12} /> {t('Page number')}</button></div>
            <div className="sd-hf-paper" style={{ paddingLeft: Math.min(g.left, 48), paddingRight: Math.min(g.right, 48) }}>{ed && <EditorContent editor={ed} />}</div>
          </div>
        ))}
        <div className="sd-ask-acts"><button type="button" className="btn small primary" onClick={done}><Icon name="check" size={12} /> {t('Done')}</button><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button></div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Markdown ----------
// Saved as Markdown, as written: so its toolbar has what Markdown has (headings, lists, quotes,
// code, links, tables), and no underline, colours, fonts or alignment.
function MarkdownDoc({ file, text, onDirty, onStats, handle, readOnly }) {
  const { touched, handlers } = useTouched()
  const desk = useRef(null)
  const plugins = useMemo(() => Extension.create({ name: 'mdView', addProseMirrorPlugins: () => [findPlugin()] }), [])
  const editor = useEditor({
    extensions: [
      // A link is followed from the link bar (Open), not by a click while you're writing in it.
      StarterKit.configure({ link: { openOnClick: false, enableClickSelection: true, defaultProtocol: 'https' }, underline: false }),
      Image.configure({ allowBase64: true }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      Markdown.configure({ html: false, tightLists: true, linkify: true }), plugins,
    ],
    content: text,
    editable: !readOnly,
    editorProps: { handleDOMEvents: handlers, attributes: { 'aria-label': t('The document'), class: 'sd-md' } },
    onUpdate: ({ transaction }) => { if (touched.current && transaction.docChanged) onDirty(true) },
    // A document that doesn't end in a paragraph (a new one ends in its title) gets an empty one
    // under it to write in, as the editor adds once you type: not a change of yours, nothing to undo.
    onCreate: ({ editor: e }) => {
      const last = e.state.doc.lastChild
      if (last && last.type.name !== 'paragraph') e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, e.schema.nodes.paragraph.create()).setMeta('addToHistory', false))
    },
  }, [text])
  useEffect(() => { editor?.setEditable(!readOnly) }, [editor, readOnly])
  const [finding, setFinding] = useState(null)
  const [counting, setCount] = useState(false)
  const openCount = useCallback(() => setCount(true), [])
  useStatus(editor, onStats, null, openCount)
  const onKeys = useFindKeys(setFinding, setCount)
  const levelOf = useCallback((n) => (n.type.name === 'heading' ? n.attrs.level - 1 : null), [])
  const headings = useHeadings(editor, levelOf)
  const [main, mainW] = useWidth()
  const [outline, setOutline] = usePane('outline', true)
  const showOutline = outline && mainW > 1000
  const [linking, setLinking] = useState(null)
  handle.current = {
    save: async () => editor.storage.markdown.getMarkdown(),
    selection: () => {
      if (!editor) return null
      const { from, to } = editor.state.selection
      const tx2 = editor.state.doc.textBetween(from, to, '\n').trim()
      let heading = null
      editor.state.doc.nodesBetween(0, from, (n) => { if (n.type.name === 'heading') heading = n.textContent })
      return tx2 ? { text: tx2, where: heading ? t('under "{heading}"', { heading }) : null } : null
    },
  }
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const level = e.isActive('heading') ? e.getAttributes('heading').level : null
      return {
        style: level ? `h${level}` : e.isActive('codeBlock') ? 'code' : e.isActive('blockquote') ? 'quote' : 'p',
        bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'),
        bulletList: e.isActive('bulletList'), orderedList: e.isActive('orderedList'), blockquote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'),
        link: e.isActive('link'), href: e.getAttributes('link').href || '', table: e.isActive('table'),
        undo: e.can().undo(), redo: e.can().redo(),
      }
    },
  })
  if (!editor || !s) return null
  const c = () => { touched.current = true; return editor.chain().focus() }
  const STYLES = [['p', t('Normal text')], ['h1', t('Heading {n}', { n: 1 })], ['h2', t('Heading {n}', { n: 2 })], ['h3', t('Heading {n}', { n: 3 })]]
  const setStyle = (v) => (v === 'p' ? c().setParagraph().run() : c().setHeading({ level: Number(v[1]) }).run())
  const label = (STYLES.find((x) => x[0] === s.style) || [null, s.style === 'code' ? t('Code block') : s.style === 'quote' ? t('Quote') : t('Heading {n}', { n: s.style.slice(1) })])[1]
  const applyLink = (e) => {
    e.preventDefault()
    const href = hrefOf(linking || '')
    if (!href) c().extendMarkRange('link').unsetLink().run()
    else if (editor.state.selection.empty && !s.link) c().insertContent({ type: 'text', text: href.replace(/^mailto:/, ''), marks: [{ type: 'link', attrs: { href } }] }).run()
    else c().extendMarkRange('link').setLink({ href }).run()
    setLinking(null)
  }
  return (
    <div className="sd-doc sd-mdoc" onKeyDown={onKeys}>
      <div className="sd-doc-head">
        {!readOnly && (
          <div className="sd-toolbar sd-doc-tools" role="toolbar" aria-label={t('Formatting')}>
            <span className="sd-group">
              <Tool name={t('Undo')} icon="undo" run={() => c().undo().run()} keys={['mod', 'z']} disabled={!s.undo} />
              <Tool name={t('Redo')} icon="redo" run={() => c().redo().run()} keys={['mod', 'shift', 'z']} disabled={!s.redo} />
            </span>
            <span className="sd-group">
              <Drop name={t('Text style')} className="sd-style-drop" text={label} tip={t('Text style: {paragraph} for normal text, {heading} for a heading', { paragraph: keys('mod', 'alt', '0'), heading: `${keys('mod', 'alt', '1')}–3` })} wide panel={(close) => STYLES.map(([v, l]) => (
                <Item key={v} label={l} style={{ fontSize: { p: 14, h1: 20, h2: 17, h3: 15 }[v], fontWeight: v === 'p' ? 400 : 650 }} on={s.style === v} run={() => setStyle(v)} close={close} />
              ))} />
            </span>
            <span className="sd-group">
              <Tool name={t('Bold')} icon="bold" run={() => c().toggleBold().run()} on={s.bold} keys={['mod', 'b']} />
              <Tool name={t('Italic')} icon="italic" run={() => c().toggleItalic().run()} on={s.italic} keys={['mod', 'i']} />
              <Tool name={t('Strikethrough')} icon="strike" run={() => c().toggleStrike().run()} on={s.strike} keys={['mod', 'shift', 's']} />
              <Tool name={t('Inline code')} icon="code" run={() => c().toggleCode().run()} on={s.code} keys={['mod', 'e']} />
            </span>
            <span className="sd-group">
              <Tool name={t('Bulleted list')} icon="list" run={() => c().toggleBulletList().run()} on={s.bulletList} keys={['mod', 'shift', '8']} />
              <Tool name={t('Numbered list')} icon="list-ordered" run={() => c().toggleOrderedList().run()} on={s.orderedList} keys={['mod', 'shift', '7']} />
              <Tool name={t('Quote')} icon="quote" run={() => c().toggleBlockquote().run()} on={s.blockquote} keys={['mod', 'shift', 'b']} />
              <Tool name={t('Code block')} icon="code-block" run={() => c().toggleCodeBlock().run()} on={s.codeBlock} keys={['mod', 'alt', 'c']} />
            </span>
            <span className="sd-group">
              <Tool name={t('Insert link')} icon="link" run={() => setLinking(linking == null ? s.href || '' : null)} on={s.link || linking != null} tip={s.link ? t('Link: change it, open it or remove it') : t('Insert link')} />
              <TableTool editor={editor} c={c} on={s.table} />
            </span>
            <span className="sd-grow" />
            <span className="sd-group">
              <Tool name={t('Outline')} icon="outline" on={showOutline} run={() => setOutline(!showOutline)} tip={t('Outline: the headings, to go to')} />
              <Tool name={t('Find and replace')} icon="search" on={!!finding} run={() => setFinding(finding ? null : 'find')} keys={['mod', 'f']} />
            </span>
          </div>
        )}
        {linking != null && <LinkBar value={linking} setValue={setLinking} link={s.link} href={s.href} onSubmit={applyLink} onRemove={() => { c().extendMarkRange('link').unsetLink().run(); setLinking(null) }} onClose={() => { setLinking(null); editor.commands.focus() }} />}
        {finding && <FindBar editor={editor} replace={finding === 'replace'} onClose={() => setFinding(null)} />}
      </div>
      <div className="sd-doc-main" ref={main}>
        {showOutline && <Outline editor={editor} headings={headings} onClose={() => setOutline(false)} />}
        <div className="sd-desk md" ref={desk}>
          <EditorContent editor={editor} className="sd-page md" style={{ '--sd-ph': JSON.stringify(t('Write here…')) }} />
        </div>
      </div>
      {!readOnly && <AskInPlace editor={editor} file={file} scroller={desk} selection={() => pickedOf(editor)} apply={(range, txt, below) => { touched.current = true; putIn(editor, range, txt, below, () => undefined) }} />}
      {counting && <WordCount editor={editor} pages={null} onClose={() => setCount(false)} />}
    </div>
  )
}
