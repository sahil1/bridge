// Setting up a bot, as someone does it the first time, in the browser named by BRIDGE_TEST_BROWSER,
// with stand-ins for Slack, Discord and Microsoft Teams (stand-ins/slack.mjs, discord.mjs,
// teams.mjs) and Claude Code answering (stand-ins/helper-claude.cjs).
//   Beta Features: the Bots line says where to start, and turned on offers Set up a bot, which
//   opens Bots. With no bot yet, Make Your First Bot says what one is in a line, and AI Assist with no
//   model offers the form. A bot made, each place it answers (Slack, Discord, Teams) has its checklist
//   under its Settings' Where It Answers (Advanced): seven steps from the bot made to its first answer, each with the clicks on that
//   platform's own site, a button to the page where there is one, and what to do when it doesn't
//   work. Each step ticks itself as it's done: the app and its tokens, connected, you there,
//   invited (or added to a server, or to Teams), and its first answer sent. All done, it folds away
//   to a line, and How to set up brings it back. Light and dark, on a computer and a phone.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSlack, startDiscord, startTeams, checks, until, sleep, browser, page, shot, phoneFaults, TEST } from '../lib/harness.mjs'
import { lookers, openSettings } from '../lib/bots.mjs'

const { ok, done } = checks('bots-guide')
const slack = await startSlack('bots-guide')
const dc = await startDiscord('bots-guide')
await dc.heartbeat({ ms: 800 })
const tm = await startTeams('bots-guide')
const kit = await startKit('bots-guide', {
  config: { name: 'Tester' },
  env: { BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_DISCORD_URL: dc.url, BRIDGE_TEAMS_URL: tm.url, BRIDGE_TEAMS_PORT: '0', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000' },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
const { draftOf, botOf } = lookers(kit, slack)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const send = async (words) => { const d = await draftOf(words); if (d) await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true }); return d }

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
  const guide = (platform) => p.locator(`[data-setting="${platform}-guide"]`)
  // How many of its steps are ticked, as the page shows them (it looks again every few seconds).
  const ticked = (platform, n, ms = 25000) => until(async () => (await guide(platform).locator('li.g-done').count()) >= n, ms, 250)
  const textOf = (platform) => guide(platform).innerText().catch(() => '')

  // ---------- Where to start ----------
  await part('where to start', async () => {
    await openSettings(p, 'about', '.modal.settings [data-setting="beta"]')
    const line = p.locator('[data-setting="beta"] label.st-check', { hasText: /^Bots/ })
    const hint = await line.locator('span[title]').first().getAttribute('title')
    ok(/Slack, Discord and Microsoft Teams/.test(hint || '') && /To start: Bots in the sidebar\.$/.test(hint || ''), 'the Bots beta feature says what it is, and ends with where to start', hint)
    ok(!(await p.locator('[data-setting="beta-bots-start"]').count()), 'off: no Set up a bot')
    await line.locator('input[type="checkbox"]').check()
    const start = p.locator('[data-setting="beta-bots-start"] button', { hasText: 'Set up a bot' })
    ok(!!(await start.waitFor({ timeout: 5000 }).then(() => true, () => false)), 'turned on: Set up a bot, right there')
    await start.click()
    const first = p.locator('.bh [data-setting="bots-quick"]')
    ok(!!(await first.waitFor({ timeout: 8000 }).then(() => true, () => false)) && !(await p.locator('.modal.settings').count()), 'which opens Bots, Settings closed')
    const said = await first.innerText()
    ok(/Make Your First Bot/.test(said) && /A bot answers people in Slack, Discord or Microsoft Teams/.test(said), 'with no bot yet: Make Your First Bot, what one is in a line', said)
    await shot(p, `${tag}bots-guide-first`)
    await first.locator('.ai-assist-link').click()
    await p.locator('.bc .bc-form .sb-new input').fill('Atlas')
    await p.locator('.bc .bc-form .sb-new button[type="submit"]').click()
    await p.locator('.bp .sb-tabs [data-tab="settings"]').waitFor({ timeout: 10000 })
    await sleep(400)
    // (Its page opens with AI Assist's chat beside it, which has the same steps: closed, so the
    // checklist here is its Settings' own.)
    if (await p.locator('.bp-chat .ai-head-close').count()) await p.locator('.bp-chat .ai-head-close').click()
    await p.locator('.bp .sb-tabs [data-tab="settings"]').click({ timeout: 10000 })
    const adv = p.locator('.bp [data-setting="bot-advanced"]')
    if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
    ok(!!(await guide('slack').waitFor({ timeout: 10000 }).then(() => true, () => false)), 'with no model, AI Assist\'s form: its name, then its checklist under its Settings\' Advanced')
  })

  // ---------- Slack ----------
  await part('Slack', async () => {
    const t0 = await textOf('slack')
    ok(/Set Up in Slack/.test(t0) && /1 of 7 done/.test(t0) && (await guide('slack').locator('li').count()) === 7, 'Set Up in Slack: seven steps, the bot made ticked', t0.slice(0, 200))
    ok(/Basic Information › App-Level Tokens › Generate Token and Scopes/.test(t0) && /connections:write/.test(t0) && /Install App › Install to Workspace/.test(t0) && /\/invite @Atlas/.test(t0), 'each with the clicks on Slack\'s own site', t0)
    ok((t0.match(/If it doesn't work:/g) || []).length === 6, 'and what to do when one doesn\'t work', (t0.match(/If it doesn't work:/g) || []).length)
    const href = await guide('slack').locator('a', { hasText: 'Open Slack\'s app page' }).getAttribute('href')
    ok(/api\.slack\.com\/apps\?new_app=1&manifest_json=/.test(href || '') && JSON.parse(decodeURIComponent(href.split('manifest_json=')[1])).display_information.name === 'Atlas', 'a button to Slack\'s app page, its manifest filled in', href?.slice(0, 80))
    await shot(p, `${tag}bots-guide-slack-start`)
    await kit.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
    ok(!!(await ticked('slack', 5)), 'its tokens pasted and connected, and in #launch: the app, the tokens, connected and invited tick themselves', await textOf('slack'))
    ok(/5 of 7 done/.test(await textOf('slack')), '5 of 7')
    await kit.api('/bots/b1/settings', { owner: { id: 'U0OWNER', name: 'Tester' }, who: 'channels' })
    ok(!!(await ticked('slack', 6)), 'you in Slack, set: ticked')
    await slack.ask({ user: 'U0DANA', text: '<@UBOT> what\'s new? [answer All quiet.]' })
    await send('what\'s new')
    ok(!!(await until(async () => /Atlas is set up in Slack/.test(await textOf('slack')), 25000)), 'its first answer sent: every step done, and the checklist folds away to a line')
    await guide('slack').locator('button', { hasText: 'How to set up' }).click()
    ok(!!(await until(async () => (await guide('slack').locator('li.g-done').count()) === 7, 5000)), 'How to set up: the checklist again, every step ticked')
    await guide('slack').locator('button', { hasText: 'Fold it away' }).click()
    ok(!!(await until(async () => /Atlas is set up in Slack/.test(await textOf('slack')), 5000)), 'and Fold it away')
  })

  // ---------- Discord ----------
  await part('Discord', async () => {
    await p.locator('.sb-where-tabs [data-platform="discord"]').click()
    const t0 = await textOf('discord')
    ok(/Set Up in Discord/.test(t0) && /1 of 7 done/.test(t0) && /Bot › Reset Token › Yes, do it!/.test(t0) && /Message Content Intent and Server Members Intent/.test(t0), 'Set Up in Discord: its steps, with the Developer Portal\'s clicks', t0.slice(0, 300))
    ok(await guide('discord').locator('a[href="https://discord.com/developers/applications"]').count() === 1, 'a button to the Developer Portal')
    await kit.api('/bots/b1/discord', { token: 'dtest.bot-one.0123456789abcdef', guild: '3001' })
    ok(!!(await ticked('discord', 5)), 'its token pasted, connected and in your server: ticked', await textOf('discord'))
    await kit.api('/bots/b1/settings', { owners: { discord: { id: 'discord:2004', name: 'Tester' } } })
    ok(!!(await ticked('discord', 6)), 'you in Discord: ticked')
    await dc.say({ user: '2001', text: '<@1001> what\'s up on Discord? [answer Nothing much.]' })
    await send('up on Discord')
    ok(!!(await until(async () => /Atlas is set up in Discord/.test(await textOf('discord')), 25000)), 'its first answer: done, folded away')
  })

  // ---------- Teams ----------
  await part('Teams', async () => {
    await p.locator('.sb-where-tabs [data-platform="teams"]').click()
    const t0 = await textOf('teams')
    ok(/Set Up in Microsoft Teams/.test(t0) && /1 of 7 done/.test(t0) && /Create a resource › Azure Bot/.test(t0) && /New client secret/.test(t0) && /Upload a custom app/.test(t0), 'Set Up in Microsoft Teams: the Azure Bot, its IDs, the tunnel, the Teams app', t0.slice(0, 300))
    await kit.api('/bots/b1/teams', tm.app)
    ok(!!(await ticked('teams', 3)), 'its IDs and secret pasted: ticked')
    const port = (await botOf()).where.teams.port
    await kit.api('/bots/b1/teams/endpoint', { publicUrl: `http://127.0.0.1:${port}` })
    await kit.api('/bots/b1/teams/check', {})
    ok(!!(await ticked('teams', 4)), 'its tunnel checked: reachable, ticked')
    ok(await guide('teams').locator('a', { hasText: 'Download the Teams app' }).count() === 1, 'its Teams app to download, in the step that needs it')
    await kit.api('/bots/b1/settings', { owners: { teams: { id: 'teams:aad-tester-0004', name: 'Tester' } } })
    ok(!!(await ticked('teams', 5)), 'you in Teams: ticked')
    await tm.endpoint(`http://127.0.0.1:${port}/api/messages`)
    await tm.install()
    ok(!!(await ticked('teams', 6)), 'added to a team: ticked')
    await tm.say({ user: 'tester', text: 'hello from Teams [answer Hi.]' })
    await send('hello from Teams')
    ok(!!(await until(async () => /Atlas is set up in Microsoft Teams/.test(await textOf('teams')), 25000)), 'its first answer: done, folded away')
  })
  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()

  // ---------- Light and dark, a computer and a phone ----------
  await kit.api('/bots', { name: 'Pricing Desk' })
  for (const [mode, phone] of [['dark', false], ['light', true], ['dark', true]]) {
    await part(`${mode}${phone ? ', a phone' : ''}`, async () => {
      const x = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', phone })
      if (phone) {
        await x.p.locator('.tabbar button', { hasText: 'More' }).click({ timeout: 20000 })
        await x.p.locator('.m-more-row[data-id="bots"]').click()
      } else await x.p.locator('[data-setting="rail-bots"] .rail-nav-btn').click({ timeout: 20000 })
      await x.p.locator('.bh-tabs [data-tab="bots"]').click()
      await x.p.locator('.bh .bo-card', { hasText: 'Pricing Desk' }).click()
      await x.p.locator('.bp .sb-tabs').first().waitFor({ state: 'attached', timeout: 10000 })
      await x.p.waitForTimeout(300)
      // (Not connected anywhere yet, it opens with AI Assist's chat: on a phone, over the page.)
      if (await x.p.locator('.bp.phone .bp-chat .ai-head-close').count()) await x.p.locator('.bp.phone .bp-chat .ai-head-close').click()
      await x.p.locator('.bp .sb-tabs [data-tab="settings"]').click()
      const adv = x.p.locator('.bp [data-setting="bot-advanced"]')
      if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
      await x.p.locator('[data-setting="slack-guide"] li').first().waitFor({ timeout: 8000 })
      ok(/1 of 7 done/.test(await x.p.locator('[data-setting="slack-guide"]').innerText()), `${mode}${phone ? ', a phone' : ''}: a new bot's checklist`)
      if (phone) {
        await sleep(300)
        const faults = await phoneFaults(x.p, '.bp.phone .bp-main')
        ok(!Object.keys(faults).length, `${mode}, a phone: nothing too small, off the screen or cut short`, faults)
      }
      await shot(x.p, `${tag}bots-guide-${mode}${phone ? '-phone' : ''}`)
      ok(x.errors.length === 0, `${mode}${phone ? ', a phone' : ''}: no page errors`, x.errors)
      await x.ctx.close()
    })
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  await kit.stop()
  slack.stop(); dc.stop(); tm.stop()
}
process.exit(done().fail ? 1 : 0)
