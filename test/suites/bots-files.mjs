// Files a bot makes (server/botfiles.js), with the stand-in Slack, Discord, Teams and Claude Code
// (stand-ins/slack.mjs, discord.mjs, teams.mjs, helper-claude.cjs), in the browser named by BRIDGE_TEST_BROWSER:
//   each run gets an outbox of its own, and its agent a save_file tool that writes only there (an MCP
//   server of Bridge AI's own, outboxmcp.js, which the stand-in starts and calls as Claude Code
//   would); it's given no tool that writes files, so its folders stay read-only;
//   a file it makes there goes with its answer: Slack's upload API (files.getUploadURLExternal and
//   completeUploadExternal, in the question's thread), Discord's attachments (multipart, after its
//   words), and in Microsoft Teams, which takes none from a bot, the reply says so and who has it;
//   kept beside its record, listed in its Activity;
//   only pictures, PDFs, tables, text and documents go: a program, a script, a Terminal file, a disk
//   image (by its kind, or a script's first bytes in a .txt), refused, not sent, and said in the reply
//   and the record; a name with characters that hide what it is (a right-to-left mark) has them taken
//   out; kept files are marked as from elsewhere on a Mac (com.apple.quarantine);
//   an upload Slack turns away is said in the thread and in the record, not dropped;
//   save_file takes five files a run at most, and says so for one more;
//   for a public channel, an answer with files waits for you even where it may go without asking,
//   whichever way it made them (its outbox, or a FILE: block); a page, a drawing or XML anywhere;
//   a run picked up after its time limit (Continue, in a copy of its conversation) has its save_file
//   tool still, and what it saved before it was stopped goes with the answer, counted in its five;
//   a page it makes after Continue waits for you as any does;
//   its Activity lists the files it made with Open and Send to… (Send to… across two computers is
//   in backup-move); one that could run something as it opens (a drawing, a page) is shown in
//   Finder instead; nothing writes through a bot's files (Studio's routes, a copy into them).
// And a file already in its folders, sent as it is (server/botattach.js), PDFs and documents too:
//   its brief says it can (attach_file; a model's ATTACH: line too), not "text files only", and what
//   it can send holds whatever its memory says; its agent gets attach_file (the folders it may
//   attach from in a file of the run's, readable by you only);
//   two resume PDFs in a folder it reads, attached and held with the answer until you send it, then
//   in Slack, the same bytes; each kept, and the record saying where it came from;
//   refused, with why in the reply in one line: a file outside its folders, through a link (to a
//   file or a folder), hidden or in a hidden folder, whose name says it holds credentials, with a
//   private key in it, over 25 MB, or of a kind that doesn't go;
//   a model answering (the stand-in, with Bridge AI's tools): attach_file, and ATTACH: lines checked
//   the same way, one outside its folders refused; held in Needs You on a phone, with the files as
//   any are; Try It on a phone shows an attached PDF as a made one;
//   Discord: one over the 10 MB it takes from a bot stays here, said in the reply; Teams, which takes
//   none, says so; its Activity's timeline: what it attached, from where.
// And what keeps files from its folders in: by default an answer with one waits for you even
// answering without asking, and where you let it go it goes only in a direct message with someone
// you named, or a private channel everyone in which may ask it (not with a guest in it, nor once it's
// shared with another organization); what you review says where each file is from (Needs You on a
// phone with Open, the Slack direct message); keys, passwords and tokens found in what it would send
// (lower case, base64 at any offset, UTF-16 either way, inside a PDF's compressed streams or past
// 4 MB, inside Word and Excel files, config files when let through) and in its words; Claude Code's
// Read rules from the same list of secret names; a folder that leads somewhere else than when it was
// picked (or, kept before that, than its name says) isn't read until you say Keep reading it, one
// made again where it was is, and a run says which folders it didn't read.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { checks, until, browser, page, shot, startDiscord, startTeams, startModel, phoneFaults, IS_WIN, IS_MAC, TEST } from '../lib/harness.mjs'
import { botKit, openSettings, M, OWNER } from '../lib/bots.mjs'

