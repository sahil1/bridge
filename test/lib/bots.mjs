// What the Bots suites share (bots-approvals, bots-changes, bots-native, bots-always-on): a stand-in
// Slack and a kit with Bots on and the stand-in Claude Code answering, and the ways a test looks at
// what happened: Needs You's drafts, what Slack got, a bot's record, Settings › Bots.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSlack, until, TEST } from './harness.mjs'

export const M = '<@UBOT>'
export const M2 = '<@UBOT2>'
// The stand-in Slack's owner (the one who runs Bridge AI here), as a Slack member.
export const OWNER = { id: 'U0OWNER', name: 'Tester' }

// A stand-in Slack (or one given) and a kit: its config (Bots on), env, and the folders made in its
// home. Short waits for what a test would otherwise wait minutes for, and each question its own
// conversation (BRIDGE_BOT_CARRY_MS 0: the same person asking again soon after doesn't carry one on,
// unless a test says it does).
export async function botKit(name, { config = {}, env = {}, slack = null, folders = [] } = {}) {
  const s = slack || await startSlack(name)
  let home = null
  const kit = await startKit(name, {
    config: { name: 'Tester', ...config, trials: { 'slack-bot': true, ...(config.trials || {}) } },
    env: (x) => {
      home = x.home
      for (const f of folders) fs.mkdirSync(path.join(x.home, f), { recursive: true })
      return { BRIDGE_SLACK_URL: s.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_CARRY_MS: '0', ...(typeof env === 'function' ? env(x) : env) }
    },
  })
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
  return { slack: s, kit, home, ...lookers(kit, s) }
}

