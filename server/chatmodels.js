// The models a chat (chatagent.js) can talk to, and how to talk to each. One list across every way
// you can reach a model:
//   your sign-in to an agent (Claude Code, Codex, Gemini CLI, ...), in its one-shot mode, so a
//     subscription works with nothing more to set up;
//   an API key saved in Settings › Model providers (or in your environment), clouds included
//     (Azure OpenAI, AWS Bedrock, Google Vertex AI);
//   a model server on this computer (Ollama, LM Studio).
// A model is named "<route>:<model>": "cli:gemini", "openai:gpt-5", "ollama:llama3.2". Any model
// the provider has can be used by name, not only the ones listed.
//
// The conversation goes in as [{ role: 'user'|'assistant'|'tool', text, calls?, id?, name?, error? }]:
// an assistant turn may call tools (calls: [{ id, name, args }]) and each call's result comes back
// as a 'tool' turn. reply() turns that into each provider's own shape (OpenAI-style, Anthropic,
// Bedrock's Converse) and returns { text, calls }. A sign-in's one-shot mode has no tools.
// Request shapes from each provider's docs: platform.claude.com (tool use), developers.openai.com
// (function calling), docs.cohere.com/docs/compatibility-api, docs.z.ai, huggingface.co/docs/
// inference-providers, learn.microsoft.com (Azure OpenAI v1), docs.aws.amazon.com/bedrock (Converse,
// API keys, SigV4), docs.cloud.google.com/vertex-ai (OpenAI-compatible endpoint, Claude rawPredict).
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { API, CLI, keyFor, runCli } from './consult.js'
import { installed, adapter, loginPath } from './agents.js'
import { providerEnv, subscriptions, keysStamp } from './providers.js'
import { moreOn, hiddenModel, OFF } from './labs.js'

const TIMEOUT = 5 * 60 * 1000
const until = (signal) => (AbortSignal.any && signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : signal || AbortSignal.timeout(TIMEOUT)) // any(): Node 20+
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
  // A Coding Plan key has its own base URL (Settings › Model providers › Z.ai).
  zai: { label: 'Z.ai (GLM)', base: () => trim(env().ZAI_BASE_URL) || 'https://api.z.ai/api/paas/v4', key: 'ZAI_API_KEY', fixed: ['glm-5.3', 'glm-5.3-flash', 'glm-4.7'] },
  // Models any live provider serves; "org/model:provider" picks one.
  huggingface: {
    label: 'Hugging Face', base: () => 'https://router.huggingface.co/v1', key: 'HF_TOKEN',
    list: (k) => getJSON('https://router.huggingface.co/v1/models', { authorization: `Bearer ${k}` }).then((j) => (j.data || []).filter((m) => (m.providers || []).some((p) => p.status === 'live')).map((m) => m.id)),
  },
}
const LMSTUDIO = () => trim(env().LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1')
const OLLAMA = () => { const h = env().OLLAMA_HOST || 'http://127.0.0.1:11434'; return trim(/^https?:\/\//.test(h) ? h : `http://${h}`) }
const PROVIDER = { anthropic: 'Anthropic', openai: 'OpenAI', xai: 'xAI', meta: 'Meta', gemini: 'Google', perplexity: 'Perplexity', openrouter: 'OpenRouter', deepseek: 'DeepSeek', mistral: 'Mistral', groq: 'Groq', azure: 'Azure OpenAI', bedrock: 'AWS Bedrock', vertex: 'Google Vertex AI', ollama: 'Ollama, on this computer', lmstudio: 'LM Studio, on this computer' }
// What a CLI's one-shot answer comes from, said the way people know it.
const VIA = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', cursor: 'Cursor', copilot: 'GitHub Copilot', opencode: 'OpenCode', qwen: 'Qwen' }

const getJSON = async (url, headers = {}, ms = 2500) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
// Not chat models, in an OpenAI-style model list.
const NOT_CHAT = /embed|whisper|tts|dall-e|audio|realtime|moderation|image|transcri|search|davinci|babbage|rerank|guard|vision-preview/i

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
  if (a.none) throw new Error(a.sso ? 'Your AWS profile signs in with SSO, which Bridge AI can\'t use yet. Add a Bedrock API key in Settings › Model providers instead.' : 'No AWS access keys or Bedrock API key found. Add a Bedrock API key in Settings › Model providers.')
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
    if (!r.ok || !j.access_token) throw new Error(`Google turned down the service account (${j.error_description || j.error || `HTTP ${r.status}`}). Check the file in Settings › Model providers › Vertex AI.`)
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
    if (!value) throw new Error('No Google Cloud login found. Add a service account file in Settings › Model providers › Vertex AI, or run "gcloud auth application-default login".')
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
  if (!fresh && cache.list && cache.keys === keysStamp() && cache.more === moreOn() && Date.now() - cache.at < 60 * 1000) return cache.list
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
    getJSON(`${OLLAMA()}/api/tags`, {}, 1200).then((j) => (j.models || []).map((m) => ({ id: `ollama:${m.name}`, label: m.name, provider: PROVIDER.ollama, via: 'local' }))).catch(() => []),
    getJSON(`${LMSTUDIO()}/models`, {}, 1200).then((j) => (j.data || []).map((m) => m.id).filter((x) => x && !NOT_CHAT.test(x)).map((x) => ({ id: `lmstudio:${x}`, label: x, provider: PROVIDER.lmstudio, via: 'local' }))).catch(() => []),
  ])
  for (const l of lists) out.push(...l)
  const list = out.filter((m) => !hiddenModel(m.id))
  cache = { at: Date.now(), list, keys: keysStamp(), more: moreOn() }
  return list
}

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
  if (status === 401 || status === 403) return Object.assign(new Error(`${who} turned the key down (${msg}). Check it in Settings › Model providers.`), { status })
  if (status === 404) return Object.assign(new Error(`${who} doesn't know that model (${msg}). Pick another with /model.`), { status })
  if (status === 429) return Object.assign(new Error(`${who} says you're over your limit for now (${msg}). Try again later, or pick another model with /model.`), { status })
  return Object.assign(new Error(`${who}: ${msg}`), { status })
}
const parseArgs = (s) => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}') } catch { return { _unparsed: String(s || '') } } }

