import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useWidth } from './layout.jsx'
import { api, usePoll } from '../api.js'
import { CalendarSetup, joined } from './Agenda.jsx'
import { PrepCard, InviteFiles, usePrep } from './meetings/prep.jsx'
import AiAssist from './AiAssist.jsx'
import { openToday } from './today.js'
import { useOpenIn } from './openin.js'
import { t, tx, locale } from '../i18n/index.js'

// Day / week / month / year views over the Mac's Calendar (Exchange plus personal calendars), with
// Chief of Staff's tasks that name a day on the same days. Each calendar keeps its own colour
// (Calendar's, else one from its name, so it's the same every week), and a click on its key hides
// it or brings it back. The week starts on the day your language has it (or the one you pick), and
// the grids show your working hours at least, the rest shaded. Your answer to each invite shows as
// Calendar has it. An event's panel has the invite's files and links, the notes of a meeting already
// recorded, and AI Assist's Prepare for this meeting for one coming up. It's read-only: nothing here
// adds, moves, changes or answers an event; that stays in your calendar app, where Open in Calendar
// shows it (on this Mac).
const DAY = 864e5
const pad = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const weekOf = (d, ws) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() - ws + 7) % 7)); return x }
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const fmtT = (d) => new Date(d).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
const fmtH = (h) => new Date(2000, 0, 1, h % 24).toLocaleTimeString(locale(), { hour: 'numeric' })
const dur = (ms) => { const m = Math.round(ms / 6e4); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` }
// Weekday names in your language: 0 Sunday … 6 Saturday (7 January 2024 was a Sunday).
const wdName = (i, weekday = 'short') => new Date(2024, 0, 7 + i).toLocaleDateString(locale(), { weekday })
const weekend = (d) => d.getDay() % 6 === 0

// The day the week starts on where you are: the browser's region, as Intl says it (Sunday in the
// US, Monday in most of Europe), else Monday.
function localWeekStart() {
  try {
    const l = new Intl.Locale(navigator.language || 'en-US')
    const w = l.getWeekInfo?.() || l.weekInfo
    if (w?.firstDay) return w.firstDay % 7
    return /-(US|CA|MX|BR|JP|KR|IL|PH|IN|ZA|TW|HK)\b/i.test(navigator.language || '') ? 0 : 1
  } catch { return 1 }
}

function rangeFor(mode, anchor, ws) {
  if (mode === 'day') return [anchor, anchor]
  if (mode === 'week') { const s = weekOf(anchor, ws); return [s, addDays(s, 6)] }
  if (mode === 'month') {
    const s = weekOf(new Date(anchor.getFullYear(), anchor.getMonth(), 1), ws)
    return [s, addDays(s, 41)]
  }
  return [new Date(anchor.getFullYear(), 0, 1), new Date(anchor.getFullYear(), 11, 31)]
}

function step(mode, anchor, dir) {
  const d = new Date(anchor)
  if (mode === 'day') return addDays(d, dir)
  if (mode === 'week') return addDays(d, 7 * dir)
  if (mode === 'month') return new Date(d.getFullYear(), d.getMonth() + dir, 1)
  return new Date(d.getFullYear() + dir, 0, 1)
}

function title(mode, anchor, [from, to]) {
  if (mode === 'day') return anchor.toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' })
  if (mode === 'week') {
    const a = from.toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
    const b = to.toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })
    return `${a} – ${b}`
  }
  if (mode === 'month') return anchor.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
  return String(anchor.getFullYear())
}

// ---------- Colours ----------
// A calendar's colour: Calendar's own (bridgecal reads it), else one picked by its name, so it's the
// same in every week, month and view, on every device.
const PALETTE = ['#2f6fe0', '#0f9d8a', '#8b5cf6', '#d97706', '#db2777', '#64748b', '#16a34a', '#0891b2']
const hashOf = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h }
export const calColor = (name, color) => color || PALETTE[hashOf(name || 'Calendar') % PALETTE.length]
const calOf = (e) => e.calendar || 'Calendar'

// Events that touch a given day, clipped to it.
function eventsOn(events, day) {
  const s = startOfDay(day).getTime()
  const e = s + DAY
  return events.filter((x) => new Date(x.start) < e && new Date(x.end) > s)
}
const byTime = (a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : a.allDay ? -1 : 1)

// Side-by-side lanes for overlapping meetings.
function layoutDay(events, day) {
  const s0 = startOfDay(day).getTime()
  const items = events.filter((e) => !e.allDay).map((e) => ({ e, s: Math.max(new Date(e.start).getTime(), s0), t: Math.min(new Date(e.end).getTime(), s0 + DAY) }))
    .sort((a, b) => a.s - b.s || b.t - a.t)
  const out = []
  let cluster = []
  let clusterEnd = 0
  const flush = () => {
    const lanes = []
    for (const it of cluster) {
      let li = lanes.findIndex((end) => end <= it.s)
      if (li < 0) { li = lanes.length; lanes.push(0) }
      lanes[li] = it.t
      it.lane = li
    }
    for (const it of cluster) out.push({ ...it, lanes: lanes.length })
    cluster = []
  }
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.t)
  }
  if (cluster.length) flush()
  return out
}

function useNow(ms = 60000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id) }, [ms])
  return now
}

// How it's shown (server: calendar.js viewOf), the same on each of your devices. save(patch): shown
// at once, put back with why when it couldn't be kept. known: it has come (or couldn't be read, and
// the defaults stand).
const VIEW = { weekStart: null, workStart: 9, workEnd: 17, hidden: [], tasks: true }
function useView() {
  const { data, error: unread, refresh } = usePoll('/calendar/view', 10 * 60 * 1000)
  const [mine, setMine] = useState(null)
  const [error, setError] = useState(null)
  const v = { ...VIEW, ...(data || {}), ...(mine || {}) }
  const save = async (patch) => {
    setMine((m) => ({ ...(m || {}), ...patch }))
    setError(null)
    try { await api('/calendar/view', { method: 'PATCH', body: patch }); await refresh() } catch (x) { setError(x.message) }
    setMine(null)
  }
  return { view: { ...v, ws: v.weekStart ?? localWeekStart() }, save, error, known: !!data || !!unread }
}

// What a task says about when, and where it is.
const STATUS = { open: tx('To do'), doing: tx('Chief of Staff is on it'), waiting: tx('Waiting on you') }
const ANSWER = { accepted: tx('You accepted'), tentative: tx('You said maybe'), declined: tx('You declined'), none: tx('Not answered yet'), organizer: tx('You organised it') }
const ANSWER_ICON = { accepted: 'check', tentative: 'unknown', declined: 'x', none: 'clock', organizer: 'users' }

// ---------- A recorded meeting's notes ----------
function RecordedNotes({ id, onOpen }) {
  const { data, error } = usePoll(`/calendar/notes/${encodeURIComponent(id)}`, 5 * 60 * 1000)
  const open = (data?.items || []).filter((x) => !x.done)
  return (
    <div className="cal-sec">
      <h5><Icon name="record" size={11} /> {t('Your Notes')}</h5>
      {!data && !error && <div className="skeleton-rows"><div /></div>}
      {error && <p className="error-text small">{error}</p>}
      {data && (
        <>
          {data.summary.length > 0 ? <ul className="cal-bullets">{data.summary.map((x, i) => <li key={i}>{x}</li>)}</ul>
            : <p className="muted small">{data.status === 'recording' || data.status === 'paused' ? t('Recording now.') : t('Recorded, with no summary yet.')}</p>}
          {data.items.length > 0 && (
            <div className="cal-items">
              <span className="na-label">{open.length ? t('{n} of {all} action items still open', { n: open.length, all: data.items.length }) : t('Every action item is done')}</span>
              <ul>{data.items.slice(0, 6).map((x, i) => <li key={i} className={x.done ? 'done' : ''}><Icon name={x.done ? 'check' : 'clock'} size={10} /> {x.text}</li>)}</ul>
            </div>
          )}
          <div><button type="button" className="btn small" onClick={onOpen}><Icon name="external" size={12} /> {t('Open the notes')}</button></div>
        </>
      )}
    </div>
  )
}

// ---------- A task's panel ----------
function TaskDetail({ it, now, onClose }) {
  const due = parseDay(it.due)
  const late = due < startOfDay(new Date(now))
  const dayText = due.toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <div className="cal-detail" role="dialog" aria-label={it.title} style={{ '--c': 'var(--working)' }}>
      <div className="cal-detail-head">
        <span className="cal-detail-sw" aria-hidden="true" />
        <h4>{it.title}</h4>
        <button className="icon-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button>
      </div>
      <p className="cal-detail-when">{late ? t('Was due {date}', { date: dayText }) : t('Due {date}', { date: dayText })}</p>
      <p className="cal-detail-meta"><Icon name="helm" size={11} /> {t("Chief of Staff's task")} · {t(STATUS[it.status] || STATUS.open)}</p>
      {it.status === 'waiting' && it.needs && <p className="cal-note">{it.needs}</p>}
      <div className="cal-detail-actions">
        <button type="button" className="btn small" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: 'chief' } }))}><Icon name="helm" size={12} /> {t('Open Chief of Staff')}</button>
      </div>
      <p className="muted small">{t('On this day because the task names it ("by Friday", "on 12 Nov").')}</p>
    </div>
  )
}

// ---------- An event's panel ----------
function EventDetail({ e, color, now, onClose, onOpenAgent }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [opened, setOpened] = useState(null) // { text, bad }: what came of Open in Calendar
  // Open in Calendar: the event itself in Calendar on this Mac, to answer or change it there. Where
  // Calendar is, for an event with this Mac's id for it (bridgecal's; icalBuddy has none).
  const apps = useOpenIn()
  const openInCal = async () => {
    setOpened(null)
    try {
      await api('/calendar/open', { method: 'POST', body: { local: e.local, start: e.start, allDay: !!e.allDay, repeats: !!e.repeats } })
      setOpened({ text: t('Opening it in Calendar.') })
    } catch (x) { setOpened({ text: t("Couldn't open it in Calendar: {error}", { error: x.message }), bad: true }) }
  }
  const prep = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const out = await api('/calendar/prep', { method: 'POST', body: e })
      setMsg(t('Prep agent started in the Meetings space'))
      if (out.paneId && onOpenAgent) setTimeout(() => onOpenAgent(out.paneId), 1200)
    } catch (x) { setMsg(x.message) } finally { setBusy(false) }
  }
  const start = new Date(e.start)
  const past = Date.parse(e.end) <= now
  const others = e.attendeeCount > 1 || (e.attendees || []).length > 1
  const openMeeting = (id) => onOpenAgent?.(`view:meeting:${id}`)
  // AI Assist (at the right end of the event's buttons) for one coming up with other people: its
  // prep, with goals and questions from the model asked for now if there are none yet.
  const prepping = !past && !e.allDay && !e.canceled && others
  const p = usePrep(prepping ? e : null)
  const prepRef = useRef(null)
  const prepare = () => {
    prepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    if (p.data?.writer && !p.data.suggest?.items?.length && !p.data.making && !p.busy) p.suggest(false)
  }
  return (
    <div className="cal-detail" role="dialog" aria-label={e.title} style={{ '--c': color }}>
      <div className="cal-detail-head">
        <span className="cal-detail-sw" aria-hidden="true" />
        <h4>{e.title}</h4>
        <button className="icon-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button>
      </div>
      <p className="cal-detail-when">
        {start.toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })}
        {e.allDay ? ` · ${t('all day')}` : ` · ${fmtT(e.start)} – ${fmtT(e.end)} · ${dur(new Date(e.end) - start)}`}
      </p>
      <p className="cal-detail-meta">{[calOf(e), e.location, e.organizer && t('organised by {name}', { name: e.organizer })].filter(Boolean).join(' · ')}</p>
      {e.canceled && <p className="cal-answer declined"><Icon name="x" size={11} /> {t('Cancelled')}</p>}
      {!e.canceled && e.response && (
        <p className={`cal-answer ${e.response}`}>
          <Icon name={ANSWER_ICON[e.response]} size={11} /> {t(ANSWER[e.response])}
          {e.response !== 'organizer' && !past && <small>{t('Change it in your calendar app.')}</small>}
        </p>
      )}
      <div className="cal-detail-actions">
        {e.join && !past && <a className="join-btn strong" href={e.join} target="_blank" rel="noreferrer" onClick={() => joined(e)}><Icon name="video" size={12} /> {t('Join')}</a>}
        {!past && !e.allDay && <button className="btn small" onClick={prep} disabled={busy} title={t('An agent reads your mail with them, your notes and your tracker, and writes you a brief. It sends nothing.')}><Icon name="bot" size={12} /> {busy ? t('Starting…') : t('Prep with agent')}</button>}
        {apps.calendar && e.local && <button type="button" className="btn small cal-open-in" onClick={openInCal} title={t('Open it in Calendar on this Mac, to answer or change it there')}><Icon name="external" size={12} /> {t('Open in Calendar')}</button>}
        {prepping && <><span className="grow" /><AiAssist className="btn small cal-ai-btn" items={() => [{ label: t('Prepare for this meeting'), hint: t('Who\'s coming, last time with them, your mail with them, and goals and questions to go in with'), run: prepare }]} /></>}
      </div>
      {msg && <p className="small muted">{msg}</p>}
      {opened && <p className={`small ${opened.bad ? 'error-text' : 'muted'} cal-opened`} role={opened.bad ? 'alert' : 'status'}>{opened.text}</p>}
      {(e.agenda || e.links?.length > 0) && (
        <div className="cal-sec">
          <h5>{t('From the Invite')}</h5>
          <InviteFiles agenda={e.agenda} files={e.links} />
        </div>
      )}
      {e.recorded && <RecordedNotes id={e.recorded.id} onOpen={() => openMeeting(e.recorded.id)} />}
      {prepping && <div ref={prepRef}><PrepCard e={e} prep={p} invite={false} onOpenMeeting={openMeeting} onOpenMail={(id) => openToday('mail', { mailId: id })} /></div>}
      {e.attendees?.length > 0 && (
        <div className="cal-sec cal-detail-people">
          <h5>{e.attendeeCount === 1 ? t('1 Attendee') : t('{n} Attendees', { n: e.attendeeCount })}</h5>
          <p>{e.attendeeCount > e.attendees.length ? t('{names} and {n} more', { names: e.attendees.join(', '), n: e.attendeeCount - e.attendees.length }) : e.attendees.join(', ')}</p>
        </div>
      )}
    </div>
  )
}

// An event's look on any grid: its calendar's colour, and how you answered.
const evClass = (e, now) => [e.canceled ? 'cx' : '', e.response ? `ans-${e.response}` : '', Date.parse(e.end) < now ? 'past' : ''].filter(Boolean).join(' ')
const answerTip = (e) => (e.response && e.response !== 'accepted' && e.response !== 'organizer' ? `\n${t(ANSWER[e.response])}` : '')

// ---------- Time grid (day and week) ----------
const HOUR_PX = 44

function TimeGrid({ days, events, tasks, colors, now, view, selected, onSelect, compactCols }) {
  const scrollRef = useRef(null)
  const timed = events.filter((e) => !e.allDay)
  // Your working hours with an hour either side, widened to take in each meeting on these days: as
  // much of it as falls on them, so one that runs past midnight doesn't stretch the grid to every
  // hour. The time now never widens it.
  const starts = [], ends = []
  for (const d of days) {
    const s0 = startOfDay(d).getTime()
    for (const e of eventsOn(timed, d)) {
      starts.push(Math.floor((Math.max(Date.parse(e.start), s0) - s0) / 36e5))
      ends.push(Math.ceil((Math.min(Date.parse(e.end), s0 + DAY) - s0) / 36e5))
    }
  }
  const h0 = Math.max(0, Math.min(view.workStart - 1, ...starts))
  const h1 = Math.min(24, Math.max(view.workEnd + 1, ...ends))
  const today = days.find((d) => sameDay(d, new Date(now)))

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const n = new Date()
    el.scrollTop = today ? Math.max(0, (n.getHours() + n.getMinutes() / 60 - h0 - 1.5) * HOUR_PX) : Math.max(0, (view.workStart - h0 - 0.5) * HOUR_PX)
  }, [days[0]?.getTime(), h0]) // eslint-disable-line react-hooks/exhaustive-deps

  const allDay = days.map((d) => eventsOn(events.filter((e) => e.allDay), d))
  const dayTasks = days.map((d) => tasks.filter((x) => x.due === isoDay(d)))
  const hasAllDay = allDay.some((a) => a.length) || dayTasks.some((a) => a.length)
  const cols = `52px repeat(${days.length}, minmax(${compactCols ? 0 : 80}px, 1fr))`
  const workTop = (view.workStart - h0) * HOUR_PX
  const workBottom = (view.workEnd - h0) * HOUR_PX
  return (
    <div className="tg">
      <div className="tg-head" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((d) => (
          <span key={d.getTime()} className={`tg-day ${sameDay(d, new Date(now)) ? 'today' : ''} ${weekend(d) ? 'wkend' : ''}`}>
            <small>{wdName(d.getDay())}</small><b>{d.getDate()}</b>
          </span>
        ))}
        {hasAllDay && <span className="tg-allday-label">{t('all day')}</span>}
        {hasAllDay && days.map((d, i) => (
          <span key={i} className="tg-allday">
            {allDay[i].map((e) => <button key={e.id} className={`tg-chip ${evClass(e, now)} ${selected?.id === e.id ? 'sel' : ''}`} style={{ '--c': colors[calOf(e)] }} onClick={() => onSelect(e)} title={`${e.title}${answerTip(e)}`}>{e.title}</button>)}
            {dayTasks[i].map((x) => <button key={x.id} className={`tg-chip task ${x.due < isoDay(new Date(now)) ? 'late' : ''} ${selected?.id === x.id ? 'sel' : ''}`} onClick={() => onSelect(x)} title={t("Chief of Staff's task")}><Icon name="helm" size={10} />{x.title}</button>)}
          </span>
        ))}
      </div>
      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ gridTemplateColumns: cols, height: (h1 - h0) * HOUR_PX }}>
          <div className="tg-hours">
            {Array.from({ length: h1 - h0 }, (_, i) => <span key={i} style={{ top: i * HOUR_PX }}>{i ? fmtH(h0 + i) : ''}</span>)}
          </div>
          {days.map((d) => {
            const isToday = sameDay(d, new Date(now))
            const base = startOfDay(d).getTime() + h0 * 36e5
            return (
              <div key={d.getTime()} className={`tg-col ${isToday ? 'today' : ''} ${weekend(d) ? 'wkend' : ''}`}>
                {!weekend(d) && workTop > 0 && <span className="tg-off" style={{ top: 0, height: workTop }} />}
                {!weekend(d) && workBottom < (h1 - h0) * HOUR_PX && <span className="tg-off" style={{ top: workBottom, bottom: 0 }} />}
                {Array.from({ length: h1 - h0 }, (_, i) => <span key={i} className="tg-line" style={{ top: i * HOUR_PX }} />)}
                {layoutDay(eventsOn(timed, d), d).map(({ e, s, t: end, lane, lanes }) => {
                  const top = ((s - base) / 36e5) * HOUR_PX
                  const h = Math.max(18, ((end - s) / 36e5) * HOUR_PX - 2)
                  const live = s <= now && end > now
                  return (
                    <button key={e.id} className={`tg-ev ${evClass(e, now)} ${live ? 'live' : ''} ${selected?.id === e.id ? 'sel' : ''} ${h < 34 ? 'short' : ''}`}
                      style={{ top, height: h, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, '--c': colors[calOf(e)], '--lines': Math.max(1, Math.floor((h - 20) / 14)) }}
                      onClick={() => onSelect(e)} title={`${e.title}\n${fmtT(e.start)} – ${fmtT(e.end)}${answerTip(e)}`}>
                      <b>{e.title}</b>
                      {h >= 34 && <span>{fmtT(e.start)}{e.join ? ` · ${t('online')}` : ''}</span>}
                      {e.recorded && <i className="tg-rec" aria-label={t('Recorded')} />}
                    </button>
                  )
                })}
                {isToday && now >= base && now <= base + (h1 - h0) * 36e5 && <span className="tg-now" style={{ top: ((now - base) / 36e5) * HOUR_PX }} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------- Agenda list (week on narrow screens) ----------
function AgendaList({ days, events, tasks, colors, now, onSelect }) {
  const ref = useRef(null)
  const loaded = events.length > 0
  useEffect(() => {
    const el = ref.current?.querySelector('.cal-agenda-day.today')
    if (el) el.scrollIntoView({ block: 'start' })
  }, [days[0]?.getTime(), loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cal-agenda" ref={ref}>
      {days.map((d) => {
        const list = eventsOn(events, d).sort(byTime)
        const todo = tasks.filter((x) => x.due === isoDay(d))
        const isToday = sameDay(d, new Date(now))
        const n = list.filter((e) => !e.allDay && !e.canceled).length
        return (
          <section key={d.getTime()} className={`cal-agenda-day ${isToday ? 'today' : ''}`}>
            <h5><b>{wdName(d.getDay())}</b> {d.toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}{isToday && <span className="live-pill">{t('Today')}</span>}<span className="muted">{n ? (n === 1 ? t('1 meeting') : t('{n} meetings', { n })) : ''}</span></h5>
            {!list.length && !todo.length && <p className="muted small">{t('Nothing scheduled')}</p>}
            {list.map((e) => (
              <button key={e.id} className={`cal-agenda-ev ${evClass(e, now)}`} style={{ '--c': colors[calOf(e)] }} onClick={() => onSelect(e)}>
                <span className="cal-agenda-time">{e.allDay ? t('All day') : fmtT(e.start)}</span>
                <span className="cal-agenda-title" title={e.title}>{e.title}</span>
                <span className="cal-agenda-marks">{e.recorded && <i className="tg-rec" aria-label={t('Recorded')} />}{e.join && <Icon name="video" size={11} />}</span>
              </button>
            ))}
            {todo.map((x) => (
              <button key={x.id} className="cal-agenda-ev task" onClick={() => onSelect(x)}>
                <span className="cal-agenda-time"><Icon name="helm" size={11} /> {t('Task')}</span>
                <span className="cal-agenda-title" title={x.title}>{x.title}</span>
                <span />
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

// ---------- Month ----------
function MonthGrid({ anchor, from, events, tasks, colors, now, ws, onDay, onSelect, compact }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i))
  const rows = days[35].getMonth() !== anchor.getMonth() ? 5 : 6
  const max = compact ? 0 : 3
  const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7)
  return (
    <div className="mg">
      <div className="mg-head">{order.map((w) => <span key={w}>{wdName(w, compact ? 'narrow' : 'short')}</span>)}</div>
      <div className="mg-grid" style={{ gridTemplateRows: `repeat(${rows}, minmax(${compact ? 44 : 96}px, 1fr))` }}>
        {days.slice(0, rows * 7).map((d) => {
          const list = [...eventsOn(events, d).sort(byTime), ...tasks.filter((x) => x.due === isoDay(d))]
          const timed = list.filter((e) => e.kind !== 'task' && !e.allDay)
          const out = d.getMonth() !== anchor.getMonth()
          const isToday = sameDay(d, new Date(now))
          const label = t('Open {date}', { date: d.toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' }) })
          return (
            <div key={d.getTime()} className={`mg-cell ${out ? 'out' : ''} ${isToday ? 'today' : ''} ${weekend(d) ? 'wkend' : ''}`}>
              {/* A narrow month: the whole day is one button, its number and a dot for each meeting. */}
              {compact
                ? (
                  <button className="mg-tap" onClick={() => onDay(d)} aria-label={label}>
                    <span className="mg-num">{d.getDate()}</span>
                    <span className="mg-dots">{timed.slice(0, 4).map((e) => <i key={e.id} style={{ background: colors[calOf(e)] }} />)}{list.some((x) => x.kind === 'task') && <i className="task" />}{timed.length > 4 && <small>+</small>}</span>
                  </button>
                )
                : (
                  <>
                    <button className="mg-num" onClick={() => onDay(d)} aria-label={label}>{d.getDate()}</button>
                    {list.slice(0, max).map((e) => (e.kind === 'task'
                      ? <button key={e.id} className="mg-ev task" onClick={() => onSelect(e)} title={e.title}><Icon name="helm" size={10} />{e.title}</button>
                      : (
                        <button key={e.id} className={`mg-ev ${evClass(e, now)} ${e.allDay ? 'all' : ''}`} style={{ '--c': colors[calOf(e)] }} onClick={() => onSelect(e)} title={`${e.title}${answerTip(e)}`}>
                          {!e.allDay && <span>{fmtT(e.start)}</span>}{e.title}
                        </button>
                      )))}
                    {list.length > max && <button className="mg-more" onClick={() => onDay(d)}>{t('{n} more', { n: list.length - max })}</button>}
                  </>
                )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Year ----------
function YearGrid({ year, events, now, ws, onDay, cols }) {
  // Booked hours per day (overlaps counted once), leaving out what you declined.
  const load = useMemo(() => {
    const m = {}
    const byDay = {}
    for (const e of events) {
      if (e.allDay || e.canceled || e.response === 'declined') continue
      const s = new Date(e.start).getTime()
      const t = new Date(e.end).getTime()
      // Blocks of 10h+ are travel or out-of-office holds, not meetings.
      if (t - s >= 10 * 36e5) continue
      const k = isoDay(new Date(e.start))
      const dayEnd = startOfDay(new Date(e.start)).getTime() + DAY
      ;(byDay[k] ||= []).push([s, Math.min(t, dayEnd)])
    }
    for (const [k, spans] of Object.entries(byDay)) {
      spans.sort((a, b) => a[0] - b[0])
      let total = 0, cur = null
      for (const s of spans) {
        if (!cur || s[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [...s] } else cur[1] = Math.max(cur[1], s[1])
      }
      if (cur) total += cur[1] - cur[0]
      m[k] = { hours: total / 36e5, count: spans.length }
    }
    return m
  }, [events])
  const level = (h) => (!h ? 0 : h < 1.5 ? 1 : h < 3 ? 2 : h < 5 ? 3 : 4)
  const stats = useMemo(() => {
    const vals = Object.entries(load)
    const hours = vals.reduce((s, [, v]) => s + v.hours, 0)
    const count = vals.reduce((s, [, v]) => s + v.count, 0)
    const wd = Array(7).fill(0)
    for (const [k, v] of vals) wd[parseDay(k).getDay()] += v.hours
    const busiest = wd.indexOf(Math.max(...wd))
    const top = vals.sort((a, b) => b[1].hours - a[1].hours)[0]
    return { hours, count, busiest: wdName(busiest, 'long'), top }
  }, [load])
  const today = new Date(now)
  const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7)
  return (
    <div className="yg">
      <div className="yg-stats">
        <div><b>{stats.count.toLocaleString(locale())}</b><span>{t('meetings')}</span></div>
        <div><b>{Math.round(stats.hours).toLocaleString(locale())}h</b><span>{t('booked')}</span></div>
        <div><b>{stats.busiest}</b><span>{t('busiest weekday')}</span></div>
        {stats.top && <div><b>{parseDay(stats.top[0]).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}</b><span>{t('heaviest day · {hours}h', { hours: stats.top[1].hours.toFixed(1) })}</span></div>}
      </div>
      <div className="yg-months" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: 12 }, (_, mi) => {
          const first = new Date(year, mi, 1)
          const lead = (first.getDay() - ws + 7) % 7
          const n = new Date(year, mi + 1, 0).getDate()
          const monthHours = Array.from({ length: n }, (_, i) => load[isoDay(new Date(year, mi, i + 1))]?.hours || 0).reduce((a, b) => a + b, 0)
          return (
            <div key={mi} className="yg-month">
              <h5>{first.toLocaleDateString(locale(), { month: 'long' })}<span>{monthHours ? `${Math.round(monthHours)}h` : ''}</span></h5>
              <div className="yg-days">
                {order.map((w) => <span key={w} className="yg-wd">{wdName(w, 'narrow')}</span>)}
                {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
                {Array.from({ length: n }, (_, i) => {
                  const d = new Date(year, mi, i + 1)
                  const v = load[isoDay(d)]
                  const when = d.toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })
                  return (
                    <button key={i} className={`yg-day l${level(v?.hours)} ${sameDay(d, today) ? 'today' : ''} ${d < startOfDay(today) ? 'past' : ''}`}
                      onClick={() => onDay(d)} title={v ? (v.count === 1 ? t('{date} · 1 meeting, {hours}h', { date: when, hours: v.hours.toFixed(1) }) : t('{date} · {n} meetings, {hours}h', { date: when, n: v.count, hours: v.hours.toFixed(1) })) : when}>{i + 1}</button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="yg-legend"><span>{t('Less')}</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`yg-day l${l}`} />)}<span>{t('More booked')}</span></div>
    </div>
  )
}

// ---------- How it's shown ----------
function ViewMenu({ view, save, error, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.calv-view-btn')) onClose() }
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc) }
  }, [onClose])
  const local = wdName(localWeekStart(), 'long')
  const hours = Array.from({ length: 25 }, (_, h) => h)
  return (
    <div className="calv-menu" ref={ref} role="dialog" aria-label={t('Week start and working hours')}>
      <label className="calv-menu-row"><span>{t('Week starts on')}</span>
        <select value={view.weekStart ?? 'auto'} onChange={(e) => save({ weekStart: e.target.value === 'auto' ? null : Number(e.target.value) })} aria-label={t('Week starts on')}>
          <option value="auto">{t('As your region has it ({day})', { day: local })}</option>
          {[1, 0, 6].map((d) => <option key={d} value={d}>{wdName(d, 'long')}</option>)}
        </select>
      </label>
      <div className="calv-menu-row"><span>{t('Working hours')}</span>
        <span className="calv-hours">
          <select value={view.workStart} onChange={(e) => save({ workStart: Number(e.target.value), workEnd: Math.max(view.workEnd, Number(e.target.value) + 1) })} aria-label={t('Working hours start')}>
            {hours.slice(0, 24).map((h) => <option key={h} value={h}>{fmtH(h)}</option>)}
          </select>
          <span className="muted">{t('to')}</span>
          <select value={view.workEnd} onChange={(e) => save({ workEnd: Number(e.target.value), workStart: Math.min(view.workStart, Number(e.target.value) - 1) })} aria-label={t('Working hours end')}>
            {hours.slice(1).map((h) => <option key={h} value={h}>{h === 24 ? t('Midnight') : fmtH(h)}</option>)}
          </select>
        </span>
      </div>
      <label className="calv-menu-check">
        <input type="checkbox" checked={view.tasks} onChange={(e) => save({ tasks: e.target.checked })} />
        <span>{t("Chief of Staff's tasks that name a day")}</span>
      </label>
      <p className="muted small">{t('The same on each of your devices. Bridge AI only reads your calendars: add, move or answer events in your calendar app.')}</p>
      {error && <p className="error-text small">{t("Couldn't keep that: {error}", { error })}</p>}
    </div>
  )
}

// ---------- The view ----------
export default function CalendarView({ onOpenAgent, focus }) {
  const [mode, setMode] = usePersisted('cc-cal-mode', 'week')
  const [anchorIso, setAnchorIso] = useState(isoDay(new Date()))
  const [selected, setSelected] = useState(null)
  const [menu, setMenu] = useState(false)
  const [seen, setSeen] = usePersisted('cc-cal-colors', {}) // calendar -> colour, for one hidden this week
  const [ref, width] = useWidth()
  const now = useNow()
  const { view, save, error: viewError, known } = useView()
  const anchor = parseDay(anchorIso)
  const range = rangeFor(mode, anchor, view.ws)
  const from = isoDay(range[0]), to = isoDay(range[1])
  // The days are read once how it's shown is known: before, the week was drawn as the browser's
  // language starts it, then the day you set it to start on, its events gone in between, and
  // hidden calendars showed for a moment.
  const { data, error, errorCode, loading, refresh } = usePoll(known ? `/calendar/range?from=${from}&to=${to}` : null, 5 * 60 * 1000)
  const { data: taskData } = usePoll(known && view.tasks && mode !== 'year' ? `/calendar/tasks?from=${from}&to=${to}` : null, 2 * 60 * 1000)
  const all = useMemo(() => (data?.from === from ? data.events : []), [data, from])
  const tasks = useMemo(() => (view.tasks && mode !== 'year' ? (taskData?.tasks || []).map((x) => ({ ...x, kind: 'task', id: `task:${x.id}` })) : []), [taskData, view.tasks, mode])
  const hidden = useMemo(() => new Set(view.hidden), [view.hidden.join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps
  const events = useMemo(() => all.filter((e) => !hidden.has(calOf(e))), [all, hidden])
  // Every calendar in view or hidden, each with its colour, by name.
  const colors = useMemo(() => {
    const m = {}
    for (const e of all) if (!(calOf(e) in m) || (!m[calOf(e)] && e.color)) m[calOf(e)] = calColor(calOf(e), e.color)
    for (const k of view.hidden) if (!(k in m)) m[k] = calColor(k, seen[k])
    return m
  }, [all, view.hidden, seen])
  useEffect(() => {
    const fresh = Object.fromEntries(all.filter((e) => e.color && seen[calOf(e)] !== e.color).map((e) => [calOf(e), e.color]))
    if (Object.keys(fresh).length) setSeen({ ...seen, ...fresh })
  }, [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const narrow = width > 0 && width < 620

  // Opened at a day, and an event on it (the floating card, Home): the event once it's loaded, kept
  // open as the view moves to its day.
  const want = useRef(null)
  const keep = useRef(false)
  useEffect(() => {
    if (!focus?.date) return
    want.current = focus.event
    keep.current = focus.date !== anchorIso || mode !== 'day'
    setAnchorIso(focus.date)
    setMode('day')
  }, [focus?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!want.current || !all.length) return
    const e = all.find((x) => x.id === want.current || x.uid === want.current)
    if (e) { setSelected(e); want.current = null }
  }, [all, focus?.at])
  useEffect(() => { if (keep.current) keep.current = false; else setSelected(null) }, [anchorIso, mode])
  useEffect(() => {
    const k = (e) => {
      if (e.target.closest?.('input, textarea, select, .xterm, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') setAnchorIso((a) => isoDay(step(mode, parseDay(a), -1)))
      else if (e.key === 'ArrowRight') setAnchorIso((a) => isoDay(step(mode, parseDay(a), 1)))
      else if (e.key === 't') setAnchorIso(isoDay(new Date()))
      else if ({ d: 1, w: 1, m: 1, y: 1 }[e.key]) setMode({ d: 'day', w: 'week', m: 'month', y: 'year' }[e.key])
      else if (e.key === 'Escape') setSelected(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [mode])

  const goDay = (d) => { setAnchorIso(isoDay(d)); setMode('day') }
  const days = mode === 'day' ? [anchor] : mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(range[0], i)) : []
  const inView = mode === 'month' ? (e) => new Date(e.start).getMonth() === anchor.getMonth() : () => true
  const timed = events.filter((e) => !e.allDay && !e.canceled && e.response !== 'declined' && inView(e))
  const booked = timed.reduce((s, e) => s + (new Date(e.end) - new Date(e.start)), 0)
  const isNow = mode === 'year' ? anchor.getFullYear() === new Date().getFullYear() : now >= range[0].getTime() && now < addDays(range[1], 1).getTime()
  const toggle = (name) => save({ hidden: hidden.has(name) ? view.hidden.filter((x) => x !== name) : [...view.hidden, name] })
  const names = Object.keys(colors).sort((a, b) => a.localeCompare(b))
  const sel = selected && (selected.kind === 'task' ? tasks.find((x) => x.id === selected.id) || selected : selected)
  const detail = sel && (sel.kind === 'task'
    ? <TaskDetail it={sel} now={now} onClose={() => setSelected(null)} />
    : <EventDetail key={sel.id} e={sel} color={colors[calOf(sel)] || calColor(calOf(sel), sel.color)} now={now} onClose={() => setSelected(null)} onOpenAgent={onOpenAgent} />)
  const grid = { events, tasks, colors, now, onSelect: setSelected }

  return (
    <div className="calv" ref={ref}>
      <div className="calv-bar">
        <div className="calv-nav">
          <button className="icon-btn" onClick={() => setAnchorIso(isoDay(step(mode, anchor, -1)))} aria-label={t('Previous')} title={t('Previous (←)')}><Icon name="chevron" size={13} className="rot180" /></button>
          <button className={`btn small ${isNow ? 'is-now' : ''}`} onClick={() => setAnchorIso(isoDay(new Date()))} title={t('Today (T)')}>{t('Today')}</button>
          <button className="icon-btn" onClick={() => setAnchorIso(isoDay(step(mode, anchor, 1)))} aria-label={t('Next')} title={t('Next (→)')}><Icon name="chevron" size={13} /></button>
          <h3>{title(mode, anchor, range)}</h3>
          {mode !== 'year' && data && <span className="calv-sum">{timed.length === 1 ? t('1 meeting · {time}', { time: dur(booked) }) : t('{n} meetings · {time}', { n: timed.length, time: dur(booked) })}</span>}
          {loading && <span className="calv-sum">{t('Loading…')}</span>}
        </div>
        <div className="calv-tools">
          <div className="seg" role="tablist" aria-label={t('Calendar view')}>
            {[['day', 'D', t('Day')], ['week', 'W', t('Week')], ['month', 'M', t('Month')], ['year', 'Y', t('Year')]].map(([m, k, l]) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} title={`${l} (${k})`}>{narrow ? l[0] : l}</button>
            ))}
          </div>
          <button className={`icon-btn calv-view-btn ${menu ? 'on' : ''}`} onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={t('Week start and working hours')} title={t('Week start and working hours')}><Icon name="settings" size={13} /></button>
          <button className="icon-btn" onClick={() => refresh('&refresh=1')} aria-label={t('Refresh')} title={t('Refresh')}><Icon name="refresh" size={13} /></button>
            </div>
        {menu && <ViewMenu view={view} save={save} error={viewError} onClose={() => setMenu(false)} />}
      </div>
      {error && <div className="pad"><CalendarSetup error={error} code={errorCode} onCheck={() => refresh('&refresh=1')} /></div>}
      <div className={`calv-body ${sel && !narrow ? 'with-detail' : ''}`}>
        <div className="calv-main">
          {mode === 'day' && <TimeGrid days={days} {...grid} view={view} selected={sel} compactCols />}
          {mode === 'week' && (narrow
            ? <AgendaList days={days} {...grid} />
            : <TimeGrid days={days} {...grid} view={view} selected={sel} compactCols={width < 900} />)}
          {mode === 'month' && <MonthGrid anchor={anchor} from={range[0]} {...grid} ws={view.ws} onDay={goDay} compact={narrow} />}
          {mode === 'year' && <YearGrid year={anchor.getFullYear()} events={events} now={now} ws={view.ws} onDay={goDay} cols={width < 520 ? 2 : width < 900 ? 3 : width < 1250 ? 4 : 6} />}
          {(names.length > 0 || tasks.length > 0 || !view.tasks) && mode !== 'year' && (
            <div className="cal-legend" role="group" aria-label={t('Calendars')}>
              {names.map((k) => (
                <button key={k} type="button" className={`cal-key ${hidden.has(k) ? 'off' : ''}`} style={{ '--c': colors[k] }} aria-pressed={!hidden.has(k)} onClick={() => toggle(k)} title={hidden.has(k) ? t('Show {name}', { name: k }) : t('Hide {name}', { name: k })}>
                  <i aria-hidden="true" />{k}
                </button>
              ))}
              {(tasks.length > 0 || !view.tasks) && (
                <button type="button" className={`cal-key task ${view.tasks ? '' : 'off'}`} aria-pressed={view.tasks} onClick={() => save({ tasks: !view.tasks })} title={view.tasks ? t("Hide Chief of Staff's tasks") : t("Show Chief of Staff's tasks")}>
                  <Icon name="helm" size={11} />{t("Chief of Staff's tasks")}
                </button>
              )}
              {viewError && <span className="error-text small">{t("Couldn't keep that: {error}", { error: viewError })}</span>}
            </div>
          )}
        </div>
        {detail && (narrow
          ? <div className="modal-backdrop" onMouseDown={(x) => { if (x.target === x.currentTarget) setSelected(null) }}><div className="modal cal-sheet">{detail}</div></div>
          : detail)}
      </div>
    </div>
  )
}
