// The inbox, from Apple Mail's own index (server/mail.js), on two Macs whose Mail keeps it
// differently: one with every column this macOS has (Apple Intelligence's summaries, each message's
// Message-ID), and one without them, as on another version of macOS. Both list the inbox, rank it
// and open a message; neither says "no such column". The index is made up, in the server's own
// home folder (Library/Mail), with sqlite3, as Mail would have it. Mail is Mac only, so elsewhere
// this checks the inbox says so.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, checks } from '../lib/harness.mjs'

const { ok, done } = checks('mail')
const now = Math.floor(Date.now() / 1000)
// An index: newer (every column) or older (none of the ones that come and go).
const index = (newer) => `
CREATE TABLE mailboxes (ROWID INTEGER PRIMARY KEY, url TEXT);
CREATE TABLE addresses (ROWID INTEGER PRIMARY KEY, address TEXT, comment TEXT);
CREATE TABLE subjects (ROWID INTEGER PRIMARY KEY, subject TEXT);
CREATE TABLE recipients (ROWID INTEGER PRIMARY KEY, message INTEGER, address INTEGER, type INTEGER);
CREATE TABLE attachments (ROWID INTEGER PRIMARY KEY, message INTEGER, attachment_id TEXT, name TEXT);
CREATE TABLE messages (ROWID INTEGER PRIMARY KEY, read INTEGER, flagged INTEGER, deleted INTEGER, date_received INTEGER, date_sent INTEGER,
  mailbox INTEGER, sender INTEGER, subject INTEGER, global_message_id INTEGER${newer ? ', summary INTEGER, conversation_id INTEGER, automated_conversation INTEGER' : ''});
CREATE TABLE message_global_data (ROWID INTEGER PRIMARY KEY, model_category INTEGER${newer ? ', model_high_impact INTEGER, message_id_header TEXT, generated_summary INTEGER' : ''});
${newer ? 'CREATE TABLE summaries (ROWID INTEGER PRIMARY KEY, summary TEXT); CREATE TABLE generated_summaries (ROWID INTEGER PRIMARY KEY, summary BLOB);' : ''}
INSERT INTO mailboxes VALUES (1, 'ews://ABC/Inbox'), (2, 'ews://ABC/Sent Items');
INSERT INTO addresses VALUES (1, 'dana@example.com', 'Dana Lee'), (2, 'me@example.com', 'Me'), (3, 'news@example.com', 'Shop');
INSERT INTO subjects VALUES (1, 'Can you review the launch plan by today?'), (2, 'This week''s deals');
INSERT INTO recipients VALUES (1, 1, 2, 0), (2, 2, 2, 0);
INSERT INTO message_global_data (ROWID, model_category) VALUES (1, 0), (2, 3);
INSERT INTO messages (ROWID, read, flagged, deleted, date_received, date_sent, mailbox, sender, subject, global_message_id) VALUES
  (1, 0, 0, 0, ${now - 3600}, ${now - 3700}, 1, 1, 1, 1),
  (2, 0, 0, 0, ${now - 7200}, ${now - 7300}, 1, 3, 2, 2);
${newer ? `UPDATE message_global_data SET message_id_header = '<a1@example.com>' WHERE ROWID = 1;
INSERT INTO summaries VALUES (1, 'Dana asks for a review of the launch plan before the end of the day.');
UPDATE messages SET summary = 1, conversation_id = 11 WHERE ROWID = 1;` : ''}
`

const kits = []
try {
  for (const newer of [true, false]) {
    const which = newer ? 'every column' : 'an older macOS'
    const k = await startKit(`mail-${newer ? 'new' : 'old'}`)
    kits.push(k)
    if (process.platform !== 'darwin') {
      const r = await k.api('/mail')
      ok(r.available === false && r.reason === 'notMac', 'not a Mac: the inbox says it reads Apple Mail on macOS', r)
      break
    }
    const dir = path.join(k.home, 'Library', 'Mail', 'V10', 'MailData')
    fs.mkdirSync(dir, { recursive: true })
    const made = spawnSync('sqlite3', [path.join(dir, 'Envelope Index')], { input: index(newer), encoding: 'utf8' })
    ok(made.status === 0, `${which}: the made-up index is there`, made.stderr)
    const r = await k.api('/mail?refresh=1').catch((e) => ({ error: e.message }))
    ok(!r.error && r.available !== false, `${which}: the inbox reads, with no error`, r.error || r.reason)
    const subjects = (r.messages || []).map((m) => m.subject)
    ok(subjects.includes('Can you review the launch plan by today?') && subjects.length === 2, `${which}: and lists the messages`, subjects)
    const opened = await k.api('/mail/message/1').catch((e) => ({ error: e.message }))
    ok(!opened.error && opened.id === 1, `${which}: a message opens`, opened.error)
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
}
process.exit(done().fail ? 1 : 0)
