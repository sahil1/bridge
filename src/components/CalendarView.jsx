import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useWidth } from './layout.jsx'
import { api, usePoll } from '../api.js'
import { CalendarSetup } from './Agenda.jsx'

// Day / week / month / year views over the Mac's Calendar (Exchange plus personal calendars).
const DAY = 864e5
const pad = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const monday = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const fmtT = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const fmtH = (h) => (h === 0 || h === 24 ? '12 AM' : h === 12 ? 'Noon' : h < 12 ? `${h} AM` : `${h - 12} PM`)
const dur = (ms) => { const m = Math.round(ms / 6e4); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` }
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function rangeFor(mode, anchor) {
  if (mode === 'day') return [anchor, anchor]
  if (mode === 'week') { const s = monday(anchor); return [s, addDays(s, 6)] }
  if (mode === 'month') {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const s = monday(first)
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
  if (mode === 'day') return anchor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  if (mode === 'week') {
    const a = from.toLocaleDateString([], { month: 'short', day: 'numeric' })
    const b = to.toLocaleDateString([], from.getMonth() === to.getMonth() ? { day: 'numeric' } : { month: 'short', day: 'numeric' })
    return `${a} – ${b}, ${to.getFullYear()}`
  }
  if (mode === 'month') return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
  return String(anchor.getFullYear())
}

// Calendars get colors in a fixed order by first appearance, so a calendar keeps its color.
const HUES = ['var(--accent)', '#0f9d8a', '#8b5cf6', '#d97706', '#db2777', '#64748b']
function useCalColors(events) {
  return useMemo(() => {
    const map = {}
    for (const e of events) { const k = e.calendar || 'Calendar'; if (!(k in map)) map[k] = HUES[Object.keys(map).length % HUES.length] }
    return map
  }, [events])
}

// Events that touch a given day, clipped to it.
function eventsOn(events, day) {
  const s = startOfDay(day).getTime()
  const e = s + DAY
  return events.filter((x) => new Date(x.start) < e && new Date(x.end) > s)
}

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

// ---------- Event details ----------
function EventDetail({ e, onClose, onOpenAgent }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const prep = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const out = await api('/calendar/prep', { method: 'POST', body: e })
      setMsg('Prep agent started in the Meetings space')
      if (out.paneId && onOpenAgent) setTimeout(() => onOpenAgent(out.paneId), 1200)
    } catch (x) { setMsg(x.message) } finally { setBusy(false) }
  }
  const start = new Date(e.start)
  return (
    <div className="cal-detail" role="dialog" aria-label={e.title}>
      <div className="cal-detail-head">
        <h4>{e.title}</h4>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={13} /></button>
      </div>
      <p className="cal-detail-when">
        {start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
        {e.allDay ? ' · all day' : ` · ${fmtT(e.start)} – ${fmtT(e.end)} · ${dur(new Date(e.end) - start)}`}
      </p>
      {(e.calendar || e.location) && <p className="muted small">{[e.calendar, e.location].filter(Boolean).join(' · ')}</p>}
      <div className="cal-detail-actions">
        {e.join && <a className="join-btn strong" href={e.join} target="_blank" rel="noreferrer"><Icon name="video" size={12} /> Join</a>}
        <button className="btn small" onClick={prep} disabled={busy}><Icon name="sparkle" size={12} /> {busy ? 'Starting…' : 'Prep with agent'}</button>
      </div>
      {msg && <p className="small muted">{msg}</p>}
      {e.agenda && <p className="cal-detail-agenda">{e.agenda}</p>}
      {e.attendees?.length > 0 && (
        <div className="cal-detail-people">
          <span className="na-label"><Icon name="users" size={11} /> {e.attendeeCount} attendee{e.attendeeCount === 1 ? '' : 's'}</span>
          <p>{e.attendees.join(', ')}{e.attendeeCount > e.attendees.length ? ` and ${e.attendeeCount - e.attendees.length} more` : ''}</p>
        </div>
      )}
    </div>
  )
}

// ---------- Time grid (day and week) ----------
const HOUR_PX = 44

function TimeGrid({ days, events, colors, now, selected, onSelect, compactCols }) {
  const scrollRef = useRef(null)
  const timed = events.filter((e) => !e.allDay)
  // Show the hours that have meetings, at least 8 AM to 6 PM.
  const hours = timed.flatMap((e) => {
    const s = new Date(e.start), t = new Date(e.end)
    return [s.getHours(), t.getHours() + (t.getMinutes() ? 1 : 0) || 24]
  })
  const h0 = Math.max(0, Math.min(8, ...hours))
  const h1 = Math.min(24, Math.max(18, ...hours))
  const today = days.find((d) => sameDay(d, new Date(now)))

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const n = new Date()
    const target = today ? Math.max(0, (n.getHours() + n.getMinutes() / 60 - h0 - 1.5) * HOUR_PX) : 0
    el.scrollTop = target
  }, [days[0]?.getTime(), h0]) // eslint-disable-line react-hooks/exhaustive-deps

  const allDay = days.map((d) => eventsOn(events.filter((e) => e.allDay), d))
  const hasAllDay = allDay.some((a) => a.length)
  const cols = `52px repeat(${days.length}, minmax(${compactCols ? 0 : 80}px, 1fr))`
  return (
    <div className="tg">
      <div className="tg-head" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((d) => (
          <span key={d.getTime()} className={`tg-day ${sameDay(d, new Date(now)) ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'wkend' : ''}`}>
            <small>{WD[(d.getDay() + 6) % 7]}</small><b>{d.getDate()}</b>
          </span>
        ))}
        {hasAllDay && <span className="tg-allday-label">all-day</span>}
        {hasAllDay && allDay.map((list, i) => (
          <span key={i} className="tg-allday">
            {list.map((e) => <button key={e.id} className="tg-chip" style={{ '--c': colors[e.calendar || 'Calendar'] }} onClick={() => onSelect(e)}>{e.title}</button>)}
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
              <div key={d.getTime()} className={`tg-col ${isToday ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'wkend' : ''}`}>
                {Array.from({ length: h1 - h0 }, (_, i) => <span key={i} className="tg-line" style={{ top: i * HOUR_PX }} />)}
                {layoutDay(eventsOn(timed, d), d).map(({ e, s, t, lane, lanes }) => {
                  const top = ((s - base) / 36e5) * HOUR_PX
                  const h = Math.max(18, ((t - s) / 36e5) * HOUR_PX - 2)
                  const past = t < now
                  const live = s <= now && t > now
                  return (
                    <button key={e.id} className={`tg-ev ${e.canceled ? 'cx' : ''} ${past ? 'past' : ''} ${live ? 'live' : ''} ${selected?.id === e.id ? 'sel' : ''} ${h < 34 ? 'short' : ''}`}
                      style={{ top, height: h, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, '--c': colors[e.calendar || 'Calendar'], '--lines': Math.max(1, Math.floor((h - 20) / 14)) }}
                      onClick={() => onSelect(e)} title={`${e.title}\n${fmtT(e.start)} – ${fmtT(e.end)}`}>
                      <b>{e.title}</b>
                      {h >= 34 && <span>{fmtT(e.start)}{e.join ? ' · online' : ''}</span>}
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
function AgendaList({ days, events, colors, now, onSelect }) {
  const ref = useRef(null)
  const loaded = events.length > 0
  useEffect(() => {
    const el = ref.current?.querySelector('.cal-agenda-day.today')
    if (el) el.scrollIntoView({ block: 'start' })
  }, [days[0]?.getTime(), loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cal-agenda" ref={ref}>
      {days.map((d) => {
        const list = eventsOn(events, d).sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : a.allDay ? -1 : 1))
        const isToday = sameDay(d, new Date(now))
        return (
          <section key={d.getTime()} className={`cal-agenda-day ${isToday ? 'today' : ''}`}>
            <h5><b>{d.toLocaleDateString([], { weekday: 'short' })}</b> {d.toLocaleDateString([], { month: 'short', day: 'numeric' })}{isToday && <span className="live-pill">Today</span>}<span className="muted">{list.filter((e) => !e.allDay).length || ''}</span></h5>
            {!list.length && <p className="muted small">Nothing scheduled</p>}
            {list.map((e) => (
              <button key={e.id} className={`cal-agenda-ev ${e.canceled ? 'cx' : ''} ${new Date(e.end) < now ? 'past' : ''}`} style={{ '--c': colors[e.calendar || 'Calendar'] }} onClick={() => onSelect(e)}>
                <span className="cal-agenda-time">{e.allDay ? 'All day' : fmtT(e.start)}</span>
                <span className="cal-agenda-title">{e.title}</span>
                {e.join && <Icon name="video" size={11} />}
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

// ---------- Month ----------
function MonthGrid({ anchor, from, events, colors, now, onDay, onSelect, compact }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i))
  const rows = days[35].getMonth() !== anchor.getMonth() ? 5 : 6
  const max = compact ? 0 : 3
  return (
    <div className="mg">
      <div className="mg-head">{WD.map((w) => <span key={w}>{compact ? w[0] : w}</span>)}</div>
      <div className="mg-grid" style={{ gridTemplateRows: `repeat(${rows}, minmax(${compact ? 44 : 96}px, 1fr))` }}>
        {days.slice(0, rows * 7).map((d) => {
          const list = eventsOn(events, d).sort((a, b) => (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : a.allDay ? -1 : 1))
          const timed = list.filter((e) => !e.allDay)
          const out = d.getMonth() !== anchor.getMonth()
          const isToday = sameDay(d, new Date(now))
          return (
            <div key={d.getTime()} className={`mg-cell ${out ? 'out' : ''} ${isToday ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'wkend' : ''}`}>
              <button className="mg-num" onClick={() => onDay(d)} aria-label={`Open ${d.toDateString()}`}>{d.getDate()}</button>
              {compact
                ? timed.length > 0 && <button className="mg-dots" onClick={() => onDay(d)}>{timed.slice(0, 4).map((e) => <i key={e.id} style={{ background: colors[e.calendar || 'Calendar'] }} />)}{timed.length > 4 && <small>+</small>}</button>
                : (
                  <>
                    {list.slice(0, max).map((e) => (
                      <button key={e.id} className={`mg-ev ${e.canceled ? 'cx' : ''} ${e.allDay ? 'all' : ''} ${new Date(e.end) < now ? 'past' : ''}`} style={{ '--c': colors[e.calendar || 'Calendar'] }} onClick={() => onSelect(e)} title={e.title}>
                        {!e.allDay && <span>{fmtT(e.start).replace(':00', '').replace(' ', '').toLowerCase()}</span>}{e.title}
                      </button>
                    ))}
                    {list.length > max && <button className="mg-more" onClick={() => onDay(d)}>{list.length - max} more</button>}
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
function YearGrid({ year, events, now, onDay, cols }) {
  // Booked hours per day (overlaps counted once).
  const load = useMemo(() => {
    const m = {}
    const byDay = {}
    for (const e of events) {
      if (e.allDay || e.canceled) continue
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
    for (const [k, v] of vals) wd[(parseDay(k).getDay() + 6) % 7] += v.hours
    const busiest = wd.indexOf(Math.max(...wd))
    const top = vals.sort((a, b) => b[1].hours - a[1].hours)[0]
    return { hours, count, busiest: WD[busiest], top }
  }, [load])
  const today = new Date(now)
  return (
    <div className="yg">
      <div className="yg-stats">
        <div><b>{stats.count.toLocaleString()}</b><span>meetings</span></div>
        <div><b>{Math.round(stats.hours).toLocaleString()}h</b><span>booked</span></div>
        <div><b>{stats.busiest}</b><span>busiest weekday</span></div>
        {stats.top && <div><b>{parseDay(stats.top[0]).toLocaleDateString([], { month: 'short', day: 'numeric' })}</b><span>heaviest day · {stats.top[1].hours.toFixed(1)}h</span></div>}
      </div>
      <div className="yg-months" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: 12 }, (_, mi) => {
          const first = new Date(year, mi, 1)
          const lead = (first.getDay() + 6) % 7
          const n = new Date(year, mi + 1, 0).getDate()
          const monthHours = Array.from({ length: n }, (_, i) => load[isoDay(new Date(year, mi, i + 1))]?.hours || 0).reduce((a, b) => a + b, 0)
          return (
            <div key={mi} className="yg-month">
              <h5>{first.toLocaleDateString([], { month: 'long' })}<span>{monthHours ? `${Math.round(monthHours)}h` : ''}</span></h5>
              <div className="yg-days">
                {WD.map((w) => <span key={w} className="yg-wd">{w[0]}</span>)}
                {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
                {Array.from({ length: n }, (_, i) => {
                  const d = new Date(year, mi, i + 1)
                  const v = load[isoDay(d)]
                  return (
                    <button key={i} className={`yg-day l${level(v?.hours)} ${sameDay(d, today) ? 'today' : ''} ${d < startOfDay(today) ? 'past' : ''}`}
                      onClick={() => onDay(d)} title={`${d.toDateString()}${v ? ` · ${v.count} meeting${v.count === 1 ? '' : 's'}, ${v.hours.toFixed(1)}h` : ''}`}>{i + 1}</button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="yg-legend"><span>Less</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`yg-day l${l}`} />)}<span>More booked</span></div>
    </div>
  )
}

// ---------- The view ----------
export default function CalendarView({ onOpenAgent, focusDate }) {
  const [mode, setMode] = usePersisted('cc-cal-mode', 'week')
  const [anchorIso, setAnchorIso] = useState(isoDay(new Date()))
  const [selected, setSelected] = useState(null)
  const [ref, width] = useWidth()
  const now = useNow()
  const anchor = parseDay(anchorIso)
  const range = rangeFor(mode, anchor)
  const { data, error, loading, refresh } = usePoll(`/calendar/range?from=${isoDay(range[0])}&to=${isoDay(range[1])}`, 5 * 60 * 1000)
  const events = useMemo(() => (data?.from === isoDay(range[0]) ? data.events : []), [data, anchorIso, mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const colors = useCalColors(events)
  const narrow = width > 0 && width < 620

  useEffect(() => { if (focusDate) { setAnchorIso(focusDate); setMode('day') } }, [focusDate]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(null) }, [anchorIso, mode])
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
  const timed = events.filter((e) => !e.allDay && !e.canceled && inView(e))
  const booked = timed.reduce((s, e) => s + (new Date(e.end) - new Date(e.start)), 0)
  const isNow = mode === 'year' ? anchor.getFullYear() === new Date().getFullYear() : now >= range[0].getTime() && now < addDays(range[1], 1).getTime()

  return (
    <div className="calv" ref={ref}>
      <div className="calv-bar">
        <div className="calv-nav">
          <button className="icon-btn" onClick={() => setAnchorIso(isoDay(step(mode, anchor, -1)))} aria-label="Previous" title="Previous (←)"><Icon name="chevron" size={13} className="rot180" /></button>
          <button className={`btn small ${isNow ? 'is-now' : ''}`} onClick={() => setAnchorIso(isoDay(new Date()))} title="Today (T)">Today</button>
          <button className="icon-btn" onClick={() => setAnchorIso(isoDay(step(mode, anchor, 1)))} aria-label="Next" title="Next (→)"><Icon name="chevron" size={13} /></button>
          <h3>{title(mode, anchor, range)}</h3>
          {mode !== 'year' && data && <span className="calv-sum">{timed.length} meeting{timed.length === 1 ? '' : 's'} · {dur(booked)}</span>}
          {loading && <span className="calv-sum">Loading…</span>}
        </div>
        <div className="calv-tools">
          <div className="seg" role="tablist" aria-label="Calendar view">
            {[['day', 'D', 'Day'], ['week', 'W', 'Week'], ['month', 'M', 'Month'], ['year', 'Y', 'Year']].map(([m, k, l]) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} title={`${l} (${k})`}>{narrow ? k : l}</button>
            ))}
          </div>
          <button className="icon-btn" onClick={() => refresh('&refresh=1')} aria-label="Refresh" title="Refresh"><Icon name="refresh" size={13} /></button>
        </div>
      </div>
      {error && <div className="pad"><CalendarSetup error={error} onCheck={() => refresh('&refresh=1')} /></div>}
      <div className={`calv-body ${selected && !narrow ? 'with-detail' : ''}`}>
        <div className="calv-main">
          {mode === 'day' && <TimeGrid days={days} events={events} colors={colors} now={now} selected={selected} onSelect={setSelected} compactCols />}
          {mode === 'week' && (narrow
            ? <AgendaList days={days} events={events} colors={colors} now={now} onSelect={setSelected} />
            : <TimeGrid days={days} events={events} colors={colors} now={now} selected={selected} onSelect={setSelected} compactCols={width < 900} />)}
          {mode === 'month' && <MonthGrid anchor={anchor} from={range[0]} events={events} colors={colors} now={now} onDay={goDay} onSelect={setSelected} compact={narrow} />}
          {mode === 'year' && <YearGrid year={anchor.getFullYear()} events={events} now={now} onDay={goDay} cols={width < 520 ? 2 : width < 900 ? 3 : width < 1250 ? 4 : 6} />}
          {Object.keys(colors).length > 1 && mode !== 'year' && (
            <div className="cal-legend">{Object.entries(colors).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}</div>
          )}
        </div>
        {selected && (narrow
          ? <div className="modal-backdrop" onMouseDown={(x) => { if (x.target === x.currentTarget) setSelected(null) }}><div className="modal cal-sheet"><EventDetail e={selected} onClose={() => setSelected(null)} onOpenAgent={onOpenAgent} /></div></div>
          : <EventDetail e={selected} onClose={() => setSelected(null)} onOpenAgent={onOpenAgent} />)}
      </div>
    </div>
  )
}
