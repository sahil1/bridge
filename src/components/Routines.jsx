import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Card, Updated } from './Trackers.jsx'
import { api, usePoll, fmtRelative } from '../api.js'

const EVERY = [['day', 'Daily'], ['weekday', 'Weekdays'], ['2d', 'Every 2 days'], ['3d', 'Every 3 days'], ['week', 'Weekly'], ['2w', 'Every 2 weeks'], ['month', 'Monthly']]
const everyLabel = (e) => EVERY.find(([k]) => k === e)?.[1] || (/^\d+d$/.test(e) ? `Every ${parseInt(e, 10)} days` : e)
const STATE = { ok: ['check', 'Up to date'], due: ['alert', 'Due'], overdue: ['alert', 'Overdue'], never: ['dot', 'No run found'], error: ['alert', 'Check failed'] }
const exact = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const Loading = () => <div className="skeleton-rows"><div /><div /></div>

function useFlash() {
  const [msg, setMsg] = useState(null)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])
  return [msg, setMsg]
}

// ---------- Routines ----------

function RoutineForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial || { name: '', command: '', cwd: '~/', every: 'week', workspace: '', detail: '' })
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault()
    try { await onSave(f) } catch (x) { setErr(x.message) }
  }
  return (
    <form className="r-form" onSubmit={save}>
      <label><span>Name</span><input value={f.name} onChange={set('name')} placeholder="Weekly dependency check" required autoFocus /></label>
      <label><span>Command</span><input className="mono" value={f.command} onChange={set('command')} placeholder="/review or a task description" required /></label>
      <label><span>Folder</span><input className="mono" value={f.cwd} onChange={set('cwd')} placeholder="~/code/my-project" /></label>
      <div className="r-form-row">
        <label><span>Repeats</span>
          <select value={f.every} onChange={set('every')}>{EVERY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label><span>Space</span><input value={f.workspace} onChange={set('workspace')} placeholder="Maintenance" /></label>
      </div>
      <p className="muted small">Run opens a Claude tab in that space and types the command. The last run is found in your Claude Code history automatically.</p>
      {err && <p className="error-text">{err}</p>}
      <div className="r-form-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary">{initial ? 'Save' : 'Add routine'}</button>
      </div>
    </form>
  )
}

function RoutineRow({ r, editing, onChanged, onOpenAgent, setFlash }) {
  const [busy, setBusy] = useState(null)
  const [edit, setEdit] = useState(false)
  const [icon, label] = STATE[r.state] || STATE.never
  const act = async (kind) => {
    setBusy(kind)
    try {
      if (kind === 'run') {
        const out = await api(`/routines/${r.id}/run`, { method: 'POST' })
        setFlash(out.waiting ? `${r.name} started; Claude is waiting on a prompt` : `${r.name} started in ${r.workspace || 'a new space'}`)
        if (out.paneId) setTimeout(() => onOpenAgent?.(out.paneId), 1500)
      } else if (kind === 'done') {
        await api(`/routines/${r.id}/done`, { method: 'POST' })
        setFlash(`Logged ${r.name} as done`)
      } else if (kind === 'delete') {
        if (!window.confirm(`Remove the routine "${r.name}"? Its history stays in your Claude Code transcripts.`)) return
        await api(`/routines/${r.id}`, { method: 'DELETE' })
      }
      onChanged()
    } catch (e) { setFlash(e.message) } finally { setBusy(null) }
  }
  if (edit) {
    return <RoutineForm initial={r} onCancel={() => setEdit(false)} onSave={async (f) => { await api(`/routines/${r.id}`, { method: 'PATCH', body: f }); setEdit(false); onChanged() }} />
  }
  const launched = r.lastLaunch && (!r.last || r.lastLaunch.at > r.last.at)
  return (
    <li className={`r-row st-${r.state}`}>
      <span className="r-state" title={label}><Icon name={icon} size={13} /></span>
      <div className="r-main">
        <div className="r-title">
          <b>{r.name}</b>
          <code className="r-cmd">{r.command}</code>
        </div>
        <div className="r-meta">
          {r.note && <span className={`r-note ${r.state}`}>{r.note}</span>}
          {r.last ? <span title={`${exact(r.last.at)} · ${r.last.source}`}>Last {fmtRelative(r.last.at)}</span> : <span>No run found</span>}
          {launched && <span title={exact(r.lastLaunch.at)}>Started {fmtRelative(r.lastLaunch.at)}</span>}
          <span>{everyLabel(r.every)}</span>
          {r.link && <a href={r.link} target="_blank" rel="noreferrer">Open output <Icon name="external" size={10} /></a>}
        </div>
      </div>
      <div className="r-actions">
        {editing ? (
          <>
            <button className="icon-btn" onClick={() => setEdit(true)} aria-label={`Edit ${r.name}`} title="Edit"><Icon name="edit" size={13} /></button>
            <button className="icon-btn danger" onClick={() => act('delete')} aria-label={`Remove ${r.name}`} title="Remove"><Icon name="trash" size={13} /></button>
          </>
        ) : (
          <>
            <button className="icon-btn" onClick={() => act('done')} disabled={!!busy} aria-label={`Mark ${r.name} done`} title="I did this (log it now)"><Icon name="check" size={13} /></button>
            <button className={`run-btn ${r.state === 'ok' ? '' : 'hot'}`} onClick={() => act('run')} disabled={!!busy} title={`Open a Claude tab in ${r.cwd} and run ${r.command}`}>
              <Icon name={busy === 'run' ? 'refresh' : 'play'} size={11} className={busy === 'run' ? 'spin' : ''} /> Run
            </button>
          </>
        )}
      </div>
    </li>
  )
}

