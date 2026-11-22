import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, onThisComputer, usePoll } from '../../api.js'
import { Browse, DeletedBot, platName } from '../settings/Bots.jsx'
import { ConnectionsList } from './ConnectionCard.jsx'
import SessionList from './SessionList.jsx'
import { BotDot } from './RailBots.jsx'
import { accessSaid } from './access.js'
import { usePolled, stateOf } from './sessions.js'
import { useBots, statusOf, STATUS, needsCount, openBot, openBots, refreshBots, chiefIdOf, BOTS_TABS } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'
import './bots-home.css'

// Bots (view:bots:<tab>; the sidebar's Bots, the phone's More › Bots): three tabs.
//   Connections: the apps your bots are reached through, each a card (ConnectionCard.jsx).
//   Bots: the Chiefs first, then the specialists, each a card opening its page; New bot asks three
//     things (what it's for, its folder, which connection) and makes it, with everything else as
//     most bots want it (it reads and edits its folder, answers in a thread, Claude Code answers).
//   Sessions: every conversation they're having (SessionList.jsx).
// What waits for you is counted on the tabs. tab: which; onTab(tab) shows another (in this tab of
// the app). 'new' is Bots with New bot open.

export default function BotsHome({ tab = 'bots', phone = false, onTab }) {
  const { list, deleted, error } = useBots()
  const sessions = usePolled('/bots/sessions', 8000)
  const waiting = (sessions.data?.sessions || []).filter((s) => stateOf(s) === 'waiting').length
  const conns = usePoll('/connections', 10000).data?.connections || null
  const at = tab === 'new' ? 'bots' : BOTS_TABS.includes(tab) ? tab : 'bots'
  const needs = needsCount(list)
  const LABEL = { connections: t('Connections'), bots: t('Bots'), sessions: t('Sessions') }
  const ICON = { connections: 'link', bots: 'bot', sessions: 'chat' }
  const count = { connections: (conns || []).filter((c) => c.state === 'error' || (c.shared && !c.owner && c.state === 'connected')).length, bots: needs, sessions: waiting }
  return (
    <div className={`bh${phone ? ' phone' : ''}`} data-setting={phone ? 'phone-bots' : 'bots-home'} data-tab={at}>
      <header className="bh-head">
        <Icon name="bot" size={16} />
        <h2 className="bp-name">{t('Bots')}</h2>
        <span className="sb-grow" />
      </header>
      <div className="seg bh-tabs" role="tablist" aria-label={t('Bots')}>
        {BOTS_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={at === k} className={at === k ? 'on' : ''} onClick={() => onTab(k)} data-tab={k}>
            <Icon name={ICON[k]} size={13} /><span>{LABEL[k]}</span>
            {count[k] > 0 && <span className="bt-count" aria-label={count[k] === 1 ? t('{n} needs you', { n: count[k] }) : t('{n} need you', { n: count[k] })}>{count[k]}</span>}
          </button>
        ))}
      </div>
      <div className="bh-body sb">
        {at === 'connections' && <ConnectionsList phone={phone} />}
        {at === 'bots' && <BotsTab list={list} deleted={deleted} error={error} conns={conns} adding={tab === 'new'} onTab={onTab} />}
        {at === 'sessions' && <SessionList bots={list || []} phone={phone} />}
      </div>
    </div>
  )
}

