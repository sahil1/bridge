// Small pieces shared by the cloud agent view, the sidebar and the new agent dialog.
import { AgentIcon } from './settings/ProviderIcon.jsx'
import { t, tx } from '../i18n/index.js'
import './cloud.css'

const MARK = { cursor: 'cursor', copilot: 'copilot', claude: 'claude' }
// The provider's logo (Jules has none in the icon set: a lettered tile).
export function CloudMark({ provider, label, size = 16 }) {
  if (MARK[provider]) return <AgentIcon kind={MARK[provider]} size={size} name={label} />
  return <span className="cloud-mark" style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }} aria-hidden="true">{(label || provider || '?').slice(0, 1)}</span>
}

const STATE_LABEL = { blocked: tx('Needs you'), done: tx('Done'), working: tx('Working'), idle: tx('Idle') }
export const stateLabel = (a) => (a.cloud?.failed ? t('Failed') : STATE_LABEL[a.status] ? t(STATE_LABEL[a.status]) : t('Unknown'))

// The pull request, or else the provider's own page for it.
export const linkOf = (c) => (c?.prUrl ? { href: c.prUrl, label: t('Open pull request') } : c?.url ? { href: c.url, label: c.urlLabel || t('Open in {name}', { name: c.label }) } : null)

// "owner/repo › branch", for the sidebar and headers.
export const whereOf = (c) => [c?.repo, c?.branch && c.branch !== c.repo ? c.branch : null].filter(Boolean).join(' › ')
