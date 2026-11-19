// Bots' changes (bots-spec §5.6, §6.3, D6), with the stand-in Slack, Claude Code and GitHub CLI
// (stand-ins/slack.mjs, helper-claude.cjs, gh.cjs), a repository of its own and a bare one as its
// remote, in the browser named by BRIDGE_TEST_BROWSER.
//   suggest: someone you named asks for a change: its agent edits only in its own copy of the
//   repository (a git worktree in the data folder, started with edits allowed there and nothing
//   else: no command run, nothing written outside it, your checkout untouched); Bridge AI commits
//   it, keeps the diff beside the record, and the draft waits for you with the diff (in Needs You
//   and your Slack DM). Approved from Slack: Bridge AI pushes bot/<name>/<thread> (that branch only)
//   and opens a draft pull request with your gh; never a merge, never the default branch; the link
//   in the thread and the record. Someone who may ask but isn't named (everyone in its channels)
//   gets a read-only agent: no change. pr: the draft pull request opens at once, its link in the
//   draft; a follow-up in its thread adds to the same branch and pull request. gh signed out: said,
//   in the draft and the record, and sent once it's back. Settings and Needs You in light and dark.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { checks, until, sleep, browser, page, shot, phoneFaults, TEST, IS_WIN } from '../lib/harness.mjs'
import { botKit, openSettings, M, OWNER } from '../lib/bots.mjs'

