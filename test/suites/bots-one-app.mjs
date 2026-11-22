// One Slack app for all your bots, from every place a bot that isn't reached is looked at: the
// owner's case (a bot on its own Slack app, maya_bot, with two specialists that aren't reached),
// with the stand-in Slack. Each place ends somewhere clear, never only at the steps to make a second
// Slack app for what the first does already:
//   - no shared connection yet: Bots › Connections says Add a Connection (there's one already), and
//     a specialist's page, in AI Assist's chat, offers maya_bot's own app for all your bots;
//   - a shared one never set up: Give it its own connection asks first, saying the bot isn't
//     reached until that app is made; the other specialist's chat says why it isn't reached and
//     offers maya_bot's own app instead (Use @maya_bot instead), which works, in one step;
//   - a bot's own app never set up, beside a shared one that works: its card in Connections says
//     the bot isn't reached and offers the move back onto the shared one before its app's steps
//     (there still, for an app of its own on purpose), saying nothing is left to delete on Slack;
//     done, it's reached again. On a phone too, the card fitting the screen.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSlack, checks, until, sleep, browser, page, shot, phoneFaults, TEST } from '../lib/harness.mjs'
import { openBots } from '../lib/bots.mjs'

const { ok, done } = checks('bots-one-app')
const slack = await startSlack('bots-one-app')
const kit = await startKit('bots-one-app', {
  config: { name: 'Maya', trials: { 'slack-bot': true } },
  env: ({ home }) => { fs.mkdirSync(path.join(home, 'Hiring'), { recursive: true }); return { BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_BOT_CARRY_MS: '0' } },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const shown = (p, sel, ms = 8000) => p.locator(sel).first().waitFor({ timeout: ms }).then(() => true, () => false)
const textOf = (p, sel) => p.locator(sel).first().innerText({ timeout: 3000 }).catch(() => '')
const botOf = (id) => kit.api(`/bots/${id}`)
const conns = async () => (await kit.api('/connections')).connections
// A bot's page, with AI Assist's chat beside it (as a bot not reached anywhere opens), at its Slack tab.
async function openChat(p, id) {
  await p.evaluate((bid) => { try { localStorage.setItem(`cc-bot-assist-${bid}`, 'open') } catch { /* private window */ } window.dispatchEvent(new CustomEvent('bridge-open-bot', { detail: { id: bid } })) }, id)
  await p.locator(`.bp:has(.bp-name:text-is("${id === S ? 'maya_bot' : id === H ? 'hiring_bot' : 'marketing_bot'}")) .bp-chat .bc-connect`).first().waitFor({ timeout: 15000 })
}
// What's wrong on a phone's screen, but for what's only scrolled under the tab bar.
const fits = async (p, ...scopes) => {
  const f = await phoneFaults(p, ...scopes)
  if (f.covered) f.covered = f.covered.filter((x) => !/ under Sections <nav\.tabbar>$/.test(x))
  if (!f.covered?.length) delete f.covered
  return f
}

let S, H, M
try {
  await kit.api('/setup', { name: 'Maya' })
  S = (await kit.api('/bots', { name: 'maya_bot', description: 'Takes every question first' })).id
  H = (await kit.api('/bots', { name: 'hiring_bot', description: 'Answers hiring questions', readsFrom: ['~/Hiring'] })).id
  M = (await kit.api('/bots', { name: 'marketing_bot', description: 'Answers marketing questions' })).id
  // maya_bot on an app of its own, as bots were before shared connections.
  await kit.api(`/bots/${S}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
  ok(!!(await until(async () => (await botOf(S)).state === 'connected', 20000)), 'maya_bot is connected, on its own Slack app')
} catch (e) { ok(false, `the kit couldn't be set up: ${e.stack}`) }

try {
  // ---------- No shared connection yet ----------
  await part('no shared connection yet', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
    await openBots(p, 'connections')
    await p.locator('.bh [data-setting="connections-new"]').waitFor({ timeout: 10000 })
    ok(/Add a Connection/.test(await textOf(p, '.bh [data-setting="connections-new"] h4')), 'Connections: with maya_bot\'s own app there, a shared one is Add a Connection, not your first', await textOf(p, '.bh [data-setting="connections-new"] h4'))
    ok((await botOf(H)).state !== 'connected', 'hiring_bot isn\'t reached anywhere')
    await openChat(p, H)
    const reach = p.locator('.bp-chat .bc-connect [data-setting="bots-reach"]')
    await reach.waitFor({ timeout: 10000 })
    ok(/Not on Slack yet/.test(await reach.innerText()), 'its chat: not on Slack yet', await reach.innerText())
    const use = reach.locator('[data-setting="connection-share"]')
    ok(await shown(p, '.bp-chat .bc-connect [data-setting="bots-reach"] [data-setting="connection-share"]'), 'and, first, maya_bot\'s own app for all your bots', await reach.innerText())
    ok(/Use @maya_bot for all your bots: each is reached through it by its name, with maya_bot as their Chief/.test(await use.innerText().catch(() => '')), 'saying what that does', await use.innerText().catch(() => ''))
    await reach.scrollIntoViewIfNeeded()
    await sleep(300)
    await shot(p, `${tag}bots-one-app-none`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })

  // ---------- A shared one never set up ----------
  let shared = null
  await part('a shared one never set up', async () => {
    shared = (await kit.api('/connections', { platform: 'slack', name: 'team_bot' })).id
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
    await p.locator('.rail').waitFor({ timeout: 20000 })
    // New bot's questions: where it would answer isn't set up yet, said, with where to set it up.
    await openBots(p, 'bots')
    await p.locator('.bh [data-setting="bots-new"]').click()
    const unset = await textOf(p, '.bh [data-setting="bots-quick-unset"]')
    ok(/@team_bot isn't set up yet, so it isn't reached until it is\./.test(unset) && /Set it up in Connections/.test(unset), 'New bot: @team_bot, where it would answer, isn\'t set up yet, said with where to set it up', unset)
    await p.locator('.bh [data-setting="bots-quick-unset"] button').click()
    ok(await shown(p, '.bh[data-tab="connections"]'), 'which opens Connections')
    // marketing_bot's chat: Give it its own connection asks first. Not now, then yes.
    await openChat(p, M)
    const reach = p.locator('.bp-chat .bc-connect [data-setting="bots-reach"]')
    await reach.waitFor({ timeout: 10000 })
    let asked = null
    p.once('dialog', (d) => { asked = d.message(); d.dismiss() })
    await reach.locator('button', { hasText: 'Give it its own connection' }).click()
    ok(/Give marketing_bot an app of its own on Slack\? Until you make that app and paste its tokens, marketing_bot isn't reached on Slack/.test(asked || ''), 'Give it its own connection asks first, saying it isn\'t reached until then', asked)
    await sleep(500)
    ok((await botOf(M)).connections.slack.shared === true, 'not now: nothing changed')
    p.once('dialog', (d) => d.accept())
    await reach.locator('button', { hasText: 'Give it its own connection' }).click()
    ok(!!(await until(async () => (await botOf(M)).connections.slack?.shared === false, 10000)), 'yes: an app of its own, to set up')
    // hiring_bot's chat: why it isn't reached, and maya_bot's own app instead.
    await openChat(p, H)
    const card = p.locator(`.bp-chat .bc-connect .cn-card[data-connection="${shared}"]`)
    ok(await shown(p, `.bp-chat .bc-connect .cn-card[data-connection="${shared}"]`, 10000), 'hiring_bot\'s chat: the shared connection\'s card')
    ok(!!(await until(async () => /Not set up yet, so hiring_bot isn't reached/.test(await textOf(p, `.bp-chat .cn-card[data-connection="${shared}"] .cn-state`)), 10000)), 'why hiring_bot isn\'t reached', await textOf(p, `.bp-chat .cn-card[data-connection="${shared}"] .cn-state`))
    const use = card.locator('[data-setting="connection-share"]')
    ok(/@maya_bot, maya_bot's own app, is connected: use it for all your bots instead/.test(await use.innerText().catch(() => '')), 'and maya_bot\'s own app, connected, to use instead, right there', await card.innerText())
    ok(!(await card.locator('[data-setting="connection-setup"]').isVisible()) && await card.locator('[data-setting="connection-setup-folded"]').count() === 1, 'the steps to make team_bot\'s app folded away')
    await card.scrollIntoViewIfNeeded()
    await sleep(300)
    await shot(p, `${tag}bots-one-app-empty-shared`)
    await use.locator('button', { hasText: 'Use @maya_bot instead' }).click()
    ok(/@team_bot, never set up, is removed/.test(await use.locator('.bh-share-sure').innerText()), 'asked first', await use.locator('.bh-share-sure').innerText().catch(() => ''))
    await use.locator('.bh-share-sure .btn.primary').click()
    const own = (await botOf(S)).connections.slack.id
    ok(!!(await until(async () => { const c = (await conns()).find((x) => x.id === own); return c?.shared && !(await conns()).some((x) => x.id === shared) }, 10000)), 'maya_bot\'s app is the shared one, team_bot gone')
    ok(!!(await until(async () => (await botOf(H)).state === 'connected', 20000)), 'hiring_bot is reached, through maya_bot\'s app')
    ok(!!(await until(async () => (await textOf(p, '.bp .bp-said')) === 'Answering', 10000)), 'its page says it\'s answering', await textOf(p, '.bp .bp-said'))
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })

  // ---------- A bot's own app never set up, beside a shared one that works ----------
  await part('its own app never set up', async () => {
    const mine = (await botOf(M)).connections.slack.id
    ok((await botOf(M)).state !== 'connected', 'marketing_bot, on its own app never set up, isn\'t reached')
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
    await openBots(p, 'connections')
    const card = p.locator(`.bh .cn-card[data-connection="${mine}"]`)
    await card.waitFor({ timeout: 10000 })
    ok(/Not set up yet, so marketing_bot isn't reached/.test(await textOf(p, `.bh .cn-card[data-connection="${mine}"] .cn-state`)), 'its card: not set up, so marketing_bot isn\'t reached', await card.innerText())
    const move = card.locator('[data-setting="connection-share"][data-move="true"]')
    ok(await move.count() === 1 && /Move marketing_bot to @maya_bot/.test(await move.innerText()), 'and the move onto maya_bot\'s app, which works, right there', await card.innerText())
    ok(await card.locator('[data-setting="connection-setup"]').isVisible() && await move.evaluate((e) => !!(e.compareDocumentPosition(e.closest('.cn-card').querySelector('[data-setting="connection-setup"]')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'before its own app\'s steps, which stay for an app of its own on purpose')
    await move.scrollIntoViewIfNeeded()
    await sleep(300)
    await shot(p, `${tag}bots-one-app-own-unset`)
    await move.locator('button', { hasText: 'Move marketing_bot to @maya_bot' }).click()
    const ask = await move.locator('.bh-share-sure').innerText()
    ok(/Move marketing_bot to @maya_bot\? Its own app, never set up, is removed\./.test(ask) && !/tokens|delete that app/.test(ask), 'asked first: nothing to delete on Slack, as it was never set up', ask)
    await move.locator('.bh-share-sure .btn.primary').click()
    ok(!!(await until(async () => /Moved marketing_bot to @maya_bot: it's reached through it now, like your other bots/.test(await textOf(p, '.bh [data-setting="connections-done"]')), 10000)), 'done, and said so', await textOf(p, '.bh [data-setting="connections-done"]'))
    ok(!!(await until(async () => (await botOf(M)).connections.slack.shared === true && (await botOf(M)).state === 'connected', 15000)), 'marketing_bot reached through maya_bot\'s app again')
    ok(!!(await until(async () => !(await card.count()), 10000)), 'its card gone')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })

  // ---------- On a phone ----------
  await part('on a phone', async () => {
    const mine = (await kit.api(`/bots/${H}/own`, { platform: 'slack' })).connections.slack.id
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', phone: true })
    await openBots(p, 'connections')
    const card = p.locator(`.bh .cn-card[data-connection="${mine}"]`)
    await card.waitFor({ timeout: 10000 })
    const move = card.locator('[data-setting="connection-share"][data-move="true"]')
    ok(/Move hiring_bot to @maya_bot/.test(await move.innerText().catch(() => '')), 'a phone: the move offered on hiring_bot\'s own card', await card.innerText())
    await move.scrollIntoViewIfNeeded()
    await sleep(300)
    const faults = await fits(p, `.bh .cn-card[data-connection="${mine}"]`)
    ok(!Object.keys(faults).length, 'the card fits a phone: nothing too small to tap, off the screen or cut short', faults)
    await shot(p, `${tag}bots-one-app-phone`)
    await move.locator('button', { hasText: 'Move hiring_bot to @maya_bot' }).click()
    await move.locator('.bh-share-sure .btn.primary').click()
    ok(!!(await until(async () => (await botOf(H)).connections.slack.shared === true && (await botOf(H)).state === 'connected', 15000)), 'moved from the phone: hiring_bot reached again')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  // ---------- A slash command for each bot ----------
  // (A bot named with no Latin letters: its own command, unique on the app, said on its page.)
  await part('its own command', async () => {
    const shared = (await botOf(S)).connections.slack.id
    await kit.api(`/connections/${shared}`, { perBot: true }, 'PATCH')
    const JB = (await kit.api('/bots', { name: '採用ボット', description: 'Answers hiring questions' })).id
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', store: { [`cc-bot-assist-${JB}`]: 'shut' } })
    await p.locator('.rail').waitFor({ timeout: 20000 })
    await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-bot', { detail: { id } })), JB)
    await p.locator('.bp .sb-tabs [data-tab="overview"]').click({ timeout: 10000 })
    const said = await until(async () => { const x = await textOf(p, '.bp [data-setting="bot-own-command"]'); return x || null }, 10000)
    ok(said === `its own command /ask-bot-${JB.replace(/\D/g, '')}`, 'its page says its own command, unique on the app', said)
    await kit.api(`/connections/${shared}`, { perBot: false }, 'PATCH')
    await kit.api(`/bots/${JB}`, undefined, 'DELETE')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })

  // ---------- Its connection turned down ----------
  // (Socket Mode turned off for the app: every bot on it needs you. The sidebar's Bots and the
  // phone's More › Bots open at Connections, where the card says why, not at Sessions, where
  // nothing waits.)
  await part('turned down', async () => {
    await slack.linkoff({ app: 'A1' })
    ok(!!(await until(async () => (await kit.api('/bots')).bots.every((x) => x.state === 'error'), 15000)), 'Socket Mode off: every bot on maya_bot\'s app turned down')
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
    const row = p.locator('[data-setting="rail-bots"] .rail-nav-btn')
    ok(!!(await until(async () => Number(await row.locator('.mc-needs').innerText().catch(() => '0')) > 0, 15000)), 'the sidebar\'s Bots says they need you')
    await row.click()
    ok(await shown(p, '.bh[data-tab="connections"]'), 'Bots opens at Connections', await p.locator('.bh').getAttribute('data-tab').catch(() => null))
    ok(/Socket Mode is turned off/.test(await textOf(p, '.bh .cn-card[data-kind="shared"] .cn-state')), 'where the card says why', await textOf(p, '.bh .cn-card[data-kind="shared"] .cn-state'))
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
    const x = await page(b, kit.url, { mode: 'dark', phone: true })
    await x.p.locator('.tabbar button', { hasText: 'More' }).click({ timeout: 20000 })
    await x.p.locator('.m-more-row[data-id="bots"]').click()
    ok(await shown(x.p, '[data-setting="phone-bots"][data-tab="connections"]'), 'a phone\'s More › Bots too', await x.p.locator('[data-setting="phone-bots"]').getAttribute('data-tab').catch(() => null))
    ok(x.errors.length === 0, 'a phone: no page errors', x.errors)
    await x.ctx.close()
    await kit.api(`/connections/${(await botOf(S)).connections.slack.id}/connect`, {})
    ok(!!(await until(async () => (await botOf(S)).state === 'connected', 15000)), 'Connect: connected again')
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  kit.stop()
  slack.stop()
}
process.exit(done().fail ? 1 : 0)
