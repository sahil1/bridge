// Routines, and with Scheduled Routines on (a beta feature) their schedules, their runs and Command
// History, without a browser (routines-ui has the app).
//   Schedules (shared/schedule.js): what's said in plain words read into a schedule (every weekday
//   at 9, mondays and thursdays at 2pm, every other tuesday, every month on day 1, the last day,
//   weekends, noon, 8.30, "9 a.m."), said back the same way and read again the same, refused saying
//   why (every hour, a time alone, 25:00, words it doesn't follow), the next runs at the same time
//   of day across a clock change (New York in November, London in March), every n weeks counted
//   from its first run, a 31st in a short month on its last day.
//   The scheduler (server/routines.js, in this process with a clock of the test's own): a routine
//   runs once at its time and not again, a weekday one not on a Saturday, one whose time came while
//   Bridge AI wasn't running runs when it's back up to 12 hours late (saying so), later than that is
//   written down as missed (and told), paused it doesn't run and resumed it doesn't catch up, a time
//   earlier today than it was made isn't run, one whose last run is still working is skipped saying
//   why, one that can't start says why, with Scheduled Routines off its times are written down as
//   skipped; each run followed to its end with what its agent said last, or closed before it was.
//   Command History's suggestions (server/cmdhistory.js, the same way): the same request (give or
//   take a few words) on 4 weekdays about 9 suggested for every weekday at 9:00 in its folder, the
//   Chief of Staff's on 3 Mondays at 4 for every Monday, a daily one over a weekend for every day;
//   none for "yes", for one asked five times in a day, at times hours apart, a pattern that stopped,
//   or one that's a routine already; one dismissed never again. Kept 30 days, the rest taken off the
//   disk; deleted from the disk; with the history off, nothing kept.
//   A server, with a stand-in Claude Code: routines as before with the beta feature off (an older
//   routines.json listed and run, no schedule taken, Command History's routes not there, nothing
//   kept); on, a routine made with a schedule (its next runs, what it says), one refused; what's
//   typed in the app's boxes kept (a message, a new agent's first one, a task, an answer queued for
//   a busy agent with a file attached) and what agents send each other not; search, delete, off,
//   Delete all; a suggestion over the route, dismissed for good (after a restart too); the Chief of
//   Staff's routine run by hand, started and queued for it. Then a server whose clock is a few
//   seconds before a routine's time: it starts by itself (its agent in its space, typed its
//   command, followed to "Done with turn 1."), once, after a restart too; a late one runs and says
//   how late, a missed one says so, a paused one doesn't, and one whose folder is gone says why.
//   BRIDGE_TEST_CLOCK runs the servers and the scheduler from then.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startKit, checks, until, sleep, testClock, OUT, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('routines')
const clock = testClock()
const RealDate = Date
const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
let kitA = null
let kitB = null
// The stand-in Claude Code on a kit's PATH before its server starts (as the kit's program() puts it
// there after), for a routine that runs as soon as it's up.
const standIn = (bin) => {
  const js = path.join(bin, 'claude.cjs')
  fs.writeFileSync(js, fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'claude.cmd'), `@"${process.execPath}" "${js}" %*\r\n`)
  else fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 })
}
// The fleet is watched (and so routines followed) while something listens to the live feed.
const listen = (url) => { const c = new AbortController(); fetch(`${url}/api/events`, { signal: c.signal }).then((r) => r.body.getReader()).then(async (rd) => { for (;;) { const { done: end } = await rd.read(); if (end) break } }).catch(() => {}); return () => c.abort() }

