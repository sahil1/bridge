// The models a chat (chatagent.js) can talk to, and how to talk to each. One list across every way
// you can reach a model:
//   your sign-in to an agent (Claude Code, Codex, Gemini CLI, ...), in its one-shot mode, so a
//     subscription works with nothing more to set up;
//   an API key saved in Settings › Model Providers (or in your environment), clouds included
//     (Azure OpenAI, AWS Bedrock, Google Vertex AI);
//   a model server on this computer (Ollama, LM Studio), or the local model built into Bridge AI
//     (llm.js), once you've downloaded it.
// A model is named "<route>:<model>": "cli:gemini", "openai:gpt-5", "ollama:llama3.2". Any model
// the provider has can be used by name, not only the ones listed.
//
// The conversation goes in as [{ role: 'user'|'assistant'|'tool', text, calls?, id?, name?, error? }]:
// an assistant turn may call tools (calls: [{ id, name, args }]) and each call's result comes back
// as a 'tool' turn. A user turn may carry pictures (images: ['data:image/png;base64,…']) for a model
// that can see them (canSee); other models get the words only. reply() turns that into each
// provider's own shape (OpenAI-style, Anthropic, Bedrock's Converse) and returns { text, calls }. A
// sign-in's one-shot mode has no tools. What each answer took (tokens in and out, as the provider
// says, and the seconds) is noted on this computer with the part of Bridge AI that asked
// (usagelog.js).
// Request shapes from each provider's docs: platform.claude.com (tool use), developers.openai.com
// (function calling), docs.cohere.com/docs/compatibility-api, docs.z.ai, huggingface.co/docs/
// inference-providers, learn.microsoft.com (Azure OpenAI v1), docs.aws.amazon.com/bedrock (Converse,
// API keys, SigV4), docs.cloud.google.com/vertex-ai (OpenAI-compatible endpoint, Claude rawPredict).
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { API, CLI, keyFor, oneShot, anthropicUrl } from './consult.js'
import { installed, adapter, loginPath } from './agents.js'
import { providerEnv, subscriptions, keysStamp } from './providers.js'
import { moreOn, hiddenModel, OFF } from './labs.js'
import { machine } from './machine.js'
import * as llm from './llm.js'
import * as usagelog from './usagelog.js'
import * as counts from './counts.js'

const TIMEOUT = 5 * 60 * 1000
const until = (signal, ms = TIMEOUT) => (AbortSignal.any && signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : signal || AbortSignal.timeout(ms)) // any(): Node 20+
const env = () => ({ ...process.env, ...providerEnv() })
const trim = (u) => String(u || '').replace(/\/+$/, '')

