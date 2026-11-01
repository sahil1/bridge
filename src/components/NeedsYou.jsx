import { useCallback, useEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import Question, { parseScreen } from './Question.jsx'
import { hostApi } from '../api.js'
import { ago } from './Machines.jsx'
import { t, tx } from '../i18n/index.js'
import './needsyou.css'

// The needs-you inbox: everything waiting on you, on this computer, your other devices and the
// cloud agents started from them (server/needsyou.js), in one list. Agents asking for permission or
// asking a question, failed runs and finished work, each answered right there: Yes or No, a reply,
// the question's full card, or open it. The top bar's needs-you chip opens it, and so does a phone
// notification about an agent that needs you.
//
// The list comes from the device this page is served from (it knows where each device is); each
// answer goes to the device the agent is on, at /m/<id>/ through this one (server/machines.js).

const at = (machine) => (machine ? `/m/${encodeURIComponent(machine)}` : '')
async function onDevice(machine, path, body) {
  const res = await fetch(`${at(machine)}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status })
  return data
}

const isAsk = (i) => i.type === 'permission' || i.type === 'question'
// What counts on the chip: what stops an agent until you answer, on a device that can hear you.
// The device this window shows counts from its own live feed (here: its agents waiting), which is
// quicker than the list; the others from the list.
export const waitingOn = (data, { here = 0, shown = null } = {}) => here + (data?.items || []).filter((i) => isAsk(i) && i.online && (i.machine || null) !== shown).length

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

// The top bar's chip. count: what the inbox says waits on you (or, before it has answered, the
// agents waiting in this window).
export function NeedsYouChip({ count, review = 0, onClick, open }) {
  if (!count && !review) return null
  const label = count ? (count === 1 ? t('{n} needs you', { n: count }) : t('{n} need you', { n: count })) : t('{n} to review', { n: review })
  return (
    <button type="button" className={`needs-chip ${count ? '' : 'quiet'}`} onClick={onClick} aria-haspopup="dialog" aria-expanded={!!open} aria-label={label} title={t('Everything waiting on you')}>
      <StatusDot status={count ? 'blocked' : 'done'} size={8} /> {count || review}<span className="needs-word"> {count ? (count === 1 ? t('needs you') : t('need you')) : t('to review')}</span>
    </button>
  )
}

const TYPE = {
  permission: { label: tx('Permission'), status: 'blocked' },
  question: { label: tx('Question'), status: 'blocked' },
  failed: { label: tx('Failed'), status: 'unknown' },
  review: { label: tx('Finished'), status: 'done' },
}
const GROUPS = [['ask', tx('Waiting on you')], ['failed', tx('Failed')], ['review', tx('To review')]]
const groupOf = (i) => (isAsk(i) ? 'ask' : i.type)
const sorted = (items, by) => {
  const time = (i) => Date.parse(i.since || 0) || 0
  const rank = { permission: 0, question: 1, failed: 2, review: 3 }
  return [...items].sort(by === 'newest' ? (x, y) => time(y) - time(x) : (x, y) => (rank[x.type] ?? 9) - (rank[y.type] ?? 9) || time(x) - time(y))
}
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

function Item({ it, focused, onOpen, onGone, setNote }) {
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
      const r = await onDevice(it.machine, `/agents/${encodeURIComponent(it.paneId)}/prompt`, { text: v })
      setText('')
      setMode(null)
      onGone(it, r.queued ? t('Sent. It gets it when it can take it.') : t('Sent'))
    } catch (x) { say(x) } finally { setBusy(false) }
  }
  const clear = async () => {
    try { await onDevice(it.machine, '/needs-you/clear', { id: it.id }); onGone(it, null) } catch (x) { say(x) }
  }
  // A reply for what a message answers: a question in words (Codex's, a cloud agent's), a failed
  // run, finished work. A menu on the screen is answered with its own choices.
  const canReply = !off && it.type !== 'permission' && (!isAsk(it) || (!it.qid && !it.old))
  const a = it.agent || {}
  const what = it.text || (it.type === 'review' ? null : it.type === 'failed' ? t('The run failed.') : t('Waiting on you. Open it to answer.'))
  return (
    <article ref={ref} className={`ny-item t-${it.type} ${off ? 'off' : ''} ${focused ? 'focus' : ''}`} aria-label={`${t(ty.label)}: ${a.title}`}>
      <div className="ny-top">
        <StatusDot status={ty.status} size={8} />
        <span className="ny-kind">{it.limit ? t('Usage limit') : t(ty.label)}</span>
        <span className="ny-age" title={it.since ? new Date(it.since).toLocaleString() : ''}>{it.since ? ago(it.since) : ''}</span>
        <span className="ny-grow" />
        <span className={`ny-device ${it.machine ? '' : 'here'}`} title={off ? (it.asOf ? t('{name} is offline. As of {when}.', { name: it.device, when: ago(it.asOf) }) : t('{name} is offline', { name: it.device })) : t('On {name}', { name: it.device })}>
          <Icon name={a.cloud ? 'cloud' : 'laptop'} size={11} />{it.device}{off && <span className="ny-off"> · {t('offline')}</span>}
        </span>
      </div>
      {what && <p className={`ny-text ${it.type === 'review' ? 'said' : ''}`}>{what}</p>}
      {it.about && <code className="ny-about">{it.about}</code>}
      <div className="ny-meta">
        <b className="ny-agent">{a.chief && <Icon name="helm" size={11} />}{a.title}</b>
        {a.project && <span>{a.project}</span>}
        {a.branch && <span className="ny-branch"><Icon name="branch" size={10} />{a.branch}</span>}
        <span className="muted">{a.cloud ? t('{label} cloud', { label: a.cloud }) : a.kindLabel}{a.account ? ` · ${a.account}` : ''}</span>
      </div>
      <div className="ny-acts">
        {!off && it.answers?.map((o, i) => (
          <button key={o.n} type="button" className={`btn small ${i === 0 ? 'primary' : ''}`} disabled={busy} onClick={() => answer(o)}>{o.title}</button>
        ))}
        {!off && isAsk(it) && it.qid && !it.old && <button type="button" className="ghost-btn" aria-expanded={mode === 'live'} onClick={() => setMode(mode === 'live' ? null : 'live')}>{it.answers?.length ? t('More answers…') : t('Answer here…')}</button>}
        {canReply && <button type="button" className="ghost-btn" aria-expanded={mode === 'reply'} onClick={() => setMode(mode === 'reply' ? null : 'reply')}><Icon name="chat" size={12} /> {t('Reply')}</button>}
        {it.pr && <a className="ghost-btn" href={it.pr} target="_blank" rel="noopener noreferrer"><Icon name="external" size={12} /> {t('Pull request')}</a>}
        <span className="ny-grow" />
        {!off && (it.type === 'review' || it.type === 'failed') && !it.old && <button type="button" className="ghost-btn" onClick={clear} title={t('Take it off the list until it has something new')}>{t('Clear')}</button>}
        <button type="button" className="ghost-btn strong" onClick={() => onOpen(it)} disabled={off}>{t('Open')}</button>
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

// The inbox itself: a panel under the chip on a computer, the whole screen on a phone.
// focus: { paneId, machine } to show first (from a notification).
export function NeedsYouPanel({ data, refresh, phone = false, focus = null, onClose, onOpen }) {
  const [by, setBy] = useState(() => { try { return localStorage.getItem('cc-needs-sort') || 'urgent' } catch { return 'urgent' } })
  const [device, setDevice] = useState('all')
  const [gone, setGone] = useState({}) // item id -> when it was answered here (hidden until the list catches up)
  const [note, setNote] = useState(null) // { id, text } or { text }
  const [sure, setSure] = useState(false) // Yes to all, asked once more
  const [busy, setBusy] = useState(false)
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
  const all = (data?.items || []).filter((i) => !gone[i.id])
  const devices = (data?.devices || []).filter((d) => all.some((i) => (i.machine || null) === d.id))
  const items = sorted(device === 'all' ? all : all.filter((i) => (i.machine || 'here') === device), by)
  // Answered: off the list here at once, and the device it's on asked again as it moves on.
  const onGone = (it, said, soft = false) => {
    if (!soft) setGone((g) => ({ ...g, [it.id]: Date.now() }))
    if (said) setNote({ text: `${said} · ${it.agent?.title || ''}` })
    const q = it.machine ? `?fresh=${encodeURIComponent(it.machine)}` : ''
    for (const ms of [0, 1500, 4000]) setTimeout(() => refresh(q), ms)
  }
  // Yes to every permission asked here and now (each still checked against its own question).
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
        if (r.ok) { done++; setGone((g) => ({ ...g, [it.id]: Date.now() })) } else missed++
      } catch { missed++ }
    }
    setBusy(false)
    setNote({ text: missed ? t('Answered {n}; {m} had moved on or didn\'t take.', { n: done, m: missed }) : t('Answered all {n}', { n: done }) })
    refresh('')
  }
  const focusId = focus?.paneId ? all.find((i) => i.paneId === focus.paneId && (i.machine || null) === (focus.machine || null))?.id : null
  const waiting = all.filter((i) => isAsk(i) && i.online).length
  const list = (rows) => rows.map((it) => <Item key={it.id} it={it} focused={it.id === focusId} onOpen={onOpen} onGone={onGone} setNote={setNote} />)
  return (
    <div className={`ny-panel ${phone ? 'phone' : ''}`} ref={box} role="dialog" aria-label={t('Needs you')}>
      <header className="ny-head">
        {phone && <button type="button" className="win-btn" onClick={onClose} aria-label={t('Back')}><Icon name="back" size={18} /></button>}
        <h2>{t('Needs you')}{waiting > 0 && <span className="ny-count">{waiting}</span>}</h2>
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
        {data && !items.length && (
          <div className="ny-empty"><Icon name="check" size={20} /><p>{t('Nothing needs you right now.')}</p><small className="muted">{t('Questions, permissions, failed runs and finished work from all your devices show here.')}</small></div>
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
      </div>
    </div>
  )
}
