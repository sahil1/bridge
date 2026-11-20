// Bots set up per use case (a beta feature, its id slack-bot): each bot's Settings on its own page,
// starting points for a use case, a shared connection's Routing with Try a message, and Bots' Bots
// and Connections, with the stand-in Slack (its first app the shared connection), a stand-in model for
// AI Assist (stand-ins/model.mjs) and the stand-in Claude Code answering (stand-ins/helper-claude.cjs).
//   Starting points: each template says the access it starts with (Hiring: people you name, its own
//   memory once you approve, no changes, 20 a day; Marketing: anyone in its channels, memory kept
//   straight away, suggests changes) and its folder when that's here; Hiring made with ~/Hiring has
//   that access as its own from the start, in its record; Marketing, with nothing here that can make
//   a change, starts changing nothing and says so; a folder that isn't there makes nothing.
//   Routing: its rules in connhub's order; whether AI Assist picks, and the bot for when nothing says
//   which (one of the bots on it only).
//   Try a Message, for each rule: a command (the connection's; a bot's own only once there's one for
//   each), the channel's bot, a name first, a reply in a thread, the bot last asked in a direct
//   message, a channel a bot answers in without a mention, the only bot they may ask, AI Assist's
//   pick, the bot set for when nothing says which, asking them which (with no model, said why; with
//   AI Assist off, too), none they may ask, !help, and nothing for any bot; a bot named that they
//   may not ask: that its polite no follows. None of it in the connection's record or a bot's, no
//   last bot kept, nothing posted, no bot run. Without the key: turned away.
//   A bot's Settings, on its page: its line on top, opening Settings; who may ask changed there, and
//   someone turned down before answered now; its limits changed there; Settings › Bots opens Bots.
//   In the app: Bots from the sidebar (a card each: what it's for, its access, how it stands, today,
//   what waits), a card opening its page; Connections: the bots a connection reaches, a channel's
//   bot added on its card, Try a message there; what it's for changed in a bot's Settings; a starting
//   point from AI Assist's chat for a new bot, opening at Settings; light and dark, on a computer and
//   a phone.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSlack, startModel, checks, until, sleep, browser, page, shot, phoneFaults, rawFetch, TEST } from '../lib/harness.mjs'
import { lookers, openSettings, M } from '../lib/bots.mjs'

const { ok, done } = checks('bots-routing')
const slack = await startSlack('bots-routing')
const model = await startModel('bots-routing')
const kit = await startKit('bots-routing', {
  config: { name: 'Tester', trials: { 'slack-bot': true } },
  env: ({ home }) => {
    for (const d of ['Hiring', 'pricing']) fs.mkdirSync(path.join(home, d), { recursive: true })
    fs.writeFileSync(path.join(home, 'Hiring', 'roles.md'), '# Open roles\n\nDesign and sales.\n')
    fs.writeFileSync(path.join(home, 'pricing', 'pricing.md'), '# Pricing\n\nThe Team plan is $12 a seat.\n')
    return {
      BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000',
      // (No model on this computer is reached: AI Assist's is the stand-in's, once it's given.)
      OLLAMA_HOST: 'http://127.0.0.1:9', LM_STUDIO_BASE_URL: 'http://127.0.0.1:9/v1',
    }
  },
})
const { startOf, startsOf, briefOf, botOf, events, posted } = lookers(kit, slack)
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const fwd = (x) => String(x ?? '').replace(/\\/g, '/')
const conn = (id) => kit.api(`/connections/${id}`)
const tryIt = (cid, body) => kit.api(`/connections/${cid}/try`, body)
const DANA = { id: 'U0DANA', name: 'Dana' }
const SAM = { id: 'U0SAM', name: 'Sam' }
const EVE = { id: 'U0EVE', name: 'Eve' }

