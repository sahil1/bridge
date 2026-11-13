// Consult another model with a one-off question: a second opinion, a fact check, live news,
// a very long document. The chief of staff uses this through `node bin/bridge ask`.
//
// Two ways to reach a model, tried in this order:
//   1. The agent's own CLI in one-shot mode (claude -p, codex exec, grok -p, ...). This uses the
//      subscription you're already signed in with, so there's nothing to set up.
//   2. The provider's API with a key you saved in Settings › Model Providers (or in your
//      environment). Every one here speaks the OpenAI chat format except Anthropic.
// Questions run in an empty folder, read-only where the CLI allows it, so a consult never
// touches your projects.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installed, loginPath, adapter } from './agents.js'
import { providerEnv, subscriptions } from './providers.js'
import { dataFile, ensureDir, IS_WIN } from './paths.js'
import { agentEnv } from './runtime/spawn.js'
import { hiddenAgent, hiddenProvider, hiddenModel, OFF } from './labs.js'
import * as accounts from './accounts.js'
import * as usagelog from './usagelog.js'

const DIR = () => ensureDir(dataFile('consult'))
// BRIDGE_ANTHROPIC_URL (tests): a stand-in for Anthropic's API.
export const anthropicUrl = () => String(process.env.BRIDGE_ANTHROPIC_URL || 'https://api.anthropic.com').replace(/\/+$/, '')
const TIMEOUT = 4 * 60 * 1000

