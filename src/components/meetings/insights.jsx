import { useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'
import { usePersisted } from '../layout.jsx'
import { clock } from './recording.jsx'
import { CalendarSetup } from '../Agenda.jsx'

// Meeting Insights and People, the Meetings section's other two tabs (a trial feature,
// meeting-insights): your meetings added up the way Usage adds up tokens, and everyone you've met.
// The server works it all out from the transcripts and invites on this computer
// (server/meetinsights.js); each number here says what it's based on, and none scores anyone.

const RANGES = [['30', tx('30 days')], ['90', tx('90 days')], ['365', tx('Year')], ['all', tx('All')]]
export const KINDS = { one_on_one: tx('1:1s'), customer: tx('Customer calls'), standup: tx('Standups'), interview: tx('Interviews'), brainstorm: tx('Brainstorms'), recurring: tx('Recurring'), group: tx('Group meetings'), other: tx('Other') }
const KIND_WHY = {
  one_on_one: tx('One other person invited or named on the transcript, or 1:1 in its name.'),
  customer: tx("Someone invited from another company (an email domain that isn't yours, or a customer in meeting memory), or Customer call picked."),
  standup: tx('Standup in its name, or picked.'),
  interview: tx('Interview in its name, or picked.'),
  brainstorm: tx('Brainstorm in its name, or picked.'),
  recurring: tx('The same name three times or more.'),
  group: tx('Two or more other people.'),
  other: tx('Nobody else known.'),
}
const METRICS = [['hours', tx('Hours')], ['meetings', tx('Meetings')], ['share', tx('Your share')], ['words', tx('Words')]]

const num = (n) => Math.round(n).toLocaleString(locale())
const compact = (n) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
export const hours = (s) => { const m = Math.round(s / 60); return m < 60 ? t('{n} min', { n: m }) : t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) }
const day = (iso, o = { month: 'short', day: 'numeric' }) => new Date(iso.length === 10 ? `${iso}T12:00` : iso).toLocaleDateString(locale(), o)
const when = (iso) => new Date(iso).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Tile({ label, value, sub, why }) {
  return (
    <div className="us-tile mi-tile" title={why || undefined}>
      <span className="us-tile-label">{label}</span>
      <span className="us-tile-val num">{value}</span>
      {sub && <span className="us-tile-sub">{sub}</span>}
    </div>
  )
}

// The weeks as columns, as Usage's bars are: words as yours under what you heard.
function WeekBars({ weeks, metric }) {
  const [hover, setHover] = useState(null)
  const val = (w) => (metric === 'hours' ? w.seconds / 3600 : metric === 'meetings' ? w.n : metric === 'share' ? pct(w.you, w.talk) : w.words + w.heard)
  const max = metric === 'share' ? 100 : Math.max(...weeks.map(val), 0) || 1
  const read = (w) => (metric === 'hours' ? hours(w.seconds) : metric === 'meetings' ? (w.n === 1 ? t('{n} meeting', { n: w.n }) : t('{n} meetings', { n: w.n }))
    : metric === 'share' ? (w.talk ? t('you spoke {pct}% of the talk', { pct: pct(w.you, w.talk) }) : t('who spoke isn\'t known'))
      : t('{you} words spoken by you, {heard} heard', { you: num(w.words), heard: num(w.heard) }))
  const every = Math.max(1, Math.ceil(weeks.length / 8))
  return (
    <div className="us-cols mi-weeks" onPointerLeave={() => setHover(null)} role="img" aria-label={t('{metric} by week', { metric: t(METRICS.find((m) => m[0] === metric)[1]) })}>
      {weeks.map((w, i) => (
        <div key={w.week} className={`us-col ${hover === i ? 'hl' : ''} ${i === weeks.length - 1 ? 'peak' : ''}`} onPointerEnter={() => setHover(i)} title={`${t('Week of {date}', { date: day(w.week) })}: ${read(w)}`}>
          <span className="us-col-bar">
            {metric === 'words'
              ? <span className="mi-stack" style={{ height: `${Math.max(val(w) ? 3 : 0, (val(w) / max) * 100)}%` }}><i style={{ flexGrow: w.heard }} /><b style={{ flexGrow: w.words }} /></span>
              : <span style={{ height: `${Math.max(val(w) ? 3 : 0, (val(w) / max) * 100)}%` }} />}
          </span>
          <span className="us-col-label">{i % every === 0 || i === weeks.length - 1 ? day(w.week) : ''}</span>
        </div>
      ))}
      <span className="us-cols-read">{hover != null ? `${t('Week of {date}', { date: day(weeks[hover].week) })} · ${read(weeks[hover])}` : ''}</span>
    </div>
  )
}