export function Routines({ onOpenAgent }) {
  const { data, error, refresh } = usePoll('/routines', 5 * 60 * 1000)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [flash, setFlash] = useFlash()
  const due = (data?.routines || []).filter((r) => ['due', 'overdue', 'never'].includes(r.state))
  const summary = data ? (due.length ? `${due.length} due · ${due.map((r) => r.name).join(', ')}` : 'All up to date') : ''
  return (
    <Card icon="repeat" title="Routines" summary={summary} right={
      <span className="updated">
        <button className={`icon-btn ${editing ? 'on' : ''}`} onClick={() => { setEditing(!editing); setAdding(false) }} aria-label="Edit routines" title={editing ? 'Done editing' : 'Edit routines'}><Icon name={editing ? 'check' : 'edit'} size={13} /></button>
        <Updated data={data} onRefresh={() => refresh('?refresh=1')} />
      </span>
    }>
      {!data && !error && <Loading />}
      {error && <p className="error-text">{error}</p>}
      {data && (
        <ul className="r-list">
          {data.routines.map((r) => <RoutineRow key={r.id} r={r} editing={editing} onChanged={() => refresh('?refresh=1')} onOpenAgent={onOpenAgent} setFlash={setFlash} />)}
        </ul>
      )}
      {flash && <p className="r-flash">{flash}</p>}
      {adding ? (
        <RoutineForm onCancel={() => setAdding(false)} onSave={async (f) => { await api('/routines', { method: 'POST', body: f }); setAdding(false); refresh('?refresh=1') }} />
      ) : (
        <button className="ghost-btn add-line" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> Add a routine</button>
      )}
    </Card>
  )
}

// ---------- Insights (/insights report) ----------

