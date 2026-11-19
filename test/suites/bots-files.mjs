// Files a bot makes (server/botfiles.js), with the stand-in Slack, Discord, Teams and Claude Code
// (stand-ins/slack.mjs, discord.mjs, teams.mjs, helper-claude.cjs), in the browser named by BRIDGE_TEST_BROWSER:
//   each run gets an outbox of its own, named in its brief, and its agent may write there and only
//   there (Write, allowed by an Edit rule for that folder alone; its folders still read-only);
//   a file it makes there goes with its answer: Slack's upload API (files.getUploadURLExternal and
//   completeUploadExternal, in the question's thread), Discord's attachments (multipart, after its
//   words), and in Microsoft Teams, which takes none from a bot, the reply says so and who has it;
//   kept beside its record, listed in its Activity;
//   a program or a script (by its name or its first bytes), a link out of the outbox, and anything
//   it writes outside it, refused: not sent, and said in the reply and the record;
//   an upload Slack turns away is said in the thread and in the record, not dropped;
//   for a public channel, an answer with files waits for you even where it may go without asking;
//   its Activity lists the files it made with Open and Send to… (Send to… across two computers is
//   in backup-move).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { checks, until, browser, page, shot, startDiscord, startTeams, IS_WIN, IS_MAC, TEST } from '../lib/harness.mjs'
import { botKit, openSettings, M } from '../lib/bots.mjs'

