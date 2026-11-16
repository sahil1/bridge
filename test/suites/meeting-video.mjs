// Record the screen too: a meeting's screen kept as a video with its sound (server/meetvideo.js,
// src/components/meetings/videorec.js, video.jsx and player.jsx). The server: a video's pieces put
// on the end of its file once each, in order, served in parts as a player seeks; stopped with the
// disk nearly full and when its file can't be written, each saying why; cut off when Bridge AI
// closed; one with nothing in it let go; deleted; on a Mac, the call's sound as it comes. In the
// app (the browser's own stand-in screen: Chromium's fake one, WebKit's mock; WebKit's mic a tone):
// the choice beside Start recording, off, then on and kept; the recording saving a video in pieces
// as it goes, its size on the recording bar; once it ends, the Video view beside the transcript
// playing it, a line's time and a click on the line moving the video there; the disk nearly full
// mid-recording said on the bar and on the meeting after. Where the screen can't be recorded (a
// phone, a browser without getDisplayMedia or MediaRecorder), no choice; in the desktop app on a Mac
// that needs Screen Recording for it, what to turn on, and nothing to turn on with macOS's picker.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, browser, page, shot, withoutCutOff, IS_MAC } from '../lib/harness.mjs'

const { ok, skip, done } = checks('meeting-video')
// A disk with room enough whatever this computer has free; the tests set less room themselves.
const kit = await startKit('meeting-video', { config: { meetings: { videoKeepFreeGB: 0 } } })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const dirOf = (id) => path.join(kit.data, 'meetings', id)
const said = (id, rows) => fs.appendFileSync(path.join(dirOf(id), 'transcript.jsonl'), rows.map(([src, t0, text]) => JSON.stringify({ src, t0, t1: t0 + 2, text, engine: 'test' })).join('\n') + '\n')
const keepFree = (gb) => api('/settings', { meetings: { videoKeepFreeGB: gb } }, 'PATCH')
const refused = (p) => p.then(() => null, (e) => e)
// WebKit in the tests has no microphone: a tone stands in for one.
const toneMic = () => {
  if (!navigator.mediaDevices) return
  MediaDevices.prototype.getUserMedia = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream }
}

