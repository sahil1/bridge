import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { Card, Updated } from './Trackers.jsx'
import { usePoll } from '../api.js'
import { openToday } from './today.js'

// Today's schedule from the Mac's Calendar (your Exchange calendar plus personal ones).
const fmt = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dur = (ms) => {
  const m = Math.round(ms / 6e4)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id) }, [ms])
  return now
}

export function useCalendar() {
  return usePoll('/calendar', 3 * 60 * 1000)
}

function split(events, now) {
  const timed = events.filter((e) => !e.allDay && !e.canceled)
  return {
    allDay: events.filter((e) => e.allDay),
    past: timed.filter((e) => new Date(e.end) <= now),
    current: timed.filter((e) => new Date(e.start) <= now && new Date(e.end) > now),
    upcoming: timed.filter((e) => new Date(e.start) > now),
  }
}

function JoinBtn({ e, strong }) {
  if (!e.join) return null
  return <a className={`join-btn ${strong ? 'strong' : ''}`} href={e.join} target="_blank" rel="noreferrer" onClick={(x) => x.stopPropagation()}><Icon name="video" size={12} /> Join</a>
}

function EventRow({ e, now, past }) {
  const [open, setOpen] = useState(false)
  const live = new Date(e.start) <= now && new Date(e.end) > now
  return (
    <li className={`ev ${past ? 'past' : ''} ${live ? 'live' : ''} ${open ? 'open' : ''}`}>
      <button className="ev-main" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ev-time">{fmt(e.start)}<small>{dur(new Date(e.end) - new Date(e.start))}</small></span>
        <span className="ev-text">
          <b>{e.title}</b>
          <span className="ev-meta">
            {e.attendeeCount > 1 && <span><Icon name="users" size={10} /> {e.attendeeCount}</span>}
            {e.attendeeCount === 1 && e.attendees[0] && <span><Icon name="users" size={10} /> {e.attendees[0]}</span>}
            {e.online && <span><Icon name="video" size={10} /> {e.join?.includes('zoom') ? 'Zoom' : e.join?.includes('google') ? 'Meet' : 'Teams'}</span>}
            {e.location && <span className="ev-loc">{e.location}</span>}
            {e.calendar && e.calendar !== 'Calendar' && <span className="ev-cal">{e.calendar}</span>}
          </span>
        </span>
      </button>
      {!past && <JoinBtn e={e} strong={live} />}
      {open && (
        <div className="ev-more">
          {e.agenda && <p>{e.agenda}</p>}
          {e.attendees.length > 0 && <p className="muted">{e.attendees.join(', ')}{e.attendeeCount > e.attendees.length ? ` and ${e.attendeeCount - e.attendees.length} more` : ''}</p>}
          {!e.agenda && !e.attendees.length && <p className="muted">No details.</p>}
        </div>
      )}
    </li>
  )
}