// OpenAI-style routes beyond consult.js's (whose default model each has), from Settings › Model
// providers. Their models come from the provider's own list, or a short one where there's none.
const MORE = {
  moonshot: { label: 'Moonshot AI (Kimi)', base: () => 'https://api.moonshot.ai/v1', key: 'MOONSHOT_API_KEY' },
  together: { label: 'Together AI', base: () => 'https://api.together.xyz/v1', key: 'TOGETHER_API_KEY' },
  fireworks: { label: 'Fireworks AI', base: () => 'https://api.fireworks.ai/inference/v1', key: 'FIREWORKS_API_KEY' },
  cerebras: { label: 'Cerebras', base: () => 'https://api.cerebras.ai/v1', key: 'CEREBRAS_API_KEY' },
  // Cohere's OpenAI-compatible API has no model list: its own API does.
  cohere: {
    label: 'Cohere', base: () => 'https://api.cohere.ai/compatibility/v1', key: 'COHERE_API_KEY',
    list: (k) => getJSON('https://api.cohere.com/v1/models?endpoint=chat&page_size=100', { authorization: `Bearer ${k}` }).then((j) => (j.models || []).filter((m) => !m.is_deprecated).map((m) => m.name)),
    fallback: ['command-a-03-2025'],
  },
  // A Coding Plan key has its own base URL (Settings › Model Providers › Z.ai).
  zai: { label: 'Z.ai (GLM)', base: () => trim(env().ZAI_BASE_URL) || 'https://api.z.ai/api/paas/v4', key: 'ZAI_API_KEY', fixed: ['glm-5.3', 'glm-5.3-flash', 'glm-4.7'] },
  // Models any live provider serves; "org/model:provider" picks one.
  huggingface: {
    label: 'Hugging Face', base: () => 'https://router.huggingface.co/v1', key: 'HF_TOKEN',
    list: (k) => getJSON('https://router.huggingface.co/v1/models', { authorization: `Bearer ${k}` }).then((j) => (j.data || []).filter((m) => (m.providers || []).some((p) => p.status === 'live')).map((m) => m.id)),
  },
}
const LMSTUDIO = () => trim(env().LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1')
const OLLAMA = () => { const h = env().OLLAMA_HOST || 'http://127.0.0.1:11434'; return trim(/^https?:\/\//.test(h) ? h : `http://${h}`) }
const PROVIDER = { anthropic: 'Anthropic', openai: 'OpenAI', xai: 'xAI', meta: 'Meta', gemini: 'Google', perplexity: 'Perplexity', openrouter: 'OpenRouter', deepseek: 'DeepSeek', mistral: 'Mistral', groq: 'Groq', azure: 'Azure OpenAI', bedrock: 'AWS Bedrock', vertex: 'Google Vertex AI', ollama: 'Ollama, on this computer', lmstudio: 'LM Studio, on this computer', bridge: 'Bridge AI, on this computer' }
// What a CLI's one-shot answer comes from, said the way people know it.
const VIA = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', cursor: 'Cursor', copilot: 'GitHub Copilot', opencode: 'OpenCode', qwen: 'Qwen' }

const getJSON = async (url, headers = {}, ms = 2500) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
const postJSON = async (url, body, ms = 2500) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
// Not chat models, in an OpenAI-style model list.
const NOT_CHAT = /embed|whisper|tts|dall-e|audio|realtime|moderation|image|transcri|search|davinci|babbage|rerank|guard|vision-preview/i
// Ollama's embedding models (nomic-embed-text, all-minilm, bge-m3) are BERT-family: they can't chat.
const ollamaChats = (m) => !NOT_CHAT.test(m.name) && !/bert$/i.test(m.details?.family || '')

// ---------- Clouds ----------
// Azure OpenAI: your deployments, named in Settings (a key alone can't list them).
const azure = () => {
  const e = env()
  return { key: e.AZURE_OPENAI_API_KEY, endpoint: trim(e.AZURE_OPENAI_ENDPOINT), version: e.OPENAI_API_VERSION || '', deployments: String(e.AZURE_OPENAI_DEPLOYMENTS || '').split(',').map((x) => x.trim()).filter(Boolean) }
}

// AWS: a Bedrock API key, else the access keys of your AWS profile (signed with SigV4).
const iniSections = (file) => {
  const out = {}
  let cur = null
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const l = raw.trim()
      if (!l || l.startsWith('#') || l.startsWith(';')) continue
      const h = /^\[(.+)\]$/.exec(l)
      if (h) { cur = out[h[1].trim()] = out[h[1].trim()] || {}; continue }
      const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(l)
      if (kv && cur) cur[kv[1].trim()] = kv[2].trim()
    }
  } catch { /* no file */ }
  return out
}
function aws() {
  const e = env()
  const profile = e.AWS_PROFILE || 'default'
  const conf = iniSections(e.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config'))[profile === 'default' ? 'default' : `profile ${profile}`] || {}
  const region = e.AWS_REGION || e.AWS_DEFAULT_REGION || conf.region || 'us-east-1'
  if (e.AWS_BEARER_TOKEN_BEDROCK) return { region, bearer: e.AWS_BEARER_TOKEN_BEDROCK }
  if (e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY) return { region, creds: { id: e.AWS_ACCESS_KEY_ID, secret: e.AWS_SECRET_ACCESS_KEY, token: e.AWS_SESSION_TOKEN } }
  const c = { ...conf, ...(iniSections(e.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials'))[profile] || {}) }
  if (c.aws_access_key_id && c.aws_secret_access_key) return { region, creds: { id: c.aws_access_key_id, secret: c.aws_secret_access_key, token: c.aws_session_token } }
  return { region, sso: !!(c.sso_session || c.sso_start_url), none: true }
}
const awsReady = () => { const e = env(); return !!(e.AWS_BEARER_TOKEN_BEDROCK || e.AWS_REGION || e.AWS_PROFILE) && !aws().none }
// SigV4 (docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html):
// each path segment encoded twice for every service but S3.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
function sigv4({ method, host, pathname, query = {}, body = '', region, creds, service = 'bedrock' }) {
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amz.slice(0, 8)
  const hash = (x) => crypto.createHash('sha256').update(x).digest('hex')
  const hmac = (k, x) => crypto.createHmac('sha256', k).update(x).digest()
  const headers = { 'content-type': 'application/json', host, 'x-amz-date': amz, ...(creds.token ? { 'x-amz-security-token': creds.token } : {}) }
  const names = Object.keys(headers).sort()
  const canonPath = pathname.split('/').map((seg) => enc(seg)).join('/')
  const canonQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&')
  const creq = [method, canonPath, canonQuery, names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join(''), names.join(';'), hash(body)].join('\n')
  const scope = `${date}/${region}/${service}/aws4_request`
  let k = hmac(`AWS4${creds.secret}`, date)
  for (const part of [region, service, 'aws4_request']) k = hmac(k, part)
  const sig = crypto.createHmac('sha256', k).update(['AWS4-HMAC-SHA256', amz, scope, hash(creq)].join('\n')).digest('hex')
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${creds.id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` }
}
// A Bedrock request, signed whichever way you set up. pathname has its segments encoded once.
async function bedrock(host, pathname, { method = 'GET', query = {}, body, signal, ms } = {}) {
  const a = aws()
  if (a.none) throw new Error(a.sso ? 'Your AWS profile signs in with SSO, which Bridge AI can\'t use yet. Add a Bedrock API key in Settings › Model Providers instead.' : 'No AWS access keys or Bedrock API key found. Add a Bedrock API key in Settings › Model Providers.')
  const h = `${host}.${a.region}.amazonaws.com`
  const text = body == null ? '' : JSON.stringify(body)
  const qs = Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''
  const headers = a.bearer ? { 'content-type': 'application/json', authorization: `Bearer ${a.bearer}` } : sigv4({ method, host: h, pathname, query, body: text, region: a.region, creds: a.creds })
  delete headers.host
  const r = await fetch(`https://${h}${pathname}${qs}`, { method, headers, body: body == null ? undefined : text, signal: signal ? until(signal) : AbortSignal.timeout(ms || 4000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw failed('AWS Bedrock', r.status, j)
  return j
}
async function bedrockModels() {
  const [profiles, base] = await Promise.all([
    bedrock('bedrock', '/inference-profiles', { query: { maxResults: '1000', type: 'SYSTEM_DEFINED' } }).catch(() => ({})),
    bedrock('bedrock', '/foundation-models', { query: { byOutputModality: 'TEXT' } }).catch(() => ({})),
  ])
  const out = (profiles.inferenceProfileSummaries || []).filter((p) => p.status === 'ACTIVE' && !NOT_CHAT.test(p.inferenceProfileId)).map((p) => ({ id: p.inferenceProfileId, label: p.inferenceProfileName || p.inferenceProfileId }))
  for (const m of base.modelSummaries || []) {
    if (!(m.inferenceTypesSupported || []).includes('ON_DEMAND') || NOT_CHAT.test(m.modelId) || m.modelLifecycle?.status === 'LEGACY') continue
    out.push({ id: m.modelId, label: `${m.providerName ? `${m.providerName} ` : ''}${m.modelName || m.modelId}` })
  }
  return out.slice(0, 60)
}

// Google Vertex AI: an access token from your service account file, your gcloud login's
// application-default credentials, or the gcloud CLI. Kept until a few minutes before it expires.
let gtoken = { value: null, until: 0, user: false }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString(), signal: AbortSignal.timeout(10000) })
async function googleToken() {
  if (gtoken.value && Date.now() < gtoken.until) return gtoken
  const file = env().GOOGLE_APPLICATION_CREDENTIALS || path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json')
  let c = null
  try { c = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* none */ }
  let got = null
  if (c?.type === 'service_account' && c.private_key && c.client_email) {
    const now = Math.floor(Date.now() / 1000)
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: c.private_key_id }))
    const claims = b64url(JSON.stringify({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
    const sig = b64url(crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(c.private_key))
    const r = await fetch('https://oauth2.googleapis.com/token', form({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }))
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.access_token) throw new Error(`Google turned down the service account (${j.error_description || j.error || `HTTP ${r.status}`}). Check the file in Settings › Model Providers › Vertex AI.`)
    got = { value: j.access_token, until: Date.now() + ((j.expires_in || 3600) - 300) * 1000, user: false }
  } else if (c?.type === 'authorized_user' && c.refresh_token) {
    const r = await fetch('https://oauth2.googleapis.com/token', form({ grant_type: 'refresh_token', client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token }))
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.access_token) throw new Error(`Google turned down your gcloud login (${j.error_description || j.error || `HTTP ${r.status}`}). Run "gcloud auth application-default login" again.`)
    got = { value: j.access_token, until: Date.now() + ((j.expires_in || 3600) - 300) * 1000, user: true, quota: c.quota_project_id }
  } else {
    const PATH = await loginPath()
    const run = (args) => new Promise((resolve, reject) => execFile('gcloud', args, { timeout: 15000, env: { ...process.env, PATH } }, (err, out) => (err ? reject(err) : resolve(String(out).trim()))))
    const value = await run(['auth', 'application-default', 'print-access-token']).catch(() => run(['auth', 'print-access-token'])).catch(() => null)
    if (!value) throw new Error('No Google Cloud login found. Add a service account file in Settings › Model Providers › Vertex AI, or run "gcloud auth application-default login".')
    got = { value, until: Date.now() + 45 * 60 * 1000, user: true }
  }
  gtoken = got
  return got
}
const vertex = () => {
  const e = env()
  const loc = e.GOOGLE_CLOUD_LOCATION || 'global'
  return { project: e.GOOGLE_CLOUD_PROJECT, loc, root: `https://${loc === 'global' ? '' : `${loc}-`}aiplatform.googleapis.com/v1/projects/${e.GOOGLE_CLOUD_PROJECT}/locations/${loc}` }
}
// No model list on Vertex's OpenAI-compatible endpoint: the ones its docs use. Others by name.
const VERTEX_MODELS = [['google/gemini-3.5-flash', 'Gemini 3.5 Flash'], ['claude-opus-5-5', 'Claude Opus 5.5'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-haiku-5-5', 'Claude Haiku 5.5']]
async function vertexHeaders() {
  const t = await googleToken()
  return { authorization: `Bearer ${t.value}`, ...(t.user ? { 'x-goog-user-project': t.quota || vertex().project } : {}) }
}

// ---------- The list ----------
let cache = { at: 0, list: null, keys: 0 }
// Every model you can talk to right now: [{ id, label, provider, via }], subscriptions first.
// via: 'sign-in' (an agent's one-shot mode, no tools), 'key', 'cloud' or 'local'.
// Kept a minute, or until a key is saved or removed. The more models (labs.js) only when they're
// on, wherever they're served.
export async function models({ fresh = false } = {}) {
  if (!fresh && cache.list && cache.keys === keysStamp() && cache.more === moreOn() && cache.llm === llm.listStamp() && Date.now() - cache.at < 60 * 1000) return cache.list
  const out = []
  const have = new Set((await installed().catch(() => [])).map((a) => a.kind))
  const signedOut = new Set((await subscriptions().catch(() => [])).filter((s) => s.signedIn === false).map((s) => s.kind))
  for (const kind of Object.keys(CLI)) {
    if (have.has(kind) && !signedOut.has(kind)) out.push({ id: `cli:${kind}`, label: VIA[kind] || adapter(kind).label, provider: `Your ${adapter(kind).label} sign-in`, via: 'sign-in' })
  }
  for (const [id, a] of Object.entries(API)) {
    if (a.local || !keyFor(a)) continue
    out.push({ id: `${id}:${a.model}`, label: a.model, provider: PROVIDER[id] || a.label, via: 'key' })
  }
  const e = env()
  const az = azure()
  if (az.key && az.endpoint) for (const d of az.deployments) out.push({ id: `azure:${d}`, label: d, provider: PROVIDER.azure, via: 'cloud' })
  const v = vertex()
  if (v.project) for (const [id, label] of VERTEX_MODELS) out.push({ id: `vertex:${id}`, label, provider: PROVIDER.vertex, via: 'cloud' })
  const lists = await Promise.all([
    ...Object.entries(MORE).filter(([, m]) => e[m.key]).map(([id, m]) => (m.fixed ? Promise.resolve(m.fixed) : (m.list || ((k) => getJSON(`${m.base()}/models`, { authorization: `Bearer ${k}` }).then((j) => (j.data || []).map((x) => x.id))))(e[m.key]).catch(() => m.fallback || []))
      .then((ids) => ids.filter((x) => x && !NOT_CHAT.test(x)).slice(0, 30).map((x) => ({ id: `${id}:${x}`, label: x, provider: m.label, via: 'key' })))),
    awsReady() ? bedrockModels().then((l) => l.map((m) => ({ id: `bedrock:${m.id}`, label: m.label, provider: PROVIDER.bedrock, via: 'cloud' }))).catch(() => []) : [],
    getJSON(`${OLLAMA()}/api/tags`, {}, 1200).then((j) => (j.models || []).filter(ollamaChats).map((m) => ({ id: `ollama:${m.name}`, label: m.name, provider: PROVIDER.ollama, via: 'local' }))).catch(() => []),
    getJSON(`${LMSTUDIO()}/models`, {}, 1200).then((j) => (j.data || []).map((m) => m.id).filter((x) => x && !NOT_CHAT.test(x)).map((x) => ({ id: `lmstudio:${x}`, label: x, provider: PROVIDER.lmstudio, via: 'local' }))).catch(() => []),
  ])
  for (const l of lists) out.push(...l)
  // The local model built in, last: only once it's downloaded (nothing is tried before that).
  if (await llm.ready().catch(() => false)) out.push({ id: llm.ID, label: llm.MODELS[0].label, provider: PROVIDER.bridge, via: 'local', builtin: true })
  const list = out.filter((m) => !hiddenModel(m.id))
  cache = { at: Date.now(), list, keys: keysStamp(), more: moreOn(), llm: llm.listStamp() }
  return list
}

// A route by the name people know it, and how it's reached: { label, via } ('key', 'cloud', 'local').
export const routeInfo = (route) => ({ label: (PROVIDER[route] || MORE[route]?.label || API[route]?.label || route).replace(/, on this computer$/, ''), via: /^(ollama|lmstudio|bridge)$/.test(route) ? 'local' : /^(azure|bedrock|vertex)$/.test(route) ? 'cloud' : 'key' })

// How a model id reads in the chat: "GPT-5, OpenAI key"-ish, from the list when it's there.
export function describe(id, list = cache.list || []) {
  const m = list.find((x) => x.id === id)
  if (m) return m.via === 'sign-in' ? `${m.label} (${m.provider.replace(/^Your /, 'your ')})` : `${m.label} (${m.provider})`
  const [route, ...rest] = String(id).split(':')
  return rest.length ? `${rest.join(':')} (${PROVIDER[route] || MORE[route]?.label || route})` : String(id)
}
// Whether a model can be given tools (a sign-in's one-shot mode can't).
export const canUseTools = (id) => !String(id || '').startsWith('cli:')

export const SYSTEM = 'You are a helpful assistant in Bridge AI, talking with the user directly. Be clear and direct, and say so when you are not sure. Use Markdown when it helps.'

// A sign-in's one-shot mode takes one prompt: the conversation goes in as a transcript.
function asTranscript(messages, system) {
  let text = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const line = m.role === 'tool' ? `Tool result (${m.name}): ${m.text}\n\n` : `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text || ''}\n\n`
    if (text.length + line.length > 60000 && text) break // the latest turns, within reason
    text = line + text
  }
  return `${system}\n\nThe conversation so far:\n\n${text}Reply to the user's last message as the assistant. Answer with the reply only.`
}

const failed = (who, status, body) => {
  const msg = body?.error?.message || body?.message || body?.Message || (typeof body?.error === 'string' ? body.error : '') || `HTTP ${status}`
  if (status === 401 || status === 403) return Object.assign(new Error(`${who} turned the key down (${msg}). Check it in Settings › Model Providers.`), { status })
  if (status === 404) return Object.assign(new Error(`${who} doesn't know that model (${msg}). Pick another with /model.`), { status })
  if (status === 429) return Object.assign(new Error(`${who} says you're over your limit for now (${msg}). Try again later, or pick another model with /model.`), { status })
  return Object.assign(new Error(`${who}: ${msg}`), { status })
}
const parseArgs = (s) => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}') } catch { return { _unparsed: String(s || '') } } }

// ---------- Pictures ----------
const pictures = (m) => (m.role === 'user' && Array.isArray(m.images) ? m.images.filter((u) => /^data:image\/(png|jpeg|webp);base64,/.test(u)) : [])
// Whether a model can look at a picture. A model on this computer says so itself (Ollama's
// capabilities, LM Studio's), asked once; others are known by name. A sign-in's one-shot mode takes
// words only, and so does the local model built in (it runs without Gemma's picture part).
const SEES = /claude|gpt-4o|gpt-4\.1|gpt-5|\bo[34]\b|o[34]-|gemini|grok-(2-vision|4)|pixtral|llava|vision|[-_.]vl\b|vl[-:]|qwen[\d.]*-?vl|gemma-?3|minicpm-v|moondream|llama-?4|mistral-(small|medium)-3|nova-(pro|lite|premier)|glm-4\.\dv/i
const seeing = new Map()
export async function canSee(id) {
  const [route, ...rest] = String(id || '').split(':')
  const model = rest.join(':')
  if (!model || route === 'cli' || route === 'bridge') return false
  if (seeing.has(id)) return seeing.get(id)
  let yes = SEES.test(model)
  if (route === 'ollama' || route === 'lmstudio') yes = await localInfo(id).then((i) => i?.vision ?? yes).catch(() => yes)
  seeing.set(id, yes)
  return yes
}

// ---------- Each provider's shape ----------
function openaiMessages(messages, system) {
  const out = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.id, content: m.text || '' })
    else if (pictures(m).length) out.push({ role: 'user', content: [{ type: 'text', text: m.text || '' }, ...pictures(m).map((url) => ({ type: 'image_url', image_url: { url } }))] })
    else if (m.role === 'assistant' && m.calls?.length) out.push({ role: 'assistant', content: m.text || null, tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) })
    else out.push({ role: m.role, content: m.text || '' })
  }
  return out
}
// A thinking model's reasoning, when it comes back in the answer itself: <think>…</think> blocks, as
// Qwen and DeepSeek's open models write them; reasoning that ends in </think> with no <think> before
// it (the chat template put that in the prompt); or a <think> never closed (all of it was reasoning).
export const unthink = (s) => String(s || '')
  .replace(/^(?:(?!<(?:think|thinking)>)[\s\S])*?<\/(think|thinking)>/i, '')
  .replace(/<(think|thinking)>[\s\S]*?(<\/\1>|$)/gi, '')
  .trim()

