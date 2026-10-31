// The agent map: what's running on which computer, in the browser named by BRIDGE_TEST_BROWSER.
// First what the map says about each agent, from made-up ones (no server): its name and project,
// the Chief of Staff thread that handed it work, its model, how long it has run and been in its
// state (kept across a restart, forgotten once it's gone), and the subagents its terminal shows.
// Then three Bridge AIs ("Studio", "Desk" and "Laptop"), each on a relay of its own and linked,
// with stand-in Claude Code agents working, asking, done and idle: Studio's map lists every
// computer's agents by project with their state, what they're doing, their model and subagents,
// and the Chief of Staff's hand-off; Laptop closed shows as offline with what it last said, also
// after Studio restarts; one click opens Desk's agent in a tab on Studio. Then 34 agents on four
// computers and the cloud (made up): side by side on a desktop, nothing spilling out of its lane,
// in a light and a dark theme, and one lane under another at phone width.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, browser, page, shot, noServiceWorker, OUT, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('agent-map')

// ---------- what the map says (no server) ----------
const scratch = path.join(OUT, 'kits', `agent-map-unit-${process.pid}`)
fs.mkdirSync(path.join(scratch, 'home'), { recursive: true })
const was = { BRIDGE_HOME: process.env.BRIDGE_HOME, HOME: process.env.HOME }
process.env.BRIDGE_HOME = path.join(scratch, 'data')
process.env.HOME = path.join(scratch, 'home')
const am = await import('../../server/agentmap.js')
for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
{
  // The stand-in Claude Code's footer while it works, with a subagent going.
  const footer = ['✻ Pondering… (12s · ↓ 2.1k tokens)', '─'.repeat(60), '❯ ', '─'.repeat(60), '  ⏵⏵ auto mode on · 2 shells, 1 monitor', '  ⏺ main', '  ◯ Explore  Look for rounding in billing                    11m 2s · ↓ 28.0k tokens', ''].join('\n')
  const rt = { read: async () => footer }
  const T0 = Date.now() - 10 * 60000 // ten minutes ago
  const fleet = (over = []) => ({
    agents: [
      { paneId: 'c1', kind: 'claude', kindLabel: 'Claude Code', status: 'idle', seq: 1, chief: true, title: 'Chief of Staff', thread: { id: 'main', name: 'Main', main: true }, cwd: '/data/chief', caps: { subagents: true } },
      { paneId: 'c2', kind: 'claude', kindLabel: 'Claude Code', status: 'blocked', seq: 4, chief: true, title: 'Launch', thread: { id: 't2', name: 'Launch', main: false }, cwd: '/data/chief', caps: { subagents: true } },
      { paneId: 'a1', kind: 'claude', kindLabel: 'Claude Code', status: 'working', seq: 2, title: 'Fix rounding', cwd: '/data/worktrees/w1', worktree: { repo: '/home/me/code/billing-api', branch: 'fix/rounding' }, account: 'Work', sessionId: 's1', caps: { subagents: true }, chiefThreads: ['main', 't2'], workspace: 'Billing' },
      { paneId: 'a2', kind: 'codex', kindLabel: 'Codex', status: 'blocked', seq: 7, title: 'Administrator: C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', tab: 'Docs', cwd: '/home/me/code/docs', asking: { count: 1, title: 'Keep the old API page?' } },
      { paneId: 'k1', kind: 'cloud', kindLabel: 'Cursor cloud agent', status: 'done', seq: 3, title: 'Cart totals', cwd: '', cloud: { label: 'Cursor', repo: 'acme/shop', branch: 'cursor/totals', prUrl: 'https://github.com/acme/shop/pull/9', state: 'FINISHED', failed: false, startedAt: '2026-10-31T08:00:00Z' } },
      ...over,
    ],
  })
  const map = am.make({ rt, cfg: { agents: { claude: { model: 'claude-opus-5-5' } } } })
  map.observe(fleet().agents, T0)
  const list = await map.agents(fleet(), { cloudSaid: { k1: { text: 'Opened a pull request with the fix' } } })
  const by = Object.fromEntries(list.map((a) => [a.paneId, a]))
  ok(by.a1?.name === 'Fix rounding' && by.a1.project === 'billing-api' && by.a1.branch === 'fix/rounding' && by.a1.account === 'Work' && by.a1.workspace === 'Billing', 'an agent on its own branch: its project, branch, account and space', by.a1)
  ok(by.a1.from.join() === 'Main,Launch', 'which Chief of Staff threads handed it work, by name', by.a1.from)
  ok(by.c2.name === 'Chief of Staff · Launch' && by.c2.thread?.name === 'Launch' && by.c1.thread?.main, 'the Chief of Staff, by thread', [by.c1.thread, by.c2.name])
  ok(by.a1.model === 'claude-opus-5-5' && by.k1.model === null, 'its model: the one it was started on, or your default for that kind (none for a cloud agent)', [by.a1.model, by.k1.model])
  ok(by.a1.subagents?.count === 1 && by.a1.subagents.items[0].title === 'Look for rounding in billing' && by.a1.subagents.items[0].type === 'Explore' && !by.a2.subagents, 'a working Claude Code agent\'s subagents, from its terminal', by.a1.subagents)
  ok(by.a2.name === 'Docs', "called by its tab's name, as the sidebar does (on Windows the terminal's title is the shell's)", by.a2.name)
  ok(by.a2.asking === 'Keep the old API page?' && by.k1.cloud?.prUrl && by.k1.doing?.text === 'Opened a pull request with the fix' && by.k1.since === '2026-10-31T08:00:00.000Z', 'what it asks; a cloud agent\'s pull request, last words and start', [by.a2.asking, by.k1])
  ok(by.a1.since === new Date(T0).toISOString() && by.a1.statusSince === by.a1.since, 'when it started, and since when it\'s been working', [by.a1.since, by.a1.statusSince])
  const later = fleet().agents.map((a) => (a.paneId === 'a1' ? { ...a, status: 'done', seq: 3 } : a))
  map.observe(later, T0 + 5 * 60000)
  const again = (await map.agents({ agents: later })).find((a) => a.paneId === 'a1')
  ok(again.since === new Date(T0).toISOString() && again.statusSince === new Date(T0 + 5 * 60000).toISOString(), 'done: the same start, and done since then', again)
  const kept = (await am.make({ rt, cfg: {} }).agents({ agents: later })).find((a) => a.paneId === 'a1')
  ok(kept.since === again.since && kept.statusSince === again.statusSince, 'after a restart it keeps when each agent started and since when it is done', kept)
  am.make({ rt, cfg: {} }).observe([], T0 + 60 * 60000) // nowhere to be seen for most of an hour
  const fresh = (await am.make({ rt, cfg: {} }).agents({ agents: later })).find((a) => a.paneId === 'a1')
  ok(Date.parse(fresh.since) >= T0 + 9 * 60000, 'an agent gone a while is forgotten: one in its place starts afresh', fresh.since)
}

