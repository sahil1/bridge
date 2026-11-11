// Display data for Settings › Providers. The server (server/providers.js) owns the real catalog
// (env vars, key links, which agents use what) and sends it with each provider's status; this
// file only holds how things are grouped and labeled in the UI.
import { t, tx } from '../../i18n/index.js'

export const GROUPS = [
  { id: 'labs', name: tx('Model labs') },
  { id: 'clouds', name: tx('Clouds') },
  { id: 'hosted', name: tx('Hosted open models') },
  { id: 'local', name: tx('Run locally') },
  { id: 'speech', name: tx('Speech to text (meeting notes)') },
]

export const SOURCE_LABEL = {
  bridge: tx('Saved in Bridge AI'),
  environment: tx('From environment'),
  local: tx('Running locally'),
  cloud: tx('Cloud login found'),
}

export const METHOD_LABEL = {
  subscription: tx('Subscription'),
  'api key': tx('API key'),
  cloud: tx('Cloud'),
}

// Agent names when the server's list isn't loaded yet.
export const AGENT_LABEL = {
  claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', grok: 'Grok', cursor: 'Cursor Agent',
  copilot: 'Copilot CLI', opencode: 'OpenCode', amp: 'Amp', qwen: 'Qwen Code', aider: 'Aider', goose: 'Goose', crush: 'Crush',
}

// Status chip text and tone for a provider.
export function providerChip(p) {
  if (p.status === 'rejected') return { tone: 'warn', text: t('Key turned down'), sub: p.message ? t('{message}. Check the key and save it again.', { message: p.message.slice(0, 80) }) : t('Check the key and save it again.') }
  if (p.status === 'connected') {
    if (p.source === 'local') return { tone: 'local', text: t('Local'), sub: p.models?.length ? (p.models.length === 1 ? t('{n} model', { n: 1 }) : t('{n} models', { n: p.models.length })) : t('Running') }
    return { tone: 'good', text: t('Connected'), sub: SOURCE_LABEL[p.source] && t(SOURCE_LABEL[p.source]) }
  }
  if (p.status === 'incomplete') return { tone: 'warn', text: t('Incomplete'), sub: t('Missing a setting') }
  return { tone: 'off', text: p.local ? t('Not running') : t('Not set') }
}

// Sign-in chip for an agent from /api/subscriptions.
export function agentChip(s) {
  if (s.signedIn === true) return { tone: 'good', text: [METHOD_LABEL[s.method] ? t(METHOD_LABEL[s.method]) : t('Signed in'), s.account].filter(Boolean).join(' · ') }
  if (s.signedIn === false) return { tone: 'off', text: t('Not signed in') }
  return { tone: 'unknown', text: t('Unknown') }
}
