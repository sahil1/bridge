// Mail from the Mac Mail app's local index ("Envelope Index", SQLite), opened read-only.
// Mail syncs the Exchange account; nothing here talks to a mail server.
// Needs Full Disk Access for the app that starts Bridge AI (macOS protects ~/Library/Mail).
//
// Each inbox message gets a score from signals already on disk: Apple's category (Primary,
// Transactions, Updates, Promotions) and "high impact" flag, whether it was sent to you or only
// cc'd, whether you write to the sender, whether you're in the thread and already replied, and
// urgency words. Your own "always important" / "mute" rules live in ~/.bridge-ai/cache/mail-rules.json.
//
// Read only, always: nothing here sends, archives, flags, moves or deletes mail, or puts a draft in
// Mail. Done and Remind me are kept by Bridge AI (~/.bridge-ai/mail/marks.json) and leave Mail as
// it is; you answer from your own mail app.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { cacheFile, dataFile, writeFileAtomic } from './paths.js'
import { readEmlx, splitQuoted, summaryText, ownWords } from './mailparse.js'

const MAIL = path.join(os.homedir(), 'Library', 'Mail')
const RULES = cacheFile('mail-rules.json')
const MARKS = dataFile('mail', 'marks.json')

const SETUP = {
  noAccess: 'Bridge AI needs Full Disk Access to read Mail\'s local index. Nothing leaves your Mac.',
  notMac: 'The inbox reads Apple Mail on macOS. It isn\'t available on this platform yet.',
  noMail: 'Mail has nothing on this Mac yet. Add your account to Mail and open it once, so it can sync.',
}

function findIndex() {
  let dirs
  try { dirs = fs.readdirSync(MAIL) } catch (e) { return { error: e.code === 'EPERM' || e.code === 'EACCES' ? 'noAccess' : 'noMail' } }
  const versions = dirs.filter((d) => /^V\d+$/.test(d)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))
  for (const v of versions) {
    const f = path.join(MAIL, v, 'MailData', 'Envelope Index')
    try { fs.accessSync(f, fs.constants.R_OK); return { file: f, root: path.join(MAIL, v) } } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') return { error: 'noAccess' } }
  }
  return { error: 'noMail' }
}

const sql = (file, query) => new Promise((resolve, reject) => {
  // mode=ro: never writes; Mail keeps working on its own copy.
  execFile('sqlite3', ['-readonly', '-json', `file:${file}?mode=ro`, query], { timeout: 20000, maxBuffer: 32 * 1024 * 1024 }, (err, out, errOut) => {
    if (err) return reject(new Error((errOut || err.message).trim().split('\n')[0]))
    try { resolve(out.trim() ? JSON.parse(out) : []) } catch (e) { reject(e) }
  })
})

