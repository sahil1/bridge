// Which model each kind of job runs on when you haven't picked one for it where it's used. Each kind
// has a row in Settings › Model Providers › Models for Each Task:
//   A model of its own (jobModels.<job>): any model you reach (a key's, a cloud's, your sign-in's,
//   Ollama's, LM Studio's, the local model built in), with others to fall back on, in order
//   (modellist.js). The first that can run now runs (fromList): one that can't (no key for it yet,
//   its server here not running, not downloaded) is passed over before it's tried, and one that fails
//   when it's tried (its provider down or saying no, a rate limit, its usage limit) for the next at
//   once. What ran, and what was passed over and why, is kept with the job's runs (ran, runs: the
//   row shows the latest) and in the usage log (usagelog.js). The list goes only where it says: from
//   a model on this computer to one elsewhere only when the next in it is. When none in it can run,
//   the job says why rather than running on anything else.
//   Automatic (none of its own): where it runs (modelJobs.<job>), Cloud first (the default), Auto, or
//   On this computer.
//     Auto: the local model built in (or the one picked there for jobs that stay on this computer)
//     when there's no other model, or when the job is short: it fits in one go in what the local
//     model reads at a time, it's no more than about 50 minutes of talk (SHORT), and it would be done
//     here in about 3 minutes (SLOW). Longer, or a diagram or live suggestions during a meeting (where
//     the research found small models clearly worse: research/local-models.md), your cloud model.
//     On this computer: always here, and when the local model can't run (not downloaded, not offered
//     here), the job says why rather than going elsewhere.
//     Cloud first: your sign-in or key first, a model here only when there's nothing else. The
//     default, so a local model downloaded for dictation doesn't start writing meeting notes until you
//     pick Auto.
// A model picked for a job where it's used (a meeting's own pick for its notes, Studio's writer)
// always comes first; this is only for when there's none (one that's in the job's own list
// falls back along it all the same). Edit by voice and Tidy what I say have their own picks and keep
// to this computer by themselves (index.js), and AI Assist's look at a folder never sends names out
// unless you pick a model there (fileinsights.js). Every job finds its model through index.js
// pickFor and is answered through its replyFor (meetings.js: replyAny), where its runs are noted.
import fs from 'node:fs'
import { DATA, dataFile, ensureDir, writeFileAtomic } from './paths.js'
import * as modelList from './modellist.js'
import { placeEn } from '../shared/places.js'

