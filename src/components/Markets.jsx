import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useWidth } from './layout.jsx'
import { api, usePoll, fmtTime } from '../api.js'

const enc = encodeURIComponent
const fmtPrice = (q) => {
  const v = q.price
  const d = v >= 1000 ? 0 : v >= 10 ? 2 : 3
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
}
const fmtVol = (n) => (n == null ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n))
const pct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`
const ago = (t) => {
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60000)
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
const short = (s) => s.replace(/^\^/, '').replace(/-USD$/, '').replace(/=F$/, '')

function Spark({ values, up, w = 64, h = 22 }) {
  if (!values || values.length < 2) return <span className="spark" style={{ width: w }} />
  const min = Math.min(...values), max = Math.max(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`).join(' ')
  return <svg className={`spark ${up ? 'up' : 'down'}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
}

export const RANGES = [['1mo', '30D'], ['60d', '60D'], ['3mo', '3M'], ['6mo', '6M'], ['ytd', 'YTD'], ['1y', '1Y'], ['5y', '5Y'], ['max', 'Max']]
const longRange = (data) => data.length > 1 && data.at(-1).t - data[0].t > 400 * 864e5
const fmtDay = (t, long) => new Date(t).toLocaleDateString([], long ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' })

export function RangePicker({ value, onChange, options = RANGES }) {
  return (
    <div className="seg small-seg range-seg" role="tablist" aria-label="Time range">
      {options.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

function PriceChart({ q, points, label }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const data = (points || q.history).filter((p) => p.t)
  const long = longRange(data)
  const W = Math.max(220, width || 300), H = 120, L = 4, R = 44, T = 8, B = 16
  if (data.length < 2) return <div ref={ref} />
  const vals = data.map((p) => p.c)
  const min = Math.min(...vals), max = Math.max(...vals)
  const x = (i) => L + (i / (data.length - 1)) * (W - L - R)
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B)
  const path = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join('')
  const up = vals.at(-1) >= vals[0]
  const h = hover != null ? data[hover] : null
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - L) / (W - L - R)) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, i)))
  }
  return (
    <div className="pchart" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className={up ? 'up' : 'down'} role="img" aria-label={`${q.symbol} ${label || 'last 3 months'}`}>
        <defs><linearGradient id={`g-${q.symbol}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopOpacity=".22" className="gstop" /><stop offset="1" stopOpacity="0" className="gstop" /></linearGradient></defs>
        {[min, (min + max) / 2, max].map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" /><text x={W - R + 4} y={y(v) + 3} className="axis-label">{v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)}</text></g>
        ))}
        <path d={`${path}L${x(data.length - 1)},${H - B}L${x(0)},${H - B}Z`} fill={`url(#g-${q.symbol})`} />
        <path d={path} className="pline" />
        {h && <><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="crosshair" /><circle cx={x(hover)} cy={y(h.c)} r="3.5" className="pdot" /></>}
        <text x={L} y={H - 3} className="axis-label">{fmtDay(data[0].t, long)}</text>
        <text x={W - R} y={H - 3} className="axis-label" textAnchor="end">{fmtDay(data.at(-1).t, long)}</text>
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="muted small">{new Date(h.t).toLocaleDateString([], long ? { month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          <b>{h.c.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
        </div>
      )}
    </div>
  )
}

