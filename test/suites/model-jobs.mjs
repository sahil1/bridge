// A model for each kind of job (server/modeljobs.js, modellist.js; Settings › Agents & Models ›
// Which Model Does What › Models for Each Task), with the stand-in model as OpenAI, a stand-in Ollama (stand-ins/
// local-model.mjs), a stand-in for Anthropic's API here that can say it's over its limit, and LM
// Studio not running. Nothing goes to a real provider: a model whose key isn't there is passed over
// before it's tried.
//   The shared list (modellist.js): why one can't run now (no key, by its provider's name; its server
//   here not running; not downloaded; not signed in), the same words for a bot's What Answers; each
//   in turn, the next at once, a prompt too long not passed on.
//   A job's own list (modeljobs.js): kept as ids, each once, at most six; its first that can run now,
//   the ones before it passed over with why; none, an error saying why rather than anything else.
//   The server: every model and the providers a key would reach, to pick from; the pick used for
//   meeting notes, diagrams and AI Assist; a notes model picked as Meetings & Voice had it going
//   first in Meeting notes' row (sent, or saved before and moved as Bridge AI starts), for the notes
//   only (live AI Assist, the board and the cleanup on their own rows), and a meeting's own pick for
//   its notes still first; a provider over its limit and one with no key passed over for the
//   next, each said in the job's last run, the usage log and under the notes; a list none of which
//   can run says so and runs nothing; a model on this computer that can't run never goes elsewhere
//   unless the list says so.
//   Settings › Agents & Models › Which Model Does What: a row for each job, Automatic with where it runs, the picker by
//   provider and searchable, a model with no key yet opening its provider's key form there and the
//   row saying it can't run until there's one, fallbacks added, moved and removed, back to
//   Automatic, the last run; on a phone's screen too, with nothing wider than it.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { startKit, startModel, startLocalModel, checks, until, OUT, IS_MAC, freePort, browser, page, shot } from '../lib/harness.mjs'

const { ok, done } = checks('model-jobs')
const KINDS = IS_MAC ? 6 : 5 // (Mail's only where there's Mail)

