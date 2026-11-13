import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { t } from '../../i18n/index.js'
import { suggestions, boundsOf, keep, discard } from './suggest.js'

// AI Assist's suggestions on a board (suggest.js), over the drawing: a dashed outline around each,
// with the wand, the model that made it, Keep and Discard; and at the foot of the board how many
// there are, with Keep all and Discard all, so they can be settled from anywhere on it. Each is
// one step that ⌘Z takes back. board: { X, api }. bar: the foot's bar, which AI Assist's panel
// has in its place while it's open (it would be under it).
export default function Suggestions({ board, bar = true }) {
  const { X, api: ex } = board
  const host = useRef(null)
  const [view, setView] = useState({ list: [], sig: '' })
  useEffect(() => {
    if (!ex || !X) return undefined
    let raf = 0
    const look = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const box = host.current?.getBoundingClientRect()
        const st = ex.getAppState()
        if (!box) return
        const z = st.zoom?.value || 1
        // From the board's own coordinates to where they are in this layer.
        const at = (x, y) => ({ x: (x + st.scrollX) * z + (st.offsetLeft || 0) - box.left, y: (y + st.scrollY) * z + (st.offsetTop || 0) - box.top })
        // Its tag above it, kept inside the board (below its tools) where the outline runs past
        // an edge; none for one out of sight (the foot of the board still has it).
        const list = suggestions(ex.getSceneElements()).map((s) => {
          const b = boundsOf(X, s)
          if (!b) return null
          const p = at(b.x1, b.y1), q = at(b.x2, b.y2)
          const o = { id: s.id, by: s.by, left: p.x - 8, top: p.y - 8, width: q.x - p.x + 16, height: q.y - p.y + 16 }
          const seen = o.left < box.width && o.left + o.width > 0 && o.top < box.height && o.top + o.height > 0
          return { ...o, tag: seen ? { left: Math.max(8, Math.min(o.left, box.width - 300)), top: Math.max(60, Math.min(o.top - 30, box.height - 80)) } : null }
        }).filter(Boolean)
        const sig = list.map((s) => `${s.id}:${Math.round(s.left)},${Math.round(s.top)},${Math.round(s.width)},${Math.round(s.height)},${s.tag ? `${Math.round(s.tag.left)},${Math.round(s.tag.top)}` : ''}`).join('|')
        setView((v) => (v.sig === sig ? v : { list, sig }))
      })
    }
    look()
    const off = ex.onChange(look)
    window.addEventListener('resize', look)
    return () => { off?.(); window.removeEventListener('resize', look); cancelAnimationFrame(raf) }
  }, [ex, X])
  const settle = (fn, id = null) => ex.updateScene({ elements: fn(X, ex.getSceneElementsIncludingDeleted(), id), captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
  const n = view.list.length
  return (
    <div className="wb-sugs" ref={host} aria-label={t('Suggestions')}>
      {view.list.map((s) => <div key={s.id} className="wb-sug" style={{ left: s.left, top: s.top, width: Math.max(0, s.width), height: Math.max(0, s.height) }} />)}
      {view.list.filter((s) => s.tag).map((s) => (
        <div key={`${s.id}-tag`} className="wb-sug-tag" style={{ left: s.tag.left, top: s.tag.top }} role="group" aria-label={t('Suggested by {name}', { name: s.by || t('AI Assist') })}>
          <Icon name="wand" size={11} />
          <span className="wb-sug-by">{s.by ? t('Suggested by {name}', { name: s.by }) : t('Suggested')}</span>
          <button type="button" className="wb-sug-btn keep" onClick={() => settle(keep, s.id)}>{t('Keep')}</button>
          <button type="button" className="wb-sug-btn" onClick={() => settle(discard, s.id)}>{t('Discard')}</button>
        </div>
      ))}
      {n > 0 && bar && (
        <div className="wb-sug-bar" role="status">
          <Icon name="wand" size={12} />
          <span>{n === 1 ? t('A suggestion from AI Assist') : t('{n} suggestions from AI Assist', { n })}</span>
          <button type="button" className="btn small primary" onClick={() => settle(keep)}><Icon name="check" size={12} /> {n === 1 ? t('Keep') : t('Keep all')}</button>
          <button type="button" className="btn small" onClick={() => settle(discard)}>{n === 1 ? t('Discard') : t('Discard all')}</button>
        </div>
      )}
    </div>
  )
}
