import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { t } from '../../../i18n/index.js'

// A pad to sign on, with a mouse, a trackpad (the click held down), a finger or a pen. Each stroke
// is drawn smooth (curves through the points, every event the pointer sends) and thicker where the
// hand slows or a pen presses, as ink does. Undo takes the last stroke back, Clear starts again.
// Kept as a PNG of just the strokes, three times the size drawn, so it stays sharp on a page.
const INKS = { black: '#15171c', blue: '#1d3f9a' }
const MIN_W = 1.1, MAX_W = 3.4

function drawStroke(ctx, pts, ink) {
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2); ctx.fill(); return }
  // From the middle of one segment to the middle of the next, through the point between.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const p0 = i === 1 ? a : { x: (pts[i - 2].x + a.x) / 2, y: (pts[i - 2].y + a.y) / 2 }
    const p1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    ctx.beginPath()
    ctx.lineWidth = (a.w + b.w) / 2
    ctx.moveTo(p0.x, p0.y)
    ctx.quadraticCurveTo(a.x, a.y, i === pts.length - 1 ? b.x : p1.x, i === pts.length - 1 ? b.y : p1.y)
    ctx.stroke()
  }
}

// The strokes as a PNG, cropped to them: { png, width, height }, or null with nothing drawn.
export function strokesToPng(strokes, ink, scale = 3) {
  const all = strokes.flat()
  if (!all.length) return null
  const pad = MAX_W * 2
  const x0 = Math.min(...all.map((p) => p.x)) - pad, y0 = Math.min(...all.map((p) => p.y)) - pad
  const x1 = Math.max(...all.map((p) => p.x)) + pad, y1 = Math.max(...all.map((p) => p.y)) + pad
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil((x1 - x0) * scale))
  c.height = Math.max(1, Math.ceil((y1 - y0) * scale))
  const ctx = c.getContext('2d')
  ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale)
  for (const s of strokes) drawStroke(ctx, s, ink)
  return { png: c.toDataURL('image/png'), width: c.width, height: c.height }
}

// what: 'signature' or 'initials' (a shorter pad). onSave({ png }) keeps it; onCancel.
export default function SignPad({ what = 'signature', busy = false, onSave, onCancel }) {
  const canvas = useRef(null)
  const [strokes, setStrokes] = useState([])
  const [ink, setInk] = useState('black')
  const live = useRef(null) // the stroke being drawn
  const size = useRef({ w: 0, h: 0 })

  const paint = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.current.w, size.current.h)
    for (const s of [...strokes, ...(live.current ? [live.current] : [])]) drawStroke(ctx, s, INKS[ink])
  }, [strokes, ink])
  const painter = useRef(paint)
  painter.current = paint
  // Sharp at the screen's own resolution, and redrawn when the pad changes size.
  useEffect(() => {
    const c = canvas.current
    if (!c) return undefined
    const fit = () => {
      const r = c.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      size.current = { w: r.width, h: r.height }
      c.width = Math.round(r.width * dpr)
      c.height = Math.round(r.height * dpr)
      painter.current()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  const point = (e, last) => {
    const r = canvas.current.getBoundingClientRect()
    const x = e.clientX - r.left, y = e.clientY - r.top
    // Slower is thicker; a pen's pressure counts too. Eased, so the width doesn't jump.
    let w = (MIN_W + MAX_W) / 2
    if (last) {
      const v = Math.hypot(x - last.x, y - last.y) / Math.max(1, e.timeStamp - last.t)
      const target = Math.max(MIN_W, Math.min(MAX_W, MAX_W - v * 1.6))
      w = last.w * 0.7 + target * 0.3
    }
    if (e.pointerType === 'pen' && e.pressure > 0) w = Math.max(MIN_W, Math.min(MAX_W * 1.2, w * (0.6 + e.pressure * 0.8)))
    return { x, y, t: e.timeStamp, w }
  }
  const down = (e) => {
    if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    canvas.current.setPointerCapture?.(e.pointerId)
    live.current = [point(e, null)]
    paint()
  }
  const move = (e) => {
    if (!live.current) return
    e.preventDefault()
    for (const ev of e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent]) {
      const last = live.current.at(-1)
      const p = point(ev, last)
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.8) live.current.push(p)
    }
    paint()
  }
  const up = () => {
    if (!live.current) return
    const s = live.current
    live.current = null
    setStrokes((x) => [...x, s])
  }
  useEffect(paint, [paint])
  const save = () => { const r = strokesToPng(strokes, INKS[ink]); if (r) onSave(r) }
  const label = what === 'initials' ? t('Draw your initials') : t('Draw your signature')
  return (
    <div className={`sd-pad ${what}`}>
      <div className="sd-pad-box">
        <canvas ref={canvas} className="sd-pad-canvas" aria-label={label} role="img"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} />
        <span className="sd-pad-line" aria-hidden="true"><Icon name="x" size={12} /></span>
        {!strokes.length && <span className="sd-pad-hint" aria-hidden="true">{label}</span>}
      </div>
      <p className="muted small sd-pad-how">{t('With a mouse or trackpad (hold the click down as you draw), a finger or a pen.')}</p>
      <div className="sd-pad-acts">
        <span className="sd-pad-inks" role="radiogroup" aria-label={t('Ink')}>
          {Object.entries(INKS).map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={ink === k} className={ink === k ? 'on' : ''} onClick={() => setInk(k)} title={k === 'black' ? t('Black ink') : t('Blue ink')} aria-label={k === 'black' ? t('Black ink') : t('Blue ink')}><i style={{ background: v }} /></button>)}
        </span>
        <span className="sd-grow" />
        <button type="button" className="ghost-btn" onClick={() => setStrokes((x) => x.slice(0, -1))} disabled={!strokes.length || busy} title={t('Undo the last stroke')}><Icon name="undo" size={12} /> {t('Undo')}</button>
        <button type="button" className="ghost-btn" onClick={() => setStrokes([])} disabled={!strokes.length || busy}>{t('Clear')}</button>
        {onCancel && <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>{t('Cancel')}</button>}
        <button type="button" className="btn small primary" onClick={save} disabled={!strokes.length || busy}><Icon name="check" size={12} /> {busy ? t('Keeping it…') : t('Keep it')}</button>
      </div>
    </div>
  )
}
