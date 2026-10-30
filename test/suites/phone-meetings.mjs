// Meetings on a phone, in the browser named by BRIDGE_TEST_BROWSER: their own tab, recording from
// it (Chromium's fake mic; WebKit has none, so it checks the tab and the list), the screen kept on
// while it records, and the recording carrying on after the phone was locked (the page hidden and its
// sound stopped for a while) and after the mic was let go, saying how long wasn't recorded. Then its
// transcript, from the stand-in speech service.
import { startKit, startModel, checks, until, sleep, browser, page, shot } from '../lib/harness.mjs'

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
    ok(tabs.join('|') === 'Chief|Agents|Meetings|Terminals|Today', `${t}: Meetings is a tab of its own`, tabs)
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
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
  model.stop()
}
process.exit(done().fail ? 1 : 0)