export function Insights() {
  const { data, error } = usePoll('/insights', 30 * 60 * 1000)
  const [open, setOpen] = useState(null)
  const [flash, setFlash] = useFlash()
  const [running, setRunning] = useState(false)
  const ageDays = data?.generatedAt ? (Date.now() - new Date(data.generatedAt)) / 864e5 : null
  const rerun = async () => {
    setRunning(true)
    try { await api('/routines/insights/run', { method: 'POST' }); setFlash('Started /insights in a Claude tab; the card updates when the report is written') } catch (e) { setFlash(e.message) } finally { setRunning(false) }
  }
  return (
    <Card icon="sparkle" title="Claude Code insights" summary={data?.available ? `Report from ${new Date(data.generatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}
      right={data?.available && <span className="updated">{fmtRelative(data.generatedAt)}</span>}>
      {!data && !error && <Loading />}
      {error && <p className="error-text">{error}</p>}
      {data && !data.available && <p className="muted small">No report yet. Run <code>/insights</code> in Claude Code, or use Run below.</p>}
      {data?.available && (
        <>
          <p className="muted small ins-sub">{data.subtitle}</p>
          <div className="ins-stats">
            {data.stats.map((s) => <div key={s.label}><b>{s.value.replace('/', ' / ')}</b><span>{s.label}</span></div>)}
          </div>
          <ul className="ins-glance">
            {data.glance.map((g, i) => (
              <li key={g.title} className={open === i ? 'open' : ''}>
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <Icon name="chevron" size={11} className={`caret ${open === i ? 'rot90' : ''}`} />
                  <b>{g.title}</b>
                </button>
                <p>{g.text}</p>
                {open === i && g.anchor && <a href={`/api/insights/report${g.anchor}`} target="_blank" rel="noreferrer">Read the section <Icon name="external" size={10} /></a>}
              </li>
            ))}
          </ul>
        </>
      )}
      {flash && <p className="r-flash">{flash}</p>}
      <div className="ins-actions">
        {data?.available && <a className="btn" href="/api/insights/report" target="_blank" rel="noreferrer"><Icon name="doc" size={13} /> Full report</a>}
        <button className={`btn ${ageDays == null || ageDays > 7 ? 'primary' : ''}`} onClick={rerun} disabled={running}><Icon name="play" size={12} /> {ageDays > 7 ? `Refresh (${Math.round(ageDays)}d old)` : 'Run /insights'}</button>
      </div>
    </Card>
  )
}

// ---------- Ideas backlog ----------

function IdeaRow({ it, onChanged, setFlash }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const patch = async (body) => { await api(`/ideas/${it.id}`, { method: 'PATCH', body }); onChanged() }
  const send = async () => {
    setBusy(true)
    try { await api(`/ideas/${it.id}/send`, { method: 'POST' }); setFlash('Sent to your chief of staff; it will plan it and check with you'); onChanged() } catch (e) { setFlash(e.message) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!window.confirm(`Delete this idea?\n\n${it.text}`)) return
    await api(`/ideas/${it.id}`, { method: 'DELETE' }); onChanged()
  }
  if (edit) {
    return (
      <li className="idea editing">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={async (e) => { if (e.key === 'Enter' && text.trim()) { await patch({ text }); setEdit(false) } if (e.key === 'Escape') setEdit(false) }}
          onBlur={() => setEdit(false)} />
      </li>
    )
  }
  return (
    <li className={`idea ${it.done ? 'done' : ''}`}>
      <button className={`idea-check ${it.done ? 'on' : ''}`} onClick={() => patch({ done: !it.done })} aria-label={it.done ? 'Mark open' : 'Mark done'}>{it.done && <Icon name="check" size={11} />}</button>
      <div className="idea-main" onDoubleClick={() => { setText(it.raw); setEdit(true) }}>
        <span className="idea-text">{it.text}</span>
        <span className="idea-meta">
          {it.tags.map((t) => <span key={t} className="idea-tag">#{t}</span>)}
          {it.sent && <span className="idea-sent"><Icon name="helm" size={10} /> sent {it.sent.slice(5)}</span>}
        </span>
      </div>
      <div className="idea-actions">
        {!it.done && <button className="icon-btn" onClick={send} disabled={busy} title="Hand to chief of staff" aria-label="Hand to chief of staff"><Icon name="helm" size={13} /></button>}
        <button className="icon-btn" onClick={() => { setText(it.raw); setEdit(true) }} title="Edit" aria-label="Edit"><Icon name="edit" size={13} /></button>
        <button className="icon-btn danger" onClick={del} title="Delete" aria-label="Delete"><Icon name="trash" size={13} /></button>
      </div>
    </li>
  )
}

export function Ideas() {
  const { data, error, refresh } = usePoll('/ideas', 60 * 1000)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('open')
  const [all, setAll] = useState(false)
  const [flash, setFlash] = useFlash()
  const inputRef = useRef(null)
  const items = data?.items || []
  const tags = [...new Set(items.filter((i) => !i.done).flatMap((i) => i.tags))]
  const shown = items.filter((i) => (filter === 'done' ? i.done : filter === 'open' ? !i.done : !i.done && i.tags.includes(filter)))
  const openCount = items.filter((i) => !i.done).length
  const add = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    try { await api('/ideas', { method: 'POST', body: { text } }); setText(''); refresh() } catch (x) { setFlash(x.message) }
  }
  return (
    <Card icon="bulb" title="Ideas" summary={data ? `${openCount} open` : ''} right={<span className="updated">{openCount} open</span>}>
      <form className="idea-add" onSubmit={add}>
        <Icon name="plus" size={14} className="muted" />
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an idea… use #tags to group" />
        {text.trim() && <button className="btn primary small" type="submit">Add</button>}
      </form>
      {error && <p className="error-text">{error}</p>}
      {items.length > 0 && (
        <div className="chips news-chips">
          {[['open', `Open ${openCount}`], ...tags.map((t) => [t, `#${t}`]), ['done', 'Done']].map(([k, l]) => (
            <button key={k} className={`fchip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      )}
      {flash && <p className="r-flash">{flash}</p>}
      <ul className="idea-list">
        {(all ? shown : shown.slice(0, 8)).map((it) => <IdeaRow key={it.id} it={it} onChanged={refresh} setFlash={setFlash} />)}
      </ul>
      {shown.length > 8 && <button className="ghost-btn idea-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${shown.length - 8} more`}</button>}
      {data && !shown.length && <p className="muted small">{filter === 'done' ? 'Nothing finished yet.' : 'No ideas here yet.'}</p>}
      {data?.file && <p className="muted small idea-file">Saved in <code>{data.file.replace(/^\/Users\/[^/]+/, '~')}</code>, editable in any editor.</p>}
    </Card>
  )
}
