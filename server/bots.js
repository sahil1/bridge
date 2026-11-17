// Bots (a beta feature, Settings › Bots, its id slack-bot): each one your own Slack app, with the
// name you give it, answering people you choose from the folders you give it (frontdesk.js). Several
// can run on one computer, each its own app, connection and record.
//
// What must hold is a setting, kept here and enforced in code: who may ask, which folders it reads
// (readsFrom), that it can only read, and which agent answers. How it answers is its instructions:
// Markdown you write in Settings (instructions.md), or a file in one of its folders (BOT.md, say)
// read fresh for each question. A file in a shared folder could be changed by someone else, so
// nothing in it is read as a setting: it steers the answer and can't widen a limit.
//
// Each bot in its own folder in the data folder, readable by you only:
//   bots/<id>/bot.json          its settings
//   bots/<id>/instructions.md   its instructions, as written in Settings
//   bots/<id>/slack.json        its Slack app's tokens (slackbot.js), never in config.json
//   bots/<id>/trace/            its record (trace.js)
// The Slack Bot as #216 had it (slackBot in config.json, its tokens in slack-bot.json, its
// questions in front-desk.json) is carried over once as the first bot, named as it was until you
// rename it: its folders become what it reads from, and their topics lines in its instructions.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataFile, writeFileAtomic, HOME } from './paths.js'
import { keepOf } from './trace.js'

export const DIR = dataFile('bots')
const OLD_TOKENS = dataFile('slack-bot.json')
const ID = /^b\d{1,4}$/
export const NAME_MAX = 35 // Slack's longest app name
export const DESCRIPTION_MAX = 140 // and the line under it
export const INSTRUCTIONS_MAX = 20000
const clean = (s, n) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
export const hashOf = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12)
export const fileOf = (id, name) => path.join(DIR, id, name)
const tilde = (p) => (p === HOME || p.startsWith(HOME + path.sep) ? `~${p.slice(HOME.length)}` : p)

// A new bot's settings: named people may ask (none yet), anyone else a polite no; no folders, so it
// answers from what it knows; drafts you review; its record kept a year.
const DEFAULTS = { name: 'Bridge AI', description: '', who: 'named', askers: [], others: 'polite', readsFrom: [], instructionsFile: null, agent: null, auto: false, agentCopies: false, retention: '1y', max: 2 }
export const defaultInstructions = (name, you) => [
  `# ${name}`,
  '',
  `Answer questions from ${you || 'my'}${you ? '\'s' : ''} colleagues about what's in the folders you can read. Keep answers short and plain, and name the files an answer comes from. If nothing there answers it, say so rather than guess.`,
  '',
].join('\n')

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
// A bot as kept, with every setting there (an older file gets the defaults for what it lacks).
function shape(id, j) {
  const b = { ...DEFAULTS, ...(j || {}), id }
  b.name = clean(b.name, NAME_MAX) || DEFAULTS.name
  b.description = clean(b.description, DESCRIPTION_MAX)
  b.who = b.who === 'channels' ? 'channels' : 'named'
  b.askers = Array.isArray(b.askers) ? b.askers.filter((x) => x?.id) : []
  b.others = b.others === 'silent' ? 'silent' : 'polite'
  b.readsFrom = Array.isArray(b.readsFrom) ? b.readsFrom.map(String).filter(Boolean) : []
  b.instructionsFile = b.instructionsFile ? String(b.instructionsFile) : null
  b.auto = b.auto === true
  b.agentCopies = b.agentCopies === true
  b.retention = keepOf(b.retention)
  b.max = Math.max(1, Math.min(5, Math.round(Number(b.max)) || 2))
  return b
}

export function list() {
  let ids = []
  try { ids = fs.readdirSync(DIR).filter((x) => ID.test(x) && fs.existsSync(fileOf(x, 'bot.json'))) } catch { /* none yet */ }
  return ids.map((id) => shape(id, read(fileOf(id, 'bot.json')))).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id, 'en', { numeric: true }))
}
export const get = (id) => (ID.test(String(id)) && fs.existsSync(fileOf(id, 'bot.json')) ? shape(id, read(fileOf(id, 'bot.json'))) : null)

function write(b) {
  fs.mkdirSync(path.join(DIR, b.id), { recursive: true, mode: 0o700 })
  const { id, ...rest } = b // eslint-disable-line no-unused-vars
  writeFileAtomic(fileOf(b.id, 'bot.json'), JSON.stringify(rest, null, 2), { mode: 0o600 })
}
const nextId = () => { const have = new Set(list().map((b) => b.id)); let n = 1; while (have.has(`b${n}`) || fs.existsSync(path.join(DIR, `b${n}`))) n++; return `b${n}` }