try {
  // ---------- Schedules ----------
  const S = await import('../../shared/schedule.js')
  const sat = new RealDate(2026, 10, 7, 14, 0) // Saturday 7 November 2026, 2 pm
  const read = (s) => S.parse(s, sat).when
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const cases = [
    ['every weekday at 9', { every: 'weekday', at: '09:00' }],
    ['weekdays at 9:30am', { every: 'weekday', at: '09:30' }],
    ['mon-fri at 9', { every: 'weekday', at: '09:00' }],
    ['every weekday at 9 a.m.', { every: 'weekday', at: '09:00' }],
    ['every day at 18:30', { every: 'day', at: '18:30' }],
    ['9am every day', { every: 'day', at: '09:00' }],
    ['every morning', { every: 'day', at: '09:00' }],
    ['mondays and thursdays at 2pm', { every: 'week', at: '14:00', days: [1, 4] }],
    ['every monday morning at 8.30', { every: 'week', at: '08:30', days: [1] }],
    ['every other tuesday', { every: '2w', at: '09:00', days: [2] }],
    ['every 3 days at 8', { every: '3d', at: '08:00' }],
    ['every month on day 1 at 8', { every: 'month', at: '08:00', date: 1 }],
    ['the 15th of every month at noon', { every: 'month', at: '12:00', date: 15 }],
    ['last day of the month at 17:00', { every: 'month', at: '17:00', date: -1 }],
    ['weekends at 10', { every: 'week', at: '10:00', days: [6, 0] }],
    ['weekly', { every: 'week', at: '09:00', days: [6] }],
  ]
  const wrong = cases.filter(([s, want]) => !same(read(s), want))
  ok(!wrong.length, 'plain words read into the schedule they say', wrong.map(([s]) => [s, read(s)]))
  const back = cases.filter(([s]) => !same(S.parse(S.toText(read(s)), sat).when, read(s)))
  ok(!back.length, 'each said back in words that read the same again', back.map(([s]) => S.toText(read(s))))
  ok(S.parse('daily', sat).assumed === 'time', 'no time given: 9:00, and it says so')
  ok(S.sentence(read('every weekday at 9')) === 'Every weekday at 9:00 AM' && S.sentence(read('mondays and thursdays at 2pm')) === 'Every Monday and Thursday at 2:00 PM' && S.sentence(read('every month on day 1 at 8')) === 'Every month on day 1 at 8:00 AM', 'what it means, in a sentence', [S.sentence(read('every weekday at 9')), S.sentence(read('mondays and thursdays at 2pm'))])
  const refused = ['every hour', 'at 9', 'every day at 25:00', 'every tuesday except holidays', 'every day on monday', ''].map((s) => [s, S.parse(s, sat).error])
  ok(refused.every(([, e]) => e), 'what it can\'t run is refused saying why', refused)
  ok(/once a day at most/.test(refused[0][1]) && /how often/.test(refused[1][1]) && /except holidays/.test(refused[3][1]), 'and the why fits: once a day at most, how often, the words it didn\'t follow', refused)
  const nextOf = (s, from, n = 3) => S.next(read(s), { from, since: from, n })
  const fmt = (ds) => ds.map((d) => `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`)
  ok(same(fmt(nextOf('every weekday at 9', sat)), ['11/9 09:00', '11/10 09:00', '11/11 09:00']), 'a weekday one from a Saturday: Monday, Tuesday, Wednesday', fmt(nextOf('every weekday at 9', sat)))
  ok(same(fmt(nextOf('every 2 weeks on monday at 9', sat)), ['11/9 09:00', '11/23 09:00', '12/7 09:00']), 'every 2 weeks counts from its first run', fmt(nextOf('every 2 weeks on monday at 9', sat)))
  ok(same(fmt(S.next(read('every month on day 31 at 9'), { from: new RealDate(2027, 0, 31, 10), n: 3 })), ['2/28 09:00', '3/31 09:00', '4/30 09:00']), 'a 31st in a shorter month: its last day', fmt(S.next(read('every month on day 31 at 9'), { from: new RealDate(2027, 0, 31, 10), n: 3 })))
  const tz = process.env.TZ
  process.env.TZ = 'America/New_York'
  const ny = S.next(S.parse('every day at 9').when, { from: new Date(2026, 9, 30, 12), n: 4 }).map((d) => [d.getDate(), hhmm(d)])
  process.env.TZ = 'Europe/London'
  const ldn = S.next(S.parse('every day at 9').when, { from: new Date(2026, 2, 27, 12), n: 4 }).map((d) => [d.getDate(), hhmm(d)])
  if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz
  ok(same(ny, [[31, '09:00'], [1, '09:00'], [2, '09:00'], [3, '09:00']]) && same(ldn, [[28, '09:00'], [29, '09:00'], [30, '09:00'], [31, '09:00']]), '9:00 stays 9:00 across a clock change (New York in November, London in March)', { ny, ldn })

  // ---------- The scheduler, in this process ----------
  const home = path.join(OUT, 'routines-unit')
  fs.rmSync(home, { recursive: true, force: true })
  fs.mkdirSync(path.join(home, 'project'), { recursive: true })
  process.env.BRIDGE_HOME = home
  const R = await import('../../server/routines.js')
  const H = await import('../../server/cmdhistory.js')
  // A clock of the test's own: Date and Date.now say what it's set to.
  let nowMs = RealDate.now()
  class TestDate extends RealDate { constructor(...a) { super(...(a.length ? a : [nowMs])) } static now() { return nowMs } }
  const setNow = (y, mo, d, h = 0, mi = 0, s = 0) => { nowMs = new RealDate(y, mo - 1, d, h, mi, s).getTime() }
  globalThis.Date = TestDate
  try {
    R.scheduling(true)
    const started = []
    const told = []
    let alive = () => null
    let failing = null
    const tick = (o = {}) => R.tick({ start: async (def) => { if (failing) throw new Error(failing); started.push(def.id); return { paneId: `p${started.length}` } }, live: (id) => alive(id), told: (def, run) => told.push([def.id, run]), ...o })
    const runsOf = (id) => JSON.parse(fs.readFileSync(path.join(home, 'cache', 'routines-log.json'), 'utf8'))[id]?.runs || []
    setNow(2026, 11, 9, 8, 0) // Monday 9 November, 8:00
    const d = await R.add({ name: 'Standup notes', command: 'Write my standup notes', cwd: path.join(home, 'project'), schedule: 'every weekday at 9' })
    ok(d.every === 'weekday' && d.at === '09:00' && d.auto === true && d.since === new Date().toISOString(), 'a routine saved with its schedule, running by itself, from now', d)
    setNow(2026, 11, 9, 8, 59, 30); await tick()
    ok(!started.length, 'not before its time')
    setNow(2026, 11, 9, 9, 0, 10); await tick()
    setNow(2026, 11, 9, 9, 5); await tick()
    ok(started.length === 1 && runsOf(d.id)[0]?.how === 'auto' && runsOf(d.id)[0]?.paneId === 'p1', 'at 9:00 it runs, by itself, once', { started, runs: runsOf(d.id) })
    setNow(2026, 11, 10, 13, 30); await tick()
    const late = runsOf(d.id)[0]
    ok(started.length === 2 && late.how === 'late' && late.slot === new Date(2026, 10, 10, 9).toISOString(), 'Bridge AI back at 13:30: Tuesday\'s 9:00 runs then, saying it\'s late', late)
    setNow(2026, 11, 12, 22, 0); await tick()
    const missed = runsOf(d.id)[0]
    ok(started.length === 2 && missed.missed && /wasn't running/.test(missed.why) && told.some(([id, r]) => id === d.id && r.missed), 'back at 22:00 Thursday, 13 hours after its time: written down as missed, and told', missed)
    let l = (await R.list(true)).routines.find((r) => r.id === d.id)
    ok(l.state === 'missed' && /^Missed Thu/.test(l.note) && l.next.length === 3 && new Date(l.next[0]).getDate() === 13 && l.says === 'Every weekday at 9:00 AM', 'listed as missed, with its next runs and what it says', l)
    setNow(2026, 11, 14, 9, 1); await tick() // Saturday
    ok(started.length === 2, 'a weekday one doesn\'t run on a Saturday')
    R.update(d.id, { paused: true })
    setNow(2026, 11, 16, 9, 0, 5); await tick()
    l = (await R.list(true)).routines.find((r) => r.id === d.id)
    ok(started.length === 2 && l.state === 'paused', 'paused: Monday\'s doesn\'t run, and it says it\'s paused', l.state)
    setNow(2026, 11, 16, 11, 0); R.update(d.id, { paused: false }); await tick()
    ok(started.length === 2, 'resumed at 11:00: what came while paused isn\'t run all at once')
    setNow(2026, 11, 17, 9, 0, 5); await tick()
    ok(started.length === 3, 'and the next day\'s runs')
    alive = (id) => (id === 'p3' ? { paneId: id, status: 'working' } : null)
    setNow(2026, 11, 18, 9, 0, 5); await tick()
    ok(started.length === 3 && runsOf(d.id)[0].skipped && /still working/.test(runsOf(d.id)[0].why), 'its last run still working: this one is left out, saying why', runsOf(d.id)[0])
    alive = () => null
    failing = 'Claude Code isn\'t installed'
    setNow(2026, 11, 19, 9, 0, 5); await tick()
    failing = null
    l = (await R.list(true)).routines.find((r) => r.id === d.id)
    ok(runsOf(d.id)[0].error === 'Claude Code isn\'t installed' && l.state === 'error' && /^Didn't run Thu/.test(l.note) && told.some(([, r]) => r.error), 'one that can\'t start: why, listed as didn\'t run, and told', l.note)
    setNow(2026, 11, 20, 9, 0, 5); await tick({ on: false })
    ok(started.length === 3 && /Scheduled Routines was off/.test(runsOf(d.id)[0].why), 'with Scheduled Routines off, its time is written down as skipped, saying why', runsOf(d.id)[0])
    setNow(2026, 11, 20, 10, 0)
    const e = await R.add({ name: 'Inbox sweep', command: 'Sweep the inbox', cwd: path.join(home, 'project'), schedule: 'every day at 9' })
    await tick()
    ok(!started.includes(e.id), 'made at 10:00 for 9:00: today\'s time had gone, so it waits for tomorrow')
    setNow(2026, 11, 21, 9, 0, 5); await tick()
    ok(started.filter((x) => x === e.id).length === 1, 'and runs then')
    // Its run followed: what its agent said last once it's done; one closed before it finished.
    const pane = runsOf(e.id)[0].paneId
    R.observe([{ paneId: pane, status: 'working' }])
    R.observe([{ paneId: pane, status: 'done' }], { said: () => 'Swept: 3 to answer, 12 archived.' })
    ok(runsOf(e.id)[0].ended?.said === 'Swept: 3 to answer, 12 archived.', 'its agent followed to the end, with what it said last', runsOf(e.id)[0])
    setNow(2026, 11, 22, 9, 0, 5); await tick()
    R.observe([])
    setNow(2026, 11, 22, 9, 2); R.observe([])
    ok(runsOf(e.id)[0].ended?.closed === true, 'one closed before it finished says so', runsOf(e.id)[0])
    let refusedBeta = null
    R.scheduling(false)
    try { await R.add({ name: 'x', command: 'y', schedule: 'every day at 9' }) } catch (x) { refusedBeta = x.message }
    R.scheduling(true)
    ok(/beta feature/.test(refusedBeta || ''), 'with Scheduled Routines off, a schedule isn\'t taken, saying how to turn it on', refusedBeta)

    // ---------- Command History's suggestions, in this process ----------
    H.configure({})
    const ask = async (y, mo, dd, h, mi, text, to) => { setNow(y, mo, dd, h, mi); return H.add({ text, box: 'message', to }) }
    const repo = { kind: 'claude', name: 'api', cwd: '/work/api' }
    const chief = { kind: 'claude', name: 'Chief of Staff', chief: true }
    // Mon 2 to Thu 5 November, about 9, nearly the same words each time.
    await ask(2026, 11, 2, 9, 5, 'Check the CI on main and summarize the failures', repo)
    await ask(2026, 11, 3, 8, 55, 'check CI on main and summarize failures please', repo)
    await ask(2026, 11, 4, 9, 10, 'Check the CI on main and summarize the failures', repo)
    await ask(2026, 11, 5, 9, 20, 'Check the CI on main and summarize the failures.', repo)
    // Three Mondays at about 4, to the Chief of Staff.
    for (const [dd, mi] of [[19, 0], [26, 10]]) await ask(2026, 10, dd, 16, mi, 'Write the weekly status update for the team', chief)
    await ask(2026, 11, 2, 15, 55, 'Write the weekly status update for the team', chief)
    // Every day, a Sunday among them.
    for (const dd of [1, 2, 3, 4, 5]) await ask(2026, 11, dd, 7, 30, 'Summarize the overnight alerts from the pager', repo)
    // Not routines: a yes, five times in a day, times hours apart, one that stopped in September.
    for (const dd of [2, 3, 4, 5]) await ask(2026, 11, dd, 10, 0, 'yes', repo)
    for (let i = 0; i < 5; i++) await ask(2026, 11, 4, 11 + i, 0, 'Run the tests again please', repo)
    for (const [dd, h] of [[2, 8], [3, 14], [4, 19]]) await ask(2026, 11, dd, h, 0, 'Look at the open pull requests', repo)
    for (const dd of [7, 14, 21]) await ask(2026, 9, dd, 9, 0, 'Prepare the sprint review deck', repo)
    setNow(2026, 11, 6, 8, 0) // Friday morning
    let sug = await H.suggestions()
    const ci = sug.find((s) => /CI on main/i.test(s.text))
    const status = sug.find((s) => /weekly status/.test(s.text))
    const alerts = sug.find((s) => /overnight alerts/.test(s.text))
    ok(ci && same(ci.when, { every: 'weekday', at: '09:00' }) && ci.count === 4 && ci.to.cwd === '/work/api', 'the same request on 4 weekdays about 9 (give or take a few words): every weekday at 9:00, in its folder', ci)
    ok(status && same(status.when, { every: 'week', days: [1], at: '16:00' }) && status.to.chief, 'the Chief of Staff\'s on 3 Mondays at about 4: every Monday at 16:00, to the Chief of Staff', status)
    ok(alerts && same(alerts.when, { every: 'day', at: '07:30' }), 'one over a weekend too: every day at 7:30', alerts)
    ok(sug.length === 3, 'and nothing for "yes", five times in a day, times hours apart, or a pattern that stopped', sug.map((s) => s.text))
    sug = await H.suggestions({ routines: [{ command: 'Write the weekly status update for the team', to: 'chief' }] })
    ok(!sug.some((s) => /weekly status/.test(s.text)), 'not one that\'s a routine already')
    await H.dismiss(ci.key)
    sug = await H.suggestions()
    ok(!sug.some((s) => /CI on main/i.test(s.text)) && sug.length === 2, 'one dismissed isn\'t suggested again')
    // Kept for 30 days: older ones taken off the disk; one deleted, gone from it at once; off, nothing kept.
    const disk = () => fs.readdirSync(path.join(home, 'commands')).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(home, 'commands', f), 'utf8')).join('')
    H.configure({ commands: { keepFor: '30d' } })
    const listed = await H.list()
    await H.tidy()
    ok(!listed.items.some((r) => /sprint review/.test(r.text)) && !/sprint review/.test(disk()) && /weekly status/.test(disk()), 'kept 30 days: September\'s taken off the disk, October\'s kept', listed.items.length)
    const one = listed.items.find((r) => r.text === 'yes')
    await H.remove(one.id)
    ok(!disk().includes(one.id) && (await H.list()).items.length === listed.items.length - 1, 'one deleted is gone from the disk')
    H.configure({ commands: { history: false } })
    const off = await H.add({ text: 'Nothing should keep this', box: 'message', to: repo })
    ok(off.kept === false && !disk().includes('Nothing should keep this') && (await H.list()).history === false, 'with the history off, nothing is kept, and the list says it\'s off')
  } finally { globalThis.Date = RealDate }

  // ---------- A server, Scheduled Routines off and then on ----------
  const project = (k, name) => { const dir = path.join(k.home, 'code', name); fs.mkdirSync(dir, { recursive: true }); return dir }
  const aNow = new clock.Date()
  const seedDay = (back, h, mi) => { const d = new clock.Date(aNow); d.setDate(d.getDate() - back); d.setHours(h, mi, 0, 0); return d }
  // The last four weekdays before today, at about 9, asked in a folder of the server's own home.
  const weekdays = []
  for (let back = 1; weekdays.length < 4; back++) { const d = seedDay(back, 9, 0); if (d.getDay() >= 1 && d.getDay() <= 5) weekdays.unshift(d) }
  kitA = await startKit('routines', {
    env: ({ data, home: h }) => {
      // An older routines.json, from before schedules.
      fs.mkdirSync(path.join(h, 'code', 'shop'), { recursive: true })
      fs.writeFileSync(path.join(data, 'routines.json'), JSON.stringify({ routines: [{ id: 'weekly-dependency-check', name: 'Weekly dependency check', detail: '', every: 'week', cwd: '~/code/shop', workspace: 'Maintenance', kind: 'claude', command: 'busy 1' }] }))
      // What was asked before, for a suggestion: the server's own history of four weekdays.
      fs.mkdirSync(path.join(data, 'commands'), { recursive: true })
      weekdays.forEach((d, i) => fs.appendFileSync(path.join(data, 'commands', `${d.toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ id: `seed${i}aaaaaaaa`, at: new RealDate(d.getTime() + i * 4 * 60000).toISOString(), text: 'Triage the new bug reports and label them', box: 'message', to: { kind: 'claude', name: 'shop', cwd: path.join(h, 'code', 'shop') } })}\n`))
      return { ...clock.env }
    },
  })
  kitA.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  const A = kitA
  await A.api('/setup', { name: 'Tester' })
  await A.api('/agents/catalog')
  const stop = listen(A.url)
  let list = await A.api('/routines?refresh=1')
  const legacy = list.routines.find((r) => r.id === 'weekly-dependency-check')
  ok(legacy && !legacy.when && list.computer, 'off: an older routines.json listed as it was, with this computer\'s name', legacy)
  let e1 = null
  try { await A.api('/routines', { name: 'Scheduled', command: 'Do it', cwd: '~/code/shop', schedule: 'every day at 9' }) } catch (x) { e1 = x }
  ok(e1 && /beta feature/.test(e1.message), 'off: a schedule isn\'t taken, saying how to turn it on', e1?.message)
  let e2 = null
  try { await A.api('/command-history') } catch (x) { e2 = x }
  ok(e2?.status === 404 && /Scheduled Routines is a beta feature/.test(e2.message), 'off: Command History\'s routes aren\'t there, saying how to turn it on', e2?.message)
  const ran = await A.api('/routines/weekly-dependency-check/run', {})
  const legacyAgent = await until(async () => (await A.api('/fleet')).agents.find((a) => a.paneId === ran.paneId), 30000, 500)
  ok(legacyAgent && legacyAgent.workspace === 'Maintenance', 'off: Run starts it as before, in its space', legacyAgent?.workspace)
  await A.api(`/agents/${encodeURIComponent(ran.paneId)}/prompt`, { text: 'Typed while it was off', typed: 'message' }).catch(() => {})
  ok(!fs.existsSync(path.join(A.data, 'commands', `${new clock.Date().toISOString().slice(0, 7)}.jsonl`)) || !fs.readFileSync(path.join(A.data, 'commands', `${new clock.Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').includes('Typed while it was off'), 'off: nothing typed is kept')

  await A.api('/settings', { trials: { routines: true } }, 'PATCH')
  const shop = project(A, 'shop')
  const made = await A.api('/routines', { name: 'Standup notes', command: 'busy 1', cwd: '~/code/shop', schedule: 'every weekday at 9', kind: 'claude' })
  list = await A.api('/routines?refresh=1')
  const mine = list.routines.find((r) => r.id === made.id)
  ok(mine?.when?.every === 'weekday' && mine.next.length === 3 && mine.next.every((x) => { const d = new Date(x); return d.getHours() === 9 && d.getMinutes() === 0 && d.getDay() >= 1 && d.getDay() <= 5 }) && mine.says === 'Every weekday at 9:00 AM' && mine.auto, 'on: a routine made with a schedule, with its next three runs (weekdays at 9:00) and what it says', mine)
  let e3 = null
  try { await A.api('/routines', { name: 'Odd', command: 'x', cwd: '~/code/shop', schedule: 'every blue moon' }) } catch (x) { e3 = x }
  ok(e3 && /Didn't follow "blue moon"/.test(e3.message), 'one it can\'t read is refused, saying which words', e3?.message)

  // What's typed in the app's boxes, and not what agents send each other.
  const hist = (q = '') => A.api(`/command-history${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const fresh = await A.api('/agents/launch', { kind: 'claude', cwd: shop, label: 'Bugs', newSpace: 'Bugs', prompt: 'busy 2 2', typed: 'new' })
  await until(async () => (await A.api('/fleet')).agents.find((a) => a.paneId === fresh.paneId), 30000, 300)
  await A.api(`/agents/${encodeURIComponent(fresh.paneId)}/prompt`, { text: 'Label the duplicates too', typed: 'message', cid: 'c-1' })
  await A.api(`/agents/${encodeURIComponent(fresh.paneId)}/prompt`, { text: 'Label the duplicates too', typed: 'message', cid: 'c-1' }) // the same send again (a dropped connection)
  await A.api(`/agents/${encodeURIComponent(fresh.paneId)}/prompt`, { text: 'Sent by the chief, not typed here' })
  await A.api(`/agents/${encodeURIComponent(fresh.paneId)}/queue`, { text: 'And this screenshot\n\nAttached: /tmp/shot.png', typed: 'message' })
  await A.api('/chief/tasks', { title: 'Book the team offsite', send: true, typed: 'tasks' })
  let h = await until(async () => { const x = await hist(); return x.items.some((r) => r.text === 'And this screenshot') && x }, 10000, 200)
  const by = (text) => (h?.items || []).filter((r) => r.text === text)
  ok(by('busy 2 2')[0]?.box === 'new' && by('busy 2 2')[0]?.to?.cwd === shop, 'a new agent\'s first message, with its folder', by('busy 2 2'))
  ok(by('Label the duplicates too').length === 1 && by('Label the duplicates too')[0].to.name === 'Bugs', 'a message, kept once though sent twice, with the agent it went to', by('Label the duplicates too'))
  ok(!by('Sent by the chief, not typed here').length, 'what an agent sends another (no box said) isn\'t kept')
  ok(by('And this screenshot')[0]?.files === 1, 'one queued with a file: the words, and that a file went with them, not where', by('And this screenshot'))
  ok(by('Book the team offsite')[0]?.to?.chief && by('Book the team offsite')[0].box === 'tasks', 'a task for the Chief of Staff', by('Book the team offsite'))
  ok((await hist('duplicates')).items.length === 1 && (await hist('chief of staff')).items.some((r) => r.text === 'Book the team offsite'), 'searched by its words, and by where it went')
  // A suggestion over the route: the four weekdays seeded, dismissed for good.
  let s = (await A.api('/command-history/suggestions')).suggestions
  const triage = s.find((x) => /Triage the new bug reports/.test(x.text))
  ok(triage && triage.when.every === 'weekday' && triage.when.at === '09:00', 'the request on four weekdays at 9: a weekday routine suggested', s)
  await A.api(`/command-history/suggestions/${triage.key}/dismiss`, {})
  await A.restart()
  s = (await A.api('/command-history/suggestions')).suggestions
  ok(!s.some((x) => /Triage/.test(x.text)), 'dismissed, it isn\'t suggested again, after a restart too', s)
  // Deleted, off, Delete all.
  h = await hist()
  const gone = h.items.find((r) => r.text === 'Label the duplicates too')
  await A.api(`/command-history/${gone.id}`, null, 'DELETE')
  const files = () => fs.readdirSync(path.join(A.data, 'commands')).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(A.data, 'commands', f), 'utf8')).join('')
  ok(!files().includes(gone.id), 'deleted: gone from the disk')
  await A.api('/settings', { commands: { history: false } }, 'PATCH')
  await A.api(`/agents/${encodeURIComponent(fresh.paneId)}/prompt`, { text: 'Not kept while it is off', typed: 'message' })
  h = await hist()
  ok(!files().includes('Not kept while it is off') && h.history === false, 'Command History off: nothing kept, and the list says so')
  await A.api('/settings', { commands: { history: true } }, 'PATCH')
  await A.api('/command-history', null, 'DELETE')
  ok(!fs.existsSync(path.join(A.data, 'commands')) && (await hist()).total === 0, 'Delete all: the folder gone')
  // The Chief of Staff's routine, run by hand: it's started, and the command waits its turn for it.
  const chiefR = await A.api('/routines', { name: 'Weekly status', command: 'Write the weekly status update', to: 'chief', schedule: 'every monday at 16:00' })
  const cr = await A.api(`/routines/${chiefR.id}/run`, {})
  const chiefUp = await until(async () => { const f = await A.api('/fleet'); return f.agents.find((a) => a.chief && a.paneId === cr.paneId) && f }, 30000, 500)
  const waiting = chiefUp && [...Object.values(chiefUp.queue || {}).flat(), ...Object.values(chiefUp.delivered || {}).flat()].some((x) => x?.text === 'Write the weekly status update')
  const got = await until(() => (fs.existsSync(path.join(A.home, 'claude-typed.log')) && fs.readFileSync(path.join(A.home, 'claude-typed.log'), 'utf8').includes('Write the weekly status')) || waiting, 15000, 300)
  ok(!!chiefUp && !!got, 'the Chief of Staff\'s routine: it\'s started, and the command goes to it in its turn', chiefUp?.queue)
  list = await A.api('/routines?refresh=1')
  ok(list.routines.find((r) => r.id === chiefR.id)?.runs?.[0]?.how === 'hand', 'and the run is written down as by hand', list.routines.find((r) => r.id === chiefR.id)?.runs)
  stop()
  A.stop()
  kitA = null

  // ---------- A server a few seconds before a routine's time ----------
  // Its clock set so that 25 seconds from now it's a whole minute (on top of BRIDGE_TEST_CLOCK's).
  const fireReal = RealDate.now() + 25000
  const T = Math.ceil((fireReal + clock.offset) / 60000) * 60000
  const offset = T - fireReal
  const ago = (ms) => new RealDate(T - ms)
  kitB = await startKit('routines-clock', {
    config: { trials: { routines: true } },
    env: ({ data, home: h, bin }) => {
      standIn(bin)
      fs.mkdirSync(path.join(h, 'code', 'shop'), { recursive: true })
      // Each made a little before its first time (so yesterday's isn't one it missed).
      const at = (ms) => hhmm(ago(ms))
      const since = (ms) => ago(ms).toISOString()
      const def = (id, name, o) => ({ id, name, detail: '', every: 'day', at: at(0), cwd: '~/code/shop', workspace: name, command: 'busy 2', kind: 'claude', auto: true, since: since(120000), detect: {}, ...o })
      fs.writeFileSync(path.join(data, 'routines.json'), JSON.stringify({ routines: [
        def('on-time', 'Morning check', {}),
        def('paused', 'Paused check', { paused: true }),
        def('gone', 'Gone folder', { cwd: '~/code/nowhere' }),
        def('late', 'Late check', { at: at(30 * 60000), since: since(31 * 60000), command: 'busy 1' }),
        def('missed', 'Missed check', { at: at(13 * 3600e3), since: since(14 * 3600e3) }),
      ] }))
      return { NODE_OPTIONS: clock.env.NODE_OPTIONS || `--import=${new URL('../stand-ins/clock.mjs', import.meta.url).href}`, BRIDGE_TEST_CLOCK_OFFSET: String(offset), BRIDGE_ROUTINE_TICK_MS: '1000' }
    },
  })
  const B = kitB
  const stopB = listen(B.url)
  const of = async (id) => (await B.api('/routines?refresh=1')).routines.find((r) => r.id === id)
  const lateR = await until(async () => { const r = await of('late'); return r?.runs?.[0]?.paneId && r }, 20000, 500)
  ok(lateR?.runs[0].how === 'late' && new Date(lateR.runs[0].slot).getTime() === T - 30 * 60000, 'one whose time came 30 minutes before Bridge AI started: run when it starts, as late', lateR?.runs)
  const missedR = await of('missed')
  ok(missedR?.state === 'missed' && missedR.runs[0].missed && !missedR.runs[0].paneId, 'one 13 hours before: written down as missed, nothing started', missedR?.runs)
  ok(!(await of('on-time')).runs?.length, 'the one due in a few seconds hasn\'t run before its time')
  const onTime = await until(async () => { const r = await of('on-time'); return r?.runs?.[0]?.paneId && r }, 60000, 500)
  ok(onTime?.runs[0].how === 'auto' && new Date(onTime.runs[0].slot).getTime() === T, 'at its time it runs, by itself', onTime?.runs)
  const agent = onTime && await until(async () => (await B.api('/fleet')).agents.find((a) => a.paneId === onTime.runs[0].paneId), 20000, 300)
  ok(agent?.workspace === 'Morning check' && agent?.kind === 'claude', 'its agent, a Claude Code in a space named for it', agent && { workspace: agent.workspace, kind: agent.kind })
  const ended = await until(async () => { const r = await of('on-time'); return r?.runs?.[0]?.ended && r.runs[0] }, 30000, 500)
  ok(ended?.ended?.said === 'Done with turn 1.', 'followed to its end, with what it said last', ended)
  const goneR = await until(async () => { const r = await of('gone'); return r?.runs?.[0]?.error && r }, 10000, 300)
  ok(goneR?.state === 'error' && /Folder not found: ~\/code\/nowhere/.test(goneR.runs[0].error) && /^Didn't run/.test(goneR.note), 'one whose folder is gone: didn\'t run, saying why', goneR && { state: goneR.state, note: goneR.note })
  ok(!(await of('paused')).runs?.length && (await of('paused')).state === 'paused', 'a paused one doesn\'t run')
  await B.restart()
  await sleep(3000)
  ok((await of('on-time')).runs.filter((r) => r.paneId).length === 1, 'started again, its time already taken: not run twice', (await of('on-time')).runs)
  stopB()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of [kitA, kitB]) if (k) console.log(k.log().slice(-2000))
} finally {
  globalThis.Date = RealDate
  kitA?.stop()
  kitB?.stop()
}
process.exit(done().fail ? 1 : 0)
