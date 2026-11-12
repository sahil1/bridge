import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from '../Icon.jsx'
import { api, usePoll, useFleet } from '../../api.js'
import { MEETINGS_CHANNEL, clock, useCallEvent, QuickNote, endedWords } from './recording.jsx'
import { KIND, setAssist, markAssist } from './assist.jsx'
import { boardWords } from './board.jsx'
import { PrepGlance } from './prep.jsx'
import { useScreenAccess, useAllowCall, allowSteps, noteOpened } from './allowcall.jsx'
import { joined } from '../Agenda.jsx'
import { t, locale, tn } from '../../i18n/index.js'
import './meetings.css'

// The floating card (desktop app, ?float=1): a small window over your other windows. While a
// meeting records it's a slim bar (how long, what, Pause or Resume), and opens on hover: when it
// ends, the last things said, how loud you and the call are and who's talked how much, a quick
// note, Suggest what to ask and watching the shared screen (Capture), New section and Stop, and the
// way back to the meeting or to every meeting. The bar is the same open or closed, so the button
// under the pointer as it opens stays where it was. Pinned, it stays open. Set to open on a click
// instead (Settings › Meetings), a click on the bar opens and closes it. On a Mac it can move to the
// menu bar for the meeting, out of the way of a screen you share. When a call starts: Take notes.
// When it ends: Stop or keep recording. Otherwise (Settings › Meetings › Always): what needs you.
// With AI Assist's live board on (a beta feature), a line says what's on it and opens it.
// With AI Assist's Suggest what to ask on, its newest suggestion shows under the bar, open or not,
// since you're looking at the call: ✓ puts it in your notes, ✕ dismisses it. Ten minutes before a
// meeting with other people: Join, and what to go in with at a glance (prep.jsx's PrepGlance), with
// a small menu by its ×: remind me again when it's about to start, hide it until the next meeting,
// or turn these reminders off (Settings › Meetings › Remind me before meetings turns them back on).
// While you share or record your screen on a Mac it isn't there: the meeting being recorded's card goes
// to the menu bar by itself and comes back as it was after, and any other waits (desktop/floatshare.js).
// Drag it from anywhere that isn't a button. Resize it by its edges and corners, as any window: its
// width for every card, and open while recording its height too, which shows more of what's been
// said; double-click an edge for its usual size. Kept on this computer.
// The recording itself is in the main window; this one asks it over a BroadcastChannel, and asks
// the desktop app (preload) to start notes for a call, to open things and to fit its size.
const app = () => window.bridgeApp || {}
const PIN = 'cc-float-pin'
const pinned0 = () => { try { return localStorage.getItem(PIN) === '1' } catch { return false } }
// The size you gave it, in the page's pixels: { w, h } (h: open while recording), within the
// desktop app's limits (desktop/floatfit.js).
const SIZE = 'cc-float-size'
const LIMITS = { minW: 260, maxW: 720, minH: 120 }
const size0 = () => { try { const v = JSON.parse(localStorage.getItem(SIZE)); return v && typeof v === 'object' ? v : {} } catch { return {} } }
const keepSize = (v) => { try { if (v.w || v.h) localStorage.setItem(SIZE, JSON.stringify(v)); else localStorage.removeItem(SIZE) } catch { /* no storage */ } }
const GRIP = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }

