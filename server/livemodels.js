// Each model provider's own list of its models, for the ones you've saved a key for, and the models a
// provider has retired. chatmodels.js shows a provider's list wherever you pick a model (a chat,
// Models for Each Task, a bot's What Answers), and falls back on a short list of its own when there's
// no key, the provider can't be reached, or it has no list to ask (Perplexity, Z.ai).
//
// A list is asked of the provider's models endpoint with your key, kept in Bridge AI's cache folder,
// and asked again every few hours (REFRESH) in the background, so the models a provider adds show
// up by themselves and nothing waits on the provider but the first time (FIRST_MS). A new key (or
// address) asks again at once. Only models that chat are kept: no embeddings, speech, pictures,
// video or music. Each with the provider's own name for it where the list gives one (Google's,
// Anthropic's, OpenRouter's); else NAMES; else its id.
//
// A model a provider retires falls back on the provider's current model (chatmodels.js reply), and
// Settings says so (server/index.js /api/model-jobs). Retired: by the provider's own deprecation
// page (RETIRED: Google and xAI send a retired model's requests to another model of their choosing
// without a word, so this is the only way to know); by its list (OpenAI's says when each model shuts
// down); or because it said it doesn't know a model it used to, and then answered with its current
// one (learnt, kept in the data folder).
//
// Request and answer shapes from each provider's docs: platform.claude.com/docs/en/api/models/list,
// developers.openai.com/api/reference/resources/models/methods/list, aistudio.google.com/
// api-reference/models/list-models, docs.x.ai/developers/rest-api-reference/inference/models, and
// the others' at their SOURCES entry.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cacheFile, dataFile, ensureDir, writeFileAtomic } from './paths.js'

export const REFRESH = 6 * 60 * 60 * 1000
const RETRY = 15 * 60 * 1000 // after a list that couldn't be had
const FIRST_MS = 3000 // the most the first look waits for a list
const ASK_MS = 8000
const PAGES = 5
// The most kept of one provider's list, newest first (its usual model always among them).
export const MOST = 40

// Not chat models, in a provider's list (or Ollama's, LM Studio's, Bedrock's).
export const NOT_CHAT = /embed|whisper|tts|dall-e|audio|realtime|moderation|image|transcri|search|davinci|babbage|rerank|guard|vision-preview/i
// Nor these, in the big labs' lists: video, music, robots, live voice, worlds, a computer's screen,
// research agents.
const NOT_TALK = /veo|imagen|lyria|genie|banana|sora|robotics|computer-use|deep-research|native-audio|(^|-)(live|voice)(-|$)|translate|antigravity|(^|-)aqa|decision|omni/i

const day = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null)
const when = (x) => (typeof x === 'number' ? x * (x < 1e12 ? 1000 : 1) : typeof x === 'string' ? Date.parse(x) || 0 : 0)
const bearer = (k) => ({ authorization: `Bearer ${k}` })
const rows = (j) => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [])
const ids = (j) => rows(j).filter((m) => typeof m?.id === 'string').map((m) => ({ id: m.id, at: when(m.created) }))

