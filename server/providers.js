// Model providers (API keys, cloud accounts, local model servers) and agent sign-ins.
//
// Keys you save here live in <data>/secrets.json (mode 0600), keyed by environment variable
// name. Bridge AI hands them to the agents it starts itself (built-in runtime) through
// providerEnv(). Nothing here ever sends a secret back to the browser: the API reports
// { set, last4 } per field at most, and the sign-in checks look at whether files and fields
// exist, never at their values.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { DATA, HOME, IS_MAC, IS_WIN, dataFile, ensureDir, writeFileAtomic } from './paths.js'
import { AGENTS, installed as installedAgents } from './agents.js'
import { hiddenAgent, hiddenProvider } from './labs.js'

// ---------- Catalog ----------
// fields: env vars the provider uses. type 'secret' (masked), 'text' (plain setting) or 'flag'
//   (stored as "1" when on). optional: not needed for "connected".
// alsoEnv: other env names that count as connected when set in the server's environment.
// aliases: extra env names some agents read, filled from a saved field when not already set.
// cloud(): cloud credentials present on this device (AWS files, gcloud ADC).
// local: a model server on this device, probed for its model list.
// agents: which agent CLIs can use it (best effort, from each CLI's docs).
// test(values): a cheap authenticated request that lists models or checks the key.
const MULTI = ['opencode', 'aider', 'crush', 'goose']
const bearer = (k) => ({ Authorization: `Bearer ${k}` })