// Who's talked how much of everything said: your share, in percent (null before anyone has).
function talkShare(lines) {
  let a = 0, b = 0
  for (const l of lines) { const d = Math.max(0, (l.t1 ?? l.t0) - l.t0); if (l.src === 'them') b += d; else a += d }
  return a + b > 0 ? Math.round((a / (a + b)) * 100) : null
}
// A call that's silent while it records: the list to turn Bridge AI on in (the second on System
// Settings' page: Screen Recording, above it, doesn't cover the sound), then Restart Bridge AI, and
// Reset and ask again if it's still quiet after (allowcall.jsx). access: what macOS says (the
// server's); when it lets Bridge AI hear the call, the silence is the call's own, and that's said.
function QuietBanner({ access }) {
  const { data } = useScreenAccess()
  const a = useAllowCall('sound', { recording: true, started: data?.started, access })
  const s = allowSteps('sound', a)
  if (access === 'allowed') return <div className="fc-banner fc-quiet" role="status"><p><b>{t('No sound from the call.')}</b> {t('macOS lets Bridge AI hear it, so nothing has played yet. If people are talking, check the call\'s sound plays on this Mac.')}</p></div>
  return (
    <div className="fc-banner fc-quiet" role="status">
      <p><b>{t('No sound from the call.')}</b> {t('If people are talking, turn on Bridge AI in System Audio Recording Only, the second list under System Settings › Privacy & Security › Screen & System Audio Recording. Screen Recording, above it, doesn\'t cover the sound.')}{s.say}</p>
      <span className="fc-banner-acts">{s.acts}</span>
    </div>
  )
}
// A small menu under a button on the card ({ icon, label, hint, run, cls } or '-'), as a Mac app's:
// closed by a click outside it (not its own button, which toggles it) or Esc.
function FcMenu({ items, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.parentElement?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])
  return (
    <div className="menu fc-menu" ref={ref} role="menu">
      {items.map((it, i) => (it === '-' ? <div key={i} className="menu-sep" role="separator" /> : (
        <button key={it.label} type="button" role="menuitem" className={`menu-item ${it.cls || ''}`} onClick={() => { onClose(); it.run() }}>
          <Icon name={it.icon} size={13} /><span className="fc-menu-label">{it.label}</span>{it.hint && <small className="fc-menu-hint">{it.hint}</small>}
        </button>
      )))}
    </div>
  )
}
const Level = ({ v = 0, label }) => {
  const on = Math.min(5, Math.round(Math.sqrt(v) * 5 * 1.4))
  return <span className="fc-level" role="img" aria-label={t('{label} level', { label })}>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}</span>
}

