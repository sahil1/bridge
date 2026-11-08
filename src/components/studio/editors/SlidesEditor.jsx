import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api } from '../../../api.js'
import { t } from '../../../i18n/index.js'
import { base64 } from '../files.js'
import { keys, withKeys } from '../keys.js'
import * as P from '../pptxdoc.js'
import * as X from '../pptxtext.js'
import { slideHtml, SLIDE_CSS, paraAttrs, runCss, missingIn } from '../pptxdraw.js'
import { Item, Swatches, Glyph, COMMON_FONTS, SIZES, fontHere } from '../doctools.jsx'
import { Menu, Present, DeckFind, AiPanel, deckAssist, useSize } from './DeckParts.jsx'
import { deckRenderer, PLAIN } from '../deck.js'
import { slidesOf } from '../pptx.js'
import '../deck.css'
import '../doc.css'

// A PowerPoint, edited as itself: its slides down the side (added on its own layouts, duplicated,
// skipped, deleted, copied, picked together and dragged into order), the slide in the middle as
// PowerPoint draws it, and everything on it picked, moved, sized and turned with handles that snap
// to the slide and to each other; words typed right where they are, in their own fonts, sizes,
// colours, bullets and alignment; text boxes, shapes, lines, pictures and tables put in; speaker
// notes; find and replace; presenting. Saving writes only what changed (pptxdoc.js), so the file
// keeps its masters, layouts, charts and everything else Studio doesn't change.
export default function SlidesEditor(props) {
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { P.readPptx(props.data).then(setDoc, (e) => setErr(e.message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="sd-empty" role="alert"><Icon name="alert" size={20} /><b>{t("Couldn't read its slides: {error}", { error: err })}</b><span className="muted small">{t('Ask an agent to change it, or open it in PowerPoint or Keynote.')}</span></div>
  if (!doc) return <div className="sd-empty sd-loading" role="status"><Icon name="refresh" size={16} className="spin" /><span className="muted">{t('Opening {name}…', { name: props.file.name })}</span></div>
  return <Slides {...props} doc={doc} />
}

// What's copied: things on a slide, or slides; kept for this window, so a paste in another deck
// takes them too. text: what went on the system's clipboard with them.
let clip = null

// ---------- Icons the slides' toolbar has of its own ----------
const OWN = {
  'text-box': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 9h8M12 9v7" /></>,
  line: <path d="M5 19 19 5" />,
  crop: <><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>,
  fill: <><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" /><path d="M20 15s2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.5 2-3.5Z" /></>,
  border: <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2" />,
  arrange: <><rect x="3" y="3" width="11" height="11" rx="1" /><rect x="10" y="10" width="11" height="11" rx="1" /></>,
  'skip': <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><path d="m3 3 18 18" /></>,
}
const G = ({ name, size = 16 }) => (OWN[name] ? <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{OWN[name]}</svg> : <Glyph name={name} size={size} />)
// A press keeps the caret where it was in the words being typed.
const keep = (e) => { if (!e.target.closest('input, textarea, select')) e.preventDefault() }
function Btn({ name, icon, run, on, tip, k = [], disabled, label = false }) {
  return (
    <button type="button" className={`sd-tool${label ? ' wide' : ''}${on ? ' on' : ''}`} onMouseDown={keep} onClick={run} title={withKeys(tip || name, ...k)} aria-label={name} disabled={disabled} {...(on !== undefined ? { 'aria-pressed': !!on } : {})}>
      <G name={icon} size={16} />{label && <span className="sd-tool-label">{name}</span>}
    </button>
  )
}
// A toolbar button with a menu under it: panel(close) is what's in it.
function Pop({ name, icon, text, tip, k = [], disabled, wide, swatch, panel, label = false, className = '' }) {
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
      <button type="button" className={`sd-tool sd-drop-btn${text != null ? ' has-text' : ''}${label ? ' wide' : ''}${open ? ' on' : ''}`} onMouseDown={keep} onClick={() => setOpen((x) => !x)} title={withKeys(tip || name, ...k)} aria-label={name} aria-haspopup="menu" aria-expanded={open} disabled={disabled}>
        {icon && <G name={icon} size={16} />}
        {label && <span className="sd-tool-label">{name}</span>}
        {text != null && <span className="sd-drop-text">{text}</span>}
        {swatch !== undefined && <i className="sd-swatch-bar" style={{ background: swatch || 'transparent' }} />}
        <Glyph name="chevron-down" size={12} />
      </button>
      {open && <div className={`sd-drop${wide ? ' wide' : ''}`} role="menu" aria-label={name} onMouseDown={keep}>{panel(close)}</div>}
    </span>
  )
}

// ---------- Words being typed ----------
// The editable copy of a shape's words: each paragraph a <p>, each run a span named by where it
// is in the words as they were drawn (data-k "paragraph.run"), so what's typed is read back with
// each run's own XML.
function editHtml(view) {
  return view.paras.map((p, i) => {
    const a = paraAttrs(p, i, view.body)
    const runs = p.runs.some((r) => r.text || r.br) ? p.runs.map((r, j) => (r.br ? `<br data-k="${i}.${j}">` : `<span data-k="${i}.${j}" style="${runCss(r)}">${P.esc(r.text)}</span>`)).join('') + (p.runs.at(-1)?.br ? '<br data-x="">' : '') : '<br data-x="">'
    return `<p data-p="${i}" style="${a.style}"${a.bu}>${runs}</p>`
  }).join('')
}
const blocksOf = (root) => [...root.children].filter((el) => el.nodeType === 1)
// The words as typed, back into a text model, from the one they were drawn from (base).
function readBack(root, base) {
  const paras = []
  let lastP = 0
  for (const el of blocksOf(root)) {
    const pi = el.dataset?.p != null ? Number(el.dataset.p) : lastP
    lastP = pi
    const src = base.paras[pi] || base.paras.at(-1) || { pPr: '', runs: [], end: '' }
    const out = { pPr: src.pPr, runs: [], end: src.end }
    const runOf = (node) => {
      const k = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('[data-k]')
      if (!k || !el.contains(k)) return null
      const [a, b] = k.dataset.k.split('.').map(Number)
      return base.paras[a]?.runs[b] || null
    }
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          if (!n.nodeValue) continue
          const r = runOf(n)
          const rPr = r ? r.rPr : X.endRun(out.end)
          const last = out.runs.at(-1)
          const text = n.nodeValue.replace(/ /g, ' ').replace(/​/g, '')
          if (!text) continue
          if (last && !last.br && last.rPr === rPr && last.fld === r?.fld) last.text += text
          else out.runs.push(r?.fld ? { ...r, text } : { rPr, text })
        } else if (n.nodeName === 'BR') {
          if (n.hasAttribute('data-x')) continue
          const r = runOf(n) || out.runs.at(-1)
          out.runs.push({ rPr: r?.rPr || X.endRun(out.end), text: '', br: true })
        } else if (n.nodeType === 1) walk(n)
      }
    }
    walk(el)
    // A line break the browser leaves at the end is only there to show the empty line.
    if (out.runs.at(-1)?.br && out.runs.length > 1 && !el.querySelector('br[data-x]')) { /* kept: it was typed */ }
    paras.push(out)
  }
  return { ...base, paras: paras.length ? paras : [{ pPr: '', runs: [], end: base.paras[0]?.end || '' }] }
}
// Where a point in the words is: { p, o } (a line break counts one).
function pointOf(root, node, offset) {
  const blocks = blocksOf(root)
  let el = node.nodeType === 1 ? node : node.parentElement
  while (el && el.parentElement !== root) el = el.parentElement
  if (!el) return node === root ? (offset >= blocks.length ? { p: Math.max(0, blocks.length - 1), o: Infinity } : { p: offset, o: 0 }) : null
  const r = document.createRange()
  r.selectNodeContents(el)
  r.setEnd(node, offset)
  const f = r.cloneContents()
  let o = 0
  const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) o += c.nodeValue.replace(/​/g, '').length; else if (c.nodeName === 'BR') { if (!c.hasAttribute('data-x')) o++ } else walk(c) } }
  walk(f)
  return { p: blocks.indexOf(el), o }
}
function caretOf(root) {
  const s = window.getSelection?.()
  if (!s?.rangeCount || !root.contains(s.anchorNode)) return null
  const a = pointOf(root, s.anchorNode, s.anchorOffset), b = pointOf(root, s.focusNode, s.focusOffset)
  if (!a || !b) return null
  return { a, b }
}
function placeCaret(root, a, b = a) {
  const blocks = blocksOf(root)
  const find = (pt) => {
    const el = blocks[Math.max(0, Math.min(blocks.length - 1, pt.p))]
    if (!el) return [root, 0]
    let left = pt.o
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { const len = c.nodeValue.length; if (left <= len) return [c, left]; left -= len } else if (c.nodeName === 'BR') { if (c.hasAttribute('data-x')) continue; if (left === 0) return [c.parentNode, [...c.parentNode.childNodes].indexOf(c)]; left -= 1 } else { const x = walk(c); if (x) return x }
      }
      return null
    }
    return walk(el) || [el, el.childNodes.length && el.lastChild.nodeName === 'BR' ? el.childNodes.length - 1 : el.childNodes.length]
  }
  const [an, ao] = find(a), [bn, bo] = find(b)
  const s = window.getSelection()
  const r = document.createRange()
  try { r.setStart(an, ao); r.collapse(true); s.removeAllRanges(); s.addRange(r); if (bn !== an || bo !== ao) s.extend(bn, bo) } catch { /* left where it was */ }
}
const endOf = (t) => ({ p: t.paras.length - 1, o: X.paraText(t.paras.at(-1) || { runs: [] }).length })

// The words of one shape (or table cell), typed in where they are: box is where they go, in the
// slide's px; view, the words as drawn; api: the editor's handle on it.
const TextEdit = memo(function TextEdit({ box, view, start, onInput, onKey, onPaste, onSelect, onReady, edRef }) {
  const root = useRef(null)
  useLayoutEffect(() => {
    const el = root.current
    el.innerHTML = editHtml(view)
    el.focus({ preventScroll: true })
    if (start?.x != null) {
      const r = document.caretRangeFromPoint?.(start.x, start.y) || (() => { const c = document.caretPositionFromPoint?.(start.x, start.y); if (!c) return null; const x = document.createRange(); x.setStart(c.offsetNode, c.offset); return x })()
      if (r && el.contains(r.startContainer)) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r) } else placeCaret(el, { p: 9999, o: Infinity })
    } else if (start?.all) { placeCaret(el, { p: 0, o: 0 }, { p: 9999, o: 99999 }) } else if (start?.a) placeCaret(el, start.a, start.b || start.a)
    else placeCaret(el, { p: 9999, o: 99999 })
    edRef.current = {
      el,
      render(v, a, b) { el.innerHTML = editHtml(v); el.focus({ preventScroll: true }); if (a) placeCaret(el, a, b || a) },
      caret: () => caretOf(el),
    }
    onReady?.()
    return () => { edRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const b = view.body || {}
  const vert = b.vert && /vert/i.test(b.vert) ? { writingMode: 'vertical-rl' } : {}
  return (
    <div className="px-o px-editing" style={{ left: box.x, top: box.y, width: box.w, height: box.h, transform: box.rot ? `rotate(${box.rot}deg)` : undefined }}>
      <div className={`px-tx${b.wrap === false ? ' nowrap' : ''}`} style={{ left: b.l, top: b.t, width: Math.max(4, box.w - b.l - b.r), minHeight: Math.max(4, box.h - b.t - b.b), justifyContent: b.anchor === 'ctr' ? 'center' : b.anchor === 'b' ? 'flex-end' : 'flex-start', ...vert }}>
        <div ref={root} className="px-body px-edit-body" contentEditable suppressContentEditableWarning spellCheck onInput={onInput} onKeyDown={onKey} onPaste={onPaste} onKeyUp={onSelect} onMouseUp={onSelect} role="textbox" aria-multiline="true" aria-label={t('Words on the slide')} />
      </div>
    </div>
  )
})

// ---------- Geometry ----------
const rad = (d) => (d * Math.PI) / 180
const boxOf = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0, flipH: o.flipH, flipV: o.flipV })
const unionOf = (bs) => { const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y)); return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y } }
// A box resized from one of its handles (n, ne, e…) by d (in the slide's px), turned as it is;
// keep: in proportion.
function resized(b, handle, d, keepRatio) {
  const th = rad(b.rot || 0), cos = Math.cos(th), sin = Math.sin(th)
  const lx = d.x * cos + d.y * sin, ly = -d.x * sin + d.y * cos
  let w = b.w, h = b.h
  if (handle.includes('e')) w = b.w + lx
  if (handle.includes('w')) w = b.w - lx
  if (handle.includes('s')) h = b.h + ly
  if (handle.includes('n')) h = b.h - ly
  w = Math.max(4, w); h = Math.max(4, h)
  if (keepRatio && handle.length === 2 && b.w && b.h) { const r = b.w / b.h; if (w / b.w > h / b.h) h = w / r; else w = h * r }
  const cxl = handle.includes('w') ? (b.w - w) / 2 : handle.includes('e') ? (w - b.w) / 2 : 0
  const cyl = handle.includes('n') ? (b.h - h) / 2 : handle.includes('s') ? (h - b.h) / 2 : 0
  const cx = b.x + b.w / 2 + cxl * cos - cyl * sin, cy = b.y + b.h / 2 + cxl * sin + cyl * cos
  return { ...b, x: cx - w / 2, y: cy - h / 2, w, h }
}
// Where a moved box snaps: to the slide's edges and middle and to the other things' edges and
// middles, within tol. { dx, dy, guides: [{ x } | { y }] }.
function snapped(box, others, W, H, tol) {
  const xs = [0, W / 2, W, ...others.flatMap((b) => [b.x, b.x + b.w / 2, b.x + b.w])]
  const ys = [0, H / 2, H, ...others.flatMap((b) => [b.y, b.y + b.h / 2, b.y + b.h])]
  const best = (lines, mine) => { let out = null; for (const l of lines) for (const m of mine) { const d = l - m; if (Math.abs(d) <= tol && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, at: l } } return out }
  const bx = best(xs, [box.x, box.x + box.w / 2, box.x + box.w]), by = best(ys, [box.y, box.y + box.h / 2, box.y + box.h])
  return { dx: bx?.d || 0, dy: by?.d || 0, guides: [...(bx ? [{ x: bx.at }] : []), ...(by ? [{ y: by.at }] : [])] }
}
const SHAPES = [['rect', 'Rectangle'], ['roundRect', 'Rounded rectangle'], ['ellipse', 'Oval'], ['triangle', 'Triangle'], ['rtTriangle', 'Right triangle'], ['diamond', 'Diamond'], ['parallelogram', 'Parallelogram'], ['hexagon', 'Hexagon'], ['star5', 'Star'], ['rightArrow', 'Arrow right'], ['leftArrow', 'Arrow left'], ['chevron', 'Chevron'], ['wedgeRoundRectCallout', 'Callout'], ['plus', 'Plus'], ['heart', 'Heart'], ['can', 'Cylinder']]
const SPACINGS = [[1, 'Single'], [1.15, '1.15'], [1.5, '1.5'], [2, 'Double']]
const ZOOMS = [0.5, 0.75, 1, 1.5, 2]
const PROMPT = { title: 'Click to add title', ctrTitle: 'Click to add title', subTitle: 'Click to add subtitle', body: 'Click to add text' }

