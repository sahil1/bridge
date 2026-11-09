import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useWidth } from './layout.jsx'
import { api, apiUrl, usePoll, fmtRelative, refetch, viaRelay } from '../api.js'
import PermissionFix, { useRecheck } from './PermissionFix.jsx'
import { ReplyAssist } from './mail/ReplyAssist.jsx'
import AiAssist from './AiAssist.jsx'
import { takeMailDo } from './today.js'
import { useOpenIn } from './openin.js'
import { locale, t, tx } from '../i18n/index.js'
import './mail/mail.css'

// Mail triage over the Mac Mail app's local index: what needs you, automated items that want
// action, threads waiting on someone else, what you set aside, and an agent that can act on any
// message. Read only: Done and Remind me are kept by Bridge AI and leave Mail as it is, Reply
// Assist drafts text for you to send from your own mail app, and Open in Mail shows the message in
// Mail on this Mac, to answer it there. Every action has a key (? lists them,
// ⌘K teaches them), the next few messages are read ahead of you, and new mail shows as soon as
// Mail's index changes.
const isPhone = () => /iPhone|iPad|Android/i.test(navigator.userAgent)

// Why Mail can't be read yet, and one button that fixes it: Allow access (Full Disk Access), or
// Open Mail to add your account and let it sync. Checks again when you come back to the window.
export function MailSetup({ data, onCheck }) {
  if (data.reason === 'noAccess') return <PermissionFix pane="full-disk" onCheck={onCheck}><p>{t(data.setup)}</p></PermissionFix>
  if (data.reason === 'noMail') return <MailNotSetUp text={t(data.setup)} onCheck={onCheck} />
  return <><p>{t(data.setup)}</p><button className="ghost-btn" onClick={onCheck}><Icon name="refresh" size={12} /> {t('Check again')}</button></>
}
// The server's reasons, in your language.
tx("Bridge AI needs Full Disk Access to read Mail's local index. Nothing leaves your Mac."); tx("The inbox reads Apple Mail on macOS. It isn't available on this platform yet."); tx('Mail has nothing on this Mac yet. Add your account to Mail and open it once, so it can sync.')

function MailNotSetUp({ text, onCheck }) {
  const [opened, setOpened] = useState(false)
  const [err, setErr] = useState(null)
  // Mail syncs for a while after you add an account: look every 20 seconds once you've opened it.
  useRecheck(onCheck, opened ? 20000 : 0)
  const run = async (path, body) => {
    setErr(null)
    try { await api(path, { method: 'POST', body }); setOpened(true) } catch (e) { setErr(e.message) }
  }
  return (
    <div className="perm-fix">
      <p>{text}</p>
      {viaRelay ? <p className="muted small">{t('Do this in Mail on your computer.')}</p> : (
        <div className="perm-acts">
          <button type="button" className="btn small primary" onClick={() => run('/fix/app', { app: 'mail' })}><Icon name="mail" size={12} /> {t('Open Mail')}</button>
          <button type="button" className="ghost-btn" onClick={() => run('/fix/settings', { pane: 'internet-accounts' })}><Icon name="external" size={12} /> {t('Internet Accounts')}</button>
          <button type="button" className="ghost-btn" onClick={onCheck}><Icon name="refresh" size={12} /> {t('Check again')}</button>
        </div>
      )}
      {opened && <p className="muted small">{t('Your mail shows up here once Mail has synced.')}</p>}
      {err && <p className="error-text">{err}</p>}
    </div>
  )
}

export const outlookUrl = () => (isPhone() ? 'ms-outlook://' : 'https://outlook.office.com/mail/')

// New mail the moment Mail's index changes (server: /api/mail/live), while anything shows mail on
// a computer that reads it: one stream for all of them, which has every view of /mail look again.
// A stream that drops is opened again a little later; the two-minute look carries on meanwhile.
let liveUsers = 0
let stream = null
let again = null
function listen() {
  clearTimeout(again)
  if (stream || !liveUsers || typeof EventSource === 'undefined') return
  try {
    stream = new EventSource(apiUrl('/mail/live'))
    stream.onmessage = (e) => { try { if (JSON.parse(e.data).changed) { bodies.clear(); refetch('/mail') } } catch { /* a partial line */ } }
    stream.onerror = () => { stream?.close(); stream = null; again = setTimeout(listen, 30_000) }
  } catch { stream = null }
}
function useMailLive(on) {
  useEffect(() => {
    if (!on) return
    liveUsers++
    listen()
    return () => { if (--liveUsers === 0) { clearTimeout(again); stream?.close(); stream = null } }
  }, [on])
}
export function useMail() {
  useMailLive(!!usePoll('/config', 10 * 60 * 1000).data?.mail)
  return usePoll('/mail', 2 * 60 * 1000)
}

