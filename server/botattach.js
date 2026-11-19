// A file already in a bot's folders, sent back with its answer as it is (Bots, a beta feature:
// frontdesk.js, botfiles.js): a PDF, a Word document, a picture. The agent that answers names it (its
// attach_file tool: outboxmcp.js for Claude Code, botanswer.js for a model; or, where its brief offers
// it, a line ATTACH: <path> after its answer), and Bridge AI copies it into the run's outbox once the
// answer is in (botfiles.js collect, the one place a file's bytes are taken from your folders). The
// tool only checks it and notes it (manifestOf: beside the outbox, never in it), so the agent hears at
// once why one can't go; collect checks everything again, against the folders the run reads as
// Bridge AI has them, and is what decides. Whether an answer with one goes without asking is
// frontdesk.js's (Send Files From Its Folders Without Asking): by default it waits for you.
//
// A file goes only when:
//   - its path, from the folder down, is in one of the folders the run reads (readsFrom), with no link
//     anywhere on the way out of that folder (a link, a folder that's a link, a Windows junction), and
//     it's a plain file there (not a link, a folder, a device or a pipe);
//   - the folder itself isn't where settings and keys are kept (a hidden folder, ~/Library but for
//     iCloud Drive and cloud storage, AppData: rootSays);
//   - neither it nor a folder on the way is hidden (a name that starts with a dot; on Windows, marked
//     hidden or system), nor has a name that says it holds keys, passwords or credentials (SECRET),
//     nor is in a folder that holds them (keptOut: Bridge AI's own, ~/.ssh, ~/.aws and the like);
//   - it's a document or a picture (DOCS: PDFs, Word, Excel and PowerPoint files, pictures, CSV,
//     text, Markdown), or, only when you let it, a data or config file (JSON, YAML, XML, HTML);
//   - it isn't a program or a script by its first bytes, and has nothing in it that looks like a key,
//     a password or a token (secretIn: a private key, as text or in base64, in any encoding; the
//     tokens mcp.js redacts; KEY=value and "password": "…"; a table with a password column);
//   - it isn't empty, nor over EACH, nor more than what's left of TOTAL, nor a hard link.
// And it's read without a gap between the look and the read (TOCTOU): opened without following a
// link (O_NOFOLLOW) or waiting on a pipe (O_NONBLOCK), the file opened is the one looked at (its
// device and inode), the way to it is looked at again once it's open and still leads to that same
// file (its real path inside the folder, whose names are looked at again too), and its size is the
// opened file's, read to its end and no further. What's sent is what was read from that open file.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const MAX = 5 // files a run sends back, at most
export const EACH = 25 * 1024 * 1024 // each at most
export const TOTAL = MAX * EACH // and all told
export const CALLS = 20 // times a run may call attach_file
const SCAN = 4 * 1024 * 1024 // of a file that isn't text, what's looked through for keys and tokens
const REFUSALS = 10 // refused files noted for the reply, at most
// The kinds of file a bot may send, by their name, and what each is: pictures, PDFs, tables, text,
// and Office documents without macros. Anything else (a program, a script, a disk image, a link
// file, an archive) isn't sent.
export const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', txt: 'text/plain', json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', html: 'text/html', xml: 'application/xml', mmd: 'text/plain', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
export const KINDS = Object.keys(TYPES)
// Of those, what's attached from a bot's folders: documents and pictures; the rest (data and config
// files, which is where keys and passwords tend to be) only when you let it (attachConfig).
export const DOCS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'csv', 'tsv', 'txt', 'md'])
export const CONFIG = KINDS.filter((k) => !DOCS.has(k))
export const extOf = (name) => path.extname(String(name)).slice(1).toLowerCase()
const TEXT = new Set(['svg', 'csv', 'tsv', 'md', 'txt', 'json', 'yaml', 'yml', 'html', 'xml', 'mmd'])
// A program by its first bytes: a Windows program (MZ), Linux's (ELF), a Mac's (Mach-O, either order,
// and universal), and a script (#!), whatever it's called.
const MAGIC = [Buffer.from('MZ'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from([0xfe, 0xed, 0xfa, 0xce]), Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), Buffer.from([0xce, 0xfa, 0xed, 0xfe]), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.from('#!')]
export const isProgram = (head) => MAGIC.some((m) => head.length >= m.length && head.subarray(0, m.length).equals(m))
export const notAKind = (name) => `${extOf(name) ? `a .${extOf(name)} file` : 'a file with no kind in its name'} isn't one a bot sends (only pictures, PDFs, tables, text and documents)`
export const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`)
// A file's name as it goes: format characters out (a right-to-left mark makes "fdp.exe" look like
// "exe.pdf"), characters a name can't have everywhere, and no dot or space to start it.
export const safe = (s) => String(s || '').replace(/\p{Cf}/gu, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').trim().replace(/^[.\s]+/, '').trim().slice(0, 120) // eslint-disable-line no-control-regex

// ---------- What never goes ----------
// Names that say a file (or a folder on the way to it) holds keys, passwords or credentials: by its
// kind (a key, a certificate's private half, a password manager's file) or its words (secrets.json,
// passwords.xlsx, client_secret.json, id_rsa.txt, logins.csv, a kubeconfig, recovery codes), whatever
// kind of file it is.
const SECRET_KINDS = new Set(['pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'kdbx', 'kdb', 'keychain', 'keychain-db', 'gpg', 'pgp', 'asc', 'ovpn', 'ppk', 'env', '1pux', 'opvault'])
const SECRET_WORDS = /(?:^|[-_. ])(?:secrets?|credentials?|creds|passwords?|passwd|logins|api[-_ ]?keys?|private[-_ ]?keys?|(?:access|auth|refresh|bearer|oauth|bot|api)[-_ ]?tokens?|client[-_ ]?secrets?|service[-_ ]?accounts?|id_(?:rsa|dsa|ecdsa|ed25519)|keychains?|keystores?|vaults?|bitwarden|1password|lastpass|keepass(?:xc)?|(?:recovery|backup)[-_ ]?codes?|kubeconfig|wallets?|seed[-_ ]?(?:phrase|words)|mnemonics?)(?:[-_. ]|$)|^tokens?(?:\.|$)|^auth(?:\.|$)|^\.?env(?:\.|$)/i
export const secretLike = (name) => SECRET_KINDS.has(extOf(name)) || SECRET_WORDS.test(String(name))
// What in a file looks like a key, a password or a token: a private key (PEM, OpenSSH, PGP), or one in
// base64 (a kubeconfig's client-key-data); the tokens mcp.js redacts (GitHub, OpenAI and Anthropic,
// Slack, AWS, Google, GitLab, Sentry, Linear) and a JWT; NAME_PASSWORD=… or POSTGRES_PASSWORD: … as
// config files set them; "password": "…" as JSON has it; a table with a column of passwords.
const LOOKS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/,
  /LS0tLS1CRUdJTi/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|sk-(?:ant-|proj-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}|xox[abeprs]-[A-Za-z0-9-]{10,}|xapp-\d-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|glpat-[A-Za-z0-9_-]{10,}|sntrys_[A-Za-z0-9_]{10,}|lin_api_[A-Za-z0-9]{10,})/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./,
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)[A-Z0-9_]*["']?[ \t]*[:=][ \t]*["']?(?![<$*{[]|your|xxx|changeme|example|placeholder|none\b|null\b|true\b|false\b)[A-Za-z0-9+/_.~@!%-]{6,}/,
  /"(?:password|passwd|passphrase|secret|client_secret|token|access_token|refresh_token|id_token|api_?key|private_key|totp)"[ \t]*:[ \t]*"[^"]{4,}"/i,
]
const PASSWORD_COLUMN = /^[^\n]*?(?:^|[,\t;"])[ \t]*(?:password|passwd|passphrase|secret|token)[ \t]*(?:"|[,\t;]|\r?$)/im
// A file's bytes as text to look through: UTF-16 by its byte order mark (or the zeros between its
// letters), else byte for byte.
function textOf(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))); return b.swap16().toString('utf16le') }
  if (buf.length >= 8 && buf[1] === 0 && buf[3] === 0 && buf[5] === 0 && buf[0] && buf[2]) return buf.toString('utf16le')
  return buf.toString('latin1')
}
// Whether words (an answer, a file as text) look like they hold a key, a password or a token: why, or null.
export function secretInText(s) {
  const t = String(s || '')
  return LOOKS.some((re) => re.test(t)) ? 'it holds what looks like a key, a password or a token' : null
}
// The same of a file's bytes: a text file all through, any other the first few MB of it (a key
// pasted into a PDF shows there); and a table whose first line has a password column.
export function secretIn(buf, name) {
  const text = textOf(TEXT.has(extOf(name)) ? buf : buf.subarray(0, SCAN))
  if (['csv', 'tsv'].includes(extOf(name)) && PASSWORD_COLUMN.test(text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') + 1 : 4096))) return 'it\'s a table with a column of passwords'
  return secretInText(text)
}
// Folders that hold keys, never sent from whatever folder a bot reads: Bridge AI's own (BRIDGE_HOME,
// ~/.bridge-ai) and the ones your keys and sign-ins are kept in (files.js keeps out of the first few too).
export function keptOut() {
  const home = os.homedir()
  const data = path.resolve(process.env.BRIDGE_HOME || path.join(home, '.bridge-ai'))
  return [data, ...['.ssh', '.gnupg', path.join('Library', 'Keychains'), '.aws', '.azure', '.kube', '.docker', path.join('.config', 'gcloud'), '.claude', '.codex', '.netrc'].map((d) => path.join(home, d))]
}

// ---------- Finding it ----------
const FOLD = process.platform === 'darwin' || process.platform === 'win32' // names whose case doesn't count
const cmp = (s) => (FOLD ? s.toLowerCase() : s)
export const within = (p, dir) => { const a = cmp(p); const d = cmp(dir); return a === d || a.startsWith(d.endsWith(path.sep) ? d : d + path.sep) }
// Your home folder, as it's named and as its real path.
let realHome = null
const homes = () => { const home = os.homedir(); if (realHome == null) { try { realHome = fs.realpathSync(home) } catch { realHome = home } } return [home, realHome] }
// A path as it's said (~/… for one in your home folder, as it is or as its real path).
export const shown = (p) => {
  for (const h of homes()) if (p === h || String(p).startsWith(h + path.sep)) return `~${String(p).slice(h.length)}`
  return String(p)
}
const no = (why) => Object.assign(new Error(why), { refused: true })
const BIG = { bigint: true }
const same = (a, b) => a.dev === b.dev && a.ino === b.ino

// Whether a folder (its real path) is one where settings and keys are kept, so a bot doesn't read
// from it (index.js, for a new one) and nothing's sent from it: in a hidden folder of your home folder
// (~/.config), in ~/Library but for iCloud Drive and the cloud storage there (Mobile Documents,
// CloudStorage), or in AppData. Where it is, in words ("a hidden folder"), or null.
export function rootSays(root) {
  for (const h of homes()) {
    if (root === h || !within(root, h)) continue
    const names = root.slice(h.length).split(/[\\/]+/).filter(Boolean)
    if (names.some((n) => n.startsWith('.'))) return 'a hidden folder'
    const [top, next] = names.map((n) => n.toLowerCase())
    if (top === 'library' && !['mobile documents', 'cloudstorage'].includes(next)) return 'in ~/Library'
    if (top === 'appdata') return 'in AppData'
  }
  return null
}
// A folder a bot reads, as it is now: its real path, and its device and inode (as text), so one that
// leads somewhere else since it was picked (made a link to another folder, say) is told apart
// (frontdesk.js foldersOf). null when it isn't there.
export async function folderId(p) {
  try { const real = await fsp.realpath(p); const st = await fsp.stat(real, BIG); return st.isDirectory() ? { real, dev: String(st.dev), ino: String(st.ino) } : null } catch { return null }
}
export const sameFolder = (a, b) => !!a && !!b && a.real === b.real && a.dev === b.dev && a.ino === b.ino
// Whether a folder's real path is one a bot never reads: your whole home folder or a folder it's in,
// or Bridge AI's own. Why, or null.
export function folderSays(real) {
  if (homes().some((h) => real === h || within(h, real))) return 'it\'s your whole home folder now'
  const data = keptOut()[0]
  let realData = data
  try { realData = fs.realpathSync(data) } catch { /* not made yet */ }
  if ([data, realData].some((d) => within(real, d) || within(d, real))) return 'it\'s Bridge AI\'s own folder now'
  return null
}
// On Windows, whether a file or folder is marked hidden or system (attrib); elsewhere, no. One whose
// marks can't be read is taken as not marked: its name was looked at already.
const ATTRIB = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'attrib.exe')
function marked(p) {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => execFile(ATTRIB(), [p], { timeout: 5000, windowsHide: true }, (err, out) => {
    const s = String(out || '')
    const i = s.toLowerCase().indexOf(p.toLowerCase())
    const flags = i > 0 ? s.slice(0, i) : ''
    resolve(!err && /^[A-Z ]+$/.test(flags) && /[HS]/.test(flags))
  }))
}

// Where a path the agent named is: a folder of the bot's (its real path) and the names under it, to
// the file. Never anything outside: what's opened is that folder's real path and those names, none
// of them "..". ctx: { folders, cwd } (a relative path is from cwd when that's in one of them, else
// from the first).
async function locate(raw, { folders = [], cwd = null } = {}) {
  let s = String(raw ?? '').trim().replace(/^[`'"<]+|[`'">]+$/g, '').trim()
  if (!s || s.includes('\0')) throw no('there\'s no path to a file')
  if (/^file:\/\//i.test(s)) { try { s = fileURLToPath(s) } catch { throw no('there\'s no path to a file') } }
  s = s.replace(/^~(?=$|[\\/])/, os.homedir())
  const roots = []
  for (const f of folders) {
    try { roots.push({ given: path.resolve(String(f)), real: await fsp.realpath(String(f)) }) } catch { /* gone: not one */ }
  }
  if (!roots.length) throw no('the bot has no folders to send a file from')
  const at = cwd && roots.some((r) => within(path.resolve(cwd), r.real) || within(path.resolve(cwd), r.given)) ? path.resolve(cwd) : roots[0].real
  const full = path.resolve(at, s)
  for (const r of roots) {
    for (const top of [r.real, r.given]) {
      if (!within(full, top)) continue
      const names = full.slice(top.length).split(/[\\/]+/).filter(Boolean)
      if (!names.length || names.some((n) => n === '.' || n === '..')) throw no('it\'s a folder, not a file')
      return { root: r.real, names }
    }
  }
  throw no('it isn\'t in the folders the bot reads from')
}