// How each provider lists its models: url({ base, page }), headers(key), parse(json, { custom }) ->
// [{ id, label?, sees?, at?, ends?, aliases? }] (sees: it takes pictures, where the list says; at:
// when it came out, for newest first; ends: the day it shuts down), next(json) -> the next page.
export const SOURCES = {
  // GET /v1/models: { data: [{ id, created, owned_by, shutdown_date }] }, all of it at once. Only the
  // GPT and o-series models that chat (no dated snapshots, nor the ones the Responses API alone
  // serves: Codex's and the -pro ones), unless it's another server at OPENAI_BASE_URL (custom).
  openai: {
    url: ({ base }) => `${base}/models`, headers: bearer,
    parse: (j, { custom } = {}) => rows(j).filter((m) => typeof m?.id === 'string' && (custom || (/^(gpt-|o\d|chatgpt-)/.test(m.id) && !/-\d{4}-\d{2}-\d{2}$|codex|-pro(-|$)|gpt-oss/.test(m.id))))
      .map((m) => ({ id: m.id, at: when(m.created), ends: day(m.shutdown_date) })),
  },
  // GET /v1/models?limit=1000: { data: [{ id, display_name, created_at, lifecycle, capabilities:
  // { image_input: { supported } } }], has_more, last_id }, newest first; active and deprecated ones.
  anthropic: {
    url: ({ base, page }) => `${base}/v1/models?limit=1000${page ? `&after_id=${encodeURIComponent(page)}` : ''}`,
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
    next: (j) => (j?.has_more && j.last_id ? j.last_id : null),
    parse: (j) => rows(j).filter((m) => typeof m?.id === 'string' && (m.type === 'model' || /^claude-/.test(m.id)) && m.lifecycle !== 'retired')
      .map((m) => ({ id: m.id, label: m.display_name, sees: m.capabilities?.image_input?.supported, at: when(m.created_at) })),
  },
  // GET /v1beta/models?pageSize=1000: { models: [{ name: 'models/…', displayName,
  // supportedGenerationMethods }], nextPageToken }. The Gemini models that write (generateContent).
  gemini: {
    url: ({ page }) => `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`,
    headers: (k) => ({ 'x-goog-api-key': k }),
    next: (j) => j?.nextPageToken || null,
    parse: (j) => (Array.isArray(j?.models) ? j.models : []).filter((m) => /^models\/gemini-/.test(m?.name || '') && (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.slice(7), label: m.displayName })),
  },
  // GET /v1/language-models: { models: [{ id, aliases, input_modalities, output_modalities, created }] },
  // the ones that chat or look at pictures (no image or video models).
  xai: {
    url: () => 'https://api.x.ai/v1/language-models', headers: bearer,
    parse: (j) => (Array.isArray(j?.models) ? j.models : []).filter((m) => typeof m?.id === 'string' && (!Array.isArray(m.output_modalities) || m.output_modalities.includes('text')))
      .map((m) => ({ id: m.id, aliases: Array.isArray(m.aliases) ? m.aliases : [], sees: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : undefined, at: when(m.created) })),
  },
  // docs.mistral.ai/api/endpoint/models: GET /v1/models, { data: [...] } (its example a bare list):
  // { id, name, aliases, capabilities: { completion_chat, vision }, archived }.
  mistral: {
    url: ({ base }) => `${base}/models`, headers: bearer,
    parse: (j) => rows(j).filter((m) => typeof m?.id === 'string' && m.capabilities?.completion_chat !== false && !m.archived)
      .map((m) => ({ id: m.id, aliases: Array.isArray(m.aliases) ? m.aliases : [], sees: typeof m.capabilities?.vision === 'boolean' ? m.capabilities.vision : undefined, at: when(m.created) })),
  },
  // api-docs.deepseek.com/api/list-models: GET /models, { data: [{ id, name, input_modalities }] }.
  deepseek: {
    url: ({ base }) => `${base}/models`, headers: bearer,
    parse: (j) => rows(j).filter((m) => typeof m?.id === 'string').map((m) => ({ id: m.id, sees: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : undefined })),
  },
  // console.groq.com/docs/api-reference: GET /openai/v1/models, { data: [{ id, created, active }] }.
  groq: {
    url: ({ base }) => `${base}/models`, headers: bearer,
    parse: (j) => rows(j).filter((m) => typeof m?.id === 'string' && m.active !== false).map((m) => ({ id: m.id, at: when(m.created) })),
  },
  // openrouter.ai/docs/api/api-reference/models/get-models: GET /api/v1/models, { data: [{ id, name,
  // created, architecture: { input_modalities, output_modalities }, expiration_date }] }, every
  // model of every lab (the newest MOST kept, and any by name).
  openrouter: {
    url: ({ base }) => `${base}/models`, headers: bearer,
    parse: (j) => rows(j).filter((m) => typeof m?.id === 'string' && (!Array.isArray(m.architecture?.output_modalities) || m.architecture.output_modalities.includes('text')))
      .map((m) => ({ id: m.id, label: m.name, sees: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : undefined, at: when(m.created), ends: day(m.expiration_date) })),
  },
  // dev.meta.ai/docs/api-reference/models/list-models: GET /v1/models, { data: [{ id, created }] },
  // newest first: the Muse models that chat (not its picture, voice or SAM models).
  meta: {
    url: ({ base }) => `${base}/models`, headers: bearer,
    parse: (j) => rows(j).filter((m) => /^muse-/.test(m?.id || '')).map((m) => ({ id: m.id, at: when(m.created) })),
  },
  // platform.kimi.ai/docs/api/list-models: GET /v1/models, { data: [{ id, created, supports_image_in }] }.
  moonshot: {
    url: ({ base }) => `${base}/models`, headers: bearer,
    parse: (j) => rows(j).filter((m) => typeof m?.id === 'string').map((m) => ({ id: m.id, sees: typeof m.supports_image_in === 'boolean' ? m.supports_image_in : undefined, at: when(m.created) })),
  },
  // Together's GET /v1/models: a bare list (its SDK), or { data }: { id, type, display_name, created }.
  together: {
    url: ({ base }) => `${base}/models`, headers: bearer,
    parse: (j) => rows(j).filter((m) => typeof m?.id === 'string' && (!m.type || ['chat', 'language', 'code'].includes(m.type))).map((m) => ({ id: m.id, label: m.display_name, at: when(m.created) })),
  },
  fireworks: { url: ({ base }) => `${base}/models`, headers: bearer, parse: ids },
  // inference-docs.cerebras.ai/api-reference/models: { data: [{ id, created }] }.
  cerebras: { url: ({ base }) => `${base}/models`, headers: bearer, parse: ids },
  // docs.cohere.com/reference/list-models: its own API, not the OpenAI-compatible one: { models:
  // [{ name, is_deprecated }], next_page_token }, the ones for chat.
  cohere: {
    url: ({ page }) => `https://api.cohere.com/v1/models?endpoint=chat&page_size=1000${page ? `&page_token=${encodeURIComponent(page)}` : ''}`, headers: bearer,
    next: (j) => j?.next_page_token || null,
    parse: (j) => (Array.isArray(j?.models) ? j.models : []).filter((m) => typeof m?.name === 'string' && !m.is_deprecated).map((m) => ({ id: m.name })),
  },
  // huggingface.co/docs/inference-providers/hub-api: { data: [{ id, architecture, providers: [{ status }] }] },
  // the models a provider serves now.
  huggingface: {
    url: () => 'https://router.huggingface.co/v1/models', headers: bearer,
    parse: (j) => rows(j).filter((m) => typeof m?.id === 'string' && (m.providers || []).some((p) => p.status === 'live'))
      .map((m) => ({ id: m.id, sees: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : undefined, at: when(m.created) })),
  },
}

