// A Claude Code agent at work, with a stand-in Claude Code (stand-ins/claude.cjs "busy") that works
// a while on each message with a subagent, sends one more off in the background, and queues what's
// typed meanwhile as Claude Code does (test/lib/busy.mjs; busy-queue has the rest). In the browser
// named by BRIDGE_TEST_BROWSER:
//   on a phone (390 px light, 375 px dark), its subagents: on its card in the Agents tab (which
//   are at work and what each is doing), in its chat's tray, and on the agent map; also once its own
//   turn is over while the one in the background still works (the map and the cards showed them
//   only while the agent itself worked); then that it finished;
//   a reconnect mid-queue: the phone offline as it sends (the message waits, says so, and goes once
//   it's back), the page reloaded (the queue is still there), a message the page left on its way
//   as it closed (sent once it opens again), and the same message sent twice (held once);
//   and a message typed in its terminal while it works, which it takes in between two steps: in
//   the chat (Claude Code logs it where Chat didn't look).
import { checks, until, shot, phoneFaults } from '../lib/harness.mjs'
import { busyKit, LIGHT, DARK, enc, same, openChat, seesWorking, sendFrom, bubbles } from '../lib/busy.mjs'

const { ok, done } = checks('busy-agent')
const { kit, b, tag, got, agentOf, queueOf, launch, working, settled, phone, wentIn } = await busyKit('busy-agent')

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
