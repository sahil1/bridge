// Bots in Microsoft Teams, end to end: a stand-in for Microsoft (stand-ins/teams.mjs: the Bot
// Framework's signing keys, Microsoft Entra ID's sign-in and the Bot Connector, which sends the
// bot signed messages) and a stand-in Claude Code answering (stand-ins/helper-claude.cjs), in the
// browser named by BRIDGE_TEST_BROWSER.
//   Settings › Bots › Where It Answers › Microsoft Teams: the steps for someone doing it the first
//   time (the Azure Bot, its IDs and client secret, a tunnel of your own to the port shown, the
//   messaging endpoint, the Teams app to upload), the three pasted and checked with Microsoft (a
//   wrong secret said at once), the tunnel's address saved and checked. The Teams app downloaded.
//   Who may ask, by Teams' people, and you in Teams. A message in a chat with the bot and a mention
//   in a channel: one read-only agent briefed as a bot in Microsoft Teams, its draft in Needs You,
//   sent as a reply in that chat or that post's thread ("typing…" for 👀, no reactions); a reply in
//   that thread without a mention goes on from that answer. Refused, with no agent started: someone
//   not named, a guest, someone from another organization, someone Teams didn't say who they are;
//   a message not signed by Microsoft for this bot never heard, and counted in Settings. !help says
//   how to ask in Teams; !what do you know about me only to them, in a chat of their own. Every
//   event names Teams, and the client secret is in no log, record, command line or agent's
//   environment. Settings in light and dark, on a computer and a phone.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startTeams, checks, until, sleep, browser, page, shot, phoneFaults, TEST, IS_WIN } from '../lib/harness.mjs'
import { lookers, openSettings } from '../lib/bots.mjs'
import { unzip } from '../../server/teamsapp.js'

