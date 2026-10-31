// Your dictations kept, and the pill dictation shows while it listens, in the browser named by
// BRIDGE_TEST_BROWSER, with a stand-in for the computer's speech to text (/api/transcribe answers
// what each test says was said) and a stand-in Claude Code.
//   Kept (server/dictations.js): written to the data folder a month to a file and read back after a
//   restart, what became of it appended as a line of its own, an agent named from its pane; search
//   (every word, in the words, what was heard and the app's or agent's name); deleted from the disk
//   (not just the list) and put back by Undo; kept for 30 days, a year or always, the old ones taken
//   out of their files; a line cut off by a crash skipped and the next one on a line of its own; the
//   recordings only with "Keep the recordings too"; an app's icon; nothing at all with history off;
//   Delete all.
//   The pill: inside Bridge AI (a search box), listening (the level, the time, where it goes, ✕
//   and ✓), Transcribing…, then what became of the words, then gone, kept with where it went; the
//   message box's own recording bar stays. From another app (?dictate=1, the desktop app
//   simulated): the same pill, "To" an agent or "Into" the app, then the card with the words to send,
//   or Pasting… then "Pasted into Slack"; the window keeps its width and top and grows down; clicks
//   go through it but for the pill; each kept with the app it was said in and what became of it; a
//   password field's not kept. Light and dark.
//   Dictations: in the sidebar once there's one, by day with each one's app icon or agent, search,
//   one open whole (and as it was heard), Copy, Paste again (the desktop app simulated), Send to an
//   agent, Delete and Undo; on a phone in the Meetings tab, with no Paste again. Settings › Voice:
//   history off (nothing kept, and the view says so), 30 days, the recordings, Delete all.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, browser, page, shot, noServiceWorker, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('dictation-history')
const kit = await startKit('dictation-history', { env: { CLAUDE_STAND_IN: 'fresh' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const DIR = path.join(kit.data, 'dictations')
const month = (at = Date.now()) => new Date(at).toISOString().slice(0, 7)
const fileText = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('') : '')
const list = (q = '') => kit.api(`/dictations?limit=500${q ? `&q=${encodeURIComponent(q)}` : ''}`)
const setDictation = (o) => kit.api('/settings', { dictation: o }, 'PATCH')
// A WAV of 16 kHz mono 16-bit silence, ms long.
const wavOf = (ms) => {
  const n = Math.round(16 * ms)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  return b
}
// A tiny PNG (one pixel), as the desktop app keeps an app's icon.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

// What the computer "heard": the text to answer with next (a moment late, to see Transcribing…).
const said = []
let slow = 0
const real = (errors) => errors.filter((e) => !/\/api\/[\w/.?=&-]+ due to access control checks/.test(e))
const before = async (ctx) => {
  await noServiceWorker(ctx)
  if (which === 'webkit') {
    await ctx.addInitScript(() => {
      const tone = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); o.connect(dest); o.start(); return dest.stream }
      Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: tone, configurable: true, writable: true })
    })
  }
  await ctx.route('**/api/transcribe', async (route) => { if (slow) await sleep(slow); await route.fulfill({ json: { text: said.shift() ?? 'hello there' } }) })
  await ctx.route('**/api/voice', (route) => route.fulfill({ json: { ready: true, model: true, missing: [] } }))
}

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  const dir = path.join(kit.home, 'payments-api')
  fs.mkdirSync(dir, { recursive: true })
  const one = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'payments', newSpace: 'payments' })
  const agentOf = async (pred) => ((await kit.api('/fleet')).agents || []).find(pred)
  const pay = await until(() => agentOf((a) => a.paneId === one.paneId), 30000, 500)
  ok(!!pay, 'a stand-in agent, payments')
  // On Windows a stand-in's name is its terminal's title, which changes as it runs: an agent is told
  // by its pane, and its name only checked to be there.

  // ---------- Kept, read back, changed ----------
  const a = await kit.api('/dictations', { text: 'Add a retry to the webhook.', raw: 'um add a retry to the the webhook', ms: 2400, how: 'typed', agent: { id: one.paneId } })
  let l = await list()
  const got = l.items.find((x) => x.id === a.id)
  ok(a.kept && got?.text === 'Add a retry to the webhook.' && got.raw === 'um add a retry to the the webhook' && got.ms === 2400 && got.how === 'typed' && got.agent?.id === one.paneId && !!got.agent.name, 'kept: the words as put in and as heard, how long, and the agent (named from its pane)', got)
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR) : []
  ok(files.includes(`${month()}.jsonl`) && fileText().trim().split('\n').length === 1, 'in the data folder, dictations/<month>.jsonl, a line for it', files)
  await kit.api(`/dictations/${a.id}`, { how: 'sent' }, 'PATCH')
  ok(fileText().trim().split('\n').length === 2 && JSON.parse(fileText().trim().split('\n')[1]).set?.how === 'sent', 'what became of it: a line of its own, appended (the first left as it was)', fileText())
  await kit.restart()
  l = await list()
  ok(l.items.find((x) => x.id === a.id)?.how === 'sent' && l.total === 1, 'after a restart: read back as it stands', l.items)

  // ---------- Search ----------
  const b1 = await kit.api('/dictations', { text: 'Check the invoices for October.', ms: 1800, how: 'pasted', app: { name: 'Slack', bundle: 'com.tinyspeck.slackmacgap' } })
  const b2 = await kit.api('/dictations', { text: 'Lunch at noon?', ms: 900, how: 'copied', app: { name: 'Messages', bundle: 'com.apple.MobileSMS' } })
  const ids = async (q) => (await list(q)).items.map((x) => x.id).sort().join()
  ok(await ids('invoices') === b1.id && await ids('slack') === b1.id && await ids('INVOICES october') === b1.id && await ids('invoices lunch') === '' && await ids('um add') === a.id, 'search: every word, in the words, what was heard, or the app\'s name', [await ids('invoices'), await ids('slack')])
  l = await list()
  ok(l.items.map((x) => x.id).join() === [b2.id, b1.id, a.id].join(), 'newest first', l.items.map((x) => x.text))

  // ---------- An app's icon ----------
  fs.mkdirSync(path.join(DIR, 'icons'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'icons', 'com.tinyspeck.slackmacgap.png'), PNG)
  await sleep(15500) // the icons are looked at again every 15 seconds
  l = await list()
  const icon = await fetch(`${kit.url}/api/dictations/icons/com.tinyspeck.slackmacgap`)
  const sneaky = await fetch(`${kit.url}/api/dictations/icons/${encodeURIComponent('../config.json')}`)
  ok(l.items.find((x) => x.id === b1.id)?.icon === true && !l.items.find((x) => x.id === b2.id)?.icon && icon.ok && icon.headers.get('content-type') === 'image/png' && sneaky.status === 404, 'an app\'s icon, kept in the data folder: served by its bundle ID, and nothing else is', [icon.status, sneaky.status])

  // ---------- Delete, and Undo ----------
  const del = await kit.api(`/dictations/${b2.id}`, null, 'DELETE')
  ok(del.deleted?.id === b2.id && !(await list()).items.some((x) => x.id === b2.id) && !fileText().includes('Lunch at noon'), 'deleted: gone from the list and from the disk', fileText())
  await kit.api('/dictations', { restore: del.deleted })
  l = await list()
  const back = l.items.find((x) => x.id === b2.id)
  ok(back?.text === 'Lunch at noon?' && back.at === del.deleted.at && fileText().includes('Lunch at noon'), 'Undo: back as it was, with its time', back)

  // ---------- The recording ----------
  const noAudio = await fetch(`${kit.url}/api/dictations/${b1.id}/audio`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wavOf(500) }).then((r) => r.json())
  ok(noAudio.kept === false && !fs.existsSync(path.join(DIR, 'audio')), 'the recording: not kept unless you ask for it', noAudio)
  await setDictation({ keepAudio: true })
  const withAudio = await fetch(`${kit.url}/api/dictations/${b1.id}/audio`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wavOf(500) }).then((r) => r.json())
  const played = await fetch(`${kit.url}/api/dictations/${b1.id}/audio`)
  ok(withAudio.kept && (await list()).items.find((x) => x.id === b1.id)?.audio === true && played.ok && (await played.arrayBuffer()).byteLength === wavOf(500).length, '"Keep the recordings too": kept, and played back', withAudio)
  await kit.api(`/dictations/${b1.id}`, null, 'DELETE')
  ok(!fs.existsSync(path.join(DIR, 'audio', `${b1.id}.wav`)), 'deleted: its recording too')
  await setDictation({ keepAudio: null })

  // ---------- How long they're kept ----------
  // Older ones, as an earlier Bridge AI kept them (written before the server reads them).
  const old = (days, text) => { const at = new Date(Date.now() - days * 864e5).toISOString(); fs.appendFileSync(path.join(DIR, `${month(at)}.jsonl`), `${JSON.stringify({ id: `old${days}xxxxxxxx`, at, ms: 1000, text, how: 'copied' })}\n`) }
  old(40, 'Forty days ago.')
  old(200, 'Two hundred days ago.')
  old(800, 'Two years ago.')
  // A line cut off by a crash, at the end of this month's file.
  fs.appendFileSync(path.join(DIR, `${month()}.jsonl`), '{"id":"cutoffxxxxxx","at":"')
  await kit.restart()
  l = await list()
  ok(['Forty days ago.', 'Two hundred days ago.', 'Two years ago.'].every((x) => l.items.some((y) => y.text === x)), 'kept for always, at first: the old ones too', l.items.map((x) => x.text))
  const c = await kit.api('/dictations', { text: 'After the crash.', ms: 700 })
  ok(c.kept && fileText().split('\n').some((line) => { try { return JSON.parse(line).id === c.id } catch { return false } }) && (await list()).items.some((x) => x.id === c.id), 'a line cut off by a crash: skipped, and the next one kept on a line of its own')
  await setDictation({ keepFor: '1y' })
  l = await list()
  ok(l.items.some((x) => x.text === 'Two hundred days ago.') && !l.items.some((x) => x.text === 'Two years ago.'), 'a year: what\'s older isn\'t listed', l.items.map((x) => x.text))
  await setDictation({ keepFor: '30d' })
  l = await list()
  await sleep(500)
  ok(!l.items.some((x) => /days ago/.test(x.text)) && l.items.some((x) => x.id === a.id), '30 days: only the last 30 days', l.items.map((x) => x.text))
  const oldFile = path.join(DIR, `${month(Date.now() - 800 * 864e5)}.jsonl`)
  ok(!!(await until(() => !fs.existsSync(oldFile) && !fileText().includes('Forty days ago'), 5000, 200)), 'and the older ones taken out of the disk, a month at a time', fs.readdirSync(DIR))
  await setDictation({ keepFor: null })

  // ---------- History off ----------
  await setDictation({ history: false })
  const before0 = fileText()
  const off = await kit.api('/dictations', { text: 'Not to be kept.', ms: 500 })
  ok(off.kept === false && fileText() === before0 && (await list()).history === false, 'history off: nothing kept (the files as they were)', off)
  await setDictation({ history: null })

  // ---------- The pill, inside Bridge AI ----------
  const shots = async (p, name) => { await shot(p, `${tag}${name}`) }
  // Inside Bridge AI: the whole window, and the bottom of it around the pill.
  const pillShot = async (p, name) => {
    await shots(p, name)
    const r = await p.locator('.dict-dock .dp').boundingBox().catch(() => null)
    if (r) await shot(p, `${tag}${name}-close`, { clip: { x: Math.round(r.x + r.width / 2 - 260), y: Math.round(r.y - 40), width: 520, height: Math.round(r.height + 60) } })
  }
  // The dictation window, as it shows over another app: the part of the screen around it, on a
  // backdrop standing in for that app (the window itself is see-through).
  const hudShot = async (p, name) => {
    await p.evaluate(() => { const s = document.createElement('style'); s.id = 'backdrop'; s.textContent = 'html.is-hud.is-hud, html.is-hud.is-hud body { background: linear-gradient(135deg, light-dark(#dfe6ee, #2a2f38), light-dark(#c9d3df, #1b1f26)) !important; color-scheme: light dark; }'; document.head.append(s) })
    await sleep(300) // done easing
    const r = await p.locator('.hud').boundingBox()
    await shot(p, `${tag}${name}`, { clip: { x: Math.round(r.x + r.width / 2 - 260), y: 0, width: 520, height: Math.round(r.y + r.height + 36) } })
    await p.evaluate(() => document.getElementById('backdrop')?.remove())
  }
  for (const mode of ['light', 'dark']) {
    const { ctx, p, errors } = await page(b, kit.url, { before, mode })
    const mac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    const MODS = mac ? ['Alt'] : ['Control', 'Alt']
    await p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
    await p.locator('textarea[data-composer]').first().waitFor({ timeout: 15000 })
    await p.keyboard.press('ControlOrMeta+K')
    const search = p.locator('[role="dialog"] input').first()
    await search.waitFor({ timeout: 5000 })
    // The search box has the keyboard before the key goes down (else the words would be for the agent on screen).
    await until(() => p.evaluate(() => document.activeElement?.closest?.('[role="dialog"]') != null && document.activeElement.tagName === 'INPUT'), 5000, 50)
    said.push('payments retry')
    slow = 1500
    for (const m of MODS) await p.keyboard.down(m)
    await p.keyboard.down('Space')
    const pill = p.locator('.dict-dock .dp')
    const listening = await until(async () => (await p.locator('.dict-dock .dp-listening').count()) > 0 && (await p.locator('.dict-dock .dp-wave i').count()) >= 12 && /\d:\d\d/.test(await pill.innerText()) && /Where you're typing/.test(await pill.innerText()), 5000, 100)
    ok(!!listening && await p.locator('.dict-dock .dp-x').count() === 1 && await p.locator('.dict-dock .dp-ok').count() === 1, `${mode}: inside Bridge AI, the pill while it listens: the level, the time, where it goes, ✕ and ✓`, await pill.innerText().catch(() => ''))
    const box0 = await pill.boundingBox()
    const vw = await p.evaluate(() => innerWidth)
    ok(box0 && Math.abs(box0.x + box0.width / 2 - vw / 2) < 4 && box0.height <= 40 && box0.width < 420, `${mode}: small, in the middle at the bottom`, box0)
    // The same pill all along (never taken away and put back, which would flash): marked now, and
    // looked for at the end.
    await p.evaluate(() => { document.querySelector('.dict-dock .dp').dataset.same = '1' })
    await sleep(900)
    await pillShot(p, `dictation-pill-${mode}`)
    await p.keyboard.up('Space')
    for (const m of [...MODS].reverse()) await p.keyboard.up(m)
    ok(!!(await until(async () => /Transcribing/.test(await pill.innerText().catch(() => '')), 3000, 50)), `${mode}: then "Transcribing…"`)
    await pillShot(p, `dictation-pill-working-${mode}`)
    ok(!!(await until(async () => /Added where you were typing/.test(await pill.innerText().catch(() => '')), 5000, 50)) && (await search.inputValue()) === 'payments retry' && await p.locator('.dict-dock .dp[data-same="1"]').count() === 1, `${mode}: then what became of the words, the same pill all along (no flash)`, await search.inputValue())
    await pillShot(p, `dictation-pill-done-${mode}`)
    ok(!!(await until(async () => (await p.locator('.dict-dock').count()) === 0, 4000, 100)), `${mode}: and it's gone`)
    slow = 0
    const kept = (await list()).items[0]
    ok(kept?.text === 'payments retry' && kept.how === 'typed' && kept.place === 'field', `${mode}: kept, typed into a box in Bridge AI`, kept)
    await p.keyboard.press('Escape')
    ok(real(errors).length === 0, `${mode}: no page errors`, errors)
    await ctx.close()
  }
  {
    // The message box keeps its own recording bar, and what's said there is kept with its agent.
    const { ctx, p } = await page(b, kit.url, { before })
    const mac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    const MODS = mac ? ['Alt'] : ['Control', 'Alt']
    await p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
    const box = p.locator('textarea[data-composer]').first()
    await box.waitFor({ timeout: 15000 })
    await box.click()
    said.push('ship the fix')
    for (const m of MODS) await p.keyboard.down(m)
    await p.keyboard.down('Space')
    const own = await until(async () => (await p.locator('.composer.rec .rec-bar').count()) > 0, 5000, 100)
    const noPill = await p.locator('.dict-dock').count() === 0
    await sleep(1300)
    await p.keyboard.up('Space')
    for (const m of [...MODS].reverse()) await p.keyboard.up(m)
    await until(async () => (await box.inputValue()) === 'Ship the fix.', 8000)
    const kept = await until(async () => (await list()).items.find((x) => x.text === 'Ship the fix.'), 5000, 200)
    ok(!!own && noPill && kept?.agent?.id === one.paneId && !!kept.agent.name && kept.how === 'typed', 'the message box: its own recording bar (no pill), and kept with its agent', kept)
    await ctx.close()
  }

  // ---------- The pill, from another app (?dictate=1) ----------
  const prompts = []
  const hudPage = (status, answer, mode = 'light') => page(b, `${kit.url}/?dictate=1`, { mode, store: { 'cc-ws': { tabs: [one.paneId], active: one.paneId } }, before: async (ctx) => {
    await before(ctx)
    await ctx.route(/\/api\/agents\/[^/]+\/(prompt|queue)$/, async (route) => { prompts.push({ url: route.request().url(), body: route.request().postDataJSON() }); await route.fulfill({ json: { ok: true } }) })
    await ctx.addInitScript(([st, ans]) => {
      window.__hud = { sizes: [], pointer: [], hidden: 0, pasted: [] }
      window.bridgeApp = {
        platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux', desktop: true,
        hudReady: async () => null, hudSize: (w, h) => window.__hud.sizes.push([w, h]), hudPhase: () => {}, hudHide: async () => { window.__hud.hidden++ },
        hudCopy: async () => {}, hudOpen: async () => {}, hudPointer: (on) => window.__hud.pointer.push(on),
        dictateStatus: async () => st, dictateConfigure: async () => st,
        hudPaste: async (x) => { window.__hud.pasted.push(x); await new Promise((r) => setTimeout(r, 700)); return ans },
      }
    }, [status, answer])
  } })
  const key = (pg, type, extra = {}) => pg.evaluate(([tp, x]) => window.dispatchEvent(new CustomEvent('bridge-dictate-key', { detail: { type: tp, at: Date.now(), ...x } })), [type, extra])
  const SLACK = { app: 'Slack', bundle: 'com.tinyspeck.slackmacgap' }
  const HELD = { mode: 'hold', via: 'bridgekeys', key: 'Alt+Space', active: true, background: true }
  for (const mode of ['light', 'dark']) {
    const { ctx, p, errors } = await hudPage({ ...HELD, paste: { can: false } }, null, mode)
    const hud = p.locator('.hud')
    await hud.waitFor({ timeout: 10000 })
    said.push(`check the invoices ${mode}`)
    slow = 1200
    await key(p, 'down', SLACK)
    ok(!!(await until(async () => (await p.locator('.hud .dp-listening .dp-wave').count()) > 0 && (await p.locator('.hud-to-btn').getAttribute('data-pane').catch(() => '')) === one.paneId && /^To \S/.test(await p.locator('.hud-to-btn').innerText().catch(() => '')), 5000, 100)), `${mode}: from another app, the same pill: "To" the agent you looked at last`, [await p.locator('.hud-to-btn').getAttribute('data-pane').catch(() => ''), await hud.innerText().catch(() => '')])
    await sleep(900)
    const pillBox = await hud.boundingBox()
    await p.evaluate(() => { document.querySelector('.hud').dataset.same = '1' })
    await hudShot(p, `dictation-window-pill-${mode}`)
    // The pointer on the pill: the window takes the click; off it, clicks go through.
    await p.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2)
    await p.mouse.move(pillBox.x + pillBox.width / 2 + 1, pillBox.y + pillBox.height / 2)
    await p.mouse.move(2, 300)
    ok((await p.evaluate(() => window.__hud.pointer.join())) === 'true,false', `${mode}: clicks go through the window, but for the pill`, await p.evaluate(() => window.__hud.pointer))
    await key(p, 'up')
    ok(!!(await until(async () => /Transcribing/.test(await hud.innerText().catch(() => '')), 3000, 50)), `${mode}: then "Transcribing…"`)
    await hudShot(p, `dictation-window-working-${mode}`)
    const card = await until(async () => (await p.locator('.hud-text').innerText().catch(() => '')) === `Check the invoices ${mode}.` && p.locator('.hud.card'), 6000, 100)
    await sleep(400)
    const cardBox = await hud.boundingBox()
    ok(!!card && await p.locator('.hud[data-same="1"]').count() === 1 && cardBox.height > pillBox.height + 40 && Math.abs((cardBox.y) - pillBox.y) < 2 && Math.abs((cardBox.x + cardBox.width / 2) - (pillBox.x + pillBox.width / 2)) < 2, `${mode}: grown into the card with the words, down from where the pill was (the same one, its top and middle kept)`, { pillBox, cardBox })
    const sizes = await p.evaluate(() => window.__hud.sizes)
    ok(sizes.length > 1 && sizes.every(([w]) => w === sizes[0][0]) && Math.max(...sizes.map(([, h]) => h)) >= cardBox.height + 12, `${mode}: the window keeps its width, and grows to fit`, sizes.slice(-4))
    await hudShot(p, `dictation-window-card-${mode}`)
    slow = 0
    await p.locator('.hud button', { hasText: 'Send' }).click()
    ok(!!(await until(async () => /Sent to/.test(await hud.innerText().catch(() => '')) && (await p.locator('.hud .dp-done').count()) === 1, 4000, 50)) && await p.locator('.hud[data-same="1"]').count() === 1, `${mode}: Send: back to the pill, "Sent to" (the same one all along)`, await hud.innerText().catch(() => ''))
    await hudShot(p, `dictation-window-sent-${mode}`)
    ok(!!(await until(() => p.evaluate(() => window.__hud.hidden > 0), 4000, 100)), `${mode}: then it's gone`)
    const kept = await until(async () => { const x = (await list()).items.find((y) => y.text === `Check the invoices ${mode}.`); return x?.how === 'sent' && x }, 5000, 200)
    ok(kept?.app?.name === 'Slack' && kept.app.bundle === 'com.tinyspeck.slackmacgap' && kept.agent?.id === one.paneId, `${mode}: kept with the app it was said in, sent to the agent`, kept)
    ok(real(errors).length === 0, `${mode}: no page errors`, errors)
    await ctx.close()
  }
  await setDictation({ to: 'paste' })
  {
    const { ctx, p } = await hudPage({ ...HELD, paste: { can: true, via: 'bridgekeys', asks: 'accessibility', allowed: true } }, { pasted: true, read: true, restored: true })
    const hud = p.locator('.hud')
    await hud.waitFor({ timeout: 10000 })
    said.push('see you at three')
    await key(p, 'down', SLACK)
    ok(!!(await until(async () => /Into Slack/.test(await hud.innerText().catch(() => '')), 5000, 100)), 'pasting where you\'re typing: "Into Slack" while it listens')
    await sleep(1200)
    await key(p, 'up')
    let sawCard = false
    const pasting = await until(async () => { if (await p.locator('.hud.card').count()) sawCard = true; return /Pasting into Slack/.test(await hud.innerText().catch(() => '')) }, 5000, 20)
    await hudShot(p, 'dictation-window-pasting')
    const pasted = await until(async () => { if (await p.locator('.hud.card').count()) sawCard = true; return /Pasted into Slack/.test(await hud.innerText().catch(() => '')) }, 5000, 20)
    ok(!!pasting && !!pasted && !sawCard, 'then "Pasting into Slack…" and "Pasted into Slack", the pill all along (never the card)', await hud.innerText().catch(() => ''))
    const kept = await until(async () => { const x = (await list()).items.find((y) => y.text === 'See you at three.'); return x?.how === 'pasted' && x }, 5000, 200)
    ok(kept?.app?.name === 'Slack', 'kept: pasted into Slack', kept)
    await ctx.close()
  }
  {
    // A password field had the keyboard: not pasted, and not kept.
    const { ctx, p } = await hudPage({ ...HELD, paste: { can: true, via: 'bridgekeys', asks: 'accessibility', allowed: true } }, { error: 'secure' })
    await p.locator('.hud').waitFor({ timeout: 10000 })
    said.push('my secret words')
    await key(p, 'down', SLACK); await sleep(1200); await key(p, 'up')
    await until(async () => /Secure input is on/.test(await p.locator('.hud').innerText().catch(() => '')), 6000, 100)
    await sleep(1000)
    ok(!(await list()).items.some((x) => /secret words/i.test(x.text)) && !fileText().includes('secret words'), 'a password field\'s words: not kept', (await list()).items.map((x) => x.text))
    await ctx.close()
  }
  await setDictation({ to: null })

  // ---------- Dictations ----------
  const asked = []
  const view = (opts = {}) => page(b, kit.url, { ...opts, before: async (ctx) => {
    await before(ctx)
    await ctx.route(/\/api\/agents\/[^/]+\/(prompt|queue)$/, async (route) => { asked.push({ url: route.request().url(), body: route.request().postDataJSON() }); await route.fulfill({ json: { ok: true } }) })
    if (!opts.phone) {
      await ctx.addInitScript(() => {
        window.__repaste = []
        window.bridgeApp = { platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux', desktop: true, dictateStatus: async () => ({ mode: null, paste: { can: true, via: 'bridgekeys', asks: 'accessibility', allowed: true } }), dictateConfigure: async (x) => ({ mode: null }), dictateRepaste: async (o) => { window.__repaste.push(o); return { pasted: true } } }
      })
    }
  } })
  for (const mode of ['light', 'dark']) {
    const { ctx, p, errors } = await view({ mode, store: { 'cc-rail-dictations': true } })
    const row = p.locator('.rail-nav-btn', { hasText: 'Dictations' })
    ok(!!(await until(() => row.isVisible(), 10000, 200)), `${mode}: Dictations in the sidebar, under Meetings`)
    ok(!!(await until(async () => (await p.locator('.rail-dictations .rd-row').count()) >= 3, 8000, 200)), `${mode}: its latest listed under it`, await p.locator('.rail-dictations').innerText().catch(() => ''))
    await row.click()
    const v = p.locator('.dc-view')
    await v.waitFor({ timeout: 10000 })
    ok(!!(await until(async () => (await v.locator('.dc-group h3').first().innerText().catch(() => '')).toLowerCase() === 'today', 5000, 100)), `${mode}: by day, today first`, await v.locator('.dc-group h3').allInnerTexts())
    const slack = v.locator('.dc-row', { hasText: 'See you at three' }).first()
    ok(await slack.locator('img.dc-glyph').count() === 1 && /Pasted into Slack/.test(await slack.locator('.dc-where').innerText()) && await slack.evaluate((el) => el.querySelector('img.dc-glyph').naturalWidth > 0), `${mode}: one pasted into Slack shows Slack's icon`, await slack.innerText())
    const sent = v.locator('.dc-row', { hasText: `Check the invoices ${mode}` }).first()
    ok(await sent.locator('.dc-glyph-icon').count() === 1 && /Sent to/.test(await sent.locator('.dc-where').innerText()), `${mode}: one sent to an agent shows the agent`, await sent.innerText())
    const typed = v.locator('.dc-row', { hasText: 'Ship the fix' }).first()
    ok(/Typed for/.test(await typed.locator('.dc-where').innerText()) && await typed.locator('.dc-glyph-icon').count() === 1, `${mode}: one said into an agent's box shows the agent`, await typed.innerText())
    await shots(p, `dictations-view-${mode}`)
    if (mode === 'dark') { ok(real(errors).length === 0, 'no page errors', errors); await ctx.close(); continue }
    // Search.
    await v.locator('.dc-search').fill('invoices')
    ok(!!(await until(async () => (await v.locator('.dc-row').count()) >= 1 && (await v.locator('.dc-row').allInnerTexts()).every((x) => /invoices/i.test(x)), 5000, 100)), 'search: only what matches', await v.locator('.dc-row').allInnerTexts())
    await v.locator('.dc-search').fill('')
    // One open whole.
    await until(async () => (await v.locator('.dc-row').count()) >= 3, 5000, 100)
    const first = v.locator(`.dc-row[data-id="${a.id}"]`)
    await first.locator('.dc-head').click()
    ok(!!(await until(async () => /Add a retry to the webhook\./.test(await first.locator('.dc-full').innerText().catch(() => '')), 3000, 100)), 'clicked: all of it')
    await first.locator('.dc-heard').click()
    ok(/um add a retry to the the webhook/.test(await first.locator('.dc-full').innerText()), 'and as it was heard, before the cleanup')
    await shots(p, 'dictations-view-open')
    // Send to an agent.
    await first.locator('button', { hasText: 'Send to an agent' }).click()
    await first.locator(`.dc-menu button[data-pane="${one.paneId}"]`).click()
    ok(!!(await until(() => asked.some((x) => x.url.includes(encodeURIComponent(one.paneId)) && x.body.text === 'Add a retry to the webhook.'), 4000, 100)) && /Sent to/.test(await p.locator('.dc-toast').innerText().catch(() => '')), 'Send to an agent: sent, and it says so')
    // Paste again: into the app it was said in.
    const sl = v.locator('.dc-row', { hasText: 'Check the invoices light' }).first()
    await sl.locator('.dc-head').click()
    await sl.locator('button', { hasText: 'Paste again in Slack' }).click()
    ok(!!(await until(() => p.evaluate(() => window.__repaste.at(-1)?.bundle === 'com.tinyspeck.slackmacgap' && window.__repaste.at(-1)?.text === 'Check the invoices light.'), 3000, 100)), 'Paste again: into Slack, where it was said (the desktop app)', await p.evaluate(() => window.__repaste))
    // Delete, and Undo.
    await sl.locator('button', { hasText: 'Delete' }).click()
    ok(!!(await until(async () => (await v.locator('.dc-row', { hasText: 'Check the invoices light' }).count()) === 0 && /Deleted/.test(await p.locator('.dc-toast').innerText().catch(() => '')), 4000, 100)) && !fileText().includes('Check the invoices light'), 'Delete: gone (from the disk too), with Undo')
    await shots(p, 'dictations-view-deleted')
    await p.locator('.dc-toast button', { hasText: 'Undo' }).click()
    ok(!!(await until(async () => (await v.locator('.dc-row', { hasText: 'Check the invoices light' }).count()) === 1, 5000, 100)), 'Undo: back')
    ok(real(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }
  {
    // On a phone: in the Meetings tab, with nothing to paste.
    const { ctx, p, errors } = await view({ phone: true })
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    await p.locator('.tabbar button', { hasText: 'Meetings' }).click()
    await p.locator('.m-seg button', { hasText: 'Dictations' }).click()
    const v = p.locator('.dc-view')
    await v.waitFor({ timeout: 10000 })
    ok(!!(await until(async () => (await v.locator('.dc-row').count()) >= 3, 8000, 100)), 'a phone: Dictations in the Meetings tab')
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
    ok(w[0] <= w[1], 'nothing wider than the phone', w)
    const first = v.locator('.dc-row').first()
    await first.locator('.dc-head').click()
    ok(await first.locator('button', { hasText: 'Copy' }).isVisible() && await first.locator('button', { hasText: 'Send to an agent' }).isVisible() && await first.locator('button', { hasText: /Paste again/ }).count() === 0, 'one open: Copy, Send, Delete, and no Paste again on a phone')
    await shots(p, 'dictations-phone')
    ok(real(errors).length === 0, 'no page errors on the phone', errors)
    await ctx.close()
  }

  // ---------- Settings › Voice: history off, and Delete all ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { before })
    await p.locator('button[aria-label="Settings"]').first().click()
    await p.locator('.st-nav-item', { hasText: 'Voice' }).click()
    const sec = p.locator('.st-dict-history')
    await sec.waitFor({ timeout: 8000 })
    ok(await sec.locator('input[type=checkbox]').first().isChecked() && await sec.locator('input[name="dict-keep"]').nth(2).isChecked() && !(await sec.locator('label', { hasText: 'Keep the recordings too' }).locator('input').isChecked()), 'Settings › Voice: history on, kept always, the recordings not', await sec.innerText())
    await shot(p, `${tag}settings-dictation-history`)
    await sec.locator('label', { hasText: '30 days' }).click()
    ok(!!(await until(async () => (await kit.api('/settings')).effective?.dictation?.keepFor === '30d', 4000, 100)), '30 days, picked and kept')
    await sec.locator('label', { hasText: 'Keep a history' }).click()
    ok(!!(await until(async () => (await kit.api('/settings')).effective?.dictation?.history === false && await sec.locator('input[name="dict-keep"]').count() === 0, 4000, 100)), 'history off: kept, and how long goes', [(await kit.api('/settings')).effective?.dictation, await sec.innerText()])
    await p.locator('button[aria-label="Close settings"]').click()
    // A dictation now: not kept.
    const n = (await list()).total
    const was = fileText()
    await p.locator('.tab-main', { hasText: 'payments' }).first().click({ timeout: 20000 })
    const box = p.locator('textarea[data-composer]').first()
    await box.waitFor({ timeout: 15000 })
    await box.fill('')
    await box.click()
    await p.evaluate(() => window.dispatchEvent(new Event('bridge-settings')))
    await sleep(800)
    said.push('forget this one')
    const mac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
    const MODS = mac ? ['Alt'] : ['Control', 'Alt']
    for (const m of MODS) await p.keyboard.down(m)
    await p.keyboard.down('Space'); await sleep(1300); await p.keyboard.up('Space')
    for (const m of [...MODS].reverse()) await p.keyboard.up(m)
    await until(async () => (await box.inputValue()) === 'Forget this one.', 8000)
    await sleep(800)
    ok((await box.inputValue()) === 'Forget this one.' && (await list()).total === n && fileText() === was, 'history off: the words still land, and nothing is kept', (await list()).items.slice(0, 2))
    await p.keyboard.press('ControlOrMeta+K')
    await p.keyboard.type('Dictations')
    await p.keyboard.press('Enter')
    const off = p.locator('.dc-off')
    ok(!!(await until(() => off.isVisible(), 5000, 100)) && /History is off/.test(await off.innerText()), 'Dictations says history is off (from ⌘K)')
    // Delete all, after asking.
    await p.locator('button[aria-label="Settings"]').first().click()
    await p.locator('.st-nav-item', { hasText: 'Voice' }).click()
    p.once('dialog', (d) => d.accept())
    await p.locator('.st-dict-history button', { hasText: 'Delete all dictations' }).click()
    ok(!!(await until(async () => (await list()).total === 0 && !fs.existsSync(DIR), 5000, 100)), 'Delete all, after asking: every dictation, recording and icon gone')
    ok(real(errors).length === 0, 'no page errors', errors)
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
