import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'
import { withKeys } from './keys.js'
import { find, findKey } from './search.js'
import { lineDiff } from './diff.js'

// What a document's editor is made of besides the page: its toolbar's pieces (a button, a menu, a
// colour picker), find and replace, the outline, the word count, and asking for a change in place.

// ---------- Icons ----------
// The document tools' own, drawn like the app's (components/Icon.jsx), which has the rest.
const GLYPH = {
  'align-left': <path d="M4 6h16M4 12h10M4 18h14" />,
  'align-center': <path d="M4 6h16M7 12h10M5 18h14" />,
  'align-right': <path d="M4 6h16M10 12h10M6 18h14" />,
  'align-justify': <path d="M4 6h16M4 12h16M4 18h16" />,
  'line-spacing': <><path d="M11 6h10M11 12h10M11 18h10" /><path d="m3 8 3-3 3 3M3 16l3 3 3-3M6 5v14" /></>,
  indent: <><path d="M10 6h11M10 12h11M10 18h11" /><path d="m3 9 3 3-3 3" /></>,
  outdent: <><path d="M10 6h11M10 12h11M10 18h11" /><path d="m6 9-3 3 3 3" /></>,
  superscript: <><path d="m4 19 8-11M4 8l8 11" /><path d="M20 10h-4c0-1.5.44-2 1.5-2.5S20 6.33 20 5c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07" /></>,
  subscript: <><path d="m4 5 8 11M4 16l8-11" /><path d="M20 21h-4c0-1.5.44-2 1.5-2.5S20 17.33 20 16c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07" /></>,
  'text-color': <><path d="m6 16 6-12 6 12" /><path d="M8 12h8" /></>,
  highlighter: <><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></>,
  eraser: <><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21" /><path d="M22 21H7M5 11l9 9" /></>,
  'page-break': <><path d="M5 9V4h14v5M5 15v5h14v-5" /><path d="M3 12h2M8 12h2M14 12h2M19 12h2" /></>,
  'header-footer': <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 8h18M3 16h18" /></>,
  outline: <><path d="M3 5h12M7 12h14M7 19h14" /><path d="M3 12v7" /></>,
  comment: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  changes: <><path d="M12 3v14M5 10h14" /><path d="M5 21h14" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  replace: <><path d="M14 4h6v6" /><path d="M20 4 13 11" /><path d="M10 20H4v-6" /><path d="m4 20 7-7" /></>,
  'case': <><path d="m3 15 4-8 4 8M4.5 12h5" /><path d="M14 11.5a2.5 2.5 0 1 1 5 0V15M19 13a2.5 2.5 0 1 1-5 1.5" /></>,
  zoom: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M8 11h6M11 8v6" /></>,
  font: <><path d="M4 7V5h16v2M9 19h6M12 5v14" /></>,
  'size-up': <><path d="m3 18 5-12 5 12M4.7 14h6.6" /><path d="M18 6v6M15 9h6" /></>,
  'size-down': <><path d="m3 18 5-12 5 12M4.7 14h6.6" /><path d="M15 9h6" /></>,
  words: <><path d="M4 7h16M4 12h10M4 17h7" /><path d="M17 14v6M14 17h6" /></>,
  style: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /></>,
  checklist: <><rect x="3" y="4" width="6" height="6" rx="1" /><path d="m4.5 7 1 1 2-2" /><rect x="3" y="14" width="6" height="6" rx="1" /><path d="M13 7h8M13 17h8" /></>,
  printer: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
  page: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
}
export function Glyph({ name, size = 16 }) {
  if (!GLYPH[name]) return <Icon name={name} size={size} />
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPH[name]}</svg>
}

