import { useEffect, useMemo } from 'react'
import Icon from '../../Icon.jsx'
import { t, tx } from '../../../i18n/index.js'
import { shownSize, dateSize, dateSpot, DATE_PAD } from '../../../../shared/signmarks.js'
import { sigUrl } from './Signatures.jsx'

// The places to sign, over the pages: each where it'll be written, with your signature, initials
// or the date in it as the signed copy will have them (shared/signmarks.js works out both). Drag
// one to move it, its corner to resize it; picked, the arrow keys move it (⇧ by more), Enter
// approves it and Delete takes it away. Not approved yet, it's dashed and says what it wants.
export const KIND = { signature: tx('Sign here'), initials: tx('Initials'), date: tx('Date') }
const KEEP = { signature: 14, initials: 10, date: 8 } // the smallest a box gets, in points

// Where a mark's box is in the viewer's scrolling area, in CSS pixels; null while its page isn't laid out.
export function rectOf(viewer, m) {
  const pv = viewer?.getPageView(m.page - 1)
  if (!pv?.div || !pv.viewport) return null
  const vp = pv.viewport
  const [a, b] = vp.convertToViewportPoint(m.x, m.y)
  const [c, d] = vp.convertToViewportPoint(m.x + m.w, m.y + m.h)
  return { left: pv.div.offsetLeft + pv.div.clientLeft + Math.min(a, c), top: pv.div.offsetTop + pv.div.clientTop + Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b), px: vp.scale, rotation: vp.rotation, pv }
}
// A box drawn in the page's pixels (left, top, right, bottom), back in its points.
function toPdf(vp, l, tp, r, b) {
  const [x1, y1] = vp.convertToPdfPoint(l, tp)
  const [x2, y2] = vp.convertToPdfPoint(r, b)
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}
let ruler = null
const width1 = (text) => { ruler ||= document.createElement('canvas').getContext('2d'); ruler.font = '100px Helvetica, Arial, sans-serif'; return ruler.measureText(text).width / 100 }

