// Bots (a beta feature, Settings › Bots, its id slack-bot): each answering people you choose, in
// Slack, Discord or Microsoft Teams, from the folders you give it (frontdesk.js). Several can run on
// one computer, each with its own record, reached through the platform's shared connection (one app
// for them all) or a connection of its own (connections.js).
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
//   (its app's tokens were in bots/<id>/slack.json, discord.json and teams.json before
//   connections: each is a connection of its own now, connections/<c>/, connections.js migrate)
//   bots/<id>/memory.json       what it remembers (botmemory.js)
//   bots/<id>/people.json       each person's running context: their earlier conversations with it
//                               (botcontext.js), never in its export (only your backup, sealed,
//                               and a Move to your own computer carry it: backup.js)
//   bots/<id>/setup.json        its setup chat with AI Assist and what it proposes (botsetup.js)
//   bots/<id>/trace/            its record (trace.js)
// A draft (draft: true) is a bot AI Assist proposed, from the setup chat or the Chief of Staff's
// `bridge bot`: listed, but nothing of it applies, connects or answers until you press Create.
// A bot deleted leaves its record, until the time it's kept for runs out, with deleted.json naming
// it (its name, when, how long its record is kept); with its activity history deleted too, the
// record keeps only that it was (frontdesk.js clear()).
// The Slack Bot as #216 had it (slackBot in config.json, its tokens in slack-bot.json, its
// questions in front-desk.json) is carried over once as the first bot, named as it was until you
// rename it: its folders become what it reads from, and their topics lines in its instructions.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataFile, writeFileAtomic, HOME } from './paths.js'
import { keepOf } from './trace.js'
import { templateOf } from './bottemplates.js'

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
// Who you are in Slack (owner: so its drafts come to your direct messages, and you may always ask),
// and in Discord and Teams (owners: so you may always ask there too),
// what it may change (changes: none, suggest or pr, in repo, one of its folders), the limits per
// person (30 questions a day, 2 at once, 10 minutes a run, and at that time limit asking you whether
// it may go on, up to its Longest Run), memory (kept once you approve, straight away, or off),
// paused, the channels muted with !mute, the channels it answers in without a
// mention (listen), whether it may say what your agents are doing (agentsStatus), and which of your
// MCP servers its runs get (mcp, by name: Settings › MCP Servers, through Claude Code's own config),
// what answers (answerers: its first choice and fallbacks, botanswer.js ids, or null for
// Automatic; fallback: whether the next is tried when one can't answer), and where it answers a
// question asked at the top of a channel (answerIn: in the channel, or in a thread of its own).
// Files from its folders (botattach.js): whether an answer with one goes without asking when answers
// do (attachAuto: 'no', the default, so it waits for you; 'named', in a direct message with you or
// someone you named; 'everyone', to anyone who may ask, in a direct message or a private channel,
// never a public one: frontdesk.js), and whether data and config files may go as well as documents
// and pictures (attachConfig). And each folder it reads as it was when you picked it (folderIds: its
// real path, device and inode), so one that leads somewhere else since isn't read.
// At the Time Limit (atLimit): a run that reaches its minutes asks you whether it may go on ('ask',
// every bot's unless you say otherwise, ones made before there was a choice too), or is stopped
// there and comes to you ('stop', as every run was before). Asking, it goes on for a few minutes
// while you decide, and each Continue gives it more, never past its Longest Run (longest, minutes),
// where it's stopped without asking (frontdesk.js).
export const LIMITS = { day: 30, atOnce: 2, minutes: 10, atLimit: 'ask', longest: 120 }
export const ATTACH_AUTO = ['no', 'named', 'everyone']
// Answer In (answerIn): where the answer to a question at the top of a channel goes, in the channel
// itself ('channel', a new bot's) or in a thread started from the question ('thread', as every bot
// answered before there was a choice, so one made before keeps it). Either way, the same person
// asking again in the same place within CARRY_ON_MIN minutes of the conversation's last word carries
// it on: answered where its last answer went, given what was said before (frontdesk.js). A direct
// message is one running conversation with that person, its earlier turns given as they go.
export const ANSWER_IN = ['channel', 'thread']
export const CARRY_ON_MIN = 30
const DEFAULTS = {
  name: 'Bridge AI', description: '', who: 'named', askers: [], others: 'polite', readsFrom: [], instructionsFile: null, agent: null, auto: false, agentCopies: false, retention: '1y', max: 2,
  owner: null, owners: {}, changes: 'none', repo: null, limits: LIMITS, memory: 'approve', paused: false, muted: [], listen: [], agentsStatus: false, template: null, mcp: [], answerers: null, fallback: true, draft: false, icon: null,
  attachAuto: 'no', attachConfig: false, folderIds: {},
}
// Its icon where a shared connection posts as it (connhub.js): an emoji's Slack name, or a picture's
// https address.
export const ICON = /^(:[\w+-]{1,60}:|https:\/\/\S{1,500})$/
// An MCP server's name, as the agents' configs take it (mcp.js).
export const MCP_NAME = /^[A-Za-z0-9_.-]{1,64}$/
// What may answer: an agent (agent:claude, agent:claude:opus) or a model (model:ollama:qwen3).
const answererId = (x) => /^(agent:(claude|codex)(:[\w.-]{1,60})?|model:[a-z][\w-]*:[^\s]{1,200})$/.test(x) && !/^model:cli:/.test(x)
// People and places by their ids: Slack's as Slack gives them; Discord's and Teams' with their
// platform before them (connector.js combine).
const SLACK_ID = /^[UW][A-Z0-9]{2,20}$/
export const PERSON_ID = /^([UW][A-Z0-9]{2,20}|discord:\d{1,25}|teams:[\w-]{6,64})$/
export const CHANNEL_ID = /^([CGD][A-Z0-9]{2,20}|discord:\d{1,25}|teams:[^\s"<>]{3,300})$/
const person = (p) => (p && SLACK_ID.test(String(p.id || '')) ? { id: String(p.id), name: clean(p.name, 80) || null } : null)
const someone = (p, platform) => (p && PERSON_ID.test(String(p.id || '')) && String(p.id).startsWith(`${platform}:`) ? { id: String(p.id), name: clean(p.name, 80) || null } : null)
const place = (c) => (c && CHANNEL_ID.test(String(c.id || '')) ? { id: String(c.id), name: clean(c.name, 80) || null } : null)
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }
// (Its Longest Run is never shorter than a run's minutes.)
export function limitsOf(l) {
  const minutes = int(l?.minutes, 1, 60, LIMITS.minutes)
  return { day: int(l?.day, 1, 1000, LIMITS.day), atOnce: int(l?.atOnce, 1, 5, LIMITS.atOnce), minutes, atLimit: l?.atLimit === 'stop' ? 'stop' : 'ask', longest: Math.max(minutes, int(l?.longest, 1, 1440, LIMITS.longest)) }
}
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
  b.owner = person(b.owner)
  b.owners = Object.fromEntries(['discord', 'teams'].map((k) => [k, someone(b.owners?.[k], k)]).filter(([, v]) => v))
  b.changes = ['suggest', 'pr'].includes(b.changes) ? b.changes : 'none'
  b.repo = b.repo ? String(b.repo) : null
  b.limits = limitsOf(b.limits)
  b.memory = ['auto', 'off'].includes(b.memory) ? b.memory : 'approve'
  b.paused = b.paused === true
  b.muted = (Array.isArray(b.muted) ? b.muted : []).map(place).filter(Boolean)
  b.listen = (Array.isArray(b.listen) ? b.listen : []).map(place).filter(Boolean)
  b.agentsStatus = b.agentsStatus === true
  b.template = b.template ? clean(b.template, 40) : null
  b.mcp = [...new Set((Array.isArray(b.mcp) ? b.mcp : []).map(String).filter((x) => MCP_NAME.test(x)))].slice(0, 20)
  b.answerers = Array.isArray(b.answerers) ? [...new Set(b.answerers.map(String).filter(answererId))].slice(0, 12) : null
  if (!b.answerers?.length) b.answerers = null
  b.fallback = b.fallback !== false
  b.draft = b.draft === true
  b.icon = ICON.test(String(b.icon || '')) ? String(b.icon) : null
  b.answerIn = b.answerIn === 'channel' ? 'channel' : 'thread'
  b.attachAuto = ATTACH_AUTO.includes(b.attachAuto) ? b.attachAuto : 'no'
  b.attachConfig = b.attachConfig === true
  b.folderIds = Object.fromEntries(Object.entries(b.folderIds && typeof b.folderIds === 'object' ? b.folderIds : {}).filter(([k, v]) => b.readsFrom.includes(k) && v && typeof v.real === 'string' && typeof v.dev === 'string' && typeof v.ino === 'string').map(([k, v]) => [k, { real: v.real, dev: v.dev, ino: v.ino }]))
  return b
}

