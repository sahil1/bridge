// The demo's Today panel and settings: usage, schedule, mail, weather and the rest, all made up,
// and shaped the way the server sends them.
import { HOME, code } from './repos.js'

const NOW = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const inH = (h) => iso(NOW + h * 3.6e6)
const day = (offset) => { const d = new Date(NOW); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return d }
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// The same made-up numbers on every visit.
const rand = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

// ---------- Agents installed on the made-up computer ----------
export const CAPS = {
  claude: { chat: true, subagents: true, commands: true, questions: true, inputBox: true, typeAhead: true, rewind: true, undo: true, btw: true, fork: true },
  codex: { chat: true, commands: true, typeAhead: true, fork: true, rewind: true },
  gemini: {},
  opencode: {},
}
export const LABELS = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode' }
export const MODELS = { claude: ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'], codex: ['gpt-6.1-sol', 'gpt-6-luna'] }
// What each agent is on, for the message box's model chip, and what Claude's aliases stand for.
export const MODEL_ON = { claude: 'claude-opus-5-5', codex: 'gpt-6.1-sol' }
export const MODEL_IDS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-1', default: 'claude-opus-5-5' }
export const modelName = (id) => { const m = /^claude-(\w+)-(\d+)-(\d+)$/.exec(id); return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id }
export const kinds = () => Object.keys(CAPS).map((kind) => ({ kind, label: LABELS[kind], path: `/opt/homebrew/bin/${kind}`, caps: CAPS[kind] }))
export const catalog = () => [
  ...Object.keys(CAPS).map((kind) => ({ kind, label: LABELS[kind], installed: true, path: `/opt/homebrew/bin/${kind}`, caps: CAPS[kind], install: null, modelFlag: kind !== 'gemini', models: MODELS[kind] || [] })),
  ...[['copilot', 'GitHub Copilot CLI'], ['cursor', 'Cursor Agent'], ['amp', 'Amp'], ['aider', 'Aider']].map(([kind, label]) => ({ kind, label, installed: false, path: null, caps: {}, install: `npm install -g ${kind}`, modelFlag: false, models: [] })),
]
export const subscriptions = () => catalog().map((a) => ({
  kind: a.kind, label: a.label, installed: a.installed, signedIn: a.installed ? true : false,
  method: a.installed ? (a.kind === 'opencode' ? 'api key' : 'subscription') : null, account: null, plan: a.kind === 'claude' ? 'Max' : a.kind === 'codex' ? 'Plus' : null, hint: null,
}))

// ---------- Usage: two Claude accounts and one Codex ----------
const win = (kind, left, resetH, elapsed) => ({
  id: kind === 'session' ? 'five_hour' : 'seven_day', label: kind === 'session' ? 'session' : 'week', kind, percentRemaining: left, resetsAt: inH(resetH),
  pace: { status: left > 100 - elapsed ? 'behind' : 'ahead', elapsedPercent: elapsed, burnMultiple: null, projectedExhaustedAt: null },
})
const reading = (plan, s, w, sReset, wReset, email) => ({
  plan, status: 'fresh', error: null, hint: null, allow: false, usable: true, percentRemaining: Math.min(s, w), refreshedAt: iso(NOW),
  windows: [win('session', s, sReset, 100 - (sReset / 5) * 100), win('weekly', w, wReset, 100 - (wReset / 168) * 100)], account: { email, organization: null },
})

export function makeAccounts() {
  return {
    claude: { setting: 'auto', accounts: [
      { id: 'claude-default', label: 'Default', isDefault: true, ...reading('max', 64, 71, 2.6, 61, 'you@example.com') },
      { id: 'claude-work', label: 'Work', isDefault: false, ...reading('team', 22, 48, 1.2, 86, 'you.work@example.com') },
    ] },
    codex: { setting: 'codex-default', accounts: [
      { id: 'codex-default', label: 'Default', isDefault: true, ...reading('plus', 85, 90, 3.8, 120, 'you@example.com') },
    ] },
  }
}

// Auto picks the account with the most left.
const pickOf = (g) => [...g.accounts].sort((a, b) => b.percentRemaining - a.percentRemaining)[0].id
export const groups = (accts) => Object.entries(accts).map(([kind, g]) => {
  const pick = pickOf(g)
  const active = g.setting === 'auto' ? pick : g.setting
  return { kind, label: LABELS[kind], installed: true, setting: g.setting, pick, accounts: g.accounts.map((a) => ({ ...a, active: a.id === active, signedIn: true, statusPlan: a.plan === 'max' ? 'Max' : a.plan === 'team' ? 'Team' : a.plan === 'plus' ? 'Plus' : null })) }
})
export function quota(accts) {
  const def = (kind) => accts[kind].accounts[0]
  const provider = (kind) => { const a = def(kind); return { provider: kind, plan: a.plan, status: 'fresh', error: null, hint: null, allow: false, notSetUp: false, usable: true, percentRemaining: a.percentRemaining, pace: 'behind', runway: 'through_reset', spendPriority: kind === 'claude' ? 0.9 : 0.4, account: a.account, refreshedAt: a.refreshedAt, windows: a.windows } }
  return { generatedAt: iso(Date.now()), providers: [provider('claude'), provider('codex')], bestNow: 'claude', accounts: groups(accts), fetchedAt: iso(Date.now()) }
}

export function usage(provider) {
  const r = rand(provider === 'claude' ? 7 : 11)
  const daily = []
  for (let i = 29; i >= 0; i--) {
    const d = day(-i)
    const weekend = d.getDay() === 0 || d.getDay() === 6
    const tokens = weekend && r() < 0.6 ? 0 : Math.round((provider === 'claude' ? 18e6 : 5e6) * (0.4 + r() * 1.3))
    daily.push({ date: ymd(d), cost: +(tokens * (provider === 'claude' ? 1.1e-6 : 0.7e-6)).toFixed(2), tokens, input: Math.round(tokens * 0.02), output: Math.round(tokens * 0.01), cacheRead: Math.round(tokens * 0.86), cacheWrite: Math.round(tokens * 0.11), models: [] })
  }
  const today = { ...daily.at(-1), activeMinutes: 142 }
  const yesterday = { ...daily.at(-2), activeMinutes: 188 }
  return { supported: true, today, yesterday, daily, fetchedAt: iso(Date.now()) }
}

export function usageStats(provider) {
  const r = rand(provider === 'claude' ? 3 : 5)
  const projects = [['acme-shop', code('acme-shop')], ['billing-api', code('billing-api')], ['docs-site', code('docs-site')], ['chief', `${HOME}/.bridge-ai/chief`]]
    .map(([name, path]) => ({ id: name, path: path.replace(HOME, '~'), name }))
  const models = provider === 'claude' ? ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'] : ['GPT-5.5 Codex']
  const days = []
  const cells = []
  for (let i = 119; i >= 0; i--) {
    const d = day(-i)
    const weekend = d.getDay() === 0 || d.getDay() === 6
    const row = { date: ymd(d), cost: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0, sessions: 0, tools: 0 }
    if (!(weekend && r() < 0.65) && r() > 0.06) {
      projects.forEach((p, pi) => models.forEach((m, mi) => {
        if (r() < 0.35) return
        const t = Math.round((pi === 0 ? 7e6 : 3e6) * (mi === 0 ? 1.4 : 0.6) * (0.3 + r()))
        const c = +(t * (mi === 0 ? 1.6e-6 : 0.5e-6)).toFixed(4)
        cells.push([row.date, pi, mi, t, c])
        row.tokens += t
        row.cost += c
      }))
      row.cacheRead = Math.round(row.tokens * 0.86)
      row.cacheWrite = Math.round(row.tokens * 0.1)
      row.input = Math.round(row.tokens * 0.03)
      row.output = Math.round(row.tokens * 0.01)
      row.messages = Math.round(row.tokens / 9e4)
      row.sessions = 2 + Math.round(r() * 9)
      row.tools = Math.round(row.messages * 1.7)
    }
    days.push(row)
  }
  const hours = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), h < 8 || h > 22 ? Math.round(r() * 6) : Math.round(40 + 120 * Math.sin(((h - 8) / 14) * Math.PI) * (0.7 + r() * 0.5))]))
  return {
    supported: true, provider, days, models, projects, cells, hours, tokensFrom: days.find((x) => x.tokens)?.date || null,
    totals: provider === 'claude' ? { sessions: days.reduce((s, x) => s + x.sessions, 0), messages: days.reduce((s, x) => s + x.messages, 0), firstSessionDate: iso(day(-119).getTime()), longestSession: { duration: 4.2 * 3.6e6, messageCount: 640, timestamp: iso(day(-12).getTime()) }, countsThrough: ymd(day(-1)) } : null,
    source: 'made up for the demo', fetchedAt: iso(Date.now()),
  }
}

