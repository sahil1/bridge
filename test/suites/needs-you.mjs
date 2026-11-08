// The needs-you inbox, in the browser named by BRIDGE_TEST_BROWSER. First what goes in it, from
// made-up agents (no server): a permission prompt with Yes and No, a question, the Chief of Staff's,
// a cloud agent's plan to approve, a failed cloud run, one stopped at its usage limit, finished work,
// and a device on an older Bridge AI; the most urgent first, or the newest. Then two Bridge AIs
// ("Studio" and "Desk", each on a relay of its own, linked) with a stand-in Claude Code that asks
// for permission: Studio's inbox lists what waits on both, with the device and the project, and
// answers each on its own device; an answer for a question that has moved on is refused and nothing
// is typed; Yes goes in once; finished work follows, and Clear takes it off until it has something
// new. In the app: the top bar's chip counts both devices and opens the inbox; Yes, More answers…
// and Yes to all answer agents on the other device; at phone width it's the whole screen, nothing
// wider than the phone; and a phone notification's link opens it at its agent. Last, when you were
// last on an agent (its chat opened, not a reconnect; a message typed to another in its project), and
// without Home a wait quiet for days left out of the chip, the devices menu and the title, folded in
// the inbox.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, browser, page, shot, noServiceWorker, changeAnswer, OUT, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('needs-you')

