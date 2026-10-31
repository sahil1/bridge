// Accounts and their usage, in the browser named by BRIDGE_TEST_BROWSER, in a light and a dark
// theme. Four Claude Code accounts as one Mac had them: your usual login, switched to the same
// account as Personal (Claude Code's /login does that to your usual login), Personal (the default),
// Work Secondary, whose saved sign-in ran out while a stand-in Claude Code still works on it, and
// Work Primary. Their readings are made up here (plan usage reads real accounts), laid over the
// server's own list, so what the app changes shows. Checks: the top bar says its account is where
// new agents start; its menu lists your usual login under that name, gives both windows and when
// the week resets, puts the star on the default, says Work Secondary is in use, and offers to take
// the extra one of the same account off the list; Usage details (the Today panel's Usage card) has
// the same, with no pace mark at the end of a window, Sign in on the row, and the mark labelled
// where it shows; and the Usage tab has the list too.
// Then the model: Make default puts the star on an account and a new agent starts there; Auto shows
// its pick with no star; the same-account offer takes your usual login off every list and new
// agents don't fall back to it; Settings shows it again; Sign out runs the agent's own logout for
// that account's folder (asking first for your usual login); Remove signs an added account out and
// deletes its folder; and the last account stays.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, browser, page, shot, solid, noServiceWorker, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('accounts-ui')
const kit = await startKit('accounts-ui')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const at = (h) => new Date(Date.now() + h * 3600e3).toISOString()
// Claude's accounts open in a Usage list: by its head saying so, not by rows being there yet (on a
// slow machine they weren't, and a click then closed it).
const openGroup = async (where) => {
  const head = where.locator('.prov-head').first()
  await head.waitFor({ timeout: 10000 })
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await where.locator('.acct-u-head').first().waitFor({ timeout: 5000 }).catch(() => {})
}
// What the stand-in Claude Code was asked to sign out: the config folder each time (null: your usual one).
const logouts = () => { try { return fs.readFileSync(path.join(kit.home, 'claude-auth.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.args[1] === 'logout').map((x) => x.dir) } catch { return [] } }
const fleetAgent = async (pred) => ((await kit.api('/fleet')).agents || []).find(pred)
const claudeOf = async () => (await kit.api('/accounts')).find((g) => g.kind === 'claude')
const dir = path.join(kit.home, 'lam')
fs.mkdirSync(dir, { recursive: true })
let n = 0
// A new agent with no account picked: the account it starts on.
const launchOn = async (body = {}) => {
  const l = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: `New ${++n}`, newSpace: 'New agents', prompt: 'idle', ...body })
  return (await until(() => fleetAgent((a) => a.paneId === l.paneId && a.accountId), 30000, 500))?.accountId || null
}

try {
  await kit.api('/setup', { name: 'Tester' })
  // Look for agents again, as the app does after an install: the server looked before the stand-in was there.
  await kit.api('/agents/catalog')
  const personal = await kit.api('/accounts', { kind: 'claude', label: 'Personal' })
  const second = await kit.api('/accounts', { kind: 'claude', label: 'Work Secondary' })
  const primary = await kit.api('/accounts', { kind: 'claude', label: 'Work Primary' })
  await kit.api(`/accounts/active/claude`, { id: personal.id })
  const w = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'LAM pages', newSpace: 'LAM', prompt: 'idle', account: second.id })
  ok(!!(await until(async () => ((await kit.api('/fleet')).agents || []).find((a) => a.paneId === w.paneId && a.accountId === second.id), 30000, 1000)), '(an agent works on Work Secondary)')
  const first = await claudeOf()
  ok(first.accounts.map((a) => a.label).join('|') === 'Your usual login|Personal|Work Secondary|Work Primary' && first.accounts[0].named === false, 'one plain list: your usual login first, as "Your usual login" until it has a name, then the others in the order added', first.accounts.map((a) => a.label))

  // The readings: your usual login and Personal one account, five hours nearly over (its even-pace
  // mark at the far end), the week further on; Work Secondary's saved sign-in run out. Laid over
  // the server's own list (its names, default and Auto), so a change made in the app shows.
  const me = { email: 'someone@example.com', organization: "someone@example.com's Organization" }
  // Your usual login, unnamed, goes by who it's signed in as, its email mostly hidden.
  const USUAL = 'so•••@example.com'
  const windows = [
    { id: 'session', kind: 'session', label: 'Session', percentRemaining: 66, resetsAt: at(0.2), pace: { elapsedPercent: 99 } },
    { id: 'weekly', kind: 'weekly', label: 'Weekly', percentRemaining: 24, resetsAt: at(96), pace: { elapsedPercent: 43 } },
  ]
  const ok1 = { signedIn: true, plan: 'max', usable: true, status: 'ok', error: null, percentRemaining: 24, windows, account: me }
  const readingOf = (a) => (a.id === second.id ? { signedIn: true, plan: null, usable: false, status: 'error', error: 'Claude access token expired', percentRemaining: null, windows: [], account: { email: 'work@example.com', organization: 'Example Inc' } }
    : a.id === primary.id ? { ...ok1, plan: 'team', percentRemaining: 80, windows: windows.map((x) => ({ ...x, percentRemaining: x.kind === 'session' ? 91 : 80 })), account: { email: 'lead@example.com', organization: 'Example Inc' } }
      : ok1)
  const quota = async () => {
    const live = await kit.api('/quota')
    return {
      generatedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), bestNow: 'claude', stale: false,
      providers: [{ provider: 'claude', usable: true, status: 'ok', plan: 'max', percentRemaining: 24, windows, account: me }],
      accounts: live.accounts.filter((g) => g.kind === 'claude').map((g) => ({ ...g, accounts: g.accounts.map((a) => ({ ...a, ...readingOf(a) })) })),
    }
  }
  const fake = async (c) => { await noServiceWorker(c); await c.route(/\/api\/quota(\?|$)/, async (r) => r.fulfill({ json: await quota() })) }

  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = look.theme
    const { ctx, p, errors } = await page(b, kit.url, { ...look, before: fake })
    const chip = p.locator('.usage-chip').first()
    await chip.waitFor({ timeout: 15000 })
    const chipText = (await chip.innerText()).replace(/\s+/g, ' ')
    ok(/New:\s*Personal/.test(chipText), `${t}: the top bar says Personal is where new agents start`, chipText)

    // Its menu.
    await chip.click()
    const menu = p.locator('.acct-pop.top')
    await menu.waitFor({ timeout: 5000 })
    ok(await solid(p, '.acct-pop.top'), `${t}: the menu is solid`)
    const row = (name) => menu.locator('.acct-item', { has: p.locator('.acct-name', { hasText: new RegExp(`^${name}`) }) }).first()
    const usual = (await row(USUAL).innerText()).replace(/\s+/g, ' ')
    ok(/Your usual login/.test(usual), `${t}: your usual login goes by who it's signed in as, its email mostly hidden, and says it's your usual login`, usual)
    ok(/66%\s*5h/.test(usual) && /24%\s*wk/.test(usual), `${t}: each account shows both its 5-hour and its weekly window`, usual)
    ok(/Week resets/.test(usual), `${t}: and when its week resets`, usual)
    ok(!(await menu.locator('.acct-name', { hasText: /^Default/ }).count()), `${t}: no account is called Default`, await menu.innerText())
    ok(await row('Personal').locator('.acct-check.is-default').count() === 1 && await menu.locator('.acct-check.is-default').count() === 1, `${t}: the star is on Personal, the default, and only there`)
    // What an account needs from you is on its own row: Work Secondary's sign-in ran out (an agent
    // on it keeps working), so Sign in is there, the why in its tooltip, not a paragraph an account.
    const rowOf = (name) => menu.locator('.acct-row', { has: p.locator('.acct-item .acct-name', { hasText: new RegExp(`^${name}`) }) }).first()
    const signIn = rowOf('Work Secondary').locator('.acct-act', { hasText: /^Sign in$/ })
    ok(await signIn.isVisible() && /^In use: sign in to see its usage$/.test((await row('Work Secondary').locator('.acct-desc').innerText()).trim()), `${t}: Sign in is right on Work Secondary's row (its saved sign-in ran out), and a few words under its name say why, for a phone too`, await rowOf('Work Secondary').innerText())
    ok(/An agent is using it, so it still works/.test(await signIn.getAttribute('title')) && !/An agent is using it|Sign in to .* again|It signs in again/.test(await menu.innerText()), `${t}: why is in its tooltip, not a paragraph in the menu`, await menu.innerText())
    const sb = await signIn.boundingBox(), nb = await row('Work Secondary').locator('.acct-name').boundingBox()
    ok(sb && nb && Math.abs((sb.y + sb.height / 2) - (nb.y + nb.height / 2)) < 12, `${t}: on the same line as its name`, { sb, nb })
    // Set as default, said on each row that isn't the default (and needs nothing first): the star
    // moves there, and back. Meanwhile Work Primary has a long name: cut short, its plan whole.
    const setOn = (name) => rowOf(name).locator('button.acct-set')
    ok(await setOn('Work Primary').isVisible() && !(await setOn('Personal').count()) && !(await setOn('Work Secondary').count()), `${t}: Set as default is on the rows that aren't the default`)
    const claudeSetting = async () => (await claudeOf()).setting
    await kit.api(`/accounts/${primary.id}`, { label: 'Work Primary for the whole of the Example team' }, 'PATCH')
    await setOn('Work Primary').click()
    ok(!!(await until(async () => (await claudeSetting()) === primary.id, 6000)), `${t}: Set as default makes it the default`, await claudeSetting())
    await menu.waitFor({ state: 'hidden', timeout: 5000 }) // the menu closes once it's done
    await chip.click()
    await menu.waitFor({ timeout: 5000 })
    ok(!!(await until(async () => (await row('Work Primary').locator('.acct-check.is-default').count()) === 1, 6000)), `${t}: and the star is there`)
    const long = row('Work Primary')
    await until(async () => /whole/.test(await long.innerText().catch(() => '')), 8000)
    const fit = await long.evaluate((el) => { const nm = el.querySelector('.acct-nm'), tag = el.querySelector('.plan-tag'), r = el.getBoundingClientRect(), tr = tag?.getBoundingClientRect(); return { cut: nm.scrollWidth > nm.clientWidth, tag: !!tag && tr.width > 20 && tr.right <= r.right && tag.scrollWidth <= tag.clientWidth + 1 } })
    ok(fit.cut && fit.tag, `${t}: a long name is cut short with …, and its plan stays whole`, fit)
    await shot(p, `${tag}accounts-menu-set-${t}`)
    await kit.api(`/accounts/${primary.id}`, { label: 'Work Primary' }, 'PATCH')
    await setOn('Personal').click()
    await until(async () => (await claudeSetting()) === personal.id, 6000)
    await menu.waitFor({ state: 'hidden', timeout: 5000 })
    await chip.click()
    await menu.waitFor({ timeout: 5000 })
    await until(async () => !/whole/.test(await menu.innerText().catch(() => 'whole')), 8000)
    const same = rowOf(USUAL).locator('.acct-same')
    const sameText = (await same.innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(await same.isVisible() && /Same account as Personal/.test(sameText) && /Remove your usual login from the list/.test(await same.locator('button').getAttribute('title')) && sameText.length < 50, `${t}: under your usual login, one short line says it's the same account as Personal, with Remove`, sameText)
    ok((await menu.locator('.acct-same').count()) === 1, `${t}: only under that one row`)
    const words = (await menu.innerText()).replace(/\s+/g, ' ')
    ok(/Most left now: (so•••@example\.com|Personal|Work)/.test(words) && !/New agents start on the account with the most left|As many .* accounts as you like/.test(words), `${t}: Auto says who has the most left in a few words, and Add another account has no paragraph`, words)
    await shot(p, `${tag}accounts-menu-${t}`)
    await p.keyboard.press('Escape')

    // Usage details: the Today panel's Usage card.
    await chip.click()
    await menu.locator('.acct-item', { hasText: 'Usage details' }).click()
    const plan = p.locator('.usage-card')
    ok(!!(await until(() => plan.isVisible(), 10000)), `${t}: Usage details opens the Usage card`)
    await openGroup(plan)
    const heads = plan.locator('.acct-u-head')
    await heads.first().waitFor({ timeout: 5000 })
    ok((await heads.count()) === 4, `${t}: one row an account`, await heads.count())
    ok((await plan.locator('.acct-u-head .u-pace').count()) === 0, `${t}: no pace mark on a row (it sat at 0 under a bar that wasn't)`)
    const top = (await heads.first().innerText()).replace(/\s+/g, ' ')
    ok(top.startsWith(USUAL) && /66%\s*5h/.test(top) && /24%\s*wk/.test(top) && /Week resets/.test(top), `${t}: the first row is your usual login, with both windows and when the week resets`, top)
    const uRow = (name) => plan.locator('.acct-u', { has: p.locator('.acct-u-head b', { hasText: new RegExp(`^${name}$`) }) }).first()
    ok(await uRow('Personal').locator('.def-tag').count() === 1 && await plan.locator('.def-tag').count() === 1 && !/\bactive\b/.test(await plan.innerText()), `${t}: the star badge on Personal, the default, and no "active" tag`)
    const pick = plan.locator('.top-pick')
    ok(/In top bar/.test(await pick.innerText()) && !/Default/.test(await pick.innerText()), `${t}: the button for which agent the top bar shows says so, not Default`, await pick.innerText())
    ok(await uRow('Work Secondary').locator('.acct-u-signin button').isVisible(), `${t}: Sign in again is on Work Secondary's row, without opening it`)
    // The why comes with the account's state, which can land a poll after the button does.
    const why = () => uRow('Work Secondary').locator('.acct-u-signin button').getAttribute('title')
    ok(!(await uRow('Work Secondary').locator('.acct-u-signin p').count()) && !!(await until(async () => /An agent is using it/.test(await why()), 5000)), `${t}: with why in its tooltip, not a paragraph`, await why())
    const note = plan.locator('.acct-same-note')
    ok(await note.isVisible() && /Personal and your usual login are the same account/.test(await note.innerText()) && await note.locator('button', { hasText: 'Remove your usual login from the list' }).isVisible(), `${t}: and the note that they're one account, with Remove your usual login from the list`, await note.innerText().catch(() => ''))
    await heads.first().click()
    const rows = plan.locator('.acct-u.open .w-row')
    await rows.first().waitFor({ timeout: 5000 })
    // Its arrow points down once it's open, and stays so (a row redrawn every few seconds once
    // started the turn over each time, so it showed half turned or not at all).
    const angle = () => plan.locator('.acct-u.open .acct-u-head .caret').evaluate((x) => { const m = new DOMMatrix(getComputedStyle(x).transform); return Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI) })
    // (After its first turn: on a busy machine that can still be under way a quarter second in.)
    await until(async () => (await angle()) === 90, 3000)
    const angles = []
    for (let i = 0; i < 8; i++) { await sleep(250); angles.push(await angle()) }
    ok(angles.every((x) => x === 90), `${t}: the open row's arrow points down, and stays so`, angles)
    const sess = rows.filter({ hasText: 'Session' }), week = rows.filter({ hasText: 'Weekly' })
    ok((await sess.locator('.u-pace').count()) === 0 && (await week.locator('.u-pace').count()) === 1 && /even use: 57%/.test(await week.innerText()), `${t}: opened, the pace mark shows only mid-window, and says what it is`, await week.innerText())
    const acts = await plan.locator('.acct-u.open .acct-acts').innerText().catch(() => '')
    ok(/Make default/.test(acts) && /Sign in again/.test(acts) && /Sign out/.test(acts) && /Remove/.test(acts), `${t}: and Make default, Sign in again, Sign out and Remove`, acts)
    await shot(p, `${tag}accounts-usage-${t}`)
    // The Usage tab (stats, patterns, history) has the same list now, first.
    await plan.locator('button', { hasText: 'Stats, patterns and history' }).click()
    const tab = p.locator('.us-plan')
    ok(!!(await until(() => tab.isVisible(), 10000)), `${t}: the Usage tab starts with each account's plan usage`)
    await openGroup(tab)
    ok(!!(await until(async () => (await tab.locator('.acct-u-head').count()) === 4, 5000)), `${t}: the same four accounts there`, await tab.locator('.acct-u-head').count())
    await shot(p, `${tag}accounts-usage-tab-${t}`)
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // On a phone: usage isn't in the top bar (it keeps to what needs you now), it's Today's Usage
  // card, with the rows and Sign in on Work Secondary's; and the agent's message box says the
  // account it's on.
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }]) {
    const t = `phone ${look.theme}`
    const { ctx, p, errors } = await page(b, kit.url, { ...look, phone: true, before: fake })
    const W = 390
    await p.waitForSelector('.tabbar button', { timeout: 15000 })
    await p.waitForTimeout(1500)
    ok(await p.locator('.topbar .usage-chip').count() === 0, `${t}: usage isn't in the top bar`)
    await p.locator('.tabbar button', { hasText: 'Today' }).click()
    const card = p.locator('.usage-card').first()
    ok(!!(await until(() => card.isVisible(), 10000)), `${t}: Today has the Usage card`)
    await card.scrollIntoViewIfNeeded()
    await openGroup(card)
    ok(!!(await until(async () => (await card.locator('.acct-u-head').count()) === 4, 5000)) && await card.locator('.acct-u', { hasText: 'Work Secondary' }).locator('.acct-u-signin button').isVisible(), `${t}: its rows, with Sign in again on Work Secondary's`)
    // Personal opened: what you can do with it fits too.
    await card.locator('.acct-u-head', { hasText: 'Personal' }).click()
    await card.locator('.acct-u.open .acct-acts').waitFor({ timeout: 5000 })
    ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${t}: nothing wider than the phone`)
    await card.locator('.acct-same-note').scrollIntoViewIfNeeded()
    await shot(p, `${tag}accounts-usage-${look.theme}-phone`)
    await p.evaluate((paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } })), w.paneId)
    const acct = p.locator('.model-chip .mc-acct').first()
    ok(!!(await until(async () => (await acct.innerText().catch(() => '')).trim() === 'Work Secondary', 15000)), `${t}: the agent's message box says it's on Work Secondary`, await acct.innerText().catch(() => ''))
    const ab = await p.locator('.model-chip').first().boundingBox()
    ok(ab && ab.x + ab.width <= W + 1, `${t}: and fits`, ab)
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- The model: one list, Make default, Auto, Remove, Show again, Sign out ----------
  {
    const t = 'model'
    const { ctx, p, errors } = await page(b, kit.url, { mode: 'light', theme: 'sky', before: fake })
    const asked = []
    let answer = true
    p.on('dialog', (d) => { asked.push(d.message()); return answer ? d.accept() : d.dismiss() })
    const chip = p.locator('.usage-chip').first()
    await chip.waitFor({ timeout: 15000 })
    await chip.click()
    await p.locator('.acct-pop.top .acct-item', { hasText: 'Usage details' }).click()
    const plan = p.locator('.usage-card')
    await until(() => plan.isVisible(), 10000)
    await openGroup(plan)
    const uRow = (name) => plan.locator('.acct-u', { has: p.locator('.acct-u-head b', { hasText: new RegExp(`^${name}$`) }) }).first()
    const openRow = async (name) => { const r = uRow(name); if (!(await r.locator('.acct-acts').count())) await r.locator('.acct-u-head').click(); await r.locator('.acct-acts').waitFor({ timeout: 5000 }); return r }

    // Make default on your usual login: the star moves there, the top bar says so, and a new agent
    // with no account picked starts on it.
    await (await openRow(USUAL)).locator('button', { hasText: 'Make default' }).click()
    ok(!!(await until(async () => (await uRow(USUAL).locator('.def-tag').count()) === 1 && (await plan.locator('.def-tag').count()) === 1, 8000)), `${t}: Make default puts the star on your usual login, and only there`)
    ok(!!(await until(async () => (await chip.innerText()).replace(/\s+/g, ' ').includes(`New: ${USUAL}`), 8000)), `${t}: the top bar says new agents start there`, await chip.innerText())
    ok((await launchOn()) === 'claude-default', `${t}: and a new agent with no account picked starts on it`)

    // Auto: no star on any row, the auto tag on the one it picks; off again, the star on that one.
    const auto = plan.locator('.acct-auto input')
    await auto.click()
    const g1 = await until(async () => { const g = await claudeOf(); return g.setting === 'auto' && g }, 8000)
    ok(!!g1, `${t}: Auto is on`)
    ok(!!(await until(async () => (await plan.locator('.def-tag').count()) === 0 && (await plan.locator('.acct-u-head .best-tag', { hasText: 'auto' }).count()) === 1, 8000)), `${t}: with Auto on, no star, and the auto tag on the one it would pick`, await plan.innerText())
    const picked = g1 && g1.accounts.find((a) => a.id === g1.pick)
    const pickName = picked && (picked.isDefault && picked.named === false ? USUAL : picked.label)
    ok(g1 && await uRow(pickName).locator('.best-tag', { hasText: 'auto' }).count() === 1, `${t}: on Auto's pick (${pickName})`)
    await shot(p, `${tag}accounts-auto-sky`)
    await auto.click()
    ok(!!(await until(async () => (await claudeOf()).setting === g1?.pick && (await uRow(pickName).locator('.def-tag').count()) === 1, 8000)), `${t}: Auto off, the one it had picked is the default, with the star`)
    await kit.api('/accounts/active/claude', { id: 'claude-default' })

    // The same-account offer, while your usual login is the default: it goes off the list in one
    // click (no question: nothing is signed out), and Personal, the same account, is the default.
    const before = logouts().length
    asked.length = 0
    await p.locator('.acct-same-note button', { hasText: 'Remove your usual login from the list' }).click()
    ok(!!(await until(async () => (await plan.locator('.acct-u-head').count()) === 3 && !(await uRow(USUAL).count()), 8000)), `${t}: the extra row goes`, await plan.locator('.acct-u-head b').allInnerTexts())
    ok(asked.length === 0 && logouts().length === before, `${t}: without a question, and nothing signed out`, { asked, logouts: logouts() })
    ok(!(await plan.locator('.acct-same-note').count()), `${t}: the note goes with it`)
    const g2 = await claudeOf()
    ok(g2.usualHidden && !g2.accounts.some((a) => a.id === 'claude-default') && g2.setting === personal.id, `${t}: your usual login is off the list, and Personal (the same account) is the default`, { hidden: g2.usualHidden, list: g2.accounts.map((a) => a.label), setting: g2.setting })
    ok(!!(await until(async () => (await uRow('Personal').locator('.def-tag').count()) === 1 && /New:\s*Personal/.test((await chip.innerText()).replace(/\s+/g, ' ')), 8000)), `${t}: the star and the top bar say Personal`)
    await chip.click()
    const menu = p.locator('.acct-pop.top')
    await menu.waitFor({ timeout: 5000 })
    ok(!/Your usual login/.test(await menu.innerText()) && !(await menu.innerText()).includes(USUAL) && !(await menu.locator('.acct-same').count()), `${t}: the top bar's menu doesn't list it either`, await menu.innerText())
    await p.keyboard.press('Escape')
    ok((await launchOn()) === personal.id, `${t}: a new agent with no account picked starts on Personal, not your usual login`)
    ok((await launchOn({ account: 'claude-default' })) === personal.id, `${t}: and one asked for your usual login doesn't start on it`)
    const refused = await kit.api('/accounts/active/claude', { id: 'claude-default' }).then(() => null, (e) => e.message)
    ok(/off the list/.test(refused || ''), `${t}: it can't be made default while it's off the list`, refused)

    // Settings › Model Providers › Accounts: shows it again.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'accounts' } })))
    const sec = p.locator('#pv-accounts')
    await sec.waitFor({ timeout: 15000 })
    const sRow = (name) => sec.locator('.pv-acct', { has: p.locator('.pv-acct-title', { hasText: new RegExp(`^${name}`) }) }).first()
    ok(!(await sRow('Your usual login').count()), `${t}: Settings doesn't list it`)
    await sec.locator('button', { hasText: 'Show your usual login' }).click()
    ok(!!(await until(async () => (await sRow('Your usual login').count()) === 1, 10000)), `${t}: Show your usual login puts it back`)
    const g3 = await claudeOf()
    ok(!g3.usualHidden && g3.accounts[0].id === 'claude-default' && g3.setting === personal.id, `${t}: first in the list again, and Personal stays the default`, g3.accounts.map((a) => a.label))
    ok(!!(await until(async () => (await sRow('Personal').locator('.def-tag').count()) === 1 && (await sec.locator('.def-tag').count()) === 1, 10000)), `${t}: Settings has the star on Personal`)

    // Up and down the list: kept, and the top bar's menu lists them in that order.
    const labels = async () => (await claudeOf()).accounts.map((a) => a.label)
    const order0 = await labels()
    await sRow('Work Primary').locator('button[aria-label="Move Work Primary up"]').click()
    ok(!!(await until(async () => (await labels()).indexOf('Work Primary') === order0.indexOf('Work Primary') - 1, 6000)), `${t}: Move up puts it higher, and that's kept`, await labels())
    ok(!!(await until(async () => (await sec.locator('.pv-acct-label').allInnerTexts()).indexOf('Work Primary') === order0.indexOf('Work Primary') - 1, 6000)), `${t}: Settings shows the new order`)
    ok(!(await sRow(order0[0]).locator(`button[aria-label="Move ${order0[0]} up"]`).isEnabled()), `${t}: the first one can't go up`)
    await sRow('Work Primary').locator('button[aria-label="Move Work Primary down"]').click()
    ok(!!(await until(async () => (await labels()).join('|') === order0.join('|'), 6000)), `${t}: and Move down puts it back`, await labels())

    // Sign out: your usual login asks first (it's Claude Code's own), and runs `claude auth logout`
    // with no config folder of its own; an added account runs it for its own folder.
    await until(async () => (await sRow('Your usual login').locator('button', { hasText: 'Sign out' }).count()) === 1, 15000)
    asked.length = 0
    answer = false
    const n0 = logouts().length
    await sRow('Your usual login').locator('button', { hasText: 'Sign out' }).click()
    await until(() => asked.length > 0, 5000)
    ok(asked.length === 1 && /Claude Code itself signs out/.test(asked[0]), `${t}: Sign out of your usual login asks first, and says Claude Code itself signs out`, asked)
    await p.waitForTimeout(500)
    ok(logouts().length === n0, `${t}: no, and nothing is signed out`, logouts())
    answer = true
    await sRow('Your usual login').locator('button', { hasText: 'Sign out' }).click()
    ok(!!(await until(() => logouts().length === n0 + 1 && logouts()[n0] === null, 10000)), `${t}: yes, and the stand-in Claude Code was asked to log out of your usual folder`, logouts())
    ok(!!(await until(async () => /Not signed in/.test(await sRow('Your usual login').innerText()), 15000)), `${t}: then it says it's not signed in, with Sign in`, await sRow('Your usual login').innerText())
    asked.length = 0
    await sRow('Work Secondary').locator('button', { hasText: 'Sign out' }).click()
    const secondDir = path.join(kit.data, 'accounts', second.id)
    ok(!!(await until(() => logouts().length === n0 + 2 && logouts()[n0 + 1] === secondDir, 10000)), `${t}: Sign out of Work Secondary runs the logout for its own folder`, { logouts: logouts(), secondDir })
    ok(asked.length === 0, `${t}: without a question`, asked)
    ok(!!(await until(async () => /Not signed in/.test(await sRow('Work Secondary').innerText()), 15000)), `${t}: and it says so`, await sRow('Work Secondary').innerText())
    await shot(p, `${tag}accounts-settings-signed-out-sky`)

    // Remove an added account: asked, signed out, its folder gone.
    const primaryDir = path.join(kit.data, 'accounts', primary.id)
    ok(fs.existsSync(primaryDir), `${t}: (Work Primary has its folder)`)
    asked.length = 0
    await sRow('Work Primary').locator('button[aria-label="Remove Work Primary"]').click()
    ok(!!(await until(async () => !(await sRow('Work Primary').count()), 10000)), `${t}: Remove takes Work Primary away`)
    ok(/Sign out of Work Primary and remove it/.test(asked[0] || ''), `${t}: after asking`, asked)
    ok(logouts().includes(primaryDir) && !fs.existsSync(primaryDir), `${t}: signed out for its own folder, which is deleted`, logouts())

    // Remove your usual login while it's the default: asked (nothing is signed out), and the default
    // is the first one listed after it.
    // The list's check from just before Remove answers last (a slow computer): it doesn't bring it back.
    await kit.api('/accounts/active/claude', { id: 'claude-default' })
    let held = 0
    let early = null
    await p.route('**/api/accounts?refresh=1', async (route) => {
      if (held++) return route.continue()
      early = await route.fetch()
      await sleep(2000)
      await route.fulfill({ response: early })
    })
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-accounts-changed', { detail: {} })))
    await until(() => !!early, 10000)
    asked.length = 0
    const n1 = logouts().length
    await sRow('Your usual login').locator('button[aria-label="Remove Your usual login"]').click()
    ok(!!(await until(async () => !(await sRow('Your usual login').count()), 10000)), `${t}: Remove takes your usual login off Settings' list too`)
    await sleep(2500)
    ok(held >= 2 && !(await sRow('Your usual login').count()), `${t}: and the list's check from before Remove, answering after it, doesn't bring it back`, held)
    await p.unroute('**/api/accounts?refresh=1')
    ok(/Take your usual login off Bridge AI's list\? Nothing is signed out: Claude Code keeps it for the terminal/.test(asked[0] || ''), `${t}: after saying Claude Code keeps it for the terminal`, asked)
    ok(logouts().length === n1, `${t}: and nothing is signed out`, logouts())
    const g4 = await claudeOf()
    ok(g4.setting === personal.id, `${t}: the default was removed, so the first listed (Personal) is the default`, g4.setting)

    // The last one stays.
    await kit.api(`/accounts/${second.id}`, null, 'DELETE')
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-accounts-changed', { detail: {} })))
    const last = await kit.api(`/accounts/${personal.id}`, null, 'DELETE').then(() => null, (e) => e.message)
    ok(/your only Claude Code account here, so it stays/.test(last || ''), `${t}: the last account can't be removed`, last)
    ok(!!(await until(async () => (await sec.locator('.pv-acct').count()) === 1 && await sRow('Personal').locator('button[aria-label="Remove Personal"]').isDisabled(), 10000)), `${t}: and its Remove is off in Settings`)
    const g5 = await claudeOf()
    ok(g5.accounts.length === 1 && g5.accounts[0].id === personal.id, `${t}: Personal is still there`, g5.accounts.map((a) => a.label))
    ok(errors.length === 0, `${t}: no page errors`, errors)
    await ctx.close()
  }

  // Settings › Accounts with your usual login back and named, and two accounts added again: in a
  // light and a dark theme, on a desktop and a phone.
  await kit.api('/accounts/show/claude', {})
  await kit.api('/accounts/claude-default', { label: 'Main' }, 'PATCH')
  await kit.api('/accounts', { kind: 'claude', label: 'Work Secondary' })
  await kit.api('/accounts', { kind: 'claude', label: 'Work Primary' })
  const named = await claudeOf()
  ok(named.accounts[0].label === 'Main' && named.accounts[0].named === true, 'renamed, your usual login goes by its name', named.accounts[0])
  ok(named.setting === personal.id, 'shown again, it doesn\'t take the star back: Personal stays the default', named.setting)
  ok(named.accounts.map((a) => a.label).join('|') === 'Main|Personal|Work Secondary|Work Primary', 'first, then the others in the order added', named.accounts.map((a) => a.label))
  for (const look of [{ mode: 'light', theme: 'sky' }, { mode: 'dark', theme: 'midnight' }, { mode: 'light', theme: 'sky', phone: true }, { mode: 'dark', theme: 'midnight', phone: true }]) {
    const t = `settings ${look.theme}${look.phone ? ' phone' : ''}`
    const { ctx, p, errors } = await page(b, kit.url, { ...look, before: fake })
    await p.locator('.usage-chip').first().waitFor({ timeout: 15000 }).catch(() => {})
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'accounts' } })))
    const sec = p.locator('#pv-accounts')
    await sec.waitFor({ timeout: 15000 })
    ok(!!(await until(async () => /Main/.test(await sec.innerText()) && /your usual login/.test(await sec.innerText()), 10000)), `${t}: Main, said to be your usual login`, await sec.innerText().catch(() => ''))
    await sec.scrollIntoViewIfNeeded()
    await p.waitForTimeout(300)
    if (look.phone) ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${t}: nothing wider than the phone`)
    await shot(p, `${tag}accounts-settings-${look.theme}${look.phone ? '-phone' : ''}`)
    ok(errors.length === 0, `${t}: no page errors`, errors)
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
