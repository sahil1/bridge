// The Chief of Staff handing work to helpers, in the browser named by BRIDGE_TEST_BROWSER, with a
// stand-in Claude Code running it and every helper (stand-ins/helper-claude.cjs).
//   `bridge delegate`: a task on its list with the helper's role and pane, the helper started in
//   the task's own folder (work/<task>/) with who it works for, where its work goes and the brief,
//   in the Helpers space and under the thread that asked; once it finishes, the task is done with
//   what it said and the file it made, and the Chief of Staff hears it once. Three at once at most:
//   a fourth waits as queued and starts by itself when one finishes, each end reported once.
//   Helpers may edit in their own work folder: off, no helper is told it may; on, one in its own
//   folder is (Claude Code's acceptEdits) and one in a folder of yours isn't. An agent that isn't
//   installed: the task waits on you saying why, said to whoever asked and not reported as well,
//   and Try again says it again. A helper asking permission: under Needs you on the board and in
//   Needs You, done once it's answered. One closed before it finished (its tab closed): the task
//   waits on you, and that's reported once; one whose CLI ended before doing anything: the same,
//   saying so. A quick one, over between two looks, still counts as finished. A follow-up the chief
//   sends one that reported is watched again, for one more report.
//   The board (the chief's Tasks view, from its row in the sidebar and from the Tasks tray): the four
//   columns with each card where it belongs (its role, what it's doing, for how long), a card that
//   opens its helper, a finished one with its file, the one that couldn't start saying why; on a
//   phone (390 px, dark), one column at a time from a segmented control, with nothing too small to
//   tap or off the screen. With nothing on it yet, it says so.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, checks, until, sleep, browser, page, shot, phoneFaults, TEST, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('chief-delegate')
const kit = await startKit('chief-delegate', { env: { BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const CHIEF = path.join(kit.data, 'chief')
const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }
// The chief's own command, as it runs it in its folder, in its Main thread.
const bridge = (...args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'chief', 'bin', 'bridge'), ...args], { encoding: 'utf8', cwd: CHIEF, env: { ...process.env, BRIDGE_URL: kit.url, BRIDGE_HOME: kit.data, BRIDGE_THREAD: 'main' } })
  return `${r.stdout || ''}${r.stderr || ''}`
}
const logOf = (f) => { try { return fs.readFileSync(path.join(kit.home, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const reports = () => logOf('chief-got.log').filter((x) => /^Report from your/.test(x.text))
const reportsOn = (id) => reports().filter((x) => x.text.includes(`on task ${id},`))
// How the helper whose brief says this was started, once it has (its launch can return first).
const startOf = (words) => until(() => logOf('helpers-started.log').find((x) => x.message.includes(words)), 10000)
const tasks = async () => (await kit.api('/chief/tasks')).items
const task = async (id) => (await tasks()).find((x) => x.id === String(id))
const idOf = (out) => /^Task (\d+)/m.exec(out)?.[1] || null
const release = (name) => fs.writeFileSync(path.join(kit.home, `release-${name}`), '')
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }

try {
  await kit.api('/setup', { name: 'Tester' })
  // Look for agents again: the server looked before the stand-in Claude Code was there.
  await kit.api('/agents/catalog')
  const chiefPane = (await kit.api('/chief/launch', {})).paneId
  ok(!!(await until(async () => (await kit.api('/fleet')).agents.find((a) => a.chief)?.status === 'idle', 20000)), 'the Chief of Staff is running, waiting for a message')

  // ---------- The board with nothing on it ----------
  await part('an empty board', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', store: { 'cc-agent-views': { [chiefPane]: 'tasks' } } })
    await p.locator('.rail-board').click({ timeout: 15000 })
    const empty = await until(async () => (await p.locator('.cb-empty-all').innerText().catch(() => '')) || null, 10000)
    ok(/Nothing on the board yet/.test(empty || '') && /hands each piece to a helper/.test(empty || ''), 'nothing on it yet: the board says so, and how it fills', empty)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })

  // ---------- One helper, start to finish ----------
  const out1 = bridge('delegate', '--role', 'marketing', '--title', 'Draft the launch deck', '[work 2] [file deck.md] Draft the launch deck for the spring release, ten slides.')
  const t1 = idOf(out1)
  ok(/A helper is on it in \S+, working in .*work[\\/]draft-the-launch-deck\. Bridge AI tells you here when it stops/.test(out1), 'bridge delegate: a helper is on it, in the task\'s own folder, and the chief hears back here', out1)
  const it1 = await task(t1)
  ok(it1?.role === 'marketing' && it1.status === 'doing' && !!it1.pane && it1.helper?.state === 'working', 'the task is on its list as doing, with the helper\'s role and pane', it1)
  const s1 = await startOf('Draft the launch deck for the spring release')
  const work1 = path.join(CHIEF, 'work', 'draft-the-launch-deck')
  ok(real(s1?.cwd || '') === real(work1), 'the helper started in the task\'s own folder, work/draft-the-launch-deck', s1?.cwd)
  // On Windows it's one line, its quotes curly (meetwork.js forCommandLine).
  ok(/^You're helping Tester's Chief of Staff in Bridge AI as its marketing helper, on task \d+: ["“]Draft the launch deck["”]/.test(s1?.message || '') && /put what you make there/.test(s1.message) && /end with a short summary of what you made or found and where it is/.test(s1.message) && s1.message.endsWith('Draft the launch deck for the spring release, ten slides.'),
    'with who it works for, where its work goes, to end with what it made and where, then the brief', s1?.message)
  ok(!s1?.args.includes('--permission-mode'), 'and, with helpers not allowed to edit, nothing that lets it edit without asking', s1?.args)
  const h1 = (await kit.api('/fleet')).agents.find((a) => a.paneId === it1.pane)
  ok(h1?.workspace === 'Helpers' && h1.tab === 'Marketing: Draft the launch deck' && h1.helper?.task === t1 && (h1.chiefThreads || []).includes('main'), 'in the Helpers space, named for its role and task, and under the thread that asked', h1 && { workspace: h1.workspace, tab: h1.tab, helper: h1.helper, threads: h1.chiefThreads })
  const fin1 = await until(async () => { const x = await task(t1); return x?.status === 'done' ? x : null }, 30000)
  ok(/the draft is in deck\.md/.test(fin1?.outcome || '') && fin1?.link === 'work/draft-the-launch-deck/deck.md' && fs.existsSync(path.join(work1, 'deck.md')), 'it finished: the task is done, with the end of what it said and the file it made', fin1)
  const rep1 = await until(() => reportsOn(t1)[0], 30000)
  ok(!!rep1 && /Report from your marketing helper \(\S+\) on task \d+, "Draft the launch deck": it finished/.test(rep1.text) && /the draft is in deck\.md/.test(rep1.text) && /Files it made: work\/draft-the-launch-deck\/deck\.md/.test(rep1.text) && /tell Tester what came of it/.test(rep1.text),
    'the Chief of Staff hears it: what it said, the file, and what to do next', rep1?.text)
  await sleep(5000)
  ok(reportsOn(t1).length === 1, 'once', reportsOn(t1).length)

  // ---------- An agent that isn't installed ----------
  const outE = bridge('delegate', '--role', 'research', '--agent', 'codex', '--title', 'Compare the CRM quotes', 'Compare the three CRM quotes in ~/quotes.')
  const tE = idOf(outE)
  ok(/The helper couldn't start: Codex isn't installed/.test(outE) && /The task waits on the user/.test(outE), 'a helper that can\'t start: whoever asked is told why at once', outE)
  const itE = await task(tE)
  ok(itE?.status === 'waiting' && /Its research helper couldn't start: Codex isn't installed/.test(itE.needs || '') && itE.helper?.end === 'failed', 'and its task waits on you, saying why', itE)

  // ---------- Three at once; a fourth waits its turn ----------
  const HOLD = [['a', 'research', 'Find three venues'], ['b', 'engineer', 'Check the signup form'], ['c', 'design', 'Sketch the invite'], ['d', 'finance', 'Price the catering']]
  const outs = HOLD.map(([n, role, title]) => bridge('delegate', '--role', role, '--title', title, `[hold ${n}] [file ${n}.md] ${title}.`))
  const ids = outs.map(idOf)
  ok(outs.slice(0, 3).every((o) => /A helper is on it/.test(o)) && /Queued, next in line: 3 helpers are working, the most at once\. It starts by itself when one finishes/.test(outs[3]), 'three start; the fourth is queued, and the chief is told it starts by itself', outs)
  const held = await Promise.all(ids.map(task))
  ok(held.slice(0, 3).every((x) => x?.helper?.state === 'working') && held[3]?.helper?.state === 'queued' && held[3].status === 'open' && !held[3].pane, 'on the list: three working, the fourth queued with no agent yet', held.map((x) => x && [x.status, x.helper?.state, x.pane]))
  ok(!!(await until(async () => (await kit.api('/fleet')).agents.filter((a) => a.helper && ids.includes(a.helper.task) && a.status === 'working').length === 3, 15000)), 'three helpers at work in the fleet')
  ok(!!(await until(async () => (await task(ids[0]))?.helper?.doing, 15000)), 'and what each is doing is known')

  // ---------- The board ----------
  await part('the board on a computer', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    const btn = p.locator('.rail-board')
    await btn.waitFor({ timeout: 15000 })
    ok(!!(await until(async () => (await p.locator('.rail-board-n').innerText().catch(() => '')) === '3', 10000)) && /3 helpers at work/.test(await btn.getAttribute('title') || ''), 'the Chief of Staff\'s row in the sidebar has its board, with how many helpers are at work', await btn.getAttribute('title'))
    await btn.click()
    await p.locator('.cb-cols').waitFor({ timeout: 10000 })
    ok(await p.locator('.pane-head .seg [role="tab"][aria-selected="true"]').innerText() === 'Tasks', 'it opens the Chief of Staff at its Tasks view', await p.locator('.pane-head .seg').innerText().catch(() => ''))
    const col = (id) => p.locator(`.cb-col.c-${id}`).innerText()
    const filled = await until(async () => /Price the catering/.test(await col('queued')) && /Find three venues/.test(await col('working')) && /Compare the CRM quotes/.test(await col('needs')) && /Draft the launch deck/.test(await col('done')), 10000)
    ok(!!filled && (await p.locator('.cb-col-head').allInnerTexts()).map((x) => x.replace(/\d+/g, '').trim()).join('|') === 'Queued|Working|Needs you|Done', 'four columns, each card in its own', await p.locator('.cb-cols').innerText().catch(() => ''))
    const working = await col('working')
    ok(['Find three venues', 'Check the signup form', 'Sketch the invite'].every((x) => working.includes(x)) && /Research/.test(working) && /Engineer/.test(working) && /Working for \d+ min/.test(working) && /notes\.md/.test(working), 'Working: each with its role, for how long, and what it\'s doing', working)
    ok(/Next to start/.test(await col('queued')) && /Finance/.test(await col('queued')), 'Queued: its role, and that it\'s next', await col('queued'))
    const needs = await col('needs')
    ok(/Couldn't start: Codex isn't installed/.test(needs) && await p.locator('.cb-col.c-needs .cb-retry').count() === 1, 'Needs you: the helper that couldn\'t start says why on its card, with Try again', needs)
    const doneCol = await col('done')
    ok(/Marketing/.test(doneCol) && /the draft is in deck\.md/.test(doneCol) && await p.locator('.cb-col.c-done .ct-open', { hasText: 'deck.md' }).count() === 1, 'Done: what it said, and its file', doneCol)
    await shot(p, `${tag}chief-board`)
    // A card opens its helper.
    await p.locator('.cb-col.c-working .cb-card', { hasText: 'Find three venues' }).locator('.cb-main').click()
    ok(!!(await until(async () => /Research: Find three venues/.test(await p.locator('.ws-tab.main').innerText().catch(() => '')), 8000)), 'a card opens its helper', await p.locator('.ws-tab.main').innerText().catch(() => ''))
    // The Tasks tray in the chat: the role on each, and the board from there too.
    await p.locator('.rail-nav-btn.rail-chief').click()
    await p.locator('.pane-head .seg [role="tab"]', { hasText: 'Chat' }).click()
    await p.locator('.ct-tray').waitFor({ timeout: 8000 })
    ok(await p.locator('.ct-tray .ct-role', { hasText: 'Research' }).count() >= 1 && /Queued/.test(await p.locator('.ct-tray').innerText()), 'the Tasks tray names each one\'s role, and the queued one says so', await p.locator('.ct-tray').innerText().catch(() => ''))
    await p.locator('.ct-tray .ct-board-btn').click()
    ok(!!(await until(() => p.locator('.cb-cols').isVisible(), 5000)), 'its Board opens the board')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  await part('the board on a phone', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', phone: true, store: { 'cc-agent-views': { [chiefPane]: 'tasks' } } })
    await p.locator('.cb-seg').waitFor({ timeout: 15000 })
    const shownCols = async () => p.locator('.cb-col').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getAttribute('aria-label')))
    ok((await shownCols()).join() === 'Needs you', 'one column at a time, what needs you first', await shownCols())
    await p.locator('.cb-seg [role="tab"]', { hasText: 'Working' }).click()
    ok((await shownCols()).join() === 'Working' && await p.locator('.cb-col.c-working .cb-card').count() === 3, 'the segmented control picks another', await shownCols())
    await sleep(400)
    await shot(p, `${tag}chief-board-phone`)
    const faults = await phoneFaults(p, '.cb')
    ok(!Object.keys(faults).length, 'nothing on it too small to tap, off the screen or cut short', faults)
    await p.locator('.cb-seg [role="tab"]', { hasText: 'Done' }).click()
    ok(!Object.keys(await phoneFaults(p, '.cb')).length, 'nor in Done, with its file', await phoneFaults(p, '.cb'))
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })

  // ---------- One finishes; the one waiting starts ----------
  release('a')
  ok(!!(await until(async () => (await task(ids[0]))?.status === 'done', 20000)), 'a helper finishes')
  const fourth = await until(async () => { const x = await task(ids[3]); return x?.helper?.state === 'working' && x.pane ? x : null }, 20000)
  ok(!!fourth && fourth.status === 'doing', 'and the queued one starts by itself', await task(ids[3]))
  for (const n of ['b', 'c', 'd']) release(n)
  ok(!!(await until(async () => (await Promise.all(ids.map(task))).every((x) => x?.status === 'done'), 30000)), 'all four finish')
  ok(!!(await until(() => ids.every((id) => reportsOn(id).length >= 1), 60000)), 'each one reported to the Chief of Staff', reports().map((x) => x.text.split('\n')[0]))
  await sleep(4000)
  ok(ids.every((id) => reportsOn(id).length === 1) && reportsOn(tE).length === 0, 'each once, and nothing about the one that couldn\'t start (whoever asked was told)', reports().map((x) => x.text.split('\n')[0]))

  // ---------- Try again, with room for it ----------
  await part('try again', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', store: { 'cc-agent-views': { [chiefPane]: 'tasks' } } })
    await p.locator('.rail-board').click({ timeout: 15000 })
    const retry = p.locator('.cb-col.c-needs .cb-card', { hasText: 'Compare the CRM quotes' }).locator('.cb-retry')
    await retry.click({ timeout: 10000 })
    ok(!!(await until(async () => /Couldn't start: Codex isn't installed/.test(await p.locator('.cb-note').innerText().catch(() => '')), 8000)), 'Try again, still not installed: it says why, at once', await p.locator('.cb-note').innerText().catch(() => ''))
    await shot(p, `${tag}chief-board-dark`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  await sleep(3000)
  ok(reportsOn(tE).length === 0, 'and, as whoever asked was told, nothing is reported to the Chief of Staff', reportsOn(tE).map((x) => x.text))

  // ---------- Helpers may edit in their own work folder ----------
  await kit.api('/settings', { chief: { helpers: { editOwnFolder: true } } }, 'PATCH')
  const outO = bridge('delegate', '--role', 'writer', '--title', 'Write the FAQ', '[work 1] [file faq.md] Write the FAQ.')
  const sO = await startOf('Write the FAQ.')
  ok(sO?.args.join(' ').includes('--permission-mode acceptEdits') && /it may edit files there without asking/.test(outO), 'on: a helper in its own work folder may edit there without asking', { args: sO?.args, out: outO })
  const site = path.join(kit.home, 'site')
  fs.mkdirSync(site, { recursive: true })
  const outN = bridge('delegate', '--role', 'engineer', '--cwd', site, '--title', 'Fix the footer', '[work 1] [file footer.md] Fix the footer.')
  const sN = await startOf('Fix the footer.')
  ok(real(sN?.cwd || '') === real(site) && !sN.args.includes('--permission-mode') && !/may edit/.test(outN), 'but one in a folder of yours still asks', { cwd: sN?.cwd, args: sN?.args, out: outN })
  await kit.api('/settings', { chief: { helpers: { editOwnFolder: false } } }, 'PATCH')
  await until(async () => (await task(idOf(outN)))?.status === 'done', 20000)

  // ---------- A helper asking permission ----------
  const tA = idOf(bridge('delegate', '--role', 'ops', '--title', 'Tidy the release notes', '[ask] [file notes.md] Tidy the release notes.'))
  const asking = await until(async () => { const x = await task(tA); return x?.helper?.status === 'blocked' ? x : null }, 20000)
  ok(!!asking && asking.status === 'doing', 'a helper asking permission waits on you, its task still doing', await task(tA))
  ok((await kit.api('/needs-you')).items.some((i) => i.paneId === asking?.pane), 'and it\'s in Needs You', (await kit.api('/needs-you')).items.map((i) => i.paneId))
  await part('a helper asking, on the board', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', store: { 'cc-agent-views': { [chiefPane]: 'tasks' } } })
    await p.locator('.rail-board').click({ timeout: 15000 })
    const needs = await until(async () => { const x = await p.locator('.cb-col.c-needs').innerText().catch(() => ''); return /Tidy the release notes/.test(x) ? x : null }, 10000)
    ok(/Waiting for your answer/.test(needs || ''), 'on the board, under Needs you: it waits for your answer', needs)
    await p.locator('.pane-head .seg [role="tab"]', { hasText: 'Chat' }).click()
    const row = p.locator('.ct-tray .ct-item', { hasText: 'Tidy the release notes' })
    ok(!!(await until(async () => /Needs you/.test(await row.innerText().catch(() => '')), 8000)), 'and in the Tasks tray its task says Needs you', await row.innerText().catch(() => ''))
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  await kit.api(`/agents/${encodeURIComponent(asking.pane)}/keys`, { keys: ['1'] })
  ok(!!(await until(async () => (await task(tA))?.status === 'done', 20000)), 'answered, it finishes')

  // ---------- Closed before it finished; ended before doing anything ----------
  const tX = idOf(bridge('delegate', '--role', 'research', '--title', 'Look up the venue', '[hold x] Look up the venue.'))
  const paneX = (await until(async () => { const x = await task(tX); return x?.helper?.worked ? x : null }, 20000))?.pane
  const tabX = (await kit.api('/fleet')).agents.find((a) => a.paneId === paneX)?.tabId
  await kit.api(`/tabs/${encodeURIComponent(tabX)}/close`, {})
  const closed = await until(async () => { const x = await task(tX); return x?.status === 'waiting' ? x : null }, 30000)
  ok(/Its research helper was closed before it finished/.test(closed?.needs || '') && closed.helper?.end === 'stopped', 'one closed before it finished: its task waits on you', closed)
  const repX = await until(() => reportsOn(tX)[0], 30000)
  ok(/its agent was closed before it finished/.test(repX?.text || ''), 'and that\'s reported', repX?.text)
  const tZ = idOf(bridge('delegate', '--role', 'research', '--title', 'Count the RSVPs', '[exit] Count the RSVPs.'))
  const stalled = await until(async () => { const x = await task(tZ); return x?.status === 'waiting' ? x : null }, 30000)
  ok(/Its research helper couldn't start: it stopped before doing anything; its terminal may say why/.test(stalled?.needs || '') && stalled.helper?.live, 'one whose CLI ended before doing anything: its task says so, and its terminal is still there to look at', stalled)
  ok(!!(await until(() => /it couldn't start\. It stopped before doing anything/.test(reportsOn(tZ)[0]?.text || ''), 30000)), 'and that\'s reported', reportsOn(tZ)[0]?.text)

  // ---------- A follow-up ----------
  const pane1 = (await task(t1)).pane
  bridge('send', pane1, 'Add a slide on pricing.')
  const second = await until(() => reportsOn(t1)[1], 30000)
  ok(/Followed up: Add a slide on pricing/.test(second?.text || ''), 'a follow-up the chief sends is watched again, and its end reported', second?.text)
  await sleep(4000)
  ok(reportsOn(t1).length === 2 && reportsOn(tX).length === 1 && reportsOn(tZ).length === 1 && reportsOn(tA).length === 1, 'one report for each end, no more', reports().map((x) => x.text.split('\n')[0]))
  ok((await task(t1))?.status === 'done', 'and the task is done again', await task(t1))
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
