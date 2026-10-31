// Live words while you talk, in the browser named by BRIDGE_TEST_BROWSER, with the stand-in for
// sherpa-onnx's addon hearing a word for each half second of sound (BRIDGE_SHERPA_SAYS=@words) and
// a small fake Parakeet served from this computer (harness.startSpeechModels).
//   Where they work: not before the speech model is here; once it is, the sound sent as it comes
//   is heard so far, the words before a pause kept and the rest heard again; with Whisper picked,
//   hidden (it hears a recording whole); turned off in Settings, nothing is sent.
//   Dictation: the words while you talk, in the pill inside Bridge AI, in the message box's
//   recording bar and in the dictation window from another app (?dictate=1), and the finished text
//   as before; in a light and a dark theme.
//   Meetings: what someone is still saying, under the transcript, until its line is in.
//   A computer too slow to keep up (the stand-in taking 90% of the sound's length): live words stop
//   for that dictation, the words come when you let go, and Settings says so once.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSpeechModels, checks, until, sleep, browser, page, shot, noServiceWorker, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('live-words')
const models = await startSpeechModels('live-words')
const kit = await startKit('live-words', { env: models.env({ BRIDGE_SHERPA_SAYS: '@words' }) })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const MODEL = path.join(kit.data, 'models', 'parakeet-v3')

