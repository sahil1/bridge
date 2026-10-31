import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Card, Updated } from './Trackers.jsx'
import AgentMark from './settings/agentMark.jsx'
import { api, usePoll, fmtRelative, BASE } from '../api.js'
import { t, tx, locale } from '../i18n/index.js'

const EVERY = [['day', tx('Daily')], ['weekday', tx('Weekdays')], ['2d', tx('Every 2 days')], ['3d', tx('Every 3 days')], ['week', tx('Weekly')], ['2w', tx('Every 2 weeks')], ['month', tx('Monthly')]]
const everyLabel = (e) => {
  const l = EVERY.find(([k]) => k === e)?.[1]
  return l ? t(l) : (/^\d+d$/.test(e) ? t('Every {n} days', { n: parseInt(e, 10) }) : e)
}
const STATE = { ok: ['check', tx('Up to date')], due: ['alert', tx('Due')], overdue: ['alert', tx('Overdue')], never: ['dot', tx('No run found')], error: ['alert', tx('Check failed')] }
const exact = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
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
      <label><span>{t('Name')}</span><input value={f.name} onChange={set('name')} placeholder={t('Weekly dependency check')} required autoFocus /></label>
      <label><span>{t('Command')}</span><input className="mono" value={f.command} onChange={set('command')} placeholder={t('/review or a task description')} required /></label>
      <label><span>{t('Folder')}</span><input className="mono" value={f.cwd} onChange={set('cwd')} placeholder="~/code/my-project" /></label>
      <div className="r-form-row">
        <label><span>{t('Repeats')}</span>
          <select value={f.every} onChange={set('every')}>{EVERY.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
        </label>
        <label><span>{t('Space')}</span><input value={f.workspace} onChange={set('workspace')} placeholder={t('Maintenance')} /></label>
      </div>
      <p className="muted small">{t('Run opens a Claude tab in that space and types the command. The last run is found in your Claude Code history automatically.')}</p>
      {err && <p className="error-text">{err}</p>}
      <div className="r-form-actions">
        <button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button>
        <button type="submit" className="btn primary">{initial ? t('Save') : t('Add routine')}</button>
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
        setFlash(out.waiting ? t('{name} started; Claude is waiting on a prompt', { name: r.name }) : r.workspace ? t('{name} started in {space}', { name: r.name, space: r.workspace }) : t('{name} started in a new space', { name: r.name }))
        if (out.paneId) setTimeout(() => onOpenAgent?.(out.paneId), 1500)
      } else if (kind === 'done') {
        await api(`/routines/${r.id}/done`, { method: 'POST' })
        setFlash(t('Logged {name} as done', { name: r.name }))
      } else if (kind === 'delete') {
        if (!window.confirm(t('Remove the routine "{name}"? Its history stays in your Claude Code transcripts.', { name: r.name }))) return
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
      <span className="r-state" title={t(label)}><Icon name={icon} size={13} /></span>
      <div className="r-main">
        <div className="r-title">
          <b>{r.name}</b>
          <code className="r-cmd">{r.command}</code>
        </div>
        <div className="r-meta">
          {r.note && <span className={`r-note ${r.state}`}>{r.note}</span>}
          {r.last ? <span title={`${exact(r.last.at)} · ${r.last.source}`}>{t('Last {time}', { time: fmtRelative(r.last.at) })}</span> : <span>{t('No run found')}</span>}
          {launched && <span title={exact(r.lastLaunch.at)}>{t('Started {time}', { time: fmtRelative(r.lastLaunch.at) })}</span>}
          <span>{everyLabel(r.every)}</span>
          {r.link && <a href={r.link} target="_blank" rel="noreferrer">{t('Open output')} <Icon name="external" size={10} /></a>}
        </div>
      </div>
      <div className="r-actions">
        {editing ? (
          <>
            <button className="icon-btn" onClick={() => setEdit(true)} aria-label={t('Edit {name}', { name: r.name })} title={t('Edit')}><Icon name="edit" size={13} /></button>
            <button className="icon-btn danger" onClick={() => act('delete')} aria-label={t('Remove {name}', { name: r.name })} title={t('Remove')}><Icon name="trash" size={13} /></button>
          </>
        ) : (
          <>
            <button className="icon-btn" onClick={() => act('done')} disabled={!!busy} aria-label={t('Mark {name} done', { name: r.name })} title={t('I did this (log it now)')}><Icon name="check" size={13} /></button>
            <button className={`run-btn ${r.state === 'ok' ? '' : 'hot'}`} onClick={() => act('run')} disabled={!!busy} title={t('Open a Claude tab in {folder} and run {command}', { folder: r.cwd, command: r.command })}>
              <Icon name={busy === 'run' ? 'refresh' : 'play'} size={11} className={busy === 'run' ? 'spin' : ''} /> {t('Run')}
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
  const summary = data ? (due.length ? t('{n} due · {names}', { n: due.length, names: due.map((r) => r.name).join(', ') }) : t('All up to date')) : ''
  return (
    <Card icon="repeat" title={t('Routines')} summary={summary} right={
      <span className="updated">
        <button className={`icon-btn ${editing ? 'on' : ''}`} onClick={() => { setEditing(!editing); setAdding(false) }} aria-label={t('Edit routines')} title={editing ? t('Done editing') : t('Edit routines')}><Icon name={editing ? 'check' : 'edit'} size={13} /></button>
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
        <button className="ghost-btn add-line" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> {t('Add a routine')}</button>
      )}
    </Card>
  )
}

// ---------- Insights (every agent and account: server/insights.js) ----------

const WRITER = 'bridge-insights-writer'
const SECTIONS = [['working', tx("What's working")], ['friction', tx("What's in your way")], ['tryNext', tx('Try next')]]
const shortDay = (d) => new Date(/^\d{4}-\d\d-\d\d$/.test(d) ? `${d}T00:00` : d).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) // a YYYY-MM-DD is a local day
const hrs = (h) => (h >= 10 ? Math.round(h) : h)

