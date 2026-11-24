// Each provider's own list of its models (server/livemodels.js), the short lists for when there's
// none, and a retired model falling back on its provider's current one, said in Settings. Nothing
// goes to a real provider: OpenAI and Anthropic are stand-ins here (OPENAI_BASE_URL,
// BRIDGE_ANTHROPIC_URL), and the other providers' lists are read from answers in the shapes their
// docs give, in this process.
//   In this process: each provider's list read as its docs say it comes (Google's, OpenAI's,
//   Anthropic's, xAI's, Mistral's, DeepSeek's, Groq's, OpenRouter's, Meta's, Kimi's, Together's,
//   Cohere's, Hugging Face's), only the models that chat, each once, the usual one first; the
//   retired ones by the providers' deprecation pages, on their day; what a provider says when it
//   doesn't know a model; which models take pictures, by name.
//   The server: with keys saved, the models are the providers' own (their names as they give them,
//   one shut down left out), asked once and kept, without the key; each provider's card says when
//   its list was had; a retired pick (shut down by its list, by the deprecation page, or a 404 from
//   the provider) answering with the provider's current model, the job's last run and the usage
//   log saying so, a 404'd one remembered; the Chief of Staff's question to a retired model the
//   same; Settings › Models for Each Task saying so in the row and for a pick elsewhere. With the
//   lists not to be had (an error, or a provider that doesn't answer): the short lists, by name, no
//   long wait, and the card saying why.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { startKit, checks, until, OUT, freePort, browser, page, shot } from '../lib/harness.mjs'

const { ok, done } = checks('model-lists')

// ---------- In this process ----------
process.env.BRIDGE_HOME = path.join(OUT, 'kits', 'model-lists-rules')
// (No key of this computer's in this process: the providers with none, as on a new install.)
for (const k of Object.keys(process.env)) if (/_API_KEY$|^HF_TOKEN$|^AWS_|^GOOGLE_(CLOUD|APPLICATION)|^AZURE_|^OPENAI_BASE_URL$/.test(k)) delete process.env[k]
fs.rmSync(process.env.BRIDGE_HOME, { recursive: true, force: true })
const lm = await import('../../server/livemodels.js')
const cm = await import('../../server/chatmodels.js')
const consult = await import('../../server/consult.js')
const ids = (l) => l.map((m) => m.id)
const read = (route, j, first, o) => lm.tidy(lm.SOURCES[route].parse(j, o), first)

