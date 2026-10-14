import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useWidth } from './layout.jsx'
import { Updated } from './Trackers.jsx'
import { usePoll } from '../api.js'
import { fmtTokens } from './Usage.jsx'

// Usage stats: a year of activity as a heatmap, plus totals, streaks, models, projects and
// the hours and weekdays you work, filtered by range, model and project.
const fmtCost = (n) => `$${n >= 1000 ? Math.round(n).toLocaleString() : n >= 100 ? n.toFixed(0) : n.toFixed(2)}`
const fmtNum = (n) => (n >= 1e4 ? fmtTokens(n) : Math.round(n).toLocaleString())
const DAY = 864e5
const ymd = (d) => d.toLocaleDateString('en-CA')
const at = (s) => new Date(`${s}T12:00`)
const fmtDate = (s, o = { month: 'short', day: 'numeric' }) => at(s).toLocaleDateString([], o)
const RANGES = [['7', '7D'], ['30', '30D'], ['90', '90D'], ['180', '6M'], ['all', 'All']]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SLOTS = 8 // named model colors; the rest share "Other"

const METRICS = {
  tokens: { label: 'Tokens', fmt: fmtTokens, filtered: true },
  cost: { label: 'Cost', fmt: fmtCost, filtered: true },
  messages: { label: 'Messages', fmt: fmtNum },
  sessions: { label: 'Sessions', fmt: fmtNum },
}

function useStats(provider) {
  const { data, error, refresh } = usePoll(`/usage/${provider}/stats`, 10 * 60 * 1000)
  return { data: data?.provider === provider ? data : null, error, refresh }
}

// Per-day totals for the current model/project filter, from the [date, project, model, tokens, cost] cells.
function filteredDays(data, model, project) {
  const by = new Map(data.days.map((d) => [d.date, { ...d, tokens: 0, cost: 0, byModel: {} }]))
  for (const [date, p, m, t, c] of data.cells) {
    if (model !== 'all' && data.models[m] !== model) continue
    if (project !== 'all' && data.projects[p].id !== project) continue
    const d = by.get(date)
    if (!d) continue
    d.tokens += t
    d.cost += c
    d.byModel[m] = (d.byModel[m] || 0) + t
  }
  return [...by.values()]
}

function streaks(days) {
  let cur = 0, best = 0, run = 0
  for (const d of days) { run = d.active ? run + 1 : 0; best = Math.max(best, run) }
  // Today with no activity yet doesn't break the streak.
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].active) cur++
    else if (i === days.length - 1) continue
    else break
  }
  return { cur, best }
}

function Tile({ label, value, sub }) {
  return (
    <div className="us-tile">
      <span className="us-tile-label">{label}</span>
      <span className="us-tile-val num">{value}</span>
      {sub && <span className="us-tile-sub">{sub}</span>}
    </div>
  )
}

