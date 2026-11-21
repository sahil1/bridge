import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api, signsLive } from '../../../api.js'
import { t } from '../../../i18n/index.js'
import { stroke, drawStroke, packStrokes } from './ink.js'
import './phonesign.css'

// Sign on Phone, on the phone (server/signphone.js): when the pad on your computer asks this phone
// for a signature or initials, a pad over the whole screen, with what it's for, the time left, Use
// and Cancel. What you draw goes back as strokes (ink.js), for the pad there to show and keep. It
// comes on this device's live feed (event: sign: what's waiting for it), and from a notification
// tapped (?sign=<id>, pwa.js). Once it ends on the computer (cancelled, or 2 minutes passed), it
// says so and goes.
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export default function PhoneSign() {
  const [list, setList] = useState(() => signsLive.get())
  const [opened, setOpened] = useState(null) // one a notification opened, before the feed says
  const [ended, setEnded] = useState(null) // what's said once one ends: { text }
  const [gone, setGone] = useState(() => new Set()) // answered or cancelled here
  // What's waiting, and one a notification opened (signsLive.open, pwa.js), looked up.
  useEffect(() => {
    const look = () => {
      const id = signsLive.take()
      if (!id) return
      api(`/studio/sign/phone/${encodeURIComponent(id)}`).then((r) => setOpened(r.state === 'waiting' ? r : null), (err) => setEnded({ text: err.code === 'gone' ? t('That request to sign has ended.') : err.message }))
    }
    look()
    return signsLive.subscribe((l) => { setList(l); look() })
  }, [])
  const waiting = [...list, ...(opened && !list.some((x) => x.id === opened.id) ? [opened] : [])].filter((r) => !gone.has(r.id) && r.until > Date.now())
  const req = waiting[0] || null
  // One that was showing and isn't waiting any more, not because of this phone: said why.
  const shown = useRef(null)
  useEffect(() => {
    const was = shown.current
    shown.current = req?.id || null
    if (was && !req && !gone.has(was)) {
      api(`/studio/sign/phone/${encodeURIComponent(was)}`).then(
        (r) => setEnded({ text: r.state === 'expired' ? t('The request ran out of time.') : r.state === 'answered' ? t('Signed already.') : t('Cancelled on the computer.') }),
        () => setEnded({ text: t('The request to sign ended.') }),
      )
      if (opened?.id === was) setOpened(null)
    }
  }, [req, gone, opened])
  useEffect(() => { if (!ended) return undefined; const id = setTimeout(() => setEnded(null), 4000); return () => clearTimeout(id) }, [ended])
  if (!req) return ended ? <div className="ps-toast" role="status">{ended.text}</div> : null
  return <Pad key={req.id} req={req} onDone={(text) => { setGone((g) => new Set(g).add(req.id)); if (opened?.id === req.id) setOpened(null); if (text) setEnded({ text }) }} />
}

function Pad({ req, onDone }) {
  const canvas = useRef(null)
  const size = useRef({ w: 0, h: 0 })
  const live = useRef(null)
  const [strokes, setStrokes] = useState([])
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id) }, [])
  const paint = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.current.w, size.current.h)
    for (const s of [...strokes, ...(live.current ? [live.current.s.points] : [])]) drawStroke(ctx, s, '#15171c')
  }, [strokes])
  const painter = useRef(paint)
  painter.current = paint
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
  // Nothing behind it scrolls or zooms while it's up.
  useEffect(() => { const was = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = was } }, [])
  const at = (e) => { const r = canvas.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : null } }
  const down = (e) => {
    if (busy) return
    e.preventDefault()
    canvas.current.setPointerCapture?.(e.pointerId)
    const s = stroke({ smooth: 'pen' })
    s.add(at(e))
    live.current = { s, id: e.pointerId }
    paint()
  }
  const move = (e) => {
    if (!live.current || live.current.id !== e.pointerId) return
    e.preventDefault()
    for (const ev of e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent]) live.current.s.add(at(ev))
    paint()
  }
  const up = () => { if (!live.current) return; const pts = live.current.s.points; live.current = null; if (pts.length) setStrokes((x) => [...x, pts]) }
  const use = async () => {
    setBusy(true); setErr(null)
    try {
      await api(`/studio/sign/phone/${encodeURIComponent(req.id)}/answer`, { method: 'POST', body: { nonce: req.nonce, ink: packStrokes(strokes, size.current.w, size.current.h) } })
      onDone(t('Sent to {computer}. Keep it there.', { computer: req.computer }))
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true)
    await api(`/studio/sign/phone/${encodeURIComponent(req.id)}/cancel`, { method: 'POST' }).catch(() => {})
    onDone(t('Cancelled.'))
  }
  const left = req.until - now
  return (
    <div className="ps" role="dialog" aria-modal="true" aria-label={req.what === 'initials' ? t('Your initials for {computer}', { computer: req.computer }) : t('Your signature for {computer}', { computer: req.computer })}>
      <div className="ps-head">
        <span className="ps-ic"><Icon name="signature" size={16} /></span>
        <span className="ps-title">
          <b>{req.what === 'initials' ? t('Your initials for {computer}', { computer: req.computer }) : t('Your signature for {computer}', { computer: req.computer })}</b>
          <small className="muted">{req.doc ? t('For {doc} · {left} left', { doc: req.doc, left: mmss(left) }) : t('{left} left', { left: mmss(left) })}</small>
        </span>
      </div>
      <div className="ps-box">
        <canvas ref={canvas} className="ps-canvas" aria-label={req.what === 'initials' ? t('Draw your initials') : t('Draw your signature')} role="img"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} />
        <span className="ps-line" aria-hidden="true"><Icon name="x" size={14} /></span>
        {!strokes.length && <span className="ps-hint" aria-hidden="true">{req.what === 'initials' ? t('Draw your initials with your finger') : t('Sign with your finger')}</span>}
      </div>
      <p className="muted small ps-turn">{t('Turn your phone sideways for more room.')}</p>
      {err && <p className="error-text small" role="alert">{err}</p>}
      <div className="ps-acts">
        <span className="ps-tools">
          <button type="button" className="ghost-btn" onClick={() => setStrokes((x) => x.slice(0, -1))} disabled={!strokes.length || busy}><Icon name="undo" size={14} /> {t('Undo')}</button>
          <button type="button" className="ghost-btn" onClick={() => setStrokes([])} disabled={!strokes.length || busy}>{t('Clear')}</button>
        </span>
        <span className="ps-done">
          <button type="button" className="btn" onClick={cancel} disabled={busy}>{t('Cancel')}</button>
          <button type="button" className="btn primary" onClick={use} disabled={!strokes.length || busy}><Icon name="check" size={14} /> {busy ? t('Sending…') : t('Use')}</button>
        </span>
      </div>
    </div>
  )
}
