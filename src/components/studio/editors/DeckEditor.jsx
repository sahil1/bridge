import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api, BASE } from '../../../api.js'
import { t } from '../../../i18n/index.js'
import { textOf, base64 } from '../files.js'
import { keys, withKeys } from '../keys.js'
import * as D from '../deck.js'
import { slidesOf, pptxOf, deckFromPptx } from '../pptx.js'
import { Slide, Menu, LayoutGallery, ThemeGallery, Present, AiPanel, LAYOUT_LABEL, sampleOf, useSize } from './DeckParts.jsx'
import '../deck.css'

// A deck, edited as slides: the slides down the side (added, duplicated, deleted, dragged into
// order), the slide in the middle with its words typed right on it ("Click to add title" where a
// part is empty), its speaker notes under it, layouts and themes (your design packs, and Studio's
// own), pictures, presenting full screen, and AI that writes a deck, a slide or a new one and shows
// it before it's taken. Every change is the deck's Markdown (Marp's format), which can be shown and
// typed beside it. A PowerPoint opens the same way (its text, pictures, notes and theme) and is
// saved as one. packs: the design packs. onStats: the status line's "Slide 2 of 9".
export default function DeckEditor({ file, data, onDirty, onStats, handle, readOnly = false, packs = [], onOpen }) {
  const pptx = file.ext === '.pptx'
  const [start, setStart] = useState(() => (pptx ? null : { md: textOf(data), media: [], look: null, skipped: 0 }))
  const [err, setErr] = useState(null)
  useEffect(() => { if (pptx) deckFromPptx(data, file.name).then(setStart, (e) => setErr(e.message)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="sd-empty" role="alert"><Icon name="alert" size={20} /><b>{t("Couldn't read its slides: {error}", { error: err })}</b><span className="muted small">{t('Ask an agent to change it, or open it in PowerPoint or Keynote.')}</span></div>
  if (!start) return <div className="sd-empty sd-loading" role="status"><Icon name="refresh" size={16} className="spin" /><span className="muted">{t('Opening {name}…', { name: file.name })}</span></div>
  return <Deck file={file} start={start} pptx={pptx} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} packs={packs} onOpen={onOpen} />
}

const ghostWords = () => ({ title: t('Click to add title'), subtitle: t('Click to add subtitle'), text: t('Click to add text'), quote: t('Click to add a quote') })
const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')
// Where the caret is in a block, as a count of its characters; and put back there.
function caretIn(el) {
  const sel = window.getSelection?.()
  if (!sel?.rangeCount) return null
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  return pre.toString().length
}
function placeCaret(el, at) {
  el.focus({ preventScroll: true })
  const sel = window.getSelection?.()
  if (!sel) return
  const r = document.createRange()
  let left = at < 0 ? Infinity : at
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = null, last = null
  while ((node = walk.nextNode())) {
    last = node
    if (left <= node.length) { r.setStart(node, left); break }
    left -= node.length
  }
  if (!node) { if (last) r.setStart(last, last.length); else r.setStart(el, 0) }
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
}
// The part of a block before or after the caret, as Markdown.
function partMd(el, before) {
  const sel = window.getSelection()
  const r = document.createRange()
  r.selectNodeContents(el)
  const c = sel.getRangeAt(0)
  if (before) r.setEnd(c.startContainer, c.startOffset); else r.setStart(c.endContainer, c.endOffset)
  return D.inlineMd(r.cloneContents())
}
const lnOf = (el) => (el?.dataset.ln || '').split(':').map(Number)
// Every block's line from line `from` on, moved by delta (lines put in or taken out above them).
function shiftLines(root, from, delta) {
  if (!delta) return
  for (const el of root.querySelectorAll('[data-ln], [data-tl], [data-at]')) {
    for (const k of ['ln', 'tl']) {
      if (!el.dataset[k]) continue
      const [a, b] = el.dataset[k].split(':').map(Number)
      if (a >= from) el.dataset[k] = `${a + delta}:${b + delta}`
    }
    if (el.dataset.at && Number(el.dataset.at) >= from) el.dataset.at = String(Number(el.dataset.at) + delta)
  }
}

function Deck({ file, start, pptx, onDirty, onStats, handle, readOnly, packs, onOpen }) {
  const [md, setMd] = useState(start.md)
  const mdRef = useRef(start.md)
  const [view, setView] = useState(start.md) // what the slide in the middle is drawn from: the deck, but not while it's being typed in
  const [cur, setCur] = useState(0)
  const [show, setShow] = useState({ notes: true, md: false, ai: false })
  const [aiMode, setAiMode] = useState('deck')
  const [menu, setMenu] = useState(null) // which toolbar menu is open
  const [ctx, setCtx] = useState(null) // a slide's menu: { i, x, y }
  const [present, setPresent] = useState(null) // { at, presenter }
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [drag, setDrag] = useState(null) // { from, to, before }
  const [picked, setPicked] = useState(false) // the slide's picture, picked
  const [grid, setGrid] = useState(false) // every slide at once
  const [narrow, setNarrow] = useState(isPhone)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined
    const q = matchMedia('(max-width: 700px)')
    const on = () => setNarrow(q.matches)
    q.addEventListener?.('change', on)
    return () => q.removeEventListener?.('change', on)
  }, [])
  const [media, setMedia] = useState(() => new Map(start.media.map((m) => [m.id, { ...m, url: URL.createObjectURL(new Blob([m.bytes], { type: m.type })) }])))
  const hist = useRef({ past: [], future: [], last: 0, typing: false })
  const curRef = useRef(0)
  const pend = useRef(null) // a block typed in, not yet in the Markdown
  const focusNext = useRef(null) // { ln, at } once the slide is drawn again
  const canvasRef = useRef(null)
  const stageRef = useRef(null)
  const stripRef = useRef(null)
  const picInput = useRef(null)
  const renderer = useMemo(() => D.deckRenderer(), [])
  const previewer = useMemo(() => D.deckRenderer(), [])
  const [stageAt, stage] = useSize()
  const stageEl = useCallback((n) => { stageRef.current = n; stageAt(n) }, [stageAt])
  const ready = stage.w > 0
  useEffect(() => () => { for (const m of media.values()) URL.revokeObjectURL(m.url) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Its look ----------
  // The pack the deck names (pack: Board), a theme of Studio's by that name, a PowerPoint's own
  // theme, your default pack, else Studio's Paper. A deck can name one of Marp's own themes
  // (theme: gaia) instead, drawn as Marp draws it with the pack's colours over it.
  const named = D.frontValue(md, 'pack')
  const marpTheme = (() => { const x = D.frontValue(md, 'theme'); return x && x !== 'studio' ? x : null })()
  const userPack = named ? packs.find((p) => p.name.toLowerCase() === named.toLowerCase()) : null
  const builtIn = named && !userPack ? D.LOOKS.find((l) => l.name.toLowerCase() === named.toLowerCase()) : null
  const def = packs.find((p) => p.isDefault) || null
  const own = start.look ? { ...start.look, name: t('Its theme') } : null
  const look = userPack || builtIn || (!named && own) || def || D.PLAIN
  const lookKey = userPack ? `pack:${userPack.id}` : builtIn ? `look:${builtIn.id}` : !named && own ? 'own' : def ? `pack:${def.id}` : `look:${D.PLAIN.id}`
  const missing = named && !userPack && !builtIn
  renderer.setLook(look)
  previewer.setLook(look)

  // Pictures: one beside the deck by its path, one in a PowerPoint by its name in it.
  const dir = dirOf(file.path)
  const srcUrl = useCallback((src) => {
    if (src.startsWith('media:')) return media.get(src.slice(6))?.url || null
    if (/^(https?:|data:|blob:|\/)/i.test(src)) return src
    let rel = src
    try { rel = decodeURIComponent(src) } catch { /* as written */ }
    return `${BASE}/api/agents/${encodeURIComponent(file.root)}/raw?path=${encodeURIComponent(`${dir}${rel}`)}`
  }, [media, file.root, dir])
  const resolve = useCallback((text) => String(text).replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, a, src) => `${a}${srcUrl(src) || src}`), [srcUrl])

  const full = useMemo(() => renderer.render(resolve(md)), [md, look, resolve]) // eslint-disable-line react-hooks/exhaustive-deps
  const st = useMemo(() => D.structure(md, full.maps), [md, full])
  const count = st.slides.length
  const at = Math.min(cur, count - 1)
  const css = `${full.css}${marpTheme ? D.packOverCss(userPack || def) : ''}`
  // The slide in the middle, with what its empty parts show.
  const canvas = useMemo(() => {
    const base = view === md ? full : renderer.render(resolve(view))
    const vs = view === md ? st : D.structure(view, base.maps)
    const g = readOnly ? [] : D.ghostsOf(vs, Math.min(at, vs.slides.length - 1), ghostWords())
    return { svg: (g.length ? renderer.render(resolve(view), g) : base).slides[Math.min(at, vs.slides.length - 1)], st: vs }
  }, [view, md, full, st, at, look, resolve, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  const slideMd = D.slideText(st, at)
  const layout = D.layoutOf(slideMd)
  const picture = D.pictureOf(slideMd)
  const notes = D.notesOf(slideMd)
  useEffect(() => { onStats?.({ text: t('Slide {n} of {count}', { n: at + 1, count }) }) }, [at, count, onStats])
  useEffect(() => { if (cur !== at) setCur(at) }, [cur, at])
  curRef.current = at
  useEffect(() => { setPicked(false) }, [at])
  // An empty deck opens with AI ready to write it.
  useEffect(() => { if (!readOnly && count === 1 && !D.slideText(st, 0).replace(/<!--[\s\S]*?-->/g, '').trim()) setShow((s) => ({ ...s, ai: true })) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Changes, undo and redo ----------
  const change = useCallback((next, { typing = false, redraw = true, focus = null, go = null } = {}) => {
    const prev = mdRef.current
    if (next !== prev) {
      const h = hist.current
      if (!(typing && h.typing && Date.now() - h.last < 1500)) { h.past.push({ md: prev, at: curRef.current }); if (h.past.length > 300) h.past.shift() }
      h.typing = typing; h.last = Date.now(); h.future = []
      mdRef.current = next
      setMd(next)
      onDirty(true)
    }
    if (redraw) { focusNext.current = focus; setView(next) }
    if (go != null) setCur(go)
  }, [onDirty])
  // What's typed in a block, into the deck's Markdown.
  const commit = useCallback((el, opts = {}) => {
    if (pend.current?.el === el) { clearTimeout(pend.current.id); pend.current = null }
    if (!el?.isConnected || !el.dataset.ln) return mdRef.current
    const [a, b] = lnOf(el)
    const next = D.withText(mdRef.current, a, b, D.inlineMd(el))
    const delta = next.split('\n').length - mdRef.current.split('\n').length
    if (delta && !opts.redraw) { shiftLines(canvasRef.current, b, delta); el.dataset.ln = `${a}:${b + delta}` }
    change(next, { typing: true, redraw: !!opts.redraw, focus: opts.focus || null })
    return next
  }, [change])
  const flush = useCallback(() => { const p = pend.current; if (p) { clearTimeout(p.id); pend.current = null; commit(p.el) } }, [commit])
  const undo = useCallback(() => {
    flush()
    const h = hist.current
    if (!h.past.length) return
    h.future.push({ md: mdRef.current, at: curRef.current })
    const prev = h.past.pop()
    h.typing = false
    mdRef.current = prev.md; setMd(prev.md); setView(prev.md); setCur(prev.at); onDirty(true)
  }, [flush, onDirty])
  const redo = useCallback(() => {
    const h = hist.current
    if (!h.future.length) return
    h.past.push({ md: mdRef.current, at: curRef.current })
    const next = h.future.pop()
    h.typing = false
    mdRef.current = next.md; setMd(next.md); setView(next.md); setCur(next.at); onDirty(true)
  }, [onDirty])
  // The deck as it is now, with where its slides are (after what's being typed goes in).
  const fresh = useCallback(() => { flush(); const m = mdRef.current; return D.structure(m, renderer.render(m).maps) }, [flush, renderer])

  // ---------- Slides ----------
  const addSlide = (id = 'content', after = at) => { const s = fresh(); change(D.insertSlides(s, after, [id === 'content' ? '' : D.withLayout('', id)]), { go: after + 1 }) }
  const duplicate = (i = at) => { const s = fresh(); change(D.duplicateSlide(s, i), { go: i + 1 }) }
  const remove = (i = at) => { const s = fresh(); change(D.removeSlide(s, i), { go: Math.max(0, Math.min(i, s.slides.length - 2)) }) }
  const move = (from, to) => { const s = fresh(); if (to < 0 || to >= s.slides.length || from === to) return; change(D.moveSlide(s, from, to), { go: to }) }
  const setLayout = (id) => { const s = fresh(); change(D.replaceSlide(s, at, D.withLayout(D.slideText(s, at), id))) }
  const setNotes = (text) => { const s = fresh(); change(D.replaceSlide(s, at, D.withNotes(D.slideText(s, at), text)), { typing: true, redraw: false }) }
  const pickLook = (l) => {
    flush()
    let next = D.withFront(mdRef.current, 'theme', null)
    next = D.withFront(next, 'pack', l === own ? null : l.isDefault && !l.builtIn ? null : l.name)
    change(next)
  }
  const go = (i) => { flush(); setCur(Math.max(0, Math.min(count - 1, i))); if (view !== mdRef.current) setView(mdRef.current) }
  const open = (i) => { go(i); setGrid(false) }

  // ---------- Pictures ----------
  const addPicture = async (f) => {
    if (!f) return
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(f.type)) { setMsg({ text: t('That isn\'t a picture Studio can put on a slide (PNG, JPEG, GIF, WebP or SVG).'), error: true }); return }
    setBusy('picture'); setMsg(null)
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      let src
      if (pptx) {
        const id = `${Date.now().toString(36)}.${(f.name.split('.').pop() || 'png').toLowerCase()}`
        setMedia((m) => new Map(m).set(id, { id, type: f.type, bytes, url: URL.createObjectURL(f) }))
        src = `media:${id}`
      } else src = (await api('/studio/picture', { method: 'POST', body: { root: file.root, path: file.path, name: f.name, data: base64(bytes) } })).src
      const s = fresh()
      change(D.replaceSlide(s, at, D.withPicture(D.slideText(s, at), src)))
    } catch (e) { setMsg({ text: t("Couldn't put the picture on: {error}", { error: e.message }), error: true }) } finally { setBusy(null) }
  }
  const removePicture = () => { const s = fresh(); change(D.replaceSlide(s, at, D.withoutPicture(D.slideText(s, at)))); setPicked(false) }

  // ---------- Typing on the slide ----------
  // The blocks of the slide that take typing, and the empty parts that take a click.
  useLayoutEffect(() => {
    const root = canvasRef.current
    if (!root) return
    const words = ghostWords()
    const sec = root.querySelector('section[id]')
    if (!sec) return
    for (const li of sec.querySelectorAll('li[data-tl]')) {
      // A loose list's points are paragraphs of their own, which take typing as they are.
      if (li.querySelector(':scope > .sd-ed, :scope > p')) continue
      const span = document.createElement('span')
      span.className = 'sd-ed'
      span.dataset.ln = li.dataset.tl
      while (li.firstChild && !/^(UL|OL)$/.test(li.firstChild.nodeName)) span.appendChild(li.firstChild)
      li.insertBefore(span, li.firstChild)
    }
    for (const el of sec.querySelectorAll('h1[data-ln], h2[data-ln], h3[data-ln], h4[data-ln], h5[data-ln], h6[data-ln], p[data-ln]')) {
      if (el.querySelector('img, svg') || el.closest('[data-ph]')) continue
      el.classList.add('sd-ed')
    }
    for (const el of sec.querySelectorAll('.sd-ed')) {
      if (!readOnly) { el.contentEditable = 'true'; el.spellcheck = true }
      el.classList.toggle('sd-blank', !el.textContent.trim())
      el.dataset.hint = /^h1$/.test(el.localName) ? words.title : el.localName === 'h2' && layout === 'title' ? words.subtitle : el.closest('blockquote') ? words.quote : words.text
    }
    for (const el of sec.querySelectorAll('[data-ph]')) if (!el.querySelector('[data-ph]')) el.classList.add('sd-ghost')
    const f = focusNext.current
    if (f) {
      focusNext.current = null
      const el = [...sec.querySelectorAll('.sd-ed')].find((x) => lnOf(x)[0] === f.ln)
      if (el) placeCaret(el, f.at)
    }
  }, [canvas.svg, readOnly, layout, ready])

  const edAt = (target) => target?.closest?.('.sd-ed')
  const onCanvasDown = (e) => {
    const g = e.target.closest?.('.sd-ghost')
    if (g && !readOnly) {
      e.preventDefault()
      flush()
      const ph = g.dataset.ph
      const line = Number(g.dataset.at)
      const startOf = D.GHOST_START[ph] || '- '
      // An empty part made real, to type in: a blank line each side of it.
      const x = D.insertBlock(mdRef.current, line, startOf)
      change(x.md, { focus: { ln: x.ln, at: 0 } })
      return
    }
    if (!edAt(e.target)) {
      // The slide's picture: picked, to change or take off.
      const pic = e.target.closest?.('figure, img, [data-marpit-advanced-background="background"]')
      setPicked(!!picture && (!!pic || layout === 'picture'))
    }
  }
  const onCanvasInput = (e) => {
    const el = edAt(e.target)
    if (!el) return
    el.classList.toggle('sd-blank', !el.textContent.trim())
    if (e.nativeEvent?.isComposing) return
    if (pend.current && pend.current.el !== el) flush()
    clearTimeout(pend.current?.id)
    pend.current = { el, id: setTimeout(() => { pend.current = null; commit(el) }, 350) }
  }
  const onCanvasBlur = (e) => {
    const el = edAt(e.target)
    if (!el) return
    const into = e.relatedTarget
    if (pend.current?.el === el) flush()
    // Left empty: the line goes, and the slide shows what it can have again.
    if (!el.textContent.trim() && el.isConnected && el.dataset.ln) {
      const [a] = lnOf(el)
      change(D.removeLine(mdRef.current, a), { redraw: !(into && canvasRef.current?.contains(into)) })
      return
    }
    if (!(into && canvasRef.current?.contains(into))) setView(mdRef.current)
  }
  const nextEd = (el, dir = 1) => { const all = [...canvasRef.current.querySelectorAll('section[id] .sd-ed')]; return all[all.indexOf(el) + dir] || null }
  const onCanvasKey = (e) => {
    const el = edAt(e.target)
    if (!el) return
    const mod = e.metaKey || e.ctrlKey
    if (['Enter', 'Tab'].includes(e.key) && pend.current?.el === el) { clearTimeout(pend.current.id); pend.current = null }
    const [a, b] = lnOf(el)
    const item = el.closest('li')
    const heading = /^h[1-6]$/.test(el.localName)
    if (e.key === 'Escape') { e.preventDefault(); el.blur(); stageRef.current?.focus(); return }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return }
    if (mod && ['b', 'i'].includes(e.key.toLowerCase()) && !e.shiftKey) { e.preventDefault(); document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : 'italic'); onCanvasInput(e); return }
    if (e.key === 'Tab' && item) {
      e.preventDefault()
      const off = caretIn(el) ?? 0
      commit(el)
      const next = D.indentLine(mdRef.current, a, e.shiftKey)
      change(next, { focus: { ln: a, at: off } })
      return
    }
    if (e.key === 'Enter' && !mod) {
      e.preventDefault()
      const off = caretIn(el) ?? 0
      if (heading && !e.shiftKey) {
        // From a title to what's under it: the next block, else a new point.
        commit(el)
        const n = nextEd(el)
        if (n) { placeCaret(n, 0); return }
        const g = canvasRef.current.querySelector('section[id] .sd-ghost')
        if (g) { onCanvasDown({ target: g, preventDefault() {} }); return }
        const x = D.insertBlock(mdRef.current, b, layout === 'title' ? '## ' : '- ')
        change(x.md, { focus: { ln: x.ln, at: 0 } })
        return
      }
      const before = partMd(el, true), after = partMd(el, false)
      if (item && !e.shiftKey) {
        // A new point after this one, with what was after the caret.
        const line = D.prefixOf(mdRef.current.split('\n')[a]).replace(/\[[ xX]\]\s*$/, '')
        let next = D.withText(mdRef.current, a, b, before)
        const end = a + before.split('\n').length
        next = D.insertLines(next, end, [`${line}${after}`])
        change(next, { focus: { ln: end, at: 0 } })
        return
      }
      // A line break in a paragraph or a point.
      change(D.withText(mdRef.current, a, b, `${before}\n${after}`), { focus: { ln: a, at: off + 1 } })
      return
    }
    if (e.key === 'Backspace' && !mod && caretIn(el) === 0 && window.getSelection()?.isCollapsed) {
      const prev = nextEd(el, -1)
      if (!el.textContent.length) {
        e.preventDefault()
        if (pend.current?.el === el) { clearTimeout(pend.current.id); pend.current = null }
        change(D.removeLine(mdRef.current, a), { focus: prev ? { ln: lnOf(prev)[0], at: -1 } : null })
        return
      }
      if (item && prev?.closest('li')) {
        // Joined to the point before.
        e.preventDefault()
        commit(el)
        const [a2, b2] = lnOf(el)
        const [pa, pb] = lnOf(prev)
        const keep = prev.textContent.length
        let next = D.withText(mdRef.current, pa, pb, `${D.inlineMd(prev)}${D.inlineMd(el)}`)
        const shift = next.split('\n').length - mdRef.current.split('\n').length
        next = next.split('\n').filter((_, j) => j < a2 + shift || j >= b2 + shift).join('\n')
        change(next, { focus: { ln: pa, at: keep } })
      }
    }
  }
  const onCanvasPaste = (e) => {
    if (!edAt(e.target)) return
    const pic = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'))
    e.preventDefault()
    if (pic) { addPicture(pic); return }
    document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').replace(/\s*\n\s*/g, ' '))
  }
  const onCanvasDrop = (e) => {
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'))
    if (!f || readOnly) return
    e.preventDefault()
    addPicture(f)
  }

  // ---------- Keys for the whole deck ----------
  useEffect(() => {
    const key = (e) => {
      if (present || e.defaultPrevented) return
      const inText = e.target.closest?.('input, textarea, select, [contenteditable="true"]')
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'enter') { e.preventDefault(); setPresent({ at, presenter: e.shiftKey }); return }
      if (e.key === 'F5') { e.preventDefault(); setPresent({ at: e.shiftKey ? at : 0, presenter: false }); return }
      if (inText || readOnly) return
      if (!e.target.closest?.('.sd-deck2')) return
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      else if (mod && k === 'd') { e.preventDefault(); duplicate() }
      else if (mod && k === 'm') { e.preventDefault(); addSlide() }
      else if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(at, at + (e.key === 'ArrowUp' ? -1 : 1)) }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1) }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(at + 1) }
      else if (e.key === 'Home') { e.preventDefault(); go(0) }
      else if (e.key === 'End') { e.preventDefault(); go(count - 1) }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.closest?.('.sd-strip')) { e.preventDefault(); remove() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && picked) { e.preventDefault(); removePicture() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  useEffect(() => { stripRef.current?.querySelector('.sd-thumb.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [at])

  // ---------- Saving, PowerPoint, PDF ----------
  // A picture's data, for the PowerPoint.
  const imageData = useCallback(async (src) => {
    const url = srcUrl(src)
    if (!url || url.startsWith('data:')) return url
    const r = await fetch(url, { credentials: 'same-origin' })
    if (!r.ok) return null
    const blob = await r.blob()
    return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => ok(null); fr.readAsDataURL(blob) })
  }, [srcUrl])
  const toPptx = async (m) => pptxOf(slidesOf(m), look, { image: imageData, title: D.frontValue(m, 'title') || file.name.replace(/\.[^.]+$/, '') })
  handle.current = {
    save: async () => { flush(); return pptx ? toPptx(mdRef.current) : mdRef.current },
    selection: () => {
      const sel = window.getSelection?.()
      const text = sel && !sel.isCollapsed && canvasRef.current?.contains(sel.anchorNode) ? sel.toString() : D.slideText(st, at)
      return text ? { text, where: t('slide {n}', { n: at + 1 }) } : null
    },
  }
  const saveBeside = async (kind) => {
    setBusy(kind); setMsg(null)
    try {
      flush()
      const m = mdRef.current
      const base = file.name.replace(/(\.deck)?\.(md|markdown|pptx)$/i, '')
      let body
      if (kind === 'pptx') body = { data: base64(await toPptx(m)), name: `${base}.pptx` }
      else {
        // A PowerPoint's pictures go beside the Markdown deck, in images, as a deck's do.
        let text = m
        for (const id of new Set([...m.matchAll(/\]\(media:([^)\s]+)/g)].map((x) => x[1]))) {
          const it = media.get(id)
          if (!it) continue
          const r = await api('/studio/picture', { method: 'POST', body: { root: file.root, path: file.path, name: `${base}-${id}`, data: base64(it.bytes) } })
          text = text.split(`](media:${id}`).join(`](${r.src}`)
        }
        body = { text, name: `${base}.md` }
      }
      const r = await api('/studio/new', { method: 'POST', body: { root: file.root, dir: dir.replace(/\/$/, ''), ...body } })
      setMsg({ text: t('Saved as {name}, beside it.', { name: r.name }), open: r.path })
    } catch (e) { setMsg({ text: kind === 'pptx' ? t("Couldn't make the PowerPoint: {error}", { error: e.message }) : t("Couldn't make the Markdown deck: {error}", { error: e.message }), error: true }) } finally { setBusy(null) }
  }
  // Printed from a page of its own, a slide to a sheet: the browser's Print, or Save as PDF.
  const print = () => {
    const f = document.createElement('iframe')
    f.className = 'sd-print-frame'
    f.setAttribute('aria-hidden', 'true')
    f.srcdoc = `<!doctype html><meta charset="utf-8"><title>${file.name.replace(/[<&]/g, '')}</title><style>${css}
html,body{margin:0;background:#fff}div.marpit>svg{display:block;width:100vw;height:auto;page-break-after:always;break-after:page}
@page{size:1280px 720px;margin:0}@media print{div.marpit>svg{width:1280px;height:720px}}</style><div class="marpit">${full.slides.join('')}</div>`
    f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print() } finally { setTimeout(() => f.remove(), 60_000) } }, 200) }
    document.body.appendChild(f)
  }

  // ---------- AI ----------
  const slideTexts = () => { const s = fresh(); return s.slides.map((_, i) => D.slideText(s, i)) }
  const front = () => mdRef.current.split('\n').slice(0, st.front).join('\n')
  const drawSlides = (texts) => previewer.render(resolve(`${front()}\n\n${texts.join('\n\n---\n\n')}\n`)).slides
  const keepAi = ({ mode, slides, at: n, how }) => {
    const s = fresh()
    if (mode === 'deck' && how === 'replace') {
      const head = mdRef.current.split('\n').slice(0, s.front).join('\n')
      change(`${head ? `${head}\n\n` : ''}${slides.join('\n\n---\n\n')}\n`, { go: 0 })
    } else if (how === 'after') change(D.insertSlides(s, n, slides), { go: n + 1 })
    else change(D.replaceSlide(s, n, slides), { go: n })
    setMsg({ text: t('Kept. Undo takes it back.') })
  }
  const openAi = (mode) => { setAiMode(mode); setShow((s) => ({ ...s, ai: true })) }

  // ---------- Layout ----------
  // On a phone the slide is as wide as the screen, with what's under it right under it.
  const phone = narrow || (stage.w > 0 && stage.w < 560)
  const pad = phone ? 12 : 28
  const k = Math.max(0.1, narrow ? (stage.w - pad * 2) / D.W : Math.min((stage.w - pad * 2) / D.W, (stage.h - pad * 2) / D.H))
  const previews = useMemo(() => {
    if (menu !== 'layout' && menu !== 'new') return null
    const out = previewer.render(D.LAYOUTS.map((id) => sampleOf(id)).join('\n\n---\n\n'))
    return Object.fromEntries(D.LAYOUTS.map((id, i) => [id, out.slides[i]]))
  }, [menu, look]) // eslint-disable-line react-hooks/exhaustive-deps
  const tool = (name, icon, run, { tip, on, disabled, label = false, more = {} } = {}) => (
    <button type="button" className={`sd-tool${label ? ' wide' : ''}${on ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={run} title={tip || name} aria-label={name} disabled={disabled} {...(on !== undefined ? { 'aria-pressed': !!on } : {})} {...more}>
      <Icon name={icon} size={15} />{label && <span className="sd-tool-label">{name}</span>}
    </button>
  )
  const slideMenu = (i) => [
    { label: t('New slide after it'), icon: 'plus', run: () => addSlide('content', i), keys: keys('mod', 'm') },
    { label: t('Duplicate'), icon: 'copy', run: () => duplicate(i), keys: keys('mod', 'd') },
    '-',
    { label: t('Move up'), icon: 'up', run: () => move(i, i - 1), disabled: i === 0, keys: keys('mod', '↑') },
    { label: t('Move down'), icon: 'down', run: () => move(i, i + 1), disabled: i >= count - 1, keys: keys('mod', '↓') },
    '-',
    { label: t('Present from here'), icon: 'play', run: () => setPresent({ at: i, presenter: false }) },
    '-',
    { label: t('Delete the slide'), icon: 'trash', run: () => remove(i), danger: true, disabled: count <= 1 && !D.slideText(st, 0) },
  ]

  // A slide in the strip or the grid: picked by a click, dragged into order, its menu on a right click.
  const thumb = (svg, i, w, pick) => (
    <Thumb key={i} i={i} svg={svg} w={w} on={i === at} readOnly={readOnly}
      drop={drag && drag.to === i ? (drag.before ? 'before' : 'after') : null}
      onPick={pick}
      onMenu={(e) => { e.preventDefault(); go(i); setCtx({ i, x: e.clientX, y: e.clientY }) }}
      onDragStart={() => setDrag({ from: i, to: i, before: true })}
      onDragOver={(before) => setDrag((d) => (d ? { ...d, to: i, before } : d))}
      onDrop={() => { if (drag) { const to = drag.before ? drag.to : drag.to + 1; move(drag.from, to > drag.from ? to - 1 : to) } setDrag(null) }}
      onDragEnd={() => setDrag(null)} />
  )
  return (
    <div className={`sd-deck2${show.ai ? ' with-ai' : ''}${show.md ? ' with-md' : ''}`}>
      <style>{css}</style>
      <div className="sd-toolbar sd-deck-tools" role="toolbar" aria-label={t('Deck')}>
        {!readOnly && (
          <div className="sd-group">
            <span className="menu-anchor sd-split">
              <button type="button" className="sd-tool wide" onClick={() => addSlide()} title={withKeys(t('New slide'), 'mod', 'm')} aria-label={t('New slide')}><Icon name="plus" size={15} /><span className="sd-tool-label">{t('New slide')}</span></button>
              <button type="button" className={`sd-tool caret${menu === 'new' ? ' on' : ''}`} onClick={() => setMenu(menu === 'new' ? null : 'new')} aria-label={t('New slide in a layout')} title={t('New slide in a layout')} aria-haspopup="menu" aria-expanded={menu === 'new'}><Icon name="down" size={12} /></button>
              {menu === 'new' && previews && <LayoutGallery label={t('New slide in a layout')} previews={previews} onPick={(id) => addSlide(id)} onClose={() => setMenu(null)} />}
            </span>
            {tool(t('Undo'), 'undo', undo, { tip: withKeys(t('Undo'), 'mod', 'z'), disabled: !hist.current.past.length })}
            {tool(t('Redo'), 'redo', redo, { tip: withKeys(t('Redo'), 'shift', 'mod', 'z'), disabled: !hist.current.future.length })}
          </div>
        )}
        {!readOnly && (
          <div className="sd-group">
            <span className="menu-anchor">
              {tool(t('Layout'), 'split', () => setMenu(menu === 'layout' ? null : 'layout'), { label: true, on: menu === 'layout' || undefined, tip: t('Layout: {name}', { name: t(LAYOUT_LABEL[layout]) }), more: { 'aria-haspopup': 'menu', 'aria-expanded': menu === 'layout' } })}
              {menu === 'layout' && previews && <LayoutGallery label={t('Layout of slide {n}', { n: at + 1 })} previews={previews} on={layout} onPick={setLayout} onClose={() => setMenu(null)} />}
            </span>
            <span className="menu-anchor">
              {tool(t('Theme'), 'palette', () => setMenu(menu === 'theme' ? null : 'theme'), { label: true, tip: marpTheme ? t('Theme: Marp\'s {name}', { name: marpTheme }) : t('Theme: {name}', { name: look.builtIn ? t(look.name) : look.name }), more: { 'aria-haspopup': 'menu', 'aria-expanded': menu === 'theme' } })}
              {menu === 'theme' && <ThemeGallery packs={packs} own={own} current={marpTheme ? null : lookKey} onPick={pickLook} onClose={() => setMenu(null)} />}
            </span>
            {tool(picture ? t('Change the picture') : t('Picture'), 'image', () => picInput.current?.click(), { label: true, disabled: busy === 'picture', tip: picture ? t('Put another picture in this one\'s place') : t('Put a picture on this slide (or drop one on it)') })}
            <input ref={picInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={(e) => { addPicture(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        )}
        {!readOnly && (
          <div className="sd-group sd-marks">
            {tool(t('Bold'), 'bold', () => document.execCommand('bold'), { tip: withKeys(t('Bold'), 'mod', 'b') })}
            {tool(t('Italic'), 'italic', () => document.execCommand('italic'), { tip: withKeys(t('Italic'), 'mod', 'i') })}
          </div>
        )}
        {missing && <span className="muted small sd-tool-note" title={t('This deck names a design pack you don\'t have, so it uses your default.')}><Icon name="info" size={12} /> {t('No pack "{name}"', { name: named })}</span>}
        <span className="sd-grow" />
        <div className="sd-group">
          {!readOnly && tool(t('Write with AI'), 'sparkle', () => setShow((s) => ({ ...s, ai: !s.ai })), { label: true, on: show.ai, tip: t('Write a deck, rewrite a slide or add one, with AI: you see it before it\'s taken') })}
          {tool(t('Grid'), 'grid', () => { flush(); setGrid((x) => !x) }, { label: true, on: grid, tip: t('Every slide at once, to see the whole deck and drag slides into order') })}
          {!pptx && tool(t('Markdown'), 'code', () => { flush(); setShow((s) => ({ ...s, md: !s.md })) }, { label: true, on: show.md, tip: t('The deck as Markdown, beside the slides') })}
        </div>
        <div className="sd-group">
          <span className="menu-anchor sd-split">
            <button type="button" className="btn small primary sd-present-btn" onClick={() => { flush(); setPresent({ at, presenter: false }) }} title={withKeys(t('Present from this slide'), 'mod', 'enter')} aria-label={t('Present')}><Icon name="play" size={12} /> <span className="sd-btn-label">{t('Present')}</span></button>
            <button type="button" className={`sd-tool caret${menu === 'present' ? ' on' : ''}`} onClick={() => setMenu(menu === 'present' ? null : 'present')} aria-label={t('More ways to present')} title={t('More ways to present')} aria-haspopup="menu" aria-expanded={menu === 'present'}><Icon name="down" size={12} /></button>
            {menu === 'present' && <Menu label={t('Present')} className="right" onClose={() => setMenu(null)} items={[
              { label: t('From the beginning'), icon: 'play', run: () => setPresent({ at: 0, presenter: false }), keys: 'F5' },
              { label: t('From this slide'), icon: 'play', run: () => setPresent({ at, presenter: false }), keys: keys('mod', '↵') },
              { label: t('Presenter view'), icon: 'panel-right', run: () => setPresent({ at, presenter: true }), keys: keys('shift', 'mod', '↵') },
            ]} />}
          </span>
          <span className="menu-anchor">
            {tool(t('Export'), 'download', () => setMenu(menu === 'export' ? null : 'export'), { label: true, disabled: !!busy, tip: t('A PowerPoint or PDF of it'), more: { 'aria-haspopup': 'menu', 'aria-expanded': menu === 'export' } })}
            {menu === 'export' && <Menu label={t('Export')} className="right" onClose={() => setMenu(null)} items={[
              pptx ? { label: t('Markdown deck, beside it'), icon: 'code', run: () => saveBeside('md') } : { label: t('PowerPoint, beside it'), icon: 'screen', run: () => saveBeside('pptx') },
              { label: t('PDF (print it, or save as PDF)'), icon: 'doc', run: print },
            ]} />}
          </span>
        </div>
      </div>
      {msg && <p className={`small sd-note${msg.error ? ' error-text' : ''}`} role={msg.error ? 'alert' : 'status'}>{msg.text} {msg.open && <button type="button" className="link-btn" onClick={() => onOpen?.({ root: file.root, path: msg.open })}>{t('Open it')}</button>} <button type="button" className="link-btn" onClick={() => setMsg(null)}>{t('Close')}</button></p>}
      {pptx && <p className="small sd-note sd-deck-said"><Icon name="info" size={12} /> {t('A PowerPoint, shown with its text, lists, pictures, tables, notes and theme in Studio\'s layouts.')} {start.skipped > 0 && t('{n} things on its slides (charts, diagrams, video) aren\'t shown.', { n: start.skipped })} {t('Saving writes it again from what\'s here; the file as it was stays in its versions.')}</p>}
      <div className="sd-deck-body">
        <ol className="sd-strip" ref={stripRef} aria-label={t('Slides')}>
          {full.slides.map((svg, i) => thumb(svg, i, 160, () => go(i)))}
          {!readOnly && <li className="sd-strip-add"><button type="button" className="ghost-btn" onClick={() => addSlide('content', count - 1)} title={t('New slide at the end')}><Icon name="plus" size={13} /> {t('New slide')}</button></li>}
        </ol>
        {ctx && <div className="sd-ctx" style={{ left: ctx.x, top: ctx.y }}><Menu label={t('Slide {n}', { n: ctx.i + 1 })} onClose={() => setCtx(null)} items={slideMenu(ctx.i)} /></div>}
        {grid ? (
          <div className="sd-sorter" aria-label={t('Every slide')}>
            <ol>{full.slides.map((svg, i) => thumb(svg, i, 0, () => open(i)))}</ol>
            {!readOnly && <p><button type="button" className="ghost-btn" onClick={() => { addSlide('content', count - 1); setGrid(false) }}><Icon name="plus" size={13} /> {t('New slide')}</button></p>}
          </div>
        ) : (
          <div className="sd-work">
            <div className="sd-stage" ref={stageEl} tabIndex={-1} onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault() }} onDrop={onCanvasDrop} onMouseDown={(e) => { if (e.target === e.currentTarget) { flush(); setPicked(false) } }}>
              {!readOnly && !phone && (
                <div className="sd-pill" role="toolbar" aria-label={t('This slide')}>
                  <button type="button" onClick={() => openAi('slide')} title={t('Rewrite this slide with AI')}><Icon name="sparkle" size={12} /> {t('Rewrite')}</button>
                  <button type="button" onClick={() => openAi('add')} title={t('A new slide after this one, written with AI')}><Icon name="plus" size={12} /> {t('Slide after')}</button>
                  <span className="menu-anchor"><button type="button" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCtx({ i: at, x: r.left, y: r.bottom + 4 }) }} title={t('More for this slide')} aria-label={t('More for this slide')}><Icon name="more" size={13} /></button></span>
                </div>
              )}
              {stage.w > 0 && (
                <div className={`sd-canvas${picked ? ' picked' : ''}`} style={{ width: Math.round(D.W * k), height: Math.round(D.H * k), '--k': k }}>
                  <div className="sd-canvas-in" ref={canvasRef} style={{ transform: `scale(${k})` }}
                    onMouseDown={onCanvasDown} onInput={onCanvasInput} onBlur={onCanvasBlur} onKeyDown={onCanvasKey} onPaste={onCanvasPaste}
                    dangerouslySetInnerHTML={{ __html: `<div class="marpit">${canvas.svg || ''}</div>` }} />
                  {!readOnly && !picture && ['image', 'picture'].includes(layout) && (
                    <button type="button" className={`sd-pic-ghost ${layout}`} onClick={() => picInput.current?.click()} title={t('Put a picture on this slide')}>
                      <Icon name="image" size={Math.max(16, Math.round(28 * k * 1.6))} /><span>{busy === 'picture' ? t('Putting it on…') : t('Click to add a picture')}</span>
                    </button>
                  )}
                  {picked && picture && !readOnly && (
                    <div className="sd-pic-bar" role="toolbar" aria-label={t('The picture')}>
                      <button type="button" className="btn small" onClick={() => picInput.current?.click()}><Icon name="image" size={12} /> {t('Change it')}</button>
                      <button type="button" className="btn small" onClick={removePicture}><Icon name="trash" size={12} /> {t('Take it off')}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="sd-nav" role="toolbar" aria-label={t('Slides')}>
              <button type="button" className="win-btn" onClick={() => go(at - 1)} disabled={at === 0} aria-label={t('Back')} title={t('Back')}><Icon name="chevron" size={16} className="flip" /></button>
              <span className="sd-nav-n">{t('{n} of {count}', { n: at + 1, count })}</span>
              <button type="button" className="win-btn" onClick={() => go(at + 1)} disabled={at >= count - 1} aria-label={t('Next')} title={t('Next')}><Icon name="chevron" size={16} /></button>
              <button type="button" className="ghost-btn" onClick={() => setGrid(true)}><Icon name="grid" size={14} /> {t('All slides')}</button>
            </div>
            <div className={`sd-notes${show.notes ? '' : ' shut'}`}>
              <button type="button" className="sd-notes-head" onClick={() => setShow((s) => ({ ...s, notes: !s.notes }))} aria-expanded={show.notes}>
                <Icon name="chevron" size={12} className={show.notes ? 'down' : ''} /> {t('Speaker notes')}{!show.notes && notes && <span className="muted"> · {notes.slice(0, 80)}</span>}
              </button>
              {show.notes && <NotesBox key={at} value={notes} readOnly={readOnly} onChange={setNotes} placeholder={t('Click to add speaker notes')} />}
            </div>
          </div>
        )}
        {show.md && !pptx && (
          <div className="sd-md-pane">
            <div className="sd-md-head"><b>{t('Markdown')}</b><span className="muted small">{t('Marp\'s format: slides between lines of ---')}</span><span className="sd-grow" /><button type="button" className="win-btn" onClick={() => setShow((s) => ({ ...s, md: false }))} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button></div>
            <textarea className="sd-deck-md" value={md} readOnly={readOnly} spellCheck onChange={(e) => change(e.target.value, { typing: true })} aria-label={t('The deck, in Markdown')} />
          </div>
        )}
        {show.ai && !readOnly && <AiPanel file={file} getSlides={slideTexts} at={at} mode={aiMode} setMode={setAiMode} draw={drawSlides} onKeep={keepAi} onClose={() => setShow((s) => ({ ...s, ai: false }))} />}
      </div>
      {present && <Present slides={full.slides} notes={full.notes.map((n) => n.join('\n\n'))} start={present.at} presenter={present.presenter} onAt={setCur} onClose={() => setPresent(null)} />}
    </div>
  )
}

// A slide in the strip: its number, its drawing; dragged to move it, its menu on a right click.
// Focused when it's clicked (Safari doesn't focus a button it's clicked on), for ⌘D and Delete.
const Thumb = memo(function Thumb({ i, svg, w, on, readOnly, drop, onPick, onMenu, onDragStart, onDragOver, onDrop, onDragEnd }) {
  return (
    <li className={`sd-thumb${on ? ' on' : ''}${drop ? ` drop-${drop}` : ''}`} draggable={!readOnly}
      onClick={(e) => { e.currentTarget.querySelector('.sd-thumb-btn')?.focus({ preventScroll: true }); onPick() }} onContextMenu={readOnly ? undefined : onMenu}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); onDragStart() }}
      onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onDragOver(e.clientY < r.top + r.height / 2) }}
      onDrop={(e) => { e.preventDefault(); onDrop() }} onDragEnd={onDragEnd}>
      <span className="sd-thumb-n">{i + 1}</span>
      <button type="button" className="sd-thumb-btn" aria-current={on ? 'true' : undefined} aria-label={t('Slide {n}', { n: i + 1 })} title={t('Slide {n}', { n: i + 1 })}><Slide svg={svg} w={w} /></button>
      {!readOnly && <button type="button" className="sd-thumb-more" onClick={(e) => { e.stopPropagation(); onMenu(e) }} aria-label={t('More for slide {n}', { n: i + 1 })} title={t('More for slide {n}', { n: i + 1 })}><Icon name="more" size={13} /></button>}
    </li>
  )
})

// The speaker notes of a slide, kept as typed and put in the deck as they're typed.
function NotesBox({ value, readOnly, onChange, placeholder }) {
  const [text, setText] = useState(value)
  const id = useRef(null)
  const box = useRef(null)
  useEffect(() => () => clearTimeout(id.current), [])
  // Changed some other way (Undo, AI, the Markdown): shown, unless it's being typed in.
  useEffect(() => { if (document.activeElement !== box.current) setText(value) }, [value])
  return <textarea ref={box} className="sd-notes-box" value={text} readOnly={readOnly} placeholder={placeholder} aria-label={placeholder} onChange={(e) => { const v = e.target.value; setText(v); clearTimeout(id.current); id.current = setTimeout(() => onChange(v), 400) }} onBlur={() => { clearTimeout(id.current); if (text !== value) onChange(text) }} />
}
