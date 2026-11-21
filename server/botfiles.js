// Files a bot makes (Bots, a beta feature: frontdesk.js). Each run gets an outbox of its own, an
// empty folder of the desk's (front-desk/outbox/<question>-<run>/), and the agent that answers can
// put a file there and nowhere else, through a save_file tool that only writes there: Claude Code's
// is an MCP server of Bridge AI's own (outboxmcp.js, given to its run by botmcp.js), so it's never
// given a tool that writes files; a model's is Bridge AI's (botanswer.js). Its access to your folders
// stays what it was (read-only, or its own copy of a repository for a change). Codex's read-only
// sandbox calls no tool of ours, so a run of Codex has none.
//
// A file that's in the bot's folders already (a PDF, a Word document, a picture) goes as it is: the
// agent attaches it (attach_file, or a line ATTACH: <path> after its answer where its brief offers
// that), and it's copied into the outbox here once the answer is in (collect), checked first as
// botattach.js says (in the folders its run reads with no link on the way, nothing hidden or that
// holds keys, a document or a picture unless you let it send data and config files, not too big),
// against those folders as Bridge AI has them now. What the agent's tool said is a convenience: this
// is the gate. (Whether its answer then waits for you: frontdesk.js.)
//
// Once its answer is in, what's in the outbox is looked at (collect): plain files only, at the top
// of it, as many as MAX and none bigger than EACH, of a kind on the list (botattach.js TYPES:
// pictures, PDFs, tables, text, documents; nothing that runs), and never a link (which could point
// anywhere), a folder, or anything that runs by its first bytes or its mode, nor a name with
// characters that hide what it is (right-to-left marks and the like). Each one taken is kept beside
// the bot's record (bots/<id>/trace/files/<month>/<question>-<run>/, readable by you only, gone with
// its month: trace.js), marked on a Mac as from elsewhere (com.apple.quarantine, as a download is),
// and each refused is named with why, in the record and in the reply (one attached, with where it
// came from). Then it goes with the answer as the platform takes files (attachPlan): Slack's upload
// API, Discord's
// attachments, and in Microsoft Teams, which has no way for a bot to attach a file to a reply in a
// channel or a chat (only a one-to-one consent card that puts it in the person's OneDrive, not used
// here), the reply says so and where it is.
//
// In Bridge AI, the bot's Activity lists them with Open and Send to… (transfers.js), through the
// file routes' root botfiles:<bot> (index.js rootOf), which only reads. Open opens in its app only
// what can't run anything when it's opened (OPENS); the rest are shown in Finder instead.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { dataFile } from './paths.js'
import { isLockFile } from '../shared/lockfile.js'
import { DIR as BOTS } from './bots.js'
import { TYPES, KINDS, MAX, EACH, TOTAL, extOf, isProgram, notAKind, safe, sizeOf, readChecked, attachedIn, nameOf, keptOut, secretIn, dropManifest, carryManifest } from './botattach.js'

// (The kinds that go, how many and how big, and a name made safe: botattach.js, which the outbox's
// MCP server shares.)
export { KINDS, MAX, EACH, safe, sizeOf }
export const OUTBOX = dataFile('front-desk', 'outbox')
const ID = /^b\d{1,4}$/
const RUN = /^[\w-]{1,80}$/
// Of the kinds that go, what's opened in its app from Bridge AI: what can't run anything as it
// opens (a page, a drawing or XML could, in a browser).
const OPENS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'csv', 'tsv', 'md', 'txt', 'json', 'yaml', 'yml', 'xlsx', 'docx', 'pptx'])
export const opensSafely = (name) => OPENS.has(extOf(path.basename(String(name))))
export const typeOf = (name) => TYPES[extOf(name)] || 'application/octet-stream'

