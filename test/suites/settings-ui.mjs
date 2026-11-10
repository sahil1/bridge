// Settings in two parts (src/components/settings/Advanced.jsx): each section shows what most people
// change first, and the rest under Advanced at its end. In every section its essentials show, and
// Advanced is there, closed; opened, it stays open for that section (another section's stays
// closed), across Settings closed and opened and a reload, and closed again stays closed. ⌘K finds
// a setting under Advanced (and none while nothing's typed): Settings opens at it, Advanced opened
// to show it near the top, and that opening isn't kept. A link to one (bridge-open-settings) does
// the same. What's on unless turned off and sends what it reads off the computer is never under
// Advanced: Meetings' cleanup, naming who spoke and preparing (with which model writes the notes and
// where it runs said there: none yet, then a key's), Mail's learning again, General's picking up
// unfinished work. Nothing was lost: every setting that was there before Advanced (each control by its
// name) is still in its section, Advanced opened. At phone width (375 px), dark: Meetings with
// Advanced open, nothing wider than the screen or cut off, and Advanced a whole 40 px target.
// Meetings' Names from the call, on a Mac, where Screen Recording shows as on in System Settings and
// doesn't take until Bridge AI restarts: after Open it, Restart Bridge AI (the top bar's Restart to
// apply, in a browser); restarted and still off, Reset and ask again, for Screen Recording alone;
// and on, seen as soon as you come back to the window, not 30 seconds later. Stand-ins for
// native/callwatch (bin/callwatch.json says whether it's allowed) and tccutil (bin/tcc.log).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, checks, until, sleep, browser, page, shot, phoneFaults, advanced, withoutCutOff, noServiceWorker, IS_MAC } from '../lib/harness.mjs'

const { ok, done } = checks('settings-ui')
const stand = (bin, name, source) => {
  fs.writeFileSync(path.join(bin, `${name}.cjs`), source)
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, `${name}.cjs`)}" "$@"\n`, { mode: 0o755 })
  return path.join(bin, name)
}
const kit = await startKit('settings-ui', { env: ({ bin }) => (IS_MAC ? {
  BRIDGE_CALLWATCH: stand(bin, 'callwatch', `const fs = require('node:fs'), path = require('node:path')
const read = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'callwatch.json'), 'utf8')) } catch { return {} } }
const say = (o) => { process.stdout.write(JSON.stringify(o) + '\\n'); process.exit(0) }
if (process.argv[2] === 'screen-ask') { fs.appendFileSync(path.join(__dirname, 'screen-asked'), 'asked\\n'); say({ allowed: !!read().screen }) }
if (process.argv[2] === 'screen') say({ allowed: !!read().screen })
setInterval(() => {}, 1000); process.stdout.write('{"input":[]}\\n')`),
  BRIDGE_TCCUTIL: stand(bin, 'tccutil', `require('node:fs').appendFileSync(require('node:path').join(__dirname, 'tcc.log'), process.argv.slice(2).join(' ') + '\\n')`),
  BRIDGE_FIX_BUNDLE_ID: 'dev.bridge-ai.test',
} : {}) })
const model = await startModel('settings-ui')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''

