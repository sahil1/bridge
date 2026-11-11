// Bridge AI in other languages, in the browser named by BRIDGE_TEST_BROWSER. Every language's pack
// (src/i18n/<code>.json) is valid and keeps each string's {placeholders} (scripts/i18n.js), and
// Settings › Appearance offers every pack, named in its own words. Then each language: the page says which it is, the
// sidebar, Settings' sections and Appearance are in its words, nothing is wider than the window (or
// a phone, for the longest), with no page errors; Match this computer follows the browser's
// language; and picking one in Settings › Appearance switches to it, in another open window too.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, checks, until, browser, page, shot, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('i18n-ui')
const I18N = path.join(ROOT, 'src', 'i18n')
// Every pack in src/i18n is a language the app offers.
const LANGS = fs.readdirSync(I18N).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
const words = Object.fromEntries(LANGS.map((l) => [l, (() => { try { return JSON.parse(fs.readFileSync(path.join(I18N, `${l}.json`), 'utf8')) } catch { return null } })()]))

// ---------- The files ----------
// A pack can be behind (the app is written in English and packs catch up), so how far each has got
// is shown, not checked; what's in it has to be right.
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'i18n.js'), 'check'], { encoding: 'utf8' })
ok(r.status === 0, 'every language file is valid and keeps each string\'s {placeholders}', r.stdout + r.stderr)
console.log(r.stdout.trim())
ok(LANGS.length > 0 && LANGS.every((l) => !!words[l]), 'every pack reads', LANGS)