let l = read('gemini', { models: [
  { name: 'models/gemini-4-neon', displayName: 'Gemini 4 Neon', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-4-carbon', displayName: 'Gemini 4 Carbon', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash-tts', displayName: 'Gemini 3.8 Flash TTS', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-live', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-nano-banana-2.1', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/imagen-4.0-generate', supportedGenerationMethods: ['predict'] },
] }, 'gemini-4-neon')
ok(JSON.stringify(ids(l)) === '["gemini-4-neon","gemini-4-carbon"]' && l[0].label === 'Gemini 4 Neon', 'Google\'s list (models[], displayName): the Gemini models that write, by Google\'s names; no speech, live voice, embeddings or pictures', l)
ok(lm.SOURCES.gemini.next({ nextPageToken: 'p2' }) === 'p2' && /pageSize=1000&pageToken=p2$/.test(lm.SOURCES.gemini.url({ page: 'p2' })) && lm.SOURCES.gemini.headers('k')['x-goog-api-key'] === 'k', 'and its pages, asked with the key in x-goog-api-key, not the address')
l = read('openai', { object: 'list', data: [
  { id: 'gpt-5', created: 1754500000, shutdown_date: '2026-12-11' }, { id: 'gpt-6.2-astra', created: 1790000000 }, { id: 'gpt-6.2-sol', created: 1790000001 },
  { id: 'gpt-6.2-sol-2026-11-17', created: 1790000002 }, { id: 'gpt-5-codex' }, { id: 'gpt-5-pro' }, { id: 'gpt-image-2.6-flare' }, { id: 'gpt-realtime-2.1' }, { id: 'gpt-live-1.1' },
  { id: 'gpt-transcribe' }, { id: 'whisper-1' }, { id: 'text-embedding-3-small' }, { id: 'omni-moderation-latest' }, { id: 'o3', created: 1744000000, shutdown_date: '2026-12-11' }, { id: 'davinci-002' },
] }, 'gpt-6.2-sol')
ok(JSON.stringify(ids(l)) === '["gpt-6.2-sol","gpt-6.2-astra","gpt-5","o3"]' && l.find((m) => m.id === 'gpt-5').ends === '2026-12-11', 'OpenAI\'s list: the GPT and o-series models that chat, its usual one first, then newest first, each with the day it shuts down; no snapshots, Codex\'s or -pro (the Responses API\'s alone), pictures, voice or embeddings', l)
ok(JSON.stringify(ids(read('openai', { data: [{ id: 'llama3' }, { id: 'nomic-embed-text' }] }, 'gpt-6.2-sol', { custom: true }))) === '["llama3"]', 'another server at OPENAI_BASE_URL: its models whatever they\'re called, still only ones that chat')
l = read('anthropic', { data: [
  { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-21T00:00:00Z', lifecycle: 'active', capabilities: { image_input: { supported: true } } },
  { type: 'model', id: 'claude-fable-5-2', display_name: 'Claude Fable 5.2', created_at: '2026-11-09T00:00:00Z', lifecycle: 'active' },
  { type: 'model', id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5', created_at: '2025-09-29T00:00:00Z', lifecycle: 'deprecated' },
  { type: 'model', id: 'claude-opus-4-1-20250805', display_name: 'Claude Opus 4.1', lifecycle: 'retired' },
], has_more: true, last_id: 'claude-sonnet-4-5-20250929' }, 'claude-opus-5-5')
ok(JSON.stringify(ids(l)) === '["claude-opus-5-5","claude-fable-5-2","claude-sonnet-4-5-20250929"]' && l[0].label === 'Claude Opus 5.5' && l[0].sees === true, 'Anthropic\'s list: its names, whether each takes pictures, not a retired one', l)
ok(lm.SOURCES.anthropic.next({ has_more: true, last_id: 'x' }) === 'x' && /\/v1\/models\?limit=1000&after_id=x$/.test(lm.SOURCES.anthropic.url({ base: 'https://api.anthropic.com', page: 'x' })) && lm.SOURCES.anthropic.headers('k')['anthropic-version'], 'and its pages (has_more, last_id), with x-api-key and anthropic-version')
l = read('xai', { models: [
  { id: 'grok-4.7', aliases: ['grok-4.7-latest'], input_modalities: ['text', 'image'], output_modalities: ['text'], created: 1790000000 },
  { id: 'grok-imagine-image-2.0', input_modalities: ['text'], output_modalities: ['image'] }, { id: 'grok-voice-3.0', output_modalities: ['text'] },
] }, 'grok-4.7')
ok(JSON.stringify(ids(l)) === '["grok-4.7"]' && l[0].sees === true && l[0].aliases[0] === 'grok-4.7-latest', 'xAI\'s language models: Grok 4.7, which takes pictures, by its aliases too; no picture or voice models', l)
l = read('mistral', [
  { id: 'mistral-large-4', aliases: ['mistral-large-latest', 'mistral-large-4-0'], capabilities: { completion_chat: true, vision: true } },
  { id: 'mistral-large-latest', aliases: ['mistral-large-4'], capabilities: { completion_chat: true, vision: true } },
  { id: 'mistral-embed', capabilities: { completion_chat: false } }, { id: 'ft:mine', capabilities: { completion_chat: true }, archived: true },
], 'mistral-large-latest')
ok(JSON.stringify(ids(l)) === '["mistral-large-4"]' && l[0].sees === true, 'Mistral\'s list (bare, as its example has it): a model and its aliases once, only ones that chat, none archived', l)
ok(JSON.stringify(ids(read('mistral', { object: 'list', data: [{ id: 'mistral-small-2603', capabilities: { completion_chat: true } }] }))) === '["mistral-small-2603"]', 'and as its schema has it ({ data })')
ok(JSON.stringify(read('deepseek', { object: 'list', data: [{ id: 'deepseek-flash', input_modalities: ['text', 'image'] }, { id: 'deepseek-v4-pro', input_modalities: ['text'] }] }, 'deepseek-flash').map((m) => [m.id, m.sees])) === '[["deepseek-flash",true],["deepseek-v4-pro",false]]', 'DeepSeek\'s: Flash, which takes pictures, and V4 Pro')
ok(JSON.stringify(ids(read('groq', { data: [{ id: 'openai/gpt-oss-120b', active: true }, { id: 'whisper-large-v3', active: true }, { id: 'llama-3.3-70b-versatile', active: false }] }, 'openai/gpt-oss-120b'))) === '["openai/gpt-oss-120b"]', 'Groq\'s: the active ones that chat')
l = read('openrouter', { data: [
  { id: 'openai/gpt-6.2-sol', name: 'OpenAI: GPT-6.2 Sol', created: 2, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'black-forest-labs/flux', created: 3, architecture: { output_modalities: ['image'] } }, { id: 'old/one', created: 1, expiration_date: '2026-01-01' },
] })
ok(JSON.stringify(ids(l)) === '["openai/gpt-6.2-sol","old/one"]' && l[0].label === 'OpenAI: GPT-6.2 Sol' && l[1].ends === '2026-01-01', 'OpenRouter\'s: its names, newest first, the day one goes; no picture models', l)
ok(JSON.stringify(ids(read('meta', { data: [{ id: 'muse-spark-1.3', created: 3 }, { id: 'muse-image-1.0', created: 4 }, { id: 'muse-voice-transcribe-1.0' }, { id: 'sam-3.1' }] }, 'muse-spark-1.3'))) === '["muse-spark-1.3"]', 'Meta\'s: the Muse models that chat (no picture, voice or SAM models)')
ok(read('moonshot', { data: [{ id: 'kimi-k3.1-pro', supports_image_in: true }] })[0].sees === true, 'Kimi\'s: supports_image_in')
ok(JSON.stringify(ids(read('together', [{ id: 'moonshotai/Kimi-K3', type: 'chat', display_name: 'Kimi K3' }, { id: 'flux', type: 'image' }, { id: 'bge', type: 'embedding' }]))) === '["moonshotai/Kimi-K3"]', 'Together AI\'s, a bare list: the chat models (its list was read as { data } before, so it was always empty)')
ok(JSON.stringify(ids(read('cohere', { models: [{ name: 'command-a-plus-05-2026' }, { name: 'command', is_deprecated: true }] }))) === '["command-a-plus-05-2026"]' && /endpoint=chat/.test(lm.SOURCES.cohere.url({})), 'Cohere\'s own API: the chat models not deprecated')
ok(JSON.stringify(ids(read('huggingface', { data: [{ id: 'a/live', providers: [{ status: 'live' }] }, { id: 'b/down', providers: [{ status: 'error' }] }] }))) === '["a/live"]', 'Hugging Face\'s: the models a provider serves now')
ok(!lm.SOURCES.perplexity && !lm.SOURCES.zai, 'Perplexity and Z.ai: no list to ask for chat (their short lists instead)')
ok(lm.tidy(Array.from({ length: 60 }, (_, i) => ({ id: `m-${i}`, at: i }))).length === lm.MOST, `at most ${lm.MOST} of one provider`)

// Retired: by the providers' deprecation pages, from their day on.
const on = (d) => new Date(`${d}T12:00:00`)
ok(lm.retired('gemini', 'gemini-2.5-pro', on('2026-11-30')) === null && lm.retired('gemini', 'gemini-2.5-pro', on('2026-12-01'))?.since === '2026-12-01', 'Gemini 2.5 Pro (Bridge AI\'s Gemini default before): retired from 1 December 2026, not before (Google sends its requests to another model without a word)')
ok(lm.retired('anthropic', 'claude-sonnet-4-5-20250929', on('2026-11-30'))?.how === 'known' && lm.retired('anthropic', 'claude-sonnet-4-5', on('2026-11-30')) && !lm.retired('anthropic', 'claude-sonnet-4-5', on('2026-11-29')) && !lm.retired('anthropic', 'claude-sonnet-4-6', on('2027-01-01')), 'Claude Sonnet 4.5, by its name and its dated one, from 30 November 2026; Sonnet 4.6 not')
ok(lm.retired('xai', 'grok-4-0709')?.since === '2026-05-15' && !lm.retired('xai', 'grok-4.7') && lm.retired('deepseek', 'deepseek-chat')?.since === '2026-07-24', 'xAI\'s Grok 4 (0709) and DeepSeek\'s deepseek-chat, retired; Grok 4.7 not')
ok(lm.unknownModel({ status: 404 }) && lm.unknownModel({ status: 400, message: 'The model `llama-3.3-70b-versatile` has been decommissioned and is no longer supported' }) && !lm.unknownModel({ status: 400, message: 'max_tokens is too large' }) && !lm.unknownModel({ status: 429 }), 'a provider not knowing a model: a 404, or a 400 that says so; not another 400, nor a rate limit')

// The defaults, and the short lists (each provider's current models, checked against its docs).
ok(consult.API.openai.model === 'gpt-6.2-sol' && consult.API.gemini.model === 'gemini-4-neon' && consult.API.xai.model === 'grok-4.7' && consult.API.anthropic.model === 'claude-opus-5-5' && consult.API.groq.model === 'openai/gpt-oss-120b' && consult.API.deepseek.model === 'deepseek-flash', 'each provider\'s default is its current model', Object.fromEntries(Object.entries(consult.API).map(([k, a]) => [k, a.model])))
ok(cm.insteadOf('gemini') === 'gemini:gemini-4-neon' && cm.insteadOf('vertex') === 'vertex:google/gemini-4-hydrogen' && cm.insteadOf('ollama') === null && cm.insteadOf('together') === null, 'what a retired model falls back on: its provider\'s current one (Vertex\'s first); none for a model on this computer or an open-model host')
const unk = cm.unkeyed()
ok(unk.some((u) => u.model === 'gemini:gemini-4-neon' && u.name === 'Gemini 4 Neon') && unk.some((u) => u.model === 'openai:gpt-6.2-sol' && u.name === 'GPT-6.2 Sol') && unk.some((u) => u.model === 'xai:grok-4.7' && u.name === 'Grok 4.7'), 'with no key yet: each provider\'s current model, by its own name', unk)
// Pictures, by name, for the new models.
const sees = {}
for (const id of ['openai:gpt-6.2-sol', 'openai:gpt-6-luna', 'gemini:gemini-4-neon', 'xai:grok-4.7', 'anthropic:claude-fable-5-2', 'meta:muse-spark-1.3', 'mistral:mistral-large-latest', 'deepseek:deepseek-flash', 'groq:openai/gpt-oss-120b', 'deepseek:deepseek-v4-pro', 'xai:grok-3', 'zai:glm-5.3']) sees[id] = await cm.canSee(id)
ok(['openai:gpt-6.2-sol', 'openai:gpt-6-luna', 'gemini:gemini-4-neon', 'xai:grok-4.7', 'anthropic:claude-fable-5-2', 'meta:muse-spark-1.3', 'mistral:mistral-large-latest', 'deepseek:deepseek-flash'].every((id) => sees[id]) && ['groq:openai/gpt-oss-120b', 'deepseek:deepseek-v4-pro', 'xai:grok-3', 'zai:glm-5.3'].every((id) => !sees[id]), 'which take pictures: GPT-6, Gemini 4, Grok 4.7, Claude, Muse Spark, Mistral Large, DeepSeek Flash; not gpt-oss, DeepSeek V4 Pro, Grok 3 or GLM-5.3', sees)

// ---------- The server, with stand-ins for OpenAI and Anthropic ----------
const stand = (name, handle) => {
  const s = { asked: [], lists: 0, srv: null, url: null }
  s.srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      let b = {}
      try { b = JSON.parse(body || '{}') } catch { /* none */ }
      if (req.method === 'GET' && /^\/v1\/models/.test(req.url)) { s.lists++; s.headers = req.headers }
      else s.asked.push(b.model)
      handle(req, b, j, s)
    })
  })
  return new Promise((resolve) => freePort().then((port) => s.srv.listen(port, '127.0.0.1', () => { s.url = `http://127.0.0.1:${port}`; resolve(s) })))
}
const summary = (model) => `## Summary\n- Written by ${model}.`
const OPENAI_LIST = { object: 'list', data: [
  { id: 'gpt-6.2-sol', created: 1790000001 }, { id: 'gpt-6.2-astra', created: 1790000000 }, { id: 'gpt-later-test', created: 1700000000, shutdown_date: '2099-01-01' },
  { id: 'gpt-old-test', created: 1600000000, shutdown_date: '2026-01-01' }, { id: 'gpt-image-2.6-flare', created: 1790000002 }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' },
] }
const ANTH_LIST = { data: [
  { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-21T00:00:00Z', lifecycle: 'active', capabilities: { image_input: { supported: true } } },
  { type: 'model', id: 'claude-test-blind', display_name: 'Claude Test Blind', created_at: '2026-01-01T00:00:00Z', lifecycle: 'active', capabilities: { image_input: { supported: false } } },
], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-test-blind' }
const oa = await stand('openai', (req, b, j) => {
  if (req.method === 'GET') return j(200, OPENAI_LIST)
  if (b.model === 'gpt-gone-test') return j(404, { error: { message: 'The model `gpt-gone-test` does not exist or you do not have access to it.', code: 'model_not_found' } })
  j(200, { model: b.model, choices: [{ message: { role: 'assistant', content: summary(b.model) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
})
const an = await stand('anthropic', (req, b, j) => {
  if (req.method === 'GET') return j(200, ANTH_LIST)
  if (b.model === 'claude-gone-test') return j(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-gone-test' } })
  j(200, { model: b.model, content: [{ type: 'text', text: summary(b.model) }], usage: { input_tokens: 10, output_tokens: 5 } })
})
// Lists not to be had: OpenAI's an error, Anthropic's never answered.
const oaDown = await stand('openai-down', (req, b, j) => (req.method === 'GET' ? j(500, { error: { message: 'down' } }) : j(200, { choices: [{ message: { role: 'assistant', content: summary(b.model) } }] })))
const anDown = await stand('anthropic-down', (req, b, j) => { if (req.method !== 'GET') j(200, { content: [{ type: 'text', text: summary(b.model) }] }) })

const kit = await startKit('model-lists', {
  env: { OPENAI_API_KEY: 'sk-test-lists', OPENAI_BASE_URL: `${oa.url}/v1`, ANTHROPIC_API_KEY: 'sk-ant-test-lists', BRIDGE_ANTHROPIC_URL: an.url },
  config: { meetings: { autoSummary: false, cleanup: false, nameSpeakers: false }, studio: { model: 'anthropic:claude-3-5-haiku-20241022' } },
})
const kit2 = await startKit('model-lists-down', { env: { OPENAI_API_KEY: 'sk-test-down', OPENAI_BASE_URL: `${oaDown.url}/v1`, ANTHROPIC_API_KEY: 'sk-ant-test-down', BRIDGE_ANTHROPIC_URL: anDown.url } })
const MONTH = new Date().toLocaleDateString('en-CA').slice(0, 7)
const usage = () => { try { return fs.readFileSync(path.join(kit.data, 'usage', `answers-${MONTH}.jsonl`), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x)) } catch { return [] } }
const own = (job, list) => kit.api('/settings', { jobModels: { [job]: list } }, 'PATCH')
const jobOf = async (id) => (await kit.api('/model-jobs')).jobs.find((x) => x.id === id)
async function notes(title) {
  const m = await kit.api('/meetings', { title, call: false })
  await kit.api(`/meetings/${m.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${m.id}`)).status === 'done', 15000)
  fs.appendFileSync(path.join(kit.data, 'meetings', m.id, 'transcript.jsonl'), `${JSON.stringify({ src: 'you', t0: 1, t1: 4, text: 'We agreed to ship on Friday.', engine: 'test' })}\n`)
  await kit.api(`/meetings/${m.id}/summary`, {})
  return until(async () => { const x = await kit.api(`/meetings/${m.id}`); return !x.summarizing && (x.summary || x.summaryError) && x }, 30000)
}

let b = null
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit2.api('/setup', { name: 'Tester' })

  // The providers' own lists.
  let d = await kit.api('/model-jobs')
  const by = (id) => d.models.find((m) => m.id === id)
  const openai = d.models.filter((m) => m.route === 'openai').map((m) => m.id)
  ok(JSON.stringify(openai) === '["openai:gpt-6.2-sol","openai:gpt-6.2-astra","openai:gpt-later-test"]', 'OpenAI\'s models are its own list\'s: its current one first; not one that has shut down, nor pictures, embeddings or speech', openai)
  ok(by('openai:gpt-6.2-sol')?.label === 'GPT-6.2 Sol' && by('openai:gpt-6.2-astra')?.label === 'GPT-6.2 Astra' && by('openai:gpt-later-test')?.label === 'gpt-later-test', 'by OpenAI\'s names for them (its list gives only ids), else the id', d.models.filter((m) => m.route === 'openai'))
  ok(by('anthropic:claude-opus-5-5')?.label === 'Claude Opus 5.5' && by('anthropic:claude-test-blind')?.label === 'Claude Test Blind' && !by('anthropic:claude-sonnet-5-5'), 'Anthropic\'s, from its list, by its names (not the short list)', d.models.filter((m) => m.route === 'anthropic'))
  ok(oa.headers?.authorization === 'Bearer sk-test-lists' && an.headers?.['x-api-key'] === 'sk-ant-test-lists' && !!an.headers?.['anthropic-version'], 'each asked with its key, as its API takes it')
  await kit.api('/model-jobs')
  await kit.api('/chat/models')
  ok(oa.lists === 1 && an.lists === 1, 'asked once, and kept: looking again asks no provider', { openai: oa.lists, anthropic: an.lists })
  const keptFile = path.join(kit.data, 'cache', 'model-lists.json')
  ok(!!(await until(() => fs.existsSync(keptFile), 5000, 100)) && !/sk-test-lists|sk-ant-test-lists/.test(fs.readFileSync(keptFile, 'utf8')) && /gpt-6\.2-astra/.test(fs.readFileSync(keptFile, 'utf8')), 'kept in Bridge AI\'s cache folder, without the keys', keptFile)
  const prov = (await kit.api('/providers')).providers
  const card = prov.find((p) => p.id === 'openai')
  ok(card?.list?.at && !card.list.error && card.models?.includes('gpt-6.2-sol'), 'OpenAI\'s card in Model Providers: its models, from its list, and when it was had', card?.list)

  // A retired pick answers with its provider's current model, and says so.
  // 1. Shut down, by the provider's own list.
  await own('notes', ['openai:gpt-old-test'])
  let row = await jobOf('notes')
  ok(row.own?.[0]?.why === null && row.own[0].retired?.how === 'listed' && row.own[0].retired.since === '2026-01-01' && row.own[0].retired.instead === 'openai:gpt-6.2-sol' && row.own[0].retired.insteadLabel === 'GPT-6.2 Sol', 'a model OpenAI\'s list says has shut down: not "can\'t run", but retired, GPT-6.2 Sol in its place', row.own)
  oa.asked.length = 0
  let m = await notes('Old model')
  ok(m.summaryModel === 'openai:gpt-6.2-sol' && !m.summaryError && JSON.stringify(oa.asked) === '["gpt-6.2-sol"]' && /Written by gpt-6\.2-sol/.test(m.summary), 'meeting notes on it: written by OpenAI\'s current model, the retired one never asked', { model: m.summaryModel, asked: oa.asked, error: m.summaryError })
  let last = (await jobOf('notes')).last
  ok(last?.model === 'openai:gpt-6.2-sol' && last.passed?.[0]?.id === 'openai:gpt-old-test' && /^OpenAI retired gpt-old-test on 1 January 2026, so GPT-6\.2 Sol, its current model, answers in its place/.test(last.passed[0].why), 'the job\'s last run says which answered, and why', last)
  const line = usage().find((x) => x.route === 'openai' && x.model === 'gpt-6.2-sol' && x.instead === 'openai:gpt-old-test')
  ok(line && /OpenAI retired gpt-old-test/.test(line.why), 'and the usage log, as the model that answered, for the retired one', usage().slice(-2))

  // 2. A model the provider says it doesn't know (404): its current model, then remembered.
  await own('notes', ['anthropic:claude-gone-test'])
  ok((await jobOf('notes')).own?.[0]?.why === null && !(await jobOf('notes')).own[0].retired, 'one by name from a provider with its key here: can run (the list is the provider\'s, not all it has), nothing known about it yet')
  an.asked.length = 0
  m = await notes('Gone model')
  ok(m.summaryModel === 'anthropic:claude-opus-5-5' && !m.summaryError && JSON.stringify(an.asked) === '["claude-gone-test","claude-opus-5-5"]', 'Anthropic doesn\'t know it (404): asked once, then its current model wrote the notes', { model: m.summaryModel, asked: an.asked, error: m.summaryError })
  row = await jobOf('notes')
  ok(row.own[0].retired?.how === 'refused' && row.own[0].retired.instead === 'anthropic:claude-opus-5-5' && /^Anthropic doesn't know claude-gone-test, so Claude Opus 5\.5, its current model, answers in its place/.test(row.last?.passed?.[0]?.why || ''), 'and from then on it\'s retired, the row and its last run saying so', { own: row.own, last: row.last })
  const gone = JSON.parse(fs.readFileSync(path.join(kit.data, 'models-retired.json'), 'utf8'))
  ok(!!gone['anthropic:claude-gone-test']?.at, 'remembered in the data folder', gone)
  an.asked.length = 0
  m = await notes('Gone again')
  ok(m.summaryModel === 'anthropic:claude-opus-5-5' && JSON.stringify(an.asked) === '["claude-opus-5-5"]', 'the next time it isn\'t asked at all', an.asked)
  // One that fails for another reason isn't taken for retired.
  await own('notes', ['openai:gpt-gone-test'])
  oa.asked.length = 0
  m = await notes('Not found at OpenAI')
  ok(m.summaryModel === 'openai:gpt-6.2-sol' && JSON.stringify(oa.asked) === '["gpt-gone-test","gpt-6.2-sol"]', 'OpenAI\'s "does not exist" (404, model_not_found): the same, its current model', oa.asked)

  // 3. Retired by the provider's deprecation page, picked elsewhere (Studio) and for the Chief of
  // Staff's question.
  d = await kit.api('/model-jobs')
  const pick = d.retired?.find((r) => r.id === 'anthropic:claude-3-5-haiku-20241022')
  ok(pick && pick.how === 'known' && pick.since === '2026-02-19' && JSON.stringify(pick.where) === '["Studio"]' && /^Anthropic retired claude-3-5-haiku-20241022 on 19 February 2026, so Claude Opus 5\.5, its current model, answers in its place$/.test(pick.why), 'a model picked for Studio that Anthropic has retired: said, with where it was picked', d.retired)
  ok(!d.retired.some((r) => r.where.some((w) => /notes/i.test(w))), '(a job\'s own list says it in its row, not here too)')
  an.asked.length = 0
  const asked = await kit.api('/consult', { who: 'claude', via: 'api', model: 'claude-3-5-haiku-20241022', prompt: 'What is two and two?' })
  ok(asked.model === 'claude-opus-5-5' && JSON.stringify(an.asked) === '["claude-opus-5-5"]' && /^Anthropic retired claude-3-5-haiku-20241022 on 19 February 2026/.test(asked.retired || ''), 'the Chief of Staff asking that model: Claude Opus 5.5 answers, and the answer says why', asked)

  // ---------- Settings › Models for Each Task says so ----------
  await own('notes', ['openai:gpt-old-test'])
  ;({ b } = await browser())
  const which = b.browserType().name()
  const { ctx, p, errors } = await page(b, kit.url)
  await p.waitForSelector('.rail-nav-btn, body', { timeout: 30000 }).catch(() => {})
  await until(async () => {
    if (!(await p.locator('.modal.settings').count())) await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'model-jobs' } })))
    return (await p.locator('[data-model-jobs] li[data-job="notes"]').count()) === 1
  }, 45000, 1500)
  const box = p.locator('[data-model-jobs]')
  const note = box.locator('li[data-job="notes"] [data-retired]')
  ok(!!(await until(async () => (await note.innerText().catch(() => '')) === 'Retired by OpenAI: GPT-6.2 Sol, its current model, answers in its place.', 10000)), 'Meeting notes\' row: its model retired by OpenAI, and what answers in its place', await box.locator('li[data-job="notes"]').innerText().catch(() => ''))
  const lastLine = await box.locator('li[data-job="notes"] [data-job-last]').innerText()
  ok(/^Last run .* on GPT-6\.2 Sol: OpenAI doesn't know gpt-gone-test, so GPT-6\.2 Sol, its current model, answers in its place/.test(lastLine), 'and its last run (the one before, on a model OpenAI didn\'t know): which answered and why', lastLine)
  const elsewhere = box.locator('[data-retired-pick="anthropic:claude-3-5-haiku-20241022"]')
  ok(/^Anthropic retired claude-3-5-haiku-20241022 on 19 February 2026, so Claude Opus 5\.5, its current model, answers in its place\. Picked for Studio: pick another there to change it\.$/.test(await elsewhere.innerText().catch(() => '')), 'and the one picked for Studio, at the top', await elsewhere.innerText().catch(() => ''))
  await box.locator('li[data-job="notes"]').scrollIntoViewIfNeeded()
  await shot(p, `model-lists-${which}-retired`)
  ok(!errors.length, 'no page errors', errors)
  await ctx.close()
  await own('notes', null)

  // ---------- No list to be had: the short lists ----------
  const t0 = Date.now()
  const d2 = await kit2.api('/model-jobs')
  const took = Date.now() - t0
  const o2 = d2.models.filter((x) => x.route === 'openai')
  const a2 = d2.models.filter((x) => x.route === 'anthropic')
  ok(JSON.stringify(o2.map((x) => x.id)) === '["openai:gpt-6.2-sol","openai:gpt-6.2-astra","openai:gpt-6.1-terra","openai:gpt-6-luna"]' && o2[0].label === 'GPT-6.2 Sol', 'OpenAI\'s list an error: its short list, its current models by name', o2)
  ok(JSON.stringify(a2.map((x) => x.label)) === '["Claude Opus 5.5","Claude Sonnet 5.5","Claude Haiku 5.5","Claude Fable 5.2"]', 'Anthropic\'s list never answering: its short list too', a2)
  ok(took < 9000, `and it waited only a little for them the first time (${took} ms)`, took)
  const cards = (await kit2.api('/providers')).providers
  const oc = await until(async () => (await kit2.api('/providers')).providers.find((x) => x.id === 'openai' && x.list?.error), 5000, 200)
  ok(oc?.list.error === 'HTTP 500' && !oc.list.at && !oc.models, 'OpenAI\'s card says why its list couldn\'t be had', oc?.list || cards.find((x) => x.id === 'openai'))
  const ac = await until(async () => (await kit2.api('/providers')).providers.find((x) => x.id === 'anthropic' && x.list?.error), 15000, 300)
  ok(ac?.list?.error === 'no answer in 8 s', 'and Anthropic\'s, once it gave up waiting: no answer in 8 s', ac?.list)
  const r2 = await kit2.api('/settings', { jobModels: { tidy: ['openai:gpt-6.2-sol'] } }, 'PATCH').then(() => kit2.api('/model-jobs'))
  ok(r2.jobs.find((x) => x.id === 'tidy')?.own?.[0]?.why === null, 'and a model from it can be picked and run', r2.jobs.find((x) => x.id === 'tidy')?.own)
  // The cards in Settings › Model Providers say so: OpenAI's list couldn't be had, here; had, on the other.
  for (const [k, want] of [[kit2, /^Couldn't get OpenAI's list of models \(HTTP 500\), so its usual ones are shown where you pick a model\.$/], [kit, /^Models from OpenAI's own list, (just now|\d+ min ago)\. It's asked again every few hours\.$/]]) {
    const v = await page(b, k.url)
    await v.p.waitForSelector('.rail-nav-btn, body', { timeout: 30000 }).catch(() => {})
    await until(async () => {
      if (!(await v.p.locator('.modal.settings').count())) await v.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } })))
      return (await v.p.locator('.pv-card').count()) > 0
    }, 45000, 1500)
    const card = v.p.locator('.pv-card', { hasText: 'OpenAI' }).first()
    await card.locator('.pv-card-main').click()
    const said = await until(async () => { const x = await card.locator('[data-model-list]').innerText().catch(() => ''); return want.test(x) && x }, 10000)
    ok(!!said, `OpenAI's card: ${k === kit2 ? 'why its list couldn\'t be had' : 'its list, and when it was had'}`, said || await card.innerText().catch(() => ''))
    if (k === kit) await shot(v.p, `model-lists-${b.browserType().name()}-card`)
    ok(!v.errors.length, 'no page errors', v.errors)
    await v.ctx.close()
  }
} finally {
  await b?.close()
  kit.stop()
  kit2.stop()
  for (const s of [oa, an, oaDown, anDown]) s.srv.close()
}
process.exit(done().fail ? 1 : 0)
