// A connection's Chief (server/frontdesk.js handTo, consult; sessionmcp.js), with the stand-in Slack
// and Claude Code: one shared app reaching Chief, Marketing and Hiring, Chief its connection's Chief
// (connections.js chief, written as Connections keeps it) and #launch's bot.
//   Chief's session is told it's the Chief, with each bot on its connection, what it's for and its
//   Access line, and has hand_to and ask_bot; the others don't.
//   ask_bot: Marketing answers as whoever asked Chief (Dana, whom it answers), in a session of its own
//   for Chief's conversation, posting nothing; its answer comes back as Chief's next turn, and
//   Chief's answer is the one that goes. Hiring, which doesn't answer Dana, refuses her there too:
//   Chief hears it couldn't, and Hiring says nothing in the channel.
//   hand_to: Marketing takes the conversation, as Dana's question, with Chief's note; the next reply
//   in that thread goes to Marketing's session, not Chief's.
import fs from 'node:fs'
import path from 'node:path'
import { checks, until, sleep } from '../lib/harness.mjs'
import { botKit, M, OWNER } from '../lib/bots.mjs'

const { ok, done } = checks('bots-chief')
const { slack, kit, draftOf, startOf, startsOf, logOf, events, posted } = await botKit('bots-chief', { folders: ['marketing', 'hiring'] })
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
fs.writeFileSync(path.join(kit.home, 'marketing', 'plan.md'), '# Plan\n\nLaunch on the 5th.\n')
fs.writeFileSync(path.join(kit.home, 'hiring', 'roles.md'), '# Roles\n\nDesign.\n')
const DANA = { id: 'U0DANA', name: 'Dana' }
const inThread = async (ts) => (await posted()).filter((x) => x.thread_ts === ts)
const briefOf = (x) => String(x?.message || '').replace(/ · /g, '\n')
const inFolder = (x, f) => { try { return fs.realpathSync(x.cwd) === fs.realpathSync(path.join(kit.home, f)) } catch { return false } }

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const C = (await kit.api('/connections', { platform: 'slack', name: 'tester_bot' })).id
  await kit.api(`/connections/${C}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots', { name: 'Chief', description: 'Answers first, and passes things on' })
  await kit.api('/bots', { name: 'Marketing', description: 'The launch plan and campaigns' })
  await kit.api('/bots', { name: 'Hiring', description: 'Roles and offers' })
  const ids = Object.fromEntries((await kit.api('/bots')).bots.map((x) => [x.name, x.id]))
  await kit.api(`/connections/${C}`, { owner: OWNER, defaults: [{ id: 'C0LAUNCH', name: 'launch', bot: ids.Chief }] }, 'PATCH')
  await kit.api(`/bots/${ids.Chief}/settings`, { answerIn: 'thread', askers: [DANA] })
  await kit.api(`/bots/${ids.Marketing}/settings`, { answerIn: 'thread', askers: [DANA], readsFrom: ['~/marketing'] })
  await kit.api(`/bots/${ids.Hiring}/settings`, { answerIn: 'thread', askers: [], readsFrom: ['~/hiring'] })
  ok(!!(await until(async () => (await kit.api(`/connections/${C}`)).state === 'connected', 20000)), 'a shared connection reaching Chief, Marketing and Hiring')
  // (Its Chief, as Connections keeps it: set there where it can be, else written as it's kept.)
  const cf = path.join(kit.data, 'connections', C, 'connection.json')
  await kit.api(`/connections/${C}`, { chief: ids.Chief }, 'PATCH').catch(() => null)
  await sleep(1500)
  if (JSON.parse(fs.readFileSync(cf, 'utf8')).chief !== ids.Chief) fs.writeFileSync(cf, JSON.stringify({ ...JSON.parse(fs.readFileSync(cf, 'utf8')), chief: ids.Chief }, null, 2))
  await sleep(1500)
  ok(JSON.parse(fs.readFileSync(cf, 'utf8')).chief === ids.Chief, 'Chief is its Chief')

  // ---------- ask_bot ----------
  let q1 = null
  await part('ask_bot', async () => {
    q1 = await slack.ask({ user: 'U0DANA', text: `${M} What's the launch plan? [ask-bot Marketing What is in the plan?] [answer That's the plan.]` })
    const s = await startOf('What\'s the launch plan')
    const brief = briefOf(s)
    ok(/You're the Chief on Slack for Tester/.test(brief) && /- Marketing: The launch plan and campaigns \(reads ~\/marketing; only the people named may ask it\)/.test(brief) && /- Hiring: Roles and offers/.test(brief), 'Chief\'s session is told it\'s the Chief, with each bot, what it\'s for and its Access line', brief.slice(0, 1500))
    ok(s?.args.includes('mcp__bridge_session__hand_to') && s.args.includes('mcp__bridge_session__ask_bot'), 'with hand_to and ask_bot', s?.args)
    const m = await until(() => startsOf('What is in the plan?').find((x) => inFolder(x, 'marketing')), 30000)
    ok(!!m && fs.realpathSync(m.cwd) === fs.realpathSync(path.join(kit.home, 'marketing')) && !m.args.includes('mcp__bridge_session__hand_to'), 'Marketing is asked, in its own folder, in a session of its own, with no Chief\'s tools', m && { cwd: m.cwd, args: m.args })
    ok(/----- question from Dana -----/.test(briefOf(m)), 'as Dana, who asked Chief', briefOf(m).slice(-600))
    const rec = events(ids.Marketing).find((e) => e.type === 'received' && /What is in the plan/.test(e.text || ''))
    ok(rec?.person?.id === 'U0DANA' && rec.consult?.by === ids.Chief, 'in Marketing\'s record: Dana\'s question, asked by Chief', rec)
    const d = await draftOf('What\'s the launch plan')
    ok(/Marketing says: Here is what I found\./.test(d?.draft || '') && /That's the plan\./.test(d.draft), 'its answer came back as Chief\'s next turn, and Chief\'s answer has it', d?.draft)
    const thread = await inThread(q1.ts)
    ok(!thread.some((x) => /Here is what I found/.test(x.text || '') && !/Marketing says/.test(x.text || '')), 'Marketing posted nothing of its own', thread.map((x) => x.text))
    ok(events(ids.Chief).some((e) => e.type === 'consult.asked' && e.to?.id === ids.Marketing) && events(ids.Marketing).some((e) => e.type === 'consult.answered'), 'both records say so')
    await kit.api(`/bots/questions/${d.id}`, { send: true, text: d.draft })
  })

  // ---------- ask_bot, of a bot that doesn't answer them ----------
  await part('ask_bot as the asker', async () => {
    const q = await slack.ask({ user: 'U0DANA', text: `${M} Who are we hiring? [ask-bot Hiring Which roles are open?] [answer Asked Hiring.]` })
    const d = await draftOf('Who are we hiring')
    ok(/Hiring says: \(Hiring couldn't answer: it doesn't answer Dana/.test(d?.draft || ''), 'Hiring doesn\'t answer Dana, for Chief either: Chief hears it couldn\'t', d?.draft)
    ok(!startsOf('Which roles are open').some((x) => inFolder(x, 'hiring')) && events(ids.Hiring).some((e) => e.type === 'refused' && e.person?.id === 'U0DANA'), 'Hiring\'s agent never started; its record has the refusal')
    ok(!(await inThread(q.ts)).some((x) => /only answer questions/.test(x.text || '')) && !(await posted()).some((x) => x.channel === 'C0LAUNCH' && /only answer questions/.test(x.text || '')), 'and it says nothing in the channel')
    await kit.api(`/bots/questions/${d.id}`, { send: false })
  })

  // ---------- hand_to ----------
  await part('hand_to', async () => {
    const q = await slack.ask({ user: 'U0DANA', text: `${M} Can someone send me the campaign brief? [hand-to Marketing Dana wants the campaign brief] [answer Handing it on.]` })
    const ms = await until(() => startsOf('Can someone send me the campaign brief').find((x) => inFolder(x, 'marketing')), 30000)
    ok(!!ms && /\(Chief handed this to you: Dana wants the campaign brief\)/.test(briefOf(ms)) && /----- question from Dana -----/.test(briefOf(ms)), 'Marketing takes it, as Dana\'s question, with Chief\'s note', briefOf(ms).slice(-800))
    ok(events(ids.Chief).some((e) => e.type === 'handed' && e.to?.id === ids.Marketing && e.note === 'Dana wants the campaign brief'), 'Chief\'s record: handed to Marketing, with its note')
    const d = await draftOf('Can someone send me the campaign brief')
    if (d) await kit.api(`/bots/questions/${d.id}`, { send: true, text: d.draft })
    await until(async () => (await inThread(q.ts)).length > 0, 15000)
    // The next reply in that thread: Marketing's.
    await slack.ask({ user: 'U0DANA', thread: q.ts, text: 'And the logo? [answer The logo is in the brief.]' })
    const t = await until(() => logOf('turns.log').find((x) => x.text.includes('And the logo')), 30000)
    ok(!!t && fs.realpathSync(t.cwd) === fs.realpathSync(path.join(kit.home, 'marketing')), 'the next reply in that thread goes to Marketing\'s session, not Chief\'s', t && t.cwd)
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  kit.stop()
  slack.stop()
}
process.exit(done().fail ? 1 : 0)