// json: a JSON schema the answer is held to (response_format), for providers that take one. One that
// turns it down gets the question again without it, as plain text.
// extra: more of the request, for one server's own fields (llama-server's chat_template_kwargs).
// onStats: told how fast it read and wrote, when the server says (llama-server's timings).
async function openaiStyle(who, url, headers, model, messages, { signal, tools, system, json, strict = false, ms, extra, onStats }) {
  const body = { model, messages: openaiMessages(messages, system), ...extra }
  if (tools?.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  if (json) body.response_format = { type: 'json_schema', json_schema: { name: 'answer', ...(strict ? { strict: true } : {}), schema: json } }
  const r = await fetch(url, { method: 'POST', signal: until(signal, ms), headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok && json && (r.status === 400 || r.status === 422) && !tooLongSaid(j)) return openaiStyle(who, url, headers, model, messages, { signal, tools, system, ms, extra, onStats })
  if (!r.ok) throw Object.assign(failed(who, r.status, j), { body: j })
  if (j.timings && onStats) onStats(j.timings)
  const msg = j.choices?.[0]?.message || {}
  let text = unthink(msg.content)
  if (Array.isArray(j.citations) && j.citations.length) text += `\n\nSources:\n${j.citations.map((u, i) => `[${i + 1}] ${u}`).join('\n')}`
  const calls = (msg.tool_calls || []).filter((c) => c.function?.name).map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.function.name, args: parseArgs(c.function.arguments) }))
  if (!text && !calls.length) throw new Error(msg.content || msg.reasoning_content || msg.reasoning ? `${who} only thought, and sent back no answer` : `${who} sent back an empty answer`)
  return { text, calls, usage: usagelog.usageOf(j) }
}
const bearer = (k) => (k ? { authorization: `Bearer ${k}` } : {})

