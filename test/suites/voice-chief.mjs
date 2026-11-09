// The voice Chief of Staff, in the browser named by BRIDGE_TEST_BROWSER: ask it out loud and hear
// the answer. A stand-in Claude Code runs the Chief of Staff, speech to text is stood in for
// (/api/transcribe answers what was said), and so is the Chief of Staff's answer (its transcript),
// and the device's voices (speechSynthesis: a Mac's, as Safari and as Chrome name them, and one
// Chrome would fetch from the internet). eSpeak NG on the computer is a stand-in script that
// writes a WAV (BRIDGE_ESPEAK); the natural voice runs on the stand-in for sherpa-onnx
// (stand-ins/sherpa.cjs), its small fake model served from this computer.
//   Ask out loud above the Chief of Staff's message box: held, the pill says "To Chief of Staff";
//   let go, what was said goes to it marked "(Asked out loud)"; once it's answered, the answer is
//   read aloud for the ear (no Markdown, pane ids or links' addresses) by the device's own voice,
//   never the internet one; Stop, Again. Its instructions say how to answer out loud. Kept in the
//   history as sent to the Chief of Staff. On a phone, held with a finger.
//   Interrupting: Esc stops it at once, and so does pressing Ask out loud again (before it listens).
//   Settings › Voice › Spoken Answers: this device's own voices, the most natural first and picked
//   (Premium, then Enhanced, then the rest; novelty voices left out; Chrome's two of one name once),
//   a speed, Test; with only basic voices on a Mac, where to download better ones.
//   The natural voice, where it can run (the rules for each kind of computer): offered beside the
//   device's voices, its size said before anything downloads; downloaded, picked, a Test made on
//   the computer and played here; which of its ten under Advanced, and the speed with it. Asked
//   out loud, the answer is made a sentence or two at a time, the first on its own; Esc stops it.
//   Failing before a word, the device's own voice reads it and says why. Removed: the device's
//   voice again. With no voice of its own, the device uses it rather than eSpeak NG.
//   A device with no voice of its own: the computer's eSpeak NG reads it (the words given as
//   words, never options); with neither, Ask out loud isn't offered and Settings says answers stay
//   in the chat.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSpeechModels, checks, until, sleep, browser, page, shot, noServiceWorker, TEST, OUT } from '../lib/harness.mjs'

const { ok, done } = checks('voice-chief')

// ---------- Where the natural voice can run: the rules, for every kind of computer ----------
process.env.BRIDGE_HOME = path.join(OUT, 'kits', 'voice-chief-rules')
const vs = await import('../../server/voicespeak.js')
for (const [what, m, shown, why] of [
  ['a Mac on Apple Silicon', { platform: 'darwin', arch: 'arm64', os: '26.1', memGB: 16 }, true],
  ['an Intel Mac', { platform: 'darwin', arch: 'x64', os: '15.4', memGB: 8 }, true],
  ['Windows x64', { platform: 'win32', arch: 'x64', memGB: 8 }, true],
  ['Linux x64 with glibc 2.35', { platform: 'linux', arch: 'x64', glibc: '2.35', memGB: 8 }, true],
  ['Linux x64 with glibc 2.31', { platform: 'linux', arch: 'x64', glibc: '2.31', memGB: 8 }, false, /glibc 2\.32 or later/],
  ['32-bit Arm Linux', { platform: 'linux', arch: 'arm', glibc: '2.36', memGB: 4 }, false, /no build for linux on arm/],
  ['a computer with 1 GB of memory', { platform: 'linux', arch: 'x64', glibc: '2.35', memGB: 1 }, false, /needs 2 GB of memory; this computer has 1 GB/],
]) {
  const r = vs.fitNatural(m)
  ok(r.ok === shown && (shown ? !r.why : why.test(r.why || '')), `${what}: the natural voice ${shown ? 'is offered' : 'isn\'t, and the diagnostics say why'}`, r)
}
ok(!vs.fitNatural({ platform: 'darwin', arch: 'x64', os: '14.7', memGB: 8 }, { probe: { ok: false, error: 'Symbol not found' } }).ok, 'nor where sherpa-onnx doesn\'t load')

