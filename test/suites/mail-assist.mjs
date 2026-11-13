// Mail's read-only help (server/mail.js, mailassist.js, freetimes.js). Everywhere: AI Assist's
// Find a time on a seeded calendar (working hours and days, a buffer around meetings and
// more around one somewhere else, a booked day and a day away, the length asked for, the other
// side's working day, and theirs and yours not meeting); How You Write from recorded meetings (your
// lines as Who spoke marks them: your mic on a call, your voice in a room, not the call's side,
// another voice or a room nobody told apart), with no model first, then shown, edited and cleared;
// and no write path (osascript never run, no server code that scripts Mail, an agent told mail is
// read only). Off a Mac, mail, a draft and free times for an email say Mail is the Mac's, and Mail's
// index is never opened.
// On a Mac, the rest, on a made-up Apple Mail (its index and .emlx files in the server's own home
// folder) and a stand-in calendar (bridgecal), with the stand-in model: Done and Remind me kept by
// Bridge AI (off Needs you and back, a reminder that comes back saying so, new mail bringing a
// thread back, "remind me if nobody answers" going by itself once someone does); new mail seen as
// Mail's index changes, and a message read once, then kept; How You Write from sent mail too (your
// own words only, not what they quote or the signature); a draft that says which model and exactly
// what was sent, Shorter, Warmer and More direct, a nudge; free times for an email through the
// server, put into a draft; and Mail's index and files as they were, sqlite3 only ever read only.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { startKit, startModel, checks, until, sleep, ROOT, IS_MAC } from '../lib/harness.mjs'
import { makeMailbox, seedMeetings, calendarStandIn, rfc, sqliteBin } from '../stand-ins/mailbox.mjs'
import { freeTimes, asksToMeet, minutesAsked, theirZone, scheduleOf } from '../../server/freetimes.js'

const { ok, done } = checks('mail-assist')
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const pad = (n) => String(n).padStart(2, '0')
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LOCAL = -new Date().getTimezoneOffset()

// ---------- A calendar ----------
// The next three working days after today: the first fully booked, the second with a meeting
// somewhere else at 10, the third away all day.
const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d }
const work = []
for (let n = 1; work.length < 3; n++) { const d = day(n); if (d.getDay() >= 1 && d.getDay() <= 5) work.push(d) }
const [D1, D2, D3] = work
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x }
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const EVENTS = [
  { title: 'Planning', calendar: 'Work', start: at(D1, 9).toISOString(), end: at(D1, 12).toISOString(), allDay: false, attendees: [] },
  { title: 'Workshop', calendar: 'Work', start: at(D1, 13).toISOString(), end: at(D1, 17).toISOString(), allDay: false, attendees: [] },
  { title: 'Site visit', calendar: 'Work', start: at(D2, 10).toISOString(), end: at(D2, 11).toISOString(), allDay: false, location: 'Unit 4, North Yard', attendees: [] },
  { title: 'Out of office', calendar: 'Work', start: at(D3, 0).toISOString(), end: (() => { const x = new Date(D3); x.setDate(x.getDate() + 1); return x.toISOString() })(), allDay: true, attendees: [] },
  { title: 'Cancelled: old sync', calendar: 'Work', start: at(D2, 15).toISOString(), end: at(D2, 16).toISOString(), allDay: false, canceled: true, attendees: [] },
]
const SCHEDULE = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', buffer: 15, travel: 30, count: 3 }
const wall = (iso, zone) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', weekday: 'short', hour: 'numeric', minute: 'numeric', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return { wd: WD.indexOf(p.weekday), mins: (Number(p.hour) % 24) * 60 + Number(p.minute), day: `${p.year}-${p.month}-${p.day}` }
}
// Clear of every meeting by its buffer: 15 minutes, 30 around one somewhere else.
const clear = (s) => EVENTS.filter((x) => !x.canceled && !x.allDay).every((x) => { const p = (x.location ? 30 : 15) * 60e3; return Date.parse(s.end) <= Date.parse(x.start) - p || Date.parse(s.start) >= Date.parse(x.end) + p })
const inHours = (s, from = 9 * 60) => { const a = wall(s.start, ZONE), b = wall(s.end, ZONE); return a.wd >= 1 && a.wd <= 5 && a.mins >= from && b.mins <= 17 * 60 && a.day === b.day }