// Anthropic's Messages API (also Claude on Vertex): one role at a time, tool results first.
function anthropicMessages(messages) {
  const out = []
  const add = (role, block) => { const last = out.at(-1); if (last?.role === role) last.content.push(block); else out.push({ role, content: [block] }) }
  for (const m of messages) {
    if (m.role === 'tool') add('user', { type: 'tool_result', tool_use_id: m.id, content: m.text || '', ...(m.error && { is_error: true }) })
    else if (m.role === 'assistant') {
      if (m.text) add('assistant', { type: 'text', text: m.text })
      for (const c of m.calls || []) add('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args || {} })
    } else {
      for (const url of pictures(m)) add('user', { type: 'image', source: { type: 'base64', media_type: url.slice(5, url.indexOf(';')), data: url.slice(url.indexOf(',') + 1) } })
      if (m.text) add('user', { type: 'text', text: m.text })
    }
  }
  for (const m of out) if (m.role === 'user') m.content.sort((a, b) => (a.type === 'tool_result' ? 0 : 1) - (b.type === 'tool_result' ? 0 : 1))
  return out
}
async function anthropicStyle(who, url, headers, body0, messages, { signal, tools, system }) {
  const body = { ...body0, max_tokens: 8192, system, messages: anthropicMessages(messages) }
  if (tools?.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
  const r = await fetch(url, { method: 'POST', signal: until(signal), headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw failed(who, r.status, j)
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim()
  const calls = (j.content || []).filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, args: c.input || {} }))
  if (!text && !calls.length) throw new Error(`${who} sent back an empty answer`)
  return { text, calls, usage: usagelog.usageOf(j) }
}

// Bedrock's Converse API: content blocks keyed by kind ({ text }, { toolUse }, { toolResult }).
function converseMessages(messages) {
  const out = []
  const add = (role, block) => { const last = out.at(-1); if (last?.role === role) last.content.push(block); else out.push({ role, content: [block] }) }
  for (const m of messages) {
    if (m.role === 'tool') add('user', { toolResult: { toolUseId: m.id, content: [{ text: m.text || '(no output)' }], status: m.error ? 'error' : 'success' } })
    else if (m.role === 'assistant') {
      if (m.text) add('assistant', { text: m.text })
      for (const c of m.calls || []) add('assistant', { toolUse: { toolUseId: c.id, name: c.name, input: c.args || {} } })
    } else {
      for (const url of pictures(m)) add('user', { image: { format: url.slice(11, url.indexOf(';')), source: { bytes: url.slice(url.indexOf(',') + 1) } } })
      if (m.text) add('user', { text: m.text })
    }
  }
  for (const m of out) if (m.role === 'user') m.content.sort((a, b) => (a.toolResult ? 0 : 1) - (b.toolResult ? 0 : 1))
  return out
}
async function converse(model, messages, { signal, tools, system }) {
  const body = { messages: converseMessages(messages), system: [{ text: system }], inferenceConfig: { maxTokens: 8192 } }
  if (tools?.length) body.toolConfig = { tools: tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.parameters } } })) }
  const j = await bedrock('bedrock-runtime', `/model/${enc(model)}/converse`, { method: 'POST', body, signal })
  const content = j.output?.message?.content || []
  const text = content.filter((c) => typeof c.text === 'string').map((c) => c.text).join('\n').trim()
  const calls = content.filter((c) => c.toolUse).map((c) => ({ id: c.toolUse.toolUseId, name: c.toolUse.name, args: c.toolUse.input || {} }))
  if (!text && !calls.length) throw new Error(`AWS Bedrock sent back an empty answer${j.stopReason ? ` (${j.stopReason})` : ''}`)
  return { text, calls, usage: usagelog.usageOf(j) }
}

