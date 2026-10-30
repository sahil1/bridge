// Settings › Voice and the mic's first use, in the browser named by BRIDGE_TEST_BROWSER, with a
// stand-in for sherpa-onnx's addon and a small fake model served from this computer
// (harness.startSpeechModels), in a light and a dark theme.
//   This computer: the speech models it can run, Parakeet first and recommended, with their sizes,
//   languages and licenses, and Whisper (for other languages) folded away; Download with progress,
//   In use, Use to pick another, Remove; a download that doesn't match its checksum says so.
//   Whisper models say they need whisper.cpp.
//   Linux with an old glibc (a server standing in for one): no Parakeet in the list, a quiet line
//   that other computers are offered more, and a Parakeet picked on another computer says what's
//   used instead.
//   The message box's mic with no model yet (Chromium's fake mic; WebKit has none, so it skips
//   this): you talk, and the answer offers the one-time download (its name, size, and that it stays
//   on this computer); one click downloads it with progress, then what you said turns into text in
//   the message box.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSpeechModels, checks, until, browser, page, shot, TEST } from '../lib/harness.mjs'

const { ok, skip, done } = checks('voice-ui')
const models = await startSpeechModels('voice-ui')
const kit = await startKit('voice-ui', { env: models.env() })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const old = await startKit('voice-ui-oldlinux', { env: models.env({ BRIDGE_MACHINE: JSON.stringify({ platform: 'linux', arch: 'x64', glibc: '2.31', docker: false }) }), config: { speech: { model: 'parakeet-v3' } } })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const openVoice = async (p) => {
  await p.waitForSelector('.rail-nav-btn', { timeout: 15000 }).catch(() => {})
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'voice' } })))
  await p.waitForSelector('.st-voice .mt-models li', { timeout: 10000 }).catch(() => {})
}
const row = (p, id) => p.locator(`.st-voice li[data-model="${id}"]`)
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