// Sound: a tone (heard as speech by the pause finder) and quiet.
const tone = (s) => { const n = Math.round(s * 16000); const a = new Int16Array(n); for (let i = 0; i < n; i++) a[i] = Math.round(Math.sin(i / 8) * 8000 * (0.6 + 0.4 * Math.sin(i / 3000))); return a }
const quiet = (s) => new Int16Array(Math.round(s * 16000))
const join = (...parts) => { const out = new Int16Array(parts.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of parts) { out.set(a, o); o += a.length } return out }
const feed = (sid, pcm) => fetch(`${kit.url}/api/dictation/live/${sid}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) }).then((r) => r.json())
// Half a second at a time, as the page sends it; the answers in order.
const talk = async (sid, pcm) => {
  const out = []
  for (let i = 0; i < pcm.length; i += 8000) { out.push(await feed(sid, pcm.slice(i, i + 8000))); await sleep(450) }
  await sleep(700)
  out.push(await feed(sid, new Int16Array(0)))
  return out
}
const real = (errors) => errors.filter((e) => !/\/api\/[\w/.?=&-]+ due to access control checks/.test(e))
// WebKit has no fake mic: a tone made in the page stands in for one.
const before = async (ctx) => {
  await noServiceWorker(ctx)
  if (which === 'webkit') {
    await ctx.addInitScript(() => {
      const tone2 = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); o.connect(dest); o.start(); return dest.stream }
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: tone2, configurable: true, writable: true })
    })
  }
}

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')

  // ---------- Where they work ----------
  const st0 = await kit.api('/dictation/live')
  ok(st0.can === false && st0.why === 'model', 'not before the speech model is on this computer', st0)
  await kit.api('/speech/models/parakeet-v3', {})
  ok(!!(await until(async () => (await kit.api('/dictation/live')).can === true, 20000, 300)), 'once Parakeet is here: live words can work', await kit.api('/dictation/live'))

  // ---------- Heard so far ----------
  const said = await talk('serverlive01', join(tone(1.5), quiet(0.8), tone(2.5)))
  const texts = said.map((r) => r.text || '')
  const last = texts.at(-1)
  ok(said.every((r) => r.live) && texts.some((x) => x && x.split(' ').length < 3) && last.split(' ').length >= 6, 'the sound sent as it comes: what\'s been heard so far, growing', texts)
  ok(/^ship the fix ship the fix/.test(last), 'the words before the pause kept, and the rest heard again from there', last)
  const log = fs.readFileSync(path.join(kit.dir, 'sherpa.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.seconds != null)
  ok(log.every((l) => l.seconds <= 3.2), 'each pass hears only from the last pause (never the whole of it again)', log.map((l) => l.seconds))
  await fetch(`${kit.url}/api/dictation/live/serverlive01`, { method: 'DELETE' })

  // Whisper picked: hidden.
  await kit.api('/settings', { speech: { model: 'base.en-q5_1' } }, 'PATCH')
  const w = await kit.api('/dictation/live')
  ok(w.can === false && w.why === 'whisper' && (await feed('serverlive02', tone(1))).live === false, 'with Whisper picked: not offered (it hears a recording whole)', w)
  await kit.api('/settings', { speech: null }, 'PATCH')

  // ---------- Dictation, in Bridge AI ----------
  const one = await kit.api('/agents/launch', { kind: 'claude', cwd: kit.home, label: 'payments', newSpace: 'payments' })
  await until(async () => ((await kit.api('/fleet')).agents || []).some((a) => a.paneId === one.paneId), 30000, 500)
  for (const mode of ['light', 'dark']) {
    const { ctx, p, errors } = await page(b, kit.url, { before, mode })
    const sent = []
    p.on('request', (r) => { if (/\/api\/dictation\/live\/\w+$/.test(r.url()) && r.method() === 'POST') sent.push(r.url()) })
    const mac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    const MODS = mac ? ['Alt'] : ['Control', 'Alt']
    const down = async () => { for (const m of MODS) await p.keyboard.down(m); await p.keyboard.down('Space') }
    const up = async () => { await p.keyboard.up('Space'); for (const m of [...MODS].reverse()) await p.keyboard.up(m) }
    await p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
    const box = p.locator('textarea[data-composer]').first()
    await box.waitFor({ timeout: 15000 })
    // The message box: its recording bar shows the words.
    await box.fill('')
    await box.click()
    await down()
    const inBar = await until(async () => { const x = await p.locator('.composer.rec .rec-live').innerText().catch(() => ''); return /^ship the/.test(x) && x }, 8000, 100)
    ok(!!inBar, `${mode}: the message box's recording bar: the words as you talk`, inBar)
    await sleep(800)
    await shot(p, `${tag}live-words-box-${mode}`)
    await up()
    ok(!!(await until(async () => /^Ship the fix/.test(await box.inputValue()), 10000, 100)), `${mode}: let go: the finished text, as before`, await box.inputValue())
    ok(sent.length >= 2, `${mode}: the sound went to the computer as it came`, sent.length)
    // Inside Bridge AI elsewhere (a search box): the pill shows them.
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('[role="dialog"] input').first().waitFor({ timeout: 5000 })
    await down()
    const inPill = await until(async () => { const x = await p.locator('.dict-dock .dp-live').innerText().catch(() => ''); return /^ship the/.test(x) && x }, 8000, 100)
    ok(!!inPill, `${mode}: the pill: the words as you talk, under the level and the time`, inPill)
    const pb = await p.locator('.dict-dock .dp').boundingBox()
    ok(pb && pb.width <= 420 && pb.height <= 70, `${mode}: and the pill stays small`, pb)
    await sleep(900)
    const r = await p.locator('.dict-dock .dp').boundingBox()
    await shot(p, `${tag}live-words-pill-${mode}`, { clip: { x: Math.round(r.x + r.width / 2 - 260), y: Math.round(r.y - 30), width: 520, height: Math.round(r.height + 50) } })
    await up()
    await p.keyboard.press('Escape')
    ok(real(errors).length === 0, `${mode}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- The dictation window ----------
  {
    const { ctx, p } = await page(b, `${kit.url}/?dictate=1`, { store: { 'cc-ws': { tabs: [one.paneId], active: one.paneId } }, before: async (c) => {
      await before(c)
      await c.addInitScript(() => { window.bridgeApp = { platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux', desktop: true, hudReady: async () => null, hudSize: () => {}, hudPhase: () => {}, hudHide: async () => {}, hudPointer: () => {} } })
    } })
    await p.locator('.hud').waitFor({ timeout: 10000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: 'down', at: Date.now(), app: 'Slack' } })))
    const words = await until(async () => { const x = await p.locator('.hud .dp-live').innerText().catch(() => ''); return /^ship the/.test(x) && x }, 8000, 100)
    ok(!!words, 'from another app: the dictation window\'s pill shows the words too', words)
    await sleep(800)
    await p.evaluate(() => { const s = document.createElement('style'); s.textContent = 'html.is-hud.is-hud, html.is-hud.is-hud body { background: linear-gradient(135deg, #dfe6ee, #c9d3df) !important; }'; document.head.append(s) })
    const r = await p.locator('.hud').boundingBox()
    await shot(p, `${tag}live-words-window`, { clip: { x: Math.round(r.x + r.width / 2 - 260), y: 0, width: 520, height: Math.round(r.y + r.height + 30) } })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: 'up', at: Date.now() } })))
    ok(!!(await until(async () => /^Ship the/.test(await p.locator('.hud-text').innerText().catch(() => '')), 10000, 100)), 'then the finished text in the card, as before', await p.locator('.hud').innerText().catch(() => ''))
    await ctx.close()
  }

  // ---------- Meetings ----------
  {
    const m = await kit.api('/meetings', { title: 'Standup' })
    const id = m.id
    let seq = 0
    const send = (pcm) => fetch(`${kit.url}/api/meetings/${id}/audio?src=you&seq=${seq++}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) })
    const speech = tone(4)
    let soFar = null
    for (let i = 0; i < speech.length; i += 8000) {
      await send(speech.slice(i, i + 8000))
      await sleep(400)
      const g = await kit.api(`/meetings/${id}`)
      if (g.partial?.you?.text && !g.transcript.length) soFar = g.partial.you
    }
    ok(/^ship the/.test(soFar?.text || ''), 'a meeting: what you\'re still saying, before its line is in', soFar)
    const { ctx, p } = await page(b, kit.url, { before })
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click({ timeout: 15000 })
    await p.locator('.mt-row-open', { hasText: 'Standup' }).first().click({ timeout: 10000 })
    await send(tone(1.5))
    const shown = await until(async () => /ship the/.test(await p.locator('.mt-so-far').innerText().catch(() => '')), 8000, 200)
    ok(!!shown, 'under the transcript, quieter than the lines that are in')
    await shot(p, `${tag}live-words-meeting`)
    // A pause: the stretch's own line comes in, and the words so far go.
    await send(quiet(1.2))
    const g = await until(async () => { const x = await kit.api(`/meetings/${id}`); return x.transcript.length && x }, 10000, 300)
    ok(!!g && !g.partial?.you, 'its line in: the words so far go', g && { lines: g.transcript.length, partial: g.partial })
    await ctx.close()
    await kit.api(`/meetings/${id}/stop`, {}).catch(() => {})
  }

  // ---------- Turned off ----------
  {
    const { ctx, p } = await page(b, kit.url, { before })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'voice' } })))
    const sec = p.locator('.st-dictation')
    await sec.waitFor({ timeout: 10000 })
    const box = sec.locator('label.st-check', { hasText: 'Show the words as you talk' })
    ok(!!(await until(() => box.isVisible(), 5000, 100)) && await box.locator('input').isChecked(), 'Settings › Voice › Dictation: "Show the words as you talk", on')
    await box.locator('input').click()
    ok(!!(await until(async () => (await kit.api('/dictation/live')).why === 'off', 5000, 100)), 'turned off: kept')
    await ctx.close()
    const d = await page(b, kit.url, { before })
    const sent = []
    d.p.on('request', (r) => { if (/\/api\/dictation\/live\/\w+$/.test(r.url())) sent.push(r.url()) })
    await d.p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
    const mbox = d.p.locator('textarea[data-composer]').first()
    await mbox.waitFor({ timeout: 15000 })
    await mbox.fill('')
    await mbox.click()
    const mac = await d.p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    const MODS = mac ? ['Alt'] : ['Control', 'Alt']
    for (const m of MODS) await d.p.keyboard.down(m)
    await d.p.keyboard.down('Space'); await sleep(1600); await d.p.keyboard.up('Space')
    for (const m of [...MODS].reverse()) await d.p.keyboard.up(m)
    ok(!!(await until(async () => /^Ship the/.test(await mbox.inputValue()), 10000, 100)) && sent.length === 0 && await d.p.locator('.rec-live').count() === 0, 'and nothing is sent as you talk; the words come when you let go', sent)
    await d.ctx.close()
    await kit.api('/settings', { dictation: { liveWords: null } }, 'PATCH')
  }

  // ---------- Too slow here ----------
  fs.writeFileSync(path.join(MODEL, 'slow'), '')
  const slow = await talk('serverlive03', tone(5))
  ok(slow.some((r) => r.live === false && r.why === 'slow') && (await kit.api('/dictation/live')).why === 'slow', 'a computer too slow to keep up: live words stop, and it\'s remembered', slow.map((r) => r.why || r.text))
  {
    const { ctx, p } = await page(b, kit.url, { before })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'voice' } })))
    const sec = p.locator('.st-dictation')
    await sec.waitFor({ timeout: 10000 })
    ok(!!(await until(async () => /too slowly to show the words as you talk/.test(await sec.innerText()), 5000, 100)) && await sec.locator('label.st-check', { hasText: 'Show the words as you talk' }).count() === 0, 'Settings says so once, with no switch that can\'t work here', await sec.innerText())
    await ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
  models.stop()
}
process.exit(done().fail ? 1 : 0)