// The ways a test looks.
export function lookers(kit, slack) {
  const needs = async () => (await kit.api('/needs-you')).slack || []
  const logOf = (f) => { try { return fs.readFileSync(path.join(kit.home, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
  const month = () => new Date().toISOString().slice(0, 7)
  return {
    needs,
    // A draft waiting in Needs You whose question (or a reply joined to it) has these words.
    draftOf: (words, ms = 40000) => until(async () => (await needs()).find((x) => [x.text, ...(x.more || []).map((m) => m.text)].some((y) => String(y || '').includes(words)) && x.state === 'draft'), ms),
    logOf,
    // An answering agent started, its brief having these words: { args, cwd, message }.
    startOf: (words, ms = 20000) => until(() => logOf('helpers-started.log').find((x) => x.message.includes(words)), ms),
    startsOf: (words) => logOf('helpers-started.log').filter((x) => x.message.includes(words)),
    // A brief as the agent got it, its lines as lines (on Windows' command line they're joined by " · ").
    briefOf: (x) => String(x?.message || '').replace(/ · /g, '\n'),
    botOf: (id = 'b1') => kit.api(`/bots/${id}`),
    connected: (id = 'b1', ms = 20000) => until(async () => { const v = await kit.api(`/bots/${id}`); return v.state === 'connected' ? v : null }, ms),
    convs: async (id = 'b1', q = '') => (await kit.api(`/bots/${id}/activity${q ? `?q=${encodeURIComponent(q)}` : ''}`)).conversations,
    timelineOf: async (id, words) => { const c = (await kit.api(`/bots/${id}/activity?q=${encodeURIComponent(words)}`)).conversations[0]; return c ? (await kit.api(`/bots/${id}/activity/${encodeURIComponent(c.id)}`)).events : [] },
    // Every event in a bot's record, as written.
    events: (id = 'b1') => { try { return fs.readFileSync(path.join(kit.data, 'bots', id, 'trace', `${month()}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } },
    posted: async () => (await slack.state()).posted,
    // (Not a draft's card in your direct messages, whose words have the draft in them too: posts go
    // in each conversation at once now, so its Sent can land a moment after the answer.)
    postedLike: (re, ms = 20000) => until(async () => (await slack.state()).posted.find((x) => re.test(x.text || '') && !/ — Draft: /.test(x.text || '')), ms),
    reacted: async (ts, name, app = 'A1') => (await slack.state()).reactions.some((r) => r.ts === ts && r.name === name && r.app === app),
    calls: (method) => slack.calls().filter((c) => c.method === method),
  }
}

// A bot's own connection's file (server/connections.js): its tokens (<platform>.json) or its settings
// (connection.json), in connections/<c>/; where there's none, a path that isn't there.
export function ownFile(kit, bot, platform, name = `${platform}.json`) {
  const d = path.join(kit.data, 'connections')
  const c = (fs.existsSync(d) ? fs.readdirSync(d) : []).find((x) => { try { const j = JSON.parse(fs.readFileSync(path.join(d, x, 'connection.json'), 'utf8')); return j.bot === bot && j.platform === platform } catch { return false } })
  return path.join(d, c || 'none', name)
}

// Settings at a section, once the app is up to hear it (asked again until it opens).
export async function openSettings(p, section = 'slack-bot', ready = '.modal.settings .sb') {
  await p.locator('.topbar, .tabbar').first().waitFor({ timeout: 20000 })
  await until(async () => {
    await p.evaluate((x) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: x } })), section)
    return p.locator(ready).first().waitFor({ timeout: 2500 }).then(() => true, () => false)
  }, 20000, 100)
  await p.locator(ready).first().waitFor({ timeout: 5000 })
}

// Bots (the sidebar's Bots row; a phone's More › Bots) at one of its tabs: connections, bots or
// sessions. (Settings › Bots is the beta feature's switch and Open Bots: everything else is here.)
export async function openBots(p, tab = 'bots') {
  await p.locator('.topbar, .tabbar').first().waitFor({ timeout: 20000 })
  if (await p.locator('.tabbar').count()) {
    await p.locator('.tabbar button', { hasText: 'More' }).click()
    await p.locator('.m-more-row[data-id="bots"]').click()
  } else await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click({ timeout: 20000 })
  await p.locator(`.bh-tabs [data-tab="${tab}"]`).click()
  await p.locator(`.bh[data-tab="${tab}"] .bh-body > *`).first().waitFor({ timeout: 10000 })
}

// A bot's page, from its card in Bots: by its name (the first bot when none is said), at one of its
// tabs (overview, settings, memory, activity). Its Settings open with Advanced open too, where most
// of a bot's settings are, unless basic.
export async function openBot(p, { name = null, tab = 'settings', basic = false } = {}) {
  await openBots(p, 'bots')
  await (name ? p.locator('.bh .bo-card', { hasText: name }) : p.locator('.bh .bo-card')).first().click()
  await p.locator('.bp .sb-tabs').first().waitFor({ state: 'attached', timeout: 10000 })
  await p.waitForTimeout(300)
  // (A bot not connected anywhere opens with AI Assist's chat beside it: on a phone, over the page.)
  if (await p.locator('.bp.phone .bp-chat .ai-head-close').count()) await p.locator('.bp.phone .bp-chat .ai-head-close').click()
  await p.locator(`.bp .sb-tabs [data-tab="${tab}"]`).click({ timeout: 10000 })
  if (tab !== 'settings' || basic) return
  const adv = p.locator('.bp [data-setting="bot-advanced"]')
  if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
  await p.locator('.bp [data-setting="bot-advanced"] [data-setting="slack-limits"]').waitFor({ timeout: 8000 })
}

// A question asked once, as its Overview's Start a Test Session asks where the server keeps no
// sessions: as someone (by name), its answer's section (settings/Bots.jsx TryResult).
export async function askOnce(p, text, { as = null } = {}) {
  await p.locator('.bp .sb-tabs [data-tab="overview"]').click()
  const form = p.locator('.bp [data-setting="bot-test"] [data-setting="test-session"]')
  if (as) await form.locator('select').selectOption({ label: as })
  await form.locator('textarea').fill(text)
  await form.locator('button[type="submit"]').click()
  return form.locator('[data-setting="slack-try"]')
}

// AI Assist's chat for a new bot: New bot's Or describe it to AI Assist. form: its form (by name, a
// template, an import) open in it, as it is by itself with no model, else with Set it up with the form.
export async function newBotChat(p, { form = false } = {}) {
  await p.locator('.topbar, .tabbar').first().waitFor({ timeout: 20000 })
  if (await p.locator('.tabbar').count()) {
    await openBots(p, 'bots')
    await p.locator('.bh [data-setting="bots-quick"], .bh [data-setting="bots-new"]').first().waitFor({ timeout: 10000 })
    if (!(await p.locator('.bh [data-setting="bots-quick"]').count())) await p.locator('.bh [data-setting="bots-new"]').click()
  } else await p.locator('[data-setting="rail-bots"] .rail-tool[aria-label="New bot"]').click({ timeout: 20000 })
  await p.locator('.bh [data-setting="bots-quick"] .ai-assist-link').click()
  if (!form) return
  await p.locator('.bc .sb-new, .bc button:has-text("Set it up with the form")').first().waitFor({ timeout: 15000 })
  if (!(await p.locator('.bc .sb-new').count())) await p.locator('.bc button', { hasText: 'Set it up with the form' }).click()
  await p.locator('.bc .sb-new').waitFor({ timeout: 8000 })
}
