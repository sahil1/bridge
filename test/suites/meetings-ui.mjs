// Meetings in the app, on any platform: Record now in the sidebar, My notes in view while it records
// (beside the transcript, and a big box on a phone), the summary first once it ends with Send action
// items to Chief of Staff under its action items, New section in the recording
// bar, the top bar's menu and the floating card (with Pause there), naming who said a line, the
// right-click menu, folders, the archive and deleting after a warning. Action items into work: Start
// an agent and To Chief of Staff on each, what became of them, and since last time. The floating card following
// dark mode while it's open, its frame, and its warning when the call has no sound: the list to turn on
// (System Audio Recording Only, the second), then Restart Bridge AI (saying it stops the recording) and,
// restarted and still quiet, Reset and ask again for the sound alone (tccutil stood in for). The mic set for the room
// (no echo or noise handling, which drops the people around the table) with no call on the
// computer, and for a call while one is on. In Chromium with its fake
// mic; in WebKit (BRIDGE_TEST_BROWSER=webkit) the parts that record are skipped, since it has none.
// The meeting named after the calendar event on now is Mac-only (macOS Calendar). Watching a
// screen (a canvas, as the picker's answer) and the looks at it while someone on the call talks.
// Who said what in a room: Speaker 1 and 2, named once from who was invited or you; Who spoke and
// Settings' Voices in a room, and neither where voices can't be told apart. AI Assist's live board (a
// beta feature): the meeting's Board filling in, kept and discarded there and on the board itself,
// the floating card's line, the summary's link, its action items onto the task list and Settings.
// Answers in AI Assist (a beta feature): each answer's card in Suggestions and on the floating card,
// and what Settings › Meetings says goes where.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, startModel, checks, until, sleep, browser, page, shot, solid, noServiceWorker, changeAnswer, withoutCutOff, phoneFaults, TEST, IS_MAC, advanced } from '../lib/harness.mjs'

const { ok, skip, done } = checks('meetings-ui')
// On a Mac, tccutil stood in for (bin/tcc.log), for Reset and ask again on the call's sound.
const tccutil = (bin) => {
  fs.writeFileSync(path.join(bin, 'tccutil.cjs'), `require('node:fs').appendFileSync(require('node:path').join(__dirname, 'tcc.log'), process.argv.slice(2).join(' ') + '\\n')`)
  fs.writeFileSync(path.join(bin, 'tccutil'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'tccutil.cjs')}" "$@"\n`, { mode: 0o755 })
  return path.join(bin, 'tccutil')
}
// BRIDGE_BOARD_MS: the live board's minute, 1.5 s here.
const kit = await startKit('meetings-ui', { env: ({ bin }) => ({ BRIDGE_BOARD_MS: '1500', ...(IS_MAC ? { BRIDGE_TCCUTIL: tccutil(bin), BRIDGE_FIX_BUNDLE_ID: 'dev.bridge-ai.test' } : {}) }) })
const model = await startModel('meetings-ui')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const RATE = 16000
const tone = (seconds, say) => { const x = Buffer.alloc(Math.round(seconds * RATE) * 2); if (say) for (let i = 0; i < x.length / 2; i++) x.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 8000), i * 2); return x }
let seq = 0
const send = async (id, buf) => { for (let o = 0; o < buf.length; o += RATE * 2) await fetch(`${kit.url}/api/meetings/${id}/audio?src=you&seq=${seq++}`, { method: 'POST', body: buf.subarray(o, o + RATE * 2) }) }
const said = (id, rows) => fs.appendFileSync(path.join(kit.data, 'meetings', id, 'transcript.jsonl'), rows.map(([src, t0, text]) => JSON.stringify({ src, t0, t1: t0 + 3, text, engine: 'test' })).join('\n') + '\n')
const api = kit.api