// A run's outbox, made empty (only you can read it). key: the question's id and the run's number.
// (What a run attached is noted beside it, never in it: botattach.js manifestOf.)
export function outboxFor(key) {
  const d = path.join(OUTBOX, safe(key))
  fs.rmSync(d, { recursive: true, force: true })
  dropManifest(d)
  fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  return d
}
export const outboxOf = (key) => path.join(OUTBOX, safe(key))
export const drop = (key) => { try { fs.rmSync(outboxOf(key), { recursive: true, force: true }) } catch { /* in use: next time */ } dropManifest(outboxOf(key)) }
// A run that picks up where an earlier one was stopped (at its time limit: frontdesk.js): what that
// one saved goes on in this one's outbox, as if saved there, and what it attached with it, so they go
// with this answer and count toward this run's limits, and are checked as every file is when they're
// collected. Plain files only; the earlier outbox goes. How many came.
export function carry(fromKey, to) {
  const from = outboxOf(fromKey)
  carryManifest(from, to)
  let names = []
  try { names = fs.readdirSync(from) } catch { return 0 }
  let n = 0
  for (const name of names) {
    try {
      if (!fs.lstatSync(path.join(from, name)).isFile() || fs.existsSync(path.join(to, name))) continue
      fs.renameSync(path.join(from, name), path.join(to, name))
      n++
    } catch { /* left behind, and gone with it */ }
  }
  drop(fromKey)
  return n
}

// Whether a file is something that may not go: a kind not on the list, or something that runs by its
// first bytes or (not on Windows) its mode.
export async function runs(p, name, mode = 0) {
  if (!TYPES[extOf(name)]) return notAKind(name)
  if (process.platform !== 'win32' && (mode & 0o111)) return 'it can be run as a program, which a bot doesn\'t send'
  let head = Buffer.alloc(0)
  try { const fh = await fs.promises.open(p, 'r'); try { const b = Buffer.alloc(8); const { bytesRead } = await fh.read(b, 0, 8, 0); head = b.subarray(0, bytesRead) } finally { await fh.close() } } catch { /* unreadable: said below */ }
  if (isProgram(head)) return 'it\'s a program or a script, which a bot doesn\'t send'
  return null
}

// The files attached from the bot's folders (its agent's attach_file, noted beside the outbox, and the
// ATTACH: lines of its answer: attach), each checked again here against the folders its run reads
// (botattach.js readChecked) and copied in from the file as it was read, made new (never through a
// link, never over a file there): by its name in the outbox, where it came from (~/…). None is read
// once as many as go are in, nor one bigger than what's left of all an answer sends. One that can't
// go is in refused, with why (and where it was asked from, for the record).
const refuse = (why) => Object.assign(new Error(why), { refused: true })
async function bringIn(dir, root, { attach = [], folders = [], cwd = null, config = false }, refused) {
  const from = new Map()
  const asked = [...attachedIn(dir), ...attach.slice(0, MAX * 2).map((p) => ({ path: String(p) }))]
  if (!asked.length) return from
  const paths = new Set()
  const taken = new Set()
  const kept = keptOut()
  const NEW = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0)
  const there = async () => {
    const names = (await fs.promises.readdir(root)).filter((n) => !n.startsWith('.'))
    const sizes = await Promise.all(names.map((n) => fs.promises.lstat(path.join(root, n)).then((x) => x.size, () => 0)))
    return { n: names.length, bytes: sizes.reduce((a, b) => a + b, 0) }
  }
  for (const a of asked) {
    if (paths.has(a.path)) continue
    paths.add(a.path)
    const said = String(a.path).slice(0, 300)
    if (a.refused) { refused.push({ name: a.name || nameOf(a.path), why: String(a.refused).slice(0, 300), from: said }); continue }
    try {
      const now = await there()
      if (now.n >= MAX) throw refuse(`a bot sends ${MAX} files with an answer at most`)
      const got = await readChecked(a.path, { folders, cwd, keptOut: kept, config, budget: TOTAL - now.bytes })
      if (taken.has(got.file)) continue // (the same file, asked for by another path)
      taken.add(got.file)
      const to = path.join(root, got.name)
      let fh
      try { fh = await fs.promises.open(to, NEW, 0o600) } catch (e) { throw refuse(e.code === 'EEXIST' ? `a file called ${got.name} is with the answer already` : `it couldn't be copied (${e.code || e.message})`) }
      // (One not copied whole doesn't stay to be sent in part.)
      try { await fh.writeFile(got.body) } catch (e) { await fh.close().catch(() => {}); await fs.promises.rm(to, { force: true }).catch(() => {}); throw refuse(`it couldn't be copied (${e.code || e.message})`) }
      await fh.close()
      from.set(got.name, got.from)
    } catch (e) { refused.push({ name: nameOf(a.path), why: e.refused ? e.message : `it couldn't be read (${e.code || e.message})`, from: said }) }
  }
  return from
}

