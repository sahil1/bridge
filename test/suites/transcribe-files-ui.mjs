// Transcribe a file or a folder, in the browser named by BRIDGE_TEST_BROWSER (TranscribeFiles.jsx,
// transcribehost.jsx, transcribefiles.js), with the stand-ins of the transcribe-files suite: a
// stand-in for sherpa-onnx (a voice told by its pitch), small fake models served from this
// computer, a stand-in for the program that reads compressed files, and a stand-in model service.
//   Meetings' Transcribe a file (Files… or A folder…): the system's picker, then the dialog that
//   asks how (the speech model, whose download it says; the language, named by the browser, with
//   Whisper taking a language Parakeet doesn't hear; Tell speakers apart), then the file's line
//   with its progress, Done and Open: the transcript from the file, Speaker 1 and Speaker 2, never
//   You; saved as subtitles beside its note; AI Assist's Ask about this recording, answered.
//   A file dropped anywhere in the window: the sign, then the dialog; ⌘K's Transcribe a file….
//   A computer that can't read the kind of file (no afconvert, no ffmpeg): this window reads it
//   itself (Web Audio: an Opus file in Chromium, an MP4 in WebKit) and sends its sound.
//   On a phone, 375 px wide: Transcribe a file in Meetings, the dialog and the lines fit, each
//   target 40 px.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, startSpeechModels, checks, until, sleep, browser, page, shot, phoneFaults, TEST } from '../lib/harness.mjs'

const { ok, skip, done } = checks('transcribe-files-ui')
const models = await startSpeechModels('transcribe-files-ui')
const model = await startModel('transcribe-files-ui')
const reader = fs.readFileSync(path.join(TEST, 'stand-ins', 'afconvert.cjs'), 'utf8')
const kitFor = (name, { none = false } = {}) => startKit(name, {
  env: ({ bin }) => {
    const prog = path.join(bin, 'afconvert')
    fs.writeFileSync(`${prog}.cjs`, reader)
    fs.writeFileSync(prog, `#!/bin/sh\nexec "${process.execPath}" "${prog}.cjs" "$@"\n`, { mode: 0o755 })
    return { ...models.env()({ bin }), BRIDGE_AFCONVERT: none ? 'none' : prog, BRIDGE_FFMPEG: 'none' }
  },
})
const RATE = 16000
const wav = (tones) => {
  const n = tones.reduce((s, [, secs]) => s + Math.round(secs * RATE), 0)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  let at = 0
  for (const [hz, secs] of tones) { const k = Math.round(secs * RATE); for (let i = 0; i < k; i++) b.writeInt16LE(hz ? Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * 8000) : 0, 44 + (at + i) * 2); at += k }
  return b
}
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const kit = await kitFor('transcribe-files-ui')
const bare = await kitFor('transcribe-files-ui-bare', { none: true })
const interview = path.join(kit.dir, 'interview.wav')
fs.writeFileSync(interview, wav([[0, 1], [220, 2.5], [0, 1.5], [440, 2.5], [0, 1.5], [220, 2.5], [0, 1.5]]))
const openMeetings = (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } })))
const line = (p, name) => p.locator('.tf-item', { hasText: name })