// The names providers give their models, for a list that only gives ids (OpenAI's, xAI's) and the
// short lists below, from each provider's models page (November 2026).
export const NAMES = {
  'claude-fable-5-2': 'Claude Fable 5.2', 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5',
  'gpt-6.2-astra': 'GPT-6.2 Astra', 'gpt-6.2-sol': 'GPT-6.2 Sol', 'gpt-6.1-terra': 'GPT-6.1 Terra', 'gpt-6.1-sol': 'GPT-6.1 Sol', 'gpt-6-astra': 'GPT-6 Astra', 'gpt-6-luna': 'GPT-6 Luna',
  'gemini-4-carbon': 'Gemini 4 Carbon', 'gemini-4-neon': 'Gemini 4 Neon', 'gemini-4-hydrogen': 'Gemini 4 Hydrogen', 'gemini-4-argon': 'Gemini 4 Argon', 'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'grok-4.7': 'Grok 4.7', 'grok-4.6': 'Grok 4.6', 'grok-4.5': 'Grok 4.5', 'grok-4.3': 'Grok 4.3',
  'muse-spark-1.3': 'Muse Spark 1.3', 'muse-wonder-1.0': 'Muse Wonder 1.0',
  'kimi-k3.1-pro': 'Kimi K3.1 Pro', 'kimi-k3': 'Kimi K3',
  'command-a-plus-05-2026': 'Command A Plus', 'command-a-03-2025': 'Command A',
}
export const nameOf = (model) => NAMES[model] || null

