// Bots from your phone and your other computers, not only at the computer they run on: "Desk", where
// the bots run (stand-ins for Slack, Discord and Teams, Claude Code answering), on a relay of its own
// (stand-ins/relay.mjs), with a phone paired and "Studio", another computer, linked; in the browser
// named by BRIDGE_TEST_BROWSER.
//   The phone page, paired through the relay, 390 px wide: Bots from no bot to one made from a
//   template, its name, who may ask, an app of its own in Connections (Slack's, Discord's and Teams'
//   links out), its Slack tokens pasted there and connected, you linked there by a code (You Here), a
//   folder to read from and its instructions file picked from Desk's own folders,
//   its limits, paused and resumed, Try It answered, a memory taught, its export and its record
//   downloaded to the phone, its links out opening in the phone's browser, and Activity naming the
//   phone; every section, tab and place it answers in with nothing too small, off the screen or cut
//   short, light and dark. The iPhone app (its bridgeNative stood in for) takes the export to its
//   share sheet; the Android app says it can't save files yet.
//   Through the phone's link (lib/linkclient.mjs): a bot made from a template, each of its settings,
//   its folders and instructions file (inside your home folder only, never Bridge AI's own, a link to
//   it included), its Slack tokens, Discord token and server, Teams IDs, tunnel, Check and Teams app,
//   its people and channels to pick from, You in Slack, Discord and Teams, who may ask by name, a
//   channel it answers in without a mention, Try It, its memory, its export, an import, Disconnect,
//   deleted and its history deleted. Its record names the phone for each; no token ever comes back.
//   A shared connection (Connections) made, its tokens pasted, you there set and it deleted, from
//   the phone too.
//   Through Studio's link (/m/<id>/): the same for another bot, its record naming Studio; and Studio's
//   window on Desk, its Bots working there, a folder picked from Desk's, the export downloaded.
//   Bots off: none of it there, from the phone or Studio.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, startDiscord, startTeams, checks, until, sleep, browser, page, shot, phoneFaults, phoneNotes, phoneSaw, browserNotice, ROOT, IS_WIN } from '../lib/harness.mjs'
import { botKit, openBot, askOnce, answerIn, newBotChat } from '../lib/bots.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, done } = checks('bots-remote')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const relays = []
const kits = []
const SECRETS = ['xapp-test', 'xoxb-test', 'xapp-two', 'xoxb-two', 'dtest.bot-one.0123456789abcdef', 'teams-secret-1']
const leaked = (s) => SECRETS.filter((x) => String(s).includes(x))
// A folder as the server keeps it (~\pricing on Windows).
const kept = (rel) => (IS_WIN ? `~\\${rel.replace(/\//g, '\\')}` : `~/${rel}`)

