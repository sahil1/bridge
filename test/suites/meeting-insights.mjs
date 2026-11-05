// Meeting Insights and the people you meet, a trial feature (meeting-insights), on any platform, in
// the browser named by BRIDGE_TEST_BROWSER. Off to start with: its routes refused saying how to turn
// it on, and nothing in Meetings or ⌘K leading to it. On with no meetings, Insights and People say
// what they need. Then nine made-up meetings in the data folder (calls with named lines, a room with
// voices told apart and one with none, one with nothing transcribed, one archived, one from months
// ago) and a calendar, through a stand-in for Bridge AI's calendar helper (native/bridgecal; not on
// Windows, where the stand-in is a script it can't start): the numbers exactly (how many, how long,
// your share of the talk, words spoken and heard, by week and by kind), what each is based on and
// the meetings that aren't counted; each meeting read once, and again only when it changes, also
// after a restart; the people, the same person put together across names and addresses, and a merge
// and a split by hand; a person's page with their meetings, open action items and next meeting; the
// calendar not allowed, then allowed. In the app: the tabs, the numbers and what they're based on, a
// kind picked, People, a person's page linking to a meeting, a merge and a split; on a phone, each
// fitting the screen.
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
// A request cut off by a reload, which WebKit reports as a page error.
const real = (errors) => errors.filter((e) => !/\/api\/[\w/.?=&-]+ due to access control checks/.test(e))

