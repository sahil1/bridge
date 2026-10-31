import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, refetch } from '../../api.js'
import { usePersisted } from '../layout.jsx'
import { openSettings } from '../SignIn.jsx'
import { md } from './ask.jsx'
import { t, locale } from '../../i18n/index.js'

// A meeting's action items, each turned into work in one click: Start an agent (in the project
// it's about, on its own branch, told what was said about it; you confirm the project first) or To
// Chief of Staff. What became of each shows under it: the agent working, waiting on you, finished,
// its pull request; Chief of Staff's task and its outcome. And "since last time": what became of the
// items from the last meeting in the series, with the same people or the same customer.

const say = (fn) => (e) => { e?.preventDefault?.(); fn() }
const openAgent = (paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } }))
const day = (iso) => new Date(iso).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })
// Code-shaped (a bug, a fix, a repo...): Start an agent leads; otherwise To Chief of Staff does.
const CODE = /\b(bug|fix|test|tests|deploy|release|ship|merge|pr|pull request|repo|branch|endpoint|api|refactor|migrat\w*|build|crash|error|webhook|script|code|implement|prototype|feature|page|screen|database|schema|query|ci|lint)\b|\.(?:js|jsx|ts|tsx|py|go|rs|rb|java|swift|kt|css|html|md|json|ya?ml)\b/i

// The words for an agent's state, a pull request and Chief of Staff's task.
const agentSays = (a) => (a.status === 'working' ? t('working') : a.status === 'blocked' ? t('needs you') : a.status === 'closed' ? t('closed') : t('finished'))
function prSays(pr) {
  const state = pr.state === 'MERGED' ? t('merged') : pr.state === 'CLOSED' ? t('closed') : pr.draft ? t('draft') : t('open')
  const c = pr.checks || {}
  const checks = pr.state !== 'OPEN' ? '' : c.fail ? ` · ${c.fail === 1 ? t('{n} check failing', { n: c.fail }) : t('{n} checks failing', { n: c.fail })}` : c.pending ? ` · ${t('checks running')}` : c.pass ? ` · ${t('checks pass')}` : ''
  return `${t('PR #{n}', { n: pr.number })} · ${state}${checks}`
}
function chiefSays(c) {
  if (c.status === 'doing') return t('Chief of Staff is on it')
  if (c.status === 'waiting') return c.needs ? t('Chief of Staff is waiting on you: {what}', { what: c.needs }) : t('Chief of Staff is waiting on you')
  if (c.status === 'done' || c.status === 'gone') return c.outcome ? t('Chief of Staff did it: {what}', { what: c.outcome }) : t('Chief of Staff did it')
  return t("On Chief of Staff's task list")
}
const STATE_ICON = { done: 'check', needs: 'blocked', working: 'working', review: 'idle', open: 'dot' }

// Where an item went, in a line or two: its agent (and pull request), Chief of Staff's task.
export function WentTo({ x, compact = false }) {
  const a = x.agent
  return (
    <>
      {a && (
        <span className="mt-went agent" data-status={a.status}>
          <Icon name="bot" size={12} />
          <span>{t('{agent} in {project}', { agent: a.kindLabel || a.kind, project: a.projectName || a.project || '' })}{a.branch && !compact ? <> · <Icon name="branch" size={10} /> {a.branch}</> : null} · {agentSays(a)}</span>
          {a.live && <button type="button" className="link-btn" onClick={() => openAgent(a.paneId)}>{t('Open')}</button>}
        </span>
      )}
      {a?.pr && <a className={`mt-went pr pr-${String(a.pr.state).toLowerCase()}`} href={a.pr.url} target="_blank" rel="noreferrer" title={a.pr.title}><Icon name="branch" size={12} /> <span>{prSays(a.pr)}</span></a>}
      {x.chief && <span className="mt-went chief" data-status={x.chief.status}><Icon name="helm" size={12} /> <span>{chiefSays(x.chief)}</span></span>}
    </>
  )
}

