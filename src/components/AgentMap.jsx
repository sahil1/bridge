import { useCallback, useEffect, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { hostApi } from '../api.js'
import { ago, onFor, goMachine } from './Machines.jsx'
import { t, tx } from '../i18n/index.js'
import './agentmap.css'

// The agent map: what's running on which of your computers (server/agentmap.js), and in the
// cloud. One lane per computer, this one first, then the others online, then those offline with
// what they last said; a lane for the cloud agents started from any of them. In each lane the
// agents are grouped by project, each with its state and for how long, what it's doing, how long
// it has run, its model and account, the Chief of Staff thread that handed it its work, and the
// subagents it has going. One click opens any of them, wherever it runs.
//
// Why lanes and not a graph: with 30 or more agents on four computers, boxes and arrows cross and
// leave no room for what each one is doing, which is what you came to read. Lanes keep each
// computer's agents together and in a steady place as they come and go; a project's agents sit
// together inside it; and the links that matter (a thread's hand-offs, an agent's subagents)
// almost always stay on one computer, so they're shown in the rows themselves.

const RANK = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 }
const STATE = { blocked: tx('Waiting on you'), working: tx('Working'), done: tx('Done'), idle: tx('Idle'), unknown: tx('Unknown') }
const FILTERS = [['all', tx('All')], ['blocked', tx('Waiting')], ['working', tx('Working')], ['done', tx('Done')], ['idle', tx('Idle')]]
const bucket = (s) => (s === 'blocked' || s === 'working' || s === 'done' ? s : 'idle')
const OS = { mac: 'Mac', windows: 'Windows', linux: 'Linux' }
const secs = (iso) => (iso ? Math.max(0, (Date.now() - Date.parse(iso)) / 1000) : null)

