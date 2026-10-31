import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
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
// On a phone the sections become a row of chips above the panel.
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
  { id: 'about', label: tx('About & Updates'), icon: 'info', hint: tx('Version, updates, the tour, reporting a problem') },
]

// The phone's Cloud agents (cloudOnly): only what there is on the phone alone.
const PHONE = [
  { id: 'cloud', label: tx('Cloud Agents'), icon: 'cloud', hint: tx('Your keys for Cursor, GitHub Copilot, Jules and Claude') },
  { id: 'appearance', label: tx('Appearance'), icon: 'palette', hint: tx('Theme, text size, density') },
]

// "accounts" and "cloud" open Model providers at its Accounts or Cloud agents list; "machines"
// opens Devices at your devices (they were two sections, and linking machines needs the
// relay set up on the phone one); "permissions" opens General at its Permissions.
export default function Settings({ section = 'general', onClose, onOpenAgent }) {
  const sections = cloudOnly ? PHONE : SECTIONS
  const to = cloudOnly ? (section === 'appearance' ? 'appearance' : 'cloud') : section === 'accounts' || section === 'cloud' ? 'providers' : section === 'machines' ? 'phone' : section === 'permissions' ? 'general' : section
  const [at, setAt] = useState(sections.some((s) => s.id === to) ? to : sections[0].id)
  useEffect(() => { if (sections.some((s) => s.id === to)) setAt(to) }, [to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest?.('textarea, input')) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const cur = sections.find((s) => s.id === at)
  const go = (id) => setAt(id)

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
            <SettingsAt.Provider value={at}>
            <ErrorBoundary key={at} name={t(cur.label)} resetKey={at}>
            {at === 'general' && <General onGo={go} focus={section === 'permissions' ? 'permissions' : null} onOpenAgent={(id) => { onOpenAgent?.(id); onClose() }} />}
            {at === 'agents' && <Agents onOpenAgent={(id) => { onOpenAgent?.(id); onClose() }} />}
            {at === 'providers' && <Providers focus={section === 'accounts' || section === 'cloud' ? section : null} onOpenAgent={(id) => { onOpenAgent?.(id); onClose() }} />}
            {at === 'voice' && <Voice />}
            {at === 'meetings' && <Meetings />}
            {at === 'mcp' && <Mcp />}
            {at === 'appearance' && <Appearance />}
            {at === 'config' && <ConfigFile />}
            {at === 'phone' && <Phone focus={section === 'machines' ? 'machines' : null} />}
            {at === 'about' && <About />}
            {at === 'cloud' && <CloudKeys focus="cloud" bare />}
            </ErrorBoundary>
            </SettingsAt.Provider>
          </div>
        </section>
      </div>
    </div>
  )
}
