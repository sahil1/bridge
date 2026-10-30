import { useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useShared, useWidth } from './layout.jsx'
import { api, usePoll, fmtTime, settingsChanged, refetch, useFleet } from '../api.js'
import SignInButton from './SignIn.jsx'
import { AllowKeychain, level, statusText, lapsed, Left, weekResets, sameAs, sameText, usingIt, nameOf, asList, makeDefault, removeAccount, removeTwin, signOut, DefaultTag, maskEmail } from './AccountMenu.jsx'
import { addAccount } from './AddAccount.jsx'
import { t, tx, locale, midSentence } from '../i18n/index.js'

const NAMES = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', grok: 'Grok', copilot: 'Copilot', openrouter: 'OpenRouter', deepseek: 'DeepSeek', kimi: 'Kimi', zai: 'Z.ai', agy: 'Antigravity' }
const nice = (p) => NAMES[p] || p[0].toUpperCase() + p.slice(1)

// ---------- formatting ----------
export const fmtTokens = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n))
const fmtCost = (n) => `$${n >= 1000 ? n.toLocaleString(locale(), { maximumFractionDigits: 0 }) : n.toFixed(2)}`
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`)

function fmtIn(iso) {
  if (!iso) return null
  const ms = new Date(iso) - Date.now()
  if (ms <= 0) return t('now')
  const m = Math.round(ms / 60000)
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`
}

function delta(cur, prev, fmt) {
  if (!prev) return cur ? { text: t('new today'), dir: 'up' } : null
  const diff = cur - prev
  const pct = (diff / prev) * 100
  return { text: `${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))} (${diff >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%)`, dir: diff >= 0 ? 'up' : 'down' }
}

// ---------- window health ----------
function health(w) {
  if (w.percentRemaining == null) return { level: 'unknown', label: t('No data') }
  if (w.percentRemaining < 10) return { level: 'critical', label: t('Low') }
  const runsOut = w.pace?.projectedExhaustedAt && w.resetsAt && new Date(w.pace.projectedExhaustedAt) < new Date(w.resetsAt)
  if (runsOut || w.pace?.status === 'ahead' || w.percentRemaining < 30) return { level: 'warning', label: t('Watch') }
  return { level: 'good', label: t('Healthy') }
}

