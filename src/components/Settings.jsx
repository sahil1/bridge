import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useMedia } from './layout.jsx'
import Appearance from './Appearance.jsx'
import Features from './settings/Features.jsx'
import You from './settings/You.jsx'
import Agents from './settings/Agents.jsx'
import Providers, { WhichModel } from './settings/Providers.jsx'
import Mcp from './settings/Mcp.jsx'
import Bots from './settings/Bots.jsx'
import Phone from './settings/Phone.jsx'
import Notifications from './settings/Notifications.jsx'
import Sharing from './settings/Sharing.jsx'
import About from './settings/About.jsx'
import Account from './settings/Account.jsx'
import Meetings from './settings/Meetings.jsx'
import Mail from './settings/Mail.jsx'
import StudioSettings from './settings/Studio.jsx'
import Voice, { Spoken } from './settings/Voice.jsx'
import Dictation from './settings/Dictation.jsx'
import CloudKeys from './settings/CloudKeys.jsx'
import AiProviders from './settings/AiProviders.jsx'
import BackUp from './settings/BackUp.jsx'
import { RemoteAccess } from './remote/Settings.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { SettingsAt } from './settings/where.js'
import { AdvancedFrame, reveal } from './settings/Advanced.jsx'
import { SETTINGS } from './settings/search.js'
import { cloudOnly, usePoll } from '../api.js'
import { sayPlace } from '../backForward.js'
import { t, tx } from '../i18n/index.js'

// One Settings window, Slack style: sections down the left, one scrolling panel on the right. It
// opens on Your Features: each feature as a card, on or off, how it's doing, and Open, to its
// section. The sections are by what you're doing, each in a few tabs where it has more than one
// part (their names and the way to each are shared/places.js, which messages that send you here
// read too): You; Agents & Models; Meetings & Voice; Mail & Calendar, where Bridge AI reads Apple
// Mail (mac); Bots; Devices & Access; Notifications; Account & Backup (Back Up & Move until Bold
// Bridge accounts exist, its Account tab theirs: accounts); About & Updates. A beta feature's
// section (beta) is always there, marked, with its switch at the top: nothing hides until it's on.
// On a phone it's a phone's settings: the list of sections, each opening full width under a bar
// with ‹ Settings (back to the list), its name, and the one close; tabs across the top, two rows of
// two where there are four. Each section shows what most people change first, one line each, the
// rest under Advanced at its end (settings/Advanced.jsx) and the longer words under More.
// A section with tabs has no line under its name there (it would say the tabs again); the phone's
// list of sections keeps it.
export const SECTIONS = [
  { id: 'features', label: tx('Your Features'), icon: 'grid', hint: tx('Each feature at a glance: on or off, how it\'s doing, and where to change it') },
  { id: 'you', label: tx('You'), icon: 'user', hint: tx('Your name and place, and how Bridge AI looks') },
  { id: 'agents-models', label: tx('Agents & Models'), icon: 'bot', hint: tx('Your agents, model providers, which model does what, and MCP servers'),
    tabs: [{ id: 'agents', label: tx('Agents') }, { id: 'providers', label: tx('Model Providers') }, { id: 'models', label: tx('Which Model Does What') }, { id: 'mcp', label: tx('MCP Servers') }] },
  { id: 'meetings-voice', label: tx('Meetings & Voice'), icon: 'mic', hint: tx('Meetings, dictation, the speech models that listen and the voice that answers'),
    tabs: [{ id: 'meetings', label: tx('Meetings') }, { id: 'dictation', label: tx('Dictation') }, { id: 'voice', label: tx('Speech Models') }, { id: 'spoken', label: tx('Spoken Answers') }] },
  { id: 'mail', label: tx('Mail & Calendar'), icon: 'mail', hint: tx('How You Write, and the hours AI Assist offers times in'), mac: true },
  { id: 'studio', label: tx('Studio'), icon: 'signature', hint: tx('Your signatures and initials, and Ask Before Signing') },
  { id: 'bots', label: tx('Bots'), icon: 'chat', hint: tx('Turned on here, then made and run in Bots, in the sidebar'), beta: true },
  { id: 'devices', label: tx('Devices & Access'), icon: 'laptop', hint: tx('Your phone, your other computers, who may see this screen, and Share Links'),
    tabs: [{ id: 'phone', label: tx('Phone') }, { id: 'machines', label: tx('Computers') }, { id: 'remote', label: tx('Remote Access') }, { id: 'sharing', label: tx('Share Links') }] },
  { id: 'notifications', label: tx('Notifications'), icon: 'bell', hint: tx('What you\'re told about, on which devices, and with what sound') },
  { id: 'account-backup', label: tx('Account & Backup'), icon: 'archive', hint: tx('Your Bold Bridge account, and your setup to a file or another computer'),
    tabs: [{ id: 'account', label: tx('Account'), accounts: true }, { id: 'backup', label: tx('Back Up & Move') }] },
  { id: 'about', label: tx('About & Updates'), icon: 'info', hint: tx('Version, updates, beta features, privacy, and reporting a problem') },
]
// Account & Backup before Bold Bridge accounts exist: Back Up & Move alone, by that name.
const NO_ACCOUNTS = { 'account-backup': { label: tx('Back Up & Move'), hint: tx('Your setup, to a file or straight to another computer') } }

