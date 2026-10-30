// Display data for Settings › Providers. The server (server/providers.js) owns the real catalog
// (env vars, key links, which agents use what) and sends it with each provider's status; this
// file only holds how things are grouped and labeled in the UI.

export const GROUPS = [
  { id: 'labs', name: 'Model labs' },
  { id: 'clouds', name: 'Clouds' },
  { id: 'hosted', name: 'Hosted open models' },
  { id: 'local', name: 'Run locally' },
  { id: 'speech', name: 'Speech to text (meeting notes)' },
]

export const SOURCE_LABEL = {
  bridge: 'Saved in Bridge AI',
  environment: 'From environment',
  local: 'Running locally',
  cloud: 'Cloud login found',
}

export const METHOD_LABEL = {
  subscription: 'Subscription',
  'api key': 'API key',
  cloud: 'Cloud',
}

// Agent names when the server's list isn't loaded yet.
export const AGENT_LABEL = {
  claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', grok: 'Grok', cursor: 'Cursor Agent',
  copilot: 'Copilot CLI', opencode: 'OpenCode', amp: 'Amp', qwen: 'Qwen Code', aider: 'Aider', goose: 'Goose', crush: 'Crush',
}

// Status chip text and tone for a provider.
export function providerChip(p) {
  if (p.status === 'rejected') return { tone: 'warn', text: 'Key turned down', sub: p.message ? `${p.message.slice(0, 80)}. Check the key and save it again.` : 'Check the key and save it again.' }
  if (p.status === 'connected') {
    if (p.source === 'local') return { tone: 'local', text: 'Local', sub: p.models?.length ? `${p.models.length} model${p.models.length === 1 ? '' : 's'}` : 'Running' }
    return { tone: 'good', text: 'Connected', sub: SOURCE_LABEL[p.source] }
  }
  if (p.status === 'incomplete') return { tone: 'warn', text: 'Incomplete', sub: 'Missing a setting' }
  return { tone: 'off', text: p.local ? 'Not running' : 'Not set' }
}

// Sign-in chip for an agent from /api/subscriptions.
export function agentChip(s) {
  if (s.signedIn === true) return { tone: 'good', text: [METHOD_LABEL[s.method] || 'Signed in', s.account].filter(Boolean).join(' · ') }
  if (s.signedIn === false) return { tone: 'off', text: 'Not signed in' }
  return { tone: 'unknown', text: 'Unknown' }
}
