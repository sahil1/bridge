import { useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useShared } from './layout.jsx'
import Usage from './Usage.jsx'
import { openToday } from './today.js'
import Markets, { RangePicker } from './Markets.jsx'
import { usePoll, fmtTime } from '../api.js'

// Collapsible section; open/closed is remembered per card. `summary` shows when collapsed.
export function Card({ icon, title, right, summary, children, className = '' }) {
  const [open, setOpen] = usePersisted(`cc-card-${icon}`, true)
  return (
    <section className={`card ${className} ${open ? '' : 'closed'}`} id={`card-${icon}`}>
      <header className="card-head">
        <button className="card-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="chevron" size={12} className={`caret ${open ? 'rot90' : ''}`} />
          <Icon name={icon} size={14} />
          <h3>{title}</h3>
        </button>
        {open ? right : <span className="card-summary">{summary}</span>}
      </header>
      {open && <div className="card-body">{children}</div>}
    </section>
  )
}

export function Updated({ data, onRefresh }) {
  if (!data) return null
  return (
    <span className="updated">
      {data.stale && <span className="stale" title={data.error}>stale</span>}
      {fmtTime(data.fetchedAt)}
      {onRefresh && <button className="icon-btn" onClick={onRefresh} aria-label="Refresh"><Icon name="refresh" size={13} /></button>}
    </span>
  )
}

const Loading = () => <div className="skeleton-rows"><div /><div /></div>

// ---------- Brief ----------