try {
  await api('/setup', { name: 'Tester' })
  // ---------- The server ----------
  {
    const A = await api('/meetings', { title: 'Video by hand', call: false })
    const put = (vid, seq, buf, s) => fetch(`${kit.url}/api/meetings/${A.id}/videos/${vid}?seq=${seq}&s=${s}`, { method: 'POST', headers: { 'content-type': 'video/webm' }, body: buf }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
    const v = await api(`/meetings/${A.id}/videos`, { type: 'video/webm;codecs=vp9,opus', label: 'Slides', sound: 'mic' })
    const file = path.join(dirOf(A.id), 'video-1.webm')
    ok(v.id === '1' && v.state === 'recording' && v.ext === 'webm' && fs.existsSync(file), "a video starts in the meeting's own folder", v)
    const r1 = await put(v.id, 0, Buffer.alloc(1000, 1), 2)
    const twice = await put(v.id, 0, Buffer.alloc(1000, 1), 2)
    const r2 = await put(v.id, 1, Buffer.alloc(2000, 2), 4)
    const bytes = fs.readFileSync(file)
    ok(r1.bytes === 1000 && twice.dup && r2.bytes === 3000 && bytes.length === 3000 && bytes[999] === 1 && bytes[1000] === 2, "each piece goes on the end of the file as it comes, once: one sent again (a dropped connection) isn't written twice", { r1, twice, r2, size: bytes.length })
    ok(typeof r2.free === 'number' && r2.free > 0, 'each piece says what the disk has free', r2)
    const part = await fetch(`${kit.url}/api/meetings/${A.id}/videos/${v.id}`, { headers: { range: 'bytes=1000-1999' } })
    ok(part.status === 206 && (await part.arrayBuffer()).byteLength === 1000 && /^video\/webm/.test(part.headers.get('content-type') || ''), 'served in parts, as a player asks for them when it seeks', { status: part.status, type: part.headers.get('content-type') })
    const playing = (await api(`/meetings/${A.id}`)).videos
    ok(playing?.length === 1 && playing[0].state === 'recording' && playing[0].t >= 0 && playing[0].bytes === 3000, "the meeting lists it as it records, with where it starts in the meeting", playing)
    await api(`/meetings/${A.id}/videos/${v.id}/end`, { seconds: 4 })
    const ended = (await api(`/meetings/${A.id}`)).videos[0]
    ok(ended.state === 'done' && ended.seconds === 4 && ended.bytes === 3000 && !ended.why, 'ended: how long and how big', ended)
    const after = await put(v.id, 2, Buffer.alloc(10), 5)
    ok(after.code === 'ended' && fs.statSync(file).size === 3000, 'nothing more goes on the end of one that ended', after)

    // The disk nearly full: not started, and one recording stops there, saying why.
    await keepFree(1e9)
    const low = await refused(api(`/meetings/${A.id}/videos`, { type: 'video/mp4', sound: 'mic' }))
    ok(low?.j?.code === 'disk' && /free on this computer's disk, and recording the screen keeps .* free/.test(low.message), "the disk nearly full: it doesn't start, and says why", low?.message)
    await keepFree(0)
    const w = await api(`/meetings/${A.id}/videos`, { type: 'video/mp4', sound: 'mic' })
    await put(w.id, 0, Buffer.alloc(500, 3), 2)
    await keepFree(1e9)
    const full = await put(w.id, 1, Buffer.alloc(500, 4), 4)
    const wl = (await api(`/meetings/${A.id}`)).videos.find((x) => x.id === w.id)
    ok(full.code === 'disk' && wl.state === 'stopped' && /^Stopped with .* free on this computer's disk.*What was recorded until then is kept\.$/.test(wl.why) && wl.bytes === 500 && fs.statSync(path.join(dirOf(A.id), `video-${w.id}.mp4`)).size === 500, 'the disk nearly full while it records: it stops there, keeps what it had and says why', { full, wl })
    await keepFree(0)

    // Its file can't be written (a folder where it was): stops, saying so.
    const x = await api(`/meetings/${A.id}/videos`, { type: 'video/mp4', sound: 'mic' })
    const xf = path.join(dirOf(A.id), `video-${x.id}.mp4`)
    fs.rmSync(xf); fs.mkdirSync(xf)
    const bad = await put(x.id, 0, Buffer.alloc(100, 5), 2)
    const xl = (await api(`/meetings/${A.id}`)).videos.find((y) => y.id === x.id)
    ok(bad.code === 'failed' && xl.state === 'failed' && /couldn't be written to this computer's disk/.test(xl.why), "its file can't be written: it stops, and says so", { bad, xl })
    fs.rmSync(xf, { recursive: true, force: true })

    // Started with nothing sent: let go when it ends.
    const e = await api(`/meetings/${A.id}/videos`, { type: 'video/mp4', sound: 'mic' })
    const gone = await api(`/meetings/${A.id}/videos/${e.id}/end`, { seconds: 0 })
    ok(gone.gone && !(await api(`/meetings/${A.id}`)).videos.some((y) => y.id === e.id) && !fs.existsSync(path.join(dirOf(A.id), `video-${e.id}.mp4`)), 'one with nothing in it is let go')

    // Bridge AI closed while it recorded: what was sent is kept, and the meeting says it was cut off.
    const c = await api(`/meetings/${A.id}/videos`, { type: 'video/mp4', sound: 'call' })
    await put(c.id, 0, Buffer.alloc(700, 6), 2)
    await api(`/meetings/${A.id}/stop`, {})
    const vj = path.join(dirOf(A.id), 'videos.json')
    fs.writeFileSync(vj, JSON.stringify(JSON.parse(fs.readFileSync(vj, 'utf8')).map((y) => (y.id === c.id ? { ...y, lastAt: new Date(Date.now() - 60_000).toISOString() } : y))))
    const cl = (await api(`/meetings/${A.id}`)).videos.find((y) => y.id === c.id)
    ok(cl.state === 'cut' && /closed while the screen was recorded/.test(cl.why) && cl.bytes === 700, 'Bridge AI closed while it recorded: what was sent is kept, and it says so', cl)
    ok(!!(await refused(api(`/meetings/${A.id}/videos`, { type: 'video/mp4' }))), "no new one once the meeting isn't recording")

    // Deleted to make room.
    await api(`/meetings/${A.id}/videos/${v.id}`, null, 'DELETE')
    ok(!fs.existsSync(file) && !(await api(`/meetings/${A.id}`)).videos.some((y) => y.id === v.id), 'Delete video takes its file and its entry')
  }

  // The call's sound as Bridge AI records it, for the video's sound (a Mac, with a stand-in for it).
  if (IS_MAC) {
    fs.writeFileSync(path.join(kit.bin, 'calltap.json'), JSON.stringify({ level: 3000 }))
    const C = await api('/meetings', { title: 'Call sound' })
    const ac = new AbortController()
    const r = await fetch(`${kit.url}/api/meetings/${C.id}/sound`, { signal: ac.signal })
    const reader = r.body.getReader()
    let got = 0
    const end = Date.now() + 2500
    while (Date.now() < end && got < 16000) { const { value, done: over } = await Promise.race([reader.read(), sleep(3000).then(() => ({ done: true }))]); if (over) break; got += value.length }
    ac.abort()
    await api(`/meetings/${C.id}/stop`, {})
    ok(r.ok && got >= 16000, "the call's sound comes as it's recorded (16 kHz, 16-bit), for the video's sound", { status: r.status, got })
  } else skip("the call's sound for the video", "Bridge AI records a call's sound on a Mac")

  // ---------- In the app ----------
  const { ctx, p, errors } = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, before: (c) => (which === 'webkit' ? c.addInitScript(toneMic) : null) })
  await p.waitForSelector('.rail-nav-row', { timeout: 15000 }).catch(() => {})
  const toList = () => until(async () => { await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } }))); return p.locator('.mt-home').isVisible() }, 10000, 1000)
  await toList()
  const choice = p.locator('.pane-head .mt-video-choice input[type=checkbox]')
  ok(await choice.isVisible().catch(() => false) && !(await choice.isChecked()), 'Record the screen too beside Start recording, off to begin with')
  await choice.check()
  await shot(p, `${tag}video-choice`)
  const pieces = []
  p.on('request', (r) => { if (r.method() === 'POST' && /\/api\/meetings\/[^/]+\/videos\/[^/]+\?seq=/.test(r.url())) pieces.push(Date.now()) })
  await p.locator('.pane-head button', { hasText: 'Start recording' }).click()
  const R = await until(async () => (await api('/meetings')).meetings.find((x) => x.status === 'recording'), 15000)
  ok(!!R, 'Start recording records')
  const chip = p.locator('.mt-recbar .mt-video-chip')
  ok(!!(await until(() => chip.isVisible(), 15000)), 'the screen picked as it starts, and recorded: the recording bar says so', await p.locator('.mt-recbar').innerText().catch(() => ''))
  const vOf = async () => (await api(`/meetings/${R.id}`)).videos?.[0]
  const first = await until(async () => { const v = await vOf(); return v?.bytes > 0 && v }, 12000)
  await sleep(5000)
  const later = await vOf()
  const file = first && path.join(dirOf(R.id), `video-${first.id}.${first.ext}`)
  ok(!!first && later.state === 'recording' && later.bytes > first.bytes && fs.statSync(file).size === later.bytes && pieces.length >= 3, 'saved as it goes, a piece every few seconds, while it records', { first, later, pieces: pieces.length })
  ok(/\d+ MB/.test(await chip.innerText()) && /as a video on this computer/.test(await chip.getAttribute('title')), 'its size on the recording bar, and that it stays on this computer', { text: await chip.innerText(), title: await chip.getAttribute('title') })
  await shot(p, `${tag}video-recording`)
  const v0 = later
  said(R.id, [['you', v0.t + 1.5, 'Here is the first slide.'], ['them', v0.t + 4.5, 'And the second line, later on.']])
  await sleep(2500)
  await p.locator('.mt-recbar button.danger-soft', { hasText: 'Stop' }).click()
  const V = await until(async () => { const v = await vOf(); return v?.state === 'done' && v }, 20000)
  ok(!!V && V.seconds >= 6 && fs.statSync(file).size === V.bytes, 'stopped with the meeting: done, how long and how big', V)
  ok(!!V && V.ext === 'mp4' && /^video\/mp4/.test(V.type), 'MP4, which this browser makes (as the desktop app, Chrome, Edge and Safari do)', V?.type)

  // Played beside the transcript.
  await until(async () => (await p.locator('.seg button[data-view="video"]').count()) > 0, 15000)
  await p.locator('.seg button[data-view="video"]').click()
  const vid = p.locator('.mt-video-view video.mt-video')
  const loaded = await until(() => vid.evaluate((el) => (el.readyState >= 1 && el.duration > 0 ? { d: el.duration, w: el.videoWidth } : null)).catch(() => null), 15000)
  ok(!!loaded && loaded.d >= 5 && loaded.w > 0 && await p.locator('.mt-transcript:not(.off)').isVisible(), 'the Video view plays it, with the transcript beside it', loaded)
  await shot(p, `${tag}video-playing`)
  const at = () => vid.evaluate((el) => el.currentTime)
  const line = p.locator('.mt-transcript .mt-line', { hasText: 'And the second line' })
  await line.locator('.mt-text').click()
  const jumped = await until(async () => { const s = await at(); return Math.abs(s - 4.5) < 0.8 && s }, 6000, 200)
  ok(jumped !== null, "a click on a line moves the video to when it was said", { at: await at() })
  await p.locator('.mt-transcript .mt-line', { hasText: 'Here is the first slide' }).locator('.mt-t-play').click()
  const back = await until(async () => { const s = await at(); return Math.abs(s - 1.5) < 0.8 && s }, 6000, 200)
  ok(back !== null, "and its time plays it from there", { at: await at() })
  ok(!!(await until(() => p.locator('.mt-transcript .mt-line.now', { hasText: 'Here is the first slide' }).count(), 5000)), 'the line being said as it plays is marked')
  ok(/MP4|WEBM/.test(await p.locator('.mt-video-meta').innerText()) && /Kept on this computer\./.test(await p.locator('.mt-video-meta').innerText()), 'what it is, how big and that it stays on this computer, under it', await p.locator('.mt-video-meta').innerText())

  // Remembered on this device.
  await p.reload()
  await p.waitForSelector('.rail-nav-row', { timeout: 15000 }).catch(() => {})
  await toList()
  ok(await choice.isChecked().catch(() => false), 'the choice is kept')

  // The disk nearly full while it records: said on the recording bar, then on the meeting.
  await p.locator('.pane-head button', { hasText: 'Start recording' }).click()
  const R2 = await until(async () => (await api('/meetings')).meetings.find((x) => x.status === 'recording'), 15000)
  await until(() => chip.isVisible(), 15000)
  await until(async () => (await api(`/meetings/${R2.id}`)).videos?.[0]?.bytes > 0, 12000)
  await keepFree(1e9)
  const note = p.locator('.mt-recbar .mt-screen-note')
  ok(!!(await until(async () => /The screen stopped being recorded: Stopped with .* free on this computer's disk/.test(await note.innerText().catch(() => '')), 12000)) && !(await chip.isVisible()), 'the disk nearly full: it stops recording the screen, and the recording bar says why', await p.locator('.mt-recbar').innerText().catch(() => ''))
  await shot(p, `${tag}video-disk-full`)
  ok((await api(`/meetings/${R2.id}`)).status === 'recording', 'and the meeting records on')
  await p.locator('.mt-recbar button.danger-soft', { hasText: 'Stop' }).click()
  await keepFree(0)
  ok(!!(await until(async () => /The video of the screen ends at .*Stopped with .* free/.test(await p.locator('.mt-video-why').first().innerText().catch(() => '')), 15000)), 'the meeting says why its video ends early', await p.locator('.mt-page').innerText().catch(() => ''))
  ok(withoutCutOff(errors).length === 0, 'no page errors', errors)
  await ctx.close()

  // ---------- Where the screen can't be recorded ----------
  const without = async (what, init, o = {}) => {
    const x = await page(b, kit.url, { store: { 'cc-rail-meetings': true, 'cc-record-screen': true }, ...o, before: (c) => c.addInitScript(init) })
    await x.p.waitForSelector('.rail-nav-row, .phone-tabs, .app', { timeout: 15000 }).catch(() => {})
    await until(async () => { await x.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } }))); return x.p.locator('.mt-home').isVisible() }, 10000, 1000)
    ok(await x.p.locator('.mt-home').isVisible() && (await x.p.locator('.mt-video-choice').count()) === 0, `${what}: no Record the screen too`)
    await x.ctx.close()
  }
  await without('a browser that can\'t share a screen', () => { try { delete MediaDevices.prototype.getDisplayMedia } catch { /* none */ } })
  await without('a phone (its browser shares no screen)', () => {}, { phone: true })
  await without('a browser that can\'t make a video', () => { try { delete window.MediaRecorder } catch { /* none */ } })

  // The desktop app on a Mac (stood in for) that needs Screen Recording to record the screen, and
  // doesn't have it: what to turn on. With macOS's own picker (15 and later), nothing.
  for (const picker of [false, true]) {
    const x = await page(b, kit.url, { store: { 'cc-rail-meetings': true, 'cc-record-screen': true }, before: async (c) => {
      await c.addInitScript(() => { window.bridgeApp = { desktop: true, platform: 'darwin' } })
      await c.route('**/api/calls/screen*', (r) => r.fulfill({ json: { allowed: false, started: new Date().toISOString(), picker } }))
    } })
    await x.p.waitForSelector('.rail-nav-row', { timeout: 15000 }).catch(() => {})
    await until(async () => { await x.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } }))); return x.p.locator('.mt-home').isVisible() }, 10000, 1000)
    const allow = x.p.locator('.mt-home .mt-video-allow')
    if (!picker) {
      ok(!!(await until(async () => /Screen Recording/.test(await allow.innerText().catch(() => '')), 8000)) && await allow.locator('button', { hasText: 'Open it' }).isVisible(), "the desktop app on a Mac without Screen Recording: Record the screen too says what to turn on, with Open it", await x.p.locator('.mt-home').innerText().catch(() => ''))
      // The header keeps its name, its tabs and Start recording beside the choice.
      const head = await x.p.evaluate(() => { const h = document.querySelector('.pane-head').getBoundingClientRect(); return [...document.querySelectorAll('.pane-head h2, .pane-head .mt-video-choice, .pane-head .btn.primary')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.innerText.trim(), w: Math.round(r.width), in: r.right <= h.right + 1 && r.width > 0 } }) })
      ok(head.length === 3 && head.every((e) => e.in && e.w > 20), 'and the header keeps its name, the choice and Start recording, whole', head)
      await shot(x.p, `${tag}video-screen-recording`)
    } else {
      await sleep(1500)
      ok(await x.p.locator('.mt-video-choice').isVisible() && (await allow.count()) === 0, "with macOS's own picker, which needs no Screen Recording: nothing to turn on")
    }
    await x.ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
