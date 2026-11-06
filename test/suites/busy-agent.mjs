// A Claude Code agent at work, with a stand-in Claude Code (stand-ins/claude.cjs "busy") that works
// a while on each message with a subagent, sends one more off in the background, and queues what's
// typed meanwhile as Claude Code does. In the browser named by BRIDGE_TEST_BROWSER:
//   on a phone (390 px light, 375 px dark), its subagents: on its card in the Agents tab (which
//   are at work and what each is doing), in its chat's tray, and on the agent map; also once its own
//   turn is over while the one in the background still works (the map and the cards showed them
//   only while the agent itself worked); then that it finished;
//   three messages sent from a phone while it works: each shows as queued and says so (a phone has
//   no hover, and the line saying so showed only on hover), none goes into the agent meanwhile, and
//   then each goes in on its own, in order, once, exactly as written (one has two lines), and shows
//   in the chat (typed into a busy Claude Code, they were joined into one, or taken in where its
//   chat didn't show them);
//   the same on a desktop (1440 px, light and dark), with one taken back (never sent) and one
//   changed before it went (the change is what goes);
//   a reconnect mid-queue: the phone offline as it sends (the message waits, says so, and goes once
//   it's back), the page reloaded (the queue is still there), a message the page left on its way
//   as it closed (sent once it opens again), and the same message sent twice (held once);
//   two sent at once to an agent that's free: one goes in and the other waits its turn (the
//   second found the first still in the input box and cleared it);
//   what a send says, by the computer's answer (Dictations' Send to an agent): "Queued for" a busy
//   agent with its place in line, "Sent to" one that's free (it said "Sent to" either way);
//   and a message typed in its terminal while it works, which it takes in between two steps: in
//   the chat (Claude Code logs it where Chat didn't look).
import fs from 'node:fs'
import path from 'node:path'
import { startKit, checks, until, sleep, browser, page, shot, phoneFaults, TEST } from '../lib/harness.mjs'

const { ok, done } = checks('busy-agent')
const kit = await startKit('busy-agent')
kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const LIGHT = { mode: 'light', theme: 'sky' }
const DARK = { mode: 'dark', theme: 'midnight' }
const enc = encodeURIComponent
// What a stand-in took in, as it got it: { session, text, how }, oldest first.
const got = (session) => { try { return fs.readFileSync(path.join(kit.home, 'claude-got.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.session === session) } catch { return [] } }
const agentOf = async (paneId) => ((await kit.api('/fleet')).agents || []).find((a) => a.paneId === paneId)
const queueOf = async (paneId) => (((await kit.api('/fleet')).queue || {})[paneId] || []).map((x) => x.text)
const dir = path.join(kit.home, 'billing')
fs.mkdirSync(dir, { recursive: true })
// An agent started on `prompt` ("busy ..."), once it has taken that in.
const launch = async (label, prompt) => {
  const a = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label, newSpace: 'Billing', prompt })
  const x = await until(async () => { const y = await agentOf(a.paneId); return y?.sessionId && got(y.sessionId).length && y }, 40000, 300)
  return { ...a, sessionId: x?.sessionId, began: Date.now() }
}
const working = (ag) => until(async () => (await agentOf(ag.paneId))?.status === 'working', 20000, 200)
// Done with its first message (`secs` long).
const settled = async (ag, secs) => {
  await sleep(Math.max(0, ag.began + secs * 1000 - Date.now()))
  return until(async () => ['done', 'idle'].includes((await agentOf(ag.paneId))?.status), 40000, 300)
}
const phone = async (look, width) => {
  const v = await page(b, kit.url, { ...look, phone: true })
  if (width !== 390) await v.p.setViewportSize({ width, height: 812 })
  await v.p.waitForSelector('.tabbar button', { timeout: 20000 })
  return v
}
const openChat = async (p, paneId) => {
  await p.evaluate((id) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: id } })), paneId)
  await p.locator('.composer textarea').waitFor({ timeout: 20000 })
}
// The page knows it's working (its fleet says so), so what's sent now is held.
const seesWorking = (p) => until(async () => (await p.locator('.console .state-tag.st-working').count()) > 0, 20000, 100)
const sendFrom = async (p, text, { touch }) => {
  await p.locator('.composer textarea').fill(text)
  if (touch) await p.locator('.composer-stack .send').click()
  else await p.locator('.composer textarea').press('Enter')
}
// The queued messages in the chat: their words, what each says, and whether that shows.
const bubbles = (p) => p.evaluate(() => [...document.querySelectorAll('.msg.queued')].map((m) => ({ text: m.querySelector('.msg-text').innerText.trim(), says: m.querySelector('.msg-time').innerText.replace(/\s+/g, ' ').trim(), shown: getComputedStyle(m.querySelector('.msg-time')).opacity === '1' })))
const userMsgs = (p) => p.evaluate(() => [...document.querySelectorAll('.chat .msg.user:not(.queued):not(.pending) .msg-text')].map((e) => e.innerText.trim()))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// What the agent took in once all of `msgs` have gone in and nothing more waits for it (so nothing
// more can come).
const wentIn = async (ag, msgs, ms = 90000) => {
  await until(() => msgs.every((m) => got(ag.sessionId).some((x) => x.text === m)), ms, 500)
  await until(async () => !(await queueOf(ag.paneId)).length && ['done', 'idle'].includes((await agentOf(ag.paneId))?.status), 30000, 300)
  await sleep(1000)
  return got(ag.sessionId)
}