// What each section shows first (not under Advanced).
const FIRST = {
  General: ['Your name', 'Default agent', 'Pick up unfinished work', 'Layout', 'Location'],
  'Model Providers': ['Your agents', /model labs/i, /run locally/i],
  Voice: ['Speech to text', 'Talk to your agents'],
  Meetings: ['Transcribe with', 'Language', 'Names and terms', 'Notes are written by', 'Write the summary when a meeting ends', 'Clean up the transcript when a meeting ends', 'Name who spoke on the call', ...(IS_MAC ? ['Prepare for each meeting'] : []), 'Record the other side of calls', 'Notice calls', 'Save every meeting as Markdown'],
  Mail: ['How You Write', 'Learn it again now and then', 'Working days', 'Working hours', 'Read-Only'],
  'MCP Servers': ['Add server'],
  Devices: ['Your Devices', 'What to notify about', 'An agent needs you'],
  Appearance: ['Color Mode', 'Theme', 'Text Size', 'Language'],
  'Config File': ['Copy path'],
  'About & Updates': ['Version', 'Check for new versions', 'Report a problem', 'Beta Features'],
}
// Every setting there was before Advanced, by its control's name (kind|name; a name the control's
// own includes), in its section with Advanced opened. Platform's own: Mail only on a Mac, Prepare
// for each meeting only with a calendar (a Mac).
const ALL = {
  General: ['input|Your name', 'button|More agents', 'button|Simple', 'button|Everything', 'button|Use my location', 'input|Search for a city', 'button|Off', 'button|On', 'select|Chief of Staff runs on', 'select|Terminal app', 'button|Built in', 'button|herdr', 'input|Keep agents running when Bridge AI quits', 'input|Pick up unfinished work after an update, a crash or a restart'],
  Agents: ['button|Refresh', 'button|Install', 'button|Copy the command'],
  'Model Providers': ['button|Check sign-ins again', 'input|Show more models (Qwen Code, DeepSeek, Kimi, GLM)', 'button|Anthropic', 'button|OpenAI', 'button|Azure OpenAI', 'button|AWS Bedrock', 'button|OpenRouter', 'button|Groq', 'button|Ollama', 'button|LM Studio', 'button|Deepgram', 'button|AssemblyAI', 'button|Another speech service', 'button|Cursor', 'button|GitHub Copilot', 'button|Jules'],
  Voice: ['button|Download', 'input|Talk to your agents', 'button|Change', 'input|Light cleanup', 'input|Mention files by saying them', 'input|Show the words as you talk', 'input|Keep a history of what you dictate', 'input|30 days', 'input|1 year', 'input|Always', 'input|Keep the recordings too', 'button|Delete all dictations', 'select|Voice', 'select|Speed', 'button|Test'],
  Meetings: ['input|On this computer', 'input|OpenAI', 'input|Groq', 'input|Deepgram', 'input|AssemblyAI', 'input|Another OpenAI-style service', 'button|Speech models', 'select|Meeting language', 'button|Open Memory', 'input|More words to listen for', 'input|Record the other side of calls', 'select|Model for meeting notes', 'input|Write the summary when a meeting ends', 'input|Clean up the transcript when a meeting ends', 'input|Suggest what to ask, in every meeting', 'select|How often AI Assist suggests something', ...(IS_MAC ? ['input|Prepare for each meeting'] : []), 'input|Name who spoke on the call', 'textarea|Your own instructions for every summary', 'input|Tell voices apart in a room', 'input|Tell voices apart on a call', 'input|Learn my voice', 'input|Remember voices you name', 'select|The key that mentions a meeting', 'input|Notice calls', 'input|Stop by itself when the call ends', 'select|What to save', 'input|Folder', 'input|Subfolders', 'input|File name', 'input|Front matter', 'input|Your mic, as', 'input|The call, as', 'input|Keep saved notes up to date', 'input|Save every meeting as Markdown'],
  Mail: ['input|Learn it again now and then', 'button|Mon', 'button|Sun', 'input|From', 'input|To', 'select|Kept clear around meetings', 'select|Around a meeting somewhere else', 'select|How many times to offer'],
  'MCP Servers': ['button|Add server', 'button|Refresh'],
  Devices: ['button|Sign in with Cloudflare', 'button|Use an API token instead', 'button|Check again', 'button|Details', "input|The other device's link", 'button|Link', 'button|Turn on notifications', 'input|An agent needs you (a question, a permission)', 'input|An agent finished', 'select|Usage running low', 'input|Answer buttons for simple questions (yes or no, or two short choices)', "input|Notify my phone even when I'm at the computer"],
  Appearance: ['button|Light', 'button|Dark', 'button|Sync with system', 'button|Midnight', 'button|Custom', 'button|Copy', 'input|Paste a theme', 'button|Use', 'button|Small', 'button|Large', 'button|Comfortable', 'button|Compact', 'button|Geist', 'button|Rounded', 'input|Weather', 'input|Clock', 'input|Usage', 'input|Updates', 'input|Restart to apply', 'input|Setup', 'input|Notification sounds', 'select|Language', 'button|Reset appearance'],
  'Config File': ['button|Copy path', 'textarea|config.json', 'button|Save', 'button|Effective settings', 'button|Defaults'],
  'About & Updates': ['button|Check now', 'input|Check for new versions', 'button|Take the tour', 'a|Report a problem', 'a|Suggest an idea', 'button|Copy details', 'input|Studio', 'input|Home', 'input|Tidy what I say', 'input|Usage Across Every Provider', 'input|Meeting Insights', 'input|Tab Groups', 'input|Scheduled Routines', 'input|Files', 'input|Sign PDFs'],
}

