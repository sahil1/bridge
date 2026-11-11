// Recommended Settings, a beta feature (src/recommended.js, src/components/Recommended.jsx), with a
// stand-in Claude Code (stand-ins/claude.cjs) that notes how each agent was started
// (~/claude-started.log) and answers its sign-in check on the plan the test gives it
// (stand-in-plan.json). Off: no route, nothing passed at launch whatever the settings say, and
// nothing in the app. On: what's recommended for each plan (Pro, Max, Max 5x and 20x, Team,
// Enterprise, an API key; none through a cloud provider, none signed out), Use these and Keep, asked
// again when the plan changes, what's passed when an agent starts (--model, --effort), and Claude
// Code's own settings never written. A task's effort, suggested from sample asks. In the app, in
// the browser named by BRIDGE_TEST_BROWSER: setup's Connect your AI and Settings › Agents say the
// recommendation and Use these applies it; what it starts with is changed there; Home's box and New
// have an effort chip suggested from what's typed, changed from its menu, which is what the agent
// starts with; the agent's model menu says it. Light, dark and a phone.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, browser, page, shot, solid, TEST } from '../lib/harness.mjs'
import { suggestEffort, filesIn } from '../../src/recommended.js'

const { ok, done } = checks('recommended-settings')
const kit = await startKit('recommended-settings', { env: { CLAUDE_STAND_IN: 'fresh' } })
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const claudeDir = path.join(kit.home, '.claude')
fs.mkdirSync(claudeDir, { recursive: true })
// Signed in as Settings › Agents' own check sees it (server/providers.js): a login file there.
fs.writeFileSync(path.join(claudeDir, '.credentials.json'), '{}')
const plan = (p) => { fs.rmSync(path.join(claudeDir, 'stand-in-signed-out'), { force: true }); fs.writeFileSync(path.join(claudeDir, 'stand-in-plan.json'), JSON.stringify(p)) }
const signOut = () => fs.writeFileSync(path.join(claudeDir, 'stand-in-signed-out'), '')
const ownSettings = () => fs.readdirSync(claudeDir).filter((f) => /settings/i.test(f))
// A chip's words as they read (its parts are laid out side by side).
const words = (l) => l.evaluate((e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '')
const dir = path.join(kit.home, 'billing')
fs.mkdirSync(dir, { recursive: true })
const started = () => { try { return fs.readFileSync(path.join(kit.home, 'claude-started.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const flag = (args, f) => { const i = (args || []).indexOf(f); return i >= 0 ? args[i + 1] : null }
let n = 0
// An agent started from the API; the arguments the stand-in Claude Code got.
const launch = async (body) => {
  const before = started().length
  const label = `Billing ${++n}`
  await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: label, ...body })
  return until(() => started()[before], 30000, 250)
}
const userConfig = () => JSON.parse(fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8'))

const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
try {
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed && a.effort), 'the stand-in Claude Code is found, and takes an effort')

  // ---------- Off (the default) ----------
  const off = await kit.api('/recommended').then(() => null, (e) => e)
  ok(off?.status === 404 && /Recommended Settings is a beta feature\. Turn it on in Settings › About & Updates › Beta Features/.test(off.message), 'off: its route says it is a beta feature and where to turn it on', off?.message)
  await kit.api('/settings', { agents: { claude: { effort: 'xhigh' } } }, 'PATCH')
  const offArgs = await launch({ prompt: 'Refactor billing.py, invoices.py, ledger.py, tax.py, api.js, ui.jsx to share one money type', effort: 'max' })
  ok(!!offArgs && !offArgs.includes('--effort') && !offArgs.includes('--model'), 'off: an agent starts with no --effort, whatever the chip, the brief or the setting says', offArgs)
  const offChief = await launch({ prompt: 'Refactor the billing module across all the files that call it', effort: 'suggest' })
  ok(!!offChief && !offChief.includes('--effort'), "off: nor one Chief of Staff starts", offChief)
  ok(JSON.stringify((await kit.api('/config')).efforts) === '{}', 'off: the app is told no effort')

  // ---------- On ----------
  await kit.api('/settings', { trials: { 'recommended-settings': true }, agents: { claude: {} } }, 'PATCH')
  const recFor = async () => (await kit.api('/recommended?fresh=1')).agents.find((a) => a.kind === 'claude')
  // What each plan gets, as the sign-in check says it.
  const PLANS = [
    [{}, 'Max', 'max', 'opus', 'high'],
    [{ subscriptionType: 'pro' }, 'Pro', 'pro', 'sonnet', 'high'],
    [{ subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' }, 'Max 5x', 'max5', 'opus', 'high'],
    [{ subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' }, 'Max 20x', 'max20', 'opus', 'xhigh'],
    [{ subscriptionType: 'team' }, 'Team', 'team', 'opus', 'high'],
    [{ subscriptionType: 'enterprise' }, 'Enterprise', 'enterprise', 'opus', 'high'],
    [{ authMethod: 'api_key', subscriptionType: null }, 'an API key', 'api', 'sonnet', 'medium'],
  ]
  for (const [said, name, key, model, effort] of PLANS) {
    plan(said)
    const r = await recFor()
    ok(r?.signedIn === true && r.plan === key && r.rec?.model === model && r.rec?.effort === effort && r.rec?.why && !r.answered, `${name}: ${model} at ${effort} effort, with why`, r)
  }
  plan({ apiProvider: 'bedrock', subscriptionType: null })
  const cloud = await recFor()
  ok(cloud?.plan === 'cloud' && cloud.rec?.none === true && !cloud.rec.model, 'through a cloud provider (Bedrock): nothing recommended, as its models differ', cloud)
  const cloudUse = await kit.api('/recommended/claude', { choice: 'use' }).then(() => null, (e) => e)
  ok(/No recommendation for this Claude Code sign-in, so nothing changed/.test(cloudUse?.message || ''), "Use these there says why it can't", cloudUse?.message)
  signOut()
  const out = await recFor()
  ok(out?.signedIn === false && out.rec === null, 'signed out: no recommendation until it is signed in', out)
  const outUse = await kit.api('/recommended/claude', { choice: 'use' }).then(() => null, (e) => e)
  ok(/Sign in to Claude Code first/.test(outUse?.message || ''), 'and Use these says to sign in first', outUse?.message)

  // Use these, on Max: Bridge AI's settings, passed at launch; Claude Code's own left alone.
  plan({})
  const used = await kit.api('/recommended/claude', { choice: 'use' })
  ok(used.answered === 'use' && used.model === 'opus' && used.effort === 'high', 'Use these: it starts with Opus at high effort', used)
  const saved = userConfig().agents?.claude || {}
  ok(saved.model === 'opus' && saved.effort === 'high' && saved.recommended?.plan === 'max' && saved.recommended?.choice === 'use', "kept in Bridge AI's own settings, with the plan it was for", saved)
  const useArgs = await launch({ prompt: 'Add a dark mode toggle' })
  ok(flag(useArgs, '--model') === 'opus' && flag(useArgs, '--effort') === 'high', 'an agent then starts with --model opus --effort high', useArgs)
  ok(ownSettings().length === 0, "Claude Code's own settings files aren't written", ownSettings())
  ok((await kit.api('/config')).efforts?.claude === 'high', 'the app is told the effort it starts with')
  // A task's effort: the chip's pick, Usual, Chief of Staff's from the brief.
  ok(flag(await launch({ prompt: 'Add a dark mode toggle', effort: 'low' }), '--effort') === 'low', "the chip's pick (low) is what it starts with")
  ok(flag(await launch({ prompt: 'Refactor the billing module across all the files that call it', effort: 'default' }), '--effort') === 'high', 'Usual: the setting (high)')
  ok(flag(await launch({ prompt: 'Refactor billing.py, invoices.py, ledger.py, tax.py, api.js, ui.jsx to share one money type', effort: 'suggest' }), '--effort') === 'xhigh', "Chief of Staff's hand-off: from the brief (a refactor across six files: extra high)")
  ok(flag(await launch({ prompt: 'Add a dark mode toggle', effort: 'suggest' }), '--effort') === 'high', 'a brief that says nothing: the setting')
  ok(flag(await launch({ prompt: 'x', effort: 'nonsense' }), '--effort') === 'high', 'an effort Claude Code has no such level of is not passed: the setting instead')
  const chief = path.join(TEST, '..', 'chief', 'bin', 'bridge')
  ok(/--effort low\|medium\|high\|xhigh\|max/.test(fs.readFileSync(chief, 'utf8')), "Chief of Staff's bridge new takes --effort")

  // Asked again when the plan changes; Keep keeps what's set.
  plan({ subscriptionType: 'pro' })
  const pro = await recFor()
  ok(!pro.answered && pro.rec?.model === 'sonnet' && pro.model === 'opus', 'on another plan (Pro), it is asked again, with what it starts with now', pro)
  const kept = await kit.api('/recommended/claude', { choice: 'keep' })
  ok(kept.answered === 'keep' && kept.model === 'opus' && kept.effort === 'high', 'Keep: answered, and what it starts with is unchanged', kept)
  await kit.api('/settings', { agents: { claude: {} } }, 'PATCH')
  plan({ authMethod: 'api_key', subscriptionType: null })
  await kit.api('/recommended/claude', { choice: 'keep' })
  const plainArgs = await launch({ prompt: 'Add a dark mode toggle' })
  ok(!plainArgs.includes('--model') && !plainArgs.includes('--effort'), "Keep Claude Code's defaults: it starts with neither", plainArgs)

  // ---------- A task's effort, from what's asked ----------
  const ASKS = [
    ['Refactor the billing module across all the files that call it', 'high', 'a refactor across many files'],
    ['refactor the auth code', 'high', 'a refactor'],
    ['Refactor billing.py, invoices.py, ledger.py, tax.py, api.js, ui.jsx to share one money type', 'xhigh', 'a refactor across many files'],
    ['Why does the checkout test fail on CI sometimes?', 'high', 'tracking down a bug'],
    ['Implement OAuth login end to end', 'high', 'building something new'],
    ['How do I run the tests?', 'medium', 'a quick question'],
    ['Can you explain what the queue in server/queue.js does?', 'medium', 'a quick question'],
    ['fix the typo in README.md', 'low', 'a small, simple change'],
    ['rename foo to bar in utils.js', 'low', 'a small, simple change'],
    ['Add a dark mode toggle', null],
    ['/review', null],
    ['', null],
  ]
  for (const [ask, level, why] of ASKS) {
    const s = suggestEffort(ask)
    ok(level ? s?.effort === level && s.why === why : s === null, level ? `"${ask}": ${level}, ${why}` : `"${ask}": nothing suggested, the agent's usual`, s)
  }
  ok(filesIn('see https://example.com/a/b/c, and/or src/app/ and billing.py') === 2, 'files named: a path and a file, not a web address or and/or')

  // ---------- In the app ----------
  await kit.api('/settings', { agents: { claude: {} } }, 'PATCH')
  plan({})
  ok((await recFor())?.plan === 'max', 'back on Max')
  // Setup's Connect your AI: Claude Code is ready, and what suits its plan is under it.
  await kit.api('/subscriptions?refresh=1')
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.locator('.wiz').waitFor({ timeout: 15000 })
    if (await p.locator('input[name="wiz-level"][value="later"]').count()) await p.locator('input[name="wiz-level"][value="later"]').check()
    await p.locator('.wiz-foot .btn.primary').click()
    const card = p.locator('.wiz-agents li', { hasText: 'Claude Code' }).locator('.rec-card[data-rec="claude"]')
    ok(!!(await card.waitFor({ timeout: 15000 }).then(() => true, () => false)), "setup's Connect your AI: the recommendation for Claude Code's plan")
    const said = await card.innerText().catch(() => '')
    ok(/Recommended for your Max plan: Opus, high effort/.test(said) && /Use these/.test(said) && /Keep Claude Code's defaults/.test(said), 'it says the plan, the model and effort, and both choices', said)
    await shot(p, `${tag}recommended-setup-light`)
    // Left open: closing it would start Chief of Staff (another Claude Code), set up below instead.
    ok(errors.length === 0, 'setup: no page errors', errors)
    await ctx.close()
  }
  await kit.api('/setup', { name: 'Tester' })
  // Settings › Agents, as a link to it opens it (asked again until the app is up to hear it).
  const openAgents = async (p) => {
    const row = p.locator('.modal.settings [data-setting="agent-claude"]')
    await until(async () => {
      await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'agents' } })))
      return row.waitFor({ timeout: 2000 }).then(() => true, () => false)
    }, 20000, 200)
    await row.waitFor({ timeout: 5000 })
  }
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.mode
    await kit.api('/settings', { agents: { claude: {} } }, 'PATCH')
    const { ctx, p, errors } = await page(b, kit.url, look)
    await openAgents(p)
    const row = p.locator('.modal.settings [data-setting="agent-claude"]')
    const card = row.locator('.rec-card')
    ok(!!(await card.waitFor({ timeout: 15000 }).then(() => true, () => false)), `${t}: Settings › Agents: the recommendation under Claude Code`)
    ok(/Recommended for your Max plan: Opus, high effort/.test(await card.innerText()) && /Starts with\s+Claude Code's defaults/.test(await row.locator('.rec-starts').innerText()), `${t}: with what it starts with now: Claude Code's defaults`, await row.innerText())
    await shot(p, `${tag}recommended-agents-${t}`)
    await card.locator('button', { hasText: 'Use these' }).click()
    ok(!!(await until(async () => (await card.count()) === 0 && /Starts with\s+Opus · High effort\s+\(recommended for your Max plan\)/.test(await row.locator('.rec-starts').innerText().catch(() => '')), 10000)), `${t}: Use these: the card goes, and it starts with Opus at high effort, recommended for the plan`, await row.innerText().catch(() => ''))
    ok(userConfig().agents?.claude?.effort === 'high', `${t}: saved`)
    await row.locator('select[aria-label="Claude Code effort"]').selectOption('xhigh')
    ok(!!(await until(async () => /Opus · Extra high effort\s+\(as you set it\)/.test(await row.locator('.rec-starts').innerText()) && userConfig().agents?.claude?.effort === 'xhigh', 10000)), `${t}: the effort changed there is saved and said`, await row.locator('.rec-starts').innerText())
    await shot(p, `${tag}recommended-agents-used-${t}`)
    ok(errors.length === 0, `${t}: Settings › Agents: no page errors`, errors)
    await ctx.close()
  }
  // A phone: the card fits, its buttons whole.
  {
    await kit.api('/settings', { agents: { claude: {} } }, 'PATCH')
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'dark', theme: 'midnight', phone: true })
    await openAgents(p)
    const card = p.locator('.modal.settings [data-setting="agent-claude"] .rec-card')
    await card.waitFor({ timeout: 15000 }).catch(() => {})
    await card.scrollIntoViewIfNeeded().catch(() => {})
    const fits = await p.evaluate(() => {
      const c = document.querySelector('.rec-card')
      if (!c) return 'no card'
      const r = c.getBoundingClientRect()
      const btns = [...c.querySelectorAll('button')].map((x) => x.getBoundingClientRect())
      return r.right <= window.innerWidth + 0.5 && r.left >= -0.5 && btns.every((x) => x.right <= r.right + 0.5 && x.height >= 28) ? true : { card: [r.left, r.right], btns: btns.map((x) => [x.left, x.right, x.height]), w: window.innerWidth }
    })
    ok(fits === true, 'phone: the recommendation fits, its buttons whole', fits)
    await shot(p, `${tag}recommended-agents-phone`)
    ok(errors.length === 0, 'phone: no page errors', errors)
    await ctx.close()
  }

  // Home's box and New: an effort chip, suggested from what's typed and changed from its menu.
  await kit.api('/settings', { agents: { claude: { effort: 'high' } } }, 'PATCH')
  await kit.api('/projects', { path: dir })
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.mode
    const { ctx, p, errors } = await page(b, kit.url, look)
    await p.locator('[data-tour="new-agent"]:visible, button[aria-label="Start something new"]:visible').first().click()
    await p.locator('.home-box textarea').waitFor({ timeout: 10000 })
    const chip = p.locator('.home-box .eff-chip')
    ok(!!(await chip.waitFor({ timeout: 10000 }).then(() => true, () => false)) && /Usual effort/.test(await words(chip)), `${t}: Home's box: an effort chip, usual until something's typed`, await chip.innerText().catch(() => ''))
    await p.fill('.home-box textarea', 'Refactor the billing module across all the files that call it')
    ok(!!(await until(async () => /High effort: a refactor across many files/.test(await words(chip)), 5000)), `${t}: a refactor across many files: High`, await words(chip))
    await chip.click()
    const menu = p.locator('.home-box .eff-pop')
    await menu.waitFor({ timeout: 5000 })
    ok(await solid(p, '.eff-pop'), `${t}: its menu is solid`)
    const items = await menu.locator('[role="menuitemradio"]').allInnerTexts()
    ok(items.length === 6 && /^Usual/.test(items[0]) && /High\s*Suggested/.test(items[3]) && await menu.locator('[aria-checked="true"]').innerText().then((x) => /^High/.test(x)), `${t}: Usual and the five levels, the suggested one ticked`, items)
    await shot(p, `${tag}recommended-home-${t}`)
    await menu.locator('[role="menuitemradio"]', { hasText: 'Low' }).click()
    ok(/Low effort: you picked it/.test(await words(chip)), `${t}: picked: Low, and it says you picked it`, await words(chip))
    const before = started().length
    await p.locator('.home-box textarea').press('Enter')
    const got = await until(() => started()[before], 30000, 250)
    ok(flag(got, '--effort') === 'low', `${t}: the agent starts with --effort low`, got)
    ok(errors.length === 0, `${t}: Home: no page errors`, errors)
    await ctx.close()
  }
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await p.locator('[data-tour="new-agent"]:visible, button[aria-label="Start something new"]:visible').first().click()
    await p.locator('.home-more').click()
    await p.locator('.new-agent').waitFor({ timeout: 8000 })
    await p.locator('.na-mode button', { hasText: 'In a project folder' }).click()
    await p.locator('.new-agent .na-dir input').fill(dir)
    await p.locator('.new-agent textarea').fill('Why does the checkout test fail on CI sometimes?')
    const chip = p.locator('.new-agent .eff-chip')
    ok(!!(await until(async () => /High effort: tracking down a bug/.test(await words(chip)), 8000)), 'New: the chip under the first message: High, tracking down a bug', await words(chip))
    await chip.click()
    await p.locator('.new-agent .eff-pop [role="menuitemradio"]', { hasText: 'Extra high' }).click()
    await shot(p, `${tag}recommended-new-light`)
    const before = started().length
    await p.locator('.new-agent button[type=submit]').click()
    const got = await until(() => started()[before], 30000, 250)
    ok(flag(got, '--effort') === 'xhigh', 'New: the agent starts with the effort picked (extra high)', got)
    // Its model menu says the effort it started with.
    const mc = p.locator('.model-chip').first()
    if (await mc.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
      await mc.click()
      const said = await until(async () => { const x = await p.locator('.model-pop').innerText().catch(() => ''); return /Extra high effort, set when it started/.test(x) && x }, 8000)
      ok(!!said && /\/effort in its Terminal tab/.test(said), "the agent's model menu says the effort it started with, and how to change it", said || await p.locator('.model-pop').innerText().catch(() => ''))
      await p.keyboard.press('Escape')
    } else ok(false, 'the new agent opens with its model chip')
    ok(errors.length === 0, 'New: no page errors', errors)
    await ctx.close()
  }
  // A phone: Home's chip fits.
  {
    // On the Agents tab, where New is.
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', phone: true, store: { 'cc-mtab': 'agents' } })
    await p.locator('button[aria-label="Start something new"]:visible').first().click({ timeout: 15000 }).catch(() => {})
    const box = p.locator('.home-box textarea')
    if (await box.waitFor({ timeout: 10000 }).then(() => true, () => false)) {
      await box.fill('Refactor the billing module across all the files that call it')
      const fits = await until(() => p.evaluate(() => { const c = document.querySelector('.home-box .eff-chip'); if (!c) return false; const r = c.getBoundingClientRect(); return r.right <= window.innerWidth + 0.5 && /High effort/.test(c.textContent) }), 5000)
      ok(!!fits, 'phone: Home\'s effort chip fits')
      await shot(p, `${tag}recommended-home-phone`)
    } else ok(false, 'phone: Home opens')
    ok(errors.length === 0, 'phone Home: no page errors', errors)
    await ctx.close()
  }

  // Off again: none of it in the app.
  await kit.api('/settings', { trials: { 'recommended-settings': false } }, 'PATCH')
  {
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky' })
    await openAgents(p)
    await p.waitForTimeout(800)
    ok(await p.locator('.rec-card, .rec-starts').count() === 0, 'off: Settings › Agents has no recommendation and no Starts with')
    await p.locator('button[aria-label="Close settings"]').click()
    await p.locator('[data-tour="new-agent"]:visible, button[aria-label="Start something new"]:visible').first().click()
    await p.locator('.home-box textarea').waitFor({ timeout: 10000 })
    await p.fill('.home-box textarea', 'Refactor the billing module across all the files that call it')
    await p.waitForTimeout(400)
    ok(await p.locator('.eff-chip').count() === 0, "off: Home's box has no effort chip")
    ok(errors.length === 0, 'off: no page errors', errors)
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
