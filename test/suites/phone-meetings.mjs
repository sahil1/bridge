// Meetings on a phone, in the browser named by BRIDGE_TEST_BROWSER: their own tab, recording from
// it (Chromium's fake mic; WebKit has none, so it checks the tab and the list), the screen kept on
// while it records, and the recording carrying on after the phone was locked (the page hidden and its
// sound stopped for a while) and after the mic was let go, saying how long wasn't recorded. Then its
// transcript, from the stand-in speech service.
//
// Then every meeting screen fits a phone, 375 px wide in a light theme and 430 px in a dark one: the
// list; a meeting recording from the phone (the recording bar, My notes, the transcript with a
// section, AI Assist and its suggestions); a finished one (the summary and its choices, the action
// items with Start an agent open, Written from, the transcript with a line tapped, the ⋯ menu); and a
// room's speakers named from a list. On each: nothing wider than the phone or past its edge, nothing
// scrolling sideways or cut off, every button, link, tick and field a whole 40 px target that
// nothing covers, and fields at 16 px (iOS zooms into a smaller one). The header is the name and the
// views; when, who and where it's saved are at the top of the page; a finished meeting is one page
// that scrolls, with Ask under it; a meeting fills the tab. WebKit records too here, from a tone
// standing in for its mic.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults } from '../lib/harness.mjs'