// ---------- Models on this computer ----------
// Ollama and LM Studio run a model with a context (how much it reads at a time) that is often far
// smaller than what the model takes: Ollama's is 4,096 tokens on most computers, and its
// OpenAI-style API can't be asked for more. A prompt longer than that loses its start without a
// word (Ollama keeps the first four tokens and the last half of the context, and answers as if
// that was all). So Bridge AI reads what each model takes (Ollama's /api/show, LM Studio's model
// list), talks to Ollama through its own API with a context that fits each request
// (options.num_ctx, in a few steps, as each new size reloads the model), tells Ollama to refuse
// rather than cut a one-off job's prompt, and says so when a job can't fit. Models that think
// before they answer (Qwen3.5 and others) are asked not to for Bridge AI's own jobs, which would
// otherwise wait on minutes of reasoning nobody reads; a chat leaves that to the model.
export const isLocal = (id) => /^(ollama|lmstudio|bridge):/.test(String(id || ''))
const LMS_ROOT = () => LMSTUDIO().replace(/\/v1$/, '')
// LM Studio picks a model's context when it loads it (4,096 tokens unless you set more for that
// model), and its API can't change it per request: until it's loaded, Bridge AI plans for that.
const LMS_UNLOADED = 4096
// The room left for the answer.
export const ANSWER = 2048
// About 3.2 characters a token in English with timestamps (a little under what tokenizers give, so
// a piece never comes out too big), and about one a character in Chinese, Japanese and Korean.
export function tokensOf(s) {
  const t = String(s || '')
  const wide = (t.match(/[　-鿿가-힯豈-﫿＀-￯]/g) || []).length
  return Math.ceil((t.length - wide) / 3.2 + wide * 1.2)
}
// The most context to ask Ollama for, from this computer's memory: a long one takes memory of its
// own on top of the model's (a 32K context, about 2 to 4 GB for a 4 to 8B model).
const ceiling = (memGB) => (memGB >= 48 ? 65536 : memGB >= 24 ? 32768 : memGB >= 12 ? 16384 : 8192)
const STEPS = [8192, 16384, 32768, 65536, 131072, 262144]
const billions = (s) => { const m = /([\d.]+)\s*([BM])\b/i.exec(String(s || '')); return m ? Number(m[1]) / (m[2].toUpperCase() === 'M' ? 1000 : 1) : null }

