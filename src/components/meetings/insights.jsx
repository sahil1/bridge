import { useState } from 'react'
import Icon from '../Icon.jsx'
import { usePoll } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'
import { usePersisted, useWidth } from '../layout.jsx'

// Meeting Insights, the Meetings section's second tab (a beta feature, meeting-insights): your
// meetings added up the way Usage adds up tokens. Tiles against the days before, the weeks split
// into series and one-off meetings, when in the week you meet, where the time goes (by day, series
// and people, as a calendar's time insights have it), your share of the talk and the signals. The
// server works it all out from the transcripts and invites on this computer (server/meetinsights.js);
// each number says what it's based on, and none scores anyone. People is in people.jsx.

const RANGES = [['30', tx('30 days')], ['90', tx('90 days')], ['180', tx('6 months')], ['365', tx('Year')], ['all', tx('All')]]
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
const DAY = 864e5
// Under this many, the parts that need more say what's coming instead.
const ENOUGH = 5

export const num = (n) => Math.round(n).toLocaleString(locale())
const compact = (n) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n)
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
export const hours = (s) => { const m = Math.round(s / 60); return m < 60 ? t('{n} min', { n: m }) : t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) }
// A short stretch of time: seconds under a minute, else as hours() has it.
const span = (s) => (s < 59.5 ? t('{n} s', { n: Math.round(s) }) : hours(s))
// A round number at or above x (1, 2, 2.5 or 5 times a power of ten), for the top of a chart.
export const nice = (x) => { if (!(x > 0)) return 1; const p = 10 ** Math.floor(Math.log10(x)); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= x * 0.999) }
export const day = (iso, o = { month: 'short', day: 'numeric' }) => new Date(iso.length === 10 ? `${iso}T12:00` : iso).toLocaleDateString(locale(), o)
export const when = (iso) => new Date(iso).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
// A weekday by its number, Monday first (1 January 2024 was a Monday), and an hour, in your language.
export const weekday = (i, o = 'short') => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: o })
const hourName = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(locale(), { hour: 'numeric' })
const meetingsN = (n) => (n === 1 ? t('{n} meeting', { n }) : t('{n} meetings', { n }))

// Against the days before: up or down and by how much, in plain ink (more meetings isn't better or
// worse). by: 'pct' of what it was, or 'points' of a share.
export function Trend({ now, before, days, by = 'pct' }) {
  if (before == null || days === 'all') return null
  if (by === 'pct' && !before) return now ? <span>{t('none in the {days} days before', { days })}</span> : null
  const d = by === 'points' ? Math.round(now - before) : Math.round(((now - before) / before) * 100)
  if (!d) return <span className="mi-same">{by === 'points' ? t('as much as the {days} days before', { days }) : t('as many as the {days} days before', { days })}</span>
  const text = by === 'points' ? t('{n} points vs prior {d}d', { n: Math.abs(d), d: days }) : t('{pct}% vs prior {n}d', { pct: Math.abs(d), n: days })
  return <span className={d > 0 ? 'up' : 'down'}>{d > 0 ? '▲' : '▼'} {text}</span>
}

// A tile: what it counts, the number, and under it the trend or what it's out of. spark: the weeks,
// as small columns along its foot.
export function Tile({ label, value, sub, why, spark }) {
  const top = spark ? Math.max(...spark, 0) || 1 : 1
  return (
    <div className={`us-tile mi-tile${spark ? ' has-spark' : ''}`} title={why || undefined}>
      <span className="us-tile-label">{label}</span>
      <span className="us-tile-val num">{value}</span>
      {sub && <span className="us-tile-sub">{sub}</span>}
      {spark && <span className="mi-spark" aria-hidden="true">{spark.map((v, i) => <i key={i} style={{ height: `${Math.max(v ? 8 : 0, (v / top) * 100)}%` }} />)}</span>}
    </div>
  )
}