const { ok, done } = checks('teams-bot')
const tm = await startTeams('teams-bot')
const { appId, password, tenantId } = tm.app
const kit = await startKit('teams-bot', {
  config: { name: 'Tester', trials: { 'slack-bot': true } },
  env: ({ home }) => {
    fs.mkdirSync(path.join(home, 'pricing'), { recursive: true })
    return { BRIDGE_TEAMS_URL: tm.url, BRIDGE_TEAMS_PORT: '0', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_HOLD_MS: '3000' }
  },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
const { draftOf, startOf, startsOf, briefOf, botOf, events } = lookers(kit, null)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const st = () => tm.state()
const postedLike = (re, ms = 20000) => until(async () => (await st()).posted.find((x) => re.test(x.text || '')), ms)
const where = async () => (await botOf()).where?.teams || {}
fs.writeFileSync(path.join(kit.home, 'pricing', 'pricing.md'), '# Pricing\n\nEnterprise is $40 a seat, billed yearly.\n')
const CHANNEL = '19:launch@thread.tacv2'

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  await kit.api('/bots', { name: 'Atlas' })
  await kit.api('/bots/b1/settings', { readsFrom: ['~/pricing'] })

  // ---------- Set up in Settings ----------
  let port = null
  await part('connecting in Settings', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await openSettings(p)
    await p.locator('.sb-where-tabs [data-platform="teams"]').click()
    const sec = p.locator('[data-setting="teams-connect"]')
    const steps = await sec.locator('.sb-steps').innerText()
    ok(/Create a resource › Azure Bot/.test(steps) && /Single Tenant/.test(steps) && /Microsoft App ID and the App Tenant ID/.test(steps) && /New client secret/.test(steps) && /tunnel of your own/.test(steps) && /Messaging endpoint/.test(steps) && /Upload a custom app/.test(steps), 'the steps for a first time: the Azure Bot, its IDs and secret, a tunnel, the messaging endpoint, the Teams app', steps)
    ok(/cloudflared tunnel --url http:\/\/localhost:\d+/.test(steps) && /devtunnel host -p \d+ --allow-anonymous/.test(steps), 'with the tunnel commands to run, for its port')
    await shot(p, `${tag}teams-bot-steps`)
    const fill = async (secret) => {
      await sec.locator('input').nth(0).fill(appId)
      await sec.locator('input').nth(1).fill(tenantId)
      await sec.locator('input[type="password"]').fill(secret)
      await sec.locator('form.sb-tokens button[type="submit"]').click()
    }
    await fill('wrong-secret')
    ok(!!(await until(async () => /turned the client secret down/.test(await sec.innerText()), 10000)), 'a wrong client secret: said at once, saying it\'s the Value it wants')
    await fill(password)
    ok(!!(await until(async () => /Signed in to Microsoft as its Azure Bot, and listening on this computer at port \d+/.test(await sec.innerText()), 20000)), 'connected: signed in, and listening', await sec.innerText().catch(() => ''))
    port = (await where()).port
    ok(port > 0 && (await where()).listening?.host === '127.0.0.1', 'listening on this computer only', await where())
    await sec.locator('.sb-tunnel input').fill(`http://127.0.0.1:${port}/api/messages`)
    await sec.locator('.sb-tunnel button[type="submit"]').click()
    await until(async () => (await where()).endpoint?.url === `http://127.0.0.1:${port}/api/messages`, 8000)
    await sec.locator('.sb-tunnel button', { hasText: 'Check' }).click()
    ok(!!(await until(async () => /Your tunnel reaches it/.test(await sec.innerText()), 15000)), 'its tunnel\'s address saved, and checked: it reaches this bot')
    ok(/http:\/\/127\.0\.0\.1:\d+\/api\/messages/.test(await sec.locator('.sb-steps').innerText()), 'the messaging endpoint to paste in Azure, shown')
    ok(await sec.locator('a', { hasText: 'Download the Teams app' }).count() === 1, 'and its Teams app to download')
    ok(/…et-1/.test(await sec.locator('.sb-have').innerText()) && !(await p.content()).includes(password), 'its secret shown only as its last four')
    await sleep(400)
    await shot(p, `${tag}teams-bot-connected`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  await tm.endpoint(`http://127.0.0.1:${port}/api/messages`)
  const file = path.join(kit.data, 'bots', 'b1', 'teams.json')
  ok(fs.existsSync(file) && (IS_WIN || (fs.statSync(file).mode & 0o777) === 0o600), 'its credentials in its own folder, yours only', IS_WIN ? null : (fs.statSync(file).mode & 0o777).toString(8))

  // ---------- The Teams app ----------
  const zip = await fetch(`${kit.url}/api/bots/b1/teams/app.zip`)
  const files = unzip(Buffer.from(await zip.arrayBuffer()))
  const man = JSON.parse(files['manifest.json'] || '{}')
  ok(zip.ok && /attachment; filename="Atlas-teams\.zip"/.test(zip.headers.get('content-disposition') || '') && man.bots?.[0]?.botId === appId && man.name?.short === 'Atlas' && files['color.png'] && files['outline.png'], 'its Teams app, to upload: the bot, named Atlas, with its icons', { disposition: zip.headers.get('content-disposition'), name: man.name })
  ok(!JSON.stringify(man).includes(password), 'with no secret in it')

  // ---------- Who may ask ----------
  await tm.install()
  ok(!!(await until(() => events().find((e) => e.type === 'connection' && e.platform === 'teams' && e.what === 'installed'), 8000)), 'added to a team: in its record')
  const people = (await kit.api('/bots/b1/people')).people
  ok(people.some((x) => x.id === 'teams:aad-dana-0001' && x.name === 'Dana Reyes' && x.platform === 'teams') && !people.some((x) => /gus/.test(x.id)), 'its people from Teams, by their Entra ID (no guests)', people)
  await kit.api('/bots/b1/settings', { askers: [{ id: 'teams:aad-dana-0001', name: 'Dana Reyes' }], owners: { teams: { id: 'teams:aad-tester-0004', name: 'Tester' } } })

  // ---------- Questions ----------
  await part('questions', async () => {
    const q1 = await tm.say({ user: 'dana', text: 'what\'s the enterprise price? [answer Enterprise is $40 a seat.]' })
    ok(q1.status === 200, 'a message in a chat with it, signed by Microsoft: taken', q1.status)
    const s = await startOf('enterprise price')
    const brief = briefOf(s)
    ok(/You're Atlas, Tester's bot in Microsoft Teams/.test(brief) && /Tester's organization in Microsoft Teams/.test(brief) && /as Dana Reyes wrote it in Microsoft Teams/.test(brief) && !/FILE:/.test(brief), 'one agent, briefed as a bot in Microsoft Teams, the question as Dana wrote it there', brief.slice(0, 500))
    ok(!!(await until(async () => (await st()).typing.some((x) => x.conversation === q1.conversation), 8000)), '"typing…" where she asked, for 👀')
    const d = await draftOf('enterprise price')
    ok(d?.draft === 'Enterprise is $40 a seat.' && d.place?.kind === 'dm' && d.from?.id === 'teams:aad-dana-0001', 'its draft in Needs You', d)
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true })
    const p = await postedLike(/\$40 a seat/)
    ok(p?.conversation === q1.conversation && p.replyTo === q1.id && p.textFormat === 'markdown', 'sent, as a reply in that chat', p)
    ok(!events().some((e) => e.type === 'reaction' && e.platform === 'teams'), 'and no reactions (Teams has none for bots), nor a failure for them')
    // A mention in a channel, then a reply in its thread with no mention.
    const q2 = await tm.say({ user: 'dana', kind: 'channel', mention: true, text: 'when do we launch? [answer On Friday.]' })
    const d2 = await draftOf('when do we launch')
    ok(d2?.place?.name === 'Launch' && d2.place.within === 'Acme Team', 'a mention in a channel, from Launch in Acme Team', d2?.place)
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: true })
    const p2 = await postedLike(/On Friday/)
    ok(p2?.conversation === `${CHANNEL};messageid=${q2.id}` && p2.replyTo === q2.id, 'answered in that post\'s thread', p2)
    await tm.say({ user: 'dana', kind: 'channel', thread: q2.id, text: 'and what time? [answer At 10.]' })
    const f = await startOf('what time')
    ok(/goes on from your earlier answers in this Microsoft Teams thread/.test(briefOf(f)) && f.args.includes('--resume'), 'a reply in its thread, without a mention, goes on from that answer', f?.args)
    const d3 = await draftOf('what time')
    await kit.api(`/bots/questions/${encodeURIComponent(d3.id)}`, { send: true })
    ok((await postedLike(/At 10/))?.conversation === `${CHANNEL};messageid=${q2.id}`, 'in the same thread')
  })

  // ---------- Refused, and turned away ----------
  await part('refusals', async () => {
    const before = startsOf('').length
    await tm.say({ user: 'sam', kind: 'channel', mention: true, text: 'what\'s the discount? [answer nope]' })
    ok(!!(await postedLike(/I only answer questions from people Tester has added/)), 'someone not named: a polite no, in the thread')
    await tm.say({ user: 'gus', kind: 'channel', mention: true, text: 'guest asking [answer nope]' })
    await tm.say({ user: 'xena', text: 'another organization [answer nope]' })
    await tm.say({ user: 'eve', noAad: true, text: 'nobody knows who [answer nope]' })
    const refused = await until(() => { const r = events().filter((e) => e.type === 'refused' && e.platform === 'teams').map((e) => e.why); return ['not-allowed', 'guest', 'external', 'unknown'].every((x) => r.includes(x)) ? r : null }, 15000)
    ok(!!refused, 'not named, a guest, another organization, someone Teams didn\'t say who: each refused, saying why', events().filter((e) => e.type === 'refused').map((e) => e.why))
    for (const w of ['bad-signature', 'wrong-audience', 'serviceurl-mismatch']) {
      const r = await tm.say({ user: 'dana', text: `forged ${w} [answer leaked]`, token: w })
      ok(r.status === 401, `a message not signed by Microsoft for this bot (${w}): turned away`, r.status)
    }
    await sleep(800)
    ok(startsOf('').length === before, 'and no agent started for any of them', startsOf('').length - before)
    ok(!events().some((e) => /forged/.test(e.text || '')), 'nothing of a forged one in its record')
    const v = await where()
    ok(v.rejected?.n === 3 && /signature|another app|another address/.test(v.rejected.why || ''), 'how many were turned away, and why, for Settings', v.rejected)
    await tm.say({ user: 'tester', kind: 'channel', mention: true, text: 'the owner asks [answer Yes.]' })
    ok(!!(await draftOf('the owner asks')), 'you in Teams, not named under Who Can Ask: answered all the same')
  })

  // ---------- Commands ----------
  await part('commands', async () => {
    await tm.say({ user: 'dana', text: '!help' })
    const h = await postedLike(/I'm Atlas, Tester's bot/)
    ok(/Ask me by mentioning me, or in a direct message\./.test(h?.text || '') && !/shortcut/.test(h?.text || ''), '!help says how to ask in Teams', h?.text)
    await tm.say({ user: 'dana', kind: 'channel', mention: true, text: '!what do you know about me' })
    const told = await postedLike(/I don't remember anything about you|Here's what I remember/)
    ok(told?.conversation === 'a:personal-dana', 'asked in a channel: told only her, in a chat of her own', told)
  })

  // ---------- The record, and no secret anywhere ----------
  await part('the record', async () => {
    const evs = events()
    const rec = evs.filter((e) => e.type === 'received' && /^teams:/.test(e.channel))
    ok(rec.length >= 6 && rec.every((e) => e.platform === 'teams'), 'each question in the record names Teams', rec.map((e) => e.platform))
    ok(evs.some((e) => e.type === 'connection' && e.platform === 'teams' && e.what === 'connected') && evs.some((e) => e.type === 'connection' && e.platform === 'teams' && e.what === 'rejected'), 'and its connection, and the messages turned away')
    ok((await kit.api('/bots/b1/activity?platform=teams')).conversations.every((c) => c.platform === 'teams'), 'Activity, by platform')
    ok((await kit.api('/bots/b1/activity')).integrity?.ok, 'the record whole')
    const all = [fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8'), ...fs.readdirSync(path.join(kit.data, 'bots', 'b1', 'trace')).filter((x) => x.endsWith('.jsonl')).map((x) => fs.readFileSync(path.join(kit.data, 'bots', 'b1', 'trace', x), 'utf8')), fs.readFileSync(path.join(kit.dir, 'server.log'), 'utf8'), JSON.stringify(await botOf())].join('\n')
    ok(!all.includes(password), 'its client secret in no setting, record, log or view')
    const runs = startsOf('')
    ok(runs.length >= 4 && runs.every((x) => !JSON.stringify(x.args).includes(password) && !x.message.includes(password) && !(x.secrets || []).length), 'nor on an agent\'s command line, nor in its environment', runs.map((x) => x.secrets))
  })

  // ---------- Settings, light and dark, computer and phone ----------
  await part('Settings', async () => {
    for (const [mode, phone] of [['dark', false], ['light', true], ['dark', true]]) {
      const { ctx, p, errors } = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', phone })
      await openSettings(p)
      await p.locator('.sb-where-tabs [data-platform="teams"]').click()
      await p.locator('[data-setting="teams-owner"]').waitFor({ timeout: 8000 })
      const sec = await p.locator('[data-setting="teams-connect"]').innerText()
      ok(/3 messages to it were turned away/.test(sec) && /Last heard from Teams/.test(sec), `${mode}${phone ? ', a phone' : ''}: what was turned away, and when it last heard from Teams`, sec.slice(0, 400))
      ok(/Dana Reyes\s*Microsoft Teams/.test(await p.locator('[data-setting="slack-askers"] .sb-askers').innerText()), `${mode}${phone ? ', a phone' : ''}: who may ask, with where they're from`)
      if (phone) {
        await sleep(300)
        const faults = await phoneFaults(p, '.modal.settings .sb')
        ok(!Object.keys(faults).length, `${mode}, a phone: nothing too small or wider than the screen`, faults)
      }
      await shot(p, `${tag}teams-bot-${mode}${phone ? '-phone' : ''}`)
      ok(errors.length === 0, `${mode}${phone ? ', a phone' : ''}: no page errors`, errors)
      await ctx.close()
    }
  })

  // ---------- Disconnected ----------
  await kit.api('/bots/b1/teams', null, 'DELETE')
  ok(!fs.existsSync(file) && (await where()).state === 'no-tokens', 'disconnected: its secret deleted from this computer')
  ok(!(await fetch(`http://127.0.0.1:${port}/api/messages`, { method: 'POST' }).then(() => true, () => false)), 'and it no longer listens')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  await kit.stop()
  tm.stop()
}
process.exit(done().fail ? 1 : 0)