try {
  await kit.api('/setup', { name: 'Tester' })

  // ---------- Starting points ----------
  await part('starting points', async () => {
    const r = await kit.api('/bots/templates')
    const by = Object.fromEntries(r.templates.map((x) => [x.id, x]))
    ok(r.templates.slice(0, 2).map((x) => x.name).join() === 'Hiring,Marketing', 'Hiring and Marketing first among the starting points', r.templates.map((x) => x.name))
    ok(by.hiring?.access?.who === 'named' && by.hiring.access.memory === 'approve' && by.hiring.access.changes === 'none' && by.hiring.access.limits?.day === 20 && by.hiring.folder === '~/Hiring' && by.hiring.folderHere === true, 'Hiring: people you name, its own memory once you approve, no changes, 20 a day; ~/Hiring, which is here', by.hiring)
    ok(by.marketing?.access?.who === 'channels' && by.marketing.access.memory === 'auto' && by.marketing.access.changes === 'suggest' && by.marketing.folderHere === false, 'Marketing: anyone in its channels, memory kept straight away, suggests changes; ~/Marketing isn\'t here', by.marketing)
    ok(r.canChange === false, 'nothing here can make a change yet (no Claude Code), and that\'s said')
    const h = await kit.api('/bots', { name: 'Hiring', template: 'hiring', readsFrom: ['~/Hiring'] })
    ok(h.settings.who === 'named' && h.settings.memory === 'approve' && h.settings.changes === 'none' && h.settings.limits.day === 20 && h.settings.limits.atOnce === 1 && fwd(h.settings.readsFrom[0]) === '~/Hiring' && !h.notes, 'Hiring made from its starting point: that access its own from the start, reading ~/Hiring', h.settings)
    const made = events(h.id).find((e) => e.type === 'settings.changed' && e.setting === 'created')
    ok(made?.new?.template === 'hiring' && made.new.access?.who === 'named' && made.new.access.memory === 'approve', 'its record says it was made from Hiring, with that access', made?.new)
    const m = await kit.api('/bots', { name: 'Marketing', template: 'marketing' })
    ok(m.settings.who === 'channels' && m.settings.memory === 'auto' && m.settings.changes === 'none' && m.notes?.includes('changes'), 'Marketing with nothing here that can make a change: it starts changing nothing, and says so', { s: m.settings, notes: m.notes })
    const no = await kit.api('/bots', { name: 'Nowhere', template: 'hiring', readsFrom: ['~/not-here'] }).then(() => null, (e) => e)
    ok(!!no && !(await kit.api('/bots')).bots.some((x) => x.name === 'Nowhere'), 'a folder that isn\'t there: refused, and nothing made', no?.message)
  })

  // ---------- A shared connection, three bots ----------
  const made = await kit.api('/connections', { platform: 'slack', name: 'tester_bot' })
  const C = made.id
  await kit.api(`/connections/${C}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots', { name: 'Pricing Desk', description: 'Answers pricing questions: plans, seats and enterprise prices' })
  const ids = Object.fromEntries((await kit.api('/bots')).bots.map((b) => [b.name, b.id]))
  const [HI, MK, PD] = [ids.Hiring, ids.Marketing, ids['Pricing Desk']]
  await kit.api(`/bots/${HI}/settings`, { askers: [DANA] })
  await kit.api(`/bots/${PD}/settings`, { askers: [DANA, SAM], readsFrom: ['~/pricing'] })
  await kit.api(`/connections/${C}`, { owner: { id: 'U0OWNER', name: 'Tester' } }, 'PATCH')
  const up = await until(async () => { const c = await conn(C); return c.state === 'connected' ? c : null }, 20000)
  ok(up?.bots.map((b) => b.name).join() === 'Hiring,Marketing,Pricing Desk', 'the shared connection, connected, reaching the three bots', up?.bots)

  // ---------- Routing ----------
  await part('routing', async () => {
    const r = await kit.api(`/connections/${C}/routing`)
    ok(r.rules.join() === 'command,default,name,thread,last,among,unsure', 'its rules, in connhub\'s order', r.rules)
    ok(r.assist === true && r.unsure === null && r.assistModel?.model === null, 'AI Assist picks (no model yet), and when nothing says which it asks', { assist: r.assist, unsure: r.unsure, model: r.assistModel })
    const bad = await kit.api(`/connections/${C}`, { unsure: 'b99' }, 'PATCH').then(() => null, (e) => e)
    ok(/Pick one of the bots on this connection/.test(bad?.message || ''), 'the bot for when nothing says which is one of its bots', bad?.message)
  })

  // ---------- Try a Message ----------
  // What a dry run mustn't touch: the connection's record, each bot's, who asked which bot last,
  // what's posted, and the bots' runs. (The settings this test changes between tries are in those
  // records, as any change is: those aren't counted.)
  const stateFile = path.join(kit.data, 'connections', C, 'state.json')
  fs.writeFileSync(stateFile, JSON.stringify({ dm: { U0DANA: PD } }))
  const snap = async () => ({
    routed: (await kit.api(`/connections/${C}/activity`)).routed.filter((e) => e.event !== 'settings').length,
    events: [HI, MK, PD].map((b) => events(b).filter((e) => e.type !== 'settings.changed').length).join(),
    state: fs.readFileSync(stateFile, 'utf8'), posted: (await posted()).length, runs: startsOf('').length,
  })
  const before = await snap()
  await part('try a message: with no model', async () => {
    const x = await tryIt(C, { text: 'can you check something for me?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'asked' && x.detail === 'no-model' && x.asks.map((b) => b.id).join() === [HI, MK, PD].join(), 'more than one they may ask, and no model: it would ask them which, saying there\'s no model', x)
  })
  // AI Assist's model from now on (a key, picked for Studio as AI Assist's).
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { studio: { model: 'openai:gpt-5' } }, 'PATCH')
  await part('try a message: each rule', async () => {
    let x = await tryIt(C, { text: '/tester_bot pricing how much is a seat?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'command' && x.bot?.id === PD && x.detail === '/tester_bot' && x.asked === 'how much is a seat?' && x.then?.may === null, '1. /tester_bot pricing …: Pricing Desk by its command, asked without its name', x)
    x = await tryIt(C, { text: '/pricing-desk how much?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'nothing' && x.detail === 'no-command', 'a bot\'s own command, before there\'s one for each: not one of the app\'s, so Slack wouldn\'t send it', x)
    await kit.api(`/connections/${C}`, { perBot: true }, 'PATCH')
    x = await tryIt(C, { text: '/pricing-desk how much?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'command' && x.bot?.id === PD && x.detail === '/pricing-desk', 'with one for each: /pricing-desk is Pricing Desk\'s', x)
    await kit.api(`/connections/${C}`, { perBot: false }, 'PATCH')
    await kit.api(`/connections/${C}`, { defaults: [{ id: 'C0LAUNCH', name: 'launch', bot: MK }] }, 'PATCH')
    x = await tryIt(C, { text: 'Pricing Desk: what does the team plan cost?', channel: 'C0LAUNCH', channelName: 'launch', person: DANA })
    ok(x.rule === 'default' && x.bot?.id === MK && x.detail === 'launch', '2. in #launch, whatever it names: Marketing, the channel\'s bot', x)
    await kit.api(`/connections/${C}`, { defaults: [] }, 'PATCH')
    x = await tryIt(C, { text: 'Hiring: which roles are open?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'name' && x.bot?.id === HI && x.asked === 'which roles are open?' && x.then?.may === null, '3. "Hiring: …": Hiring, asked without its name, and Dana may ask it', x)
    x = await tryIt(C, { text: 'Hiring: who is interviewing today?', channel: 'C0PRIV', person: SAM })
    ok(x.rule === 'name' && x.bot?.id === HI && x.then?.may === 'not-allowed', 'Sam naming Hiring, which he may not ask: to Hiring, and its polite no follows', x)
    x = await tryIt(C, { text: 'and the second round?', channel: 'C0PRIV', person: DANA, thread: HI, mention: false })
    ok(x.rule === 'thread' && x.bot?.id === HI, '4. a reply in a thread Hiring answered in: Hiring', x)
    x = await tryIt(C, { text: 'and for schools?', dm: true, person: DANA })
    ok(x.rule === 'last' && x.bot?.id === PD, '5. a direct message with no name: Pricing Desk, the bot Dana asked last', x)
    await kit.api(`/bots/${HI}/settings`, { listen: [{ id: 'C0PRIV', name: 'secret-project' }] })
    x = await tryIt(C, { text: 'any news on the design role?', channel: 'C0PRIV', person: DANA, mention: false })
    ok(x.rule === 'listen' && x.bot?.id === HI, 'a channel Hiring answers in without a mention: Hiring', x)
    await kit.api(`/bots/${HI}/settings`, { listen: [] })
    x = await tryIt(C, { text: 'anything new this week?', channel: 'C0PRIV', person: EVE })
    ok(x.rule === 'only' && x.bot?.id === MK && x.may.map((b) => b.id).join() === MK, '6. Eve may ask only Marketing: Marketing', x)
    const asked = model.asked(/^The bots \(an id/).length
    x = await tryIt(C, { text: 'what\'s the enterprise price for 50 seats?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'router' && x.bot?.id === PD, '6. AI Assist\'s pick from the descriptions: Pricing Desk', x)
    ok(model.asked(/^The bots \(an id/).length === asked + 1, 'its model asked once, as it would be')
    x = await tryIt(C, { text: 'can you check something for me?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'asked' && x.detail === 'unsure' && x.asks.length === 3, '7. when AI Assist can\'t tell: it would ask them which, saying so', x)
    await kit.api(`/connections/${C}`, { unsure: MK }, 'PATCH')
    x = await tryIt(C, { text: 'can you check something for me?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'unsure' && x.bot?.id === MK && x.detail === 'unsure', '7. with a bot set for that: Marketing', x)
    await kit.api(`/connections/${C}`, { unsure: null, assist: false }, 'PATCH')
    const n = model.asked(/^The bots \(an id/).length
    x = await tryIt(C, { text: 'what\'s the enterprise price for 50 seats?', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'asked' && x.detail === 'off' && model.asked(/^The bots \(an id/).length === n, 'AI Assist off: it would ask them which, and nothing went to the model', x)
    await kit.api(`/connections/${C}`, { assist: true }, 'PATCH')
    await kit.api(`/bots/${MK}/settings`, { paused: true })
    x = await tryIt(C, { text: 'anything new this week?', channel: 'C0PRIV', person: EVE })
    ok(x.rule === 'none' && x.detail === 'not-allowed' && !x.bot, 'Marketing paused, Eve may ask none: the polite no', x)
    await kit.api(`/bots/${MK}/settings`, { paused: false })
    x = await tryIt(C, { text: '!help', channel: 'C0PRIV', person: DANA })
    ok(x.rule === 'help', '!help: its bots listed', x)
    x = await tryIt(C, { text: 'lunch anyone?', channel: 'C0PRIV', person: DANA, mention: false })
    ok(x.rule === 'nothing' && x.detail === 'no-mention', 'no mention, no thread, no bot listening there: for no bot', x)
    x = await tryIt(C, { text: 'Hiring: which roles are open?', channel: 'C0PRIV', person: 'you' })
    ok(x.rule === 'name' && x.bot?.id === HI && x.then?.may === null, 'as you: Hiring, which you may always ask', x)
  })
  await part('try a message: nothing kept, nothing run', async () => {
    await sleep(800)
    const after = await snap()
    ok(JSON.stringify(after) === JSON.stringify(before), 'nothing in the connection\'s record or a bot\'s, the last bot kept as it was, nothing posted, no bot run', { before, after })
    const out = await rawFetch(`${kit.url}/api/connections/${C}/try`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hiring: hi' }) })
    ok(out.status === 401, 'without the key: turned away', out.status)
    const empty = await tryIt(C, { text: '  ' }).then(() => null, (e) => e)
    ok(/Type a message/.test(empty?.message || ''), 'an empty message: said', empty?.message)
  })

  // Claude Code to answer from now on.
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
  await kit.api('/agents/catalog')
  await part('a real question still routed', async () => {
    await slack.ask({ user: 'U0EVE', channel: 'C0PRIV', text: `${M} Hiring: which roles are open? [answer Design and sales.]` })
    ok(!!(await until(() => events(HI).find((e) => e.type === 'refused' && e.why === 'not-allowed'), 15000)), 'Eve naming Hiring, before she may ask it: refused, in its record')
    ok(!startsOf('which roles are open').length, 'and nothing ran')
  })

  // ---------- In the app ----------
  const { b, which } = await browser()
  const tag = which === 'webkit' ? 'webkit-' : ''
  const shown = (p, sel, ms = 10000) => p.locator(sel).first().waitFor({ timeout: ms }).then(() => true, () => false)
  const textOf = (p, sel) => p.locator(sel).first().innerText().catch(() => '')
  try {
    // Its Settings on a bot's page: who may ask, changed there, applies at once; its limits too.
    await part('Settings on its page', async () => {
      const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
      await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click()
      await p.locator('.bh-tabs [data-tab="bots"]').click()
      await p.locator(`.bh .bo-card[data-bot="${HI}"]`).click()
      const line = await until(async () => { const x = await textOf(p, '.bp [data-setting="bots-access-line"]'); return /Hiring/.test(x) ? x : null }, 10000)
      ok(/^Hiring: 1 person may ask · reads ~[\\/]Hiring · own memory · changes nothing$/.test((line || '').trim()), 'its line on top: "Hiring: 1 person may ask · reads ~/Hiring · own memory · changes nothing"', line)
      await p.locator('.bp [data-setting="bots-access-line"]').click()
      ok(await shown(p, '.bp [data-setting="bot-settings"] [data-setting="slack-askers"]') && await p.locator('.bp .sb-tabs [data-tab="settings"]').getAttribute('aria-selected') === 'true', 'which opens its Settings: who may ask, its folder, whether it edits files')
      const adv = p.locator('.bp [data-setting="bot-advanced"]')
      if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
      await shown(p, '.bp [data-setting="bot-advanced"] [data-setting="slack-limits"]')
      const secs = await p.locator('.bp [data-setting="bot-settings"] [data-setting]').evaluateAll((l) => l.map((e) => e.getAttribute('data-setting')))
      ok(['slack-askers', 'slack-folders', 'bot-edits', 'slack-changes', 'bots-access-memory', 'bots-mcp', 'bots-answerers', 'slack-limits'].every((k) => secs.includes(k)), 'each part of what it may do is there, the rest under Advanced', secs)
      await p.locator('.bp [data-setting="slack-askers"] label.sb-mode', { hasText: 'Everyone in channels' }).click()
      ok(!!(await until(async () => (await botOf(HI)).settings.who === 'channels', 8000)), 'who may ask, changed on its page: everyone in its channels')
      ok(!!(await until(async () => /^Hiring: anyone in its channels may ask/.test((await textOf(p, '.bp [data-setting="bots-access-line"]')).trim()), 8000)), 'its line says so')
      const day = p.locator('.bp [data-setting="slack-limits"] input').first()
      await day.fill('12')
      await day.blur()
      ok(!!(await until(async () => (await botOf(HI)).settings.limits.day === 12, 8000)), 'its limits, changed on its page')
      await p.locator('.bp [data-setting="bots-access-memory"] button', { hasText: 'Keep straight away' }).click()
      ok(!!(await until(async () => (await botOf(HI)).settings.memory === 'auto', 8000)), 'its memory: kept straight away')
      await p.locator('.bp [data-setting="bots-access-memory"] button', { hasText: 'Ask me first' }).click()
      await p.locator('.bp .bp-main').evaluate((e) => { e.scrollTop = 0 })
      await sleep(300)
      await shot(p, `${tag}bots-routing-access-light`)
      // The setting applies: Eve, turned down before, is answered now.
      await slack.ask({ user: 'U0EVE', channel: 'C0PRIV', text: `${M} Hiring: which roles are open now? [answer Design and sales.]` })
      const s = await startOf('which roles are open now')
      ok(/You're Hiring/.test(briefOf(s)), 'Eve asks Hiring again: answered now, by Hiring', briefOf(s).slice(0, 120))
      ok(!errors.length, 'no page errors', errors)
      await ctx.close()
    })

    // Settings › Bots: the switch, and Open Bots.
    await part('Settings › Bots opens Bots', async () => {
      const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
      await openSettings(p, 'slack-bot', '.modal.settings [data-setting="bots-beta"]')
      await p.locator('.modal.settings [data-setting="bots-open"]').click()
      ok(!!(await until(async () => !(await p.locator('.modal.settings').count()) && await p.locator('.bh[data-setting="bots-home"]').isVisible(), 8000)), 'Settings › Bots: Open Bots opens Bots')
      ok(!errors.length, 'no page errors', errors)
      await ctx.close()
    })

    // Bots and its Connections, light and dark.
    for (const mode of ['light', 'dark']) {
      await part(`Bots and Connections, ${mode}`, async () => {
        const { ctx, p, errors } = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky' })
        await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click()
        await p.locator('.bh-tabs [data-tab="bots"]').click()
        ok(await shown(p, `.bh .bo-card[data-bot="${HI}"]`), `${mode}: Bots, from the sidebar, a card for each bot`)
        ok((await p.locator('.bh .bo-card').count()) === 3, `${mode}: its three bots`)
        const card = await until(async () => { const x = await p.locator(`.bh .bo-card[data-bot="${HI}"]`).innerText(); return /question/.test(x) && /wait/.test(x) ? x : null }, 15000)
        ok(/Answers the hiring team/.test(card || '') && /Anyone in its channels may ask · reads ~[\\/]Hiring · own memory/.test(card || '') && /Needs you/.test(card || '') && /\d questions? today/.test(card || '') && /1 waits for you/.test(card || ''), `${mode}: Hiring's card: what it's for, its access, how it stands, today, and the answer waiting for you`, card)
        await sleep(300)
        await shot(p, `${tag}bots-routing-overview-${mode}`)
        await p.locator('.bh-tabs [data-tab="connections"]').click()
        const conn1 = p.locator(`.bh-card[data-connection="${C}"]`)
        ok(await shown(p, `.bh-card[data-connection="${C}"]`), `${mode}: Connections: tester_bot's card`)
        const chips = await conn1.locator('[data-setting="connection-bots"] [data-bot]').evaluateAll((l) => l.map((e) => e.dataset.bot))
        ok(chips.join() === [HI, MK, PD].join(), `${mode}: the three bots it reaches`, chips)
        await sleep(300)
        await shot(p, `${tag}bots-routing-rules-${mode}`)
        if (mode === 'light') {
          // A channel's bot, added on the card.
          const def = conn1.locator('[data-setting="connection-defaults"]')
          await until(async () => (await def.locator('select').first().locator('option').count()) > 1, 10000)
          await def.locator('select').nth(0).selectOption('C0LAUNCH')
          await def.locator('select').nth(1).selectOption(PD)
          await def.locator('button', { hasText: 'Add' }).click()
          ok(!!(await until(async () => (await conn(C)).defaults.some((d) => d.id === 'C0LAUNCH' && d.bot === PD), 8000)), 'a channel\'s bot added on the card: #launch → Pricing Desk')
          // Try a message, on the card.
          const n0 = await snap()
          await conn1.locator('[data-setting="routing-try"] > summary').click()
          await until(async () => (await conn1.locator('.ro-try select').first().locator('option').count()) > 3, 10000)
          await conn1.locator('.ro-try textarea').fill('Pricing Desk: what does the team plan cost?')
          await conn1.locator('.ro-try select').nth(0).selectOption('c:C0LAUNCH')
          await conn1.locator('.ro-try select').nth(1).selectOption('U0SAM')
          await conn1.locator('.ro-try button[type="submit"]').click()
          ok(await shown(p, `.ro-out[data-rule="default"][data-bot="${PD}"]`, 10000), 'Try a message: Sam in #launch goes to Pricing Desk, #launch\'s bot', await textOf(p, '.ro-out'))
          ok(/Rule 2, the channel's bot/.test(await textOf(p, '.ro-out')) && /They may ask Pricing Desk, so it would answer\./.test(await textOf(p, '.ro-out')) && /nothing was sent, answered or kept/.test(await textOf(p, '.ro-out')), 'saying which rule, that Sam may ask it, and that nothing was sent', await textOf(p, '.ro-out'))
          await conn1.locator('.ro-try textarea').fill('Hiring: who is interviewing today?')
          await conn1.locator('.ro-try select').nth(0).selectOption('dm')
          await conn1.locator('.ro-try select').nth(1).selectOption('U0SAM')
          await conn1.locator('.ro-try button[type="submit"]').click()
          ok(!!(await until(async () => /named first|names Hiring/.test(await textOf(p, '.ro-out')) || null, 8000)), 'a direct message naming Hiring: Hiring', await textOf(p, '.ro-out'))
          await sleep(500)
          const n1 = await snap()
          ok(n1.routed === n0.routed && n1.events === n0.events && n1.runs === n0.runs && n1.posted === n0.posted, 'and from the page too, nothing kept, posted or run', { n0, n1 })
          await kit.api(`/connections/${C}`, { defaults: [] }, 'PATCH')
          // What it's for, changed in its Settings: what the Chief picks it by.
          await p.locator('.bh-tabs [data-tab="bots"]').click()
          await p.locator(`.bh .bo-card[data-bot="${MK}"]`).click()
          await p.locator('.bp .sb-tabs [data-tab="settings"]').click()
          const desc = p.locator('.bp [data-setting="bot-purpose"] input')
          await desc.fill('Answers questions about campaigns and the brand guide')
          await desc.press('Enter')
          ok(!!(await until(async () => (await botOf(MK)).description === 'Answers questions about campaigns and the brand guide', 8000)), 'Marketing\'s description, changed in its Settings')
          await p.locator('[data-setting="rail-bots"] .rail-nav-btn').click()
          await p.locator('.bh-tabs [data-tab="connections"]').click()
          await p.locator(`.bh-card[data-connection="${C}"] .ro-try`).scrollIntoViewIfNeeded().catch(() => {})
          await sleep(300)
          await shot(p, `${tag}bots-routing-routing-${mode}`)
        }
        await p.locator('.bh-tabs [data-tab="bots"]').click()
        await p.locator(`.bh .bo-card[data-bot="${PD}"]`).first().click()
        ok(!!(await until(async () => (await textOf(p, '.bp .bp-name')) === 'Pricing Desk', 8000)), `${mode}: a card opens its bot's page`)
        ok(!errors.length, `${mode}: no page errors`, errors)
        await ctx.close()
      })
    }

    // A starting point from AI Assist's chat for a new bot: opened at Settings once it's made.
    await part('a starting point from the chat', async () => {
      const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
      await p.locator('[data-setting="rail-bots"] .rail-tool[aria-label="New bot"]').click()
      ok(await shown(p, '.bh [data-setting="bots-quick"]'), '+ in the sidebar: a new bot\'s three questions')
      await p.locator('.bh [data-setting="bots-quick"] .ai-assist-link').click()
      await p.locator('.bc [data-setting="bots-use-cases"] [data-template="hiring"]').click()
      ok(await shown(p, '.bc [data-setting="bots-start"]'), 'Hiring, picked: what it starts with, and its folder')
      const start = await textOf(p, '.bc [data-setting="bots-start"]')
      ok(/People you name may ask · reads ~[\\/]Hiring · own memory · changes nothing · 20 questions a day each/.test(start), 'it says the access it starts with', start)
      ok(fwd(await p.locator('.bc [data-setting="bots-start"] input').inputValue()) === '~/Hiring', 'its folder, which is here, to start from')
      await p.locator('.bc .sb-new input').fill('Hiring West')
      await shot(p, `${tag}bots-routing-start`)
      await p.locator('.bc .sb-new button[type="submit"]').click()
      ok(!!(await until(async () => (await textOf(p, '.bp .bp-name')) === 'Hiring West' && (await p.locator('.bp .sb-tabs [data-tab="settings"]').getAttribute('aria-selected').catch(() => null)) === 'true', 10000)), 'made: its page, at Settings')
      const v = (await kit.api('/bots')).bots.find((x) => x.name === 'Hiring West')
      const s = v && (await botOf(v.id)).settings
      ok(s?.who === 'named' && s.memory === 'approve' && fwd(s.readsFrom[0]) === '~/Hiring' && s.limits.day === 20, 'with Hiring\'s access as its own', s)
      ok(!errors.length, 'no page errors', errors)
      await ctx.close()
    })

    // A phone: Bots, a connection's Try a message, and a bot's Settings, each fitting.
    for (const mode of ['light', 'dark']) {
      await part(`a phone, ${mode}`, async () => {
        const { ctx, p, errors } = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', phone: true })
        await p.locator('.tabbar button', { hasText: 'More' }).click()
        await p.locator('.m-more-row[data-id="bots"]').click()
        await p.locator('[data-setting="phone-bots"] .bh-tabs [data-tab="bots"]').click()
        ok(await shown(p, `[data-setting="phone-bots"] .bo-card[data-bot="${HI}"]`), `${mode}, a phone: Bots`)
        await sleep(400)
        let faults = await phoneFaults(p, '[data-setting="phone-bots"]')
        ok(!Object.keys(faults).length, `${mode}, a phone: Bots fits`, faults)
        await shot(p, `${tag}bots-routing-phone-overview-${mode}`)
        await p.locator('[data-setting="phone-bots"] .bh-tabs [data-tab="connections"]').click()
        const card = p.locator(`[data-setting="phone-bots"] .bh-card[data-connection="${C}"]`)
        await card.locator('[data-setting="routing-try"] > summary').click()
        ok(await shown(p, `[data-setting="phone-bots"] .bh-card[data-connection="${C}"] .ro-try textarea`), `${mode}, a phone: a connection's Try a message`)
        await card.locator('.ro-try textarea').fill('what\'s the enterprise price for 50 seats?')
        await card.locator('.ro-try button[type="submit"]').click()
        ok(await shown(p, `[data-setting="phone-bots"] .ro-out[data-rule="router"][data-bot="${PD}"]`, 15000), `${mode}, a phone: Try a message, AI Assist's pick`, await textOf(p, '.ro-out'))
        await sleep(300)
        faults = await phoneFaults(p, '[data-setting="phone-bots"]')
        ok(!Object.keys(faults).length, `${mode}, a phone: Connections fits`, faults)
        await shot(p, `${tag}bots-routing-phone-routing-${mode}`)
        await p.locator('[data-setting="phone-bots"] .bh-tabs [data-tab="bots"]').click()
        await p.locator(`[data-setting="phone-bots"] .bo-card[data-bot="${HI}"]`).click()
        await p.locator('.bp.phone .sb-tabs [data-tab="settings"]').click()
        const adv = p.locator('.bp.phone [data-setting="bot-advanced"]')
        if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
        ok(await shown(p, '.bp.phone [data-setting="bot-settings"] [data-setting="slack-askers"]'), `${mode}, a phone: a bot's Settings`)
        await p.locator('.bp.phone [data-setting="slack-limits"] input').first().fill('15')
        await p.locator('.bp.phone [data-setting="slack-limits"] input').first().blur()
        ok(!!(await until(async () => (await botOf(HI)).settings.limits.day === 15, 8000)), `${mode}, a phone: its limits changed from the phone`)
        await sleep(300)
        faults = await phoneFaults(p, '.bp.phone .bp-main')
        ok(!Object.keys(faults).length, `${mode}, a phone: its Settings fit`, faults)
        await shot(p, `${tag}bots-routing-phone-access-${mode}`)
        ok(!errors.length, `${mode}, a phone: no page errors`, errors)
        await ctx.close()
      })
    }
  } finally {
    await b.close().catch(() => {})
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await kit.stop()
  slack.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
