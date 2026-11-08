// Home, a beta feature (`home`), in the browser named by BRIDGE_TEST_BROWSER. First what goes in it
// (server/home.js, no server): what needs you (questions, permissions, failed runs, Chief of Staff's
// tasks that wait on you), what's ready to look at (finished work, a meeting's notes with action
// items not handed on, a whiteboard an agent drew since you looked, a task Chief of Staff finished),
// what's coming up (its tasks), and the rest for Everything; a whiteboard you opened isn't news;
// one row per thing (the same task twice, on one computer or two); the day a task names; an agent's
// last message cut at a whole word; what's pinned, newest first, kept when Bridge AI starts again.
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
// phone with all of it out. A busy day on four computers (one older, one offline; many of each kind,
// long titles), from 1920 px wide to a phone: the note about the older one is in the column with
// everything else, as are the bar and the sections; cards side by side are the same height with their
// buttons at the bottom, each with its icon; sorted what needs you first, oldest first, by computer
// and by kind, the order kept; pinned to the top (a row, a to-do, a question, a whiteboard that isn't
// news), kept on the computer and seen from a phone, a pin that can't be saved said, unpinned back
// where it was. What needs you now and what has gone quiet (shared/focus.js): without a server, a
// busy, mixed-age state in order, the 3-day edge, why; when you were last on an agent, its project
// and space (engaged.js); the inbox's items and Home's tasks with it. In the app, a mixed-age day:
// every count the six that need you now, the order, the first three with why, the quiet ones folded
// by project, opened, cleared; the inbox the same. Then loading, nothing at all, and a look that fails.
// On a phone at 375 and 430: Home is the first tab and where it opens, Today is in More, Home and
// Everything fit the phone with every control a whole 40 px target.
// It holds on any day at any hour: BRIDGE_TEST_CLOCK ("Sat 00:30", "Sun 23:50", "16:05") runs this
// test, both servers and every page from then (testClock in the harness).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, sleep, browser, page, shot, phoneFaults, noServiceWorker, changeAnswer, testClock, OUT, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('home')
const clock = testClock()
// This test's times by that clock: its own Date, so Playwright (in this process too) keeps the real one.
const Date = clock.Date
if (clock.on) console.log(`home: run at ${new Date().toString()}`)
// Each page from the test's time too.
const pageAt = (b, url, o = {}) => page(b, url, { ...o, before: async (c) => { await clock.install(c); await o.before?.(c) } })
// A day from today (YYYY-MM-DD, this computer's), counted in days rather than hours.
const dayFrom = (n, from = Date.now()) => { const d = new Date(from); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d }
const ymd = (d) => d.toLocaleDateString('en-CA')

// ---------- what goes in it (no server) ----------
// (Server modules run here by the test's clock too, until the browser opens.)
clock.here()
const scratch = path.join(OUT, 'kits', `home-unit-${process.pid}`)
fs.mkdirSync(path.join(scratch, 'home'), { recursive: true })
const was = { BRIDGE_HOME: process.env.BRIDGE_HOME, HOME: process.env.HOME }
process.env.BRIDGE_HOME = path.join(scratch, 'data')
process.env.HOME = path.join(scratch, 'home')
const homeJs = await import('../../server/home.js')
const needsJs = await import('../../server/needsyou.js')
const engagedJs = await import('../../server/engaged.js')
const chiefJs = await import('../../server/chieftasks.js')
const focus = await import('../../shared/focus.js')
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
  const days = [['Send the board deck by Friday', '2026-11-06'], ['Call the accountant tomorrow', '2026-11-06'], ['Book flights to the offsite on 12 Nov', '2026-11-12'], ['Renew the domain by January 3rd', '2027-01-03'], ['Ship it on 2026-11-20', '2026-11-20'], ['Review the deck next Thursday', '2026-11-12'], ['Wrap up by end of week', '2026-11-06'], ['Reply to Sam today', '2026-11-05'],
    ['Parvinder: present the AWS paper at the offsite', null], ['Send the Monday report', null], ['Them: set up the face-to-face meeting at the offsite', null]]
  const wrong = days.filter(([title, d]) => due(title) !== d).map(([title, d]) => `${title}: ${due(title)}, not ${d}`)
  ok(!wrong.length, 'the day a task names: a weekday after by/on/next, today, tomorrow, end of week, a date; none from a task that names no day', wrong)
  ok(items.find((i) => i.id === 'task:3').task.due === null && homeJs.dueOf('Call them tomorrow', null) === ymd(dayFrom(1)), 'a task with no day has none; one with no date added counts from today')

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

  // Pinned to the top: by its id on Home (its device's and its own), newest first, kept in
  // home.json so it's still pinned after Bridge AI starts again; the newest 200 at most.
  h.pin('here|task:4', true)
  await sleep(5)
  h.pin('desk|agent:p3@5', true)
  ok(h.pins().map((x) => x.id).join() === 'desk|agent:p3@5,here|task:4', 'pinned: the newest first', h.pins())
  h.pin('here|task:4', false)
  ok(h.pins().map((x) => x.id).join() === 'desk|agent:p3@5', 'and unpinned, it goes', h.pins())
  const noId = (() => { try { h.pin('', true); return null } catch (e) { return e } })()
  ok(/which one/i.test(noId?.message || ''), 'a pin that names nothing is refused, with why', noId?.message)
  await sleep(700)
  const again = homeJs.make({ waiting: { items: async () => [] }, tasks: { list: () => ({ items: [] }) }, meetings: { list: () => [] }, unsent: () => [], boards: { list: async () => ({ boards: [] }) }, chief: async () => null })
  ok(again.pins().map((x) => x.id).join() === 'desk|agent:p3@5', 'still pinned when Bridge AI starts again', again.pins())
  for (let i = 0; i < 205; i++) again.pin(`here|board:b${i}`, true)
  ok(again.pins().length === 200, 'the newest 200 pins are kept', again.pins().length)
  for (const x of again.pins()) again.pin(x.id, false)
  await sleep(700)
}

