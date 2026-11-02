// Models on this computer (server/chatmodels.js, consult.js, meetings.js), with stand-ins for Ollama
// and LM Studio (stand-ins/local-model.mjs) that behave as the real ones do where it matters: Ollama
// runs a model with a 4,096-token context unless asked for more and cuts a longer prompt without a
// word; LM Studio refuses one longer than the context it loaded the model with; models that think
// do so unless told not to.
//   The context: Ollama is asked for one that fits the job (options.num_ctx, through its own API),
//   within what the model takes (/api/show) and this computer's memory, kept at the size it's
//   already running with when that's enough, and told to refuse rather than cut a one-off job
//   (truncate: false); a job too long for the model is said, and nothing is sent; a model LM Studio
//   loaded with too small a context for meeting notes is said, with what to do.
//   Thinking: turned off for Bridge AI's own jobs (think: false; LM Studio's reasoning "off"), and
//   reasoning in <think> tags taken out of an answer.
//   Answers in JSON: asked in plain words, then once more held to a JSON schema when the answer
//   isn't JSON (Ollama's format, LM Studio's response_format json_schema).
//   The Chief of Staff's, Insights' and pull requests' "local": the model picked in Settings › Model
//   Providers (LM Studio's too), else one already running, at the address set (not a fixed one),
//   saying which answered, and that a pick isn't running.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startLocalModel, checks, until } from '../lib/harness.mjs'

const { ok, done } = checks('local-models')