// ---------- Find a time's time-finding, on every system ----------
{
  ok(asksToMeet('Could we find a time next week for a 45 minute call about the rollout?') && asksToMeet('When are you free on Thursday?') && !asksToMeet('Could you send me the budget sheet please?'), 'an email asking to meet is told from one that doesn\'t')
  ok(minutesAsked('a 45 minute call') === 45 && minutesAsked('half an hour') === 30 && minutesAsked('an hour') === 60 && minutesAsked('a quick chat') === null, 'how long they ask for: 45 minutes, half an hour, an hour, or not said')
  const nov = new Date(Date.UTC(2026, 10, 10, 12)), jul = new Date(Date.UTC(2026, 6, 10, 12))
  ok(theirZone({ date: 'Thu, 05 Nov 2026 10:12:00 -0500' })?.offset === -300 && theirZone({ text: "I'm on PT, mornings are best", at: nov })?.offset === -480 && theirZone({ text: "I'm on PT", at: jul })?.offset === -420 && theirZone({ text: 'Anything after 2pm CET works' })?.offset === 60 && theirZone({ text: 'Thanks' }) === null,
    'their time zone: from their Date header, or one they name (PT in winter and summer, CET), and none when neither says')
  const s = scheduleOf({ mail: { schedule: SCHEDULE } })
  ok(s.start === 540 && s.end === 1020 && s.buffer === 15 && s.travel === 30 && s.days.join() === '1,2,3,4,5' && scheduleOf({}).count === 3, 'working hours from settings, Monday to Friday 9 to 5 unless set')
  const now = day(0) // the start of today: today's working hours count too
  let r = freeTimes({ events: EVENTS, now, zone: ZONE, schedule: SCHEDULE, minutes: 30 })
  ok(r.slots.length === 3 && r.slots.every((x) => inHours(x) && clear(x)) && !r.slots.some((x) => [ymd(D1), ymd(D3)].includes(wall(x.start, ZONE).day)), '3 free half hours: in working hours on working days, clear of meetings, none on the booked day or the day away', r.slots.map((x) => wall(x.start, ZONE)))
  ok(r.slots.some((x) => x.start === at(D2, 9).toISOString()), 'the half hour before the site visit\'s travel time is free (9:00)', r.slots)
  r = freeTimes({ events: EVENTS, now, zone: ZONE, schedule: SCHEDULE, minutes: 45 })
  ok(r.minutes === 45 && r.slots.every((x) => Date.parse(x.end) - Date.parse(x.start) === 45 * 60e3 && clear(x)) && !r.slots.some((x) => x.start === at(D2, 9).toISOString()), '45 minutes: as long as asked, and 9:00 before the site visit no longer fits', r.slots)
  const behind = -D2.getTimezoneOffset() - 180
  r = freeTimes({ events: EVENTS, now, zone: ZONE, schedule: SCHEDULE, minutes: 45, theirs: { offset: behind } })
  const theirs = (x) => { const t = new Date(Date.parse(x.start) + behind * 60e3); return { h: t.getUTCHours() + t.getUTCMinutes() / 60, wd: t.getUTCDay() } }
  ok(r.both === true && r.slots.length === 3 && r.slots.every((x) => inHours(x) && clear(x) && theirs(x).h >= 9 && theirs(x).h + 0.75 <= 18 && theirs(x).wd >= 1 && theirs(x).wd <= 5), 'three hours behind: in your working hours and in theirs', r.slots.map(theirs))
  r = freeTimes({ events: EVENTS, now, zone: ZONE, schedule: SCHEDULE, minutes: 30, theirs: { offset: -D2.getTimezoneOffset() + 12 * 60 } })
  ok(r.both === false && r.slots.length === 3 && r.slots.every((x) => inHours(x)), 'twelve hours apart, the days don\'t meet: it says so, and offers yours', r)
  r = freeTimes({ events: EVENTS, now, zone: ZONE, schedule: { ...SCHEDULE, start: '10:00' }, minutes: 30 })
  ok(r.slots.every((x) => inHours(x, 10 * 60)), 'from 10:00 when that\'s when your day starts', r.slots.map((x) => wall(x.start, ZONE)))
  r = freeTimes({ events: EVENTS, now, zone: ZONE, schedule: { ...SCHEDULE, count: 5 }, minutes: 30 })
  ok(r.slots.length === 5, 'five times when Settings › Mail asks for five', r.slots.length)
}

