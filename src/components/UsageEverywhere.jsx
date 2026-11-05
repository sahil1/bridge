import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useWidth } from './layout.jsx'
import { usePoll } from '../api.js'
import { fmtTokens } from './Usage.jsx'
import { openToday } from './today.js'
import { t, tx, locale } from '../i18n/index.js'

// Every provider in one view (the trial usage-everywhere, server/usageall.js): the tokens each
// provider and model used, by day and by what in Bridge AI used them, with the cost where an API
// key has a price and the time a model took on this computer. A provider whose numbers can't be read,
// or that keeps none, says so on its row. It all stays on this computer.
const FEATURES = {
  chat: tx('Chat'), meetings: tx('Meeting notes'), assist: tx('AI Assist'), board: tx('Whiteboards'), dictation: tx('Dictation cleanup'),
  'voice-edit': tx('Edit by voice'), insights: tx('Insights'), pr: tx('Pull requests'), consult: tx('Questions from agents'), agents: tx("Agents' own work"), other: tx('Other'),
}
const VIA = { agent: tx('agent'), key: tx('API key'), cloud: tx('cloud'), local: tx('on this computer') }
const VIA_ICON = { agent: 'bot', key: 'unlock', cloud: 'cloud', local: 'laptop' }
const RANGES = [[7, '7D'], [30, '30D'], [90, '90D']]
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)
const fmtCost = (n) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n >= 1000 ? Math.round(n).toLocaleString(locale()) : n.toFixed(2)}`)
const fmtTime = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`)
const fmtDay = (d) => new Date(`${d}T12:00`).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })

// rows: [date, source, model, feature, tokens, in, out, cost, seconds, answers]
function summarize(data, pick) {
  if (!data?.rows) return null
  const rows = data.rows.filter((r) => !pick || r[1] === pick)
  const blank = (k, more) => ({ k, tokens: 0, cost: 0, seconds: 0, answers: 0, priced: false, timed: false, ...more })
  const into = (x, r) => {
    x.tokens += r[4] || 0
    x.answers += r[9] || 0
    if (r[7] != null) { x.cost += r[7]; x.priced = true }
    if (r[8] != null) { x.seconds += r[8]; x.timed = true }
  }
  const add = (m, k, r, more) => { if (!m.has(k)) m.set(k, blank(k, more)); into(m.get(k), r) }
  const total = blank('all')
  const sources = new Map(), models = new Map(), features = new Map(), days = new Map()
  for (const r of rows) {
    into(total, r)
    add(sources, r[1], r)
    add(models, `${r[1]}|${r[2]}`, r, { model: r[2], source: r[1] })
    add(features, r[3], r)
    const d = days.get(r[0]) || {}
    d[r[1]] = (d[r[1]] || 0) + (r[4] || 0)
    days.set(r[0], d)
  }
  const order = (m) => [...m.values()].sort((a, b) => b.tokens - a.tokens || b.answers - a.answers)
  // Each provider keeps its color whatever's picked: ranked once over everything.
  const all = new Map()
  for (const r of data.rows) all.set(r[1], (all.get(r[1]) || 0) + (r[4] || 0))
  const rank = [...data.sources.map((s) => s.id)].sort((a, b) => (all.get(b) || 0) - (all.get(a) || 0))
  const colorOf = (id) => SERIES[rank.indexOf(id)] || 'var(--series-other)'
  const dates = []
  for (let d = new Date(`${data.from}T12:00`); d.toLocaleDateString('en-CA') <= data.to; d = new Date(d.getTime() + 864e5)) dates.push(d.toLocaleDateString('en-CA'))
  const listed = [...data.sources].sort((a, b) => rank.indexOf(a.id) - rank.indexOf(b.id))
  return { total, listed, sources: order(sources), models: order(models).filter((m) => m.tokens || m.answers), features: order(features), days: dates.map((date) => ({ date, by: days.get(date) || {} })), colorOf }
}

// Why a provider's numbers are missing or partial, in its words.
function notesFor(s) {
  const name = s.label
  const out = []
  if (s.error) out.push(t("Couldn't read {name}'s numbers: {error}", { name, error: s.error }))
  if (s.counts === 'none' && s.via === 'agent' && !s.uncounted) out.push(t("{name}'s logs don't record tokens, so there's nothing to count.", { name }))
  if (s.counts === 'none-found') out.push(t("{name}'s logs from these days have no token counts in them (older versions don't write them).", { name }))
  if (s.counts === 'partial') out.push(t('{name} writes only the tokens out until a session ends, so some sessions count those alone.', { name }))
  if (s.uncounted) out.push(s.via === 'agent' ? (s.uncounted === 1 ? t("1 answer through your {name} sign-in didn't say how many tokens it took: its one-shot mode doesn't report them.", { name }) : t("{n} answers through your {name} sign-in didn't say how many tokens they took: its one-shot mode doesn't report them.", { n: s.uncounted, name })) : s.uncounted === 1 ? t("1 answer didn't say how many tokens it took.") : t("{n} answers didn't say how many tokens they took.", { n: s.uncounted }))
  if (s.unpriced) out.push(t('No price is pinned for some of its models, so their cost is left out.'))
  return out
}