// The weeks as columns, Monday to Sunday, the last one this week so far (fainter: it isn't over).
// Hours and meetings split into the part in a series (at the foot) and one-off meetings; words, yours
// over what you heard. A line at the top and the middle with what it's worth, the average week as a
// dashed line, and what a week came to on hover (this week's, until then). Only as many dates under
// them as fit.
function WeekBars({ weeks, metric }) {
  const [hover, setHover] = useState(null)
  const [ref, width] = useWidth()
  const val = (w) => (metric === 'hours' ? w.seconds / 3600 : metric === 'meetings' ? w.n : metric === 'share' ? pct(w.you, w.talk) : w.words + w.heard)
  const inSeries = (w) => (metric === 'hours' ? w.rec / 3600 : w.recN)
  const top = metric === 'share' ? 100 : nice(Math.max(...weeks.map(val), 0))
  const axis = (v) => (metric === 'hours' ? t('{n} h', { n: (Math.round(v * 10) / 10).toLocaleString(locale()) }) : metric === 'share' ? `${v}%` : metric === 'words' ? compact(v) : num(v))
  const read = (w) => (metric === 'hours' ? (w.rec && w.rec < w.seconds ? t('{time}, {part} of it in a series', { time: hours(w.seconds), part: hours(w.rec) }) : hours(w.seconds))
    : metric === 'meetings' ? meetingsN(w.n)
      : metric === 'share' ? (w.talk ? t('you spoke {pct}% of the talk', { pct: pct(w.you, w.talk) }) : t('who spoke isn\'t known'))
        : t('{you} words spoken by you, {heard} heard', { you: num(w.words), heard: num(w.heard) }))
  const last = weeks.length - 1
  const at = hover ?? last
  const say = (i) => `${i === last ? t('This week so far') : t('Week of {date}', { date: day(weeks[i].week) })}: ${read(weeks[i])}`
  // The average of the weeks that are over, for hours and meetings.
  const over = weeks.slice(0, -1)
  const avg = (metric === 'hours' || metric === 'meetings') && over.length >= 2 ? over.reduce((a, w) => a + val(w), 0) / over.length : null
  // Dates counted back from this week, so it always has one and they're evenly spaced.
  const every = Math.max(1, Math.ceil(weeks.length / Math.max(2, Math.floor((width || 600) / 58))))
  const name = t(METRICS.find((m) => m[0] === metric)[1])
  const split = metric === 'hours' || metric === 'meetings'
  return (
    <div className="mi-weeks" ref={ref} onPointerLeave={() => setHover(null)}>
      <p className="mi-wread small" aria-live="polite">{say(at)}</p>
      <div className="mi-plot" role="img" aria-label={t('{metric} by week', { metric: name })}>
        {[1, 0.5].map((f) => <span key={f} className="mi-gl" style={{ bottom: `${f * 100}%` }}><i>{axis(top * f)}</i></span>)}
        {avg > 0 && <span className="mi-avg" style={{ bottom: `${(avg / top) * 100}%` }}><i>{t('average {n}', { n: metric === 'hours' ? hours(avg * 3600) : (Math.round(avg * 10) / 10).toLocaleString(locale()) })}</i></span>}
        {weeks.map((w, i) => {
          const h = `${Math.max(val(w) ? 3 : 0, (val(w) / top) * 100)}%`
          return (
            <div key={w.week} className={`mi-wcol${hover === i ? ' hl' : ''}${i === last ? ' now' : ''}`} onPointerEnter={() => setHover(i)} title={say(i)}>
              {metric === 'words'
                ? <span className="mi-stack" style={{ height: h }}><i style={{ flexGrow: w.heard }} /><b style={{ flexGrow: w.words }} /></span>
                : split
                  ? <span className="mi-wbar split" style={{ height: h }}>{inSeries(w) > 0 && <b style={{ flexGrow: inSeries(w) }} />}{val(w) - inSeries(w) > 0 && <i style={{ flexGrow: val(w) - inSeries(w) }} />}</span>
                  : <span className="mi-wbar" style={{ height: h }} />}
            </div>
          )
        })}
      </div>
      <div className="mi-wdates" aria-hidden="true">
        {weeks.map((w, i) => <span key={w.week}>{(last - i) % every === 0 ? day(w.week) : ''}</span>)}
      </div>
    </div>
  )
}