const { ok, skip, done } = checks('phone-meetings')
const kit = await startKit('phone-meetings')
const model = await startModel('phone-meetings')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
// What a phone does to a page, made to happen on cue: hidden (locked, or another app in front), and
// its sound stopped meanwhile. Also counts the screen being kept on and the mic being asked for.
const phoneHooks = () => {
  window.__hidden = false
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__hidden })
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') })
  window.__acs = []
  const A = window.AudioContext
  if (A) window.AudioContext = class extends A { constructor(...a) { super(...a); window.__acs.push(this) } }
  window.__streams = []
  const md = navigator.mediaDevices
  if (md?.getUserMedia) { const gum = md.getUserMedia.bind(md); md.getUserMedia = async (c) => { const s = await gum(c); window.__streams.push(s); return s } }
  window.__locks = 0
  if (navigator.wakeLock) navigator.wakeLock.request = async () => { window.__locks++; const l = new EventTarget(); l.release = async () => {}; return l }
}
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false } }, 'PATCH')

  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.theme
    const { ctx, p, errors } = await page(b, kit.url, { ...look, phone: true, before: (c) => c.addInitScript(phoneHooks) })
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    const tabs = (await p.locator('.tabbar button').allInnerTexts()).map((x) => x.trim())
    ok(tabs.join('|') === 'Chief|Agents|Meetings|Today|More', `${t}: Meetings is a tab of its own`, tabs)
    await p.locator('.tabbar button', { hasText: 'Agents' }).click()
    ok((await p.locator('.m-acts button', { hasText: 'Meetings' }).count()) === 0, `${t}: and no longer a button inside Agents`)
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    const startBtn = p.locator('.m-meetings button', { hasText: 'Start recording' })
    ok(!!(await until(() => startBtn.isVisible(), 10000)), `${t}: the Meetings tab opens on the meetings, with Start recording`)
    ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${t}: nothing wider than the phone`)
    await shot(p, `${tag}phone-meetings-${t}`)
    if (which === 'webkit' || look.mode === 'dark') {
      if (which === 'webkit') skip(`${t}: recording on the phone`, "WebKit in the tests has no fake microphone")
      ok(errors.length === 0, `${t}: no page errors`, errors)
      await ctx.close()
      continue
    }

    // Recording, from the tab.
    await startBtn.click()
    ok(!!(await until(() => p.locator('.m-meetings .mt-recbar').isVisible(), 15000)), 'Start recording: the meeting opens in the same tab, recording')
    const id = (await kit.api('/meetings')).meetings.find((x) => x.status === 'recording')?.id
    ok(!!id, 'the server has it recording')
    ok(await p.evaluate(() => window.__locks) >= 1, 'the screen is kept on while it records')
    ok(await p.locator('.tabbar .badge.rec').isVisible(), 'the Meetings tab shows a recording dot')
    ok(/Keep Bridge AI in front while it records/.test(await p.locator('.mt-recbar').innerText()), 'and it says to keep the app in front')
    const seconds = async () => (await kit.api(`/meetings/${id}`)).seconds || 0
    ok(!!(await until(async () => (await seconds()) >= 5, 15000)), 'its sound reaches the computer', await seconds())

    // Locked for a while: hidden, the sound stopped. Then back.
    await p.evaluate(async () => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); await Promise.all(window.__acs.map((c) => c.suspend())) })
    await sleep(6000)
    await p.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    const missed = await until(async () => { const x = await p.locator('.mt-missed').innerText().catch(() => ''); return x || null }, 10000)
    ok(/^Not recorded: \d+ seconds, while the phone was locked or another app was in front/.test(missed || ''), 'back from the lock: it carries on, and says what wasn\'t recorded', missed)
    ok(await p.evaluate(() => window.__acs.every((c) => c.state === 'running' || c.state === 'closed')), 'its sound runs again')
    ok(await p.evaluate(() => window.__locks) >= 2, 'and the screen is kept on again')
    const before = await seconds()
    ok(!!(await until(async () => (await seconds()) >= before + 5, 15000)), 'and its sound reaches the computer again', { before, now: await seconds() })

    // The mic let go (another app took it): asked for again, and the recording goes on.
    await p.evaluate(() => { const t = window.__streams.at(-1).getAudioTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')) })
    ok(!!(await until(() => p.evaluate(() => window.__streams.length >= 2), 10000)), 'a mic that was let go is asked for again')
    const before2 = await seconds()
    ok(!!(await until(async () => (await seconds()) >= before2 + 5, 15000)), 'and the recording goes on with it', { before2, now: await seconds() })

    // Stop: the transcript, from the stand-in speech service.
    await p.locator('.mt-recbar button', { hasText: 'Stop' }).click()
    const m = await until(async () => { const x = await kit.api(`/meetings/${id}`); return x.status === 'done' && x }, 60000, 1000)
    ok(!!m, 'stopped, it\'s transcribed', (await kit.api(`/meetings/${id}`)).status)
    await p.locator('.m-meetings [role="tab"][data-view="transcript"]').click()
    ok(!!(await until(async () => /Service transcript/.test(await p.locator('.m-meetings .mt-transcript').innerText()), 15000)), 'and its transcript shows in the tab')
    ok(!(await p.locator('.tabbar .badge.rec').count()), 'the recording dot goes')
    await shot(p, `${tag}phone-meeting-done`)
    // Back: the meetings, still in the Meetings tab.
    await p.locator('.m-meetings .mt-back, .m-meetings button[aria-label="Back"], .m-meetings button:has-text("Meetings")').first().click().catch(() => {})
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    ok(!!(await until(() => p.locator('.m-meetings button', { hasText: 'Start recording' }).isVisible(), 8000)), 'the tab goes back to the meetings')
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- every meeting screen fits a phone ----------
  const RATE = 16000
  let seq = 0
  const said = (id, rows) => fs.appendFileSync(path.join(kit.data, 'meetings', id, 'transcript.jsonl'), rows.map(([src, t0, text]) => JSON.stringify({ src, t0, t1: t0 + 3, text, engine: 'test' })).join('\n') + '\n')
  const ended = async (id) => until(async () => (await kit.api(`/meetings/${id}`)).status === 'done', 20000)
  for (const [title, folder] of [['Quarterly planning with the platform and design teams', 'Planning'], ['Vendor call', 'Vendors and partners'], ['Old retro', null]]) {
    const m = await kit.api('/meetings', { title, call: false, event: { title, attendees: ['Priya Shah', 'Dan Ruiz', 'Tester', 'Mia Chen'] } })
    await kit.api(`/meetings/${m.id}/stop`, {})
    await kit.api(`/meetings/${m.id}`, folder ? { folder } : { archived: true }, 'PATCH')
  }
  // A finished call (its summary as the notes model writes one, with three action items) and a room
  // whose two voices were told apart, for each look, so naming a voice in one leaves the next as it was.
  const finished = async (n) => {
    const m = await kit.api('/meetings', { title: `Weekly payments sync ${n}`, call: false, event: { title: 'Weekly payments sync', attendees: ['Priya Shah', 'Dan Ruiz', 'Tester'] } })
    await fetch(`${kit.url}/api/meetings/${m.id}/audio?src=you&seq=${seq++}`, { method: 'POST', body: Buffer.alloc(RATE * 2 * 3) })
    await kit.api(`/meetings/${m.id}/stop`, {})
    said(m.id, [['you', 1, 'Let us start with the webhook retries.'], ['them', 4, 'The Stripe webhook drops about one in a hundred events when the queue is busy, and nobody gets told.'], ['you', 8, 'Then retry with a backoff, and page us after three tries.'], ['them', 12, 'Priya can take the discount check before Friday.']])
    await ended(m.id)
    await kit.api(`/meetings/${m.id}/notes`, { text: 'retries: backoff\ntiers to Acme', base: '' }, 'PUT')
    await kit.api(`/meetings/${m.id}/summary`, {})
    await until(async () => (await kit.api(`/meetings/${m.id}`)).summaryFrom, 20000)
    fs.writeFileSync(path.join(kit.data, 'meetings', m.id, 'summary.md'), '## Summary\n- Webhook retries drop about one event in a hundred under load; the fix is a retry with a backoff.\n- Acme gets the new pricing tiers this week.\n\n## Decisions\n- Retry with a backoff and page after three tries.\n\n## Action items\n- [ ] You: fix the retry on the Stripe webhook in payments-api (by Friday)\n- [ ] You: send Acme the new tiers\n- [ ] Priya: check the discount for the annual plan\n\n## Notes\n- Design review done.\n')
    const r = await kit.api('/meetings', { title: `Design review ${n}`, call: false, event: { title: 'Design review', attendees: ['Priya Shah', 'Dan Ruiz', 'Tester'] } })
    await kit.api(`/meetings/${r.id}/stop`, {})
    said(r.id, [['you', 1, 'Let us look at the new onboarding.'], ['you', 5, 'The first screen asks too much.'], ['you', 9, 'Agreed, we can cut two fields.'], ['you', 13, 'I will mock it up by Friday.']])
    await ended(r.id)
    fs.writeFileSync(path.join(kit.data, 'meetings', r.id, 'voices.json'), JSON.stringify({ speakers: 2, line: { 'you:1': 1, 'you:5': 2, 'you:9': 1, 'you:13': 2 }, names: {}, at: new Date().toISOString(), model: 'voices' }))
    return { done: m.title, room: r.title }
  }
  // WebKit in the tests has no microphone: a tone stands in for one.
  const toneMic = () => {
    if (!window.MediaDevices) return
    MediaDevices.prototype.getUserMedia = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream }
  }
  // What's wrong on the phone's screen, within its tab (or the dialog or menu over it).
  const faults = (p) => phoneFaults(p, '.mt-dialog-back, .modal-back, .ctx-menu, .menu', '.m-body')
  const box = (p, sel) => p.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width } }).catch(() => null)
  for (const [w, look] of [[375, { mode: 'light', theme: 'sky' }], [430, { mode: 'dark', theme: 'midnight' }]]) {
    const at = `${w}px ${look.mode}`
    const these = await finished(w)
    const { ctx, p, errors } = await page(b, kit.url, { ...look, phone: true, before: (c) => (which === 'webkit' ? c.addInitScript(toneMic) : null) })
    await p.setViewportSize({ width: w, height: w === 375 ? 812 : 932 })
    const fits = async (what, file) => {
      await sleep(350)
      const f = await faults(p)
      ok(!Object.keys(f).length, `${at}, ${what}: fits the phone (nothing wider, past its edge, sideways or cut off; each target 40 px and uncovered; fields 16 px)`, f)
      if (file) await shot(p, `${tag}phone-${file}-${w}-${look.mode}`)
    }
    const tab = p.locator('.m-meetings')
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    await tab.locator('.mt-row-open').first().waitFor({ timeout: 10000 })
    await fits('the meetings', 'meetings-list')

    // Recording, from the phone: the bar, My notes, the transcript (a section in it), AI Assist.
    await tab.locator('button', { hasText: 'Start recording' }).first().click()
    ok(!!(await until(() => tab.locator('.mt-recbar').isVisible(), 15000)), `${at}: recording from the phone`)
    const rid = (await kit.api('/meetings')).meetings.find((x) => x.status === 'recording')?.id
    if (rid) {
      said(rid, [['you', 1, 'Okay, let us go through the launch checklist.'], ['you', 4, 'The landing page copy still needs a pass from legal before we ship.']])
      await until(async () => (await tab.locator('.mt-transcript .mt-line').count()) >= 2, 8000)
      await fits('recording: the bar, My notes and the transcript', 'meeting-recording')
      const bar = await box(p, '.m-meetings .mt-recbar')
      const btns = await tab.locator('.mt-recbar .btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.innerText.trim(), h: Math.round(r.height), l: r.left, r: r.right } }))
      ok(btns.length >= 4 && btns.every((x) => x.h >= 40 && x.l >= bar.left && x.r <= bar.right), `${at}: the recording bar's buttons each a whole 40 px, inside it`, btns)
      const notes = await box(p, '.m-meetings .mt-mynotes.pinned .mt-mine')
      ok(notes && notes.h >= 120 && notes.w >= w - 60, `${at}: a big My notes box while it records`, notes)
      await tab.locator('.mt-recbar button', { hasText: 'New section' }).click()
      await tab.locator('.seg button[data-view="transcript"]').click()
      await until(async () => (await tab.locator('.mt-transcript .mt-sec').count()) >= 1, 8000)
      await tab.locator('.mt-transcript .mt-sec').first().scrollIntoViewIfNeeded()
      await fits('recording, with a section')
      fs.writeFileSync(path.join(kit.data, 'meetings', rid, 'assist.json'), JSON.stringify({ items: [{ id: 'a1', t: 30, kind: 'question', text: 'Who signs off on the landing page copy, and by when?', why: 'Legal was mentioned without an owner', state: 'new' }, { id: 'a2', t: 42, kind: 'check', text: 'Is the pricing page in the checklist too?', why: 'From the deck', state: 'new' }], at: new Date().toISOString(), upTo: 0, error: null }))
      if ((await tab.locator('.mt-recbar .mt-assist-btn').getAttribute('aria-pressed')) !== 'true') await tab.locator('.mt-recbar .mt-assist-btn').click()
      await tab.locator('.seg button[data-view="assist"]').click()
      ok(!!(await until(() => tab.locator('.mt-tip').first().isVisible(), 8000)), `${at}: AI Assist's suggestions while it records`)
      await tab.locator('.mt-assist').scrollIntoViewIfNeeded()
      await fits('AI Assist')
      await tab.locator('.mt-tip').last().scrollIntoViewIfNeeded()
      const tip = await tab.locator('.mt-tip').first().evaluate((e) => ({ text: e.querySelector('.mt-tip-text').getBoundingClientRect().width, all: e.getBoundingClientRect().width }))
      ok(tip.text >= tip.all * 0.8, `${at}: a suggestion's words get the width, its buttons over them`, tip)
      await fits('AI Assist\'s suggestions', 'meeting-assist')
      await tab.locator('.mt-recbar button', { hasText: 'Stop' }).click()
      await ended(rid)
      await kit.api(`/meetings/${rid}`, null, 'DELETE')
    }

    // A finished meeting: one page, its header the name and the views, when and who at the top of it.
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    await tab.locator('.mt-row-open', { hasText: these.done }).click()
    await tab.locator('.mt-items .mt-item').first().waitFor({ timeout: 10000 })
    await fits('a finished meeting\'s summary', 'meeting-summary')
    const head = await tab.locator('.pane-head').evaluate((e) => ({ h: Math.round(e.getBoundingClientRect().height), sub: !!e.querySelector('.pane-sub'), title: e.querySelector('.mt-title').getBoundingClientRect().bottom, views: e.querySelector('.seg').getBoundingClientRect().top }))
    ok(!head.sub && head.views >= head.title && head.h <= 120, `${at}: the header is the name (with Back, its state and ⋯) and the views under it`, head)
    // Saved by itself as it ended (on unless turned off), so where it's saved is there too.
    const metaText = () => tab.locator('.mt-page > .mt-meta').innerText().catch(() => '')
    const metaOk = (x) => /Priya Shah, Dan Ruiz, Tester/.test(x) && /Meeting notes/.test(x) && /\d:\d\d/.test(x)
    const meta = (await until(async () => { const x = await metaText(); return metaOk(x) && x }, 8000)) || await metaText()
    ok(metaOk(meta), `${at}: when, who and where it's saved at the top of the page, whole`, meta)
    const flow = await tab.locator('.mt-page').evaluate((pg) => { const n = pg.querySelector('.mt-cols > .mt-notes'); const a = pg.querySelector('.mt-ask'); return { page: pg.scrollHeight > pg.clientHeight, box: n.scrollHeight > n.clientHeight + 1, ask: a.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1 } })
    ok(flow.page && !flow.box && flow.ask, `${at}: the summary is one page that scrolls, with Ask under it (not a box scrolling over an Ask that stays)`, flow)
    const fill = await p.evaluate(() => { const pane = document.querySelector('.m-meetings > .pane').getBoundingClientRect(); const body = document.querySelector('.m-body').getBoundingClientRect(); return { pane: Math.round(pane.bottom), body: Math.round(body.bottom) } })
    ok(Math.abs(fill.pane - fill.body) <= 2, `${at}: the meeting fills the tab`, fill)
    await tab.locator('.mt-items').scrollIntoViewIfNeeded()
    await fits('its action items, each with Start an agent and To Chief of Staff', 'meeting-items')
    await tab.locator('.mt-from').scrollIntoViewIfNeeded()
    ok(/Written from/.test(await tab.locator('.mt-from').innerText()), `${at}: Written from`)
    await fits('Written from')
    await tab.locator('.mt-item').first().locator('button', { hasText: 'Start an agent' }).click()
    await tab.locator('.mt-start select, .mt-start-dir').first().waitFor({ timeout: 8000 })
    await tab.locator('.mt-start').scrollIntoViewIfNeeded()
    await fits('Start an agent', 'meeting-start-agent')
    await tab.locator('.mt-start button', { hasText: 'Cancel' }).click()
    // The transcript: a line's Add a note and Edit show once it's tapped.
    await tab.locator('.seg button[data-view="transcript"]').click()
    await tab.locator('.mt-transcript .mt-line').first().waitFor({ timeout: 8000 })
    await tab.locator('.mt-page').evaluate((e) => { e.scrollTop = 0 })
    await fits('the transcript')
    const line = tab.locator('.mt-transcript .mt-line').nth(1)
    const hidden = await line.locator('.mt-line-acts').evaluate((e) => getComputedStyle(e).visibility)
    await line.locator('.mt-text').click()
    const acts = await line.locator('.mt-line-acts .ghost-btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { v: getComputedStyle(e).visibility, w: Math.round(r.width), h: Math.round(r.height) } }))
    ok(hidden === 'hidden' && acts.length === 2 && acts.every((x) => x.v === 'visible' && x.w >= 40 && x.h >= 40), `${at}: a line's Add a note and Edit hidden until it's tapped, then 40 px each`, { hidden, acts })
    await fits('a line tapped', 'meeting-transcript')
    await tab.locator('.pane-head button[aria-label="More actions"]').click()
    await p.locator('.menu').first().waitFor({ timeout: 4000 })
    await fits('the ⋯ menu')
    await tab.locator('.pane-head button[aria-label="More actions"]').click()

    // A room: Speaker 1 and 2, named from a list of whole rows rather than a small menu.
    await tab.locator('.win-btn.back').click()
    await tab.locator('.mt-row-open', { hasText: these.room }).click()
    await tab.locator('.seg button[data-view="transcript"]').click()
    const whos = () => tab.locator('.mt-transcript .mt-line .mt-who').allInnerTexts()
    ok(!!(await until(async () => (await whos()).join('|') === 'Speaker 1|Speaker 2|Speaker 1|Speaker 2', 8000)), `${at}: a room's lines say which voice`, await whos())
    await fits('a room\'s transcript')
    await tab.locator('.mt-transcript .mt-who', { hasText: 'Speaker 2' }).first().click()
    const sheet = p.locator('.mt-dialog .mt-pick-list')
    ok(!!(await until(() => sheet.isVisible(), 4000)) && !(await p.locator('.ctx-menu').count()), `${at}: tapping Speaker 2 lists who it could be`)
    const rows = await sheet.locator('.mt-pick-opt').evaluateAll((els) => els.map((e) => ({ t: e.innerText.trim(), h: Math.round(e.getBoundingClientRect().height) })))
    ok(['Priya Shah', 'Dan Ruiz', "That's me", 'Someone else…'].every((x) => rows.some((r) => r.t === x)) && rows.every((r) => r.h >= 44), `${at}: who was invited, you and someone else, a whole row each`, rows)
    await fits('who said it', 'meeting-room-sheet')
    await sheet.locator('.mt-pick-opt', { hasText: 'Priya Shah' }).click()
    ok(!!(await until(async () => (await whos()).join('|') === 'Speaker 1|Priya Shah|Speaker 1|Priya Shah', 8000)), `${at}: picked, every line of that voice is named`, await whos())
    await tab.locator('.mt-transcript .mt-who', { hasText: 'Speaker 1' }).first().click()
    await sheet.locator('.mt-pick-opt', { hasText: 'Someone else' }).click()
    await p.locator('.mt-dialog input').waitFor({ timeout: 4000 })
    await fits('naming someone else')
    await p.keyboard.press('Escape')
    ok(errors.length === 0, `${at}: no page errors`, errors)
    await ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
