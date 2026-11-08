import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { NeedsItem, onDevice, Why, QuietFold } from './NeedsYou.jsx'
import { useAgentMap } from './AgentMap.jsx'
import { useCalendar, shortTitle } from './Agenda.jsx'
import { PrepCard } from './meetings/prep.jsx'
import { ago } from './Machines.jsx'
import { api, hostApi, machineId } from '../api.js'
import { t, tx, locale } from '../i18n/index.js'
import { sentTo } from '../sendbox.js'
import { split, isQuiet, compare, TOP, QUIET_DAYS } from '../../shared/focus.js'
import './needshome.css'

// Home (a beta feature, `home`): Needs you as the place the app opens at, on a computer and a
// phone. What needs you first, answered right there (Yes, No, the agent's own choices, Reply). Then
// what's ready to look at (finished work and its pull request, a meeting's notes and the action
// items not handed on, a whiteboard an agent drew, a task the Chief of Staff finished) as short
// rows, newest first, the last day's few and the rest folded away. Beside it what's coming up, a day
// at a time: the next meetings (with the brief and the files in the invite) and the tasks that name
// a day; and the Chief of Staff's other tasks, the ones with no day folded away. From every linked
// computer at once (server/home.js, by way of each one's summary, one row per thing), with a filter
// by kind and by device, and one order for it all: what needs you first, newest, oldest, by computer
// or by kind. Anything you pin goes to the top, as a card like the ones waiting on you, and stays
// there until you unpin it. Everything opens every item on every computer, in lanes as the Agent
// Map has them: by device, or by kind.
//
// What needs you is in the order shared/focus.js gives it (how much it holds up, and how recently
// you or it were on it), the first few said with why ("Blocking", "You were on this 12 min ago").
// What has been quiet for 3 days or more is folded under Waiting on You by project and not counted,
// here, in the top bar's chip, the badges or the window's title; pinned, it counts.

const KINDS = [['all', tx('All')], ['agent', tx('Agents')], ['meeting', tx('Meetings')], ['chief', tx('Chief of Staff')], ['board', tx('Whiteboards')]]
// Chief of Staff's own questions count with its tasks.
const kindOf = (i) => (i.kind === 'task' || (i.kind === 'agent' && i.agent?.chief) ? 'chief' : i.kind)
const DAY = 864e5
// The last day's finished work shown before Show all: a morning's worth, not the whole pile.
const CAP = 6
const fmt = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
const mins = (ms) => { const m = Math.max(1, Math.round(ms / 6e4)); return m < 60 ? t('{n} min', { n: m }) : t('{n} h {m} min', { n: Math.floor(m / 60), m: m % 60 }) }
const why = (e, device) => (e?.status === 404 ? t('Update Bridge AI on {name} to do this from here.', { name: device }) : e?.message || t("That didn't work. Open it instead."))
const time = (i) => Date.parse(i.at || 0) || 0
// A project named as the agent is ("GIT" in GIT) is said once.
const same = (a, b) => !a || !b || String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

// An agent's last message, whole: without the half word an older Bridge AI's cut can leave before
// its "…" (it cuts at 300 characters, so only a message that long is one it cut).
export const whole = (s) => {
  const x = String(s || '').replace(/\s+/g, ' ').trim()
  return x.endsWith('…') && x.length > 250 ? `${x.slice(0, -1).replace(/\s*\S*$/, '').replace(/[\s,;:.-]+$/, '')}…` : x
}
// A line or two of it that ends at a word: its first sentences, as many as fit in n characters
// (when that's at least half of them), else as many whole words as fit, and "…".
export function gist(s, n = 140) {
  const x = whole(s)
  if (x.length <= n) return x
  let out = ''
  for (const part of x.match(/.*?[.!?](?:\s+|$)|.+$/g) || []) {
    if (out.length + part.trimEnd().length > n) break
    out += part
  }
  if (out.trim().length >= n / 2) return out.trim()
  const c = x.slice(0, n + 1)
  return `${(c.slice(0, c.lastIndexOf(' ')) || c.slice(0, n)).replace(/[\s,;:.-]+$/, '')}…`
}

// Days, as the calendar and the task list have them (YYYY-MM-DD, this computer's own day).
const dayKey = (v) => new Date(v).toLocaleDateString('en-CA')
function dayName(key) {
  const diff = Math.round((new Date(`${key}T12:00:00`) - new Date().setHours(12, 0, 0, 0)) / DAY)
  return diff === 0 ? t('Today') : diff === 1 ? t('Tomorrow') : diff === -1 ? t('Yesterday') : new Date(`${key}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })
}

// The list from the device this page comes from: every few seconds while it's on screen (less
// often for a count elsewhere). uid: an item's id with its device's, as each device numbers its own.
export function useHome(on = true, every = 5000) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(() => hostApi(`/home${every <= 5000 ? '?live=1' : ''}`).then((d) => { setData({ ...d, items: (d.items || []).map((i) => ({ ...i, uid: `${i.machine || 'here'}|${i.id}` })) }); setError(null) }, (e) => setError(e.message || String(e))), [every])
  useEffect(() => {
    if (!on) return
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, every)
    return () => clearInterval(id)
  }, [load, on, every])
  return { data, error, refresh: load }
}

// The computer this window shows, as an item's device: the list comes from the device this page
// comes from, which is null there (here), and another's id while this window shows that one.
const SHOWN = machineId || 'here'
const devOf = (i) => i.machine || 'here'
export const onShown = (i) => devOf(i) === SHOWN
// What needs you, for the top bar, the sidebar and the tab's count: questions, permissions, failed
// runs and tasks waiting on you, on devices that can hear an answer, and not gone quiet (unless
// pinned). here: on the computer this window shows; elsewhere: on your others, which are said apart
// so they don't crowd this one.
export function needCount(data) {
  const pinned = new Set((data?.pins || []).map((p) => p.id))
  const all = (data?.items || []).filter((i) => i.group === 'needs' && i.online && (pinned.has(i.uid) || !isQuiet(i)))
  const here = all.filter(onShown).length
  return { here, elsewhere: all.length - here }
}

// The calendar's part of coming up: the meetings left today and tomorrow's, with the files each
// invite links to. One meeting on two of your calendars is one. Only where the calendar is (a Mac).
function useComing(on) {
  const { data, error } = useCalendar()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id) }, [])
  if (!on) return { events: [], error: null, now, loading: false }
  const seen = new Set()
  const pick = (list) => (list || []).filter((e) => {
    if (e.allDay || e.canceled || e.response === 'declined' || Date.parse(e.end) <= now) return false
    const k = `${String(e.title || '').trim().toLowerCase()}|${Date.parse(e.start)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const events = [...pick(data?.today), ...pick(data?.tomorrow)].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 6)
  return { events, error: error || (data && data.available === false ? data.error || t('Calendar needs setting up') : null), now, loading: !data && !error }
}

// The meeting before this one that it follows on from (server/meetwork.js), as its brief.
function useBrief(e) {
  const [brief, setBrief] = useState(null)
  useEffect(() => {
    if (!e) return
    const q = new URLSearchParams({ title: e.title || '', start: e.start || '' })
    for (const p of (e.attendees || []).slice(0, 20)) q.append('people', p.email || p.name || String(p))
    let live = true
    api(`/meetings/since?${q}`).then((d) => { if (live) setBrief(d?.last ? d : null) }, () => { if (live) setBrief(null) })
    return () => { live = false }
  }, [e?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return brief
}

// What you've opened here (a row's whole text, or the thing itself), so Clear read can take those
// off and the rest stand out. Kept in this browser only: it's a convenience, nothing depends on it.
function useRead() {
  const [read, setRead] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('cc-home-read') || '[]')) } catch { return new Set() } })
  const mark = useCallback((uid) => setRead((r) => {
    if (r.has(uid)) return r
    const n = new Set([...r, uid])
    try { localStorage.setItem('cc-home-read', JSON.stringify([...n].slice(-300))) } catch { /* no storage */ }
    return n
  }), [])
  return [read, mark]
}

// What's pinned to the top. Kept on the computer this page comes from (server/home.js), so every
// page and phone it serves has the same. Pinned here at once; one that couldn't be saved goes back
// to where it was and says why.
function usePins(data, refresh, setNote) {
  const [mine, setMine] = useState({}) // uid -> pinned, until the list says so too
  const saved = useMemo(() => new Set((data?.pins || []).map((p) => p.id)), [data])
  useEffect(() => setMine((m) => {
    const left = Object.entries(m).filter(([k, v]) => saved.has(k) !== v)
    return left.length === Object.keys(m).length ? m : Object.fromEntries(left)
  }), [saved])
  const has = (uid) => (uid in mine ? mine[uid] : saved.has(uid))
  const toggle = async (it) => {
    const on = !has(it.uid)
    setMine((m) => ({ ...m, [it.uid]: on }))
    try {
      await hostApi('/home-pins', { method: 'POST', body: { id: it.uid, on } })
      refresh()
    } catch (e) {
      setMine((m) => { const n = { ...m }; delete n[it.uid]; return n })
      setNote({ text: on ? t("Couldn't pin it: {why}", { why: e.message }) : t("Couldn't unpin it: {why}", { why: e.message }) })
    }
  }
  return { has, toggle }
}