// ---------- Schedule ----------
// Meetings around now, so the demo always has a "next" one. Everything is invented.
const slot = (d, h, m, mins) => { const s = new Date(d); s.setHours(h, m, 0, 0); return { start: s, end: new Date(s.getTime() + mins * 6e4) } }
const event = (title, { start, end }, o = {}) => ({ id: `${title}|${start.toISOString()}`, title, canceled: false, calendar: o.calendar || 'Work', start: start.toISOString(), end: end.toISOString(), allDay: false, location: o.location || null, online: !!o.online, join: null, attendees: [], attendeeCount: o.people || 0, agenda: o.agenda || null })

function eventsOn(d) {
  const wd = d.getDay()
  if (wd === 0 || wd === 6) return wd === 6 ? [event('Farmers market', slot(d, 9, 30, 90), { calendar: 'Personal' })] : []
  const list = [
    event('Team standup', slot(d, 9, 30, 15), { online: true, people: 6, agenda: 'What shipped, what is blocked.' }),
    event('Focus: checkout flow', slot(d, 10, 0, 120), { calendar: 'Personal' }),
    event('Lunch', slot(d, 12, 30, 45), { calendar: 'Personal' }),
  ]
  if (wd === 2 || wd === 4) list.push(event('Design review: orders page', slot(d, 14, 0, 45), { online: true, people: 4, agenda: 'CSV export, empty states, filters on mobile.' }))
  if (wd === 1 || wd === 3) list.push(event('1:1', slot(d, 15, 30, 30), { online: true, people: 2 }))
  if (wd === 5) list.push(event('Demo day', slot(d, 16, 0, 60), { online: true, people: 14, agenda: 'Show what each team shipped this week.' }))
  return list
}