// Messages read once, kept here a while so opening one is instant: the open one, and the next few
// in the list, read ahead of you.
const bodies = new Map() // id -> { at, data }
const reading = new Map() // id -> Promise
function readBody(id) {
  const hit = bodies.get(id)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return Promise.resolve(hit.data)
  if (reading.has(id)) return reading.get(id)
  const p = api(`/mail/message/${id}`).then((data) => { bodies.set(id, { at: Date.now(), data }); if (bodies.size > 60) bodies.delete(bodies.keys().next().value); return data }).finally(() => reading.delete(id))
  reading.set(id, p)
  return p
}
const readAhead = (ids) => { for (const id of ids) if (id != null && !bodies.has(id)) readBody(id).catch(() => {}) }
function useMessage(id) {
  const [st, setSt] = useState({ data: null, error: null })
  useEffect(() => {
    if (id == null) { setSt({ data: null, error: null }); return }
    let gone = false
    const hit = bodies.get(id)
    setSt({ data: hit?.data || null, error: null })
    readBody(id).then((data) => { if (!gone) setSt({ data, error: null }) }, (e) => { if (!gone) setSt((s) => ({ ...s, error: e.message })) })
    return () => { gone = true }
  }, [id])
  return st
}

// One row per conversation, keeping its best-scored message as the lead.
export const threadKey = (m) => (m.conv ? `c${m.conv}` : `m${m.id}`)
export function threads(messages) {
  const by = new Map()
  for (const m of messages) {
    const k = threadKey(m)
    const t = by.get(k)
    if (!t) by.set(k, { key: k, lead: m, latest: m, count: 1, unread: m.read ? 0 : 1, score: m.score, people: [m.from] })
    else {
      t.count++
      if (!m.read) t.unread++
      if (m.score > t.score) { t.score = m.score; t.lead = m }
      if (m.received > t.latest.received) t.latest = m
      if (!t.people.includes(m.from)) t.people.push(m.from)
    }
  }
  return [...by.values()]
}

const REASON_TONE = { Reminder: 'hot', Urgent: 'hot', VIP: 'hot', 'Asks you': 'warm', 'Action needed': 'warm', 'Just to you': 'warm', Flagged: 'warm' }
// The server's words for why a mail matters, shown in your language (they stay English as keys).
tx('Reminder'); tx('Urgent'); tx('VIP'); tx('Asks you'); tx('Action needed'); tx('Just to you'); tx('Flagged'); tx('To you'); tx('CC'); tx('Your thread'); tx('External'); tx('You write to them'); tx("You've written to them"); tx('Muted')
export function Reasons({ list, max = 3 }) {
  const rank = (r) => (REASON_TONE[r] === 'hot' ? 0 : REASON_TONE[r] === 'warm' ? 1 : 2)
  const shown = list.filter((r) => r !== 'You replied').sort((a, b) => rank(a) - rank(b)).slice(0, max)
  if (!shown.length) return null
  return <span className="reasons">{shown.map((r) => <span key={r} className={`reason ${REASON_TONE[r] || ''}`}>{t(r)}</span>)}</span>
}

// A time to come back, said the short way: "Tomorrow, 9:00 AM", "Mon 16 Nov, 9:00 AM".
export function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const n = Math.round((day - today) / 864e5)
  const time = d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  if (n === 0) return t('Today, {time}', { time })
  if (n === 1) return t('Tomorrow, {time}', { time })
  return `${d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`
}

function ThreadRow({ t: th, on, onOpen, tab }) {
  const m = th.latest
  const lead = th.lead
  return (
    <li>
      <button className={`mrow ${on ? 'on' : ''} ${th.unread ? '' : 'read'}`} onClick={() => onOpen(m.id)} data-key={th.key}>
        <span className="mrow-dot">{tab === 'later' ? <Icon name="clock" size={11} /> : tab === 'done' ? <Icon name="check" size={11} /> : lead.flagged ? <Icon name="star" size={11} /> : th.unread > 0 && <span className="unread-dot" />}</span>
        <span className="mrow-main">
          <span className="mrow-top">
            <b>{th.people.slice(0, 3).join(', ')}{th.people.length > 3 ? ` +${th.people.length - 3}` : ''}</b>
            {th.count > 1 && <span className="mrow-count">{th.count}</span>}
            <span className="mrow-time">{fmtRelative(m.received)}</span>
          </span>
          <span className="mrow-subject">{m.subject}</span>
          {(lead.ai || m.snippet) && (
            <span className={`mrow-snippet ${lead.ai ? 'ai' : ''}`}>{lead.ai && <Icon name="sparkle" size={10} />}{lead.ai || m.snippet}</span>
          )}
          {tab === 'later' && lead.later ? <span className="mrow-when">{t('Back {when}', { when: fmtWhen(lead.later) })}</span>
            : tab === 'done' && lead.done ? <span className="mrow-when">{t('Done {time}', { time: fmtRelative(lead.done) })}</span>
              : <Reasons list={lead.reasons} />}
        </span>
      </button>
    </li>
  )
}