try {
  await kit.api('/setup', { name: 'Tester' })
  await old.api('/setup', { name: 'Tester' })
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.theme
    const { ctx, p, errors } = await page(b, kit.url, look)
    await openVoice(p)
    ok(/Voice/.test(await p.locator('.st-nav-item.on').innerText().catch(() => '')) && /Speech to text on this computer, and dictation/.test(await p.locator('.st-head').innerText()), `${t}: Settings › Voice, with its line`)
    const ids = await p.locator('.st-voice li[data-model]').evaluateAll((l) => l.map((x) => x.dataset.model))
    ok(ids[0] === 'parakeet-v3' && ids[1] === 'parakeet-en' && ids.includes('large-v3-turbo-q5_0') && !ids.includes('apple'), `${t}: the models this computer runs, Parakeet first (no Mac speech here)`, ids)
    // Folded away until it's wanted (later, a Whisper download that failed keeps it open, to say why).
    if (look.mode === 'light') ok(!(await row(p, 'large-v3-turbo-q5_0').isVisible()) && await p.locator('.st-whisper > summary', { hasText: 'Whisper, for other languages' }).isVisible(), `${t}: Whisper folded away, under its own heading`)
    if (await p.locator('.st-whisper').getAttribute('open') === null) await p.locator('.st-whisper > summary').click()
    const pk = await row(p, 'parakeet-v3').innerText()
    ok(/Parakeet/.test(pk) && /recommended/.test(pk) && /670 MB, 25 languages\. CC-BY-4\.0, by NVIDIA\./.test(pk), `${t}: Parakeet: recommended, its size, languages and license`, pk)
    ok(/663 MB, English only\. NVIDIA Open Model License, by NVIDIA\./.test(await row(p, 'parakeet-en').innerText()), `${t}: Parakeet English likewise`, await row(p, 'parakeet-en').innerText())
    ok(/Needs whisper\.cpp, a free program/.test(await row(p, 'large-v3-turbo-q5_0').innerText()), `${t}: a Whisper model says it needs whisper.cpp`)
    ok(/Picked/.test(pk) && await row(p, 'parakeet-v3').locator('button.primary', { hasText: 'Download' }).isVisible(), `${t}: Parakeet is the pick, waiting for its download`)
    ok(await noScroll(p), `${t}: nothing wider than the window`)
    await shot(p, `${tag}voice-${t}`)

    if (look.mode === 'light') {
      // Download, with progress, then In use; Remove puts it back.
      models.slow = 60
      await row(p, 'parakeet-v3').locator('button', { hasText: 'Download' }).click()
      const bar = await until(async () => (await row(p, 'parakeet-v3').locator('[role="progressbar"]').count()) > 0 && /Downloading \d+%/.test(await row(p, 'parakeet-v3').innerText()), 10000, 100)
      ok(!!bar, `${t}: Download shows its progress`)
      await shot(p, `${tag}voice-downloading`)
      models.slow = 0
      ok(!!(await until(async () => /In use/.test(await row(p, 'parakeet-v3').innerText()), 15000)), `${t}: then it's in use`, await row(p, 'parakeet-v3').innerText())
      // A download that doesn't match its checksum.
      await row(p, 'base.en-q5_1').locator('button', { hasText: 'Download' }).click()
      ok(!!(await until(async () => /didn't match its checksum/.test(await row(p, 'base.en-q5_1').innerText()), 15000)), `${t}: a bad download says so`, await row(p, 'base.en-q5_1').innerText())
      ok(await row(p, 'base.en-q5_1').locator('button', { hasText: 'Try again' }).isVisible(), `${t}: with Try again`)
      // Parakeet English: downloaded, then Use picks it, then back.
      await row(p, 'parakeet-en').locator('button', { hasText: 'Download' }).click()
      await until(async () => (await row(p, 'parakeet-en').locator('button', { hasText: 'Use' }).count()) > 0, 15000)
      await row(p, 'parakeet-en').locator('button', { hasText: 'Use' }).click()
      ok(!!(await until(async () => /In use/.test(await row(p, 'parakeet-en').innerText()) && /Use/.test(await row(p, 'parakeet-v3').innerText()), 8000)), `${t}: Use picks another`)
      ok((await kit.api('/voice')).model.id === 'parakeet-en', `${t}: and voice notes use it`)
      await row(p, 'parakeet-v3').locator('button', { hasText: 'Use' }).click()
      ok(!!(await until(async () => /In use/.test(await row(p, 'parakeet-v3').innerText()), 8000)), `${t}: Use on Parakeet again`)
      await row(p, 'parakeet-v3').locator('button[aria-label="Remove Parakeet"]').click()
      ok(!!(await until(async () => /Download/.test(await row(p, 'parakeet-v3').innerText()) && !fs.existsSync(path.join(kit.data, 'models', 'parakeet-v3')), 8000)), `${t}: Remove deletes it, and offers the download again`)
    }
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- A computer that can't run Parakeet ----------
  {
    const { ctx, p, errors } = await page(b, old.url, { mode: 'light', theme: 'sky' })
    await openVoice(p)
    const ids = await p.locator('.st-voice li[data-model]').evaluateAll((l) => l.map((x) => x.dataset.model))
    ok(ids.length && !ids.some((x) => /^parakeet/.test(x)), 'Linux with glibc 2.31: no Parakeet in the list', ids)
    const text = await p.locator('.st-voice').innerText()
    ok(/More speech models are offered on other computers\./.test(text), 'one quiet line says other computers are offered more', text)
    ok(/Parakeet can't run on this computer \(sherpa-onnx needs glibc 2\.32 or later.*\), so Whisper large turbo is used here\./.test(text), 'the Parakeet picked on another computer: what\'s used instead, and why', text)
    await shot(p, `${tag}voice-oldlinux`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- The mic, the first time ----------
  if (which !== 'chromium') skip('the mic\'s first use', 'it records from Chromium\'s fake mic; WebKit has none')
  else {
    const dir = path.join(kit.home, 'shop')
    fs.mkdirSync(dir, { recursive: true })
    await kit.api('/agents/catalog') // looks again: the server looked before the stand-in Claude Code was there
    const a = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Shop', newSpace: 'Shop', prompt: 'idle' })
    await until(async () => ((await kit.api('/fleet')).agents || []).find((x) => x.paneId === a.paneId && x.status !== 'working' && x.status !== 'unknown'), 60000, 1000)
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.locator('.tab-main', { hasText: 'Shop' }).first().click({ timeout: 20000 })
    const was = models.asked.length
    const mic = p.locator('button[aria-label="Dictate"]').first()
    await mic.waitFor({ timeout: 15000 })
    await mic.click()
    ok(!!(await until(() => p.locator('button[aria-label="Stop and transcribe"]').isVisible(), 8000)), 'the mic records, with no model yet')
    await p.waitForTimeout(1600)
    await p.locator('button[aria-label="Stop and transcribe"]').click()
    const panel = p.locator('.voice-setup')
    ok(!!(await until(async () => /one-time download: Parakeet, 670 MB\. It stays on this computer, and so does what you say\./.test(await panel.innerText().catch(() => '')), 15000)), 'what was said comes back as: a one-time download, its size, and that it stays here', await panel.innerText().catch(() => ''))
    ok(models.asked.length === was, 'nothing was downloaded by itself', models.asked.slice(was))
    await shot(p, `${tag}voice-first-use`)
    const before = models.asked.length
    models.slow = 60
    await panel.locator('button', { hasText: 'Download, then transcribe' }).click()
    ok(!!(await until(async () => /Downloading Parakeet… \d+%\. What you said is kept/.test(await panel.innerText().catch(() => '')), 10000, 100)), 'one click: it downloads, with progress, keeping what you said', await panel.innerText().catch(() => ''))
    models.slow = 0
    const box = p.locator('.composer textarea').first()
    // Tidied as dictation is (shared/dictation/clean.js): "work tree" is a name Bridge AI knows.
    ok(!!(await until(async () => /Open the worktree in Claud Code\./.test(await box.inputValue()), 20000)), 'then what you said is in the message box, with worktree spelled as it\'s written', await box.inputValue())
    ok(models.asked.length > before && !(await panel.count()), 'and the panel is gone')
    const heard = fs.readFileSync(path.join(kit.dir, 'sherpa.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.seconds != null).at(-1)
    ok(heard?.seconds >= 1 && heard.seconds < 4, 'Parakeet got the recording, as a 16 kHz WAV made in the page', heard)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }
} catch (e) {
  ok(false, `voice-ui crashed: ${e.stack}`)
} finally {
  await b.close()
  kit.stop()
  old.stop()
  models.stop()
}
process.exit(done().fail ? 1 : 0)
