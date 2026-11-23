import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, refetch } from '../../api.js'
import { usePersisted } from '../layout.jsx'
import { openSettings } from '../SignIn.jsx'
import { md } from './ask.jsx'
import { t, locale } from '../../i18n/index.js'
import { where as placeIn } from '../settings/search.js'
import { runSaid } from './handon.js'

// A meeting's action items, each turned into work in one click: Start an agent (in the project
// it's about, on its own branch, told what was said about it; you confirm the project first) or To
// Chief of Staff. What became of each shows under it: the agent working, waiting on you, finished,
// its pull request; Chief of Staff's task and its outcome. And "since last time": what became of the
// items from the last meeting in the series, with the same people or the same customer.
// With Hand on action items on (Chief of Staff's settings), the ones for someone else go to Chief of
// Staff by themselves as the meeting ends (server/meetitems.js): how that went heads the list, and
// under each item, where Chief of Staff put it (an agent, a helper, a question for you, or left with
// you), with Undo and Redirect, Send for one that waits for your OK, and the answer to its question.

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
// An item as you're shown it: without control, right-to-left or other invisible characters, which
// could make it read differently here from what's handed on (server/meetitems.js cleans those out).
// eslint-disable-next-line no-control-regex
const visible = (s) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]|[\u{e0000}-\u{e007f}]/gu, '')
const roleName = (r) => { const s = String(r || '').replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }
// An agent Chief of Staff (or you) handed it to: waiting for your OK, queued, working, needs you, done.
function handedSays(h) {
  if (h.held) return t('Waits for your OK to go to {agent}: it may work without asking first', { agent: h.label })
  if (h.lost) return t("{agent} closed before it got it", { agent: h.label })
  if (h.queued) return t('Queued for {agent}', { agent: h.label })
  if (h.status === 'closed') return t('Went to {agent}, closed since', { agent: h.label })
  return `${t('With {agent}', { agent: h.label })} · ${agentSays(h)}`
}
// Its helper, on the item's task: queued, at work, asking you, finished, couldn't start, closed.
function helperSays(h, c) {
  const who = t('{role} helper', { role: roleName(h.role) })
  if (c.status === 'done') return c.outcome ? t('{who} finished: {what}', { who, what: c.outcome }) : t('{who} finished', { who })
  if (h.state === 'queued') return `${who} · ${h.position > 1 ? t('{n} ahead of it', { n: h.position - 1 }) : t('next to start')}`
  if (h.end === 'failed') return t("{who} couldn't start: {error}", { who, error: h.error || '' })
  if (h.state === 'ended' && h.end === 'stopped') return t('{who} was closed before it finished', { who })
  if (h.status === 'blocked' || h.asking) return `${who} · ${h.asking ? t('needs you: {what}', { what: h.asking }) : t('needs you')}`
  return `${who} · ${t('working')}`
}

// Where an item went, in a line or two: its agent (and pull request), Chief of Staff's task, and
// where Chief of Staff placed it.
export function WentTo({ x, compact = false }) {
  const a = x.agent
  const h = x.handed
  const helper = x.chief?.helper
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
      {h?.to === 'agent' && (
        <span className="mt-went agent handed" data-status={h.held ? 'blocked' : h.status}>
          <Icon name="bot" size={12} />
          <span>{handedSays(h)}</span>
          {h.live && !h.held && !compact && <button type="button" className="link-btn" onClick={() => openAgent(h.paneId)}>{t('Open')}</button>}
        </span>
      )}
      {helper && (
        <span className="mt-went helper" data-status={helper.end === 'failed' || helper.status === 'blocked' || helper.asking ? 'blocked' : x.chief.status}>
          <Icon name="helm" size={12} />
          <span>{helperSays(helper, x.chief)}</span>
          {helper.live && helper.paneId && !compact && <button type="button" className="link-btn" onClick={() => openAgent(helper.paneId)}>{t('Open')}</button>}
        </span>
      )}
      {h?.to === 'ask' && !helper && x.chief?.status === 'waiting' && <span className="mt-went chief" data-status="waiting"><Icon name="helm" size={12} /> <span>{t('Chief of Staff asks: {question}', { question: h.question })}</span></span>}
      {h?.to === 'skip' && <span className="mt-went chief"><Icon name="helm" size={12} /> <span>{t('Chief of Staff left it with you: {why}', { why: h.why })}</span></span>}
      {x.chief && !helper && (!h || (h.to === 'ask' && x.chief.status !== 'waiting')) && (
        <span className="mt-went chief" data-status={x.unplaced ? 'waiting' : x.chief.status}><Icon name="helm" size={12} />{' '}
          <span>{x.unplaced ? t("Chief of Staff hasn't placed it yet") : x.chief.auto && ['open', 'doing'].includes(x.chief.status) && !h ? t('With Chief of Staff, to place') : chiefSays(x.chief)}</span>
        </span>
      )}
    </>
  )
}

