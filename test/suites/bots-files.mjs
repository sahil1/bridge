// Files a bot makes (server/botfiles.js), with the stand-in Slack, Discord, Teams and Claude Code
// (stand-ins/slack.mjs, discord.mjs, teams.mjs, helper-claude.cjs), in the browser named by BRIDGE_TEST_BROWSER:
//   each run gets an outbox of its own, and its agent a save_file tool that writes only there (an MCP
//   server of Bridge AI's own, outboxmcp.js, which the stand-in starts and calls as Claude Code
//   would); it's given no tool that writes files, so its folders stay read-only;
//   a file it makes there goes with its answer: Slack's upload API (files.getUploadURLExternal and
//   completeUploadExternal, in the question's thread), Discord's attachments (multipart, after its
//   words), and in Microsoft Teams, which takes none from a bot, the reply says so and who has it;
//   kept beside its record, listed in its Activity;
//   only pictures, PDFs, tables, text and documents go: a program, a script, a Terminal file, a disk
//   image (by its kind, or a script's first bytes in a .txt), refused, not sent, and said in the reply
//   and the record; a name with characters that hide what it is (a right-to-left mark) has them taken
//   out; kept files are marked as from elsewhere on a Mac (com.apple.quarantine);
//   an upload Slack turns away is said in the thread and in the record, not dropped;
//   save_file takes five files a run at most, and says so for one more;
//   for a public channel, an answer with files waits for you even where it may go without asking,
//   whichever way it made them (its outbox, or a FILE: block); a page, a drawing or XML anywhere;
//   its Activity lists the files it made with Open and Send to… (Send to… across two computers is
//   in backup-move); one that could run something as it opens (a drawing, a page) is shown in
//   Finder instead; nothing writes through a bot's files (Studio's routes, a copy into them).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
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
    const args = s?.args.join(' ') || ''
    const cfg = s?.args[s.args.indexOf('--mcp-config') + 1]
    let server = null
    try { server = JSON.parse(fs.readFileSync(cfg, 'utf8')).mcpServers?.bridge_outbox } catch { /* gone already */ }
    const box = server?.args?.[1] || ''
    ok(/save it with your save_file tool: each file you save goes with your answer, 5 at most and none over 25\.0 MB, and only pictures, PDFs, tables, text and documents/.test(brief) && !brief.includes(path.join('front-desk', 'outbox')), 'its brief offers save_file, and says what may go', brief.slice(-900))
    ok(args.includes('--tools Read,Grep,Glob ') && s.args.includes('--strict-mcp-config') && s.args.includes('mcp__bridge_outbox__save_file') && args.includes('--permission-mode dontAsk') && !/Write|Edit|Bash|acceptEdits|bypassPermissions/.test(args), 'its agent gets save_file and no tool that writes files: Read, Grep and Glob, its outbox\'s MCP server, dontAsk', s?.args)
    ok(!!server && /outboxmcp\.js$/.test(server.args?.[0] || '') && path.resolve(box).startsWith(path.join(kit.data, 'front-desk', 'outbox')) && !s.args.includes(box), 'its outbox\'s server: Bridge AI\'s own, on that run\'s outbox alone (not a folder it may read)', server)
    const d = await draftOf('Totals by region')
    ok(d?.files?.some((f) => f.name === 'totals.csv' && f.size === 13) && /I made totals\.csv\. Here are the totals\./.test(d.draft), 'its draft, with the file it made', d && { draft: d.draft, files: d.files })
    const made = madeOf(d.id)
    const kept = made?.files?.[0]?.kept
    const keptAt = kept ? path.join(kit.data, 'bots', 'b1', 'trace', 'files', ...kept.split('/')) : ''
    ok(kept === `${month()}/${d.id}-1/totals.csv` && fs.readFileSync(keptAt, 'utf8') === 'Region,Total\n', 'kept beside its record, as it was made', made)
    if (IS_MAC) ok(/Bridge AI/.test(spawnSync('xattr', ['-p', 'com.apple.quarantine', keptAt], { encoding: 'utf8' }).stdout || ''), 'marked as from elsewhere, as a download is (com.apple.quarantine)')
    ok(!box || !fs.existsSync(box), 'its outbox gone once its answer was in')
    await send(d)
    const up = await until(async () => (await slack.state()).files.find((f) => f.name === 'totals.csv'), 15000)
    ok(up?.thread === q1.ts && up.content === 'Region,Total\n' && slack.calls().some((c) => c.method === 'files.getUploadURLExternal') && slack.calls().some((c) => c.method === 'files.completeUploadExternal'), 'sent with the answer, in the question\'s thread, through Slack\'s upload API', up)
    const ev = await until(() => events().find((e) => e.type === 'file.uploaded' && e.q === d.id), 8000)
    ok(ev?.ok === true && ev.name === 'totals.csv' && ev.size === 13, 'and in the record', ev)
    const list = (await kit.api('/bots/b1/files')).files
    ok(list.some((f) => f.name === 'totals.csv' && f.path === kept && f.q === d.id), 'its files, listed for its Activity', list)
  })

  // ---------- Refused: what isn't a picture, a PDF, a table, text or a document ----------
  await part('refused', async () => {
    const RLO = '\u202e'
    // (Five a question, the most a run saves.)
    await slack.ask({ user: 'U0DANA', text: `${M} The tools please [make-exe setup.exe] [make-script run.sh] [make-script tool.txt] [make setup.terminal <plist/>] [make notes.txt Fine.] [try-write hack.md] [answer Done.]` })
    await slack.ask({ user: 'U0DANA', text: `${M} More tools please [make tool.py import os] [make game.iso data] [make inv${RLO}dm.txt Fine.] [answer Done.]` })
    const d = await draftOf('The tools please')
    const d2 = await draftOf('More tools please')
    const why = Object.fromEntries([...(madeOf(d.id)?.refused || []), ...(madeOf(d2.id)?.refused || [])].map((r) => [r.name, r.why]))
    ok(d?.files?.map((f) => f.name).join() === 'notes.txt' && d2?.files?.map((f) => f.name).join() === 'invdm.txt', 'only text goes with them, a name\'s right-to-left mark taken out', { one: d?.files, two: d2?.files })
    ok(['setup.exe', 'run.sh', 'setup.terminal', 'tool.py', 'game.iso'].every((n) => /isn't one a bot sends/.test(why[n] || '')) && /program or a script/.test(why['tool.txt'] || ''), 'refused: a program, a script, a Terminal file, Python and a disk image by their kind, and a script\'s first bytes in a .txt', why)
    ok(!fs.existsSync(path.join(kit.home, 'notes', 'hack.md')), 'and nothing written in its folders')
    ok(/Not sent: .*setup\.exe \(a \.exe file isn't one a bot sends/.test(d.draft) && /setup\.terminal/.test(d.draft), 'the reply says what wasn\'t sent, and why', d.draft)
    ok(!JSON.stringify(events().filter((e) => ['files.made', 'file.uploaded'].includes(e.type))).includes(RLO) && !(await kit.api('/bots/b1/files')).files.some((f) => f.name.includes(RLO)), 'no right-to-left mark in a file\'s name, kept or sent')
    await send(d)
    await until(async () => (await slack.state()).files.some((f) => f.name === 'notes.txt'), 15000)
    await kit.api(`/bots/questions/${encodeURIComponent(d2.id)}`, { send: false })
    const names = (await slack.state()).files.map((f) => f.name)
    ok(names.includes('notes.txt') && !names.some((n) => /setup\.exe|run\.sh|tool\.txt|terminal|tool\.py|game\.iso/.test(n)), 'Slack got the text file and nothing else', names)
  })

  // ---------- As many as a run sends back ----------
  await part('five at most', async () => {
    await slack.ask({ user: 'U0DANA', text: `${M} Six notes please ${[1, 2, 3, 4, 5, 6].map((n) => `[make n${n}.txt Note ${n}.]`).join(' ')} [answer Done.]` })
    const d = await draftOf('Six notes please')
    ok(d?.files?.length === 5 && !d.files.some((f) => f.name === 'n6.txt') && /I couldn't save n6\.txt: You've saved 5 files already, the most that go with an answer/.test(d.draft), 'save_file takes five files a run, and says so for the sixth', d && { files: d.files.map((f) => f.name), draft: d.draft })
    await kit.api(`/bots/questions/${encodeURIComponent(d.id)}`, { send: false })
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
    await slack.ask({ user: 'U0DANA', text: `${M} Public chart [chart]`, files: [{ name: 'sales.csv', type: 'text/csv', content: 'month,sales\nJan,10\nFeb,30\n' }] })
    const c = await draftOf('Public chart')
    ok(c?.state === 'draft' && c.files?.some((f) => f.name === 'chart.svg') && /public channel, so it waits for you/.test(c.warn || ''), 'and so does one with a file in a FILE: block', c && { state: c.state, files: c.files, warn: c.warn })
    await kit.api(`/bots/questions/${encodeURIComponent(c.id)}`, { send: false })
    // A page, anywhere (a direct message here): it can run a script where it's opened, so it waits too.
    await slack.ask({ user: 'U0DANA', dm: true, text: 'A page please [make page.html <p>Hello</p>] [answer Here.]' })
    const pg = await draftOf('A page please')
    ok(pg?.state === 'draft' && pg.place?.kind === 'dm' && /page\.html, which can run a script where it's opened, so it waits for you/.test(pg.warn || ''), 'a page, a drawing or XML waits for you even in a direct message', pg && { state: pg.state, place: pg.place?.kind, warn: pg.warn })
    await kit.api(`/bots/questions/${encodeURIComponent(pg.id)}`, { send: false })
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
    // A drawing could run a script where it opens (a browser): shown in Finder instead, whatever's asked.
    const svg = (await kit.api('/bots/b1/files')).files.find((f) => f.name === 'chart.svg')
    if (IS_MAC) {
      const srow = files.locator('[data-file="chart.svg"]')
      ok(await srow.locator('button', { hasText: 'Show in Finder' }).count() === 1, 'a drawing: Show in Finder, not Open')
    }
    if (!IS_WIN && svg) {
      await fetch(`${kit.url}/api/agents/${encodeURIComponent('botfiles:b1')}/fileop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'open', path: svg.path }) })
      const last = await until(() => { try { const l = fs.readFileSync(path.join(kit.bin, 'opened.log'), 'utf8').trim().split('\n').at(-1); return /chart\.svg|\d{4}-\d{2}[\\/]/.test(l) ? l : null } catch { return null } }, 8000)
      ok(!!last && (IS_MAC ? /^-R .*chart\.svg$/.test(last) : !/chart\.svg$/.test(last)), 'and asked to open one, the server shows it in its folder instead', last)
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
    const dir = path.posix.dirname((await kit.api('/bots/b1/files')).files[0].path)
    const viaStudio = await fetch(`${kit.url}/api/studio/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: 'botfiles:b1', dir, name: 'invoice.html', text: '<p>planted</p>' }) })
    const into = await fetch(`${kit.url}/api/transfers/in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'k1', name: 'x.txt', files: [{ size: 3 }], to: { where: 'pane', pane: 'botfiles:b1', dir } }) })
    ok(viaStudio.status === 403 && into.status === 403 && !(await kit.api('/bots/b1/files')).files.some((f) => /invoice|x\.txt/.test(f.name)), 'nor through Studio\'s routes, nor a copy into them', { studio: viaStudio.status, into: into.status })
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
