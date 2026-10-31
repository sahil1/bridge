// Setup's "Everything" (picked over the recommended Just what agents need), in the browser named by BRIDGE_TEST_BROWSER, on a computer with nothing
// set up (on a Mac, one without Apple's command line developer tools, simulated): one click sets it
// all going in the background (Node.js and the speech model downloaded by the server, the programs
// installed in one terminal tab: on a Mac, scripts/setup-mac.sh with the developer tools, Homebrew,
// whose installer brings them, then icalBuddy; speech needs no program, only its model), the list
// says how each is doing, and what needs you says so where you are: the Mac's password, typed
// right there in setup, into that tab (a download that can't get through says why; closing the
// terminal tab puts what it was installing back to Not set up; Try again once nothing's going).
// The next steps say how far it is and link back to what needs you; closing setup shows the tab
// when it still waits for the password, and the top bar says "Setting up · n of N" (or that it
// needs you) until it's done, one click from what needs you. Settings › General keeps the same list.
// Nothing real runs: the kit's stand-in installer runs instead of setup-mac.sh (and asks for a
// password as it does), xcode-select is a stand-in, and Node.js and the model have nowhere to
// download from, so they say they didn't work.
// Then "Just what agents need" (Node.js alone), asked for straight from the server: never the
// developer tools, no terminal, nothing waiting for you. Then a computer with Node.js and the
// speech model already: neither is offered or downloaded again. On a Mac (with Homebrew here and
// still no developer tools) the tools install without Homebrew's installer, Just what agents need
// says there's nothing to install, and once all of it is in the top bar's Setting up goes away by
// itself; elsewhere that's all setup does, so it says everything is set up already and Continue
// carries on. Last, a Mac that has the developer tools: they aren't offered.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startSpeechModels, checks, until, browser, page, shot, IS_MAC, devToolsStandIn, installDevTools } from '../lib/harness.mjs'

const { ok, done } = checks('setup-all')
const kit = await startKit('setup-all', { env: ({ bin }) => { if (IS_MAC) devToolsStandIn(bin); return {} } })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const logOf = (k, f) => (fs.existsSync(path.join(k.bin, f)) ? fs.readFileSync(path.join(k.bin, f), 'utf8').trim().split('\n').filter(Boolean) : [])
const installs = () => logOf(kit, 'installs.log')
const passwords = (k = kit) => logOf(k, 'passwords.log').length
const states = (plan) => Object.fromEntries(plan.items.map((i) => [i.id, i.state]))
const ids = (plan) => plan.items.map((i) => i.id)
// The password typed into the Set up Bridge AI tab, as from its own tab.
const typePassword = async (k) => { const plan = await k.api('/setup/plan'); if (plan.paneId) await k.api(`/panes/${encodeURIComponent(plan.paneId)}/text`, { text: 'secret', enter: true }) }
const chip = (p) => p.innerText('.setup-chip', { timeout: 1000 }).catch(() => '')