// One-shot mode per agent CLI: (prompt, model, outFile) -> args. Flags checked against each --help.
export const CLI = {
  claude: (p, m) => ['-p', p, ...(m ? ['--model', m] : [])],
  codex: (p, m, out) => ['exec', '--skip-git-repo-check', '-s', 'read-only', '-o', out, ...(m ? ['-m', m] : []), p],
  grok: (p, m) => ['-p', p, ...(m ? ['-m', m] : [])],
  cursor: (p, m) => ['-p', p, '--output-format', 'text', ...(m ? ['--model', m] : [])],
  opencode: (p, m) => ['run', ...(m ? ['-m', m] : []), p],
  gemini: (p) => ['-p', p],
  copilot: (p) => ['-p', p],
  qwen: (p) => ['-p', p],
}
// The one-shot modes that also say what an answer took, asked to: Claude Code's JSON result (its
// usage, by model in modelUsage) and Codex's events (each turn.completed's usage). The others print
// the answer alone. A version too old for the flag is asked without it from then on. Before the
// prompt (Codex's after exec), so nothing follows it that isn't the model.
const SAYS = { claude: ['--output-format', 'json'], codex: ['--json'] }
const refused = new Set()
const argsFor = (kind, p, m, out) => {
  const a = CLI[kind](p, m, out)
  if (SAYS[kind] && !refused.has(kind)) a.splice(kind === 'codex' ? 1 : 0, 0, ...SAYS[kind])
  return a
}
const flagRefused = (kind, stderr) => /unknown option|unexpected argument|unrecognized|unknown argument/i.test(stderr) && SAYS[kind].some((f) => f.startsWith('--') && stderr.includes(f))
// The answer and what it took, from what the run printed: { text, usage } (usage null when it
// didn't say). Claude Code's result is the answer; Codex's is in its -o file, else its last message.
function readRun(kind, stdout, fromFile) {
  const out = String(stdout || '')
  if (kind === 'claude') {
    // One line of JSON, after anything else it printed first; none (plain text): an older version.
    let j = null
    try { j = JSON.parse(out.trim().split('\n').reverse().find((l) => /^\{.*"type":\s*"result"/.test(l.trim())) || '') } catch { /* not its result */ }
    if (!j || j.type !== 'result') return { text: fromFile ?? out, usage: null }
    const session = typeof j.session_id === 'string' ? j.session_id : null
    const per = Object.entries(j.modelUsage || {})
    const sum = (k) => per.reduce((s, [, m]) => s + (Number(m[k]) || 0), 0)
    const u = j.usage || {}
    const cached = per.length ? sum('cacheReadInputTokens') : Number(u.cache_read_input_tokens) || 0
    const written = per.length ? sum('cacheCreationInputTokens') : Number(u.cache_creation_input_tokens) || 0
    const usage = {
      in: (per.length ? sum('inputTokens') : Number(u.input_tokens) || 0) + cached + written,
      out: per.length ? sum('outputTokens') : Number(u.output_tokens) || 0,
      cached, written,
      model: per.sort((a, b) => (b[1].outputTokens || 0) - (a[1].outputTokens || 0))[0]?.[0] || null,
    }
    return { text: String(j.result ?? ''), usage, session }
  }
  if (kind === 'codex') {
    const events = out.split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((e) => e && typeof e === 'object')
    const turns = events.filter((e) => e.type === 'turn.completed' && e.usage)
    const said = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').map((e) => e.item.text).filter(Boolean)
    const add = (k) => turns.reduce((s, e) => s + (Number(e.usage[k]) || 0), 0)
    const usage = turns.length ? { in: add('input_tokens'), out: add('output_tokens'), cached: add('cached_input_tokens'), written: 0, model: null } : null
    const session = events.find((e) => e.type === 'thread.started' && typeof e.thread_id === 'string')?.thread_id || null
    return { text: fromFile ?? (events.length ? said.at(-1) || '' : out), usage, session }
  }
  return { text: fromFile ?? out, usage: null }
}

// APIs, with a sensible default model each. Change one with "consult": { "models": { "xai": "..." } }
// in your config, or pass a model with the request. BRIDGE_PERPLEXITY_URL (tests): a stand-in for
// Perplexity's API.
export const API = {
  anthropic: { label: 'Anthropic API', key: 'ANTHROPIC_API_KEY', anthropic: true, model: 'claude-opus-5-5' },
  openai: { label: 'OpenAI API', base: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', model: 'gpt-5' },
  xai: { label: 'xAI API', base: 'https://api.x.ai/v1', key: 'XAI_API_KEY', model: 'grok-4' },
  meta: { label: 'Meta Model API', base: 'https://api.meta.ai/v1', key: 'MODEL_API_KEY', model: 'muse-spark-1.3' },
  gemini: { label: 'Gemini API', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GEMINI_API_KEY', alt: 'GOOGLE_API_KEY', model: 'gemini-2.5-pro' },
  perplexity: { label: 'Perplexity API', base: String(process.env.BRIDGE_PERPLEXITY_URL || 'https://api.perplexity.ai').replace(/\/+$/, ''), key: 'PERPLEXITY_API_KEY', model: 'sonar-pro' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', model: 'openrouter/auto' },
  deepseek: { label: 'DeepSeek API', base: 'https://api.deepseek.com/v1', key: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' },
  mistral: { label: 'Mistral API', base: 'https://api.mistral.ai/v1', key: 'MISTRAL_API_KEY', model: 'mistral-large-latest' },
  groq: { label: 'Groq API', base: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile' },
  // A model on this computer, through chatmodels.js: Ollama at the address set in Settings › Model
  // Providers (or OLLAMA_HOST), LM Studio, or the local model built in once it's downloaded (after
  // your own), and the model picked there (localModel).
  local: { label: 'Local model', local: true, model: null },
}

// Who you can ask, by the name you'd use, with the routes to try in order and what each is good at.
export const CONSULTANTS = [
  { id: 'claude', label: 'Claude', cli: 'claude', api: 'anthropic', good: 'careful reasoning, writing, code review' },
  { id: 'gpt', label: 'GPT (OpenAI)', cli: 'codex', api: 'openai', good: 'a second opinion from a different lab, code' },
  { id: 'grok', label: 'Grok (xAI)', cli: 'grok', api: 'xai', good: 'current events and what people are saying on X' },
  { id: 'muse', label: 'Muse Spark (Meta)', api: 'meta', good: 'a different lab\'s view, very long inputs (1M tokens), images and video' },
  { id: 'gemini', label: 'Gemini (Google)', cli: 'gemini', api: 'gemini', good: 'very long documents, Google-grounded facts' },
  { id: 'perplexity', label: 'Perplexity', api: 'perplexity', good: 'web search with citations' },
  { id: 'cursor', label: 'Cursor Agent', cli: 'cursor', good: 'code questions with Cursor\'s models' },
  { id: 'copilot', label: 'GitHub Copilot', cli: 'copilot', good: 'GitHub-aware code questions' },
  { id: 'opencode', label: 'OpenCode', cli: 'opencode', good: 'any model you set up in OpenCode' },
  { id: 'qwen', label: 'Qwen', cli: 'qwen', good: 'a second opinion from an open-weights model' },
  { id: 'deepseek', label: 'DeepSeek', api: 'deepseek', good: 'reasoning and math at low cost' },
  { id: 'mistral', label: 'Mistral', api: 'mistral', good: 'a European model; multilingual' },
  { id: 'groq', label: 'Groq', api: 'groq', good: 'very fast answers from open models' },
  { id: 'openrouter', label: 'OpenRouter', api: 'openrouter', good: 'any model by name (pass --model vendor/model)' },
  { id: 'local', label: 'Local model', api: 'local', good: 'private questions that must not leave this computer' },
]

export const keyFor = (api) => {
  const env = { ...process.env, ...providerEnv() }
  return env[api.key] || (api.alt && env[api.alt]) || null
}

// Your settings (index.js), for the model on this computer picked in Settings › Model Providers.
let conf = {}
export const configure = (c) => { conf = c || {} }
// chatmodels.js imports this file, so it's loaded when first needed.
const chat = () => import('./chatmodels.js')
// A model asked for by name: "ollama:qwen3.5:4b" or "lmstudio:…" as chatmodels.js names them, or
// an Ollama model's own name (what "consult": { "models": { "ollama": … } } used to hold).
const localId = (m) => (!m ? null : /^(ollama|lmstudio|bridge):/.test(m) ? m : `ollama:${m}`)
// The model on this computer a consult would use now: { id, label, provider, picked, missing }.
export async function localModel(model) {
  const want = localId(model || conf.localModel || conf.consult?.models?.local || conf.consult?.models?.ollama)
  return (await chat()).localModel(want).catch(() => null)
}
// How it reads: "qwen3.5:4b (Ollama, on this computer)", and why it isn't the one picked.
const localRoute = (m) => `${m.label} (${m.provider})${m.missing ? `; ${m.missing.replace(/^\w+:/, '')} isn't running` : ''}`

// Qwen and DeepSeek only when Show more models is on (labs.js).
const hiddenConsultant = (c) => (c.cli && hiddenAgent(c.cli)) || (c.api && hiddenProvider(c.api))

// Every consultant with the route that would be used now (or why none is available).
export async function options() {
  const have = new Set((await installed()).map((a) => a.kind))
  const signedOut = new Set((await subscriptions().catch(() => [])).filter((s) => s.signedIn === false).map((s) => s.kind))
  const local = await localModel()
  return CONSULTANTS.filter((c) => !hiddenConsultant(c)).map((c) => {
    const cliReady = c.cli && have.has(c.cli) && CLI[c.cli] && !signedOut.has(c.cli)
    if (cliReady) return { ...c, available: true, via: 'cli', route: `${adapter(c.cli).label} CLI, your subscription or sign-in` }
    if (c.api) {
      const a = API[c.api]
      if (a.local ? local : keyFor(a)) return { ...c, available: true, via: 'api', route: a.local ? localRoute(local) : `${a.label} key`, ...(a.local ? { model: local.id } : {}) }
    }
    const need = [c.cli && (have.has(c.cli) ? `sign in to ${adapter(c.cli).label}` : `install ${adapter(c.cli).label}`), c.api && (API[c.api].local ? 'run Ollama or LM Studio, or download the local model in Settings › Model Providers' : `add your ${API[c.api].label} key in Settings › Model Providers`)].filter(Boolean).join(' or ')
    return { ...c, available: false, via: null, route: need }
  })
}

// On Windows an agent installed with npm is a .cmd file, which only cmd.exe runs, and cmd.exe acts on
// & | < > ^ % and quotes anywhere in its command line. So the line is built here: each argument
// quoted, then escaped twice (once for cmd.exe, once more for the .cmd passing it on with %*), the way
// cross-spawn does (https://qntm.org/cmd), and line breaks, which end a cmd.exe command, made spaces.
// A prompt is then only ever text. An .exe needs none of it.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g
const forCmd = (a) => `"${String(a).replace(/\r\n|\r|\n/g, ' ').replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1')
export function launch(bin, args, opts, done) {
  if (!IS_WIN || /\.exe$/i.test(bin)) return execFile(bin, args, opts, done)
  const line = [bin.replace(CMD_META, '^$1'), ...args.map(forCmd)].join(' ')
  return execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true }, done)
}

// signal: stop it (a chat's Esc).
// What a command line says instead of answering when its plan's usage is used up: Claude Code's
// "You've hit your weekly limit · resets 4am (America/Los_Angeles)", "Claude AI usage limit
// reached", Codex's "You've reached your usage limit". Short, and said first.
const LIMIT = /\b(hit your [\w -]{0,20}limit|usage limit reached|reached your usage limit|rate limit reached|out of (extra )?(usage|credits))\b/i
export const isLimit = (text) => String(text || '').length < 600 && LIMIT.test(String(text || '').slice(0, 300))

// An agent's command line, run once for an answer (`claude -p`, `codex exec`): on the account new
// agents start on, and when that one is at its usage limit, on your next account of that kind
// with room, so a meeting's notes and AI Assist carry on. Every account out: an error that says
// so (code 'limit'), never the limit's message passed on as the answer. extraEnv given (a
// consultant's own settings): as it says, on that alone. { text, usage }: the answer, and what it
// took when the agent says (SAYS), else null.
export async function oneShot(kind, prompt, model, extraEnv = {}, signal) {
  const ids = Object.keys(extraEnv).length || !accounts.supports(kind) ? [null] : accounts.forRun(kind)
  let last = null
  for (const id of ids) {
    try { return await runOnce(kind, prompt, model, { ...(id ? accounts.envFor(kind, id) : {}), ...extraEnv }, signal) } catch (e) {
      if (e.code !== 'limit') throw e
      last = e
    }
  }
  if (ids.length > 1) throw Object.assign(new Error(`${adapter(kind).label} is at its usage limit on all ${ids.length} of your accounts (${last.said})`), { code: 'limit', said: last.said })
  throw last
}

function runOnce(kind, prompt, model, extraEnv = {}, signal) {
  return new Promise(async (resolve, reject) => {
    const bin = (await installed()).find((a) => a.kind === kind)?.path
    if (!bin) return reject(new Error(`${adapter(kind).label} isn't installed`))
    const out = path.join(os.tmpdir(), `bridge-consult-${process.pid}-${Date.now()}.txt`)
    const env = agentEnv(await loginPath(), { ...providerEnv(), ...extraEnv })
    const asked = !!SAYS[kind] && !refused.has(kind)
    const started = Date.now()
    const child = launch(bin, argsFor(kind, prompt, model, out), { cwd: DIR(), env, timeout: TIMEOUT, maxBuffer: 8 * 1024 * 1024, windowsHide: true, signal }, (err, stdout, stderr) => {
      if (err && asked && flagRefused(kind, String(stderr || ''))) { refused.add(kind); fs.rmSync(out, { force: true }); return runOnce(kind, prompt, model, extraEnv, signal).then(resolve, reject) }
      let fromFile
      try { fromFile = fs.readFileSync(out, 'utf8'); fs.rmSync(out, { force: true }) } catch { /* none */ }
      const r = readRun(kind, stdout, fromFile)
      // Which account it ran on, by the folder it was given, for Usage's split by account.
      if (r.session && accounts.supports(kind)) accounts.ranOn(r.session, accounts.idOfEnv(kind, env), started)
      const text = String(r.text || '').trim()
      if (err && !text) return reject(new Error(`${adapter(kind).label} failed: ${String(stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`))
      // It failed and said why in its answer ("API Error: Connection dropped (ECONNRESET)"): an
      // error, not an answer, so callers can try again or use another model.
      if (err && /^(API Error|Error)\b/i.test(text) && text.length < 1000) return reject(new Error(`${adapter(kind).label}: ${text.split('\n')[0].slice(0, 300)}`))
      // At its usage limit: what it said is why it didn't answer, not the answer.
      if (isLimit(text)) { const said = text.split('\n')[0].trim().slice(0, 200); return reject(Object.assign(new Error(`${adapter(kind).label} is at its usage limit: ${said}`), { code: 'limit', said })) }
      resolve({ text, usage: r.usage })
    })
    child.stdin?.on('error', () => {}) // a CLI that's already gone
    child.stdin?.end() // some CLIs (codex exec) wait for more input on an open stdin
  })
}

// { text, model, said, links }: the answer, with the pages a search cited listed after it (Perplexity);
// said, the answer alone, and links, those pages ({ url, title }, web addresses only). ms: how long
// it may take.
async function runApi(id, prompt, model, feature, ms = TIMEOUT) {
  const started = Date.now()
  const noted = (j, m) => usagelog.record({ id: `${id}:${m}`, feature, usage: usagelog.usageOf(j), ms: Date.now() - started })
  const a = API[id]
  if (a.local) {
    const m = await localModel(model)
    if (!m) throw new Error('No model is running on this computer. Start Ollama or LM Studio, download the local model in Settings › Model Providers, or pick another consultant.')
    const r = await (await chat()).reply(m.id, [{ role: 'user', text: prompt }], { system: 'You answer a one-off question directly and accurately. Say so when you are not sure.', feature })
    return { text: r.text, model: m.id, route: localRoute(m) }
  }
  const key = keyFor(a)
  const m = model || a.model
  if (!m) throw new Error(`No model to use for ${a.label}`)
  if (a.anthropic) {
    const r = await fetch(`${anthropicUrl()}/v1/messages`, {
      method: 'POST', signal: AbortSignal.timeout(ms),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: m, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${a.label} (${m}): ${j.error?.message || `HTTP ${r.status}`}`)
    noted(j, m)
    return { text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim(), model: m }
  }
  const r = await fetch(`${a.base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(ms),
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: m, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${a.label} (${m}): ${j.error?.message || j.message || `HTTP ${r.status}`}. Set another model with "consult": { "models": { "${id}": "..." } } in your config.`)
  noted(j, m)
  const msg = j.choices?.[0]?.message
  const said = String(msg?.content || '').trim()
  let text = said
  if (Array.isArray(j.citations) && j.citations.length) text += `\n\nSources:\n${j.citations.map((u, i) => `[${i + 1}] ${u}`).join('\n')}`
  // The pages, in the order the answer numbers them: search_results has their titles too.
  const found = Array.isArray(j.search_results) && j.search_results.length ? j.search_results.map((s) => ({ url: s?.url, title: s?.title })) : Array.isArray(j.citations) ? j.citations.map((u) => ({ url: u })) : []
  const links = found.filter((l) => typeof l.url === 'string' && /^https?:\/\/[^\s]+$/i.test(l.url)).slice(0, 8).map((l) => ({ url: l.url, title: typeof l.title === 'string' && l.title.trim() ? l.title.trim().slice(0, 200) : null }))
  return { text, model: m, said, links }
}

// ---------- Looking something up on the web ----------
// For AI Assist's answers in a meeting (meetings.js): a question that needs current facts looked
// up on the web. The one route here that searches is Perplexity's API (its Sonar models search as
// they answer and say where from), with the key saved in Settings › Model Providers; the agents'
// command lines aren't used, as they search only when allowed to, if at all. Only the question goes,
// in a sentence of its own. searchVia(): who it would go to now, or null when there's no key.
export const searchVia = () => (!hiddenProvider('perplexity') && keyFor(API.perplexity) ? 'Perplexity' : null)
const SEARCH_MS = 60_000
// { text, links: [{ url, title }], via, model }.
export async function search(question, { feature = 'assist' } = {}) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!q) throw new Error('Nothing to look up')
  if (!searchVia()) throw new Error('No web search is set up: add a Perplexity key in Settings › Model Providers.')
  // (What a refusal says, without consult's tip on picking another model: a key turned down isn't that.)
  const r = await runApi('perplexity', `Answer in one to three plain sentences, from what the web says now: ${q}`, conf.consult?.models?.perplexity, feature, SEARCH_MS)
    .catch((e) => { throw new Error(String(e.message).replace(/\.? Set another model with [\s\S]*$/, '').replace(/\.?$/, '.')) })
  if (!r.said) throw new Error(`${API.perplexity.label} (${r.model}) sent back no answer`)
  return { text: r.said, links: r.links, via: 'Perplexity', model: r.model }
}

// Ask one consultant. `via` forces 'cli' or 'api'; `model` overrides the default. `env`: for the
// CLI, e.g. the config folder of the account to use (accounts.envFor). feature: who's asking, for
// what the answer took (usagelog.js): Insights, pull requests, or an agent's question.
export async function ask({ who, prompt, model, via, env, feature = 'consult' }, cfg = {}) {
  const q = String(prompt || '').trim()
  if (!q) throw new Error('Ask what?')
  if (q.length > 200_000) throw new Error('That question is too long (200k characters max)')
  const c = CONSULTANTS.find((x) => x.id === String(who || '').toLowerCase())
  if (!c) throw new Error(`Unknown consultant "${who}". Try: ${CONSULTANTS.filter((x) => !hiddenConsultant(x)).map((x) => x.id).join(', ')}`)
  if (hiddenConsultant(c) || (c.api && hiddenModel(`${c.api}:${model || cfg.consult?.models?.[c.api] || ''}`))) throw new Error(OFF)
  const opt = (await options()).find((x) => x.id === c.id)
  const useCli = via ? via === 'cli' : opt.via === 'cli'
  const started = Date.now()
  if (useCli && c.cli) {
    const r = await oneShot(c.cli, q, model, env && typeof env === 'object' ? env : {})
    usagelog.record({ id: `cli:${c.cli}`, feature, usage: r.usage, ms: Date.now() - started })
    return { who: c.id, via: 'cli', route: opt.route, model: model || null, text: r.text, ms: Date.now() - started }
  }
  if (c.api && (via === 'api' || opt.via === 'api' || !c.cli)) {
    const r = await runApi(c.api, q, model || cfg.consult?.models?.[c.api], feature)
    return { who: c.id, via: 'api', route: r.route || API[c.api].label, model: r.model, text: r.text, ms: Date.now() - started }
  }
  throw new Error(`${c.label} isn't available: ${opt.route}`)
}
