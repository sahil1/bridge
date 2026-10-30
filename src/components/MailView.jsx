import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { usePersisted, useWidth } from './layout.jsx'
import { api, usePoll, fmtRelative, viaRelay } from '../api.js'
import PermissionFix, { useRecheck } from './PermissionFix.jsx'
import { locale, t, tx } from '../i18n/index.js'

// Mail triage over the Mac Mail app's local index: what needs you, automated items that want
// action, threads waiting on someone else, and an agent that can act on any message.
const isPhone = () => /iPhone|iPad|Android/i.test(navigator.userAgent)

// Why Mail can't be read yet, and one button that fixes it: Allow access (Full Disk Access), or
// Open Mail to add your account and let it sync. Checks again when you come back to the window.
export function MailSetup({ data, onCheck }) {
  if (data.reason === 'noAccess') return <PermissionFix pane="full-disk" onCheck={onCheck}><p>{data.setup}</p></PermissionFix>
  if (data.reason === 'noMail') return <MailNotSetUp text={data.setup} onCheck={onCheck} />
  return <><p>{data.setup}</p><button className="ghost-btn" onClick={onCheck}><Icon name="refresh" size={12} /> Check again</button></>
}

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
      {viaRelay ? <p className="muted small">Do this in Mail on your computer.</p> : (
        <div className="perm-acts">
          <button type="button" className="btn small primary" onClick={() => run('/fix/app', { app: 'mail' })}><Icon name="mail" size={12} /> Open Mail</button>
          <button type="button" className="ghost-btn" onClick={() => run('/fix/settings', { pane: 'internet-accounts' })}><Icon name="external" size={12} /> Internet Accounts</button>
          <button type="button" className="ghost-btn" onClick={onCheck}><Icon name="refresh" size={12} /> Check again</button>
        </div>
      )}
      {opened && <p className="muted small">Your mail shows up here once Mail has synced.</p>}
      {err && <p className="error-text">{err}</p>}
    </div>
  )
}

export const outlookUrl = () => (isPhone() ? 'ms-outlook://' : 'https://outlook.office.com/mail/')
const mailLink = (mid) => (mid && !isPhone() ? `message://%3c${encodeURIComponent(mid)}%3e` : null)

export function useMail() {
  return usePoll('/mail', 2 * 60 * 1000)
}

