// Home, a trial feature (`home`), in the browser named by BRIDGE_TEST_BROWSER. First what goes in it
// (server/home.js, no server): what needs you (questions, permissions, failed runs, Chief of Staff's
// tasks that wait on you), what's ready to look at (finished work, a meeting's notes with action
// items not handed on, a whiteboard an agent drew since you looked, a task Chief of Staff finished),
// what's coming up (its tasks), and the rest for Everything; a whiteboard you opened isn't news.
// Then two Bridge AIs on relays of their own, linked: "Studio" with Home on and "Desk" with it off.
// Off, Home's route says how to turn it on and nothing leads to it. On, Studio's Home lists a stand-in
// Claude Code asking for permission, the tasks that wait on you on both computers (Desk's asked for
// with its summary), a meeting's notes with two action items, a whiteboard a Chief of Staff drew and
// not one you made, the tasks coming up; a reply to a task with no Chief of Staff running says so.
// In the app, on a desktop: it opens at Home; the sidebar's Home row and the top bar's chip lead
// there; Yes answers the agent in place; a filter by kind and by device; the next meeting (the
// calendar stood in for) with its brief from the last one in the series and the files in its invite;
// To Chief of Staff hands the meeting's action items on; a whiteboard opens; a reply that can't go
// says why; Home that can't load says why, with Try again; Everything in lanes by device and by kind.
// On a phone at 375 and 430: Home is the first tab and where it opens, Today is in More, Home and
// Everything fit the phone with every control a whole 40 px target.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, sleep, browser, page, shot, phoneFaults, noServiceWorker, changeAnswer, OUT, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('home')

// ---------- what goes in it (no server) ----------
const scratch = path.join(OUT, 'kits', `home-unit-${process.pid}`)
fs.mkdirSync(path.join(scratch, 'home'), { recursive: true })
const was = { BRIDGE_HOME: process.env.BRIDGE_HOME, HOME: process.env.HOME }
process.env.BRIDGE_HOME = path.join(scratch, 'data')
process.env.HOME = path.join(scratch, 'home')
const homeJs = await import('../../server/home.js')
for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
{
  const day = 864e5
  const ago = (ms) => new Date(Date.now() - ms).toISOString()
  const needs = [
    { id: 'p1@3', paneId: 'p1', seq: 3, type: 'permission', text: 'Do you want to proceed?', answers: [{ n: '1', title: 'Yes' }], agent: { title: 'Deploy' }, since: ago(60e3) },
    { id: 'p2@1', paneId: 'p2', seq: 1, type: 'failed', text: 'The run failed', agent: { title: 'Tests' }, since: ago(120e3) },
    { id: 'p3@5', paneId: 'p3', seq: 5, type: 'review', text: 'Done: pricing copy', pr: 'https://example.com/pr/94', agent: { title: 'Copy' }, since: ago(300e3) },
  ]
  const today = new Date().toLocaleDateString('en-CA')
  const tasks = [
    { id: '4', title: 'Send the revised quote', status: 'waiting', needs: 'Priya or Tom?', added: today },
    { id: '3', title: 'Draft the offsite agenda', status: 'doing', added: today },
    { id: '2', title: 'Compare the CRM quotes', status: 'done', outcome: 'HubSpot is cheapest', added: today, done: today },
    { id: '1', title: 'Old thing', status: 'done', added: '2020-01-01', done: '2020-01-02' },
  ]
  const meetings = [
    { id: 'm1', title: 'Acme pricing call', startedAt: ago(2 * day), endedAt: ago(2 * day - 1800e3), status: 'done', hasSummary: true },
    { id: 'm2', title: 'Standup', startedAt: ago(3 * day), endedAt: ago(3 * day - 900e3), status: 'done', hasSummary: true },
    { id: 'm3', title: 'Old review', startedAt: ago(20 * day), status: 'done', hasSummary: true },
    { id: 'm4', title: 'Recording now', startedAt: ago(60e3), status: 'recording', hasSummary: false },
  ]
  const boards = [{ id: 'Auth flow v2', title: 'Auth flow v2', mtime: Date.now() - 3600e3 }, { id: 'Mine', title: 'Mine', mtime: Date.now() - 7200e3 }]
  const h = homeJs.make({
    waiting: { items: async () => needs }, tasks: { list: () => ({ items: tasks }) }, meetings: { list: () => meetings },
    unsent: (id) => (id === 'm1' ? ['Priya: send the quote', 'Tom: book the review'] : []), boards: { list: async () => ({ boards }) }, chief: async () => 'w1:p9',
  })
  h.looked('board', 'Mine')
  const items = await h.items()
  const by = (id) => items.find((i) => i.id === id)
  ok(by('agent:p1@3')?.group === 'needs' && by('agent:p2@1')?.group === 'needs' && by('agent:p3@5')?.group === 'ready' && by('agent:p3@5').pr, 'a permission and a failed run need you; finished work, with its pull request, is ready to look at', items.filter((i) => i.kind === 'agent'))
  ok(by('task:4')?.group === 'needs' && by('task:4').task.needs === 'Priya or Tom?' && by('task:4').chief === 'w1:p9', "Chief of Staff's task that waits on you needs you, with what it needs and where a reply goes", by('task:4'))
  ok(by('task:3')?.group === 'coming' && by('task:2')?.group === 'ready' && by('task:2').task.outcome === 'HubSpot is cheapest' && !by('task:1'), 'the task it is on is coming up; one it finished today is ready, with what came of it; an old one is gone', items.filter((i) => i.kind === 'task').map((i) => [i.id, i.group]))
  ok(by('meeting:m1')?.group === 'ready' && by('meeting:m1').unsent === 2 && by('meeting:m2')?.group === null && !by('meeting:m3') && by('meeting:m4')?.group === null, "a meeting's notes with two action items not handed on are ready; one with none, two days on, is only in Everything; an old one is gone; one recording isn't news", items.filter((i) => i.kind === 'meeting').map((i) => [i.id, i.group, i.unsent]))
  ok(by('board:Auth flow v2')?.group === 'ready' && by('board:Mine')?.group === null, 'a whiteboard changed since you last looked is ready; one you opened since is not', items.filter((i) => i.kind === 'board').map((i) => [i.id, i.group]))
  const f = homeJs.fromNeeds({ id: 'x@1', type: 'question', since: 'T' })
  ok(f.id === 'agent:x@1' && f.kind === 'agent' && f.group === 'needs' && f.at === 'T' && homeJs.fromNeeds({ id: 'y', type: 'review' }).group === 'ready', "what a device sends as needs-you items alone becomes Home's", f)
}