// ---------- The meetings, written as Bridge AI keeps them ----------
const DAY = 864e5
const at = (daysAgo, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d }
const meeting = (id, { title, when, seconds, people, event = {}, lines = [], named, voices, summary, ...more }) => {
  const d = path.join(kit.data, 'meetings', id)
  fs.mkdirSync(d, { recursive: true })
  const start = when.toISOString()
  fs.writeFileSync(path.join(d, 'meeting.json'), JSON.stringify({ id, title, status: 'done', kind: /interview/i.test(title) ? 'interview' : /standup/i.test(title) ? 'standup' : 'general', startedAt: start, endedAt: new Date(+when + seconds * 1000).toISOString(), seconds, call: 'on', event: people ? { title, attendees: people, ...event } : null, ...more }, null, 2))
  if (lines.length) fs.writeFileSync(path.join(d, 'transcript.jsonl'), lines.map(([src, t0, t1, text]) => JSON.stringify({ src, t0, t1, text, engine: 'test' })).join('\n') + '\n')
  if (named) fs.writeFileSync(path.join(d, 'speakers.json'), JSON.stringify(named))
  if (voices) fs.writeFileSync(path.join(d, 'voices.json'), JSON.stringify(voices))
  if (summary) fs.writeFileSync(path.join(d, 'summary.md'), summary)
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const weekOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x) }
const M1 = at(3, 10), M2 = at(10, 10), M3 = at(17, 10), M4 = at(24, 10), M5 = at(5, 15), M6 = at(2, 9), M7 = at(2, 9, 16), M8 = at(2, 9, 48), M9 = at(100, 10)
const seed = () => {
  // A 1:1 call: your mic and Priya's (the one person invited, so her lines are hers). On time.
  meeting('m1', { title: 'Pricing review', when: M1, seconds: 1800, people: ['Priya Shah', 'Tester'], event: { start: M1.toISOString(), end: new Date(+M1 + 1800e3).toISOString() },
    lines: [['you', 0, 10, 'Shall we look at the enterprise tiers today?'], ['them', 10, 40, 'Yes, that price needs a rethink soon.'], ['you', 40, 50, 'Good. What about the pilot?'], ['them', 50, 60, 'It starts in May.']],
    summary: '## Summary\n\n- The **Enterprise tier** needs a new price.\n\n## Action items\n\n- [ ] Priya Shah: send the pricing sheet\n- [ ] You: draft the pilot plan\n- [x] You: book the room\n' })
  // A weekly call with three others: Dan and "priya" named on the transcript, one line nobody named.
  meeting('m2', { title: 'Weekly payments sync', when: M2, seconds: 3600, people: ['Priya Shah', 'Dan Ruiz', 'Mia Chen', 'Tester'],
    lines: [['you', 0, 30, 'Morning all, let us start with the numbers.'], ['them', 30, 90, 'Revenue is up this week.'], ['them', 90, 120, 'Priya here, the dashboard is ready.'], ['them', 120, 150, 'One more thing on refunds.']],
    named: { 'them:30': { name: 'Dan Ruiz' }, 'them:90': { name: 'priya' } },
    summary: '## Summary\n\n- Revenue is up; the **Enterprise tier** sells.\n\n### Refunds\n\n- Fewer this week.\n\n## Action items\n\n- [ ] Dan: check refunds with Priya Shah\n' })
  // The same, in a room with nobody's voice told apart: who spoke isn't known.
  meeting('m3', { title: 'Weekly payments sync', when: M3, seconds: 3600, people: ['Priya Shah', 'Dan Ruiz', 'Mia Chen', 'Tester'], lines: [['you', 0, 20, 'We met in the room today.'], ['you', 20, 40, 'Someone else said this.']] })
  // The same, in a room with the voices told apart: one is you, one is Mia. Invited by address.
  meeting('m4', { title: 'Weekly payments sync', when: M4, seconds: 2700, people: ['Priya Shah <priya.shah@example.com>', 'dan.ruiz@example.com', 'Mia Chen', 'Tester'],
    lines: [['you', 0, 10, 'I will take the first part.'], ['you', 10, 40, 'Thanks, here is my update on the launch plan.'], ['you', 40, 45, 'Any questions?']],
    voices: { src: 'you', speakers: 2, line: { 'you:0': 1, 'you:10': 2, 'you:40': 1 }, names: { 1: { me: true }, 2: { name: 'Mia Chen' } } },
    summary: '## Summary\n\n### Launch plan\n\n- Mia shared the launch plan.\n' })
  // A customer: someone from another company's address. It ran ten minutes over.
  meeting('m5', { title: 'Onboarding call', when: M5, seconds: 1200, people: ['Ola Berg <ola@example.org>', 'Tester'], event: { start: M5.toISOString(), end: new Date(+M5 + 600e3).toISOString() },
    lines: [['you', 0, 20, 'Welcome aboard, how was setup?'], ['them', 20, 80, 'Smooth, thanks.']] })
  // Three back to back: a standup in a room, a review with nothing transcribed, an interview call.
  meeting('m6', { title: 'Daily standup', when: M6, seconds: 900, people: ['Priya Shah', 'Dan Ruiz', 'Tester'], lines: [['you', 0, 30, 'Yesterday I fixed the export.']] })
  meeting('m7', { title: 'Design review', when: M7, seconds: 1800, people: ['Mia Chen', 'Dan Ruiz', 'm.chen', 'Tester'] })
  meeting('m8', { title: 'Interview - Lena Park', when: M8, seconds: 1800, people: ['Lena Park', 'Tester'], lines: [['you', 0, 30, 'Tell me about your last project?'], ['them', 30, 60, 'I built a billing system.']] })
  // From months ago, and one archived.
  meeting('m9', { title: 'Old planning', when: M9, seconds: 3600, people: ['Priya Shah', 'Tester'] })
  meeting('m10', { title: 'Archived chat', when: at(4, 16), seconds: 600, people: ['Priya Shah', 'Tester'], archived: true })
}