let dc = null
let tm = null
let slack = null
try {
  const rd = await startRelay('bots-remote-desk')
  const rs = await startRelay('bots-remote-studio')
  relays.push(rd, rs)
  dc = await startDiscord('bots-remote')
  await dc.heartbeat({ ms: 800 })
  tm = await startTeams('bots-remote')
  const made = await botKit('bots-remote-desk', {
    folders: ['pricing', 'launch', 'notes'],
    env: ({ data, home }) => {
      fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rd.relayFile))
      fs.writeFileSync(path.join(home, 'pricing', 'BOT.md'), '# Pricing Desk\n\nAnswer from the price list.\n')
      fs.writeFileSync(path.join(home, 'pricing', 'prices.md'), 'Seats are $40 a month.\n')
      fs.writeFileSync(path.join(home, 'launch', 'BOT.md'), '# Launch\n')
      fs.writeFileSync(path.join(home, 'notes', 'todo.md'), 'Nothing.\n')
      // A link to Bridge AI's own folder, inside the home folder.
      try { fs.symlinkSync(data, path.join(home, 'escape'), IS_WIN ? 'junction' : 'dir') } catch { /* no links here */ }
      return { BRIDGE_COMPUTER_NAME: 'Desk', BRIDGE_DISCORD_URL: dc.url, BRIDGE_TEAMS_URL: tm.url, BRIDGE_TEAMS_PORT: '0' }
    },
  })
  const desk = made.kit
  slack = made.slack
  kits.push(desk)
  const { events, botOf } = made
  const studio = await startKit('bots-remote-studio', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rs.relayFile)); return { BRIDGE_COMPUTER_NAME: 'Studio' } } })
  kits.push(studio)
  await desk.api('/setup', { name: 'Tester' })
  await studio.api('/setup', { name: 'Tester' })
  await desk.api('/agents/catalog')
  ok(!!(await until(async () => (await desk.api('/relay')).online && (await studio.api('/relay')).online, 20000)), 'Desk and Studio are each connected to their own relay')
  // Studio linked with Desk.
  await studio.api('/machines', { link: `${rd.url} ${(await desk.api('/relay/pair', {})).pairing.code}` })
  const deskM = await until(async () => (await studio.api('/machines')).machines.find((m) => m.name === 'Desk' && m.online), 30000, 300)
  ok(!!deskM, 'Studio is linked with Desk')
  const hasLink = fs.existsSync(path.join(desk.home, 'escape'))

  // ---------- The phone page, through the relay ----------
  // Paired with Desk with a new code each time, as a phone's browser (or, given native, the iPhone
  // app's bridgeNative stood in for; given android, the Android app's frame): { ctx, phone, f: Bridge
  // AI's frame, errors, name: the phone's name on Desk }.
  const phonePage = async ({ mode = 'light', theme = 'sky', ua = null, native = null, android = false } = {}) => {
    const code = (await desk.api('/relay/pair', {})).pairing.code
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...(ua ? { userAgent: ua } : {}), isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, colorScheme: mode })
    await ctx.addInitScript((look) => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ ...look, text: 'm' })) } catch { /* no storage */ } }, { mode, theme })
    await phoneNotes(ctx)
    if (native) await ctx.addInitScript(native, new URL(rd.url).origin)
    if (android) await ctx.addInitScript(() => { if (window !== window.top) window.bridgeAndroid = {} })
    const phone = await ctx.newPage()
    const errors = []
    phone.on('pageerror', (e) => { if (!browserNotice(e.message)) errors.push(e.message) })
    await phone.goto(`${rd.url}/#pair=${code}`, { waitUntil: 'commit' })
    await phone.locator('#pair-go').click({ timeout: 15000 })
    const frame = () => phone.frames().find((x) => x !== phone.mainFrame() && x.url().startsWith(rd.url))
    const opened = await until(() => frame()?.evaluate(() => fetch('/api/version').then((x) => x.ok)), 30000, 200)
    ok(!!opened, `a phone${native ? ' (the iPhone app)' : android ? ' (the Android app)' : ''} paired with Desk through the relay, Bridge AI open in it`, opened ? undefined : await phoneSaw(phone))
    return { ctx, phone, f: opened ? frame() : null, errors }
  }
  // The phone paired last, by its name on Desk (the page names it: "Mac, browser").
  const newestPhone = async () => [...((await desk.api('/relay')).devices || [])].filter((d) => d.kind !== 'computer').sort((x, y) => String(x.addedAt).localeCompare(String(y.addedAt))).pop()?.name || null
  // Every section of a bot's Settings (Advanced open), each brought into view, then each tab:
  // anything too small, off the screen or cut short, by where it was.
  const allFaults = async (f) => {
    const out = {}
    const look = async (where) => { await sleep(150); const x = await phoneFaults(f, '.bp.phone .bp-main'); if (Object.keys(x).length) out[where] = x }
    const tab = (name) => f.locator('.bp .sb-tabs button', { hasText: name }).click()
    await tab('Settings')
    await advanced(f)
    for (const s of await f.locator('.bp .bp-main [data-setting]').all()) {
      await s.scrollIntoViewIfNeeded().catch(() => {})
      await look(`Settings: ${await s.getAttribute('data-setting')}`)
    }
    for (const t of ['Overview', 'Memory', 'Activity']) {
      await tab(t)
      await f.locator('.bp .bp-main .st-sec').first().waitFor({ timeout: 8000 })
      await look(t)
      const last = f.locator('.bp .bp-main .st-sec').last()
      await last.evaluate((e) => e.lastElementChild?.scrollIntoView({ block: 'end' })).catch(() => {})
      await look(`${t}, its end`)
    }
    await tab('Settings')
    return out
  }
  // Its Settings' Advanced, open; and AI Assist's chat, which a new bot's page opens with (on a
  // phone, over the whole page), closed.
  const advanced = async (f) => {
    const adv = f.locator('.bp [data-setting="bot-advanced"]')
    await adv.waitFor({ timeout: 10000 })
    if (!(await adv.evaluate((d) => d.open))) await adv.locator(':scope > summary').click()
    await f.locator('.bp [data-setting="bot-advanced"] [data-setting="slack-limits"]').waitFor({ timeout: 8000 })
  }
  const noChat = async (f) => { if (await f.locator('.bp-chat .ai-head-close').count()) await f.locator('.bp-chat .ai-head-close').click() }

  let harbor = null
  let phoneName = null
  await part('the phone: Bots, start to finish', async () => {
    const { ctx, phone, f, errors } = await phonePage()
    if (!f) { await ctx.close(); return }
    phoneName = await until(newestPhone, 10000)
    await newBotChat(f, { form: true })
    const sec = (k) => f.locator(`.bp .bp-main [data-setting="${k}"]`)
    ok(!/computer it runs on/.test(await f.locator('.bc').innerText()), 'no bot yet: a new bot\'s form, right there on the phone', await f.locator('.bc').innerText())
    const tpl = f.locator('.sb-tpl').nth(1)
    const tplName = (await tpl.locator('b').innerText()).trim()
    await tpl.click()
    await f.locator('.sb-new input').fill('Harbor')
    await f.locator('.sb-new button[type="submit"]').click()
    await f.locator('.bp .sb-tabs [data-tab="settings"]').waitFor({ state: 'attached', timeout: 10000 })
    await sleep(400)
    await noChat(f)
    await f.locator('.bp .sb-tabs [data-tab="settings"]').click()
    await advanced(f)
    await sec('bot-where').waitFor({ timeout: 10000 })
    harbor = (await desk.api('/bots')).bots.find((x) => x.name === 'Harbor')
    ok(!!harbor && !!events(harbor.id).find((e) => e.setting === 'created')?.new?.template, `a bot made on the phone, from a template (${tplName})`, harbor)
    const off = await f.locator('.bp .bp-main :is(input, select, textarea, button):disabled').evaluateAll((l) => l.map((e) => e.getAttribute('aria-label') || e.placeholder || e.innerText || e.name).filter(Boolean))
    ok(!off.some((x) => /^(Its name in Slack|xapp-…|xoxb-…|~\/code)$/.test(x)), 'nothing in its Settings is greyed out on the phone', off)
    ok(!/computer it runs on/.test(await f.locator('.bp .bp-main').innerText()), 'and nothing says to do it on the computer it runs on')
    ok(/Not on Slack, Discord or Microsoft Teams yet/.test(await sec('bot-where').innerText()), 'where it answers, in a line: nowhere yet')

    // Its name, who may ask.
    const nameBox = sec('bot-name').locator('input')
    await nameBox.fill('Harbor Desk')
    await nameBox.blur()
    ok(!!(await until(async () => (await botOf(harbor.id)).name === 'Harbor Desk', 8000)), 'renamed on the phone')
    await sec('slack-askers').locator('label.sb-mode', { hasText: 'Everyone in channels' }).click()
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.who === 'channels', 8000)), 'who may ask, changed on the phone')

    // An app of its own on each platform, from Connections on the phone (Open in Connections).
    await sec('bot-where').locator('button', { hasText: 'Open in Connections' }).click()
    const own = async (platform) => {
      const add = f.locator(`.bh [data-setting="connections-new"] .cn-new-one[data-platform="${platform}"]`)
      if (!(await add.evaluate((d) => d.open))) await add.locator(':scope > summary').click()
      await add.locator('[data-setting="connection-own"] option', { hasText: 'Harbor Desk' }).waitFor({ state: 'attached', timeout: 10000 })
      await add.locator('[data-setting="connection-own"] select').selectOption({ label: 'Harbor Desk' })
      await add.locator('[data-setting="connection-own"] button', { hasText: 'Give it its own app' }).click()
      const card = f.locator(`.bh .cn-card[data-platform="${platform}"][data-kind="own"]`)
      await card.locator(`[data-setting="${platform}-guide"]`).waitFor({ timeout: 10000 })
      return card
    }
    const card = await own('slack')
    // Links out: each a link of its own to open in the phone's browser (the apps open a new
    // window's link there: WebViewController.swift createWebViewWith, MainActivity's
    // shouldOverrideUrlLoading); none is followed here.
    const open = card.locator('[data-setting="slack-guide"] a', { hasText: 'Open Slack\'s app page' })
    const at = { href: await open.getAttribute('href'), target: await open.getAttribute('target'), rel: await open.getAttribute('rel'), box: await open.boundingBox() }
    ok(/^https:\/\/api\.slack\.com\/apps\?new_app=1&manifest_json=/.test(at.href || '') && at.target === '_blank' && /noreferrer/.test(at.rel || '') && at.box?.height >= 40, 'An App of Its Own, on the phone: Open Slack\'s app page, opening Slack\'s page in the phone\'s browser', { ...at, href: at.href?.slice(0, 60) })
    const portal = (await own('discord')).locator('[data-setting="discord-guide"] a[href="https://discord.com/developers/applications"]')
    ok(await portal.count() === 1 && await portal.getAttribute('target') === '_blank', 'the Developer Portal, the same')
    const azure = (await own('teams')).locator('[data-setting="teams-guide"] a[href^="https://portal.azure.com/"]')
    ok(await azure.count() === 1 && await azure.getAttribute('target') === '_blank', 'and the Azure portal')

    // Its Slack tokens, on its card.
    const tokens = card.locator('[data-setting="slack-connect"] form.sb-tokens')
    await tokens.locator('input').nth(0).fill('xapp-test')
    await tokens.locator('input').nth(1).fill('xoxb-test')
    await tokens.locator('button[type="submit"]').click()
    ok(!!(await until(async () => (await botOf(harbor.id)).state === 'connected', 20000)), 'its Slack tokens pasted on the phone: connected')
    await card.locator('[data-setting="connection-advanced"] > summary').click()
    ok(!!(await until(async () => /xoxb-…test|…test/.test(await card.locator('[data-setting="slack-connect"]').innerText()) && !leaked(await card.locator('[data-setting="slack-connect"]').innerText()).length, 8000)), 'and shown only by their last four', await card.locator('[data-setting="slack-connect"]').innerText())
    // You there: Link me, its code sent to the app in a direct message.
    const you = card.locator('[data-setting="connection-you"]')
    await you.locator('button', { hasText: 'Link me' }).click()
    const code = (await card.locator('[data-setting="connection-link-code"]').innerText({ timeout: 10000 })).trim()
    await slack.ask({ user: 'U0OWNER', dm: true, text: code })
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.owner?.id === 'U0OWNER' && /Tester/.test(await you.innerText()), 15000)), 'You Here: linked from the phone, its code sent to the app')
    const cf = await phoneFaults(f, '[data-setting="phone-bots"]')
    if (cf.covered) cf.covered = cf.covered.filter((x) => !/ under Sections <nav\.tabbar>$/.test(x))
    if (!cf.covered?.length) delete cf.covered
    ok(!Object.keys(cf).length, 'Connections on the phone: nothing too small, off the screen or cut short', cf)
    await shot(phone, `${tag}bots-remote-phone-connections`)
    await openBot(f, { name: 'Harbor Desk' })

    // A folder to read from, picked from Desk's own folders.
    const folders = sec('slack-folders')
    await folders.locator('button', { hasText: 'Choose…' }).click()
    const list = folders.locator('.sb-browse')
    await list.waitFor({ timeout: 8000 })
    const names = await until(async () => { const x = await list.locator('.sb-browse-list button').allInnerTexts(); return x.length ? x.map((y) => y.trim()) : null }, 10000)
    ok(['launch', 'notes', 'pricing'].every((n) => names?.includes(n)) && !names.some((n) => n.startsWith('.')), 'Choose… lists Desk\'s home folder, its folders and not what\'s hidden', names)
    await list.scrollIntoViewIfNeeded()
    await shot(phone, `${tag}bots-remote-phone-choose`)
    await list.locator('.sb-browse-list button', { hasText: 'pricing' }).click()
    ok(!!(await until(async () => /~\/pricing$/.test(await list.locator('.sb-browse-at').innerText()), 8000)), 'a folder opened in it')
    await list.locator('button', { hasText: 'Read from this folder' }).click()
    // (The list closes once the setting's saved, a moment after it is.)
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.readsFrom.includes(kept('pricing')), 8000)) && !!(await until(async () => !(await list.count()), 8000)), 'Read from this folder: it reads from it, and the list closes', (await botOf(harbor.id)).settings.readsFrom)
    ok(/~[\\/]pricing/.test(await folders.locator('.sb-folders').innerText()), 'listed under Reads From')

    // Its instructions file, from the folders it reads from.
    await sec('bot-purpose').locator('.bs-more').click()
    const ins = sec('slack-instructions')
    await ins.locator('label.sb-mode', { hasText: 'Use this file instead' }).click()
    await ins.locator('button', { hasText: 'Choose…' }).click()
    const files = ins.locator('.sb-browse')
    await files.locator('.sb-browse-list button', { hasText: 'BOT.md' }).click({ timeout: 8000 })
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.instructionsFile === kept('pricing/BOT.md'), 8000)), 'Use this file instead: BOT.md picked from the folder it reads from', (await botOf(harbor.id)).settings.instructionsFile)

    // Its limits; paused and resumed.
    const day = sec('slack-limits').locator('input').first()
    await day.fill('12')
    await day.blur()
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.limits.day === 12, 8000)), 'its limits, changed on the phone')
    await sec('slack-pause').locator('button', { hasText: 'Pause' }).click()
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.paused === true, 8000)), 'paused on the phone')
    await sec('slack-pause').locator('button', { hasText: 'Resume' }).click()
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.paused === false, 8000)), 'and resumed')

    // Its export, downloaded to the phone by the relay's page.
    const got = phone.waitForEvent('download', { timeout: 30000 }).catch(() => null)
    await sec('slack-export').locator('button', { hasText: 'Export Harbor Desk' }).click()
    const dl = await got
    const body = dl && await dl.path().then((x) => fs.readFileSync(x, 'utf8'), () => '')
    let bundle = null
    try { bundle = JSON.parse(body) } catch { /* not JSON */ }
    ok(dl?.suggestedFilename() === 'Harbor-Desk.bridge-bot.json' && bundle?.name === 'Harbor Desk' && !leaked(body).length, 'Export: the bot\'s file downloaded to the phone, with no token in it', { name: dl?.suggestedFilename(), bot: bundle?.name, leaked: leaked(body) })
    ok(/Downloading Harbor-Desk\.bridge-bot\.json to this device\./.test(await sec('slack-export').innerText()), 'and says so', await sec('slack-export').innerText())

    // A test session: its session, opened on the phone, answered on Desk.
    const tried = await askOnce(f, 'What do seats cost? [answer Seats are $40 a month.]')
    const draft = await until(async () => { const x = await answerIn(tried); return /\$40 a month/.test(x) && x }, 40000)
    ok(!!draft, 'a test session on the phone: its answer, from Desk', draft || await tried.innerText().catch(() => ''))
    // (Back to its page from the session: its bot, over the Thread.)
    if (await f.locator('.bh-sv').count()) await f.locator('.bh-sv-meta .link-btn').first().click()
    await f.locator('.bp .sb-tabs').first().waitFor({ timeout: 10000 })

    // Memory.
    await f.locator('.sb-tabs button', { hasText: 'Memory' }).click()
    await sec('slack-memory').locator('.sb-mem-add input').fill('Prices change each January')
    await sec('slack-memory').locator('.sb-mem-add button[type="submit"]').click()
    ok(!!(await until(async () => /Prices change each January/.test(await sec('slack-memory').locator('.sb-mem').first().innerText().catch(() => '')), 8000)), 'something taught on the phone, kept')
    await sec('slack-memory').locator('.sb-mem-mode button', { hasText: 'Keep straight away' }).click()
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.memory === 'auto', 8000)), 'its memory\'s mode, changed on the phone')

    // Activity: what was changed, and on which device; its record downloaded.
    await f.locator('.sb-tabs button', { hasText: 'Activity' }).click()
    const act = sec('slack-activity')
    await act.locator('.sb-keep button', { hasText: '1 year' }).click()
    ok(!!(await until(async () => (await botOf(harbor.id)).settings.retention === '1y', 8000)), 'how long its record is kept, changed on the phone')
    await act.locator('.sb-changes summary').click({ timeout: 10000 })
    const lines = await until(async () => { const x = await act.locator('.sb-changes').innerText(); return x.includes('who') && x }, 10000)
    ok(new RegExp(`Tester changed who on ${phoneName.replace(/[()]/g, '\\$&')}: named → channels`).test(lines || ''), `Activity: each change says it was made on ${phoneName}`, lines)
    ok(new RegExp(`Tester kept in its memory, on ${phoneName.replace(/[()]/g, '\\$&')}: “Prices change each January”`).test(lines || ''), 'what was taught too', lines)
    const csv = phone.waitForEvent('download', { timeout: 30000 }).catch(() => null)
    await act.locator('.sb-export button', { hasText: 'Export' }).click()
    const c = await csv
    ok(c?.suggestedFilename() === 'Harbor-Desk-activity.csv' && /^at,type,conversation/.test(await c.path().then((x) => fs.readFileSync(x, 'utf8'), () => '')), 'its record exported to the phone', c?.suggestedFilename())
    await shot(phone, `${tag}bots-remote-phone-activity`)
    const faults = await allFaults(f)
    ok(!Object.keys(faults).length, 'light, 390 px: every section, tab and place it answers in, with nothing too small, off the screen or cut short', faults)
    await shot(phone, `${tag}bots-remote-phone-light`)
    ok(errors.length === 0, 'no page errors on the phone', errors)
    await ctx.close()
  })

  // ---------- Through the phone's link ----------
  let atlas = null
  await part('through the phone\'s link', async () => {
    const phone = await linkAs(rd.url, { code: (await desk.api('/relay/pair', {})).pairing.code, name: 'Pocket', about: { name: 'Pocket' } })
    ok(!phone.refused && !!phone.request, 'a phone paired with Desk in Node, as Pocket', phone.refused)
    const said = []
    const ask = async (m, u, body) => { const r = await phone.request(m, `/api${u}`, body); said.push(JSON.stringify(r.json ?? '')); return r }
    const okay = (r) => r.status === 200
    const templates = (await ask('GET', '/bots/templates')).json?.templates || []
    let r = await ask('POST', '/bots', { name: 'Atlas', template: templates[0]?.id })
    atlas = r.json
    ok(okay(r) && atlas?.name === 'Atlas' && !!templates[0], 'a bot made from a template', r)
    const id = atlas?.id
    r = await ask('POST', `/bots/${id}/settings`, { description: 'Answers about prices', who: 'channels', others: 'silent', auto: true, retention: '1y', memory: 'auto', limits: { day: 7, atOnce: 1, minutes: 5 }, agentsStatus: true, agentCopies: true, readsFrom: ['~/pricing', '~/launch'] })
    const s = r.json?.settings
    ok(okay(r) && s?.who === 'channels' && s.others === 'silent' && s.auto === true && s.retention === '1y' && s.memory === 'auto' && s.limits.day === 7 && s.agentsStatus && s.agentCopies && s.readsFrom.length === 2, 'its settings: who may ask, what others get, how answers go, its record, memory, limits, its folders', s)
    r = await ask('POST', `/bots/${id}/settings`, { instructionsFile: '~/launch/BOT.md', changes: 'suggest', repo: s?.readsFrom[1], paused: true })
    ok(okay(r) && r.json.settings.instructionsFile === kept('launch/BOT.md') && r.json.settings.changes === 'suggest' && r.json.settings.repo === s?.readsFrom[1] && r.json.settings.paused, 'its instructions file, changes and their repository, paused', r.json?.settings)
    r = await ask('POST', `/bots/${id}/settings`, { paused: false, instructions: 'Answer in one line.', name: 'Atlas Prime' })
    ok(okay(r) && r.json.name === 'Atlas Prime' && !r.json.settings.paused && r.json.instructions.text.includes('Answer in one line.'), 'renamed, resumed, its instructions written', r.json?.name)
    // What's checked stays checked.
    const refused = {
      outside: await ask('POST', `/bots/${id}/settings`, { readsFrom: ['~/../outside'] }),
      home: await ask('POST', `/bots/${id}/settings`, { readsFrom: ['~'] }),
      file: await ask('POST', `/bots/${id}/settings`, { instructionsFile: '~/notes/todo.md' }),
      ...(hasLink ? { own: await ask('POST', `/bots/${id}/settings`, { readsFrom: ['~/escape'] }) } : {}),
    }
    ok(refused.outside.status >= 400 && /inside your home folder/.test(refused.outside.json?.error) && refused.home.status >= 400 && /not the whole of it/.test(refused.home.json?.error) && refused.file.status >= 400 && /one of the folders it reads from/.test(refused.file.json?.error), 'refused from the phone too: a folder outside your home folder, the whole of it, a file outside its folders', Object.fromEntries(Object.entries(refused).map(([k, v]) => [k, v.json?.error])))
    if (hasLink) ok(refused.own.status >= 400 && /Bridge AI's own folder/.test(refused.own.json?.error) && !(await botOf(id)).settings.readsFrom.some((f) => /escape/.test(f)), 'and Bridge AI\'s own folder, through a link to it in the home folder', refused.own.json)
    // Where it answers.
    r = await ask('POST', `/bots/${id}/tokens`, { appToken: 'xapp-two', botToken: 'xoxb-two' })
    ok(okay(r) && !!(await until(async () => (await botOf(id)).state === 'connected', 20000)), 'its Slack tokens, from the phone: connected', r.json?.error)
    const people = await ask('GET', `/bots/${id}/people`)
    const channels = await ask('GET', `/bots/${id}/channels`)
    ok(okay(people) && people.json.people.some((p) => p.id === 'U0DANA') && okay(channels) && channels.json.channels.some((c) => c.id === 'C0LAUNCH'), 'the workspace\'s people and its channels, to pick from on the phone', { people: people.status, channels: channels.status })
    r = await ask('POST', `/bots/${id}/settings`, { owner: { id: 'U0OWNER', name: 'Tester' }, askers: [{ id: 'U0DANA', name: 'Dana' }], listen: [{ id: 'C0LAUNCH', name: 'launch' }], muted: [] })
    ok(okay(r) && r.json.settings.owner?.id === 'U0OWNER' && r.json.settings.askers[0]?.id === 'U0DANA' && r.json.settings.listen[0]?.id === 'C0LAUNCH', 'You in Slack, who may ask by name, a channel it answers in without a mention', r.json?.settings)
    r = await ask('POST', `/bots/${id}/discord`, { token: 'dtest.bot-one.0123456789abcdef' })
    ok(okay(r), 'its Discord token, checked and kept', r.json?.error)
    const guilds = await until(async () => { const v = await botOf(id); return v.where?.discord?.guilds?.length > 1 && v.where.discord.guilds }, 20000)
    r = await ask('POST', `/bots/${id}/discord/server`, { guild: guilds?.[1]?.id })
    ok(okay(r) && !!(await until(async () => (await botOf(id)).where?.discord?.guild?.id === guilds?.[1]?.id, 10000)), 'in two Discord servers: the one it answers in, picked from the phone', guilds)
    r = await ask('POST', `/bots/${id}/teams`, tm.app)
    ok(okay(r), 'its Teams IDs and client secret, checked and kept', r.json?.error)
    const port = (await botOf(id)).where?.teams?.port
    r = await ask('POST', `/bots/${id}/teams/endpoint`, { publicUrl: `http://127.0.0.1:${port}` })
    const checked = await ask('POST', `/bots/${id}/teams/check`, {})
    ok(okay(r) && okay(checked) && checked.json?.where?.teams?.endpoint?.ok === true, 'its tunnel\'s address saved, and Check reaches it', checked.json?.where?.teams?.endpoint)
    const zip = await phone.request('GET', `/api/bots/${id}/teams/app.zip`)
    ok(zip.status === 200, 'its Teams app, downloaded through the link', zip.status)
    r = await ask('POST', `/bots/${id}/settings`, { owners: { discord: { id: 'discord:2004', name: 'Tester' }, teams: { id: 'teams:aad-tester-0004', name: 'Tester' } } })
    ok(okay(r) && r.json.settings.owners?.discord?.id === 'discord:2004' && r.json.settings.owners?.teams?.id === 'teams:aad-tester-0004', 'You in Discord and You in Teams, from the phone', r.json?.settings?.owners)
    // Try It, its memory.
    r = await ask('POST', `/bots/${id}/try`, { text: 'Is the launch on? [answer Yes, on the 3rd.]' })
    const answered = r.json?.q && await until(async () => { const x = (await ask('GET', `/bots/${id}/try/${encodeURIComponent(r.json.q)}`)).json; return x?.item?.draft && x }, 40000)
    ok(okay(r) && /on the 3rd/.test(answered?.item?.draft || ''), 'Try It, from the phone: answered', answered?.item || r.json)
    r = await ask('POST', `/bots/${id}/memory`, { kind: 'bot', text: 'Prices are in euros' })
    const mid = r.json?.id
    const edited = await ask('PATCH', `/bots/${id}/memory/${mid}`, { text: 'Prices are in dollars' })
    const gone = await ask('DELETE', `/bots/${id}/memory/${mid}`)
    ok(okay(r) && okay(edited) && edited.json?.text === 'Prices are in dollars' && okay(gone), 'its memory: taught, changed and deleted from the phone')
    // Its export, and an import.
    r = await ask('GET', `/bots/${id}/bundle`)
    ok(okay(r) && r.json?.name === 'Atlas Prime' && r.json.settings?.readsFrom?.length === 2 && !leaked(JSON.stringify(r.json)).length, 'its export, through the link: its settings, no token in it', r.json?.name)
    const imp = await ask('POST', '/bots/import', { bundle: r.json })
    ok(okay(imp) && /Atlas Prime/.test(imp.json?.name) && imp.json?.problems?.length > 0, 'imported from the phone, saying what to check', imp.json?.problems)
    ok(events(imp.json?.id).some((e) => e.setting === 'imported' && e.device === 'Pocket'), 'its record: imported on Pocket')
    const act = await ask('GET', `/bots/${id}/activity`)
    ok(okay(act) && act.json.conversations.some((c) => c.place?.kind === 'try') && act.json.changes.some((e) => e.device === 'Pocket'), 'its activity, through the link: Try It\'s conversation, and the changes made on Pocket', act.json?.changes?.slice(0, 3))
    const jsonl = await phone.request('GET', `/api/bots/${id}/export?format=jsonl`)
    ok(jsonl.status === 200, 'its record exported through the link', jsonl.status)
    // Disconnected, deleted, its history deleted.
    r = await ask('DELETE', `/bots/${harbor?.id}/tokens`)
    ok(okay(r) && !(await botOf(harbor?.id)).tokens, 'Disconnect, from the phone: Harbor Desk\'s tokens gone from Desk')
    r = await ask('DELETE', `/bots/${imp.json?.id}`)
    const hist = await ask('DELETE', `/bots/${imp.json?.id}/history`)
    ok(okay(r) && okay(hist) && (await desk.api('/bots')).deleted.find((x) => x.id === imp.json?.id)?.cleared, 'the imported one deleted, then its history', hist.json)
    // The record: each change, by you, on Pocket.
    const changes = events(id).filter((e) => e.type === 'settings.changed' && e.device === 'Pocket').map((e) => e.setting)
    const want = ['created', 'description', 'who', 'readsFrom', 'instructionsFile', 'changes', 'paused', 'name', 'instructions', 'tokens', 'discord', 'discord.server', 'teams', 'teams.endpoint', 'teams.app', 'owner', 'owners', 'askers', 'listen', 'exported']
    ok(want.every((k) => changes.includes(k)) && events(id).filter((e) => e.type === 'settings.changed').every((e) => e.by === 'Tester'), 'its record: each change by Tester, on Pocket', { missing: want.filter((k) => !changes.includes(k)) })
    ok(['memory.kept', 'memory.edited', 'memory.deleted'].every((t) => events(id).some((e) => e.type === t && e.device === 'Pocket')), 'what it remembers, changed on Pocket')
    ok(events(imp.json?.id).some((e) => e.type === 'trace.deleted' && e.all && e.device === 'Pocket'), 'the imported one\'s history deleted on Pocket, which its record keeps')
    ok(events(harbor?.id).some((e) => e.setting === 'tokens' && e.new === null && e.device === 'Pocket'), 'Harbor Desk\'s tokens deleted on Pocket')
    ok(!said.some((x) => leaked(x).length), 'no token came back to the phone in any answer', said.map(leaked).flat())
    phone.close()
  })

  // ---------- Connections, through the phone's link ----------
  // A shared connection made, its tokens pasted, you there and a command for each bot set, and it
  // deleted, all from the phone; no token back, and its record naming the phone.
  await part('connections through the phone\'s link', async () => {
    const phone = await linkAs(rd.url, { code: (await desk.api('/relay/pair', {})).pairing.code, name: 'Pocket 3', about: { name: 'Pocket 3' } })
    const ask = (m, u, body) => phone.request(m, `/api${u}`, body)
    let r = await ask('POST', '/connections', { platform: 'slack', name: 'tester_bot' })
    const c = r.json
    ok(r.status === 200 && c?.shared && c.name === 'tester_bot', 'a shared Slack connection, made from the phone', r.json)
    r = await ask('POST', `/connections/${c?.id}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
    ok(r.status === 200 && !!(await until(async () => (await ask('GET', `/connections/${c.id}`)).json?.state === 'connected', 20000)), 'its tokens pasted on the phone: connected', r.json?.error)
    r = await ask('PATCH', `/connections/${c.id}`, { owner: { id: 'U0OWNER', name: 'Tester' }, perBot: true })
    ok(r.status === 200 && r.json?.owner?.id === 'U0OWNER' && r.json.perBot === true, 'you there, and a command for each bot, from the phone', r.json)
    const seen = JSON.stringify([(await ask('GET', '/connections')).json, (await ask('GET', `/connections/${c.id}`)).json])
    ok(!leaked(seen).length, 'no token comes back to the phone', leaked(seen))
    ok((await ask('GET', `/connections/${c.id}/activity`)).json?.routed?.some((e) => e.what === 'tokens' && e.device === 'Pocket 3'), 'its record says its tokens were set on Pocket 3')
    r = await ask('DELETE', `/connections/${c.id}`)
    ok(r.status === 200 && !(await desk.api('/connections')).connections.some((x) => x.id === c.id), 'and deleted from the phone')
    phone.close()
  })

  // ---------- Through Studio's link ----------
  let ledger = null
  await part('through Studio\'s link', async () => {
    const M = `${studio.url}/m/${deskM.id}/api`
    const ask = async (m, u, body) => { const r = await fetch(`${M}${u}`, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch { /* not JSON */ } return { status: r.status, json, text, type: r.headers.get('content-type') } }
    let r = await ask('POST', '/bots', { name: 'Ledger' })
    ledger = r.json
    ok(r.status === 200 && ledger?.name === 'Ledger', 'a bot made on Studio, for Desk', r.json)
    const id = ledger?.id
    r = await ask('POST', `/bots/${id}/settings`, { who: 'channels', readsFrom: ['~/notes'], limits: { day: 3 } })
    ok(r.status === 200 && r.json.settings.readsFrom[0] === kept('notes') && r.json.settings.limits.day === 3, 'its settings, from Studio', r.json?.settings)
    r = await ask('POST', `/bots/${id}/tokens`, { appToken: 'xapp-test', botToken: 'xoxb-test' })
    ok(r.status === 200 && !!(await until(async () => (await botOf(id)).state === 'connected', 20000)) && !leaked(r.text).length, 'its Slack tokens, from Studio: connected, and none of them sent back', r.json?.error)
    r = await ask('POST', `/bots/${id}/try`, { text: 'Anything due? [answer Nothing due.]' })
    const answered = r.json?.q && await until(async () => { const x = (await ask('GET', `/bots/${id}/try/${encodeURIComponent(r.json.q)}`)).json; return x?.item?.draft && x }, 40000)
    ok(/Nothing due/.test(answered?.item?.draft || ''), 'Try It, from Studio', answered?.item)
    r = await ask('GET', `/bots/${id}/bundle`)
    ok(r.status === 200 && r.json?.name === 'Ledger' && !leaked(r.text).length, 'its export, from Studio', r.status)
    const settings = events(id).filter((e) => e.type === 'settings.changed')
    ok(['created', 'who', 'readsFrom', 'limits', 'tokens', 'exported'].every((k) => settings.some((e) => e.setting === k && e.device === 'Studio' && e.by === 'Tester')), 'its record: each change by Tester, on Studio', settings.map((e) => `${e.setting}:${e.device}`))
    // A window of Studio's showing Desk can't reach Studio's own bots through Desk's port.
    const port = (await studio.api('/machines')).machines.find((x) => x.id === deskM.id)?.port
    if (port) {
      const own = await fetch(`http://127.0.0.1:${port}/api/bots`, { headers: { authorization: `Bearer ${studio.key}` } })
      ok(own.status === 403, 'Desk\'s pages, shown on Studio, can\'t ask Studio\'s own bots', own.status)
    }
  })

  await part('Studio\'s window on Desk', async () => {
    const { ctx, p, errors } = await page(b, `${studio.url}/m/${deskM.id}/`, { mode: 'dark', theme: 'midnight' })
    await openBot(p, { name: 'Ledger' })
    const sec = (k) => p.locator(`.bp .bp-main [data-setting="${k}"]`)
    await sec('slack-identity').waitFor({ timeout: 10000 })
    const about = sec('bot-purpose').locator('input')
    ok(await about.isEnabled(), 'in Studio\'s window on Desk, its settings can be changed')
    await about.fill('The books')
    await about.blur()
    ok(!!(await until(async () => (await botOf(ledger.id)).description === 'The books', 8000)), 'its description, changed in Studio\'s window')
    await sec('slack-folders').locator('button', { hasText: 'Choose…' }).click()
    const list = sec('slack-folders').locator('.sb-browse')
    await list.locator('.sb-browse-list button', { hasText: 'launch' }).click({ timeout: 8000 })
    await list.locator('button', { hasText: 'Read from this folder' }).click()
    ok(!!(await until(async () => (await botOf(ledger.id)).settings.readsFrom.includes(kept('launch')), 8000)), 'a folder picked from Desk\'s own, in Studio\'s window', (await botOf(ledger.id)).settings.readsFrom)
    const got = p.waitForEvent('download', { timeout: 20000 }).catch(() => null)
    await sec('slack-export').locator('a', { hasText: 'Export Ledger' }).click()
    const dl = await got
    ok(dl?.suggestedFilename() === 'Ledger.bridge-bot.json', 'its export, downloaded on Studio', dl?.suggestedFilename())
    await p.locator('.sb-tabs button', { hasText: 'Activity' }).click()
    await sec('slack-activity').locator('.sb-changes summary').click({ timeout: 10000 })
    const lines = await until(async () => { const x = await sec('slack-activity').locator('.sb-changes').innerText(); return /description/.test(x) && x }, 10000)
    ok(/Tester changed description on Studio: — → The books/.test(lines || ''), 'Activity names Studio for what was changed there', lines)
    await shot(p, `${tag}bots-remote-studio-window`)
    ok(errors.length === 0, 'no page errors in Studio\'s window', errors)
    await p.locator('.sb-tabs button', { hasText: 'Settings' }).click()
    await ctx.close()
  })

  // ---------- Dark; the iPhone app; the Android app ----------
  await part('the phone, dark', async () => {
    const { ctx, phone, f, errors } = await phonePage({ mode: 'dark', theme: 'midnight' })
    if (!f) { await ctx.close(); return }
    await openBot(f, { name: 'Harbor Desk' })
    await f.locator('.bp [data-setting="bot-where"]').waitFor({ timeout: 10000 })
    const faults = await allFaults(f)
    ok(!Object.keys(faults).length, 'dark, 390 px: every section and tab, with nothing too small, off the screen or cut short', faults)
    await shot(phone, `${tag}bots-remote-phone-dark`)
    ok(errors.length === 0, 'no page errors, dark', errors)
    await ctx.close()
  })

  await part('the iPhone app', async () => {
    // As meeting-export stands in for it: the app's bridgeNative in Bridge AI's frame, taking a file
    // of Bridge AI's own over the link and saying when it's done.
    const native = (origin) => {
      if (window === window.top || location.origin !== origin || window.bridgeNative) return
      window.__saves = []
      window.bridgeNative = {
        platform: 'ios',
        post: (m) => {
          if (m?.type !== 'save' || !m.id || m.cancel) return
          const x = { url: m.url, name: m.name }
          window.__saves.push(x)
          const tell = (d) => window.dispatchEvent(new CustomEvent('bridge-save', { detail: { id: m.id, ...d } }))
          const u = new URL(m.url)
          if (u.origin !== location.origin || !/^\/(m\/[A-Za-z0-9_-]{1,20}\/)?api\//.test(u.pathname)) { x.refused = true; return }
          fetch(u.pathname + u.search).then(async (r) => { x.status = r.status; x.text = await r.text(); tell({ done: true }) }, (e) => tell({ error: String(e) }))
        },
      }
    }
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
    const ua = `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) BridgeAIApp/${version} Mobile/15E148 Safari/604.1`
    const { ctx, phone, f, errors } = await phonePage({ ua, native })
    if (!f) { await ctx.close(); return }
    const downloads = []
    phone.on('download', (d) => downloads.push(d.suggestedFilename()))
    await openBot(f, { name: 'Harbor Desk' })
    const exp = f.locator('.bp [data-setting="slack-export"]')
    await exp.locator('button', { hasText: 'Export Harbor Desk' }).click({ timeout: 10000 })
    const said = await until(async () => { const x = await exp.innerText(); return /is ready to save or share/.test(x) && x }, 15000)
    const saves = await f.evaluate(() => window.__saves || [])
    ok(saves.length === 1 && new URL(saves[0].url).pathname === `/api/bots/${harbor?.id}/bundle` && saves[0].name === 'Harbor-Desk.bridge-bot.json' && saves[0].status === 200 && !leaked(saves[0].text).length && !downloads.length, 'the iPhone app takes the export to its share sheet, not a download', saves.map(({ text, ...x }) => x))
    ok(/Harbor-Desk\.bridge-bot\.json is ready to save or share\./.test(said || ''), 'and says so', said)
    ok(errors.length === 0, 'no page errors in the iPhone app', errors)
    await ctx.close()
  })

  await part('the Android app', async () => {
    const { ctx, phone, f, errors } = await phonePage({ android: true })
    if (!f) { await ctx.close(); return }
    await openBot(f, { name: 'Harbor Desk' })
    const exp = f.locator('.bp [data-setting="slack-export"]')
    await exp.waitFor({ timeout: 10000 })
    ok(/The Android app can't save files yet\./.test(await exp.innerText()) && !(await exp.locator('button, a').count()), 'the Android app: Export says it can\'t save files there yet, instead of a button that does nothing', await exp.innerText())
    // Its Back goes back in the page (the app's WebView, as phone-apps checks): Bridge AI in the
    // relay's frame keeps each view a step, so More, Bots and a bot come back in turn.
    const shown = (sel) => f.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0), sel)
    await f.locator('.tabbar button', { hasText: 'More' }).click() // (More again: its list)
    await sleep(500)
    await f.locator('.tabbar button', { hasText: 'Agents' }).click()
    await sleep(500)
    await f.locator('.tabbar button', { hasText: 'More' }).click()
    await f.locator('.m-more-row[data-id="bots"]').waitFor({ timeout: 8000 }); await sleep(500)
    await f.locator('.m-more-row[data-id="bots"]').click()
    await f.locator('.bh .bo-card', { hasText: 'Harbor Desk' }).first().waitFor({ timeout: 10000 }); await sleep(500)
    await f.locator('.bh .bo-card', { hasText: 'Harbor Desk' }).first().click()
    await f.locator('.bp').first().waitFor({ timeout: 10000 }); await sleep(500)
    // (The WebView going back through the whole page's history, the relay's frame's steps in it: as
    // the page's own Back is, history.back() at its top.)
    const back = () => phone.evaluate(() => history.back())
    await back()
    ok(!!(await until(async () => (await shown('.bh[data-tab]')) && !(await shown('.bp')), 8000)), 'the Android app\'s Back, through the relay: from a bot back to Bots')
    await back()
    ok(!!(await until(() => shown('.m-more-row'), 8000)), 'and again: More')
    await back()
    ok(!!(await until(async () => /Agents/.test(await f.locator('.tabbar button[aria-current="true"]').innerText().catch(() => '')), 8000)), 'and again: the Agents tab')
    ok(errors.length === 0, 'no page errors in the Android app', errors)
    await ctx.close()
  })

  // ---------- Bots off ----------
  await part('off', async () => {
    await desk.api('/settings', { trials: { 'slack-bot': false } }, 'PATCH')
    const phone = await linkAs(rd.url, { code: (await desk.api('/relay/pair', {})).pairing.code, name: 'Pocket 2', about: { name: 'Pocket 2' } })
    const fromPhone = await phone.request('GET', '/api/bots')
    const fromStudio = await fetch(`${studio.url}/m/${deskM.id}/api/bots`)
    ok(fromPhone.status === 404 && /beta feature/.test(fromPhone.json?.error || '') && fromStudio.status === 404, 'Bots off: not there from the phone, nor from Studio', { phone: fromPhone.status, studio: fromStudio.status })
    phone.close()
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  for (const k of kits) await k.stop()
  for (const r of relays) r.stop()
  slack?.stop(); dc?.stop(); tm?.stop()
}
process.exit(done().fail ? 1 : 0)
