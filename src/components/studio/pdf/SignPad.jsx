import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api, BASE } from '../../../api.js'
import { t, tx } from '../../../i18n/index.js'
import { stroke, drawStroke, strokesToPng, unpackStrokes } from './ink.js'
import './pdf.css'

// A pad to sign on, three ways, as Preview has them:
//   Draw       a mouse (the click held down), a finger or a pen: every point the pointer sends
//              (coalesced), a pen's pressure, smoothed as it's drawn (ink.js).
//   Trackpad   a Mac's trackpad as the pad itself (Preview's Trackpad tab): the finger's place on it,
//              not the pointer's moves, streamed from native/bridgesign while you draw; one finger
//              draws, lifting it ends a stroke, any key finishes, Esc starts again. Only in Bridge AI
//              on a Mac with a trackpad (setup.trackpad).
//   Phone      Sign on Phone: your phone shows a pad over its whole screen (PhoneSign.jsx), and what
//              you draw there comes back here (server/signphone.js). Only when one of your phones can
//              be asked now (setup.phones).
// Whichever way, the ink is drawn here, Undo takes the last stroke back, Clear starts again, and
// Keep it keeps a PNG of just the strokes, three times the size drawn, so it stays sharp on a page.
const INKS = { black: '#15171c', blue: '#1d3f9a' }
const MODES = [['draw', tx('Draw')], ['trackpad', tx('Trackpad')], ['phone', tx('Phone')]]
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