// What a run left in its outbox: { files: [{ name, size, path, type, from }], refused: [{ name, why,
// from }] } (from: where a file attached came from). Only what's really in it: its real path is
// checked against the outbox's, so nothing outside it, however it's named, is taken; and nothing in
// it that looks like a key, a password or a token, whether it was attached or the agent made it
// (botattach.js secretIn: a key it read can't go as a file it "made"). attach: the paths its answer's
// ATTACH: lines name; folders: the ones its run reads (their paths, as Settings has them), the only
// ones a file may be attached from; cwd: its run's folder, where a relative path starts; config:
// data and config files may be attached too.
export async function collect(dir, { attach = [], folders = [], cwd = null, config = false } = {}) {
  const files = []
  const refused = []
  let root
  try { root = await fs.promises.realpath(dir) } catch { return { files, refused } }
  const from = await bringIn(dir, root, { attach, folders, cwd, config }, refused)
  let ents = []
  try { ents = await fs.promises.readdir(root, { withFileTypes: true }) } catch { return { files, refused } }
  ents.sort((a, b) => a.name.localeCompare(b.name))
  for (const e of ents) {
    const name = e.name
    if (name.startsWith('.') || isLockFile(name)) continue
    const p = path.join(root, name)
    const st = await fs.promises.lstat(p).catch(() => null)
    if (!st) continue
    if (st.isSymbolicLink()) { refused.push({ name, why: 'it\'s a link to somewhere else, and only files made in its outbox go' }); continue }
    if (st.isDirectory()) { refused.push({ name, why: 'it\'s a folder: only files go' }); continue }
    if (!st.isFile()) { refused.push({ name, why: 'it isn\'t a file' }); continue }
    const real = await fs.promises.realpath(p).catch(() => null)
    if (!real || path.dirname(real) !== root) { refused.push({ name, why: 'it isn\'t in its outbox' }); continue }
    if (safe(name) !== name) { refused.push({ name: safe(name) || 'file', why: 'its name has characters a file can\'t have everywhere' }); continue }
    const exe = await runs(real, name, st.mode)
    if (exe) { refused.push({ name, why: exe }); continue }
    if (st.size === 0) { refused.push({ name, why: 'it\'s empty' }); continue }
    if (st.size > EACH) { refused.push({ name, why: `it's ${sizeOf(st.size)}, over ${sizeOf(EACH)}` }); continue }
    if (files.length >= MAX) { refused.push({ name, why: `a bot sends ${MAX} files with an answer at most` }); continue }
    // (One attached was looked through as it was read; one it made, here.)
    if (!from.has(name)) {
      const holds = await fs.promises.readFile(real).then((b) => secretIn(b, name)).catch((e) => (e.refused ? e.message : 'it couldn\'t be read'))
      if (holds) { refused.push({ name, why: holds }); continue }
    }
    files.push({ name, size: st.size, path: real, type: typeOf(name), ...(from.has(name) ? { from: from.get(name) } : {}) })
  }
  for (const r of refused) if (!r.from && from.has(r.name)) r.from = from.get(r.name)
  return { files, refused }
}

