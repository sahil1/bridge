import { Fragment, useId, useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'
import { usePersisted, useWidth } from '../layout.jsx'
import { CalendarSetup } from '../Agenda.jsx'
import { Fold } from './tools.jsx'
import { Avatar, Tile, colorOf, day, hours, num, when } from './insights.jsx'

// People, the Meetings section's third tab (a beta feature, meeting-insights): everyone you've met,
// from invites and the names on transcripts, for hundreds of them. A picker that finds anyone as you
// type (the people you met last and most first), a map of who you meet most and who of them meet
// each other, everyone by when you last met, and a person's own page: your meetings together over
// time and by series, what you talk about, and the action items open either way.

const DAY = 864e5
// In a group, this many before Show all.
const SHOWN = 12
const meetingsN = (n) => (n === 1 ? t('{n} meeting', { n }) : t('{n} meetings', { n }))
const agoDays = (iso) => (iso ? (Date.now() - Date.parse(iso)) / DAY : Infinity)
// Met often, but not lately: 3 or more meetings, none in six weeks.
const lapsed = (p) => p.meetings >= 3 && agoDays(p.last) > 42
const isNew = (p) => agoDays(p.first) <= 30

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

// What matched in a name, marked.
function Marked({ text, q }) {
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (at < 0) return text
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>
}

// Find someone among hundreds: type and the list narrows (a name's start first, then a word's, then
// anywhere, and the ways it's written and their addresses), the people met most first among equals.
// With nothing typed, the people you met last and the ones you meet most. Arrows and Enter pick.
export function PersonPicker({ people, onPick, exclude = null, placeholder, label }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const id = useId()
  const s = q.trim().toLowerCase()
  const found = useMemo(() => {
    const pool = people.filter((p) => p.id !== exclude)
    if (!s) {
      const recent = pool.filter((p) => p.last).sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 4)
      const most = pool.filter((p) => !recent.includes(p)).sort((a, b) => b.meetings - a.meetings).slice(0, 6)
      return [...recent.map((p) => ({ p, group: 'recent' })), ...most.map((p) => ({ p, group: 'most' }))]
    }
    const score = (p) => {
      const n = p.name.toLowerCase()
      if (n.startsWith(s)) return 4
      if (n.split(/[\s.-]+/).some((w) => w.startsWith(s))) return 3
      if (n.includes(s)) return 2
      return [...(p.also || []), ...(p.emails || [])].some((x) => x.toLowerCase().includes(s)) ? 1 : 0
    }
    return pool.map((p) => ({ p, k: score(p) })).filter((x) => x.k).sort((a, b) => b.k - a.k || b.p.meetings - a.p.meetings || a.p.name.localeCompare(b.p.name)).map(({ p }) => ({ p }))
  }, [people, s, exclude])
  const shown = found.slice(0, 50)
  const pick = (p) => { setQ(''); setOpen(false); setAt(0); onPick(p) }
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAt((i) => Math.min(shown.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && open && shown[at]) { e.preventDefault(); pick(shown[at].p) }
    else if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
  }
  return (
    <div className="mi-picker">
      <span className="mi-picker-box">
        <Icon name="search" size={13} />
        <input type="search" role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-activedescendant={open && shown[at] ? `${id}-${at}` : undefined}
          value={q} placeholder={placeholder} aria-label={label || placeholder}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={key} />
      </span>
      {open && (
        <div className="mi-picker-pop" id={id} role="listbox" aria-label={label || placeholder}>
          {shown.map((x, i) => (
            <Fragment key={x.p.id}>
              {x.group && x.group !== shown[i - 1]?.group && <div className="mi-picker-head" role="presentation">{x.group === 'recent' ? t('Met last') : t('Met most')}</div>}
              <button type="button" role="option" id={`${id}-${i}`} aria-selected={i === at} className={`mi-picker-opt${i === at ? ' on' : ''}`} data-person={x.p.id}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(x.p)} onPointerEnter={() => setAt(i)}>
                <Avatar id={x.p.id} name={x.p.name} />
                <span className="mi-picker-name"><Marked text={x.p.name} q={q.trim()} /></span>
                <span className="muted small num">{[meetingsN(x.p.meetings), x.p.last ? day(x.p.last) : null].filter(Boolean).join(' · ')}</span>
              </button>
            </Fragment>
          ))}
          {!shown.length && <p className="muted small mi-picker-none">{t('Nobody matches "{q}".', { q: q.trim() })}</p>}
          {found.length > shown.length && <p className="muted small mi-picker-none">{t('{n} more: keep typing', { n: found.length - shown.length })}</p>}
        </div>
      )}
    </div>
  )
}