// A new bot, with its name, and its instructions to start from.
export function create({ name, description = '' } = {}, you = '') {
  const n = clean(name, NAME_MAX)
  if (!n) throw new Error('Give it a name: it\'s its name in Slack')
  if (list().some((b) => b.name.toLowerCase() === n.toLowerCase())) throw new Error(`There's a bot called ${n} already`)
  const b = shape(nextId(), { ...DEFAULTS, name: n, description, createdAt: new Date().toISOString() })
  write(b)
  writeInstructions(b.id, defaultInstructions(n, you))
  return b
}

// Its settings changed: what they were and are, for the record.
export function save(id, patch) {
  const before = get(id)
  if (!before) throw Object.assign(new Error('No such bot'), { status: 404 })
  const after = shape(id, { ...before, ...patch })
  if (patch.name !== undefined && list().some((b) => b.id !== id && b.name.toLowerCase() === after.name.toLowerCase())) throw new Error(`There's a bot called ${after.name} already`)
  write(after)
  return { before, after }
}

// Gone, with its tokens, its instructions and its record.
export function remove(id) {
  if (!ID.test(String(id))) throw new Error('No such bot')
  const D = path.join(DIR, id)
  fs.rmSync(D, { recursive: true, force: true })
}

// ---------- Instructions ----------
export const readOwn = (id) => { try { return fs.readFileSync(fileOf(id, 'instructions.md'), 'utf8') } catch { return '' } }
export function writeInstructions(id, text) {
  const t = String(text ?? '').replace(/\r\n/g, '\n')
  if (t.length > INSTRUCTIONS_MAX) throw new Error(`Keep the instructions under ${INSTRUCTIONS_MAX.toLocaleString('en')} characters`)
  fs.mkdirSync(path.join(DIR, id), { recursive: true, mode: 0o700 })
  writeFileAtomic(fileOf(id, 'instructions.md'), t, { mode: 0o600 })
  return t
}
// The instructions a question is answered with, read now: the file you named in one of its folders
// (it has to be inside one of them, and readable), else the ones written in Settings. A file that
// can't be read is said, and the ones in Settings used instead. { text, source, path, hash, problem }
export async function instructionsOf(b, folders) {
  const own = () => readOwn(b.id)
  if (b.instructionsFile) {
    const p = path.resolve(String(b.instructionsFile).replace(/^~(?=$|[\\/])/, HOME))
    const ok = folders.some((f) => p.startsWith(f + path.sep))
    let problem = null
    if (!ok) problem = `${tilde(p)} isn't in a folder it reads from`
    else {
      try {
        const st = await fs.promises.stat(p)
        if (!st.isFile()) problem = `${tilde(p)} isn't a file`
        else if (st.size > INSTRUCTIONS_MAX * 4) problem = `${tilde(p)} is too long to be its instructions`
        else { const text = await fs.promises.readFile(p, 'utf8'); return { text, source: 'file', path: tilde(p), hash: hashOf(text), problem: null } }
      } catch (e) { problem = `${tilde(p)} couldn't be read (${e.code || e.message})` }
    }
    const text = own()
    return { text, source: 'settings', path: null, hash: hashOf(text), problem: `${problem}, so the instructions in Settings were used` }
  }
  const text = own()
  return { text, source: 'settings', path: null, hash: hashOf(text), problem: null }
}

// ---------- Carrying over the Slack Bot ----------
// The Slack Bot's settings (cfg.slackBot) and tokens (slack-bot.json), once, as the first bot:
// named "Bridge AI" as before, its askers and what anyone else gets as they were, its folders what
// it reads from, and their topics lines in its instructions. Nothing to carry over, or bots made
// already: nothing done. Its questions are carried over by the front desk (frontdesk.js).
// unset(): the old settings taken out of config.json. null back, or the new bot.
export function carryOver(old, { you = '', unset = () => {} } = {}) {
  if (list().length) return null
  const had = old && typeof old === 'object' && Object.keys(old).length > 0
  const tokens = fs.existsSync(OLD_TOKENS)
  if (!had && !tokens) return null
  const o = had ? old : {}
  const folders = Array.isArray(o.folders) ? o.folders.filter((f) => f?.path) : []
  const b = shape('b1', {
    name: 'Bridge AI', createdAt: new Date().toISOString(), carriedOver: true, who: 'named',
    askers: Array.isArray(o.askers) ? o.askers : [], others: o.others, readsFrom: folders.map((f) => String(f.path)),
    agent: o.agent || null, auto: o.auto === true, max: o.max,
  })
  write(b)
  const topics = folders.filter((f) => String(f.topics || '').trim())
  writeInstructions(b.id, [
    defaultInstructions(b.name, you).trimEnd(),
    ...(topics.length ? ['', 'What each folder is about:', ...topics.map((f) => `- ${f.path}: ${String(f.topics).trim()}`)] : []),
    '',
  ].join('\n'))
  if (tokens) {
    try { fs.renameSync(OLD_TOKENS, fileOf(b.id, 'slack.json')); fs.chmodSync(fileOf(b.id, 'slack.json'), 0o600) } catch (e) { console.log(`Bots: the Slack Bot's tokens couldn't be carried over: ${e.message}`) }
  }
  if (had) unset()
  return b
}