// ---------- two Bridge AIs, linked ----------
const relays = []
const kits = []
const kitWith = async (name, rel, config = {}) => {
  const k = await startKit(`home-${name.toLowerCase()}`, {
    config,
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_LINK_PING_MS: '1500' } },
  })
  kits.push(k)
  k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await k.api('/setup', { name: 'Tester' })
  await k.api('/agents/catalog')
  return k
}
const err = (k, p) => k.api(p).then(() => null, (e) => e)
const homeOf = (k, q = '') => k.api(`/home${q}`)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  const ra = await startRelay('home-studio')
  const rc = await startRelay('home-desk')
  relays.push(ra, rc)
  const a = await kitWith('Studio', ra)
  const c = await kitWith('Desk', rc)
  await until(async () => (await a.api('/relay')).online && (await c.api('/relay')).online, 20000)
  const pair = (await a.api('/relay/pair', {})).pairing
  await c.api('/machines', { link: `${ra.url} ${pair.code}` })
  ok(!!(await until(async () => (await a.api('/machines')).machines.find((m) => m.name === 'Desk' && m.online), 30000)), 'Studio and Desk are linked')

  // Off to start with: its route says how to turn it on.
  const off = await err(a, '/home')
  ok((await a.api('/config')).trials?.home === false && off?.status === 404 && /Home is a trial feature\. Turn it on in Settings › About & Updates › Trial Features/.test(off.message), 'Home is a trial feature, off to start with: its route says how to turn it on', off?.message)
  // What's on Studio: an agent asking for permission, tasks, a meeting with action items, boards.
  const dir = path.join(a.home, 'code', 'shop')
  fs.mkdirSync(dir, { recursive: true })
  const asking = await a.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Deploy', newSpace: 'shop', prompt: 'ask npm run deploy' })
  const task = async (k, title, patch) => { const it = (await k.api('/chief/tasks', { title })).item; if (patch) await k.api(`/chief/tasks/${it.id}`, patch, 'PATCH'); return it }
  const waitTask = await task(a, 'Send Priya the revised quote', { status: 'waiting', needs: 'Which of Priya or Tom gets it?' })
  await task(a, 'Draft the offsite agenda', { status: 'doing' })
  await task(c, 'Book the venue', { status: 'waiting', needs: 'Which week suits you?' })
  const seed = (k, id, title, at, summary) => {
    const d = path.join(k.data, 'meetings', id)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'meeting.json'), JSON.stringify({ id, title, startedAt: new Date(at).toISOString(), endedAt: new Date(at + 1800e3).toISOString(), status: 'done', seconds: 1800, kind: 'general', call: 'off' }))
    if (summary) fs.writeFileSync(path.join(d, 'summary.md'), summary)
  }
  const twoDays = Date.now() - 2 * 864e5
  seed(a, `${new Date(twoDays).toISOString().slice(0, 10)}-acme`, 'Acme renewal sync', twoDays, '# Acme renewal sync\n\n## Summary\n\nPricing for next year.\n\n## Action items\n\n- [ ] Priya: send the revised quote\n- [ ] Tom: book the security review\n')
  const drawn = await a.api('/boards', { title: 'Auth flow v2', source: { kind: 'mermaid', text: 'graph TD\n  A[Login] --> B[Token]' } })
  await a.api('/boards', { title: 'My sketch' })

  await a.api('/settings', { trials: { home: true } }, 'PATCH')
  const list = await until(async () => { const h = await homeOf(a, '?live=1'); return h.items.some((i) => i.kind === 'agent' && i.type === 'permission' && i.qid) && h.items.some((i) => i.device === 'Desk' && i.kind === 'task') && h }, 40000, 800)
  const items = list?.items || []
  const at = (pred) => items.find(pred)
  ok(!!list, 'turned on, it answers: Studio\'s and Desk\'s things in one list (Desk, with Home off, sends them when asked)', items.map((i) => `${i.device} ${i.id} ${i.group}`))
  ok(at((i) => i.kind === 'agent' && i.paneId === asking.paneId)?.group === 'needs' && at((i) => i.id === `task:${waitTask.id}` && i.device === 'Studio')?.group === 'needs' && at((i) => i.kind === 'task' && i.device === 'Desk' && i.task.title === 'Book the venue')?.group === 'needs', 'needs you: the agent asking, and the tasks that wait on you on both computers', items.filter((i) => i.group === 'needs').map((i) => `${i.device} ${i.id}`))
  const meet = at((i) => i.kind === 'meeting')
  ok(meet?.group === 'ready' && meet.unsent === 2 && at((i) => i.id === `board:${drawn.id}`)?.group === 'ready' && at((i) => i.id === 'board:My sketch')?.group === null, "ready to look at: the meeting's notes with its two action items, and the whiteboard Chief of Staff drew, not the one you made", items.filter((i) => i.kind === 'meeting' || i.kind === 'board').map((i) => [i.id, i.group, i.unsent]))
  ok(at((i) => i.kind === 'task' && i.task.title === 'Draft the offsite agenda')?.group === 'coming', 'coming up: the task Chief of Staff is on')
  ok(list.devices.length === 2 && list.devices[0].here && list.devices[1].name === 'Desk' && list.devices[1].partial === false, 'its devices, this one first, and Desk sending all of it', list.devices)
  // A reply to a task that waits on you, with no Chief of Staff running: said, not lost.
  const noChief = await a.api(`/chief/tasks/${waitTask.id}/reply`, { text: 'Priya' }).then(() => null, (e) => e)
  ok(/chief of staff isn't running/i.test(noChief?.message || ''), 'a reply to a task with no Chief of Staff running says so', noChief?.message)
  // Opened yourself, the whiteboard isn't news any more.
  await a.api(`/boards/${encodeURIComponent(drawn.id)}`)
  ok(!!(await until(async () => (await homeOf(a)).items.find((i) => i.id === `board:${drawn.id}`)?.group === null, 6000)), 'a whiteboard you opened is no longer news')
  await sleep(1100)
  await a.api(`/boards/${encodeURIComponent(drawn.id)}/update`, { source: { kind: 'mermaid', text: 'graph TD\n  A[Login] --> B[Token] --> C[Session]' }, mode: 'replace' })
  ok(!!(await until(async () => (await homeOf(a)).items.find((i) => i.id === `board:${drawn.id}`)?.group === 'ready', 6000)), 'and changed by an agent again, it is')

  // ---------- in the app, on a desktop ----------
  const soon = new Date(Date.now() + 25 * 6e4)
  const cal = { today: [{ id: 'e1', title: 'Acme renewal sync', canceled: false, calendar: 'Work', start: soon.toISOString(), end: new Date(+soon + 30 * 6e4).toISOString(), allDay: false, attendees: [], attendeeCount: 3, links: [{ url: 'https://example.com/sow', name: 'SOW draft' }, { url: 'https://example.com/pricing', name: 'Pricing v3' }] }], tomorrow: [], fetchedAt: new Date().toISOString() }
  const desk = async (c2) => {
    await noServiceWorker(c2)
    await c2.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: cal }))
    await changeAnswer(c2, /\/api\/config(\?|$)/, (real) => ({ ...real, calendar: true }))
  }
  {
    const { ctx, p, errors } = await page(b, a.url, { mode: 'light', theme: 'sky', width: 1440, before: desk })
    const hm = p.locator('.hm')
    ok(!!(await until(() => hm.isVisible(), 20000)), 'desktop: it opens at Home')
    ok(await p.locator('.work.maxed .hm').isVisible(), 'full size, as the Agent Map opens')
    await until(async () => /3 things need you/.test(await hm.innerText()), 15000)
    const text = await hm.innerText()
    ok(/3 things need you/.test(text) && /On 2 computers/.test(text), 'three things need you, on two computers', text.slice(0, 300))
    ok(await p.locator('.rail-nav-btn.rail-home').isVisible() && /3/.test(await p.locator('.rail-home .mc-needs').innerText().catch(() => '')), 'the sidebar has Home first, counting what needs you', await p.locator('.rail-nav').innerText())
    const ask = hm.locator('.ny-item.t-permission')
    ok(/npm run deploy/.test(await ask.innerText().catch(() => '')) && await ask.locator('button', { hasText: 'Yes' }).isVisible() && await ask.locator('button', { hasText: 'No' }).isVisible(), 'the agent asking, with Yes and No right there', await ask.innerText().catch(() => ''))
    const ready = hm.locator('.hm-sec[aria-label="Ready to look at"]')
    const coming = hm.locator('.hm-sec[aria-label="Coming up"]')
    ok(/Notes ready · Acme renewal sync/.test(await ready.innerText()) && /2 action items not handed on yet/.test(await ready.innerText()) && /Whiteboard · Auth flow v2/.test(await ready.innerText()) && !/My sketch/.test(await ready.innerText()), "ready to look at: the meeting's notes and the whiteboard Chief of Staff drew", await ready.innerText())
    const brief = await until(async () => { const x = await coming.innerText(); return /Acme renewal sync · /.test(x) && /Brief: last time, Acme renewal sync/.test(x) && x }, 10000)
    ok(!!brief && /2 files for Acme renewal sync/.test(brief) && /SOW draft/.test(brief) && /Draft the offsite agenda/.test(brief), 'coming up: the next meeting with its brief from the last in the series, the files in its invite, and the task Chief of Staff is on', await coming.innerText())
    await shot(p, `${tag}home-desktop`)
    // A filter by kind, and by device.
    await hm.locator('.hm-kinds .fchip', { hasText: 'Chief of Staff' }).click()
    const chiefOnly = await hm.locator('.hm-sec[aria-label="Waiting on you"]').innerText()
    ok(/Send Priya the revised quote/.test(chiefOnly) && /Book the venue/.test(chiefOnly) && !/npm run deploy/.test(chiefOnly) && !/Notes ready/.test(await hm.innerText()), 'Chief of Staff alone: its tasks on both computers, nothing else', chiefOnly)
    await hm.locator('.hm-kinds .fchip', { hasText: 'Chief of Staff' }).click()
    await hm.locator('select.hm-device').selectOption({ label: 'Desk' })
    const deskOnly = await hm.innerText()
    ok(/Book the venue/.test(deskOnly) && !/Send Priya the revised quote/.test(deskOnly) && !/npm run deploy/.test(deskOnly), 'Desk alone: only what is on Desk', deskOnly.slice(0, 400))
    await hm.locator('select.hm-device').selectOption({ value: 'all' })
    // A reply that can't go says why, right there.
    const taskCard = hm.locator('.hm-task', { hasText: 'Send Priya the revised quote' })
    await taskCard.locator('button', { hasText: 'Reply' }).click()
    await taskCard.locator('input').fill('Priya')
    await taskCard.locator('button', { hasText: 'Send' }).click()
    ok(!!(await until(async () => /chief of staff isn't running/i.test(await hm.locator('.ny-note').innerText().catch(() => '')), 6000)), "a reply with no Chief of Staff running says it isn't, in place", await hm.locator('.ny-note').innerText().catch(() => ''))
    // Yes, right there: the agent gets it and goes on.
    await ask.locator('button', { hasText: 'Yes' }).click()
    ok(!!(await until(async () => !(await hm.locator('.ny-item.t-permission').count()) && /2 things need you/.test(await hm.innerText()), 15000)), 'Yes answers the agent in place, and it leaves the list', await hm.innerText().catch(() => ''))
    // To Chief of Staff: the meeting's two action items go on its list.
    const meetRow = ready.locator('.hm-row', { hasText: 'Acme renewal sync' })
    await meetRow.locator('button', { hasText: 'To Chief of Staff' }).click()
    ok(!!(await until(async () => /On Chief of Staff's list/.test(await meetRow.innerText().catch(() => '')) || !(await meetRow.count()), 8000)), "To Chief of Staff hands the action items on, and says Chief of Staff isn't running to read them yet", await meetRow.innerText().catch(() => ''))
    ok(!!(await until(async () => (await a.api('/chief/tasks')).items.some((x) => /send the revised quote/i.test(x.title)) && /Tom: book the security review|book the security review/i.test(await coming.innerText()), 10000)), 'they are on its task list, and coming up', (await a.api('/chief/tasks')).items.map((x) => x.title))
    // The whiteboard opens in a tab.
    await ready.locator('.hm-row', { hasText: 'Auth flow v2' }).locator('button', { hasText: 'Open' }).click()
    ok(!!(await until(async () => /Auth flow v2/.test(await p.locator('.ws-tab.main').innerText().catch(() => '')), 8000)), 'a whiteboard opens from Home', await p.locator('.ws-tab.main').innerText().catch(() => ''))
    // Back to Home from the top bar's chip, and from the sidebar.
    await p.locator('.topbar .needs-chip').click()
    ok(!!(await until(() => hm.isVisible(), 5000)) && !(await p.locator('.ny-panel').count()), "the top bar's needs-you chip opens Home")
    await p.keyboard.press('Escape')
    await p.locator('.ws-tab', { hasText: 'Auth flow v2' }).click()
    await p.locator('.rail-nav-btn.rail-home').click()
    ok(!!(await until(() => p.locator('.work.maxed .hm').isVisible(), 5000)), "and the sidebar's Home row")
    // Everything: a lane per computer, or per kind.
    await hm.locator('.hm-every').click()
    const ey = p.locator('.ey')
    ok(!!(await until(() => ey.isVisible(), 8000)), 'See everything opens Everything')
    const lanes = await until(async () => { const n = await ey.locator('.ey-lane-head b').allInnerTexts(); return n.length === 2 && n }, 10000)
    ok(lanes && lanes[0] === 'Studio' && lanes[1] === 'Desk', 'a lane per computer, this one first', lanes)
    const studioLane = await ey.locator('.ey-lane').first().innerText()
    ok(/Agents/i.test(studioLane) && /Meetings/i.test(studioLane) && /Chief of Staff tasks/i.test(studioLane) && /Whiteboards/i.test(studioLane) && /Deploy/.test(studioLane) && /My sketch/.test(studioLane), "Studio's lane has its agents, meetings, Chief of Staff tasks and whiteboards, the ones that need nothing too", studioLane)
    await ey.locator('.ey-seg button', { hasText: 'By kind' }).click()
    const kinds = await ey.locator('.ey-lane-head b').allInnerTexts()
    ok(kinds.join('|') === 'Agents|Questions|Meetings|Chief of Staff tasks|Whiteboards', 'by kind: a lane for each kind of thing', kinds)
    ok(/Studio/.test(await ey.locator('.ey-lane', { hasText: 'Whiteboards' }).innerText()) && /Desk/.test(await ey.locator('.ey-lane', { hasText: 'Chief of Staff tasks' }).innerText()), 'each saying which computer it is on')
    await ey.locator('.ey-mine input').check()
    const mine = await ey.innerText()
    ok(/Book the venue/.test(mine) && !/My sketch/.test(mine), 'Only what needs me', mine.slice(0, 300))
    await shot(p, `${tag}home-everything`)
    ok(errors.length === 0, 'desktop: no page errors', errors)
    await ctx.close()
  }
  // Home that can't load says why, with Try again.
  {
    let fail = true
    const { ctx, p } = await page(b, a.url, { width: 1280, before: async (c2) => { await noServiceWorker(c2); await c2.route(/\/api\/home(\?|$)/, (r) => (fail ? r.fulfill({ status: 500, json: { error: 'the disk is full' } }) : r.fallback())) } })
    const e = p.locator('.hm-err')
    ok(!!(await until(async () => /Home couldn't load: the disk is full/.test(await e.innerText().catch(() => '')), 15000)), "Home that can't load says why", await p.locator('.hm').innerText().catch(() => ''))
    fail = false
    await e.locator('button', { hasText: 'Try again' }).click()
    ok(!!(await until(async () => !(await p.locator('.hm-err').count()) && /need you|needs you/.test(await p.locator('.hm-title h2').innerText().catch(() => '')), 8000)), 'and Try again brings it')
    await ctx.close()
  }

  // ---------- on a phone ----------
  for (const width of [375, 430]) {
    const { ctx, p, errors } = await page(b, a.url, { phone: true, mode: width === 430 ? 'dark' : 'light', theme: width === 430 ? 'midnight' : 'sky', before: desk })
    await p.setViewportSize({ width, height: 860 })
    await p.waitForSelector('.tabbar button', { timeout: 20000 })
    // (The tabs are the usual ones until the page has its settings, a moment after it opens.)
    const tabNames = async () => (await p.locator('.tabbar button').allInnerTexts()).map((x) => x.trim().split('\n').pop().trim())
    await until(async () => (await tabNames())[0] === 'Home', 10000)
    const tabs = await tabNames()
    ok(tabs.join('|') === 'Home|Chief|Agents|Meetings|More', `phone ${width}: Home is the first tab, and Today isn't a tab`, tabs)
    const hm = p.locator('.hm')
    ok(!!(await until(() => hm.isVisible(), 15000)) && (await p.locator('.tabbar button[aria-current="true"]').innerText()).includes('Home'), `phone ${width}: it opens at Home`)
    await until(async () => /need you|needs you/.test(await hm.innerText()) && /Coming up/.test(await hm.innerText()), 10000)
    await p.waitForTimeout(800)
    let f = await phoneFaults(p, '.hm')
    ok(!Object.keys(f).length, `phone ${width}: Home fits the phone (nothing wider, past its edge or cut off; every control a whole 40 px target)`, f)
    await shot(p, `${tag}home-phone-${width}`)
    await hm.locator('.hm-every').click()
    const ey = p.locator('.ey')
    await ey.waitFor({ timeout: 8000 }).catch(() => {})
    await until(async () => (await ey.locator('.ey-lane').count()) >= 2, 8000)
    f = await phoneFaults(p, '.ey')
    ok(!Object.keys(f).length, `phone ${width}: Everything fits too, one lane under another`, f)
    await shot(p, `${tag}home-everything-phone-${width}`)
    await ey.locator('button', { hasText: 'Home' }).first().click()
    ok(!!(await until(() => hm.isVisible(), 5000)), `phone ${width}: and back to Home`)
    await p.locator('.tabbar button', { hasText: 'More' }).click()
    await p.locator('.m-more-row', { hasText: 'Today' }).click()
    ok(!!(await until(() => p.locator('.m-more-view .m-today').isVisible(), 6000)), `phone ${width}: Today is in More`)
    ok(errors.length === 0, `phone ${width}: no page errors`, errors)
    await ctx.close()
  }

  // Off again: nothing leads to it, and the app opens as it did.
  await a.api('/settings', { trials: { home: false } }, 'PATCH')
  {
    const { ctx, p } = await page(b, a.url, { width: 1280 })
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await p.waitForTimeout(1500)
    ok(!(await p.locator('.rail-home').count()) && !(await p.locator('.hm').count()), 'turned off: no Home in the sidebar, and the app opens as before')
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').fill('Everything')
    await p.waitForTimeout(500)
    ok(!(await p.locator('.pal-item[data-id="a:everything"], .pal-item[data-id="a:homeview"]').count()), 'and ⌘K offers neither Home nor Everything')
    await ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await b.close()
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  fs.rmSync(scratch, { recursive: true, force: true })
}
process.exit(done().fail ? 1 : 0)
