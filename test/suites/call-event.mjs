// Which meeting a call is for, on any platform: with two on the calendar (one running late into
// the next), the one the call's window names (Teams' title, a Meet tab's code), the one you clicked
// Join on, else the one that starts nearest to when the call did, and with no call the one under
// way (callevent.js, asked directly). On a Mac, the same from the server: the calendar (a stand-in
// for icalBuddy), the call (a stand-in for native/callwatch, which also gives its windows' titles)
// and Join. A meeting picked for the wrong event takes the other's name, people and links. A meeting
// that goes quiet asks whether to stop and stops by itself, and talking again takes that back.
// Saved by itself as it ends, without a summary, and a folder it can't write to says so. An agent
// you rename goes by that name, over the title it gives its own session, renamed from its header
// too; and the meeting's page offers the other meeting.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, checks, until, sleep, browser, page, TEST, IS_MAC, IS_WIN } from '../lib/harness.mjs'
import { pick, named, noteJoin } from '../../server/callevent.js'

const { ok, skip, done } = checks('call-event')

// ---------- Picking, on its own ----------
{
  const H = 3_600_000, M = 60_000
  const now = Date.parse('2026-11-04T10:58:00')
  const at = (ms) => new Date(now + ms).toISOString()
  const A = { id: 'Design review|a', title: 'Design review', start: at(-58 * M), end: at(2 * M), online: true, join: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_a' }
  const B = { id: 'Pricing sync|b', title: 'Pricing sync', start: at(2 * M), end: at(32 * M), online: true, join: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_b' }
  const teams = (ms) => ({ app: 'Teams', since: at(ms), browser: false })
  let r = pick([A, B], { now, call: teams(-1 * M), join: null })
  ok(r.event?.id === B.id && r.by === 'call' && r.others[0]?.id === A.id, 'a call joined two minutes early is for the meeting starting then, not the one still on', r)
  r = pick([A, B], { now: now + 9 * M, call: teams(-55 * M), join: null })
  ok(r.event?.id === A.id, 'a call that began with the first meeting is still for it once it runs into the next', r.event)
  r = pick([A, B], { now, call: teams(-1 * M), titles: ['Chat | Priya Shah | Microsoft Teams', 'Design review | Microsoft Teams'], join: null })
  ok(r.event?.id === A.id && r.by === 'window', "the meeting Teams names in its window's title wins over the time", r)
  ok(named({ title: 'Teams sync' }, ['Calendar | Microsoft Teams']) < 0.6 && named({ title: 'Microsoft Teams' }, ['Chat | Microsoft Teams']) === 1, "the call app's own words don't name a meeting, unless they're all it's called")
  const G = { ...B, id: 'Standup|g', title: 'Standup', join: 'https://meet.google.com/abc-defg-hij' }
  r = pick([A, G], { now, call: { app: 'Chrome', since: at(-1 * M), browser: true }, titles: ['Meet - abc-defg-hij - Google Chrome'], join: null })
  ok(r.event?.id === G.id && r.by === 'window', "a Meet tab's code names its meeting", r)
  r = pick([A, B], { now, join: null })
  ok(r.event?.id === A.id && r.by === 'now', 'with no call (a room), the meeting under way', r)
  r = pick([A, B], { now, join: { id: B.id, at: now - 3 * M } })
  ok(r.event?.id === B.id && r.by === 'joined', 'the one you clicked Join on, a few minutes ago', r)
  r = pick([A, B], { now, join: { id: B.id, at: now - H } })
  ok(r.event?.id === A.id, 'a Join an hour ago says nothing now', r.event)
  ok(pick([{ ...A, canceled: true }, { ...B, allDay: true }], { now, join: null }).event === null, 'a canceled event, or an all-day one, is no meeting to take notes for')
  noteJoin(null)
}

// ---------- The server: the calendar, the call and its windows ----------
const pcm = (seconds, say) => { const b = Buffer.alloc(Math.round(seconds * 16000) * 2); if (say) for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / 16000) * 8000), i * 2); return b }
// The call on cue: bin/callwatch.json says which apps have the mic ({ input: [bundle] }) and what
// their windows are called ({ titles: [] }), as native/callwatch would.
const callwatch = (bin) => {
  fs.writeFileSync(path.join(bin, 'callwatch.cjs'), `const fs = require('node:fs'), path = require('node:path')
const read = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'callwatch.json'), 'utf8')) } catch { return {} } }
// Screen Recording as callwatch.json says ({ screen: true }); a look at the call's window, a PNG.
const say = (o) => { process.stdout.write(JSON.stringify(o) + '\\n'); process.exit(0) }
if (process.argv[2] === 'screen-ask') { fs.writeFileSync(path.join(__dirname, 'screen-asked'), ''); say({ allowed: !!read().screen }) }
if (process.argv[2] === 'screen') say({ allowed: !!read().screen })
if (process.argv[2] === 'shot') {
  if (!read().screen) say({ error: 'not-allowed' })
  fs.writeFileSync(process.argv[3], Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120)]))
  fs.appendFileSync(path.join(__dirname, 'shots.log'), process.argv.slice(4).join(' ') + '\\n')
  say({ ok: true })
}
// A burst of looks for faces: what callwatch.json says the call's video showed ({ faces }).
if (process.argv[2] === 'faces') {
  if (!read().screen) say({ error: 'not-allowed' })
  fs.appendFileSync(path.join(__dirname, 'faces.log'), process.argv.slice(3).join(' ') + '\\n')
  say(read().faces || { ok: true, faces: [], labels: [] })
}
if (process.argv[2] === 'windows') { process.stdout.write(JSON.stringify({ by: 'accessibility', windows: (read().titles || []).map((title) => ({ bundle: 'com.microsoft.teams2', title })) }) + '\\n'); process.exit(0) }
let last = ''
setInterval(() => { const line = JSON.stringify({ input: (read().input || []).map((bundle, i) => ({ pid: 100 + i, bundle })) }); if (line !== last) { last = line; process.stdout.write(line + '\\n') } }, 150)`)
  fs.writeFileSync(path.join(bin, 'callwatch'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'callwatch.cjs')}" "$@"\n`, { mode: 0o755 })
  return path.join(bin, 'callwatch')
}
// The text on a picture: ocr.txt beside it (a stand-in for native/bridgeocr).
const ocr = (bin) => {
  fs.writeFileSync(path.join(bin, 'ocr.cjs'), `const fs = require('node:fs'), path = require('node:path')
try { process.stdout.write(fs.readFileSync(path.join(__dirname, 'ocr.txt'), 'utf8')) } catch { /* nothing on it */ }`)
  fs.writeFileSync(path.join(bin, 'bridgeocr'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'ocr.cjs')}" "$@"\n`, { mode: 0o755 })
  return path.join(bin, 'bridgeocr')
}
const kit = await startKit('call-event', {
  env: ({ bin }) => ({ BRIDGE_CALL_QUIET_MS: '1500', BRIDGE_SCREEN_RECHECK_MS: '300', BRIDGE_TAP_RECHECK_MS: '300', ...(IS_WIN ? {} : { BRIDGE_OCR: ocr(bin) }), BRIDGE_CALL_START_MS: '300', BRIDGE_SIGHT_EVERY_MS: '500', BRIDGE_CALL_END_MS: '600', BRIDGE_QUIET_OVER_MS: '1500', BRIDGE_QUIET_END_MS: '4000', BRIDGE_QUIET_REMIND_MS: '1500', BRIDGE_QUIET_LONG_MS: '4000', BRIDGE_QUIET_CHECK_MS: '300', BRIDGE_AUTO_STOP_MS: '2000', ...(IS_WIN ? {} : { BRIDGE_CALLWATCH: callwatch(bin) }) }),
})
const model = await startModel('call-event')
const browsers = []
const api = kit.api
const call = (o) => fs.writeFileSync(path.join(kit.bin, 'callwatch.json'), JSON.stringify(o))
let seq = 0
const send = async (id, buf) => { for (let o = 0; o < buf.length; o += 32000) await fetch(`${kit.url}/api/meetings/${id}/audio?src=you&seq=${seq++}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf.subarray(o, o + 32000) }) }
try {
  await api('/setup', { name: 'Tester' })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false, cleanup: false, folder: path.join(kit.home, 'Notes') } }, 'PATCH')

  // Design review began 57 minutes ago and has 3 left; Pricing sync starts in 3. Both on Teams.
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0')
  const hm = (t) => `${p2(t.getHours())}:${p2(t.getMinutes())}`
  const a0 = new Date(+d - 57 * 60e3), a1 = new Date(+d + 3 * 60e3), b1 = new Date(+d + 33 * 60e3)
  const sameDay = a0.getDate() === d.getDate() && b1.getDate() === d.getDate()
  if (!IS_MAC || !sameDay) skip('the server picks the meeting a call is for', IS_MAC ? 'too near midnight for a calendar of today' : 'the calendar is macOS Calendar')
  else {
    const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
    const ev = (title, s, e, who, link) => `@@EV@@${title} (Work)\u00a6${day} at ${hm(s)} - ${hm(e)}\u00a6location: Microsoft Teams Meeting\u00a6url: ${link}\u00a6attendees: ${who}\n`
    const out = ev('Design review', a0, a1, 'Priya Shah, Tester', 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_a') + ev('Pricing sync', a1, b1, 'Dan Ruiz, Ana Lima, Tester', 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_b')
    kit.program('icalBuddy', `process.stdout.write(${JSON.stringify(out)})`)
    let r = await api('/calls/event')
    ok(r.event?.title === 'Design review' && r.by === 'now', 'with no call on, the meeting under way', r)
    call({ input: ['com.microsoft.teams2'] })
    ok(!!(await until(async () => (await api('/calls')).calls.some((c) => c.app === 'Teams'), 8000)), 'a Teams call is noticed')
    r = await api('/calls/event?app=Teams')
    ok(r.event?.title === 'Pricing sync' && r.by === 'call' && r.others[0]?.title === 'Design review', 'a Teams call that just began is for the meeting about to start, not the one ending', r)
    call({ input: ['com.microsoft.teams2'], titles: ['Chat | Dan Ruiz | Microsoft Teams', 'Design review | Microsoft Teams'] })
    await sleep(5200) // the titles are kept a few seconds
    r = await api('/calls/event?app=Teams')
    ok(r.event?.title === 'Design review' && r.by === 'window', "the one Teams' meeting window names, when it says", r)
    call({})
    await until(async () => !(await api('/calls')).calls.length, 8000)
    const B = (await api('/calendar')).today.find((e) => e.title === 'Pricing sync')
    await api('/calendar/joined', { id: B.id })
    r = await api('/calls/event')
    ok(r.event?.title === 'Pricing sync' && r.by === 'joined', 'Join clicked on Pricing sync: the meeting is that one', r)
    await api('/calendar/joined', { id: null })

    // Named after Design review, it was Pricing sync: picked from the meeting, its name, people
    // and invite's links follow.
    const A = (await api('/calendar')).today.find((e) => e.title === 'Design review')
    const m = await api('/meetings', { title: A.title, event: { ...A, links: [{ url: 'https://contoso.sharepoint.com/:p:/deck', name: 'PowerPoint on SharePoint' }] }, call: false })
    const around = await api(`/meetings/${m.id}/events`)
    ok(around.events.some((e) => e.title === 'Pricing sync'), 'the other meeting on then is offered on the meeting', around.events.map((e) => e.title))
    await api(`/meetings/${m.id}/event`, { event: { ...B, links: [] } })
    const m2 = await api(`/meetings/${m.id}`)
    ok(m2.title === 'Pricing sync' && m2.event.attendees.includes('Ana Lima') && !m2.links.some((l) => l.from === 'invite'), 'taking the other: its name, its people, and the first one\'s invite links gone', { t: m2.title, who: m2.event.attendees, links: m2.links })
    await api(`/meetings/${m.id}/stop`, {})
    // The same from the meeting's page: Another meeting?, and the one it was.
    const m3 = await api('/meetings', { title: A.title, event: A, call: false })
    await api(`/meetings/${m3.id}/stop`, {})
    const { b } = await browser()
    browsers.push(b)
    const { p } = await page(b, kit.url)
    const chip = p.locator('.mt-otherev')
    // Asked again until the app is up to hear it.
    ok(!!(await until(async () => { if (!(await p.locator('.mt-view').count())) await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id } })), m3.id); return chip.isVisible() }, 15000, 500)), 'its page asks: Another meeting?')
    await chip.click()
    await p.locator('.menu-item, .at-item, [role="menuitem"]', { hasText: 'Pricing sync' }).first().click()
    ok(!!(await until(async () => (await api(`/meetings/${m3.id}`)).title === 'Pricing sync' && (await p.locator('.mt-title').inputValue()) === 'Pricing sync', 8000)), 'picking Pricing sync names it that, on the page too', (await api(`/meetings/${m3.id}`)).title)
    await p.context().close()
  }

  // ---------- Names from the call's window, with nobody picking a screen ----------
  if (!IS_MAC) skip("looks at the call's window by itself", "the call's sound is recorded on a Mac")
  else {
    const shots = () => { try { return fs.readFileSync(path.join(kit.bin, 'shots.log'), 'utf8').split('\n').filter(Boolean) } catch { return [] } }
    fs.writeFileSync(path.join(kit.bin, 'ocr.txt'), 'Talking: Dan Ruiz')
    call({ input: ['com.microsoft.teams2'] })
    await until(async () => (await api('/calls')).calls.some((c) => c.app === 'Teams'), 8000)
    ok((await api('/calls/screen')).allowed === false, "Screen Recording not allowed yet: the app can say so, to ask")
    const askedNow = await api('/calls/screen', {})
    ok(askedNow.allowed === false && fs.existsSync(path.join(kit.bin, 'screen-asked')), "Allow asks macOS (its own window), and says it isn't on yet", askedNow)
    // On a call (Teams has the mic) whose sound is a few steps off silence, and macOS hasn't let
    // Bridge AI hear it: both said, on the meeting and on the floating card.
    const taps = () => { try { return fs.readFileSync(path.join(kit.bin, 'calltap.log'), 'utf8').split('\n').filter(Boolean) } catch { return [] } }
    const before = taps().length
    fs.writeFileSync(path.join(kit.bin, 'calltap.json'), JSON.stringify({ level: 3, access: 'denied' }))
    const L = await api('/meetings', { title: 'Pricing sync' })
    const quiet = await until(async () => { const m = await api(`/meetings/${L.id}`); const r = (await api('/calls')).recording; return m.callQuiet && r?.callQuiet === true && { m: m.callAccess, r: r.callAccess } }, 10000)
    ok(!!quiet && quiet.m === 'denied' && quiet.r === 'denied', 'on a call whose sound is silent, that\'s said, with macOS\'s no, on the meeting and the floating card', quiet)
    await sleep(1200) // asked again meanwhile, still no: the same tap
    ok(taps().length === before + 1, '(while macOS says no, the tap is left as it is)', taps().slice(before))
    // Allowed in System Settings meanwhile: asked again, the tap starts again by itself, with no
    // restart and the recording going on, and the call is heard.
    fs.writeFileSync(path.join(kit.bin, 'calltap.json'), JSON.stringify({ level: 3000, access: 'allowed' }))
    ok(!!(await until(async () => (await api(`/meetings/${L.id}`)).callQuiet === false, 10000)), 'macOS says yes while it records: the call is heard, without a restart')
    ok(taps().slice(before).join() === 'start denied,start allowed' && (await api(`/meetings/${L.id}`)).status === 'recording' && (await api('/calls')).recording?.callAccess === 'allowed', 'by starting its tap again, once, and the meeting still recording', taps().slice(before))
    await sleep(3000)
    ok(!shots().length, 'not allowed: no look at the call, someone talking or not', shots())
    call({ input: ['com.microsoft.teams2'], screen: true })
    const got = await until(async () => { try { return fs.readFileSync(path.join(kit.data, 'meetings', L.id, 'glances.jsonl'), 'utf8').includes('Dan Ruiz') } catch { return false } }, 15000)
    ok(!!got && shots()[0] === 'com.microsoft.teams2 com.microsoft.teams', "allowed: as someone on the call talks, a look at Teams' window by itself, its names read and kept as words", shots())
    // Speakers from the call's video (a beta feature): off, no bursts; on, a burst of looks at the
    // call's window as someone talks, whose mouth moved kept and no picture. The faces are what the
    // real callwatch read off a made-up call (test/fixtures/call-faces.json): the person on the left
    // of a room's camera talking.
    const bursts = () => { try { return fs.readFileSync(path.join(kit.bin, 'faces.log'), 'utf8').split('\n').filter(Boolean) } catch { return [] } }
    ok(!bursts().length, "Speakers from the call's video off: no looks for faces", bursts())
    call({ input: ['com.microsoft.teams2'], screen: true, faces: { ok: true, ...JSON.parse(fs.readFileSync(new URL('../fixtures/call-faces.json', import.meta.url), 'utf8')) } })
    await api('/settings', { trials: { 'call-video': true } }, 'PATCH')
    const sightsFile = path.join(kit.data, 'meetings', L.id, 'sights.jsonl')
    const sight = await until(() => { try { return JSON.parse(fs.readFileSync(sightsFile, 'utf8').split('\n')[0]) } catch { return null } }, 10000)
    const talking = sight?.faces?.filter((f) => f.m >= 0.03)
    ok(!!sight && bursts()[0] === '6 160 com.microsoft.teams2 com.microsoft.teams' && talking?.length === 1 && talking[0].label === 'Huddle Room (You)' && talking[0].where === 'on the left' && sight.faces.length === 9, "on: as someone talks, six looks at Teams' window a sixth of a second apart, each face kept with the name under it and how much its mouth moved", { sight, bursts: bursts() })
    ok(fs.readdirSync(path.join(kit.data, 'meetings', L.id)).every((f) => !/\.(png|jpe?g)$/i.test(f)), 'and no picture kept')
    await api('/settings', { trials: { 'call-video': false } }, 'PATCH')
    fs.writeFileSync(path.join(kit.bin, 'calltap.json'), JSON.stringify({ level: 0 }))
    await api(`/meetings/${L.id}/stop`, {})
    call({})
    await until(async () => !(await api('/calls')).calls.length, 8000)
  }

  // ---------- A call's prompt never hangs ----------
  // Take notes with a mic that never answers: it says it's starting, and Not now still closes it,
  // at once. The mic is stood in for on MediaDevices itself too: on a CI Mac, WebKit's real one ran
  // and refused at once, so the one on navigator.mediaDevices alone wasn't always the one called.
  if (IS_WIN) skip("a call's prompt closes while Take notes is starting", 'calls are noticed on a Mac')
  else {
    const { b } = await browser()
    browsers.push(b)
    const { p, ctx } = await page(b, kit.url, { before: async (c) => { await c.addInitScript(() => { const never = () => new Promise(() => {}); if (window.MediaDevices) MediaDevices.prototype.getUserMedia = never; if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = never }) } })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    call({ input: ['com.microsoft.teams2'] })
    const prompt = p.locator('.call-prompt', { hasText: 'Teams call started' })
    ok(!!(await until(() => prompt.isVisible(), 15000)), 'a Teams call started: the prompt asks to take notes')
    await prompt.locator('button', { hasText: 'Take notes' }).click()
    ok(!!(await until(async () => /Starting/.test(await prompt.innerText().catch(() => '')), 5000)), 'Take notes says it is starting', await prompt.innerText().catch(() => ''))
    await prompt.locator('button', { hasText: 'Not now' }).click()
    ok(!!(await until(async () => !(await prompt.count()), 1500, 100)), 'Not now closes it at once, though the mic never answered')
    ok(!!(await until(async () => (await api('/calls')).prompt == null, 5000)), "and the computer stops asking", (await api('/calls')).prompt)
    await ctx.close()
    call({})
    await until(async () => !(await api('/calls')).calls.length, 8000)
  }

  // ---------- Quiet: the meeting seems over ----------
  // While its calendar time lasts, quiet says nothing: a meeting that runs over isn't ended.
  const hour = 3600e3
  const ev = (from, to) => ({ title: 'Planning', start: new Date(Date.now() + from).toISOString(), end: new Date(Date.now() + to).toISOString(), attendees: ['Priya Shah'] })
  const during = await api('/meetings', { title: 'Planning', event: ev(-hour, hour), call: false })
  await send(during.id, Buffer.concat([pcm(2, true), pcm(0.5)]))
  await sleep(5000)
  let rec = (await api('/calls')).recording
  ok(rec?.id === during.id && !rec.callEnded && (await api(`/meetings/${during.id}`)).status === 'recording', 'quiet while its calendar time lasts: nothing asked, still recording', rec)
  await api(`/meetings/${during.id}/stop`, {})
  // Its time up: quiet a little brings the card up to ask, and doesn't stop it; quiet a while longer
  // and it stops by itself. Talking again takes the question back.
  const past = await api('/meetings', { title: 'Retro', event: ev(-hour, -60e3), call: false })
  await send(past.id, Buffer.concat([pcm(2, true), pcm(0.5)]))
  rec = await until(async () => { const c = await api('/calls'); return c.recording?.endWhy === 'over' && c.recording }, 8000)
  ok(!!rec && !!rec.callEnded && !rec.stopsAt, 'its time up and quiet a little: it asks, with nothing stopping it yet', rec)
  await send(past.id, Buffer.concat([pcm(2, true), pcm(0.3)]))
  rec = await until(async () => { const c = await api('/calls'); return c.recording && !c.recording.callEnded && c.recording }, 6000)
  ok(!!rec, 'someone talking again takes the question back', rec)
  rec = await until(async () => { const c = await api('/calls'); return c.recording?.stopsAt && c.recording }, 10000)
  ok(!!rec && rec.endWhy === 'over', 'quiet a while longer past its time: now it says when it stops by itself', rec)
  let stopped = await until(async () => { const x = await api(`/meetings/${past.id}`); return x.status !== 'recording' && x }, 10000)
  ok(!!stopped, 'and it stops', stopped && stopped.status)
  // No calendar time: it asks after a while, and stops after longer. A meeting in a room, recording
  // what the computer plays as every meeting does (on a Mac), with nothing playing: no call to wait on.
  const Q = await api('/meetings', { title: 'Whiteboard session' })
  await send(Q.id, Buffer.concat([pcm(2, true), pcm(0.5)]))
  rec = await until(async () => { const c = await api('/calls'); return c.recording?.endWhy === 'quiet' && c.recording }, 8000)
  ok(!!rec && !rec.stopsAt, 'with no calendar time, quiet a while: it asks, and only asks', rec)
  stopped = await until(async () => { const x = await api(`/meetings/${Q.id}`); return x.status !== 'recording' && x }, 15000)
  ok(!!stopped, 'quiet much longer, it stops by itself', stopped && stopped.status)

  // ---------- Saved as it ends ----------
  // On unless turned off: nothing in the settings says so.
  ok((await api('/settings')).user?.meetings?.autoSave === undefined, '(saving every meeting by itself is left as it comes)')
  const S = await api('/meetings', { title: 'Vendor call', call: false })
  await send(S.id, Buffer.concat([pcm(2, true), pcm(1)]))
  await api(`/meetings/${S.id}/stop`, {})
  const saved = await until(async () => { const x = await api(`/meetings/${S.id}`); return x.saved && x }, 20000)
  ok(!!saved && fs.existsSync(saved.saved) && !saved.summary, 'saved by itself as it ends, with no summary written', saved && { saved: saved.saved, error: saved.saveError })
  if (IS_WIN) skip("a folder it can't write to says so", 'folder permissions')
  else {
    const ro = path.join(kit.home, 'Locked')
    fs.mkdirSync(ro, { recursive: true })
    fs.chmodSync(ro, 0o500)
    await api('/settings', { meetings: { folder: path.join(ro, 'Notes') } }, 'PATCH')
    const why = await api(`/meetings/${S.id}/save`, {}).then(() => null, (e) => e.message)
    const after = await api(`/meetings/${S.id}`)
    ok(/isn't allowed to write to/.test(why || '') && after.saveError === why, "a folder it can't write to: why, on the meeting too", { why, saveError: after.saveError })
    fs.chmodSync(ro, 0o700)
    await api(`/meetings/${S.id}/save`, {})
    ok(!(await api(`/meetings/${S.id}`)).saveError, 'saved once it can be: the warning goes')
  }

  // ---------- An agent you name ----------
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await api('/agents/catalog')
  const dir = path.join(kit.home, 'code', 'site')
  fs.mkdirSync(dir, { recursive: true })
  const L = await api('/agents/launch', { kind: 'claude', cwd: dir, label: 'site', prompt: 'title Aaroha as company name' })
  const own = await until(async () => (await api('/fleet')).agents.find((a) => a.paneId === L.paneId && /Aaroha/.test(a.title || '')), 15000)
  ok(!!own && !own.named, "an agent goes by the title it gives its session", own && own.title)
  await api(`/tabs/${encodeURIComponent(own.tabId)}/rename`, { label: 'Company name' })
  const after = (await api('/fleet')).agents.find((a) => a.paneId === L.paneId)
  ok(after?.title === 'Company name' && after.named && /Aaroha/.test(after.ownTitle || ''), 'renamed: it goes by your name, its own title kept beside it', after && { title: after.title, own: after.ownTitle })
  // From its header: double-click its name, type another.
  {
    const { b } = await browser()
    browsers.push(b)
    const { p } = await page(b, kit.url)
    const name = p.locator('.console-title', { hasText: 'Company name' }).first()
    ok(!!(await until(async () => { if (!(await name.count())) await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), L.paneId); return name.isVisible() }, 15000, 500)), 'its header shows your name for it')
    await name.dblclick()
    await p.locator('.console-rename').fill('Landing page')
    await p.locator('.console-rename').press('Enter')
    ok(!!(await until(async () => (await api('/fleet')).agents.find((a) => a.paneId === L.paneId)?.title === 'Landing page' && await p.locator('.console-title', { hasText: 'Landing page' }).first().isVisible(), 8000)), 'renamed from its header')
    await p.context().close()
  }
  await kit.restart()
  const later = await until(async () => (await api('/fleet')).agents.find((a) => a.title === 'Landing page'), 15000)
  ok(!!later?.named, 'and still after Bridge AI opens again', later && { title: later.title, named: later.named })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