function Slides({ doc, file, onDirty, onStats, handle, readOnly = false, onOpen }) {
  const [slides, setSlides] = useState(doc.slides)
  const slidesRef = useRef(doc.slides)
  const [cur, setCur] = useState(0)
  const [picked, setPicked] = useState(() => new Set()) // slides picked in the strip, by key, besides the one shown
  const [sel, setSel] = useState([]) // what's picked on the slide: its places in the slide's list
  const [edit, setEdit] = useState(null) // the words being typed: { at, path, cell, start, fresh }
  const [crop, setCrop] = useState(null) // the picture being cropped: its place
  const [preview, setPreview] = useState(null) // the slide as it'd be, while something's dragged
  const [guides, setGuides] = useState([])
  const [marquee, setMarquee] = useState(null)
  const [hover, setHover] = useState(null)
  const [zoom, setZoom] = useState('fit')
  const [menu, setMenu] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [objMenu, setObjMenu] = useState(null) // the menu of what's picked on the slide: { x, y }
  const [present, setPresent] = useState(null)
  const [find, setFind] = useState(null) // { replace }
  const [found, setFound] = useState({ list: [], at: 0 })
  const [msg, setMsg] = useState(null)
  const [grid, setGrid] = useState(false)
  const [notesOpen, setNotesOpen] = useState(true)
  const [, setTick] = useState(0)
  const [drop, setDrop] = useState(null) // where dragged slides would go: { to, before }
  const dragFrom = useRef(null)
  const hist = useRef({ past: [], future: [], last: 0, typing: null })
  const curRef = useRef(0), selRef = useRef([]), editRef = useRef(null)
  const ed = useRef(null) // the words being typed: TextEdit's handle
  const base = useRef(null) // the text model the words being typed were drawn from
  const typed = useRef(null) // what's typed, waiting to go in
  const lastCaret = useRef(null)
  const media = useRef(new Map()) // pictures put in here: part path -> { bytes, type }
  const stageRef = useRef(null), canvasRef = useRef(null), stripRef = useRef(null), picInput = useRef(null), replaceInput = useRef(null)
  const drag = useRef(null)
  const pasteWait = useRef(null)
  const [stageAt, stage] = useSize()
  const stageEl = useCallback((n) => { stageRef.current = n; stageAt(n) }, [stageAt])

  // Pictures, as addresses the page can show: the file's own, and ones put in here.
  const urls = useRef(new Map())
  doc.urlOf = (part) => {
    if (!P.showable(part)) return null
    if (urls.current.has(part)) return urls.current.get(part)
    const bytes = doc.bin.get(part) || media.current.get(part)?.bytes
    if (!bytes) return null
    const u = URL.createObjectURL(new Blob([bytes], { type: P.mimeOf(part) }))
    urls.current.set(part, u)
    return u
  }
  useEffect(() => () => { for (const u of urls.current.values()) URL.revokeObjectURL(u) }, [])
  const views = useRef(new WeakMap())
  const viewOf = useCallback((s) => { let v = views.current.get(s); if (!v) { v = P.slideView(doc, s); views.current.set(s, v) } return v }, [doc])
  const firstView = viewOf(slides[0] || P.newSlide(doc, P.layoutsOf(doc)[0]?.path))
  const W = firstView.w, H = firstView.h
  const master = doc.slides[0]?.layout ? doc.layoutOf(doc.slides[0].layout)?.master : null
  const theme = master ? doc.themeOf(doc.masterOf(master)?.theme) : null
  const font = theme?.fonts.minor || 'Calibri'
  const words = useMemo(() => ({ picture: t('A picture Studio can\'t show'), chart: t('A chart Studio can\'t show'), diagram: t('A diagram Studio can\'t show'), other: t('Something Studio can\'t show') }), [])
  const draw = useCallback((s, n, more = {}) => slideHtml(viewOf(s), { number: n, font, words, ...more }), [viewOf, font, words])
  const layouts = useMemo(() => P.layoutsOf(doc), [doc])

  const count = slides.length
  const at = Math.min(cur, count - 1)
  const slide = slides[at]
  curRef.current = at
  selRef.current = sel
  editRef.current = edit
  const shown = preview || slide
  const view = viewOf(shown)
  const objAt = (i, v = view) => v.objs.find((o) => o.at === i)
  useEffect(() => { onStats?.({ text: t('Slide {n} of {count}', { n: at + 1, count }) }) }, [at, count, onStats])
  useEffect(() => { if (cur !== at) setCur(at) }, [cur, at])

  // ---------- Changes, undo and redo ----------
  const change = useCallback((next, { sel: s, cur: c, typing = null } = {}) => {
    const prev = slidesRef.current
    if (next !== prev) {
      const h = hist.current
      if (!(typing && h.typing === typing && Date.now() - h.last < 1500)) { h.past.push({ slides: prev, cur: curRef.current, sel: selRef.current }); if (h.past.length > 200) h.past.shift() }
      h.typing = typing; h.last = Date.now(); h.future = []
      slidesRef.current = next
      setSlides(next)
      onDirty(true)
    }
    if (c != null) setCur(c)
    if (s !== undefined) setSel(s)
  }, [onDirty])
  const setSlide = useCallback((s, opts) => { const next = [...slidesRef.current]; next[curRef.current] = s; change(next, opts) }, [change])
  const restore = (from, to) => {
    flushTyping()
    const h = hist.current
    if (!h[from].length) return
    h[to].push({ slides: slidesRef.current, cur: curRef.current, sel: selRef.current })
    const x = h[from].pop()
    h.typing = null
    slidesRef.current = x.slides
    setSlides(x.slides); setCur(x.cur); setSel(x.sel || []); setEdit(null); setCrop(null); setPreview(null); onDirty(true)
  }
  const undo = () => restore('past', 'future')
  const redo = () => restore('future', 'past')

  // ---------- Typing ----------
  // The words of what's being typed in, as they are now in the slide.
  const modelOf = (e = editRef.current, s = slidesRef.current[curRef.current]) => (e ? P.textAt(s.objs[e.at], e) : null)
  const textViewOf = (s, e) => {
    const o = viewOf(s).objs.find((x) => x.at === e.at)
    if (!o) return null
    if (e.cell) return o.table?.rows[e.cell[0]]?.cells[e.cell[1]]?.text || null
    let x = o
    for (const i of e.path || []) x = x?.kids?.[i]
    return x?.text || null
  }
  // What's typed, into the slide (now, or a moment after the last key).
  const commitTyped = useCallback(() => {
    clearTimeout(typed.current)
    typed.current = null
    const e = editRef.current
    if (!e || !ed.current || !base.current) return null
    const t2 = readBack(ed.current.el, base.current)
    const s = slidesRef.current[curRef.current]
    let next = P.withTextAt(s, e, t2)
    // A text box that grows with its words (PowerPoint's own and Google's) is as tall as they are.
    const o = viewOf(s).objs.find((x) => x.at === e.at)
    if (o && !e.cell && !(e.path || []).length && o.body?.autofit === 'grow' && o.kind === 'sp') {
      const h = ed.current.el.offsetHeight + o.body.t + o.body.b
      if (Math.abs(h - o.h) > 1) next = P.changeObj(next, e.at, (xml) => P.withXfrm(xml, { ...boxOf(o), h }))
    }
    // A placeholder that shrinks its words to fit: smaller as they outgrow it, back as they don't.
    let rescaled = false
    if (o && !e.cell && !(e.path || []).length && o.body?.autofit === 'shrink' && o.kind === 'sp') {
      const room = o.h - o.body.t - o.body.b, used = ed.current.el.offsetHeight, now = o.body.fontScale || 1
      let scale = now
      if (used > room + 1) scale = Math.max(0.25, Math.floor((now * room) / used * 40) / 40)
      else if (now < 1 && used < room * 0.8) scale = Math.min(1, Math.floor((now * room * 0.95) / Math.max(1, used) * 40) / 40)
      if (Math.abs(scale - now) >= 0.025) { next = P.changeObj(next, e.at, (xml) => P.withAutofit(xml, scale)); rescaled = true }
    }
    if (next !== s) setSlide(next, { typing: `text:${s.key}:${e.at}` })
    // The words as they're now kept (their body's fit included), for what's typed next.
    const now = next !== s ? P.textAt(next.objs[e.at], e) || t2 : t2
    if (rescaled) { const c = ed.current.caret(); const v = textViewOf(next, e); base.current = now; if (v) ed.current.render(v, c?.a, c?.b) }
    return now
  }, [setSlide, viewOf])
  function flushTyping() { if (typed.current) commitTyped() }
  const onEditInput = (e) => {
    if (e.nativeEvent?.isComposing) return
    clearTimeout(typed.current)
    typed.current = setTimeout(commitTyped, 120)
  }
  // A change to the words made here (Enter, a format): the slide, then the words drawn again with
  // the caret where it goes.
  const applyText = (fn) => {
    const e = editRef.current
    if (!e || !ed.current) return
    const t0 = commitTyped() || modelOf()
    const c = ed.current.caret() || lastCaret.current || { a: endOf(t0), b: endOf(t0) }
    const out = fn(t0, c.a, c.b)
    if (!out) return
    const t2 = out.t || out
    const s = slidesRef.current[curRef.current]
    const next = P.withTextAt(s, e, t2)
    setSlide(next)
    base.current = t2
    const v = textViewOf(next, e)
    if (v) ed.current.render(v, out.caret || c.a, out.caret ? null : c.b)
    lastCaret.current = out.caret ? { a: out.caret, b: out.caret } : c
    setTick((x) => x + 1)
  }
  const startEdit = (i, opts = {}) => {
    flushTyping()
    const s = slidesRef.current[opts.si ?? curRef.current]
    const target = { at: i, path: opts.path || [], cell: opts.cell || null }
    const tm = P.textAt(s.objs[i], target)
    if (!tm || readOnly) return false
    base.current = tm
    setCrop(null)
    setSel([i])
    setEdit({ ...target, start: opts.start || null, fresh: !!opts.fresh, n: Date.now() })
    return true
  }
  const stopEdit = () => {
    const e = editRef.current
    if (!e) return
    commitTyped()
    // A new text box left empty goes, as in Google Slides.
    const s = slidesRef.current[curRef.current]
    const tm = P.textAt(s.objs[e.at], e)
    if (e.fresh && tm && !X.paraText({ runs: tm.paras.flatMap((p) => p.runs) }).trim()) { setSlide(P.removeObjs(s, [e.at]), { sel: [] }) }
    setEdit(null)
    base.current = null
    stageRef.current?.focus({ preventScroll: true })
  }
  const onEditKey = (e) => {
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (e.key === 'Escape') { e.preventDefault(); stopEdit(); return }
    if (mod && !e.shiftKey && k === 'z') { e.preventDefault(); undo(); return }
    if (mod && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); redo(); return }
    if (mod && !e.shiftKey && !e.altKey && ['b', 'i', 'u'].includes(k)) { e.preventDefault(); toggle({ b: 'b', i: 'i', u: 'u' }[k]); return }
    if (mod && e.shiftKey && (k === 'x' || e.code === 'KeyX')) { e.preventDefault(); toggle('strike'); return }
    if (mod && e.shiftKey && e.code === 'Digit7') { e.preventDefault(); bullets('num'); return }
    if (mod && e.shiftKey && e.code === 'Digit8') { e.preventDefault(); bullets('char'); return }
    if (mod && e.shiftKey && ['KeyL', 'KeyE', 'KeyR', 'KeyJ'].includes(e.code)) { e.preventDefault(); align({ KeyL: 'l', KeyE: 'ctr', KeyR: 'r', KeyJ: 'just' }[e.code]); return }
    if (mod && e.shiftKey && (e.code === 'Period' || e.code === 'Comma')) { e.preventDefault(); stepSize(e.code === 'Period' ? 1 : -1); return }
    if (mod && e.code === 'Backslash') { e.preventDefault(); applyText((t0, a, b) => X.clearFormat(t0, a, b)); return }
    if (e.key === 'Enter' && !mod) { e.preventDefault(); applyText((t0, a, b) => (e.shiftKey ? X.lineBreak(t0, a, b) : X.splitPara(t0, a, b))); return }
    if (e.key === 'Tab') {
      e.preventDefault()
      applyText((t0, a, b) => {
        const v = textViewOf(slidesRef.current[curRef.current], editRef.current)
        const listy = v?.paras[a.p]?.bullet || (v?.paras[a.p]?.lvl || 0) > 0
        if (!listy && !e.shiftKey) return X.insertText(t0, a, b, '\t')
        return { t: X.formatParas(t0, a, b, (pPr, p) => P.withPara(levelled(pPr), { lvl: Math.max(0, Math.min(8, (Number(/\slvl="(\d)"/.exec(pPr || '')?.[1] || 0)) + (e.shiftKey ? -1 : 1))) })), caret: null }
      })
      return
    }
    if (e.key === 'Backspace' && !mod) {
      const c = ed.current?.caret()
      if (c && c.a.p === c.b.p && c.a.o === c.b.o && c.a.o === 0 && c.a.p > 0) { e.preventDefault(); applyText((t0, a) => X.joinBack(t0, a.p)) }
    }
  }
  const onEditPaste = (e) => {
    e.preventDefault()
    const pic = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'))
    if (pic) { addPicture(pic); return }
    const text = e.clipboardData?.getData('text/plain') || ''
    if (text) applyText((t0, a, b) => X.insertText(t0, a, b, text))
  }
  // A letter typed with a shape picked (not yet typed in): put in once its words are open.
  const pendingKey = useRef(null)
  const onEditReady = () => { const ch = pendingKey.current; pendingKey.current = null; if (ch) applyText((t0, a, b) => X.insertText(t0, a, b, ch)) }
  const onEditSelect = () => { const c = ed.current?.caret(); if (c) lastCaret.current = c; setTick((x) => x + 1) }
  useEffect(() => {
    if (!edit) return undefined
    const on = () => { const c = ed.current?.caret(); if (c) { lastCaret.current = c; setTick((x) => x + 1) } }
    document.addEventListener('selectionchange', on)
    return () => document.removeEventListener('selectionchange', on)
  }, [edit])

  // ---------- Formatting ----------
  // The words' look where the caret is (or of the first thing picked): for the toolbar.
  const lookNow = (() => {
    const s = slide
    let v = null, pt = null
    if (edit) { v = textViewOf(s, edit); pt = lastCaret.current?.a } else if (sel.length) { const o = objAt(sel[0]); v = o?.text || o?.table?.rows[0]?.cells[0]?.text || null }
    if (!v) return null
    const p = v.paras[Math.min(v.paras.length - 1, pt?.p ?? 0)]
    if (!p) return null
    let r = p.end, n = 0
    for (const x of p.runs) { const len = x.br ? 1 : x.text.length; if (x.text && (pt == null || n < (pt.o || 0) || n === 0)) r = x; n += len; if (pt && n >= pt.o && x.text) break }
    return { b: !!r.b, i: !!r.i, u: !!r.u, strike: !!r.strike, sz: Math.round(((r.sz || 18) / (v.body?.fontScale || 1)) * 10) / 10, font: r.font, color: r.color?.hex || null, algn: p.algn, bullet: p.bullet ? (p.bullet.auto ? 'num' : 'char') : null, lnSpc: p.lnSpc?.pct || 1 }
  })()
  const textTargets = () => {
    const s = slidesRef.current[curRef.current]
    const out = []
    for (const i of selRef.current) for (const x of P.textsOf({ ...s, objs: s.objs })) if (x.at === i) out.push(x)
    return out
  }
  // A run's look set (set: withRun's) on what's picked: the words typed over, or every word in the
  // shapes picked.
  const fmt = (set) => {
    if (editRef.current) { applyText((t0, a, b) => ({ t: X.formatRange(t0, a, b, set), caret: null })); return }
    let s = slidesRef.current[curRef.current]
    for (const x of textTargets()) s = P.withTextAt(s, x, X.formatAll(x.t, set))
    if (s !== slidesRef.current[curRef.current]) setSlide(s)
  }
  const paraFmt = (set) => {
    if (editRef.current) { applyText((t0, a, b) => ({ t: X.formatParas(t0, a, b, set), caret: null })); return }
    let s = slidesRef.current[curRef.current]
    for (const x of textTargets()) s = P.withTextAt(s, x, X.formatParas(x.t, { p: 0, o: 0 }, endOf(x.t), set))
    if (s !== slidesRef.current[curRef.current]) setSlide(s)
  }
  const toggle = (k) => fmt({ [k]: !lookNow?.[k] })
  const align = (a) => paraFmt({ algn: a })
  const bullets = (kind) => paraFmt({ bullet: lookNow?.bullet === kind ? 'none' : kind })
  const levelled = (pPr) => (pPr ? P.withAttr(P.withAttr(pPr, 'marL', null), 'indent', null) : pPr)
  const indent = (d) => paraFmt((pPr) => P.withPara(levelled(pPr), { lvl: Math.max(0, Math.min(8, Number(/\slvl="(\d)"/.exec(pPr || '')?.[1] || 0) + d)) }))
  const stepSize = (d) => { const now = lookNow?.sz || 18; const next = d > 0 ? SIZES.find((x) => x > now) || now + 4 : [...SIZES].reverse().find((x) => x < now) || Math.max(1, now - 1); fmt({ sz: next }) }
  const canText = edit || sel.some((i) => { const o = objAt(i); return o && (o.kind === 'sp' || o.kind === 'table') })

  // ---------- Things on the slide ----------
  const update = (fn, opts) => { const s = slidesRef.current[curRef.current]; const next = fn(s); if (next !== s) setSlide(next, opts) }
  const removeSel = () => { if (!sel.length) return; update((s) => P.removeObjs(s, sel), { sel: [] }); setEdit(null) }
  const nudge = (dx, dy) => update((s) => sel.reduce((acc, i) => { const o = objAt(i); return o ? P.changeObj(acc, i, (xml) => P.withXfrm(xml, { ...boxOf(o), x: o.x + dx, y: o.y + dy })) : acc }, s), { typing: `nudge:${sel.join()}` })
  const insert = (xml, { edit: typeIn = false, rels = {} } = {}) => {
    const s = slidesRef.current[curRef.current]
    const next = P.addObjs(s, [xml], { rels })
    const i = next.objs.length - 1
    setSlide(next, { sel: [i] })
    if (typeIn) setTimeout(() => startEdit(i, { fresh: true }), 0)
    return i
  }
  const centred = (w, h) => ({ x: (W - w) / 2, y: (H - h) / 2, w, h })
  const addTextBox = () => insert(P.textBoxXml(centred(W * 0.4, 48)), { edit: true })
  const addShape = (prst) => insert(P.shapeXml(centred(W * 0.18, W * 0.12), prst))
  const addLine = (arrow) => insert(P.lineXml({ x: W * 0.35, y: H / 2, w: W * 0.3, h: 0 }, { arrow }))
  const addTable = (r, c) => insert(P.tableXml({ x: W * 0.12, y: H * 0.3, w: W * 0.76, h: 40 * r }, r, c))
  const pictureBytes = async (f) => {
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml|bmp)$/.test(f.type)) { setMsg({ text: t('That isn\'t a picture Studio can put on a slide (PNG, JPEG, GIF, WebP or SVG).'), error: true }); return null }
    const bytes = new Uint8Array(await f.arrayBuffer())
    const ext = { 'image/jpeg': 'jpeg', 'image/svg+xml': 'svg' }[f.type] || f.type.split('/')[1]
    const path = P.newMediaPath(doc, media.current, ext)
    media.current.set(path, { bytes, type: f.type })
    const size = await new Promise((ok) => { const img = new Image(); img.onload = () => ok({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 }); img.onerror = () => ok({ w: 400, h: 300 }); img.src = doc.urlOf(path) })
    return { path, size }
  }
  async function addPicture(f, { replaceAt = null } = {}) {
    if (!f || readOnly) return
    try {
      const p = await pictureBytes(f)
      if (!p) return
      const s0 = slidesRef.current[curRef.current]
      const { slide: s1, rid } = P.withPictureRel(s0, p.path)
      if (replaceAt != null) {
        setSlide(P.changeObj(s1, replaceAt, (xml) => P.withCrop(xml.replace(/(<a:blip\b[^>]*?\br:embed=")[^"]*"/, `$1${rid}"`), null)), { sel: [replaceAt] })
        return
      }
      const k = Math.min(1, (W * 0.6) / p.size.w, (H * 0.6) / p.size.h)
      const b = centred(p.size.w * k, p.size.h * k)
      const next = P.addObjs(s1, [P.pictureXml(b, rid, f.name || 'Picture')])
      setSlide(next, { sel: [next.objs.length - 1] })
    } catch (e) { setMsg({ text: t("Couldn't put the picture on: {error}", { error: e.message }), error: true }) }
  }
  const duplicateSel = () => {
    if (!sel.length) return
    update((s) => { const xmls = sel.map((i) => { const o = objAt(i); return o ? P.withXfrm(s.objs[i], { ...boxOf(o), x: o.x + 16, y: o.y + 16 }) : s.objs[i] }); const next = P.addObjs(s, xmls); return next }, {})
    const n = slidesRef.current[curRef.current].objs.length
    setSel(sel.map((_, j) => n - sel.length + j))
  }
  const reorder = (dir) => {
    if (!sel.length) return
    const s = slidesRef.current[curRef.current]
    const tagged = s.objs.map((x, i) => i)
    const next = P.reorderObjs(s, sel, dir)
    // Where each picked thing went.
    const moved = P.reorderObjs({ ...s, objs: tagged.map(String) }, sel, dir).objs.map(Number)
    setSlide(next, { sel: sel.map((i) => moved.indexOf(i)) })
  }
  const alignSel = (how) => {
    const os = sel.map((i) => objAt(i)).filter(Boolean)
    if (!os.length) return
    const u = os.length > 1 ? unionOf(os) : { x: 0, y: 0, w: W, h: H }
    update((s) => os.reduce((acc, o) => {
      const b = boxOf(o)
      if (how === 'left') b.x = u.x; else if (how === 'center') b.x = u.x + (u.w - o.w) / 2; else if (how === 'right') b.x = u.x + u.w - o.w
      else if (how === 'top') b.y = u.y; else if (how === 'middle') b.y = u.y + (u.h - o.h) / 2; else if (how === 'bottom') b.y = u.y + u.h - o.h
      return P.changeObj(acc, o.at, (xml) => P.withXfrm(xml, b))
    }, s))
  }
  const distribute = (axis) => {
    const os = sel.map((i) => objAt(i)).filter(Boolean).sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y))
    if (os.length < 3) return
    const size = os.reduce((n, o) => n + (axis === 'h' ? o.w : o.h), 0)
    const u = unionOf(os)
    const gap = ((axis === 'h' ? u.w : u.h) - size) / (os.length - 1)
    let pos = axis === 'h' ? u.x : u.y
    update((s) => os.reduce((acc, o) => { const b = boxOf(o); if (axis === 'h') b.x = pos; else b.y = pos; pos += (axis === 'h' ? o.w : o.h) + gap; return P.changeObj(acc, o.at, (xml) => P.withXfrm(xml, b)) }, s))
  }
  const turn = (deg, flip) => update((s) => sel.reduce((acc, i) => { const o = objAt(i); return o ? P.changeObj(acc, i, (xml) => P.withXfrm(xml, flip ? { ...boxOf(o), [flip]: !o[flip] } : { ...boxOf(o), rot: (o.rot || 0) + deg })) : acc }, s))
  const group = () => {
    if (sel.length < 2) return
    const s = slidesRef.current[curRef.current]
    const order = [...sel].sort((a, b) => a - b)
    const u = unionOf(order.map((i) => objAt(i)).filter(Boolean))
    const g = P.groupXml(order.map((i) => s.objs[i]), u)
    const rest = P.removeObjs(s, order)
    const next = P.addObjs(rest, [g], { at: order[0] })
    setSlide(next, { sel: [order[0]] })
  }
  const ungroup = () => {
    const i = sel[0]
    const s = slidesRef.current[curRef.current]
    if (sel.length !== 1 || !/^<p:grpSp\b/.test(s.objs[i])) return
    const kids = P.ungroupXml(s.objs[i])
    const objs = [...s.objs]
    objs.splice(i, 1, ...kids)
    setSlide({ ...s, objs, changed: true }, { sel: kids.map((_, j) => i + j) })
  }
  const setFill = (c) => update((s) => sel.reduce((acc, i) => P.changeObj(acc, i, (xml) => (/^<p:(sp|grpSp)\b/.test(xml) ? P.withFill(xml, c) : xml)), s))
  const setLine = (set) => update((s) => sel.reduce((acc, i) => P.changeObj(acc, i, (xml) => (/^<p:(sp|cxnSp|pic)\b/.test(xml) ? P.withLine(xml, set) : xml)), s))
  const tableEdit = (fn) => { const i = sel[0]; if (i == null) return; update((s) => P.changeObj(s, i, fn)) }

  // ---------- Slides ----------
  const pickedList = () => { const ks = new Set([...picked, slidesRef.current[curRef.current]?.key]); return slidesRef.current.map((s, i) => (ks.has(s.key) ? i : -1)).filter((i) => i >= 0) }
  const go = (i, { extend = false, toggle: tg = false } = {}) => {
    flushTyping(); setEdit(null); setCrop(null)
    const n = Math.max(0, Math.min(slidesRef.current.length - 1, i))
    if (tg) { const k = slidesRef.current[n].key; setPicked((p) => { const x = new Set(p); x.add(slidesRef.current[curRef.current].key); if (x.has(k) && n !== curRef.current) x.delete(k); else x.add(k); return x }) }
    else if (extend) { const a = Math.min(curRef.current, n), b = Math.max(curRef.current, n); setPicked(new Set(slidesRef.current.slice(a, b + 1).map((s) => s.key))) }
    else setPicked(new Set())
    setCur(n); setSel([])
  }
  const addSlide = (layout) => {
    const l = layout || slidesRef.current[curRef.current]?.layout || layouts.find((x) => x.type === 'obj')?.path || layouts[0]?.path
    if (!l) return
    const s = P.newSlide(doc, l)
    const next = [...slidesRef.current]
    next.splice(curRef.current + 1, 0, s)
    change(next, { cur: curRef.current + 1, sel: [] })
    setPicked(new Set())
  }
  const duplicateSlides = () => {
    const list = pickedList()
    const copies = list.map((i) => P.copySlide(doc, slidesRef.current[i]))
    const next = [...slidesRef.current]
    next.splice(list.at(-1) + 1, 0, ...copies)
    change(next, { cur: list.at(-1) + 1, sel: [] })
    setPicked(new Set(copies.map((s) => s.key)))
  }
  const removeSlides = () => {
    const list = pickedList()
    if (list.length >= slidesRef.current.length) { setMsg({ text: t('A deck keeps at least one slide.'), error: true }); return }
    const gone = new Set(list)
    change(slidesRef.current.filter((_, i) => !gone.has(i)), { cur: Math.max(0, Math.min(list[0], slidesRef.current.length - list.length - 1)), sel: [] })
    setPicked(new Set())
  }
  const moveSlides = (to) => {
    const list = pickedList()
    const keysOf = new Set(list.map((i) => slidesRef.current[i].key))
    const moving = list.map((i) => slidesRef.current[i])
    const rest = slidesRef.current.filter((s) => !keysOf.has(s.key))
    const before = slidesRef.current.slice(0, to).filter((s) => !keysOf.has(s.key)).length
    const next = [...rest.slice(0, before), ...moving, ...rest.slice(before)]
    if (next.every((s, i) => s === slidesRef.current[i])) return
    change(next, { cur: before + moving.indexOf(slidesRef.current[curRef.current]) })
  }
  const skipSlides = (hidden) => { const list = new Set(pickedList()); change(slidesRef.current.map((s, i) => (list.has(i) ? P.withHidden(s, hidden) : s))) }
  const setLayout = (path) => setSlide(P.withLayout(slidesRef.current[curRef.current], path))

  // ---------- Copy and paste ----------
  const plainOfObjs = (s, ats) => P.textsOf(s).filter((x) => ats.includes(x.at)).map((x) => P.plainOf(x.t)).join('\n')
  const copy = (what = selRef.current.length && !document.activeElement?.closest?.('.sd-strip') ? 'objs' : 'slides') => {
    const s = slidesRef.current[curRef.current]
    if (what === 'objs') {
      const ats = [...selRef.current].sort((a, b) => a - b)
      clip = { kind: 'objs', doc, from: s.key, items: ats.map((i) => s.objs[i]), rels: s.rels, text: plainOfObjs(s, ats) || ' ' }
    } else {
      const list = pickedList()
      clip = { kind: 'slides', doc, slides: list.map((i) => slidesRef.current[i]), text: list.map((i) => P.textsOf(slidesRef.current[i]).map((x) => P.plainOf(x.t)).join('\n')).join('\n\n') || ' ' }
    }
    return clip
  }
  // Pictures another deck's things use, put in this one's; what can't come (a chart from another
  // file) is left out, and said.
  const bringRels = (from, rels, xmls) => {
    if (from === doc) return { rels, xmls, left: 0 }
    const out = {}
    let left = 0
    for (const [rid, r] of Object.entries(rels)) {
      if (r.external) { out[rid] = r; continue }
      if (r.type === 'image' && (from.bin.get(r.target) || from === doc)) {
        const ext = r.target.split('.').pop().toLowerCase()
        const path = P.newMediaPath(doc, media.current, ext)
        media.current.set(path, { bytes: from.bin.get(r.target), type: P.mimeOf(r.target) })
        out[rid] = { ...r, target: path }
      }
    }
    const kept = xmls.filter((x) => { const ids = [...x.matchAll(/r:(?:embed|link|id|dm|lo|qs|cs)="([^"]+)"/g)].map((m) => m[1]); const ok = ids.every((id) => out[id]); if (!ok) left++; return ok })
    return { rels: out, xmls: kept, left }
  }
  const paste = () => {
    if (!clip || readOnly) return
    if (clip.kind === 'objs') {
      const s = slidesRef.current[curRef.current]
      const { rels, xmls, left } = bringRels(clip.doc, clip.rels, clip.items)
      const same = clip.doc === doc && clip.from === s.key
      // Pasted where it was copied from: a little down and to the right, so it shows.
      const shifted = same ? xmls.map((x) => { const o = P.slideView(doc, { ...s, objs: [x] }).objs[0]; return o ? P.withXfrm(x, { ...boxOf(o), x: o.x + 16, y: o.y + 16 }) : x }) : xmls
      const next = P.addObjs(s, shifted, { rels })
      setSlide(next, { sel: shifted.map((_, j) => next.objs.length - shifted.length + j) })
      if (left) setMsg({ text: t('{n} things from another deck (charts, diagrams) stay there; paste them in PowerPoint.', { n: left }) })
      return
    }
    const copies = clip.slides.map((s) => {
      let c = P.copySlide(doc, s)
      if (clip.doc !== doc) {
        const was = clip.doc.layoutOf(s.layout)
        const l = layouts.find((x) => x.name === was?.name) || layouts.find((x) => x.type === was?.type) || layouts.find((x) => x.type === 'obj') || layouts[0]
        const { rels, xmls } = bringRels(clip.doc, Object.fromEntries(Object.entries(s.rels).filter(([, r]) => r.type !== 'slideLayout' && r.type !== 'notesSlide')), s.objs)
        c = { ...c, objs: xmls, rels: { ...rels, rIdL: { id: 'rIdL', type: 'slideLayout', typeUri: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: l.path } }, layout: l.path, from: null }
      }
      return c
    })
    const next = [...slidesRef.current]
    next.splice(curRef.current + 1, 0, ...copies)
    change(next, { cur: curRef.current + 1, sel: [] })
    setPicked(new Set(copies.map((s) => s.key)))
  }
  // From another app: a picture becomes a picture, words a text box.
  const pasteFrom = (data) => {
    const pic = [...(data?.files || [])].find((f) => f.type.startsWith('image/'))
    if (pic) { addPicture(pic); return true }
    const text = data?.getData('text/plain') || ''
    if (clip && text === clip.text) { paste(); return true }
    if (text.trim()) { insert(P.textBoxXml(centred(W * 0.5, 48), text.replace(/\r\n?/g, '\n').trim())); return true }
    return false
  }
  useEffect(() => {
    const inEditor = (e) => !present && !e.target.closest?.('input, textarea, [contenteditable="true"]') && (e.target.closest?.('.sd-slides') || e.target === document.body)
    const onCopy = (e) => { if (!inEditor(e) || readOnly) return; const c = clip; if (!c) return; e.clipboardData?.setData('text/plain', c.text); e.preventDefault() }
    const onPaste = (e) => { if (!inEditor(e) || readOnly) return; clearTimeout(pasteWait.current); pasteWait.current = null; e.preventDefault(); pasteFrom(e.clipboardData) }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCopy); document.removeEventListener('paste', onPaste) }
  })

  // ---------- Dragging on the slide ----------
  const narrow = stage.w > 0 && stage.w < 560
  const pad = narrow ? 12 : 28
  const fitK = Math.max(0.05, Math.min((stage.w - pad * 2) / W, (stage.h - pad * 2) / H))
  const k = zoom === 'fit' || narrow ? (narrow ? Math.max(0.05, (stage.w - pad * 2) / W) : fitK) : zoom
  const ptOf = (e) => { const r = canvasRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k } }
  const withBoxes = (s, boxes) => { let out = s; for (const [i, b] of boxes) out = P.changeObj(out, i, (xml) => P.withXfrm(xml, b)); return out }
  // Where a drag has got to, drawn (once a frame, and once more where it's let go).
  const step = (d, e) => {
    const p = ptOf(e)
    const dx = p.x - d.start.x, dy = p.y - d.start.y
    const show = (pv) => { d.preview = pv; setPreview(pv) }
    if (d.mode === 'marquee') { setMarquee({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) }); return }
    if (d.mode === 'move') {
      const u = unionOf([...d.boxes.values()])
      const sn = e.altKey ? { dx: 0, dy: 0, guides: [] } : snapped({ ...u, x: u.x + dx, y: u.y + dy }, d.others, W, H, 6 / k)
      const boxes = new Map([...d.boxes].map(([i, b]) => [i, { ...b, x: b.x + dx + sn.dx, y: b.y + dy + sn.dy }]))
      setGuides(sn.guides); show(withBoxes(d.base, boxes))
    } else if (d.mode === 'resize') {
      const keepRatio = d.ratio ? !e.shiftKey : e.shiftKey
      if (d.boxes.size === 1) {
        const [[i, b]] = [...d.boxes]
        show(withBoxes(d.base, new Map([[i, resized(b, d.handle, { x: dx, y: dy }, keepRatio)]])))
      } else {
        const u = unionOf([...d.boxes.values()])
        const u2 = resized({ ...u, rot: 0 }, d.handle, { x: dx, y: dy }, keepRatio)
        const sx = u2.w / u.w, sy = u2.h / u.h
        show(withBoxes(d.base, new Map([...d.boxes].map(([i, b]) => [i, { ...b, x: u2.x + (b.x - u.x) * sx, y: u2.y + (b.y - u.y) * sy, w: b.w * sx, h: b.h * sy }]))))
      }
    } else if (d.mode === 'rotate') {
      const [[i, b]] = [...d.boxes]
      let deg = (Math.atan2(p.y - (b.y + b.h / 2), p.x - (b.x + b.w / 2)) * 180) / Math.PI + 90
      deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.abs(((deg % 90) + 90) % 90) < 3 || Math.abs(((deg % 90) + 90) % 90) > 87 ? Math.round(deg / 90) * 90 : Math.round(deg)
      show(withBoxes(d.base, new Map([[i, { ...b, rot: ((deg % 360) + 360) % 360 }]])))
    } else if (d.mode === 'crop') {
      const [[i, b]] = [...d.boxes]
      const c = { ...d.crop }
      const iw = b.w / Math.max(0.01, 1 - c.l - c.r), ih = b.h / Math.max(0.01, 1 - c.t - c.b)
      const nb = { ...b }
      if (d.handle.includes('w')) { const v = Math.max(-c.l * iw, Math.min(dx, b.w - 8)); nb.x = b.x + v; nb.w = b.w - v; c.l += v / iw }
      if (d.handle.includes('e')) { const v = Math.max(-b.w + 8, Math.min(dx, c.r * iw)); nb.w = b.w + v; c.r -= v / iw }
      if (d.handle.includes('n')) { const v = Math.max(-c.t * ih, Math.min(dy, b.h - 8)); nb.y = b.y + v; nb.h = b.h - v; c.t += v / ih }
      if (d.handle.includes('s')) { const v = Math.max(-b.h + 8, Math.min(dy, c.b * ih)); nb.h = b.h + v; c.b -= v / ih }
      show(P.changeObj(d.base, i, (xml) => P.withCrop(P.withXfrm(xml, nb), c)))
    }
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    const p = ptOf(e)
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) * k < 3) return
    d.moved = true
    d.last = e
    if (d.frame) return
    d.frame = requestAnimationFrame(() => { d.frame = null; step(d, d.last) })
  }
  const onUp = (e) => {
    window.removeEventListener('pointermove', onMove)
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.frame) { cancelAnimationFrame(d.frame); d.frame = null; step(d, d.last) }
    setGuides([])
    if (d.mode === 'marquee') {
      setMarquee(null)
      if (!d.moved) return
      const p = ptOf(e)
      const r = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), x2: Math.max(d.start.x, p.x), y2: Math.max(d.start.y, p.y) }
      setSel(view.objs.filter((o) => o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x2 && o.y + o.h <= r.y2).map((o) => o.at))
      return
    }
    if (d.preview && d.moved) setSlide(d.preview)
    setPreview(null)
    if (!d.moved && d.mode === 'move' && d.hit != null && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      // A click (not a drag) in words starts typing there: at once in a text box or placeholder,
      // and on a second click in a shape, as in Google Slides.
      const o = objAt(d.hit)
      const xml = slidesRef.current[curRef.current].objs[d.hit]
      const texty = o && o.kind === 'sp' && (/txBox="1"/.test(xml) || o.ph || (o.text && d.was))
      if (texty) startEdit(d.hit, { start: { x: e.clientX, y: e.clientY } })
      else if (o?.kind === 'table' && d.was) { const td = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('td[data-cell]'); if (td) startEdit(d.hit, { cell: td.dataset.cell.split(':').map(Number), start: { x: e.clientX, y: e.clientY } }) }
      else if (o?.kind === 'grp' && d.was) {
        const kid = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.px-grp > .px-o')
        const i = kid ? [...kid.parentElement.children].indexOf(kid) : -1
        if (i >= 0 && o.kids[i]?.kind === 'sp') startEdit(d.hit, { path: [i], start: { x: e.clientX, y: e.clientY } })
      }
    }
  }
  const startDrag = (e, mode, extra = {}) => {
    const s = slidesRef.current[curRef.current]
    const ids = extra.ids || selRef.current
    const v = viewOf(s)
    const boxes = new Map(ids.map((i) => [i, boxOf(v.objs.find((o) => o.at === i))]).filter((x) => x[1]))
    drag.current = { mode, start: ptOf(e), base: s, boxes, others: v.objs.filter((o) => !ids.includes(o.at)).map(boxOf), moved: false, ...extra }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }
  const onCanvasDown = (e) => {
    if (e.button !== 0 || readOnly) { if (e.button === 0) setSel([]); return }
    if (e.target.closest('.px-editing')) return
    if (e.target.closest('.px-handle')) return
    stageRef.current?.focus({ preventScroll: true })
    if (editRef.current) stopEdit()
    if (crop != null) { applyCropDone(); }
    const hit = e.target.closest('[data-o]')
    const i = hit ? Number(hit.dataset.o) : null
    if (i == null) { if (!e.shiftKey) setSel([]); startDrag(e, 'marquee', { ids: [] }); e.preventDefault(); return }
    e.preventDefault()
    if (e.shiftKey || e.metaKey || e.ctrlKey) { setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i])); return }
    const was = selRef.current.includes(i)
    const ids = was ? selRef.current : [i]
    if (!was) setSel(ids)
    startDrag(e, 'move', { ids, hit: i, was })
  }
  const onCanvasDouble = (e) => {
    const hit = e.target.closest('[data-o]')
    if (!hit || readOnly) return
    const i = Number(hit.dataset.o)
    const o = objAt(i)
    if (o?.kind === 'pic') { setCrop(i); setSel([i]); return }
    if (o?.kind === 'sp') startEdit(i, { start: { x: e.clientX, y: e.clientY } })
  }
  const onHandleDown = (e, handle) => {
    e.preventDefault(); e.stopPropagation()
    const o = objAt(selRef.current[0])
    if (crop != null) { startDrag(e, 'crop', { handle, ids: [crop], crop: { ...(objAt(crop)?.img?.crop || { l: 0, t: 0, r: 0, b: 0 }) } }); return }
    if (handle === 'rot') { startDrag(e, 'rotate', { ids: [selRef.current[0]] }); return }
    startDrag(e, 'resize', { handle, ratio: selRef.current.length === 1 && o?.kind === 'pic' })
  }
  const applyCropDone = () => setCrop(null)
  const onStageDrop = (e) => { const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')); if (!f || readOnly) return; e.preventDefault(); addPicture(f) }

  // ---------- Keys ----------
  useEffect(() => {
    const key = (e) => {
      if (present || e.defaultPrevented) return
      const mod = e.metaKey || e.ctrlKey
      const k2 = e.key.toLowerCase()
      const inField = e.target.closest?.('input, textarea, select, [contenteditable="true"]')
      if (mod && k2 === 'enter') { e.preventDefault(); startPresent(e.shiftKey ? 0 : curRef.current); return }
      if (e.key === 'F5') { e.preventDefault(); startPresent(e.shiftKey ? curRef.current : 0); return }
      if (mod && !e.shiftKey && k2 === 'f' && !e.target.closest?.('.sd-findbar')) { e.preventDefault(); setFind((f) => ({ replace: f?.replace || false, n: Date.now() })); return }
      if (mod && e.shiftKey && k2 === 'h') { e.preventDefault(); setFind({ replace: true, n: Date.now() }); return }
      if (inField || readOnly) return
      if (!e.target.closest?.('.sd-slides') && e.target !== document.body) return
      const inStrip = !!e.target.closest?.('.sd-strip, .sd-sorter')
      if (mod && !e.shiftKey && k2 === 'z') { e.preventDefault(); undo(); return }
      if (mod && (k2 === 'y' || (k2 === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if (mod && k2 === 'm') { e.preventDefault(); addSlide(); return }
      if (mod && (k2 === 'c' || k2 === 'x')) { const c = copy(inStrip || !selRef.current.length ? 'slides' : 'objs'); if (k2 === 'x') { if (c.kind === 'objs') removeSel(); else removeSlides() } return }
      if (mod && k2 === 'v') { clearTimeout(pasteWait.current); pasteWait.current = setTimeout(() => { pasteWait.current = null; paste() }, 80); return }
      if (inStrip) {
        if (mod && k2 === 'd') { e.preventDefault(); duplicateSlides() }
        else if (mod && k2 === 'a') { e.preventDefault(); setPicked(new Set(slidesRef.current.map((s) => s.key))) }
        else if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const list = pickedList(); moveSlides(e.shiftKey ? (e.key === 'ArrowUp' ? 0 : slidesRef.current.length) : e.key === 'ArrowUp' ? Math.max(0, list[0] - 1) : list.at(-1) + 2) }
        else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(curRef.current - 1, { extend: e.shiftKey }) }
        else if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); go(curRef.current + 1, { extend: e.shiftKey }) }
        else if (e.key === 'Home') { e.preventDefault(); go(0) }
        else if (e.key === 'End') { e.preventDefault(); go(slidesRef.current.length - 1) }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSlides() }
        return
      }
      const s = selRef.current
      if (mod && k2 === 'a') { e.preventDefault(); setSel(viewOf(slidesRef.current[curRef.current]).objs.map((o) => o.at)); return }
      if (mod && k2 === 'd') { e.preventDefault(); if (s.length) duplicateSel(); else duplicateSlides(); return }
      if (mod && e.altKey && e.code === 'KeyG') { e.preventDefault(); if (e.shiftKey) ungroup(); else group(); return }
      if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && s.length) { e.preventDefault(); reorder(e.key === 'ArrowUp' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward')); return }
      if (mod && e.altKey && (e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0')) { e.preventDefault(); stepZoom(e.code === 'Equal' ? 1 : e.code === 'Minus' ? -1 : 0); return }
      if (mod && e.shiftKey && ['KeyL', 'KeyE', 'KeyR', 'KeyJ'].includes(e.code) && s.length) { e.preventDefault(); align({ KeyL: 'l', KeyE: 'ctr', KeyR: 'r', KeyJ: 'just' }[e.code]); return }
      if (mod && !e.shiftKey && ['b', 'i', 'u'].includes(k2) && s.length) { e.preventDefault(); toggle({ b: 'b', i: 'i', u: 'u' }[k2]); return }
      if (mod) return
      if (s.length && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeSel(); return }
      if (s.length && e.key.startsWith('Arrow')) { e.preventDefault(); const n = e.shiftKey ? 1 : 8; nudge(e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0); return }
      // Esc lets go of the crop, then of what's picked; with nothing picked it's Focus's (focus.js).
      if (e.key === 'Escape') { if (crop != null || s.length) e.preventDefault(); if (crop != null) setCrop(null); else setSel([]); return }
      if (e.key === 'Tab' && viewOf(slidesRef.current[curRef.current]).objs.length) { e.preventDefault(); const all = viewOf(slidesRef.current[curRef.current]).objs.map((o) => o.at); const i = all.indexOf(s[0]); setSel([all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]]); return }
      if (e.key === 'Enter' && s.length === 1) { e.preventDefault(); startEdit(s[0], { start: { all: true } }); return }
      // A letter typed with a shape picked goes in its words.
      if (s.length === 1 && e.key.length === 1 && !e.altKey) {
        const o = objAt(s[0])
        if (o?.kind === 'sp') { pendingKey.current = e.key; if (startEdit(s[0], { start: { a: { p: 9999, o: 99999 } } })) e.preventDefault(); else pendingKey.current = null }
        return
      }
      if (!s.length) {
        if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(curRef.current - 1) }
        else if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); go(curRef.current + 1) }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  useEffect(() => { stripRef.current?.querySelector('.sd-thumb.on')?.scrollIntoView?.({ block: 'nearest' }) }, [at])
  const stepZoom = (d) => {
    if (!d) { setZoom('fit'); return }
    const now = zoom === 'fit' ? fitK : zoom
    setZoom(d > 0 ? ZOOMS.find((z) => z > now + 0.01) || ZOOMS.at(-1) : [...ZOOMS].reverse().find((z) => z < now - 0.01) || ZOOMS[0])
  }

  // ---------- Find and replace ----------
  const finder = useRef({ q: '', matchCase: false })
  const findAll = (q, matchCase) => {
    const out = []
    if (!q) return out
    slidesRef.current.forEach((s, si) => { for (const x of P.textsOf(s)) for (const m of X.findIn(x.t, q, { matchCase })) out.push({ si, key: s.key, at: x.at, path: x.path, cell: x.cell, ...m }) })
    return out
  }
  const showMatch = (m) => {
    if (!m) return
    setCur(m.si); setPicked(new Set())
    curRef.current = m.si
    startEdit(m.at, { si: m.si, path: m.path, cell: m.cell, start: { a: { p: m.p, o: m.start }, b: { p: m.p, o: m.end } } })
  }
  const findOn = {
    find: (q, matchCase) => { finder.current = { q, matchCase }; const list = findAll(q, matchCase); const i = Math.max(0, list.findIndex((m) => m.si >= curRef.current)); setFound({ list, at: i }); if (list.length && q) showMatchQuiet(list[i]) },
    go: (d) => { const { list, at: i } = found; if (!list.length) return; const n = (i + d + list.length) % list.length; setFound({ list, at: n }); showMatch(list[n]) },
    replace: (to) => {
      const m = found.list[found.at]
      if (!m) return
      flushTyping(); setEdit(null)
      const next = [...slidesRef.current]
      const s = next[m.si]
      const x = P.textsOf(s).find((y) => y.at === m.at && String(y.path) === String(m.path) && String(y.cell) === String(m.cell))
      if (!x) return
      next[m.si] = P.withTextAt(s, x, X.replaceAt(x.t, m, to))
      change(next)
      setTimeout(() => { const list = findAll(finder.current.q, finder.current.matchCase); const i = Math.min(found.at, Math.max(0, list.length - 1)); setFound({ list, at: i }); if (list[i]) showMatch(list[i]) }, 0)
    },
    replaceAll: (to) => {
      flushTyping(); setEdit(null)
      let n = 0
      const next = slidesRef.current.map((s) => { let out = s; for (const x of P.textsOf(s)) { const r = X.replaceAll(x.t, finder.current.q, to, { matchCase: finder.current.matchCase }); if (r.n) { n += r.n; out = P.withTextAt(out, x, r.t) } } return out })
      if (n) change(next)
      setFound({ list: [], at: 0 })
      setMsg({ text: n === 1 ? t('Replaced 1 match.') : t('Replaced {n} matches.', { n }) })
    },
  }
  // While typing what to find: the slide with the first match, without taking the caret.
  const showMatchQuiet = (m) => { setCur(m.si); setSel([m.at]); setEdit(null) }

  // ---------- Writing with AI ----------
  // What it writes is Markdown slides (as for a Markdown deck), shown first in Studio's look; kept,
  // each goes in on the file's own layout for its kind, its title and points in its placeholders.
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMode, setAiMode] = useState('deck')
  const previewer = useMemo(() => { const r = deckRenderer(); r.setLook(PLAIN); return r }, [])
  const aiCss = useMemo(() => (aiOpen ? previewer.render('---\nmarp: true\n---\n\n#').css : ''), [aiOpen, previewer])
  const asMarkdown = (s) => {
    const lines = []
    for (const o of viewOf(s).objs) {
      const words = o.textModel ? P.plainOf(o.textModel).trim() : ''
      if (!words) continue
      if (/title/i.test(o.ph?.type || '')) lines.unshift(`# ${words.replace(/\s*\n\s*/g, ' ')}`, '')
      else lines.push(...words.split('\n').filter((l) => l.trim()).map((l) => `- ${l}`))
    }
    if (s.notes.text) lines.push('', `<!-- ${s.notes.text.replace(/--+>/g, '—>')} -->`)
    return lines.join('\n').trim()
  }
  const aiSlides = () => { flushTyping(); return slidesRef.current.map(asMarkdown) }
  const aiDraw = (texts) => previewer.render(`---\nmarp: true\n---\n\n${texts.join('\n\n---\n\n')}\n`).slides
  const LAYOUT_TYPE = { title: ['title'], section: ['secHead'], cols: ['twoObj', 'twoTxTwoObj'], picture: ['picTx'] }
  const slideFromMarkdown = (md) => {
    const [m] = slidesOf(`---\nmarp: true\n---\n\n${md}\n`)
    const l = layouts.find((x) => (LAYOUT_TYPE[m.layout] || []).includes(x.type)) || layouts.find((x) => x.type === 'obj') || layouts.find((x) => x.type === 'tx') || layouts[0]
    let s = P.newSlide(doc, l.path)
    const runs = (rs) => (rs || []).filter((r) => !r.br).map((r) => ({ rPr: P.withRun('', { b: r.bold || null, i: r.italic || null }), text: r.text }))
    const para = (rs, pPr = '') => ({ pPr, runs: runs(rs), end: '' })
    const paras = (blocks) => blocks.flatMap((b) => (b.items ? b.items.map((it) => para(it.runs, P.withPara(it.level ? `<a:pPr lvl="${it.level}"/>` : '', it.ordered ? { bullet: 'num' } : {}))) : b.rows ? b.rows.map((r) => para([{ text: r.map((c) => c.map((x) => x.text).join('')).join('  ·  ') }], P.withPara('', { bullet: 'none' }))) : b.code ? [para([{ text: b.code }], P.withPara('', { bullet: 'none' }))] : [para(b.runs?.map((r) => ({ ...r, bold: r.bold || !!b.h })), P.withPara('', { bullet: 'none' }))]))
    const bodies = s.objs.map((x, i) => ({ i, type: /<p:ph\b[^>]*\stype="(\w+)"/.exec(x)?.[1] || 'body' }))
    const titleAt = bodies.find((b) => /title/i.test(b.type))
    const subAt = bodies.find((b) => b.type === 'subTitle')
    const bodyAts = bodies.filter((b) => b.type === 'body' || b.type === 'obj')
    const put = (at, ps) => { if (at && ps.length) s = P.withTextAt(s, { at: at.i }, { ...P.textAt(s.objs[at.i], {}), paras: ps }) }
    put(titleAt, m.title ? [para(m.title)] : [])
    let blocks = m.blocks
    if (m.subtitle && subAt) put(subAt, [para(m.subtitle)])
    else if (m.subtitle) blocks = [{ p: true, runs: m.subtitle }, ...blocks]
    if (subAt && !bodyAts.length && blocks.length) { put(subAt, paras(blocks)); blocks = [] }
    if (bodyAts.length > 1 && blocks.length > 1) { const half = Math.ceil(blocks.length / 2); put(bodyAts[0], paras(blocks.slice(0, half))); put(bodyAts[1], paras(blocks.slice(half))) } else put(bodyAts[0], paras(blocks))
    return m.notes ? P.withNotes(s, m.notes) : s
  }
  const keepAi = ({ mode, slides: texts, at: n, how }) => {
    flushTyping(); setEdit(null)
    const made = texts.map(slideFromMarkdown)
    const next = [...slidesRef.current]
    if (mode === 'deck' && how === 'replace') { change(made, { cur: 0, sel: [] }); setMsg({ text: t('Kept. Undo takes it back.') }); return }
    if (how === 'after') next.splice(n + 1, 0, ...made)
    else next.splice(n, 1, ...made)
    change(next, { cur: how === 'after' ? n + 1 : n, sel: [] })
    setMsg({ text: t('Kept, on this file\'s own layouts. Undo takes it back.') })
  }

  // ---------- Saving, exporting ----------
  handle.current = {
    save: async () => { flushTyping(); return P.writePptx(doc, slidesRef.current, { media: media.current }) },
    selection: () => {
      const s = window.getSelection?.()
      const text = s && !s.isCollapsed && canvasRef.current?.contains(s.anchorNode) ? s.toString() : P.textsOf(slidesRef.current[curRef.current]).map((x) => P.plainOf(x.t)).join('\n')
      return text ? { text, where: t('slide {n}', { n: curRef.current + 1 }) } : null
    },
    assist: () => (readOnly ? [] : deckAssist(aiOpen, aiMode, (m) => { if (aiOpen && aiMode === m) setAiOpen(false); else { setAiMode(m); setAiOpen(true) } })),
  }
  const printPdf = () => {
    flushTyping()
    const f = document.createElement('iframe')
    f.className = 'sd-print-frame'
    f.setAttribute('aria-hidden', 'true')
    const pages = slidesRef.current.map((s, i) => (s.hidden ? '' : `<div class="pg">${draw(s, i + 1)}</div>`)).join('')
    f.srcdoc = `<!doctype html><meta charset="utf-8"><title>${file.name.replace(/[<&]/g, '')}</title><style>${SLIDE_CSS}html,body{margin:0;background:#fff}.pg{width:${W}px;height:${H}px;overflow:hidden;page-break-after:always;break-after:page}@page{size:${W}px ${H}px;margin:0}</style>${pages}`
    f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print() } finally { setTimeout(() => f.remove(), 60_000) } }, 300) }
    document.body.appendChild(f)
  }
  // This slide as a picture: drawn into an SVG with its pictures in it, then a PNG.
  const savePng = async () => {
    flushTyping()
    try {
      const was = doc.urlOf
      const data = new Map()
      doc.urlOf = (part) => { if (!P.showable(part)) return null; if (!data.has(part)) { const b = doc.bin.get(part) || media.current.get(part)?.bytes; data.set(part, b ? `data:${P.mimeOf(part)};base64,${base64(b)}` : null) } return data.get(part) }
      const html = slideHtml(P.slideView(doc, slidesRef.current[curRef.current]), { number: curRef.current + 1, font, words })
      doc.urlOf = was
      const scale = 2
      // An SVG's own HTML has to be XML: the browser writes it so.
      const box = document.createElement('div')
      box.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
      box.innerHTML = `<style>${SLIDE_CSS}</style>${html}`
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}"><foreignObject width="${W}" height="${H}" transform="scale(${scale})">${new XMLSerializer().serializeToString(box)}</foreignObject></svg>`
      const img = new Image()
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error(t('the browser couldn\'t draw it'))); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; setTimeout(() => no(new Error(t('the browser took too long to draw it'))), 10_000) })
      const c = document.createElement('canvas')
      c.width = W * scale; c.height = H * scale
      c.getContext('2d').drawImage(img, 0, 0)
      const blob = await new Promise((ok, no) => { try { c.toBlob((b) => (b ? ok(b) : no(new Error(t('the browser couldn\'t draw it')))), 'image/png') } catch (e) { no(e) } })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${file.name.replace(/\.pptx$/i, '')} - ${t('slide {n}', { n: curRef.current + 1 })}.png`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
      setMsg({ text: t('Slide {n} saved as a picture, in your downloads.', { n: curRef.current + 1 }) })
    } catch (e) { setMsg({ text: t("Couldn't make the picture: {error}", { error: e.message }), error: true }) }
  }
  const saveMarkdown = async () => {
    flushTyping(); setMenu(null)
    try {
      const { deckFromPptx } = await import('../pptx.js')
      const deck = await deckFromPptx(await P.writePptx(doc, slidesRef.current, { media: media.current }), file.name)
      const name = file.name.replace(/\.pptx$/i, '')
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      let text = deck.md
      for (const m of deck.media) {
        const r = await api('/studio/picture', { method: 'POST', body: { root: file.root, path: file.path, name: `${name}-${m.id}`, data: base64(m.bytes) } })
        text = text.split(`](media:${m.id}`).join(`](${r.src}`)
      }
      const r = await api('/studio/new', { method: 'POST', body: { root: file.root, dir, text, name: `${name}.md` } })
      setMsg({ text: t('Saved as {name}, beside it.', { name: r.name }), open: r.path })
    } catch (e) { setMsg({ text: t("Couldn't make the Markdown deck: {error}", { error: e.message }), error: true }) }
  }
  const startPresent = (i) => { flushTyping(); setEdit(null); setPresent({ at: i }) }

  // ---------- Drawing ----------
  const promptOf = useCallback((o) => t(PROMPT[o.ph?.type] || PROMPT.body), [])
  const canvasHtml = useMemo(() => slideHtml(view, { number: at + 1, prompts: !readOnly, promptOf, editing: edit?.at, editCell: edit?.cell ? edit.cell.join(':') : null, font, words, uid: 'cv' }), [view, at, readOnly, promptOf, edit, font, words])
  const missing = useMemo(() => slides.reduce((acc, s) => { const m = missingIn(viewOf(s)); return acc + m.pictures + m.charts + m.diagrams + m.other }, 0), [slides, viewOf])
  const lost = slides.filter((s) => P.animationsLost(s)).length
  const editBox = (() => {
    if (!edit) return null
    const o = objAt(edit.at, viewOf(slide))
    if (!o) return null
    if (edit.cell) {
      const td = canvasRef.current?.querySelector(`[data-o="${edit.at}"] td[data-cell="${edit.cell.join(':')}"]`)
      const c = o.table?.rows[edit.cell[0]]?.cells[edit.cell[1]]
      if (!td || !c?.text) return null
      return { box: { x: o.x + td.offsetLeft, y: o.y + td.offsetTop, w: td.offsetWidth, h: td.offsetHeight }, view: c.text }
    }
    let x = o, box = boxOf(o)
    for (const i of edit.path || []) {
      const g = x
      x = g.kids?.[i]
      if (!x) return null
      const sx = g.ch.w ? box.w / g.ch.w : 1, sy = g.ch.h ? box.h / g.ch.h : 1
      box = { x: box.x + (x.x - g.ch.x) * sx, y: box.y + (x.y - g.ch.y) * sy, w: x.w * sx, h: x.h * sy, rot: x.rot }
    }
    return x.text ? { box, view: x.text } : null
  })()
  // A file with no notes master can't keep notes on a slide that has none (said, not lost).
  const canNote = !!doc.notesMaster || !!slide?.notes.path
  const shownSel = sel.map((i) => objAt(i)).filter(Boolean)
  const lookOn = (k2) => (canText ? !!lookNow?.[k2] : undefined)
  const one = shownSel.length === 1 ? shownSel[0] : null
  const fonts = [...new Set([theme?.fonts.major, theme?.fonts.minor, ...COMMON_FONTS].filter(Boolean))]
  const tableAt = one?.kind === 'table' ? one : null
  const cell = edit?.cell || [0, 0]

  return (
    <div className={`sd-deck2 sd-slides${aiOpen && !readOnly ? ' with-ai' : ''}`}>
      <style>{`${SLIDE_CSS}${aiCss}`}</style>
      <div className="sd-toolbar sd-deck-tools sd-slides-tools" role="toolbar" aria-label={t('Slides')}>
        <div className="px-row">
        {!readOnly && (
          <div className="sd-group">
            <span className="menu-anchor sd-split">
              <button type="button" className="sd-tool wide" onMouseDown={keep} onClick={() => addSlide()} title={withKeys(t('New slide'), 'mod', 'm')} aria-label={t('New slide')}><Icon name="plus" size={15} /><span className="sd-tool-label">{t('New slide')}</span></button>
              <button type="button" className={`sd-tool caret${menu === 'new' ? ' on' : ''}`} onClick={() => setMenu(menu === 'new' ? null : 'new')} aria-label={t('New slide in a layout')} title={t('New slide in a layout')} aria-haspopup="menu" aria-expanded={menu === 'new'}><Icon name="down" size={12} /></button>
              {menu === 'new' && <Layouts doc={doc} layouts={layouts} draw={draw} label={t('New slide in a layout')} onPick={(p) => addSlide(p)} onClose={() => setMenu(null)} />}
            </span>
            <Btn name={t('Undo')} icon="undo" run={undo} k={['mod', 'z']} disabled={!hist.current.past.length} />
            <Btn name={t('Redo')} icon="redo" run={redo} k={['shift', 'mod', 'z']} disabled={!hist.current.future.length} />
            <Pop name={t('Zoom')} icon="zoom" text={zoom === 'fit' ? t('Fit') : `${Math.round(zoom * 100)}%`} className="sd-zoom-drop" panel={(close) => (<>
              <Item label={t('Fit')} on={zoom === 'fit'} run={() => setZoom('fit')} close={close} keys={['mod', 'alt', '0']} />
              {ZOOMS.map((z) => <Item key={z} label={`${Math.round(z * 100)}%`} on={zoom === z} run={() => setZoom(z)} close={close} />)}
            </>)} />
          </div>
        )}
        {!readOnly && (
          <div className="sd-group">
            <Btn name={t('Text box')} icon="text-box" run={addTextBox} />
            <Btn name={t('Picture')} icon="image" run={() => picInput.current?.click()} tip={t('Put a picture on this slide (or paste or drop one on it)')} />
            <input ref={picInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={(e) => { addPicture(e.target.files?.[0]); e.target.value = '' }} />
            <input ref={replaceInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={(e) => { addPicture(e.target.files?.[0], { replaceAt: sel[0] }); e.target.value = '' }} />
            <Pop name={t('Shape')} icon="shapes" wide panel={(close) => <div className="px-shape-grid">{SHAPES.map(([id, label]) => <button key={id} type="button" className="sd-item" onClick={() => { close(); addShape(id) }} title={t(label)} aria-label={t(label)}><svg viewBox="0 0 24 18" width="24" height="18" aria-hidden="true"><path d={shapeIcon(id)} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>)}</div>} />
            <Pop name={t('Line')} icon="line" panel={(close) => (<>
              <Item label={t('Line')} run={() => addLine(false)} close={close} />
              <Item label={t('Arrow')} run={() => addLine(true)} close={close} />
            </>)} />
            <Pop name={t('Table')} icon="table" panel={(close) => <GridPick onPick={(r, c) => { close(); addTable(r, c) }} />} />
            <Pop name={t('Layout')} icon="split" label tip={t('This slide\'s layout: {name}', { name: doc.layoutOf(slide?.layout)?.name || '' })} panel={(close) => <Layouts doc={doc} layouts={layouts} draw={draw} inline on={slide?.layout} label={t('Layout of slide {n}', { n: at + 1 })} onPick={(p) => { close(); setLayout(p) }} onClose={close} />} />
          </div>
        )}
        <span className="sd-grow" />
        <div className="sd-group">
          <Btn name={t('Find and replace')} icon="search" run={() => setFind({ replace: true, n: Date.now() })} k={['mod', 'f']} />
          <Btn name={t('Grid')} icon="grid" on={grid} run={() => { flushTyping(); setEdit(null); setGrid((x) => !x) }} tip={t('Every slide at once, to see the whole deck and drag slides into order')} />
        </div>
        <div className="sd-group">
          <span className="menu-anchor sd-split">
            <button type="button" className="btn small primary sd-present-btn" onClick={() => startPresent(at)} title={withKeys(t('Present from this slide'), 'mod', 'enter')} aria-label={t('Present')}><Icon name="play" size={12} /> <span className="sd-btn-label">{t('Present')}</span></button>
            <button type="button" className={`sd-tool caret${menu === 'present' ? ' on' : ''}`} onClick={() => setMenu(menu === 'present' ? null : 'present')} aria-label={t('More ways to present')} title={t('More ways to present')} aria-haspopup="menu" aria-expanded={menu === 'present'}><Icon name="down" size={12} /></button>
            {menu === 'present' && <Menu label={t('Present')} className="right" onClose={() => setMenu(null)} items={[
              { label: t('From the beginning'), icon: 'play', run: () => startPresent(0), keys: keys('shift', 'mod', '↵') },
              { label: t('From this slide'), icon: 'play', run: () => startPresent(at), keys: keys('mod', '↵') },
              { label: t('Presenter view'), icon: 'panel-right', run: () => { flushTyping(); setEdit(null); setPresent({ at, presenter: true }) } },
            ]} />}
          </span>
          <span className="menu-anchor">
            <button type="button" className="sd-tool wide" onClick={() => setMenu(menu === 'export' ? null : 'export')} title={t('A PDF, a picture of this slide, or a Markdown deck')} aria-label={t('Export')} aria-haspopup="menu" aria-expanded={menu === 'export'}><Icon name="download" size={15} /><span className="sd-tool-label">{t('Export')}</span></button>
            {menu === 'export' && <Menu label={t('Export')} className="right" onClose={() => setMenu(null)} items={[
              { label: t('PDF (print it, or save as PDF)'), icon: 'doc', run: printPdf },
              { label: t('This slide as a picture (PNG)'), icon: 'image', run: savePng },
              { label: t('Markdown deck, beside it'), icon: 'code', run: saveMarkdown },
            ]} />}
          </span>
        </div>
        </div>
        {!readOnly && (
          <div className="px-row px-format" aria-label={t('Format')}>
        {!readOnly && canText && (
          <div className="sd-group sd-marks">
            <Pop name={t('Font')} text={lookNow?.font || ''} className="sd-font-drop" panel={(close) => fonts.map((f) => <Item key={f} label={f} style={{ fontFamily: P.fontCss(f) }} on={lookNow?.font === f} run={() => fmt({ font: f })} close={close} hint={fontHere(f) ? '' : t('not on this computer')} />)} />
            <span className="sd-size">
              <Btn name={t('Smaller')} icon="size-down" run={() => stepSize(-1)} k={['shift', 'mod', ',']} />
              <Pop name={t('Size')} text={lookNow?.sz ?? ''} className="sd-size-drop" panel={(close) => SIZES.map((z) => <Item key={z} label={String(z)} on={lookNow?.sz === z} run={() => fmt({ sz: z })} close={close} />)} />
              <Btn name={t('Bigger')} icon="size-up" run={() => stepSize(1)} k={['shift', 'mod', '.']} />
            </span>
            <Btn name={t('Bold')} icon="bold" run={() => toggle('b')} on={lookOn('b')} k={['mod', 'b']} />
            <Btn name={t('Italic')} icon="italic" run={() => toggle('i')} on={lookOn('i')} k={['mod', 'i']} />
            <Btn name={t('Underline')} icon="underline" run={() => toggle('u')} on={lookOn('u')} k={['mod', 'u']} />
            <Btn name={t('Strikethrough')} icon="strike" run={() => toggle('strike')} on={lookOn('strike')} k={['shift', 'mod', 'x']} />
            <Pop name={t('Text colour')} icon="text-color" swatch={lookNow?.color ? `#${lookNow.color}` : null} panel={(close) => <Swatches value={lookNow?.color} onPick={(c) => fmt({ color: c })} auto={t('As its style has it')} close={close} />} />
            <Pop name={t('Align')} icon={{ ctr: 'align-center', r: 'align-right', just: 'align-justify' }[lookNow?.algn] || 'align-left'} panel={(close) => (<>
              {[['l', 'Left', 'align-left', 'l'], ['ctr', 'Centre', 'align-center', 'e'], ['r', 'Right', 'align-right', 'r'], ['just', 'Justified', 'align-justify', 'j']].map(([a, label, icon, key]) => <Item key={a} label={t(label)} icon={icon} on={lookNow?.algn === a} run={() => align(a)} close={close} keys={['shift', 'mod', key]} />)}
            </>)} />
            <Pop name={t('Line spacing')} icon="line-spacing" panel={(close) => SPACINGS.map(([v, label]) => <Item key={v} label={t(label)} on={Math.abs((lookNow?.lnSpc || 1) - v) < 0.01} run={() => paraFmt({ lnSpc: v })} close={close} />)} />
            <Btn name={t('Bulleted list')} icon="list" run={() => bullets('char')} on={canText ? lookNow?.bullet === 'char' : undefined} k={['shift', 'mod', '8']} />
            <Btn name={t('Numbered list')} icon="list-ordered" run={() => bullets('num')} on={canText ? lookNow?.bullet === 'num' : undefined} k={['shift', 'mod', '7']} />
            <Btn name={t('Decrease indent')} icon="outdent" run={() => indent(-1)} k={['shift', 'tab']} />
            <Btn name={t('Increase indent')} icon="indent" run={() => indent(1)} k={['tab']} />
            <Btn name={t('Clear formatting')} icon="eraser" run={() => fmt({ b: null, i: null, u: null, strike: null, sz: null, color: null, font: null })} k={['mod', '\\']} />
          </div>
        )}
        {!readOnly && shownSel.length > 0 && !edit && (
          <div className="sd-group">
            {shownSel.some((o) => o.kind === 'sp' || o.kind === 'grp') && <Pop name={t('Fill colour')} icon="fill" swatch={one?.fill?.type === 'solid' ? `#${one.fill.color?.hex}` : null} panel={(close) => <Swatches value={one?.fill?.color?.hex} onPick={(c) => setFill(c || 'none')} auto={t('No fill')} close={close} />} />}
            {shownSel.some((o) => o.kind === 'sp' || o.kind === 'cxn' || o.kind === 'pic') && <Pop name={t('Border colour')} icon="border" swatch={one?.line?.color ? `#${one.line.color.hex}` : null} panel={(close) => <Swatches value={one?.line?.color?.hex} onPick={(c) => setLine({ color: c || 'none' })} auto={t('No border')} close={close} />} />}
            {shownSel.some((o) => o.kind === 'sp' || o.kind === 'cxn' || o.kind === 'pic') && <Pop name={t('Border weight')} icon="line-spacing" panel={(close) => [1, 2, 3, 4, 6, 8, 12].map((w) => <Item key={w} label={t('{n} px', { n: w })} on={Math.round(one?.line?.width || 0) === w} run={() => setLine({ width: w })} close={close} />)} />}
            {one?.kind === 'pic' && <Btn name={t('Crop')} icon="crop" on={crop === one.at} run={() => setCrop(crop === one.at ? null : one.at)} tip={t('Crop: drag its edges (or double-click the picture); Enter or Esc when done')} />}
            {one?.kind === 'pic' && <Btn name={t('Replace picture')} icon="image" run={() => replaceInput.current?.click()} />}
            {tableAt && <Pop name={t('Rows and columns')} icon="table" panel={(close) => (<>
              <Item label={t('Row above')} run={() => tableEdit((xml) => P.withRow(xml, cell[0], true))} close={close} />
              <Item label={t('Row below')} run={() => tableEdit((xml) => P.withRow(xml, cell[0] + 1, true))} close={close} />
              <Item label={t('Column left')} run={() => tableEdit((xml) => P.withCol(xml, cell[1], true))} close={close} />
              <Item label={t('Column right')} run={() => tableEdit((xml) => P.withCol(xml, cell[1] + 1, true))} close={close} />
              <div className="menu-sep" />
              <Item label={t('Delete row')} run={() => tableEdit((xml) => P.withRow(xml, cell[0], false))} close={close} danger />
              <Item label={t('Delete column')} run={() => tableEdit((xml) => P.withCol(xml, cell[1], false))} close={close} danger />
            </>)} />}
            <Pop name={t('Arrange')} icon="arrange" panel={(close) => (<>
              <Item label={t('Bring to front')} run={() => reorder('front')} close={close} keys={['shift', 'mod', '↑']} />
              <Item label={t('Bring forward')} run={() => reorder('forward')} close={close} keys={['mod', '↑']} />
              <Item label={t('Send backward')} run={() => reorder('backward')} close={close} keys={['mod', '↓']} />
              <Item label={t('Send to back')} run={() => reorder('back')} close={close} keys={['shift', 'mod', '↓']} />
              <div className="menu-sep" />
              {[['left', 'Align left'], ['center', 'Align centre'], ['right', 'Align right'], ['top', 'Align top'], ['middle', 'Align middle'], ['bottom', 'Align bottom']].map(([h, label]) => <Item key={h} label={t(label)} hint={shownSel.length > 1 ? '' : t('to the slide')} run={() => alignSel(h)} close={close} />)}
              <Item label={t('Distribute across')} run={() => distribute('h')} close={close} disabled={shownSel.length < 3} />
              <Item label={t('Distribute down')} run={() => distribute('v')} close={close} disabled={shownSel.length < 3} />
              <div className="menu-sep" />
              <Item label={t('Group')} run={group} close={close} disabled={shownSel.length < 2} keys={['alt', 'mod', 'g']} />
              <Item label={t('Ungroup')} run={ungroup} close={close} disabled={one?.kind !== 'grp'} keys={['alt', 'shift', 'mod', 'g']} />
              <div className="menu-sep" />
              <Item label={t('Rotate 90° right')} run={() => turn(90)} close={close} />
              <Item label={t('Rotate 90° left')} run={() => turn(-90)} close={close} />
              <Item label={t('Flip across')} run={() => turn(0, 'flipH')} close={close} />
              <Item label={t('Flip down')} run={() => turn(0, 'flipV')} close={close} />
            </>)} />
            <Btn name={t('Delete')} icon="trash" run={removeSel} k={['⌫']} />
          </div>
        )}
            {!canText && !shownSel.length && <span className="muted small px-hint">{t('Click something on the slide to change it: words, shapes, pictures, tables. Double-click a picture to crop it.')}</span>}
          </div>
        )}
      </div>
      {find && <DeckFind key={find.n} count={found.list.length} at={found.at} replace={find.replace} on={findOn} onClose={() => { setFind(null); setFound({ list: [], at: 0 }) }} />}
      {msg && <p className={`small sd-note${msg.error ? ' error-text' : ''}`} role={msg.error ? 'alert' : 'status'}>{msg.text} {msg.open && <button type="button" className="link-btn" onClick={() => onOpen?.({ root: file.root, path: msg.open })}>{t('Open it')}</button>} <button type="button" className="link-btn" onClick={() => setMsg(null)}>{t('Close')}</button></p>}
      {(missing > 0 || lost > 0) && <p className="small sd-note sd-deck-said"><Icon name="info" size={12} /> {missing > 0 && (missing === 1 ? t('1 thing on its slides isn\'t shown here (a chart, diagram or picture Studio can\'t draw); it\'s kept in the file as it is.') : t('{n} things on its slides aren\'t shown here (charts, diagrams or pictures Studio can\'t draw); they\'re kept in the file as they are.', { n: missing }))} {lost > 0 && t('Animations on {n} slides name something taken off them, so they go when it\'s saved.', { n: lost })}</p>}
      <div className="sd-deck-body">
        <ol className="sd-strip" ref={stripRef} aria-label={t('Slides')} aria-multiselectable="true">
          {slides.map((s, i) => <Thumb key={s.key} s={s} i={i} draw={draw} w={160} h={Math.round((160 * H) / W)} on={i === at} picked={picked.has(s.key)} readOnly={readOnly}
            drop={drop && drop.to === i ? (drop.before ? 'before' : 'after') : null}
            onPick={(e) => go(i, { extend: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
            onMenu={(e) => { e.preventDefault(); if (!picked.has(s.key)) go(i); setCtx({ i, x: e.clientX, y: e.clientY }) }}
            onDragStart={() => { if (!picked.has(s.key)) go(i); dragFrom.current = i; setDrop({ to: i, before: true }) }}
            onDragOver={(before) => setDrop((d) => (d ? { to: i, before } : d))}
            onDrop={(before) => { const from = dragFrom.current; dragFrom.current = null; setDrop(null); if (from == null) return; moveSlides(before ? i : i + 1) }}
            onDragEnd={() => { dragFrom.current = null; setDrop(null) }} />)}
          {!readOnly && <li className="sd-strip-add"><button type="button" className="ghost-btn" onClick={() => { setCur(count - 1); setTimeout(() => addSlide(), 0) }} title={t('New slide at the end')}><Icon name="plus" size={13} /> {t('New slide')}</button></li>}
        </ol>
        {ctx && <div className="sd-ctx" style={{ left: ctx.x, top: ctx.y }}><Menu label={t('Slide {n}', { n: ctx.i + 1 })} onClose={() => setCtx(null)} items={[
          { label: t('New slide'), icon: 'plus', run: () => addSlide(), keys: keys('mod', 'm') },
          { label: t('Duplicate'), icon: 'copy', run: duplicateSlides, keys: keys('mod', 'd') },
          { label: t('Copy'), icon: 'copy', run: () => copy('slides'), keys: keys('mod', 'c') },
          { label: t('Paste'), icon: 'clipboard', run: paste, disabled: !clip, keys: keys('mod', 'v') },
          '-',
          slides[ctx.i]?.hidden ? { label: t('Don\'t skip'), icon: 'eye', run: () => skipSlides(false) } : { label: t('Skip when presenting'), icon: 'eye-off', run: () => skipSlides(true) },
          { label: t('Move up'), icon: 'up', run: () => moveSlides(Math.max(0, pickedList()[0] - 1)), disabled: ctx.i === 0, keys: keys('mod', '↑') },
          { label: t('Move down'), icon: 'down', run: () => moveSlides(pickedList().at(-1) + 2), disabled: ctx.i >= count - 1, keys: keys('mod', '↓') },
          '-',
          { label: t('Present from here'), icon: 'play', run: () => startPresent(ctx.i) },
          '-',
          { label: picked.size > 1 ? t('Delete {n} slides', { n: pickedList().length }) : t('Delete the slide'), icon: 'trash', run: removeSlides, danger: true, disabled: count <= 1 },
        ]} /></div>}
        {grid ? (
          <div className="sd-sorter" aria-label={t('Every slide')}>
            <ol>{slides.map((s, i) => <Thumb key={s.key} s={s} i={i} draw={draw} w={0} h={0} aspect={W / H} on={i === at} picked={picked.has(s.key)} readOnly={readOnly}
              drop={drop && drop.to === i ? (drop.before ? 'before' : 'after') : null}
              onPick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) go(i, { extend: e.shiftKey, toggle: e.metaKey || e.ctrlKey }); else { go(i); setGrid(false) } }}
              onMenu={(e) => { e.preventDefault(); go(i); setCtx({ i, x: e.clientX, y: e.clientY }) }}
              onDragStart={() => { if (!picked.has(s.key)) go(i); dragFrom.current = i; setDrop({ to: i, before: true }) }}
              onDragOver={(before) => setDrop((d) => (d ? { to: i, before } : d))}
              onDrop={(before) => { const from = dragFrom.current; dragFrom.current = null; setDrop(null); if (from == null) return; moveSlides(before ? i : i + 1) }}
              onDragEnd={() => { dragFrom.current = null; setDrop(null) }} />)}</ol>
          </div>
        ) : (
          <div className="sd-work">
            <div className="sd-stage px-stage" ref={stageEl} tabIndex={-1} onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault() }} onDrop={onStageDrop}
              onPointerDown={(e) => { if (e.target === e.currentTarget) { if (editRef.current) stopEdit(); setSel([]); setCrop(null) } }}>
              {stage.w > 0 && (
                <div className={`sd-canvas px-canvas${crop != null ? ' cropping' : ''}`} ref={canvasRef} style={{ width: Math.round(W * k), height: Math.round(H * k) }}
                  onPointerDown={onCanvasDown} onDoubleClick={onCanvasDouble} onPointerMove={(e) => { if (!drag.current) { const h = e.target.closest('[data-o]'); setHover(h ? Number(h.dataset.o) : null) } }} onPointerLeave={() => setHover(null)}
                  onContextMenu={(e) => { const h = e.target.closest('[data-o]'); if (!h || readOnly) return; e.preventDefault(); const i = Number(h.dataset.o); if (!sel.includes(i)) setSel([i]); setCtx(null); setMenu(null); setObjMenu({ x: e.clientX, y: e.clientY }) }}>
                  <div className="px-in" style={{ width: W, height: H, transform: `scale(${k})` }}>
                    <div className="px-draw" dangerouslySetInnerHTML={{ __html: canvasHtml }} />
                    {editBox && <TextEdit key={`${edit.n}`} box={editBox.box} view={editBox.view} start={edit.start} onInput={onEditInput} onKey={onEditKey} onPaste={onEditPaste} onSelect={onEditSelect} onReady={onEditReady} edRef={ed} />}
                  </div>
                  <div className="px-sel" aria-hidden="true">
                    {hover != null && !sel.includes(hover) && !preview && objAt(hover) && <Frame o={objAt(hover)} k={k} className="hover" />}
                    {!edit && shownSel.map((o) => <Frame key={o.at} o={o} k={k} className={crop === o.at ? 'crop' : ''} handles={!readOnly && shownSel.length === 1} rotate={!readOnly && shownSel.length === 1 && crop == null} onHandle={onHandleDown} crop={crop === o.at ? o.img?.crop : null} />)}
                    {edit && editBox && <Frame o={{ ...editBox.box, rot: editBox.box.rot }} k={k} className="editing" />}
                    {!edit && shownSel.length > 1 && <Frame o={unionOf(shownSel)} k={k} className="group" handles={!readOnly} onHandle={onHandleDown} />}
                    {guides.map((g, i) => <i key={i} className="px-guide" style={g.x != null ? { left: g.x * k, top: 0, bottom: 0, width: 1 } : { top: g.y * k, left: 0, right: 0, height: 1 }} />)}
                    {marquee && <i className="px-marquee" style={{ left: marquee.x * k, top: marquee.y * k, width: marquee.w * k, height: marquee.h * k }} />}
                  </div>
                </div>
              )}
            </div>
            <div className="sd-nav" role="toolbar" aria-label={t('Slides')}>
              <button type="button" className="win-btn" onClick={() => go(at - 1)} disabled={at === 0} aria-label={t('Back')} title={t('Back')}><Icon name="chevron" size={16} className="flip" /></button>
              <span className="sd-nav-n">{t('{n} of {count}', { n: at + 1, count })}</span>
              <button type="button" className="win-btn" onClick={() => go(at + 1)} disabled={at >= count - 1} aria-label={t('Next')} title={t('Next')}><Icon name="chevron" size={16} /></button>
              <button type="button" className="ghost-btn" onClick={() => setGrid(true)}><Icon name="grid" size={14} /> {t('All slides')}</button>
            </div>
            <div className="sd-notes">
              <button type="button" className="sd-notes-head" onClick={() => setNotesOpen((x) => !x)} aria-expanded={notesOpen}>
                <Icon name="chevron" size={12} className={notesOpen ? 'down' : ''} /> {t('Speaker notes')}{!notesOpen && slide?.notes.text && <span className="muted"> · {slide.notes.text.slice(0, 80)}</span>}
              </button>
              {notesOpen && <Notes key={slide?.key} value={slide?.notes.text || ''} readOnly={readOnly || !canNote} onChange={(text) => setSlide(P.withNotes(slidesRef.current[curRef.current], text), { typing: `notes:${slide.key}` })} placeholder={canNote ? t('Click to add speaker notes') : t('This file has no notes pages, so notes can\'t be kept in it: add them in PowerPoint once, then here.')} />}
            </div>
          </div>
        )}
        {aiOpen && !readOnly && <AiPanel file={file} getSlides={aiSlides} at={at} mode={aiMode} setMode={setAiMode} draw={aiDraw} onKeep={keepAi} onClose={() => setAiOpen(false)} />}
      </div>
      {objMenu && <div className="sd-ctx" style={{ left: objMenu.x, top: objMenu.y }}><Menu label={t('What\'s picked')} onClose={() => setObjMenu(null)} items={[
        { label: t('Cut'), icon: 'copy', run: () => { copy('objs'); removeSel() }, keys: keys('mod', 'x') },
        { label: t('Copy'), icon: 'copy', run: () => copy('objs'), keys: keys('mod', 'c') },
        { label: t('Paste'), icon: 'clipboard', run: paste, disabled: !clip, keys: keys('mod', 'v') },
        { label: t('Duplicate'), icon: 'copy', run: duplicateSel, keys: keys('mod', 'd') },
        '-',
        { label: t('Bring to front'), icon: 'up', run: () => reorder('front'), keys: keys('shift', 'mod', '↑') },
        { label: t('Send to back'), icon: 'down', run: () => reorder('back'), keys: keys('shift', 'mod', '↓') },
        '-',
        { label: t('Delete'), icon: 'trash', run: removeSel, danger: true, keys: '⌫' },
      ]} /></div>}
      {present && <Present slides={slides.map((s, i) => draw(s, i + 1))} notes={slides.map((s) => s.notes.text)} skip={slides.map((s) => s.hidden)} start={present.at} presenter={!!present.presenter} aspect={W / H} render={(html, w) => <Drawn html={html} w={w} W={W} H={H} />} onAt={setCur} onClose={() => setPresent(null)} />}
    </div>
  )
}

