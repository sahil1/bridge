import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, usePoll } from '../api.js'
import { usePersisted } from './layout.jsx'
import { onFor } from './Machines.jsx'
import { locale, t, tx } from '../i18n/index.js'
import { runSaid } from './meetings/handon.js'

// The chief of staff's task list (state/tasks.md, kept through `bridge task` and `bridge
// delegate`), in a tray on its message box like Subagents: open tasks first, done ones folded away.
// Adding one here also sends it to the chief. What a finished task produced opens in Files (or as a
// link). A task it handed to a helper says the helper's role. Board opens them all as a board
// (ChiefBoard, below), the chief's Tasks view.
const LABEL = { open: tx('Open'), doing: tx('Doing'), waiting: tx('Waiting on you'), done: tx('Done') }
const DOT = { open: 'idle', doing: 'working', waiting: 'blocked', done: 'done' }
const day = (d) => {
  if (!d) return ''
  const at = new Date(`${d}T12:00:00`)
  if (Number.isNaN(+at)) return d
  const diff = Math.round((new Date().setHours(12, 0, 0, 0) - at) / 864e5)
  return diff === 0 ? t('today') : diff === 1 ? t('yesterday') : at.toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
}
// What a task marked done in the Tasks panel says it came to, as kept on the list (where the chief
// reads it, in English), and as shown here, in your language.
const DONE_HERE = 'Marked done in the Tasks panel'
export const outcomeOf = (o) => (o === DONE_HERE ? t('Marked done in the Tasks panel') : o)
// A role as the chief named it (marketing, user-research), as a label: Marketing, User research.
const roleName = (r) => { const s = String(r || '').replace(/-/g, ' '); return s ? `${s[0].toUpperCase()}${s.slice(1)}` : '' }