export function list() {
  let ids = []
  try { ids = fs.readdirSync(DIR).filter((x) => ID.test(x) && fs.existsSync(fileOf(x, 'bot.json'))) } catch { /* none yet */ }
  return ids.map((id) => shape(id, read(fileOf(id, 'bot.json')))).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id, 'en', { numeric: true }))
}
export const get = (id) => (ID.test(String(id)) && fs.existsSync(fileOf(id, 'bot.json')) ? shape(id, read(fileOf(id, 'bot.json'))) : null)
// The bots that are there to answer: not a draft waiting for Create.
export const live = () => list().filter((b) => !b.draft)

function write(b) {
  fs.mkdirSync(path.join(DIR, b.id), { recursive: true, mode: 0o700 })
  const { id, ...rest } = b // eslint-disable-line no-unused-vars
  writeFileAtomic(fileOf(b.id, 'bot.json'), JSON.stringify(rest, null, 2), { mode: 0o600 })
}
const nextId = () => { const have = new Set(list().map((b) => b.id)); let n = 1; while (have.has(`b${n}`) || fs.existsSync(path.join(DIR, `b${n}`))) n++; return `b${n}` }
// A name no other bot has: this one, or with a number after it.
export function freeName(want, skip = null) {
  const w = clean(want, NAME_MAX) || 'New Bot'
  const taken = new Set(list().filter((b) => b.id !== skip).map((b) => b.name.toLowerCase()))
  let n = w
  for (let i = 2; taken.has(n.toLowerCase()) && i < 100; i++) n = `${w.slice(0, NAME_MAX - 4)} (${i})`
  return n
}

