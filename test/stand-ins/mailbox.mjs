// A made-up Apple Mail for the mail tests: Mail's index ("Envelope Index", SQLite, as Mail keeps
// it) and each message's .emlx file, in a test server's home folder (Library/Mail/V10), and a few
// recorded meetings in its data folder. All invented: example.com addresses, made-up people. Mail
// is a Mac's (makeMailbox, with the system's sqlite3); the meetings are anywhere (seedMeetings).
//   Inbox: 1 Dana asks for a review today (quoting your last message); 2 a shop's deals; 3 Lee, three
//   hours behind you (their Date header), asks for a 45 minute call; 4 Kim asks for the budget.
//   Sent: 100-121, 22 replies in your own words with a signature, each quoting what it answers;
//   130, a contract nobody has answered (Waiting).
//   Meetings: a call (your mic's lines are yours), a room with voices told apart (voice 1 is you),
//   and a room nobody told apart.
// makeMailbox(kit) -> { V, INDEX, sqlite(q), emlx(folder, id, headers), who(n), rfc(unix, off), LOCAL, now }
// (it seeds the meetings too). openStandIn(kit): macOS's open and the Mac's Mail and Calendar,
// stood in for, for Open in Mail and Open in Calendar.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const pad = (n) => String(n).padStart(2, '0')
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// A Date header as a mail app writes it, at that many minutes from UTC.
export const rfc = (unix, off) => { const t = new Date(unix * 1000 + off * 60000); return `${WD[t.getUTCDay()]}, ${pad(t.getUTCDate())} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00 ${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}` }
// The system's sqlite3 (a Mac has one in /usr/bin), found only when asked: nothing runs as this loads.
export const sqliteBin = () => (process.platform === 'win32' ? null : spawnSync('/bin/sh', ['-c', 'command -v sqlite3'], { encoding: 'utf8' }).stdout?.trim() || '/usr/bin/sqlite3')
const UUID = '0A1B2C3D-0000-4000-8000-00000000AB12'
export const PEOPLE = { 1: ['dana@example.com', 'Dana Lee'], 2: ['me@example.com', 'Sam Tester'], 3: ['news@example.com', 'Shop'], 4: ['lee@example.com', 'Lee Park'], 5: ['kim@example.com', 'Kim Ito'] }

