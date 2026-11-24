// Who receives what you send when Bridge AI passes it on to an AI provider, by the company that gets
// it: for the OK a phone is asked for first (server/aiconsent.js, src/aiconsent.js). One OK per
// company, kept on the computer. A model on this computer (Ollama, LM Studio, the local model built
// in) isn't a provider: what it reads stays on this computer, so nothing is asked.
//
// name: the company, as it's said to you. setUp: an agent that sends to whichever model provider
// it's set up with (OpenCode, Aider, Goose, Crush), so the sheet says so too.
export const PROVIDERS = {
  anthropic: { name: 'Anthropic' },
  openai: { name: 'OpenAI' },
  google: { name: 'Google' },
  xai: { name: 'xAI' },
  meta: { name: 'Meta' },
  mistral: { name: 'Mistral AI' },
  groq: { name: 'Groq' },
  deepseek: { name: 'DeepSeek' },
  perplexity: { name: 'Perplexity' },
  openrouter: { name: 'OpenRouter' },
  moonshot: { name: 'Moonshot AI' },
  together: { name: 'Together AI' },
  fireworks: { name: 'Fireworks AI' },
  cerebras: { name: 'Cerebras' },
  cohere: { name: 'Cohere' },
  zai: { name: 'Z.ai' },
  huggingface: { name: 'Hugging Face' },
  microsoft: { name: 'Microsoft' },
  aws: { name: 'Amazon Web Services' },
  cursor: { name: 'Cursor' },
  github: { name: 'GitHub' },
  sourcegraph: { name: 'Sourcegraph' },
  alibaba: { name: 'Alibaba Cloud' },
  opencode: { name: 'OpenCode', setUp: true },
  aider: { name: 'Aider', setUp: true },
  goose: { name: 'Goose', setUp: true },
  crush: { name: 'Crush', setUp: true },
  // Speech services a meeting or a file can be turned into text with (Settings › Meetings & Voice).
  assemblyai: { name: 'AssemblyAI' },
  deepgram: { name: 'Deepgram' },
  elevenlabs: { name: 'ElevenLabs' },
  // Another OpenAI-style speech service, at the address given in Settings › Model Providers.
  speechservice: { name: 'Your speech service', setUp: true },
}

// Each agent by its kind (server/agents.js): who gets what it's sent, and what it's called.
const AGENTS = {
  claude: ['anthropic', 'Claude Code'],
  codex: ['openai', 'Codex'],
  gemini: ['google', 'Gemini CLI'],
  agy: ['google', 'Antigravity CLI'],
  grok: ['xai', 'Grok'],
  cursor: ['cursor', 'Cursor Agent'],
  copilot: ['github', 'GitHub Copilot CLI'],
  amp: ['sourcegraph', 'Amp'],
  qwen: ['alibaba', 'Qwen Code'],
  muse: ['meta', 'Muse Code'],
  opencode: ['opencode', 'OpenCode'],
  aider: ['aider', 'Aider'],
  goose: ['goose', 'Goose'],
  crush: ['crush', 'Crush'],
}
// Each route of a model's id ("<route>:<model>", server/chatmodels.js) that leaves this computer,
// and what it's called there. cli:<kind> is an agent's one-shot mode, as the agent.
const ROUTES = {
  anthropic: ['anthropic', 'the Anthropic API'],
  openai: ['openai', 'the OpenAI API'],
  xai: ['xai', 'the xAI API'],
  meta: ['meta', "Meta's Model API"],
  gemini: ['google', 'the Gemini API'],
  vertex: ['google', 'Google Vertex AI'],
  perplexity: ['perplexity', 'the Perplexity API'],
  openrouter: ['openrouter', 'OpenRouter'],
  deepseek: ['deepseek', 'the DeepSeek API'],
  mistral: ['mistral', 'the Mistral API'],
  groq: ['groq', 'the Groq API'],
  azure: ['microsoft', 'Azure OpenAI'],
  bedrock: ['aws', 'AWS Bedrock'],
  moonshot: ['moonshot', 'the Moonshot AI API'],
  together: ['together', 'the Together AI API'],
  fireworks: ['fireworks', 'the Fireworks AI API'],
  cerebras: ['cerebras', 'the Cerebras API'],
  cohere: ['cohere', 'the Cohere API'],
  zai: ['zai', 'the Z.ai API'],
  huggingface: ['huggingface', 'Hugging Face'],
}
// The routes that stay on this computer.
export const LOCAL_ROUTES = ['ollama', 'lmstudio', 'bridge']
// Speech services (server/speech.js engines) that send the sound or the file to their company.
const SPEECH = {
  openai: ['openai', 'OpenAI speech to text'],
  groq: ['groq', 'Groq speech to text'],
  mistral: ['mistral', 'Mistral speech to text'],
  together: ['together', 'Together AI speech to text'],
  gemini: ['google', 'Gemini speech to text'],
  google: ['google', 'Google speech to text'],
  assemblyai: ['assemblyai', 'AssemblyAI'],
  deepgram: ['deepgram', 'Deepgram'],
  elevenlabs: ['elevenlabs', 'ElevenLabs'],
  custom: ['speechservice', 'another OpenAI-style speech service'],
}

// Cloud agents (shared/cloud), by their provider's id there.
const CLOUD = {
  cursor: ['cursor', 'Cursor cloud agents'],
  copilot: ['github', 'the GitHub Copilot coding agent'],
  jules: ['google', 'Jules'],
  claude: ['anthropic', 'Claude Managed Agents'],
}

const make = (pair) => (pair && PROVIDERS[pair[0]] ? { id: pair[0], name: PROVIDERS[pair[0]].name, via: pair[1], ...(PROVIDERS[pair[0]].setUp ? { setUp: true } : {}) } : null)

// { id, name, via, setUp? } for an agent of this kind, or null for one that sends nothing on (a
// shell). An agent Bridge AI doesn't know by name is asked about as itself.
export function ofAgent(kind, label = null) {
  const k = String(kind || '')
  if (!k || k === 'shell') return null
  if (AGENTS[k]) return make(AGENTS[k])
  const name = String(label || k).slice(0, 60)
  return { id: `agent-${k.replace(/[^\w-]/g, '').slice(0, 40)}`, name, via: name, setUp: true }
}
// ...for a model by its id, or null for one on this computer (or no model).
export function ofModel(id) {
  const s = String(id || '')
  const at = s.indexOf(':')
  if (at < 1) return null
  const route = s.slice(0, at)
  if (LOCAL_ROUTES.includes(route)) return null
  if (route === 'cli') return ofAgent(s.slice(at + 1))
  return make(ROUTES[route]) || { id: `route-${route.replace(/[^\w-]/g, '').slice(0, 40)}`, name: route, via: route }
}
// ...for a speech service by its engine's id, or null for one on this computer.
export const ofSpeech = (engine) => make(SPEECH[String(engine || '')])
// ...for a cloud agent's provider (cursor, copilot, jules, claude).
export const ofCloud = (id) => make(CLOUD[String(id || '')])
// A provider's name by its id (one kept before may no longer be in the list: its id, then).
export const nameOf = (id) => PROVIDERS[id]?.name || String(id || '').replace(/^(agent|route)-/, '')