// The way down from the folder to the file, looked at a name at a time, never following a link:
// { file, st } (st: its lstat, bigint), or why not.
async function walk(root, names) {
  let at = root
  const last = names.length - 1
  for (const [i, name] of names.entries()) {
    at = path.join(at, name)
    let st
    try { st = await fsp.lstat(at, BIG) } catch (e) { throw no(e.code === 'EPERM' || e.code === 'EACCES' ? `it couldn't be read (${e.code})` : 'there\'s no such file in the bot\'s folders') }
    if (st.isSymbolicLink()) throw no(i === last ? 'it\'s a link to somewhere else, and only a file itself goes' : 'it\'s reached through a link to somewhere else')
    if (i < last && !st.isDirectory()) throw no('there\'s no such file in the bot\'s folders')
    if (i === last) {
      if (st.isDirectory()) throw no('it\'s a folder, not a file')
      if (!st.isFile()) throw no('it isn\'t a file')
      return { file: at, st }
    }
  }
  throw no('there\'s no path to a file')
}

// Whether names (a file's, and the folders' on the way to it) say it can't go: hidden, a secret's, or
// (the file's) a kind that isn't sent from the bot's folders. Why, or null.
function namesSay(names, { config = false } = {}) {
  const name = names[names.length - 1]
  if (names.some((n) => n.startsWith('.'))) return name.startsWith('.') ? 'it\'s a hidden file' : 'it\'s in a hidden folder'
  if (names.some(secretLike)) return secretLike(name) ? 'its name says it holds keys, passwords or credentials' : 'it\'s in a folder whose name says it holds keys, passwords or credentials'
  if (!TYPES[extOf(name)]) return notAKind(name)
  if (!config && !DOCS.has(extOf(name))) return `a .${extOf(name)} file is a data or config file, which the bot sends from its folders only when you let it (Settings › Bots)`
  return null
}

