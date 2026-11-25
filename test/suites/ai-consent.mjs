// Your OK on a phone before what you send goes on to an AI provider (server/aiconsent.js,
// src/aiconsent.js, components/AiConsent.jsx; App Review Guidelines 5.1.1(i) and 5.1.2(i)), in the
// browser named by BRIDGE_TEST_BROWSER, with a stand-in Claude Code (stand-ins/claude.cjs), a
// stand-in OpenAI (stand-ins/model.mjs) and a stand-in Ollama on this computer.
//   As a phone, through the relay (a Node phone on relay/web/link.js): every route that would send
//   what you give it to an agent, a model or a speech service elsewhere is refused until that
//   provider is allowed (409, code 'consent', naming it and what it's for), with nothing done first:
//   the agent gets nothing, no task, no meeting, no model asked. Typing that isn't sent (no Enter),
//   and a model on this computer, aren't asked about. Allowed from the phone (kept with when and the
//   phone's name), it goes; asked once per provider, whichever way it's reached; another provider is
//   still asked; taken back, refused again; settings sent the usual way can't allow one.
//   The computer's own window: nothing refused, and no sheet.
//   The phone page in the browser, through the relay: the sheet before the first message to an
//   agent, naming Claude Code's provider and what goes; Not Now sends nothing and says so, the
//   message kept in the box; Allow sends it; the next goes without asking; Settings › Devices &
//   Access › Phone › AI Providers lists it, Take Back takes it out, and the phone asks again. On a
//   phone's screen, the sheet's buttons and links are whole 40 px targets.
//   The demo (dist-demo, no server): the sheet at the first message to a made-up agent and at AI
//   Assist's first question, kept in memory only.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, startRelay, startModel, startLocalModel, checks, until, sleep, browser, page, shot, freePort, phoneNotes, phoneSaw, ROOT, TEST } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'
import { pageGate } from '../../src/standalone/consent.js'

const { ok, done } = checks('ai-consent')
// The demo's build, made again when its source is newer (run.mjs builds the app's, dist).
const newest = (d) => { let t = 0; const walk = (x) => { const st = fs.statSync(x); if (st.isDirectory()) { for (const e of fs.readdirSync(x)) walk(path.join(x, e)) } else t = Math.max(t, st.mtimeMs) }; walk(path.join(ROOT, d)); return t }
const demoBuilt = (() => { try { return fs.statSync(path.join(ROOT, 'dist-demo', 'index.html')).mtimeMs } catch { return 0 } })()
if (Math.max(newest('src'), newest('shared')) > demoBuilt) spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'demo:build'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' })
const relay = await startRelay('ai-consent')
const model = await startModel('ai-consent')
const ollama = await startLocalModel('ai-consent', 'ollama', [{ name: 'llama3.2:3b', context: 131072, loaded: 8192, params: '3.2B' }])
const kit = await startKit('ai-consent', {
  env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(relay.relayFile)); return { BRIDGE_COMPUTER_NAME: 'Studio Mac' } },
  config: { meetings: { autoSummary: true, nameSpeakers: false }, jobModels: { notes: ['openai:gpt-5'], live: ['openai:gpt-5'], diagrams: ['openai:gpt-5'], tidy: ['openai:gpt-5'], assist: ['openai:gpt-5'] } },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
