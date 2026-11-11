// Recommended Settings, a beta feature (Settings › About & Updates › Beta Features): the model and
// effort Claude Code starts with, picked for your plan, and an effort level for each task from what
// it's asked. One file the UI and the server share (server/index.js applies them when an agent
// starts; desktop/stage.js copies it into the app). Nothing here leaves this computer: the plan
// comes from Claude Code's own sign-in check (claude auth status), the effort from the words of
// the message, read here, with no model asked.

// The English, marked for the translations (scripts/i18n.js finds tx('…') in src); it's translated
// with t() where it shows. Not i18n's own tx: that one needs Vite, and the server reads this file too.
const tx = (s) => s

// Effort levels Claude Code takes (claude --effort, /effort), lowest first. A model without one runs
// at the highest it has below it (xhigh runs as high on Opus 4.6), and an organization's cap
// (maxEffortLevel, an Enterprise role's limit) still applies: a level above it runs at the cap.
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
export const EFFORT_LABEL = { low: tx('Low'), medium: tx('Medium'), high: tx('High'), xhigh: tx('Extra high'), max: tx('Max') }
// What each is for, in the effort menus.
export const EFFORT_NOTE = {
  low: tx('Quick, simple changes. Fastest, and lightest on your limits.'),
  medium: tx('Everyday work. Claude Code\'s own default.'),
  high: tx('Harder work: a refactor, a tricky bug, a design.'),
  xhigh: tx('Big jobs in many parts. Uses your limits faster.'),
  max: tx('The deepest thinking, for this one task. Uses your limits fastest.'),
}
export const isEffort = (e) => EFFORTS.includes(e)

// ---------- From your plan ----------
// What Claude Code does by itself (no --model, no --effort): Opus at medium effort, on every plan
// and on an API key (code.claude.com/docs/en/model-config, November 2026). What Bridge AI starts it
// with comes before your own saved level in Claude Code's order (--effort is above settings), and
// is for that session only: nothing is written to Claude Code's settings.
// Aliases follow the newest model of each kind (opus is Opus 5.5 now), so this needn't change when
// one comes out. What to look at again then: what a new kind costs, and whether a plan's limits
// have room for it. Fable, the most capable, isn't anyone's default: it costs about 2.5 times what
// Opus does per token (API prices), so it's worth picking for one hard task, not for every agent.
// Prices compared: Sonnet $2/$10 per million tokens in and out, Opus $4/$20, Fable $10/$50.
//   plan     what Claude Code's sign-in calls it (subscriptionType), or api / cloud
//   label    the plan's name, as Bridge AI shows it
//   to       "Recommended for {to}: …"
const CLAUDE = {
  // The tightest limits. Sonnet uses them about half as fast as Opus, so at high effort it thinks
  // harder than Claude Code's default (Opus at medium) for about the same share of the 5-hour window.
  pro: { label: 'Pro', to: tx('your Pro plan'), model: 'sonnet', effort: 'high', why: tx('Pro has the tightest limits. Sonnet uses them about half as fast as Opus, so it can think harder for the same share.') },
  // Room for Opus, the stronger coder, at high effort: better first answers, and a week on Max still
  // lasts. 5x, and Max when the sign-in doesn't say which (claude auth status doesn't, for now).
  max: { label: 'Max', to: tx('your Max plan'), model: 'opus', effort: 'high', why: tx('Room for Opus, the strongest everyday model, at high effort: better first answers, and your week still lasts.') },
  max5: { label: 'Max 5x', to: tx('your Max 5x plan'), model: 'opus', effort: 'high', why: tx('Room for Opus, the strongest everyday model, at high effort: better first answers, and your week still lasts.') },
  // The most room: Opus at extra high, the level Anthropic suggests for most coding and agent work.
  max20: { label: 'Max 20x', to: tx('your Max 20x plan'), model: 'opus', effort: 'xhigh', why: tx('The most room: Opus at extra high effort, the level Anthropic suggests for most coding work.') },
  // A plan above Max 20x: the same.
  ultra: { label: 'Ultra', to: tx('your Ultra plan'), model: 'opus', effort: 'xhigh', why: tx('The most room: Opus at extra high effort, the level Anthropic suggests for most coding work.') },
  // A seat has more room than Pro, and your organization's own cap still applies on top.
  team: { label: 'Team', to: tx('your Team plan'), model: 'opus', effort: 'high', why: tx('A work seat has room for Opus at high effort, and any cap your organization sets still applies.') },
  enterprise: { label: 'Enterprise', to: tx('your Enterprise plan'), model: 'opus', effort: 'high', why: tx('A work seat has room for Opus at high effort, and any cap your organization sets still applies.') },
  // Every token is billed: Sonnet costs half of Opus per token, and medium effort spends fewer.
  api: { label: 'API key', to: tx('an API key'), model: 'sonnet', effort: 'medium', why: tx('Every token is billed to your key. Sonnet costs half as much as Opus, and medium effort spends fewer tokens.') },
}
// Claude through AWS Bedrock, Google Cloud or Microsoft Foundry: their sonnet and haiku are older
// models (Sonnet 4.5 on Bedrock), so a pick made for Anthropic's own would be wrong there. None.
const CLOUD = { label: 'Cloud', to: tx('your cloud provider') }