// ---------- Each provider's shape ----------
function openaiMessages(messages, system) {
  const out = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.id, content: m.text || '' })
    else if (m.role === 'assistant' && m.calls?.length) out.push({ role: 'assistant', content: m.text || null, tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) })
    else out.push({ role: m.role, content: m.text || '' })
  }
  return out
}
async function openaiStyle(who, url, headers, model, messages, { signal, tools, system }) {
  const body = { model, messages: openaiMessages(messages, system) }
  if (tools?.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
  const r = await fetch(url, { method: 'POST', signal: until(signal), headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw failed(who, r.status, j)
  const msg = j.choices?.[0]?.message || {}
  let text = String(msg.content || '').trim()
  if (Array.isArray(j.citations) && j.citations.length) text += `\n\nSources:\n${j.citations.map((u, i) => `[${i + 1}] ${u}`).join('\n')}`
  const calls = (msg.tool_calls || []).filter((c) => c.function?.name).map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.function.name, args: parseArgs(c.function.arguments) }))
  if (!text && !calls.length) throw new Error(`${who} sent back an empty answer`)
  return { text, calls }
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
    } else if (m.text) add('user', { type: 'text', text: m.text })
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
  return { text, calls }
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
    } else if (m.text) add('user', { text: m.text })
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
  return { text, calls }
}

// ---------- A reply ----------
// The model's next turn: { text, calls }. tools: [{ name, description, parameters }] (JSON Schema).
export async function reply(id, messages, { signal, tools, system = SYSTEM } = {}) {
  if (hiddenModel(id)) throw new Error(OFF)
  const [route, ...rest] = String(id || '').split(':')
  const model = rest.join(':')
  const o = { signal, tools: canUseTools(id) ? tools : null, system }
  if (route === 'cli') {
    if (!CLI[model]) throw new Error(`Can't chat through ${model}`)
    const text = String(await runCli(model, asTranscript(messages, system), null, {}, signal)).trim()
    if (!text) throw new Error(`${adapter(model).label} sent back an empty answer`)
    return { text, calls: [] }
  }
  if (route === 'anthropic') {
    const key = keyFor(API.anthropic)
    if (!key) throw new Error('No Anthropic key saved. Add one in Settings › Model providers.')
    return anthropicStyle('Anthropic', 'https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model }, messages, o)
  }
  if (route === 'ollama') return openaiStyle('Ollama', `${OLLAMA()}/v1/chat/completions`, {}, model, messages, o)
  if (route === 'lmstudio') return openaiStyle('LM Studio', `${LMSTUDIO()}/chat/completions`, {}, model, messages, o)
  if (MORE[route]) {
    const key = env()[MORE[route].key]
    if (!key) throw new Error(`No ${MORE[route].label} key saved. Add one in Settings › Model providers.`)
    return openaiStyle(MORE[route].label, `${MORE[route].base()}/chat/completions`, bearer(key), model, messages, o)
  }
  if (route === 'azure') {
    const a = azure()
    if (!a.key || !a.endpoint) throw new Error('Azure OpenAI needs its key and endpoint. Add them in Settings › Model providers.')
    // A dated API version: the deployment's own URL. Otherwise the v1 API, with the deployment as the model.
    const dated = /^\d{4}-\d{2}-\d{2}/.test(a.version)
    const url = dated ? `${a.endpoint}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(a.version)}` : `${a.endpoint}/openai/v1/chat/completions`
    return openaiStyle(PROVIDER.azure, url, { 'api-key': a.key }, model, messages, o)
  }
  if (route === 'bedrock') return converse(model, messages, o)
  if (route === 'vertex') {
    const v = vertex()
    if (!v.project) throw new Error('Vertex AI needs your Google Cloud project. Add it in Settings › Model providers.')
    const headers = await vertexHeaders()
    if (/^claude/.test(model)) return anthropicStyle(PROVIDER.vertex, `${v.root}/publishers/anthropic/models/${encodeURIComponent(model)}:rawPredict`, headers, { anthropic_version: 'vertex-2023-10-16' }, messages, o)
    return openaiStyle(PROVIDER.vertex, `${v.root}/endpoints/openapi/chat/completions`, headers, model, messages, o)
  }
  const a = API[route]
  if (!a || a.local || a.anthropic) throw new Error(`Unknown model "${id}". Type /models to see what you can use.`)
  const key = keyFor(a)
  if (!key) throw new Error(`No ${a.label} key saved. Add one in Settings › Model providers.`)
  const base = route === 'openai' ? trim(env().OPENAI_BASE_URL || a.base) : a.base
  return openaiStyle(PROVIDER[route] || a.label, `${base}/chat/completions`, bearer(key), model, messages, o)
}