async function ollamaInfo(model) {
  const [show, ps] = await Promise.all([postJSON(`${OLLAMA()}/api/show`, { model }), getJSON(`${OLLAMA()}/api/ps`, {}, 1500).catch(() => ({}))])
  const mi = show.model_info || {}
  const max = Number(mi[`${mi['general.architecture']}.context_length`] ?? Object.entries(mi).find(([k]) => /\.context_length$/.test(k))?.[1]) || null
  const run = (ps.models || []).find((m) => m.name === model || m.model === model)
  const caps = show.capabilities || []
  return { max, loaded: Number(run?.context_length) || null, thinks: caps.includes('thinking'), vision: caps.includes('vision'), billions: billions(show.details?.parameter_size), gpu: run && run.size_vram != null ? Number(run.size_vram) > 0 : null }
}
async function lmsInfo(model) {
  const j = await getJSON(`${LMS_ROOT()}/api/v1/models`, {}, 2000).catch(() => null)
  const m = (j?.models || []).find((x) => x.key === model || (x.loaded_instances || []).some((i) => i.id === model))
  if (m) {
    const inst = (m.loaded_instances || []).find((i) => i.id === model) || m.loaded_instances?.[0]
    const r = m.capabilities?.reasoning
    return { max: Number(m.max_context_length) || null, loaded: Number(inst?.config?.context_length) || null, thinks: !!r, canStop: (r?.allowed_options || []).includes('off'), vision: !!m.capabilities?.vision, billions: billions(m.params_string), gpu: null }
  }
  // An older LM Studio: only its first REST API, which may not say the context it loaded.
  const v0 = await getJSON(`${LMS_ROOT()}/api/v0/models/${encodeURIComponent(model)}`, {}, 2000)
  return { max: Number(v0.max_context_length) || null, loaded: Number(v0.loaded_context_length) || null, thinks: false, vision: v0.type === 'vlm', billions: null, gpu: null }
}
const infos = new Map() // id -> { at, value }
// What a model on this computer takes: { max, loaded, thinks, canStop, vision, billions, gpu }, or
// null when its server doesn't say. Kept two minutes.
export async function localInfo(id, { fresh = false } = {}) {
  if (!isLocal(id)) return null
  const was = infos.get(id)
  if (!fresh && was && Date.now() - was.at < 2 * 60 * 1000) return was.value
  const [route, ...rest] = String(id).split(':')
  if (route === 'bridge') return bridgeInfo()
  const value = await (route === 'ollama' ? ollamaInfo : lmsInfo)(rest.join(':')).catch(() => null)
  infos.set(id, { at: Date.now(), value })
  return value
}
// The local model built in: what it reads at a time on this computer, whether it's loaded now, and
// whether it has a GPU here (Metal on Apple Silicon, Vulkan where llama.cpp found one). Its speed is
// guessed from its 2.3 billion effective parameters until it's been used.
async function bridgeInfo() {
  const f = await llm.fit()
  const m = f.machine
  const gpu = f.gpu ? true : m.platform === 'darwin' ? m.arch === 'arm64' : m.docker ? false : null
  return { max: llm.MODELS[0].context, loaded: llm.loaded() ? await llm.context() : null, thinks: false, canStop: true, vision: false, billions: 2.3, gpu }
}
// How many tokens one request to a model on this computer can hold (null for any other model):
// Ollama's, as much as the model takes up to what this computer's memory holds (or more, when it's
// already running with more); LM Studio's, the context it loaded the model with.
export async function contextOf(id) {
  if (!isLocal(id)) return null
  const i = await localInfo(id)
  if (String(id).startsWith('lmstudio:')) return i?.loaded || Math.min(i?.max || LMS_UNLOADED, LMS_UNLOADED)
  if (String(id).startsWith('bridge:')) return llm.context()
  return Math.max(Math.min(i?.max || 8192, ceiling((await machine()).memGB)), i?.loaded || 0)
}
// The context to ask Ollama for: the one it's running with when that's enough (a new size reloads
// the model), else the next step up, within the most it takes.
const ctxFor = (need, i, cap) => (i?.loaded && i.loaded >= need ? i.loaded : Math.min(cap, STEPS.find((s) => s >= need) || cap))
const fmtK = (n) => (n >= 1024 ? `${Math.round(n / 1024)}K` : String(n))
function tooLong(id, ctx, need) {
  const [route, ...rest] = String(id).split(':')
  const how = route === 'lmstudio' ? 'Load it with a longer context in LM Studio (the model\'s Context Length), or pick another model.' : 'Pick a model with a longer context, or one on a computer with more memory.'
  const name = route === 'bridge' ? llm.MODELS[0].label : rest.join(':')
  return Object.assign(new Error(`${name} takes ${fmtK(ctx)} tokens at a time, and this needs about ${fmtK(need)}. ${how}`), { code: 'too_long', context: ctx, need })
}
const tooLongSaid = (j) => /context (length|size|window)|exceeds the available context|longer than the context|too many tokens|n_ctx/i.test(JSON.stringify(j?.error || j?.message || ''))

// How fast a model on this computer is here: measured once it's been used (Ollama and LM Studio say
// how fast they read and wrote), else a guess for this kind of computer, for a 4B model: Apple
// Silicon's GPU, or a processor alone (an Intel Mac; Ollama runs on its processor only). Elsewhere,
// whether there's a GPU it can use shows once a model is running.
const speeds = new Map() // id -> { read, write } tokens a second
function measured(id, read, write) {
  const was = speeds.get(id)
  const mix = (a, b) => (a && b ? Math.round((a + b) / 2) : Math.round(a || b || 0) || null)
  speeds.set(id, { read: mix(was?.read, read), write: mix(was?.write, write) })
}
async function pace(id) {
  const m = await machine()
  const i = await localInfo(id)
  const appleGpu = m.platform === 'darwin' && (m.arch === 'arm64' || m.rosetta)
  const gpu = i?.gpu ?? (m.platform === 'darwin' ? appleGpu : m.docker ? false : null)
  const s = speeds.get(id)
  if (s?.read && s?.write) return { ...s, measured: true, gpu }
  const scale = Math.max(1, (i?.billions || 4) / 4)
  const guess = gpu ? { read: 300, write: 25 } : { read: 40, write: 8 }
  return { read: Math.round(guess.read / scale), write: Math.round(guess.write / scale), measured: false, gpu, sure: gpu != null }
}
// How long a request of text (and an answer of about out tokens) takes on this model here, in
// seconds: { seconds, measured, gpu, sure, billions }. sure: false when it's only a guess.
export async function estimate(id, text, out = 800) {
  if (!isLocal(id)) return null
  const p = await pace(id)
  const i = await localInfo(id)
  return { seconds: Math.round(3 + tokensOf(text) / p.read + out / p.write), measured: p.measured, gpu: p.gpu, sure: p.measured || p.sure, billions: i?.billions || null }
}
// Long enough for this computer: a processor alone can take many minutes over a long prompt, so the
// usual five minutes would end work that was going fine. Up to 45.
async function callTime(id, text, out) {
  const e = await estimate(id, text, out)
  return Math.min(45 * 60, Math.max(TIMEOUT / 1000, e.seconds * 3 + 60)) * 1000
}
const allText = (messages, system, tools) => `${system || ''}\n${messages.map((m) => `${m.text || ''}${m.calls ? JSON.stringify(m.calls) : ''}`).join('\n')}${tools?.length ? JSON.stringify(tools) : ''}`