// The plan, from Claude Code's sign-in check (server/accounts.js): { signedIn, sub: subscriptionType,
// tier: rateLimitTier (only if a future version says it), method: authMethod, provider: apiProvider }.
// null: signed out, or a plan this doesn't know yet.
export function planOf(kind, s) {
  if (kind !== 'claude' || !s?.signedIn) return null
  const low = (x) => String(x || '').toLowerCase()
  if (s.provider && !/^first/i.test(s.provider) && low(s.provider) !== 'anthropic') return 'cloud'
  const sub = low(s.sub)
  const both = `${sub} ${low(s.tier)}`
  if (/max/.test(sub)) return /20x/.test(both) ? 'max20' : /5x/.test(both) ? 'max5' : 'max'
  for (const p of ['ultra', 'pro', 'team', 'enterprise']) if (sub.includes(p)) return p
  if (/api.?key|console/.test(low(s.method))) return 'api'
  return null
}

// What to start with on that plan: { plan, label, to, model, effort, why }; for a cloud provider
// { plan, label, to, none: true }; null for a plan it doesn't know.
export function recommend(kind, plan) {
  if (kind !== 'claude' || !plan) return null
  if (plan === 'cloud') return { plan, ...CLOUD, none: true }
  return CLAUDE[plan] ? { plan, ...CLAUDE[plan] } : null
}

// ---------- For each task ----------
// An effort for what's asked, from its words and size and the files it names: { effort, why },
// or null when nothing in it says (the agent's usual effort is right). Simple on purpose, and
// local: a handful of words, how long it is, how many files. Kinds of work, strongest first.
const HEAVY = [
  [/\b(refactor\w*|restructur\w*|re-?architect\w*|rewrit\w*|rewrote|migrat\w*|overhaul\w*|port (it|this|them|the \w+) to)\b/i, tx('a refactor'), tx('a refactor across many files')],
  [/\b(debug\w*|root cause|race condition|deadlock|memory leak|flaky|intermittent\w*|crash\w*|regression|segfault|stack trace|why (does|do|is|are|did)\b.{0,80}\b(fail|break|crash|hang|slow|wrong|differ))/i, tx('tracking down a bug'), tx('tracking down a bug across the code')],
  [/\b(architect\w*|system design|design (a|an|the|how)|trade-?offs?|plan (out|how|the|a|an)|work out how)\b/i, tx('working out a design'), tx('a design that spans the code')],
  [/\b(security|vulnerab\w*|audit\w*|threat model|code review|review (the|this|all|every|my))\b/i, tx('a careful review'), tx('a careful review of many files')],
  [/\b(implement\w*|build (a|an|the|out)|add support for|new feature|from scratch|end[- ]to[- ]end)\b/i, tx('building something new'), tx('building something across many files')],
  [/\b(performance|optimi[sz]\w*|speed (it |this )?up|bottleneck|profil\w*)\b/i, tx('making it faster'), tx('making it faster across the code')],
]
const WIDE = /\b(across|throughout|everywhere|whole (codebase|repo|project|app)|entire (codebase|repo|project|app)|every (file|module|component|test|page|screen|caller)|all (the |of the )?(files|modules|components|tests|pages|screens|callers|usages|places))\b/i
const SMALL = /\b(typo|rename|bump|one[- ]line|tiny|reformat|format(ting)?|lint|spelling|wording|a comment)\b/i
const QUESTION = /^(what|what's|whats|where|which|who|when|how (do|does|did|can|could|should|to|much|many|is|are)|is (there|it|this)|are (there|we|these)|does|do (we|i|you)|can (you|i) (tell|explain|show|see)|explain|show me|list|tell me)\b/i
// A file named in the message: a name with a code file's extension (billing.py), or a path
// (./lib, src/app/, src/app/main). Not "and/or", nor a web address.
const EXT = /\.(?:jsx?|tsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|css|scss|html|vue|svelte|md|json|ya?ml|toml|sql|sh)$/i
const isFile = (w) => !/^[a-z][\w+.-]*:\/\//i.test(w) && (EXT.test(w) || /^(\.{1,2}|~)?\//.test(w) || /\/$/.test(w) || (w.match(/\//g) || []).length >= 2)
export function filesIn(text) {
  const words = String(text || '').split(/[\s()`'"[\],;!?]+/).map((w) => w.replace(/^@/, '').replace(/[.:]+$/, '')).filter((w) => w.length > 1 && isFile(w))
  return new Set(words.map((w) => w.replace(/^\.\//, ''))).size
}

export function suggestEffort(text) {
  const s = String(text || '').trim()
  if (!s || s.startsWith('/')) return null // a slash command runs as the agent has it
  const words = s.split(/\s+/).length
  const files = filesIn(s)
  const heavy = HEAVY.find(([re]) => re.test(s))
  const wide = WIDE.test(s) || files >= 4
  if (!heavy && !wide && files < 3 && words <= 30) {
    if (SMALL.test(s)) return { effort: 'low', why: tx('a small, simple change') }
    if (QUESTION.test(s) || s.endsWith('?')) return { effort: 'medium', why: tx('a quick question') }
  }
  // From medium: the kind of work, then how far it reaches and how much is asked.
  let score = 1 + (heavy ? 2 : 0) + (wide ? 1 : 0) + (files >= 6 ? 1 : 0) + (words > 150 ? 1 : 0) + (words > 400 ? 1 : 0)
  if (score < 3) return null
  const effort = score >= 5 ? 'xhigh' : 'high'
  const why = heavy ? (wide ? heavy[2] : heavy[1]) : files >= 4 ? tx('a change across many files') : tx('a long, detailed ask')
  return { effort, why }
}
