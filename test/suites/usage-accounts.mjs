// Each account's color, and Usage's daily bars and today's cost split by account
// (server/usagesplit.js, accounts.js; src/components/Usage.jsx, AccountMenu.jsx), in the browser
// named by BRIDGE_TEST_BROWSER, in a light and a dark theme, on a computer and a phone.
// Three Claude Code accounts share one history, as they do: your usual login (named Main), Work and
// Side, with a month of conversations in the logs (made up here), and what says which account ran
// each: Work's own folder and your usual one record two of them (session-env), Bridge AI saw one
// run on Side and then on Work (its record of stretches), and remembers another was started on
// Side (when, not kept). The checks:
//   Attribution: each conversation's tokens go to the account known to have run it, a
//     subagent's with its conversation's, a reply logged twice counted once; one that moved goes
//     to each account by when; one nothing records, or a stretch two accounts could have run, is
//     Not known. The parts add up to the day's cost and tokens, which stay ccusage's.
//   Insights (server/insights.js), by the same rule: each account's conversations and Not known
//     for the ones nothing records (never your usual login's), a conversation that moved counted
//     on each account it ran on; the write-up's digest says the same; the Usage tab's By account
//     tokens are the bars' to the token; the Insights card's By account has Not known too.
//   Live: an agent Bridge AI starts on Work and sees running goes to Work; a one-off answer
//     (a question asked through Claude Code) is noted on the account it ran on.
//   Colors: each account has its own by default (in the order added), the same in every list; one
//     picked is kept and the others keep theirs; a new account takes one not taken; one removed
//     takes nothing from the others; a color out of range is refused.
//   The heatmap with Home on: Home's page is .hm (needshome.css), which once stretched the
//     heatmap's squares; with Home opened first, they're square and in their levels' colors.
//   The page: the card's swatch opens the colors and a pick shows everywhere at once (the header's
//     bars, the account's dot, the chart's legend, the top bar's menu, New agent's account picker);
//     the chart stacked by account with Not known in grey, a legend, a line saying what's counted,
//     and today's cost by account. On a phone, nothing wider than the screen and whole targets.
// It holds at any time of day, past midnight too: what today has is worked out from what was put
// on each day, not taken to be everything of the last few minutes. BRIDGE_TEST_CLOCK=HH:MM runs it
// at the last time it was that (today's, or yesterday's while it's still to come): the server
// through stand-ins/clock.mjs, the pages through Playwright's clock. Never later than now, as the
// session-env folders' times are set back to when each conversation began, and a folder's made
// time (now) mustn't come before that.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { startKit, startLocalModel, checks, until, sleep, browser, page, shot, phoneFaults, noServiceWorker, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('usage-accounts')
const CLOCK = /^(\d\d):(\d\d)$/.exec(process.env.BRIDGE_TEST_CLOCK || '')
const NOW = (() => {
  if (!CLOCK) return Date.now()
  const d = new Date()
  d.setHours(+CLOCK[1], +CLOCK[2], 0, 0)
  if (+d > Date.now()) d.setDate(d.getDate() - 1)
  return +d
})()
const OFFSET = NOW - Date.now()
if (CLOCK) console.log(`usage-accounts: run at ${new Date(NOW).toString()}`)
const clockNow = () => Date.now() + OFFSET
const ago = (min) => new Date(NOW - min * 60000)
const ymd = (t) => new Date(t).toLocaleDateString('en-CA')
const WORK = 'claude-aaaa0001', SIDE = 'claude-bbbb0002', MAIN = 'claude-default'
const sid = () => crypto.randomUUID()
const S = { work: sid(), main: sid(), none: sid(), moved: sid(), sub: sid(), legacy: sid(), both: sid() }
const SONNET = 'claude-sonnet-4-5-20250929', HAIKU = 'claude-haiku-4-5-20251001'
// One reply, as an agent's are: 2,000 in, 3,000 out, 400,000 read from the cache and 20,000
// written to it (425,000 tokens).
const PER = 425000
let n = 0
const reply = (session, at, model) => ({
  type: 'assistant', sessionId: session, timestamp: at.toISOString(), requestId: `req_${++n}`, cwd: '/work/app', isSidechain: false,
  message: { id: `msg_${n}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'Done.' }], usage: { input_tokens: 2000, output_tokens: 3000, cache_read_input_tokens: 400000, cache_creation_input_tokens: 20000 } },
})
const want = { [MAIN]: 0, [WORK]: 0, [SIDE]: 0, '?': 0 }
// Each day's tokens by account, as put in the logs (local days, as the server counts them).
const byDay = {}
const put = (at, who) => { const d = (byDay[ymd(at)] ||= {}); d[who] = (d[who] || 0) + PER }
// The conversations each account (or Not known) ran some of, for Insights.
const convs = { [MAIN]: new Set(), [WORK]: new Set(), [SIDE]: new Set(), '?': new Set() }
const legacy = {}

const seed = ({ data, home, bin }) => {
  // ccusage (the day's cost and tokens) runs on node, which a kit's PATH doesn't have.
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'node.cmd'), `@"${process.execPath}" %*\r\n`)
  else fs.symlinkSync(process.execPath, path.join(bin, 'node'))
  const proj = path.join(home, '.claude', 'projects', '-work-app')
  const log = (file, lines) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n') }
  // A reply, after a message from you a minute before it (a minute active, for Insights).
  const say = (session, min, model, who, file = path.join(proj, `${session}.jsonl`)) => {
    const sub = file !== path.join(proj, `${session}.jsonl`)
    log(file, [...(sub ? [] : [{ type: 'user', sessionId: session, timestamp: ago(min + 1).toISOString(), cwd: '/work/app', message: { role: 'user', content: 'Go on.' } }]), reply(session, ago(min), model)])
    want[who] += PER
    put(ago(min), who)
    if (!sub) convs[who].add(session)
  }
  // Work: its own folder records it; two replies today, one logged in two parts (counted once),
  // and a subagent's log in the conversation's folder.
  say(S.work, 3, SONNET, WORK)
  const twice = reply(S.work, ago(2), SONNET)
  log(path.join(proj, `${S.work}.jsonl`), [twice, { ...twice, message: { ...twice.message, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } }])
  want[WORK] += PER
  put(ago(2), WORK)
  say(S.work, 2, HAIKU, WORK, path.join(proj, S.work, 'subagents', 'agent-a1.jsonl'))
  // Main (your usual login): its folder records it; yesterday and today.
  say(S.main, 24 * 60, SONNET, MAIN)
  say(S.main, 30, SONNET, MAIN)
  // Nothing records this one: Not known.
  say(S.none, 20, SONNET, '?')
  // Seen on Side, then on Work: each stretch to the one it was seen on; between them, only Side had
  // started it; after Work's stretch, either could have.
  say(S.moved, 180, HAIKU, SIDE)
  say(S.moved, 120, HAIKU, SIDE)
  say(S.moved, 60, HAIKU, WORK)
  say(S.moved, 10, HAIKU, '?')
  // Started on Side from here, when not kept: Side's.
  say(S.legacy, 3 * 24 * 60, SONNET, SIDE)
  // Main's folder first, Work's later (moved in a terminal): Main's until Work's began, then not known.
  say(S.both, 200, SONNET, MAIN)
  say(S.both, 50, SONNET, '?')
  // The weeks before, at midday: Work's conversations (its folder records each), Main's every other
  // day, Side's every third (started from here), and now and then one nothing records.
  const env = []
  for (let d = 2; d <= 20; d++) {
    const noon = new Date(NOW - d * 864e5)
    noon.setHours(12, 0, 0, 0)
    const min = (NOW - noon) / 60000
    const day = (who, replies, where) => {
      const session = sid()
      for (let i = 0; i < replies; i++) say(session, min - i * 20, i % 2 ? HAIKU : SONNET, who)
      if (where) env.push([where, session, min + 10])
      if (who === SIDE) legacy[session] = SIDE
    }
    day(WORK, 2 + (d % 3), 'work')
    if (d % 2) day(MAIN, 1 + (d % 4), 'main')
    if (d % 3 === 0) day(SIDE, 2)
    if (d % 4 === 0) day('?', 1)
  }

  // The accounts, as accounts.js keeps them, and what each one's own folder records.
  fs.writeFileSync(path.join(data, 'accounts.json'), JSON.stringify({
    accounts: [{ id: WORK, kind: 'claude', label: 'Work', createdAt: ago(9000).toISOString() }, { id: SIDE, kind: 'claude', label: 'Side', createdAt: ago(8000).toISOString() }],
    active: { claude: MAIN }, names: { claude: 'Main' },
  }))
  // (Set as much the other way as the clock is moved: at another time, the server's stat says a
  // file's times by its clock, as stand-ins/clock.mjs has it, and would move these twice.)
  const ran = (dir, session, min) => { const d = path.join(dir, 'session-env', session); fs.mkdirSync(d, { recursive: true }); const at = new Date(+ago(min) - OFFSET); fs.utimesSync(d, at, at) }
  ran(path.join(data, 'accounts', WORK), S.work, 300)
  ran(path.join(home, '.claude'), S.main, 26 * 60)
  ran(path.join(home, '.claude'), S.both, 300)
  ran(path.join(data, 'accounts', WORK), S.both, 100)
  for (const [where, session, min] of env) ran(where === 'work' ? path.join(data, 'accounts', WORK) : path.join(home, '.claude'), session, min)
  fs.writeFileSync(path.join(data, 'account-use.json'), JSON.stringify({
    panes: {}, sessions: { ...legacy, [S.legacy]: SIDE },
    runs: { [S.moved]: [[SIDE, +ago(200), +ago(150)], [WORK, +ago(90), +ago(30)]] },
  }))
  return CLOCK ? { NODE_OPTIONS: `--import=${pathToFileURL(path.join(TEST, 'stand-ins', 'clock.mjs')).href}`, BRIDGE_TEST_CLOCK_OFFSET: String(OFFSET) } : {}
}
// A model on this computer to write the insights with, so the digest it's given can be read.
const ollama = await startLocalModel('usage-accounts', 'ollama', [{ name: 'llama3.2:3b', context: 131072, loaded: 131072, params: '3.2B' }])
const kit = await startKit('usage-accounts', { env: seed })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const usage = () => kit.api('/usage/claude?refresh=1')
const totals = (v) => {
  const out = {}
  for (const d of v.daily) for (const [k, x] of Object.entries(d.by || {})) { out[k] = out[k] || [0, 0, 0]; for (let i = 0; i < 3; i++) out[k][i] += x[i] }
  return out
}
const claudeOf = async () => (await kit.api('/accounts')).find((g) => g.kind === 'claude')
const colors = async () => Object.fromEntries((await claudeOf()).accounts.map((a) => [a.id, a.color]))
const pages = []
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')

  // ---------- Which account each conversation was on ----------
  const v = await usage()
  const tot = totals(v)
  const tok = (id) => Math.round(tot[id]?.[1] || 0)
  ok(v.accounts?.accounts?.map((a) => a.id).join() === [MAIN, WORK, SIDE].join() && v.accounts.accounts.every((a) => a.label && a.color), 'with several accounts, the days come split by account: each one listed, by name and color', v.accounts)
  ok(tok(WORK) === want[WORK], "Work: the conversation its own folder records, its subagent's log, a reply logged twice counted once, and the stretch Bridge AI saw it run on Work", { got: tok(WORK), want: want[WORK] })
  ok(tok(MAIN) === want[MAIN], 'Main: what your usual folder records, and a conversation until another account began on it', { got: tok(MAIN), want: want[MAIN] })
  ok(tok(SIDE) === want[SIDE], 'Side: the stretches seen on it, before any other account had the conversation, and one started on it from here', { got: tok(SIDE), want: want[SIDE] })
  ok(tok('?') === want['?'], "Not known: a conversation nothing records, and stretches two accounts could have run", { got: tok('?'), want: want['?'] })
  const day = v.daily.filter((d) => d.tokens > 0)
  const adds = day.every((d) => { const by = Object.values(d.by || {}); return Math.abs(by.reduce((s, x) => s + x[1], 0) - d.tokens) <= by.length && Math.abs(by.reduce((s, x) => s + x[0], 0) - d.cost) < 0.001 * by.length + 1e-9 })
  ok(day.length >= 2 && adds, "each day's parts add up to its cost and tokens, which stay ccusage's", day.map((d) => ({ date: d.date, cost: d.cost, tokens: d.tokens, by: d.by })))
  // Today: what was put on it, by account (nothing yet, just after midnight).
  const today0 = byDay[v.today.date] || {}
  const sameDay = (got, wanted) => Object.keys(wanted).every((id) => Math.round(got?.[id]?.[1] || 0) === wanted[id] && got[id][0] > 0) && Object.keys(got || {}).every((id) => wanted[id])
  ok(v.today.date === ymd(clockNow()) && sameDay(v.today.by, today0), "today's cost and tokens by account: each account's part of what was used today", { today: v.today, want: today0 })

  // ---------- Insights, by the same rule ----------
  const ins = (await kit.api('/insights?refresh=1')).stats
  const insRow = (id) => ins.accounts.find((a) => a.kind === 'claude' && a.id === id)
  const count = (id) => insRow(id)?.sessions || 0
  ok([MAIN, WORK, SIDE, '?'].every((id) => count(id) === convs[id].size), "Insights by account: each account's conversations, one that moved on each it ran on, and Not known for those nothing records", { got: ins.accounts.map((a) => [a.id, a.sessions]), want: Object.fromEntries(Object.entries(convs).map(([k, v]) => [k, v.size])) })
  ok(insRow('?')?.account === 'Not known' && ins.accounts.at(-1)?.id === '?' && !convs[MAIN].has(S.none), 'the conversation nothing records is Not known (listed last), not your usual login\'s', ins.accounts)
  await kit.api('/providers/ollama', { values: { OLLAMA_HOST: ollama.url } }, 'PUT')
  await kit.api('/insights/run', { who: 'local' }).catch((e) => ({ error: e.message }))
  const digestSent = await until(() => ollama.sent().map((x) => x.user || '').find((u) => /Bridge AI insights digest/.test(u)), 20000)
  const byLine = (digestSent || '').split('\n').find((l) => l.startsWith('By account:')) || ''
  ok(/Claude Code on Main: \d+ session/.test(byLine) && /Claude Code on no account known \(nothing records which\): \d+ session/.test(byLine), "the write-up's digest by account says the same: Main's, and those nothing records as such", byLine || digestSent)
  ok(/Claude Code \(account not known\)/.test(digestSent || '') && /Claude Code \(Side, Work and an account not known\)/.test(digestSent || ''), "and each conversation in it says its accounts: one nothing records as not known, one that moved by each it ran on", (digestSent || '').slice(0, 1500))
  const stats = await kit.api('/usage/all/stats?refresh=1')
  const now = totals(await usage())
  const statRow = (id) => stats.accounts?.find((a) => a.kind === 'claude' && a.id === id)
  ok([MAIN, WORK, SIDE, '?'].every((id) => statRow(id)?.tokens === Math.round(now[id]?.[1] || 0)), "the Usage tab's By account tokens are the daily bars' by account, to the token, Not known included", { stats: stats.accounts, bars: now })

  // ---------- Live: an agent started on Work, seen running ----------
  const dir = path.join(kit.home, 'work', 'live')
  fs.mkdirSync(dir, { recursive: true })
  const l = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Live', newSpace: 'Live', prompt: 'idle', account: WORK })
  const agent = await until(async () => ((await kit.api('/fleet')).agents || []).find((a) => a.paneId === l.paneId && a.sessionId && a.accountId === WORK), 30000, 500)
  ok(!!agent, '(an agent runs on Work)', agent)
  if (agent) {
    // In a subagent's log of the conversation: the stand-in keeps writing its own log from where it
    // was, over anything added to it meanwhile (it did, on a slow Windows runner).
    const file = path.join(kit.home, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'), agent.sessionId, 'subagents', 'agent-live.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const at = new Date(clockNow())
    fs.appendFileSync(file, `${JSON.stringify({ ...reply(agent.sessionId, at, SONNET), cwd: dir })}\n`)
    put(at, WORK)
    for (let i = 0; i < 3; i++) { await kit.api('/fleet'); await sleep(400) }
    const after = totals(await usage())
    ok(Math.round(after[WORK]?.[1] || 0) === want[WORK] + PER, 'a reply from an agent Bridge AI started on Work and saw running goes to Work', { work: after[WORK], want: want[WORK] + PER })
  }
  // A one-off answer through Claude Code, on the account new agents start on (Side, now): noted
  // with the conversation it says it was.
  await kit.api(`/accounts/active/claude`, { id: SIDE })
  const asked = await kit.api('/consult', { who: 'claude', prompt: 'What is two and two?', via: 'cli' }).catch((e) => ({ error: e.message }))
  const use = () => { try { return JSON.parse(fs.readFileSync(path.join(kit.data, 'account-use.json'), 'utf8')) } catch { return {} } }
  const printed = await until(() => use().runs?.['print-0001'], 8000)
  ok(!asked.error && printed?.[0]?.[0] === SIDE && printed[0][1] <= printed[0][2], 'a one-off answer is noted on the account it ran on, from when to when', { asked, printed })
  await kit.api(`/accounts/active/claude`, { id: MAIN })

  // ---------- Colors ----------
  const c0 = await colors()
  ok(c0[MAIN] === 1 && c0[WORK] === 2 && c0[SIDE] === 3, 'each account has its own color to start with, in the order they were added', c0)
  const q = await kit.api('/quota')
  const qc = Object.fromEntries((q.accounts?.find((g) => g.kind === 'claude')?.accounts || []).map((a) => [a.id, a.color]))
  ok(JSON.stringify(qc) === JSON.stringify(c0), 'the same in Usage and the top bar as in Settings', { quota: qc, settings: c0 })
  const set = await kit.api(`/accounts/${SIDE}/color`, { color: 2 })
  const c1 = await colors()
  ok(set.color === 2 && c1[SIDE] === 2 && c1[WORK] === 2 && c1[MAIN] === 1, 'a color picked is kept, and the others keep theirs (even the one that had it)', c1)
  await kit.api(`/accounts/${SIDE}/color`, { color: 5 })
  const bad = await kit.api(`/accounts/${SIDE}/color`, { color: 9 }).then(() => null, (e) => e)
  ok(bad?.status >= 400 && /1 to 8/.test(bad.message), 'a color out of range is refused, saying why', bad?.message)
  const extra = await kit.api('/accounts', { kind: 'claude', label: 'Spare' })
  const c2 = await colors()
  ok(c2[extra.id] === 3 && c2[MAIN] === 1 && c2[WORK] === 2 && c2[SIDE] === 5, 'a new account takes the first color not taken', c2)
  await kit.api(`/accounts/order/claude`, { ids: [SIDE, extra.id, WORK, MAIN] })
  const c3 = await colors()
  await kit.api(`/accounts/${extra.id}`, null, 'DELETE')
  const c4 = await colors()
  ok(Object.keys(c2).every((id) => c3[id] === c2[id]) && c4[MAIN] === 1 && c4[WORK] === 2 && c4[SIDE] === 5 && !(extra.id in c4), 'a new order repaints none, nor does removing one', { c3, c4 })
  await kit.api(`/accounts/order/claude`, { ids: [MAIN, WORK, SIDE] })

  // ---------- The page ----------
  // Plan usage, made up (it reads real accounts): each account's 5-hour window and week, Side's
  // nearly out. Laid over the server's own list, so a color picked shows.
  const at = (h) => new Date(Date.now() + h * 3600e3).toISOString()
  const left = { [MAIN]: [70, 55], [WORK]: [40, 62], [SIDE]: [6, 30] }
  const windows = (id) => [
    { id: 'session', kind: 'session', label: 'Session', percentRemaining: left[id][0], resetsAt: at(2) },
    { id: 'weekly', kind: 'weekly', label: 'Weekly', percentRemaining: left[id][1], resetsAt: at(70) },
  ]
  const quota = async () => {
    const live = await kit.api('/quota')
    return {
      generatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), bestNow: 'claude', stale: false,
      providers: [{ provider: 'claude', usable: true, status: 'ok', plan: 'team', percentRemaining: 55, windows: windows(MAIN) }],
      accounts: live.accounts.filter((g) => g.kind === 'claude').map((g) => ({ ...g, accounts: g.accounts.map((a) => ({ ...a, signedIn: true, usable: true, status: 'ok', plan: a.id === SIDE ? 'max' : 'team', percentRemaining: Math.min(...left[a.id]), windows: windows(a.id) })) })),
    }
  }
  const fake = async (c) => {
    await noServiceWorker(c)
    if (CLOCK) await c.clock.install({ time: clockNow() })
    await c.route(/\/api\/quota(\?|$)/, async (r) => r.fulfill({ json: await quota() }))
  }
  // What the page shows (Usage's last answer, kept for a few minutes), and who's on a day of it.
  const NAME = { [MAIN]: 'Main', [WORK]: 'Work', [SIDE]: 'Side', '?': 'Not known' }
  const shownNow = () => kit.api('/usage/claude')
  const onDay = (d) => Object.entries(d?.by || {}).filter(([, x]) => x[0] > 0).map(([id]) => NAME[id])
  const openUsage = async (p) => {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-card', { detail: { id: 'gauge' } })))
    const card = p.locator('.usage-card').first()
    await card.waitFor({ timeout: 15000 })
    const head = card.locator('.prov-head').first()
    await head.waitFor({ timeout: 10000 })
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
    await card.locator('.acct-u-head').first().waitFor({ timeout: 10000 })
    return card
  }
  const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
  const fill = (loc) => loc.evaluate((el) => getComputedStyle(el).fill)
  const series = (p, k) => p.evaluate((k) => { const x = document.createElement('i'); x.style.background = `var(--series-${k})`; document.body.append(x); const c = getComputedStyle(x).backgroundColor; x.remove(); return c }, k)

  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.mode
    const w = await page(b, kit.url, { ...look, before: fake })
    pages.push(w)
    const p = w.p
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    const card = await openUsage(p)
    const row = (id) => card.locator(`.acct-u[data-acct="${id}"]`)
    // The header's bars and each account's dot, in its color.
    const want2 = await series(p, 2), want5 = await series(p, 5), grey = await p.evaluate(() => { const x = document.createElement('i'); x.style.background = 'var(--series-other)'; document.body.append(x); const c = getComputedStyle(x).backgroundColor; x.remove(); return c })
    ok(await bg(card.locator(`.seg-part[data-acct="${WORK}"] .u-fill`)) === want2 && await bg(card.locator(`.seg-part[data-acct="${SIDE}"] .u-fill`)) === want5, `${t}: the header's bars are each account's color`)
    ok(await card.locator(`.seg-part[data-acct="${SIDE}"]`).evaluate((el) => el.classList.contains('low')) && /Side: 6% left/.test(await card.locator(`.seg-part[data-acct="${SIDE}"]`).getAttribute('title')), `${t}: Side, nearly out, has a red edge (its color no longer says how much is left), and says so on hover`)
    ok(await bg(row(WORK).locator('.acct-swatch .acct-dot')) === want2, `${t}: Work's card has its color's swatch`)
    // The chart: stacked by account, Not known in grey, its legend and what's counted.
    const chart = card.locator('.u-chart').first()
    await chart.locator('[data-part]').first().waitFor({ timeout: 20000 })
    const legend = (await chart.locator('.u-legend li').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
    ok(legend.length === 4 && /^Main /.test(legend[0]) && /^Work /.test(legend[1]) && /^Side /.test(legend[2]) && /^Not known /.test(legend[3]) && legend.every((x) => /\$\d/.test(x)), `${t}: a legend with each account and Not known, each with its total`, legend)
    ok(await fill(chart.locator(`rect[data-part="${WORK}"]`).first()) === want2 && await fill(chart.locator('rect[data-part="?"]').first()) === grey, `${t}: Work's bars in its color, Not known in grey`)
    const counted = await card.locator('.acct-counted').innerText()
    ok(/Split by the account each conversation ran on, where Bridge AI saw it there or that account's own folder records it\. Not known, in grey: \d+% of the cost in these days\./.test(counted), `${t}: one line says what's counted, and how much isn't known`, counted)
    const shown = await shownNow()
    const split = card.locator('.cost-split')
    const todayNames = onDay(shown.today)
    const splitText = await split.innerText().catch(() => '')
    ok(todayNames.length ? todayNames.every((x) => splitText.includes(x)) && /\$\d/.test(splitText) : !(await split.count()), `${t}: today's cost by account, under the day's figures (${todayNames.join(', ') || 'none yet'})`, splitText)
    // On hover, a day's accounts: the latest with three or more of them in it.
    const busy = [...shown.daily].reverse().find((d) => onDay(d).length >= 3)
    await chart.locator(`svg g[data-date="${busy?.date}"]`).hover()
    const tip = await chart.locator('.tooltip').innerText().catch(() => '')
    ok(!!busy && onDay(busy).every((x) => tip.includes(x)) && Object.values(NAME).filter((x) => !onDay(busy).includes(x)).every((x) => !tip.includes(x)), `${t}: a day's tooltip names its accounts, and only those`, { tip, want: onDay(busy || {}) })
    await p.mouse.move(5, 5)
    await card.locator('.u-chart').scrollIntoViewIfNeeded()
    await sleep(300)
    await shot(p, `${tag}usage-accounts-${t}`)
    await card.locator('.acct-us').scrollIntoViewIfNeeded()
    await sleep(300)
    await shot(p, `${tag}usage-accounts-cards-${t}`)

    if (t === 'light') {
      // Pick a color on Work's card: it shows everywhere at once.
      await row(WORK).locator('.acct-swatch').click()
      const pal = p.locator(`.acct-colors[data-acct="${WORK}"]`)
      await pal.waitFor({ timeout: 5000 })
      ok((await pal.locator('.acct-color').count()) === 8 && /Pink \(Side has it too\)/.test(await pal.locator('.acct-color').nth(4).getAttribute('title')), `${t}: the swatch opens eight colors, one Side has saying so`)
      const pb = await pal.boundingBox(), sb = await row(WORK).locator('.acct-swatch').boundingBox()
      ok(!!pb && !!sb && pb.y >= sb.y + sb.height && pb.x + pb.width <= 1440 && await pal.locator('.acct-color').nth(1).isVisible(), `${t}: under its swatch, whole (not cut off by the card)`, { pb, sb })
      await sleep(300)
      await shot(p, `${tag}usage-accounts-palette`)
      await pal.locator('.acct-color').nth(6).click() // Violet
      const want7 = await series(p, 7)
      ok(!!(await until(async () => (await colors())[WORK] === 7, 5000)), `${t}: picked, it's saved`, await colors())
      ok(!!(await until(async () => (await bg(row(WORK).locator('.acct-swatch .acct-dot'))) === want7 && (await bg(card.locator(`.seg-part[data-acct="${WORK}"] .u-fill`))) === want7 && (await bg(chart.locator('.u-legend li[data-part="claude-aaaa0001"] i'))) === want7, 8000)), `${t}: and Work is Violet on its card, in the header's bars and in the chart's legend at once`)
      // The top bar's menu and New agent's account picker.
      await p.locator('.topbar .status-btn').click()
      await p.locator('.status-pop .usage-chip').click()
      const menu = p.locator('.acct-pop.top')
      await menu.waitFor({ timeout: 5000 })
      const dot = menu.locator('.acct-row', { has: p.locator('.acct-nm', { hasText: /^Work$/ }) }).locator('.acct-dot').first()
      ok(await bg(dot) === want7, `${t}: the top bar's account menu has Work in Violet`)
      await p.keyboard.press('Escape')
      await p.locator('.home-more').click()
      await p.waitForSelector('.new-agent', { timeout: 5000 })
      await p.click('.na-mode button:has-text("In a project folder")').catch(() => {})
      const pick = p.locator('.new-agent .acct-btn')
      await pick.waitFor({ timeout: 10000 })
      ok(await bg(pick.locator('.acct-dot')) === await series(p, 1), `${t}: New agent's account picker shows the account it starts on in its color (Main)`)
      await pick.click()
      const inField = p.locator('.acct-pop.in-field')
      await inField.waitFor({ timeout: 5000 })
      await sleep(300)
      await shot(p, `${tag}usage-accounts-new-agent`)
      ok(await bg(inField.locator('.acct-row', { has: p.locator('.acct-nm', { hasText: /^Work$/ }) }).locator('.acct-dot').first()) === want7, `${t}: and its list, Work in Violet`)
      await p.keyboard.press('Escape')
      await p.keyboard.press('Escape')
      // Settings › Model Providers › Accounts: each account's swatch before its name, Work's Violet.
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'accounts' } })))
      const sec = p.locator('#pv-accounts')
      await sec.waitFor({ timeout: 15000 })
      const sw = sec.locator('.pv-acct .acct-swatch')
      ok(!!(await until(async () => (await sw.count()) === 3, 10000)) && await bg(sec.locator('.pv-acct', { has: p.locator('.pv-acct-label', { hasText: /^Work$/ }) }).locator('.acct-dot')) === want7, `${t}: Settings lists each account with its swatch, Work's Violet`)
      await sec.scrollIntoViewIfNeeded()
      await sleep(300)
      await shot(p, `${tag}usage-accounts-settings`)
      await p.locator('button[aria-label="Close settings"]').click().catch(() => p.keyboard.press('Escape'))
      // Today › Usage (stats, patterns, history): its By account card, each in its color.
      const again = await openUsage(p)
      await again.locator('button', { hasText: 'Stats, patterns and history' }).first().click()
      const byAcct = p.locator('.ustats .us-card', { has: p.locator('h4', { hasText: /^By account$/ }) })
      await byAcct.waitFor({ timeout: 20000 })
      const sws = byAcct.locator('.us-sw')
      ok(!!(await until(async () => (await sws.count()) >= 2, 8000)) && await bg(byAcct.locator('.us-row', { hasText: 'Work' }).locator('.us-sw')) === want7, `${t}: the Usage tab's By account card has each account in its color, Work's Violet`, await byAcct.innerText().catch(() => ''))
      await byAcct.scrollIntoViewIfNeeded()
      await sleep(300)
      const unknownRow = byAcct.locator(`li[data-acct="?"]`)
      ok(/Not known/.test(await unknownRow.innerText().catch(() => '')) && await bg(unknownRow.locator('.us-sw')) === grey, `${t}: and Not known, in grey`, await byAcct.innerText().catch(() => ''))
      await shot(p, `${tag}usage-accounts-stats`)
      // The Today panel's Insights card: By account, with Not known.
      await p.locator('.today-tabs button', { hasText: 'Today' }).first().click()
      const insBy = p.locator('#card-sparkle .ins-split', { has: p.locator('h4', { hasText: /^By account$/ }) })
      await insBy.waitFor({ timeout: 20000 })
      ok(!!(await until(async () => /Not known/.test(await insBy.innerText()) && /Main/.test(await insBy.innerText()), 10000)), `${t}: the Insights card's By account has Not known too`, await insBy.innerText().catch(() => ''))
      await insBy.scrollIntoViewIfNeeded()
      await sleep(300)
      await shot(p, `${tag}usage-accounts-insights`)
      await kit.api(`/accounts/${WORK}/color`, { color: 2 })
    }
    ok(w.errors.length === 0, `${t}: no page errors`, w.errors)
  }

  // On a phone: the same card, nothing wider than the screen, whole targets.
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = `phone ${look.mode}`
    const w = await page(b, kit.url, { ...look, phone: true, before: fake })
    pages.push(w)
    const p = w.p
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    await p.locator('.tabbar button', { hasText: 'Today' }).click()
    const card = await openUsage(p)
    await card.locator('.u-chart [data-part]').first().waitFor({ timeout: 20000 })
    await card.locator('.acct-u').first().scrollIntoViewIfNeeded()
    // (What else in the card is under 40 px is its own, from before.)
    const faults = await phoneFaults(p, '.usage-card')
    const ours = (xs) => (xs || []).filter((x) => /acct-swatch|acct-color|acct-u-reset|acct-nm|cost-split|u-legend/.test(x))
    ok(!faults.wider && !faults.past?.length && !faults.sideways?.length && !ours(faults.small).length && !ours(faults.cut).length, `${t}: nothing wider than the screen, nothing of an account's cut off, and the swatches whole targets`, faults)
    await shot(p, `${tag}usage-accounts-${look.mode}-phone`)
    await card.locator('.u-chart').scrollIntoViewIfNeeded()
    await sleep(300)
    await shot(p, `${tag}usage-accounts-chart-${look.mode}-phone`)
    if (look.mode === 'light') {
      await card.locator(`.acct-u[data-acct="${SIDE}"] .acct-swatch`).click()
      const pal = p.locator(`.acct-colors[data-acct="${SIDE}"]`)
      await pal.waitFor({ timeout: 5000 })
      await sleep(300)
      const pf = await phoneFaults(p, '.acct-colors')
      ok(!pf.past?.length && !pf.small?.length, `${t}: the colors fit on the screen, each a whole target`, pf)
      await shot(p, `${tag}usage-accounts-palette-phone`)
    }
    ok(w.errors.length === 0, `${t}: no page errors`, w.errors)
  }

  // ---------- Usage on a phone, as the desktop's chip has it ----------
  // The phone's top bar has no room for the usage chip, so More has a row of its own for Usage, with
  // the chip's account color and figure, and Usage starts with what the chip says, in words (a phone
  // has no hover): where new agents start, the figure that matters, that limit and when it resets,
  // every other limit; then the chip's account menu under it, to see each account's and model's
  // limits and switch where new agents start. As the owner's plan had it: Main with no 5-hour window,
  // its week 29% left and a model's own week (Fable) untouched; then Fable about to run out, Auto, a
  // sign-in that ran out and plan usage off. The same words and colors as the desktop's chip; at 375
  // and 430 px, light and dark, nothing in the whole of Usage cut off, past the screen's edge or
  // smaller than a whole target.
  {
    const at = (h) => new Date(Date.now() + h * 3600e3).toISOString()
    const soon = at(2), later = at(50)
    const five = (pct) => ({ id: 'five_hour', kind: 'session', label: 'session', percentRemaining: pct, resetsAt: soon })
    const week = (pct) => ({ id: 'seven_day', kind: 'weekly', label: 'week', percentRemaining: pct, resetsAt: later })
    const fable = (pct) => ({ id: 'model:fable', kind: 'model', label: 'Fable week', percentRemaining: pct, resetsAt: later })
    // Plan usage as each case has it, laid over the server's own list (so a switch shows). Off, the
    // server's own answer: its accounts, and nothing read.
    const plan = ({ main = [week(29), fable(100)], auto = false, lapsed = false, off = false } = {}) => async () => {
      const live = await kit.api('/quota')
      if (off) return { ...live, providers: [], off: true }
      const W = { [MAIN]: main, [WORK]: [five(80), week(70)], [SIDE]: [five(6), week(30)] }
      const read = (a) => (lapsed && a.id === MAIN ? { usable: false, status: 'error', error: 'Claude access token expired', percentRemaining: null, windows: [] }
        : { usable: true, status: 'fresh', percentRemaining: Math.min(...W[a.id].map((w) => w.percentRemaining)), windows: W[a.id] })
      return {
        generatedAt: new Date().toISOString(), bestNow: 'claude',
        providers: [{ provider: 'claude', usable: true, status: 'fresh', plan: 'max', percentRemaining: 29, windows: main }],
        accounts: live.accounts.filter((g) => g.kind === 'claude').map((g) => ({ ...g, ...(auto ? { setting: 'auto', pick: MAIN } : {}),
          accounts: g.accounts.map((a) => ({ ...a, ...(auto ? { active: a.id === MAIN } : {}), signedIn: true, plan: 'max', ...read(a) })) })),
      }
    }
    const withPlan = (answer) => async (c) => { await noServiceWorker(c); await c.route(/\/api\/quota(\?|$)/, async (r) => r.fulfill({ json: await answer() })) }
    // (What isn't there is null at once, rather than waited for.)
    const attr = async (l, a) => ((await l.count()) ? l.first().getAttribute(a) : null)
    const text = async (l) => ((await l.count()) ? (await l.first().innerText()).replace(/\s+/g, ' ').trim() : '')
    // The desktop's chip, as the top bar has it: its words, each line on hover, its figure's level.
    const chipOf = async (answer) => {
      const w = await page(b, kit.url, { width: 1440, before: withPlan(answer) })
      pages.push(w)
      const chip = w.p.locator('.topbar .x-usage .usage-chip')
      await until(() => chip.locator('.u-pct, .muted').count(), 15000)
      const said = { text: await text(chip), lines: (await chip.getAttribute('title')).split('\n'), level: await attr(chip.locator('.u-pct'), 'class') }
      await w.ctx.close()
      return said
    }
    // The phone's More, and Usage's row in it: its name, what's under it, and the figure at its end.
    const more = async (p) => {
      await p.locator('.tabbar button', { hasText: 'More' }).click()
      await p.locator('.tabbar button', { hasText: 'More' }).click()
      const row = p.locator('.m-more-row', { hasText: /^Usage/ })
      await row.waitFor({ timeout: 10000 })
      await until(() => row.locator('.m-more-side .usage-tight, .m-more-side .muted').count(), 10000)
      return {
        row,
        name: await text(row.locator('.m-more-text b')), hint: await text(row.locator('.m-more-text span')), side: await text(row.locator('.m-more-side')),
        level: await attr(row.locator('.m-more-side .u-pct'), 'class'),
        dot: (await row.locator('.m-more-side .acct-dot').count()) ? await bg(row.locator('.m-more-side .acct-dot')) : null,
      }
    }
    // Usage on the phone, opened from its row: what its first card says.
    const usageNow = async (p, r) => {
      await r.row.click()
      const now = p.locator('.m-more-view .ustats > .usage-now')
      await now.waitFor({ timeout: 15000 })
      const fig = now.locator('.usage-now-head .u-pct')
      return {
        now,
        tab: (await p.locator('.tabbar button.on').innerText()).trim(), back: await p.locator('.m-more-view > .m-view-back', { hasText: 'More' }).isVisible(),
        who: await text(now.locator('.usage-now-who small')), acct: await text(now.locator('.usage-now-acct')),
        figure: await text(now.locator('.usage-now-head > :is(.usage-tight, .muted)')), level: await attr(fig, 'class'),
        lines: (await now.locator('.usage-now-says').allInnerTexts()).flatMap((x) => x.split('\n')).map((x) => x.trim()).filter(Boolean),
      }
    }
    // The whole of Usage at once (a screen tall enough for all of it): what doesn't fit a phone.
    const whole = async (p, width) => {
      await p.setViewportSize({ width, height: 7000 })
      await sleep(600)
      const f = await phoneFaults(p, '.m-more-view')
      await p.setViewportSize({ width, height: 860 })
      await sleep(300)
      return f
    }
    const owner = await chipOf(plan())
    ok(owner.text === 'Main 29% wk' && /t-warning/.test(owner.level || '') && /^29% of the week left, Week resets /.test(owner.lines[1] || '') && /^Fable week: 100% left, Resets /.test(owner.lines[2] || ''),
      '(the desktop\'s chip: Main and its week\'s 29%, in the warning\'s color, each limit on hover)', owner)

    for (const [width, look] of [[375, { mode: 'light', theme: 'sky' }], [430, { mode: 'dark', theme: 'midnight' }]]) {
      const t = `phone usage ${width} ${look.mode}`
      const w = await page(b, kit.url, { ...look, phone: true, before: withPlan(plan()) })
      pages.push(w)
      const p = w.p
      await p.setViewportSize({ width, height: 860 })
      await p.waitForSelector('.tabbar button', { timeout: 15000 })
      const r = await more(p)
      const blue = await series(p, 1) // Main's color
      ok(r.name === 'Usage' && r.hint === 'Plans, limits and history' && r.side === '29% wk' && /t-warning/.test(r.level || '') && r.dot === blue,
        `${t}: More has a row of its own for Usage, ending in the chip's figure (29% wk, in the warning's color) and Main's color`, r)
      const rb = await r.row.boundingBox()
      ok(rb.height >= 44 && rb.x >= 0 && rb.x + rb.width <= width, `${t}: the row is a whole target, within the screen`, rb)
      await shot(p, `${tag}phone-usage-more-${look.mode}-${width}`)
      const u = await usageNow(p, r)
      ok(u.tab === 'More' && u.back, `${t}: it opens Usage in More, with Back to More (not through Today)`, u)
      ok(u.who === 'New Claude agents start on' && u.acct === 'Main' && u.figure === '29% wk' && (u.level || '') === (owner.level || '-'),
        `${t}: Usage starts with where new agents start (Main) and the chip's figure, in its color`, u)
      ok(u.lines.join('\n') === owner.lines.slice(1, -1).join('\n'), `${t}: then the chip's hover in words: the week's limit and when it resets, the Fable week's`, { phone: u.lines, chip: owner.lines })
      ok(await u.now.locator('.usage-now-head .pv-tile').count() === 1 && await bg(u.now.locator('.usage-now-head .acct-dot')) === blue, `${t}: with the provider's mark and Main's color, as the chip has`)
      await shot(p, `${tag}phone-usage-${look.mode}-${width}`)
      // The account menu, under it: each account's windows, the Fable week under Main, Side nearly out.
      await u.now.locator('button.usage-now-head').click()
      const menu = u.now.locator('.acct-pop.inline')
      await menu.waitFor({ timeout: 5000 })
      const rows = await menu.evaluate((m) => [...m.querySelectorAll('.acct-row')].map((x) => ({ name: x.querySelector('.acct-nm')?.textContent, text: x.innerText.replace(/\s+/g, ' '), star: !!x.querySelector('.acct-check.is-default svg'), h: Math.round(x.querySelector('.acct-item').getBoundingClientRect().height) })))
      const byName = Object.fromEntries(rows.map((x) => [x.name, x]))
      ok(rows.map((x) => x.name).join() === 'Main,Work,Side' && byName.Main.star && /Fable week: 100% left/.test(byName.Main.text) && /29% wk left/.test(byName.Main.text) && /80% 5h left 70% wk left/.test(byName.Work.text) && /Set as default/.test(byName.Work.text),
        `${t}: a tap opens the chip's account menu under it: each account's windows, the star on Main with its Fable week, Set as default on the others`, rows)
      ok(await menu.locator('.acct-row', { has: p.locator('.acct-nm', { hasText: /^Side$/ }) }).locator('.acct-left .t-critical').innerText() === '6%' && rows.every((x) => x.h >= 44), `${t}: Side's 6% in the critical color, every account a whole row`, rows)
      await sleep(300)
      await shot(p, `${tag}phone-usage-menu-${look.mode}-${width}`)
      const f = await whole(p, width)
      ok(!Object.keys(f).length, `${t}: the whole of Usage, its menu open, fits the phone: nothing wider, past its edge, sideways or cut off, every target whole and uncovered`, f)
      if (look.mode === 'light') {
        // Switched from there: new agents start on Work, here and on the server.
        await menu.locator('.acct-row', { has: p.locator('.acct-nm', { hasText: /^Work$/ }) }).locator('.acct-item').click()
        const moved = await until(async () => (await claudeOf()).setting === WORK && await text(u.now.locator('.usage-now-acct')) === 'Work' && !(await menu.count()), 10000)
        ok(!!moved, `${t}: tapping Work makes it where new agents start, and Usage says so`, { setting: (await claudeOf()).setting, says: await text(u.now.locator('.usage-now-acct')) })
        await kit.api('/accounts/active/claude', { id: MAIN })
      }
      ok(!w.errors.length, `${t}: no page errors`, w.errors)
      await w.ctx.close()
    }

    // A model's limit about to run out, Auto, a sign-in that ran out and plan usage off: on the
    // phone, each as the desktop's chip says it.
    const cases = [
      { name: 'Fable 7% left', o: { main: [five(62), week(41), fable(7)] }, look: { mode: 'dark', theme: 'midnight' }, width: 430 },
      { name: 'Auto', o: { auto: true }, look: { mode: 'light', theme: 'sky' }, width: 375 },
      { name: 'sign-in expired', o: { lapsed: true }, look: { mode: 'light', theme: 'sky' }, width: 375 },
      { name: 'usage off', o: { off: true }, look: { mode: 'dark', theme: 'midnight' }, width: 375 },
    ]
    for (const c of cases) {
      const t = `phone usage, ${c.name}`
      const chip = await chipOf(plan(c.o))
      const w = await page(b, kit.url, { ...c.look, phone: true, before: withPlan(plan(c.o)) })
      pages.push(w)
      const p = w.p
      await p.setViewportSize({ width: c.width, height: 860 })
      await p.waitForSelector('.tabbar button', { timeout: 15000 })
      const r = await more(p)
      const u = await usageNow(p, r)
      // The chip's figure (or why there's none), past its account's name.
      const fig = chip.text.replace(/^Main /, '')
      ok(r.side === fig && u.figure === fig && (r.level || '') === (chip.level || '') && (u.level || '') === (chip.level || ''), `${t}: More's row and Usage say what the chip does (${fig}), in its color`, { chip, row: r, usage: u })
      if (c.o.off) ok(!u.lines.length && /Turn on/.test(await p.locator('.m-more-view .usage-off').innerText().catch(() => '')), `${t}: plan usage off, with the card under it saying why and Turn on`, u)
      else ok(u.lines.filter((x) => !/^Auto starts/.test(x)).join('\n') === chip.lines.slice(1, -1).join('\n'), `${t}: the chip's hover, in words`, { phone: u.lines, chip: chip.lines })
      await u.now.locator('button.usage-now-head').click()
      const menu = u.now.locator('.acct-pop.inline')
      await menu.waitFor({ timeout: 5000 })
      const mainRow = menu.locator('.acct-row', { has: p.locator('.acct-nm', { hasText: /^Main$/ }) })
      if (c.o.main) ok(/Fable week: 7% left/.test(await mainRow.innerText()) && await mainRow.locator('.acct-models .t-critical').count() === 1 && /^Fable week: 7% left, Resets /.test(u.lines[0] || ''), `${t}: first in words, and under Main in the menu in the critical color`, { lines: u.lines, row: await mainRow.innerText() })
      if (c.o.auto) ok(u.acct === 'Main auto' && u.lines[0] === 'Auto starts new agents here now: it has the most left' && await menu.locator('.acct-item.auto[aria-checked="true"]').count() === 1, `${t}: Auto's pick said so, and Auto ticked in the menu`, { u, menu: await menu.innerText() })
      if (c.o.lapsed) {
        const signIn = mainRow.locator('.acct-act')
        const sb = await signIn.boundingBox().catch(() => null)
        ok(u.lines[0] === 'Usage: sign-in expired (Claude access token expired)' && /Sign-in expired/.test(await mainRow.innerText()) && sb?.height >= 40, `${t}: why there's no figure, and Main's Sign in in the menu, a whole target`, { lines: u.lines, row: await mainRow.innerText(), sb })
      }
      await sleep(300)
      await shot(p, `${tag}phone-usage-${c.name.replace(/\W+/g, '-').toLowerCase()}`)
      const f = await whole(p, c.width)
      ok(!Object.keys(f).length, `${t}: the whole of Usage fits the phone`, f)
      ok(!w.errors.length, `${t}: no page errors`, w.errors)
      await w.ctx.close()
    }
  }

  // With Home on and its page opened first, Usage's heatmap: square, in its levels' colors.
  {
    await kit.api('/settings', { trials: { home: true } }, 'PATCH')
    const w = await page(b, kit.url, { mode: 'light', theme: 'sky', before: fake })
    pages.push(w)
    const p = w.p
    ok(!!(await until(() => p.locator('.hm').first().isVisible(), 20000)), 'Home on: it opens at Home (its page, .hm)')
    const card = await openUsage(p)
    await card.locator('button', { hasText: 'Stats, patterns and history' }).first().click()
    const heat = p.locator('.ustats .us-heat')
    await heat.waitFor({ timeout: 20000 })
    const cells = await heat.evaluate((el) => {
      const probe = (v) => { const x = document.createElement('i'); x.style.color = `var(${v})`; document.body.append(x); const c = getComputedStyle(x).color; x.remove(); return c }
      const want = [0, 1, 2, 3, 4].map((l) => probe(`--hm-${l}`))
      return [...el.querySelectorAll('rect')].map((r) => {
        const b = r.getBoundingClientRect()
        const l = Number(/\bl(\d)\b/.exec(r.getAttribute('class'))?.[1] ?? -1)
        return { w: b.width, h: b.height, l, fill: getComputedStyle(r).fill, want: want[l] }
      })
    })
    const square = cells.length > 50 && cells.every((c) => c.w > 5 && Math.abs(c.w - c.h) < 0.5)
    ok(square, "its squares are square (Home's page styles don't reach them)", cells.slice(0, 3))
    ok(cells.some((c) => c.l > 0) && cells.every((c) => c.l >= 0 && c.fill === c.want), "and each is its level's color, the active days' too", cells.filter((c) => c.fill !== c.want).slice(0, 3))
    await p.mouse.move(5, 5)
    await heat.scrollIntoViewIfNeeded()
    await sleep(300)
    await shot(p, `${tag}usage-accounts-heatmap-home`)
    ok(w.errors.length === 0, 'Home on: no page errors', w.errors)
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const x of pages) await x.ctx.close().catch(() => {})
  await b.close()
  kit.stop(); ollama.stop()
}
process.exit(done().fail ? 1 : 0)
