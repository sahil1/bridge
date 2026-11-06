// One usage view across every provider (server/usagelog.js, usageall.js, agenttokens.js, prices.js;
// src/components/UsageEverywhere.jsx), the trial usage-everywhere, in the browser named by
// BRIDGE_TEST_BROWSER.
//   What each answer took, a line each in the data folder's usage/ (on whether the trial is or not):
//   tokens in and out as each kind of answer says them: an OpenAI-style API (usage, its cache, the
//   model it says answered), Anthropic (input without the cache, so the cache is added), Ollama
//   (prompt_eval_count, eval_count), LM Studio (its own chat's stats, and its OpenAI-style usage),
//   the local model built in (llama-server's timings), Claude Code's print mode (--output-format
//   json: its usage by model) and an answer that says nothing; the part of Bridge AI that asked
//   (meeting notes, a question, edit by voice); and the seconds. Never in the usage counts sent.
//   Old months taken out; a month that's full says so.
//   The view: off until the trial is on (its route refused, nothing on the page); then every
//   provider with tokens by model, day and feature, the cost of what an API key used at the pinned
//   prices, the time on this computer, and the other agents' own logs (Gemini CLI's and Qwen Code's
//   counts, Copilot CLI's at a session's end or out only, Cursor Agent's none) each saying when it
//   has no counts. Each row's name whole (never cut off), its numbers with their units, a chart with
//   a round scale, a provider picked saying so with the way back, the prices' month by name. On a
//   phone too, nothing wider than the screen and whole targets.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { startKit, startLocalModel, checks, until, browser, page, shot, phoneFaults, freePort, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('usage-everywhere')
const month = (d) => d.toLocaleDateString('en-CA').slice(0, 7)
const now = new Date()
const MONTH = month(now)
const LAST = month(new Date(now.getFullYear(), now.getMonth() - 1, 15))
const ago = (min) => new Date(Date.now() - min * 60000).toISOString()

// An OpenAI-style API and Anthropic's, as they answer: with what each answer took (model "quiet":
// an answer that doesn't say).
const asked = []
const fake = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const b = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    asked.push({ url: req.url, model: b.model })
    const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.url === '/v1/chat/completions') {
      const say = { choices: [{ message: { role: 'assistant', content: '## Summary\n- Notes from the OpenAI-style stand-in.' } }] }
      if (b.model === 'quiet') return j(say)
      return j({ ...say, model: 'gpt-5-2025-08-07', usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_tokens_details: { cached_tokens: 400 } } })
    }
    if (req.url === '/v1/messages') return j({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: '## Summary\n- Notes from the Anthropic stand-in.' }], stop_reason: 'end_turn', usage: { input_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 120 } })
    if (req.url === '/v1/models') return j({ data: [{ id: 'gpt-5' }] })
    res.writeHead(404).end()
  })
})
const fakePort = await freePort()
await new Promise((r) => fake.listen(fakePort, '127.0.0.1', r))
const FAKE = `http://127.0.0.1:${fakePort}`

const ollama = await startLocalModel('usage-everywhere', 'ollama', [{ name: 'llama3.2:3b', context: 131072, loaded: 8192, params: '3.2B' }])
const lms = await startLocalModel('usage-everywhere', 'lmstudio', [
  { name: 'mistralai/magistral-small', context: 40000, loaded: 16384, thinks: true, params: '24B' },
  { name: 'google/gemma-3-4b', context: 131072, loaded: 8192, params: '4B' },
])