// What you sent that nobody has answered, when a reminder for it is due (Needs you) or set (Later).
function NudgeRow({ n, on, onOpen }) {
  return (
    <li>
      <button className={`mrow ${on ? 'on' : ''} ${n.due ? '' : 'read'}`} onClick={() => onOpen(n.id)}>
        <span className="mrow-dot"><Icon name="bell" size={11} /></span>
        <span className="mrow-main">
          <span className="mrow-top"><b>{t('To {who}', { who: n.to })}</b><span className="mrow-time">{fmtWhen(n.until)}</span></span>
          <span className="mrow-subject">{n.subject}</span>
          <span className="mrow-when">{n.due ? t('Nobody answered') : t('Reminds you then if nobody answers')}</span>
        </span>
      </button>
    </li>
  )
}

const ACTIONS = [
  ['summary', tx('Summarize'), 'sparkle'],
  ['tasks', tx('Action items'), 'check'],
  ['jira', tx('Ticket'), 'plus'],
]

// When to come back: later today, tomorrow morning, next week, or a time you pick. For mail you
// sent: if nobody answers in a day, three days or a week.
const at9 = (days) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(9, 0, 0, 0); return d }
function laterChoices() {
  const soon = new Date(); soon.setMinutes(0, 0, 0); soon.setHours(soon.getHours() + 3)
  const monday = (() => { const d = at9(1); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); return d })()
  return [
    ...(soon.getDate() === new Date().getDate() ? [['soon', tx('Later today'), soon]] : []),
    ['tomorrow', tx('Tomorrow morning'), at9(1)],
    ['week', tx('Next week'), monday],
  ]
}
const nudgeChoices = () => [['1', tx('In a day'), at9(1)], ['3', tx('In 3 days'), at9(3)], ['7', tx('In a week'), at9(7)]]

function RemindMenu({ mine, onPick, onClose }) {
  const choices = mine ? nudgeChoices() : laterChoices()
  const [custom, setCustom] = useState('')
  const first = useRef(null)
  useEffect(() => { first.current?.focus() }, [])
  // 1, 2, 3 pick; Esc closes.
  useEffect(() => {
    const on = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) { if (e.key === 'Escape' && e.target.closest('.mremind')) { e.preventDefault(); onClose() } return }
      const n = Number(e.key)
      if (n >= 1 && n <= choices.length) { e.preventDefault(); e.stopPropagation(); onPick(choices[n - 1][2]) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  })
  return (
    <div className="mremind" role="menu" aria-label={mine ? t('Remind me if nobody answers') : t('Remind me')} data-esc>
      <b className="small">{mine ? t('Remind me if nobody answers') : t('Remind me')}</b>
      {choices.map(([k, label, when], i) => (
        <button key={k} ref={i === 0 ? first : null} type="button" role="menuitem" className="mremind-row" onClick={() => onPick(when)}>
          <kbd>{i + 1}</kbd><span>{t(label)}</span><span className="muted small">{fmtWhen(when.toISOString())}</span>
        </button>
      ))}
      <form className="mremind-pick" onSubmit={(e) => { e.preventDefault(); if (custom) onPick(new Date(custom)) }}>
        <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t('Pick a time')} />
        <button type="submit" className="btn small" disabled={!custom}>{t('Set')}</button>
      </form>
      <p className="muted small">{mine ? t('It comes back to Needs you then, unless someone answers first. Kept by Bridge AI; Mail is left as it is.') : t('It leaves Needs you until then, or until someone writes again. Kept by Bridge AI; Mail is left as it is.')}</p>
    </div>
  )
}

const KEYS = [
  ['J  K', tx('Next and previous conversation')],
  ['E', tx('Done, or not done')],
  ['H', tx('Remind me')],
  ['R', tx('AI Assist: draft a reply in your voice')],
  ['Z', tx('Undo')],
  ['Enter', tx('Open')],
  ['Esc', tx('Back, or close')],
  ['/', tx('Filter')],
  ['Tab  ⇧Tab', tx('Next and previous tab')],
  ['?', tx('These keys')],
]
function KeysSheet({ onClose }) {
  return (
    <div className="mkeys-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} data-esc>
      <div className="mkeys" role="dialog" aria-label={t('Mail keys')}>
        <header><b>{t('Mail keys')}</b><button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={13} /></button></header>
        <dl>{KEYS.map(([k, what]) => <div key={k}><dt>{k.split('  ').map((x) => <kbd key={x}>{x}</kbd>)}</dt><dd>{t(what)}</dd></div>)}</dl>
        <p className="muted small">{t('Done and Remind me are kept by Bridge AI: Mail is left as it is. ⌘K has these too, with their keys.')}</p>
      </div>
    </div>
  )
}

