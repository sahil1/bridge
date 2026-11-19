import Icon from '../Icon.jsx'
import { usePoll } from '../../api.js'
import { platName } from '../settings/Bots.jsx'
import { BotDot } from './RailBots.jsx'
import { useBots, statusOf, STATUS, openBot } from './bots.js'
import { accessSaid } from './access.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// Your bots at a glance (view:bot:overview: the sidebar's Bots › Overview, the phone's More › Bots
// › Overview): one picture of each connection (a Slack app, a Discord bot, a Teams app), the routing
// that hands its questions out, and the bots it reaches, each a card: what it's for, what it may do
// (its Access in a line), how it stands (answering, paused, needs you), how many questions it's had
// today, and the answers waiting for you. Everything opens what it shows: a connection opens
// Connections, its routing the Routing page, a bot its page. A bot no connection reaches yet is
// under Not Reached Yet, and a draft waits for Create. From the list the sidebar already polls
// (bots.js), and the connections, every few seconds while it's open.
export default function Overview({ phone = false }) {
  const { list, error } = useBots()
  const r = usePoll('/connections', 10000)
  const conns = r.data?.connections || null
  if ((error || r.error) && (!list || !conns)) return <div className={`bo${phone ? ' phone' : ''}`}><p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {error || r.error}</p></div>
  if (!list || !conns) return <div className="skeleton-rows"><div /><div /><div /></div>
  const live = list.filter((b) => !b.draft)
  const drafts = list.filter((b) => b.draft)
  const lanes = [...conns.filter((c) => c.shared), ...conns.filter((c) => !c.shared)]
  const reached = new Set(conns.flatMap((c) => c.bots.map((b) => b.id)))
  const alone = live.filter((b) => !reached.has(b.id))
  return (
    <div className={`bo${phone ? ' phone' : ''}`} data-setting="bots-overview">
      <header className="bp-head bo-head">
        <Icon name="bot" size={15} />
        <h2 className="bp-name">{t('Bots')}</h2>
        <span className="sb-grow" />
        <button type="button" className="btn small" onClick={() => openBot('connections')}><Icon name="link" size={12} /> {t('Connections')}</button>
        <button type="button" className="btn small primary" onClick={() => openBot('new')}><Icon name="plus" size={12} /> {t('New bot')}</button>
      </header>
      <p className="muted small bo-about">{t('Each connection is an app people call; its routing hands each question to one of its bots, and each bot answers as its own Access allows.')}</p>
      {!live.length && !drafts.length && (
        <div className="trial-off bo-empty">
          <Icon name="bot" size={22} />
          <b>{t('No bots yet')}</b>
          <p className="muted">{t('Make one for each use case, such as Hiring or Marketing, each with its own folders, memory and people who may ask.')}</p>
          <button type="button" className="btn small primary" onClick={() => openBot('new')}><Icon name="plus" size={12} /> {t('Make your first bot')}</button>
        </div>
      )}
      {(live.length > 0 || lanes.length > 0) && lanes.map((c) => <Lane key={c.id} c={c} bots={live.filter((b) => c.bots.some((x) => x.id === b.id))} />)}
      {alone.length > 0 && (
        <section className="bo-lane" data-lane="none">
          <button type="button" className="bo-node bo-conn" onClick={() => openBot('connections')}>
            <span className="bo-node-head"><Icon name="link" size={13} /><b className="small">{t('Not Reached Yet')}</b></span>
            <span className="muted small">{t('No connection reaches these: make one in Connections.')}</span>
          </button>
          <Icon name="chevron" size={13} className="bo-arrow" />
          <span className="bo-node bo-route bo-none"><span className="muted small">{t('No routing')}</span></span>
          <Icon name="chevron" size={13} className="bo-arrow" />
          <div className="bo-cards">{alone.map((b) => <Card key={b.id} b={b} />)}</div>
        </section>
      )}
      {drafts.length > 0 && (
        <section className="bo-drafts" data-lane="drafts">
          <b className="small">{t('Drafts')}</b>
          <div className="cn-bots">{drafts.map((b) => <button key={b.id} type="button" className="sb-chip" data-bot={b.id} onClick={() => openBot(b.id)}><BotDot status="draft" size={8} /><span className="sb-chip-name">{b.name}</span><span className="bt-tag">{t('Draft')}</span></button>)}</div>
        </section>
      )}
    </div>
  )
}

