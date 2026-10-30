// Setup's "Everything" (picked over the recommended Just what agents need), in the browser named by BRIDGE_TEST_BROWSER, on a computer with nothing
// set up: one click sets it all going (Node.js and the speech model downloaded by the server, the
// programs installed in one terminal tab: Homebrew first, then icalBuddy, on a Mac; speech needs
// no program, only its model), the list says how each is doing while setup carries on (a download that can't
// get through says why; closing the terminal tab puts what it was installing back to Not set up;
// Try again once nothing's going), closing setup shows the terminal tab where Homebrew asks for
// your password, and Settings › General keeps the same list. Nothing real runs: the kit's stand-in
// installer runs instead of Homebrew, and Node.js and the model have nowhere to download from, so
// they say they didn't work.
// Then "Just what agents need" (Node.js alone), asked for straight from the server. Then a computer
// with Node.js and the speech model already: neither is offered or downloaded again. On a Mac, Just
// what agents need says there's nothing to install (icalBuddy is still to come); elsewhere that's
// all setup does, so it says everything is set up already and Continue carries on.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSpeechModels, checks, until, browser, page, shot, IS_MAC } from '../lib/harness.mjs'

const { ok, done } = checks('setup-all')
const kit = await startKit('setup-all')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const installs = () => (fs.existsSync(path.join(kit.bin, 'installs.log')) ? fs.readFileSync(path.join(kit.bin, 'installs.log'), 'utf8').trim().split('\n').filter(Boolean) : [])
const states = (plan) => Object.fromEntries(plan.items.map((i) => [i.id, i.state]))