const { ok, done } = checks('bots-changes')
// Its server needs git, as Bridge AI does for a change: on Windows the kit's PATH has only the
// system's folders, so git's own is added (where this test finds it).
const gitDir = IS_WIN ? path.dirname(String(spawnSync('where', ['git'], { encoding: 'utf8' }).stdout || '').split(/\r?\n/)[0] || 'C:\\Program Files\\Git\\cmd\\git.exe') : null
const { slack, kit, draftOf, startOf, logOf, botOf, connected, timelineOf, events, posted } = await botKit('bots-changes', { folders: ['code'], env: ({ PATH }) => (gitDir ? { PATH: `${PATH}${path.delimiter}${gitDir}`, BRIDGE_PATH: `${PATH}${path.delimiter}${gitDir}` } : {}) })
kit.program('gh', fs.readFileSync(path.join(TEST, 'stand-ins', 'gh.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }
const slashed = (p) => String(p || '').replace(/\\/g, '/')

// The repository it reads from, and its remote.
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
  await kit.api('/bots/b1/settings', { who: 'channels', askers: [{ id: 'U0DANA', name: 'Dana' }], readsFrom: ['~/code/app'], owner: OWNER })
  ok(!!(await connected()), 'a bot, connected, reading a repository')
  const bad = await kit.api('/bots/b1/settings', { repo: '~/elsewhere' }).then(() => null, (e) => e.message)
  ok(/one of the folders it reads from/.test(bad || ''), 'its changes\' repository has to be one of its folders', bad)
  await kit.api('/bots/b1/settings', { changes: 'suggest' })
  const v = await botOf()
  ok(v.settings.changes === 'suggest' && v.changes.repo && slashed(v.changes.repo) === '~/code/app' && v.changes.gh && v.changes.agentOk && !v.changes.problem, 'changes: suggest, in its repository, with gh there', v.changes)

  // ---------- suggest ----------
  await part('suggest', async () => {
    const q1 = await slack.ask({ user: 'U0DANA', text: `${M} Please fix the typo in the README [edit README.md Hello world] [edit-outside ~/code/app/OUTSIDE.md nope] [try-run] [answer Fixed the typo.]` })
    const s1 = await startOf('fix the typo in the README')
    const a1 = s1?.args.join(' ') || ''
    ok(real(s1?.cwd || '').startsWith(real(path.join(kit.data, 'front-desk', 'changes'))) && a1.includes('--tools Read,Grep,Glob,Edit,Write --allowedTools Edit(./**)') && a1.includes('--permission-mode dontAsk') && !a1.includes(APP) && !/acceptEdits|bypassPermissions/.test(a1), 'its agent works in its own copy of the repository, edits allowed only there, nothing asked', s1 && { cwd: s1.cwd, args: s1.args })
    const d1 = await draftOf('fix the typo in the README')
    const tries = logOf('answer-tries.log')
    ok(tries.some((x) => x.try === 'edit' && x.done) && tries.some((x) => x.try === 'edit-outside' && !x.done) && tries.some((x) => x.try === 'run' && !x.done), 'it edits its copy; writing outside it and running a command are refused', tries)
    ok(fs.readFileSync(path.join(APP, 'README.md'), 'utf8') === 'Hello wrold\n' && !fs.existsSync(path.join(APP, 'OUTSIDE.md')) && git(APP, 'status', '--porcelain') === '' && git(APP, 'rev-parse', 'main') === MAIN && git(APP, 'symbolic-ref', '--short', 'HEAD') === 'main', 'your checkout is untouched: not a file, nor its branch')
    const ch = d1?.change
    ok(ch?.mode === 'suggest' && /^bot\/code-bot\/\d+-\d+$/.test(ch.branch) && /1 file changed/.test(ch.stat) && /\+Hello world/.test(ch.diff) && ch.files.join() === 'README.md' && !ch.pr, 'the draft waits for you with its change: the branch, what changed and the diff', ch)
    const t1 = await timelineOf('b1', 'fix the typo in the README')
    const prop = t1.find((e) => e.type === 'change.proposed')
    ok(prop?.branch === ch?.branch && fs.existsSync(path.join(kit.data, 'bots', 'b1', 'trace', prop.diffFile)) && /\+Hello world/.test(fs.readFileSync(path.join(kit.data, 'bots', 'b1', 'trace', prop.diffFile), 'utf8')), 'the change is in its record, its diff kept beside it', prop && { branch: prop.branch, diffFile: prop.diffFile })
    ok(!branches().length && !ghCalls().length, 'nothing pushed, no pull request yet')
    const dm = await until(async () => (await slack.state()).posted.find((x) => x.channel === 'D0OWNER' && JSON.stringify(x.blocks || []).includes(`"action_id":"bb_approve"`)), 10000)
    ok(!!dm && /Hello world/.test(JSON.stringify(dm.blocks)), 'in your Slack DM: the diff, and Approve', dm && JSON.stringify(dm.blocks).slice(0, 300))
    await slack.click({ user: OWNER.id, action_id: 'bb_approve', value: d1.id })
    const link = await until(async () => (await inThread(q1.ts)).find((x) => /Draft pull request: https:\/\/github\.com\/acme\/app\/pull\/\d+/.test(x.text)), 30000)
    ok(!!link && /Fixed the typo/.test(link.text), 'approved from Slack: the answer and its pull request\'s link in the thread', link?.text)
    const pr = ghCalls().find((c) => c.args[0] === 'pr' && c.args[1] === 'create')
    ok(pr && pr.args.includes('--draft') && pr.args.includes('--base=main') && pr.args.includes(`--head=${ch.branch}`) && /Asked by Dana in #launch/.test(pr.body), 'a draft pull request, opened with your gh, from its branch into main', pr && { args: pr.args, body: pr.body.slice(0, 200) })
    ok(branches().join() === ch.branch && git(ORIGIN, 'rev-parse', 'main') === MAIN && git(ORIGIN, 'show', `${ch.branch}:README.md`) === 'Hello world' && /^Code Bot: Please fix the typo/.test(git(ORIGIN, 'log', '-1', '--format=%s', ch.branch)) && git(ORIGIN, 'log', '-1', '--format=%an', ch.branch) === 'Tester', 'Bridge AI pushed its branch only, with your name on the commit; main is as it was', { branches: branches(), main: git(ORIGIN, 'rev-parse', 'main') === MAIN })
    ok(!ghCalls().some((c) => c.args[1] === 'merge'), 'and never merges')
    const t1b = await timelineOf('b1', 'fix the typo in the README')
    ok(t1b.some((e) => e.type === 'change.approved' && e.by === 'Tester' && e.via === 'slack') && t1b.some((e) => e.type === 'pr.opened' && /\/pull\/\d+$/.test(e.url) && e.draft), 'approved, and the pull request, in its record', t1b.filter((e) => /^(change|pr)\./.test(e.type)).map((e) => e.type))
    ok(!!(await until(() => !fs.existsSync(String(s1.cwd)), 10000)), 'its copy of the repository is tidied away once the pull request is open')
  })

  // ---------- Someone who may ask, but isn't named ----------
  await part('not named', async () => {
    await slack.ask({ user: 'U0EVE', text: `${M} Change the README to say hacked [edit README.md Hacked] [answer Done.]` })
    const s = await startOf('Change the README to say hacked')
    const d = await draftOf('Change the README to say hacked')
    ok(real(s?.cwd || '') === real(APP) && /--tools Read,Grep,Glob,Write (--add-dir( \S+)+ )--allowedTools Edit\(\/\S*\/outbox\/[^/\s]+\/\*\*\) --permission-mode dontAsk/.test(s.args.join(' ')) && s.args.filter((x) => x.startsWith('Edit(')).length === 1, 'everyone may ask in its channels, but only people you named may ask for a change: Eve\'s agent can only read', s?.args)
    ok(!d?.change && /I can't change README\.md here/.test(d?.draft || '') && fs.readFileSync(path.join(APP, 'README.md'), 'utf8') === 'Hello wrold\n', 'nothing changed, and its answer says so', d?.draft)
    await kit.api(`/bots/questions/${d.id}`, { send: false })
  })

  // ---------- pr: a draft pull request at once ----------
  await part('pr', async () => {
    await kit.api('/bots/b1/settings', { changes: 'pr' })
    const q = await slack.ask({ user: 'U0DANA', text: `${M} Add a changelog line [edit CHANGELOG.md Added a line] [answer Added it.]` })
    const d = await draftOf('Add a changelog line')
    const url = /Draft pull request: (\S+)/.exec(d?.draft || '')?.[1]
    ok(!!url && d.change?.pr?.url === url && branches().includes(d.change.branch), 'pr: the draft pull request opens at once, its link in the draft', d?.draft)
    ok(!d.auto && d.state === 'draft', 'the answer itself still waits for you')
    await kit.api(`/bots/questions/${d.id}`, { send: true, text: d.draft })
    ok(!!(await until(async () => (await inThread(q.ts)).find((x) => x.text.includes(url)), 15000)), 'sent, with its link')
    // A follow-up in its thread: the same branch, the same pull request.
    await slack.ask({ user: 'U0DANA', thread: q.ts, text: 'And one more line please [edit CHANGELOG.md Added two lines] [answer Added another.]' })
    const f = await draftOf('one more line please')
    ok(f?.change?.branch === d.change.branch && f.change.pr?.url === url && git(ORIGIN, 'show', `${d.change.branch}:CHANGELOG.md`) === 'Added two lines' && git(ORIGIN, 'rev-list', '--count', `main..${d.change.branch}`) === '2', 'a follow-up adds to the same branch and pull request', f?.change)
    await kit.api(`/bots/questions/${f.id}`, { send: false })
  })

  // ---------- gh signed out ----------
  await part('gh signed out', async () => {
    fs.writeFileSync(path.join(kit.home, 'gh-signed-out'), '')
    const q = await slack.ask({ user: 'U0DANA', text: `${M} Bump the version [edit VERSION 1.1.0] [answer Bumped.]` })
    const d = await draftOf('Bump the version')
    ok(/gh isn't signed in to GitHub, so the pull request couldn't be opened \(the branch is pushed\)/.test(d?.problem || '') && !/pull request:/i.test(d.draft) && (await timelineOf('b1', 'Bump the version')).some((e) => e.type === 'change.failed' && e.step === 'pr'), 'gh signed out: said in the draft and the record, not hidden', d?.problem)
    ok(!(await inThread(q.ts)).some((x) => /Bumped/.test(x.text)), 'and nothing is sent')
    fs.rmSync(path.join(kit.home, 'gh-signed-out'))
    const r = await kit.api(`/bots/questions/${d.id}`, { send: true, text: d.draft })
    ok(!!(await until(async () => (await inThread(q.ts)).find((x) => /Bumped\.[\s\S]*Draft pull request: https:/.test(x.text)), 20000)), 'signed in again: Send opens it, and sends the link', r.item?.state)
  })

  // ---------- In Bridge AI ----------
  await kit.api('/bots/b1/settings', { changes: 'suggest' })
  await slack.ask({ user: 'U0DANA', text: `${M} Fix the title [edit README.md Hello there] [answer Retitled.]` })
  const waiting = await draftOf('Fix the title')
  for (const [mode, theme, phone] of [['light', 'sky', false], ['dark', 'midnight', false], ['light', 'sky', true]]) {
    await part(`Needs You and Settings, ${mode}${phone ? ', on a phone' : ''}`, async () => {
      const { ctx, p, errors } = await page(b, kit.url, { mode, theme, phone })
      await p.locator('.needs-chip').click({ timeout: 15000 })
      const item = p.locator('.ny-item.t-slack', { hasText: 'Fix the title' }).first()
      await item.waitFor({ timeout: 10000 })
      const words = await item.innerText()
      ok(/Approve and open a pull request/.test(words) && /\+Hello there/.test(words) && new RegExp(waiting.change.branch).test(words), 'Needs You: the change\'s branch and diff, and Approve and open a pull request', words.slice(0, 500))
      if (phone) { const faults = await phoneFaults(p, '.ny-item.t-slack'); ok(!Object.keys(faults).length, 'on a phone: nothing too small to tap, off the screen or cut short', faults) }
      await shot(p, `${tag}bots-changes-needs-you-${mode}${phone ? '-phone' : ''}`)
      await p.keyboard.press('Escape')
      await openSettings(p)
      const sec = p.locator('[data-setting="slack-changes"]')
      await sec.scrollIntoViewIfNeeded()
      const said = await sec.innerText()
      ok(/never merges/i.test(said) && /code[\\/]app/.test(said), 'Settings › Changes: where, and that it never merges', said.slice(0, 400))
      await shot(p, `${tag}bots-changes-settings-${mode}${phone ? '-phone' : ''}`)
      ok(errors.length === 0, 'no page errors', errors)
      await ctx.close()
    })
  }
  ok((await kit.api('/bots/b1/activity')).integrity?.ok && events().some((e) => e.type === 'pr.opened'), 'all of it in its record, whole')
  ok(git(ORIGIN, 'rev-parse', 'main') === MAIN && git(APP, 'rev-parse', 'main') === MAIN, 'and at the end, main is as it was, here and on the remote')
  void sleep
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  await b.close()
  kit.stop()
  slack.stop()
}
process.exit(done().fail ? 1 : 0)
