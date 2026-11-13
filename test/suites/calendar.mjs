// The calendar (Today › Calendar, server/calendar.js) and AI Assist's Prepare for this meeting
// (server/meetprep.js), in the
// browser named BRIDGE_TEST_BROWSER, through a stand-in for Bridge AI's calendar helper
// (native/bridgecal; not on Windows, where the stand-in is a script it can't start). A realistic week
// on four calendars (one with no colour of its own): a standup every day, meetings that overlap, a
// two-day all-day event, one you organised, one you said maybe to, one you declined, one not answered
// yet, the weekend's family events; today, a meeting starting in eight minutes with people you've met
// and one you haven't (known from Meeting Insights, a beta feature: with it off, only who's invited
// is said), one later with the files in its invite, one this morning that was recorded, a big one
// later with every kind of reply and a long invite, and a focus block with no one else; an all-hands
// with 180 invited. Three earlier meetings recorded, Chief of Staff's tasks that
// name a day, and on a Mac, Mail with a thread from one of them and one you sent that's had no reply.
// Checks: each calendar keeps its colour from week to week (its own, or one from its name); hiding
// one takes it off the grid and off the Schedule, kept on the server, and a click brings it back;
// week start and working hours; tasks on their day; your answer to each invite shown, never changed;
// the event panel's parts (who's invited, with their addresses, replies and roles, and who you've
// met, as Google Calendar shows them; the invite's words, files and call; the recorded meeting's
// notes and action items, the prep, AI Assist at the right end of its buttons), and "3 invited" on
// the floating card, Home and the Schedule opening to them; the same through icalBuddy, with no
// replies, on a Mac; Open in Calendar (this Mac's id for an
// event and whether it repeats, Calendar's link to it opened in Calendar itself, both stood in for,
// saying so or what macOS said; none for an event with no id here, from a phone or another computer,
// or off a Mac); the prep with no model (all the rest,
// and how to add one), then with the stand-in
// model: what it's sent and what's shown, kept, Again, by itself shortly before, and on the floating
// card. The calendar helper is only ever asked to read. Screenshots at 1440 and on a 390 phone,
// light and dark. It holds on any day at any time: BRIDGE_TEST_CLOCK=HH:MM (or "Fri 16:05", that day
// this week) runs the server (stand-ins/clock.mjs) and every page then, to try one.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults, noServiceWorker, changeAnswer, IS_WIN, IS_MAC, TEST } from '../lib/harness.mjs'
import { openStandIn } from '../stand-ins/mailbox.mjs'

const { ok, skip, done } = checks('calendar')
if (IS_WIN) {
  skip('the calendar and its meeting prep', 'the stand-in calendar helper is a script Windows can\'t start')
  process.exit(done().fail ? 1 : 0)
}

// ---------- The week ----------
const DAY = 864e5
// The time it's run at, or the one BRIDGE_TEST_CLOCK names (today, or that weekday of this week from
// Monday; this computer's time), which the server and the pages then run from.
const CLOCK = /^(?:(sun|mon|tue|wed|thu|fri|sat)\w*\s+)?(\d\d):(\d\d)$/i.exec(process.env.BRIDGE_TEST_CLOCK || '')
const NOW = (() => {
  if (!CLOCK) return Date.now()
  const d = new Date()
  if (CLOCK[1]) d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + ((['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(CLOCK[1].toLowerCase()) + 6) % 7))
  return d.setHours(+CLOCK[2], +CLOCK[3], 0, 0)
})()
const OFFSET = NOW - Date.now()
if (CLOCK) console.log(`calendar: run at ${new Date(NOW).toString()}`)
const monday = (() => { const d = new Date(NOW); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d })()
const at = (day, h, m = 0) => { const d = new Date(monday); d.setDate(d.getDate() + day); d.setHours(h, m, 0, 0); return d }
const ymd = (d) => new Date(d).toLocaleDateString('en-CA')
const mins = (n) => new Date(NOW + n * 60e3)
const COLORS = { Work: '#1badf8', Personal: '#63da38', 'Team Rota': '', Family: '#ff9500' }
const ev = (title, calendar, start, end, more = {}) => ({ title, calendar, start: start.toISOString(), end: end.toISOString(), allDay: false, location: '', canceled: false, color: COLORS[calendar], uid: `uid-${title.toLowerCase().replace(/\W+/g, '-')}`, response: 'accepted', url: '', notes: '', attendees: [], emails: [], ...more })
const team = ['Tester', 'Maya Okafor', 'Leo Brandt']
const week = (off) => [
  ...[0, 1, 2, 3, 4].map((d) => ev('Daily standup', 'Work', at(off + d, 9, 30), at(off + d, 9, 45), { uid: 'uid-standup', local: 'EK-STANDUP', repeats: true, attendees: team, emails: ['maya.okafor@example.org', 'leo.brandt@example.org'] })),
  ev('Northwind renewal review', 'Work', at(off, 10), at(off, 11), { attendees: [...team, 'Ravi Menon'] }),
  ev('Design crit', 'Work', at(off, 10, 30), at(off, 11, 30), { response: 'tentative', attendees: ['Tester', 'Ines Varga'] }),
  { ...ev('Offsite prep', 'Team Rota', at(off + 1, 0), at(off + 3, 0)), allDay: true, response: '' },
  ev('Lunch with Sam', 'Personal', at(off + 2, 12), at(off + 2, 13), { response: 'organizer', attendees: ['Tester', 'Sam Ortiz'] }),
  ev('Vendor pitch: Contoso', 'Work', at(off + 3, 14), at(off + 3, 15), { response: 'declined', attendees: ['Tester', 'Pat Lin'], organizer: 'Pat Lin' }),
  ev('Week wrap', 'Work', at(off + 4, 16), at(off + 4, 16, 30), { response: 'none', attendees: team }),
  { ...ev('Football practice', 'Family', at(off + 5, 0), at(off + 6, 0)), allDay: true, response: '' },
  ev('Dinner with the Okafors', 'Family', at(off + 6, 18), at(off + 6, 19, 30), { response: '' }),
]
// Who's invited as bridgecal says them: name, address, reply, role, who organised it and you.
const guest = (name, email, status, more = {}) => ({ name, email, status, role: 'required', organizer: false, you: false, ...more })
const SOON = ev('Northwind pricing sync', 'Work', mins(8), mins(38), {
  uid: 'uid-np-sync', local: 'EK-SOON', organizer: 'Maya Okafor',
  attendees: ['Tester', 'Maya Okafor', 'Leo Brandt', 'Ravi Menon'],
  emails: ['tester@example.com', 'maya.okafor@example.org', 'leo.brandt@example.org', 'ravi.menon@example.org'],
  guests: [guest('Tester', 'tester@example.com', 'accepted', { you: true }), guest('Maya Okafor', 'maya.okafor@example.org', 'accepted', { role: 'chair', organizer: true }), guest('Leo Brandt', 'leo.brandt@example.org', 'tentative'), guest('Ravi Menon', 'ravi.menon@example.org', 'pending', { role: 'optional' })],
  notes: 'Agree the renewal price and the seat count for Q1.\n\nhttps://northwind.sharepoint.com/:p:/s/sales/renewal-deck.pptx\n________________\nMicrosoft Teams meeting\nJoin: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc',
})
// Its invite says a lot in one line: longer than the agenda the calendar keeps.
const LONG_AGENDA = 'Walk through onboarding v2 before it goes to engineering, then agree which of the three empty-state designs ships first, who writes the copy for the welcome screens, and whether the import step can wait for the second release without hurting activation in the pilot accounts.'
const LATER = ev('Design review with Ines', 'Work', mins(180), mins(225), { local: 'EK-LATER', response: 'none', attendees: ['Tester', 'Ines Varga'], notes: `${LONG_AGENDA}\nhttps://docs.google.com/document/d/onboarding-v2/edit` })
const RECORDED = ev('Quarterly planning', 'Work', mins(-180), mins(-120), { attendees: ['Tester', 'Maya Okafor', 'Ines Varga'] })
// A big invite, later today: its organizer not on the invite's own list, eleven others besides you
// (one by an address alone) with every kind of reply, one optional, and a room and a team list
// invited with them, who aren't people. Its words run long, with an Outlook safe link, and end in
// Teams' join details with a passcode.
const KICKOFF_GUESTS = [
  guest('Priya Shah', 'priya.shah@example.org', 'accepted', { role: 'chair', organizer: true }),
  guest('Tester', 'tester@example.com', 'accepted', { you: true }),
  guest('Maya Okafor', 'maya.okafor@example.org', 'accepted'),
  guest('Leo Brandt', 'leo.brandt@example.org', 'declined'),
  guest('Ines Varga', 'ines.varga@example.org', 'tentative'),
  guest('Ravi Menon', 'ravi.menon@example.org', 'pending'),
  guest('Sam Ortiz', 'sam.ortiz@example.org', 'accepted', { role: 'optional' }),
  guest('Pat Lin', 'pat.lin@example.org', 'declined'),
  guest('Dana Whit', 'dana.whit@example.org', 'accepted'),
  guest('Omar Haddad', 'omar.haddad@example.org', 'pending'),
  guest('Kim Sato', 'kim.sato@example.org', 'accepted'),
  guest('', 'lena.fischer@example.org', 'pending'),
  guest('Boardroom 4 (12)', 'boardroom4@example.org', 'accepted', { role: '' }),
  guest('Payments Team', 'payments-team@example.org', 'pending'),
]
const KICKOFF_NOTES = "Kick off the Northwind launch: scope, owners and the first milestone.\n\nAgenda\n- Scope and what's out\n- Owners for each workstream\n- The first milestone's date\n\nBrief: https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fnorthwind.sharepoint.com%2F%3Aw%3A%2Fs%2Flaunch%2Fbrief.docx&data=05\nBoard: https://miro.com/app/board/kickoff=/\nI???ll share the timeline before we meet.\n________________________________________________________________________________\nMicrosoft Teams meeting\nJoin on your computer, mobile app or room device\nClick here to join the meeting: https://teams.microsoft.com/l/meetup-join/19%3akickoff\nMeeting ID: 123 456 789\nPasscode: Xy9abc"
const KICKOFF = ev('Northwind launch kickoff', 'Work', mins(240), mins(285), {
  local: 'EK-KICKOFF', organizer: 'Priya Shah', response: 'accepted', notes: KICKOFF_NOTES,
  attendees: KICKOFF_GUESTS.slice(1).map((g) => g.name || g.email), emails: KICKOFF_GUESTS.slice(1).map((g) => g.email), guests: KICKOFF_GUESTS,
})
const FOCUS = ev('Focus time', 'Personal', mins(300), mins(360), { response: '' })
const DECLINED = ev('Budget office hours', 'Work', mins(60), mins(90), { response: 'declined', attendees: ['Tester', 'Pat Lin'] })
// Two weeks on, only the week's own meetings (nothing set by the time it's run): the one the grid's
// hours are checked on. Four weeks on, a release window from 11 PM to half past midnight.
const LATE = ev('Release window', 'Work', at(32, 23), at(33, 0, 30), { attendees: ['Tester', 'Leo Brandt'] })
// An all-hands three weeks on, with 180 invited: more than an event carries.
const MANY = Array.from({ length: 180 }, (_, i) => guest(`Person ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} Example`, `person${i}@example.org`, ['accepted', 'pending', 'declined'][i % 3]))
const ALLHANDS = ev('Company all-hands', 'Work', at(23, 16), at(23, 17), { organizer: MANY[0].name, attendees: MANY.map((g) => g.name), emails: MANY.map((g) => g.email), guests: MANY.map((g, i) => ({ ...g, organizer: i === 0 })) })
// The weeks' own meetings keep clear of the hours the checks about now use (from 4 hours before to 7
// after: last time, the next meeting, the one later): one that would fall there moves, on its own
// day, to the nearest half hour that doesn't, so "the next meeting" is always the one meant, on any
// day at any time. Every title is its own: none is also one of today's.
const AWAY = [NOW - 4 * 3600e3, NOW + 7 * 3600e3]
const clear = (e) => {
  const s = Date.parse(e.start), len = Date.parse(e.end) - s
  const free = (x) => x + len <= AWAY[0] || x >= AWAY[1]
  if (e.allDay || free(s)) return e
  const day = new Date(s).setHours(0, 0, 0, 0)
  const slot = Array.from({ length: 48 }, (_, i) => day + i * 30 * 60e3).filter((x) => free(x) && x + len <= day + DAY).sort((a, b) => Math.abs(a - s) - Math.abs(b - s))[0]
  return { ...e, start: new Date(slot).toISOString(), end: new Date(slot + len).toISOString() }
}
const FIXED = [...week(-7), ...week(0), ...week(7), ...week(14)].map(clear)
const OWN = [SOON, LATER, RECORDED, FOCUS, DECLINED, LATE, KICKOFF, ALLHANDS]
const EVENTS = [...FIXED, ...OWN]
if (new Set(OWN.map((e) => e.title)).size !== OWN.length || FIXED.some((e) => OWN.some((x) => x.title === e.title))) throw new Error('every seeded title must be its own')

// The calendar helper: answers from bridgecal.json, and writes down every way it was asked.
const helper = (bin) => {
  fs.writeFileSync(path.join(bin, 'bridgecal.cjs'), `const fs = require('node:fs'), path = require('node:path')
fs.appendFileSync(path.join(__dirname, 'bridgecal.log'), JSON.stringify(process.argv.slice(2)) + '\\n')
const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'bridgecal.json'), 'utf8'))
const cmd = process.argv[2]
if (cmd === 'events' && c.status === 'granted') {
  const from = new Date(process.argv[3] + 'T00:00:00'), to = new Date(process.argv[4] + 'T00:00:00'); to.setDate(to.getDate() + 1)
  const out = c.events.filter((e) => new Date(e.start) < to && new Date(e.end) > from)
  process.stdout.write(JSON.stringify(process.argv[5] === 'light' ? out.map(({ notes, url, attendees, emails, organizer, guests, ...e }) => e) : out)); process.exit(0)
}
// A bridgecal from before it could read: it only says it may, and icalBuddy reads instead.
if (c.status === 'old') { process.stdout.write('granted\\n'); process.exit(0) }
process.stdout.write(c.status + '\\n')
process.exit(cmd === 'events' ? 3 : 0)`)
  fs.writeFileSync(path.join(bin, 'bridgecal'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'bridgecal.cjs')}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'bridgecal.json'), JSON.stringify({ status: 'granted', events: EVENTS }))
  return path.join(bin, 'bridgecal')
}
// No model on this computer's own servers either, whatever this computer has running.
const shifted = CLOCK ? { NODE_OPTIONS: `--import=${pathToFileURL(path.join(TEST, 'stand-ins', 'clock.mjs')).href}`, BRIDGE_TEST_CLOCK_OFFSET: String(OFFSET) } : {}
const kit = await startKit('calendar', { env: ({ bin }) => ({ BRIDGE_CALASK: helper(bin), BRIDGE_PREP_EVERY_MS: '1000', OLLAMA_HOST: 'http://127.0.0.1:9', LM_STUDIO_BASE_URL: 'http://127.0.0.1:9/v1', ...shifted }) })
const model = await startModel('calendar')
// Calendar on this Mac and macOS's open, for Open in Calendar: stood in for.
const opener = openStandIn(kit, ['Calendar'])
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const err = (p, body, method) => api(p, body, method).then(() => null, (e) => e)
const pages = []
// A request cut off by a reload, which WebKit reports as a page error.
const real = (errors) => errors.filter((e) => !/\/api\/\S+ due to access control checks/.test(e))

// ---------- Meetings already recorded, as Bridge AI keeps them ----------
const meeting = (id, { title, when, seconds, people, summary, event = {} }) => {
  const d = path.join(kit.data, 'meetings', id)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'meeting.json'), JSON.stringify({ id, title, status: 'done', kind: 'general', startedAt: when.toISOString(), endedAt: new Date(+when + seconds * 1000).toISOString(), seconds, call: 'on', event: { title, attendees: people, ...event } }, null, 2))
  fs.writeFileSync(path.join(d, 'summary.md'), summary)
}
meeting('2000-01-01-np0001', { title: 'Northwind pricing sync', when: new Date(NOW - 7 * DAY), seconds: 1800, people: team, summary: '## Summary\n- Maya wants a three-year term if the price holds.\n- The seat count is still open: 40 or 55.\n\n## Action items\n- [ ] You: send the revised quote to Maya\n- [ ] Maya: confirm the seat count\n- [x] Leo: share the usage report\n' })
meeting('2000-01-02-ds0002', { title: 'Design review with Ines', when: new Date(NOW - 14 * DAY), seconds: 2700, people: ['Tester', 'Ines Varga'], summary: '## Summary\n- The empty states need work before launch.\n\n## Action items\n- [ ] Ines: mock up the empty states\n' })
meeting('2000-01-03-qp0003', { title: 'Quarterly planning', when: new Date(RECORDED.start), seconds: 3300, people: RECORDED.attendees, event: { start: RECORDED.start, end: RECORDED.end }, summary: '## Summary\n- The Q1 hiring plan is approved.\n- The budget review moves to December.\n\n## Action items\n- [ ] You: draft the Q1 hiring plan\n- [x] Maya: book the room\n' })