// The order, picked once and kept in this browser: what needs you first, newest, oldest, or in a
// group for each computer or each kind.
const SORTS = [['needs', tx('Needs you first')], ['newest', tx('Newest first')], ['oldest', tx('Oldest first')], ['device', tx('By computer')], ['kind', tx('By kind')]]
function useSort() {
  const [by, setBy] = useState(() => { try { const v = localStorage.getItem('cc-home-sort'); return SORTS.some(([k]) => k === v) ? v : 'needs' } catch { return 'needs' } })
  const pick = (v) => { setBy(v); try { localStorage.setItem('cc-home-sort', v) } catch { /* no storage */ } }
  return [by, pick]
}
// Which computer's things to show, kept in this browser: this one (the computer the window shows,
// to start with: one computer's work at a time, the others a line each under Waiting on You), all of
// them, or one of the others.
function useDevicePick() {
  const [v, setV] = useState(() => { try { const x = JSON.parse(localStorage.getItem('cc-home-device') || 'null'); return typeof x === 'string' && x ? x : 'this' } catch { return 'this' } })
  const pick = (x) => { setV(x); try { localStorage.setItem('cc-home-device', JSON.stringify(x)) } catch { /* no storage */ } }
  return [v, pick]
}
// What needs you first, in shared/focus.js's order (how much it holds up, then how recently you or
// it were on it); then what's ready to look at, newest first; then what's coming up.
const GROUP = { needs: 0, ready: 1, coming: 2 }
function sortBy(list, by) {
  const focused = compare()
  const urgent = (x, y) => (GROUP[x.group] ?? 3) - (GROUP[y.group] ?? 3) || (x.group === 'needs' ? focused(x, y) : time(y) - time(x))
  const order = by === 'newest' ? (x, y) => time(y) - time(x) || urgent(x, y) : by === 'oldest' ? (x, y) => time(x) - time(y) || urgent(x, y) : urgent
  return [...list].sort(order)
}
const KIND_ICON = { agent: 'bot', meeting: 'mic', chief: 'helm', board: 'shapes' }
// By computer or by kind: a group for each, this computer first or in the tabs' order.
function groupsOf(rows, by, devices) {
  if (by !== 'device' && by !== 'kind') return [{ key: 'all', rows }]
  const keyOf = by === 'device' ? (i) => i.machine || 'here' : kindOf
  const keys = by === 'device' ? [...new Set([...devices.map((d) => d.id || 'here'), ...rows.map(keyOf)])] : KINDS.slice(1).map(([k]) => k)
  return keys.map((key) => ({ key, rows: rows.filter((i) => keyOf(i) === key) })).filter((g) => g.rows.length)
}
// A group's heading: the computer (and whether it's offline), or the kind.
function GroupHead({ by, g, devices }) {
  const d = by === 'device' && devices.find((x) => (x.id || 'here') === g.key)
  const label = by === 'device' ? d?.name || g.rows[0]?.device : t(KINDS.find(([k]) => k === g.key)?.[1] || '')
  return (
    <h4 className="hm-ghead">
      <Icon name={by === 'device' ? 'laptop' : KIND_ICON[g.key]} size={12} />{label}
      {d && !d.online && <span className="hm-ghead-off">· {t('offline')}</span>}
      <span className="fcount">{g.rows.length}</span>
    </h4>
  )
}
// Each group under its heading, when there's more than one.
const grouped = (rows, by, devices, render) => {
  const gs = groupsOf(rows, by, devices)
  return gs.length > 1 ? gs.map((g) => <div key={g.key} className="hm-group"><GroupHead by={by} g={g} devices={devices} />{render(g.rows)}</div>) : render(rows)
}

// The computer it's on, as every card has it.
function DeviceChip({ it }) {
  const off = !it.online
  return (
    <span className={`ny-device ${it.machine ? '' : 'here'}`} title={off ? t('{name} is offline', { name: it.device }) : t('On {name}', { name: it.device })}>
      <Icon name="laptop" size={11} />{it.device}{off && <span className="ny-off"> · {t('offline')}</span>}
    </span>
  )
}

// The heading's count: everything that needs you on every computer (offline ones too, as Waiting on
// You has them), with a ring like the Status menu's, filled by the share you can answer now (on a
// computer that's on) and the rest in a quieter tone. Pointed at, reached by the keyboard or tapped,
// what's in it: on each computer and by kind, and how many more have gone quiet (not counted).
// Escape, a tap elsewhere or a second tap puts it away.
const NEED_KINDS = [['permission', tx('Permissions')], ['question', tx('Questions')], ['failed', tx('Failed')], ['task', tx('Chief of Staff tasks')]]
function NeedCount({ list, devices, quiet = 0 }) {
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [stuck, setStuck] = useState(false)
  const box = useRef(null)
  const pointing = useRef(false) // a click or a tap, which opens it itself, rather than the keyboard
  useEffect(() => {
    if (!stuck) return
    const away = (e) => { if (!box.current?.contains(e.target)) setStuck(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [stuck])
  const total = list.length
  const now = list.filter((i) => i.online).length
  const title = total === 0 ? t('Nothing needs you') : total === 1 ? t('1 thing needs you') : t('{n} things need you', { n: total })
  if (!total) return <h2>{title}</h2>
  const open = hover || focus || stuck
  const away = () => { setStuck(false); setHover(false); setFocus(false) }
  const on = devices.map((d) => ({ d, n: list.filter((i) => (i.machine || 'here') === (d.id || 'here')).length })).filter((x) => x.n)
  const kinds = NEED_KINDS.map(([k, label]) => ({ k, label, n: list.filter((i) => (i.kind === 'task' ? 'task' : i.type) === k).length })).filter((x) => x.n)
  return (
    <div className="hm-count-box" ref={box} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true) }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(false) }}>
      <h2>
        <button type="button" className="hm-count" aria-expanded={open} aria-describedby={open ? 'hm-count-tip' : undefined}
          onPointerDown={() => { pointing.current = true }}
          onFocus={() => { if (!pointing.current) setFocus(true) }}
          onBlur={() => setFocus(false)}
          onClick={() => { pointing.current = false; if (stuck) away(); else setStuck(true) }}
          onKeyDown={(e) => { if (e.key === 'Escape') away() }}>
          {title}
          <span className="mini-ring hm-ring" role="img" aria-label={t('{n} of {m} you can answer now', { n: now, m: total })} style={{ '--p': Math.round((now / total) * 100) }} />
        </button>
      </h2>
      {open && (
        <div id="hm-count-tip" role="tooltip" className="hm-tip">
          <p>{now === total ? (total === 1 ? t('You can answer it now.') : t('You can answer all {n} now.', { n: total }))
            : now === 0 ? t('None can be answered now: each waits for its computer to be back.')
              : t('You can answer {n} of {m} now; the rest wait for their computer to be back.', { n: now, m: total })}</p>
          <div className="hm-tip-cols">
            <dl>
              <dt>{t('By computer')}</dt>
              {on.map(({ d, n }) => <dd key={d.id || 'here'} className={d.online ? '' : 'off'}><span className={`mc-dot ${d.online ? 'on' : ''}`} /><span className="hm-tip-name">{d.name}{!d.online && <small> · {t('offline')}</small>}</span><b>{n}</b></dd>)}
            </dl>
            <dl>
              <dt>{t('By kind')}</dt>
              {kinds.map(({ k, label, n }) => <dd key={k}><span className="hm-tip-name">{t(label)}</span><b>{n}</b></dd>)}
            </dl>
          </div>
          {quiet > 0 && <p className="hm-tip-quiet">{quiet === 1 ? t('1 more has been quiet for {d}+ days: folded under Waiting on You, not counted.', { d: QUIET_DAYS }) : t('{n} more have been quiet for {d}+ days: folded under Waiting on You, not counted.', { n: quiet, d: QUIET_DAYS })}</p>}
        </div>
      )}
    </div>
  )
}