// A new bot, with its name, and its instructions to start from: a template's (bottemplates.js), or
// the plain ones.
export function create({ name, description = '', template = null } = {}, you = '') {
  const n = clean(name, NAME_MAX)
  if (!n) throw new Error('Give it a name: it\'s its name in Slack')
  if (list().some((b) => b.name.toLowerCase() === n.toLowerCase())) throw new Error(`There's a bot called ${n} already`)
  const tpl = template ? templateOf(String(template)) : null
  if (template && !tpl) throw new Error(`No such template: ${template}`)
  const b = shape(nextId(), { ...DEFAULTS, name: n, description: description || tpl?.description || '', template: tpl?.id || null, answerIn: 'channel', createdAt: new Date().toISOString() })
  write(b)
  writeInstructions(b.id, tpl ? tpl.instructions(n, you || 'my') : defaultInstructions(n, you))
  return b
}

// A draft: a bot by a name AI Assist gave it (or New Bot), nothing else of it kept until you press
// Create (botsetup.js has what it proposes). from: who asked for it, you (+ in the sidebar) or the
// Chief of Staff.
export function createDraft({ name = '', from = 'you' } = {}) {
  const b = shape(nextId(), { ...DEFAULTS, name: freeName(name), draft: true, from: from === 'chief' ? 'chief' : 'you', answerIn: 'channel', createdAt: new Date().toISOString() })
  write(b)
  return b
}
// A draft made a bot (Create): it's there to answer from now on, with the instructions it was given.
export function undraft(id, instructions) {
  const b = get(id)
  if (!b?.draft) throw Object.assign(new Error('That isn\'t a draft'), { status: 409 })
  writeInstructions(id, instructions)
  write(shape(id, { ...b, draft: false, createdAt: new Date().toISOString() }))
  return get(id)
}