// ---------- A button, a menu ----------
// A press keeps the cursor where it was in the document.
const keepFocus = (e) => { if (!e.target.closest('input, textarea, select')) e.preventDefault() }
export function Tool({ name, icon, run, on, keys = [], tip, disabled, children, className = '', ...more }) {
  return (
    <button type="button" className={`sd-tool${on ? ' on' : ''}${children ? ' wide' : ''} ${className}`} onMouseDown={keepFocus} onClick={run} title={withKeys(tip || name, ...keys)} aria-label={name} {...(on !== undefined ? { 'aria-pressed': !!on } : {})} disabled={disabled} {...more}>
      {icon && <Glyph name={icon} size={16} />}{children}
    </button>
  )
}
// A menu under a toolbar button: a click outside, Escape or picking something closes it.
// panel(close): what's in it.
export function Drop({ name, tip, icon, text, panel, disabled, className = '', wide = false, swatch, keys = [] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return undefined
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [open])
  return (
    <span className={`menu-anchor sd-drop-wrap ${className}`} ref={ref}>
      <button type="button" className={`sd-tool sd-drop-btn${text != null ? ' has-text' : ''}${open ? ' on' : ''}`} onMouseDown={keepFocus} onClick={() => setOpen((x) => !x)} title={withKeys(tip || name, ...keys)} aria-label={name} aria-haspopup="menu" aria-expanded={open} disabled={disabled}>
        {icon && <Glyph name={icon} size={16} />}
        {text != null && <span className="sd-drop-text">{text}</span>}
        {swatch !== undefined && <i className="sd-swatch-bar" style={{ background: swatch || 'transparent' }} />}
        <Glyph name="chevron-down" size={12} />
      </button>
      {open && <div className={`sd-drop${wide ? ' wide' : ''}`} role="menu" aria-label={name} onMouseDown={keepFocus}>{panel(close)}</div>}
    </span>
  )
}
export function Item({ label, hint, icon, on, run, close, danger, style, keys = [], disabled }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={!!on} className={`sd-item${on ? ' on' : ''}${danger ? ' danger' : ''}`} onMouseDown={keepFocus} onClick={() => { run(); close?.() }} disabled={disabled}>
      {icon !== undefined && <span className="sd-item-ic">{icon ? <Glyph name={icon} size={14} /> : null}</span>}
      <span className="sd-item-label" style={style}>{label}</span>
      {hint && <small className="muted">{hint}</small>}
      {keys.length > 0 && <small className="sd-item-keys">{withKeys('', ...keys).replace(/^ \(|\)$/g, '')}</small>}
      {on && <Icon name="check" size={13} />}
    </button>
  )
}

// ---------- Colours ----------
// Text colours, as Word and Google Docs offer them: greys, then a row of colours and their tints.
const GREYS = ['000000', '434343', '666666', '999999', 'B7B7B7', 'CCCCCC', 'D9D9D9', 'EFEFEF', 'F3F3F3', 'FFFFFF']
const HUES = ['980000', 'FF0000', 'FF9900', 'FFFF00', '00FF00', '00FFFF', '4A86E8', '0000FF', '9900FF', 'FF00FF']
const DARK = ['85200C', 'CC0000', 'E69138', 'F1C232', '6AA84F', '45818E', '3C78D8', '3D85C6', '674EA7', 'A64D79']
const LIGHT = ['E6B8AF', 'F4CCCC', 'FCE5CD', 'FFF2CC', 'D9EAD3', 'D0E0E3', 'C9DAF8', 'CFE2F3', 'D9D2E9', 'EAD1DC']
export function Swatches({ value, onPick, auto, close }) {
  const cell = (c) => <button key={c} type="button" className={`sd-sw${value === c ? ' on' : ''}`} style={{ background: `#${c}` }} title={`#${c}`} aria-label={`#${c}`} onMouseDown={keepFocus} onClick={() => { onPick(c); close() }} />
  return (
    <div className="sd-swatches">
      <button type="button" className="sd-item" onMouseDown={keepFocus} onClick={() => { onPick(null); close() }}><span className="sd-sw none" />{auto}</button>
      <div className="sd-sw-grid">{[...GREYS, ...HUES, ...DARK, ...LIGHT].map(cell)}</div>
    </div>
  )
}
// Word's highlight colours (a Word file keeps these by name).
const MARKERS = ['yellow', 'green', 'cyan', 'magenta', 'blue', 'red', 'darkBlue', 'darkCyan', 'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'darkGray', 'lightGray', 'black']
const MARKER_HEX = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000' }
export function Markers({ value, onPick, close }) {
  return (
    <div className="sd-swatches">
      <button type="button" className="sd-item" onMouseDown={keepFocus} onClick={() => { onPick(null); close() }}><span className="sd-sw none" />{t('No highlight')}</button>
      <div className="sd-sw-grid five">{MARKERS.map((c) => <button key={c} type="button" className={`sd-sw${value === c ? ' on' : ''}`} style={{ background: `#${MARKER_HEX[c]}` }} title={c} aria-label={c} onMouseDown={keepFocus} onClick={() => { onPick(c); close() }} />)}</div>
    </div>
  )
}
export const markerCss = (c) => (!c ? null : c.startsWith('#') ? c : MARKER_HEX[c] ? `#${MARKER_HEX[c]}` : null)

// ---------- Fonts ----------
// Whether this computer has a font: text in it measures differently from the fallback's.
const hasCache = new Map()
export function fontHere(name) {
  if (hasCache.has(name)) return hasCache.get(name)
  let yes = true
  try {
    const c = document.createElement('canvas').getContext('2d')
    const s = 'mmmmmmmmmlli1WQ@#'
    yes = ['monospace', 'serif', 'sans-serif'].some((b) => { c.font = `72px ${b}`; const w0 = c.measureText(s).width; c.font = `72px '${name.replace(/'/g, '')}', ${b}`; return c.measureText(s).width !== w0 })
  } catch { /* said to be here */ }
  hasCache.set(name, yes)
  return yes
}
export const COMMON_FONTS = ['Aptos', 'Arial', 'Calibri', 'Cambria', 'Courier New', 'Garamond', 'Georgia', 'Helvetica', 'Times New Roman', 'Verdana']
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]

