import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { Bot } from '../settings/Bots.jsx'
import BotChat from './BotChat.jsx'
import BotOverview from './BotOverview.jsx'
import BotsHome from './BotsHome.jsx'
import { BotDot } from './RailBots.jsx'
import { useBots, statusOf, refreshBots, botPlace, botView, BOTS_VIEW } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// Bots' pages in the main area, each in a tab of its own (App.jsx), in one module that loads when
// the first of them opens: Bots itself (BotsHome.jsx: Connections, Bots, Sessions), a session
// (SessionView.jsx: its Thread and Live), and a bot's page here (view:bot:<id>, from Bots, Needs You,
// a session or the phone's More › Bots): its name and how it stands, its tabs (Overview, Settings,
// Memory, Activity), and AI Assist's chat beside them (BotChat.jsx), to set it up or change it in
// words. A draft is its chat alone, with what AI Assist proposed and Create; a new one (view:bot:new)
// a chat that asks what it should do. On a phone the chat takes the page while it's open.
// onOpen(id, { replace }): another bot's page (the draft just made, in this tab). onGone: it was
// deleted. A page Bots had before its tabs (the overview, Connections, a connection's Routing) is
// Bots at the tab that has it now (App.jsx moves it before it shows; here too, in case).
export { default as BotsHome } from './BotsHome.jsx'
export { default as SessionView } from './SessionView.jsx'

export default function BotPage({ id, phone = false, onOpen, onGone, onTab }) {
  const { on, list } = useBots()
  const b = list?.find((x) => x.id === id)
  const moved = botPlace(botView(id))
  // (A bot just made isn't in the list as it last came: that's asked for again, once, before it's
  // called gone; until then, and until the list first comes, its page waits, so a draft is never
  // shown as a made bot.)
  const own = id !== 'new' && moved === botView(id)
  const [asked, setAsked] = useState(null) // { id, list }: the list it wasn't in
  useEffect(() => { if (own && list && !b && asked?.id !== id) { setAsked({ id, list }); refreshBots() } }, [own, id, list, b, asked])
  const waiting = own && on && (!list || (!b && (asked?.id !== id || asked.list === list)))
  if (moved !== botView(id)) return <BotsHome tab={moved.slice(BOTS_VIEW.length)} phone={phone} onTab={(x) => onTab?.(x)} />
  if (id === 'new') return <div className={`bp bp-new${phone ? ' phone' : ''}`}><BotChat id={null} phone={phone} onMade={(bid) => { refreshBots(); onOpen(bid, { replace: true }) }} /></div>
  if (waiting) return <div className={`bp${phone ? ' phone' : ''}`}><div className="skeleton-rows"><div /><div /><div /></div></div>
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
      <Bot key={id} id={id} phone={phone} status={b ? statusOf(b) : null} onChanged={refreshBots} onGone={() => { refreshBots(); onGone?.() }}
        overview={(ctx) => <BotOverview {...ctx} />}
        assist={(ctx) => <BotChat id={id} phone={phone} {...ctx} />} />
    </div>
  )
}