try {
  for (const k of [kit, bare]) {
    await k.api('/setup', { name: 'Tester' })
    await k.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
    await k.api('/settings', { meetings: { model: 'openai:gpt-5', folder: path.join(k.home, 'Meeting notes') } }, 'PATCH')
  }

  // ---------- Meetings' Transcribe a file ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', store: { 'cc-meet-setup': 1 } })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 }).catch(() => {})
    await openMeetings(p)
    const btn = p.locator('.mt-view .pane-head .tf-btn')
    ok(!!(await until(() => btn.isVisible(), 10000)) && /Transcribe a file/.test(await btn.innerText()), 'Meetings has Transcribe a file, beside Start recording')
    ok(/drop audio or video here, or use Transcribe a file/.test(await p.locator('.mt-empty').innerText().catch(() => '')), 'and the first time, says a recording can be dropped there')
    await btn.click()
    const items = await p.locator('.menu .menu-item').allInnerTexts()
    ok(items.join('|') === 'Files…|A folder…', 'its menu: files, or a folder', items)
    const chooser = p.waitForEvent('filechooser', { timeout: 5000 })
    await p.locator('.menu .menu-item', { hasText: 'Files…' }).click()
    const fc = await chooser
    ok(fc.isMultiple(), 'the system\'s own picker, for several at once')
    await fc.setFiles(interview)
    const dlg = p.locator('.mt-dialog', { hasText: 'Transcribe interview.wav' })
    ok(!!(await until(() => dlg.isVisible(), 5000)), 'the dialog asks how to transcribe it')
    await until(async () => (await dlg.locator('select[aria-label="Transcribe with"] option').count()) > 1, 8000)
    const withs = await dlg.locator('select[aria-label="Transcribe with"] option').allInnerTexts()
    ok(withs[0] === 'On this computer: Parakeet (downloads 670 MB first)' && withs.some((x) => /Whisper large turbo \(downloads 1\.0 GB first\)/.test(x)) && withs.some((x) => /^OpenAI/.test(x)) && !withs.some((x) => /Mac's own/.test(x)), 'with the speech models this computer runs, each download said, and the service with a key', withs)
    const langs = await dlg.locator('select[aria-label="Language spoken"] option').allInnerTexts()
    ok(langs[0] === 'Detect it' && langs.length > 90 && langs.includes('Japanese') && langs.includes('Swahili'), 'every language Whisper hears, named by the browser', langs.length)
    ok(/Tell speakers apart/.test(await dlg.innerText()) && /voice model downloads once \(26 MB\)/.test(await dlg.innerText()), 'Tell speakers apart, its download said')
    await dlg.locator('select[aria-label="Language spoken"]').selectOption('ja')
    ok(/Parakeet doesn't hear Japanese, so Whisper large turbo transcribes it\. It downloads once first \(1\.0 GB\)\./.test(await dlg.innerText()), 'a language Parakeet doesn\'t hear: Whisper large turbo takes it, and says so', await dlg.innerText())
    await dlg.locator('select[aria-label="Language spoken"]').selectOption('auto')
    await shot(p, `${tag}transcribe-dialog`)
    await dlg.locator('button[type="submit"]', { hasText: 'Transcribe' }).click()
    ok(!!(await until(async () => !(await dlg.count()), 5000)), 'Transcribe: the dialog goes')
    const ln = line(p, 'interview.wav')
    ok(!!(await until(() => ln.isVisible(), 8000)), 'and its line shows in Meetings')
    const seen = new Set()
    await until(async () => { const s = await ln.getAttribute('data-state').catch(() => null); if (s) seen.add(s); return s === 'done' }, 40000, 100)
    ok(seen.has('done') && /Done · 0:13/.test(await ln.innerText()), 'with how far it\'s got, then Done and its length', [...seen])
    await shot(p, `${tag}transcribe-done`)
    await ln.locator('button', { hasText: 'Open' }).click()
    await p.waitForSelector('.mt-transcript .mt-line', { timeout: 10000 })
    const whos = await p.locator('.mt-transcript .mt-line .mt-who').allInnerTexts()
    ok(whos.join(',') === 'Speaker 1,Speaker 2,Speaker 1', 'Open: the transcript from the file, by Speaker 1 and Speaker 2, never You', whos)
    ok((await p.locator('.mt-from-file').innerText().catch(() => '')).includes('interview.wav'), 'it says which file it\'s from')
    ok((await p.locator('.mt-talk, .mt-talktime').count()) === 0, 'and has no talk time (nobody\'s meeting)')
    await shot(p, `${tag}transcribe-meeting`)
    await p.locator('.mt-view .pane-head button[aria-label="Save"]').click()
    const saves = await p.locator('.menu .menu-item').allInnerTexts()
    ok(['Save the transcript as text (.txt)', 'Save the transcript as Markdown (.md)', 'Save as subtitles (.srt)', 'Save as subtitles (.vtt)'].every((x) => saves.includes(x)), 'Save: as text, Markdown and subtitles too', saves)
    await p.locator('.menu .menu-item', { hasText: 'Save as subtitles (.srt)' }).click()
    const said = await until(async () => { const t = await p.locator('.mt-view').innerText(); return /Saved to [^\n]*interview\.srt/.test(t) && t }, 8000)
    const srt = path.join(kit.home, 'Meeting notes')
    const found = fs.existsSync(srt) ? fs.readdirSync(srt, { recursive: true }).find((f) => String(f).endsWith('interview.srt')) : null
    ok(!!said && !!found && /^1\n00:00:00,/.test(fs.readFileSync(path.join(srt, found), 'utf8')), 'Save as subtitles: saved beside its note, and it says where', found)
    ok(await p.locator('.mt-view button', { hasText: /Show in (Finder|Explorer|file manager)/ }).isVisible(), 'with Show in Finder')
    const wand = p.locator('.mt-view .pane-head button[aria-label="AI Assist"]')
    await wand.click()
    const assists = await p.locator('.ai-menu .ai-item-label').allInnerTexts()
    ok(assists.includes('Ask about this recording') && !assists.includes('Ask about this meeting'), 'AI Assist: Ask about this recording', assists)
    await p.locator('.ai-menu button', { hasText: 'Ask about this recording' }).click()
    await p.locator('.mt-askbox input').first().fill('What did they say?')
    await p.locator('.mt-askbox input').first().press('Enter')
    ok(!!(await until(async () => (await p.locator('.mt-qa .mt-a').count()) > 0, 10000)) && /^Recording: interview\.wav/.test(model.asked(/What did they say\?/).at(-1) || ''), 'and its answer, from the recording', model.asked(/What did they say/).at(-1)?.slice(0, 200))

    // A file dropped anywhere in the window: the sign while it's over it, then the dialog.
    await openMeetings(p)
    const dropped = await p.evaluate(async () => {
      const bytes = new Uint8Array(44 + 16000 * 2)
      const dv = new DataView(bytes.buffer)
      const s = (o, x) => { for (let i = 0; i < x.length; i++) bytes[o + i] = x.charCodeAt(i) }
      s(0, 'RIFF'); dv.setUint32(4, 36 + 32000, true); s(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); s(36, 'data'); dv.setUint32(40, 32000, true)
      let dt
      try { dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped.wav', { type: 'audio/wav' })) } catch { return 'no DataTransfer' }
      const at = document.querySelector('.mt-home') || document.body
      at.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 50))
      const sign = !!document.querySelector('.tf-over')
      at.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      return sign
    })
    if (dropped === 'no DataTransfer') skip('a file dropped on the window', 'this browser can\'t make a drop in a test')
    else {
      ok(dropped === true, 'audio dragged over the window: Drop to transcribe')
      ok(!!(await until(() => p.locator('.mt-dialog', { hasText: 'Transcribe dropped.wav' }).isVisible(), 5000)), 'dropped: the same dialog, for that file')
      await p.locator('.mt-dialog button', { hasText: 'Cancel' }).click()
    }

    // ⌘K: Transcribe a file… opens the system's picker straight away.
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').fill('transcribe')
    const found2 = await p.locator('.palette .pal-item').allInnerTexts()
    ok(found2.some((x) => /Transcribe a file…/.test(x)) && found2.some((x) => /Transcribe a folder…/.test(x)), '⌘K: Transcribe a file… and Transcribe a folder…', found2)
    const pick2 = p.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null)
    await p.locator('.palette .pal-item', { hasText: 'Transcribe a file…' }).click()
    ok(!!(await pick2), 'picking it opens the system\'s picker')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- Read in this window, where the computer can't ----------
  {
    const { ctx, p, errors } = await page(b, bare.url, { mode: 'dark', theme: 'midnight', store: { 'cc-meet-setup': 1 } })
    await bare.api('/speech/models/parakeet-v3', {})
    await until(async () => (await bare.api('/speech')).local.models.find((x) => x.id === 'parakeet-v3')?.have, 15000)
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 }).catch(() => {})
    await openMeetings(p)
    await p.locator('.mt-view .pane-head .tf-btn').click()
    const chooser = p.waitForEvent('filechooser', { timeout: 5000 })
    await p.locator('.menu .menu-item', { hasText: 'Files…' }).click()
    // Chromium reads Opus; Playwright's WebKit reads AAC in an MP4.
    const file = which === 'webkit' ? path.join(TEST, 'fixtures', 'clip.mp4') : path.join(TEST, 'fixtures', 'tone.ogg')
    await (await chooser).setFiles(file)
    const dlg = p.locator('.mt-dialog')
    await until(async () => (await dlg.locator('select[aria-label="Transcribe with"] option').count()) > 0, 8000)
    await dlg.locator('button[type="submit"]').click()
    const ln = line(p, path.basename(file))
    const seen = new Set()
    await until(async () => { const s = await ln.getAttribute('data-state').catch(() => null); if (s) seen.add(s); return s === 'done' || s === 'failed' }, 40000, 100)
    const id = (await bare.api('/meetings/files')).items.find((x) => x.name === path.basename(file))?.id
    const m = id && await bare.api(`/meetings/${id}`).catch(() => null)
    ok(seen.has('done') && m?.transcript?.length >= 1 && m.file?.name === path.basename(file), `a kind this computer can't read (${path.basename(file)}): this window reads it and sends its sound, and it's transcribed`, { seen: [...seen], text: await ln.innerText().catch(() => '') })
    await shot(p, `${tag}transcribe-read-here`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- On a phone ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', phone: true, store: { 'cc-meet-setup': 1 } })
    await p.setViewportSize({ width: 375, height: 812 })
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    const btn = p.locator('.m-meetings .tf-btn, .mt-view .tf-btn').first()
    ok(!!(await until(() => btn.isVisible(), 10000)), 'the phone\'s Meetings has Transcribe a file')
    await sleep(400)
    let f = await phoneFaults(p, '.m-body')
    ok(!Object.keys(f).length, 'Meetings with its files\' lines fits the phone, each target 40 px', f)
    await shot(p, `${tag}transcribe-phone`)
    const chooser = p.waitForEvent('filechooser', { timeout: 5000 })
    await btn.click()
    await (await chooser).setFiles(interview)
    await until(() => p.locator('.mt-dialog').isVisible(), 5000)
    await sleep(400)
    f = await phoneFaults(p, '.mt-dialog-back')
    ok(!Object.keys(f).length, 'the dialog fits the phone too', f)
    await shot(p, `${tag}transcribe-phone-dialog`)
    await p.locator('.mt-dialog button', { hasText: 'Cancel' }).click()
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }
} catch (e) {
  ok(false, `transcribe-files-ui crashed: ${e.stack}`)
  console.log(kit.log().slice(-2000))
} finally {
  await b.close()
  kit.stop()
  bare.stop()
  models.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