// The phone's Cloud agents (cloudOnly): only what there is on the phone alone.
const PHONE = [
  { id: 'cloud', label: tx('Cloud Agents'), icon: 'cloud', hint: tx('Your keys for Cursor, GitHub Copilot, Jules and Claude') },
  { id: 'you', label: tx('You'), icon: 'user', hint: tx('Theme, text size, density') },
]

// What opened a section before it moved, and where that is now: General and Appearance are You,
// Voice & Meetings is Meetings & Voice, the Bots beta's own id is Bots, the config file is About
// & Updates' (under Advanced), and the Beta Features switches of the features out of beta (3.22.0)
// are their own settings.
const ALIAS = { general: 'you', appearance: 'you', 'voice-meetings': 'meetings-voice', 'slack-bot': 'bots', config: 'config-file', 'beta-home': 'home', 'beta-routines': 'scheduled-routines', 'beta-meeting-insights': 'meeting-insights', 'beta-dictation-cleanup': 'tidy' }

// section: where Settings opens. "all" is Settings itself: the list on a phone, Your Features on a
// wider screen. A section's id opens it (on a phone with ‹ Settings back to the list), and so does
// one setting's (search.js: "accounts", "cloud", "permissions", "commands", "topbar" and the rest),
// which opens its section at it, with Advanced opened when it's in there (reveal). A tab's id opens
// its section at it (and is no setting's, though Dictation and Computers, "machines", are both), and
// a section with tabs opens at its first.
const holds = (s, id) => s.id === id || !!s.tabs?.some((x) => x.id === id)
const isPlace = (id) => SECTIONS.some((s) => holds(s, id))
const settingOf = (section) => {
  const id = ALIAS[section] || section
  return cloudOnly || isPlace(id) ? null : SETTINGS.find((x) => x.id === id) || null
}
const sectionFor = (section, sections) => {
  const id = ALIAS[section] || section
  const to = cloudOnly ? (section === 'all' ? null : ['you', 'appearance', 'general'].includes(section) ? 'you' : 'cloud') : settingOf(section)?.section || id
  const s = sections.find((x) => holds(x, to))
  return !s ? null : s.tabs && s.id === to ? s.tabs[0].id : to
}

// What shows here: Mail where it's read, and a section's accounts tab (with its name for it) once
// Bold Bridge accounts exist. (A section left one tab shows no tabs.)
const shownOf = (conf) => SECTIONS.filter((s) => !s.mac || conf?.mail)
  .map((s) => (!s.tabs?.some((x) => x.accounts) || conf?.accounts ? s : { ...s, ...NO_ACCOUNTS[s.id], tabs: s.tabs.filter((x) => !x.accounts) }))
const tabsOf = (s) => (s?.tabs?.length > 1 ? s.tabs : null)