// cloud: Auto keeps it on your cloud model when you have one (small models are slow and weaker at
// live suggestions, and draw weaker diagrams).
export const JOBS = [
  { id: 'notes', label: 'Meeting notes', about: 'Summaries, who said what, questions about a meeting, meeting prep' },
  { id: 'assist', label: 'AI Assist', about: 'Rewrites, @bridge in comments, PDFs to sign, sheets and decks' },
  { id: 'mail', label: 'Mail', about: 'Reply drafts and How You Write' },
  { id: 'tidy', label: 'Titles and tidy-ups', about: 'Pull request titles and descriptions, transcript cleanup' },
  { id: 'live', label: 'Live AI Assist', about: 'Suggestions during a meeting', cloud: true },
  { id: 'diagrams', label: 'Diagrams', about: 'Draw this and Change it on the whiteboard', cloud: true },
]
export const SETTINGS = ['auto', 'local', 'cloud']
export const setting = (cfg, job) => (SETTINGS.includes(cfg?.modelJobs?.[job]) ? cfg.modelJobs[job] : 'cloud')
// A job's own list (jobModels.<job>): its model first, then the ones to fall back on, each once, at
// most MOST; null for Automatic.
export const MOST = 6
const ID = /^[a-z][\w-]*:\S{1,200}$/
export function listOf(cfg, job) {
  const l = cfg?.jobModels?.[job]
  if (!Array.isArray(l)) return null
  const ids = [...new Set(l.filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, MOST)
  return ids.length ? ids : null
}
const nameOf = (job) => JOBS.find((j) => j.id === job)?.label || job

// About 50 minutes of a meeting's transcript (an hour is about 14,000 tokens): small models' notes
// were faithful on a short call and slower and less complete on long ones.
export const SHORT = 12_000
// Longer than this here (seconds, from how fast it's been on this computer, or a guess for it), and
// Auto sends it to your cloud model.
export const SLOW = 180
// The room left for the answer in what the model reads at a time (chatmodels.js ANSWER).
const ANSWER = 2048
// Tokens a minute of talk takes, to say SHORT in minutes.
export const PER_MINUTE = 240

// The most a job can be for Auto to run it here: { tokens, by } (by: what holds it to that).
export function shortLimit({ ctx = null, readPerSecond = null } = {}) {
  const limits = [{ tokens: SHORT, by: 'short' }]
  if (ctx) limits.push({ tokens: ctx - ANSWER, by: 'context' })
  if (readPerSecond) limits.push({ tokens: Math.floor(SLOW * readPerSecond * 0.6), by: 'slow' })
  return limits.reduce((a, b) => (b.tokens < a.tokens ? b : a))
}

// A job with a list of its own: the first in it that can run now (models: chatmodels.js's), as
// route() says it, with picked, own (the list, to fall back along when it's called) and passed (the
// ones before it that can't run now, and why); none, { error } saying why, for the job to say
// rather than run on something else.
export function fromList({ job, own, models = [], provider }) {
  const passed = []
  for (const id of own) {
    const why = modelList.whyNot(id, models, provider)
    if (why) { passed.push({ id, why }); continue }
    return { id, where: modelList.isLocal(id) ? 'local' : 'cloud', auto: false, kept: true, why: 'picked', picked: true, own, passed }
  }
  const name = nameOf(job)
  return { error: Object.assign(new Error(`${name} can't run: ${passed.map((p) => p.why).join('; ')}. Set it up in ${placeEn('providers')}, or set ${name} to Automatic in ${placeEn('models')}.`), { code: 'not_ready', passed }) }
}

// Where one job runs. Pure, so tests can ask it anything.
//   job: a JOBS id; set: its setting; first: the model Bridge AI reaches first (your sign-in, then a
//   key, your cloud, a model here: index.js pickMeetingModel); cloud: the first that isn't on this
//   computer, or null; local: the model here Auto may use ({ id, label }, or null); here: any model
//   here, for On this computer; need: the job's size in tokens (null when it isn't known); limit:
//   shortLimit()'s for that local model; seconds: how long it would take here, when known;
//   missing: why there's none here ({ code, why }), for On this computer to say; better: Auto keeps
//   this one job on your cloud model (the transcript cleanup, which small models do poorly).
// { id, where: 'local'|'cloud'|null, auto: whether Auto chose, kept: set to stay here, why }, or
// { error } when it's set to stay here and can't.
export function route({ job, set = 'auto', first = null, cloud = null, local = null, here = null, need = null, limit = null, seconds = null, missing = null, better = false }) {
  const at = (id) => (id ? (/^(ollama|lmstudio|bridge):/.test(id) ? 'local' : 'cloud') : null)
  const name = nameOf(job)
  if (set === 'local') {
    const use = here || local
    if (use) return { id: use.id, where: 'local', auto: false, kept: true, why: 'kept' }
    const why = missing?.why || 'there\'s no model on this computer'
    const fix = missing?.code === 'not_downloaded' ? `Download it in ${placeEn('providers')}, or set ${name} to Auto in ${placeEn('models')}.` : missing?.code === 'downloading' ? 'It runs once the download is done.' : `Set ${name} to Auto in ${placeEn('models')} to use your cloud model.`
    return { error: Object.assign(new Error(`${name} is set to run on this computer, but ${why}. ${fix}`), { code: 'local_missing' }) }
  }
  if (set === 'cloud' || !local || !cloud) return { id: first, where: at(first), auto: set !== 'cloud', kept: false, why: !cloud && first ? 'nothing else' : null }
  if (better || JOBS.find((j) => j.id === job)?.cloud) return { id: cloud, where: 'cloud', auto: true, kept: false, why: 'better' }
  if (need == null) return { id: cloud, where: 'cloud', auto: true, kept: false, why: 'unknown' }
  if (limit && need > limit.tokens) return { id: cloud, where: 'cloud', auto: true, kept: false, why: limit.by === 'slow' ? 'slow' : 'long' }
  if (seconds != null && seconds > SLOW) return { id: cloud, where: 'cloud', auto: true, kept: false, why: 'slow' }
  return { id: local.id, where: 'local', auto: true, kept: false, why: 'short' }
}

// ---------- What each job ran on ----------
// Each kind's last few runs (RUNS), kept in the data folder: when, the model that answered, the
// ones passed over first and why, or why none could. Settings › Model Providers shows the latest.
const RUNS = 8
const FILE = () => dataFile('model-jobs.json')
let kept = null
let saving = null
const load = () => {
  if (!kept) { try { kept = JSON.parse(fs.readFileSync(FILE(), 'utf8')) || {} } catch { kept = {} } }
  return kept
}
// One run of a job: model, the one that answered (null when none did); passed, [{ id, why }];
// error, why none could.
export function ran(job, { model = null, passed = [], error = null } = {}) {
  if (!JOBS.some((j) => j.id === job)) return
  const all = load()
  const one = { at: new Date().toISOString(), model, ...(passed?.length ? { passed: passed.slice(0, MOST + 1).map((p) => ({ id: p.id, why: String(p.why || '').slice(0, 300) })) } : {}), ...(error ? { error: String(error).slice(0, 300) } : {}) }
  all[job] = [one, ...(Array.isArray(all[job]) ? all[job] : [])].slice(0, RUNS)
  // (Written a second later, once for a job that answers in pieces.)
  if (!saving) saving = setTimeout(() => { saving = null; try { ensureDir(DATA); writeFileAtomic(FILE(), JSON.stringify(kept, null, 1)) } catch { /* kept until the next */ } }, 1000)
  saving.unref?.()
}
export const runs = (job) => (Array.isArray(load()[job]) ? load()[job] : [])