// Every control's name in the panel, every fold opened (as kind|name).
const names = (p) => p.evaluate(() => {
  const root = document.querySelector('.modal.settings .st-scroll')
  root.querySelectorAll('details').forEach((d) => { d.open = true })
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  return [...root.querySelectorAll('input, select, textarea, button, a.btn')].map((el) => {
    const lab = el.closest('label')
    const n = clean(el.getAttribute('aria-label')) || (lab && clean(lab.querySelector('b')?.textContent || lab.textContent)) || clean(el.textContent) || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title'))
    return `${el.tagName.toLowerCase()}|${n}`
  })
})
// What shows first: the panel's words outside Advanced, as they're drawn.
const first = (p) => p.evaluate(() => {
  const root = document.querySelector('.modal.settings .st-scroll')
  const adv = root.querySelector('details.st-adv')
  const was = adv?.open
  if (adv) adv.open = false
  const text = root.innerText
  if (adv) adv.open = was
  return text
})
const settled = async (p) => {
  let last = ''
  let same = 0
  await until(async () => {
    const now = await p.locator('.modal.settings .st-scroll').innerText().catch(() => '')
    same = now && now === last && !(await p.locator('.modal.settings .st-scroll .skeleton-rows').count()) ? same + 1 : 0
    last = now
    return same >= 3
  }, 10000, 250)
}
const adv = (p) => p.locator('.modal.settings details.st-adv')
const isOpen = (p) => adv(p).evaluate((d) => d.open).catch(() => null)
const nav = async (p, name) => { await p.locator('.st-nav-item', { hasText: name }).first().click(); await settled(p) }

