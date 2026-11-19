// Bots that change files (Changes: Edits Files in Its Folders, server/botwrite.js), with the stand-in
// Slack (its first app a shared connection reaching two bots), a stand-in model for AI Assist and the
// stand-in Claude Code answering (stand-ins/helper-claude.cjs, which runs the PreToolUse hooks its
// --settings give, and calls bridge_files's delete_file and move_file), in the browser named by
// BRIDGE_TEST_BROWSER.
//   Settings: a write folder has to be one of, or inside, a folder it reads (one outside, or hidden,
//   refused); the Access line says where it changes files, and for whom without asking.
//   You asking: its agent works in a staging copy (the real folder never given to it, edits allowed
//   only there, its path-checking hook in its settings), the change made at once in ~/Hiring, the
//   reply with Undo; someone else's Undo refused, yours putting it back.
//   Someone else asking: the change made in its copy only, waiting for you, said where they asked with
//   Approve and Deny, in your Slack DM with the diff, and in Needs You; anyone else's press refused,
//   theirs too; yours makes it, and they're told. Approved in your DM, in words in your DM (only with
//   the change's code), denied from Needs You (they're told nothing changed). An approval names its
//   change: a wrong hash is refused, and a newer change in the same thread takes the place of the one
//   waiting, whose buttons then do nothing.
//   Whoever asks, you too: a deletion, a move, more than 20 files and a dotfile wait for you, said why.
//   Outside: a file outside its copy refused by Claude Code's permissions, one past them refused by its
//   hook, and a path through a link in the real folder refused outright, nothing written outside.
//   The screen: "delete everything" not started, held for you with Allow Once and Deny (someone else's
//   press refused), denied and said; one AI Assist's model calls odd held, allowed once, and answered.
//   A bot that only reads handing a change on: Try a Message says what each would do for whom; Eve
//   (who may ask it, not Hiring) refused by Hiring; Dana's handed change waiting for you; yours made.
//   Needs You, Settings › Bots (Access and Activity) in light and dark, on a computer and a phone,
//   where a change waiting is approved.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { checks, until, sleep, browser, page, shot, phoneFaults, startModel, IS_WIN } from '../lib/harness.mjs'
import { botKit, openSettings, M, OWNER } from '../lib/bots.mjs'