// A file in the bot's folders, checked and read: { name, file, from, size, type, body }, or an Error
// with refused: true and why, in words for the reply (never the folders it's in). ctx: { folders, cwd,
// keptOut (real paths; this computer's, keptOut(), if not given), config (data and config files may
// go too), budget (bytes it may be at most, what's left of TOTAL), whole (false: only what's looked
// through for keys is read, and body is null: the tool's check, not the copy) }.
export async function readChecked(raw, ctx = {}) {
  const { root, names } = await locate(raw, ctx)
  const name = names[names.length - 1]
  const where = rootSays(root)
  if (where) throw no(`the folder it reads from is ${where}, where apps keep their settings and keys`)
  // (By its names first: nothing is opened for a file that can't go.)
  const said = namesSay(names, ctx)
  if (said) throw no(said)
  // (On Windows, a colon in a name opens another stream of a file than its own.)
  if (process.platform === 'win32' && names.some((n) => n.includes(':'))) throw no('there\'s no such file in the bot\'s folders')
  const out = safe(name)
  if (!out || extOf(out) !== extOf(name)) throw no('its name has characters a file can\'t have everywhere')
  const kept = await Promise.all((ctx.keptOut || keptOut()).map((d) => fsp.realpath(d).catch(() => path.resolve(d))))
  const file = path.join(root, ...names)
  if (kept.some((d) => within(file, d))) throw no('it\'s in a folder that holds keys')
  const seen = await walk(root, names)
  for (let i = 1; i <= names.length; i++) if (await marked(path.join(root, ...names.slice(0, i)))) throw no(i === names.length ? 'it\'s a hidden file' : 'it\'s in a hidden folder')
  let fh
  try { fh = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)) } catch (e) { throw no(e.code === 'ELOOP' ? 'it\'s a link to somewhere else, and only a file itself goes' : `it couldn't be read (${e.code || e.message})`) }
  try {
    // The file opened is the one looked at, a plain file with one name, and the way to it still leads
    // there, inside the folder.
    const st = await fh.stat(BIG)
    if (!st.isFile()) throw no('it isn\'t a file')
    if (!same(st, seen.st)) throw no('it changed while it was being read')
    if (st.nlink > 1n) throw no('it\'s a hard link to a file that\'s kept elsewhere too')
    const again = await walk(root, names)
    if (!same(again.st, st)) throw no('it changed while it was being read')
    const real = await fsp.realpath(file).catch(() => null)
    if (!real || !within(real, root)) throw no('it\'s reached through a link to somewhere else')
    if (!same(await fsp.stat(real, BIG), st)) throw no('it changed while it was being read')
    // (Its names as they really are, looked at again: on Windows a short name, PRIVAT~1 say, can
    // stand for a hidden folder's or a secret one's.)
    const really = real.slice(root.length).split(/[\\/]+/).filter(Boolean)
    if (!really.length) throw no('it\'s a folder, not a file')
    const again2 = namesSay(really, ctx)
    if (again2) throw no(again2)
    const its = really[really.length - 1]
    if (kept.some((d) => within(real, d))) throw no('it\'s in a folder that holds keys')
    // (Sent by its own name, as the folder has it.)
    const as = safe(its)
    if (!as || extOf(as) !== extOf(its)) throw no('its name has characters a file can\'t have everywhere')
    const size = Number(st.size)
    if (size === 0) throw no('it\'s empty')
    if (size > EACH) throw no(`it's ${sizeOf(size)}, over the ${sizeOf(EACH)} a bot sends`)
    if (ctx.budget != null && size > ctx.budget) throw no('it\'s more than an answer can send back, all told')
    // Read from the open file: to its end, and one that grows or shrinks meanwhile doesn't go (or, for
    // the tool's check, as much as is looked through).
    const whole = ctx.whole !== false
    const want = whole ? size : Math.min(size, TEXT.has(extOf(its)) ? size : SCAN)
    const buf = Buffer.alloc(want + (whole ? 1 : 0))
    let n = 0
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n)
      if (!bytesRead) break
      n += bytesRead
    }
    if (whole ? n !== size : n !== want) throw no('it changed while it was being read')
    const body = buf.subarray(0, want)
    if (isProgram(body.subarray(0, 8))) throw no('it\'s a program or a script, which a bot doesn\'t send')
    const holds = secretIn(body, its)
    if (holds) throw no(holds)
    return { name: as, file: real, from: shown(real), size, type: TYPES[extOf(its)], body: whole ? body : null }
  } catch (e) {
    throw e.refused ? e : no(`it couldn't be read (${e.code || e.message})`)
  } finally { await fh.close().catch(() => {}) }
}
// The name a path ends in, as it's said in a reply (a refused one's too).
export const nameOf = (raw) => safe(path.basename(String(raw ?? '').trim().replace(/^[`'"<]+|[`'">]+$/g, '').replace(/\\/g, '/'))) || 'file'

// ---------- What a run attached ----------
// Noted beside its outbox, never in it (front-desk/outbox-attached/<question>-<run>.json), where only
// Bridge AI's code writes (save_file writes only into the outbox, and its agent may read neither):
// { calls (how many times it asked), entries: [{ path, name, size } | { path, name, refused }] }, in
// order. Every one attached (MAX at most), and the first REFUSALS refused.
export const manifestOf = (box) => path.join(`${path.dirname(path.resolve(String(box)))}-attached`, `${path.basename(String(box))}.json`)
function readManifest(box) {
  try {
    const p = manifestOf(box)
    const st = fs.lstatSync(p)
    if (!st.isFile() || st.size > 64 * 1024) return { calls: 0, entries: [] }
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    const entries = (Array.isArray(j?.entries) ? j.entries : []).filter((x) => x && typeof x.path === 'string').slice(0, MAX + REFUSALS)
    return { calls: Math.max(0, Number(j?.calls) || 0), entries }
  } catch { return { calls: 0, entries: [] } }
}
function writeManifest(box, m) {
  const p = manifestOf(box)
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 })
  try { if (fs.lstatSync(p).isSymbolicLink()) fs.rmSync(p) } catch { /* not there */ }
  const fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0), 0o600)
  try { fs.writeSync(fd, JSON.stringify(m)) } finally { fs.closeSync(fd) }
}
export const attachedIn = (box) => readManifest(box).entries
export const dropManifest = (box) => { try { fs.rmSync(manifestOf(box), { force: true }) } catch { /* gone */ } }
// A run picked up after its time limit: what the one before it attached goes on with it.
export function carryManifest(fromBox, toBox) {
  try { if (!fs.lstatSync(manifestOf(fromBox)).isFile()) return; fs.mkdirSync(path.dirname(manifestOf(toBox)), { recursive: true, mode: 0o700 }); fs.renameSync(manifestOf(fromBox), manifestOf(toBox)) } catch { /* none */ }
}
// What's with an answer so far: the files saved in its outbox and the ones attached, { names, bytes }.
export function usage(box, { but = null } = {}) {
  const names = []
  let bytes = 0
  let saved = 0
  try {
    for (const n of fs.readdirSync(box)) {
      if (n.startsWith('.') || n === but) continue
      try { const st = fs.lstatSync(path.join(box, n)); if (st.isFile()) { names.push(n); bytes += st.size; saved++ } } catch { /* gone */ }
    }
  } catch { /* none yet */ }
  for (const a of attachedIn(box)) if (!a.refused && a.name !== but) { names.push(a.name); bytes += Number(a.size) || 0 }
  return { names, bytes, saved, attached: names.length - saved }
}
const full = (u) => `You've ${u.attached ? 'saved or attached' : 'saved'} ${MAX} files already, the most that go with an answer`

