// A bot's record (server/trace.js) and Settings › Bots › Activity, with the stand-in Slack and
// Claude Code (stand-ins/slack.mjs, stand-ins/helper-claude.cjs), in the browser named by
// BRIDGE_TEST_BROWSER.
//   Each kind of event a conversation brings is written, as it happens: what came in, a refusal,
//   the context read, each run with its agent, folders, instructions' version and the files it
//   opened, the draft, your edit, what was sent and discarded, reactions, an edit in its thread,
//   settings changed and the connection; in a file a month, yours only, never a token, each line
//   carrying the hash of the one before. Activity lists the conversations with what came of each,
//   narrowed by a word, a person, where and an outcome; one opens as its timeline, with what was
//   read. Exported as JSON Lines (the record's own lines), CSV and Markdown, for dates or one
//   conversation. The chain checked: whole, then a month put in from elsewhere caught, deleted for
//   its age (how long it's kept, a setting) and whole again, the deletion in the record; a line
//   changed is caught, and said where.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSlack, checks, until, sleep, browser, page, shot, phoneFaults, TEST, IS_WIN } from '../lib/harness.mjs'

const { ok, done } = checks('bots-activity')
const slack = await startSlack('bots-activity')
// (Its Claude Code signed in with a Team plan: an organization's, so no note on the terms.)
const kit = await startKit('bots-activity', { config: { name: 'Tester', trials: { 'slack-bot': true } }, env: { BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_STANDIN_CLAUDE_PLAN: 'team' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const NOTES = path.join(kit.home, 'notes')
fs.mkdirSync(NOTES, { recursive: true })
fs.writeFileSync(path.join(NOTES, 'faq.md'), '# FAQ\n\nSupport hours are 9 to 5.\n')
const needs = async () => (await kit.api('/needs-you')).slack || []
const draftOf = (words, ms = 40000) => until(async () => (await needs()).find((x) => [x.text, ...(x.more || []).map((m) => m.text)].some((y) => y.includes(words)) && x.state === 'draft'), ms)
const activity = (q = '') => kit.api(`/bots/b1/activity${q}`)
const TRACE = path.join(kit.data, 'bots', 'b1', 'trace')
const month = new Date().toISOString().slice(0, 7)
const traceLines = () => fs.readFileSync(path.join(TRACE, `${month}.jsonl`), 'utf8').split('\n').filter(Boolean)
const events = () => traceLines().map((l) => JSON.parse(l))
const raw = (p) => fetch(`${kit.url}/api${p}`).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), name: r.headers.get('content-disposition'), text: await r.text() }))
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const openSettings = async (p) => {
  await p.locator('.topbar, .tabbar').first().waitFor({ timeout: 20000 })
  await until(async () => {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'slack-bot' } })))
    return p.locator('.modal.settings .sb').first().waitFor({ timeout: 2500 }).then(() => true, () => false)
  }, 20000, 100)
}
const M = '<@UBOT>'
// A folder or file as shown, with / between its parts (Windows shows ~\notes).
const slashed = (p) => String(p || '').replace(/\\/g, '/')

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  // A bot, made and connected, Dana and Sam may ask, it reads the notes.
  await kit.api('/bots', { name: 'Helpdesk' })
  await kit.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots/b1/settings', { askers: [{ id: 'U0DANA', name: 'Dana' }, { id: 'U0SAM', name: 'Sam' }], readsFrom: ['~/notes'] })
  ok(!!(await until(async () => (await kit.api('/bots/b1')).state === 'connected', 20000)), 'a bot, connected')

  // ---------- A few conversations ----------
  const q1 = await slack.ask({ user: 'U0DANA', text: `${M} When is support open? [answer From 9 to 5.]` })
  const d1 = await draftOf('support open')
  await kit.api(`/bots/questions/${d1.id}`, { send: true, text: 'From 9 to 5, Monday to Friday.' })
  await until(async () => (await slack.state()).posted.some((x) => /Monday to Friday/.test(x.text)), 15000)
  await slack.ask({ user: 'U0DANA', thread: q1.ts, text: 'And on weekends? [answer Closed on weekends.]' })
  const d2 = await draftOf('weekends')
  await kit.api(`/bots/questions/${d2.id}`, { send: true, text: d2.draft })
  await until(async () => (await slack.state()).posted.some((x) => /Closed on weekends/.test(x.text)), 15000)
  await slack.ask({ user: 'U0SAM', dm: true, text: 'Where is the office? [answer In Austin.]' })
  const d3 = await draftOf('Where is the office')
  await kit.api(`/bots/questions/${d3.id}`, { send: false })
  await slack.ask({ user: 'U0EVE', text: `${M} Can I see the payroll?` })
  await until(async () => (await activity()).conversations.some((c) => c.outcome === 'refused'), 10000)
  await slack.edit({ channel: 'C0LAUNCH', ts: q1.ts, text: `${M} When is support open, please?` })
  await until(async () => events().some((e) => e.type === 'message.changed'), 8000)

  // ---------- The record ----------
  const all = events()
  const types = new Set(all.map((e) => e.type))
  const want = ['received', 'refused', 'context', 'run.started', 'run.read', 'run.finished', 'draft', 'draft.edited', 'sent', 'discarded', 'reaction', 'message.changed', 'settings.changed', 'connection']
  ok(want.every((x) => types.has(x)), 'each kind of event is in its record', { missing: want.filter((x) => !types.has(x)) })
  ok(all.every((e) => e.bot === 'b1' && e.owner === 'Tester' && e.at) && all.filter((e) => e.type === 'received').every((e) => e.team === 'T0TEST' && e.channel && e.ts && e.person?.id), 'each says when, which bot and whose, and Slack\'s team, channel, ts and person', all.find((e) => e.type === 'received'))
  const lines = traceLines()
  const { createHash } = await import('node:crypto')
  ok(lines.every((l, i) => (i === 0 ? JSON.parse(l).prev === null : JSON.parse(l).prev === createHash('sha256').update(lines[i - 1]).digest('hex'))), 'each line carries the hash of the line before it')
  const file = path.join(TRACE, `${month}.jsonl`)
  ok(IS_WIN || (fs.statSync(file).mode & 0o777) === 0o600, 'kept a file a month, readable by you only', IS_WIN ? null : (fs.statSync(file).mode & 0o777).toString(8))
  const every = fs.readdirSync(TRACE).map((f) => fs.readFileSync(path.join(TRACE, f), 'utf8')).join('\n')
  ok(!every.includes('xoxb-test') && !every.includes('xapp-test') && /xoxb-…test/.test(every), 'never a token: only its kind and last four', null)
  const run = all.find((e) => e.type === 'run.started')
  ok(run?.agent === 'claude' && run.folders.map(slashed).join() === '~/notes' && /^[0-9a-f]{12}$/.test(run.instructions?.hash) && /# Helpdesk/.test(run.instructionsText || '') && !all.filter((e) => e.type === 'run.started').slice(1).some((e) => e.instructionsText), 'a run: its agent, its folders, and its instructions\' version, their words kept once', run)
  ok(all.some((e) => e.type === 'run.read' && e.files.some((f) => slashed(f.what) === '~/notes/faq.md')), 'the files it opened', all.find((e) => e.type === 'run.read'))
  ok(all.some((e) => e.type === 'context' && Array.isArray(e.messages)) && all.some((e) => e.type === 'draft.edited' && e.before === 'From 9 to 5.' && e.after === 'From 9 to 5, Monday to Friday.' && e.by === 'Tester'), 'the context read, and your edit, before and after and by whom')
  ok(all.some((e) => e.type === 'sent' && e.how === 'approved' && e.by === 'Tester' && e.posted) && all.some((e) => e.type === 'reaction' && e.name === 'white_check_mark' && e.ok), 'what was sent, by whom, with Slack\'s ts; and the reactions')

  // ---------- Activity, through the API ----------
  const a = await activity()
  const byWords = (w) => a.conversations.find((c) => c.asked.includes(w))
  ok(a.conversations.length === 3 && byWords('support open')?.outcome === 'sent' && byWords('support open').messages === 2 && byWords('office')?.outcome === 'discarded' && byWords('payroll')?.outcome === 'refused' && byWords('payroll').refused === 'not-allowed', 'its conversations, each with what came of it', a.conversations.map((c) => [c.asked.slice(0, 20), c.outcome, c.messages]))
  ok(a.integrity?.ok && a.integrity.events >= all.length && a.integrity.events <= events().length && a.retention === '1y', 'its record holds, and is kept a year to start', { integrity: a.integrity, read: all.length, now: events().length })
  ok((await activity('?q=weekends')).conversations.length === 1 && (await activity('?person=U0SAM')).conversations.map((c) => c.asked).join() === 'Where is the office? [answer In Austin.]' && (await activity('?outcome=refused')).conversations.length === 1 && (await activity('?channel=C0LAUNCH')).conversations.length === 2, 'narrowed by a word in an answer, a person, an outcome and where')
  ok((await activity(`?from=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`)).conversations.length === 0, 'and by dates')
  const conv = byWords('support open').id
  const tl = await kit.api(`/bots/b1/activity/${encodeURIComponent(conv)}`)
  ok(tl.events.length > 10 && tl.events.every((e) => e.conv === conv && !('prev' in e)) && tl.events[0].type === 'received', 'one conversation, as its timeline', tl.events.map((e) => e.type))

  // ---------- Export ----------
  const jl = await raw('/bots/b1/export?format=jsonl')
  ok(jl.status === 200 && /ndjson/.test(jl.type) && /attachment; filename="Helpdesk-activity\.jsonl"/.test(jl.name) && jl.text.trim() === traceLines().join('\n'), 'exported as JSON Lines: the record\'s own lines', jl.name)
  const csv = await raw(`/bots/b1/export?format=csv&conv=${encodeURIComponent(conv)}`)
  const rows = csv.text.trim().split('\r\n')
  ok(/text\/csv/.test(csv.type) && rows[0] === 'at,type,conversation,question,channel,thread_ts,ts,person_id,person,words' && rows.length === tl.events.length + 1 && rows.some((r) => /,received,/.test(r) && /When is support open/.test(r)), 'as CSV, for one conversation', rows.slice(0, 3))
  const md = await raw('/bots/b1/export?format=md')
  ok(/text\/markdown/.test(md.type) && /^# Helpdesk: activity/.test(md.text) && /## #launch, /.test(md.text) && /\*\*draft\.edited\*\* \(Dana\)?|\*\*draft\.edited\*\*/.test(md.text) && /\*\*refused\*\*/.test(md.text), 'and as Markdown, each conversation\'s events in order', md.text.slice(0, 400))
  const none = await raw(`/bots/b1/export?format=csv&to=${encodeURIComponent('2001-01-01T00:00:00.000Z')}`)
  ok(none.text.trim().split('\r\n').length === 1, 'a date range with nothing in it: only the header')

  // ---------- Activity, in Settings ----------
  await part('Activity in Settings', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await openSettings(p)
    await p.locator('.sb-tabs [role="tab"]', { hasText: 'Activity' }).click()
    await p.locator('.sb-convs li').first().waitFor({ timeout: 10000 })
    ok(/The record holds: \d+ events since/.test(await p.locator('.sb-integrity').innerText()), 'Activity says the record holds')
    ok(await p.locator('.sb-convs li').count() === 3, 'and lists its conversations')
    await p.locator('.sb-filters .sb-search input').fill('Austin')
    ok(!!(await until(async () => (await p.locator('.sb-convs li').count()) === 1 && /office/.test(await p.locator('.sb-convs').innerText()), 8000)), 'searched by a word')
    await p.locator('.sb-filters .sb-search input').fill('')
    await p.locator('.sb-filters select').nth(2).selectOption('refused')
    ok(!!(await until(async () => (await p.locator('.sb-convs li').count()) === 1 && /Refused: not someone it answers/.test(await p.locator('.sb-convs').innerText()), 8000)), 'filtered by what came of it')
    await p.locator('.sb-filters select').nth(2).selectOption('')
    await until(async () => (await p.locator('.sb-convs li').count()) === 3, 8000)
    await p.locator('.sb-conv', { hasText: 'support open' }).click()
    await p.locator('.sb-tl li').first().waitFor({ timeout: 10000 })
    const tline = slashed(await p.locator('.sb-timeline').innerText())
    ok(/Dana mentioned it: “When is support open\?/.test(tline) && /Claude Code started, reading ~\/notes; instructions [0-9a-f]{12} from Settings/.test(tline) && /Opened ~\/notes\/faq\.md/.test(tline) && /You edited it: “From 9 to 5, Monday to Friday\.”/.test(tline) && /Sent by Tester/.test(tline) && /Dana replied in the thread: “And on weekends\?/.test(tline) && /Dana edited a message/.test(tline), 'one conversation as its timeline: what came in, each run and what it opened, your edit, what was sent', tline)
    const href = await p.locator('.sb-tl-head a', { hasText: 'Export as Markdown' }).getAttribute('href')
    ok(/\/api\/bots\/b1\/export\?format=md&conv=/.test(href || ''), 'it exports on its own', href)
    await sleep(300)
    await shot(p, `${tag}bots-activity-timeline`)
    // How long it's kept: a month put in from elsewhere breaks the chain; deleted for its age, it holds again.
    const d = new Date()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() - 10)
    const oldMonth = d.toISOString().slice(0, 7)
    fs.writeFileSync(path.join(TRACE, `${oldMonth}.jsonl`), `${JSON.stringify({ at: `${oldMonth}-15T10:00:00.000Z`, type: 'received', bot: 'b1', prev: null })}\n`, { mode: 0o600 })
    const added = await until(async () => { const g = (await activity()).integrity; return !g.ok ? g : null }, 8000)
    ok(added?.broken?.file === `${month}.jsonl` && added.broken.line === 1, 'a month put in from elsewhere: the chain says the line after it doesn\'t follow', added)
    await p.locator('.sb-keep [role="radio"]', { hasText: '90 days' }).click()
    ok(!!(await until(async () => !fs.existsSync(path.join(TRACE, `${oldMonth}.jsonl`)), 8000)), 'kept 90 days: an older month is deleted whole')
    ok(events().some((e) => e.type === 'trace.deleted' && e.months.includes(oldMonth) && e.keep === '90d') && events().some((e) => e.type === 'settings.changed' && e.setting === 'retention' && e.old === '1y' && e.new === '90d'), 'and that\'s in the record, as the setting\'s change is')
    ok((await activity()).integrity.ok, 'and the chain holds again')
    // A line changed.
    const now = traceLines()
    const at = now.findIndex((l) => l.includes('"type":"draft.edited"'))
    now[at] = now[at].replace('Monday to Friday', 'every day')
    fs.writeFileSync(file, `${now.join('\n')}\n`)
    const g = await until(async () => { const x = (await activity()).integrity; return !x.ok ? x : null }, 8000)
    ok(g?.broken?.line === at + 2 && /changed or taken out/.test(g.broken.why), 'a line changed: the chain says where', g)
    const said = await until(async () => { const x = await p.locator('.sb-integrity').innerText(); return /The record was changed/.test(x) ? x : null }, 12000)
    ok(new RegExp(`at line ${at + 2} of ${month}\\.jsonl`).test(said || ''), 'and Activity says so', said)
    await shot(p, `${tag}bots-activity-broken`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  for (const [mode, theme, phone] of [['dark', 'midnight', false], ['light', 'sky', true], ['dark', 'midnight', true]]) {
    await part(`Activity, ${mode}${phone ? ', on a phone' : ''}`, async () => {
      const { ctx, p, errors } = await page(b, kit.url, { mode, theme, phone })
      await openSettings(p)
      await p.locator('.sb-tabs [role="tab"]', { hasText: 'Activity' }).click()
      await p.locator('.sb-convs li').first().waitFor({ timeout: 10000 })
      await p.locator('.sb-conv').first().click()
      await p.locator('.sb-tl li').first().waitFor({ timeout: 10000 })
      if (phone) {
        await sleep(300)
        const faults = await phoneFaults(p, '.modal.settings .sb')
        ok(!Object.keys(faults).length, 'on a phone: nothing too small to tap, off the screen or cut short', faults)
      }
      await sleep(300)
      await shot(p, `${tag}bots-activity-${mode}${phone ? '-phone' : ''}`)
      ok(errors.length === 0, 'no page errors', errors)
      await ctx.close()
    })
  }

  // ---------- A Team plan: no note on the terms ----------
  const bot1 = await kit.api('/bots/b1')
  ok(bot1.signIn?.kind === 'organization', 'its agent signed in with a Team plan: known as an organization\'s', bot1.signIn)

  // ---------- A bot deleted: its record kept, or its history deleted too ----------
  const B1 = path.join(kit.data, 'bots', 'b1')
  await kit.api('/bots', { name: 'Temp' })
  await part('deleting bots', async () => {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await openSettings(p)
    await p.locator('.sb-chip', { hasText: 'Helpdesk' }).click()
    await p.locator('.sb-tabs [role="tab"]', { hasText: 'Set Up' }).click()
    await p.locator('[data-setting="slack-replies"]').waitFor({ timeout: 10000 })
    ok(!(await p.locator('.sb-terms').count()), 'and Settings shows no note on the terms')
    await p.locator('button', { hasText: 'Delete this bot…' }).click()
    const sure = p.locator('.sb-sure')
    const box = sure.locator('input[type="checkbox"]')
    ok(/Its activity stays, to look at and export here/.test(await sure.innerText()) && /Also delete its activity history/.test(await sure.innerText()) && !(await box.isChecked()), 'Delete says its activity stays, with a box to delete that too, not ticked', await sure.innerText())
    await sure.locator('button', { hasText: 'Delete Helpdesk' }).click()
    const chip = p.locator('.sb-chip.gone', { hasText: 'Helpdesk (deleted)' })
    await chip.waitFor({ timeout: 10000 })
    ok(!fs.existsSync(path.join(B1, 'bot.json')) && !fs.existsSync(path.join(B1, 'instructions.md')) && !fs.existsSync(path.join(B1, 'slack.json')) && fs.existsSync(path.join(TRACE, `${month}.jsonl`)) && fs.existsSync(path.join(B1, 'deleted.json')), 'deleted: its settings, instructions and tokens go; its record stays')
    await chip.click()
    await p.locator('.sb-convs li').first().waitFor({ timeout: 10000 })
    ok(/Helpdesk was deleted on .*Its record stays here, to look at and export/.test(await p.locator('.sb-deleted').innerText()) && await p.locator('.sb-convs li').count() === 3 && !(await p.locator('.sb-keep').count()), 'Settings › Bots has it under its name, marked deleted, its conversations still there', await p.locator('.sb-deleted').innerText())
    await sleep(300)
    await shot(p, `${tag}bots-activity-deleted`)
    const left = await raw('/bots/b1/export?format=jsonl')
    ok(left.status === 200 && /Helpdesk-activity\.jsonl/.test(left.name) && left.text.includes('"setting":"deleted"') && left.text.includes('When is support open'), 'and it still exports, with its deletion in it', left.name)
    ok(events().some((e) => e.type === 'settings.changed' && e.setting === 'deleted' && e.new?.history === 'kept' && e.by === 'Tester'), 'the deletion is in its record')
    // The other: its history deleted too, by ticking the box.
    await p.locator('.sb-chip', { hasText: /^Temp$/ }).click()
    await p.locator('.sb-tabs [role="tab"]', { hasText: 'Set Up' }).click()
    await p.locator('button', { hasText: 'Delete this bot…' }).click()
    await p.locator('.sb-sure input[type="checkbox"]').check()
    await p.locator('.sb-sure button', { hasText: 'Delete Temp' }).click()
    const temp = p.locator('.sb-chip.gone', { hasText: 'Temp (deleted)' })
    await temp.waitFor({ timeout: 10000 })
    const T2 = path.join(kit.data, 'bots', 'b2', 'trace')
    const tl = fs.readdirSync(T2).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(T2, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    ok(tl.length === 1 && tl[0].type === 'trace.deleted' && tl[0].all && tl[0].by === 'Tester' && tl[0].months.includes(month), 'with the box ticked: its activity history goes, and a trace.deleted line takes its place, saying when and by whom', tl)
    await temp.click()
    ok(/Temp was deleted on .*and its activity history with it/.test(await p.locator('.sb-deleted').innerText()) && !(await p.locator('button', { hasText: 'Delete its activity history' }).count()), 'Settings says so', await p.locator('.sb-deleted').innerText())
    // A deleted bot's history deleted later, from its page.
    await chip.click()
    await p.locator('button', { hasText: 'Delete its activity history…' }).click()
    await p.locator('.sb-sure button', { hasText: 'Delete the history' }).click()
    ok(!!(await until(async () => /and its activity history with it/.test(await p.locator('.sb-deleted').innerText().catch(() => '')), 10000)), 'a kept record deleted later, from its page')
    const after = events()
    ok(after.length === 1 && after[0].type === 'trace.deleted' && (await kit.api('/bots/b1/activity')).conversations.length === 0 && (await kit.api('/bots/b1/activity')).integrity.ok, 'only its trace.deleted line is left, and the chain holds', after.map((e) => e.type))
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
}
process.exit(done().fail ? 1 : 0)