// ---------- heatmap ----------
function Heatmap({ days, metric, tokensFrom }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const M = METRICS[metric]
  const byDate = new Map(days.map((d) => [d.date, d]))
  // Fit as many whole weeks as the width allows, up to a year.
  const LEFT = 30, TOP = 16, GAP = 2
  const cell = Math.max(9, Math.min(20, Math.floor(((width || 600) - LEFT) / 53) - GAP))
  const weeks = Math.max(8, Math.min(53, Math.floor(((width || 600) - LEFT) / (cell + GAP))))
  const today = new Date()
  const end = new Date(today); end.setDate(end.getDate() + (6 - ((today.getDay() + 6) % 7)))
  const start = new Date(end.getTime() - (weeks * 7 - 1) * DAY)
  const cols = []
  for (let w = 0; w < weeks; w++) {
    const col = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + (w * 7 + i) * DAY)
      const key = ymd(d)
      col.push({ key, future: d > today, v: byDate.get(key)?.[metric] || 0 })
    }
    cols.push(col)
  }
  // Four steps at the quartiles of the active days, so a few huge days don't wash out the rest.
  const vals = cols.flat().map((c) => c.v).filter((v) => v > 0).sort((a, b) => a - b)
  const q = [0.25, 0.5, 0.75].map((p) => vals[Math.floor(p * (vals.length - 1))] || 0)
  const lvl = (v) => (v <= 0 ? 0 : v <= q[0] ? 1 : v <= q[1] ? 2 : v <= q[2] ? 3 : 4)
  const W = LEFT + weeks * (cell + GAP), H = TOP + 7 * (cell + GAP)
  const months = []
  cols.forEach((col, w) => { const d = at(col[0].key); if (d.getDate() <= 7) months.push({ w, label: d.toLocaleDateString([], { month: 'short' }) }) })
  const hv = hover && byDate.get(hover.key)
  return (
    <div className="us-heat" ref={ref}>
      <svg width={W} height={H} role="img" aria-label={`${M.label} per day, last ${weeks} weeks`} onPointerLeave={() => setHover(null)}>
        {months.map((m) => <text key={m.w} x={LEFT + m.w * (cell + GAP)} y={10} className="axis-label">{m.label}</text>)}
        {[0, 2, 4].map((i) => <text key={i} x={0} y={TOP + i * (cell + GAP) + cell - 1} className="axis-label">{WEEKDAYS[i]}</text>)}
        {cols.map((col, w) => col.map((c, i) => !c.future && (
          <rect key={c.key} x={LEFT + w * (cell + GAP)} y={TOP + i * (cell + GAP)} width={cell} height={cell} rx="2.5"
            className={`hm l${lvl(c.v)} ${hover?.key === c.key ? 'hl' : ''}`} onPointerEnter={() => setHover({ key: c.key, x: LEFT + w * (cell + GAP), y: TOP + i * (cell + GAP) })} />
        )))}
      </svg>
      {hover && (
        // Open toward the middle so it never runs off the card: left half opens right, right half opens left;
        // lower rows open above the square.
        <div className="tooltip us-tip" style={{
          ...(hover.x < (width || W) / 2 ? { left: hover.x } : { right: Math.max(0, (width || W) - hover.x - cell) }),
          ...(hover.y > H / 2 ? { top: hover.y - 6, transform: 'translateY(-100%)' } : { top: hover.y + cell + 6 }),
        }}>
          <div className="muted small">{fmtDate(hover.key, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
          {hv && (hv.tokens || hv.messages) ? (
            <div>
              {tokensFrom && hover.key < tokensFrom ? <span className="muted">token logs cleared</span> : <><b>{fmtTokens(hv.tokens)}</b> tokens · {fmtCost(hv.cost)}</>}
              {hv.messages ? <> · {fmtNum(hv.messages)} msgs · {hv.sessions} sessions</> : null}
            </div>
          ) : <div>No activity</div>}
        </div>
      )}
      <div className="us-legend"><span>Less</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`hm-key l${l}`} />)}<span>More</span></div>
    </div>
  )
}