function Reader({ id, summary, onBack, onOpenAgent, onRule, rules, onOpen, onDone, onLater, onUndone, assist, setAssist, remind, setRemind, wideAssist, onNote }) {
  const { data, error } = useMessage(id)
  const apps = useOpenIn()
  const [quoted, setQuoted] = useState(false)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  useEffect(() => { setQuoted(false); setMsg(null); setAsk('') }, [id])
  const m = summary
  const run = async (action) => {
    setBusy(action)
    setMsg(null)
    try {
      const out = await api(`/mail/${id}/agent`, { method: 'POST', body: { action, note: ask } })
      setMsg({ ok: true, text: t('Agent started in the Mail space. Opening it…') })
      setAsk('')
      if (out.paneId && onOpenAgent) setTimeout(() => onOpenAgent(out.paneId), 1200)
    } catch (x) { setMsg({ ok: false, text: x.message }) } finally { setBusy(null) }
  }
  if (!m) return <div className="mreader empty"><Icon name="mail" size={22} /><p>{t('Pick a message to read it here.')}</p><p className="muted small">{t('J and K move through the list; ? shows every key.')}</p></div>
  const addr = (m.address || (/<([^>]+)>/.exec(data?.from || '') || [])[1] || '').toLowerCase()
  const subject = m.subject || data?.subject || ''
  const from = m.mine ? t('You') : m.from || (data?.from || '').replace(/\s*<[^>]+>/, '').replace(/"/g, '')
  const isVip = rules?.vip?.includes(addr)
  const isMuted = rules?.mute?.includes(addr)
  // Open in Mail: the message itself, in Mail on this Mac, to answer it there. Where Mail is, for a
  // message with a Message-ID for Mail to find it by; what came of it said either way.
  const inMail = !!apps.mail && !!(data?.mid || m.mid)
  const openInMail = async () => {
    try { await api(`/mail/${id}/open`, { method: 'POST' }); onNote(t('Opening it in Mail.')) } catch (e) { onNote(t("Couldn't open it in Mail: {error}", { error: e.message }), { error: true }) }
  }
  const nudge = !!m.mine
  const panel = assist && <ReplyAssist id={id} data={data} nudge={nudge} times={assist === 'times'} onClose={() => setAssist(false)} beside={wideAssist} />
  // AI Assist, at the right end of the email's buttons: a reply (or, for one you sent, a nudge) and
  // free times. Picked again, each closes its panel.
  const assists = () => [
    { label: nudge ? t('Draft a nudge') : t('Draft a reply'), hint: t('In your own words, to copy or open in your mail app'), keys: 'R', on: assist === 'reply', run: () => setAssist(assist === 'reply' ? false : 'reply') },
    !nudge && { label: t('Find a time'), hint: t('Free times from your calendar, to put in a reply'), on: assist === 'times', run: () => setAssist(assist === 'times' ? false : 'times') },
  ]
  return (
    <div className={`mreader-wrap ${assist && wideAssist ? 'with-assist' : ''}`} data-esc={onBack ? '' : undefined}>
      <article className="mreader">
        <header className="mreader-head">
          {onBack && <button className="icon-btn" onClick={onBack} aria-label={t('Back to list')}><Icon name="chevron" size={14} className="rot180" /></button>}
          <div className="mreader-titles">
            <h3>{subject}</h3>
            <p><b>{from}</b> {addr && !m.mine && <span className="muted">&lt;{addr}&gt;</span>} · <span className="muted">{new Date(m.received).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></p>
            {data?.to && <p className="muted small mreader-to">{t('To {who}', { who: data.to })}{data.cc ? ` · ${t('Cc {who}', { who: data.cc })}` : ''}</p>}
            <Reasons list={m.reasons || []} max={6} />
          </div>
        </header>

        <div className="mreader-do">
          {m.done
            ? <button type="button" className="btn small" onClick={onUndone}><Icon name="undo" size={12} /> {t('Not done')} <kbd>E</kbd></button>
            : !nudge && <button type="button" className="btn small" onClick={onDone}><Icon name="check" size={12} /> {t('Done')} <kbd>E</kbd></button>}
          <span className="mreader-remind">
            <button type="button" className={`btn small ${remind ? 'on' : ''}`} onClick={() => setRemind(!remind)} aria-expanded={!!remind}>
              <Icon name="clock" size={12} /> {nudge ? t('Remind me if nobody answers') : m.later ? t('Back {when}', { when: fmtWhen(m.later) }) : t('Remind me')} <kbd>H</kbd>
            </button>
            {remind && <RemindMenu mine={nudge} onPick={(when) => { setRemind(false); onLater(when) }} onClose={() => setRemind(false)} />}
          </span>
          <span className="grow" />
          <AiAssist className="btn small mreader-ai-btn" on={!!assist} items={assists} />
        </div>
        {m.nudge && <p className="muted small">{t('Reminds you {when} if nobody answers.', { when: fmtWhen(m.nudge) })}</p>}

        {assist && !wideAssist && panel}

        {m.ai && <p className="mreader-ai"><Icon name="sparkle" size={12} /> {m.ai}</p>}
        {error && <p className="error-text">{error}</p>}
        {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
        {data && (
          <>
            <div className="mreader-body">{data.latest || m.snippet || t('No text in this message.')}</div>
            {data.quoted && (
              <>
                <button className="ghost-btn" onClick={() => setQuoted(!quoted)}><Icon name="chevron" size={10} className={quoted ? 'rot90' : ''} /> {quoted ? t('Hide earlier messages') : t('Show earlier messages')}</button>
                {quoted && <div className="mreader-body quoted">{data.quoted}</div>}
              </>
            )}
            {data.attachments.length > 0 && <div className="mreader-files">{data.attachments.map((a) => <span key={a} className="chip"><Icon name="file" size={11} /> {a}</span>)}</div>}
            {data.thread.length > 1 && (
              <div className="mreader-thread">
                <span className="na-label">{t('Thread · {n}', { n: data.thread.length })}</span>
                <ul>
                  {data.thread.map((x) => (
                    <li key={x.id}>
                      <button className={x.id === id ? 'on' : ''} onClick={() => onOpen(x.id)}>
                        <b>{x.mine ? t('You') : x.from}</b><span className="muted">{fmtRelative(x.received)}</span>
                        <span className="mreader-thread-snip">{x.snippet}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="mreader-agent">
          <div className="mreader-actions">
            {ACTIONS.map(([a, label, icon]) => (
              <button key={a} className="btn small" onClick={() => run(a)} disabled={!!busy}><Icon name={icon} size={12} /> {busy === a ? t('Starting…') : t(label)}</button>
            ))}
          </div>
          <form className="mreader-ask" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) run('custom') }}>
            <Icon name="bot" size={13} />
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={t('Or tell an agent what to do with this email…')} />
            <button className="btn small primary" disabled={!ask.trim() || !!busy}>{busy === 'custom' ? t('Starting…') : t('Go')}</button>
          </form>
          {msg && <p className={`small ${msg.ok ? 'muted' : 'error-text'}`}>{msg.text}</p>}
        </div>

        <footer className="mreader-foot">
          {inMail && <button type="button" className="ghost-btn mreader-open" onClick={openInMail} title={t('Open it in Mail on this Mac, to answer it there. Bridge AI never sends.')}><Icon name="external" size={12} /> {t('Open in Mail')}</button>}
          <a className="ghost-btn" href={outlookUrl()} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> Outlook</a>
          <span className="grow" />
          {addr && !m.mine && <button className={`ghost-btn ${isVip ? 'strong' : ''}`} onClick={() => onRule(addr, isVip ? 'none' : 'vip')} title={t('Always rank this sender as important')}>
            <Icon name="star" size={12} /> {isVip ? t('Important sender') : t('Always important')}
          </button>}
          {addr && !m.mine && <button className="ghost-btn" onClick={() => onRule(addr, isMuted ? 'none' : 'mute')} title={t('Never rank this sender as important')}>
            <Icon name="x" size={12} /> {isMuted ? t('Unmute') : t('Mute sender')}
          </button>}
        </footer>
      </article>
      {assist && wideAssist && panel}
    </div>
  )
}

const TABS = [
  ['needs', tx('Needs you')],
  ['action', tx('Action')],
  ['waiting', tx('Waiting')],
  ['later', tx('Later')],
  ['done', tx('Done')],
  ['all', tx('All')],
]

export default function MailView({ onOpenAgent, openId }) {
  const { data, error, refresh } = useMail()
  const [tab, setTab] = usePersisted('cc-mail-tab', 'needs')
  const [sel, setSel] = useState(openId || null)
  const [q, setQ] = useState('')
  const [triage, setTriage] = useState(null)
  const [assist, setAssist] = useState(false)
  const [remind, setRemind] = useState(false)
  const [keys, setKeys] = useState(false)
  const [note, setNote] = useState(null) // { text, undo, error }
  const [marked, setMarked] = useState({}) // thread key -> bucket, until the next answer says so
  const undo = useRef(null)
  const [measure, width] = useWidth()
  const ref = useRef(null)
  const setRef = useCallback((el) => { ref.current = el; measure(el) }, [measure])
  const narrow = width > 0 && width < 760
  // AI Assist's reply beside the email once there's room for the list, the email and it.
  const wideAssist = width >= 1100
  const search = useRef(null)

  useEffect(() => { if (openId) setSel(openId) }, [openId])
  useEffect(() => { setMarked({}) }, [data?.fetchedAt])
  useEffect(() => { setRemind(false) }, [sel])

  const msgs = useMemo(() => (data?.messages || []).map((m) => (marked[threadKey(m)] !== undefined ? { ...m, bucket: marked[threadKey(m)] || m.bucket } : m)), [data, marked])
  const lists = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const match = (m) => !ql || `${m.from} ${m.address} ${m.subject} ${m.snippet || ''} ${m.ai || ''}`.toLowerCase().includes(ql)
    const f = msgs.filter(match)
    const newest = (a, b) => (a.latest.received < b.latest.received ? 1 : -1)
    return {
      // A reminder that's due leads, then what's unread, then the score.
      needs: threads(f.filter((m) => m.bucket === 'needs')).sort((a, b) => (!!b.lead.reminded - !!a.lead.reminded) || (b.unread > 0) - (a.unread > 0) || b.score - a.score),
      action: threads(f.filter((m) => m.bucket === 'action')).sort(newest),
      later: threads(f.filter((m) => m.bucket === 'later')).sort((a, b) => (a.lead.later < b.lead.later ? -1 : 1)),
      done: threads(f.filter((m) => m.bucket === 'done')).sort((a, b) => (a.lead.done < b.lead.done ? 1 : -1)),
      all: threads(f).sort(newest),
    }
  }, [msgs, q])
  const ql = q.trim().toLowerCase()
  const waiting = (data?.waiting || []).filter((w) => !ql || `${w.subject} ${w.to}`.toLowerCase().includes(ql))
  const nudges = (data?.nudges || []).filter((n) => !ql || `${n.subject} ${n.to}`.toLowerCase().includes(ql))
  const due = nudges.filter((n) => n.due)
  const selMsg = msgs.find((m) => m.id === sel)
  const sentItem = !selMsg && sel ? waiting.find((w) => w.id === sel) || nudges.find((n) => n.id === sel) : null
  // A message opened from the thread list may be outside the scored window; show what we know.
  const summary = selMsg || (sentItem ? { id: sel, mine: true, from: '', address: '', subject: sentItem.subject, reasons: [], received: sentItem.sent || new Date().toISOString(), nudge: sentItem.nudge || (sentItem.due === false ? sentItem.until : null), conv: sentItem.conv, to: sentItem.to } : sel ? { id: sel, from: '', address: '', subject: '', reasons: [], received: new Date().toISOString() } : null)

  // The list as it reads now, for J and K, and to move on after Done.
  const order = useMemo(() => {
    if (tab === 'waiting') return waiting.map((w) => ({ id: w.id }))
    const rows = lists[tab] || []
    return [...(tab === 'needs' ? due.map((n) => ({ id: n.id })) : tab === 'later' ? nudges.filter((n) => !n.due).map((n) => ({ id: n.id })) : []), ...rows.map((x) => ({ id: x.latest.id, key: x.key }))]
  }, [tab, lists, waiting, due, nudges])
  const at = order.findIndex((x) => x.id === sel || (selMsg && x.key === threadKey(selMsg)))
  // Read ahead: the next three in the list.
  useEffect(() => { if (at >= 0 || !sel) readAhead(order.slice(Math.max(0, at + 1), Math.max(0, at + 1) + 3).map((x) => x.id)) }, [at, order, sel])

  const noteTimer = useRef(null)
  const flash = (text, opts = {}) => {
    setNote({ text, ...opts })
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(null), opts.error ? 9000 : 7000)
  }
  useEffect(() => () => clearTimeout(noteTimer.current), [])
  const setRule = async (address, rule) => { await api('/mail/rules', { method: 'POST', body: { address, rule } }); refresh('?refresh=1') }
  const runTriage = async () => {
    setTriage('busy')
    try { const out = await api('/mail/triage', { method: 'POST' }); setTriage('started'); if (out.paneId && onOpenAgent) setTimeout(() => onOpenAgent(out.paneId), 1200) } catch (x) { setTriage(x.message) }
  }
  const next = () => { const n = order[at + 1] || order[at - 1]; return n ? n.id : null }
  // Whether a thread moved to this list leaves the one you're looking at.
  const leaves = (bucket) => tab !== 'all' && tab !== 'waiting' && bucket !== undefined && bucket !== tab
  // Done, Remind me and their undo: the row moves at once (bucket: the list it goes to; undefined
  // waits for the answer), and back if it couldn't be kept. Z puts it as it was.
  const mark = async (body, bucket, text) => {
    const key = body.key
    const prev = body.sent != null ? { sent: body.sent, conv: body.conv, mark: summary?.nudge ? 'nudge' : 'clear', until: summary?.nudge || undefined, subject: body.subject, to: body.to }
      : { key, mark: selMsg?.done ? 'done' : selMsg?.later && !selMsg.reminded ? 'later' : 'clear', until: selMsg?.later || undefined, at: selMsg?.done || undefined, id: body.id, subject: body.subject }
    const was = selMsg?.bucket
    if (key && bucket !== undefined) setMarked((x) => ({ ...x, [key]: bucket }))
    if (key && leaves(bucket)) setSel(next())
    try {
      await api('/mail/mark', { method: 'POST', body })
      undo.current = { body: prev, bucket: was, sel: summary?.id }
      flash(text, { undo: true })
      refresh()
    } catch (e) {
      if (key) setMarked((x) => { const y = { ...x }; delete y[key]; return y })
      flash(t("Couldn't keep that: {error}", { error: e.message }), { error: true })
    }
  }
  const doDone = () => {
    if (!summary || summary.mine) return
    const key = threadKey(summary)
    if (summary.done) return mark({ key, mark: 'clear' }, undefined, t('Back where it was.'))
    mark({ key, id: summary.id, mark: 'done', subject: summary.subject, from: summary.from }, 'done', t('Done. Mail is left as it is.'))
  }
  const doLater = (when) => {
    if (!summary) return
    if (summary.mine) return mark({ sent: summary.id, conv: summary.conv, mark: 'nudge', until: when.toISOString(), subject: summary.subject, to: summary.to }, undefined, t('Reminds you {when} if nobody answers.', { when: fmtWhen(when.toISOString()) }))
    mark({ key: threadKey(summary), id: summary.id, mark: 'later', until: when.toISOString(), subject: summary.subject, from: summary.from }, 'later', t('Back {when}. Mail is left as it is.', { when: fmtWhen(when.toISOString()) }))
  }
  const doUndo = async () => {
    const u = undo.current
    if (!u) return
    undo.current = null
    try {
      await api('/mail/mark', { method: 'POST', body: u.body })
      if (u.body.key && u.bucket) setMarked((x) => ({ ...x, [u.body.key]: u.bucket }))
      if (u.sel) setSel(u.sel)
      flash(t('Undone.'))
      refresh()
    } catch (e) { flash(t("Couldn't undo: {error}", { error: e.message }), { error: true }) }
  }
  const openFirst = () => { if (!sel && order[0]) setSel(order[0].id) }
  // From ⌘K: done, later, reply or keys, on the open message.
  const doFromMenu = (what) => {
    if (!what) return
    if (what === 'keys') { setKeys(true); return }
    if (!summary) { openFirst(); flash(t('Open a message first, then press {key}.', { key: { done: 'E', later: 'H', reply: 'R' }[what] || '' })); return }
    if (what === 'done') doDone()
    if (what === 'later') setRemind(true)
    if (what === 'reply') setAssist('reply')
  }
  const fromMenu = useRef(doFromMenu)
  fromMenu.current = doFromMenu
  useEffect(() => {
    const on = () => fromMenu.current(takeMailDo())
    window.addEventListener('bridge-mail-do', on)
    if (data) on()
    return () => window.removeEventListener('bridge-mail-do', on)
  }, [!!data]) // eslint-disable-line react-hooks/exhaustive-deps

  // The keys, while you're working in Mail (the last click or focus was in it) and not typing.
  const keysOn = useRef(true)
  const onKey = (e) => {
    if (!keysOn.current || e.metaKey || e.ctrlKey || e.altKey || !ref.current?.offsetParent) return
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], .xterm')) {
      if (e.key === 'Escape' && e.target.closest('.mlist-search')) { e.target.blur(); if (!q) e.preventDefault() }
      return
    }
    if (document.querySelector('.modal-backdrop, .palette')) return
    const k = e.key
    const go = (i) => { const x = order[Math.max(0, Math.min(order.length - 1, i))]; if (x) { setSel(x.id); setTimeout(() => ref.current?.querySelector('.mrow.on')?.scrollIntoView({ block: 'nearest' }), 0) } }
    const handled = () => { e.preventDefault(); e.stopPropagation() }
    if (keys) { if (k === 'Escape' || k === '?') { handled(); setKeys(false) } return }
    if (k === 'j' || k === 'ArrowDown') { handled(); go(at < 0 ? 0 : at + 1) } else if (k === 'k' || k === 'ArrowUp') { handled(); go(at < 0 ? 0 : at - 1) } else if (k === 'Enter' && !e.target.closest('button, a')) { handled(); openFirst() } else if (k === 'e') { handled(); if (summary) doDone(); else flash(t('Open a message first, then press {key}.', { key: 'E' })) } else if (k === 'h') { handled(); if (summary) setRemind((x) => !x); else flash(t('Open a message first, then press {key}.', { key: 'H' })) } else if (k === 'r') { handled(); if (summary) setAssist('reply'); else flash(t('Open a message first, then press {key}.', { key: 'R' })) } else if (k === 'z') { handled(); if (undo.current) doUndo(); else flash(t('Nothing to undo.')) } else if (k === '/') { handled(); search.current?.focus() } else if (k === '?') { handled(); setKeys(true) } else if (k === 'Escape') {
      if (remind) { handled(); setRemind(false) } else if (assist) { handled(); setAssist(false) } else if (narrow && sel) { handled(); setSel(null) }
    } else if (k === 'Tab' && (e.target === document.body || e.target.closest('.mrow, .mlist-tabs'))) {
      handled()
      const i = TABS.findIndex(([x]) => x === tab)
      setTab(TABS[(i + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length][0])
    }
  }
  const keyRef = useRef(onKey)
  keyRef.current = onKey
  useEffect(() => {
    const down = (e) => { keysOn.current = !!ref.current?.contains(e.target) }
    const focus = (e) => { if (ref.current?.contains(e.target)) keysOn.current = true }
    const key = (e) => keyRef.current(e)
    const today = () => { keysOn.current = true }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('focusin', focus, true)
    window.addEventListener('keydown', key)
    window.addEventListener('cc-today', today)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('focusin', focus, true); window.removeEventListener('keydown', key); window.removeEventListener('cc-today', today) }
  }, [])

  if (data && !data.available) {
    return <div className="mailv"><div className="mail-setup pad"><MailSetup data={data} onCheck={() => refresh('?refresh=1')} /></div></div>
  }
  const counts = { needs: (lists.needs.filter((x) => x.unread || x.lead.reminded).length || lists.needs.length) + due.length, action: lists.action.length, waiting: waiting.length, later: lists.later.length + nudges.filter((n) => !n.due).length, done: null, all: null }
  const showReader = !narrow || sel
  const showList = !narrow || !sel
  const rows = lists[tab] || []

  return (
    <div className={`mailv ${narrow ? 'narrow' : ''} ${assist && wideAssist && sel ? 'assisting' : ''}`} ref={setRef}>
      {showList && (
        <div className="mlist">
          <div className="mlist-bar">
            <div className="mlist-stats">
              <span><b>{data?.unread ?? '–'}</b> {t('unread')}</span>
              <span><b>{data?.flagged ?? '–'}</b> {t('flagged')}</span>
              <span><b>{data?.today ?? '–'}</b> {t('today')}</span>
            </div>
            <span className="grow" />
            <button className="btn small" onClick={runTriage} disabled={triage === 'busy' || !data} title={t('An agent reads what needs you and suggests what to do with each')}>
              <Icon name="sparkle" size={12} /> {triage === 'busy' ? t('Starting…') : t('Triage with agent')}
            </button>
            {!isPhone() && <button className="icon-btn mlist-keys" onClick={() => setKeys(true)} aria-label={t('Mail keys')} title={t('Mail keys (?)')}><Icon name="keyboard" size={13} /></button>}
            <button className="icon-btn" onClick={() => refresh('?refresh=1')} aria-label={t('Refresh')}><Icon name="refresh" size={13} /></button>
          </div>
          {triage && triage !== 'busy' && <p className={`small pad-x ${triage === 'started' ? 'muted' : 'error-text'}`}>{triage === 'started' ? t('Triage agent started in the Mail space.') : triage}</p>}
          <div className="mlist-tabs" role="tablist" aria-label={t('Mail lists')}>
            {TABS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`fchip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{t(l)}{counts[k] ? <span className="fchip-n">{counts[k]}</span> : null}</button>
            ))}
          </div>
          <label className="mlist-search"><Icon name="search" size={13} /><input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Filter by sender or subject')} aria-label={t('Filter by sender or subject')} /></label>
          {error && <p className="error-text pad-x">{error}</p>}
          {!data && !error && <div className="skeleton-rows pad"><div /><div /><div /></div>}
          <div className="mlist-scroll">
            {tab === 'waiting' ? (
              <ul className="mlist-items">
                {waiting.map((w) => (
                  <li key={w.id}>
                    <button className={`mrow read ${sel === w.id ? 'on' : ''}`} onClick={() => setSel(w.id)}>
                      <span className="mrow-dot"><Icon name={w.nudge ? 'bell' : 'clock'} size={11} /></span>
                      <span className="mrow-main">
                        <span className="mrow-top"><b>{t('To {who}', { who: w.to })}</b><span className="mrow-time">{fmtRelative(w.sent)}</span></span>
                        <span className="mrow-subject">{w.subject}</span>
                        {w.nudge && <span className="mrow-when">{t('Reminds you {when} if nobody answers', { when: fmtWhen(w.nudge) })}</span>}
                      </span>
                    </button>
                  </li>
                ))}
                {!waiting.length && data && <p className="muted small pad">{t('No unanswered threads from the last 10 days.')}</p>}
              </ul>
            ) : (
              <ul className="mlist-items">
                {tab === 'needs' && due.map((n) => <NudgeRow key={`n${n.id}`} n={n} on={sel === n.id} onOpen={setSel} />)}
                {tab === 'later' && nudges.filter((n) => !n.due).map((n) => <NudgeRow key={`n${n.id}`} n={n} on={sel === n.id} onOpen={setSel} />)}
                {rows.map((x) => <ThreadRow key={x.key} t={x} tab={tab} on={x.lead.id === sel || x.latest.id === sel} onOpen={setSel} />)}
                {data && !rows.length && !(tab === 'needs' && due.length) && !(tab === 'later' && nudges.length) && (
                  <p className="muted small pad">{tab === 'needs' ? t('Nothing needs you right now.') : tab === 'later' ? t('Nothing set aside. Remind me (H) on a message brings it back when you say.') : tab === 'done' ? t('Nothing done in the last 10 days. Done (E) takes a message off Needs you; Mail is left as it is.') : t('Nothing here.')}</p>
                )}
              </ul>
            )}
            {data && tab === 'needs' && (
              <p className="mlist-why muted small">
                {t("Ranked from what Mail already knows: sent to you or only cc'd, whether you write to the sender, threads you're in and have answered, urgency words, and Apple's Primary / Updates / Promotions sorting. Star or mute a sender to teach it.")}
              </p>
            )}
          </div>
        </div>
      )}
      {showReader && (
        <Reader id={sel} summary={summary} onBack={narrow ? () => setSel(null) : null} onOpenAgent={onOpenAgent} onRule={setRule} rules={data?.rules} onOpen={setSel}
          onDone={doDone} onUndone={doDone} onLater={doLater} assist={sel ? assist : false} setAssist={setAssist} remind={remind} setRemind={setRemind} wideAssist={wideAssist} onNote={flash} />
      )}
      {note && (
        <div className={`mnote ${note.error ? 'bad' : ''}`} role="status">
          <span>{note.text}</span>
          {note.undo && <button type="button" className="link-btn" onClick={doUndo}>{t('Undo')} <kbd>Z</kbd></button>}
        </div>
      )}
      {keys && <KeysSheet onClose={() => setKeys(false)} />}
    </div>
  )
}
