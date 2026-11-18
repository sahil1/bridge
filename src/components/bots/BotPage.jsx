import Icon from '../Icon.jsx'
import { Bot } from '../settings/Bots.jsx'
import BotChat from './BotChat.jsx'
import { BotDot } from './RailBots.jsx'
import { useBots, statusOf, STATUS, refreshBots } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// A bot as a page of its own in the main area (view:bot:<id>, from the sidebar's Bots, Settings ›
// Bots or the phone's More › Bots), the same bot as Settings shows: its name and how it stands, its
// tabs (Set Up, Try It, Memory, Activity), and AI Assist's chat beside them (BotChat.jsx), to set it
// up or change it in words. A draft is its chat alone, with what AI Assist proposed and Create; a new
// one (view:bot:new) a chat that asks what it should do. On a phone the chat takes the page while
// it's open. phone: laid out for a phone. onOpen(id, { replace }): another bot's page (the draft just
// made, in this tab). onGone: it was deleted.
export default function BotPage({ id, phone = false, onOpen, onGone }) {
  const { list } = useBots()
  if (id === 'new') return <div className={`bp bp-new${phone ? ' phone' : ''}`}><BotChat id={null} phone={phone} onMade={(bid) => { refreshBots(); onOpen(bid, { replace: true }) }} /></div>
  const b = list?.find((x) => x.id === id)
  if (list && !b) {
    return (
      <div className={`bp${phone ? ' phone' : ''}`}>
        <div className="trial-off"><Icon name="bot" size={22} /><b>{t('This bot isn\'t here any more')}</b><p className="muted">{t('It was deleted, or made on another computer.')}</p></div>
      </div>
    )
  }
  if (b?.draft) {
    return (
      <div className={`bp bp-draft${phone ? ' phone' : ''}`}>
        <header className="bp-head">
          <BotDot status="draft" size={9} />
          <h2 className="bp-name">{b.name}</h2>
          <span className="bt-tag">{t('Draft')}</span>
        </header>
        <BotChat id={id} draft phone={phone} onCreated={() => refreshBots()} onDiscarded={() => { refreshBots(); onGone?.() }} />
      </div>
    )
  }
  return (
    <div className={`bp${phone ? ' phone' : ''}`}>
      <Bot key={id} id={id} page phone={phone} status={b ? statusOf(b) : null} onChanged={refreshBots} onGone={() => { refreshBots(); onGone?.() }}
        assist={(ctx) => <BotChat id={id} phone={phone} {...ctx} />} />
    </div>
  )
}

// The phone's More › Bots: your bots as the computer's sidebar lists them, a whole row each with how
// it stands, and New bot, which opens AI Assist's chat.
export function PhoneBots({ onOpen }) {
  const { list, error } = useBots()
  return (
    <div className="m-stack m-more bt-phone" data-setting="phone-bots">
      <ul className="m-more-list" aria-label={t('Your bots')}>
        <li>
          <button type="button" className="m-more-row" data-id="new-bot" onClick={() => onOpen('new')}>
            <span className="m-more-ico"><Icon name="plus" size={17} /></span>
            <span className="m-more-text"><b>{t('New bot')}</b><span>{t('Say what it should do, and who it\'s for: AI Assist sets it up')}</span></span>
            <Icon name="chevron" size={13} className="muted" />
          </button>
        </li>
        {(list || []).map((b) => {
          const st = statusOf(b)
          return (
            <li key={b.id}>
              <button type="button" className="m-more-row" data-id={b.id} onClick={() => onOpen(b.id)}>
                <span className="m-more-ico"><BotDot status={st} size={10} /></span>
                <span className="m-more-text"><b>{b.name}</b><span>{t(STATUS[st])}{b.waiting > 0 ? ` · ${b.waiting === 1 ? t('{n} waits for you', { n: b.waiting }) : t('{n} wait for you', { n: b.waiting })}` : ''}</span></span>
                <Icon name="chevron" size={13} className="muted" />
              </button>
            </li>
          )
        })}
      </ul>
      {!list && !error && <div className="skeleton-rows pad"><div /><div /></div>}
      {error && <p className="error-text small" role="alert">{error}</p>}
    </div>
  )
}