// Ollama's own chat API: the context set, thinking off, the schema as `format`, pictures as `images`.
function ollamaMessages(messages, system) {
  const out = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', content: m.text || '', tool_name: m.name })
    else if (m.role === 'assistant' && m.calls?.length) out.push({ role: 'assistant', content: m.text || '', tool_calls: m.calls.map((c) => ({ function: { name: c.name, arguments: c.args || {} } })) })
    else out.push({ role: m.role, content: m.text || '', ...(pictures(m).length ? { images: pictures(m).map((u) => u.slice(u.indexOf(',') + 1)) } : {}) })
  }
  return out
}
async function ollamaChat(model, messages, o) {
  const id = `ollama:${model}`
  const [i, cap] = [await localInfo(id), await contextOf(id)]
  const text = allText(messages, o.system, o.tools)
  const need = tokensOf(text) + ANSWER
  // One message is one of Bridge AI's jobs (notes, a question): all of it or nothing. A chat may lose
  // its oldest turns, as Ollama does, to keep going.
  const one = messages.length === 1
  if (one && need > cap * 1.15) throw tooLong(id, cap, need)
  const body = { model, messages: ollamaMessages(messages, o.system), stream: false, options: { num_ctx: ctxFor(need, i, cap) } }
  if (one) body.truncate = false
  // Turning thinking off is safe on a model that doesn't think (only asking one to think is refused).
  if (!o.think && i?.thinks !== false) body.think = false
  if (o.json) body.format = o.json
  if (o.tools?.length) body.tools = o.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  const r = await fetch(`${OLLAMA()}/api/chat`, { method: 'POST', signal: until(o.signal, await callTime(id, text, 800)), headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  // Something at that address that speaks only the OpenAI-style API (a proxy, another server).
  if (r.status === 404 && !/model/i.test(String(j.error || ''))) return openaiStyle('Ollama', `${OLLAMA()}/v1/chat/completions`, {}, model, messages, o)
  if (!r.ok && tooLongSaid(j)) throw tooLong(id, body.options.num_ctx, need)
  if (!r.ok) throw failed('Ollama', r.status, j)
  if (j.prompt_eval_count > 200 || j.eval_count > 50) measured(id, j.prompt_eval_count > 200 && j.prompt_eval_duration ? j.prompt_eval_count / (j.prompt_eval_duration / 1e9) : null, j.eval_count > 50 && j.eval_duration ? j.eval_count / (j.eval_duration / 1e9) : null)
  const msg = j.message || {}
  const out = unthink(msg.content)
  const calls = (msg.tool_calls || []).filter((c) => c.function?.name).map((c, n) => ({ id: c.id || `call_${Date.now().toString(36)}_${n}`, name: c.function.name, args: parseArgs(c.function.arguments) }))
  if (!out && !calls.length) throw new Error(msg.thinking || msg.content ? `${model} only thought, and sent back no answer` : 'Ollama sent back an empty answer')
  return { text: out, calls, usage: usagelog.usageOf(j) }
}

// LM Studio: its OpenAI-style API (tools, a schema held to with `strict`), or for a plain one-off
// job on a model that thinks, its own chat API, the only one that can turn thinking off.
async function lmsChat(model, messages, o) {
  const id = `lmstudio:${model}`
  const [i, cap] = [await localInfo(id), await contextOf(id)]
  const text = allText(messages, o.system, o.tools)
  const need = tokensOf(text) + ANSWER
  const one = messages.length === 1
  if (one && need > cap * 1.15) throw tooLong(id, cap, need)
  const ms = await callTime(id, text, 800)
  if (one && !o.think && !o.json && !o.tools?.length && !pictures(messages[0]).length && i?.canStop) {
    const r = await fetch(`${LMS_ROOT()}/api/v1/chat`, { method: 'POST', signal: until(o.signal, ms), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, system_prompt: o.system, input: messages[0].text || '', reasoning: 'off', stream: false, store: false }) }).catch((e) => { if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e; return null })
    const j = r ? await r.json().catch(() => ({})) : {}
    if (r?.ok) {
      const s = j.stats || {}
      measured(id, s.input_tokens > 200 && s.time_to_first_token_seconds ? s.input_tokens / s.time_to_first_token_seconds : null, s.total_output_tokens > 50 ? s.tokens_per_second : null)
      const out = unthink((j.output || []).filter((x) => x.type === 'message').map((x) => x.content).join('\n'))
      if (out) return { text: out, calls: [], usage: usagelog.usageOf(j) }
      throw new Error(`${model} sent back an empty answer`)
    }
    if (r && tooLongSaid(j)) throw tooLong(id, cap, need)
    // Anything else (an LM Studio without that API, a setting it turns down): the OpenAI-style API.
  }
  try { return await openaiStyle('LM Studio', `${LMSTUDIO()}/chat/completions`, {}, model, messages, { ...o, strict: true, ms }) } catch (e) {
    if (/context|n_ctx|too many tokens/i.test(e.message)) throw tooLong(id, cap, need)
    throw e
  }
}

// The local model built in (llm.js): llama-server's OpenAI-style API with its key, started if it isn't
// running, thinking off unless a chat lets it (chat_template_kwargs, as Gemma's and Qwen's templates
// read it), and how fast it read and wrote noted from its timings.
async function builtinChat(messages, o) {
  const id = llm.ID
  const cap = await llm.context()
  const text = allText(messages, o.system, o.tools)
  const need = tokensOf(text) + ANSWER
  if (messages.length === 1 && need > cap * 1.15) throw tooLong(id, cap, need)
  const ms = await callTime(id, text, 800)
  try {
    return await llm.use(({ url, key }) => openaiStyle('The local model', `${url}/v1/chat/completions`, bearer(key), 'bridge', messages, {
      ...o, ms, extra: { chat_template_kwargs: { enable_thinking: !!o.think } },
      onStats: (t) => measured(id, t.prompt_n > 200 ? t.prompt_per_second : null, t.predicted_n > 50 ? t.predicted_per_second : null),
    }))
  } catch (e) {
    if (tooLongSaid(e.body)) throw tooLong(id, cap, need)
    throw e
  }
}