// ---------- Mail, on a Mac: a thread from Maya, and what you sent Ravi with no reply yet ----------
const s = Math.floor(NOW / 1000)
const MAIL = `
CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY, url TEXT);
CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY, address TEXT, comment TEXT);
CREATE TABLE subjects (ROWID INTEGER PRIMARY KEY, subject TEXT);
CREATE TABLE recipients (ROWID INTEGER PRIMARY KEY, message INTEGER, address INTEGER, type INTEGER);
CREATE TABLE attachments (ROWID INTEGER PRIMARY KEY, message INTEGER, attachment_id TEXT, name TEXT);
CREATE TABLE messages (ROWID INTEGER PRIMARY KEY, read INTEGER, flagged INTEGER, deleted INTEGER, date_received INTEGER, date_sent INTEGER, mailbox INTEGER, sender INTEGER, subject INTEGER, global_message_id INTEGER, summary INTEGER, conversation_id INTEGER, automated_conversation INTEGER);
CREATE TABLE message_global_data (ROWID INTEGER PRIMARY KEY, model_category INTEGER, model_high_impact INTEGER, message_id_header TEXT, generated_summary INTEGER);
CREATE TABLE summaries (ROWID INTEGER PRIMARY KEY, summary TEXT); CREATE TABLE generated_summaries (ROWID INTEGER PRIMARY KEY, summary BLOB);
INSERT INTO mailboxes VALUES (1, 'ews://ABC/Inbox'), (2, 'ews://ABC/Sent Items');
INSERT INTO addresses VALUES (1, 'maya.okafor@example.org', 'Maya Okafor'), (2, 'tester@example.com', 'Tester'), (3, 'news@example.com', 'Shop'), (4, 'ravi.menon@example.org', 'Ravi Menon');
INSERT INTO subjects VALUES (1, 'Seat count for the renewal'), (2, 'This week''s deals'), (3, 'Intro and the renewal deck');
INSERT INTO recipients VALUES (1, 1, 2, 0), (2, 2, 2, 0), (3, 3, 4, 0);
INSERT INTO summaries VALUES (1, 'Maya asks whether 55 seats still works for Q1.');
INSERT INTO message_global_data (ROWID, model_category, message_id_header) VALUES (1, 0, '<m1@example.com>'), (2, 3, '<m2@example.com>'), (3, 0, '<m3@example.com>');
INSERT INTO messages (ROWID, read, flagged, deleted, date_received, date_sent, mailbox, sender, subject, global_message_id, summary, conversation_id) VALUES
  (1, 0, 0, 0, ${s - DAY / 1000}, ${s - DAY / 1000 - 60}, 1, 1, 1, 1, 1, 21),
  (2, 0, 0, 0, ${s - 7200}, ${s - 7300}, 1, 3, 2, 2, NULL, 0),
  (3, 1, 0, 0, ${s - 2 * DAY / 1000}, ${s - 2 * DAY / 1000}, 2, 2, 3, 3, NULL, 22);
`
let mailOn = false
if (IS_MAC) {
  const dir = path.join(kit.home, 'Library', 'Mail', 'V10', 'MailData')
  fs.mkdirSync(dir, { recursive: true })
  mailOn = spawnSync('sqlite3', [path.join(dir, 'Envelope Index')], { input: MAIL, encoding: 'utf8' }).status === 0
}

// The calendar in the app: Today › Calendar, full size, at an event (as the floating card and Home
// open it), or at a week.
const LAYOUT = { railW: 232, railOpen: true, dockW: 380, dockMin: false, boardH: 280, boardMin: false, sideW: 560, max: 'dock', todayOpen: true }
const open = async (look = {}) => {
  const pg = await page(b, kit.url, { width: 1440, height: 900, ...look, store: { 'cc-layout': LAYOUT, 'cc-today-tab': 'calendar', 'cc-cal-mode': 'week', ...(look.store || {}) }, before: async (c) => { await setUp(c); await look.before?.(c) } })
  pages.push(pg)
  await pg.p.waitForSelector(look.phone ? '.tabbar' : '.calv', { timeout: 20000 }).catch(() => {})
  return pg
}
// Each page runs at the test's time, as the server does.
const setUp = async (c) => { await noServiceWorker(c); if (CLOCK) await c.clock.install({ time: Date.now() + OFFSET }) }
const openEvent = (p, e, { busy = 0 } = {}) => p.evaluate(({ d, busy }) => { window.dispatchEvent(new CustomEvent('bridge-open-event', { detail: d })); for (const t = Date.now(); Date.now() - t < busy;); }, { d: { date: ymd(e.start), id: `${e.title}|${e.start}` }, busy })
const keyColors = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cal-key:not(.task)')].map((k) => [k.innerText.trim(), k.style.getPropertyValue('--c').trim()])))
const asked = (re) => model.asked(re)

