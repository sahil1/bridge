import { useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useShared, useWidth } from './layout.jsx'
import { api, usePoll, fmtTime, settingsChanged } from '../api.js'
import { AllowKeychain, level, statusText } from './AccountMenu.jsx'

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

function Activity({ provider, note }) {
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
      {note && (t.tokens > 0 || anyMonth) && <p className="muted small cache-note">{note}</p>}
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
          {p.allow ? <AllowKeychain id={`${p.provider}-default`} /> : !p.usable && p.hint && <p className="hint mono">{p.hint}</p>}
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

// ---------- several accounts ----------
// Every account's share of one window, kept apart: what's left in each (an empty one stays
// empty, not averaged away), their total in windows, and the soonest reset.
function combine(accounts, kind) {
  const parts = accounts.map((a) => {
    const w = a.usable ? a.windows.find((x) => x.kind === kind) : null
    return { id: a.id, label: a.label, pct: w?.percentRemaining ?? null, resetsAt: w?.resetsAt || null }
  })
  const known = parts.filter((x) => x.pct != null)
  const resets = known.map((x) => x.resetsAt).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))
  return { parts, n: known.length, sum: known.reduce((s, x) => s + x.pct / 100, 0), missing: parts.length - known.length, soonest: resets[0] || null }
}
const fmtSum = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')
function combinedText(c, what) {
  if (!c.n) return null
  const total = `${fmtSum(c.sum)} of ${c.n} account${c.n === 1 ? "'s" : "s'"} ${what}${c.n === 1 ? '' : 's'} left`
  return [total, c.soonest && `next reset in ${fmtIn(c.soonest)}`, c.missing && `${c.missing} not read`].filter(Boolean).join(' · ')
}

function SegBar({ parts }) {
  return (
    <span className="seg-bar" role="img" aria-label={parts.map((x) => `${x.label} ${x.pct == null ? 'no data' : `${x.pct}% left`}`).join(', ')}>
      {parts.map((x) => (
        <span key={x.id} className={`seg-part ${x.pct == null ? 'unread' : ''}`} title={`${x.label}: ${x.pct == null ? 'no data' : `${x.pct}% left`}`}>
          {x.pct != null && <span className={`u-fill f-${level(x.pct)}`} style={{ width: `${Math.max(x.pct ? 4 : 0, x.pct)}%` }} />}
        </span>
      ))}
    </span>
  )
}

// One account: its name, plan and 5-hour meter; open for every window and its sign-in.
function AccountUsage({ a, auto, open, onToggle }) {
  const [reveal, setReveal] = usePersisted('cc-usage-reveal', false)
  const main = a.windows.find((w) => w.kind === 'session') || a.windows.find((w) => w.kind !== 'credits') || a.windows[0]
  const rest = a.windows.filter((w) => w !== main && (w.kind !== 'credits' || w.percentRemaining < 100))
  const h = main ? health(main) : { level: 'unknown' }
  return (
    <li className={`acct-u ${open ? 'open' : ''}`}>
      <button className="acct-u-head" onClick={onToggle} aria-expanded={open}>
        <span className="prov-name">
          <b>{a.label}</b>
          {a.plan && <span className="plan-tag">{a.plan}</span>}
          {a.active && <span className="best-tag" title="New agents start on this account">{auto ? 'auto' : 'active'}</span>}
        </span>
        {a.usable && main ? (
          <span className="prov-meter">
            <PaceBar w={main} level={h.level} />
            <span className={`prov-pct t-${h.level}`}>{main.percentRemaining}%</span>
          </span>
        ) : <span className="prov-status">{statusText(a)}</span>}
        <Icon name="chevron" size={12} className={`caret ${open ? 'rot90' : ''}`} />
      </button>
      {open && (
        <div className="acct-u-body">
          {a.account?.email && (
            <div className="acct">
              <span className="acct-email">{reveal ? a.account.email : maskEmail(a.account.email)}</span>
              <button className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Hide email' : 'Show email'} title={reveal ? 'Hide email' : 'Show email'}>
                <Icon name={reveal ? 'eye-off' : 'eye'} size={12} />
              </button>
            </div>
          )}
          {a.allow && <AllowKeychain id={a.id} />}
          {!a.allow && !a.usable && <p className="muted small">{a.signedIn === false ? 'Not signed in. Sign in from Settings › Model providers › Accounts.' : a.status === 'pending' ? 'Reading its usage…' : `Couldn't read its usage${a.error ? ` (${a.error.replace(/_/g, ' ')})` : ''}.`}</p>}
          {a.usable && main && <div className="w-list"><WindowRow w={main} />{rest.map((w) => <WindowRow key={w.id} w={w} />)}</div>}
        </div>
      )}
    </li>
  )
}