// When in the week you meet: a square for each weekday and hour (8 to 6 at least, wider when your
// meetings are), darker for more time in meetings in it over the range, at the quartiles of the
// hours that have any, in Usage's heatmap colors. On hover: the hour, the time and how many meetings.
// Its squares are mi-cell, not Usage's hm: Home's page is .hm too, and its height would stretch them.
function HourMap({ cells }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const by = new Map(cells.map((c) => [c[0] * 24 + c[1], c]))
  const hs = cells.map((c) => c[1])
  const h0 = Math.min(8, ...hs), h1 = Math.max(18, ...hs.map((h) => h + 1))
  const n = h1 - h0
  const LEFT = 34, TOP = 16, GAP = 3
  const cw = Math.max(9, Math.min(34, Math.floor((width - LEFT) / n) - GAP))
  const ch = Math.max(14, Math.min(22, cw))
  const vals = cells.map((c) => c[2]).filter((v) => v > 0).sort((a, b) => a - b)
  const q = [0.25, 0.5, 0.75].map((p) => vals[Math.floor(p * (vals.length - 1))] || 0)
  const lvl = (v) => (v <= 0 ? 0 : v <= q[0] ? 1 : v <= q[1] ? 2 : v <= q[2] ? 3 : 4)
  const W = LEFT + n * (cw + GAP), H = TOP + 7 * (ch + GAP)
  const every = cw + GAP < 30 ? 3 : 2
  const hv = hover && by.get(hover.d * 24 + hover.h)
  const legend = t('Less {scale} More').split('{scale}')
  // Drawn once its room is known, so it's never wider than the card for a moment.
  if (!width) return <div className="us-heat mi-heat" ref={ref} />
  return (
    <div className="us-heat mi-heat" ref={ref}>
      <svg width={W} height={H} role="img" aria-label={t('Time in meetings by weekday and hour')} onPointerLeave={() => setHover(null)}>
        {Array.from({ length: n }, (_, i) => h0 + i).filter((h) => h % every === 0).map((h) => <text key={h} x={LEFT + (h - h0) * (cw + GAP)} y={10} className="axis-label">{hourName(h)}</text>)}
        {Array.from({ length: 7 }, (_, d) => <text key={d} x={0} y={TOP + d * (ch + GAP) + ch - 4} className="axis-label">{weekday(d)}</text>)}
        {Array.from({ length: 7 }, (_, d) => Array.from({ length: n }, (_, i) => {
          const h = h0 + i, c = by.get(d * 24 + h)
          const x = LEFT + i * (cw + GAP), y = TOP + d * (ch + GAP)
          return <rect key={`${d}-${h}`} x={x} y={y} width={cw} height={ch} rx="3" className={`mi-cell l${lvl(c?.[2] || 0)}${hover?.d === d && hover?.h === h ? ' hl' : ''}`} onPointerEnter={() => setHover({ d, h, x, y })} />
        }))}
      </svg>
      {hover && (
        <div className="tooltip us-tip" style={{
          ...(hover.x < (width || W) / 2 ? { left: hover.x } : { right: Math.max(0, (width || W) - hover.x - cw) }),
          ...(hover.y > H / 2 ? { top: hover.y - 6, transform: 'translateY(-100%)' } : { top: hover.y + ch + 6 }),
        }}>
          <div className="muted small">{`${weekday(hover.d, 'long')} · ${hourName(hover.h)}–${hourName((hover.h + 1) % 24)}`}</div>
          <div>{hv ? (hv[3] === 1 ? t('{time} in {n} meeting', { time: hours(hv[2]), n: hv[3] }) : t('{time} in {n} meetings', { time: hours(hv[2]), n: hv[3] })) : t('No meetings')}</div>
        </div>
      )}
      <div className="us-legend"><span>{legend[0].trim()}</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`hm-key l${l}`} />)}<span>{legend[1]?.trim()}</span></div>
    </div>
  )
}

// Columns with a name under each, the biggest marked, what one is on hover: Usage's By weekday.
function Cols({ rows, peak }) {
  const max = Math.max(...rows.map((r) => r.v), 0) || 1
  const [hover, setHover] = useState(null)
  return (
    <div className="us-cols mi-cols" onPointerLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <div key={r.key} className={`us-col${hover === i ? ' hl' : ''}${peak === i ? ' peak' : ''}`} onPointerEnter={() => setHover(i)} title={r.read}>
          <span className="us-col-bar"><span style={{ height: `${Math.max(r.v ? 3 : 0, (r.v / max) * 100)}%` }} /></span>
          <span className="us-col-label">{r.label}</span>
        </div>
      ))}
      <span className="us-cols-read">{hover != null ? rows[hover].read : ''}</span>
    </div>
  )
}

