import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, usePoll } from '../api.js'
import { usePersisted } from './layout.jsx'
import { locale, t, tx } from '../i18n/index.js'

// The chief of staff's own task list (state/tasks.md, kept through `bridge task`), in a tray on
// its message box like Subagents: open tasks first, done ones folded away. Adding one here also
// sends it to the chief. What a finished task produced opens in Files (or as a link).
const LABEL = { open: tx('Open'), doing: tx('Doing'), waiting: tx('Waiting on you'), done: tx('Done') }
const DOT = { open: 'idle', doing: 'working', waiting: 'blocked', done: 'done' }
const day = (d) => {
  if (!d) return ''
  const at = new Date(`${d}T12:00:00`)
  if (Number.isNaN(+at)) return d
  const diff = Math.round((new Date().setHours(12, 0, 0, 0) - at) / 864e5)
  return diff === 0 ? t('today') : diff === 1 ? t('yesterday') : at.toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
}

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

export default function ChiefTasks({ agent, onOpenPath }) {
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
  const waiting = open.filter((x) => x.status === 'waiting').length
  const doing = open.filter((x) => x.status === 'doing').length

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
      const r = await api('/chief/tasks', { method: 'POST', body: { title, send: true } })
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
    return (
      <li key={it.id} className={`ct-item s-${it.status}`}>
        <span className={`sdot sdot-${DOT[it.status]}`} style={{ '--d': '8px' }} role="img" aria-label={t(LABEL[it.status])} title={t(LABEL[it.status])} />
        <div className="ct-main">
          <span className="ct-title"><span className="ct-id">{it.id}</span>{it.title}</span>
          {it.status === 'waiting' && it.needs && <span className="ct-needs">{t('Needs: {needs}', { needs: it.needs })}</span>}
          {isDone && it.outcome && <span className="ct-outcome">{it.outcome}</span>}
          {it.link && <span className="ct-links"><Result link={it.link} cwd={agent.cwd} onOpenPath={onOpenPath} /></span>}
        </div>
        <span className="ct-meta">{isDone ? t('Done {day}', { day: day(it.done) }) : `${it.status === 'open' ? '' : `${t(LABEL[it.status])} · `}${it.from === 'you' ? t('from you, {day}', { day: day(it.added) }) : day(it.added)}`}</span>
        {isDone
          ? <button className="ct-act" onClick={() => set(it, { status: 'open' })} disabled={busy === it.id} title={t('Reopen')} aria-label={t('Reopen task {id}', { id: it.id })}><Icon name="undo" size={12} /><span>{t('Reopen')}</span></button>
          : <button className="ct-act" onClick={() => set(it, { status: 'done', outcome: 'Marked done in the Tasks panel' })} disabled={busy === it.id} title={t('Mark done')} aria-label={t('Mark task {id} done', { id: it.id })}><Icon name="check" size={12} /><span>{t('Done')}</span></button>}
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