// ---------- Bots ----------
function BotsTab({ list, deleted, error, conns, adding, onTab }) {
  const [open, setOpen] = useState(adding)
  useEffect(() => { if (adding) setOpen(true) }, [adding])
  if (error && !list) return <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {error}</p>
  if (!list) return <div className="skeleton-rows"><div /><div /><div /></div>
  const live = list.filter((b) => !b.draft)
  const drafts = list.filter((b) => b.draft)
  // (The Chiefs first, each with the connections it's Chief of; then the specialists.)
  const chiefOf = (id) => (conns || []).filter((c) => chiefIdOf(c) === id)
  const chiefs = live.filter((b) => chiefOf(b.id).length)
  const rest = live.filter((b) => !chiefOf(b.id).length)
  const first = !live.length && !drafts.length
  return (
    <div className="bh-bots" data-setting="bots-list">
      {!first && !open && (
        <div className="st-row bh-new-row">
          <button type="button" className="btn small primary" onClick={() => setOpen(true)} data-setting="bots-new"><Icon name="plus" size={12} /> {t('New bot')}</button>
          <span className="muted small">{t('Three questions: what it\'s for, its folder, where it answers.')}</span>
        </div>
      )}
      {(first || open) && <QuickCreate conns={conns} first={first} onClose={first ? null : () => { setOpen(false); if (adding) onTab('bots') }} />}
      {chiefs.length > 0 && (
        <section className="bh-group" data-group="chiefs">
          <h4 className="bh-group-head">{chiefs.length === 1 ? t('Chief') : t('Chiefs')}</h4>
          <div className="bh-cards">{chiefs.map((b) => <BotCard key={b.id} b={b} chief={chiefOf(b.id)} />)}</div>
        </section>
      )}
      {rest.length > 0 && (
        <section className="bh-group" data-group="specialists">
          {chiefs.length > 0 && <h4 className="bh-group-head">{t('Specialists')}</h4>}
          <div className="bh-cards">{rest.map((b) => <BotCard key={b.id} b={b} />)}</div>
        </section>
      )}
      {drafts.length > 0 && (
        <section className="bh-group" data-group="drafts">
          <h4 className="bh-group-head">{t('Drafts')}</h4>
          <div className="cn-bots">{drafts.map((b) => <button key={b.id} type="button" className="sb-chip" data-bot={b.id} onClick={() => openBot(b.id)}><BotDot status="draft" size={8} /><span className="sb-chip-name">{b.name}</span><span className="bt-tag">{t('Draft')}</span></button>)}</div>
        </section>
      )}
      {deleted.length > 0 && (
        <details className="sb-how bh-gone" data-group="deleted">
          <summary><Icon name="chevron" size={11} />{t('Deleted Bots ({n})', { n: deleted.length })}</summary>
          {deleted.map((d) => (
            <details key={d.id} className="sb-how bh-gone-one" data-bot={d.id}>
              <summary><Icon name="archive" size={11} />{d.name}</summary>
              <DeletedBot key={`${d.id}-${d.cleared || ''}`} d={d} reload={refreshBots} />
            </details>
          ))}
        </details>
      )}
    </div>
  )
}

// A bot as a card: what it's for, what it may do, how it stands, today, and what waits for you.
function BotCard({ b, chief = [] }) {
  const st = statusOf(b)
  return (
    <button type="button" className={`bo-card bo-${st}`} data-bot={b.id} onClick={() => openBot(b.id)}>
      <span className="bo-card-head">
        <BotDot status={st} size={8} />
        <b className="bo-name">{b.name}</b>
        <span className="muted small bo-status">{t(STATUS[st])}</span>
      </span>
      <span className={`small bo-for${b.description ? '' : ' muted'}`}>{b.description || t('No line on what it\'s for yet: the Chief has only its name to go by.')}</span>
      {chief.length > 0 && <span className="small muted">{t('Chief of {names}', { names: chief.map((c) => (c.platform === 'teams' ? c.name : `@${c.name}`)).join(', ') })}</span>}
      {b.access && <span className="small bo-access"><Icon name="lock" size={11} /> <span>{accessSaid(b.access)}</span></span>}
      <span className="small bo-stats">
        <span className="muted">{b.today === 1 ? t('1 question today') : t('{n} questions today', { n: b.today || 0 })}</span>
        {b.waiting > 0 && <span className="bo-wait">{b.waiting === 1 ? t('{n} waits for you', { n: b.waiting }) : t('{n} wait for you', { n: b.waiting })}</span>}
        {b.proposed > 0 && <span className="muted">{t('{n} to keep', { n: b.proposed })}</span>}
      </span>
    </button>
  )
}