// Today: a meeting going on or coming up soon, whatever the time of day.
function today() {
  const d = new Date(NOW)
  const list = eventsOn(d).filter((e) => new Date(e.start).toDateString() === d.toDateString())
  const start = new Date(NOW + 25 * 6e4)
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0)
  if (!list.some((e) => new Date(e.start) > NOW)) list.push(event('Release check-in', { start, end: new Date(start.getTime() + 30 * 6e4) }, { online: true, people: 5, agenda: 'Go or no-go for the login fix and CSV export.' }))
  return list.sort((a, b) => (a.start < b.start ? -1 : 1))
}

export const calendar = () => ({ today: today(), tomorrow: eventsOn(day(1)), fetchedAt: iso(Date.now()) })
export function calendarRange(from, to) {
  const out = []
  for (let d = new Date(`${from}T12:00`); ymd(d) <= to; d = new Date(d.getTime() + 864e5)) out.push(...(ymd(d) === ymd(new Date(NOW)) ? today() : eventsOn(d)))
  return { from, to, events: out, light: false, fetchedAt: iso(Date.now()) }
}

// ---------- Mail ----------
const mailAt = (h) => iso(NOW - h * 3.6e6)
const MAIL = [
  { id: 'm1', conv: 1, from: 'Design team', address: 'design@example.com', subject: 'Orders page: CSV export mockups', snippet: 'Here are the two options for where the export button goes. We lean toward the header.', ai: 'Wants you to pick one of two button placements by Thursday.', reasons: ['Asks you', 'Just to you'], received: mailAt(1.5), read: false, flagged: false, bucket: 'needs', score: 9 },
  { id: 'm2', conv: 2, from: 'Support', address: 'support@example.com', subject: 'Customers stuck on the home page after signing in', snippet: 'Three tickets this morning: people sign in from a product page and lose their place.', ai: 'Reports the login redirect bug; asks for an ETA.', reasons: ['Asks you', 'Urgent'], received: mailAt(3), read: false, flagged: true, bucket: 'needs', score: 10 },
  { id: 'm3', conv: 3, from: 'Finance', address: 'finance@example.com', subject: 'Tax totals off by a cent on some receipts', snippet: 'A few receipts in Texas show a one-cent difference from our ledger.', ai: 'Likely the rounding bug the billing agent just fixed.', reasons: ['Asks you'], received: mailAt(20), read: true, flagged: false, bucket: 'needs', score: 7 },
  { id: 'm4', conv: 4, from: 'CI', address: 'ci@example.com', subject: 'billing-api: build passed on main', snippet: 'All checks passed for b81f0a3.', ai: null, reasons: [], received: mailAt(22), read: true, flagged: false, bucket: 'action', score: 2 },
  { id: 'm5', conv: 5, from: 'Cloud billing', address: 'billing@example.com', subject: 'Your invoice for October is ready', snippet: 'Your invoice is available in the dashboard.', ai: null, reasons: ['Action needed'], received: mailAt(30), read: false, flagged: false, bucket: 'action', score: 3 },
]
export const mail = () => ({ available: true, messages: MAIL, waiting: [{ id: 'w1', subject: 'Webhook retries: what do you need from us?', to: 'Payments partner', sent: mailAt(48) }], unread: 3, flagged: 1, today: 2, action: 1, rules: { vip: [], mute: [] }, fetchedAt: iso(Date.now()) })
export function mailMessage(id) {
  const m = MAIL.find((x) => x.id === id)
  if (!m) throw Object.assign(new Error('No such message'), { status: 404 })
  return { from: `${m.from} <${m.address}>`, to: 'you@example.com', cc: '', subject: m.subject, latest: `${m.snippet}\n\nThanks!`, quoted: '', attachments: m.id === 'm1' ? ['export-header.png', 'export-menu.png'] : [], thread: [{ id: m.id, from: m.from, mine: false, received: m.received, snippet: m.snippet }] }
}

