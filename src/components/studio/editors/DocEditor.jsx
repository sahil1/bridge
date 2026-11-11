import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import { Extension, Editor, getMarkRange } from '@tiptap/core'
import { DOMSerializer, DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { BulletList, TaskList, TaskItem } from '@tiptap/extension-list'
import { Markdown } from 'tiptap-markdown'
import Icon from '../../Icon.jsx'
import { t, locale } from '../../../i18n/index.js'
import { api } from '../../../api.js'
import { textOf, rawUrl, base64 } from '../files.js'
import { readDocx, writeDocx, fingerprint } from '../ooxml.js'
import { wordExtensions, fontStack } from '../wordschema.js'
import { docInfo, wordCss, listPlugin, commentPlugin, pagePlugin, pageOf, hfRenderer, commentKey } from '../docview.js'
import { findPlugin } from '../search.js'
import { cleanPaste, listsOut } from '../paste.js'
import { keys } from '../keys.js'
import { Tool, Drop, Item, Glyph, Swatches, Markers, markerCss, FindBar, Outline, useHeadings, WordCount, Shortcuts, AskInPlace, askItems, countWords, fontHere, COMMON_FONTS, SIZES } from '../doctools.jsx'
import { useThreads, useAuthor, Threads } from '../doccomments.jsx'
import { useTrial } from '../../../trials.js'
import '../doc.css'

// A document. A Word file is edited as Word has it (ooxml.js): its pages at their size and margins,
// its styles, fonts, lists, tables, pictures, headers and footers, and saved back with everything
// it doesn't change exactly as it was. Markdown is edited as Markdown (saved as written), and plain
// text as it is. handle: save() gives the bytes to write, selection() what's picked (for Ask an
// agent) and the heading it's under. onStats: pages and words, for the page's status line.
//
// Each toolbar offers only what its format keeps: a Word file has fonts, colours and alignment;
// Markdown has none of those, but has code.

export default function DocEditor({ file, data, onDirty, onStats, handle, readOnly = false, onOpen }) {
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
  if (start.error) return <div className="sd-empty" role="alert"><Icon name="alert" size={18} /><b>{t("Couldn't read this Word file: {error}", { error: start.error })}</b><span className="muted small">{t('The file is as it was. Download it to open it in Word, or restore an earlier version.')}</span></div>
  if (plain) return <PlainText text={start.text} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} />
  if (md) return <MarkdownDoc file={file} text={start.text} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} onOpen={onOpen} />
  return <WordDoc file={file} model={start.model} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} onOpen={onOpen} />
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

// ---------- Pictures pasted or dropped in ----------
// A picture file as a data: URL and its size: PNG, JPEG and GIF as they are, any other kind the
// browser can show (WebP, HEIC, SVG) drawn again as PNG, which Word and every app read.
const KEEP_AS_IS = /^image\/(png|jpe?g|gif)$/
function pictureOf(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader()
    rd.onerror = () => reject(new Error(t("Couldn't read {name}", { name: file.name || t('the picture') })))
    rd.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error(t("{name} isn't a picture this app can show", { name: file.name || t('That') })))
      img.onload = () => {
        let src = rd.result
        if (!KEEP_AS_IS.test(file.type)) {
          const c = document.createElement('canvas')
          c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1
          c.getContext('2d').drawImage(img, 0, 0)
          src = c.toDataURL('image/png')
        }
        resolve({ src, w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
      }
      img.src = rd.result
    }
    rd.readAsDataURL(file)
  })
}
const filesIn = (dt) => [...(dt?.files || [])]
// Words on the clipboard win over a picture beside them (Word puts a picture of what's copied
// there too); a browser's Copy Image has a picture and no words.
const wordsIn = (dt) => {
  if (dt?.getData('text/plain')?.trim()) return true
  const h = dt?.getData('text/html') || ''
  return !!h && !!new DOMParser().parseFromString(h, 'text/html').body.textContent.trim()
}
const dataUrlOf = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob) })
// A data: URL's bytes, as base64 and its kind.
const partsOfData = (src) => { const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(src || ''); return m ? { mime: m[1], data: m[2] } : null }
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

// What a document says for a moment (a picture that couldn't go in, a copy made beside it).
function Said({ say, onClose, onOpen }) {
  if (!say) return null
  return (
    <div className={`sd-bar sd-note-bar sd-doc-said${say.error ? ' bad' : ''}`} role={say.error ? 'alert' : 'status'}>
      <Icon name={say.error ? 'alert' : 'info'} size={13} />
      <span>{say.text}</span>
      {say.open && <button type="button" className="link-btn" onClick={() => onOpen?.(say.open)}>{t('Open it')}</button>}
      <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
    </div>
  )
}