// Rows with a bar for each one's share of the hours.
function Split({ title, rows }) {
  const top = Math.max(...rows.map((r) => r.hours), 0.1)
  return (
    <div className="ins-split">
      <h4>{title}</h4>
      <ul>
        {rows.map((r) => (
          <li key={r.key} className={r.kind ? '' : 'noicon'}>
            {r.kind && <AgentMark kind={r.kind} label={r.name} size={16} />}
            <span className="ins-name" title={r.hint || r.name}>{r.name}</span>
            <span className="ins-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (r.hours / top) * 100)}%` }} /></span>
            <span className="ins-num">{r.sessions === 1 ? t('{hours} h · {n} session', { hours: hrs(r.hours), n: r.sessions }) : t('{hours} h · {n} sessions', { hours: hrs(r.hours), n: r.sessions })}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Insights() {
  const [fast, setFast] = useState(false)
  const { data, error, refresh } = usePoll('/insights', fast ? 4000 : 10 * 60 * 1000)
  const [open, setOpen] = useState(null)
  const [flash, setFlash] = useFlash()
  const [who, setWho] = useState(() => { try { return localStorage.getItem(WRITER) || '' } catch { return '' } })
  useEffect(() => { if (data) setFast(!!data.running) }, [data])
  const s = data?.stats
  const r = data?.report
  const writers = data?.writers || []
  const pick = writers.some((w) => w.id === who) ? who : writers.some((w) => w.id === r?.who) ? r.who : writers[0]?.id || ''
  const ageDays = r ? (Date.now() - new Date(r.generatedAt)) / 864e5 : null
  const choose = (id) => { setWho(id); try { localStorage.setItem(WRITER, id) } catch { /* private window */ } }
  const write = async () => {
    try { await api('/insights/run', { method: 'POST', body: { who: pick } }); setFast(true); refresh() } catch (e) { setFlash(e.message) }
  }
  const empty = s && !s.totals.sessions
  const top = s ? Math.max(...s.daily.map((d) => d.hours), 0.1) : 1
  return (
    <Card icon="sparkle" title={t('Insights')} summary={s && !empty ? t('{n} sessions, {hours} h in {days} days', { n: s.totals.sessions, hours: hrs(s.totals.hours), days: s.days }) : ''}
      right={s && <span className="updated">{t('Last {n} days', { n: s.days })}</span>}>
      {!data && !error && <Loading />}
      {error && <p className="error-text">{error}</p>}
      {empty && <p className="muted small">{t('No sessions with your agents in the last {n} days yet. This fills in as you work with them, whichever agent and account you use.', { n: s.days })}</p>}
      {s && !empty && (
        <>
          <div className="ins-stats">
            <div><b>{s.totals.sessions}</b><span>{t('Sessions')}</span></div>
            <div><b>{hrs(s.totals.hours)}</b><span>{t('Hours working')}</span></div>
            <div><b>{s.totals.projects}</b><span>{t('Projects')}</span></div>
            {s.totals.waitingHours != null && <div title={t('Time agents spent waiting for you to answer')}><b>{hrs(s.totals.waitingHours)} h</b><span>{t('Waited on you')}</span></div>}
          </div>
          <div className="ins-days" role="img" aria-label={t('Hours working each day, {from} to {to}', { from: shortDay(s.from), to: shortDay(s.to) })}>
            {s.daily.map((d) => <i key={d.date} title={`${shortDay(d.date)}: ${d.hours} h`} style={{ height: `${d.hours ? Math.max(8, (d.hours / top) * 100) : 0}%` }} />)}
          </div>
          <Split title={t('By agent')} rows={s.agents.map((a) => ({ key: a.kind, kind: a.kind, name: a.label, hint: a.fromBridge ? t('{agent}: counted while Bridge AI ran it', { agent: a.label }) : a.label, sessions: a.sessions, hours: a.hours }))} />
          {s.accounts.length > 0 && <Split title={t('By account')} rows={s.accounts.map((a) => ({ key: `${a.kind}:${a.account}`, kind: a.kind, name: a.account, hint: `${a.agent}: ${a.account}`, sessions: a.sessions, hours: a.hours }))} />}
          <Split title={t('Projects')} rows={s.projects.slice(0, 5).map((p) => ({ key: p.name, name: p.name, hint: `${p.name}: ${p.agents.join(', ')}`, sessions: p.sessions, hours: p.hours }))} />
        </>
      )}
      {r && (
        <div className="ins-report">
          <p className="ins-by muted small">{t('Written by {name}, {date}', { name: r.by, date: shortDay(r.generatedAt) })}</p>
          {r.summary && <p className="ins-summary">{r.summary}</p>}
          {SECTIONS.filter(([k]) => r[k]?.length).map(([k, label]) => (
            <div key={k}>
              <h4>{t(label)}</h4>
              <ul className="ins-glance">
                {r[k].map((g, i) => {
                  const id = `${k}${i}`
                  return (
                    <li key={id} className={open === id ? 'open' : ''}>
                      <button onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
                        <Icon name="chevron" size={11} className={`caret ${open === id ? 'rot90' : ''}`} />
                        <b>{g.title}</b>
                      </button>
                      <p>{g.detail}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {r.agents?.length > 0 && (
            <div>
              <h4>{t('Your agents')}</h4>
              <ul className="ins-notes">{r.agents.map((a) => <li key={a.agent}><b>{a.agent}</b> {a.note}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {s && !empty && !r && !data.running && <p className="muted small ins-lead">{t("The numbers above cost nothing. For what's working and what to try next, one of your agents reads them and writes it up.")}</p>}
      {data?.error && !data.running && <p className="error-text">{data.error}</p>}
      {flash && <p className="r-flash">{flash}</p>}
      {data && !empty && (
        writers.length
          ? (
            <div className="ins-actions">
              {data.running
                ? <p className="ins-running muted small"><Icon name="refresh" size={11} className="spin" /> {t('{name} is writing it. Usually a minute or two; you can close this.', { name: data.running.label })}</p>
                : <>
                  {writers.length > 1 && (
                    <label className="ins-who"><span>{t('Write with')}</span>
                      <select value={pick} onChange={(e) => choose(e.target.value)}>{writers.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select>
                    </label>
                  )}
                  <button className={`btn ${!r || ageDays > 7 ? 'primary' : ''}`} onClick={write}><Icon name="sparkle" size={12} /> {!r ? (writers.length > 1 ? t('Write insights') : t('Write with {name}', { name: writers[0].label })) : ageDays > 7 ? t('Refresh ({n}d old)', { n: Math.round(ageDays) }) : t('Write again')}</button>
                </>}
            </div>
          )
          : (
            <div className="ins-actions">
              <p className="muted small">{t('To get a write-up, sign in to an agent or add an API key for any provider.')}</p>
              <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}><Icon name="layers" size={12} /> {t('Model Providers')}</button>
            </div>
          )
      )}
      {data?.claudeReport && <a className="ins-claude" href={`${BASE}/api/insights/report`} target="_blank" rel="noreferrer">{t("Claude Code's own /insights report, {date}", { date: shortDay(data.claudeReport.generatedAt) })} <Icon name="external" size={10} /></a>}
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
    try { await api(`/ideas/${it.id}/send`, { method: 'POST' }); setFlash(t('Sent to your chief of staff; it will plan it and check with you')); onChanged() } catch (e) { setFlash(e.message) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!window.confirm(`${t('Delete this idea?')}\n\n${it.text}`)) return
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
      <button className={`idea-check ${it.done ? 'on' : ''}`} onClick={() => patch({ done: !it.done })} aria-label={it.done ? t('Mark open') : t('Mark done')}>{it.done && <Icon name="check" size={11} />}</button>
      <div className="idea-main" onDoubleClick={() => { setText(it.raw); setEdit(true) }}>
        <span className="idea-text">{it.text}</span>
        <span className="idea-meta">
          {it.tags.map((t) => <span key={t} className="idea-tag">#{t}</span>)}
          {it.sent && <span className="idea-sent"><Icon name="helm" size={10} /> {t('sent {date}', { date: it.sent.slice(5) })}</span>}
        </span>
      </div>
      <div className="idea-actions">
        {!it.done && <button className="icon-btn" onClick={send} disabled={busy} title={t('Hand to chief of staff')} aria-label={t('Hand to chief of staff')}><Icon name="helm" size={13} /></button>}
        <button className="icon-btn" onClick={() => { setText(it.raw); setEdit(true) }} title={t('Edit')} aria-label={t('Edit')}><Icon name="edit" size={13} /></button>
        <button className="icon-btn danger" onClick={del} title={t('Delete')} aria-label={t('Delete')}><Icon name="trash" size={13} /></button>
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
    <Card icon="bulb" title={t('Ideas')} summary={data ? t('{n} open', { n: openCount }) : ''} right={<span className="updated">{t('{n} open', { n: openCount })}</span>}>
      <form className="idea-add" onSubmit={add}>
        <Icon name="plus" size={14} className="muted" />
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Add an idea… use #tags to group')} />
        {text.trim() && <button className="btn primary small" type="submit">{t('Add')}</button>}
      </form>
      {error && <p className="error-text">{error}</p>}
      {items.length > 0 && (
        <div className="chips news-chips">
          {[['open', t('Open {n}', { n: openCount })], ...tags.map((tag) => [tag, `#${tag}`]), ['done', t('Done')]].map(([k, l]) => (
            <button key={k} className={`fchip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      )}
      {flash && <p className="r-flash">{flash}</p>}
      <ul className="idea-list">
        {(all ? shown : shown.slice(0, 8)).map((it) => <IdeaRow key={it.id} it={it} onChanged={refresh} setFlash={setFlash} />)}
      </ul>
      {shown.length > 8 && <button className="ghost-btn idea-more" onClick={() => setAll(!all)}>{all ? t('Show fewer') : t('Show {n} more', { n: shown.length - 8 })}</button>}
      {data && !shown.length && <p className="muted small">{filter === 'done' ? t('Nothing finished yet.') : t('No ideas here yet.')}</p>}
      {data?.file && <p className="muted small idea-file">Saved in <code>{data.file.replace(/^\/Users\/[^/]+/, '~')}</code>, editable in any editor.</p>}
    </Card>
  )
}