// ---------- Find and replace ----------
export function FindBar({ editor, replace: withReplace, onClose }) {
  const [q, setQ] = useState(() => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ').slice(0, 100))
  const [r, setR] = useState('')
  const [matchCase, setCase] = useState(false)
  const [showReplace, setShowReplace] = useState(withReplace)
  const [said, setSaid] = useState(null)
  const input = useRef(null)
  const [, tick] = useState(0)
  useEffect(() => { setShowReplace(withReplace || showReplace) }, [withReplace]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { find.set(editor, { q, matchCase }); setSaid(null) }, [editor, q, matchCase])
  useEffect(() => { const up = () => tick((n) => n + 1); editor.on('transaction', up); return () => { editor.off('transaction', up); find.set(editor, { q: '' }) } }, [editor])
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  const s = findKey.getState(editor.state) || { list: [], index: -1 }
  const close = () => { find.set(editor, { q: '' }); onClose(); editor.commands.focus() }
  // ⌘G and ⇧⌘G go to the next match and the one before, in the box or on the page while it's open.
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'g') { e.preventDefault(); e.stopPropagation(); find.step(editor, e.shiftKey ? -1 : 1) } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [editor])
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    if (e.key === 'Enter') { e.preventDefault(); find.step(editor, e.shiftKey ? -1 : 1) }
  }
  const count = q ? (s.list.length ? t('{n} of {total}', { n: s.index + 1, total: s.list.length }) : t('No matches')) : ''
  return (
    <div className="sd-findbar" role="search" aria-label={t('Find and replace')}>
      <div className="sd-find-row">
        <Icon name="search" size={13} />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder={t('Find in the document')} aria-label={t('Find')} spellCheck={false} />
        <span className="sd-find-count muted small" aria-live="polite">{count}</span>
        <Tool name={t('Match case')} icon="case" on={matchCase} run={() => setCase((x) => !x)} />
        <Tool name={t('Previous match')} icon="up" run={() => find.step(editor, -1)} disabled={!s.list.length} keys={['mod', 'shift', 'g']} />
        <Tool name={t('Next match')} icon="down" run={() => find.step(editor, 1)} disabled={!s.list.length} keys={['mod', 'g']} />
        <Tool name={t('Replace')} icon="replace" on={showReplace} run={() => setShowReplace((x) => !x)} tip={t('Show replace')} />
        <button type="button" className="win-btn" onClick={close} aria-label={t('Close')} title={t('Close (Esc)')}><Icon name="x" size={13} /></button>
      </div>
      {showReplace && (
        <div className="sd-find-row">
          <Glyph name="replace" size={13} />
          <input value={r} onChange={(e) => setR(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close() } if (e.key === 'Enter') { e.preventDefault(); find.replace(editor, r) } }} placeholder={t('Replace with')} aria-label={t('Replace with')} spellCheck={false} />
          <button type="button" className="btn small" onMouseDown={keepFocus} onClick={() => find.replace(editor, r)} disabled={!s.list.length}>{t('Replace')}</button>
          <button type="button" className="btn small" onMouseDown={keepFocus} onClick={() => { const n = find.all(editor, r); setSaid(n === 1 ? t('Replaced 1') : t('Replaced {n}', { n })) }} disabled={!s.list.length}>{t('Replace all')}</button>
          {said && <span className="muted small" role="status">{said}</span>}
        </div>
      )}
    </div>
  )
}