// A name in its own color, the same wherever it shows (People's map, lists, a person's page).
const hashOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) >>> 0; return h }
export const colorOf = (id) => `var(--series-${(hashOf(id) % 8) + 1})`
export const initial = (name) => (String(name).trim()[0] || '?').toUpperCase()
export const Avatar = ({ id, name, big = false }) => <span className={`mi-av${big ? ' big' : ''}`} style={{ '--av': colorOf(id) }} aria-hidden="true">{initial(name)}</span>

// Where the time goes, as a calendar's time insights put it: by day of the week, in a series or
// one-off, and with whom.
function WhereTime({ data, onPerson, onOpen, onPeople }) {
  const days = data.weekdays.map((w, i) => ({ key: i, label: weekday(i), v: w.days ? w.s / w.days : 0, read: t('{day}: {time} a day, on average', { day: weekday(i, 'long'), time: hours(w.days ? w.s / w.days : 0) }) }))
  const peak = days.reduce((b, d, i) => (d.v > days[b].v ? i : b), 0)
  const rec = data.recurring, one = data.oneoff
  const most = data.series[0]?.seconds || 1
  const topS = data.people[0]?.s || 1
  return (
    <section className="us-card us-wide mi-where">
      <div className="us-card-head"><h4>{t('Where the time goes')}</h4><span className="muted small">{t('Recorded meetings; the calendar\'s other meetings aren\'t counted.')}</span></div>
      <div className="us-grid ue-grid mi-where-grid">
        <div className="ue-part" data-part="days">
          <h5>{t('By day of the week')}</h5>
          <Cols rows={days} peak={days[peak].v ? peak : null} />
          {data.busiest && <p className="muted small mi-note">{(data.busiest.n === 1 ? t('Busiest: {date}, {time} in {n} meeting', { date: day(data.busiest.date, { weekday: 'short', month: 'short', day: 'numeric' }), time: hours(data.busiest.seconds), n: 1 }) : t('Busiest: {date}, {time} in {n} meetings', { date: day(data.busiest.date, { weekday: 'short', month: 'short', day: 'numeric' }), time: hours(data.busiest.seconds), n: data.busiest.n }))}</p>}
        </div>
        <div className="ue-part" data-part="series">
          <h5>{t('In a series, or one-off')}</h5>
          {rec.n ? (
            <>
              <div className="mi-split" role="img" aria-label={t('{a}% of the time in a series, {b}% one-off', { a: pct(rec.seconds, data.seconds), b: 100 - pct(rec.seconds, data.seconds) })}>
                <b style={{ flexGrow: rec.seconds }} /><i style={{ flexGrow: one.seconds }} />
              </div>
              <div className="mi-split-keys small">
                <span><i className="rec" />{t('In a series')} <b className="num">{pct(rec.seconds, data.seconds)}%</b> <span className="muted">{hours(rec.seconds)}</span></span>
                <span><i />{t('One-off')} <b className="num">{100 - pct(rec.seconds, data.seconds)}%</b> <span className="muted">{hours(one.seconds)}</span></span>
              </div>
              <ul className="us-list mi-series">
                {data.series.slice(0, 5).map((s) => (
                  <li key={s.key}>
                    <button type="button" className="ue-row" onClick={() => onOpen?.(s.id)} title={t('Open the latest, {date}', { date: day(s.last) })}>
                      <span className="ue-top"><span className="ue-name"><Icon name="repeat" size={11} className="muted" /><span className="ue-nm">{s.title}</span></span><span className="ue-nums"><span className="num">{hours(s.seconds)}</span><span className="num muted">×{s.n}</span></span></span>
                      <span className="us-row-bar"><span style={{ width: `${(s.seconds / most) * 100}%` }} /></span>
                    </button>
                  </li>
                ))}
              </ul>
              {rec.series > 5 && <p className="muted small mi-note">{t('and {n} more series', { n: rec.series - 5 })}</p>}
            </>
          ) : <p className="muted small mi-soon" role="status">{t('After 3 meetings with the same name, the series you meet in show here, with their time.')}</p>}
        </div>
        <div className="ue-part" data-part="people">
          <h5>{t('Who you meet most')}</h5>
          {data.people.length ? (
            <>
              <ul className="us-list">
                {data.people.slice(0, 6).map((p) => (
                  <li key={p.id}>
                    <button type="button" className="ue-row mi-who" onClick={() => onPerson?.(p.id)} title={t('Open {name}', { name: p.name })}>
                      <span className="ue-top"><span className="ue-name"><Avatar id={p.id} name={p.name} /><span className="ue-nm">{p.name}</span></span><span className="ue-nums"><span className="num">{hours(p.s)}</span><span className="num muted">×{p.n}</span></span></span>
                      <span className="us-row-bar"><span style={{ width: `${(p.s / topS) * 100}%`, background: colorOf(p.id) }} /></span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="ghost-btn mi-all" onClick={onPeople}>{data.met.n === 1 ? t('{n} person in this range', { n: 1 }) : t('All {n} people in this range', { n: data.met.n })} <Icon name="chevron" size={11} /></button>
            </>
          ) : <p className="muted small mi-soon" role="status">{t('After 3 meetings with invites, the people you meet most show here, by the time you spend together.')}</p>}
        </div>
      </div>
    </section>
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

export function InsightsView({ onPerson, onOpen, onPeople }) {
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
        <p className="muted small">{t('After 5 meetings: when in the week you meet, the series that take your time and who you spend it with.')}</p>
        {data.recording > 0 && <p className="muted small">{t("The one recording now is counted once it ends.")}</p>}
      </div>
    )
  }
  const talk = data.talk.you + data.talk.others + data.talk.unknown
  const prev = data.prev
  const more = prev ? data.meetings - prev.meetings : null
  const known = data.byKind.filter((k) => k.talk > 0)
  const nDays = data.days === 'all' ? Math.max(1, Math.round((Date.now() - Date.parse(`${data.from}T00:00`)) / DAY)) : data.days
  const perWeek = data.seconds / Math.max(1, nDays / 7)
  const recPct = pct(data.recurring.seconds, data.seconds)
  const youPct = pct(data.talk.you, talk)
  const busiestWeek = data.weeks.reduce((b, w) => (!b || w.seconds > b.seconds ? w : b), null)
  return (
    <div className="mi">
      <p className="muted small mi-lede">{data.total === 1 ? t('Worked out on this computer from {n} recorded meeting, its transcript and invite. Nothing here is sent anywhere, and none of it is a score of anyone.', { n: data.total }) : t('Worked out on this computer from {n} recorded meetings, their transcripts and invites. Nothing here is sent anywhere, and none of it is a score of anyone.', { n: data.total })}{data.archived ? ` ${t('Archived meetings are left out, as they are from search.')}` : ''}{data.failed ? ` ${data.failed === 1 ? t("{n} meeting couldn't be read, so it isn't counted.", { n: data.failed }) : t("{n} meetings couldn't be read, so they aren't counted.", { n: data.failed })}` : ''}</p>
      {data.total < ENOUGH && <p className="mi-soon-bar small" role="status"><Icon name="info" size={13} /> <span>{t('{n} of {of} meetings so far. After {of}, Insights shows when in the week you meet, the series that take your time and who you spend it with.', { n: data.total, of: ENOUGH })}</span></p>}
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
      {!data.meetings ? <p className="muted small mi-none" role="status">{kind === 'all' ? t('No recorded meetings in this range. A longer range, or All, has the ones before it.') : t('No meetings of this kind in this range.')}</p> : (
        <>
          <div className="us-tiles mi-tiles">
            <Tile label={t('Meetings')} value={num(data.meetings)} why={t('Recorded meetings; the calendar\'s other meetings aren\'t counted.')} spark={data.weeks.slice(-12).map((w) => w.n)}
              sub={more == null ? t('since {date}', { date: day(data.from, { month: 'short', day: 'numeric', year: 'numeric' }) }) : !prev.meetings ? t('none in the {days} days before', { days: data.days }) : <span className={more > 0 ? 'up' : more < 0 ? 'down' : ''}>{more > 0 ? `▲ ${t('{n} more than the {days} days before', { n: more, days: data.days })}` : more < 0 ? `▼ ${t('{n} fewer than the {days} days before', { n: -more, days: data.days })}` : t('as many as the {days} days before', { days: data.days })}</span>} />
            <Tile label={t('Time in meetings')} value={hours(data.seconds)} why={t('How long each was recorded.')} spark={data.weeks.slice(-12).map((w) => w.seconds)}
              sub={(prev && prev.meetings ? <Trend now={data.seconds} before={prev.seconds} days={data.days} /> : null) || t('{time} a meeting, on average', { time: hours(data.seconds / data.meetings) })} />
            <Tile label={t('A week, on average')} value={hours(perWeek)} why={t('Time in meetings over the weeks in this range, the ones without meetings too.')} sub={busiestWeek?.seconds ? t('the most: {time}, week of {date}', { time: hours(busiestWeek.seconds), date: day(busiestWeek.week) }) : null} />
            <Tile label={t('People you met')} value={num(data.met.n)} why={t('Everyone invited or named on a transcript, you left out, and rooms, groups and mailboxes left out too.')}
              sub={data.met.fresh != null ? t('{n} for the first time', { n: data.met.fresh }) : data.meetings === 1 ? t('in {n} meeting', { n: 1 }) : t('in {n} meetings', { n: data.meetings })} />
            <Tile label={t('In a series')} value={data.recurring.n ? `${recPct}%` : '–'} why={t(KIND_WHY.recurring)}
              sub={data.recurring.n ? (data.recurring.series === 1 ? t('of the time, in {n} series', { n: 1 }) : t('of the time, in {n} series', { n: data.recurring.series })) : t('none yet')} />
            <Tile label={t('You spoke')} value={data.talk.told ? `${youPct}%` : '–'} why={talkBasis(data)} spark={data.talk.told ? data.weeks.slice(-12).map((w) => pct(w.you, w.talk)) : null}
              sub={!data.talk.told ? t('who spoke isn\'t known') : (prev?.talk.told ? <Trend now={youPct} before={pct(prev.talk.you, prev.talk.all)} days={data.days} by="points" /> : null) || t('of the talk · {time}', { time: hours(data.talk.you) })} />
          </div>
          <p className="muted small mi-basis" data-basis="talk"><Icon name="info" size={12} /> <span>{talkBasis(data)}</span></p>
          <div className="us-grid mi-grid">
            <section className="us-card us-wide">
              <div className="us-card-head">
                <h4>{t('Time in meetings by week')}</h4>
                <div className="seg small-seg" role="tablist" aria-label={t('Show')}>
                  {METRICS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={metric === k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{t(l)}</button>)}
                </div>
              </div>
              <WeekBars weeks={data.weeks} metric={metric} />
              <p className="muted small mi-note">
                {metric === 'words' && <><span className="mi-key"><i className="mine" />{t('Words you spoke')}</span><span className="mi-key"><i />{t('Words heard')}</span></>}
                {(metric === 'hours' || metric === 'meetings') && <><span className="mi-key"><i className="mine" />{t('In a series')}</span><span className="mi-key"><i className="one" />{t('One-off')}</span></>}
                <span>{metric === 'share' || metric === 'words' ? t('Only meetings where who spoke is known.') : t('Recorded meetings; the calendar\'s other meetings aren\'t counted.')}</span>
              </p>
            </section>
            <WhereTime data={data} onPerson={onPerson} onOpen={onOpen} onPeople={onPeople} />
            <section className="us-card">
              <div className="us-card-head"><h4>{t('When you meet')}</h4>{data.meetings >= ENOUGH && data.heat.length > 0 && <span className="muted small">{(() => { const c = data.heat.reduce((b, x) => (x[2] > b[2] ? x : b)); return t('most: {day} {hour}', { day: weekday(c[0]), hour: hourName(c[1]) }) })()}</span>}</div>
              {data.meetings >= ENOUGH ? <HourMap cells={data.heat} /> : <p className="muted small mi-soon" role="status">{t('After 5 meetings, the days and hours you meet most show here ({n} so far).', { n: data.meetings })}</p>}
              <p className="muted small mi-note">{t('Each meeting from its start, for as long as it was recorded.')}</p>
            </section>
            <section className="us-card">
              <div className="us-card-head"><h4>{t('Your share of the talk, by kind')}</h4></div>
              {known.length ? (
                <ul className="us-list">
                  <li className="mi-colhead" aria-hidden="true"><span /><span /><span>{t('You spoke')}</span><span>{t('Meetings')}</span></li>
                  {known.map((k) => (
                    <li key={k.id}>
                      <div className="us-row static mi-row" title={t(KIND_WHY[k.id])}>
                        <span className="us-row-name"><span className="us-ell">{t(KINDS[k.id])}</span></span>
                        <span className="us-row-bar"><span style={{ width: `${pct(k.you, k.talk)}%` }} /></span>
                        <span className="us-row-num num">{pct(k.you, k.talk)}%</span>
                        <span className="us-row-num num muted" title={meetingsN(k.n)}>{k.n}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small">{t('No meetings in this range where who spoke is known.')}</p>}
              {known.length > 0 && <p className="muted small mi-note">{t('Only meetings where who spoke is known.')}</p>}
            </section>
            <Signals s={data.signals} prev={prev?.signals} days={data.days} />
          </div>
        </>
      )}
    </div>
  )
}

// The signals, each a tile with what it's worked out from under it (and on hover), against the days
// before where that says something, and a bar for the ones that are some out of many.
function Signals({ s, prev, days }) {
  const per = (x) => (x.meetings ? Math.round((x.n / x.meetings) * 10) / 10 : null)
  const list = [
    { id: 'questions', icon: 'chat', name: t('Questions you asked'), value: s.questions.meetings ? t('{n} a meeting', { n: per(s.questions).toLocaleString(locale()) }) : '–',
      trend: prev?.questions.meetings && s.questions.meetings ? <Trend now={per(s.questions)} before={per(prev.questions)} days={days} /> : null, how: t('Your lines with a question mark, in meetings where who spoke is known.') },
    { id: 'longest', icon: 'mic', name: t('Your longest stretch'), value: s.longest.meetings ? span(s.longest.s) : '–',
      trend: prev?.longest.meetings && s.longest.meetings ? <Trend now={s.longest.s} before={prev.longest.s} days={days} /> : null, how: t('Your longest run of talking with nobody else between, on average.') },
    { id: 'ranOver', icon: 'clock', name: t('Meetings that ran over'), value: s.ranOver.of ? t('{n} of {of}', { n: s.ranOver.n, of: s.ranOver.of }) : '–', of: s.ranOver.of ? s.ranOver.n / s.ranOver.of : null,
      how: t("The recording's end against the invite's, 5 minutes or more past it. Only meetings with an invite's times.") },
    { id: 'backToBack', icon: 'calendar', name: t('Back to back'), value: !s.backToBack.days ? t('none') : s.backToBack.days === 1 ? t('{n} day', { n: 1 }) : t('{n} days', { n: s.backToBack.days }),
      how: t('Days with 3 or more recorded meetings under 5 minutes apart.') },
    { id: 'followed', icon: 'check', name: t('Followed through'), value: s.followed.of ? t('{n} of {of}', { n: s.followed.done, of: s.followed.of }) : '–', of: s.followed.of ? s.followed.done / s.followed.of : null,
      how: t('Your action items from the summaries, ticked or marked done.') },
    { id: 'attention', icon: 'eye', name: t('Attention, productivity'), value: <i>{t('not shown')}</i>, off: true, how: t("Nothing in a recording shows them, and Bridge AI won't guess.") },
  ]
  return (
    <section className="us-card us-wide">
      <div className="us-card-head"><h4>{t('Signals, and what each is based on')}</h4><span className="muted small">{t('A mirror for you; nothing here scores anyone')}</span></div>
      <div className="mi-signals" role="list">
        {list.map((x) => (
          <div key={x.id} role="listitem" className={`mi-signal${x.off ? ' off' : ''}`} data-signal={x.id} title={x.how}>
            <span className="mi-sig-name"><Icon name={x.icon} size={12} /> {x.name}</span>
            <b className="num mi-sig-val">{x.value}</b>
            {x.of != null && <span className="mi-sig-bar" aria-hidden="true"><span style={{ width: `${Math.round(x.of * 100)}%` }} /></span>}
            {x.trend && <span className="mi-sig-trend small">{x.trend}</span>}
            <span className="muted small mi-sig-how">{x.how}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