// Where Chief of Staff placed one, in a line (after your answer, or sent to it again).
function placedSays(p) {
  if (!p) return t('Back with Chief of Staff, to place.')
  if (p.to === 'agent') return p.held ? t('Waits for your OK to go to {agent}.', { agent: p.label }) : t('Sent to {agent}.', { agent: p.label })
  if (p.to === 'helper') return t('A {role} helper has it.', { role: roleName(p.role).toLowerCase() })
  if (p.to === 'skip') return t('Left with you.')
  return t('Chief of Staff asks: {question}', { question: p.question })
}

// Chief of Staff's question about an item, answered here (on a phone too): it's placed with your
// answer, as Home's answer to its task is.
function Answer({ id, x, onMsg, onSent }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const r = await api(`/meetings/${encodeURIComponent(id)}/work/${x.key}/answer`, { method: 'POST', body: { text: text.trim() } })
      setText('')
      onMsg?.({ text: placedSays(r.placed) })
      onSent?.()
    } catch (e) { onMsg?.({ error: true, text: e.message }) } finally { setBusy(false) }
  }
  return (
    <form className="mt-answer" onSubmit={say(send)} aria-label={t('Answer Chief of Staff')}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Your answer')} aria-label={t('Your answer')} maxLength={4000} />
      <button type="submit" className="btn small" disabled={busy || !text.trim()}><Icon name="send" size={12} /> {busy ? t('Sending…') : t('Send')}</button>
    </form>
  )
}

// Somewhere else for an item: Chief of Staff again, a new helper, or an agent that's running (not
// Chief of Staff, a terminal, a chat, a bot's or a cloud agent).
const agentPlace = (a) => `${a.workspace || ''}${a.tab && !/^\d+$/.test(a.tab) ? ` › ${a.tab}` : ''}`.trim() || a.title || a.paneId
function Redirect({ id, x, onDone, onCancel, onMsg }) {
  const [agents, setAgents] = useState(null)
  const [to, setTo] = useState('chief')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const box = useRef(null)
  useEffect(() => { box.current?.scrollIntoView?.({ block: 'nearest' }) }, [])
  useEffect(() => {
    let on = true
    api('/fleet').then((f) => on && setAgents((f.agents || []).filter((a) => !a.chief && !a.helper?.list && !['shell', 'chat'].includes(a.kind) && !a.plainChat && !a.cloud && !/^cloud:/.test(a.paneId) && a.paneId !== x.handed?.paneId))).catch(() => on && setAgents([]))
    return () => { on = false }
  }, [x.handed?.paneId])
  const go = async () => {
    setBusy(true); setErr(null)
    try {
      const body = to === 'chief' ? { to: 'chief' } : to === 'helper' ? { to: 'helper', role: role.trim() || 'helper' } : { to: 'agent', pane: to }
      const r = await api(`/meetings/${encodeURIComponent(id)}/work/${x.key}/redirect`, { method: 'POST', body })
      const where = r.to === 'agent' ? (r.held ? t('Waits for your OK to go to {agent}.', { agent: r.label }) : t('Sent to {agent}.', { agent: r.label })) : r.to === 'helper' ? t('A helper has it.') : placedSays(r.placed)
      onMsg?.(r.already ? { text: `${where} ${t('It had already gone to {agent}: tell it there if it should stop.', { agent: r.already.label })}`, act: { label: t('Open'), run: () => openAgent(r.already.paneId) } } : { text: where })
      onDone()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <form ref={box} className="mt-start mt-redirect" role="group" aria-label={t('Redirect')} onSubmit={say(go)}>
      <label className="mt-start-row"><span>{t('To')}</span>
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('Redirect to')}>
          <option value="chief">{t('Chief of Staff, to place again')}</option>
          <option value="helper">{t('A new helper')}</option>
          {agents?.length > 0 && <optgroup label={t('An agent')}>{agents.map((a) => <option key={a.paneId} value={a.paneId}>{agentPlace(a)} · {a.kindLabel || a.kind}</option>)}</optgroup>}
        </select>
      </label>
      {to === 'helper' && <label className="mt-start-row"><span>{t('Role')}</span><input className="mt-start-dir" value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('research, writer, engineer…')} aria-label={t('Role')} maxLength={24} /></label>}
      {err && <p className="error-text small" role="alert">{err}</p>}
      <div className="mt-start-acts">
        <button type="submit" className="btn small primary" disabled={busy}><Icon name="repeat" size={12} /> {busy ? t('Redirecting…') : t('Redirect')}</button>
        <button type="button" className="ghost-btn" onClick={onCancel}>{t('Cancel')}</button>
      </div>
    </form>
  )
}

