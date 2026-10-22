// Mail from the Mac Mail app's local index ("Envelope Index", SQLite), opened read-only.
// Mail syncs the Exchange account; nothing here talks to a mail server.
// Needs Full Disk Access for the app that starts Bridge AI (macOS protects ~/Library/Mail).
//
// Each inbox message gets a score from signals already on disk: Apple's category (Primary,
// Transactions, Updates, Promotions) and "high impact" flag, whether it was sent to you or only
// cc'd, whether you write to the sender, whether you're in the thread and already replied, and
// urgency words. Your own "always important" / "mute" rules live in ~/.bridge-ai/cache/mail-rules.json.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { cacheFile } from './paths.js'
import { readEmlx, splitQuoted, summaryText } from './mailparse.js'

const MAIL = path.join(os.homedir(), 'Library', 'Mail')
const RULES = cacheFile('mail-rules.json')

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
  fs.writeFileSync(RULES, JSON.stringify(r, null, 2))
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
    const ppl = await contacts(file)
    const meList = ppl.me.map(q).join(',') || "''"
    const since = Math.floor(Date.now() / 1000) - 10 * 86400
    const today = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
    const [[counts], rows, waiting] = await Promise.all([
      sql(file, `SELECT SUM(m.read = 0) AS unread, SUM(m.flagged = 1) AS flagged, SUM(m.date_received >= ${today}) AS today
        FROM messages m WHERE m.deleted = 0 AND ${INBOX}`),
      sql(file, `
        SELECT m.ROWID AS id, m.read, m.flagged, m.date_received AS received, m.conversation_id AS conv, m.automated_conversation AS automated,
               a.address, a.comment AS name, s.subject, su.summary, g.model_category AS category, g.model_high_impact AS highImpact,
               g.message_id_header AS mid, hex(gs.summary) AS ai, mb.url AS mailbox,
               (SELECT min(r.type) FROM recipients r JOIN addresses ra ON ra.ROWID = r.address WHERE r.message = m.ROWID AND lower(ra.address) IN (${meList})) AS toMe,
               (SELECT count(*) FROM recipients r WHERE r.message = m.ROWID) AS recipients,
               EXISTS (SELECT 1 FROM messages x WHERE x.conversation_id = m.conversation_id AND m.conversation_id != 0 AND x.mailbox IN (SELECT ROWID FROM mailboxes WHERE url LIKE '%/Sent%' OR url LIKE '%/SENT')) AS myThread,
               EXISTS (SELECT 1 FROM messages x WHERE x.conversation_id = m.conversation_id AND m.conversation_id != 0 AND x.date_sent > m.date_received AND x.mailbox IN (SELECT ROWID FROM mailboxes WHERE url LIKE '%/Sent%' OR url LIKE '%/SENT')) AS replied
        FROM messages m
        JOIN mailboxes mb ON mb.ROWID = m.mailbox
        LEFT JOIN addresses a ON a.ROWID = m.sender
        LEFT JOIN subjects s ON s.ROWID = m.subject
        LEFT JOIN summaries su ON su.ROWID = m.summary
        LEFT JOIN message_global_data g ON g.ROWID = m.global_message_id
        LEFT JOIN generated_summaries gs ON gs.ROWID = g.generated_summary
        WHERE m.deleted = 0 AND ${INBOX} AND (m.date_received >= ${since} OR m.flagged = 1)
        ORDER BY m.date_received DESC LIMIT 500`),
      // Things you sent in the last 10 days where nobody has replied since.
      sql(file, `
        SELECT m.ROWID AS id, m.date_sent AS sent, s.subject, m.conversation_id AS conv,
               (SELECT group_concat(coalesce(ra.comment, ra.address), ', ') FROM recipients r JOIN addresses ra ON ra.ROWID = r.address WHERE r.message = m.ROWID AND r.type = 0) AS toNames
        FROM messages m LEFT JOIN subjects s ON s.ROWID = m.subject
        WHERE ${SENT} AND m.deleted = 0 AND m.date_sent >= ${since} AND m.conversation_id != 0
          AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.conversation_id = m.conversation_id AND x.date_received > m.date_sent AND ${INBOX.replace(/m\.mailbox/g, 'x.mailbox')})
          AND NOT EXISTS (SELECT 1 FROM messages y WHERE y.conversation_id = m.conversation_id AND y.date_sent > m.date_sent AND ${SENT.replace(/m\.mailbox/g, 'y.mailbox')})
        ORDER BY m.date_sent DESC LIMIT 40`),
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
    const needs = messages.filter((m) => m.bucket === 'needs').sort((a, b) => b.score - a.score)
    return {
      available: true,
      unread: counts?.unread || 0,
      flagged: counts?.flagged || 0,
      today: counts?.today || 0,
      needs: needs.length,
      action: messages.filter((m) => m.bucket === 'action').length,
      messages,
      waiting: waiting.filter((w) => !/^(accepted|declined|tentative|canceled|cancelled|automatic reply|out of office)\b/i.test(w.subject || '') && w.toNames).map((w) => ({ id: w.id, subject: w.subject || '(no subject)', to: w.toNames || '', sent: toISO(w.sent) })),
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
  get.message = async (id) => {
    if (!idx?.file) idx = findIndex()
    if (idx.error) throw new Error(SETUP[idx.error])
    const n = Number(id)
    if (!Number.isInteger(n)) throw new Error('Bad message id')
    const [row] = await sql(idx.file, `SELECT m.ROWID AS id, m.conversation_id AS conv, mb.url AS mailbox FROM messages m JOIN mailboxes mb ON mb.ROWID = m.mailbox WHERE m.ROWID = ${n}`)
    if (!row) throw new Error('Message not found')
    const file = emlxPath(idx.root, row.mailbox, n)
    let body = null
    if (file) { try { body = readEmlx(file) } catch { /* fall back to the index summary */ } }
    const thread = row.conv ? await sql(idx.file, `
      SELECT m.ROWID AS id, m.date_received AS received, a.address, a.comment AS name, su.summary,
             (m.mailbox IN (SELECT ROWID FROM mailboxes WHERE url LIKE '%/Sent%' OR url LIKE '%/SENT')) AS mine
      FROM messages m LEFT JOIN addresses a ON a.ROWID = m.sender LEFT JOIN summaries su ON su.ROWID = m.summary
      WHERE m.conversation_id = ${Number(row.conv)} AND m.deleted = 0 ORDER BY m.date_received DESC LIMIT 15`) : []
    const split = body ? splitQuoted(body.text) : { latest: null, quoted: null }
    return {
      id: n,
      file,
      partial: !!file && file.endsWith('.partial.emlx'),
      from: body?.from || null,
      to: body?.to || null,
      cc: body?.cc || null,
      subject: body?.subject || null,
      latest: split.latest ? split.latest.slice(0, 20000) : null,
      quoted: split.quoted ? split.quoted.slice(0, 20000) : null,
      attachments: body?.attachments || [],
      inlineImages: body?.inlineImages || 0,
      thread: thread.map((t) => ({ id: t.id, from: t.name || t.address, mine: !!t.mine, received: toISO(t.received), snippet: (t.summary || '').replace(/\s+/g, ' ').slice(0, 140) })),
    }
  }
  get.invalidate = () => { at = 0 }
  return get
}
