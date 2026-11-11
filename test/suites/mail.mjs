// The inbox, from Apple Mail's own index (server/mail.js), on two Macs whose Mail keeps it
// differently: one with every column this macOS has (Apple Intelligence's summaries, each message's
// Message-ID), and one without them, as on another version of macOS. Both list the inbox, rank it
// and open a message; neither says "no such column". The index is made up, in the server's own
// home folder (Library/Mail), with sqlite3, as Mail would have it. Open in Mail on both: the
// message itself in Mail by its Message-ID (the index's, or on the older Mac the one in its file),
// through a stand-in for macOS's open and a Mail in the kit's own Applications folder; refused,
// saying why and opening nothing, from a phone or another computer, for a message with no
// Message-ID, with no Mail on the Mac, and for one Mail has deleted since, and what macOS said when
// open fails. Mail is Mac only, so elsewhere this checks the inbox says so, and that there's nothing
// to open in.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { startKit, checks, until } from '../lib/harness.mjs'
import { openStandIn } from '../stand-ins/mailbox.mjs'

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
    // What Open in Mail opens, stood in for; and asked as from a phone or another computer (through
    // the relay, x-bridge-relay).
    const opener = openStandIn(k, ['Mail'])
    const far = (p, method = 'GET') => fetch(`${k.url}/api${p}`, { method, headers: { 'content-type': 'application/json', 'x-bridge-relay': 'far' }, body: method === 'POST' ? '{}' : undefined }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
    const refused = (p) => k.api(p, {}).then((r) => ({ ok: false, r }), (e) => ({ error: e.message }))
    if (process.platform !== 'darwin') {
      const r = await k.api('/mail')
      ok(r.available === false && r.reason === 'notMac', 'not a Mac: the inbox says it reads Apple Mail on macOS', r)
      ok(JSON.stringify(await k.api('/open-in')) === '{}' && /macOS/.test((await refused('/mail/1/open')).error || '') && !opener.opened().length, 'not a Mac: no Mail to open in, and nothing opens', opener.opened())
      break
    }
    const dir = path.join(k.home, 'Library', 'Mail', 'V10', 'MailData')
    fs.mkdirSync(dir, { recursive: true })
    const made = spawnSync('sqlite3', [path.join(dir, 'Envelope Index')], { input: index(newer), encoding: 'utf8' })
    ok(made.status === 0, `${which}: the made-up index is there`, made.stderr)
    // The older Mac's index keeps no Message-ID: the message's own file has it (Open in Mail).
    const mid = newer ? 'a1@example.com' : 'old1@example.com'
    if (!newer) {
      const raw = ['From: Dana Lee <dana@example.com>', 'To: Me <me@example.com>', 'Subject: Can you review the launch plan by today?', `Message-ID: <${mid}>`, '', 'Hi, can you?', ''].join('\r\n')
      const d = path.join(k.home, 'Library', 'Mail', 'V10', 'ABC', 'Inbox.mbox', '0A1B2C3D-0000-4000-8000-00000000AB12', 'Data', 'Messages')
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, '1.emlx'), `${Buffer.byteLength(raw)}\n${raw}<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict/></plist>\n`)
    }
    const r = await k.api('/mail?refresh=1').catch((e) => ({ error: e.message }))
    ok(!r.error && r.available !== false, `${which}: the inbox reads, with no error`, r.error || r.reason)
    const subjects = (r.messages || []).map((m) => m.subject)
    ok(subjects.includes('Can you review the launch plan by today?') && subjects.length === 2, `${which}: and lists the messages`, subjects)
    const opened = await k.api('/mail/message/1').catch((e) => ({ error: e.message }))
    ok(!opened.error && opened.id === 1, `${which}: a message opens`, opened.error)

    // ---------- Mail busy with its index ----------
    // Mail keeps its index with a write-ahead log, and as Mail opens or quits it (quitting folds the
    // log into the index and takes it away) it's locked for a moment: a read just then failed with
    // "database is locked". Reads wait for Mail now; held for longer than that, the inbox says Mail
    // is busy.
    if (newer) {
      const INDEX = path.join(dir, 'Envelope Index')
      spawnSync('sqlite3', [INDEX, 'PRAGMA journal_mode=WAL'])
      let writing = true
      // Mail opening, writing and quitting, over and over: each sqlite3 is one of those.
      const mail = (async () => { while (writing) await new Promise((res) => spawn('sqlite3', [INDEX, 'UPDATE messages SET read = read WHERE ROWID = 2']).on('close', res)) })()
      const failed = []
      for (let i = 0; i < 30; i++) {
        const r = await k.api(i % 3 ? '/mail?refresh=1' : `/mail/message/${1 + (i % 2)}`).catch((e) => ({ error: e.message }))
        if (r.error || r.available === false) failed.push(r.error || r.reason)
      }
      writing = false
      await mail
      ok(!failed.length, `${which}: read 30 times while Mail opens, writes and quits its index, each waits for it rather than failing`, failed)
      // Held by Mail for longer than a read waits (an exclusive lock, kept until it's let go).
      const hold = spawn('sqlite3', [INDEX], { stdio: ['pipe', 'pipe', 'ignore'] })
      let held = ''
      hold.stdout.on('data', (d) => { held += d })
      hold.stdin.write("PRAGMA locking_mode=EXCLUSIVE; UPDATE messages SET read = read WHERE ROWID = 2; SELECT 'held';\n")
      await until(() => /held/.test(held), 5000, 20)
      const busy = await k.api('/mail?refresh=1').catch((e) => ({ error: e.message }))
      hold.stdin.end()
      await new Promise((res) => hold.on('close', res))
      ok(/^Mail is busy updating its index/.test(busy.error || ''), `${which}: Mail holding its index longer than that: the inbox says Mail is busy, not "database is locked"`, busy.error || busy)
      const back = await k.api('/mail?refresh=1').catch((e) => ({ error: e.message }))
      ok(!back.error && back.messages?.length === 2, `${which}: and reads again once Mail lets go`, back.error)
    }

    // ---------- Open in Mail ----------
    ok((await k.api('/mail/message/1')).mid === mid, `${which}: an opened message says the Message-ID Mail finds it by (${newer ? "the index's" : 'from its file'})`, (await k.api('/mail/message/1')).mid)
    ok(JSON.stringify(await k.api('/open-in')) === '{"mail":{"name":"Mail"}}', `${which}: Mail is on this Mac (Calendar isn't, here)`, await k.api('/open-in'))
    const fromFar = await far('/mail/1/open', 'POST')
    ok(JSON.stringify(await far('/open-in')) === '{"status":200}' && fromFar.status >= 400 && /on your computer/.test(fromFar.error || '') && !opener.opened().length, `${which}: from a phone or another computer, no Mail to open in, and asked anyway, refused and nothing opens`, fromFar)
    const r1 = await k.api('/mail/1/open', {}).catch((e) => ({ error: e.message }))
    ok(r1.ok && r1.app === 'Mail' && JSON.stringify(opener.opened()) === JSON.stringify([`-a ${opener.apps.Mail} message://${encodeURIComponent(`<${mid}>`)}`]), `${which}: Open in Mail opens Mail itself at the message, by its Message-ID`, { r1, opened: opener.opened() })
    const none = await refused('/mail/2/open')
    ok(/no Message-ID for Mail to find it by/.test(none.error || '') && opener.opened().length === 1, `${which}: a message with no Message-ID: refused, saying why`, none)
    opener.fail('LSOpenURLsWithRole() failed with error -10814 for the URL message://x.')
    const failed = await refused('/mail/1/open')
    ok(/^macOS said: LSOpenURLsWithRole\(\) failed with error -10814/.test(failed.error || ''), `${which}: open failing says what macOS said`, failed)
    opener.fail(null)
    fs.rmSync(opener.apps.Mail, { recursive: true })
    const noMail = await refused('/mail/1/open')
    ok(JSON.stringify(await k.api('/open-in')) === '{}' && /Mail isn't on this Mac/.test(noMail.error || '') && opener.opened().length === 1, `${which}: no Mail on the Mac: nothing to open in, and asked anyway, it says so`, noMail)
    fs.mkdirSync(opener.apps.Mail)
    spawnSync('sqlite3', [path.join(dir, 'Envelope Index'), 'UPDATE messages SET deleted = 1 WHERE ROWID = 1'])
    const gone = await refused('/mail/1/open')
    ok(/Mail doesn't have it any more/.test(gone.error || '') && opener.opened().length === 1, `${which}: one Mail has deleted since: refused, saying so`, gone)
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
}
process.exit(done().fail ? 1 : 0)