function DayBars({ days, colorOf }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const sum = (d) => Object.values(d.by).reduce((a, b) => a + b, 0)
  const max = Math.max(...days.map(sum), 0) || 1
  const W = Math.max(240, width || 400), H = 110, B = 16, R = 40
  const bw = (W - R) / days.length
  const h = hover != null ? days[hover] : null
  const ticks = [0, Math.floor(days.length / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i)
  return (
    <div className="us-trend" ref={ref}>
      <svg width={W} height={H} role="img" aria-label={t('Tokens per day, by provider')} onPointerLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={0} x2={W - R} y1={4 + (1 - f) * (H - B - 4)} y2={4 + (1 - f) * (H - B - 4)} className="grid" /><text x={W - R + 4} y={4 + (1 - f) * (H - B - 4) + 3} className="axis-label">{fmtTokens(max * f)}</text></g>)}
        {days.map((d, i) => {
          let top = H - B
          return (
            <g key={d.date} onPointerEnter={() => setHover(i)}>
              <rect x={i * bw} y={0} width={bw} height={H - B} className="hit" />
              {Object.entries(d.by).filter(([, v]) => v > 0).map(([id, v]) => {
                const hgt = (v / max) * (H - B - 4)
                top -= hgt
                return <rect key={id} x={i * bw + Math.min(1, bw * 0.15)} y={top} width={Math.max(1, bw - Math.min(2, bw * 0.3))} height={Math.max(0.5, hgt)} fill={colorOf(id)} className={hover === i ? 'hl' : ''} />
              })}
            </g>
          )
        })}
        {ticks.map((i) => <text key={i} x={i * bw + (i === 0 ? 0 : bw / 2)} y={H - 3} className="axis-label" textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}>{fmtDay(days[i].date)}</text>)}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${((hover * bw + bw / 2) / W) * 100}%`, transform: `translateX(${hover < days.length * 0.2 ? '-10%' : hover > days.length * 0.7 ? '-92%' : '-50%'})` }}>
          <div className="muted small">{fmtDay(h.date)}</div>
          <div><b>{fmtTokens(sum(h))}</b> {t('tokens')}</div>
        </div>
      )}
    </div>
  )
}

const label = (data, id) => data.sources.find((s) => s.id === id)?.label || id

// Today › Usage: every provider, its models, the days and what used them.
export default function UsageEverywhere() {
  const [days, setDays] = usePersisted('cc-ue-days', 30)
  const [pick, setPick] = useState(null)
  const { data, error } = usePoll(`/usage-everywhere?days=${days}`, 5 * 60 * 1000)
  const view = useMemo(() => summarize(data, pick), [data, pick])
  const top = (list) => Math.max(1, ...list.map((x) => x.tokens))
  return (
    <section className="us-card ue" aria-label={t('Every Provider')}>
      <div className="us-card-head">
        <h4>{t('Every Provider')}</h4>
        <div className="seg small-seg" role="tablist" aria-label={t('Range')}>
          {RANGES.map(([v, l]) => <button key={v} role="tab" aria-selected={days === v} className={days === v ? 'on' : ''} onClick={() => setDays(v)}>{l}</button>)}
        </div>
      </div>
      {error && <p className="error-text small" role="alert">{error}</p>}
      {!view && !error && <div className="skeleton-rows"><div /><div /></div>}
      {view && (
        <>
          <div className="us-tiles">
            <div className="us-tile"><span className="us-tile-label">{t('Tokens')}</span><span className="us-tile-val num">{fmtTokens(view.total.tokens)}</span><span className="us-tile-sub">{pick ? label(data, pick) : t('every provider')}</span></div>
            <div className="us-tile"><span className="us-tile-label">{t('Cost on API keys')}</span><span className="us-tile-val num">{view.total.priced ? fmtCost(view.total.cost) : '—'}</span><span className="us-tile-sub">{t('at list prices')}</span></div>
            <div className="us-tile"><span className="us-tile-label">{t('Time on this computer')}</span><span className="us-tile-val num">{view.total.timed ? fmtTime(view.total.seconds) : '—'}</span><span className="us-tile-sub">{t('local models')}</span></div>
            <div className="us-tile"><span className="us-tile-label">{t('Answers for Bridge AI')}</span><span className="us-tile-val num">{view.total.answers.toLocaleString(locale())}</span><span className="us-tile-sub">{t('its own jobs')}</span></div>
          </div>
          {!data.rows.length && <p className="muted small">{t('Nothing used in these days yet. Tokens show here as your agents and the models Bridge AI calls are used.')}</p>}
          {view.days.some((d) => Object.keys(d.by).length) && <DayBars days={view.days} colorOf={view.colorOf} />}
          <div className="us-grid ue-grid">
            <div className="ue-part">
              <h5>{t('By provider')}</h5>
              <ul className="us-list">
                {view.listed.map((s) => {
                  const x = view.sources.find((v) => v.k === s.id) || { tokens: 0, cost: 0, seconds: 0, answers: 0 }
                  const notes = notesFor(s)
                  return (
                    <li key={s.id} className="ue-src" data-source={s.id}>
                      <button className={`us-row ${pick === s.id ? 'on' : ''}`} onClick={() => setPick(pick === s.id ? null : s.id)} aria-pressed={pick === s.id}>
                        <span className="us-row-name" title={`${s.label} · ${t(VIA[s.via] || s.via)}`}><i className="us-sw" style={{ background: view.colorOf(s.id) }} /><span className="us-ell">{s.label}</span><Icon name={VIA_ICON[s.via] || 'bot'} size={11} className="ue-via" /></span>
                        <span className="us-row-bar"><span style={{ width: `${(x.tokens / top(view.sources)) * 100}%`, background: view.colorOf(s.id) }} /></span>
                        <span className="us-row-num num">{s.counts === 'none' && !x.tokens ? '—' : fmtTokens(x.tokens)}</span>
                        <span className="us-row-num num muted">{x.priced ? fmtCost(x.cost) : x.timed ? fmtTime(x.seconds) : ''}</span>
                      </button>
                      {notes.map((n) => <p key={n} className="ue-why small"><Icon name="alert" size={11} /> {n}</p>)}
                    </li>
                  )
                })}
                {!data.sources.length && <li className="muted small">{t('No provider used in these days.')}</li>}
              </ul>
            </div>
            <div className="ue-part">
              <h5>{t('By model')}</h5>
              <ul className="us-list">
                {view.models.slice(0, 12).map((m) => (
                  <li key={m.k}>
                    <div className="us-row static">
                      <span className="us-row-name"><i className="us-sw" style={{ background: view.colorOf(m.source) }} /><span className="us-ell">{m.model || t('Not said')}</span>{!pick && <small className="muted us-ell">{label(data, m.source)}</small>}</span>
                      <span className="us-row-bar"><span style={{ width: `${(m.tokens / top(view.models)) * 100}%`, background: view.colorOf(m.source) }} /></span>
                      <span className="us-row-num num">{fmtTokens(m.tokens)}</span>
                      <span className="us-row-num num muted">{m.priced ? fmtCost(m.cost) : m.timed ? fmtTime(m.seconds) : ''}</span>
                    </div>
                  </li>
                ))}
                {view.models.length > 12 && <li className="muted small us-more">{t('and {n} smaller', { n: view.models.length - 12 })}</li>}
              </ul>
            </div>
            <div className="ue-part">
              <h5>{t('By feature')}</h5>
              <ul className="us-list">
                {view.features.map((f) => (
                  <li key={f.k} data-feature={f.k}>
                    <div className="us-row static">
                      <span className="us-row-name"><span className="us-ell">{t(FEATURES[f.k] || FEATURES.other)}</span></span>
                      <span className="us-row-bar"><span style={{ width: `${(f.tokens / top(view.features)) * 100}%` }} /></span>
                      <span className="us-row-num num">{fmtTokens(f.tokens)}</span>
                      <span className="us-row-num num muted">{f.answers ? (f.answers === 1 ? t('1 answer') : t('{n} answers', { n: f.answers })) : ''}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {data.log?.error && <p className="error-text small" role="alert">{t("Bridge AI couldn't write down what its models used: {error}", { error: data.log.error })}</p>}
          {data.log?.full && <p className="error-text small" role="alert">{t("This month's record of what its models used is full, so answers since {date} aren't in it.", { date: fmtDay(data.log.full.since.slice(0, 10)) })}</p>}
          <p className="muted small us-src">{t('Kept on this computer and never part of the usage counts sent. Cost is for API keys, at list prices as of {date}; Claude Code and Codex at API prices are in their stats below.', { date: data.pricesAsOf })}</p>
        </>
      )}
    </section>
  )
}

// The usage panel's line: the last week across every provider, and the way to all of it.
export function UsageEverywhereBrief() {
  const { data } = usePoll('/usage-everywhere?days=7', 5 * 60 * 1000)
  const view = useMemo(() => summarize(data, null), [data])
  if (!view) return null
  const shown = view.sources.filter((s) => s.tokens > 0).slice(0, 3)
  return (
    <div className="ue-brief">
      <p className="small">
        <b>{t('Last 7 days: {tokens} tokens', { tokens: fmtTokens(view.total.tokens) })}</b>
        {view.total.priced && <span className="muted"> · {t('{cost} on API keys', { cost: fmtCost(view.total.cost) })}</span>}
      </p>
      {shown.length > 0 && (
        <ul className="ue-brief-list">
          {shown.map((s) => <li key={s.k}><i className="us-sw" style={{ background: view.colorOf(s.k) }} /><span className="us-ell">{label(data, s.k)}</span><span className="num">{fmtTokens(s.tokens)}</span></li>)}
        </ul>
      )}
      <button type="button" className="ghost-btn" onClick={() => openToday('usage')}>{t('Every provider, by model, day and feature')} <Icon name="chevron" size={10} /></button>
    </div>
  )
}