try {
  await api('/setup', { name: 'Tester' })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false } }, 'PATCH')
  // On a Mac, a calendar with an event on now (icalBuddy's output, as calendar.js asks for it).
  if (IS_MAC) kit.program('icalBuddy', `const d = new Date(), p = (n) => String(n).padStart(2, '0'), hm = (t) => p(t.getHours()) + ':' + p(t.getMinutes())
process.stdout.write('@@EV@@Pricing review (Work)\\u00a6' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' at ' + hm(new Date(Math.max(d - 6e5, new Date(d).setHours(0, 0, 0, 0)))) + ' - ' + hm(new Date(Math.min(+d + 3e6, new Date(d).setHours(23, 59, 0, 0)))) + '\\u00a6attendees: Priya Shah, Dan Ruiz, Tester\\n')`)

  // A meeting from before, in three sections, with the call's lines named.
  const A = await api('/meetings', { title: 'Quarterly plan', call: false, event: { title: 'Planning', attendees: ['Priya Shah', 'Dan Ruiz', 'Tester'] } })
  await send(A.id, tone(6))
  await api(`/meetings/${A.id}/section`, {})
  await send(A.id, tone(3))
  await api(`/meetings/${A.id}/section`, { title: 'Q&A' })
  await api(`/meetings/${A.id}/sections/1`, { title: 'Demo' }, 'PATCH')
  await api(`/meetings/${A.id}/stop`, {})
  const S = (await api(`/meetings/${A.id}`)).sections
  said(A.id, [['you', 1, 'Let us get started.'], ['them', 2.5, 'Thanks, here is the agenda for today.'], ['them', S[1].t + 0.5, 'These slides show the new deck.'], ['you', S[1].t + 1, 'Looks good to me.'], ['them', S[2].t + 0.5, 'What about the budget for next year?']])
  await api(`/meetings/${A.id}/speakers`, {})
  await api(`/meetings/${A.id}`, { folder: 'Planning' }, 'PATCH')
  const B = await api('/meetings', { title: 'Vendor call', call: false })
  await api(`/meetings/${B.id}/stop`, {})
  await api(`/meetings/${B.id}`, { folder: 'Vendors' }, 'PATCH')

  // A call on this computer, made up on cue (the server's /api/calls, as the page sees it), and the
  // settings the mic is opened with each time.
  // talking: someone on the call talking, as the server says (the stretch they started). looks:
  // when the page sent a look at the watched screen, and lookReply what it's told back.
  let onCall = false
  let talking = null
  const looks = []
  let lookReply = { kept: true }
  const { ctx, p, errors } = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, before: async (c) => {
    await c.addInitScript(() => {
      window.__mics = []
      const md = navigator.mediaDevices
      if (md?.getUserMedia) { const g = md.getUserMedia.bind(md); md.getUserMedia = (k) => { window.__mics.push(k?.audio || null); return g(k) } }
      // The screen picked: a call's window, with its "Talking:" label.
      if (md) {
        md.getDisplayMedia = async () => {
          const cv = document.createElement('canvas')
          cv.width = 640
          cv.height = 360
          const x = cv.getContext('2d')
          const draw = () => { x.fillStyle = '#fff'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#123'; x.font = '36px sans-serif'; x.fillText('Talking: Dan Ruiz', 40, 180) }
          draw()
          setInterval(draw, 300)
          return cv.captureStream(4)
        }
      }
    })
    await c.route('**/api/calls', async (route) => {
      const r = await route.fetch()
      const j = await r.json().catch(() => ({}))
      if (onCall) j.calls = [{ app: 'zoom.us', since: new Date().toISOString(), browser: false }]
      if (j.recording) j.recording.talking = talking
      await route.fulfill({ response: r, json: j })
    })
    await c.route('**/api/meetings/*/glances', (route) => { looks.push({ at: Date.now(), type: route.request().headers()['content-type'] }); return route.fulfill({ json: lookReply }) })
  } })
  await p.waitForSelector('.rail-nav-row .rail-rec', { timeout: 15000 }).catch(() => {})
  ok(await p.locator('.rail-nav-row .rail-rec').isVisible(), 'a record button beside Meetings in the sidebar')
  const row = (title) => p.locator('.rail-meetings .rm-row', { hasText: title }).first()

  // ---------- Recording (needs a mic: Chromium's fake one) ----------
  let rec1 = null
  if (which === 'chromium') {
    await p.locator('.rail-nav-row .rail-rec').click()
    await p.waitForSelector('.mt-recbar', { timeout: 15000 }).catch(() => {})
    rec1 = await until(async () => (await api('/meetings')).meetings.find((x) => x.status === 'recording'), 8000)
    ok(!!rec1, 'Record now starts a meeting')
    if (IS_MAC) ok(rec1?.title === 'Pricing review' && rec1.event?.attendees?.length === 3 && /Priya Shah, Dan Ruiz, Tester/.test(await p.locator('.mt-people').innerText().catch(() => '')), 'named after the calendar event on now, with its people', rec1 && { t: rec1.title, e: rec1.event })
    else skip('named after the calendar event on now', 'the calendar is macOS Calendar')
    ok(!!(await until(async () => (await p.locator('.ws-tab, .tab-row').filter({ hasText: rec1?.title || '' }).count()) > 0, 5000)), 'its tab has its name straight away')
    // While it records: My notes beside the transcript, the cursor in it, and what it's for.
    const box = p.locator('.mt-cols.pinned .mt-mynotes .mt-mine')
    const sideBySide = async () => { const a = await box.boundingBox({ timeout: 1000 }).catch(() => null), t = await p.locator('.mt-cols.pinned .mt-transcript').boundingBox({ timeout: 1000 }).catch(() => null); return !!a && !!t && a.x + a.width <= t.x && a.height > 300 }
    // (Once the page has settled: what comes in above it as the recording starts makes it shorter for a moment.)
    ok(!!(await until(async () => await box.isVisible() && await sideBySide(), 8000)), 'while it records, My notes is beside the transcript, the height of the page', { cols: await p.locator('.mt-cols').getAttribute('class', { timeout: 1000 }).catch(() => null), mine: await box.boundingBox({ timeout: 1000 }).catch(() => null), transcript: await p.locator('.mt-cols.pinned .mt-transcript').boundingBox({ timeout: 1000 }).catch(() => null) })
    ok(!!(await until(() => p.evaluate(() => !!document.activeElement?.classList.contains('mt-mine')), 4000)), 'with the cursor in it, ready to write', await p.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)))
    ok(/^What you write here(, the slides it sees)? and the meeting's files shape the summary\.$/.test(await p.locator('.mt-mynotes .mt-shapes').innerText().catch(() => '')) && (await p.locator('.seg button[data-view="mine"]').count()) === 0, 'it says what shapes the summary, and needs no tab of its own while it records', await p.locator('.mt-mynotes').innerText().catch(() => ''))
    await p.keyboard.type('tiers ok?')
    ok(!!(await until(async () => /tiers ok\?/.test((await api(`/meetings/${rec1.id}`)).notes || ''), 5000)), 'what you type there goes in your notes')
    await shot(p, `${tag}recording-notes`)
    // In a room: no call on this computer, so the mic hears everyone around the table.
    const mics = () => p.evaluate(() => window.__mics.filter((a) => a && typeof a === 'object'))
    const first = (await mics()).at(-1)
    ok(first && first.echoCancellation === false && first.noiseSuppression === false && first.autoGainControl === true, 'no call on this computer: the mic is set for the room (no echo or noise handling)', first)
    const secs = async () => (rec1 && (await api(`/meetings/${rec1.id}`)).seconds) || 0
    onCall = true
    const callMic = await until(async () => { const m = await mics(); return m.length >= 2 && m.at(-1).echoCancellation === true && m.at(-1) }, 10000)
    ok(!!callMic && callMic.noiseSuppression === true, 'a call starts: the mic switches to call settings', await mics())
    const s0 = await secs()
    ok(!!(await until(async () => (await secs()) >= s0 + 3, 12000)), 'and the recording goes on', { s0, now: await secs() })
    onCall = false
    ok(!!(await until(async () => { const m = await mics(); return m.length >= 3 && m.at(-1).echoCancellation === false }, 10000)), 'the call ends: set for the room again', await mics())
    await sleep(7000)
    await p.locator('.mt-recbar button', { hasText: 'New section' }).click()
    ok(!!(await until(async () => /Section 2 started/.test(await p.locator('.mt-recbar').innerText()), 4000)), 'New section in the recording bar says which one started')
    ok(!!(await until(async () => (await p.locator('.mt-transcript .mt-sec').count()) === 2, 8000)), 'the transcript shows where each starts')
    await p.locator('.mt-sec-name', { hasText: 'Section 2' }).click()
    await p.locator('.mt-sec input').fill('Pricing')
    await p.keyboard.press('Enter')
    ok(!!(await until(async () => (await api(`/meetings/${rec1.id}`)).sections[1]?.title === 'Pricing', 5000)), 'a section is renamed in place')
    ok(!!(await until(async () => /## Pricing/.test(await p.locator('.mt-mine').inputValue()), 8000)), 'and its heading in My notes with it')
    await shot(p, `${tag}recording-sections`)
    await sleep(2200)
    await p.hover('.rec-pill')
    await p.waitForSelector('.rec-menu', { timeout: 4000 }).catch(() => {})
    ok(await solid(p, '.rec-menu'), 'the top bar\'s menu is solid')
    const acts = await p.evaluate(() => { const card = document.querySelector('.rec-menu').getBoundingClientRect(); return [...document.querySelectorAll('.rec-menu-acts .btn')].map((e) => ({ t: e.innerText.trim(), h: e.getBoundingClientRect().height, in: e.getBoundingClientRect().right <= card.right })) })
    ok(acts.some((x) => /New section/.test(x.t)) && Math.max(...acts.map((x) => x.h)) - Math.min(...acts.map((x) => x.h)) < 2 && acts.every((x) => x.in), 'it has New section, the size of Pause and Stop, inside the card', acts)
    await p.locator('.rec-menu button', { hasText: 'New section' }).click()
    ok(!!(await until(async () => (await api(`/meetings/${rec1.id}`)).sections.length === 3, 5000)), 'New section from the top bar')
    await p.mouse.move(900, 700)
    // The floating card, open: Pause on its bar (where it is closed too), New section and Stop under it.
    const f = await ctx.newPage()
    f.on('pageerror', (e) => errors.push(`card: ${e.message}`))
    await f.setViewportSize({ width: 360, height: 520 })
    await f.goto(`${kit.url}/?float=1`)
    await f.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
    await sleep(2500)
    await f.hover('.float-card .fc-head')
    await f.waitForSelector('.fc-acts', { timeout: 5000 }).catch(() => {})
    const fc = await f.evaluate(() => { const c = document.querySelector('.float-card').getBoundingClientRect(); return [...document.querySelectorAll('.fc-acts button, .fc-head button')].map((e) => ({ t: e.innerText.trim() || e.getAttribute('aria-label'), in: e.getBoundingClientRect().right <= c.right })) })
    ok(['Pause', 'New section', 'Stop'].every((t) => fc.some((x) => x.t === t)) && fc.every((x) => x.in), 'the card, open: Pause, New section and Stop, inside it', fc)
    said(rec1.id, [['you', 900, 'One more thing on the card.']])
    const fl = await until(async () => { const x = await f.locator('.fc-said-line.src-you', { hasText: 'One more thing' }).locator('b').allInnerTexts(); return x.length && x }, 8000)
    ok(!!fl && fl.join() === 'Tester', 'what you said, by your name', fl)
    await shot(f, `${tag}float-open`)
    await f.locator('.fc-head button[aria-label="Pause"]').click()
    ok(!!(await until(async () => /Paused/.test(await p.locator('.mt-recstate').innerText()), 5000)), 'Pause on the card pauses the recording')
    await f.locator('.fc-head button[aria-label="Resume"]').click()
    ok(!!(await until(async () => (await api(`/meetings/${rec1.id}`)).status === 'recording' && /Recording/.test(await p.locator('.mt-recstate').innerText()), 6000)), 'Resume from the card, here and on the server')
    await sleep(2200)
    await f.locator('.fc-acts button', { hasText: 'New section' }).click()
    ok(!!(await until(async () => (await api(`/meetings/${rec1.id}`)).sections.length === 4, 5000)), 'New section from the card')
    await f.close()
    // Watching a screen: a look at it as someone on the call starts talking, none while nobody
    // does or while the same person goes on, and none once the server wants no more.
    await p.locator('.mt-recbar button', { hasText: 'Watch a screen' }).click()
    ok(!!(await until(async () => (await p.locator('.mt-recbar button', { hasText: 'Capture' }).count()) === 1, 6000)), 'Watch a screen: watching, with Capture')
    await sleep(5000)
    ok(looks.length === 0, 'nobody on the call talking: no looks at it', looks)
    talking = 48000
    ok(!!(await until(() => looks.length === 1, 9000)) && looks[0].type === 'image/jpeg', 'someone starts talking: a look at it', looks)
    await sleep(6000)
    ok(looks.length === 1, 'not another while they go on', looks)
    lookReply = { kept: false, stop: 'unreadable' }
    talking = 96000
    ok(!!(await until(() => looks.length === 2, 9000)), 'someone else starts: another', looks)
    talking = 144000
    await sleep(7000)
    ok(looks.length === 2, 'none once the server says it can\'t read them', looks)
    await shot(p, `${tag}recording-watching`)
    await p.locator('.mt-recbar button', { hasText: 'Stop watching the screen' }).click()
    ok(!!(await until(async () => (await p.locator('.mt-recbar button', { hasText: 'Watch a screen' }).count()) === 1, 5000)), 'and it stops watching')
    talking = null
    // Record now while one records: asks, then stops that one and starts the next.
    await p.locator('.rail-nav-row .rail-rec').click()
    ok(await p.locator('.mt-dialog', { hasText: 'Record a new meeting?' }).isVisible().catch(() => false), 'while one records, it asks first')
    await p.locator('.mt-dialog button', { hasText: 'Stop it and record a new one' }).click()
    const rec2 = await until(async () => (await api('/meetings')).meetings.find((x) => x.status === 'recording' && x.id !== rec1.id), 10000)
    ok(!!rec2 && (await api(`/meetings/${rec1.id}`)).status !== 'recording', 'it stops that one and records a new one')
    await p.waitForSelector('.mt-recbar', { timeout: 8000 }).catch(() => {})
    await p.locator('.mt-recbar button', { hasText: 'Stop' }).click()
    await until(async () => !(await api('/meetings')).meetings.some((x) => x.status === 'recording'), 8000)
    if (rec2) await api(`/meetings/${rec2.id}`, { title: 'Follow-up chat' }, 'PATCH')
    await until(async () => (await row('Follow-up chat').count()) === 1 && (await p.locator('.rail-meetings .rm-row .rec-dot').count()) === 0, 12000)
  } else {
    skip('recording: Record now, New section, the top bar\'s menu, the floating card', `${which} has no fake mic`)
    rec1 = await api('/meetings', { title: 'Follow-up chat', call: false })
    await api(`/meetings/${rec1.id}/stop`, {})
    // Stopped through the server, so the sidebar knows at its next look (every 8 s).
    await until(async () => (await row('Follow-up chat').count()) === 1 && (await p.locator('.rail-meetings .rm-row .rec-dot').count()) === 0, 12000)
  }

  // ---------- Right-click in the sidebar: folders, the archive, deleting ----------
  const fid = (await api('/meetings')).meetings.find((x) => x.title === 'Follow-up chat')?.id
  await row('Follow-up chat').click({ button: 'right' })
  await p.waitForSelector('.ctx-menu', { timeout: 4000 }).catch(() => {})
  ok(await solid(p, '.ctx-menu'), 'the right-click menu is solid over the coloured sidebar')
  const items = await p.locator('.ctx-menu button').allInnerTexts()
  ok(['Open', 'Save as Markdown', 'Fix a word everywhere', 'Open Memory', 'Move to a folder…', 'Archive', 'Delete meeting…'].every((t) => items.includes(t)), 'right-click a meeting: its menu, with folders and the archive', items)
  await shot(p, `${tag}rail-menu`)
  await p.locator('.ctx-menu button', { hasText: 'Move to a folder…' }).click()
  ok((await p.locator('.mt-folder-opt').allInnerTexts()).map((x) => x.trim()).join('|') === 'Planning|Vendors', 'Move to a folder offers the folders in use', await p.locator('.mt-folder-opt').allInnerTexts())
  await p.locator('.mt-folder-new input').fill('Customers')
  await p.locator('.mt-folder-new button', { hasText: 'Move' }).click()
  ok(!!(await until(async () => (await p.locator('.rm-folder-head', { hasText: 'Customers' }).count()) === 1 && (await p.locator('.rail-meetings .rm-day:not(.rm-folder) .rm-row', { hasText: 'Follow-up chat' }).count()) === 0, 6000)), 'a new folder in the sidebar, closed, with the meeting in it')
  await p.locator('.rm-folder-head', { hasText: 'Vendors' }).click()
  await row('Vendor call').click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Archive' }).click()
  ok(!!(await until(async () => (await p.locator('.rm-folder-head', { hasText: 'Archived' }).count()) === 1, 6000)), 'archived: under Archived at the end')
  await p.locator('.rm-folder-head', { hasText: 'Customers' }).click()
  await row('Follow-up chat').click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Delete meeting…' }).click()
  const dlg = p.locator('.mt-dialog', { hasText: 'Delete this meeting?' })
  ok(/Follow-up chat goes, with its recording, transcript, notes and summary\. This can't be undone\./.test(await dlg.innerText().catch(() => '')), 'Delete warns first and says what goes', await dlg.innerText().catch(() => ''))
  await shot(p, `${tag}delete-warning`)
  await dlg.locator('button', { hasText: 'Cancel' }).click()
  ok(!!fid && (await api('/meetings')).meetings.some((x) => x.id === fid), 'Cancel keeps it')
  await row('Follow-up chat').click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Delete meeting…' }).click()
  await dlg.locator('.btn.danger').click()
  ok(!!(await until(async () => !(await api('/meetings')).meetings.some((x) => x.id === fid), 5000)), 'Delete deletes it')

  // ---------- The Meetings page ----------
  await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
  await p.waitForSelector('.mt-places', { timeout: 6000 }).catch(() => {})
  ok((await p.locator('.mt-places button').allInnerTexts()).map((x) => x.trim()).join('|') === 'All|Planning|Archived · 1', 'Meetings: All, each folder, Archived', await p.locator('.mt-places button').allInnerTexts())
  await p.locator('.mt-places button', { hasText: 'Archived' }).click()
  const archivedOne = !!(await until(async () => (await p.locator('.mt-row').count()) === 1, 4000))
  // Otherwise, what showed and what's saved: read from the meetings' files, as asking the server
  // for its list can turn Meeting Insights on by itself, which changes what comes after.
  const savedMeetings = () => fs.readdirSync(path.join(kit.data, 'meetings')).map((id) => { try { const x = JSON.parse(fs.readFileSync(path.join(kit.data, 'meetings', id, 'meeting.json'), 'utf8')); return `${x.title}${x.folder ? ` in ${x.folder}` : ''}${x.archived ? ', archived' : ''}` } catch { return null } }).filter(Boolean)
  ok(archivedOne, 'Archived lists the archived one', archivedOne ? undefined : { tab: await p.locator('.mt-view .seg [aria-selected="true"]').allInnerTexts(), places: await p.locator('.mt-places button').allInnerTexts(), on: await p.locator('.mt-places button.on').allInnerTexts(), rows: await p.locator('.mt-row').allInnerTexts(), saved: savedMeetings() })
  await p.locator('.mt-row-open', { hasText: 'Vendor call' }).click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Unarchive' }).click()
  ok(!!(await until(async () => (await p.locator('.mt-places button').allInnerTexts()).map((x) => x.trim()).join('|') === 'All|Planning|Vendors', 6000)), 'taken out of the archive from its menu')

  // Asking about your meetings: the answer's [1] opens the meeting it came from, and whatever else the
  // answer holds (a meeting's words can steer it) is cleaned: no styles, forms or picture scripts, no
  // links to other apps, and web links open outside.
  await p.locator('.mt-askall .mt-askbox input').fill('What ships when? hostile')
  await p.locator('.mt-askall .mt-askbox input').press('Enter')
  const answer = p.locator('.mt-askall .mt-a').first()
  await until(async () => /November third/.test(await answer.innerText().catch(() => '')), 15000)
  const got = await answer.evaluate((el) => ({
    cites: el.querySelectorAll('button.mt-cite').length, styled: el.querySelectorAll('style, [style]').length, forms: el.querySelectorAll('form, input').length,
    scripts: el.querySelectorAll('[onerror]').length, alt: el.querySelector('img')?.alt || null,
    tel: [...el.querySelectorAll('a')].filter((a) => /^tel:/i.test(a.getAttribute('href') || '')).length,
    web: [...el.querySelectorAll('a[href^="https:"]')].map((a) => `${a.target} ${a.rel}`), html: el.innerHTML.slice(0, 700),
  }))
  ok(got.cites === 1 && !got.styled && !got.forms && !got.scripts && /^\[1\] <img/.test(got.alt || '') && !got.tel && got.web.length === 1 && got.web[0] === '_blank noreferrer', 'an answer about your meetings is cleaned: its [1] opens the meeting, and styles, forms, picture scripts and app links are gone', got)

  // ---------- A meeting: its sections and who said what ----------
  await p.locator('.mt-places button', { hasText: 'Planning' }).click()
  await p.locator('.mt-row-open', { hasText: 'Quarterly plan' }).click()
  await p.waitForSelector('.mt-transcript .mt-sec', { timeout: 8000 }).catch(() => {})
  ok((await p.locator('.mt-transcript .mt-sec-name').allInnerTexts()).join('|') === 'Section 1|Demo|Q&A', 'the transcript has its sections', await p.locator('.mt-transcript .mt-sec-name').allInnerTexts())
  const all = await p.locator('.mt-transcript .mt-who').allInnerTexts()
  const whos = all.filter((x) => x !== 'Tester')
  ok(whos.join('|') === 'Dan Ruiz|Dan Ruiz|Priya Shah', 'the call\'s lines say who said them', whos)
  ok(all.filter((x) => x === 'Tester').length === 2 && !all.includes('You'), 'and yours, your name (Settings › General)', all)
  // Who spoke how much: each one's share of the time anyone talked, the most first.
  const talk = (await p.locator('.mt-talk-keys').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok(/Tester \d+%/.test(talk) && /Dan Ruiz \d+%/.test(talk) && /Priya Shah \d+%/.test(talk) && /^Tester 40% Dan Ruiz 40% Priya Shah 20%$/.test(talk.trim()), 'above the transcript: who spoke how much', talk)
  await p.locator('.mt-transcript .mt-who', { hasText: 'Dan Ruiz' }).first().click()
  await p.waitForSelector('.ctx-menu', { timeout: 4000 }).catch(() => {})
  const wi = await p.locator('.ctx-menu button').allInnerTexts()
  ok(['Priya Shah', 'Tester', 'Someone else…', 'Back to Them', 'Work out who said each line'].every((t) => wi.includes(t)), 'click a name: the people there, someone else, back to Them', wi)
  await p.locator('.ctx-menu button', { hasText: 'Someone else…' }).click()
  await p.locator('.mt-dialog input').fill('Sam Lee')
  await p.locator('.mt-dialog button', { hasText: 'Name them' }).click()
  ok(!!(await until(async () => (await p.locator('.mt-transcript .mt-who').allInnerTexts()).includes('Sam Lee'), 5000)), 'someone else, by name')
  await shot(p, `${tag}meeting-sections`)
  await p.locator('button[aria-label="More actions"]').click()
  await p.locator('.menu .menu-item', { hasText: 'Delete meeting…' }).click()
  ok(await p.locator('.mt-dialog', { hasText: 'Delete this meeting?' }).isVisible().catch(() => false), 'Delete asks first on a meeting\'s own menu too')
  await p.locator('.mt-dialog button', { hasText: 'Cancel' }).click()

  // ---------- A transcript cleaned up, AI Assist, suggestions and files you got for a meeting ----------
  const openMeeting = async (title) => {
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
    await p.locator('.mt-places button', { hasText: 'All' }).click()
    await p.locator('.mt-row-open', { hasText: title }).click()
  }
  // Controls a click at their middle doesn't reach (something else is on top of them).
  const covered = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => {
    const r = e.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return top && (top === e || e.contains(top) || top.contains(e)) ? null : `${e.getAttribute('aria-label') || e.className} under ${top ? top.className : 'nothing'}`
  }).filter(Boolean), sel)
  // A line the cleanup fixed says so, with Undo; one it left out is hidden and said, and shown on request.
  const L = await api('/meetings', { title: 'Launch review', call: false })
  await api(`/meetings/${L.id}/stop`, {})
  said(L.id, [['them', 1, 'We should demo bridge ay eye at the offsite.'], ['them', 6, 'Thanks for watching!'], ['you', 11, 'Good, and the phone app is ready for it too.']])
  await api(`/meetings/${L.id}/cleanup`, {})
  await openMeeting('Launch review')
  // The other side's lines: one Who spoke (it tells the voices apart, then names them), not two.
  ok(!!(await until(async () => (await p.locator('.mt-transcript .mt-thead button[aria-label="Who spoke"]').count()) === 1, 6000)), 'one Who spoke on a transcript with the other side in it, not two', await p.locator('.mt-transcript .mt-thead').innerText().catch(() => ''))
  const fixedLine = p.locator('.mt-transcript .mt-line', { hasText: 'demo Bridge AI at the offsite' })
  ok(!!(await until(() => fixedLine.isVisible(), 8000)) && /cleaned up/.test(await fixedLine.innerText()), 'a line the cleanup fixed shows the fix, marked cleaned up', await p.locator('.mt-transcript').innerText().catch(() => ''))
  ok(await p.locator('.mt-transcript .mt-line', { hasText: 'Thanks for watching' }).count() === 0 && /1 line left out by the cleanup/.test(await p.locator('.mt-transcript').innerText()), 'a line it left out is hidden, and said')
  await p.locator('.mt-transcript button', { hasText: 'Show them' }).click()
  const leftLine = p.locator('.mt-transcript .mt-line.dropped', { hasText: 'Thanks for watching' })
  ok(!!(await until(() => leftLine.isVisible(), 4000)) && /left out/.test(await leftLine.innerText()), 'Show them: there, marked left out')
  await shot(p, `${tag}meeting-cleaned`)
  await fixedLine.hover()
  await fixedLine.locator('button', { hasText: 'Undo' }).click()
  ok(!!(await until(async () => (await p.locator('.mt-transcript .mt-line', { hasText: 'demo bridge ay eye' }).count()) === 1, 6000)), 'Undo puts the line back as heard')
  // AI Assist at the right end of the header, before ⋯: what a model does for a finished meeting.
  const wand = p.locator('.mt-view .pane-head button[aria-label="AI Assist"]')
  ok(await wand.evaluate((e) => !!e.nextElementSibling?.classList.contains('menu-anchor') && !e.nextElementSibling.nextElementSibling), 'AI Assist at the right end of the meeting\'s header, with only ⋯ after it')
  await wand.click()
  const did = await p.locator('.ai-menu .ai-item-label').allInnerTexts()
  ok(['Write the summary', 'Clean up the transcript again', 'Ask about this meeting'].every((x) => did.includes(x)) && !did.includes('Suggest what to ask'), 'a finished meeting\'s AI Assist: the summary, the cleanup again, a question about it; no suggestions once it\'s over', did)
  await shot(p, `${tag}meeting-ai-menu`)
  await p.locator('.ai-menu button', { hasText: 'Ask about this meeting' }).click()
  ok(!!(await until(() => p.evaluate(() => !!document.activeElement?.closest?.('.mt-askbox')), 3000)), 'Ask about this meeting puts the cursor in its question box')
  await p.locator('button[aria-label="More actions"]').click()
  const more = await p.locator('.menu .menu-item').allInnerTexts()
  ok(!more.some((x) => /Clean up the transcript|Work out who|Make a deck/.test(x)) && more.some((x) => /Undo the cleanup/.test(x)), 'the ⋯ menu leaves what a model does to AI Assist', more)
  await p.keyboard.press('Escape')

  // ---------- Your notes while it records, then the summary and its action items ----------
  // A meeting recording (elsewhere): My notes stays in view beside what's picked. Once it ends, the
  // page leads with the summary, not what was picked while it recorded. Under the summary's action
  // items, Send action items to Chief of Staff, saying what it does; the header has no helm icon of
  // its own, and ⋯ says the same. Chief of Staff isn't running here, so they wait on its task list.
  const U = await api('/meetings', { title: 'Budget sync', call: false })
  said(U.id, [['you', 1, 'Let us look at the budget.'], ['them', 5, 'The beta ships on the third.']])
  await openMeeting('Budget sync')
  const notesBox = p.locator('.mt-cols.pinned .mt-mynotes .mt-mine')
  ok(!!(await until(() => notesBox.isVisible(), 8000)), 'a meeting recording in another window: My notes in view too')
  await p.locator('.seg button[data-view="assist"]').click()
  ok(await notesBox.isVisible() && await p.locator('.mt-cols.pinned .mt-assist').isVisible(), 'Suggestions picked: beside your notes, not instead of them')
  await p.locator('.seg button[data-view="transcript"]').click()
  await api(`/meetings/${U.id}/stop`, {})
  await until(async () => (await api(`/meetings/${U.id}`)).status === 'done', 10000)
  await api(`/meetings/${U.id}/summary`, {})
  ok(!!(await until(async () => (await p.locator('.seg button[data-view="summary"][aria-selected="true"]').count()) === 1 && (await p.locator('.mt-summary').count()) > 0, 15000)), 'once it ends, the page leads with the summary again', await p.locator('.seg button[aria-selected="true"]').getAttribute('data-view').catch(() => null))
  ok((await p.locator('.seg button[data-view="mine"]').count()) === 1 && (await p.locator('.mt-cols.pinned').count()) === 0, 'and My notes is a view of its own again')
  ok((await p.locator('.pane-head button[aria-label="To the chief"]').count()) === 0, 'the header has no helm icon of its own')
  const chiefRow = p.locator('.mt-chief')
  const order = await p.evaluate(() => [...document.querySelectorAll('.mt-summary h2, .mt-chief')].map((e) => (e.classList.contains('mt-chief') ? 'chief' : e.textContent.trim().toLowerCase())))
  ok(order.join('|') === 'summary|decisions|action items|chief|notes', 'Send action items to Chief of Staff is right under the action items', order)
  ok((await chiefRow.locator('button').innerText({ timeout: 5000 }).catch(() => '')).trim() === 'Send action items to Chief of Staff' && /Chief of Staff tracks them on its task list and follows up/.test(await chiefRow.innerText({ timeout: 5000 }).catch(() => '')), 'labelled, with a line on what Chief of Staff does with them', await chiefRow.innerText().catch(() => ''))
  await p.locator('button[aria-label="More actions"]').click()
  ok((await p.locator('.menu .menu-item', { hasText: 'Send action items to Chief of Staff' }).count()) === 1, 'the ⋯ menu says the same', await p.locator('.menu .menu-item').allInnerTexts())
  await p.keyboard.press('Escape')
  await chiefRow.locator('button').click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => /^2 action items are on Chief of Staff's task list\./.test(await p.locator('.mt-msg').innerText({ timeout: 1000 })) && /Sent to Chief of Staff on /.test(await chiefRow.innerText({ timeout: 1000 })), 8000)) && (await api(`/meetings/${U.id}`)).chief?.n === 2, 'sent: on its task list, and the meeting says when', [await p.locator('.mt-msg').innerText({ timeout: 1000 }).catch(() => ''), await chiefRow.innerText({ timeout: 1000 }).catch(() => '')])
  await shot(p, `${tag}meeting-chief`)
  ok(!!(await until(async () => (await p.locator('.mt-item .mt-went.chief').count()) === 2, 8000)) && /On Chief of Staff's task list/.test(await p.locator('.mt-item').first().innerText({ timeout: 1000 }).catch(() => '')), 'and each item says where it went', await p.locator('.mt-items').innerText().catch(() => ''))

  // ---------- Action items into work ----------
  // A project in git (gh a stand-in that knows one pull request), a stand-in Claude Code, and last
  // week's meeting about it. Each item has Start an agent and To Chief of Staff (the one that leads
  // fits the item); Start an agent picks the project the item names, says why, shows the branch and
  // what it will be told, and starts it in one more click; what became of each shows under it.
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await api('/agents/catalog')
  kit.program('gh', `const a = process.argv.slice(2)
if (a[0] === 'repo') { console.log('main'); process.exit(0) }
if (a[0] === 'pr' && a[1] === 'view') { console.log(JSON.stringify({ number: 212, state: 'OPEN', url: 'https://github.com/example/payments-api/pull/212', title: 'Retry the webhook', isDraft: false, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] })); process.exit(0) }
process.exit(1)`)
  const repo = path.join(kit.home, 'code', 'payments-api')
  fs.mkdirSync(repo, { recursive: true })
  const inRepo = (...a) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', ...a], { cwd: repo, encoding: 'utf8' })
  const madeRepo = inRepo('init', '-q').status === 0 && inRepo('commit', '-q', '--allow-empty', '-m', 'start').status === 0 && inRepo('remote', 'add', 'origin', 'https://github.com/example/payments-api.git').status === 0
  await api('/projects', { paths: [repo] })
  // Whether the server can use git here (on Windows the test's PATH has a git its server's doesn't).
  const hasGit = madeRepo && !!(await api(`/repo?dir=${encodeURIComponent(repo)}`).catch(() => ({}))).repo
  const W = await api('/meetings', { title: 'Weekly payments sync', call: false, event: { title: 'Weekly payments sync', attendees: ['Mia Chen', 'Ola Berg', 'Tester'] } })
  await api(`/meetings/${W.id}/stop`, {})
  await api(`/meetings/${W.id}`, { startedAt: new Date(Date.now() - 7 * 86400e3).toISOString() }, 'PATCH')
  said(W.id, [['them', 2, 'The Stripe webhook in payments-api retries forever when it gets a 500.'], ['you', 6, 'I can fix the retry this week, with a backoff.']])
  fs.writeFileSync(path.join(kit.data, 'meetings', W.id, 'summary.md'), '## Summary\n- Webhook retries and pricing.\n\n## Decisions\n- Retry with a backoff.\n\n## Action items\n- [ ] You: fix the retry on the Stripe webhook in payments-api\n- [ ] Mia: send the pricing doc to Acme\n- [ ] Ola: book the offsite venue\n')
  await openMeeting('Weekly payments sync')
  // In a smaller window the summary's tools wrap onto two lines, and every one of them still opens:
  // the summary under them used to cover the second line.
  await p.setViewportSize({ width: 1100, height: 700 })
  await until(async () => (await p.locator('.mt-notes .mt-tools select').count()) === 3, 6000)
  await p.waitForTimeout(400)
  const toolsHigh = await p.locator('.mt-notes .mt-tools').evaluate((e) => e.getBoundingClientRect().height).catch(() => 0)
  ok(!(await covered('.mt-notes .mt-tools select, .mt-notes .mt-tools button')).length && (await p.locator('.mt-notes .mt-tools select').count()) === 3, 'a smaller window: the summary\'s language, model and template can each be opened', { covered: await covered('.mt-notes .mt-tools select, .mt-notes .mt-tools button'), toolsHigh })
  await p.setViewportSize({ width: 1440, height: 900 })
  const item = (i) => p.locator('.mt-items .mt-item').nth(i)
  ok(!!(await until(async () => (await p.locator('.mt-items .mt-item').count()) === 3, 8000)), 'each action item on a line of its own', await p.locator('.mt-notes').innerText().catch(() => ''))
  const leads = await p.evaluate(() => [...document.querySelectorAll('.mt-items .mt-item')].map((li) => [...li.querySelectorAll('.mt-item-acts .btn')].map((b) => `${b.textContent.trim()}${b.classList.contains('lead') ? '*' : ''}`).join('|')))
  ok(leads[0] === 'Start an agent*|To Chief of Staff' && leads[2] === 'Start an agent|To Chief of Staff*', 'each with Start an agent and To Chief of Staff, one click each; code leads with the agent, the rest with Chief of Staff', leads)
  await item(0).locator('button', { hasText: 'Start an agent' }).click({ timeout: 5000 }).catch(() => {})
  const panel = item(0).locator('.mt-start')
  ok(!!(await until(async () => (await panel.locator('select[aria-label="Project"]').inputValue().catch(() => '')) === repo, 8000)), 'Start an agent: the project it names, picked', await panel.innerText().catch(() => ''))
  ok(/Named in this item/.test(await panel.locator('.mt-start-why').innerText().catch(() => '')), 'saying why', await panel.innerText().catch(() => ''))
  if (hasGit) ok(!!(await until(async () => /bridge\/fix-the-retry-on-the-stripe-webhook/.test(await panel.locator('.mt-start-own').innerText().catch(() => '')) && await panel.locator('.mt-start-own input').isChecked(), 8000)), 'on its own branch, named', await panel.innerText().catch(() => ''))
  else skip('on its own branch', 'the server has no git here')
  await panel.locator('summary', { hasText: 'What it will be told' }).click({ timeout: 5000 }).catch(() => {})
  ok(/fix the retry on the Stripe webhook/.test(await panel.locator('textarea').inputValue().catch(() => '')) && /What was said about it/.test(await panel.locator('textarea').inputValue().catch(() => '')), 'what it will be told, yours to change', await panel.locator('textarea').inputValue().catch(() => ''))
  await shot(p, `${tag}meeting-start-agent`)
  await panel.locator('button', { hasText: 'Start' }).first().click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => /^Started Fix the retry on the Stripe webhook in .*payments-api\. Open$/.test((await p.locator('.mt-msg').innerText({ timeout: 1000 })).trim()), 15000)), 'started, with Open', await p.locator('.mt-msg').innerText().catch(() => ''))
  const went0 = item(0).locator('.mt-item-went')
  ok(!!(await until(async () => /Claude Code in .*payments-api/.test(await went0.innerText({ timeout: 1000 })) && (!hasGit || /PR #212 · open · checks pass/.test(await went0.innerText({ timeout: 1000 }))), 20000)), 'what became of it, under it: the agent, and its pull request', await went0.innerText().catch(() => ''))
  await item(1).locator('button', { hasText: 'To Chief of Staff' }).click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => /On Chief of Staff's task list/.test(await item(1).innerText({ timeout: 1000 })), 8000)), 'To Chief of Staff: on its task list, and the item says so', await item(1).innerText().catch(() => ''))
  await item(2).locator('.mt-item-tick').check({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => /\bdone\b/.test(await item(2).getAttribute('class', { timeout: 1000 }).catch(() => '')), 8000)), 'ticked done', await item(2).getAttribute('class', { timeout: 1000 }).catch(() => ''))
  await shot(p, `${tag}meeting-items`)
  // Open: the agent it started.
  await item(0).locator('.mt-went.agent button', { hasText: 'Open' }).click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => (await p.locator('.tab-row .tab.on, .ws-tab.on, [role="tab"][aria-selected="true"]').filter({ hasText: 'Fix the retry' }).count()) > 0 || /Fix the retry/.test(await p.locator('.pane-head').first().innerText({ timeout: 500 }).catch(() => '')), 8000)), 'Open goes to the agent', await p.locator('.pane-head').first().innerText().catch(() => ''))

  // ---------- A meeting mentioned in the agent's message box ----------
  // @ and words of its name: the meeting, beside any files found; picked, @ and the file the agent
  // reads, with the meeting in it. With another key picked in Settings › Meetings: only meetings.
  const box = p.locator('.composer-stack textarea:visible').first()
  const menuText = () => p.locator('.mention-menu').innerText({ timeout: 1000 }).catch(() => '')
  await box.click({ timeout: 5000 }).catch(() => {})
  await box.fill('')
  await box.pressSequentially('see @weekly', { delay: 20 })
  const meetRow = p.locator('.mention-menu .slash-item', { hasText: 'Weekly payments sync' }).first()
  ok(await meetRow.waitFor({ timeout: 8000 }).then(() => true, () => false) && /meeting/i.test(await meetRow.innerText().catch(() => '')), 'typing @ and words of a meeting\'s name in an agent\'s message box: the meeting, marked as one', await menuText())
  await box.press('Enter')
  const val = await until(async () => { const v = await box.inputValue(); return /@"[^"]*Weekly payments sync\.md" $/.test(v) ? v : null }, 8000, 100)
  ok(!!val && /^see @"/.test(val), 'picked: @ and the file the agent reads, in place of what was typed', val || await box.inputValue())
  const refPath = val && /@"([^"]+)"/.exec(val)[1]
  const refText = refPath && fs.existsSync(refPath) ? fs.readFileSync(refPath, 'utf8') : ''
  ok(/^# Weekly payments sync\n/.test(refText) && /Attendees: Mia Chen, Ola Berg, Tester/.test(refText) && /## Summary/.test(refText) && /Retry with a backoff/.test(refText) && /## Transcript/.test(refText) && /Stripe webhook in payments-api retries forever/.test(refText), 'the file: when and who, the summary and action items, and the transcript', refText.slice(0, 400))
  await api('/settings', { meetings: { mentionKey: '#' } }, 'PATCH')
  await p.evaluate(() => window.dispatchEvent(new Event('bridge-settings')))
  await box.fill('')
  await box.pressSequentially('#', { delay: 20 })
  // Titled Meetings (what's in it), each row marked as a meeting.
  const keyRows = () => p.evaluate(() => [...document.querySelectorAll('.mention-menu .slash-item')].map((e) => ({ meeting: e.classList.contains('k-meeting'), title: e.querySelector('b').innerText.trim() })))
  ok(!!(await until(async () => { const r = await keyRows(); return /^Meetings$/.test(await p.locator('.mention-menu .slash-title').innerText().catch(() => '')) && r.length && r.every((x) => x.meeting) && r.some((x) => x.title === 'Weekly payments sync') }, 8000, 150)), 'with # picked in Settings › Meetings: # alone lists the latest meetings, under Meetings', await menuText())
  await box.fill('')
  await box.pressSequentially('see @weekly', { delay: 20 })
  await p.waitForTimeout(600)
  ok(!/Weekly payments sync/.test(await menuText()), 'and @ is for files only', await menuText())
  await box.fill('')
  await api('/settings', { meetings: { mentionKey: null } }, 'PATCH')

  // Since last time: the next one in the series, recording, says what became of last week's items.
  const W2 = await api('/meetings', { title: 'Weekly payments sync (Nov 7)', call: false, event: { title: 'Weekly payments sync', attendees: ['Mia Chen', 'Ola Berg', 'Tester'] } })
  await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id } })), W2.id)
  const sinceBox = p.locator('.mt-page .mt-since')
  ok(!!(await until(async () => /Since last time/.test(await sinceBox.innerText({ timeout: 1000 })) && /1 of 3 done/.test(await sinceBox.innerText({ timeout: 1000 })) && (!hasGit || /1 pull request open/.test(await sinceBox.innerText({ timeout: 1000 }))), 15000)), 'the next one in the series: since last time, in a line', await sinceBox.innerText().catch(() => ''))
  await sinceBox.locator('.mt-since-head').click({ timeout: 5000 }).catch(() => {})
  ok((await sinceBox.locator('.mt-since-item').count()) === 3 && /On Chief of Staff's task list/.test(await sinceBox.innerText({ timeout: 1000 }).catch(() => '')) && /ticked done/.test(await sinceBox.innerText({ timeout: 1000 }).catch(() => '')), 'opened: each item and where it went', await sinceBox.innerText().catch(() => ''))
  await shot(p, `${tag}meeting-since`)
  await api(`/meetings/${W2.id}/stop`, {})
  // Before it starts: the calendar's event on now (Pricing review, on a Mac) says it on its Take notes card.
  if (IS_MAC) {
    const PR = await api('/meetings', { title: 'Pricing review', call: false, event: { title: 'Pricing review', attendees: ['Priya Shah', 'Dan Ruiz', 'Tester'] } })
    await api(`/meetings/${PR.id}/stop`, {})
    await api(`/meetings/${PR.id}`, { startedAt: new Date(Date.now() - 3 * 86400e3).toISOString() }, 'PATCH')
    fs.writeFileSync(path.join(kit.data, 'meetings', PR.id, 'summary.md'), '## Action items\n- [ ] You: send Acme the new tiers\n- [ ] Priya: check the discount\n')
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click({ timeout: 5000 }).catch(() => {})
    const nextSince = p.locator('.mt-since-next')
    ok(!!(await until(async () => await p.locator('.mt-next', { hasText: 'Pricing review' }).isVisible() && /Since last time\s*0 of 2 done/.test(await nextSince.innerText({ timeout: 1000 })), 45000)), 'the event about to start: since last time, under its Take notes', await p.locator('.mt-home').innerText().catch(() => ''))
    await shot(p, `${tag}meetings-next-since`, { clip: { x: 0, y: 0, width: 1440, height: 420 } })
  } else skip('since last time on the Take notes card', 'the calendar is macOS Calendar')

  // While a meeting records: AI Assist's Suggest what to ask (ticked in its menu), the Suggestions
  // tab, Suggest now, ✓ into your notes; and a file you got for it
  // (on a Mac, once you ask to look: macOS asks first).
  fs.mkdirSync(path.join(kit.home, 'Downloads'), { recursive: true })
  fs.writeFileSync(path.join(kit.home, 'Downloads', 'Mara_Lind_Resume.pdf'), 'x')
  const I = await api('/meetings', { title: 'Interview - Mara Lind', call: false })
  said(I.id, [['them', 2, 'I moved our fleet to electric vans last year.']])
  await openMeeting('Interview - Mara Lind')
  await p.locator('.seg button[data-view="assist"]').click({ timeout: 5000 }).catch(() => {})
  await p.locator('.mt-assist-on input').click({ timeout: 5000 }).catch(() => {}) // on once the server says so
  ok(!!(await until(async () => (await api(`/meetings/${I.id}`)).assist === true && await p.locator('.mt-assist-on input').isChecked(), 5000)), 'the Suggestions tab turns Suggest what to ask on')
  await p.locator('.mt-view .pane-head button[aria-label="AI Assist"]').click()
  const live = await p.locator('.ai-menu').innerText()
  ok(/Suggest what to ask/.test(live) && await p.locator('.ai-menu [aria-checked="true"]', { hasText: 'Suggest what to ask' }).count() === 1 && !(await p.locator('.mt-recbar button', { hasText: /Assist/ }).count()), 'while it records, the meeting\'s AI Assist has Suggest what to ask, ticked; the recording bar has no switch of its own', live)
  await shot(p, `${tag}meeting-ai-menu-recording`)
  await p.keyboard.press('Escape')
  await p.locator('.mt-assist button', { hasText: 'Suggest now' }).click({ timeout: 5000 }).catch(() => {})
  const tip = p.locator('.mt-assist .mt-tip.k-question').first()
  ok(!!(await until(async () => (await p.locator('.mt-assist .mt-tip').count()) >= 2, 10000)) && /Ask what they hope/.test(await tip.innerText({ timeout: 1000 }).catch(() => '')) && /The invite/.test(await tip.innerText({ timeout: 1000 }).catch(() => '')), 'Suggest now: suggestions, each saying what to do and what it\'s from', { page: await p.locator('.mt-assist').innerText().catch(() => ''), server: await api(`/meetings/${I.id}`).then((x) => ({ items: x.assistItems, error: x.assistError, assist: x.assist, status: x.status })) })
  await tip.locator('button[aria-label="Add to my notes"]').click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => /In your notes/.test(await tip.innerText({ timeout: 1000 }).catch(() => '')), 5000)) && /Ask/.test((await api(`/meetings/${I.id}`)).notes || ''), '✓ puts it in your notes')
  const resume = p.locator('.mt-assist .mt-recent-file', { hasText: 'Mara_Lind_Resume.pdf' })
  if (IS_MAC) {
    const look = p.locator('.mt-assist .mt-recent-look button')
    ok(!!(await until(() => look.isVisible(), 6000)) && await resume.count() === 0, 'on a Mac, Downloads isn\'t looked in by itself: a button to look', await p.locator('.mt-assist').innerText().catch(() => ''))
    await look.click({ timeout: 5000 }).catch(() => {})
  }
  ok(!!(await until(() => resume.isVisible(), 8000)), 'the resume in Downloads is offered', await p.locator('.mt-assist').innerText().catch(() => ''))
  await shot(p, `${tag}meeting-assist`)
  // How often it suggests: a slider, Low to High, for every meeting; and the suggestions sorted.
  const level = p.locator('.mt-assist-level input')
  ok(await level.isVisible() && await level.inputValue() === '1' && /Medium/.test(await p.locator('.mt-assist-level').innerText()), 'How often: a slider, at Medium')
  await level.fill('2')
  ok(!!(await until(async () => (await api('/settings')).user?.meetings?.assistLevel === 'high', 5000)) && /High/.test(await p.locator('.mt-assist-level').innerText()) && /about every 30 seconds/.test(await p.locator('.mt-assist').innerText()), 'moved to High: kept for every meeting, and it says how often it looks', (await api('/settings')).user?.meetings)
  await level.fill('1')
  await until(async () => (await api('/settings')).user?.meetings?.assistLevel === 'medium', 5000)
  const tipTexts = () => p.locator('.mt-assist .mt-tip .mt-tip-text').allInnerTexts().catch(() => [])
  const newest = await tipTexts()
  await p.locator('.mt-assist-sort select').selectOption('old')
  ok(!!(await until(async () => JSON.stringify(await tipTexts()) === JSON.stringify([...newest].reverse()), 4000)), 'Sort: oldest first turns the list around', { newest, now: await tipTexts() })
  await p.locator('.mt-assist-sort select').selectOption('kind')
  ok(!!(await until(async () => /^Ask$/i.test((await p.locator('.mt-assist .mt-tip .mt-tip-kind').first().innerText().catch(() => '')).trim()), 4000)), 'Sort by kind: questions to ask first', await p.locator('.mt-assist .mt-tip .mt-tip-kind').allInnerTexts())
  await p.locator('.mt-assist-sort select').selectOption('new')
  // A short window: the columns keep room to read in, and the page scrolls instead.
  await p.setViewportSize({ width: 1100, height: 600 })
  await p.waitForTimeout(400)
  const colsHigh = await p.locator('.mt-page > .mt-cols').first().evaluate((e) => e.getBoundingClientRect().height).catch(() => 0)
  ok(colsHigh >= 239, 'a short window: Suggestions and your notes keep room to read in (the page scrolls)', { colsHigh })
  await p.setViewportSize({ width: 1440, height: 900 })
  await resume.locator('button', { hasText: 'Add' }).click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => ((await api(`/meetings/${I.id}`)).links || []).some((l) => /Mara_Lind_Resume\.pdf$/.test(l.path || '')), 5000)), 'Add links it to the meeting')
  await api(`/meetings/${I.id}/assist`, { on: false })
  await api(`/meetings/${I.id}/stop`, {})

  // ---------- Answers in AI Assist (a beta feature) ----------
  // An answer to a question raised, in Suggestions on a card of its own: the question as asked, who
  // asked it and when, the answer, and where it's from: a past meeting (a click opens it), the
  // model's own knowledge (which may be out of date; for one that needs current facts, how to add a
  // web search), the web with its pages, or a lookup that failed, saying why. ✓ puts it in your
  // notes, × waves it away. The floating card shows the newest, with its question and source.
  // Settings › Meetings says what it answers from and what goes where.
  await api('/settings', { trials: { 'assist-answers': true } }, 'PATCH')
  const PM = await api('/meetings', { title: 'Northwind pricing call', call: false })
  await api(`/meetings/${PM.id}/stop`, {})
  const VR = await api('/meetings', { title: 'Vendor review', call: false })
  await api(`/meetings/${VR.id}/assist`, { on: true })
  const ans = (o) => ({ kind: 'answer', state: 'new', why: '', model: 'openai:gpt-5', current: false, web: null, sources: [{ kind: 'general' }], ...o })
  fs.writeFileSync(path.join(kit.data, 'meetings', VR.id, 'assist.json'), JSON.stringify({ at: new Date().toISOString(), upTo: 0, error: null, items: [
    ans({ id: 'an1', t: 70, q: 'What did we agree on pricing with Northwind Traders last time?', asked: { who: 'You', text: 'And what did we agree on pricing with Northwind Traders last time?' }, text: 'Northwind Traders gets 20% off the Team plan for two years.', sources: [{ kind: 'meeting', id: PM.id, title: 'Northwind pricing call', startedAt: PM.startedAt }] }),
    ans({ id: 'an2', t: 130, q: "What's the difference between SOC 2 Type 1 and Type 2?", asked: { who: 'Them', text: "So what's the difference between SOC 2 Type 1 and Type 2?" }, text: 'Type 1 checks the controls at one point in time; Type 2 checks they worked over several months.' }),
    ans({ id: 'an3', t: 190, q: 'When does the EU AI Act start applying?', asked: { who: 'Them', text: 'When does the EU AI Act start applying?' }, text: 'Most of it applies from August 2026.', current: true, web: { state: 'off' } }),
    ans({ id: 'an4', t: 250, q: 'When does the new data law come into force?', asked: { who: 'Them', text: 'When does the new data law come into force?' }, text: 'Next spring, as far as the model knows.', current: true, web: { state: 'failed', via: 'Perplexity', error: 'Perplexity API (sonar-pro): Incorrect API key provided.' } }),
    ans({ id: 'an5', t: 310, q: 'What is the latest AI Act guidance for providers?', asked: { who: 'Priya Shah', text: 'What is the latest AI Act guidance for providers?' }, text: 'The guidance came out in July.[1]', general: 'Guidance was due.', current: true, sources: [{ kind: 'web', via: 'Perplexity', model: 'sonar-pro', links: [{ url: 'https://example.com/eu-ai-act', title: 'EU AI Act: the timeline' }] }], web: { state: 'done', via: 'Perplexity' } }),
  ] }))
  await openMeeting('Vendor review')
  await p.locator('.seg button[data-view="assist"]').click({ timeout: 5000 }).catch(() => {})
  const aCard = (q) => p.locator('.mt-assist .mt-tip.k-answer', { hasText: q })
  const cardText = (q) => aCard(q).innerText({ timeout: 1000 }).catch(() => '')
  ok(!!(await until(async () => (await p.locator('.mt-assist .mt-tip.k-answer').count()) === 5, 8000)), 'answers show in Suggestions, each on a card of its own', await p.locator('.mt-assist').innerText().catch(() => ''))
  const priceT = await cardText('agree on pricing')
  ok(/^answered/i.test(priceT.trim()) && /You asked/.test(priceT) && /What did we agree on pricing with Northwind Traders last time\?/.test(priceT) && /20% off the Team plan/.test(priceT) && /\b1:10\b/.test(priceT) && /Sources/.test(priceT) && /Northwind pricing call ·/.test(priceT), 'one from a past meeting: the question as asked, who asked it and when, the answer, and the meeting it\'s from', priceT)
  const socT = await cardText('SOC 2')
  ok(/Them asked/.test(socT) && /gpt-5's own knowledge, which may be out of date/.test(socT) && !/Perplexity|Model Providers/.test(socT), "a general one: from the model's own knowledge, said plainly, which may be out of date", socT)
  const euT = await cardText('EU AI Act start')
  ok(/add a Perplexity key in Settings › Model Providers/.test(euT) && await aCard('EU AI Act start').locator('button', { hasText: 'Open Model Providers' }).count() === 1, 'one that needs current facts, with no web search set up: says how to add one', euT)
  const webT = await cardText('latest AI Act guidance')
  const link = aCard('latest AI Act guidance').locator('a.mt-source')
  ok(/Priya Shah asked/.test(webT) && /The web, via Perplexity/.test(webT) && !/own knowledge/.test(webT) && await link.count() === 1 && await link.getAttribute('href') === 'https://example.com/eu-ai-act' && await link.getAttribute('target') === '_blank' && /noopener/.test(await link.getAttribute('rel') || '') && /EU AI Act: the timeline/.test(await link.innerText()), 'one looked up on the web: says so, with its page as a link that opens on its own', webT)
  ok(/Couldn't look it up on the web: Perplexity API \(sonar-pro\): Incorrect API key provided\./.test(await cardText('data law')), 'a lookup that failed says why', await cardText('data law'))
  await shot(p, `${tag}meeting-assist-answers`)
  await aCard('agree on pricing').scrollIntoViewIfNeeded().catch(() => {})
  await shot(p, `${tag}meeting-assist-answers-more`)
  await aCard('SOC 2').locator('button[aria-label="Add to my notes"]').click({ timeout: 5000 })
  ok(!!(await until(async () => /In your notes/.test(await cardText('SOC 2')), 5000)) && /^- \[2:10\] Answer: What's the difference between SOC 2 Type 1 and Type 2\? Type 1 checks/m.test((await api(`/meetings/${VR.id}`)).notes || ''), '✓ puts the answer in your notes, at the time it was asked, with its question', (await api(`/meetings/${VR.id}`)).notes)
  await aCard('latest AI Act guidance').locator('button[aria-label="Dismiss"]').click({ timeout: 5000 })
  ok(!!(await until(async () => (await aCard('latest AI Act guidance').count()) === 0, 5000)), '× waves it away')
  // The floating card: the newest still waiting, with its question and why it couldn't be looked up.
  const vrCalls = { watching: true, calls: [], detect: true, float: 'meetings', floatHover: true, prompt: null, recording: { id: VR.id, title: 'Vendor review', status: 'recording', startedAt: new Date(Date.now() - 60000).toISOString(), seconds: 60, callApps: [], callEnded: null, callEndedApp: null, stopsAt: null, callQuiet: false } }
  const fa = await page(b, kit.url, { before: async (c) => { await noServiceWorker(c); await c.route(/\/api\/calls(\?|$)/, (r) => r.fulfill({ json: vrCalls })) } })
  const acard = await fa.ctx.newPage()
  await acard.setViewportSize({ width: 360, height: 520 })
  await acard.goto(`${kit.url}/?float=1`)
  const atip = acard.locator('.float-card .fc-tip.k-answer')
  ok(!!(await until(async () => /data law/.test(await atip.locator('.fc-tip-q').innerText({ timeout: 1000 }).catch(() => '')), 8000)) && /Next spring/.test(await atip.locator('.fc-tip-text').innerText()) && /Couldn't look it up on the web/.test(await atip.locator('.fc-tip-from').innerText()), 'the floating card: the newest answer, under its question, and why it couldn\'t be looked up', await atip.innerText().catch(() => ''))
  await shot(acard, `${tag}meeting-answer-float`)
  await fa.ctx.close()
  // A click on the meeting it's from opens that meeting.
  await aCard('agree on pricing').locator('button.mt-source', { hasText: 'Northwind pricing call' }).click({ timeout: 5000 })
  ok(!!(await until(async () => (await p.locator('.mt-title').inputValue({ timeout: 1000 }).catch(() => '')) === 'Northwind pricing call', 5000)), 'a click on the meeting an answer is from opens it')
  // Settings › Meetings: what it answers from, what goes where, and how to add a web search.
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
  const st = p.locator('.st-meet [data-setting="assist-answers"]')
  ok(!!(await until(async () => /Answers in AI Assist/i.test(await st.innerText({ timeout: 1000 }).catch(() => '')) && /past meetings that may answer them, go to gpt-5 \(OpenAI\)/.test(await st.innerText().catch(() => '')) && /add a Perplexity key\. Only the question would go to Perplexity, never the transcript/.test(await st.innerText().catch(() => '')), 8000)), 'Settings › Meetings: what it answers from, what goes to the model, and that only the question would go to a web search', await st.innerText().catch(() => ''))
  await st.scrollIntoViewIfNeeded().catch(() => {})
  await shot(p, `${tag}meeting-answers-settings`)
  await p.keyboard.press('Escape')
  await api(`/meetings/${VR.id}/assist`, { on: false })
  await api(`/meetings/${VR.id}/stop`, {})
  await api('/settings', { trials: { 'assist-answers': false } }, 'PATCH')

  // ---------- AI Assist's live board (a beta feature) ----------
  // With it on in Beta Features, a recording meeting has a Board: off, it says what it does; its
  // switch turns it on and says plainly where what's said goes and who runs the model. Update now
  // fills it in, each part in its list, dashed as a suggestion; what's said after comes in by itself
  // (the board's minute is BRIDGE_BOARD_MS's 1.5 s here); Keep and Discard there, and on the board
  // itself, with the way back to its meeting; the floating card's one line, which opens it; after
  // the meeting, the summary's link and the action items onto the task list with a click; and
  // Settings › Meetings saying what it sends where. In light, dark and on a phone.
  await api('/settings', { trials: { 'meeting-board': true } }, 'PATCH')
  const boardMarks = (name) => { try { return JSON.parse(fs.readFileSync(path.join(kit.data, 'boards', `${name}.excalidraw`), 'utf8')).elements.filter((e) => e.type === 'rectangle' && e.customData?.bridge?.suggestion).length } catch { return -1 } }
  const boardText = (name) => { try { return JSON.parse(fs.readFileSync(path.join(kit.data, 'boards', `${name}.excalidraw`), 'utf8')).elements.map((e) => e.text || '').join('\n') } catch { return '' } }
  const LB = await api('/meetings', { title: 'Launch sync', call: false, event: { title: 'Launch sync', attendees: ['Priya Shah', 'Dan Ruiz', 'Tester'] } })
  said(LB.id, [['them', 2, 'We decided to ship the beta to ten customers first. Priya will send the pricing deck by Friday.'], ['you', 9, "Priya's beta ships on 24 Nov. Who owns the migration?"]])
  await openMeeting('Launch sync')
  const boardTab = p.locator('.seg button[data-view="board"]')
  ok(!!(await until(() => boardTab.isVisible(), 8000)), 'with the beta feature on, a recording meeting has a Board')
  await boardTab.click()
  const bp = p.locator('.mt-board')
  ok(!!(await until(async () => /AI Assist keeps a whiteboard of it from what's said/.test(await bp.innerText().catch(() => '')), 5000)) && !(await bp.locator('.mt-board-parts').count()), 'off, the Board says what it does, and there\'s no board', await bp.innerText().catch(() => ''))
  await bp.locator('.mt-assist-on input').click()
  ok(!!(await until(async () => (await api(`/meetings/${LB.id}`)).board === true && await bp.locator('.mt-assist-on input').isChecked(), 5000)), 'its switch turns the live board on for the meeting')
  ok(!!(await until(async () => /It uses the model that writes your notes, gpt-5 \(OpenAI\): what's said goes there as it comes, a minute or so at a time, with what's on the board\./.test(await bp.innerText()), 5000)), 'and says plainly where what\'s said goes, and who runs the model', await bp.innerText())
  await p.locator('.mt-view .pane-head button[aria-label="AI Assist"]').click()
  ok(await p.locator('.ai-menu [aria-checked="true"]', { hasText: 'Keep a live board' }).count() === 1, 'AI Assist\'s menu has it too, ticked')
  await p.keyboard.press('Escape')
  await bp.locator('button', { hasText: 'Update now' }).click()
  ok(!!(await until(async () => (await bp.locator('.mt-bitem.sug').count()) === 4, 10000)), 'Update now: the board fills in, each one a suggestion', await bp.innerText())
  const partText = (part) => bp.locator(`.mt-bpart.p-${part}`).innerText().catch(() => '')
  ok(/Ship the beta to ten customers first/.test(await partText('decision')) && /Beta ships · Priya · 24 Nov/.test(await partText('step')) && /Priya\s+Send the pricing deck · Friday/.test(await partText('action')) && /Who owns the migration\?/.test(await partText('question')), 'what was decided, the timeline with owner and date, who does what (by person) and the open question, each in its list', { d: await partText('decision'), s: await partText('step'), a: await partText('action'), q: await partText('question') })
  await shot(p, `${tag}meeting-board`)
  // What's said after comes in by itself: a line, the board's minute, and the page shows it.
  said(LB.id, [['them', 30, 'Dan will write the migration plan by Monday. We agreed to keep the old pricing for existing customers. The team went through the plan for the next two weeks in some detail.']])
  await send(LB.id, Buffer.concat([tone(2, true), tone(1.5)]))
  ok(!!(await until(async () => /Write the migration plan · Monday/.test(await partText('action')) && /Keep the old pricing/.test(await partText('decision')), 15000)), 'as more is said, the board fills in by itself, here as it does', await bp.innerText())
  const lbId = (await api(`/meetings/${LB.id}`)).liveBoard.id
  const decision = bp.locator('.mt-bitem', { hasText: 'Ship the beta to ten customers first' })
  await decision.locator('button[aria-label="Keep"]').click()
  ok(!!(await until(async () => /Kept/.test(await decision.innerText().catch(() => '')) && !(await decision.evaluate((e) => e.classList.contains('sug')).catch(() => true)), 5000)) && boardMarks(lbId) === 5, 'Keep: kept here, and on the board its mark comes off', boardMarks(lbId))
  const question = bp.locator('.mt-bitem', { hasText: 'Who owns the migration?' })
  await question.locator('button[aria-label="Discard"]').click()
  ok(!!(await until(async () => (await question.count()) === 0, 5000)) && !/Who owns the migration/.test(boardText(lbId)) && /No open questions yet/.test(await partText('question')), 'Discard: off the list, and off the board', boardText(lbId))
  // The floating card: one line, what's on the board, that opens it.
  const fcCalls = { watching: true, calls: [], detect: true, float: 'meetings', floatHover: true, prompt: null, recording: { id: LB.id, title: 'Launch sync', status: 'recording', startedAt: new Date(Date.now() - 60000).toISOString(), seconds: 60, callApps: [], callEnded: null, callEndedApp: null, stopsAt: null, callQuiet: false } }
  const fb = await page(b, kit.url, { before: async (c) => { await noServiceWorker(c); await c.route(/\/api\/calls(\?|$)/, (r) => r.fulfill({ json: fcCalls })) } })
  const fcard = await fb.ctx.newPage()
  await fcard.addInitScript(() => { window.bridgeApp = { floatOpen: async (o) => { window.__opened = o; return true } } })
  await fcard.setViewportSize({ width: 360, height: 520 })
  await fcard.goto(`${kit.url}/?float=1`)
  await fcard.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
  await fcard.hover('.float-card .fc-head')
  const fline = fcard.locator('.float-card .fc-board')
  ok(!!(await until(async () => /^Board: 2 decisions, 2 action items$/.test((await fline.innerText().catch(() => '')).trim()), 8000)), 'the floating card: one line, "Board: 2 decisions, 2 action items"', await fline.innerText().catch(() => ''))
  await shot(fcard, `${tag}meeting-board-float`)
  await fline.click()
  ok((await fcard.evaluate(() => window.__opened))?.board === lbId, 'which opens the board', await fcard.evaluate(() => window.__opened))
  await fb.ctx.close()
  // The board itself: the same suggestions, dashed with Keep and Discard, and a link back.
  await bp.locator('button', { hasText: 'Open the board' }).click()
  const sugTags = p.locator('.wb-sug-tag')
  ok(!!(await until(async () => (await sugTags.count()) === 4, 15000)), 'Open the board: the whiteboard, each suggestion outlined there with Keep and Discard', await sugTags.count())
  ok(await p.locator('.wb-view .wb-meeting').isVisible(), 'with the way back to its meeting')
  await sleep(800)
  await shot(p, `${tag}meeting-board-whiteboard`)
  await sugTags.first().locator('button', { hasText: 'Keep' }).click()
  ok(!!(await until(() => boardMarks(lbId) === 3, 8000)), 'Keep on the board itself: saved', boardMarks(lbId))
  await p.locator('.wb-view .wb-meeting').click()
  await boardTab.click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => (await bp.locator('.mt-bitem.sug').count()) === 3, 8000)), 'and the meeting\'s Board says so', await bp.locator('.mt-bitem.sug').count())
  // Dark, and on a phone.
  for (const look of [{ mode: 'dark', theme: 'midnight' }, { phone: true }]) {
    const x = await page(b, kit.url, look)
    if (look.phone) {
      await x.p.waitForSelector('.tabbar button', { timeout: 15000 })
      await x.p.locator('.tabbar button', { hasText: 'Meetings' }).click()
      await x.p.locator('.m-meetings .mt-row-open', { hasText: 'Launch sync' }).click()
    } else await until(async () => { await x.p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id } })), LB.id); return x.p.locator('.mt-title').isVisible() }, 10000, 1000)
    await x.p.locator('.seg button[data-view="board"]').click({ timeout: 8000 }).catch(() => {})
    await x.p.locator('.mt-board .mt-bitem').first().waitFor({ timeout: 8000 }).catch(() => {})
    if (look.phone) {
      await x.p.locator('.mt-board .mt-bpart.p-action').scrollIntoViewIfNeeded().catch(() => {})
      const faults = await phoneFaults(x.p, '.mt-board')
      ok(!Object.values(faults).some((v) => (Array.isArray(v) ? v.length : v > 0)), 'on a phone: the Board fits, its buttons big enough to tap', faults)
    } else ok(await x.p.locator('.mt-board .mt-bitem.sug').first().evaluate((e) => getComputedStyle(e).borderTopStyle === 'dashed').catch(() => false), 'dark: a suggestion is dashed here too')
    await shot(x.p, `${tag}meeting-board-${look.phone ? 'phone' : 'dark'}`)
    ok(x.errors.length === 0, `${look.phone ? 'phone' : 'dark'}: no page errors`, x.errors)
    await x.ctx.close()
  }
  // After the meeting: the board stays; the summary links to it, and its action items go onto the
  // task list with one click.
  await api(`/meetings/${LB.id}/stop`, {})
  await until(async () => !/Recording|Finishing/.test(await p.locator('.mt-view .mt-state').first().innerText({ timeout: 1000 }).catch(() => 'Recording')), 10000)
  await p.locator('.seg button[data-view="summary"]').click({ timeout: 8000 }).catch(() => {})
  const blink = p.locator('.mt-board-link')
  ok(!!(await until(async () => /Live board: 2 decisions, 2 action items/.test(await blink.innerText().catch(() => '')), 8000)), 'after it, the summary links to the board, in a few words', await blink.innerText().catch(() => ''))
  await blink.locator('button', { hasText: 'As lists' }).click()
  const toTasks = bp.locator('button', { hasText: 'Add 2 action items to Tasks' })
  ok(!!(await until(() => toTasks.isVisible(), 5000)), 'its action items, a click from the task list')
  await toTasks.click()
  ok(!!(await until(async () => { const tl = ((await api('/chief/tasks')).items || []).map((x) => x.title); return tl.includes('Priya: Send the pricing deck · Friday') && tl.includes('Dan: Write the migration plan · Monday') }, 5000)) && !!(await until(async () => (await bp.locator('.mt-bitem', { hasText: 'On the task list' }).count()) === 2, 5000)), 'Add to Tasks: on the Chief of Staff\'s task list, and each says so', await bp.innerText({ timeout: 1000 }).catch(() => ''))
  // On a phone after it: the views (the summary, the board, your notes, the transcript, the files)
  // still fit across, and the board stays.
  const ap = await page(b, kit.url, { phone: true })
  await ap.p.waitForSelector('.tabbar button', { timeout: 15000 })
  await ap.p.locator('.tabbar button', { hasText: 'Meetings' }).click()
  await ap.p.locator('.m-meetings .mt-row-open', { hasText: 'Launch sync' }).first().click()
  await ap.p.locator('.seg button[data-view="board"]').click({ timeout: 8000 }).catch(() => {})
  await ap.p.locator('.mt-board .mt-bitem').first().waitFor({ timeout: 8000 }).catch(() => {})
  const headFaults = await phoneFaults(ap.p, '.mt-view .pane-head')
  ok(!Object.keys(headFaults).length && await ap.p.locator('.mt-board .mt-bitem').count() === 5 && /Kept while the meeting recorded/.test(await ap.p.locator('.mt-board').innerText()), 'on a phone after it: the views still fit across, and the board is there', headFaults)
  await shot(ap.p, `${tag}meeting-board-after-phone`)
  await ap.ctx.close()
  // Settings › Meetings: on for every meeting, and what it sends where.
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
  const sb = p.locator('.st-meet [data-setting="meeting-board"]')
  ok(!!(await until(async () => /Keep a live board, in every meeting/.test(await sb.innerText().catch(() => '')) && /what's been said since and what's on the board go to gpt-5 \(OpenAI\)/.test(await sb.innerText().catch(() => '')), 8000)), 'Settings › Meetings: Live Board, on for every meeting or not, and what it sends where', await sb.innerText().catch(() => ''))
  await sb.scrollIntoViewIfNeeded().catch(() => {})
  await shot(p, `${tag}meeting-board-settings`)
  await p.keyboard.press('Escape')
  // The board open while the meeting adds to it: what it adds comes in by itself; and with an edit
  // of yours not saved yet (its save held back here), its new notes come in too, without asking
  // which to keep, and once saved the board has both.
  let holdSave = false
  const wx = await page(b, kit.url, { before: async (c) => { await noServiceWorker(c); await c.route(/\/api\/boards\/[^/?]+(\?|$)/, (r) => (r.request().method() === 'PUT' && holdSave ? r.fulfill({ status: 503, json: { error: 'held back' } }) : r.continue())) } })
  await until(async () => { if (await wx.p.locator('.excalidraw canvas.interactive').count()) return true; await wx.p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-board', { detail: { id } })), lbId); return false }, 30000, 1000)
  // How many suggestions wait on it, in sight or not: the count at its foot.
  const tagsNow = async () => Number(/^(\d+) suggestions/.exec((await wx.p.locator('.wb-sug-bar').innerText({ timeout: 1000 }).catch(() => '')).trim())?.[1] || 0)
  const t0 = await until(async () => { const n = await tagsNow(); return n > 0 && n }, 10000)
  said(LB.id, [['them', 120, 'Mia will update the status page by Friday. The team went through the plan for the next two weeks in some detail.']])
  await api(`/meetings/${LB.id}/board`, {})
  ok(!!t0 && !!(await until(async () => (await tagsNow()) === t0 + 1, 10000)), 'the board open while the meeting adds to it: what it adds comes in by itself', { t0, now: await tagsNow() })
  const wbox = await wx.p.locator('.wb-canvas').boundingBox()
  const wFrame = () => wx.p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const drawBox = async (x, y) => {
    await until(async () => { await wx.p.locator('[data-testid="toolbar-rectangle"]').click({ force: true }); return wx.p.locator('input[data-testid="toolbar-rectangle"]:checked').count() }, 5000, 200)
    await wx.p.mouse.move(x, y); await wFrame(); await wx.p.mouse.down(); await wFrame()
    for (let i = 1; i <= 4; i++) { await wx.p.mouse.move(x + i * 15, y + i * 8); await wFrame() }
    await wx.p.mouse.up(); await wFrame(); await wx.p.keyboard.press('Escape')
  }
  const handDrawn = () => { try { return JSON.parse(fs.readFileSync(path.join(kit.data, 'boards', `${lbId}.excalidraw`), 'utf8')).elements.filter((e) => e.type === 'rectangle' && !e.customData?.bridge?.meeting).length } catch { return -1 } }
  holdSave = true
  await drawBox(wbox.x + 40, wbox.y + wbox.height - 140)
  ok(!!(await until(() => wx.p.locator('.wb-state.bad').count(), 6000)), '(an edit on the board, its save held back)')
  said(LB.id, [['them', 140, 'Leo will order the launch swag by Tuesday. The team went through the plan for the next two weeks in some detail.']])
  await api(`/meetings/${LB.id}/board`, {})
  ok(!!(await until(async () => (await tagsNow()) === t0 + 2, 10000)) && !(await wx.p.locator('.wb-conflict').count()), 'with an edit not saved yet, what the meeting adds comes in too, without asking which to keep', { now: await tagsNow(), asked: await wx.p.locator('.wb-conflict').count() })
  holdSave = false
  await drawBox(wbox.x + 140, wbox.y + wbox.height - 140)
  ok(!!(await until(() => handDrawn() === 2 && /Leo: Order the launch swag/.test(boardText(lbId)), 10000)), 'and once it saves, the board has both: your edits and the meeting\'s notes', { handDrawn: handDrawn(), leo: /Leo/.test(boardText(lbId)) })
  ok(wx.errors.length === 0, 'the open board: no page errors', wx.errors)
  await wx.ctx.close()
  await api('/settings', { trials: { 'meeting-board': false }, meetings: { board: false } }, 'PATCH')

  // ---------- Who said what in a room ----------
  // A meeting with your mic only, its voices told apart (voices.json, as voices.js writes it): each
  // line says Speaker 1 or 2; clicking one offers who was invited and you, and names every line of
  // that voice at once. Who spoke is there on a room meeting; where the voices can't be told apart
  // it isn't. Settings › Meetings has Voices in a room. With no way to download the voice model
  // (nothing is reached here), Who spoke says why, with Try again.
  const V = await api('/meetings', { title: 'Design review', call: false, event: { title: 'Design review', attendees: ['Priya Shah', 'Dan Ruiz', 'Tester'] } })
  await api(`/meetings/${V.id}/stop`, {})
  said(V.id, [['you', 1, 'Let us look at the new onboarding.'], ['you', 5, 'The first screen asks too much.'], ['you', 9, 'Agreed, we can cut two fields.'], ['you', 13, 'I will mock it up by Friday.']])
  await until(async () => (await api(`/meetings/${V.id}`)).status === 'done', 8000)
  fs.writeFileSync(path.join(kit.data, 'meetings', V.id, 'voices.json'), JSON.stringify({ speakers: 2, line: { 'you:1': 1, 'you:5': 2, 'you:9': 1, 'you:13': 2 }, names: {}, at: new Date().toISOString(), model: 'voices' }))
  await openMeeting('Design review')
  await p.locator('.seg button[data-view="transcript"]').click({ timeout: 5000 }).catch(() => {})
  const roomWhos = () => p.locator('.mt-transcript .mt-line .mt-who').allInnerTexts().catch(() => [])
  ok(!!(await until(async () => (await roomWhos()).join('|') === 'Speaker 1|Speaker 2|Speaker 1|Speaker 2', 8000)), 'a room meeting: each line says which voice, Speaker 1 or 2', await roomWhos())
  // Who spoke waits for whether this computer can tell voices apart (/api/meetings/voices), which
  // comes after the meeting on a busy machine.
  const whoSpokeShown = !!(await until(() => p.locator('.mt-transcript .mt-voices-btn').isVisible(), 8000))
  ok(whoSpokeShown, 'and Who spoke is there for it')
  await p.locator('.mt-transcript .mt-line .mt-who', { hasText: 'Speaker 2' }).first().click({ timeout: 5000 }).catch(() => {})
  await p.waitForSelector('.ctx-menu', { timeout: 4000 }).catch(() => {})
  const voiceMenu = await p.locator('.menu .menu-item, .ctx-menu .menu-item, .ctx-menu button').allInnerTexts().catch(() => [])
  ok(['Priya Shah', 'Dan Ruiz', "That's me", 'Someone else…', 'Only this line…', 'Work out who each voice is'].every((x) => voiceMenu.some((y) => y.includes(x))) && !voiceMenu.some((y) => y.trim() === 'Tester'), 'clicking Speaker 2: who was invited, you, someone else, only this line, or the notes model', voiceMenu)
  await solid(p, '.ctx-menu')
  await shot(p, `${tag}room-speaker-menu`)
  await p.locator('.menu .menu-item, .ctx-menu .menu-item, .ctx-menu button', { hasText: 'Priya Shah' }).first().click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => (await roomWhos()).join('|') === 'Speaker 1|Priya Shah|Speaker 1|Priya Shah', 8000)), 'named once: every line of that voice', await roomWhos())
  ok(/Priya Shah said 2 lines\./.test(await p.locator('.mt-msg').innerText({ timeout: 2000 }).catch(() => '')), 'and it says how many', await p.locator('.mt-msg').innerText().catch(() => ''))
  await p.locator('.mt-transcript .mt-line .mt-who', { hasText: 'Speaker 1' }).first().click({ timeout: 5000 }).catch(() => {})
  await p.waitForSelector('.ctx-menu', { timeout: 4000 }).catch(() => {})
  await p.locator('.menu .menu-item, .ctx-menu .menu-item, .ctx-menu button', { hasText: "That's me" }).first().click({ timeout: 5000 }).catch(() => {})
  ok(!!(await until(async () => (await roomWhos()).join('|') === 'Tester|Priya Shah|Tester|Priya Shah', 8000)), "That's me: your lines, by your name", await roomWhos())
  await shot(p, `${tag}room-speakers`)
  // Who spoke on a room meeting not told apart yet: the voice model can't be downloaded here.
  const V2 = await api('/meetings', { title: 'Hallway chat', call: false })
  await api(`/meetings/${V2.id}/stop`, {})
  said(V2.id, [['you', 1, 'Quick one about the launch.'], ['you', 5, 'Sure, what is up?']])
  await until(async () => (await api(`/meetings/${V2.id}`)).status === 'done', 8000)
  await openMeeting('Hallway chat')
  await p.locator('.seg button[data-view="transcript"]').click({ timeout: 5000 }).catch(() => {})
  await p.locator('.mt-transcript .mt-voices-btn').click({ timeout: 5000 }).catch(() => {})
  const failed = p.locator('.mt-transcript .mt-hint', { hasText: "The voices weren't told apart" })
  ok(!!(await until(() => failed.isVisible(), 10000)) && await failed.locator('button', { hasText: 'Try again' }).isVisible(), 'Who spoke with no way to download the voice model: it says why, with Try again', await p.locator('.mt-transcript').innerText({ timeout: 1000 }).catch(() => ''))
  // Settings › Meetings: Voices in a room, under its Advanced (a link to Who Spoke opens it there).
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'who-spoke' } })))
  const sec = p.locator('.st-voices')
  const sectionShown = !!(await until(() => sec.isVisible(), 8000)) && /Tell voices apart in a room/.test(await sec.innerText()) && /Remember voices you name/.test(await sec.innerText()) && /ERes2Net, 26 MB, Apache-2\.0/.test(await sec.innerText())
  ok(sectionShown, 'Settings › Meetings: Voices in a room, with the model it uses and remembering voices', await sec.innerText().catch(() => ''))
  // Prepare for each meeting (where there's a calendar, a Mac) says where to ask for it, never naming Home, a beta
  // feature that's off here.
  if (IS_MAC) {
    // (In a line; all of it on hover.)
    const prep = await p.locator('.st-check', { hasText: 'Prepare for each meeting' }).locator('span[title]').first().getAttribute('title').catch(() => '')
    ok(/with AI Assist on the meeting in Calendar\./.test(prep) && !/Home/.test(prep) && !(await kit.api('/config')).trials.home, 'Settings › Meetings: Prepare for each meeting says AI Assist does it from the meeting in Calendar, and names no Home while Home is off', prep)
  }
  await sec.scrollIntoViewIfNeeded().catch(() => {})
  await shot(p, `${tag}settings-room-voices`)
  await p.keyboard.press('Escape')

  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()

  // Where voices can't be told apart (the server says so): no Who spoke on a room meeting, and no
  // Voices in a room in Settings.
  let askedVoices = 0
  const nv = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, before: async (c) => {
    await noServiceWorker(c)
    await c.route(/\/api\/meetings\/voices(\?|$)/, (r) => { askedVoices++; return r.fulfill({ json: { offered: false, why: 'sherpa-onnx needs glibc 2.32 or later', live: false, have: false } }) })
    await changeAnswer(c, /\/api\/speech(\?|$)/, (real) => ({ ...real, voices: { offered: false } }))
  } })
  await nv.p.waitForSelector('.rail-nav-row', { timeout: 15000 }).catch(() => {})
  await until(async () => { await nv.p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id } })), V2.id); return nv.p.locator('.mt-title').isVisible() }, 10000, 1000)
  await nv.p.locator('.seg button[data-view="transcript"]').click({ timeout: 5000 }).catch(() => {})
  await until(async () => (await nv.p.locator('.mt-transcript .mt-line').count()) === 2, 8000)
  await sleep(1500)
  ok(whoSpokeShown && askedVoices > 0 && (await nv.p.locator('.mt-transcript .mt-voices-btn').count()) === 0 && (await nv.p.locator('.mt-transcript .mt-line').count()) === 2, "where the voices can't be told apart (the server says so), a room meeting has no Who spoke", { askedVoices, text: await nv.p.locator('.mt-transcript').innerText().catch(() => '') })
  await nv.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
  await nv.p.waitForSelector('.st-meet', { timeout: 8000 }).catch(() => {})
  ok(sectionShown && (await nv.p.locator('.st-voices').count()) === 0 && (await nv.p.locator('.st-meet').count()) === 1 && nv.errors.length === 0, 'nor Voices in a room in Settings › Meetings (and no page errors)', nv.errors)
  await nv.ctx.close()

  // ---------- On a phone, while it records: a big My notes box, one tap away ----------
  // On the screen with the meeting, labelled; not focused by itself (the keyboard would cover the
  // meeting), and typed in after one tap; 16px, so iOS doesn't zoom into it; nothing wider than the phone.
  const N = await api('/meetings', { title: 'Phone notes', call: false })
  for (const [w, h] of [[375, 812], [430, 932]]) {
    const ph = await page(b, kit.url, { phone: true })
    await ph.p.setViewportSize({ width: w, height: h })
    await ph.p.waitForSelector('.tabbar button', { timeout: 15000 })
    await ph.p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    await ph.p.locator('.m-meetings .mt-row-open', { hasText: 'Phone notes' }).click()
    const nb = ph.p.locator('.m-meetings .mt-mynotes.pinned .mt-mine')
    await until(() => nb.isVisible(), 8000)
    const r = await nb.boundingBox({ timeout: 3000 }).catch(() => null)
    const look = await nb.evaluate((el) => ({ font: getComputedStyle(el).fontSize, label: el.closest('.mt-mynotes').querySelector('.mt-mynotes-name')?.innerText.trim(), focused: document.activeElement === el, wider: document.documentElement.scrollWidth - window.innerWidth }), null, { timeout: 3000 }).catch(() => ({}))
    ok(!!r && r.y + r.height <= h && r.height >= 120 && r.width >= w - 60 && look.label === 'My notes' && look.font === '16px', `${w}px: a big My notes box on the screen while it records`, { r, look })
    ok(!look.focused && look.wider <= 1, `${w}px: not focused by itself, and nothing wider than the phone`, look)
    await nb.tap({ timeout: 3000 }).catch(() => {})
    ok(!!(await until(() => nb.evaluate((el) => document.activeElement === el, null, { timeout: 1000 }), 3000)), `${w}px: one tap and you're writing`)
    await shot(ph.p, `${tag}phone-notes-${w}`)
    ok(ph.errors.length === 0, `${w}px: no page errors`, ph.errors)
    await ph.ctx.close()
  }
  await api(`/meetings/${N.id}/stop`, {})

  // ---------- On a phone: the action items and Start an agent fit ----------
  const ph = await page(b, kit.url, { phone: true })
  await ph.p.waitForSelector('.tabbar button', { timeout: 15000 })
  await ph.p.locator('.tabbar button', { hasText: 'Meetings' }).click({ timeout: 5000 }).catch(() => {})
  await ph.p.locator('.m-meetings .mt-row-open', { hasText: 'Weekly payments sync' }).filter({ hasNotText: 'Nov 7' }).first().click({ timeout: 5000 }).catch(() => {})
  const phItem = ph.p.locator('.mt-items .mt-item').nth(2)
  await until(() => phItem.isVisible(), 8000)
  await ph.p.locator('.mt-items .mt-item').nth(2).locator('.mt-item-tick').uncheck({ timeout: 5000 }).catch(() => {})
  await until(async () => (await phItem.locator('button', { hasText: 'Start an agent' }).count()) === 1, 8000)
  await phItem.locator('button', { hasText: 'Start an agent' }).click({ timeout: 5000 }).catch(() => {})
  await until(() => phItem.locator('.mt-start select').first().isVisible(), 8000)
  const fit = await ph.p.evaluate(() => { const r = document.querySelector('.mt-start')?.getBoundingClientRect(); return { right: r ? r.right : 999, wider: document.documentElement.scrollWidth - window.innerWidth } })
  ok(fit.right <= 390 && fit.wider <= 1, 'on a phone, the items and Start an agent fit the screen', fit)
  await shot(ph.p, `${tag}phone-start-agent`)
  ok(ph.errors.length === 0, 'phone: no page errors', ph.errors)
  await ph.ctx.close()

  // ---------- Dark ----------
  const d = await page(b, kit.url, { mode: 'dark', theme: 'midnight', store: { 'cc-rail-meetings': true, 'cc-rail-meeting-folders': { Planning: true } } })
  await d.p.waitForSelector('.rail-meetings .rm-row', { timeout: 8000 }).catch(() => {})
  await d.p.locator('.rail-meetings .rm-row').first().click({ button: 'right' })
  await d.p.waitForSelector('.ctx-menu', { timeout: 4000 }).catch(() => {})
  ok(await solid(d.p, '.ctx-menu'), 'dark: the menu is solid')
  await shot(d.p, `${tag}dark-menu`, { clip: { x: 0, y: 0, width: 700, height: 520 } })
  ok(d.errors.length === 0, 'dark: no page errors', d.errors)
  await d.ctx.close()

  // ---------- The floating card: its look, and a call with no sound ----------
  // Light, then switched to dark in the main window while the card is open: it follows. No border
  // (a shadow cut off at the window's edge made a hard dark line), only a hairline ring and a
  // shadow that fits the 12px around it. A recording whose call has been silent (macOS gives
  // silence until Bridge AI may hear it): a warning on the bar, and what to do when it opens.
  const recCalls = { watching: true, calls: [], detect: true, float: 'meetings', floatHover: true, prompt: null, recording: { id: A.id, title: 'Quarterly plan', status: 'recording', startedAt: new Date(Date.now() - 60000).toISOString(), seconds: 60, callApps: [], callEnded: null, callEndedApp: null, stopsAt: null, callQuiet: true, callAccess: 'denied' } }
  const fl = await page(b, kit.url, { mode: 'light', theme: 'sky', before: async (c) => {
    await noServiceWorker(c)
    await c.route(/\/api\/calls(\?|$)/, (r) => r.fulfill({ json: recCalls }))
  } })
  const card = await fl.ctx.newPage()
  card.on('pageerror', (e) => fl.errors.push(`card: ${e.message}`))
  // The desktop app's restart, stood in for: counted.
  await card.addInitScript(() => { window.bridgeApp = { restart: async () => { window.__restarts = (window.__restarts || 0) + 1; return true } } })
  await card.setViewportSize({ width: 360, height: 520 })
  await card.goto(`${kit.url}/?float=1`)
  await card.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
  const frame = await card.evaluate(() => { const c = getComputedStyle(document.querySelector('.float-card')); return { border: c.borderTopWidth, shadow: c.boxShadow } })
  ok(frame.border === '0px' && !/\b(1[3-9]|[2-9]\d)px\b/.test(frame.shadow.replace(/\b0px\b/g, '')), "the card has no border, and a shadow that fits its window", frame)
  const warn = card.locator('.float-card .fc-warn')
  ok(!!(await until(() => warn.isVisible(), 8000)), 'a call with no sound: a warning on the bar')
  await card.hover('.float-card .fc-head')
  const quiet = card.locator('.fc-quiet')
  ok(!!(await until(() => quiet.isVisible(), 5000)) && /No sound from the call/.test(await quiet.innerText()) && /System Audio Recording Only, the second list/.test(await quiet.innerText()) && /Screen Recording, above it, doesn't cover the sound/.test(await quiet.innerText()), "and, open, what to allow: System Audio Recording Only, the second list, which Screen Recording above it doesn't cover", await quiet.innerText().catch(() => ''))
  const bg = () => card.evaluate(() => { const m = getComputedStyle(document.querySelector('.float-card')).backgroundColor.match(/\d+/g).map(Number); return m[0] + m[1] + m[2] })
  ok((await bg()) > 600, '(the card is light in light mode)', await bg())
  await fl.p.evaluate(() => localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'dark', theme: 'midnight', text: 'm' })))
  ok(!!(await until(async () => (await card.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark' && (await bg()) < 200, 5000)), 'switched to dark in the main window: the open card follows', { theme: await card.evaluate(() => document.documentElement.getAttribute('data-theme')), bg: await bg() })
  await sleep(400) // its buttons' colours fade over
  await shot(card, `${tag}float-quiet-dark`)
  // On there and still quiet: the call's sound comes in once macOS lets it, else Restart Bridge AI
  // (quitting leaves the part that records running), which stops the recording, so it says so
  // first. Restarted and still quiet: Reset, for the call's sound alone.
  const qt = () => quiet.innerText().catch(() => '')
  // (macOS's lists: elsewhere a call's sound needs no allowing.)
  if (!IS_MAC) skip('once it\'s open there: already on there? macOS applies it once Bridge AI restarts, with Restart Bridge AI', 'System Audio Recording is macOS\'s')
  else {
  await quiet.locator('button', { hasText: 'Open it' }).click()
  const onThere = async () => /Already on there\? The call's sound comes in as soon as macOS lets it\. Still quiet\? Restart Bridge AI here: quitting leaves the part that records running\./.test(await qt()) && await quiet.locator('button', { hasText: 'Restart Bridge AI' }).count() === 1
  ok(!!(await until(onThere, 5000)), 'once it\'s open there: already on there? it comes in once macOS lets it, else Restart Bridge AI, as quitting leaves the part that records running', await qt())
  // Quit and opened again (macOS's own Quit & Reopen), which leaves the server as it was: still
  // that step, not back to Open it.
  await card.reload()
  await card.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
  await card.hover('.float-card .fc-head')
  ok(!!(await until(onThere, 8000)) && !(await quiet.locator('button', { hasText: 'Open it' }).count()), 'the card opened again with the server not restarted: still Restart Bridge AI, not Open it again', await qt())
  await quiet.locator('button', { hasText: 'Restart Bridge AI' }).click()
  ok(!!(await until(async () => /Restarting stops this recording/.test(await qt()) && await quiet.locator('button', { hasText: 'Restart now' }).count() === 1, 4000)) && !(await card.evaluate(() => window.__restarts)), 'a meeting records: it says a restart stops it, before restarting', await qt())
  await shot(card, `${tag}float-quiet-restart`)
  await quiet.locator('button', { hasText: 'Restart now' }).click()
  ok(!!(await until(() => card.evaluate(() => window.__restarts === 1), 4000)), 'Restart now restarts Bridge AI')
  }
  if (IS_MAC) {
    await kit.restart()
    await card.reload()
    await card.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
    await card.hover('.float-card .fc-head')
    ok(!!(await until(async () => /Still no sound since Bridge AI restarted/.test(await qt()) && await quiet.locator('button', { hasText: 'Reset and ask again' }).count() === 1, 10000)), 'restarted and still quiet: why, and Reset and ask again', await qt())
    await quiet.locator('button', { hasText: 'Reset and ask again' }).click()
    const tcc = () => { try { return fs.readFileSync(path.join(kit.bin, 'tcc.log'), 'utf8').trim() } catch { return '' } }
    // (Kept open: the card closes once the pointer has left it, as on a busy machine it can.)
    ok(!!(await until(async () => { await card.hover('.float-card .fc-head').catch(() => {}); return /macOS asks again in a moment: answer its window, and the call's sound comes in\./.test(await qt()) && tcc() === 'reset AudioCapture dev.bridge-ai.test' }, 8000)), "Reset forgets macOS's answer for the call's sound only (not Screen Recording), and macOS asks again while it records", { text: await qt(), tcc: tcc() })
  }
  // macOS lets Bridge AI hear the call, and it's silent: that's said, with nothing to turn on.
  recCalls.recording.callAccess = 'allowed'
  await card.reload()
  await card.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
  await card.hover('.float-card .fc-head')
  ok(!!(await until(async () => /macOS lets Bridge AI hear it, so nothing has played yet\. If people are talking, check the call's sound plays on this Mac\./.test(await qt()) && !(await quiet.locator('button').count()), 5000)) && (await warn.getAttribute('title')) === 'No sound from the call', "macOS lets Bridge AI hear it: the silence is the call's own, said, with nothing to turn on", await qt())
  recCalls.recording.callAccess = 'denied'
  // Open, with AI Assist's suggestion under the bar, on a short screen: the card asks for no more
  // than the screen's height, and what's under the bar scrolls, down to its last button.
  await api(`/meetings/${A.id}/assist`, { on: true })
  fs.writeFileSync(path.join(kit.data, 'meetings', A.id, 'assist.json'), JSON.stringify({ items: [{ id: 'fc1', t: 30, kind: 'question', text: 'Ask who signs off on the pilot budget, and by when they need the numbers.', why: 'Just said', state: 'new' }], at: new Date().toISOString(), upTo: 0, error: null }))
  const tall = await fl.ctx.newPage()
  tall.on('pageerror', (e) => fl.errors.push(`short card: ${e.message}`))
  await tall.addInitScript(() => { Object.defineProperty(screen, 'availHeight', { get: () => 400 }); window.__heights = []; window.bridgeApp = { floatSize: (w, h) => window.__heights.push(h) } })
  await tall.setViewportSize({ width: 360, height: 900 })
  await tall.goto(`${kit.url}/?float=1`)
  await tall.waitForSelector('.float-card .fc-tip', { timeout: 10000 }).catch(() => {})
  await tall.hover('.float-card .fc-head')
  await tall.waitForSelector('.float-card .fc-more', { timeout: 5000 }).catch(() => {})
  await sleep(500)
  const fits = await tall.evaluate(async () => {
    const more = document.querySelector('.float-card .fc-more')
    const card = document.querySelector('.float-card').getBoundingClientRect()
    if (!more) return { more: false }
    const scrolls = more.scrollHeight > more.clientHeight + 1
    more.scrollTop = more.scrollHeight
    await new Promise((r) => setTimeout(r, 100))
    const last = [...more.querySelectorAll('button')].pop()?.getBoundingClientRect()
    const box = more.getBoundingClientRect()
    return { more: true, scrolls, card: Math.round(card.height), asked: Math.max(...window.__heights), lastShown: !!last && last.bottom <= box.bottom + 1 && last.top >= box.top - 1, tip: !!document.querySelector('.float-card .fc-tip') }
  })
  ok(fits.more && fits.tip && fits.scrolls && fits.lastShown && fits.card + 24 <= 400 - 16 && fits.asked <= 400 - 16, 'open with AI Assist on a short screen: the card fits it (less the 8 points the desktop app leaves above and below), and what\'s under the bar scrolls to its last button', fits)
  // Opened taller than half the screen, it keeps the side it opened to, and tells the desktop app to
  // grow from its bar's side: a window as tall as asked (outerHeight) once moved its middle past the
  // screen's, and the card flipped. High on the screen it opens down; low, up.
  // 250 from the top: its bar above the middle, but opened (over 300 tall) the window's middle below it.
  for (const [top, low] of [[250, false], [560, true]]) {
    const side = await fl.ctx.newPage()
    side.on('pageerror', (e) => fl.errors.push(`card at ${top}: ${e.message}`))
    await side.addInitScript((top) => {
      window.__asked = []
      Object.defineProperty(screen, 'availHeight', { get: () => 800 })
      Object.defineProperty(window, 'screenY', { get: () => top })
      Object.defineProperty(window, 'outerHeight', { get: () => window.__asked.at(-1)?.h || 150 })
      window.bridgeApp = { floatSize: (w, h, low) => window.__asked.push({ h, low }) }
    }, top)
    await side.setViewportSize({ width: 360, height: 800 })
    await side.goto(`${kit.url}/?float=1`)
    await side.waitForSelector('.float-card .fc-tip', { timeout: 10000 }).catch(() => {})
    await side.hover('.float-card .fc-head')
    await side.waitForSelector('.float-card .fc-more', { timeout: 5000 }).catch(() => {})
    await sleep(600)
    const s = await side.evaluate(() => ({ up: document.querySelector('.float-card')?.classList.contains('up'), tallest: Math.max(...window.__asked.map((x) => x.h)), sides: [...new Set(window.__asked.map((x) => x.low))] }))
    ok(s.tallest > 300 && s.up === low && s.sides.length === 1 && s.sides[0] === low, `open with AI Assist, ${low ? 'low' : 'high'} on the screen: it opens ${low ? 'up' : 'down'} and stays so, the window growing from its bar's side`, s)
    await side.close()
  }
  await api(`/meetings/${A.id}/assist`, { on: false })
  // (Bridge AI restarting under the card cuts off what it was asking, which WebKit reports.)
  ok(withoutCutOff(fl.errors).length === 0, 'card: no page errors', fl.errors)
  await fl.ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