// what: 'signature' or 'initials' (a shorter pad). onSave({ png, width, height }) keeps it;
// onCancel. setup: what Sign this knows ({ trackpad, phones }); doc: the document's name, for the phone.
export default function SignPad({ what = 'signature', busy = false, onSave, onCancel, setup = null, doc = '' }) {
  const canvas = useRef(null)
  const [strokes, setStrokes] = useState([])
  const [ink, setInk] = useState('black')
  const [mode, setMode] = useState('draw')
  const live = useRef(null) // the stroke being drawn: { s: stroke(), id }
  const [inking, setInking] = useState(false) // a stroke being drawn (what the pad says goes)
  const size = useRef({ w: 0, h: 0 })
  const [shape, setShape] = useState(null) // the trackpad's width / height, once it's said
  const phones = setup?.phones || []
  const modes = MODES.filter(([m]) => m === 'draw' || (m === 'trackpad' && setup?.trackpad) || (m === 'phone' && phones.length))

  const paint = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.current.w, size.current.h)
    for (const s of [...strokes, ...(live.current ? [live.current.s.points] : [])]) drawStroke(ctx, s, INKS[ink])
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
  useEffect(paint, [paint])
  const end = () => {
    if (!live.current) return
    const pts = live.current.s.points
    live.current = null
    setInking(false)
    if (pts.length) setStrokes((x) => [...x, pts])
    else painter.current()
  }

  // ---------- Draw: the pointer ----------
  const at = (e) => {
    const r = canvas.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : null }
  }
  const down = (e) => {
    if (busy || mode !== 'draw' || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    canvas.current.setPointerCapture?.(e.pointerId)
    const s = stroke({ smooth: 'pen' })
    s.add(at(e))
    live.current = { s, id: e.pointerId }
    setInking(true)
    paint()
  }
  const move = (e) => {
    if (!live.current || live.current.id !== e.pointerId) return
    e.preventDefault()
    for (const ev of e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent]) live.current.s.add(at(ev))
    paint()
  }

  // ---------- Trackpad: native/bridgesign's finger ----------
  const [pad, setPad] = useState(null) // null | 'starting' | 'on' | { error } | { ended: why }
  const source = useRef(null)
  const before = useRef(0) // strokes kept before this session, for Esc
  const stopPad = useCallback(() => { source.current?.close(); source.current = null }, [])
  useEffect(() => stopPad, [stopPad])
  const startPad = () => {
    stopPad()
    before.current = strokes.length
    setPad('starting')
    const es = new EventSource(`${BASE}/api/studio/sign/trackpad?hint=${encodeURIComponent(t('Draw on the trackpad with one finger; press any key when done. Esc starts again.'))}`)
    source.current = es
    const place = ([x, y, p], ms) => ({ x: x * size.current.w, y: y * size.current.h, t: ms, p: p > 0 ? p : null })
    es.onmessage = (e) => {
      let j
      try { j = JSON.parse(e.data) } catch { return }
      if (j.ready) { setPad('on'); if (j.w > 0 && j.h > 0) setShape(j.w / j.h); return }
      if (j.d) { end(); const s = stroke({ smooth: 'trackpad' }); s.add(place(j.d, j.ms)); live.current = { s, id: 'pad' }; setInking(true); painter.current() } else if (j.m && live.current) { live.current.s.add(place(j.m, j.ms)); painter.current() } else if (j.u) end()
    }
    es.addEventListener('end', (e) => {
      let j = {}
      try { j = JSON.parse(e.data) } catch { /* ended */ }
      end()
      stopPad()
      if (j.cancel === 'escape') setStrokes((x) => x.slice(0, before.current))
      setPad(j.done ? null : { ended: j.cancel || 'stop' })
    })
    es.onerror = () => { if (source.current !== es) return; end(); stopPad(); setPad((p) => (p === 'starting' ? { error: t('The trackpad couldn\'t be used just now.') } : { ended: 'stop' })) }
  }

  // ---------- Phone: Sign on Phone ----------
  const [to, setTo] = useState(null)
  const phone = phones.find((p) => p.id === to) || phones[0] || null
  const [asked, setAsked] = useState(null) // { id, until, name } | { ended, name } | { error }
  const [now, setNow] = useState(Date.now())
  const askId = useRef(null)
  useEffect(() => {
    if (!asked?.id) return undefined
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [asked?.id])
  useEffect(() => () => { if (askId.current) api(`/studio/sign/phone/${askId.current}/cancel`, { method: 'POST' }).catch(() => {}) }, [])
  const askPhone = async () => {
    if (!phone) return
    setAsked(null)
    try {
      const r = await api('/studio/sign/phone', { method: 'POST', body: { what, doc, to: phone.id } })
      askId.current = r.id
      setAsked({ id: r.id, until: r.until, name: phone.name })
      for (;;) {
        const s = await api(`/studio/sign/phone/${r.id}/state?wait=1`)
        if (askId.current !== r.id) return
        if (s.state === 'waiting') continue
        askId.current = null
        if (s.state === 'answered' && s.ink) {
          const got = unpackStrokes(s.ink, size.current.w, size.current.h)
          if (got) setStrokes(got)
          setAsked({ ended: 'answered', name: s.by || phone.name })
        } else setAsked({ ended: s.state, by: s.cancelledBy, name: phone.name })
        return
      }
    } catch (e) { askId.current = null; setAsked({ error: e.message }) }
  }
  const cancelPhone = () => {
    const id = askId.current
    askId.current = null
    setAsked(null)
    if (id) api(`/studio/sign/phone/${id}/cancel`, { method: 'POST' }).catch(() => {})
  }

  const pick = (m) => {
    if (m === mode) return
    stopPad()
    setPad(null)
    if (askId.current) cancelPhone()
    live.current = null
    setStrokes([])
    setMode(m)
  }
  const save = () => { const r = strokesToPng(strokes, INKS[ink]); if (r) onSave(r) }
  const label = what === 'initials' ? t('Draw your initials') : t('Draw your signature')
  const waiting = !!asked?.id
  const how = mode === 'trackpad'
    ? pad === 'on' ? t('Draw on the trackpad with one finger; press any key when done. Esc starts again.')
      : pad === 'starting' ? t('Starting…')
        : pad?.error ? pad.error
          : pad?.ended === 'away' ? t('Stopped: another app came in front. Start again to go on.')
            : pad?.ended === 'time' ? t('Stopped after 2 minutes. Start again to go on.')
              : pad?.ended === 'focus' ? t('macOS kept another app in front, so the trackpad couldn\'t be used. Start again.')
              : pad?.ended === 'none' ? t('The trackpad couldn\'t be used just now.')
              : t('Use the trackpad as the pad: one finger draws, lifting it ends a stroke, any key finishes. The pointer stays still while you sign.')
    : mode === 'phone'
      ? waiting ? t('Waiting for {phone}: draw on it and press Use. {left} left.', { phone: asked.name, left: mmss(asked.until - now) })
        : asked?.ended === 'answered' ? t('From {phone}. Keep it, or Clear to ask again.', { phone: asked.name })
          : asked?.ended === 'expired' ? t('{phone} didn\'t answer in 2 minutes. Ask again when it\'s at hand.', { phone: asked.name })
            : asked?.ended === 'cancelled' ? (asked.by === 'phone' ? t('Cancelled on {phone}.', { phone: asked.name }) : t('Cancelled.'))
              : asked?.error ? t('Couldn\'t ask your phone: {error}', { error: asked.error })
                : t('Your phone shows a pad over its whole screen: sign there with your finger, and it comes back here.')
      : t('With a mouse or trackpad (hold the click down as you draw), a finger or a pen.')
  const box = mode === 'trackpad' ? { aspectRatio: String(shape || 1.6), height: 'auto' } : undefined
  return (
    <div className={`sd-pad ${what} m-${mode}`}>
      {modes.length > 1 && (
        <div className="sd-pad-modes" role="tablist" aria-label={t('How to sign')}>
          {modes.map(([m, l]) => <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => pick(m)} disabled={busy}><Icon name={m === 'draw' ? 'edit' : m === 'trackpad' ? 'trackpad' : 'phone'} size={12} /> {t(l)}</button>)}
        </div>
      )}
      <div className={`sd-pad-box${pad === 'on' ? ' listening' : ''}${waiting ? ' waiting' : ''}`} style={box}>
        <canvas ref={canvas} className="sd-pad-canvas" aria-label={label} role="img"
          onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} />
        <span className="sd-pad-line" aria-hidden="true"><Icon name="x" size={12} /></span>
        {!strokes.length && !inking && (
          <span className="sd-pad-hint" aria-hidden="true">
            {mode === 'trackpad' && pad !== 'on' ? null : mode === 'phone' && !waiting ? null : waiting ? t('Sign on your phone') : pad === 'on' ? t('Draw on the trackpad') : label}
          </span>
        )}
        {mode === 'trackpad' && pad !== 'on' && pad !== 'starting' && (
          <span className="sd-pad-over"><button type="button" className="btn small primary" onClick={startPad} disabled={busy}><Icon name="trackpad" size={12} /> {strokes.length ? t('Draw more on the trackpad') : t('Start on the trackpad')}</button></span>
        )}
        {mode === 'phone' && !waiting && !strokes.length && (
          <span className="sd-pad-over">
            <button type="button" className="btn small primary" onClick={askPhone} disabled={busy || !phone}><Icon name="phone" size={12} /> {t('Sign on Phone')}</button>
            {phones.length > 1
              ? <select className="sd-pad-to" value={phone?.id || ''} onChange={(e) => setTo(e.target.value)} aria-label={t('Which phone')}>{phones.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              : phone && <small className="muted">{t('On {phone}', { phone: phone.name })}</small>}
          </span>
        )}
      </div>
      <p className="muted small sd-pad-how" aria-live="polite">{how}</p>
      <div className="sd-pad-acts">
        <span className="sd-pad-tools">
          <span className="sd-pad-inks" role="radiogroup" aria-label={t('Ink')}>
            {Object.entries(INKS).map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={ink === k} className={ink === k ? 'on' : ''} onClick={() => setInk(k)} title={k === 'black' ? t('Black ink') : t('Blue ink')} aria-label={k === 'black' ? t('Black ink') : t('Blue ink')}><i style={{ background: v }} /></button>)}
          </span>
          <button type="button" className="ghost-btn" onClick={() => setStrokes((x) => x.slice(0, -1))} disabled={!strokes.length || busy || pad === 'on'} title={t('Undo the last stroke')}><Icon name="undo" size={12} /> {t('Undo')}</button>
          <button type="button" className="ghost-btn" onClick={() => setStrokes([])} disabled={!strokes.length || busy || pad === 'on'}>{t('Clear')}</button>
        </span>
        <span className="sd-pad-done">
          {waiting && <button type="button" className="ghost-btn" onClick={cancelPhone}>{t('Stop asking')}</button>}
          {pad === 'on' && <button type="button" className="ghost-btn" onClick={() => { stopPad(); setPad(null) }}>{t('Stop')}</button>}
          {onCancel && <button type="button" className="ghost-btn" onClick={() => { stopPad(); if (askId.current) cancelPhone(); onCancel() }} disabled={busy}>{t('Cancel')}</button>}
          <button type="button" className="btn small primary" onClick={save} disabled={!strokes.length || busy || pad === 'on'}><Icon name="check" size={12} /> {busy ? t('Keeping it…') : t('Keep it')}</button>
        </span>
      </div>
    </div>
  )
}
export { strokesToPng }
