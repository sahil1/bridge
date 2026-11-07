// Messages sent to a Claude Code agent while it's at work, with a stand-in Claude Code
// (stand-ins/claude.cjs "busy", test/lib/busy.mjs) that works a while on each and queues what's
// typed meanwhile as Claude Code does. In the browser named by BRIDGE_TEST_BROWSER:
//   three messages sent from a phone while it works: each shows as queued and says so (a phone has
//   no hover, and the line saying so showed only on hover), none goes into the agent meanwhile, and
//   then each goes in on its own, in order, once, exactly as written (one has two lines), and shows
//   in the chat (typed into a busy Claude Code, they were joined into one, or taken in where its
//   chat didn't show them);
//   the same on a desktop (1440 px, light and dark), with one taken back (never sent) and one
//   changed before it went (the change is what goes);
//   two sent at once to an agent that's free: one goes in and the other waits its turn (the
//   second found the first still in the input box and cleared it);
//   and what a send says, by the computer's answer (Dictations' Send to an agent): "Queued for" a
//   busy agent with its place in line, "Sent to" one that's free (it said "Sent to" either way).
import { checks, until, sleep, page, shot } from '../lib/harness.mjs'
import { busyKit, LIGHT, DARK, enc, same, openChat, seesWorking, sendFrom, bubbles, userMsgs } from '../lib/busy.mjs'

const { ok, done } = checks('busy-queue')
const { kit, b, tag, got, agentOf, queueOf, launch, working, settled, phone, wentIn } = await busyKit('busy-queue')

try {
  await kit.api('/setup', { name: 'Tester' })
  ok((await kit.api('/agents/catalog')).some((a) => a.kind === 'claude' && a.installed), 'the stand-in Claude Code is found')

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
    // What's left going in: once is enough (the light one).
    if (look === LIGHT) {
      const g = await wentIn(ag, want)
      ok(same(g.map((x) => x.text), ['busy 3 10 3', 'Start on the credits', ...want]), `desktop ${look.mode}: what's left goes in, in order, once each; the one taken back never does`, g)
    }
    ok(errors.length === 0, `desktop ${look.mode}: no page errors`, errors)
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
    const busyOne = await launch('Receipts', 'busy 2 25 3')
    const freeOne = await launch('Fees', 'busy 2 3')
    for (const text of ['Note the receipt totals.', 'Note the fees.']) await kit.api('/dictations', { text, ms: 900 })
    // The page first: on a slow computer it can take longer to open than the agent's turn lasts.
    const { ctx, p, errors } = await page(b, kit.url, { ...LIGHT, width: 1440, height: 900, store: { 'cc-rail-dictations': true } })
    await p.locator('.rail-nav-btn', { hasText: 'Dictations' }).click()
    const v = p.locator('.dc-view')
    await v.waitFor({ timeout: 20000 })
    await until(async () => (await v.locator('.dc-row').count()) >= 2, 10000, 100)
    // Each agent as the menu names it (on Windows the stand-in goes by its terminal's title).
    const sendTo = async (text, pane) => {
      const row = v.locator('.dc-row', { hasText: text }).first()
      if (!(await row.locator('button', { hasText: 'Send to an agent' }).count())) await row.locator('.dc-head').click()
      await row.locator('button', { hasText: 'Send to an agent' }).click()
      const pick = row.locator(`.dc-menu button[data-pane="${pane}"]`)
      const name = (await pick.innerText()).trim()
      await pick.click()
      return name
    }
    const toast = (want) => until(async () => { const x = await p.locator('.dc-toast').innerText().catch(() => ''); return x.includes(want) && x }, 8000, 50)
    await settled(busyOne, 2)
    await settled(freeOne, 2)
    await kit.api(`/agents/${enc(busyOne.paneId)}/prompt`, { text: 'Start on the receipts' })
    ok(!!(await working(busyOne)), 'Receipts is at work', await agentOf(busyOne.paneId))
    const busyName = await sendTo('Note the receipt totals', busyOne.paneId)
    const first = await toast(`Queued for ${busyName}, next in line`)
    ok(!!first && !/Sent to/.test(first), 'Dictations, to a busy agent: "Queued for" it, next in line (your computer held it), not "Sent to"', first || { busyName, toast: await p.locator('.dc-toast').innerText().catch(() => ''), status: (await agentOf(busyOne.paneId))?.status })
    await sleep(300) // the toast fades in
    await shot(p, `${tag}busy-queued-for-toast-light-1440`)
    await sendTo('Note the fees', busyOne.paneId)
    ok(!!(await toast(`Queued for ${busyName}, number 2 in line`)), 'a second one: number 2 in line', await p.locator('.dc-toast').innerText().catch(() => ''))
    ok(same(await queueOf(busyOne.paneId), ['Note the receipt totals.', 'Note the fees.']), 'both held for it, in order', await queueOf(busyOne.paneId))
    const freeName = await sendTo('Note the fees', freeOne.paneId)
    const sent = await toast(`Sent to ${freeName}`)
    ok(!!sent && !/Queued/.test(sent), 'to one that\'s free: "Sent to" it', sent || await p.locator('.dc-toast').innerText().catch(() => ''))
    ok(!!(await until(() => got(freeOne.sessionId).some((x) => x.text === 'Note the fees.'), 10000, 300)), 'and it went in', got(freeOne.sessionId))
    await shot(p, `${tag}busy-queued-for-dictations-light-1440`)
    ok(errors.length === 0, 'Dictations: no page errors', errors)
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