// Printed from a page of its own, as the document's pages: the browser's Print, where Save as PDF
// is. css: the page's look; page: its size and margins (CSS pixels); head and foot: a header's and
// a footer's text, at the top and bottom of each printed page, its page number filled in.
function printPage({ title, html, css, page, head, foot }) {
  const f = document.createElement('iframe')
  f.className = 'sd-print-frame'
  f.setAttribute('aria-hidden', 'true')
  const q = (s) => JSON.stringify(String(s)).replace(/</g, '\\3c ')
  const box = (where, x) => {
    if (!x?.text) return ''
    const parts = x.text.split(/(\{PAGE\}|\{PAGES\})/).filter(Boolean).map((s) => (s === '{PAGE}' ? 'counter(page)' : s === '{PAGES}' ? 'counter(pages)' : q(s))).join(' ')
    return `@${where}-${x.align || 'center'}{content:${parts};font:9pt ${x.font || 'sans-serif'};color:#555}`
  }
  const size = page ? `size:${page.w}px ${page.h}px;margin:${page.top}px ${page.right}px ${page.bottom}px ${page.left}px;` : 'margin:20mm;'
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${String(title).replace(/[<&]/g, '')}</title><style>${css}
html,body{margin:0;background:#fff;color:#000}@page{${size}${box('top', head)}${box('bottom', foot)}}
img{max-width:100%}table{break-inside:auto}tr{break-inside:avoid}h1,h2,h3,h4{break-after:avoid}</style></head><body>${html}</body></html>`
  f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print() } finally { setTimeout(() => f.remove(), 60_000) } }, 200) }
  document.body.appendChild(f)
}
// The app's own rules for a document's page (doc.css), for printing it on a page of its own.
const pageRules = (re) => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText) } catch { return [] } }).filter((x) => re.test(x)).join('\n')

// A link the cursor is in, as Google Docs shows it: its address (a click opens it), and Copy,
// Change and Remove.
function LinkBubble({ editor, href, onEdit, onRemove, scroller }) {
  const [box, setBox] = useState(null)
  const [copied, setCopied] = useState(false)
  const place = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const { empty, $from } = editor.state.selection
    if (!empty || !editor.isFocused || !editor.isActive('link')) { setBox(null); return }
    const r = getMarkRange($from, editor.schema.marks.link) || { from: $from.pos, to: $from.pos }
    try {
      const a = editor.view.coordsAtPos(r.from)
      const host = scroller?.current?.getBoundingClientRect()
      // Scrolled out of sight, the link's bubble goes with it.
      if (host && (a.bottom < host.top || a.top > host.bottom)) { setBox(null); return }
      const left = Math.max((host?.left ?? 0) + 8, Math.min(a.left, (host?.right ?? window.innerWidth) - 360))
      // Under the link, or over it where there's no room under it.
      const below = a.bottom + 6
      setBox({ left, top: below + 44 > (host?.bottom ?? window.innerHeight) ? Math.max(8, a.top - 50) : below })
    } catch { setBox(null) }
  }, [editor, scroller])
  useEffect(() => {
    if (!editor) return undefined
    const up = () => requestAnimationFrame(place)
    editor.on('selectionUpdate', up); editor.on('focus', up); editor.on('blur', up); editor.on('update', up)
    const el = scroller?.current
    el?.addEventListener('scroll', up, { passive: true })
    window.addEventListener('resize', up)
    return () => { editor.off('selectionUpdate', up); editor.off('focus', up); editor.off('blur', up); editor.off('update', up); el?.removeEventListener('scroll', up); window.removeEventListener('resize', up) }
  }, [editor, place, scroller])
  useEffect(() => setCopied(false), [href])
  if (!box || !href) return null
  const shown = href.replace(/^mailto:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const copy = async () => { try { await navigator.clipboard.writeText(href); setCopied(true) } catch { setCopied(false) } }
  return createPortal(
    <div className="sd-link-pop" role="dialog" aria-label={t('Link')} style={{ left: box.left, top: box.top }} onMouseDown={(e) => { if (!e.target.closest('a')) e.preventDefault() }}>
      <Icon name="link" size={12} />
      <a href={href} target="_blank" rel="noreferrer" title={t('Open {address}', { address: href })}>{shown}</a>
      <Tool name={copied ? t('Copied') : t('Copy the address')} icon={copied ? 'check' : 'copy'} run={copy} />
      <Tool name={t('Change the link')} icon="edit" run={onEdit} keys={['mod', 'k']} />
      <Tool name={t('Remove the link')} icon="x" run={onRemove} />
    </div>,
    document.body,
  )
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
// What's picked and the text around it, for AI Assist; and the change put in, a paragraph for each
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
// panel; AI Assist over the page.
function useFindKeys(setFinding, setCount, print, setHelp) {
  const printRef = useRef(print)
  printRef.current = print
  return useCallback((e) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'f' && !e.shiftKey) { e.preventDefault(); setFinding('find') }
    else if (k === 'h' && e.shiftKey) { e.preventDefault(); setFinding('replace') }
    else if (k === 'c' && e.shiftKey) { e.preventDefault(); setCount(true) }
    else if (k === 'p' && !e.shiftKey && printRef.current) { e.preventDefault(); printRef.current() }
    else if (e.code === 'Slash' && !e.shiftKey && setHelp) { e.preventDefault(); setHelp(true) }
  }, [setFinding, setCount, setHelp])
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
// What's copied out: as the editor writes it, its lists as lists (paste.js).
const COPY_OUT = {
  serializeFragment: (frag, o, target) => {
    const schema = frag.firstChild?.type.schema
    return schema ? listsOut(DOMSerializer.fromSchema(schema).serializeFragment(frag, o, target)) : (target || (o?.document || document).createDocumentFragment())
  },
}
let scopeN = 0
function WordDoc({ file, model, onDirty, onStats, handle, readOnly, onOpen }) {
  const info = useMemo(() => docInfo(model), [model])
  const scope = useMemo(() => `sd-w${++scopeN}`, [])
  const css = useMemo(() => wordCss(model, info, `.${scope}`), [model, info, scope])
  // The page's size and margins (twips): as the file has them, or as Page setup changed them.
  const [page, setPage] = useState(model.page)
  const g = useMemo(() => pageOf(page), [page])
  const gRef = useRef(g)
  gRef.current = g
  const normal = model.styles.normal
  const [say, setSay] = useState(null)
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
    page: () => (flowRef.current ? null : gRef.current),
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
  }), [info, normal, readOnly])
  // Comments as threads (a beta feature): what the page marks is theirs (doccomments.jsx).
  const threading = useTrial('comments')
  const skip = useRef(() => false)
  const plugins = useMemo(() => Extension.create({ name: 'wordView', addProseMirrorPlugins: () => [listPlugin(model, info), commentPlugin({ skip: (id) => skip.current(id) }), findPlugin(), pagesPlugin] }), [model, info, pagesPlugin])
  // What's pasted, dropped or clicked, handled where the editor's own handling isn't Google Docs'
  // (its handlers are set once; what they do is this render's).
  const own = useRef({})
  const editor = useEditor({
    extensions: [...wordExtensions(info), plugins],
    content: model.json,
    editable: !readOnly,
    editorProps: {
      handleDOMEvents: { ...handlers, mousedown: (view, e) => { handlers.mousedown(); return own.current.tick?.(view, e) || false } },
      attributes: { 'aria-label': t('The document'), class: `sd-w ${scope}`, spellcheck: 'true' },
      transformPastedHTML: (html) => cleanPaste(html, { paras: true, quote: info.get('Quote') ? 'Quote' : null, title: info.get('Title') ? 'Title' : null }),
      transformPasted: (slice) => { own.current.pasted?.(slice); return slice },
      handlePaste: (view, e, slice) => own.current.paste?.(view, e, slice) || false,
      handleDrop: (view, e, slice, moved) => (!moved && own.current.drop?.(view, e)) || false,
      clipboardSerializer: COPY_OUT,
    },
    onUpdate: ({ transaction }) => { if (touched.current && transaction.docChanged) onDirty(true) },
    onCreate: ({ editor: e }) => { fingerprint(model.main, e.getJSON()); for (const h of [...Object.values(model.hf.header), ...Object.values(model.hf.footer)]) fingerprint(h.part, h.json) },
  }, [model])
  useEffect(() => { if (editor) renderHf.current = hfRenderer(editor.schema) }, [editor])
  useEffect(() => { editor?.setEditable(!readOnly) }, [editor, readOnly])
  useEffect(() => { again.current?.() }, [flow, g])

  const [finding, setFinding] = useState(null) // 'find' | 'replace'
  const [counting, setCount] = useState(false)
  const openCount = useCallback(() => setCount(true), [])
  useStatus(editor, onStats, flow ? null : pages, openCount)
  const printRef = useRef(null)
  const [helping, setHelp] = useState(false)
  const onKeys = useFindKeys(setFinding, setCount, () => printRef.current?.(), setHelp)
  const levelOf = useCallback((n) => (n.type.name === 'paragraph' ? info.levelOf(n.attrs.s || normal) : null), [info, normal])
  const headings = useHeadings(editor, levelOf)
  const [outline, setOutline] = usePane('outline', true)
  const comments = useMemo(() => [...model.comments.entries()].filter(([, c]) => c.text), [model])
  const [showComments, setShowComments] = useState(false)
  const author = useAuthor()
  const threads = useThreads({ editor, model, on: threading && !readOnly, author, dirty: () => { touched.current = true; onDirty(true) } })
  skip.current = threading ? threads.skip : () => false
  // A comment on the words picked: in the comments beside the page, its box ready.
  const comment = () => { setShowComments(true); threads.start() }
  // Words with a comment, clicked: its thread, in the comments.
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  useEffect(() => {
    if (!editor || !threading) return undefined
    const dom = editor.view.dom
    const click = (e) => { const el = e.target.closest?.('.sd-cmt[data-cid]'); if (el && dom.contains(el)) { setShowComments(true); threadsRef.current.pick(el.getAttribute('data-cid')) } }
    dom.addEventListener('click', click)
    return () => dom.removeEventListener('click', click)
  }, [editor, threading])
  // The page at its size where it fits beside the outline (and the comments), smaller where it
  // doesn't, and no pages on a phone; the outline only where there's room for both.
  const showOutline = outline && !flow && mainW >= g.w + 236 + 56 + (showComments ? 300 : 0)
  const deskW = mainW - (showOutline ? 236 : 0) - (showComments && mainW > 700 ? 300 : 0)
  const [zoom, setZoom] = useState('fit')
  const fit = deskW > 0 ? Math.min(1, Math.max(0.5, (deskW - 48) / g.w)) : 1
  const scale = flow ? 1 : zoom === 'fit' ? fit : zoom
  useEffect(() => { again.current?.() }, [scale])
  const [linking, setLinking] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const asking = useRef(null) // AskInPlace's, for AI Assist in the page's header

  handle.current = {
    assist: () => (readOnly ? [] : askItems(asking)),
    save: async () => {
      const edits = {}
      const make = {}
      for (const which of ['header', 'footer']) {
        const now = hf[which]
        const was = model.hf[which].default
        if (was) { if (now !== was.json) edits[was.path] = now || { type: 'doc', content: [{ type: 'paragraph' }] } } else if (now) make[which] = now
      }
      return writeDocx(model, editor.getJSON(), { hf: edits, make, page: page !== model.page ? page : null, more: threading ? threads.save : null })
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
      return {
        style: sid, font: e.getAttributes('ff').f || run.font || model.theme.fonts.minor || 'Calibri', size: (e.getAttributes('fs').hp || run.size || 22) / 2,
        color: e.getAttributes('fc').c || null, hl: e.getAttributes('hl').c || null,
        bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
        sup: e.isActive('va', { v: 'superscript' }), sub: e.isActive('va', { v: 'subscript' }),
        align: a.al || para.jc || 'left', line: a.ln || (para.line ? `${para.rule || 'auto'}:${para.line}` : 'auto:240'),
        sb: a.sb ?? para.before ?? 0, sa: a.sa ?? para.after ?? 0,
        list: numId ? info.listKind(numId, a.lvl ?? para.ilvl ?? 0) : null,
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
  // A list of a kind (bullet, number, check): off when it's that already; else the list just above,
  // when it's that kind, goes on; else a new one (numbers from 1).
  const toggleList = (kind) => {
    const on = kind === 'check' ? s.list === 'check' || s.list === 'checked' : s.list === kind
    if (on) { paras({ num: info.styleNum(s.style) ? 0 : null, lvl: null }); return }
    const { $from } = editor.state.selection
    const i = $from.index($from.depth - 1)
    const above = i > 0 ? $from.node($from.depth - 1).child(i - 1) : null
    const was = above?.type.name === 'paragraph' && above.attrs.num ? info.listKind(above.attrs.num, above.attrs.lvl) : null
    paras({ num: was === kind ? above.attrs.num : info.listNum(kind, { fresh: true }), ...(s.list ? {} : { lvl: 0 }) })
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
  // Pictures put in (picked, pasted or dropped), at most the page's width, where the cursor is or
  // where they're dropped. A file that isn't a picture is said, not dropped in silence.
  const putPictures = async (files, at = null) => {
    const max = g.w - g.left - g.right
    for (const f of files) {
      if (!/^image\//.test(f.type)) { setSay({ text: t("{name} isn't a picture: only pictures go in a document.", { name: f.name || t('That') }), error: true }); continue }
      try {
        const pic = await pictureOf(f)
        const w = Math.min(pic.w, max), h = Math.round(pic.h * (w / pic.w))
        touched.current = true
        const node = editor.schema.nodes.image.create({ src: pic.src, width: Math.round(w), height: h })
        const tr = editor.state.tr
        if (at != null) tr.insert(Math.min(at, tr.doc.content.size), node); else tr.replaceSelectionWith(node)
        editor.view.dispatch(tr.scrollIntoView())
        at = null
      } catch (e) { setSay({ text: e.message, error: true }) }
    }
    editor.commands.focus()
  }
  // Pictures pasted from a web page or Google Docs are on the web: brought into the file, as Word
  // keeps its own. One the web won't give this page is taken out again, saying so, rather than
  // left to go missing when it's saved.
  const bringIn = async (srcs) => {
    const max = g.w - g.left - g.right
    const got = new Map()
    for (const src of srcs) {
      try {
        const r = await fetch(src, { credentials: 'omit' })
        const type = r.headers.get('content-type') || ''
        if (r.ok && /^image\//.test(type)) got.set(src, await pictureOf(new File([await r.blob()], 'picture', { type })))
      } catch { /* not given to this page */ }
    }
    if (editor.isDestroyed) return
    const tr = editor.state.tr
    const gone = []
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name !== 'image' || !srcs.includes(n.attrs.src)) return true
      const pic = got.get(n.attrs.src)
      if (!pic) { gone.push(pos); return false }
      const w = Math.min(n.attrs.width || pic.w, max)
      tr.setNodeMarkup(pos, null, { ...n.attrs, src: pic.src, width: Math.round(w), height: Math.round(n.attrs.width && n.attrs.height ? n.attrs.height * (w / n.attrs.width) : pic.h * (w / pic.w)) })
      return false
    })
    for (const pos of gone.reverse()) tr.delete(pos, pos + 1)
    if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false))
    if (gone.length) setSay({ text: gone.length === 1 ? t("A picture from the web couldn't be brought in, so it isn't in the document. Save it, then put it in with Insert picture.") : t("{n} pictures from the web couldn't be brought in, so they aren't in the document. Save them, then put them in with Insert picture.", { n: gone.length }), error: true })
  }
  own.current = {
    // The pictures in what's pasted that are on the web, to bring in once it's in.
    pasted: (slice) => {
      const srcs = []
      slice.content.descendants((n) => { if (n.type.name === 'image' && /^https?:/i.test(n.attrs.src || '')) srcs.push(n.attrs.src) })
      if (srcs.length) setTimeout(() => bringIn([...new Set(srcs)]), 0)
    },
    paste: (view, e, slice) => {
      const dt = e.clipboardData
      const files = filesIn(dt)
      if (files.length && !wordsIn(dt)) { e.preventDefault(); putPictures(files); return true }
      // Pasted on an empty line, what's pasted keeps its own first paragraph (a heading, a list's
      // item), as Google Docs has it, rather than taking the empty line's.
      const { $from, empty } = view.state.selection
      const p = $from.parent
      const first = slice.content.firstChild
      if (!empty || slice.openStart < 1 || p.type.name !== 'paragraph' || p.content.size || (p.attrs.num != null && p.attrs.num !== 0) || !first?.isTextblock) return false
      if (slice.content.childCount < 2 && !first.attrs.s && !(first.attrs.num > 0)) return false
      let blocks = true
      slice.content.forEach((n) => { if (!n.isBlock) blocks = false })
      if (!blocks) return false
      const start = $from.before(), end = $from.after()
      const tr = view.state.tr.replaceWith(start, end, slice.content)
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(start + slice.content.size, tr.doc.content.size)), -1))
      view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
      return true
    },
    drop: (view, e) => {
      const files = filesIn(e.dataTransfer)
      if (!files.length) return false
      e.preventDefault()
      putPictures(files, view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null)
      return true
    },
    // A checklist's box, clicked: ticked, or not (its text clicked is just the text).
    tick: (view, e) => {
      const el = e.target.closest?.('[data-mk]')
      const mk = el?.getAttribute('data-mk')
      if (readOnly || !el || !view.dom.contains(el) || (mk !== '☐' && mk !== '☑')) return false
      const r = el.getBoundingClientRect()
      const zoom = r.width / (el.offsetWidth || r.width) || 1
      if (e.clientX >= r.left || e.clientX < r.left - 64 * zoom || e.clientY > r.top + 28 * zoom) return false
      const pos = view.posAtDOM(el, 0) - 1
      const n = view.state.doc.nodeAt(pos)
      if (n?.type.name !== 'paragraph' || !n.attrs.num) return false
      e.preventDefault()
      touched.current = true
      const kind = info.listKind(n.attrs.num, n.attrs.lvl)
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...n.attrs, num: info.listNum(kind === 'checked' ? 'check' : 'checked') }))
      return true
    },
  }
  const insertImage = (f) => { if (f) putPictures([f]) }
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
  // Printed as its pages, at their size and margins, its header and footer at the top and bottom
  // of each (their words, with the page number), from the document as it is now.
  const print = () => {
    const dom = editor.view.dom.cloneNode(true)
    for (const x of dom.querySelectorAll('.sd-pb, .sd-pb-top, .sd-pb-end, tr.sd-pb-row, [data-resize-handle], .ProseMirror-separator')) x.remove()
    dom.removeAttribute('contenteditable')
    const hfText = (json) => {
      const p = json?.content?.find((b) => b.type === 'paragraph' && (b.content || []).length)
      if (!p) return null
      const text = (p.content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'tab' ? ' ' : n.type === 'xin' && n.attrs.k === 'fld' ? (n.attrs.f === 'PAGE' ? '{PAGE}' : n.attrs.f === 'NUMPAGES' ? '{PAGES}' : n.attrs.t || '') : '')).join('').replace(/\s+/g, ' ').trim()
      const al = p.attrs?.al || info.get(p.attrs?.s)?.look?.para?.jc
      return text ? { text, align: al === 'center' ? 'center' : al === 'right' || al === 'end' ? 'right' : 'left', font: fontStack(model.styles.defaults.run.font || model.theme.fonts.minor || 'Calibri') } : null
    }
    printPage({ title: file.name, html: dom.outerHTML, css: `${pageRules(/\.sd-w|\.sd-x|\.sd-rev/)}\n.sd-w.ProseMirror{padding:0!important;box-shadow:none!important;min-height:0}.sd-w .sd-cmt,.sd-w .sd-find{background:none;border:0}`, page: g, head: hfText(hf.header), foot: hfText(hf.footer) })
  }
  printRef.current = print
  // A Markdown copy beside it: its headings, words and their marks, lists (checklists too), links,
  // tables and pictures (saved in an images folder beside it), as Markdown has them.
  const toMarkdown = async () => {
    setExporting(true); setSay(null)
    try {
      const div = document.createElement('div')
      div.append(listsOut(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content)))
      // The words as they read now: a tracked deletion's words out, and what Markdown has no way to
      // say (a comment's marks, a footnote's number, a shape) left out.
      for (const x of div.querySelectorAll('del.sd-rev, .sd-x:not(.sd-x-fld), .sd-pbr, .sd-xbl-label')) x.remove()
      const base = file.name.replace(/\.[^.]+$/, '')
      let n = 0
      for (const img of div.querySelectorAll('img')) {
        const src = img.getAttribute('src') || ''
        if (!/^(blob|data):/.test(src)) continue
        const blob = await (await fetch(src)).blob()
        const d = partsOfData(await dataUrlOf(blob))
        const r = await api('/studio/picture', { method: 'POST', body: { root: file.root, path: file.path, name: `${base}-${++n}.${EXT[d?.mime] || 'png'}`, data: d?.data || '' } })
        img.setAttribute('src', r.src)
      }
      // Read as the Markdown editor reads a page (its HTML, not as Markdown text), then written out.
      const md = new Editor({ extensions: mdExtensions(null, { html: true }) })
      md.commands.setContent(PMDOMParser.fromSchema(md.schema).parse(div).toJSON())
      const text = md.storage.markdown.getMarkdown()
      md.destroy()
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      const r = await api('/studio/new', { method: 'POST', body: { root: file.root, dir, name: `${base}.md`, text: `${text.trim()}\n` } })
      setSay({ text: t('Saved as {name}, beside it.', { name: r.name }), open: r.path })
    } catch (e) { setSay({ text: t("Couldn't make the Markdown copy: {error}", { error: e.message }), error: true }) } finally { setExporting(false) }
  }
  const lines =[['auto:240', t('Single')], ['auto:276', '1.15'], ['auto:360', '1.5'], ['auto:480', t('Double')]]
  const ALIGN = [['left', t('Left'), 'align-left', 'l'], ['center', t('Center'), 'align-center', 'e'], ['right', t('Right'), 'align-right', 'r'], ['both', t('Justified'), 'align-justify', 'j']]
  const alignIcon = (ALIGN.find((x) => x[0] === s.align || (s.align === 'start' && x[0] === 'left') || (s.align === 'end' && x[0] === 'right')) || ALIGN[0])[2]
  const zooms = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2]

  // The formatting tools, wrapping onto a second row where the pane is too narrow for one; the view's
  // (find, outline, print, zoom) at the right of the first row either way.
  const toolbar = !readOnly && (
    <div className="sd-toolbar sd-doc-tools" role="toolbar" aria-label={t('Formatting')}>
      <div className="sd-tools-main">
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
          <Item icon="strike" label={t('Strikethrough')} on={s.strike} keys={['mod', 'shift', 'x']} run={() => c().toggleStrike().run()} close={close} />
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
        <Tool name={t('Bulleted list')} icon="list" run={() => toggleList('bullet')} on={s.list === 'bullet'} keys={['mod', 'shift', '8']} />
        <Tool name={t('Numbered list')} icon="list-ordered" run={() => toggleList('number')} on={s.list === 'number'} keys={['mod', 'shift', '7']} />
        <Tool name={t('Checklist')} icon="checklist" run={() => toggleList('check')} on={s.list === 'check' || s.list === 'checked'} keys={['mod', 'shift', '9']} />
        <Tool name={t('Decrease indent')} className="sd-wide-only" icon="outdent" run={() => indent(-1)} keys={['mod', '[']} />
        <Tool name={t('Increase indent')} className="sd-wide-only" icon="indent" run={() => indent(1)} keys={['mod', ']']} />
      </span>
      <span className="sd-group">
        <Tool name={t('Insert link')} icon="link" run={() => setLinking(linking == null ? s.href || '' : null)} on={s.link || linking != null} tip={s.link ? t('Link: change it, open it or remove it') : t('Insert link')} keys={['mod', 'k']} />
        <Tool name={t('Insert picture')} icon="image" run={() => picker.current?.click()} tip={t('Insert a picture: or paste one, or drop it on the page')} />
        <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { insertImage(e.target.files?.[0]); e.target.value = '' }} />
        <TableTool editor={editor} c={c} on={s.table} width={g.w - g.left - g.right} />
        <Drop name={t('Insert')} className="sd-wide-only" icon="plus" tip={t('Insert a page break, header or footer')} panel={(close) => (<>
          <Item icon="page-break" label={t('Page break')} keys={['mod', 'enter']} run={() => c().insertContent([{ type: 'paragraph', content: [{ type: 'pbr' }] }]).run()} close={close} />
          {threading && <Item icon="comment" label={t('Comment')} keys={['mod', 'alt', 'm']} run={comment} close={close} />}
          <Item icon="header-footer" label={hf.header ? t('Edit the header') : t('Add a header')} run={() => setEditingHf('header')} close={close} />
          <Item icon="header-footer" label={hf.footer ? t('Edit the footer') : t('Add a footer')} run={() => setEditingHf('footer')} close={close} />
        </>)} />
      </span>
      </div>
      <span className="sd-group sd-view-tools">
        {revs > 0 && <Drop name={t('Tracked changes')} className="sd-wide-only" icon="changes" text={String(revs)} tip={t('{n} tracked changes', { n: revs })} panel={(close) => (<>
          <div className="sd-drop-head">{t('{n} tracked changes', { n: revs })}</div>
          <Item icon="check" label={t('Accept all')} run={() => resolveAll(true)} close={close} />
          <Item icon="x" label={t('Reject all')} run={() => resolveAll(false)} close={close} />
        </>)} />}
        {threading
          ? <Tool name={t('Comments')} icon="comment" on={showComments} run={() => setShowComments((x) => !x)} tip={t('Comments: add one on the words picked, answer and resolve them')}>{threads.threads.some((x) => !x.done) && <span className="sd-tool-n">{threads.threads.filter((x) => !x.done).length}</span>}</Tool>
          : comments.length > 0 && <Tool name={t('Comments')} icon="comment" on={showComments} run={() => setShowComments((x) => !x)} tip={t('{n} comments', { n: comments.length })}><span className="sd-tool-n">{comments.length}</span></Tool>}
        {!flow && <Tool name={t('Outline')} icon="outline" on={showOutline} run={() => setOutline(!showOutline)} tip={t('Outline: the headings, to go to')} />}
        <Tool name={t('Find and replace')} icon="search" on={!!finding} run={() => setFinding(finding ? null : 'find')} keys={['mod', 'f']} />
        <Drop name={t('File')} className="sd-wide-only" icon="printer" tip={t('Page setup, print, and a copy as Markdown')} disabled={exporting} panel={(close) => (<>
          <Item icon="page" label={t('Page setup…')} run={() => setSettingUp(true)} close={close} />
          <Item icon="printer" label={t('Print, or save as PDF')} keys={['mod', 'p']} run={print} close={close} />
          <div className="menu-sep" />
          <Item icon="code" label={t('Markdown copy, beside it')} run={toMarkdown} close={close} />
          <div className="menu-sep" />
          <Item icon="keyboard" label={t('Keyboard shortcuts')} keys={['mod', '/']} run={() => setHelp(true)} close={close} />
        </>)} />
        {!flow && <Drop name={t('Zoom')} className="sd-zoom-drop" text={`${Math.round(scale * 100)}%`} tip={t('Zoom')} panel={(close) => (<>
          <Item label={t('Fit')} on={zoom === 'fit'} run={() => setZoom('fit')} close={close} />
          {zooms.map((z) => <Item key={z} label={`${Math.round(z * 100)}%`} on={zoom === z} run={() => setZoom(z)} close={close} />)}
        </>)} />}
      </span>
    </div>
  )
  return (
    <div className={`sd-doc sd-word${flow ? ' flow' : ''}`} onKeyDown={(e) => { if (threading && !readOnly && (e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyM') { e.preventDefault(); comment(); return } onKeys(e) }}>
      <style>{css}</style>
      <div className="sd-doc-head">
        {toolbar}
        {linking != null && <LinkBar value={linking} setValue={setLinking} link={s.link} href={s.href} onSubmit={applyLink} onRemove={() => { c().extendMarkRange('link').unsetLink().run(); setLinking(null) }} onClose={() => { setLinking(null); editor.commands.focus() }} />}
        {finding && <FindBar editor={editor} replace={finding === 'replace'} onClose={() => setFinding(null)} />}
        <Said say={say} onClose={() => setSay(null)} onOpen={(path) => onOpen?.({ root: file.root, path })} />
      </div>
      <div className="sd-doc-main" ref={main}>
        {showOutline && <Outline editor={editor} headings={headings} onClose={() => setOutline(false)} />}
        <div className="sd-desk" ref={desk}>
          <div className="sd-sheet" style={{ zoom: scale !== 1 ? scale : undefined, ...(flow ? {} : { width: g.w, '--pg-l': `${g.left}px`, '--pg-r': `${g.right}px` }) }}>
            <EditorContent editor={editor} className="sd-page-host" />
          </div>
        </div>
        {showComments && (threading ? <Threads threads={threads} readOnly={readOnly} onComment={comment} onClose={() => setShowComments(false)} /> : <Comments editor={editor} comments={comments} onClose={() => setShowComments(false)} />)}
      </div>
      {!readOnly && <AskInPlace editor={editor} file={file} scroller={desk} hook={asking} selection={() => pickedOf(editor)} apply={(range, text, below) => { touched.current = true; putIn(editor, range, text, below, (a) => ({ ...a, x: null, pa: '' })) }} onComment={threading ? comment : null} />}
      {counting && <WordCount editor={editor} pages={flow ? null : pages.total} onClose={() => setCount(false)} />}
      {editingHf && <HfEditor which={editingHf} info={info} model={model} page={page} css={css} scope={scope} value={hf} onClose={() => setEditingHf(null)} onDone={(next) => { touched.current = true; setHf(next); hfRef.current = next; stamp.current++; setEditingHf(null); onDirty(true); again.current?.() }} />}
      {helping && <Shortcuts word onClose={() => { setHelp(false); editor.commands.focus() }} />}
      {settingUp && <PageSetup page={page} sections={(() => { let n = 1; editor.state.doc.forEach((b) => { if (b.attrs?.sect) n++ }); return n })()} onClose={() => { setSettingUp(false); editor.commands.focus() }} onDone={(next) => { touched.current = true; setPage(next); setSettingUp(false); onDirty(true); editor.commands.focus() }} />}
      {!readOnly && linking == null && <LinkBubble editor={editor} href={s.href} scroller={desk} onEdit={() => setLinking(s.href || '')} onRemove={() => c().extendMarkRange('link').unsetLink().run()} />}
      <WordKeys editor={editor} setStyle={setStyle} info={info} toggleList={toggleList} paras={paras} mark={mark} s={s} indent={indent} step={step} openLink={() => setLinking(s.href || '')} c={c} clear={clear} />
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

// A table: a grid to pick its size from; in one, what to add, take out or merge. width: the page's
// text width (a Word file), which a new table's columns share, as Word gives them.
function TableTool({ editor, c, on, width }) {
  const insert = (rows, cols) => {
    c().insertTable({ rows, cols, withHeaderRow: false }).run()
    if (!width) return
    const { state } = editor
    let at = null
    state.doc.nodesBetween(0, state.selection.from, (n, pos) => { if (n.type.name === 'table' && pos + n.nodeSize >= state.selection.from) at = pos })
    if (at == null) return
    const tr = state.tr
    const each = Math.floor(width / cols)
    state.doc.nodeAt(at).descendants((n, pos) => { if (n.type.name === 'tableCell') tr.setNodeMarkup(at + 1 + pos, null, { ...n.attrs, colwidth: [each] }); return n.type.name !== 'tableCell' })
    editor.view.dispatch(tr)
  }
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
          <button key={`${r}-${k}`} type="button" className={`sd-grid-cell${r < hover[0] && k < hover[1] ? ' on' : ''}`} aria-label={t('{rows} by {cols}', { rows: r + 1, cols: k + 1 })} onMouseEnter={() => setHover([r + 1, k + 1])} onFocus={() => setHover([r + 1, k + 1])} onMouseDown={(e) => e.preventDefault()} onClick={() => { insert(r + 1, k + 1); close() }} />
        )))}
      </div>
      <small className="muted">{hover[0] ? t('{rows} by {cols}', { rows: hover[0], cols: hover[1] }) : t('Pick its size')}</small>
    </div>
  )} />
}

// The shortcuts Word and Google Docs have that the editor doesn't by itself.
function WordKeys({ editor, setStyle, info, toggleList, paras, mark, s, indent, step, openLink, c, clear }) {
  useEffect(() => {
    const dom = editor.view.dom
    const key = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      const run = (fn) => { e.preventDefault(); e.stopPropagation(); fn() }
      if (e.altKey && /^Digit[0-6]$/.test(e.code)) { const n = Number(e.code.slice(5)); return run(() => setStyle(n === 0 ? info.styles.normal : info.headingStyle(n) || `Heading${n}`)) }
      if (e.shiftKey && e.code === 'Digit8') return run(() => toggleList('bullet'))
      if (e.shiftKey && e.code === 'Digit7') return run(() => toggleList('number'))
      if (e.shiftKey && e.code === 'Digit9') return run(() => toggleList('check'))
      // Google Docs' and Word's: strikethrough, and the text a size bigger or smaller (⇧⌘> and ⇧⌘<).
      if (e.shiftKey && !e.altKey && e.code === 'KeyX') return run(() => c().toggleStrike().run())
      if (e.shiftKey && !e.altKey && e.code === 'Period') return run(() => step(1))
      if (e.shiftKey && !e.altKey && e.code === 'Comma') return run(() => step(-1))
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
  }, [editor, setStyle, info, toggleList, paras, mark, s, indent, step, openLink, c, clear])
  return null
}

// Page setup, as Google Docs and Word have it: the paper's size and which way it's turned, and the
// margins, in inches where they're used and centimetres elsewhere. A document of several sections
// has the last one's set (the one its pages here are drawn at), as it says.
const PAPERS = [['Letter', 12240, 15840], ['Legal', 12240, 20160], ['A4', 11906, 16838], ['A5', 8391, 11906], ['A3', 16838, 23811], ['Executive', 10440, 15120], ['Tabloid', 15840, 24480]]
function PageSetup({ page, sections, onClose, onDone }) {
  const where = locale() || navigator.language || 'en-US'
  const inches = /-(US|LR|MM)\b/i.test(where) || where === 'en'
  const unit = inches ? 1440 : 567 // twips in an inch, in a centimetre
  const fmt = (tw) => String(Math.round((tw / unit) * 100) / 100)
  const landscape0 = page.w > page.h
  const [orient, setOrient] = useState(landscape0 ? 'landscape' : 'portrait')
  const short = Math.min(page.w, page.h), long = Math.max(page.w, page.h)
  const known = PAPERS.find(([, w, h]) => Math.abs(w - short) < 30 && Math.abs(h - long) < 30)
  const [paper, setPaper] = useState(known ? known[0] : 'custom')
  const [m, setM] = useState({ top: fmt(page.top), bottom: fmt(page.bottom), left: fmt(page.left), right: fmt(page.right) })
  const [err, setErr] = useState(null)
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const done = (e) => {
    e.preventDefault()
    const tw = {}
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const v = Number(String(m[side]).replace(',', '.'))
      if (!Number.isFinite(v) || v < 0) { setErr(t('A margin is a number, 0 or more')); return }
      tw[side] = Math.round(v * unit)
    }
    const p = PAPERS.find((x) => x[0] === paper)
    const [w0, h0] = p ? [p[1], p[2]] : [short, long]
    const [w, h] = orient === 'landscape' ? [h0, w0] : [w0, h0]
    if (tw.left + tw.right > w - 720 || tw.top + tw.bottom > h - 720) { setErr(t("The margins leave no room for the text: make them smaller")); return }
    onDone({ ...page, w, h, orient, ...tw })
  }
  const u = inches ? t('in') : t('cm')
  return createPortal(
    <div className="sd-modal" role="dialog" aria-label={t('Page setup')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="sd-count sd-page-setup" onSubmit={done}>
        <div className="sd-panel-head"><b>{t('Page setup')}</b><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button></div>
        <div className="sd-setup-body">
          <fieldset className="sd-setup-row"><legend className="muted small">{t('Orientation')}</legend>
            {[['portrait', t('Portrait')], ['landscape', t('Landscape')]].map(([v, label]) => <label key={v} className="sd-radio"><input type="radio" name="orient" value={v} checked={orient === v} onChange={() => setOrient(v)} /> {label}</label>)}
          </fieldset>
          <label className="sd-field"><span className="muted small">{t('Paper size')}</span>
            <select value={paper} onChange={(e) => setPaper(e.target.value)} aria-label={t('Paper size')}>
              {PAPERS.map(([n, w, h]) => <option key={n} value={n}>{n} ({inches ? `${fmt(w)} × ${fmt(h)} ${u}` : `${Math.round(w / 56.7)} × ${Math.round(h / 56.7)} mm`})</option>)}
              {!known && <option value="custom">{t('As it is ({w} × {h} {unit})', { w: fmt(short), h: fmt(long), unit: u })}</option>}
            </select>
          </label>
          <div className="sd-setup-margins">
            <span className="muted small">{t('Margins ({unit})', { unit: u })}</span>
            {[['top', t('Top')], ['bottom', t('Bottom')], ['left', t('Left')], ['right', t('Right')]].map(([side, label]) => (
              <label key={side} className="sd-field"><span className="small">{label}</span><input inputMode="decimal" value={m[side]} onChange={(e) => { setErr(null); setM({ ...m, [side]: e.target.value }) }} aria-label={t('{side} margin', { side: label })} /></label>
            ))}
          </div>
          {sections > 1 && <p className="muted small">{t('This document has {n} sections: this sets the last one, which its pages here are drawn at.', { n: sections })}</p>}
          {err && <p className="error-text small" role="alert">{err}</p>}
        </div>
        <div className="sd-ask-acts sd-setup-acts"><button type="submit" className="btn small primary"><Icon name="check" size={12} /> {t('OK')}</button><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button></div>
      </form>
    </div>,
    document.body,
  )
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
function HfEditor({ which, info, model, page, css, scope, value, onClose, onDone }) {
  const empty = { type: 'doc', content: [{ type: 'paragraph' }] }
  const head = useEditor({ extensions: wordExtensions(info), content: value.header || empty, editorProps: { attributes: { class: `sd-w ${scope} sd-hf-ed`, 'aria-label': t('Header') } } }, [])
  const foot = useEditor({ extensions: wordExtensions(info), content: value.footer || empty, editorProps: { attributes: { class: `sd-w ${scope} sd-hf-ed`, 'aria-label': t('Footer') } } }, [])
  useEffect(() => { (which === 'footer' ? foot : head)?.commands.focus('end') }, [head, foot, which])
  const hasText = (e) => !!e && (e.state.doc.textContent.trim() || (() => { let f = false; e.state.doc.descendants((n) => { if (n.type.name === 'xin' || n.type.name === 'image') f = true }); return f })())
  const done = () => {
    const out = (e, was) => (hasText(e) ? (was && JSON.stringify(e.getJSON()) === JSON.stringify(was) ? was : e.getJSON()) : was ? empty : null)
    onDone({ ...value, header: out(head, value.header), footer: out(foot, value.footer) })
  }
  const g = pageOf(page || model.page)
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
// Saved as Markdown, as written: so its toolbar has what Markdown has (headings, lists, checklists,
// quotes, code, links, tables), and no underline, colours, fonts or alignment.
// The Markdown editor's parts (a Word file's Markdown copy is made with them too). srcs: how a
// picture beside the file (images/chart.png, as Markdown names it) is shown, and named again.
// html: a table Markdown can't write (cells merged, no heading row) written as HTML, which Markdown
// keeps, rather than left out (for a Word file's Markdown copy).
// Markdown's list with checklist items among plain ones, split into runs of each (see mdExtensions).
function splitMixedLists(el) {
  for (const list of [...el.querySelectorAll('.contains-task-list')]) {
    const runs = []
    for (const li of [...list.children]) {
      const task = li.classList.contains('task-list-item')
      if (runs.at(-1)?.task === task) runs.at(-1).items.push(li)
      else runs.push({ task, items: [li] })
    }
    if (runs.length < 2) continue
    let n = Number(list.getAttribute('start')) || 1
    list.replaceWith(...runs.map(({ task, items }) => {
      const part = list.ownerDocument.createElement(task ? 'ul' : list.tagName)
      if (task) { part.className = 'contains-task-list'; part.setAttribute('data-type', 'taskList') } else if (list.tagName === 'OL' && n !== 1) part.setAttribute('start', String(n))
      n += items.length
      part.append(...items)
      return part
    }))
  }
}
function mdExtensions(srcs = null, { html = false } = {}) {
  // A picture is a block of its own: written on its own line, so what comes next isn't run into it.
  const block = { markdown: { serialize(state, node) { state.write(`![${state.esc(node.attrs.alt || '')}](${String(node.attrs.src || '').replace(/[()]/g, '\\$&').replace(/\s/g, '%20')}${node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ''})`); state.closeBlock(node) }, parse: {} } }
  const Picture = Image.extend({
    addStorage: () => block,
    ...(srcs ? {
      addAttributes() { return { ...this.parent?.(), src: { default: null, parseHTML: (el) => srcs.back(el.getAttribute('src')) } } },
      renderHTML({ HTMLAttributes }) { return ['img', { ...HTMLAttributes, src: srcs.show(HTMLAttributes.src) }] },
    } : {}),
  })
  // Strikethrough also as Google Docs and Word have it (⇧⌘X); a checklist written tight, as the
  // other lists are (- [ ] one line after another).
  // A list with checklist items among plain ones ("- Renewal" then "- [ ] Send the doc"), as Markdown
  // reads one: its plain items a plain list and its checklist items a checklist, one after the other.
  // Left as one checklist, each plain item became an empty box with the item under it, and was saved
  // so (and a numbered one lost its number).
  const Keys = Extension.create({
    name: 'mdKeys',
    addKeyboardShortcuts: () => ({ 'Mod-Shift-x': ({ editor }) => editor.commands.toggleStrike() }),
    addGlobalAttributes: () => [{ types: ['taskList'], attributes: { tight: { default: true, parseHTML: (el) => el.getAttribute('data-tight') === 'true' || !el.querySelector('p'), renderHTML: (a) => (a.tight ? { 'data-tight': 'true' } : {}) } } }],
    addStorage: () => ({ markdown: { parse: { updateDOM: splitMixedLists } } }),
  })
  // ...and written back as one list again: a plain list and a checklist that follow each other, both
  // tight, with no blank line between them (which would make them one loose list).
  const together = (a, b) => !!a && a.attrs?.tight !== false && b.attrs?.tight !== false && ((a.type.name === 'bulletList' && b.type.name === 'taskList') || (a.type.name === 'taskList' && b.type.name === 'bulletList'))
  const asOne = (node) => node.extend({
    addStorage() {
      return { ...this.parent?.(), markdown: { serialize(state, n) { if (together(state.closed, n)) state.flushClose(1); state.renderList(n, '  ', () => '- ') } } }
    },
  })
  return [
    // A link is followed from its bubble or the link bar (Open), not by a click while you write.
    StarterKit.configure({ link: { openOnClick: false, enableClickSelection: true, defaultProtocol: 'https' }, underline: false, bulletList: false }),
    asOne(BulletList),
    Picture.configure({ allowBase64: true }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
    asOne(TaskList), TaskItem.configure({ nested: true }), Keys,
    Markdown.configure({ html, tightLists: true, linkify: true }),
  ]
}
function MarkdownDoc({ file, text, onDirty, onStats, handle, readOnly, onOpen }) {
  const { touched, handlers } = useTouched()
  const desk = useRef(null)
  const [say, setSay] = useState(null)
  const plugins = useMemo(() => Extension.create({ name: 'mdView', addProseMirrorPlugins: () => [findPlugin()] }), [])
  // Its pictures beside it (images/…), shown from its folder; named as the Markdown names them.
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''
  const srcs = useMemo(() => {
    const at = rawUrl({ root: file.root, path: dir })
    return {
      show: (src) => {
        if (!src || /^(https?:|data:|blob:|\/|#)/i.test(src)) return src
        let rel = src
        try { rel = decodeURIComponent(src) } catch { /* as written */ }
        return rawUrl({ root: file.root, path: `${dir}${rel}` })
      },
      back: (src) => {
        if (!src?.startsWith(at)) return src
        try { return decodeURIComponent(new URL(src, window.location.href).searchParams.get('path') || '').slice(dir.length) || src } catch { return src }
      },
    }
  }, [file.root, dir])
  const own = useRef({})
  const editor = useEditor({
    extensions: [...mdExtensions(srcs), plugins],
    content: text,
    editable: !readOnly,
    editorProps: {
      handleDOMEvents: handlers,
      attributes: { 'aria-label': t('The document'), class: 'sd-md' },
      transformPastedHTML: (html) => cleanPaste(html, { paras: false }),
      handlePaste: (view, e) => own.current.paste?.(view, e) || false,
      handleDrop: (view, e, slice, moved) => (!moved && own.current.drop?.(view, e)) || false,
    },
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
  const printRef = useRef(null)
  const [helping, setHelp] = useState(false)
  const onKeys = useFindKeys(setFinding, setCount, () => printRef.current?.(), setHelp)
  const levelOf = useCallback((n) => (n.type.name === 'heading' ? n.attrs.level - 1 : null), [])
  const headings = useHeadings(editor, levelOf)
  const [main, mainW] = useWidth()
  const [outline, setOutline] = usePane('outline', true)
  const showOutline = outline && mainW > 1000
  const [linking, setLinking] = useState(null)
  const [exporting, setExporting] = useState(false)
  const picker = useRef(null)
  const asking = useRef(null) // AskInPlace's, for AI Assist in the page's header
  handle.current = {
    assist: () => (readOnly ? [] : askItems(asking)),
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
        bulletList: e.isActive('bulletList'), orderedList: e.isActive('orderedList'), taskList: e.isActive('taskList'), blockquote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'),
        link: e.isActive('link'), href: e.getAttributes('link').href || '', table: e.isActive('table'),
        undo: e.can().undo(), redo: e.can().redo(),
      }
    },
  })
  if (!editor || !s) return null
  const c = () => { touched.current = true; return editor.chain().focus() }
  // A picture pasted or dropped in: saved beside the file (in images, as a deck's are), and named
  // in the Markdown by where it is from the file.
  const putPictures = async (files, at = null) => {
    for (const f of files) {
      if (!/^image\//.test(f.type)) { setSay({ text: t("{name} isn't a picture: only pictures go in a document.", { name: f.name || t('That') }), error: true }); continue }
      try {
        const pic = await pictureOf(f)
        const d = partsOfData(pic.src)
        const r = await api('/studio/picture', { method: 'POST', body: { root: file.root, path: file.path, name: f.name && !/^image\.\w+$/.test(f.name) ? f.name.replace(/\.[^.]+$/, `.${EXT[d.mime] || 'png'}`) : `picture.${EXT[d.mime] || 'png'}`, data: d.data } })
        touched.current = true
        const node = editor.schema.nodes.image.create({ src: r.src, alt: null })
        const tr = editor.state.tr
        if (at != null) tr.insert(Math.min(at, tr.doc.content.size), node); else tr.replaceSelectionWith(node)
        editor.view.dispatch(tr.scrollIntoView())
        at = null
      } catch (e) { setSay({ text: t("Couldn't put the picture in: {error}", { error: e.message }), error: true }) }
    }
  }
  own.current = {
    paste: (view, e) => { const files = filesIn(e.clipboardData); if (!files.length || wordsIn(e.clipboardData)) return false; e.preventDefault(); putPictures(files); return true },
    drop: (view, e) => { const files = filesIn(e.dataTransfer); if (!files.length) return false; e.preventDefault(); putPictures(files, view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null); return true },
  }
  // Printed on a page of its own (Save as PDF is in the browser's Print).
  const print = () => {
    const dom = editor.view.dom.cloneNode(true)
    dom.removeAttribute('contenteditable')
    printPage({ title: file.name, html: `<main class="md">${dom.innerHTML}</main>`, css: MD_PRINT })
  }
  printRef.current = print
  // A Word copy beside it, with its pictures in it.
  const toWord = async () => {
    setExporting(true); setSay(null)
    try {
      const json = editor.getJSON()
      let missing = 0
      const walk = async (n) => {
        if (n.type === 'image' && n.attrs?.src && !/^data:image\/(png|jpe?g|gif)/.test(n.attrs.src)) {
          try {
            const r = await fetch(srcs.show(n.attrs.src), { credentials: 'same-origin' })
            if (!r.ok) throw new Error(String(r.status))
            const blob = await r.blob()
            const pic = await pictureOf(new File([blob], 'picture', { type: blob.type || 'image/png' }))
            n.attrs = { ...n.attrs, src: pic.src, width: n.attrs.width || Math.min(600, pic.w), height: n.attrs.height || Math.round(pic.h * (Math.min(600, pic.w) / pic.w)) }
          } catch { missing++ }
        }
        for (const k of n.content || []) await walk(k)
      }
      await walk(json)
      const { docxOf } = await import('../docx.js')
      const bytes = await docxOf(json)
      const base = file.name.replace(/\.[^.]+$/, '')
      const r = await api('/studio/new', { method: 'POST', body: { root: file.root, dir: dir.replace(/\/$/, ''), name: `${base}.docx`, data: base64(bytes) } })
      const lost = missing === 1 ? t("A picture couldn't be read, so it isn't in it.") : missing ? t("{n} pictures couldn't be read, so they aren't in it.", { n: missing }) : ''
      setSay({ text: `${t('Saved as {name}, beside it.', { name: r.name })}${lost ? ` ${lost}` : ''}`, open: r.path, error: !!missing })
    } catch (e) { setSay({ text: t("Couldn't make the Word copy: {error}", { error: e.message }), error: true }) } finally { setExporting(false) }
  }
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
            <div className="sd-tools-main">
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
              <Tool name={t('Strikethrough')} icon="strike" run={() => c().toggleStrike().run()} on={s.strike} keys={['mod', 'shift', 'x']} />
              <Tool name={t('Inline code')} icon="code" run={() => c().toggleCode().run()} on={s.code} keys={['mod', 'e']} />
            </span>
            <span className="sd-group">
              <Tool name={t('Bulleted list')} icon="list" run={() => c().toggleBulletList().run()} on={s.bulletList} keys={['mod', 'shift', '8']} />
              <Tool name={t('Numbered list')} icon="list-ordered" run={() => c().toggleOrderedList().run()} on={s.orderedList} keys={['mod', 'shift', '7']} />
              <Tool name={t('Checklist')} icon="checklist" run={() => c().toggleTaskList().run()} on={s.taskList} keys={['mod', 'shift', '9']} />
              <Tool name={t('Quote')} icon="quote" run={() => c().toggleBlockquote().run()} on={s.blockquote} keys={['mod', 'shift', 'b']} />
              <Tool name={t('Code block')} icon="code-block" run={() => c().toggleCodeBlock().run()} on={s.codeBlock} keys={['mod', 'alt', 'c']} />
            </span>
            <span className="sd-group">
              <Tool name={t('Insert link')} icon="link" run={() => setLinking(linking == null ? s.href || '' : null)} on={s.link || linking != null} tip={s.link ? t('Link: change it, open it or remove it') : t('Insert link')} keys={['mod', 'k']} />
              <Tool name={t('Insert picture')} icon="image" run={() => picker.current?.click()} tip={t('Insert a picture: or paste one, or drop it on the page')} />
              <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) putPictures([f]) }} />
              <TableTool editor={editor} c={c} on={s.table} />
            </span>
            </div>
            <span className="sd-group sd-view-tools">
              <Tool name={t('Outline')} icon="outline" on={showOutline} run={() => setOutline(!showOutline)} tip={t('Outline: the headings, to go to')} />
              <Tool name={t('Find and replace')} icon="search" on={!!finding} run={() => setFinding(finding ? null : 'find')} keys={['mod', 'f']} />
              <Drop name={t('File')} className="sd-wide-only" icon="printer" tip={t('Print, and a copy as a Word file')} disabled={exporting} panel={(close) => (<>
                <Item icon="printer" label={t('Print, or save as PDF')} keys={['mod', 'p']} run={print} close={close} />
                <div className="menu-sep" />
                <Item icon="doc" label={t('Word copy, beside it')} run={toWord} close={close} />
                <div className="menu-sep" />
                <Item icon="keyboard" label={t('Keyboard shortcuts')} keys={['mod', '/']} run={() => setHelp(true)} close={close} />
              </>)} />
            </span>
          </div>
        )}
        {linking != null && <LinkBar value={linking} setValue={setLinking} link={s.link} href={s.href} onSubmit={applyLink} onRemove={() => { c().extendMarkRange('link').unsetLink().run(); setLinking(null) }} onClose={() => { setLinking(null); editor.commands.focus() }} />}
        {finding && <FindBar editor={editor} replace={finding === 'replace'} onClose={() => setFinding(null)} />}
        <Said say={say} onClose={() => setSay(null)} onOpen={(path) => onOpen?.({ root: file.root, path })} />
      </div>
      <div className="sd-doc-main" ref={main}>
        {showOutline && <Outline editor={editor} headings={headings} onClose={() => setOutline(false)} />}
        <div className="sd-desk md" ref={desk}>
          <EditorContent editor={editor} className="sd-page md" style={{ '--sd-ph': JSON.stringify(t('Write here…')) }} />
        </div>
      </div>
      {!readOnly && <AskInPlace editor={editor} file={file} scroller={desk} hook={asking} selection={() => pickedOf(editor)} apply={(range, txt, below) => { touched.current = true; putIn(editor, range, txt, below, () => undefined) }} />}
      {counting && <WordCount editor={editor} pages={null} onClose={() => setCount(false)} />}
      {helping && <Shortcuts word={false} onClose={() => { setHelp(false); editor.commands.focus() }} />}
      {!readOnly && linking == null && <LinkBubble editor={editor} href={s.href} scroller={desk} onEdit={() => setLinking(s.href || '')} onRemove={() => c().extendMarkRange('link').unsetLink().run()} />}
      <MdKeys editor={editor} openLink={() => setLinking(s.href || '')} />
    </div>
  )
}
// ⌘K opens the link bar, as in a Word file.
function MdKeys({ editor, openLink }) {
  useEffect(() => {
    const dom = editor.view.dom
    const key = (e) => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); openLink() } }
    dom.addEventListener('keydown', key, true)
    return () => dom.removeEventListener('keydown', key, true)
  }, [editor, openLink])
  return null
}
// A Markdown file on paper.
const MD_PRINT = `body{font:11pt/1.55 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111}main{max-width:none}
h1{font-size:2em;margin:.6em 0 .4em}h2{font-size:1.5em;margin:.8em 0 .4em}h3{font-size:1.2em;margin:.8em 0 .3em}p{margin:.5em 0}
code{font:.92em Menlo,Consolas,monospace;background:#f2f2f2;padding:0 .2em;border-radius:3px}pre{background:#f5f5f5;padding:.8em;border-radius:4px;white-space:pre-wrap}pre code{background:none;padding:0}
blockquote{margin:.6em 0;padding-left:1em;border-left:3px solid #ccc;color:#444}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px;vertical-align:top}th{background:#f3f3f3}
ul[data-type=taskList]{list-style:none;padding-left:.4em}ul[data-type=taskList] li{display:flex;gap:.5em}ul[data-type=taskList] li>label{flex:none}ul[data-type=taskList] li>div{flex:1}a{color:#0b57d0}`