// ---------- New bot ----------
// What it's for, its folder, and which connection: the rest as most bots want it. A Bridge AI that
// can't make one from these three (no /bots/quick) makes it the long way, with the same result.
const nameFrom = (purpose) => {
  const w = String(purpose || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().split(/\s+/).filter((x) => x.length > 2 && !/^(the|and|for|from|with|that|this|answers?|helps?|about|questions?)$/i.test(x))
  const n = w.slice(0, 2).map((x) => x.charAt(0).toLocaleUpperCase() + x.slice(1)).join(' ')
  return (n || t('New Bot')).slice(0, 35)
}
function QuickCreate({ conns, first = false, onClose }) {
  const [purpose, setPurpose] = useState('')
  const [folder, setFolder] = useState('')
  const [conn, setConn] = useState('')
  const [browse, setBrowse] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const pickFolder = onThisComputer() ? window.bridgeApp?.pickFolder : null
  const shared = (conns || []).filter((c) => c.shared)
  // (The shared Slack connection to start, else the first shared one.)
  useEffect(() => { if (!conn && shared.length) setConn((shared.find((c) => c.platform === 'slack') || shared[0]).id) }, [shared.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const make = async (e) => {
    e.preventDefault()
    // (Its folder too: /bots/quick makes a bot that reads and edits one, and asks for it.)
    if (!purpose.trim() || !folder.trim() || busy) return
    setBusy(true)
    setError(null)
    const body = { purpose: purpose.trim(), folder: folder.trim() || null, connection: conn || null }
    try {
      let id
      try {
        const r = await api('/bots/quick', { method: 'POST', body })
        id = r?.id || r?.bot?.id
      } catch (err) {
        if (err.status !== 404) throw err
        const b = await api('/bots', { method: 'POST', body: { name: nameFrom(body.purpose), description: body.purpose.slice(0, 140), ...(body.folder ? { readsFrom: [body.folder] } : {}) } })
        id = b.id
        await api(`/bots/${id}/settings`, { method: 'POST', body: { answerIn: 'thread', ...(body.folder ? { changes: 'edit', writesTo: [body.folder] } : {}) } }).catch(() => {})
      }
      refreshBots()
      setPurpose('')
      setFolder('')
      // (Made from three answers: its page opens without AI Assist's chat beside it.)
      try { localStorage.setItem(`cc-bot-assist-${id}`, 'shut') } catch { /* private window */ }
      if (id) openBot(id)
      onClose?.()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }
  // (Where it would answer, when that isn't working yet: said, with where to set it up.)
  const via = shared.find((x) => x.id === conn) || (shared.length === 1 ? shared[0] : null)
  const viaName = via ? (via.platform === 'teams' ? via.name : `@${via.name}`) : ''
  return (
    <form className="st-sec bh-quick" onSubmit={make} data-setting="bots-quick">
      <h4>{first ? t('Make Your First Bot') : t('New Bot')}</h4>
      {first && <p className="muted small">{t('A bot answers people in Slack, Discord or Microsoft Teams from a folder on this computer, as a Claude Code session that remembers each thread.')}</p>}
      <label className="sb-field"><span>{t('What it\'s for')}</span>
        <textarea className="st-input" rows={2} value={purpose} maxLength={400} onChange={(e) => setPurpose(e.target.value)} placeholder={t('Answers hiring questions and keeps the candidate notes up to date')} aria-label={t('What it\'s for')} />
      </label>
      <label className="sb-field"><span>{t('Folder')}</span>
        <span className="sb-add">
          <input className="st-input mono" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="~/Hiring" aria-label={t('Its folder')} spellCheck={false} />
          <button type="button" className="btn small" aria-expanded={browse} onClick={async () => { if (!pickFolder) return setBrowse((x) => !x); const p = await pickFolder().catch(() => null); if (p) setFolder(p) }}>{t('Choose…')}</button>
        </span>
      </label>
      {browse && <Browse label={t('Pick its folder')} button={t('Use this folder')} onPick={(f) => { setFolder(f); setBrowse(false) }} onClose={() => setBrowse(false)} />}
      {shared.length > 1 && (
        <label className="sb-field"><span>{t('Where it answers')}</span>
          <select className="st-input" value={conn} onChange={(e) => setConn(e.target.value)} aria-label={t('Where it answers')}>
            {shared.map((c) => <option key={c.id} value={c.id}>{`${c.platform === 'teams' ? c.name : `@${c.name}`} (${platName(c.platform)})${c.state === 'connected' ? '' : ` · ${c.state === 'no-tokens' ? t('not set up') : t('not connected')}`}`}</option>)}
          </select>
        </label>
      )}
      {shared.length === 1 && <p className="muted small" data-setting="bots-quick-via">{t('It answers through {name} on {platform}.', { name: shared[0].platform === 'teams' ? shared[0].name : `@${shared[0].name}`, platform: platName(shared[0].platform) })}</p>}
      {via && via.state !== 'connected' && <p className="small bh-quick-warn" data-setting="bots-quick-unset"><Icon name="info" size={12} /> <span>{via.state === 'no-tokens' ? t('{name} isn\'t set up yet, so it isn\'t reached until it is.', { name: viaName }) : t('{name} isn\'t connected now, so it isn\'t reached until it is.', { name: viaName })}</span> <button type="button" className="link-btn" onClick={() => openBots('connections')}>{t('Set it up in Connections')}</button></p>}
      {conns && !shared.length && <p className="muted small">{t('No connection yet: make one in Connections once it\'s made, for all your bots.')}</p>}
      {folder.trim() && <p className="muted small">{t('It reads and edits files there: yours at once, anyone else\'s once you OK them.')}</p>}
      {error && <p className="error-text small" role="alert">{error}</p>}
      <div className="st-row">
        <button type="submit" className="btn small primary" disabled={busy || !purpose.trim() || !folder.trim()}><Icon name="plus" size={12} /> {busy ? t('Making it…') : t('Make the bot')}</button>
        {onClose && <button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button>}
        <span className="sb-grow" />
        <button type="button" className="link-btn small ai-assist-link" onClick={() => openBot('new')}><Icon name="wand" size={12} /> {t('Or describe it to AI Assist')}</button>
      </div>
    </form>
  )
}
