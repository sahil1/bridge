import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, BASE, onThisComputer, refetch } from '../../api.js'
import { record, microphone } from './recorder.js'
import { micRefused, micBlocked } from '../../audio/pcm.js'
import { watch as watchShare, sendPicture, sendGlance } from './screen.js'
import { t, locale } from '../../i18n/index.js'
import './meetings.css'

// Meeting notes: Start recording, write your own notes beside the live transcript if you like,
// Stop. The notes come back as a summary with decisions and action items, written by any model,
// which you can ask questions of, hand to the chief of staff, or save as Markdown.
//
// The recording lives here, above the views, so it keeps going while you look at anything else;
// the top bar shows it as a small pill (RecordingPill).

const Ctx = createContext(null)
export const useMeetings = () => useContext(Ctx)
export const openMeeting = (id) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id } }))
export const openMeetings = () => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } }))
// A thought added to a meeting's notes while it records, at the meeting's time ("- [12:04] ...").
export const quickNote = (id, text) => api(`/meetings/${encodeURIComponent(id)}/note`, { method: 'POST', body: { text } })
// The next part of a meeting that's recording (a lap): a heading in its transcript, notes and summary.
export const newSection = (id, title) => api(`/meetings/${encodeURIComponent(id)}/section`, { method: 'POST', body: { title } })
// The floating card (desktop app) and this window talk over this channel: the recording's state
// out, Pause, Resume, Stop, New section and Capture in. Taking notes for a call comes as a 'bridge-meeting-start'
// event, watching a screen from the card as 'bridge-watch-screen', and Pause, Stop and the rest from
// the menu bar as 'bridge-meeting-op' (the desktop app sends all three).
export const MEETINGS_CHANNEL = 'bridge-meetings'
// Calls are noticed on the computer the server runs on: only a window there offers to record one.
const here = onThisComputer
const when = () => new Date().toLocaleString(locale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })
// A calendar event on now (or starting within ten minutes), to name a call's notes after. With
// two at once, the one under way and online, on the call's app (app: Teams, Zoom...) when that's
// known, the nearer start breaking a tie.
export async function eventNow(app) {
  const d = await api('/calendar').catch(() => null)
  const now = Date.now()
  const on = (d?.events || d?.today || []).filter((e) => e.start && !e.allDay && !e.canceled && new Date(e.start).getTime() - now < 10 * 60_000 && (!e.end || new Date(e.end).getTime() > now))
  const word = String(app || '').split(/\s+/)[0].toLowerCase()
  const score = (e) => (new Date(e.start).getTime() <= now ? 2 : 0) + (e.online ? 1 : 0) + (word && `${e.join || ''} ${e.location || ''}`.toLowerCase().includes(word) ? 2 : 0) - Math.abs(new Date(e.start).getTime() - now) / 3_600_000
  return on.sort((a, b) => score(b) - score(a))[0] || null
}