// ---------- Kept beside its record ----------
export const filesDir = (bot) => (ID.test(String(bot)) ? path.join(BOTS, bot, 'trace', 'files') : null)
// Each file taken, copied beside the record: its path there (<month>/<question>-<run>/<name>).
export async function keep(bot, run, files) {
  const top = filesDir(bot)
  if (!top || !RUN.test(String(run))) return files.map(() => null)
  const month = new Date().toISOString().slice(0, 7)
  const d = path.join(top, month, run)
  await fs.promises.mkdir(d, { recursive: true, mode: 0o700 })
  const out = []
  for (const f of files) {
    try {
      const to = path.join(d, f.name)
      await fs.promises.copyFile(f.path, to)
      await fs.promises.chmod(to, 0o600).catch(() => {})
      await quarantine(to)
      out.push(`${month}/${run}/${f.name}`)
    } catch { out.push(null) }
  }
  return out
}
// On a Mac, marked as from elsewhere, as a download is (Gatekeeper asks before anything in it runs).
const quarantine = (file) => (process.platform !== 'darwin' ? Promise.resolve() : new Promise((resolve) => execFile('xattr', ['-w', 'com.apple.quarantine', `0081;${Math.floor(Date.now() / 1000).toString(16)};Bridge AI;`, file], { timeout: 5000 }, () => resolve())))
// The files it made, newest first, as they're kept (gone with their month): [{ path, name, size, at, q }].
export async function list(bot, n = 200) {
  const top = filesDir(bot)
  const out = []
  if (!top) return out
  const months = (await fs.promises.readdir(top).catch(() => [])).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse()
  for (const m of months) {
    const runsIn = (await fs.promises.readdir(path.join(top, m)).catch(() => [])).filter((r) => RUN.test(r))
    for (const r of runsIn) {
      for (const name of await fs.promises.readdir(path.join(top, m, r)).catch(() => [])) {
        const st = await fs.promises.stat(path.join(top, m, r, name)).catch(() => null)
        if (st?.isFile()) out.push({ path: `${m}/${r}/${name}`, name, size: st.size, at: st.mtime.toISOString(), q: r.replace(/-\d+$/, '') })
      }
    }
    if (out.length >= n) break
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, n)
}

// ---------- To the platform ----------
// What each takes with a reply: Slack, files of up to 1 GB, 10 a message; Discord, 10 attachments,
// 10 MB each for a bot in a server with no boost; Microsoft Teams, none.
export const LIMITS = {
  slack: { count: 10, each: 1024 * 1024 * 1024 },
  discord: { count: 10, each: 10 * 1024 * 1024 },
  teams: { count: 0, each: 0 },
}
const PLACE = { slack: 'Slack', discord: 'Discord', teams: 'Microsoft Teams' }
// Which of an answer's files go with it there, and what's said in the reply about the rest:
// { attach: [file], notes: ['report.pdf (2.1 MB) …'], failed: [{ name, size, error }] }. where: who
// has it, and where (you, on this computer, in the bot's Activity), or what says so for that many.
export function attachPlan(platform, files, { where = '' } = {}) {
  const l = LIMITS[platform] || LIMITS.slack
  const attach = []
  const failed = []
  for (const f of files) {
    const size = f.size ?? f.content?.length ?? 0
    if (!l.count) failed.push({ name: f.name, size, error: `${PLACE[platform]} doesn't let a bot attach a file to a reply` })
    else if (size > l.each) failed.push({ name: f.name, size, error: `it's ${sizeOf(size)}, over the ${sizeOf(l.each)} ${PLACE[platform]} takes from a bot` })
    else if (attach.length >= l.count) failed.push({ name: f.name, size, error: `${PLACE[platform]} takes ${l.count} files with a message at most` })
    else attach.push(f)
  }
  return { attach, failed, notes: failed.length ? [noteOf(failed, typeof where === 'function' ? where(failed.length) : where)] : [] }
}
// The words the reply carries for files that couldn't go with it.
export function noteOf(failed, where = '') {
  const names = failed.map((f) => `${f.name}${f.size ? ` (${sizeOf(f.size)})` : ''}`).join(', ')
  const why = [...new Set(failed.map((f) => f.error).filter(Boolean))].join('; ')
  return `${failed.length === 1 ? `I couldn't attach ${names}` : `I couldn't attach these files: ${names}`}${why ? ` (${why})` : ''}.${where ? ` ${where}` : ''}`
}
