import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useMedia } from './layout.jsx'
import Appearance from './Appearance.jsx'
import General from './settings/General.jsx'
import Agents from './settings/Agents.jsx'
import Providers from './settings/Providers.jsx'
import Mcp from './settings/Mcp.jsx'
import ConfigFile from './settings/ConfigFile.jsx'
import Phone from './settings/Phone.jsx'
import About from './settings/About.jsx'
import Meetings from './settings/Meetings.jsx'
import Voice from './settings/Voice.jsx'
import CloudKeys from './settings/CloudKeys.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { SettingsAt } from './settings/where.js'
import { cloudOnly } from '../api.js'
import { t, tx } from '../i18n/index.js'

// One Settings window, Slack style: sections down the left, one scrolling panel on the right.
// On a phone it's a phone's settings: the list of sections, each opening full width under a bar
// with ‹ Settings (back to the list), its name, and the one close.
export const SECTIONS = [
  { id: 'general', label: tx('General'), icon: 'home', hint: tx('Name, default agent and model, location') },
  { id: 'agents', label: tx('Agents'), icon: 'bot', hint: tx('Installed agents and sign-in') },
  { id: 'providers', label: tx('Model Providers'), icon: 'layers', hint: tx('API keys, clouds, local models, cloud agents') },
  { id: 'voice', label: tx('Voice'), icon: 'mic', hint: tx('Speech to text on this computer, and dictation') },
  { id: 'meetings', label: tx('Meetings'), icon: 'mic', hint: tx('How meetings are transcribed and summarized') },
  { id: 'mcp', label: tx('MCP Servers'), icon: 'tool', hint: tx('Tools your agents can use') },
  { id: 'phone', label: tx('Devices'), icon: 'phone', hint: tx('Your phone and your other computers, through your relay or Tailscale; what to notify you about') },
  { id: 'appearance', label: tx('Appearance'), icon: 'palette', hint: tx('Theme, text size, density') },
  { id: 'config', label: tx('Config File'), icon: 'braces', hint: tx('Every setting, as JSON') },
  { id: 'about', label: tx('About & Updates'), icon: 'info', hint: tx('Version, updates, beta features, the tour, reporting a problem') },
]

// The phone's Cloud agents (cloudOnly): only what there is on the phone alone.
const PHONE = [
  { id: 'cloud', label: tx('Cloud Agents'), icon: 'cloud', hint: tx('Your keys for Cursor, GitHub Copilot, Jules and Claude') },
  { id: 'appearance', label: tx('Appearance'), icon: 'palette', hint: tx('Theme, text size, density') },
]

// section: where Settings opens. "all" is Settings itself: the list on a phone, General on a wider
// screen. A section's id opens it (on a phone with ‹ Settings back to the list), and so do these:
// "accounts" and "cloud" open Model providers at its Accounts or Cloud agents list; "machines"
// opens Devices at your devices (they were two sections, and linking machines needs the
// relay set up on the phone one); "permissions" opens General at its Permissions; "topbar" opens
// Appearance at In the Top Bar (from the Status menu).
const LEADS = { accounts: 'providers', cloud: 'providers', machines: 'phone', permissions: 'general', topbar: 'appearance' }
const sectionFor = (section, sections) => {
  const to = cloudOnly ? (section === 'all' ? null : section === 'appearance' ? 'appearance' : 'cloud') : LEADS[section] || section
  return sections.some((s) => s.id === to) ? to : null
}

export default function Settings({ section = 'all', onClose, onOpenAgent }) {
  const sections = cloudOnly ? PHONE : SECTIONS
  const phone = useMedia('(max-width: 760px)')
  const to = sectionFor(section, sections)
  const [at, setAt] = useState(to || sections[0].id)
  const [list, setList] = useState(!to) // on a phone: the list of sections, rather than one of them
  const go = (id) => { setAt(id); setList(false) }
  useEffect(() => { if (to) go(to) }, [to]) // eslint-disable-line react-hooks/exhaustive-deps
  // A link to a section from inside Settings (Meetings' Model Providers), even to the one it opened at.
  useEffect(() => {
    const on = (e) => { const s = sectionFor(e.detail?.section, sections); if (s) go(s) }
    window.addEventListener('bridge-open-settings', on)
    return () => window.removeEventListener('bridge-open-settings', on)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('textarea, input')) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const cur = sections.find((s) => s.id === at)
  const showList = phone && list
  // From the list to a section and back, the focus goes along: to ‹ Settings, then to the row left.
  const sheet = useRef(null)
  const was = useRef(showList)
  useEffect(() => {
    if (was.current === showList) return
    was.current = showList
    sheet.current?.querySelector(showList ? `.st-list-row[data-id="${at}"]` : '.st-back')?.focus()
  }, [showList]) // eslint-disable-line react-hooks/exhaustive-deps

  const body = (
    <SettingsAt.Provider value={at}>
    <ErrorBoundary key={at} name={t(cur.label)} resetKey={at}>
    {at === 'general' && <General onGo={go} focus={section === 'permissions' ? 'permissions' : null} onOpenAgent={(id) => { onOpenAgent?.(id); onClose() }} />}
    {at === 'agents' && <Agents onOpenAgent={(id) => { onOpenAgent?.(id); onClose() }} />}
    {at === 'providers' && <Providers focus={section === 'accounts' || section === 'cloud' ? section : null} onOpenAgent={(id) => { onOpenAgent?.(id); onClose() }} />}
    {at === 'voice' && <Voice />}
    {at === 'meetings' && <Meetings />}
    {at === 'mcp' && <Mcp />}
    {at === 'appearance' && <Appearance focus={section === 'topbar' ? 'topbar' : null} />}
    {at === 'config' && <ConfigFile />}
    {at === 'phone' && <Phone focus={section === 'machines' ? 'machines' : null} />}
    {at === 'about' && <About />}
    {at === 'cloud' && <CloudKeys focus="cloud" bare />}
    </ErrorBoundary>
    </SettingsAt.Provider>
  )

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
                    <button type="button" className="m-more-row st-list-row" data-id={s.id} onClick={() => go(s.id)}>
                      <span className="m-more-ico"><Icon name={s.icon} size={17} /></span>
                      <span className="m-more-text"><b>{t(s.label)}</b>{s.hint && <span>{t(s.hint)}</span>}</span>
                      <Icon name="chevron" size={13} className="muted" />
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <div className="st-scroll" key={at}>
              {cur.hint && <p className="muted small st-lede">{t(cur.hint)}</p>}
              {body}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal settings" role="dialog" aria-label={t('Settings')}>
        <nav className="st-nav" aria-label={t('Settings sections')}>
          <div className="st-nav-title">{t('Settings')}</div>
          {sections.map((s) => (
            <button key={s.id} type="button" className={`st-nav-item ${at === s.id ? 'on' : ''}`} aria-current={at === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
              <Icon name={s.icon} size={15} /><span>{t(s.label)}</span>
            </button>
          ))}
        </nav>
        <section className="st-body">
          <header className="st-head">
            <div>
              <h3>{t(cur.label)}</h3>
              <p className="muted small">{t(cur.hint)}</p>
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
