import { useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useWidth } from './layout.jsx'
import { Market, Mortgage, Updated } from './Trackers.jsx'
import { usePoll, fmtRelative } from '../api.js'

// Markets & news: the rates that drive money decisions, your watchlist, mortgage, and headlines.
const pct = (v, d = 2) => (v == null ? '–' : `${v.toFixed(d)}%`)
const shortDate = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '')
const monthYear = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '')

// Single-series line with a hover readout. Values are { date, v }.
function Line({ points, fmt = (v) => pct(v), w = 220, h = 44 }) {
  const [hover, setHover] = useState(null)
  if (!points || points.length < 2) return <div className="rate-line" style={{ height: h }} />
  const vs = points.map((p) => p.v)
  const min = Math.min(...vs), max = Math.max(...vs)
  const span = max - min || 1
  const x = (i) => 2 + (i / (points.length - 1)) * (w - 4)
  const y = (v) => 3 + (1 - (v - min) / span) * (h - 6)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, i)))
  }
  const hp = hover != null ? points[hover] : null
  return (
    <div className="rate-line" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden="true">
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hp && <line x1={x(hover)} x2={x(hover)} y1="0" y2={h} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />}
        {hp && <circle cx={x(hover)} cy={y(hp.v)} r="3" fill="var(--accent)" stroke="var(--pane-2)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="rate-line-read">{hp ? `${shortDate(hp.date)} ${hp.date.slice(0, 4)} · ${fmt(hp.v)}` : `${monthYear(points[0].date)} – now`}</span>
    </div>
  )
}

function Delta({ now, before, unit = 'pt', invert = false, neutral = false, label }) {
  if (now == null || before == null) return null
  const d = +(now - before).toFixed(2)
  if (!d) return <span className="rate-delta">unchanged {label}</span>
  const up = d > 0
  const good = invert ? !up : up
  return <span className={`rate-delta ${neutral ? '' : good ? 'pos' : 'neg'}`}>{up ? '▲' : '▼'} {Math.abs(d).toFixed(2)}{unit} {label}</span>
}

function Tile({ title, value, sub, children, href }) {
  return (
    <div className="rate-tile">
      <div className="rate-head"><span>{title}</span>{href && <a href={href} target="_blank" rel="noreferrer" className="icon-btn" aria-label={`${title} source`}><Icon name="external" size={11} /></a>}</div>
      <div className="rate-val num">{value}</div>
      <div className="rate-sub">{sub}</div>
      {children}
    </div>
  )
}

