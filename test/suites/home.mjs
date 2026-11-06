// Home, a trial feature (`home`), in the browser named by BRIDGE_TEST_BROWSER. First what goes in it
// (server/home.js, no server): what needs you (questions, permissions, failed runs, Chief of Staff's
// tasks that wait on you), what's ready to look at (finished work, a meeting's notes with action
// items not handed on, a whiteboard an agent drew since you looked, a task Chief of Staff finished),
// what's coming up (its tasks), and the rest for Everything; a whiteboard you opened isn't news;
// one row per thing (the same task twice, on one computer or two); the day a task names; an agent's
// last message cut at a whole word.
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
// A morning as the owner's Home had it (finished work of every age, the same tasks twice, tasks that
// name a day, a meeting on two calendars): headings that say what's under them, Coming Up a day at a
// time, to-dos with no day folded, the last day's six newest with Show all and the older folded, a
// summary that ends at a word, actions on a row while it's pointed at, Clear read and Clear all, the
// phone with all of it out; then loading, nothing at all, and a look that fails.
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
const needsJs = await import('../../server/needsyou.js')
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
    { id: '5', title: 'Draft the  offsite agenda.', status: 'open', added: today },
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
  ok(items.filter((i) => /offsite agenda/.test(i.task?.title || '')).map((i) => i.id).join() === 'task:3', 'the same task twice on the list (its words, give or take a space or a full stop) is one row: the one Chief of Staff is on', items.filter((i) => i.kind === 'task').map((i) => [i.id, i.task.title]))

  // The day a task names, counted from when it was added (a Thursday): Chief of Staff's tasks have
  // no due date, and a meeting's action items often say when. Nothing else is read as one.
  const due = (title) => homeJs.dueOf(title, '2026-11-05')
  const days = [['Send the board deck by Friday', '2026-11-06'], ['Call the accountant tomorrow', '2026-11-06'], ['Book flights to New York on 12 Nov', '2026-11-12'], ['Renew the domain by January 3rd', '2027-01-03'], ['Ship it on 2026-11-20', '2026-11-20'], ['Review the deck next Thursday', '2026-11-12'], ['Wrap up by end of week', '2026-11-06'], ['Reply to Sam today', '2026-11-05'],
    ['Parvinder: present the AWS paper at the offsite', null], ['Send the Monday report', null], ['Them: set up the face-to-face meeting in New York', null]]
  const wrong = days.filter(([title, d]) => due(title) !== d).map(([title, d]) => `${title}: ${due(title)}, not ${d}`)
  ok(!wrong.length, 'the day a task names: a weekday after by/on/next, today, tomorrow, end of week, a date; none from a task that names no day', wrong)
  ok(items.find((i) => i.id === 'task:3').task.due === null && homeJs.dueOf('Call them tomorrow', null) === new Date(Date.now() + 864e5).toLocaleDateString('en-CA'), 'a task with no day has none; one with no date added counts from today')

  // One row per thing, across computers (the route merges every device's list this way).
  const tk = (id, machine, status, title = 'Gary: make the introduction he offered (not done yet)') => ({ id: `task:${id}`, kind: 'task', group: status === 'waiting' ? 'needs' : 'coming', machine, online: true, task: { id, title, status, added: '2026-11-04' } })
  const ag = (id, machine, more = {}) => ({ id: `agent:${id}`, kind: 'agent', group: 'ready', machine, paneId: id.split('@')[0], agent: { title: 'GIT', project: 'GIT', ...more } })
  const one = homeJs.tidy([tk('7', 'desk', 'open'), tk('9', 'desk', 'open'), tk('3', null, 'waiting', 'gary: make the introduction he offered (not done yet)'), ag('w1:p2@1', null), ag('w1:p2@1', 'desk'), ag('w1:p2@1', 'desk'), ag('c1@1', null, { cloud: 'Cursor' }), ag('c1@1', 'desk', { cloud: 'Cursor' })])
  ok(one.filter((i) => i.kind === 'task').map((i) => `${i.machine}:${i.id}`).join() === 'null:task:3', 'the same task on two computers, and twice on one, is one row: the one waiting on you, here', one.map((i) => `${i.machine}:${i.id}`))
  ok(one.filter((i) => i.kind === 'agent').map((i) => `${i.machine}:${i.id}`).join() === 'null:agent:w1:p2@1,desk:agent:w1:p2@1,null:agent:c1@1', "agents with the same name on two computers stay two; one sent twice is one; a cloud agent seen from both is one", one.map((i) => `${i.machine}:${i.id}`))
  ok(one.find((i) => i.kind === 'task').task.due === null && homeJs.tidy([{ ...tk('2', 'old', 'open', 'Send the deck by Friday'), task: { id: '2', title: 'Send the deck by Friday', status: 'open', added: '2026-11-05' } }])[0].task.due === '2026-11-06', "a task from a device too old to say its day gets one from its words")

  // An agent's last message is cut at a whole word, not in the middle of one ("…your list, fr").
  const long = 'Done. I moved the release checklist into the roadmap and closed the three that shipped. Still pending on your list, from the meeting on Monday: the AWS paper and the intro to Gary, and the pricing page that legal still has, which I left open with a note for you to look at when you are back from the offsite, from'
  const cut = needsJs.itemOf({ paneId: 'p1', seq: 2, status: 'done', kind: 'claude', cwd: '/x/GIT', tab: 'GIT' }, { p: { text: long } }).text
  ok(cut.endsWith('…') && long.startsWith(cut.slice(0, -1)) && /[\s,;:.-]/.test(long[cut.length - 1]) && cut.length <= 300, 'a long last message ends at a whole word and "…"', cut)
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
    const ready = hm.locator('.hm-sec[aria-label="Ready to Look At"]')
    const coming = hm.locator('.hm-sec[aria-label="Coming Up"]')
    const chiefSec = hm.locator('.hm-sec[aria-label="Chief of Staff\'s Tasks"]')
    const meetRow = ready.locator('.hm-item', { hasText: 'Acme renewal sync' })
    // (Its notes are two days old: under Older than a day, folded until you open it.)
    ok(/Older than a day\s*1/.test(await ready.innerText()) && !(await meetRow.count()), 'what is older than a day is folded away, with how many', await ready.innerText())
    await ready.locator('.hm-fold').click()
    ok(/Meeting notes/.test(await meetRow.innerText()) && /2 action items not handed on yet/.test(await meetRow.innerText()) && /Whiteboard/.test(await ready.locator('.hm-item', { hasText: 'Auth flow v2' }).innerText()) && !/My sketch/.test(await ready.innerText()), "ready to look at: the meeting's notes and the whiteboard Chief of Staff drew", await ready.innerText())
    const brief = await until(async () => { const x = await coming.innerText(); return /Acme renewal sync/.test(x) && /Brief: last time, Acme renewal sync/.test(x) && x }, 10000)
    ok(!!brief && /^TODAY/m.test(brief) && /In 2\d min/.test(brief) && /SOW draft/.test(brief) && /Pricing v3/.test(brief), 'coming up, today: the next meeting, how soon, its brief from the last in the series and the files in its invite', await coming.innerText())
    ok(/On it\s+Draft the offsite agenda/.test(await chiefSec.innerText()), "the task Chief of Staff is on, under its tasks (it names no day, so it isn't under Coming Up)", await chiefSec.innerText())
    await shot(p, `${tag}home-desktop`)
    // A filter by kind, and by device.
    await hm.locator('.hm-kinds .fchip', { hasText: 'Chief of Staff' }).click()
    const chiefOnly = await hm.locator('.hm-sec[aria-label="Waiting on You"]').innerText()
    ok(/Send Priya the revised quote/.test(chiefOnly) && /Book the venue/.test(chiefOnly) && !/npm run deploy/.test(chiefOnly) && !/Acme renewal sync|Auth flow v2/.test(await hm.innerText()), 'Chief of Staff alone: its tasks on both computers, nothing else', chiefOnly)
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
    // (On a computer, what you'd do with a row is on it while the pointer is.)
    await meetRow.hover()
    await meetRow.locator('.hm-quick button', { hasText: 'To Chief of Staff' }).click()
    ok(!!(await until(async () => /On Chief of Staff's list/.test(await meetRow.innerText().catch(() => '')) || !(await meetRow.count()), 8000)), "To Chief of Staff hands the action items on, and says Chief of Staff isn't running to read them yet", await meetRow.innerText().catch(() => ''))
    ok(!!(await until(async () => (await a.api('/chief/tasks')).items.some((x) => /send the revised quote/i.test(x.title)) && /2 to do, with no day set/.test(await chiefSec.innerText()), 10000)), 'they are on its task list, folded as to-dos with no day', [(await a.api('/chief/tasks')).items.map((x) => x.title), await chiefSec.innerText()])
    await chiefSec.locator('.hm-fold').click()
    ok(/Tom: book the security review/.test(await chiefSec.innerText()), 'and unfolded, there they are', await chiefSec.innerText())
    // The whiteboard opens in a tab.
    const boardRow = ready.locator('.hm-item', { hasText: 'Auth flow v2' })
    await boardRow.hover()
    await boardRow.locator('.hm-quick button', { hasText: 'Open' }).click()
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

  // ---------- a morning, as Home is used ----------
  // What the owner's Home had: two computers, a pile of finished work of every age (each with an
  // agent's whole last message, the project named as its folder is), a meeting's notes, Chief of
  // Staff's tasks with the same ones twice on Desk (a meeting's action items handed on, then
  // handed on again) and a few with a day in them, and the calendar with the same meeting on two
  // calendars. The finished work is added to the real answer (so are a question and a failed run);
  // the rest is real.
  const deskId = (await a.api('/machines')).machines.find((m) => m.name === 'Desk').id
  // (Twenty hours ago: well inside the last day however long the run takes.)
  const yday = Date.now() - 20 * 3600e3
  const sync = `${new Date(yday).toISOString().slice(0, 10)}-weekly`
  seed(c, sync, 'Weekly sync with Parvinder', yday, '# Weekly sync\n\n## Summary\n\nThe AWS paper and New York.\n\n## Action items\n\n- [ ] Gary: make the introduction he offered (not done yet)\n- [ ] Them: set up the face-to-face meeting in New York\n- [ ] Parvinder: present the AWS paper at the offsite\n')
  await until(async () => (await c.api('/meetings')).meetings?.some((m) => m.id === sync), 8000)
  await c.api(`/meetings/${sync}/chief`, {})
  await c.api(`/meetings/${sync}/chief`, {})
  for (const [title, status] of [['Send the board deck by Friday'], ['Book flights to New York on 12 Nov'], ['Call the accountant tomorrow'], ['Look into SOC 2 vendors'], ['Draft the Q1 hiring plan', 'doing'], ['Read the Series A term sheet']]) await task(c, title, status && { status })
  const review = Date.now() - 3 * 3600e3
  seed(a, `${new Date(review).toISOString().slice(0, 10)}-design`, 'Design review: onboarding', review, '# Design review\n\n## Summary\n\nThe first-run screens.\n\n## Action items\n\n- [ ] Sam: cut the second permissions screen\n- [ ] Ana: send the new icons\n')
  const said = [
    'Done. I moved the release checklist into the roadmap, linked each item to its issue and closed the three that shipped last week. The pricing page copy is still waiting on legal, so I left it open with a note. Still pending on your list, from the meeting on Monday: the AWS paper and the intro to Gary. I did not touch the',
    'Finished the refactor of the relay reconnect logic: the socket now backs off from 1 s to 30 s, a sleeping Mac no longer drops its pairing, and the tests for both pass on macOS and Linux. Opened a pull request with the change and a short write-up of why the old timer leaked when the lid closed while a',
    'I read the three vendor quotes and put them side by side in work/vendors.md. Vanta is cheapest for our size; Drata has the better Slack integration; Secureframe could not say when they would support our cloud. My suggestion is Vanta for a year, then look again. Want me to draft the email to th',
    'All 214 tests pass. I fixed the two flaky ones in the meetings suite (a timer that raced the summary) and the screenshot for the phone at 375 px. Nothing else changed.',
    'The landing page is up on the preview link with the new hero, the three customer quotes and the pricing table. Lighthouse says 98 for performance. I could not find the final logo in the shared drive, so the old one is still in the header and footer, which you',
  ]
  const names = [['GIT', 'GIT'], ['roadmap', 'roadmap'], ['relay', 'bridge'], ['Vendors', null], ['tests', 'bridge'], ['site', 'bridge-site']]
  const ages = [2, 12, 40, 95, 170, 240, 270, 360, 540, 1300, 1500, 1700, 2000, 2300, 2900, 3400, 4100, 4300, 5000, 5800, 6500, 7200, 7900, 8600]
  const extra = ages.map((m, i) => {
    const [title, project] = names[i % names.length]
    const desk = i % 3 === 1
    return { id: `agent:x${i}@1`, nid: `x${i}@1`, kind: 'agent', group: 'ready', type: 'review', paneId: `x${i}`, seq: 1, since: new Date(Date.now() - m * 6e4).toISOString(), at: new Date(Date.now() - m * 6e4).toISOString(), text: said[i % said.length].length > 280 ? `${said[i % said.length].slice(0, 299)}…` : said[i % said.length], pr: i % 4 === 1 ? `https://github.com/acme/${project || 'site'}/pull/${100 + i}` : null, agent: { title, project, kind: 'claude', kindLabel: 'Claude Code', branch: i % 4 === 1 ? `fix-${i}` : null }, machine: desk ? deskId : null, device: desk ? 'Desk' : 'Studio', online: true }
  })
  extra.push({ id: 'agent:q1@4', nid: 'q1@4', kind: 'agent', group: 'needs', type: 'question', paneId: 'q1', seq: 4, since: new Date(Date.now() - 8 * 6e4).toISOString(), at: new Date(Date.now() - 8 * 6e4).toISOString(), text: 'Should the preview server use port 5173 or 8080? 5173 is taken by the docs site.', agent: { title: 'site', project: 'bridge-site', kind: 'codex', kindLabel: 'Codex' }, machine: deskId, device: 'Desk', online: true })
  extra.push({ id: 'agent:f1@2', nid: 'f1@2', kind: 'agent', group: 'needs', type: 'failed', paneId: 'f1', seq: 2, since: new Date(Date.now() - 50 * 6e4).toISOString(), at: new Date(Date.now() - 50 * 6e4).toISOString(), text: 'npm ERR! code ELIFECYCLE: the build failed in packages/web', agent: { title: 'deploy', project: 'deploy', kind: 'claude', kindLabel: 'Claude Code' }, machine: null, device: 'Studio', online: true })
  const clock = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }
  const inMin = (n) => new Date(Date.now() + n * 6e4)
  const ev = (id, title, start, mins, more = {}) => ({ id, title, canceled: false, calendar: 'Work', start: start.toISOString(), end: new Date(+start + mins * 6e4).toISOString(), allDay: false, attendees: [], attendeeCount: 3, ...more })
  const tomorrow = clock(10); tomorrow.setDate(tomorrow.getDate() + 1)
  const morningCal = {
    today: [ev('e1', 'Acme renewal sync', inMin(25), 30, { links: [{ url: 'https://example.com/sow', name: 'SOW draft' }] }), ev('e1b', 'Acme renewal sync', inMin(25), 30, { calendar: 'Personal' }), ev('e2', '1:1 with Gary', inMin(150), 30)],
    tomorrow: [ev('e3', 'Board prep', tomorrow, 60)], fetchedAt: new Date().toISOString(),
  }
  const morning = async (c2) => {
    await noServiceWorker(c2)
    await c2.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: morningCal }))
    await changeAnswer(c2, /\/api\/config(\?|$)/, (real) => ({ ...real, calendar: true }))
    await changeAnswer(c2, /\/api\/home(\?|$)/, (real) => ({ ...real, items: [...real.items, ...extra] }))
  }
  // What's real first: Desk's list has those tasks twice; Home has each once, and the day a task names.
  const gary = 'Gary: make the introduction he offered (not done yet)'
  ok((await c.api('/chief/tasks')).items.filter((x) => x.title === gary).length === 2, "the scene: Desk's own task list has the meeting's action items twice", (await c.api('/chief/tasks')).items.map((x) => x.title))
  const real = await until(async () => { const hh = await homeOf(a, '?live=1'); return hh.items.some((i) => i.task?.title === 'Read the Series A term sheet') && hh }, 20000, 800)
  const titles = (real?.items || []).filter((i) => i.kind === 'task').map((i) => i.task.title)
  ok(titles.length > 0 && titles.length === new Set(titles).size && titles.filter((x) => x === gary).length === 1, 'Home has each of them once (one row per task)', titles)
  const dueIn = (title) => real?.items.find((i) => i.task?.title === title)?.task.due
  ok(dueIn('Call the accountant tomorrow') === new Date(Date.now() + 864e5).toLocaleDateString('en-CA') && /-11-12$/.test(dueIn('Book flights to New York on 12 Nov') || '') && dueIn(gary) === null, 'with the day each names, or none', real?.items.filter((i) => i.kind === 'task').map((i) => [i.task.title, i.task.due]))

  const loaded = async (hm) => until(async () => { const x = await hm.innerText().catch(() => ''); return /roadmap/.test(x) && /Board prep/.test(x) && /to do, with no day set/.test(x) && /Waiting on You\s*4/.test(x) }, 20000)
  const said0 = (sub) => said.find((x) => x.startsWith(sub.replace(/…$/, '')))
  // A summary ends at a word: all of a sentence, or whole words and "…".
  const atWord = (sub) => { const s = said0(sub); const body = sub.replace(/…$/, ''); return !!s && body.length < s.length && (sub.endsWith('…') ? /[\s,;:.-]/.test(s[body.length]) : /\s/.test(s[body.length]) && /[.!?]$/.test(body)) }
  {
    const { ctx, p, errors } = await page(b, a.url, { mode: 'light', theme: 'sky', width: 1440, height: 1000, before: morning })
    const hm = p.locator('.hm')
    ok(!!(await loaded(hm)), 'a morning: Home opens with all of it', await hm.innerText().catch(() => ''))
    await p.waitForTimeout(800)
    await shot(p, `${tag}home-morning-1440`)
    const ready = hm.locator('.hm-sec[aria-label="Ready to Look At"]')
    const coming = hm.locator('.hm-sec[aria-label="Coming Up"]')
    const chiefSec = hm.locator('.hm-sec[aria-label="Chief of Staff\'s Tasks"]')
    // Headings that say what's under them, in that order; Coming Up a day at a time, in time order.
    const heads = (await hm.locator('.hm-sec h3').allInnerTexts()).map((x) => x.split('\n')[0].replace(/\d+$/, '').trim())
    ok(heads.join('|') === "Waiting on You|Ready to Look At|Coming Up|Chief of Staff's Tasks", 'a morning: the sections, by name', heads)
    const dayHeads = await coming.locator('h4').allInnerTexts()
    ok(dayHeads[0] === 'TODAY' && dayHeads[1] === 'TOMORROW' && dayHeads.length >= 3 && /12/.test(dayHeads.at(-1)), 'Coming Up: today, tomorrow, then each day after, in order', dayHeads)
    const todayText = await coming.locator('.hm-day').first().innerText()
    ok(/Acme renewal sync/.test(todayText) && (await coming.locator('.hm-ev-main b').allInnerTexts()).filter((x) => x === 'Acme renewal sync').length === 1 && /1:1 with Gary/.test(todayText) && todayText.indexOf('Acme') < todayText.indexOf('1:1 with Gary'), "today: the meetings left, at their times (the one on two calendars once)", todayText)
    const comingText = await coming.innerText()
    ok(/Call the accountant tomorrow/.test(await coming.locator('.hm-day', { hasText: 'TOMORROW' }).innerText()) && /Book flights to New York on 12 Nov/.test(await coming.locator('.hm-day').last().innerText()) && /Send the board deck by Friday/.test(comingText), 'the tasks that name a day are under that day, as Due', comingText)
    ok(!/Gary: make|SOC 2|Series A|Them: set up|Parvinder/.test(comingText) && !/today/.test(heads.join()), "and none with no day: Coming Up isn't a to-do list", comingText)
    const fold = chiefSec.locator('.hm-fold')
    const n = Number(/(\d+) to do, with no day set/.exec(await fold.innerText())?.[1])
    ok(n === 7 && /On it\s+Draft the Q1 hiring plan/.test(await chiefSec.innerText()) && !(await chiefSec.locator('.hm-trow', { hasText: 'SOC 2' }).count()), "Chief of Staff's tasks: the ones it's on, and the 7 with no day folded away", await chiefSec.innerText())
    await fold.click()
    const todo = await chiefSec.locator('.hm-trow b').allInnerTexts()
    ok(todo.length === 9 && new Set(todo).size === todo.length && todo.filter((x) => x === gary).length === 1 && todo.includes('Look into SOC 2 vendors'), 'unfolded: each once, the ones handed on twice too', todo)
    // Ready to Look At: short rows, newest first, the last day's six and Show all.
    const recent = ready.locator('ul.hm-ready').first().locator('.hm-item')
    const more = ready.locator('.hm-more-btn')
    const all = Number(/Show all (\d+)/.exec(await more.innerText().catch(() => ''))?.[1])
    ok(await recent.count() === 6 && all > 6, 'ready to look at: the last day\'s newest six, and Show all for the rest of the day', [await recent.count(), await more.innerText().catch(() => '')])
    const rowsText = await recent.allInnerTexts()
    ok(!rowsText.some((x) => /\b(\w+)\s+\1\b/.test(x.split('\n')[0])) && !(await ready.locator('.hm-item', { hasText: 'GIT' }).first().locator('.hm-what').count()) && /relay\s*bridge/.test(rowsText.join('\n')), 'nothing said twice in a row: the project named as the agent is said once (GIT, not GIT GIT), another project is said', rowsText.slice(0, 6))
    ok(!/deploy\s+deploy/.test(await hm.locator('.ny-item.t-failed .ny-meta').innerText()), "and in the inbox's card too", await hm.locator('.ny-item.t-failed .ny-meta').innerText())
    await more.click()
    const times = await ready.locator('ul.hm-ready').first().locator('time').evaluateAll((ts) => ts.map((x) => Date.parse(x.getAttribute('datetime'))))
    ok(times.length === all && times.every((x, i) => i === 0 || times[i - 1] >= x) && Date.now() - times.at(-1) < 864e5, 'Show all: all of the last day, newest first', times.length)
    const subs = await ready.locator('.hm-item[data-kind="agent"] .hm-item-sub').allInnerTexts()
    const said2 = subs.filter((x) => said0(x))
    ok(said2.length > 5 && said2.every(atWord) && said2.every((x) => x.length <= 141), "each one's last message as a line or two that ends at a word, not in the middle of one", said2.filter((x) => !atWord(x)))
    const fold2 = ready.locator('.hm-fold')
    ok(/Older than a day\s*14/.test(await fold2.innerText()) && (await fold2.getAttribute('aria-expanded')) === 'false', 'what is older than a day (14) folded away', await fold2.innerText())
    // On a computer, what you'd do with a row shows while the pointer is on it, not on every row.
    const roadmap = ready.locator('.hm-item').filter({ has: p.locator('.hm-item-l1 b', { hasText: /^roadmap$/ }) }).first()
    const quick = (row) => row.locator('.hm-quick').evaluate((e) => getComputedStyle(e).opacity)
    ok(await quick(roadmap) === '0', 'what you can do with a row is out of the way until you point at it', await quick(roadmap))
    await roadmap.hover()
    await p.waitForTimeout(250)
    ok(await quick(roadmap) === '1' && /Pull request/.test(await roadmap.locator('.hm-quick').innerText()) && /Clear/.test(await roadmap.locator('.hm-quick').innerText()) && /Open/.test(await roadmap.locator('.hm-quick').innerText()), 'and pointed at: its pull request, Clear and Open', await roadmap.locator('.hm-quick').innerText())
    await shot(p, `${tag}home-morning-1440-hover`)
    // Opened: the whole of what it said, and what you can do with it.
    await roadmap.locator('.hm-item-main').click()
    const full = await roadmap.locator('.hm-full').innerText()
    const s1 = said[1]
    ok(full.length > 200 && s1.startsWith(full.replace(/…$/, '')) && /[\s,;:.-]/.test(s1[full.length - 1]) && /Reply/.test(await roadmap.innerText()) && /Clear/.test(await roadmap.innerText()), 'a row opened: the whole of what it said (no half word at its end), Reply, its pull request, Clear and Open', full)
    await shot(p, `${tag}home-morning-1440-open`)
    // Clear read: what you've opened goes; Clear all for what's older, asked once more.
    const git = ready.locator('.hm-item', { hasText: 'Done. I moved the release checklist' }).first()
    await git.locator('.hm-item-main').click()
    const clearRead = ready.locator('.hm-clear-read')
    ok(/Clear read · 2/.test(await clearRead.innerText().catch(() => '')), "the two you've opened can be cleared at once", await ready.locator('h3').innerText())
    const before = await ready.locator('ul.hm-ready').first().locator('.hm-item').count()
    await clearRead.click()
    ok(!!(await until(async () => await ready.locator('ul.hm-ready').first().locator('.hm-item').count() <= before - 2 && !(await ready.locator(`time[datetime="${extra[0].at}"], time[datetime="${extra[1].at}"]`).count()) && /Cleared 2/.test(await hm.locator('.ny-note').innerText().catch(() => '')), 15000)), 'Clear read takes them off, and says so', await hm.locator('.ny-note').innerText().catch(() => ''))
    await fold2.click()
    ok(await ready.locator('ul.hm-ready').nth(1).locator('.hm-item').count() === 14, 'unfolded, the 14 older ones')
    await ready.locator('.hm-clear-old').click()
    ok(/Clear 14\? Each comes back when it has something new/.test(await ready.locator('.hm-sure').innerText().catch(() => '')), 'Clear all asks once more', await ready.innerText())
    await ready.locator('.hm-sure button', { hasText: /^Clear$/ }).click()
    ok(!!(await until(async () => !(await ready.locator('.hm-fold').count()) && /Cleared 14/.test(await hm.locator('.ny-note').innerText().catch(() => '')), 15000)), 'and they go, all 14', await ready.innerText())
    ok(errors.length === 0, 'a morning: no page errors', errors)
    await p.setViewportSize({ width: 1440, height: 2600 })
    await ctx.close()
  }
  {
    const { ctx, p } = await page(b, a.url, { mode: 'dark', theme: 'midnight', width: 1440, height: 2400, before: morning })
    await loaded(p.locator('.hm'))
    await p.waitForTimeout(800)
    await shot(p, `${tag}home-morning-1440-tall-dark`)
    await ctx.close()
  }
  for (const width of [375, 430]) {
    const { ctx, p, errors } = await page(b, a.url, { phone: true, mode: width === 430 ? 'dark' : 'light', theme: width === 430 ? 'midnight' : 'sky', before: morning })
    await p.setViewportSize({ width, height: 860 })
    const hm = p.locator('.hm')
    ok(!!(await loaded(hm)), `a morning, phone ${width}: all of it`)
    await p.waitForTimeout(800)
    await shot(p, `${tag}home-morning-phone-${width}`)
    ok(!(await hm.locator('.hm-quick').count()), `phone ${width}: no hover row actions (a row opens to them)`)
    await hm.locator('.hm-sec[aria-label="Coming Up"]').evaluate((e) => e.scrollIntoView({ block: 'start' }))
    await p.waitForTimeout(300)
    await shot(p, `${tag}home-morning-phone-${width}-coming`)
    // Everything out: Show all, what's older, the to-dos, a row opened with its reply box.
    const ready = hm.locator('.hm-sec[aria-label="Ready to Look At"]')
    await ready.locator('.hm-more-btn').click()
    await ready.locator('.hm-fold').click()
    await hm.locator('.hm-sec[aria-label="Chief of Staff\'s Tasks"] .hm-fold').click()
    const row = ready.locator('.hm-item').filter({ has: p.locator('.hm-item-l1 b', { hasText: /^roadmap$/ }) }).first()
    await row.locator('.hm-item-main').click()
    await row.locator('button', { hasText: 'Reply' }).click()
    await p.waitForTimeout(500)
    const f = await phoneFaults(p, '.hm')
    ok(!Object.keys(f).length, `a morning, phone ${width}: all of it out fits (nothing wider, past its edge or cut off; every control a whole 40 px target; the reply box 16 px)`, f)
    await p.setViewportSize({ width, height: 3600 })
    await p.waitForTimeout(400)
    await shot(p, `${tag}home-morning-phone-${width}-tall`)
    ok(errors.length === 0, `a morning, phone ${width}: no page errors`, errors)
    await ctx.close()
  }

  // Nothing at all, and while it loads: each part says so, none is a blank. Then a list it had, and
  // a look that fails: it says it couldn't update and keeps what it had.
  {
    let hold = true
    let fail = false
    const empty = { items: [], devices: [{ id: null, name: 'Studio', online: true, here: true }] }
    const { ctx, p, errors } = await page(b, a.url, {
      width: 1280,
      before: async (c2) => {
        await noServiceWorker(c2)
        await c2.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: { today: [], tomorrow: [], fetchedAt: new Date().toISOString() } }))
        await changeAnswer(c2, /\/api\/config(\?|$)/, (real) => ({ ...real, calendar: true }))
        await c2.route(/\/api\/home(\?|$)/, async (r) => {
          while (hold) await sleep(100)
          return fail ? r.fulfill({ status: 500, json: { error: 'the disk is full' } }) : r.fulfill({ json: empty })
        })
      },
    })
    const hm = p.locator('.hm')
    ok(!!(await until(() => p.locator('.hm-loading[role="status"]').isVisible(), 15000)) && /Loading what needs you/.test(await p.locator('.hm-loading').getAttribute('aria-label')), 'loading: it says it is', await hm.innerText().catch(() => ''))
    hold = false
    const text = await until(async () => { const x = await hm.innerText(); return /Nothing new to look at/.test(x) && x }, 10000)
    ok(!!text && /Nothing needs you right now/.test(text) && /Finished work, meeting notes and whiteboards an agent changed show here/.test(text) && /Nothing on your calendar for the rest of today or tomorrow, and no task with a day/.test(text) && /Nothing on Chief of Staff's list/.test(text), 'nothing at all: each part says there is nothing, and what would show there', text)
    await shot(p, `${tag}home-empty`)
    fail = true
    ok(!!(await until(async () => /Home couldn't update: the disk is full\. This is what it had last/.test(await hm.innerText()) && /Nothing new to look at/.test(await hm.innerText()), 12000)), "a look that fails: it says it couldn't update, and keeps what it had", await hm.innerText())
    ok(errors.length === 0, 'empty and failing: no page errors', errors)
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
    await until(async () => /need you|needs you/.test(await hm.innerText()) && /Coming Up/.test(await hm.innerText()), 10000)
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
