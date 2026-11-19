// Another of your computers' screen, here (Remote Screen and Preview, a Beta Feature): live,
// peer-to-peer when the network allows it, else as pictures through the relay (said, as it's
// slower), and controlled from here once that computer allows it and you choose Control. That
// computer shows it's being seen the whole time, with Stop, and keeps a record of it.
//   In the desktop app it's a window of its own (?remote=view, desktop/remote.js), sized to that
//   screen's shape on the display it opens on; elsewhere (a browser, a phone) over the page.
//   The picture fills what's under the toolbar, on a dark letterbox: Fit (its shape kept, the
//   default), Actual Size (one of its pixels to one of this screen's, scrolled or dragged about) or
//   Full Screen; on a phone, fitted, and pinched to zoom. Another of its screens is picked in the
//   same session (nothing to connect again), from Which screen?: each by its display's own name and
//   size, the main one marked, with a still of each. On a phone it asks at the start when there are
//   several; everywhere it's one tap from the toolbar. The one picked is kept for that computer.
//   Before anything shows, that computer may ask for its Remote Access Password, or ask someone
//   there to allow it; each step, a lockout and a no say so here, with why.
//   What keeps its screen from showing is said as it is, with the button that fixes it from here
//   when there is one (Open, Reopen or Update Bridge AI there, Allow Screen Recording there), and
//   what it's waiting for meanwhile; never a bare Try again when the reason is known. Each one also
//   goes in this computer's log (server/remote.js didntShow), as that computer's has it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { useMedia, store } from '../layout.jsx'
import { t, tn, locale } from '../../i18n/index.js'
import { baseFor, remoteStatus, connect, pointOn, setViewing } from './remote.js'
import { hostApi, viaRelay } from '../../api.js'
import { newer } from '../../../shared/version.js'
import { SWAP, swapsKeys, RATE, ACCESS, fitIn } from '../../../shared/remote.js'
import './remote.css'

const HERE = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'mac' : /Win/.test(navigator.platform || '') ? 'windows' : 'linux'
const app = () => window.bridgeApp || null
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null
const canFull = () => !!app()?.fullScreen || !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)
const timeOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
const ZOOM_MAX = 6
// The screen last picked for each computer (its id), for the next time.
const PICKED = 'cc-remote-screen'
const sizeOf = (x) => (x?.w && x?.h ? `${x.w}×${x.h}` : '')
const onCard = (e) => !!e.target?.closest?.('.rs-card')
// What can't show for a reason of that computer's own (not a guardrail): an older Bridge AI there is
// offered Update for these, as a newer one fixes them by itself.
const TECHNICAL = new Set(['noCapture', 'noScreens', 'source'])
// An update there: looked at this often, for this long, before it's said it hasn't come back.
const UPDATE_LOOK_MS = 5000
const UPDATE_MS = 10 * 60 * 1000

