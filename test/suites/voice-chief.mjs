// The voice Chief of Staff, in the browser named by BRIDGE_TEST_BROWSER: ask it out loud and hear
// the answer. A stand-in Claude Code runs the Chief of Staff, speech to text is stood in for
// (/api/transcribe answers what was said), and so is the Chief of Staff's answer (its transcript),
// and the device's voices (speechSynthesis: one on the device, one Chrome would fetch from the
// internet). eSpeak NG on the computer is a stand-in program that writes a WAV.
//   Ask out loud above the Chief of Staff's message box: held, the pill says "To Chief of Staff";
//   let go, what was said goes to it marked "(Asked out loud)"; once it's answered, the answer is
//   read aloud for the ear (no Markdown, pane ids or links' addresses) by the device's own voice,
//   never the internet one; Stop, Again. Its instructions say how to answer out loud. Kept in the
//   history as sent to the Chief of Staff. On a phone, held with a finger.
//   Settings › Voice › Spoken Answers: this device's own voices only, a speed, Test.
//   A device with no voice of its own: the computer's eSpeak NG reads it (the words given as
//   words, never options); with neither, Ask out loud isn't offered and Settings says answers stay
//   in the chat.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, browser, page, shot, noServiceWorker, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('voice-chief')
const kit = await startKit('voice-chief', { env: { CLAUDE_STAND_IN: 'fresh' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
// eSpeak NG: its arguments noted, a WAV (a tenth of a second of quiet) on its stdout.
kit.program('espeak-ng', `const fs = require('node:fs'); const path = require('node:path')
fs.appendFileSync(path.join(__dirname, 'espeak.log'), JSON.stringify(process.argv.slice(2)) + '\\n')
const n = 2205; const b = Buffer.alloc(44 + n * 2)
b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(22050, 24); b.writeUInt32LE(44100, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
process.stdout.write(b)`)
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const real = (errors) => errors.filter((e) => !/\/api\/[\w/.?=&-]+ due to access control checks/.test(e))

const ANSWER = '**Two agents need you.**\n- `payments (w1:2)` asks whether to run the migration.\n- billing (w2:1) is waiting on a review of [PR 42](https://github.com/acme/billing/pull/42).'
const HEARD = 'Two agents need you. payments asks whether to run the migration. billing is waiting on a review of PR 42.'

// A page with the device's voices as given (null: none at all), what it says kept in __said, and
// the Chief of Staff's prompt and answer stood in for.
const prompts = []
const open = (voices, o = {}) => page(b, kit.url, { ...o, before: async (ctx) => {
  await noServiceWorker(ctx)
  if (which === 'webkit') {
    await ctx.addInitScript(() => {
      const tone = async () => { const ac = new AudioContext(); const os = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); os.connect(dest); os.start(); return dest.stream }
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: tone, configurable: true, writable: true })
    })
  }
  await ctx.addInitScript((vs) => {
    window.__said = []
    window.__cancels = 0
    window.__played = 0
    const list = (vs || []).map((v) => ({ voiceURI: v.name, lang: 'en-US', default: false, ...v }))
    const synth = {
      getVoices: () => list,
      speak: (u) => { window.__said.push({ text: u.text, voice: u.voice?.name || null, rate: u.rate }); u.__t = setTimeout(() => u.onend?.(), 1500); synth.last = u },
      cancel: () => { window.__cancels++; if (synth.last) { clearTimeout(synth.last.__t); synth.last.onend?.() } },
      addEventListener() {}, removeEventListener() {},
    }
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
    // An utterance as the browser's, but taking these stand-in voices.
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.voice = null; this.rate = 1 } }
    // The computer's eSpeak NG plays here: counted, and ended at once.
    HTMLMediaElement.prototype.play = function () { window.__played++; setTimeout(() => this.dispatchEvent(new Event('ended')), 100); return Promise.resolve() }
  }, voices)
  await ctx.route('**/api/transcribe', (route) => route.fulfill({ json: { text: o.said || "what's blocked" } }))
  await ctx.route('**/api/voice', (route) => route.fulfill({ json: { ready: true, model: true, missing: [] } }))
  if (o.noEspeak) await ctx.route('**/api/voice/speak', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { espeak: false } }) : route.fallback()))
  await ctx.route(/\/api\/agents\/[^/]+\/(prompt|queue)$/, async (route) => { prompts.push(route.request().postDataJSON().text); await route.fulfill({ json: { ok: true } }) })
  await ctx.route(/\/api\/agents\/[^/]+\/transcript$/, (route) => {
    const q = prompts.at(-1)
    route.fulfill({ json: { supported: true, messages: q ? [{ role: 'user', text: q }, { role: 'assistant', text: 'Let me look.' }, { role: 'tool', text: 'bridge agents' }, { role: 'assistant', text: ANSWER }] : [] } })
  })
} })
const LOCAL = [{ name: 'Samantha', localService: true, default: true }, { name: 'Google US English', localService: false }]
const toChief = async (p) => {
  await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
  await p.locator('.rail-chief').click()
  await p.locator('.ask-bar').waitFor({ timeout: 15000 })
}
const hold = async (p, el, ms = 1400) => {
  const r = await el.boundingBox()
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await p.mouse.down()
  await sleep(ms)
  await p.mouse.up()
}

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
    ok(real(errors).length === 0, `${mode}: no page errors`, errors)
    await ctx.close()
  }
  const kept = await until(async () => (await kit.api('/dictations?limit=20')).items.find((x) => x.text === "What's blocked." || x.text === "What's blocked?"), 5000, 200)
  ok(kept?.how === 'sent' && kept.agent?.chief === true, 'kept in the history as sent to the Chief of Staff', kept)

  // Settings › Voice › Spoken Answers.
  {
    const { ctx, p } = await open(LOCAL)
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'voice' } })))
    const sec = p.locator('.st-voice-out')
    await sec.waitFor({ timeout: 10000 })
    const names = await sec.locator('select').first().locator('option').allInnerTexts()
    ok(names.length === 1 && /Samantha/.test(names[0]), 'Settings › Voice › Spoken Answers: this device\'s own voices only', names)
    await sec.locator('select').nth(1).selectOption('1.15')
    await sec.locator('button', { hasText: 'Test' }).click()
    const tst = await until(() => p.evaluate(() => window.__said.at(-1)), 3000, 100)
    ok(tst?.voice === 'Samantha' && tst.rate === 1.15, 'a speed, kept on this device, and Test reads with them', tst)
    await shot(p, `${tag}voice-chief-settings`)
    await ctx.close()
  }

  // No voice of its own: the computer's eSpeak NG.
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
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'voice' } })))
    const sec = p.locator('.st-voice-out')
    await sec.waitFor({ timeout: 10000 })
    ok(/stay in the chat/.test(await sec.innerText()), 'and Settings says answers stay in the chat', await sec.innerText())
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
}
process.exit(done().fail ? 1 : 0)