export function makeMailbox(kit) {
  const SQLITE = sqliteBin()
  const now = Math.floor(Date.now() / 1000)
  const LOCAL = -new Date().getTimezoneOffset()
  const V = path.join(kit.home, 'Library', 'Mail', 'V10')
  fs.mkdirSync(path.join(V, 'MailData'), { recursive: true })
  const INDEX = path.join(V, 'MailData', 'Envelope Index')
  // A test writes the index while the server reads it, as Mail does: it has a write-ahead log, as
  // Mail's has (made so below), so a read never holds up a write (with SQLite's default journal, a
  // write during a read failed with "database is locked"), and a write waits for a lock as Mail's do.
  const sqlite = (q) => { const r = spawnSync(SQLITE, ['-cmd', '.timeout 5000', INDEX], { input: q, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout }
  const who = (n) => `${PEOPLE[n][1]} <${PEOPLE[n][0]}>`
  // A message's file where Mail keeps it, as .emlx: its length, the message, Mail's plist after it.
  const emlx = (folder, id, { from, to, cc, subject, date, body }) => {
    const head = [`From: ${from}`, `To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: ${subject}`, `Date: ${date}`, `Message-ID: <m${id}@example.com>`, 'Content-Type: text/plain; charset=utf-8']
    const raw = `${head.join('\r\n')}\r\n\r\n${body.replace(/\n/g, '\r\n')}\r\n`
    const d = path.join(V, 'ABC', `${folder}.mbox`, UUID, 'Data', 'Messages')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, `${id}.emlx`), `${Buffer.byteLength(raw)}\n${raw}<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict/></plist>\n`)
  }
  let text = `
PRAGMA journal_mode=WAL;
CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY, url TEXT);
CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY, address TEXT, comment TEXT);
CREATE TABLE subjects (ROWID INTEGER PRIMARY KEY, subject TEXT);
CREATE TABLE recipients (ROWID INTEGER PRIMARY KEY, message INTEGER, address INTEGER, type INTEGER);
CREATE TABLE attachments (ROWID INTEGER PRIMARY KEY, message INTEGER, attachment_id TEXT, name TEXT);
CREATE TABLE messages (ROWID INTEGER PRIMARY KEY, read INTEGER, flagged INTEGER, deleted INTEGER, date_received INTEGER, date_sent INTEGER,
  mailbox INTEGER, sender INTEGER, subject INTEGER, global_message_id INTEGER, summary INTEGER, conversation_id INTEGER, automated_conversation INTEGER);
CREATE TABLE message_global_data (ROWID INTEGER PRIMARY KEY, model_category INTEGER, model_high_impact INTEGER, message_id_header TEXT, generated_summary INTEGER);
CREATE TABLE summaries (ROWID INTEGER PRIMARY KEY, summary TEXT);
INSERT INTO mailboxes VALUES (1, 'ews://ABC/Inbox'), (2, 'ews://ABC/Sent Items');
INSERT INTO addresses VALUES ${Object.entries(PEOPLE).map(([n, [a, c]]) => `(${n}, '${a}', '${c}')`).join(', ')};
`
  let subj = 0
  const message = ({ id, box, from, to = [], subject, when, conv, read = 0, body, off = LOCAL, summary, category = 0 }) => {
    subj++
    text += `INSERT INTO subjects VALUES (${subj}, '${subject.replace(/'/g, "''")}');
INSERT INTO message_global_data VALUES (${id}, ${category}, 0, '<m${id}@example.com>', NULL);
${summary ? `INSERT INTO summaries VALUES (${id}, '${summary.replace(/'/g, "''")}');` : ''}
INSERT INTO messages VALUES (${id}, ${read}, 0, 0, ${when}, ${when - 60}, ${box}, ${from}, ${subj}, ${id}, ${summary ? id : 'NULL'}, ${conv}, 0);
${to.map((n) => `INSERT INTO recipients (message, address, type) VALUES (${id}, ${n}, 0);`).join('\n')}
`
    emlx(box === 1 ? 'Inbox' : 'Sent Items', id, { from: who(from), to: to.map(who).join(', '), subject, date: rfc(when, off), body })
  }
  message({ id: 1, box: 1, from: 1, to: [2], subject: 'Can you review the launch plan by today?', when: now - 3600, conv: 11, summary: 'Dana asks for a review of the launch plan today.',
    body: 'Hi Sam,\n\nCan you review the launch plan by today? It\'s attached.\n\nDana\n\nOn Tue, 3 Nov 2026 at 09:00, Sam Tester <me@example.com> wrote:\n> Send it over when it\'s ready.' })
  message({ id: 2, box: 1, from: 3, to: [2], subject: 'This week\'s deals', when: now - 7200, conv: 0, category: 3, body: 'Big savings on everything.' })
  message({ id: 3, box: 1, from: 4, to: [2], subject: 'Rollout call next week?', when: now - 5400, conv: 12, off: LOCAL - 180, summary: 'Lee asks to find a time for a call.',
    body: 'Hi Sam,\n\nCould we find a time next week for a 45 minute call about the rollout? Let me know what works.\n\nThanks,\nLee' })
  message({ id: 4, box: 1, from: 5, to: [2], subject: 'Can you send the budget?', when: now - 9000, conv: 13, summary: 'Kim asks for the budget.', body: 'Hi Sam, could you send me the budget sheet please? Kim' })
  for (let i = 0; i < 22; i++) {
    const to = [1, 4, 5][i % 3]
    message({ id: 100 + i, box: 2, from: 2, to: [to], subject: `Re: Item ${i + 1}`, when: now - (i + 3) * 86400, conv: 200 + i, read: 1,
      body: `Hi ${PEOPLE[to][1].split(' ')[0]},\n\nSounds good, I'll take a look at item ${i + 1} this afternoon.\n\nCheers,\nSam\n-- \nSam Tester\nExample Co\n\nOn Mon, 2 Nov 2026 at 09:00, ${PEOPLE[to][1]} <${PEOPLE[to][0]}> wrote:\n> Here is item ${i + 1}. Quoted words that are not yours.` })
  }
  message({ id: 130, box: 2, from: 2, to: [5], subject: 'Contract for the pilot', when: now - 2 * 86400, conv: 300, read: 1, body: 'Hi Kim,\n\nAttached is the contract for the pilot. Could you sign it this week?\n\nCheers,\nSam' })
  const made = spawnSync(SQLITE, [INDEX], { input: text, encoding: 'utf8' })
  if (made.status) throw new Error(`the made-up index: ${made.stderr}`)
  seedMeetings(kit)
  return { V, INDEX, sqlite, emlx, who, rfc, LOCAL, now }
}

