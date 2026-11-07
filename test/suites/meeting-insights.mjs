// Meeting Insights and the people you meet, a beta feature (meeting-insights), on any platform, in
// the browser named by BRIDGE_TEST_BROWSER. Off to start with: its routes refused saying how to turn
// it on, and nothing in Meetings or ⌘K leading to it. On with no meetings, Insights and People say
// what they need. Then nine made-up meetings in the data folder (calls with named lines, a room with
// voices told apart and one with none, one with nothing transcribed, one archived, one from months
// ago), their invites listing what isn't a person too (a word like "schedule", rooms, a calendar's
// address, a team's list, a note taker, a no-reply mailbox, a role after a name) and a calendar,
// through a stand-in for Bridge AI's calendar helper (native/bridgecal; not on Windows, where the
// stand-in is a script it can't start): the numbers exactly (how many, how long, your share of the
// talk, words, by week split into series and one-off, by kind, by weekday and hour, the series, the
// people met and met for the first time), what each is based on and the meetings that aren't
// counted; each meeting read once, and again only when it changes, also after a restart; the people
// (you, rooms, lists and mailboxes left out), the same person put together across names and
// addresses, and a merge and a split by hand; a person's page with their meetings by month and by
// series, open action items both ways (one carried from summary to summary shown once) and next
// meeting; the calendar not allowed, then allowed. In the app: the tabs, the tiles against the days
// before, the weeks with their scale, average and this week's, the heatmap, where the time goes, the
// signals each with its basis, a kind picked; People with its map of who meets whom, its groups and
// a picker that finds someone as you type; a person's page with the next meeting once, linking to a
// meeting, a merge through the picker and a split. Then half a year of meetings with 130 made-up
// people and 160 names in meeting memory: the same pages and meeting memory grouped, folded and
// searched, in a light and a dark theme, and on 375, 390 and 430 px phones, each fitting the screen.
// Last, a computer of its own with Meeting Insights never set: on by itself at the fifth meeting,
// said once on Meetings with Turn off, shown in Beta Features, and not on again once turned off.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, phoneFaults, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('meeting-insights')
// The calendar: a stand-in bridgecal that answers from bridgecal.json beside it ({ status, events }).
const CAL = !IS_WIN
const calendar = (bin) => {
  fs.writeFileSync(path.join(bin, 'bridgecal.cjs'), `const fs = require('node:fs'), path = require('node:path')
const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'bridgecal.json'), 'utf8'))
const cmd = process.argv[2]
if (cmd === 'events' && c.status === 'granted') { process.stdout.write(JSON.stringify(c.events)); process.exit(0) }
process.stdout.write(c.status + '\\n')
process.exit(cmd === 'events' ? 3 : 0)`)
  fs.writeFileSync(path.join(bin, 'bridgecal'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'bridgecal.cjs')}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'bridgecal.json'), JSON.stringify({ status: 'denied', events: [] }))
  return path.join(bin, 'bridgecal')
}
const kit = await startKit('meeting-insights', { config: { mail: { myDomains: ['example.com'] } }, env: ({ bin }) => (CAL ? { BRIDGE_CALASK: calendar(bin) } : {}) })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const err = (p, body, method) => api(p, body, method).then(() => null, (e) => e)
const pages = []
const kits = [kit]
// A request cut off by a reload, which WebKit reports as a page error.
const real = (errors) => errors.filter((e) => !/\/api\/[\w/.?=&-]+ due to access control checks/.test(e))
// A picture of all of it: Meetings scrolls inside itself, so the window is made as tall as what's in
// it for the picture, then put back.
const whole = async (pg, name) => {
  const vp = pg.viewportSize()
  const more = await pg.evaluate(() => {
    for (let e = document.querySelector('.mi'); e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY)) return e.scrollHeight - e.clientHeight
    return 0
  })
  await pg.setViewportSize({ width: vp.width, height: Math.min(7000, vp.height + more + (more ? 80 : 0)) })
  await pg.waitForTimeout(400)
  await shot(pg, name)
  await pg.setViewportSize(vp)
}

// ---------- The meetings, written as Bridge AI keeps them ----------
const DAY = 864e5
const at = (daysAgo, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d }
const meetingIn = (k) => (id, { title, when, seconds, people, event = {}, lines = [], named, voices, summary, ...more }) => {
  const d = path.join(k.data, 'meetings', id)
  fs.mkdirSync(d, { recursive: true })
  const start = when.toISOString()
  fs.writeFileSync(path.join(d, 'meeting.json'), JSON.stringify({ id, title, status: 'done', kind: /interview/i.test(title) ? 'interview' : /standup/i.test(title) ? 'standup' : 'general', startedAt: start, endedAt: new Date(+when + seconds * 1000).toISOString(), seconds, call: 'on', event: people ? { title, attendees: people, ...event } : null, ...more }, null, 2))
  if (lines.length) fs.writeFileSync(path.join(d, 'transcript.jsonl'), lines.map(([src, t0, t1, text]) => JSON.stringify({ src, t0, t1, text, engine: 'test' })).join('\n') + '\n')
  if (named) fs.writeFileSync(path.join(d, 'speakers.json'), JSON.stringify(named))
  if (voices) fs.writeFileSync(path.join(d, 'voices.json'), JSON.stringify(voices))
  if (summary) fs.writeFileSync(path.join(d, 'summary.md'), summary)
}
const meeting = meetingIn(kit)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const weekOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x) }
const M1 = at(3, 10), M2 = at(10, 10), M3 = at(17, 10), M4 = at(24, 10), M5 = at(5, 15), M6 = at(2, 9), M7 = at(2, 9, 16), M8 = at(2, 9, 48), M9 = at(100, 10)
// What an invite or a transcript lists that isn't someone you met.
const NOT_PEOPLE = ['schedule', 'Conf Room 4 (8)', 'payments-team@example.com', 'Otter.ai Notetaker', 'noreply@example.org', 'Board Room [TV]', 'c_1a2b3c4d5e6f7a8b@resource.calendar.google.com', 'Schedule'] // private-ok: a made-up room calendar's address, as Google writes them
const seed = () => {
  // A 1:1 call: your mic and Priya's (the one person invited, so her lines are hers). On time. The
  // invite also lists "schedule" (a scheduling mailbox, its address cut off) and the room.
  meeting('m1', { title: 'Pricing review', when: M1, seconds: 1800, people: ['Priya Shah', 'tester@example.com', 'schedule', 'Conf Room 4 (8)'], event: { start: M1.toISOString(), end: new Date(+M1 + 1800e3).toISOString() },
    lines: [['you', 0, 10, 'Shall we look at the enterprise tiers today?'], ['them', 10, 40, 'Yes, that price needs a rethink soon.'], ['you', 40, 50, 'Good. What about the pilot?'], ['them', 50, 60, 'It starts in May.']],
    summary: '## Summary\n\n- The **Enterprise tier** needs a new price.\n\n## Action items\n\n- [ ] Priya Shah: send the pricing sheet\n- [ ] You: draft the pilot plan\n- [x] You: book the room\n' })
  // A weekly call with three others: Dan and "priya" named on the transcript, one line named
  // "Schedule" (a word off the call's window), and the team's list and a note taker invited.
  meeting('m2', { title: 'Weekly payments sync', when: M2, seconds: 3600, people: ['Priya Shah', 'Dan Ruiz', 'Mia Chen', 'Tester', 'payments-team@example.com', 'Otter.ai Notetaker'],
    lines: [['you', 0, 30, 'Morning all, let us start with the numbers.'], ['them', 30, 90, 'Revenue is up this week.'], ['them', 90, 120, 'Priya here, the dashboard is ready.'], ['them', 120, 150, 'One more thing on refunds.']],
    named: { 'them:30': { name: 'Dan Ruiz' }, 'them:90': { name: 'priya' }, 'them:120': { name: 'Schedule' } },
    summary: '## Summary\n\n- Revenue is up; the **Enterprise tier** sells.\n\n### Refunds\n\n- Fewer this week.\n\n## Action items\n\n- [ ] Dan: check refunds with Priya Shah\n' })
  // The same, in a room with nobody's voice told apart: who spoke isn't known.
  meeting('m3', { title: 'Weekly payments sync', when: M3, seconds: 3600, people: ['Priya Shah', 'Dan Ruiz', 'Mia Chen', 'Tester'], lines: [['you', 0, 20, 'We met in the room today.'], ['you', 20, 40, 'Someone else said this.']] })
  // The same, in a room with the voices told apart: one is you, one is Mia. Invited by address.
  meeting('m4', { title: 'Weekly payments sync', when: M4, seconds: 2700, people: ['Priya Shah <priya.shah@example.com>', 'dan.ruiz@example.com', 'Mia Chen', 'Tester'],
    lines: [['you', 0, 10, 'I will take the first part.'], ['you', 10, 40, 'Thanks, here is my update on the launch plan.'], ['you', 40, 45, 'Any questions?']],
    voices: { src: 'you', speakers: 2, line: { 'you:0': 1, 'you:10': 2, 'you:40': 1 }, names: { 1: { me: true }, 2: { name: 'Mia Chen' } } },
    summary: '## Summary\n\n### Launch plan\n\n- Mia shared the launch plan.\n\n## Action items\n\n- [ ] Priya Shah: send the pricing sheet\n' })
  // A customer: someone from another company's address, and its no-reply mailbox. It ran ten
  // minutes over.
  meeting('m5', { title: 'Onboarding call', when: M5, seconds: 1200, people: ['Ola Berg <ola@example.org>', 'Tester', 'noreply@example.org'], event: { start: M5.toISOString(), end: new Date(+M5 + 600e3).toISOString() },
    lines: [['you', 0, 20, 'Welcome aboard, how was setup?'], ['them', 20, 80, 'Smooth, thanks.']] })
  // Three back to back: a standup in a room, a review with nothing transcribed, an interview call.
  meeting('m6', { title: 'Daily standup', when: M6, seconds: 900, people: ['Priya Shah', 'Dan Ruiz (Guest)', 'Tester'], lines: [['you', 0, 30, 'Yesterday I fixed the export.']] })
  meeting('m7', { title: 'Design review', when: M7, seconds: 1800, people: ['Mia Chen', 'Dan Ruiz', 'm.chen', 'Tester', 'c_1a2b3c4d5e6f7a8b@resource.calendar.google.com'] }) // private-ok: a made-up room calendar's address, as Google writes them
  meeting('m8', { title: 'Interview - Lena Park', when: M8, seconds: 1800, people: ['Lena Park', 'Tester', 'Board Room [TV]'], lines: [['you', 0, 30, 'Tell me about your last project?'], ['them', 30, 60, 'I built a billing system.']] })
  // From months ago, and one archived.
  meeting('m9', { title: 'Old planning', when: M9, seconds: 3600, people: ['Priya Shah', 'Tester'] })
  meeting('m10', { title: 'Archived chat', when: at(4, 16), seconds: 600, people: ['Priya Shah', 'Tester'], archived: true })
}