export function MeetingsProvider({ children }) {
  const [rec, setRec] = useState(null) // { id, title, startedAt, paused, call, trouble, pausedFor, section }
  // Switching machines would stop it: the device menu opens another window instead (Machines.jsx).
  useEffect(() => { document.documentElement.dataset.recording = rec ? '1' : '' }, [rec])
  const [levels, setLevels] = useState({})
  const [screen, setScreen] = useState(null) // { label, kept } while a screen is watched (screen.js)
  const share = useRef(null)
  const handle = useRef(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!rec) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [rec])
  // Calls on this computer and the recording as the server sees it (server calls.js).
  const { data: calls, refresh: refreshCalls } = usePoll(here() ? '/calls' : null, 2500)
  const callsAt = useRef(0)
  useEffect(() => { callsAt.current = Date.now() }, [calls])
  // A meeting in the room or on a call (one on this computer): how the mic is set (microphone()).
  // Not known here (a phone, or the computer not answering yet): the room.
  const inRoom = () => !(calls?.calls?.length)
  const room = useRef(true)

  // event: the calendar event it's for. Asks for the mic first: no meeting is made until you can
  // record. The call's sound is a bonus: without it, the mic still hears the room.
  const start = async ({ title, event, kind } = {}) => {
    if (handle.current) { openMeeting(rec.id); return rec.id }
    // The demo has no computer behind it: say so before asking for the mic.
    if (import.meta.env.MODE === 'demo') throw new Error(t('Recording a meeting needs Bridge AI on your computer.'))
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.bridgeNative || window.bridgeAndroid || matchMedia('(pointer: coarse)').matches
      ? t('Recording from your phone needs a secure connection: open your computer through your relay (Settings › Devices on the computer), not its plain Tailscale address.')
      : t('Recording needs the desktop app, or this page over HTTPS.'))
    let mic
    room.current = inRoom()
    try { mic = await microphone(undefined, { room: room.current }) } catch (e) {
      // In the desktop app on a Mac: the way to allow it (or reset it) there (Meetings.jsx shows it).
      const fix = await micRefused(e)
      if (fix) throw Object.assign(new Error(t('macOS is blocking the microphone for Bridge AI.')), { code: 'mic', stale: fix.stale })
      throw new Error(e.name === 'NotAllowedError' ? micBlocked() : e.message)
    }
    // The call's sound is recorded by the server (on a Mac); this page records your mic.
    const m = await api('/meetings', { method: 'POST', body: { title: title || `Meeting, ${when()}`, event, kind } })
    refetch('/meetings') // its name on its tab and in the sidebar now, not at the next look
    handle.current = await record(m.id, { you: mic }, {
      onLevel: setLevels,
      onTrouble: (t) => setRec((r) => (r ? { ...r, trouble: t } : r)),
      reopen: { you: () => microphone(undefined, { room: room.current }) },
      onGap: (ms) => setRec((r) => (r ? { ...r, missed: (r.missed || 0) + ms, missedAt: Date.now() } : r)),
    })
    setRec({ id: m.id, title: m.title, startedAt: Date.now(), paused: false, pausedMs: 0, call: m.call === 'on' ? 'on' : m.callWhy || null })
    openMeeting(m.id)
    return m.id
  }
  const changedAt = useRef(0) // when Pause or Resume was last pressed here
  const pauseHere = () => { handle.current.pause(); setRec((r) => ({ ...r, paused: true, pausedAt: Date.now() })) }
  const resumeHere = () => { handle.current.resume(); setRec((r) => ({ ...r, paused: false, pausedMs: r.pausedMs + (Date.now() - r.pausedAt) })) }
  const pause = async () => {
    if (!handle.current) return
    changedAt.current = Date.now()
    pauseHere()
    await api(`/meetings/${rec.id}/pause`, { method: 'POST' }).catch(() => {})
  }
  const resume = async () => {
    if (!handle.current) return
    changedAt.current = Date.now()
    await api(`/meetings/${rec.id}/resume`, { method: 'POST' }).catch(() => {})
    resumeHere()
  }
  // Someone on the call talking (the server hears the call): a look at the watched screen as each of
  // them starts, and every 15 s while one goes on, for whose name it shows. The server keeps the
  // text, not the picture; stop: it wants no more (it can't read pictures, or naming is off).
  const talk = useRef({ at: null, fresh: false, last: 0, off: false })
  useEffect(() => {
    const at = calls?.recording?.talking ?? null
    if (at != null && at !== talk.current.at) talk.current.fresh = true
    talk.current.at = at
  }, [calls])
  const glance = () => {
    const k = talk.current
    const now = Date.now()
    if (k.off || k.at == null || now - k.last < 4000 || !(k.fresh || now - k.last > 15000)) return false
    k.last = now
    k.fresh = false
    return true
  }
  // Watch a screen (the window someone shares slides in): a picture each time it changes, and
  // Capture for one now. Asks which screen or window, in the browser's or macOS's own picker.
  const watchScreen = async () => {
    if (!handle.current) throw new Error(t('Start recording first'))
    if (share.current) return
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error(t('Watching a screen needs the desktop app, or a browser that can share one'))
    let stream
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 2, max: 5 } }, audio: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include' }) } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') return // not now, or no to the picker
      throw new Error(e.message || t("Couldn't watch that screen"))
    }
    const mid = rec.id
    talk.current.off = false
    const w = watchShare(stream, {
      // Counted when kept: the server leaves out a change whose words are the last picture's.
      onPicture: async (blob, kind) => { const r = await sendPicture(mid, blob, { kind, source: w.label }); if (r?.kept !== false) setScreen((x) => (x ? { ...x, kept: x.kept + 1 } : x)) },
      glance,
      onGlance: (blob) => sendGlance(mid, blob).then((r) => { if (r.stop) talk.current.off = true }, () => {}),
      onEnd: () => { share.current = null; setScreen(null); window.bridgeApp?.watching?.(false) },
    })
    share.current = w
    setScreen({ label: w.label, kept: 0 })
    window.bridgeApp?.watching?.(true)
  }
  const capture = async () => {
    if (!share.current) throw new Error(t('Watch a screen first'))
    await share.current.now()
  }
  const unwatch = () => share.current?.stop()
  const stop = async () => {
    if (!handle.current) return
    share.current?.stop()
    const id = rec.id
    const h = handle.current
    handle.current = null
    setRec(null)
    setLevels({})
    await h.stop()
    await api(`/meetings/${id}/stop`, { method: 'POST' }).catch(() => {})
    refetch('/meetings') // the lists show it stopped now (its menu offers Archive and Delete again)
    refreshCalls()
  }
  // Notes for a call that just started: named after the calendar event on now, if there is one.
  const startForCall = async (app) => {
    const event = await eventNow(app)
    return start({ title: event?.title || `${app} call, ${when()}`, event })
  }
  // Recording now, from the sidebar: for the calendar event on now (its name and people), if there
  // is one.
  const startNow = async () => {
    const event = await eventNow()
    return start(event ? { title: event.title, event } : {})
  }
  // A new section from here (a lap).
  const section = async (title) => {
    if (!rec) throw new Error(t('Start recording first'))
    const r = await newSection(rec.id, title)
    if (r.section) setRec((x) => (x ? { ...x, section: r.section.title } : x))
    return r
  }
  // Stopped somewhere else (by itself after the call ended, or the desktop app's floating card when
  // this is a browser tab): stop the mic here. Paused or resumed there: follow.
  useEffect(() => {
    if (!handle.current || !rec || !calls || callsAt.current - rec.startedAt < 4000) return
    if (calls.recording?.id !== rec.id) { stop(); return }
    const paused = calls.recording.status === 'paused'
    if (paused !== rec.paused && callsAt.current - changedAt.current > 4000) (paused ? pauseHere : resumeHere)()
  }, [calls]) // eslint-disable-line react-hooks/exhaustive-deps
  // A call started on this computer while it records in a room, or ended: the mic set for that.
  useEffect(() => {
    if (!handle.current || !rec || !calls || inRoom() === room.current) return
    room.current = inRoom()
    handle.current.swap('you')
  }, [calls]) // eslint-disable-line react-hooks/exhaustive-deps
  // The floating card: what's recording, and Pause, Resume and Stop from it.
  const fns = useRef(null)
  fns.current = { pause, resume, stop, start, startForCall, section, watchScreen, capture, unwatch, mine: (id) => !!handle.current && rec?.id === id }
  const chan = useRef(null)
  useEffect(() => {
    const ch = new BroadcastChannel(MEETINGS_CHANNEL)
    chan.current = ch
    ch.onmessage = (e) => {
      const d = e.data || {}
      if (d.type === 'op' && handle.current && fns.current[d.op] && ['pause', 'resume', 'stop', 'section', 'capture', 'watchScreen', 'unwatch'].includes(d.op)) Promise.resolve().then(() => fns.current[d.op]()).catch((err) => ch.postMessage({ type: 'error', text: err.message }))
      if (d.type === 'hello') ch.postMessage({ type: 'hello-back' })
    }
    const onStart = (e) => { const d = e.detail || {}; (d.app ? fns.current.startForCall(d.app) : fns.current.start(d)).catch((err) => ch.postMessage({ type: 'error', text: err.message })) }
    const onWatch = () => { fns.current.watchScreen().catch((err) => ch.postMessage({ type: 'error', text: err.message })) }
    // From the menu bar: done here when this window is recording that meeting, otherwise on the
    // server (a browser tab recording it stops its mic when it sees so).
    const onOp = (e) => {
      const { op, id } = e.detail || {}
      const go = op === 'dismiss' ? () => api('/calls/dismiss', { method: 'POST' })
        : !id || !['pause', 'resume', 'stop', 'keep'].includes(op) ? null
        : op !== 'keep' && fns.current.mine(id) ? fns.current[op]
        : () => api(`/meetings/${encodeURIComponent(id)}/${op}`, { method: 'POST' })
      if (go) Promise.resolve().then(go).catch((err) => ch.postMessage({ type: 'error', text: err.message }))
    }
    window.addEventListener('bridge-meeting-start', onStart)
    window.addEventListener('bridge-watch-screen', onWatch)
    window.addEventListener('bridge-meeting-op', onOp)
    return () => { ch.close(); window.removeEventListener('bridge-meeting-start', onStart); window.removeEventListener('bridge-watch-screen', onWatch); window.removeEventListener('bridge-meeting-op', onOp) }
  }, [])
  // In the desktop app, closing the window mid-meeting hides it instead, so the recording goes on.
  // On a phone the screen stays on while it records: locked, the phone stops the mic.
  useEffect(() => {
    window.bridgeApp?.recording?.(!!rec)
    window.bridgeNative?.post?.({ type: 'recording', on: !!rec })
    window.bridgeAndroid?.recording?.(!!rec)
    if (!rec) return
    let lock = null
    // Hidden, the browser lets the lock go; back in front, it's asked for again.
    const hold = () => {
      if (document.hidden) { lock = null; return }
      if (!lock) navigator.wakeLock?.request('screen').then((l) => { lock = l; l.addEventListener('release', () => { if (lock === l) lock = null }) }, () => {})
    }
    hold()
    document.addEventListener('visibilitychange', hold)
    return () => { document.removeEventListener('visibilitychange', hold); lock?.release().catch(() => {}) }
  }, [!!rec]) // eslint-disable-line react-hooks/exhaustive-deps
  // Closing the window mid-meeting: what's been sent is kept, and the meeting is stopped there.
  useEffect(() => {
    const bye = () => { if (handle.current && rec) navigator.sendBeacon?.(`${BASE}/api/meetings/${rec.id}/stop`) }
    window.addEventListener('pagehide', bye)
    return () => window.removeEventListener('pagehide', bye)
  }, [rec])

  const elapsed = rec ? Math.max(0, (rec.paused ? rec.pausedAt : now) - rec.startedAt - rec.pausedMs) / 1000 : 0
  useEffect(() => { chan.current?.postMessage({ type: 'state', rec: rec && { id: rec.id, title: rec.title, paused: rec.paused, section: rec.section || null }, elapsed, you: levels.you || 0, screen, canWatch: !!navigator.mediaDevices?.getDisplayMedia }) }, [rec, elapsed, levels, screen])
  const value = useMemo(() => ({ rec, levels, elapsed, start, startNow, pause, resume, stop, section, calls, refreshCalls, startForCall, screen, watchScreen, capture, unwatch }), [rec, levels, elapsed, calls, screen]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const clock = (s) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const ss = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}` }

// A line to add a thought to the meeting's notes without going to it. Enter adds it.
export function QuickNote({ id, className = '', autoFocus = false, onAdded }) {
  const [text, setText] = useState('')
  const [said, setSaid] = useState(null)
  const add = async (e) => {
    e.preventDefault()
    const note = text.trim()
    if (!note) return
    try { await quickNote(id, note); setText(''); setSaid(t('Added to your notes')); onAdded?.() } catch (err) { setSaid(err.message) }
    setTimeout(() => setSaid(null), 1800)
  }
  return (
    <form className={`quick-note ${className}`} onSubmit={add}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Add a note, Enter to keep it')} aria-label={t('Add a note to this meeting')} autoFocus={autoFocus} />
      {said && <small className="muted" role="status">{said}</small>}
    </form>
  )
}

// In the top bar while recording: how long and what. Click opens the meeting; hover (or focus)
// shows Pause, Stop, New section, a quick note and the way to every meeting. Once clicked, the menu stays shut
// until the mouse has left: the meeting page has the same buttons, and the menu would sit over them.
export function RecordingPill() {
  const m = useMeetings()
  const [open, setOpen] = useState(false)
  const timer = useRef(null)
  const shut = useRef(false)
  if (!m?.rec) return null
  const show = () => { if (shut.current) return; clearTimeout(timer.current); setOpen(true) }
  const hide = (ms = 300) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), ms) }
  return (
    <div className="rec-wrap" onMouseEnter={show} onMouseLeave={() => { shut.current = false; hide() }} onFocus={show} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hide(0) }}>
      <button type="button" className={`rec-pill${m.rec.paused ? ' paused' : ''}`} onClick={() => { shut.current = true; clearTimeout(timer.current); setOpen(false); openMeeting(m.rec.id) }} aria-haspopup="true" aria-expanded={open} title={m.rec.paused ? t('{title}: paused. Click to open it.', { title: m.rec.title }) : t('{title}: recording. Click to open it.', { title: m.rec.title })}>
        <span className="rec-dot" aria-hidden="true" />
        <span className="rec-time">{clock(m.elapsed)}</span>
        <span className="rec-name">{m.rec.paused ? t('Paused') : m.rec.title}</span>
      </button>
      {open && (
        <div className="rec-menu" role="dialog" aria-label={t('Recording')}>
          <div className="rec-menu-head"><b title={m.rec.title}>{m.rec.title}</b><span className="muted small">{m.rec.paused ? t('Paused') : t('Recording')} · {clock(m.elapsed)}{m.rec.section ? ` · ${m.rec.section}` : ''}</span></div>
          <div className="rec-menu-acts">
            {m.rec.paused
              ? <button type="button" className="btn small" onClick={m.resume}><Icon name="mic" size={12} /> {t('Resume')}</button>
              : <button type="button" className="btn small" onClick={m.pause}><Icon name="pause" size={12} /> {t('Pause')}</button>}
            <SectionButton m={m} />
            <button type="button" className="btn small danger-soft" onClick={() => { setOpen(false); m.stop() }}><Icon name="stop" size={12} /> {t('Stop')}</button>
            <span className="rec-screen"><ScreenButton m={m} /></span>
          </div>
          <QuickNote id={m.rec.id} />
          <div className="rec-menu-links">
            <button type="button" className="link-btn" onClick={() => { setOpen(false); openMeeting(m.rec.id) }}>{t('Open the meeting')}</button>
            <button type="button" className="link-btn" onClick={() => { setOpen(false); openMeetings() }}>{t('All meetings')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// New section: the next part of the meeting starts here, like a lap on a stopwatch. It says which
// one started for a moment.
export function SectionButton({ m, small = true }) {
  const [said, setSaid] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!m?.rec) return null
  const go = async () => {
    try { const r = await m.section(); setSaid(r.section ? t('{name} started', { name: r.section.title }) : null) } catch (e) { setSaid(e.message) }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaid(null), 2200)
  }
  return (
    <>
      <button type="button" className={`btn${small ? ' small' : ''}`} onClick={go} title={t('Start the next part of the meeting here, like a lap. The transcript, your notes and the summary get a heading for each part.')}><Icon name="flag" size={12} /> {t('New section')}</button>
      {said && <span className="muted small rec-said" role="status">{said}</span>}
    </>
  )
}

// Watch a screen, or while one is watched, Capture (what's showing, now). The count is how many
// pictures of it are kept.
export function ScreenButton({ m, small = true }) {
  const [err, setErr] = useState(null)
  const [flash, setFlash] = useState(false)
  if (!m?.rec) return null
  const run = async (fn) => { setErr(null); try { await fn() } catch (e) { setErr(e.message) } }
  if (!m.screen) {
    if (!navigator.mediaDevices?.getDisplayMedia) return null
    return <><button type="button" className={`btn${small ? ' small' : ''}`} onClick={() => run(m.watchScreen)} title={t('Pick the window or screen being shared. A picture is kept each time it changes, for your notes.')}><Icon name="screen" size={12} /> {t('Watch a screen')}</button>{err && <span className="error-text small">{err}</span>}</>
  }
  return (
    <>
      <button type="button" className={`btn${small ? ' small' : ''}${flash ? ' flash' : ''}`} onClick={() => run(async () => { await m.capture(); setFlash(true); setTimeout(() => setFlash(false), 600) })} title={t("Keep what's on {name} now", { name: m.screen.label })}><Icon name="camera" size={12} /> {t('Capture')}{m.screen.kept ? ` · ${m.screen.kept}` : ''}</button>
      <button type="button" className={`btn${small ? ' small' : ''}`} onClick={m.unwatch} title={t('Watching {name}. Click to stop.', { name: m.screen.label })}><Icon name="eye-off" size={12} /> {t('Stop watching the screen')}</button>
      {err && <span className="error-text small">{err}</span>}
    </>
  )
}

// The calendar event on now, for a call that started at `at` (named in the prompt).
export function useCallEvent(at) {
  const [ev, setEv] = useState(null)
  useEffect(() => {
    setEv(null)
    if (!at) return
    let on = true
    eventNow().then((e) => on && setEv(e)).catch(() => {})
    return () => { on = false }
  }, [at])
  return ev
}

// When a call starts with nothing recording ("Zoom call started. Take notes?") and when the call a
// meeting was on ends ("Stop recording?"), at the top of the window. The floating card asks too.
export function CallPrompt() {
  const m = useMeetings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const c = m?.calls
  const ev = useCallEvent(c?.prompt && !m?.rec ? c.prompt.at : null)
  if (!c) return null
  const r = c.recording
  const act = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false); m.refreshCalls() } }
  if (r?.callEnded && m.rec?.id === r.id) {
    const left = r.stopsAt ? Math.max(0, Math.round((new Date(r.stopsAt).getTime() - Date.now()) / 1000)) : null
    return (
      <div className="call-prompt" role="alertdialog" aria-label={t('The call ended')}>
        <span className="rec-dot" aria-hidden="true" />
        <span className="call-prompt-main"><b>{r.callEndedApp ? t('The {app} call ended.', { app: r.callEndedApp }) : t('The call ended.')}</b><small>{left != null ? t('Stop recording? It stops by itself in {time}.', { time: clock(left) }) : t('Stop recording?')}</small></span>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => act(() => m.stop())}><Icon name="stop" size={12} /> {t('Stop')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => act(() => api(`/meetings/${r.id}/keep`, { method: 'POST' }))}>{t('Keep recording')}</button>
        {err && <span className="error-text small">{err}</span>}
      </div>
    )
  }
  if (c.prompt && !m.rec) {
    const what = c.prompt.browser ? t('A call in {app} started.', { app: c.prompt.app }) : t('{app} call started.', { app: c.prompt.app })
    return (
      <div className="call-prompt" role="alertdialog" aria-label={t('A call started')}>
        <Icon name="mic" size={15} />
        <span className="call-prompt-main"><b>{what}</b><small>{ev ? t('Take notes for "{title}"?', { title: ev.title }) : t('Take notes?')} {t('Your mic and the call, transcribed as you go.')}</small></span>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => act(async () => { const id = await m.startForCall(c.prompt.app); if (id) openMeeting(id) })}><Icon name="mic" size={12} /> {t('Take notes')}</button>
        <button type="button" className="ghost-btn" disabled={busy} onClick={() => act(() => api('/calls/dismiss', { method: 'POST' }))}>{t('Not now')}</button>
        {err && <span className="error-text small">{err}</span>}
      </div>
    )
  }
  return null
}
