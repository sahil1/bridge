// Bots, Phase 4 (bots-spec §5.1, §5.9, §9 Phase 4): always on, with the stand-in Slack and Claude
// Code (stand-ins/slack.mjs, helper-claude.cjs) and two servers: one as on your computer, one as the
// Docker image runs it (BRIDGE_DOCKER, no window: everything through `bridge-ai`), in the browser
// named by BRIDGE_TEST_BROWSER.
//   A bot exported from your computer (its instructions, memory and settings; never its tokens) is
//   brought into the Docker server with `bridge-ai bots import`, its Slack app connected with
//   `bridge-ai bots connect` (the tokens piped in), and answers the same question the same way.
//   The health check (scripts/health.js, the image's HEALTHCHECK) says each bot's connection, and
//   is unhealthy while one can't connect until something's fixed; `bridge-ai status` lists them.
//   Scheduled posts through Routines: run by hand and at their time, posted at the top of the
//   channel, waiting for you first unless it may go without asking. Answering without a mention in
//   a channel you pick: people who may ask are answered, anyone else and what isn't for it left
//   alone. Back after being away: what was missed (a DM, a mention, a reply in its thread) answered
//   oldest first. Settings › Bots, Channels and Scheduled Posts, in light and dark.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { checks, until, sleep, browser, page, shot, phoneFaults, ROOT } from '../lib/harness.mjs'
import { botKit, lookers, openSettings, M, M2, OWNER } from '../lib/bots.mjs'

const { ok, done } = checks('bots-always-on')
const HANDBOOK = '# Handbook\n\nEveryone gets ten days of leave a year.\n'
const mac = await botKit('bots-always-on', { folders: ['docs'], config: { trials: { routines: true } }, env: { BRIDGE_ROUTINE_TICK_MS: '2000', BRIDGE_BOT_HOLD_MS: '600000' } })
const { slack, kit } = mac
const docker = await botKit('bots-always-on-docker', { slack, folders: ['docs'], env: { BRIDGE_DOCKER: '1', BRIDGE_BOT_HOLD_MS: '600000' } })
for (const k of [kit, docker.kit]) fs.writeFileSync(path.join(k.home, 'docs', 'handbook.md'), HANDBOOK)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
// A folder as kept, with / between its parts (Windows keeps ~\docs).
const slashed = (p) => String(p || '').replace(/\\/g, '/')
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const inThread = async (ts) => (await slack.state()).posted.filter((x) => x.thread_ts === ts)
// `bridge-ai` against a server, as on the machine it runs on (its key from its data folder).
const cli = (k, args, input = null) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.js'), ...args], { env: { ...process.env, BRIDGE_URL: k.url, BRIDGE_HOME: k.data }, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { out += d })
  p.on('close', (code) => resolve({ code, out }))
  p.stdin.end(input || '')
})
const health = (k) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'health.js')], { env: { ...process.env, BRIDGE_PORT: String(k.port) }, encoding: 'utf8' })