// ---------- daily bars, stacked by model ----------
function Trend({ days, models, colorOf, metric }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  // Long ranges read better by week.
  const weekly = days.length > 120
  const rows = useMemo(() => {
    if (!weekly) return days.map((d) => ({ label: d.date, ...d }))
    const out = []
    days.forEach((d, i) => {
      if (i % 7 === 0) out.push({ label: d.date, tokens: 0, cost: 0, byModel: {} })
      const r = out.at(-1)
      r.tokens += d.tokens; r.cost += d.cost
      for (const [m, t] of Object.entries(d.byModel)) r.byModel[m] = (r.byModel[m] || 0) + t
    })
    return out
  }, [days, weekly])
  const get = (r) => r[metric]
  const max = Math.max(...rows.map(get), 0) || 1
  const W = Math.max(260, width || 500), H = 150, B = 18, R = 44
  const bw = (W - R) / rows.length
  const y = (v) => 4 + (1 - v / max) * (H - B - 4)
  const h = hover != null ? rows[hover] : null
  const ticks = [0, Math.floor(rows.length / 2), rows.length - 1].filter((v, i, a) => a.indexOf(v) === i)
  return (
    <div className="us-trend" ref={ref}>
      <svg width={W} height={H} onPointerLeave={() => setHover(null)} role="img" aria-label={`${METRICS[metric].label} per ${weekly ? 'week' : 'day'}, by model`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={0} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={W - R + 4} y={y(max * f) + 3} className="axis-label">{METRICS[metric].fmt(max * f)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = i * bw
          const total = get(r)
          // Split the bar by each model's share of tokens (cost split the same way).
          const parts = Object.entries(r.byModel).sort((a, b) => a[0] - b[0])
          const sum = parts.reduce((s, [, t]) => s + t, 0) || 1
          let top = H - B
          return (
            <g key={r.label} onPointerEnter={() => setHover(i)}>
              <rect x={x} y={0} width={bw} height={H - B} className="hit" />
              {total > 0 && parts.map(([m, t]) => {
                const hgt = ((total * t) / sum / max) * (H - B - 4)
                top -= hgt
                return <rect key={m} x={x + Math.min(1, bw * 0.15)} y={top} width={Math.max(1, bw - Math.min(2, bw * 0.3))} height={Math.max(0.5, hgt - (hgt > 3 ? 1 : 0))} fill={colorOf(+m)} className={hover === i ? 'hl' : ''} />
              })}
            </g>
          )
        })}
        {ticks.map((i) => <text key={i} x={i * bw + (i === 0 ? 0 : bw / 2)} y={H - 4} className="axis-label" textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}>{fmtDate(rows[i].label)}</text>)}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${((hover * bw + bw / 2) / W) * 100}%`, transform: `translateX(${hover < rows.length * 0.2 ? '-10%' : hover > rows.length * 0.7 ? '-92%' : '-50%'})` }}>
          <div className="muted small">{weekly ? `Week of ${fmtDate(h.label)}` : fmtDate(h.label, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          <div><b>{fmtTokens(h.tokens)}</b> tokens · {fmtCost(h.cost)}</div>
          {Object.entries(h.byModel).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m, t]) => (
            <div key={m} className="small us-tip-row"><i style={{ background: colorOf(+m) }} />{models[m]} {fmtTokens(t)}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function Bars({ rows, fmt, peak }) {
  const max = Math.max(...rows.map((r) => r.v), 0) || 1
  const [hover, setHover] = useState(null)
  return (
    <div className="us-cols" onPointerLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <div key={r.label} className={`us-col ${hover === i ? 'hl' : ''} ${peak === i ? 'peak' : ''}`} onPointerEnter={() => setHover(i)} title={`${r.full || r.label}: ${fmt(r.v)}`}>
          <span className="us-col-bar"><span style={{ height: `${Math.max(r.v ? 3 : 0, (r.v / max) * 100)}%` }} /></span>
          <span className="us-col-label">{r.label}</span>
        </div>
      ))}
      <span className="us-cols-read">{hover != null ? `${rows[hover].full || rows[hover].label} · ${fmt(rows[hover].v)}` : ''}</span>
    </div>
  )
}

const SERIES = Array.from({ length: SLOTS }, (_, i) => `var(--series-${i + 1})`)

export default function UsageStats() {
  const [provider, setProvider] = usePersisted('cc-stats-provider', 'claude')
  const [range, setRange] = usePersisted('cc-stats-range', '30')
  const [metric, setMetric] = usePersisted('cc-stats-metric', 'tokens')
  const [trendMetric, setTrendMetric] = usePersisted('cc-stats-trend', 'tokens')
  const [model, setModel] = useState('all')
  const [project, setProject] = useState('all')
  const { data, error, refresh } = useStats(provider)

  const view = useMemo(() => {
    if (!data?.days) return null
    // Colors follow the model, ranked once by all-time tokens, so filters never repaint them.
    const allTok = data.models.map((_, i) => data.cells.reduce((s, c) => s + (c[2] === i ? c[3] : 0), 0))
    const order = data.models.map((_, i) => i).sort((a, b) => allTok[b] - allTok[a])
    const colorOf = (m) => { const r = order.indexOf(m); return r < SLOTS ? SERIES[r] : 'var(--series-other)' }
    const all = filteredDays(data, model, project).map((d) => ({ ...d, active: d.tokens > 0 || (model === 'all' && project === 'all' && d.messages > 0) }))
    const days = range === 'all' ? all : all.slice(-Number(range))
    const prev = range === 'all' ? [] : all.slice(-2 * Number(range), -Number(range))
    const sum = (arr, k) => arr.reduce((s, d) => s + (d[k] || 0), 0)
    const active = days.filter((d) => d.active)
    const busiest = days.reduce((b, d) => (d.tokens > (b?.tokens || 0) ? d : b), null)
    const st = streaks(all)
    // Models and projects within the range (and the other filter).
    const from = days[0]?.date
    const inRange = data.cells.filter((c) => c[0] >= from && (model === 'all' || data.models[c[2]] === model) && (project === 'all' || data.projects[c[1]].id === project))
    const agg = (idx) => {
      const m = new Map()
      for (const c of inRange) { const k = c[idx]; const r = m.get(k) || { k, tokens: 0, cost: 0, days: new Set() }; r.tokens += c[3]; r.cost += c[4]; r.days.add(c[0]); m.set(k, r) }
      return [...m.values()].sort((a, b) => b.tokens - a.tokens)
    }
    const byModel = agg(2)
    const byProject = agg(1)
    // Weekday: average per weekday in range.
    const wd = WEEKDAYS.map((label) => ({ label, v: 0, n: 0 }))
    for (const d of days) { const i = (at(d.date).getDay() + 6) % 7; wd[i].v += d[trendMetric === 'cost' ? 'cost' : 'tokens']; wd[i].n++ }
    const weekdays = wd.map((w) => ({ label: w.label[0] + w.label.slice(1, 2), full: `${w.label}, average`, v: w.n ? w.v / w.n : 0 }))
    const hours = data.hours ? Array.from({ length: 24 }, (_, h) => ({ label: h % 6 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`) : '', full: new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }), v: data.hours[h] || 0 })) : null
    const peakHour = hours ? hours.reduce((b, h, i) => (h.v > hours[b].v ? i : b), 0) : null
    return { colorOf, all, days, prev, sum, active, busiest, st, byModel, byProject, weekdays, hours, peakHour }
  }, [data, range, model, project, trendMetric])

  const filtered = model !== 'all' || project !== 'all'
  const pct = (cur, before) => (before ? Math.round(((cur - before) / before) * 100) : null)
  const change = (k) => {
    if (!view?.prev.length) return null
    const p = pct(view.sum(view.days, k), view.sum(view.prev, k))
    return p == null ? null : <span className={p >= 0 ? 'up' : 'down'}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}% vs prior {view.days.length}d</span>
  }
  const rangeLabel = range === 'all' ? 'all time' : `last ${RANGES.find((r) => r[0] === range)[1]}`

  return (
    <div className="ustats">
      <div className="us-bar">
        <div className="seg small-seg" role="tablist" aria-label="Provider">
          {['claude', 'codex'].map((p) => <button key={p} role="tab" aria-selected={provider === p} className={provider === p ? 'on' : ''} onClick={() => { setProvider(p); setModel('all'); setProject('all') }}>{p === 'claude' ? 'Claude' : 'Codex'}</button>)}
        </div>
        <div className="seg small-seg" role="tablist" aria-label="Range">
          {RANGES.map(([v, l]) => <button key={v} role="tab" aria-selected={range === v} className={range === v ? 'on' : ''} onClick={() => setRange(v)}>{l}</button>)}
        </div>
        {data?.models?.length > 1 && (
          <select className="us-select" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
            <option value="all">All models</option>
            {view?.byModel && data.models.map((m, i) => ({ m, i })).sort((a, b) => a.m.localeCompare(b.m)).map(({ m }) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {data?.projects?.length > 1 && (
          <select className="us-select" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="all">All projects</option>
            {[...data.projects].sort((a, b) => a.path.localeCompare(b.path)).map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
          </select>
        )}
        {filtered && <button className="link" onClick={() => { setModel('all'); setProject('all') }}>Clear filters</button>}
        <span className="us-bar-end"><Updated data={data} onRefresh={() => refresh('?refresh=1')} /></span>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!view && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
      {view && (
        <>
          <div className="us-tiles">
            <Tile label="Tokens" value={fmtTokens(view.sum(view.days, 'tokens'))} sub={change('tokens') || rangeLabel} />
            <Tile label="Cost at API prices" value={fmtCost(view.sum(view.days, 'cost'))} sub={change('cost') || 'not your bill'} />
            <Tile label="Active days" value={`${view.active.length}/${view.days.length}`} sub={`${Math.round((view.active.length / Math.max(1, view.days.length)) * 100)}% of days`} />
            {!filtered && view.sum(view.days, 'sessions') > 0 && <Tile label="Sessions" value={fmtNum(view.sum(view.days, 'sessions'))} sub={`${fmtNum(view.sum(view.days, 'messages'))} messages`} />}
            <Tile label="Streak" value={`${view.st.cur} day${view.st.cur === 1 ? '' : 's'}`} sub={`longest ${view.st.best}`} />
            {view.busiest?.tokens > 0 && <Tile label="Busiest day" value={fmtTokens(view.busiest.tokens)} sub={fmtDate(view.busiest.date, { weekday: 'short', month: 'short', day: 'numeric' })} />}
            {view.byModel[0] && model === 'all' && <Tile label="Top model" value={data.models[view.byModel[0].k]} sub={`${Math.round((view.byModel[0].tokens / Math.max(1, view.sum(view.days, 'tokens'))) * 100)}% of tokens`} />}
          </div>

          <section className="us-card">
            <div className="us-card-head">
              <h4>Activity · past year</h4>
              <div className="seg small-seg" role="tablist" aria-label="Heatmap metric">
                {Object.entries(METRICS).filter(([k]) => provider === 'claude' || METRICS[k].filtered).map(([k, m]) => <button key={k} role="tab" aria-selected={metric === k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{m.label}</button>)}
              </div>
            </div>
            <Heatmap days={view.all} metric={metric} tokensFrom={data.tokensFrom} />
            {filtered && !METRICS[metric].filtered && <p className="muted small">Messages and sessions aren't split by model or project, so they show everything.</p>}
          </section>

          <div className="us-grid">
            <section className="us-card us-wide">
              <div className="us-card-head">
                <h4>{view.days.length > 120 ? 'Weekly' : 'Daily'} by model · {rangeLabel}</h4>
                <div className="seg small-seg" role="tablist">
                  {['tokens', 'cost'].map((k) => <button key={k} role="tab" aria-selected={trendMetric === k} className={trendMetric === k ? 'on' : ''} onClick={() => setTrendMetric(k)}>{METRICS[k].label}</button>)}
                </div>
              </div>
              <Trend days={view.days} models={data.models} colorOf={view.colorOf} metric={trendMetric} />
            </section>

            <section className="us-card">
              <div className="us-card-head"><h4>Models</h4><span className="muted small">click to filter</span></div>
              <ul className="us-list">
                {view.byModel.map((r) => {
                  const total = view.sum(view.days, 'tokens') || 1
                  const name = data.models[r.k]
                  return (
                    <li key={r.k}>
                      <button className={`us-row ${model === name ? 'on' : ''}`} onClick={() => setModel(model === name ? 'all' : name)}>
                        <span className="us-row-name"><i className="us-sw" style={{ background: view.colorOf(r.k) }} />{name}</span>
                        <span className="us-row-bar"><span style={{ width: `${(r.tokens / total) * 100}%`, background: view.colorOf(r.k) }} /></span>
                        <span className="us-row-num num">{fmtTokens(r.tokens)}</span>
                        <span className="us-row-num num muted">{fmtCost(r.cost)}</span>
                      </button>
                    </li>
                  )
                })}
                {!view.byModel.length && <li className="muted small">No token logs in this range.</li>}
              </ul>
            </section>

            {data.projects.length > 1 && (
              <section className="us-card">
                <div className="us-card-head"><h4>Projects</h4><span className="muted small">click to filter</span></div>
                <ul className="us-list">
                  {view.byProject.slice(0, 10).map((r) => {
                    const p = data.projects[r.k]
                    const max = view.byProject[0].tokens || 1
                    return (
                      <li key={p.id}>
                        <button className={`us-row ${project === p.id ? 'on' : ''}`} onClick={() => setProject(project === p.id ? 'all' : p.id)} title={`${p.path} · active ${r.days.size} day${r.days.size === 1 ? '' : 's'}`}>
                          <span className="us-row-name"><Icon name="folder" size={11} /><span className="us-ell">{p.name}</span></span>
                          <span className="us-row-bar"><span style={{ width: `${(r.tokens / max) * 100}%` }} /></span>
                          <span className="us-row-num num">{fmtTokens(r.tokens)}</span>
                          <span className="us-row-num num muted">{fmtCost(r.cost)}</span>
                        </button>
                      </li>
                    )
                  })}
                  {view.byProject.length > 10 && <li className="muted small us-more">and {view.byProject.length - 10} smaller</li>}
                </ul>
              </section>
            )}

            <section className="us-card">
              <div className="us-card-head"><h4>By weekday</h4><span className="muted small">average {METRICS[trendMetric === 'cost' ? 'cost' : 'tokens'].label.toLowerCase()} · {rangeLabel}</span></div>
              <Bars rows={view.weekdays} fmt={METRICS[trendMetric === 'cost' ? 'cost' : 'tokens'].fmt} peak={view.weekdays.reduce((b, w, i, a) => (w.v > a[b].v ? i : b), 0)} />
            </section>

            {view.hours && (
              <section className="us-card">
                <div className="us-card-head"><h4>By hour</h4><span className="muted small">sessions started, all time · peak {view.hours[view.peakHour].full}</span></div>
                <Bars rows={view.hours} fmt={(v) => `${v} session${v === 1 ? '' : 's'}`} peak={view.peakHour} />
              </section>
            )}
          </div>

          <p className="muted small us-src">
            {data.source}. Token and cost history starts {data.tokensFrom ? fmtDate(data.tokensFrom, { month: 'short', day: 'numeric', year: 'numeric' }) : 'when logs start'}, since Claude Code clears old logs.
            {data.totals ? ` Message and session counts go back to ${fmtDate(data.totals.firstSessionDate.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })} and run through ${fmtDate(data.totals.countsThrough)}.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