const kit = await startKit('mail-assist', { config: { name: 'Sam Tester', mail: { myDomains: ['example.com'], schedule: SCHEDULE } }, env: ({ bin }) => (IS_MAC ? { BRIDGE_CALASK: calendarStandIn(bin), TZ: ZONE } : {}) })
const model = await startModel('mail-assist')
const api = kit.api
const err = (p, body, method) => api(p, body, method).then(() => null, (e) => e)

// What's run by the server, logged: sqlite3 (then the system's, on a Mac) and osascript (never the
// real one).
const LOGS = path.join(kit.bin, 'runs.log')
const real = sqliteBin()
kit.program('sqlite3', `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(LOGS)}, JSON.stringify({ sqlite3: process.argv.slice(2) }) + '\\n')
${IS_MAC ? `const r = require('node:child_process').spawnSync(${JSON.stringify(real)}, process.argv.slice(2), { stdio: 'inherit' }); process.exit(r.status ?? 1)` : 'process.exit(1)'}`)
kit.program('osascript', `require('node:fs').appendFileSync(${JSON.stringify(LOGS)}, JSON.stringify({ osascript: process.argv.slice(2) }) + '\\n')`)
const runs = () => (fs.existsSync(LOGS) ? fs.readFileSync(LOGS, 'utf8') : '').split('\n').filter(Boolean).map((l) => JSON.parse(l))

const DRAFT_ASK = /reply to the email below|follow-up asking again/
const ME = 'Sam Tester <me@example.com>'