try {
  await api('/setup', { name: 'Tester' })
  const from = ymd(monday), to = ymd(at(6, 12))
  const nextFrom = ymd(at(7, 12)), nextTo = ymd(at(13, 12))

  // ---------- What the server reads ----------
  const wk = await api(`/calendar/range?from=${from}&to=${to}`)
  const by = (t, list = wk.events) => list.find((e) => e.title === t)
  ok(by('Daily standup').color === '#1badf8' && by('Lunch with Sam').color === '#63da38' && by('Offsite prep').color === null && by('Football practice').color === '#ff9500', "each event carries its calendar's own colour, and none for a calendar that has none", wk.events.map((e) => [e.title, e.calendar, e.color]).slice(0, 12))
  ok(by('Design crit').response === 'tentative' && by('Vendor pitch: Contoso').response === 'declined' && by('Week wrap').response === 'none' && by('Lunch with Sam').response === 'organizer' && by('Northwind renewal review').response === 'accepted' && by('Offsite prep').response === null, 'your answer to each invite, as Calendar has it', wk.events.map((e) => [e.title, e.response]).slice(0, 12))
  ok(by('Daily standup').uid === `uid-standup|${by('Daily standup').start}` && by('Vendor pitch: Contoso').organizer === 'Pat Lin', 'a lasting id (a repeat\'s, with its start) and who organised it', [by('Daily standup').uid, by('Vendor pitch: Contoso').organizer])
  // Open in Calendar (server/openin.js): Calendar's link to the event, by this Mac's id for it and,
  // for one of a series, when that day's starts, opened in Calendar itself.
  const su = by('Daily standup')
  ok(su.local === 'EK-STANDUP' && su.repeats === true && by('Northwind renewal review').local === null && by('Northwind renewal review').repeats === false, "this Mac's own id for an event and whether it repeats (none when the helper gives none)", [su.local, su.repeats, by('Northwind renewal review').local])
  if (IS_MAC) {
    ok(JSON.stringify(await api('/open-in')) === '{"calendar":{"name":"Calendar"}}', 'Calendar is on this Mac', await api('/open-in'))
    const r = await api('/calendar/open', { local: su.local, start: su.start, allDay: false, repeats: true })
    const stamp = new Date(su.start).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    ok(r.ok && r.app === 'Calendar' && opener.opened().at(-1) === `-a ${opener.apps.Calendar} ical://ekevent/${stamp}/EK-STANDUP?method=show&options=more`, "one of a series: Calendar's link with when that day's starts (in UTC), opened in Calendar itself", opener.opened())
    await api('/calendar/open', { local: 'EK-SOON', start: SOON.start })
    ok(opener.opened().at(-1) === `-a ${opener.apps.Calendar} ical://ekevent/EK-SOON?method=show&options=more`, 'one on its own: by its id alone', opener.opened())
    const n = opener.opened().length
    const noId = await err('/calendar/open', { start: SOON.start })
    const far = (p, body) => fetch(`${kit.url}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-bridge-relay': 'far' }, body: body ? JSON.stringify(body) : undefined }).then((x) => x.json())
    const farOpen = await far('/calendar/open', { local: 'EK-SOON', start: SOON.start })
    const farApps = await far('/open-in')
    ok(/no id for this event/.test(noId?.message || '') && /on your computer/.test(farOpen.error || '') && JSON.stringify(farApps) === '{}' && opener.opened().length === n, 'refused, saying why and opening nothing: an event with no id here, and from a phone or another computer (which has nothing to open in)', { noId: noId?.message, farOpen, farApps })
  } else ok(JSON.stringify(await api('/open-in')) === '{}' && /Mac's own app/.test((await err('/calendar/open', { local: 'EK-SOON', start: SOON.start }))?.message || '') && !opener.opened().length, 'not a Mac: no Calendar to open in, and asked anyway, it says so')
  // The recorded one's day (this week's, or Sunday's just before it, run just after midnight).
  const recDay = await api(`/calendar/range?from=${ymd(RECORDED.start)}&to=${ymd(RECORDED.start)}`)
  const rec = by('Quarterly planning', recDay.events)
  ok(rec?.recorded?.id === '2000-01-03-qp0003' && rec.recorded.summary === true && recDay.events.filter((e) => e.recorded).length === 1, 'the meeting recorded for an event is named with it, and only that one', recDay.events.map((e) => [e.title, e.recorded]))
  // The events as the calendar gives them to the app (the join link, agenda and files from the notes).
  const today = await api('/calendar')
  const asApp = (e) => [...today.today, ...today.tomorrow].find((x) => x.title === e.title && x.start === e.start)
  const [soonEv, laterEv] = [asApp(SOON), asApp(LATER)]
  ok(soonEv?.join && soonEv.agenda === 'Agree the renewal price and the seat count for Q1.' && soonEv.links.length === 1 && soonEv.emails.includes('ravi.menon@example.org'), "today's meeting: its join link, agenda, file and the addresses of who's invited", soonEv)
  // Who's invited, as Google Calendar shows them: each one's name, address, reply and role, the
  // organizer first though the invite's own list didn't have them, and you; not the room or the
  // team list invited with them. Their names too, for Prep and a meeting's people, as before.
  const kick = asApp(KICKOFF)
  const gs = kick?.guests || []
  const g = (name) => gs.find((x) => x.name === name) || {}
  ok(gs.length === 12 && kick.guestCount === 12 && kick.replies === true && gs[0].name === 'Priya Shah' && gs[0].organizer === true && gs[0].email === 'priya.shah@example.org' && gs[0].role === 'chair' && gs[0].status === 'accepted' && g('Tester').you === true && g('Leo Brandt').status === 'declined' && g('Ines Varga').status === 'tentative' && g('Ravi Menon').status === 'pending' && g('Sam Ortiz').role === 'optional' && gs.some((x) => x.name === null && x.email === 'lena.fischer@example.org') && !gs.some((x) => /Boardroom|Payments/.test(x.name || '') || /boardroom4|payments-team/.test(x.email || '')), "who's invited: each one's name, address, reply and role, the organizer first and you marked, and no room or team list", gs)
  ok(kick.attendees[0] === 'Priya Shah' && kick.attendeeCount === 12 && kick.attendees.includes('lena.fischer') && !kick.attendees.some((a) => /Boardroom|Payments/.test(a)), "and their names, the organizer's among them, for Prep and a meeting's people", kick.attendees)
  // The invite's own words, whole: its lines as written, Outlook's safe link as where it goes, and
  // Exchange's "???" an apostrophe; not Teams' join details, passcode and all, which Join stands for.
  ok(kick.description?.startsWith('Kick off the Northwind launch: scope, owners and the first milestone.\n\nAgenda\n- Scope and what\'s out\n') && kick.description.includes('Brief: https://northwind.sharepoint.com/:w:/s/launch/brief.docx\n') && kick.description.endsWith("I'll share the timeline before we meet.") && !/Passcode|Meeting ID|teams\.microsoft|safelinks/.test(kick.description) && kick.join === 'https://teams.microsoft.com/l/meetup-join/19%3akickoff', "the invite's words, whole, with the safe link unwrapped, and not Teams' join details or passcode", kick?.description)
  // An all-hands with 180 invited: everyone counted, the first 150 listed, 50 names.
  const big = by('Company all-hands', (await api(`/calendar/range?from=${ymd(ALLHANDS.start)}&to=${ymd(ALLHANDS.start)}`)).events)
  ok(big?.guests.length === 150 && big.guestCount === 180 && big.guests[0].organizer && big.attendees.length === 50 && big.attendeeCount === 180, 'a big invite: everyone counted, the first 150 guests listed and 50 names', big && { guests: big.guests.length, count: big.guestCount, names: big.attendees.length, n: big.attendeeCount })
  // The year view stays light: no one's listed and no invite's words.
  const year = await api(`/calendar/range?from=${from}&to=${ymd(at(80, 12))}`)
  const kickY = year.events.find((e) => e.title === KICKOFF.title)
  ok(year.light === true && kickY && !kickY.guests.length && kickY.guestCount === 0 && kickY.description === null && !kickY.attendees.length, 'the year view is read light: no guests, names or invite words', kickY)
  const nwk = await api(`/calendar/range?from=${nextFrom}&to=${nextTo}`)
  ok(by('Daily standup', nwk.events).color === by('Daily standup').color && by('Offsite prep', nwk.events).color === null, 'next week: the same colours', [by('Daily standup', nwk.events).color])

  // How it's shown: checked, kept on the server.
  ok(JSON.stringify(await api('/calendar/view')) === JSON.stringify({ weekStart: null, workStart: 9, workEnd: 17, hidden: [], tasks: true }), 'how the calendar is shown, to start: the week as your region has it, nine to five, nothing hidden, tasks on the grid', await api('/calendar/view'))
  // Weeks from Monday from here on, as the week is seeded, whatever this browser's region says.
  await api('/calendar/view', { weekStart: 1 }, 'PATCH')
  const bad = await err('/calendar/view', { workStart: 18, workEnd: 9 }, 'PATCH')
  ok(bad && /Working hours end after they start/.test(bad.message), 'working hours that end before they start: refused, saying why', bad?.message)
  const bad2 = await err('/calendar/view', { weekStart: 3 }, 'PATCH')
  ok(bad2 && /Sunday, a Monday or a Saturday/.test(bad2.message), 'a week that starts on a Wednesday: refused, saying why', bad2?.message)

  // Chief of Staff's tasks that name a day.
  const wed = at(2, 12)
  await api('/chief/tasks', { title: `Book the offsite venue on ${ymd(wed)}` })
  await api('/chief/tasks', { title: 'Send Maya the revised quote tomorrow' })
  await api('/chief/tasks', { title: 'Tidy the team wiki' })
  const tk = await api(`/calendar/tasks?from=${from}&to=${ymd(at(13, 12))}`)
  ok(tk.tasks.some((x) => x.title.startsWith('Book the offsite') && x.due === ymd(wed)) && tk.tasks.some((x) => /tomorrow/.test(x.title) && x.due === ymd(NOW + DAY)) && !tk.tasks.some((x) => /wiki/.test(x.title)), 'the tasks that name a day, on that day; one with none isn\'t on the calendar', tk.tasks)

  // ---------- Meeting prep with no model ----------
  // With Meeting Insights off (a beta feature, and what knows who's been in your meetings), who's
  // invited is all it says: nobody met before, nobody new, here or in what a model would be told.
  await api('/settings', { trials: { 'meeting-insights': false } }, 'PATCH')
  const pOff = await api('/prep', { event: soonEv })
  ok(pOff.people.insights === false && !pOff.people.known.length && pOff.people.new.length === 3, 'Meeting Insights off: who\'s coming, with nobody said to be met before or new', pOff.people)
  await api('/settings', { trials: { 'meeting-insights': true } }, 'PATCH')
  const p0 = await api('/prep', { event: soonEv })
  ok(p0.writer === null && !p0.suggest && p0.people.known.map((x) => x.name).sort().join() === 'Leo Brandt,Maya Okafor' && p0.people.new.join() === 'Ravi Menon', "no model: who's coming, the people you've met (Meeting Insights' People) and the one who's new", p0.people)
  ok(p0.people.known.every((x) => x.invited === x.name && x.id), "each one you've met says the name they're invited by, for the guests to say who they are", p0.people.known)
  ok(p0.last?.title === 'Northwind pricing sync' && p0.last.why === 'series' && p0.last.summary[0] === 'Maya wants a three-year term if the price holds.' && p0.last.yours.map((x) => x.text).join() === 'You: send the revised quote to Maya' && p0.last.theirs.map((x) => x.text).join() === 'Maya: confirm the seat count', 'last time: the summary, and what\'s still open both ways (not what was done)', p0.last)
  ok(p0.agenda === 'Agree the renewal price and the seat count for Q1.' && p0.files.some((f) => /renewal-deck/.test(f.url)), "the invite's agenda and files", [p0.agenda, p0.files])
  if (mailOn) ok(p0.mail?.available && p0.mail.threads.map((m) => m.subject).join() === 'Seat count for the renewal' && p0.mail.waiting.map((m) => m.subject).join() === 'Intro and the renewal deck', 'your mail with them: a thread from Maya (not the shop\'s), and what you sent Ravi with no reply yet', p0.mail)
  else ok(p0.mail === null || p0.mail.available === false, 'no Mail here: none shown, or why', p0.mail)
  const nm = await err('/prep/suggest', { event: laterEv })
  ok(nm && /No model to write with/.test(nm.message) && /Settings › Model Providers/.test(nm.message), 'Suggest with no model: refused, saying how to add one', nm?.message)
  ok(!asked(/Prepare me for a meeting/).length, 'nothing was sent to a model')

  // ---------- The app: no model ----------
  {
    const { p, errors } = await open()
    await until(() => p.locator('.tg-ev').count(), 15000)
    await openEvent(p, LATER)
    const card = p.locator('.cal-detail .prep')
    await until(async () => /Ines Varga/.test(await card.innerText().catch(() => '')), 15000)
    const text = await card.innerText().catch(() => '')
    ok(/Who's Coming/i.test(text) && /Ines Varga/.test(text) && /2 meetings · last /.test(text) && /Design review with Ines/.test(text) && /The empty states need work/.test(text) && /Ines: mock up the empty states/.test(text), "the panel's prep with no model: who's coming, last time and what's still open", text)
    ok(/need a model to write them/.test(text) && await card.locator('button', { hasText: 'Add a model' }).count() === 1 && !(await card.locator('button', { hasText: 'Suggest goals' }).count()), 'and how to add a model, with no Suggest button', text)
    // AI Assist at the right end of the event's buttons, its prep headed as AI Assist's; Prepare for
    // this meeting with no model shows the prep and asks nothing.
    const wand = p.locator('.cal-detail-actions button[aria-label="AI Assist"]')
    const head = await card.locator('.prep-head').innerText().catch(() => '')
    ok(await wand.evaluate((e) => !e.nextElementSibling).catch(() => false) && /AI Assist/.test(head) && /Prepare for this meeting/.test(head), "AI Assist at the right end of the event's buttons, and the prep under it says it's AI Assist's", head)
    await wand.click()
    await p.locator('.ai-menu button', { hasText: 'Prepare for this meeting' }).click()
    await sleep(300)
    ok(!asked(/Prepare me for a meeting/).length && await card.isVisible(), 'with no model, Prepare for this meeting shows the prep and sends nothing')
    const panel = await p.locator('.cal-detail').innerText()
    ok(/From the Invite/i.test(panel) && /Walk through onboarding v2/.test(panel) && /Google Doc/.test(panel) && /Not answered yet/.test(panel) && /Change it in your calendar app/.test(panel), "the panel: the invite's agenda and its file, and your answer (not answered yet), to change in your calendar app", panel)
    ok(!(await p.locator('.cal-detail').locator('button', { hasText: /^(Accept|Decline|Maybe|Delete|Edit|Move|Reply)/ }).count()), 'nothing in it answers, edits or moves the event')
    await shot(p, `${tag}calendar-no-model`)
    // Open in Calendar, beside Prep with agent (AI Assist still last): the event itself in Calendar
    // on this Mac, saying so, or what macOS said; none for an event with no id here, or off a Mac.
    const inCal = p.locator('.cal-detail-actions .cal-open-in')
    if (IS_MAC) {
      ok((await inCal.innerText().catch(() => '')).trim() === 'Open in Calendar' && /to answer or change it there/.test(await inCal.getAttribute('title')) && await wand.evaluate((e) => !e.nextElementSibling).catch(() => false), "the event's panel has Open in Calendar, to answer or change it there, with AI Assist still at the right end", await p.locator('.cal-detail-actions').innerText().catch(() => ''))
      await inCal.click()
      ok(!!(await until(() => opener.opened().at(-1) === `-a ${opener.apps.Calendar} ical://ekevent/EK-LATER?method=show&options=more`, 5000)) && !!(await until(async () => /^Opening it in Calendar\./.test(await p.locator('.cal-opened').innerText().catch(() => '')), 3000)), 'Open in Calendar opens that very event in Calendar, and says so', opener.opened().at(-1))
      opener.fail('LSOpenURLsWithRole() failed with error -10814 for the URL ical://x.')
      await inCal.click()
      ok(!!(await until(async () => /Couldn't open it in Calendar: macOS said: LSOpenURLsWithRole\(\) failed with error -10814/.test(await p.locator('.cal-opened[role="alert"]').innerText().catch(() => '')), 3000)), "Calendar didn't open it: it says what macOS said", await p.locator('.cal-opened').innerText().catch(() => ''))
      opener.fail(null)
      await openEvent(p, FOCUS)
      ok(!!(await until(async () => /Focus time/.test(await p.locator('.cal-detail h4').innerText().catch(() => '')), 8000)) && !(await inCal.count()), 'an event with no id here: no Open in Calendar')
    } else ok(!(await inCal.count()), 'not a Mac: no Open in Calendar')
    ok(real(errors).length === 0, 'no page errors', errors)
    await p.context().close()
  }

  // ---------- An event's guests and invite, as Google Calendar shows them ----------
  // Copies are kept in the page (window.__copied) rather than on this computer's clipboard.
  const copies = (c) => c.addInitScript(() => { const got = window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (x) => { got.push(x) } } }) })
  for (const mode of ['light', 'dark']) {
    const { p, errors } = await open({ mode, before: copies })
    await until(() => p.locator('.tg-ev').count(), 15000)
    await openEvent(p, KICKOFF)
    const sec = p.locator('.cal-detail .cal-guests')
    await until(async () => /Met in 2 meetings/.test(await sec.innerText().catch(() => '')), 15000)
    const rows = () => sec.locator('.gu-row').evaluateAll((rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()))
    const head = await sec.locator('.gu-sum').innerText().catch(() => '')
    const few = await rows()
    ok(head === '12 guests · 6 yes · 2 no · 1 maybe · 3 awaiting' && few.length === 6 && /Priya Shah Organizer priya\.shah@example\.org Accepted/.test(few[0]) && /Tester You tester@example\.com Accepted/.test(few[1]) && await sec.locator('button', { hasText: 'Show all 12' }).count() === 1, `${mode}: the panel's guests: how many and how they replied, the organizer and you first, the first six with Show all`, { head, few })
    const maya = sec.locator('.gu-row', { hasText: 'Maya Okafor' })
    ok(/Met in 2 meetings/.test(await maya.innerText()) && await maya.locator('button.gu-met').count() === 1 && !(await sec.locator('.gu-row', { hasText: 'Sam Ortiz' }).locator('.gu-met').count()), `${mode}: who you've met says how often, a link to them; who you haven't, nothing`, await maya.innerText())
    await shot(p, `${tag}calendar-guests-${mode}`)
    await sec.locator('button', { hasText: 'Show all 12' }).click()
    const every = await rows()
    const row = (name) => every.find((r) => r.includes(name)) || ''
    ok(every.length === 12 && /Declined$/.test(row('Leo Brandt')) && /Maybe$/.test(row('Ines Varga')) && /Not replied$/.test(row('Ravi Menon')) && /Sam Ortiz Optional/.test(row('Sam Ortiz')) && /lena\.fischer@example\.org Not replied/.test(row('lena.fischer')) && /Leo Brandt|Pat Lin/.test(every.at(-1)) && !every.some((r) => /Boardroom|Payments/.test(r)), `${mode}: Show all: everyone, each reply and role, who declined last, and no room or team list`, every)
    if (mode === 'light') {
      // Copy an address, or all of them, to write to them.
      await maya.locator('.gu-copy').click()
      await sec.locator('button', { hasText: 'Copy addresses' }).click()
      const copied = await p.evaluate(() => window.__copied)
      ok(copied[0] === 'maya.okafor@example.org' && copied[1]?.startsWith('Priya Shah <priya.shah@example.org>, Tester <tester@example.com>') && copied[1].split(', ').length === 12 && copied[1].includes('lena.fischer@example.org'), 'a guest\'s copy button copies their address, and Copy addresses every guest\'s, by name', copied)
      // The invite's words, whole, with its links; a long one folded, with Show more; its call.
      const inv = p.locator('.cal-detail .cal-invite')
      const words = await inv.locator('.iv-words').innerText().catch(() => '')
      const link = inv.locator('.iv-words a[href="https://northwind.sharepoint.com/:w:/s/launch/brief.docx"]')
      ok(/^Kick off the Northwind launch/.test(words) && /Scope and what's out/.test(words) && await link.count() === 1 && await link.getAttribute('target') === '_blank' && !/Passcode/.test(await inv.innerText()), "the invite's words, whole, its links opening where they go, and no passcode", words)
      const more = inv.locator('.iv-more')
      ok(await more.innerText() === 'Show more' && await inv.locator('.iv-words.folded').count() === 1, 'a long invite is folded, with Show more')
      await more.click()
      ok(await more.innerText() === 'Show less' && !(await inv.locator('.iv-words.folded').count()) && /I'll share the timeline before we meet\./.test(await inv.locator('.iv-words').innerText()), 'Show more: all of it')
      ok(/Microsoft Teams meeting/.test(await inv.locator('.iv-call').innerText()) && await inv.locator('.iv-call a[href="https://teams.microsoft.com/l/meetup-join/19%3akickoff"]').count() === 1 && await inv.locator('.iv-call .iv-copy').count() === 1 && /brief\.docx/.test(await inv.locator('.prep-files').innerText()), "and its call, with the link to copy, and its files", await inv.innerText())
      await shot(p, `${tag}calendar-invite-light`)
      // A big invite: everyone counted, the replies of those listed, and where the rest are.
      await openEvent(p, ALLHANDS)
      await until(async () => /180 guests/.test(await sec.innerText().catch(() => '')), 10000)
      const bt = await sec.innerText().catch(() => '')
      ok(/^180 guests · 50 yes · 50 no · 50 awaiting$/m.test(bt) && /Show all 150/.test(bt) && /And 30 more on the invite: your calendar app lists them all\./.test(bt), 'a big invite: all 180 counted, the replies of the 150 listed, and the rest in your calendar app', bt.slice(0, 300))
      await openEvent(p, KICKOFF)
      await until(async () => /Met in 2 meetings/.test(await sec.innerText().catch(() => '')), 10000)
      // Who you've met opens their page in Meetings › People.
      await maya.locator('button.gu-met').click()
      ok(!!(await until(async () => (await p.locator('.mi-person h3').innerText().catch(() => '')) === 'Maya Okafor', 10000)), "who you've met opens their page in Meetings › People")
    }
    ok(real(errors).length === 0, `${mode}: no page errors`, errors)
    await p.context().close()
  }
  // The Schedule: a meeting opens to who's invited, with their replies, and View Calendar.
  {
    const { p, errors } = await open({ store: { 'cc-today-tab': 'overview' } })
    const row = p.locator('.agenda .ev', { hasText: SOON.title })
    // Run just before midnight, it starts tomorrow: under Tomorrow, folded.
    if (ymd(SOON.start) !== ymd(NOW)) await p.locator('.ag-tomorrow button').click()
    await until(() => row.count(), 15000)
    await row.locator('.ev-main').click()
    const gu = row.locator('.ev-more .gu')
    await until(() => gu.count(), 5000)
    ok((await gu.locator('.gu-sum').innerText().catch(() => '')) === '4 guests · 2 yes · 1 maybe · 1 awaiting' && (await gu.locator('.gu-row').count()) === 4, "the Schedule: a meeting opens to how many are invited, how they replied and who they are", await row.innerText())
    await row.locator('.ev-view').click()
    ok(!!(await until(async () => (await p.locator('.cal-detail h4').innerText().catch(() => '')) === SOON.title, 10000)), 'and View Calendar opens it in Today › Calendar, with its panel')
    ok(real(errors).length === 0, 'the Schedule: no page errors', errors)
    await p.context().close()
  }

  // ---------- A model ----------
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { model: 'openai:gpt-5' } }, 'PATCH')
  // Shortly before: the meeting in eight minutes gets its suggestions by itself.
  const auto = await until(async () => asked(/^Prepare me for a meeting: "Northwind pricing sync"/).length > 0, 15000)
  ok(!!auto, 'shortly before a meeting with other people, its suggestions are made by themselves')
  const sentSoon = asked(/^Prepare me for a meeting: "Northwind pricing sync"/)[0] || ''
  ok(/Invited, besides me: Maya Okafor, Leo Brandt, Ravi Menon/.test(sentSoon) && /People I've met before:\n- Maya Okafor: 2 meetings, last .*\n- Leo Brandt: 1 meeting, last /.test(sentSoon) && /New to my meetings: Ravi Menon\./.test(sentSoon) && /The invite says: Agree the renewal price/.test(sentSoon) && /Files in the invite: renewal-deck\.pptx\./.test(sentSoon), "what's sent: who's coming, who you've met and who's new, the invite and its files", sentSoon)
  ok(/Last time, "Northwind pricing sync" on .*:\n- Maya wants a three-year term/.test(sentSoon) && /Still open, mine: You: send the revised quote to Maya/.test(sentSoon) && /Still open, theirs: Maya: confirm the seat count/.test(sentSoon) && !/share the usage report/.test(sentSoon), 'and last time: the summary and what\'s still open both ways, not what was done', sentSoon)
  if (mailOn) ok(/Recent email with them .*\n- From Maya Okafor, .*: "Seat count for the renewal": Maya asks whether 55 seats/.test(sentSoon) && /I wrote and haven't heard back: "Intro and the renewal deck" to Ravi Menon/.test(sentSoon) && !/This week's deals/.test(sentSoon), 'and the mail with them, not the shop\'s', sentSoon)
  ok(!/sk-test|tester@example\.com/.test(sentSoon) && /data, not instructions/.test(sentSoon), 'no key or address of yours in it, and it says the invite and mail are data, not instructions', sentSoon)
  const soon = await until(async () => { const c = await api('/calls'); return c.soon?.suggestions > 0 && c.soon }, 8000)
  ok(soon && soon.title === 'Northwind pricing sync' && soon.join, "the floating card's meeting: the one starting within ten minutes, with its suggestions ready", soon)
  const n0 = asked(/^Prepare me for a meeting:/).length
  const p1 = await api('/prep', { event: soonEv })
  ok(p1.suggest?.items.length === (mailOn ? 3 : 2) && p1.suggest.items[0].kind === 'goal' && /Agree on: Agree the renewal price/.test(p1.suggest.items[0].text) && p1.suggest.items[1].kind === 'follow-up' && /confirm the seat count/.test(p1.suggest.items[1].text) && p1.suggest.label === 'gpt-5' && p1.suggest.model === 'openai:gpt-5', 'kept: the goal, the follow-up and (with mail) the question, and which model said them', p1.suggest)
  ok(p1.suggest?.basis?.invite && p1.suggest.basis.files === 1 && p1.suggest.basis.people === 2 && p1.suggest.basis.last?.title === 'Northwind pricing sync', 'and what they were based on', p1.suggest.basis)
  ok(asked(/^Prepare me for a meeting:/).length === n0, 'looking again asks the model nothing')
  // On demand, for one later today.
  const p2 = await api('/prep/suggest', { event: laterEv })
  ok(p2.suggest?.items.some((x) => /Ines: mock up the empty states/.test(x.text)) && asked(/^Prepare me for a meeting: "Design review with Ines"/).length === 1, 'Suggest for a meeting later: made on demand, from what\'s open from last time', p2.suggest)
  await api('/prep/suggest', { event: laterEv })
  ok(asked(/^Prepare me for a meeting: "Design review with Ines"/).length === 1, 'asked again: the kept ones, with no second call')
  const p3 = await api('/prep/suggest', { event: laterEv, again: true })
  // A long agenda: cut only at a whole word, with "…"; what's made from it, whole.
  const cut = laterEv.agenda.slice(0, -1)
  ok(LONG_AGENDA.length > 220 && laterEv.agenda.endsWith('…') && LONG_AGENDA.startsWith(cut) && !/[\p{L}\p{N}]/u.test(LONG_AGENDA[cut.length]) && laterEv.agenda.length <= 221, "a long invite's agenda is cut at a whole word, with \"…\", never mid-word", laterEv.agenda)
  ok(p3.agenda === laterEv.agenda && asked(/^Prepare me for a meeting: "Design review with Ines"/).at(-1).includes(`The invite says: ${laterEv.agenda}\n`), 'Prep shows it and sends it as kept, not cut again', p3.agenda)
  const goal = p3.suggest.items.find((x) => x.kind === 'goal')?.text
  ok(goal === `Agree on: ${laterEv.agenda}`, 'the goal made from it is kept whole', goal)
  ok(asked(/^Prepare me for a meeting: "Design review with Ines"/).length === 2 && p3.suggest.items.length > 0, 'Again: asked afresh')

  // ---------- The app, with a model: 1440, light and dark ----------
  // How it's shown slow to come: the week is read once, from the Monday it's set to start on, never
  // first as this browser's language starts it (it then moved, its events gone in between).
  {
    const from = []
    const { p } = await open({ before: async (c) => {
      c.on('request', (r) => { if (/\/api\/calendar\/range\?/.test(r.url())) from.push(new URL(r.url()).searchParams.get('from')) })
      await c.route(/\/api\/calendar\/view$/, async (r) => { await sleep(1500); await r.continue().catch(() => {}) })
    } })
    await until(() => p.locator('.tg-ev').count(), 15000)
    ok(from.length > 0 && from.every((d) => new Date(`${d}T12:00`).getDay() === 1), 'the week is read once it\'s known which day it starts on, never first as the browser\'s language starts it', from)
    await p.context().close()
  }
  // On cue (behind: { held, after }), the view read after a change is kept (one `after` picks) is
  // answered only when the test says, with what the server said then; inFlight: the page's asks
  // about the view not yet answered.
  let behind = null
  const inFlight = new Set()
  const lateView = async (c) => {
    c.on('request', (r) => { if (/\/api\/calendar\/view$/.test(r.url())) inFlight.add(r) })
    c.on('requestfailed', (r) => inFlight.delete(r))
    c.on('requestfinished', (r) => { inFlight.delete(r); if (behind && r.method() === 'PATCH' && /\/api\/calendar\/view$/.test(r.url()) && behind.after(r.postData() || '')) behind.kept = true })
    await c.route(/\/api\/calendar\/view$/, async (r) => {
      const l = behind
      if (!l?.kept || l.got || r.request().method() !== 'GET') return r.fallback()
      l.got = r.request()
      const res = await r.fetch()
      l.read = true
      await l.held
      await r.fulfill({ response: res }).catch(() => {})
    })
  }
  for (const mode of ['light', 'dark']) {
    const { p, errors } = await open({ mode, before: lateView })
    await until(() => p.locator('.tg-ev').count(), 15000)
    if (mode === 'light') {
      // Colours: the week's keys, then next week's, the same.
      const c1 = await keyColors(p)
      await p.locator('.calv-nav button[aria-label="Next"]').click()
      await until(async () => (await p.locator('.calv-nav h3').innerText()).length && (await p.locator('.tg-ev').count()) > 0, 8000)
      await sleep(800)
      const c2 = await keyColors(p)
      ok(c1.Work === '#1badf8' && c1.Work === c2.Work && c1['Team Rota'] && c1['Team Rota'] === c2['Team Rota'] && c1.Family === c2.Family, 'in the app, each calendar keeps its colour from week to week (Team Rota, with none of its own, one from its name)', { c1, c2 })
      await p.locator('.calv-nav button', { hasText: 'Today' }).click()
      await until(() => p.locator('.tg-ev').count(), 8000)
      // Answers, on the grid.
      const cls = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tg-ev')].map((e) => [e.querySelector('b').innerText, e.className])))
      ok(/ans-tentative/.test(cls['Design crit']) && /ans-declined/.test(cls['Vendor pitch: Contoso']) && /ans-none/.test(cls['Week wrap']) && !/ans-(tentative|declined|none)/.test(cls['Northwind renewal review']), 'on the grid: maybe striped, declined faded, not answered outlined, accepted plain', cls)
      // Tasks, on their day.
      const chips = await p.locator('.tg-chip.task').allInnerTexts()
      ok(chips.some((x) => /Book the offsite venue/.test(x)), "Chief of Staff's task with a day: on that day", chips)
      await p.locator('.tg-chip.task', { hasText: 'Book the offsite venue' }).click()
      const tp = await p.locator('.cal-detail').innerText().catch(() => '')
      ok(/Chief of Staff's task/.test(tp) && /\bdue /i.test(tp) && /names it/.test(tp) && await p.locator('.cal-detail button', { hasText: 'Open Chief of Staff' }).count() === 1, 'a task opens its panel: when, whose, why it\'s on that day, and the way to it', tp)
      // Hide a calendar: off the grid, off Today's Schedule, kept on the server; then back.
      await p.locator('.cal-key', { hasText: 'Family' }).click()
      const gone = await until(async () => !(await p.locator('.tg-ev', { hasText: 'Dinner with the Okafors' }).count()) && !(await p.locator('.tg-chip', { hasText: 'Football practice' }).count()), 5000)
      ok(!!gone && await p.locator('.cal-key.off', { hasText: 'Family' }).count() === 1, 'a click on a calendar\'s key hides it, and the key says so')
      // The page shows it at once and keeps it on the server a moment later.
      const v = await until(async () => { const x = await api('/calendar/view'); return x.hidden.join() === 'Family' && x }, 5000)
      ok(!!v, 'kept on the server, for every device', v || await api('/calendar/view'))
      await api('/calendar/view', { hidden: ['Family', 'Personal'] }, 'PATCH')
      const sched = await api('/calendar')
      ok(![...sched.today, ...sched.tomorrow].some((e) => e.calendar === 'Personal'), "a hidden calendar is off today's Schedule and Home's Coming Up", [...sched.today, ...sched.tomorrow].map((e) => e.calendar))
      await api('/calendar/view', { hidden: ['Family'] }, 'PATCH')
      await p.reload()
      await until(() => p.locator('.tg-ev').count(), 15000)
      ok(await p.locator('.cal-key.off', { hasText: 'Family' }).count() === 1 && !(await p.locator('.tg-ev', { hasText: 'Dinner with the Okafors' }).count()), 'still hidden after a reload')
      await p.locator('.cal-key', { hasText: 'Family' }).click()
      ok(!!(await until(async () => (await p.locator('.tg-ev', { hasText: 'Dinner with the Okafors' }).count()) > 0, 5000)) && !!(await until(async () => (await api('/calendar/view')).hidden.length === 0, 5000)), 'a click brings it back')
      // Week start and working hours. The view read after the week's start is kept comes back only
      // once the working hours' start is set and the page has sent what it would for it: the end is
      // then set from the start just set, not the one before (on CI's Mac, now and then, it was).
      const held = Promise.withResolvers()
      behind = { held: held.promise, after: (sent) => /"weekStart"/.test(sent) }
      await p.locator('.calv-view-btn').click()
      await p.locator('.calv-menu select[aria-label="Week starts on"]').selectOption('0')
      const sun = await until(async () => /^Sun/.test((await p.locator('.tg-day small').first().innerText().catch(() => '')).trim()), 5000)
      ok(!!sun && !!(await until(async () => (await api('/calendar/view')).weekStart === 0, 5000)), 'the week starts on Sunday when you say so', await p.locator('.tg-day small').allInnerTexts())
      await until(() => behind.read, 5000, 50)
      await p.locator('.calv-menu select[aria-label="Working hours start"]').selectOption('8')
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      await until(() => [...inFlight].every((r) => r === behind.got), 5000, 50)
      held.resolve()
      await behind.got?.response().catch(() => null)
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      behind = null
      await p.locator('.calv-menu select[aria-label="Working hours end"]').selectOption('18')
      await until(async () => (await api('/calendar/view')).workEnd === 18, 5000)
      await shot(p, `${tag}calendar-menu`)
      await p.keyboard.press('Escape')
      // On the week two on, which has only the week's own meetings: 8 AM to 6 PM with an hour either
      // side (7 to 7), and to 8 PM for Sunday's dinner (6 to 7:30 PM), whatever time it is now.
      await p.locator('.calv-nav button[aria-label="Next"]').click()
      await p.locator('.calv-nav button[aria-label="Next"]').click()
      await until(async () => (await p.locator('.tg-ev', { hasText: 'Dinner with the Okafors' }).count()) > 0, 8000)
      const hours = await p.evaluate(() => [...document.querySelectorAll('.tg-hours span')].map((s) => s.innerText).filter(Boolean))
      ok((await api('/calendar/view')).workStart === 8 && hours.length === 12 && /^8\s?AM/.test(hours[0]) && /^7\s?PM/.test(hours.at(-1)), 'working hours 8 to 6: the grid shows them with an hour either side, widened only to take in a meeting (Sunday\'s dinner, to 7:30 PM)', hours)
      await api('/calendar/view', { weekStart: 1, workStart: 9, workEnd: 17 }, 'PATCH')
      await p.reload()
      await until(() => p.locator('.tg-ev').count(), 15000)
      // A meeting from 11 PM to half past midnight: its day's grid runs from your working hours to
      // midnight, not from the small hours.
      await openEvent(p, LATE)
      await until(async () => /Release window/.test(await p.locator('.cal-detail h4').innerText().catch(() => '')), 8000)
      const late = await p.evaluate(() => [...document.querySelectorAll('.tg-hours span')].map((s) => s.innerText).filter(Boolean))
      ok(/^9\s?AM/.test(late[0]) && /^11\s?PM/.test(late.at(-1)), 'a meeting past midnight: its first day\'s grid runs from 9 AM to midnight, not from the small hours', late)
      await p.keyboard.press('Escape')
    }
    // The meeting coming up later, with its prep and the model's suggestions.
    await openEvent(p, LATER)
    const card = p.locator('.cal-detail .prep')
    await until(async () => /wrote these/.test(await card.innerText().catch(() => '')), 15000)
    const text = await card.innerText().catch(() => '')
    const writ = await card.locator('.prep-foot').getAttribute('title').catch(() => '')
    ok(/Goals and Questions/i.test(text) && /Ines: mock up the empty states/.test(text) && /Bridge AI wrote these at .*, from the invite, 1 file in it, last time \(Design review with Ines, .*\),? and 1 person you've met\./.test(text) && writ === 'Written with gpt-5' && await card.locator('button', { hasText: 'Again' }).count() === 1, 'the panel shows the suggestions, that Bridge AI wrote them (with which model on hover), when, and from what', { text, writ })
    const say = await card.locator('.prep-tip.k-goal .prep-tip-say').innerText().catch(() => '')
    const hover = await card.locator('.prep-tip.k-goal .prep-tip-text').getAttribute('title').catch(() => '')
    const ag = await p.locator('.cal-detail .cal-invite .iv-words').innerText().catch(() => '')
    ok(say === `Agree on: ${laterEv.agenda}` && hover?.startsWith(say) && ag.startsWith(`${LONG_AGENDA}\n`), `${mode}: the goal shows whole (the agenda ending at a word, with "…"), all of it on hover too, and the panel the invite's words in full`, { say, hover, ag })
    await shot(p, `${tag}calendar-prep-${mode}`)
    // AI Assist's Prepare for this meeting: its suggestions are there already, so nothing more is asked.
    const n1 = asked(/^Prepare me for a meeting:/).length
    await p.locator('.cal-detail-actions button[aria-label="AI Assist"]').click()
    ok(/Prepare for this meeting/.test(await p.locator('.ai-menu').innerText().catch(() => '')), `${mode}: AI Assist's menu in the event's panel: Prepare for this meeting`)
    await shot(p, `${tag}calendar-ai-menu-${mode}`)
    await p.locator('.ai-menu button', { hasText: 'Prepare for this meeting' }).click()
    await sleep(300)
    ok(asked(/^Prepare me for a meeting:/).length === n1, `${mode}: with its suggestions there, Prepare for this meeting asks the model nothing more`)
    // A meeting earlier today that was recorded: its notes.
    {
      await openEvent(p, RECORDED)
      const notes = p.locator('.cal-detail')
      await until(async () => /The Q1 hiring plan is approved/.test(await notes.innerText().catch(() => '')), 10000)
      const nt = await notes.innerText().catch(() => '')
      ok(/Your Notes/i.test(nt) && /The Q1 hiring plan is approved/.test(nt) && /1 of 2 action items still open/i.test(nt) && /draft the Q1 hiring plan/.test(nt) && await notes.locator('button', { hasText: 'Open the notes' }).count() === 1 && !(await notes.locator('.prep').count()), "a recorded meeting's panel: its summary and action items, the way to its notes, and no prep", nt)
      ok(await p.locator('.tg-ev', { hasText: 'Quarterly planning' }).locator('.tg-rec').count() === 1, 'and a dot on it on the grid')
      if (mode === 'light') await shot(p, `${tag}calendar-recorded`)
    }
    // Escape closes the event, not the calendar's full size; then the week and the month.
    await p.keyboard.press('Escape')
    await sleep(300)
    ok(!(await p.locator('.cal-detail').count()) && ((await p.locator('.calv').boundingBox())?.width || 0) > 1000, `${mode}: Escape closes the event, and the calendar stays full size`)
    await p.keyboard.press('w')
    await sleep(600)
    await shot(p, `${tag}calendar-week-${mode}`)
    await p.keyboard.press('m')
    await until(() => p.locator('.mg-ev').count(), 8000)
    await shot(p, `${tag}calendar-month-${mode}`)
    await p.keyboard.press('w')
    ok(real(errors).length === 0, `${mode}: no page errors`, errors)
    await p.context().close()
  }

  // ---------- In German: the week starts on Monday there, and the panel is in German ----------
  {
    await api('/calendar/view', { weekStart: null }, 'PATCH')
    const { p, errors } = await open({ locale: 'de-DE', store: { 'cc-lang': 'auto' } })
    await until(() => p.locator('.tg-ev').count(), 15000)
    ok(/^Mo/.test((await p.locator('.tg-day small').first().innerText().catch(() => '')).trim()), 'in German, the week starts on Monday, with German day names', await p.locator('.tg-day small').allInnerTexts())
    await openEvent(p, LATER)
    const card = p.locator('.cal-detail .prep')
    await until(async () => /Wer kommt/i.test(await card.innerText().catch(() => '')), 15000)
    const de = await p.locator('.cal-detail').innerText().catch(() => '')
    ok(/Wer kommt/i.test(de) && /Ziele und Fragen/i.test(de) && /Ines Varga/.test(de), 'and the panel and its prep in German', de)
    await shot(p, `${tag}calendar-prep-de`)
    ok(real(errors).length === 0, 'German: no page errors', errors)
    await p.context().close()
    await api('/calendar/view', { weekStart: 1 }, 'PATCH')
  }

  // ---------- The floating card, shortly before ----------
  {
    const { p, errors } = await open({ mode: 'light' })
    const card = await p.context().newPage()
    card.on('pageerror', (e) => errors.push(`card: ${e.message}`))
    await card.setViewportSize({ width: 360, height: 620 })
    await card.goto(`${kit.url}/?float=1`)
    await card.waitForSelector('.float-card .prep-glance', { timeout: 15000 }).catch(() => {})
    await until(async () => /Agree on/.test(await card.locator('.float-card').innerText().catch(() => '')), 10000)
    const fc = await card.locator('.float-card').innerText().catch(() => '')
    const by = await card.locator('.float-card .pg-by').getAttribute('title').catch(() => '')
    ok(/Northwind pricing sync/.test(fc) && /In \d+ min · /.test(fc) && /3 invited · 2 you've met · 1 new to your meetings/.test(fc) && /Last time, .*: 2 still open/.test(fc) && /Agree on/.test(fc) && /By Bridge AI at/.test(fc) && !/gpt-5/.test(fc) && by === 'Written with gpt-5' && await card.locator('.float-card a', { hasText: 'Join' }).count() === 1, "the card before it starts: who's coming, last time (the same meeting, so by its date), the goals, by Bridge AI (the model on hover), and Join", { fc, by })
    const clamped = await card.evaluate(() => [...document.querySelectorAll('.float-card .prep-line, .float-card .prep-tip-text')].map((x) => ({ text: x.innerText.split('\n')[0], title: x.getAttribute('title') || '' })))
    ok(clamped.length > 3 && clamped.every((x) => x.title && x.title.replace(/\n.*/s, '').length >= Math.min(x.text.length, 1)), 'on the card, each line that may be clamped has all of it on hover', clamped)
    await shot(card, `${tag}calendar-float`)
    // "3 invited" opens who they are, with their replies; who you've met is said (the card's own
    // window has no Meetings to open them in), and View Calendar has the rest.
    const who = card.locator('.float-card .pg-who')
    ok(await who.getAttribute('aria-expanded') === 'false' && /3 invited/.test(await who.innerText()), 'on the card, "3 invited" is a button', await who.innerText().catch(() => ''))
    await who.click()
    const gl = card.locator('.float-card .gu')
    await until(() => gl.count(), 3000)
    const cardRows = await gl.locator('.gu-row').evaluateAll((rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ').trim()))
    ok(await who.getAttribute('aria-expanded') === 'true' && (await gl.locator('.gu-sum').innerText()) === '2 yes · 1 maybe · 1 awaiting' && cardRows.length === 4 && /Maya Okafor Organizer Met in 2 meetings Accepted/.test(cardRows[0]) && /Tester You Accepted/.test(cardRows[1]) && /Ravi Menon Optional Not replied/.test(cardRows[3]) && !(await gl.locator('button.gu-met').count()), "it opens to everyone invited, how they replied and who you've met, said rather than a link", cardRows)
    await shot(card, `${tag}calendar-float-guests`)
    ok(real(errors).length === 0, 'the card: no page errors', errors)
    await api('/settings', { meetings: { prep: false } }, 'PATCH')
    ok((await api('/calls')).soon === null, 'Prepare for each meeting off: the card shows no meeting before it starts')
    await api('/settings', { meetings: { prep: true } }, 'PATCH')
    await p.context().close()
  }

  // ---------- The reminder: put off, turned off and on ----------
  // Remind me 1 min before: gone until then, for that meeting alone, kept through a restart, and
  // back once it's due. Remind me before meetings off (from the card's menu, or Settings): no
  // reminder; on again, it's back. Settings › Meetings has the switch in the desktop app.
  {
    const soonNow = (await api('/calls')).soon
    const snoozed = await api('/calls/snooze', { id: soonNow.id })
    ok(Date.parse(snoozed.until) === Date.parse(soonNow.start) - 60e3 && (await api('/calls')).soon === null, 'Remind me 1 min before: the reminder goes until a minute before the meeting starts', { snoozed, start: soonNow.start })
    const bad = await err('/calls/snooze', { id: 'no-such-meeting' })
    ok(/isn't on your calendar/.test(bad?.message || ''), "a meeting that isn't on the calendar: refused, saying why", bad?.message)
    await kit.restart()
    await api('/calendar')
    ok(!!(await until(async () => (await api('/calendar')).today.length > 0, 8000)) && (await api('/calls')).soon === null, 'Bridge AI restarted: still put off')
    // A minute before it starts: due again (the time it was put off until, moved to now).
    const file = path.join(kit.data, 'cache', 'meeting-reminders.json')
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, { ...v, until: new Date(Date.now() + OFFSET - 1000).toISOString() }]))))
    const back = (await api('/calls')).soon
    ok(back?.id === soonNow.id && back.snoozed === true, 'once it\'s due: the reminder is back, for the same meeting', back)
    await api('/settings', { meetings: { remind: false } }, 'PATCH')
    ok((await api('/calls')).soon === null, 'reminders turned off: none')
    await api('/settings', { meetings: { remind: true, prep: false } }, 'PATCH')
    ok((await api('/calls')).soon?.id === soonNow.id, 'turned on again: back (and on even with Prepare for each meeting off, once it\'s been set)')
    // Double-booked: another meeting with other people due at the same time. The card's meeting is
    // the first by its start, with the other in others; ‹ 1 of 2 › goes to it, with its own Join and
    // prep, and it stays through the card's next looks. Its × hides that one, and the first stays.
    {
      const s0 = Date.now() + OFFSET + 6 * 60e3
      const ALSO = ev('Budget check-in', 'Work', new Date(s0), new Date(s0 + 30 * 60e3), { attendees: ['Tester', 'Pat Lin'], notes: 'Join: https://meet.google.com/abc-defg-hij' })
      const alsoId = `${ALSO.title}|${ALSO.start}`
      fs.writeFileSync(path.join(kit.bin, 'bridgecal.json'), JSON.stringify({ status: 'granted', events: [...EVENTS, ALSO] }))
      await api('/calendar?refresh=1')
      const two = await until(async () => { const c = await api('/calls'); return c.soon?.others?.length === 1 && c.soon }, 8000)
      const both = two ? [two, ...two.others] : []
      ok(both.map((x) => x.id).sort().join() === [soonNow.id, alsoId].sort().join() && both.every((x) => typeof x.suggestions === 'number' && typeof x.snoozed === 'boolean' && x.start && x.join) && both.every((x) => !x.others || x === two) && !(two.start > two.others[0].start), '/api/calls with two due at once: the first by its start, and the other in others, each with what the card shows', two)
      const { p, errors } = await open({ mode: 'light' })
      const card = await p.context().newPage()
      card.on('pageerror', (e) => errors.push(`card: ${e.message}`))
      await card.setViewportSize({ width: 360, height: 620 })
      await card.goto(`${kit.url}/?float=1`)
      const among = card.locator('.float-card .mt-among')
      await until(() => among.count(), 15000)
      const title = () => card.locator('.float-card .fc-title').innerText().catch(() => '')
      const first = await title()
      const second = both.find((x) => x.title !== first)
      ok(first === two.title && (await among.locator('.mt-among-n').innerText()) === '1 of 2' && new RegExp(`Also coming up: ${second?.title}`).test(await card.locator('.fc-among-next').innerText()) && await among.getByRole('button', { name: 'Next meeting' }).count() === 1 && await among.getByRole('button', { name: 'Previous meeting' }).count() === 1, 'the card with two due: the first, "1 of 2", what the other is, and Previous and Next by name', { first, text: await card.locator('.float-card').innerText().catch(() => '') })
      const fits = await card.evaluate(() => { const c = document.querySelector('.float-card').getBoundingClientRect(), a = document.querySelector('.fc-among').getBoundingClientRect(), t = document.querySelector('.float-card .fc-title').getBoundingClientRect(); return { in: a.left >= c.left && a.right <= c.right + 0.5, title: Math.round(t.width) } })
      ok(fits.in && fits.title > 80, 'the arrows fit the card, the title as wide as it was', fits)
      await among.getByRole('button', { name: 'Next meeting' }).focus()
      await card.keyboard.press('Enter')
      await until(async () => (await title()) === second.title, 3000)
      await sleep(2600) // the card has looked again since
      const joinOf = () => card.locator('.float-card a.fc-join').getAttribute('href').catch(() => null)
      const invited = second.title === ALSO.title ? /1 invited/ : /3 invited/
      await until(async () => invited.test(await card.locator('.float-card').innerText().catch(() => '')), 8000)
      ok((await title()) === second.title && (await among.locator('.mt-among-n').innerText()) === '2 of 2' && (await joinOf()) === second.join && invited.test(await card.locator('.float-card').innerText()), 'Next, from the keyboard: the other meeting, its Join and its prep, still showing after the card looked again', { title: await title(), join: await joinOf(), want: second.join })
      await shot(card, `${tag}calendar-float-two`)
      // Hidden with its ×: that one only.
      await card.locator('.float-card .fc-head > .fc-x').last().click()
      const left = await until(async () => { const c = await api('/calls'); return c.soon && !c.soon.others.length && c.soon }, 5000)
      await until(async () => !(await among.count()) && (await title()) === first, 5000)
      ok(left?.id === two.id && (await title()) === first && !(await among.count()), 'its × with another due: that one is hidden, the other stays on the card, with no arrows', { left: left?.id, title: await title() })
      const badHide = await err('/calls/hide', { id: 'no-such-meeting' })
      ok(/isn't on your calendar/.test(badHide?.message || ''), "hiding a meeting that isn't on the calendar: refused, saying why", badHide?.message)
      ok(real(errors).length === 0, 'the card with two due: no page errors', errors)
      await p.context().close()
      fs.writeFileSync(path.join(kit.bin, 'bridgecal.json'), JSON.stringify({ status: 'granted', events: EVENTS }))
      await api('/calendar?refresh=1')
      // (If the one hidden was the meeting the rest of this test is about, it's due again for what follows.)
      const file2 = path.join(kit.data, 'cache', 'meeting-reminders.json')
      fs.writeFileSync(file2, JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(file2, 'utf8'))).map(([k, v]) => [k, v.hidden ? { start: v.start, until: new Date(Date.now() + OFFSET - 1000).toISOString() } : v]))))
      ok(!!(await until(async () => { const c = await api('/calls'); return c.soon?.id === soonNow.id && !c.soon.others.length }, 8000)), 'the other gone from the calendar: one meeting on the card again')
    }
    await api('/settings', { meetings: { prep: true } }, 'PATCH')
    // Settings › Meetings, in the desktop app: Remind me before meetings, off and on. (Only where
    // there's a calendar to remind from: a Mac's.)
    if (!IS_MAC) skip('Settings › Meetings › Remind me before meetings, off and on', 'it shows only with a calendar, which is a Mac\'s (Calendar or icalBuddy)')
    else {
      // (Said to be the desktop app once the page is up, for Settings to show what's the app's.)
      const { p, errors } = await open({ mode: 'light' })
      await p.evaluate(() => { window.bridgeApp = { desktop: true, platform: 'darwin' }; window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meeting-remind' } })) })
      const sw = p.locator('.modal.settings [data-setting="meeting-remind"]')
      await until(() => sw.isVisible(), 10000)
      const box = sw.locator('input[type="checkbox"]')
      ok(await sw.isVisible() && /Remind me before meetings/.test(await sw.innerText()) && await box.isChecked(), 'Settings › Meetings › Remind me before meetings, on, found as ⌘K finds it', await sw.innerText().catch(() => ''))
      await box.click() // (it shows off once the server has it)
      ok(!!(await until(async () => (await api('/settings')).effective.meetings?.remind === false && (await api('/calls')).soon === null && !(await box.isChecked()), 5000)), 'turned off there: no reminder, and it shows off')
      await shot(p, `${tag}calendar-remind-setting`)
      await box.click()
      ok(!!(await until(async () => (await api('/calls')).soon?.id === soonNow.id, 5000)), 'and on again: the reminder is back')
      ok(real(errors).length === 0, 'Settings: no page errors', errors)
      await p.context().close()
    }
  }

  // ---------- Home's Coming Up ----------
  {
    await api('/settings', { trials: { home: true } }, 'PATCH')
    const pg = await page(b, kit.url, { width: 1440, height: 900, before: async (c) => { await setUp(c); await changeAnswer(c, /\/api\/config(\?|$)/, (real) => ({ ...real, calendar: true })) } })
    pages.push(pg)
    const { p, errors } = pg
    // A row by its own title: another's brief can name the meeting before it ("last time, …").
    const rowOf = (title) => p.locator('.hm-ev').filter({ has: p.locator('.hm-ev-main > b').getByText(title, { exact: true }) })
    const row = rowOf('Northwind pricing sync')
    await until(() => row.count(), 20000)
    await row.locator('.hm-prep-btn').click()
    await until(async () => /Agree on/.test(await row.innerText().catch(() => '')), 10000)
    const ht = await row.innerText().catch(() => '')
    ok(/3 invited/.test(ht) && /Last time: Northwind pricing sync/.test(ht) && /Agree on/.test(ht), "Home's Coming Up: Prep under the meeting", ht)
    await row.locator('.prep-who').click()
    const hg = row.locator('.gu')
    await until(() => hg.count(), 3000)
    ok((await hg.locator('.gu-row').count()) === 4 && await hg.locator('button.gu-met').count() === 2, "and \"3 invited\" opens to everyone invited, who you've met each a link to them", await hg.innerText().catch(() => ''))
    ok(!(await rowOf('Budget office hours').count()), "a meeting you declined isn't in Coming Up")
    // Once a day: the meetings left today and tomorrow's, so a daily one run before it's on today
    // (after midnight) is under both days.
    const listed = await p.locator('.hm-day').evaluateAll((days) => days.flatMap((d) => [...d.querySelectorAll('.hm-ev-main > b')].map((b) => `${d.querySelector('h4')?.textContent}: ${b.textContent}`)))
    ok(listed.length > 1 && new Set(listed).size === listed.length, 'Coming Up lists each meeting once', listed)
    await shot(p, `${tag}calendar-home`)
    // View Calendar, as it's Bridge AI's own: "Open in" is for another app (Open in Calendar, Open in Word).
    const opens = opener.opened().length
    ok(!(await row.locator('button', { hasText: /^\s*Open in /i }).count()), "Coming Up's way to the calendar isn't called Open in, as it doesn't leave Bridge AI", await row.locator('button').allInnerTexts())
    await row.locator('button', { hasText: 'View Calendar' }).click()
    ok(!!(await until(async () => /Northwind pricing sync/.test(await p.locator('.cal-detail h4').innerText().catch(() => '')), 10000)) && opener.opened().length === opens, "View Calendar opens the meeting in Today › Calendar, with its panel (not the Mac's Calendar)")
    ok(real(errors).length === 0, 'Home: no page errors', errors)
    await p.context().close()
    await api('/settings', { trials: { home: false } }, 'PATCH')
  }

  // ---------- A phone, light and dark ----------
  // The event asked for on a busy phone (held up for a moment as it's asked, which once kept its
  // Today from opening until after the event was said, and the sheet never came).
  for (const mode of ['light', 'dark']) {
    const { p, errors } = await open({ mode, phone: true })
    await openEvent(p, LATER, { busy: 200 })
    const sheet = p.locator('.cal-sheet')
    await until(async () => /wrote these/.test(await sheet.innerText().catch(() => '')), 15000)
    ok(/Ines Varga/.test(await sheet.innerText().catch(() => '')), `phone, ${mode}: the event opens in a sheet with its prep`)
    await sleep(500)
    await shot(p, `${tag}calendar-phone-sheet-${mode}`)
    const faults = await phoneFaults(p, '.cal-sheet')
    ok(!faults.length, `phone, ${mode}: the sheet fits the phone, every control a whole target`, faults)
    // A big invite: its guests, all of them, and its words, unfolded.
    await openEvent(p, KICKOFF)
    await until(async () => /12 guests/.test(await sheet.locator('.cal-guests').innerText().catch(() => '')), 10000)
    await sheet.locator('.cal-guests button', { hasText: 'Show all 12' }).click()
    await sheet.locator('.cal-invite .iv-more').click()
    const gf = []
    for (const at of ['.cal-guests .gu-head', '.cal-guests .gu-row:nth-child(7)', '.cal-guests .gu-row:last-child', '.cal-invite .iv-words', '.cal-invite .iv-call']) {
      await sheet.locator(at).first().scrollIntoViewIfNeeded().catch(() => {})
      await sleep(150)
      gf.push(...Object.entries(await phoneFaults(p, '.cal-sheet')).map(([k, v]) => `${at}: ${k} ${JSON.stringify(v)}`))
      if (at === '.cal-guests .gu-row:nth-child(7)') await shot(p, `${tag}calendar-phone-guests-${mode}`)
      if (at === '.cal-invite .iv-words') await shot(p, `${tag}calendar-phone-invite-${mode}`)
    }
    ok(!gf.length, `phone, ${mode}: a big invite's guests and words fit the phone, every control a whole target`, gf)
    await p.locator('.cal-sheet .icon-btn[aria-label="Close"]').click()
    await p.locator('.seg button', { hasText: /^W$/ }).click().catch(() => {})
    await sleep(800)
    await shot(p, `${tag}calendar-phone-week-${mode}`)
    const wf = await phoneFaults(p, '.calv')
    ok(!wf.length, `phone, ${mode}: the week fits the phone, every control a whole target`, wf)
    await p.locator('.seg button', { hasText: /^M$/ }).click().catch(() => {})
    await sleep(800)
    const mf = await phoneFaults(p, '.calv')
    ok(!mf.length, `phone, ${mode}: so does the month`, mf)
    await shot(p, `${tag}calendar-phone-month-${mode}`)
    await p.locator('.calv-view-btn').click()
    await sleep(300)
    const vf = await phoneFaults(p, '.calv-menu')
    ok(!vf.length, `phone, ${mode}: and the menu for week start and working hours`, vf)
    await shot(p, `${tag}calendar-phone-menu-${mode}`)
    ok(real(errors).length === 0, `phone, ${mode}: no page errors`, errors)
    await p.context().close()
  }

  // ---------- Through icalBuddy ----------
  // On a Mac whose calendar helper only says it may read (one from before it could), icalBuddy reads
  // instead: who's invited by name (an address when that's all there is), with no address, reply or
  // role, and the panel says why there are no replies.
  if (IS_MAC) {
    const day = ymd(at(9, 12))
    fs.writeFileSync(path.join(kit.bin, 'bridgecal.json'), JSON.stringify({ status: 'old', events: [] }))
    kit.program('icalBuddy', `process.stdout.write(${JSON.stringify(`@@EV@@Partner check-in (Work)\u00a6${day} at 15:00 - 15:30\u00a6attendees: Priya Shah, Dan Ruiz, Tester, sam@example.org, Conf Room 4 (8)\u00a6notes: Catch up on the pilot.\nhttps://docs.google.com/document/d/pilot/edit\n`)})`)
    const ib = by('Partner check-in', (await api(`/calendar/range?from=${day}&to=${day}&refresh=1`)).events)
    ok(ib?.replies === false && ib.guests.map((x) => x.name || x.email).join() === 'Priya Shah,Dan Ruiz,Tester,sam@example.org' && ib.guests.every((x) => x.status === null && x.role === null && !x.organizer) && ib.guests[3].email === 'sam@example.org' && ib.attendees.join() === 'Priya Shah,Dan Ruiz,Tester,sam' && ib.description === 'Catch up on the pilot.\nhttps://docs.google.com/document/d/pilot/edit', "through icalBuddy: who's invited by name (an address alone as one), no replies, and the invite's words", ib)
    const { p, errors } = await open()
    await until(() => p.locator('.calv-nav h3').count(), 15000)
    await openEvent(p, ib)
    const sec = p.locator('.cal-detail .cal-guests')
    await until(async () => /4 guests/.test(await sec.innerText().catch(() => '')), 10000)
    const it = await sec.innerText()
    ok(/^4 guests$/m.test(it) && /Who has replied isn't known here: icalBuddy reads only who's invited\./.test(it) && !(await sec.locator('.gu-reply').count()) && /sam@example\.org/.test(it) && !/Conf Room/.test(it), "the panel lists them with no replies, and says why", it)
    await shot(p, `${tag}calendar-icalbuddy`)
    ok(real(errors).length === 0, 'icalBuddy: no page errors', errors)
    await p.context().close()
    fs.writeFileSync(path.join(kit.bin, 'bridgecal.json'), JSON.stringify({ status: 'granted', events: EVENTS }))
  }

  // ---------- Read-only ----------
  const calls = fs.readFileSync(path.join(kit.bin, 'bridgecal.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  ok(calls.length > 0 && calls.every((a) => a.length === 0 || a[0] === 'status' || a[0] === 'events'), 'the calendar helper was only ever asked whether it may read, and to read', [...new Set(calls.map((a) => a[0] || '(ask)'))])
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  for (const pg of pages) await pg.ctx?.close().catch(() => {})
  await b.close().catch(() => {})
  model.stop()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
