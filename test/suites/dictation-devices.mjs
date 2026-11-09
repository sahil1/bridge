// Dictation into another of your computers shown in this one's window, in the browser named by
// BRIDGE_TEST_BROWSER: two Bridge AIs, "Studio" (with its Chief of Staff) and "Desk" (where an agent
// works), on relays of their own (stand-ins/relay.mjs), linked; speech to text stood in for
// (/api/transcribe answers what each check says was said).
//   Desk's agent in a tab of Studio's window, split beside Studio's Chief of Staff: the key the
//   desktop app hands the window in front (with the key from any app on, it hears the key itself),
//   held with Desk's agent's message box focused, puts the words in that box, never in Studio's
//   Chief of Staff's; kept on Studio as typed for Desk's agent. The key pressed in Desk's box itself
//   (the page's own key): there too. With nothing focused and Desk's agent on screen: its message box.
//   What the desktop app's dictation window heard for a window showing Desk (that page can't use this
//   computer's microphone): put in Desk's agent's message box; a page with nowhere to put them says
//   so, and they're kept. Desk's mic button held in its tab, and Ask out loud on Desk's Chief of
//   Staff in a tab: Studio's page listens, and the words go into Desk's box, or to Desk's Chief of
//   Staff, never Studio's. A window showing Desk in the desktop app (simulated: its page can't use
//   the microphone and leaves the key to the app): the mic button and Ask out loud say so and what to
//   do instead, never "blocked", and its page doesn't take the key.
//   The dictation window's "the agent I looked at last", when that was on Desk (a tab, then a window
//   showing Desk): Send goes to it there, through Desk, never to Studio's Chief of Staff; gone from
//   Desk, or Desk out of reach, it says so, with nobody picked and the words kept.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, sleep, browser, page, shot, noServiceWorker, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('dictation-devices')
const relays = []
const kits = []
const kitWith = async (name, rel) => {
  const k = await startKit(`dictation-devices-${name.toLowerCase()}`, {
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, CLAUDE_STAND_IN: 'fresh' } },
  })
  kits.push(k)
  k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await k.api('/setup', { name: 'Tester' })
  await k.api('/agents/catalog')
  return k
}
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const real = (errors) => errors.filter((e) => !/\/api\/\S+ due to access control checks|WebSocket|_relay/.test(e))
// What the computer "heard", next, and how many recordings it was sent; and each message sent to an
// agent, anywhere ({ url, text }).
const said = []
let heardN = 0
const prompts = []
const before = async (ctx) => {
  await noServiceWorker(ctx)
  // A voice on the device, for Ask out loud (voice-chief.mjs has the real thing).
  await ctx.addInitScript(() => {
    const synth = { getVoices: () => [{ name: 'Samantha', voiceURI: 'Samantha', lang: 'en-US', localService: true, default: true }], speak: (u) => setTimeout(() => u.onend?.(), 50), cancel() {}, addEventListener() {}, removeEventListener() {} }
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
  })
  // WebKit has no fake mic: a tone made in the page (and in its frames) stands in for one.
  if (which === 'webkit') {
    await ctx.addInitScript(() => {
      const tone = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); o.connect(dest); o.start(); return dest.stream }
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: tone, configurable: true, writable: true })
    })
  }
  await ctx.route('**/api/transcribe', (r) => { heardN++; return r.fulfill({ json: { text: said.shift() ?? 'hello there' } }) })
  await ctx.route('**/api/voice', (r) => r.fulfill({ json: { ready: true, model: true, missing: [] } }))
  await ctx.route(/\/api\/agents\/[^/]+\/(prompt|queue)$/, async (r) => { prompts.push({ url: r.request().url(), text: r.request().postDataJSON()?.text }); await r.fulfill({ json: { ok: true } }) })
}
// Held with the mouse (the mic button, Ask out loud), in the page or a frame in it.
const holdOn = async (pg, el, ms = 1300) => {
  const r = await el.boundingBox()
  await pg.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await pg.mouse.down()
  await listens(pg)
  await sleep(ms)
  await pg.mouse.up()
}
// The desktop app's dictation window (?dictate=1), in a context with a window's saved state.
const hudOn = async (ctx, url) => {
  const h = await ctx.newPage()
  await h.addInitScript(() => {
    window.__hud = { hidden: 0 }
    window.bridgeApp = { platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux', desktop: true, hudReady: async () => null, hudSize: () => {}, hudPhase: () => {}, hudHide: async () => { window.__hud.hidden++ }, hudCopy: async () => {}, hudKeyboard: async () => true }
  })
  await h.goto(`${url}/?dictate=1`)
  await h.waitForSelector('.hud', { timeout: 10000 })
  return h
}
// The desktop app's key, handed to the window in front (desktop/dictation.js), and what it heard
// for a window showing another computer (the dictation window's words: bridge:hud-into).
const key = (pg, type) => pg.evaluate((tp) => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: tp, at: Date.now() } })), type)
const heardFor = (pg, text) => pg.evaluate((x) => { const d = { text: x, put: false }; window.dispatchEvent(new CustomEvent('bridge-dictated', { detail: d })); return d.put === true }, text)
// Listening: the mic's sound has come (the pill's ✓, or a message box's own).
const listens = (pg) => until(() => pg.locator('.rec-stop:enabled, .dp-ok:enabled').count(), 6000, 50)
const hold = async (pg, ms = 1300) => { await key(pg, 'down'); await listens(pg); await sleep(ms); await key(pg, 'up') }