// ---------- what goes in it (no server) ----------
// Its own data folder and home, so nothing here reads or writes yours.
const scratch = path.join(OUT, 'kits', `needs-you-unit-${process.pid}`)
fs.mkdirSync(path.join(scratch, 'home'), { recursive: true })
const was = { BRIDGE_HOME: process.env.BRIDGE_HOME, HOME: process.env.HOME }
process.env.BRIDGE_HOME = path.join(scratch, 'data')
process.env.HOME = path.join(scratch, 'home')
const ny = await import('../../server/needsyou.js')
const notify = await import('../../server/notify.js')
for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
{
  const agent = (o) => ({ paneId: `p${Math.random().toString(36).slice(2, 7)}`, seq: 3, kind: 'claude', kindLabel: 'Claude Code', title: 'Fix rounding', cwd: '/home/me/code/billing-api', workspace: 'Billing', status: 'blocked', ...o })
  const yesNo = { text: 'Do you want to proceed?\nnpm run deploy', id: 'q1', simple: [{ n: '1', title: 'Yes' }, { n: '3', title: 'No' }] }
  const perm = ny.itemOf(agent({}), { q: yesNo })
  ok(perm?.type === 'permission' && perm.text === 'Do you want to proceed?' && perm.about === 'npm run deploy' && perm.answers.map((a) => a.title).join() === 'Yes,No' && perm.qid === 'q1', 'a permission prompt: what it asks, what it would run, and Yes and No', perm)
  ok(perm.agent.project === 'billing-api' && perm.agent.title === 'Fix rounding' && perm.id === `${perm.paneId}@3`, 'with its agent and project, as one wait of that agent', perm.agent)
  const win = ny.itemOf(agent({ title: 'Administrator: C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', tab: 'Fix rounding' }), { q: yesNo })
  ok(win.agent.title === 'Fix rounding' && ny.itemOf(agent({ tab: '2' }), { q: yesNo }).agent.title === 'Fix rounding', "called by its tab's name, as the sidebar does (on Windows the terminal's title is the shell's), else its title", win.agent.title)
  const tree = ny.itemOf(agent({ cwd: '/data/worktrees/x1', worktree: { repo: '/home/me/code/shop', branch: 'fix/cart' } }), { q: yesNo })
  ok(tree.agent.project === 'shop' && tree.agent.branch === 'fix/cart', 'an agent on its own branch: the repo it belongs to, and its branch', tree.agent)
  const pick = ny.itemOf(agent({}), { q: { text: 'Which database should I use?', id: 'q2', simple: null } })
  ok(pick.type === 'question' && pick.text === 'Which database should I use?' && !pick.answers && pick.qid === 'q2', 'a question with choices of its own: a question, answered from its card', pick)
  const chief = ny.itemOf(agent({ chief: true, thread: { id: 't2', name: 'Launch', main: false }, cwd: '/data/chief' }), { q: pick && { text: 'Shall I start the release?', id: 'q3', simple: [{ n: '1', title: 'Yes' }, { n: '2', title: 'No' }] } })
  ok(chief.agent.title === 'Chief of Staff · Launch' && chief.agent.chief && !chief.agent.project, "the Chief of Staff's question, by its thread", chief.agent)
  const codex = ny.itemOf(agent({ kind: 'codex', asking: { count: 2, title: 'Keep the old API?' } }))
  ok(codex.type === 'question' && codex.text === 'Keep the old API?' && codex.count === 2 && !codex.qid, "Codex's questions while it works: answered with a reply", codex)
  const cloud = { provider: 'cursor', label: 'Cursor', repo: 'acme/shop', branch: 'cursor/fix', prUrl: null, failed: false }
  const plan = ny.itemOf(agent({ kind: 'cloud', cloud: { ...cloud, ask: 'Approve the plan?', canApprove: true, approveLabel: 'Approve plan' } }))
  ok(plan.type === 'permission' && plan.answers[0].n === 'approve' && plan.answers[0].title === 'Approve plan' && plan.agent.cloud === 'Cursor' && plan.agent.project === 'shop', "a cloud agent's plan to approve", plan)
  const failed = ny.itemOf(agent({ kind: 'cloud', status: 'done', cloud: { ...cloud, failed: true, error: 'The provider stopped it' } }))
  ok(failed.type === 'failed' && failed.text === 'The provider stopped it', 'a failed cloud run', failed)
  const limit = ny.itemOf(agent({ status: 'done' }), { p: { text: "You've hit your session limit · resets 3:10am" } })
  ok(limit.type === 'failed' && limit.limit, 'one stopped at its usage limit counts as failed', limit)
  const fin = ny.itemOf(agent({ status: 'done', cloud: { ...cloud, prUrl: 'https://github.com/acme/shop/pull/7' }, kind: 'cloud' }))
  const review = ny.itemOf(agent({ status: 'done' }), { p: { text: 'Fixed the rounding; all 40 tests pass.' } })
  ok(review.type === 'review' && review.text === 'Fixed the rounding; all 40 tests pass.' && fin.type === 'review' && fin.pr === 'https://github.com/acme/shop/pull/7', 'finished work, with what it said last, and a cloud agent\'s pull request', [review, fin])
  ok(ny.itemOf(agent({ status: 'working' })) === null && ny.itemOf(agent({ status: 'idle' })) === null && ny.itemOf({ ...agent({}), shellTab: true }) === null, 'nothing for an agent at work, one idle, or a terminal')
  // Times by the minute, counted back from now (minutes ago).
  const t0 = Date.now() - 10 * 60000
  const when = (m) => new Date(t0 + m * 60000).toISOString()
  const mix = [{ ...review, since: when(9) }, { ...failed, since: when(1) }, { ...pick, since: when(5) }, { ...perm, since: when(8) }, { ...plan, since: when(2) }]
  ok(ny.order(mix).map((i) => i.type).join() === 'permission,question,permission,failed,review' && ny.order(mix)[0] === mix[3], 'most urgent first (shared/focus.js): what stops an agent (a permission or a question, the most recently active first), then a failed run, then finished work', ny.order(mix).map((i) => `${i.type} ${i.since}`))
  ok(ny.order(mix, 'newest').map((i) => i.since).join() === [9, 8, 5, 2, 1].map(when).join(), 'or the newest first', ny.order(mix, 'newest').map((i) => i.since))
  const days = (d) => new Date(Date.now() - d * 864e5).toISOString()
  const stale = [{ ...perm, id: 'old@1', since: days(4), active: days(4) }, { ...review, since: when(9) }, { ...pick, since: days(1), active: when(5) }]
  ok(ny.order(stale).map((i) => i.id).join() === [pick.id, review.id, 'old@1'].join(), 'a permission nobody has been near for four days goes after finished work from minutes ago; a question waiting a day that you were on 5 min ago leads', ny.order(stale).map((i) => [i.type, i.since, i.active]))
  const old = ny.fromAgents([{ paneId: 'a', status: 'blocked', title: 'Docs', kind: 'claude' }, { paneId: 'b', status: 'working', title: 'API' }, { paneId: 'c', status: 'done', title: 'Site' }])
  ok(old.length === 2 && old[0].type === 'question' && !old[0].answers && old[1].type === 'review', 'a device on an older Bridge AI: who waits on you and what finished, with nothing to answer from here', old)
  // A needs-you notification: it opens the inbox at its agent, and says what else waits.
  ok(new URL(notify.linkTo('w1:p3'), 'http://x').searchParams.get('inbox') === '1' && new URL(notify.linkTo('w1:p3'), 'http://x').searchParams.get('agent') === 'w1:p3', "a needs-you notification's link opens the inbox at its agent (and the agent, in an app too old for the inbox)", notify.linkTo('w1:p3'))
  const fleet = [agent({ paneId: 'x1' }), agent({ paneId: 'x2' }), agent({ paneId: 'x3', status: 'working' }), agent({ paneId: 'x4' })]
  // Bridge AI's sounds off (the speaker in the top bar): its notifications say so, and each device
  // shows them without a sound; on again, they have one.
  const heard = []
  notify.use({ name: 'test', ready: () => true, send: (n) => { heard.push(n); return {} } })
  notify.onFleet({ agents: [agent({ paneId: 's1', status: 'working' }), agent({ paneId: 's2', status: 'working' })] }, {})
  notify.onFleet({ agents: [agent({ paneId: 's1', status: 'done' }), agent({ paneId: 's2', status: 'working' })] }, { alertSounds: false })
  notify.onFleet({ agents: [agent({ paneId: 's1', status: 'done' }), agent({ paneId: 's2', status: 'done' })] }, {})
  await new Promise((r) => setTimeout(r, 50))
  const quiet = heard.find((n) => n.paneId === 's1'), loud = heard.find((n) => n.paneId === 's2')
  ok(quiet?.silent === true && loud && !loud.silent, 'with sounds off, a notification goes out marked silent; with them on, it isn\'t', heard.map((n) => [n.paneId, n.silent]))
  ok(notify.alsoWaiting(fleet, fleet[0]) === '\n2 more wait on you' && notify.alsoWaiting(fleet.slice(0, 2), fleet[0]) === '\n1 more waits on you' && notify.alsoWaiting(fleet.slice(0, 1), fleet[0]) === '', 'and it says how many more wait on you', [notify.alsoWaiting(fleet, fleet[0])])
}