// The local model built in, as downloaded (a small file standing in for it) and the stand-in
// llama-server; a Gemini CLI that answers in print mode; the other agents' own logs, written today.
const GEMMA = 'gemma-4-E2B-it-Q4_0.gguf'
const seed = ({ bin, data, home }) => {
  const models = path.join(path.dirname(bin), 'llm-models.json')
  fs.writeFileSync(models, JSON.stringify({ 'gemma-4-e2b': { files: [{ name: GEMMA, bytes: 1024, sha256: '0'.repeat(64) }] } }))
  fs.mkdirSync(path.join(data, 'models', 'llm', 'gemma-4-e2b'), { recursive: true })
  fs.writeFileSync(path.join(data, 'models', 'llm', 'gemma-4-e2b', GEMMA), Buffer.alloc(1024))
  // The usage log: a month long gone, and last month's (kept).
  fs.mkdirSync(path.join(data, 'usage'), { recursive: true })
  fs.writeFileSync(path.join(data, 'usage', 'answers-2024-01.jsonl'), `${JSON.stringify({ t: '2024-01-10T10:00:00.000Z', route: 'openai', model: 'gpt-5', feature: 'chat', in: 1, out: 1, s: 1 })}\n`)
  fs.writeFileSync(path.join(data, 'usage', `answers-${LAST}.jsonl`), `${JSON.stringify({ t: new Date(now.getFullYear(), now.getMonth() - 1, 15, 12).toISOString(), route: 'openai', model: 'gpt-5', feature: 'chat', in: 10, out: 5, s: 1 })}\n`)
  const w = (f, lines) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n') }
  // Gemini CLI: an answer written twice (as its tools finish): the last one counts.
  w(path.join(home, '.gemini', 'tmp', 'proj', 'chats', 'session-2026-11-04T10-00-ab12cd34.jsonl'), [
    { sessionId: 'ab12cd34-0000', projectHash: 'proj', startTime: ago(60) },
    { id: 'u1', type: 'user', timestamp: ago(60), content: 'Fix the build' },
    { id: 'g1', type: 'gemini', timestamp: ago(59), content: 'Looking.', model: 'gemini-2.5-pro', tokens: { input: 100, output: 10, cached: 0, thoughts: 0, tool: 0, total: 110 } },
    { id: 'g1', type: 'gemini', timestamp: ago(59), content: 'Looking. Fixed it.', model: 'gemini-2.5-pro', tokens: { input: 4000, output: 300, cached: 1000, thoughts: 200, tool: 0, total: 4500 } },
  ])
  // Qwen Code: assistant entries with the Gemini API's counts.
  w(path.join(home, '.qwen', 'projects', '-work-app', 'chats', 'q1.jsonl'), [
    { uuid: 'a', parentUuid: null, sessionId: 'q1', timestamp: ago(50), type: 'user', message: { role: 'user', parts: [{ text: 'Hi' }] } },
    { uuid: 'b', parentUuid: 'a', sessionId: 'q1', timestamp: ago(49), type: 'assistant', model: 'qwen3-coder-plus', message: { role: 'model', parts: [{ text: 'Hello' }] }, usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 500, thoughtsTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 2500 } },
  ])
  // Copilot CLI: one session ended (its totals by model), one still going (tokens out only).
  w(path.join(home, '.copilot', 'session-state', 's-ended-0001', 'events.jsonl'), [
    { type: 'session.start', data: { sessionId: 's-ended-0001', context: { cwd: home } }, timestamp: ago(40) },
    { type: 'assistant.message', data: { content: 'Done', outputTokens: 70 }, timestamp: ago(39) },
    { type: 'session.shutdown', data: { modelMetrics: { 'gpt-5': { requests: { count: 2, cost: 2 }, usage: { inputTokens: 3000, outputTokens: 70, cacheReadTokens: 0, cacheWriteTokens: 0 } } }, currentModel: 'gpt-5' }, timestamp: ago(38) },
  ])
  w(path.join(home, '.copilot', 'session-state', 's-going-0002', 'events.jsonl'), [
    { type: 'session.start', data: { sessionId: 's-going-0002', context: { cwd: home } }, timestamp: ago(30) },
    { type: 'assistant.message', data: { content: 'Working', outputTokens: 40 }, timestamp: ago(29) },
  ])
  // Cursor Agent: its transcripts keep no counts.
  w(path.join(home, '.cursor', 'projects', 'work-app', 'agent-transcripts', 'c-0001-abcd', 'c-0001-abcd.jsonl'), [{ role: 'user', message: { content: 'Hi' } }, { role: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }])
  return {
    OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${FAKE}/v1`, ANTHROPIC_API_KEY: 'sk-ant-test', BRIDGE_ANTHROPIC_URL: FAKE,
    BRIDGE_MACHINE: JSON.stringify({ memGB: 16 }), BRIDGE_LLM_MODELS: models, BRIDGE_LLAMA_SERVER: path.join(TEST, 'stand-ins', 'llama-server.mjs'), BRIDGE_LLM_IDLE_MS: '1500',
  }
}
const kit = await startKit('usage-everywhere', { env: seed, config: { meetings: { autoSummary: false, cleanup: false, nameSpeakers: false } } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
kit.program('gemini', `const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('0.64.0'); process.exit(0) }
if (a[0] === '-p') { process.stdout.write('## Summary\\n- Notes from the Gemini CLI stand-in.\\n'); process.exit(0) }
setInterval(() => {}, 1 << 30)
`)
const err = (p) => kit.api(p).then(() => null, (e) => e)
const lines = () => { try { return fs.readFileSync(path.join(kit.data, 'usage', `answers-${MONTH}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const lineOf = (route, model, feature) => lines().find((l) => l.route === route && l.model === model && (!feature || l.feature === feature))
async function meeting(title) {
  const m = await kit.api('/meetings', { title, call: false })
  await kit.api(`/meetings/${m.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${m.id}`)).status === 'done', 15000)
  fs.appendFileSync(path.join(kit.data, 'meetings', m.id, 'transcript.jsonl'), `${JSON.stringify({ src: 'you', t0: 1, t1: 4, text: 'We agreed to ship on Friday.', engine: 'test' })}\n`)
  return m.id
}
const notes = async (model) => {
  const id = await meeting(`Notes by ${model}`)
  await kit.api(`/meetings/${id}/summary`, { model })
  return until(async () => { const m = await kit.api(`/meetings/${id}`); return !m.summarizing && (m.summary || m.summaryError) && m }, 30000)
}
// Today's Usage card, then its Usage tab (Stats, patterns and history), on a computer or a phone.
const usageCard = async (pg) => {
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-card', { detail: { id: 'gauge' } })))
  await pg.locator('.usage-card').first().waitFor({ timeout: 15000 })
}
const usageTab = async (pg) => {
  await usageCard(pg)
  await pg.locator('.usage-card button', { hasText: 'Stats, patterns and history' }).first().click()
  await pg.locator('.ustats').first().waitFor({ timeout: 15000 })
}
const pages = []
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog') // the stand-in agents, looked for again
  await kit.api('/providers/ollama', { values: { OLLAMA_HOST: ollama.url } }, 'PUT')
  await kit.api('/providers/lmstudio', { values: { LM_STUDIO_BASE_URL: `${lms.url}/v1` } }, 'PUT')

  // ---------- Off until it's turned on ----------
  ok((await kit.api('/config')).trials?.['usage-everywhere'] === false, 'a beta feature, off to start with', (await kit.api('/config')).trials)
  const off = await err('/usage-everywhere')
  ok(off?.status === 404 && off.j?.trial === 'usage-everywhere' && /beta feature/.test(off.message), 'its route says how to turn it on', off?.message)

  // ---------- Each answer, a line (whether the trial is on or not) ----------
  for (const model of ['openai:gpt-5', 'anthropic:claude-sonnet-5-5', 'openai:quiet', 'cli:claude', 'cli:gemini']) {
    const m = await notes(model)
    ok(!!m?.summary && !m.summaryError && m.summaryModel === model, `meeting notes written by ${model}`, m && { model: m.summaryModel, error: m.summaryError })
  }
  const consult = (model) => kit.api('/consult', { who: 'local', prompt: 'What is two and two?', model }).catch((e) => ({ error: e.message }))
  for (const model of ['ollama:llama3.2:3b', 'lmstudio:mistralai/magistral-small', 'lmstudio:google/gemma-3-4b']) {
    const r = await consult(model)
    ok(r.model === model && !!r.text, `a question answered by ${model}`, r)
  }
  const edit = await kit.api('/dictation/edit', { text: 'teh plan is fine', instruction: 'make it louder' }).catch((e) => ({ error: e.message }))
  ok(edit.text === 'TEH PLAN IS FINE', 'edit by voice, by the local model built in', edit)
  await until(() => lines().length >= 9, 10000)

  const oa = lineOf('openai', 'gpt-5', 'meetings')
  ok(oa?.in === 1000 && oa.out === 200 && oa.cached === 400 && oa.served === 'gpt-5-2025-08-07' && oa.s > 0, 'an OpenAI-style answer: its usage (tokens in, out and cached), the model it says answered, and the seconds', oa)
  const an = lineOf('anthropic', 'claude-sonnet-5-5', 'meetings')
  ok(an?.in === 1250 && an.out === 120 && an.cached === 1000 && an.written === 200, "an Anthropic answer: input, plus what was read from and written to its cache, and output", an)
  const quiet = lineOf('openai', 'quiet')
  ok(quiet && quiet.in === null && quiet.out === null && quiet.feature === 'meetings', "an answer that doesn't say what it took: a line, with no counts", quiet)
  const cc = lineOf('cli', 'claude', 'meetings')
  ok(cc?.in === 2312 && cc.out === 150 && cc.cached === 2000 && cc.written === 300 && cc.served === 'claude-opus-5-5', "a Claude Code sign-in's print mode, asked for JSON: its usage by model", cc)
  const runs = fs.readFileSync(path.join(kit.home, 'claude-print.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  ok(runs.length > 0 && runs.every((r) => r.json), 'Claude Code was asked for --output-format json', runs)
  const gm = lineOf('cli', 'gemini', 'meetings')
  ok(gm && gm.in === null && gm.out === null, "Gemini CLI's print mode says no counts: a line without them", gm)
  const ol = lineOf('ollama', 'llama3.2:3b', 'consult')
  ok(ol?.in > 0 && ol.out === 120, "Ollama: prompt_eval_count and eval_count, for a question (consult)", ol)
  const mg = lineOf('lmstudio', 'mistralai/magistral-small', 'consult')
  ok(mg?.in > 0 && mg.out === 80 && lms.sent().some((x) => x.path === '/api/v1/chat'), "LM Studio's own chat: its stats", mg)
  const gg = lineOf('lmstudio', 'google/gemma-3-4b', 'consult')
  ok(gg?.in > 0 && gg.out > 0, "LM Studio's OpenAI-style API: its usage", gg)
  const br = lineOf('bridge', 'gemma-4-e2b', 'voice-edit')
  ok(br?.in === 300 && br.out === 80, "the local model built in: llama-server's timings, for edit by voice", br)
  ok(lines().every((l) => typeof l.t === 'string' && typeof l.s === 'number' && l.route && l.feature), 'every line: when, the route, the feature and the seconds', lines().slice(0, 3))

  // Never part of the usage counts sent.
  const preview = JSON.stringify(await kit.api('/counts/preview').catch(() => ({})))
  ok(!/gpt-5|claude-sonnet|tokens|usage-everywhere/i.test(preview), 'none of it is in the usage counts report', preview.slice(0, 400))
  // Old months taken out, last month kept.
  ok(!fs.existsSync(path.join(kit.data, 'usage', 'answers-2024-01.jsonl')) && fs.existsSync(path.join(kit.data, 'usage', `answers-${LAST}.jsonl`)), "the usage log keeps this month and the twelve before: older ones are taken out", fs.readdirSync(path.join(kit.data, 'usage')))

  // ---------- The view ----------
  await kit.api('/settings', { trials: { 'usage-everywhere': true } }, 'PATCH')
  const v = await kit.api('/usage-everywhere?days=7')
  const src = (id) => v.sources.find((s) => s.id === id)
  const rows = (id, f) => v.rows.filter((r) => r[1] === id && (!f || r[3] === f))
  const sum = (rs, i) => rs.reduce((s, r) => s + (r[i] || 0), 0)
  ok(['openai', 'anthropic', 'ollama', 'lmstudio', 'bridge', 'cli:claude', 'cli:gemini', 'cli:qwen', 'cli:copilot', 'cli:cursor'].every((id) => src(id)), 'every provider used is in it: keys, models on this computer, sign-ins and the other agents', v.sources.map((s) => s.id))
  ok(src('openai').label === 'OpenAI' && src('openai').via === 'key' && src('ollama').via === 'local' && src('cli:claude').label === 'Claude Code' && src('cli:claude').via === 'agent', 'each named as people know it, and how it was reached', v.sources.map((s) => `${s.id}=${s.label}/${s.via}`))
  ok(Math.abs(sum(rows('openai'), 7) - 0.0028) < 1e-9 && Math.abs(sum(rows('anthropic'), 7) - 0.002) < 1e-9, 'the cost of what the API keys used, at the pinned prices (the cache read and written at its own price)', { openai: sum(rows('openai'), 7), anthropic: sum(rows('anthropic'), 7) })
  ok(src('openai').uncounted === 1, "the answer that didn't say is counted as one", src('openai'))
  ok(rows('ollama').every((r) => r[8] > 0) && rows('bridge').every((r) => r[8] > 0) && rows('openai').every((r) => r[8] === null), 'the time is for the models on this computer', { ollama: rows('ollama'), openai: rows('openai') })
  ok(sum(rows('cli:claude', 'meetings'), 4) === 2462, "Claude Code's run for meeting notes is in its feature", rows('cli:claude'))
  ok(rows('bridge', 'voice-edit').length === 1 && rows('ollama', 'consult').length === 1, 'and each answer under the feature that asked', v.rows.map((r) => `${r[1]}:${r[3]}`))
  ok(sum(rows('cli:gemini', 'agents'), 4) === 4500 && src('cli:gemini').uncounted === 1 && src('cli:gemini').counts === 'yes', "Gemini CLI: its own logs' counts (an answer written again counts once), and its one-shot answer that didn't say", { rows: rows('cli:gemini'), s: src('cli:gemini') })
  ok(sum(rows('cli:qwen'), 4) === 2500 && rows('cli:qwen')[0]?.[2] === 'qwen3-coder-plus', "Qwen Code: its logs' counts, by model", rows('cli:qwen'))
  ok(sum(rows('cli:copilot'), 4) === 3070 + 40 && src('cli:copilot').counts === 'partial', 'Copilot CLI: an ended session by model, and one still going with only its tokens out (said)', { rows: rows('cli:copilot'), s: src('cli:copilot') })
  ok(src('cli:cursor').counts === 'none' && !rows('cli:cursor').length, "Cursor Agent: its logs keep no counts, and it says so", src('cli:cursor'))
  ok(!v.log.error && !v.log.full && v.pricesAsOf, 'the record is written, with the date its prices are from', v.log)

  // ---------- The page ----------
  const w = await page(b, kit.url, { width: 1400, height: 900 })
  pages.push(w)
  const p = w.p
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
  const trial = p.locator('.st-check', { hasText: 'Usage Across Every Provider' }).locator('input')
  await trial.waitFor({ timeout: 15000 })
  await until(async () => !(await trial.isDisabled()), 10000)
  ok(await trial.isChecked(), 'Settings › About & Updates › Beta Features: Usage Across Every Provider, on')
  await trial.uncheck()
  await until(async () => (await kit.api('/config')).trials?.['usage-everywhere'] === false, 8000)
  await p.locator('button[aria-label="Close settings"]').click()
  await usageCard(p)
  await p.waitForTimeout(1500)
  ok((await p.locator('.ue-brief').count()) === 0, 'turned off: not in the usage panel')
  await usageTab(p)
  await p.waitForTimeout(1500)
  ok((await p.locator('.ue').count()) === 0, 'nor in Today › Usage')
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
  await trial.waitFor({ timeout: 15000 })
  await until(async () => !(await trial.isDisabled()), 10000)
  await trial.check()
  await until(async () => (await kit.api('/config')).trials?.['usage-everywhere'] === true, 8000)
  await p.locator('button[aria-label="Close settings"]').click()
  await usageCard(p)
  const brief = p.locator('.usage-card .ue-brief')
  ok(!!(await until(() => brief.isVisible(), 15000)) && /Last 7 days/.test(await brief.innerText()), "turned on, the usage panel has the last week across every provider", await brief.innerText().catch(() => ''))
  await usageTab(p)
  const view = p.locator('.ue')
  ok(!!(await until(() => view.isVisible(), 15000)), 'turned on: Today › Usage has Every Provider')
  await view.locator('[data-source="cli:cursor"]').waitFor({ timeout: 15000 })
  const say = (id) => view.locator(`[data-source="${id}"]`).innerText().then((x) => x.replace(/\s+/g, ' '))
  ok(/Cursor Agent's logs don't record tokens/.test(await say('cli:cursor')), 'Cursor Agent says it has no counts', await say('cli:cursor'))
  ok(/didn't say how many tokens it took: its one-shot mode doesn't report them/.test(await say('cli:gemini')), "Gemini CLI says its one-shot answer didn't say", await say('cli:gemini'))
  ok(/only the tokens out until a session ends/.test(await say('cli:copilot')), 'Copilot CLI says some sessions count tokens out alone', await say('cli:copilot'))
  const via = (id) => view.locator(`[data-source="${id}"] .ue-name`).getAttribute('title')
  ok(/OpenAI/.test(await say('openai')) && /API key/.test(await via('openai')) && /on this computer/.test(await via('ollama')) && /\$0\.00|<\$0\.01/.test(await say('openai')), 'OpenAI: by API key, with its cost; Ollama on this computer', [await say('openai'), await via('openai'), await via('ollama')])
  const feats = await view.locator('[data-feature]').evaluateAll((xs) => xs.map((x) => x.getAttribute('data-feature')))
  ok(['meetings', 'consult', 'voice-edit', 'agents'].every((f) => feats.includes(f)), 'by feature: meeting notes, questions, edit by voice, and the agents\' own work', feats)
  ok(/Time on this computer/.test(await view.innerText()) && /Cost on API keys/.test(await view.innerText()), 'tiles for the cost on API keys and the time on this computer')
  const tileVals = (await view.locator('.us-tile-val').allInnerTexts()).map((x) => x.trim())
  ok(/^\d+ s$|^\d+ min$|^\d+ h \d+ min$/.test(tileVals[2]), 'the time on this computer with its unit spelled out (3 s, not 3s)', tileVals)
  const times = await view.locator('[data-source="ollama"] .ue-nums .muted').allInnerTexts()
  ok(times.length === 1 && /^\d+ s$/.test(times[0]), "and so on a provider's row", times)
  // No name cut off: a long one goes onto another line instead.
  const cut = await view.evaluate((el) => [...el.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.textContent.slice(0, 40)))
  ok(!cut.length && (await view.locator('.ue-row').count()) > 10, 'nothing in it cut off with … at the width of the Today panel: every provider, model and feature whole', cut)
  // The chart: a round scale (0, half, the top), each label short.
  const ys = (await view.locator('.ue-days svg .axis-label').allTextContents()).slice(0, 3)
  ok(/^Tokens a day$/.test(await view.locator('.ue-days h5').innerText()) && ys[0] === '0' && ys.slice(1).every((x) => /^\d+(\.\d)?[KMB]?$/.test(x)), 'the chart says what it shows, with a round scale (no 656.2K)', ys)
  ok(/at list prices as of [A-Z][a-z]+ \d{4};/.test(await view.locator('.us-src').innerText()), "the prices' month by name, not 2026-10", await view.locator('.us-src').innerText())
  // A provider picked: the rest of the view is its alone, and it says so.
  await view.locator('[data-source="cli:qwen"] button').click()
  ok(!!(await until(async () => /qwen3-coder-plus/.test(await view.locator('.ue-part').nth(1).innerText()) && !/gpt-5/.test(await view.locator('.ue-part').nth(1).innerText()), 5000)), 'a provider picked: its models alone')
  ok(/Showing Qwen Code only/.test(await view.locator('.ue-picked').innerText().catch(() => '')), 'and it says whose numbers these are', await view.locator('.ue-picked').innerText().catch(() => ''))
  await view.locator('.ue-picked button', { hasText: 'Show every provider' }).click()
  ok(!!(await until(async () => !(await view.locator('.ue-picked').count()) && /gpt-5/.test(await view.locator('.ue-part').nth(1).innerText()), 5000)), 'Show every provider: all of them again')
  await shot(p, `${tag}usage-everywhere`)
  ok(w.errors.length === 0, 'no page errors', w.errors)

  // On a phone: Today › Usage has it, and nothing is wider than the screen.
  const ph = await page(b, kit.url, { phone: true })
  pages.push(ph)
  await ph.p.waitForSelector('.tabbar button', { timeout: 15000 })
  await usageTab(ph.p)
  const pv = ph.p.locator('.ue')
  ok(!!(await until(() => pv.isVisible(), 15000)), 'on a phone: Today › Usage has Every Provider')
  await pv.locator('[data-source="cli:cursor"]').waitFor({ timeout: 15000 })
  await pv.scrollIntoViewIfNeeded()
  const faults = await phoneFaults(ph.p, '.ustats')
  ok(!faults.wider && !faults.past && !faults.sideways, 'and nothing wider than the screen', faults)
  const own = await phoneFaults(ph.p, '.ue')
  ok(!Object.keys(own).length, 'Every Provider itself: whole 40 px targets (the range, each provider), nothing cut off', own)
  await shot(ph.p, `${tag}usage-everywhere-phone`)
  ok(ph.errors.length === 0, 'no page errors on the phone', ph.errors)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); ollama.stop(); lms.stop()
}

// A month's record that fills up says so, and keeps what it had.
const full = await startKit('usage-everywhere-full', { env: { BRIDGE_USAGE_LOG_MAX: '400', OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${FAKE}/v1` }, config: { trials: { 'usage-everywhere': true } } })
try {
  await full.api('/setup', { name: 'Tester' })
  await full.api('/settings', { dictation: { editModel: 'openai:gpt-5' } }, 'PATCH')
  for (let i = 0; i < 4; i++) await full.api('/dictation/edit', { text: 'teh plan', instruction: 'fix it' }).catch(() => null)
  const v = await until(async () => { const x = await full.api('/usage-everywhere?days=7'); return x.log.full && x }, 8000)
  const file = path.join(full.data, 'usage', `answers-${MONTH}.jsonl`)
  ok(v?.log.full?.month === MONTH && fs.statSync(file).size <= 400 && fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length >= 1, "a month's record that's full stops there, and says since when", v?.log)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(full.log().slice(-1500))
} finally {
  full.stop(); fake.close()
}
process.exit(done().fail ? 1 : 0)