// Start an agent on an item: the project it's likely about picked (and why), the agent you start
// with, on its own branch in a git project, and what it will be told (yours to change). Start.
function StartAgent({ id, item, onStarted, onCancel }) {
  const [prep, setPrep] = useState(null)
  const [err, setErr] = useState(null)
  const [kinds, setKinds] = useState(null)
  const [all, setAll] = useState([])
  const [kind, setKind] = usePersisted('cc-new-kind', 'claude')
  const [where, setWhere] = useState('') // a project's path, or ':other'
  const [other, setOther] = useState('')
  const [repo, setRepo] = useState(null)
  const [own, setOwn] = useState(true)
  const [prompt, setPrompt] = useState(null)
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  // In view once it's there (on a phone it opens below the fold).
  useEffect(() => { if (prep) box.current?.scrollIntoView?.({ block: 'nearest' }) }, [prep])
  useEffect(() => {
    let on = true
    api(`/meetings/${encodeURIComponent(id)}/work/${item.key}`).then((p) => { if (!on) return; setPrep(p); setWhere(p.projects[0]?.path || '') }).catch((e) => on && setErr(e.message))
    api('/agent-kinds').then((ks) => on && setKinds(ks)).catch(() => on && setKinds([]))
    api('/projects').then((r) => on && setAll(r.projects || [])).catch(() => {})
    return () => { on = false }
  }, [id, item.key])
  useEffect(() => { if (kinds?.length && !kinds.some((k) => k.kind === kind)) setKind(kinds[0].kind) }, [kinds]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (prep && !all.length && !prep.projects.length) setWhere(':other') }, [prep, all.length])
  const dir = where === ':other' ? other.trim() : where
  // Whether it's a git repo (so it can have a branch of its own), and that branch's name.
  useEffect(() => {
    setRepo(null)
    if (!dir || !prep) return
    const tm = setTimeout(() => api(`/repo?dir=${encodeURIComponent(dir)}&label=${encodeURIComponent(prep.label)}`).then((r) => setRepo(r.repo ? r : false)).catch(() => setRepo(false)), 200)
    return () => clearTimeout(tm)
  }, [dir, prep])
  const why = (w) => (w === 'item' ? t('Named in this item') : w === 'title' ? t("In the meeting's name") : w === 'notes' ? t('In the notes') : w === 'said' ? t('Said in the meeting') : /^said:/.test(w) ? t('Said {n} times in the meeting', { n: w.slice(5) }) : w === 'before' ? t('Used for this meeting before') : t('Where you worked last'))
  const picked = prep?.projects.find((p) => p.path === where)
  const rest = all.filter((p) => !prep?.projects.some((x) => x.path === p.path))
  const go = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await api(`/meetings/${encodeURIComponent(id)}/work/${item.key}/agent`, { method: 'POST', body: { cwd: dir, kind, own: !!repo && own, ...(prompt != null && prompt !== prep.prompt ? { prompt } : {}) } })
      onStarted(r)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  if (!prep) return <div className="mt-start" role="group" aria-label={t('Start an agent')}>{err ? <p className="error-text small">{err}</p> : <p className="muted small">{t('Loading…')}</p>}</div>
  const none = kinds && !kinds.length
  return (
    <form ref={box} className="mt-start" role="group" aria-label={t('Start an agent')} onSubmit={say(go)}>
      <label className="mt-start-row"><span>{t('Project')}</span>
        <select value={where} onChange={(e) => setWhere(e.target.value)} aria-label={t('Project')}>
          {prep.projects.length > 0 && <optgroup label={t('Likely')}>{prep.projects.map((p) => <option key={p.path} value={p.path}>{p.name} · {why(p.why[0])}</option>)}</optgroup>}
          {rest.length > 0 && <optgroup label={t('Your projects')}>{rest.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}</optgroup>}
          <option value=":other">{t('Another folder…')}</option>
        </select>
      </label>
      {where === ':other' && <input className="mt-start-dir" value={other} onChange={(e) => setOther(e.target.value)} placeholder="~/code/project" aria-label={t('Folder')} autoFocus />}
      {picked && <p className="muted small mt-start-why">{picked.why.map(why).join(' · ')} · {picked.short}</p>}
      {none ? (
        <p className="muted small">{t('No agents on this computer yet.')} <button type="button" className="link-btn" onClick={() => openSettings('agents')}>{t('Install one in Settings › Agents')}</button></p>
      ) : (
        <label className="mt-start-row"><span>{t('Agent')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('Agent')}>{(kinds || []).map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select>
        </label>
      )}
      {repo && <label className="mt-start-own"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> <span>{t('On its own branch')} <code>{repo.branch}</code></span></label>}
      <details className="mt-start-told">
        <summary className="small">{t('What it will be told')}</summary>
        <textarea value={prompt ?? prep.prompt} onChange={(e) => setPrompt(e.target.value)} rows={8} aria-label={t('What it will be told')} />
      </details>
      {err && <p className="error-text small" role="alert">{err}</p>}
      <div className="mt-start-acts">
        <button type="submit" className="btn small primary" disabled={busy || none || !kinds || !dir}><Icon name="play" size={12} /> {busy ? t('Starting…') : t('Start')}</button>
        <button type="button" className="ghost-btn" onClick={onCancel}>{t('Cancel')}</button>
      </div>
    </form>
  )
}