// ---------- Weather ----------
export function weather() {
  const r = rand(19)
  return {
    location: 'Springfield', fetchedAt: iso(Date.now()),
    current: { temp: 64, feels: 62, humidity: 58, wind: 7, code: 2, summary: 'Partly cloudy' },
    daily: Array.from({ length: 7 }, (_, i) => ({ date: ymd(day(i)), hi: Math.round(66 + r() * 8), lo: Math.round(50 + r() * 6), code: [2, 1, 0, 61, 3, 1, 0][i], rain: [10, 0, 0, 70, 30, 0, 0][i] })),
  }
}

// ---------- Routines and ideas ----------
export function makeRoutines() {
  return [
    { id: 'r1', name: 'Dependency check', command: '/deps-check', cwd: '~/code/acme-shop', every: 'week', workspace: 'acme-shop', state: 'due', note: 'due today', last: { at: iso(NOW - 7.2 * 864e5), source: 'Claude Code' }, lastLaunch: null, link: null },
    { id: 'r2', name: 'Triage new issues', command: 'Triage new GitHub issues and label them', cwd: '~/code/acme-shop', every: 'weekday', workspace: 'acme-shop', state: 'ok', note: null, last: { at: iso(NOW - 20 * 3.6e6), source: 'Claude Code' }, lastLaunch: null, link: null },
    { id: 'r3', name: 'Docs link check', command: 'npm run check-links', cwd: '~/code/docs-site', every: '2w', workspace: 'docs-site', state: 'ok', note: null, last: { at: iso(NOW - 26 * 6e4), source: 'Gemini CLI' }, lastLaunch: null, link: null },
  ]
}
export function makeIdeas() {
  return [
    { id: 'i1', text: 'Saved carts that follow you between devices', raw: 'Saved carts that follow you between devices #shop', tags: ['shop'], done: false, sent: null },
    { id: 'i2', text: 'Weekly email with order stats', raw: 'Weekly email with order stats #billing', tags: ['billing'], done: false, sent: null },
    { id: 'i3', text: 'Dark mode for the docs', raw: 'Dark mode for the docs #docs', tags: ['docs'], done: false, sent: null },
    { id: 'i4', text: 'Retry failed webhooks with backoff', raw: 'Retry failed webhooks with backoff #billing', tags: ['billing'], done: true, sent: null },
  ]
}