// What a talk number is based on: the meetings where who spoke is known (a call: your mic and the
// call's sound; a room: voices told apart, one of them you), and the ones left out, saying why.
function talkBasis(d) {
  const { told, untold } = d.talk
  const out = [told === 1 ? t('From {n} meeting where who spoke is known: on a call, your mic and the call\'s sound; in a room, voices told apart and one of them you.', { n: told }) : t('From {n} meetings where who spoke is known: on a call, your mic and the call\'s sound; in a room, voices told apart and one of them you.', { n: told })]
  if (untold.room) out.push(untold.room === 1 ? t('{n} in a room without the voices told apart isn\'t counted.', { n: untold.room }) : t('{n} in a room without the voices told apart aren\'t counted.', { n: untold.room }))
  if (untold.noyou) out.push(untold.noyou === 1 ? t('{n} with voices told apart, none of them known to be you, isn\'t counted.', { n: untold.noyou }) : t('{n} with voices told apart, none of them known to be you, aren\'t counted.', { n: untold.noyou }))
  if (untold.silent) out.push(untold.silent === 1 ? t('{n} with nothing transcribed isn\'t counted.', { n: untold.silent }) : t('{n} with nothing transcribed aren\'t counted.', { n: untold.silent }))
  return out.join(' ')
}