// Three recorded meetings, written as Bridge AI keeps them: a call, a room with voices told apart
// (voice 1 is you), and a room nobody told apart.
export function seedMeetings(kit) {
  const meeting = (id, { title, daysAgo, lines, voices }) => {
    const d = path.join(kit.data, 'meetings', id)
    fs.mkdirSync(d, { recursive: true })
    const start = new Date(Date.now() - daysAgo * 864e5)
    fs.writeFileSync(path.join(d, 'meeting.json'), JSON.stringify({ id, title, status: 'done', kind: 'general', startedAt: start.toISOString(), endedAt: new Date(+start + 600e3).toISOString(), seconds: 600, call: 'on', event: null }))
    fs.writeFileSync(path.join(d, 'transcript.jsonl'), lines.map(([src, t0, t1, said]) => JSON.stringify({ src, t0, t1, text: said, engine: 'test' })).join('\n') + '\n')
    if (voices) fs.writeFileSync(path.join(d, 'voices.json'), JSON.stringify(voices))
  }
  meeting('mt-call', { title: 'Pilot review', daysAgo: 5, lines: [
    ['you', 0, 5, 'I think we should ship the pilot on Monday and tell the team today.'],
    ['them', 6, 10, 'The budget is not approved yet so please wait for finance first.'],
    ['you', 11, 13, 'Fine by me.'],
  ] })
  meeting('mt-room', { title: 'Design chat', daysAgo: 8, lines: [
    ['you', 0, 5, 'Let us keep the review short and pick one option today please.'],
    ['you', 10, 15, 'I would rather wait until next quarter for this whole thing.'],
  ], voices: { src: 'you', speakers: 2, line: { 'you:0': 1, 'you:10': 2 }, names: { 1: { me: true }, 2: { name: 'Mia Chen' } } } })
  meeting('mt-untold', { title: 'Hallway chat', daysAgo: 9, lines: [['you', 0, 5, 'Nobody can tell who said this line in the room at all.']] })
}

// A stand-in for Bridge AI's calendar helper (native/bridgecal) in a kit's bin folder, answering
// from bridgecal.json beside it ({ status, events }); denied until a test says otherwise.
export function calendarStandIn(bin) {
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

// A stand-in for macOS's open in a kit's bin folder, and Mail and Calendar in the kit's own
// Applications folder (BRIDGE_APPLICATIONS), for Open in Mail and Open in Calendar
// (server/openin.js): what it was asked to open, a line each in open.log; failing as macOS does,
// its words on stderr, while fail(words) holds. The computer's own Mail and Calendar never open.
export function openStandIn(kit, apps = ['Mail', 'Calendar']) {
  const log = path.join(kit.home, 'open.log')
  const fails = path.join(kit.home, 'open-fails.txt')
  kit.program('open', `const fs = require('node:fs')
if (fs.existsSync(${JSON.stringify(fails)})) { process.stderr.write(fs.readFileSync(${JSON.stringify(fails)}, 'utf8')); process.exit(1) }
fs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n')`)
  const at = Object.fromEntries(apps.map((a) => [a, path.join(kit.dir, 'Applications', `${a}.app`)]))
  for (const p of Object.values(at)) fs.mkdirSync(path.join(p, 'Contents'), { recursive: true })
  return {
    apps: at,
    opened: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
    fail: (said) => (said ? fs.writeFileSync(fails, said) : fs.rmSync(fails, { force: true })),
  }
}