const { ok, skip, done } = checks('bots-files')
const dc = await startDiscord('bots-files')
await dc.heartbeat({ ms: 800 })
const tm = await startTeams('bots-files')
const model = await startModel('bots-files')
const T1 = 'dtest.bot-one.0123456789abcdef'
// (A "minute" is 3 seconds and the wait at a time limit 4, for a run picked up after its time limit.)
const { slack, kit, needs, draftOf, startOf, startsOf, briefOf, botOf, connected, events, posted, postedLike } = await botKit('bots-files', {
  folders: ['notes'], env: { BRIDGE_DISCORD_URL: dc.url, BRIDGE_TEAMS_URL: tm.url, BRIDGE_TEAMS_PORT: '0', BRIDGE_BOT_HOLD_MS: '60000', BRIDGE_BOT_MINUTE_MS: '3000', BRIDGE_BOT_GRACE_MS: '4000' },
})
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const month = () => new Date().toISOString().slice(0, 7)
const send = (d) => kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true })
const madeOf = (q) => events().find((e) => e.type === 'files.made' && e.q === q) || null
const SECRET = path.join(kit.home, 'notes', 'secret.md')
fs.writeFileSync(SECRET, '# Secret\n\nThe launch is on the ninth.\n')
// Files in its folder to attach as they are (two resume books, a plan), and ones that never go:
// outside its folder, through a link to a file or a folder, hidden, named as credentials, with a
// private key in them, over 25 MB (a sparse file), of a kind that doesn't go.
const NOTES = path.join(kit.home, 'notes')
const HIRING = path.join(NOTES, 'hiring')
const ELSEWHERE = path.join(kit.home, 'elsewhere')
const pdf = (kb, seed) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${seed}\n`), crypto.createHash('sha512').update(seed).digest(), Buffer.alloc(kb * 1024, seed.charCodeAt(0)), Buffer.from('\n%%EOF\n')])
const CMU = pdf(300, 'cmu')
const UCB = pdf(200, 'ucb')
const PLAN = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(4096, 7)])
const ATTACHABLE = { 'CMU_All_Resumes.pdf': CMU, 'UCB_All_Resumes.pdf': UCB, 'plan.docx': PLAN }
fs.mkdirSync(HIRING, { recursive: true })
for (const [n, body] of Object.entries(ATTACHABLE)) fs.writeFileSync(path.join(HIRING, n), body)
fs.writeFileSync(path.join(HIRING, 'deck.pdf'), pdf(12 * 1024, 'deck')) // (over Discord's 10 MB)
fs.mkdirSync(ELSEWHERE, { recursive: true })
fs.writeFileSync(path.join(ELSEWHERE, 'outside.pdf'), pdf(4, 'outside'))
fs.mkdirSync(path.join(NOTES, '.private'), { recursive: true })
fs.writeFileSync(path.join(NOTES, '.private', 'notes.pdf'), pdf(4, 'private'))
fs.writeFileSync(path.join(NOTES, '.hidden.pdf'), pdf(4, 'hidden'))
fs.writeFileSync(path.join(NOTES, 'credentials.json'), '{"user":"dana","password":"hunter2"}\n')
fs.writeFileSync(path.join(NOTES, 'server-key.txt'), '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n') // private-ok: a made-up key's first lines, which a bot must refuse to send
fs.writeFileSync(path.join(NOTES, 'tools.zip'), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64, 1)]))
{ const fd = fs.openSync(path.join(NOTES, 'big.pdf'), 'w'); fs.writeSync(fd, '%PDF-1.4\n'); fs.ftruncateSync(fd, 26 * 1024 * 1024); fs.closeSync(fd) }
// What holds keys, passwords or tokens without saying so in its name, or by a name that does: a
// kubeconfig (its key in base64), a config file (a kind sent only when you let it), a key in UTF-16,
// a PEM pasted into a PDF, tokens in notes, a logins export, a table with a password column,
// recovery codes. (All made up.)
const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n' // private-ok: made up, refused by the tests
const B64KEY = Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n').toString('base64') // private-ok: made up, refused by the tests
fs.writeFileSync(path.join(NOTES, 'kubeconfig.yaml'), `users:\n- user:\n    client-key-data: ${B64KEY}\n`)
fs.writeFileSync(path.join(NOTES, 'cluster.yaml'), `users:\n- user:\n    client-key-data: ${B64KEY}\n`)
fs.writeFileSync(path.join(NOTES, 'deploy.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(PEM, 'utf16le')]))
fs.writeFileSync(path.join(NOTES, 'scan.pdf'), `%PDF-1.4\n${PEM}%%EOF\n`)
fs.writeFileSync(path.join(NOTES, 'prod-notes.md'), '# Prod\n\nAWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP\nslack: xoxb-1234567890-abcdefghijkl\n') // private-ok: made-up tokens, refused by the tests
fs.writeFileSync(path.join(NOTES, 'logins.csv'), 'url,username,password\nhttps://bank.example,me,hunter2\n')
fs.writeFileSync(path.join(NOTES, 'accounts.csv'), 'url,username,password\nhttps://bank.example,me,hunter2\n')
fs.writeFileSync(path.join(NOTES, 'github-recovery-codes.txt'), 'a1b2c-d3e4f\n')
fs.writeFileSync(path.join(NOTES, 'settings.json'), '{"theme": "dark"}\n')
fs.writeFileSync(path.join(NOTES, '.env'), 'API_TOKEN=abcdef123456\n')
fs.mkdirSync(path.join(NOTES, '.git'), { recursive: true })
fs.writeFileSync(path.join(NOTES, '.git', 'config'), '[remote] needle-in-dot-folder\n')
// And what's harder to see: a password in lower case, an AWS credentials file, Stripe's, Google's,
// Hugging Face's, npm's and SendGrid's keys, a key in base64 a byte or two in, UTF-16 with no byte
// order mark, a key in a PDF's compressed stream or more than 4 MB into one, in a Word document's
// words, a spreadsheet with a password column; config files with a password (when they may go).
const zipOf = (parts) => {
  const local = []
  const central = []
  let off = 0
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text)
    const data = zlib.deflateRawSync(raw)
    const n = Buffer.from(name)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
    local.push(lh, n, data)
    central.push(ch, n)
    off += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...local, cd, end])
}
const flatePdf = (text) => { const s = zlib.deflateSync(Buffer.from(`BT /F1 12 Tf (${text.replace(/\n/g, ') Tj T* (')}) Tj ET`)); return Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj << /Length ${s.length} /Filter /FlateDecode >> stream\n`), s, Buffer.from('\nendstream endobj\n%%EOF\n')]) }
// (Made-up tokens in the shapes those services use, put together here so no whole one is in this file.)
const fake = (prefix, n) => `${prefix}${'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'.repeat(2).slice(0, n)}`
const HARD = {
  'wifi.txt': 'Home wifi\nnetwork: Home5G\npassword: Hunter2Hunter2!\n',
  'aws-notes.txt': `[default]\naws_secret_access_key = ${['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/')}\n`,
  'stripe.md': `Live key: ${fake(['sk', 'live', ''].join('_'), 24)}\n`,
  'db.md': 'db_password=s3cr3tPassw0rd\n',
  'more-tokens.txt': `${fake(['GOCSPX', ''].join('-'), 28)}\n${fake(['hf', ''].join('_'), 30)}\n`,
  'npm-sg.txt': `${fake(['npm', ''].join('_'), 36)}\n${fake('SG.', 20)}.${fake('', 30)}\n`,
  'b64-one.txt': Buffer.from(`x${PEM}`).toString('base64'),
  'b64-two.txt': Buffer.from(`xy${PEM}`).toString('base64'),
  'utf16be.txt': Buffer.from(PEM, 'utf16le').swap16(),
  'packed.pdf': flatePdf(PEM),
  'late.pdf': Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024, 0x20), Buffer.from(PEM), Buffer.from('%%EOF\n')]),
  'memo.docx': zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${PEM}</w:t></w:r></w:p></w:body></w:document>` }),
  'sites.xlsx': zipOf({ '[Content_Types].xml': '<Types/>', 'xl/sharedStrings.xml': '<sst><si><t>Site</t></si><si><t>Password</t></si><si><t>bank.example</t></si><si><t>Hunter2Hunter2!</t></si></sst>' }),
  'appsettings.json': '{"ConnectionStrings":{"Main":"Server=db;User Id=sa;Password=Pr0dPassw0rd;"}}\n',
  'database.yaml': 'database:\n  password: Pr0dPassw0rd\n',
  // (And what's fine: a plan in Word, a sheet of figures, a document about keys that holds none.)
  'roadmap.docx': zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Q3: ship the bot. The password field is required.</w:t></w:r></w:p></w:body></w:document>' }),
  'figures.xlsx': zipOf({ '[Content_Types].xml': '<Types/>', 'xl/sharedStrings.xml': '<sst><si><t>Region</t></si><si><t>Total</t></si></sst>' }),
  'keys-howto.md': '# Keys\n\nSet OPENAI_API_KEY=<your key> in your shell. The password: required. sk-learn is a library.\n',
}
fs.mkdirSync(path.join(NOTES, 'hard'), { recursive: true })
for (const [n, body] of Object.entries(HARD)) fs.writeFileSync(path.join(NOTES, 'hard', n), body)
fs.writeFileSync(path.join(NOTES, 'token.json'), '{"t": 1}\n')
// A vault of notes (Obsidian's, say) is notes; a password manager's vault or export isn't.
fs.mkdirSync(path.join(NOTES, 'Work Vault'), { recursive: true })
fs.writeFileSync(path.join(NOTES, 'Work Vault', 'notes.md'), '# Notes\n\nThe offsite is in March.\n')
fs.writeFileSync(path.join(NOTES, 'vault.json'), '{"items": []}\n')
fs.writeFileSync(path.join(NOTES, 'bitwarden-export.json'), '{"items": []}\n')
// A folder it reads that's swapped for a link once it's picked (to your home folder, or elsewhere).
const TEAM = path.join(kit.home, 'team')
fs.mkdirSync(TEAM, { recursive: true })
fs.writeFileSync(path.join(TEAM, 'plan.pdf'), pdf(2, 'team'))
fs.mkdirSync(path.join(kit.home, 'Private'), { recursive: true })
fs.writeFileSync(path.join(kit.home, 'Private', 'tax-return.pdf'), pdf(2, 'tax'))
// And a folder where apps keep their settings and keys, which a bot doesn't read from.
fs.mkdirSync(path.join(kit.home, '.config', 'gh'), { recursive: true })
fs.writeFileSync(path.join(kit.home, '.config', 'gh', 'hosts.pdf'), pdf(2, 'gh'))
// (Links: not on Windows, where making one needs more than a test has.)
let links = false
try { fs.symlinkSync(path.join(ELSEWHERE, 'outside.pdf'), path.join(NOTES, 'linked.pdf')); fs.symlinkSync(ELSEWHERE, path.join(NOTES, 'via'), 'dir'); links = true } catch { /* none */ }
const ORIGINALS = () => Object.entries(ATTACHABLE).every(([n, body]) => sha(fs.readFileSync(path.join(HIRING, n))) === sha(body))
// Open, in tests: macOS's open and Linux's xdg-open stood in for (opened.log beside them).
kit.program('open', fs.readFileSync(path.join(TEST, 'stand-ins', 'open.cjs'), 'utf8'))
kit.program('xdg-open', fs.readFileSync(path.join(TEST, 'stand-ins', 'open.cjs'), 'utf8'))

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  await kit.api('/bots', { name: 'Reports' })
  await kit.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots/b1/settings', { answerIn: 'thread', askers: [{ id: 'U0DANA', name: 'Dana' }, { id: 'discord:2001', name: 'Dana' }], readsFrom: ['~/notes'], limits: { day: 500 } })
  ok(!!(await connected()), 'a bot, connected to Slack')

  // ---------- A file it makes, to Slack ----------
  let q1 = null
  await part('to Slack', async () => {
    q1 = await slack.ask({ user: 'U0DANA', text: `${M} Totals by region, as a CSV please [make totals.csv Region,Total] [answer Here are the totals.]` })
    const s = await startOf('Totals by region')
    const brief = briefOf(s)
    const args = s?.args.join(' ') || ''
    const cfg = s?.args[s.args.indexOf('--mcp-config') + 1]
    let server = null
    try { server = JSON.parse(fs.readFileSync(cfg, 'utf8')).mcpServers?.bridge_outbox } catch { /* gone already */ }
    const box = server?.args?.[1] || ''
    ok(/To send back a file you make \(a chart, a spreadsheet, a PDF, a picture\), save it with your save_file tool\. It's the one way you can make a file\./.test(brief) && /What goes with an answer: 5 files at most, none over 25\.0 MB, and only pictures, PDFs, tables, text and documents/.test(brief) && !brief.includes(path.join('front-desk', 'outbox')), 'its brief offers save_file, and says what may go', brief.slice(-1400))
    ok(args.includes('--tools Read,Grep,Glob ') && s.args.includes('--strict-mcp-config') && s.args.includes('mcp__bridge_outbox__save_file') && args.includes('--permission-mode dontAsk') && !/Write|Edit|Bash|acceptEdits|bypassPermissions/.test(args), 'its agent gets save_file and no tool that writes files: Read, Grep and Glob, its outbox\'s MCP server, dontAsk', s?.args)
    ok(!!server && /outboxmcp\.js$/.test(server.args?.[0] || '') && path.resolve(box).startsWith(path.join(kit.data, 'front-desk', 'outbox')) && !s.args.includes(box), 'its outbox\'s server: Bridge AI\'s own, on that run\'s outbox alone (not a folder it may read)', server)
    const d = await draftOf('Totals by region')
    ok(d?.files?.some((f) => f.name === 'totals.csv' && f.size === 13) && /I made totals\.csv\. Here are the totals\./.test(d.draft), 'its draft, with the file it made', d && { draft: d.draft, files: d.files })
    const made = madeOf(d.id)
    const kept = made?.files?.[0]?.kept
    const keptAt = kept ? path.join(kit.data, 'bots', 'b1', 'trace', 'files', ...kept.split('/')) : ''
    ok(kept === `${month()}/${d.id}-1/totals.csv` && fs.readFileSync(keptAt, 'utf8') === 'Region,Total\n', 'kept beside its record, as it was made', made)
    if (IS_MAC) ok(/Bridge AI/.test(spawnSync('xattr', ['-p', 'com.apple.quarantine', keptAt], { encoding: 'utf8' }).stdout || ''), 'marked as from elsewhere, as a download is (com.apple.quarantine)')
    ok(!box || !fs.existsSync(box), 'its outbox gone once its answer was in')
    await send(d)
    const up = await until(async () => (await slack.state()).files.find((f) => f.name === 'totals.csv'), 15000)
    ok(up?.thread === q1.ts && up.content === 'Region,Total\n' && slack.calls().some((c) => c.method === 'files.getUploadURLExternal') && slack.calls().some((c) => c.method === 'files.completeUploadExternal'), 'sent with the answer, in the question\'s thread, through Slack\'s upload API', up)
    const ev = await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id), 8000)
    ok(ev?.ok === true && ev.name === 'totals.csv' && ev.size === 13, 'and in the record', ev)
    const list = (await kit.api('/bots/b1/files')).files
    ok(list.some((f) => f.name === 'totals.csv' && f.path === kept && f.q === d.id), 'its files, listed for its Activity', list)
  })

  // ---------- A file in its folders, attached as it is: two resume PDFs, to Slack ----------
  await part('attached from its folders, to Slack', async () => {
    // (What it remembers says it can't: a note, which what its brief says it can send overrides.)
    await kit.api('/bots/b1/memory', { kind: 'bot', text: 'Reports can\'t attach PDFs in Slack, only text files like csv, html or txt.' }).catch(() => null)
    // (You in Slack, so its drafts come to your direct messages too.)
    await kit.api('/bots/b1/settings', { owner: OWNER })
    const q = await slack.ask({ user: 'U0DANA', text: `${M} The CMU and UCB resume books please [attach ~/notes/hiring/CMU_All_Resumes.pdf] [attach ${path.join(HIRING, 'UCB_All_Resumes.pdf')}] [answer Here are both resume books.]` })
    const s = await startOf('The CMU and UCB resume books')
    const brief = briefOf(s)
    const tail = brief.slice(brief.lastIndexOf('----- end of question -----'))
    ok(!/text files only/.test(brief) && /To send back a file that's in your folders as it is \(a PDF, a Word document, a spreadsheet, a presentation, a picture\), attach it with your attach_file tool and its path\. PDFs and documents go this way as they are\./.test(tail)
      && /What goes with an answer: 5 files at most, none over 25\.0 MB, and only pictures, PDFs, tables, text and documents \(png, jpg, .*pdf.*docx, pptx\); never a hidden file, nor one that holds keys, passwords, tokens or credentials\. From your folders: documents, pictures, tables and text \(pdf, docx, xlsx, pptx, .*md\); not data or config files \(json, yaml, yml, html, xml, mmd\), which Tester hasn't let you send\. That's what you can send, whatever your memory or an earlier answer says\./.test(tail),
    'its brief: not "text files only"; it can attach a file from its folders, PDFs and documents too (not data or config files, unless you let it), with the limits, whatever its memory says (and said after it)', tail)
    ok(/Don't remember what you can or can't do \(send a file, read something\): this brief says that each time\./.test(tail), 'and not to remember what it can or can\'t do')
    ok(!/ATTACH:/.test(brief) && !/FILE:/.test(brief), 'Claude Code, with its tools: no ATTACH: or FILE: lines offered')
    const memo = brief.indexOf('----- end of memory -----')
    ok(memo < 0 || memo < brief.indexOf('attach it with your attach_file tool'), 'what it can send comes after what it remembers', memo)
    ok(s.args.includes('mcp__bridge_outbox__save_file') && s.args.includes('mcp__bridge_outbox__attach_file') && s.args.includes('--strict-mcp-config') && !/Write|Edit|Bash/.test(s.args.join(' ')), 'its agent gets attach_file, and still no tool that writes files', s.args)
    // Claude Code's own Read rules for the run: nothing hidden or named as keys in its folders.
    const settingsFile = s.args.includes('--settings') ? s.args[s.args.indexOf('--settings') + 1] : null
    let deny = []
    try { deny = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).permissions.deny } catch { /* gone already */ }
    const notesRule = `//${fs.realpathSync(NOTES).replace(/\\/g, '/').replace(/^\/+/, '')}`
    ok(!!settingsFile && (!deny.length || (deny.includes(`Read(${notesRule}/**/.*)`) && deny.includes(`Read(${notesRule}/**/.*/**)`) && deny.includes(`Read(${notesRule}/**/[sS][eE][cC][rR][eE][tT])`) && deny.includes(`Read(${notesRule}/**/[tT][oO][kK][eE][nN].*)`))), 'Claude Code is given Read rules for its folder (--settings): no hidden file or folder, nothing named as a secret', { settingsFile, deny: deny.slice(0, 4) })
    const cfg = s.args[s.args.indexOf('--mcp-config') + 1]
    let server = null
    try { server = JSON.parse(fs.readFileSync(cfg, 'utf8')).mcpServers?.bridge_outbox } catch { /* gone already */ }
    const d = await draftOf('The CMU and UCB resume books')
    ok(d?.files?.map((f) => `${f.name}:${f.size}`).sort().join() === `CMU_All_Resumes.pdf:${CMU.length},UCB_All_Resumes.pdf:${UCB.length}` && /I attached CMU_All_Resumes\.pdf\. I attached UCB_All_Resumes\.pdf\. Here are both resume books\./.test(d.draft) && !/Not sent|can't/.test(d.draft), 'its draft, with both PDFs attached', d && { draft: d.draft, files: d.files })
    ok(!server || (server.args.length === 3 && /attach\.json$/.test(server.args[2]) && !s.args.includes(server.args[2])), 'the folders it may attach from: a file of the run\'s, not on its command line', server?.args)
    // Review first: held with the answer, nothing in Slack yet; Needs You and the Slack direct
    // message say where each file is from.
    ok(d?.state === 'draft' && !(await slack.state()).files.some((f) => /Resumes\.pdf$/.test(f.name)), 'held with the answer until you send it')
    ok(d?.files?.every((f) => f.from === `~/notes/hiring/${f.name}`.replace(/\//g, path.sep) && f.kept), 'Needs You is told where each file is from, and has it to open', d?.files)
    const dm = await until(async () => (await slack.state()).posted.filter((p) => p.channel === 'D0OWNER' && JSON.stringify(p.blocks || []).includes('The CMU and UCB resume books')).pop(), 15000)
    const notes = JSON.stringify((dm?.blocks || []).filter((x) => x.type === 'context'))
    ok(notes.includes(`from ${'~/notes/hiring/CMU_All_Resumes.pdf'.replace(/\//g, path.sep).replace(/\\/g, '\\\\')}`) && notes.includes('UCB_All_Resumes.pdf'), 'and so does its draft in your Slack direct messages', notes)
    const made = madeOf(d.id)
    const from = Object.fromEntries((made?.files || []).map((f) => [f.name, f.from]))
    ok(from['CMU_All_Resumes.pdf'] === '~/notes/hiring/CMU_All_Resumes.pdf'.replace(/\//g, path.sep) && from['UCB_All_Resumes.pdf'] === '~/notes/hiring/UCB_All_Resumes.pdf'.replace(/\//g, path.sep) && made.files.every((f) => f.kept), 'its record: each attached file kept, with where it came from', made)
    const kept = made?.files?.find((f) => f.name === 'CMU_All_Resumes.pdf')?.kept
    ok(!!kept && sha(fs.readFileSync(path.join(kit.data, 'bots', 'b1', 'trace', 'files', ...kept.split('/')))) === sha(CMU), 'kept as it is, the same bytes')
    await send(d)
    const up = await until(async () => { const f = (await slack.state()).files; return f.find((x) => x.name === 'CMU_All_Resumes.pdf') && f.find((x) => x.name === 'UCB_All_Resumes.pdf') ? f : null }, 15000)
    const cmu = up?.find((x) => x.name === 'CMU_All_Resumes.pdf')
    const ucb = up?.find((x) => x.name === 'UCB_All_Resumes.pdf')
    ok(cmu?.thread === q.ts && cmu.sha256 === sha(CMU) && cmu.size === CMU.length && ucb?.sha256 === sha(UCB), 'sent once you said so: both PDFs in the question\'s thread, the same bytes', { cmu, ucb })
    ok(ORIGINALS() && fs.existsSync(path.join(HIRING, 'CMU_All_Resumes.pdf')), 'the files in its folder as they were')
    await kit.api('/bots/b1/settings', { owner: null })
  })

  // ---------- Its own Read rules, and what it can't do ----------
  await part('Read rules and save_file names', async () => {
    // A hidden file in its folder: Claude Code's Read rule for the run refuses it (and the stand-in
    // holds to it as Claude Code does); a file named with a dot, or as the note of what it attached,
    // can't be saved; an ATTACH: line from Claude Code, whose brief offers its tool, is only words.
    await slack.ask({ user: 'U0DANA', text: `${M} Hidden things please [try-read ~/notes/.env] [make .attached.json forged] [attach-line ~/notes/hiring/plan.docx] [answer Done.]` })
    const d = await draftOf('Hidden things please')
    ok(/I couldn't read ~\/notes\/\.env: a rule in my settings refused it\./.test(d?.draft || ''), 'a hidden file in its folder: refused by its Read rules', d?.draft)
    ok(/I couldn't save \.attached\.json: A file's name can't start with a dot/.test(d?.draft || '') && !d?.files?.length, 'save_file takes no name that starts with a dot (what it attached is noted beside its outbox, never in it)', d && { draft: d.draft, files: d.files })
    ok(/ATTACH: ~\/notes\/hiring\/plan\.docx/.test(d?.draft || '') && !d?.files?.length, 'an ATTACH: line from Claude Code, which has its tool: left as words, nothing attached', d?.draft)
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
    // attach_file twenty times a run at most.
    await slack.ask({ user: 'U0DANA', text: `${M} Many tries please ${Array.from({ length: 21 }, (_, i) => `[attach ~/notes/none-${i + 1}.pdf]`).join(' ')} [try-read ~/notes/token.json] [answer Done.]` })
    const many = await draftOf('Many tries please', 60000)
    ok(/I couldn't read ~\/notes\/token\.json: a rule in my settings refused it\./.test(many?.draft || ''), 'a file named as a token in its folder: refused by its Read rules, made from the same list attaching uses', many?.draft)
    ok(/I couldn't attach none-21\.pdf: Not attached: you've asked to attach 20 files already, the most a run may/.test(many?.draft || '') && (many?.draft.match(/none-\d+\.pdf \(/g) || []).length === 10, 'attach_file twenty times a run at most; ten refusals said in the reply at most', many?.draft)
    await kit.api(`/bots/questions/${encodeURIComponent(many.id)}`, { send: false })
  })

  // ---------- Refused: what can't be attached, and why, in the reply ----------
  await part('attaching refused', async () => {
    const asks = ['~/elsewhere/outside.pdf', '../elsewhere/outside.pdf', '~/notes/.private/notes.pdf', '~/notes/.hidden.pdf', '~/notes/credentials.json', '~/notes/server-key.txt', '~/notes/big.pdf', '~/notes/tools.zip', ...(links ? ['~/notes/linked.pdf', '~/notes/via/outside.pdf'] : [])]
    await slack.ask({ user: 'U0DANA', text: `${M} Everything private please ${asks.map((a) => `[attach ${a}]`).join(' ')} [answer Done.]` })
    const d = await draftOf('Everything private please', 60000)
    const line = (d?.draft || '').split('\n').find((l) => l.startsWith('Not sent:')) || ''
    const why = {
      outside: /outside\.pdf \(it isn't in the folders the bot reads from\); outside\.pdf \(it isn't in the folders the bot reads from\)/,
      hidden: /notes\.pdf \(it's in a hidden folder\)/,
      hiddenFile: /hidden\.pdf \(it's a hidden file\)/,
      credentials: /credentials\.json \(its name says it holds keys, passwords or credentials\)/,
      key: /server-key\.txt \(it holds what looks like a key, a password or a token\)/,
      big: /big\.pdf \(it's 26\.0 MB, over the 25\.0 MB a bot sends\)/,
      kind: /tools\.zip \(a \.zip file isn't one a bot sends/,
      ...(links ? { link: /linked\.pdf \(it's a link to somewhere else, and only a file itself goes\)/, via: /outside\.pdf \(it's reached through a link to somewhere else\)/ } : {}),
    }
    const missing = Object.entries(why).filter(([, re]) => !re.test(line)).map(([k]) => k)
    ok(d && !d.files?.length && !missing.length && d.draft.split('\n').filter((l) => l.startsWith('Not sent:')).length === 1, `none sent, and the reply says why for each, in one line: outside its folders (and by ../), hidden, in a hidden folder, named as credentials, a private key in it, over 25 MB, a kind that doesn't go${links ? ', through a link to a file or a folder' : ''}`, { missing, draft: d?.draft })
    ok(!/can't (send|attach) PDFs/i.test(d?.draft || '') && /^Done\./.test(d?.draft || ''), 'and it doesn\'t claim it can\'t send PDFs', d?.draft)
    const made = madeOf(d.id)
    ok((made?.refused || []).some((r) => r.name === 'big.pdf' && r.from === '~/notes/big.pdf'), 'each refused in the record, with where it was asked from', made?.refused)
    if (!links) skip('a link to a file or a folder', 'links can\'t be made here')
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })

    // What holds a key, a password or a token, by what's in it or its name; a data or config file,
    // which goes only when you let it; and a key it read, saved as a file it "made".
    const more = ['~/notes/kubeconfig.yaml', '~/notes/cluster.yaml', '~/notes/deploy.txt', '~/notes/scan.pdf', '~/notes/prod-notes.md', '~/notes/logins.csv', '~/notes/accounts.csv', '~/notes/github-recovery-codes.txt', '~/notes/settings.json']
    await slack.ask({ user: 'U0DANA', text: `${M} Secrets please ${more.map((a) => `[attach ${a}]`).join(' ')} [make leak.txt ${B64KEY}] [answer Done.]` })
    const d2 = await draftOf('Secrets please', 60000)
    const line2 = (d2?.draft || '').split('\n').find((l) => l.startsWith('Not sent:')) || ''
    const looks = 'it holds what looks like a key, a password or a token'
    const config = (x) => new RegExp(`\\(a \\.${x} file is a data or config file, which the bot sends from its folders only when you let it \\(Settings › Bots\\)\\)`)
    const why2 = {
      kubeconfig: /kubeconfig\.yaml \(its name says it holds keys, passwords or credentials\)/,
      config: new RegExp(`cluster\\.yaml ${config('yaml').source}`),
      utf16: new RegExp(`deploy\\.txt \\(${looks}\\)`),
      pdf: new RegExp(`scan\\.pdf \\(${looks}\\)`),
      tokens: new RegExp(`prod-notes\\.md \\(${looks}\\)`),
      logins: /logins\.csv \(its name says it holds keys, passwords or credentials\)/,
      column: /accounts\.csv \(it's a table with a column of passwords\)/,
      codes: /github-recovery-codes\.txt \(its name says it holds keys, passwords or credentials\)/,
      json: new RegExp(`settings\\.json ${config('json').source}`),
      saved: new RegExp(`leak\\.txt \\(${looks}\\)`),
    }
    const missing2 = Object.entries(why2).filter(([, re]) => !re.test(line2)).map(([k]) => k)
    ok(d2 && !d2.files?.length && !missing2.length, 'refused, with why: a kubeconfig, a key in base64 in a config file (and a config file at all, by default), a key in UTF-16, a key pasted into a PDF, tokens in notes, logins, a password column, recovery codes, a JSON file, and a key it read saved as a file it made', { missing: missing2, draft: d2?.draft })
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: false })
    // With data and config files let through: a JSON file with nothing in it goes; the key in base64 still doesn't.
    await kit.api('/bots/b1/settings', { attachConfig: true })
    await slack.ask({ user: 'U0DANA', text: `${M} Config please [attach ~/notes/settings.json] [attach ~/notes/cluster.yaml] [answer Done.]` })
    const d3 = await draftOf('Config please')
    ok(d3?.files?.map((f) => f.name).join() === 'settings.json' && new RegExp(`cluster\\.yaml \\(${looks}\\)`).test(d3.draft), 'with data and config files let through: settings.json goes, a config file with a key in base64 doesn\'t', d3 && { files: d3.files, draft: d3.draft })
    await kit.api(`/bots/questions/${encodeURIComponent(d3.id)}`, { send: false })
    await kit.api('/bots/b1/settings', { attachConfig: false })
  })

  // ---------- What's harder to see: inside PDFs and Office files, in lower case, a byte or two in ----------
  await part('keys and passwords harder to see', async () => {
    const looks = 'it holds what looks like a key, a password or a token'
    const ask = async (words, names) => {
      await slack.ask({ user: 'U0DANA', text: `${M} ${words} ${names.map((n) => `[attach ~/notes/hard/${n}]`).join(' ')} [answer Done.]` })
      const d = await draftOf(words, 60000)
      await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
      return { d, line: (d?.draft || '').split('\n').find((l) => l.startsWith('Not sent:')) || '' }
    }
    const one = ['wifi.txt', 'aws-notes.txt', 'stripe.md', 'db.md', 'more-tokens.txt', 'npm-sg.txt', 'b64-one.txt', 'b64-two.txt', 'utf16be.txt', 'packed.pdf']
    const a = await ask('Hard ones please', one)
    const missed = one.filter((n) => !a.line.includes(`${n} (${looks})`))
    ok(a.d && !a.d.files?.length && !missed.length, 'refused, saying why: a lower-case password, an AWS credentials file, Stripe\'s, Google\'s, Hugging Face\'s, npm\'s and SendGrid\'s keys, a key in base64 a byte or two in, UTF-16 with no byte order mark, a key in a PDF\'s compressed stream', { missed, draft: a.d?.draft })
    const b = await ask('Office ones please', ['late.pdf', 'memo.docx', 'sites.xlsx', 'roadmap.docx', 'figures.xlsx', 'keys-howto.md'])
    ok(b.line.includes(`late.pdf (${looks})`) && b.line.includes(`memo.docx (${looks})`) && b.line.includes('sites.xlsx (it\'s a table with a column of passwords)') && b.d?.files?.map((f) => f.name).sort().join() === 'figures.xlsx,keys-howto.md,roadmap.docx', 'a key more than 4 MB into a PDF, in a Word document\'s words, a spreadsheet with a password column: refused; a plan, a sheet of figures and a how-to about keys go', { files: b.d?.files, line: b.line })
    await kit.api('/bots/b1/settings', { attachConfig: true })
    const c = await ask('Config ones please', ['appsettings.json', 'database.yaml'])
    ok(c.line.includes(`appsettings.json (${looks})`) && c.line.includes(`database.yaml (${looks})`) && !c.d?.files?.length, 'with config files let through: a connection string\'s Password=… and a YAML password: refused', c.line)
    await kit.api('/bots/b1/settings', { attachConfig: false })
  })

  // ---------- A vault of notes is notes ----------
  await part('a vault of notes', async () => {
    await kit.api('/bots/b1/settings', { attachConfig: true })
    await slack.ask({ user: 'U0DANA', text: `${M} Vault please [attach ~/notes/Work Vault/notes.md] [attach ~/notes/vault.json] [attach ~/notes/bitwarden-export.json] [try-read ~/notes/Work Vault/notes.md] [answer Done.]` })
    const d = await draftOf('Vault please')
    const line = (d?.draft || '').split('\n').find((l) => l.startsWith('Not sent:')) || ''
    ok(d?.files?.map((f) => f.name).join() === 'notes.md' && d.files[0].from === '~/notes/Work Vault/notes.md'.replace(/\//g, path.sep), 'a note in a folder called "Work Vault": attached', d?.files)
    ok(line.includes('vault.json (its name says it holds keys, passwords or credentials)') && line.includes('bitwarden-export.json (its name says it holds keys, passwords or credentials)'), 'a vault.json and a Bitwarden export: refused, even with data and config files let through', line)
    ok(/It says: # Notes\s+The offsite is in March\./.test(d?.draft || ''), 'and Claude Code\'s Read rules let it read the note', d?.draft)
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
    await slack.ask({ user: 'U0DANA', text: `${M} Vault file please [try-read ~/notes/vault.json] [answer Done.]` })
    const d2 = await draftOf('Vault file please')
    ok(/I couldn't read ~\/notes\/vault\.json: a rule in my settings refused it\./.test(d2?.draft || ''), 'but not a vault.json', d2?.draft)
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: false })
    await kit.api('/bots/b1/settings', { attachConfig: false })
  })

  // ---------- A folder that isn't the one you picked any more, or where settings are kept ----------
  await part('folders swapped or kept out', async () => {
    await kit.api('/bots/b1/settings', { readsFrom: ['~/notes', '~/team'] })
    // A folder where apps keep their settings and keys isn't taken as one it reads.
    const r = await fetch(`${kit.url}/api/bots/b1/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ readsFrom: ['~/notes', '~/team', '~/.config'] }) })
    ok(!r.ok && /Pick another folder: ~\/\.config is a hidden folder, where apps keep their settings and keys/.test((await r.json().catch(() => ({}))).error || ''), 'a hidden folder (~/.config) isn\'t taken as one it reads', r.status)
    if (!links) { skip('a folder swapped for a link', 'links can\'t be made here'); await kit.api('/bots/b1/settings', { readsFrom: ['~/notes'] }); return }
    // ~/team swapped for a link to your home folder, then to another folder: not read, and said.
    fs.renameSync(TEAM, `${TEAM}.was`)
    fs.symlinkSync(kit.home, TEAM, 'dir')
    const v = await until(async () => { const x = await botOf(); return x.folders?.find((f) => f.shown === '~/team' && !f.ok) ? x : null }, 8000)
    ok(/~\/team isn't read: it's your whole home folder now/.test(v?.folders?.find((f) => f.shown === '~/team')?.problem || ''), 'a folder swapped for a link to your home folder: not read, and Settings says why', v?.folders)
    await slack.ask({ user: 'U0DANA', text: `${M} The tax return please [attach ~/team/Private/tax-return.pdf] [answer Done.]` })
    const d = await draftOf('The tax return please')
    ok(d && !d.files?.length && /tax-return\.pdf \(it isn't in the folders the bot reads from\)/.test(d.draft) && !(await slack.state()).files.some((f) => f.name === 'tax-return.pdf'), 'and nothing is attached through it', d?.draft)
    const started = events().find((e) => e.type === 'run.started' && e.q === d.id)
    ok(started?.notRead?.some((x) => x.folder === '~/team' && /whole home folder/.test(x.why)), 'its run goes ahead with the rest, and its record says which folder it didn\'t read, and why', started?.notRead)
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
    // Swapped for a link to another folder: not read until you say so; Keep reading it, and it is.
    fs.rmSync(TEAM)
    fs.symlinkSync(ELSEWHERE, TEAM, 'dir')
    const v2 = await until(async () => { const x = await botOf(); const f = x.folders?.find((y) => y.shown === '~/team'); return f?.confirm && /~\/team now leads to ~\/elsewhere, not ~\/team as when you picked it, so it isn't read until you say: keep reading it\?/.test(f.problem || '') ? x : null }, 8000)
    ok(!!v2, 'swapped for a link to another folder: not read, and Settings asks whether to keep reading it', v2?.folders)
    // In Needs You too, once for the change, on the computer and the phone, with Keep reading it there.
    const mine = async () => ((await kit.api('/needs-you')).folders || []).filter((x) => x.bot?.id === 'b1' && x.folder === '~/team')
    const item = (await until(async () => (await mine()).length ? await mine() : null, 8000) || [])[0]
    const again = await mine()
    ok(item?.leadsTo === '~/elsewhere' && item.was === '~/team' && item.bot.name && again.length === 1 && again[0].id === item.id && again[0].since === item.since, 'and in Needs You: which bot, which folder, where it leads now and did, once for the change', { item, again })
    // Kept only where you were shown it leads: one that's moved again since isn't kept.
    const moved = await fetch(`${kit.url}/api/bots/b1/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keepFolder: '~/team', keepAt: '~/Private' }) })
    ok(!moved.ok && /~\/team leads to ~\/elsewhere now, not ~\/Private: look again before you keep reading it/.test((await moved.json().catch(() => ({}))).error || '') && (await mine()).length === 1, 'Keep reading it for where you were shown it leads only: if it leads somewhere else since, not kept, and said', moved.status)
    {
      const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
      await p.locator('.top-right .needs-chip').click({ timeout: 20000 })
      const card = p.locator('.ny-panel .ny-item.t-folder[data-folder="~/team"]')
      ok(!!(await until(() => card.isVisible(), 15000)) && /stopped reading ~\/team: it leads to ~\/elsewhere now, not ~\/team as when you picked it/.test(await card.innerText()) && await card.locator('button', { hasText: 'Keep reading it' }).count() === 1, 'on the computer: in Needs You, saying where it leads, with Keep reading it', await card.innerText().catch(() => ''))
      ok(errors.length === 0, 'no page errors', errors)
      await ctx.close()
    }
    {
      const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', phone: true })
      await p.locator('.topbar, .tabbar').first().waitFor({ timeout: 20000 })
      await p.locator('.needs-chip').click({ timeout: 15000 })
      const card = p.locator('.ny-item.t-folder[data-folder="~/team"]').first()
      await card.waitFor({ timeout: 15000 })
      ok(/stopped reading ~\/team/.test(await card.innerText()) && /~\/elsewhere/.test(await card.innerText()), 'on a phone: in Needs You, saying where it leads', await card.innerText())
      const faults = await phoneFaults(p, '.ny-item.t-folder')
      ok(!Object.keys(faults).length, 'on a phone: nothing too small to tap, off the screen or cut short', faults)
      await shot(p, `${tag}bots-files-folder-phone`)
      await card.locator('button', { hasText: 'Keep reading it' }).click()
      ok(!!(await until(async () => !(await mine()).length && await card.count() === 0, 10000)), 'Keep reading it from the phone: out of Needs You', await mine())
      ok(errors.length === 0, 'no page errors', errors)
      await ctx.close()
    }
    const v3 = await botOf()
    ok(v3.folders?.find((f) => f.shown === '~/team')?.ok && events().some((e) => e.type === 'settings.changed' && e.setting === 'keep reading ~/team' && e.new === '~/elsewhere'), 'Keep reading it: read again, where it leads now, and said in its record', v3.folders)
    fs.rmSync(TEAM)
    fs.renameSync(`${TEAM}.was`, TEAM)
    // A bot from before folders were kept by where they lead: one that leads where its name says is
    // kept so at once; one that's a link now (to ~/Private) isn't read until you say.
    const botFile = path.join(kit.data, 'bots', 'b1', 'bot.json')
    const unkept = () => { const j = JSON.parse(fs.readFileSync(botFile, 'utf8')); delete j.folderIds; fs.writeFileSync(botFile, JSON.stringify(j, null, 2)) }
    unkept()
    fs.renameSync(TEAM, `${TEAM}.was`)
    fs.symlinkSync(path.join(kit.home, 'Private'), TEAM, 'dir')
    const v4 = await until(async () => { const x = await botOf(); const f = x.folders?.find((y) => y.shown === '~/team'); return f?.confirm ? x : null }, 8000)
    ok(/~\/team leads to ~\/Private, so it isn't read until you say: keep reading it\?/.test(v4?.folders?.find((f) => f.shown === '~/team')?.problem || '') && !JSON.parse(fs.readFileSync(botFile, 'utf8')).folderIds?.['~/team'] && JSON.parse(fs.readFileSync(botFile, 'utf8')).folderIds?.['~/notes'], 'a folder kept before, a link now (to ~/Private): not taken as it is, but asked; one that leads where its name says (~/notes): kept', v4?.folders)
    await slack.ask({ user: 'U0DANA', text: `${M} The other tax return please [attach ~/team/tax-return.pdf] [answer Done.]` })
    const d2 = await draftOf('The other tax return please')
    ok(d2 && !d2.files?.length && /tax-return\.pdf \(it isn't in the folders the bot reads from\)/.test(d2.draft), 'and nothing is attached through it meanwhile', d2?.draft)
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: false })
    // In Needs You as well; Stop reading it there takes that one folder out, and the rest stay.
    const legacy = await until(async () => (await mine()).find((x) => x.leadsTo === '~/Private'), 8000)
    ok(legacy && legacy.was === null, 'in Needs You too, as one that leads where its name doesn\'t say', legacy)
    await kit.api('/bots/b1/settings', { stopFolder: '~/team' })
    const stopped = await botOf()
    const said = events().filter((e) => e.type === 'settings.changed' && e.setting === 'readsFrom').at(-1)
    ok(stopped.settings?.readsFrom?.join() === '~/notes' && !(await mine()).length && /~\/team/.test(JSON.stringify(said?.old)) && !/~\/team/.test(JSON.stringify(said?.new)), 'Stop reading it: that folder out, the rest kept, out of Needs You, and said in its record', { readsFrom: stopped.settings?.readsFrom, said })
    fs.rmSync(TEAM)
    fs.renameSync(`${TEAM}.was`, TEAM)
    await kit.api('/bots/b1/settings', { readsFrom: ['~/notes', '~/team'] })
    // Made again where it was (a sync, a restore: a new folder at the same path): the same folder.
    await until(async () => (await botOf()).folders?.find((f) => f.shown === '~/team')?.ok, 8000)
    fs.renameSync(TEAM, `${TEAM}.old`)
    fs.mkdirSync(TEAM)
    fs.copyFileSync(path.join(`${TEAM}.old`, 'plan.pdf'), path.join(TEAM, 'plan.pdf'))
    ok((await botOf()).folders?.find((f) => f.shown === '~/team')?.ok, 'a folder made again where it was is read as before')
    fs.rmSync(TEAM, { recursive: true })
    fs.renameSync(`${TEAM}.old`, TEAM)
    await kit.api('/bots/b1/settings', { readsFrom: ['~/notes'] })
  })

  // ---------- Refused: what isn't a picture, a PDF, a table, text or a document ----------
  await part('refused', async () => {
    const RLO = '\u202e'
    // (Five a question, the most a run saves.)
    await slack.ask({ user: 'U0DANA', text: `${M} The tools please [make-exe setup.exe] [make-script run.sh] [make-script tool.txt] [make setup.terminal <plist/>] [make notes.txt Fine.] [try-write hack.md] [answer Done.]` })
    await slack.ask({ user: 'U0DANA', text: `${M} More tools please [make tool.py import os] [make game.iso data] [make inv${RLO}dm.txt Fine.] [answer Done.]` })
    const d = await draftOf('The tools please')
    const d2 = await draftOf('More tools please')
    const why = Object.fromEntries([...(madeOf(d.id)?.refused || []), ...(madeOf(d2.id)?.refused || [])].map((r) => [r.name, r.why]))
    ok(d?.files?.map((f) => f.name).join() === 'notes.txt' && d2?.files?.map((f) => f.name).join() === 'invdm.txt', 'only text goes with them, a name\'s right-to-left mark taken out', { one: d?.files, two: d2?.files })
    ok(['setup.exe', 'run.sh', 'setup.terminal', 'tool.py', 'game.iso'].every((n) => /isn't one a bot sends/.test(why[n] || '')) && /program or a script/.test(why['tool.txt'] || ''), 'refused: a program, a script, a Terminal file, Python and a disk image by their kind, and a script\'s first bytes in a .txt', why)
    ok(!fs.existsSync(path.join(kit.home, 'notes', 'hack.md')), 'and nothing written in its folders')
    ok(/Not sent: .*setup\.exe \(a \.exe file isn't one a bot sends/.test(d.draft) && /setup\.terminal/.test(d.draft), 'the reply says what wasn\'t sent, and why', d.draft)
    ok(!JSON.stringify(events().filter((e) => ['files.made', 'file.uploaded'].includes(e.type))).includes(RLO) && !(await kit.api('/bots/b1/files')).files.some((f) => f.name.includes(RLO)), 'no right-to-left mark in a file\'s name, kept or sent')
    await send(d)
    await until(async () => (await slack.state()).files.some((f) => f.name === 'notes.txt'), 15000)
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: false })
    const names = (await slack.state()).files.map((f) => f.name)
    ok(names.includes('notes.txt') && !names.some((n) => /setup\.exe|run\.sh|tool\.txt|terminal|tool\.py|game\.iso/.test(n)), 'Slack got the text file and nothing else', names)
  })

  // ---------- As many as a run sends back ----------
  await part('five at most', async () => {
    await slack.ask({ user: 'U0DANA', text: `${M} Six notes please ${[1, 2, 3, 4, 5, 6].map((n) => `[make n${n}.txt Note ${n}.]`).join(' ')} [answer Done.]` })
    const d = await draftOf('Six notes please')
    ok(d?.files?.length === 5 && !d.files.some((f) => f.name === 'n6.txt') && /I couldn't save n6\.txt: You've saved 5 files already, the most that go with an answer/.test(d.draft), 'save_file takes five files a run, and says so for the sixth', d && { files: d.files.map((f) => f.name), draft: d.draft })
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
  })

  // ---------- An upload Slack turns away ----------
  await part('an upload that fails', async () => {
    await slack.fail({ method: 'files.completeUploadExternal', error: 'file_upload_failed', n: 1 })
    const q = await slack.ask({ user: 'U0DANA', text: `${M} The chart please [make chart.svg <svg/>] [answer Here it is.]` })
    const d = await draftOf('The chart please')
    await send(d)
    const said = await postedLike(/I couldn't attach chart\.svg/, 15000)
    ok(said?.thread_ts === q.ts && /Tester has it in Bridge AI on/.test(said.text), 'said in the thread, with who has it and where', said)
    const ev = await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id && e.ok === false), 8000)
    ok(/file_upload_failed/.test(ev?.error || ''), 'and in the record', ev)
  })

  // ---------- A public channel ----------
  await part('a public channel waits', async () => {
    await kit.api('/bots/b1/settings', { auto: true })
    await slack.ask({ user: 'U0DANA', text: `${M} Public totals [make public.csv a,b] [answer Totals attached.]` })
    const d = await draftOf('Public totals')
    ok(d?.state === 'draft' && /public channel, so it waits for you/.test(d.warn || ''), 'its answer with a file it made waits for you in a public channel, even where it may go without asking', d && { state: d.state, warn: d.warn })
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
    await slack.ask({ user: 'U0DANA', text: `${M} Public chart [chart]`, files: [{ name: 'sales.csv', type: 'text/csv', content: 'month,sales\nJan,10\nFeb,30\n' }] })
    const c = await draftOf('Public chart')
    ok(c?.state === 'draft' && c.files?.some((f) => f.name === 'chart.svg') && /public channel, so it waits for you/.test(c.warn || ''), 'and so does one with a file in a FILE: block', c && { state: c.state, files: c.files, warn: c.warn })
    await kit.api(`/bots/questions/${encodeURIComponent(c.id)}`, { send: false })
    // A page, anywhere (a direct message here): it can run a script where it's opened, so it waits too.
    await slack.ask({ user: 'U0DANA', dm: true, text: 'A page please [make page.html <p>Hello</p>] [answer Here.]' })
    const pg = await draftOf('A page please')
    ok(pg?.state === 'draft' && pg.place?.kind === 'dm' && /page\.html, which can run a script where it's opened, so it waits for you/.test(pg.warn || ''), 'a page, a drawing or XML waits for you even in a direct message', pg && { state: pg.state, place: pg.place?.kind, warn: pg.warn })
    await kit.api(`/bots/questions/${encodeURIComponent(pg.id)}`, { send: false })
    await kit.api('/bots/b1/settings', { auto: false })
  })

  // ---------- Picked up after its time limit ----------
  await part('picked up after its time limit', async () => {
    await kit.api('/bots/b1/settings', { auto: true, limits: { minutes: 1, atLimit: 'ask' } })
    await slack.ask({ user: 'U0DANA', dm: true, text: `Early and late files [make-early early.csv a,1] [work 40] [then 2] [make late.html <p>Late</p>] ${[3, 4, 5, 6].map((n) => `[make m${n}.txt Note ${n}.]`).join(' ')} [answer Both.]` })
    const stopped = await until(async () => (await needs()).find((x) => x.text.includes('Early and late files') && x.limit?.phase === 'stopped'), 40000)
    ok(stopped?.limit.how === 'session' && !madeOf(stopped.id), 'stopped at its time limit with a file saved, nothing sent yet', stopped?.limit)
    await kit.api(`/bots/questions/${encodeURIComponent(stopped.id)}/limit`, { act: 'continue', minutes: 10 })
    const again = await until(() => startsOf('Early and late files')[1], 20000)
    const args = again?.args.join(' ') || ''
    ok(args.includes('--fork-session') && again.args.includes('--strict-mcp-config') && again.args.includes('mcp__bridge_outbox__save_file') && args.includes('--tools Read,Grep,Glob ') && !/Write|Edit|Bash|acceptEdits|bypassPermissions/.test(args), 'picked up in a copy of its conversation, with its save_file tool and still nothing that writes', again?.args)
    const d = await until(async () => (await needs()).find((x) => x.text.includes('Early and late files') && x.state === 'draft' && x.files?.length), 40000)
    const names = (d?.files || []).map((f) => f.name).sort().join()
    ok(names === 'early.csv,late.html,m3.txt,m4.txt,m5.txt' && /I couldn't save m6\.txt: You've saved 5 files already/.test(d.draft), 'what it saved before it was stopped goes with the answer, counted in its five', d && { files: names, draft: d.draft })
    ok(/late\.html, which can run a script where it's opened, so it waits for you/.test(d?.warn || ''), 'a page it made after Continue waits for you, as any does', d?.warn)
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
    await kit.api('/bots/b1/settings', { auto: false, limits: { minutes: 10 } })
  })

  // ---------- A model answering: attach_file, and ATTACH: lines ----------
  await part('a model attaches', async () => {
    await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
    await kit.api('/bots/b1/settings', { answerers: ['model:openai:gpt-5'] })
    await slack.ask({ user: 'U0DANA', text: `${M} The UCB book and the plan, from a model [attach ~/notes/hiring/UCB_All_Resumes.pdf] [attach-line ~/notes/hiring/plan.docx] [attach-line \`~/elsewhere/outside.pdf\`] [answer Here they are.]` })
    const d = await draftOf('from a model')
    const req = model.requests().find((x) => x.tools?.length && x.messages.some((m) => /from a model/.test(typeof m.content === 'string' ? m.content : '')))
    const brief = model.asked(/from a model/)[0] || ''
    const tail = brief.slice(brief.lastIndexOf('----- end of question -----'))
    ok(!/text files only/.test(brief) && /attach it with your attach_file tool and its path, or put a line ATTACH: <its path> at the very end of your answer, after everything else you say, one for each file/.test(tail) && /save it with your save_file tool/.test(tail), 'a model\'s brief: attach_file, or an ATTACH: line at the very end; not "text files only"', tail)
    ok(!!req && ['save_file', 'attach_file'].every((n) => req.tools.includes(n)), 'and Bridge AI\'s attach_file among its tools', req?.tools)
    ok(d?.by && /gpt-5/i.test(d.by) && d.files?.map((f) => `${f.name}:${f.size}`).sort().join() === `UCB_All_Resumes.pdf:${UCB.length},plan.docx:${PLAN.length}`, 'its draft: the PDF it attached with its tool, and the document its ATTACH: line named', d && { by: d.by, files: d.files })
    ok(/^Here they are\./.test(d?.draft || '') && !/ATTACH:/.test(d?.draft || '') && /Not sent: outside\.pdf \(it isn't in the folders the bot reads from\)\./.test(d?.draft || ''), 'the ATTACH: lines out of its words, and the one outside its folders refused, saying why', d?.draft)
    const made = madeOf(d.id)
    ok((made?.files || []).find((f) => f.name === 'plan.docx')?.from === '~/notes/hiring/plan.docx'.replace(/\//g, path.sep), 'in the record, with where each came from', made)

    // Held for you, in Needs You on a phone, with its files as any answer's are.
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', phone: true })
    await p.locator('.topbar, .tabbar').first().waitFor({ timeout: 20000 })
    await p.locator('.needs-chip').click({ timeout: 15000 })
    const card = p.locator('.ny-item.t-slack', { hasText: 'from a model' }).first()
    await card.waitFor({ timeout: 15000 })
    const words = await until(async () => { const w = await card.innerText(); return /With .*UCB_All_Resumes\.pdf/.test(w) ? w : null }, 10000) || await card.innerText()
    ok(/With plan\.docx \(4 KB\), UCB_All_Resumes\.pdf \(200 KB\)/.test(words), 'Needs You on a phone: the attached files, as made ones show', words)
    // Each with where it's from, and a way to look at it there (on a phone, it comes to the phone).
    const rows = card.locator('.ny-attached [data-file]')
    ok(await rows.count() === 2 && /from ~[\\/]notes[\\/]hiring[\\/]UCB_All_Resumes\.pdf/.test(await card.locator('.ny-attached').innerText()) && await rows.first().locator('button', { hasText: 'Open' }).count() === 1, 'and where each is from, with Open to look at it before it goes', await card.locator('.ny-attached').innerText().catch(() => ''))
    const faults = await phoneFaults(p, '.ny-item.t-slack')
    ok(!Object.keys(faults).length, 'on a phone: nothing too small to tap, off the screen or cut short', faults)
    await shot(p, `${tag}bots-files-attached-phone`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })

    // An ATTACH: line in the middle of its words (quoting a file, say) is only words; and its read
    // tools keep out of hidden files and folders, and what's named as keys, as attaching does.
    await slack.ask({ user: 'U0DANA', text: `${M} Quote the readme from a model [read .env] [answer The readme says:\nATTACH: ~/notes/hiring/plan.docx\nThat's all.]` })
    const q2 = await draftOf('Quote the readme from a model')
    ok(q2 && !q2.files?.length && /The readme says:\nATTACH: ~\/notes\/hiring\/plan\.docx\nThat's all\./.test(q2.draft), 'an ATTACH: line before the end of its answer: words, nothing attached', q2?.draft)
    const tool = (re) => model.requests().flatMap((x) => x.messages).filter((m) => m.role === 'tool').map((m) => String(m.content || '')).find((c) => re.test(c)) || ''
    ok(/\.env is hidden, or in a hidden folder: refused\./.test(tool(/\.env/)), 'a model\'s read_file: a hidden file in its folder refused', tool(/\.env/))
    await kit.api(`/bots/questions/${encodeURIComponent(q2.id)}`, { send: false })
    await slack.ask({ user: 'U0DANA', text: `${M} Search from a model [read /net/somehost/share/x.txt] [answer Searched.]` })
    const q3 = await draftOf('Search from a model')
    ok(/somehost[\\/]share[\\/]x\.txt is outside the folders you can read: refused\./.test(tool(/somehost/)), 'a path outside its folders (another computer\'s, /net/…) refused before it\'s looked up', tool(/somehost/))
    await kit.api(`/bots/questions/${encodeURIComponent(q3.id)}`, { send: false })
    // A vault of notes is notes to its read tools too; a password manager's export isn't.
    await slack.ask({ user: 'U0DANA', text: `${M} Vault notes from a model [read Work Vault/notes.md]` })
    const q4 = await draftOf('Vault notes from a model')
    ok(/It says: The offsite is in March\./.test(q4?.draft || ''), 'a model\'s read_file: a note in a folder called "Work Vault" read', q4?.draft)
    await kit.api(`/bots/questions/${encodeURIComponent(q4.id)}`, { send: false })
    await slack.ask({ user: 'U0DANA', text: `${M} Vault export from a model [read bitwarden-export.json] [answer Done.]` })
    const q5 = await draftOf('Vault export from a model')
    ok(/bitwarden-export\.json has a name that says it holds keys, passwords or credentials: refused\./.test(tool(/bitwarden-export/)), 'and a Bitwarden export refused', tool(/bitwarden-export/))
    await kit.api(`/bots/questions/${encodeURIComponent(q5.id)}`, { send: false })
    await kit.api('/bots/b1/settings', { answerers: [] })
  })

  // ---------- Try It, on a phone ----------
  await part('Try It on a phone', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', phone: true })
    await openSettings(p)
    await p.locator('.sb-tabs [role="tab"]', { hasText: 'Try It' }).click()
    const sec = p.locator('[data-setting="slack-try"]')
    await sec.waitFor({ timeout: 10000 })
    const n0 = (await slack.state()).files.length
    await sec.locator('textarea').fill('The CMU book, tried [attach ~/notes/hiring/CMU_All_Resumes.pdf] [answer Here it is.]')
    await sec.getByRole('button', { name: /^Ask Reports/ }).click()
    const files = await until(async () => (await sec.locator('.sb-files').innerText().catch(() => '')) || null, 30000)
    ok(/With CMU_All_Resumes\.pdf \(300 KB\)/.test(files || ''), 'Try It: the attached PDF with its draft, as a made file shows', files)
    const record = await until(async () => { const t = await sec.innerText(); return /Attached CMU_All_Resumes\.pdf from/.test(t) ? t : null }, 10000)
    ok(/Attached CMU_All_Resumes\.pdf from ~[\\/]notes[\\/]hiring[\\/]CMU_All_Resumes\.pdf/.test(record || '') && await sec.locator('.bf-made [data-file="CMU_All_Resumes.pdf"] .bf-from').count() === 1, 'and its record: what it attached, from where, with Open and Send to…', record)
    ok((await slack.state()).files.length === n0, 'and nothing went to Slack')
    await shot(p, `${tag}bots-files-try-phone`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })

  // ---------- Answering without asking: files from its folders wait, unless you say otherwise ----------
  await part('files from its folders, answering without asking', async () => {
    await kit.api('/bots/b1/settings', { auto: true, who: 'channels' })
    const inSlack = (name, channel) => until(async () => (await slack.state()).files.find((f) => f.name === name && f.channel === channel), 30000)
    const discard = (d) => d && kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
    // No, the default: it waits, even in a direct message from someone you named.
    await slack.ask({ user: 'U0DANA', dm: true, text: 'Auto one [attach ~/notes/hiring/plan.docx] [answer Here.]' })
    const d1 = await draftOf('Auto one')
    ok(d1?.state === 'draft' && /files from its folders wait for you \(Send Files From Its Folders Without Asking is off\)/.test(d1.warn || '') && !(await slack.state()).files.some((f) => f.name === 'plan.docx' && f.channel === 'D0DANA'), 'by default an answer with a file from its folders waits for you, even answering without asking, even in a direct message from someone you named', d1 && { state: d1.state, warn: d1.warn })
    await discard(d1)
    // (Words that look like a token wait too.)
    await slack.ask({ user: 'U0DANA', dm: true, text: 'Auto key [answer The key is AKIAABCDEFGHIJKLMNOP.]' }) // private-ok: a made-up AWS key id, which holds the answer
    const dk = await draftOf('Auto key')
    ok(dk?.state === 'draft' && /what looks like a key, a password or a token/.test(dk.warn || ''), 'an answer whose words look like a key or a token waits for you', dk && { state: dk.state, warn: dk.warn })
    await discard(dk)
    await slack.ask({ user: 'U0DANA', dm: true, text: 'Auto wifi [answer The wifi password: Hunter2Hunter2]' })
    const dw = await draftOf('Auto wifi')
    ok(dw?.state === 'draft' && /what looks like a key, a password or a token/.test(dw.warn || ''), 'and one that gives a password in lower case', dw && { state: dw.state, warn: dw.warn })
    await discard(dw)
    // To people you named: in a direct message with Dana it goes; Eve, who may ask but isn't named,
    // and Dana in a private channel, wait.
    await kit.api('/bots/b1/settings', { attachAuto: 'named' })
    await slack.ask({ user: 'U0DANA', dm: true, text: 'Auto two [attach ~/notes/hiring/plan.docx] [answer Here.]' })
    const up2 = await inSlack('plan.docx', 'D0DANA')
    ok(up2?.sha256 === sha(PLAN), 'to people you named: in a direct message with Dana, it goes without asking', up2)
    await slack.ask({ user: 'U0EVE', dm: true, text: 'Auto three [attach ~/notes/hiring/plan.docx] [answer Here.]' })
    const d3 = await draftOf('Auto three')
    ok(d3?.state === 'draft' && /only in a direct message with you or someone you named/.test(d3.warn || ''), 'but not to Eve, who may ask and isn\'t named', d3?.warn)
    await discard(d3)
    await slack.ask({ user: 'U0DANA', channel: 'C0PRIV', text: `${M} Auto four [attach ~/notes/hiring/plan.docx] [answer Here.]` })
    const d4 = await draftOf('Auto four')
    ok(d4?.state === 'draft' && /only in a direct message with you or someone you named/.test(d4.warn || ''), 'nor in a private channel', d4?.warn)
    await discard(d4)
    // To everyone who may ask: Eve's direct message, and a private channel; never a public one.
    await kit.api('/bots/b1/settings', { attachAuto: 'everyone' })
    await slack.ask({ user: 'U0EVE', dm: true, text: 'Auto five [attach ~/notes/hiring/plan.docx] [answer Here.]' })
    ok((await inSlack('plan.docx', 'D0EVE'))?.sha256 === sha(PLAN), 'to everyone who may ask: Eve\'s direct message goes without asking')
    await slack.ask({ user: 'U0EVE', channel: 'C0PRIV', text: `${M} Auto six [attach ~/notes/hiring/plan.docx] [answer Here.]` })
    ok((await inSlack('plan.docx', 'C0PRIV'))?.sha256 === sha(PLAN), 'and a private channel everyone in which may ask it')
    await slack.ask({ user: 'U0EVE', text: `${M} Auto seven [attach ~/notes/hiring/plan.docx] [answer Here.]` })
    const d7 = await draftOf('Auto seven')
    ok(d7?.state === 'draft' && /public channel, so it waits for you/.test(d7.warn || ''), 'a public channel waits for you all the same', d7?.warn)
    await discard(d7)
    // Everyone in a private channel gets the file: with a guest in it, it waits.
    await slack.channel({ channel: 'C0PRIV', members: ['U0DANA', 'U0EVE', 'U0OWNER', 'U0GUS', 'UBOT'] })
    await slack.ask({ user: 'U0EVE', channel: 'C0PRIV', text: `${M} Auto eight [attach ~/notes/hiring/plan.docx] [answer Here.]` })
    const d8 = await draftOf('Auto eight')
    ok(d8?.state === 'draft' && /where one person in it may not ask it \(a guest, someone from another organization, or someone you haven't named\), so it waits for you/.test(d8.warn || ''), 'with a guest in the private channel, it waits for you', d8?.warn)
    await discard(d8)
    await slack.channel({ channel: 'C0PRIV', members: ['U0DANA', 'U0EVE', 'U0OWNER', 'UBOT'] })
    // Only people you named may ask: Eve's in the channel, so Dana's answer there waits.
    await kit.api('/bots/b1/settings', { who: 'named' })
    await slack.ask({ user: 'U0DANA', channel: 'C0PRIV', text: `${M} Auto nine [attach ~/notes/hiring/plan.docx] [answer Here.]` })
    const d9 = await draftOf('Auto nine')
    ok(d9?.state === 'draft' && /people in it may not ask it/.test(d9.warn || ''), 'with only people you named asking, someone not named in it: it waits for you', d9?.warn)
    await discard(d9)
    await kit.api('/bots/b1/settings', { who: 'channels' })
    // Shared with another organization since: Slack says so, and it waits at once.
    await slack.channel({ channel: 'C0PRIV', shared: true })
    await new Promise((r) => setTimeout(r, 1500))
    await slack.ask({ user: 'U0EVE', channel: 'C0PRIV', text: `${M} Auto ten [attach ~/notes/hiring/plan.docx] [answer Here.]` })
    const d10 = await draftOf('Auto ten')
    ok(d10?.state === 'draft' && /only in a direct message or a private channel where everyone may ask it/.test(d10.warn || ''), 'a private channel shared with another organization since: it waits, as soon as Slack says so', d10?.warn)
    await discard(d10)
    await slack.channel({ channel: 'C0PRIV', shared: false })
    await kit.api('/bots/b1/settings', { auto: false, who: 'named', attachAuto: 'no' })
  })

  // ---------- Discord ----------
  await part('to Discord', async () => {
    await kit.api('/bots/b1/discord', { token: T1, guild: '3001' })
    ok(!!(await until(async () => (await botOf()).where?.discord?.state === 'connected', 20000)), 'connected to Discord too')
    const q = await dc.say({ user: '2001', text: '<@1001> A picture please [make plan.svg <svg xmlns="http://www.w3.org/2000/svg"/>] [answer Here is the plan.]' })
    const d = await draftOf('A picture please')
    ok(d?.files?.some((f) => f.name === 'plan.svg'), 'its draft, with the file', d?.files)
    await send(d)
    const p = await until(async () => (await dc.state()).posted.find((x) => x.files?.some((f) => f.name === 'plan.svg')), 15000)
    const words = (await dc.state()).posted.find((x) => /Here is the plan/.test(x.content || ''))
    ok(!!p && p.channel === words?.channel && p.channel === q.id && p.files[0].sha256 === sha(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n')), 'attached in Discord after its words, in the question\'s thread, the same bytes', { p, words })
    ok(!!(await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id && e.ok), 8000)), 'and in the record')
    // Attached from its folder: what Discord takes goes; one over the 10 MB it takes from a bot stays here, said.
    const qa = await dc.say({ user: '2001', text: '<@1001> The plan and the deck please [attach ~/notes/hiring/plan.docx] [attach ~/notes/hiring/deck.pdf] [answer Both here.]' })
    const s = await startOf('The plan and the deck please')
    ok(/Discord takes a file of up to 10\.0 MB from a bot: a bigger one stays with Tester in Bridge AI, and your reply says so\./.test(briefOf(s)), 'its brief in Discord says the 10 MB Discord takes')
    const da = await draftOf('The plan and the deck please')
    ok(da?.files?.map((f) => f.name).sort().join() === 'deck.pdf,plan.docx', 'its draft: both attached (each under 25 MB)', da?.files)
    await send(da)
    const pa = await until(async () => (await dc.state()).posted.find((x) => x.files?.some((f) => f.name === 'plan.docx')), 15000)
    const said = await until(async () => (await dc.state()).posted.find((x) => /Both here\./.test(x.content || '')), 15000)
    ok(!!pa && pa.channel === qa.id && pa.files.length === 1 && pa.files[0].sha256 === sha(PLAN), 'the document attached in Discord, the same bytes; the deck not', pa?.files)
    ok(/I couldn't attach deck\.pdf \(12\.0 MB\) \(it's 12\.0 MB, over the 10\.0 MB Discord takes from a bot\)\. Tester has it in Bridge AI on /.test(said?.content || ''), 'the reply says why the deck didn\'t go, and who has it', said?.content)
  })

  // ---------- Microsoft Teams: none attached, said ----------
  await part('in Teams', async () => {
    const { appId, password, tenantId } = tm.app
    await kit.api('/bots/b1/teams', { appId, password, tenantId })
    const port = await until(async () => (await botOf()).where?.teams?.port, 15000)
    await kit.api('/bots/b1/teams/endpoint', { publicUrl: `http://127.0.0.1:${port}/api/messages` })
    await tm.endpoint(`http://127.0.0.1:${port}/api/messages`)
    await tm.install()
    await kit.api('/bots/b1/settings', { askers: [{ id: 'U0DANA', name: 'Dana' }, { id: 'discord:2001', name: 'Dana' }, { id: 'teams:aad-dana-0001', name: 'Dana Reyes' }] })
    await tm.say({ user: 'dana', text: 'The summary please [make summary.md All well.] [answer Here it is.]' })
    const d = await draftOf('The summary please')
    ok(d?.files?.some((f) => f.name === 'summary.md'), 'its draft, with the file', d?.files)
    await send(d)
    const p = await until(async () => (await tm.state()).posted.find((x) => /Here it is/.test(x.text || '')), 15000)
    ok(/I couldn't attach summary\.md \(\d+ bytes\) \(Microsoft Teams doesn't let a bot attach a file to a reply\)\. Tester has it in Bridge AI on /.test(p?.text || ''), 'the reply says Teams took no file, and who has it, where', p?.text)
    const ev = await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id), 8000)
    ok(ev?.ok === false && /Microsoft Teams/.test(ev.error || ''), 'and the record says so', ev)
    // Attached from its folder: its brief says Teams takes none, and the reply says so.
    await tm.say({ user: 'dana', text: 'The UCB book in Teams please [attach ~/notes/hiring/UCB_All_Resumes.pdf] [answer Here it is, in Teams.]' })
    const s = await startOf('The UCB book in Teams please')
    ok(/attach it with your attach_file tool/.test(briefOf(s)) && /Microsoft Teams doesn't let a bot attach a file to a reply: a file you send back stays with Tester in Bridge AI, and your reply says so\./.test(briefOf(s)) && !/FILE:/.test(briefOf(s)), 'its brief in Teams: it may attach, and Teams takes none from a bot, which the reply says')
    const da = await draftOf('The UCB book in Teams please')
    ok(da?.files?.some((f) => f.name === 'UCB_All_Resumes.pdf'), 'its draft, with the PDF', da?.files)
    await send(da)
    const pa = await until(async () => (await tm.state()).posted.find((x) => /Here it is, in Teams/.test(x.text || '')), 15000)
    ok(/I couldn't attach UCB_All_Resumes\.pdf \(200 KB\) \(Microsoft Teams doesn't let a bot attach a file to a reply\)\. Tester has it in Bridge AI on /.test(pa?.text || ''), 'the reply says Teams took no file, and who has it', pa?.text)
  })

  // ---------- Its Activity ----------
  await part('Activity', async () => {
    const { ctx, p, errors } = await page(b, kit.url)
    await openSettings(p)
    await p.locator('.sb-tabs [role="tab"]', { hasText: 'Activity' }).click()
    const files = p.locator('[data-setting="bots-files"]')
    await files.waitFor({ timeout: 15000 })
    // (The latest, newest first: one it made in Teams, and a PDF it attached in Discord, listed as any.)
    ok(/Files It Made/.test(await files.innerText()) && await files.locator('[data-file="summary.md"]').count() === 1 && await files.locator('[data-file="deck.pdf"]').count() === 1, 'its Activity lists the files it made, and a PDF it attached as a made one is', await files.innerText())
    const row = files.locator('[data-file="deck.pdf"]')
    ok(await row.locator('button', { hasText: 'Open' }).count() === 1 && await row.locator('button', { hasText: 'Send to…' }).count() === 1, 'each with Open and Send to…')
    if (IS_WIN) skip('Open in its app', 'nothing stands in for Windows\' Explorer')
    else {
      await row.locator('button', { hasText: 'Open' }).click()
      const opened = await until(() => { try { return fs.readFileSync(path.join(kit.bin, 'opened.log'), 'utf8').includes('deck.pdf') } catch { return false } }, 8000)
      ok(!!opened, `Open: in its app on this computer (${IS_MAC ? 'open' : 'xdg-open'})`)
    }
    // A drawing could run a script where it opens (a browser): shown in Finder instead, whatever's asked.
    const svg = (await kit.api('/bots/b1/files')).files.find((f) => f.name === 'chart.svg')
    if (IS_MAC) {
      // (In its conversation's timeline: the latest twenty above are newer files.)
      await p.locator('.sb-conv', { hasText: 'The chart please' }).click()
      const srow = p.locator('.sb-timeline .bf-made [data-file="chart.svg"]').first()
      await srow.waitFor({ timeout: 10000 }).catch(() => {})
      ok(await srow.locator('button', { hasText: 'Show in Finder' }).count() === 1, 'a drawing: Show in Finder, not Open')
    }
    if (!IS_WIN && svg) {
      await fetch(`${kit.url}/api/agents/${encodeURIComponent('botfiles:b1')}/fileop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'open', path: svg.path }) })
      const last = await until(() => { try { const l = fs.readFileSync(path.join(kit.bin, 'opened.log'), 'utf8').trim().split('\n').at(-1); return /chart\.svg|\d{4}-\d{2}[\\/]/.test(l) ? l : null } catch { return null } }, 8000)
      ok(!!last && (IS_MAC ? /^-R .*chart\.svg$/.test(last) : !/chart\.svg$/.test(last)), 'and asked to open one, the server shows it in its folder instead', last)
    }
    await row.locator('button', { hasText: 'Send to…' }).click()
    ok(!!(await until(async () => /None of your other devices is linked/.test(await p.locator('.xfer-dialog').innerText().catch(() => '')), 8000)), 'Send to… opens the dialog Files has (no other computer linked here)')
    await p.locator('.xfer-dialog button', { hasText: 'Cancel' }).click()
    // In its timeline, too.
    await p.locator('.sb-conv', { hasText: 'Totals by region' }).click()
    await p.locator('.sb-timeline .bf-made').first().waitFor({ timeout: 10000 })
    ok(await p.locator('.sb-timeline .bf-made [data-file="totals.csv"]').count() === 1 && /Made totals\.csv/.test(await p.locator('.sb-timeline').innerText()), 'and in the conversation\'s timeline, where it was made')
    const r = await fetch(`${kit.url}/api/agents/${encodeURIComponent('botfiles:b1')}/fileop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'trash', path: (await kit.api('/bots/b1/files')).files[0].path }) })
    ok(r.status === 403, 'a bot\'s files are only to open and send on: nothing changed through them', r.status)
    const dir = path.posix.dirname((await kit.api('/bots/b1/files')).files[0].path)
    const viaStudio = await fetch(`${kit.url}/api/studio/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: 'botfiles:b1', dir, name: 'invoice.html', text: '<p>planted</p>' }) })
    const into = await fetch(`${kit.url}/api/transfers/in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'k1', name: 'x.txt', files: [{ size: 3 }], to: { where: 'pane', pane: 'botfiles:b1', dir } }) })
    ok(viaStudio.status === 403 && into.status === 403 && !(await kit.api('/bots/b1/files')).files.some((f) => /invoice|x\.txt/.test(f.name)), 'nor through Studio\'s routes, nor a copy into them', { studio: viaStudio.status, into: into.status })
    await shot(p, `${tag}bots-files-activity`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  await b.close()
  kit.stop()
  slack.stop()
  dc.stop()
  tm.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
