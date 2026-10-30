import { useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { api } from '../api.js'
import { t } from '../i18n/index.js'

// The chief of staff's threads, in a bar at the top of its chat: Main and the others, each a
// conversation of its own (server/threads.js) with a dot for what it's doing. New thread starts
// one, named for its topic. Under the bar, the agents this thread handed work to, to open one.
// agents: the whole fleet's. onSwitch(paneId): show that thread here instead.
const order = (a) => (a.thread?.main ? -1 : Number(String(a.thread?.id || '').replace(/^t/, '')) || 1e9)
const open = (paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } }))

export default function ChiefThreads({ agent, agents, onSwitch, onNote }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const chiefs = agents.filter((a) => a.chief).sort((x, y) => order(x) - order(y))
  const id = agent.thread?.id
  const linked = id ? agents.filter((a) => !a.chief && (a.chiefThreads || []).includes(id)) : []
  const mine = (c) => (c.thread?.id ? agents.filter((a) => !a.chief && (a.chiefThreads || []).includes(c.thread.id)) : [])

  const start = async (e) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    try {
      const r = await api('/chief/threads', { method: 'POST', body: { name: n } })
      setAdding(false); setName('')
      onSwitch(r.paneId)
    } catch (x) { onNote?.(x.message) } finally { setBusy(false) }
  }
  const close = async () => {
    if (!window.confirm(t('Close the thread "{name}"?\n\nIts conversation goes to Closed agents. The agents it handed work to keep running.', { name: agent.title }))) return
    try {
      await api(`/tabs/${encodeURIComponent(agent.tabId)}/close`, { method: 'POST' })
      const main = chiefs.find((c) => c.thread?.main && c.paneId !== agent.paneId)
      if (main) onSwitch(main.paneId)
    } catch (x) { onNote?.(x.message) }
  }

  return (
    <div className="threads" role="region" aria-label={t('Threads with your chief of staff')}>
      <div className="th-bar" role="tablist" aria-label={t('Threads')}>
        {chiefs.map((c) => {
          const n = mine(c)
          const waiting = n.filter((a) => a.status === 'blocked').length
          const on = c.paneId === agent.paneId
          const label = c.thread?.main ? t('Main') : c.title
          const state = { blocked: t('needs you'), working: t('working'), done: t('done'), idle: t('idle') }[c.status] || c.status
          return (
            <button key={c.paneId} role="tab" aria-selected={on} className={`th-chip ${on ? 'on' : ''}`} onClick={() => !on && onSwitch(c.paneId)}
              title={!n.length ? t('{name}: {status}', { name: label, status: state }) : n.length === 1 ? t('{name}: {status}, {n} agent', { name: label, status: state, n: n.length }) : t('{name}: {status}, {n} agents', { name: label, status: state, n: n.length })}>
              <StatusDot status={c.status} size={7} />
              <span className="th-name">{label}</span>
              {waiting > 0 ? <span className="th-n needs" aria-label={t('{n} need you', { n: waiting })}>{waiting}</span> : n.length > 0 && <span className="th-n" aria-label={t('{n} agents', { n: n.length })}>{n.length}</span>}
            </button>
          )
        })}
        {adding
          ? (
            <form className="th-add" onSubmit={start}>
              <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t('Name it: Q4 launch, hiring…')} aria-label={t('Thread name')}
                onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setName('') } }} />
              <button className="btn small primary" type="submit" disabled={!name.trim() || busy}>{busy ? t('Starting…') : t('Start')}</button>
              <button className="sa-icon" type="button" onClick={() => { setAdding(false); setName('') }} aria-label={t('Cancel')} title={t('Cancel')}><Icon name="x" size={12} /></button>
            </form>
          )
          : <button className="th-chip th-new" onClick={() => setAdding(true)} title={t('A separate conversation with your chief of staff, for one topic')}><Icon name="plus" size={12} /><span>{t('New thread')}</span></button>}
      </div>
      {(linked.length > 0 || !agent.thread?.main) && (
        <div className="th-agents">
          {linked.length > 0
            ? <><span className="th-label">{t('Agents')}</span>{linked.map((a) => (
              <button key={a.paneId} className="th-agent" onClick={() => open(a.paneId)} title={`${a.workspace}${a.tab && !/^\d+$/.test(a.tab) ? ` › ${a.tab}` : ''} · ${a.kind}`}>
                <StatusDot status={a.status} size={7} /><span>{a.title || a.tab || a.workspace}</span>
              </button>
            ))}</>
            : <span className="th-label">{t('No agents in this thread yet')}</span>}
          {!agent.thread?.main && agent.tabId && <button className="th-close link-btn" onClick={close} title={t('Close this thread')}>{t('Close thread')}</button>}
        </div>
      )}
    </div>
  )
}