export function InsightsView({ onPerson }) {
  const [days, setDays] = usePersisted('cc-mi-range', '90')
  const [kind, setKind] = useState('all')
  const [metric, setMetric] = usePersisted('cc-mi-metric', 'hours')
  const { data, error } = usePoll(`/meetings/insights?days=${days}&kind=${kind}`, 60_000)
  if (error && !data) return <p className="error-text small" role="alert">{error}</p>
  if (!data) return <div className="skeleton-rows"><div /><div /><div /></div>
  if (!data.total && !data.failed) {
    return (
      <div className="mt-empty mi-empty" role="status">
        <Icon name="trend" size={22} />
        <p><b>{t('No meetings to add up yet.')}</b></p>
        <p className="muted small">{t('Record a meeting and Insights adds it up here: how many, how long, your share of the talk, and the people you meet. All of it is worked out on this computer, from your transcripts and invites.')}</p>
        {data.recording > 0 && <p className="muted small">{t("The one recording now is counted once it ends.")}</p>}
      </div>
    )
  }
  const talk = data.talk.you + data.talk.others + data.talk.unknown
  const prev = data.prev
  const more = prev ? data.meetings - prev.meetings : null
  const known = data.byKind.filter((k) => k.talk > 0)
  const s = data.signals
  return (
    <div className="mi">
      <p className="muted small mi-lede">{data.total === 1 ? t('Worked out on this computer from {n} recorded meeting, its transcript and invite. Nothing here is sent anywhere, and none of it is a score of anyone.', { n: data.total }) : t('Worked out on this computer from {n} recorded meetings, their transcripts and invites. Nothing here is sent anywhere, and none of it is a score of anyone.', { n: data.total })}{data.archived ? ` ${t('Archived meetings are left out, as they are from search.')}` : ''}{data.failed ? ` ${data.failed === 1 ? t("{n} meeting couldn't be read, so it isn't counted.", { n: data.failed }) : t("{n} meetings couldn't be read, so they aren't counted.", { n: data.failed })}` : ''}</p>
      <div className="us-bar mi-bar">
        <div className="seg small-seg" role="tablist" aria-label={t('Range')}>
          {RANGES.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={String(days) === v} className={String(days) === v ? 'on' : ''} onClick={() => setDays(v)}>{t(l)}</button>)}
        </div>
      </div>
      <div className="mt-places mi-kinds" role="tablist" aria-label={t('Kind of meeting')}>
        <button type="button" role="tab" aria-selected={kind === 'all'} className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>{t('All kinds')} <span className="muted">{data.kinds.reduce((a, k) => a + k.n, 0)}</span></button>
        {data.kinds.map((k) => <button key={k.id} type="button" role="tab" data-kind={k.id} aria-selected={kind === k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(kind === k.id ? 'all' : k.id)} title={t(KIND_WHY[k.id])}>{t(KINDS[k.id])} <span className="muted">{k.n}</span></button>)}
      </div>
      {kind !== 'all' && <p className="muted small mi-why">{t(KINDS[kind])}: {t(KIND_WHY[kind])}</p>}
      {!data.meetings ? <p className="muted small" role="status">{t('No meetings in this range.')}</p> : (
        <>
          <div className="us-tiles mi-tiles">
            <Tile label={t('Meetings')} value={num(data.meetings)} why={t('Recorded meetings; the calendar\'s other meetings aren\'t counted.')}
              sub={more == null ? t('since {date}', { date: day(data.from, { month: 'short', day: 'numeric', year: 'numeric' }) }) : more > 0 ? t('{n} more than the {days} days before', { n: more, days: data.days }) : more < 0 ? t('{n} fewer than the {days} days before', { n: -more, days: data.days }) : t('as many as the {days} days before', { days: data.days })} />
            <Tile label={t('Time in meetings')} value={hours(data.seconds)} sub={t('{time} a meeting, on average', { time: hours(data.seconds / data.meetings) })} why={t('How long each was recorded.')} />
            <Tile label={t('You spoke')} value={data.talk.told ? `${pct(data.talk.you, talk)}%` : '–'} sub={data.talk.told ? t('of the talk · {time}', { time: hours(data.talk.you) }) : t('who spoke isn\'t known')} why={talkBasis(data)} />
            <Tile label={t('Words')} value={data.talk.told ? `${compact(data.words.you)} / ${compact(data.words.heard)}` : '–'} sub={t('spoken by you / heard from others')} why={talkBasis(data)} />
          </div>
          <p className="muted small mi-basis" data-basis="talk">{talkBasis(data)}</p>
          <div className="us-grid mi-grid">
            <section className="us-card us-wide">
              <div className="us-card-head">
                <h4>{t('By week')}</h4>
                <div className="seg small-seg" role="tablist" aria-label={t('Show')}>
                  {METRICS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={metric === k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{t(l)}</button>)}
                </div>
              </div>
              <WeekBars weeks={data.weeks} metric={metric} />
              <p className="muted small us-note">{metric === 'share' || metric === 'words' ? t('Only weeks with meetings where who spoke is known.') : t('Recorded meetings; the calendar\'s other meetings aren\'t counted.')}{metric === 'words' ? ` ${t('Darker: your words. Lighter: what you heard.')}` : ''}</p>
            </section>
            <section className="us-card">
              <div className="us-card-head"><h4>{t('Your share of the talk, by kind')}</h4></div>
              {known.length ? (
                <ul className="us-list">
                  {known.map((k) => (
                    <li key={k.id}>
                      <div className="us-row static mi-row" title={t(KIND_WHY[k.id])}>
                        <span className="us-row-name">{t(KINDS[k.id])}</span>
                        <span className="us-row-bar"><span style={{ width: `${pct(k.you, k.talk)}%` }} /></span>
                        <span className="us-row-num num">{pct(k.you, k.talk)}%</span>
                        <span className="us-row-num num muted">{k.n}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small">{t('No meetings in this range where who spoke is known.')}</p>}
              <p className="muted small us-note">{t('From who said each line: you and the call on a call, voices told apart in a room. The last number is how many meetings.')}</p>
            </section>
            {data.people.length > 0 && (
              <section className="us-card">
                <div className="us-card-head"><h4>{t('People you meet')}</h4></div>
                <ul className="us-list">
                  {data.people.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="us-row mi-row" onClick={() => onPerson?.(p.id)}>
                        <span className="us-row-name">{p.name}</span>
                        <span className="us-row-bar"><span style={{ width: `${pct(p.n, data.people[0].n)}%` }} /></span>
                        <span className="us-row-num num">{p.n}</span>
                        <span className="us-row-num num muted">{p.share ? `${p.share.pct}%` : '–'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="muted small us-note">{t('Meetings together in this range, and their share of the talk where their lines are named. From invites and the names on transcripts.')}</p>
              </section>
            )}
            <section className="us-card us-wide">
              <div className="us-card-head"><h4>{t('Signals, and what each is based on')}</h4><span className="muted small">{t('A mirror for you; nothing here scores anyone')}</span></div>
              <div className="mi-signals" role="table">
                <Signal name={t('Questions you asked')} value={s.questions.meetings ? t('{n} a meeting', { n: (Math.round((s.questions.n / s.questions.meetings) * 10) / 10).toLocaleString(locale()) }) : '–'} how={t('Your lines with a question mark, in meetings where who spoke is known.')} />
                <Signal name={t('Your longest stretch')} value={s.longest.meetings ? clock(s.longest.s) : '–'} how={t('Your longest run of talking with nobody else between, on average.')} />
                <Signal name={t('Meetings that ran over')} value={s.ranOver.of ? t('{n} of {of}', { n: s.ranOver.n, of: s.ranOver.of }) : '–'} how={t("The recording's end against the invite's, 5 minutes or more past it. Only meetings with an invite's times.")} />
                <Signal name={t('Back to back')} value={s.backToBack.days === 1 ? t('{n} day', { n: 1 }) : t('{n} days', { n: s.backToBack.days })} how={t('Days with 3 or more recorded meetings under 5 minutes apart.')} />
                <Signal name={t('Followed through')} value={s.followed.of ? t('{n} of {of}', { n: s.followed.done, of: s.followed.of }) : '–'} how={t('Your action items from the summaries, ticked or marked done.')} />
                <Signal name={t('Attention, productivity')} value={<i>{t('not shown')}</i>} how={t("Nothing in a recording shows them, and Bridge AI won't guess.")} />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
function Signal({ name, value, how }) {
  return <div className="mi-signal" role="row"><span role="cell">{name}</span><b role="cell" className="num">{value}</b><span role="cell" className="muted">{how}</span></div>
}

// ---------- People ----------
const initial = (name) => (String(name).trim()[0] || '?').toUpperCase()
// The calendar, when it can't be read yet on a computer that has one: what it's for, and the fix.
function CalendarNeeded({ cal, onCheck }) {
  if (!cal || cal.ok || !['calendarAccess', 'noIcalBuddy'].includes(cal.code)) return null
  return (
    <div className="mi-cal">
      <p className="small"><Icon name="calendar" size={13} /> {t('Connect your calendar to see when you next meet each person, and so new meetings take their people from the invite.')}</p>
      <CalendarSetup error={cal.error} code={cal.code} onCheck={onCheck} />
    </div>
  )
}

// You at the middle and the people you meet most around you, bigger for more meetings together.
function PeopleMap({ people, onPerson }) {
  const top = people.slice(0, 8)
  if (top.length < 2) return null
  // Round an ellipse narrow enough that each name fits beside its dot.
  const W = 360, H = 220, cx = W / 2, cy = H / 2, RX = 95, RY = 82
  const most = top[0].meetings || 1
  const at = (i) => (i / top.length) * Math.PI * 2 - Math.PI / 2
  return (
    <svg className="mi-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('You at the middle, and the people you meet most around you')}>
      {top.map((p, i) => <line key={p.id} x1={cx} y1={cy} x2={cx + Math.cos(at(i)) * RX} y2={cy + Math.sin(at(i)) * RY} className="mi-map-line" />)}
      <circle cx={cx} cy={cy} r={19} className="mi-map-you" />
      <text x={cx} y={cy + 4} textAnchor="middle" className="mi-map-youtext">{t('You')}</text>
      {top.map((p, i) => {
        const a = at(i)
        const x = cx + Math.cos(a) * RX, y = cy + Math.sin(a) * RY
        const right = Math.cos(a) >= -0.01
        return (
          <g key={p.id} className="mi-map-node" onClick={() => onPerson(p.id)} role="link" aria-label={p.name}>
            <title>{p.meetings === 1 ? t('{name}: {n} meeting together', { name: p.name, n: p.meetings }) : t('{name}: {n} meetings together', { name: p.name, n: p.meetings })}</title>
            <circle cx={x} cy={y} r={6 + (p.meetings / most) * 9} />
            <text x={x + (right ? 14 : -14)} y={y + 4} textAnchor={right ? 'start' : 'end'}>{`${p.name.split(' ')[0].slice(0, 10)} · ${p.meetings}`}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function PeopleView({ onOpen, person, setPerson }) {
  const { data, error, refresh } = usePoll('/meetings/people', 60_000)
  const [q, setQ] = useState('')
  if (person) return <PersonPage id={person} onBack={() => { setPerson(null); refresh() }} onOpen={onOpen} onPerson={setPerson} />
  if (error && !data) return <p className="error-text small" role="alert">{error}</p>
  if (!data) return <div className="skeleton-rows"><div /><div /><div /></div>
  const list = data.people.filter((p) => !q.trim() || [p.name, ...p.also, ...p.emails].some((x) => x.toLowerCase().includes(q.trim().toLowerCase())))
  return (
    <div className="mi mi-people">
      {data.meetings > 0 && <p className="muted small mi-lede" data-basis="people">{data.meetings === 1 ? t('From who was invited to your {n} recorded meeting and the names on its transcript.', { n: data.meetings }) : t('From who was invited to your {n} recorded meetings and the names on their transcripts.', { n: data.meetings })} {t('The same person written two ways is put together only when it\'s clear; open someone to put two together or take a name out.')}</p>}
      <CalendarNeeded cal={data.calendar} onCheck={() => refresh()} />
      {!data.people.length ? (
        <div className="mt-empty mi-empty" role="status">
          <Icon name="users" size={22} />
          <p><b>{t('Nobody here yet.')}</b></p>
          <p className="muted small">{data.meetings ? t('People come from who\'s invited to a meeting (from its calendar event, or added on its page) and the names on its transcript. None of your meetings has either yet.') : t('Record a meeting and the people in it show up here: how often you meet, when last and next, and what you talk about.')}</p>
        </div>
      ) : (
        <>
          <PeopleMap people={data.people} onPerson={setPerson} />
          {data.people.length > 8 && <input className="mt-search" type="search" placeholder={t('Find someone')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Find someone')} />}
          <div className="mi-plist">
            {list.map((p) => (
              <button key={p.id} type="button" className="mi-prow" data-person={p.id} onClick={() => setPerson(p.id)}>
                <span className="mi-av" aria-hidden="true">{initial(p.name)}</span>
                <span className="mi-ptext">
                  <b>{p.name}</b>
                  <span className="muted small">{[p.about, p.topics.length ? p.topics.join(', ') : null].filter(Boolean).join(' · ') || (p.meetings === 1 ? t('{n} meeting together', { n: p.meetings }) : t('{n} meetings together', { n: p.meetings }))}</span>
                  <span className="muted small">{[t('last {date}', { date: day(p.last) }), p.next ? t('next {date}', { date: day(p.next.start, { weekday: 'short', month: 'short', day: 'numeric' }) }) : null, t('{time} together', { time: hours(p.seconds) })].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="mi-pnum num" title={p.share ? t('{n} meetings together · {pct}% of the talk, in the {m} where their lines are named', { n: p.meetings, pct: p.share.pct, m: p.share.meetings }) : t('{n} meetings together · their lines aren\'t named in any', { n: p.meetings })}>{p.meetings} · {p.share ? `${p.share.pct}%` : '–'}</span>
              </button>
            ))}
            {!list.length && <p className="muted small">{t('Nobody matches "{q}".', { q: q.trim() })}</p>}
          </div>
          <p className="muted small us-note">{t('Meetings together · their share of the talk, in the meetings where their lines are named.')}</p>
        </>
      )}
    </div>
  )
}

function PersonPage({ id, onBack, onOpen, onPerson }) {
  const { data, error, refresh } = usePoll(`/meetings/people/${encodeURIComponent(id)}`, 60_000)
  const [other, setOther] = useState('')
  const [msg, setMsg] = useState(null)
  const merge = async () => {
    if (!other) return
    try { const r = await api('/meetings/people/merge', { method: 'POST', body: { a: id, b: other } }); setOther(''); setMsg({ text: t('Put together') }); if (r.id !== id) onPerson(r.id); else refresh() } catch (e) { setMsg({ text: e.message, error: true }) }
  }
  const split = async (key) => {
    try { const r = await api('/meetings/people/split', { method: 'POST', body: { id, key } }); setMsg({ text: t('Taken out: that name is someone else now.') }); if (r.id && r.id !== id) onPerson(r.id); else refresh() } catch (e) { setMsg({ text: e.message, error: true }) }
  }
  const back = <button type="button" className="ghost-btn mi-back" onClick={onBack}><Icon name="back" size={14} /> {t('People')}</button>
  if (error && !data) return <div className="mi">{back}<p className="error-text small" role="alert">{error}</p></div>
  if (!data) return <div className="mi">{back}<div className="skeleton-rows"><div /><div /></div></div>
  return (
    <div className="mi mi-person">
      {back}
      <div className="mi-phead">
        <span className="mi-av big" aria-hidden="true">{initial(data.name)}</span>
        <div>
          <h3>{data.name}</h3>
          {(data.about || data.emails.length > 0) && <p className="muted small">{[data.about, ...data.emails].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <div className="us-tiles mi-tiles">
        <Tile label={t('Meetings together')} value={num(data.meetings)} sub={t('last {date}', { date: day(data.last) })} />
        <Tile label={t('Time together')} value={hours(data.seconds)} sub={t('how long those meetings were recorded')} />
        <Tile label={t('Their share of the talk')} value={data.share ? `${data.share.pct}%` : '–'}
          sub={data.share ? (data.share.meetings === 1 ? t('in {n} meeting where their lines are named', { n: data.share.meetings }) : t('in {n} meetings where their lines are named', { n: data.share.meetings })) : t('their lines aren\'t named in any')} />
        <Tile label={t('Next')} value={data.next ? day(data.next.start, { weekday: 'short', month: 'short', day: 'numeric' }) : '–'} sub={data.next ? data.next.title : data.calendar?.ok ? t('nothing with them in the next 30 days') : t('needs your calendar')} />
      </div>
      <CalendarNeeded cal={data.calendar} onCheck={() => refresh()} />
      {data.next && <p className="small mi-next" data-next="1"><Icon name="calendar" size={13} /> {t('Next: {title}, {when}', { title: data.next.title, when: when(data.next.start) })}</p>}
      {data.topics.length > 0 && (
        <section className="mi-sec">
          <h4>{t('What you talk about')}</h4>
          <div className="mi-topics">{data.topics.map((x) => <span key={x} className="chip">{x}</span>)}</div>
          <p className="muted small">{t('Words from the summaries of your meetings with them.')}</p>
        </section>
      )}
      <section className="mi-sec">
        <h4>{t('Open action items')}</h4>
        {data.items.length ? (
          <ul className="mi-items">
            {data.items.map((x, i) => (
              <li key={i}>
                <span>{x.who ? <b>{x.who}: </b> : null}{x.text}</span>
                <button type="button" className="link-btn small" onClick={() => onOpen?.(x.meeting.id)}>{x.meeting.title} · {day(x.meeting.start)}</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">{t('None open: nothing in your summaries is theirs or names them and isn\'t ticked.')}</p>}
      </section>
      <section className="mi-sec">
        <h4>{t('Meetings')}</h4>
        <div className="mi-mlist">
          {data.meetingsList.map((m) => (
            <button key={m.id} type="button" className="mi-mrow" data-meeting={m.id} onClick={() => onOpen?.(m.id)}>
              <span className="mi-ptext"><b>{m.title}</b><span className="muted small">{when(m.start)} · {hours(m.seconds)}{m.how?.spoke ? '' : ` · ${t('invited')}`}</span></span>
              <span className="mi-pnum num" title={m.pct == null ? t('Their lines aren\'t named in this one') : t('Their share of the talk in this one')}>{m.pct == null ? '–' : `${m.pct}%`}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="mi-sec">
        <h4>{t('The same person?')}</h4>
        {data.written.length > 1 && (
          <>
            <p className="muted small">{t('Written these ways in your meetings. Take one out if it\'s someone else.')}</p>
            <ul className="mi-written">
              {data.written.map((w) => <li key={w.key}><span>{w.name}</span><button type="button" className="btn small" onClick={() => split(w.key)} aria-label={t('Take {name} out', { name: w.name })}>{t('Not them')}</button></li>)}
            </ul>
          </>
        )}
        {data.others.length > 0 && (
          <div className="mi-merge">
            <select value={other} onChange={(e) => setOther(e.target.value)} aria-label={t('Someone else who is the same person')}>
              <option value="">{t('The same person as…')}</option>
              {data.others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button type="button" className="btn small" disabled={!other} onClick={merge}>{t('Put together')}</button>
          </div>
        )}
        {msg && <p className={`small ${msg.error ? 'error-text' : 'muted'}`} role="status">{msg.text}</p>}
      </section>
    </div>
  )
}
