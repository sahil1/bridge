// Setup's "Everything", in the browser named by BRIDGE_TEST_BROWSER, on a computer with nothing
// set up: one click sets it all going (Node.js and the speech model downloaded by the server, the
// programs installed in one terminal tab: Homebrew first, then whisper.cpp, ffmpeg and icalBuddy in
// one go, on a Mac), the list says how each is doing while setup carries on (a download that can't
// get through says why; closing the terminal tab puts what it was installing back to Not set up;
// Try again once nothing's going), closing setup shows the terminal tab where Homebrew asks for
// your password, and Settings › General keeps the same list. Nothing real runs: the kit's stand-in
// installer runs instead of Homebrew, and Node.js and the model have nowhere to download from, so
// they say they didn't work.
// Then "Just what agents need" (Node.js alone), asked for straight from the server. Then a computer
// with Node.js and ffmpeg already: neither is offered or installed again.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, IS_MAC } from '../lib/harness.mjs'

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
  await p.click('.wiz-foot button:has-text("Set up everything")')
  await p.waitForSelector('.sa-list', { timeout: 10000 })
  const names = await p.$$eval('.sa-item b', (l) => l.map((x) => x.innerText))
  const mailHere = before.items.find((i) => i.id === 'mail')?.state === 'done'
  ok(names.join('|') === (IS_MAC ? `Node.js|Homebrew|Meeting notes|Voice notes|Your calendar${mailHere ? '' : '|Mail'}` : 'Node.js|Meeting notes|Voice notes'), 'Set up everything: the list of what it sets up', names)
  if (mailHere) ok((await p.innerText('.sa-kept').catch(() => '')) === 'Already set up, so left as it is: Mail', 'what\'s set up already isn\'t listed, just named', await p.innerText('.sa-kept').catch(() => ''))

  // One terminal tab for the programs, Homebrew first (none here), and its stand-in ran.
  if (IS_MAC) {
    const line = await until(() => installs().find((l) => /brew install/.test(l)), 15000)
    ok(/Homebrew\/install/.test(line || '') && /brew install whisper-cpp ffmpeg ical-buddy$/.test(line || ''), 'the programs: one line, Homebrew then whisper.cpp, ffmpeg and icalBuddy together', line)
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

  // ---------- a computer with Node.js and ffmpeg already ----------
  // Neither is installed again or offered: named once as already set up, and Voice notes adds only
  // what it doesn't have.
  const had = await startKit('setup-all-have')
  try {
    had.program('npx', '// Node.js\'s npx, already on this computer.\n')
    had.program('ffmpeg', '// ffmpeg, already on this computer.\n')
    const hadInstalls = () => (fs.existsSync(path.join(had.bin, 'installs.log')) ? fs.readFileSync(path.join(had.bin, 'installs.log'), 'utf8').trim().split('\n').filter(Boolean) : [])
    const h = await page(b, had.url, { mode: 'light', theme: 'sky' })
    await h.p.waitForSelector('.wiz-levels', { timeout: 15000 })
    const kept = await h.p.innerText('.wiz-body .sa-kept').catch(() => '')
    ok(/^Already set up, so left as it is: Node\.js/.test(kept), 'setup names what\'s here already, and leaves it as it is', kept)
    ok(await h.p.locator('.wiz-levels li', { hasText: 'Just what agents need' }).count() === 0, 'with Node.js here, "Just what agents need" (Node.js) isn\'t offered')
    await h.p.click('.wiz-foot button:has-text("Set up everything")')
    await h.p.waitForSelector('.sa-list', { timeout: 10000 })
    const listed = await h.p.$$eval('.sa-item b', (l) => l.map((x) => x.innerText))
    ok(!listed.includes('Node.js'), 'Node.js isn\'t listed', listed)
    const voiceAdds = await h.p.locator('.sa-item', { hasText: 'Voice notes' }).innerText()
    ok(/Adds only whisper\.cpp and the speech model\. The rest is already here\./.test(voiceAdds), 'Voice notes adds only what\'s missing (not ffmpeg)', voiceAdds)
    ok(!(await had.api('/tools/node')).job, 'and no Node.js is downloaded')
    if (IS_MAC) {
      const line = await until(() => hadInstalls().find((l) => /brew install/.test(l)), 15000)
      ok(/HOMEBREW_NO_ASK=1 \S*brew install whisper-cpp ical-buddy$/.test(line || ''), 'the programs: whisper.cpp and icalBuddy, not ffmpeg, without Homebrew stopping to ask', line)
    }
    await shot(h.p, `${tag}setup-all-have`)
    ok(h.errors.length === 0, 'no page errors', h.errors)
    await h.ctx.close()
  } finally { had.stop() }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
