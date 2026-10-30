import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from '../Icon.jsx'
import { api, usePoll, useFleet } from '../../api.js'
import { MEETINGS_CHANNEL, clock, useCallEvent, QuickNote } from './recording.jsx'
import { KIND, setAssist, markAssist } from './assist.jsx'
import { t, locale } from '../../i18n/index.js'
import './meetings.css'

// The floating card (desktop app, ?float=1): a small window over your other windows. While a
// meeting records it's a slim bar (how long, what, Pause or Resume), and opens on hover: how loud
// you and the call are, who's talked how much, the last few minutes as bars, the last things said,
// when the meeting ends, Pause, New section and Stop, watching the shared screen and Capture, a quick note, and
// the way back to the meeting or to every meeting. Pinned, it stays open. Set to open on a click
// instead (Settings › Meetings), a click on the bar opens and closes it. On a Mac it can move to the
// menu bar for the meeting, out of the way of a screen you share. When a call starts: Take notes.
// When it ends: Stop or keep recording. Otherwise (Settings › Meetings › Always): what needs you.
// With AI Assist on, its newest suggestion shows under the bar, open or not, since you're looking
// at the call: ✓ puts it in your notes, ✕ waves it away.
// Drag it from anywhere that isn't a button.
// The recording itself is in the main window; this one asks it over a BroadcastChannel, and asks
// the desktop app (preload) to start notes for a call, to open things and to fit its size.
const app = () => window.bridgeApp || {}
const PIN = 'cc-float-pin'
const pinned0 = () => { try { return localStorage.getItem(PIN) === '1' } catch { return false } }

