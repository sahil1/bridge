import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { Card, Updated } from './Trackers.jsx'
import { api, refetch, usePoll, viaRelay } from '../api.js'
import PermissionFix, { useFix, useRecheck } from './PermissionFix.jsx'
import { openToday } from './today.js'
import { t, locale } from '../i18n/index.js'

// Why the calendar can't be read yet, and one button that fixes it: install icalBuddy in a terminal
// tab you can watch (and Homebrew first, when the Mac has none), or allow Bridge AI to see your
// calendars. It looks again by itself while an install runs and when you come back to the window.
export function CalendarSetup({ error, code, onCheck }) {
  const { data: fix } = useFix()
  const [msg, setMsg] = useState(null) // { openId, what } | { error }
  const installing = msg?.openId ? msg.what : null
  // Homebrew going in: watch for it, to offer icalBuddy next. icalBuddy going in: try the calendar.
  useRecheck(installing === 'homebrew' ? () => refetch('/fix') : onCheck, installing ? 8000 : 0, code === 'noIcalBuddy')
  if (code === 'calendarAccess') {
    return <PermissionFix pane="calendars" onCheck={onCheck}><p>{t('Bridge AI needs your permission to read Calendar. Your events stay on this Mac.')}</p></PermissionFix>
  }
  if (code !== 'noIcalBuddy') {
    return <div className="perm-fix"><p className="error-text">{error}</p><button type="button" className="ghost-btn" onClick={onCheck}><Icon name="refresh" size={12} /> {t('Check again')}</button></div>
  }
  const noBrew = fix?.tools?.brew === false
  const install = async (what) => {
    setMsg(null)
    try { setMsg({ what, openId: (await api('/fix/install', { method: 'POST', body: { what } })).openId }) } catch (e) {
      if (e.code === 'noBrew') refetch('/fix')
      setMsg({ error: e.message })
    }
  }
  const show = () => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: msg.openId } }))
  const what = noBrew ? 'homebrew' : 'icalbuddy'
  return (
    <div className="perm-fix">
      <p>{noBrew
        ? <>{t('The calendar reads macOS Calendar through icalBuddy, a small free tool.')} It comes from Homebrew, which isn't on this Mac yet (<a href="https://brew.sh" target="_blank" rel="noreferrer">brew.sh</a>).</>
        : t('The calendar reads macOS Calendar through icalBuddy, a small free tool from Homebrew.')}</p>
      {viaRelay ? <p className="muted small">{t('Install it on your computer: open the calendar there and click Install.')}</p> : (
        <div className="perm-acts">
          <button type="button" className="btn small primary" disabled={installing === what} onClick={() => install(what)}><Icon name="download" size={12} /> {noBrew ? t('Install Homebrew') : t('Install icalBuddy')}</button>
          <button type="button" className="ghost-btn" onClick={() => { refetch('/fix'); onCheck() }}><Icon name="refresh" size={12} /> {t('Check again')}</button>
        </div>
      )}
      {installing && (
        <p className="muted small">
          {installing === 'homebrew' ? t('Installing Homebrew in a terminal tab. It asks for your Mac password there.') : t("Installing in a terminal tab. The calendar shows up here when it's done.")}{' '}
          <button type="button" className="link-btn" onClick={show}>{t('Show it')}</button>
        </p>
      )}
      {msg?.error && <p className="error-text">{msg.error}</p>}
    </div>
  )
}

// Today's schedule from the Mac's Calendar (your Exchange calendar plus personal ones).
const fmt = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
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
  return <a className={`join-btn ${strong ? 'strong' : ''}`} href={e.join} target="_blank" rel="noreferrer" onClick={(x) => x.stopPropagation()}><Icon name="video" size={12} /> {t('Join')}</a>
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
          {e.attendees.length > 0 && <p className="muted">{e.attendeeCount > e.attendees.length ? t('{names} and {n} more', { names: e.attendees.join(', '), n: e.attendeeCount - e.attendees.length }) : e.attendees.join(', ')}</p>}
          {!e.agenda && !e.attendees.length && <p className="muted">{t('No details.')}</p>}
        </div>
      )}
    </li>
  )
}