const ollama = await startLocalModel('local-models', 'ollama', [
  { name: 'llama3.2:3b', context: 131072, loaded: null, params: '3.2B' },
  { name: 'phi4-reasoning:14b', context: 32768, loaded: 32768, thinks: true, params: '14.7B' },
])
const lms = await startLocalModel('local-models', 'lmstudio', [
  { name: 'google/gemma-3-4b', context: 131072, loaded: 8192, params: '4B' },
  { name: 'mistralai/magistral-small', context: 40000, loaded: 16384, thinks: true, params: '24B' },
  { name: 'ibm/granite-4-h-tiny', context: 131072, loaded: 4096, params: '7B' },
])
// 16 GB of memory: Ollama is asked for 16K at most (a longer context takes memory of its own).
const kit = await startKit('local-models', { env: { BRIDGE_MACHINE: JSON.stringify({ memGB: 16 }) }, config: { meetings: { autoSummary: false, cleanup: false, nameSpeakers: false } } })
// A call that fails gives { error }, so each check after it still runs (and says what it found).
const consult = (prompt) => kit.api('/consult', { who: 'local', prompt }).catch((e) => ({ error: e.message }))
const err = (p, body, method) => kit.api(p, body, method).then(() => null, (e) => e.message)
const since = (s, n) => s.sent().slice(n)
// A meeting with what was said in it (no recording): [src, seconds, text] rows.
async function meeting(title, rows) {
  const m = await kit.api('/meetings', { title, call: false })
  await kit.api(`/meetings/${m.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${m.id}`)).status === 'done', 15000)
  fs.appendFileSync(path.join(kit.data, 'meetings', m.id, 'transcript.jsonl'), rows.map(([src, t0, text]) => JSON.stringify({ src, t0, t1: t0 + 3, text, engine: 'test' })).join('\n') + '\n')
  return m.id
}
const summary = async (id, model) => {
  await kit.api(`/meetings/${id}/summary`, { model })
  return until(async () => { const m = await kit.api(`/meetings/${id}`); return !m.summarizing && (m.summary || m.summaryError) && m }, 30000)
}

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/providers/ollama', { values: { OLLAMA_HOST: ollama.url } }, 'PUT')
  await kit.api('/providers/lmstudio', { values: { LM_STUDIO_BASE_URL: `${lms.url}/v1` } }, 'PUT')

  // ---------- The Chief of Staff's "local" ----------
  let list = await kit.api('/consult')
  let local = list.find((c) => c.id === 'local')
  ok(local?.available && /^phi4-reasoning:14b \(Ollama, on this computer\)$/.test(local.route) && local.model === 'ollama:phi4-reasoning:14b', 'nothing picked: "local" is the model already running, at the address set in Settings, and says which', local)
  let n = ollama.sent().length
  let r = await consult('What is two and two?')
  let s = since(ollama, n)
  ok(r.text === 'local answer from phi4-reasoning:14b' && r.model === 'ollama:phi4-reasoning:14b' && /Ollama, on this computer/.test(r.route || ''), 'its answer says which model on this computer wrote it', r)
  ok(s.length === 1 && s[0].path === '/api/chat', 'it goes through Ollama\'s own API, which can set the context (its OpenAI-style one can\'t)', s.map((x) => x.path))
  ok(s[0]?.think === false && s[0].thought === false, 'thinking is turned off for it (a model that thinks would otherwise spend minutes first)', s[0])
  ok(s[0]?.num_ctx === 32768, 'and it keeps the context the model is already running with, which is enough (a new size would load it again)', s[0])
  ok(s[0]?.truncate === false, 'a one-off job is never cut short without a word: Ollama is told to refuse instead', s[0])

  await kit.api('/settings', { localModel: 'lmstudio:google/gemma-3-4b' }, 'PATCH')
  local = (await kit.api('/consult')).find((c) => c.id === 'local')
  n = lms.sent().length
  r = await consult('What is two and two?')
  ok(/^google\/gemma-3-4b \(LM Studio, on this computer\)$/.test(local?.route) && r.text === 'local answer from google/gemma-3-4b' && since(lms, n).length === 1, 'a model picked in Settings › Model Providers is the one used, LM Studio\'s too', { route: local.route, r })

  await kit.api('/settings', { localModel: 'ollama:gone:1b' }, 'PATCH')
  r = await consult('What is two and two?')
  ok(/gone:1b isn't running/.test(r.route || '') && r.model === 'ollama:phi4-reasoning:14b', 'a pick that isn\'t there now: another answers, and it says the pick isn\'t running', r)
  const lm = await kit.api('/local-models').catch(() => ({ models: [] }))
  ok(lm.pick === 'ollama:gone:1b' && lm.using === 'ollama:phi4-reasoning:14b' && lm.models.length === 5, 'Settings is told the pick and the one used instead', { pick: lm.pick, using: lm.using })
  const by = Object.fromEntries((lm.models || []).map((m) => [m.id, m]))
  ok(by['ollama:llama3.2:3b']?.context === 16384 && by['ollama:phi4-reasoning:14b']?.context === 32768 && by['lmstudio:google/gemma-3-4b']?.context === 8192 && by['ollama:phi4-reasoning:14b'].thinks, 'and how much each takes at a time: what the model takes, within this computer\'s memory, or what it runs with; LM Studio\'s as loaded', (lm.models || []).map((m) => [m.id, m.context, m.thinks]))
  ok(by['lmstudio:ibm/granite-4-h-tiny']?.context === 4096 && lm.smallest === 8192, 'one loaded with 4,096 tokens is below what meeting notes need, which Settings can say', by['lmstudio:ibm/granite-4-h-tiny'])

  // ---------- The context, sized to the job ----------
  await kit.api('/settings', { localModel: 'ollama:llama3.2:3b' }, 'PATCH')
  n = ollama.sent().length
  const long = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}: the quarterly plan needs one more review before it goes out to everyone.`).join('\n')
  r = await consult(`Summarize this:\n${long}`)
  s = since(ollama, n)
  ok(s.length === 1 && s[0].num_ctx === 16384 && s[0].tokens <= s[0].num_ctx && s[0].cut === false, 'a long question (about 8,000 tokens) gets a context that holds it: 16K, not Ollama\'s 4,096, and nothing is cut', s[0])
  n = ollama.sent().length
  const e = await err('/consult', { who: 'local', prompt: `Summarize this:\n${long}\n${long}\n${long}` })
  ok(/llama3\.2:3b takes 16K tokens at a time, and this needs about \d+K/.test(e || '') && /longer context/.test(e), 'one too long for the model here is said, with what to do', e)
  ok(since(ollama, n).length === 0, 'and nothing is sent (it would come back as an answer to part of it)')

  // ---------- Answers in JSON, held to a schema the second time ----------
  const rows = [['them', 2, 'Here is the agenda.'], ['them', 6, 'What about the budget for next year?']]
  const A = await meeting('Budget review', rows)
  n = ollama.sent().length
  r = await kit.api(`/meetings/${A}/speakers`, { model: 'ollama:llama3.2:3b' }).catch((e) => ({ error: e.message }))
  s = since(ollama, n)
  ok(s.length === 2 && !s[0].format && s[1].format?.type === 'object' && s[1].format.additionalProperties, 'who said what: asked in plain words, then, when the answer isn\'t JSON, once more held to a JSON schema (Ollama\'s format)', s.map((x) => x.format))
  let g = await kit.api(`/meetings/${A}`)
  ok(r.named === 1 && g.transcript.find((l) => /budget/.test(l.text))?.name === 'Priya Shah', 'and the answer held to it is used', { r, names: g.transcript.map((l) => l.name) })

  const B = await meeting('Budget review again', rows)
  n = lms.sent().length
  r = await kit.api(`/meetings/${B}/speakers`, { model: 'lmstudio:mistralai/magistral-small' }).catch((e) => ({ error: e.message }))
  s = since(lms, n)
  ok(s[0]?.path === '/api/v1/chat' && s[0].reasoning === 'off', 'LM Studio, a model that thinks: asked through its own API with reasoning off', s[0])
  ok(s[1]?.path === '/v1/chat/completions' && s[1].response_format?.type === 'json_schema' && s[1].response_format.json_schema?.schema?.type === 'object', 'then held to a JSON schema (response_format json_schema)', s[1])
  g = await kit.api(`/meetings/${B}`)
  ok(r.named === 1 && g.transcript.find((l) => /budget/.test(l.text))?.name === 'Priya Shah', 'and the answer, written after its <think>…</think>, is read without the reasoning', r)

  // ---------- Too small for the job ----------
  const C = await meeting('Too small', [['you', 1, 'Line 1 of a short meeting.']])
  n = lms.sent().length
  g = await summary(C, 'lmstudio:ibm/granite-4-h-tiny')
  ok(/granite-4-h-tiny takes 4096 tokens at a time, too few for meeting notes/.test(g?.summaryError || '') && /give it 8192 or more in LM Studio/.test(g.summaryError), 'a model LM Studio loaded with 4,096 tokens: notes aren\'t tried, and it says what to change in LM Studio', g?.summaryError)
  ok(since(lms, n).length === 0, 'nothing was sent to it')
} finally {
  kit.stop()
  ollama.stop()
  lms.stop()
}
process.exit(done().fail ? 1 : 0)
