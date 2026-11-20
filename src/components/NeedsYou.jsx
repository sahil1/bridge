import { useCallback, useEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import Question, { parseScreen } from './Question.jsx'
import { hostApi } from '../api.js'
import { ago } from './Machines.jsx'
import { t, tx } from '../i18n/index.js'
import { sentTo } from '../sendbox.js'
import { guardWhy } from './bots/access.js'
import { split, reason, isQuiet, activeAt, projectOf, QUIET_DAYS, TOP } from '../../shared/focus.js'
import { FileRow } from './bots/BotFiles.jsx'
import { where as placeIn } from './settings/search.js'
import './needsyou.css'

// The needs-you inbox: everything waiting on you, on this computer, your other devices and the
// cloud agents started from them (server/needsyou.js), in one list. Agents asking for permission or
// asking a question, failed runs and finished work, each answered right there: Yes or No, a reply,
// the question's full card, or open it. The top bar's needs-you chip opens it, and so does a phone
// notification about an agent that needs you.
//
// What needs you now first, by how much it holds up and how recently you or it were on it, the
// first few said with why; what has been quiet for days folded at the end by project, not counted
// (shared/focus.js has the rule, the same for Home, the chip, the badges and the window's title).
//
// The list comes from the device this page is served from (it knows where each device is); each
// answer goes to the device the agent is on, at /m/<id>/ through this one (server/machines.js).

const at = (machine) => (machine ? `/m/${encodeURIComponent(machine)}` : '')
export async function onDevice(machine, path, body) {
  const res = await fetch(`${at(machine)}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status })
  return data
}

const isAsk = (i) => i.type === 'permission' || i.type === 'question'
// What counts on the chip: what stops an agent until you answer, on a device that can hear you,
// and hasn't gone quiet. The device this window shows counts from its own live feed (here: its
// agents waiting, less quietPanes), which is quicker than the list; the others from the list.
export const waitingOn = (data, { here = 0, shown = null } = {}) => here + (data?.items || []).filter((i) => isAsk(i) && i.online && (i.machine || null) !== shown && !isQuiet(i)).length
// The agents waiting on the computer this window shows whose wait has gone quiet, by pane: its live
// feed knows they wait, the list knows they're quiet. One the list doesn't have yet counts.
export const quietPanes = (data, shown = null) => new Set((data?.items || []).filter((i) => isAsk(i) && (i.machine || null) === shown && isQuiet(i)).map((i) => i.paneId))

// The list, from the device this page comes from: every few seconds while it's open, less often
// otherwise, and straight away when this window's agents change.
export function useNeedsYou({ fleet, open = false, on = true }) {
  const [data, setData] = useState(null)
  // While it's open, the other devices are asked for their news more often (live).
  const openRef = useRef(open)
  openRef.current = open
  const load = useCallback((q = '') => hostApi(`/needs-you${q || (openRef.current ? '?live=1' : '')}`).then(setData).catch(() => {}), [])
  useEffect(() => {
    if (!on) return
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, open ? 3000 : 12000)
    const vis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis) }
  }, [load, open, on])
  const key = (fleet?.agents || []).map((a) => `${a.paneId}:${a.status}:${a.seq}`).join(',')
  useEffect(() => {
    if (!on || !fleet) return
    const id = setTimeout(load, 300)
    return () => clearTimeout(id)
  }, [key, on]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, refresh: load }
}

// The top bar's chip, for the computer this window shows: one computer's work at a time, so what
// waits on your others doesn't crowd it. count: what waits on you here; elsewhere: on your other
// devices, said on hover (and on the devices menu's chip), or quietly in its place when nothing
// here does; review: finished work here, quietly, when nothing waits on you at all.
export function NeedsYouChip({ count, elsewhere = 0, review = 0, onClick, open }) {
  if (!count && !elsewhere && !review) return null
  const label = count ? (count === 1 ? t('{n} needs you', { n: count }) : t('{n} need you', { n: count }))
    : elsewhere ? (elsewhere === 1 ? t('{n} needs you on another computer', { n: elsewhere }) : t('{n} need you on your other computers', { n: elsewhere })) : t('{n} to review', { n: review })
  const more = count && elsewhere ? ` ${elsewhere === 1 ? t('1 more on another computer.') : t('{n} more on your other computers.', { n: elsewhere })}` : ''
  return (
    <button type="button" className={`needs-chip ${count ? '' : 'quiet'} ${!count && elsewhere ? 'away' : ''}`} onClick={onClick} aria-haspopup="dialog" aria-expanded={!!open} aria-label={more ? `${label}.${more}` : label} title={`${count ? t('Waiting on you on this computer.') : t('Everything waiting on you')}${more}`}>
      <StatusDot status={count ? 'blocked' : elsewhere ? 'unknown' : 'done'} size={8} /> {count || elsewhere || review}<span className="needs-word"> {count ? (count === 1 ? t('needs you') : t('need you')) : elsewhere ? t('elsewhere') : t('to review')}</span>
    </button>
  )
}

const TYPE = {
  permission: { label: tx('Permission'), status: 'blocked' },
  question: { label: tx('Question'), status: 'blocked' },
  failed: { label: tx('Failed'), status: 'unknown' },
  review: { label: tx('Finished'), status: 'done' },
}
// Most urgent: what waits on you (asks and failed runs, in the order shared/focus.js gives them),
// then finished work to review, newest first.
const GROUPS = [['ask', tx('Waiting on you')], ['review', tx('To review')]]
const groupOf = (i) => (i.type === 'review' ? 'review' : 'ask')
const since = (i) => Date.parse(i.since || 0) || 0
const why = (r, device) => (r?.why === 'not-taken' ? t("That didn't take. Open it to answer.")
  : r?.why === 'changed' ? t("It isn't asking that any more.")
    : r?.status === 404 ? t('Update Bridge AI on {name} to answer from here.', { name: device })
      : r?.message || t("That didn't work. Open it to answer."))

// The question's own card (Question.jsx), read from the agent's screen wherever it is, for what a
// Yes or No can't answer: a menu of choices, an answer of your own, a review of several answers.
function LiveQuestion({ it, onDone }) {
  const [ansi, setAnsi] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => onDevice(it.machine, `/agents/${encodeURIComponent(it.paneId)}/screen?lines=60`).then((d) => setAnsi(d.ansi || ''), () => setAnsi('')), [it.machine, it.paneId])
  useEffect(() => { load(); const id = setInterval(load, 1200); return () => clearInterval(id) }, [load])
  if (ansi == null) return <div className="ny-live muted small">{t('Loading…')}</div>
  const q = parseScreen(ansi)
  if (!q) return <div className="ny-live muted small">{t('Nothing to pick here. Open it to answer.')}</div>
  const send = async (steps, picked) => {
    setBusy(true)
    const label = picked || steps.map((st) => st.text || (st.keys || []).map((k) => q.options.find((o) => o.n === k)?.label || k).join(' ')).join(', ')
    const expect = { title: q.title || '', ask: q.ask || [], options: q.options.map((o) => o.label), ...(q.arrows ? { at: q.at } : {}) }
    try { await onDevice(it.machine, `/panes/${encodeURIComponent(it.paneId)}/input`, { steps, expect, label }) } catch { /* the screen shows what happened */ }
    setTimeout(() => { load(); setBusy(false); onDone?.() }, 500)
  }
  return <div className="ny-live"><Question q={q} send={send} busy={busy} /></div>
}

// Why one of the first few is there (shared/focus.js reason): it stops an agent until you answer,
// and what of it was latest: you on it, in its project or space, a reply to a task, or that it's new
// (when its waiting is what's latest, its age on the line above says when).
export function Why({ it }) {
  const r = reason(it)
  const when = r.at ? ago(r.at) : ''
  const a = it.agent || {}
  const words = r.by === 'you' ? t('You were on this {when}', { when })
    : r.by === 'project' ? t('You were in {name} {when}', { name: a.project || a.workspace || a.title || t('its project'), when })
      : r.by === 'space' ? t('You were in {name} {when}', { name: a.workspace || a.project || a.title || t('its space'), when })
        : r.by === 'replied' ? t('You replied {when}', { when })
          : r.by === 'new' && r.at && Date.now() - Date.parse(r.at) < 36e5 ? t('New')
            : null
  if (!r.blocking && !words) return null
  return (
    <p className="ny-why">
      {r.blocking && <span className="ny-block" title={t('The agent has stopped until you answer')}>{t('Blocking')}</span>}
      {words && <span>{words}</span>}
    </p>
  )
}

// What has gone quiet (shared/focus.js): nothing on it from you or from it for 3 days or more. Not
// counted anywhere; folded here, under its project, at the end of what waits on you (the inbox,
// Home). Never dropped: a row opens to its card, to answer or open it as ever, and Clear takes an
// agent's off the list until it has something new (Clear all, asked once more, every one that can).
// card(it): the card a row opens to; uid(it): an item's id with its device's; focus: one to open to
// (a notification's).
export function QuietFold({ items, open, setOpen, card, uid, multi = false, onClearAll = null, focus = null }) {
  const [one, setOne] = useState(focus)
  const [sure, setSure] = useState(false)
  useEffect(() => { if (focus) { setOne(focus); setOpen(true) } }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null
  const groups = []
  for (const it of items) {
    const name = projectOf(it) ?? t('Chief of Staff')
    const g = groups.find((x) => x.name === name)
    if (g) g.rows.push(it)
    else groups.push({ name, rows: [it] })
  }
  const clearable = items.filter((i) => i.kind !== 'task' && i.online !== false && !i.old && i.seq != null)
  const row = (it) => {
    const id = uid(it)
    const on = one === id
    const task = it.kind === 'task'
    const ty = TYPE[it.type] || TYPE.question
    const title = task ? it.task.title : it.agent?.title || t('Agent')
    const sub = task ? it.task.needs || t('Waiting on you') : it.text || (it.type === 'failed' ? t('The run failed.') : t('Waiting on you. Open it to answer.'))
    const last = activeAt(it)
    return (
      <li key={id} className={`ny-qrow ${on ? 'open' : ''} ${it.online === false ? 'off' : ''}`}>
        <button type="button" className="ny-qmain" aria-expanded={on} onClick={() => setOne(on ? null : id)}>
          <span className="ny-qico">{task ? <Icon name="helm" size={12} /> : <StatusDot status={ty.status} size={8} />}</span>
          <span className="ny-qbody">
            <span className="ny-ql1"><b>{title}</b><span className="ny-qwhat">{task ? t('Chief of Staff task') : t(ty.label)}</span></span>
            <span className="ny-qsub">{sub}</span>
          </span>
          <span className="ny-qwhen">
            {multi && <span className="ny-qdev"><Icon name="laptop" size={10} />{it.device}</span>}
            {last > 0 && <time dateTime={new Date(last).toISOString()} title={t('Last active {when}', { when: new Date(last).toLocaleString() })}>{ago(new Date(last).toISOString())}</time>}
          </span>
        </button>
        {on && <div className="ny-qcard">{card(it)}</div>}
      </li>
    )
  }
  return (
    <section className="ny-quiet" aria-label={t('Quiet for {n}+ days', { n: QUIET_DAYS })}>
      <div className="ny-qhead">
        <button type="button" className="ny-fold" aria-expanded={open} onClick={() => { setOpen(!open); setSure(false) }}>
          <Icon name="chevron" size={12} />{t('Quiet for {n}+ days', { n: QUIET_DAYS })}<span className="fcount">{items.length}</span>
        </button>
        <span className="ny-qhint">{t('not counted: nothing new from you or them in {n} days', { n: QUIET_DAYS })}</span>
        {open && onClearAll && clearable.length > 0 && (sure
          ? <span className="ny-qsure">{t('Clear {n}? Each comes back when it has something new.', { n: clearable.length })}<button type="button" className="btn small" onClick={() => { setSure(false); onClearAll(clearable) }}><Icon name="check" size={12} /> {t('Clear')}</button><button type="button" className="ghost-btn" onClick={() => setSure(false)}>{t('Cancel')}</button></span>
          : <button type="button" className="ghost-btn ny-qclear" onClick={() => setSure(true)}><Icon name="check" size={12} /> {t('Clear all')}</button>)}
      </div>
      {open && groups.map((g) => (
        <div key={g.name} className="ny-qgroup">
          <h4><Icon name="folder" size={11} />{g.name}<span className="fcount">{g.rows.length}</span></h4>
          <ul className="ny-qlist">{g.rows.map(row)}</ul>
        </div>
      ))}
    </section>
  )
}

// One thing waiting, answered right there (the inbox, and Home: NeedsHome.jsx). pin: Home's Pin
// button, at the end of its top line. top: one of the first few that need you now, said with why;
// quiet: one in the quiet fold, which Clear can take off the list whatever it is.
export function NeedsItem({ it, focused, onOpen, onGone, setNote, pin = null, top = false, quiet = false }) {
  const [mode, setMode] = useState(focused && isAsk(it) && !it.answers?.length && !it.old ? 'live' : null) // 'reply' | 'live'
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: 'nearest' }) }, [focused])
  const off = !it.online
  const ty = TYPE[it.type] || TYPE.question
  const say = (r) => setNote({ id: it.id, text: why(r, it.device) })
  const answer = async (o) => {
    setBusy(true)
    try {
      const r = o.n === 'approve'
        ? await onDevice(it.machine, `/cloud/agents/${encodeURIComponent(it.paneId)}/approve`, {}).then(() => ({ ok: true }))
        : await onDevice(it.machine, '/needs-you/answer', { paneId: it.paneId, seq: it.seq, qid: it.qid, n: o.n })
      if (r.ok) onGone(it, t('Answered {answer}', { answer: o.title }))
      else say(r)
    } catch (e) { say(e) } finally { setBusy(false) }
  }
  const reply = async (e) => {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    setBusy(true)
    try {
      const r = await onDevice(it.machine, `/agents/${encodeURIComponent(it.paneId)}/prompt`, { text: v, typed: 'reply' })
      setText('')
      setMode(null)
      // In now, or held until it's free: as your computer answered.
      onGone(it, null)
      setNote({ text: sentTo(r, it.agent?.title || t('the agent')) })
    } catch (x) { say(x) } finally { setBusy(false) }
  }
  const clear = async () => {
    try { await onDevice(it.machine, '/needs-you/clear', { id: it.id }); onGone(it, null) } catch (x) { say(x) }
  }
  // A reply for what a message answers: a question in words (Codex's, a cloud agent's), a failed
  // run, finished work. A menu on the screen is answered with its own choices.
  const canReply = !off && it.type !== 'permission' && (!isAsk(it) || (!it.qid && !it.old))
  const a = it.agent || {}
  // The project, unless the agent is named as it is (a tab named after its folder): said once.
  const project = a.project && String(a.project).trim().toLowerCase() !== String(a.title || '').trim().toLowerCase() ? a.project : null
  const what = it.text || (it.type === 'review' ? null : it.type === 'failed' ? t('The run failed.') : t('Waiting on you. Open it to answer.'))
  return (
    <article ref={ref} className={`ny-item t-${it.type} ${off ? 'off' : ''} ${focused ? 'focus' : ''} ${top ? 'top' : ''}`} aria-label={`${t(ty.label)}: ${a.title}`}>
      <div className="ny-top">
        <StatusDot status={ty.status} size={8} />
        <span className="ny-kind">{it.limit ? t('Usage limit') : t(ty.label)}</span>
        <span className="ny-age" title={it.since ? new Date(it.since).toLocaleString() : ''}>{it.since ? ago(it.since) : ''}</span>
        <span className="ny-grow" />
        <span className={`ny-device ${it.machine ? '' : 'here'}`} title={off ? (it.asOf ? t('{name} is offline. As of {when}.', { name: it.device, when: ago(it.asOf) }) : t('{name} is offline', { name: it.device })) : t('On {name}', { name: it.device })}>
          <Icon name={a.cloud ? 'cloud' : 'laptop'} size={11} />{it.device}{off && <span className="ny-off"> · {t('offline')}</span>}
        </span>
        {pin}
      </div>
      {top && <Why it={it} />}
      {what && <p className={`ny-text ${it.type === 'review' ? 'said' : ''}`}>{what}</p>}
      {it.about && <code className="ny-about">{it.about}</code>}
      <div className="ny-meta">
        <b className="ny-agent">{a.chief && <Icon name="helm" size={11} />}{a.title}</b>
        {project && <span>{project}</span>}
        {a.branch && <span className="ny-branch"><Icon name="branch" size={10} />{a.branch}</span>}
        <span className="muted">{a.cloud ? t('{label} cloud', { label: a.cloud }) : a.kindLabel}{a.account ? ` · ${a.account}` : ''}</span>
      </div>
      <div className="ny-acts">
        {!off && it.answers?.map((o, i) => (
          <button key={o.n} type="button" className={`btn small ${i === 0 ? 'primary' : ''}`} disabled={busy} onClick={() => answer(o)}>{o.title}</button>
        ))}
        {!off && isAsk(it) && it.qid && !it.old && <button type="button" className="ghost-btn" aria-expanded={mode === 'live'} onClick={() => setMode(mode === 'live' ? null : 'live')}><Icon name="list" size={12} /> {it.answers?.length ? t('More answers…') : t('Answer here…')}</button>}
        {canReply && <button type="button" className="ghost-btn" aria-expanded={mode === 'reply'} onClick={() => setMode(mode === 'reply' ? null : 'reply')}><Icon name="chat" size={12} /> {t('Reply')}</button>}
        {it.pr && <a className="ghost-btn" href={it.pr} target="_blank" rel="noopener noreferrer"><Icon name="external" size={12} /> {t('Pull request')}</a>}
        <span className="ny-grow" />
        {!off && (it.type === 'review' || it.type === 'failed' || quiet) && !it.old && <button type="button" className="ghost-btn" onClick={clear} title={isAsk(it) ? t('Take it off the list until it has something new. The agent still waits, in the sidebar.') : t('Take it off the list until it has something new')}><Icon name="check" size={12} /> {t('Clear')}</button>}
        <button type="button" className="ghost-btn strong" onClick={() => onOpen(it)} disabled={off}><Icon name="open" size={12} /> {t('Open')}</button>
      </div>
      {mode === 'reply' && (
        <form className="ny-reply" onSubmit={reply}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Reply to {name}…', { name: a.title })} aria-label={t('Reply to {name}', { name: a.title })} disabled={busy} />
          <button type="submit" className="btn small primary" disabled={busy || !text.trim()}><Icon name="send" size={12} /> {t('Send')}</button>
        </form>
      )}
      {mode === 'live' && !off && <LiveQuestion it={it} onDone={() => onGone(it, null, true)} />}
    </article>
  )
}

// What another app asks of you through Bridge AI's MCP server (server/outside.js): a change it
// suggests to a whiteboard or a file, to keep or discard, or a message for one of your agents, to
// send or not. Its own words (its summary, the change, the message) are shown as they came, as
// what it wants, never as Bridge AI's. Nothing happens until you press Keep or Send.
function OutsideChange({ it }) {
  const c = it.change || {}
  if (it.kind === 'send') return <pre className="ny-change">{c.message}</pre>
  if (c.diagram != null) {
    return (
      <details className="ny-change-wrap">
        <summary>{c.mode === 'replace' ? t('In place of what\'s on the board: a {format} diagram', { format: c.format }) : t('Beside what\'s on the board: a {format} diagram', { format: c.format })}</summary>
        <pre className="ny-change">{c.diagram}</pre>
      </details>
    )
  }
  if (c.edits) {
    return (
      <ul className="ny-edits">
        {c.edits.map((e, i) => <li key={i}><del>{e.find}</del><ins>{e.replace || t('(taken out)')}</ins></li>)}
        {c.more > 0 && <li className="muted small">{t('and {n} more', { n: c.more })}</li>}
      </ul>
    )
  }
  return (
    <details className="ny-change-wrap">
      <summary>{t('Its whole new text')}</summary>
      <pre className="ny-change">{c.text}{c.cut ? '\n…' : ''}</pre>
    </details>
  )
}
export function OutsideItem({ it, onDone, setNote }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(it.problem || null)
  const app = it.client?.name || t('Another app')
  const send = it.kind === 'send'
  const decide = async (yes) => {
    setBusy(true)
    try {
      const r = await onDevice(null, `/outside/${encodeURIComponent(it.id)}`, { yes })
      onDone(it)
      setNote({ text: r.item?.note || (yes ? (send ? t('Sent') : t('Kept')) : (send ? t('Not sent') : t('Discarded'))) })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  const what = send ? t('{app} asks to send this to {agent}', { app, agent: it.target?.name || t('an agent') })
    : it.target?.type === 'board' ? t('{app} suggests a change to {what}', { app, what: it.target.name })
      : t('{app} suggests a change to {name} in {place}', { app, name: it.target?.name, place: it.target?.where })
  return (
    <article className={`ny-item t-outside ${send ? 'send' : ''}`} aria-label={what}>
      <div className="ny-top">
        <Icon name={send ? 'send' : 'edit'} size={12} />
        <span className="ny-kind">{send ? t('Send to an agent') : t('Suggested change')}</span>
        <span className="ny-age" title={new Date(it.at).toLocaleString()}>{ago(it.at)}</span>
        <span className="ny-grow" />
        <span className="ny-device here" title={t('Through Bridge AI as an MCP Server ({place})', { place: placeIn('mcp') })}><Icon name="link" size={11} />{app}</span>
      </div>
      <p className="ny-text">{what}{send && it.target?.folder ? ` (${it.target.folder})` : ''}.</p>
      {!send && it.summary && <p className="ny-said">“{it.summary}”</p>}
      <OutsideChange it={it} />
      {problem && <p className="ny-problem" role="alert"><Icon name="alert" size={12} />{problem}</p>}
      <div className="ny-acts">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => decide(true)}><Icon name={send ? 'send' : 'check'} size={12} /> {send ? t('Send') : t('Keep')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => decide(false)}>{send ? t('Don\'t send') : t('Discard')}</button>
        {send && <span className="muted small ny-warn">{t('The agent runs commands on this computer.')}</span>}
      </div>
    </article>
  )
}

// A question put to one of your bots (server/frontdesk.js): the answer an agent drafted, to edit,
// then send or discard; or one nothing could answer, its reply empty for you to write (the asker was
// told it's passed on). The question, and what came after it in the thread while it was answered,
// are the askers' words, shown as theirs; nothing goes to Slack until you press Send. With it: the
// files the answer sends back, why an answer that would have gone without asking waits (it quotes a
// file in a public channel), and a change it made: the diff to approve before a draft pull request
// opens, or the pull request opened already. The same draft is in your Slack direct messages when
// you set You in Slack; whichever you answer first, the other is settled.
// A run at its time limit is a card of its own (LimitItem); one stopped there for want of your
// answer is a draft to write, with Continue as well, for a day.
const sizeOf = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const whereOf = (it) => (it.place?.kind === 'dm' ? t('in a direct message') : it.place?.name ? t('in #{channel}', { channel: it.place.name }) : t('in a channel'))
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
// A request to a bot that changes files, held before it started, is a card of its own (ScreenItem);
// a change to files with a draft shows in it, with Approve and Send or Deny while it waits, and Undo
// once it's made.
export function SlackItem(props) {
  return props.it.kind === 'push' ? <PushItem {...props} /> : props.it.kind === 'share' ? <ShareItem {...props} /> : props.it.state === 'screened' ? <ScreenItem {...props} /> : props.it.limit?.phase === 'asking' ? <LimitItem {...props} /> : <DraftItem {...props} />
}

// The bot a card is from, which opens its session (Bots › Sessions) or, with none, its page; in the
// session's own Thread, just its name.
function BotLink({ it, bot }) {
  const sid = it.session?.id || (typeof it.session === 'string' ? it.session : null) || it.sid || null
  if (it.inSession) return null
  if (!sid && !it.bot?.id) return <span className="ny-device here"><Icon name="chat" size={11} />{bot}</span>
  const open = () => window.dispatchEvent(sid ? new CustomEvent('bridge-open-bots', { detail: { session: sid } }) : new CustomEvent('bridge-open-bot', { detail: { id: it.bot.id } }))
  return <button type="button" className="ny-device here ny-bot-link" onClick={open} title={sid ? t('Open its session') : t('Open {bot}', { bot })}><Icon name="chat" size={11} />{bot}</button>
}

// A bot's session asking to push its work (server/sessionmcp.js request_push): what it would push,
// and Approve (Bridge AI pushes a branch and opens a draft pull request with your gh; never a
// merge) or Deny (it's told). Nothing leaves this computer until you approve.
export function PushItem({ it, onDone, setNote }) {
  const who = it.from?.name || t('Someone')
  const bot = it.bot?.name || t('Your bot')
  const p = it.push || {}
  return (
    <article className="ny-item t-slack t-push yours" aria-label={t('{bot} asks to push its work {where}', { bot, where: whereOf(it) })} data-setting="ny-push">
      <div className="ny-top">
        <Icon name="branch" size={12} />
        <span className="ny-kind">{t('A push to approve')}</span>
        <span className="ny-age" title={new Date(p.at || it.at).toLocaleString()}>{ago(p.at || it.at)}</span>
        <span className="ny-grow" />
        <BotLink it={it} bot={bot} />
      </div>
      <p className="ny-text">{t('{bot} asks to push its work for {name} {where}:', { bot, name: who, where: whereOf(it) })}</p>
      <PushOf it={it} onDone={onDone} setNote={setNote} />
    </article>
  )
}
// What a push would send, and Approve (by the head it would push: a branch that moved on is shown
// again) or Deny: a card of its own, or part of a draft that waits too.
function PushOf({ it, onDone, setNote }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const p = it.push || {}
  const bot = it.bot?.name || t('Your bot')
  const go = async (approve) => {
    setBusy(true)
    setProblem(null)
    try {
      const out = await onDevice(null, `/bots/questions/${encodeURIComponent(it.id)}/push`, approve ? { act: 'approve', hash: p.head || p.hash || null } : { act: 'deny' })
      onDone(it)
      setNote({ text: out.already ? t('That isn\'t waiting any more') : approve ? t('Approved: Bridge AI pushes it and opens a draft pull request with your gh.') : t('Denied: nothing is pushed, and {bot} is told.', { bot }) })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  const files = Array.isArray(p.files) ? p.files.map((f) => f.path || f).filter(Boolean) : []
  return (
    <div className="ny-push" data-setting="ny-push-of">
      {p.title && <p className="ny-said">“{p.title}”</p>}
      {p.summary && <p className="muted small ny-from">{p.summary}</p>}
      {p.branch && <p className="muted small ny-from mono"><Icon name="branch" size={11} /> {p.branch}</p>}
      {p.stat ? <p className="muted small ny-from mono">{p.stat}</p> : files.length > 0 && <p className="muted small ny-from mono">{files.slice(0, 6).join(', ')}{files.length > 6 ? ` ${t('and {n} more', { n: files.length - 6 })}` : ''}</p>}
      {p.diff && <pre className="ny-change" aria-label={t('The diff')}>{p.diff}</pre>}
      <p className="muted small ny-from"><Icon name="info" size={11} /> {t('Approve, and Bridge AI pushes a branch and opens a draft pull request with your gh. It never merges.')}</p>
      {problem && <p className="ny-problem" role="alert"><Icon name="alert" size={12} />{problem}</p>}
      <div className="ny-acts">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => go(true)}><Icon name="check" size={12} /> {t('Approve the push')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => go(false)}><Icon name="x" size={12} /> {t('Deny')}</button>
      </div>
    </div>
  )
}

// A bot's session asking to share a file or folder with a Share Link for someone else
// (server/sessionmcp.js share_link, frontdesk.js shareAct): what, from where, for whom and for how
// long, and Approve (the link is made and posted where it was asked) or Deny (they're told).
export function ShareItem({ it, onDone, setNote }) {
  const who = it.from?.name || t('Someone')
  const bot = it.bot?.name || t('Your bot')
  const sh = it.share || {}
  return (
    <article className="ny-item t-slack t-share yours" aria-label={t('{bot} asks to share a link {where}', { bot, where: whereOf(it) })} data-setting="ny-share">
      <div className="ny-top">
        <Icon name="link" size={12} />
        <span className="ny-kind">{t('A link to approve')}</span>
        <span className="ny-age" title={new Date(sh.at || it.at).toLocaleString()}>{ago(sh.at || it.at)}</span>
        <span className="ny-grow" />
        <BotLink it={it} bot={bot} />
      </div>
      <p className="ny-text">{t('{bot} asks to share a link for {name} {where}:', { bot, name: who, where: whereOf(it) })}</p>
      <ShareOf it={it} onDone={onDone} setNote={setNote} />
    </article>
  )
}
function ShareOf({ it, onDone, setNote }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const sh = it.share || {}
  const bot = it.bot?.name || t('Your bot')
  const lasts = sh.lasts === 'hour' ? t('an hour') : sh.lasts === 'week' ? t('a week') : t('a day')
  const go = async (approve) => {
    setBusy(true)
    setProblem(null)
    try {
      const out = await onDevice(null, `/bots/questions/${encodeURIComponent(it.id)}/share`, approve ? { act: 'approve', code: sh.code || null } : { act: 'deny' })
      onDone(it)
      setNote({ text: out.already ? t('That isn\'t waiting any more') : approve ? t('Shared: the link is posted where it was asked.') : t('Denied: nothing is shared, and {bot} is told.', { bot }) })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="ny-push" data-setting="ny-share-of">
      <p className="ny-said">“{sh.title}”</p>
      <p className="muted small ny-from mono"><Icon name={sh.kind === 'folder' ? 'folder' : 'file'} size={11} /> {sh.from}</p>
      <p className="muted small ny-from">{t('For {who}, for {lasts}', { who: sh.whoSaid || '', lasts })}{sh.mode === 'link' ? ` ${t('(with a password, sent to each of them)')}` : ''}</p>
      <p className="muted small ny-from"><Icon name="info" size={11} /> {t('Approve, and Bridge AI makes an end-to-end encrypted link through your relay and posts it where it was asked. Stop it any time in {place}.', { place: placeIn('sharing') })}</p>
      {problem && <p className="ny-problem" role="alert"><Icon name="alert" size={12} />{problem}</p>}
      <div className="ny-acts">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => go(true)}><Icon name="check" size={12} /> {t('Approve the link')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => go(false)}><Icon name="x" size={12} /> {t('Deny')}</button>
      </div>
    </div>
  )
}

// A request held before it started (server/frontdesk.js screenAct): who asked, where and what, why it
// was held, and Allow Once (it goes ahead, under every limit as always) or Deny (they're told).
function ScreenItem({ it, onDone, setNote }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const who = it.from?.name || t('Someone')
  const bot = it.bot?.name || t('Your bot')
  const go = async (allow) => {
    setBusy(true)
    setProblem(null)
    try {
      const out = await onDevice(null, `/bots/questions/${encodeURIComponent(it.id)}/screen`, { allow })
      onDone(it)
      setNote({ text: out.already ? t('That isn\'t waiting any more') : allow ? t('{bot} goes ahead with it, once', { bot }) : t('Denied: {name} is told', { name: who }) })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  return (
    <article className="ny-item t-slack t-screen yours" aria-label={t('{name} asked {bot} {where}, held for you', { name: who, bot, where: whereOf(it) })}>
      <div className="ny-top">
        <Icon name="alert" size={12} />
        <span className="ny-kind">{t('Held before it started')}</span>
        <span className="ny-age" title={new Date(it.at).toLocaleString()}>{ago(it.at)}</span>
        <span className="ny-grow" />
        <BotLink it={it} bot={bot} />
      </div>
      <p className="ny-text">{t('{name} asked {where}:', { name: who, where: whereOf(it) })}</p>
      <p className="ny-said">“{it.text}”</p>
      {(it.more || []).map((m, i) => <p key={i} className="ny-said ny-more"><span className="muted small">{t('Then {name}:', { name: m.from?.name || t('Someone') })}</span> “{m.text}”</p>)}
      <p className="muted small ny-from"><Icon name="info" size={11} /> {t('It wasn\'t started, as {why}. Allow it once to let it go ahead: every limit still holds, and a change still shows you its diff.', { why: it.screen?.why || t('it looks odd') })}</p>
      {problem && <p className="ny-problem" role="alert"><Icon name="alert" size={12} />{problem}</p>}
      <div className="ny-acts">
        <button type="button" className="btn small" disabled={busy} onClick={() => go(true)}><Icon name="play" size={12} /> {t('Allow Once')}</button>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => go(false)}><Icon name="x" size={12} /> {t('Deny')}</button>
      </div>
    </article>
  )
}

// A change to files with a draft: what it changes, who asked, why it waits for you whoever asks, and
// its diff; made already, Undo.
// (whole: the whole diff, fetched when the record's is its start: a change waiting is approved only
// once all of it is shown.)
function WriteOf({ it, onUndo, busy, whole = null, onMore = null }) {
  const w = it.write
  if (!w) return null
  const files = (w.files || []).map((f) => `${f.path}${f.op === 'add' ? ` (${t('new')})` : f.op === 'remove' ? ` (${t('deleted')})` : f.op === 'move' ? ` (${t('moved from {from}', { from: f.from })})` : ''}`)
  const line = w.state === 'waiting' ? t('It changed {files} in its copy. Approve it, and Bridge AI makes the change, then sends the reply.', { files: files.join(', ') })
    : w.state === 'applied' ? t('It changed {files}, without asking you.', { files: files.join(', ') })
      : w.state === 'refused' ? (w.guard ? t('The folder guard didn\'t run, so nothing was changed: {why}', { why: guardWhy(w.guard) }) : t('Its change was refused, so nothing was changed.'))
        : w.state === 'undone' ? t('Its change was undone.') : w.state === 'failed' ? t('Its change couldn\'t be made: {why}', { why: w.error || '' }) : null
  return (
    <div className="ny-write" data-setting="ny-write">
      {line && <p className="muted small ny-from"><Icon name="file" size={11} /> {line}</p>}
      {(w.held || []).map((h) => <p key={h.why} className="muted small ny-from ny-held"><Icon name="alert" size={11} /> {t('It waits for you whoever asks: {why}', { why: h.said })}</p>)}
      {(w.refused || []).slice(0, 5).map((r, i) => <p key={i} className="muted small ny-from ny-held"><Icon name="alert" size={11} /> {r.file}: {r.said}</p>)}
      {w.diff && <pre className="ny-change" aria-label={t('The diff')}>{whole ?? w.diff}</pre>}
      {w.diffCut && whole == null && onMore && <div className="ny-acts"><button type="button" className="btn small" onClick={onMore}><Icon name="file" size={12} /> {t('Show the whole diff')}</button></div>}
      {w.state === 'applied' && onUndo && <div className="ny-acts"><button type="button" className="btn small" disabled={busy} onClick={onUndo}><Icon name="undo" size={12} /> {t('Undo the change')}</button></div>}
    </div>
  )
}

// Continue or Stop, for a run at its time limit (server/frontdesk.js limitAct): on the computer it
// runs on, or from the phone through it. { item, said, already } back.
function useLimitAct(it, onDone, setNote) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const go = async (act, minutes = null) => {
    setBusy(true)
    setProblem(null)
    try {
      const out = await onDevice(null, `/bots/questions/${encodeURIComponent(it.id)}/limit`, { act, ...(minutes ? { minutes } : {}) })
      onDone(it)
      const bot = it.bot?.name || t('Your bot')
      const who = it.from?.name || t('Someone')
      setNote({ text: out.already ? t('That isn\'t waiting any more') : act === 'stop' ? t('Stopped: {name} is told it\'s passed on to you', { name: who }) : t('{bot} carries on for {n} more minutes', { bot, n: out.given ?? minutes }) })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  return { busy, problem, go }
}

// A run at its time limit, going on while you decide: how long it has run and what it's doing, the
// question, until when it goes on, and Continue (10 or 30 more minutes, fewer near its Longest Run)
// or Stop. Also in your direct messages on the platform it was asked on; whichever you answer first,
// the other is settled.
function LimitItem({ it, onDone, setNote }) {
  const { busy, problem, go } = useLimitAct(it, onDone, setNote)
  const l = it.limit
  const who = it.from?.name || t('Someone')
  const bot = it.bot?.name || t('Your bot')
  const ran = l.ran === 1 ? t('1 minute') : t('{n} minutes', { n: l.ran })
  return (
    <article className="ny-item t-slack t-limit yours" aria-label={t('{bot}\'s answer to {name} {where} has run {ran}', { bot, name: who, where: whereOf(it), ran })}>
      <div className="ny-top">
        <Icon name="clock" size={12} />
        <span className="ny-kind">{t('At its time limit')}</span>
        <span className="ny-age" title={new Date(l.at).toLocaleString()}>{ago(l.at)}</span>
        <span className="ny-grow" />
        <BotLink it={it} bot={bot} />
      </div>
      <p className="ny-text">{t('{bot}\'s answer to {name} {where} has run {ran}: {doing}.', { bot, name: who, where: whereOf(it), ran, doing: l.doing || t('still working') })}</p>
      <p className="ny-said">“{it.text}”</p>
      <p className="muted small ny-from"><Icon name="clock" size={11} /> {t('With no answer from you it carries on, up to its Longest Run of {longest} minutes.', { longest: l.longest || 240 })}</p>
      {l.left < 30 && <p className="muted small ny-from">{t('At most {n} more minutes: its Longest Run is {longest} minutes.', { n: l.left, longest: l.longest })}</p>}
      {problem && <p className="ny-problem" role="alert"><Icon name="alert" size={12} />{problem}</p>}
      <div className="ny-acts">
        {(l.choices || []).map((n, i) => <button key={n} type="button" className={`btn small ${i === 0 ? 'primary' : ''}`} disabled={busy} onClick={() => go('continue', n)}><Icon name="play" size={12} /> {t('Continue {n} more minutes', { n })}</button>)}
        {!(l.choices || []).length && <button type="button" className="btn small primary" disabled={busy} onClick={() => go('continue')}><Icon name="play" size={12} /> {t('Carry on')}</button>}
        <button type="button" className="btn small" disabled={busy} onClick={() => go('stop')}><Icon name="stop" size={12} /> {t('Stop')}</button>
      </div>
    </article>
  )
}

function DraftItem({ it, onDone, setNote }) {
  const [text, setText] = useState(it.draft || '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(it.problem || null)
  const limit = useLimitAct(it, onDone, setNote)
  const who = it.from?.name || t('Someone')
  const where = whereOf(it)
  const r = it.route
  const bot = it.bot?.name || t('Your bot')
  const change = it.change || null
  const approve = change?.mode === 'suggest' && !change.pr?.url
  // (A change to files waiting on you: Send approves that change, named by its hash, and Discard denies
  // it. One whose diff here is cut short has the whole of it fetched, and is approved only once it's
  // shown.)
  const writes = it.write?.state === 'waiting'
  const [whole, setWhole] = useState(null)
  const more = () => onDevice(null, `/bots/${encodeURIComponent(it.bot?.id || '')}/writes/${encodeURIComponent(it.write.id)}`).then((r) => setWhole(r.write?.diff ?? ''), (e) => setProblem(e.message))
  useEffect(() => { if (writes && it.write.diffCut && whole == null) more() }, [writes, it.write?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const unseen = writes && it.write.diffCut && whole == null
  const from = it.needsOwner ? t('Nothing could answer it: {why}. {name} was told it\'s passed on to you.', { why: it.why || '', name: who })
    : r?.to === 'agent' ? t('Answered by a read-only copy of {agent}\'s conversation.', { agent: r.name })
      : r?.to === 'throwaway' ? t('{bot} answered from what it knows: it reads no folders.', { bot })
        : it.sources?.length ? t('{bot} answered from {files}.', { bot, files: it.sources.slice(0, 4).join(', ') }) : t('{bot} answered from the folders it reads.', { bot })
  const decide = async (send) => {
    setBusy(true)
    setProblem(null)
    try {
      const out = await onDevice(null, `/bots/questions/${encodeURIComponent(it.id)}`, { send, text, ...(writes ? { write: { id: it.write.id, hash: it.write.hash } } : {}) })
      if (out.item?.state === 'draft') { setProblem(out.item.problem || null); return }
      onDone(it)
      setNote({ text: writes ? (send ? t('Approved: the change is made, and the reply is on its way to {name}', { name: who }) : t('Denied: nothing was changed, and {name} is told', { name: who })) : !send ? t('Discarded: nothing sent') : out.item?.state === 'sent' ? t('Sent to {name} in Slack', { name: who }) : t('Sending to Slack: {why}', { why: out.item?.problem || t('in a moment') }) })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  const undo = async () => {
    setBusy(true)
    setProblem(null)
    try {
      await onDevice(null, `/bots/${encodeURIComponent(it.bot?.id || '')}/writes/${encodeURIComponent(it.write.id)}/undo`, {})
      setNote({ text: t('Undone: the files are back as they were.') })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  return (
    <article className={`ny-item t-slack ${it.needsOwner ? 'yours' : ''}`} aria-label={t('{name} asked {where}', { name: who, where })}>
      <div className="ny-top">
        <Icon name="chat" size={12} />
        <span className="ny-kind">{it.needsOwner ? t('Needs your reply') : writes ? t('A change to approve') : t('Answer to check')}</span>
        <span className="ny-age" title={new Date(it.at).toLocaleString()}>{ago(it.at)}</span>
        <span className="ny-grow" />
        <BotLink it={it} bot={bot} />
      </div>
      <p className="ny-text">{t('{name} asked {where}', { name: who, where })}{it.late ? ` ${t('(while Bridge AI was away)')}` : ''}:</p>
      <p className="ny-said">“{it.text}”</p>
      {(it.more || []).map((m, i) => <p key={i} className="ny-said ny-more"><span className="muted small">{t('Then {name}:', { name: m.from?.name || t('Someone') })}</span> “{m.text}”</p>)}
      <p className="muted small ny-from">{from}</p>
      {it.warn && <p className="muted small ny-from"><Icon name="info" size={11} /> {it.warn}</p>}
      {it.files?.length > 0 && <p className="muted small ny-from"><Icon name="paperclip" size={11} /> {t('With {files}', { files: it.files.map((f) => `${f.name}${f.size != null ? ` (${sizeOf(f.size)})` : ''}`).join(', ') })}</p>}
      {it.files?.some((f) => f.from && f.kept) && (
        <div className="ny-attached" data-setting="ny-attached">
          <p className="muted small">{t('From its folders, to look at before it goes:')}</p>
          <ul className="bf-list">{it.files.filter((f) => f.from && f.kept).map((f) => <FileRow key={f.kept} bot={it.bot?.id} f={{ name: f.name, size: f.size, path: f.kept, from: f.from }} send={false} />)}</ul>
        </div>
      )}
      {change && (
        <>
          <p className="muted small ny-from"><Icon name="branch" size={11} /> {change.pr?.url ? t('A draft pull request opened on {branch}:', { branch: change.branch || '' }) : approve ? t('It made a change on {branch}: approve the diff, and a draft pull request opens.', { branch: change.branch || '' }) : t('It made a change on {branch}.', { branch: change.branch || '' })}{change.pr?.url && <> <a href={change.pr.url} target="_blank" rel="noreferrer">{change.pr.url}</a></>}</p>
          {change.stat && <p className="muted small ny-from mono">{change.stat}</p>}
          {change.diff && <pre className="ny-change" aria-label={t('The diff')}>{change.diff}</pre>}
        </>
      )}
      <WriteOf it={it} onUndo={undo} busy={busy} whole={whole} onMore={more} />
      {it.push?.state === 'waiting' && <PushOf it={it} onDone={onDone} setNote={setNote} />}
      {it.share?.state === 'waiting' && <ShareOf it={it} onDone={onDone} setNote={setNote} />}
      {it.ownerAsked && <p className="muted small ny-from"><Icon name="chat" size={11} /> {t('Also in your Slack direct messages: answer it there or here.')}</p>}
      <textarea className="ny-draft" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(8, Math.max(3, text.split('\n').length + 1))} placeholder={t('Write the reply…')} aria-label={t('Reply to {name}', { name: who })} disabled={busy || limit.busy} />
      {(problem || limit.problem) && <p className="ny-problem" role="alert"><Icon name="alert" size={12} />{problem || limit.problem}</p>}
      <div className="ny-acts">
        <button type="button" className="btn small primary" disabled={busy || limit.busy || !text.trim() || unseen} onClick={() => decide(true)}><Icon name={approve ? 'branch' : writes ? 'check' : 'send'} size={12} /> {busy ? t('Sending…') : approve ? t('Approve and open a pull request') : writes ? t('Approve and Send') : t('Send')}</button>
        <button type="button" className="btn small" disabled={busy || limit.busy} onClick={() => decide(false)}>{writes ? t('Deny') : t('Discard')}</button>
      </div>
      {it.limit?.phase === 'stopped' && (
        <div className="ny-limit">
          <p className="muted small ny-from"><Icon name="clock" size={11} /> {(it.limit.how === 'session' ? t('Or let it carry on: Continue picks it up where it stopped, until {time} tomorrow.', { time: timeOf(it.limit.until) })
            : it.limit.how === 'messages' ? t('Or let it carry on: Continue starts it again with what it had so far, until {time} tomorrow.', { time: timeOf(it.limit.until) })
              : t('Or let it carry on: Continue starts it again from the question (what it did couldn\'t be kept), until {time} tomorrow.', { time: timeOf(it.limit.until) }))}</p>
          <div className="ny-acts">
            {(it.limit.choices || []).map((n) => <button key={n} type="button" className="btn small" disabled={busy || limit.busy} onClick={() => limit.go('continue', n)}><Icon name="play" size={12} /> {t('Continue {n} more minutes', { n })}</button>)}
          </div>
        </div>
      )}
    </article>
  )
}

// A phone or computer paired once Remote Access had a guardrail, waiting to be let in here (Which
// Devices May Connect, server/remote.js): until then it can't use this computer at all. Allow lets
// it in; Keep Out leaves it out, and not New any more (Settings › Remote Access changes either).
// Only in this computer's own window, where it's changed.
// A bot that stopped reading one of its folders, which leads somewhere else now than when it was
// picked (a link changed): Keep reading it where it leads now, or Stop reading it.
export function FolderItem({ it, onDone, setNote }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const bot = it.bot?.name || t('Your bot')
  const decide = async (keep) => {
    setBusy(true)
    setProblem(null)
    try {
      await onDevice(null, `/bots/${encodeURIComponent(it.bot.id)}/settings`, keep ? { keepFolder: it.folder, keepAt: it.leadsTo } : { stopFolder: it.folder })
      onDone(it)
      setNote({ text: keep ? t('{bot} reads {folder} again, where it leads now', { bot, folder: it.folder }) : t('{bot} doesn\'t read {folder} any more', { bot, folder: it.folder }) })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  return (
    <article className="ny-item t-folder" data-folder={it.folder} aria-label={t('{bot} stopped reading {folder}', { bot, folder: it.folder })}>
      <div className="ny-top">
        <Icon name="folder" size={12} />
        <span className="ny-kind">{t('Folder not read')}</span>
        {it.since && <span className="ny-age" title={new Date(it.since).toLocaleString()}>{ago(it.since)}</span>}
        <span className="ny-grow" />
        <BotLink it={it} bot={bot} />
      </div>
      <p className="ny-text">{it.was
        ? t('{bot} stopped reading {folder}: it leads to {now} now, not {was} as when you picked it. It reads it again only if you say so.', { bot, folder: it.folder, now: it.leadsTo, was: it.was })
        : t('{bot} stopped reading {folder}: it leads to {now}, not where its name says. It reads it only if you say so.', { bot, folder: it.folder, now: it.leadsTo })}</p>
      {problem && <p className="ny-problem" role="alert"><Icon name="alert" size={12} />{problem}</p>}
      <div className="ny-acts">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => decide(true)}><Icon name="check" size={12} /> {t('Keep reading it')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => decide(false)}>{t('Stop reading it')}</button>
      </div>
    </article>
  )
}

export function LetInItem({ it, onDone, setNote }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const kind = it.kind === 'computer' ? t('computer') : t('phone')
  const decide = async (allowed) => {
    setBusy(true)
    setProblem(null)
    try {
      await onDevice(null, '/remote/devices', { id: it.id, allowed })
      onDone(it)
      setNote({ text: allowed ? t('{name} may use this computer now', { name: it.name }) : t('{name} stays out. {place} lets it in later.', { place: placeIn('remote-devices'), name: it.name }) })
    } catch (e) { setProblem(e.message) } finally { setBusy(false) }
  }
  return (
    <article className="ny-item t-letin" aria-label={t('{name} waits to be let in', { name: it.name })}>
      <div className="ny-top">
        <Icon name={it.kind === 'computer' ? 'laptop' : 'phone'} size={12} />
        <span className="ny-kind">{t('New device')}</span>
        {it.paired && <span className="ny-age" title={new Date(it.paired).toLocaleString()}>{ago(it.paired)}</span>}
        <span className="ny-grow" />
        <span className="ny-device here" title={placeIn('remote-devices')}><Icon name="lock" size={11} />{t('Remote Access')}</span>
      </div>
      <p className="ny-text">{it.through
        ? t('{name} ({kind}) comes through {computer} and waits to be let in here. Until you allow it, it can\'t use this computer at all.', { name: it.name, kind, computer: it.through })
        : t('{name} ({kind}) is paired with this computer and waits to be let in. Until you allow it, it can\'t use this computer at all.', { name: it.name, kind })}</p>
      {it.tried && <p className="muted small ny-from">{t('Last tried to connect: {when}.', { when: ago(it.tried) })}</p>}
      {problem && <p className="ny-problem" role="alert"><Icon name="alert" size={12} />{problem}</p>}
      <div className="ny-acts">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => decide(true)}><Icon name="check" size={12} /> {t('Allow')}</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => decide(false)}>{t('Keep Out')}</button>
      </div>
    </article>
  )
}

// The inbox itself: a panel under the chip on a computer, the whole screen on a phone.
// focus: { paneId, machine } to show first (from a notification).
export function NeedsYouPanel({ data, refresh, phone = false, focus = null, onClose, onOpen }) {
  const [by, setBy] = useState(() => { try { return localStorage.getItem('cc-needs-sort') || 'urgent' } catch { return 'urgent' } })
  const [device, setDevice] = useState('all')
  const [gone, setGone] = useState({}) // item id -> when it was answered here (hidden until the list catches up)
  const [note, setNote] = useState(null) // { id, text } or { text }
  const [sure, setSure] = useState(false) // Yes to all, asked once more
  const [busy, setBusy] = useState(false)
  const [quietOpen, setQuietOpen] = useState(false) // what has gone quiet, unfolded
  const box = useRef(null)
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose() }
    const down = (e) => { if (!phone && box.current && !box.current.contains(e.target) && !e.target.closest?.('.needs-chip')) onClose() }
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', down)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', down) }
  }, [onClose, phone])
  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 6000); return () => clearTimeout(id) }, [note])
  const pickSort = (v) => { setBy(v); try { localStorage.setItem('cc-needs-sort', v) } catch { /* no storage */ } }
  // An item by its device and its id: each device numbers its own panes, so two can have the same.
  const uid = (i) => `${i.machine || 'here'}|${i.id}`
  const all = (data?.items || []).filter((i) => !gone[uid(i)])
  const devices = (data?.devices || []).filter((d) => all.some((i) => (i.machine || null) === d.id))
  // What needs you now (ranked, or newest first) and what has gone quiet, folded at the end; the
  // first few of what waits on you said with why.
  const { now: live, quiet } = split(device === 'all' ? all : all.filter((i) => (i.machine || 'here') === device))
  const items = by === 'newest' ? [...live].sort((x, y) => since(y) - since(x)) : [...live.filter((i) => groupOf(i) === 'ask'), ...live.filter((i) => groupOf(i) === 'review').sort((x, y) => since(y) - since(x))]
  const top = new Set(live.filter((i) => groupOf(i) === 'ask').slice(0, TOP).map(uid))
  // Answered: off the list here at once, and the device it's on asked again as it moves on.
  const onGone = (it, said, soft = false) => {
    if (!soft) setGone((g) => ({ ...g, [uid(it)]: Date.now() }))
    if (said) setNote({ text: `${said} · ${it.agent?.title || ''}` })
    const q = it.machine ? `?fresh=${encodeURIComponent(it.machine)}` : ''
    for (const ms of [0, 1500, 4000]) setTimeout(() => refresh(q), ms)
  }
  // Yes to every permission asked here and now (each still checked against its own question); not
  // one that has gone quiet, which you'd want to look at again first.
  const yesable = items.filter((i) => i.type === 'permission' && i.online && !i.old && i.answers?.[0] && (i.answers[0].n === 'approve' || /^yes\b/i.test(i.answers[0].title)))
  const yesAll = async () => {
    setBusy(true)
    setSure(false)
    let done = 0
    let missed = 0
    for (const it of yesable) {
      const o = it.answers[0]
      try {
        const r = o.n === 'approve'
          ? await onDevice(it.machine, `/cloud/agents/${encodeURIComponent(it.paneId)}/approve`, {}).then(() => ({ ok: true }))
          : await onDevice(it.machine, '/needs-you/answer', { paneId: it.paneId, seq: it.seq, qid: it.qid, n: o.n })
        if (r.ok) { done++; setGone((g) => ({ ...g, [uid(it)]: Date.now() })) } else missed++
      } catch { missed++ }
    }
    setBusy(false)
    setNote({ text: missed ? t('Answered {n}; {m} had moved on or didn\'t take.', { n: done, m: missed }) : t('Answered all {n}', { n: done }) })
    refresh('')
  }
  const focused = focus?.paneId ? all.find((i) => i.paneId === focus.paneId && (i.machine || null) === (focus.machine || null)) : null
  const focusId = focused ? uid(focused) : null
  const outside = (data?.outside || []).filter((x) => !gone[`outside|${x.id}`])
  const slack = (data?.slack || []).filter((x) => !gone[`slack|${x.id}`])
  const letIn = (data?.letIn || []).filter((x) => !gone[`letin|${x.id}`])
  const folders = (data?.folders || []).filter((x) => !gone[`folder|${x.id}`])
  const waiting = all.filter((i) => isAsk(i) && i.online && !isQuiet(i)).length + outside.length + slack.length + letIn.length + folders.length
  const list = (rows) => rows.map((it) => <NeedsItem key={uid(it)} it={it} focused={uid(it) === focusId} top={top.has(uid(it))} onOpen={onOpen} onGone={onGone} setNote={setNote} />)
  // Clear all that have gone quiet, each on its own device: off the list at once, and back with a
  // note for any its device couldn't clear.
  const clearQuiet = async (list) => {
    setGone((g) => ({ ...g, ...Object.fromEntries(list.map((i) => [uid(i), Date.now()])) }))
    const missed = []
    await Promise.all(list.map((i) => onDevice(i.machine, '/needs-you/clear', { id: i.id }).catch(() => missed.push(i))))
    if (missed.length) setGone((g) => { const n = { ...g }; for (const i of missed) delete n[uid(i)]; return n })
    setNote({ text: missed.length ? t("Cleared {n}; {m} couldn't be cleared from here. Open them instead.", { n: list.length - missed.length, m: missed.length }) : t('Cleared {n}', { n: list.length }) })
    refresh('')
  }
  const quietFold = <QuietFold items={quiet} open={quietOpen} setOpen={setQuietOpen} uid={uid} multi={devices.length > 1} focus={focusId && quiet.some((i) => uid(i) === focusId) ? focusId : null} onClearAll={clearQuiet}
    card={(it) => <NeedsItem it={it} focused={uid(it) === focusId} quiet onOpen={onOpen} onGone={onGone} setNote={setNote} />} />
  return (
    <div className={`ny-panel ${phone ? 'phone' : ''}`} ref={box} role="dialog" aria-label={t('Needs You')}>
      <header className="ny-head">
        {phone && <button type="button" className="win-btn" onClick={onClose} aria-label={t('Back')}><Icon name="back" size={18} /></button>}
        <h2>{t('Needs You')}{waiting > 0 && <span className="ny-count">{waiting}</span>}</h2>
        <span className="ny-grow" />
        <div className="ny-sort" role="radiogroup" aria-label={t('Order')}>
          <button type="button" role="radio" aria-checked={by === 'urgent'} className={`fchip ${by === 'urgent' ? 'on' : ''}`} onClick={() => pickSort('urgent')}>{t('Most urgent')}</button>
          <button type="button" role="radio" aria-checked={by === 'newest'} className={`fchip ${by === 'newest' ? 'on' : ''}`} onClick={() => pickSort('newest')}>{t('Newest')}</button>
        </div>
        {!phone && <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={14} /></button>}
      </header>
      {devices.length > 1 && (
        <div className="ny-devices chips" role="tablist" aria-label={t('Devices')}>
          <button type="button" role="tab" aria-selected={device === 'all'} className={`fchip ${device === 'all' ? 'on' : ''}`} onClick={() => setDevice('all')}>{t('All')}<span className="fcount">{all.length}</span></button>
          {devices.map((d) => {
            const id = d.id || 'here'
            return <button key={id} type="button" role="tab" aria-selected={device === id} className={`fchip ${device === id ? 'on' : ''}`} onClick={() => setDevice(device === id ? 'all' : id)}><span className={`mc-dot ${d.online ? 'on' : ''}`} />{d.name}<span className="fcount">{all.filter((i) => (i.machine || 'here') === id).length}</span></button>
          })}
        </div>
      )}
      {yesable.length > 1 && (
        <div className="ny-batch">
          {sure
            ? <><span>{t('Answer Yes to these {n}? Each goes ahead with what it asked.', { n: yesable.length })}</span><button type="button" className="btn small primary" disabled={busy} onClick={yesAll}>{t('Yes to all')}</button><button type="button" className="ghost-btn" onClick={() => setSure(false)}>{t('Cancel')}</button></>
            : <><span className="muted">{t('{n} ask for permission', { n: yesable.length })}</span><button type="button" className="btn small" disabled={busy} onClick={() => setSure(true)}>{busy ? t('Answering…') : t('Yes to all {n}…', { n: yesable.length })}</button></>}
        </div>
      )}
      {note && <p className="ny-note" role="status">{note.text}</p>}
      <div className="ny-list">
        {!data && <div className="skeleton-rows pad"><div /><div /></div>}
        {letIn.length > 0 && (
          <section className="ny-group" aria-label={t('Waiting to Be Let In')}>
            <h3>{t('Waiting to Be Let In')}<span className="fcount">{letIn.length}</span></h3>
            {letIn.map((x) => <LetInItem key={x.id} it={x} setNote={setNote} onDone={(o) => { setGone((g) => ({ ...g, [`letin|${o.id}`]: Date.now() })); for (const ms of [0, 1500]) setTimeout(() => refresh(''), ms) }} />)}
          </section>
        )}
        {folders.length > 0 && (
          <section className="ny-group" aria-label={t('Folders Not Read')}>
            <h3>{t('Folders Not Read')}<span className="fcount">{folders.length}</span></h3>
            {folders.map((x) => <FolderItem key={x.id} it={x} setNote={setNote} onDone={(o) => { setGone((g) => ({ ...g, [`folder|${o.id}`]: Date.now() })); for (const ms of [0, 1500]) setTimeout(() => refresh(''), ms) }} />)}
          </section>
        )}
        {slack.length > 0 && (
          <section className="ny-group" aria-label={t('From Slack')}>
            <h3>{t('From Slack')}<span className="fcount">{slack.length}</span></h3>
            {slack.map((x) => <SlackItem key={x.id} it={x} setNote={setNote} onDone={(o) => { setGone((g) => ({ ...g, [`slack|${o.id}`]: Date.now() })); for (const ms of [0, 1500]) setTimeout(() => refresh(''), ms) }} />)}
          </section>
        )}
        {outside.length > 0 && (
          <section className="ny-group" aria-label={t('From other apps')}>
            <h3>{t('From other apps')}<span className="fcount">{outside.length}</span></h3>
            {outside.map((x) => <OutsideItem key={x.id} it={x} setNote={setNote} onDone={(o) => { setGone((g) => ({ ...g, [`outside|${o.id}`]: Date.now() })); for (const ms of [0, 1500]) setTimeout(() => refresh(''), ms) }} />)}
          </section>
        )}
        {data && !items.length && !outside.length && !slack.length && !letIn.length && !folders.length && (
          <div className="ny-empty"><Icon name="check" size={20} /><p>{t('Nothing needs you right now.')}</p><small className="muted">{quiet.length ? t('Only what has been quiet for a while, folded below.') : t('Questions, permissions, failed runs and finished work from all your devices show here.')}</small></div>
        )}
        {by === 'urgent'
          ? GROUPS.map(([g, label]) => {
            const rows = items.filter((i) => groupOf(i) === g)
            return rows.length > 0 && (
              <section key={g} className="ny-group" aria-label={t(label)}>
                <h3>{t(label)}<span className="fcount">{rows.length}</span></h3>
                {list(rows)}
              </section>
            )
          })
          : list(items)}
        {quietFold}
      </div>
    </div>
  )
}