// ---------- The shared list and a job's own (in this process) ----------
process.env.BRIDGE_HOME = path.join(OUT, 'kits', 'model-jobs-rules')
const list = await import('../../server/modellist.js')
const jobs = await import('../../server/modeljobs.js')
const botanswer = await import('../../server/botanswer.js')
const reached = [{ id: 'openai:gpt-5', label: 'gpt-5', provider: 'OpenAI', via: 'key' }, { id: 'ollama:gemma3:4b', label: 'gemma3:4b', provider: 'Ollama, on this computer', via: 'local' }]
const named = (route) => ({ groq: 'Groq', together: 'Together AI' }[route] || route)
ok(list.whyNot('openai:gpt-5', reached) === null && list.whyNot('groq:llama-3.3-70b-versatile', reached, named) === 'llama-3.3-70b-versatile isn\'t set up here: no Groq key for it in Model Providers', 'why one can\'t run: none for one reached; no key, by its provider\'s name', list.whyNot('groq:llama-3.3-70b-versatile', reached, named))
ok(/isn't running on this computer$/.test(list.whyNot('lmstudio:gemma3', reached)) && /gemma-4-e2b isn't downloaded on this computer$/.test(list.whyNot('bridge:gemma-4-e2b', reached)) && /isn't signed in here$/.test(list.whyNot('cli:codex', reached)), 'its server here not running, the local model built in not downloaded, a sign-in not signed in')
ok(botanswer.notReady(botanswer.entryOf('model:groq:llama-3.3-70b-versatile'), { models: reached }) === list.whyNot('groq:llama-3.3-70b-versatile', reached) && botanswer.labelOf(botanswer.entryOf('model:openai:gpt-5'), reached) === list.labelOf('openai:gpt-5', reached), 'a bot\'s What Answers says the same, from the same list (botanswer.js)')
ok(JSON.stringify(list.after(['a:1', 'b:2', 'c:3'], 'b:2')) === '["c:3"]' && list.after(['a:1'], 'z:9') === null && list.after(null, 'a:1') === null, 'the rest of a list after one in it; none when it isn\'t in it')
let r = await list.inTurn(['groq:x', 'openai:gpt-5', 'ollama:gemma3:4b'], async (id) => { if (id === 'openai:gpt-5') throw new Error('HTTP 503'); return { text: `from ${id}` } }, { ready: reached, provider: named })
ok(r.model === 'ollama:gemma3:4b' && r.text === 'from ollama:gemma3:4b' && r.passed.length === 2 && /no Groq key/.test(r.passed[0].why) && r.passed[1].why === 'gpt-5 · OpenAI couldn\'t answer: HTTP 503', 'each in turn: one with no key passed over, one that fails passed on, the next answers, and why for each', r)
const tooLong = await list.inTurn(['openai:gpt-5', 'ollama:gemma3:4b'], async () => { throw Object.assign(new Error('too long'), { code: 'too_long' }) }, { ready: reached, stop: (e) => e.code === 'too_long' }).catch((e) => e)
ok(tooLong.code === 'too_long', 'a prompt too long isn\'t passed on: it goes again in pieces')
ok(JSON.stringify(jobs.listOf({ jobModels: { notes: ['together:meta-llama/x', 'together:meta-llama/x', 'no id', 7, 'openai:gpt-5', 'a:1', 'b:2', 'c:3', 'd:4', 'e:5'] } }, 'notes')) === '["together:meta-llama/x","openai:gpt-5","a:1","b:2","c:3","d:4"]' && jobs.listOf({ jobModels: { notes: [] } }, 'notes') === null && jobs.listOf({}, 'mail') === null, 'a job\'s own list: ids each once, at most six; empty or none is Automatic')
r = jobs.fromList({ job: 'notes', own: ['groq:llama-3.3-70b-versatile', 'openai:gpt-5'], models: reached, provider: named })
ok(r.id === 'openai:gpt-5' && r.picked && r.where === 'cloud' && r.passed.length === 1 && /no Groq key/.test(r.passed[0].why), 'its first that can run now, the one before it passed over with why', r)
r = jobs.fromList({ job: 'notes', own: ['groq:llama-3.3-70b-versatile'], models: reached, provider: named })
ok(r.error?.code === 'not_ready' && /^Meeting notes can't run: llama-3\.3-70b-versatile isn't set up here: no Groq key for it in Model Providers\./.test(r.error.message), 'none that can run: an error saying why, not a model elsewhere', r.error?.message)
r = jobs.fromList({ job: 'live', own: ['lmstudio:gemma3'], models: reached })
ok(r.error && !r.id, 'a model on this computer that isn\'t running, alone in the list: no cloud model instead', r)

// ---------- The server ----------
// Anthropic's API here: an answer, or over its limit (busy).
const anth = { busy: false, asked: 0 }
const anthSrv = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    anth.asked++
    res.writeHead(anth.busy ? 429 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(anth.busy ? { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited' } } : { content: [{ type: 'text', text: '## Summary\n- Written by the Anthropic stand-in.' }], usage: { input_tokens: 10, output_tokens: 5 } }))
  })
})
const anthPort = await freePort()
await new Promise((res) => anthSrv.listen(anthPort, '127.0.0.1', res))
const model = await startModel('model-jobs')
const ollama = await startLocalModel('model-jobs', 'ollama', [{ name: 'gemma3:4b', context: 32768, loaded: 32768, thinks: false, params: '4B' }])
const kit = await startKit('model-jobs', {
  env: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1`, ANTHROPIC_API_KEY: 'sk-ant-test', BRIDGE_ANTHROPIC_URL: `http://127.0.0.1:${anthPort}`, OLLAMA_HOST: ollama.url, LM_STUDIO_BASE_URL: 'http://127.0.0.1:9/v1' },
  config: { meetings: { autoSummary: false, cleanup: false, nameSpeakers: false } },
})
const MONTH = new Date().toLocaleDateString('en-CA').slice(0, 7)
const usage = () => { try { return fs.readFileSync(path.join(kit.data, 'usage', `answers-${MONTH}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
async function meeting(title) {
  const m = await kit.api('/meetings', { title, call: false })
  await kit.api(`/meetings/${m.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${m.id}`)).status === 'done', 15000)
  fs.appendFileSync(path.join(kit.data, 'meetings', m.id, 'transcript.jsonl'), `${JSON.stringify({ src: 'you', t0: 1, t1: 4, text: 'We agreed to ship on Friday.', engine: 'test' })}\n`)
  return m.id
}
const notes = async (title, model) => {
  const id = await meeting(title)
  await kit.api(`/meetings/${id}/summary`, model ? { model } : {})
  return until(async () => { const m = await kit.api(`/meetings/${id}`); return !m.summarizing && (m.summary || m.summaryError) && m }, 30000)
}
const own = (job, ids) => kit.api('/settings', { jobModels: { [job]: ids } }, 'PATCH')
const jobOf = async (id) => (await kit.api('/model-jobs')).jobs.find((j) => j.id === id)
const openaiAsked = () => model.requests().length
const GROQ = 'groq:llama-3.3-70b-versatile'

let b = null
try {
  await kit.api('/setup', { name: 'Tester' })

  // What there is to pick from.
  let d = await kit.api('/model-jobs')
  ok(d.jobs.length === KINDS && d.jobs.some((j) => j.id === 'mail') === IS_MAC && d.jobs.every((j) => j.own === null && j.last === null) && d.most === 6, 'each kind of job (Mail only where there\'s Mail, a Mac), each on Automatic, none run yet', d.jobs)
  ok(['anthropic:claude-opus-5-5', 'openai:gpt-5', 'ollama:gemma3:4b'].every((id) => d.models.some((m) => m.id === id)), 'every model reached now, the ones on this computer too', d.models.map((m) => m.id))
  ok(d.unkeyed.some((u) => u.route === 'groq' && u.model === GROQ) && d.unkeyed.some((u) => u.route === 'together' && u.model === null) && !d.unkeyed.some((u) => u.route === 'openai' || u.route === 'anthropic') && !d.unkeyed.some((u) => u.route === 'deepseek'), 'and the providers a key would reach, with none yet: Groq\'s usual model, Together AI to add a key for; not those with keys, nor the more models left off', d.unkeyed)

  // A model of its own for meeting notes, used though your cloud models come first otherwise.
  await own('notes', ['ollama:gemma3:4b'])
  let m = await notes('Its own model')
  ok(m.summaryModel === 'ollama:gemma3:4b' && ollama.sent().length > 0 && anth.asked === 0, 'Meeting notes on a model of its own: written by it (Ollama, on this computer), not the cloud model Automatic would use', { model: m.summaryModel, error: m.summaryError })
  ok((await jobOf('notes')).last?.model === 'ollama:gemma3:4b', 'its last run says so')
  // Meeting notes' model has one place, its row here. One picked as Meetings & Voice had it
  // (meetings.model: before 3.22.0, or an app that still sends it) goes first in that row, with the
  // models it fell back on then after it (up to three of the others, in Automatic's order: here
  // Anthropic's, then Ollama's), then what the row had.
  await kit.api('/settings', { meetings: { model: 'openai:gpt-5' } }, 'PATCH')
  let user = (await kit.api('/settings')).user
  ok(JSON.stringify(user.jobModels?.notes) === '["openai:gpt-5","anthropic:claude-opus-5-5","ollama:gemma3:4b"]' && !('model' in (user.meetings || {})), 'a notes model picked as Meetings & Voice had it goes first in Meeting notes\' row, the models it fell back on after it, and nowhere else', { notes: user.jobModels?.notes, meetings: user.meetings })
  let n = openaiAsked()
  m = await notes('Meetings & Voice picks')
  ok(m.summaryModel === 'openai:gpt-5' && openaiAsked() > n, 'and writes the notes', m.summaryModel)
  // It's for the notes only: live AI Assist, the live board and the transcript's cleanup go by their
  // own rows, Automatic here (your first model, Anthropic's), as before; nor does a meeting's own pick
  // for its notes change them. Each row's last run names the model that answered.
  await kit.api('/settings', { trials: { 'meeting-board': true } }, 'PATCH')
  const L = await meeting('Notes picked, the rest their own')
  await kit.api(`/meetings/${L}/summary`, { model: 'openai:gpt-5' })
  await until(async () => { const x = await kit.api(`/meetings/${L}`); return !x.summarizing && (x.summary || x.summaryError) }, 30000)
  const before = anth.asked
  await kit.api(`/meetings/${L}/assist`, {}).catch(() => {})
  await kit.api(`/meetings/${L}/board`, {}).catch(() => {})
  await kit.api(`/meetings/${L}/cleanup`, {}).catch(() => {})
  const rows = Object.fromEntries(await Promise.all(['notes', 'live', 'diagrams', 'tidy'].map(async (j) => [j, (await jobOf(j)).last])))
  ok(rows.notes?.model === 'openai:gpt-5' && (await kit.api(`/meetings/${L}`)).summaryModel === 'openai:gpt-5', 'the notes on the model picked for them, and their row says so', rows.notes)
  ok(['live', 'diagrams', 'tidy'].every((j) => rows[j]?.model === 'anthropic:claude-opus-5-5') && anth.asked >= before + 3, 'live AI Assist, the board and the cleanup on their own rows (Automatic: Anthropic), not the notes\' model, each row naming the model that answered', rows)
  await kit.api('/settings', { trials: { 'meeting-board': false } }, 'PATCH')
  await own('notes', ['ollama:gemma3:4b'])
  // Saved before 3.22.0 (Meetings & Voice's own pick in the file): moved into Meeting notes' row as
  // Bridge AI starts, with what it fell back on then; the other rows as they were.
  await own('diagrams', ['openai:gpt-5'])
  await kit.restart(() => {
    const f = path.join(kit.data, 'config.json')
    const c = JSON.parse(fs.readFileSync(f, 'utf8'))
    fs.writeFileSync(f, JSON.stringify({ ...c, meetings: { ...c.meetings, model: 'anthropic:claude-opus-5-5' } }))
  })
  user = await until(async () => { const u = (await kit.api('/settings')).user; return !('model' in (u.meetings || {})) && u }, 10000)
  ok(JSON.stringify(user?.jobModels?.notes) === '["anthropic:claude-opus-5-5","openai:gpt-5","ollama:gemma3:4b"]' && JSON.stringify(user.jobModels?.diagrams) === '["openai:gpt-5"]' && !user.jobModels?.live, 'one saved before: in Meeting notes\' row once Bridge AI starts, with the models it fell back on, the other rows as they were', user && { jobModels: user.jobModels, meetings: user.meetings })
  // It falls back as it did: over its limit, the next one writes the notes, and the row says which.
  anth.busy = true
  m = await notes('Its pick over its limit')
  const moved = (await jobOf('notes')).last
  ok(m.summaryModel === 'openai:gpt-5' && !m.summaryError && moved?.model === 'openai:gpt-5' && moved.passed?.[0]?.id === 'anthropic:claude-opus-5-5' && /over your limit/.test(moved.passed[0].why), 'the pick moved there over its limit: the next one writes the notes, and the row\'s last run says which, and why', { model: m.summaryModel, error: m.summaryError, moved })
  anth.busy = false
  await own('diagrams', null)
  await own('notes', ['ollama:gemma3:4b'])
  m = await notes('The meeting picks', 'anthropic:claude-opus-5-5')
  ok(m.summaryModel === 'anthropic:claude-opus-5-5', 'a meeting\'s own pick for its notes comes first', m.summaryModel)

  // Diagrams on Anthropic, over its limit for now: the next in its list draws, and why is kept.
  anth.busy = true
  await own('diagrams', ['anthropic:claude-opus-5-5', 'openai:gpt-5'])
  let asked = anth.asked
  let drawn = await kit.api('/boards/draw', { prompt: 'a flowchart of how we ship' })
  let last = (await jobOf('diagrams')).last
  ok(drawn.model === 'openai:gpt-5' && anth.asked > asked && !!drawn.mermaid, 'Diagrams: its model over its limit, so the next in its list drew it', drawn)
  ok(last?.model === 'openai:gpt-5' && last.passed?.[0]?.id === 'anthropic:claude-opus-5-5' && /^claude-opus-5-5 · Anthropic couldn't answer: Anthropic says you're over your limit for now \(Rate limited\)/.test(last.passed[0].why), 'its last run: what drew it, and what couldn\'t and why', last)
  await until(() => usage().some((l) => l.feature === 'board' && l.model === 'gpt-5' && l.instead === 'anthropic:claude-opus-5-5'), 5000, 200)
  const line = usage().find((l) => l.feature === 'board' && l.instead === 'anthropic:claude-opus-5-5')
  ok(!!line && /over your limit/.test(line.why), 'and the usage log: the answer that stood in, for which, and why', line)
  // Meeting notes on Anthropic alone, over its limit: the meeting and the row say why, in words for
  // them (not the chat agent's "/model", which means nothing on a meeting's page).
  await own('notes', ['anthropic:claude-opus-5-5'])
  m = await notes('Over its limit')
  last = (await jobOf('notes')).last
  ok(/over your limit for now \(Rate limited\)\. Try again later, or pick another model\.$/.test(m.summaryError || '') && !/\/model/.test(`${m.summaryError} ${last?.error} ${last?.passed?.[0]?.why}`), 'notes over its limit: the meeting and the row say why, and no "/model"', { error: m.summaryError, last })
  await kit.api(`/meetings/${m.id}`, null, 'DELETE') // (its summary isn't tried again)
  await own('notes', ['ollama:gemma3:4b'])
  anth.busy = false
  // One whose provider has no key: passed over before it's tried.
  await own('diagrams', [GROQ, 'openai:gpt-5'])
  drawn = await kit.api('/boards/draw', { prompt: 'a flowchart of how we review' })
  last = (await jobOf('diagrams')).last
  ok(drawn.model === 'openai:gpt-5' && last?.model === 'openai:gpt-5' && last.passed?.[0]?.id === GROQ && /no Groq key for it/.test(last.passed[0].why), 'a model with no key yet passed over for the next, said in its last run', last)
  // AI Assist: a deck from what it's about, the same way.
  await own('assist', [GROQ, 'openai:gpt-5'])
  const deck = await kit.api('/studio/deck/ai', { mode: 'deck', prompt: 'Shipping on Friday' })
  ok(deck.model === 'openai:gpt-5' && (await jobOf('assist')).last?.passed?.[0]?.id === GROQ, 'AI Assist the same: its deck by the next in its list', { model: deck.model, last: (await jobOf('assist')).last })

  // Its only model has no key: it can't run, says why, and nothing else writes it.
  await own('notes', [GROQ])
  d = await kit.api('/model-jobs')
  ok(/no Groq key for it/.test(d.jobs.find((j) => j.id === 'notes').own?.[0]?.why || ''), 'the row has why it can\'t run', d.jobs.find((j) => j.id === 'notes').own)
  n = openaiAsked()
  asked = anth.asked
  let sent = ollama.sent().length
  m = await notes('No key yet')
  ok(/^Meeting notes can't run: llama-3\.3-70b-versatile isn't set up here: no Groq key for it in Model Providers\. Set it up in Settings › Agents & Models › Model Providers, or set Meeting notes to Automatic in Settings › Agents & Models › Which Model Does What\./.test(m.summaryError || '') && !m.summaryModel, 'Meeting notes with only a model whose key isn\'t there: the meeting says it can\'t run, and why', m.summaryError)
  ok(openaiAsked() === n && anth.asked === asked && ollama.sent().length === sent, 'and nothing else wrote it')

  // A model on this computer that can't run never goes elsewhere, unless its list says so.
  await own('notes', ['ollama:gemma3:4b'])
  ollama.stop()
  await kit.api('/local-models') // (the models there are looked at again)
  n = openaiAsked()
  asked = anth.asked
  m = await notes('Ollama is closed')
  ok(/^Meeting notes can't run: gemma3:4b isn't running on this computer\./.test(m.summaryError || '') && !m.summaryModel && openaiAsked() === n && anth.asked === asked, 'Ollama closed, with only it in the list: no notes, saying why, and no cloud model wrote them', m.summaryError)
  await own('notes', ['ollama:gemma3:4b', 'openai:gpt-5'])
  m = await notes('Ollama is closed, the cloud next')
  ok(m.summaryModel === 'openai:gpt-5' && /gemma3:4b isn't running on this computer, so openai:gpt-5, next in Meeting notes' list, wrote it\./.test(m.summaryNote || ''), 'with the cloud model next in its list: that one, as the list says, and the notes say why', { model: m.summaryModel, note: m.summaryNote })
  last = (await jobOf('notes')).last
  ok(last?.model === 'openai:gpt-5' && last.passed?.[0]?.id === 'ollama:gemma3:4b', 'its last run says the one on this computer couldn\'t', last)

  // What's saved is held to ids, each once.
  await own('tidy', ['not an id', 'openai:gpt-5', 'openai:gpt-5'])
  ok(JSON.stringify((await jobOf('tidy')).own?.map((e) => e.id)) === '["openai:gpt-5"]', 'a list saved by hand: ids only, each once', (await jobOf('tidy')).own)
  await own('tidy', null)
  await own('notes', null)
  await own('assist', null)

  // ---------- Settings › Agents & Models › Which Model Does What ----------
  const here = ((x) => x.offered || x.anyHere)(await kit.api('/model-jobs'))
  ;({ b } = await browser())
  const which = b.browserType().name()
  const openJobs = async (p) => {
    await p.waitForSelector('.rail-nav-btn, body', { timeout: 30000 }).catch(() => {})
    await until(async () => {
      if (!(await p.locator('.modal.settings').count())) await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'model-jobs' } })))
      return (await p.locator('[data-model-jobs] li[data-job]').count()) === KINDS
    }, 45000, 1500)
  }
  const saved = async () => (await kit.api('/settings')).user.jobModels || {}
  const { ctx, p, errors } = await page(b, kit.url)
  await openJobs(p)
  ok((await p.locator('.st-tabs [role="tab"][aria-selected="true"]').innerText()).trim() === 'Which Model Does What', 'Models for Each Task is in Agents & Models › Which Model Does What')
  const box = p.locator('[data-model-jobs]')
  const row = box.locator('li[data-job="notes"]')
  ok(/Models for Each Task/.test(await box.locator('h4').innerText()) && /Automatic/.test(await row.locator('.pv-job-model').innerText()) && (await row.locator('select').count()) === (here ? 1 : 0) && /\S/.test(await row.locator('[data-job-now]').innerText()), 'Models for Each Task: Meeting notes on Automatic, with where it runs and what it runs on now', await row.innerText())
  ok(/Last run .* on gpt-5: llama-3\.3-70b-versatile isn't set up here: no Groq key/.test(await box.locator('li[data-job="diagrams"] [data-job-last]').innerText()), 'Diagrams\' last run: what ran it, and why the one before it couldn\'t', await box.locator('li[data-job="diagrams"]').innerText())
  await row.locator('.pv-job-model').click()
  const picker = row.locator('[data-model-pick]')
  await picker.waitFor({ timeout: 5000 })
  const heads = await picker.locator('.pv-pick-head').allInnerTexts()
  ok(['OpenAI', 'Anthropic', 'Groq', 'Together AI'].every((h) => heads.some((x) => x.toLowerCase() === h.toLowerCase())) && (await picker.locator('[data-pick="openai:gpt-5"]').count()) === 1 && (await picker.locator('[data-pick="auto"]').count()) === 1, 'the picker: Automatic, then every model by its provider, and the providers with no key yet', heads)
  ok(/No key yet/.test(await picker.locator(`[data-pick="${GROQ}"]`).innerText()) && (await picker.locator('[data-key="together"]').count()) === 1, 'Groq\'s model marked No key yet; Together AI, with no model to name yet, to add a key for')
  await picker.locator('input[type="search"]').fill('groq')
  ok(!!(await until(async () => (await picker.locator('[data-pick]').count()) === 1 && (await picker.locator(`[data-pick="${GROQ}"]`).count()) === 1, 5000, 100)), 'searching "groq": only Groq\'s', await picker.locator('.pv-pick-list').innerText())
  await shot(p, `model-jobs-${which}-1-picker`)
  await picker.locator(`[data-pick="${GROQ}"]`).click()
  ok(!!(await until(async () => JSON.stringify((await saved()).notes) === JSON.stringify([GROQ]), 8000, 200)), 'picked: saved as Meeting notes\' model', await saved())
  const keyForm = row.locator('[data-key-form="groq"]')
  ok(!!(await until(async () => (await keyForm.count()) === 1 && (await keyForm.locator('input[type="password"]').count()) === 1, 8000, 200)), 'its provider has no key: Groq\'s key form, there in the row')
  ok(!!(await until(async () => /No Groq key yet\./.test(await row.innerText()) && /Can't run until there's a Groq key\./.test(await row.locator('[data-job-now]').innerText()), 8000, 200)), 'and the row says plainly it can\'t run until there\'s one', await row.innerText())
  await shot(p, `model-jobs-${which}-2-no-key`)
  await keyForm.getByRole('button', { name: 'Close' }).click()
  // One to fall back on, moved up, the first taken off, then Automatic again.
  await row.getByRole('button', { name: 'Add one to fall back on…' }).click()
  await row.locator('[data-model-pick] [data-pick="openai:gpt-5"]').click()
  ok(!!(await until(async () => JSON.stringify((await saved()).notes) === JSON.stringify([GROQ, 'openai:gpt-5']) && /gpt-5 runs for now\./.test(await row.innerText()), 8000, 200)), 'a model to fall back on, after it: gpt-5 runs for now', await row.innerText())
  ok((await row.locator('[data-model-pick] [data-pick="auto"]').count()) === 0, 'the picker closed')
  await row.getByRole('button', { name: 'Move gpt-5 up' }).click()
  ok(!!(await until(async () => JSON.stringify((await saved()).notes) === JSON.stringify(['openai:gpt-5', GROQ]), 8000, 200)), 'moved up: first choice', await saved())
  await row.getByRole('button', { name: 'Remove llama-3.3-70b-versatile' }).click()
  ok(!!(await until(async () => JSON.stringify((await saved()).notes) === JSON.stringify(['openai:gpt-5']) && !/Can't run/.test(await row.innerText()), 8000, 200)), 'removed', await saved())
  await row.locator('.pv-job-model').click()
  await row.locator('[data-model-pick] [data-pick="auto"]').click()
  ok(!!(await until(async () => !(await saved()).notes && /Automatic/.test(await row.locator('.pv-job-model').innerText()) && (await row.locator('[data-job-now]').count()) === 1, 8000, 200)), 'back to Automatic', await saved())
  // A provider with no model to name yet: its key form.
  await row.locator('.pv-job-model').click()
  await row.locator('[data-model-pick] [data-key="together"]').click()
  ok(!!(await until(async () => (await row.locator('[data-key-form="together"]').count()) === 1, 5000, 100)) && !(await saved()).notes, 'Together AI: its key form, and nothing picked until there\'s a model')
  // Settings › Meetings & Voice: which model writes the notes, as this row has it, and Change it to
  // come here: no picker of its own.
  await own('notes', ['openai:gpt-5'])
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'notes-model' } })))
  const notesSec = p.locator('.modal.settings [data-setting="notes-model"]')
  ok(!!(await until(async () => /^gpt-5, at OpenAI:/.test(await notesSec.locator('[data-notes-where]').innerText().catch(() => '')), 10000)) && (await notesSec.locator('select').count()) === 0, 'Meetings & Voice says which model writes the notes, as Models for Each Task has it, with no picker of its own', await notesSec.innerText().catch(() => ''))
  await shot(p, `model-jobs-${which}-4-meetings`)
  await notesSec.locator('[data-notes-pick] button', { hasText: 'Change it' }).click()
  ok(!!(await until(async () => (await p.locator('[data-model-jobs] li[data-job="notes"]').isVisible().catch(() => false)) && /gpt-5/.test(await p.locator('[data-model-jobs] li[data-job="notes"] .pv-job-model').innerText().catch(() => '')), 8000)), 'Change it: Models for Each Task, at Meeting notes\' row')
  await own('notes', null)
  ok(!errors.length, 'no page errors', errors)
  await ctx.close()

  // On a phone's screen: the same, nothing wider than it.
  const ph = await page(b, kit.url, { phone: true })
  await openJobs(ph.p)
  const pbox = ph.p.locator('[data-model-jobs]')
  await pbox.scrollIntoViewIfNeeded()
  const prow = pbox.locator('li[data-job="assist"]')
  await prow.locator('.pv-job-model').click()
  await prow.locator('[data-model-pick] [data-pick="openai:gpt-5"]').click()
  ok(!!(await until(async () => JSON.stringify((await saved()).assist) === JSON.stringify(['openai:gpt-5']), 8000, 200)), 'on a phone: a model picked for AI Assist', await saved())
  await prow.getByRole('button', { name: 'Add one to fall back on…' }).click()
  await prow.locator('[data-model-pick]').waitFor({ timeout: 5000 })
  const wide = await ph.p.evaluate(() => {
    const box = document.querySelector('[data-model-jobs]')
    const out = [...box.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) }).map((el) => el.className || el.tagName)
    return { out: out.slice(0, 5), scroll: document.documentElement.scrollWidth - innerWidth }
  })
  ok(!wide.out.length && wide.scroll <= 0, 'and nothing in it wider than the screen, the picker open', wide)
  await shot(ph.p, `model-jobs-${which}-3-phone`)
  await prow.locator(`[data-model-pick] [data-pick="${GROQ}"]`).click()
  ok(!!(await until(async () => (await prow.locator('[data-key-form="groq"]').count()) === 1, 8000, 200)), 'and its key form for a model with no key yet, on the phone too')
  ok(!ph.errors.length, 'no page errors on the phone', ph.errors)
  await ph.ctx.close()
  await own('assist', null)
  await own('diagrams', null)
} finally {
  await b?.close()
  kit.stop()
  model.stop()
  ollama.stop()
  anthSrv.close()
}
process.exit(done().fail ? 1 : 0)