const { ok, skip, done } = checks('bots-files')
const dc = await startDiscord('bots-files')
await dc.heartbeat({ ms: 800 })
const tm = await startTeams('bots-files')
const T1 = 'dtest.bot-one.0123456789abcdef'
const { slack, kit, draftOf, startOf, briefOf, botOf, connected, events, posted, postedLike } = await botKit('bots-files', {
  folders: ['notes'], env: { BRIDGE_DISCORD_URL: dc.url, BRIDGE_TEAMS_URL: tm.url, BRIDGE_TEAMS_PORT: '0', BRIDGE_BOT_HOLD_MS: '60000' },
})
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const month = () => new Date().toISOString().slice(0, 7)
const send = (d) => kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: true })
const madeOf = (q) => events().find((e) => e.type === 'files.made' && e.q === q) || null
const SECRET = path.join(kit.home, 'notes', 'secret.md')
fs.writeFileSync(SECRET, '# Secret\n\nThe launch is on the ninth.\n')
// Open, in tests: macOS's open and Linux's xdg-open stood in for (opened.log beside them).
kit.program('open', fs.readFileSync(path.join(TEST, 'stand-ins', 'open.cjs'), 'utf8'))
kit.program('xdg-open', fs.readFileSync(path.join(TEST, 'stand-ins', 'open.cjs'), 'utf8'))

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  await kit.api('/bots', { name: 'Reports' })
  await kit.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots/b1/settings', { askers: [{ id: 'U0DANA', name: 'Dana' }, { id: 'discord:2001', name: 'Dana' }], readsFrom: ['~/notes'] })
  ok(!!(await connected()), 'a bot, connected to Slack')

  // ---------- A file it makes, to Slack ----------
  let q1 = null
  await part('to Slack', async () => {
    q1 = await slack.ask({ user: 'U0DANA', text: `${M} Totals by region, as a CSV please [make totals.csv Region,Total] [answer Here are the totals.]` })
    const s = await startOf('Totals by region')
    const brief = briefOf(s)
    const box = /save it in your outbox, (.+?): each file there goes/.exec(brief)?.[1] || ''
    const args = s?.args.join(' ') || ''
    const rule = `Edit(/${path.resolve(box).replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)}/**)`
    ok(!!box && path.resolve(box).startsWith(path.join(kit.data, 'front-desk', 'outbox')) && /none over 25\.0 MB, and never a program or a script/.test(brief), 'its brief names an outbox of its own, and what may go from it', brief.slice(-900))
    ok(args.includes('--tools Read,Grep,Glob,Write ') && s.args.includes(box) && s.args.includes(rule) && args.includes('--permission-mode dontAsk') && !/acceptEdits|bypassPermissions|Edit\(\.\/|Bash/.test(args), 'its agent may write there alone: Write, allowed by an Edit rule for its outbox, and nothing else changed (dontAsk)', s?.args)
    ok(!(brief.match(/You can read th(is folder|ese folders): ([^\n]*)/)?.[2] || '').includes('outbox'), 'and the outbox isn\'t one of the folders it\'s told it reads')
    const d = await draftOf('Totals by region')
    ok(d?.files?.some((f) => f.name === 'totals.csv' && f.size === 13) && /I made totals\.csv\. Here are the totals\./.test(d.draft), 'its draft, with the file it made', d && { draft: d.draft, files: d.files })
    const made = madeOf(d.id)
    const kept = made?.files?.[0]?.kept
    ok(kept === `${month()}/${d.id}-1/totals.csv` && fs.readFileSync(path.join(kit.data, 'bots', 'b1', 'trace', 'files', ...kept.split('/')), 'utf8') === 'Region,Total\n', 'kept beside its record, as it was made', made)
    ok(!fs.existsSync(box), 'its outbox gone once its answer was in')
    await send(d)
    const up = await until(async () => (await slack.state()).files.find((f) => f.name === 'totals.csv'), 15000)
    ok(up?.thread === q1.ts && up.content === 'Region,Total\n' && slack.calls().some((c) => c.method === 'files.getUploadURLExternal') && slack.calls().some((c) => c.method === 'files.completeUploadExternal'), 'sent with the answer, in the question\'s thread, through Slack\'s upload API', up)
    const ev = await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id), 8000)
    ok(ev?.ok === true && ev.name === 'totals.csv' && ev.size === 13, 'and in the record', ev)
    const list = (await kit.api('/bots/b1/files')).files
    ok(list.some((f) => f.name === 'totals.csv' && f.path === kept && f.q === d.id), 'its files, listed for its Activity', list)
  })

  // ---------- Refused: programs, scripts, links out, and writing elsewhere ----------
  await part('refused', async () => {
    const q = await slack.ask({ user: 'U0DANA', text: `${M} The tools please [make-exe setup.exe] [make-script run.sh] [make-script tool.txt] [make-link leak.md ~/notes/secret.md] [make notes.txt Fine.] [edit-outside ~/notes/hack.md nope] [answer Done.]` })
    const d = await draftOf('The tools please')
    const made = madeOf(d.id)
    const why = Object.fromEntries((made?.refused || []).map((r) => [r.name, r.why]))
    ok(d?.files?.map((f) => f.name).join() === 'notes.txt', 'only the plain file goes with it', d?.files)
    ok(/program or a script/.test(why['setup.exe']) && /program or a script/.test(why['run.sh']) && /program or a script/.test(why['tool.txt']), 'a program and a script refused, by its name and by its first bytes (#! in a .txt)', why)
    ok(IS_WIN ? true : /link/.test(why['leak.md'] || ''), 'a link out of the outbox refused', why)
    ok(!fs.existsSync(path.join(kit.home, 'notes', 'hack.md')), 'and nothing written outside its outbox')
    ok(/Not sent: .*setup\.exe \(it's a program or a script, which a bot doesn't send\)/.test(d.draft) && /run\.sh/.test(d.draft), 'the reply says what wasn\'t sent, and why', d.draft)
    await send(d)
    await until(async () => (await slack.state()).files.some((f) => f.name === 'notes.txt'), 15000)
    const names = (await slack.state()).files.map((f) => f.name)
    ok(names.includes('notes.txt') && !names.some((n) => /setup\.exe|run\.sh|tool\.txt|leak\.md/.test(n)) && !(await slack.state()).files.some((f) => /launch is on the ninth/.test(f.content || '')), 'Slack got the plain file and nothing else', names)
    ok(!JSON.stringify(events()).includes('The launch is on the ninth'), 'what the link pointed to is nowhere in the record')
  })

  // ---------- An upload Slack turns away ----------
  await part('an upload that fails', async () => {
    await slack.fail({ method: 'files.completeUploadExternal', error: 'file_upload_failed', n: 1 })
    const q = await slack.ask({ user: 'U0DANA', text: `${M} The chart please [make chart.svg <svg/>] [answer Here it is.]` })
    const d = await draftOf('The chart please')
    await send(d)
    const said = await postedLike(/I couldn't attach chart\.svg/, 15000)
    ok(said?.thread_ts === q.ts && /Tester has it in Bridge AI on/.test(said.text), 'said in the thread, with who has it and where', said)
    const ev = await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id && e.ok === false), 8000)
    ok(/file_upload_failed/.test(ev?.error || ''), 'and in the record', ev)
  })

  // ---------- A public channel ----------
  await part('a public channel waits', async () => {
    await kit.api('/bots/b1/settings', { auto: true })
    await slack.ask({ user: 'U0DANA', text: `${M} Public totals [make public.csv a,b] [answer Totals attached.]` })
    const d = await draftOf('Public totals')
    ok(d?.state === 'draft' && /public channel, so it waits for you/.test(d.warn || ''), 'its answer with a file it made waits for you in a public channel, even where it may go without asking', d && { state: d.state, warn: d.warn })
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
    await kit.api('/bots/b1/settings', { auto: false })
  })

  // ---------- Discord ----------
  await part('to Discord', async () => {
    await kit.api('/bots/b1/discord', { token: T1, guild: '3001' })
    ok(!!(await until(async () => (await botOf()).where?.discord?.state === 'connected', 20000)), 'connected to Discord too')
    const q = await dc.say({ user: '2001', text: '<@1001> A picture please [make plan.svg <svg xmlns="http://www.w3.org/2000/svg"/>] [answer Here is the plan.]' })
    const d = await draftOf('A picture please')
    ok(d?.files?.some((f) => f.name === 'plan.svg'), 'its draft, with the file', d?.files)
    await send(d)
    const p = await until(async () => (await dc.state()).posted.find((x) => x.files?.some((f) => f.name === 'plan.svg')), 15000)
    const words = (await dc.state()).posted.find((x) => /Here is the plan/.test(x.content || ''))
    ok(!!p && p.channel === words?.channel && p.channel === q.id && p.files[0].sha256 === sha(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n')), 'attached in Discord after its words, in the question\'s thread, the same bytes', { p, words })
    ok(!!(await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id && e.ok), 8000)), 'and in the record')
  })

  // ---------- Microsoft Teams: none attached, said ----------
  await part('in Teams', async () => {
    const { appId, password, tenantId } = tm.app
    await kit.api('/bots/b1/teams', { appId, password, tenantId })
    const port = await until(async () => (await botOf()).where?.teams?.port, 15000)
    await kit.api('/bots/b1/teams/endpoint', { publicUrl: `http://127.0.0.1:${port}/api/messages` })
    await tm.endpoint(`http://127.0.0.1:${port}/api/messages`)
    await tm.install()
    await kit.api('/bots/b1/settings', { askers: [{ id: 'U0DANA', name: 'Dana' }, { id: 'discord:2001', name: 'Dana' }, { id: 'teams:aad-dana-0001', name: 'Dana Reyes' }] })
    await tm.say({ user: 'dana', text: 'The summary please [make summary.md All well.] [answer Here it is.]' })
    const d = await draftOf('The summary please')
    ok(d?.files?.some((f) => f.name === 'summary.md'), 'its draft, with the file', d?.files)
    await send(d)
    const p = await until(async () => (await tm.state()).posted.find((x) => /Here it is/.test(x.text || '')), 15000)
    ok(/I couldn't attach summary\.md \(\d+ bytes\) \(Microsoft Teams doesn't let a bot attach a file to a reply\)\. Tester has it in Bridge AI on /.test(p?.text || ''), 'the reply says Teams took no file, and who has it, where', p?.text)
    const ev = await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id), 8000)
    ok(ev?.ok === false && /Microsoft Teams/.test(ev.error || ''), 'and the record says so', ev)
  })

  // ---------- Its Activity ----------
  await part('Activity', async () => {
    const { ctx, p, errors } = await page(b, kit.url)
    await openSettings(p)
    await p.locator('.sb-tabs [role="tab"]', { hasText: 'Activity' }).click()
    const files = p.locator('[data-setting="bots-files"]')
    await files.waitFor({ timeout: 15000 })
    ok(/Files It Made/.test(await files.innerText()) && await files.locator('[data-file="totals.csv"]').count() === 1, 'its Activity lists the files it made', await files.innerText())
    const row = files.locator('[data-file="totals.csv"]')
    ok(await row.locator('button', { hasText: 'Open' }).count() === 1 && await row.locator('button', { hasText: 'Send to…' }).count() === 1, 'each with Open and Send to…')
    if (IS_WIN) skip('Open in its app', 'nothing stands in for Windows\' Explorer')
    else {
      await row.locator('button', { hasText: 'Open' }).click()
      const opened = await until(() => { try { return fs.readFileSync(path.join(kit.bin, 'opened.log'), 'utf8').includes('totals.csv') } catch { return false } }, 8000)
      ok(!!opened, `Open: in its app on this computer (${IS_MAC ? 'open' : 'xdg-open'})`)
    }
    await row.locator('button', { hasText: 'Send to…' }).click()
    ok(!!(await until(async () => /None of your other devices is linked/.test(await p.locator('.xfer-dialog').innerText().catch(() => '')), 8000)), 'Send to… opens the dialog Files has (no other computer linked here)')
    await p.locator('.xfer-dialog button', { hasText: 'Cancel' }).click()
    // In its timeline, too.
    await p.locator('.sb-conv', { hasText: 'Totals by region' }).click()
    await p.locator('.sb-timeline .bf-made').first().waitFor({ timeout: 10000 })
    ok(await p.locator('.sb-timeline .bf-made [data-file="totals.csv"]').count() === 1 && /Made totals\.csv/.test(await p.locator('.sb-timeline').innerText()), 'and in the conversation\'s timeline, where it was made')
    const r = await fetch(`${kit.url}/api/agents/${encodeURIComponent('botfiles:b1')}/fileop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'trash', path: (await kit.api('/bots/b1/files')).files[0].path }) })
    ok(r.status === 403, 'a bot\'s files are only to open and send on: nothing changed through them', r.status)
    await shot(p, `${tag}bots-files-activity`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  await b.close()
  kit.stop()
  slack.stop()
  dc.stop()
  tm.stop()
}
process.exit(done().fail ? 1 : 0)