// save_file: a file the agent made, put in its outbox by its name alone (never one that starts with a
// dot, which collect doesn't send). What it says back.
export function save(box, a = {}) {
  if (!box) throw no('This run has no outbox')
  const name = path.basename(String(a?.name || '').replace(/\\/g, '/')).replace(/\p{Cf}/gu, '').replace(/[:*?"<>|\x00-\x1f]+/g, '-').trim().slice(0, 120) // eslint-disable-line no-control-regex
  if (!name) throw no('Give the file a name')
  if (name.startsWith('.')) throw no('A file\'s name can\'t start with a dot: give it another')
  const body = a?.base64 === true ? Buffer.from(String(a.content || ''), 'base64') : Buffer.from(String(a?.content ?? ''), 'utf8')
  if (body.length > EACH) throw no('That file is too big to send back')
  const real = fs.realpathSync(box)
  const to = path.join(real, name)
  if (path.dirname(to) !== real) throw no('Only a name: the file goes in your outbox')
  if (attachedIn(box).some((x) => !x.refused && x.name === name)) throw no(`You've attached a file called ${name} already: give this one another name`)
  const u = usage(box, { but: name })
  if (u.names.length >= MAX) throw no(full(u))
  if (u.bytes + body.length > TOTAL) throw no('That\'s more than an answer can send back, all told')
  // (Never through a link someone put there: the file is made new, or replaced as itself.)
  try { if (fs.lstatSync(to).isSymbolicLink()) fs.rmSync(to) } catch { /* not there */ }
  fs.writeFileSync(to, body, { mode: 0o600 })
  return `Saved ${name} (${body.length} bytes): it goes with your answer.`
}

// attach_file: a file in the bot's folders, checked (readChecked, looking through no more of it than
// the check needs) and noted to go with the answer; Bridge AI copies it once the answer is in,
// checking it again. One that can't go is noted too, so the reply says why whatever the agent writes.
// CALLS a run at most; how many and how big are looked at before the file is. What it says back;
// throws (refused) with why.
export async function attach(box, raw, ctx) {
  if (!box) throw no('This run has no outbox')
  const m = readManifest(box)
  if (m.calls >= CALLS) throw no(`Not attached: you've asked to attach ${CALLS} files already, the most a run may`)
  m.calls++
  const u = usage(box)
  let got
  try {
    // (One by a name it has already isn't read, nor said in the reply: that one goes.)
    const twice = (n) => Object.assign(no(`a file called ${n} is with the answer already`), { quiet: true })
    if (u.names.length >= MAX) throw no(`a bot sends ${MAX} files with an answer at most`)
    if (u.names.includes(nameOf(raw))) throw twice(nameOf(raw))
    got = await readChecked(raw, { ...ctx, budget: TOTAL - u.bytes, whole: false })
    if (u.names.includes(got.name)) throw twice(got.name)
  } catch (e) {
    // (Noted, so the reply says so, but for more than REFUSALS of them: the agent is told which.)
    const noted = e.refused && !e.quiet && (m.entries.some((x) => x.refused && x.path === String(raw)) || m.entries.filter((x) => x.refused).length < REFUSALS)
    if (noted && !m.entries.some((x) => x.refused && x.path === String(raw))) m.entries.push({ path: String(raw ?? '').slice(0, 1000), name: nameOf(raw), refused: e.message })
    writeManifest(box, m)
    if (!e.refused) throw e
    throw no(noted ? `Not attached: ${e.message}. Bridge AI says so with your answer: no need to say it again.` : `Not attached: ${e.message}.`)
  }
  m.entries.push({ path: got.file, name: got.name, size: got.size })
  writeManifest(box, m)
  return `Attached ${got.name} (${sizeOf(got.size)}): it goes with your answer as it is.`
}