// An agent with several accounts: all of them together in the header, a row each inside, and
// the cost history once (it's one history for every account).
function AccountsRow({ g, open, onToggle, isPrimary, onMakePrimary }) {
  const [openAcct, setOpenAcct] = useState(null)
  const sess = combine(g.accounts, 'session')
  const week = combine(g.accounts, 'weekly')
  const auto = g.setting === 'auto'
  return (
    <li className={`prov ${open ? 'open' : ''}`}>
      <button className="prov-head" onClick={onToggle} aria-expanded={open}>
        <span className={`avatar sm av-${g.kind}`}>{nice(g.kind)[0]}</span>
        <span className="prov-name grp">
          <b>{nice(g.kind)}</b>
          <span className="grp-count">{g.accounts.length} accounts</span>
        </span>
        {sess.n ? (
          <span className="prov-meter" title={combinedText(sess, '5h window')}>
            <SegBar parts={sess.parts} />
            <span className="prov-pct">{fmtSum(sess.sum)}<small className="muted">/{sess.n}</small></span>
          </span>
        ) : <span className="prov-status">no data</span>}
        <Icon name="chevron" size={12} className={`caret ${open ? 'rot90' : ''}`} />
      </button>
      {open && (
        <div className="prov-body">
          <div className="acct">
            <span className="muted">{auto ? 'New agents start on the account with the most left' : 'New agents start on the active account'}</span>
            <button className={`star ${isPrimary ? 'on' : ''}`} onClick={onMakePrimary} title={isPrimary ? 'Shown in the top bar' : 'Show in the top bar'} aria-pressed={isPrimary}>
              <Icon name="star" size={12} /> {isPrimary ? 'Default' : 'Make default'}
            </button>
          </div>
          {(sess.n > 0 || week.n > 0) && (
            <div className="acct-sum">
              <b>All accounts</b>
              {sess.n > 0 && <span>{combinedText(sess, '5h window')}</span>}
              {week.n > 0 && <span>{combinedText(week, 'weekly window')}</span>}
            </div>
          )}
          <ul className="acct-us">
            {g.accounts.map((a) => <AccountUsage key={a.id} a={a} auto={auto} open={openAcct === a.id} onToggle={() => setOpenAcct(openAcct === a.id ? null : a.id)} />)}
          </ul>
          {(g.kind === 'claude' || g.kind === 'codex') && <Activity provider={g.kind} note={`Cost and tokens are for all your ${nice(g.kind)} accounts together: they share one history.`} />}
        </div>
      )}
    </li>
  )
}

export default function Usage({ data, error }) {
  const providers = data?.providers || []
  const groups = (data?.accounts || []).filter((g) => g.accounts.length > 1)
  const [primary, setPrimary] = useShared('cc-primary', 'claude')
  const [openId, setOpenId] = usePersisted('cc-usage-open', 'claude')
  // One row per provider, and one for all of an agent's accounts when it has several (even if its
  // usual login isn't set up). Default provider first, then the rest in quota-axi's order.
  const ids = [...new Set([...providers.map((p) => p.provider), ...groups.map((g) => g.kind)])]
  const sorted = ids.sort((a, b) => (b === primary) - (a === primary))
  if (data?.off) return <div className="usage"><UsageOff /></div>
  return (
    <div className="usage">
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
      <ul className="prov-list">
        {sorted.map((id) => {
          const g = groups.find((x) => x.kind === id)
          const row = { open: openId === id, onToggle: () => setOpenId(openId === id ? null : id), best: data.bestNow === id, isPrimary: primary === id, onMakePrimary: () => setPrimary(id) }
          return g ? <AccountsRow key={id} g={g} {...row} /> : <ProviderRow key={id} p={providers.find((p) => p.provider === id)} {...row} />
        })}
      </ul>
    </div>
  )
}

// Plan usage is off until you turn it on: reading it asks each provider with the sign-in your
// agents use on this computer, and some providers' terms don't allow other apps to do that.
export const USAGE_OFF_WHY = 'To show it, Bridge AI asks each provider with the sign-in your agents already use on this computer (through quota-axi). Some providers, Anthropic among them, don\'t allow other apps to use their sign-ins, so it stays off unless you turn it on. Cost and token stats come from files on this computer and work either way.'

function UsageOff() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const turnOn = async () => {
    setBusy(true)
    setErr(null)
    try { await api('/settings', { method: 'PATCH', body: { quota: { read: true } } }); settingsChanged() } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <div className="usage-off">
      <p>See how much of each plan is left (Claude, Codex and the others), here and in the top bar.</p>
      <p className="muted small">{USAGE_OFF_WHY}</p>
      {err && <p className="error-text">{err}</p>}
      <button type="button" className="btn small" onClick={turnOn} disabled={busy}>{busy ? 'Reading your plans…' : 'Turn on'}</button>
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