// A path in the chief's folder (as the server keeps it: work/...), or a full one inside it.
function inFolder(link, cwd) {
  if (!link || /^https?:\/\//i.test(link)) return null
  const home = (cwd.match(/^\/(Users|home)\/[^/]+/) || [''])[0]
  let p = link.replace(/^~(?=\/)/, home)
  if (p.startsWith('/')) {
    if (!p.startsWith(`${cwd}/`)) return null
    p = p.slice(cwd.length + 1)
  }
  return p.replace(/^\.\//, '') || null
}

function Result({ link, cwd, onOpenPath }) {
  if (!link) return null
  if (/^https?:\/\//i.test(link)) {
    let host = link
    try { host = new URL(link).host } catch { /* shown as is */ }
    return <a className="ct-open" href={link} target="_blank" rel="noreferrer" title={link}><Icon name="external" size={11} /> {host}</a>
  }
  const rel = inFolder(link, cwd)
  if (!rel) return <code className="ct-path" title={link}>{link}</code>
  const dir = !/\.[A-Za-z0-9]{1,8}$/.test(rel.replace(/\/$/, ''))
  return (
    <button className="ct-open" onClick={() => onOpenPath(dir ? `${rel.replace(/\/$/, '')}/` : rel)} title={t('Open {path} in Files', { path: rel })}>
      <Icon name={dir ? 'folder' : 'file'} size={11} /> {rel.split('/').filter(Boolean).pop()}
    </button>
  )
}

export default function ChiefTasks({ agent, onOpenPath, onBoard }) {
  const { data, refresh } = usePoll('/chief/tasks', agent.status === 'working' ? 4000 : 10000)
  // The chief ticks tasks off as it works: look again when it starts or stops.
  useEffect(() => { refresh() }, [agent.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const [collapsed, setCollapsed] = usePersisted('cc-ct-collapsed', false)
  const [showDone, setShowDone] = useState(false)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(null) // the id being changed, or 'add'
  const [note, setNote] = useState(null)
  const items = data?.items || []
  const open = items.filter((x) => x.status !== 'done')
  const done = items.filter((x) => x.status === 'done')
  // (A helper asking you something counts as needing you, as on the board.)
  const waiting = open.filter((x) => columnOf(x) === 'needs').length
  const doing = open.filter((x) => columnOf(x) === 'working').length

  // The tray grows upward into the chat; cap it so some of the conversation stays visible.
  const trayRef = useRef(null)
  const doneRef = useRef(null)
  const [maxH, setMaxH] = useState(300)
  // Done ones open under the open ones: bring them into view, keeping a little of the open ones.
  useLayoutEffect(() => {
    const el = doneRef.current
    const body = el?.parentElement
    if (!showDone || !body) return
    const gap = el.getBoundingClientRect().top - body.getBoundingClientRect().top
    if (gap > body.clientHeight / 2) body.scrollTop += gap - 44
  }, [showDone])
  useLayoutEffect(() => {
    const fit = () => {
      const c = trayRef.current?.closest('.console')
      if (c) setMaxH(Math.max(150, Math.round((c.clientHeight - 230) * 0.6)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [collapsed, showDone, items.length, adding])

  const say = (msg) => { setNote(msg); setTimeout(() => setNote((n) => (n === msg ? null : n)), msg.length > 60 ? 7000 : 3500) }
  const add = async (e) => {
    e.preventDefault()
    const title = text.trim()
    if (!title || busy) return
    setBusy('add')
    try {
      const r = await api('/chief/tasks', { method: 'POST', body: { title, send: true, typed: 'tasks' } })
      setText('')
      setAdding(false)
      setCollapsed(false)
      say(r.error ? t("Added as {id}, but it didn't reach the chief: {error}", { id: r.item.id, error: r.error })
        : !r.sent ? t('Added as {id}. The chief sees it the next time you talk to it.', { id: r.item.id })
          : r.queued ? t("Added as {id}. The chief gets it when it's free.", { id: r.item.id }) : t('Added as {id} and sent to the chief.', { id: r.item.id }))
      refresh()
    } catch (x) { say(x.message) } finally { setBusy(null) }
  }
  const set = async (it, body) => {
    setBusy(it.id)
    try { await api(`/chief/tasks/${encodeURIComponent(it.id)}`, { method: 'PATCH', body }); refresh() } catch (x) { say(x.message) } finally { setBusy(null) }
  }

  const form = adding && (
    <form className="ct-add" onSubmit={add}>
      <input autoFocus value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder={t('Add a task for the chief')}
        aria-label={t('Add a task for the chief')} onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setText('') } }} />
      <button className="btn small primary" type="submit" disabled={!text.trim() || busy === 'add'}>{busy === 'add' ? t('Adding…') : t('Add')}</button>
      <button className="sa-icon" type="button" onClick={() => { setAdding(false); setText('') }} aria-label={t('Cancel')} title={t('Cancel')}><Icon name="x" size={12} /></button>
    </form>
  )

  if (!data) return null
  // Nothing on the list: one quiet line to add the first task.
  if (!items.length) {
    return (
      <div className="sa-tray ct-tray quiet" ref={trayRef}>
        {form || (
          <button className="sa-head ct-quiet" onClick={() => setAdding(true)}>
            <Icon name="check" size={13} />
            <span className="sa-title">{t('Tasks')}</span>
            <span className="sa-sub">{t('Add a task for the chief')}</span>
            <Icon name="plus" size={12} className="ct-plus" />
          </button>
        )}
        {note && <div className="ct-note" role="status">{note}</div>}
      </div>
    )
  }

  const summary = open.length
    ? [t('{n} open', { n: open.length }), waiting && t('{n} needs you', { n: waiting }), doing && t('{n} doing', { n: doing })].filter(Boolean).join(' · ')
    : t('all done')
  const row = (it) => {
    const isDone = it.status === 'done'
    const queued = it.helper?.state === 'queued'
    // Its helper asking you something: it needs you, though the task is still being done.
    const asks = !isDone && columnOf(it) === 'needs' && it.status !== 'waiting'
    return (
      <li key={it.id} className={`ct-item s-${asks ? 'waiting' : it.status}`}>
        <span className={`sdot sdot-${asks ? 'blocked' : DOT[it.status]}`} style={{ '--d': '8px' }} role="img" aria-label={asks ? t('Needs you') : t(LABEL[it.status])} title={asks ? t('Needs you') : t(LABEL[it.status])} />
        <div className="ct-main">
          <span className="ct-title"><span className="ct-id">{it.id}</span>{it.role && <span className="ct-role">{roleName(it.role)}</span>}{it.shown || it.title}</span>
          {it.status === 'waiting' && it.needs && <span className="ct-needs">{t('Needs: {needs}', { needs: it.needs })}</span>}
          {isDone && it.outcome && <span className="ct-outcome">{outcomeOf(it.outcome)}</span>}
          {it.link && <span className="ct-links"><Result link={it.link} cwd={agent.cwd} onOpenPath={onOpenPath} /></span>}
        </div>
        <span className="ct-meta">{isDone ? t('Done {day}', { day: day(it.done) }) : queued ? t('Queued') : asks ? t('Needs you') : `${it.status === 'open' ? '' : `${t(LABEL[it.status])} · `}${it.from === 'you' ? t('from you, {day}', { day: day(it.added) }) : day(it.added)}`}</span>
        {isDone
          ? <button className="ct-act" onClick={() => set(it, { status: 'open' })} disabled={busy === it.id} title={t('Reopen')} aria-label={t('Reopen task {id}', { id: it.id })}><Icon name="undo" size={12} /><span>{t('Reopen')}</span></button>
          : <button className="ct-act" onClick={() => set(it, { status: 'done', outcome: DONE_HERE })} disabled={busy === it.id} title={t('Mark done')} aria-label={t('Mark task {id} done', { id: it.id })}><Icon name="check" size={12} /><span>{t('Done')}</span></button>}
      </li>
    )
  }

  return (
    <div className={`sa-tray ct-tray ${collapsed ? 'collapsed' : ''}`} ref={trayRef}>
      <div className="sa-head">
        <button className="sa-head-main" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <Icon name="check" size={13} className="ct-icon" />
          <span className="sa-title">{t('Tasks')}</span>
          <span className="sa-sub">{summary}</span>
          {collapsed && open[0] && <span className="sa-peek">{open.map((x) => x.title).join(' · ')}</span>}
        </button>
        {onBoard && <button className="sa-link ct-board-btn" onClick={onBoard} title={t('Every task as a board: queued, working, needs you and done')}><Icon name="columns" size={11} /><span>{t('Board')}</span></button>}
        {done.length > 0 && <button className="sa-link ct-done-link" onClick={() => { setShowDone(!showDone || collapsed); setCollapsed(false) }} aria-expanded={showDone && !collapsed}>{showDone && !collapsed ? t('Hide done') : t('Done ({n})', { n: done.length })}</button>}
        {!adding && <button className="sa-link ct-add-btn" onClick={() => { setAdding(true); setCollapsed(false) }} aria-label={t('Add a task for the chief')} title={t('Add a task for the chief')}><Icon name="plus" size={11} /><span>{t('Add')}</span></button>}
        <button className="sa-icon" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t('Show tasks') : t('Hide tasks')} title={collapsed ? t('Show') : t('Hide')}>
          <Icon name="chevron" size={12} className={collapsed ? 'rot-up' : 'rot90'} />
        </button>
      </div>
      {!collapsed && (
        <div className="ct-body" style={{ maxHeight: maxH }}>
          {form}
          {open.length > 0 && <ul className="ct-list">{open.map(row)}</ul>}
          {!open.length && !showDone && !adding && <p className="ct-empty">{t('Nothing open.')}</p>}
          {showDone && done.length > 0 && <ul className="ct-list done" ref={doneRef}>{done.map(row)}</ul>}
        </div>
      )}
      {note && <div className="ct-note" role="status">{note}</div>}
    </div>
  )
}

// ---------- The board ----------
// Every task on the list in four columns: Queued (not started yet, or a helper waiting its turn),
// Working, Needs you (a helper's question, a task that waits on you, a helper that couldn't start)
// and Done, the latest. A delegated task's card has its helper's role, what it's doing now and how
// long it's been at it, and opens the helper; a finished one has the outcome and the file it made.
// A task the chief does itself shows the same, with no role. In a narrow pane (a phone), one
// column at a time, picked above them.
const COLS = [['queued', tx('Queued')], ['working', tx('Working')], ['needs', tx('Needs you')], ['done', tx('Done')]]
const COL_DOT = { queued: 'idle', working: 'working', needs: 'blocked', done: 'done' }
const EMPTY = { queued: tx('Nothing waiting to start.'), working: tx('Nothing at work right now.'), needs: tx('Nothing needs you.'), done: tx('Nothing finished yet.') }
const DONE_SHOWN = 12
const secs = (iso) => (iso ? Math.max(0, (Date.now() - Date.parse(iso)) / 1000) : null)
const openAgent = (paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } }))

export function columnOf(it) {
  const h = it.helper
  if (it.status === 'done') return 'done'
  if (it.status === 'waiting') return 'needs'
  if (h?.state === 'working') return h.status === 'blocked' || h.asking ? 'needs' : 'working'
  if (h?.state === 'starting') return 'working'
  if (h?.state === 'queued') return 'queued'
  return it.status === 'doing' ? 'working' : 'queued'
}

function Card({ it, col, cwd, onOpenPath, onRetry, busy }) {
  const h = it.helper
  const role = it.role || h?.role
  const live = !!(h?.live && h.paneId)
  const off = h?.state === 'ended' && h.end !== 'finished' && it.status !== 'done'
  // What it's doing now, or what it needs, in a line.
  const now = col === 'working'
    ? h ? h.doing?.tool || h.doing?.text || (h.worked ? null : t('Starting…')) : null
    : col === 'needs'
      ? h?.state === 'working' ? h.asking || t('Waiting for your answer') : h?.end === 'failed' ? null : it.needs
      : col === 'queued' && h?.state === 'queued' ? (h.position > 1 ? t('{n} ahead of it', { n: h.position - 1 }) : t('Next to start')) : null
  // And for how long.
  const when = col === 'done' ? t('Done {day}', { day: day(it.done) })
    : col === 'working' && h?.startedAt ? t('Working for {time}', { time: onFor(secs(h.startedAt)) })
      : col === 'needs' && h?.state === 'working' ? t('Waiting on you for {time}', { time: onFor(secs(h.statusSince || h.startedAt)) })
        : col === 'queued' && h?.state === 'queued' ? t('Queued for {time}', { time: onFor(secs(h.at)) })
          : day(it.added)
  const Main = live ? 'button' : 'div'
  const files = col === 'done' && h?.files?.length ? h.files.slice(0, 3) : it.link ? [it.link] : []
  return (
    <li className={`cb-card c-${col}${off ? ' off' : ''}`}>
      <Main className="cb-main" {...(live ? { type: 'button', onClick: () => openAgent(h.paneId), title: t('Open its {role} helper', { role: role || '' }) } : {})}>
        <span className="cb-top">
          <span className={`sdot sdot-${COL_DOT[col]}`} style={{ '--d': '8px' }} role="img" aria-label={t(COLS.find(([id]) => id === col)[1])} />
          {role ? <span className="cb-role">{roleName(role)}</span> : <span className="cb-self">{t('Chief of Staff')}</span>}
          <span className="cb-id">#{it.id}</span>
          <span className="cb-when">{when}</span>
        </span>
        <span className="cb-title">{it.shown || it.title}</span>
        {now && <span className={`cb-now${col === 'needs' ? ' needs' : ''}`}>{h?.doing?.tool && col === 'working' && <Icon name="tool" size={10} />}<span>{now}</span></span>}
      </Main>
      {col === 'done' && it.outcome && <p className="cb-outcome">{outcomeOf(it.outcome)}</p>}
      {h?.end === 'failed' && h.error && it.status !== 'done' && <p className="cb-error" role="alert"><Icon name="alert" size={11} /><span>{t("Couldn't start: {error}", { error: h.error })}</span></p>}
      {(files.length > 0 || off) && (
        <div className="cb-acts">
          {files.map((f) => <Result key={f} link={f} cwd={cwd} onOpenPath={onOpenPath} />)}
          {off && <button type="button" className="ghost-btn cb-retry" onClick={() => onRetry(it)} disabled={busy === it.id}><Icon name="refresh" size={11} />{busy === it.id ? t('Starting…') : t('Try again')}</button>}
        </div>
      )}
    </li>
  )
}

// How handing a meeting's action items on by themselves last went (server/meetitems.js), with its
// meeting a click away: shown while Hand on action items is on, or once it has run.
function MeetingRun({ st }) {
  const said = st?.last ? runSaid(st.last, { title: true }) : st?.on ? { text: t('Hands on action items as each meeting ends. None has ended since.') } : null
  if (!said) return null
  const open = () => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id: st.last.id } }))
  return (
    <p className={`cb-note cb-run${said.bad ? ' bad' : ''}`} role="status">
      <Icon name={said.bad ? 'alert' : 'helm'} size={12} />
      <span>{said.text}</span>
      {st.last && <button type="button" className="link-btn" onClick={open}>{t('Open the meeting')}</button>}
    </p>
  )
}