try {
  await kit.api('/setup', { name: 'Tester' })

  // ---------- Each section: its essentials first, Advanced closed; and nothing lost ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await p.locator('button[aria-label="Settings"]').first().click()
    await p.waitForSelector('.st-nav-item', { timeout: 8000 })
    const navs = (await p.locator('.st-nav-item').allInnerTexts()).map((x) => x.trim())
    for (const name of navs) {
      await nav(p, name)
      const shown = await first(p)
      const want = (FIRST[name] || []).filter((x) => !(typeof x === 'string' ? shown.includes(x) : x.test(shown)))
      if (FIRST[name]) ok(!want.length, `${name}: what most people change shows first`, { missing: want.map(String), shown: shown.slice(0, 600) })
      const has = await adv(p).count() && await adv(p).isVisible()
      if (name !== 'MCP Servers' && name !== 'Agents') ok(has && (await isOpen(p)) === false, `${name}: the rest under Advanced, at the end, closed`, { has, open: await isOpen(p) })
      if (ALL[name]) {
        const got = await names(p)
        // Spoken Answers' speed and Test are there only where this browser has a voice of its own
        // (none in Chromium on Linux).
        const voiced = await p.evaluate(() => (window.speechSynthesis?.getVoices?.() || []).some((v) => v.localService))
        const lost = ALL[name].filter((x) => voiced || !['select|Speed', 'button|Test'].includes(x)).filter((x) => { const [k, n] = x.split('|'); return !got.some((g) => g.startsWith(`${k}|`) && g.slice(k.length + 1).includes(n)) })
        ok(!lost.length, `${name}: every setting there was is still here`, { lost, got })
      }
      if (['Meetings', 'General', 'About & Updates'].includes(name)) await shot(p, `${tag}settings-ui-${name.replace(/\W+/g, '-').toLowerCase()}`)
    }
    ok(!navs.includes('Mail') || IS_MAC, 'Mail only on a Mac', navs)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- Advanced: closed until opened, then kept for its section ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    const open = async (section) => { await p.evaluate((s) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: s } })), section); await p.locator('.modal.settings .st-sections').first().waitFor({ timeout: 8000 }); await settled(p) }
    await open('meetings')
    ok(await isOpen(p) === false && !(await p.locator('.st-voices, [data-setting="save-notes"]').first().isVisible()), 'Meetings: Advanced closed, what\'s in it out of sight')
    const what = await adv(p).locator('summary').innerText()
    ok(/^Advanced/.test(what) && /AI Assist/.test(what) && /Save notes as Markdown/.test(what), 'and Advanced says what\'s in it', what)
    await advanced(p)
    ok(!!(await until(() => p.locator('[data-setting="save-notes"]').isVisible(), 4000)), 'opened: Save notes as Markdown and the rest show')
    await nav(p, 'General')
    ok(await isOpen(p) === false, 'General\'s Advanced stays closed')
    await nav(p, 'Meetings')
    ok(await isOpen(p) === true, 'back to Meetings: its Advanced still open')
    await p.locator('button[aria-label="Close settings"]').click()
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await open('meetings')
    ok(await isOpen(p) === true, 'and after a reload')
    await adv(p).locator('summary').click()
    ok(!!(await until(async () => (await isOpen(p)) === false, 3000)), 'closed again')
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await open('meetings')
    ok(await isOpen(p) === false, 'and kept closed')

    // ---------- ⌘K finds a setting under Advanced ----------
    await p.locator('button[aria-label="Close settings"]').click()
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').waitFor({ timeout: 5000 })
    await p.waitForTimeout(300)
    ok(await p.locator('.pal-item[data-id^="s:"]').count() === 0, '⌘K with nothing typed: no settings listed')
    await p.locator('.palette input').fill('front matter')
    const hit = p.locator('.pal-item[data-id="s:save-notes"]')
    ok(!!(await until(() => hit.isVisible(), 4000)) && /Settings › Meetings/.test(await hit.innerText()), '⌘K "front matter": Save notes as Markdown, in Settings › Meetings', await p.locator('.pal-list').innerText())
    await hit.click()
    const target = p.locator('.modal.settings [data-setting="save-notes"]')
    ok(!!(await until(async () => /Meetings/.test(await p.locator('.st-nav-item.on').innerText().catch(() => '')) && await target.isVisible(), 8000)) && await isOpen(p) === true, 'Settings opens at Meetings, Advanced opened to show it')
    const near = await until(() => p.evaluate(() => { const e = document.querySelector('.modal.settings [data-setting="save-notes"]'); const s = document.querySelector('.modal.settings .st-scroll'); return Math.abs(e.getBoundingClientRect().top - s.getBoundingClientRect().top) < 60 }), 4000)
    ok(!!near, 'scrolled to it, at the top of the panel')
    await shot(p, `${tag}settings-ui-found`)
    await nav(p, 'General')
    await nav(p, 'Meetings')
    ok(await isOpen(p) === false, 'opened to show it, not kept: Meetings\' Advanced is closed again next time')
    // An essential one too.
    await p.locator('button[aria-label="Close settings"]').click()
    await p.keyboard.press('ControlOrMeta+K')
    await p.locator('.palette input').fill('text size')
    ok(!!(await until(() => p.locator('.pal-item[data-id="s:text-size"]').isVisible(), 4000)), '⌘K "text size": Appearance\'s Text Size')
    await p.keyboard.press('Escape')

    // ---------- A link to one (bridge-open-settings, as Usage's Plan usage would) ----------
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'plan-usage' } })))
    ok(!!(await until(async () => /General/.test(await p.locator('.st-nav-item.on').innerText().catch(() => '')) && await p.locator('.modal.settings [data-setting="plan-usage"]').isVisible(), 8000)), 'a link to Plan usage: General, Advanced opened at it')
    // And, from inside Settings, to one in another section.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers-speech' } })))
    ok(!!(await until(async () => /Model Providers/.test(await p.locator('.st-nav-item.on').innerText().catch(() => '')) && await p.locator('.modal.settings [data-setting="providers-speech"]').isVisible(), 8000)), 'from inside Settings, a link to the speech services\' keys: Model Providers, Advanced opened at them')
    // (WebKit counts a request a reload cuts off as a page error.)
    ok(withoutCutOff(errors).length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- What's on and sends what it reads off the computer: never under Advanced ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    const at = async (section) => { await p.evaluate((s) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: s } })), section); await p.locator('.modal.settings .st-sections').first().waitFor({ timeout: 8000 }); await settled(p) }
    const first = async (id) => (await p.locator(`.modal.settings [data-setting="${id}"]`).isVisible()) && !(await p.locator(`.modal.settings .st-adv [data-setting="${id}"]`).count())
    const where = () => p.locator('.modal.settings [data-notes-where]').innerText().catch(() => '')
    await at('meetings')
    for (const id of ['transcript-cleanup', 'name-speakers', ...(IS_MAC ? ['prep'] : [])]) ok(await first(id), `Meetings: ${id}, on unless turned off and read by the notes' model, first, not under Advanced`)
    ok(/No model to write them yet/.test(await where()), 'with no model: said where notes are written', await where())
    await at('general')
    ok(await first('resume-work') && /carry on, on its own plan or key/.test(await p.locator('[data-setting="resume-work"]').innerText()), 'General: Pick up unfinished work first, saying the agent carries on on its own plan or key')
    if (IS_MAC) {
      await at('mail')
      ok(await first('mail-learn'), 'Mail: Learn it again now and then first, below what says where it goes')
    }
    await p.locator('button[aria-label="Close settings"]').click()
    // A key: Automatic is then that model, and where it runs is said.
    await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
    await at('meetings')
    ok(!!(await until(async () => /, at OpenAI: the transcript, and what each one below reads, go there\./.test(await where()), 10000)), 'with a key: which model writes the notes, and that what it and each one below reads goes to OpenAI', await where())
    // The one the server picks for Automatic (pickMeetingModel), as it says: the page only shows it.
    const chat = await kit.api('/chat/models')
    const auto = chat.models.find((x) => x.id === chat.automatic)
    ok(!!auto && (await where()).startsWith(`${auto.label}, at ${auto.provider}:`), 'Automatic is the model the server says it is', { automatic: chat.automatic, where: await where() })
    if (IS_MAC) {
      const prep = await p.locator('.modal.settings [data-setting="prep"] .muted').innerText()
      ok(/reads the invite and your mail with the people invited, with .+, at OpenAI\./.test(prep), 'Prepare for each meeting: it reads your mail with the people invited, with that model, at OpenAI', prep)
    }
    await p.locator('.modal.settings [data-setting="notes-model"]').scrollIntoViewIfNeeded()
    await shot(p, `${tag}settings-ui-notes-model`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- A setting found keeps its place as the rest of its section comes ----------
  // A busy computer: Set up's list and Permissions (above it) come 3 seconds after it shows. It
  // stays just where it showed, and ticked then, it ticks.
  {
    const held = []
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', before: async (c) => { await noServiceWorker(c); await c.route(/\/api\/(setup\/plan|fix\/list)(\?|$)/, (r) => held.push(r)) } })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'keep-agents' } })))
    const tick = p.locator('.modal.settings [data-setting="keep-agents"] input')
    await tick.waitFor({ timeout: 8000 })
    const y0 = (await tick.boundingBox())?.y
    await until(() => held.length >= 2, 5000)
    await sleep(3000)
    const asked = held.length
    for (const r of held.splice(0)) await r.continue().catch(() => {})
    await settled(p)
    const y1 = (await tick.boundingBox())?.y
    ok(asked >= 2 && y0 != null && Math.abs(y1 - y0) < 1, 'Settings at Keep agents running, with what\'s above it coming seconds later: it stays just where it showed', { asked, y0, y1, grew: await p.locator('.modal.settings .st-scroll').evaluate((e) => e.scrollHeight) })
    await tick.uncheck()
    ok(!!(await until(async () => (await kit.api('/settings')).effective.keepAgents === false, 5000)), 'and ticked then, it\'s the one that changes')
    await kit.api('/settings', { keepAgents: true }, 'PATCH')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  }

  // ---------- Names from the call: Screen Recording on there, and not yet here ----------
  if (IS_MAC) {
    const said = (f) => { try { return fs.readFileSync(path.join(kit.bin, f), 'utf8') } catch { return '' } }
    fs.writeFileSync(path.join(kit.bin, 'callwatch.json'), JSON.stringify({ screen: false }))
    const go = async (p) => {
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
      await p.locator('.modal.settings .st-sections').first().waitFor({ timeout: 8000 })
      await settled(p)
      await advanced(p)
      return p.locator('.modal.settings .st-screen-names')
    }
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    let row = await go(p)
    const text = () => row.innerText().catch(() => '')
    ok(!!(await until(async () => /Screen Recording puts the names/.test(await text()), 8000)) && await row.locator('button', { hasText: 'Allow' }).count() === 1, 'Screen Recording off: why, and Allow', await text())
    await row.locator('button', { hasText: 'Allow' }).click()
    ok(!!(await until(async () => /Turn on Bridge AI under System Settings .* in Screen Recording/.test(await text()), 5000)) && /asked/.test(said('screen-asked')), 'Allow asks macOS, then says where to turn it on, with Open it', await text())
    await row.locator('button', { hasText: 'Open it' }).click()
    ok(!!(await until(async () => /Already on there\? macOS applies it once Bridge AI restarts\./.test(await text()), 5000)) && await row.locator('button', { hasText: 'Restart Bridge AI' }).count() === 1, 'once it\'s open there: already on there? macOS applies it once Bridge AI restarts, with Restart Bridge AI', await text())
    await row.scrollIntoViewIfNeeded().catch(() => {})
    await shot(p, `${tag}settings-ui-screen-restart`)
    await row.locator('button', { hasText: 'Restart Bridge AI' }).click()
    ok(!!(await until(async () => (await kit.api('/fix')).restart.some((x) => x.pane === 'audio') && await p.locator('.update-pop', { hasText: 'Restart to apply' }).isVisible(), 5000)), 'in a browser, Restart Bridge AI opens the top bar\'s Restart to apply, for Screen & System Audio Recording', (await kit.api('/fix')).restart)
    await p.keyboard.press('Escape')
    // Bridge AI restarted (the server too), and Screen Recording is still off: Reset, for it alone.
    const was = (await kit.api('/calls/screen')).started
    await kit.restart()
    await p.reload()
    await p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
    row = await go(p)
    const now = (await kit.api('/calls/screen')).started
    ok(now > was, 'the server says when it started, so the page can tell it restarted', { was, now })
    ok(!!(await until(async () => /Still off since Bridge AI restarted/.test(await text()), 8000)) && await row.locator('button', { hasText: 'Reset and ask again' }).count() === 1, 'still off after the restart: why, and Reset and ask again', await text())
    await row.scrollIntoViewIfNeeded().catch(() => {})
    await shot(p, `${tag}settings-ui-screen-reset`)
    const asks = said('screen-asked').split('\n').filter(Boolean).length
    await row.locator('button', { hasText: 'Reset and ask again' }).click()
    ok(!!(await until(async () => /macOS asks again/.test(await text()), 5000)) && said('tcc.log').trim() === 'reset ScreenCapture dev.bridge-ai.test' && said('screen-asked').split('\n').filter(Boolean).length === asks + 1, 'Reset forgets macOS\'s answer for Screen Recording only (not the call\'s sound) and asks again', { text: await text(), tcc: said('tcc.log') })
    // Turned on, and back to the window: seen at once, not from what the server kept.
    fs.writeFileSync(path.join(kit.bin, 'callwatch.json'), JSON.stringify({ screen: true }))
    await p.evaluate(() => window.dispatchEvent(new Event('focus')))
    ok(!!(await until(async () => /Screen Recording is on/.test(await text()), 3000)), 'turned on and back to the window: it says it\'s on straight away', await text())
    ok(withoutCutOff(errors).length === 0, 'Screen Recording: no page errors', errors)
    await ctx.close()
  }

  // ---------- A phone, dark ----------
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', phone: true })
    await p.setViewportSize({ width: 375, height: 812 })
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'meetings' } })))
    await p.locator('.modal.settings.phone .st-back').waitFor({ timeout: 8000 })
    await settled(p)
    await advanced(p)
    await settled(p)
    const faults = await phoneFaults(p, '.modal.settings .st-scroll')
    const box = await adv(p).locator('summary').boundingBox()
    ok(!faults.wider && !faults.past && !faults.sideways && !faults.cut, 'phone: Meetings with Advanced open, nothing wider than the screen, past its edge or cut off', faults)
    ok(box && box.height >= 40 && box.width >= 40, 'and Advanced a whole 40 px target', box)
    await shot(p, `${tag}settings-ui-phone-dark`)
    ok(errors.length === 0, 'phone: no page errors', errors)
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