// Where you'd be if you used the window evenly (remaining = time remaining), as a mark under the
// bar: only in a window's own row, where it's labelled, and not at either end of the window,
// where it sat at 0 under a bar that wasn't and looked like a reading of its own.
const paceOf = (w) => { const e = w.pace?.elapsedPercent; return e != null && e > 3 && e < 97 ? 100 - e : null }
function PaceBar({ w, level, pace = true }) {
  const paceAt = pace ? paceOf(w) : null
  return (
    <div className="u-bar" role="meter" aria-valuenow={w.percentRemaining} aria-valuemin="0" aria-valuemax="100" aria-label={t('{label} {pct}% left', { label: w.label, pct: String(w.percentRemaining) })}>
      <div className={`u-fill f-${level}`} style={{ width: `${Math.max(1.5, w.percentRemaining ?? 0)}%` }} />
      {paceAt != null && <span className="u-pace" style={{ left: `${Math.min(99, Math.max(1, paceAt))}%` }} title={t('Even pace would leave {pct}% now', { pct: Math.round(paceAt) })} />}
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
        <span>{w.resetsAt ? t('resets in {time}', { time: fmtIn(w.resetsAt) }) : t('no reset')}{paceOf(w) != null && <span className="w-pace" title={t("Where you'd be if you used it evenly over the window")}> · ▲ {t('even use: {pct}%', { pct: Math.round(paceOf(w)) })}</span>}</span>
        {runsOut ? <span className="u-warn">{t('runs out in {time}', { time: fmtIn(w.pace.projectedExhaustedAt) })}</span>
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
  cost: { label: tx('Cost'), get: (d) => d.cost, fmt: fmtCost, cls: 'm-cost' },
  tokens: { label: tx('Tokens'), get: (d) => d.tokens, fmt: fmtTokens, cls: 'm-tokens' },
  cache: { label: tx('Cache'), get: (d) => d.cacheRead, fmt: fmtTokens, cls: 'm-cache' },
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
        <span className="u-label"><Icon name="grid" size={12} /> {t('Daily · last {n} days', { n: daily.length })}</span>
        <span className="u-total"><b>{M.fmt(total)}</b><span className="muted"> {t('total')}</span></span>
      </div>
      <div className="seg small-seg" role="tablist">
        {Object.entries(METRICS).map(([id, m]) => (
          <button key={id} role="tab" aria-selected={metric === id} className={metric === id ? 'on' : ''} onClick={() => setMetric(id)}>{t(m.label)}</button>
        ))}
      </div>
      <div className="u-chart-body" ref={boxRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={`bars ${M.cls}`} onPointerLeave={() => setHover(null)} role="img" aria-label={t('Daily {metric}, last {n} days', { metric: midSentence(t(M.label)), n: daily.length })}>
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
              {new Date(`${daily[i].date}T12:00`).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}
            </text>
          ))}
        </svg>
        {h && (
          <div className="tooltip" style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%`, transform: `translateX(${hover < daily.length * 0.2 ? '-10%' : hover > daily.length * 0.7 ? '-92%' : '-50%'})` }}>
            <div className="muted small">{new Date(`${h.date}T12:00`).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div><b>{fmtCost(h.cost)}</b> · {t('{n} tokens', { n: fmtTokens(h.tokens) })}</div>
            {h.tokens > 0 && <div className="muted small">{t('{pct}% from cache', { pct: Math.round((h.cacheRead / h.tokens) * 100) })}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- panel ----------

function Activity({ provider, note }) {
  const { data, loading } = usePoll(`/usage/${provider}`, 5 * 60 * 1000)
  if (loading && !data) return <div className="skeleton-rows"><div /><div /></div>
  if (!data?.supported) return null
  const today = data.today, y = data.yesterday
  const lastActive = [...data.daily].reverse().find((d) => d.tokens > 0)
  const anyMonth = data.daily.some((d) => d.tokens > 0)
  return (
    <div className="activity">
      {today.tokens > 0 ? (
        <div className="mini-stats">
          <MiniStat label={t('Cost today')} value={fmtCost(today.cost)} d={delta(today.cost, y.cost, fmtCost)} />
          <MiniStat label={t('Tokens')} value={fmtTokens(today.tokens)} d={delta(today.tokens, y.tokens, fmtTokens)} />
          <MiniStat label={t('Active')} value={fmtMins(today.activeMinutes)} d={delta(today.activeMinutes, y.activeMinutes, fmtMins)} />
        </div>
      ) : (
        <p className="quiet-note">
          <Icon name="pause" size={12} /> {lastActive
            ? t('No activity today · last used {date} ({tokens} tokens, {cost})', { date: new Date(`${lastActive.date}T12:00`).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }), tokens: fmtTokens(lastActive.tokens), cost: fmtCost(lastActive.cost) })
            : t('No activity today in the last 30 days')}
        </p>
      )}
      {today.tokens > 0 && <p className="muted small cache-note">{t("{pct}% of today's tokens came from cache. Cost is at API prices, not your bill.", { pct: Math.round((today.cacheRead / today.tokens) * 100) })}</p>}
      {note && (today.tokens > 0 || anyMonth) && <p className="muted small cache-note">{note}</p>}
      {anyMonth && <DailyChart daily={data.daily} />}
    </div>
  )
}

// Not signed in, as the quota reading says it (not a reading that failed for another reason).
const signedOut = (p) => !p.usable && !p.allow && (p.status === 'auth_required' || p.notSetUp)

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
          {best && <span className="best-tag" title={t('Most budget expiring soonest')}>{t('spend first')}</span>}
        </span>
        {p.usable && main ? (
          <span className="prov-meter">
            <PaceBar w={main} level={h.level} pace={false} />
            <span className={`prov-pct t-${h.level}`}>{main.percentRemaining}%</span>
          </span>
        ) : <span className="prov-status">{signedOut(p) ? t('not signed in') : p.status.replace(/_/g, ' ')}</span>}
        <Icon name="chevron" size={12} className={`caret ${open ? 'rot90' : ''}`} />
      </button>
      {signedOut(p) && <div className="prov-signin"><SignInButton kind={p.provider} onCheck={() => refetch('/quota')} /></div>}
      {open && (
        <div className="prov-body">
          <div className="acct">
            <span className="acct-email">{p.account?.email ? (reveal ? p.account.email : maskEmail(p.account.email)) : '—'}</span>
            {p.account?.email && (
              <button className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? t('Hide email') : t('Show email')} title={reveal ? t('Hide email') : t('Show email')}>
                <Icon name={reveal ? 'eye-off' : 'eye'} size={12} />
              </button>
            )}
            {org && <span className="muted">· {org}</span>}
            <TopBarPick on={isPrimary} onClick={onMakePrimary} />
          </div>
          {p.allow ? <AllowKeychain id={`${p.provider}-default`} /> : !signedOut(p) && !p.usable && p.hint && <p className="hint mono">{p.hint}</p>}
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

// Which agent the top bar's usage chip shows: this one, or a click puts it there.
function TopBarPick({ on, onClick }) {
  return (
    <button type="button" className={`top-pick ${on ? 'on' : ''}`} onClick={onClick} title={on ? t('Shown in the top bar') : t('Show in the top bar')} aria-pressed={on}>
      <Icon name="pin" size={12} /> {on ? t('In top bar') : t('Show in top bar')}
    </button>
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
  const v = { sum: fmtSum(c.sum), n: c.n }
  const total = what === '5h window'
    ? (c.n === 1 ? t("{sum} of {n} account's 5h window left", v) : t("{sum} of {n} accounts' 5h windows left", v))
    : (c.n === 1 ? t("{sum} of {n} account's weekly window left", v) : t("{sum} of {n} accounts' weekly windows left", v))
  return [total, c.soonest && t('next reset in {time}', { time: fmtIn(c.soonest) }), c.missing && t('{n} not read', { n: c.missing })].filter(Boolean).join(' · ')
}

function SegBar({ parts }) {
  return (
    <span className="seg-bar" role="img" aria-label={parts.map((x) => (x.pct == null ? t('{label} no data', { label: x.label }) : t('{label} {pct}% left', { label: x.label, pct: x.pct }))).join(', ')}>
      {parts.map((x) => (
        <span key={x.id} className={`seg-part ${x.pct == null ? 'unread' : ''}`} title={x.pct == null ? t('{label}: no data', { label: x.label }) : t('{label}: {pct}% left', { label: x.label, pct: x.pct })}>
          {x.pct != null && <span className={`u-fill f-${level(x.pct)}`} style={{ width: `${Math.max(x.pct ? 4 : 0, x.pct)}%` }} />}
        </span>
      ))}
    </span>
  )
}

// One account: its name, plan and 5-hour meter; open for every window and what you can do with it
// (Make default, Sign in again, Sign out, Remove). The row shows both windows and when the week
// resets; Sign in is on the row, not inside it. auto: Auto is on (its pick gets the auto tag, and
// no row the star). only: the one account listed, which can't be removed.
function AccountUsage({ a, auto, open, onToggle, inUse, only }) {
  const [reveal, setReveal] = usePersisted('cc-usage-reveal', false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const main = a.windows.find((w) => w.kind === 'session') || a.windows.find((w) => w.kind !== 'credits') || a.windows[0]
  const rest = a.windows.filter((w) => w !== main && (w.kind !== 'credits' || w.percentRemaining < 100))
  const kind = a.id.replace(/-[^-]+$/, '')
  const reset = weekResets(a)
  const name = nameOf(a)
  const isDefault = a.active && !auto
  const act = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const rowSignIn = !a.allow && ((!a.usable && a.signedIn === false) || (a.signedIn !== false && lapsed(a)))
  return (
    <li className={`acct-u ${open ? 'open' : ''}`}>
      <button className="acct-u-head" onClick={onToggle} aria-expanded={open}>
        <span className="acct-u-name">
          <span className="prov-name">
            <b>{name}</b>
            {a.plan && <span className="plan-tag">{a.plan}</span>}
            {isDefault && <DefaultTag />}
            {a.active && auto && <span className="best-tag" title={t('Auto starts new agents here now: it has the most left')}>{t('auto')}</span>}
          </span>
          {reset && <small className="acct-u-reset">{reset}</small>}
        </span>
        {a.usable && main ? <Left a={a} /> : <span className="prov-status">{statusText(a, false, inUse)}</span>}
        <Icon name="chevron" size={12} className={`caret ${open ? 'rot90' : ''}`} />
      </button>
      {!a.allow && !a.usable && a.signedIn === false && <div className="acct-u-signin"><SignInButton kind={kind} account={a.id} onCheck={() => refetch('/quota')} /></div>}
      {/* Why it asks is in the button's tooltip: the row already says in use or sign-in expired. */}
      {!a.allow && a.signedIn !== false && lapsed(a) && (
        <div className="acct-u-signin">
          <SignInButton kind={kind} account={a.id} label={t('Sign in again')} onCheck={() => refetch('/quota')}
            title={inUse ? t('An agent is using it, so it still works, but its usage can\'t be read until it signs in again.') : t('Its sign-in has expired, so its usage can\'t be read. Sign in again, or start an agent on this account: it renews the sign-in when it runs.')} />
        </div>
      )}
      {open && (
        <div className="acct-u-body">
          {a.account?.email && (
            <div className="acct">
              <span className="acct-email">{reveal ? a.account.email : maskEmail(a.account.email)}</span>
              <button className="icon-btn" onClick={() => setReveal(!reveal)} aria-label={reveal ? t('Hide email') : t('Show email')} title={reveal ? t('Hide email') : t('Show email')}>
                <Icon name={reveal ? 'eye-off' : 'eye'} size={12} />
              </button>
            </div>
          )}
          {a.allow && <AllowKeychain id={a.id} />}
          {!a.allow && !a.usable && a.signedIn !== false && !lapsed(a) && <p className="muted small">{a.status === 'pending' ? t('Reading its usage…') : a.error ? t("Couldn't read its usage ({error}).", { error: a.error.replace(/_/g, ' ') }) : t("Couldn't read its usage.")}</p>}
          {a.usable && main && <div className="w-list"><WindowRow w={main} />{rest.map((w) => <WindowRow key={w.id} w={w} />)}</div>}
          <div className="acct-acts" aria-busy={busy}>
            {!isDefault && <button type="button" className="btn small" disabled={busy} onClick={() => act(() => makeDefault(kind, a.id))} title={t('New agents start on {name}', { name })}><Icon name="star" size={11} /> {t('Make default')}</button>}
            {!rowSignIn && a.signedIn !== false && <SignInButton kind={kind} account={a.id} label={t('Sign in again')} className="btn small" onCheck={() => refetch('/quota')} />}
            {a.signedIn !== false && <button type="button" className="ghost-btn" disabled={busy} onClick={() => act(() => signOut(kind, a))}>{t('Sign out')}</button>}
            <button type="button" className="ghost-btn" disabled={busy || only} onClick={() => act(() => removeAccount(kind, a))}
              title={only ? t("It's your only account here, so it stays. Add another one first.") : a.isDefault ? t("Takes it off Bridge AI's list. Nothing is signed out.") : t('Signs it out and removes it')}><Icon name="trash" size={11} /> {t('Remove')}</button>
          </div>
          {err && <p className="error-text small" role="alert">{err}</p>}
        </div>
      )}
    </li>
  )
}

// An agent with its accounts listed: all of them together in the header, a row each inside (your
// default with the star), Auto, and the cost history once (it's one history for every account).
function AccountsRow({ g, open, onToggle, isPrimary, onMakePrimary }) {
  const [openAcct, setOpenAcct] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const sess = combine(g.accounts, 'session')
  const week = combine(g.accounts, 'weekly')
  const several = g.accounts.length > 1
  const auto = g.setting === 'auto' && several
  const { fleet } = useFleet()
  const same = sameAs(g)
  const act = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  // Auto off: your default is the one Auto had picked, until you make another one default.
  const setAuto = (on) => act(() => makeDefault(g.kind, on ? 'auto' : g.pick || g.accounts[0].id))
  return (
    <li className={`prov ${open ? 'open' : ''}`}>
      <button className="prov-head" onClick={onToggle} aria-expanded={open}>
        <span className={`avatar sm av-${g.kind}`}>{nice(g.kind)[0]}</span>
        <span className="prov-name grp">
          <b>{nice(g.kind)}</b>
          <span className="grp-count">{several ? t('{n} accounts', { n: g.accounts.length }) : nameOf(g.accounts[0])}</span>
        </span>
        {sess.n ? (
          <span className="prov-meter" title={combinedText(sess, '5h window')}>
            <SegBar parts={sess.parts} />
            <span className="prov-pct">{fmtSum(sess.sum)}<small className="muted">/{sess.n}</small></span>
          </span>
        ) : <span className="prov-status">{t('no data')}</span>}
        <Icon name="chevron" size={12} className={`caret ${open ? 'rot90' : ''}`} />
      </button>
      {open && (
        <div className="prov-body">
          <div className="acct">
            {several
              ? <label className="acct-auto" title={t('New agents start on the account with the most left')}><input type="checkbox" checked={auto} disabled={busy} onChange={(e) => setAuto(e.target.checked)} />{t('Auto: start new agents on the one with the most left')}</label>
              : <span className="muted">{t('New agents start on {name}', { name: nameOf(g.accounts[0]) })}</span>}
            <TopBarPick on={isPrimary} onClick={onMakePrimary} />
          </div>
          {(sess.n > 0 || week.n > 0) && (
            <div className="acct-sum">
              <b>{t('All accounts')}</b>
              {sess.n > 0 && <span>{combinedText(sess, '5h window')}</span>}
              {week.n > 0 && <span>{combinedText(week, 'weekly window')}</span>}
            </div>
          )}
          {same.map((list) => { const s = sameText(list, g.setting, g.kind); return (
            <div key={list.map((a) => a.id).join()} className="acct-same-note" role="status">
              <p className="small"><Icon name="alert" size={12} /> {s.title}</p>
              <button type="button" className="btn small" disabled={busy} title={s.why} onClick={() => act(() => removeTwin(g.kind, s, g.setting))}>{s.action}</button>
            </div>
          ) })}
          {err && <p className="error-text small" role="alert">{err}</p>}
          <ul className="acct-us">
            {g.accounts.map((a) => <AccountUsage key={a.id} a={a} auto={auto} only={!several} inUse={usingIt(fleet, a.id)} open={openAcct === a.id} onToggle={() => setOpenAcct(openAcct === a.id ? null : a.id)} />)}
          </ul>
          <button type="button" className="ghost-btn acct-add" onClick={() => addAccount(g.kind)}><Icon name="plus" size={12} /> {t('Add another {agent} account', { agent: nice(g.kind) })}</button>
          {(g.kind === 'claude' || g.kind === 'codex') && <Activity provider={g.kind} note={t('Cost and tokens are for all your {agent} accounts together: they share one history.', { agent: nice(g.kind) })} />}
        </div>
      )}
    </li>
  )
}

export default function Usage({ data, error }) {
  const providers = data?.providers || []
  // The agents whose accounts are listed one by one (more than one, or not just your usual login).
  const groups = (data?.accounts || []).filter(asList)
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
export const USAGE_OFF_WHY = tx('To show it, Bridge AI asks each provider with the sign-in your agents already use on this computer. Some providers, Anthropic among them, don\'t allow other apps to use their sign-ins, so it stays off unless you turn it on. Cost and token stats come from files on this computer and work either way.')

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
      <p>{t('See how much of each plan is left (Claude, Codex and the others), here and in the top bar.')}</p>
      <p className="muted small">{t(USAGE_OFF_WHY)}</p>
      {err && <p className="error-text">{err}</p>}
      <button type="button" className="btn small" onClick={turnOn} disabled={busy}>{busy ? t('Reading your plans…') : t('Turn on')}</button>
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
