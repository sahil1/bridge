import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, BASE, onThisComputer, refetch, machineId } from '../../api.js'
import { record, microphone } from './recorder.js'
import { micRefused, micBlocked } from '../../audio/pcm.js'
import { watch as watchShare, sendPicture, sendGlance } from './screen.js'
import { recordVideo, canRecordScreen } from './videorec.js'
import { VideoChoice, RECORD_SCREEN } from './video.jsx'
import { store } from '../layout.jsx'
import { useScreenAccess, useAllowCall, allowSteps } from './allowcall.jsx'
import { cropKept } from './cropping.jsx'
import { t, locale } from '../../i18n/index.js'
import { Among, useCallEvents, MeetingName } from './cardparts.jsx'
import './meetings.css'

// The top bar's pill says a long title in short, not cut off by the pill (the whole is in its tooltip).
const shortTitle = (s, n = 24) => { const x = String(s || '').trim(); return x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x }

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
// The calendar event to name a call's notes after (app: the call's, Teams or Zoom), as the computer
// works it out (server callevent.js): the one the call's window names, the one you clicked Join on,
// else the one starting nearest to when the call did; with no call, the one under way. null when
// there's none, or no calendar.
// Not waited on for long: a calendar slow to read shouldn't hold up taking notes, which then
// start without its name.
export async function eventNow(app) {
  const d = await Promise.race([api(`/calls/event${app ? `?app=${encodeURIComponent(app)}` : ''}`).catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
  return d?.event || null
}
// The mic, or why not within ms: one that never answers (macOS asking somewhere out of sight, a
// device that's stuck) says so rather than leaving Take notes hanging. If it answers after all,
// it's let go.
function micWithin(open, ms = 20_000) {
  return new Promise((resolve, reject) => {
    let late = false
    const timer = setTimeout(() => { late = true; reject(new Error(t("The microphone didn't start. If macOS is asking about it, answer there; otherwise check System Settings › Privacy & Security › Microphone, then try again."))) }, ms)
    open().then((s) => { clearTimeout(timer); if (late) s.getTracks().forEach((x) => x.stop()); else resolve(s) }, (e) => { clearTimeout(timer); if (!late) reject(e) })
  })
}

// Why a screen can't be watched, as the meeting says it (ScreenWhy). fix: what it offers to do,
// 'screen' (Screen Recording: Open it, then Restart Bridge AI), 'restart' (on, and applied once
// Bridge AI restarts), 'reset' (on, and still no screen: Reset and ask again) or 'click' (the picker
// opens only from a click in the window itself).
const screenErr = (text, fix = null) => Object.assign(new Error(text), { fix })
// getDisplayMedia said no (e): why, as far as can be told. In the desktop app, its own reason first
// (desktop/screenpick.js): Electron passes on only "Invalid capture constraints", whatever it was.
// Nothing picked (the picker closed, or Cancel there) is said too, as none.
async function whyNot(e) {
  const app = window.bridgeApp
  const mac = app?.platform === 'darwin'
  const said = app?.screenWhy ? await Promise.resolve(app.screenWhy()).catch(() => null) : null
  switch (said?.why) {
    case 'off': return screenErr(t('Screen Recording is off for Bridge AI. Turn it on under System Settings › Privacy & Security › Screen & System Audio Recording, then watch a screen again.'), 'screen')
    case 'restricted': return screenErr(t("A profile on this Mac turns off Screen Recording for Bridge AI, so it can't watch a screen here."))
    case 'reopen': return screenErr(t('Screen Recording is on for Bridge AI, and macOS applies it once Bridge AI restarts.'), 'restart')
    case 'none':
      if (mac) return screenErr(t("macOS lists no screen for Bridge AI to watch, though Screen Recording is on for it. macOS can keep an answer that shows as on and doesn't take."), 'reset')
      // Linux asks which screen in a dialog of its own (Wayland): closed, there's none.
      return screenErr(app.platform === 'linux' ? t("No screen to watch: none was picked in the system's dialog, or none was found. Click Watch a screen to try again.") : t('Bridge AI found no screen to watch on this computer.'))
    case 'error': return screenErr(t("Couldn't list this computer's screens: {why}", { why: said.problem || e.message }))
    case 'page': return screenErr(t('This window shows another of your computers. Watch a screen from a Bridge AI window on this computer.'))
    case 'frame': return screenErr(t("Watch a screen from Bridge AI's own window: this page is inside another one."))
    case 'gone': return screenErr(t('The page changed while the screen was asked for. Click Watch a screen to try again.'))
    default: break
  }
  // The system isn't letting the browser (or the app) see the screen (macOS's picker says so too).
  if (e?.name === 'NotAllowedError' && /system/i.test(e.message)) {
    if (mac) return screenErr(t('Screen Recording is off for Bridge AI. Turn it on under System Settings › Privacy & Security › Screen & System Audio Recording, then watch a screen again.'), 'screen')
    return screenErr(app ? t("This computer isn't letting Bridge AI see the screen.") : t("macOS isn't letting this browser see the screen. Turn on your browser under System Settings › Privacy & Security › Screen & System Audio Recording, in Screen Recording, then try again."))
  }
  // Asked without a click (Safari says InvalidAccessError, Chromium InvalidStateError).
  if (e?.name === 'InvalidStateError' || e?.name === 'InvalidAccessError' || /activation|gesture/i.test(e?.message || '')) return screenErr(t('Click Watch a screen here: the picker opens only from a click in this window.'), 'click')
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
    const text = !app ? t("Nothing was picked in the browser's picker. Click Watch a screen to pick the window or tab being shared.")
      : mac ? t("Nothing was picked in macOS's picker. Click Watch a screen to pick the window being shared.")
        : t('No screen was picked. Click Watch a screen to try again.')
    return Object.assign(screenErr(text), { none: true })
  }
  if (e?.name === 'NotReadableError' || e?.name === 'NotFoundError') return screenErr(t("Couldn't start watching the screen ({why}). Click Watch a screen to try again.", { why: e.message || e.name }))
  return screenErr(e?.message || t("Couldn't watch that screen"))
}

export function MeetingsProvider({ children }) {
  const [rec, setRec] = useState(null) // { id, title, startedAt, paused, call, trouble, pausedFor, section }
  // Switching machines would stop it: the device menu opens another window instead (Machines.jsx).
  useEffect(() => { document.documentElement.dataset.recording = rec ? '1' : '' }, [rec])
  const [levels, setLevels] = useState({})
  const [screen, setScreen] = useState(null) // { label, kept, video } while a screen is watched (screen.js)
  const share = useRef(null)
  // Record the screen too (videorec.js), remembered on this device: the screen picked as recording
  // starts, or watched, is kept as a video too. film: the video being made; shown: the stream it's
  // made of (the one screen.js watches); screenNote: why the screen isn't being recorded, when it
  // was meant to be.
  const [video, setVideo] = useState(() => store.get(RECORD_SCREEN, false) === true)
  const recordScreen = (on) => { setVideo(!!on); store.set(RECORD_SCREEN, !!on) }
  const film = useRef(null)
  const shown = useRef(null)
  const [screenNote, setNote] = useState(null) // { text, fix }
  const setScreenNote = (x) => setNote(x == null ? null : typeof x === 'string' ? { text: x, fix: null } : { text: x.message, fix: x.fix || null })
  // A screen being picked (in macOS's or the browser's picker), shown once it takes a moment; pickNo:
  // the pick under way, so Cancel lets it go.
  const [picking, setPicking] = useState(false)
  const pickNo = useRef(0)
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
  const openMic = async () => {
    // The demo has no computer behind it: say so before asking for the mic.
    if (import.meta.env.MODE === 'demo') throw new Error(t('Recording a meeting needs Bridge AI on your computer.'))
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.bridgeNative || window.bridgeAndroid || matchMedia('(pointer: coarse)').matches
      ? t('Recording from your phone needs a secure connection: open your computer through your relay (Settings › Devices on the computer), not its plain Tailscale address.')
      : t('Recording needs the desktop app, or this page over HTTPS.'))
    room.current = inRoom()
    try { return await micWithin(() => microphone(undefined, { room: room.current })) } catch (e) {
      if (!e.name) throw e // it never answered
      // In the desktop app on a Mac: the way to allow it (or reset it) there (Meetings.jsx shows it).
      const fix = await micRefused(e)
      if (fix) throw Object.assign(new Error(t('macOS is blocking the microphone for Bridge AI.')), { code: 'mic', stale: fix.stale })
      throw new Error(e.name === 'NotAllowedError' ? micBlocked() : e.message)
    }
  }
  // m: the meeting as the server made it (or took up again). from: how far in it is already, in
  // seconds, so the time carries on. at: when this window took it up, whatever its time says.
  const recordIt = async (m, mic, from = 0) => {
    refetch('/meetings') // its name on its tab and in the sidebar now, not at the next look
    handle.current = await record(m.id, { you: mic }, {
      onLevel: setLevels,
      onTrouble: (t) => setRec((r) => (r ? { ...r, trouble: t } : r)),
      reopen: { you: () => microphone(undefined, { room: room.current }) },
      onGap: (ms) => setRec((r) => (r ? { ...r, missed: (r.missed || 0) + ms, missedAt: Date.now() } : r)),
      onStream: (src, s) => { if (src === 'you') film.current?.mic(s) },
    })
    setNow(Date.now()) // its time is right from the start, not at the clock's next second
    setRec({ id: m.id, title: m.title, startedAt: Date.now() - from * 1000, at: Date.now(), paused: false, pausedMs: 0, call: m.call === 'on' ? 'on' : m.callWhy || null })
    openMeeting(m.id)
    return m.id
  }
  // A meeting that stopped when Bridge AI closed, which a recording starting now would carry on
  // (server meetings.js carryOn: its calendar event still on, or it stopped a moment ago): asked
  // first, Resume recording the default, at the top of the window (CallPrompt). Resolves with
  // 'resume', 'new', or null when the question was put away.
  const [carry, setCarry] = useState(null) // { m, done }
  const askCarry = (c) => new Promise((done) => {
    setCarry({ m: c, done: (how) => { setCarry(null); done(how) } })
    // The desktop app's window, when it's hidden (a call's notes taken from the menu bar).
    if (document.hidden) window.bridgeApp?.focusMain?.()
  })
  // picking: the screen to record (Record the screen too), asked for already (startNow), or here
  // before anything is waited on: a browser shows its picker only straight after a click. fresh:
  // a new meeting, picked over carrying on one that stopped when Bridge AI closed.
  const start = async ({ title, event, kind, picking, fresh = false } = {}) => {
    if (handle.current) { letGo(picking); openMeeting(rec.id); return rec.id }
    if (picking === undefined) picking = pickFirst()
    if (!fresh && import.meta.env.MODE !== 'demo') {
      const c = await api('/meetings/carry-on', { method: 'POST', body: { event: event || null } }).then((r) => r.meeting, () => null)
      const how = c ? await askCarry(c) : 'new'
      if (how === 'resume') return recordAgain(c.id, { picking })
      if (how !== 'new') { letGo(picking); return null }
    }
    let mic, m
    try {
      mic = await openMic()
      // The call's sound is recorded by the server (on a Mac); this page records your mic.
      m = await api('/meetings', { method: 'POST', body: { title: title || `Meeting, ${when()}`, event, kind } })
    } catch (e) { mic?.getTracks().forEach((x) => x.stop()); letGo(picking); throw e }
    const id = await recordIt(m, mic)
    screenFrom(m, picking)
    return id
  }
  // Resume recording: a meeting that ended (stopped by mistake, or by itself) records again, the
  // same meeting from where it had got to. Not while another one records.
  const recordAgain = async (id, { picking } = {}) => {
    if (handle.current && rec.id === id) { letGo(picking); return id }
    const other = handle.current ? rec : calls?.recording && calls.recording.id !== id ? calls.recording : null
    if (other) { letGo(picking); throw new Error(t('"{title}" is recording. Stop it first.', { title: other.title })) }
    if (picking === undefined) picking = pickFirst()
    let mic
    try { mic = await openMic() } catch (e) { letGo(picking); throw e }
    let m
    try { m = await api(`/meetings/${encodeURIComponent(id)}/reopen`, { method: 'POST' }) } catch (e) { mic.getTracks().forEach((x) => x.stop()); letGo(picking); throw e }
    refreshCalls()
    const mid = await recordIt(m, mic, m.seconds || 0)
    screenFrom(m, picking)
    return mid
  }
  const changedAt = useRef(0) // when Pause or Resume was last pressed here
  const pauseHere = () => { handle.current.pause(); film.current?.pause(); setRec((r) => ({ ...r, paused: true, pausedAt: Date.now() })) }
  const resumeHere = () => { handle.current.resume(); film.current?.resume(); setRec((r) => ({ ...r, paused: false, pausedMs: r.pausedMs + (Date.now() - r.pausedAt) })) }
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
  // The screen or window to watch, in the browser's or macOS's own picker: { stream }, { error }
  // saying why it can't be (whyNot; error.none: nothing was picked), or {} when Cancel let it go.
  // For a video (Record the screen too): smooth, at most 1920 wide (the stills are no bigger), and
  // with its own sound where that can be the call's (a browser offers a tab's, the desktop app on
  // Windows what the computer plays) unless Bridge AI records the call's sound itself (call: a Mac).
  const pick = async ({ video: filmIt = false, call = false } = {}) => {
    const app = window.bridgeApp
    // A window of the desktop app showing another computer: the screen would be this one's, for a
    // meeting on that one (the app says no there too: desktop/senders.js permits).
    if (app && machineId) return { error: screenErr(t('This window shows another of your computers. Watch a screen from a Bridge AI window on this computer.')) }
    if (window.top !== window) return { error: screenErr(t("Watch a screen from Bridge AI's own window: this page is inside another one.")) }
    if (!navigator.mediaDevices?.getDisplayMedia) return { error: screenErr(t('Watching a screen needs the desktop app, or a browser that can share one')) }
    const sound = filmIt && !call && (!app || app.platform === 'win32')
    const n = ++pickNo.current
    const slow = setTimeout(() => { if (pickNo.current === n) setPicking(true) }, 400)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: filmIt ? { frameRate: { ideal: 15, max: 30 }, width: { max: 1920 }, height: { max: 1200 } } : { frameRate: { ideal: 2, max: 5 } }, audio: sound, ...(sound ? { systemAudio: 'include' } : {}), selfBrowserSurface: 'exclude', surfaceSwitching: 'include' })
      if (pickNo.current !== n) { stream.getTracks().forEach((x) => x.stop()); return {} }
      return { stream }
    } catch (e) {
      return pickNo.current !== n ? {} : { error: await whyNot(e) }
    } finally {
      clearTimeout(slow)
      if (pickNo.current === n) setPicking(false)
    }
  }
  const cancelPick = () => { pickNo.current++; setPicking(false) }
  const pickFirst = () => (video && canRecordScreen() ? pick({ video: true }) : null)
  const letGo = (picking) => { picking?.then((r) => r.stream?.getTracks().forEach((x) => x.stop())) }
  // The screen picked as recording started: watched and recorded, or why not, said on the meeting.
  const screenFrom = async (m, picking) => {
    if (!picking) return
    const r = await picking
    if (!r.stream) { setScreenNote(!r.error || r.error.none ? t("The screen isn't being recorded: none was picked. Watch a screen to pick one.") : r.error); return }
    if (!handle.current) { letGo(picking); return }
    await watchScreen({ id: m.id, stream: r.stream, video: true, call: m.call === 'on' }).catch(setScreenNote)
  }
  // Watch a screen (the window someone shares slides in): a picture each time it changes, and
  // Capture for one now. Asks which screen or window, in the browser's or macOS's own picker. With
  // Record the screen too, a video of it as well (and watched already, a video of it from now).
  // id, stream, call: the meeting just started, the screen picked as it did, and its call's sound.
  const watchScreen = async ({ id: mid = rec?.id, stream, video: filmIt = video && canRecordScreen(), call = rec?.call === 'on' } = {}) => {
    if (!handle.current) throw new Error(t('Start recording first'))
    if (share.current) { if (filmIt && !film.current && shown.current) await filmScreen(mid, shown.current, call); return }
    if (!stream) {
      const r = await pick({ video: filmIt, call })
      if (r.error) throw r.error
      if (!r.stream) return // Cancel, while it was being picked
      stream = r.stream
      // Stopped meanwhile, or watching one already (picked as it started): this one isn't needed.
      if (!handle.current || share.current) { stream.getTracks().forEach((x) => x.stop()); return }
    }
    talk.current.off = false
    const w = watchShare(stream, {
      // Counted when kept: the server leaves out a change whose words are the last picture's.
      // Then cropped to what's shared in it, here (cropping.jsx).
      onPicture: async (blob, kind) => { const r = await sendPicture(mid, blob, { kind, source: w.label }); if (r?.kept !== false) { setScreen((x) => (x ? { ...x, kept: x.kept + 1 } : x)); cropKept(mid, r, blob) } },
      glance,
      onGlance: (blob) => sendGlance(mid, blob).then((r) => { if (r.stop) talk.current.off = true }, () => {}),
      onEnd: () => { share.current = null; shown.current = null; film.current?.stop(); setScreen(null); window.bridgeApp?.watching?.(false) },
    })
    share.current = w
    shown.current = stream
    setScreen({ label: w.label, kept: 0, video: null })
    setScreenNote(null)
    window.bridgeApp?.watching?.(true)
    if (filmIt) await filmScreen(mid, stream, call)
  }
  // The video of the screen being watched: its size as it grows, and why, if it stops before the
  // screen does (the disk nearly full).
  const filmScreen = async (mid, stream, call) => {
    try {
      const f = await recordVideo(mid, stream, {
        mic: handle.current?.stream?.('you'),
        call,
        label: stream.getVideoTracks()[0]?.label || '',
        onSize: (s) => setScreen((x) => (x?.video ? { ...x, video: { ...x.video, ...s } } : x)),
        onEnd: (why) => {
          if (film.current === f) film.current = null
          setScreen((x) => (x ? { ...x, video: null } : x))
          if (why) setScreenNote(t('The screen stopped being recorded: {why}', { why }))
        },
      })
      if (!handle.current || shown.current !== stream) { f.stop(); return }
      film.current = f
      if (handle.current.paused) f.pause()
      setScreen((x) => (x ? { ...x, video: { bytes: 0, free: null, seconds: 0, sound: f.sound } } : x))
    } catch (e) { setScreenNote(t("The screen isn't being recorded: {why}", { why: e.message })) }
  }
  const capture = async () => {
    if (!share.current) throw new Error(t('Watch a screen first'))
    await share.current.now()
  }
  const unwatch = () => share.current?.stop()
  const stop = async () => {
    if (!handle.current) return
    // The video's last pieces go before the meeting is stopped.
    const f = film.current
    share.current?.stop()
    const id = rec.id
    const h = handle.current
    handle.current = null
    setRec(null)
    setLevels({})
    setScreenNote(null)
    await Promise.all([h.stop(), f?.stop()])
    await api(`/meetings/${id}/stop`, { method: 'POST' }).catch(() => {})
    refetch('/meetings') // the lists show it stopped now (its menu offers Archive and Delete again)
    refreshCalls()
  }
  // Notes for a call that just started: named after the calendar event on now, if there is one
  // (picked: the one chosen in its prompt, with more than one on).
  const startForCall = async (app, picked, { fresh = false } = {}) => {
    const picking = pickFirst()
    const event = picked?.title ? picked : await eventNow(app)
    return start({ title: event?.title || `${app} call, ${when()}`, event, picking, fresh })
  }
  // Recording now, from the sidebar: for the calendar event on now (its name and people), if there
  // is one.
  const startNow = async () => {
    const picking = pickFirst()
    const event = await eventNow()
    return start(event ? { title: event.title, event, picking } : { picking })
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
    if (!handle.current || !rec || !calls || callsAt.current - rec.at < 4000) return
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
  // Renamed (here, on the floating card, on its page, on another device) or named after another
  // calendar event: its name here follows. Away from the computer, from the list of meetings.
  const retitledAt = useRef(0)
  const retitle = (title) => { retitledAt.current = Date.now(); setRec((r) => (r && title ? { ...r, title } : r)) }
  const { data: listed } = usePoll(rec && !here() ? '/meetings' : null, 8000)
  useEffect(() => {
    if (!rec || Date.now() - retitledAt.current < 4000) return
    const title = calls?.recording?.id === rec.id ? calls.recording.title : listed?.meetings?.find((x) => x.id === rec.id)?.title
    if (title && title !== rec.title) setRec((r) => (r ? { ...r, title } : r))
  }, [calls, listed]) // eslint-disable-line react-hooks/exhaustive-deps
  // The floating card: what's recording, and Pause, Resume and Stop from it.
  const fns = useRef(null)
  fns.current = { pause, resume, stop, start, recordAgain, startForCall, section, watchScreen, capture, unwatch, noteScreen: setScreenNote, mine: (id) => !!handle.current && rec?.id === id }
  const chan = useRef(null)
  useEffect(() => {
    const ch = new BroadcastChannel(MEETINGS_CHANNEL)
    chan.current = ch
    ch.onmessage = (e) => {
      const d = e.data || {}
      if (d.type === 'op' && handle.current && fns.current[d.op] && ['pause', 'resume', 'stop', 'section', 'capture', 'watchScreen', 'unwatch'].includes(d.op)) Promise.resolve().then(() => fns.current[d.op]()).catch((err) => { if (d.op === 'watchScreen') fns.current.noteScreen(err); ch.postMessage({ type: 'error', text: err.message }) })
      if (d.type === 'hello') ch.postMessage({ type: 'hello-back' })
    }
    // resume: carry on the meeting that stopped when Bridge AI closed (the floating card asked);
    // fresh: a new meeting instead.
    const onStart = (e) => { const d = e.detail || {}; (typeof d.resume === 'string' ? fns.current.recordAgain(d.resume) : d.app ? fns.current.startForCall(d.app, d.event, { fresh: !!d.fresh }) : fns.current.start(d)).catch((err) => ch.postMessage({ type: 'error', text: err.message })) }
    // Watch a screen from the floating card (the desktop app sends it here, as a click): why not, on
    // the meeting and on the card. The picker wanting a click in this window itself: this window
    // brought to the front (done tells the app, desktop/main.js) to say click it here. Not the
    // window recording (the meeting records in another one): that one watches.
    const onWatch = (e) => {
      const done = typeof e?.detail?.done === 'function' ? e.detail.done : null
      if (!handle.current) { ch.postMessage({ type: 'op', op: 'watchScreen' }); done?.(null); return }
      fns.current.watchScreen().then(() => done?.(null), (err) => {
        const click = err.fix === 'click'
        fns.current.noteScreen(err)
        ch.postMessage({ type: 'error', text: click ? t('Click Watch a screen in the Bridge AI window: the picker opens only from a click there.') : err.message })
        if (click && !done) window.bridgeApp?.focusMain?.()
        done?.(click ? { focus: true } : null)
      })
    }
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
  useEffect(() => { chan.current?.postMessage({ type: 'state', rec: rec && { id: rec.id, title: rec.title, paused: rec.paused, section: rec.section || null }, elapsed, you: levels.you || 0, screen, picking, canWatch: !!navigator.mediaDevices?.getDisplayMedia }) }, [rec, elapsed, levels, screen, picking])
  const value = useMemo(() => ({ rec, levels, elapsed, start, recordAgain, startNow, pause, resume, stop, section, calls, refreshCalls, startForCall, retitle, screen, watchScreen, capture, unwatch, picking, cancelPick, video, recordScreen, screenNote, noteScreen: setScreenNote, clearScreenNote: () => setScreenNote(null), stopVideo: () => film.current?.stop(), carry }), [rec, levels, elapsed, calls, screen, picking, video, screenNote, carry]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const clock = (s) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const ss = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}` }
// How long a meeting was, in words ("16 min", "1 h 5 min"), so it doesn't read as a time of day.
export const length = (s) => {
  const n = Math.max(0, Math.round(s || 0))
  if (n < 60) return t('{n} s', { n })
  const m = Math.round(n / 60)
  return m < 60 ? t('{n} min', { n: m }) : m % 60 ? t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) : t('{n} h', { n: m / 60 })
}

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
// shows Pause, Stop, New section, a quick note and the way to every meeting, with its name to
// change there (the pencil by it). Once clicked, the menu stays shut
// until the mouse has left: the meeting page has the same buttons, and the menu would sit over them.
export function RecordingPill() {
  const m = useMeetings()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState(null)
  const timer = useRef(null)
  const shut = useRef(false)
  const wrap = useRef(null)
  if (!m?.rec) return null
  const show = () => { if (shut.current) return; clearTimeout(timer.current); setOpen(true) }
  // Open while its name is being typed, wherever the pointer goes.
  const hide = (ms = 300) => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (!wrap.current?.querySelector('.mt-rename')) setOpen(false) }, ms) }
  return (
    <div className="rec-wrap" ref={wrap} onMouseEnter={show} onMouseLeave={() => { shut.current = false; hide() }} onFocus={show} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && !e.currentTarget.matches(':hover')) hide(0) }}>
      <button type="button" className={`rec-pill${m.rec.paused ? ' paused' : ''}`} onClick={() => { shut.current = true; clearTimeout(timer.current); setOpen(false); openMeeting(m.rec.id) }} aria-haspopup="true" aria-expanded={open} title={m.rec.paused ? t('{title}: paused. Click to open it.', { title: m.rec.title }) : t('{title}: recording. Click to open it.', { title: m.rec.title })}>
        <span className="rec-dot" aria-hidden="true" />
        <span className="rec-time">{clock(m.elapsed)}</span>
        <span className="rec-name">{m.rec.paused ? t('Paused') : shortTitle(m.rec.title)}</span>
      </button>
      {open && (
        <div className="rec-menu" role="dialog" aria-label={t('Recording')}>
          <div className="rec-menu-head"><span className="rec-menu-name"><MeetingName id={m.rec.id} title={m.rec.title} className="rec-menu-title" onRenamed={(v) => { setErr(null); m.retitle(v) }} onError={setErr} /></span>{err && <span className="error-text small" role="alert">{err}</span>}<span className="muted small">{m.rec.paused ? t('Paused') : t('Recording')} · {clock(m.elapsed)}{m.rec.section ? ` · ${m.rec.section}` : ''}</span></div>
          <div className="rec-menu-acts">
            {m.rec.paused
              ? <button type="button" className="btn small" onClick={m.resume}><Icon name="mic" size={12} /> {t('Resume')}</button>
              : <button type="button" className="btn small" onClick={m.pause}><Icon name="pause" size={12} /> {t('Pause')}</button>}
            <SectionButton m={m} />
            <button type="button" className="btn small danger-soft" onClick={() => { setOpen(false); m.stop() }}><Icon name="stop" size={12} /> {t('Stop')}</button>
            <span className="rec-screen"><ScreenButton m={m} toNote /></span>
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
// pictures of it are kept. While the picker is up: where to pick, and Cancel. Hidden where no screen
// can be shared at all (a phone), as Record the screen too is. toNote: why not is said on the meeting
// too (the top bar's menu, which closes as the pointer leaves it).
export function ScreenButton({ m, small = true, toNote = false }) {
  const [err, setErr] = useState(null)
  const [flash, setFlash] = useState(false)
  if (!m?.rec) return null
  const run = async (fn) => { setErr(null); m.clearScreenNote?.(); try { await fn() } catch (e) { setErr(e); if (toNote) m.noteScreen?.(e) } }
  const cls = `btn${small ? ' small' : ''}`
  if (!m.screen) {
    if (!navigator.mediaDevices?.getDisplayMedia) return null
    if (m.picking) {
      const app = window.bridgeApp
      const where = app?.platform === 'darwin' ? t("Pick the window or screen to watch in macOS's picker.") : app ? t("Pick the screen to watch in the system's picker.") : t("Pick the window or screen to watch in the browser's picker.")
      return <><button type="button" className={`${cls} mt-picking-btn`} aria-disabled="true" aria-busy="true"><Icon name="screen" size={12} /> {t('Picking a screen…')}</button><span className="muted small mt-picking" role="status">{where} <button type="button" className="link-btn" onClick={m.cancelPick}>{t('Cancel')}</button></span></>
    }
    return <><button type="button" className={cls} onClick={() => run(m.watchScreen)} title={t('Pick the window or screen being shared. A picture is kept each time it changes, for your notes.')}><Icon name="screen" size={12} /> {t('Watch a screen')}</button><ScreenWhy e={err} recording /></>
  }
  return (
    <>
      <button type="button" className={`${cls}${flash ? ' flash' : ''}`} onClick={() => run(async () => { await m.capture(); setFlash(true); setTimeout(() => setFlash(false), 600) })} title={t("Keep what's on {name} now", { name: m.screen.label })}><Icon name="camera" size={12} /> {t('Capture')}{m.screen.kept ? ` · ${m.screen.kept}` : ''}</button>
      <button type="button" className={cls} onClick={m.unwatch} title={t('Watching {name}. Click to stop.', { name: m.screen.label })}><Icon name="eye-off" size={12} /> {t('Stop watching the screen')}</button>
      <ScreenWhy e={err} recording />
    </>
  )
}

// Why a screen isn't watched (an Error from watchScreen, or the meeting's screen note: { text,
// fix }), with what to do about it there: Screen Recording's steps, Restart Bridge AI, or Reset and
// ask again (allowcall.jsx). recording: a restart stops the meeting, which it says first.
export function ScreenWhy({ e, recording = false, className = 'error-text small mt-screen-why', role = 'alert' }) {
  if (!e) return null
  const text = e.text ?? e.message
  const fix = ['screen', 'restart', 'reset'].includes(e.fix) && onThisComputer() ? e.fix : null
  return <span className={className || undefined} role={role || undefined}>{text}{fix && <ScreenFix fix={fix} recording={recording} />}</span>
}
function ScreenFix({ fix, recording }) {
  const { data, refresh } = useScreenAccess()
  const a = useAllowCall('screen', { recording, started: data?.started, onAsked: refresh })
  if (fix === 'screen') { const s = allowSteps('screen', a, { link: true }); return <>{s.say} {s.acts}</> }
  // On, and applied once Bridge AI restarts: Restart Bridge AI. On, and still no screen: Reset and
  // ask again where it can, else what to do in System Settings.
  const stage = a.sure || a.said ? a.stage : fix === 'reset' ? (a.canReset ? 'restarted' : 'off') : 'opened'
  const s = allowSteps('screen', { ...a, stage }, { link: true })
  const say = a.sure || a.said || a.err ? s.say : fix === 'reset' && !a.canReset ? <span className="ac-say"> {t('In System Settings, remove Bridge AI from {list} with −, then turn it on again.', { list: t('Screen Recording') })}</span> : null
  return <>{say} {s.acts}</>
}

// Why a recording seems to be over: its call ended, its time on the calendar is up and it's gone
// quiet, or nobody's said anything for a long while.
export const endedWords = (r) => (r.endWhy === 'over' ? t("Its time on your calendar is up, and it's gone quiet.") : r.endWhy === 'quiet' ? t('Nobody has said anything for a while.') : r.callEndedApp ? t('The {app} call ended.', { app: r.callEndedApp }) : t('The call ended.'))

// When it stopped, as a time of day (with the day, when that wasn't today).
const stoppedAt = (iso) => { const d = new Date(iso); return d.toLocaleString(locale(), { ...(d.toDateString() === new Date().toDateString() ? {} : { weekday: 'short' }), hour: 'numeric', minute: '2-digit' }) }
// A recording starting while one that stopped when Bridge AI closed could carry on (useMeetings'
// carry): Resume recording, the default, or a new meeting.
function CarryOn({ c }) {
  return (
    <div className="call-prompt mt-carry" role="alertdialog" aria-label={t('Carry on recording?')}>
      <Icon name="mic" size={15} />
      <span className="call-prompt-main"><b>{t('Recording of {title} stopped when Bridge AI closed at {time}', { title: c.m.title, time: stoppedAt(c.m.at) })}</b><small>{t('Carry on in that meeting, or start a new one?')}</small></span>
      <button type="button" className="btn small primary" autoFocus onClick={() => c.done('resume')}><Icon name="mic" size={12} /> {t('Resume recording')}</button>
      <button type="button" className="btn small" onClick={() => c.done('new')}>{t('New meeting')}</button>
      <button type="button" className="ghost-btn" onClick={() => c.done(null)} aria-label={t('Cancel')} title={t('Cancel')}><Icon name="x" size={13} /></button>
    </div>
  )
}
// A recording Bridge AI closed in the middle of (server meetings.js recover): said at the top of the
// window, with Resume recording, for a day after; Open or OK and it isn't said again on any device.
// Not while something records.
const NOTICE_MS = 24 * 3600e3
function Stopped({ m }) {
  const { data } = usePoll('/meetings', 30_000)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [gone, setGone] = useState(null)
  const x = (data?.meetings || []).filter((y) => y.interrupted && !y.interrupted.seen && y.status === 'done' && y.id !== gone && Date.now() - Date.parse(y.interrupted.at) < NOTICE_MS)
    .sort((a, b) => String(b.interrupted.at).localeCompare(String(a.interrupted.at)))[0]
  if (!x || m?.rec) return null
  const seen = () => { setGone(x.id); api(`/meetings/${encodeURIComponent(x.id)}/interrupted`, { method: 'POST' }).catch(() => {}).finally(() => refetch('/meetings')) }
  const resume = async () => { setBusy(true); setErr(null); try { await m.recordAgain(x.id); seen() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <div className="call-prompt mt-stopped" role="alertdialog" aria-label={t('A recording stopped')}>
      <Icon name="alert" size={15} />
      <span className="call-prompt-main"><b>{t('Recording of {title} stopped when Bridge AI closed at {time}', { title: x.title, time: stoppedAt(x.interrupted.at) })}</b><small>{t('What was recorded until then is kept. Resume recording carries on in the same meeting.')}</small></span>
      {m?.recordAgain && <button type="button" className="btn small primary" disabled={busy} onClick={resume}><Icon name="mic" size={12} /> {busy ? t('Starting…') : t('Resume recording')}</button>}
      <button type="button" className="btn small" onClick={() => { seen(); openMeeting(x.id) }}>{t('Open')}</button>
      <button type="button" className="ghost-btn" onClick={seen} aria-label={t('Got it')} title={t('Got it')}><Icon name="x" size={13} /></button>
      {err && <span className="error-text small" role="alert">{err}</span>}
    </div>
  )
}

// When a call starts with nothing recording ("Zoom call started. Take notes?") and when the call a
// meeting was on ends ("Stop recording?"), at the top of the window. The floating card asks too.
// Not now always closes it, at once, even while Take notes is still starting (and then what was
// starting stops again). A call's notes that would carry on a meeting Bridge AI closed in the middle
// of offer Resume recording first (carryOn), and New meeting. With nothing else to ask: a recording
// that stopped when Bridge AI closed (Stopped).
export function CallPrompt() {
  const m = useMeetings()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [gone, setGone] = useState(null) // the call (its start) Not now was pressed for
  const goneRef = useRef(null) // the same, for a Take notes still starting
  const c = m?.calls
  const evs = useCallEvents(c?.prompt && !m?.rec ? c.prompt.at : null, c?.prompt?.app)
  const ev = evs.ev
  if (m?.carry) return <CarryOn c={m.carry} />
  if (!c) return <Stopped m={m} />
  const r = c.recording
  const act = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false); m.refreshCalls() } }
  const notNow = () => {
    const at = c.prompt?.at
    goneRef.current = at
    setGone(at); setErr(null)
    api('/calls/dismiss', { method: 'POST' }).catch(() => {}).finally(() => m.refreshCalls())
  }
  const takeNotes = ({ fresh = false } = {}) => act(async () => {
    const at = c.prompt.at
    const id = await m.startForCall(c.prompt.app, evs.n > 1 ? ev : null, { fresh })
    if (goneRef.current === at) { await m.stop(); return }
    if (id) openMeeting(id)
  })
  const carryOn = () => act(async () => {
    const at = c.prompt.at
    const id = await m.recordAgain(c.carryOn.id)
    if (goneRef.current === at) { await m.stop(); return }
    if (id) openMeeting(id)
  })
  if (r?.callEnded && m.rec?.id === r.id) {
    const left = r.stopsAt ? Math.max(0, Math.round((new Date(r.stopsAt).getTime() - Date.now()) / 1000)) : null
    return (
      <div className="call-prompt" role="alertdialog" aria-label={r.endWhy === 'over' || r.endWhy === 'quiet' ? t('It went quiet') : t('The call ended')}>
        <span className="rec-dot" aria-hidden="true" />
        <span className="call-prompt-main"><b>{endedWords(r)}</b><small>{left != null ? t('Stop recording? It stops by itself in {time}.', { time: clock(left) }) : t('Stop recording?')}</small></span>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => act(() => m.stop())}><Icon name="stop" size={12} /> {t('Stop')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => act(() => api(`/meetings/${r.id}/keep`, { method: 'POST' }))}>{t('Keep recording')}</button>
        {err && <span className="error-text small">{err}</span>}
      </div>
    )
  }
  if (c.prompt && !m.rec && gone !== c.prompt.at && c.carryOn) {
    const what = c.prompt.browser ? t('A call in {app} started.', { app: c.prompt.app }) : t('{app} call started.', { app: c.prompt.app })
    return (
      <div className="call-prompt" role="alertdialog" aria-label={t('A call started')}>
        <Icon name="mic" size={15} />
        <span className="call-prompt-main"><b>{what}</b><small>{t('Recording of {title} stopped when Bridge AI closed at {time}. Carry on in that meeting, or start a new one?', { title: c.carryOn.title, time: stoppedAt(c.carryOn.at) })}</small></span>
        <VideoChoice m={m} />
        <button type="button" className="btn small primary" disabled={busy} onClick={carryOn}><Icon name="mic" size={12} /> {busy ? t('Starting…') : t('Resume recording')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => takeNotes({ fresh: true })}>{t('New meeting')}</button>
        <button type="button" className="ghost-btn" onClick={notNow}>{t('Not now')}</button>
        {err && <span className="error-text small">{err}</span>}
      </div>
    )
  }
  if (c.prompt && !m.rec && gone !== c.prompt.at) {
    const what = c.prompt.browser ? t('A call in {app} started.', { app: c.prompt.app }) : t('{app} call started.', { app: c.prompt.app })
    return (
      <div className="call-prompt" role="alertdialog" aria-label={t('A call started')}>
        <Icon name="mic" size={15} />
        <span className="call-prompt-main"><b>{what}</b><small>{ev ? t('Take notes for "{title}"?', { title: ev.title }) : t('Take notes?')} {t('Your mic and the call, transcribed as you go.')}</small></span>
        {/* More than one meeting on: which one the notes are for. */}
        <Among n={evs.n} i={evs.i} onStep={evs.step} disabled={busy} what={ev ? t('These notes are for {event}', { event: ev.title }) : null} />
        <VideoChoice m={m} />
        <button type="button" className="btn small primary" disabled={busy} onClick={() => takeNotes()}><Icon name="mic" size={12} /> {busy ? t('Starting…') : t('Take notes')}</button>
        <button type="button" className="ghost-btn" onClick={notNow}>{t('Not now')}</button>
        {err && <span className="error-text small">{err}</span>}
      </div>
    )
  }
  return <Stopped m={m} />
}
