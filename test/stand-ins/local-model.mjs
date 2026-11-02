// A stand-in for a model server on this computer, for the tests: Ollama or LM Studio, on
// 127.0.0.1:<port>, with the models a JSON file lists (read again on each request, so a test can
// change them). Every chat request goes in <log> as a line of JSON, with how many tokens it came to,
// whether it was cut, and (Ollama) the numbers of the "Line <n>:" it read. node local-model.mjs <port> <log> ollama|lmstudio <models.json>
//   models.json: [{ name, context (the most the model takes), loaded (the context it's running
//   with, or null when it isn't loaded), thinks, params ("4B") }].
// It behaves as the real ones do where Bridge AI depends on it:
//   Ollama: /api/tags, /api/show (the context and whether it thinks), /api/ps (what's running), and
//   /api/chat with options.num_ctx (4,096 when none is given), think, format and truncate. A prompt
//   longer than the context is cut without a word (the first four tokens and the last half of the
//   context are kept, as Ollama's runner does), unless truncate is false: then it's refused. A model
//   that thinks does so unless think is false (it takes a moment, and the log says so). Its
//   OpenAI-style /v1/chat/completions has no way to set the context, so it's always 4,096 there.
//   LM Studio: /v1/models, /api/v1/models (each model's most and loaded context, and its reasoning
//   options), /api/v1/chat (reasoning "off"), and /v1/chat/completions with response_format. A
//   prompt longer than the loaded context is refused, in LM Studio's words. A model that thinks
//   writes its reasoning in <think> tags at the start of an OpenAI-style answer (a draft of the JSON
//   in it, as reasoning often has).
// Tokens here are about 3.5 characters each.
// Answers: meeting notes (from the lines it was given), a part of a long meeting (the first and last
// line numbers it saw), merged parts, who said what (JSON only when held to a schema), edit by
// voice, and anything else: "local answer from <model>".
import http from 'node:http'
import fs from 'node:fs'

const [port, LOG, KIND, MODELS] = [Number(process.argv[2]), process.argv[3], process.argv[4], process.argv[5]]
const log = (o) => { if (LOG) fs.appendFileSync(LOG, `${JSON.stringify(o)}\n`) }
const models = () => { try { return JSON.parse(fs.readFileSync(MODELS, 'utf8')) } catch { return [] } }
const find = (name) => models().find((m) => m.name === name)
const tokens = (s) => Math.ceil(String(s || '').length / 3.5)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PROMPT_TOO_LONG = 'the prompt is longer than the context length currently available to the model; shorten the prompt, adjust the context length in settings, or use a model with a longer context length'

// The answer to a prompt. json: held to a schema.
function answer(text, model, json) {
  const lines = [...text.matchAll(/\bLine (\d+)\b/g)].map((x) => Number(x[1]))
  const span = lines.length ? `lines ${Math.min(...lines)} to ${Math.max(...lines)}` : 'no lines'
  if (/Write meeting notes in Markdown/.test(text)) return `## Summary\n- Notes on this computer from ${span}.\n\n## Action items\n- [ ] You: send the plan (Friday)`
  if (/This is part (\d+) of (\d+)/.test(text)) return `- part ${/This is part (\d+)/.exec(text)[1]}: ${span}`
  if (/These are the key points of consecutive parts/.test(text)) return [...text.matchAll(/^- part \d+: .*$/gm)].map((x) => x[0]).join('\n')
  if (/Say who said each numbered Them line/.test(text)) {
    const out = {}
    for (const [, n, t] of text.matchAll(/^(\d+)\. \[[^\]]+\] Them: (.*)$/gm)) out[n] = /budget/i.test(t) ? 'Priya Shah' : null
    return json ? JSON.stringify(out) : `I think the budget line is Priya's.`
  }
  const edit = /^Instruction: [\s\S]*?\n\nText:\n([\s\S]*)$/.exec(text)
  if (edit) return edit[1].toUpperCase()
  return `local answer from ${model}`
}
// The "Line <n>" a prompt holds, as the model read it (after any cut).
const lineNumbers = (text) => [...String(text).matchAll(/\bLine (\d+):/g)].map((x) => Number(x[1]))
const lastUser = (messages) => [...(messages || [])].reverse().find((m) => m.role === 'user')?.content || ''
const allOf = (messages) => (messages || []).map((m) => m.content || '').join('\n')