export default function Marks({ pdf, layout, marks, setMarks, picked, setPicked, onApprove, dateText, sig }) {
  const viewer = pdf?.viewer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const boxes = useMemo(() => marks.map((m) => ({ m, r: rectOf(viewer, m) })).filter((x) => x.r), [marks, viewer, layout])
  const change = (id, f) => setMarks((ms) => ms.map((x) => (x.id === id ? { ...x, ...f(x) } : x)))
  const remove = (id) => { setMarks((ms) => ms.filter((x) => x.id !== id)); setPicked(null) }

  // Moved or resized with the pointer, kept on its page; off a form's field once it's moved.
  const drag = (e, m, how) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setPicked(m.id)
    const r = rectOf(viewer, m)
    if (!r) return
    const { pv } = r
    const vp = pv.viewport
    const W = pv.div.clientWidth, H = pv.div.clientHeight
    const l0 = r.left - pv.div.offsetLeft - pv.div.clientLeft, t0 = r.top - pv.div.offsetTop - pv.div.clientTop
    const sx = e.clientX, sy = e.clientY
    const min = KEEP[m.kind] * r.px
    const el = e.currentTarget
    el.setPointerCapture?.(e.pointerId)
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      let l = l0, tp = t0, rt = l0 + r.width, bt = t0 + r.height
      if (how === 'move') {
        l = Math.max(0, Math.min(W - r.width, l0 + dx)); tp = Math.max(0, Math.min(H - r.height, t0 + dy))
        rt = l + r.width; bt = tp + r.height
      } else {
        rt = Math.max(l0 + min, Math.min(W, l0 + r.width + dx)); bt = Math.max(t0 + min * 0.6, Math.min(H, t0 + r.height + dy))
      }
      const box = toPdf(vp, l, tp, rt, bt)
      change(m.id, () => ({ ...box, field: Math.abs(box.x - m.x) + Math.abs(box.y - m.y) + Math.abs(box.w - m.w) + Math.abs(box.h - m.h) > 3 ? null : m.field, moved: true }))
    }
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  // The keyboard, on the one picked.
  useEffect(() => {
    if (!picked) return undefined
    const key = (e) => {
      // Only on the page or the box itself: Delete in the panel, or a field, is theirs.
      if (!(e.target === document.body || e.target?.closest?.('.sd-mark, .sd-pdf-scroll')) || e.target?.closest?.('input, textarea, select, button')) return
      const m = marks.find((x) => x.id === picked)
      if (!m) return
      const by = e.shiftKey ? 10 : 1
      const d = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, by], ArrowDown: [0, -by] }[e.key]
      if (d) {
        e.preventDefault()
        const page = viewer?.getPageView(m.page - 1)?.pdfPage?.view || [0, 0, Infinity, Infinity]
        change(m.id, (x) => ({ x: Math.max(page[0], Math.min(page[2] - x.w, x.x + d[0])), y: Math.max(page[1], Math.min(page[3] - x.h, x.y + d[1])), field: null, moved: true }))
      } else if (e.key === 'Enter') { e.preventDefault(); onApprove(m.id) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(m.id) }
      else if (e.key === 'Escape') setPicked(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    <div className="sd-marks">
      {boxes.map(({ m, r }) => {
        const on = picked === m.id
        const meta = m.kind === 'date' ? null : sig?.[m.kind]
        const shown = shownSize(m, r.rotation)
        let date = null
        if (m.kind === 'date' && dateText) {
          const size = dateSize(shown.w, shown.h, width1(dateText))
          const at = dateSpot(shown.h, size)
          date = <span className="sd-mark-date" style={{ fontSize: size * r.px, left: DATE_PAD * r.px, bottom: Math.max(0, (at.v - size * 0.21) * r.px) }}>{dateText}</span>
        }
        return (
          <div key={m.id} className={`sd-mark ${m.kind}${m.approved ? ' ok' : ''}${on ? ' on' : ''}`} style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            data-mark={m.id} data-kind={m.kind} data-page={m.page} data-box={[m.x, m.y, m.w, m.h].map((v) => Math.round(v * 10) / 10).join(',')}
            role="button" tabIndex={0} aria-pressed={on} aria-label={`${t(KIND[m.kind])}, ${t('page {n}', { n: m.page })}${m.approved ? `, ${t('approved')}` : ''}`}
            onPointerDown={(e) => drag(e, m, 'move')} onFocus={() => setPicked(m.id)}>
            {!m.approved && <span className="sd-mark-tag"><Icon name={m.kind === 'date' ? 'calendar' : 'signature'} size={10} /> {t(KIND[m.kind])}</span>}
            {m.approved && <span className="sd-mark-tag ok"><Icon name="check" size={10} /></span>}
            {meta && <img className={`sd-mark-pic ${m.align}`} src={sigUrl(m.kind, meta.at)} alt="" draggable={false} />}
            {date}
            {!meta && m.kind !== 'date' && <span className="sd-mark-empty">{m.kind === 'initials' ? t('Your initials') : t('Your signature')}</span>}
            {on && <span className="sd-mark-size" onPointerDown={(e) => drag(e, m, 'size')} role="presentation" title={t('Drag to resize')} />}
            {on && (
              <span className="sd-mark-acts" onPointerDown={(e) => e.stopPropagation()}>
                {m.approved
                  ? <button type="button" className="btn small" onClick={() => change(m.id, () => ({ approved: false }))}><Icon name="check" size={11} /> {t('Approved')}</button>
                  : <button type="button" className="btn small primary" onClick={() => onApprove(m.id)}><Icon name="check" size={11} /> {t('Approve')}</button>}
                <button type="button" className="btn small" onClick={() => remove(m.id)} aria-label={t('Take this place away')} title={t('Take this place away')}><Icon name="x" size={11} /></button>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
