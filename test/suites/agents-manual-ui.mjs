// Help and Pointers in the app, in the browser named by BRIDGE_TEST_BROWSER.
//   ⌘K › Help opens Bridge AI's manual (Manual.jsx): its topics down the left, the first one open; a
//   search over all of it; a part found opens its topic there; a setting it names opens Settings at
//   that setting. A question typed in ⌘K offers the manual's parts that answer it, and one picked opens
//   Help at it. Settings › Agents & Models › Agents has Tidy Long Sessions While Idle, on, and it
//   saves off. Memory's Pointers (Pointers.jsx): none yet, said; one added (a file, with what you call
//   it), pinned, let bots use, kept from an agent's, and deleted; an agent's says so until it's kept.
//   On 375 and 430 px phones: More › Help opens the manual full screen, its topics as a list, a topic
//   full width under ‹ Help and back; ⌘K's search offers Help; Memory's Pointers card in the Meetings
//   tab, adding one there too. Nothing wider than the phone, cut off or smaller than a 40 px target.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, phoneFaults, noServiceWorker } from '../lib/harness.mjs'

const { ok, done } = checks('agents-manual-ui')
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const kit = await startKit('agents-manual-ui')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const pages = []
const home = (...p) => path.join(kit.home, ...p)
try {
  await kit.api('/setup', { name: 'Tester' })
  fs.mkdirSync(home('Decks'), { recursive: true })
  fs.writeFileSync(home('Decks', 'q3.pptx'), 'deck')
  const { p, errors } = await page(b, kit.url, { width: 1440, height: 900 })
  pages.push({ p })
  await p.locator('.topbar').first().waitFor({ timeout: 20000 })
  const palette = async (words) => { await p.keyboard.press('ControlOrMeta+K'); await p.locator('.palette input').waitFor({ timeout: 5000 }); await p.locator('.palette input').fill(words) }

  await part('Help, from ⌘K', async () => {
    await palette('help')
    await p.locator('.pal-item[data-id="a:help"]').waitFor({ timeout: 5000 })
    await p.locator('.palette input').press('Enter')
    const m = p.locator('.modal.manual')
    await m.locator('.mn-topic').first().waitFor({ timeout: 10000 })
    const topics = await m.locator('.mn-topic').allInnerTexts()
    ok(topics[0] === 'What Bridge AI Is' && topics.includes('Settings') && topics.includes('On your phone') && topics.includes('Meeting notes'), 'Help is the manual: its topics down the left', topics)
    ok(/One app for the AI you already use/.test(await m.locator('.mn-page').innerText()), 'the first one open')
    ok(!/scripts\/manual\.js|Found by:/.test(await m.innerText()), '(nothing that\'s only for making it or searching it)')
    await m.locator('.mn-find input').fill('pair phone')
    await m.locator('.mn-hit').first().waitFor({ timeout: 5000 })
    const hits = await m.locator('.mn-hit b').allInnerTexts()
    ok(hits.some((h) => /On your phone/.test(h)), 'a search over all of it', hits)
    await m.locator('.mn-hit', { hasText: 'On your phone' }).first().click()
    ok(!!(await until(async () => /^On your phone/.test(await m.locator('.mn-page h2').first().innerText().catch(() => '')), 5000)) && (await m.locator('.mn-topic.on').innerText()) === 'On your phone', 'a part found opens its topic there')
    await shot(p, `${tag}manual-desktop`)
    await m.locator('.mn-topic', { hasText: /^Settings$/ }).click()
    await m.locator('.mn-page a[href="#setting-chief-helpers"]').click()
    const s = await until(async () => (await p.locator('.modal.settings [data-setting="chief-helpers"]').count()) > 0, 8000)
    ok(!!s && !(await p.locator('.modal.manual').count()), 'a setting it names opens Settings at that setting', await p.locator('.modal.settings .st-head h3').innerText().catch(() => ''))
    ok(errors.length === 0, 'no page errors', errors)
  })

  await part('the tidy setting', async () => {
    const box = p.locator('.modal.settings [data-setting="tidy-sessions"] input[type=checkbox]')
    await box.waitFor({ timeout: 5000 })
    ok(await box.isChecked() && /Tidy Long Sessions While Idle/.test(await p.locator('.modal.settings [data-setting="tidy-sessions"]').innerText()), 'Settings › Agents & Models › Agents: Tidy Long Sessions While Idle, on')
    await box.click()
    ok(!!(await until(async () => JSON.parse(fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8')).chief?.tidy === false, 5000)), 'and off, saved')
    await box.click()
    await p.locator('button[aria-label="Close settings"]').click()
  })

  await part('a question in ⌘K', async () => {
    await palette('how do I pair my phone')
    const item = p.locator('.pal-item[data-id^="m:"]').first()
    await item.waitFor({ timeout: 8000 })
    const groups = await p.locator('.pal-group').allInnerTexts()
    ok(groups.some((g) => /^manual$/i.test(g.trim())) && /phone/i.test(await item.innerText()), 'the manual\'s parts that answer it, as Manual', { groups, item: await item.innerText() })
    await item.click()
    ok(!!(await until(async () => /phone/i.test(await p.locator('.modal.manual .mn-topic.on').innerText().catch(() => '')), 5000)), 'one picked opens Help at it')
    await p.locator('.modal.manual button[aria-label="Close Help"]').click()
  })

  await part('Pointers in Memory', async () => {
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).first().click()
    await p.locator('.mt-view .pane-head .seg button[data-view="memory"]').click()
    const card = p.locator('.mm-points')
    await card.waitFor({ timeout: 10000 })
    ok(!!(await until(async () => /None yet/.test(await card.innerText()), 8000)), 'Memory\'s Pointers: none yet, said', await card.innerText())
    await card.locator('.mm-pt-add').click()
    const f = card.locator('.mm-pt-edit')
    await f.locator('input').first().fill('the deck from Tuesday')
    await f.locator('select').selectOption('file')
    await f.locator('.mm-pt-ref input').first().fill('~/Decks/q3.pptx')
    await f.locator('button[type=submit]').click()
    const row = card.locator('.mm-pt[data-pointer="the deck from Tuesday"]')
    await row.waitFor({ timeout: 5000 })
    ok(/~\/Decks\/q3\.pptx/.test(await row.innerText()) && /yours/.test(await row.innerText()), 'one added: what you call it, where it is, yours', await row.innerText())
    await row.locator('.mm-pt-pin').click()
    ok(!!(await until(async () => (await row.locator('.mm-pt-pin').getAttribute('aria-pressed')) === 'true', 5000)), 'pinned')
    await row.locator('.mm-pen').click()
    await card.locator('.mm-pt-edit .mm-pt-bots input').check()
    await card.locator('.mm-pt-edit button[type=submit]').click()
    ok(!!(await until(async () => /Bots may use it/.test(await row.innerText().catch(() => '')), 5000)), 'bots may use it, said on it')
    const learned = await kit.api('/pointers/learn', { words: 'the pricing page', to: { kind: 'link', ref: 'https://example.com/pricing' }, by: { kind: 'agent', where: '~/shop' } })
    ok(!!learned.pointer, '(an agent adds one)')
    await p.reload()
    await card.waitFor({ timeout: 10000 })
    const theirs = card.locator('.mm-pt[data-pointer="the pricing page"]')
    await theirs.waitFor({ timeout: 10000 })
    ok(/an agent/.test(await theirs.innerText()) && /not checked/.test(await theirs.innerText()), 'an agent\'s says so, not checked', await theirs.innerText())
    await theirs.locator('.mm-pt-keep').click()
    ok(!!(await until(async () => /yours/.test(await theirs.innerText()) && !/not checked/.test(await theirs.innerText()), 5000)), 'kept: yours')
    await theirs.locator('.mm-pen').click()
    await card.locator('.mm-pt-edit[data-pointer-edit="the pricing page"] button', { hasText: 'Delete' }).click()
    ok(!!(await until(async () => !(await card.locator('.mm-pt-edit, .mm-pt[data-pointer="the pricing page"]').count()) && !(await kit.api('/pointers')).items.some((x) => x.words === 'the pricing page'), 5000)), 'and deleted')
    await shot(p, `${tag}pointers-desktop`)
    ok(errors.length === 0, 'no page errors', errors)
  })

  for (const [w, mode] of [[375, 'light'], [430, 'dark']]) {
    await part(`a ${w} px phone`, async () => {
      const ph = await page(b, kit.url, { mode, phone: true, before: noServiceWorker })
      pages.push(ph)
      await ph.p.setViewportSize({ width: w, height: 844 })
      await ph.p.locator('.tabbar button', { hasText: 'More' }).click()
      await ph.p.locator('.m-more-row[data-id="help"]').click()
      const m = ph.p.locator('.modal.manual.phone')
      await m.locator('.mn-topic').first().waitFor({ timeout: 10000 })
      ok((await m.locator('.st-bar h3').innerText()) === 'Help' && (await m.locator('.mn-topic').count()) > 10, `${w} px: More › Help, the manual full screen, its topics as a list`)
      let faults = await phoneFaults(ph.p, '.modal.manual.phone')
      ok(!Object.keys(faults).length, `${w} px: the list fits, every target whole`, faults)
      await m.locator('.mn-topic', { hasText: 'On your phone' }).click()
      await m.locator('.mn-page h2').first().waitFor({ timeout: 5000 })
      ok(/On your phone/.test(await m.locator('.st-bar h3').innerText()) && (await m.locator('.st-back').count()) === 1, `${w} px: a topic full width, under ‹ Help`)
      faults = await phoneFaults(ph.p, '.modal.manual.phone')
      // (A link in its sentences is part of the words, as WCAG has it; a wide table or code scrolls in its own box.)
      const inProse = (x) => / <a\./.test(x)
      const left = Object.fromEntries(Object.entries(faults).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x) => !(k === 'small' && inProse(x)) && !(k === 'sideways' && /<(table|pre|code)\./.test(x))) : v]).filter(([, v]) => (Array.isArray(v) ? v.length : v)))
      ok(!Object.keys(left).length, `${w} px: it fits, nothing wider than the phone`, left)
      await shot(ph.p, `${tag}manual-phone-${w}-${mode}`)
      await m.locator('.st-back').click()
      ok(!!(await until(async () => (await m.locator('.mn-topic').count()) > 10, 3000)), `${w} px: ‹ Help, back to the list`)
      await m.locator('button[aria-label="Close Help"]').click()
      // Memory's Pointers, in the Meetings tab.
      await ph.p.locator('.tabbar button', { hasText: 'Meetings' }).click()
      await ph.p.locator('.m-meetings .mt-view .pane-head .seg button[data-view="memory"]').click()
      const card = ph.p.locator('.m-meetings .mm-points')
      await card.waitFor({ timeout: 10000 })
      ok(!!(await until(async () => /the deck from Tuesday/.test(await card.innerText()), 8000)), `${w} px: Memory's Pointers, in the Meetings tab`)
      await card.locator('.mm-pt-add').click()
      faults = await phoneFaults(ph.p, '.m-meetings .mm-points')
      ok(!Object.keys(faults).length, `${w} px: the card fits, adding one too, with fields that don't zoom`, faults)
      const f = card.locator('.mm-pt-edit')
      await f.locator('input').first().fill(`the phone note ${w}`)
      await f.locator('select').selectOption('note')
      await f.locator('.mm-pt-ref input').first().fill('the one on the fridge')
      await f.locator('button[type=submit]').click()
      ok(!!(await until(async () => (await card.locator(`.mm-pt[data-pointer="the phone note ${w}"]`).count()) === 1, 5000)), `${w} px: added from the phone`)
      await shot(ph.p, `${tag}pointers-phone-${w}-${mode}`)
      ok(ph.errors.length === 0, `${w} px: no page errors`, ph.errors)
    })
  }
} finally {
  for (const x of pages) await x.p?.context().close().catch(() => {})
  await b.close().catch(() => {})
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
