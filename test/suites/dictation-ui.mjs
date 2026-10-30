// Dictation in the app, in the browser named by BRIDGE_TEST_BROWSER, with a stand-in for the
// computer's speech to text (/api/transcribe answers what each test says was said, and keeps what it
// was sent) and a stand-in Claude Code (CLAUDE_STAND_IN=fresh: what's typed into its terminal is in
// ~/claude-typed.log). Chromium records from its fake mic; WebKit from a tone made in the page.
//   The dictation key held in an agent's message box: its own recording bar while held, the key never
//   typed there, a 16 kHz mono WAV sent, the text tidied (names, fillers) at the cursor, a file said
//   aloud as a mention of the file in the agent's folder. Tapped: hands-free until pressed again.
//   Esc throws it away. The mic button held, and clicked then ✓. With nothing focused: the agent's
//   message box. A search field (⌘K): no capital or full stop. The agent's Terminal tab and a New
//   terminal: typed without Enter. On a phone: the mic button held with a finger.
//   Settings › Voice: the Dictation section, a new key picked by pressing it (and working), turned
//   off (the key does nothing); in a browser, no "from other apps" options. With the desktop app
//   simulated (window.bridgeApp): the key from any app off until you say yes, asked once after the
//   first words in Bridge AI (Turn on, Not now); what's shown for a key held from any app, tapped
//   (Wayland), not offered, and taken; changes go to the app; its key handed to the page in front.
//   The desktop app's dictation window (?dictate=1): the level while you talk, then the text, Send to
//   the agent you last looked at or one picked, Copy, Esc, and a press from before it was ready.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, checks, until, sleep, browser, page, shot, noServiceWorker, TEST, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('dictation-ui')
const kit = await startKit('dictation-ui', { env: { CLAUDE_STAND_IN: 'fresh' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const typedLog = path.join(kit.home, 'claude-typed.log')
const typed = () => (fs.existsSync(typedLog) ? fs.readFileSync(typedLog, 'utf8') : '')

// What the computer "heard": how many recordings were sent, and the text to answer with next.
const sent = []
const said = []
const prompts = []
// A WAV of 16 kHz mono 16-bit PCM, with some sound in it: { head: its first 44 bytes, length }.
const wavOk = (w) => {
  if (!w?.head) return false
  const h = Buffer.from(w.head)
  return w.length > 44 + 16000 * 0.3 * 2 && h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WAVE' && h.readUInt16LE(20) === 1 && h.readUInt16LE(22) === 1 && h.readUInt32LE(24) === 16000 && h.readUInt16LE(34) === 16 && h.readUInt32LE(40) === w.length - 44
}
// The first use, with no speech model on the computer yet (server/voice.js's answers): /api/transcribe
// says so (409, needs-model), Download starts it, /api/voice counts it up and then it's ready, and
// the recording sent again is answered. got: each try at transcribing.
const firstUse = async (c, got) => {
  const model = { id: 'parakeet-v3', label: 'Parakeet', mb: 670, have: false, runtime: 'sherpa' }
  const st = { stage: 'none', polls: 0 }
  const voiceNow = () => (st.stage === 'ready' ? { ready: true, model: { ...model, have: true }, missing: [], downloading: null, error: null }
    : { ready: false, needs: 'model', model, modelMB: 670, missing: [], downloading: st.stage === 'downloading' ? { percent: 40 } : null, error: null })
  await c.route('**/api/voice', (r) => { if (st.stage === 'downloading' && ++st.polls > 2) st.stage = 'ready'; return r.fulfill({ json: voiceNow() }) })
  await c.route('**/api/voice/setup', (r) => { st.stage = 'downloading'; return r.fulfill({ json: voiceNow() }) })
  await c.route('**/api/transcribe', async (r) => {
    sent.push(Date.now())
    got.push(Date.now())
    if (st.stage !== 'ready') return r.fulfill({ status: 409, json: { error: 'Speech to text needs a one-time download: Parakeet, 670 MB. It stays on this computer, and so does what you say.', code: 'needs-model', model } })
    return r.fulfill({ json: { text: said.shift() ?? 'hello there' } })
  })
}
// WebKit counts a request a reload cuts off (the presence ping, the live feed) as a page error.
const real = (errors) => errors.filter((e) => !/\/api\/[\w/.-]+ due to access control checks/.test(e))
const before = async (ctx) => {
  await noServiceWorker(ctx)
  // What the page sends to be transcribed, read in the page (WebKit doesn't hand a test the body).
  await ctx.addInitScript(() => {
    window.__wavs = []
    const f = window.fetch
    window.fetch = async (u, o) => {
      if (String(u).includes('/api/transcribe') && o?.body instanceof Blob) { const a = new Uint8Array(await o.body.arrayBuffer()); window.__wavs.push({ head: Array.from(a.subarray(0, 44)), length: a.length }) }
      return f(u, o)
    }
  })
  // WebKit has no fake mic: a tone made in the page stands in for one.
  if (which === 'webkit') {
    await ctx.addInitScript(() => {
      const tone = async () => {
        const ac = new AudioContext()
        const o = ac.createOscillator()
        const dest = ac.createMediaStreamDestination()
        o.connect(dest)
        o.start()
        return dest.stream
      }
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: tone, configurable: true, writable: true })
    })
  }
  await ctx.route('**/api/transcribe', async (route) => {
    sent.push(Date.now())
    await route.fulfill({ json: { text: said.shift() ?? 'hello there' } })
  })
  await ctx.route('**/api/voice', (route) => route.fulfill({ json: { ready: true, model: true, missing: [] } }))
}

try {
  await kit.api('/setup', { name: 'Tester' })
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  // A project, a repo of its own (inside this one's ignored test/.out, git would list none of it).
  const dir = path.join(kit.home, 'payments-api')
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'payments.ts'), 'export const pay = 1\n')
  spawnSync('git', ['init', '-q', dir])
  const agentOf = async (pred) => ((await kit.api('/fleet')).agents || []).find(pred)
  const one = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'payments', newSpace: 'payments' })
  const two = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'billing', newSpace: 'billing' })
  ok(!!(await until(() => agentOf((a) => a.paneId === one.paneId), 30000, 500)) && !!(await until(() => agentOf((a) => a.paneId === two.paneId), 30000, 500)), 'two stand-in agents, payments and billing')

  const { ctx, p, errors } = await page(b, kit.url, { before })
  const mac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
  const MODS = mac ? ['Alt'] : ['Control', 'Alt']
  const down = async (key = 'Space', mods = MODS) => { for (const m of mods) await p.keyboard.down(m); await p.keyboard.down(key) }
  const up = async (key = 'Space', mods = MODS) => { await p.keyboard.up(key); for (const m of [...mods].reverse()) await p.keyboard.up(m) }
  const hold = async (ms = 1500, key, mods) => { await down(key, mods); await sleep(ms); await up(key, mods) }
  const tap = async (key, mods) => { await down(key, mods); await up(key, mods) }
  const heardNow = () => sent.length

  await p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
  const box = p.locator('textarea[data-composer]').first()
  await box.waitFor({ timeout: 15000 })
  const value = () => box.inputValue().catch(() => '')

  // ---------- Held, in the message box ----------
  await box.click()
  said.push('um so open the the work tree for payments api and uh run the tests')
  let n = heardNow()
  await down()
  const bar = await until(async () => (await p.locator('.composer.rec .rec-bar').count()) > 0 && /let go/i.test(await p.locator('.composer.rec .comp-hint').innerText().catch(() => '')), 5000, 100)
  ok(!!bar, 'held in the message box: its recording bar, "let go to add it"')
  await shot(p, `${tag}dictation-holding`)
  await sleep(1300)
  await up()
  await until(() => heardNow() > n, 10000, 100)
  const wav = await p.evaluate(() => window.__wavs.at(-1))
  ok(wavOk(wav), 'what was said goes to the computer as a 16 kHz mono WAV', wav && Buffer.from(wav.head).toString('hex'))
  ok(!!(await until(async () => (await value()) === 'So open the worktree for payments-api and run the tests.', 8000)), 'the text in the box: fillers and the doubled word gone, names spelled right', await value())
  ok(!(await value()).includes(' '), 'the key itself typed nothing there')
  ok(!!(await until(() => p.evaluate(() => document.activeElement?.hasAttribute('data-composer')), 3000, 100)), 'and the box has the focus back')

  // Tapped: hands-free until it's pressed again. At the cursor, after what's there.
  await box.fill('Note.')
  await box.press('End')
  said.push('look at payments dot ts')
  n = heardNow()
  await tap()
  const free = await until(async () => /Listening/.test(await p.locator('.composer.rec .comp-hint').innerText().catch(() => '')), 5000, 100)
  ok(!!free, 'tapped: it keeps listening, hands-free', await p.locator('.composer').first().innerText().catch(() => ''))
  await sleep(900)
  ok(heardNow() === n, 'nothing sent until it\'s pressed again')
  await tap()
  ok(!!(await until(async () => (await value()) === 'Note. Look @src/payments.ts', 8000)), 'pressed again: the text after what was there, a file said aloud as a mention of the file in the agent\'s folder', await value())

  // Esc throws it away.
  n = heardNow()
  await down()
  await sleep(700)
  await p.keyboard.press('Escape')
  await up()
  await sleep(600)
  ok(heardNow() === n && (await p.locator('.composer.rec').count()) === 0, 'Esc cancels: nothing sent, the bar gone')

  // ---------- The mic button ----------
  await box.fill('')
  said.push('ship it')
  const mic = p.locator('.comp-btn.mic-btn').first()
  const mb = await mic.boundingBox()
  await p.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2)
  await p.mouse.down()
  await sleep(1500)
  await p.mouse.up()
  ok(!!(await until(async () => (await value()) === 'Ship it.', 8000)), 'the mic button held: the text when it\'s let go', await value())
  said.push('and test it')
  await mic.click()
  await until(async () => (await p.locator('.composer.rec').count()) > 0, 5000, 100)
  await sleep(900)
  await p.locator('.composer.rec .rec-stop').click()
  ok(!!(await until(async () => (await value()) === 'Ship it. And test it.', 8000)), 'clicked: listening until ✓', await value())

  // ---------- Nothing focused: the agent's message box ----------
  await box.fill('')
  await p.evaluate(() => document.activeElement?.blur())
  said.push('from nowhere')
  await hold()
  ok(!!(await until(async () => (await value()) === 'From nowhere.', 8000)), 'nothing focused: into the message box of the agent on screen', await value())

  // ---------- A search field ----------
  await p.keyboard.press('ControlOrMeta+K')
  const search = p.locator('[role="dialog"] input').first()
  await search.waitFor({ timeout: 5000 })
  said.push('payments')
  await hold()
  ok(!!(await until(async () => (await search.inputValue()) === 'payments', 8000)), 'a search field: the words as said, no capital or full stop', await search.inputValue().catch(() => ''))
  await p.keyboard.press('Escape')

  // ---------- The agent's Terminal tab: typed, without Enter ----------
  await p.locator('[role="tab"]', { hasText: 'Terminal' }).first().click()
  const xterm = p.locator('.terminal-host .xterm').first()
  await xterm.waitFor({ timeout: 15000 })
  await xterm.click()
  await until(() => p.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), 5000, 100)
  said.push('look at payments dot ts')
  await hold()
  const into = await until(() => typed().includes('look @payments.ts') && typed(), 10000, 200)
  ok(!!into, 'the agent\'s Terminal tab: typed into it, with no capital or full stop', typed().slice(-200))
  ok(into && !/[\r\n]/.test(into.split('look @payments.ts').pop()), 'and without Enter', JSON.stringify(into?.slice(-60)))
  await p.locator('[role="tab"]', { hasText: 'Chat' }).first().click()

  // ---------- A New terminal: typed at its prompt, not run ----------
  await p.locator('.rail-tool[aria-label="New terminal"]').click()
  const shell = p.locator('.live-shell .xterm').first()
  await shell.waitFor({ timeout: 15000 })
  const rows = () => p.locator('.live-shell .xterm-rows').first().innerText().catch(() => '')
  await until(async () => /[$#%>]\s*$/.test((await rows()).trimEnd().split('\n').pop() || ''), 30000)
  await shell.click()
  said.push(IS_WIN ? 'echo dictated-words' : 'echo dictated-words')
  await hold()
  const line = await until(async () => { const r = await rows(); return /echo dictated-words/.test(r) && r }, 10000, 200)
  await sleep(800)
  const r = await rows()
  ok(!!line && !r.split('\n').some((l) => l.trim() === 'dictated-words'), 'a New terminal: typed at its prompt, not run', r.slice(-300))
  await shot(p, `${tag}dictation-terminal`)

  // ---------- Settings › Voice ----------
  await p.locator('button[aria-label="Settings"]').first().click()
  await p.locator('.st-nav-item', { hasText: 'Voice' }).click()
  const sec = p.locator('.st-dictation')
  await sec.waitFor({ timeout: 8000 })
  const label = mac ? '⌥Space' : 'Ctrl+Alt+Space'
  ok((await sec.locator('.dict-key').innerText()).trim() === label, `Settings › Voice: Dictation, with the key (${label})`, await sec.innerText())
  ok(!/in the background/i.test(await sec.innerText()) && /In the desktop app, the key works from other apps too/.test(await sec.innerText()), 'in a browser: no "from other apps" options, one quiet line about the desktop app')
  await shot(p, `${tag}settings-voice`)
  await sec.locator('button', { hasText: 'Change' }).click()
  ok(/Press the keys/.test(await sec.locator('.dict-key').innerText()), 'Change: "Press the keys…"')
  await p.keyboard.press('Control+Alt+KeyD')
  const saved = await until(async () => (await kit.api('/config')).dictation?.key === 'Control+Alt+D', 5000, 200)
  ok(!!saved && !!(await until(async () => (await sec.locator('.dict-key').innerText()).trim() === (mac ? '⌃⌥D' : 'Ctrl+Alt+D'), 3000, 100)), 'a new key, picked by pressing it, saved', [(await kit.api('/config')).dictation, await sec.locator('.dict-key').innerText()])
  await p.locator('button[aria-label="Close settings"]').click()
  await p.evaluate(() => window.dispatchEvent(new Event('bridge-settings')))
  await p.reload()
  await p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
  await box.waitFor({ timeout: 15000 })
  await box.fill('')
  await box.click()
  n = heardNow()
  await hold(900)
  await sleep(500)
  ok(heardNow() === n, 'the old key does nothing now')
  await box.fill('')
  said.push('new key')
  await hold(1500, 'KeyD', ['Control', 'Alt'])
  ok(!!(await until(async () => (await value()) === 'New key.', 8000)), 'and the new one works', await value())
  await kit.api('/settings', { dictation: { key: null, on: false } }, 'PATCH')
  await p.reload()
  await p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
  await box.waitFor({ timeout: 15000 })
  await box.click()
  n = heardNow()
  await hold(900)
  await sleep(500)
  ok(heardNow() === n && (await p.locator('.composer.rec, .dict-bar').count()) === 0, 'turned off: the key does nothing')
  await kit.api('/settings', { dictation: { on: null } }, 'PATCH')
  ok(real(errors).length === 0, 'no page errors', errors)
  await ctx.close()

  // ---------- The desktop app, simulated: Settings and its key ----------
  const desktop = async (status) => page(b, kit.url, { before: async (c) => {
    await before(c)
    await c.addInitScript((s) => {
      window.__configured = []
      window.bridgeApp = { platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux', desktop: true, dictateStatus: async () => s, dictateConfigure: async (x) => { window.__configured.push(x); return s } }
    }, status)
  } })
  const voice = async (pg) => { await pg.locator('button[aria-label="Settings"]').first().click(); await pg.locator('.st-nav-item', { hasText: 'Voice' }).click(); const s = pg.locator('.st-dictation'); await s.waitFor({ timeout: 8000 }); await sleep(300); return s }
  {
    const d = await desktop({ mode: 'hold', via: 'bridgekeys', key: 'Alt+Space', active: true })
    let s = await voice(d.p)
    let bg = s.locator('label.st-check', { hasText: 'in the background' })
    ok(await bg.count() === 1 && !(await bg.locator('input').isChecked()) && /Hold .* in any app/.test(await bg.innerText()), 'desktop app, key held from any app: "Works while Bridge AI is in the background", off until you say yes', await s.innerText())
    ok(await s.locator('[role="radiogroup"]').count() === 0, 'with it off, no "send what I say to"')
    ok(!/In the desktop app/.test(await s.innerText()), 'and no line about the desktop app')
    // The key in Bridge AI: the words land, then it asks once about any app.
    await d.p.locator('button[aria-label="Close settings"]').click()
    await d.p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
    const dbox = d.p.locator('textarea[data-composer]').first()
    await dbox.waitFor({ timeout: 15000 })
    const talk = async (words) => {
      await dbox.fill('')
      await dbox.click()
      said.push(words)
      await d.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: 'down', at: Date.now() } })))
      await sleep(1500)
      await d.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: 'up', at: Date.now() } })))
    }
    await talk('from the desktop app')
    ok(!!(await until(async () => (await dbox.inputValue()) === 'From the desktop app.', 8000)), 'the desktop app\'s key, while Bridge AI is in front: as if pressed in the page', await dbox.inputValue())
    const offer = d.p.locator('.dict-offer')
    ok(!!(await until(() => offer.isVisible(), 5000, 100)) && /Use .*Space in any app too\? Hold it anywhere/.test(await offer.innerText()), 'then it asks once: the key in any app too?', await d.p.locator('body').innerText())
    ok(!(await d.p.evaluate(() => window.__configured.some((x) => x.background === true))), 'not turned on before you say yes')
    await shot(d.p, `${tag}dictation-offer`)
    await offer.locator('button', { hasText: 'Turn on' }).click()
    ok(!!(await until(() => d.p.evaluate(() => window.__configured.at(-1)?.background === true), 5000, 100)) && (await kit.api('/settings')).effective?.dictation?.background === true, 'Turn on: kept, and the desktop app is told', await d.p.evaluate(() => window.__configured))
    ok(await offer.count() === 0, 'and the question goes')
    await talk('once more')
    ok(!!(await until(async () => (await dbox.inputValue()) === 'Once more.', 8000)) && (await sleep(800), await offer.count() === 0), 'asked only once')
    s = await voice(d.p)
    bg = s.locator('label.st-check', { hasText: 'in the background' })
    ok(!!(await until(() => bg.locator('input').isChecked(), 3000, 100)) && await s.locator('[role="radiogroup"] input').count() === 3 && await s.locator('[role="radiogroup"] input').first().isChecked(), 'Settings shows it on, with where the text goes: the agent you looked at last, at first', await s.innerText())
    await s.locator('[role="radiogroup"] label', { hasText: 'The chief of staff' }).click()
    ok(!!(await until(() => d.p.evaluate(() => window.__configured.at(-1)?.to === 'chief'), 5000, 100)), 'a change goes to the desktop app', await d.p.evaluate(() => window.__configured))
    await shot(d.p, `${tag}settings-voice-desktop`)
    ok(real(d.errors).length === 0, 'no page errors', d.errors)
    await d.ctx.close()
    await kit.api('/settings', { dictation: { background: null, to: null } }, 'PATCH')
  }
  {
    // Not now: kept too, and never asked again.
    const d = await desktop({ mode: 'hold', via: 'bridgekeys', key: 'Alt+Space', active: true })
    await d.p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
    const dbox = d.p.locator('textarea[data-composer]').first()
    await dbox.waitFor({ timeout: 15000 })
    await dbox.fill('')
    await dbox.click()
    said.push('not this time')
    await d.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: 'down', at: Date.now() } })))
    await sleep(1500)
    await d.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: 'up', at: Date.now() } })))
    const offer = d.p.locator('.dict-offer')
    ok(!!(await until(() => offer.isVisible(), 8000, 100)), 'asked again in a fresh window while it was never answered')
    await offer.locator('button', { hasText: 'Not now' }).click()
    ok(!!(await until(async () => (await kit.api('/settings')).effective?.dictation?.background === false, 5000, 100)) && await offer.count() === 0 && !(await d.p.evaluate(() => window.__configured.some((x) => x.background === true))), 'Not now: kept as off, and the key stays inside Bridge AI')
    await d.ctx.close()
    await kit.api('/settings', { dictation: { background: null } }, 'PATCH')
  }
  {
    const d = await desktop({ mode: 'toggle', via: 'shortcut', asks: true, key: 'Control+Alt+Space' })
    const s = await voice(d.p)
    const bg = s.locator('label.st-check', { hasText: 'in the background' })
    ok(await bg.count() === 1 && !(await bg.locator('input').isChecked()) && /Tap .* in any app/.test(await bg.innerText()) && /asks once/.test(await bg.innerText()), 'Wayland (GNOME): tapped from any app, off until turned on, and it says the desktop asks once', await s.innerText())
    ok(await s.locator('[role="radiogroup"]').count() === 0, 'with it off, no "send what I say to"')
    await bg.locator('input').click()
    ok(!!(await until(() => d.p.evaluate(() => window.__configured.at(-1)?.background === true), 5000, 100)) && !!(await until(() => bg.locator('input').isChecked(), 3000, 100)), 'turned on: the desktop app is told')
    await d.ctx.close()
  }
  {
    const d = await desktop({ mode: null, why: 'This Wayland desktop has no GlobalShortcuts portal', key: 'Control+Alt+Space' })
    const s = await voice(d.p)
    ok(!/in the background/i.test(await s.innerText()) && await s.locator('[role="radiogroup"]').count() === 0, 'a desktop where other apps\' keys can\'t be heard (sway): those options hidden, not shown broken', await s.innerText())
    ok(/works inside Bridge AI only/.test(await s.innerText()), 'and the setting turned on elsewhere says, here, that it works inside Bridge AI only', await s.innerText())
    await d.ctx.close()
  }
  {
    const d = await desktop({ mode: 'hold', via: 'bridgekeys', key: 'Alt+Space', taken: 'macOS' })
    const s = await voice(d.p)
    ok(/one of macOS's own shortcuts/.test(await s.innerText()), 'a key macOS has: said so, with what to do', await s.innerText())
    await d.ctx.close()
  }

  // ---------- The dictation window (?dictate=1) ----------
  const hudPage = (pending = null) => page(b, `${kit.url}/?dictate=1`, { store: { 'cc-ws': { tabs: [one.paneId], active: one.paneId } }, before: async (c) => {
    await before(c)
    await c.route(/\/api\/agents\/[^/]+\/(prompt|queue)$/, async (route) => { prompts.push({ url: route.request().url(), body: route.request().postDataJSON() }); await route.fulfill({ json: { ok: true } }) })
    await c.addInitScript((p0) => {
      window.__hud = { phases: [], copied: [], hidden: 0, opened: [] }
      window.bridgeApp = {
        platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux', desktop: true,
        hudReady: async () => (p0 ? { down: Date.now() - 900, up: Date.now() - 100 } : null),
        hudSize: () => {}, hudPhase: (x) => window.__hud.phases.push(x), hudHide: async () => { window.__hud.hidden++ },
        hudCopy: async (x) => { window.__hud.copied.push(x) }, hudOpen: async (o) => { window.__hud.opened.push(o) },
      }
    }, pending)
  } })
  const key = (pg, type) => pg.evaluate((tp) => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: tp, at: Date.now() } })), type)
  {
    const { ctx: hc, p: h, errors: he } = await hudPage()
    await h.waitForSelector('.hud', { timeout: 10000 })
    said.push('add a retry to the webhook')
    await key(h, 'down')
    // Agents by their pane (a stand-in's title is its terminal's on Windows, the same for both).
    ok(!!(await until(async () => (await h.locator('.hud .rec-meter').count()) > 0 && (await h.locator('.hud-to-btn').getAttribute('data-pane').catch(() => '')) === one.paneId, 5000, 100)), 'the dictation window: listening, for the agent you last looked at', await h.locator('.hud').innerText().catch(() => ''))
    await shot(h, `${tag}dictation-window-listening`)
    await sleep(1300)
    await key(h, 'up')
    ok(!!(await until(async () => (await h.locator('.hud-text').innerText().catch(() => '')) === 'Add a retry to the webhook.', 8000)), 'let go: the text', await h.locator('.hud').innerText().catch(() => ''))
    await shot(h, `${tag}dictation-window-text`)
    const np = prompts.length
    await h.locator('.hud button', { hasText: 'Send' }).click()
    ok(!!(await until(() => prompts.length > np, 5000, 100)) && prompts.at(-1).url.includes(encodeURIComponent(one.paneId)) && prompts.at(-1).body.text === 'Add a retry to the webhook.', 'Send: to that agent', prompts.at(-1))
    const named = (a) => a.title || a.tab
    const pay = named(await agentOf((a) => a.paneId === one.paneId))
    ok(!!(await until(async () => (await h.locator('.hud').innerText()).includes(`Sent to ${pay}`), 4000, 100)) && !!(await until(() => h.evaluate(() => window.__hud.hidden > 0), 4000, 100)), '"Sent to" that agent, then it hides', [pay, await h.locator('.hud').innerText().catch(() => '')])
    // Another agent, picked; and Copy.
    said.push('check the invoices')
    await key(h, 'down'); await sleep(1300); await key(h, 'up')
    await until(async () => (await h.locator('.hud-text').count()) > 0, 8000, 100)
    await h.locator('.hud-to-btn').click()
    await h.locator(`.hud-menu button[data-pane="${two.paneId}"]`).click()
    await h.locator('.hud button', { hasText: 'Send' }).click()
    ok(!!(await until(() => prompts.at(-1)?.url.includes(encodeURIComponent(two.paneId)), 5000, 100)), 'To ▾: another agent picked, and sent there', prompts.at(-1))
    said.push('copy me')
    await key(h, 'down'); await sleep(1300); await key(h, 'up')
    await until(async () => (await h.locator('.hud-text').innerText().catch(() => '')) === 'Copy me.', 8000, 100)
    await h.locator('.hud button', { hasText: 'Copy' }).click()
    ok(!!(await until(() => h.evaluate(() => window.__hud.copied.at(-1) === 'Copy me.'), 4000, 100)) && /Copied/.test(await h.locator('.hud').innerText()), 'Copy: on the clipboard, and it says how to paste')
    // Esc while listening: thrown away.
    const ns = sent.length
    await key(h, 'down')
    await sleep(700)
    await key(h, 'cancel')
    await sleep(600)
    ok(sent.length === ns, 'Esc while listening: nothing sent')
    // Settings › Voice says Ask each time (changed since the window opened): nobody picked, no Send yet.
    await kit.api('/settings', { dictation: { to: 'ask' } }, 'PATCH')
    said.push('who is this for')
    await key(h, 'down'); await sleep(1300); await key(h, 'up')
    await until(async () => (await h.locator('.hud-text').count()) > 0, 8000, 100)
    ok(/pick an agent/.test(await h.locator('.hud-to-btn').innerText()) && await h.locator('.hud button', { hasText: 'Send' }).isDisabled(), 'Ask each time: "pick an agent", and Send waits for one', await h.locator('.hud').innerText())
    await kit.api('/settings', { dictation: { to: null } }, 'PATCH')
    const phases = await h.evaluate(() => window.__hud.phases)
    ok(phases.includes('listening') && phases.includes('result'), 'it tells the desktop app when it listens (Esc is held then) and when it\'s done', phases)
    ok(real(he).length === 0, 'no page errors', he)
    await hc.close()
  }
  {
    // A press from before the window was ready: let go by now, so it listens hands-free.
    const { ctx: hc, p: h } = await hudPage(true)
    ok(!!(await until(async () => /again when you're done/.test(await h.locator('.hud').innerText().catch(() => '')), 8000, 100)), 'a press from before it was ready: it listens, hands-free', await h.locator('.hud').innerText().catch(() => ''))
    await hc.close()
  }

  // ---------- The first use, with no speech model yet ----------
  {
    const got = []
    const { ctx: fc, p: f, errors: fe } = await page(b, kit.url, { before: async (c) => { await before(c); await firstUse(c, got) } })
    await f.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
    const fbox = f.locator('textarea[data-composer]').first()
    await fbox.waitFor({ timeout: 15000 })
    await fbox.fill('')
    await fbox.click()
    said.push('kept for later')
    const fmods = (await f.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))) ? ['Alt'] : ['Control', 'Alt']
    for (const m of fmods) await f.keyboard.down(m)
    await f.keyboard.down('Space')
    ok(!!(await until(() => f.locator('.composer.rec').count(), 5000, 100)), 'first use, no speech model yet: the mic opens all the same (only a download is missing)')
    await sleep(1300)
    await f.keyboard.up('Space')
    for (const m of [...fmods].reverse()) await f.keyboard.up(m)
    const panel = f.locator('.voice-setup').first()
    ok(!!(await until(async () => /one-time download: Parakeet, 670 MB/.test(await panel.innerText().catch(() => '')) && await panel.locator('button', { hasText: 'Download, then transcribe' }).isVisible(), 8000, 100)), 'let go: the one-time download offered, in one click, keeping what was said', await panel.innerText().catch(() => ''))
    await shot(f, `${tag}dictation-first-use`)
    await panel.locator('button', { hasText: 'Download, then transcribe' }).click()
    ok(!!(await until(async () => (await fbox.inputValue().catch(() => '')) === 'Kept for later.', 15000, 200)), 'downloaded: what was said, tidied, in the message box', await fbox.inputValue().catch(() => ''))
    const fw = await f.evaluate(() => window.__wavs.map((x) => x.length))
    ok(got.length === 2 && fw.length === 2 && fw[0] === fw[1] && fw[0] > 44, 'the same recording sent again, not a new one', fw)
    ok(real(fe).length === 0, 'no page errors', fe)
    await fc.close()
  }
  {
    // The dictation window, the same way.
    const got = []
    const { ctx: hc, p: h } = await page(b, `${kit.url}/?dictate=1`, { store: { 'cc-ws': { tabs: [one.paneId], active: one.paneId } }, before: async (c) => {
      await before(c)
      await firstUse(c, got)
      await c.addInitScript(() => { window.__hud = { phases: [], hidden: 0 }; window.bridgeApp = { platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux', desktop: true, hudReady: async () => null, hudSize: () => {}, hudPhase: (x) => window.__hud.phases.push(x), hudHide: async () => { window.__hud.hidden++ } } })
    } })
    await h.waitForSelector('.hud', { timeout: 10000 })
    said.push('from another app')
    const key = (type) => h.evaluate((tp) => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: tp, at: Date.now() } })), type)
    await key('down'); await sleep(1300); await key('up')
    const hp = h.locator('.hud .voice-setup')
    ok(!!(await until(async () => await hp.locator('button', { hasText: 'Download, then transcribe' }).isVisible().catch(() => false), 8000, 100)), 'the dictation window, first use: the same offer', await h.locator('.hud').innerText().catch(() => ''))
    await hp.locator('button', { hasText: 'Download, then transcribe' }).click()
    ok(!!(await until(async () => (await h.locator('.hud-text').innerText().catch(() => '')) === 'From another app.', 15000, 200)) && await h.evaluate(() => window.__hud.hidden === 0), 'downloaded: the text there, to send or copy (the window stays)', await h.locator('.hud').innerText().catch(() => ''))
    const hw = await h.evaluate(() => window.__wavs.map((x) => x.length))
    ok(got.length === 2 && hw.length === 2 && hw[0] === hw[1] && hw[0] > 44, 'the same recording sent again', hw)
    await hc.close()
  }

  // ---------- On a phone: the mic button held with a finger ----------
  {
    const { ctx: pc, p: ph, errors: pe } = await page(b, kit.url, { phone: true, before })
    await ph.waitForSelector('.tabbar button', { timeout: 15000 })
    await ph.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), one.paneId)
    const pbox = ph.locator('textarea[data-composer]').first()
    await pbox.waitFor({ timeout: 15000 })
    await pbox.fill('')
    said.push('from my phone')
    const pm = ph.locator('.comp-btn.mic-btn').first()
    await pm.dispatchEvent('pointerdown', { button: 0, pointerType: 'touch', isPrimary: true, pointerId: 7 })
    await sleep(1500)
    await ph.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { button: 0, pointerType: 'touch', isPrimary: true, pointerId: 7 })))
    ok(!!(await until(async () => (await pbox.inputValue()) === 'From my phone.', 8000)), 'on a phone: the mic button held, then let go', await pbox.inputValue())
    await shot(ph, `${tag}dictation-phone`)
    ok(real(pe).length === 0, 'no page errors on the phone', pe)
    await pc.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