// ---------- what needs you now, and what has gone quiet (shared/focus.js) ----------
// A busy, mixed-age state by the test's clock: waits of minutes and of days, some in projects you
// used an hour ago, some in ones nobody has touched for a week, a task replied to just now.
{
  const now = Date.now()
  const minAgo = (m) => new Date(now - m * 6e4).toISOString()
  const dayAgo = (d) => minAgo(d * 1440)
  const it = (id, type, since, seen = {}, more = {}) => ({ id, type, since, seen, active: focus.latest(since, seen.you, seen.project, seen.space, seen.replied, seen.changed), agent: { title: id, project: more.project || null }, ...more })
  const busy = [
    it('task-4d', null, dayAgo(4), { changed: dayAgo(4) }, { kind: 'task' }),
    it('ask-1h', 'question', dayAgo(1.5), { project: minAgo(55) }, { project: 'shop' }),
    it('perm-new', 'permission', minAgo(3)),
    it('perm-week', 'permission', dayAgo(4.2), { you: dayAgo(8), project: dayAgo(8) }, { project: 'old-prototype' }),
    it('failed-40', 'failed', minAgo(40)),
    it('task-replied', null, dayAgo(2), { changed: dayAgo(2), replied: minAgo(20) }, { kind: 'task' }),
    it('task-20h', null, minAgo(20 * 60), { changed: minAgo(20 * 60) }, { kind: 'task' }),
    it('older-device', 'question', null),
  ]
  const { now: live, quiet } = focus.split(busy, { now })
  ok(live.map((i) => i.id).join() === 'perm-new,ask-1h,older-device,failed-40,task-replied,task-20h' && quiet.map((i) => i.id).join() === 'perm-week,task-4d', 'now: a permission just asked, a question in a project you used an hour ago (waiting a day and a half), one from a computer too old to say when, a run that failed 40 min ago, a task replied to 20 min ago, one from yesterday; quiet: a permission in a project untouched for a week, a task untouched for four days', { live: live.map((i) => `${i.id} ${focus.score(i, now)}`), quiet: quiet.map((i) => i.id) })
  ok(live.findIndex((i) => i.id === 'ask-1h') < live.findIndex((i) => i.id === 'task-replied') && focus.isQuiet(busy[0], now), 'an agent blocked in a project you used an hour ago comes before a Chief of Staff task, and one untouched for four days is quiet')
  ok(focus.QUIET_DAYS === 3 && !focus.isQuiet({ since: dayAgo(2.9) }, now) && focus.isQuiet({ since: dayAgo(3.01) }, now) && !focus.isQuiet({ since: dayAgo(5), active: dayAgo(1) }, now) && !focus.isQuiet({}, now), 'quiet after 3 days with nothing from you or it; anything since (active) makes it count again; one with no time at all is never quiet')
  ok(focus.split(busy, { now, keep: (i) => i.id === 'task-4d' }).now.some((i) => i.id === 'task-4d'), 'one you pinned is never quiet')
  const why = (id) => focus.reason(busy.find((i) => i.id === id))
  ok(why('ask-1h').blocking && why('ask-1h').by === 'project' && why('ask-1h').at === minAgo(55) && why('task-replied').by === 'replied' && !why('task-replied').blocking && why('perm-new').by === 'new' && why('perm-new').blocking, 'why each is first: blocking, and what was latest (you in its project, your reply, a new wait)', [why('ask-1h'), why('task-replied'), why('perm-new')])
  ok(needsJs.order(busy.filter((i) => !i.kind)).map((i) => i.id).join() === 'perm-new,ask-1h,older-device,failed-40,perm-week', "the inbox's order is the same: what needs you now, then what's quiet", needsJs.order(busy.filter((i) => !i.kind)).map((i) => i.id))

  // When you were last on an agent, its project and its space (engaged.js), kept for 30 days.
  const file = path.join(scratch, 'engaged.json')
  const shop = path.join(scratch, 'code', 'shop')
  const tree = path.join(scratch, 'trees', 'shop-fix')
  const chats = path.join(scratch, 'chats')
  const describe = (cwd) => (cwd === tree ? { repo: shop } : null)
  const e = engagedJs.make({ file, describe, chats })
  const ag = (paneId, cwd, workspaceId = 'ws1') => ({ paneId, cwd, workspaceId })
  const t1 = now - 55 * 6e4
  e.agent(ag('w1:p1', shop), t1)
  e.agent(ag('w1:p1', shop), t1 - 6e5) // an earlier one doesn't move it back
  e.agent(ag('w3:p1', chats, 'chats'), t1)
  e.agent(ag('w4:p1', path.join(scratch, 'code', 'gone')), now - 31 * 864e5)
  e.task('9', now - 20 * 6e4)
  const iso = (t) => new Date(t).toISOString()
  const sib = e.of(ag('w1:p2', shop))
  const branch = e.of(ag('w2:p1', tree, 'ws2'))
  ok(e.of(ag('w1:p1', shop)).you === iso(t1) && sib.you === null && sib.project === iso(t1) && sib.space === iso(t1), 'you on an agent: it, its project (another agent in the same folder) and its space', sib)
  ok(branch.project === iso(t1) && branch.space === null && e.of(ag('w1:p1', path.join(scratch, 'code', 'other'))).you === null, 'an agent on its own branch is in the repo it belongs to; a pane number used again in another folder is another agent', branch)
  ok(e.of(ag('w3:p2', chats, 'x')).project === null && e.taskOf('9') === iso(now - 20 * 6e4), 'a New chat has no project to be in; a reply to a task is kept by its number')
  await sleep(1700)
  const e2 = engagedJs.make({ file, describe, chats })
  ok(e2.of(ag('w1:p1', shop)).you === iso(t1) && e2.taskOf('9') && e2.of(ag('w4:p1', path.join(scratch, 'code', 'gone'))).you === null, 'kept when Bridge AI starts again, and what is older than 30 days forgotten', JSON.parse(fs.readFileSync(file, 'utf8')))

  // The inbox's items say when you were last on each agent, and the one quiet for days goes last.
  fs.mkdirSync(path.join(scratch, 'data', 'cache'), { recursive: true })
  fs.writeFileSync(path.join(scratch, 'data', 'cache', 'needs-you.json'), JSON.stringify({ cleared: [], since: { 'w1:p5@4': dayAgo(1.5), 'w5:p1@2': dayAgo(4) } }))
  const fleet = { agents: [
    { paneId: 'w5:p1', seq: 2, status: 'blocked', kind: 'codex', kindLabel: 'Codex', cwd: path.join(scratch, 'code', 'old-prototype'), workspaceId: 'ws5', tab: 'proto', asking: { title: 'Drop the old cache?', count: 1 } },
    { paneId: 'w1:p5', seq: 4, status: 'blocked', kind: 'codex', kindLabel: 'Codex', cwd: shop, workspaceId: 'ws1', tab: 'api', asking: { title: 'Keep the old API?', count: 1 } },
  ] }
  const w = needsJs.make({ rt: { read: async () => '' }, fleet: async () => fleet, engaged: e })
  const got = await w.items()
  ok(got.map((i) => i.id).join() === 'w1:p5@4,w5:p1@2' && got[0].seen.project === iso(t1) && got[0].active === iso(t1) && got[1].active === got[1].since && focus.isQuiet(got[1], now), 'the inbox: a question in the project you were in 55 min ago first, active since then; one waiting four days in a project nobody touched, last and quiet', got.map((i) => [i.id, i.since, i.seen, i.active]))

  // A task's last change, to the minute, kept on its line (chieftasks.js); Home's task that waits on
  // you is active since then, or since your reply.
  const tasksDir = path.join(scratch, 'chief')
  const list = chiefJs.makeTasks(tasksDir)
  const venue = list.add('Book the venue for the offsite')
  ok(venue.changed === null, 'a new task has no change yet')
  const waitingNow = list.update(venue.id, { status: 'waiting', needs: 'Which week suits you?' })
  const minute = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)$/.exec(waitingNow.changed || '')
  ok(!!minute && Math.abs(Date.parse(minute[1]) - now) < 120e3 && fs.readFileSync(list.file, 'utf8').includes(`changed:${waitingNow.changed}`), 'waiting on you: when it changed, to the minute in this computer\'s time, on its line', waitingNow)
  const md = path.join(tasksDir, 'state', 'tasks.md')
  const old = `${ymd(new Date(now - 4 * 864e5))}T09:15`
  fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace(`changed:${waitingNow.changed}`, `changed:${old}`))
  ok(list.update(venue.id, { needs: 'Which week suits you?' }).changed === old && list.update(venue.id, { needs: 'Which of the two weeks?' }).changed !== old, 'the same again is no change; what it needs changing is', list.list().items[0])
  list.update(venue.id, { status: 'done' })
  ok(!/changed:/.test(fs.readFileSync(md, 'utf8')) && list.list().items[0].changed === null, 'done: no change kept')
  const tk = (id, changed, added = ymd(new Date(now - 6 * 864e5))) => ({ id, title: `Task ${id}`, status: 'waiting', needs: 'Which one?', added, changed })
  const ht = homeJs.make({ waiting: { items: async () => [] }, tasks: { list: () => ({ items: [tk('7', old), tk('8', null), tk('9', old)] }) }, meetings: { list: () => [] }, unsent: () => [], boards: { list: async () => ({ boards: [] }) }, chief: async () => null, engaged: e })
  const hi = await ht.items()
  const hb = (id) => hi.find((i) => i.id === `task:${id}`)
  ok(focus.isQuiet(hb('7'), now) && hb('7').since === new Date(old).toISOString() && focus.isQuiet(hb('8'), now) && !focus.isQuiet(hb('9'), now) && hb('9').seen.replied === iso(now - 20 * 6e4) && hb('9').active === hb('9').seen.replied, "Home's tasks that wait on you: one unchanged for four days and one only added six days ago are quiet; one you replied to 20 min ago isn't", hi.map((i) => [i.id, i.since, i.active]))
}

clock.real()

