// Meetings in the app, on any platform: Record now in the sidebar, My notes in view while it records
// (beside the transcript, and a big box on a phone), the summary first once it ends with Send action
// items to Chief of Staff under its action items, New section in the recording
// bar, the top bar's menu and the floating card (with Pause there), naming who said a line, the
// right-click menu, folders, the archive and deleting after a warning. The floating card following
// dark mode while it's open, its frame, and its warning when the call has no sound. The mic set for the room
// (no echo or noise handling, which drops the people around the table) with no call on the
// computer, and for a call while one is on. In Chromium with its fake
// mic; in WebKit (BRIDGE_TEST_BROWSER=webkit) the parts that record are skipped, since it has none.
// The meeting named after the calendar event on now is Mac-only (macOS Calendar). Watching a
// screen (a canvas, as the picker's answer) and the looks at it while someone on the call talks.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, checks, until, sleep, browser, page, shot, solid, noServiceWorker, IS_MAC } from '../lib/harness.mjs'

const { ok, skip, done } = checks('meetings-ui')
const kit = await startKit('meetings-ui')
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
    const sideBySide = async () => { const a = await box.boundingBox(), t = await p.locator('.mt-cols.pinned .mt-transcript').boundingBox(); return !!a && !!t && a.x + a.width <= t.x && a.height > 300 }
    ok(!!(await until(() => box.isVisible(), 8000)) && await sideBySide(), 'while it records, My notes is beside the transcript, the height of the page', await p.locator('.mt-cols').getAttribute('class').catch(() => null))
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
    // The floating card, open: Pause beside New section and Stop.
    const f = await ctx.newPage()
    f.on('pageerror', (e) => errors.push(`card: ${e.message}`))
    await f.setViewportSize({ width: 360, height: 520 })
    await f.goto(`${kit.url}/?float=1`)
    await f.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
    await sleep(2500)
    await f.hover('.float-card .fc-head')
    await f.waitForSelector('.fc-acts', { timeout: 5000 }).catch(() => {})
    const fc = await f.evaluate(() => { const c = document.querySelector('.float-card').getBoundingClientRect(); return [...document.querySelectorAll('.fc-acts button')].map((e) => ({ t: e.innerText.trim(), in: e.getBoundingClientRect().right <= c.right })) })
    ok(['Pause', 'New section', 'Stop'].every((t) => fc.some((x) => x.t === t)) && fc.every((x) => x.in), 'the card, open: Pause, New section and Stop, inside it', fc)
    said(rec1.id, [['you', 900, 'One more thing on the card.']])
    const fl = await until(async () => { const x = await f.locator('.fc-said-line.you', { hasText: 'One more thing' }).locator('b').allInnerTexts(); return x.length && x }, 8000)
    ok(!!fl && fl.join() === 'Tester', 'what you said, by your name', fl)
    await shot(f, `${tag}float-open`)
    await f.locator('.fc-acts button', { hasText: 'Pause' }).click()
    ok(!!(await until(async () => /Paused/.test(await p.locator('.mt-recstate').innerText()), 5000)), 'Pause on the card pauses the recording')
    await f.locator('.fc-acts button', { hasText: 'Resume' }).click()
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
  ok(['Open', 'Save as Markdown', 'Fix a word everywhere', 'Meeting memory', 'Move to a folder…', 'Archive', 'Delete meeting…'].every((t) => items.includes(t)), 'right-click a meeting: its menu, with folders and the archive', items)
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
  ok(!!(await until(async () => (await p.locator('.mt-row').count()) === 1, 4000)), 'Archived lists the archived one')
  await p.locator('.mt-row-open', { hasText: 'Vendor call' }).click({ button: 'right' })
  await p.locator('.ctx-menu button', { hasText: 'Take out of the archive' }).click()
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

  // ---------- A transcript cleaned up, AI Assist, and files you got for a meeting ----------
  const openMeeting = async (title) => {
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
    await p.locator('.mt-places button', { hasText: 'All' }).click()
    await p.locator('.mt-row-open', { hasText: title }).click()
  }
  // A line the cleanup fixed says so, with Undo; one it left out is hidden and said, and shown on request.
  const L = await api('/meetings', { title: 'Launch review', call: false })
  await api(`/meetings/${L.id}/stop`, {})
  said(L.id, [['them', 1, 'We should demo bridge ay eye at the offsite.'], ['them', 6, 'Thanks for watching!'], ['you', 11, 'Good, and the phone app is ready for it too.']])
  await api(`/meetings/${L.id}/cleanup`, {})
  await openMeeting('Launch review')
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
  ok(await notesBox.isVisible() && await p.locator('.mt-cols.pinned .mt-assist').isVisible(), 'Assist picked: beside your notes, not instead of them')
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

  // While a meeting records: the Assist tab, Suggest now, ✓ into your notes; and a file you got for it
  // (on a Mac, once you ask to look: macOS asks first).
  fs.mkdirSync(path.join(kit.home, 'Downloads'), { recursive: true })
  fs.writeFileSync(path.join(kit.home, 'Downloads', 'Mara_Lind_Resume.pdf'), 'x')
  const I = await api('/meetings', { title: 'Interview - Mara Lind', call: false })
  said(I.id, [['them', 2, 'I moved our fleet to electric vans last year.']])
  await openMeeting('Interview - Mara Lind')
  await p.locator('.seg button[data-view="assist"]').click()
  await p.locator('.mt-assist-on input').click() // on once the server says so
  ok(!!(await until(async () => (await api(`/meetings/${I.id}`)).assist === true && await p.locator('.mt-assist-on input').isChecked(), 5000)), 'the Assist tab turns AI Assist on')
  await p.locator('.mt-assist button', { hasText: 'Suggest now' }).click()
  const tip = p.locator('.mt-assist .mt-tip.question').first()
  ok(!!(await until(async () => (await p.locator('.mt-assist .mt-tip').count()) >= 2, 10000)) && /Ask what they hope/.test(await tip.innerText()) && /The invite/.test(await tip.innerText()), 'Suggest now: suggestions, each saying what to do and what it\'s from', { page: await p.locator('.mt-assist').innerText().catch(() => ''), server: await api(`/meetings/${I.id}`).then((x) => ({ items: x.assistItems, error: x.assistError, assist: x.assist, status: x.status })) })
  await tip.locator('button[aria-label="Add to my notes"]').click()
  ok(!!(await until(async () => /In your notes/.test(await tip.innerText()), 5000)) && /Ask/.test((await api(`/meetings/${I.id}`)).notes || ''), '✓ puts it in your notes')
  const resume = p.locator('.mt-assist .mt-recent-file', { hasText: 'Mara_Lind_Resume.pdf' })
  if (IS_MAC) {
    const look = p.locator('.mt-assist .mt-recent-look button')
    ok(!!(await until(() => look.isVisible(), 6000)) && await resume.count() === 0, 'on a Mac, Downloads isn\'t looked in by itself: a button to look', await p.locator('.mt-assist').innerText().catch(() => ''))
    await look.click()
  }
  ok(!!(await until(() => resume.isVisible(), 8000)), 'the resume in Downloads is offered', await p.locator('.mt-assist').innerText().catch(() => ''))
  await shot(p, `${tag}meeting-assist`)
  await resume.locator('button', { hasText: 'Add' }).click()
  ok(!!(await until(async () => ((await api(`/meetings/${I.id}`)).links || []).some((l) => /Mara_Lind_Resume\.pdf$/.test(l.path || '')), 5000)), 'Add links it to the meeting')
  await api(`/meetings/${I.id}/assist`, { on: false })
  await api(`/meetings/${I.id}/stop`, {})

  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()

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
  const recCalls = { watching: true, calls: [], detect: true, float: 'meetings', floatHover: true, prompt: null, recording: { id: A.id, title: 'Quarterly plan', status: 'recording', startedAt: new Date(Date.now() - 60000).toISOString(), seconds: 60, callApps: [], callEnded: null, callEndedApp: null, stopsAt: null, callQuiet: true } }
  const fl = await page(b, kit.url, { mode: 'light', theme: 'sky', before: async (c) => {
    await noServiceWorker(c)
    await c.route(/\/api\/calls(\?|$)/, (r) => r.fulfill({ json: recCalls }))
  } })
  const card = await fl.ctx.newPage()
  card.on('pageerror', (e) => fl.errors.push(`card: ${e.message}`))
  await card.setViewportSize({ width: 360, height: 520 })
  await card.goto(`${kit.url}/?float=1`)
  await card.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
  const frame = await card.evaluate(() => { const c = getComputedStyle(document.querySelector('.float-card')); return { border: c.borderTopWidth, shadow: c.boxShadow } })
  ok(frame.border === '0px' && !/\b(1[3-9]|[2-9]\d)px\b/.test(frame.shadow.replace(/\b0px\b/g, '')), "the card has no border, and a shadow that fits its window", frame)
  const warn = card.locator('.float-card .fc-warn')
  ok(!!(await until(() => warn.isVisible(), 8000)), 'a call with no sound: a warning on the bar')
  await card.hover('.float-card .fc-head')
  const quiet = card.locator('.fc-quiet')
  ok(!!(await until(() => quiet.isVisible(), 5000)) && /No sound from the call/.test(await quiet.innerText()) && /System Audio Recording Only/.test(await quiet.innerText()), 'and, open, what to allow', await quiet.innerText().catch(() => ''))
  const bg = () => card.evaluate(() => { const m = getComputedStyle(document.querySelector('.float-card')).backgroundColor.match(/\d+/g).map(Number); return m[0] + m[1] + m[2] })
  ok((await bg()) > 600, '(the card is light in light mode)', await bg())
  await fl.p.evaluate(() => localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'dark', theme: 'midnight', text: 'm' })))
  ok(!!(await until(async () => (await card.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark' && (await bg()) < 200, 5000)), 'switched to dark in the main window: the open card follows', { theme: await card.evaluate(() => document.documentElement.getAttribute('data-theme')), bg: await bg() })
  await sleep(400) // its buttons' colours fade over
  await shot(card, `${tag}float-quiet-dark`)
  ok(fl.errors.length === 0, 'card: no page errors', fl.errors)
  await fl.ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
