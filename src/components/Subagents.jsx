import { useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePoll } from '../api.js'
import { usePersisted } from './layout.jsx'

// Subagents the agent started, live, in a tray that sits on the message box at the same width:
// one row each with what it's doing now; open a row for its steps, its brief and what it reported.
const LABEL = { running: 'Running', done: 'Done', failed: 'Failed', killed: 'Stopped', stopped: 'Stopped' }
const since = (iso) => {
  if (!iso) return ''
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
const ago = (iso) => { const t = since(iso); return !t || /^\d+s$/.test(t) ? 'just now' : `${t} ago` }
const doing = (it) => {
  const last = it.steps.at(-1)
  if (!last) return { tool: null, text: 'Starting…' }
  return last.kind === 'tool' ? { tool: last.tool, text: last.hint } : { tool: null, text: last.text.split('\n')[0] }
}

function Step({ s }) {
  return s.kind === 'tool'
    ? <li className="sa-step"><span className="sa-tool">{s.tool}</span><span className="sa-hint">{s.hint}</span><time>{ago(s.ts)}</time></li>
    : <li className="sa-step say"><span className="sa-say">{s.text}</span><time>{ago(s.ts)}</time></li>
}

function Detail({ it, Rich }) {
  return (
    <div className="sa-detail">
      {it.result && (
        <section>
          <h5>{it.status === 'done' ? 'What it reported' : 'Last message'}</h5>
          <div className="sa-result"><Rich text={it.result} /></div>
        </section>
      )}
      <section>
        <h5>{it.status === 'running' ? 'Latest steps' : 'Last steps'} <span>· {it.tools} tool calls in all</span></h5>
        <ol className="sa-steps">{it.steps.map((s, i) => <Step key={i} s={s} />)}</ol>
      </section>
      {it.brief && (
        <details className="sa-brief">
          <summary>The brief it was given</summary>
          <p>{it.brief}</p>
        </details>
      )}
    </div>
  )
}

export default function Subagents({ paneId, working, Rich = ({ text }) => <p>{text}</p> }) {
  const [openId, setOpenId] = useState(null)
  const [showDone, setShowDone] = useState(false)
  const [collapsed, setCollapsed] = usePersisted('cc-sa-collapsed', false)
  const { data } = usePoll(`/agents/${encodeURIComponent(paneId)}/subagents`, working ? 3000 : 15000)
  const items = data?.items || []
  // The tray grows upward into the chat; cap it so some of the conversation stays visible.
  const trayRef = useRef(null)
  const [maxH, setMaxH] = useState(320)
  useLayoutEffect(() => {
    const fit = () => {
      const c = trayRef.current?.closest('.console')
      if (c) setMaxH(Math.max(140, Math.round((c.clientHeight - 230) * 0.6)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [openId, collapsed, items.length])

  if (!items.length) return null
  const running = items.filter((i) => i.status === 'running')
  const recentDone = items.filter((i) => i.status !== 'running' && Date.now() - new Date(i.updatedAt) < 15 * 60 * 1000)
  const rows = showDone || !running.length ? items : [...running, ...recentDone]
  const hidden = items.length - rows.length

  // Nothing running and nothing asked for: one quiet line.
  if (!running.length && !showDone) {
    return (
      <div className="sa-tray quiet" ref={trayRef}>
        <button className="sa-head" onClick={() => setShowDone(true)}>
          <Icon name="layers" size={13} />
          <span className="sa-title">{items.length} recent subagent{items.length === 1 ? '' : 's'}</span>
          <span className="sa-sub">none running</span>
          <Icon name="chevron" size={11} className="sa-caret rot-up" />
        </button>
      </div>
    )
  }

  const summary = running.length
    ? `${running.length} running${recentDone.length ? ` · ${recentDone.length} just finished` : ''}`
    : `${items.length} recent`
  return (
    <div className={`sa-tray ${collapsed ? 'collapsed' : ''}`} ref={trayRef}>
      <div className="sa-head">
        <button className="sa-head-main" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <span className="sa-dots">{running.slice(0, 5).map((r) => <span key={r.id} className="sa-dot s-running" />)}</span>
          <span className="sa-title">Subagents</span>
          <span className="sa-sub">{summary}</span>
          {collapsed && running[0] && <span className="sa-peek">{running.map((r) => r.description).join(' · ')}</span>}
        </button>
        {!collapsed && hidden > 0 && <button className="sa-link" onClick={() => setShowDone(true)}>Show {hidden} finished</button>}
        {!collapsed && showDone && running.length > 0 && <button className="sa-link" onClick={() => setShowDone(false)}>Hide finished</button>}
        <button className="sa-icon" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Show subagents' : 'Hide subagents'} title={collapsed ? 'Show' : 'Hide'}>
          <Icon name="chevron" size={12} className={collapsed ? 'rot-up' : 'rot90'} />
        </button>
      </div>
      {!collapsed && (
        <ul className="sa-list" style={{ maxHeight: maxH }}>
          {rows.map((it) => {
            const d = doing(it)
            const open = openId === it.id
            return (
              <li key={it.id} className={`sa-item ${open ? 'open' : ''}`}>
                <button className="sa-row" onClick={() => setOpenId(open ? null : it.id)} aria-expanded={open}>
                  <span className={`sa-dot s-${it.status}`} title={LABEL[it.status] || it.status} />
                  <span className="sa-name">{it.description}</span>
                  <span className="sa-now">
                    {it.status === 'running'
                      ? <>{d.tool && <b>{d.tool}</b>}<span className={d.tool ? 'code' : 'prose'}>{d.text}</span></>
                      : <span className={`sa-state s-${it.status}`}>{LABEL[it.status] || it.status} · {it.tools} steps</span>}
                  </span>
                  <span className="sa-time">{it.status === 'running' ? since(it.startedAt) : ago(it.updatedAt)}</span>
                  <Icon name="chevron" size={11} className={`sa-caret ${open ? 'rot90' : ''}`} />
                </button>
                {open && <Detail it={it} Rich={Rich} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
