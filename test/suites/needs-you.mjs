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
// wider than the phone; and a phone notification's link opens it at its agent.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, browser, page, shot, noServiceWorker, OUT, TEST } from '../lib/harness.mjs'

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
  const t0 = Date.parse('2026-10-31T10:00:00Z')
  const when = (m) => new Date(t0 + m * 60000).toISOString()
  const mix = [{ ...review, since: when(9) }, { ...failed, since: when(1) }, { ...pick, since: when(5) }, { ...perm, since: when(8) }, { ...plan, since: when(2) }]
  ok(ny.order(mix).map((i) => i.type).join() === 'permission,permission,question,failed,review' && ny.order(mix)[0] === mix[4], 'most urgent first: permissions (the longest waiting first), questions, failed runs, finished work', ny.order(mix).map((i) => `${i.type} ${i.since}`))
  ok(ny.order(mix, 'newest').map((i) => i.since).join() === [9, 8, 5, 2, 1].map(when).join(), 'or the newest first', ny.order(mix, 'newest').map((i) => i.since))
  const old = ny.fromAgents([{ paneId: 'a', status: 'blocked', title: 'Docs', kind: 'claude' }, { paneId: 'b', status: 'working', title: 'API' }, { paneId: 'c', status: 'done', title: 'Site' }])
  ok(old.length === 2 && old[0].type === 'question' && !old[0].answers && old[1].type === 'review', 'a device on an older Bridge AI: who waits on you and what finished, with nothing to answer from here', old)
  // A needs-you notification: it opens the inbox at its agent, and says what else waits.
  ok(new URL(notify.linkTo('w1:p3'), 'http://x').searchParams.get('inbox') === '1' && new URL(notify.linkTo('w1:p3'), 'http://x').searchParams.get('agent') === 'w1:p3', "a needs-you notification's link opens the inbox at its agent (and the agent, in an app too old for the inbox)", notify.linkTo('w1:p3'))
  const fleet = [agent({ paneId: 'x1' }), agent({ paneId: 'x2' }), agent({ paneId: 'x3', status: 'working' }), agent({ paneId: 'x4' })]
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
const itemFor = (k, pane, pred = () => true) => until(async () => (await k.api('/needs-you')).items.find((i) => i.paneId === pane && pred(i)), 30000, 400)

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
  const migrate = there?.items.find((i) => i.paneId === two.paneId)
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
  ok(!!(await until(async () => /3\s*need you/.test(await chip.innerText().catch(() => '')), 20000)), "the top bar's chip counts what waits on both devices", await chip.innerText().catch(() => ''))
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
  await card.locator('.q-opt', { hasText: "don't ask again" }).click()
  ok(!!(await until(() => answers(c).some((x) => x.command === 'npm run publish' && x.key === '2'), 15000)), 'and picking one answers it there', answers(c))
  await s.p.keyboard.press('Escape')
  ok(!!(await until(async () => !(await panel.count()), 5000)), 'Esc closes it')
  ok(s.errors.length === 0, 'no page errors on the desktop', s.errors)
  await s.ctx.close()

  // Yes to all: two waiting, one on each device.
  const six = await launch(c, 'api-server', 'ask npm run seed', 'Seed')
  ok(!!(await until(async () => {
    const r = (await a.api('/needs-you?live=1')).items.filter((i) => i.type === 'permission' && i.qid && i.online)
    return r.length === 2 && r.some((i) => i.paneId === six.paneId) && r.some((i) => i.paneId === five.paneId)
  }, 40000, 500)), 'two asking for permission: one on each device')
  const d = await page(b, a.url, { mode: 'dark', theme: 'midnight' })
  await d.p.locator('.top-right .needs-chip').click({ timeout: 20000 })
  const dp = d.p.locator('.ny-panel')
  const batch = dp.locator('.ny-batch')
  await batch.waitFor({ timeout: 10000 })
  await batch.locator('button', { hasText: 'Yes to all' }).click()
  ok(/Answer Yes to these 2\?/.test(await batch.innerText()), 'Yes to all asks once more, saying how many', await batch.innerText())
  await shot(d.p, `${tag}needs-you-batch-dark`)
  await batch.locator('button.primary', { hasText: 'Yes to all' }).click()
  ok(!!(await until(() => answers(a).some((x) => x.command === 'git push' && x.key === '1') && answers(c).some((x) => x.command === 'npm run seed' && x.key === '1'), 20000)), 'and answers each on its own device', { studio: answers(a), desk: answers(c) })
  await d.ctx.close()

  // ---------- a phone ----------
  const seven = await launch(c, 'web', 'ask npm run lint', 'Lint')
  const lint = await until(async () => (await a.api('/needs-you')).items.find((i) => i.paneId === seven.paneId && i.qid), 40000, 500)
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
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  fs.rmSync(scratch, { recursive: true, force: true })
}
process.exit(done().fail ? 1 : 0)
