import { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, fmtTime } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'
import { AssistHead } from '../AiAssist.jsx'
import './prep.css'

// AI Assist's Prepare for this meeting, before a meeting, as its suggestions are during one
// (server/meetprep.js): who's coming (the
// people you've met before and the ones new to your meetings), what happened last time with them
// (the summary and what's still open, yours and theirs), the invite's agenda and files, your mail
// with them, and a few goals or questions from the model that writes your notes, each with what
// it's based on and which model said it. Made when you ask, or by itself shortly before the meeting,
// and kept. With no model, all the rest shows, and it says how to add one. It only reads: nothing
// here changes the calendar, answers an invite or sends mail.
// size: full (the calendar's event panel), compact (Home's Coming Up, the floating card).

export const PREP_KIND = { goal: tx('Goal'), question: tx('Ask'), 'follow-up': tx('Follow up') }
const day = (iso) => new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
const list = (parts) => { try { return new Intl.ListFormat(locale(), { type: 'conjunction' }).format(parts) } catch { return parts.join(', ') } }
// The event as Prep reads it, without what it doesn't need.
const sent = (e) => ({ id: e.id, uid: e.uid, title: e.title, start: e.start, end: e.end, calendar: e.calendar, attendees: e.attendees, attendeeCount: e.attendeeCount, emails: e.emails, agenda: e.agenda, links: e.links, organizer: e.organizer, response: e.response })

// Prep for one event: what there is now, looked at again while its suggestions are being made.
// suggest(again): ask the model now (again: even when it has already).
export function usePrep(e, on = true) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const key = e ? `${e.uid || e.id}` : null
  const load = useCallback(() => (key ? api('/prep', { method: 'POST', body: { event: sent(e) } }).then((d) => { setData(d); setError(null) }, (x) => setError(x.message)) : Promise.resolve()), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (on && key) { setData(null); setError(null); load() } }, [key, on, load])
  useEffect(() => {
    if (!data?.making) return
    const id = setTimeout(load, 2500)
    return () => clearTimeout(id)
  }, [data, load])
  const suggest = async (again = false) => {
    setBusy(true)
    try { setData(await api('/prep/suggest', { method: 'POST', body: { event: sent(e), again } })); setError(null) } catch (x) { setError(x.message) } finally { setBusy(false) }
  }
  return { data, error, busy, suggest, load }
}

// What the suggestions were made from, in words.
function basisWords(b) {
  if (!b) return null
  const parts = [
    b.invite && t('the invite'),
    b.files > 0 && (b.files === 1 ? t('1 file in it') : t('{n} files in it', { n: b.files })),
    b.last && t('last time ({title}, {date})', { title: b.last.title, date: day(b.last.startedAt) }),
    b.people > 0 && (b.people === 1 ? t('1 person you\'ve met') : t('{n} people you\'ve met', { n: b.people })),
    b.mail > 0 && (b.mail === 1 ? t('1 email') : t('{n} emails', { n: b.mail })),
  ].filter(Boolean)
  return parts.length ? list(parts) : null
}

const openSettings = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))

function Suggestions({ p, prep, compact, onSettings }) {
  const { data: d, busy } = p
  const s = d.suggest
  const working = busy || d.making
  const items = s?.items || []
  if (!d.writer && !items.length) {
    return (
      <div className="prep-none">
        <p className="muted small">{t('Suggested goals and questions need a model to write them. Add one in Settings › Model Providers, or sign in to an agent.')}</p>
        {onSettings && <button type="button" className="ghost-btn" onClick={onSettings}><Icon name="layers" size={12} /> {t('Add a model')}</button>}
      </div>
    )
  }
  const shown = compact ? items.slice(0, 3) : items
  const from = basisWords(s?.basis)
  return (
    <div className="prep-sug">
      {shown.map((x, i) => (
        <div key={i} className={`prep-tip k-${x.kind}`}>
          <span className="prep-tip-kind">{t(PREP_KIND[x.kind] || PREP_KIND.goal)}</span>
          <span className="prep-tip-text" title={x.why ? `${x.text}\n${x.why}` : x.text}><span className="prep-tip-say">{x.text}</span>{x.why && <small>{x.why}</small>}</span>
        </div>
      ))}
      {s?.error && <p className="error-text small">{t("Couldn't suggest anything: {error}", { error: s.error })}</p>}
      {items.length > 0 && !compact && <p className="prep-foot muted small">{from ? t('{model} wrote these at {time}, from {what}.', { model: s.label || s.model, time: fmtTime(s.at), what: from }) : t('{model} wrote these at {time}.', { model: s.label || s.model, time: fmtTime(s.at) })}</p>}
      {items.length > 0 && compact && <p className="prep-foot muted small">{t('By {model} at {time}', { model: s.label || s.model, time: fmtTime(s.at) })}</p>}
      <div className="prep-acts">
        {d.writer && (items.length || s?.error
          ? <button type="button" className="ghost-btn" disabled={working} onClick={() => prep(true)}><Icon name="refresh" size={12} /> {working ? t('Thinking…') : s?.error ? t('Try again') : t('Again')}</button>
          : <button type="button" className="btn small primary" disabled={working} onClick={() => prep(false)}><Icon name="wand" size={12} /> {working ? t('Thinking…') : t('Suggest goals and questions')}</button>)}
        {d.writer && !items.length && !s?.error && !compact && <span className="muted small">{d.auto ? t('With {model}, from what\'s here. It also does this by itself 15 minutes before.', { model: d.writer.label }) : t('With {model}, from what\'s here.', { model: d.writer.label })}</span>}
      </div>
    </div>
  )
}