// ---------- Off a Mac: Mail is the Mac's; How You Write from meetings ----------
async function elsewhere() {
  seedMeetings(kit)
  const r = await api('/mail')
  ok(r.available === false && r.reason === 'notMac' && /macOS/.test(r.setup), 'not a Mac: the inbox says it reads Apple Mail on macOS', r)
  for (const [p, what] of [['/mail/1/draft', 'a draft'], ['/mail/1/times', 'free times for an email'], ['/mail/message/1', 'an email']]) {
    const e = await err(p, p.endsWith('draft') ? {} : null)
    ok(/isn't available on this platform/.test(e?.message || ''), `${what}: says Mail is the Mac's`, e?.message)
  }
  let v = await api('/mail/voice')
  ok(v.profile === null && v.now === null, 'How You Write: nothing yet, and no model to learn with', v)
  const e = await err('/mail/voice/learn', {})
  ok(e?.j?.code === 'no_model' && /Model Providers/.test(e.message), 'with no model, learning says so and where to add one', e?.j)
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { model: 'openai:gpt-5' } }, 'PATCH')
  v = await api('/mail/voice/learn', {})
  const learnt = model.asked(/Describe how they write email/).at(-1) || ''
  ok(/Read 0 emails and 2 meeting lines/.test(v.profile || '') && v.from?.replies === 0 && v.from.lines === 2 && v.from.meetings === 2 && !v.examples.length && v.model === 'openai:gpt-5', 'learnt from your 2 lines in 2 meetings, with no mail here, by the model for meeting notes', v)
  ok(/ship the pilot on Monday/.test(learnt) && /keep the review short/.test(learnt) && !/budget is not approved/.test(learnt) && !/wait until next quarter/.test(learnt) && !/Nobody can tell/.test(learnt) && !/Fine by me/.test(learnt),
    'only your lines: your mic on a call and your voice in a room, not the call\'s side, another voice or a room nobody told apart', learnt.split('\n').filter((l) => /^M\d/.test(l)))
  v = await api('/mail/voice', { profile: '- Short and friendly' }, 'PUT')
  ok(v.profile === '- Short and friendly' && !!v.editedAt, 'changed by you')
  v = await api('/mail/voice', null, 'DELETE')
  ok(v.profile === null && !fs.existsSync(path.join(kit.data, 'mail', 'voice.json')), 'and cleared: nothing kept')
  ok(!runs().some((x) => x.sqlite3), 'Mail\'s index was never opened (no sqlite3)', runs())
}

// ---------- On a Mac: the whole of it, on a made-up Apple Mail (stand-ins/mailbox.mjs) ----------
async function onMac() {
  const box = makeMailbox(kit)
  const { V, sqlite, emlx, who } = box
  ok(fs.existsSync(box.INDEX), 'the made-up index is there')
  // ---------- The inbox, with Done and Remind me ----------
  let r = await api('/mail?refresh=1')
  ok(r.available && r.messages.length === 4, 'the inbox reads', r.error || r.messages?.map((m) => m.subject))
  const bucket = (id) => r.messages.find((m) => m.id === id)?.bucket
  ok(bucket(1) === 'needs' && bucket(4) === 'needs', 'Dana\'s and Kim\'s asks need you', r.messages.map((m) => [m.id, m.bucket, m.score]))
  ok(r.waiting.some((w) => w.id === 130 && w.conv === 300), 'the contract nobody answered is in Waiting', r.waiting)

  await api('/mail/mark', { key: 'c11', id: 1, mark: 'done', subject: 'Can you review the launch plan by today?' })
  r = await api('/mail')
  ok(bucket(1) === 'done' && !!r.messages.find((m) => m.id === 1).done && r.needs === r.messages.filter((m) => m.bucket === 'needs').length && !r.messages.some((m) => m.id === 1 && m.bucket === 'needs'), 'Done takes the thread off Needs you, kept by Bridge AI', r.messages.find((m) => m.id === 1))
  const marks = JSON.parse(fs.readFileSync(path.join(kit.data, 'mail', 'marks.json'), 'utf8'))
  ok(marks.threads.c11?.mark === 'done', 'in the data folder (mail/marks.json)', marks)
  // Undo: put back as it was.
  await api('/mail/mark', { key: 'c11', mark: 'clear' })
  r = await api('/mail')
  ok(bucket(1) === 'needs', 'Undo puts it back in Needs you', bucket(1))
  await api('/mail/mark', { key: 'c11', id: 1, mark: 'done' })

  const bad = await err('/mail/mark', { key: 'c13', id: 4, mark: 'later', until: new Date(Date.now() - 60e3).toISOString() })
  ok(/from now/.test(bad?.message || ''), 'Remind me in the past is turned down, saying why', bad?.message)
  await api('/mail/mark', { key: 'c13', id: 4, mark: 'later', until: new Date(Date.now() + 2500).toISOString(), subject: 'Can you send the budget?' })
  r = await api('/mail')
  ok(bucket(4) === 'later' && !!r.messages.find((m) => m.id === 4).later, 'Remind me sets it aside until then', r.messages.find((m) => m.id === 4))
  await sleep(3000)
  r = await api('/mail?refresh=1')
  const back = r.messages.find((m) => m.id === 4)
  ok(back.bucket === 'needs' && back.reasons[0] === 'Reminder' && !!back.reminded, 'and at its time it\'s back in Needs you, saying it\'s a reminder', back)

  // Remind me if nobody answers: on the contract, then Kim answers and it goes by itself.
  await api('/mail/mark', { sent: 130, conv: 300, mark: 'nudge', until: new Date(Date.now() + 2000).toISOString(), subject: 'Contract for the pilot', to: 'Kim Ito' })
  r = await api('/mail')
  ok(r.nudges.length === 1 && r.nudges[0].id === 130 && !r.nudges[0].due && r.waiting.find((w) => w.id === 130)?.nudge, 'Remind me if nobody answers, on what you sent', r.nudges)
  await sleep(2500)
  r = await api('/mail?refresh=1')
  ok(r.nudges[0]?.due === true, 'nobody answered by then: it\'s due', r.nudges)

  // ---------- New mail, as Mail's index changes ----------
  const heard = []
  const ctl = new AbortController()
  const live = fetch(`${kit.url}/api/mail/live`, { signal: ctl.signal }).then(async (res) => {
    const reader = res.body.getReader()
    for (;;) { const { value, done: end } = await reader.read(); if (end) break; heard.push(...Buffer.from(value).toString().split('\n').filter((l) => l.startsWith('data:'))) }
  }).catch(() => {})
  ok(!!(await until(() => heard.some((l) => /"watching":true/.test(l)), 5000, 100)), 'the app is told Bridge AI is watching Mail\'s index', heard)
  await api('/mail') // read now, so the next answer would come from what's kept
  // Kim answers the contract, and Dana writes again in the thread marked done.
  const t2 = Math.floor(Date.now() / 1000)
  sqlite(`INSERT INTO subjects VALUES (90, 'Re: Contract for the pilot'); INSERT INTO message_global_data VALUES (140, 0, 0, '<m140@example.com>', NULL);
INSERT INTO messages VALUES (140, 0, 0, 0, ${t2 + 5}, ${t2}, 1, 5, 90, 140, NULL, 300, 0); INSERT INTO recipients (message, address, type) VALUES (140, 2, 0);
INSERT INTO subjects VALUES (91, 'Re: Can you review the launch plan by today?'); INSERT INTO message_global_data VALUES (141, 0, 0, '<m141@example.com>', NULL);
INSERT INTO messages VALUES (141, 0, 0, 0, ${t2 + 6}, ${t2 + 1}, 1, 1, 91, 141, NULL, 11, 0); INSERT INTO recipients (message, address, type) VALUES (141, 2, 0);`)
  emlx('Inbox', 140, { from: who(5), to: ME, subject: 'Re: Contract for the pilot', date: rfc(t2, LOCAL), body: 'Signed, thanks!' })
  emlx('Inbox', 141, { from: who(1), to: ME, subject: 'Re: Can you review the launch plan by today?', date: rfc(t2, LOCAL), body: 'One more thing: the dates moved.' })
  ok(!!(await until(() => heard.some((l) => /"changed"/.test(l)), 10000, 200)), 'Mail\'s index changing is told to the app at once', heard)
  r = await api('/mail')
  ok(r.messages.some((m) => m.id === 140), 'and the inbox has the new mail without waiting (nothing kept from before)', r.messages.map((m) => m.id))
  ok(!r.nudges.length && !r.waiting.some((w) => w.id === 130), 'someone answered: the reminder for the contract went by itself', { nudges: r.nudges })
  ok(r.messages.filter((m) => m.conv === 11).every((m) => m.bucket !== 'done'), 'new mail in a thread marked done brings it back', r.messages.filter((m) => m.conv === 11))
  ctl.abort()
  await live

  // A message read once is kept: reading it again doesn't ask Mail's index.
  await api('/mail/message/3')
  const before = runs().filter((x) => x.sqlite3).length
  const m3 = await api('/mail/message/3')
  ok(runs().filter((x) => x.sqlite3).length === before && m3.meet?.asks === true && m3.meet.minutes === 45, 'a message read again comes from what\'s kept, and says it asks to meet for 45 minutes', { before, after: runs().filter((x) => x.sqlite3).length, meet: m3.meet })
  const m4 = await api('/mail/message/4')
  ok(m4.meet?.asks === false, 'one that doesn\'t ask to meet says so', m4.meet)

  // ---------- With no model ----------
  let e = await err('/mail/1/draft', {})
  ok(e?.j?.code === 'no_model' && /No model to write with/.test(e.message) && /Model Providers/.test(e.message), 'no model: Draft a reply says so, and where to add one', e?.j)
  e = await err('/mail/voice/learn', {})
  ok(e?.j?.code === 'no_model', 'and so does learning How You Write', e?.j)
  let v = await api('/mail/voice')
  ok(v.profile === null && v.now === null && /No model/.test(v.error || ''), 'How You Write: nothing yet, no model to use, and why it couldn\'t learn', v)

  // ---------- How You Write ----------
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { model: 'openai:gpt-5' } }, 'PATCH')
  v = await api('/mail/voice/learn', {})
  const learnt = model.asked(/Describe how they write email/).at(-1) || ''
  ok(/Signs off with "Cheers"/.test(v.profile || '') && /Read 23 emails and 2 meeting lines/.test(v.profile) && v.from?.replies === 23 && v.from.lines === 2 && v.from.meetings === 2 && v.model === 'openai:gpt-5',
    'learnt from the 23 messages you sent and your 2 lines in 2 meetings, by the model for meeting notes', v)
  ok(/Sounds good, I'll take a look at item 1 this afternoon/.test(learnt) && !/Quoted words that are not yours/.test(learnt) && !/Example Co/.test(learnt) && !/Big savings|budget sheet|Rollout call/.test(learnt),
    'what was sent: your own words from mail you sent, not what they quote or your signature', learnt.slice(0, 600))
  ok(/ship the pilot on Monday/.test(learnt) && /keep the review short/.test(learnt) && !/budget is not approved/.test(learnt) && !/wait until next quarter/.test(learnt) && !/Nobody can tell/.test(learnt) && !/Fine by me/.test(learnt),
    'and your lines in meetings: your mic on a call and your voice in a room, not the call\'s side, another voice or a room nobody told apart', learnt.split('\n').filter((l) => /^M\d/.test(l)))
  ok(v.examples.length === 1 && /Attached is the contract for the pilot/.test(v.examples[0].text) && !/Example Co/.test(v.examples[0].text), 'its example is one of your own emails, the one the model picked', v.examples)
  ok(fs.existsSync(path.join(kit.data, 'mail', 'voice.json')), 'kept on this computer, in the data folder')
  v = await api('/mail/voice', { profile: '- Writes short, friendly replies\n- Signs off "Cheers"', examples: [...v.examples, { text: 'Hey Lee, works for me. Cheers' }] }, 'PUT')
  ok(v.profile === '- Writes short, friendly replies\n- Signs off "Cheers"' && v.examples.length === 2 && !!v.editedAt, 'changed by you: the profile and an example added', v)

  // ---------- Draft a reply ----------
  let d = await api('/mail/1/draft', {})
  const asked = model.requests().filter((x) => DRAFT_ASK.test(JSON.stringify(x.messages))).at(-1)
  const user = asked?.messages.find((x) => x.role === 'user')?.content || ''
  ok(d.draft.startsWith('Hi Dana,') && !d.draft.includes('```') && d.model === 'openai:gpt-5' && /gpt-5/.test(d.modelLabel) && d.local === false, 'a draft in your voice, by the model for meeting notes, saying which', d)
  ok(/Can you review the launch plan by today/.test(user) && /Send it over when it's ready/.test(user) && /Writes short, friendly replies/.test(user) && /Hey Lee, works for me/.test(user) && /item 1 this afternoon/.test(user),
    'what went to the model: the email, what it quotes, your How You Write profile and your replies (one to Dana)', user.slice(0, 900))
  ok(!/Rollout call|budget sheet|Big savings/.test(user), 'and nothing from other mail', user.slice(0, 300))
  ok(d.prompt.endsWith(user) && d.sent.email && d.sent.quoted && d.sent.profile && d.sent.examples >= 2 && !d.sent.times, 'what was sent comes back word for word, and in short', d.sent)
  ok(d.reply.to[0]?.address === 'dana@example.com' && d.reply.subject === 'Re: Can you review the launch plan by today?', 'with who it goes to and its subject, for your mail app', d.reply)
  for (const [tweak, want] of [['shorter', 'Yes, today.'], ['warmer', 'Thanks so much'], ['direct', 'by 5 today']]) {
    const t = await api('/mail/1/draft', { tweak, text: d.draft })
    const said = model.asked(DRAFT_ASK).at(-1) || ''
    ok(t.draft.includes(want) && said.includes('Their draft so far') && said.includes("Thanks, I'll review the launch plan today") && t.sent.draft, `${tweak}: the draft so far, changed`, { draft: t.draft })
  }
  d = await api('/mail/1/draft', { voice: false })
  const plainAsk = model.asked(DRAFT_ASK).at(-1) || ''
  ok(!/How You Write/.test(plainAsk) && !/Replies they wrote before/.test(plainAsk) && !d.sent.profile && !d.sent.examples, 'without How You Write: neither the profile nor your replies go', d.sent)
  d = await api('/mail/130/draft', { nudge: true })
  ok(/Just checking in/.test(d.draft) && d.reply.to[0]?.address === 'kim@example.com', 'a nudge for mail nobody answered, to who you sent it to', d)

  // ---------- Find a time ----------
  e = await err('/mail/3/times')
  ok(e?.j?.code === 'calendarAccess', 'with the calendar not allowed, Find a time says so (to allow it)', e?.j)
  fs.writeFileSync(path.join(kit.bin, 'bridgecal.json'), JSON.stringify({ status: 'granted', events: EVENTS }))
  let t = await api('/mail/3/times')
  const theirDay = (s) => { const x = new Date(Date.parse(s.start) + t.theirs.offset * 60000); return { h: x.getUTCHours() + x.getUTCMinutes() / 60, wd: x.getUTCDay() } }
  ok(t.zone === ZONE && t.asks && t.asked === 45 && t.minutes === 45 && t.theirs?.offset === LOCAL - 180 && t.both === true, 'Lee asks for 45 minutes, three hours behind (from the Date header)', { zone: t.zone, asked: t.asked, theirs: t.theirs, both: t.both })
  ok(t.slots.length === 3 && t.slots.every((s) => Date.parse(s.end) - Date.parse(s.start) === 45 * 60e3), '3 times, each 45 minutes', t.slots)
  ok(t.slots.every((s) => { const a = wall(s.start, ZONE), b = wall(s.end, ZONE); return a.wd >= 1 && a.wd <= 5 && a.mins >= 9 * 60 && b.mins <= 17 * 60 && a.day === b.day }), 'all in your working hours, on working days', t.slots.map((s) => wall(s.start, ZONE)))
  ok(t.slots.every((s) => { const x = theirDay(s); return x.h >= 9 && x.h + 0.75 <= 18 && x.wd >= 1 && x.wd <= 5 }), 'and in Lee\'s working day too', t.slots.map(theirDay))
  ok(t.slots.every((s) => clear(s)) && !t.slots.some((s) => [ymd(D1), ymd(D3)].includes(wall(s.start, ZONE).day)), 'clear of your meetings by 15 minutes (30 around the site visit), none on the booked day or the day away', t.slots)
  ok(t.slots.every((s) => Date.parse(s.start) >= Date.now() + 55 * 60e3), 'and none in the next hour', t.slots)
  // Another email with no zone named, mail from your own time zone: your hours only, the length asked.
  t = await api('/mail/4/times?minutes=30')
  ok(t.theirs === null && t.both === null && t.minutes === 30, 'from your own time zone, nothing about theirs', { theirs: t.theirs, both: t.both })
  ok(t.slots.some((s) => s.start === at(D2, 9).toISOString()), 'the first free half hour before the site visit\'s travel time is offered (9:00)', t.slots)
  await api('/settings', { mail: { myDomains: ['example.com'], schedule: { ...SCHEDULE, start: '10:00', buffer: 30 } } }, 'PATCH')
  t = await api('/mail/4/times?minutes=30')
  ok(t.slots.every((s) => wall(s.start, ZONE).mins >= 10 * 60) && t.schedule.start === 600 && t.schedule.buffer === 30, 'working hours from Settings › Mail: from 10:00 now', t.slots.map((s) => wall(s.start, ZONE)))
  await api('/settings', { mail: { myDomains: ['example.com'], schedule: SCHEDULE } }, 'PATCH')
  t = await api('/mail/3/times')
  d = await api('/mail/3/draft', { times: t.slots, theirs: t.theirs })
  const timed = model.asked(DRAFT_ASK).at(-1) || ''
  ok(/Times they're free/.test(timed) && (timed.match(/^- .* to \d\d:\d\d \(/gm) || []).length === 3 && /their time, UTC/.test(timed) && /I could meet at any of these/.test(d.draft) && d.sent.times === 3, 'the times go into the draft, in your words, with Lee\'s time beside yours', { asked: timed.split('\n').filter((l) => /^- /.test(l)), draft: d.draft })

  // ---------- How You Write, cleared ----------
  v = await api('/mail/voice', null, 'DELETE')
  ok(v.profile === null && !v.examples.length && !fs.existsSync(path.join(kit.data, 'mail', 'voice.json')), 'cleared: nothing kept', v)

  // ---------- No write path anywhere ----------
  // Every file of Mail's, but for its index's shared memory (-shm), which SQLite has every reader of
  // an index with a write-ahead log write to, as it reads.
  const snap = () => {
    const out = []
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!e.name.endsWith('-shm')) { const s = fs.statSync(p); out.push(`${path.relative(V, p)} ${s.size} ${s.mtimeMs} ${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`) } } }
    walk(path.join(kit.home, 'Library', 'Mail'))
    return out.sort().join('\n')
  }
  const was = snap()
  await api('/mail?refresh=1')
  for (const id of [1, 3, 4, 130]) await api(`/mail/message/${id}`)
  await api('/mail/mark', { key: 'c12', id: 3, mark: 'done' })
  await api('/mail/mark', { key: 'c12', mark: 'clear' })
  await api('/mail/voice/learn', {})
  await api('/mail/1/draft', {})
  await api('/mail/3/times')
  ok(snap() === was, 'Mail\'s index and message files are exactly as they were, after reading, Done, Remind me, learning, drafting and scheduling')
  const sq = runs().filter((x) => x.sqlite3)
  ok(sq.length > 5 && sq.every((x) => x.sqlite3.includes('-readonly') && x.sqlite3.some((a) => /\?mode=ro(?:&immutable=1)?$/.test(a))), 'sqlite3 was only ever opened read only (as it stands, once Mail has quit)', sq.filter((x) => !x.sqlite3.includes('-readonly')).slice(0, 3))
}