function Rates() {
  const { data, error, refresh } = usePoll('/macro', 60 * 60 * 1000)
  const mort = usePoll('/mortgage', 60 * 60 * 1000)
  const days = (iso) => Math.max(0, Math.ceil((new Date(`${iso}T14:00:00`) - Date.now()) / 864e5))
  const f = data?.fed
  const t = data?.treasury
  const m = mort.data
  return (
    <section className="rates">
      <div className="rates-head">
        <h3><Icon name="trend" size={14} /> Rates & economy</h3>
        <Updated data={data} onRefresh={() => refresh('?refresh=1')} />
      </div>
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <div className="skeleton-rows"><div /><div /></div>}
      {data && (
        <div className="rate-grid">
          <Tile title="Fed funds target" value={f.lower != null ? `${f.lower.toFixed(2)}–${f.upper.toFixed(2)}%` : '–'} href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
            sub={<>Effective {pct(f.effective)}{f.lastMove && <> · last move <b className={f.lastMove.bps > 0 ? 'neg' : 'pos'}>{f.lastMove.bps > 0 ? '+' : ''}{f.lastMove.bps} bp</b> {shortDate(f.lastMove.date)}</>}</>}>
            {f.next && <div className="fomc-next"><Icon name="calendar" size={11} /> Next FOMC <b>{f.next.label}</b> · {days(f.next.date) === 0 ? 'today' : `in ${days(f.next.date)} days`}{f.next.projections ? ' · with projections' : ''}</div>}
            <Line points={f.history} />
          </Tile>
          <Tile title="10-yr Treasury" value={pct(t.t10)} href="https://fred.stlouisfed.org/series/DGS10"
            sub={<><Delta now={t.t10} before={t.t10WeekAgo} label="vs last week" neutral /> · 2-yr {pct(t.t2)} · spread {t.spread > 0 ? '+' : ''}{t.spread?.toFixed(2)}</>}>
            <Line points={t.history10} />
          </Tile>
          {m && (
            <Tile title="30-yr mortgage" value={pct(m.latest.fixed30)} href="https://fred.stlouisfed.org/series/MORTGAGE30US"
              sub={<><Delta now={m.latest.fixed30} before={m.yearAgo?.fixed30} label="vs last year" invert /> · 15-yr {pct(m.latest.fixed15)}</>}>
              <Line points={m.history.slice(-104).map((r) => ({ date: r.date, v: r.fixed30 }))} />
            </Tile>
          )}
          <Tile title="Inflation (CPI, yearly)" value={pct(data.inflation.yoy, 1)} href="https://fred.stlouisfed.org/series/CPIAUCSL"
            sub={<><Delta now={data.inflation.yoy} before={data.inflation.prior} label="vs prior month" invert /> · {monthYear(data.inflation.asOf)}</>}>
            <Line points={data.inflation.history} fmt={(v) => pct(v, 1)} />
          </Tile>
          <Tile title="Unemployment" value={pct(data.jobs.unemployment, 1)} href="https://fred.stlouisfed.org/series/UNRATE"
            sub={<><Delta now={data.jobs.unemployment} before={data.jobs.prior} label="vs prior month" invert /> · {monthYear(data.jobs.asOf)}</>}>
            <Line points={data.jobs.history} fmt={(v) => pct(v, 1)} />
          </Tile>
        </div>
      )}
      {data && <p className="muted small rates-src">Source: {data.source}. Treasury and Fed rates as of {shortDate(t.asOf)}.</p>}
    </section>
  )
}

function News() {
  const { data, error, refresh } = usePoll('/news', 20 * 60 * 1000)
  const [sec, setSec] = usePersisted('cc-news-sec', 'tech')
  const [limit, setLimit] = useState(15)
  const section = data?.sections?.find((s) => s.id === sec) || data?.sections?.[0]
  return (
    <section className="newsv card-like">
      <div className="rates-head">
        <h3><Icon name="sparkle" size={14} /> Headlines</h3>
        <Updated data={data} onRefresh={() => refresh('?refresh=1')} />
      </div>
      <div className="chips news-chips">
        {(data?.sections || []).map((s) => <button key={s.id} className={`fchip ${section?.id === s.id ? 'on' : ''}`} onClick={() => { setSec(s.id); setLimit(15) }}>{s.label}</button>)}
      </div>
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
      {section && (
        <>
          <ul className="hl-list">
            {section.items.slice(0, limit).map((n) => (
              <li key={n.link}>
                <a href={n.link} target="_blank" rel="noreferrer" className="hl">
                  <span className="hl-title">{n.title}</span>
                  <span className="hl-meta">
                    <span>{n.source}</span>
                    {n.published && <span>{fmtRelative(n.published)}</span>}
                    {n.points != null && <span>{n.points} pts</span>}
                  </span>
                </a>
                {n.discussion && <a className="hl-disc" href={n.discussion} target="_blank" rel="noreferrer" title="Hacker News discussion">{n.comments ?? 0} comments</a>}
              </li>
            ))}
          </ul>
          {section.items.length > limit && <button className="ghost-btn idea-more" onClick={() => setLimit(limit + 15)}>Show more</button>}
          <p className="muted small">From {section.sources.join(', ')}{section.failed.length ? `. Unreachable now: ${section.failed.join(', ')}` : ''}.</p>
        </>
      )}
    </section>
  )
}

export default function MarketsView() {
  const [ref, width] = useWidth()
  const wide = width >= 900
  return (
    <div className={`mktv ${wide ? 'wide' : ''}`} ref={ref}>
      <Rates />
      <div className="mktv-cols">
        <div className="mktv-col"><Market /><Mortgage /></div>
        <div className="mktv-col"><News /></div>
      </div>
    </div>
  )
}