const kit = await startKit('i18n-ui')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const say = (l, en) => words[l]?.[en] || en
try {
  await kit.api('/setup', { name: 'Tester' })
  for (const l of LANGS) {
    const phone = l === 'de' || l === 'hi'
    const look = l === 'ja' || l === 'hi' ? { mode: 'dark', theme: 'midnight' } : { mode: 'light', theme: 'sky' }
    const { ctx, p, errors } = await page(b, kit.url, { ...look, store: { 'cc-lang': l } })
    // What the page was doing when the sidebar doesn't come: said, not just a timeout.
    const said = []
    const pending = new Set()
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') said.push(`${m.type()}: ${m.text().slice(0, 300)}`) })
    p.on('request', (r) => pending.add(r.url()))
    p.on('requestfinished', (r) => pending.delete(r.url()))
    p.on('requestfailed', (r) => { pending.delete(r.url()); said.push(`failed: ${r.url()} ${r.failure()?.errorText || ''}`) })
    if (!(await p.waitForSelector('.rail-nav-btn', { timeout: 15000 }).then(() => true, () => false))) {
      await shot(p, `${tag}i18n-${l}-stuck`).catch(() => {})
      const seen = await p.evaluate(() => ({ ready: document.readyState, lang: document.documentElement.lang, text: document.body?.innerText.slice(0, 400) })).catch((e) => ({ evaluate: e.message }))
      throw new Error(`${l}: the sidebar didn't come in 15 s ${JSON.stringify({ seen, errors, said: said.slice(-15), pending: [...pending].slice(0, 15) })}`)
    }
    ok((await p.evaluate(() => document.documentElement.lang)) === l, `${l}: the page says it's in ${l}`)
    const nav = (await p.locator('.rail-nav-btn').allInnerTexts()).map((x) => x.trim())
    ok(['New', 'Chief of Staff', 'Meetings'].every((en) => nav.some((x) => x.includes(say(l, en)))), `${l}: the sidebar is in its words`, nav)
    // New: the line under its title too (a browser can't pick a folder, so it says where to start one).
    await p.locator('.rail-nav-btn[data-tour="new-agent"]').click()
    const sub = say(l, 'Start an agent in a folder from More options, or just start a chat below.')
    ok(!!(await until(async () => (await p.locator('.home-sub').innerText()).trim() === sub, 8000)), `${l}: and New`, await p.locator('.home-sub').innerText().catch(() => ''))
    // Asked again until it opens: on a busy machine the first can come before the page listens.
    const opened = await until(async () => {
      if (await p.locator('.st-nav-item').count()) return true
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'appearance' } })))
      return p.waitForSelector('.st-nav-item', { timeout: 2500 }).then(() => true, () => false)
    }, 20000, 0)
    ok(!!opened, `${l}: Settings opens`)
    const secs = (await p.locator('.st-nav-item').allInnerTexts()).map((x) => x.trim())
    ok(['General', 'Devices', 'Appearance'].every((en) => secs.includes(say(l, en))), `${l}: and Settings' sections`, secs)
    ok(!!(await until(async () => (await p.locator('.appearance h4').allInnerTexts()).includes(say(l, 'Language')), 5000)), `${l}: and Appearance, with Language`)
    ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${l}: nothing wider than the window`)
    await shot(p, `${tag}i18n-${l}`)
    // Settings › General with no agent installed: the sentence around Install one, its link in place.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'general' } })))
    const none = say(l, 'No agents installed yet. {install} to get started, or chat with any model through an API key: New chat, then Any model.').replace('{install}', say(l, 'Install one'))
    const warn = p.locator('[data-setting="default-agent"] .st-note.warn')
    const reads = () => warn.evaluate((e) => e.textContent.replace(/\s+/g, ' ').trim())
    ok(!!(await until(async () => (await reads()) === none, 8000)) && (await warn.locator('button').innerText()) === say(l, 'Install one'), `${l}: Settings › General, a sentence with a link in it`, await reads().catch(() => ''))
    // The link sits in the sentence: what follows it goes on from beside it, not on a line of its own.
    const inline = await warn.evaluate((e) => {
      const b = e.querySelector('button'), after = b.nextSibling
      if (!after?.textContent.trim()) return true
      const r = document.createRange(); r.setStart(after, 0); r.setEnd(after, 1)
      const a = r.getClientRects()[0], q = b.getBoundingClientRect()
      return { ok: !!a && Math.abs((a.top + a.bottom) / 2 - (q.top + q.bottom) / 2) < 8 && a.left >= q.right - 1, a: a && [a.left, a.top], q: [q.right, q.top] }
    })
    ok(inline === true || inline.ok, `${l}: and its link in the line`, inline)
    if (phone) {
      const ph = await page(b, kit.url, { ...look, phone: true, store: { 'cc-lang': l } })
      await ph.p.waitForSelector('.tabbar button', { timeout: 15000 })
      const tabs = (await ph.p.locator('.tabbar button').allInnerTexts()).map((x) => x.trim())
      ok(tabs.includes(say(l, 'Meetings')) && (await ph.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${l}: on a phone, its tabs in its words and nothing wider than the phone`, tabs)
      await shot(ph.p, `${tag}i18n-${l}-phone`)
      ok(ph.errors.length === 0, `${l}: phone, no page errors`, ph.errors)
      await ph.ctx.close()
    }
    ok(errors.length === 0, `${l}: no page errors`, errors)
    await ctx.close()
  }

  // Match this computer: the browser's language, here French.
  const fr = await page(b, kit.url, { locale: 'fr-FR', store: { 'cc-lang': 'auto' } })
  await fr.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  ok((await fr.p.evaluate(() => document.documentElement.lang)) === 'fr' && (await fr.p.locator('.rail-nav-btn').allInnerTexts()).some((x) => x.includes(say('fr', 'Meetings'))), 'Match this computer: a French browser gets French')
  await fr.ctx.close()

  // Picked in Settings › Appearance: the app starts again in it. English until then.
  const en = await page(b, kit.url)
  await en.p.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  ok((await en.p.evaluate(() => document.documentElement.lang)) === 'en', 'English until another is picked')
  // Another window of the app open at the time (the floating card, say) follows it.
  const other = await en.ctx.newPage()
  await other.goto(kit.url)
  await other.waitForSelector('.rail-nav-btn', { timeout: 15000 })
  await en.p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'appearance' } })))
  const pick = en.p.locator('select.ap-lang')
  await pick.waitFor({ timeout: 10000 })
  const offered = await pick.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]))
  ok(LANGS.every((l) => offered.some(([v]) => v === l)) && offered.some(([v, n]) => v === 'ja' && n === '日本語') && offered.some(([v, n]) => v === 'zh-CN' && n === '简体中文'), 'Language offers every pack, each in its own words', offered)
  await pick.selectOption('ja')
  ok(!!(await until(async () => (await en.p.evaluate(() => document.documentElement.lang).catch(() => '')) === 'ja' && (await en.p.locator('.rail-nav-btn').allInnerTexts().catch(() => [])).some((x) => x.includes(say('ja', 'Meetings'))), 15000)), 'picking 日本語 in Settings › Appearance switches to it')
  ok(!!(await until(async () => (await other.evaluate(() => document.documentElement.lang).catch(() => '')) === 'ja', 15000)), 'and another window open at the time follows it')
  // WebKit cuts off the presence ping a page sends as it reloads, which isn't the app's error.
  ok(en.errors.filter((e) => !/\/api\/\S+ due to access control checks/.test(e)).length === 0, 'no page errors', en.errors)
  await en.ctx.close()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
