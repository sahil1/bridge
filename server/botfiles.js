// Files a bot makes (Bots, a beta feature: frontdesk.js). Each run gets an outbox of its own, an
// empty folder of the desk's (front-desk/outbox/<question>-<run>/), and the agent that answers can
// put a file there and nowhere else, through a save_file tool that only writes there: Claude Code's
// is an MCP server of Bridge AI's own (outboxmcp.js, given to its run by botmcp.js), so it's never
// given a tool that writes files; a model's is Bridge AI's (botanswer.js). Its access to your folders
// stays what it was (read-only, or its own copy of a repository for a change). Codex's read-only
// sandbox calls no tool of ours, so a run of Codex has none.
//
// Once its answer is in, what's in the outbox is looked at (collect): plain files only, at the top
// of it, as many as MAX and none bigger than EACH, of a kind on the list below (KINDS: pictures,
// PDFs, tables, text, documents; nothing that runs), and never a link (which could point anywhere),
// a folder, or anything that runs by its first bytes or its mode, nor a name with characters that
// hide what it is (right-to-left marks and the like). Each one taken is kept beside the bot's record
// (bots/<id>/trace/files/<month>/<question>-<run>/, readable by you only, gone with its month:
// trace.js), marked on a Mac as from elsewhere (com.apple.quarantine, as a download is), and each
// refused is named with why, in the record and in the reply. Then it
// goes with the answer as the platform takes files (attachPlan): Slack's upload API, Discord's
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
import { DIR as BOTS } from './bots.js'

export const OUTBOX = dataFile('front-desk', 'outbox')
export const MAX = 5 // files a run sends back, at most
export const EACH = 25 * 1024 * 1024 // each at most
const ID = /^b\d{1,4}$/
const RUN = /^[\w-]{1,80}$/
// The kinds of file a bot may send, by their name, and what each is: pictures, PDFs, tables, text,
// and Office documents without macros. Anything else (a program, a script, a disk image, a link
// file, an archive) isn't sent.
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', txt: 'text/plain', json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', html: 'text/html', xml: 'application/xml', mmd: 'text/plain', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
const extOf = (name) => path.extname(String(name)).slice(1).toLowerCase()
export const KINDS = Object.keys(TYPES)
// Of those, what's opened in its app from Bridge AI: what can't run anything as it opens (a page, a
// drawing or XML could, in a browser).
const OPENS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'csv', 'tsv', 'md', 'txt', 'json', 'yaml', 'yml', 'xlsx', 'docx', 'pptx'])
export const opensSafely = (name) => OPENS.has(extOf(path.basename(String(name))))
// And by its first bytes: a Windows program (MZ), Linux's (ELF), a Mac's (Mach-O, either order, and
// universal), and a script (#!), whatever it's called.
const MAGIC = [Buffer.from('MZ'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from([0xfe, 0xed, 0xfa, 0xce]), Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), Buffer.from([0xce, 0xfa, 0xed, 0xfe]), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.from('#!')]
// (Format characters, \p{Cf}, go too: a right-to-left mark makes "fdp.exe" look like "exe.pdf".)
export const safe = (s) => String(s || '').replace(/\p{Cf}/gu, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 120) // eslint-disable-line no-control-regex
export const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`)
export const typeOf = (name) => TYPES[extOf(name)] || 'application/octet-stream'

// A run's outbox, made empty (only you can read it). key: the question's id and the run's number.
export function outboxFor(key) {
  const d = path.join(OUTBOX, safe(key))
  fs.rmSync(d, { recursive: true, force: true })
  fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  return d
}
export const outboxOf = (key) => path.join(OUTBOX, safe(key))
export const drop = (key) => { try { fs.rmSync(outboxOf(key), { recursive: true, force: true }) } catch { /* in use: next time */ } }

// Whether a file is something that may not go: a kind not on the list, or something that runs by its
// first bytes or (not on Windows) its mode.
export async function runs(p, name, mode = 0) {
  if (!TYPES[extOf(name)]) return `${extOf(name) ? `a .${extOf(name)} file` : 'a file with no kind in its name'} isn't one a bot sends (only pictures, PDFs, tables, text and documents)`
  if (process.platform !== 'win32' && (mode & 0o111)) return 'it can be run as a program, which a bot doesn\'t send'
  let head = Buffer.alloc(0)
  try { const fh = await fs.promises.open(p, 'r'); try { const b = Buffer.alloc(8); const { bytesRead } = await fh.read(b, 0, 8, 0); head = b.subarray(0, bytesRead) } finally { await fh.close() } } catch { /* unreadable: said below */ }
  if (MAGIC.some((m) => head.length >= m.length && head.subarray(0, m.length).equals(m))) return 'it\'s a program or a script, which a bot doesn\'t send'
  return null
}

// What a run left in its outbox: { files: [{ name, size, path, type }], refused: [{ name, why }] }.
// Only what's really in it: its real path is checked against the outbox's, so nothing outside it,
// however it's named, is taken.
export async function collect(dir) {
  const files = []
  const refused = []
  let root
  try { root = await fs.promises.realpath(dir) } catch { return { files, refused } }
  let ents = []
  try { ents = await fs.promises.readdir(root, { withFileTypes: true }) } catch { return { files, refused } }
  ents.sort((a, b) => a.name.localeCompare(b.name))
  for (const e of ents) {
    const name = e.name
    if (name.startsWith('.')) continue
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
    files.push({ name, size: st.size, path: real, type: typeOf(name) })
  }
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
// has it, and where (you, on this computer, in the bot's Activity).
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
  return { attach, failed, notes: failed.length ? [noteOf(failed, where)] : [] }
}
// The words the reply carries for files that couldn't go with it.
export function noteOf(failed, where = '') {
  const names = failed.map((f) => `${f.name}${f.size ? ` (${sizeOf(f.size)})` : ''}`).join(', ')
  const why = [...new Set(failed.map((f) => f.error).filter(Boolean))].join('; ')
  return `${failed.length === 1 ? `I couldn't attach ${names}` : `I couldn't attach these files: ${names}`}${why ? ` (${why})` : ''}.${where ? ` ${where}` : ''}`
}