// Mail's index isn't the same on every macOS: a column one has (message_id_header, Apple
// Intelligence's summaries, automated_conversation) another doesn't, and asking for one that isn't
// there fails the whole query ("no such column"). So each index is asked first what it has, and
// the queries ask only for that; what's missing comes back empty.
const shapes = new Map() // index file -> { table: Set of its columns }
async function shapeOf(file) {
  if (shapes.has(file)) return shapes.get(file)
  const rows = await sql(file, "SELECT t.name AS t, c.name AS c FROM sqlite_master t JOIN pragma_table_info(t.name) c WHERE t.type = 'table'")
  const shape = {}
  for (const r of rows) (shape[r.t] ||= new Set()).add(r.c)
  shapes.set(file, shape)
  return shape
}
// What a query can use from this index: has('messages', 'summary'), col('g', 'message_id_header', 'mid').
function parts(shape) {
  const has = (t, c) => !!shape[t] && (!c || shape[t].has(c))
  const alias = { m: 'messages', g: 'message_global_data' }
  const g = has('message_global_data') && has('messages', 'global_message_id')
  const col = (a, c, as) => ((a !== 'g' || g) && has(alias[a], c) ? `${a}.${c} AS ${as}` : `NULL AS ${as}`)
  return {
    has, col, g,
    conv: has('messages', 'conversation_id'),
    summaries: has('summaries') && has('messages', 'summary'),
    generated: g && has('generated_summaries') && has('message_global_data', 'generated_summary'),
  }
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const toISO = (v) => (Number(v) ? new Date((Number(v) < 1e9 ? Number(v) + 978307200 : Number(v)) * 1000).toISOString() : null)

const BULK = /no-?reply|noreply|notifications?@|mailer-daemon|newsletter|digest|updates@|news@|marketing|jira@|confluence@|bitbucket|github\.com|calendar-notification|microsoft\.com$/i
const URGENT = /\burgent|asap|action required|outage|escalat|critical|deadline|by (?:eod|end of day|today|tomorrow)|time[- ]sensitive|approval needed|please approve|sign(?:ature)? required|overdue\b/i
const ASKS = /\b(can you|could you|would you|please (?:review|confirm|approve|advise|share|send|let me know)|let me know|thoughts\?|your (?:input|approval|feedback)|need your)\b/i
const CATEGORY = { 0: 'primary', 1: 'transactions', 2: 'updates', 3: 'promotions' }
const INBOX = "(m.mailbox IN (SELECT ROWID FROM mailboxes WHERE lower(url) LIKE '%/inbox'))"
const SENT = "(m.mailbox IN (SELECT ROWID FROM mailboxes WHERE url LIKE '%/Sent%' OR url LIKE '%/SENT'))"

// ---------- rules you set from the UI ----------
function readRules() {
  try { return { vip: [], mute: [], ...JSON.parse(fs.readFileSync(RULES, 'utf8')) } } catch { return { vip: [], mute: [] } }
}
function writeRules(r) {
  fs.mkdirSync(path.dirname(RULES), { recursive: true })
  writeFileAtomic(RULES, JSON.stringify(r, null, 2))
}
export function setRule(address, rule) {
  const a = String(address || '').toLowerCase().trim()
  if (!a.includes('@')) throw new Error('Need an email address')
  const r = readRules()
  r.vip = r.vip.filter((x) => x !== a)
  r.mute = r.mute.filter((x) => x !== a)
  if (rule === 'vip') r.vip.push(a)
  if (rule === 'mute') r.mute.push(a)
  writeRules(r)
  return r
}

// ---------- Done and Remind me, kept by Bridge AI ----------
// threads: { c<conversation> | m<message>: { mark: 'done' | 'later', at, until, id, subject } }:
// a thread done, or set aside until a time (then back in Needs you, saying it's a reminder). New
// mail in the thread since brings it back at once, as a reply would in Mail. nudges: { <id of a
// message you sent>: { until, at, conv, subject, to } }: "remind me if nobody answers",
// which goes by itself once someone does (or you write again).
function readMarks() {
  try { const m = JSON.parse(fs.readFileSync(MARKS, 'utf8')); return { threads: m.threads || {}, nudges: m.nudges || {} } } catch { return { threads: {}, nudges: {} } }
}
function writeMarks(m) {
  fs.mkdirSync(path.dirname(MARKS), { recursive: true })
  writeFileAtomic(MARKS, JSON.stringify(m, null, 1))
}
const threadKey = (m) => (m.conv ? `c${m.conv}` : `m${m.id}`)
const YEAR = 366 * 864e5
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
// mark: 'done', 'later' (until), 'nudge' (a message you sent: sent, conv, until) or 'clear'. at:
// when it was set, given back by Undo; otherwise now.
export function setMark({ key, id, mark, until, at, subject, from, sent, conv, to } = {}) {
  const marks = readMarks()
  const when = at && Date.parse(at) <= Date.now() + 1000 ? new Date(Date.parse(at)).toISOString() : new Date().toISOString()
  const later = (u) => {
    const t = Date.parse(u)
    if (!Number.isFinite(t) || t <= Date.now() || t > Date.now() + YEAR) throw Object.assign(new Error('Pick a time from now to a year ahead'), { status: 400 })
    return new Date(t).toISOString()
  }
  if (sent != null) {
    const n = String(Number(sent))
    if (!Number.isInteger(Number(sent))) throw Object.assign(new Error('Which message you sent?'), { status: 400 })
    if (mark === 'clear') delete marks.nudges[n]
    else if (mark === 'nudge') marks.nudges[n] = { until: later(until), at: when, conv: Number(conv) || null, subject: clip(subject, 200), to: clip(to, 200) }
    else throw Object.assign(new Error('Unknown mark'), { status: 400 })
    writeMarks(marks)
    return { ok: true, nudge: marks.nudges[n] || null }
  }
  if (!/^[cm]\d+$/.test(String(key || ''))) throw Object.assign(new Error('Which thread?'), { status: 400 })
  if (mark === 'clear') delete marks.threads[key]
  else if (mark === 'done') marks.threads[key] = { mark: 'done', at: when, id: Number(id) || null, subject: clip(subject, 200), from: clip(from, 120) }
  else if (mark === 'later') marks.threads[key] = { mark: 'later', at: when, until: later(until), id: Number(id) || null, subject: clip(subject, 200), from: clip(from, 120) }
  else throw Object.assign(new Error('Unknown mark'), { status: 400 })
  writeMarks(marks)
  return { ok: true, mark: marks.threads[key] || null }
}

// Where Mail keeps a message on disk: <account>/<Folder>.mbox/<uuid>/Data/<digits>/Messages/<id>[.partial].emlx
function emlxPath(root, url, id) {
  const m = /^\w+:\/\/([^/]+)\/(.+)$/.exec(url || '')
  if (!m) return null
  const mbox = path.join(root, m[1], ...decodeURIComponent(m[2]).split('/').map((p) => `${p}.mbox`))
  const n = Math.floor(id / 1000)
  const digits = n ? String(n).split('').reverse() : []
  let subs
  try { subs = fs.readdirSync(mbox).filter((d) => /^[0-9A-F-]{36}$/i.test(d)) } catch { return null }
  for (const s of subs) {
    for (const name of [`${id}.emlx`, `${id}.partial.emlx`]) {
      const f = path.join(mbox, s, 'Data', ...digits, 'Messages', name)
      if (fs.existsSync(f)) return f
    }
  }
  return null
}

// Where Mail keeps a message's attachment once it's downloaded: beside its Messages folder, in
// Attachments/<message>/<part>/<name>.
function attachmentPath(root, url, id, aid, name) {
  const m = /^\w+:\/\/([^/]+)\/(.+)$/.exec(url || '')
  if (!m || !aid || !name || /[\\/]/.test(String(aid)) || /[\\/]/.test(String(name))) return null
  const mbox = path.join(root, m[1], ...decodeURIComponent(m[2]).split('/').map((p) => `${p}.mbox`))
  const n = Math.floor(id / 1000)
  const digits = n ? String(n).split('').reverse() : []
  let subs
  try { subs = fs.readdirSync(mbox).filter((d) => /^[0-9A-F-]{36}$/i.test(d)) } catch { return null }
  for (const s of subs) {
    const f = path.join(mbox, s, 'Data', ...digits, 'Attachments', String(id), String(aid), String(name))
    if (fs.existsSync(f)) return f
  }
  return null
}

// Done and Remind me on what was read: a thread done is 'done', one set aside is 'later' until its
// time and then back in Needs you with Reminder first among its reasons. A mark that new mail has
// overtaken, or that's long past and out of the window, is let go. The reminders for mail you sent:
// [{ id, subject, to, until, due }], the ones nobody has answered yet.
function applyMarks(messages, marks, answered = []) {
  const now = Date.now()
  let changed = false
  const latest = new Map()
  for (const m of messages) { const k = threadKey(m); if (!latest.has(k) || m.received > latest.get(k)) latest.set(k, m.received) }
  for (const [k, mk] of Object.entries(marks.threads)) {
    const last = latest.get(k)
    const old = now - Date.parse(mk.at) > 30 * 864e5
    if ((last && Date.parse(last) > Date.parse(mk.at) + 1000) || (!last && old && (mk.mark === 'done' || Date.parse(mk.until) < now))) { delete marks.threads[k]; changed = true }
  }
  for (const m of messages) {
    const mk = marks.threads[threadKey(m)]
    if (!mk) continue
    if (mk.mark === 'done') { m.done = mk.at; m.bucket = 'done' } else if (Date.parse(mk.until) > now) { m.later = mk.until; m.bucket = 'later' } else { m.reminded = mk.until; m.bucket = 'needs'; m.reasons = ['Reminder', ...m.reasons.filter((r) => r !== 'Reminder')] }
  }
  const by = new Map(answered.map((a) => [Number(a.conv), a]))
  const out = []
  for (const [id, n] of Object.entries(marks.nudges)) {
    const a = by.get(Number(n.conv))
    const since = Date.parse(n.at) / 1000
    // Someone answered, or you wrote again: nothing to remind you of.
    if ((a?.answered && toUnix(a.answered) > since) || (a?.again && toUnix(a.again) > since + 5) || now - Date.parse(n.until) > 30 * 864e5) { delete marks.nudges[id]; changed = true; continue }
    out.push({ id: Number(id), conv: n.conv, subject: n.subject || '(no subject)', to: n.to || '', until: n.until, due: Date.parse(n.until) <= now })
  }
  if (changed) { try { writeMarks(marks) } catch { /* kept as it was */ } }
  return out.sort((x, y) => (x.until < y.until ? -1 : 1))
}
const toUnix = (v) => (Number(v) < 1e9 ? Number(v) + 978307200 : Number(v))

export function makeMail(cfg = {}) {
  // Your own organisation's domains, so mail from colleagues isn't marked "External".
  const myDomains = () => (cfg.mail?.myDomains || []).map((d) => String(d).toLowerCase()) // read live: settings can change it
  let cache = null
  let at = 0
  let people = null // who you write to, refreshed every 30 minutes
  let peopleAt = 0
  let idx = null

  async function contacts(file) {
    if (people && Date.now() - peopleAt < 30 * 60 * 1000) return people
    const year = Math.floor(Date.now() / 1000) - 365 * 86400
    const [me, sentTo] = await Promise.all([
      sql(file, `SELECT lower(a.address) AS address, count(*) AS n FROM messages m JOIN addresses a ON a.ROWID = m.sender WHERE ${SENT} GROUP BY 1 HAVING n >= 20 ORDER BY n DESC LIMIT 6`),
      sql(file, `SELECT lower(a.address) AS address, count(*) AS n FROM messages m JOIN recipients r ON r.message = m.ROWID JOIN addresses a ON a.ROWID = r.address
        WHERE ${SENT} AND m.date_sent >= ${year} GROUP BY 1`),
    ])
    const mine = new Set(me.map((r) => r.address))
    people = {
      me: [...mine],
      sentTo: Object.fromEntries(sentTo.filter((r) => !mine.has(r.address)).map((r) => [r.address, r.n])),
      domains: [...new Set([...mine].map((a) => a.split('@')[1]))],
    }
    peopleAt = Date.now()
    return people
  }

  function score(m, ctx) {
    const reasons = []
    let s = 0
    const addr = (m.address || '').toLowerCase()
    const domain = addr.split('@')[1] || ''
    const automated = m.automated === 2 || BULK.test(addr) || m.category === 2 || m.category === 3
    const text = `${m.subject} ${m.snippet || ''}`
    if (ctx.rules.mute.includes(addr)) return { score: -10, reasons: ['Muted'], bucket: 'other', automated: true }
    if (ctx.rules.vip.includes(addr)) { s += 5; reasons.push('VIP') }
    if (automated) s -= 5
    const sent = ctx.people.sentTo[addr] || 0
    if (sent >= 5) { s += 3; reasons.push('You write to them') } else if (sent > 0) { s += 1.5; reasons.push("You've written to them") }
    if (m.toMe === 0) { s += 2; reasons.push(m.recipients <= 2 ? 'Just to you' : 'To you') } else if (m.toMe === 1) { s -= 1; reasons.push('CC') } else if (!automated) s -= 1
    if (m.myThread) { s += 2; reasons.push('Your thread') }
    if (m.replied) { s -= 4; reasons.push('You replied') }
    if (URGENT.test(text)) { s += 3; reasons.push('Urgent') }
    if (!automated && ASKS.test(m.snippet || '')) { s += 1.5; reasons.push('Asks you') }
    if (!automated && domain && !ctx.people.domains.includes(domain) && !myDomains().some((d) => domain === d || domain.endsWith(`.${d}`))) { s += 1; reasons.push('External') }
    if (m.flagged) { s += 2; reasons.push('Flagged') }
    if (!m.read) s += 1
    if (m.highImpact && automated) reasons.push('Action needed')
    const ageH = (Date.now() - new Date(m.received)) / 36e5
    s -= Math.min(4, ageH / 24)
    const bucket = automated
      ? (m.highImpact && !m.read ? 'action' : 'other')
      : (s >= 3.5 && !m.replied && ageH < 14 * 24 ? 'needs' : 'other')
    return { score: Math.round(s * 10) / 10, reasons, bucket, automated }
  }

  async function load() {
    if (process.platform !== 'darwin') return { available: false, reason: 'notMac', setup: SETUP.notMac }
    idx = findIndex()
    if (idx.error) return { available: false, reason: idx.error, setup: SETUP[idx.error] }
    const file = idx.file
    const x = parts(await shapeOf(file))
    const ppl = await contacts(file)
    const meList = ppl.me.map(q).join(',') || "''"
    const since = Math.floor(Date.now() / 1000) - 10 * 86400
    const today = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
    const marks = readMarks()
    // A thread set aside for longer than the window still comes back: its message is read too.
    const laterIds = Object.values(marks.threads).filter((x) => x.mark === 'later' && Number.isInteger(x.id)).map((x) => x.id)
    const nudgeConvs = Object.values(marks.nudges).map((x) => Number(x.conv)).filter((c) => Number.isInteger(c) && c > 0)
    const [[counts], rows, waiting, answered] = await Promise.all([
      sql(file, `SELECT SUM(m.read = 0) AS unread, SUM(m.flagged = 1) AS flagged, SUM(m.date_received >= ${today}) AS today
        FROM messages m WHERE m.deleted = 0 AND ${INBOX}`),
      sql(file, `
        SELECT m.ROWID AS id, m.read, m.flagged, m.date_received AS received, ${x.col('m', 'conversation_id', 'conv')}, ${x.col('m', 'automated_conversation', 'automated')},
               a.address, a.comment AS name, s.subject, ${x.summaries ? 'su.summary' : 'NULL AS summary'}, ${x.col('g', 'model_category', 'category')}, ${x.col('g', 'model_high_impact', 'highImpact')},
               ${x.col('g', 'message_id_header', 'mid')}, ${x.generated ? 'hex(gs.summary)' : 'NULL'} AS ai, mb.url AS mailbox,
               (SELECT min(r.type) FROM recipients r JOIN addresses ra ON ra.ROWID = r.address WHERE r.message = m.ROWID AND lower(ra.address) IN (${meList})) AS toMe,
               (SELECT count(*) FROM recipients r WHERE r.message = m.ROWID) AS recipients,
               ${x.conv ? `EXISTS (SELECT 1 FROM messages x WHERE x.conversation_id = m.conversation_id AND m.conversation_id != 0 AND x.mailbox IN (SELECT ROWID FROM mailboxes WHERE url LIKE '%/Sent%' OR url LIKE '%/SENT'))` : '0'} AS myThread,
               ${x.conv ? `EXISTS (SELECT 1 FROM messages x WHERE x.conversation_id = m.conversation_id AND m.conversation_id != 0 AND x.date_sent > m.date_received AND x.mailbox IN (SELECT ROWID FROM mailboxes WHERE url LIKE '%/Sent%' OR url LIKE '%/SENT'))` : '0'} AS replied
        FROM messages m
        JOIN mailboxes mb ON mb.ROWID = m.mailbox
        LEFT JOIN addresses a ON a.ROWID = m.sender
        LEFT JOIN subjects s ON s.ROWID = m.subject
        ${x.summaries ? 'LEFT JOIN summaries su ON su.ROWID = m.summary' : ''}
        ${x.g ? 'LEFT JOIN message_global_data g ON g.ROWID = m.global_message_id' : ''}
        ${x.generated ? 'LEFT JOIN generated_summaries gs ON gs.ROWID = g.generated_summary' : ''}
        WHERE m.deleted = 0 AND ${INBOX} AND (m.date_received >= ${since} OR m.flagged = 1${laterIds.length ? ` OR m.ROWID IN (${laterIds.join(',')})` : ''})
        ORDER BY m.date_received DESC LIMIT 500`),
      // Things you sent in the last 10 days where nobody has replied since (by conversation).
      !x.conv ? [] : sql(file, `
        SELECT m.ROWID AS id, m.date_sent AS sent, s.subject, m.conversation_id AS conv,
               (SELECT group_concat(coalesce(ra.comment, ra.address), ', ') FROM recipients r JOIN addresses ra ON ra.ROWID = r.address WHERE r.message = m.ROWID AND r.type = 0) AS toNames
        FROM messages m LEFT JOIN subjects s ON s.ROWID = m.subject
        WHERE ${SENT} AND m.deleted = 0 AND m.date_sent >= ${since} AND m.conversation_id != 0
          AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.conversation_id = m.conversation_id AND x.date_received > m.date_sent AND ${INBOX.replace(/m\.mailbox/g, 'x.mailbox')})
          AND NOT EXISTS (SELECT 1 FROM messages y WHERE y.conversation_id = m.conversation_id AND y.date_sent > m.date_sent AND ${SENT.replace(/m\.mailbox/g, 'y.mailbox')})
        ORDER BY m.date_sent DESC LIMIT 40`),
      // The threads with a "remind me if nobody answers": the last answer in each, and the last
      // thing you sent there.
      !x.conv || !nudgeConvs.length ? [] : sql(file, `
        SELECT m.conversation_id AS conv, max(CASE WHEN ${INBOX} THEN m.date_received END) AS answered, max(CASE WHEN ${SENT} THEN m.date_sent END) AS again
        FROM messages m WHERE m.deleted = 0 AND m.conversation_id IN (${nudgeConvs.join(',')}) GROUP BY 1`),
    ])
    const rules = readRules()
    const seen = new Set()
    const messages = []
    for (const r of rows) {
      // Exchange can hold the same message twice (moved, re-synced); keep the newest copy.
      const key = r.mid || `${r.address}|${r.subject}|${r.received}`
      if (seen.has(key)) continue
      seen.add(key)
      let ai = null
      if (r.ai) { try { ai = summaryText(Buffer.from(r.ai, 'hex')) } catch { /* unreadable summary */ } }
      const m = {
        id: r.id,
        from: r.name || (r.address || '').split('@')[0] || 'Unknown',
        address: r.address || '',
        subject: r.subject || '(no subject)',
        snippet: (r.summary || '').replace(/\s+/g, ' ').trim().slice(0, 240) || null,
        ai,
        received: toISO(r.received),
        read: !!r.read,
        flagged: !!r.flagged,
        category: CATEGORY[r.category] || null,
        highImpact: !!r.highImpact,
        automated: r.automated,
        toMe: r.toMe,
        recipients: r.recipients,
        myThread: !!r.myThread,
        replied: !!r.replied,
        conv: r.conv,
        account: /^imap:/.test(r.mailbox) ? 'personal' : /FromEnsemble/.test(r.mailbox) ? 'ensemble' : 'work',
        mid: r.mid ? r.mid.replace(/^<|>$/g, '') : null,
      }
      Object.assign(m, score(m, { people: ppl, rules }))
      m.bulk = m.automated
      delete m.automated
      messages.push(m)
    }
    const nudges = applyMarks(messages, marks, answered)
    const needs = messages.filter((m) => m.bucket === 'needs').sort((a, b) => b.score - a.score)
    return {
      available: true,
      unread: counts?.unread || 0,
      flagged: counts?.flagged || 0,
      today: counts?.today || 0,
      needs: needs.length,
      action: messages.filter((m) => m.bucket === 'action').length,
      messages,
      waiting: waiting.filter((w) => !/^(accepted|declined|tentative|canceled|cancelled|automatic reply|out of office)\b/i.test(w.subject || '') && w.toNames).map((w) => ({ id: w.id, conv: w.conv, subject: w.subject || '(no subject)', to: w.toNames || '', sent: toISO(w.sent), ...(marks.nudges[w.id] ? { nudge: marks.nudges[w.id].until } : {}) })),
      nudges,
      rules,
      me: ppl.me,
      fetchedAt: new Date().toISOString(),
    }
  }

  const get = async (force = false) => {
    if (!force && cache && Date.now() - at < 60 * 1000) return cache
    try {
      const out = await load()
      if (out.available) { cache = out; at = Date.now() }
      return out
    } catch (e) {
      if (/authorization denied|unable to open|not permitted/i.test(e.message)) return { available: false, reason: 'noAccess', setup: SETUP.noAccess }
      throw e
    }
  }

  // One message in full: headers, newest reply, quoted history, attachments, thread, file path.
  // Kept a while once read (the app reads the next few ahead of you), until Mail's index changes.
  const bodies = new Map() // id -> { at, value }
  get.message = async (id) => {
    if (!idx?.file) idx = findIndex()
    if (idx.error) throw new Error(SETUP[idx.error])
    const n = Number(id)
    if (!Number.isInteger(n)) throw new Error('Bad message id')
    const hit = bodies.get(n)
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value
    const value = await readMessage(n)
    // One Mail hasn't finished downloading is read again next time.
    if (!value.partial) { bodies.set(n, { at: Date.now(), value }); if (bodies.size > 80) bodies.delete(bodies.keys().next().value) }
    return value
  }
  async function readMessage(n) {
    const x = parts(await shapeOf(idx.file))
    const [row] = await sql(idx.file, `SELECT m.ROWID AS id, ${x.col('m', 'conversation_id', 'conv')}, mb.url AS mailbox FROM messages m JOIN mailboxes mb ON mb.ROWID = m.mailbox WHERE m.ROWID = ${n}`)
    if (!row) throw new Error('Message not found')
    const file = emlxPath(idx.root, row.mailbox, n)
    let body = null
    if (file) { try { body = readEmlx(file) } catch { /* fall back to the index summary */ } }
    const thread = row.conv ? await sql(idx.file, `
      SELECT m.ROWID AS id, m.date_received AS received, a.address, a.comment AS name, ${x.summaries ? 'su.summary' : 'NULL AS summary'},
             (m.mailbox IN (SELECT ROWID FROM mailboxes WHERE url LIKE '%/Sent%' OR url LIKE '%/SENT')) AS mine
      FROM messages m LEFT JOIN addresses a ON a.ROWID = m.sender ${x.summaries ? 'LEFT JOIN summaries su ON su.ROWID = m.summary' : ''}
      WHERE m.conversation_id = ${Number(row.conv)} AND m.deleted = 0 ORDER BY m.date_received DESC LIMIT 15`) : []
    const split = body ? splitQuoted(body.text) : { latest: null, quoted: null }
    return {
      id: n,
      file,
      partial: !!file && file.endsWith('.partial.emlx'),
      from: body?.from || null,
      to: body?.to || null,
      cc: body?.cc || null,
      replyTo: body?.replyTo || null,
      date: body?.date || null,
      subject: body?.subject || null,
      latest: split.latest ? split.latest.slice(0, 20000) : null,
      quoted: split.quoted ? split.quoted.slice(0, 20000) : null,
      attachments: body?.attachments || [],
      inlineImages: body?.inlineImages || 0,
      thread: thread.map((t) => ({ id: t.id, from: t.name || t.address, mine: !!t.mine, received: toISO(t.received), snippet: (t.summary || '').replace(/\s+/g, ' ').slice(0, 140) })),
    }
  }
  // Mail about a meeting that came with files: the invite, a deck sent before, the follow-up
  // after. Its subject says the meeting's name (after RE:, FW:, Invitation: and the like), from
  // three days before it to two weeks after. Each file says where Mail keeps it, when Mail has
  // downloaded it.
  get.related = async ({ title, start } = {}) => {
    if (!idx?.file) idx = findIndex()
    if (idx.error) return { available: false, reason: idx.error, messages: [] }
    const words = (x) => (String(x || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2 && !/^(re|fw|fwd|the|and|for|with|meeting|call|sync|invitation|updated|accepted|declined|tentative)$/.test(w))
    const want = words(title)
    if (!want.length) return { available: true, messages: [] }
    const t = Math.floor(Date.parse(start) / 1000) || Math.floor(Date.now() / 1000)
    const x = parts(await shapeOf(idx.file))
    const rows = await sql(idx.file, `
      SELECT m.ROWID AS id, m.date_received AS received, s.subject, a.address, a.comment AS name, mb.url AS mailbox, ${x.col('g', 'message_id_header', 'mid')}
      FROM messages m JOIN mailboxes mb ON mb.ROWID = m.mailbox LEFT JOIN subjects s ON s.ROWID = m.subject LEFT JOIN addresses a ON a.ROWID = m.sender
      ${x.g ? 'LEFT JOIN message_global_data g ON g.ROWID = m.global_message_id' : ''}
      WHERE m.deleted = 0 AND m.date_received BETWEEN ${t - 3 * 86400} AND ${t + 14 * 86400}
        AND EXISTS (SELECT 1 FROM attachments x WHERE x.message = m.ROWID)
      ORDER BY m.date_received DESC LIMIT 400`)
    const out = []
    const seen = new Set()
    for (const r of rows) {
      const have = new Set(words(r.subject))
      if (want.filter((w) => have.has(w)).length / want.length < 0.6) continue
      const key = r.mid || `${r.subject}|${r.received}`
      if (seen.has(key)) continue
      seen.add(key)
      const files = await sql(idx.file, `SELECT attachment_id AS aid, name FROM attachments WHERE message = ${Number(r.id)} LIMIT 20`)
      const kept = files.filter((f) => f.name && !/^image\d{3}\.(png|jpe?g|gif)$/i.test(f.name) && !/\.(ics|vcf)$/i.test(f.name))
      if (!kept.length) continue
      out.push({
        id: r.id, subject: r.subject || '(no subject)', from: r.name || (r.address || '').split('@')[0] || '', received: toISO(r.received), mid: r.mid || null,
        files: kept.map((f) => { const file = attachmentPath(idx.root, r.mailbox, r.id, f.aid, f.name); return { name: f.name, path: file, have: !!file } }),
      })
      if (out.length >= 8) break
    }
    return { available: true, messages: out }
  }
  // What you wrote yourself in mail you sent, newest first: [{ id, to, subject, sent, text }], for How
  // You Write (mailassist.js). to: only what went to that address. Each message's own words, without
  // what it quotes or its signature; invitations' answers and out-of-office replies left out.
  get.sent = async ({ days = 120, limit = 40, to = null } = {}) => {
    if (process.platform !== 'darwin') return { available: false, reason: 'notMac', items: [] }
    if (!idx?.file) idx = findIndex()
    if (idx.error) return { available: false, reason: idx.error, items: [] }
    const since = Math.floor(Date.now() / 1000) - days * 86400
    const only = to ? `AND EXISTS (SELECT 1 FROM recipients r JOIN addresses ra ON ra.ROWID = r.address WHERE r.message = m.ROWID AND lower(ra.address) = ${q(String(to).toLowerCase())})` : ''
    const rows = await sql(idx.file, `
      SELECT m.ROWID AS id, m.date_sent AS sent, mb.url AS mailbox, s.subject,
             (SELECT group_concat(lower(ra.address), ',') FROM recipients r JOIN addresses ra ON ra.ROWID = r.address WHERE r.message = m.ROWID AND r.type = 0) AS toAddr
      FROM messages m JOIN mailboxes mb ON mb.ROWID = m.mailbox LEFT JOIN subjects s ON s.ROWID = m.subject
      WHERE ${SENT} AND m.deleted = 0 AND m.date_sent >= ${since} ${only}
      ORDER BY m.date_sent DESC LIMIT ${Math.min(400, limit * 3)}`)
    const items = []
    for (const r of rows) {
      if (/^(accepted|declined|tentative|canceled|cancelled|automatic reply|out of office)\b/i.test(r.subject || '')) continue
      const file = emlxPath(idx.root, r.mailbox, r.id)
      if (!file) continue
      let text = ''
      try { text = ownWords(readEmlx(file).text) } catch { continue }
      if (text.length < 15) continue
      items.push({ id: r.id, to: String(r.toAddr || '').split(',')[0] || null, subject: r.subject || '', sent: toISO(r.sent), text: text.slice(0, 1500) })
      if (items.length >= limit) break
    }
    return { available: true, items }
  }

  // New mail as soon as Mail's index changes on disk, rather than at the next look: fn() is called
  // a moment after Mail writes it (its main file or its write-ahead log; not the shared-memory file,
  // which reading touches too). Watched only while someone listens. Returns a function to stop.
  const listeners = new Set()
  let watcher = null
  let soon = null
  let fired = 0
  const fire = () => {
    fired = Date.now()
    at = 0
    bodies.clear()
    for (const fn of listeners) { try { fn() } catch { /* a listener gone */ } }
  }
  const watch = () => {
    if (watcher || process.platform !== 'darwin') return
    if (!idx?.file) idx = findIndex()
    if (idx.error) return
    try {
      watcher = fs.watch(path.dirname(idx.file), (_ev, name) => {
        if (name && !/^Envelope Index(-wal)?$/.test(String(name))) return
        clearTimeout(soon)
        // Mail writes in bursts: once it's quiet a moment, and at most every few seconds.
        soon = setTimeout(fire, Math.max(800, 3000 - (Date.now() - fired)))
      })
      watcher.on('error', () => { watcher?.close(); watcher = null })
    } catch { watcher = null }
  }
  get.watch = (fn) => {
    listeners.add(fn)
    watch()
    return () => {
      listeners.delete(fn)
      if (!listeners.size) { clearTimeout(soon); watcher?.close(); watcher = null }
    }
  }
  get.watching = () => !!watcher
  get.invalidate = () => { at = 0 }
  return get
}
