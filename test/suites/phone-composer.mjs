// The message box on a phone, in the browser named by BRIDGE_TEST_BROWSER, 375 px wide in a light
// theme and 430 px in a dark one, with a stand-in Claude Code (stand-ins/claude.cjs) on a model with a
// long name (a Bedrock id) and an account with a long name. In the Chief of Staff's box and an
// agent's, both working: the row under what you write is +, the mic, the model and send, each a whole
// 40 px target on one line inside the box, the model's whole name on it; the line over the box says
// Working, with Stop, and Send now beside it once something's written, the row staying as it was.
// The + menu and the model's menu are lists of whole rows (44 px or more) as wide as the box, the
// long model and account named whole; Saved prompts fits too. An agent that's done working: no line
// over the box, the same row. On each: nothing wider than the phone, past its edge, scrolling
// sideways or cut off, every button a whole 40 px target nothing covers, and the field at 16 px (iOS
// zooms into a smaller one).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, phoneFaults, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('phone-composer')
const MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
const ACCOUNT = 'Payments team work laptop'
const kit = await startKit('phone-composer', { config: { agents: { claude: { model: MODEL } } } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  await kit.api('/setup', { name: 'Tester' })
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')
  const acct = await kit.api('/accounts', { kind: 'claude', label: ACCOUNT })
  await kit.api('/chief/launch', {})
  const dir = path.join(kit.home, 'billing')
  fs.mkdirSync(dir, { recursive: true })
  const busy = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Billing', newSpace: 'Billing', account: acct.id })
  const idle = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Billing idle', newSpace: 'Billing', prompt: 'idle' })
  const fleet = async () => (await kit.api('/fleet')).agents || []
  const ready = await until(async () => {
    const a = await fleet()
    return a.some((x) => x.chief && x.status === 'working') && a.some((x) => x.paneId === busy.paneId && x.status === 'working') && a.some((x) => x.paneId === idle.paneId && x.sessionId && !['working', 'unknown'].includes(x.status))
  }, 60000, 1000)
  ok(!!ready, 'the Chief of Staff and an agent working, another agent done', (await fleet()).map((x) => ({ chief: !!x.chief, title: x.title, status: x.status })))

  for (const [w, look] of [[375, { mode: 'light', theme: 'sky' }], [430, { mode: 'dark', theme: 'midnight' }]]) {
    const { ctx, p, errors } = await page(b, kit.url, { ...look, phone: true })
    await p.setViewportSize({ width: w, height: w === 375 ? 812 : 932 })
    await p.waitForSelector('.tabbar button', { timeout: 20000 })
    const at = `${w}px ${look.mode}`
    // The box as it is: its row's controls, the line over it, the model's name.
    const state = () => p.evaluate(() => {
      const stack = document.querySelector('.composer-stack')
      const box = stack.querySelector('.composer').getBoundingClientRect()
      const r = (e) => { const q = e.getBoundingClientRect(); return { w: Math.round(q.width), h: Math.round(q.height), l: Math.round(q.left), t: Math.round(q.top), mid: Math.round(q.top + q.height / 2) } }
      const kind = (e) => (e.closest('.comp-more') ? '+' : e.matches('.mic-btn') ? 'mic' : e.matches('.model-chip') ? 'model' : e.matches('.send') ? 'send' : e.innerText.trim() || e.getAttribute('aria-label'))
      const row = [...stack.querySelectorAll('.comp-tools button')].filter((e) => e.getClientRects().length && !e.closest('.menu, .acct-pop, .saved-pop')).map((e) => ({ kind: kind(e), ...r(e), inside: r(e).l >= box.left - 1 && r(e).l + r(e).w <= box.right + 1 }))
      const line = stack.querySelector('.comp-busy')
      const name = stack.querySelector('.model-chip .mc-name')
      return {
        row,
        words: stack.querySelector('.comp-tools').innerText.replace(/\s+/g, ' ').trim(),
        line: line && { text: line.querySelector('.comp-busy-text').innerText.replace(/\s+/g, ' ').trim(), bottom: Math.round(line.getBoundingClientRect().bottom), buttons: [...line.querySelectorAll('button')].map((e) => ({ text: e.innerText.trim(), ...r(e) })) },
        boxTop: Math.round(box.top),
        model: name && { text: name.innerText.trim(), whole: name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1 },
        sendOn: !stack.querySelector('.comp-tools .send').disabled,
      }
    })
    const rowIs = (s) => s.row.map((x) => x.kind).join('|') === '+|mic|model|send' && s.row.every((x) => x.w >= 40 && x.h >= 40 && x.inside) && s.row.every((x) => Math.abs(x.mid - s.row[0].mid) <= 2)
    const fits = async (what, scope, file) => {
      await p.waitForTimeout(300)
      const f = await phoneFaults(p, scope)
      ok(!Object.keys(f).length, `${at}, ${what}: fits the phone (nothing wider, past its edge, sideways or cut off; each target 40 px and uncovered; the field 16 px)`, f)
      if (file) await shot(p, `${tag}phone-${file}-${w}-${look.mode}`)
    }
    // A menu as a list of whole rows, as wide as the box, within the screen.
    const rows = (sel, item) => p.evaluate(([sel, item]) => {
      const m = document.querySelector(sel)
      if (!m) return null
      const box = m.closest('.composer').getBoundingClientRect()
      const r = m.getBoundingClientRect()
      return { wide: Math.abs(r.left - box.left) <= 2 && Math.abs(r.right - box.right) <= 2, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0, rows: [...m.querySelectorAll(item)].map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim().slice(0, 40), h: Math.round(e.getBoundingClientRect().height) })) }
    }, [sel, item])

    // The Chief of Staff's box, then an agent's: both working.
    for (const who of ['chief', 'agent']) {
      const name = who === 'chief' ? 'the Chief of Staff' : 'an agent'
      if (who === 'agent') await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), busy.paneId)
      await p.locator('.composer textarea').waitFor({ timeout: 20000 })
      if (who === 'agent') await until(async () => (await p.locator('.composer textarea').getAttribute('placeholder')) === 'Message Billing…', 10000)
      await until(async () => (await p.locator('.model-chip .mc-name').innerText().catch(() => '')) === MODEL, 15000)
      await until(() => p.locator('.comp-busy .stop-btn').isVisible(), 10000)
      const empty = await state()
      ok(rowIs(empty) && !/Working|Stop|Send now/.test(empty.words), `${at}, ${name}'s box: the row under what you write is +, the mic, the model and send, each a whole 40 px target, on one line inside the box`, empty)
      ok(empty.line && /^Working/.test(empty.line.text) && empty.line.buttons.length === 1 && empty.line.buttons[0].text === 'Stop' && empty.line.buttons[0].h >= 40 && empty.line.bottom <= empty.boxTop,
        `${at}, ${name}'s box: the line over it says Working, with Stop, a whole 40 px`, empty.line)
      ok(empty.model?.text === MODEL && empty.model.whole, `${at}, ${name}'s box: the model's long name is on it whole`, empty.model)
      await fits(`${name}'s box, working`, '.composer-stack', `composer-${who}`)
      await p.locator('.composer textarea').fill('Check the retry on the webhook')
      await until(() => p.locator('.comp-busy .now-btn').isVisible(), 4000)
      const typed = await state()
      const same = typed.row.map((x) => `${x.kind}@${x.l},${x.t}`).join('|') === empty.row.map((x) => `${x.kind}@${x.l},${x.t}`).join('|')
      ok(typed.line?.buttons.map((x) => x.text).join('|') === 'Send now|Stop' && typed.line.buttons.every((x) => x.h >= 40) && same && typed.sendOn,
        `${at}, ${name}'s box with something written: Send now beside Stop, over the box, and the row as it was`, { typed, empty })
      await fits(`${name}'s box, with something written`, '.composer-stack', `composer-${who}-typed`)
      await p.locator('.composer textarea').fill('')

      // The + menu: Attach, Saved prompts and the keys, whole rows as wide as the box.
      await p.locator('.comp-more > button').click()
      await p.locator('.comp-more .menu').waitFor({ timeout: 4000 })
      const plus = await rows('.comp-more .menu', '.menu-item')
      ok(plus && plus.wide && plus.inside && plus.rows.length >= 3 && plus.rows.every((x) => x.h >= 44), `${at}, ${name}'s + menu: a list of whole rows (44 px or more), as wide as the box`, plus)
      await fits(`${name}'s + menu`, '.comp-more .menu', `composer-${who}-plus`)
      await p.locator('.comp-more > button').click()
      await until(async () => !(await p.locator('.comp-more .menu').count()), 4000)

      // The model's menu: its models, the account, hand off; whole rows, the long names whole.
      await p.locator('.model-chip').click()
      await p.locator('.model-pop').waitFor({ timeout: 4000 })
      const menu = await rows('.model-pop', '.acct-item')
      const whole = await p.evaluate((names) => names.map((n) => [...document.querySelectorAll('.model-pop .acct-name')].some((e) => e.innerText.includes(n) && e.scrollWidth <= e.clientWidth + 1)), who === 'agent' ? [MODEL, ACCOUNT] : [MODEL])
      ok(menu && menu.wide && menu.inside && menu.rows.length >= 4 && menu.rows.every((x) => x.h >= 44) && whole.every(Boolean),
        `${at}, ${name}'s model menu: a list of whole rows (44 px or more), as wide as the box, ${who === 'agent' ? 'the model and the account' : 'the model'} named whole`, { menu, whole })
      await fits(`${name}'s model menu`, '.model-pop', `composer-${who}-model`)
      await p.keyboard.press('Escape')
      await until(async () => !(await p.locator('.model-pop').count()), 4000)
    }

    // Saved prompts, from the + menu: as wide as the box, its field 16 px.
    await p.locator('.comp-more > button').click()
    await p.locator('.comp-more .menu-item', { hasText: 'Saved prompts' }).click()
    await p.locator('.saved-pop').waitFor({ timeout: 4000 })
    const saved = await rows('.saved-pop', '.saved-foot')
    ok(saved && saved.wide && saved.inside, `${at}: Saved prompts, from the + menu, as wide as the box and within the screen`, saved)
    await fits('Saved prompts', '.saved-pop', 'composer-saved')
    await p.keyboard.press('Escape')

    // An agent that's done: no line over the box, the same row, send once something's written.
    await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), idle.paneId)
    await until(async () => (await p.locator('.composer textarea').getAttribute('placeholder').catch(() => '')) === 'Message Billing idle…', 10000)
    await until(async () => (await p.locator('.model-chip .mc-name').innerText().catch(() => '')) === MODEL, 15000)
    await p.locator('.composer textarea').fill('Run the billing tests again')
    const quiet = await state()
    ok(!quiet.line && rowIs(quiet) && quiet.sendOn, `${at}, an agent that's done: no line over the box, and the same row, send ready`, quiet)
    await fits('an agent that\'s done', '.composer-stack', 'composer-idle')
    ok(errors.length === 0, `${at}: no page errors`, errors)
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