// How handing them on by themselves went, over the list (and Try again when it didn't go).
export function HandOn({ id, run, onMsg, onDone }) {
  const [busy, setBusy] = useState(false)
  const said = runSaid(run)
  if (!said) return null
  const again = async () => {
    setBusy(true)
    try { await api(`/meetings/${encodeURIComponent(id)}/handoff`, { method: 'POST' }); onDone?.() } catch (e) { onMsg?.({ error: true, text: e.message }) } finally { setBusy(false) }
  }
  return (
    <p className={`mt-handon small${said.bad ? ' bad' : ''}`} role="status" data-state={run.state}>
      <Icon name={said.bad ? 'alert' : 'helm'} size={12} />
      <span>{said.text}</span>
      {said.bad && <button type="button" className="link-btn" onClick={again} disabled={busy}>{busy ? t('Trying…') : t('Try again')}</button>}
    </p>
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
        <p className="muted small">{t('No agents on this computer yet.')} <button type="button" className="link-btn" onClick={() => openSettings('agents')}>{t('Install one in {place}', { place: placeIn('agents') })}</button></p>
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
  const [moving, setMoving] = useState(null) // the item key being redirected
  const [busy, setBusy] = useState(null)
  const [ticks, setTicks] = useState({}) // ticked or unticked here, until the server says so too
  const items = data?.items
  const act = async (key, fn) => { setBusy(key); try { await fn() } catch (e) { onMsg?.({ error: true, text: e.message }) } finally { setBusy(null); refresh() } }
  const toChief = (x) => act(x.key, async () => { const r = await api(`/meetings/${encodeURIComponent(id)}/chief`, { method: 'POST', body: { items: [x.text] } }); refetch(`/meetings/${encodeURIComponent(id)}`); onMsg?.({ text: r.sent ? (r.queued ? t("Queued for Chief of Staff, after what it's doing now.") : t('Sent to Chief of Staff.')) : t("On Chief of Staff's task list. Start Chief of Staff and it picks it up.") }) })
  const tick = async (x, on) => {
    setTicks((m) => ({ ...m, [x.key]: on }))
    try { await api(`/meetings/${encodeURIComponent(id)}/work/${x.key}/done`, { method: 'POST', body: { done: on } }); await refresh() } catch (e) { onMsg?.({ error: true, text: e.message }) }
    setTicks((m) => { const n = { ...m }; delete n[x.key]; return n })
  }
  const copy = async (x) => { try { await navigator.clipboard.writeText(x.text); onMsg?.({ text: t('Copied.') }) } catch { onMsg?.({ error: true, text: t("Couldn't copy") }) } }
  // Where Chief of Staff put it, changed by you: taken back, sent on to the agent that waits for your
  // OK, its helper tried again.
  const undo = (x) => act(x.key, async () => {
    const r = await api(`/meetings/${encodeURIComponent(id)}/work/${x.key}/undo`, { method: 'POST' })
    onMsg?.(r.already ? { text: t('Taken back here. It already went to {agent}: tell it there if it should stop.', { agent: r.already.label }), act: { label: t('Open'), run: () => openAgent(r.already.paneId) } } : { text: t("Taken back: it's yours to hand on.") })
  })
  const approve = (x) => act(x.key, async () => { const r = await api(`/meetings/${encodeURIComponent(id)}/work/${x.key}/approve`, { method: 'POST' }); onMsg?.({ text: r.queued ? t('Queued for {agent}.', { agent: r.label }) : t('Sent to {agent}.', { agent: r.label }) }) })
  const retry = (x) => act(x.key, async () => { const r = await api(`/chief/delegate/${encodeURIComponent(x.chief.task)}/retry`, { method: 'POST' }); onMsg?.({ text: r.helper?.error ? t("Couldn't start: {error}", { error: r.helper.error }) : r.helper?.state === 'queued' ? t('Queued: it starts when a helper finishes.') : t('Its helper is starting again.') }) })
  return (
    <>
      <div className="mt-summary md mt-items-head" dangerouslySetInnerHTML={{ __html: md(heading) }} />
      {data?.handOn?.run && <HandOn id={id} run={data.handOn.run} onMsg={onMsg} onDone={refresh} />}
      {!items ? <div className="mt-summary md" dangerouslySetInnerHTML={{ __html: md(fallback) }} /> : (
        <ul className="mt-items" aria-label={t('Action items')}>
          {items.map((x) => {
            const went = x.agent || x.chief || x.handed
            const ticked = x.key in ticks ? ticks[x.key] : !!(x.done || x.ticked)
            const done = x.key in ticks ? ticks[x.key] || (x.state === 'done' && !x.done) : x.state === 'done'
            const code = CODE.test(x.text)
            // With Chief of Staff, or where it put it: yours to take back or send elsewhere.
            const movable = !done && !x.agent && !!(x.chief || x.handed)
            const helper = x.chief?.helper
            const asked = x.handed?.to === 'ask' && x.chief?.status === 'waiting'
            return (
              <li key={x.key} className={`mt-item${done ? ' done' : ''}`} data-state={x.state} data-key={x.key}>
                <label className="mt-tick-hit"><input type="checkbox" className="mt-item-tick" checked={ticked} disabled={busy === x.key || (x.ticked && !x.done)} onChange={(e) => tick(x, e.target.checked)} aria-label={t('Done: {item}', { item: x.text })} /></label>
                <div className="mt-item-main">
                  <div className="mt-item-text md" dangerouslySetInnerHTML={{ __html: md(visible(x.text)) }} />
                  {went && <div className="mt-item-went"><WentTo x={x} /></div>}
                  {asked && <Answer id={id} x={x} onMsg={onMsg} onSent={refresh} />}
                  {x.handed?.held && x.handed.brief && (
                    <details className="mt-start-told mt-held-told">
                      <summary className="small">{t('What it will be told')}</summary>
                      <pre className="mt-held-brief">{x.handed.brief}</pre>
                    </details>
                  )}
                  {movable && moving !== x.key && (
                    <div className="mt-item-moves">
                      {x.handed?.held && <button type="button" className="btn small lead mt-approve" disabled={busy === x.key} onClick={() => approve(x)}><Icon name="send" size={12} /> {t('Send to {agent}', { agent: x.handed.label })}</button>}
                      {helper && helper.state === 'ended' && helper.end !== 'finished' && x.chief.status !== 'done' && <button type="button" className="btn small mt-retry" disabled={busy === x.key} onClick={() => retry(x)}><Icon name="refresh" size={12} /> {t('Try again')}</button>}
                      <button type="button" className="ghost-btn mt-undo" disabled={busy === x.key} onClick={() => undo(x)}><Icon name="undo" size={12} /> {t('Undo')}</button>
                      <button type="button" className="ghost-btn mt-redirect-btn" disabled={busy === x.key} onClick={() => setMoving(x.key)}><Icon name="repeat" size={12} /> {t('Redirect')}</button>
                    </div>
                  )}
                  {moving === x.key && <Redirect id={id} x={x} onMsg={onMsg} onCancel={() => setMoving(null)} onDone={() => { setMoving(null); refresh(); refetch(`/meetings/${encodeURIComponent(id)}`) }} />}
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