// Which screen?: that computer's screens, each by its display's name and size, the main one marked,
// with a still of each once it comes (thumbs: id -> picture), the one showing ticked; its windows
// folded away under them. start: asked as the session starts (a phone, with several screens).
function Chooser({ name, list, cur, thumbs, start, onPick, onClose }) {
  const screens = list.filter((x) => x.kind === 'screen')
  const windows = list.filter((x) => x.kind === 'window')
  const on = (x) => cur?.kind === x.kind && cur?.id === x.id
  return (
    <div className="rs-card rs-pick" role="dialog" aria-label={t('Which screen?')}>
      <h3>{t('Which screen?')}</h3>
      <p className="muted small">{start ? t('{name} has {n} screens. Pick the one to view; you can switch any time from the toolbar.', { name, n: screens.length }) : t('{name} has {n} screens.', { name, n: screens.length })}</p>
      <ul className="rs-pick-list">
        {screens.map((x) => {
          const box = fitIn(72, 46, x.w || 16, x.h || 10)
          return (
            <li key={x.id}>
              <button type="button" className={`rs-pick-item${on(x) ? ' on' : ''}`} aria-pressed={on(x)} onClick={() => onPick(`screen:${x.id}`)}>
                <span className="rs-thumb"><span style={{ width: `${Math.round(box.w)}px`, height: `${Math.round(box.h)}px` }}>{thumbs[x.id] ? <img src={thumbs[x.id]} alt="" draggable={false} /> : <Icon name="screen" size={14} />}</span></span>
                <span className="rs-pick-text"><b>{x.name}</b><small>{[sizeOf(x), x.primary && t('Main screen')].filter(Boolean).join(' · ')}</small></span>
                {on(x) && <span className="rs-showing"><Icon name="check" size={13} /> <span>{t('Showing')}</span></span>}
              </button>
            </li>
          )
        })}
      </ul>
      {windows.length > 0 && (
        <details className="rs-pick-wins">
          <summary>{t('Windows ({n})', { n: windows.length })}</summary>
          <ul className="rs-pick-list">
            {windows.map((x) => (
              <li key={x.id}>
                <button type="button" className={`rs-pick-item win${on(x) ? ' on' : ''}`} aria-pressed={on(x)} onClick={() => onPick(`window:${x.id}`)}>
                  <span className="rs-pick-text"><b>{x.name}</b><small>{t('View only: control works on a whole screen')}</small></span>
                  {on(x) && <span className="rs-showing"><Icon name="check" size={13} /> <span>{t('Showing')}</span></span>}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="rs-card-btns"><button type="button" className="btn" onClick={onClose}>{t('Close')}</button></div>
    </div>
  )
}

// windowed: the desktop app's window of its own (closing it is the window's own button too).
export default function ScreenView({ machine, name, onClose, windowed = false }) {
  const phone = useMedia('(max-width: 760px)')
  const base = baseFor(machine)
  const [st, setSt] = useState(null) // that computer's word on its screen (GET /api/remote)
  const [err, setErr] = useState(null) // { why, code, cause, until, fix, waits }: nothing to show, why, and what fixes it
  const [wait, setWait] = useState(null) // what a fix being carried out waits for: { why: reopen | open | allow | update, until }
  const [fixing, setFixing] = useState(null) // a fix chosen before connecting (noApp: open; screenPermission: allow)
  const [run, setRun] = useState(0)
  const [sess, setSess] = useState({ phase: 'loading' }) // phase: loading | connecting | password | asking | live | ended; mode: p2p | relay; hello
  const [gate, setGate] = useState(null) // what that computer asks before it shows anything: { t: 'password', wrong, left, lockMinutes } | { t: 'asking', until }
  const [pw, setPw] = useState('') // the password as it's typed, never kept
  const [paused, setPaused] = useState(false)
  const [note, setNote] = useState(null) // { text, bad }
  const [controlling, setControlling] = useState(false)
  const [swap, setSwap] = useState(null) // null: as the two systems differ
  const [size, setSize] = useState({ w: 0, h: 0 }) // the picture's own pixels
  const [mode, setModeState] = useState(() => (store.get('cc-remote-size', 'fit') === 'actual' ? 'actual' : 'fit'))
  const [zoom, setZoom] = useState(1) // a phone's pinch, over Fit
  const [full, setFull] = useState(false)
  const [box, setBox] = useState({ w: 0, h: 0 }) // the room for the picture
  const [choose, setChoose] = useState(null) // Which screen? up: 'start' (as the session starts) | 'pick'
  const [thumbs, setThumbs] = useState({}) // a still of each screen: id -> picture
  const [, tick] = useState(0)
  const root = useRef(null)
  const bar = useRef(null)
  const video = useRef(null)
  const img = useRef(null)
  const canvas = useRef(null)
  const stage = useRef(null)
  const conn = useRef(null)
  const lastUrl = useRef(null)
  const held = useRef(new Set())
  const buttons = useRef(new Set())
  const taking = useRef(false)
  const clipAsked = useRef(false) // Get clipboard pressed: the answer it waits for
  const pan = useRef(null)
  const touch = useRef(null)
  const pinch = useRef(null)
  const fitted = useRef('')
  const session = useRef(null)
  const askedAtStart = useRef(false)
  const heard = useRef(false) // the session said anything yet
  const retried = useRef(false) // closed before it said anything: connected again once, by itself
  const said = useRef(null) // the last error put in the log
  const updateLook = useRef(null) // an update there, looked at until it's back
  const pickedKey = machine || 'here'
  const setMode = (m) => { setModeState(m); setZoom(1); store.set('cc-remote-size', m) }

  // The window's own title (the Dock's and the Window menu's list of windows).
  useEffect(() => { if (windowed) document.title = `${t("{name}'s Screen", { name })} · Bridge AI` }, [windowed, name])
  useEffect(() => {
    let live = true
    setErr(null)
    setSess({ phase: 'loading' })
    // A phone on Bridge AI's relay: what comes through it counts against the account's allowance,
    // so the pictures come at that relay's pace (shared/remote.js RATE).
    const slow = viaRelay ? hostApi('/relay').then((r) => !!r?.hosted, () => false) : Promise.resolve(false)
    Promise.all([remoteStatus(base, { sources: true }), slow]).then(([d, sl]) => { if (!live) return; setSt({ ...d, slow: sl }); if (!d.screen?.can && !fixing) setErr({ why: d.screen?.why || t("{name}'s screen can't be seen from here.", { name }), code: d.screen?.code, fix: d.screen?.fix || null }) },
      (e) => live && setErr(e.message === 'update' ? { code: 'update', why: t('Update Bridge AI on {name} to see its screen from here.', { name }) } : { why: e.message }))
    return () => { live = false }
  }, [base, name, run])

  const show = (f) => {
    const el = img.current
    if (!el) return
    const url = URL.createObjectURL(new Blob([f.bytes], { type: f.type || 'image/jpeg' }))
    el.onload = () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); lastUrl.current = url; conn.current?.ack() }
    el.onerror = () => { URL.revokeObjectURL(url); conn.current?.ack() }
    el.src = url
    if (f.w && f.h) setSize((s) => (s.w === f.w && s.h === f.h ? s : { w: f.w, h: f.h }))
  }
  const setControl = (c) => setSess((x) => ({ ...x, hello: x.hello && { ...x.hello, control: { on: !!c.on, allowed: !!c.allowed, idle: !!c.idle, why: c.why || null } } }))
  const onMessage = (m) => {
    if (m.t === 'size' && m.w && m.h) setSize({ w: m.w, h: m.h })
    // (again: in the session, to take control back: Cancel goes on view-only.)
    else if (m.t === 'password') { setGate({ t: 'password', wrong: !!m.wrong, left: Number(m.left) || 0, lockMinutes: Number(m.lockMinutes) || ACCESS.lockMinutes, again: !!m.again }); setSess((x) => ({ ...x, phase: 'password' })) }
    else if (m.t === 'asking') { setGate({ t: 'asking', until: m.until || new Date(Date.now() + (Number(m.ms) || 30000)).toISOString(), again: !!m.control }); setSess((x) => ({ ...x, phase: 'asking' })) }
    else if (m.t === 'paused') { setPaused(true); clearTimeout(onMessage.pause); onMessage.pause = setTimeout(() => setPaused(false), Number(m.ms) || 3000) }
    else if (m.t === 'control') {
      // Control asked for in the session (the password again, Allow there): answered.
      setGate(null)
      setSess((x) => (x.hello && (x.phase === 'password' || x.phase === 'asking') ? { ...x, phase: 'live' } : x))
      setControl(m)
      if (!m.allowed) setControlling(false)
      if (m.allowed && taking.current) { setControlling(true); setTimeout(() => stage.current?.focus({ preventScroll: true }), 0) }
      if (m.idle) setNote({ text: t('View only now: nothing was pressed for {n} minutes. Choose Control to take it again.', { n: st?.access?.limits?.idleMinutes || ACCESS.idleMinutes }) })
      taking.current = false
    } else if (m.t === 'source' && m.source) {
      setSess((x) => ({ ...x, hello: x.hello && { ...x.hello, source: m.source, control: m.control ? { ...m.control } : x.hello.control } }))
      if (m.control && !m.control.allowed) setControlling(false)
      if (m.source.w && m.source.h) setSize({ w: m.source.w, h: m.source.h })
      setZoom(1)
    } else if (m.t === 'thumb' && typeof m.id === 'string' && /^data:image\/(jpeg|png|webp|svg\+xml);base64,/.test(m.data || '')) setThumbs((x) => ({ ...x, [m.id]: m.data }))
    else if (m.t === 'clip') {
      // Only what this device asked for: nothing put on its clipboard otherwise.
      if (!clipAsked.current) return
      clipAsked.current = false
      const text = String(m.text ?? '')
      navigator.clipboard?.writeText(text).then(() => setNote({ text: t("Copied {name}'s clipboard here ({n} characters).", { name, n: text.length }) }), () => setNote({ text: t("This browser didn't let Bridge AI write to the clipboard. {name}'s clipboard says: {text}", { name, text: text.slice(0, 200) }) }))
    } else if (m.t === 'clip-sent') setNote({ text: t("This clipboard is on {name}'s now ({n} characters).", { name, n: Number(m.n) || 0 }) })
    else if (m.t === 'error') { if (m.keep) setNote({ text: m.why, bad: true }); else { setWait(null); setErr({ why: m.why, code: m.code, cause: m.cause || null, until: m.until || null, by: m.by || null, at: m.at || null, reopen: !!m.reopen, fix: m.fix || null, waits: !!m.waits }); setGate(null); setSess((x) => ({ ...x, phase: 'ended' })) } }
    // A fix being carried out there: what it waits for, until the screen (or why not) comes.
    else if (m.t === 'wait') { setErr(null); setWait({ why: m.why, until: m.until || null }); setSess((x) => ({ ...x, phase: 'connecting' })) }
    else if (m.t === 'ended') setSess((x) => ({ ...x, phase: 'ended', text: m.why === 'here' ? t('Stopped on {name}.', { name }) : m.why === 'stopped' ? t('Stopped from {device}.', { device: m.by || t('another of your devices') }) : m.text }))
  }

  // The session: as long as this is open. Another of its screens goes over the same one. It starts on
  // the screen picked last time for this computer, while it's still there, else the main one; on a
  // phone, with several screens, Which screen? asks first.
  const can = !!st?.screen?.can || !!fixing
  useEffect(() => {
    if (!can) return
    heard.current = false
    setSess({ phase: 'connecting' })
    setGate(null)
    setPw('')
    setPaused(false)
    setControlling(false)
    setNote(null)
    setChoose(null)
    setThumbs({})
    askedAtStart.current = false
    const last = store.get(PICKED, {})?.[pickedKey]
    const was = (st.screen?.sources || []).find((x) => x.kind === 'screen' && x.id === last)
    const c = connect({
      base, source: was ? `screen:${was.id}` : 'screen:', control: !!st.control?.on, slow: !!st.slow, fix: fixing,
      on: {
        hello: (m) => {
          heard.current = true
          setGate(null)
          setWait(null)
          setSess((x) => ({ ...x, phase: 'live', hello: m }))
          if (m.source?.w && m.source?.h) setSize({ w: m.source.w, h: m.source.h })
          session.current = m.session
          setViewing(m.session, true)
          // Behind a password or Ask Here First, which screens there are comes only now: the one
          // picked last time, taken now (nothing to connect again).
          const back = !was && last && last !== m.source?.id && (m.sources || []).find((x) => x.kind === 'screen' && x.id === last)
          if (back) { c.send({ t: 'source', source: `screen:${back.id}` }); return }
          if (phone && !askedAtStart.current && (m.sources || []).filter((x) => x.kind === 'screen').length > 1) { askedAtStart.current = true; setChoose('start') }
        },
        mode: (mode) => setSess((x) => ({ ...x, mode })),
        track: (stream) => { const v = video.current; if (v) { v.srcObject = stream; v.play().catch(() => {}) } },
        frame: show,
        message: (m) => { heard.current = true; onMessage(m) },
        // Closed before it said anything (the link dropped a moment): connected again once, by
        // itself; again, said. A fix offered in the session can't be chosen any more once it's closed.
        closed: (code, reason) => {
          if (!heard.current && !retried.current) { retried.current = true; setRun((n) => n + 1); return }
          setWait(null)
          setErr((x) => (x ? (x.waits ? { ...x, fix: null, waits: false } : x) : heard.current ? x : { code: 'closed', why: reason || '' }))
          setSess((x) => (x.phase === 'ended' ? x : { ...x, phase: 'ended' }))
        },
      },
    })
    conn.current = c
    return () => { c.close(); conn.current = null; setViewing(session.current, false); session.current = null; if (lastUrl.current) { URL.revokeObjectURL(lastUrl.current); lastUrl.current = null } }
  }, [can, base, run]) // eslint-disable-line react-hooks/exhaustive-deps
  // Which screen? up: a still of each, asked for (that computer sends them only in a session).
  useEffect(() => { if (choose && sess.phase === 'live') conn.current?.send({ t: 'thumbs?' }) }, [choose, sess.phase])

  const hello = sess.hello
  const ctl = hello?.control
  const allowed = !!ctl?.allowed
  const live = sess.phase === 'live'
  const media = () => (sess.mode === 'p2p' ? video.current : img.current)
  const doSwap = swap ?? swapsKeys(HERE, hello?.os)
  const send = (evs) => conn.current?.input(evs)
  const releaseAll = () => {
    const evs = [...held.current].map((code) => ({ t: 'key', code, down: false }))
    held.current.clear()
    if (evs.length) send(evs)
  }
  useEffect(() => { if (!controlling) releaseAll() }, [controlling]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the picture's size ----------
  // The room under the toolbar, as it changes (the window resized, the toolbar wrapping, full screen).
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dpr = window.devicePixelRatio || 1
  const fit = fitIn(box.w, box.h, size.w, size.h)
  const actual = mode === 'actual' && !phone
  const shown = actual ? { w: size.w / dpr, h: size.h / dpr } : { w: fit.w * zoom, h: fit.h * zoom }
  const scrolls = actual ? shown.w > box.w + 1 || shown.h > box.h + 1 : zoom > 1.01
  // The desktop app's window takes that screen's shape, once for each screen shown, and for its main
  // screen as soon as that computer says it (before the password, when it does), unless you've sized
  // it yourself: desktop/remote.js remembers that for this computer.
  const main = st?.screen?.sources?.find((x) => x.kind === 'screen' && x.id === store.get(PICKED, {})?.[pickedKey]) || st?.screen?.sources?.find((x) => x.kind === 'screen' && x.primary)
  const shape = live && size.w && size.h ? { ...size, id: hello?.source?.id || '' } : main?.w && main?.h ? { w: main.w, h: main.h, id: main.id } : null
  useEffect(() => {
    if (!windowed || !shape) return
    const key = `${shape.id}:${shape.w}x${shape.h}`
    if (fitted.current === key) return
    fitted.current = key
    app()?.remote?.fit?.({ w: shape.w, h: shape.h, chrome: bar.current?.offsetHeight || 52 }).catch?.(() => {})
  }, [windowed, shape?.id, shape?.w, shape?.h]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- full screen ----------
  useEffect(() => {
    const a = app()
    if (a?.fullScreen) {
      let id = null
      const ask = () => { clearTimeout(id); id = setTimeout(() => a.fullScreen().then((v) => setFull(v === true), () => {}), 200) }
      ask()
      window.addEventListener('resize', ask)
      return () => { clearTimeout(id); window.removeEventListener('resize', ask) }
    }
    const change = () => setFull(!!fsElement())
    document.addEventListener('fullscreenchange', change)
    document.addEventListener('webkitfullscreenchange', change)
    return () => { document.removeEventListener('fullscreenchange', change); document.removeEventListener('webkitfullscreenchange', change) }
  }, [])
  const toggleFull = async () => {
    const a = app()
    if (a?.fullScreen) { const r = await a.fullScreen(!full); setFull(r === true); return }
    try {
      if (!fsElement()) await (root.current.requestFullscreen?.() || root.current.webkitRequestFullscreen?.())
      else await (document.exitFullscreen?.() || document.webkitExitFullscreen?.())
    } catch { setNote({ text: t("This browser didn't let the screen go full screen."), bad: true }) }
  }

  // ---------- input ----------
  // The wheel, kept from scrolling this page while you control that one; and a phone's pinch.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wheel = (e) => {
      if (!controlling || !allowed || onCard(e)) return
      e.preventDefault()
      const p = pointOn(media(), size.w, size.h, e.clientX, e.clientY)
      send([{ t: 'wheel', dx: e.deltaX, dy: e.deltaY, ...(p || {}) }])
    }
    const dist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY)
    const mid = (ts) => ({ x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2 })
    const start = (e) => {
      if (e.touches.length !== 2 || actual || onCard(e)) return
      const r = el.getBoundingClientRect()
      const m = mid(e.touches)
      pinch.current = { d: dist(e.touches), zoom, at: { x: m.x - r.left + el.scrollLeft, y: m.y - r.top + el.scrollTop } }
    }
    const move = (e) => {
      const p = pinch.current
      if (!p || e.touches.length !== 2) return
      e.preventDefault()
      const z = Math.min(ZOOM_MAX, Math.max(1, p.zoom * dist(e.touches) / p.d))
      const r = el.getBoundingClientRect()
      const m = mid(e.touches)
      const k = z / p.zoom
      const to = { x: p.at.x * k - (m.x - r.left), y: p.at.y * k - (m.y - r.top) }
      setZoom(z)
      // The point between the fingers stays under them.
      requestAnimationFrame(() => { el.scrollLeft = to.x; el.scrollTop = to.y })
    }
    const endPinch = (e) => { if (e.touches.length < 2) pinch.current = null }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', endPinch)
    el.addEventListener('touchcancel', endPinch)
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', endPinch); el.removeEventListener('touchcancel', endPinch) }
  })
  // Escape closes, unless it's going to that computer (or Which screen? is up, or the window is full
  // screen: it leaves that).
  useEffect(() => {
    const key = (e) => {
      if (e.key !== 'Escape' || controlling || e.target.closest?.('input, select')) return
      if (choose) { setChoose(null); return }
      if (full) { toggleFull(); return }
      if (!windowed) onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e) => pointOn(media(), size.w, size.h, e.clientX, e.clientY)
  // On the stage's own scroll bars, not the picture.
  const onBars = (e) => { const el = stage.current; if (!el) return false; const r = el.getBoundingClientRect(); return e.clientX >= r.left + el.clientLeft + el.clientWidth || e.clientY >= r.top + el.clientTop + el.clientHeight }
  const pointer = (kind) => (e) => {
    // On a card over the picture (Which screen?, the password): that card's, never that computer's.
    if (onCard(e)) return
    // Not controlling, bigger than the room: dragged about with the mouse (a finger scrolls by itself).
    if (!controlling || !allowed) {
      const el = stage.current
      if (!scrolls || e.pointerType === 'touch' || !el) return
      if (kind === 'down' && !onBars(e)) { pan.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }; try { el.setPointerCapture(e.pointerId) } catch { /* not here */ } }
      else if (kind === 'move' && pan.current) { el.scrollLeft = pan.current.l - (e.clientX - pan.current.x); el.scrollTop = pan.current.t - (e.clientY - pan.current.y) }
      else if (kind === 'up') pan.current = null
      return
    }
    if (kind === 'down' && onBars(e)) return
    const p = at(e)
    // A finger: a tap is a click, a drag a drag; a second finger makes it a pinch, never a click.
    if (e.pointerType === 'touch') {
      const tc = touch.current
      if (kind === 'down') {
        if (tc) { clearTimeout(tc.timer); if (tc.sent) send([{ t: 'up', b: 0, ...(tc.p || { x: 0.5, y: 0.5 }) }]); touch.current = { gesture: true }; return }
        if (!p) return
        const n = { id: e.pointerId, p, x: e.clientX, y: e.clientY, sent: false }
        n.timer = setTimeout(() => { if (touch.current === n) { n.sent = true; send([{ t: 'move', ...n.p }, { t: 'down', b: 0, ...n.p }]) } }, 160)
        touch.current = n
      } else if (kind === 'move') {
        if (!tc || tc.gesture || tc.id !== e.pointerId || !p) return
        tc.p = p
        if (!tc.sent && Math.hypot(e.clientX - tc.x, e.clientY - tc.y) > 8) { clearTimeout(tc.timer); tc.sent = true; send([{ t: 'move', ...p }, { t: 'down', b: 0, ...p }]) } else if (tc.sent) send([{ t: 'move', ...p }])
      } else {
        if (tc?.gesture) { if (!e.isPrimary || kind === 'up') touch.current = null; return }
        if (!tc || tc.id !== e.pointerId) return
        clearTimeout(tc.timer)
        const q = p || tc.p
        send(tc.sent ? [{ t: 'up', b: 0, ...q }] : [{ t: 'move', ...q }, { t: 'down', b: 0, ...q }, { t: 'up', b: 0, ...q }])
        touch.current = null
      }
      return
    }
    if (kind === 'down') {
      if (!p) return
      e.preventDefault()
      stage.current?.focus({ preventScroll: true })
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not here */ }
      buttons.current.add(e.button)
      send([{ t: 'move', ...p }, { t: 'down', b: Math.min(2, e.button), ...p }])
    } else if (kind === 'up') {
      if (!buttons.current.delete(e.button)) return
      send([{ t: 'up', b: Math.min(2, e.button), ...(p || { x: 0.5, y: 0.5 }) }])
    } else if (p) send([{ t: 'move', ...p }])
  }
  const key = (down) => (e) => {
    if (!controlling || !allowed || e.target !== stage.current) return
    e.preventDefault()
    let code = e.code
    if (!code) return
    if (doSwap && SWAP[code]) code = SWAP[code]
    if (down) held.current.add(code)
    else held.current.delete(code)
    send([{ t: 'key', code, down }])
  }
  // A phone's keyboard: each letter typed goes as it's typed, Return, Delete and Tab as keys.
  const typed = (e) => { const v = e.target.value; if (v) send([{ t: 'text', s: v }]) }
  const typedKey = (e) => {
    const code = { Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab' }[e.key]
    if (!code) return
    e.preventDefault()
    send([{ t: 'key', code, down: true }, { t: 'key', code, down: false }])
  }
  const clipSend = async () => {
    setNote(null)
    try { const text = await navigator.clipboard.readText(); conn.current?.send({ t: 'clip', text }) } catch { setNote({ text: t("This browser didn't let Bridge AI read the clipboard. Paste into {name} with the keyboard instead.", { name }), bad: true }) }
  }
  const clipGet = () => { setNote(null); clipAsked.current = true; conn.current?.send({ t: 'clip?' }) }
  const toggleControl = () => {
    if (allowed) { setControlling(!controlling); if (!controlling) setTimeout(() => stage.current?.focus({ preventScroll: true }), 0); return }
    // Back to view-only after a while, or turned on there since: taken (again) from here.
    setNote(null)
    taking.current = true
    conn.current?.send({ t: 'control', on: true })
  }
  // Keys held go up first; control carries on where the screen picked allows it (not a window). A
  // screen is kept as this computer's for next time.
  const pick = (v) => {
    setChoose(null)
    if (cur && v === `${cur.kind}:${cur.id}`) return
    setNote(null)
    releaseAll()
    conn.current?.send({ t: 'source', source: v })
    if (v.startsWith('screen:')) store.set(PICKED, { ...(store.get(PICKED, {}) || {}), [pickedKey]: v.slice(7) })
  }
  const retry = () => { setErr(null); setWait(null); setFixing(null); setGate(null); retried.current = false; setRun((n) => n + 1) }
  // The fix for what keeps the screen from showing: in the session that offered it (it waits for
  // the answer), or a new one that carries it out once past the password (one told before connecting).
  const doFix = (fix) => {
    if (err?.waits) { conn.current?.send({ t: 'fix', fix }); setErr(null); setWait({ why: fix }); setSess((x) => ({ ...x, phase: 'connecting' })); return }
    setErr(null); setGate(null); setWait(null); setFixing(fix); retried.current = false; setRun((n) => n + 1)
  }
  // Update Bridge AI there (an older one: what it can't fix by itself, a newer one does), and its
  // screen asked for again once it's back: newer, or answering again after it went away to update.
  const updateThere = async () => {
    setErr(null)
    setWait({ why: 'update' })
    const res = await fetch(`${base}/api/updates/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) { setWait(null); setErr({ code: 'updateFailed', why: data?.error || t("{name} didn't answer. Try again in a moment.", { name }) }); return }
    const from = st?.version || null
    const end = Date.now() + UPDATE_MS
    let away = false
    const look = async () => {
      const d = await remoteStatus(base).catch(() => null)
      if (!d) away = true
      else if (away || (d.version && (!from || newer(d.version, from)))) { retry(); return }
      if (Date.now() > end) { setWait(null); setErr({ code: 'updateSlow' }); return }
      updateLook.current = setTimeout(look, UPDATE_LOOK_MS)
    }
    updateLook.current = setTimeout(look, UPDATE_LOOK_MS)
  }
  useEffect(() => () => clearTimeout(updateLook.current), [])
  // Taking control back, asked for the password or Allow: Cancel, and it goes on view-only.
  const stayViewing = () => { conn.current?.send({ t: 'control', on: false }); setGate(null); setPw(''); setSess((x) => ({ ...x, phase: 'live' })) }
  const sendPassword = (e) => {
    e.preventDefault()
    if (!pw) return
    conn.current?.send({ t: 'password', p: pw })
    setPw('')
    setGate((g) => ({ ...g, checking: true }))
  }

  // Each reason the screen didn't show, in this computer's log too (not a guardrail's: a password,
  // a no there), once.
  useEffect(() => {
    if (!err || ['locked', 'denied', 'unanswered', 'device', 'blocked', 'stopped', 'timeout', 'busy'].includes(err.code)) return
    const key = `${err.code}|${err.why}`
    if (said.current === key) return
    said.current = key
    hostApi('/remote/didnt-show', { method: 'POST', body: { name, code: err.code || 'error', cause: err.cause || undefined, why: err.why || '', version: st?.version || undefined } }).catch(() => {})
  }, [err]) // eslint-disable-line react-hooks/exhaustive-deps

  // Locked out: Try again once it's over.
  const lockedUntil = err?.code === 'locked' && err.until ? new Date(err.until).getTime() : 0
  useEffect(() => { if (!lockedUntil || lockedUntil <= Date.now()) return; const tm = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(tm) }, [lockedUntil])
  // Waiting on someone there: the seconds left.
  useEffect(() => { if (sess.phase !== 'asking') return; const tm = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(tm) }, [sess.phase])

  const sources = hello?.sources || st?.screen?.sources || []
  const cur = hello?.source
  const rate = st && sess.mode === 'relay' ? (hello?.rate || RATE.own) : null
  const limits = st?.access?.limits || ACCESS
  const takeable = !allowed && !!ctl?.on && cur?.kind === 'screen'
  const record = tn('{name} shows that its screen is being seen, with Stop, and keeps a record of it.', { name: <b key="n">{name}</b> })

  // What shows in the middle of the stage until the picture does, and when it's gone.
  const card = (() => {
    if (err) {
      const words = {
        locked: lockedUntil > Date.now() ? t('Too many wrong passwords. {name} lets this device try again at {time}.', { name, time: timeOf(err.until) }) : t('Too many wrong passwords were typed here. You can try again now.'),
        denied: t('Someone at {name} said no to this.', { name }),
        unanswered: t("Nobody at {name} answered within {n} seconds, so it wasn't allowed.", { name, n: limits.askSeconds }),
        device: t("{name} doesn't let this device connect. That's changed at {name} itself, in Settings › Account & Devices › Computers.", { name }),
        blocked: t("{name} doesn't let this device connect. That's changed at {name} itself, in Settings › Account & Devices › Computers.", { name: err.at || name }),
        stopped: t('Stopped from {device}.', { device: err.by || t('another of your devices') }),
        timeout: t("The password wasn't typed in time. Try again."),
        screenPermission: t("macOS doesn't let Bridge AI record the screen on {name}. On {name}, turn on Bridge AI in System Settings › Privacy & Security › Screen & System Audio Recording, then open Bridge AI again there.", { name }),
        reopen: t("Screen Recording was turned on for Bridge AI on {name} after it opened, and macOS lets it record only once it's reopened.", { name }),
        noScreens: t("macOS on {name} gave Bridge AI no screens to share. If it's asking there whether Bridge AI may record the screen, answer it there; if not, reopening Bridge AI there usually sorts it.", { name }),
        reopening: t('Bridge AI is reopening on {name}. Try again in a few seconds.', { name }),
        noCapture: err.cause === 'list' ? t("Bridge AI on {name} opened its screen sharing, but the list of its screens didn't come in time.", { name })
          : err.cause === 'window' ? t("The Bridge AI app on {name} didn't open its screen sharing, even with a second try.", { name }) : null,
        noApp: err.fix === 'open' ? t("The Bridge AI app isn't open on {name}. Its screen can be seen while the app runs there.", { name }) : null,
        offline: t("{name} isn't reachable just now: it may be asleep, or offline.", { name }),
        closed: t('The connection to {name} closed before its screen showed.', { name }),
        updateSlow: t("Bridge AI on {name} hasn't come back from its update yet. Try again in a minute.", { name }),
      }
      const icon = err.code === 'locked' ? 'lock' : ['denied', 'unanswered', 'device', 'blocked', 'stopped'].includes(err.code) ? 'ban' : 'alert'
      // The button that fixes it, when there's one; an older Bridge AI there, Update (it's what fixes
      // what one can't fix by itself), beside Try again.
      const fixWords = { open: t('Open Bridge AI on {name}', { name }), allow: t('Allow Screen Recording on {name}', { name }), reopen: t('Reopen Bridge AI on {name}', { name }) }
      const fix = err.fix && fixWords[err.fix] ? err.fix : null
      const older = !!st && !st.version && TECHNICAL.has(err.code || 'error')
      const update = err.code === 'update' || older
      return (
        <div className={`rs-card c-${err.code || 'error'}`} role="alert">
          <Icon name={icon} size={22} />
          <p>{words[err.code] || err.why}</p>
          {older && <p className="muted small">{t('{name} has an older Bridge AI. Updating it reopens it there, which usually sorts this.', { name })}</p>}
          <div className="rs-card-btns">
            {!windowed && <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>}
            {update && !fix && !err.reopen && <button type="button" className="btn" onClick={retry}>{t('Try again')}</button>}
            {fix ? <button type="button" className="btn primary" onClick={() => doFix(fix)}>{fixWords[fix]}</button>
              : err.reopen ? <button type="button" className="btn primary" onClick={() => { conn.current?.send({ t: 'reopen' }); setErr((x) => ({ ...x, reopen: false })) }}>{t('Reopen Bridge AI on {name}', { name })}</button>
                : update ? <button type="button" className="btn primary" onClick={updateThere}>{t('Update Bridge AI on {name}', { name })}</button>
                  : err.code !== 'trial' && <button type="button" className="btn primary" disabled={lockedUntil > Date.now()} onClick={retry}>{t('Try again')}</button>}
          </div>
        </div>
      )
    }
    // A fix being carried out there: what it waits for (someone there turning Screen Recording on,
    // the app opening, reopening or updating), with Close; the screen shows by itself after.
    if (wait && sess.phase !== 'live') {
      const words = {
        reopen: t('Reopening Bridge AI on {name}…', { name }),
        open: t('Opening Bridge AI on {name}…', { name }),
        update: t('Updating Bridge AI on {name}…', { name }),
        allow: t('System Settings is open on {name} at Screen & System Audio Recording. Waiting for someone there to turn on Bridge AI…', { name }),
      }
      return (
        <div className={`rs-card c-wait w-${wait.why}`} role="status">
          <Icon name="refresh" size={20} className="spin" />
          <p>{words[wait.why] || t('Connecting to {name}…', { name })}</p>
          {wait.why === 'update' && <small className="muted">{t("It reopens by itself when it's done, and its screen shows here then.")}</small>}
          {!windowed && <div className="rs-card-btns"><button type="button" className="btn" onClick={onClose}>{t('Close')}</button></div>}
        </div>
      )
    }
    if (sess.phase === 'password' && gate?.t === 'password') {
      return (
        <form className="rs-card c-password" onSubmit={sendPassword}>
          <Icon name="lock" size={22} />
          <h3>{t('Remote Access Password')}</h3>
          <p>{gate.again ? t('{name} asks for its password again before this device controls it.', { name }) : t('{name} asks for its password before it shows its screen.', { name })}</p>
          <input className="st-input" type="password" name="bridge-remote-access" autoComplete="off" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} disabled={!!gate.checking} aria-label={t('Remote Access Password')} placeholder={t('Password')} />
          {gate.wrong && !gate.checking && <p className="rs-card-bad" role="alert">{gate.left === 1 ? t('Wrong password. One more wrong try locks this device out for {m} minutes.', { m: gate.lockMinutes }) : t('Wrong password. {n} more wrong tries lock this device out for {m} minutes.', { n: gate.left, m: gate.lockMinutes })}</p>}
          <div className="rs-card-btns">
            <button type="button" className="btn" onClick={gate.again ? stayViewing : onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn primary" disabled={!pw || !!gate.checking}>{gate.checking ? t('Checking…') : t('Connect')}</button>
          </div>
          <small className="muted">{record}</small>
        </form>
      )
    }
    if (sess.phase === 'asking' && gate?.t === 'asking') {
      const left = Math.max(0, Math.round((new Date(gate.until).getTime() - Date.now()) / 1000))
      return (
        <div className="rs-card c-asking" role="status">
          <Icon name="refresh" size={20} className="spin" />
          <p>{t('Waiting for someone at {name} to allow this…', { name })}</p>
          <small className="muted">{t("{n} seconds left. No answer is a no.", { n: left })}</small>
          <div className="rs-card-btns"><button type="button" className="btn" onClick={gate.again ? stayViewing : onClose}>{t('Cancel')}</button></div>
        </div>
      )
    }
    if (sess.phase === 'ended') {
      return (
        <div className="rs-card c-ended" role="status">
          <Icon name="stop" size={20} />
          <p>{sess.text || t('Not showing {name} any more.', { name })}</p>
          <div className="rs-card-btns">
            {!windowed && <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>}
            <button type="button" className="btn primary" onClick={retry}>{t('View again')}</button>
          </div>
        </div>
      )
    }
    if (choose && live) return <Chooser name={name} list={sources} cur={cur} thumbs={thumbs} start={choose === 'start'} onPick={pick} onClose={() => setChoose(null)} />
    if (!live || !sess.mode || sess.mode === 'connecting' || !size.w) {
      return (
        <div className="rs-card c-wait" role="status">
          <Icon name="refresh" size={20} className="spin" />
          <p>{st ? t('Connecting to {name}…', { name }) : t('Asking {name}…', { name })}</p>
          <small className="muted">{record}</small>
        </div>
      )
    }
    return null
  })()

  const viewing = live && !!sess.mode && sess.mode !== 'connecting' && !!size.w
  return (
    <div ref={root} className={`rs-view${phone ? ' phone' : ''}${windowed ? ' windowed' : ''}${full ? ' full' : ''}`} role={windowed ? 'main' : 'dialog'} aria-label={t("{name}'s Screen", { name })}>
      <header className="rs-bar" ref={bar}>
        <b className="rs-title" title={t("{name}'s Screen", { name })}><Icon name="screen" size={14} /> <span>{t("{name}'s Screen", { name })}</span></b>
        {live && sources.length > 1 && (
          <button type="button" className={`btn small rs-source${choose ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={!!choose} onClick={() => setChoose(choose ? null : 'pick')}
            aria-label={t('Which screen? Showing {name}', { name: cur?.name || '' })} title={t('Which screen?')}>
            <Icon name="screen" size={12} /> <span>{cur?.name || t('Which screen?')}</span> <Icon name="down" size={11} />
          </button>
        )}
        {live && sess.mode && sess.mode !== 'connecting' && (
          <span className={`rs-mode m-${sess.mode}`} title={sess.mode === 'p2p' ? t('Straight between the two devices, end-to-end encrypted.') : t("The network between the two doesn't allow a direct connection, so the screen comes through the relay as pictures, end-to-end encrypted. It's slower: about {n} a second.", { n: rate })}>
            {sess.mode === 'p2p' ? t('Direct') : t('Through the relay (slower)')}
          </span>
        )}
        <span className="grow" />
        <div className="rs-tools">
          {viewing && !phone && (
            <div className="seg rs-size" role="group" aria-label={t('Picture size')}>
              <button type="button" className={mode === 'fit' ? 'on' : ''} aria-pressed={mode === 'fit'} onClick={() => setMode('fit')} title={t('The whole screen, its shape kept')}>{t('Fit')}</button>
              <button type="button" className={mode === 'actual' ? 'on' : ''} aria-pressed={mode === 'actual'} onClick={() => setMode('actual')} title={t('One of its pixels to one of this screen\'s: drag or scroll to move about')}>{t('Actual Size')}</button>
            </div>
          )}
          {viewing && phone && zoom > 1.01 && <button type="button" className="ghost-btn" onClick={() => setZoom(1)}>{t('Fit')}</button>}
          {canFull() && (
            <button type="button" className={`win-btn rs-full${full ? ' on' : ''}`} aria-pressed={full} onClick={toggleFull} title={full ? t('Leave Full Screen') : t('Full Screen')} aria-label={t('Full Screen')}><Icon name={full ? 'shrink' : 'maximize'} size={15} /></button>
          )}
          {live && (allowed || takeable)
            ? <button type="button" className={`btn small rs-take${controlling && allowed ? ' primary' : ''}`} aria-pressed={controlling && allowed} aria-label={controlling && allowed ? t('Controlling') : t('Control')} onClick={toggleControl} title={t('Use your mouse and keyboard on {name}. Anyone at {name} moving its mouse or pressing a key pauses you for a moment.', { name })}>
              <Icon name="keyboard" size={12} /> <span>{controlling && allowed ? t('Controlling') : t('Control')}</span>
            </button>
            : live && ctl?.why && <span className="muted small rs-why" title={ctl.why} aria-label={t('View only')}><Icon name="eye" size={12} /> <span>{t('View only')}</span></span>}
          {live && allowed && controlling && !phone && <>
            {swapsKeys(HERE, hello?.os) || swap != null ? (
              <label className="rs-swap" title={t('⌘ here is Ctrl there, so copy, paste and undo work as you\'d expect.')}>
                <input type="checkbox" checked={doSwap} onChange={(e) => setSwap(e.target.checked)} /> <span>{HERE === 'mac' ? t('⌘ as Ctrl') : t('Ctrl as ⌘')}</span>
              </label>
            ) : null}
            <button type="button" className="win-btn" onClick={clipSend} title={t("Put this device's clipboard on {name}'s", { name })} aria-label={t('Send clipboard')}><Icon name="upload" size={14} /></button>
            <button type="button" className="win-btn" onClick={clipGet} title={t("Copy {name}'s clipboard here", { name })} aria-label={t('Get clipboard')}><Icon name="download" size={14} /></button>
          </>}
          <button type="button" className={phone ? 'win-btn rs-stop' : 'btn small rs-stop'} onClick={onClose} aria-label={t('Stop viewing')} title={t('Stop viewing')}><Icon name="x" size={phone ? 16 : 12} />{!phone && <span>{t('Stop viewing')}</span>}</button>
        </div>
      </header>
      {(note || paused || (live && ctl?.why && !allowed && !phone && !ctl?.idle)) && (
        <div className={`rs-note ${note?.bad ? 'bad' : ''}`} role="status">
          {paused ? <><Icon name="pause" size={12} /> <span>{t('Paused: someone at {name} is using it. You can carry on in a moment.', { name })}</span></>
            : note ? <><span>{note.text}</span><button type="button" className="win-btn" onClick={() => setNote(null)} aria-label={t('Dismiss')}><Icon name="x" size={12} /></button></>
              : <><Icon name="info" size={12} /> <span>{ctl.why}</span></>}
        </div>
      )}
      <div className={`rs-stage${controlling && allowed ? ' controlling' : ''}${scrolls ? ' scrolls' : ''}${actual ? ' actual' : ''}`} ref={stage} tabIndex={0} data-mode={actual ? 'actual' : zoom > 1.01 ? 'zoom' : 'fit'}
        onPointerDown={pointer('down')} onPointerUp={pointer('up')} onPointerMove={pointer('move')} onPointerCancel={pointer('cancel')}
        onKeyDown={key(true)} onKeyUp={key(false)} onBlur={releaseAll} onContextMenu={(e) => { if (controlling) e.preventDefault() }}>
        <div className="rs-canvas" ref={canvas} hidden={!viewing} style={{ width: `${Math.round(shown.w)}px`, height: `${Math.round(shown.h)}px` }}>
          <video ref={video} className="rs-media" muted playsInline autoPlay hidden={sess.mode !== 'p2p'} />
          <img ref={img} className="rs-media" alt="" hidden={sess.mode === 'p2p'} draggable={false} />
        </div>
        {card && <div className={`rs-over${choose && viewing ? ' dim' : ''}`}>{card}</div>}
      </div>
      {phone && live && allowed && controlling && (
        <div className="rs-type">
          <input className="st-input" value="" onChange={typed} onKeyDown={typedKey} enterKeyHint="enter" autoCapitalize="off" autoCorrect="off"
            placeholder={t('Type on {name}', { name })} aria-label={t('Type on {name}', { name })} />
          <button type="button" className="win-btn" onClick={clipSend} aria-label={t('Send clipboard')} title={t("Put this device's clipboard on {name}'s", { name })}><Icon name="upload" size={16} /></button>
          <button type="button" className="win-btn" onClick={clipGet} aria-label={t('Get clipboard')} title={t("Copy {name}'s clipboard here", { name })}><Icon name="download" size={16} /></button>
        </div>
      )}
    </div>
  )
}
