// Watch a screen while a meeting records, when it can't be watched: why, every way, and what to do
// (meetings-ui had it, and with it came close to the five minutes a test is given). The picker's
// answer stood in for as each browser and Electron give it, the desktop app's reason for its no,
// Picking a screen… and Cancel, the floating card's Watch screen, and macOS's own picker as
// Electron 45 has it, with each try's line in the server's log. In Chromium and WebKit.
import { startKit, startModel, checks, until, browser, page, shot, withoutCutOff, noServiceWorker } from '../lib/harness.mjs'

const { ok, skip, done } = checks('meetings-screen')
const kit = await startKit('meetings-screen')
const model = await startModel('meetings-screen')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api

try {
  await api('/setup', { name: 'Tester' })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false } }, 'PATCH')

  // ---------- Watch a screen that can't be watched: why, every way, and what to do ----------
  // The picker's answer stood in for (a canvas, or a no as Chromium, WebKit and Electron give one),
  // and the desktop app's own reason for its no (bridgeApp.screenWhy: desktop/screenpick.js, which
  // screen-watch checks) with it. A click on Watch a screen always ends in a screen watched, the
  // picker up (saying where), or why not with what to do: on the button's line, on the meeting for a
  // click on the floating card, and on the card. WebKit's mic is a tone.
  {
    const sw = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, before: async (c) => {
      // (No service worker, as in the desktop app: WebKit's test build doesn't route what one fetches.)
      await noServiceWorker(c)
      await c.route('**/api/calls/screen*', (r) => r.fulfill({ json: { allowed: false, started: new Date().toISOString(), picker: false } }))
      await c.addInitScript((tone) => {
        // On the prototype: WebKit doesn't keep one set on navigator.mediaDevices.
        const md = window.MediaDevices?.prototype
        if (!md) return
        if (tone) md.getUserMedia = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream }
        window.__screenAsks = 0
        window.__screenFail = []
        const canvas = () => {
          const cv = document.createElement('canvas')
          cv.width = 640
          cv.height = 360
          const x = cv.getContext('2d')
          const draw = () => { x.fillStyle = '#fff'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#123'; x.font = '36px sans-serif'; x.fillText('Quarterly numbers', 40, 180) }
          draw()
          setInterval(draw, 500)
          return cv.captureStream(4)
        }
        // A screen that never sends a frame (frames only when asked for, and none is).
        const dead = () => document.createElement('canvas').captureStream(0)
        // macOS's own picker as Electron 45 has it on macOS 15 and later (window.__picker: on): the
        // app's handler isn't asked, so it has no why to give; each ask waits on the picker, a pick
        // (__pickerPick) answers every ask still waiting (Electron's picker devices all hear it), and
        // closing it (__pickerClose) answers none. __pickerDead: the screen picked sends nothing.
        // __pickerTimeout (ms, 0: none): Chromium's 10 seconds for a capture to start
        // (VideoCaptureImpl::kCaptureStartTimeout), which Electron 45's picker spends waiting for the
        // pick: an ask still waiting then is turned down as AbortError "Timeout starting video
        // source" (__pickerTimedOut counts them), and a pick made while no ask waits goes nowhere.
        window.__pickerAsks = []
        window.__pickerGiven = []
        window.__pickerTimeout = 0
        window.__pickerTimedOut = 0
        window.__pickerPick = () => { const asks = window.__pickerAsks.splice(0); for (const x of asks) { const s = window.__pickerDead ? dead() : canvas(); window.__pickerGiven.push(s); x.resolve(s) } return asks.length }
        window.__pickerClose = () => {}
        // A no as the browser gives it ({ name, message }), or { hang }: the picker up until __screenGive().
        md.getDisplayMedia = async () => {
          window.__screenAsks++
          if (window.__picker) {
            return new Promise((resolve, reject) => {
              const x = { resolve }
              window.__pickerAsks.push(x)
              if (window.__pickerTimeout) setTimeout(() => { const i = window.__pickerAsks.indexOf(x); if (i < 0) return; window.__pickerAsks.splice(i, 1); window.__pickerTimedOut++; reject(new DOMException('Timeout starting video source', 'AbortError')) }, window.__pickerTimeout)
            })
          }
          const f = window.__screenFail.shift()
          if (f?.hang) return new Promise((resolve) => { window.__screenGive = () => { window.__given = canvas(); resolve(window.__given) } })
          if (f) throw new DOMException(f.message, f.name)
          return canvas()
        }
      }, which === 'webkit')
    } })
    const q = sw.p
    const bar = q.locator('.mt-recbar')
    const why = bar.locator('.mt-screen-why')
    const shows = async (re, where = why) => !!(await until(async () => re.test((await where.innerText().catch(() => '')).trim()), 6000))
    const text = (where = why) => where.innerText().catch(() => '')
    // app: the desktop app stood in for ({ platform, why }: its reason for the no), or none (a browser).
    const setUp = (fail, app) => q.evaluate(({ fail, app }) => {
      window.__screenFail = fail ? [fail] : []
      if (app) window.bridgeApp = { desktop: true, platform: app.platform, screenWhy: async () => (app.why ? { why: app.why, ...(app.problem ? { problem: app.problem } : {}) } : null), restart: async () => true }
      else delete window.bridgeApp
    }, { fail, app })
    const click = async (fail, app = null) => { await setUp(fail, app); await bar.locator('button', { hasText: 'Watch a screen' }).click() }
    await q.waitForSelector('.rail-nav-row', { timeout: 15000 }).catch(() => {})
    await until(async () => { await q.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } }))); return q.locator('.mt-home').isVisible() }, 10000, 1000)
    await q.locator('.pane-head button', { hasText: 'Start recording' }).click()
    const R = await until(async () => (await api('/meetings')).meetings.find((x) => x.status === 'recording'), 15000)
    ok(!!R && !!(await until(() => bar.locator('button', { hasText: 'Watch a screen' }).isVisible(), 10000)), 'a meeting records, with Watch a screen', await text(bar))
    const ABORT = { name: 'AbortError', message: 'Invalid capture constraints' } // Electron's, whatever the app's no was for
    const DENIED = { name: 'NotAllowedError', message: 'Permission denied' }
    const mac = (w, problem) => ({ platform: 'darwin', why: w, problem })

    // A browser: the picker closed with nothing picked, and macOS not letting the browser see the screen.
    await click(DENIED)
    ok(await shows(/^Nothing was picked in the browser's picker\. Click Watch a screen to pick the window or tab being shared\.$/), "a browser's picker closed with nothing picked: said, not nothing", await text())
    await click({ name: 'NotAllowedError', message: 'Permission denied by system' })
    ok(await shows(/^macOS isn't letting this browser see the screen\. Turn on your browser under System Settings/), 'macOS not letting the browser see the screen: what to turn on', await text())

    // The desktop app on a Mac before macOS 15 (no picker of its own: the whole screen, which needs
    // Screen Recording): off, turned on since Bridge AI started, on and still no screen, a profile.
    await click(ABORT, mac('off'))
    ok(await shows(/^Screen Recording is off for Bridge AI\. Turn it on under System Settings › Privacy & Security › Screen & System Audio Recording, then watch a screen again\./) && await why.locator('button', { hasText: 'Open it' }).isVisible(), 'the desktop app on a Mac with Screen Recording off: says so, where to turn it on, and Open it', await text())
    await shot(q, `${tag}watch-screen-off`)
    await click(ABORT, mac('reopen'))
    ok(await shows(/^Screen Recording is on for Bridge AI, and macOS applies it once Bridge AI restarts\./) && await why.locator('button', { hasText: 'Restart Bridge AI' }).isVisible(), 'turned on since Bridge AI started: macOS applies it once it restarts, with Restart Bridge AI', await text())
    await why.locator('button', { hasText: 'Restart Bridge AI' }).click()
    ok(await shows(/Restarting stops this recording\./) && await why.locator('button', { hasText: 'Restart now' }).isVisible(), 'which says first that restarting stops the recording', await text())
    await why.locator('button', { hasText: 'Not now' }).click()
    await click(ABORT, mac('none'))
    ok(await shows(/^macOS lists no screen for Bridge AI to watch, though Screen Recording is on for it\. macOS can keep an answer that shows as on and doesn't take\./) && (await why.locator('button', { hasText: 'Reset and ask again' }).count() === 1 || /remove Bridge AI from Screen Recording with −/.test(await text())), "on, and still no screen: an answer that doesn't take, with Reset and ask again (or how to in System Settings)", await text())
    await click(ABORT, mac('restricted'))
    ok(await shows(/^A profile on this Mac turns off Screen Recording for Bridge AI, so it can't watch a screen here\.$/), 'Screen Recording turned off by a profile: said', await text())
    await click(ABORT, mac('page'))
    ok(await shows(/^This window shows another of your computers\. Watch a screen from a Bridge AI window on this computer\.$/), "a window showing another computer: watch from one on this computer", await text())
    await click(ABORT, mac('frame'))
    ok(await shows(/^Watch a screen from Bridge AI's own window: this page is inside another one\.$/), 'a page inside another one: watch from its own window', await text())
    // macOS 15 and later: macOS's own picker, closed with nothing picked, or the screen not starting.
    await click(DENIED, mac(null))
    ok(await shows(/^Nothing was picked in macOS's picker\. Click Watch a screen to pick the window being shared\.$/), "macOS's picker closed with nothing picked: said", await text())
    await click({ name: 'NotReadableError', message: 'Could not start video source' }, mac(null))
    ok(await shows(/^Couldn't start watching the screen \(Could not start video source\)\. Click Watch a screen to try again\.$/), "the screen picked didn't start: said, and to try again", await text())
    await click({ name: 'InvalidStateError', message: 'getDisplayMedia() requires transient activation (user gesture).' }, mac(null))
    ok(await shows(/^Click Watch a screen here: the picker opens only from a click in this window\.$/), 'asked without a click: click it here', await text())
    // Windows and Linux: the whole screen, none listed, or listing them failing.
    await click(ABORT, { platform: 'win32', why: 'none' })
    ok(await shows(/^Bridge AI found no screen to watch on this computer\.$/), 'Windows with no screen listed: said', await text())
    await click(ABORT, { platform: 'linux', why: 'none' })
    ok(await shows(/^No screen to watch: none was picked in the system's dialog, or none was found\. Click Watch a screen to try again\.$/), "Linux with none (the system's dialog closed): said", await text())
    await click(ABORT, { platform: 'linux', why: 'error', problem: 'Failed to get sources.' })
    ok(await shows(/^Couldn't list this computer's screens: Failed to get sources\.$/), "listing the screens failed: said, with what it said", await text())

    // The picker up: Picking a screen…, where to pick, and Cancel; a screen picked after Cancel isn't kept.
    await click({ hang: true }, mac(null))
    const busy = bar.locator('button', { hasText: 'Picking a screen…' })
    ok(!!(await until(() => busy.isVisible(), 5000)) && (await busy.getAttribute('aria-disabled')) === 'true' && await shows(/^Pick the window or screen to watch in macOS's picker\. Cancel$/, bar.locator('.mt-picking')), "while macOS's picker is up: Picking a screen…, where to pick, and Cancel", await text(bar))
    await shot(q, `${tag}watch-screen-picking`)
    await bar.locator('.mt-picking button', { hasText: 'Cancel' }).click()
    ok(!!(await until(() => bar.locator('button', { hasText: 'Watch a screen' }).isVisible(), 4000)), 'Cancel: Watch a screen again')
    await q.evaluate(() => window.__screenGive())
    ok(!!(await until(() => q.evaluate(() => window.__given?.getVideoTracks()[0]?.readyState === 'ended'), 4000)) && (await bar.locator('button', { hasText: 'Capture' }).count()) === 0, 'a screen picked after Cancel is let go, not watched')

    // From the floating card (the desktop app sends the click to the window recording): why, on the
    // meeting with what to do, and to the card; the picker wanting a click in this window: it's
    // brought to the front (done says so to the app) and says to click there.
    await q.evaluate(() => { window.__card = []; const ch = new BroadcastChannel('bridge-meetings'); ch.onmessage = (e) => { if (e.data?.type === 'error') window.__card.push(e.data.text) } })
    const fromCard = () => q.evaluate(() => new Promise((done) => window.dispatchEvent(new CustomEvent('bridge-watch-screen', { detail: { done } }))))
    const note = bar.locator('.mt-screen-note')
    await setUp(ABORT, mac('off'))
    const d1 = await fromCard()
    ok(d1 === null && await shows(/^Screen Recording is off for Bridge AI\./, note) && await note.locator('button', { hasText: 'Open it' }).isVisible() && !!(await until(() => q.evaluate(() => window.__card.some((x) => /^Screen Recording is off for Bridge AI\./.test(x))), 3000)), "Watch screen on the floating card: why on the meeting, with Open it, and on the card", { note: await text(note), card: await q.evaluate(() => window.__card) })
    await setUp({ name: 'InvalidStateError', message: 'getDisplayMedia() requires transient activation (user gesture).' }, mac(null))
    const d2 = await fromCard()
    ok(d2?.focus === true && await shows(/^Click Watch a screen here: the picker opens only from a click in this window\./, note) && !!(await until(() => q.evaluate(() => window.__card.includes('Click Watch a screen in the Bridge AI window: the picker opens only from a click there.')), 3000)), "the picker wanting a click here: this window to the front, Click Watch a screen here, and the card says so", { d2, note: await text(note), card: await q.evaluate(() => window.__card) })
    await note.locator('button', { hasText: 'OK' }).click()

    // The card itself: what the window says, Picking… while the picker is up, and a click no window
    // answers said too.
    const card = await sw.ctx.newPage()
    card.on('pageerror', (e) => sw.errors.push(`card: ${e.message}`))
    await card.addInitScript(() => { window.bridgeApp = { floatWatch: async () => { window.__asked = (window.__asked || 0) + 1; return true } } })
    await card.setViewportSize({ width: 360, height: 520 })
    await card.goto(`${kit.url}/?float=1`)
    await card.waitForSelector('.float-card', { timeout: 10000 }).catch(() => {})
    await card.hover('.float-card .fc-head')
    const chip = card.locator('.fc-modes .fc-chip', { hasText: 'Watch screen' })
    ok(!!(await until(() => chip.isVisible(), 10000)), "the card's Watch screen")
    const cardErr = card.locator('.float-card > .error-text')
    await chip.click()
    ok(!!(await until(async () => /^The window recording this meeting didn't answer\. Open the meeting and click Watch a screen there\.$/.test(await cardErr.innerText().catch(() => '')), 9000)), "a click on the card that no window answers: said on the card, not nothing", await cardErr.innerText().catch(() => ''))
    await setUp(ABORT, mac('off'))
    await chip.click()
    await fromCard()
    ok(!!(await until(async () => /^Screen Recording is off for Bridge AI\./.test(await cardErr.innerText().catch(() => '')), 5000)), "the window's why, on the card", await cardErr.innerText().catch(() => ''))
    await setUp({ hang: true }, mac(null))
    await chip.click()
    const card3 = fromCard()
    ok(!!(await until(() => card.locator('.fc-modes .fc-chip', { hasText: 'Picking…' }).isVisible(), 5000)), "the card while macOS's picker is up: Picking…")
    await q.evaluate(() => window.__screenGive())
    await card3
    ok(!!(await until(() => card.locator('.fc-modes .fc-chip', { hasText: 'Watching' }).isVisible(), 6000)) && (await cardErr.count()) === 0, 'and once a screen is picked, Watching', await card.locator('.float-card').innerText({ timeout: 1000 }).catch(() => ''))

    // ---------- macOS's own picker, as Electron 45 has it on macOS 15 and later ----------
    // The app's handler isn't asked there (desktop/screenpick.js install: screen-watch), so it has
    // no why to give: the screen comes back only as getDisplayMedia's answer, a picker closed with
    // nothing picked says nothing, and Chromium times the capture out while the picker is up (the
    // owner's case, below). From the card: Picking…, with Cancel there too, not Picking
    // for ever (the card had no way out); asked again and picked, it's watched and its pictures
    // come, and the first ask, which hears the same pick, is let go. A picker that never answers is
    // said on the meeting and the card after a while, with Watch a screen there again, and a pick
    // that comes after is still watched; a screen picked that sends nothing is said. Each try is a
    // line in the server's log: from where, how, and how it went.
    const lines = () => kit.log().split('\n').filter((l) => /^Watch a screen #/.test(l))
    const logged = (re, ms = 8000) => until(() => lines().find((l) => re.test(l)), ms)
    // Pictures sent to the meeting (kept or not: the server keeps one only when its words are new).
    let sent = 0
    q.on('request', (r) => { if (r.method() === 'POST' && /\/api\/meetings\/[^/]+\/captures/.test(r.url())) sent++ })
    await bar.locator('button', { hasText: 'Stop watching the screen' }).click()
    await q.evaluate(() => {
      window.__picker = true
      window.__pickerDead = false
      window.__bridgePickWait = 3000
      window.__bridgeLookWait = 20000
      window.bridgeApp = { desktop: true, platform: 'darwin', screenWhy: async () => null, screenHow: async () => ({ picker: true, off: null }), restart: async () => true }
    })
    const picking = card.locator('.fc-modes .fc-chip', { hasText: 'Picking…' })
    const cardCancel = card.locator('.fc-modes .fc-chip', { hasText: 'Cancel' })
    await until(() => chip.isVisible(), 5000)
    await chip.click()
    const p1 = fromCard()
    ok(!!(await until(() => picking.isVisible(), 5000)) && await cardCancel.isVisible().catch(() => false), "macOS's picker up, from the card: Picking…, and Cancel beside it", await card.locator('.fc-modes').innerText().catch(() => ''))
    await shot(card, `${tag}watch-screen-card-picking`)
    await q.evaluate(() => window.__pickerClose())
    await cardCancel.click()
    ok(!!(await until(() => chip.isVisible(), 5000)) && !!(await until(() => bar.locator('button', { hasText: 'Watch a screen' }).isVisible(), 5000)), 'the picker closed with nothing picked (it never answers): Cancel on the card, and Watch screen there and on the meeting again', await card.locator('.fc-modes').innerText().catch(() => ''))
    ok(!!(await logged(/from the floating card via macOS's picker: cancelled after [\d.]+ s, nothing picked$/)), "the try's line in the server's log: cancelled", lines().slice(-3))
    await chip.click()
    const p2 = fromCard()
    ok(!!(await until(() => picking.isVisible(), 5000)), 'asked again from the card: Picking…')
    const sentBefore = sent
    const answered = await q.evaluate(() => window.__pickerPick())
    await Promise.all([p1, p2])
    ok(answered === 2 && !!(await until(() => card.locator('.fc-modes .fc-chip', { hasText: 'Watching' }).isVisible(), 6000)) && !!(await until(() => q.evaluate(() => window.__pickerGiven[0].getVideoTracks()[0].readyState === 'ended' && window.__pickerGiven[1].getVideoTracks()[0].readyState === 'live'), 4000)), 'picked: watched, and the cancelled ask, given the same pick, let go', await q.evaluate(() => window.__pickerGiven.map((s) => s.getVideoTracks()[0].readyState)))
    // (The first picture waits for a few looks, two seconds apart: changes.js WARM.)
    const first = await logged(/from the floating card via macOS's picker: picked a [^;]* after [\d.]+ s; first look [\d.]+ s later, first picture [\d.]+ s later$/, 25000)
    ok(!!first && !!(await until(() => sent > sentBefore, 5000)), 'its pictures come, sent to the meeting, and its line says when its first look and first picture came', { line: first, sent, lines: lines().slice(-3) })
    ok(!!(await logged(/via macOS's picker \(a later line\): picked a .* let go: it was cancelled or asked for again meanwhile$/)), "and the cancelled one's pick, let go, a line of its own", lines().slice(-3))
    // The owner's case (20 Nov, a Teams call): a screen picked after Chromium's 10 seconds for a
    // capture to start (1.5 s here). Electron 45's picker is up while the capture starts, so the ask
    // is turned down as AbortError "Timeout starting video source" before the pick: it was said as
    // "Nothing was picked in macOS's picker", and the pick went nowhere. Now it's asked again, and
    // the pick is watched.
    await bar.locator('button', { hasText: 'Stop watching the screen' }).click()
    await q.evaluate(() => { window.__pickerTimeout = 1500; window.__pickerTimedOut = 0; window.__bridgeReaskMs = 300; window.__bridgePickWait = 8000 })
    await bar.locator('button', { hasText: 'Watch a screen' }).click()
    ok(!!(await until(() => q.evaluate(() => window.__pickerTimedOut >= 1 && window.__pickerAsks.length === 1), 6000)) && !/Nothing was picked/.test(await bar.innerText().catch(() => '')) && await bar.locator('button', { hasText: 'Picking a screen…' }).isVisible(), "the pick slower than a capture's time to start: the ask that timed out isn't said as nothing picked, and the screen is asked for again, the picker up", { bar: await text(bar), timedOut: await q.evaluate(() => window.__pickerTimedOut) })
    await q.evaluate(() => window.__pickerPick())
    ok(!!(await until(() => bar.locator('button', { hasText: 'Capture' }).isVisible(), 6000)) && !/Nothing was picked/.test(await bar.innerText().catch(() => '')), 'picked after it: watched, not "Nothing was picked in macOS\'s picker"', await text(bar))
    await bar.locator('button', { hasText: 'Stop watching the screen' }).click()
    ok(!!(await logged(/from the recording bar via macOS's picker: picked a [^;]* after [\d.]+ s, asked again [1-9]\d* times? as Chromium's 10 s to start ran out; stopped/)), 'and in the log: picked, asked again as the time to start ran out', lines().slice(-2))
    await q.evaluate(() => { window.__pickerTimeout = 0; window.__bridgePickWait = 3000 })
    // Nothing from the picker for a while (closed, or out of sight): said, Watch a screen again.
    await bar.locator('button', { hasText: 'Watch a screen' }).click()
    ok(!!(await until(() => bar.locator('button', { hasText: 'Picking a screen…' }).isVisible(), 2500)), 'Watch a screen on the meeting: Picking a screen…')
    ok(await shows(/^macOS's picker hasn't given a screen\. If it closed or you can't see it, click Watch a screen to open it again\./, note) && await bar.locator('button', { hasText: 'Watch a screen' }).isVisible() && !!(await until(async () => /^macOS's picker hasn't given a screen\./.test(await cardErr.innerText().catch(() => '')), 5000)), "a picker that doesn't answer: said on the meeting and the card, with Watch a screen there again, not Picking for ever", await text(bar))
    ok(!!(await logged(/from the recording bar via macOS's picker: no answer from the picker after [\d.]+ s/)), 'and in the log: no answer', lines().slice(-2))
    // A pick that comes after: still watched, and what was said goes.
    await q.evaluate(() => window.__pickerPick())
    ok(!!(await until(() => bar.locator('button', { hasText: 'Capture' }).isVisible(), 6000)) && !!(await until(async () => (await note.count()) === 0 && (await cardErr.count()) === 0, 4000)), 'picked after all: watched, and what the meeting and the card said gone', await text(bar))
    // A screen picked that sends nothing at all: said, with what to do.
    await bar.locator('button', { hasText: 'Stop watching the screen' }).click()
    ok(!!(await logged(/from the recording bar via macOS's picker \(a later line\): picked a [^;]* after [\d.]+ s; stopped/)), 'and in the log: picked, after its no-answer line (stopped before its first picture)', lines().slice(-2))
    // (WebKit's canvas stream sends a first frame even when asked for none: Chromium's stands in.)
    if (which === 'webkit') skip('a screen picked that sends nothing: said on the meeting, with what to do, and in the log', "WebKit's canvas stream always sends a first frame")
    else {
      await q.evaluate(() => { window.__pickerDead = true; window.__bridgeLookWait = 3000 })
      await bar.locator('button', { hasText: 'Watch a screen' }).click()
      await until(() => q.evaluate(() => window.__pickerAsks.length === 1), 4000)
      await q.evaluate(() => window.__pickerPick())
      ok(await shows(/^Nothing has come from .+ since it was picked\. Click Stop watching the screen, then Watch a screen to pick it again\./, note) && !!(await logged(/via macOS's picker: picked a [^;]* after [\d.]+ s; no look at it in [\d.]+ s: nothing came from it$/)), 'a screen picked that sends nothing: said on the meeting, with what to do, and in the log', { note: await text(note), lines: lines().slice(-2) })
      await bar.locator('button', { hasText: 'Stop watching the screen' }).click()
    }
    await q.evaluate(() => { window.__picker = false; window.__pickerDead = false })
    await click(null, mac(null))
    await until(() => bar.locator('button', { hasText: 'Stop watching the screen' }).isVisible(), 6000)
    await card.close()

    // Picked: watched, and nothing left saying why not.
    await bar.locator('button', { hasText: 'Stop watching the screen' }).click()
    const asks = await q.evaluate(() => window.__screenAsks)
    await click(null, null)
    ok(!!(await until(() => bar.locator('button', { hasText: 'Capture' }).isVisible(), 6000)) && (await why.count()) === 0 && (await note.count()) === 0 && (await q.evaluate(() => window.__screenAsks)) === asks + 1, 'a screen picked: watched, with Capture, and no why left', await text(bar))
    await bar.locator('button.danger-soft', { hasText: 'Stop' }).click()
    await until(async () => (await api(`/meetings/${R.id}`)).status !== 'recording', 10000)
    ok(withoutCutOff(sw.errors).length === 0, 'Watch a screen refused: no page errors', sw.errors)
    await sw.ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
