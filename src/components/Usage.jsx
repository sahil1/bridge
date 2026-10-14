import { useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useShared, useWidth } from './layout.jsx'
import { usePoll, fmtTime } from '../api.js'

const NAMES = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', grok: 'Grok', copilot: 'Copilot', openrouter: 'OpenRouter', deepseek: 'DeepSeek', kimi: 'Kimi', zai: 'Z.ai', agy: 'Antigravity' }
const nice = (p) => NAMES[p] || p[0].toUpperCase() + p.slice(1)

// ---------- formatting ----------
export const fmtTokens = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n))
const fmtCost = (n) => `$${n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2)}`
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)

function fmtIn(iso) {
  if (!iso) return null
  const ms = new Date(iso) - Date.now()
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60000)
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`
}

function delta(cur, prev, fmt) {
  if (!prev) return cur ? { text: 'new today', dir: 'up' } : null
  const diff = cur - prev
  const pct = (diff / prev) * 100
  return { text: `${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))} (${diff >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%)`, dir: diff >= 0 ? 'up' : 'down' }
}

// ---------- window health ----------
function health(w) {
  if (w.percentRemaining == null) return { level: 'unknown', label: 'No data' }
  if (w.percentRemaining < 10) return { level: 'critical', label: 'Low' }
  const runsOut = w.pace?.projectedExhaustedAt && w.resetsAt && new Date(w.pace.projectedExhaustedAt) < new Date(w.resetsAt)
  if (runsOut || w.pace?.status === 'ahead' || w.percentRemaining < 30) return { level: 'warning', label: 'Watch' }
  return { level: 'good', label: 'Healthy' }
}

function PaceBar({ w, level }) {
  // Where you'd be if you used the window evenly: remaining = time remaining.
  const paceAt = w.pace?.elapsedPercent != null ? 100 - w.pace.elapsedPercent : null
  return (
    <div className="u-bar" role="meter" aria-valuenow={w.percentRemaining} aria-valuemin="0" aria-valuemax="100" aria-label={`${w.label} ${w.percentRemaining}% left`}>
      <div className={`u-fill f-${level}`} style={{ width: `${Math.max(1.5, w.percentRemaining ?? 0)}%` }} />
      {paceAt != null && <span className="u-pace" style={{ left: `${Math.min(99, Math.max(1, paceAt))}%` }} title={`Even pace would leave ${Math.round(paceAt)}% now`} />}
    </div>
  )
}

function WindowRow({ w }) {
  const h = health(w)
  const runsOut = w.pace?.projectedExhaustedAt && w.resetsAt && new Date(w.pace.projectedExhaustedAt) < new Date(w.resetsAt)
  return (
    <div className="w-row">
      <div className="w-top">
        <span className="w-label">{w.label}</span>
        <span className={`w-pct t-${h.level}`}>{w.percentRemaining ?? '—'}%<small> left</small></span>
      </div>
      <PaceBar w={w} level={h.level} />
      <div className="w-foot">
        <span>{w.resetsAt ? `resets in ${fmtIn(w.resetsAt)}` : 'no reset'}</span>
        {runsOut ? <span className="u-warn">runs out in {fmtIn(w.pace.projectedExhaustedAt)}</span>
          : h.level !== 'good' ? <span className={`t-${h.level}`}>{h.label}</span> : null}
      </div>
    </div>
  )
}

function MiniStat({ label, value, d }) {
  return (
    <div className="mini-stat">
      <span className="ms-label">{label}</span>
      <span className="ms-val">{value}</span>
      {d && <span className={`ms-delta d-${d.dir}`}>{d.dir === 'up' ? '▲' : '▼'} {d.text.split(' (')[1]?.replace(')', '') || d.text}</span>}
    </div>
  )
}

// ---------- 30-day chart ----------
const METRICS = {
  cost: { label: 'Cost', get: (d) => d.cost, fmt: fmtCost, cls: 'm-cost' },
  tokens: { label: 'Tokens', get: (d) => d.tokens, fmt: fmtTokens, cls: 'm-tokens' },
  cache: { label: 'Cache', get: (d) => d.cacheRead, fmt: fmtTokens, cls: 'm-cache' },
}

function niceMax(v) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)
}

function DailyChart({ daily }) {
  const [metric, setMetric] = usePersisted('cc-usage-metric', 'cost')
  const [hover, setHover] = useState(null)
  const [boxRef, boxW] = useWidth()
  const M = METRICS[metric]
  const vals = daily.map(M.get)
  const max = niceMax(Math.max(...vals))
  // Draw at the real pixel width so text stays 9px however wide the panel is.
  const W = Math.max(240, boxW || 330), H = Math.min(200, Math.max(130, W * 0.32)), L = 4, R = 40, T = 8, B = 20
  const bw = (W - L - R) / daily.length
  const y = (v) => T + (1 - v / max) * (H - T - B)
  const total = vals.reduce((a, b) => a + b, 0)
  const h = hover != null ? daily[hover] : null
  const ticks = [0, max / 2, max]
  return (
    <div className="u-chart">
      <div className="u-chart-head">
        <span className="u-label"><Icon name="grid" size={12} /> Daily · last {daily.length} days</span>
        <span className="u-total"><b>{M.fmt(total)}</b><span className="muted"> total</span></span>
      </div>
      <div className="seg small-seg" role="tablist">
        {Object.entries(METRICS).map(([id, m]) => (
          <button key={id} role="tab" aria-selected={metric === id} className={metric === id ? 'on' : ''} onClick={() => setMetric(id)}>{m.label}</button>
        ))}
      </div>
      <div className="u-chart-body" ref={boxRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={`bars ${M.cls}`} onPointerLeave={() => setHover(null)} role="img" aria-label={`Daily ${M.label.toLowerCase()}, last ${daily.length} days`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
              <text x={W - R + 4} y={y(t) + 3} className="axis-label">{M.fmt(t).replace('.00', '')}</text>
            </g>
          ))}
          {daily.map((d, i) => {
            const v = M.get(d)
            const top = y(v)
            const x = L + i * bw
            return (
              <g key={d.date} onPointerEnter={() => setHover(i)}>
                <rect x={x} y={T} width={bw} height={H - T - B} className="hit" />
                {v > 0 && <rect x={x + 1} y={top} width={Math.max(1, bw - 2)} height={Math.max(1.5, H - B - top)} rx="1.5"
                  className={`bar ${i === daily.length - 1 ? 'today' : ''} ${hover === i ? 'hl' : ''}`} />}
              </g>
            )
          })}
          {[0, 7, 14, 21, 28].filter((i) => i < daily.length).map((i) => (
            <text key={i} x={i === 0 ? L : L + i * bw + bw / 2} y={H - 5} className="axis-label" textAnchor={i === 0 ? 'start' : 'middle'}>
              {new Date(`${daily[i].date}T12:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </text>
          ))}
        </svg>
        {h && (
          <div className="tooltip" style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%`, transform: `translateX(${hover < daily.length * 0.2 ? '-10%' : hover > daily.length * 0.7 ? '-92%' : '-50%'})` }}>
            <div className="muted small">{new Date(`${h.date}T12:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div><b>{fmtCost(h.cost)}</b> · {fmtTokens(h.tokens)} tokens</div>
            {h.tokens > 0 && <div className="muted small">{Math.round((h.cacheRead / h.tokens) * 100)}% from cache</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- panel ----------
function maskEmail(e) {
  const [u, d] = e.split('@')
  return `${u.slice(0, 2)}•••@${d}`
}

function Activity({ provider }) {
  const { data, loading } = usePoll(`/usage/${provider}`, 5 * 60 * 1000)
  if (loading && !data) return <div className="skeleton-rows"><div /><div /></div>
  if (!data?.supported) return null
  const t = data.today, y = data.yesterday
  const lastActive = [...data.daily].reverse().find((d) => d.tokens > 0)
  const anyMonth = data.daily.some((d) => d.tokens > 0)
  return (
    <div className="activity">
      {t.tokens > 0 ? (
        <div className="mini-stats">
          <MiniStat label="Cost today" value={fmtCost(t.cost)} d={delta(t.cost, y.cost, fmtCost)} />
          <MiniStat label="Tokens" value={fmtTokens(t.tokens)} d={delta(t.tokens, y.tokens, fmtTokens)} />
          <MiniStat label="Active" value={fmtMins(t.activeMinutes)} d={delta(t.activeMinutes, y.activeMinutes, fmtMins)} />
        </div>
      ) : (
        <p className="quiet-note">
          <Icon name="pause" size={12} /> No activity today
          {lastActive ? ` · last used ${new Date(`${lastActive.date}T12:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })} (${fmtTokens(lastActive.tokens)} tokens, ${fmtCost(lastActive.cost)})` : ' in the last 30 days'}
        </p>
      )}
      {t.tokens > 0 && <p className="muted small cache-note">{Math.round((t.cacheRead / t.tokens) * 100)}% of today's tokens came from cache. Cost is at API prices, not your bill.</p>}
      {anyMonth && <DailyChart daily={data.daily} />}
    </div>
  )
}

function ProviderRow({ p, open, onToggle, best, isPrimary, onMakePrimary }) {
  const [reveal, setReveal] = usePersisted('cc-usage-reveal', false)
  const main = p.windows.find((w) => w.kind === 'session') || p.windows.find((w) => w.kind !== 'credits') || p.windows[0]
  const rest = p.windows.filter((w) => w !== main && (w.kind !== 'credits' || w.percentRemaining < 100))
  const h = main ? health(main) : { level: 'unknown' }
  const org = p.account?.organization && !/^[0-9a-f-]{20,}$/i.test(p.account.organization) ? p.account.organization : null
  return (
    <li className={`prov ${open ? 'open' : ''}`}>
      <button className="prov-head" onClick={onToggle} aria-expanded={open}>
        <span className={`avatar sm av-${p.provider}`}>{nice(p.provider)[0]}</span>
        <span className="prov-name">
          <b>{nice(p.provider)}</b>
          {p.plan && <span className="plan-tag">{p.plan}</span>}
          {best && <span className="best-tag" title="Most budget expiring soonest">spend first</span>}
        </span>
        {p.usable && main ? (
          <span className="prov-meter">
            <PaceBar w={main} level={h.level} />
            <span className={`prov-pct t-${h.level}`}>{main.percentRemaining}%</span>
          </span>
        ) : <span className="prov-status">{p.status.replace('_', ' ')}</span>}
        <Icon name="chevron" size={12} className={`caret ${open ? 'rot90' : ''}`} />
      </button>
      {open && (
        <div className="prov-body">
          <div className="acct">
            <span className="acct-email">{p.account?.email ? (reveal ? p.account.email : maskEmail(p.account.email)) : '—'}</span>
            {p.account?.email && (
              <button className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Hide email' : 'Show email'} title={reveal ? 'Hide email' : 'Show email'}>
                <Icon name={reveal ? 'eye-off' : 'eye'} size={12} />
              </button>
            )}
            {org && <span className="muted">· {org}</span>}
            <button className={`star ${isPrimary ? 'on' : ''}`} onClick={onMakePrimary} title={isPrimary ? 'Shown in the top bar' : 'Show in the top bar'} aria-pressed={isPrimary}>
              <Icon name="star" size={12} /> {isPrimary ? 'Default' : 'Make default'}
            </button>
          </div>
          {!p.usable && p.hint && <p className="hint mono">{p.hint}</p>}
          <div className="w-list">
            {main && <WindowRow w={main} />}
            {rest.map((w) => <WindowRow key={w.id} w={w} />)}
          </div>
          {(p.provider === 'claude' || p.provider === 'codex') && <Activity provider={p.provider} />}
        </div>
      )}
    </li>
  )
}

export default function Usage({ data, error }) {
  const providers = data?.providers || []
  const [primary, setPrimary] = useShared('cc-primary', 'claude')
  const [openId, setOpenId] = usePersisted('cc-usage-open', 'claude')
  // Default provider first, then the rest in quota-axi's order.
  const sorted = [...providers].sort((a, b) => (b.provider === primary) - (a.provider === primary))
  return (
    <div className="usage">
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
      <ul className="prov-list">
        {sorted.map((p) => (
          <ProviderRow key={p.provider} p={p} open={openId === p.provider} onToggle={() => setOpenId(openId === p.provider ? null : p.provider)}
            best={data.bestNow === p.provider} isPrimary={primary === p.provider} onMakePrimary={() => setPrimary(p.provider)} />
        ))}
      </ul>
    </div>
  )
}

function Ring({ pct }) {
  const r = 6, c = 2 * Math.PI * r
  const lv = pct == null ? 'unknown' : pct < 10 ? 'critical' : pct < 30 ? 'warning' : 'good'
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={`ring r-${lv}`} aria-hidden="true">
      <circle cx="8" cy="8" r={r} className="ring-bg" />
      {pct != null && <circle cx="8" cy="8" r={r} className="ring-fg" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 8 8)" />}
    </svg>
  )
}