try {
  const before = await kit.api('/setup/plan')
  ok(before.items.every((i) => i.state !== 'done' || i.id === 'mail') && !before.running, 'a new computer: nothing set up yet', states(before))

  const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
  await p.waitForSelector('.wiz-levels', { timeout: 15000 })
  await p.check('input[name="wiz-level"][value="full"]')
  await p.click('.wiz-foot button:has-text("Set up everything")')
  await p.waitForSelector('.sa-list', { timeout: 10000 })
  const names = await p.$$eval('.sa-item b', (l) => l.map((x) => x.innerText))
  const mailHere = before.items.find((i) => i.id === 'mail')?.state === 'done'
  ok(names.join('|') === (IS_MAC ? `Node.js|Homebrew|Meeting notes|Voice notes|Your calendar${mailHere ? '' : '|Mail'}` : 'Node.js|Meeting notes|Voice notes'), 'Set up everything: the list of what it sets up', names)
  if (mailHere) ok((await p.innerText('.sa-kept').catch(() => '')) === 'Already set up, so left as it is: Mail', 'what\'s set up already isn\'t listed, just named', await p.innerText('.sa-kept').catch(() => ''))

  // One terminal tab for the programs, Homebrew first (none here), and its stand-in ran.
  if (IS_MAC) {
    const line = await until(() => installs().find((l) => /brew install/.test(l)), 15000)
    ok(/Homebrew\/install/.test(line || '') && /brew install ical-buddy$/.test(line || ''), 'the programs: one line, Homebrew then icalBuddy (speech needs no program: not whisper.cpp, not ffmpeg)', line)
    ok(/&& HOMEBREW_NO_ASK=1 brew install /.test(line || ''), 'and Homebrew doesn\'t stop to ask "Do you want to proceed?" in a tab nobody watches', line)
    ok(installs().length === 1, 'in one terminal tab', installs())
    const tabs = (await kit.api('/fleet')).tabs || []
    ok(tabs.some((x) => x.label === 'Set up Bridge AI'), 'the tab is called Set up Bridge AI', tabs.map((x) => x.label))
    ok(/Homebrew asks for your password/.test(await p.innerText('.wiz-body')), 'and setup says Homebrew asks for your password there')
  } else ok(installs().length === 0, 'not a Mac: no Homebrew, and nothing installed in a terminal', installs())

  // Downloads go nowhere in a test: they say so, with no real download.
  const plan = await until(async () => { const x = await kit.api('/setup/plan'); return x.items.find((i) => i.id === 'node')?.state === 'failed' && x }, 20000)
  ok(!!plan, 'Node.js with nowhere to download from: it says it didn\'t work', plan && states(plan))
  const voice = await until(async () => (await kit.api('/voice')).error, 15000)
  ok(!!voice, 'the speech model is asked for from the test\'s address, not huggingface.co', voice)
  if (IS_MAC) ok(/Installing…/.test(await p.locator('.sa-item', { hasText: 'Your calendar' }).innerText()), 'the calendar: installing (then Bridge AI asks macOS to see it)', await p.locator('.sa-item', { hasText: 'Your calendar' }).innerText())
  await shot(p, `${tag}setup-all-going`)

  // A download that can't get through says why, in the list too, not "fetch failed".
  ok(/^Can't reach 127\.0\.0\.1:9\./.test(voice || ''), 'a download with no way through says it can\'t reach the address', voice)
  const voiceRow = await until(async () => { const s = await p.locator('.sa-item', { hasText: 'Voice notes' }).innerText(); return /Can't reach/.test(s) && s }, 10000)
  ok(!!voiceRow && !/fetch failed/.test(voiceRow), 'and the list shows that', voiceRow)

  // Closing the terminal tab: what it was installing is Not set up again. With nothing going and
  // some of it not done, Try again.
  if (IS_MAC) {
    const tab = ((await kit.api('/fleet')).tabs || []).find((x) => x.label === 'Set up Bridge AI')
    await kit.api(`/tabs/${tab.tabId}/close`, {})
    const after = await until(async () => { const x = await kit.api('/setup/plan'); return !x.running && x }, 15000)
    ok(!!after && ['homebrew', 'calendar'].every((id) => after.items.find((i) => i.id === id)?.state === 'todo'), 'the terminal tab closed: what it was installing is Not set up again', after && states(after))
  }
  ok(!!(await until(() => p.$('.sa-again button'), 15000)), 'nothing going and some of it not done: Try again')
  await shot(p, `${tag}setup-all-again`)
  if (IS_MAC) {
    await p.click('.sa-again button')
    ok(!!(await until(() => installs().length === 2, 15000)), 'Try again installs the programs again, in a new tab', installs())
  }

  // Carrying on: the next step says it's going on in the background.
  await p.click('.wiz-foot button:has-text("Continue")')
  await p.waitForSelector('.wiz-agents li', { timeout: 15000 })
  ok(/of \d ready/.test(await p.innerText('.wiz-strip').catch(() => '')), 'the next steps say how far it is', await p.innerText('.wiz-strip').catch(() => ''))
  await p.click('.wiz-foot button:has-text("Continue")')
  await p.waitForSelector('.wiz-foot .btn.primary:not([disabled])', { timeout: 15000 })
  await p.click('.wiz-foot .btn.primary')
  ok(!!(await until(async () => !(await p.$('.wiz')), 10000)), 'setup done')
  if (IS_MAC) ok(!!(await until(async () => /Set up Bridge AI/.test(await p.innerText('.ws-tabs').catch(() => '')), 10000)), 'with Homebrew asking for a password, its terminal tab is shown', await p.innerText('.ws-tabs').catch(() => ''))

  // Settings › General: the same list, and Set up everything that's left.
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'general' } })))
  await p.waitForSelector('#st-setup .sa-item', { timeout: 10000 })
  ok(await p.locator('#st-setup .sa-item').count() === names.length, 'Settings › General has the same list')
  ok(/^(Set up everything that's left|Setting up…)$/.test((await p.locator('#st-setup .btn.primary').innerText().catch(() => '')).trim()), 'and one button for what\'s left (Setting up… while it goes)', await p.locator('#st-setup .btn.primary').innerText().catch(() => ''))
  await shot(p, `${tag}setup-all-settings`)
  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()

  // Just what agents need: Node.js alone, nothing installed in a terminal.
  const n = installs().length
  const basic = await kit.api('/setup/run', { level: 'basic' })
  ok(basic.items.find((i) => i.id === 'node') && installs().length === n, 'Just what agents need: Node.js only, nothing else installed', installs().slice(n))

  // ---------- a computer with Node.js and the speech model already ----------
  // Neither is installed again or offered: named once as already set up.
  const models = await startSpeechModels('setup-all')
  const had = await startKit('setup-all-have', { env: models.env() })
  try {
    had.program('npx', '// Node.js\'s npx, already on this computer.\n')
    fs.mkdirSync(path.join(had.data, 'models', 'parakeet-v3'), { recursive: true })
    for (const [n, body] of Object.entries(models.files)) fs.writeFileSync(path.join(had.data, 'models', 'parakeet-v3', n), body)
    const hadInstalls = () => (fs.existsSync(path.join(had.bin, 'installs.log')) ? fs.readFileSync(path.join(had.bin, 'installs.log'), 'utf8').trim().split('\n').filter(Boolean) : [])
    const h = await page(b, had.url, { mode: 'light', theme: 'sky' })
    // Once the plan is in: before it, setup shows its levels, then puts what's here in their place.
    ok(!!(await until(async () => (await h.p.locator('.wiz-body .sa-kept, .wiz-body .sa-all').count()) > 0, 15000)), 'setup looks at what\'s here first')
    if (IS_MAC) {
      // A Mac still has icalBuddy (and Homebrew) to set up, so the levels stay.
      const kept = await h.p.innerText('.wiz-body .sa-kept').catch(() => '')
      ok(/^Already set up, so left as it is: Node\.js, Meeting notes,? (and )?Voice notes\b/.test(kept), 'setup names what\'s here already (the speech model too), and leaves it as it is', kept)
      ok(/Node\.js is already here, so there's nothing to install/.test(await h.p.locator('.wiz-levels li', { hasText: 'Just what agents need' }).innerText()) && await h.p.locator('.wiz-levels li', { hasText: 'Later' }).count() === 0, 'with Node.js here, "Just what agents need" says there\'s nothing to install, and Later isn\'t offered')
      ok(/^Continue$/.test((await h.p.innerText('.wiz-foot .btn.primary')).trim()), 'so its button just carries on')
      await h.p.check('input[name="wiz-level"][value="full"]')
      await h.p.click('.wiz-foot button:has-text("Set up everything")')
      await h.p.waitForSelector('.sa-list', { timeout: 10000 })
      const listed = await h.p.$$eval('.sa-item b', (l) => l.map((x) => x.innerText))
      ok(!listed.includes('Node.js') && !listed.includes('Voice notes') && !listed.includes('Meeting notes'), 'Node.js and speech aren\'t listed', listed)
      const line = await until(() => hadInstalls().find((l) => /brew install/.test(l)), 15000)
      ok(/HOMEBREW_NO_ASK=1 \S*brew install ical-buddy$/.test(line || ''), 'the programs: icalBuddy only, without Homebrew stopping to ask', line)
    } else {
      // Elsewhere that's everything setup does: nothing to pick, and Continue carries on.
      ok(/Everything Bridge AI uses is already set up here\./.test(await h.p.innerText('.wiz-body .sa-all').catch(() => '')) && await h.p.locator('.wiz-levels').count() === 0, 'with Node.js and the speech model here, setup says everything is already set up, with nothing to pick', await h.p.innerText('.wiz-body').catch(() => ''))
      ok(/^Continue$/.test((await h.p.innerText('.wiz-foot .btn.primary')).trim()), 'so its button just carries on', await h.p.innerText('.wiz-foot').catch(() => ''))
      await h.p.click('.wiz-foot .btn.primary')
      ok(!!(await until(() => h.p.$('.wiz-agents li'), 15000)), 'and Continue goes on to the next step')
      ok(hadInstalls().length === 0, 'nothing installed in a terminal', hadInstalls())
    }
    ok(!(await had.api('/tools/node')).job, 'no Node.js is downloaded')
    ok(!models.asked.length, 'nor the speech model', models.asked)
    await shot(h.p, `${tag}setup-all-have`)
    ok(h.errors.length === 0, 'no page errors', h.errors)
    await h.ctx.close()
  } finally { had.stop(); models.stop() }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