// One row per conversation, keeping its best-scored message as the lead.
export function threads(messages) {
  const by = new Map()
  for (const m of messages) {
    const k = m.conv ? `c${m.conv}` : `m${m.id}`
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

const REASON_TONE = { Urgent: 'hot', VIP: 'hot', 'Asks you': 'warm', 'Action needed': 'warm', 'Just to you': 'warm', Flagged: 'warm' }
// The server's words for why a mail matters, shown in your language (they stay English as keys).
tx('Urgent'); tx('VIP'); tx('Asks you'); tx('Action needed'); tx('Just to you'); tx('Flagged')
export function Reasons({ list, max = 3 }) {
  const rank = (r) => (REASON_TONE[r] === 'hot' ? 0 : REASON_TONE[r] === 'warm' ? 1 : 2)
  const shown = list.filter((r) => r !== 'You replied').sort((a, b) => rank(a) - rank(b)).slice(0, max)
  if (!shown.length) return null
  return <span className="reasons">{shown.map((r) => <span key={r} className={`reason ${REASON_TONE[r] || ''}`}>{t(r)}</span>)}</span>
}

function ThreadRow({ t, on, onOpen }) {
  const m = t.latest
  return (
    <li>
      <button className={`mrow ${on ? 'on' : ''} ${t.unread ? '' : 'read'}`} onClick={() => onOpen(t.latest.id)}>
        <span className="mrow-dot">{t.lead.flagged ? <Icon name="star" size={11} /> : t.unread > 0 && <span className="unread-dot" />}</span>
        <span className="mrow-main">
          <span className="mrow-top">
            <b>{t.people.slice(0, 3).join(', ')}{t.people.length > 3 ? ` +${t.people.length - 3}` : ''}</b>
            {t.count > 1 && <span className="mrow-count">{t.count}</span>}
            <span className="mrow-time">{fmtRelative(m.received)}</span>
          </span>
          <span className="mrow-subject">{m.subject}</span>
          {(t.lead.ai || m.snippet) && (
            <span className={`mrow-snippet ${t.lead.ai ? 'ai' : ''}`}>{t.lead.ai && <Icon name="sparkle" size={10} />}{t.lead.ai || m.snippet}</span>
          )}
          <Reasons list={t.lead.reasons} />
        </span>
      </button>
    </li>
  )
}

const ACTIONS = [
  ['reply', 'Draft reply', 'edit'],
  ['summary', 'Summarize', 'sparkle'],
  ['tasks', 'Action items', 'check'],
  ['jira', 'Ticket', 'plus'],
]

function Reader({ id, summary, onBack, onOpenAgent, onRule, rules, onOpen }) {
  const { data, error } = usePoll(id ? `/mail/message/${id}` : null, 10 * 60 * 1000)
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
      setMsg({ ok: true, text: 'Agent started in the Mail space. Opening it…' })
      setAsk('')
      if (out.paneId && onOpenAgent) setTimeout(() => onOpenAgent(out.paneId), 1200)
    } catch (x) { setMsg({ ok: false, text: x.message }) } finally { setBusy(null) }
  }
  if (!m) return <div className="mreader empty"><Icon name="mail" size={22} /><p>Pick a message to read it here.</p></div>
  const addr = (m.address || (/<([^>]+)>/.exec(data?.from || '') || [])[1] || '').toLowerCase()
  const subject = m.subject || data?.subject || ''
  const from = m.from || (data?.from || '').replace(/\s*<[^>]+>/, '').replace(/"/g, '')
  const isVip = rules?.vip?.includes(addr)
  const isMuted = rules?.mute?.includes(addr)
  const link = mailLink(m.mid)
  return (
    <article className="mreader">
      <header className="mreader-head">
        {onBack && <button className="icon-btn" onClick={onBack} aria-label="Back to list"><Icon name="chevron" size={14} className="rot180" /></button>}
        <div className="mreader-titles">
          <h3>{subject}</h3>
          <p><b>{from}</b> {addr && <span className="muted">&lt;{addr}&gt;</span>} · <span className="muted">{new Date(m.received).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></p>
          {data?.to && <p className="muted small mreader-to">To {data.to}{data.cc ? ` · Cc ${data.cc}` : ''}</p>}
          <Reasons list={m.reasons} max={6} />
        </div>
      </header>

      <div className="mreader-agent">
        <div className="mreader-actions">
          {ACTIONS.map(([a, label, icon]) => (
            <button key={a} className="btn small" onClick={() => run(a)} disabled={!!busy}><Icon name={icon} size={12} /> {busy === a ? 'Starting…' : label}</button>
          ))}
        </div>
        <form className="mreader-ask" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) run('custom') }}>
          <Icon name="bot" size={13} />
          <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Or tell an agent what to do with this email…" />
          <button className="btn small primary" disabled={!ask.trim() || !!busy}>{busy === 'custom' ? 'Starting…' : 'Go'}</button>
        </form>
        {msg && <p className={`small ${msg.ok ? 'muted' : 'error-text'}`}>{msg.text}</p>}
      </div>

      {m.ai && <p className="mreader-ai"><Icon name="sparkle" size={12} /> {m.ai}</p>}
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
      {data && (
        <>
          <div className="mreader-body">{data.latest || m.snippet || 'No text in this message.'}</div>
          {data.quoted && (
            <>
              <button className="ghost-btn" onClick={() => setQuoted(!quoted)}><Icon name="chevron" size={10} className={quoted ? 'rot90' : ''} /> {quoted ? 'Hide' : 'Show'} earlier messages</button>
              {quoted && <div className="mreader-body quoted">{data.quoted}</div>}
            </>
          )}
          {data.attachments.length > 0 && <div className="mreader-files">{data.attachments.map((a) => <span key={a} className="chip"><Icon name="file" size={11} /> {a}</span>)}</div>}
          {data.thread.length > 1 && (
            <div className="mreader-thread">
              <span className="na-label">Thread · {data.thread.length}</span>
              <ul>
                {data.thread.map((t) => (
                  <li key={t.id}>
                    <button className={t.id === id ? 'on' : ''} onClick={() => onOpen(t.id)}>
                      <b>{t.mine ? 'You' : t.from}</b><span className="muted">{fmtRelative(t.received)}</span>
                      <span className="mreader-thread-snip">{t.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <footer className="mreader-foot">
        {link && <a className="ghost-btn" href={link}><Icon name="mail" size={12} /> Open in Mail</a>}
        <a className="ghost-btn" href={outlookUrl()} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> Outlook</a>
        <span className="grow" />
        {addr && <button className={`ghost-btn ${isVip ? 'strong' : ''}`} onClick={() => onRule(addr, isVip ? 'none' : 'vip')} title="Always rank this sender as important">
          <Icon name="star" size={12} /> {isVip ? 'Important sender' : 'Always important'}
        </button>}
        {addr && <button className="ghost-btn" onClick={() => onRule(addr, isMuted ? 'none' : 'mute')} title="Never rank this sender as important">
          <Icon name="x" size={12} /> {isMuted ? 'Unmute' : 'Mute sender'}
        </button>}
      </footer>
    </article>
  )
}

const TABS = [
  ['needs', 'Needs you'],
  ['action', 'Action'],
  ['waiting', 'Waiting'],
  ['all', 'All'],
]

export default function MailView({ onOpenAgent, openId }) {
  const { data, error, refresh } = useMail()
  const [tab, setTab] = usePersisted('cc-mail-tab', 'needs')
  const [sel, setSel] = useState(openId || null)
  const [q, setQ] = useState('')
  const [triage, setTriage] = useState(null)
  const [ref, width] = useWidth()
  const narrow = width > 0 && width < 760

  useEffect(() => { if (openId) setSel(openId) }, [openId])

  const msgs = data?.messages || []
  const lists = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const match = (m) => !ql || `${m.from} ${m.address} ${m.subject} ${m.snippet || ''} ${m.ai || ''}`.toLowerCase().includes(ql)
    const f = msgs.filter(match)
    return {
      needs: threads(f.filter((m) => m.bucket === 'needs')).sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.score - a.score),
      action: threads(f.filter((m) => m.bucket === 'action')).sort((a, b) => (a.latest.received < b.latest.received ? 1 : -1)),
      all: threads(f).sort((a, b) => (a.latest.received < b.latest.received ? 1 : -1)),
    }
  }, [msgs, q])
  const waiting = (data?.waiting || []).filter((w) => !q || `${w.subject} ${w.to}`.toLowerCase().includes(q.toLowerCase()))
  const selMsg = msgs.find((m) => m.id === sel)
  // A message opened from the thread list may be outside the scored window; show what we know.
  const summary = selMsg || (sel ? { id: sel, from: '', address: '', subject: '', reasons: [], received: new Date().toISOString() } : null)

  const setRule = async (address, rule) => { await api('/mail/rules', { method: 'POST', body: { address, rule } }); refresh('?refresh=1') }
  const runTriage = async () => {
    setTriage('busy')
    try { const out = await api('/mail/triage', { method: 'POST' }); setTriage('started'); if (out.paneId && onOpenAgent) setTimeout(() => onOpenAgent(out.paneId), 1200) } catch (x) { setTriage(x.message) }
  }

  if (data && !data.available) {
    return <div className="mailv"><div className="mail-setup pad"><MailSetup data={data} onCheck={() => refresh('?refresh=1')} /></div></div>
  }
  const counts = { needs: lists.needs.filter((t) => t.unread).length || lists.needs.length, action: lists.action.length, waiting: waiting.length, all: null }
  const showReader = !narrow || sel
  const showList = !narrow || !sel

  return (
    <div className={`mailv ${narrow ? 'narrow' : ''}`} ref={ref}>
      {showList && (
        <div className="mlist">
          <div className="mlist-bar">
            <div className="mlist-stats">
              <span><b>{data?.unread ?? '–'}</b> unread</span>
              <span><b>{data?.flagged ?? '–'}</b> flagged</span>
              <span><b>{data?.today ?? '–'}</b> today</span>
            </div>
            <span className="grow" />
            <button className="btn small" onClick={runTriage} disabled={triage === 'busy' || !data} title="An agent reads what needs you and suggests what to do with each">
              <Icon name="sparkle" size={12} /> {triage === 'busy' ? 'Starting…' : 'Triage with agent'}
            </button>
            <button className="icon-btn" onClick={() => refresh('?refresh=1')} aria-label="Refresh"><Icon name="refresh" size={13} /></button>
          </div>
          {triage && triage !== 'busy' && <p className={`small pad-x ${triage === 'started' ? 'muted' : 'error-text'}`}>{triage === 'started' ? 'Triage agent started in the Mail space.' : triage}</p>}
          <div className="mlist-tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={`fchip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}{counts[k] ? <span className="fchip-n">{counts[k]}</span> : null}</button>
            ))}
          </div>
          <label className="mlist-search"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by sender or subject" /></label>
          {error && <p className="error-text pad-x">{error}</p>}
          {!data && !error && <div className="skeleton-rows pad"><div /><div /><div /></div>}
          <div className="mlist-scroll">
            {tab === 'waiting' ? (
              <ul className="mlist-items">
                {waiting.map((w) => (
                  <li key={w.id}>
                    <button className={`mrow read ${sel === w.id ? 'on' : ''}`} onClick={() => setSel(w.id)}>
                      <span className="mrow-dot"><Icon name="clock" size={11} /></span>
                      <span className="mrow-main">
                        <span className="mrow-top"><b>To {w.to}</b><span className="mrow-time">{fmtRelative(w.sent)}</span></span>
                        <span className="mrow-subject">{w.subject}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {!waiting.length && data && <p className="muted small pad">No unanswered threads from the last 10 days.</p>}
              </ul>
            ) : (
              <ul className="mlist-items">
                {lists[tab].map((t) => <ThreadRow key={t.key} t={t} on={t.lead.id === sel || t.latest.id === sel} onOpen={setSel} />)}
                {data && !lists[tab].length && <p className="muted small pad">{tab === 'needs' ? 'Nothing needs you right now.' : 'Nothing here.'}</p>}
              </ul>
            )}
            {data && tab === 'needs' && (
              <p className="mlist-why muted small">
                Ranked from what Mail already knows: sent to you or only cc'd, whether you write to the sender, threads you're in and have answered, urgency words, and Apple's Primary / Updates / Promotions sorting. Star or mute a sender to teach it.
              </p>
            )}
          </div>
        </div>
      )}
      {showReader && <Reader id={sel} summary={summary} onBack={narrow ? () => setSel(null) : null} onOpenAgent={onOpenAgent} onRule={setRule} rules={data?.rules} onOpen={setSel} />}
    </div>
  )
}