export function Agenda() {
  const { data, error, refresh } = useCalendar()
  const now = useNow()
  const [showPast, setShowPast] = useState(false)
  const [showTomorrow, setShowTomorrow] = useState(false)
  const t = data && split(data.today, now)
  const ahead = t ? [...t.current, ...t.upcoming] : []
  const bookedLeft = ahead.reduce((s, e) => s + (new Date(e.end) - Math.max(now, new Date(e.start))), 0)
  const next = t?.upcoming[0]
  const cur = t?.current[0]
  const summary = !data ? '' : cur ? `Now: ${cur.title}` : next ? `Next ${fmt(next.start)} · ${next.title}` : 'Nothing else today'

  // Free gaps of 30m+ between what's left today.
  const rows = []
  let cursor = now
  for (const e of ahead) {
    const gap = new Date(e.start) - cursor
    if (gap >= 30 * 6e4) rows.push({ gap, from: cursor })
    rows.push({ e })
    cursor = Math.max(cursor, new Date(e.end).getTime())
  }

  return (
    <Card icon="calendar" title="Schedule" className="agenda" summary={summary}
      right={<span className="updated">{t && ahead.length > 0 && <span className="ag-left">{ahead.length} left · {dur(bookedLeft)}</span>}<Updated data={data} onRefresh={() => refresh('?refresh=1')} /></span>}>
      {!data && !error && <div className="skeleton-rows"><div /><div /></div>}
      {error && <p className="error-text">{error}</p>}
      {t && (
        <>
          {cur && (
            <div className="ag-now">
              <div className="ag-now-head"><span className="live-pill">Now</span> until {fmt(cur.end)} · {dur(new Date(cur.end) - now)} left</div>
              <div className="ag-now-title"><b>{cur.title}</b><JoinBtn e={cur} strong /></div>
              <div className="ag-bar"><span style={{ width: `${Math.min(100, ((now - new Date(cur.start)) / (new Date(cur.end) - new Date(cur.start))) * 100)}%` }} /></div>
            </div>
          )}
          {!cur && next && (
            <div className="ag-next">
              <span>Next in <b>{dur(new Date(next.start) - now)}</b></span>
              <span className="ag-next-title">{next.title}</span>
              <JoinBtn e={next} />
            </div>
          )}
          {t.allDay.length > 0 && <div className="ag-allday">{t.allDay.map((e) => <span key={e.id} className="fchip on">{e.title}</span>)}</div>}
          {t.past.length > 0 && (
            <button className="ag-past-toggle" onClick={() => setShowPast(!showPast)}>
              <Icon name="chevron" size={10} className={showPast ? 'rot90' : ''} /> {t.past.length} earlier today
            </button>
          )}
          <ul className="ev-list">
            {showPast && t.past.map((e) => <EventRow key={e.id} e={e} now={now} past />)}
            {rows.map((r) => (r.e
              ? <EventRow key={r.e.id} e={r.e} now={now} />
              : <li key={`gap-${r.from}`} className="ev-gap"><span>{fmt(new Date(r.from).toISOString())}</span> Free for {dur(r.gap)}</li>))}
          </ul>
          {!ahead.length && <p className="muted small ag-done">{t.past.length ? 'Your meetings are done for today.' : 'No meetings today.'}</p>}
          {data.tomorrow.length > 0 && (
            <div className="ag-tomorrow">
              <button onClick={() => setShowTomorrow(!showTomorrow)} aria-expanded={showTomorrow}>
                <Icon name="chevron" size={10} className={showTomorrow ? 'rot90' : ''} />
                Tomorrow · {data.tomorrow.filter((e) => !e.allDay).length} meetings{data.tomorrow.find((e) => !e.allDay) ? `, first at ${fmt(data.tomorrow.find((e) => !e.allDay).start)}` : ''}
              </button>
              {showTomorrow && <ul className="ev-list">{data.tomorrow.map((e) => <EventRow key={e.id} e={e} now={now} />)}</ul>}
            </div>
          )}
          <button className="ghost-btn idea-more" onClick={() => openToday('calendar')}>Week, month and year views <Icon name="chevron" size={10} /></button>
        </>
      )}
    </Card>
  )
}

// Top-bar chip: the meeting you're in, or the next one with a countdown.
export function NextMeetingChip({ onClick }) {
  const { data } = useCalendar()
  const now = useNow()
  if (!data) return null
  const t = split(data.today, now)
  const cur = t.current[0]
  const next = t.upcoming[0]
  if (!cur && !next) return null
  const soon = next && new Date(next.start) - now < 10 * 6e4
  return (
    <button className={`top-chip meet-chip ${cur ? 'live' : soon ? 'soon' : ''}`} onClick={onClick} title={cur ? `${cur.title} until ${fmt(cur.end)}` : `${next.title} at ${fmt(next.start)}`}>
      <Icon name={cur ? 'video' : 'calendar'} size={14} />
      {cur ? <span><b>Now</b> <span className="meet-title">{cur.title}</span> <small>{dur(new Date(cur.end) - now)} left</small></span>
        : <span><b>{fmt(next.start)}</b> <span className="meet-title">{next.title}</span> <small>in {dur(new Date(next.start) - now)}</small></span>}
    </button>
  )
}