try {
  await kit.api('/setup', { name: 'Tester' })
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')

  // ---------- Subagents, on a phone ----------
  const phones = [[await phone(LIGHT, 390), 'light', 390], [await phone(DARK, 375), 'dark', 375]]
  for (const [{ p }] of phones) await p.locator('.tabbar button', { hasText: 'Agents' }).click()
  const inv = await launch('Invoices', 'busy 22 bg 16')
  await working(inv)
  const two = await until(async () => { const a = await agentOf(inv.paneId); return a?.subagents?.running === 2 && a }, 20000, 300)
  ok(two?.status === 'working' && two.subagents.items.some((i) => i.title === 'Watch the build') && two.subagents.items.some((i) => i.title === 'Check the invoices 1'), 'the fleet says what it has running: its subagent, and one in the background', two?.subagents)
  const card = (p) => p.locator('.tile', { hasText: 'Invoices' }).first()
  for (const [{ p }, mode, w] of phones) {
    const at = `${w} px ${mode}`
    const subs = await until(async () => { const x = await card(p).locator('.tile-subs').innerText().catch(() => ''); return /2 subagents running/.test(x) && /Watch the build/.test(x) && /Check the invoices 1/.test(x) && x }, 15000, 200)
    ok(!!subs, `${at}: its card in the Agents tab says 2 subagents are running, and which`, subs || await card(p).innerText().catch((e) => e.message))
    ok(!!(await until(async () => (await card(p).locator('.ts-doing').allInnerTexts()).some((x) => /Read billing\/part-\d+\.py/.test(x)), 8000, 200)), `${at}: and what each is doing`, await card(p).innerText().catch(() => ''))
    const faults = await phoneFaults(p, '.board')
    ok(!faults.wider && !faults.past?.length && !faults.sideways?.length, `${at}: the card fits the phone`, faults)
    await shot(p, `${tag}busy-subagents-card-${mode}-${w}`)
    await card(p).locator('.tile-main').click()
    const head = await until(async () => { const x = await p.locator('.sa-tray .sa-head').innerText().catch(() => ''); return /In the background/.test(x) && /2 subagents running/.test(x) && x }, 15000, 200)
    ok(!!head, `${at}: its chat's tray says the same`, head)
    await shot(p, `${tag}busy-subagents-chat-${mode}-${w}`)
    await p.locator('.console .win-btn.back').click()
  }
  // Its own turn over, the one in the background still at work.
  await settled(inv, 22)
  ok((await agentOf(inv.paneId))?.subagents?.running === 1, 'its turn over, the fleet still has the one in the background', (await agentOf(inv.paneId))?.subagents)
  for (const [{ p }, mode, w] of phones) {
    const at = `${w} px ${mode}`
    const x = await until(async () => { const t = await card(p).locator('.tile-subs').innerText().catch(() => ''); return /1 subagent running/.test(t) && /Watch the build/.test(t) && t }, 15000, 200)
    ok(!!x, `${at}: done with its turn, its card still shows the subagent at work in the background`, x || await card(p).innerText().catch(() => ''))
    await p.locator('.m-acts button', { hasText: 'Map' }).click()
    const row = p.locator('.am-row', { hasText: 'Invoices' }).first()
    const map = await until(async () => { const t = await row.locator('.am-subs').innerText().catch(() => ''); return /Watch the build/.test(t) && t }, 20000, 300)
    ok(!!map, `${at}: and so does the agent map`, map || await row.innerText().catch(() => ''))
    await shot(p, `${tag}busy-subagents-map-${mode}-${w}`)
    await p.locator('.m-view-back').click()
  }
  // Then it finishes.
  await until(async () => (await agentOf(inv.paneId))?.subagents?.running === 0, 30000, 500)
  for (const [{ p }, mode, w] of phones) {
    const x = await until(async () => { const t = await card(p).locator('.tile-subs').innerText().catch(() => ''); return /Watch the build/.test(t) && /finished/.test(t) && !/running/.test(t) && t }, 15000, 200)
    ok(!!x, `${w} px ${mode}: when it finishes, its card says so`, x || await card(p).innerText().catch(() => ''))
    await shot(p, `${tag}busy-subagents-finished-${mode}-${w}`)
  }
  for (const [{ ctx, errors }, mode, w] of phones) { ok(errors.length === 0, `${w} px ${mode}: no page errors`, errors); await ctx.close() }

  // ---------- Three messages from a phone while it works ----------
  {
    const ag = await launch('Refunds', 'busy 3 8 3')
    await settled(ag, 3)
    const { ctx, p, errors } = await phone(LIGHT, 390)
    await openChat(p, ag.paneId)
    await kit.api(`/agents/${enc(ag.paneId)}/prompt`, { text: 'Start on the refunds' })
    await seesWorking(p)
    const msgs = ['Check the refunds first', 'Then the credits:\nboth currencies', 'And say what you changed ☕']
    for (const m of msgs) await sendFrom(p, m, { touch: true })
    const shown = await until(async () => { const x = await bubbles(p); return x.length === 3 && x.every((y) => /Edit/.test(y.says)) && x }, 8000, 100) || await bubbles(p)
    ok(same(shown.map((x) => x.text), msgs), 'phone: the three show as queued, in the order sent, as written', shown)
    ok(shown.length === 3 && shown.every((x) => /Queued, sends when the agent is free/.test(x.says) && /Edit/.test(x.says) && /Remove/.test(x.says) && x.shown), 'phone: each says it\'s queued, with Edit and Remove, showing without a hover', shown)
    ok(same(await queueOf(ag.paneId), msgs), 'your computer holds all three, in order', await queueOf(ag.paneId))
    ok((await p.locator('.composer textarea').inputValue()) === '', 'the message box is empty again')
    await shot(p, `${tag}busy-queued-phone-light-390`)
    await sleep(1500)
    ok(!got(ag.sessionId).some((x) => msgs.some((m) => x.text.includes(m.split('\n')[0]))), 'none goes into the agent while it works', got(ag.sessionId))
    const g = await wentIn(ag, msgs)
    ok(same(g.map((x) => x.text), ['busy 3 8 3', 'Start on the refunds', ...msgs]) && g.every((x) => x.how === 'turn'), 'then each goes in on its own, in order, once, exactly as written', g)
    const chat = await until(async () => { const u = await userMsgs(p); return msgs.every((m) => u.includes(m)) && !(await bubbles(p)).length && u }, 20000, 300)
    ok(!!chat, 'and shows in the chat, nothing left queued', chat || { users: await userMsgs(p), queued: await bubbles(p) })
    await shot(p, `${tag}busy-delivered-phone-light-390`)
    ok(errors.length === 0, 'phone: no page errors', errors)
    await ctx.close()
  }

  // ---------- The same on a desktop: one taken back, one changed ----------
  for (const look of [LIGHT, DARK]) {
    const ag = await launch(`Credits ${look.mode}`, 'busy 3 10 3')
    await settled(ag, 3)
    const { ctx, p, errors } = await page(b, kit.url, { ...look, width: 1440, height: 900 })
    await p.waitForSelector('.rail-nav-btn', { timeout: 20000 })
    await openChat(p, ag.paneId)
    await kit.api(`/agents/${enc(ag.paneId)}/prompt`, { text: 'Start on the credits' })
    await seesWorking(p)
    const msgs = [`Look at the ${look.mode} credits`, 'Skip the old ones', 'Then the totals']
    for (const m of msgs) await sendFrom(p, m, { touch: false })
    const shown = await until(async () => { const x = await bubbles(p); return x.length === 3 && x }, 8000, 100)
    ok(!!shown && same(shown.map((x) => x.text), msgs), `desktop ${look.mode}: the three show as queued, in order`, shown)
    await p.locator('.msg.queued', { hasText: 'Skip the old ones' }).locator('button', { hasText: 'Remove' }).click()
    ok(!!(await until(async () => same(await queueOf(ag.paneId), [msgs[0], msgs[2]]), 5000, 100)), `desktop ${look.mode}: one taken back`, await queueOf(ag.paneId))
    await p.locator('.msg.queued', { hasText: 'Then the totals' }).locator('button', { hasText: 'Edit' }).click()
    await p.locator('.queued-edit').fill('Then the totals, both currencies')
    await shot(p, `${tag}busy-queued-desktop-${look.mode}-1440`)
    await p.locator('.msg.queued.editing').locator('button', { hasText: 'Save' }).click()
    const want = [msgs[0], 'Then the totals, both currencies']
    ok(!!(await until(async () => same(await queueOf(ag.paneId), want), 5000, 100)), `desktop ${look.mode}: and one changed before it goes`, await queueOf(ag.paneId))
    ok(!!(await until(async () => same((await bubbles(p)).map((x) => x.text), want), 5000, 100)), `desktop ${look.mode}: the chat shows the two left, the change in place`, await bubbles(p))
    const g = await wentIn(ag, want)
    ok(same(g.map((x) => x.text), ['busy 3 10 3', 'Start on the credits', ...want]), `desktop ${look.mode}: what's left goes in, in order, once each; the one taken back never does`, g)
    ok(errors.length === 0, `desktop ${look.mode}: no page errors`, errors)
    await ctx.close()
  }

  // ---------- A reconnect mid-queue ----------
  {
    const ag = await launch('Taxes', 'busy 3 24 3')
    await settled(ag, 3)
    const { ctx, p, errors } = await phone(DARK, 375)
    await openChat(p, ag.paneId)
    await kit.api(`/agents/${enc(ag.paneId)}/prompt`, { text: 'Start on the taxes' })
    await seesWorking(p)
    await sendFrom(p, 'Look at the VAT rules', { touch: true })
    await until(async () => same(await queueOf(ag.paneId), ['Look at the VAT rules']), 5000, 100)
    // Offline as it sends: it waits, says so, and goes once the phone is back.
    await ctx.setOffline(true)
    await sendFrom(p, 'Then the sales tax', { touch: true })
    const waits = await until(async () => (await bubbles(p)).find((x) => x.text === 'Then the sales tax' && /Waiting for the connection/.test(x.says)), 10000, 100)
    ok(!!waits, 'offline as it sends: the message stays, saying it waits for the connection', await bubbles(p))
    ok((await p.locator('.composer textarea').inputValue()) === '', 'and the message box is free for the next one')
    await shot(p, `${tag}busy-offline-phone-dark-375`)
    await ctx.setOffline(false)
    ok(!!(await until(async () => same(await queueOf(ag.paneId), ['Look at the VAT rules', 'Then the sales tax']), 20000, 200)), 'back online: it goes, once, after the one before it', await queueOf(ag.paneId))
    // The page closes with a message still on its way (the app put away mid-send), then opens again.
    await p.evaluate((pane) => localStorage.setItem('cc-sending', JSON.stringify([{ cid: 'left-behind-1', pane, way: 'queue', text: 'And the receipts', at: Date.now() }])), ag.paneId)
    await p.reload()
    await p.waitForSelector('.tabbar button', { timeout: 20000 })
    await openChat(p, ag.paneId)
    const want = ['Look at the VAT rules', 'Then the sales tax', 'And the receipts']
    ok(!!(await until(async () => same(await queueOf(ag.paneId), want), 15000, 200)), 'reloaded: the queue is still there, and what was left on its way went once the page opened', await queueOf(ag.paneId))
    ok(!!(await until(async () => same((await bubbles(p)).map((x) => x.text), want), 10000, 200)), 'and the chat shows all three, queued', await bubbles(p))
    // The same message again (sent again after the connection dropped before its answer came).
    const again = await kit.api(`/agents/${enc(ag.paneId)}/queue`, { text: 'And the receipts', cid: 'left-behind-1' })
    const again2 = await kit.api(`/agents/${enc(ag.paneId)}/prompt`, { text: 'And the receipts', cid: 'left-behind-1' })
    ok(same(await queueOf(ag.paneId), want) && again.id === again2.id, 'the same message sent twice is held once', { queue: await queueOf(ag.paneId), again, again2 })
    const g = await wentIn(ag, want, 120000)
    ok(same(g.map((x) => x.text), ['busy 3 24 3', 'Start on the taxes', ...want]), 'then each goes in, in order, once', g)
    // WebKit reports each request it couldn't make while offline as a page error.
    ok(errors.filter((e) => !/\/api\/[\w/.?=&-]+ due to access control checks/.test(e)).length === 0, 'reconnect: no page errors', errors)
    await ctx.close()
  }

  // ---------- Two sent at once to an agent that's free (a phone sending the next before the first's answer came) ----------
  {
    const ag = await launch('Payouts', 'busy 2 3')
    await settled(ag, 2)
    const two = ['Check the payouts', 'And the fees']
    const rs = await Promise.all(two.map((text, i) => kit.api(`/agents/${enc(ag.paneId)}/prompt`, { text, cid: `at-once-${i}` })))
    const first = rs.findIndex((r) => !r.queued)
    const order = first < 0 ? two : [two[first], two[1 - first]]
    ok(first >= 0 && rs.filter((r) => r.queued).length === 1, 'two sent at once to an agent that\'s free: one goes in, the other waits its turn', rs)
    const g = await wentIn(ag, two)
    ok(same(g.map((x) => x.text), ['busy 2 3', ...order]) && g.every((x) => x.how === 'turn'), 'and both go in, one after the other, each on its own (the second used to find the first still in the input box and clear it)', g)
  }

  // ---------- What a send says, by the computer's answer: "Queued for" a busy agent, "Sent to" a free one ----------
  {
    const busyOne = await launch('Receipts', 'busy 3 20 3')
    const freeOne = await launch('Fees', 'busy 2 3')
    await settled(busyOne, 3)
    await kit.api(`/agents/${enc(busyOne.paneId)}/prompt`, { text: 'Start on the receipts' })
    await working(busyOne)
    await settled(freeOne, 2)
    for (const text of ['Note the receipt totals.', 'Note the fees.']) await kit.api('/dictations', { text, ms: 900 })
    const { ctx, p, errors } = await page(b, kit.url, { ...LIGHT, width: 1440, height: 900, store: { 'cc-rail-dictations': true } })
    await p.locator('.rail-nav-btn', { hasText: 'Dictations' }).click()
    const v = p.locator('.dc-view')
    await v.waitFor({ timeout: 10000 })
    const sendTo = async (text, pane) => {
      const row = v.locator('.dc-row', { hasText: text }).first()
      if (!(await row.locator('button', { hasText: 'Send to an agent' }).count())) await row.locator('.dc-head').click()
      await row.locator('button', { hasText: 'Send to an agent' }).click()
      await row.locator(`.dc-menu button[data-pane="${pane}"]`).click()
    }
    const toast = (re) => until(async () => { const x = await p.locator('.dc-toast').innerText().catch(() => ''); return re.test(x) && x }, 8000, 100)
    await sendTo('Note the receipt totals', busyOne.paneId)
    const first = await toast(/Queued for Receipts, next in line/)
    ok(!!first && !/Sent to/.test(first), 'Dictations, to a busy agent: "Queued for" it, next in line (your computer held it), not "Sent to"', first || await p.locator('.dc-toast').innerText().catch(() => ''))
    await sleep(300) // the toast fades in
    await shot(p, `${tag}busy-queued-for-toast-light-1440`)
    await sendTo('Note the fees', busyOne.paneId)
    ok(!!(await toast(/Queued for Receipts, number 2 in line/)), 'a second one: number 2 in line', await p.locator('.dc-toast').innerText().catch(() => ''))
    ok(same(await queueOf(busyOne.paneId), ['Note the receipt totals.', 'Note the fees.']), 'both held for it, in order', await queueOf(busyOne.paneId))
    await sendTo('Note the fees', freeOne.paneId)
    const sent = await toast(/Sent to Fees/)
    ok(!!sent && !/Queued/.test(sent), 'to one that\'s free: "Sent to" it', sent || await p.locator('.dc-toast').innerText().catch(() => ''))
    ok(!!(await until(() => got(freeOne.sessionId).some((x) => x.text === 'Note the fees.'), 10000, 300)), 'and it went in', got(freeOne.sessionId))
    await shot(p, `${tag}busy-queued-for-dictations-light-1440`)
    ok(errors.length === 0, 'Dictations: no page errors', errors)
    await ctx.close()
  }

  // ---------- Typed in its terminal while it works ----------
  {
    const ag = await launch('Ledger', 'busy 14 3')
    await working(ag)
    await kit.api(`/panes/${enc(ag.paneId)}/input`, { steps: [{ text: 'Also check the ledger' }, { keys: ['enter'] }] })
    const m = await until(async () => (await kit.api(`/agents/${enc(ag.paneId)}/transcript`)).messages.find((x) => x.role === 'user' && x.text === 'Also check the ledger'), 30000, 500)
    ok(got(ag.sessionId).some((x) => x.text === 'Also check the ledger' && x.how === 'mid'), 'typed in its terminal while it works, it was taken in between two steps', got(ag.sessionId))
    ok(m?.mid === true, 'and shows in the chat, as yours', m)
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  kit.stop()
}
process.exit(done().fail ? 1 : 0)