// The model on this computer for Bridge AI's jobs that must stay here (the Chief of Staff's "local",
// Insights, pull request descriptions): the one picked in Settings › Model Providers, else one
// that's running already (no wait for it to load), else the first. { id, label, provider, picked,
// missing }: missing, a pick that isn't there now (Ollama or LM Studio closed, the model removed).
// The local model built in comes after your own Ollama's and LM Studio's.
export async function localModel(pick) {
  const list = (await models()).filter((m) => m.via === 'local').sort((a, b) => !!a.builtin - !!b.builtin)
  const hit = pick && list.find((m) => m.id === pick)
  if (hit) return { ...hit, picked: true, missing: null }
  let best = null
  for (const m of list) if (!m.builtin && (await localInfo(m.id))?.loaded) { best = m; break }
  best ||= list[0]
  return best ? { ...best, picked: false, missing: pick || null } : null
}
// Every model on this computer as Settings › Model Providers shows it: how much each takes at a time,
// whether it thinks, how big it is and how fast it's been here, and the one Bridge AI's jobs use.
export async function localModels(pick) {
  const list = (await models({ fresh: true })).filter((m) => m.via === 'local')
  const out = await Promise.all(list.map(async (x) => {
    const i = await localInfo(x.id, { fresh: true })
    const e = await estimate(x.id, '', 0)
    return { id: x.id, label: x.label, provider: x.provider, builtin: !!x.builtin, context: await contextOf(x.id), max: i?.max ?? null, loaded: i?.loaded ?? null, thinks: !!i?.thinks, billions: i?.billions ?? null, speed: speeds.get(x.id) || null, gpu: e?.gpu ?? null }
  }))
  const using = await localModel(pick).catch(() => null)
  return { models: out, pick: pick || null, using: using?.id || null, smallest: SMALLEST }
}
// Below this, meeting notes can't be written well: the instructions and the room for the answer
// alone take a quarter of it (meetings.js).
export const SMALLEST = 8192

// ---------- A reply ----------
// The model's next turn: { text, calls }. tools: [{ name, description, parameters }] (JSON Schema).
// json: a JSON Schema to hold the answer to, where the provider takes one (Ollama's format, LM
// Studio's and OpenAI-style APIs' response_format); others answer in plain text, as asked.
// think: let a model that thinks before answering do so (a chat); Bridge AI's own jobs don't wait.
// feature: the part of Bridge AI asking (usagelog.js FEATURES), noted with what the answer took.
export async function reply(id, messages, { signal, tools, system = SYSTEM, json = null, think = false, feature = null } = {}) {
  if (hiddenModel(id)) throw new Error(OFF)
  const started = Date.now()
  const { usage, ...r } = await answer(id, messages, { signal, tools: canUseTools(id) ? tools : null, system, json, think })
  usagelog.record({ id, feature, usage, ms: Date.now() - started })
  // The usage counts, when they're shared: the model's family, how it was reached, what asked.
  counts.answered(id, feature, usage?.model).catch(() => {})
  return r
}
async function answer(id, messages, o) {
  const { signal, system } = o
  const [route, ...rest] = String(id || '').split(':')
  const model = rest.join(':')
  if (route === 'cli') {
    if (!CLI[model]) throw new Error(`Can't chat through ${model}`)
    const r = await oneShot(model, asTranscript(messages, system), null, {}, signal)
    const text = String(r.text).trim()
    if (!text) throw new Error(`${adapter(model).label} sent back an empty answer`)
    return { text, calls: [], usage: r.usage }
  }
  if (route === 'anthropic') {
    const key = keyFor(API.anthropic)
    if (!key) throw new Error('No Anthropic key saved. Add one in Settings › Model Providers.')
    return anthropicStyle('Anthropic', `${anthropicUrl()}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model }, messages, o)
  }
  if (route === 'ollama') return ollamaChat(model, messages, o)
  if (route === 'lmstudio') return lmsChat(model, messages, o)
  if (route === 'bridge') return builtinChat(messages, o)
  if (MORE[route]) {
    const key = env()[MORE[route].key]
    if (!key) throw new Error(`No ${MORE[route].label} key saved. Add one in Settings › Model Providers.`)
    return openaiStyle(MORE[route].label, `${MORE[route].base()}/chat/completions`, bearer(key), model, messages, o)
  }
  if (route === 'azure') {
    const a = azure()
    if (!a.key || !a.endpoint) throw new Error('Azure OpenAI needs its key and endpoint. Add them in Settings › Model Providers.')
    // A dated API version: the deployment's own URL. Otherwise the v1 API, with the deployment as the model.
    const dated = /^\d{4}-\d{2}-\d{2}/.test(a.version)
    const url = dated ? `${a.endpoint}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(a.version)}` : `${a.endpoint}/openai/v1/chat/completions`
    return openaiStyle(PROVIDER.azure, url, { 'api-key': a.key }, model, messages, o)
  }
  if (route === 'bedrock') return converse(model, messages, o)
  if (route === 'vertex') {
    const v = vertex()
    if (!v.project) throw new Error('Vertex AI needs your Google Cloud project. Add it in Settings › Model Providers.')
    const headers = await vertexHeaders()
    if (/^claude/.test(model)) return anthropicStyle(PROVIDER.vertex, `${v.root}/publishers/anthropic/models/${encodeURIComponent(model)}:rawPredict`, headers, { anthropic_version: 'vertex-2023-10-16' }, messages, o)
    return openaiStyle(PROVIDER.vertex, `${v.root}/endpoints/openapi/chat/completions`, headers, model, messages, o)
  }
  const a = API[route]
  if (!a || a.local || a.anthropic) throw new Error(`Unknown model "${id}". Type /models to see what you can use.`)
  const key = keyFor(a)
  if (!key) throw new Error(`No ${a.label} key saved. Add one in Settings › Model Providers.`)
  const base = route === 'openai' ? trim(env().OPENAI_BASE_URL || a.base) : a.base
  return openaiStyle(PROVIDER[route] || a.label, `${base}/chat/completions`, bearer(key), model, messages, o)
}