const models = await startSpeechModels('voice-chief')
const kit = await startKit('voice-chief', { env: ({ bin }) => ({ ...models.env()({ bin }), CLAUDE_STAND_IN: 'fresh', BRIDGE_ESPEAK: path.join(bin, 'espeak-ng.cjs') }) })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
// eSpeak NG: its arguments noted, a WAV (a tenth of a second of quiet) on its stdout.
kit.program('espeak-ng', `const fs = require('node:fs'); const path = require('node:path')
fs.appendFileSync(path.join(__dirname, 'espeak.log'), JSON.stringify(process.argv.slice(2)) + '\\n')
const n = 2205; const b = Buffer.alloc(44 + n * 2)
b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(22050, 24); b.writeUInt32LE(44100, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
process.stdout.write(b)`)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const real = (errors) => errors.filter((e) => !/\/api\/\S+ due to access control checks/.test(e))
// What the stand-in engine was asked to read, since `from` lines of its log.
const sherpaLog = path.join(kit.bin, '..', 'sherpa.log')
const logLines = () => { try { return fs.readFileSync(sherpaLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const spoken = (from = 0) => logLines().slice(from).filter((x) => x.tts)

const ANSWER = '**Two agents need you.**\n- `payments (w1:2)` asks whether to run the migration.\n- billing (w2:1) is waiting on a review of [PR 42](https://github.com/acme/billing/pull/42).'
const HEARD = 'Two agents need you. payments asks whether to run the migration. billing is waiting on a review of PR 42.'
const SAMPLE = 'Two agents need you. The payments agent is asking whether to run the migration.'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

// A page with the device's voices as given (null: none at all), what it says kept in __said, what
// the computer's sound did in __played (each answer's piece) and __paused, and the Chief of
// Staff's prompt and answer stood in for. o.ua: the browser it says it is; o.playMs: how long each
// piece of the computer's sound lasts.
const prompts = []
const open = (voices, o = {}) => page(b, kit.url, { ...o, before: async (ctx) => {
  await noServiceWorker(ctx)
  if (which === 'webkit') {
    await ctx.addInitScript(() => {
      const tone = async () => { const ac = new AudioContext(); const os = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); os.connect(dest); os.start(); return dest.stream }
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: tone, configurable: true, writable: true })
    })
  }
  await ctx.addInitScript(({ vs, ua, playMs }) => {
    window.__said = []
    window.__cancels = 0
    window.__played = 0
    window.__paused = 0
    if (ua) { Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ua, configurable: true }); Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 0, configurable: true }) }
    const list = (vs || []).map((v) => ({ voiceURI: v.name, lang: 'en-US', default: false, ...v }))
    const synth = {
      getVoices: () => list,
      speak: (u) => { window.__said.push({ text: u.text, voice: u.voice?.name || null, uri: u.voice?.voiceURI || null, rate: u.rate }); u.__t = setTimeout(() => u.onend?.(), 1500); synth.last = u },
      cancel: () => { window.__cancels++; if (synth.last) { clearTimeout(synth.last.__t); synth.last.onend?.() } },
      addEventListener() {}, removeEventListener() {},
    }
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
    // An utterance as the browser's, but taking these stand-in voices.
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.voice = null; this.rate = 1 } }
    // The computer's sound plays here: each piece of an answer counted (the silent moment that lets
    // a phone play it later isn't), and ended after a while; paused at once.
    HTMLMediaElement.prototype.play = function () {
      if (String(this.src).startsWith('blob:')) { window.__played++; this.__t = setTimeout(() => this.dispatchEvent(new Event('ended')), playMs || 100) }
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function () { window.__paused++; clearTimeout(this.__t); this.dispatchEvent(new Event('pause')) }
  }, { vs: voices, ua: o.ua || null, playMs: o.playMs || 0 })
  await ctx.route('**/api/transcribe', (route) => route.fulfill({ json: { text: o.said || "what's blocked" } }))
  await ctx.route('**/api/voice', (route) => route.fulfill({ json: { ready: true, model: true, missing: [] } }))
  if (o.noEspeak) await ctx.route('**/api/voice/speak', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { espeak: false, natural: null } }) : route.fallback()))
  // No eSpeak NG on the computer, the natural voice as it really is.
  if (o.onlyNatural) await ctx.route('**/api/voice/speak', async (route) => { if (route.request().method() !== 'GET') return route.fallback(); const r = await route.fetch(); await route.fulfill({ json: { ...(await r.json()), espeak: false } }) })
  await ctx.route(/\/api\/agents\/[^/]+\/(prompt|queue)$/, async (route) => { prompts.push(route.request().postDataJSON().text); await route.fulfill({ json: { ok: true } }) })
  await ctx.route(/\/api\/agents\/[^/]+\/transcript$/, (route) => {
    const q = prompts.at(-1)
    route.fulfill({ json: { supported: true, messages: q ? [{ role: 'user', text: q }, { role: 'assistant', text: 'Let me look.' }, { role: 'tool', text: 'bridge agents' }, { role: 'assistant', text: ANSWER }] : [] } })
  })
} })
const LOCAL = [{ name: 'Samantha', localService: true, default: true }, { name: 'Google US English', localService: false }]
// A Mac's voices as Safari names them (each id says how good it is), and as Chrome and the desktop
// app do (names only: two of one voice named by their language).
const SAFARI = [
  { name: 'Samantha', voiceURI: 'com.apple.voice.compact.en-US.Samantha', localService: true, default: true },
  { name: 'Albert', voiceURI: 'com.apple.speech.synthesis.voice.Albert', localService: true, default: true },
  { name: 'Eddy (English (US))', voiceURI: 'com.apple.eloquence.en-US.Eddy', localService: true, default: true },
  { name: 'Ava', voiceURI: 'com.apple.voice.enhanced.en-US.Ava', localService: true, default: true },
  { name: 'Ava', voiceURI: 'com.apple.voice.premium.en-US.Ava', localService: true, default: true },
  { name: 'Google US English', localService: false },
]
const CHROME = [
  { name: 'Samantha', localService: true, default: true },
  { name: 'Bad News', localService: true },
  { name: 'Ava (English (United States))', localService: true },
  { name: 'Ava (English (United States))', localService: true },
  { name: 'Google US English', localService: false },
]
const toChief = async (p) => {
  await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await p.locator('.rail-chief').click()
  await p.locator('.ask-bar').waitFor({ timeout: 15000 })
}
const toSettings = async (p) => {
  await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'voice' } })))
  const sec = p.locator('.st-voice-out')
  await sec.waitFor({ timeout: 10000 })
  return sec
}
const hold = async (p, el, ms = 1400) => {
  const r = await el.boundingBox()
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await p.mouse.down()
  await sleep(ms)
  await p.mouse.up()
}
const natural = () => kit.api('/voice/speak').then((s) => s.natural)

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  await kit.api('/chief/launch', {})
  ok(!!(await until(async () => ((await kit.api('/fleet')).agents || []).some((a) => a.chief), 30000, 500)), 'a stand-in Chief of Staff')
  const md = fs.readFileSync(path.join(kit.data, 'chief', 'CLAUDE.md'), 'utf8')
  ok(/## Asked out loud/.test(md) && /\(Asked out loud\)/.test(md) && /no lists, tables, headings, code, links or pane ids/.test(md), 'its instructions say how to answer a question asked out loud: short, for the ear')

  for (const mode of ['light', 'dark']) {
    const { ctx, p, errors } = await open(LOCAL, { mode })
    await toChief(p)
    const btn = p.locator('.ask-btn')
    ok(/Ask out loud/.test(await btn.innerText()), `${mode}: Ask out loud, above the Chief of Staff's message box`)
    // Held: the pill says who it's for.
    const r = await btn.boundingBox()
    await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await p.mouse.down()
    ok(!!(await until(async () => /To Chief of Staff/.test(await p.locator('.dict-dock').innerText().catch(() => '')), 5000, 100)), `${mode}: held: the pill, "To Chief of Staff"`)
    await sleep(1200)
    await shot(p, `${tag}voice-chief-asking-${mode}`)
    await p.mouse.up()
    ok(!!(await until(() => prompts.at(-1) === "(Asked out loud) What's blocked.", 8000, 100)), `${mode}: let go: what was said goes to the Chief of Staff, marked as asked out loud`, prompts.at(-1))
    const said = await until(() => p.evaluate(() => window.__said.filter((x) => x.text.trim()).at(-1)), 10000, 200)
    ok(said?.text === HEARD, `${mode}: its answer, once it's in, read aloud for the ear (no Markdown, pane ids or links' addresses)`, [said, await p.locator('.ask-line').innerText().catch(() => '')])
    ok(said?.voice === 'Samantha', `${mode}: by the device's own voice, never one fetched from the internet`, said)
    ok(/Reading the answer aloud/.test(await p.locator('.ask-line').innerText()) && await p.locator('.ask-bar button', { hasText: 'Stop' }).isVisible(), `${mode}: it says so, with Stop`)
    await shot(p, `${tag}voice-chief-speaking-${mode}`)
    await p.locator('.ask-bar button', { hasText: 'Stop' }).click()
    ok(await p.evaluate(() => window.__cancels) > 0 && !!(await until(() => p.locator('.ask-bar button', { hasText: 'Again' }).isVisible(), 3000, 100)), `${mode}: Stop stops it; Again is there to hear it once more`)
    const n = await p.evaluate(() => window.__said.length)
    await p.locator('.ask-bar button', { hasText: 'Again' }).click()
    ok(!!(await until(() => p.evaluate((k) => window.__said.length > k && window.__said.at(-1).text, n), 3000, 100)), `${mode}: Again: read once more`)
    if (mode === 'light') {
      // Esc while it reads: stopped at once.
      await until(() => p.locator('.ask-bar button', { hasText: 'Stop' }).isVisible(), 3000, 100)
      const c0 = await p.evaluate(() => window.__cancels)
      await p.keyboard.press('Escape')
      ok(!!(await until(async () => (await p.evaluate(() => window.__cancels)) > c0 && !/Reading the answer aloud/.test(await p.locator('.ask-line').innerText()), 1000, 50)), 'Esc while it reads: it stops at once')
      // Asked again while it reads: stopped as the button goes down, before it listens.
      await p.locator('.ask-bar button', { hasText: 'Again' }).click()
      await until(() => p.locator('.ask-bar button', { hasText: 'Stop' }).isVisible(), 3000, 100)
      const c1 = await p.evaluate(() => window.__cancels)
      const n1 = await p.evaluate(() => window.__said.filter((x) => x.text.trim()).length)
      const r2 = await btn.boundingBox()
      await p.mouse.move(r2.x + r2.width / 2, r2.y + r2.height / 2)
      await p.mouse.down()
      ok((await p.evaluate(() => window.__cancels)) > c1, 'pressing Ask out loud again while it reads stops it at once, before it listens')
      await sleep(1200)
      await p.mouse.up()
      ok(!!(await until(() => p.evaluate(([h, k]) => { const s = window.__said.filter((x) => x.text.trim()); return s.length > k && s.at(-1).text === h }, [HEARD, n1]), 10000, 200)), 'and then it listens, and the new answer is read')
    }
    ok(real(errors).length === 0, `${mode}: no page errors`, errors)
    await ctx.close()
  }
  const kept = await until(async () => (await kit.api('/dictations?limit=20')).items.find((x) => x.text === "What's blocked." || x.text === "What's blocked?"), 5000, 200)
  ok(kept?.how === 'sent' && kept.agent?.chief === true, 'kept in the history as sent to the Chief of Staff', kept)

  // Settings › Voice › Spoken Answers: this device's own voices, a speed, Test.
  {
    const { ctx, p } = await open(LOCAL)
    const sec = await toSettings(p)
    const names = await sec.locator('select').first().locator('option').allInnerTexts()
    ok(names.length === 2 && /Samantha/.test(names[0]) && /^Natural voice, made on your computer \(145 MB download\)$/.test(names[1]), 'Settings › Voice › Spoken Answers: this device\'s own voices (never the internet one), and the natural voice with its size', names)
    await sec.locator('select').nth(1).selectOption('1.15')
    await sec.locator('button', { hasText: 'Test' }).click()
    const tst = await until(() => p.evaluate(() => window.__said.at(-1)), 3000, 100)
    ok(tst?.voice === 'Samantha' && tst.rate === 1.15, 'a speed, kept on this device, and Test reads with them', tst)
    await shot(p, `${tag}voice-chief-settings`)
    await ctx.close()
  }

  // The most natural voice first, and picked: as Safari names a Mac's voices, and as Chrome does.
  {
    const { ctx, p, errors } = await open(SAFARI, { ua: MAC_UA })
    const sec = await toSettings(p)
    const names = await sec.locator('select').first().locator('option').allInnerTexts()
    ok(names.length === 5 && /^Ava · Premium/.test(names[0]) && /^Ava · Enhanced/.test(names[1]) && /^Samantha/.test(names[2]) && /^Eddy/.test(names[3]) && /^Natural voice/.test(names[4]), 'Safari\'s names: Premium, then Enhanced, then the usual, then the robotic; novelty voices and the internet one left out', names)
    ok(await sec.locator('select').first().inputValue() === 'com.apple.voice.premium.en-US.Ava' && await sec.locator('.st-better').count() === 0, 'the Premium one picked, with nothing to say about better voices')
    await sec.locator('button', { hasText: 'Test' }).click()
    const tst = await until(() => p.evaluate(() => window.__said.at(-1)), 3000, 100)
    ok(tst?.uri === 'com.apple.voice.premium.en-US.Ava', 'and Test reads with it', tst)
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  {
    const { ctx, p, errors } = await open(CHROME, { ua: MAC_UA })
    await toChief(p)
    await hold(p, p.locator('.ask-btn'))
    const said = await until(() => p.evaluate(() => window.__said.filter((x) => x.text.trim()).at(-1)), 10000, 200)
    ok(said?.voice === 'Ava (English (United States))', 'Chrome\'s names: the voice with a Premium or Enhanced one installed (named by its language) reads, not the compact default', said)
    const sec = await toSettings(p)
    const names = await sec.locator('select').first().locator('option').allInnerTexts()
    ok(names.length === 3 && /^Ava \(English \(United States\)\)/.test(names[0]) && /^Samantha/.test(names[1]), 'listed once, first; Bad News left out', names)
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  // Only the basic voices on a Mac: where to get better ones, in macOS's words.
  {
    const { ctx, p } = await open(LOCAL, { ua: MAC_UA })
    const sec = await toSettings(p)
    const t = await sec.locator('.st-better').innerText().catch(() => '')
    ok(/System Settings › Accessibility › Read & Speak › System voice › Manage Voices/.test(t) && /Premium or Enhanced/.test(t) && /Natural voice/.test(t), 'only basic voices on a Mac: where to download a Premium or Enhanced one, or the natural voice', t)
    await ctx.close()
  }

  // No voice of its own: the computer's eSpeak NG (the natural voice isn't downloaded yet).
  {
    const { ctx, p, errors } = await open(null)
    await toChief(p)
    await hold(p, p.locator('.ask-btn'))
    ok(!!(await until(() => p.evaluate(() => window.__played > 0), 10000, 200)), 'a device with no voice of its own: the computer\'s eSpeak NG reads it, and it plays here')
    const log = fs.readFileSync(path.join(kit.bin, 'espeak.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    ok(log.at(-1).join(' ') === `-v en --stdout -- ${HEARD}`, 'the words given after --, as words, never options', log.at(-1))
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  // Neither: not offered.
  {
    const { ctx, p } = await open(null, { noEspeak: true })
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await p.locator('.rail-chief').click()
    await p.locator('textarea[data-composer]').first().waitFor({ timeout: 15000 })
    await sleep(800)
    ok(await p.locator('.ask-bar').count() === 0, 'with no voice anywhere: Ask out loud isn\'t offered')
    const sec = await toSettings(p)
    ok(/stay in the chat/.test(await sec.innerText()), 'and Settings says answers stay in the chat', await sec.innerText())
    await ctx.close()
  }
  // Only the natural voice, not downloaded yet: nothing reads until it's picked, and Settings says so.
  {
    const { ctx, p, errors } = await open(null, { onlyNatural: true })
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await p.locator('.rail-chief').click()
    await p.locator('textarea[data-composer]').first().waitFor({ timeout: 15000 })
    await sleep(800)
    ok(await p.locator('.ask-bar').count() === 0, 'only the natural voice, not downloaded: Ask out loud isn\'t offered yet')
    const sec = await toSettings(p)
    const names = await sec.locator('select').first().locator('option').allInnerTexts()
    ok(names.length === 2 && names[0] === 'None' && /^Natural voice/.test(names[1]) && /until you pick Natural voice/.test(await sec.innerText()), 'and Settings offers it, saying answers stay in the chat until it\'s picked', [names, await sec.innerText()])
    await sec.locator('select').first().selectOption('natural')
    ok(await sec.locator('.st-natural-ask').isVisible(), 'picking it asks first')
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // The natural voice: asked first, with its size; then downloaded, picked and tried.
  {
    const { ctx, p, errors } = await open(LOCAL)
    const sec = await toSettings(p)
    const pickBox = sec.locator('select').first()
    await pickBox.selectOption('natural')
    const ask = sec.locator('.st-natural-ask')
    await ask.waitFor({ timeout: 3000 })
    const words = await ask.innerText()
    ok(/made on your computer by Supertonic 3, so nothing you hear leaves it/.test(words) && /one download of 145 MB, from Hugging Face/.test(words) && /OpenRAIL-M, by Supertone/.test(words), 'picking the natural voice: what it is, that it stays on the computer, its size and licence, said first', words)
    await sleep(300)
    ok(!models.asked.some((x) => x.name === 'vocoder.int8.onnx') && !(await natural()).have, 'and nothing downloads until it\'s asked for', models.asked)
    await ask.scrollIntoViewIfNeeded()
    await shot(p, `${tag}voice-chief-natural-ask`)
    await ask.locator('button', { hasText: 'Cancel' }).click()
    ok(await ask.count() === 0 && /Samantha/.test(await pickBox.locator('option:checked').innerText()), 'Cancel: the device\'s voice stays picked')
    await pickBox.selectOption('natural')
    await ask.locator('button', { hasText: 'Download' }).click()
    ok(!!(await until(async () => (await natural()).have, 15000, 200)), 'Download: it comes from where models come from, checked, and is there', await natural())
    ok(fs.existsSync(path.join(kit.data, 'models', 'supertonic-3', 'vector_estimator.int8.onnx')), 'in the data folder\'s models, beside the speech models')
    ok(!!(await until(async () => /^Natural voice, made on your computer$/.test(await pickBox.locator('option:checked').innerText()), 5000, 200)), 'and picked', await pickBox.locator('option:checked').innerText())
    const from = logLines().length
    await sec.locator('button', { hasText: 'Test' }).click()
    ok(!!(await until(() => p.evaluate(() => window.__played > 0), 8000, 100)), 'Test: made on the computer, played here')
    // The next piece is made while the first plays: waited for, not read the moment the first is heard.
    const heard = (await until(() => { const h = spoken(from); return h.length >= 2 && h }, 8000, 100)) || spoken(from)
    ok(heard[0]?.tts === 'Two agents need you.' && heard[1]?.tts === 'The payments agent is asking whether to run the migration.' && heard[0].lang === 'en' && heard[0].sid === 0 && heard[0].speed === 1.2, 'a sentence at a time, the first on its own, in the app\'s language, at the usual pace', heard)
    ok(await p.evaluate(() => window.__said.filter((x) => x.text.trim()).length) === 0, 'and the device\'s own voice said nothing')
    // Advanced: which of its ten, and the speed with it.
    await sec.locator('.st-natural > summary').click()
    const voices = await sec.locator('.st-natural select option').allInnerTexts()
    ok(voices.length === 10 && voices[0] === 'Female 1' && voices[5] === 'Male 1', 'Advanced: its ten voices, five women\'s and five men\'s', voices)
    await sec.locator('.st-natural select').selectOption('5')
    await sec.locator('select').nth(1).selectOption('1.15')
    const from2 = logLines().length
    await sec.locator('button', { hasText: 'Test' }).click()
    const h2 = await until(() => spoken(from2)[0], 5000, 100)
    ok(h2?.sid === 5 && h2.speed === 1.38, 'the one picked, at the speed picked', h2)
    await shot(p, `${tag}voice-chief-natural-settings`)
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // Asked out loud, with the natural voice picked on this device: made a piece at a time and played
  // here; Esc stops it at once, and nothing more is played.
  {
    const store = { 'cc-voice': { voice: 'natural', natural: 2 } }
    const { ctx, p, errors } = await open(LOCAL, { store, playMs: 2500 })
    await toChief(p)
    const from = logLines().length
    await hold(p, p.locator('.ask-btn'))
    ok(!!(await until(() => p.evaluate(() => window.__played === 1), 10000, 100)), 'asked out loud: the natural voice\'s first piece plays here')
    ok(/Reading the answer aloud/.test(await p.locator('.ask-line').innerText()), 'and it says so')
    const heard = await until(() => (spoken(from).length >= 2 ? spoken(from) : null), 5000, 100)
    ok(heard?.[0]?.tts === 'Two agents need you.' && heard[1]?.tts === 'payments asks whether to run the migration. billing is waiting on a review of PR 42.' && heard[0].sid === 2, 'the answer for the ear, the first sentence on its own and the next made while it plays', heard)
    await p.keyboard.press('Escape')
    ok(!!(await until(async () => (await p.evaluate(() => window.__paused)) > 0 && !/Reading the answer aloud/.test(await p.locator('.ask-line').innerText()), 1000, 50)), 'Esc: it stops at once')
    await sleep(2800)
    ok(await p.evaluate(() => window.__played) === 1 && await p.evaluate(() => window.__said.filter((x) => x.text.trim()).length) === 0, 'and nothing more is played', await p.evaluate(() => window.__played))
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  // Failing before a word: the device's own voice reads it, and says why.
  {
    const fail = path.join(kit.data, 'models', 'supertonic-3', 'fail')
    fs.writeFileSync(fail, '')
    const { ctx, p, errors } = await open(LOCAL, { store: { 'cc-voice': { voice: 'natural' } } })
    await toChief(p)
    await hold(p, p.locator('.ask-btn'))
    const said = await until(() => p.evaluate(() => window.__said.filter((x) => x.text.trim()).at(-1)), 10000, 200)
    ok(said?.text === HEARD && said.voice === 'Samantha', 'the natural voice failing: the device\'s own voice reads it instead', said)
    const line = await until(async () => { const l = await p.locator('.ask-line').innerText(); return /didn't read it/.test(l) ? l : null }, 5000, 100)
    ok(/The natural voice didn't read it \(stand-in: the voice failed\), so this device's own voice did/.test(line || ''), 'and says why', line)
    fs.rmSync(fail)
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  // No voice of its own, the natural voice downloaded: it reads, not eSpeak NG.
  {
    const before = fs.readFileSync(path.join(kit.bin, 'espeak.log'), 'utf8')
    const { ctx, p, errors } = await open(null, { phone: true, said: 'anything for me' })
    const from = logLines().length
    const btn = p.locator('.ask-btn')
    await btn.waitFor({ timeout: 15000 })
    await btn.dispatchEvent('pointerdown', { button: 0, pointerType: 'touch', isPrimary: true, pointerId: 6 })
    await sleep(1400)
    await p.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerType: 'touch', isPrimary: true, pointerId: 6 })))
    ok(!!(await until(() => p.evaluate(() => window.__played >= 2), 10000, 100)) && spoken(from).length >= 2 && fs.readFileSync(path.join(kit.bin, 'espeak.log'), 'utf8') === before, 'a phone with no voice of its own: the computer\'s natural voice reads it, played on the phone, not eSpeak NG', spoken(from))
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  // Removed: the device's own voice again.
  {
    const { ctx, p, errors } = await open(LOCAL, { store: { 'cc-voice': { voice: 'natural' } } })
    const sec = await toSettings(p)
    await sec.locator('.st-natural > summary').click()
    await sec.locator('.st-natural button[aria-label="Remove Natural voice"]').click()
    ok(!!(await until(async () => !(await natural()).have && !fs.existsSync(path.join(kit.data, 'models', 'supertonic-3')), 5000, 200)), 'Remove: the download is gone')
    ok(!!(await until(async () => /Samantha/.test(await sec.locator('select').first().locator('option:checked').innerText()), 3000, 100)), 'and the device\'s own voice is picked again')
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // On a phone: the Chief tab, held with a finger.
  {
    const { ctx, p, errors } = await open(LOCAL, { phone: true, said: 'anything for me' })
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    const btn = p.locator('.ask-btn')
    await btn.waitFor({ timeout: 15000 })
    await btn.dispatchEvent('pointerdown', { button: 0, pointerType: 'touch', isPrimary: true, pointerId: 5 })
    await sleep(1400)
    await p.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerType: 'touch', isPrimary: true, pointerId: 5 })))
    ok(!!(await until(() => prompts.at(-1) === '(Asked out loud) Anything for me.', 8000, 100)) && !!(await until(() => p.evaluate((h) => window.__said.at(-1)?.text === h, HEARD), 10000, 200)), 'on a phone: held with a finger, asked, and the answer read aloud', prompts.at(-1))
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
    ok(w[0] <= w[1], 'nothing wider than the phone', w)
    await shot(p, `${tag}voice-chief-phone`)
    ok(real(errors).length === 0, 'no page errors on the phone', errors)
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
