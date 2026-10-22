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
import CloudKeys from './settings/CloudKeys.jsx'
import { cloudOnly } from '../api.js'

// One Settings window, Slack style: sections down the left, one scrolling panel on the right.
// On a phone the sections become a row of chips above the panel.
export const SECTIONS = [
  { id: 'general', label: 'General', icon: 'home', hint: 'Name, default agent and model, location' },
  { id: 'agents', label: 'Agents', icon: 'bot', hint: 'Installed agents and sign-in' },
  { id: 'providers', label: 'Model providers', icon: 'layers', hint: 'API keys, clouds, local models, cloud agents' },
  { id: 'mcp', label: 'MCP servers', icon: 'tool', hint: 'Tools your agents can use' },
  { id: 'phone', label: 'Phone & notifications', icon: 'phone', hint: 'Open Bridge AI on your phone; what to notify you about' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', hint: 'Theme, text size, density' },
  { id: 'config', label: 'Config file', icon: 'braces', hint: 'Every setting, as JSON' },
  { id: 'about', label: 'About & updates', icon: 'info', hint: 'Version, updates, the tour, reporting a problem' },
]

// The phone's Cloud agents (cloudOnly): only what there is on the phone alone.
const PHONE = [
  { id: 'cloud', label: 'Cloud agents', icon: 'cloud', hint: 'Your keys for Cursor, GitHub Copilot, Jules and Claude' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', hint: 'Theme, text size, density' },
]

// "accounts" and "cloud" open Model providers at its Accounts or Cloud agents list.
export default function Settings({ section = 'general', onClose, onOpenAgent }) {
  const sections = cloudOnly ? PHONE : SECTIONS
  const to = cloudOnly ? (section === 'appearance' ? 'appearance' : 'cloud') : section === 'accounts' || section === 'cloud' ? 'providers' : section
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
      <div className="modal settings" role="dialog" aria-label="Settings">
        <nav className="st-nav" aria-label="Settings sections">
          <div className="st-nav-title">Settings</div>
          {sections.map((s) => (
            <button key={s.id} type="button" className={`st-nav-item ${at === s.id ? 'on' : ''}`} aria-current={at === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
              <Icon name={s.icon} size={15} /><span>{s.label}</span>
            </button>
          ))}
        </nav>
        <section className="st-body">
          <header className="st-head">
            <div>
              <h3>{cur.label}</h3>
              <p className="muted small">{cur.hint}</p>
            </div>
            <button type="button" className="win-btn" onClick={onClose} aria-label="Close settings"><Icon name="x" size={14} /></button>
          </header>
          <div className="st-scroll">
            {at === 'general' && <General onGo={go} />}
            {at === 'agents' && <Agents onOpenAgent={(id) => { onOpenAgent?.(id); onClose() }} />}
            {at === 'providers' && <Providers focus={section === 'accounts' || section === 'cloud' ? section : null} onOpenAgent={(id) => { onOpenAgent?.(id); onClose() }} />}
            {at === 'mcp' && <Mcp />}
            {at === 'appearance' && <Appearance />}
            {at === 'config' && <ConfigFile />}
            {at === 'phone' && <Phone />}
            {at === 'about' && <About />}
            {at === 'cloud' && <CloudKeys focus="cloud" bare />}
          </div>
        </section>
      </div>
    </div>
  )
}