try {
  for (const k of [kit, docker.kit]) { await k.api('/setup', { name: 'Tester' }); await k.api('/agents/catalog') }
  await kit.api('/bots', { name: 'Atlas' })
  await kit.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots/b1/settings', { answerIn: 'thread', askers: [{ id: 'U0DANA', name: 'Dana' }], readsFrom: ['~/docs'], owner: OWNER, instructions: '# Atlas\n\nAnswer from the handbook. [sign — Atlas]\n', limits: { day: 50, atOnce: 2, minutes: 10 } })
  await kit.api('/bots/b1/memory', { kind: 'bot', text: 'Atlas speaks for the people team.' })
  ok(!!(await mac.connected()), 'a bot on your computer, connected')

  // ---------- Exported here, imported into the Docker server ----------
  let fileOut = null
  await part('export and import', async () => {
    const r = await fetch(`${kit.url}/api/bots/b1/bundle`)
    const text = await r.text()
    const j = JSON.parse(text)
    ok(/attachment; filename="Atlas\.bridge-bot\.json"/.test(r.headers.get('content-disposition') || '') && j.kind === 'bridge-ai-bot' && /\[sign — Atlas\]/.test(j.instructions) && j.memory.some((x) => /people team/.test(x.text)) && j.settings.readsFrom.map(slashed).join() === '~/docs' && j.settings.owner?.id === OWNER.id, 'exported: its instructions, memory and settings', { settings: Object.keys(j.settings), memory: j.memory.length })
    ok(!/xoxb-|xapp-|botToken|appToken/.test(text), 'never its tokens', text.match(/xox\w-|xapp-/g))
    fileOut = path.join(docker.kit.home, 'atlas.bridge-bot.json')
    fs.writeFileSync(fileOut, text)
    const imp = await cli(docker.kit, ['bots', 'import', fileOut])
    ok(imp.code === 0 && /Brought in Atlas\./.test(imp.out) && /Connect its Slack app here/.test(imp.out) && /bridge-ai bots connect "Atlas"/.test(imp.out), 'brought into the Docker server with bridge-ai bots import, which says to connect its Slack app there', imp.out)
    const listed = await cli(docker.kit, ['bots'])
    ok(/Atlas\s+not connected yet/.test(listed.out), 'bridge-ai bots: it\'s there, not connected yet', listed.out)
    const con = await cli(docker.kit, ['bots', 'connect', 'Atlas'], 'xapp-two\nxoxb-two\n')
    ok(con.code === 0 && /Atlas: connected to Acme Test as @atlas/.test(con.out), 'bridge-ai bots connect, the tokens piped in: connected as its own app there', con.out)
    const v = await docker.botOf('b1')
    ok(v.settings.readsFrom.map(slashed).join() === '~/docs' && v.settings.askers.map((x) => x.id).join() === 'U0DANA' && /\[sign — Atlas\]/.test(v.instructions.text) && (await docker.kit.api('/bots/b1/memory')).items.some((x) => /people team/.test(x.text) && x.state === 'kept'), 'with its settings, instructions and memory as they were')
    ok(docker.events('b1').some((e) => e.type === 'settings.changed' && e.setting === 'imported'), 'the import is in its record there')
  })
  await part('the same question, the same way', async () => {
    const Q = 'What does the handbook say about leave? [recall] [answer Ten days a year.]'
    await slack.ask({ user: 'U0DANA', text: `${M} ${Q}` })
    await slack.ask({ user: 'U0DANA', text: `${M2} ${Q}` })
    const here = await mac.draftOf('handbook say about leave')
    const there = await docker.draftOf('handbook say about leave')
    ok(!!here && here.draft === there?.draft && /people team/.test(here.draft) && /— Atlas$/.test(here.draft), 'the bot on your computer and the one imported into Docker answer the same question the same way', { here: here?.draft, there: there?.draft })
    await kit.api(`/bots/questions/${here.id}`, { send: false })
    await docker.kit.api(`/bots/questions/${there.id}`, { send: false })
  })

  // ---------- The health check ----------
  await part('health', async () => {
    const h = await (await fetch(`${docker.kit.url}/api/health`)).json()
    ok(h.ok && h.bots?.length === 1 && h.bots[0].name === 'Atlas' && h.bots[0].state === 'connected', 'the health check, asked on that machine, says each bot\'s connection', h)
    const relayed = await (await fetch(`${docker.kit.url}/api/health`, { headers: { 'x-bridge-relay': 'd1' } })).json()
    ok(relayed.ok && !relayed.bots, '(not through the relay)', relayed)
    const good = health(docker.kit)
    ok(good.status === 0 && /Bot Atlas: connected to Slack/.test(good.stdout), 'the image\'s HEALTHCHECK: healthy, and says each bot', good.stdout)
    await slack.fail({ method: 'auth.test', error: 'token_revoked', n: 1 })
    await docker.kit.api('/bots/b1/connect', {})
    await until(async () => (await docker.botOf('b1')).state === 'error', 15000)
    const bad = health(docker.kit)
    ok(bad.status === 1 && /Bot Atlas: error: The bot token: The token was revoked/.test(bad.stdout), 'a bot Slack turned down: unhealthy, saying why', bad.stdout)
    const st = await cli(docker.kit, ['status'])
    ok(/Bots\s+Atlas\s+error: The bot token/.test(st.out), 'bridge-ai status lists its bots too', st.out)
    await docker.kit.api('/bots/b1/connect', {})
    await until(async () => (await docker.botOf('b1')).state === 'connected', 15000)
    ok(health(docker.kit).status === 0, 'connected again: healthy')
    ok(health({ port: 9 }).status === 1, 'no server answering: unhealthy')
  })
  docker.kit.stop()

  // ---------- Scheduled posts, through Routines ----------
  let timed = null
  await part('scheduled posts', async () => {
    const made = await kit.api('/routines', { name: 'Morning post', command: 'Write the morning post [answer Good morning, team.]', to: 'bot', bot: 'b1', channel: { id: 'C0LAUNCH', name: 'launch' } })
    ok(made.to === 'bot' && made.bot === 'b1' && made.channel?.id === 'C0LAUNCH' && !made.cwd, 'a scheduled post is a routine: its bot and channel', made)
    await kit.api(`/routines/${made.id}/run`, {})
    const d = await mac.draftOf('Write the morning post')
    ok(d?.how === 'scheduled' && d.draft === 'Good morning, team. — Atlas' && d.place?.id === 'C0LAUNCH' && d.from?.id === OWNER.id, 'run: its bot writes the post, as from you, waiting for you first', d && { how: d.how, draft: d.draft })
    await kit.api(`/bots/questions/${d.id}`, { send: true, text: d.draft })
    const top = await until(async () => (await slack.state()).posted.find((x) => x.text === 'Good morning, team. — Atlas'), 15000)
    ok(top && !top.thread_ts && top.channel === 'C0LAUNCH', 'sent: posted at the top of the channel, not in a thread', top)
    ok(mac.events().some((e) => e.type === 'received' && e.how === 'scheduled' && e.routine?.id === made.id), 'its record says which routine it was')
    const list = (await kit.api('/routines')).routines.find((r) => r.id === made.id)
    ok(list?.to === 'bot', 'and it\'s in Routines with the rest')
  })

  // ---------- Answering without a mention, in a channel you pick ----------
  let listened = null
  await part('without a mention', async () => {
    await kit.api('/bots/b1/settings', { auto: false, listen: [{ id: 'C0LAUNCH', name: 'launch' }] })
    listened = await slack.ask({ user: 'U0DANA', text: 'What is our leave policy? [answer Ten days.]' })
    const d = await mac.draftOf('our leave policy')
    ok(d?.how === 'listen' && d.draft === 'Ten days. — Atlas', 'in a channel you picked, someone who may ask is answered without a mention', d && { how: d.how, draft: d.draft })
    ok(/without mentioning you: if it isn't a question for you/.test(mac.briefOf(await mac.startOf('our leave policy'))), 'its agent is told to stay quiet when it isn\'t for it')
    await kit.api(`/bots/questions/${d.id}`, { send: true, text: d.draft })
    await until(async () => (await inThread(listened.ts)).some((x) => x.text === 'Ten days. — Atlas'), 15000)
    await slack.ask({ user: 'U0EVE', text: 'Does anyone know the leave policy? [answer Twenty days.]' })
    await slack.ask({ user: 'U0DANA', text: 'Lunch anyone? [notforme]' })
    await until(async () => (await mac.convs('b1', 'Lunch anyone'))[0]?.outcome === 'skipped', 20000)
    ok(!(await mac.convs('b1', 'anyone know the leave')).length && !mac.logOf('helpers-started.log').some((x) => /----- question from Eve -----/.test(mac.briefOf(x))), 'someone who may not ask: left alone, nothing kept')
    ok((await mac.convs('b1', 'Lunch anyone'))[0]?.outcome === 'skipped' && !(await mac.needs()).some((x) => /Lunch anyone/.test(x.text)), 'and a message that isn\'t for it: nothing said, nothing waiting')
    await kit.api('/bots/b1/settings', { listen: [] })
    await slack.ask({ user: 'U0DANA', text: 'And sick days? [answer Five.]' })
    await sleep(2500)
    ok(!(await mac.convs('b1', 'And sick days')).length, 'off again: a message without a mention isn\'t for it')
  })

  // ---------- Back after being away: oldest first ----------
  await part('catching up', async () => {
    await slack.away()
    await until(async () => (await mac.botOf()).state !== 'connected', 15000)
    await slack.ask({ user: 'U0DANA', dm: true, text: 'First, in a DM [answer One.]' })
    await sleep(30)
    await slack.ask({ user: 'U0DANA', text: `${M} Second, a mention [answer Two.]` })
    await sleep(30)
    await slack.ask({ user: 'U0DANA', thread: listened.ts, text: 'Third, in its thread [answer Three.]' })
    await slack.back()
    for (const w of ['First, in a DM', 'Second, a mention', 'Third, in its thread']) await mac.draftOf(w, 60000)
    const got = mac.events().filter((e) => e.type === 'received' && /^(First, in a DM|Second, a mention|Third, in its thread)/.test(e.text || ''))
    ok(got.map((e) => e.text.split(',')[0]).join() === 'First,Second,Third' && got.every((e) => e.late) && got.map((e) => e.how).join() === 'dm,mention,follow-up', 'back after being away: a DM, a mention and a reply in its thread, each answered, oldest first', got.map((e) => [e.text.slice(0, 20), e.how, e.late]))
  })

  // ---------- A post with a time of its own ----------
  // Set once the bot is back (its time can't come while it's away from Slack), for the first whole
  // minute at least 15 s off: a schedule counts from when it's saved, so a time already gone by then
  // isn't run until tomorrow.
  await part('a post at its time, set', async () => {
    const slot = new Date(Math.ceil((Date.now() + 15000) / 60000) * 60000)
    const hhmm = `${String(slot.getHours()).padStart(2, '0')}:${String(slot.getMinutes()).padStart(2, '0')}`
    timed = await kit.api('/routines', { name: 'Noon post', command: 'Write the noon post [answer Lunch is at noon.]', to: 'bot', bot: 'b1', channel: { id: 'C0LAUNCH', name: 'launch' }, schedule: `every day at ${hhmm}` })
    ok(timed.auto && timed.at === hhmm && Date.parse(timed.since) < slot, 'one with a time of its own, still to come today', { at: timed.at, auto: timed.auto, since: timed.since, slot: slot.toISOString() })
  })

  // ---------- Settings ----------
  for (const [mode, theme, phone] of [['light', 'sky', false], ['dark', 'midnight', false], ['dark', 'midnight', true]]) {
    await part(`Settings, ${mode}${phone ? ', on a phone' : ''}`, async () => {
      const { ctx, p, errors } = await page(b, kit.url, { mode, theme, phone })
      await openSettings(p)
      await p.locator('.sb-tabs [role="tab"]', { hasText: 'Set Up' }).click()
      const sched = p.locator('[data-setting="slack-scheduled"]')
      await sched.waitFor({ timeout: 10000 })
      await sched.scrollIntoViewIfNeeded()
      const words = await sched.innerText()
      ok(/Write the morning post/.test(words) && /Write the noon post/.test(words) && /#launch/.test(words) && /Every day at/.test(words), 'Scheduled Posts: each, and where it posts', words.slice(0, 400))
      const chans = p.locator('[data-setting="slack-channels"]')
      ok(/without a mention/i.test(await chans.innerText()), 'Channels: where it answers without a mention')
      ok(/Instructions, memory and settings; never its tokens/.test(await p.locator('[data-setting="slack-export"]').innerText().catch(() => '')) || /never its tokens/.test(await p.locator('[data-setting="slack-identity"]').innerText()), 'its export, said to leave its tokens out')
      if (phone) { const faults = await phoneFaults(p, '.modal.settings .sb'); ok(!Object.keys(faults).length, 'on a phone: nothing too small to tap, off the screen or cut short', faults) }
      await shot(p, `${tag}bots-always-on-scheduled-${mode}${phone ? '-phone' : ''}`)
      if (mode === 'light') {
        // A bot imported from the page: Import a bot… in New Bot.
        await p.locator('.sb-chip.add').click()
        await p.locator('[data-setting="slack-import"] input[type="file"]').setInputFiles(fileOut)
        const made = await until(async () => (await kit.api('/bots')).bots.find((x) => x.name === 'Atlas (2)'), 10000)
        ok(!!made, 'Import a bot… in Settings: brought in, named so it doesn\'t clash', (await kit.api('/bots')).bots.map((x) => x.name))
        await until(async () => /Connect its Slack app here/.test(await p.locator('.sb').innerText()), 8000)
        ok(/Connect its Slack app here/.test(await p.locator('.sb').innerText()), 'and it says what\'s left to do')
        await shot(p, `${tag}bots-always-on-imported`)
      }
      ok(errors.length === 0, 'no page errors', errors)
      await ctx.close()
    })
  }

  // ---------- The post at its time ----------
  await part('at its time', async () => {
    const d = await mac.draftOf('Write the noon post', 130000)
    ok(d?.how === 'scheduled' && d.draft === 'Lunch is at noon. — Atlas', 'at its time, by itself: its bot writes the post, and it waits for you', d && { how: d.how, draft: d.draft })
    if (d) await kit.api(`/bots/questions/${d.id}`, { send: true, text: d.draft })
    const noon = await until(async () => (await slack.state()).posted.find((x) => x.text === 'Lunch is at noon. — Atlas'), 15000)
    ok(noon && !noon.thread_ts && noon.channel === 'C0LAUNCH', 'sent: at the top of the channel', noon)
    const run = (await kit.api('/routines')).routines.find((r) => r.id === timed?.id)?.runs?.[0]
    ok(run && !run.error && run.how !== 'late', 'Routines says it ran', run)
  })
  ok((await kit.api('/bots/b1/activity')).integrity?.ok, 'its record whole at the end')
  void lookers
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  await b.close()
  kit.stop()
  docker.kit.stop()
  slack.stop()
}
process.exit(done().fail ? 1 : 0)
