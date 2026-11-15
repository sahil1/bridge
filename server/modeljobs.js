// Which model each kind of job runs on when you haven't picked one for it: on this computer, or your
// cloud model (a sign-in or a key). Each kind has a setting in Settings › Model Providers
// (modelJobs.<job>): Auto (the default), On this computer, or Cloud first.
//   Auto: the local model built in (or the one picked there for jobs that stay on this computer)
//   when there's no other model, or when the job is short: it fits in one go in what the local model
//   reads at a time, it's no more than about 50 minutes of talk (SHORT), and it would be done here
//   in about 3 minutes (SLOW). Longer, or a diagram or live suggestions during a meeting (where the
//   research found small models clearly worse: research/local-models.md), your cloud model.
//   On this computer: always here, and when the local model can't run (not downloaded, not offered
//   here), the job says why rather than going elsewhere.
//   Cloud first: as before Auto, your sign-in or key first, a model here only when there's nothing else.
// A model picked for a job where it's used (Settings › Voice & Meetings, a meeting's own pick, Studio's
// writer) always comes first; this is only for when there's none. Edit by voice and Tidy what I say
// have their own picks and keep to this computer by themselves (index.js), and AI Assist's look at
// a folder never sends names out unless you pick a model there (fileinsights.js).
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
export const setting = (cfg, job) => (SETTINGS.includes(cfg?.modelJobs?.[job]) ? cfg.modelJobs[job] : 'auto')

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
  const name = JOBS.find((j) => j.id === job)?.label || job
  if (set === 'local') {
    const use = here || local
    if (use) return { id: use.id, where: 'local', auto: false, kept: true, why: 'kept' }
    const why = missing?.why || 'there\'s no model on this computer'
    const fix = missing?.code === 'not_downloaded' ? `Download it in Settings › Model Providers, or set ${name} to Auto there.` : missing?.code === 'downloading' ? 'It runs once the download is done.' : `Set ${name} to Auto in Settings › Model Providers to use your cloud model.`
    return { error: Object.assign(new Error(`${name} is set to run on this computer, but ${why}. ${fix}`), { code: 'local_missing' }) }
  }
  if (set === 'cloud' || !local || !cloud) return { id: first, where: at(first), auto: set !== 'cloud', kept: false, why: !cloud && first ? 'nothing else' : null }
  if (better || JOBS.find((j) => j.id === job)?.cloud) return { id: cloud, where: 'cloud', auto: true, kept: false, why: 'better' }
  if (need == null) return { id: cloud, where: 'cloud', auto: true, kept: false, why: 'unknown' }
  if (limit && need > limit.tokens) return { id: cloud, where: 'cloud', auto: true, kept: false, why: limit.by === 'slow' ? 'slow' : 'long' }
  if (seconds != null && seconds > SLOW) return { id: cloud, where: 'cloud', auto: true, kept: false, why: 'slow' }
  return { id: local.id, where: 'local', auto: true, kept: false, why: 'short' }
}