// Models retired by their providers, from each one's deprecation page (checked 22 November 2026),
// with the day: platform.claude.com/docs/en/about-claude/model-deprecations, aistudio.google.com/
// docs/deprecations, docs.x.ai/docs/migration/may-15-retirement, docs.cloud.google.com/vertex-ai/
// generative-ai/docs/learn/model-versions. A name with a date after it (claude-opus-4-1-20250805,
// grok-4-0709) is the same model. OpenAI's list says when each of its models shuts down, so it isn't
// here.
export const RETIRED = {
  anthropic: {
    // (claude-opus-4-0 and claude-sonnet-4-0: the names that stood for the two retired 15 June.)
    'claude-sonnet-4-5': '2026-11-30', 'claude-opus-4-1': '2026-08-05', 'claude-opus-4-20250514': '2026-06-15', 'claude-sonnet-4-20250514': '2026-06-15', 'claude-opus-4-0': '2026-06-15', 'claude-sonnet-4-0': '2026-06-15',
    'claude-3-haiku': '2026-04-20', 'claude-3-7-sonnet': '2026-02-19', 'claude-3-5-haiku': '2026-02-19', 'claude-3-5-sonnet': '2025-10-28', 'claude-3-opus': '2026-01-05',
  },
  gemini: {
    'gemini-2.5-pro': '2026-12-01', 'gemini-2.5-flash': '2026-12-01', 'gemini-3-pro-preview': '2026-03-09', 'gemini-2.0-flash': '2026-06-01', 'gemini-2.0-flash-001': '2026-06-01',
    'gemini-2.0-flash-lite': '2026-06-01', 'gemini-2.0-flash-lite-001': '2026-06-01', 'gemini-3.1-flash-lite-preview': '2026-05-25',
  },
  xai: {
    'grok-4-0709': '2026-05-15', 'grok-4-fast-reasoning': '2026-05-15', 'grok-4-fast-non-reasoning': '2026-05-15', 'grok-4-1-fast-reasoning': '2026-05-15',
    'grok-4-1-fast-non-reasoning': '2026-05-15', 'grok-code-fast-1': '2026-05-15', 'grok-3': '2026-05-15', 'grok-build-0.1': '2026-11-19',
  },
  // api-docs.deepseek.com/news/news260424: "fully retired and inaccessible after Jul 24th, 2026".
  deepseek: { 'deepseek-chat': '2026-07-24', 'deepseek-reasoner': '2026-07-24' },
  vertex: {
    'google/gemini-2.5-pro': '2026-10-20', 'google/gemini-2.5-flash': '2026-10-20', 'google/gemini-2.5-flash-lite': '2026-10-20', 'google/gemini-3.6-flash': '2026-11-19', 'google/gemini-2.0-flash': '2026-06-01',
  },
}
const fits = (name, model) => model === name || (model.startsWith(`${name}-`) && /^\d{4}(\d{4})?$/.test(model.slice(name.length + 1)))
// Today on this computer, as YYYY-MM-DD.
const today = (now = new Date()) => now.toLocaleDateString('en-CA')

// ---------- The lists, kept ----------
const LISTS = () => cacheFile('model-lists.json')
let lists = null // route -> { fp, at, models, tried, error }
const loadLists = () => {
  if (!lists) { try { lists = JSON.parse(fs.readFileSync(LISTS(), 'utf8')) || {} } catch { lists = {} } }
  return lists
}
let saving = null
const saveSoon = () => {
  if (saving) return
  saving = setTimeout(() => {
    saving = null
    try { ensureDir(path.dirname(LISTS())); writeFileAtomic(LISTS(), JSON.stringify(lists)) } catch { /* kept in memory until the next */ }
  }, 300)
  saving.unref?.()
}
// Which key (and address) a list was for, without keeping the key: a list for another key is asked again.
const fpOf = (route, key, base) => crypto.createHash('sha256').update(`${route}\n${base || ''}\n${key}`).digest('hex').slice(0, 16)
const asking = new Map()

// Why a list couldn't be had, in words for its card: the provider's answer ("HTTP 401"), no answer
// in time, or not reached.
const whyNot = (e) => (e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `no answer in ${ASK_MS / 1000} s` : e?.status ? e.message : /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(`${e?.message} ${e?.cause?.code || ''}`) ? 'not reached' : String(e?.message || e).slice(0, 200))
async function ask(route, src, { key, base, custom }) {
  const out = []
  let page = null
  for (let n = 0; n < PAGES; n++) {
    const r = await fetch(src.url({ base, page }), { headers: src.headers(key), signal: AbortSignal.timeout(ASK_MS) })
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
    const j = await r.json()
    out.push(...src.parse(j, { custom }))
    page = src.next?.(j) || null
    if (!page) break
  }
  return out
}
// What's kept of a list: the models that chat, each once, newest first, at most MOST, with first
// (the provider's usual model) at the top when it's in it.
export function tidy(models, first = null) {
  const seen = new Set()
  const keep = []
  const isFirst = (m) => !!first && (m?.id === first || !!m?.aliases?.includes(first))
  for (const m of [...models].sort((a, b) => isFirst(b) - isFirst(a))) {
    // (A name that's another's alias, as Mistral lists both: once.)
    if (!m?.id || seen.has(m.id) || NOT_CHAT.test(m.id) || NOT_TALK.test(m.id)) continue
    seen.add(m.id)
    for (const a of m.aliases || []) seen.add(a)
    keep.push({ id: m.id, ...(m.label && m.label !== m.id ? { label: String(m.label).slice(0, 80) } : {}), ...(typeof m.sees === 'boolean' ? { sees: m.sees } : {}), ...(m.at ? { at: m.at } : {}), ...(m.ends ? { ends: m.ends } : {}), ...(m.aliases?.length ? { aliases: m.aliases.slice(0, 6) } : {}) })
  }
  keep.sort((a, b) => isFirst(b) - isFirst(a) || (b.at || 0) - (a.at || 0))
  return keep.slice(0, MOST)
}

