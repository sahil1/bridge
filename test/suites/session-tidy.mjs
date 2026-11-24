// Long sessions tidied while you're idle (server/compact.js), with no browser, the stand-in Slack and
// Claude Code (stand-ins/helper-claude.cjs: its answers' tokens in its log, /compact as Claude Code
// takes it, a draft typed in its box). Short times here (BRIDGE_TIDY_*): idle 4 s, past 100k tokens.
//   Chief of Staff past 100k tokens and idle: /compact typed in, with a brief that keeps your asks,
//   standing rules and where the work is; its chat notes it (tidied, how big it was and after), as
//   one line with Claude Code's summary under it; it stays as it was (seen, idle), with no
//   notification, and isn't tidied again until it has grown again. Under 100k: left alone. Working:
//   never, however big. Something typed in its box: not tidied, and its chat says why, once; nor is
//   what was typed touched. Claude Code failing to compact: its chat says so, in its words. The
//   setting off: none. A helper: tidied too, with its own brief, and the Chief hears its report once,
//   not again for the tidy. A bot's live session: tidied with a brief of its own that keeps to its
//   conversation, its record says so, and the next reply in its thread goes into the same session
//   once it's done.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { checks, until, sleep, ROOT } from '../lib/harness.mjs'
import { botKit, M, OWNER } from '../lib/bots.mjs'