// A drawn slide at width w (the strip, the grid, galleries, presenting).
const Drawn = memo(function Drawn({ html, w, W, H, className = '' }) {
  const [ref, size] = useSize()
  const width = w || size.w
  return (
    <div ref={ref} className={`sd-slide px-slide-box ${className}`} style={w ? { width: w, height: Math.round((w * H) / W) } : { width: '100%', aspectRatio: `${W} / ${H}` }}>
      {width > 0 && <div className="px-in" style={{ width: W, height: H, transform: `scale(${width / W})` }} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  )
})
// A slide in the strip or the grid: its number, its drawing, skipped or not; picked by a click (⌘
// or ⇧ for more), dragged into order, its menu on a right click.
const Thumb = memo(function Thumb({ s, i, draw, w, h, on, picked, readOnly, drop, onPick, onMenu, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const html = useMemo(() => draw(s, i + 1), [s, i, draw])
  const v = /width:([\d.]+)px;height:([\d.]+)px/.exec(html)
  const W = Number(v?.[1] || 1280), H = Number(v?.[2] || 720)
  return (
    <li className={`sd-thumb${on ? ' on' : ''}${picked ? ' picked' : ''}${s.hidden ? ' skipped' : ''}${drop ? ` drop-${drop}` : ''}`} draggable={!readOnly}
      onClick={(e) => { e.currentTarget.querySelector('.sd-thumb-btn')?.focus({ preventScroll: true }); onPick(e) }} onContextMenu={readOnly ? undefined : onMenu}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); onDragStart() }}
      onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onDragOver(w ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2) }}
      onDrop={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onDrop(w ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2) }} onDragEnd={onDragEnd}>
      <span className="sd-thumb-n">{i + 1}{s.hidden && <G name="skip" size={12} />}</span>
      <button type="button" className="sd-thumb-btn" aria-current={on ? 'true' : undefined} aria-selected={on || picked} aria-label={s.hidden ? t('Slide {n}, skipped', { n: i + 1 }) : t('Slide {n}', { n: i + 1 })} title={s.hidden ? t('Slide {n}: skipped when presenting', { n: i + 1 }) : t('Slide {n}', { n: i + 1 })}><Drawn html={html} w={w} W={W} H={H} /></button>
      {!readOnly && <button type="button" className="sd-thumb-more" onClick={(e) => { e.stopPropagation(); onMenu(e) }} aria-label={t('More for slide {n}', { n: i + 1 })} title={t('More for slide {n}', { n: i + 1 })}><Icon name="more" size={13} /></button>}
    </li>
  )
})
// What's picked, outlined over the slide (in the screen's px, so the handles stay their size).
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
function Frame({ o, k, className = '', handles = false, rotate = false, onHandle, crop = null }) {
  const style = { left: o.x * k, top: o.y * k, width: Math.max(1, o.w * k), height: Math.max(1, o.h * k), transform: o.rot ? `rotate(${o.rot}deg)` : undefined }
  let ghost = null
  if (crop) {
    const iw = o.w / Math.max(0.01, 1 - crop.l - crop.r), ih = o.h / Math.max(0.01, 1 - crop.t - crop.b)
    ghost = <i className="px-crop-ghost" style={{ left: -crop.l * iw * k, top: -crop.t * ih * k, width: iw * k, height: ih * k }} />
  }
  return (
    <div className={`px-frame ${className}`} style={style}>
      {ghost}
      {handles && HANDLES.map((h) => <i key={h} className={`px-handle ${h}`} onPointerDown={(e) => onHandle(e, h)} />)}
      {rotate && <i className="px-handle rot" onPointerDown={(e) => onHandle(e, 'rot')} title={t('Turn it (⇧ for steps of 15°)')} />}
    </div>
  )
}
// The deck's layouts, each drawn as an empty slide on it.
function Layouts({ doc, layouts, draw, label, on, onPick, onClose, inline = false }) {
  const ref = useRef(null)
  useEffect(() => {
    if (inline) return undefined
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [onClose, inline])
  const drawn = useMemo(() => layouts.map((l) => ({ ...l, html: draw(P.newSlide(doc, l.path), 1, { prompts: true, promptOf: (o) => t(PROMPT[o.ph?.type] || PROMPT.body) }) })), [layouts, doc, draw])
  const size = /width:([\d.]+)px;height:([\d.]+)px/.exec(drawn[0]?.html || '')
  const W = Number(size?.[1] || 1280), H = Number(size?.[2] || 720)
  return (
    <div className={`${inline ? '' : 'menu left '}sd-gallery px-layouts`} ref={ref} role="menu" aria-label={label}>
      <b className="sd-gallery-head">{label}</b>
      <div className="sd-gallery-grid">
        {drawn.map((l) => (
          <button type="button" key={l.path} role="menuitemradio" aria-checked={on === l.path} className={on === l.path ? 'on' : ''} onClick={() => { if (!inline) onClose(); onPick(l.path) }} title={l.name}>
            <Drawn html={l.html} w={124} W={W} H={H} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
// A table's size, picked from a grid of cells.
function GridPick({ onPick }) {
  const [over, setOver] = useState([0, 0])
  return (
    <div className="sd-grid-pick">
      <div className="sd-grid-cells" onMouseLeave={() => setOver([0, 0])}>
        {Array.from({ length: 64 }, (_, i) => { const r = Math.floor(i / 8) + 1, c = (i % 8) + 1; return <button key={i} type="button" className={`sd-grid-cell${r <= over[0] && c <= over[1] ? ' on' : ''}`} onMouseEnter={() => setOver([r, c])} onFocus={() => setOver([r, c])} onClick={() => onPick(r, c)} aria-label={t('{rows} by {cols}', { rows: r, cols: c })} /> })}
      </div>
      <span className="muted small">{over[0] ? t('{rows} by {cols}', { rows: over[0], cols: over[1] }) : t('Pick its size')}</span>
    </div>
  )
}
// A shape's outline for its button.
function shapeIcon(id) {
  return { rect: 'M3 3h18v12H3z', roundRect: 'M6 3h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z', ellipse: 'M12 3a9 6 0 1 0 0 12a9 6 0 1 0 0-12z', triangle: 'M12 2 21 16H3z', rtTriangle: 'M3 2v14h18z', diamond: 'M12 1l9 8-9 8-9-8z', parallelogram: 'M7 3h14l-4 12H3z', hexagon: 'M7 2h10l5 7-5 7H7L2 9z', star5: 'M12 1l3 6 6 .5-4.5 4 1.5 6-6-3.5-6 3.5 1.5-6L3 7.5 9 7z', rightArrow: 'M2 6h12V2l8 7-8 7v-4H2z', leftArrow: 'M22 6H10V2L2 9l8 7v-4h12z', chevron: 'M2 2h14l6 7-6 7H2l6-7z', wedgeRoundRectCallout: 'M5 2h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-9l-4 4v-4H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', plus: 'M9 2h6v5h6v5h-6v5H9v-5H3V7h6z', heart: 'M12 16S3 10.5 3 6a4 4 0 0 1 9-1 4 4 0 0 1 9 1c0 4.5-9 10-9 10z', can: 'M4 4a8 2.5 0 0 0 16 0a8 2.5 0 0 0-16 0v10a8 2.5 0 0 0 16 0V4' }[id] || 'M3 3h18v12H3z'
}
// The speaker notes of a slide, kept as typed and put in as they're typed.
function Notes({ value, readOnly, onChange, placeholder }) {
  const [text, setText] = useState(value)
  const id = useRef(null)
  const box = useRef(null)
  useEffect(() => () => clearTimeout(id.current), [])
  useEffect(() => { if (document.activeElement !== box.current) setText(value) }, [value])
  return <textarea ref={box} className="sd-notes-box" value={text} readOnly={readOnly} placeholder={placeholder} aria-label={placeholder} onChange={(e) => { const v = e.target.value; setText(v); clearTimeout(id.current); id.current = setTimeout(() => onChange(v), 300) }} onBlur={() => { clearTimeout(id.current); if (text !== value) onChange(text) }} />
}