export default function Settings({ section = 'all', onClose, onOpenAgent }) {
  const conf = usePoll(cloudOnly ? null : '/config', 10 * 60 * 1000).data
  const sections = cloudOnly ? PHONE : shownOf(conf)
  const phone = useMedia('(max-width: 760px)')
  const to = sectionFor(section, sections)
  const [at, setAt] = useState(to || sections[0].id) // the section showing, or its tab
  const [list, setList] = useState(!to) // on a phone: the list of sections, rather than one of them
  const go = (id) => { setAt(id); setList(false) }
  const show = (id) => { const s = settingOf(id); if (s) reveal(ALIAS[id] || id, s.near) }
  useEffect(() => { if (to) go(to) }, [to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (to) show(section) }, [section]) // eslint-disable-line react-hooks/exhaustive-deps
  // A link to a section from inside Settings (Meetings' Model Providers, Your Features' Open), even
  // to the one it opened at.
  const shown = useRef(sections)
  shown.current = sections
  useEffect(() => {
    const on = (e) => {
      const s = sectionFor(e.detail?.section, shown.current)
      if (!s) return
      go(s)
      show(e.detail.section)
    }
    window.addEventListener('bridge-open-settings', on)
    return () => window.removeEventListener('bridge-open-settings', on)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('textarea, input')) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const cur = sections.find((s) => holds(s, at)) || sections[0]
  const tabs = tabsOf(cur)
  const tab = tabs?.find((x) => x.id === at)
  // Which section, and which tab of it, for Back and Forward (src/backForward.js): each is a place.
  useEffect(() => { sayPlace('settings', at, `${t('Settings')} › ${t(cur?.label || '')}${tab ? ` › ${t(tab.label)}` : ''}`) }, [at, cur?.label, tab?.label])
  useEffect(() => () => sayPlace('settings', null), [])
  const showList = phone && list
  // A section picked from the list: one with tabs at its first, or where it is when it's showing already.
  const open = (s) => go(!s.tabs ? s.id : s === cur && !showList ? at : s.tabs[0].id)
  // From the list to a section and back, the focus goes along: to ‹ Settings, then to the row left.
  const sheet = useRef(null)
  const was = useRef(showList)
  useEffect(() => {
    if (was.current === showList) return
    was.current = showList
    sheet.current?.querySelector(showList ? `.st-list-row[data-id="${cur.id}"]` : '.st-back')?.focus()
  }, [showList]) // eslint-disable-line react-hooks/exhaustive-deps
  const agent = (id) => { onOpenAgent?.(id); onClose() }

  const body = (
    <SettingsAt.Provider value={at}>
    <ErrorBoundary key={at} name={t(cur.label)} resetKey={at}>
    <AdvancedFrame section={at}>
    {at === 'features' && <Features onOpenAgent={agent} />}
    {at === 'you' && (cloudOnly ? <Appearance /> : <You />)}
    {at === 'agents' && <Agents onOpenAgent={agent} />}
    {at === 'providers' && <Providers onOpenAgent={agent} />}
    {at === 'models' && <WhichModel />}
    {at === 'mcp' && <Mcp />}
    {at === 'meetings' && <Meetings onOpenAgent={agent} />}
    {at === 'dictation' && <Dictation />}
    {at === 'voice' && <Voice />}
    {at === 'spoken' && <Spoken />}
    {at === 'mail' && <Mail />}
    {at === 'studio' && <StudioSettings />}
    {at === 'bots' && <Bots onClose={onClose} />}
    {(at === 'phone' || at === 'machines') && <Phone tab={at} focus={section === 'machines' ? 'machines' : null} />}
    {at === 'remote' && <RemoteAccess />}
    {at === 'sharing' && <Sharing />}
    {at === 'notifications' && <Notifications />}
    {at === 'account' && <Account />}
    {at === 'backup' && <BackUp />}
    {at === 'about' && <About />}
    {at === 'cloud' && <CloudKeys focus="cloud" bare />}
    {at === 'cloud' && cloudOnly && <AiProviders local />}
    </AdvancedFrame>
    </ErrorBoundary>
    </SettingsAt.Provider>
  )

  const strip = tabs && (
    <div className={`seg st-tabs${tabs.length > 3 ? ' four' : ''}`} role="tablist" aria-label={t(cur.label)}>
      {tabs.map((x) => <button key={x.id} type="button" role="tab" data-tab={x.id} aria-selected={at === x.id} className={at === x.id ? 'on' : ''} onClick={() => go(x.id)}>{t(x.label)}</button>)}
    </div>
  )
  const beta = (s) => s.beta && <span className="st-chip beta">{t('Beta')}</span>

  if (phone) {
    return (
      <div className="modal-backdrop settings-backdrop phone">
        <div className="modal settings phone" role="dialog" aria-label={t('Settings')} ref={sheet}>
          <header className="st-bar">
            {showList ? <span /> : <button type="button" className="st-back" onClick={() => setList(true)} aria-label={t('Back to Settings')}><Icon name="back" size={18} /><span>{t('Settings')}</span></button>}
            <h3>{showList ? t('Settings') : t(cur.label)}</h3>
            <button type="button" className="win-btn st-close" onClick={onClose} aria-label={t('Close settings')}><Icon name="x" size={18} /></button>
          </header>
          {showList ? (
            <nav className="st-scroll st-list" aria-label={t('Settings sections')}>
              <ul className="m-more-list">
                {sections.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="m-more-row st-list-row" data-id={s.id} onClick={() => open(s)}>
                      <span className="m-more-ico"><Icon name={s.icon} size={17} /></span>
                      <span className="m-more-text"><b>{t(s.label)}{beta(s)}</b>{s.hint && <span>{t(s.hint)}</span>}</span>
                      <Icon name="chevron" size={13} className="muted" />
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <div className="st-scroll" key={at}>
              {cur.hint && !strip && <p className="muted small st-lede">{t(cur.hint)}</p>}
              {strip}
              {body}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal settings" data-area="settings" role="dialog" aria-label={t('Settings')}>
        <nav className="st-nav" aria-label={t('Settings sections')}>
          <div className="st-nav-title">{t('Settings')}</div>
          {sections.map((s) => (
            <button key={s.id} type="button" className={`st-nav-item ${cur === s ? 'on' : ''}${s.id === 'features' ? ' st-nav-features' : ''}`} aria-current={cur === s ? 'page' : undefined} onClick={() => open(s)}>
              <Icon name={s.icon} size={15} /><span>{t(s.label)}</span>{beta(s)}
            </button>
          ))}
        </nav>
        <section className="st-body">
          <header className="st-head">
            <div>
              <div className="st-title"><h3>{t(cur.label)}</h3>{beta(cur)}</div>
              {strip || <p className="muted small">{t(cur.hint)}</p>}
            </div>
            <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close settings')}><Icon name="x" size={14} /></button>
          </header>
          <div className="st-scroll">
            {body}
          </div>
        </section>
      </div>
    </div>
  )
}