function Range({ label, low, high, value }) {
  if (low == null || high == null) return null
  const p = high > low ? ((value - low) / (high - low)) * 100 : 50
  return (
    <div className="range">
      <div className="range-top"><span className="muted">{label}</span></div>
      <div className="range-bar"><span className="range-dot" style={{ left: `${Math.max(0, Math.min(100, p))}%` }} /></div>
      <div className="range-ends"><span>{low.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><span>{high.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
    </div>
  )
}

function NewsList({ items, limit, showTickers = true }) {
  return (
    <ul className="news">
      {items.slice(0, limit).map((n) => (
        <li key={n.id}>
          <a href={n.url} target="_blank" rel="noreferrer" className="news-item">
            {n.thumb && <img src={n.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />}
            <span className="news-text">
              <span className="news-title">{n.title}</span>
              <span className="news-meta">{n.publisher} · {ago(n.time)}
                {showTickers && n.symbols?.map((s) => <span key={s} className="tick">{short(s)}</span>)}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function Detail({ q }) {
  const news = usePoll(`/market/news?symbols=${enc(q.symbol)}`, 15 * 60 * 1000)
  const [range, setRange] = usePersisted('cc-mkt-range', '3mo')
  const hist = usePoll(`/market/history?symbol=${enc(q.symbol)}&range=${range}`, 10 * 60 * 1000)
  const points = hist.data?.range === range && hist.data.symbol === q.symbol ? hist.data.points : null
  const first = points?.[0]?.c
  const change = first ? ((q.price - first) / first) * 100 : null
  const label = RANGES.find(([v]) => v === range)?.[1]
  return (
    <div className="q-detail">
      <div className="q-range-row">
        <RangePicker value={range} onChange={setRange} />
        {change != null && <span className={`q-range-chg ${change >= 0 ? 'pos' : 'neg'}`}>{pct(change)} <span className="muted">over {label}</span></span>}
      </div>
      <PriceChart q={q} points={points || (range === '3mo' ? q.history : null) || q.history} label={label} />
      <div className="q-stats">
        <Range label="Day range" low={q.dayLow} high={q.dayHigh} value={q.price} />
        <Range label="52-week range" low={q.yearLow} high={q.yearHigh} value={q.price} />
        <div className="q-kv"><span className="muted">Volume</span><b>{fmtVol(q.volume)}</b></div>
        {q.monthChangePercent != null && <div className="q-kv"><span className="muted">1 month</span><b className={q.monthChangePercent >= 0 ? 'pos' : 'neg'}>{pct(q.monthChangePercent)}</b></div>}
      </div>
      <div className="q-links">
        {q.links.google && <a className="ghost-btn" href={q.links.google} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> Google Finance</a>}
        <a className="ghost-btn" href={q.links.yahoo} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> Yahoo</a>
        <span className="muted small q-asof">{q.exchangeName}{q.asOf ? ` · as of ${fmtTime(q.asOf)}` : ''}</span>
      </div>
      {news.data?.items?.length > 0 && <NewsList items={news.data.items} limit={3} showTickers={false} />}
    </div>
  )
}

function QuoteRow({ q, open, onToggle, edit, onRemove, onMove, first, last }) {
  if (q.error) {
    return (
      <li className="q-row err">
        <div className="q-main"><span className="q-sym">{q.symbol}</span><span className="muted small">no data</span></div>
        {edit && <button className="icon-btn" onClick={onRemove} aria-label={`Remove ${q.symbol}`}><Icon name="x" size={13} /></button>}
      </li>
    )
  }
  const up = q.changePercent >= 0
  return (
    <li className={`q-row ${open ? 'open' : ''}`}>
      <div className="q-line">
        <button className="q-main" onClick={onToggle} aria-expanded={open}>
          <span className="q-id"><span className="q-sym">{short(q.symbol)}</span><span className="q-name">{q.name}</span></span>
          <Spark values={q.spark} up={up} />
          <span className="q-price"><span className="num">{fmtPrice(q)}</span><span className={`delta ${up ? 'pos' : 'neg'}`}>{up ? '▲' : '▼'} {Math.abs(q.changePercent).toFixed(2)}%</span></span>
        </button>
        {edit ? (
          <span className="q-edit">
            <button className="icon-btn" disabled={first} onClick={() => onMove('up')} aria-label="Move up"><Icon name="up" size={13} /></button>
            <button className="icon-btn" disabled={last} onClick={() => onMove('down')} aria-label="Move down"><Icon name="down" size={13} /></button>
            <button className="icon-btn danger" onClick={onRemove} aria-label={`Remove ${q.symbol}`}><Icon name="x" size={13} /></button>
          </span>
        ) : (
          <a className="icon-btn q-ext" href={q.links.google || q.links.yahoo} target="_blank" rel="noreferrer" aria-label={`${q.symbol} on ${q.links.google ? 'Google Finance' : 'Yahoo Finance'}`} title={q.links.google ? 'Google Finance' : 'Yahoo Finance (no Google page for futures)'}><Icon name="external" size={12} /></a>
        )}
      </div>
      {open && <Detail q={q} />}
    </li>
  )
}

function AddTicker({ onAdd }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (q.trim().length < 1) { setRes([]); return }
    const t = setTimeout(() => api(`/market/search?q=${enc(q.trim())}`).then((r) => setRes(r.results.slice(0, 6))).catch(() => setRes([])), 200)
    return () => clearTimeout(t)
  }, [q])
  const add = async (symbol) => {
    setBusy(true); setErr(null)
    try { await onAdd(symbol); setQ(''); setRes([]) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="add-ticker">
      <div className="add-input">
        <Icon name="search" size={13} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) add(res[0]?.symbol || q.trim()) }}
          placeholder="Add ticker or company (e.g. AAPL, Tesla, ETH)" autoCapitalize="characters" autoCorrect="off" spellCheck="false" disabled={busy} />
      </div>
      {res.length > 0 && (
        <ul className="add-results">
          {res.map((r) => (
            <li key={r.symbol}><button onClick={() => add(r.symbol)}><b>{r.symbol}</b><span>{r.name}</span><span className="muted small">{r.exchange} · {r.type?.toLowerCase()}</span></button></li>
          ))}
        </ul>
      )}
      {err && <p className="error-text">{err}</p>}
    </div>
  )
}

export default function Markets({ Card, Updated }) {
  const { data, error, refresh } = usePoll('/market', 5 * 60 * 1000)
  const [open, setOpen] = usePersisted('cc-mkt-open', null)
  const [edit, setEdit] = useState(false)
  const [newsFilter, setNewsFilter] = useState('all')
  const [newsLimit, setNewsLimit] = useState(6)
  const wl = data?.watchlist || []
  const symbols = wl.filter((q) => !q.error).map((q) => q.symbol)
  const news = usePoll(symbols.length ? `/market/news?symbols=${enc(symbols.join(','))}` : null, 15 * 60 * 1000)
  const items = useMemo(() => (news.data?.items || []).filter((n) => newsFilter === 'all' || n.symbols.includes(newsFilter)), [news.data, newsFilter])
  const withNews = useMemo(() => [...new Set((news.data?.items || []).flatMap((n) => n.symbols))], [news.data])

  const mutate = async (fn) => { await fn(); await refresh('?refresh=1') }
  const lead = data?.indices?.[0]

  return (
    <Card icon="trend" title="Markets" summary={lead ? `${lead.name} ${pct(lead.changePercent)}` : ''}
      right={(
        <span className="mk-tools">
          <Updated data={data} onRefresh={() => refresh('?refresh=1')} />
          <button className={`icon-btn ${edit ? 'on' : ''}`} onClick={() => setEdit(!edit)} aria-pressed={edit} title={edit ? 'Done editing' : 'Edit watchlist'} aria-label="Edit watchlist">
            <Icon name={edit ? 'check' : 'edit'} size={13} />
          </button>
        </span>
      )}>
      {!data && !error && <div className="skeleton-rows"><div /><div /></div>}
      {error && <p className="error-text">{error}</p>}
      {data?.indices?.length > 0 && (
        <div className="idx-grid">
          {data.indices.map((q) => {
            const up = q.changePercent >= 0
            return (
              <a key={q.symbol} className="idx" href={q.links.google || q.links.yahoo} target="_blank" rel="noreferrer" title={`${q.name} on Google Finance`}>
                <span className="idx-name">{q.name}</span>
                <span className="idx-price num">{fmtPrice(q)}</span>
                <span className={`delta ${up ? 'pos' : 'neg'}`}>{up ? '▲' : '▼'} {Math.abs(q.changePercent).toFixed(2)}%</span>
                <Spark values={q.spark} up={up} w={80} h={18} />
              </a>
            )
          })}
        </div>
      )}
      {data && (
        <>
          <div className="group-label wl-label">Watchlist <span className="muted">· tap for chart, ranges and news</span></div>
          {edit && <AddTicker onAdd={(s) => mutate(() => api('/market/watchlist', { method: 'POST', body: { symbol: s } }))} />}
          <ul className="q-list">
            {wl.map((q, i) => (
              <QuoteRow key={q.symbol} q={q} open={open === q.symbol} onToggle={() => setOpen(open === q.symbol ? null : q.symbol)}
                edit={edit} first={i === 0} last={i === wl.length - 1}
                onRemove={() => mutate(() => api(`/market/watchlist/${enc(q.symbol)}`, { method: 'DELETE' }))}
                onMove={(dir) => mutate(() => api(`/market/watchlist/${enc(q.symbol)}/move`, { method: 'POST', body: { dir } }))} />
            ))}
          </ul>
          {!wl.length && <p className="muted small">Your watchlist is empty. Tap the pencil to add tickers.</p>}
        </>
      )}
      {(news.data?.items?.length || 0) > 0 && (
        <div className="mk-news">
          <div className="group-label">Headlines for your watchlist</div>
          <div className="chips news-chips">
            <button className={`fchip ${newsFilter === 'all' ? 'on' : ''}`} onClick={() => setNewsFilter('all')}>All</button>
            {withNews.map((s) => <button key={s} className={`fchip ${newsFilter === s ? 'on' : ''}`} onClick={() => setNewsFilter(s)}>{short(s)}</button>)}
          </div>
          <NewsList items={items} limit={newsLimit} />
          {items.length > newsLimit && <button className="ghost-btn more" onClick={() => setNewsLimit(newsLimit + 10)}>Show more</button>}
          <p className="muted small">News via Yahoo Finance.</p>
        </div>
      )}
    </Card>
  )
}
