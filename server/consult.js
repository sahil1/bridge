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

const DIR = () => ensureDir(dataFile('consult'))
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

// APIs, with a sensible default model each. Change one with "consult": { "models": { "xai": "..." } }
// in your config, or pass a model with the request.
export const API = {
  anthropic: { label: 'Anthropic API', key: 'ANTHROPIC_API_KEY', anthropic: true, model: 'claude-opus-5-5' },
  openai: { label: 'OpenAI API', base: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', model: 'gpt-5' },
  xai: { label: 'xAI API', base: 'https://api.x.ai/v1', key: 'XAI_API_KEY', model: 'grok-4' },
  meta: { label: 'Meta Model API', base: 'https://api.meta.ai/v1', key: 'MODEL_API_KEY', model: 'muse-spark-1.3' },
  gemini: { label: 'Gemini API', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GEMINI_API_KEY', alt: 'GOOGLE_API_KEY', model: 'gemini-2.5-pro' },
  perplexity: { label: 'Perplexity API', base: 'https://api.perplexity.ai', key: 'PERPLEXITY_API_KEY', model: 'sonar-pro' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', model: 'openrouter/auto' },
  deepseek: { label: 'DeepSeek API', base: 'https://api.deepseek.com/v1', key: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' },
  mistral: { label: 'Mistral API', base: 'https://api.mistral.ai/v1', key: 'MISTRAL_API_KEY', model: 'mistral-large-latest' },
  groq: { label: 'Groq API', base: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile' },
  ollama: { label: 'Ollama (local)', base: 'http://127.0.0.1:11434/v1', local: true, model: null },
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
  { id: 'local', label: 'Local model (Ollama)', api: 'ollama', good: 'private questions that must not leave this computer' },
]

export const keyFor = (api) => {
  const env = { ...process.env, ...providerEnv() }
  return env[api.key] || (api.alt && env[api.alt]) || null
}

export async function ollamaModel() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1200) })
    return (await r.json()).models?.[0]?.name || null
  } catch { return null }
}

// Qwen and DeepSeek only when Show more models is on (labs.js).
const hiddenConsultant = (c) => (c.cli && hiddenAgent(c.cli)) || (c.api && hiddenProvider(c.api))

// Every consultant with the route that would be used now (or why none is available).
export async function options() {
  const have = new Set((await installed()).map((a) => a.kind))
  const signedOut = new Set((await subscriptions().catch(() => [])).filter((s) => s.signedIn === false).map((s) => s.kind))
  const local = await ollamaModel()
  return CONSULTANTS.filter((c) => !hiddenConsultant(c)).map((c) => {
    const cliReady = c.cli && have.has(c.cli) && CLI[c.cli] && !signedOut.has(c.cli)
    if (cliReady) return { ...c, available: true, via: 'cli', route: `${adapter(c.cli).label} CLI, your subscription or sign-in` }
    if (c.api) {
      const a = API[c.api]
      if (a.local ? local : keyFor(a)) return { ...c, available: true, via: 'api', route: a.local ? `${a.label}: ${local}` : `${a.label} key` }
    }
    const need = [c.cli && (have.has(c.cli) ? `sign in to ${adapter(c.cli).label}` : `install ${adapter(c.cli).label}`), c.api && (API[c.api].local ? 'run Ollama' : `add your ${API[c.api].label} key in Settings › Model Providers`)].filter(Boolean).join(' or ')
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
export function runCli(kind, prompt, model, extraEnv = {}, signal) {
  return new Promise(async (resolve, reject) => {
    const bin = (await installed()).find((a) => a.kind === kind)?.path
    if (!bin) return reject(new Error(`${adapter(kind).label} isn't installed`))
    const out = path.join(os.tmpdir(), `bridge-consult-${process.pid}-${Date.now()}.txt`)
    const env = agentEnv(await loginPath(), { ...providerEnv(), ...extraEnv })
    const child = launch(bin, CLI[kind](prompt, model, out), { cwd: DIR(), env, timeout: TIMEOUT, maxBuffer: 8 * 1024 * 1024, windowsHide: true, signal }, (err, stdout, stderr) => {
      let text = ''
      try { text = fs.readFileSync(out, 'utf8'); fs.rmSync(out, { force: true }) } catch { text = stdout }
      text = String(text || '').trim()
      if (err && !text) return reject(new Error(`${adapter(kind).label} failed: ${String(stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`))
      // It failed and said why in its answer ("API Error: Connection dropped (ECONNRESET)"): an
      // error, not an answer, so callers can try again or use another model.
      if (err && /^(API Error|Error)\b/i.test(text) && text.length < 1000) return reject(new Error(`${adapter(kind).label}: ${text.split('\n')[0].slice(0, 300)}`))
      resolve(text)
    })
    child.stdin?.on('error', () => {}) // a CLI that's already gone
    child.stdin?.end() // some CLIs (codex exec) wait for more input on an open stdin
  })
}

async function runApi(id, prompt, model) {
  const a = API[id]
  const key = a.local ? null : keyFor(a)
  const m = model || a.model || (a.local ? await ollamaModel() : null)
  if (!m) throw new Error(`No model to use for ${a.label}`)
  if (a.anthropic) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: m, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${a.label} (${m}): ${j.error?.message || `HTTP ${r.status}`}`)
    return { text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim(), model: m }
  }
  const r = await fetch(`${a.base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: m, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${a.label} (${m}): ${j.error?.message || j.message || `HTTP ${r.status}`}. Set another model with "consult": { "models": { "${id}": "..." } } in your config.`)
  const msg = j.choices?.[0]?.message
  let text = String(msg?.content || '').trim()
  if (Array.isArray(j.citations) && j.citations.length) text += `\n\nSources:\n${j.citations.map((u, i) => `[${i + 1}] ${u}`).join('\n')}`
  return { text, model: m }
}

// Ask one consultant. `via` forces 'cli' or 'api'; `model` overrides the default. `env`: for the
// CLI, e.g. the config folder of the account to use (accounts.envFor).
export async function ask({ who, prompt, model, via, env }, cfg = {}) {
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
    const text = await runCli(c.cli, q, model, env && typeof env === 'object' ? env : {})
    return { who: c.id, via: 'cli', route: opt.route, model: model || null, text, ms: Date.now() - started }
  }
  if (c.api && (via === 'api' || opt.via === 'api' || !c.cli)) {
    const r = await runApi(c.api, q, model || cfg.consult?.models?.[c.api])
    return { who: c.id, via: 'api', route: API[c.api].label, model: r.model, text: r.text, ms: Date.now() - started }
  }
  throw new Error(`${c.label} isn't available: ${opt.route}`)
}