// ---------- The outline ----------
// The document's headings, a level each indented; the one you're in marked; a tap goes there.
export function useHeadings(editor, levelOf) {
  const [list, setList] = useState([])
  useEffect(() => {
    if (!editor) return undefined
    let id = null
    const read = () => {
      const out = []
      editor.state.doc.descendants((n, pos) => {
        if (!n.isTextblock) return true
        const level = levelOf(n)
        if (level != null && n.textContent.trim()) out.push({ pos, level, text: n.textContent.trim().slice(0, 120) })
        return false
      })
      setList((was) => (JSON.stringify(was) === JSON.stringify(out) ? was : out))
    }
    read()
    const later = () => { clearTimeout(id); id = setTimeout(read, 300) }
    editor.on('update', later)
    return () => { clearTimeout(id); editor.off('update', later) }
  }, [editor, levelOf])
  return list
}
export function Outline({ editor, headings, onClose }) {
  const [at, setAt] = useState(0)
  useEffect(() => {
    const up = () => setAt(editor.state.selection.from)
    editor.on('selectionUpdate', up)
    return () => editor.off('selectionUpdate', up)
  }, [editor])
  const current = headings.filter((h) => h.pos <= at).pop()
  const min = Math.min(...headings.map((h) => h.level), 9)
  const go = (h) => {
    editor.chain().focus().setTextSelection(h.pos + 1).run()
    const el = editor.view.nodeDOM(h.pos)
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return (
    <aside className="sd-outline-pane" aria-label={t('Outline')}>
      <div className="sd-pane-head"><b>{t('Outline')}</b><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close the outline')} title={t('Close the outline')}><Icon name="x" size={13} /></button></div>
      {!headings.length ? <p className="muted small sd-pane-none">{t('Headings you add show here, to go to.')}</p> : (
        <ol className="sd-outline-list">
          {headings.map((h) => (
            <li key={h.pos}><button type="button" className={`sd-outline-item${current === h ? ' on' : ''}`} style={{ paddingLeft: 10 + (h.level - min) * 14 }} onClick={() => go(h)} title={h.text}>{h.text}</button></li>
          ))}
        </ol>
      )}
    </aside>
  )
}

// ---------- Word count ----------
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(locale(), { granularity: 'word' }) : null
export function countWords(text) {
  let words = 0
  if (segmenter) for (const s of segmenter.segment(text)) { if (s.isWordLike) words++ } else words = text.match(/\S+/g)?.length || 0
  return words
}
export function counts(editor) {
  const doc = editor.state.doc
  const text = doc.textBetween(0, doc.content.size, '\n', ' ')
  let paragraphs = 0
  doc.descendants((n) => { if (n.isTextblock) { if (n.textContent.trim()) paragraphs++; return false } return true })
  const { from, to, empty } = editor.state.selection
  const picked = empty ? null : doc.textBetween(from, to, '\n', ' ')
  return { words: countWords(text), chars: text.replace(/\n/g, '').length, charsNoSpaces: text.replace(/\s/g, '').length, paragraphs, picked: picked ? countWords(picked) : null }
}
export function WordCount({ editor, pages, onClose }) {
  const c = useMemo(() => counts(editor), [editor])
  const n = (x) => x.toLocaleString(locale())
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return createPortal(
    <div className="sd-modal" role="dialog" aria-label={t('Word count')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sd-count">
        <div className="sd-panel-head"><b>{t('Word count')}</b><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button></div>
        <dl>
          {pages != null && <><dt>{t('Pages')}</dt><dd>{n(pages)}</dd></>}
          <dt>{t('Words')}</dt><dd>{n(c.words)}</dd>
          {c.picked != null && <><dt>{t('Words picked')}</dt><dd>{n(c.picked)}</dd></>}
          <dt>{t('Characters')}</dt><dd>{n(c.chars)}</dd>
          <dt>{t('Characters without spaces')}</dt><dd>{n(c.charsNoSpaces)}</dd>
          <dt>{t('Paragraphs')}</dt><dd>{n(c.paragraphs)}</dd>
          <dt>{t('Reading time')}</dt><dd>{c.words < 238 ? t('Under a minute') : t('{n} min', { n: Math.round(c.words / 238) })}</dd>
        </dl>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Keyboard shortcuts ----------
// The shortcuts a document has (⌘/ shows them, as in Google Docs), this computer's way (⌘ on a Mac,
// Ctrl elsewhere), and what's typed to start a list. word: a Word file's (fonts, alignment, pages).
const SHORTCUTS = (word) => [
  [tx('Text'), [
    [tx('Bold'), ['mod', 'b']], [tx('Italic'), ['mod', 'i']], ...(word ? [[tx('Underline'), ['mod', 'u']]] : []), [tx('Strikethrough'), ['mod', 'shift', 'x']],
    ...(word ? [[tx('Superscript'), ['mod', '.']], [tx('Subscript'), ['mod', ',']], [tx('Bigger text'), ['mod', 'shift', '>']], [tx('Smaller text'), ['mod', 'shift', '<']]] : [[tx('Inline code'), ['mod', 'e']]]),
    ...(word ? [[tx('Clear formatting'), ['mod', '\\']]] : []), [tx('Insert link'), ['mod', 'k']],
  ]],
  [tx('Paragraphs'), [
    [tx('Normal text'), ['mod', 'alt', '0']], [tx('Heading 1, 2 or 3'), ['mod', 'alt', '1–3']],
    [tx('Bulleted list'), ['mod', 'shift', '8']], [tx('Numbered list'), ['mod', 'shift', '7']], [tx('Checklist'), ['mod', 'shift', '9']],
    [tx('A list a level in, or out'), ['Tab'], ['shift', 'Tab']],
    ...(word ? [[tx('Left, center, right, justified'), ['mod', 'shift', 'L']], [tx('Increase or decrease indent'), ['mod', ']'], ['mod', '[']], [tx('Page break'), ['mod', '↩']]] : [[tx('Quote'), ['mod', 'shift', 'b']], [tx('Code block'), ['mod', 'alt', 'c']]]),
  ]],
  [tx('The document'), [
    [tx('Undo'), ['mod', 'z']], [tx('Redo'), ['mod', 'shift', 'z'], ['mod', 'y']], [tx('Select all'), ['mod', 'a']],
    [tx('Paste without formatting'), ['mod', 'shift', 'v']],
    [tx('Find'), ['mod', 'f']], [tx('Next or previous match'), ['mod', 'g'], ['mod', 'shift', 'g']], [tx('Find and replace'), ['mod', 'shift', 'h']],
    [tx('Word count'), ['mod', 'shift', 'c']], [tx('Print, or save as PDF'), ['mod', 'p']], [tx('Save now (it saves itself as you type)'), ['mod', 's']], [tx('Keyboard shortcuts'), ['mod', '/']],
  ]],
]
export function Shortcuts({ word, onClose }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const show = (k) => (k.length === 1 && !['mod', 'shift', 'alt'].includes(k[0]) ? k[0] : withKeys('', ...k).replace(/^ \(|\)$/g, '').replace('TAB', 'Tab'))
  return createPortal(
    <div className="sd-modal" role="dialog" aria-label={t('Keyboard shortcuts')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sd-count sd-shortcuts">
        <div className="sd-panel-head"><b>{t('Keyboard shortcuts')}</b><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button></div>
        <div className="sd-shortcuts-body">
          {SHORTCUTS(word).map(([group, rows]) => (
            <section key={group}>
              <h4>{t(group)}</h4>
              <dl>{rows.map(([label, ...ks]) => <div key={label}><dt>{t(label)}</dt><dd>{ks.map((k, i) => <kbd key={i}>{show(k)}</kbd>)}</dd></div>)}</dl>
            </section>
          ))}
          <p className="muted small">{t('Typed at the start of a line: "- " or "* " starts a bulleted list, "1. " a numbered one, "[] " a checklist. Backspace straight after takes it back.')}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Change it in place ----------
// Words picked, then Ask AI: rewrite, shorten, expand, fix, or what you say. The model's version is
// shown against yours (what goes struck out, what's new marked) until you take it, try again or
// leave it. The model is the one picked for Studio, else the one the app reaches first
// (server/studiofound.js), and said with the answer.
export const ASKS = [
  { id: 'rewrite', label: tx('Rewrite'), text: 'Rewrite this so it reads better. Keep what it says.' },
  { id: 'shorten', label: tx('Shorten'), text: 'Make this shorter. Keep what matters.' },
  { id: 'expand', label: tx('Make longer'), text: 'Expand this with a little more detail, in the same voice.' },
  { id: 'fix', label: tx('Fix spelling and grammar'), text: 'Fix the spelling and grammar. Change nothing else.' },
  { id: 'formal', label: tx('More formal'), text: 'Make this more formal.' },
  { id: 'plain', label: tx('Plainer'), text: 'Make this plainer and easier to read.' },
]
const TOKEN = /\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}]/gu
export function wordDiff(a, b) {
  const x = a.match(TOKEN) || [], y = b.match(TOKEN) || []
  const rows = lineDiff(x.join('\n'), y.join('\n'))
  const out = []
  for (const r of rows) { const last = out[out.length - 1]; if (last && last.t === r.t) last.s += r.line; else out.push({ t: r.t, s: r.line }) }
  return out
}

// selection(): { from, to, text, before, after } what's picked and around it; apply(range, text):
// the new words put in. Shown over the page, by the words picked.
export function AskInPlace({ editor, file, selection, apply, scroller }) {
  const [box, setBox] = useState(null) // where it's drawn: { left, top, bottom }
  const [menu, setMenu] = useState(false)
  const [own, setOwn] = useState('')
  const [job, setJob] = useState(null) // { range, text, instruction, label, busy, out, by, error, code }
  const [writer, setWriter] = useState(null) // the model that rewrites, and the others to pick from
  useEffect(() => { if (menu && !writer) api('/studio/writer').then(setWriter, () => setWriter({ model: null, models: [] })) }, [menu, writer])
  const pickModel = async (id) => {
    setWriter((w) => ({ ...w, model: w.models.find((m) => m.id === id) || null }))
    await api('/settings', { method: 'PATCH', body: { studio: { model: id } } }).catch(() => {})
  }
  const ref = useRef(null)
  const ctl = useRef(null)
  const place = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const r = job?.range || editor.state.selection
    if (!job && (editor.state.selection.empty || !editor.isFocused && !menu)) { setBox(null); return }
    try {
      const a = editor.view.coordsAtPos(r.from), b = editor.view.coordsAtPos(r.to)
      const host = scroller?.current?.getBoundingClientRect()
      const left = Math.max((host?.left ?? 0) + 8, Math.min(a.left, (host?.right ?? window.innerWidth) - 340))
      setBox({ left, top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) })
    } catch { setBox(null) }
  }, [editor, job, menu, scroller])
  useEffect(() => {
    if (!editor) return undefined
    const up = () => requestAnimationFrame(place)
    editor.on('selectionUpdate', up); editor.on('focus', up); editor.on('blur', up)
    const el = scroller?.current
    el?.addEventListener('scroll', up, { passive: true })
    window.addEventListener('resize', up)
    return () => { editor.off('selectionUpdate', up); editor.off('focus', up); editor.off('blur', up); el?.removeEventListener('scroll', up); window.removeEventListener('resize', up) }
  }, [editor, place, scroller])
  useLayoutEffect(place, [place])
  // The words asked about stay marked while their new version is shown.
  useEffect(() => {
    if (!editor) return undefined
    editor.view.dom.classList.toggle('sd-asking', !!job)
    return () => editor.view.dom.classList.remove('sd-asking')
  }, [editor, job])
  const ask = async (instruction, label) => {
    const s = selection()
    if (!s?.text.trim()) return
    setMenu(false)
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    const base = { range: { from: s.from, to: s.to }, text: s.text, instruction, label, busy: true }
    setJob(base)
    try {
      const r = await api('/studio/rewrite', { method: 'POST', body: { text: s.text, instruction, before: s.before, after: s.after, name: file?.name || '' }, signal: c.signal })
      if (!c.signal.aborted) setJob({ ...base, busy: false, out: r.text, by: r.by })
    } catch (e) {
      if (!c.signal.aborted) setJob({ ...base, busy: false, error: e.message, code: e.code || e.data?.code || null })
    }
  }
  const done = () => { ctl.current?.abort(); setJob(null); editor?.commands.focus() }
  const take = (below = false) => { apply(job.range, job.out, below); setJob(null) }
  useEffect(() => {
    if (!job) return undefined
    const k = (e) => { if (e.key === 'Escape') { e.preventDefault(); done() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  if (!editor || !box) return null
  const top = Math.max(8, box.top - 44)
  const diff = job?.out ? wordDiff(job.text, job.out) : null
  return createPortal(
    <div className="sd-ask-place" ref={ref} style={{ left: box.left, top: job ? Math.min(box.bottom + 8, window.innerHeight - 260) : top }} onMouseDown={(e) => { if (!e.target.closest('input, textarea, select')) e.preventDefault() }}>
      {!job && (
        <div className="sd-bubble" role="toolbar" aria-label={t('Picked words')}>
          <button type="button" className={`sd-bubble-ai${menu ? ' on' : ''}`} onClick={() => setMenu((x) => !x)} aria-expanded={menu} aria-haspopup="menu" title={t('Have AI change the words you picked')}><Icon name="sparkle" size={13} /> {t('Ask AI')}<Glyph name="chevron-down" size={11} /></button>
          {menu && (
            <div className="sd-drop sd-ask-menu" role="menu" aria-label={t('Ask AI')}>
              {ASKS.map((a) => <Item key={a.id} label={t(a.label)} run={() => ask(a.text, t(a.label))} />)}
              <form className="sd-ask-own" onSubmit={(e) => { e.preventDefault(); if (own.trim()) ask(own.trim(), own.trim()) }}>
                <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder={t('Or say how to change it…')} aria-label={t('How to change it')} />
                <button type="submit" className="btn small primary" disabled={!own.trim()} aria-label={t('Ask')} title={t('Ask')}><Icon name="send" size={12} /></button>
              </form>
              {writer?.models?.length > 0 && (
                <label className="sd-ask-model" title={t('The model that rewrites what you pick')}>
                  <span className="muted small">{t('Model')}</span>
                  <select value={writer.model?.id || ''} onChange={(e) => pickModel(e.target.value)}>
                    {!writer.model && <option value="">—</option>}
                    {writer.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.provider ? ` · ${m.provider}` : ''}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      )}
      {job && (
        <div className="sd-ask-card" role="dialog" aria-label={t('Suggested change')}>
          <div className="sd-ask-card-head"><Icon name="sparkle" size={13} /><b>{job.label}</b><span className="sd-grow" />{job.by && <small className="muted" title={t('The model that wrote it')}>{job.by}</small>}</div>
          {job.busy && <p className="sd-ask-busy muted small" role="status"><Icon name="refresh" size={12} className="spin" /> {t('Writing…')}</p>}
          {job.error && (
            <div className="sd-ask-err" role="alert">
              <p className="error-text small">{job.error}</p>
              {job.code === 'no-model' && <button type="button" className="link-btn small" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}>{t('Open Model Providers')}</button>}
            </div>
          )}
          {diff && <div className="sd-ask-diff" aria-label={t('The change')}>{diff.map((d, i) => (d.t === ' ' ? <span key={i}>{d.s}</span> : d.t === '-' ? <del key={i}>{d.s}</del> : <ins key={i}>{d.s}</ins>))}</div>}
          <div className="sd-ask-card-acts">
            {job.out && <button type="button" className="btn small primary" onClick={() => take(false)}><Icon name="check" size={12} /> {t('Replace')}</button>}
            {job.out && <button type="button" className="btn small" onClick={() => take(true)}>{t('Insert below')}</button>}
            {!job.busy && <button type="button" className="btn small" onClick={() => ask(job.instruction, job.label)}><Icon name="refresh" size={12} /> {t('Try again')}</button>}
            <button type="button" className="ghost-btn" onClick={done}>{job.busy ? t('Cancel') : t('Discard')}</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