try {
  if (IS_MAC) await onMac()
  else await elsewhere()
  // ---------- No write path, on every system ----------
  ok(!runs().some((x) => x.osascript), 'osascript never ran: Mail was never scripted', runs().filter((x) => x.osascript))
  // In the code: nothing scripts Mail, and an agent working on mail is told it's read only.
  const code = ['mail.js', 'mailparse.js', 'mailassist.js', 'freetimes.js', 'openin.js', 'index.js'].map((f) => [f, fs.readFileSync(path.join(ROOT, 'server', f), 'utf8').replace(/\r\n/g, '\n')])
  const scripts = code.filter(([, s]) => /tell application "Mail"|Application\(['"]Mail['"]\)|\b(?:set (?:read|flagged|junk mail|deleted) status|make new outgoing message|send outgoing|move \w+ to mailbox)\b/i.test(s)).map(([f]) => f)
  ok(!scripts.length, 'no server code scripts Mail (no tell application "Mail", no read, flag, junk, delete, move or send)', scripts)
  const index = code.find(([f]) => f === 'index.js')[1]
  const guard = /const GUARD = '([^\n]+)'\n/.exec(index)?.[1] || ''
  ok(/read only/.test(guard) && /never put a draft into Mail/.test(guard) && /never send, reply, forward, archive, flag, mark, move or delete mail/.test(guard) && !/put it into Mail as a draft|AppleScript: find the message/.test(index), 'an agent asked about an email is told mail is read only, and never to put a draft into Mail', guard)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-2000))
} finally {
  kit.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