// insights: whether Meeting Insights (a beta feature) knew who's been in your meetings. Without it,
// who's invited is all that's said: nobody met before, nobody new.
function People({ people, compact }) {
  const { known, new: fresh, more, insights = true } = people
  if (!known.length && !fresh.length) return <p className="muted small">{t('No one else is invited.')}</p>
  if (compact) {
    const n = known.length + fresh.length + more
    const said = [n === 1 ? t('1 invited') : t('{n} invited', { n }), known.length ? (known.length === 1 ? t('1 you\'ve met') : t('{n} you\'ve met', { n: known.length })) : null, fresh.length && insights ? t('{n} new to your meetings', { n: fresh.length }) : null].filter(Boolean).join(' · ')
    return <p className="prep-line small" title={[...known.map((x) => x.name), ...fresh].join(', ')}>{said}</p>
  }
  return (
    <div className="prep-people">
      {known.map((x) => (
        <div key={x.id} className="prep-person">
          <span className="prep-av" aria-hidden="true">{x.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
          <span className="prep-person-text">
            <b>{x.name}</b>
            <small title={x.about || undefined}>{[x.meetings === 1 ? t('1 meeting') : t('{n} meetings', { n: x.meetings }), x.last && t('last {date}', { date: day(x.last) }), x.about].filter(Boolean).join(' · ')}</small>
          </span>
        </div>
      ))}
      {fresh.length > 0 && <p className="prep-new small">{insights && <><span className="prep-badge">{t('New')}</span> </>}{fresh.join(', ')}{more ? ` ${t('and {n} more', { n: more })}` : ''}</p>}
      {!fresh.length && more > 0 && <p className="muted small">{t('and {n} more', { n: more })}</p>}
    </div>
  )
}

const WHY = { series: tx('the same series'), people: tx('the same people'), customer: tx('the same customer') }
function Last({ last, compact, onOpenMeeting }) {
  if (!last) return <p className="muted small">{t('No earlier meeting like this one in your notes.')}</p>
  const open = last.yours.length + last.theirs.length
  const item = (x, i) => <li key={i}><Icon name="clock" size={10} /> {x.text}</li>
  if (compact) {
    const said = open ? t('Last time: {title}, {date} · {n} still open', { title: last.title, date: day(last.startedAt), n: open }) : t('Last time: {title}, {date}', { title: last.title, date: day(last.startedAt) })
    return <p className="prep-line small" title={said}>{said}</p>
  }
  return (
    <div className="prep-last">
      <div className="prep-last-head">
        <span className="prep-last-title"><b>{last.title}</b><small>{day(last.startedAt)}{WHY[last.why] ? ` · ${t(WHY[last.why])}` : ''}</small></span>
        {onOpenMeeting && <button type="button" className="ghost-btn" onClick={() => onOpenMeeting(last.id)}>{t('Open the notes')}</button>}
      </div>
      {last.summary.length > 0 && <ul className="prep-bullets">{last.summary.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {last.yours.length > 0 && <div className="prep-open"><span className="na-label">{t('Still open, yours')}</span><ul>{last.yours.map(item)}</ul></div>}
      {last.theirs.length > 0 && <div className="prep-open"><span className="na-label">{t('Still open, theirs')}</span><ul>{last.theirs.map(item)}</ul></div>}
      {!open && last.done > 0 && <p className="muted small">{t('Every action item from then is done.')}</p>}
    </div>
  )
}

function Mail({ mail, onOpenMail }) {
  if (!mail) return null
  if (!mail.available) return <p className="muted small">{mail.why}</p>
  if (!mail.threads.length && !mail.waiting.length) return <p className="muted small">{t('No mail with them in the last ten days.')}</p>
  return (
    <ul className="prep-mail">
      {mail.threads.map((m) => (
        <li key={m.id}>
          <button type="button" className="prep-mail-row" onClick={() => onOpenMail?.(m.id)} disabled={!onOpenMail}>
            <b title={m.subject}>{m.subject}</b>
            <small>{t('From {name}, {date}', { name: m.from, date: day(m.received) })}{m.replied ? ` · ${t('you replied')}` : ''}</small>
          </button>
        </li>
      ))}
      {mail.waiting.map((m) => (
        <li key={`w${m.id}`}>
          <span className="prep-mail-row">
            <b title={m.subject}>{m.subject}</b>
            <small>{t('You wrote to {name}, {date}: no reply yet', { name: m.to, date: day(m.sent) })}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}

// The invite's agenda and the files it links to.
export function InviteFiles({ agenda, files, compact }) {
  if (!agenda && !files?.length) return null
  if (compact) return <p className="prep-line small prep-agenda" title={agenda || undefined}>{agenda ? t('The invite: {text}', { text: agenda }) : files.length === 1 ? t('1 file in the invite') : t('{n} files in the invite', { n: files.length })}</p>
  return (
    <>
      {agenda && <p className="prep-agenda">{agenda}</p>}
      {files?.length > 0 && <div className="prep-files">{files.map((x, i) => <a key={i} href={x.url} target="_blank" rel="noreferrer" title={x.url}><Icon name="file" size={11} /><span>{x.name || x.url}</span></a>)}</div>}
    </>
  )
}

// The card itself. e: the event; invite: with its agenda and files (the calendar's panel shows them
// itself); onOpenMeeting(id): a recorded meeting's notes; onOpenMail(id): a message in Today ›
// Mail; onOpenEvent: all of it, in Today › Calendar (compact only: View Calendar, as "Open in" is
// for another app, as in Open in Word); onSettings: Settings › Model Providers
// (null where there's no Settings to open, as in the floating card's own window); prep: usePrep's,
// when what holds the card has it too (the calendar's AI Assist asks for suggestions through it).
export function PrepCard({ e, size = 'full', invite = true, prep = null, onOpenMeeting, onOpenMail, onOpenEvent, onSettings = openSettings }) {
  const own = usePrep(prep ? null : e)
  const p = prep || own
  const compact = size !== 'full'
  const d = p.data
  const ready = !!(d?.suggest?.items?.length || d?.making || p.busy)
  return (
    <section className={`prep ${compact ? 'compact' : ''}`} aria-label={t('AI Assist')}>
      <AssistHead className="prep-head" what={d?.making ? t('Thinking…') : t('Prepare for this meeting')}>
        {compact && onOpenEvent && <button type="button" className="ghost-btn" onClick={onOpenEvent}>{t('View Calendar')} <Icon name="chevron" size={10} /></button>}
      </AssistHead>
      {!d && !p.error && <div className="skeleton-rows"><div /><div /></div>}
      {p.error && <p className="error-text small">{p.error} <button type="button" className="link-btn" onClick={p.load}>{t('Try again')}</button></p>}
      {d && (compact ? (
        <>
          <People people={d.people} compact />
          <Last last={d.last} compact />
          {invite && <InviteFiles agenda={d.agenda} files={d.files} compact />}
          <Suggestions p={p} prep={p.suggest} compact onSettings={onSettings} />
        </>
      ) : (
        <>
          {/* Once there are suggestions (or they're on their way), they come first: what to go in with. */}
          {ready && <div className="prep-sec"><h5>{t('Goals and Questions')}</h5><Suggestions p={p} prep={p.suggest} onSettings={onSettings} /></div>}
          <div className="prep-sec"><h5>{t("Who's Coming")}</h5><People people={d.people} /></div>
          <div className="prep-sec"><h5>{t('Last Time')}</h5><Last last={d.last} onOpenMeeting={onOpenMeeting} /></div>
          {invite && (d.agenda || d.files.length > 0) && <div className="prep-sec"><h5>{t('From the Invite')}</h5><InviteFiles agenda={d.agenda} files={d.files} /></div>}
          {d.mail && <div className="prep-sec"><h5>{t('Mail With Them')}</h5><Mail mail={d.mail} onOpenMail={onOpenMail} /></div>}
          {!ready && <div className="prep-sec"><h5>{t('Goals and Questions')}</h5><Suggestions p={p} prep={p.suggest} onSettings={onSettings} /></div>}
        </>
      ))}
    </section>
  )
}

// Shortly before a meeting, on the floating card: what to go in with, at a glance. The goals and
// questions (three at most, all of each on hover), who's coming and last time in a line each, which
// model wrote them, and the rest in Today › Calendar (onOpenEvent: View Calendar). With no
// suggestions yet, the invite's agenda, and Suggest (or how to add a model) as the panel has it.
export function PrepGlance({ e, onOpenEvent }) {
  const p = usePrep(e)
  const d = p.data
  const s = d?.suggest
  const items = (s?.items || []).slice(0, 3)
  const working = !!(d?.making || p.busy)
  const people = d?.people
  const n = people ? people.known.length + people.new.length + people.more : 0
  const met = people?.known.length || 0
  const fresh = people?.insights !== false ? people?.new.length || 0 : 0
  const who = n ? [n === 1 ? t('1 invited') : t('{n} invited', { n }), met ? (met === 1 ? t('1 you\'ve met') : t('{n} you\'ve met', { n: met })) : null, fresh ? t('{n} new to your meetings', { n: fresh }) : null].filter(Boolean).join(' · ') : null
  const last = d?.last
  const open = last ? last.yours.length + last.theirs.length : 0
  // Last time in a series is the same meeting: its date and what's still open, before its name.
  const lastSaid = last && (last.title === e.title
    ? (open ? t('Last time, {date}: {n} still open', { date: day(last.startedAt), n: open }) : t('Last time, {date}', { date: day(last.startedAt) }))
    : (open ? t('Last time: {title}, {date} · {n} still open', { title: last.title, date: day(last.startedAt), n: open }) : t('Last time: {title}, {date}', { title: last.title, date: day(last.startedAt) })))
  return (
    <section className="prep-glance" aria-label={t('AI Assist')}>
      {!d && !p.error && <div className="skeleton-rows"><div /><div /></div>}
      {p.error && <p className="error-text small">{p.error} <button type="button" className="link-btn" onClick={p.load}>{t('Try again')}</button></p>}
      {d && (
        <>
          {(items.length > 0 || working) && (
            <div className="pg-sug">
              <span className="pg-head"><Icon name="wand" size={12} /> {working && !items.length ? t('Thinking…') : t('Goals and Questions')}</span>
              {items.map((x, i) => (
                <p key={i} className={`pg-item prep-tip-text k-${x.kind}`} title={x.why ? `${x.text}\n${x.why}` : x.text}><span className="pg-kind">{t(PREP_KIND[x.kind] || PREP_KIND.goal)}</span> {x.text}</p>
              ))}
            </div>
          )}
          <div className="pg-facts">
            {who && <p className="pg-fact prep-line" title={[...people.known.map((x) => x.name), ...people.new].join(', ')}><Icon name="users" size={12} /><span>{who}</span></p>}
            {lastSaid && <p className="pg-fact prep-line" title={lastSaid}><Icon name="clock" size={12} /><span>{lastSaid}</span></p>}
            {!items.length && d.agenda && <p className="pg-fact prep-line" title={d.agenda}><Icon name="doc" size={12} /><span>{t('The invite: {text}', { text: d.agenda })}</span></p>}
          </div>
          {s?.error && <p className="error-text small">{t("Couldn't suggest anything: {error}", { error: s.error })}</p>}
          {!items.length && !working && (d.writer
            ? <button type="button" className="btn small pg-suggest" onClick={() => p.suggest(!!s?.error)}><Icon name="wand" size={12} /> {s?.error ? t('Try again') : t('Suggest goals and questions')}</button>
            : <p className="pg-none">{t('Suggested goals and questions need a model to write them. Add one in Settings › Model Providers, or sign in to an agent.')}</p>)}
          {(items.length > 0 || onOpenEvent) && (
            <div className="pg-foot">
              {items.length > 0 && <span className="pg-by">{t('By {model} at {time}', { model: s.label || s.model, time: fmtTime(s.at) })}</span>}
              {onOpenEvent && <button type="button" className="fc-link" onClick={onOpenEvent}>{t('View Calendar')} <Icon name="chevron" size={10} /></button>}
            </div>
          )}
        </>
      )}
    </section>
  )
}
