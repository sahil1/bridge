// A meeting's model at its usage limit: Claude Code (cli:claude) writing the notes and AI Assist,
// with your usual login at its weekly limit. Claude Code then answers "You've hit your weekly
// limit · resets 4am" instead, which used to pass for its answer: Assist showed nothing, saying
// nothing, and the limit's message was saved as the meeting's notes. Checked:
//   Assist with no account left says why (the limit), never nothing;
//   with another Claude Code account that has room (Personal), Assist and the notes carry on there;
//   every account out: said so, all of them;
//   notes saved before as only the limit's message are set aside and written again at the next start.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('meetings-limit')
const kit = await startKit('meetings-limit')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const dirOf = (id) => path.join(kit.data, 'meetings', id)
const said = (id, rows) => fs.appendFileSync(path.join(dirOf(id), 'transcript.jsonl'), rows.map(([src, t0, text]) => JSON.stringify({ src, t0, t1: t0 + 3, text, engine: 'test' })).join('\n') + '\n')
const runs = () => { try { return fs.readFileSync(path.join(kit.home, 'claude-print.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const err = (p, body, method) => kit.api(p, body, method).then(() => null, (e) => e.message)
const usual = path.join(kit.home, '.claude')
const out = (dir, on) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'stand-in-limit'); if (on) fs.writeFileSync(f, ''); else fs.rmSync(f, { force: true }) }
const LINES = [['them', 2, 'I led the move to electric vans at Northwind Traders and cut fuel costs by a third, with new routes and a charging plan for every depot.'], ['you', 9, 'How did you measure those savings, and did they hold up through the winter when the vans had less range?']]

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  await kit.api('/settings', { meetings: { model: 'cli:claude', autoSummary: false, cleanup: false, nameSpeakers: false, folder: path.join(kit.home, 'Meeting notes') } }, 'PATCH')
  out(usual, true)

  // Your usual login out, and no other account: Assist says why.
  const J = await kit.api('/meetings', { title: 'Interview - Mara Lind', call: false })
  await kit.api(`/meetings/${J.id}/assist`, { on: true })
  said(J.id, LINES)
  const why = await err(`/meetings/${J.id}/assist`, {})
  let J1 = await kit.api(`/meetings/${J.id}`)
  ok(/usage limit/.test(J1.assistError || '') && /weekly limit/.test(J1.assistError || '') && !J1.assistItems.length, 'Assist at the limit, with no other account: it says so, not nothing', { why, error: J1.assistError })
  ok(!!J1.assistAt, 'and when it last looked', J1.assistAt)

  // Another account with room: Assist carries on there.
  const personal = await kit.api('/accounts', { kind: 'claude', label: 'Personal' })
  const pid = personal.id || personal.account?.id
  ok(!!pid, 'a second Claude Code account, Personal', personal)
  const pdir = path.join(kit.data, 'accounts', pid)
  out(pdir, false)
  const before = runs().length
  await kit.api(`/meetings/${J.id}/assist`, {})
  J1 = await kit.api(`/meetings/${J.id}`)
  const tried = runs().slice(before)
  ok(J1.assistItems.length === 1 && /measured the savings/.test(J1.assistItems[0].text) && !J1.assistError, 'Personal has room: Assist suggests, and the error is gone', { items: J1.assistItems, error: J1.assistError })
  ok(tried.length === 2 && tried[0].limited && !tried[0].dir && !tried[1].limited && tried[1].dir === pdir, 'it tried your usual login, at its limit, then Personal', tried)

  // The notes, the same way: written on Personal, not the limit's message.
  await kit.api(`/meetings/${J.id}/stop`, {})
  await kit.api(`/meetings/${J.id}/summary`, {})
  const notes = await until(async () => { const m = await kit.api(`/meetings/${J.id}`); return m.summary || null }, 30000, 300)
  ok(/stand-in's notes/.test(notes || '') && !/weekly limit/.test(notes || ''), 'the notes are written on Personal, not "You\'ve hit your weekly limit"', notes)

  // Every account out: said, all of them.
  out(pdir, true)
  const K = await kit.api('/meetings', { title: 'Interview - Theo Park', call: false })
  await kit.api(`/meetings/${K.id}/assist`, { on: true })
  said(K.id, LINES)
  await err(`/meetings/${K.id}/assist`, {})
  const K1 = await kit.api(`/meetings/${K.id}`)
  ok(/all 2 of your accounts/.test(K1.assistError || ''), 'every account out: Assist says so', K1.assistError)
  await kit.api(`/meetings/${K.id}/stop`, {})
  await kit.api(`/meetings/${K.id}/summary`, {})
  const failed = await until(async () => { const m = await kit.api(`/meetings/${K.id}`); return m.summaryError || null }, 30000, 300)
  const K2 = await kit.api(`/meetings/${K.id}`)
  ok(/usage limit/.test(failed || '') && !K2.summary, "and the notes aren't written, saying why, rather than saved as the limit's message", { failed, summary: K2.summary })

  // Notes saved before as only the limit's message: set aside, and written again once it starts.
  // (Saved while it's closed: open, it tries the failed notes again a few seconds on, and with
  // Personal back it wrote them over the limit's message first, now and then on CI's Windows.)
  await kit.restart(() => {
    out(pdir, false)
    fs.writeFileSync(path.join(dirOf(K.id), 'summary.md'), "You've hit your weekly limit · resets 4am (America/Los_Angeles)\n")
  })
  const again = await until(async () => { const m = await kit.api(`/meetings/${K.id}`); return /stand-in's notes/.test(m.summary || '') ? m.summary : null }, 40000, 500)
  ok(!!again && fs.existsSync(path.join(dirOf(K.id), 'summary-limit.md')), 'notes that were only the limit\'s message: set aside and written again at the next start', { again, files: fs.readdirSync(dirOf(K.id)) })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-2000))
} finally {
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
