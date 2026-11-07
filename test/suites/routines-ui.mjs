// Routines in the app, and Scheduled Routines (a beta feature), in the browser named by
// BRIDGE_TEST_BROWSER, with a stand-in Claude Code. Off: Today's Routines as before (Repeats, Run,
// I did this), a scheduled routine saying it doesn't run by itself while the beta feature is off,
// and no Commands in History, Routine in a chat or New routine in ⌘K. Turned on in Settings ›
// About & Updates › Beta Features: each scheduled routine says when it runs and when next, and what
// became of its last run (one whose folder is gone says it didn't run, and why), its runs listed
// with what its agent said last, a late run and a missed one; routines suggested from what was
// asked on four weekdays (and the Chief of Staff on three Mondays), with where it runs. Add a
// routine: who it goes to, which agent, the folder, "Runs by itself on" this computer, the schedule
// in words with what it means and the next three runs, the picker (days, time) writing the words,
// words it can't follow refused saying which and not saved; saved, its row. Run now (by hand, in
// its runs), Pause and Resume. A suggestion made a routine in the dialog (filled in, saved, its
// first run said, gone from the suggestions), another dismissed for good (after a reload). A
// message sent in an agent's chat made a routine from its Routine button (its words, folder, agent
// and the time it was sent). History › Commands: that message, where it went and from which box,
// searched, Make a routine, deleted; Settings › General › Command History off, said there.
// ⌘K: New routine… and a routine's next run. Light and dark, and on a 390 phone (the form, the
// dialog and History fit, whole targets, fields at 16 px).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, browser, page, shot, phoneFaults, testClock, TEST } from '../lib/harness.mjs'
import { lastDue } from '../../shared/schedule.js'

const { ok, done } = checks('routines-ui')
const clock = testClock()
const Date = clock.Date
const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const now = new Date()
const hoursAgo = (h) => new Date(now.getTime() - h * 3600e3)
const daysAgo = (n, h, m) => { const d = new Date(now); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d }

