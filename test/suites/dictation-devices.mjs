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
//   so, and they're kept.
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
// What the computer "heard", next.
const said = []
const before = async (ctx) => {
  await noServiceWorker(ctx)
  // WebKit has no fake mic: a tone made in the page (and in its frames) stands in for one.
  if (which === 'webkit') {
    await ctx.addInitScript(() => {
      const tone = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); o.connect(dest); o.start(); return dest.stream }
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: tone, configurable: true, writable: true })
    })
  }
  await ctx.route('**/api/transcribe', (r) => r.fulfill({ json: { text: said.shift() ?? 'hello there' } }))
  await ctx.route('**/api/voice', (r) => r.fulfill({ json: { ready: true, model: true, missing: [] } }))
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
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  await b.close()
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