// ---------- Half a year of meetings ----------
// Made-up names only. A team with a weekly sync and standups, 1:1s, design reviews, calls with four
// customers, interviews and a monthly all-hands with most of the 130 people; the invites list rooms,
// lists and mailboxes as well. A fixed sequence, so every run is the same.
const FIRST = ['Ava', 'Ben', 'Cleo', 'Dev', 'Elif', 'Finn', 'Gia', 'Hugo', 'Ines', 'Jun', 'Kofi', 'Lea', 'Milo', 'Nia', 'Oren', 'Pia', 'Quin', 'Rhea', 'Sami', 'Tess', 'Uma', 'Viktor', 'Wren', 'Xena', 'Yusuf', 'Zoe', 'Arlo', 'Bea', 'Cyrus', 'Dara']
const LAST = ['Abara', 'Brandt', 'Castillo', 'Dorsey', 'Eklund', 'Faraday', 'Galvez', 'Holm', 'Iwata', 'Jansen', 'Kova', 'Lindqvist', 'Moreau', 'Nakai', 'Okafor', 'Petrov', 'Quill', 'Rasku', 'Sorensen', 'Tamura']
let rs = 7
const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647
const pickN = (arr, n) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a.slice(0, n) }
const POOL = pickN(FIRST.flatMap((f) => LAST.map((l) => `${f} ${l}`)), 130)
const TEAM = ['Priya Shah', 'Dan Ruiz', 'Mia Chen', ...POOL.slice(0, 5)]
const DESIGN = ['Mia Chen', ...POOL.slice(5, 10)]
const COMPANIES = [['Acme', 'acme.example.org'], ['Globex', 'globex.example.org'], ['Initech', 'initech.example.net'], ['Umbrella', 'umbrella.example.net']].map(([name, dom], i) => ({ name, people: POOL.slice(10 + i * 3, 13 + i * 3).map((p) => `${p} <${p.toLowerCase().replace(' ', '.')}@${dom}>`) }))
const TOPICS = ['Refund flow', 'Payouts v2', 'Ledger API', 'Pricing page', 'Onboarding emails', 'Fraud rules', 'Quarterly plan', 'Card issuing', 'Checkout speed', 'Support backlog']
const big = () => {
  const ids = []
  let n = 0
  const add = (o) => {
    const id = `s${++n}`
    const said = o.people.filter((p) => p !== 'Tester' && !NOT_PEOPLE.includes(p))
    const who = pickN(said, 2)
    const room = /standup/i.test(o.title)
    const lines = room ? [['you', 0, 40, 'Quick update from me today.']]
      : [['you', 0, 20, 'Shall we start with the open items?'], ['them', 20, 80 + Math.round(rnd() * 120), 'Here is where things stand this week.'], ['you', 200, 230, 'Thanks. Anything blocking you?'], ['them', 230, 290, 'Nothing new, we are on track.']]
    const named = room || !who.length ? null : { 'them:20': { name: who[0].replace(/\s*<.*$/, '') }, ...(who[1] ? { 'them:230': { name: who[1].replace(/\s*<.*$/, '') } } : {}) }
    const topics = pickN(TOPICS, 2)
    const summary = room ? null : `## Summary\n\n### ${topics[0]}\n\n- The **${topics[1]}** moved on.\n\n## Action items\n\n- [${rnd() < 0.4 ? 'x' : ' '}] You: follow up on ${topics[0].toLowerCase()} with ${who[0]?.split(' ')[0] || 'the team'}\n${who[0] ? `- [ ] ${who[0].replace(/\s*<.*$/, '')}: send the ${topics[1].toLowerCase()} numbers\n` : ''}`
    const over = rnd() < 0.25 ? 6 * 60 : 0
    meeting(id, { ...o, seconds: o.seconds + over, event: { start: o.when.toISOString(), end: new Date(+o.when + o.seconds * 1000).toISOString() }, lines, named, summary })
    ids.push(id)
  }
  for (let d = 182; d >= 1; d--) {
    const day = at(d, 9).getDay()
    if (day === 1) add({ title: 'Weekly payments sync', when: at(d, 10), seconds: 3000, people: [...TEAM, 'Tester', 'payments-team@example.com', 'Conf Room 4 (8)'] })
    if (day === 2 || day === 4) add({ title: 'Daily standup', when: at(d, 9, 15), seconds: 900, people: [...TEAM, 'Tester', 'schedule'] })
    if (day === 4 && d % 14 < 7) add({ title: '1:1 Dan / Tester', when: at(d, 14), seconds: 1800, people: ['Dan Ruiz', 'Tester'] })
    if (day === 3 && d % 14 >= 7) add({ title: 'Design review', when: at(d, 15), seconds: 3600, people: [...DESIGN, 'Tester', 'Otter.ai Notetaker'] })
    if (day >= 1 && day <= 5 && d % 5 === 0) { const c = COMPANIES[(d / 5) % 4]; add({ title: `${c.name} check-in`, when: at(d, 11 + (d % 4)), seconds: 1800 + (d % 3) * 900, people: [...c.people, 'Tester', 'noreply@example.org'] }) }
    if (day === 3 && d % 21 < 7) add({ title: `Interview - ${POOL[40 + (d % 30)]}`, when: at(d, 11), seconds: 2700, people: [POOL[40 + (d % 30)], POOL[20], 'Tester', 'Board Room [TV]'] })
    if (day === 5 && at(d, 9).getDate() <= 7) add({ title: 'All hands', when: at(d, 16), seconds: 3600, people: [...pickN(POOL, 60), ...TEAM, 'Tester', 'everyone@example.com', 'noreply@example.com'] })
  }
  // Meeting memory: the names and terms those meetings brought, each with the meetings it came up in.
  const words = [...TOPICS, ...COMPANIES.map((c) => c.name), ...POOL.slice(0, 120), 'Tidewater', 'Kestrel', 'Bluefin', 'Parcel', 'Orbit', 'Lumen', 'Harbor', 'Quartz', 'Mosaic', 'Ember', 'Sable', 'Juniper', 'Atlas', 'Cobalt', 'Vesper', 'Nimbus', 'Fable', 'Rook', 'Cinder', 'Tundra', 'Willow', 'Zephyr', 'Onyx', 'Maple', 'Halo', 'Drift']
  const terms = words.slice(0, 160).map((term, i) => ({
    id: `t${i}`, term, heard: i % 5 === 0 ? [`${term.toLowerCase()}s`] : [], note: i < 10 ? 'a project of ours' : i < 14 ? 'a customer' : '', source: i % 9 === 0 ? 'you' : 'learned',
    seen: 0, meetings: pickN(ids, 1 + Math.floor(rnd() * 6)), updatedAt: new Date(Date.now() - i * 3600e3).toISOString(),
  }))
  for (const x of terms) x.seen = x.meetings.length
  fs.writeFileSync(path.join(kit.data, 'meetings', 'memory.json'), JSON.stringify({ terms }, null, 2))
  return ids.length
}