// The models a provider lists for this key now ([{ id, label?, sees?, ends?, aliases? }]), or null
// when there's none to show: no key, no list to ask, not had yet (waited for up to FIRST_MS the
// first time), or it couldn't be had (why kept for kept()). A list older than REFRESH is
// still given while it's asked again in the background. base: the address it's asked at (OpenAI's
// can be another server: custom). first: the provider's usual model, kept at the top.
export async function listOf(route, { key, base = '', custom = false, first = null, wait = FIRST_MS } = {}) {
  const src = SOURCES[route]
  if (!src || !key) return null
  const all = loadLists()
  const fp = fpOf(route, key, base)
  const had = all[route]?.fp === fp ? all[route] : null
  const due = !had || (Date.now() - (had.at || 0) > REFRESH && Date.now() - (had.tried || 0) > RETRY)
  if (due && !asking.has(route)) {
    const p = ask(route, src, { key, base, custom })
      .then((models) => { all[route] = { fp, at: Date.now(), tried: Date.now(), models: tidy(models, first) } })
      .catch((e) => { all[route] = { ...(had || { fp }), fp, tried: Date.now(), error: whyNot(e) } })
      .finally(() => { asking.delete(route); saveSoon() })
    asking.set(route, p)
  }
  const now = all[route]?.fp === fp ? all[route] : null
  if (now?.models?.length) return now.models
  if (!asking.has(route) || !wait) return null
  await Promise.race([asking.get(route), new Promise((r) => setTimeout(r, wait).unref?.())])
  const got = all[route]?.fp === fp ? all[route] : null
  return got?.models?.length ? got.models : null
}
// A provider's list as it was last asked, for its card in Settings › Model Providers to say: { at
// (when it was had), models, error (why the last ask failed), tried }, or null when it hasn't been.
export function kept(route) {
  const l = SOURCES[route] ? loadLists()[route] : null
  return l ? { at: l.at || null, models: l.models || [], error: l.error || null, tried: l.tried || null } : null
}
// A model's entry in a provider's kept list (by its id, or an alias of it), or null.
export function listed(route, model) {
  const l = loadLists()[route]?.models || []
  return l.find((m) => m.id === model || m.aliases?.includes(model)) || null
}

// ---------- Retired ----------
const GONE = () => dataFile('models-retired.json')
let gone = null // 'route:model' -> { at, said }
const loadGone = () => {
  if (!gone) { try { gone = JSON.parse(fs.readFileSync(GONE(), 'utf8')) || {} } catch { gone = {} } }
  return gone
}
// Whether a provider has retired a model: { since: 'YYYY-MM-DD' or null, how: 'known' (its
// deprecation page), 'listed' (its list says it has shut down) or 'refused' (it said it doesn't know
// it) }, else null.
export function retired(route, model, now = new Date()) {
  const m = String(model || '')
  if (!m) return null
  const t = today(now)
  for (const [name, d] of Object.entries(RETIRED[route] || {})) if (fits(name, m) && d <= t) return { since: d, how: 'known' }
  const l = listed(route, m)
  if (l?.ends && l.ends <= t) return { since: l.ends, how: 'listed' }
  const g = loadGone()[`${route}:${m}`]
  if (g) return { since: day(g.at), how: 'refused' }
  return null
}
// A provider said it doesn't know a model (HTTP 404, "model not found"), and its current model then
// answered: the first is gone, from now on. said: its words.
export function learnGone(route, model, said = '') {
  const all = loadGone()
  const k = `${route}:${model}`
  if (all[k]) return
  all[k] = { at: new Date().toISOString(), said: String(said || '').slice(0, 200) }
  try { ensureDir(path.dirname(GONE())); writeFileAtomic(GONE(), JSON.stringify(all, null, 1)) } catch { /* kept until Bridge AI stops */ }
}
// What a provider says when it doesn't know a model: a 404, or a 400 that says so.
export const unknownModel = (e) => e?.status === 404 || (e?.status === 400 && /model[_ ]not[_ ]found|does not exist|no longer (available|supported)|not supported|has been (deprecated|retired|discontinued)|decommissioned|unknown model|invalid model/i.test(String(e?.message || '')))