// "claude-opus-5-5" -> "Opus 5.5"; other models as they're named.
export function modelLabel(id) {
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(String(id || ''))
  if (!m) return id || null
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ' (1M)' : ''}`
}

// Its state, and for how long.
function stateFor(a, off) {
  if (off) return t(STATE[a.status] || STATE.unknown)
  const s = secs(a.statusSince)
  if (s == null) return t(STATE[a.status] || STATE.unknown)
  if (a.status === 'done') return t('Done {when}', { when: ago(a.statusSince) })
  const time = onFor(s)
  return a.status === 'blocked' ? t('Waiting on you for {time}', { time }) : a.status === 'working' ? t('Working for {time}', { time }) : t('Idle for {time}', { time })
}

// The list, from the device this page comes from: every few seconds while it's on screen.
export function useAgentMap(on = true) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(() => hostApi('/agent-map?live=1').then((d) => { setData(d); setError(null) }, (e) => setError(e.message)), [])
  useEffect(() => {
    if (!on) return
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, 4000)
    return () => clearInterval(id)
  }, [load, on])
  return { data, error, refresh: load }
}

function Row({ a, d, off, hl, onOpen, onShow, from }) {
  const doing = a.asking || a.doing?.tool || a.doing?.text || null
  const run = secs(a.since)
  const id = `am-${d.id || 'here'}-${a.paneId}`
  return (
    <div className={`am-row s-${a.status} ${hl === id ? 'hl' : ''}`} id={id}>
      <button type="button" className="am-main" disabled={off} onClick={() => onOpen(d, a)} title={off ? t('{name} is offline', { name: d.name }) : t('Open {name}', { name: a.name || a.title })}>
        <span className="am-l1">
          <StatusDot status={off ? 'unknown' : a.status} size={8} />
          <b className="am-name">{a.chief && <Icon name="helm" size={11} />}<span className="am-cut">{a.name || a.title}</span></b>
          {run != null && <span className="am-run" title={t('Started {when}', { when: new Date(a.since).toLocaleString() })}><Icon name="clock" size={10} />{onFor(run)}</span>}
        </span>
        {doing && <span className={`am-doing ${a.doing?.tool && !a.asking ? 'tool' : ''}`}>{a.asking ? <Icon name="alert" size={10} /> : a.doing?.tool ? <Icon name="tool" size={10} /> : null}<span className="am-cut">{doing}</span></span>}
        <span className="am-meta">
          <span className={`am-state s-${off ? 'unknown' : a.status}`}>{stateFor(a, off)}</span>
          <span>{a.cloud ? t('{label} cloud', { label: a.cloud.label }) : a.kindLabel || a.kind}</span>
          {a.model && <span className="am-model">{modelLabel(a.model)}</span>}
          {a.account && <span className="acct-tag">{a.account}</span>}
          {a.branch && <span className="am-branch" title={a.branch}><Icon name="branch" size={10} /><span className="am-cut">{a.branch}</span></span>}
          {from && <span className="am-from">{t('Started from {name}', { name: from })}</span>}
        </span>
      </button>
      {a.from?.length > 0 && (
        <button type="button" className="am-link" onClick={() => onShow(d, a.from[0])} title={t('Handed this work by the Chief of Staff')}>
          <Icon name="helm" size={10} /> {a.from.map((n) => (n === 'Main' ? t('Chief of Staff') : t('Chief of Staff · {name}', { name: n }))).join(', ')}
        </button>
      )}
      {a.subagents?.count > 0 && (
        <ul className="am-subs" aria-label={a.subagents.count === 1 ? t('{n} subagent', { n: 1 }) : t('{n} subagents', { n: a.subagents.count })}>
          {a.subagents.items.map((s, i) => <li key={i}><StatusDot status="working" size={6} />{s.type && <b>{s.type}</b>}<span>{s.title}</span></li>)}
          {a.subagents.count > a.subagents.items.length && <li className="muted">{t('and {n} more', { n: a.subagents.count - a.subagents.items.length })}</li>}
        </ul>
      )}
    </div>
  )
}

// One computer's agents (or the cloud's), by project.
function Lane({ d, list, cloud = false, filter, hl, onOpen, onShow }) {
  const off = !cloud && !d.online
  const shown = list.filter((a) => filter === 'all' || bucket(a.status) === filter)
  // The Chief of Staff first, then projects with what needs you or works first, then chats and
  // agents in no project.
  const by = new Map()
  for (const a of shown) {
    const k = a.chief ? 'chief' : a.chat ? 'chat' : a.project ? `p:${a.project}` : 'other'
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(a)
  }
  const place = (g) => (g.k === 'chief' ? -1 : g.k === 'chat' ? 90 : g.k === 'other' ? 91 : RANK[g.xs[0].status] ?? 9)
  const groups = [...by.entries()].map(([k, xs]) => ({
    k, label: k === 'chief' ? t('Chief of Staff') : k === 'chat' ? t('Chats') : k === 'other' ? t('Other') : k.slice(2),
    xs: xs.sort((x, y) => (RANK[x.status] ?? 9) - (RANK[y.status] ?? 9) || (Date.parse(x.since || 0) || 0) - (Date.parse(y.since || 0) || 0)),
  })).sort((x, y) => place(x) - place(y) || x.label.localeCompare(y.label))
  const counts = list.reduce((c, a) => ({ ...c, [bucket(a.status)]: (c[bucket(a.status)] || 0) + 1 }), {})
  const said = [counts.blocked && t('{n} waiting', { n: counts.blocked }), counts.working && t('{n} working', { n: counts.working })].filter(Boolean).join(' · ')
  // Who each Chief of Staff thread handed work to, by thread name.
  const handed = (name) => list.filter((x) => x.from?.includes(name))
  return (
    <section className={`am-lane ${off ? 'off' : ''} ${cloud ? 'cloud' : ''}`} aria-label={cloud ? t('Cloud Agents') : d.name}>
      <header className="am-lane-head">
        {cloud ? <Icon name="cloud" size={15} /> : <span className={`mc-dot ${d.online ? 'on' : ''}`} />}
        <div className="am-lane-name">
          <b>{cloud ? t('Cloud Agents') : d.name}</b>
          <small className="muted">
            {cloud ? t("Running on each provider's computers")
              : [OS[d.os], d.here ? t('this computer') : d.online ? t('Online') : (d.at || d.lastSeen) ? t('Offline · as of {when}', { when: ago(d.at || d.lastSeen) }) : t('Offline')].filter(Boolean).join(' · ')}
          </small>
        </div>
        <span className="am-lane-count" title={said}>{list.length}</span>
        {!cloud && !d.here && d.online && <button type="button" className="win-btn" onClick={() => goMachine(d.id)} aria-label={t('Show {name}', { name: d.name })} title={t('Show {name}', { name: d.name })}><Icon name="external" size={13} /></button>}
      </header>
      {said && !off && <p className="am-said">{said}</p>}
      {off && list.length > 0 && <p className="am-said">{t('What it last said. It may have moved on since.')}</p>}
      {!shown.length && <p className="muted am-none">{list.length ? t('Nothing here right now.') : cloud ? t('No cloud agents running.') : t('No agents')}</p>}
      {groups.map((g) => (
        <div key={g.k} className="am-group">
          <h4><Icon name={g.k === 'chief' ? 'helm' : g.k === 'chat' ? 'chat' : 'folder'} size={11} /><span>{g.label}</span><span className="fcount">{g.xs.length}</span></h4>
          {g.xs.map((a) => (
            <div key={a.paneId}>
              <Row a={a} d={a.dev || d} off={cloud ? !a.dev?.online : off} hl={hl} onOpen={onOpen} onShow={onShow} from={cloud ? a.dev?.name : null} />
              {a.chief && a.thread && handed(a.thread.name).length > 0 && (
                <div className="am-handed">
                  <span className="muted">{t('Handed work to')}</span>
                  {handed(a.thread.name).map((x) => <button key={x.paneId} type="button" className="am-chip" onClick={() => onShow(a.dev || d, null, x.paneId)} title={x.name || x.title}><StatusDot status={x.status} size={6} /><span className="am-cut">{x.name || x.title}</span></button>)}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

// onOpen(device, agent): open it wherever it runs (App.jsx). controls: full size, on a computer.
export default function AgentMap({ onOpen, phone = false, controls = null }) {
  const { data, error } = useAgentMap(true)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(null)
  useEffect(() => { if (!hl) return; const id = setTimeout(() => setHl(null), 2500); return () => clearTimeout(id) }, [hl])
  const devices = (data?.devices || []).map((d) => ({ ...d, agents: Array.isArray(d.agents) ? d.agents : [] }))
  const match = (a) => !q.trim() || [a.name, a.title, a.project, a.branch, a.doing?.text, a.doing?.tool, a.kindLabel, a.model].some((x) => String(x || '').toLowerCase().includes(q.trim().toLowerCase()))
  // Cloud agents from every computer go in a lane of their own, saying which one started them.
  const lanes = devices.map((d) => ({ d, list: d.agents.filter((a) => !a.cloud && match(a)) }))
    .sort((x, y) => (!!y.d.here - !!x.d.here) || (!!y.d.online - !!x.d.online))
  const cloud = devices.flatMap((d) => d.agents.filter((a) => a.cloud && match(a)).map((a) => ({ ...a, dev: d })))
  const everyone = [...lanes.flatMap((l) => l.list), ...cloud]
  const counts = everyone.reduce((c, a) => ({ ...c, [bucket(a.status)]: (c[bucket(a.status)] || 0) + 1 }), {})
  const online = devices.filter((d) => d.online).length
  // A Chief of Staff thread's hand-off, or the agent it went to: scrolled to and lit up.
  const show = (d, thread, pane) => {
    const target = pane || d.agents.find((x) => x.chief && x.thread?.name === thread)?.paneId
    if (!target) return
    const id = `am-${d.id || 'here'}-${target}`
    setHl(id)
    document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return (
    <div className={`am ${phone ? 'phone' : ''}`}>
      <header className="am-head">
        <div className="am-title">
          <h2><Icon name="grid" size={16} /> {t('Agent Map')}</h2>
          {data && <p className="muted">{[everyone.length === 1 ? t('{n} agent', { n: 1 }) : t('{n} agents', { n: everyone.length }), devices.length === 1 ? t('on this computer') : t('on {n} of your {m} computers', { n: online, m: devices.length })].join(' ')}</p>}
        </div>
        <input className="am-search st-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find an agent, project or branch')} aria-label={t('Find an agent, project or branch')} />
        {controls && (
          <button type="button" className="win-btn" onClick={controls.onMaximize} aria-label={controls.maximized ? t('Exit full size') : t('Full size')} title={controls.maximized ? t('Exit full size (Esc)') : t('Full size')}>
            <Icon name={controls.maximized ? 'shrink' : 'maximize'} size={14} />
          </button>
        )}
        <div className="chips am-filters" role="tablist" aria-label={t('Filter agents')}>
          {FILTERS.map(([id, label]) => {
            const n = id === 'all' ? everyone.length : counts[id] || 0
            if (id !== 'all' && !n && filter !== id) return null
            return (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`fchip ${filter === id ? 'on' : ''}`} onClick={() => setFilter(filter === id ? 'all' : id)}>
                {id !== 'all' && <StatusDot status={id} size={7} />}{t(label)}<span className="fcount">{n}</span>
              </button>
            )
          })}
        </div>
      </header>
      {error && !data && <p className="error-text small am-err">{error}</p>}
      {!data && !error && <div className="skeleton-rows pad"><div /><div /><div /></div>}
      {data && (
        <div className="am-lanes">
          {lanes.map(({ d, list }) => <Lane key={d.id || 'here'} d={d} list={list} filter={filter} hl={hl} onOpen={onOpen} onShow={show} />)}
          {cloud.length > 0 && <Lane d={{ id: 'cloud', name: t('Cloud Agents'), online: true }} list={cloud} cloud filter={filter} hl={hl} onOpen={onOpen} onShow={show} />}
        </div>
      )}
    </div>
  )
}