// Pin to the top of Home, or unpin: a pin, filled while it's pinned.
function PinBtn({ on, onClick }) {
  return (
    <button type="button" className={`hm-pin ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}
      aria-label={on ? t('Unpin') : t('Pin to the top')} title={on ? t('Unpin: back to where it was') : t('Pin to the top of Home: it stays there until you unpin it')}>
      <Icon name="pin" size={13} />
    </button>
  )
}

// A line about the page itself (it couldn't load, a computer sends only part of it), in the column
// with everything else.
function Notice({ tone = 'info', icon = 'info', role, className = '', children }) {
  return <div className={`hm-notice ${tone} ${className}`} role={role}><Icon name={icon} size={14} /><div className="hm-notice-text">{children}</div></div>
}

// Open, for one on another computer: an agent there (or its Chief of Staff, running) opens in a tab
// here; anything else is that computer's own page, so this window switches to it, and says so.
const switches = (it) => !onShown(it) && (it.kind === 'meeting' || it.kind === 'board' || (it.kind === 'task' && !it.chief))
function openWords(it) {
  if (switches(it)) return { label: t('Open on {name}', { name: it.device }), title: it.kind === 'task' ? t("Shows {name} in this window, at its Chief of Staff (started, as it isn't running). What you have open here is kept, and Back brings you to it.", { name: it.device }) : t('Shows {name} in this window, at it. What you have open here is kept, and Back brings you to it.', { name: it.device }) }
  return { label: t('Open'), title: onShown(it) ? undefined : t('Opens in a tab here, from {name}', { name: it.device }) }
}

// A task of the Chief of Staff's waiting on you: what it needs, since when (it last changed), a reply
// to it, or open the Chief. top: one of the first few that need you now, said with why.
function TaskWaiting({ it, onOpenChief, onGone, setNote, pin, top = false }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const off = !it.online
  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      const r = await onDevice(it.machine, `/chief/tasks/${encodeURIComponent(it.task.id)}/reply`, { text: text.trim() })
      setText(''); setOpen(false)
      onGone(it, sentTo(r, t('Chief of Staff')))
    } catch (x) { setNote({ id: it.id, text: why(x, it.device) }) } finally { setBusy(false) }
  }
  return (
    <article className={`ny-item hm-task ${off ? 'off' : ''} ${top ? 'top' : ''}`} aria-label={t('Chief of Staff task: {title}', { title: it.task.title })}>
      <div className="ny-top">
        <StatusDot status="blocked" size={8} />
        <span className="ny-kind">{t('Chief of Staff task')}</span>
        {(it.since || it.at) && <span className="ny-age" title={new Date(it.since || it.at).toLocaleString(locale())}>{ago(it.since || it.at)}</span>}
        <span className="ny-grow" />
        <DeviceChip it={it} />
        {pin}
      </div>
      {top && <Why it={it} />}
      <p className="ny-text">{it.task.needs || t('Waiting on you')}</p>
      <div className="ny-meta"><Icon name="helm" size={11} /><b className="hm-clamp">{it.task.title}</b></div>
      <div className="ny-acts">
        {!off && <button type="button" className="ghost-btn" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="chat" size={12} /> {t('Reply')}</button>}
        <span className="ny-grow" />
        <button type="button" className="ghost-btn strong" onClick={() => onOpenChief(it)} disabled={off} title={openWords(it).title}><Icon name="open" size={12} /> {openWords(it).label}</button>
      </div>
      {open && (
        <form className="ny-reply" onSubmit={send}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Reply to Chief of Staff…')} aria-label={t('Reply to Chief of Staff')} disabled={busy} />
          <button type="submit" className="btn small primary" disabled={busy || !text.trim()}><Icon name="send" size={12} /> {t('Send')}</button>
        </form>
      )}
    </article>
  )
}

// What a thing ready to look at says, by kind, and what you can do with it: for its row, and for
// its card when it's pinned. The buttons are the same, with the same icons, in either.
function useReady(it, { phone, h, onRead }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [replying, setReplying] = useState(false)
  const [sent, setSent] = useState(null)
  const off = !it.online
  const a = it.agent || {}
  const left = sent ? 0 : it.unsent || 0
  const go = (fn) => () => { onRead(); fn(it) }
  const clear = async () => {
    try { await onDevice(it.machine, '/needs-you/clear', { id: it.nid || it.id }); h.onGone(it, null) } catch (x) { h.setNote({ id: it.id, text: why(x, it.device) }) }
  }
  const toChief = async () => {
    setBusy(true)
    try {
      const r = await onDevice(it.machine, `/meetings/${encodeURIComponent(it.meeting.id)}/chief`, {})
      setSent(r.sent === false ? t('On Chief of Staff\'s list. It isn\'t running: it reads them when it starts.') : sentTo(r, t('Chief of Staff')))
      onRead()
      h.refresh()
    } catch (e) { h.setNote({ id: it.id, text: why(e, it.device) }) } finally { setBusy(false) }
  }
  const reply = async (e) => {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    setBusy(true)
    try {
      const r = await onDevice(it.machine, `/agents/${encodeURIComponent(it.paneId)}/prompt`, { text: v, typed: 'reply' })
      setText('')
      setReplying(false)
      // In now, or held until it's free: as your computer answered.
      h.onGone(it, null)
      h.setNote({ text: sentTo(r, it.agent?.title || t('the agent')) })
    } catch (x) { h.setNote({ id: it.id, text: why(x, it.device) }) } finally { setBusy(false) }
  }
  const m = it.meeting
  const tk = it.task
  const dueOn = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })
  // kind: what it is, on its card; what: beside its title, on its row.
  const l = it.kind === 'agent' ? { dot: 'done', kind: t('Finished'), title: a.title || t('Agent'), what: same(a.project, a.title) ? null : a.project, sub: gist(it.text, phone ? 90 : 140) || t('Finished, with nothing more to say.'), full: whole(it.text) }
    : it.kind === 'meeting' ? { icon: 'mic', kind: t('Meeting notes'), title: m.title, what: t('Meeting notes'), sub: sent || (left === 1 ? t('1 action item not handed on yet') : left > 1 ? t('{n} action items not handed on yet', { n: left }) : m.hasSummary ? t('The summary is ready') : m.status === 'recording' ? t('Recording') : t('No summary yet')) }
      : it.kind === 'board' ? { icon: 'shapes', kind: t('Whiteboard'), title: it.board.title, what: t('Whiteboard'), sub: it.board.changed === false ? t('Changed {when}', { when: ago(it.at) }) : t('Changed since you last looked') }
        : tk.status === 'done' ? { icon: 'helm', kind: t('Chief of Staff finished'), title: tk.title, what: t('Chief of Staff finished'), sub: tk.outcome || tk.link || t('Done'), full: [tk.outcome, tk.link].filter(Boolean).join('\n') }
          : { icon: 'helm', kind: t('Chief of Staff task'), title: tk.title, what: t('Chief of Staff task'), sub: tk.status === 'doing' ? t('On it now') : !tk.due ? t('To do') : tk.due < dayKey(Date.now()) ? t('Was due {date}', { date: dueOn(tk.due) }) : t('Due {date}', { date: dueOn(tk.due) }) }
  const opener = it.kind === 'agent' ? h.onOpen : it.kind === 'meeting' ? h.onOpenMeeting : it.kind === 'board' ? h.onOpenBoard : h.onOpenChief
  const canClear = it.kind === 'agent' && it.type === 'review' && !off && !it.old
  return {
    l, off,
    pr: it.pr && <a className="ghost-btn" href={it.pr} target="_blank" rel="noopener noreferrer" onClick={onRead}><Icon name="external" size={12} /> {t('Pull request')}</a>,
    handOn: it.kind === 'meeting' && left > 0 && !off && <button type="button" className="ghost-btn" disabled={busy} onClick={toChief}><Icon name="helm" size={12} /> {t('To Chief of Staff')}</button>,
    clearBtn: canClear && <button type="button" className="ghost-btn" onClick={clear} title={t('Take it off the list until it has something new')}><Icon name="check" size={12} /> {t('Clear')}</button>,
    openBtn: <button type="button" className="ghost-btn strong" onClick={go(opener)} disabled={off} title={openWords(it).title}><Icon name="open" size={12} /> {openWords(it).label}</button>,
    replyBtn: it.kind === 'agent' && !off && <button type="button" className="ghost-btn" aria-expanded={replying} onClick={() => setReplying(!replying)}><Icon name="chat" size={12} /> {t('Reply')}</button>,
    form: replying && (
      <form className="ny-reply" onSubmit={reply}>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Reply to {name}…', { name: a.title })} aria-label={t('Reply to {name}', { name: a.title })} disabled={busy} />
        <button type="submit" className="btn small primary" disabled={busy || !text.trim()}><Icon name="send" size={12} /> {t('Send')}</button>
      </form>
    ),
  }
}

// One thing ready to look at, as a short row: what it is, a line or two of it that ends at a word,
// and where and when. Opened (a click, or Enter), the whole of it and what you can do with it; on a
// computer the usual ones are also on the row while the pointer or the keyboard is on it.
function ReadyItem({ it, multi, phone, read, open, onToggle, onRead, h, pin }) {
  const r = useReady(it, { phone, h, onRead })
  const { l, off } = r
  // Where and when: on the right on a computer, under it on a phone (where the room is for the words).
  const when = (
    <span className="hm-item-when">
      {multi && <span className="hm-dev"><Icon name="laptop" size={10} />{it.device}{off ? ` · ${t('offline')}` : ''}</span>}
      {it.kind === 'task' && it.task.done ? <span>{dayName(it.task.done)}</span>
        : it.at && <time dateTime={it.at} title={new Date(it.at).toLocaleString(locale())}>{ago(it.at)}</time>}
    </span>
  )
  return (
    <li className={`hm-item ${read ? 'read' : ''} ${open ? 'open' : ''} ${off ? 'off' : ''}`} data-kind={it.kind}>
      <button type="button" className="hm-item-main" aria-expanded={open} onClick={() => { onToggle(); onRead() }}>
        <span className="hm-item-ico">{l.dot ? <StatusDot status={l.dot} size={8} /> : <Icon name={l.icon} size={13} />}</span>
        <span className="hm-item-body">
          <span className="hm-item-l1"><b>{l.title}</b>{l.what && <span className="hm-what">{l.what}</span>}{it.pr && <span className="hm-tag"><Icon name="branch" size={10} />{t('PR')}</span>}</span>
          <span className="hm-item-sub">{l.sub}</span>
          {phone && when}
        </span>
        {!phone && when}
      </button>
      {!phone && !open && <div className="hm-quick">{r.pr}{r.handOn}{r.clearBtn}{pin}{r.openBtn}</div>}
      {open && (
        <div className="hm-item-more">
          {l.full && l.full !== l.sub && <p className="hm-full">{l.full}</p>}
          <div className="hm-item-acts">
            {r.replyBtn}{r.pr}{r.handOn}
            <span className="ny-grow" />
            {r.clearBtn}{pin}{r.openBtn}
          </div>
          {r.form}
        </div>
      )}
    </li>
  )
}

// Anything else as a card, when it's pinned: the same look, and the same buttons in the same
// places, as what waits on you.
function ItemCard({ it, phone, onRead, h, pin }) {
  const r = useReady(it, { phone, h, onRead })
  const { l } = r
  const a = it.agent || {}
  const when = it.kind === 'task' ? (it.task.done ? dayName(it.task.done) : null) : it.at ? ago(it.at) : null
  return (
    <article className={`ny-item hm-card k-${it.kind} ${r.off ? 'off' : ''}`} aria-label={`${l.kind}: ${l.title}`}>
      <div className="ny-top">
        {l.dot ? <StatusDot status={l.dot} size={8} /> : <Icon name={l.icon} size={12} />}
        <span className="ny-kind">{l.kind}</span>
        {when && <span className="ny-age">{when}</span>}
        <span className="ny-grow" />
        <DeviceChip it={it} />
        {pin}
      </div>
      {it.kind === 'agent' ? (
        <>
          <p className="ny-text said">{gist(it.text, 220) || l.sub}</p>
          <div className="ny-meta"><b className="ny-agent">{l.title}</b>{l.what && <span>{l.what}</span>}{a.kindLabel && <span className="muted">{a.kindLabel}</span>}</div>
        </>
      ) : (
        <>
          <p className="ny-text">{l.title}</p>
          <div className="ny-meta"><span className="hm-clamp">{l.sub}</span></div>
        </>
      )}
      <div className="ny-acts">
        {r.replyBtn}{r.pr}{r.handOn}
        <span className="ny-grow" />
        {r.clearBtn}{r.openBtn}
      </div>
      {r.form}
    </article>
  )
}

// A meeting coming up: when, the brief from the last in the series (for the next one), the files in
// its invite, Join, and Prep for one with other people (Prep Assist: who's coming, last time, your
// mail with them, goals to go in with), the whole of it in the calendar.
function EventRow({ e, now, next, onOpenMeeting, onCalendar }) {
  const brief = useBrief(next ? e : null)
  const [prep, setPrep] = useState(false)
  const others = e.attendeeCount > 1 || (e.attendees || []).length > 1
  const on = Date.parse(e.start) <= now
  const last = brief?.last
  // Still open: not done, and not ticked in the notes (as Prep counts them).
  const open = (brief?.items || []).filter((x) => x.state !== 'done' && !x.ticked).length
  const was = last && { title: shortTitle(last.title, 40), date: new Date(last.startedAt).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }), n: open }
  const wait = Date.parse(e.start) - now
  const when = on ? t('On now, until {time}', { time: fmt(e.end) }) : wait < 3 * 3600e3 ? t('In {wait}', { wait: mins(wait) }) : null
  const said = next && (!last ? t('No earlier meeting to brief you from') : open ? t('Brief: last time, {title} on {date}, {n} still open', was) : t('Brief: last time, {title} on {date}', was))
  return (
    <li className={`hm-ev ${on ? 'now' : ''}`}>
      <span className="hm-time">{on ? t('Now') : fmt(e.start)}</span>
      <div className="hm-ev-main">
        <b>{e.title}</b>
        {(when || said) && <span className="hm-item-sub">{[when, said].filter(Boolean).join(' · ')}</span>}
        {e.links?.length > 0 && <span className="hm-links">{e.links.slice(0, 4).map((x, i) => <a key={i} href={x.url} target="_blank" rel="noreferrer"><Icon name="file" size={11} />{shortTitle(x.name || x.url, 40)}</a>)}</span>}
        {others && <button type="button" className={`link-btn hm-prep-btn${prep ? ' on' : ''}`} aria-expanded={prep} onClick={() => setPrep(!prep)} title={t("Who's coming, last time with them, your mail with them and goals to go in with")}><Icon name="bulb" size={11} /> {prep ? t('Hide prep') : t('Prep')}</button>}
      </div>
      {(e.join || next) && (
        <div className="hm-ev-acts">
          {e.join && <a className="btn small" href={e.join} target="_blank" rel="noreferrer"><Icon name="video" size={12} /> {t('Join')}</a>}
          {next && (last ? <button type="button" className="btn small" onClick={() => onOpenMeeting({ machine: machineId || null, online: true, meeting: { id: last.id } })}><Icon name="doc" size={12} /> {t('Open brief')}</button>
            : <button type="button" className="btn small" onClick={onCalendar}><Icon name="calendar" size={12} /> {t('Calendar')}</button>)}
        </div>
      )}
      {prep && (
        <div className="hm-prep">
          <PrepCard e={e} size="compact" invite={false} onOpenEvent={() => window.dispatchEvent(new CustomEvent('bridge-open-event', { detail: { date: dayKey(e.start), id: e.id } }))} />
        </div>
      )}
    </li>
  )
}

// One of the Chief of Staff's tasks, as a row that opens the Chief of Staff it's with. lead: what
// goes where a meeting's time does (Due, Overdue, On it now). Its pin: on the row while the pointer
// is on it, and always on a phone (where there's no pointer).
function TaskRow({ it, lead, multi, phone, onOpenChief, pin }) {
  const off = !it.online
  const dev = multi && <span className="hm-item-when"><span className="hm-dev"><Icon name="laptop" size={10} />{it.device}{off ? ` · ${t('offline')}` : ''}</span></span>
  return (
    <li className={`hm-item hm-trow ${off ? 'off' : ''}`}>
      <button type="button" className="hm-item-main" onClick={() => onOpenChief(it)} disabled={off} title={off ? t('{name} is offline', { name: it.device }) : switches(it) ? openWords(it).title : t('Open Chief of Staff')}>
        {lead ? <span className={`hm-time ${lead.cls || ''}`}>{lead.text}</span> : <span className="hm-item-ico"><Icon name="helm" size={13} /></span>}
        <span className="hm-item-body">
          <span className="hm-item-l1"><b>{it.task.title}</b></span>
          {lead?.sub && <span className="hm-item-sub">{lead.sub}</span>}
          {phone && dev}
        </span>
        {!phone && dev}
      </button>
      {phone ? <span className="hm-trow-pin">{pin}</span> : <div className="hm-quick">{pin}</div>}
    </li>
  )
}

// The other computers' things while Home shows this one's: a line each (how many, and what needs you
// there first), opened one at a time to see them and answer them right here, as yours are. rows:
// { d, key, list, needs, quiet, ready, coming } for each; cards, list, task, quiet: how Home shows
// each kind (what has gone quiet there is said quietly on its line, and folded when it's opened).
function Away({ rows, open, setOpen, cards, list, task, quiet, onShowAll }) {
  const total = rows.reduce((n, r) => n + r.list.length, 0)
  const head = rows.length === 1 ? (total === 1 ? t('1 more on another computer') : t('{n} more on another computer', { n: total })) : t('{n} more on {m} other computers', { n: total, m: rows.length })
  return (
    <section className="hm-sec hm-away" aria-label={t('On Other Computers')}>
      <h3>
        {t('On Other Computers')}<span className="hm-hint">{head}</span>
        <span className="ny-grow" />
        <button type="button" className="ghost-btn hm-away-all" onClick={onShowAll} title={t('Show every computer\'s things together (the Device menu above)')}><Icon name="laptop" size={12} /> {t('Show all together')}</button>
      </h3>
      <ul className="hm-away-list">
        {rows.map((r) => {
          const on = !!open[r.key] && r.list.length > 0
          const bits = [
            r.needs.length > 0 && (r.needs.length === 1 ? t('1 needs you') : t('{n} need you', { n: r.needs.length })),
            r.ready.length > 0 && t('{n} ready to look at', { n: r.ready.length }),
            r.coming.length > 0 && t('{n} coming up', { n: r.coming.length }),
            r.quiet.length > 0 && t('{n} quiet', { n: r.quiet.length }),
          ].filter(Boolean)
          return (
            <li key={r.key} className={`hm-away-row ${r.needs.length ? 'needs' : ''} ${r.d.online ? '' : 'off'} ${on ? 'open' : ''}`}>
              <button type="button" className="hm-away-line" aria-expanded={on} disabled={!r.list.length} onClick={() => setOpen((o) => ({ ...o, [r.key]: !on }))}>
                <Icon name="chevron" size={12} className={`caret ${on ? 'rot90' : ''}`} />
                <span className={`mc-dot ${r.d.online ? 'on' : ''}`} />
                <b className="hm-away-name">{r.d.name}</b>
                <span className="hm-away-sub">{bits.length ? bits.join(' · ') : t('Nothing waiting on you there')}{r.d.online ? '' : ` · ${t('offline')}`}</span>
                {r.list.length > 0 && <span className="hm-away-show">{on ? t('Hide') : t('Show')}</span>}
              </button>
              {r.d.partial && r.d.online && <p className="muted small hm-away-note">{t('Only what needs you, for now: update Bridge AI on it to see its meetings, tasks and whiteboards here.')}</p>}
              {on && (
                <div className="hm-away-items">
                  {r.needs.length > 0 && cards(r.needs)}
                  {r.ready.length > 0 && list(r.ready)}
                  {r.coming.length > 0 && <ul className="hm-list">{r.coming.map(task)}</ul>}
                  {r.quiet.length > 0 && quiet(r.quiet)}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// What has gone quiet on one of your other computers, folded under its line until you open it.
function QuietThere(props) {
  const [open, setOpen] = useState(false)
  return <QuietFold {...props} open={open} setOpen={setOpen} />
}

// Home itself. phone: the phone's Home tab. onOpen(item): an agent wherever it runs; onOpenMeeting,
// onOpenBoard, onOpenChief: the rest, here or on their own device; onEverything, onCalendar.
export default function NeedsHome({ phone = false, calendar = false, onOpen, onOpenMeeting, onOpenBoard, onOpenChief, onEverything, onCalendar }) {
  const { data, error, refresh } = useHome(true)
  const [kind, setKind] = useState('all')
  const [picked, setDevice] = useDevicePick()
  const [awayOpen, setAwayOpen] = useState({}) // the other computers whose things are out, under Waiting on You
  const [sort, setSort] = useSort()
  const [gone, setGone] = useState({})
  const [note, setNote] = useState(null)
  const [openId, setOpenId] = useState(null) // the ready row whose whole text is out
  const [more, setMore] = useState(false) // the last day's finished work, all of it
  const [older, setOlder] = useState(false) // what's older than a day, unfolded
  const [todo, setTodo] = useState(false) // the Chief of Staff's tasks with no day, unfolded
  const [sure, setSure] = useState(false) // Clear all older, asked once more
  const [quietOpen, setQuietOpen] = useState(false) // what has gone quiet, unfolded
  const [read, markRead] = useRead()
  const pins = usePins(data, refresh, setNote)
  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(null), 6000); return () => clearTimeout(id) }, [note])
  const cal = useComing(calendar)
  const devices = data?.devices || []
  const multi = devices.length > 1
  const here = devices.find((d) => (d.id || 'here') === SHOWN)
  // This computer, all of them, or one of the others (this one picked by its name is this one; one
  // no longer linked is this one again).
  const device = !multi || picked === SHOWN ? 'this' : picked === 'all' || devices.some((d) => (d.id || 'here') === picked) ? picked : 'this'
  const focus = multi && device === 'this'
  // The calendar is the computer this window shows (the page asks it).
  const events = cal.events.map((e) => ({ id: `cal:${e.id}`, uid: `${SHOWN}|cal:${e.id}`, kind: 'meeting', group: 'coming', event: e, machine: machineId || null, online: true, device: here?.name || devices[0]?.name, at: e.start }))
  // What needs you, is ready or is coming up, and what you pinned (a whiteboard you've opened since too).
  const all = [...(data?.items || []), ...events].filter((i) => (i.group || pins.has(i.uid)) && !gone[i.uid])
  const onDev = (i) => device === 'all' || devOf(i) === (device === 'this' ? SHOWN : device)
  const ofKind = (i) => kind === 'all' || kindOf(i) === kind
  // Pinned: at the top, as cards, and nowhere else, from any computer while it's this one's things
  // (you put each there yourself). A meeting on the calendar keeps its time.
  const isPinned = (i) => !i.event && pins.has(i.uid)
  const shown = all.filter((i) => (onDev(i) || (focus && isPinned(i))) && ofKind(i))
  const count = (k) => all.filter((i) => (onDev(i) || (focus && isPinned(i))) && (k === 'all' || kindOf(i) === k)).length
  const pinned = sortBy(shown.filter(isPinned), sort)
  const rest = shown.filter((i) => !isPinned(i))
  // This computer's things: the others' are a line each (what needs you there, what's ready, what's
  // coming up), opened one at a time, rather than among yours.
  const away = focus ? all.filter((i) => !onShown(i) && !isPinned(i) && ofKind(i)) : []
  const awayBy = devices.filter((d) => (d.id || 'here') !== SHOWN).map((d) => {
    const list = away.filter((i) => devOf(i) === (d.id || 'here'))
    const waits = split(list.filter((i) => i.group === 'needs'))
    return { d, key: d.id || 'here', list, needs: sortBy(waits.now, sort), quiet: waits.quiet, ready: sortBy(list.filter((i) => i.group === 'ready'), sort), coming: list.filter((i) => i.group === 'coming' && i.kind === 'task') }
  }).filter((x) => x.list.length || (x.d.partial && x.d.online))
  // What needs you now, in the order picked, the first few of it (in shared/focus.js's order,
  // whatever the order picked) said with why; what has gone quiet folded under it.
  const waits = split(rest.filter((i) => i.group === 'needs'))
  const needs = sortBy(waits.now, sort)
  const quiet = waits.quiet
  const top = new Set(waits.now.slice(0, TOP).map((i) => i.uid))
  // Ready to look at: newest first (or as picked); the last day's few, then Show all; anything older folded away.
  const ready = sortBy(rest.filter((i) => i.group === 'ready'), sort)
  const recent = ready.filter((i) => Date.now() - time(i) < DAY)
  const old = ready.filter((i) => Date.now() - time(i) >= DAY)
  const clearable = (i) => i.kind === 'agent' && i.type === 'review' && i.online && !i.old
  const readOnes = ready.filter((i) => read.has(i.uid) && clearable(i))
  // Coming up, a day at a time: the meetings at their times, then the tasks that name that day (one
  // overdue is today's). The Chief of Staff's other tasks: the ones it's on, and the rest folded, in
  // its list's order or as picked (each row says its computer, so by computer is in their order).
  const tasks = rest.filter((i) => i.kind === 'task' && i.group === 'coming')
  const today = dayKey(Date.now())
  const days = new Map()
  const put = (k, row) => { if (!days.has(k)) days.set(k, []); days.get(k).push(row) }
  for (const i of rest.filter((x) => x.kind === 'meeting' && x.group === 'coming')) put(dayKey(i.event.start), i)
  for (const i of tasks.filter((x) => x.task.due).sort((x, y) => x.task.due.localeCompare(y.task.due))) put(i.task.due < today ? today : i.task.due, i)
  const coming = [...days.keys()].sort().map((k) => ({ key: k, label: dayName(k), rows: days.get(k) }))
  const devAt = (i) => devices.findIndex((d) => (d.id || 'here') === (i.machine || 'here'))
  const inOrder = (list) => (sort === 'newest' || sort === 'oldest' ? sortBy(list, sort) : sort === 'device' ? [...list].sort((x, y) => devAt(x) - devAt(y)) : list)
  const doing = inOrder(tasks.filter((i) => !i.task.due && i.task.status === 'doing'))
  const todos = inOrder(tasks.filter((i) => !i.task.due && i.task.status !== 'doing'))
  // Everything that needs you now on the computers shown, on or not, of every kind (the heading
  // counts it all, whichever kind is picked below it); not what has gone quiet, unless it's pinned.
  const needing = all.filter((i) => onDev(i) && i.group === 'needs' && (isPinned(i) || !isQuiet(i)))
  const quietHere = all.filter((i) => onDev(i) && i.group === 'needs' && !isPinned(i) && isQuiet(i)).length
  const onGone = (it, said) => {
    setGone((g) => ({ ...g, [it.uid]: Date.now() }))
    if (said) setNote({ text: `${said} · ${it.agent?.title || it.task?.title || ''}` })
    for (const ms of [0, 1500, 4000]) setTimeout(refresh, ms)
  }
  // Clear several (read ones, or all that are older than a day), each on its own device: off the
  // list at once, and back with a note for any its device couldn't clear.
  const clearAll = async (list) => {
    setSure(false)
    setGone((g) => ({ ...g, ...Object.fromEntries(list.map((i) => [i.uid, Date.now()])) }))
    const missed = []
    await Promise.all(list.map((i) => onDevice(i.machine, '/needs-you/clear', { id: i.nid || i.id }).catch(() => missed.push(i))))
    if (missed.length) setGone((g) => { const n = { ...g }; for (const i of missed) delete n[i.uid]; return n })
    const done = list.length - missed.length
    setNote({ text: missed.length ? t("Cleared {n}; {m} couldn't be cleared from here. Open them instead.", { n: done, m: missed.length }) : done === 1 ? t('Cleared 1') : t('Cleared {n}', { n: done }) })
    refresh()
  }
  const offline = devices.filter((d) => !d.online).length
  // A computer that sends only what needs you (an older Bridge AI): said once, at the top for the
  // computers shown, or on its line among the others.
  const partial = devices.filter((d) => d.partial && d.online && (device === 'all' || (d.id || 'here') === (device === 'this' ? SHOWN : device)))
  const pickedDev = devices.find((d) => (d.id || 'here') === device)
  const where = !multi ? t('On this computer') : focus ? t('On {name}, this computer', { name: here?.name || '' })
    : pickedDev ? t('On {name}', { name: pickedDev.name }) : offline ? t('On {n} computers · {m} offline', { n: devices.length, m: offline }) : t('On {n} computers', { n: devices.length })
  const date = new Date().toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' })
  const h = { onOpen, onOpenMeeting, onOpenBoard, onOpenChief, onGone, setNote, refresh }
  const pinOf = (it) => <PinBtn on={pins.has(it.uid)} onClick={() => pins.toggle(it)} />
  const row = (it) => <ReadyItem key={it.uid} it={it} multi={multi} phone={phone} read={read.has(it.uid)} open={openId === it.uid} onToggle={() => setOpenId(openId === it.uid ? null : it.uid)} onRead={() => markRead(it.uid)} h={h} pin={pinOf(it)} />
  const rows = (list) => <ul className="hm-list hm-ready">{list.map(row)}</ul>
  // A card for each: the inbox's own for an agent waiting (with its own id: Clear and the answers
  // take it), a task's, or the one for anything else that's pinned. quiet: one opened in the quiet
  // fold, which Clear can take off the list whatever it is.
  const card = (it, quiet = false) => (it.group === 'needs' && it.kind === 'task' ? <TaskWaiting key={it.uid} it={it} top={top.has(it.uid)} onOpenChief={onOpenChief} onGone={onGone} setNote={setNote} pin={pinOf(it)} />
    : it.group === 'needs' ? <NeedsItem key={it.uid} it={{ ...it, id: it.nid || it.id }} top={top.has(it.uid)} quiet={quiet} onOpen={onOpen} onGone={(x, said) => onGone(it, said)} setNote={setNote} pin={pinOf(it)} />
      : <ItemCard key={it.uid} it={it} phone={phone} onRead={() => markRead(it.uid)} h={h} pin={pinOf(it)} />)
  const cards = (list) => <div className="hm-grid">{list.map((it) => card(it))}</div>
  // The quiet fold's rows, each opening to its card; Clear all takes each agent's off its device's list.
  const quietProps = { uid: (i) => i.uid, multi: multi && device === 'all', card: (it) => card(it, true), onClearAll: clearAll }
  const lead = (i) => {
    const late = i.task.due < today
    const on = i.task.status === 'doing'
    const sub = late ? t('Chief of Staff · was due {date}', { date: new Date(`${i.task.due}T12:00:00`).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) }) : on ? t('Chief of Staff · on it now') : t('Chief of Staff · to do')
    return { text: late ? t('Overdue') : t('Due'), cls: late ? 'late' : 'due', sub }
  }
  const taskRow = (i, lead) => <TaskRow key={i.uid} it={i} lead={lead} multi={multi} phone={phone} onOpenChief={onOpenChief} pin={pinOf(i)} />
  const showAll = kind === 'all'
  const shownRecent = more ? recent : recent.slice(0, CAP)
  const pinnedOf = (g) => pinned.some((i) => i.group === g)
  return (
    <div className={`hm by-${sort} ${phone ? 'phone' : ''}`}>
      <div className="hm-in">
        <header className="hm-head">
          <div className="hm-title">
            {/* Until the list has come (or when it can't), no count: "Nothing needs you" would be a guess. */}
            {!data ? <h2>{t('Home')}</h2> : <NeedCount list={needing} devices={devices} quiet={quietHere} />}
            <p className="muted">{date}{data && <><span className="hm-sep"> · </span><span className="hm-where">{where}</span></>}</p>
          </div>
          <button type="button" className="btn small hm-every" onClick={onEverything}>{t('See everything')} <Icon name="chevron" size={11} /></button>
        </header>
        {/* What to show (a kind, a computer) and in what order, once there's something to show. */}
        {data && (all.length > 0 || multi) && (
          <div className="hm-bar">
            {(count('all') > 0 || kind !== 'all') && (
              <div className="chips hm-kinds" role="tablist" aria-label={t('Kind')}>
                {KINDS.map(([id, label]) => {
                  const n = count(id)
                  if (id !== 'all' && !n && kind !== id) return null
                  return <button key={id} type="button" role="tab" aria-selected={kind === id} className={`fchip ${kind === id ? 'on' : ''}`} onClick={() => setKind(kind === id ? 'all' : id)}>{t(label)}<span className="fcount">{n}</span></button>
                })}
              </div>
            )}
            <div className="hm-tools">
              {all.length > 0 && (
                <label className="hm-pick" title={t('Sort')}>
                  <Icon name="sort" size={13} />
                  <select className="hm-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('Sort')}>
                    {SORTS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
                  </select>
                  <Icon name="down" size={12} />
                </label>
              )}
              {multi && (
                <label className="hm-pick" title={t('Device')}>
                  <Icon name="laptop" size={13} />
                  <select className="hm-device" value={device} onChange={(e) => setDevice(e.target.value)} aria-label={t('Device')}>
                    <option value="this">{t('This computer')}</option>
                    <option value="all">{t('All devices')}</option>
                    {devices.filter((d) => (d.id || 'here') !== SHOWN).map((d) => <option key={d.id || 'here'} value={d.id || 'here'}>{d.online ? d.name : t('{name} (offline)', { name: d.name })}</option>)}
                  </select>
                  <Icon name="down" size={12} />
                </label>
              )}
            </div>
          </div>
        )}
        {(error || partial.length > 0) && (
          <div className="hm-notices">
            {error && (
              <Notice tone="error" icon="alert" role="alert" className="hm-err">
                {data ? t("Home couldn't update: {why}. This is what it had last.", { why: error }) : t("Home couldn't load: {why}", { why: error })}
                <button type="button" className="link-btn" onClick={refresh}>{t('Try again')}</button>
              </Notice>
            )}
            {partial.length > 0 && (
              <Notice className="hm-partial">
                {partial.map((d) => <span key={d.id} className="ny-device"><Icon name="laptop" size={11} />{d.name}</span>)}
                {partial.length === 1 ? t('Only what needs you, for now: update Bridge AI on it to see its meetings, tasks and whiteboards here.') : t('Only what needs you, for now: update Bridge AI on them to see their meetings, tasks and whiteboards here.')}
              </Notice>
            )}
          </div>
        )}
        {!data && !error && (
          <div className="hm-loading" role="status" aria-label={t('Loading what needs you on each computer…')}>
            <div className="hm-skel hm-skel-h" />
            <div className="hm-grid"><div className="hm-skel hm-skel-card" /><div className="hm-skel hm-skel-card" /></div>
            <div className="hm-skel hm-skel-list" />
          </div>
        )}
        {data && (
          <>
            {pinned.length > 0 && (
              <section className="hm-sec hm-pinned" aria-label={t('Pinned')}>
                <h3><Icon name="pin" size={13} />{t('Pinned')}<span className="fcount">{pinned.length}</span><span className="hm-hint">{t('at the top until you unpin it')}</span></h3>
                {grouped(pinned, sort, devices, cards)}
              </section>
            )}
            {(showAll || needs.length > 0 || quiet.length > 0) && (
              <section className="hm-sec hm-waiting" aria-label={t('Waiting on You')}>
                <h3>{t('Waiting on You')}{needs.length > 0 && <span className="fcount">{needs.length}</span>}<span className="hm-hint">{t('your answer starts them again')}</span></h3>
                {needs.length > 0 ? grouped(needs, sort, devices, cards)
                  : pinnedOf('needs') ? <p className="muted small hm-none">{t('Pinned, at the top.')}</p>
                    : <div className="hm-empty"><Icon name="check" size={16} /><span>{focus ? t('Nothing needs you on this computer right now.') : t('Nothing needs you right now.')}</span></div>}
                <QuietFold items={quiet} open={quietOpen} setOpen={setQuietOpen} {...quietProps} />
              </section>
            )}
            {awayBy.length > 0 && <Away rows={awayBy} open={awayOpen} setOpen={setAwayOpen} cards={cards} list={rows} task={(i) => taskRow(i, i.task.due ? lead(i) : i.task.status === 'doing' ? { text: t('On it'), cls: 'doing' } : null)} quiet={(list) => <QuietThere items={list} {...quietProps} multi={false} />} onShowAll={() => setDevice('all')} />}
            <div className="hm-cols">
              {(showAll || ready.length > 0) && (
                <section className="hm-sec" aria-label={t('Ready to Look At')}>
                  <h3>
                    {t('Ready to Look At')}{ready.length > 0 && <span className="fcount">{ready.length}</span>}
                    <span className="ny-grow" />
                    {readOnes.length > 0 && <button type="button" className="ghost-btn hm-clear-read" onClick={() => clearAll(readOnes)} title={t('Take the finished work you\'ve opened off the list until each has something new')}><Icon name="check" size={12} /> {t('Clear read · {n}', { n: readOnes.length })}</button>}
                  </h3>
                  {recent.length > 0 && grouped(shownRecent, sort, devices, rows)}
                  {recent.length > CAP && (
                    <button type="button" className="hm-more-btn" aria-expanded={more} onClick={() => setMore(!more)}><Icon name={more ? 'up' : 'down'} size={12} />{more ? t('Show fewer') : t('Show all {n}', { n: recent.length })}</button>
                  )}
                  {!recent.length && old.length > 0 && <p className="muted small hm-none">{t('Nothing new in the last day.')}</p>}
                  {old.length > 0 && (
                    <div className="hm-fold-box">
                      <div className="hm-fold-row">
                        <button type="button" className="hm-fold" aria-expanded={older} onClick={() => { setOlder(!older); setSure(false) }}>
                          <Icon name="chevron" size={12} />{t('Older than a day')}<span className="fcount">{old.length}</span>
                        </button>
                        {old.some(clearable) && (sure
                          ? <span className="hm-sure">{t('Clear {n}? Each comes back when it has something new.', { n: old.filter(clearable).length })}<button type="button" className="btn small" onClick={() => clearAll(old.filter(clearable))}><Icon name="check" size={12} /> {t('Clear')}</button><button type="button" className="ghost-btn" onClick={() => setSure(false)}>{t('Cancel')}</button></span>
                          : <button type="button" className="ghost-btn hm-clear-old" onClick={() => setSure(true)}><Icon name="check" size={12} /> {t('Clear all')}</button>)}
                      </div>
                      {older && grouped(old, sort, devices, rows)}
                    </div>
                  )}
                  {!ready.length && (pinnedOf('ready') ? <p className="muted small hm-none">{t('Pinned, at the top.')}</p> : (
                    <div className="hm-none">
                      <p>{t('Nothing new to look at.')}</p>
                      <small className="muted">{t('Finished work, meeting notes and whiteboards an agent changed show here.')}</small>
                    </div>
                  ))}
                </section>
              )}
              <div className="hm-side">
                {(showAll || kind === 'meeting' || coming.length > 0) && (
                  <section className="hm-sec" aria-label={t('Coming Up')}>
                    <h3>{t('Coming Up')}</h3>
                    {coming.map((d) => (
                      <div key={d.key} className="hm-day">
                        <h4>{d.label}</h4>
                        <ul className="hm-list">
                          {d.rows.map((i) => (i.event
                            ? <EventRow key={i.uid} e={i.event} now={cal.now} next={i === coming[0].rows.find((x) => x.event)} onOpenMeeting={onOpenMeeting} onCalendar={onCalendar} />
                            : taskRow(i, lead(i))))}
                        </ul>
                      </div>
                    ))}
                    {cal.loading && !coming.length && <p className="muted small hm-none">{t('Looking at your calendar…')}</p>}
                    {cal.error && <p className="muted small hm-none">{t('Your calendar: {why}', { why: cal.error })} <button type="button" className="link-btn" onClick={onCalendar}>{t('Set up')}</button></p>}
                    {!coming.length && !cal.error && !cal.loading && <p className="muted small hm-none">{calendar ? t('Nothing on your calendar for the rest of today or tomorrow, and no task with a day.') : t('No task with a day coming up.')}</p>}
                  </section>
                )}
                {(showAll || kind === 'chief') && (
                  <section className="hm-sec" aria-label={t("Chief of Staff's Tasks")}>
                    <h3>{t("Chief of Staff's Tasks")}{doing.length + todos.length > 0 && <span className="fcount">{doing.length + todos.length}</span>}</h3>
                    {doing.length > 0 && <ul className="hm-list">{doing.map((i) => taskRow(i, { text: t('On it'), cls: 'doing' }))}</ul>}
                    {todos.length > 0 && (
                      <div className="hm-fold-box">
                        <button type="button" className="hm-fold" aria-expanded={todo} onClick={() => setTodo(!todo)}>
                          <Icon name="chevron" size={12} />{todos.length === 1 ? t('1 to do, with no day set') : t('{n} to do, with no day set', { n: todos.length })}
                        </button>
                        {todo && <ul className="hm-list">{todos.map((i) => taskRow(i, null))}</ul>}
                      </div>
                    )}
                    {!doing.length && !todos.length && <p className="muted small hm-none">{tasks.length ? t('Each of its tasks has a day: they\'re under Coming Up.') : pinned.some((i) => i.kind === 'task') ? t('Pinned, at the top.') : t('Nothing on Chief of Staff\'s list.')}</p>}
                  </section>
                )}
              </div>
            </div>
          </>
        )}
        {note && <p className="hm-toast" role="status">{note.text}</p>}
      </div>
    </div>
  )
}


// ---------- Everything ----------
// Every item on every computer: each computer's agents (the Agent Map's), what waits on you, its
// meetings this week, the Chief of Staff's tasks and its whiteboards, in a lane per computer, or a
// lane per kind. A computer that's offline keeps its lane with what it last said.
const LANES = [['agent', tx('Agents')], ['needs', tx('Questions')], ['meeting', tx('Meetings')], ['task', tx('Chief of Staff tasks')], ['board', tx('Whiteboards')]]
export function Everything({ phone = false, onOpenAgent, onOpenMeeting, onOpenBoard, onOpenChief, onBack }) {
  const home = useHome(true)
  const map = useAgentMap(true)
  const [by, setBy] = useState(() => { try { return localStorage.getItem('cc-every-by') || 'device' } catch { return 'device' } })
  const [kind, setKind] = useState('all')
  const [mine, setMine] = useState(false)
  const pick = (v) => { setBy(v); try { localStorage.setItem('cc-every-by', v) } catch { /* no storage */ } }
  const devices = useMemo(() => {
    const ds = home.data?.devices || (map.data?.devices || []).map((d) => ({ id: d.id, name: d.name, online: d.online, here: d.here, os: d.os }))
    // The computer this window shows first.
    return [...ds].sort((x, y) => ((y.id || 'here') === SHOWN) - ((x.id || 'here') === SHOWN)).map((d) => ({ ...d, agents: (map.data?.devices || []).find((x) => (x.id || null) === (d.id || null))?.agents || [] }))
  }, [home.data, map.data])
  // One list of things: each agent (not one that only waits on you: that's its question), then the
  // rest of Home's items.
  const things = useMemo(() => {
    const items = home.data?.items || []
    const asking = new Set(items.filter((i) => i.kind === 'agent' && i.group === 'needs').map((i) => `${i.machine || ''}:${i.paneId}`))
    const agents = devices.flatMap((d) => d.agents.filter((a) => !asking.has(`${d.id || ''}:${a.paneId}`)).map((a) => ({ id: `a:${d.id || ''}:${a.paneId}`, lane: 'agent', a, machine: d.id || null, device: d.name, online: !!d.online, needs: a.status === 'blocked' })))
    const rest = items.filter((i) => i.kind !== 'agent' || i.group === 'needs').map((i) => ({ ...i, lane: i.kind === 'agent' ? 'needs' : i.kind, needs: i.group === 'needs' }))
    return [...agents, ...rest]
  }, [devices, home.data])
  const counts = Object.fromEntries(LANES.map(([k]) => [k, things.filter((x) => x.lane === k).length]))
  const shown = things.filter((x) => (kind === 'all' || x.lane === kind) && (!mine || x.needs))
  // What needs you now, as Home counts it: one that has gone quiet is here too, said to be quiet.
  const hush = (x) => x.needs && x.lane !== 'agent' && isQuiet(x)
  const needN = things.filter((x) => x.needs && x.online && !hush(x)).length
  const open = (x) => {
    if (x.lane === 'agent') return onOpenAgent(x)
    if (x.lane === 'needs') return onOpenAgent({ ...x, a: { paneId: x.paneId, name: x.agent?.title, kind: x.agent?.kind } })
    if (x.lane === 'meeting') return onOpenMeeting(x)
    if (x.lane === 'board') return onOpenBoard(x)
    return onOpenChief(x)
  }
  const line = (x) => {
    if (x.lane === 'agent') return { dot: x.a.status, title: [same(x.a.project, x.a.name || x.a.title) ? null : x.a.project, x.a.name || x.a.title].filter(Boolean).join(' · '), sub: x.a.asking || x.a.doing?.text || x.a.kindLabel || x.a.kind }
    if (x.lane === 'needs') return { dot: x.type === 'failed' ? 'unknown' : 'blocked', title: [same(x.agent?.project, x.agent?.title) ? null : x.agent?.project, x.agent?.title].filter(Boolean).join(' · '), sub: x.text || t('Waiting on you') }
    if (x.lane === 'meeting') return { icon: 'mic', title: x.meeting.title, sub: x.meeting.status === 'recording' ? t('Recording') : x.unsent ? (x.unsent === 1 ? t('1 action item not handed on yet') : t('{n} action items not handed on yet', { n: x.unsent })) : x.meeting.hasSummary ? t('Notes ready') : ago(x.meeting.startedAt) }
    if (x.lane === 'board') return { icon: 'shapes', title: x.board.title, sub: x.board.changed ? t('Changed {when}, since you last looked', { when: ago(x.at) }) : t('Changed {when}', { when: ago(x.at) }) }
    return { icon: 'helm', title: x.task.title, sub: x.task.status === 'waiting' ? x.task.needs || t('Waiting on you') : x.task.status === 'done' ? x.task.outcome || t('Done') : x.task.status === 'doing' ? t('On it now') : t('To do') }
  }
  const item = (x, showDev) => {
    const l = line(x)
    return (
      <button key={x.uid || x.id} type="button" className={`ey-item ${x.needs && !hush(x) ? 'needs' : ''}`} onClick={() => open(x)} disabled={!x.online} title={x.online ? t('Open') : t('{name} is offline', { name: x.device })}>
        {l.dot ? <StatusDot status={x.online ? l.dot : 'unknown'} size={8} /> : <span className="hm-ico"><Icon name={l.icon} size={12} /></span>}
        <span className="ey-text"><b>{l.title}</b>{(l.sub || showDev) && <small>{showDev ? [x.device, l.sub].filter(Boolean).join(' · ') : l.sub}</small>}{hush(x) && <em className="ey-quiet">{t('Quiet for {n}+ days', { n: QUIET_DAYS })}</em>}</span>
      </button>
    )
  }
  // By kind, filtered (Only what needs me): the kinds with something in them.
  const kinds = LANES.filter(([k]) => kind === 'all' || kind === k).map(([k, label]) => ({ key: k, label: t(label), list: shown.filter((x) => x.lane === k) }))
  const lanes = by === 'device'
    ? devices.map((d) => ({ key: d.id || 'here', d, list: shown.filter((x) => (x.machine || null) === (d.id || null)) }))
    : mine && kinds.some((l) => l.list.length) ? kinds.filter((l) => l.list.length) : kinds
  const error = home.error && map.error ? home.error : null
  return (
    <div className={`ey ${phone ? 'phone' : ''}`}>
      <div className="hm-in">
        <header className="ey-head">
          {onBack && <button type="button" className="ghost-btn m-view-back" onClick={onBack}><Icon name="back" size={14} /> {t('Home')}</button>}
          <div className="hm-title">
            <h2>{t('Everything')}</h2>
            <p className="muted">{[
              devices.length > 1 ? (things.length === 1 ? t('1 thing on {m} computers', { m: devices.length }) : t('{n} things on {m} computers', { n: things.length, m: devices.length }))
                : things.length === 1 ? t('1 thing on this computer') : t('{n} things on this computer', { n: things.length }),
              needN === 1 ? t('{n} needs you', { n: needN }) : t('{n} need you', { n: needN }),
            ].join(' · ')}</p>
          </div>
          <div className="ey-seg" role="tablist" aria-label={t('Lanes')}>
            <button type="button" role="tab" aria-selected={by === 'device'} className={by === 'device' ? 'on' : ''} onClick={() => pick('device')}>{t('By device')}</button>
            <button type="button" role="tab" aria-selected={by === 'kind'} className={by === 'kind' ? 'on' : ''} onClick={() => pick('kind')}>{t('By kind')}</button>
          </div>
        </header>
        <div className="ey-filters">
          <div className="chips" role="tablist" aria-label={t('Kind')}>
            <button type="button" role="tab" aria-selected={kind === 'all'} className={`fchip ${kind === 'all' ? 'on' : ''}`} onClick={() => setKind('all')}>{t('All')}<span className="fcount">{things.length}</span></button>
            {LANES.map(([k, label]) => (counts[k] || kind === k) && <button key={k} type="button" role="tab" aria-selected={kind === k} className={`fchip ${kind === k ? 'on' : ''}`} onClick={() => setKind(kind === k ? 'all' : k)}>{t(label)}<span className="fcount">{counts[k]}</span></button>)}
          </div>
          <label className="st-check ey-mine"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t('Only what needs me')}</label>
        </div>
        {error && (
          <div className="hm-notices">
            <Notice tone="error" icon="alert" role="alert" className="hm-err">
              {t("Everything couldn't load: {why}", { why: error })}
              <button type="button" className="link-btn" onClick={() => { home.refresh(); map.refresh() }}>{t('Try again')}</button>
            </Notice>
          </div>
        )}
        {!home.data && !map.data && !error && <div className="skeleton-rows pad" role="status" aria-label={t('Loading everything on each computer…')}><div /><div /><div /></div>}
        {(home.data || map.data) && (
          <div className="ey-lanes">
            {lanes.map((l) => (
              <section key={l.key} className={`ey-lane ${l.d && !l.d.online ? 'off' : ''}`} aria-label={l.d ? l.d.name : l.label}>
                <header className="ey-lane-head">
                  {l.d ? <span className={`mc-dot ${l.d.online ? 'on' : ''}`} /> : null}
                  <div className="am-lane-name">
                    <b>{l.d ? l.d.name : l.label}</b>
                    {l.d && <small className="muted">{(l.d.id || 'here') === SHOWN ? t('this computer') : l.d.online ? t('Online') : (l.d.at || l.d.lastSeen) ? t('Offline · as of {when}', { when: ago(l.d.at || l.d.lastSeen) }) : t('Offline')}</small>}
                  </div>
                  <span className="am-lane-count">{l.list.length}</span>
                </header>
                {l.d && !l.d.online && l.list.length > 0 && <p className="am-said">{t('What it last said. Answers go through once it\'s back.')}</p>}
                {l.d?.partial && l.d.online && <p className="am-said">{t('Only what needs you, for now: update Bridge AI on it to see its meetings, tasks and whiteboards here.')}</p>}
                {by === 'device'
                  ? LANES.map(([k, label]) => {
                    const xs = l.list.filter((x) => x.lane === k)
                    return xs.length > 0 && <div key={k} className="ey-group"><h4>{t(label)}<span className="fcount">{xs.length}</span></h4>{xs.map((x) => item(x, false))}</div>
                  })
                  : l.list.map((x) => item(x, true))}
                {!l.list.length && <p className="muted am-none">{t('Nothing here right now.')}</p>}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