try {
  const rs = await startRelay('dictation-devices-studio')
  const rd = await startRelay('dictation-devices-desk')
  relays.push(rs, rd)
  const studio = await kitWith('Studio', rs)
  const desk = await kitWith('Desk', rd)
  ok(!!(await until(async () => (await studio.api('/relay')).online && (await desk.api('/relay')).online, 20000)), 'each is connected to its own relay')
  const pairing = (await desk.api('/relay/pair', {})).pairing
  await studio.api('/machines', { link: `${rd.url} ${pairing.code}` })
  const deskM = await until(async () => (await studio.api('/machines')).machines.find((m) => m.name === 'Desk' && m.online), 30000, 300)
  ok(!!deskM, 'Studio is linked with Desk')

  // Studio's Chief of Staff, and an agent at work on Desk.
  await studio.api('/chief/launch', {})
  const chief = (await until(async () => ((await studio.api('/fleet')).agents || []).find((a) => a.chief), 30000, 500))?.paneId
  const work = path.join(desk.home, 'desk-work')
  fs.mkdirSync(work, { recursive: true })
  const deskPane = (await desk.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Desk work', newSpace: 'Desk work', prompt: 'idle' })).paneId
  ok(!!chief && !!(await until(async () => ((await desk.api('/fleet')).agents || []).some((a) => a.paneId === deskPane), 30000, 500)), 'Studio\'s Chief of Staff, and Desk\'s agent')
  await desk.api('/chief/launch', {})
  const deskChief = (await until(async () => ((await desk.api('/fleet')).agents || []).find((a) => a.chief), 30000, 500))?.paneId
  ok(!!deskChief, 'and Desk\'s Chief of Staff')
  const rid = `remote:${deskM.id}:${deskPane}`
  const remoteInfo = { [rid]: { title: 'Desk work', device: 'Desk', kind: 'claude' } }

  // ---------- Desk's agent in a tab of Studio's window, beside Studio's Chief of Staff ----------
  {
    const s = await page(b, studio.url, { before, store: { 'cc-ws': { tabs: [chief, rid], active: chief, side: rid, split: true, group: 'side' }, 'cc-remote-tabs': remoteInfo } })
    const p = s.p
    const chiefBox = p.locator(`textarea[data-composer="${chief}"]`)
    const inside = p.frameLocator('.remote-frame')
    const deskBox = inside.locator('textarea[data-composer]')
    await chiefBox.waitFor({ timeout: 30000 })
    await deskBox.waitFor({ timeout: 45000 })
    const chiefText = () => chiefBox.inputValue().catch(() => '')
    const deskText = () => deskBox.inputValue().catch(() => '')
    ok(await chiefBox.isVisible() && await deskBox.isVisible(), 'Studio\'s Chief of Staff and Desk\'s agent, side by side in Studio\'s window')

    // The report: Desk's agent's message box focused, the key held, and the words went to Studio's
    // Chief of Staff (and Enter there sent them to it).
    await deskBox.click()
    said.push('for the desk agent')
    await key(p, 'down')
    await listens(p)
    ok(/To Desk work/.test(await p.locator('.dict-dock').innerText().catch(() => '')) && !(await p.locator('.rec-stop').count()), 'held: the pill says the words are for Desk\'s agent (Studio\'s Chief of Staff\'s box doesn\'t listen)', await p.locator('.dict-dock').innerText().catch(() => ''))
    await sleep(1300)
    await shot(p, `${tag}dictation-devices-listening`)
    await key(p, 'up')
    ok(!!(await until(async () => (await deskText()) === 'For the desk agent.', 8000)), 'the key held with Desk\'s agent\'s message box focused: the words go in that box, on Desk', { desk: await deskText(), chief: await chiefText(), note: await p.locator('.dict-dock').innerText().catch(() => '') })
    ok(!(await chiefText()).includes('desk agent'), 'never in Studio\'s Chief of Staff\'s box', await chiefText())
    await shot(p, `${tag}dictation-devices-tab`)
    const kept = await until(async () => (await studio.api('/dictations?limit=20')).items.find((x) => x.text === 'For the desk agent.'), 5000, 200)
    ok(kept?.how === 'typed' && kept.agent?.id === rid && kept.agent.name === 'Desk work' && !kept.agent.chief, 'kept on Studio, as typed for Desk\'s agent', kept)

    // The key pressed in Desk's box itself (the page's own key, as in a browser or with the key from
    // any app off).
    const mac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    const MODS = mac ? ['Alt'] : ['Control', 'Alt']
    await deskBox.fill('')
    await deskBox.click()
    said.push('typed from here')
    for (const m of MODS) await p.keyboard.down(m)
    await p.keyboard.down('Space')
    await until(async () => (await p.locator('.rec-stop:enabled, .dp-ok:enabled').count()) + (await inside.locator('.rec-stop:enabled, .dp-ok:enabled').count()), 6000, 50)
    await sleep(1300)
    await p.keyboard.up('Space')
    for (const m of [...MODS].reverse()) await p.keyboard.up(m)
    ok(!!(await until(async () => (await deskText()) === 'Typed from here.', 8000)), 'the key pressed in Desk\'s box itself: there too', { desk: await deskText(), chief: await chiefText() })
    ok(!(await chiefText()).includes('from here'), 'and not in Studio\'s Chief of Staff\'s', await chiefText())
    // Studio's page listened (in the desktop app only its own pages may use the microphone, not
    // Desk's in the tab), and handed Desk's page the words.
    const here = await until(async () => (await studio.api('/dictations?limit=20')).items.find((x) => x.text === 'Typed from here.'), 5000, 200)
    ok(here?.how === 'typed' && here.agent?.id === rid, 'Studio\'s page listened for it, and handed Desk\'s page the words', here)
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
  }

  // ---------- nothing focused, Desk's agent on screen ----------
  {
    const s = await page(b, studio.url, { before, store: { 'cc-ws': { tabs: [chief, rid], active: rid, side: null, split: false, group: 'main' }, 'cc-remote-tabs': remoteInfo } })
    const p = s.p
    const deskBox = p.frameLocator('.remote-frame').locator('textarea[data-composer]')
    await deskBox.waitFor({ timeout: 45000 })
    await deskBox.fill('')
    await p.evaluate(() => { document.activeElement?.blur(); document.querySelector('.remote-frame')?.contentDocument?.activeElement?.blur() })
    said.push('nothing focused')
    await hold(p)
    ok(!!(await until(async () => (await deskBox.inputValue().catch(() => '')) === 'Nothing focused.', 8000)), 'nothing focused: into the message box of the agent on screen, Desk\'s in its tab', { desk: await deskBox.inputValue().catch(() => ''), note: await p.locator('.dict-dock').innerText().catch(() => '') })
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
  }

  // ---------- a window showing Desk: what the desktop app's dictation window heard for it ----------
  {
    const s = await page(b, `${studio.url}/m/${deskM.id}/`, { before, store: { [`cc-ws@${deskM.id}`]: { tabs: [deskPane], active: deskPane, side: null, split: false, group: 'main' } } })
    const p = s.p
    const box = p.locator(`textarea[data-composer="${deskPane}"]`)
    await box.waitFor({ timeout: 45000 })
    await p.evaluate(() => document.activeElement?.blur())
    ok(await heardFor(p, 'From the dictation window.') && !!(await until(async () => (await box.inputValue()) === 'From the dictation window.', 5000)), 'a window showing Desk, its words heard by the dictation window: in the message box of Desk\'s agent on screen', await box.inputValue())
    // Nowhere to put them (no agent on screen, nothing focused): it says so, and the dictation window keeps them.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: 'view:dictations' } })))
    await until(async () => !(await box.isVisible().catch(() => false)), 5000, 100)
    await p.evaluate(() => document.activeElement?.blur())
    ok(!(await heardFor(p, 'Nowhere to go.')), 'with nowhere to put them there: it says it didn\'t take them')
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
  }

  // ---------- started in Desk's tab: its mic button, and Ask out loud ----------
  {
    const rchief = `remote:${deskM.id}:${deskChief}`
    const s = await page(b, studio.url, { before, store: { 'cc-ws': { tabs: [chief, rid, rchief], active: rid, side: null, split: false, group: 'main' }, 'cc-remote-tabs': { ...remoteInfo, [rchief]: { title: 'Chief of Staff', device: 'Desk', kind: 'claude' } } } })
    const p = s.p
    const inside = p.frameLocator('.remote-frame')
    const deskBox = inside.locator('textarea[data-composer]')
    await deskBox.waitFor({ timeout: 45000 })
    await deskBox.fill('Before')
    said.push('from the mic button')
    await holdOn(p, inside.locator('.comp-btn.mic-btn').first())
    ok(!!(await until(async () => (await deskBox.inputValue().catch(() => '')) === 'Before From the mic button.', 8000)), 'Desk\'s mic button held in its tab: Studio\'s page listens, and the words go into Desk\'s box at its cursor', { desk: await deskBox.inputValue().catch(() => ''), note: await p.locator('.dict-dock').innerText().catch(() => '') })
    const kept = await until(async () => (await studio.api('/dictations?limit=30')).items.find((x) => x.text === 'From the mic button.'), 5000, 200)
    ok(kept?.how === 'typed' && kept.agent?.id === rid, 'kept on Studio, as typed for Desk\'s agent', kept)
    // Ask out loud on Desk's Chief of Staff, in its tab.
    await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), rchief)
    const ask = p.frameLocator('.remote-frame').locator('.ask-btn')
    await ask.waitFor({ timeout: 45000 })
    const n0 = prompts.length
    said.push("what's blocked")
    const r = await ask.boundingBox()
    await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await p.mouse.down()
    await listens(p)
    ok(/To Chief of Staff/.test(await p.locator('.dict-dock').innerText().catch(() => '')), 'Ask out loud held in Desk\'s Chief of Staff\'s tab: Studio\'s page listens, for that Chief of Staff', await p.locator('.dict-dock').innerText().catch(() => ''))
    await sleep(1300)
    await p.mouse.up()
    const sent = await until(() => prompts.slice(n0).find((x) => /Asked out loud/.test(x.text || '')), 8000, 100)
    ok(!!sent && sent.url.includes(`/m/${deskM.id}/api/agents/${encodeURIComponent(deskChief)}/`) && sent.text === "(Asked out loud) What's blocked.", 'let go: asked of Desk\'s Chief of Staff, through Desk', sent)
    ok(!prompts.slice(n0).some((x) => !x.url.includes('/m/')), 'never of Studio\'s', prompts.slice(n0))
    const askedK = await until(async () => (await studio.api('/dictations?limit=30')).items.find((x) => /^What's blocked/.test(x.text)), 5000, 200)
    ok(askedK?.how === 'sent' && askedK.agent?.chief === true, 'kept on Studio as sent to a Chief of Staff', askedK)
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
  }

  // ---------- a window showing Desk in the desktop app (simulated) ----------
  // Its page gets what the app's preload gives another device's page: no microphone, and the key left
  // to the app (dictates).
  {
    const s = await page(b, `${studio.url}/m/${deskM.id}/`, { store: { [`cc-ws@${deskM.id}`]: { tabs: [deskPane, deskChief], active: deskPane, side: null, split: false, group: 'main' } }, before: async (ctx) => {
      await before(ctx)
      await ctx.addInitScript((id) => { if (location.pathname.startsWith('/m/')) window.bridgeApp = { platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux', desktop: false, machine: id, dictates: true } }, deskM.id)
    } })
    const p = s.p
    const box = p.locator(`textarea[data-composer="${deskPane}"]`)
    await box.waitFor({ timeout: 45000 })
    const heard = heardN
    await p.locator('.comp-btn.mic-btn').first().click()
    const note = await until(async () => (await p.locator('.comp-note').innerText().catch(() => '')) || null, 5000, 100)
    ok(/can't use this computer's microphone/.test(note || '') && /Hold the dictation key/.test(note || '') && !/blocked/i.test(note || ''), 'its mic button: says this window can\'t use this computer\'s microphone and to hold the dictation key instead, never "blocked"', note)
    await sleep(500)
    ok(heardN === heard, 'and nothing is recorded or sent to be turned into text')
    // The key: left to the app, which listens for it in this window (the dictation suite checks its side).
    await p.locator('.comp-note button', { hasText: 'Close' }).click().catch(() => {})
    await box.click()
    const mac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    await p.keyboard.press(mac ? 'Alt+Space' : 'Control+Alt+Space')
    await sleep(800)
    ok(!(await p.locator('.rec-stop, .dp-ok').count()) && !(await p.locator('.comp-note').count()) && heardN === heard, 'the dictation key: left to the app (its page doesn\'t take it)', await p.locator('body').innerText().catch(() => '').then((x) => x.slice(-300)))
    await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), deskChief)
    const ask = p.locator('.ask-btn')
    await ask.waitFor({ timeout: 30000 })
    await ask.click()
    const askNote = await until(async () => (await p.locator('.dict-dock').innerText().catch(() => '')) || null, 5000, 100)
    ok(/Ask out loud can't listen here/.test(askNote || '') && /Hold the dictation key/.test(askNote || '') && !/blocked/i.test(askNote || ''), 'Ask out loud there: says it can\'t listen in this window and what to do instead', askNote)
    await sleep(400)
    await shot(p, `${tag}dictation-devices-window-note`)
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
  }

  // ---------- the dictation window: the agent you looked at last, on Desk ----------
  {
    const s = await page(b, studio.url, { before, store: { 'cc-ws': { tabs: [chief, rid], active: rid, side: null, split: false, group: 'main' }, 'cc-remote-tabs': remoteInfo } })
    const p = s.p
    await p.frameLocator('.remote-frame').locator('textarea[data-composer]').waitFor({ timeout: 45000 })
    const looked = () => p.evaluate(() => JSON.parse(localStorage.getItem('cc-looked') || 'null'))
    const l1 = await until(async () => { const l = await looked(); return l?.machine === deskM.id && l.pane === deskPane ? l : null }, 8000, 100)
    ok(l1?.name === 'Desk work', 'Desk\'s agent in a tab: kept as the agent you looked at last, with its device', await looked())
    // The window switched to Desk, at its Chief of Staff.
    await p.evaluate(([k, w]) => localStorage.setItem(k, JSON.stringify(w)), [`cc-ws@${deskM.id}`, { tabs: [deskChief], active: deskChief, side: null, split: false, group: 'main' }])
    await p.goto(`${studio.url}/m/${deskM.id}/`)
    await p.locator(`textarea[data-composer="${deskChief}"]`).waitFor({ timeout: 45000 })
    const l2 = await until(async () => { const l = await looked(); return l?.machine === deskM.id && l.pane === deskChief ? l : null }, 8000, 100)
    ok(!!l2, 'a window switched to Desk, at its Chief of Staff: that, on Desk', await looked())
    const h = await hudOn(s.ctx, studio.url)
    const hkey = (type) => h.evaluate((tp) => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: tp, at: Date.now() } })), type)
    const say = async (words) => { said.push(words); await hkey('down'); await listens(h); await sleep(1300); await hkey('up'); await until(async () => (await h.locator('.hud-text').innerText().catch(() => '')).toLowerCase().startsWith(words), 8000, 100) }
    await say('from another app')
    const chip = h.locator('.hud-to-btn')
    ok(!!(await until(async () => /To Chief of Staff on Desk/.test(await chip.innerText().catch(() => '')), 5000, 100)) && (await chip.getAttribute('data-pane')) === `remote:${deskM.id}:${deskChief}`, 'from another app: the dictation window is for Desk\'s Chief of Staff, "on Desk"', await h.locator('.hud').innerText().catch(() => ''))
    const n0 = prompts.length
    await h.locator('.hud button', { hasText: 'Send' }).click()
    const sent = await until(() => prompts[n0], 5000, 100)
    ok(!!sent && sent.url.includes(`/m/${deskM.id}/api/agents/${encodeURIComponent(deskChief)}/prompt`) && sent.text === 'From another app.', 'Send: to it, through Desk, never Studio\'s Chief of Staff', prompts.slice(n0))
    ok(!!(await until(async () => /Sent to Chief of Staff on Desk/.test(await h.locator('.hud').innerText().catch(() => '')), 4000, 100)), '"Sent to Chief of Staff on Desk"', await h.locator('.hud').innerText().catch(() => ''))
    const kept = await until(async () => (await studio.api('/dictations?limit=30')).items.find((x) => x.text === 'From another app.' && x.how === 'sent'), 5000, 200)
    ok(kept?.agent?.name === 'Chief of Staff on Desk' && !kept.agent.chief, 'kept as sent to Desk\'s Chief of Staff (not Studio\'s)', kept)
    // Gone from Desk: said, nobody picked, the words kept.
    await h.evaluate((id) => localStorage.setItem('cc-looked', JSON.stringify({ machine: id, pane: 'w99:p99', name: 'Old work', at: Date.now() })), deskM.id)
    const n1 = prompts.length
    await say('for old work')
    ok(!!(await until(async () => /Old work isn't running on Desk any more/.test(await h.locator('.hud').innerText().catch(() => '')), 5000, 100)) && /Pick an agent/.test(await chip.innerText()) && await h.locator('.hud button', { hasText: 'Send' }).isDisabled() && (await h.locator('.hud-text').innerText()) === 'For old work.' && prompts.length === n1, 'the agent you looked at gone from Desk: it says so, nobody is picked, and the words stay to send or copy', await h.locator('.hud').innerText().catch(() => ''))
    await sleep(400)
    await shot(h, `${tag}dictation-devices-hud-gone`)
    // Desk out of reach.
    await h.evaluate(() => localStorage.setItem('cc-looked', JSON.stringify({ machine: 'nowhere1', pane: 'w1:p1', name: 'Far work', at: Date.now() })))
    await say('for far work')
    ok(!!(await until(async () => /Can't reach your other device now to send it to Far work/.test(await h.locator('.hud').innerText().catch(() => '')), 8000, 100)) && /Pick an agent/.test(await chip.innerText()) && prompts.length === n1, 'its device out of reach: it says so, nobody is picked, and nothing is sent', await h.locator('.hud').innerText().catch(() => ''))
    ok(real(s.errors).length === 0, 'no page errors', s.errors)
    await s.ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await b.close()
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