try {
  await api('/setup', { name: 'Tester' })
  // ---------- Off to start with ----------
  const off = await err('/meetings/insights')
  ok((await api('/config')).trials?.['meeting-insights'] === false && off?.status === 404 && /Meeting Insights is a trial feature\. Turn it on in Settings › About & Updates › Trial Features/.test(off.message)
    && (await err('/meetings/people'))?.status === 404 && (await err('/meetings/people/merge', { a: 'x', b: 'y' }))?.status === 404,
  'a trial feature, off to start with: its routes answer 404, saying how to turn it on', { off: off?.message, trials: (await api('/config')).trials })
  const desk = await page(b, kit.url, { store: { 'cc-rail-meetings': true, 'cc-meet-tab': 'insights' } })
  pages.push(desk)
  const p = desk.p
  // Meetings, from the sidebar once the app is up.
  const openMeetings = async () => {
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click({ timeout: 20000 })
    await p.locator('.mt-view .pane-head').first().waitFor({ timeout: 15000 })
  }
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
  ok(!!(await until(async () => /No meetings to add up yet\..*Record a meeting and Insights adds it up here/s.test(await p.locator('.mi-empty').innerText().catch(() => '')), 8000)), 'Insights with no meetings says what it needs: a recorded meeting')
  await tabBtn('people').click()
  ok(!!(await until(async () => /Nobody here yet\..*Record a meeting and the people in it show up here/s.test(await p.locator('.mi-people').innerText().catch(() => '')), 8000)), 'and so does People')
  if (CAL) ok(/Connect your calendar to see when you next meet each person/.test(await p.locator('.mi-cal').innerText().catch(() => '')), 'the calendar not allowed: People says what it\'s for, with the way to allow it')
  else ok(!(await p.locator('.mi-cal').count()), 'no calendar on this computer: nothing asks for one')
  await shot(p, `${tag}insights-empty`)

  // ---------- The numbers ----------
  seed()
  ins = await api('/meetings/insights?days=90')
  ok(ins.reread === 9 && ins.total === 9 && ins.archived === 1, 'each finished meeting read once, the archived one left out', { reread: ins.reread, total: ins.total, archived: ins.archived })
  const again = await api('/meetings/insights?days=90')
  ok(again.reread === 0 && JSON.stringify({ ...again, reread: 0 }) === JSON.stringify({ ...ins, reread: 0 }), 'asked again: nothing read again, the same answer', again.reread)
  ok(ins.meetings === 8 && ins.seconds === 17400 && ins.prev?.meetings === 1 && ins.prev?.seconds === 3600, 'in the last 90 days: 8 meetings, 4 h 50 min, against 1 meeting of an hour in the 90 days before', { n: ins.meetings, s: ins.seconds, prev: ins.prev })
  ok(JSON.stringify(ins.talk) === JSON.stringify({ you: 115, others: 280, unknown: 0, told: 5, untold: { room: 2, noyou: 0, silent: 1 } }),
    'your share of the talk: 115 s of 395 s in the 5 meetings where who spoke is known (calls, and a room with you told apart); 2 rooms without voices and 1 with nothing transcribed aren\'t counted', ins.talk)
  ok(ins.words.you === 40 && ins.words.heard === 43, 'words: 40 spoken by you, 43 heard from others', ins.words)
  const wk = Object.fromEntries(ins.weeks.filter((w) => w.n).map((w) => [w.week, [w.n, w.seconds, w.you, w.talk]]))
  const want = {}
  for (const [d, s, you, talk] of [[M1, 1800, 20, 60], [M2, 3600, 30, 150], [M3, 3600, 0, 0], [M4, 2700, 15, 45], [M5, 1200, 20, 80], [M6, 900, 0, 0], [M7, 1800, 0, 0], [M8, 1800, 30, 60]]) {
    const w = want[weekOf(d)] || (want[weekOf(d)] = [0, 0, 0, 0])
    w[0]++; w[1] += s; w[2] += you; w[3] += talk
  }
  ok(JSON.stringify(Object.keys(wk).sort().map((k) => [k, wk[k]])) === JSON.stringify(Object.keys(want).sort().map((k) => [k, want[k]])) && ins.weeks.length >= 13 && ins.weeks.every((w, i) => !i || Date.parse(w.week) - Date.parse(ins.weeks[i - 1].week) >= 6 * DAY),
    'by week (Monday first): meetings, time and your talk in each, the weeks without meetings there too', { got: wk, want, weeks: ins.weeks.length })
  const kinds = Object.fromEntries(ins.kinds.map((k) => [k.id, k.n]))
  ok(JSON.stringify(kinds) === JSON.stringify({ one_on_one: 1, customer: 1, standup: 1, interview: 1, recurring: 3, group: 1 }),
    'by kind: a 1:1 (one other), a customer call (an address from another company), a standup and an interview (by name), a series of 3, a group', kinds)
  const share = Object.fromEntries(ins.byKind.map((k) => [k.id, Math.round((k.you / k.talk) * 100)]))
  ok(JSON.stringify(share) === JSON.stringify({ one_on_one: 33, customer: 25, interview: 50, recurring: 23 }), 'your share of the talk by kind, where who spoke is known', ins.byKind)
  const cust = await api('/meetings/insights?days=90&kind=customer')
  ok(cust.meetings === 1 && cust.seconds === 1200 && cust.talk.you === 20 && cust.talk.others === 60 && cust.kinds.length === 6, 'one kind picked: only its meetings, the other kinds still counted to pick from', { n: cust.meetings, talk: cust.talk })
  const s = ins.signals
  ok(s.questions.n === 5 && s.questions.meetings === 5 && s.longest.s === 20 && s.ranOver.n === 1 && s.ranOver.of === 2 && s.backToBack.days === 1 && s.followed.done === 1 && s.followed.of === 2,
    'signals: 5 questions in 5 meetings, your longest stretch 20 s on average, 1 of 2 with an invite ran over, 1 day back to back, 1 of your 2 action items done', s)
  const all = await api('/meetings/insights?days=all')
  const d30 = await api('/meetings/insights?days=30')
  ok(all.meetings === 9 && all.seconds === 21000 && all.prev === null && d30.meetings === 8, 'all of them: 9 (the one from months ago too); the last 30 days: 8', { all: all.meetings, d30: d30.meetings })
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
  ok(priya && JSON.stringify(priya.also) === JSON.stringify(['priya']) && JSON.stringify(priya.emails) === JSON.stringify(['priya.shah@example.com']) && dan?.emails[0] === 'dan.ruiz@example.com',
    'the same person put together: "priya" on a transcript where only Priya Shah was invited, and an address with her name; dan.ruiz@example.com is Dan Ruiz', { priya, dan })
  ok(!!by('M Chen') && mia?.meetings === 4, '"m.chen" isn\'t taken for Mia Chen: not clear enough to put together', by('M Chen'))
  ok(priya.share?.pct === 33 && priya.share.meetings === 2 && dan.share?.pct === 40 && mia.share?.pct === 67 && by('Ola Berg').share?.pct === 67 && !by('M Chen').share,
    'each one\'s share of the talk, in the meetings where their lines are named', ppl.people.map((x) => [x.name, x.share]))
  ok(priya.last === M6.toISOString() && priya.seconds === 1800 + 3600 + 3600 + 2700 + 900 + 3600 && priya.topics[0] === 'Enterprise tier' && priya.topics.includes('Refunds'),
    'when you last met, the time together, and what you talk about, from the words in your summaries', { last: priya.last, s: priya.seconds, topics: priya.topics })
  if (CAL) ok(ppl.calendar.ok === false && ppl.calendar.code === 'calendarAccess' && ppl.people.every((x) => !x.next), 'the calendar not allowed: said, and no next meetings', ppl.calendar)
  else ok(ppl.calendar.ok === false && ppl.calendar.code === 'platform', 'no calendar on this computer: said as such, to hide it', ppl.calendar)

  // A person's page: their meetings, open action items, the next one.
  let pg = await api(`/meetings/people/${encodeURIComponent(priya.id)}`)
  ok(JSON.stringify(pg.meetingsList.map((x) => [x.id, x.pct])) === JSON.stringify([['m6', null], ['m1', 67], ['m2', 20], ['m3', null], ['m4', null], ['m9', null]]),
    'a person\'s page lists every meeting with them, newest first, with their share where it\'s known', pg.meetingsList)
  ok(JSON.stringify(pg.items.map((x) => [x.text, x.meeting.id])) === JSON.stringify([['send the pricing sheet', 'm1'], ['check refunds with Priya Shah', 'm2']]), 'the action items still open that are theirs or name them, each with its meeting', pg.items)
  if (CAL) {
    const soon = new Date(Date.now() + 2 * DAY); soon.setHours(11, 0, 0, 0)
    fs.writeFileSync(path.join(kit.bin, 'bridgecal.json'), JSON.stringify({ status: 'granted', events: [
      { title: 'Pricing follow-up', calendar: 'Work', start: soon.toISOString(), end: new Date(+soon + 1800e3).toISOString(), allDay: false, attendees: ['Priya Shah', 'Tester'] },
      { title: 'Lunch', calendar: 'Home', start: new Date(+soon + 3 * 3600e3).toISOString(), end: new Date(+soon + 4 * 3600e3).toISOString(), allDay: false, attendees: [] },
    ] }))
    pg = await api(`/meetings/people/${encodeURIComponent(priya.id)}`)
    ppl = await api('/meetings/people')
    ok(pg.calendar.ok && pg.next?.title === 'Pricing follow-up' && pg.next.start === soon.toISOString() && by('Priya Shah').next?.title === 'Pricing follow-up' && !by('Dan Ruiz').next, 'allowed: the next meeting with them, from the calendar', { next: pg.next, cal: pg.calendar })
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
  ok(!!(await until(async () => (await tiles()).join('|') === '8|4 h 50 min|31%|44 / 43', 10000)), 'Insights: 8 meetings, 4 h 50 min, you spoke 31% of the talk, 44 words spoken and 43 heard', await tiles())
  const basis = await p.locator('[data-basis="talk"]').innerText().catch(() => '')
  ok(/From 5 meetings where who spoke is known: on a call, your mic and the call's sound; in a room, voices told apart and one of them you\. 2 in a room without the voices told apart aren't counted\. 1 with nothing transcribed isn't counted\./.test(basis), 'what your share of the talk is based on, and what isn\'t counted', basis)
  ok(/Worked out on this computer from 9 recorded meetings/.test(await p.locator('.mi-lede').innerText()) && /Archived meetings are left out/.test(await p.locator('.mi-lede').innerText()), 'and where it all comes from')
  const sig = await p.locator('.mi-signals').innerText()
  ok(/Questions you asked\s+1 a meeting\s+Your lines with a question mark/.test(sig) && /Meetings that ran over\s+1 of 2/.test(sig) && /Attention, productivity\s+not shown\s+Nothing in a recording shows them/.test(sig), 'the signals, each with what it\'s worked out from, and no score of attention', sig)
  ok((await p.locator('.mi-weeks .us-col').count()) === ins.weeks.length, 'a column for each week')
  await p.locator('.mi-kinds button[data-kind="customer"]').click()
  ok(!!(await until(async () => (await tiles())[0] === '1', 8000)) && /Customer calls: Someone invited from another company/.test(await p.locator('.mi-why').innerText().catch(() => '')), 'a kind picked: its numbers, and what makes a meeting that kind', await tiles())
  await p.locator('.mi-kinds button', { hasText: 'All kinds' }).click()
  await shot(p, `${tag}insights`)
  // From Insights' people to a person's page, and on to a meeting.
  await p.locator('.mi-grid .us-row', { hasText: 'Priya Shah' }).click()
  await p.locator('.mi-person h3').waitFor({ timeout: 8000 })
  ok((await p.locator('.mi-person h3').innerText()) === 'Priya Shah' && (await p.locator('.mi-mrow').count()) === 6 && (await p.locator('.mi-items li').count()) === 2, 'a person\'s page: their meetings and open action items')
  if (CAL) ok(!!(await until(async () => /Next: Pricing follow-up, /.test(await p.locator('.mi-next').innerText().catch(() => '')), 8000)) && !(await p.locator('.mi-cal').count()), 'and the next meeting with them, from the calendar')
  await shot(p, `${tag}insights-person`)
  await p.locator('.mi-mrow[data-meeting="m1"]').click()
  ok(!!(await until(async () => (await p.locator('.mt-title').inputValue().catch(() => '')) === 'Pricing review', 10000)), 'a meeting on their page opens it')
  // People: the map and the list; a merge and a split from a person's page.
  await openMeetings()
  await tabBtn('people').click({ timeout: 10000 })
  await p.locator('.mi-prow').first().waitFor({ timeout: 8000 })
  ok((await p.locator('.mi-prow').count()) === 5 && (await p.locator('.mi-map .mi-map-node').count()) === 5 && /From who was invited to your 9 recorded meetings/.test(await p.locator('[data-basis="people"]').innerText()), 'People: everyone, on a map around you and in a list, saying where they come from')
  await p.locator('.mi-prow', { hasText: 'Lena Park' }).click()
  await p.locator('.mi-merge select').selectOption({ label: 'Ola Berg' })
  await p.locator('.mi-merge button').click()
  ok(!!(await until(async () => (await p.locator('.mi-written li').count()) === 2, 8000)), 'The same person as… puts two together', await p.locator('.mi-person').innerText())
  await p.locator('.mi-written li', { hasText: 'Ola Berg' }).locator('button').click()
  ok(!!(await until(async () => (await p.locator('.mi-written li').count()) === 0 && /Taken out: that name is someone else now/.test(await p.locator('.mi-person').innerText()), 8000)), 'Not them takes a name out again')
  await shot(p, `${tag}insights-people`)
  // ⌘K: Meeting Insights and People You Meet, while it's on.
  await p.keyboard.press('ControlOrMeta+k')
  await p.waitForSelector('.pal-item', { timeout: 5000 })
  ok((await palette()).filter((x) => x === 'a:insights' || x === 'a:people').length === 2, '⌘K offers Meeting Insights and People You Meet')
  await p.locator('.palette input').fill('Meeting Insights')
  await p.locator('.pal-item[data-id="a:insights"]').click()
  ok(!!(await until(() => p.locator('.mi-tiles').isVisible(), 8000)), 'and opens them')
  ok(!real(desk.errors).length, 'no page errors', desk.errors)

  // ---------- On a phone ----------
  for (const [width, mode] of [[375, 'light'], [430, 'dark']]) {
    const ph = await page(b, kit.url, { phone: true, mode })
    pages.push(ph)
    await ph.p.setViewportSize({ width, height: 860 })
    await ph.p.locator('nav.tabbar button', { hasText: 'Meetings' }).click({ timeout: 20000 })
    await ph.p.locator('.m-meetings .seg button[data-view="insights"]').click({ timeout: 10000 })
    await ph.p.locator('.mi-tiles').waitFor({ timeout: 10000 })
    let f = await phoneFaults(ph.p, '.m-meetings')
    ok(!Object.keys(f).length, `${width}: Insights fits the phone`, f)
    await shot(ph.p, `${tag}insights-phone-${width}`, { fullPage: true })
    await ph.p.locator('.m-meetings .seg button[data-view="people"]').click()
    await ph.p.locator('.mi-prow').first().waitFor({ timeout: 10000 })
    f = await phoneFaults(ph.p, '.m-meetings')
    ok(!Object.keys(f).length, `${width}: People fits`, f)
    await ph.p.locator('.mi-prow', { hasText: 'Priya Shah' }).click()
    await ph.p.locator('.mi-person h3').waitFor({ timeout: 10000 })
    f = await phoneFaults(ph.p, '.m-meetings')
    ok(!Object.keys(f).length, `${width}: a person's page fits`, f)
    await shot(ph.p, `${tag}insights-person-phone-${width}`, { fullPage: true })
    ok(!real(ph.errors).length, `${width}: no page errors`, ph.errors)
  }

  // ---------- Off again ----------
  await api('/settings', { trials: { 'meeting-insights': false } }, 'PATCH')
  ok((await err('/meetings/insights'))?.status === 404, 'turned off again: refused')
  await p.reload()
  await openMeetings()
  ok(!(await tabBtn('insights').count()) && !(await p.locator('.mi').count()) && (await p.locator('.mt-search, .mt-empty, .mt-row').count()) > 0, 'and hidden: Meetings is its list again')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const w of pages) await w.ctx.close().catch(() => {})
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
