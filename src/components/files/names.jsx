import { useLayoutEffect, useRef, useState } from 'react'

// A file's name where there isn't room for all of it: cut in the middle, as Finder cuts one, so its
// end stays (what tells "… v4.pptx" from "… v5.pptx") with its extension. The whole name is its
// tooltip on a computer, and a long press shows it on a phone (holdName); Quick Look and Get Info
// show it whole, wrapped.

// Where a name is cut: the end kept whole is its extension and its last word or two ("v5", "v3
// final", "(2)", "(Maya edits)", "_183022"), up to 12 characters (a last word in brackets, 14);
// a last word longer than that, its last 8. A short name isn't cut.
export function splitName(name) {
  const s = String(name || '')
  if (s.length <= 16) return [s, '']
  const dot = s.lastIndexOf('.')
  const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : ''
  const stem = s.slice(0, s.length - ext.length)
  // Its words, each with what's before it (a space, a mark); what's in brackets is one word.
  const words = stem.match(/[\s\-_.]*\([^)]*\)|[\s\-_.(]*[^\s\-_.(]+/g) || [stem]
  let tail = ''
  for (let i = words.length - 1; i > 0; i--) {
    const next = words[i] + tail
    if (tail && next.trim().length > 12) break
    tail = next
    if (tail.trim().length >= 12) break
  }
  if (!tail || tail.trim().length > 14) tail = stem.slice(-8)
  if (tail.length >= stem.length) return [s, '']
  return [stem.slice(0, stem.length - tail.length), tail + ext]
}

// In a row: the start cut with … when it doesn't fit, the end always shown. What's drawn is the two
// parts (its ::before and ::after, styles.css); the name itself is in the page whole (read aloud,
// copied, found), out of sight.
export function MidName({ name, className = '', title = true }) {
  const [head, tail] = splitName(name)
  return (
    <span className={`mid-name ${className}`} title={title ? name : undefined} data-head={head} data-tail={tail}>
      <span className="mid-text">{name}</span>
    </span>
  )
}

// In a tile (an icon's name under it), on up to two lines: the whole name when it fits in them, else
// cut in the middle to fit (measured in the tile's own font).
let canvas = null
const widthIn = (font) => {
  canvas ||= document.createElement('canvas')
  const g = canvas.getContext('2d')
  g.font = font
  return (s) => g.measureText(s).width
}
// The lines a text takes at width w, broken where a browser breaks it (after a space or a hyphen, or
// anywhere in a word longer than a line).
function linesOf(text, w, measure) {
  const words = text.match(/[^\s\-_]+[\s\-_]*|[\s\-_]+/g) || [text]
  let lines = 1, line = 0
  for (const word of words) {
    const ww = measure(word.trimEnd())
    if (line && line + ww > w) { lines++; line = 0 }
    if (ww > w) { lines += Math.ceil(ww / w) - 1; line = ww % w } else line += measure(word)
  }
  return lines
}
export function fitName(name, w, font, lines = 2) {
  const s = String(name || '')
  if (!w || typeof document === 'undefined') return s
  const measure = widthIn(font)
  if (linesOf(s, w, measure) <= lines) return s
  const [, tail0] = splitName(s)
  const tail = tail0 || s.slice(-8)
  const head = s.slice(0, s.length - tail.length)
  let lo = 1, hi = head.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (linesOf(`${head.slice(0, mid).trimEnd()}…${tail}`, w, measure) <= lines) lo = mid
    else hi = mid - 1
  }
  return `${head.slice(0, lo).trimEnd()}…${tail}`
}
export function TileName({ name, className = '' }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(name)
  useLayoutEffect(() => {
    const el = ref.current
    const tile = el?.parentElement
    if (!el || !tile) return undefined
    // Measured against the tile (its icons' size changes it), as wide as the name may be in it.
    const fit = () => {
      const cs = getComputedStyle(el), ts = getComputedStyle(tile)
      const w = tile.clientWidth - parseFloat(ts.paddingLeft || 0) - parseFloat(ts.paddingRight || 0) - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0) - 2
      setShown(fitName(name, w, `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`))
    }
    fit()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(fit)
    ro.observe(tile)
    return () => ro.disconnect()
  }, [name])
  return <span ref={ref} className={className} title={name}>{shown}</span>
}

// ---------- The whole name, held ----------
// A long press with a finger (or a pen) on a row shows its whole name in a bubble over it, for as
// long as it's read; the tap that ends the press doesn't open the file. onHold(e), instead: what the
// press does there (Files' rows open their menu, whose heading is the whole name).
let bubble = null
let hideAt = null
export function showName(name, rect) {
  if (typeof document === 'undefined') return
  if (!bubble) {
    bubble = document.createElement('div')
    bubble.className = 'name-bubble'
    bubble.setAttribute('role', 'status')
    document.body.appendChild(bubble)
    const away = () => hideName()
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
  }
  bubble.textContent = name
  bubble.classList.add('on')
  const b = bubble.getBoundingClientRect()
  const vw = window.innerWidth
  const left = Math.max(12, Math.min(vw - b.width - 12, rect.left + rect.width / 2 - b.width / 2))
  const top = rect.top - b.height - 8 >= 8 ? rect.top - b.height - 8 : rect.bottom + 8
  bubble.style.left = `${Math.round(left)}px`
  bubble.style.top = `${Math.round(top)}px`
  clearTimeout(hideAt)
  hideAt = setTimeout(hideName, 4000)
  const tap = () => { hideName(); document.removeEventListener('pointerdown', tap, true) }
  setTimeout(() => document.addEventListener('pointerdown', tap, true), 0)
}
export function hideName() { clearTimeout(hideAt); bubble?.classList.remove('on') }

const HOLD_MS = 500
export function holdName(name, { onHold = null } = {}) {
  const st = holdName.state || (holdName.state = { timer: null, from: null, held: false })
  const stop = () => { clearTimeout(st.timer); st.timer = null }
  return {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return
      st.from = { x: e.clientX, y: e.clientY }
      st.held = false
      stop()
      const el = e.currentTarget
      const at = { x: e.clientX, y: e.clientY }
      st.timer = setTimeout(() => {
        st.timer = null
        st.held = true
        if (onHold) onHold({ clientX: at.x, clientY: at.y, currentTarget: el, preventDefault() {}, stopPropagation() {} })
        else showName(name, (el.querySelector('.mid-name') || el).getBoundingClientRect())
      }, HOLD_MS)
    },
    onPointerMove: (e) => { if (st.timer && st.from && Math.hypot(e.clientX - st.from.x, e.clientY - st.from.y) > 10) stop() },
    onPointerUp: stop,
    onPointerCancel: stop,
    // The tap that ends a long press isn't one that opens the file.
    onClickCapture: (e) => { if (st.held) { st.held = false; e.preventDefault(); e.stopPropagation() } },
  }
}