export function Agenda() {
  const { data, error, errorCode, refresh } = useCalendar()
  const now = useNow()
  const [showPast, setShowPast] = useState(false)
  const [showTomorrow, setShowTomorrow] = useState(false)
  const today = data && split(data.today, now)
  const ahead = today ? [...today.current, ...today.upcoming] : []
  const bookedLeft = ahead.reduce((s, e) => s + (new Date(e.end) - Math.max(now, new Date(e.start))), 0)
  const next = today?.upcoming[0]
  const cur = today?.current[0]
  const summary = !data ? '' : cur ? t('Now: {name}', { name: cur.title }) : next ? t('Next {time} · {title}', { time: fmt(next.start), title: next.title }) : t('Nothing else today')
  // "Next in" keeps its time in bold: the sentence is translated whole, then split around the time.
  const [nextIn, nextInEnd] = t('Next in {time}').split('{time}')
  const timedTomorrow = today ? data.tomorrow.filter((e) => !e.allDay) : []

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
    <Card icon="calendar" title={t('Schedule')} className="agenda" summary={summary}
      right={<span className="updated">{today && ahead.length > 0 && <span className="ag-left">{t('{n} left · {time}', { n: ahead.length, time: dur(bookedLeft) })}</span>}<Updated data={data} onRefresh={() => refresh('?refresh=1')} /></span>}>
      {!data && !error && <div className="skeleton-rows"><div /><div /></div>}
      {error && <CalendarSetup error={error} code={errorCode} onCheck={() => refresh('?refresh=1')} />}
      {today && (
        <>
          {cur && (
            <div className="ag-now">
              <div className="ag-now-head"><span className="live-pill">{t('Now')}</span> {t('until {time} · {left} left', { time: fmt(cur.end), left: dur(new Date(cur.end) - now) })}</div>
              <div className="ag-now-title"><b>{cur.title}</b><JoinBtn e={cur} strong /></div>
              <div className="ag-bar"><span style={{ width: `${Math.min(100, ((now - new Date(cur.start)) / (new Date(cur.end) - new Date(cur.start))) * 100)}%` }} /></div>
            </div>
          )}
          {!cur && next && (
            <div className="ag-next">
              <span>{nextIn}<b>{dur(new Date(next.start) - now)}</b>{nextInEnd}</span>
              <span className="ag-next-title">{next.title}</span>
              <JoinBtn e={next} />
            </div>
          )}
          {today.allDay.length > 0 && <div className="ag-allday">{today.allDay.map((e) => <span key={e.id} className="fchip on">{e.title}</span>)}</div>}
          {today.past.length > 0 && (
            <button className="ag-past-toggle" onClick={() => setShowPast(!showPast)}>
              <Icon name="chevron" size={10} className={showPast ? 'rot90' : ''} /> {t('{n} earlier today', { n: today.past.length })}
            </button>
          )}
          <ul className="ev-list">
            {showPast && today.past.map((e) => <EventRow key={e.id} e={e} now={now} past />)}
            {rows.map((r) => (r.e
              ? <EventRow key={r.e.id} e={r.e} now={now} />
              : <li key={`gap-${r.from}`} className="ev-gap"><span>{fmt(new Date(r.from).toISOString())}</span> {t('Free for {time}', { time: dur(r.gap) })}</li>))}
          </ul>
          {!ahead.length && <p className="muted small ag-done">{today.past.length ? t('Your meetings are done for today.') : t('No meetings today.')}</p>}
          {data.tomorrow.length > 0 && (
            <div className="ag-tomorrow">
              <button onClick={() => setShowTomorrow(!showTomorrow)} aria-expanded={showTomorrow}>
                <Icon name="chevron" size={10} className={showTomorrow ? 'rot90' : ''} />
                {timedTomorrow[0] ? t('Tomorrow · {n} meetings, first at {time}', { n: timedTomorrow.length, time: fmt(timedTomorrow[0].start) }) : t('Tomorrow · {n} meetings', { n: timedTomorrow.length })}
              </button>
              {showTomorrow && <ul className="ev-list">{data.tomorrow.map((e) => <EventRow key={e.id} e={e} now={now} />)}</ul>}
            </div>
          )}
          <button className="ghost-btn idea-more" onClick={() => openToday('calendar')}>{t('Week, month and year views')} <Icon name="chevron" size={10} /></button>
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
  const today = split(data.today, now)
  const cur = today.current[0]
  const next = today.upcoming[0]
  if (!cur && !next) return null
  const soon = next && new Date(next.start) - now < 10 * 6e4
  return (
    <button className={`top-chip meet-chip ${cur ? 'live' : soon ? 'soon' : ''}`} onClick={onClick} title={cur ? t('{title} until {time}', { title: cur.title, time: fmt(cur.end) }) : t('{title} at {time}', { title: next.title, time: fmt(next.start) })}>
      <Icon name={cur ? 'video' : 'calendar'} size={14} />
      {cur ? <span><b>{t('Now')}</b> <span className="meet-title">{cur.title}</span> <small>{t('{time} left', { time: dur(new Date(cur.end) - now) })}</small></span>
        : <span><b>{fmt(next.start)}</b> <span className="meet-title">{next.title}</span> <small>{t('in {time}', { time: dur(new Date(next.start) - now) })}</small></span>}
    </button>
  )
}