// The chief of staff's own tasks: work it did itself, one waiting on you, one from you.
export function makeChiefTasks() {
  const on = (offset) => day(offset).toLocaleDateString('en-CA')
  return [
    { id: '5', title: 'Draft a reply to the Acme Goods support thread', status: 'open', added: on(0), from: 'you' },
    { id: '4', title: 'Plan the webhook rate limit rollout', status: 'doing', added: on(0) },
    { id: '3', title: 'Draft the release notes for 1.8', status: 'waiting', added: on(-1), needs: 'Should CSV export be in them, or wait until it merges?' },
    { id: '2', title: "Summarize this week's agent work for the Monday update", status: 'done', added: on(-1), done: on(-1), outcome: 'Login redirect fixed, CSV export under way, billing tests cleaned up. Ready to paste.', link: 'work/monday-update/update.md' },
    { id: '1', title: 'Compare error trackers for acme-shop', status: 'done', added: on(-3), done: on(-2), outcome: 'Sentry fits best: the free tier covers our volume. Bugsnag is a close second.', link: 'work/error-trackers/comparison.md' },
  ]
}

// ---------- Settings ----------
export const CONFIG = {
  runtime: 'builtin', defaultAgent: 'claude', name: '', location: { label: 'Springfield', lat: 39.8, lon: -89.6, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  chief: { kind: 'claude' }, agents: { claude: { model: 'opus' } }, quota: { ttlMinutes: 5 }, setupDone: true,
}
export const DEFAULTS = {
  port: 7420, host: '127.0.0.1', runtime: 'builtin', defaultAgent: 'claude', name: '', location: null, chief: { kind: 'claude' },
  assistant: { kind: null, cwd: '~' }, mail: { myDomains: [] }, allowedHosts: [], quota: { ttlMinutes: 5, hideNotSetUp: true },
}
export const settingsView = (cfg) => ({ file: '~/.bridge-ai/config.json', raw: `${JSON.stringify(cfg, null, 2)}\n`, user: cfg, defaults: DEFAULTS, effective: { ...DEFAULTS, ...cfg }, restartKeys: ['port', 'host', 'runtime', 'herdr', 'allowedHosts'] })

const provider = (id, name, group, description, agents, env, o = {}) => ({ id, name, group, description, keyUrl: null, agents, testable: !o.local, local: !!o.local, fields: env ? [{ env, label: 'API key', type: 'secret', optional: false, placeholder: '' }] : [], status: o.status || 'not set', source: o.source || null, ...(o.models ? { models: o.models } : {}) })
export const providers = () => ({ providers: [
  provider('anthropic', 'Anthropic', 'labs', 'Claude models through the Anthropic API.', ['claude', 'opencode', 'aider'], 'ANTHROPIC_API_KEY'),
  provider('openai', 'OpenAI', 'labs', 'GPT models through the OpenAI API.', ['codex', 'opencode', 'aider'], 'OPENAI_API_KEY', { status: 'connected', source: 'bridge' }),
  provider('gemini', 'Google Gemini', 'labs', 'Gemini models through Google AI Studio.', ['gemini', 'opencode'], 'GEMINI_API_KEY'),
  provider('mistral', 'Mistral', 'labs', 'Mistral and Codestral models.', ['opencode', 'aider'], 'MISTRAL_API_KEY'),
  provider('bedrock', 'Amazon Bedrock', 'clouds', 'Claude and other models in your AWS account.', ['claude', 'opencode'], null),
  provider('vertex', 'Google Vertex AI', 'clouds', 'Claude and Gemini in your Google Cloud project.', ['claude', 'gemini'], null),
  provider('openrouter', 'OpenRouter', 'hosted', 'Hundreds of models behind one key.', ['opencode', 'aider'], 'OPENROUTER_API_KEY'),
  provider('groq', 'Groq', 'hosted', 'Fast open models.', ['opencode', 'aider'], 'GROQ_API_KEY'),
  provider('ollama', 'Ollama', 'local', 'Models running on your own computer.', ['opencode', 'aider'], null, { local: true, status: 'connected', source: 'local', models: ['qwen3-coder', 'llama4'] }),
  provider('lmstudio', 'LM Studio', 'local', 'Models running in LM Studio.', ['opencode', 'aider'], null, { local: true }),
] })

export const consult = () => [
  { id: 'claude', label: 'Claude', cli: 'claude', api: 'anthropic', good: 'careful reasoning, writing, code review', available: true, via: 'Claude Code', route: null },
  { id: 'gpt', label: 'GPT (OpenAI)', cli: 'codex', api: 'openai', good: 'a second opinion from a different lab, code', available: true, via: 'Codex', route: null },
  { id: 'gemini', label: 'Gemini', cli: 'gemini', api: 'gemini', good: 'long documents, search-grounded answers', available: true, via: 'Gemini CLI', route: null },
]

export const mcp = () => {
  const on = (...kinds) => kinds.map((kind) => ({ kind, label: LABELS[kind], scope: 'user', source: kind === 'claude' ? '~/.claude.json' : '~/.codex/config.toml' }))
  return {
    servers: [
      { name: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', args: [], envKeys: [], headerKeys: ['Authorization'], redacted: false, agents: on('claude', 'codex') },
      { name: 'playwright', transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], envKeys: [], headerKeys: [], redacted: false, agents: on('claude') },
    ],
    agents: [
      { kind: 'claude', label: 'Claude Code', file: '~/.claude.json', transports: ['stdio', 'http', 'sse'], method: 'cli' },
      { kind: 'codex', label: 'Codex', file: '~/.codex/config.toml', transports: ['stdio', 'http'], method: 'cli' },
    ],
    unsupported: [],
  }
}

// ---------- Search and history ----------
export const archive = () => ({ items: [
  { id: 'a1', sessionId: 'demo-old-checkout', kind: 'claude', label: 'Speed up checkout', workspace: 'acme-shop', cwd: '~/code/acme-shop', fullCwd: code('acme-shop'), closedAt: iso(NOW - 2 * 864e5), preview: 'Checkout loads in 1.1s now, down from 2.8s: the payment script loads after the page.', paneId: null },
  { id: 'a2', sessionId: 'demo-old-invoices', kind: 'codex', label: 'Invoice PDFs', workspace: 'billing-api', cwd: '~/code/billing-api', fullCwd: code('billing-api'), closedAt: iso(NOW - 5 * 864e5), preview: 'Invoices download as PDF from the dashboard, with the tax lines broken out.', paneId: null },
] })