export default function FloatCard() {
  const { data: c, refresh } = usePoll('/calls', 2000)
  const { fleet } = useFleet()
  const [live, setLive] = useState(null) // { rec, elapsed, you } from the main window
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(pinned0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [opts, setOpts] = useState(null) // a meeting's reminder: its menu open ('menu'), or asking to turn reminders off ('off')
  const chan = useRef(null)
  const card = useRef(null)
  const leave = useRef(null)
  const r = c?.recording
  useEffect(() => { setOpts(null) }, [c?.soon?.id])
  const onHover = c?.floatHover !== false
  // Low on the screen, the desktop app's window grows upward (desktop/floatfit.js), so the rest opens
  // above the bar. In a browser tab the page doesn't move. Set below, once it's known if it's open.
  const upAt = useRef(null)
  const { data: m } = usePoll(r ? `/meetings/${encodeURIComponent(r.id)}` : null, hover || pinned ? 1500 : 4000)
  // ⌘+ and ⌘− in the main window zoom this page too: its window is the wrong size for the card then,
  // without the card changing size, so the page says so again (and how much of the screen it has).
  // While it's resized by an edge, the window follows the pointer and the card fills the window.
  const [zoom, setZoom] = useState(() => app().zoom?.() || 1)
  const [size, setSize] = useState(size0)
  const sizeNow = useRef(size)
  sizeNow.current = size
  const [resizing, setResizing] = useState(null) // the edge being dragged
  const edgeNow = useRef(null)
  useEffect(() => {
    const z = () => {
      setZoom(app().zoom?.() || 1)
      const edge = edgeNow.current
      if (edge) setSize((v) => ({ ...v, ...(/[ew]/.test(edge) ? { w: Math.round(innerWidth - 24) } : {}), ...(/[ns]/.test(edge) ? { h: Math.round(innerHeight - 24) } : {}) }))
    }
    window.addEventListener('resize', z)
    return () => window.removeEventListener('resize', z)
  }, [])
  const canResize = !!app().floatResize
  const grab = (edge) => (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* moves still come while it's over the edge */ }
    clearTimeout(leave.current)
    edgeNow.current = edge
    setResizing(edge)
    app().floatResize(edge)
  }
  const letGo = () => {
    if (!edgeNow.current) return
    edgeNow.current = null
    setResizing(null)
    app().floatResize(null)
    keepSize(sizeNow.current)
    // Let go off the card: it closes as it would have when the pointer left it.
    if (!card.current?.matches(':hover')) out()
  }
  const usualSize = () => { setSize({}); keepSize({}) }
  const ev = useCallEvent(!r && c?.prompt ? c.prompt.at : null, c?.prompt?.app)

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
  // The window fits the card (the desktop app makes it the card's size times its zoom). Open, what's
  // under the bar (a meeting's prep, before it starts) scrolls past what's left of the screen: the screen's height in the page's pixels
  // (its points over the zoom), less the desktop app's 8 points above and below the window, the 12
  // pixels around the card and the rest of the card (its bar, AI Assist's suggestion). A fixed
  // allowance for the rest asked for more than the screen when the suggestion took three lines,
  // and zoomed, and the window was cut off at the bottom. However little room is left, it scrolls
  // rather than run past the screen.
  // A reminder's menu, open over a card shorter than it (its prep still coming): the card at least
  // as tall as the menu reaches, so the window has room for it.
  useLayoutEffect(() => {
    const el = card.current
    const menu = el?.querySelector('.fc-menu')
    if (!el) return
    el.style.minHeight = ''
    if (!menu) return
    const need = Math.ceil(menu.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 10)
    if (need > el.getBoundingClientRect().height) el.style.minHeight = `${need}px`
  }, [opts])
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const fit = () => {
      const more = el.querySelector('.fc-more, .fc-scroll')
      if (more) {
        const rest = el.getBoundingClientRect().height - more.getBoundingClientRect().height
        el.style.setProperty('--fc-more-max', `${Math.max(40, Math.floor(((window.screen?.availHeight || 900) - 16) / zoom - 24 - rest))}px`)
      }
      const b = el.getBoundingClientRect()
      app().floatSize?.(Math.ceil(b.width) + 24, Math.ceil(b.height) + 24, !!upAt.current)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  })
  // Made taller, what's been said shows more lines, the newest at the bottom, in view as they come.
  const saidBox = useRef(null)
  const saidCount = m?.transcript?.length || 0
  useLayoutEffect(() => { const el = saidBox.current; if (el && size.h) el.scrollTop = el.scrollHeight }, [saidCount, size.h, hover])
  // Hidden (the window, or what it shows changed): no longer under the pointer. Set to open on a
  // click, it stays as it was while its window is hidden (gone to the menu bar for a share), and
  // comes back so.
  useEffect(() => { setHover(false) }, [r?.id, c?.prompt?.at])
  const hoverOpens = useRef(onHover)
  hoverOpens.current = onHover
  useEffect(() => {
    const v = () => { if (document.hidden && hoverOpens.current) setHover(false) }
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
    if (e.button !== 0 || e.target.closest('button, input, select, textarea, a, summary, label, .fc-grip, .fc-menu')) return
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
  const out = () => { clearTimeout(leave.current); if (onHover && !drag.current?.moved && !edgeNow.current) leave.current = setTimeout(() => { if (!writing()) setHover(false) }, 500) }
  // macOS lets Bridge AI hear a call only once it's allowed (System Audio Recording): until then a
  // call's sound is silence. Opens the settings page to allow it.
  const allowCall = () => api('/fix/settings', { method: 'POST', body: { pane: 'audio' } }).then(() => noteOpened('sound'), (e) => setErr(e.message))

  const act = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false); refresh() } }
  // Pause, Resume, Stop and New section go to the main window when it's the one recording (it has the mic);
  // a meeting recorded somewhere else (a browser tab) is paused or stopped on the server, and that
  // tab's mic stops when it sees so.
  const op = (o) => (live?.rec?.id && live.rec.id === r?.id ? chan.current?.postMessage({ type: 'op', op: o }) : act(() => api(`/meetings/${encodeURIComponent(r.id)}/${o}`, { method: 'POST' })))
  const hide = <button type="button" className="fc-x" onClick={() => app().floatHide?.()} aria-label={t('Hide the card')} title={t('Hide until the next call')}><Icon name="x" size={12} /></button>
  // On a Mac the card can go to the menu bar for the meeting, out of the way of a screen you share.
  const toBar = app().platform === 'darwin' && !!app().floatHide

  let body
  let open = true
  if (r) {
    const paused = live?.rec?.id === r.id ? live.rec.paused : r.status === 'paused'
    const secs = live?.rec?.id === r.id ? live.elapsed : (Date.now() - new Date(r.startedAt).getTime()) / 1000
    open = hover || (onHover && pinned) || !!r.callEnded
    const tall = open && !!size.h
    const said = (m?.transcript || []).filter((l) => l.text)
    const recent = said.slice(tall ? -40 : -3)
    const left = r.stopsAt ? Math.max(0, Math.round((new Date(r.stopsAt).getTime() - Date.now()) / 1000)) : null
    const share = talkShare(said)
    const here = live?.rec?.id === r.id
    const screen = here ? live.screen : null
    const end = m?.event?.end ? new Date(m.event.end) : null
    const toEnd = end ? Math.round((end.getTime() - Date.now()) / 60000) : null
    const part = m?.sections?.length > 1 ? m.sections[m.sections.length - 1].title : null
    const tip = m?.assist ? [...(m.assistItems || [])].reverse().find((x) => x.state === 'new') : null
    const info = [part, toEnd != null && (toEnd >= 0 ? t('Ends {time}, in {n} min', { time: end.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }), n: toEnd }) : t('{n} min past its end', { n: -toEnd })), m?.event?.attendees?.length ? t('{n} invited', { n: m.event.attendees.length }) : null].filter(Boolean).join(' · ')
    const call = m?.call === 'on'
    body = (
      <>
        {/* The bar: the same open or not, so what's under the pointer as it opens stays put. */}
        <div className={`fc-head${onHover ? '' : ' fc-click'}`}>
          <span className={`fc-dot${paused ? ' paused' : ''}`}><span className="rec-dot" aria-hidden="true" /></span>
          <b className="fc-time">{clock(secs)}</b>
          <span className="fc-title" title={r.title}>{r.title}</span>
          {r.callQuiet && !paused && <button type="button" className="fc-x fc-warn" onClick={r.callAccess === 'allowed' ? () => setHover(true) : allowCall} aria-label={t('No sound from the call')} title={r.callAccess === 'allowed' ? t('No sound from the call') : t('No sound from the call. If people are talking, turn on Bridge AI in System Audio Recording Only, the second list on that page of System Settings: click to open it')}><Icon name="alert" size={13} /></button>}
          {!r.callEnded && (paused
            ? <button type="button" className="fc-x fc-play" onClick={() => op('resume')} aria-label={t('Resume')} title={t('Resume recording')}><Icon name="play" size={13} /></button>
            : <button type="button" className="fc-x" onClick={() => op('pause')} aria-label={t('Pause')} title={t('Pause recording')}><Icon name="pause" size={13} /></button>)}
          {!onHover && <button type="button" className="fc-x" onClick={() => setHover((v) => !v)} aria-expanded={open} aria-label={open ? t('Show less') : t('Show more')} title={open ? t('Show less') : t('Show more')}><Icon name={open ? 'up' : 'down'} size={13} /></button>}
        </div>
        {tip && (
          <div className={`fc-tip k-${tip.kind}`} role="status">
            <span className="fc-tip-kind"><Icon name="wand" size={11} /> {t(KIND[tip.kind] || KIND.idea)}</span>
            <span className="fc-tip-text" title={tip.why || ''}>{tip.text}</span>
            <span className="fc-tip-acts">
              <button type="button" className="fc-x" onClick={() => act(() => markAssist(r.id, tip.id, 'kept'))} aria-label={t('Add to my notes')} title={t('Add to my notes')}><Icon name="check" size={12} /></button>
              <button type="button" className="fc-x" onClick={() => act(() => markAssist(r.id, tip.id, 'dismissed'))} aria-label={t('Dismiss')} title={t('Dismiss')}><Icon name="x" size={12} /></button>
            </span>
          </div>
        )}
        {open && (
          <div className="fc-more">
            {r.callEnded && (
              <div className="fc-banner" role="status">
                <p><b>{endedWords(r)}</b> {left != null ? t('Stopping in {time}.', { time: clock(left) }) : t('Stop recording?')}</p>
                <button type="button" className="btn small" disabled={busy} onClick={() => act(() => api(`/meetings/${r.id}/keep`, { method: 'POST' }))}>{t('Keep recording')}</button>
              </div>
            )}
            {r.callQuiet && !paused && <QuietBanner access={r.callAccess} />}
            <div className="fc-live">
              {info && <p className="fc-info" title={info}>{info}</p>}
              <div className="fc-said" ref={saidBox}>
                {recent.length ? recent.map((l) => <p key={`${l.src}:${l.t0}`} className={`fc-said-line src-${l.src}`}><b>{l.name || (l.me ? m?.me || t('You') : l.voice ? t('Speaker {n}', { n: l.voice }) : l.src === 'them' ? t('Them') : m?.me || t('You'))}</b> {l.text}</p>) : !m?.partial && <p className="fc-said-none">{paused ? t('Paused.') : t('Listening…')}</p>}
                {/* Live words: what someone is still saying, before its line is in. */}
                {!paused && ['you', 'them'].filter((src) => m?.partial?.[src]?.text).map((src) => <p key={`so-far-${src}`} className={`fc-said-line src-${src} so-far`}><b>{src === 'them' ? t('Them') : m?.me || t('You')}</b> {m.partial[src].cut ? '… ' : ''}{m.partial[src].text}</p>)}
              </div>
              {/* How loud you and the call are now, and who's talked how much of everything said. */}
              <div className="fc-talk" title={t("Who's talked, of everything said so far")}>
                <span className="fc-who you"><Level v={here ? live.you : m?.levels?.you} label={t('You')} />{share != null && call ? t('You {n}%', { n: share }) : t('You')}</span>
                {call
                  ? <><i className={`fc-share${share == null ? ' none' : ''}`} style={{ '--you': `${share ?? 50}%` }} /><span className="fc-who them">{share != null ? t('Call {n}%', { n: 100 - share }) : t('Call')}<Level v={m?.levels?.them} label={t('Call')} /></span></>
                  : <small className="fc-mic-only">{t('Your mic only')}</small>}
              </div>
            </div>
            <QuickNote id={r.id} className="fc-note" />
            <div className="fc-modes">
              <button type="button" className={`fc-chip fc-ai${m?.assist ? ' on' : ''}`} aria-pressed={!!m?.assist} onClick={() => act(() => setAssist(r.id, !m?.assist))} title={m?.assist ? t('AI Assist is suggesting what to ask or check next. Click to stop') : t('AI Assist: while it records, suggest what to ask or check next, from what\'s said and the files')}><Icon name="wand" size={12} /> {t('Suggest what to ask')}</button>
              {here && (screen
                ? <>
                  <button type="button" className="fc-chip on" aria-pressed="true" onClick={() => chan.current?.postMessage({ type: 'op', op: 'unwatch' })} title={t('Watching {name}. Click to stop.', { name: screen.label })}><Icon name="screen" size={12} /> {t('Watching')}</button>
                  <button type="button" className="fc-chip" onClick={() => chan.current?.postMessage({ type: 'op', op: 'capture' })} title={t("Keep what's on {name} now", { name: screen.label })}><Icon name="camera" size={12} /> {t('Capture')}{screen.kept ? ` · ${screen.kept}` : ''}</button>
                  {/* Sharing a screen: the card out of its way, said in words, not only the small button below. */}
                  {toBar && <button type="button" className="fc-chip" onClick={() => app().floatHide()} title={t('Move to the menu bar, out of the way of a screen you share')}><Icon name="minimize" size={12} /> {t('To the menu bar')}</button>}
                </>
                : live.canWatch && app().floatWatch && <button type="button" className="fc-chip" onClick={() => app().floatWatch()} title={t('Pick the window or screen being shared. A picture is kept each time it changes.')}><Icon name="screen" size={12} /> {t('Watch screen')}</button>)}
            </div>
            {/* AI Assist's live board (a beta feature): how much is on it, a click from opening it. */}
            {m?.liveBoard?.id && <button type="button" className="fc-board" onClick={() => app().floatOpen?.({ meeting: r.id, board: m.liveBoard.id })} title={t('Open "{name}", the whiteboard of this meeting', { name: m.liveBoard.id })}><Icon name="shapes" size={12} /><span>{boardWords(m.liveBoard) ? t('Board: {what}', { what: boardWords(m.liveBoard) }) : t('Board')}</span></button>}
            <div className="fc-acts">
              <button type="button" className="btn small" onClick={() => op('section')} title={t('Start the next part of the meeting here, like a lap. The transcript, your notes and the summary get a heading for each part.')}><Icon name="flag" size={12} /> {t('New section')}</button>
              <span className="fc-grow" />
              <button type="button" className="btn small fc-stop" onClick={() => op('stop')}><Icon name="stop" size={12} /> {t('Stop')}</button>
            </div>
            <div className="fc-links">
              <button type="button" className="fc-link" onClick={() => app().floatOpen?.({ meeting: r.id })}>{t('Open the meeting')}</button>
              <button type="button" className="fc-link" onClick={() => app().floatOpen?.({ meetings: true })}>{t('All meetings')}</button>
              <span className="fc-grow" />
              {onHover && <button type="button" className={`fc-x${pinned ? ' on' : ''}`} onClick={pin} aria-pressed={pinned} aria-label={t('Pin it open')} title={pinned ? t('Pinned open. Click to open it on hover only') : t('Pin it open')}><Icon name="pin" size={12} /></button>}
              {toBar && <button type="button" className="fc-x" onClick={() => app().floatHide()} aria-label={t('Move to the menu bar')} title={t('Move to the menu bar, out of the way of a screen you share')}><Icon name="minimize" size={12} /></button>}
            </div>
          </div>
        )}
      </>
    )
  } else if (c?.prompt) {
    const what = c.prompt.browser ? t('A call in {app} started', { app: c.prompt.app }) : t('{app} call started', { app: c.prompt.app })
    body = (
      <>
        <div className="fc-head fc-ask">
          <span className="fc-badge"><Icon name="mic" size={15} /></span>
          <span className="fc-ask-text">
            <b className="fc-title">{what}</b>
            <span className="fc-sub" title={ev?.title || undefined}>{ev ? tn('Take notes for {event}?', { event: <b>{ev.title}</b> }) : `${t('Take notes?')} ${t('Your mic and the call, transcribed as you go.')}`}</span>
          </span>
          {hide}
        </div>
        <div className="fc-acts fc-end">
          {/* Not now always works, even while Take notes is still starting. */}
          <button type="button" className="btn small" onClick={() => { setErr(null); api('/calls/dismiss', { method: 'POST' }).catch((e) => setErr(e.message)).finally(refresh) }}>{t('Not now')}</button>
          <button type="button" className="btn small primary" disabled={busy} onClick={() => act(() => app().floatStart?.({ app: c.prompt.app }))} title={t('Your mic and the call, transcribed as you go.')}><Icon name="mic" size={12} /> {busy ? t('Starting…') : t('Take notes')}</button>
        </div>
      </>
    )
  } else if (c?.soon) {
    const e = c.soon
    const left = Date.parse(e.start) - Date.now()
    const mins = Math.max(1, Math.round(left / 60000))
    const ago = Math.max(1, Math.round(-left / 60000))
    const clockAt = (d) => new Date(d).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
    const at = clockAt(e.start)
    const day = new Date(e.start).toLocaleDateString('en-CA')
    // Put off until it's about to start, it can come back as it starts, or just after.
    const when = left > 30e3 ? [t('In {n} min · {time}', { n: mins, time: at }), mins === 1 ? t('Starts in 1 min, at {time}', { time: at }) : t('Starts in {n} min, at {time}', { n: mins, time: at })]
      : left > -60e3 ? [t('Now · {time}', { time: at }), t('Starts now, at {time}', { time: at })]
        : [t('Started {n} min ago · {time}', { n: ago, time: at }), t('Started {n} min ago, at {time}', { n: ago, time: at })]
    // Its three choices, in a small menu by its ×: remind me again when it's about to start (a minute
    // before, or at its start once that minute has begun: the server decides), hide it until the
    // next meeting (its ×), and turn these reminders off, saying first where they're turned back on.
    const snooze = () => act(async () => { await api('/calls/snooze', { method: 'POST', body: { id: e.id } }); await app().floatLook?.() })
    const stop = () => act(async () => { await api('/settings', { method: 'PATCH', body: { meetings: { remind: false } } }); setOpts(null); await app().floatLook?.() })
    const items = [
      left > 0 && { icon: 'clock', label: left > 60e3 ? t('Remind me 1 min before') : t('Remind me when it starts'), hint: clockAt(left > 60e3 ? Date.parse(e.start) - 60e3 : e.start), run: snooze, cls: 'fc-later' },
      app().floatHide && { icon: 'x', label: t('Hide until the next meeting'), run: () => app().floatHide(), cls: 'fc-hide' },
      '-',
      { icon: 'bell-off', label: t('Turn off meeting reminders…'), run: () => setOpts('off'), cls: 'fc-off' },
    ].filter(Boolean)
    body = (
      <>
        <div className="fc-head fc-ask">
          <span className="fc-badge"><Icon name="calendar" size={15} /></span>
          <span className="fc-ask-text">
            <b className="fc-title" title={e.title}>{e.title}</b>
            <span className="fc-sub-row">
              <span className="fc-sub" title={when[1]}>{when[0]}</span>
              {e.join && <a className="btn small primary fc-join" href={e.join} target="_blank" rel="noreferrer" onClick={() => joined(e)}><Icon name="video" size={12} /> {t('Join')}</a>}
            </span>
          </span>
          <span className="menu-anchor fc-opts-at">
            <button type="button" className={`fc-x fc-opts${opts === 'menu' ? ' on' : ''}`} onClick={() => setOpts((v) => (v === 'menu' ? null : 'menu'))} aria-haspopup="menu" aria-expanded={opts === 'menu'} aria-label={t('Reminder options')} title={t('Remind me later, hide it, or turn off these reminders')}><Icon name="more" size={13} /></button>
            {opts === 'menu' && <FcMenu items={items} onClose={() => setOpts(null)} />}
          </span>
          <button type="button" className="fc-x" onClick={() => app().floatHide?.()} aria-label={t('Hide the card')} title={t('Hide until the next meeting')}><Icon name="x" size={12} /></button>
        </div>
        {opts === 'off' && (
          <div className="fc-banner fc-confirm" role="alertdialog" aria-label={t('Turn off meeting reminders?')}>
            <p><b>{t('Turn off meeting reminders?')}</b> {t("The card won't show before your meetings. Turn them back on in Settings › Meetings › Remind me before meetings.")}</p>
            <span className="fc-banner-acts">
              <button type="button" className="btn small" onClick={() => setOpts(null)}>{t('Cancel')}</button>
              <button type="button" className="btn small primary" disabled={busy} onClick={stop}><Icon name="bell-off" size={12} /> {t('Turn off')}</button>
            </span>
          </div>
        )}
        <div className="fc-scroll"><PrepGlance e={e} onOpenEvent={app().floatOpen ? () => app().floatOpen({ event: { date: day, id: e.id } }) : null} /></div>
      </>
    )
  } else {
    // What needs you, while the card stays up between meetings.
    const agents = (fleet?.agents || []).filter((a) => !a.cloudOnly)
    const needs = agents.filter((a) => a.status === 'blocked')
    const working = agents.filter((a) => a.status === 'working').length
    body = (
      <>
        <div className="fc-head fc-ask">
          <span className="fc-badge fc-mark"><img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="18" height="18" /></span>
          <span className="fc-ask-text">
            <b className="fc-title">Bridge AI</b>
            <span className="fc-sub">{needs.length ? (needs.length === 1 ? t('{n} needs you', { n: needs.length }) : t('{n} need you', { n: needs.length })) : t('Nothing needs you')}{working ? ` · ${t('{n} working', { n: working })}` : ''}</span>
          </span>
          {hide}
        </div>
        {needs.length > 0 && (
          <div className="fc-agents">
            {needs.slice(0, 3).map((a) => (
              <button type="button" key={a.paneId} className="fc-agent" onClick={() => app().floatOpen?.({ paneId: a.paneId })}>
                <StatusDot status={a.status} size={8} /><span>{a.chief ? t('Chief of Staff') : a.title || a.tab || a.workspace}</span><Icon name="chevron" size={11} />
              </button>
            ))}
          </div>
        )}
        <div className="fc-links"><button type="button" className="fc-link" onClick={() => app().floatOpen?.({ meetings: true })}>{t('Meetings')}</button></div>
      </>
    )
  }
  // Which way it opens goes by where its bar is, and an open meeting card keeps it: by the window's
  // middle, a card opened taller than half the screen flipped (the rest jumped above the bar) and
  // the window went to the other end of the screen. It's decided again once it's closed (moved
  // while open, say).
  if (!app().floatSize) upAt.current = false
  else if (!(r && open) || upAt.current == null) {
    const head = card.current?.querySelector('.fc-head')?.getBoundingClientRect()
    const bar = window.screenY + (head ? (head.top + head.height / 2) * zoom : window.outerHeight / 2)
    upAt.current = bar > (window.screen.availTop || 0) + window.screen.availHeight / 2
  }
  const up = upAt.current
  // Its width, and open while recording its height, as you resized it (no taller than the screen).
  const tallToo = !!(r && open)
  const w = size.w ? Math.max(LIMITS.minW, Math.min(LIMITS.maxW, size.w)) : null
  const h = tallToo && size.h ? Math.max(LIMITS.minH, Math.min(Math.floor(((window.screen?.availHeight || 900) - 16) / zoom - 24), size.h)) : null
  return (
    <div className="float-root">
      <div ref={card} className={`float-card${r && !open ? ' slim' : ''}${up ? ' up' : ''}${dragging ? ' dragging' : ''}${h ? ' sized' : ''}${resizing ? ' resizing' : ''}`} onMouseEnter={enter} onMouseLeave={out} onFocus={enter} onBlur={out}
        style={{ ...(w ? { '--fc-w': `${w}px` } : {}), ...(h ? { '--fc-h': `${h}px` } : {}), ...(resizing ? { cursor: GRIP[resizing] } : {}) }}
        onPointerDown={down} onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
        {body}
        {err && <p className="error-text small fc-line">{err}</p>}
        {canResize && ['e', 'w', ...(tallToo ? ['n', 's', 'ne', 'nw', 'se', 'sw'] : [])].map((g) => (
          <span key={g} className={`fc-grip ${g}`} aria-hidden="true" title={t('Drag to resize. Double-click for its usual size.')}
            onPointerDown={grab(g)} onPointerUp={letGo} onLostPointerCapture={letGo} onDoubleClick={usualSize} />
        ))}
      </div>
    </div>
  )
}
