// A project's app in the Preview tab on a phone (Remote Screen and Preview, a Beta Feature): drawn by
// the desktop app on the computer that runs it, in a window of its own off screen, and sent here as
// pictures through the link; taps, scrolling and typing go back to that page alone. Nothing of the
// app runs on the phone, so it can't reach anything of Bridge AI's there. That computer may ask for
// its Remote Access Password first, or for someone there to allow it (Gate).
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { t } from '../../i18n/index.js'
import { connect, pointOn } from './remote.js'
import Gate, { gateOf } from './Gate.jsx'
import './remote.css'

export default function PageView({ base, port, path = '/', name }) {
  const stage = useRef(null)
  const img = useRef(null)
  const conn = useRef(null)
  const lastUrl = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [state, setState] = useState({ phase: 'connecting' })
  const [run, setRun] = useState(0)
  useEffect(() => {
    const el = stage.current
    const r = el?.getBoundingClientRect() || { width: 390, height: 700 }
    const page = { w: Math.max(320, Math.round(r.width)), h: Math.max(320, Math.round(r.height)) }
    setState({ phase: 'connecting' })
    const c = connect({
      base, source: `page:${port}`, page,
      on: {
        hello: () => setState({ phase: 'live' }),
        frame: (f) => {
          const i = img.current
          if (!i) return
          const url = URL.createObjectURL(new Blob([f.bytes], { type: f.type || 'image/jpeg' }))
          i.onload = () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); lastUrl.current = url; conn.current?.ack() }
          i.onerror = () => { URL.revokeObjectURL(url); conn.current?.ack() }
          i.src = url
          if (f.w && f.h) setSize({ w: f.w, h: f.h })
        },
        message: (m) => {
          if (m.t === 'error') setState({ phase: 'error', why: m.why })
          else if (gateOf(m)) setState({ phase: 'gate', gate: gateOf(m) })
          else if (m.t === 'size' && m.w) setSize({ w: m.w, h: m.h })
        },
        closed: () => setState((x) => (x.phase === 'error' ? x : { phase: 'ended' })),
      },
    })
    conn.current = c
    return () => { c.close(); conn.current = null; if (lastUrl.current) { URL.revokeObjectURL(lastUrl.current); lastUrl.current = null } }
  }, [base, port, run])
  useEffect(() => { if (state.phase === 'live' && path) conn.current?.send({ t: 'go', path }) }, [path, state.phase])

  // A tap is a click there; a drag scrolls it.
  const drag = useRef(null)
  const at = (e) => pointOn(img.current, size.w, size.h, e.clientX, e.clientY)
  const down = (e) => { const p = state.phase === 'live' && at(e); if (!p) return; drag.current = { p, x: e.clientX, y: e.clientY, moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not here */ } }
  const move = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 8) return
    d.moved = true
    conn.current?.input([{ t: 'wheel', dx: -dx * 2, dy: -dy * 2, ...d.p }])
    d.x = e.clientX
    d.y = e.clientY
  }
  const up = () => { const d = drag.current; drag.current = null; if (d && !d.moved) conn.current?.input([{ t: 'move', ...d.p }, { t: 'down', b: 0, ...d.p }, { t: 'up', b: 0, ...d.p }]) }
  const typed = (e) => { const v = e.target.value; if (v) conn.current?.input([{ t: 'text', s: v }]) }
  const typedKey = (e) => {
    const code = { Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab' }[e.key]
    if (!code) return
    e.preventDefault()
    conn.current?.input([{ t: 'key', code, down: true }, { t: 'key', code, down: false }])
  }
  return (
    <div className="pv-pages">
      <div className="pv-pages-note"><Icon name="info" size={12} /> {t('Drawn on {name} and shown here as pictures. Tap to click, drag to scroll.', { name })}</div>
      <div className="pv-pages-stage" ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null }}>
        <img ref={img} alt={t('The app on port {port}', { port })} hidden={state.phase !== 'live'} draggable={false} />
        {state.phase === 'gate' && <Gate gate={state.gate} name={name} onPassword={(p) => conn.current?.send({ t: 'password', p })} onCancel={() => { conn.current?.close(); setState({ phase: 'ended' }) }} />}
        {state.phase !== 'live' && state.phase !== 'gate' && (
          <div className="viewer-empty">
            <Icon name={state.phase === 'connecting' ? 'refresh' : 'alert'} size={20} className={state.phase === 'connecting' ? 'spin' : undefined} />
            <p>{state.phase === 'connecting' ? t('Asking {name} for the app…', { name }) : state.why || t('Not showing the app any more.')}</p>
            {state.phase !== 'connecting' && <button type="button" className="btn small" onClick={() => setRun((n) => n + 1)}>{t('Try again')}</button>}
          </div>
        )}
      </div>
      {state.phase === 'live' && <div className="pv-pages-type"><input className="st-input" value="" onChange={typed} onKeyDown={typedKey} autoCapitalize="off" autoCorrect="off" placeholder={t('Type in the app')} aria-label={t('Type in the app')} /></div>}
    </div>
  )
}