// ---------- two Bridge AIs, linked ----------
const relays = []
const kits = []
const kitWith = async (name, rel) => {
  const k = await startKit(`needs-you-${name.toLowerCase()}`, {
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_LINK_PING_MS: '1500' } },
  })
  kits.push(k)
  k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await k.api('/setup', { name: 'Tester' })
  await k.api('/agents/catalog')
  return k
}
const answers = (k) => { try { return fs.readFileSync(path.join(k.home, 'claude-answers.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const launch = async (k, project, prompt, label) => {
  const dir = path.join(k.home, 'code', project)
  fs.mkdirSync(dir, { recursive: true })
  return k.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: project, prompt })
}
const itemFor = (k, pane, pred = () => true) => until(async () => (await k.api('/needs-you')).items.find((i) => i.paneId === pane && !i.machine && pred(i)), 30000, 400)

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  const ra = await startRelay('needs-you-studio')
  const rc = await startRelay('needs-you-desk')
  relays.push(ra, rc)
  const a = await kitWith('Studio', ra)
  const c = await kitWith('Desk', rc)
  await until(async () => (await a.api('/relay')).online && (await c.api('/relay')).online, 20000)
  const p = (await a.api('/relay/pair', {})).pairing
  await c.api('/machines', { link: `${ra.url} ${p.code}` })
  const desk = await until(async () => (await a.api('/machines')).machines.find((m) => m.name === 'Desk' && m.online), 30000)
  ok(!!desk, 'Studio and Desk are linked')

  // ---------- on Studio itself ----------
  const one = await launch(a, 'shop', 'ask npm run deploy', 'Deploy')
  const it = await itemFor(a, one.paneId, (i) => i.qid)
  ok(it?.type === 'permission' && it.text === 'Do you want to proceed?' && it.about === 'npm run deploy', "Studio's inbox: the agent asking to run npm run deploy, as a permission", it)
  ok(it?.answers?.map((x) => x.title).join() === 'Yes,No' && it.machine === null && it.device === 'Studio' && it.online && it.agent.project === 'shop', 'with Yes and No, on Studio, in the shop project', it)
  const wrong = await a.api('/needs-you/answer', { paneId: one.paneId, seq: it.seq, qid: 'not-this-one', n: '1' })
  ok(wrong.ok === false && wrong.why === 'changed', 'an answer for another question is refused', wrong)
  const stale = await a.api('/needs-you/answer', { paneId: one.paneId, seq: it.seq + 7, qid: it.qid, n: '1' })
  ok(stale.ok === false && stale.why === 'changed', 'and one for an earlier wait of the same agent', stale)
  ok(answers(a).length === 0, 'and nothing was typed into it')
  const yes = await a.api('/needs-you/answer', { paneId: one.paneId, seq: it.seq, qid: it.qid, n: '1' })
  ok(yes.ok === true && yes.answered === 'Yes', 'Yes answers it', yes)
  ok(answers(a).map((x) => x.key).join() === '1', 'once: the agent got 1, for Yes', answers(a))
  const fin = await itemFor(a, one.paneId, (i) => i.type === 'review')
  ok(fin?.type === 'review' && fin.agent.project === 'shop' && !(await a.api('/needs-you')).items.some((i) => i.paneId === one.paneId && i.type === 'permission'), 'then it works, finishes, and is there as finished work to review', fin)
  if (fin) {
    await a.api('/needs-you/clear', { id: fin.id })
    await new Promise((r) => setTimeout(r, 1500))
    ok(!(await a.api('/needs-you')).items.some((i) => i.id === fin.id), 'Clear takes it off the list, and it stays off')
    ok(JSON.parse(fs.readFileSync(path.join(a.data, 'cache', 'needs-you.json'), 'utf8')).cleared.includes(fin.id), 'kept, so it stays off after a restart')
  }

  // ---------- on Desk, from Studio ----------
  const two = await launch(c, 'api-server', 'ask npm run migrate', 'Migrate')
  const three = await launch(c, 'docs', 'ask npm run publish', 'Publish docs')
  const there = await until(async () => {
    const r = await a.api('/needs-you')
    const mine = r.items.filter((i) => i.machine === desk.id && i.qid)
    return mine.length >= 2 ? r : null
  }, 40000, 500)
  const migrate = there?.items.find((i) => i.paneId === two.paneId && i.machine === desk.id)
  ok(migrate?.device === 'Desk' && migrate.online && migrate.about === 'npm run migrate' && migrate.agent.project === 'api-server', "Studio's inbox lists what waits on Desk, with the device and the project", migrate)
  ok(there?.devices.map((d) => d.name).join() === 'Studio,Desk', 'and says which devices it heard from', there?.devices)
  // Answered on Desk, through Studio (the inbox's way: /m/<id>/ reaches that device).
  const through = await fetch(`${a.url}/m/${desk.id}/api/needs-you/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paneId: migrate.paneId, seq: migrate.seq, qid: migrate.qid, n: '1' }) }).then((r) => r.json())
  ok(through.ok === true && answers(c).some((x) => x.command === 'npm run migrate' && x.key === '1'), "answered from Studio, it's typed on Desk", { through, typed: answers(c) })
  const fresh = await a.api(`/needs-you?fresh=${desk.id}`)
  ok(!fresh.items.some((i) => i.paneId === migrate.paneId && i.type === 'permission'), 'and asking Studio for Desk\'s news again shows it answered at once', fresh.items.map((i) => `${i.device} ${i.type} ${i.paneId}`))

  // ---------- in the app ----------
  const four = await launch(c, 'web', 'ask npm run build', 'Build site')
  const five = await launch(a, 'shop', 'ask git push', 'Push')
  await until(async () => (await a.api('/needs-you')).items.filter((i) => i.qid && i.online).length >= 3, 40000, 500)
  const s = await page(b, a.url, { mode: 'light', theme: 'sky' })
  const chip = s.p.locator('.top-right .needs-chip')
  // The chip counts what waits on the computer this window shows (Studio); the devices menu's chip
  // what waits on the other (Desk): the two add up, and the chip says there's more elsewhere.
  const num = (x) => Number((/\d+/.exec(x || '') || [0])[0])
  const split = async () => ({ here: num(await chip.innerText().catch(() => '')), there: num(await s.p.locator('.mc-chip .mc-needs').innerText().catch(() => '')), title: await chip.getAttribute('title').catch(() => '') })
  ok(!!(await until(async () => { const x = await split(); return x.here >= 1 && x.here + x.there === 3 && /more on (another computer|your other computers)/.test(x.title) }, 20000)), "the top bar's chip counts what waits on this computer, the devices menu's chip the other's, and the chip says there's more there", await split())
  await chip.click()
  const panel = s.p.locator('.ny-panel')
  await panel.waitFor({ timeout: 10000 })
  const rows = panel.locator('.ny-item')
  ok(await rows.count() >= 3 && (await panel.locator('.ny-item .ny-device', { hasText: 'Desk' }).count()) >= 2 && (await panel.locator('.ny-item .ny-device', { hasText: 'Studio' }).count()) >= 1, 'it opens the inbox, with the device each one is on', await panel.innerText())
  ok(/Waiting on you/i.test(await panel.innerText()) && (await panel.locator('.ny-item.t-permission .ny-about', { hasText: 'npm run build' }).count()) === 1, 'waiting on you first, each saying what it would run', await panel.innerText())
  await shot(s.p, `${tag}needs-you-desktop`)
  // Yes, on Desk's agent.
  const build = panel.locator('.ny-item', { hasText: 'npm run build' })
  await build.locator('.ny-acts button', { hasText: /^Yes$/ }).click()
  ok(!!(await until(() => answers(c).some((x) => x.command === 'npm run build' && x.key === '1'), 15000)), "Yes in Studio's window answers Desk's agent", answers(c))
  ok(!!(await until(async () => !(await panel.locator('.ny-item', { hasText: 'npm run build' }).count()), 10000)), 'and it leaves the list')
  // More answers…: the question's own card, from Desk's screen.
  const docs = panel.locator('.ny-item', { hasText: 'npm run publish' })
  await docs.locator('button', { hasText: 'More answers…' }).click()
  const card = docs.locator('.qcard')
  await card.waitFor({ timeout: 15000 })
  ok(/Yes, and don't ask again/.test(await card.innerText()), 'More answers… shows every choice it has, read from its screen on Desk', await card.innerText())
  ok(/Bash command/.test(await card.locator('.q-context').innerText().catch(() => '')) && /npm run publish/.test(await card.locator('.q-context').innerText().catch(() => '')), 'and what it is about, above the question: the command it would run', await card.innerText())
  await card.locator('.q-opt', { hasText: "don't ask again" }).click()
  ok(!!(await until(() => answers(c).some((x) => x.command === 'npm run publish' && x.key === '2'), 15000)), 'and picking one answers it there', answers(c))
  await s.p.keyboard.press('Escape')
  ok(!!(await until(async () => !(await panel.count()), 5000)), 'Esc closes it')
  ok(s.errors.length === 0, 'no page errors on the desktop', s.errors)
  await s.ctx.close()

  // Two devices number their panes alike: the same pane and wait on each is two items, each shown
  // once, and answering one leaves the other (told apart by id alone, both went, or one showed twice).
  {
    const twin = (machine, device, about) => ({ id: 'w4:p6@2', paneId: 'w4:p6', seq: 2, type: 'permission', text: 'Do you want to proceed?', about, qid: 'q-twin', answers: [{ n: '1', title: 'Yes' }, { n: '3', title: 'No' }], machine, device, online: true, since: new Date().toISOString(), agent: { title: about, kind: 'claude', kindLabel: 'Claude Code', project: 'docs', chief: false } })
    const list = { items: [twin(null, 'Studio', 'git push --tags'), twin(desk.id, 'Desk', 'npm run release')], devices: [{ id: null, name: 'Studio', online: true }, { id: desk.id, name: 'Desk', online: true }] }
    const v = await page(b, a.url, { mode: 'light', theme: 'sky', before: async (cx) => {
      await noServiceWorker(cx)
      await cx.route(/\/api\/needs-you(\?|$)/, (r) => r.fulfill({ json: list }))
      await cx.route(/\/api\/needs-you\/answer$/, (r) => r.fulfill({ json: { ok: true, answered: 'Yes' } }))
    } })
    await v.p.locator('.top-right .needs-chip').click()
    const pn = v.p.locator('.ny-panel')
    await pn.waitFor({ timeout: 10000 })
    const count = async (about) => pn.locator('.ny-item', { hasText: about }).count()
    ok(!!(await until(async () => (await count('git push --tags')) === 1 && (await count('npm run release')) === 1, 8000, 200)), 'the same pane and wait on two devices: two items, each shown once', await pn.innerText().catch(() => ''))
    await pn.locator('.ny-item', { hasText: 'npm run release' }).locator('.ny-acts button', { hasText: /^Yes$/ }).click()
    ok(!!(await until(async () => (await count('npm run release')) === 0, 5000, 100)) && (await count('git push --tags')) === 1, "answering Desk's leaves Studio's, which has the same id", await pn.innerText().catch(() => ''))
    ok(v.errors.length === 0, 'no page errors with the same id on two devices', v.errors)
    await v.ctx.close()
  }

  // Yes to all: two waiting, one on each device.
  const six = await launch(c, 'api-server', 'ask npm run seed', 'Seed')
  ok(!!(await until(async () => {
    const r = (await a.api('/needs-you?live=1')).items.filter((i) => i.type === 'permission' && i.qid && i.online)
    return r.length === 2 && r.some((i) => i.paneId === six.paneId) && r.some((i) => i.paneId === five.paneId)
  }, 40000, 500)), 'two asking for permission: one on each device')
  const d = await page(b, a.url, { mode: 'dark', theme: 'midnight' })
  const bg = () => d.p.evaluate(() => getComputedStyle(document.querySelector('.top-right .needs-chip')).backgroundColor)
  await d.p.locator('.top-right .needs-chip:not(.quiet)').waitFor({ timeout: 20000 })
  const urgentBg = await bg()
  await d.p.locator('.top-right .needs-chip').click({ timeout: 20000 })
  const dp = d.p.locator('.ny-panel')
  const batch = dp.locator('.ny-batch')
  await batch.waitFor({ timeout: 10000 })
  await batch.locator('button', { hasText: 'Yes to all' }).click()
  ok(/Answer Yes to these 2\?/.test(await batch.innerText()), 'Yes to all asks once more, saying how many', await batch.innerText())
  await shot(d.p, `${tag}needs-you-batch-dark`)
  await batch.locator('button.primary', { hasText: 'Yes to all' }).click()
  ok(!!(await until(() => answers(a).some((x) => x.command === 'git push' && x.key === '1') && answers(c).some((x) => x.command === 'npm run seed' && x.key === '1'), 20000)), 'and answers each on its own device', { studio: answers(a), desk: answers(c) })
  // Nothing waits now, only finished work: the chip says so quietly, in a tinted theme too.
  await d.p.keyboard.press('Escape')
  ok(!!(await until(async () => /to review/.test(await d.p.locator('.top-right .needs-chip.quiet').innerText().catch(() => '')), 20000)), 'with nothing waiting, the chip says how much there is to review', await d.p.locator('.top-right').innerText().catch(() => ''))
  const quietBg = await bg()
  ok(quietBg !== urgentBg, 'quietly: not in the colour of something waiting on you', { urgentBg, quietBg })
  await d.ctx.close()

  // ---------- a phone ----------
  const seven = await launch(c, 'web', 'ask npm run lint', 'Lint')
  const lint = await until(async () => (await a.api('/needs-you')).items.find((i) => i.paneId === seven.paneId && i.machine === desk.id && i.qid), 40000, 500)
  const eight = await launch(a, 'shop', 'ask rm -rf dist', 'Clean')
  const mine = await itemFor(a, eight.paneId, (i) => i.qid)
  for (const w of [320, 390]) {
    const ph = await page(b, a.url, { phone: true, mode: 'light', theme: 'sky', before: noServiceWorker })
    await ph.p.setViewportSize({ width: w, height: 760 })
    await ph.p.locator('.top-right .needs-chip').click({ timeout: 20000 })
    const pp = ph.p.locator('.ny-panel.phone')
    await pp.waitFor({ timeout: 10000 })
    const box = await pp.boundingBox()
    const wide = await ph.p.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.ny-panel *')].map((e) => e.getBoundingClientRect().right)))
    ok(box && box.width <= w + 0.5 && box.height >= 700 && wide <= w + 1, `${w} px phone: the inbox is the whole screen, nothing wider than the phone`, { box, wide })
    ok((await pp.locator('.ny-item', { hasText: 'npm run lint' }).locator('.ny-device').innerText()).includes('Desk'), `${w} px: with the device`)
    await shot(ph.p, `${tag}needs-you-phone-${w}`)
    ok(ph.errors.length === 0, `${w} px: no page errors`, ph.errors)
    await ph.ctx.close()
  }
  // A notification's link (notify.js): the inbox, at that agent.
  ok(!!lint, "Desk's agent asking for npm run lint")
  const n = await page(b, `${a.url}/?agent=${encodeURIComponent(eight.paneId)}&ask=1&inbox=1`, { phone: true, mode: 'dark', theme: 'midnight', before: noServiceWorker })
  const focused = n.p.locator('.ny-panel .ny-item.focus')
  await focused.waitFor({ timeout: 20000 }).catch(() => {})
  ok(/rm -rf dist/.test(await focused.innerText().catch(() => '')), "a phone notification's link opens the inbox at its agent", await n.p.locator('.ny-panel').innerText().catch(() => ''))
  await shot(n.p, `${tag}needs-you-phone-notification`)
  await focused.locator('.ny-acts button', { hasText: /^No$/ }).click()
  ok(!!(await until(() => answers(a).some((x) => x.command === 'rm -rf dist' && x.key === '3'), 15000)), 'and No answers it from there', answers(a))
  await n.ctx.close()
  ok(mine?.machine === null, 'that agent is the sending computer\'s own')

  // ---------- when you were last on it (server/engaged.js) ----------
  // An agent asking that nobody has been near: active since it began waiting. Its chat opened: you
  // were on it then; the page reconnecting isn't you. A message you typed to another agent in the
  // same project: you were in its project, and that's when it was last active.
  const nine = await launch(a, 'ledger', 'ask npm run reconcile', 'Reconcile')
  const ledger = await itemFor(a, nine.paneId, (i) => i.qid)
  ok(!!ledger && !ledger.seen?.you && !ledger.seen?.project && ledger.active === ledger.since, 'an agent asking that nobody has been near: active since it began waiting', ledger)
  const openChat = async (headers = {}) => {
    const stop = new AbortController()
    const r = await fetch(`${a.url}/api/agents/${encodeURIComponent(nine.paneId)}/transcript/live`, { headers, signal: stop.signal })
    const { value } = await r.body.getReader().read()
    stop.abort()
    return new TextDecoder().decode(value || new Uint8Array())
  }
  const seenOf = async () => (await a.api('/needs-you')).items.find((i) => i.paneId === nine.paneId && !i.machine)
  const opened = await openChat()
  const onIt = await until(async () => (await seenOf())?.seen?.you, 8000, 300)
  ok(/^id: 1\n/.test(opened) && !!onIt && (await seenOf()).active === onIt, "its chat opened: you were on it, and it's active since (the stream's first message has an id, which a reconnect sends back)", opened.slice(0, 30))
  await new Promise((r) => setTimeout(r, 1200))
  await openChat({ 'Last-Event-ID': '1' })
  await new Promise((r) => setTimeout(r, 1500))
  ok((await seenOf())?.seen?.you === onIt, 'the page reconnecting (after Bridge AI restarted, say) is not you on it', (await seenOf())?.seen)
  const ten = await launch(a, 'ledger', 'idle', 'Ledger notes')
  await a.api(`/agents/${encodeURIComponent(ten.paneId)}/queue`, { text: 'Thanks, that is all for now.', typed: 'message' })
  const inLedger = await until(async () => { const x = await seenOf(); return x?.seen?.project && Date.parse(x.seen.project) > Date.parse(onIt) && x }, 8000, 300)
  ok(!!inLedger && inLedger.active === inLedger.seen.project && inLedger.seen.you === onIt, 'a message you typed to another agent in the same project: you were in its project, so it was active then', inLedger?.seen)

  // ---------- without Home: what has gone quiet isn't counted ----------
  // Another agent asks on Studio, its wait made four days old in the list (as one nobody has been
  // near since would be): the chip, the devices menu and the window's title leave it out, the inbox
  // folds it under Quiet for 3+ days, and Yes to all leaves it alone.
  const eleven = await launch(a, 'old-site', 'ask npm run purge', 'Purge')
  const purge = await itemFor(a, eleven.paneId, (i) => i.qid)
  const blockedHere = (await a.api('/fleet')).agents.filter((x) => x.status === 'blocked').length
  const fourDays = new Date(Date.now() - 4 * 864e5).toISOString()
  const asks = (i) => (i.type === 'permission' || i.type === 'question') && i.online
  const onDesk = (await a.api('/needs-you')).items.filter((i) => asks(i) && i.machine).length
  const s2 = await page(b, a.url, { mode: 'light', theme: 'sky', before: async (cx) => {
    await noServiceWorker(cx)
    await changeAnswer(cx, /\/api\/needs-you(\?|$)/, (real) => ({ ...real, items: real.items.map((i) => (i.paneId === eleven.paneId ? { ...i, since: fourDays, active: fourDays } : i)) }))
  } })
  const chip2 = s2.p.locator('.top-right .needs-chip')
  const counted = async () => ({ here: num(await chip2.innerText().catch(() => '')), there: num(await s2.p.locator('.mc-chip .mc-needs').innerText().catch(() => '')), title: await s2.p.title() })
  const shown = await until(async () => { const x = await counted(); return x.here === blockedHere - 1 && x.there === onDesk && x.title.startsWith(`(${blockedHere - 1 + onDesk}) `) && x }, 20000, 400)
  ok(!!purge && blockedHere >= 2 && !!shown, `the chip counts the ${blockedHere - 1} asking on Studio now, not the one quiet for days; the devices menu Desk's ${onDesk}; the window's title (and the Dock's badge) both`, await counted())
  await chip2.click()
  const quietPanel = s2.p.locator('.ny-panel')
  await quietPanel.waitFor({ timeout: 10000 })
  await until(async () => /Quiet for 3\+ days/.test(await quietPanel.innerText()), 10000)
  const waitingNow = await quietPanel.locator('.ny-group').first().innerText()
  ok(!/npm run purge/.test(waitingNow) && /npm run reconcile/.test(waitingNow) && (await quietPanel.locator('.ny-item.top').count()) >= 1, 'the inbox: the one asking now first, set apart with why; not the quiet one', waitingNow)
  ok(/Quiet for 3\+ days\s*1/.test(await quietPanel.locator('.ny-fold').innerText()) && /not counted/.test(await quietPanel.locator('.ny-qhint').innerText()) && !/npm run purge/.test(await quietPanel.locator('.ny-batch').innerText().catch(() => '')), 'the quiet one folded at the end, said to be not counted, and not among Yes to all', await quietPanel.locator('.ny-quiet').innerText())
  await quietPanel.locator('.ny-fold').click()
  await quietPanel.locator('.ny-qrow', { hasText: 'Purge' }).locator('.ny-qmain').click()
  const purgeCard = quietPanel.locator('.ny-qrow', { hasText: 'Purge' }).locator('.ny-item')
  ok(/npm run purge/.test(await purgeCard.innerText()) && await purgeCard.locator('button', { hasText: /^No$/ }).isVisible() && /old-site/.test(await quietPanel.locator('.ny-qgroup h4').first().innerText()), 'unfolded, under its project; opened, its card, to answer as ever', await quietPanel.locator('.ny-quiet').innerText())
  await quietPanel.locator('.ny-quiet').evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await shot(s2.p, `${tag}needs-you-quiet-desktop`)
  await purgeCard.locator('button', { hasText: /^No$/ }).click()
  ok(!!(await until(() => answers(a).some((x) => x.command === 'npm run purge' && x.key === '3'), 15000)), 'and No answers it on Studio', answers(a))
  ok(s2.errors.length === 0, 'quiet: no page errors', s2.errors)
  await s2.ctx.close()
  await a.api('/needs-you/answer', { paneId: nine.paneId, seq: ledger.seq, qid: ledger.qid, n: '3' })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  fs.rmSync(scratch, { recursive: true, force: true })
}
process.exit(done().fail ? 1 : 0)