// Two scheduled routines whose times have gone today (so none comes due while the test runs): a
// morning check that ran, ran late and was missed before, and release notes whose folder is gone.
const morning = { every: 'day', at: hhmm(hoursAgo(3)) }
const release = { every: 'week', days: [now.getDay()], at: hhmm(hoursAgo(2)) }
const since = daysAgo(10, 0, 0).toISOString()
const kit = await startKit('routines-ui', {
  env: ({ data, home }) => {
    fs.mkdirSync(path.join(home, 'code', 'shop'), { recursive: true })
    fs.writeFileSync(path.join(data, 'routines.json'), JSON.stringify({ routines: [
      { id: 'weekly-dependency-check', name: 'Weekly dependency check', detail: '', every: 'week', cwd: '~/code/shop', workspace: 'Maintenance', kind: 'claude', command: 'busy 1', detect: {} },
      { id: 'morning-check', name: 'Morning check', detail: '', ...morning, cwd: '~/code/shop', workspace: 'Morning', kind: 'claude', command: 'Check the overnight build', auto: true, since, detect: {} },
      { id: 'release-notes', name: 'Release notes', detail: '', ...release, cwd: '~/code/gone', workspace: 'Release', kind: 'claude', command: 'Draft the release notes', auto: true, since, detect: {} },
    ] }))
    const m = lastDue(morning, { now, since })
    const r = lastDue(release, { now, since })
    const day = 864e5
    fs.mkdirSync(path.join(data, 'cache'), { recursive: true })
    fs.writeFileSync(path.join(data, 'cache', 'routines-log.json'), JSON.stringify({
      'morning-check': { slot: m.toISOString(), runs: [
        { at: new Date(m.getTime() + 4000).toISOString(), slot: m.toISOString(), how: 'auto', paneId: 'gone-1', ended: { at: new Date(m.getTime() + 180000).toISOString(), said: 'The overnight build passed: 412 tests, no warnings.' } },
        { at: new Date(m.getTime() - day + 4.6 * 3600e3).toISOString(), slot: new Date(m.getTime() - day).toISOString(), how: 'late', paneId: 'gone-2', ended: { at: new Date(m.getTime() - day + 4.7 * 3600e3).toISOString(), said: 'Two flaky tests in checkout; both pass on a retry.' } },
        { at: new Date(m.getTime() - day + 14 * 3600e3).toISOString(), slot: new Date(m.getTime() - 2 * day).toISOString(), how: 'auto', missed: true, why: 'Bridge AI wasn\'t running then, or this computer was asleep' },
      ] },
      'release-notes': { slot: r.toISOString(), runs: [{ at: new Date(r.getTime() + 2000).toISOString(), slot: r.toISOString(), how: 'auto', error: 'Folder not found: ~/code/gone' }] },
    }))
    // Asked before: on the last four weekdays about 9, in the shop folder; and the Chief of Staff on
    // the last three Mondays at 4.
    fs.mkdirSync(path.join(data, 'commands'), { recursive: true })
    const put = (d, text, to, i) => fs.appendFileSync(path.join(data, 'commands', `${d.toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ id: `seed${i}${'a'.repeat(10)}`, at: d.toISOString(), text, box: 'message', to })}\n`)
    let n = 0
    for (let back = 1, found = 0; found < 4; back++) { const d = daysAgo(back, 9, 5); if (d.getDay() >= 1 && d.getDay() <= 5) { put(d, 'Triage the new bug reports and label them', { kind: 'claude', name: 'Shop', cwd: path.join(home, 'code', 'shop') }, n++); found++ } }
    for (let back = 1, found = 0; found < 3; back++) { const d = daysAgo(back, 16, 0); if (d.getDay() === 1) { put(d, 'Write the weekly status update for the team', { kind: 'claude', name: 'Chief of Staff', chief: true }, n++); found++ } }
    return { ...clock.env }
  },
})
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const real = (errors) => errors.filter((e) => !/\/api\/[\w/.?=&-]+ due to access control checks/.test(e))
const LIGHT = { mode: 'light', theme: 'sky' }
const DARK = { mode: 'dark', theme: 'midnight' }
const routinesOf = async () => (await kit.api('/routines?refresh=1')).routines
const open = (p, id) => p.evaluate((x) => window.dispatchEvent(new CustomEvent('bridge-open-card', { detail: { id: x } })), id)
const settingsAt = (p, section) => p.evaluate((s) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: s } })), section)
// Escape closes Settings, but not from a field (a tick box just ticked): out of it first.
const closeSettings = async (p) => {
  await p.evaluate(() => document.activeElement?.blur())
  await p.keyboard.press('Escape')
  await p.locator('.modal.settings').waitFor({ state: 'detached', timeout: 5000 })
}
const text = async (l) => ((await l.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
// A form's field by its label's own heading (not words in its options).
const field = (scope, label, tagName = 'input') => scope.locator(`label:has(> span:text-is("${label}")) ${tagName}`)
const options = (sel) => sel.locator('option').allInnerTexts()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// A picture once what just opened has faded in.
const still = async (p, name) => { await p.waitForTimeout(450); await shot(p, name) }

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const computer = (await kit.api('/routines')).computer
  const shopDir = path.join(kit.home, 'code', 'shop')
  const ag = await kit.api('/agents/launch', { kind: 'claude', cwd: shopDir, label: 'Shop', newSpace: 'Shop', prompt: 'busy 1' })
  await until(async () => (await kit.api('/fleet')).agents.find((a) => a.paneId === ag.paneId && a.status !== 'working'), 30000, 500)

  // ---------- Off ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { ...LIGHT, width: 1440, height: 900, before: clock.install })
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await open(p, 'repeat')
    const card = p.locator('#card-repeat')
    await card.locator('.r-row', { hasText: 'Weekly dependency check' }).waitFor({ timeout: 15000 })
    ok(/Doesn't run by itself while Scheduled Routines is off/.test(await text(card.locator('.r-row', { hasText: 'Morning check' }))), 'off: a scheduled routine says it doesn\'t run by itself while the beta feature is off', await text(card.locator('.r-row', { hasText: 'Morning check' })))
    ok(!(await card.locator('.r-sug, .r-when, .r-where').count()), 'off: no schedules, suggestions or where it runs')
    await card.locator('.add-line').click()
    ok(await card.locator('.r-form select').count() === 1 && !(await card.locator('.r-sched').count()) && /Repeats/i.test(await text(card.locator('.r-form'))), 'off: Add a routine is as before, with Repeats', await text(card.locator('.r-form')))
    await card.locator('.r-form button', { hasText: 'Cancel' }).click()
    await p.keyboard.press('ControlOrMeta+Shift+KeyF')
    await p.locator('.modal.history').waitFor({ timeout: 5000 })
    ok(!(await p.locator('.hist-tabs').count()), 'off: History has no Commands')
    await p.keyboard.press('Escape')
    await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id, view: 'chat' } })), ag.paneId)
    await p.locator('.chat .msg.user').first().waitFor({ timeout: 20000 })
    ok(!(await p.locator('.msg-routine-btn').count()), 'off: a message in a chat has no Routine')
    await p.keyboard.press('ControlOrMeta+KeyK')
    await p.locator('.pal-input input').fill('routine')
    ok(!(await p.locator('.pal-item', { hasText: 'New routine' }).count()), 'off: ⌘K has no New routine')
    await p.keyboard.press('Escape')

    // ---------- Turned on ----------
    await settingsAt(p, 'about')
    await p.locator('.st-check', { hasText: 'Scheduled Routines' }).locator('input').check()
    ok(!!(await until(async () => (await kit.api('/config')).trials?.routines === true, 5000)), 'Beta Features › Scheduled Routines turns it on')
    await closeSettings(p)
    await open(p, 'repeat')
    const when = card.locator('.r-row', { hasText: 'Morning check' }).locator('.r-when')
    ok(!!(await until(() => when.isVisible(), 10000)), 'on: the routines say when they run, at once')
    const mRow = card.locator('.r-row', { hasText: 'Morning check' })
    const wantAt = new Date(2000, 0, 3, ...morning.at.split(':').map(Number)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const nextDay = hoursAgo(3).getDate() === now.getDate() ? 'tomorrow' : 'today' // before 3 am, its time is still to come today
    ok((await text(mRow.locator('.r-when'))) === `Every day at ${wantAt}` && new RegExp(`Next ${nextDay}`).test(await text(mRow.locator('.r-meta'))), 'its schedule in words, and its next run', await text(mRow))
    ok(/^Ran .* \(by itself\) and finished$/.test(await text(mRow.locator('.r-last'))), 'and what became of its last run', await text(mRow.locator('.r-last')))
    const rRow = card.locator('.r-row', { hasText: 'Release notes' })
    ok(await rRow.evaluate((e) => e.classList.contains('st-error')) && /^Didn't run .*: Folder not found: ~\/code\/gone$/.test(await text(rRow.locator('.r-last.bad'))), 'one whose folder is gone: didn\'t run, and why, in red', await text(rRow.locator('.r-last')))
    await mRow.getByRole('button', { name: 'Runs of Morning check' }).click()
    const runs = mRow.locator('.r-runs li')
    ok(await runs.count() === 3 && /The overnight build passed/.test(await text(runs.nth(0))) && /h late/.test(await text(runs.nth(1))) && /Two flaky tests/.test(await text(runs.nth(1))) && /^Missed .*wasn't running/.test(await text(runs.nth(2))), 'its runs: what its agent said last, one late and how late, one missed and why', await text(mRow.locator('.r-runs')))
    const sugs = card.locator('.r-sug')
    ok(!!(await until(async () => (await sugs.count()) === 2, 8000)), 'two routines suggested from what was asked', await sugs.count())
    ok(/Triage the new bug reports/.test(await text(sugs.nth(0))) && /Asked on 4 days/.test(await text(sugs.nth(0))) && /Suggested: Every weekday at 9:00 AM/.test(await text(sugs.nth(0))), 'the request on four weekdays: every weekday at 9:00, saying why', await text(sugs.nth(0)))
    ok(/weekly status update/.test(await text(sugs.nth(1))) && /Chief of Staff on 3 days/.test(await text(sugs.nth(1))) && /Every Monday at 4:00 PM/.test(await text(sugs.nth(1))), 'the Chief of Staff\'s on three Mondays: every Monday at 4:00 PM', await text(sugs.nth(1)))
    ok((await text(card.locator('.r-where'))).includes(`These run on ${computer}.`), 'and which computer they run on', await text(card.locator('.r-where')))
    await card.scrollIntoViewIfNeeded()
    await still(p, `${tag}routines-card-light`)

    // Add a routine: the schedule in words and from the picker.
    await card.locator('.add-line').click()
    const form = card.locator('.r-form')
    const says = form.locator('.r-sched-says')
    ok((await form.locator('.r-sched-text').inputValue()) === 'every weekday at 9:00' && /^Every weekday at 9:00 AM/.test(await text(says)) && (await text(says.locator('.r-next'))).split('·').length === 3, 'a new one starts as every weekday at 9:00, saying so, with its next three runs', await text(says))
    ok((await text(form.locator('.r-check'))).startsWith(`Runs by itself on ${computer}`), 'it says which computer runs it', await text(form.locator('.r-check')))
    const agents = await until(async () => { const o = await options(field(form, 'Agent', 'select')); return o.includes('Claude Code') && o }, 8000)
    ok(same(await options(field(form, 'Goes to', 'select')), ['A new agent', 'Chief of Staff']) && agents && agents[0] === 'Your default agent', 'who it goes to (an agent or the Chief of Staff) and which agent', { to: await options(field(form, 'Goes to', 'select')), agents })
    await field(form, 'Name').fill('Dependency audit')
    await field(form, 'Command', 'textarea').fill('Check for outdated dependencies and list what to upgrade')
    await field(form, 'Folder').fill('~/code/shop')
    await form.locator('.r-sched-text').fill('mondays and thursdays at 2pm')
    const onDays = () => form.locator('.r-days button.on').allInnerTexts()
    ok(/^Every Monday and Thursday at 2:00 PM/.test(await text(says)) && (await onDays()).join() === 'Mon,Thu', 'typed in words: what it means, and the picker follows (Monday and Thursday)', { says: await text(says), days: await onDays() })
    await form.locator('.r-days button', { hasText: 'Fri' }).click()
    ok((await form.locator('.r-sched-text').inputValue()) === 'every monday and thursday and friday at 14:00' && /^Every Monday, Thursday, and Friday at 2:00 PM/.test(await text(says)), 'a day picked writes the words', await form.locator('.r-sched-text').inputValue())
    await form.locator('input[type="time"]').fill('08:30')
    ok((await form.locator('.r-sched-text').inputValue()) === 'every monday and thursday and friday at 08:30', 'and the time', await form.locator('.r-sched-text').inputValue())
    await still(p, `${tag}routines-form-light`)
    await form.locator('.r-sched-text').fill('every blue moon')
    ok(/Didn't follow "blue moon"/.test(await text(form.locator('.r-sched-says.bad'))), 'words it can\'t follow: said which', await text(says))
    await form.locator('button[type=submit]').click()
    ok(/Didn't follow "blue moon"/.test(await text(form.locator('.error-text'))) && !(await routinesOf()).some((r) => r.name === 'Dependency audit'), 'and it isn\'t saved')
    await form.locator('.r-sched-text').fill('every weekday at 8:30')
    await form.locator('button[type=submit]').click()
    const dRow = card.locator('.r-row', { hasText: 'Dependency audit' })
    await dRow.waitFor({ timeout: 8000 })
    const saved = (await routinesOf()).find((r) => r.name === 'Dependency audit')
    ok(saved?.every === 'weekday' && saved.at === '08:30' && saved.auto && saved.kind === undefined && (await text(dRow.locator('.r-when'))) === 'Every weekday at 8:30 AM' && /Next /.test(await text(dRow.locator('.r-meta'))), 'saved: its row says when it runs and when next', { saved, row: await text(dRow) })
    // Run now, Pause, Resume.
    await dRow.locator('.run-btn').click()
    ok(!!(await until(async () => /Dependency audit started/.test(await text(card.locator('.r-flash'))), 8000)), 'Run now starts it', await text(card.locator('.r-flash')))
    await dRow.getByRole('button', { name: 'Runs of Dependency audit' }).click()
    ok(!!(await until(async () => /\(by hand\)/.test(await text(dRow.locator('.r-runs li').first())), 8000)), 'and its run says it was by hand', await text(dRow.locator('.r-runs')))
    await dRow.getByRole('button', { name: 'Pause Dependency audit' }).click()
    ok(!!(await until(async () => (await dRow.evaluate((e) => e.classList.contains('st-paused'))) && /Paused/.test(await text(dRow.locator('.r-meta'))), 8000)), 'Pause: it says it\'s paused')
    await dRow.getByRole('button', { name: 'Resume Dependency audit' }).click()
    ok(!!(await until(async () => /Next /.test(await text(dRow.locator('.r-meta'))), 8000)), 'Resume: its next run again')

    // A suggestion made a routine, another dismissed.
    await sugs.nth(0).locator('button', { hasText: 'Make a routine' }).click()
    const dlg = p.locator('.r-dialog')
    await dlg.waitFor({ timeout: 5000 })
    const df = (label, tagName = 'input') => field(dlg, label, tagName)
    ok((await df('Command', 'textarea').inputValue()) === 'Triage the new bug reports and label them' && (await df('Folder').inputValue()).endsWith('code/shop') && (await dlg.locator('.r-sched-text').inputValue()) === 'every weekday at 09:00' && /^Triage the new bug reports/.test(await df('Name').inputValue()), 'Make a routine: the dialog filled in from the suggestion', { name: await df('Name').inputValue(), folder: await df('Folder').inputValue(), when: await dlg.locator('.r-sched-text').inputValue() })
    await still(p, `${tag}routines-dialog-light`)
    await dlg.locator('button[type=submit]').click()
    await dlg.locator('.r-made').waitFor({ timeout: 5000 })
    ok(/is a routine now/.test(await text(dlg)) && new RegExp(`Every weekday at 9:00 AM, on ${computer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(await text(dlg)) && /Its first run is/.test(await text(dlg)), 'saved: where and when it runs, and its first run', await text(dlg))
    await dlg.locator('button', { hasText: 'Done' }).click()
    ok(!!(await until(async () => (await sugs.count()) === 1 && /weekly status/.test(await text(sugs.first())), 8000)), 'a routine now, it isn\'t suggested', await sugs.count())
    await sugs.first().getByRole('button', { name: 'Dismiss' }).click()
    ok(!!(await until(async () => !(await sugs.count()), 5000)), 'dismissed, gone')
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await open(p, 'repeat')
    await card.locator('.r-row', { hasText: 'Morning check' }).waitFor({ timeout: 15000 })
    await sleep(1500)
    ok(!(await card.locator('.r-sug').count()), 'and not back after a reload')

    // A message in a chat made a routine.
    await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id, view: 'chat' } })), ag.paneId)
    await p.locator('.composer textarea').waitFor({ timeout: 20000 })
    const said = 'Check the CI on main and summarize the failures'
    await p.locator('.composer textarea').fill(said)
    await p.locator('.composer textarea').press('Enter')
    const msg = p.locator('.chat .msg.user:not(.pending):not(.queued)', { hasText: said })
    await msg.waitFor({ timeout: 20000 })
    await msg.hover()
    await msg.locator('.msg-routine-btn').click()
    await dlg.waitFor({ timeout: 5000 })
    const sent = new Date()
    await until(async () => (await df('Agent', 'select').inputValue()) === 'claude', 8000)
    ok((await df('Command', 'textarea').inputValue()) === said && (await df('Folder').inputValue()).endsWith('code/shop') && (await df('Agent', 'select').inputValue()) === 'claude' && (await df('Space').inputValue()) === 'Shop' && /^every (weekday|sunday|saturday) at \d\d:\d\d$/.test(await dlg.locator('.r-sched-text').inputValue()), 'Routine on a message: its words, its folder, agent and space, and about the time it was sent', { when: await dlg.locator('.r-sched-text').inputValue(), sent: sent.toString() })
    await dlg.locator('button[type=submit]').click()
    await dlg.locator('.r-made').waitFor({ timeout: 5000 })
    await dlg.locator('button', { hasText: 'Done' }).click()
    const fromChat = (await routinesOf()).find((r) => r.command === said)
    ok(fromChat?.kind === 'claude' && fromChat.cwd.endsWith('code/shop') && fromChat.auto, 'saved as a routine for that agent in that folder', fromChat)

    // History › Commands.
    await p.keyboard.press('ControlOrMeta+Shift+KeyF')
    await p.locator('.hist-tabs button', { hasText: 'Commands' }).click()
    const item = p.locator('.cmd-item', { hasText: said })
    await item.waitFor({ timeout: 8000 })
    ok(/Shop/.test(await text(item.locator('.hist-where'))) && /Message box/.test(await text(item.locator('.hist-where'))) && (await p.locator('.cmd-day').first().innerText()).toLowerCase() === new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase(), 'History › Commands: what was sent from the message box, today, with the agent it went to', await text(item))
    ok(await p.locator('.cmd-item', { hasText: 'Triage the new bug reports' }).count() === 4, 'and what was asked before', await p.locator('.cmd-item', { hasText: 'Triage' }).count())
    ok(/Kept on this computer for 90 days/.test(await text(p.locator('.cmd-foot'))), 'kept on this computer for 90 days, it says', await text(p.locator('.cmd-foot')))
    await still(p, `${tag}routines-commands-light`)
    await p.locator('.modal.history .hist-search input').fill('CI on main')
    ok(!!(await until(async () => (await p.locator('.cmd-item').count()) === 1, 5000)), 'searched', await p.locator('.cmd-item').count())
    await item.locator('button', { hasText: 'Make a routine' }).click()
    ok(!!(await until(async () => (await df('Command', 'textarea').inputValue().catch(() => '')) === said, 5000)), 'Make a routine from it: the dialog, filled in')
    await dlg.locator('button', { hasText: 'Cancel' }).click()
    await item.getByRole('button', { name: 'Delete from your history' }).click()
    ok(!!(await until(async () => !(await p.locator('.cmd-item').count()) && !(await kit.api('/command-history')).items.some((r) => r.text === said), 5000)), 'deleted: gone from the list and the computer')
    await p.keyboard.press('Escape')
    // Settings › General › Command History off: History says so.
    await settingsAt(p, 'commands')
    const sec = p.locator('#commands')
    await sec.waitFor({ timeout: 8000 })
    await sec.locator('.st-check', { hasText: 'Keep a history of what you ask' }).locator('input').uncheck()
    ok(!!(await until(async () => (await kit.api('/settings')).effective.commands?.history === false, 5000)), 'Command History turned off in Settings › General')
    await closeSettings(p)
    await p.keyboard.press('ControlOrMeta+Shift+KeyF')
    await p.locator('.hist-tabs button', { hasText: 'Commands' }).click()
    ok(!!(await until(async () => /Command History is off/.test(await text(p.locator('.cmd-off'))), 5000)), 'and History › Commands says it\'s off, with the way to turn it on')
    await p.keyboard.press('Escape')
    await kit.api('/settings', { commands: { history: true } }, 'PATCH')
    // ⌘K.
    await p.keyboard.press('ControlOrMeta+KeyK')
    await p.locator('.pal-input input').fill('routine')
    ok(await p.locator('.pal-item', { hasText: 'New routine…' }).count() === 1 && /next /.test(await text(p.locator('.pal-item', { hasText: 'Run Morning check' }))), '⌘K: New routine…, and a routine\'s next run', await text(p.locator('.pal-item', { hasText: 'Run Morning check' })))
    await p.locator('.pal-item', { hasText: 'New routine…' }).click()
    await dlg.waitFor({ timeout: 5000 })
    ok((await df('Name').inputValue()) === '' && (await dlg.locator('.r-sched-text').inputValue()) === 'every weekday at 9:00', 'New routine…: the dialog, empty, every weekday at 9:00 to start')
    await p.keyboard.press('Escape')
    ok(real(errors).length === 0, 'no page errors', real(errors))
    await ctx.close()
  }

  // ---------- Dark ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { ...DARK, width: 1440, height: 900, before: clock.install })
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await open(p, 'repeat')
    const card = p.locator('#card-repeat')
    await card.locator('.r-row .r-when').first().waitFor({ timeout: 15000 })
    await card.locator('.r-row', { hasText: 'Morning check' }).getByRole('button', { name: 'Runs of Morning check' }).click()
    await card.locator('.add-line').click()
    await card.scrollIntoViewIfNeeded()
    await still(p, `${tag}routines-card-dark`)
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-new-routine', { detail: { name: 'Weekly status', command: 'Write the weekly status update for the team', to: 'chief', schedule: 'every monday at 16:00' } })))
    await p.locator('.r-dialog').waitFor({ timeout: 5000 })
    ok(!(await field(p.locator('.r-dialog'), 'Folder').count()) && (await field(p.locator('.r-dialog'), 'Goes to', 'select').inputValue()) === 'chief', 'to the Chief of Staff: no folder to pick')
    await still(p, `${tag}routines-dialog-dark`)
    await p.keyboard.press('Escape')
    await p.keyboard.press('ControlOrMeta+Shift+KeyF')
    await p.locator('.hist-tabs button', { hasText: 'Commands' }).click()
    await p.locator('.cmd-item').first().waitFor({ timeout: 8000 })
    await still(p, `${tag}routines-commands-dark`)
    ok(real(errors).length === 0, 'dark: no page errors', real(errors))
    await ctx.close()
  }

  // ---------- On a phone ----------
  for (const [look, name] of [[LIGHT, 'light'], [DARK, 'dark']]) {
    const { ctx, p, errors } = await page(b, kit.url, { ...look, phone: true, before: clock.install })
    await p.waitForSelector('.tabbar button', { timeout: 20000 })
    await open(p, 'repeat')
    const card = p.locator('#card-repeat')
    await card.locator('.r-row .r-when').first().waitFor({ timeout: 15000 })
    await card.locator('.add-line').click()
    await card.locator('.r-form .r-sched-text').fill('mondays and thursdays at 2pm')
    await card.locator('.r-form').scrollIntoViewIfNeeded()
    const f1 = await phoneFaults(p, '#card-repeat .r-form')
    ok(!Object.keys(f1).length, `phone ${name}: Add a routine fits, with whole targets and fields at 16 px`, f1)
    ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, `phone ${name}: nothing wider than the phone`)
    await still(p, `${tag}routines-form-phone-${name}`)
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-new-routine', { detail: { name: 'Triage', command: 'Triage the new bug reports and label them', cwd: '~/code/shop', schedule: 'every weekday at 9:00' } })))
    await p.locator('.r-dialog').waitFor({ timeout: 5000 })
    const f2 = await phoneFaults(p, '.r-dialog')
    ok(!Object.keys(f2).length, `phone ${name}: the routine dialog fits`, f2)
    await still(p, `${tag}routines-dialog-phone-${name}`)
    await p.locator('.r-dialog button', { hasText: 'Cancel' }).click()
    await p.keyboard.press('ControlOrMeta+Shift+KeyF')
    await p.locator('.hist-tabs button', { hasText: 'Commands' }).click()
    await p.locator('.cmd-item').first().waitFor({ timeout: 8000 })
    const f3 = await phoneFaults(p, '.modal.history')
    ok(!Object.keys(f3).length, `phone ${name}: History › Commands fits`, f3)
    await still(p, `${tag}routines-commands-phone-${name}`)
    ok(real(errors).length === 0, `phone ${name}: no page errors`, real(errors))
    await ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