// You at the middle and the people you meet most around you, bigger for more meetings together, and
// a line between two of them who were in two or more meetings together: who works with whom. Put
// round the ring so the ones who meet each other sit side by side. Pointing at one shows their lines.
function PeopleMap({ people, onPerson }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const W = Math.max(280, width || 520)
  const top = people.slice(0, W < 460 ? 8 : 12)
  const { order, links } = useMemo(() => {
    const sets = top.map((p) => new Set(p.meetingIds))
    const both = (i, j) => { let n = 0; for (const x of sets[i]) if (sets[j].has(x)) n++; return n }
    // Two who were in two or more meetings together, and in a good part of the meetings of whichever
    // of them has fewer; each keeps only their three strongest, so a team that meets daily isn't a
    // web of lines.
    const all = []
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) { const n = both(i, j); if (n >= 2 && n >= 0.3 * Math.min(top[i].meetings, top[j].meetings)) all.push([i, j, n]) }
    const strongest = (i) => all.filter(([a, b]) => a === i || b === i).sort((x, y) => y[2] - x[2]).slice(0, 3)
    const keep = new Set(top.flatMap((_, i) => strongest(i)))
    const pairs = all.filter((l) => keep.has(l))
    // Round the ring: each next to the one left that shares most with the last placed.
    const left = new Set(top.map((_, i) => i))
    const ring = [0]
    left.delete(0)
    while (left.size) {
      const lastOne = ring.at(-1)
      let best = null, most = -1
      for (const j of left) { const n = pairs.find(([a, b]) => (a === lastOne && b === j) || (a === j && b === lastOne))?.[2] || 0; if (n > most) { most = n; best = j } }
      ring.push(best)
      left.delete(best)
    }
    return { order: ring, links: pairs }
  }, [top.map((p) => p.id).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (top.length < 2) return null
  // Drawn once its room is known, so it's never wider than the card for a moment.
  if (!width) return <div className="mi-map-wrap" ref={ref} />
  const H = Math.round(Math.max(240, Math.min(320, W * 0.56)))
  const cx = W / 2, cy = H / 2
  const RX = Math.max(70, W / 2 - (W < 460 ? 86 : 110)), RY = H / 2 - 26
  const most = top[0].meetings || 1
  const strongest = Math.max(1, ...links.map((l) => l[2]))
  // Half a step round from the top, so none sits right above or below the middle with its name
  // running into the next one's.
  const pos = new Map(order.map((i, k) => { const a = ((k + 0.5) / top.length) * Math.PI * 2 - Math.PI / 2; return [i, { a, x: cx + Math.cos(a) * RX, y: cy + Math.sin(a) * RY }] }))
  const near = hover == null ? null : new Set([hover, ...links.filter(([a, b]) => a === hover || b === hover).flatMap(([a, b]) => [a, b])])
  const withWho = (i) => links.filter(([a, b]) => a === i || b === i).sort((x, y) => y[2] - x[2]).slice(0, 3).map(([a, b]) => top[a === i ? b : a].name.split(' ')[0])
  return (
    <div className="mi-map-wrap" ref={ref}>
      <svg className="mi-map" width={W} height={H} role="img" aria-label={t('You at the middle, and the people you meet most around you')} onPointerLeave={() => setHover(null)}>
        {links.map(([a, b, n]) => {
          const p = pos.get(a), q = pos.get(b)
          // Bowed toward the middle, so lines between neighbours don't hide under the names.
          const mx = (p.x + q.x) / 2 * 0.7 + cx * 0.3, my = (p.y + q.y) / 2 * 0.7 + cy * 0.3
          const lit = near && (a === hover || b === hover)
          return <path key={`${a}-${b}`} d={`M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`} className={`mi-map-link${lit ? ' lit' : ''}${near && !lit ? ' dim' : ''}`} style={{ strokeWidth: 1 + (n / strongest) * 2.5 }} />
        })}
        {top.map((p, i) => { const q = pos.get(i); return <line key={p.id} x1={cx} y1={cy} x2={q.x} y2={q.y} className={`mi-map-line${near && !near.has(i) ? ' dim' : ''}`} style={{ strokeWidth: 1 + (p.meetings / most) * 2 }} /> })}
        <circle cx={cx} cy={cy} r={20} className="mi-map-you" />
        <text x={cx} y={cy + 4} textAnchor="middle" className="mi-map-youtext">{t('You')}</text>
        {top.map((p, i) => {
          const { a, x, y } = pos.get(i)
          const right = Math.cos(a) >= -0.01
          const r = 7 + (p.meetings / most) * 10
          const who = withWho(i)
          return (
            <g key={p.id} className={`mi-map-node${near && !near.has(i) ? ' dim' : ''}`} onClick={() => onPerson(p.id)} onPointerEnter={() => setHover(i)} role="link" aria-label={p.name} data-person={p.id}>
              <title>{`${p.meetings === 1 ? t('{name}: {n} meeting together', { name: p.name, n: p.meetings }) : t('{name}: {n} meetings together', { name: p.name, n: p.meetings })}${who.length ? `. ${t('Often with {names}', { names: who.join(', ') })}` : ''}`}</title>
              <circle cx={x} cy={y} r={r} style={{ fill: colorOf(p.id) }} />
              <text x={x + (right ? r + 5 : -(r + 5))} y={y + 4} textAnchor={right ? 'start' : 'end'}>{`${p.name.split(' ')[0].slice(0, 12)} · ${p.meetings}`}</text>
            </g>
          )
        })}
      </svg>
      {links.length > 0 && <p className="muted small mi-note">{t('A line between two people: two or more meetings they were both in. Thicker for more.')}</p>}
    </div>
  )
}

// A person's last six months, a column each, this month last.
const Spark = ({ v }) => {
  const top = Math.max(1, ...v)
  return <span className="mi-pspark" aria-hidden="true">{v.map((x, i) => <i key={i} style={{ height: `${Math.max(x ? 14 : 4, (x / top) * 100)}%` }} className={x ? '' : 'none'} />)}</span>
}

function PersonRow({ p }) {
  const topics = [p.about, p.series, p.topics.length ? p.topics.join(', ') : null].filter(Boolean).join(' · ')
  return (
    <>
      <Avatar id={p.id} name={p.name} />
      <span className="mi-ptext">
        <b>{p.name}{isNew(p) && <span className="mi-badge">{t('new')}</span>}{lapsed(p) && <span className="mi-badge quiet" title={t('3 or more meetings together, none in six weeks')}>{t('not lately')}</span>}</b>
        {topics && <span className="muted small">{topics}</span>}
        <span className="muted small">{[t('last {date}', { date: day(p.last) }), p.next ? t('next {date}', { date: day(p.next.start, { weekday: 'short', month: 'short', day: 'numeric' }) }) : null, t('{time} together', { time: hours(p.seconds) })].filter(Boolean).join(' · ')}</span>
      </span>
      <Spark v={p.spark || []} />
      <span className="mi-pnum" title={p.share ? t('{n} meetings together · {pct}% of the talk, in the {m} where their lines are named', { n: p.meetings, pct: p.share.pct, m: p.share.meetings }) : t('{n} meetings together · their lines aren\'t named in any', { n: p.meetings })}>
        <span className="num">{meetingsN(p.meetings)}</span>
        {p.share && <span className="num muted">{t('{pct}% of the talk', { pct: p.share.pct })}</span>}
      </span>
    </>
  )
}

const SORTS = [['most', tx('Most met')], ['time', tx('Most time')], ['recent', tx('Recent')], ['name', tx('A–Z')]]
const sorter = {
  most: (a, b) => b.meetings - a.meetings || String(b.last).localeCompare(String(a.last)),
  time: (a, b) => b.seconds - a.seconds || b.meetings - a.meetings,
  recent: (a, b) => String(b.last).localeCompare(String(a.last)) || b.meetings - a.meetings,
  name: (a, b) => a.name.localeCompare(b.name, locale()),
}

export function PeopleView({ onOpen, person, setPerson }) {
  const { data, error, refresh } = usePoll('/meetings/people', 60_000)
  const [sort, setSort] = usePersisted('cc-mi-people-sort', 'most')
  const [folds, setFolds] = usePersisted('cc-mi-people-folds', {})
  const [full, setFull] = useState({}) // groups shown in full
  if (person) return <PersonPage id={person} onBack={() => { setPerson(null); refresh() }} onOpen={onOpen} onPerson={setPerson} />
  if (error && !data) return <p className="error-text small" role="alert">{error}</p>
  if (!data) return <div className="skeleton-rows"><div /><div /><div /></div>
  const all = data.people
  const by = sorter[sort] || sorter.most
  const groups = [
    { key: 'recent', label: t('Met in the last 2 weeks'), list: all.filter((p) => agoDays(p.last) <= 14) },
    { key: 'quarter', label: t('In the last 3 months'), list: all.filter((p) => agoDays(p.last) > 14 && agoDays(p.last) <= 92) },
    { key: 'earlier', label: t('Longer ago'), list: all.filter((p) => agoDays(p.last) > 92) },
  ].filter((g) => g.list.length).map((g) => ({ ...g, list: [...g.list].sort(by) }))
  const timeTop = [...all].sort(sorter.time).slice(0, 8)
  return (
    <div className="mi mi-people">
      {data.meetings > 0 && <p className="muted small mi-lede" data-basis="people">{data.meetings === 1 ? t('From who was invited to your {n} recorded meeting and the names on its transcript.', { n: data.meetings }) : t('From who was invited to your {n} recorded meetings and the names on their transcripts.', { n: data.meetings })} {t('Rooms, groups, mailboxes and you are left out. The same person written two ways is put together only when it\'s clear; open someone to put two together or take a name out.')}</p>}
      <CalendarNeeded cal={data.calendar} onCheck={() => refresh()} />
      {!all.length ? (
        <div className="mt-empty mi-empty" role="status">
          <Icon name="users" size={22} />
          <p><b>{t('Nobody here yet.')}</b></p>
          <p className="muted small">{data.meetings ? t('People come from who\'s invited to a meeting (from its calendar event, or added on its page) and the names on its transcript. None of your meetings has either yet.') : t('Record a meeting and the people in it show up here: how often you meet, when last and next, and what you talk about.')}</p>
          <p className="muted small">{t('After 3 meetings with invites, the people you meet most are ranked here, with who of them meet each other.')}</p>
        </div>
      ) : (
        <>
          <div className="us-tiles mi-tiles">
            <Tile label={t('People')} value={num(all.length)} sub={data.meetings === 1 ? t('in {n} recorded meeting', { n: 1 }) : t('in {n} recorded meetings', { n: data.meetings })} />
            <Tile label={t('Met in the last 30 days')} value={num(all.filter((p) => p.recent > 0).length)} sub={(() => { const n = new Set(all.flatMap((p) => (p.recent ? p.meetingIds.slice(0, p.recent) : []))).size; return n === 1 ? t('in {n} meeting', { n }) : t('in {n} meetings', { n }) })()} />
            <Tile label={t('New in the last 30 days')} value={num(all.filter(isNew).length)} sub={t('met for the first time')} />
            <Tile label={t('Not lately')} value={num(all.filter(lapsed).length)} sub={t('3 or more meetings, none in six weeks')} />
          </div>
          {all.length < 3 && <p className="mi-soon-bar small" role="status"><Icon name="info" size={13} /> <span>{t('After 3 meetings with invites, the people you meet most are ranked here, with who of them meet each other.')}</span></p>}
          <div className="us-grid mi-grid">
            {all.length >= 2 && (
              <section className="us-card">
                <div className="us-card-head"><h4>{t('Who you meet, and who meets whom')}</h4></div>
                <PeopleMap people={all} onPerson={setPerson} />
              </section>
            )}
            <section className="us-card">
              <div className="us-card-head"><h4>{t('Most time together')}</h4><span className="muted small">{t('all your meetings')}</span></div>
              <ul className="us-list">
                {timeTop.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="ue-row mi-who" onClick={() => setPerson(p.id)} title={t('Open {name}', { name: p.name })}>
                      <span className="ue-top"><span className="ue-name"><Avatar id={p.id} name={p.name} /><span className="ue-nm">{p.name}</span></span><span className="ue-nums"><span className="num">{hours(p.seconds)}</span><span className="num muted">×{p.meetings}</span></span></span>
                      <span className="us-row-bar"><span style={{ width: `${(p.seconds / (timeTop[0].seconds || 1)) * 100}%`, background: colorOf(p.id) }} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="mi-find">
            <PersonPicker people={all} onPick={(p) => setPerson(p.id)} placeholder={all.length === 1 ? t('Find someone') : t('Find someone among {n}', { n: all.length })} label={t('Find someone')} />
            <div className="seg small-seg" role="tablist" aria-label={t('Sort')}>
              {SORTS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{t(l)}</button>)}
            </div>
          </div>
          <div className="mi-groups">
            {groups.map((g, gi) => (
              <Fold key={g.key} id={`people-${g.key}`} label={g.label} count={g.list.length} open={g.key in folds ? folds[g.key] : gi < 2 || groups.length === 1} onToggle={(v) => setFolds((f) => ({ ...f, [g.key]: v }))}>
                <div className="mi-plist">
                  {(full[g.key] ? g.list : g.list.slice(0, SHOWN)).map((p) => <button key={p.id} type="button" className="mi-prow" data-person={p.id} onClick={() => setPerson(p.id)}><PersonRow p={p} /></button>)}
                </div>
                {g.list.length > SHOWN && <button type="button" className="ghost-btn mi-all" onClick={() => setFull((f) => ({ ...f, [g.key]: !f[g.key] }))}>{full[g.key] ? t('Show fewer') : t('Show all {n}', { n: g.list.length })} <Icon name={full[g.key] ? 'up' : 'down'} size={11} /></button>}
              </Fold>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// A person's meetings, by series (the one-off ones together) or by month, each folded with how many
// it has; with many, only the first open, and a search.
function MeetingGroups({ list, onOpen }) {
  const [by, setBy] = usePersisted('cc-mi-person-by', 'series')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})
  const [full, setFull] = useState({}) // groups shown in full
  const shown = q.trim() ? list.filter((m) => m.title.toLowerCase().includes(q.trim().toLowerCase())) : list
  const groups = []
  const at = new Map()
  for (const m of shown) {
    const key = by === 'month' ? m.start.slice(0, 7) : m.series || ':one'
    let g = at.get(key)
    if (!g) { g = { key, label: by === 'month' ? new Date(`${key}-15T12:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) : key === ':one' ? t('One-off meetings') : m.title, items: [] }; at.set(key, g); groups.push(g) }
    g.items.push(m)
  }
  if (by === 'series') groups.sort((a, b) => (a.key === ':one') - (b.key === ':one') || b.items.length - a.items.length)
  const many = shown.length > SHOWN && !q.trim()
  return (
    <section className="mi-sec">
      <div className="mi-sec-head">
        <h4>{t('Meetings')} <span className="muted num">{list.length}</span></h4>
        <div className="seg small-seg" role="tablist" aria-label={t('Group by')}>
          <button type="button" role="tab" aria-selected={by === 'series'} className={by === 'series' ? 'on' : ''} onClick={() => setBy('series')}>{t('By series')}</button>
          <button type="button" role="tab" aria-selected={by === 'month'} className={by === 'month' ? 'on' : ''} onClick={() => setBy('month')}>{t('By month')}</button>
        </div>
      </div>
      {list.length > SHOWN && <input className="mt-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a meeting')} aria-label={t('Find a meeting')} />}
      {groups.map((g, i) => (
        <Fold key={`${by}:${g.key}`} id={`mt-${by}-${g.key}`} label={<>{by === 'series' && g.key !== ':one' && <Icon name="repeat" size={11} className="muted" />}{g.label}</>} count={g.items.length} extra={t('latest {date}', { date: day(g.items[0].start) })}
          open={g.key in open ? open[g.key] : !many || i === 0} onToggle={(v) => setOpen((o) => ({ ...o, [g.key]: v }))}>
          <div className="mi-mlist">
            {(full[g.key] || q.trim() ? g.items : g.items.slice(0, SHOWN)).map((m) => (
              <button key={m.id} type="button" className="mi-mrow" data-meeting={m.id} onClick={() => onOpen?.(m.id)}>
                <span className="mi-ptext"><b>{m.title}</b><span className="muted small">{when(m.start)} · {hours(m.seconds)}{m.how?.spoke ? '' : ` · ${t('invited')}`}</span></span>
                <span className="mi-pnum num" title={m.pct == null ? t('Their lines aren\'t named in this one') : t('Their share of the talk in this one')}>{m.pct == null ? '–' : `${m.pct}%`}</span>
              </button>
            ))}
          </div>
          {g.items.length > SHOWN && !q.trim() && <button type="button" className="ghost-btn mi-all" onClick={() => setFull((f) => ({ ...f, [g.key]: !f[g.key] }))}>{full[g.key] ? t('Show fewer') : t('Show all {n}', { n: g.items.length })} <Icon name={full[g.key] ? 'up' : 'down'} size={11} /></button>}
        </Fold>
      ))}
      {q.trim() && !shown.length && <p className="muted small">{t('Nothing matches "{q}".', { q: q.trim() })}</p>}
    </section>
  )
}

// Action items still open, one of three kinds: yours that name them, theirs, others' that name them.
// The newest five, then Show all.
function Items({ title, list, onOpen, none }) {
  const [all, setAll] = useState(false)
  return (
    <div className="mi-items-part" data-items={title}>
      <h5>{title} <span className="muted num">{list.length}</span></h5>
      {list.length ? (
        <ul className="mi-items">
          {(all ? list : list.slice(0, 5)).map((x, i) => (
            <li key={i}>
              <span>{x.who && x.whose !== 'you' ? <b>{x.who}: </b> : null}{x.text}</span>
              <span className="mi-item-from small">
                <button type="button" className="mi-from" onClick={() => onOpen?.(x.meeting.id)} title={t('Open {name}', { name: x.meeting.title })}><Icon name="mic" size={11} /> {x.meeting.title} · {day(x.meeting.start)}</button>
                {x.meetings > 1 && <span className="muted">{t('and {n} earlier', { n: x.meetings - 1 })}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="muted small">{none}</p>}
      {list.length > 5 && <button type="button" className="ghost-btn mi-all" onClick={() => setAll((v) => !v)}>{all ? t('Show fewer') : t('Show all {n}', { n: list.length })} <Icon name={all ? 'up' : 'down'} size={11} /></button>}
    </div>
  )
}

function PersonPage({ id, onBack, onOpen, onPerson }) {
  const { data, error, refresh } = usePoll(`/meetings/people/${encodeURIComponent(id)}`, 60_000)
  const [other, setOther] = useState(null)
  const [msg, setMsg] = useState(null)
  const merge = async () => {
    if (!other) return
    try { const r = await api('/meetings/people/merge', { method: 'POST', body: { a: id, b: other.id } }); setOther(null); setMsg({ text: t('Put together') }); if (r.id !== id) onPerson(r.id); else refresh() } catch (e) { setMsg({ text: e.message, error: true }) }
  }
  const split = async (key) => {
    try { const r = await api('/meetings/people/split', { method: 'POST', body: { id, key } }); setMsg({ text: t('Taken out: that name is someone else now.') }); if (r.id && r.id !== id) onPerson(r.id); else refresh() } catch (e) { setMsg({ text: e.message, error: true }) }
  }
  const back = <button type="button" className="ghost-btn mi-back" onClick={onBack}><Icon name="back" size={14} /> {t('People')}</button>
  if (error && !data) return <div className="mi">{back}<p className="error-text small" role="alert">{error}</p></div>
  if (!data) return <div className="mi">{back}<div className="skeleton-rows"><div /><div /></div></div>
  const items = { you: data.items.filter((x) => x.whose === 'you'), them: data.items.filter((x) => x.whose === 'them'), other: data.items.filter((x) => x.whose === 'other') }
  const first = data.name.split(' ')[0]
  const months = data.months.map((m) => ({ key: m.month, label: new Date(`${m.month}-15T12:00`).toLocaleDateString(locale(), { month: 'narrow' }), v: m.n, read: `${new Date(`${m.month}-15T12:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}: ${meetingsN(m.n)}${m.n ? `, ${hours(m.seconds)}` : ''}` }))
  const recent = data.months.slice(-1)[0]?.n || 0
  return (
    <div className="mi mi-person">
      <div className="mi-person-bar">
        {back}
        {data.others.length > 0 && <PersonPicker people={data.others} onPick={(p) => onPerson(p.id)} placeholder={t('Someone else')} label={t('Find someone')} />}
      </div>
      <div className="mi-phead">
        <Avatar id={data.id} name={data.name} big />
        <div>
          <h3>{data.name}</h3>
          {(data.about || data.emails.length > 0) && <p className="muted small">{[data.about, ...data.emails].filter(Boolean).join(' · ')}</p>}
          {data.series && <p className="small mi-pseries"><Icon name="repeat" size={11} /> {t('Mostly in {series}', { series: data.series })}</p>}
        </div>
      </div>
      <div className="us-tiles mi-tiles">
        <Tile label={t('Meetings together')} value={num(data.meetings)} sub={data.recent ? t('{n} in the last 30 days', { n: data.recent }) : t('last {date}', { date: day(data.last) })} />
        <Tile label={t('Time together')} value={hours(data.seconds)} sub={t('{time} a meeting, on average', { time: hours(data.seconds / Math.max(1, data.meetings)) })} why={t('How long those meetings were recorded.')} />
        <Tile label={t('Their share of the talk')} value={data.share ? `${data.share.pct}%` : '–'}
          sub={data.share ? (data.share.meetings === 1 ? t('in {n} meeting where their lines are named', { n: data.share.meetings }) : t('in {n} meetings where their lines are named', { n: data.share.meetings })) : t('their lines aren\'t named in any')} />
        <Tile label={t('Next')} value={data.next ? day(data.next.start, { weekday: 'short', month: 'short', day: 'numeric' }) : '–'} why={data.next ? t('Next: {title}, {when}', { title: data.next.title, when: when(data.next.start) }) : undefined}
          sub={data.next ? <span data-next="1">{`${new Date(data.next.start).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })} · ${data.next.title}`}</span> : data.calendar?.ok ? t('nothing with them in the next 30 days') : t('needs your calendar')} />
      </div>
      <CalendarNeeded cal={data.calendar} onCheck={() => refresh()} />
      <div className="us-grid mi-grid">
        <section className="us-card">
          <div className="us-card-head"><h4>{t('Meetings together, by month')}</h4><span className="muted small">{recent ? t('{n} this month', { n: recent }) : t('the last 12 months')}</span></div>
          <div className="us-cols mi-cols mi-months">
            {months.map((m, i) => (
              <div key={m.key} className={`us-col${i === months.length - 1 ? ' peak' : ''}`} title={m.read}>
                <span className="us-col-bar"><span style={{ height: `${Math.max(m.v ? 6 : 0, (m.v / Math.max(1, ...months.map((x) => x.v))) * 100)}%` }} /></span>
                <span className="us-col-label">{m.label}</span>
              </div>
            ))}
          </div>
          {data.before > 0 && <p className="muted small mi-note">{data.before === 1 ? t('and {n} meeting before that', { n: 1 }) : t('and {n} meetings before that', { n: data.before })}</p>}
        </section>
        <section className="us-card">
          <div className="us-card-head"><h4>{t('What you talk about')}</h4></div>
          {data.topics.length > 0
            ? <div className="mi-topics">{data.topics.map((x) => <span key={x} className="chip">{x}</span>)}</div>
            : <p className="muted small">{t('Nothing yet: topics come from the summaries of your meetings with them.')}</p>}
          <p className="muted small mi-note">{t('Words from the summaries of your meetings with them.')}</p>
        </section>
        <section className="us-card us-wide mi-sec">
          <div className="us-card-head"><h4>{t('Open action items')}</h4><span className="muted small">{t('From the summaries, not ticked yet')}</span></div>
          <div className="mi-items-grid">
            <Items title={t('Yours, for {name}', { name: first })} list={items.you} onOpen={onOpen} none={t('None of yours names them.')} />
            <Items title={t("{name}'s", { name: first })} list={items.them} onOpen={onOpen} none={t('None open.')} />
            {items.other.length > 0 && <Items title={t('Others that name {name}', { name: first })} list={items.other} onOpen={onOpen} none="" />}
          </div>
        </section>
      </div>
      <MeetingGroups list={data.meetingsList} onOpen={onOpen} />
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
            {other ? (
              <>
                <span className="mi-merge-pick"><Avatar id={other.id} name={other.name} /> <b>{other.name}</b> <span className="muted small">{meetingsN(other.meetings)}</span></span>
                <button type="button" className="btn small primary" onClick={merge}>{t('Put together')}</button>
                <button type="button" className="ghost-btn" onClick={() => setOther(null)}>{t('Cancel')}</button>
              </>
            ) : <PersonPicker people={data.others} onPick={setOther} placeholder={t('The same person as…')} label={t('Someone else who is the same person')} />}
          </div>
        )}
        {msg && <p className={`small ${msg.error ? 'error-text' : 'muted'}`} role="status">{msg.text}</p>}
      </section>
    </div>
  )
}