export function ChiefBoard({ agent, onOpenPath }) {
  const { data, error, refresh } = usePoll('/chief/tasks', 3000)
  const [pick, setPick] = useState(null) // the column shown when there's room for one
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState(null)
  useEffect(() => { refresh() }, [agent.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = data?.items || []
  const by = Object.fromEntries(COLS.map(([id]) => [id, []]))
  for (const it of items) by[columnOf(it)].push(it)
  by.queued.sort((a, b) => (a.helper?.position || 99) - (b.helper?.position || 99) || Number(a.id) - Number(b.id))
  const doneAll = by.done.length
  by.done = by.done.slice(0, DONE_SHOWN)
  // A narrow pane shows one column: the one picked, else what needs you, else what's at work.
  const shown = pick || ['needs', 'working', 'queued', 'done'].find((id) => by[id].length) || 'working'
  const retry = async (it) => {
    setBusy(it.id)
    try {
      const r = await api(`/chief/delegate/${encodeURIComponent(it.id)}/retry`, { method: 'POST' })
      setNote(r.helper?.error ? t("Couldn't start: {error}", { error: r.helper.error }) : r.helper?.state === 'queued' ? t('Queued: it starts when a helper finishes.') : null)
      refresh()
    } catch (x) { setNote(x.message) } finally { setBusy(null) }
  }
  const h = data?.helpers
  const summary = h ? [
    t('{n} of {max} helpers at work', { n: h.working, max: h.max }),
    h.queued > 0 && t('{n} queued', { n: h.queued }),
  ].filter(Boolean).join(' · ') : ''

  return (
    <div className="cb" role="region" aria-label={t('Tasks board')}>
      <div className="cb-head">
        <h3><Icon name="columns" size={15} />{t('Tasks')}</h3>
        {summary && <span className="cb-sum">{summary}</span>}
      </div>
      {error && !data && <p className="cb-note error" role="alert"><Icon name="alert" size={12} /> {t("Couldn't load the tasks: {error}", { error })}</p>}
      {data?.meetingItems && <MeetingRun st={data.meetingItems} />}
      {note && <p className="cb-note" role="status">{note}</p>}
      {!data && !error && <div className="cb-loading" aria-hidden="true"><div /><div /><div /></div>}
      {data && !items.length && (
        <div className="cb-empty-all">
          <Icon name="columns" size={26} />
          <p>{t('Nothing on the board yet.')}</p>
          <p className="muted">{t('Ask your Chief of Staff for something that takes a while: it hands each piece to a helper, and each one shows here as it works, with what it made when it\'s done.')}</p>
        </div>
      )}
      {data && items.length > 0 && (
        <>
          <div className="seg cb-seg" role="tablist" aria-label={t('Columns')}>
            {COLS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={shown === id} className={shown === id ? 'on' : ''} onClick={() => setPick(id)}>
                {t(label)}<span className={`cb-n${id === 'needs' && by.needs.length ? ' needs' : ''}`}>{id === 'done' ? doneAll : by[id].length}</span>
              </button>
            ))}
          </div>
          <div className="cb-cols">
            {COLS.map(([id, label]) => (
              <section key={id} className={`cb-col c-${id}${shown === id ? ' on' : ''}`} aria-label={t(label)}>
                <h4 className="cb-col-head"><span className={`sdot sdot-${COL_DOT[id]}`} style={{ '--d': '8px' }} />{t(label)}<span className={`cb-n${id === 'needs' && by.needs.length ? ' needs' : ''}`}>{id === 'done' ? doneAll : by[id].length}</span></h4>
                {by[id].length
                  ? <ul className="cb-list">{by[id].map((it) => <Card key={it.id} it={it} col={id} cwd={agent.cwd} onOpenPath={onOpenPath} onRetry={retry} busy={busy} />)}</ul>
                  : <p className="cb-empty">{t(EMPTY[id])}</p>}
                {id === 'done' && doneAll > DONE_SHOWN && <p className="cb-more">{t('And {n} more, in the Tasks panel in the chat.', { n: doneAll - DONE_SHOWN })}</p>}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