// One connection, its routing, and its bots, left to right (top to bottom on a phone).
function Lane({ c, bots }) {
  const up = c.state === 'connected'
  const fallback = c.unsure ? c.bots.find((b) => b.id === c.unsure)?.name : null
  const route = c.shared
    ? [
        c.defaults.length === 1 ? t('1 channel goes to one bot') : c.defaults.length > 1 ? t('{n} channels each go to one bot', { n: c.defaults.length }) : null,
        c.assist !== false ? t('AI Assist picks by description') : t('AI Assist doesn\'t pick'),
        fallback ? t('else {bot}', { bot: fallback }) : t('else it asks which'),
      ].filter(Boolean)
    : [t('Every question is {bot}\'s', { bot: c.own?.name || '' })]
  return (
    <section className="bo-lane" data-lane={c.id} data-platform={c.platform}>
      <button type="button" className="bo-node bo-conn" onClick={() => openBot('connections')} title={t('Connections')}>
        <span className="bo-node-head"><span className={`sb-dot ${up ? 'ok' : c.state === 'error' ? 'bad' : 'warn'}`} aria-hidden="true" /><b className="small bo-node-name">{c.platform === 'teams' ? c.name : `@${c.name}`}</b></span>
        <span className="small"><span className={`sb-plat p-${c.platform}`}>{platName(c.platform)}</span> <span className="muted">{c.shared ? t('Shared') : t('{bot}\'s own', { bot: c.own?.name || '' })}</span></span>
        <span className="muted small">{up ? t('Connected') : c.state === 'no-tokens' ? t('Not set up yet') : t('Not connected')}</span>
      </button>
      <Icon name="chevron" size={13} className="bo-arrow" />
      {c.shared
        ? (
          <button type="button" className="bo-node bo-route" onClick={() => openBot(`routing:${c.id}`)} data-setting="overview-routing">
            <span className="bo-node-head"><Icon name="branch" size={13} /><b className="small">{t('Routing')}</b></span>
            <span className="muted small">{route.join(' · ')}</span>
          </button>
        )
        : <span className="bo-node bo-route bo-none"><span className="muted small">{route[0]}</span></span>}
      <Icon name="chevron" size={13} className="bo-arrow" />
      <div className="bo-cards">
        {bots.length ? bots.map((b) => <Card key={b.id} b={b} />) : <p className="small sb-none">{t('No bot on it yet.')}</p>}
      </div>
    </section>
  )
}

// A bot as a card: what it's for, what it may do, how it stands, today, and what waits for you.
function Card({ b }) {
  const st = statusOf(b)
  return (
    <button type="button" className={`bo-card bo-${st}`} data-bot={b.id} onClick={() => openBot(b.id)}>
      <span className="bo-card-head"><BotDot status={st} size={8} /><b className="bo-name">{b.name}</b><span className="muted small bo-status">{t(STATUS[st])}</span></span>
      <span className={`small bo-for${b.description ? '' : ' muted'}`}>{b.description || t('No description yet: AI Assist has only its name to pick it by.')}</span>
      {b.access && <span className="small bo-access"><Icon name="lock" size={11} /> <span>{accessSaid(b.access)}</span></span>}
      <span className="small bo-stats">
        <span className="muted">{b.today === 1 ? t('1 question today') : t('{n} questions today', { n: b.today || 0 })}</span>
        {b.waiting > 0 && <span className="bo-wait">{b.waiting === 1 ? t('{n} waits for you', { n: b.waiting }) : t('{n} wait for you', { n: b.waiting })}</span>}
        {b.proposed > 0 && <span className="muted">{t('{n} to keep', { n: b.proposed })}</span>}
      </span>
    </button>
  )
}