export function Brief({ onOpenAgent, onShowCard }) {
  const [unit] = useShared('cc-unit', 'f')
  const [primary] = useShared('cc-primary', 'claude')
  const { data, error } = usePoll(`/brief?unit=${unit}&primary=${primary}`, 5 * 60 * 1000)
  return (
    <Card icon="today" title={data?.greeting || 'Brief'} className="brief" summary={data?.lines?.[0]?.text} right={data && <span className="updated">{new Date(data.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>}>
      {!data && !error && <Loading />}
      {error && <p className="error-text">{error}</p>}
      <ul className="brief-lines">
        {data?.lines.map((l) => (
          <li key={l.key}>
            <span className="brief-key">{l.key}</span>
            <span>{l.text}</span>
            {l.routines?.length > 0 && onShowCard && (
              <div className="brief-items">
                {l.routines.map((r) => (
                  <button key={r.id} className={`chip r-chip ${r.state}`} onClick={() => onShowCard('repeat')}><Icon name="repeat" size={11} /> {r.name}</button>
                ))}
              </div>
            )}
            {l.items?.length > 0 && (
              <div className="brief-items">
                {l.items.map((it) => (
                  <button key={it.paneId} className={`chip status-${it.status}`} onClick={() => onOpenAgent(it.paneId)}>
                    <Icon name={it.status === 'blocked' ? 'alert' : 'check'} size={11} /> {it.label}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------- Quota ----------

function level(pct) {
  if (pct == null) return 'unknown'
  if (pct < 20) return 'critical'
  if (pct < 50) return 'warning'
  return 'good'
}
const LEVEL_LABEL = { good: 'Healthy', warning: 'Watch', critical: 'Low', unknown: 'No data' }

export function Quota() {
  const { data, error, refresh } = usePoll('/quota', 5 * 60 * 1000)
  const [primary] = useShared('cc-primary', 'claude')
  const p = data?.providers?.find((x) => x.provider === primary)
  return (
    <Card icon="gauge" title="Usage" className="usage-card" summary={p ? `${p.provider} ${p.percentRemaining ?? '—'}% left` : ''} right={<Updated data={data} onRefresh={() => refresh('?refresh=1')} />}>
      <Usage data={data} error={error} />
      <button className="ghost-btn idea-more" onClick={() => openToday('usage')}>Stats, patterns and history <Icon name="chevron" size={10} /></button>
    </Card>
  )
}

// ---------- Weather ----------

function weatherIcon(code) {
  if (code <= 1) return 'sun'
  if (code >= 51) return 'rain'
  return 'cloud'
}

export function Weather() {
  const { data, error } = usePoll('/weather', 15 * 60 * 1000)
  const [unit, setUnit] = useShared('cc-unit', 'f')
  const c = unit === 'c'
  const t = (f) => Math.round(c ? (f - 32) * 5 / 9 : f)
  const wind = (mph) => (c ? `${Math.round(mph * 1.609)} km/h` : `${mph} mph`)
  const toggle = (
    <div className="seg small-seg unit-seg" role="radiogroup" aria-label="Temperature unit">
      <button role="radio" aria-checked={!c} className={!c ? 'on' : ''} onClick={() => setUnit('f')}>°F</button>
      <button role="radio" aria-checked={c} className={c ? 'on' : ''} onClick={() => setUnit('c')}>°C</button>
    </div>
  )
  return (
    <Card icon="sun" title={data?.location || 'Weather'} summary={data ? `${t(data.current.temp)}° ${data.current.summary}` : ''} right={toggle}>
      {!data && !error && <Loading />}
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="wx-now">
            <Icon name={weatherIcon(data.current.code)} size={30} />
            <span className="wx-temp">{t(data.current.temp)}°<span className="wx-unit">{c ? 'C' : 'F'}</span></span>
            <div className="wx-desc">
              <div>{data.current.summary}</div>
              <div className="muted small">Feels {t(data.current.feels)}° · {data.current.humidity}% humidity · {wind(data.current.wind)}</div>
            </div>
          </div>
          <div className="wx-days">
            {data.daily.map((d, i) => (
              <div key={d.date} className="wx-day">
                <div className="muted small">{i === 0 ? 'Today' : new Date(`${d.date}T12:00`).toLocaleDateString([], { weekday: 'short' })}</div>
                <Icon name={weatherIcon(d.code)} size={18} />
                <div className="small"><b>{t(d.hi)}°</b> <span className="muted">{t(d.lo)}°</span></div>
                {d.rain >= 20 && <div className="small rain">{d.rain}%</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

// ---------- Market ----------

export function Market() {
  return <Markets Card={Card} Updated={Updated} />
}

// ---------- Mortgage ----------

function RateChart({ history, myRate }) {
  const [hover, setHover] = useState(null)
  const W = 320, H = 130, L = 30, R = 8, T = 8, B = 18
  const vals = history.flatMap((r) => [r.fixed30, r.fixed15]).concat(myRate ? [myRate] : [])
  const min = Math.floor(Math.min(...vals) * 2) / 2, max = Math.ceil(Math.max(...vals) * 2) / 2
  const x = (i) => L + (i / (history.length - 1)) * (W - L - R)
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B)
  const line = (key) => history.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join('')
  const ticks = []
  for (let v = min; v <= max + 1e-9; v += (max - min) > 2 ? 1 : 0.5) ticks.push(v)
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - L) / (W - L - R)) * (history.length - 1))
    setHover(Math.max(0, Math.min(history.length - 1, i)))
  }
  const h = hover != null ? history[hover] : null
  return (
    <div className="chart-wrap">
      <div className="legend">
        <span><i className="sw s1" /> 30-yr fixed</span>
        <span><i className="sw s2" /> 15-yr fixed</span>
        {myRate && <span><i className="sw ref" /> Your rate</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="rate-chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Average mortgage rates, last two years">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 4} y={y(v) + 3} className="axis-label" textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}
        <text x={L} y={H - 4} className="axis-label">{history[0].date.slice(0, 7)}</text>
        <text x={W - R} y={H - 4} className="axis-label" textAnchor="end">{history.at(-1).date.slice(0, 7)}</text>
        {myRate && <line x1={L} x2={W - R} y1={y(myRate)} y2={y(myRate)} className="ref-line" />}
        <path d={line('fixed15')} className="series s2" />
        <path d={line('fixed30')} className="series s1" />
        {h && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="crosshair" />
            <circle cx={x(hover)} cy={y(h.fixed30)} r="4" className="dot s1" />
            <circle cx={x(hover)} cy={y(h.fixed15)} r="4" className="dot s2" />
          </g>
        )}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="muted small">{h.date}</div>
          <div><i className="sw s1" /> 30-yr <b>{h.fixed30.toFixed(2)}%</b></div>
          <div><i className="sw s2" /> 15-yr <b>{h.fixed15.toFixed(2)}%</b></div>
        </div>
      )}
    </div>
  )
}

const MORTGAGE_RANGES = [['3mo', '3M'], ['6mo', '6M'], ['1y', '1Y'], ['2y', '2Y'], ['5y', '5Y'], ['10y', '10Y'], ['max', 'Max']]
const RANGE_DAYS = { '3mo': 92, '6mo': 183, '1y': 366, '2y': 731, '5y': 1827, '10y': 3653 }

export function Mortgage() {
  const { data, error } = usePoll('/mortgage', 60 * 60 * 1000)
  const [mRange, setMRange] = usePersisted('cc-mortgage-range', '2y')
  const mine = data?.mine
  const cutoff = RANGE_DAYS[mRange] ? new Date(Date.now() - RANGE_DAYS[mRange] * 864e5).toISOString().slice(0, 10) : ''
  const all = data?.history || []
  // Long ranges have thousands of weekly points; thin them so the chart stays light.
  const inRange = all.filter((r) => r.date >= cutoff)
  const stepN = Math.ceil(inRange.length / 260)
  const shown = stepN > 1 ? inRange.filter((_, i) => i % stepN === 0 || i === inRange.length - 1) : inRange
  return (
    <Card icon="home" title="Mortgage" summary={data ? `30-yr ${data.latest.fixed30.toFixed(2)}%` : ''} right={<Updated data={data} />}>
      {!data && !error && <Loading />}
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="stat-row">
            <div className="stat"><div className="muted small">30-yr avg</div><div className="stat-val">{data.latest.fixed30.toFixed(2)}%</div>
              {data.yearAgo && <div className="small muted">{data.latest.fixed30 >= data.yearAgo.fixed30 ? '▲' : '▼'} {Math.abs(data.latest.fixed30 - data.yearAgo.fixed30).toFixed(2)} vs last year</div>}
            </div>
            <div className="stat"><div className="muted small">15-yr avg</div><div className="stat-val">{data.latest.fixed15.toFixed(2)}%</div></div>
            {mine && <div className="stat"><div className="muted small">Yours ({mine.type})</div><div className="stat-val">{mine.rate.toFixed(2)}%</div><div className="small muted">adjusts {mine.adjustsYear}</div></div>}
          </div>
          <div className="q-range-row">
            <RangePicker value={mRange} onChange={setMRange} options={MORTGAGE_RANGES} />
            {shown.length > 1 && <span className={`q-range-chg ${shown.at(-1).fixed30 <= shown[0].fixed30 ? 'pos' : 'neg'}`}>{shown.at(-1).fixed30 >= shown[0].fixed30 ? '+' : '−'}{Math.abs(shown.at(-1).fixed30 - shown[0].fixed30).toFixed(2)} pts <span className="muted">since {new Date(`${shown[0].date}T12:00:00`).toLocaleDateString([], { month: 'short', year: 'numeric' })}</span></span>}
          </div>
          <RateChart history={shown} myRate={mine?.rate} />
          {mine && (
            <p className="small">
              {mine.refiWorthChecking
                ? <>A 30-yr refi at today's average saves about <b>${mine.monthlySavings.toLocaleString()}/mo</b>; breakeven in {mine.breakevenMonths} months on ${mine.closingCosts.toLocaleString()} closing costs.</>
                : <>Your rate is <b>{Math.abs(mine.spread).toFixed(2)} points below</b> today's average. No refi case until rates drop under {mine.rate.toFixed(2)}%.</>}
            </p>
          )}
          <p className="muted small">Source: {data.source}, week of {data.latest.date}. National averages; jumbo quotes differ.</p>
        </>
      )}
    </Card>
  )
}