async function ollama(req, b, j) {
  if (req.method === 'GET' && req.url === '/api/tags') return j(200, { models: models().map((m) => ({ name: m.name, model: m.name, details: { family: m.family || 'llama', parameter_size: m.params || '4B' } })) })
  if (req.method === 'GET' && req.url === '/api/ps') return j(200, { models: models().filter((m) => m.loaded).map((m) => ({ name: m.name, model: m.name, context_length: m.loaded, size_vram: m.gpu === false ? 0 : 3e9 })) })
  if (req.method === 'POST' && req.url === '/api/show') {
    const m = find(b.model || b.name)
    if (!m) return j(404, { error: `model '${b.model}' not found` })
    return j(200, { model_info: { 'general.architecture': 'llama', 'llama.context_length': m.context }, capabilities: ['completion', ...(m.thinks ? ['thinking'] : [])], details: { parameter_size: m.params || '4B' } })
  }
  if (req.method === 'POST' && (req.url === '/api/chat' || req.url === '/v1/chat/completions')) {
    const native = req.url === '/api/chat'
    const m = find(b.model)
    if (!m) return j(404, { error: `model '${b.model}' not found` })
    const ctx = native ? Number(b.options?.num_ctx) || 4096 : 4096
    let text = allOf(b.messages)
    const n = tokens(text)
    let cut = false
    if (n > ctx) {
      if (native && b.truncate === false) { log({ kind: 'ollama', path: req.url, model: b.model, num_ctx: ctx, tokens: n, refused: true }); return j(400, { error: PROMPT_TOO_LONG }) }
      // Kept: the first four tokens and the last half of the context.
      text = text.slice(0, 14) + text.slice(-Math.floor((ctx / 2) * 3.5))
      cut = true
    }
    const thought = !!m.thinks && b.think !== false
    if (thought) await sleep(1200)
    const json = native ? !!b.format : !!b.response_format
    const content = answer(cut ? text : lastUser(b.messages) || text, b.model, json)
    log({ kind: 'ollama', path: req.url, model: b.model, num_ctx: native ? b.options?.num_ctx ?? null : null, think: b.think, format: b.format ?? null, response_format: b.response_format ?? null, truncate: b.truncate, tokens: n, cut, read: lineNumbers(text), thought, user: lastUser(b.messages) })
    const stats = { prompt_eval_count: n, prompt_eval_duration: n * 2e6, eval_count: 120, eval_duration: 120 * 25e6 }
    if (!native) return j(200, { choices: [{ message: { role: 'assistant', content } }] })
    return j(200, { model: b.model, done: true, message: { role: 'assistant', content, ...(thought ? { thinking: 'Let me think about this for a while.' } : {}) }, ...stats })
  }
  return j(404, { error: 'not found' })
}

async function lmstudio(req, b, j) {
  if (req.method === 'GET' && req.url === '/v1/models') return j(200, { data: models().map((m) => ({ id: m.name, object: 'model' })) })
  if (req.method === 'GET' && req.url === '/api/v1/models') {
    return j(200, { models: models().map((m) => ({ type: 'llm', key: m.name, display_name: m.name, params_string: m.params || '4B', max_context_length: m.context, loaded_instances: m.loaded ? [{ id: m.name, config: { context_length: m.loaded } }] : [], capabilities: { vision: false, trained_for_tool_use: true, ...(m.thinks ? { reasoning: { allowed_options: ['off', 'on'], default: 'on' } } : {}) } })) })
  }
  const tooLong = (n, ctx) => `Trying to keep the first ${n} tokens when context the overflows. However, the model is loaded with context length of only ${ctx} tokens, which is not enough. Try to load the model with a larger context length, or provide a shorter input`
  if (req.method === 'POST' && req.url === '/api/v1/chat') {
    const m = find(b.model)
    if (!m) return j(404, { error: { message: `Model "${b.model}" not found` } })
    const ctx = m.loaded || 4096
    const text = `${b.system_prompt || ''}\n${b.input || ''}`
    const n = tokens(text)
    log({ kind: 'lmstudio', path: req.url, model: b.model, reasoning: b.reasoning ?? null, tokens: n, context: ctx, user: b.input })
    if (n > ctx) return j(400, { error: { message: tooLong(n, ctx) } })
    const thought = !!m.thinks && b.reasoning !== 'off'
    const out = [...(thought ? [{ type: 'reasoning', content: 'Let me think.' }] : []), { type: 'message', content: answer(b.input || '', b.model, false) }]
    return j(200, { model_instance_id: b.model, output: out, stats: { input_tokens: n, total_output_tokens: 80, tokens_per_second: 40, time_to_first_token_seconds: n / 300 } })
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    const m = find(b.model)
    if (!m) return j(404, { error: { message: `Model "${b.model}" not found` } })
    const ctx = m.loaded || 4096
    const n = tokens(allOf(b.messages))
    log({ kind: 'lmstudio', path: req.url, model: b.model, response_format: b.response_format ?? null, tokens: n, context: ctx, user: lastUser(b.messages) })
    if (n > ctx) return j(400, { error: { message: tooLong(n, ctx) } })
    const content = answer(lastUser(b.messages), b.model, b.response_format?.type === 'json_schema')
    return j(200, { choices: [{ message: { role: 'assistant', content: m.thinks ? `<think>\nIt could be {"1": "Dan Ruiz"}, but the budget line is Priya's.\n</think>\n\n${content}` : content } }] })
  }
  return j(404, { error: { message: 'Unexpected endpoint or method.' } })
}

http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    let b = {}
    try { b = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { /* not JSON */ }
    const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    try { await (KIND === 'lmstudio' ? lmstudio : ollama)(req, b, j) } catch (e) { j(500, { error: String(e.message || e) }) }
  })
}).listen(port, '127.0.0.1')
