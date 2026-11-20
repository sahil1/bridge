// Pushes wait for you (server/frontdesk.js pushAct, botguard.mjs, sessionmcp.js), with the stand-in
// Slack, Claude Code and GitHub CLI (stand-ins/slack.mjs, helper-claude.cjs, gh.cjs), a repository
// of its own and a bare one as its remote.
//   A bot's session that may run commands (Bash, in its sandbox) can't push: git push and gh are
//   refused by its hook, saying pushing waits for you and to call request_push. Its agent's
//   request_push: in Needs You (the commit you're shown), where it was asked (Push and Don't push,
//   only yours count) and your DM; nothing pushed until you say so; approving another commit than the
//   one waiting is refused (409); approved, Bridge AI pushes its branch only and opens a draft pull
//   request with your gh, the link in the thread and the record; approved again, nothing twice.
//   Its button, pressed by you, pushes; "no push 12" in your DM doesn't, and they're told.
//   A bot kept as 'pr' (a pull request at once) proposes as 'suggest' now, said in its record.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { checks, until, TEST, IS_WIN } from '../lib/harness.mjs'
import { botKit, M, OWNER } from '../lib/bots.mjs'

const { ok, done } = checks('bots-push')
const gitDir = IS_WIN ? path.dirname(String(spawnSync('where', ['git'], { encoding: 'utf8' }).stdout || '').split(/\r?\n/)[0] || 'C:\\Program Files\\Git\\cmd\\git.exe') : null
const { slack, kit, draftOf, startOf, logOf, botOf, connected, events, posted, needs } = await botKit('bots-push', { folders: ['code'], env: ({ PATH }) => ({ ...(gitDir ? { PATH: `${PATH}${path.delimiter}${gitDir}`, BRIDGE_PATH: `${PATH}${path.delimiter}${gitDir}` } : {}) }) })
kit.program('gh', fs.readFileSync(path.join(TEST, 'stand-ins', 'gh.cjs'), 'utf8'))
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const APP = path.join(kit.home, 'code', 'app')
const ORIGIN = path.join(kit.dir, 'origin.git')
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, HOME: kit.home, GIT_CONFIG_NOSYSTEM: '1' } }); return (r.stdout || '').trim() || (r.status ? `ERR ${r.stderr}` : '') }
fs.mkdirSync(APP, { recursive: true })
git(kit.dir, 'init', '-q', '--bare', '-b', 'main', ORIGIN)
git(APP, 'init', '-q', '-b', 'main')
git(APP, 'config', 'user.name', 'Tester')
git(APP, 'config', 'user.email', 'tester@example.com')
fs.writeFileSync(path.join(APP, 'README.md'), 'Hello wrold\n')
fs.writeFileSync(path.join(APP, 'CHANGELOG.md'), '# Changes\n')
git(APP, 'add', '-A')
git(APP, 'commit', '-q', '-m', 'First')
git(APP, 'remote', 'add', 'origin', ORIGIN)
git(APP, 'push', '-q', '-u', 'origin', 'main')
git(APP, 'remote', 'set-head', 'origin', 'main')
const MAIN = git(APP, 'rev-parse', 'main')
const ghCalls = () => logOf('gh-calls.log')
const inThread = async (ts) => (await posted()).filter((x) => x.thread_ts === ts)
const branches = () => git(ORIGIN, 'branch', '--list', 'bot/*').split('\n').map((x) => x.replace(/^[*\s]+/, '')).filter(Boolean)

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  await kit.api('/bots', { name: 'Code Bot' })
  await kit.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots/b1/settings', { answerIn: 'thread', askers: [{ id: 'U0DANA', name: 'Dana' }], readsFrom: ['~/code/app'], owner: OWNER, changes: 'suggest', bash: 'sandboxed' })
  ok(!!(await connected()), 'a bot, connected, proposing changes in a repository, with commands')

  // ---------- Its hook refuses a push ----------
  let q1 = null
  let d1 = null
  await part('the hook', async () => {
    q1 = await slack.ask({ user: 'U0DANA', text: `${M} Fix the typo, then push it. [edit README.md Hello world] [run git push origin HEAD] [run gh pr create --fill] [push Fix the README typo] [answer Fixed it, and asked to push.]` })
    const s = await startOf('Fix the typo, then push it')
    const a = s?.args.join(' ') || ''
    ok(a.includes('Read,Grep,Glob,Edit,Write,Bash') && a.includes('mcp__bridge_session__request_push') && s?.given?.sandbox?.filesystem?.denyWrite?.some((d) => d.endsWith(`${path.sep}.git`)), 'its session may edit its copy and run commands, with request_push, and no writing git\'s own file', { args: s?.args, deny: s?.given?.sandbox?.filesystem })
    d1 = await draftOf('Fix the typo, then push it')
    const runs = logOf('answer-tries.log').filter((x) => x.try === 'run')
    ok(runs.length === 2 && runs.every((x) => !x.done && /wait for Tester: call your request_push tool/.test(x.why)), 'git push and gh are refused by its hook, saying pushing waits for you and to call request_push', runs)
    const hooks = logOf('hooks.log').filter((x) => x.tool === 'Bash')
    ok(hooks.length === 2 && hooks.every((x) => x.status === 2), '(each refused by its hook, exit 2)', hooks)
    ok(!branches().length && !ghCalls().length, 'nothing pushed, no pull request')
  })

  // ---------- request_push: waits for you ----------
  await part('request_push', async () => {
    const tries = logOf('answer-tries.log').filter((x) => x.try === 'push')
    ok(tries.length === 1 && tries[0].done, 'its agent asked with its request_push tool', tries)
    const item = await until(async () => (await needs()).find((x) => x.id === d1?.id && x.push?.state === 'waiting'), 15000)
    const p = item?.push
    ok(p && p.title === 'Fix the README typo' && /^[0-9a-f]{40}$/.test(p.head) && /^bot\/code-bot\//.test(p.branch), 'in Needs You: the push it asked for, its branch and the commit you\'re shown', p)
    const asked = await until(async () => (await inThread(q1.ts)).find((x) => /I'd like to push my changes/.test(x.text || '')), 15000)
    const buttons = (asked?.blocks || []).flatMap((x) => x.elements || []).filter((e) => e.type === 'button')
    ok(buttons.length === 2 && buttons[0].value === `${d1.id} push:${p.id} ${p.head.slice(0, 12)}`, 'where it was asked: Push and Don\'t push', buttons.map((x) => `${x.action_id}:${x.value}`))
    ok(!!(await until(async () => (await posted()).find((x) => x.channel === 'D0OWNER' && /asks to push/.test(x.text || '')), 10000)), 'and in your DM, with how to say it in words')
    // Dana's press: nothing.
    await slack.click({ user: 'U0DANA', action_id: buttons[0].action_id, value: buttons[0].value, channel: asked.channel, ts: asked.ts })
    const told = await until(async () => (await slack.state()).ephemeral.find((x) => x.user === 'U0DANA' && /Only Tester/.test(x.text)), 8000)
    ok(!!told && !branches().length, 'Dana\'s press does nothing, and tells her only you decide', told)
    // Another commit than the one shown: refused.
    const wrong = await kit.api(`/bots/questions/${d1.id}/push`, { act: 'approve', hash: MAIN }).then(() => null, (e) => e)
    ok(wrong?.status === 409 && !branches().length, 'approving another commit than the one waiting is refused (409)', wrong?.message)
    const r = await kit.api(`/bots/questions/${d1.id}/push`, { act: 'approve', hash: p.head })
    ok(/\/pull\/\d+$/.test(r.pr?.url || ''), 'approved: a draft pull request', r.pr)
    const pr = ghCalls().find((c) => c.args[0] === 'pr' && c.args[1] === 'create')
    ok(pr?.args.includes('--draft') && pr.args.includes(`--head=${p.branch}`) && pr.args.includes('--base=main'), 'opened with your gh, from its branch into main', pr?.args)
    ok(branches().join() === p.branch && git(ORIGIN, 'rev-parse', p.branch) === p.head && git(ORIGIN, 'rev-parse', 'main') === MAIN, 'its branch pushed, at the commit you were shown; main as it was', branches())
    ok(!!(await until(async () => (await inThread(q1.ts)).find((x) => /Pushed, with Tester's OK: a draft pull request is open, https:\/\/github\.com\/acme\/app\/pull\/\d+/.test(x.text || '')), 15000)), 'they\'re told, with its link')
    const again = await kit.api(`/bots/questions/${d1.id}/push`, { act: 'approve', hash: p.head })
    ok(again.already && ghCalls().filter((c) => c.args[1] === 'create').length === 1, 'approved again: nothing twice', again)
    ok(events('b1').some((e) => e.type === 'push.requested') && events('b1').some((e) => e.type === 'push.approved' && e.by === 'Tester' && /\/pull\//.test(e.url)), 'in its record: asked, and approved by you')
    await kit.api(`/bots/questions/${d1.id}`, { send: false })
  })

  // ---------- Its button; and "no push" ----------
  await part('button and words', async () => {
    await slack.ask({ user: 'U0DANA', thread: q1.ts, text: 'Note it in the changelog too. [edit CHANGELOG.md Fixed a typo] [push Changelog] [answer Noted.]' })
    const d2 = await draftOf('Note it in the changelog')
    const p2 = await until(async () => (await needs()).find((x) => x.id === d2?.id)?.push, 15000)
    const asked = await until(async () => (await inThread(q1.ts)).filter((x) => /I'd like to push my changes/.test(x.text || '')).at(-1), 15000)
    const btn = (asked?.blocks || []).flatMap((x) => x.elements || []).find((e) => e.type === 'button' && e.value?.includes(p2?.id))
    await slack.click({ user: OWNER.id, action_id: btn.action_id, value: btn.value, channel: asked.channel, ts: asked.ts })
    ok(!!(await until(() => git(ORIGIN, 'rev-parse', p2.branch) === p2.head, 15000)), 'your press of Push pushes it', { want: p2?.head, have: git(ORIGIN, 'rev-parse', p2?.branch) })
    await kit.api(`/bots/questions/${d2.id}`, { send: false })
    await slack.ask({ user: 'U0DANA', thread: q1.ts, text: 'And the README title. [edit README.md Hello world!] [push Title] [answer Done.]' })
    const d3 = await draftOf('And the README title')
    const p3 = await until(async () => (await needs()).find((x) => x.id === d3?.id)?.push, 15000)
    const n = d3.id.replace(/^.*-q/, '')
    await slack.ask({ user: OWNER.id, dm: true, text: `no push ${n}` })
    ok(!!(await until(async () => (await posted()).find((x) => x.channel === 'D0OWNER' && /Not pushed/.test(x.text || '')), 10000)), '"no push N" in your DM: not pushed, said')
    ok(git(ORIGIN, 'rev-parse', p3.branch) !== p3.head && !!(await until(async () => (await inThread(q1.ts)).find((x) => /Tester didn't push it/.test(x.text || '')), 10000)), 'nothing pushed, and they\'re told')
  })

  // ---------- 'pr' bots ----------
  await part('pr migrated', async () => {
    await kit.api('/bots', { name: 'Old PR Bot' })
    const f = path.join(kit.data, 'bots', 'b2', 'bot.json')
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    fs.writeFileSync(f, JSON.stringify({ ...j, changes: 'pr', readsFrom: ['~/code/app'] }, null, 2))
    await kit.restart()
    const v = await kit.api('/bots/b2')
    ok(v.settings.changes === 'suggest', 'a bot kept as \'pr\' proposes as \'suggest\' now: its pull requests wait for you', v.settings.changes)
    ok(JSON.parse(fs.readFileSync(f, 'utf8')).changes === 'suggest' && events('b2').some((e) => e.type === 'settings.changed' && e.setting === 'changes' && e.old === 'pr' && e.new === 'suggest'), 'kept so, and said in its record')
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  kit.stop()
  slack.stop()
}
process.exit(done().fail ? 1 : 0)