// ---------- two Bridge AIs, linked ----------
const relays = []
const kits = []
const kitWith = async (name, rel, config = {}) => {
  const k = await startKit(`home-${name.toLowerCase()}`, {
    config,
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_LINK_PING_MS: '1500', ...clock.env } },
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
  ok((await a.api('/config')).trials?.home === false && off?.status === 404 && /Home is a beta feature\. Turn it on in Settings › About & Updates › Beta Features/.test(off.message), 'Home is a beta feature, off to start with: its route says how to turn it on', off?.message)
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
  // The next meeting in 25 minutes, or sooner late in the evening, so it's still today.
  const soonIn = Math.max(1, Math.min(25, Math.floor((new Date().setHours(24, 0, 0, 0) - Date.now()) / 6e4 / 2)))
  const soon = new Date(Date.now() + soonIn * 6e4)
  const inAbout = (x) => { const m = /In (\d+) min/.exec(x); return !!m && Math.abs(+m[1] - soonIn) <= 2 }
  const cal = { today: [{ id: 'e1', title: 'Acme renewal sync', canceled: false, calendar: 'Work', start: soon.toISOString(), end: new Date(+soon + 30 * 6e4).toISOString(), allDay: false, attendees: [], attendeeCount: 3, links: [{ url: 'https://example.com/sow', name: 'SOW draft' }, { url: 'https://example.com/pricing', name: 'Pricing v3' }] }], tomorrow: [], fetchedAt: new Date().toISOString() }
  const desk = async (c2) => {
    await noServiceWorker(c2)
    await c2.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: cal }))
    await changeAnswer(c2, /\/api\/config(\?|$)/, (real) => ({ ...real, calendar: true }))
  }
  {
    const { ctx, p, errors } = await pageAt(b, a.url, { mode: 'light', theme: 'sky', width: 1440, before: desk })
    const hm = p.locator('.hm')
    ok(!!(await until(() => hm.isVisible(), 20000)), 'desktop: it opens at Home')
    ok(await p.locator('.work.maxed .hm').isVisible(), 'full size, as the Agent Map opens')
    // This computer's things first: what needs you on Studio, and Desk's as a line of its own.
    await until(async () => /2 things need you/.test(await hm.innerText()) && /On Other Computers/.test(await hm.innerText()), 15000)
    const text = await hm.innerText()
    ok(/2 things need you/.test(text) && /On Studio, this computer/.test(text) && (await hm.locator('select.hm-device').inputValue()) === 'this', 'this computer first: the two things that need you on Studio', text.slice(0, 300))
    const awayLine = hm.locator('.hm-away-row', { hasText: 'Desk' })
    ok(/1 more on another computer/.test(await hm.locator('.hm-away h3').innerText()) && /1 needs you/.test(await awayLine.innerText()) && !/Book the venue/.test(await hm.locator('.hm-sec[aria-label="Waiting on You"]').innerText()), "Desk's as one line under them, not among them", await hm.locator('.hm-away').innerText().catch(() => ''))
    ok(await p.locator('.rail-nav-btn.rail-home').isVisible() && (await p.locator('.rail-home .mc-needs').innerText().catch(() => '')).trim() === '2', 'the sidebar has Home first, counting what needs you on this computer', await p.locator('.rail-nav').innerText())
    const pill = p.locator('.topbar .needs-chip')
    ok(/^2\s*need you/.test((await pill.innerText()).trim()) && /1 more on another computer/.test(await pill.getAttribute('title')) && (await p.locator('.mc-chip .mc-needs').innerText().catch(() => '')).trim() === '1', "the top bar's chip counts this computer's two and says there's one more, the devices menu's chip Desk's one", [await pill.innerText(), await pill.getAttribute('title'), await p.locator('.mc-chip').innerText()])
    await awayLine.locator('.hm-away-line').click()
    const venue = awayLine.locator('.hm-task', { hasText: 'Book the venue' })
    ok(await venue.isVisible() && await venue.locator('button', { hasText: 'Reply' }).isVisible() && /Open on Desk/.test(await venue.locator('.ny-acts').innerText()), "opened, Desk's task is there to answer in place, and its Open says it goes to Desk", await awayLine.innerText())
    await shot(p, `${tag}home-this-computer`)
    // Open on Desk: this window shows Desk and says so, and Back brings Studio's Home again.
    const deskAt = (await a.api('/machines')).machines.find((m) => m.name === 'Desk').id
    await venue.locator('button', { hasText: 'Open on Desk' }).click()
    const sw = p.locator('.ask-banner.switched')
    ok(!!(await until(async () => p.url().includes(`/m/${deskAt}/`) && /This window shows Desk now, to open Chief of Staff/.test(await sw.innerText().catch(() => '')), 20000)), 'Open on Desk switches this window to Desk, and says so with the way back', await sw.innerText().catch(() => p.url()))
    // And it's at the task: Desk's Chief of Staff (not running, so started), at its Chat, with the
    // task and what it needs on its list. Looked at once the page has settled.
    const deskTasks = p.locator('.ct-tray')
    const atTask = await until(async () => /Chief of Staff/.test(await p.locator('.ws-tab.main').innerText().catch(() => '')) && /Book the venue/.test(await deskTasks.innerText().catch(() => '')) && /Which week suits you\?/.test(await deskTasks.innerText().catch(() => '')) && !(await p.locator('.rail .skeleton-rows').count()), 30000)
    ok(!!atTask, "on Desk, its Chief of Staff is open at its Chat, with the task and what it needs on its list (not the New page)", [await p.locator('.ws-tabs').innerText().catch(() => ''), await deskTasks.innerText().catch(() => 'no task list')])
    await p.waitForTimeout(500)
    await shot(p, `${tag}home-switched`)
    await sw.locator('button', { hasText: 'Back to Studio' }).click()
    ok(!!(await until(async () => !p.url().includes('/m/') && /2 things need you/.test(await p.locator('.work.maxed .hm').innerText().catch(() => '')), 20000)), 'Back to Studio: its Home as it was, this computer first')
    // Every computer together: picked once, and kept after a reload.
    await hm.locator('select.hm-device').selectOption({ value: 'all' })
    await p.reload()
    await until(async () => /3 things need you/.test(await hm.innerText().catch(() => '')), 15000)
    const allText = await hm.innerText()
    ok(/3 things need you/.test(allText) && /On 2 computers/.test(allText) && (await hm.locator('select.hm-device').inputValue()) === 'all' && !(await hm.locator('.hm-away').count()), 'All devices: three things need you, on two computers, still picked after a reload', allText.slice(0, 300))
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
    ok(!!brief && /^TODAY/m.test(brief) && inAbout(brief) && /SOW draft/.test(brief) && /Pricing v3/.test(brief), 'coming up, today: the next meeting, how soon, its brief from the last in the series and the files in its invite', await coming.innerText())
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
    ok(!!(await until(async () => /chief of staff isn't running/i.test(await hm.locator('.hm-toast').innerText().catch(() => '')), 6000)), "a reply with no Chief of Staff running says it isn't", await hm.locator('.hm-toast').innerText().catch(() => ''))
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
    // Switched to Desk from the devices menu and back: the whiteboard, as it was, not Home; and the
    // same after a reload.
    await p.locator('.mc-chip').click()
    await p.locator('.mc-menu .mc-item', { hasText: 'Desk' }).click()
    ok(!!(await until(async () => p.url().includes('/m/') && (await p.locator('.mc-chip .mc-name').innerText().catch(() => '')) === 'Desk', 20000)), 'switched to Desk')
    await p.locator('.mc-chip').click()
    await p.locator('.mc-menu .mc-item', { hasText: 'Studio' }).click()
    const onBoard = async () => !p.url().includes('/m/') && /Auth flow v2/.test(await p.locator('.ws-tab.main').innerText().catch(() => '')) && !(await p.locator('.work.maxed .hm').count())
    ok(!!(await until(onBoard, 20000)), 'and back to Studio: the whiteboard is open again, not Home', p.url())
    await p.reload()
    ok(!!(await until(onBoard, 20000)), 'and the same after a reload')
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
    const count = await ey.locator('.ey-head p').innerText()
    ok(/^\d+ things on 2 computers · (1 needs you|(0|[2-9]|\d\d+) need you)$/.test(count), 'under its heading, how many things on how many computers, and how many need you, each said as one or many', count)
    // (Its agents come from the Agent Map's list, which can come a moment after Home's.)
    await until(async () => /Deploy/.test(await ey.locator('.ey-lane').first().innerText()), 10000)
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
    // (Switching computers and reloading cut off what the page was asking, which WebKit reports as an error.)
    ok(errors.filter((e) => !/due to access control checks/.test(e)).length === 0, 'desktop: no page errors', errors)
    await ctx.close()
  }
  // Home that can't load says why, with Try again.
  {
    let fail = true
    const { ctx, p } = await pageAt(b, a.url, { width: 1280, before: async (c2) => { await noServiceWorker(c2); await c2.route(/\/api\/home(\?|$)/, (r) => (fail ? r.fulfill({ status: 500, json: { error: 'the disk is full' } }) : r.fallback())) } })
    const e = p.locator('.hm-err')
    ok(!!(await until(async () => /Home couldn't load: the disk is full/.test(await e.innerText().catch(() => '')), 15000)) && !/needs you/.test(await p.locator('.hm-title h2').innerText()), "Home that can't load says why (and not that nothing needs you)", await p.locator('.hm').innerText().catch(() => ''))
    await shot(p, `${tag}home-cant-load`)
    fail = false
    await e.locator('button', { hasText: 'Try again' }).click()
    ok(!!(await until(async () => !(await p.locator('.hm-err').count()) && /need you|needs you/.test(await p.locator('.hm-title h2').innerText().catch(() => '')), 8000)), 'and Try again brings it')
    await ctx.close()
  }

  // The scenes below look at every computer together, as Home's Device menu can (this computer first
  // is checked above, and on a busy day below).
  const ALL = { 'cc-home-device': 'all' }
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
  seed(c, sync, 'Weekly sync with Parvinder', yday, '# Weekly sync\n\n## Summary\n\nThe AWS paper and the offsite.\n\n## Action items\n\n- [ ] Gary: make the introduction he offered (not done yet)\n- [ ] Them: set up the face-to-face meeting at the offsite\n- [ ] Parvinder: present the AWS paper at the offsite\n')
  await until(async () => (await c.api('/meetings')).meetings?.some((m) => m.id === sync), 8000)
  await c.api(`/meetings/${sync}/chief`, {})
  // A list with copies on it already: before 3.10.1 a second Send added every item again (now it
  // doesn't: meetings-api), so a list from then can have each twice.
  for (const x of (await c.api('/chief/tasks')).items.filter((x) => x.from === 'meeting')) await task(c, x.title)
  // A task naming a date eight days on: after any "by Friday", so the last day under Coming Up.
  const flightsOn = dayFrom(8)
  const flights = `Book flights to the offsite on ${flightsOn.getDate()} ${flightsOn.toLocaleDateString('en-US', { month: 'short' })}`
  for (const [title, status] of [['Send the board deck by Friday'], [flights], ['Call the accountant tomorrow'], ['Look into SOC 2 vendors'], ['Draft the Q1 hiring plan', 'doing'], ['Read the Series A term sheet']]) await task(c, title, status && { status })
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
  // Today's two meetings both still today, whatever the time (late in the evening, 2½ hours on was
  // tomorrow): at a fifth and three fifths of what's left of the day, at most 25 and 150 minutes on.
  // Not in whole minutes: two minutes before midnight, a minute and two minutes on were tomorrow.
  const dayLeft = (new Date(new Date().setHours(24, 0, 0, 0)) - Date.now()) / 6e4
  const firstIn = Math.min(25, dayLeft / 5), nextIn = Math.min(150, dayLeft * 0.6)
  const ev = (id, title, start, mins, more = {}) => ({ id, title, canceled: false, calendar: 'Work', start: start.toISOString(), end: new Date(+start + mins * 6e4).toISOString(), allDay: false, attendees: [], attendeeCount: 3, ...more })
  const tomorrow = clock(10); tomorrow.setDate(tomorrow.getDate() + 1)
  // The one meeting on two calendars starts at the same moment on both (two inMin()s can be a
  // millisecond apart, and then they're two meetings).
  const acme = inMin(firstIn)
  const morningCal = {
    today: [ev('e1', 'Acme renewal sync', acme, 30, { links: [{ url: 'https://example.com/sow', name: 'SOW draft' }] }), ev('e1b', 'Acme renewal sync', acme, 30, { calendar: 'Personal' }), ev('e2', '1:1 with Gary', inMin(nextIn), 30)],
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
  // (Counted from the day it was added, which is today unless the run went past midnight.)
  const addedOf = (title) => `${real?.items.find((i) => i.task?.title === title)?.task.added}T12:00:00`
  ok(dueIn('Call the accountant tomorrow') === ymd(dayFrom(1, Date.parse(addedOf('Call the accountant tomorrow')))) && dueIn(flights) === ymd(flightsOn) && dueIn(gary) === null, 'with the day each names, or none', real?.items.filter((i) => i.kind === 'task').map((i) => [i.task.title, i.task.due]))

  // The heading's count and its ring: everything that needs you, and the share you can answer now.
  const ringOf = (p) => p.locator('.hm-count .hm-ring').evaluate((e) => ({ fill: Number(e.style.getPropertyValue('--p')), said: e.getAttribute('aria-label') }))
  const tip = (p) => p.locator('#hm-count-tip')
  // What the count's details say: how many on each computer (an offline one said), and by kind.
  const tipRight = (x) => /You can answer 6 of 8 now; the rest wait for their computer to be back/.test(x) && /Studio\s*3/.test(x) && /Desk\s*2/.test(x) && /Travel Laptop\s*1/.test(x) && /Lab Mini\s*· offline\s*2/.test(x)
    && /Permissions\s*1/.test(x) && /Questions\s*2/.test(x) && /Failed\s*2/.test(x) && /Chief of Staff tasks\s*3/.test(x)
  const loaded = async (hm) => until(async () => { const x = await hm.innerText().catch(() => ''); return /roadmap/.test(x) && /Board prep/.test(x) && /to do, with no day set/.test(x) && /Waiting on You\s*4/.test(x) }, 20000)
  const said0 = (sub) => said.find((x) => x.startsWith(sub.replace(/…$/, '')))
  // A summary ends at a word: all of a sentence, or whole words and "…".
  const atWord = (sub) => { const s = said0(sub); const body = sub.replace(/…$/, ''); return !!s && body.length < s.length && (sub.endsWith('…') ? /[\s,;:.-]/.test(s[body.length]) : /\s/.test(s[body.length]) && /[.!?]$/.test(body)) }
  {
    const { ctx, p, errors } = await pageAt(b, a.url, { mode: 'light', theme: 'sky', width: 1440, height: 1000, store: ALL, before: morning })
    const hm = p.locator('.hm')
    ok(!!(await loaded(hm)), 'a morning: Home opens with all of it', await hm.innerText().catch(() => ''))
    await p.waitForTimeout(800)
    const whole = await ringOf(p)
    ok(whole.fill === 100 && whole.said === '4 of 4 you can answer now' && /^4 things need you/.test(await hm.locator('.hm-title h2').innerText()), 'with every computer on, the ring is full', whole)
    await shot(p, `${tag}home-morning-1440`)
    const ready = hm.locator('.hm-sec[aria-label="Ready to Look At"]')
    const coming = hm.locator('.hm-sec[aria-label="Coming Up"]')
    const chiefSec = hm.locator('.hm-sec[aria-label="Chief of Staff\'s Tasks"]')
    // Headings that say what's under them, in that order; Coming Up a day at a time, in time order.
    const heads = (await hm.locator('.hm-sec h3').allInnerTexts()).map((x) => x.split('\n')[0].replace(/\d+$/, '').trim())
    ok(heads.join('|') === "Waiting on You|Ready to Look At|Coming Up|Chief of Staff's Tasks", 'a morning: the sections, by name', heads)
    const dayHeads = await coming.locator('h4').allInnerTexts()
    ok(dayHeads[0] === 'TODAY' && dayHeads[1] === 'TOMORROW' && dayHeads.length >= 3 && new RegExp(`\\b${flightsOn.getDate()}\\b`).test(dayHeads.at(-1)), 'Coming Up: today, tomorrow, then each day after, in order', dayHeads)
    // (Today's meetings come with the calendar's answer, which can be a moment behind Home's.)
    const todayText = await until(async () => { const x = await coming.locator('.hm-day').first().innerText(); return /Acme renewal sync/.test(x) && /1:1 with Gary/.test(x) && x }, 8000) || await coming.locator('.hm-day').first().innerText()
    ok(/Acme renewal sync/.test(todayText) && (await coming.locator('.hm-ev-main b').allInnerTexts()).filter((x) => x === 'Acme renewal sync').length === 1 && /1:1 with Gary/.test(todayText) && todayText.indexOf('Acme') < todayText.indexOf('1:1 with Gary'), "today: the meetings left, at their times (the one on two calendars once)", todayText)
    const comingText = await coming.innerText()
    ok(/Call the accountant tomorrow/.test(await coming.locator('.hm-day', { hasText: 'TOMORROW' }).innerText()) && (await coming.locator('.hm-day').last().innerText()).includes(flights) && /Send the board deck by Friday/.test(comingText), 'the tasks that name a day are under that day, as Due', comingText)
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
    ok(!!(await until(async () => await ready.locator('ul.hm-ready').first().locator('.hm-item').count() <= before - 2 && !(await ready.locator(`time[datetime="${extra[0].at}"], time[datetime="${extra[1].at}"]`).count()) && /Cleared 2/.test(await hm.locator('.hm-toast').innerText().catch(() => '')), 15000)), 'Clear read takes them off, and says so', await hm.locator('.hm-toast').innerText().catch(() => ''))
    await fold2.click()
    ok(await ready.locator('ul.hm-ready').nth(1).locator('.hm-item').count() === 14, 'unfolded, the 14 older ones')
    await ready.locator('.hm-clear-old').click()
    ok(/Clear 14\? Each comes back when it has something new/.test(await ready.locator('.hm-sure').innerText().catch(() => '')), 'Clear all asks once more', await ready.innerText())
    await ready.locator('.hm-sure .btn', { hasText: 'Clear' }).click()
    ok(!!(await until(async () => !(await ready.locator('.hm-fold').count()) && /Cleared 14/.test(await hm.locator('.hm-toast').innerText().catch(() => '')), 15000)), 'and they go, all 14', await ready.innerText())
    ok(errors.length === 0, 'a morning: no page errors', errors)
    await p.setViewportSize({ width: 1440, height: 2600 })
    await ctx.close()
  }
  {
    const { ctx, p } = await pageAt(b, a.url, { mode: 'dark', theme: 'midnight', width: 1440, height: 2400, store: ALL, before: morning })
    await loaded(p.locator('.hm'))
    await p.waitForTimeout(800)
    await shot(p, `${tag}home-morning-1440-tall-dark`)
    await ctx.close()
  }
  for (const width of [375, 430]) {
    const { ctx, p, errors } = await pageAt(b, a.url, { phone: true, mode: width === 430 ? 'dark' : 'light', theme: width === 430 ? 'midnight' : 'sky', store: ALL, before: morning })
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

  // ---------- a busy day on four computers ----------
  // Studio and Desk, with "Travel Laptop" (an older Bridge AI: only what needs you) and "Lab Mini"
  // (offline) stood in for, each with questions, permissions, failed runs, tasks waiting, finished
  // work, meeting notes and whiteboards, many with long titles. Home's own answer is swapped for it;
  // pins are the real ones (Studio keeps them).
  const busyDevs = [
    { id: null, name: 'Studio', here: true, online: true },
    { id: deskId, name: 'Desk', online: true, partial: false },
    { id: 'travel-laptop', name: 'Travel Laptop', online: true, partial: true },
    { id: 'lab-mini', name: 'Lab Mini', online: false, partial: false, at: new Date(Date.now() - 90 * 6e4).toISOString() },
  ]
  const on = (id) => { const d = busyDevs.find((x) => x.id === id); return { machine: id, device: d.name, online: d.online } }
  const minAgo = (m) => new Date(Date.now() - m * 6e4).toISOString()
  const busy = []
  const ask = (id, m, type, text, agent, more = {}) => busy.push({ id: `agent:${id}`, nid: id, kind: 'agent', group: 'needs', type, paneId: id.split('@')[0], seq: 1, since: minAgo(m), at: minAgo(m), text, agent: { kind: 'claude', kindLabel: 'Claude Code', ...agent }, ...on(more.machine ?? null), ...more })
  ask('n1@1', 3, 'permission', 'Do you want to proceed?', { title: 'deploy', project: 'site' }, { about: 'npm run deploy -- --prod --all-regions --skip-cache-warmup', answers: [{ n: '1', title: 'Yes' }, { n: '2', title: 'No' }], qid: 'b1' })
  ask('n2@1', 9, 'question', 'Which of the three onboarding layouts should I keep for the first-run screens, now that pairing a phone comes first and the permissions screen moved to the end of the flow?', { title: 'onboarding', project: 'app', branch: 'first-run-layouts' }, { machine: deskId, qid: 'b2' })
  ask('n3@1', 14, 'question', 'Should the preview server use port 5173 or 8080? 5173 is taken by the docs site.', { title: 'preview', project: 'docs', kind: 'codex', kindLabel: 'Codex' }, { machine: 'travel-laptop' })
  ask('n4@1', 40, 'failed', 'npm ERR! code ELIFECYCLE: the build failed in packages/web after the type check found 14 errors in the new settings pages', { title: 'build', project: 'web' }, { machine: 'lab-mini' })
  ask('n5@1', 65, 'failed', 'The tests timed out after 10 minutes.', { title: 'tests', project: 'tests' })
  const btask = (id, m, status, title, more = {}, machine = null) => busy.push({ id: `task:${id}`, kind: 'task', group: status === 'waiting' ? 'needs' : status === 'done' ? 'ready' : 'coming', at: minAgo(m), task: { id, title, status, added: new Date(Date.now() - m * 6e4).toLocaleDateString('en-CA'), due: null, ...more }, chief: null, ...on(machine) })
  btask('w1', 20, 'waiting', 'Send the revised quote for the annual plan to the customer before their budget meeting closes', { needs: 'Which of the two price sheets goes with it: the one with the volume discount, or the one without?' })
  btask('w2', 120, 'waiting', 'Book the venue for the offsite', { needs: 'Which week suits you?' }, deskId)
  btask('w3', 300, 'waiting', 'Choose a logo for the beta landing page', { needs: 'The three options are in the shared folder. Which one?' }, 'lab-mini')
  btask('c1', 30, 'doing', 'Draft the hiring plan for next quarter, with the two roles from the planning meeting and a budget for each')
  btask('c2', 60, 'open', 'Look into compliance vendors and put the three cheapest side by side', {}, deskId)
  btask('c3', 70, 'open', 'Send the board deck by Friday', { due: ymd(dayFrom(1)) })
  btask('c4', 80, 'open', 'Read the term sheet and list the questions for the lawyer', {}, 'travel-laptop')
  btask('c5', 90, 'open', 'Renew the domain and move the DNS to the new provider without losing the mail records', {}, deskId)
  btask('d1', 400, 'done', 'Compare the CRM quotes from the three vendors', { outcome: 'The cheapest is the one we already use; the other two cost twice as much for what we need. Written up in work/crm.md.', done: new Date().toLocaleDateString('en-CA') })
  const finished = [['GIT', 'GIT'], ['roadmap', 'roadmap'], ['relay', 'bridge'], ['a-very-long-agent-name-for-the-settings-rewrite', 'settings-and-preferences-overhaul'], ['site', 'site']]
  const where = [null, deskId, 'travel-laptop', 'lab-mini']
  ;[2, 12, 40, 95, 170, 240, 360, 540, 1300, 1700, 2300, 2900].forEach((m, i) => {
    const [title, project] = finished[i % finished.length]
    busy.push({ id: `agent:r${i}@1`, nid: `r${i}@1`, kind: 'agent', group: 'ready', type: 'review', paneId: `r${i}`, seq: 1, since: minAgo(m), at: minAgo(m), text: said[i % 4].slice(0, 220), pr: i % 3 === 1 ? `https://github.com/acme/${project}/pull/${100 + i}` : null, agent: { title, project, kind: 'claude', kindLabel: 'Claude Code' }, ...on(where[i % 4]) })
  })
  const bmeet = (id, m, title, unsent, machine = null) => busy.push({ id: `meeting:${id}`, kind: 'meeting', group: 'ready', meeting: { id, title, startedAt: minAgo(m + 30), status: 'done', summarizing: false, hasSummary: true }, unsent, at: minAgo(m), ...on(machine) })
  bmeet('bm1', 25, 'Weekly product review: pricing, the onboarding rewrite and what ships in the next release', 3)
  bmeet('bm2', 200, 'Design review: first-run screens', 0, deskId)
  bmeet('bm3', 1500, 'Customer call about the annual renewal and the security questionnaire', 2, 'travel-laptop')
  const bboard = (id, m, title, machine = null, group = 'ready') => busy.push({ id: `board:${id}`, kind: 'board', group, board: { id, title, mtime: Date.now() - m * 6e4, changed: group === 'ready' }, at: minAgo(m), ...on(machine) })
  bboard('bb1', 50, 'Auth flow v2: sign-in, pairing a phone and what happens when the relay is down')
  bboard('bb2', 600, 'Release plan', deskId)
  // A whiteboard you've opened since: not news, so only on Home if you pin it.
  bboard('bb3', 30, 'Org chart', null, null)
  const busyCal = { today: [ev('e1', 'Weekly product review', inMin(firstIn), 30, { links: [{ url: 'https://example.com/agenda', name: 'Agenda' }] })], tomorrow: [], fetchedAt: new Date().toISOString() }
  let failPin = false
  const busyDay = async (c2) => {
    await noServiceWorker(c2)
    await c2.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: busyCal }))
    await changeAnswer(c2, /\/api\/config(\?|$)/, (real) => ({ ...real, calendar: true }))
    await changeAnswer(c2, /\/api\/home(\?|$)/, (real) => ({ ...real, items: busy, devices: busyDevs }))
    await c2.route(/\/api\/home-pins$/, (r) => (failPin ? r.fulfill({ status: 500, json: { error: 'the disk is full' } }) : r.fallback()))
  }
  const busyLoaded = (hm) => until(async () => { const x = await hm.innerText().catch(() => ''); return /Only what needs you, for now/.test(x) && /port 5173/.test(x) && /Weekly product review/.test(x) }, 20000)
  // Every line about the page (a notice, the bar, the sections) starts and ends where the header does.
  const aligned = (p) => p.evaluate(() => {
    const box = (e) => e.getBoundingClientRect()
    const head = box(document.querySelector('.hm-head'))
    const off = []
    for (const e of document.querySelectorAll('.hm-notice, .hm-bar, .hm-grid, .hm-cols, .hm-toast')) {
      const r = box(e)
      if (!r.width) continue
      if (Math.abs(r.left - head.left) > 1 || r.right > head.right + 1) off.push(`${e.className}: ${Math.round(r.left)}..${Math.round(r.right)}, not ${Math.round(head.left)}..${Math.round(head.right)}`)
    }
    return off
  })
  // Cards side by side are the same height, with their buttons along the same line at the bottom.
  const rowsEven = (p) => p.evaluate(() => {
    const bad = []
    for (const g of document.querySelectorAll('.hm-grid')) {
      const rows = new Map()
      for (const c of g.children) { const r = c.getBoundingClientRect(); const k = Math.round(r.top); rows.set(k, [...(rows.get(k) || []), c]) }
      for (const cs of rows.values()) {
        const hs = cs.map((c) => Math.round(c.getBoundingClientRect().height))
        const feet = cs.map((c) => Math.round(c.getBoundingClientRect().bottom - c.querySelector('.ny-acts').getBoundingClientRect().bottom))
        if (new Set(hs).size > 1 || new Set(feet).size > 1) bad.push(`${cs.map((c) => c.getAttribute('aria-label')).join(' | ')}: heights ${hs}, buttons ${feet} from the bottom`)
      }
    }
    return bad
  })
  // Every button on a card or a row says what it is with an icon too (the agent's own answers aside).
  const bare = (p) => p.evaluate(() => [...document.querySelectorAll('.hm .ny-acts .ghost-btn, .hm .hm-quick .ghost-btn, .hm .hm-item-acts .ghost-btn, .hm .hm-pin')].filter((x) => !x.querySelector('svg')).map((x) => x.innerText.trim()))
  for (const [width, mode] of [[1920, 'light'], [1440, 'light'], [1440, 'dark'], [1100, 'light'], [800, 'dark']]) {
    const { ctx, p, errors } = await pageAt(b, a.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', width, height: 1100, store: ALL, before: busyDay })
    const hm = p.locator('.hm')
    ok(!!(await busyLoaded(hm)), `a busy day, ${width} ${mode}: Home opens with all of it`, await hm.innerText().catch(() => ''))
    await p.waitForTimeout(600)
    const note = hm.locator('.hm-partial')
    ok(/Travel Laptop/.test(await note.innerText().catch(() => '')) && await note.locator('.ny-device').count() === 1, `${width}: the computer that sends only what needs you is said once, as its chip`, await note.innerText().catch(() => ''))
    const off = await aligned(p)
    ok(!off.length, `${width}: every notice, the bar and each section line up with the header, inside the column`, off)
    const uneven = await rowsEven(p)
    ok(!uneven.length, `${width}: cards side by side are the same height, their buttons on one line at the bottom`, uneven)
    const noIcon = await bare(p)
    ok(!noIcon.length, `${width}: every button on a card has its icon`, noIcon)
    const head = await hm.locator('.hm-title h2').innerText()
    const ring = await ringOf(p)
    ok(/^8 things need you/.test(head) && /Waiting on You\s*8/.test(await hm.locator('.hm-sec[aria-label="Waiting on You"] h3').innerText()) && ring.fill === 75 && ring.said === '6 of 8 you can answer now', `${width}: the heading counts all 8, as Waiting on You does, its ring three quarters full (6 on computers that are on)`, [head, ring])
    await shot(p, `${tag}home-busy-${width}-${mode}`)
    if (width === 1440) {
      // Pointed at: what's in the count, on each computer and by kind.
      await hm.locator('.hm-count').hover()
      ok(!!(await until(async () => tipRight(await tip(p).innerText().catch(() => '')), 4000)), `${mode}: pointed at, the count says what's in it: on each computer (an offline one said) and by kind`, await tip(p).innerText().catch(() => ''))
      await shot(p, `${tag}home-busy-1440-${mode}-count`)
      await p.mouse.move(5, 600)
      ok(!!(await until(async () => !(await tip(p).count()), 3000)), `${mode}: and away again, it goes`)
    }
    if (width === 1440 && mode === 'light') {
      // By the keyboard too: focused, it says the same; Escape puts it away.
      await hm.locator('.hm-count').focus()
      ok(!!(await until(async () => tipRight(await tip(p).innerText().catch(() => '')), 3000)) && (await hm.locator('.hm-count').getAttribute('aria-describedby')) === 'hm-count-tip', 'focused by the keyboard, the count shows the same, as its description', await tip(p).innerText().catch(() => ''))
      await p.keyboard.press('Escape')
      ok(!!(await until(async () => !(await tip(p).count()), 3000)), 'and Escape puts it away')
      await hm.locator('.hm-count').blur()
      // On a row while it's pointed at: Pin among its buttons.
      const row = hm.locator('.hm-sec[aria-label="Ready to Look At"] .hm-item').filter({ hasText: 'Auth flow v2' })
      await row.hover()
      await p.waitForTimeout(250)
      ok(await row.locator('.hm-quick .hm-pin').isVisible() && /Open/.test(await row.locator('.hm-quick').innerText()), 'a row pointed at has Pin beside Open', await row.locator('.hm-quick').innerText())
      await shot(p, `${tag}home-busy-1440-hover`)
    }
    ok(errors.length === 0, `a busy day, ${width}: no page errors`, errors)
    await ctx.close()
  }
  // The same day as Home starts, this computer first: Studio's three, and a line for each of the
  // others, the older one saying it sends only what needs you, the offline one that it's offline.
  // The top bar's chip counts Studio's, the devices menu's the others' that are on.
  {
    const { ctx, p, errors } = await pageAt(b, a.url, { mode: 'light', theme: 'sky', width: 1440, height: 1400, before: busyDay })
    const hm = p.locator('.hm')
    await until(async () => (await hm.locator('.hm-away-row').count()) === 3, 20000)
    await p.waitForTimeout(600)
    const lines = await hm.locator('.hm-away-line').allInnerTexts()
    ok(/^3 things need you/.test(await hm.locator('.hm-title h2').innerText()) && /Waiting on You\s*3/.test(await hm.locator('.hm-sec[aria-label="Waiting on You"] h3').innerText()) && !/port 5173/.test(await hm.locator('.hm-sec[aria-label="Waiting on You"]').innerText()), "a busy day, this computer first: the heading and Waiting on You count Studio's three", await hm.locator('.hm-title h2').innerText())
    ok(/Desk/.test(lines[0]) && /2 need you/.test(lines[0]) && /Travel Laptop/.test(lines[1]) && /1 needs you/.test(lines[1]) && /Lab Mini/.test(lines[2]) && /offline/.test(lines[2]), 'a line for each other computer, in their order, saying what needs you there', lines)
    ok(/update Bridge AI on it/.test(await hm.locator('.hm-away-row', { hasText: 'Travel Laptop' }).innerText()) && !(await hm.locator('.hm-partial').count()), "the older one's line says it sends only what needs you, and there's no note about it at the top", await hm.locator('.hm-away').innerText())
    ok(!!(await until(async () => /^3\s*need you/.test((await p.locator('.topbar .needs-chip').innerText().catch(() => '')).trim()) && (await p.locator('.mc-chip .mc-needs').innerText().catch(() => '')).trim() === '3', 8000)), "the top bar's chip counts Studio's three, the devices menu's chip the three on the others that are on", [await p.locator('.topbar .needs-chip').innerText().catch(() => ''), await p.locator('.mc-chip').innerText().catch(() => '')])
    await hm.locator('.hm-away-row', { hasText: 'Desk' }).locator('.hm-away-line').click()
    ok(/onboarding layouts/.test(await hm.locator('.hm-away-row', { hasText: 'Desk' }).innerText()), "Desk's line opened: its question, to answer here", await hm.locator('.hm-away-row', { hasText: 'Desk' }).innerText())
    await shot(p, `${tag}home-busy-this-computer`)
    ok(errors.length === 0, 'a busy day, this computer first: no page errors', errors)
    await ctx.close()
  }
  // Sort: what needs you first, newest, oldest, by computer or by kind, kept for next time.
  {
    const { ctx, p, errors } = await pageAt(b, a.url, { mode: 'light', theme: 'sky', width: 1440, height: 1400, store: ALL, before: busyDay })
    const hm = p.locator('.hm')
    await busyLoaded(hm)
    const waiting = hm.locator('.hm-sec[aria-label="Waiting on You"]')
    const cards = () => waiting.locator('.ny-item').evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label')))
    const first = await cards()
    ok(/^Permission/.test(first[0]) && /^Question/.test(first[1]) && /^Failed/.test(first[3]) && /^Chief of Staff task/.test(first.at(-1)) && (await hm.locator('select.hm-sort').inputValue()) === 'needs', 'needs you first, to start with: permissions, questions, failed runs, then the tasks waiting on you', first)
    await hm.locator('select.hm-sort').selectOption('oldest')
    const oldest = await cards()
    ok(/logo for the beta landing page/.test(oldest[0]) && /^Permission/.test(oldest.at(-1)), 'oldest first: what has waited longest leads', oldest)
    const ages = await hm.locator('.hm-sec[aria-label="Ready to Look At"] ul.hm-ready').first().locator('time').evaluateAll((ts) => ts.map((x) => Date.parse(x.getAttribute('datetime'))))
    ok(ages.length > 1 && ages.every((x, i) => i === 0 || ages[i - 1] <= x), 'and what is ready, oldest first too', ages)
    await hm.locator('select.hm-sort').selectOption('device')
    const heads = (await waiting.locator('.hm-ghead').allInnerTexts()).map((x) => x.split(/\s*·|\s*\d+$/)[0].trim())
    ok(heads.join('|') === 'Studio|Desk|Travel Laptop|Lab Mini', 'by computer: a group for each, this one first', heads)
    ok(/offline/.test(await waiting.locator('.hm-ghead', { hasText: 'Lab Mini' }).innerText()), 'an offline one says so', await waiting.locator('.hm-ghead').allInnerTexts())
    await shot(p, `${tag}home-busy-by-computer`)
    await hm.locator('select.hm-sort').selectOption('kind')
    const kinds = (await waiting.locator('.hm-ghead').allInnerTexts()).map((x) => x.replace(/\s*\d+$/, '').trim())
    ok(kinds.join('|') === 'Agents|Chief of Staff', 'by kind: a group for each kind', kinds)
    await p.reload()
    await busyLoaded(p.locator('.hm'))
    ok((await p.locator('select.hm-sort').inputValue()) === 'kind', 'the order picked is kept for next time')
    await p.locator('select.hm-sort').selectOption('needs')
    // (A reload cuts off what the page was asking, which WebKit reports as an error.)
    ok(errors.filter((e) => !/due to access control checks/.test(e)).length === 0, 'sorting: no page errors', errors)
    await ctx.close()
  }
  // Pin: to the top, out of its own section, kept on the computer (it's there after a reload and
  // on a phone); unpinned, back where it was. One that couldn't be saved says why.
  {
    const { ctx, p, errors } = await pageAt(b, a.url, { mode: 'light', theme: 'sky', width: 1440, height: 1400, store: ALL, before: busyDay })
    const hm = p.locator('.hm')
    await busyLoaded(hm)
    const ready = hm.locator('.hm-sec[aria-label="Ready to Look At"]')
    const pinned = hm.locator('.hm-sec[aria-label="Pinned"]')
    ok(!(await pinned.count()), 'nothing pinned: no Pinned section')
    const row = ready.locator('.hm-item').filter({ hasText: 'Weekly product review' })
    await row.hover()
    await row.locator('.hm-quick .hm-pin').click()
    ok(!!(await until(async () => /Weekly product review/.test(await pinned.innerText().catch(() => '')) && !(await row.count()), 8000)), 'pinned: at the top as a card, and out of Ready to Look At', await pinned.innerText().catch(() => ''))
    const heads = (await hm.locator('.hm-sec h3').allInnerTexts()).map((x) => x.split('\n')[0].replace(/\d+$/, '').trim())
    ok(heads[0] === 'Pinned', 'Pinned is the first section', heads)
    const card = pinned.locator('.ny-item', { hasText: 'Weekly product review' })
    ok(/Meeting notes/.test(await card.innerText()) && /3 action items not handed on yet/.test(await card.innerText()) && await card.locator('button', { hasText: 'To Chief of Staff' }).isVisible() && await card.locator('button', { hasText: 'Open' }).isVisible() && (await card.locator('.hm-pin').getAttribute('aria-pressed')) === 'true', 'its card: what it is, its buttons, and a pin that shows it is pinned', await card.innerText())
    ok(!!(await until(async () => (await a.api('/home')).pins?.some((x) => x.id === 'here|meeting:bm1'), 5000)), 'kept on the computer', (await a.api('/home')).pins)
    // A to-do folded away, pinned: out of the fold and at the top.
    await hm.locator('.hm-sec[aria-label="Chief of Staff\'s Tasks"] .hm-fold').click()
    const todoRow = hm.locator('.hm-trow', { hasText: 'Look into compliance vendors' })
    await todoRow.hover()
    await todoRow.locator('.hm-pin').click()
    ok(!!(await until(async () => /Look into compliance vendors/.test(await pinned.innerText()), 6000)), 'a to-do with no day, pinned, is at the top', await pinned.innerText())
    // A question waiting on you, pinned from its card.
    await hm.locator('.hm-sec[aria-label="Waiting on You"] .ny-item', { hasText: 'port 5173' }).locator('.hm-pin').click()
    await a.api('/home-pins', { id: 'here|board:bb3', on: true })
    // (Shown pinned at once, saved a moment later: a reload before then cuts the saving off.)
    await until(async () => { const ids = ((await a.api('/home')).pins || []).map((x) => x.id); return ids.includes(`${deskId}|task:c2`) && ids.includes('travel-laptop|agent:n3@1') }, 5000)
    await p.reload()
    await busyLoaded(p.locator('.hm'))
    const after = await until(async () => { const x = await pinned.innerText().catch(() => ''); return /Org chart/.test(x) && x }, 8000)
    ok(!!after && /Weekly product review/.test(after) && /Look into compliance vendors/.test(after) && /port 5173/.test(after), 'after a reload, still pinned: and a whiteboard you have opened since (not news) stays while pinned', after)
    await shot(p, `${tag}home-busy-pinned`)
    // A pin that can't be saved goes back, and says why.
    failPin = true
    await pinned.locator('.ny-item', { hasText: 'Org chart' }).locator('.hm-pin').click()
    ok(!!(await until(async () => /Couldn't unpin it: the disk is full/.test(await hm.locator('.hm-toast').innerText().catch(() => '')), 6000)) && /Org chart/.test(await pinned.innerText()), "a pin that can't be saved stays as it was, and says why", await hm.locator('.hm-toast').innerText().catch(() => ''))
    failPin = false
    // Unpinned: back where it was.
    await pinned.locator('.ny-item', { hasText: 'Weekly product review' }).locator('.hm-pin').click()
    ok(!!(await until(async () => !/Weekly product review/.test(await pinned.innerText().catch(() => '')) && await row.count() === 1, 8000)), 'unpinned: back in Ready to Look At', await ready.innerText())
    // (A reload cuts off what the page was asking, which WebKit reports as an error.)
    ok(errors.filter((e) => !/due to access control checks/.test(e)).length === 0, 'pins: no page errors', errors)
    await ctx.close()
  }
  {
    const { ctx, p } = await pageAt(b, a.url, { mode: 'dark', theme: 'midnight', width: 1440, height: 2400, store: ALL, before: busyDay })
    await busyLoaded(p.locator('.hm'))
    await p.waitForTimeout(600)
    await shot(p, `${tag}home-busy-pinned-tall-dark`)
    await ctx.close()
  }
  for (const width of [375, 430]) {
    const { ctx, p, errors } = await pageAt(b, a.url, { phone: true, mode: width === 430 ? 'dark' : 'light', theme: width === 430 ? 'midnight' : 'sky', store: ALL, before: busyDay })
    await p.setViewportSize({ width, height: 860 })
    const hm = p.locator('.hm')
    ok(!!(await busyLoaded(hm)), `a busy day, phone ${width}: all of it`)
    await p.waitForTimeout(600)
    ok(/Pinned/.test(await hm.locator('.hm-sec h3').first().innerText()), `phone ${width}: what was pinned on the computer is pinned here too`)
    const off = await aligned(p)
    ok(!off.length, `phone ${width}: every notice and section lines up with the header`, off)
    await shot(p, `${tag}home-busy-phone-${width}`)
    await hm.locator('.hm-sec[aria-label="Chief of Staff\'s Tasks"] .hm-fold').click()
    const f = await phoneFaults(p, '.hm')
    // A tap on the count shows what's in it; a tap elsewhere puts it away.
    await hm.locator('.hm-title').evaluate((e) => e.scrollIntoView({ block: 'start' }))
    await hm.locator('.hm-count').tap()
    ok(!!(await until(async () => tipRight(await tip(p).innerText().catch(() => '')), 4000)) && (await ringOf(p)).fill === 75, `phone ${width}: a tap on the count shows what's in it`, await tip(p).innerText().catch(() => ''))
    await shot(p, `${tag}home-busy-phone-${width}-count`)
    await hm.locator('.hm-sec[aria-label="Waiting on You"] h3').tap()
    ok(!!(await until(async () => !(await tip(p).count()), 3000)), `phone ${width}: and a tap elsewhere puts it away`)
    ok(!Object.keys(f).length, `a busy day, phone ${width}: it fits (nothing wider, past its edge or cut off; every control, the pins too, a whole 40 px target)`, f)
    await p.setViewportSize({ width, height: 5200 })
    await p.waitForTimeout(400)
    await shot(p, `${tag}home-busy-phone-${width}-tall`)
    ok(errors.length === 0, `a busy day, phone ${width}: no page errors`, errors)
    await ctx.close()
  }
  for (const id of ['here|meeting:bm1', `${deskId}|task:c2`, 'travel-laptop|agent:n3@1', 'here|board:bb3']) await a.api('/home-pins', { id, on: false })

  // ---------- what needs you now, and what has gone quiet ----------
  // A mixed-age day on Studio and Desk, by the test's clock: waits of minutes, an hour and days, a
  // question in a project you were in 50 minutes ago, ones in projects nobody has touched for a week,
  // a task you replied to 20 minutes ago and tasks untouched for days. Home's and the inbox's answers
  // are swapped for it (each item with when you or it were last on it, as its computer says).
  const mAgo = (m) => new Date(Date.now() - m * 6e4).toISOString()
  const dAgo = (d) => mAgo(d * 1440)
  const newest = (...vs) => new Date(Math.max(...vs.filter(Boolean).map((v) => Date.parse(v)))).toISOString()
  const mixDevs = [{ id: null, name: 'Studio', here: true, online: true }, { id: deskId, name: 'Desk', online: true, partial: false }]
  const waitOf = (id, type, since, agentOf, seen = {}, more = {}) => {
    const machine = more.machine ?? null
    return { id, paneId: id.split('@')[0], seq: 1, type, since, seen, active: newest(since, seen.you, seen.project), text: more.text || `About ${agentOf.project || agentOf.title}?`, agent: { kind: 'claude', kindLabel: 'Claude Code', chief: false, ...agentOf }, machine, device: machine ? 'Desk' : 'Studio', online: true, ...(type === 'permission' ? { about: more.about || 'npm run deploy', qid: `q-${id}`, answers: [{ n: '1', title: 'Yes' }, { n: '3', title: 'No' }] } : {}), ...more }
  }
  const mixNeeds = [
    waitOf('m1@1', 'permission', mAgo(3), { title: 'deploy', project: 'shop' }, {}, { about: 'npm run deploy -- --prod' }),
    waitOf('m2@1', 'question', dAgo(1.5), { title: 'billing', project: 'billing-api' }, { project: mAgo(50) }, { text: 'Round the totals per line or per invoice?' }),
    waitOf('m3@1', 'failed', mAgo(40), { title: 'web', project: 'web' }, {}, { text: 'npm ERR! the build failed in packages/web' }),
    waitOf('m4@1', 'question', mAgo(25), { title: 'Chief of Staff · Launch', project: null, chief: true }, {}, { text: 'Send the release notes to the testers now?' }),
    waitOf('m5@1', 'permission', dAgo(4.2), { title: 'prototype', project: 'old-prototype' }, { you: dAgo(8), project: dAgo(8) }, { about: 'rm -rf build && npm run bundle' }),
    waitOf('m6@1', 'failed', dAgo(5), { title: 'infra', project: 'infra' }, {}, { text: 'terraform apply failed: the state lock is held' }),
    waitOf('m7@1', 'question', dAgo(3.5), { title: 'docs', project: 'docs-site' }, {}, { text: 'Keep the old URLs as redirects?' }),
    waitOf('m8@1', 'permission', mAgo(10), { title: 'onboarding', project: 'app' }, {}, { machine: deskId, about: 'npm run migrate' }),
    waitOf('m9@1', 'failed', dAgo(3.4), { title: 'tests', project: 'api' }, {}, { machine: deskId, text: 'The tests timed out after 10 minutes.' }),
    waitOf('m10@1', 'review', mAgo(15), { title: 'copy', project: 'site' }, {}, { text: 'Done: the pricing page copy is in.' }),
  ]
  const mixTask = (id, title, needs, changed, replied = null, machine = null) => ({ id: `task:${id}`, kind: 'task', group: 'needs', at: changed, since: changed, seen: { changed, replied }, active: newest(changed, replied), task: { id, title, status: 'waiting', needs, added: ymd(new Date(Date.parse(changed))), changed, due: null }, chief: null, machine, device: machine ? 'Desk' : 'Studio', online: true })
  const mixHome = [
    ...mixNeeds.map((i) => ({ ...i, id: `agent:${i.id}`, nid: i.id, kind: 'agent', group: i.type === 'review' ? 'ready' : 'needs', at: i.since })),
    mixTask('41', 'Send Priya the revised quote', 'Which of the two price sheets goes with it?', mAgo(180), mAgo(20)),
    mixTask('42', 'Draft the Q1 budget', 'Which of the two headcount plans?', mAgo(20 * 60)),
    mixTask('37', 'Book flights for the offsite', 'Which dates work for you?', dAgo(4)),
    mixTask('33', 'Renew the design tool licences', 'Keep all six seats, or drop to four?', dAgo(6)),
    mixTask('12', 'Choose a logo for the beta page', 'Which of the three?', dAgo(5), null, deskId),
  ]
  const cleared = []
  const mixDay = async (c2) => {
    await noServiceWorker(c2)
    await c2.route(/\/api\/calendar(\?|$)/, (r) => r.fulfill({ json: { today: [], tomorrow: [], fetchedAt: new Date().toISOString() } }))
    await changeAnswer(c2, /\/api\/home(\?|$)/, (real) => ({ ...real, items: mixHome.filter((i) => !cleared.includes(i.nid)), devices: mixDevs, pins: [] }))
    await c2.route(/\/api\/needs-you(\?|$)/, (r) => r.fulfill({ json: { items: mixNeeds.filter((i) => !cleared.includes(i.id)), devices: mixDevs.map(({ id, name, online }) => ({ id, name, online })) } }))
    await c2.route(/\/api\/needs-you\/clear$/, (r) => { cleared.push(r.request().postDataJSON()?.id); return r.fulfill({ json: { ok: true } }) })
  }
  const mixLoaded = (hm) => until(async () => /Send Priya/.test(await hm.innerText().catch(() => '')) && /Quiet for 3\+ days/.test(await hm.innerText().catch(() => '')), 20000)
  const labels = (loc) => loc.evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label')))
  for (const [mode, theme] of [['light', 'sky'], ['dark', 'midnight']]) {
    const { ctx, p, errors } = await pageAt(b, a.url, { mode, theme, width: 1440, height: 1300, before: mixDay })
    const hm = p.locator('.hm')
    ok(!!(await mixLoaded(hm)), `a mixed-age day, ${mode}: Home opens with it`, await hm.innerText().catch(() => ''))
    await p.waitForTimeout(800)
    const waiting = hm.locator('.hm-sec[aria-label="Waiting on You"]')
    const order = await labels(waiting.locator('.hm-grid > .ny-item'))
    if (mode === 'light') {
      // What needs you now, on Studio: six, and the five gone quiet only where they're folded.
      ok(/^6 things need you/.test(await hm.locator('.hm-title h2').innerText()) && /Waiting on You\s*6/.test(await waiting.locator('h3').innerText()), 'the heading and Waiting on You count the six that need you now, not the five quiet for days', [await hm.locator('.hm-title h2').innerText(), await waiting.locator('h3').innerText()])
      ok(order.join('|') === 'Permission: deploy|Question: Chief of Staff · Launch|Question: billing|Failed: web|Chief of Staff task: Send Priya the revised quote|Chief of Staff task: Draft the Q1 budget', 'in order: what stops an agent and is fresh first (a permission just asked, a question 25 min old, one a day and a half old in a project you were in 50 min ago), then the run that failed 40 min ago, the task you replied to, the one from yesterday', order)
      const tops = await labels(waiting.locator('.ny-item.top'))
      const whys = await waiting.locator('.ny-item.top .ny-why').allInnerTexts()
      ok(tops.length === 3 && tops.join('|') === order.slice(0, 3).join('|') && whys.every((x) => /Blocking/.test(x)) && /You were in billing-api 5\d min ago/.test(whys[2]) && /New/.test(whys[0]), 'the first three set apart, each with why: blocking, new, you were in its project 50 min ago', whys)
      ok(/3 h ago/.test(await waiting.locator('.hm-task', { hasText: 'Send Priya' }).locator('.ny-age').innerText()), "a task that waits on you says since when", await waiting.locator('.hm-task', { hasText: 'Send Priya' }).innerText())
      // Where it's folded, the quiet count, quietly: not in the chip, the badges or the title.
      const fold = waiting.locator('.ny-fold')
      ok(/Quiet for 3\+ days\s*5/.test(await fold.innerText()) && (await fold.getAttribute('aria-expanded')) === 'false' && !(await waiting.locator('.ny-qrow').count()) && /not counted/.test(await waiting.locator('.ny-qhint').innerText()), 'the five quiet for 3 days or more: folded under it, with how many, said to be not counted', await waiting.locator('.ny-quiet').innerText())
      ok(!!(await until(async () => /^6\s*need you/.test((await p.locator('.topbar .needs-chip').innerText()).trim()) && (await p.locator('.rail-home .mc-needs').innerText()).trim() === '6' && (await p.locator('.mc-chip .mc-needs').innerText().catch(() => '')).trim() === '1' && /^\(7\) Bridge AI/.test(await p.title()), 8000)), "the top bar's chip and the sidebar's Home count the six, the devices menu's chip Desk's one, the window's title (and so the Dock's badge) the seven", [await p.locator('.topbar .needs-chip').innerText(), await p.locator('.rail-home').innerText(), await p.locator('.mc-chip').innerText().catch(() => ''), await p.title()])
      const desk = hm.locator('.hm-away-row', { hasText: 'Desk' })
      ok(/1 needs you · 2 quiet/.test(await desk.innerText()), "Desk's line: one needs you, two quiet", await desk.innerText())
      await hm.locator('.hm-count').hover()
      ok(!!(await until(async () => /5 more have been quiet for 3\+ days/.test(await p.locator('#hm-count-tip').innerText().catch(() => '')), 4000)), "pointed at, the count says how many more have gone quiet and where they are", await p.locator('#hm-count-tip').innerText().catch(() => ''))
      await p.mouse.move(5, 900)
      await shot(p, `${tag}home-mixed-1440-light`)
      // Unfolded: by project, the most recent first; a row opens to its card, to answer or clear.
      await fold.click()
      const groups = await waiting.locator('.ny-qgroup h4').evaluateAll((hs) => hs.map((h) => `${[...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()} ${h.querySelector('.fcount')?.textContent}`))
      ok(groups.join('|') === 'docs-site 1|old-prototype 1|infra 1|Chief of Staff 2', 'unfolded: under each project, Chief of Staff\'s together', groups)
      const proto = waiting.locator('.ny-qrow', { hasText: 'prototype' })
      await proto.locator('.ny-qmain').click()
      const card = proto.locator('.ny-item')
      ok(await card.isVisible() && /rm -rf build/.test(await card.innerText()) && await card.locator('button', { hasText: /^Yes$/ }).isVisible() && await card.locator('button', { hasText: 'Clear' }).isVisible(), 'a quiet row opens to its card: still there to answer, or to clear', await card.innerText().catch(() => ''))
      await shot(p, `${tag}home-mixed-1440-quiet-open`, { fullPage: true })
      await card.locator('button', { hasText: 'Clear' }).click()
      ok(!!(await until(async () => cleared.includes('m5@1') && !(await waiting.locator('.ny-qrow', { hasText: 'prototype' }).count()) && /Quiet for 3\+ days\s*4/.test(await fold.innerText()), 8000)) && /^6 things need you/.test(await hm.locator('.hm-title h2').innerText()), 'Clear takes it off its computer\'s list; four quiet, still six that need you', await waiting.locator('.ny-quiet').innerText())
      // Clear all, asked once more, takes the agents' (the tasks are Chief of Staff's to change).
      await waiting.locator('.ny-qclear').click()
      ok(/Clear 2\? Each comes back when it has something new/.test(await waiting.locator('.ny-qsure').innerText()), 'Clear all asks once more, for the two agents\' it can', await waiting.locator('.ny-qhead').innerText())
      await waiting.locator('.ny-qsure button', { hasText: 'Cancel' }).click()
      // The inbox (⌘K's Needs you) says the same: what needs you now ranked, the quiet ones folded.
      await p.keyboard.press('ControlOrMeta+K')
      await p.locator('.palette input').fill('Needs you')
      await p.locator('.pal-item[data-id="a:needs"]').click()
      const panel = p.locator('.ny-panel')
      await panel.waitFor({ timeout: 8000 })
      // (The inbox asks again as it opens: the one cleared on Home is gone from it then.)
      await until(async () => /Quiet for 3\+ days\s*3/.test(await panel.innerText()), 8000)
      const inbox = await labels(panel.locator('.ny-group').first().locator('.ny-item'))
      ok(inbox.join('|') === 'Permission: deploy|Permission: onboarding|Question: Chief of Staff · Launch|Question: billing|Failed: web' && (await panel.locator('.ny-count').innerText()) === '4' && /Quiet for 3\+ days\s*3/.test(await panel.locator('.ny-fold').innerText()), "the inbox: the same order across both computers, four asking now in its count, the three agents' gone quiet folded", [inbox, await panel.locator('.ny-head').innerText(), await panel.locator('.ny-fold').innerText()])
      ok(/Yes to all 2/.test(await panel.locator('.ny-batch').innerText()), 'Yes to all is for the two asking now, never the one quiet for days', await panel.locator('.ny-batch').innerText())
      await panel.locator('.ny-fold').click()
      await panel.locator('.ny-quiet').evaluate((e) => e.scrollIntoView({ block: 'start' }))
      await shot(p, `${tag}home-mixed-inbox-1440`)
      await p.keyboard.press('Escape')
      // Everything has the quiet ones too, said to be quiet.
      await hm.locator('.hm-every').click()
      const ey = p.locator('.ey')
      await until(async () => (await ey.locator('.ey-quiet').count()) > 0, 10000)
      ok((await ey.locator('.ey-item.needs .ey-quiet').count()) === 0 && (await ey.locator('.ey-quiet').count()) >= 4, 'Everything lists the quiet ones too, said to be quiet and not marked as needing you', await ey.locator('.ey-quiet').count())
    } else {
      await shot(p, `${tag}home-mixed-1440-dark`)
      await waiting.locator('.ny-fold').click()
      await waiting.locator('.ny-qrow', { hasText: 'Book flights' }).locator('.ny-qmain').click()
      ok(/Which dates work for you/.test(await waiting.locator('.ny-qrow', { hasText: 'Book flights' }).locator('.hm-task').innerText().catch(() => '')), "dark: a quiet task opens to its card, Reply and Open", await waiting.locator('.ny-quiet').innerText())
      await shot(p, `${tag}home-mixed-1440-dark-quiet-open`, { fullPage: true })
    }
    ok(errors.length === 0, `a mixed-age day, ${mode}: no page errors`, errors)
    await ctx.close()
  }
  for (const width of [390, 430]) {
    const { ctx, p, errors } = await pageAt(b, a.url, { phone: true, mode: width === 430 ? 'dark' : 'light', theme: width === 430 ? 'midnight' : 'sky', before: mixDay })
    await p.setViewportSize({ width, height: 860 })
    const hm = p.locator('.hm')
    ok(!!(await mixLoaded(hm)), `a mixed-age day, phone ${width}: Home opens with it`)
    await p.waitForTimeout(800)
    const tab = (await p.locator('.tabbar button', { hasText: 'Home' }).locator('.badge').innerText().catch(() => '')).trim()
    ok(tab === '6' && /^6 things need you/.test(await hm.locator('.hm-title h2').innerText()) && /^6$/.test((await p.locator('.top-right .needs-chip').innerText()).trim().split(/\s/)[0]), `phone ${width}: the Home tab, the heading and the chip count the six`, [tab, await hm.locator('.hm-title h2').innerText()])
    await shot(p, `${tag}home-mixed-phone-${width}`)
    const waiting = hm.locator('.hm-sec[aria-label="Waiting on You"]')
    await waiting.locator('.ny-fold').click()
    await waiting.locator('.ny-qrow', { hasText: 'docs' }).locator('.ny-qmain').click()
    await p.waitForTimeout(400)
    const f = await phoneFaults(p, '.hm')
    ok(!Object.keys(f).length, `phone ${width}: the quiet ones unfolded and one opened fit (every control a whole 40 px target)`, f)
    await waiting.locator('.ny-quiet').evaluate((e) => e.scrollIntoView({ block: 'start' }))
    await p.waitForTimeout(300)
    await shot(p, `${tag}home-mixed-phone-${width}-quiet`)
    ok(errors.length === 0, `a mixed-age day, phone ${width}: no page errors`, errors)
    await ctx.close()
  }

  // Nothing at all, and while it loads: each part says so, none is a blank. Then a list it had, and
  // a look that fails: it says it couldn't update and keeps what it had.
  {
    let hold = true
    let fail = false
    const empty = { items: [], devices: [{ id: null, name: 'Studio', online: true, here: true }] }
    const { ctx, p, errors } = await pageAt(b, a.url, {
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
    ok((await p.locator('.hm-title h2').innerText()) === 'Home' && !/computer/.test(await p.locator('.hm-title p').innerText()), "and doesn't guess: no count, no computers, until the list comes", await p.locator('.hm-title').innerText())
    await shot(p, `${tag}home-loading`)
    hold = false
    const text = await until(async () => { const x = await hm.innerText(); return /Nothing new to look at/.test(x) && x }, 10000)
    ok(!(await hm.locator('.hm-sort').count()), 'nothing at all: nothing to sort, so no order to pick')
    ok(!!text && /Nothing needs you right now/.test(text) && /Finished work, meeting notes and whiteboards an agent changed show here/.test(text) && /Nothing on your calendar for the rest of today or tomorrow, and no task with a day/.test(text) && /Nothing on Chief of Staff's list/.test(text), 'nothing at all: each part says there is nothing, and what would show there', text)
    await shot(p, `${tag}home-empty`)
    fail = true
    ok(!!(await until(async () => /Home couldn't update: the disk is full\. This is what it had last/.test(await hm.innerText()) && /Nothing new to look at/.test(await hm.innerText()), 12000)), "a look that fails: it says it couldn't update, and keeps what it had", await hm.innerText())
    ok(errors.length === 0, 'empty and failing: no page errors', errors)
    await ctx.close()
  }

  // ---------- on a phone ----------
  for (const width of [375, 430]) {
    const { ctx, p, errors } = await pageAt(b, a.url, { phone: true, mode: width === 430 ? 'dark' : 'light', theme: width === 430 ? 'midnight' : 'sky', before: desk })
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
    const { ctx, p } = await pageAt(b, a.url, { width: 1280 })
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