// What the stand-in Claude Code took in: { session, text, how }, oldest first.
const got = () => { try { return fs.readFileSync(path.join(kit.home, 'claude-got.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const agentOf = async (paneId) => ((await kit.api('/fleet')).agents || []).find((a) => a.paneId === paneId)
const dir = path.join(kit.home, 'billing')
fs.mkdirSync(dir, { recursive: true })
let demo = null
try {
  await kit.api('/setup', { name: 'Tester' })
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/providers/ollama', { values: { OLLAMA_HOST: ollama.url } }, 'PUT')
  // Tidy what I say, on a model elsewhere (the stand-in OpenAI).
  await kit.api('/settings', { dictation: { tidy: true, tidyModel: 'openai:gpt-5' } }, 'PATCH')
  // An agent that takes messages, started on the computer.
  const ag = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Billing', newSpace: 'Billing', prompt: 'busy 1' })
  const ready = await until(async () => { const a = await agentOf(ag.paneId); return a?.sessionId && ['done', 'idle'].includes(a.status) && a }, 60000, 500)
  ok(!!ready, 'an agent on the stand-in Claude Code, done with its first message', await agentOf(ag.paneId))
  const routine = await kit.api('/routines', { name: 'Morning check', command: 'Check the overnight builds', cwd: dir, kind: 'claude' })
  ok(!!(await until(async () => (await kit.api('/relay')).online, 20000)), 'Bridge AI connects to its relay')

  // ---------- as a phone, through the relay ----------
  const phone = await linkAs(relay.url, { code: (await kit.api('/relay/pair', {})).pairing.code, name: 'Pocket', about: { name: 'Pocket' } })
  ok(!phone.refused && typeof phone.request === 'function', 'a phone pairs (a Node phone, through the relay)', phone.refused)
  const ask = (m, u, body) => phone.request(m, u, body)
  const first = await ask('GET', '/api/ai-consent')
  ok(first.status === 200 && first.json?.phone === true && first.json.allowed.length === 0, 'the computer knows the phone is one, and nothing is allowed yet', first)

  const tasks0 = (await kit.api('/chief/tasks')).items?.length ?? 0
  const meetings0 = (await kit.api('/meetings')).meetings?.length ?? 0
  const asked0 = model.asked().length
  // Every route a phone sends through: [method, path, body, provider, feature, what].
  const pane = encodeURIComponent(ag.paneId)
  const GATED = [
    ['POST', `/api/agents/${pane}/prompt`, { text: 'Phone message one' }, 'anthropic', 'agent', "a message to an agent (Claude Code: Anthropic)"],
    ['POST', `/api/agents/${pane}/queue`, { text: 'Phone message held' }, 'anthropic', 'agent', 'a message held for an agent'],
    ['POST', `/api/agents/${pane}/steer`, { text: 'Phone message steered' }, 'anthropic', 'agent', 'a message steered into a working agent (before it\'s interrupted)'],
    ['POST', `/api/agents/${pane}/rewind`, { text: 'Phone message again', back: 1 }, 'anthropic', 'agent', 'a message sent again from an earlier point (before it rewinds)'],
    ['POST', `/api/panes/${pane}/input`, { steps: [{ text: 'Phone typed\r' }] }, 'anthropic', 'agent', 'typing sent in the agent\'s terminal (Enter)'],
    ['POST', `/api/panes/${pane}/text`, { text: 'Phone typed line', enter: true }, 'anthropic', 'agent', 'a line typed in the terminal view'],
    ['POST', `/api/agents/${pane}/keys`, { keys: ['enter'] }, 'anthropic', 'agent', 'Enter, sending what\'s in the agent\'s box'],
    ['POST', '/api/agents/launch', { kind: 'claude', cwd: dir, label: 'Phone agent', prompt: 'Start on the refunds' }, 'anthropic', 'agent', 'a new agent started with something to do'],
    ['POST', '/api/agents/launch', { kind: 'chat', model: 'openai:gpt-5', cwd: dir, prompt: 'Hello there' }, 'openai', 'chat', 'a chat with a model (its own provider)'],
    ['POST', '/api/chats', { kind: 'claude', prompt: 'A chat from the phone' }, 'anthropic', 'agent', 'a new chat'],
    ['POST', '/api/studio/ask', { agent: 'claude', text: 'Tidy this document' }, 'anthropic', 'studio', 'Ask an agent in Studio'],
    ['POST', `/api/agents/${pane}/handoff`, { to: 'codex' }, 'openai', 'agent', 'a handoff to another kind of agent (Codex: OpenAI)'],
    ['POST', `/api/agents/${pane}/handoff/ask`, { to: 'codex' }, 'anthropic', 'agent', 'the agent asked to write its own handover (its provider reads the conversation)'],
    ['POST', `/api/agents/${pane}/continue`, { account: 'other', nudge: true }, 'anthropic', 'agent', 'an agent nudged to carry on, with a message of Bridge AI\'s'],
    ['POST', '/api/chief/launch', {}, 'anthropic', 'chief', 'the Chief of Staff started'],
    ['POST', '/api/chief/threads', { prompt: 'A new thread' }, 'anthropic', 'chief', 'a new thread with the Chief of Staff'],
    ['POST', '/api/chief/tasks', { title: 'Phone task', send: true }, 'anthropic', 'chief', 'a task sent to the Chief of Staff (none added first)'],
    ['POST', '/api/ideas/i1/send', {}, 'anthropic', 'chief', 'an idea sent to the Chief of Staff'],
    ['POST', '/api/chief/delegate', { kind: 'codex', task: 'Write the tests' }, 'openai', 'chief', 'a helper started'],
    ['POST', `/api/routines/${routine.id || routine.routine?.id}/run`, {}, 'anthropic', 'agent', 'a routine run now'],
    ['POST', '/api/routines', { name: 'Phone routine', command: 'Summarise the day', cwd: dir, kind: 'claude' }, 'anthropic', 'agent', 'a routine made to run later'],
    ['POST', '/api/meetings', { title: 'Phone meeting' }, 'openai', 'meetings', 'a meeting recorded (its notes, written by itself once it ends, go to OpenAI)'],
    ['POST', '/api/meetings/m1/summary', {}, 'openai', 'meetings', 'a meeting\'s notes'],
    ['POST', '/api/meetings/m1/voices', {}, 'openai', 'meetings', 'who said what'],
    ['POST', '/api/meetings/m1/transcribe', { engine: 'deepgram' }, 'deepgram', 'speech', 'a meeting transcribed again with a speech service'],
    ['POST', '/api/meetings/bulk', { action: 'summarize', ids: ['m1'] }, 'openai', 'meetings', 'notes for several meetings'],
    ['POST', '/api/meetings/m1/assist', { on: true }, 'openai', 'live', 'live suggestions turned on'],
    ['POST', '/api/meetings/m1/board', { on: true }, 'openai', 'board', 'the live board turned on'],
    ['POST', '/api/meetings/m1/work/k1/agent', { kind: 'claude' }, 'anthropic', 'meetings', 'an action item to an agent'],
    ['POST', '/api/meetings/m1/chief', {}, 'anthropic', 'chief', 'a meeting\'s action items to the Chief of Staff'],
    ['POST', '/api/meetings/m1/handoff', {}, 'openai', 'meetings', 'action items placed by a model'],
    ['POST', '/api/files/insights/x1/ask', { model: 'openai:gpt-5' }, 'openai', 'files', 'AI Assist in a folder'],
    ['POST', '/api/insights/run', { who: 'gpt' }, 'openai', 'insights', 'Insights written'],
    ['POST', '/api/consult', { who: 'gpt', via: 'api', prompt: 'What changed?' }, 'openai', null, 'a question put to a model'],
    ['POST', '/api/dictation/tidy', { text: 'so um what I said on the phone' }, 'openai', 'dictation', 'what you dictated, tidied by a model elsewhere'],
    ['POST', '/api/bots/assist', { text: 'A bot for hiring' }, 'openai', 'bot', 'AI Assist setting up a bot'],
    ['POST', '/api/cloud/launch', { provider: 'claude', repo: 'a/b', prompt: 'Fix it' }, 'anthropic', 'cloud', 'a cloud agent started'],
  ]
  for (const [m, u, body, want, feature, what] of GATED) {
    const r = await ask(m, u, body)
    ok(r.status === 409 && r.json?.code === 'consent' && r.json.consent?.provider?.id === want && (feature == null || r.json.consent.feature === feature) && /needs your OK/.test(r.json.error || ''),
      `from a phone: ${what}: refused until ${want} is allowed (409, consent)`, { u, status: r.status, json: r.json })
  }
  await sleep(1500)
  ok(!got().some((x) => /Phone (message|typed)/.test(x.text)), 'the agent got none of it', got())
  ok(((await kit.api('/chief/tasks')).items?.length ?? 0) === tasks0, 'no task was added for the Chief of Staff')
  ok(((await kit.api('/meetings')).meetings?.length ?? 0) === meetings0, 'no meeting was started')
  ok(model.asked().length === asked0, 'the stand-in OpenAI was asked nothing', model.asked().slice(asked0))
  ok(!((await kit.api('/fleet')).agents || []).some((a) => /Phone agent/.test(a.title || '')), 'no agent was started')

  // Not sent, so not asked: typing with no Enter (the live mirror of what you write), a first-run
  // screen's answer; and a model on this computer.
  const typing = await ask('POST', `/api/panes/${pane}/input`, { steps: [{ text: 'draft' }] })
  ok(typing.status === 200, 'typing that isn\'t sent (no Enter) isn\'t refused', typing)
  const local = await ask('POST', '/api/consult', { who: 'local', prompt: 'Is this kept here?' })
  ok(local.status === 200 && !local.json?.code, 'a model on this computer (Ollama) is never asked about', local)

  // Allowed from the phone: kept with when, from which device, through what.
  const allow = await ask('POST', '/api/ai-consent', { provider: { id: 'anthropic', name: 'Anthropic', via: 'Claude Code' }, feature: 'agent' })
  const kept = allow.json?.allowed?.find((x) => x.id === 'anthropic')
  ok(allow.status === 200 && kept && kept.device === 'Pocket' && kept.via === 'Claude Code' && Date.now() - Date.parse(kept.at) < 60000, 'allowed from the phone: kept on the computer with when, the phone\'s name and through what', allow.json)
  ok(!!JSON.parse(fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8')).aiConsent?.anthropic?.at, 'in the computer\'s settings (config.json aiConsent)')
  const sent = await ask('POST', `/api/agents/${pane}/prompt`, { text: 'Phone message two' })
  ok(sent.status === 200, 'then the message goes', sent)
  ok(!!(await until(() => got().some((x) => x.text === 'Phone message two'), 30000, 300)), 'and the agent gets it')
  // Once per provider, however it's reached.
  const chat = await ask('POST', '/api/chats', { kind: 'claude', prompt: 'busy 1' })
  ok(chat.status === 200, 'Anthropic again, through a new chat: not asked again', chat)
  const other = await ask('POST', '/api/consult', { who: 'gpt', via: 'api', prompt: 'And now?' })
  ok(other.status === 409 && other.json?.consent?.provider?.id === 'openai', 'another provider (OpenAI) is still asked about', other.json)
  // Settings sent the usual way can't allow one.
  await kit.api('/settings', { aiConsent: { openai: { name: 'OpenAI', at: new Date().toISOString() } } }, 'PATCH')
  const still = await ask('POST', '/api/consult', { who: 'gpt', via: 'api', prompt: 'And now?' })
  ok(still.status === 409, 'a settings change can\'t allow a provider: only the phone\'s OK does', still.json)
  // Taken back (here, on the computer): the phone is asked again.
  const back = await kit.api('/ai-consent/anthropic', null, 'DELETE')
  ok(!back.allowed.some((x) => x.id === 'anthropic'), 'taken back on the computer')
  const again = await ask('POST', `/api/agents/${pane}/prompt`, { text: 'Phone message three' })
  ok(again.status === 409 && again.json?.consent?.provider?.id === 'anthropic', 'and the phone is asked again', again.json)
  phone.close()

  // ---------- the computer's own window ----------
  const here = await kit.api(`/agents/${pane}/prompt`, { text: 'From the computer' })
  ok(!!here.ok || !!here.queued, 'on the computer itself, a message goes with nothing asked', here)
  ok(!!(await until(() => got().some((x) => x.text === 'From the computer'), 30000, 300)), 'and the agent gets it')
  const hereModel = await kit.api('/dictation/tidy', { text: 'so um the computer tidies this' }).catch((e) => ({ error: e.message, j: e.j }))
  ok(!hereModel.error && model.asked().length > asked0, 'and a model elsewhere (OpenAI, tidying what you said) is asked with nothing asked of you', hereModel)
  {
    const { ctx, p, errors } = await page(b, kit.url)
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), ag.paneId)
    await p.locator('.composer textarea').waitFor({ timeout: 20000 })
    await p.locator('.composer textarea').fill('Desktop message')
    await p.locator('.composer-stack .send').click()
    ok(!!(await until(() => got().some((x) => x.text === 'Desktop message'), 30000, 300)), 'in the computer\'s window: the message goes')
    ok(!(await p.locator('.aic-sheet').count()), 'with no sheet asking')
    // Its Settings list shows here too.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'phone' } })))
    const sec = p.locator('[data-setting="ai-providers"]')
    await sec.waitFor({ timeout: 10000 }).catch(() => {})
    ok(!!(await until(async () => /AI Providers[\s\S]*None yet/.test(await sec.innerText().catch(() => '')), 10000)), 'Settings › Devices & Access › Phone lists AI Providers on the computer too (none now)', await sec.innerText().catch(() => ''))
    ok(errors.length === 0, 'no page errors on the computer', errors)
    await ctx.close()
  }

  // ---------- the phone page, through the relay ----------
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...(which === 'chromium' ? { isMobile: true } : {}), hasTouch: true, deviceScaleFactor: 2 })
    await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })) } catch { /* no storage */ } })
    await phoneNotes(ctx)
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(`${relay.url}/#pair=${(await kit.api('/relay/pair', {})).pairing.code}`)
    await p.locator('#pair-go').click({ timeout: 15000 })
    const frame = () => p.frames().find((f) => f !== p.mainFrame() && f.url().startsWith(relay.url))
    const opened = await until(() => frame()?.locator('.tabbar button').count(), 40000)
    if (!opened) console.log('the phone page, as far as it got:', JSON.stringify({ frames: p.frames().map((f) => f.url()), page: await phoneSaw(p) }))
    ok(!!opened, 'paired in the browser: the phone page shows Bridge AI from the computer')
    if (!opened) throw new Error('the phone page didn\'t open Bridge AI')
    const f = frame()
    await f.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), ag.paneId)
    const box = f.locator('.composer textarea')
    await box.waitFor({ timeout: 20000 })
    const sheet = f.locator('.aic-sheet')
    const send = async (text) => { await box.fill(text); await f.locator('.composer-stack .send').click() }

    // The first message: the sheet, before anything goes.
    await send('Browser message one')
    await sheet.waitFor({ timeout: 15000 }).catch(() => {})
    const says = (await sheet.innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(/Send this to Anthropic\?/.test(says) && /Anthropic, through Claude Code/.test(says) && /The message you write, and the files and photos you attach to it/.test(says)
      && /from this phone to your computer, end-to-end encrypted, and from your computer to Anthropic/.test(says) && /Nothing is sent to Anthropic/.test(says),
    'the sheet, before the first message: who gets it (Anthropic, through Claude Code), what goes, and how', says)
    const links = await sheet.locator('a').evaluateAll((l) => l.map((a) => ({ text: a.innerText.trim(), href: a.href })))
    ok(links.some((l) => l.text === 'Privacy policy' && /PRIVACY\.md#ai-providers-and-your-phone$/.test(l.href)) && links.some((l) => /Anthropic's privacy policy/.test(l.text) && /anthropic\.com\/legal\/privacy/.test(l.href)), 'it links the privacy policy, and Anthropic\'s', links)
    const sizes = await sheet.locator('button, a').evaluateAll((l) => l.map((e) => { const r = e.getBoundingClientRect(); return { t: e.innerText.trim(), h: Math.round(r.height), inside: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 } }))
    ok(sizes.length >= 4 && sizes.every((x) => x.h >= 40 && x.inside), 'on a phone, each button and link on it is a whole 40 px target on the screen', sizes)
    ok((await f.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'nothing wider than the phone')
    await sleep(500) // (once it has faded in)
    await shot(p, `${tag}ai-consent-sheet`)
    await sleep(800)
    ok(!got().some((x) => x.text === 'Browser message one'), 'nothing has gone while it asks')

    // Not Now: nothing sent, said so, the message kept.
    await sheet.locator('button', { hasText: 'Not Now' }).click()
    const line = f.locator('.aic-said')
    await line.waitFor({ timeout: 5000 }).catch(() => {})
    ok(/Not sent\. You chose Not Now, so nothing went to Anthropic/.test(await line.innerText().catch(() => '')), 'Not Now: it says nothing was sent', await line.innerText().catch(() => ''))
    ok((await box.inputValue()) === 'Browser message one', 'and the message is still in the box', await box.inputValue())
    await sleep(1500)
    ok(!got().some((x) => x.text === 'Browser message one') && !(await kit.api('/ai-consent')).allowed.length, 'the agent got nothing, and nothing is allowed')
    await shot(p, `${tag}ai-consent-not-now`)

    // Again, and Allow: it goes, once.
    await f.locator('.composer-stack .send').click()
    await sheet.waitFor({ timeout: 15000 }).catch(() => {})
    ok(await sheet.count() === 1, 'sent again, it asks again')
    await sheet.locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(() => got().filter((x) => x.text === 'Browser message one').length === 1, 30000, 300)), 'Allow: what was waiting goes, once')
    const list = (await kit.api('/ai-consent')).allowed
    ok(list.length === 1 && list[0].id === 'anthropic' && typeof list[0].device === 'string' && list[0].device.length > 0, 'the computer keeps the OK, with the device it came from', list)
    await until(async () => !(await sheet.count()), 5000)
    await sleep(2500)
    await send('Browser message two')
    ok(!!(await until(() => got().some((x) => x.text === 'Browser message two'), 30000, 300)), 'the next message goes')
    ok(!(await sheet.count()), 'with nothing asked: once per provider')

    // Settings › Devices & Access › Phone › AI Providers, on the phone: listed, and taken back.
    await f.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'phone' } })))
    const sec = f.locator('[data-setting="ai-providers"]')
    await sec.waitFor({ timeout: 15000 }).catch(() => {})
    await sec.scrollIntoViewIfNeeded().catch(() => {})
    const row = (await sec.innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(/Anthropic/.test(row) && /through Claude Code/.test(row) && /allowed on/.test(row), 'Settings lists Anthropic: through Claude Code, the day it was allowed and from where', row)
    await shot(p, `${tag}ai-consent-settings`)
    await sec.locator('button', { hasText: 'Take Back' }).click()
    ok(!!(await until(async () => !(await kit.api('/ai-consent')).allowed.length, 10000)), 'Take Back: it\'s gone from the computer')
    await p.keyboard.press('Escape')
    await f.evaluate(() => document.querySelector('.modal.settings .win-btn[aria-label="Close"], .settings .st-close')?.click())
    await f.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), ag.paneId)
    await box.waitFor({ timeout: 20000 })
    await send('Browser message three')
    await sheet.waitFor({ timeout: 15000 }).catch(() => {})
    ok(await sheet.count() === 1, 'taken back, the phone asks again')
    await sheet.locator('button', { hasText: 'Not Now' }).click()
    ok(errors.length === 0, 'no page errors on the phone', errors)
    await ctx.close()
  }

  // ---------- the demo ----------
  const DIR = path.join(ROOT, 'dist-demo')
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }
  const port = await freePort()
  demo = http.createServer((req, res) => {
    let file = path.join(DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIR, 'index.html')
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  }).listen(port, '127.0.0.1')
  ok(fs.existsSync(path.join(DIR, 'index.html')), 'dist-demo is built (npm run demo:build)')
  {
    // As App Review's notes say: Try the demo, Chief, a message (the Chief of Staff, on Claude Code).
    const { ctx, p, errors } = await page(b, `http://127.0.0.1:${port}/?clean=1`, { phone: true, mic: false })
    await p.waitForSelector('.tabbar button', { timeout: 20000 })
    await p.locator('.tabbar button', { hasText: 'Chief' }).click()
    const box = p.locator('.composer textarea')
    await box.waitFor({ timeout: 20000 })
    await box.fill('What needs me today?')
    await p.locator('.composer-stack .send').click()
    const sheet = p.locator('.aic-sheet')
    await sheet.waitFor({ timeout: 10000 }).catch(() => {})
    const says = (await sheet.innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(/Send this to Anthropic\?/.test(says) && /Anthropic, through Claude Code/.test(says) && /The message you write/.test(says), 'the demo: the sheet at the first message to the made-up Chief of Staff, naming its provider and what goes', says)
    await sleep(500) // (once it has faded in)
    await shot(p, `${tag}ai-consent-demo-agent`)
    await sheet.locator('button', { hasText: 'Not Now' }).click()
    ok(/Not sent\. You chose Not Now, so nothing went to Anthropic/.test(await p.locator('.aic-said').innerText().catch(() => '')) && (await box.inputValue()) === 'What needs me today?', 'Not Now in the demo: nothing sent, said so, the message kept')
    await p.locator('.composer-stack .send').click()
    await sheet.waitFor({ timeout: 10000 }).catch(() => {})
    await sheet.locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => /What needs me today\?/.test(await p.locator('.console').innerText().catch(() => '')), 10000)), 'Allow: the message goes to the made-up Chief of Staff')
    await box.fill('And tomorrow?')
    await p.locator('.composer-stack .send').click()
    await sleep(800)
    ok(!(await sheet.count()), 'the next message, nothing asked')
    // Settings lists it, as the demo keeps it.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'phone' } })))
    const sec = p.locator('[data-setting="ai-providers"]')
    await sec.waitFor({ timeout: 10000 }).catch(() => {})
    ok(/Anthropic/.test(await sec.innerText().catch(() => '')), 'the demo\'s Settings lists it', await sec.innerText().catch(() => ''))
    ok(errors.length === 0, 'no page errors in the demo', errors)
    await ctx.close()
  }
  {
    // AI Assist's first question about a meeting, in a fresh demo: kept in memory only, so asked.
    const { ctx, p, errors } = await page(b, `http://127.0.0.1:${port}/?clean=1&m=studio`, { phone: true, mic: false })
    await p.waitForSelector('.tabbar button', { timeout: 20000 })
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    await p.locator('.mt-row-open', { hasText: 'Checkout launch sync' }).click({ timeout: 10000 })
    const input = p.locator('.mt-askbox input')
    await input.waitFor({ timeout: 10000 })
    await input.fill('What did we decide?')
    await input.press('Enter')
    const sheet = p.locator('.aic-sheet')
    await sheet.waitFor({ timeout: 10000 }).catch(() => {})
    const says = (await sheet.innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(/Send this to OpenAI\?/.test(says) && /OpenAI, through the OpenAI API/.test(says) && /The meeting's transcript and your notes/.test(says), 'the demo: AI Assist\'s first question asks first, naming its model\'s provider and what goes (the meeting\'s transcript and your notes)', says)
    await sleep(500) // (once it has faded in)
    await shot(p, `${tag}ai-consent-demo-assist`)
    await sheet.locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => /this answer is made up/.test(await p.locator('.mt-ask').innerText().catch(() => '')), 10000)), 'Allow: AI Assist answers (made up, and saying so)')
    ok(errors.length === 0, 'no page errors in the demo', errors)
    await ctx.close()
  }

  // ---------- The demo's own gate: every way of sending to an agent asks first ----------
  {
    const { ofAgent, ofModel, ofCloud } = await import('../../shared/aiproviders.js')
    const gate = pageGate({ agentOf: (p) => (p === 'w1:p1' ? { kind: 'claude' } : p === 'w1:q' ? { kind: 'claude', question: true } : null), assist: 'openai:gpt-5', ofAgent, ofModel, ofCloud })
    const asks = (m, p, b) => gate(m, p, b)?.provider?.id || null
    const cases = {
      typedEnter: asks('POST', '/panes/w1%3Ap1/text', { text: 'hi', enter: true }),
      typedNoEnter: asks('POST', '/panes/w1%3Ap1/text', { text: 'hi' }),
      keysEnter: asks('POST', '/agents/w1%3Ap1/keys', { keys: ['Enter'] }),
      keysOnQuestion: asks('POST', '/agents/w1%3Aq/keys', { keys: ['Enter'] }),
      asks: asks('POST', '/agents/w1%3Ap1/asks', { text: 'yes' }),
      handoverAsk: asks('POST', '/agents/w1%3Ap1/handoff/ask', { to: 'codex' }),
      nudge: asks('POST', '/agents/w1%3Ap1/continue', { nudge: true }),
      noNudge: asks('POST', '/agents/w1%3Ap1/continue', {}),
      routine: asks('POST', '/routines/r1/run', {}),
    }
    ok(cases.typedEnter === 'anthropic' && !cases.typedNoEnter && cases.keysEnter === 'anthropic' && !cases.keysOnQuestion && cases.asks === 'anthropic' && cases.handoverAsk === 'anthropic' && cases.nudge === 'anthropic' && !cases.noNudge && cases.routine === 'anthropic', 'the demo asks before a line typed into a terminal and sent, an answer, an agent\'s own handover, a nudge and a routine run now; not for typing that isn\'t sent or a choice on a question\'s card', cases)
  }
} catch (e) {
  ok(false, `the test ran to the end: ${e.message}`, e.stack)
} finally {
  demo?.close()
  await b.close()
  kit.stop()
  relay.stop()
  model.stop()
  ollama.stop()
}
process.exit(done().fail ? 1 : 0)
