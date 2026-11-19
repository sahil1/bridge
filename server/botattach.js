// A file already in a bot's folders, sent back with its answer as it is (Bots, a beta feature:
// frontdesk.js, botfiles.js): a PDF, a Word document, a picture. The agent that answers names it (its
// attach_file tool: outboxmcp.js for Claude Code, botanswer.js for a model; or a line ATTACH: <path>
// after its answer, for any), and Bridge AI copies it into the run's outbox once the answer is in
// (botfiles.js collect, the one place a file's bytes are taken from your folders). The tool only
// checks it and notes it in the outbox (MANIFEST), so the agent hears at once why one can't go;
// collect checks everything again, against the bot's folders as Bridge AI has them, and is what
// decides.
//
// A file goes only when:
//   - its path, from the folder down, is in one of the folders the bot reads from (readsFrom), with
//     no link anywhere on the way out of that folder (a link, a folder that's a link, a Windows
//     junction), and it's a plain file there (not a link, a folder, a device or a pipe);
//   - neither it nor a folder on the way is hidden (a name that starts with a dot), nor has a name
//     that says it holds keys, passwords or credentials (SECRET), nor is in a folder that holds them
//     (keptOut: Bridge AI's own, ~/.ssh, ~/.aws and the like), whatever folder it's read from;
//   - it's a kind a bot sends (TYPES: pictures, PDFs, tables, text, documents without macros), not a
//     program or a script by its first bytes, and a text file with no private key in it;
//   - it isn't empty, nor over EACH, nor a hard link (a file kept elsewhere too).
// And it's read without a gap between the look and the read (TOCTOU): opened without following a
// link (O_NOFOLLOW) or waiting on a pipe (O_NONBLOCK), the file opened is the one looked at (its
// device and inode), the way to it is looked at again once it's open and still leads to that same
// file (its real path inside the folder, whose names are looked at again too), and its size is the
// opened file's, read to its end and no further. What's sent is what was read from that open file.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX = 5 // files a run sends back, at most
export const EACH = 25 * 1024 * 1024 // each at most
export const TOTAL = MAX * EACH // and all told
// The kinds of file a bot may send, by their name, and what each is: pictures, PDFs, tables, text,
// and Office documents without macros. Anything else (a program, a script, a disk image, a link
// file, an archive) isn't sent.
export const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', txt: 'text/plain', json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', html: 'text/html', xml: 'application/xml', mmd: 'text/plain', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
export const KINDS = Object.keys(TYPES)
export const extOf = (name) => path.extname(String(name)).slice(1).toLowerCase()
const TEXT = new Set(['svg', 'csv', 'tsv', 'md', 'txt', 'json', 'yaml', 'yml', 'html', 'xml', 'mmd'])
// A program by its first bytes: a Windows program (MZ), Linux's (ELF), a Mac's (Mach-O, either order,
// and universal), and a script (#!), whatever it's called.
const MAGIC = [Buffer.from('MZ'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from([0xfe, 0xed, 0xfa, 0xce]), Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), Buffer.from([0xce, 0xfa, 0xed, 0xfe]), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.from('#!')]
export const isProgram = (head) => MAGIC.some((m) => head.length >= m.length && head.subarray(0, m.length).equals(m))
export const notAKind = (name) => `${extOf(name) ? `a .${extOf(name)} file` : 'a file with no kind in its name'} isn't one a bot sends (only pictures, PDFs, tables, text and documents)`
export const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`)
// A file's name as it goes: format characters out (a right-to-left mark makes "fdp.exe" look like
// "exe.pdf"), and characters a name can't have everywhere.
export const safe = (s) => String(s || '').replace(/\p{Cf}/gu, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 120) // eslint-disable-line no-control-regex

// ---------- What never goes ----------
// Names that say a file (or a folder on the way to it) holds keys, passwords or credentials: by its
// kind (a key, a certificate's private half, a password manager's file) or its words (secrets.json,
// passwords.xlsx, client_secret.json, id_rsa.txt), whatever kind of file it is.
const SECRET_KINDS = new Set(['pem', 'key', 'p12', 'pfx', 'jks', 'keystore', 'kdbx', 'kdb', 'keychain', 'keychain-db', 'gpg', 'pgp', 'asc', 'ovpn', 'ppk', 'env'])
const SECRET_WORDS = /(?:^|[-_. ])(?:secrets?|credentials?|creds|passwords?|passwd|api[-_ ]?keys?|private[-_ ]?keys?|(?:access|auth|refresh|bearer|oauth|bot|api)[-_ ]?tokens?|client[-_ ]?secrets?|service[-_ ]?accounts?|id_(?:rsa|dsa|ecdsa|ed25519)|keychains?|keystores?)(?:[-_. ]|$)|^tokens?(?:\.|$)|^\.?env(?:\.|$)/i
export const secretLike = (name) => SECRET_KINDS.has(extOf(name)) || SECRET_WORDS.test(String(name))
// A private key written out as text (PEM, OpenSSH, PGP).
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/
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
const within = (p, dir) => { const a = cmp(p); const d = cmp(dir); return a === d || a.startsWith(d.endsWith(path.sep) ? d : d + path.sep) }
// A path as it's said (~/… for one in your home folder, as it is or as its real path).
let realHome = null
export const shown = (p) => {
  const home = os.homedir()
  if (realHome == null) { try { realHome = fs.realpathSync(home) } catch { realHome = home } }
  for (const h of [home, realHome]) if (p === h || String(p).startsWith(h + path.sep)) return `~${String(p).slice(h.length)}`
  return String(p)
}
const no = (why) => Object.assign(new Error(why), { refused: true })
const BIG = { bigint: true }
const same = (a, b) => a.dev === b.dev && a.ino === b.ino

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

// A file in the bot's folders, checked and read whole: { name, file, from, size, type, body }, or an
// Error with refused: true and why, in words for the reply (never the folders it's in). ctx: { folders,
// cwd, keptOut } (keptOut: real paths; this computer's, keptOut(), if not given).
export async function readChecked(raw, ctx = {}) {
  const { root, names } = await locate(raw, ctx)
  const name = names[names.length - 1]
  // (By its names first: nothing is opened for a file that can't go.)
  if (names.some((n) => n.startsWith('.'))) throw no(name.startsWith('.') ? 'it\'s a hidden file' : 'it\'s in a hidden folder')
  if (names.some(secretLike)) throw no(secretLike(name) ? 'its name says it holds keys, passwords or credentials' : 'it\'s in a folder whose name says it holds keys, passwords or credentials')
  if (!TYPES[extOf(name)]) throw no(notAKind(name))
  // (On Windows, a colon in a name opens another stream of a file than its own.)
  if (process.platform === 'win32' && names.some((n) => n.includes(':'))) throw no('there\'s no such file in the bot\'s folders')
  const out = safe(name)
  if (!out || extOf(out) !== extOf(name)) throw no('its name has characters a file can\'t have everywhere')
  const kept = await Promise.all((ctx.keptOut || keptOut()).map((d) => fsp.realpath(d).catch(() => path.resolve(d))))
  const file = path.join(root, ...names)
  if (kept.some((d) => within(file, d))) throw no('it\'s in a folder that holds keys')
  const seen = await walk(root, names)
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
    if (!really.length || really.some((n) => n.startsWith('.'))) throw no('it\'s hidden, or in a hidden folder')
    if (really.some(secretLike)) throw no('its name, or a folder\'s on the way to it, says it holds keys, passwords or credentials')
    const its = really[really.length - 1]
    if (!TYPES[extOf(its)]) throw no(notAKind(its))
    if (kept.some((d) => within(real, d))) throw no('it\'s in a folder that holds keys')
    // (Sent by its own name, as the folder has it.)
    const as = safe(its)
    if (!as || extOf(as) !== extOf(its)) throw no('its name has characters a file can\'t have everywhere')
    const size = Number(st.size)
    if (size === 0) throw no('it\'s empty')
    if (size > EACH) throw no(`it's ${sizeOf(size)}, over the ${sizeOf(EACH)} a bot sends`)
    // Read to its end, from the open file: one that grows or shrinks meanwhile doesn't go.
    const buf = Buffer.alloc(size + 1)
    let n = 0
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n)
      if (!bytesRead) break
      n += bytesRead
    }
    if (n !== size) throw no('it changed while it was being read')
    const body = buf.subarray(0, size)
    if (isProgram(body.subarray(0, 8))) throw no('it\'s a program or a script, which a bot doesn\'t send')
    if (TEXT.has(extOf(its)) && PRIVATE_KEY.test(body.toString('latin1'))) throw no('it holds a private key')
    return { name: as, file: real, from: shown(real), size, type: TYPES[extOf(its)], body }
  } catch (e) {
    throw e.refused ? e : no(`it couldn't be read (${e.code || e.message})`)
  } finally { await fh.close().catch(() => {}) }
}
// The name a path ends in, as it's said in a reply (a refused one's too).
export const nameOf = (raw) => safe(path.basename(String(raw ?? '').trim().replace(/^[`'"<]+|[`'">]+$/g, '').replace(/\\/g, '/'))) || 'file'

// ---------- In a run's outbox ----------
// What an agent attached is noted in its outbox, in a file of Bridge AI's (a name that starts with a
// dot, which save_file can't make and collect doesn't send): [{ path, name, size } | { path, name,
// refused }], in order. Only Bridge AI's code writes it (the outbox is never a folder its agent may
// read or write). Every one attached (MAX at most), and the first REFUSALS refused.
export const MANIFEST = '.attached.json'
const REFUSALS = 10
export function attachedIn(box) {
  try {
    const p = path.join(box, MANIFEST)
    const st = fs.lstatSync(p)
    if (!st.isFile() || st.size > 64 * 1024) return []
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    return (Array.isArray(j) ? j : []).filter((x) => x && typeof x.path === 'string').slice(0, MAX + REFUSALS)
  } catch { return [] }
}
function note(box, entry) {
  const was = attachedIn(box)
  if (entry.refused && was.filter((x) => x.refused).length >= REFUSALS) return
  const list = [...was, entry]
  const p = path.join(box, MANIFEST)
  try { if (fs.lstatSync(p).isSymbolicLink()) fs.rmSync(p) } catch { /* not there */ }
  const fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0), 0o600)
  try { fs.writeSync(fd, JSON.stringify(list)) } finally { fs.closeSync(fd) }
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

// save_file: a file the agent made, put in its outbox by its name alone. What it says back.
export function save(box, a = {}) {
  if (!box) throw no('This run has no outbox')
  const name = path.basename(String(a?.name || '').replace(/\\/g, '/')).replace(/\p{Cf}/gu, '').replace(/[:*?"<>|\x00-\x1f]+/g, '-').replace(/^\.+/, '').trim().slice(0, 120) // eslint-disable-line no-control-regex
  if (!name) throw no('Give the file a name')
  const body = a?.base64 === true ? Buffer.from(String(a.content || ''), 'base64') : Buffer.from(String(a?.content ?? ''), 'utf8')
  if (body.length > EACH) throw no('That file is too big to send back')
  const real = fs.realpathSync(box)
  const to = path.join(real, name)
  if (path.dirname(to) !== real) throw no('Only a name: the file goes in your outbox')
  if (attachedIn(real).some((x) => !x.refused && x.name === name)) throw no(`You've attached a file called ${name} already: give this one another name`)
  const u = usage(real, { but: name })
  if (u.names.length >= MAX) throw no(full(u))
  if (u.bytes + body.length > TOTAL) throw no('That\'s more than an answer can send back, all told')
  // (Never through a link someone put there: the file is made new, or replaced as itself.)
  try { if (fs.lstatSync(to).isSymbolicLink()) fs.rmSync(to) } catch { /* not there */ }
  fs.writeFileSync(to, body, { mode: 0o600 })
  return `Saved ${name} (${body.length} bytes): it goes with your answer.`
}

// attach_file: a file in the bot's folders, checked (readChecked) and noted to go with the answer;
// Bridge AI copies it once the answer is in, checking it again. One that can't go is noted too, so
// the reply says why whatever the agent writes. What it says back; throws (refused) with why.
export async function attach(box, raw, ctx) {
  if (!box) throw no('This run has no outbox')
  const real = fs.realpathSync(box)
  const already = attachedIn(real)
  let got
  try {
    // (None read once as many as go are with it already.)
    if (usage(real).names.length >= MAX) throw no(`a bot sends ${MAX} files with an answer at most`)
    got = await readChecked(raw, ctx)
    const u = usage(real)
    if (already.some((x) => !x.refused && x.name === got.name) || u.names.includes(got.name)) throw no(`a file called ${got.name} is with the answer already`)
    if (u.names.length >= MAX) throw no(`a bot sends ${MAX} files with an answer at most`)
    if (u.bytes + got.size > TOTAL) throw no('it\'s more than an answer can send back, all told')
  } catch (e) {
    if (!e.refused) throw e
    if (!already.some((x) => x.refused && x.path === String(raw))) note(real, { path: String(raw ?? '').slice(0, 1000), name: nameOf(raw), refused: e.message })
    throw no(`Not attached: ${e.message}. Bridge AI says so with your answer: no need to say it again.`)
  }
  note(real, { path: got.file, name: got.name, size: got.size })
  return `Attached ${got.name} (${sizeOf(got.size)}): it goes with your answer as it is.`
}