// The action items under the summary's heading. heading: the section's own (it can be in another
// language); fallback: the section as Markdown, until what became of them has loaded.
export function ActionItems({ id, heading, fallback, onMsg }) {
  const { data, refresh } = usePoll(`/meetings/${encodeURIComponent(id)}/work`, 8000)
  const [open, setOpen] = useState(null) // the item key being started
  const [busy, setBusy] = useState(null)
  const [ticks, setTicks] = useState({}) // ticked or unticked here, until the server says so too
  const items = data?.items
  const act = async (key, fn) => { setBusy(key); try { await fn() } catch (e) { onMsg?.({ error: true, text: e.message }) } finally { setBusy(null); refresh() } }
  const toChief = (x) => act(x.key, async () => { const r = await api(`/meetings/${encodeURIComponent(id)}/chief`, { method: 'POST', body: { items: [x.text] } }); refetch(`/meetings/${encodeURIComponent(id)}`); onMsg?.({ text: r.sent ? (r.queued ? t("Sent to Chief of Staff (after what it's doing now).") : t('Sent to Chief of Staff.')) : t("On Chief of Staff's task list. Start Chief of Staff and it picks it up.") }) })
  const tick = async (x, on) => {
    setTicks((m) => ({ ...m, [x.key]: on }))
    try { await api(`/meetings/${encodeURIComponent(id)}/work/${x.key}/done`, { method: 'POST', body: { done: on } }); await refresh() } catch (e) { onMsg?.({ error: true, text: e.message }) }
    setTicks((m) => { const n = { ...m }; delete n[x.key]; return n })
  }
  const copy = async (x) => { try { await navigator.clipboard.writeText(x.text); onMsg?.({ text: t('Copied.') }) } catch { onMsg?.({ error: true, text: t("Couldn't copy") }) } }
  return (
    <>
      <div className="mt-summary md mt-items-head" dangerouslySetInnerHTML={{ __html: md(heading) }} />
      {!items ? <div className="mt-summary md" dangerouslySetInnerHTML={{ __html: md(fallback) }} /> : (
        <ul className="mt-items" aria-label={t('Action items')}>
          {items.map((x) => {
            const went = x.agent || x.chief
            const ticked = x.key in ticks ? ticks[x.key] : !!(x.done || x.ticked)
            const done = x.key in ticks ? ticks[x.key] || (x.state === 'done' && !x.done) : x.state === 'done'
            const code = CODE.test(x.text)
            return (
              <li key={x.key} className={`mt-item${done ? ' done' : ''}`} data-state={x.state} data-key={x.key}>
                <input type="checkbox" className="mt-item-tick" checked={ticked} disabled={busy === x.key || (x.ticked && !x.done)} onChange={(e) => tick(x, e.target.checked)} aria-label={t('Done: {item}', { item: x.text })} />
                <div className="mt-item-main">
                  <div className="mt-item-text md" dangerouslySetInnerHTML={{ __html: md(x.text) }} />
                  {went && <div className="mt-item-went"><WentTo x={x} /></div>}
                  {!went && !done && open !== x.key && (
                    <div className="mt-item-acts">
                      <button type="button" className={`btn small${code || x.yours ? ' lead' : ''} mt-to-agent`} onClick={() => setOpen(x.key)}><Icon name="bot" size={12} /> {t('Start an agent')}</button>
                      <button type="button" className={`btn small${!code && !x.yours ? ' lead' : ''} mt-to-chief`} disabled={busy === x.key} onClick={() => toChief(x)}><Icon name="helm" size={12} /> {t('To Chief of Staff')}</button>
                      <button type="button" className="ghost-btn" onClick={() => copy(x)} aria-label={t('Copy')} title={t('Copy')}><Icon name="copy" size={12} /></button>
                    </div>
                  )}
                  {open === x.key && (
                    <StartAgent id={id} item={x} onCancel={() => setOpen(null)} onStarted={(r) => {
                      setOpen(null); refresh()
                      onMsg?.({ text: t('Started {agent} in {project}.', { agent: r.agent.label, project: r.agent.projectName }), act: r.paneId ? { label: t('Open'), run: () => openAgent(r.paneId) } : null })
                    }} />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

// "2 of 3 done · 1 pull request open · 1 needs you".
export function sinceLine(c) {
  const parts = [t('{done} of {all} done', { done: c.done, all: c.all })]
  if (c.prs) parts.push(c.prs === 1 ? t('{n} pull request open', { n: c.prs }) : t('{n} pull requests open', { n: c.prs }))
  if (c.needs) parts.push(c.needs === 1 ? t('{n} needs you', { n: c.needs }) : t('{n} need you', { n: c.needs }))
  if (c.working) parts.push(t('{n} in progress', { n: c.working }))
  return parts.join(' · ')
}

// What became of the last meeting's action items: one line (folded), each item under it (open).
// path: /meetings/<id>/since, or /meetings/since?title=…&people=… for an event about to start.
export function SinceLastTime({ path, onOpen, className = '' }) {
  const { data } = usePoll(path, 30_000)
  const [open, setOpen] = useState(false)
  const last = data?.last
  if (!last || !data.items?.length) return null
  const why = last.why === 'series' ? t('the last {title}', { title: last.title }) : last.why === 'customer' && last.customer ? t('the last meeting with {who}', { who: last.customer }) : t('the last meeting with the same people')
  return (
    <section className={`mt-since${open ? ' open' : ''} ${className}`} aria-label={t('Since last time')}>
      <button type="button" className="mt-since-head" aria-expanded={open} onClick={() => setOpen(!open)} title={t('What became of the action items from {title}, {when}', { title: last.title, when: day(last.startedAt) })}>
        <Icon name="flag" size={13} />
        <b>{t('Since last time')}</b>
        <span className="mt-since-line">{sinceLine(data.counts)}</span>
        <Icon name="chevron" size={12} className={open ? 'rot' : ''} />
      </button>
      {open && (
        <div className="mt-since-body">
          <p className="muted small">{t('From {what}, {when}.', { what: why, when: day(last.startedAt) })} {onOpen && <button type="button" className="link-btn" onClick={() => onOpen(last.id)}>{t('Open it')}</button>}</p>
          <ul>
            {data.items.map((x) => (
              <li key={x.key} className="mt-since-item" data-state={x.state}>
                <Icon name={STATE_ICON[x.state]} size={11} className="mt-state-ico" />
                <div><span className="mt-since-text">{x.text.replace(/[*_`]/g, '')}</span>{(x.agent || x.chief) ? <span className="mt-since-went"><WentTo x={x} compact /></span> : <span className="muted small">{x.done || x.ticked ? t('ticked done') : t('not handed on')}</span>}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