export const PROVIDERS = [
  {
    id: 'anthropic', name: 'Anthropic', group: 'labs', description: 'Claude models through the Anthropic API.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    fields: [{ env: 'ANTHROPIC_API_KEY', label: 'API key', type: 'secret', placeholder: 'sk-ant-...' }],
    agents: ['claude', ...MULTI],
    test: (v) => ({ url: 'https://api.anthropic.com/v1/models?limit=1', headers: { 'x-api-key': v.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } }),
  },
  {
    id: 'openai', name: 'OpenAI', group: 'labs', description: 'GPT and o-series models through the OpenAI API.',
    keyUrl: 'https://platform.openai.com/api-keys',
    fields: [
      { env: 'OPENAI_API_KEY', label: 'API key', type: 'secret', placeholder: 'sk-...' },
      { env: 'OPENAI_BASE_URL', label: 'Base URL', type: 'text', optional: true, placeholder: 'Leave empty for api.openai.com' },
    ],
    agents: ['codex', 'qwen', ...MULTI],
    test: (v) => ({ url: `${(v.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`, headers: bearer(v.OPENAI_API_KEY) }),
  },
  {
    id: 'gemini', name: 'Google Gemini', group: 'labs', description: 'Gemini models with an AI Studio key.',
    keyUrl: 'https://aistudio.google.com/apikey',
    fields: [{ env: 'GEMINI_API_KEY', label: 'API key', type: 'secret', placeholder: 'AIza...' }],
    alsoEnv: ['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    aliases: { GOOGLE_GENERATIVE_AI_API_KEY: 'GEMINI_API_KEY' },
    agents: ['gemini', ...MULTI],
    test: (v) => ({ url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', headers: { 'x-goog-api-key': v.GEMINI_API_KEY } }),
  },
  {
    id: 'xai', name: 'xAI Grok', group: 'labs', description: 'Grok models through the xAI API.',
    keyUrl: 'https://console.x.ai',
    fields: [{ env: 'XAI_API_KEY', label: 'API key', type: 'secret', placeholder: 'xai-...' }],
    agents: ['grok', ...MULTI],
    test: (v) => ({ url: 'https://api.x.ai/v1/models', headers: bearer(v.XAI_API_KEY) }),
  },
  {
    id: 'mistral', name: 'Mistral AI', group: 'labs', description: 'Mistral, Codestral and Devstral models.',
    keyUrl: 'https://console.mistral.ai/api-keys',
    fields: [{ env: 'MISTRAL_API_KEY', label: 'API key', type: 'secret' }],
    agents: ['opencode', 'aider', 'goose'],
    test: (v) => ({ url: 'https://api.mistral.ai/v1/models', headers: bearer(v.MISTRAL_API_KEY) }),
  },
  {
    id: 'deepseek', name: 'DeepSeek', group: 'labs', description: 'DeepSeek chat and reasoning models.',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    fields: [{ env: 'DEEPSEEK_API_KEY', label: 'API key', type: 'secret', placeholder: 'sk-...' }],
    agents: ['opencode', 'aider', 'crush'],
    test: (v) => ({ url: 'https://api.deepseek.com/models', headers: bearer(v.DEEPSEEK_API_KEY) }),
  },
  {
    id: 'cohere', name: 'Cohere', group: 'labs', description: 'Command models for chat and tool use.',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    fields: [{ env: 'COHERE_API_KEY', label: 'API key', type: 'secret' }],
    agents: ['opencode', 'aider'],
    test: (v) => ({ url: 'https://api.cohere.com/v1/models?page_size=1', headers: bearer(v.COHERE_API_KEY) }),
  },
  {
    id: 'meta', name: 'Meta (Muse)', group: 'labs', description: 'Muse Spark models from Meta Superintelligence Labs, 1M-token context.',
    keyUrl: 'https://dev.meta.ai',
    fields: [{ env: 'MODEL_API_KEY', label: 'Model API key', type: 'secret' }],
    agents: ['opencode', 'codex', 'muse'],
    test: (v) => ({ url: 'https://api.meta.ai/v1/models', headers: bearer(v.MODEL_API_KEY) }),
  },
  {
    id: 'perplexity', name: 'Perplexity', group: 'labs', description: 'Sonar models with built-in web search.',
    keyUrl: 'https://www.perplexity.ai/account/api/keys',
    fields: [{ env: 'PERPLEXITY_API_KEY', label: 'API key', type: 'secret', placeholder: 'pplx-...' }],
    agents: ['opencode', 'aider'],
    test: null,
  },
  {
    id: 'moonshot', name: 'Moonshot AI (Kimi)', group: 'labs', description: 'Kimi K2 models from Moonshot.',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    fields: [{ env: 'MOONSHOT_API_KEY', label: 'API key', type: 'secret', placeholder: 'sk-...' }],
    agents: ['opencode', 'crush'],
    test: (v) => ({ url: 'https://api.moonshot.ai/v1/models', headers: bearer(v.MOONSHOT_API_KEY) }),
  },
  {
    id: 'zai', name: 'Z.ai (GLM)', group: 'labs', description: 'GLM coding models from Zhipu / Z.ai.',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    fields: [
      { env: 'ZAI_API_KEY', label: 'API key', type: 'secret' },
      { env: 'ZAI_BASE_URL', label: 'Base URL', type: 'text', optional: true, placeholder: 'Empty for the API; https://api.z.ai/api/coding/paas/v4 for a Coding Plan key' },
    ],
    alsoEnv: ['ZHIPU_API_KEY'],
    aliases: { ZHIPU_API_KEY: 'ZAI_API_KEY' },
    agents: ['opencode', 'crush'],
    test: null,
  },
  {
    id: 'azure', name: 'Azure OpenAI', group: 'clouds', description: 'OpenAI models deployed in your Azure subscription.',
    keyUrl: 'https://ai.azure.com',
    fields: [
      { env: 'AZURE_OPENAI_API_KEY', label: 'API key', type: 'secret' },
      { env: 'AZURE_OPENAI_ENDPOINT', label: 'Endpoint', type: 'text', placeholder: 'https://<resource>.openai.azure.com' },
      { env: 'OPENAI_API_VERSION', label: 'API version', type: 'text', optional: true, placeholder: '2024-10-21' },
      { env: 'AZURE_OPENAI_DEPLOYMENTS', label: 'Deployments to chat with', type: 'text', optional: true, placeholder: 'gpt-5, gpt-5-mini (their names in Azure)' },
    ],
    aliases: { AZURE_API_KEY: 'AZURE_OPENAI_API_KEY', AZURE_API_BASE: 'AZURE_OPENAI_ENDPOINT' },
    agents: ['codex', ...MULTI],
    test: (v) => v.AZURE_OPENAI_ENDPOINT && ({ url: `${v.AZURE_OPENAI_ENDPOINT.replace(/\/$/, '')}/openai/models?api-version=${encodeURIComponent(v.OPENAI_API_VERSION || '2024-10-21')}`, headers: { 'api-key': v.AZURE_OPENAI_API_KEY } }),
  },
  {
    id: 'bedrock', name: 'AWS Bedrock', group: 'clouds', description: 'Claude and other models through your AWS account.',
    keyUrl: 'https://console.aws.amazon.com/bedrock/home#/api-keys',
    fields: [
      { env: 'AWS_REGION', label: 'Region', type: 'text', placeholder: 'us-east-1' },
      { env: 'AWS_PROFILE', label: 'AWS profile', type: 'text', optional: true, placeholder: 'default' },
      { env: 'AWS_BEARER_TOKEN_BEDROCK', label: 'Bedrock API key', type: 'secret', optional: true, placeholder: 'Optional, instead of a profile' },
      { env: 'CLAUDE_CODE_USE_BEDROCK', label: 'Make Claude Code use Bedrock', type: 'flag', optional: true },
    ],
    alsoEnv: ['AWS_ACCESS_KEY_ID', 'AWS_BEARER_TOKEN_BEDROCK'],
    cloud: () => exists(path.join(HOME, '.aws', 'credentials')) || exists(path.join(HOME, '.aws', 'config')),
    agents: ['claude', ...MULTI],
    test: null,
  },
  {
    id: 'vertex', name: 'Google Vertex AI', group: 'clouds', description: 'Gemini and Claude models in your Google Cloud project.',
    keyUrl: 'https://console.cloud.google.com/vertex-ai',
    fields: [
      { env: 'GOOGLE_CLOUD_PROJECT', label: 'Project ID', type: 'text', placeholder: 'my-project' },
      { env: 'GOOGLE_CLOUD_LOCATION', label: 'Location', type: 'text', placeholder: 'us-central1 or global' },
      { env: 'GOOGLE_APPLICATION_CREDENTIALS', label: 'Service account file', type: 'text', optional: true, placeholder: 'Leave empty to use your gcloud login' },
      { env: 'CLAUDE_CODE_USE_VERTEX', label: 'Make Claude Code use Vertex', type: 'flag', optional: true },
      { env: 'GOOGLE_GENAI_USE_VERTEXAI', label: 'Make Gemini CLI use Vertex', type: 'flag', optional: true },
    ],
    aliases: { ANTHROPIC_VERTEX_PROJECT_ID: 'GOOGLE_CLOUD_PROJECT', CLOUD_ML_REGION: 'GOOGLE_CLOUD_LOCATION', VERTEX_LOCATION: 'GOOGLE_CLOUD_LOCATION' },
    cloud: () => !!process.env.GOOGLE_APPLICATION_CREDENTIALS || exists(gcloudAdc()),
    agents: ['claude', 'gemini', ...MULTI],
    test: null,
  },
  {
    id: 'openrouter', name: 'OpenRouter', group: 'hosted', description: 'One key for hundreds of models from every lab.',
    keyUrl: 'https://openrouter.ai/settings/keys',
    fields: [{ env: 'OPENROUTER_API_KEY', label: 'API key', type: 'secret', placeholder: 'sk-or-...' }],
    agents: MULTI,
    test: (v) => ({ url: 'https://openrouter.ai/api/v1/key', headers: bearer(v.OPENROUTER_API_KEY) }),
  },
  {
    id: 'groq', name: 'Groq', group: 'hosted', description: 'Very fast inference for open models.',
    keyUrl: 'https://console.groq.com/keys',
    fields: [{ env: 'GROQ_API_KEY', label: 'API key', type: 'secret', placeholder: 'gsk_...' }],
    agents: MULTI,
    test: (v) => ({ url: 'https://api.groq.com/openai/v1/models', headers: bearer(v.GROQ_API_KEY) }),
  },
  {
    id: 'together', name: 'Together AI', group: 'hosted', description: 'Open models like Llama and Gemma, serverless.',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    fields: [{ env: 'TOGETHER_API_KEY', label: 'API key', type: 'secret' }],
    agents: ['opencode', 'aider'],
    test: (v) => ({ url: 'https://api.together.xyz/v1/models', headers: bearer(v.TOGETHER_API_KEY) }),
  },
  {
    id: 'fireworks', name: 'Fireworks AI', group: 'hosted', description: 'Fast hosted open models and fine-tunes.',
    keyUrl: 'https://fireworks.ai/account/api-keys',
    fields: [{ env: 'FIREWORKS_API_KEY', label: 'API key', type: 'secret', placeholder: 'fw_...' }],
    agents: ['opencode', 'aider'],
    test: (v) => ({ url: 'https://api.fireworks.ai/inference/v1/models', headers: bearer(v.FIREWORKS_API_KEY) }),
  },
  {
    id: 'cerebras', name: 'Cerebras', group: 'hosted', description: 'Wafer-scale inference for open models.',
    keyUrl: 'https://cloud.cerebras.ai',
    fields: [{ env: 'CEREBRAS_API_KEY', label: 'API key', type: 'secret', placeholder: 'csk-...' }],
    agents: ['opencode', 'aider', 'crush'],
    test: (v) => ({ url: 'https://api.cerebras.ai/v1/models', headers: bearer(v.CEREBRAS_API_KEY) }),
  },
  {
    id: 'huggingface', name: 'Hugging Face', group: 'hosted', description: 'Inference Providers for models on the Hub.',
    keyUrl: 'https://huggingface.co/settings/tokens',
    fields: [{ env: 'HF_TOKEN', label: 'Access token', type: 'secret', placeholder: 'hf_...' }],
    alsoEnv: ['HUGGINGFACE_API_KEY'],
    aliases: { HUGGINGFACE_API_KEY: 'HF_TOKEN' },
    agents: ['opencode', 'aider', 'crush'],
    test: (v) => ({ url: 'https://huggingface.co/api/whoami-v2', headers: bearer(v.HF_TOKEN) }),
  },
  {
    id: 'ollama', name: 'Ollama', group: 'local', description: 'Run open models on this computer.',
    keyUrl: 'https://ollama.com/download',
    fields: [{ env: 'OLLAMA_HOST', label: 'Server', type: 'text', optional: true, placeholder: 'http://127.0.0.1:11434' }],
    local: { url: (v) => `${normHost(v.OLLAMA_HOST || 'http://127.0.0.1:11434')}/api/tags`, models: (j) => (j.models || []).map((m) => m.name) },
    agents: ['codex', ...MULTI],
  },
  {
    id: 'lmstudio', name: 'LM Studio', group: 'local', description: 'Desktop app that serves local models.',
    keyUrl: 'https://lmstudio.ai/download',
    fields: [{ env: 'LM_STUDIO_BASE_URL', label: 'Server', type: 'text', optional: true, placeholder: 'http://127.0.0.1:1234/v1' }],
    local: { url: (v) => `${(v.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '')}/models`, models: (j) => (j.data || []).map((m) => m.id) },
    agents: ['codex', 'opencode', 'aider', 'crush'],
  },
  // Speech to text for meeting notes (speech.js). OpenAI, Groq, Mistral, Together and Gemini keys
  // above work for it too.
  {
    id: 'deepgram', name: 'Deepgram', group: 'speech', description: 'Nova-3 speech to text, many languages.',
    keyUrl: 'https://console.deepgram.com',
    fields: [{ env: 'DEEPGRAM_API_KEY', label: 'API key', type: 'secret' }],
    agents: [],
    test: (v) => ({ url: 'https://api.deepgram.com/v1/projects', headers: { Authorization: `Token ${v.DEEPGRAM_API_KEY}` } }),
  },
  {
    id: 'assemblyai', name: 'AssemblyAI', group: 'speech', description: 'Speech to text, 99 languages.',
    keyUrl: 'https://www.assemblyai.com/dashboard/api-keys',
    fields: [{ env: 'ASSEMBLYAI_API_KEY', label: 'API key', type: 'secret' }],
    agents: [],
    test: (v) => ({ url: 'https://api.assemblyai.com/v2/transcript?limit=1', headers: { authorization: v.ASSEMBLYAI_API_KEY } }),
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', group: 'speech', description: 'Scribe speech to text, 90+ languages.',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    fields: [{ env: 'ELEVENLABS_API_KEY', label: 'API key', type: 'secret' }],
    agents: [],
    test: (v) => ({ url: 'https://api.elevenlabs.io/v1/models', headers: { 'xi-api-key': v.ELEVENLABS_API_KEY } }),
  },
  {
    id: 'speech', name: 'Another speech service', group: 'speech', description: 'Any service with OpenAI-style speech to text (/audio/transcriptions), online or on this computer (Speaches, LocalAI).',
    fields: [
      { env: 'SPEECH_BASE_URL', label: 'Address', type: 'text', placeholder: 'https://…/v1' },
      { env: 'SPEECH_API_KEY', label: 'API key', type: 'secret', optional: true },
      { env: 'SPEECH_MODEL', label: 'Model', type: 'text', optional: true, placeholder: 'whisper-1' },
    ],
    agents: [],
  },
]
const byId = new Map(PROVIDERS.map((p) => [p.id, p]))

const normHost = (h) => (/^https?:\/\//.test(h) ? h : `http://${h}`).replace(/\/$/, '').replace('0.0.0.0', '127.0.0.1')
function exists(p) { try { return !!p && fs.existsSync(p) } catch { return false } }
const gcloudAdc = () => (IS_WIN
  ? path.join(process.env.APPDATA || '', 'gcloud', 'application_default_credentials.json')
  : path.join(process.env.CLOUDSDK_CONFIG || path.join(HOME, '.config', 'gcloud'), 'application_default_credentials.json'))

// ---------- Secrets store ----------
const SECRETS = dataFile('secrets.json')
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/
let cache = null // { mtime, values: saved {ENV: value}, env: values plus aliases }
// Read again when the file changes: a chat (chatagent.js) is its own process, and a key you fix
// in Settings should work in it from the next message.
const stamp = () => { try { return fs.statSync(SECRETS).mtimeMs } catch { return 0 } }
export const keysStamp = stamp // changes when a key is saved or removed

function load() {
  const mtime = stamp()
  if (cache && cache.mtime === mtime) return cache
  let values = {}
  try {
    const raw = JSON.parse(fs.readFileSync(SECRETS, 'utf8'))
    if (raw && typeof raw === 'object') values = Object.fromEntries(Object.entries(raw).filter(([k, v]) => ENV_NAME.test(k) && typeof v === 'string' && v))
  } catch { /* no file yet */ }
  cache = { mtime, values, env: buildEnv(values) }
  return cache
}

function buildEnv(values) {
  const env = { ...values }
  for (const p of PROVIDERS) {
    for (const [alias, from] of Object.entries(p.aliases || {})) {
      if (values[from] && !values[alias] && !process.env[alias]) env[alias] = values[from]
    }
  }
  return env
}

function save(values) {
  ensureDir(DATA)
  writeFileAtomic(SECRETS, JSON.stringify(values, null, 2) + '\n', { mode: 0o600 })
  cache = { mtime: stamp(), values, env: buildEnv(values) }
}

// Environment variables for the agents Bridge AI starts itself (built-in runtime). Not the keys of
// providers that are hidden (labs.js).
export function providerEnv() {
  const env = { ...load().env }
  for (const p of PROVIDERS) if (hiddenProvider(p.id)) for (const e of [...p.fields.map((f) => f.env), ...(p.alsoEnv || []), ...Object.keys(p.aliases || {})]) delete env[e]
  return env
}

// A saved value, else the server's own environment.
const valueOf = (env) => load().values[env] || process.env[env] || ''
const fieldValues = (p) => Object.fromEntries(p.fields.map((f) => [f.env, valueOf(f.env)]))

// ---------- Provider status ----------
async function getJSON(url, ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    return res.ok ? await res.json() : null
  } catch { return null } finally { clearTimeout(t) }
}

const required = (p) => p.fields.filter((f) => !f.optional)

// The last test of each provider's key, so one the provider turned down doesn't show as connected.
// Kept for the values it was run with (a hash of them, never the values).
const tested = new Map() // id -> { fp, ok, message }
const fingerprint = (p) => crypto.createHash('sha256').update(JSON.stringify(fieldValues(p))).digest('hex').slice(0, 16)
// Providers a chat can talk to (chatmodels.js): New chat › Any model.
const CHAT = new Set(['anthropic', 'openai', 'gemini', 'xai', 'meta', 'perplexity', 'openrouter', 'deepseek', 'mistral', 'groq', 'moonshot', 'together', 'fireworks', 'cerebras', 'ollama', 'lmstudio'])

async function statusOf(p) {
  const saved = load().values
  const fields = p.fields.map((f) => {
    const out = { env: f.env, label: f.label, type: f.type, optional: !!f.optional, placeholder: f.placeholder || '' }
    const v = saved[f.env]
    // Secrets: only whether one is saved and its last 4 characters (for long keys). Plain
    // settings (region, endpoint, project) are shown as saved so they can be edited.
    if (v) out.saved = f.type === 'secret' ? { set: true, last4: v.length >= 16 ? v.slice(-4) : '' } : { set: true, value: v }
    else if (process.env[f.env]) out.environment = true
    return out
  })
  const base = {
    id: p.id, name: p.name, group: p.group, description: p.description, keyUrl: p.keyUrl, agents: p.agents?.filter((k) => !hiddenAgent(k)),
    testable: !!(p.test || p.local), local: !!p.local, fields, chat: CHAT.has(p.id),
  }
  if (p.local) {
    const j = await getJSON(p.local.url(fieldValues(p)), 1200)
    return j ? { ...base, status: 'connected', source: 'local', models: p.local.models(j).slice(0, 40) } : { ...base, status: 'not set', source: null }
  }
  const req = required(p)
  const all = (pick) => req.length > 0 && req.every((f) => pick(f.env))
  const t = tested.get(p.id)
  const refused = t && !t.ok && t.fp === fingerprint(p) ? { status: 'rejected', message: t.message } : null
  if (all((e) => saved[e])) return { ...base, status: 'connected', source: 'bridge', ...refused }
  if (all((e) => saved[e] || process.env[e]) || (p.alsoEnv || []).some((e) => process.env[e])) return { ...base, status: 'connected', source: 'environment', ...refused }
  if (p.cloud?.()) return { ...base, status: 'connected', source: 'cloud' }
  if (req.some((f) => saved[f.env])) return { ...base, status: 'incomplete', source: 'bridge' }
  return { ...base, status: 'not set', source: null }
}

async function testProvider(p) {
  if (p.local) {
    const j = await getJSON(p.local.url(fieldValues(p)), 3000)
    if (!j) return { ok: false, message: 'Not reachable. Is it running?' }
    const n = p.local.models(j).length
    return { ok: true, message: `Running with ${n} model${n === 1 ? '' : 's'}` }
  }
  if (!p.test) return { ok: false, message: 'No quick test for this provider.' }
  const v = fieldValues(p)
  const missing = required(p).filter((f) => !v[f.env])
  if (missing.length) return { ok: false, message: `Missing ${missing.map((f) => f.label).join(', ')}` }
  const req = p.test(v)
  if (!req) return { ok: false, message: 'Missing settings' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  const note = (r) => { tested.set(p.id, { fp: fingerprint(p), ok: r.ok, message: r.message }); return r }
  try {
    const res = await fetch(req.url, { headers: req.headers, signal: ctrl.signal })
    if (res.ok) return note({ ok: true, message: 'Key works' })
    let detail = ''
    try { const j = await res.json(); detail = j?.error?.message || j?.message || j?.error || j?.detail || '' } catch { /* not JSON */ }
    if (typeof detail !== 'string') detail = ''
    // Never echo the key back, even if the provider quotes it.
    for (const val of Object.values(v)) if (val && val.length > 6) detail = detail.split(val).join('***')
    const r = { ok: false, message: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` }
    return res.status === 401 || res.status === 403 ? note(r) : r // only a key it refused counts against it
  } catch (e) {
    return { ok: false, message: e.name === 'AbortError' ? 'Timed out after 6s' : 'Could not reach the provider' }
  } finally { clearTimeout(t) }
}

// ---------- Agent sign-ins (presence only) ----------
// Each check looks at whether a login file, field or keychain item exists. It never returns
// tokens, keys or emails; at most a plan name ("Max") or the names of configured providers.
const readJSON = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
const anyEnv = (...names) => names.some((n) => valueOf(n))
const run = (cmd, args, ms = 5000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: ms, windowsHide: true }, (err, stdout = '', stderr = '') => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}\n${stderr}` }))
})
// macOS keychain: does an item with this service name exist? No -w/-g, so nothing is read out.
const keychainHas = async (service) => IS_MAC && (await run('/usr/bin/security', ['find-generic-password', '-s', service], 3000)).code === 0
const planName = (s) => (typeof s === 'string' && s ? s.replace(/^claude_/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() : null)
const S = (signedIn, method = null, account = null) => ({ signedIn, method, account })

// Any API-key provider usable from Bridge AI or the environment (for multi-provider agents).
const anyProviderKey = () => PROVIDERS.some((p) => !p.local && !p.cloud && required(p).length > 0 && required(p).every((f) => valueOf(f.env)))

const DETECT = {
  async claude() {
    if (valueOf('CLAUDE_CODE_USE_BEDROCK')) return S(true, 'cloud', 'AWS Bedrock')
    if (valueOf('CLAUDE_CODE_USE_VERTEX')) return S(true, 'cloud', 'Google Vertex AI')
    const acct = readJSON(path.join(HOME, '.claude.json'))?.oauthAccount
    const creds = exists(path.join(HOME, '.claude', '.credentials.json')) || await keychainHas('Claude Code-credentials')
    if (creds || acct) return S(true, 'subscription', planName(acct?.organizationType))
    if (anyEnv('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')) return S(true, 'api key')
    return S(false)
  },
  async codex() {
    const a = readJSON(path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'auth.json'))
    if (a?.tokens && typeof a.tokens === 'object' && Object.keys(a.tokens).length) return S(true, 'subscription', 'ChatGPT')
    if (a?.OPENAI_API_KEY || anyEnv('OPENAI_API_KEY')) return S(true, 'api key')
    return S(false)
  },
  async gemini() {
    const dir = path.join(HOME, '.gemini')
    const s = readJSON(path.join(dir, 'settings.json')) || {}
    const type = String(s.security?.auth?.selectedType || s.selectedAuthType || '')
    if (/vertex/i.test(type) || valueOf('GOOGLE_GENAI_USE_VERTEXAI')) return S(true, 'cloud', 'Vertex AI')
    if (exists(path.join(dir, 'oauth_creds.json'))) return S(true, 'subscription', 'Google account')
    if (anyEnv('GEMINI_API_KEY', 'GOOGLE_API_KEY')) return S(true, 'api key')
    if (/oauth|login/i.test(type)) return S(null, 'subscription')
    return S(false)
  },
  async copilot(isInstalled) {
    if (anyEnv('COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN')) return S(true, 'api key')
    // Its config.json starts with // comment lines; newer versions name the fields in camelCase.
    let cfg = null
    try { cfg = JSON.parse(fs.readFileSync(path.join(process.env.COPILOT_HOME || path.join(HOME, '.copilot'), 'config.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '')) } catch { /* none */ }
    if (cfg && (cfg.logged_in_users?.length || cfg.last_logged_in_user || cfg.loggedInUsers?.length || cfg.lastLoggedInUser)) return S(true, 'subscription')
    if (await keychainHas('copilot-cli')) return S(true, 'subscription')
    // Copilot CLI falls back to the GitHub CLI's login. Whether the account has a Copilot plan
    // can't be told from here, so this counts as signed in to GitHub only. `gh auth status` goes
    // over the network, so only ask when Copilot is actually installed.
    if (isInstalled && (await run('gh', ['auth', 'status'], 5000)).code === 0) return S(true, 'subscription', 'via GitHub CLI')
    return S(null)
  },
  // bin: where it's installed (the app's own PATH may not have it).
  async cursor(isInstalled, bin = 'cursor-agent') {
    if (anyEnv('CURSOR_API_KEY')) return S(true, 'api key')
    // cursor-agent keeps its login in the system keychain; `cursor-agent status` reports it.
    // Only the yes/no is used; the output (which names the account) is discarded.
    // --format json says it plainly (isAuthenticated); it exits 0 either way. Older versions: the text.
    const j = await run(bin, ['status', '--format', 'json'], 6000)
    try { const o = JSON.parse(j.out.slice(j.out.indexOf('{'), j.out.lastIndexOf('}') + 1)); if (typeof o.isAuthenticated === 'boolean') return S(o.isAuthenticated, o.isAuthenticated ? 'subscription' : null) } catch { /* older */ }
    const r = await run(bin, ['status'], 6000)
    if (/not logged in|not authenticated|login required/i.test(r.out)) return S(false)
    if (/logged in/i.test(r.out)) return S(true, 'subscription')
    return S(null)
  },
  async grok() {
    const a = readJSON(path.join(HOME, '.grok', 'auth.json'))
    const entries = a && typeof a === 'object' ? Object.values(a).filter((e) => e && typeof e === 'object') : []
    if (entries.length) return S(true, entries.some((e) => /api.?key/i.test(String(e.auth_mode || ''))) ? 'api key' : 'subscription', 'xAI account')
    if (anyEnv('XAI_API_KEY', 'GROK_API_KEY')) return S(true, 'api key')
    return S(false)
  },
  async opencode() {
    const base = IS_WIN ? path.join(process.env.LOCALAPPDATA || HOME, 'opencode') : path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'opencode')
    const a = readJSON(path.join(base, 'auth.json'))
    const names = a && typeof a === 'object' ? Object.keys(a) : []
    if (names.length) return S(true, names.some((n) => a[n]?.type === 'oauth') ? 'subscription' : 'api key', names.slice(0, 4).join(', '))
    if (anyProviderKey()) return S(true, 'api key', 'keys from Bridge AI or environment')
    return S(false)
  },
  async qwen() {
    const dir = path.join(HOME, '.qwen')
    if (exists(path.join(dir, 'oauth_creds.json'))) return S(true, 'subscription', 'Qwen OAuth')
    if (anyEnv('OPENAI_API_KEY', 'DASHSCOPE_API_KEY')) return S(true, 'api key')
    const s = readJSON(path.join(dir, 'settings.json')) || {}
    const type = String(s.security?.auth?.selectedType || s.selectedAuthType || '')
    if (type) return S(null, /openai/i.test(type) ? 'api key' : 'subscription')
    return S(false)
  },
  async amp() {
    if (anyEnv('AMP_API_KEY')) return S(true, 'api key')
    if (exists(path.join(HOME, '.local', 'share', 'amp', 'secrets.json'))) return S(true, 'subscription')
    return S(null) // some versions keep the login in the system keychain
  },
  async aider() {
    return anyProviderKey() ? S(true, 'api key', 'keys from Bridge AI or environment') : S(null)
  },
  async goose() {
    const dir = IS_WIN ? path.join(process.env.APPDATA || HOME, 'Block', 'goose', 'config') : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'goose')
    let provider = null
    try { provider = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8').match(/^GOOSE_PROVIDER:\s*["']?([\w.-]+)/m)?.[1] || null } catch { /* not configured */ }
    // The provider's key lives in the keychain or secrets.yaml; configured is the best signal.
    return provider ? S(true, 'api key', provider) : S(false)
  },
  async crush() {
    const files = [path.join(HOME, '.local', 'share', 'crush', 'crush.json'), path.join(HOME, '.config', 'crush', 'crush.json')]
    const names = [...new Set(files.flatMap((f) => Object.keys(readJSON(f)?.providers || {})))]
    if (names.length) return S(true, 'api key', names.slice(0, 4).join(', '))
    if (anyProviderKey()) return S(true, 'api key', 'keys from Bridge AI or environment')
    return S(false)
  },
}

const HINTS = {
  claude: 'Run claude and choose your Claude account (Pro, Max, Team), or save an Anthropic key.',
  codex: 'Run codex login to sign in with ChatGPT, or save an OpenAI key.',
  gemini: 'Run gemini and pick Login with Google, or save a Gemini key.',
  copilot: 'Run copilot, then /login. Needs a GitHub Copilot plan.',
  cursor: 'Run cursor-agent login, or set CURSOR_API_KEY.',
  grok: 'Run grok and sign in with your xAI account, or save an xAI key.',
  opencode: 'Run opencode auth login, or save any provider key.',
  qwen: 'Run qwen and choose Qwen OAuth, or save an OpenAI-compatible key.',
  amp: 'Run amp login, or set AMP_API_KEY.',
  aider: 'Aider reads provider keys from the environment. Save one below.',
  goose: 'Run goose configure to pick a provider.',
  crush: 'Run crush and pick a provider, or save any provider key.',
}

// One agent's sign-in, checked now (a Sign in tab closes once this says yes).
export async function signedInNow(kind) {
  subsCache.list = null
  const bin = (await installedAgents().catch(() => [])).find((a) => a.kind === kind)?.path
  try { return DETECT[kind] ? (await DETECT[kind](!!bin, bin || undefined)).signedIn : null } catch { return null }
}

let subsCache = { at: 0, list: null }
let subsInflight = null
export function subscriptions(installedFn = installedAgents) {
  const shown = (list) => list.filter((s) => !hiddenAgent(s.kind))
  if (subsCache.list && Date.now() - subsCache.at < 30_000) return Promise.resolve(shown(subsCache.list))
  return (subsInflight ||= checkSubscriptions(installedFn).finally(() => { subsInflight = null })).then(shown)
}
async function checkSubscriptions(installedFn) {
  const inst = await Promise.resolve().then(installedFn).catch(() => [])
  const have = new Set((inst || []).map((a) => a.kind))
  const list = await Promise.all(AGENTS.map(async (a) => {
    const isIn = have.has(a.kind)
    let s = S(null)
    // Checks that run the CLI itself (cursor-agent, gh) only make sense when it's installed.
    if (DETECT[a.kind] && (isIn || a.kind !== 'cursor')) { try { s = await DETECT[a.kind](isIn, (inst || []).find((x) => x.kind === a.kind)?.path || undefined) } catch { s = S(null) } }
    return { kind: a.kind, label: a.label, installed: isIn, ...s, hint: HINTS[a.kind] || null }
  }))
  subsCache = { at: Date.now(), list }
  return list
}

// ---------- Routes ----------
export function providerRoutes(app, { installed } = {}) {
  const fail = (res, e) => res.status(502).json({ error: e?.message || String(e) })
  const find = (req, res) => {
    const p = byId.get(req.params.id)
    if (!p) res.status(404).json({ error: 'Unknown provider' })
    return p
  }

  app.get('/api/providers', async (req, res) => {
    try {
      res.json({ providers: await Promise.all(PROVIDERS.filter((p) => !hiddenProvider(p.id)).map(statusOf)) })
    } catch (e) { fail(res, e) }
  })

  // { values: { ENV_NAME: 'value' } }. An empty string (or false for a flag) removes it.
  app.put('/api/providers/:id', async (req, res) => {
    try {
      const p = find(req, res)
      if (!p) return
      const incoming = req.body?.values
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return res.status(400).json({ error: 'Expected { values: { ENV_NAME: value } }' })
      const allowed = new Map(p.fields.map((f) => [f.env, f]))
      const bad = Object.keys(incoming).filter((k) => !allowed.has(k))
      if (bad.length) return res.status(400).json({ error: `Not a setting of ${p.name}: ${bad.join(', ')}` })
      const values = { ...load().values }
      for (const [k, raw] of Object.entries(incoming)) {
        const f = allowed.get(k)
        let v = raw == null || raw === false ? '' : raw === true ? '1' : String(raw).trim()
        if (f.type === 'flag') v = v && v !== '0' ? '1' : ''
        if (/[\r\n\0]/.test(v)) return res.status(400).json({ error: `${f.label} has invalid characters` })
        if (v.length > 8192) return res.status(400).json({ error: `${f.label} is too long` })
        if (v) values[k] = v
        else delete values[k]
      }
      save(values)
      subsCache.list = null
      // A key you just saved is tried at once, so you know now rather than in your first chat.
      const test = p.test && Object.values(incoming).some((v) => v) ? await testProvider(p).catch(() => null) : null
      res.json({ ...(await statusOf(p)), ...(test ? { test } : {}) })
    } catch (e) { fail(res, e) }
  })

  app.delete('/api/providers/:id', async (req, res) => {
    try {
      const p = find(req, res)
      if (!p) return
      const values = { ...load().values }
      for (const f of p.fields) delete values[f.env]
      save(values)
      subsCache.list = null
      res.json(await statusOf(p))
    } catch (e) { fail(res, e) }
  })

  app.post('/api/providers/:id/test', async (req, res) => {
    try {
      const p = find(req, res)
      if (!p) return
      res.json(await testProvider(p))
    } catch (e) { fail(res, e) }
  })

  app.get('/api/subscriptions', async (req, res) => {
    try {
      if (req.query.refresh) subsCache.list = null
      res.json(await subscriptions(installed || installedAgents))
    } catch (e) { fail(res, e) }
  })
}