// ---------- three Bridge AIs, linked ----------
const relays = []
const kits = []
const kitWith = async (name, rel, config = {}) => {
  const k = await startKit(`agent-map-${name.toLowerCase()}`, {
    config,
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_LINK_PING_MS: '1500' } },
  })
  kits.push(k)
  k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await k.api('/setup', { name: 'Tester' })
  await k.api('/agents/catalog')
  return k
}
const launch = async (k, project, prompt, label, more = {}) => {
  const dir = path.join(k.home, 'code', project)
  fs.mkdirSync(dir, { recursive: true })
  return k.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: project, ...(prompt ? { prompt } : {}), ...more })
}
const mapOf = async (k) => (await k.api('/agent-map?live=1')).devices
const laneOf = async (k, name) => (await mapOf(k)).find((d) => d.name === name)

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  const [ra, rc, rl] = await Promise.all([startRelay('agent-map-studio'), startRelay('agent-map-desk'), startRelay('agent-map-laptop')])
  relays.push(ra, rc, rl)
  const a = await kitWith('Studio', ra)
  // Desk starts Claude Code on a model of your choosing (Settings › General).
  const c = await kitWith('Desk', rc, { agents: { claude: { model: 'claude-opus-5-5' } } })
  const l = await kitWith('Laptop', rl)
  await until(async () => (await a.api('/relay')).online && (await c.api('/relay')).online && (await l.api('/relay')).online, 20000)
  for (const k of [c, l]) {
    const p = (await a.api('/relay/pair', {})).pairing
    await k.api('/machines', { link: `${ra.url} ${p.code}` })
  }
  const linked = await until(async () => { const ms = (await a.api('/machines')).machines; return ms.filter((m) => m.online).length === 2 && ms }, 40000)
  ok(!!linked, 'Studio, Desk and Laptop are linked')

  // Studio: the Chief of Staff, an agent it handed work to, one asking.
  await a.api('/chief/launch', {})
  const mine = await launch(a, 'shop', 'idle', 'Checkout copy')
  await until(async () => (await a.api('/fleet')).agents.some((x) => x.chief && x.thread?.main), 20000)
  const linkd = await a.api('/chief/threads/link', { thread: 'main', paneId: mine.paneId })
  ok(linkd?.thread === 'main', "the Chief of Staff's Main thread hands work to Checkout copy", linkd)
  await launch(a, 'shop', 'ask npm run deploy', 'Deploy')
  // Desk: one working (with a subagent), one on a model picked for it, one done.
  const work = await launch(c, 'billing-api', '', 'Fix rounding')
  await launch(c, 'billing-api', 'idle', 'Refunds')
  const fin = await launch(c, 'docs', 'ask npm run publish', 'Publish docs')
  // Laptop: one idle, then Laptop closes.
  await launch(l, 'notes', 'idle', 'Meeting notes')

  const deskLane = await until(async () => {
    const d = await laneOf(a, 'Desk')
    return d?.agents?.length >= 3 && d.agents.some((x) => x.paneId === work.paneId && x.status === 'working' && x.subagents) ? d : null
  }, 40000, 600)
  const fix = deskLane?.agents.find((x) => x.paneId === work.paneId)
  ok(fix?.project === 'billing-api' && fix.status === 'working' && !!fix.since && !!fix.statusSince, "Studio's map: Desk's agent working, in its project, with when it started", fix)
  ok(fix?.subagents?.items?.some((s) => /Look for rounding/.test(s.title)), 'with the subagent it has going', fix?.subagents)
  ok(deskLane?.agents.find((x) => x.name === 'Refunds')?.model === 'claude-opus-5-5', 'and the model it was started on', deskLane?.agents.map((x) => [x.name, x.model]))
  // Answered on Desk: done, and since when.
  const pub = await until(async () => (await c.api('/needs-you')).items.find((i) => i.paneId === fin.paneId && i.qid), 20000)
  await c.api('/needs-you/answer', { paneId: pub.paneId, seq: pub.seq, qid: pub.qid, n: '1' })
  const doneNow = await until(async () => (await laneOf(a, 'Desk'))?.agents.find((x) => x.paneId === fin.paneId && x.status === 'done'), 30000, 600)
  ok(!!doneNow && Date.parse(doneNow.statusSince) > Date.parse(doneNow.since), 'an agent that finished: done since a moment ago, started before', doneNow)
  const studio = await until(async () => { const d = (await mapOf(a)).find((x) => x.here); return d?.agents.find((x) => x.paneId === mine.paneId)?.from?.length ? d : null }, 20000)
  ok(studio?.name === 'Studio' && studio.agents.find((x) => x.paneId === mine.paneId)?.from.join() === 'Main', 'this computer first, with who handed each agent its work', studio?.agents.map((x) => [x.name, x.from]))
  const laptop = await until(async () => (await laneOf(a, 'Laptop'))?.agents?.some((x) => x.name === 'Meeting notes'), 30000, 600)
  ok(!!laptop, "Laptop's agent is on Studio's map")

  // Laptop closes: offline, with what it last said, also after Studio restarts.
  l.stop()
  const off = await until(async () => { const d = await laneOf(a, 'Laptop'); return d && !d.online ? d : null }, 30000, 500)
  ok(off?.agents?.some((x) => x.name === 'Meeting notes') && !!off.at, 'Laptop closed: offline, with what it last said and when', off)
  await a.restart()
  const offAgain = await until(async () => (await laneOf(a, 'Laptop'))?.agents?.some((x) => x.name === 'Meeting notes'), 20000)
  ok(!!offAgain, 'and still, after Studio restarts')
  await until(async () => (await laneOf(a, 'Desk'))?.online, 30000)

  // ---------- in the app ----------
  const s = await page(b, a.url, { mode: 'light', theme: 'sky' })
  await s.p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await s.p.locator('.mc-chip').click()
  await s.p.locator('.mc-menu .menu-item', { hasText: "What's running where" }).click()
  const view = s.p.locator('.am')
  await view.waitFor({ timeout: 15000 })
  ok(!!(await until(async () => (await view.locator('.am-lane').count()) >= 3, 20000)), "the devices menu's What's running where opens the map, a lane for each computer", await view.locator('.am-lane-name b').allInnerTexts())
  ok(await s.p.locator('.work.maxed .am').count() === 1, 'full size, with the sidebar beside it')
  const lanes = await view.locator('.am-lane-name b').allInnerTexts()
  ok(lanes[0] === 'Studio' && lanes.includes('Desk') && lanes.includes('Laptop'), 'this computer first, then the others', lanes)
  const lap = view.locator('.am-lane', { hasText: 'Laptop' })
  ok(/Offline · as of/.test(await lap.innerText()) && /Meeting notes/.test(await lap.innerText()) && await lap.locator('.am-main[disabled]').count() === 1, 'Laptop: offline, with what it last said, and nothing to open', await lap.innerText())
  const desk = view.locator('.am-lane', { hasText: 'Desk' })
  const deskText = await desk.innerText()
  ok(/billing-api/i.test(deskText) && /docs/i.test(deskText) && /Working for/.test(deskText) && /Done/.test(deskText) && /Opus 5\.5/.test(deskText), "Desk's lane: its agents by project, each with its state and for how long, and its model", deskText)
  ok(/Look for rounding/.test(deskText), 'and the subagent at work under its agent')
  const chiefHand = view.locator('.am-lane', { hasText: 'Studio' }).locator('.am-handed')
  ok(/Checkout copy/.test(await chiefHand.innerText().catch(() => '')), 'the Chief of Staff says who it handed work to', await view.locator('.am-lane', { hasText: 'Studio' }).innerText())
  ok(/Chief of Staff/.test(await view.locator('.am-row', { hasText: 'Checkout copy' }).locator('.am-link').innerText().catch(() => '')), 'and that agent, who handed it its work')
  await shot(s.p, `${tag}agent-map-three`)
  // One click: Desk's agent, in a tab here.
  await desk.locator('.am-row', { hasText: 'Fix rounding' }).locator('.am-main').click()
  ok(!!(await until(async () => /Fix rounding/.test(await s.p.locator('.ws-tab.main').innerText().catch(() => '')) && /Desk/.test(await s.p.locator('.ws-tab.main').innerText().catch(() => '')), 15000)), "one click opens Desk's agent in a tab here", await s.p.locator('.ws-tabs').innerText().catch(() => ''))
  // The sidebar's devices and the agents board open it too, full size; its button puts the rest back.
  await s.p.locator('.rail-machines .rmc-map').click()
  ok(!!(await until(async () => (await s.p.locator('.work.maxed .am').count()) === 1, 8000)), "the sidebar's devices open it")
  await s.p.locator('.am-head button[aria-label="Exit full size"]').click()
  ok(!!(await until(async () => /Agent Map/.test(await s.p.locator('.ws-tab.main').innerText().catch(() => '')) && await s.p.locator('.work.maxed').count() === 0, 8000)), 'Exit full size: the map in its tab, beside the agents', await s.p.locator('.ws-tabs').innerText().catch(() => ''))
  await s.p.keyboard.press('Escape')
  await s.p.locator('.board .board-map').click()
  ok(!!(await until(async () => (await s.p.locator('.work.maxed .am').count()) === 1, 8000)), "and the agents board's Map")
  ok(s.errors.length === 0, 'no page errors', s.errors)
  await s.ctx.close()

  // ---------- 34 agents on four computers and the cloud (made up) ----------
  const T = Date.now()
  const iso = (min) => new Date(T - min * 60000).toISOString()
  const PROJECTS = ['acme-shop', 'billing-api', 'docs-site', 'mobile-app', 'data-pipeline']
  const STATES = ['working', 'working', 'blocked', 'done', 'idle', 'working', 'done']
  const KINDS = [['claude', 'Claude Code', 'claude-opus-5-5'], ['codex', 'Codex', 'gpt-5-codex'], ['claude', 'Claude Code', 'claude-sonnet-4-5']]
  const fake = (dev, n, i) => {
    const [kind, kindLabel, model] = KINDS[i % 3]
    const status = STATES[(i + n) % STATES.length]
    return { paneId: `${dev}-${i}`, title: `${['Fix', 'Add', 'Refactor', 'Test', 'Review'][i % 5]} ${['checkout totals', 'refund flow with a much longer name than usual so it has to be cut short', 'search index', 'onboarding copy', 'nightly export'][(i + n) % 5]}`, name: null, status, kind, kindLabel, model, account: i % 4 === 0 ? 'Work' : null, chief: false, project: PROJECTS[(i + n) % 5], branch: i % 3 === 0 ? `fix/very-long-branch-name-${i}-for-the-thing` : null, doing: status === 'working' ? { tool: i % 2 ? 'Bash: npm test -- --run src/components/very/deep/path/test.spec.ts' : null, text: 'Looking through the billing module for every place a total is rounded before it is summed' } : { text: 'All 40 tests pass and the branch is pushed.' }, asking: status === 'blocked' ? 'Do you want to proceed?' : null, subagents: status === 'working' && i % 3 === 1 ? { count: 3, items: [{ title: 'Look for rounding in billing', type: 'Explore' }, { title: 'Check the refunds tests', type: 'general-purpose' }] } : null, from: i === 1 ? ['Main'] : [], since: iso(30 + i * 13), statusSince: iso(i * 3) }
  }
  const chiefAgent = (dev) => ({ paneId: `${dev}-chief`, title: 'Chief of Staff', name: 'Chief of Staff', status: 'idle', kind: 'claude', kindLabel: 'Claude Code', chief: true, thread: { id: 'main', name: 'Main', main: true }, from: [], since: iso(400), statusSince: iso(20), model: 'claude-opus-5-5' })
  const big = {
    devices: [
      { id: null, name: 'Studio Mac', os: 'mac', here: true, online: true, at: iso(0), agents: [chiefAgent('s'), ...Array.from({ length: 11 }, (_, i) => fake('s', 0, i))] },
      { id: 'mb', name: 'MacBook Pro', os: 'mac', online: true, at: iso(0), agents: Array.from({ length: 8 }, (_, i) => fake('m', 1, i)) },
      { id: 'pc', name: 'Windows PC', os: 'windows', online: true, at: iso(0), agents: [...Array.from({ length: 7 }, (_, i) => fake('w', 2, i)), { ...fake('w', 2, 9), paneId: 'cl1', cloud: { label: 'Cursor', repo: 'acme/shop', prUrl: 'https://github.com/acme/shop/pull/9' }, kind: 'cloud', kindLabel: 'Cursor cloud agent', status: 'done', project: 'shop' }, { ...fake('w', 2, 10), paneId: 'cl2', cloud: { label: 'Jules', repo: 'acme/docs' }, kind: 'cloud', kindLabel: 'Jules cloud agent', status: 'working', project: 'docs' }] },
      { id: 'lx', name: 'Linux workstation', os: 'linux', online: false, lastSeen: iso(42), at: iso(42), agents: Array.from({ length: 5 }, (_, i) => fake('l', 3, i)) },
    ],
  }
  const total = big.devices.reduce((n, d) => n + d.agents.length, 0)
  ok(total >= 34, `the made-up map has ${total} agents on four computers and the cloud`)
  for (const [w, h, look, phone] of [[1440, 900, { mode: 'light', theme: 'sky' }], [1280, 800, { mode: 'dark', theme: 'midnight' }], [390, 844, { mode: 'dark', theme: 'midnight' }, true], [320, 700, { mode: 'light', theme: 'sky' }, true]]) {
    const v = await page(b, a.url, { ...look, width: w, height: h, phone: !!phone, before: async (cx) => { await noServiceWorker(cx); await cx.route(/\/api\/agent-map(\?|$)/, (r) => r.fulfill({ json: big })) } })
    if (phone) await v.p.setViewportSize({ width: w, height: h })
    await v.p.waitForSelector(phone ? '.tabbar' : '.rail-nav-btn', { timeout: 20000 })
    const m = v.p.locator('.am')
    if (!phone) {
      // From ⌘K.
      await v.p.keyboard.press('ControlOrMeta+K')
      await v.p.locator('.pal-input input').fill('agent map')
      await v.p.waitForTimeout(300)
      await v.p.keyboard.press('Enter')
    } else {
      // From the phone's Agents tab, whose head has room for Map and New.
      await v.p.locator('.tabbar button', { hasText: 'Agents' }).click()
      const btn = v.p.locator('.m-acts button', { hasText: 'Map' })
      await btn.waitFor({ timeout: 10000 })
      const head = await v.p.evaluate(() => { const h = document.querySelector('.board .pane-head'); return { over: h.scrollWidth - h.clientWidth, right: Math.max(...[...h.querySelectorAll('button')].map((x) => x.getBoundingClientRect().right)), vw: window.innerWidth } })
      ok(head.over <= 1 && head.right <= head.vw, `${w} px phone: the Agents tab's Map and New fit its head`, head)
      await btn.click()
    }
    await m.waitFor({ timeout: 15000 })
    await until(async () => (await m.locator('.am-row').count()) >= total, 10000)
    const rows = await m.locator('.am-row').count()
    const geo = await v.p.evaluate(() => {
      const lanes = [...document.querySelectorAll('.am-lane')].map((e) => e.getBoundingClientRect())
      const spill = [...document.querySelectorAll('.am-lane *')].filter((e) => { const l = e.closest('.am-lane').getBoundingClientRect(); const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > l.right + 1 || r.left < l.left - 1) }).map((e) => e.className || e.tagName).slice(0, 5)
      const tops = new Set(lanes.map((r) => Math.round(r.top)))
      return { n: lanes.length, perRow: lanes.filter((r) => Math.round(r.top) === Math.min(...tops)).length, spill, wide: document.scrollingElement.scrollWidth - window.innerWidth, minW: Math.min(...lanes.map((r) => r.width)) }
    })
    const what = phone ? `${w} px phone` : `${w} px`
    ok(rows === total && geo.n === 5, `${what}: all ${total} agents, in a lane for each computer and one for the cloud`, { rows, geo })
    ok(geo.spill.length === 0 && geo.wide <= 1, `${what}: nothing spills out of its lane, nothing wider than the window`, geo)
    ok(phone ? geo.perRow === 1 : geo.perRow >= 3 && geo.minW >= 280, phone ? `${what}: one lane under another` : `${what}: lanes side by side, each wide enough to read`, geo)
    ok(/Cursor cloud/.test(await m.locator('.am-lane.cloud').innerText()) && /Started from Windows PC/.test(await m.locator('.am-lane.cloud').innerText()), `${what}: cloud agents in a lane of their own, saying which computer started them`)
    // Filters: what's waiting, everywhere.
    await m.locator('.am-filters .fchip', { hasText: 'Waiting' }).click()
    const waitingRows = await m.locator('.am-row').count()
    ok(waitingRows > 0 && waitingRows === await m.locator('.am-row.s-blocked').count(), `${what}: Waiting shows only what waits on you, on every computer`, waitingRows)
    await m.locator('.am-filters .fchip', { hasText: 'Waiting' }).click()
    await m.locator('.am-search').fill('refund')
    ok((await m.locator('.am-row').count()) > 0 && (await m.locator('.am-row').allInnerTexts()).every((x) => /refund/i.test(x)), `${what}: finding an agent by name`)
    await m.locator('.am-search').fill('')
    await shot(v.p, `${tag}agent-map-34-${w}${phone ? '-phone' : ''}`, { fullPage: !!phone })
    ok(v.errors.length === 0, `${what}: no page errors`, v.errors)
    await v.ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  fs.rmSync(scratch, { recursive: true, force: true })
}
process.exit(done().fail ? 1 : 0)