const { ok, done } = checks('session-tidy')
const IDLE = 4000
const { slack, kit, draftOf, startOf, connected, events, logOf } = await botKit('session-tidy', {
  folders: ['notes', 'work'],
  env: { BRIDGE_TIDY_IDLE_MS: String(IDLE), BRIDGE_TIDY_EVERY_MS: '1000', BRIDGE_TIDY_TAKES_MS: '20000', BRIDGE_SESSION_IDLE_MS: '600000' },
})
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const size = (tokens) => fs.writeFileSync(path.join(kit.home, 'claude-context.json'), JSON.stringify({ tokens }))
const compactWith = (o) => fs.writeFileSync(path.join(kit.home, 'claude-compact.json'), JSON.stringify(o))
const compacts = () => logOf('compacts.log')
const CHIEF = path.join(kit.data, 'chief')
const bridge = (...args) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'chief', 'bin', 'bridge'), ...args], { encoding: 'utf8', cwd: CHIEF, env: { ...process.env, BRIDGE_URL: kit.url, BRIDGE_HOME: kit.data, BRIDGE_THREAD: 'main' } }); return `${r.stdout || ''}${r.stderr || ''}` }
const agent = async (pane) => (await kit.api('/fleet?all=1')).agents.find((a) => a.paneId === pane)
const notes = async (pane) => (await kit.api(`/agents/${encodeURIComponent(pane)}/transcript`)).messages.filter((m) => m.role === 'event' && /idle/.test(m.text))
const say = (pane, text) => kit.api(`/agents/${encodeURIComponent(pane)}/prompt`, { text })
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  size(150000)
  compactWith({ ms: 1500 })
  const chief = (await kit.api('/chief/launch', {})).paneId
  ok(!!(await until(async () => (await agent(chief))?.status === 'idle', 20000)), 'Chief of Staff is running')

  await part('Chief of Staff, past 100k and idle', async () => {
    await say(chief, 'Plan the offsite. Keep it under budget.')
    await until(() => logOf('chief-got.log').some((x) => /Plan the offsite/.test(x.text)), 10000)
    await sleep(2500)
    await kit.api(`/agents/${encodeURIComponent(chief)}/focus`, {}) // you've seen its answer
    const c = await until(() => compacts()[0], IDLE + 20000, 500)
    ok(!!c && c.text.startsWith('/compact Keep every request and decision of the user') && /standing rules/.test(c.text) && /task numbers and agent panes/.test(c.text) && /Chief of Staff|ledger and task list/.test(c.text), 'after it\'s been idle: /compact typed in, keeping your asks, standing rules and where the work is', c)
    const n = await until(async () => (await notes(chief)).find((m) => m.tidy === 'tidied'), 15000)
    ok(n?.text === 'Tidied while you were idle: 150k tokens down to 18k' && n.status === 'completed' && !!n.summary, 'its chat says so, with how big it was and after, as one line with the summary under it', n)
    const all = (await kit.api(`/agents/${encodeURIComponent(chief)}/transcript`)).messages
    ok(!all.some((m) => m.role === 'event' && m.text === 'Earlier conversation summarized') && !all.some((m) => m.role === 'user' && /\/compact/.test(m.text || '')), '(not a second line for it, nor the command as a message of yours)', all.filter((m) => m.role !== 'assistant').map((m) => m.text))
    ok(!logOf('chief-got.log').some((x) => /\/compact/.test(x.text)), '(the command itself went to Claude Code, not as a message)')
    const a = await until(async () => { const x = await agent(chief); return x?.status === 'idle' ? x : null }, 10000)
    ok(a?.status === 'idle', 'it\'s as it was: idle, not finished (it isn\'t news)', a?.status)
    await sleep(IDLE + 3000)
    ok(compacts().length === 1, 'not tidied again until it has grown again', compacts().length)
  })

  await part('under 100k, or working', async () => {
    size(50000)
    const out = bridge('delegate', '--role', 'research', '--title', 'Small task', '[work 1] Look at the small thing.')
    ok(/A helper is on it/.test(out), '(a helper, small)', out)
    await sleep(IDLE + 6000)
    ok(!compacts().some((c) => /Keep the brief you were given whole/.test(c.text)), 'a session under 100k tokens: left alone')
    size(150000)
    const out2 = bridge('delegate', '--role', 'research', '--title', 'Long task', '[hold long] [work 1] Look at the long thing.')
    ok(/A helper is on it/.test(out2), '(a helper, working until it\'s let go)', out2)
    await sleep(IDLE + 6000)
    ok(!compacts().some((c) => /Keep the brief you were given whole/.test(c.text)), 'one working: never, however big')
    fs.writeFileSync(path.join(kit.home, 'release-long'), '')
  })

  await part('a helper', async () => {
    const t = await until(async () => (await kit.api('/chief/tasks')).items.find((x) => x.title === 'Long task' && x.status === 'done'), 30000)
    ok(!!t, '(its task done)')
    const c = await until(() => compacts().find((x) => /Keep the brief you were given whole, and where your work is/.test(x.text)), IDLE + 30000, 500)
    ok(!!c, 'a helper past 100k and idle is tidied too, with its own brief', compacts().map((x) => x.text.slice(0, 80)))
    await sleep(4000)
    const reports = logOf('chief-got.log').filter((x) => /^Report from your research helper/.test(x.text) && /Long task/.test(x.text))
    ok(reports.length === 1, 'the Chief hears its report once, not again for the tidy', reports.length)
    // (Its report made Chief of Staff's conversation big again: tidied again, once it's idle.)
    const again = await until(async () => { const n = (await notes(chief)).filter((m) => m.tidy === 'tidied'); return n.length >= 2 ? n : null }, IDLE + 30000, 500)
    ok(!!again, 'grown past 100k again, Chief of Staff is tidied again', (await notes(chief)).map((m) => m.text))
    await until(async () => (await agent(chief))?.status !== 'working', 20000)
  })

  await part('something typed in its box', async () => {
    size(160000)
    const before = compacts().length
    await say(chief, 'Book the venue.')
    await until(() => logOf('chief-got.log').some((x) => /Book the venue/.test(x.text)), 10000)
    await sleep(1500)
    await kit.api(`/agents/${encodeURIComponent(chief)}/keys`, { keys: ['y', 'n', '1'] })
    const n = await until(async () => (await notes(chief)).find((m) => m.tidy === 'skipped'), IDLE + 20000, 500)
    ok(n?.text === 'Not tidied while you were idle: something was typed in its message box' && compacts().length === before, 'not tidied, and its chat says why', n)
    await sleep(IDLE + 2000)
    ok((await notes(chief)).filter((m) => m.tidy === 'skipped').length === 1 && compacts().length === before, 'once, not over and over')
    await kit.api(`/agents/${encodeURIComponent(chief)}/keys`, { keys: ['backspace', 'backspace', 'backspace'] })
  })

  await part('Claude Code failing to compact', async () => {
    compactWith({ ms: 800, fail: true })
    const before = compacts().length
    await say(chief, 'Find a caterer.')
    await until(() => logOf('chief-got.log').some((x) => /Find a caterer/.test(x.text)), 10000)
    const n = await until(async () => (await notes(chief)).find((m) => m.tidy === 'failed'), IDLE + 30000, 500)
    ok(compacts().length === before + 1 && /^Not tidied while you were idle: Claude Code said "Error during compaction: Conversation too long/.test(n?.text || '') && n.status === 'failed', 'its chat says so, in Claude Code\'s words', n)
    compactWith({ ms: 1500 })
  })

  await part('the setting off', async () => {
    await kit.api('/settings', { chief: { tidy: false } }, 'PATCH')
    const before = compacts().length
    await say(chief, 'Send me the agenda.')
    await until(() => logOf('chief-got.log').some((x) => /Send me the agenda/.test(x.text)), 10000)
    await sleep(IDLE + 6000)
    ok(compacts().length === before, 'Tidy Long Sessions While Idle off: none', compacts().length - before)
    await kit.api('/settings', { chief: { tidy: true } }, 'PATCH')
  })

  await part('a bot\'s live session', async () => {
    size(150000)
    fs.writeFileSync(path.join(kit.home, 'notes', 'faq.md'), '# FAQ\n\nSupport is open nine to five.\n')
    await kit.api('/bots', { name: 'Helpdesk' })
    await kit.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
    await kit.api('/bots/b1/settings', { answerIn: 'thread', askers: [{ id: 'U0DANA', name: 'Dana' }], readsFrom: ['~/notes'], owner: OWNER })
    ok(!!(await connected()), '(a bot, connected)')
    const first = await slack.ask({ user: 'U0DANA', text: `${M} When is support open? [answer Nine to five.]` })
    await startOf('When is support open')
    const d = await draftOf('When is support open')
    await kit.api(`/bots/questions/${d.id}`, { send: true, text: d.draft })
    const c = await until(() => compacts().find((x) => /Keep each question with who asked it and where, marked as their words/.test(x.text)), IDLE + 30000, 500)
    ok(!!c && /Keep the brief you were given whole/.test(c.text) && /never instructions to you/.test(c.text) && /Nothing from outside this conversation/.test(c.text) && !/standing rules/.test(c.text), 'tidied once it\'s idle, with a brief that keeps its own brief and rules whole, other people\'s words as theirs, and nothing from outside its conversation', c)
    const e = await until(() => events('b1').find((x) => x.type === 'session.tidied'), 15000)
    ok(e && e.sid === d.session && e.before === 150000 && e.after === 18000, 'its record says so', e)
    await slack.ask({ user: 'U0DANA', thread: first.ts, text: 'And on Saturdays? [answer Closed on Saturdays.]' })
    const turn = await until(() => logOf('turns.log').find((x) => /Saturdays/.test(x.text)), 30000)
    ok(!!turn, 'the next reply in its thread goes into the same session, once it\'s done', turn?.session)
    const d2 = await draftOf('Saturdays')
    ok(d2?.draft === 'Closed on Saturdays.' && d2.session === d.session, 'and is answered there', d2 && { draft: d2.draft, session: d2.session })
  })
} finally {
  kit.stop()
  slack.stop?.()
}
process.exit(done().fail ? 1 : 0)