try {
  const before = await kit.api('/setup/plan')
  ok(before.items.every((i) => i.state !== 'done' || i.id === 'mail') && !before.running, 'a new computer: nothing set up yet', states(before))
  ok(IS_MAC ? ids(before).includes('devtools') : !ids(before).includes('devtools'), IS_MAC ? 'a Mac without Apple\'s developer tools: Everything offers them' : 'not a Mac: no developer tools to offer', ids(before))
  ok(!before.run && !before.needsYou, 'nothing going, nothing waiting for you yet', before)

  const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
  await p.waitForSelector('.wiz-levels', { timeout: 15000 })
  if (IS_MAC) {
    const full = await until(async () => { const x = await p.locator('.wiz-levels li', { hasText: 'Everything' }).innerText(); return /developer tools/.test(x) && x }, 10000)
    ok(/Apple's developer tools/.test(full || '') && /about 1 GB/.test(full || '') && /password once/.test(full || '') && /in the background/.test(full || ''), 'Everything says it brings Apple\'s developer tools and how big they are, asks for the password once, in the background', full)
    const basic = await p.locator('.wiz-levels li', { hasText: 'Just what agents need' }).innerText()
    ok(/No password, nothing to allow/.test(basic) && !/developer tools/.test(basic), 'Just what agents need still asks for nothing, and doesn\'t bring them', basic)
  }
  await p.check('input[name="wiz-level"][value="full"]')
  await p.click('.wiz-foot button:has-text("Set up everything")')
  await p.waitForSelector('.sa-list', { timeout: 10000 })
  const names = await p.$$eval('.sa-item b', (l) => l.map((x) => x.innerText))
  const mailHere = before.items.find((i) => i.id === 'mail')?.state === 'done'
  ok(names.join('|') === (IS_MAC ? `Node.js|Developer tools|Homebrew|Meeting notes|Voice notes|Your calendar${mailHere ? '' : '|Mail'}` : 'Node.js|Meeting notes|Voice notes'), 'Set up everything: the list of what it sets up, Node.js first', names)
  if (mailHere) ok((await p.innerText('.sa-kept').catch(() => '')) === 'Already set up, so left as it is: Mail', 'what\'s set up already isn\'t listed, just named', await p.innerText('.sa-kept').catch(() => ''))
  const started = await kit.api('/setup/plan')
  ok(started.run?.level === 'full' && started.run.ids.join('|') === names.map((n) => ({ 'Node.js': 'node', 'Developer tools': 'devtools', Homebrew: 'homebrew', 'Meeting notes': 'meetings', 'Voice notes': 'voice', 'Your calendar': 'calendar', Mail: 'mail' })[n]).join('|'), 'the run remembers what it set out to do (the top bar counts those)', started.run)

  // One terminal tab for the programs: setup-mac.sh, with the developer tools left to Homebrew's
  // installer, which brings them (setup-mac checks they're never installed twice).
  if (IS_MAC) {
    const line = await until(() => installs().find((l) => /setup-mac\.sh/.test(l)), 15000)
    ok(/^\/bin\/bash '?\S*\/scripts\/setup-mac\.sh'? devtools homebrew ical-buddy$/.test(line || ''), 'the programs: one line, the developer tools, Homebrew, then icalBuddy (speech needs no program: not whisper.cpp, not ffmpeg)', line)
    ok((line?.match(/\bdevtools\b/g) || []).length === 1 && !/softwareupdate|xcode-select/.test(line || ''), 'the developer tools once, by Homebrew\'s installer', line)
    ok(installs().length === 1, 'in one terminal tab', installs())
    const tabs = (await kit.api('/fleet')).tabs || []
    ok(tabs.some((x) => x.label === 'Set up Bridge AI'), 'the tab is called Set up Bridge AI', tabs.map((x) => x.label))

    // It asks for the Mac's password: setup says so where you are, with that tab's terminal in place.
    ok(!!(await until(async () => (await kit.api('/setup/plan')).needsYou === 'password', 15000)), 'the tab asks for the Mac\'s password: setup needs you')
    const term = await until(() => p.$('.sa-you .sa-term .xterm'), 15000)
    const you = await p.innerText('.sa-you').catch(() => '')
    ok(!!term && /Needs you/.test(you) && /Mac's password, once/.test(you), 'setup says it needs your password, with the terminal to type it in right there (not behind setup)', you)
    await shot(p, `${tag}setup-all-needs-you`)
    if (term) {
      await p.click('.sa-you .sa-term .terminal-host')
      await p.keyboard.type('secret')
      await p.keyboard.press('Enter')
    }
    ok(!!(await until(() => passwords() === 1, 10000)), 'typed there, it reaches the tab', passwords())
    ok(!!(await until(async () => !(await kit.api('/setup/plan')).needsYou && !(await p.$('.sa-you')), 10000)), 'and then nothing needs you: it carries on in the background')
  } else ok(installs().length === 0, 'not a Mac: no Homebrew, and nothing installed in a terminal', installs())

  // Downloads go nowhere in a test: they say so, with no real download.
  const plan = await until(async () => { const x = await kit.api('/setup/plan'); return x.items.find((i) => i.id === 'node')?.state === 'failed' && x }, 20000)
  ok(!!plan, 'Node.js with nowhere to download from: it says it didn\'t work', plan && states(plan))
  const voice = await until(async () => (await kit.api('/voice')).error, 15000)
  ok(!!voice, 'the speech model, asked for once Node.js was done, from the test\'s address, not huggingface.co', voice)
  const rowText = (n) => p.locator('.sa-item', { hasText: n }).innerText({ timeout: 3000 }).catch(() => '')
  if (IS_MAC) for (const n of ['Developer tools', 'Your calendar']) ok(/Installing…/.test(await rowText(n)), `${n}: installing`, await rowText(n))
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
    ok(!!after && ['devtools', 'homebrew', 'calendar'].every((id) => after.items.find((i) => i.id === id)?.state === 'todo'), 'the terminal tab closed: what it was installing is Not set up again', after && states(after))
  }
  ok(!!(await until(() => p.$('.sa-again button'), 15000)), 'nothing going and some of it not done: Try again')
  await shot(p, `${tag}setup-all-again`)
  if (IS_MAC) {
    await p.click('.sa-again button')
    ok(!!(await until(() => installs().length === 2, 15000)), 'Try again installs the programs again, in a new tab', installs())
    ok(!!(await until(async () => (await kit.api('/setup/plan')).needsYou === 'password', 15000)), 'which asks for the password again')
  }

  // Carrying on: the next step says it's going on in the background, and links back to what needs you.
  await p.click('.wiz-foot button:has-text("Continue")')
  await p.waitForSelector('.wiz-agents li', { timeout: 15000 })
  ok(/of \d ready/.test(await p.innerText('.wiz-strip').catch(() => '')), 'the next steps say how far it is', await p.innerText('.wiz-strip').catch(() => ''))
  if (IS_MAC) {
    const back = await until(() => p.$('.wiz-strip .wiz-you button'), 10000)
    ok(!!back && /Type your Mac's password/.test(await back.innerText()), 'and that it needs your password, one click from it', await p.innerText('.wiz-strip').catch(() => ''))
    await shot(p, `${tag}setup-all-strip-needs-you`)
    if (back) {
      await back.click()
      ok(!!(await until(() => p.$('.sa-you .sa-term'), 10000)), 'which goes back to where it\'s typed')
      await p.click('.wiz-foot button:has-text("Continue")')
      await p.waitForSelector('.wiz-agents li', { timeout: 15000 })
    }
  }
  await p.click('.wiz-foot button:has-text("Continue")')
  await p.waitForSelector('.wiz-foot .btn.primary:not([disabled])', { timeout: 15000 })
  await p.click('.wiz-foot .btn.primary')
  ok(!!(await until(async () => !(await p.$('.wiz')), 10000)), 'setup done')

  // The top bar: what needs you, one click from it; then how far it is; then what's left, until you've seen it.
  if (IS_MAC) {
    ok(!!(await until(async () => /Set up Bridge AI/.test(await p.innerText('.ws-tabs').catch(() => '')), 10000)), 'still waiting for the password, its terminal tab is shown', await p.innerText('.ws-tabs').catch(() => ''))
    ok(/^Setup needs you · \d of \d$/.test((await until(() => chip(p), 10000)) || ''), 'the top bar says setup needs you, and how far it is', await chip(p))
    await shot(p, `${tag}setup-all-chip-needs-you`)
    await typePassword(kit)
    const going = await until(async () => { const x = await chip(p); return /^Setting up · \d of \d$/.test(x) && x }, 15000)
    ok(!!going, 'the password in: the top bar says it\'s setting up, and how far', await chip(p))
    await shot(p, `${tag}setup-all-chip-going`)
    const tab = ((await kit.api('/fleet')).tabs || []).find((x) => x.label === 'Set up Bridge AI')
    if (tab) await kit.api(`/tabs/${tab.tabId}/close`, {})
  }
  // Nothing going, some of it didn't work (Node.js, the model): it needs you, until you've looked.
  ok(/^Setup needs you · \d of \d$/.test((await until(async () => { const x = await chip(p); return /needs you/.test(x) && !(await kit.api('/setup/plan')).running && x }, 20000)) || ''), 'nothing going and some of it left: the top bar says so', await chip(p))
  const shown = !!(await p.$('.setup-chip'))
  if (shown) await p.click('.setup-chip')
  else await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'general' } })))
  await p.waitForSelector('#st-setup .sa-item', { timeout: 10000 })
  ok(shown && !!(await until(async () => !(await p.$('.setup-chip')), 5000)), 'one click opens Settings › General\'s Set up list, and the top bar\'s goes')

  // Settings › General: the same list, and Set up everything that's left.
  ok(await p.locator('#st-setup .sa-item').count() === names.length, 'Settings › General has the same list')
  ok(/^(Set up everything that's left|Setting up…)$/.test((await p.locator('#st-setup .btn.primary').innerText().catch(() => '')).trim()), 'and one button for what\'s left (Setting up… while it goes)', await p.locator('#st-setup .btn.primary').innerText().catch(() => ''))
  await shot(p, `${tag}setup-all-settings`)
  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()

  // Just what agents need: Node.js alone, nothing installed in a terminal, never the developer tools.
  const n = installs().length
  const basic = await kit.api('/setup/run', { level: 'basic' })
  ok(basic.items.find((i) => i.id === 'node') && installs().length === n, 'Just what agents need: Node.js only, nothing else installed', installs().slice(n))
  ok(basic.run?.ids.join('|') === 'node' && !basic.needsYou && !basic.openId, 'it sets out to do Node.js alone (never the developer tools), with no terminal and nothing waiting for you', basic.run)

  // ---------- a computer with Node.js and the speech model already ----------
  // Neither is installed again or offered: named once as already set up. On a Mac, Homebrew is
  // here and the developer tools aren't: they install without Homebrew's installer, once.
  const models = await startSpeechModels('setup-all')
  const had = await startKit('setup-all-have', { env: (dirs) => { if (IS_MAC) devToolsStandIn(dirs.bin); return models.env()(dirs) } })
  try {
    had.program('npx', '// Node.js\'s npx, already on this computer.\n')
    if (IS_MAC) had.program('brew', '// Homebrew, already on this computer.\n')
    fs.mkdirSync(path.join(had.data, 'models', 'parakeet-v3'), { recursive: true })
    for (const [n, body] of Object.entries(models.files)) fs.writeFileSync(path.join(had.data, 'models', 'parakeet-v3', n), body)
    const hadInstalls = () => logOf(had, 'installs.log')
    const h = await page(b, had.url, { mode: 'light', theme: 'sky' })
    // Once the plan is in: before it, setup shows its levels, then puts what's here in their place.
    ok(!!(await until(async () => (await h.p.locator('.wiz-body .sa-kept, .wiz-body .sa-all').count()) > 0, 15000)), 'setup looks at what\'s here first')
    if (IS_MAC) {
      // A Mac still has the developer tools and icalBuddy to set up, so the levels stay.
      const kept = await h.p.innerText('.wiz-body .sa-kept').catch(() => '')
      ok(/^Already set up, so left as it is: Node\.js, Homebrew, Meeting notes,? (and )?Voice notes\b/.test(kept), 'setup names what\'s here already (Homebrew and the speech model too), and leaves it as it is', kept)
      ok(/Node\.js is already here, so there's nothing to install/.test(await h.p.locator('.wiz-levels li', { hasText: 'Just what agents need' }).innerText()) && await h.p.locator('.wiz-levels li', { hasText: 'Later' }).count() === 0, 'with Node.js here, "Just what agents need" says there\'s nothing to install, and Later isn\'t offered')
      ok(/^Continue$/.test((await h.p.innerText('.wiz-foot .btn.primary')).trim()), 'so its button just carries on')
      await h.p.check('input[name="wiz-level"][value="full"]')
      await h.p.click('.wiz-foot button:has-text("Set up everything")')
      await h.p.waitForSelector('.sa-list', { timeout: 10000 })
      const listed = await h.p.$$eval('.sa-item b', (l) => l.map((x) => x.innerText))
      ok(listed.join('|') === 'Developer tools|Your calendar', 'what\'s left: the developer tools and the calendar (not Node.js, speech or Homebrew)', listed)
      const line = await until(() => hadInstalls().find((l) => /setup-mac\.sh/.test(l)), 15000)
      ok(/setup-mac\.sh'? devtools brew=\S*\/brew ical-buddy$/.test(line || '') && !/\bhomebrew\b/.test(line || ''), 'the programs: the developer tools by setup-mac.sh itself, once (softwareupdate, as Homebrew\'s installer does), then icalBuddy with the Homebrew that\'s here', line)
      ok(!!(await until(async () => (await had.api('/setup/plan')).needsYou === 'password', 15000)), 'the developer tools need the password: setup says so')
      await typePassword(had)
      ok(!!(await until(async () => !(await had.api('/setup/plan')).needsYou, 10000)), 'typed in the tab, it carries on')
      for (const label of ['Continue', 'Continue']) { await h.p.click(`.wiz-foot button:has-text("${label}")`); await h.p.waitForTimeout(300) }
      await h.p.waitForSelector('.wiz-foot .btn.primary:not([disabled])', { timeout: 15000 })
      await h.p.click('.wiz-foot .btn.primary')
      ok(!!(await until(async () => !(await h.p.$('.wiz')), 10000)), 'setup closed while it carries on')
      const was = await until(async () => { const x = await chip(h.p); return /Setting up/.test(x) && x }, 15000)
      ok(/^Setting up · 0 of 2$/.test(was || ''), 'the top bar: Setting up · 0 of 2', await chip(h.p))
      // They arrive: the developer tools, and icalBuddy (which sees the calendar).
      installDevTools(had.bin)
      had.program('icalBuddy', 'console.log(\'• Work\')\n')
      ok(!!(await until(async () => { const x = await had.api('/setup/plan'); return x.items.every((i) => i.state === 'done') && x }, 30000)), 'all of it in: everything is Ready', states(await had.api('/setup/plan')))
      ok(!!was && !!(await until(async () => !(await h.p.$('.setup-chip')), 15000)), 'and the top bar\'s Setting up goes by itself', await chip(h.p))
      ok(!!(await until(async () => !((await had.api('/fleet')).tabs || []).some((x) => x.label === 'Set up Bridge AI'), 20000)), 'as does the terminal tab, once it\'s done')
      await shot(h.p, `${tag}setup-all-have-done`)
    } else {
      // Elsewhere that's everything setup does: nothing to pick, and Continue carries on.
      ok(/Everything Bridge AI uses is already set up here\./.test(await h.p.innerText('.wiz-body .sa-all').catch(() => '')) && await h.p.locator('.wiz-levels').count() === 0, 'with Node.js and the speech model here, setup says everything is already set up, with nothing to pick', await h.p.innerText('.wiz-body').catch(() => ''))
      ok(/^Continue$/.test((await h.p.innerText('.wiz-foot .btn.primary')).trim()), 'so its button just carries on', await h.p.innerText('.wiz-foot').catch(() => ''))
      await h.p.click('.wiz-foot .btn.primary')
      ok(!!(await until(() => h.p.$('.wiz-agents li'), 15000)), 'and Continue goes on to the next step')
      ok(hadInstalls().length === 0, 'nothing installed in a terminal', hadInstalls())
      await shot(h.p, `${tag}setup-all-have`)
    }
    ok(!(await had.api('/tools/node')).job, 'no Node.js is downloaded')
    ok(!models.asked.length, 'nor the speech model', models.asked)
    ok(h.errors.length === 0, 'no page errors', h.errors)
    await h.ctx.close()
  } finally { had.stop(); models.stop() }

  // ---------- a Mac that has the developer tools ----------
  if (IS_MAC) {
    const tools = await startKit('setup-all-tools', { env: ({ bin }) => { devToolsStandIn(bin, { tools: true }); return {} } })
    try {
      const x = await tools.api('/setup/plan')
      ok(!ids(x).includes('devtools'), 'a Mac with Apple\'s developer tools: they aren\'t offered', ids(x))
    } finally { tools.stop() }
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