try {
  await api('/setup', { name: 'Tester' })
  // ---------- Off to start with ----------
  const off = await err('/meetings/insights')
  ok((await api('/config')).trials?.['meeting-insights'] === false && off?.status === 404 && /Meeting Insights is a beta feature\. Turn it on in Settings › About & Updates › Beta Features/.test(off.message)
    && (await err('/meetings/people'))?.status === 404 && (await err('/meetings/people/merge', { a: 'x', b: 'y' }))?.status === 404,
  'a beta feature, off to start with: its routes answer 404, saying how to turn it on', { off: off?.message, trials: (await api('/config')).trials })
  const desk = await page(b, kit.url, { store: { 'cc-rail-meetings': true, 'cc-meet-tab': 'insights' } })
  pages.push(desk)
  const p = desk.p
  // Meetings, from the sidebar once the app is up (clicked again until it shows: WebKit, and a busy
  // Linux runner, can take a click before the app is listening).
  const openMeetingsIn = async (pg) => {
    const shown = await until(async () => {
      await pg.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click({ timeout: 5000 }).catch(() => {})
      return pg.locator('.mt-view .pane-head').first().waitFor({ timeout: 1500 }).then(() => true, () => false)
    }, 30000, 300)
    if (!shown) throw new Error('Meetings never opened from the sidebar')
  }
  const openMeetings = () => openMeetingsIn(p)
  await openMeetings()
  await p.keyboard.press('ControlOrMeta+k')
  await p.waitForSelector('.pal-item', { timeout: 5000 })
  const palette = async () => p.evaluate(() => [...document.querySelectorAll('.pal-item[data-id^="a:"]')].map((e) => e.dataset.id))
  const hidden = await palette()
  await p.keyboard.press('Escape')
  ok(hidden.includes('a:meetings') && !hidden.includes('a:insights') && !hidden.includes('a:people') && !(await p.locator('.mt-view .seg button[data-view="insights"]').count()) && !(await p.locator('.mi').count()),
    'off: Meetings has no Insights or People tab (even one left open before), and ⌘K offers neither', hidden)

  // ---------- On, with no meetings ----------
  await api('/settings', { trials: { 'meeting-insights': true } }, 'PATCH')
  let ins = await api('/meetings/insights')
  let ppl = await api('/meetings/people')
  ok(ins.total === 0 && ins.meetings === 0 && ppl.people.length === 0 && ppl.meetings === 0, 'turned on with no meetings: nothing to add up, nobody yet', { ins, ppl })
  await p.reload()
  await openMeetings()
  const tabBtn = (v) => p.locator(`.mt-view .seg button[data-view="${v}"]`)
  ok(!!(await until(() => tabBtn('insights').isVisible(), 15000)), 'on: Meetings, Insights and People as tabs of Meetings')
  await tabBtn('insights').click()
  ok(!!(await until(async () => /No meetings to add up yet\..*Record a meeting and Insights adds it up here.*After 5 meetings: when in the week you meet/s.test(await p.locator('.mi-empty').innerText().catch(() => '')), 8000)), 'Insights with no meetings says what it needs, and what comes after 5')
  await tabBtn('people').click()
  ok(!!(await until(async () => /Nobody here yet\..*Record a meeting and the people in it show up here.*After 3 meetings with invites/s.test(await p.locator('.mi-people').innerText().catch(() => '')), 8000)), 'and so does People')
  if (CAL) ok(/Connect your calendar to see when you next meet each person/.test(await p.locator('.mi-cal').innerText().catch(() => '')), 'the calendar not allowed: People says what it\'s for, with the way to allow it')
  else ok(!(await p.locator('.mi-cal').count()), 'no calendar on this computer: nothing asks for one')
  await shot(p, `${tag}insights-empty`)

  // ---------- The numbers ----------
  seed()
  ins = await api('/meetings/insights?days=90')
  ok(ins.reread === 9 && ins.total === 9 && ins.archived === 1, 'each finished meeting read once, the archived one left out', { reread: ins.reread, total: ins.total, archived: ins.archived })
  const again = await api('/meetings/insights?days=90')
  ok(again.reread === 0 && JSON.stringify({ ...again, reread: 0 }) === JSON.stringify({ ...ins, reread: 0 }), 'asked again: nothing read again, the same answer', again.reread)
  ok(ins.meetings === 8 && ins.seconds === 17400 && ins.prev?.meetings === 1 && ins.prev?.seconds === 3600 && ins.prev.people === 1, 'in the last 90 days: 8 meetings, 4 h 50 min, against 1 meeting of an hour with 1 person in the 90 days before', { n: ins.meetings, s: ins.seconds, prev: ins.prev })
  ok(JSON.stringify(ins.talk) === JSON.stringify({ you: 115, others: 280, unknown: 0, told: 5, untold: { room: 2, noyou: 0, silent: 1 } }),
    'your share of the talk: 115 s of 395 s in the 5 meetings where who spoke is known (calls, and a room with you told apart); 2 rooms without voices and 1 with nothing transcribed aren\'t counted', ins.talk)
  ok(ins.words.you === 40 && ins.words.heard === 43, 'words: 40 spoken by you, 43 heard from others', ins.words)
  const wk = Object.fromEntries(ins.weeks.filter((w) => w.n).map((w) => [w.week, [w.n, w.seconds, w.you, w.talk, w.rec]]))
  const want = {}
  for (const [d, s, you, talk, rec] of [[M1, 1800, 20, 60, 0], [M2, 3600, 30, 150, 3600], [M3, 3600, 0, 0, 3600], [M4, 2700, 15, 45, 2700], [M5, 1200, 20, 80, 0], [M6, 900, 0, 0, 0], [M7, 1800, 0, 0, 0], [M8, 1800, 30, 60, 0]]) {
    const w = want[weekOf(d)] || (want[weekOf(d)] = [0, 0, 0, 0, 0])
    w[0]++; w[1] += s; w[2] += you; w[3] += talk; w[4] += rec
  }
  ok(JSON.stringify(Object.keys(wk).sort().map((k) => [k, wk[k]])) === JSON.stringify(Object.keys(want).sort().map((k) => [k, want[k]])) && ins.weeks.length >= 13 && ins.weeks.every((w, i) => !i || Date.parse(w.week) - Date.parse(ins.weeks[i - 1].week) >= 6 * DAY),
    'by week (Monday first): meetings, time, your talk and the time in a series in each, the weeks without meetings there too', { got: wk, want, weeks: ins.weeks.length })
  const kinds = Object.fromEntries(ins.kinds.map((k) => [k.id, k.n]))
  ok(JSON.stringify(kinds) === JSON.stringify({ one_on_one: 1, customer: 1, standup: 1, interview: 1, recurring: 3, group: 1 }),
    'by kind: a 1:1 (one other: "schedule" and the room on its invite aren\'t people), a customer call (an address from another company), a standup and an interview (by name), a series of 3, a group', kinds)
  const share = Object.fromEntries(ins.byKind.map((k) => [k.id, Math.round((k.you / k.talk) * 100)]))
  ok(JSON.stringify(share) === JSON.stringify({ one_on_one: 33, customer: 25, interview: 50, recurring: 23 }), 'your share of the talk by kind, where who spoke is known', ins.byKind)
  const cust = await api('/meetings/insights?days=90&kind=customer')
  ok(cust.meetings === 1 && cust.seconds === 1200 && cust.talk.you === 20 && cust.talk.others === 60 && cust.kinds.length === 6, 'one kind picked: only its meetings, the other kinds still counted to pick from', { n: cust.meetings, talk: cust.talk })
  const s = ins.signals
  ok(s.questions.n === 5 && s.questions.meetings === 5 && s.longest.s === 20 && s.ranOver.n === 1 && s.ranOver.of === 2 && s.backToBack.days === 1 && s.followed.done === 1 && s.followed.of === 2,
    'signals: 5 questions in 5 meetings, your longest stretch 20 s on average, 1 of 2 with an invite ran over, 1 day back to back, 1 of your 2 action items done', s)
  ok(ins.heat.reduce((a, c) => a + c[2], 0) === 17400 && ins.heat.every(([d, h, sec, n]) => d >= 0 && d < 7 && h >= 0 && h < 24 && sec > 0 && n >= 1)
    && ins.heat.find(([d, h]) => d === (M6.getDay() + 6) % 7 && h === 9)?.[3] === 3,
  'when you meet: each meeting\'s time put in its weekday and hours, all of it once; the three back to back in the same hour', ins.heat)
  ok(ins.weekdays.reduce((a, w) => a + w.s, 0) === 17400 && ins.weekdays.reduce((a, w) => a + w.days, 0) === 90 && ins.weekdays.reduce((a, w) => a + w.n, 0) === 8, 'by weekday: the time and meetings on each, and how many of each weekday the 90 days have', ins.weekdays)
  ok(ins.busiest?.date === ymd(M6) && ins.busiest.seconds === 4500 && ins.busiest.n === 3, 'the busiest day: the three back to back, 1 h 15 min', ins.busiest)
  ok(ins.series.length === 1 && ins.series[0].title === 'Weekly payments sync' && ins.series[0].n === 3 && ins.series[0].seconds === 9900 && ins.series[0].people === 3 && ins.series[0].id === 'm2'
    && ins.recurring.seconds === 9900 && ins.recurring.series === 1 && ins.oneoff.seconds === 7500 && ins.oneoff.n === 5,
  'in a series or one-off: the weekly sync (3 meetings, 2 h 45 min, 3 people besides you, the team\'s list not one of them), and 5 one-off', { series: ins.series, rec: ins.recurring, one: ins.oneoff })
  ok(ins.met.n === 6 && ins.met.fresh === 5 && ins.people.length === 6 && ins.people.slice(0, 2).map((x) => x.name).sort().join('|') === 'Dan Ruiz|Priya Shah' && ins.people[0].s === 12600,
    'the people met: 6, 5 of them for the first time (Priya was in the meeting from months ago), most time together first', { met: ins.met, people: ins.people })
  const all = await api('/meetings/insights?days=all')
  const d30 = await api('/meetings/insights?days=30')
  ok(all.meetings === 9 && all.seconds === 21000 && all.prev === null && all.met.fresh === null && d30.meetings === 8, 'all of them: 9 (the one from months ago too); the last 30 days: 8', { all: all.meetings, d30: d30.meetings })
  // Changed: only that one read again, and the numbers follow; also after a restart, from the cache.
  fs.appendFileSync(path.join(kit.data, 'meetings', 'm5', 'transcript.jsonl'), JSON.stringify({ src: 'you', t0: 90, t1: 100, text: 'See you next week.' }) + '\n')
  const after = await api('/meetings/insights?days=90')
  ok(after.reread === 1 && after.talk.you === 125 && after.words.you === 44, 'a transcript that grew: that meeting alone read again, and counted', { reread: after.reread, talk: after.talk, words: after.words })
  await kit.restart()
  const restarted = await api('/meetings/insights?days=90')
  ok(restarted.reread === 0 && restarted.talk.you === 125, 'after a restart, nothing read again: each meeting kept as it was read', restarted.reread)

  // ---------- People ----------
  ppl = await api('/meetings/people')
  const by = (name) => ppl.people.find((x) => x.name === name)
  const priya = by('Priya Shah'), dan = by('Dan Ruiz'), mia = by('Mia Chen')
  ok(JSON.stringify(ppl.people.map((x) => [x.name, x.meetings])) === JSON.stringify([['Priya Shah', 6], ['Dan Ruiz', 5], ['Mia Chen', 4], ['Lena Park', 1], ['M Chen', 1], ['Ola Berg', 1]]),
    'everyone you met, most often first: invited and named on transcripts, you left out', ppl.people.map((x) => [x.name, x.meetings]))
  const notPeople = ppl.people.filter((x) => /schedule|room|team|otter|notetaker|noreply|resource|^c /i.test(`${x.name} ${x.also.join(' ')} ${x.emails.join(' ')}`))
  ok(!notPeople.length && !ppl.people.some((x) => /\(|\[/.test(x.name)), 'no word, room, calendar, list, note taker or mailbox is a person: not "schedule" (on an invite, or naming a line), "Conf Room 4 (8)", "Board Room [TV]", a calendar\'s address, payments-team@, Otter.ai Notetaker, noreply@; and "Dan Ruiz (Guest)" is Dan Ruiz', notPeople)
  ok(!ppl.people.some((x) => /tester/i.test(`${x.name} ${x.emails.join(' ')}`)) && kinds.one_on_one === 1,
    'you, invited by your address (tester@example.com), aren\'t one of the people, and that 1:1 is still a 1:1', ppl.people.map((x) => x.name))
  ok(priya && JSON.stringify(priya.also) === JSON.stringify(['priya']) && JSON.stringify(priya.emails) === JSON.stringify(['priya.shah@example.com']) && dan?.emails[0] === 'dan.ruiz@example.com',
    'the same person put together: "priya" on a transcript where only Priya Shah was invited, and an address with her name; dan.ruiz@example.com is Dan Ruiz', { priya, dan })
  ok(!!by('M Chen') && mia?.meetings === 4, '"m.chen" isn\'t taken for Mia Chen: not clear enough to put together', by('M Chen'))
  ok(priya.share?.pct === 33 && priya.share.meetings === 2 && dan.share?.pct === 40 && mia.share?.pct === 67 && by('Ola Berg').share?.pct === 67 && !by('M Chen').share,
    'each one\'s share of the talk, in the meetings where their lines are named', ppl.people.map((x) => [x.name, x.share]))
  ok(priya.last === M6.toISOString() && priya.first === M9.toISOString() && priya.seconds === 1800 + 3600 + 3600 + 2700 + 900 + 3600 && priya.topics[0] === 'Enterprise tier' && priya.topics.includes('Refunds') && priya.series === 'Weekly payments sync' && priya.recent === 5 && priya.spark.length === 6 && priya.spark.reduce((a, x) => a + x, 0) >= 5,
    'when you first and last met, the time together, the series you meet in, the last six months, and what you talk about, from the words in your summaries', { last: priya.last, s: priya.seconds, topics: priya.topics, series: priya.series, spark: priya.spark })
  if (CAL) ok(ppl.calendar.ok === false && ppl.calendar.code === 'calendarAccess' && ppl.people.every((x) => !x.next), 'the calendar not allowed: said, and no next meetings', ppl.calendar)
  else ok(ppl.calendar.ok === false && ppl.calendar.code === 'platform', 'no calendar on this computer: said as such, to hide it', ppl.calendar)

  // A person's page: their meetings, open action items, the next one.
  let pg = await api(`/meetings/people/${encodeURIComponent(priya.id)}`)
  ok(JSON.stringify(pg.meetingsList.map((x) => [x.id, x.pct, x.series])) === JSON.stringify([['m6', null, null], ['m1', 67, null], ['m2', 20, 'weekly payments sync'], ['m3', null, 'weekly payments sync'], ['m4', null, 'weekly payments sync'], ['m9', null, null]]),
    'a person\'s page lists every meeting with them, newest first, with their share where it\'s known and its series', pg.meetingsList)
  ok(JSON.stringify(pg.items.map((x) => [x.text, x.meeting.id, x.meetings, x.whose])) === JSON.stringify([['send the pricing sheet', 'm1', 2, 'them'], ['check refunds with Priya Shah', 'm2', 1, 'other']]),
    'the action items still open that are theirs or name them, each with its meeting and whose it is; one in two summaries shown once, the newest, saying it\'s in 2', pg.items)
  ok(pg.months.length === 12 && pg.months.at(-1).month === ymd(new Date()).slice(0, 7) && pg.months.reduce((a, m) => a + m.n, 0) + pg.before === 6, 'and the last twelve months, a meeting count each', pg.months)
  if (CAL) {
    const soon = new Date(Date.now() + 2 * DAY); soon.setHours(11, 0, 0, 0)
    fs.writeFileSync(path.join(kit.bin, 'bridgecal.json'), JSON.stringify({ status: 'granted', events: [
      { title: 'Pricing follow-up', calendar: 'Work', start: soon.toISOString(), end: new Date(+soon + 1800e3).toISOString(), allDay: false, attendees: ['Priya Shah', 'Tester', 'c_9f8e7d6c5b4a@resource.calendar.google.com'] }, // private-ok: a made-up room calendar's address, as Google writes them
      { title: 'Lunch', calendar: 'Home', start: new Date(+soon + 3 * 3600e3).toISOString(), end: new Date(+soon + 4 * 3600e3).toISOString(), allDay: false, attendees: [] },
    ] }))
    pg = await api(`/meetings/people/${encodeURIComponent(priya.id)}`)
    ppl = await api('/meetings/people')
    ok(pg.calendar.ok && pg.next?.title === 'Pricing follow-up' && pg.next.start === soon.toISOString() && by('Priya Shah').next?.title === 'Pricing follow-up' && !by('Dan Ruiz').next, 'allowed: the next meeting with them, from the calendar', { next: pg.next, cal: pg.calendar })
    ok(JSON.stringify(pg.next.attendees) === JSON.stringify(['Priya Shah', 'Tester']), 'the calendar leaves a room\'s address out of who\'s invited', pg.next.attendees)
  } else skip('the next meeting with someone', 'the stand-in calendar helper is a script Windows can\'t start')

  // Merged and split by hand.
  const mc = by('M Chen')
  let r = await api('/meetings/people/merge', { a: mia.id, b: mc.id })
  ppl = await api('/meetings/people')
  ok(r.id === mia.id && !by('M Chen') && by('Mia Chen').also.includes('M Chen') && by('Mia Chen').meetings === 4, 'put together by hand: M Chen is Mia Chen now', by('Mia Chen'))
  r = await api('/meetings/people/split', { id: priya.id, key: 'priya' })
  ppl = await api('/meetings/people')
  ok(r.id === priya.id && by('priya')?.meetings === 1 && by('Priya Shah').meetings === 6 && !by('Priya Shah').also.includes('priya') && by('Priya Shah').share.meetings === 1,
    'a name taken out by hand: "priya" is someone of their own, and Priya Shah keeps her meetings', { priya: by('priya'), shah: by('Priya Shah') })
  const kept = JSON.parse(fs.readFileSync(path.join(kit.data, 'meetings', 'people.json'), 'utf8'))
  ok(kept.merge.length === 1 && kept.apart.some(([x, y]) => x === 'priya' && y === 'priya shah'), 'both kept in the data folder', kept)
  r = await api('/meetings/people/merge', { a: priya.id, b: 'priya' })
  ppl = await api('/meetings/people')
  ok(!by('priya') && by('Priya Shah').also.includes('priya'), 'and put back together', ppl.people.map((x) => x.name))
  ok(/No such person/.test((await err('/meetings/people/nobody'))?.message || ''), 'someone who isn\'t there: said')

  // ---------- In the app ----------
  await p.reload()
  await openMeetings()
  await tabBtn('insights').click({ timeout: 15000 })
  const tiles = async () => (await p.locator('.mi-tiles .us-tile-val').allInnerTexts().catch(() => [])).map((x) => x.trim())
  await p.locator('.mi-bar button', { hasText: '90 days' }).click()
  ok(!!(await until(async () => (await tiles()).join('|') === '8|4 h 50 min|23 min|5|57%|31%', 10000)), 'Insights: 8 meetings, 4 h 50 min, 23 min a week, 5 people (M Chen is Mia Chen now), 57% of the time in a series, you spoke 31% of the talk', await tiles())
  const subs = async () => (await p.locator('.mi-tiles .us-tile-sub').allInnerTexts().catch(() => [])).map((x) => x.trim())
  const sb = await subs()
  ok(sb[0] === '▲ 7 more than the 90 days before' && sb[1] === '▲ 383% vs prior 90d' && /^the most: 1 h 15 min, week of \w+ \d+$|^the most: \d+ h \d+ min, week of \w+ \d+$/.test(sb[2]) && sb[3] === '4 for the first time' && sb[4] === 'of the time, in 1 series' && sb[5] === 'of the talk · 2 min',
    'each tile says what its number is against: the days before (up, by how many or how much), the busiest week, the people met for the first time, the series; your share with none known before, its time', sb)
  ok((await p.locator('.mi-tiles .mi-spark').count()) === 3, 'the meetings, time and your share tiles have the last weeks along their top')
  // The weeks: what this week came to, a scale, the average week, the part in a series.
  const chart = p.locator('.mi-weeks')
  ok(/^This week so far: \d+ (min|h)/.test(await chart.locator('.mi-wread').innerText()) && (await chart.locator('.mi-gl i').allInnerTexts()).every((x) => /^\d+(\.\d+)? h$/.test(x)) && (await chart.locator('.mi-gl').count()) === 2,
    'by week: what this week came to so far, and a line at the top and the middle saying how many hours', [await chart.locator('.mi-wread').innerText(), await chart.locator('.mi-gl i').allInnerTexts()])
  ok(/^average \d+ min$/.test(await chart.locator('.mi-avg i').innerText().catch(() => '')) && (await chart.locator('.mi-wbar.split b').count()) === 3 && /In a series\s+One-off/.test(await p.locator('.mi-grid .us-card').first().locator('.mi-note').innerText()),
    'the average week as a dashed line, and each week\'s time in a series apart from its one-off meetings, with a legend', await chart.locator('.mi-avg').innerText().catch(() => ''))
  await chart.locator('.mi-wcol').nth(ins.weeks.length - 2).hover()
  ok(/^Week of \w+ \d+: /.test(await chart.locator('.mi-wread').innerText()), 'and a week pointed at, what it came to', await chart.locator('.mi-wread').innerText())
  const series = p.locator('[data-part="series"]')
  ok(/In a series\s+57%\s+2 h 45 min[\s\S]*One-off\s+43%\s+2 h 5 min[\s\S]*Weekly payments sync\s*2 h 45 min\s*×3/.test(await series.innerText()), 'where the time goes: 57% in a series and 43% one-off, and the series with its time and how many', await series.innerText())
  ok((await p.locator('[data-part="days"] .us-col').count()) === 7 && /Busiest: \w+, \w+ \d+, 1 h 15 min in 3 meetings/.test(await p.locator('[data-part="days"]').innerText()), 'by day of the week, and the busiest day', await p.locator('[data-part="days"]').innerText())
  ok((await p.locator('[data-part="people"] .ue-row').count()) === 5 && /All 5 people in this range/.test(await p.locator('[data-part="people"]').innerText()), 'and who you meet most, the way to all of them under it')
  const heat = p.locator('.mi-heat')
  ok((await heat.locator('rect.mi-cell').count()) === 7 * 10 && (await heat.locator('rect.mi-cell:not(.l0)').count()) === ins.heat.length, 'when you meet: a square for each weekday and hour from 8 to 6, the hours with meetings shaded', [await heat.locator('rect.mi-cell').count(), ins.heat.length])
  await heat.locator('rect.mi-cell:not(.l0)').first().hover()
  ok(/^\w+ · \d+ (AM|PM)–\d+ (AM|PM)\s+\d+ (min|h).* in \d+ meetings?$/.test((await heat.locator('.tooltip').innerText().catch(() => '')).trim()), 'and pointing at one, the hour, the time and how many meetings', await heat.locator('.tooltip').innerText().catch(() => ''))
  const heads = await p.locator('.mi-grid .mi-colhead').allInnerTexts()
  ok(heads.length === 1 && /You spoke\s+Meetings/.test(heads[0]), 'the share by kind has its columns named, not explained in a footnote', heads)
  await p.locator('.mi-bar button', { hasText: '30 days' }).click()
  ok(!!(await until(async () => (await subs())[0] === 'none in the 30 days before', 8000)), 'with no meetings in the days before: none, not "8 more"', await subs())
  await p.locator('.mi-bar button', { hasText: '90 days' }).click()
  await until(async () => (await tiles())[0] === '8', 8000)
  const basis = await p.locator('[data-basis="talk"]').innerText().catch(() => '')
  ok(/From 5 meetings where who spoke is known: on a call, your mic and the call's sound; in a room, voices told apart and one of them you\. 2 in a room without the voices told apart aren't counted\. 1 with nothing transcribed isn't counted\./.test(basis), 'what your share of the talk is based on, and what isn\'t counted', basis)
  ok(/Worked out on this computer from 9 recorded meetings/.test(await p.locator('.mi-lede').innerText()) && /Archived meetings are left out/.test(await p.locator('.mi-lede').innerText()), 'and where it all comes from')
  const sig = (id) => p.locator(`.mi-signal[data-signal="${id}"]`).innerText()
  ok(/Questions you asked\s+1 a meeting\s+Your lines with a question mark/.test(await sig('questions')) && /Your longest stretch\s+20 s\s/.test(await sig('longest')) && /Meetings that ran over\s+1 of 2/.test(await sig('ranOver'))
    && /Back to back\s+1 day\s/.test(await sig('backToBack')) && /Followed through\s+1 of 2/.test(await sig('followed')) && /Attention, productivity\s+not shown\s+Nothing in a recording shows them/.test(await sig('attention'))
    && /A mirror for you; nothing here scores anyone/.test(await p.locator('.mi-signals').locator('xpath=..').innerText()) && (await p.locator('.mi-signal .mi-sig-bar').count()) === 2,
  'the signals, each a tile with what it\'s worked out from (a stretch in seconds, not a clock), the ones out of many with a bar, no score of attention, and the mirror line', await p.locator('.mi-signals').innerText())
  ok((await p.locator('.mi-weeks .mi-wcol').count()) === ins.weeks.length, 'a column for each week')
  await p.locator('.mi-kinds button[data-kind="customer"]').click()
  ok(!!(await until(async () => (await tiles())[0] === '1', 8000)) && /Customer calls: Someone invited from another company/.test(await p.locator('.mi-why').innerText().catch(() => '')), 'a kind picked: its numbers, and what makes a meeting that kind', await tiles())
  await p.locator('.mi-kinds button', { hasText: 'All kinds' }).click()
  await until(async () => (await tiles())[0] === '8', 8000)
  await whole(p, `${tag}insights`)
  // From Insights' people to a person's page, and on to a meeting.
  await p.locator('[data-part="people"] .ue-row', { hasText: 'Priya Shah' }).click()
  await p.locator('.mi-person h3').waitFor({ timeout: 8000 })
  ok((await p.locator('.mi-person h3').innerText()) === 'Priya Shah' && (await p.locator('.mi-mrow').count()) === 6 && (await p.locator('.mi-items li').count()) === 2, 'a person\'s page: their meetings and open action items')
  ok(/send the pricing sheet\s+Pricing review · \w+ \d+\s+and 1 earlier/.test(await p.locator('[data-items="Priya\'s"] .mi-items li').first().innerText().catch(() => '')) && /None of yours names them/.test(await p.locator('.mi-items-grid').innerText()) && /Others that name Priya\s+1\s+Dan: check refunds with Priya Shah/.test(await p.locator('.mi-items-grid').innerText()),
    'action items both ways: none of yours names her, hers (one in two summaries: once, from the newest, "and 1 earlier"), and others\' that name her', await p.locator('.mi-items-grid').innerText())
  const folds = (await p.locator('.mi-person .mt-fold-head').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
  ok(folds.length === 2 && /^Weekly payments sync 3 latest \w+ \d+$/.test(folds[0]) && /^One-off meetings 3 latest \w+ \d+$/.test(folds[1]), 'her meetings by series: the weekly sync and the one-off ones, each with how many', folds)
  await p.locator('.mi-person .mi-sec-head button', { hasText: 'By month' }).click()
  ok(!!(await until(async () => /^\w+ \d{4} \d+ latest/.test((await p.locator('.mi-person .mt-fold-head').first().innerText()).replace(/\s+/g, ' ').trim()), 5000)), 'or by month', await p.locator('.mi-person .mt-fold-head').first().innerText())
  await p.locator('.mi-person .mi-sec-head button', { hasText: 'By series' }).click()
  ok((await p.locator('.mi-months .us-col').count()) === 12, 'meetings together by month, the last twelve')
  if (CAL) ok(!!(await until(async () => /Pricing follow-up/.test(await p.locator('[data-next]').innerText().catch(() => '')), 8000)) && !(await p.locator('.mi-cal').count()) && !/Next: Pricing follow-up/.test(await p.locator('.mi-person').innerText()), 'and the next meeting with them, from the calendar, in its tile (once, not again under it)')
  await whole(p, `${tag}insights-person`)
  await p.locator('.mi-mrow[data-meeting="m1"]').click()
  ok(!!(await until(async () => (await p.locator('.mt-title').inputValue().catch(() => '')) === 'Pricing review', 10000)), 'a meeting on their page opens it')
  // People: the map and the list; finding someone; a merge and a split from a person's page.
  await openMeetings()
  await tabBtn('people').click({ timeout: 10000 })
  await p.locator('.mi-prow').first().waitFor({ timeout: 8000 })
  ok((await p.locator('.mi-prow').count()) === 5 && (await p.locator('.mi-map .mi-map-node').count()) === 5 && (await p.locator('.mi-map .mi-map-link').count()) === 3 && /From who was invited to your 9 recorded meetings.*Rooms, groups, mailboxes and you are left out/.test(await p.locator('[data-basis="people"]').innerText()),
    'People: everyone, on a map around you with a line between the three who meet each other, and in a list, saying where they come from and what\'s left out')
  ok(/^Met in the last 2 weeks 5$/.test((await p.locator('.mi-people .mt-fold-head').first().innerText()).replace(/\s+/g, ' ').trim()), 'the list in groups by when you last met, each saying how many')
  const pn = (await p.locator('.mi-prow[data-person] .mi-pnum').first().innerText()).replace(/\s+/g, ' ')
  ok(/^6 meetings \d+% of the talk$/.test(pn), 'each person\'s numbers say what they are: meetings, and their share of the talk', pn)
  const find = p.locator('.mi-find .mi-picker input')
  await find.click()
  ok(!!(await until(async () => /Met last[\s\S]*Met most/.test(await p.locator('.mi-picker-pop').innerText().catch(() => '')), 5000)), 'Find someone, with nothing typed: the people met last, then the ones met most')
  await find.fill('ber')
  ok(!!(await until(async () => (await p.locator('.mi-picker-opt').allInnerTexts()).length === 1 && /Ola Berg/.test(await p.locator('.mi-picker-opt').first().innerText()), 5000)) && (await p.locator('.mi-picker-opt mark').innerText()) === 'Ber', 'typing narrows it, the part that matched marked', await p.locator('.mi-picker-pop').innerText().catch(() => ''))
  await find.fill('l')
  await until(async () => (await p.locator('.mi-picker-opt').count()) >= 2, 5000)
  await find.press('ArrowDown')
  await find.press('Enter')
  await p.locator('.mi-person h3').waitFor({ timeout: 8000 })
  ok(['Lena Park', 'Ola Berg', 'Mia Chen'].includes(await p.locator('.mi-person h3').innerText()), 'arrows and Enter open someone', await p.locator('.mi-person h3').innerText())
  await p.locator('.mi-back').click()
  await p.locator('.mi-prow', { hasText: 'Lena Park' }).click()
  await p.locator('.mi-merge .mi-picker input').fill('Ola')
  await p.locator('.mi-merge .mi-picker-opt', { hasText: 'Ola Berg' }).click()
  ok(/Ola Berg/.test(await p.locator('.mi-merge').innerText()), 'The same person as… finds them, and asks before putting them together')
  await p.locator('.mi-merge .btn.primary', { hasText: 'Put together' }).click()
  ok(!!(await until(async () => (await p.locator('.mi-written li').count()) === 2, 8000)), 'Put together puts two together', await p.locator('.mi-person').innerText())
  await p.locator('.mi-written li', { hasText: 'Ola Berg' }).locator('button').click()
  ok(!!(await until(async () => (await p.locator('.mi-written li').count()) === 0 && /Taken out: that name is someone else now/.test(await p.locator('.mi-person').innerText()), 8000)), 'Not them takes a name out again')
  await p.locator('.mi-back').click()
  await whole(p, `${tag}insights-people`)
  // ⌘K: Meeting Insights and People You Meet, while it's on.
  await p.keyboard.press('ControlOrMeta+k')
  await p.waitForSelector('.pal-item', { timeout: 5000 })
  ok((await palette()).filter((x) => x === 'a:insights' || x === 'a:people').length === 2, '⌘K offers Meeting Insights and People You Meet')
  await p.locator('.palette input').fill('Meeting Insights')
  await p.locator('.pal-item[data-id="a:insights"]').click()
  ok(!!(await until(() => p.locator('.mi-tiles').isVisible(), 8000)), 'and opens them')
  ok(!real(desk.errors).length, 'no page errors', desk.errors)

  // ---------- At scale: half a year ----------
  const made = big()
  await kit.restart()
  const insAll = await api('/meetings/insights?days=180')
  const pplAll = await api('/meetings/people')
  ok(made >= 120 && insAll.meetings >= 120 && pplAll.people.length >= 120 && insAll.series.length >= 5 && !pplAll.people.some((x) => /schedule|room|team|otter|noreply|everyone/i.test(`${x.name} ${x.emails.join(' ')}`)),
    'half a year: over 120 meetings and 120 people, the series among them, and still nothing that isn\'t a person', { made, meetings: insAll.meetings, people: pplAll.people.length, series: insAll.series.map((x) => x.title) })
  const look = async (pg, name) => {
    await openMeetingsIn(pg)
    await pg.locator('.mt-view .seg button[data-view="insights"]').click({ timeout: 10000 })
    await pg.locator('.mi-bar button', { hasText: '6 months' }).click()
    await until(async () => Number((await pg.locator('.mi-tiles .us-tile-val').first().innerText().catch(() => '0')).replace(/\D/g, '')) >= 120, 15000)
    await whole(pg, `${tag}${name}-insights`)
    await pg.locator('.mt-view .seg button[data-view="people"]').click()
    await pg.locator('.mi-prow').first().waitFor({ timeout: 10000 })
    await whole(pg, `${tag}${name}-people`)
  }
  await p.reload()
  await look(p, 'scale')
  const groupsAt = (await p.locator('.mi-people > .mi-groups .mt-fold-head').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
  ok(groupsAt.length >= 2 && (await p.locator('.mi-prow').count()) <= 3 * 12 && (await p.locator('.mi-groups .mi-all').count()) >= 1, 'with over a hundred people: groups by when you last met, a dozen each until Show all', groupsAt)
  await p.locator('.mi-find .mi-picker input').fill('a')
  ok(!!(await until(async () => (await p.locator('.mi-picker-opt').count()) === 50 && /more: keep typing/.test(await p.locator('.mi-picker-pop').innerText()), 5000)), 'the picker shows 50 at most, and says to keep typing')
  await shot(p, `${tag}scale-picker`)
  await p.locator('.mi-find .mi-picker input').fill('priya')
  await p.locator('.mi-find .mi-picker input').press('Enter')
  await p.locator('.mi-person h3').waitFor({ timeout: 8000 })
  const pf = (await p.locator('.mi-person .mt-fold-head').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
  ok(pf.length >= 3 && (await p.locator('.mi-person .mt-fold.open').count()) === 1 && (await p.locator('.mi-person .mt-search').count()) === 1 && (await p.locator('.mi-person .mi-mrow').count()) === 12 && /^Show all \d+/.test(await p.locator('.mi-person .mt-fold.open .mi-all').innerText()),
    'a person with many meetings: by series, only the first open with a dozen of its meetings and Show all, and a search', pf)
  await whole(p, `${tag}scale-person`)
  // Meeting memory: 160 names, in folded groups.
  await openMeetings()
  await p.locator('.mt-view .pane-head button', { hasText: 'Memory' }).click()
  const mem = p.locator('.mt-dialog')
  await mem.locator('.mt-fold').first().waitFor({ timeout: 8000 })
  const memHeads = (await mem.locator('.mt-fold-head').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
  ok(memHeads.length >= 4 && /^Weekly payments sync \d+ in \d+ meetings$|^\S.* \d+ in \d+ meetings?$/.test(memHeads[0]) && (await mem.locator('.mt-fold.open').count()) === 1 && (await mem.locator('.mt-mem-item').count()) < 160,
    'meeting memory with 160 names: in groups by the series they come up in, each with how many and in how many meetings, only the first open', memHeads)
  await shot(p, `${tag}scale-memory-groups`)
  await mem.locator('.mt-mem-only button', { hasText: 'With a note' }).click()
  ok(!!(await until(async () => (await mem.locator('.mt-mem-note').count()) === 14 && (await mem.locator('.mt-mem-item').count()) === 14, 5000)), 'filtered: the 14 with a note, every group open with that few')
  await mem.locator('.mt-mem-only button', { hasText: 'All' }).first().click()
  await mem.locator('.mt-mem-tools .seg button', { hasText: 'By month' }).click()
  ok(!!(await until(async () => /^\w+ \d{4} \d+/.test((await mem.locator('.mt-fold-head').first().innerText()).replace(/\s+/g, ' ')), 5000)), 'by month')
  await mem.locator('.mt-mem-tools .seg button', { hasText: 'By meeting' }).click()
  await mem.locator('.mt-search').fill('ledger')
  ok(!!(await until(async () => (await mem.locator('.mt-mem-item').count()) === 1, 5000)), 'a search finds one among them')
  await mem.locator('.mt-mem-item .mt-mem-in').click()
  ok((await mem.locator('.mt-mem-meeting:not(.mt-mem-latest)').count()) >= 1, 'and lists the meetings it came up in')
  await shot(p, `${tag}scale-memory`)
  await mem.locator('.mt-mem-item .mt-mem-meeting').first().click()
  ok(!!(await until(async () => !(await p.locator('.mt-dialog').count()) && (await p.locator('.mt-title').count()) > 0, 8000)), 'one opens its meeting')
  // The same in a dark theme.
  const dark = await page(b, kit.url, { mode: 'dark', store: { 'cc-rail-meetings': true, 'cc-mi-range': '180' } })
  pages.push(dark)
  await look(dark.p, 'scale-dark')
  ok(!real(dark.errors).length && !real(desk.errors).length, 'no page errors, light or dark', [...desk.errors, ...dark.errors])

  // ---------- On a phone ----------
  for (const [width, mode] of [[375, 'light'], [390, 'light'], [390, 'dark'], [430, 'dark']]) {
    const ph = await page(b, kit.url, { phone: true, mode, store: { 'cc-mi-range': '180' } })
    pages.push(ph)
    await ph.p.setViewportSize({ width, height: 860 })
    await ph.p.locator('nav.tabbar button', { hasText: 'Meetings' }).click({ timeout: 20000 })
    await ph.p.locator('.m-meetings .seg button[data-view="insights"]').click({ timeout: 10000 })
    await ph.p.locator('.mi-tiles').waitFor({ timeout: 10000 })
    await ph.p.locator('.mi-heat rect').first().waitFor({ timeout: 10000 })
    let f = await phoneFaults(ph.p, '.m-meetings')
    ok(!Object.keys(f).length, `${width} ${mode}: Insights fits the phone`, f)
    const dates = await ph.p.locator('.mi-wdates span').evaluateAll((xs) => xs.filter((x) => x.textContent).map((x) => { const r = document.createRange(); r.selectNodeContents(x); const b = r.getBoundingClientRect(); return [b.left, b.right] }))
    ok(dates.length >= 2 && dates.every((d, i) => !i || d[0] >= dates[i - 1][1] + 2), `${width}: the weeks' dates don't run into each other`, dates)
    const hm = await ph.p.locator('.mi-heat svg').evaluate((e) => [e.getBoundingClientRect().right, e.closest('.us-card').getBoundingClientRect().right])
    ok(hm[0] <= hm[1], `${width}: the heatmap fits its card`, hm)
    await whole(ph.p, `${tag}insights-phone-${width}-${mode}`)
    await ph.p.locator('.m-meetings .seg button[data-view="people"]').click()
    await ph.p.locator('.mi-prow').first().waitFor({ timeout: 10000 })
    f = await phoneFaults(ph.p, '.m-meetings')
    ok(!Object.keys(f).length, `${width} ${mode}: People fits`, f)
    await whole(ph.p, `${tag}insights-people-phone-${width}-${mode}`)
    await ph.p.locator('.mi-find .mi-picker input').fill('priya')
    await ph.p.locator('.mi-picker-opt').first().waitFor({ timeout: 5000 })
    f = await phoneFaults(ph.p, '.m-meetings')
    ok(!Object.keys(f).length, `${width} ${mode}: the picker fits`, f)
    await ph.p.locator('.mi-picker-opt').first().click()
    await ph.p.locator('.mi-person h3').waitFor({ timeout: 10000 })
    f = await phoneFaults(ph.p, '.m-meetings')
    ok(!Object.keys(f).length, `${width} ${mode}: a person's page fits`, f)
    await whole(ph.p, `${tag}insights-person-phone-${width}-${mode}`)
    if (width === 390) {
      await ph.p.locator('.m-meetings .seg button[data-view="list"]').click()
      await ph.p.locator('.m-meetings button', { hasText: 'Memory' }).first().click()
      await ph.p.locator('.mt-dialog .mt-fold').first().waitFor({ timeout: 8000 })
      f = await phoneFaults(ph.p, '.mt-dialog')
      ok(!Object.keys(f).length, `${width} ${mode}: meeting memory fits`, f)
      await shot(ph.p, `${tag}memory-phone-${width}-${mode}`)
    }
    ok(!real(ph.errors).length, `${width}: no page errors`, ph.errors)
  }

  // ---------- Off again ----------
  // Turned off somewhere else (here, the API) with Insights open: this window drops it at once, no
  // reload and no waiting for its next look at /config, and Meetings is its list again once the list
  // has come (a Windows runner takes a second or more to read 150 meetings). After a reload, the same.
  await openMeetings()
  await tabBtn('insights').click({ timeout: 10000 })
  await p.locator('.mi-tiles').waitFor({ timeout: 10000 })
  await api('/settings', { trials: { 'meeting-insights': false } }, 'PATCH')
  ok((await err('/meetings/insights'))?.status === 404, 'turned off again: refused')
  const listed = async () => !(await tabBtn('insights').count()) && !(await tabBtn('people').count()) && !(await p.locator('.mi').count()) && (await p.locator('.mt-row').count()) > 0
  const shown = async () => ({ tabs: await tabBtn('insights').count(), mi: await p.locator('.mi').count(), rows: await p.locator('.mt-row').count() })
  ok(!!(await until(listed, 8000, 100)), 'turned off elsewhere: this window drops Insights and People at once, and Meetings is its list again', await shown())
  await p.reload()
  await openMeetings()
  ok(!!(await until(listed, 20000, 200)), 'and hidden after a reload: Meetings is its list again', await shown())
  ok(!(await api('/meetings')).insightsOn && (await api('/config')).trials['meeting-insights'] === false, 'turned off by hand, it stays off with all these meetings')

  // ---------- On by itself ----------
  // A computer of its own where Meeting Insights was never set: off with 4 meetings, on with the
  // fifth, said once on Meetings (with Turn off) and in Beta Features, and off for good once turned off.
  const own = await startKit('meeting-insights-auto', { config: { name: 'Tester' } })
  kits.push(own)
  await own.api('/setup', { name: 'Tester' })
  const write = meetingIn(own)
  for (let i = 1; i <= 4; i++) write(`a${i}`, { title: `Weekly sync ${i}`, when: at(i * 2, 10), seconds: 1500, people: ['Priya Shah', 'Dan Ruiz', 'Tester'] })
  let list = await own.api('/meetings')
  ok((await own.api('/config')).trials['meeting-insights'] === false && !list.insightsOn, '4 meetings: still off')
  write('a5', { title: 'Weekly sync 5', when: at(1, 10), seconds: 1500, people: ['Priya Shah', 'Dan Ruiz', 'Tester'] })
  list = await own.api('/meetings')
  const conf = await own.api('/config')
  ok(conf.trials['meeting-insights'] === true && list.insightsOn?.meetings === 5 && !!conf.trialsAuto?.['meeting-insights'] && (await own.api('/meetings/people')).people.length === 2,
    'the fifth: on by itself, People with it, said on Meetings and kept when', { trials: conf.trials, auto: conf.trialsAuto, note: list.insightsOn })
  const ow = await page(b, own.url, { store: { 'cc-rail-meetings': true } })
  pages.push(ow)
  await openMeetingsIn(ow.p)
  const note = ow.p.locator('.mt-insights-on')
  ok(!!(await until(() => note.isVisible(), 10000)) && /Meeting Insights is on\. With 5 meetings recorded on this computer, Insights and People add them up/.test(await note.innerText()) && (await note.locator('button', { hasText: 'Turn off' }).count()) === 1 && (await ow.p.locator('.mt-view .seg button[data-view="people"]').count()) === 1,
    'Meetings says so, with Show Insights and Turn off, and the Insights and People tabs are there', await note.innerText().catch(() => ''))
  await shot(ow.p, `${tag}insights-on-by-itself`)
  await ow.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } })))
  const beta = ow.p.locator('.st-check', { hasText: 'Meeting Insights' })
  ok(!!(await until(async () => /turns on by itself once 5 meetings are recorded here[\s\S]*Turned on by itself on \w+ \d+/.test(await beta.innerText().catch(() => '')), 10000)) && await beta.locator('input').isChecked(), 'Settings › About & Updates › Beta Features: on, saying it turned on by itself and when', await beta.innerText().catch(() => ''))
  await ow.p.reload()
  await openMeetingsIn(ow.p)
  await note.locator('button', { hasText: 'Turn off' }).click()
  ok(!!(await until(async () => !(await note.count()) && !(await ow.p.locator('.mt-view .seg button[data-view="insights"]').count()), 8000)) && (await own.api('/config')).trials['meeting-insights'] === false, 'Turn off: off, the note and the tabs gone')
  write('a6', { title: 'Weekly sync 6', when: at(0, 8), seconds: 1500, people: ['Priya Shah', 'Tester'] })
  ok((await own.api('/config')).trials['meeting-insights'] === false && !(await own.api('/meetings')).insightsOn, 'and it doesn\'t turn itself on again with more meetings')
  ok(!real(ow.errors).length, 'no page errors on that computer', ow.errors)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  for (const k of kits) k.stop()
}
process.exit(done().fail ? 1 : 0)