// ---------- Export and import ----------
// A bot as a file, to take to another computer (the Docker image on an always-on machine, say):
// its settings, its instructions and what it remembers, never its tokens (its Slack app is
// connected again there, with tokens pasted there) nor anyone's running context (people.json). Its
// folders go as they're named here (~/…), and are checked where it's brought in.
export const BUNDLE_KIND = 'bridge-ai-bot'
const CARRIED = ['icon', 'description', 'who', 'askers', 'others', 'readsFrom', 'instructionsFile', 'agent', 'auto', 'agentCopies', 'retention', 'max', 'owner', 'owners', 'changes', 'repo', 'limits', 'memory', 'muted', 'listen', 'agentsStatus', 'template', 'mcp', 'answerers', 'fallback', 'answerIn', 'attachAuto', 'attachConfig']
export function bundleOf(id, memory = []) {
  const b = get(id)
  if (!b) throw Object.assign(new Error('No such bot'), { status: 404 })
  return { kind: BUNDLE_KIND, v: 1, exportedAt: new Date().toISOString(), name: b.name, settings: Object.fromEntries(CARRIED.map((k) => [k, b[k]])), instructions: readOwn(id), memory }
}
// The settings a bot from a file (its export, a backup, a move) takes only once they've passed the
// checks Settings makes (index.js checkSettings): the folders it reads and its instructions' file
// (there, inside your home folder, not Bridge AI's own), who may ask and you there (people by their
// ids), answering without asking, what it may change and where, what answers, its MCP servers, its
// channels, copies of your agents' conversations, saying what your agents are doing, keeping what
// it learns without asking, and sending files from its folders (without asking, and data and config
// files). Held back from the bot as it's made (held), so nothing in a file is ever kept unchecked.
// (Its folders' identities, folderIds, are this computer's: never carried, found again here.)
export const CHECKED = ['who', 'askers', 'owner', 'owners', 'readsFrom', 'instructionsFile', 'repo', 'agent', 'answerers', 'changes', 'mcp', 'muted', 'listen', 'agentCopies', 'agentsStatus', 'memory', 'auto', 'attachAuto', 'attachConfig']
// A bot from such a file: a new one, by its name (with a number after it when that's taken here),
// answering as it did once its Slack app is connected here. Anything in the file that isn't one of
// its settings is left out, so a token in it never is kept. held: the CHECKED settings aren't kept
// here but given back ({ held }), to be checked and saved one by one.
export function fromBundle(j, you = '', { held: hold = false } = {}) {
  if (!j || typeof j !== 'object' || j.kind !== BUNDLE_KIND) throw new Error('That isn\'t a bot exported from Bridge AI')
  const want = clean(j.name, NAME_MAX) || 'Imported bot'
  const taken = new Set(list().map((b) => b.name.toLowerCase()))
  let n = want
  for (let i = 2; taken.has(n.toLowerCase()) && i < 100; i++) n = `${want.slice(0, NAME_MAX - 4)} (${i})`
  const settings = Object.fromEntries(CARRIED.filter((k) => j.settings && Object.hasOwn(j.settings, k)).map((k) => [k, j.settings[k]]))
  const held = hold ? Object.fromEntries(CHECKED.filter((k) => Object.hasOwn(settings, k)).map((k) => [k, settings[k]])) : {}
  for (const k of Object.keys(held)) delete settings[k]
  const b = shape(nextId(), { ...DEFAULTS, ...settings, name: n, createdAt: new Date().toISOString(), importedAt: new Date().toISOString() })
  write(b)
  writeInstructions(b.id, typeof j.instructions === 'string' ? j.instructions.slice(0, INSTRUCTIONS_MAX) : defaultInstructions(n, you))
  return { bot: b, memory: Array.isArray(j.memory) ? j.memory.slice(0, 2000) : [], renamed: n !== want, held }
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

// Gone: its settings, tokens and instructions. Its record stays, named by deleted.json, until the
// time it's kept for runs out (with nothing in it, there's nothing to keep). (Its id isn't given
// to another bot while its folder is there.)
export function remove(id) {
  if (!ID.test(String(id))) throw new Error('No such bot')
  const b = get(id)
  const D = path.join(DIR, id)
  if (!fs.existsSync(path.join(D, 'trace')) || b?.draft) { fs.rmSync(D, { recursive: true, force: true }); return }
  writeFileAtomic(path.join(D, 'deleted.json'), JSON.stringify({ name: b?.name || id, deletedAt: new Date().toISOString(), retention: b?.retention || '1y' }, null, 2), { mode: 0o600 })
  for (const f of ['bot.json', 'instructions.md', 'slack.json', 'discord.json', 'teams.json', 'memory.json', 'people.json', 'setup.json']) fs.rmSync(path.join(D, f), { force: true })
}
// The bots deleted whose record is kept: [{ id, name, deletedAt, retention }].
export function deleted() {
  let ids = []
  try { ids = fs.readdirSync(DIR).filter((x) => ID.test(x) && !fs.existsSync(fileOf(x, 'bot.json')) && fs.existsSync(fileOf(x, 'deleted.json'))) } catch { /* none */ }
  return ids.map(deletedOf).filter(Boolean)
}
export function deletedOf(id) {
  if (!ID.test(String(id)) || fs.existsSync(fileOf(id, 'bot.json'))) return null
  const j = read(fileOf(id, 'deleted.json'))
  return j ? { id, name: clean(j.name, NAME_MAX) || id, deletedAt: j.deletedAt || null, retention: keepOf(j.retention), deleted: true } : null
}
// A deleted bot's record, gone (nothing left in it).
export function forgetRecord(id) {
  if (!ID.test(String(id)) || fs.existsSync(fileOf(id, 'bot.json'))) throw new Error('No such deleted bot')
  fs.rmSync(path.join(DIR, id), { recursive: true, force: true })
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