const { ok, done } = checks('bots-write')
const model = await startModel('bots-write')
// Its server needs git for a folder that's a repository: on Windows the kit's PATH has only the
// system's folders, so git's own is added (where this test finds it).
const gitDir = IS_WIN ? path.dirname(String(spawnSync('where', ['git'], { encoding: 'utf8' }).stdout || '').split(/\r?\n/)[0] || 'C:\\Program Files\\Git\\cmd\\git.exe') : null
let git = null
const { slack, kit, home, startOf, startsOf, briefOf, logOf, events, posted, needs } = await botKit('bots-write', {
  folders: ['Hiring/offers', 'Secret', '.private', 'Docs'],
  env: ({ home: h, PATH }) => {
    fs.writeFileSync(path.join(h, 'Hiring', 'roles.md'), '# Roles\n\nDesign\nSales\n')
    fs.writeFileSync(path.join(h, 'Hiring', 'old.md'), 'An old note.\n')
    fs.writeFileSync(path.join(h, 'Secret', 'keep.md'), 'Not the bot\'s.\n')
    fs.symlinkSync(path.join(h, 'Secret'), path.join(h, 'Hiring', 'link'))
    // ~/Docs, a repository of its own: a commit, a line changed since and not committed, a file git
    // ignores.
    git = (...args) => { const r = spawnSync('git', ['-C', path.join(h, 'Docs'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: h, GIT_CONFIG_NOSYSTEM: '1' } }); return (r.stdout || '').trim() || (r.status ? `ERR ${r.stderr}` : '') }
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Tester')
    git('config', 'user.email', 'tester@example.com')
    fs.writeFileSync(path.join(h, 'Docs', 'README.md'), 'Docs\n\nCommitted line\n')
    fs.writeFileSync(path.join(h, 'Docs', '.gitignore'), 'build/\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'First')
    fs.writeFileSync(path.join(h, 'Docs', 'README.md'), 'Docs\n\nCommitted line\nUncommitted line\n')
    fs.mkdirSync(path.join(h, 'Docs', 'build'))
    fs.writeFileSync(path.join(h, 'Docs', 'build', 'out.txt'), 'built\n')
    // (No model on this computer is reached: AI Assist's is the stand-in's, once it's given.)
    return { OLLAMA_HOST: 'http://127.0.0.1:9', LM_STUDIO_BASE_URL: 'http://127.0.0.1:9/v1', ...(gitDir ? { PATH: `${PATH}${path.delimiter}${gitDir}`, BRIDGE_PATH: `${PATH}${path.delimiter}${gitDir}` } : {}) }
  },
})
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const H = (...p) => path.join(home, 'Hiring', ...p)
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }
const state = () => slack.state()
const inThread = async (ts) => (await posted()).filter((x) => x.thread_ts === ts)
const has = (x, action) => JSON.stringify(x?.blocks || []).includes(`"action_id":"${action}"`)
const valueOf = (x, action) => (x?.blocks || []).flatMap((bl) => bl.elements || []).find((e) => e.action_id === action)?.value
const cardIn = (ts, action, ms = 40000) => until(async () => (await inThread(ts)).find((x) => has(x, action)), ms)
const dmCard = (words, action, ms = 20000) => until(async () => (await posted()).find((x) => x.channel === 'D0OWNER' && has(x, action) && JSON.stringify(x.blocks).includes(words)), ms)
// A button pressed as someone, and what they alone were told after it (nothing before it counts).
const press = async (user, action, card) => {
  const n = (await state()).ephemeral.length
  await slack.click({ user, action_id: action, value: valueOf(card, action), channel: card.channel, ts: card.ts })
  return n
}
const told = (user, re, from = 0, ms = 15000) => until(async () => (await state()).ephemeral.slice(from).find((x) => x.user === user && re.test(x.text || '')), ms)
const itemOf = (words, ms = 40000) => until(async () => (await needs()).find((x) => String(x.text || '').includes(words)), ms)
const waitingOf = (words, ms = 40000) => until(async () => { const x = (await needs()).find((y) => String(y.text || '').includes(words)); return x?.write?.state === 'waiting' ? x : null }, ms)
const tries = () => logOf('answer-tries.log')
const DANA = { id: 'U0DANA', name: 'Dana' }
const SAM = { id: 'U0SAM', name: 'Sam' }
const EVE = { id: 'U0EVE', name: 'Eve' }

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  // One shared app reaching both bots, you in Slack there; AI Assist's model.
  const C = (await kit.api('/connections', { platform: 'slack', name: 'tester_bot' })).id
  await kit.api(`/connections/${C}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots', { name: 'Hiring', description: 'Offers, roles and hiring notes' })
  await kit.api('/bots', { name: 'Chief', description: 'Answers anything about the team' })
  const ids = Object.fromEntries((await kit.api('/bots')).bots.map((x) => [x.name, x.id]))
  const HI = ids.Hiring
  const CH = ids.Chief
  await kit.api(`/connections/${C}`, { owner: OWNER }, 'PATCH')
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { studio: { model: 'openai:gpt-5' } }, 'PATCH')
  ok(!!(await until(async () => (await kit.api(`/connections/${C}`)).state === 'connected', 20000)), 'a shared connection, connected, reaching Hiring and Chief')

  // ---------- Settings ----------
  await part('settings', async () => {
    await kit.api(`/bots/${HI}/settings`, { who: 'named', askers: [DANA, SAM], readsFrom: ['~/Hiring'], answerIn: 'thread', auto: true })
    const outside = await kit.api(`/bots/${HI}/settings`, { changes: 'edit', writesTo: ['~/Secret'] }).then(() => null, (e) => e.message)
    ok(/isn't one of, or inside, the folders it reads from/.test(outside || ''), 'a write folder outside what it reads: refused', outside)
    const hidden = await kit.api(`/bots/${HI}/settings`, { readsFrom: ['~/Hiring', '~/.private'] }).then(() => kit.api(`/bots/${HI}/settings`, { writesTo: ['~/.private'] })).then(() => null, (e) => e.message)
    ok(/hidden folder/.test(hidden || ''), 'a hidden folder: refused', hidden)
    await kit.api(`/bots/${HI}/settings`, { readsFrom: ['~/Hiring'] })
    const v = await kit.api(`/bots/${HI}/settings`, { changes: 'edit', writesTo: ['~/Hiring'], trusted: [SAM] })
    ok(v.settings.changes === 'edit' && v.settings.writesTo.join() === '~/Hiring' && v.settings.trustYou === true && v.settings.trusted.map((x) => x.id).join() === 'U0SAM' && v.changes?.writes?.[0]?.ok && !v.changes.problem, 'Edits Files in Its Folders: ~/Hiring, made without asking for you and Sam', { s: v.settings, c: v.changes })
    const brief = (await kit.api('/bots')).bots.find((x) => x.id === HI)
    ok(brief.access.changes === 'edit' && brief.access.writesTo.join() === '~/Hiring' && brief.access.trusted === 1 && brief.access.trustYou === true, 'its access in brief says where it changes files, and how many are trusted with it (never who)', brief.access)
    const gone = await kit.api(`/bots/${CH}/settings`, { handsTo: [CH] }).then(() => null, (e) => e.message)
    ok(/other bots/.test(gone || ''), 'a bot can\'t hand changes to itself', gone)
    await kit.api(`/bots/${CH}/settings`, { who: 'channels', readsFrom: ['~/Hiring'], answerIn: 'thread', auto: true, handsTo: [HI] })
  })

  // ---------- You: made at once, with Undo ----------
  await part('you, made at once', async () => {
    const q = await slack.ask({ user: OWNER.id, text: `${M} Hiring: add an offer for Dana [edit Hiring/offers/dana.md Offer for Dana] [answer Added it.]` })
    const s = await startOf('add an offer for Dana')
    const a = s?.args.join(' ') || ''
    const brief = briefOf(s)
    ok(real(s?.cwd || '').startsWith(real(path.join(kit.data, 'front-desk', 'writes'))) && a.includes('--tools Read,Grep,Glob,Edit,Write --allowedTools Edit(./**)') && a.includes('mcp__bridge_files__delete_file') && /--settings \S+settings\.json/.test(a) && a.includes('--permission-mode dontAsk') && !s.args.includes(H()) && !s.args.includes(real(H())),
      'its agent works in a staging copy: edits there only, delete_file and move_file there, the hook in its settings, the real ~/Hiring not given to it', s && { cwd: s.cwd, args: s.args })
    ok(/Hiring\/ is your copy of ~\/Hiring/.test(brief) && /Bridge AI checks what changed and makes it in ~\/Hiring itself/.test(brief), 'its brief says where its copy is, and that Bridge AI makes the change', brief.slice(0, 600))
    ok(!!(await until(() => read(H('offers', 'dana.md')) === 'Offer for Dana\n', 40000)), 'made in ~/Hiring at once: you may change files without asking yourself')
    const hooks = logOf('hooks.log')
    ok(hooks.some((x) => x.status === 0 && /dana\.md$/.test(x.path || '')), 'its hook looked at the path before it was written', hooks)
    const reply = await cardIn(q.ts, 'bb_undo')
    ok(/Added it\./.test(reply?.text || '') && /Changed: ~\/Hiring\/offers\/dana\.md \(new\)/.test(reply?.text || ''), 'the reply says what changed, with Undo', reply?.text)
    const ev = events(HI)
    ok(ev.some((e) => e.type === 'write.proposed' && e.direct && !e.waits) && ev.some((e) => e.type === 'write.applied' && e.direct && e.files?.some((f) => /dana\.md$/.test(f))), 'in its record: the change, made without asking you', ev.filter((e) => /^write\./.test(e.type)).map((e) => e.type))
    const n0 = await press('U0EVE', 'bb_undo', reply)
    ok(!!(await told('U0EVE', /Only Tester can undo this change/, n0)) && read(H('offers', 'dana.md')) === 'Offer for Dana\n', 'someone else\'s Undo: refused, said to them alone, and nothing undone')
    await press(OWNER.id, 'bb_undo', reply)
    ok(!!(await until(() => !fs.existsSync(H('offers', 'dana.md')), 15000)), 'your Undo puts it back as it was')
    ok(!!(await until(async () => (await inThread(q.ts)).find((x) => /^Undone by Tester/.test(x.text || '')), 15000)) && events(HI).some((e) => e.type === 'write.undone' && e.by === 'Tester' && e.via === 'slack'), 'they\'re told, and it\'s in the record')
  })

  // ---------- A folder that's a repository: a git worktree as its copy ----------
  await part('a repository', async () => {
    await kit.api(`/bots/${HI}/settings`, { readsFrom: ['~/Hiring', '~/Docs'], writesTo: ['~/Hiring', '~/Docs'] })
    const head = git('rev-parse', 'HEAD')
    const q = await slack.ask({ user: OWNER.id, text: `${M} Hiring: fix the docs [edit Docs/README.md Fixed docs] [answer Fixed.]` })
    ok(!!(await until(() => read(path.join(home, 'Docs', 'README.md')) === 'Fixed docs\n', 40000)), '~/Docs changed at once, as you asked')
    const of = (type) => events(HI).find((e) => e.type === type && e.ts === q.ts)
    ok(of('run.started')?.write?.folders?.some((f) => f.shown === '~/Docs' && f.how === 'git') && of('run.started').write.folders.some((f) => f.shown === '~/Hiring' && f.how !== 'git'), 'its copy of ~/Docs a git worktree, of ~/Hiring a copy', of('run.started')?.write)
    ok(/-Uncommitted line/.test(of('write.proposed')?.diff || ''), 'the copy has what was changed and not committed: the diff starts from it', of('write.proposed')?.diff)
    const q2 = await slack.ask({ user: OWNER.id, text: `${M} Hiring: rebuild the docs [edit Docs/build/out.txt rebuilt] [answer Rebuilt.]` })
    const prop = await until(() => events(HI).find((e) => e.type === 'write.proposed' && e.ts === q2.ts), 40000)
    ok(prop?.refused?.some((r) => r.why === 'there' && /build\/out\.txt$/.test(r.file)) && read(path.join(home, 'Docs', 'build', 'out.txt')) === 'built\n', 'a file git ignores isn\'t in the copy, and one made over it is refused, the real one untouched', prop?.refused)
    ok(git('rev-parse', 'HEAD') === head && git('worktree', 'list').split('\n').length === 1, 'and the repository is as it was: no commit, no worktree left', git('worktree', 'list'))
    const it = await until(async () => (await needs()).find((x) => /rebuild the docs/.test(x.text) && x.write), 15000)
    if (it) await kit.api(`/bots/questions/${it.id}`, { send: false })
    await kit.api(`/bots/${HI}/settings`, { readsFrom: ['~/Hiring'] })
    const v = await kit.api(`/bots/${HI}`)
    ok(v.settings.writesTo.join() === '~/Hiring', 'a folder taken out of what it reads takes it out of what it changes', v.settings.writesTo)
  })

  // ---------- Someone else: waits for you ----------
  await part('someone else, approved where it was asked', async () => {
    const q = await slack.ask({ user: 'U0DANA', text: `${M} Hiring: update the roles [edit Hiring/roles.md Roles: design, sales and support] [answer Updated the roles.]` })
    const card = await cardIn(q.ts, 'bb_wok')
    ok(/waits for Tester to approve it/.test(card?.text || '') && has(card, 'bb_wno') && read(H('roles.md')) === '# Roles\n\nDesign\nSales\n', 'Dana\'s change: made in its copy only, and they\'re told where they asked that it waits for you, with Approve and Deny', card?.text)
    const dm = await dmCard('update the roles', 'bb_wok')
    ok(!!dm && /Roles: design, sales and support/.test(JSON.stringify(dm.blocks)) && /asked by \*Dana\*, waiting for you/.test(JSON.stringify(dm.blocks)), 'in your Slack DM: who asked, the diff, Approve and Send', dm && JSON.stringify(dm.blocks).slice(0, 400))
    const it = await waitingOf('update the roles')
    ok(it?.write?.files?.[0]?.path === '~/Hiring/roles.md' && /\+Roles: design, sales and support/.test(it.write.diff) && /-Design/.test(it.write.diff) && it.write.by?.id === 'U0DANA' && /^[0-9a-f]{64}$/.test(it.write.hash), 'in Needs You: the file, its diff and who asked', it?.write)
    for (const who of ['U0EVE', 'U0DANA']) {
      const n = await press(who, 'bb_wok', card)
      ok(!!(await told(who, /Only Tester can approve this change/, n)), `${who === 'U0EVE' ? 'Eve\'s' : 'Dana\'s own'} press of Approve: refused, and said to them alone`)
    }
    ok(read(H('roles.md')) === '# Roles\n\nDesign\nSales\n' && (await waitingOf('update the roles', 3000)), 'and nothing changed: it still waits')
    await press(OWNER.id, 'bb_wok', card)
    ok(!!(await until(() => read(H('roles.md')) === 'Roles: design, sales and support\n', 20000)), 'your press, where it was asked: the change is made')
    const sent = await until(async () => (await inThread(q.ts)).find((x) => /Updated the roles\./.test(x.text || '') && /Changed: ~\/Hiring\/roles\.md/.test(x.text || '')), 15000)
    ok(!!sent && events(HI).some((e) => e.type === 'write.applied' && e.by === 'Tester' && e.via === 'slack' && !e.direct), 'Dana gets the answer with what changed; approved by you, from Slack, in the record', sent?.text)
    const again = await press(OWNER.id, 'bb_wok', card)
    ok(!!(await told(OWNER.id, /isn't waiting any more|made already/, again)), 'pressed again: it isn\'t made twice')
  })

  await part('approved in your DM, in words, and denied', async () => {
    const q = await slack.ask({ user: 'U0DANA', text: `${M} Hiring: add an offer for Sam [edit Hiring/offers/sam.md Offer for Sam] [answer Done.]` })
    const dm = await dmCard('add an offer for Sam', 'bb_wok')
    await press(OWNER.id, 'bb_wok', dm)
    ok(!!(await until(() => read(H('offers', 'sam.md')) === 'Offer for Sam\n', 20000)), 'approved from your Slack DM: made')
    ok(!!(await until(async () => (await inThread(q.ts)).find((x) => /Changed: ~\/Hiring\/offers\/sam\.md/.test(x.text || '')), 15000)), 'and Dana is told')
    // In words, in your direct message: only with the change's code.
    const q2 = await slack.ask({ user: 'U0DANA', text: `${M} Hiring: add an offer for Gus [edit Hiring/offers/gus.md Offer for Gus] [answer Done.]` })
    const it = await waitingOf('add an offer for Gus')
    const n = it.id.replace(/^.*-q/, '')
    await slack.ask({ user: OWNER.id, dm: true, text: `approve ${n}` })
    ok(!!(await until(async () => (await posted()).find((x) => x.channel === 'D0OWNER' && new RegExp(`Say “approve ${n} ${it.write.code}”`).test(x.text || '')), 15000)) && !fs.existsSync(H('offers', 'gus.md')), 'approve in words without its code: you\'re told the code, and nothing is made')
    await slack.ask({ user: OWNER.id, dm: true, text: `approve ${n} ${it.write.code}` })
    ok(!!(await until(() => read(H('offers', 'gus.md')) === 'Offer for Gus\n', 20000)), 'with its code: made')
    ok(!!(await until(async () => (await inThread(q2.ts)).find((x) => /Changed: ~\/Hiring\/offers\/gus\.md/.test(x.text || '')), 15000)), 'and Dana is told')
    // Denied from Needs You.
    const q3 = await slack.ask({ user: 'U0DANA', text: `${M} Hiring: add an offer for Xena [edit Hiring/offers/xena.md Offer for Xena] [answer Done.]` })
    const x = await waitingOf('add an offer for Xena')
    const bad = await kit.api(`/bots/questions/${x.id}`, { send: true, text: 'Done.', write: { id: x.write.id, hash: '0'.repeat(64) } }).then(() => null, (e) => e)
    ok(bad?.status === 409 && !fs.existsSync(H('offers', 'xena.md')), 'an approval naming another change (a wrong hash): refused, nothing made', bad?.message)
    await kit.api(`/bots/questions/${x.id}`, { send: false })
    ok(!!(await until(async () => (await inThread(q3.ts)).find((y) => /Tester didn't approve the change, so nothing was changed/.test(y.text || '')), 15000)) && !fs.existsSync(H('offers', 'xena.md')), 'denied from Needs You: nothing changed, and Dana is told')
    ok(events(HI).some((e) => e.type === 'write.declined' && e.by === 'Tester'), 'denied, in the record')
  })

  await part('a newer change takes the place of one waiting', async () => {
    const q = await slack.ask({ user: 'U0DANA', text: `${M} Hiring: add a note [edit Hiring/note.md First] [answer Added.]` })
    const card = await cardIn(q.ts, 'bb_wok')
    await slack.ask({ user: 'U0DANA', thread: q.ts, text: 'Actually make it this [edit Hiring/note.md Second] [answer Changed it.]' })
    const newer = await until(async () => (await inThread(q.ts)).filter((x) => has(x, 'bb_wok')).find((x) => x.ts !== card.ts), 40000)
    ok(!!newer && valueOf(newer, 'bb_wok') !== valueOf(card, 'bb_wok'), 'a follow-up in the thread: a new change, with its own Approve')
    const n = await press(OWNER.id, 'bb_wok', card)
    ok(!!(await told(OWNER.id, /isn't waiting any more|newer change/, n)) && !fs.existsSync(H('note.md')), 'the first one\'s Approve, pressed now: nothing made (its approval isn\'t the newer change\'s)')
    await press(OWNER.id, 'bb_wok', newer)
    ok(!!(await until(() => read(H('note.md')) === 'Second\n', 20000)), 'the newer one\'s: made, as it was shown')
    ok(events(HI).some((e) => e.type === 'write.replaced'), 'the replaced one, in the record')
  })

  // ---------- Whoever asks: what waits for you ----------
  await part('held for you, you too', async () => {
    await slack.ask({ user: OWNER.id, text: `${M} Hiring: remove the old note [delete Hiring/old.md] [answer Removed.]` })
    const del = await waitingOf('remove the old note')
    ok(del?.write?.held?.some((h) => h.why === 'delete') && fs.existsSync(H('old.md')) && tries().some((x) => x.try === 'delete' && x.done), 'you asking to delete a file: done in its copy with delete_file, and it waits for you all the same', del?.write)
    await kit.api(`/bots/questions/${del.id}`, { send: true, text: 'Removed.', write: { id: del.write.id, hash: del.write.hash } })
    ok(!!(await until(() => !fs.existsSync(H('old.md')), 15000)), 'approved: deleted')
    const r = await kit.api(`/bots/${HI}/writes/${del.write.id}/undo`, {})
    ok(r.change?.state === 'undone' && read(H('old.md')) === 'An old note.\n', 'Undo from Activity: it\'s back', r.change?.state)
    await slack.ask({ user: OWNER.id, text: `${M} Hiring: rename the roles [move Hiring/roles.md Hiring/roles-2026.md] [answer Renamed.]` })
    const mv = await waitingOf('rename the roles')
    ok(mv?.write?.held?.some((h) => h.why === 'move') && mv.write.files.some((f) => f.op === 'move'), 'a move waits for you', mv?.write?.held)
    await kit.api(`/bots/questions/${mv.id}`, { send: false })
    await slack.ask({ user: 'U0SAM', text: `${M} Hiring: make the batch [edit-many 25 Hiring/many] [answer Made them.]` })
    const many = await waitingOf('make the batch')
    ok(many?.write?.held?.some((h) => h.why === 'many') && many.write.files.length === 25 && !fs.existsSync(H('many')), 'Sam may change files without asking you, but 25 files wait for you', many?.write?.held)
    await kit.api(`/bots/questions/${many.id}`, { send: false })
    await slack.ask({ user: OWNER.id, text: `${M} Hiring: set the key [edit Hiring/.env SECRET=1] [answer Set.]` })
    const env = await waitingOf('set the key')
    ok(env?.write?.held?.some((h) => h.why === 'secret') && !fs.existsSync(H('.env')), 'a dotfile like .env waits for you', env?.write?.held)
    await kit.api(`/bots/questions/${env.id}`, { send: false })
  })

  // ---------- Outside: refused ----------
  await part('outside its folders', async () => {
    await slack.ask({ user: OWNER.id, text: `${M} Hiring: write outside [edit-outside ~/Secret/out.md pwned] [edit-anywhere ~/Secret/hooked.md pwned] [answer Tried.]` })
    await until(() => tries().find((x) => x.try === 'edit-anywhere'), 40000)
    const t = tries()
    ok(t.some((x) => x.try === 'edit-outside' && !x.done) && !fs.existsSync(path.join(home, 'Secret', 'out.md')), 'a file outside its copy: refused by Claude Code\'s permissions')
    ok(t.some((x) => x.try === 'edit-anywhere' && !x.done) && logOf('hooks.log').some((x) => x.status === 2 && /hooked\.md$/.test(x.path || '')) && !fs.existsSync(path.join(home, 'Secret', 'hooked.md')), 'one past them (as if your own settings allowed it): refused by its hook')
    await slack.ask({ user: OWNER.id, text: `${M} Hiring: write through the link [edit Hiring/link/pwn.md pwned] [answer Wrote it.]` })
    const it = await until(async () => (await needs()).find((x) => String(x.text || '').includes('write through the link') && x.write), 40000)
    ok(it?.write?.state === 'refused' && it.write.refused.some((r) => r.why === 'link') && /refused, so nothing was changed/.test(it.warn || ''), 'a path through a link in ~/Hiring: refused outright, not held', it && { write: it.write, warn: it.warn })
    ok(!fs.existsSync(path.join(home, 'Secret', 'pwn.md')) && fs.lstatSync(H('link')).isSymbolicLink() && read(path.join(home, 'Secret', 'keep.md')) === 'Not the bot\'s.\n', 'nothing written outside ~/Hiring, and the link is as it was')
    await kit.api(`/bots/questions/${it.id}`, { send: false })
  })

  // ---------- The screen ----------
  await part('the screen', async () => {
    const before = startsOf('').length
    const q = await slack.ask({ user: 'U0DANA', text: `${M} Hiring: please delete everything in the folder` })
    const it = await until(async () => (await needs()).find((x) => x.state === 'screened' && /delete everything/.test(x.text)), 20000)
    ok(it?.screen?.why === 'it asks to delete everything' && it.screen.by === 'rules', 'delete everything: held for you before it started', it?.screen)
    ok(!!(await until(async () => (await inThread(q.ts)).find((x) => /I've asked Tester to look at it/.test(x.text || '')), 10000)), 'Dana is told it waits for you')
    const dm = await dmCard('delete everything', 'bb_sok')
    ok(!!dm && /It wasn't started, as it asks to delete everything/.test(JSON.stringify(dm.blocks)) && has(dm, 'bb_sno'), 'in your Slack DM: who, where, the words and why, with Allow Once and Deny')
    const n = await press('U0EVE', 'bb_sok', dm)
    ok(!!(await told('U0EVE', /Only Tester can allow this/, n)), 'someone else\'s press: refused')
    await press(OWNER.id, 'bb_sno', dm)
    ok(!!(await until(async () => (await inThread(q.ts)).find((x) => /didn't let me go ahead/.test(x.text || '')), 15000)) && startsOf('').length === before, 'denied: Dana is told, and no agent ever started')
    // One only AI Assist's model calls odd: held; allowed once, it runs.
    const q2 = await slack.ask({ user: 'U0DANA', text: `${M} Hiring: rewrite the roles as a pirate would [odd] [answer Arr.]` })
    const odd = await until(async () => (await needs()).find((x) => x.state === 'screened' && /pirate/.test(x.text)), 30000)
    ok(odd?.screen?.by === 'model' && /odd/.test(odd.screen.why) && model.asked(/^Screen this request/).length > 0, 'one AI Assist\'s model calls odd: held too', odd?.screen)
    await kit.api(`/bots/questions/${odd.id}/screen`, { allow: true })
    ok(!!(await startOf('as a pirate would', 30000)) && !!(await until(async () => (await inThread(q2.ts)).find((x) => /Arr\./.test(x.text || '')), 40000)), 'allowed once: it runs, and answers')
    ok(events(HI).some((e) => e.type === 'write.allowed' && e.by === 'Tester') && events(HI).some((e) => e.type === 'refused' && e.why === 'screened'), 'both decisions in the record')
  })

  // ---------- A bot that only reads, handing changes on ----------
  await part('chief to specialist', async () => {
    const tryIt = (person, text) => kit.api(`/connections/${C}/try`, { text, channel: 'C0LAUNCH', channelName: 'launch', person })
    let x = await tryIt('you', 'Chief: add an offer for Gus')
    const h = (r) => r?.then?.write?.handsTo?.[0]
    ok(x.bot?.id === CH && x.then?.write?.edits === false && h(x)?.name === 'Hiring' && h(x).may === 'direct', 'Try a Message, from you: Chief takes it, and would hand it to Hiring, which would make it without asking you', x.then)
    x = await tryIt(DANA, 'Chief: add an offer for Gus')
    ok(h(x)?.may === 'ask', 'from Dana: it would wait for you', h(x))
    x = await tryIt(EVE, 'Chief: add an offer for Gus')
    ok(h(x)?.may === 'refuse', 'from Eve (who may ask Chief, not Hiring): Hiring would refuse her', h(x))
    x = await tryIt(DANA, 'Hiring: delete everything')
    ok(x.then?.write?.may === 'screened' && /delete everything/.test(x.then.write.why), 'and a request the screen holds: said', x.then?.write)
    // Eve: handed on, and Hiring's rules refuse her.
    const qe = await slack.ask({ user: 'U0EVE', text: `${M} Chief: add an offer for Eve [hand Hiring] [edit Hiring/offers/eve.md Offer for Eve] [answer Done.]` })
    ok(!!(await until(() => events(CH).find((e) => e.type === 'handed' && e.to?.id === HI && e.ts === qe.ts), 40000)), 'Chief, which only reads, hands Eve\'s request on to Hiring')
    ok(!!(await until(() => events(HI).find((e) => e.type === 'refused' && e.ts === qe.ts && e.why === 'not-allowed'), 15000)) && !fs.existsSync(H('offers', 'eve.md')), 'Hiring applies its own rules to Eve: refused, nothing changed')
    ok(events(HI).some((e) => e.type === 'received' && e.ts === qe.ts && e.handed?.by === CH && e.person?.id === 'U0EVE'), 'Hiring heard it as Eve\'s, handed on by Chief')
    // Dana: handed on, and her change waits for you.
    await slack.ask({ user: 'U0DANA', text: `${M} Chief: add an offer for Dana please [hand Hiring] [edit Hiring/offers/dana2.md Offer two] [answer Done.]` })
    const d = await waitingOf('add an offer for Dana please')
    ok(d?.bot?.id === HI && d.write.by?.id === 'U0DANA' && !fs.existsSync(H('offers', 'dana2.md')), 'Dana\'s, handed on: Hiring makes it in its copy, and it waits for you', d && { bot: d.bot, by: d.write.by })
    await kit.api(`/bots/questions/${d.id}`, { send: false })
    // You: made.
    await slack.ask({ user: OWNER.id, text: `${M} Chief: add an offer for the team [hand Hiring] [edit Hiring/offers/team.md Team offer] [answer Done.]` })
    ok(!!(await until(() => read(H('offers', 'team.md')) === 'Team offer\n', 40000)), 'yours, handed on: made without asking you')
    const chiefRun = startsOf('add an offer for the team').find((s) => /reply with HAND TO/.test(briefOf(s)))
    ok(!!chiefRun && chiefRun.args.join(' ').includes('--tools Read,Grep,Glob ') && !chiefRun.args.join(' ').includes('Edit(./**)'), 'Chief\'s own agent only reads', chiefRun?.args)
  })

  // ---------- In Bridge AI: Needs You, Access, Activity, on a computer and a phone ----------
  for (const [mode, theme, phone] of [['light', 'sky', false], ['dark', 'midnight', false], ['light', 'sky', true]]) {
    await part(`the app, ${mode}${phone ? ', on a phone' : ''}`, async () => {
      const words = `add an offer for Pat ${mode}${phone ? ' phone' : ''}`
      await slack.ask({ user: 'U0DANA', text: `${M} Hiring: ${words} [edit Hiring/offers/pat-${mode}${phone ? '-phone' : ''}.md Offer for Pat] [answer Done.]` })
      const w = await waitingOf(words)
      const { ctx, p, errors } = await page(b, kit.url, { mode, theme, phone })
      await p.evaluate((id) => { localStorage.setItem('cc-bot', id); localStorage.setItem('cc-bot-tab', 'setup') }, HI)
      await p.locator('.needs-chip').click({ timeout: 15000 })
      const item = p.locator('.ny-item.t-slack', { hasText: words }).first()
      await item.waitFor({ timeout: 15000 })
      const said = await item.innerText()
      ok(/A change to approve/.test(said) && /Offer for Pat/.test(said) && /Approve and Send/.test(said) && /Deny/.test(said), 'Needs You: the change, its diff, Approve and Send, Deny', said.slice(0, 500))
      if (phone) { const faults = await phoneFaults(p, '.ny-item.t-slack'); ok(!Object.keys(faults).length, 'on a phone: nothing too small to tap, off the screen or cut short', faults) }
      await shot(p, `${tag}bots-write-needs-you-${mode}${phone ? '-phone' : ''}`)
      await item.getByRole('button', { name: 'Approve and Send' }).click()
      ok(!!(await until(() => read(H('offers', `pat-${mode}${phone ? '-phone' : ''}.md`)) === 'Offer for Pat\n', 15000)), `approved in Needs You${phone ? ' on a phone' : ''}: made`)
      void w
      await p.keyboard.press('Escape')
      await openSettings(p)
      const sec = p.locator('[data-setting="slack-changes"]').first()
      await sec.waitFor({ timeout: 15000 })
      await sec.scrollIntoViewIfNeeded()
      const changes = await sec.innerText()
      ok(/Edits Files in Its Folders/.test(changes) && /Changes Files In/.test(changes) && /~\/Hiring/.test(changes) && /May Change Files Without Asking Me/.test(changes) && /Sam/.test(changes) && /Always Waits for You/.test(changes), 'Settings › Bots › Changes: its folders, who may change files without asking you, and what always waits', changes.slice(0, 600))
      const line = await p.locator('[data-setting="bots-access-line"]').first().innerText().catch(() => '')
      ok(/changes files in ~\/Hiring for you and 1 named; asks you first for anyone else/i.test(line), 'its Access line says it in plain words', line)
      if (phone) { const faults = await phoneFaults(p, '[data-setting="slack-changes"]'); ok(!Object.keys(faults).length, 'Changes on a phone: nothing too small to tap, off the screen or cut short', faults) }
      await shot(p, `${tag}bots-write-settings-${mode}${phone ? '-phone' : ''}`)
      ok(errors.length === 0, 'no page errors', errors)
      await ctx.close()
    })
  }
  await part('activity', async () => {
    const r = await kit.api(`/bots/${HI}/writes`)
    ok(r.writes.some((w) => w.state === 'applied' && w.by?.id === 'U0DANA' && w.applied?.by === 'Tester') && r.writes.some((w) => w.state === 'undone') && r.writes.some((w) => w.state === 'denied') && r.writes.some((w) => w.state === 'refused'), 'Activity has each change: who asked, who approved it, made, undone, denied, refused', r.writes.map((w) => w.state))
    ok((await kit.api(`/bots/${HI}/activity`)).integrity?.ok, 'and its record holds')
  })
  void sleep
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  await b.close()
  kit.stop()
  slack.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