// The last 12 minutes in 30-second bars: you above the line, the call below.
const SPAN = 24, STEP = 30
function talk(lines, now) {
  const you = new Array(SPAN).fill(0), them = new Array(SPAN).fill(0)
  const from = Math.max(0, now - SPAN * STEP)
  let a = 0, b = 0
  for (const l of lines) {
    const d = Math.max(0, (l.t1 ?? l.t0) - l.t0)
    if (l.src === 'them') b += d; else a += d
    for (let i = 0; i < SPAN; i++) {
      const s0 = from + i * STEP, s1 = s0 + STEP
      const o = Math.max(0, Math.min(s1, l.t1 ?? l.t0) - Math.max(s0, l.t0))
      if (o) (l.src === 'them' ? them : you)[i] += o
    }
  }
  return { you, them, share: a + b > 0 ? Math.round((a / (a + b)) * 100) : null }
}
function Bars({ you, them }) {
  const w = 276, h = 30, bw = w / SPAN
  return (
    <svg className="fc-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t('Who talked, the last 12 minutes')}>
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="axis" />
      {you.map((v, i) => v > 0 && <rect key={`y${i}`} className="you" x={i * bw + 1} width={bw - 2} y={h / 2 - Math.max(1.5, (v / STEP) * 13)} height={Math.max(1.5, (v / STEP) * 13)} rx="1" />)}
      {them.map((v, i) => v > 0 && <rect key={`t${i}`} className="them" x={i * bw + 1} width={bw - 2} y={h / 2} height={Math.max(1.5, (v / STEP) * 13)} rx="1" />)}
    </svg>
  )
}
const Level = ({ v = 0, label }) => {
  const on = Math.min(6, Math.round(Math.sqrt(v) * 6 * 1.4))
  return <span className="fc-level" aria-label={t('{label} level', { label })}>{Array.from({ length: 6 }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}<small>{label}</small></span>
}

export default function FloatCard() {
  const { data: c, refresh } = usePoll('/calls', 2000)
  const { fleet } = useFleet()
  const [live, setLive] = useState(null) // { rec, elapsed, you } from the main window
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(pinned0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const chan = useRef(null)
  const card = useRef(null)
  const leave = useRef(null)
  const r = c?.recording
  const onHover = c?.floatHover !== false
  // Low on the screen, the desktop app's window grows upward (desktop/main.js), so the rest opens
  // above the bar. In a browser tab the page doesn't move.
  const up = !!app().floatSize && window.screenY + window.outerHeight / 2 > (window.screen.availTop || 0) + window.screen.availHeight / 2
  const { data: m } = usePoll(r ? `/meetings/${encodeURIComponent(r.id)}` : null, hover || pinned ? 1500 : 4000)
  const ev = useCallEvent(!r && c?.prompt ? c.prompt.at : null)

  useEffect(() => {
    const ch = new BroadcastChannel(MEETINGS_CHANNEL)
    chan.current = ch
    ch.onmessage = (e) => {
      const d = e.data || {}
      if (d.type === 'state') setLive(d)
      if (d.type === 'error') setErr(d.text)
    }
    ch.postMessage({ type: 'hello' })
    return () => ch.close()
  }, [])
  // The window fits the card.
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const fit = () => { const b = el.getBoundingClientRect(); app().floatSize?.(Math.ceil(b.width) + 24, Math.ceil(b.height) + 24) }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  })
  // Hidden (the window, or what it shows changed): no longer under the pointer.
  useEffect(() => { setHover(false) }, [r?.id, c?.prompt?.at])
  useEffect(() => {
    const v = () => { if (document.hidden) setHover(false) }
    document.addEventListener('visibilitychange', v)
    return () => document.removeEventListener('visibilitychange', v)
  }, [])
  const pin = () => { const v = !pinned; setPinned(v); try { localStorage.setItem(PIN, v ? '1' : '0') } catch { /* no storage */ } }
  // Moved by dragging anywhere on it that isn't a button or a box to type in (the desktop app
  // moves the window, kept on the screen and against its edge when let go near one; it remembers
  // where). One move a frame, and it stays as it is (open or slim) while it moves.
  const drag = useRef(null)
  const [dragging, setDragging] = useState(false)
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, textarea, a, summary, label')) return
    drag.current = { x: e.screenX, y: e.screenY, wx: window.screenX, wy: window.screenY, moved: false, head: !!e.target.closest('.fc-head'), frame: 0 }
    if (app().floatMove) try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a pointer that can't be captured: moves still come while it's over the card */ }
  }
  const move = (e) => {
    const d = drag.current
    if (!d || !app().floatMove) return
    const dx = e.screenX - d.x, dy = e.screenY - d.y
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    if (!d.moved) { d.moved = true; setDragging(true); clearTimeout(leave.current) }
    d.to = [Math.round(d.wx + dx), Math.round(d.wy + dy)]
    if (!d.frame) d.frame = requestAnimationFrame(() => { d.frame = 0; if (d.to) app().floatMove(...d.to) })
  }
  // Let go: remembered where it was dragged to; or, set to open on a click, a click on the bar
  // (anywhere that isn't a button) opens or closes it.
  const release = () => {
    const d = drag.current
    drag.current = null
    if (d?.frame) { cancelAnimationFrame(d.frame); if (d.to) app().floatMove(...d.to) }
    if (d?.moved) { app().floatMove(null, null); setDragging(false) }
    else if (d?.head && !onHover) setHover((v) => !v)
  }
  // Open while the pointer is on it, or while a note is being written in it; closed a moment after.
  const writing = () => { const i = card.current?.querySelector('.fc-note input'); return !!i && (i.value.trim() !== '' || (document.activeElement === i && document.hasFocus())) }
  const enter = () => { clearTimeout(leave.current); if (onHover && !drag.current?.moved) setHover(true) }
  const out = () => { clearTimeout(leave.current); if (onHover && !drag.current?.moved) leave.current = setTimeout(() => { if (!writing()) setHover(false) }, 500) }
  // macOS lets Bridge AI hear a call only once it's allowed (System Audio Recording): until then a
  // call's sound is silence. Opens the settings page to allow it.
  const allowCall = () => api('/fix/settings', { method: 'POST', body: { pane: 'audio' } }).catch((e) => setErr(e.message))

  const act = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false); refresh() } }
  // Pause, Resume, Stop and New section go to the main window when it's the one recording (it has the mic);
  // a meeting recorded somewhere else (a browser tab) is paused or stopped on the server, and that
  // tab's mic stops when it sees so.
  const op = (o) => (live?.rec?.id && live.rec.id === r?.id ? chan.current?.postMessage({ type: 'op', op: o }) : act(() => api(`/meetings/${encodeURIComponent(r.id)}/${o}`, { method: 'POST' })))
  const grip = <span className="fc-grip" title={t('Drag to move it')} aria-hidden="true"><Icon name="grip" size={13} /></span>
  const hide = <button type="button" className="fc-x" onClick={() => app().floatHide?.()} aria-label={t('Hide the card')} title={t('Hide until the next call')}><Icon name="x" size={12} /></button>

  let body
  let open = true
  if (r) {
    const paused = live?.rec?.id === r.id ? live.rec.paused : r.status === 'paused'
    const secs = live?.rec?.id === r.id ? live.elapsed : (Date.now() - new Date(r.startedAt).getTime()) / 1000
    const said = (m?.transcript || []).filter((l) => l.text)
    const recent = said.slice(-3)
    const left = r.stopsAt ? Math.max(0, Math.round((new Date(r.stopsAt).getTime() - Date.now()) / 1000)) : null
    const talked = talk(said, secs)
    const here = live?.rec?.id === r.id
    const screen = here ? live.screen : null
    const shots = (m?.captures || []).filter((c) => c.kind !== 'paste').length
    const notes = (m?.notes || '').split('\n').filter((x) => x.trim() && !/^#{1,3} /.test(x)).length
    const end = m?.event?.end ? new Date(m.event.end) : null
    const toEnd = end ? Math.round((end.getTime() - Date.now()) / 60000) : null
    const part = m?.sections?.length ? m.sections[m.sections.length - 1].title : null
    const tip = m?.assist ? [...(m.assistItems || [])].reverse().find((x) => x.state === 'new') : null
    open = hover || (onHover && pinned) || !!r.callEnded
    body = (
      <>
        <div className={`fc-head${onHover ? '' : ' fc-click'}`}>
          {grip}
          <span className={paused ? 'paused' : ''}><span className="rec-dot" aria-hidden="true" /></span>
          <b className="fc-time">{clock(secs)}</b>
          <span className="fc-title" title={r.title}>{r.title}</span>
          {r.callQuiet && !paused && <button type="button" className="fc-x fc-warn" onClick={allowCall} aria-label={t('No sound from the call')} title={t("No sound from the call. If people are talking, Bridge AI isn't allowed to hear it yet: click to open the setting")}><Icon name="alert" size={12} /></button>}
          {!r.callEnded && (paused
            ? <button type="button" className="fc-x fc-play" onClick={() => op('resume')} aria-label={t('Resume')} title={t('Resume recording')}><Icon name="play" size={12} /></button>
            : <button type="button" className="fc-x" onClick={() => op('pause')} aria-label={t('Pause')} title={t('Pause recording')}><Icon name="pause" size={12} /></button>)}
          {onHover
            ? <button type="button" className={`fc-x${pinned ? ' on' : ''}`} onClick={pin} aria-pressed={pinned} aria-label={t('Pin it open')} title={pinned ? t('Pinned open. Click to open it on hover only') : t('Pin it open')}><Icon name="pin" size={12} /></button>
            : <button type="button" className="fc-x" onClick={() => setHover((v) => !v)} aria-expanded={open} aria-label={open ? t('Show less') : t('Show more')} title={open ? t('Show less') : t('Show more')}><Icon name={open ? 'up' : 'down'} size={12} /></button>}
          {app().platform === 'darwin' && app().floatHide && <button type="button" className="fc-x" onClick={() => app().floatHide()} aria-label={t('Move to the menu bar')} title={t('Move to the menu bar, out of the way of a screen you share')}><Icon name="minimize" size={12} /></button>}
        </div>
        {tip && (
          <div className={`fc-tip ${tip.kind}`} role="status">
            <span className="fc-tip-kind">{t(KIND[tip.kind] || KIND.idea)}</span>
            <span className="fc-tip-text" title={tip.why || ''}>{tip.text}</span>
            <button type="button" className="fc-x" onClick={() => act(() => markAssist(r.id, tip.id, 'kept'))} aria-label={t('Add to my notes')} title={t('Add to my notes')}><Icon name="check" size={12} /></button>
            <button type="button" className="fc-x" onClick={() => act(() => markAssist(r.id, tip.id, 'dismissed'))} aria-label={t('Dismiss')} title={t('Dismiss')}><Icon name="x" size={12} /></button>
          </div>
        )}
        {open && (
          <div className="fc-more">
            {r.callEnded && <p className="fc-line"><b>{r.callEndedApp ? t('The {app} call ended.', { app: r.callEndedApp }) : t('The call ended.')}</b> {left != null ? t('Stopping in {time}.', { time: clock(left) }) : t('Stop recording?')}</p>}
            {r.callQuiet && !paused && <p className="fc-line fc-quiet" role="status"><b>{t('No sound from the call.')}</b> {t('If people are talking, allow Bridge AI under System Settings › Privacy & Security › Screen & System Audio Recording, in System Audio Recording Only.')} <button type="button" className="link-btn" onClick={allowCall}>{t('Open it')}</button></p>}
            <div className="fc-viz">
              <div className="fc-row">
                <Level v={here ? live.you : m?.levels?.you} label={t('You')} />
                {m?.call === 'on' ? <Level v={m?.levels?.them} label={t('Call')} /> : <small className="muted">{t('Your mic only')}</small>}
              </div>
              <Bars you={talked.you} them={talked.them} />
              {talked.share != null && <span className="fc-share" title={t("Who's talked, of everything said so far")}><b>{t('You {n}%', { n: talked.share })}</b><i style={{ '--you': `${talked.share}%` }} /><b>{t('Call {n}%', { n: 100 - talked.share })}</b></span>}
            </div>
            <div className="fc-said">
              {recent.length ? recent.map((l) => <p key={`${l.src}:${l.t0}`} className={`fc-said-line ${l.src}`}><b>{l.name || (l.src === 'them' ? t('Them') : m?.me || t('You'))}</b> {l.text}</p>) : <p className="muted">{paused ? t('Paused.') : t('Listening…')}</p>}
            </div>
            <p className="fc-info muted">
              {[part, toEnd != null && (toEnd >= 0 ? t('Ends {time}, in {n} min', { time: end.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }), n: toEnd }) : t('{n} min past its end', { n: -toEnd })), m?.event?.attendees?.length ? t('{n} invited', { n: m.event.attendees.length }) : null, said.length === 1 ? t('{n} line', { n: said.length }) : t('{n} lines', { n: said.length }), notes ? (notes === 1 ? t('{n} note', { n: notes }) : t('{n} notes', { n: notes })) : null, shots ? (shots === 1 ? t('{n} picture', { n: shots }) : t('{n} pictures', { n: shots })) : null].filter(Boolean).join(' · ')}
            </p>
            <div className="fc-acts">
              {r.callEnded && <button type="button" className="btn small" disabled={busy} onClick={() => act(() => api(`/meetings/${r.id}/keep`, { method: 'POST' }))}>{t('Keep recording')}</button>}
              {!r.callEnded && (paused
                ? <button type="button" className="btn small" onClick={() => op('resume')}><Icon name="mic" size={12} /> {t('Resume')}</button>
                : <button type="button" className="btn small" onClick={() => op('pause')}><Icon name="pause" size={12} /> {t('Pause')}</button>)}
              <button type="button" className="btn small" onClick={() => op('section')} title={t('Start the next part of the meeting here, like a lap. The transcript, your notes and the summary get a heading for each part.')}><Icon name="flag" size={12} /> {t('New section')}</button>
              <button type="button" className={`btn small${m?.assist ? ' on' : ''}`} aria-pressed={!!m?.assist} onClick={() => act(() => setAssist(r.id, !m?.assist))} title={m?.assist ? t('AI Assist is on: it suggests what to ask or check next. Click to turn it off') : t('Turn on AI Assist: while it records, it suggests what to ask or check next, from what\'s said and the files')}><Icon name="bulb" size={12} /> {t('Assist')}</button>
              <button type="button" className="btn small danger-soft" onClick={() => op('stop')}><Icon name="stop" size={12} /> {t('Stop')}</button>
              {here && (screen
                ? <>
                  <button type="button" className="btn small" onClick={() => chan.current?.postMessage({ type: 'op', op: 'capture' })} title={t("Keep what's on {name} now", { name: screen.label })}><Icon name="camera" size={12} /> {t('Capture')}{screen.kept ? ` · ${screen.kept}` : ''}</button>
                  <button type="button" className="btn small" onClick={() => chan.current?.postMessage({ type: 'op', op: 'unwatch' })} title={t('Watching {name}. Click to stop.', { name: screen.label })}><Icon name="eye-off" size={12} /> {t('Stop watching the screen')}</button>
                </>
                : live.canWatch && app().floatWatch && <button type="button" className="btn small" onClick={() => app().floatWatch()} title={t('Pick the window or screen being shared. A picture is kept each time it changes.')}><Icon name="screen" size={12} /> {t('Watch screen')}</button>)}
            </div>
            <QuickNote id={r.id} className="fc-note" />
            <div className="fc-links">
              <button type="button" className="link-btn" onClick={() => app().floatOpen?.({ meeting: r.id })}>{t('Open the meeting')}</button>
              <button type="button" className="link-btn" onClick={() => app().floatOpen?.({ meetings: true })}>{t('All meetings')}</button>
            </div>
          </div>
        )}
      </>
    )
  } else if (c?.prompt) {
    const what = c.prompt.browser ? t('A call in {app} started', { app: c.prompt.app }) : t('{app} call started', { app: c.prompt.app })
    body = (
      <>
        <div className="fc-head">{grip}<Icon name="mic" size={14} className="fc-accent" /><b className="fc-title">{what}</b>{hide}</div>
        <p className="fc-line muted">{ev ? <>Take notes for <b>{ev.title}</b>?</> : t('Take notes?')} {t('Your mic and the call, transcribed as you go.')}</p>
        <div className="fc-acts">
          <button type="button" className="btn small primary" disabled={busy} onClick={() => act(() => app().floatStart?.({ app: c.prompt.app }))}><Icon name="mic" size={12} /> {t('Take notes')}</button>
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => act(() => api('/calls/dismiss', { method: 'POST' }))}>{t('Not now')}</button>
        </div>
      </>
    )
  } else {
    // What needs you, while the card stays up between meetings.
    const agents = (fleet?.agents || []).filter((a) => !a.cloudOnly)
    const needs = agents.filter((a) => a.status === 'blocked')
    const working = agents.filter((a) => a.status === 'working').length
    body = (
      <>
        <div className="fc-head">{grip}<img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="16" height="16" /><b className="fc-title">Bridge AI</b>{hide}</div>
        <p className="fc-line muted">{needs.length ? (needs.length === 1 ? t('{n} needs you', { n: needs.length }) : t('{n} need you', { n: needs.length })) : t('Nothing needs you')}{working ? ` · ${t('{n} working', { n: working })}` : ''}</p>
        {needs.slice(0, 3).map((a) => (
          <button type="button" key={a.paneId} className="fc-agent" onClick={() => app().floatOpen?.({ paneId: a.paneId })}>
            <StatusDot status={a.status} size={8} /><span>{a.chief ? t('Chief of staff') : a.title || a.tab || a.workspace}</span>
          </button>
        ))}
        <div className="fc-links"><button type="button" className="link-btn" onClick={() => app().floatOpen?.({ meetings: true })}>{t('Meetings')}</button></div>
      </>
    )
  }
  return (
    <div className="float-root">
      <div ref={card} className={`float-card${r && !open ? ' slim' : ''}${up ? ' up' : ''}${dragging ? ' dragging' : ''}`} onMouseEnter={enter} onMouseLeave={out} onFocus={enter} onBlur={out}
        onPointerDown={down} onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
        {body}
        {err && <p className="error-text small fc-line">{err}</p>}
      </div>
    </div>
  )
}
