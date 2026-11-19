// Bots, Phase 2 (bots-spec §5.5, §5.7–5.8, §6.7, §6.9): approvals in your Slack direct messages,
// memory, commands, limits and pause, and the public-channel check, with the stand-in Slack and
// Claude Code (stand-ins/slack.mjs, stand-ins/helper-claude.cjs), in the browser named by
// BRIDGE_TEST_BROWSER.
//   With "You in Slack" set, a draft comes to your Slack DM with Send, Edit and Discard: ⏳ on the
//   question at once, "I'm checking this with you" only once it has waited (D8); Send from Slack
//   (as on a phone) posts it, ✅ on and ⏳ off, the DM saying it went; someone else's press does
//   nothing but tell them; Edit opens Slack's modal with the draft, and what you send is traced and
//   offered as a learning; Discard; one decided in Bridge AI is settled in the DM too; one nothing
//   could answer comes to the DM to write.
//   Memory: "remember that…" proposed, not used in another thread until you keep it (from Slack),
//   then used; a REMEMBER line from the agent proposed and taken out of the draft; kept, edited and
//   deleted in Settings; straight away or off as you choose; "!what do you know about me" says it to
//   them only.
//   Commands: !help, !status, !mute and !unmute, !stop on a running answer, and !forget me (D3):
//   their memory gone, their words blanked in the record while the record that they asked stays,
//   the chain still whole, the transcripts of their conversations deleted.
//   Limits per person (a day, at once: the next waits its turn, a run's longest: stopped and passed
//   to you), and pause, which stops a running answer at once and passes questions to you.
//   Answering without asking: for a public channel, an answer that quotes one of its files waits for
//   you; in a private channel, or not quoting, it goes.
//   A direct message's earlier turns given from the record, as sent; each person's running context,
//   kept straight away, given only for them (what was said in a direct message, only there), none
//   with memory off, and none once you forget them.
//   All of it in the record and its export; Settings in light and dark, on a computer and a phone.
import fs from 'node:fs'
import path from 'node:path'
import { checks, until, sleep, browser, page, shot, phoneFaults, IS_WIN } from '../lib/harness.mjs'
import { botKit, openSettings, M, OWNER } from '../lib/bots.mjs'

const { ok, done } = checks('bots-approvals')
const HOLD = 4000 // how long a draft waits before "I'm checking this" (BRIDGE_BOT_HOLD_MS)
const MINUTE = 3000 // a "minute", for the longest run (BRIDGE_BOT_MINUTE_MS)
const { slack, kit, draftOf, startOf, startsOf, briefOf, logOf, botOf, connected, convs, timelineOf, events, posted, postedLike, reacted } = await botKit('bots-approvals', {
  folders: ['notes'], env: { BRIDGE_BOT_HOLD_MS: String(HOLD), BRIDGE_BOT_MINUTE_MS: String(MINUTE) },
})
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const FAQ = path.join(kit.home, 'notes', 'faq.md')
fs.writeFileSync(FAQ, '# FAQ\n\nSupport is open from nine in the morning to five in the evening on weekdays, and closed on public holidays.\n')
const state = () => slack.state()
const dmOf = async (words) => (await state()).posted.filter((x) => x.channel === 'D0OWNER' && JSON.stringify(x.blocks || []).includes(words)).at(-1) || null
const actionsOf = (m) => (m?.blocks || []).flatMap((x) => x.elements || []).filter((e) => e.type === 'button').map((e) => `${e.action_id}:${e.value}`)
const updatedOf = async (ts) => (await state()).updated.filter((x) => x.ts === ts).at(-1) || null
const inThread = async (ts) => (await posted()).filter((x) => x.thread_ts === ts)
const mem = async () => (await kit.api('/bots/b1/memory')).items

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/agents/catalog')
  await kit.api('/bots', { name: 'Helpdesk' })
  await kit.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await kit.api('/bots/b1/settings', { answerIn: 'thread', askers: [{ id: 'U0DANA', name: 'Dana' }, { id: 'U0SAM', name: 'Sam' }], readsFrom: ['~/notes'] })
  ok(!!(await connected()), 'a bot, connected')
  const guess = await until(async () => (await botOf()).ownerGuess, 10000)
  ok(guess?.id === OWNER.id, 'it offers the member with your name as you in Slack', guess)
  await kit.api('/bots/b1/settings', { owner: guess })
  ok((await botOf()).settings.owner?.id === OWNER.id, 'You in Slack: set')

  // ---------- A draft in your Slack DM ----------
  await part('approvals in Slack', async () => {
    const q1 = await slack.ask({ user: 'U0DANA', text: `${M} When is support open? [answer From 9 to 5.]` })
    const d1 = await draftOf('support open')
    ok(!!(await until(() => reacted(q1.ts, 'hourglass_flowing_sand'), 8000)), '⏳ on the question as soon as its draft waits')
    const dm1 = await until(() => dmOf('When is support open'), 10000)
    ok(!!dm1 && actionsOf(dm1).join() === `bb_send:${d1.id},bb_edit:${d1.id},bb_discard:${d1.id}` && /From 9 to 5/.test(JSON.stringify(dm1.blocks)) && /Dana/.test(JSON.stringify(dm1.blocks)), 'the draft in your Slack DM: who asked, the question, the draft, and Send, Edit and Discard', dm1 && { text: dm1.text, actions: actionsOf(dm1) })
    ok(!!(await until(async () => ((await kit.api('/needs-you')).slack || []).find((x) => x.id === d1.id)?.ownerAsked, 8000)), 'Needs You says it\'s in your Slack DM too')
    ok(!(await inThread(q1.ts)).some((x) => /checking this/.test(x.text)), '(no holding reply at once)')
    const hold = await until(async () => (await inThread(q1.ts)).find((x) => /checking this/.test(x.text)), HOLD + 10000)
    ok(hold?.text === 'I\'m checking this with Tester.', '"I\'m checking this with Tester" once it has waited (D8)', hold)
    // Someone else pressing Send: nothing, but they're told.
    await slack.click({ user: 'U0SAM', action_id: 'bb_send', value: d1.id })
    const told = await until(async () => (await state()).ephemeral.find((x) => x.user === 'U0SAM' && /Only Tester/.test(x.text)), 8000)
    ok(!!told && !(await inThread(q1.ts)).some((x) => x.text === 'From 9 to 5.'), 'someone else\'s Send does nothing, and tells them only Tester decides', told)
    // You, from Slack on your phone.
    await slack.click({ user: OWNER.id, action_id: 'bb_send', value: d1.id })
    const sent = await until(async () => (await inThread(q1.ts)).find((x) => x.text === 'From 9 to 5.'), 15000)
    ok(!!sent && sent.app === 'A1', 'Send from your Slack DM: the answer goes in the question\'s thread', sent)
    ok(!!(await until(async () => (await reacted(q1.ts, 'white_check_mark')) && !(await reacted(q1.ts, 'hourglass_flowing_sand')) && !(await reacted(q1.ts, 'eyes')), 8000)), '✅ on, ⏳ and 👀 off')
    ok(/Sent by Tester/.test((await until(() => updatedOf(dm1.ts), 8000))?.text || ''), 'and the DM says it went, and who sent it', await updatedOf(dm1.ts))
    const t1 = await timelineOf('b1', 'support open')
    ok(t1.some((e) => e.type === 'approval.asked' && e.via === 'slack' && e.channel === 'D0OWNER') && t1.some((e) => e.type === 'sent' && e.kind === 'answer' && e.how === 'approved' && e.by === 'Tester' && e.via === 'slack') && t1.filter((e) => e.type === 'sent' && e.kind === 'checking').length === 1, 'its record: asked in your DM, sent by you from Slack, the holding reply once', t1.map((e) => `${e.type}${e.kind ? `:${e.kind}` : ''}${e.via ? `/${e.via}` : ''}`))

    // Edit, in Slack's modal.
    const q2 = await slack.ask({ user: 'U0DANA', text: `${M} Where is the office? [answer In Dallas.]` })
    const d2 = await draftOf('Where is the office')
    await until(() => dmOf('Where is the office'), 10000)
    await slack.click({ user: OWNER.id, action_id: 'bb_edit', value: d2.id })
    const modal = await until(async () => (await state()).views.find((v) => v.kind === 'open' && v.view?.callback_id === 'bb_edit' && String(v.view.private_metadata).includes(d2.id)), 8000)
    const initial = JSON.stringify(modal?.view?.blocks || [])
    ok(/In Dallas\./.test(initial), 'Edit opens Slack\'s modal with the draft in it', modal?.view?.blocks)
    await slack.submit({ user: OWNER.id, callback_id: 'bb_edit', private_metadata: modal.view.private_metadata, values: { reply: { text: 'In Austin, on 5th Street.' } } })
    ok(!!(await until(async () => (await inThread(q2.ts)).find((x) => x.text === 'In Austin, on 5th Street.'), 15000)), 'what you wrote there is sent')
    const t2 = await timelineOf('b1', 'Where is the office')
    const edit = t2.find((e) => e.type === 'draft.edited')
    ok(edit?.before === 'In Dallas.' && edit.after === 'In Austin, on 5th Street.' && edit.by === 'Tester' && edit.via === 'slack', 'your edit is in the record, before and after, from Slack', edit)
    const learned = (await mem()).find((x) => x.source === 'edit' && /In Austin, on 5th Street/.test(x.text))
    ok(learned?.state === 'proposed' && t2.some((e) => e.type === 'memory.proposed'), 'and offered as a learning, waiting for you', learned)

    // Discard, from Slack.
    const q3 = await slack.ask({ user: 'U0DANA', text: `${M} Is there parking? [answer Yes, plenty.]` })
    const d3 = await draftOf('Is there parking')
    const dm3 = await until(() => dmOf('Is there parking'), 10000)
    await slack.click({ user: OWNER.id, action_id: 'bb_discard', value: d3.id })
    ok(!!(await until(async () => (await convs('b1', 'parking'))[0]?.outcome === 'discarded', 10000)) && !(await inThread(q3.ts)).some((x) => /plenty/.test(x.text)), 'Discard from Slack: nothing sent')
    ok(/Discarded/.test((await until(() => updatedOf(dm3.ts), 8000))?.text || '') && !!(await until(async () => !(await reacted(q3.ts, 'hourglass_flowing_sand')), 8000)), 'the DM says so, and ⏳ comes off')

    // Decided in Bridge AI: the DM is settled too.
    await slack.ask({ user: 'U0DANA', text: `${M} Who runs support? [answer Sam does.]` })
    const d4 = await draftOf('Who runs support')
    const dm4 = await until(() => dmOf('Who runs support'), 10000)
    await kit.api(`/bots/questions/${d4.id}`, { send: true, text: d4.draft })
    ok(/Sent by Tester/.test((await until(() => updatedOf(dm4.ts), 10000))?.text || ''), 'sent from Needs You: the DM says it went too')

    // Nothing could answer it: in your DM to write.
    const q5 = await slack.ask({ user: 'U0DANA', text: `${M} What is the wifi password? [noanswer]` })
    const d5 = await draftOf('wifi password')
    const dm5 = await until(() => dmOf('wifi password'), 10000)
    ok(d5.needsOwner && actionsOf(dm5).includes(`bb_edit:${d5.id}`) && /Nothing could answer it/.test(JSON.stringify(dm5.blocks)), 'one nothing could answer comes to your DM, to write the reply', dm5 && JSON.stringify(dm5.blocks).slice(0, 400))
    await slack.click({ user: OWNER.id, action_id: 'bb_edit', value: d5.id })
    const m5 = await until(async () => (await state()).views.find((v) => v.kind === 'open' && String(v.view?.private_metadata).includes(d5.id)), 8000)
    await slack.submit({ user: OWNER.id, callback_id: 'bb_edit', private_metadata: m5.view.private_metadata, values: { reply: { text: 'Ask Sam at the front desk.' } } })
    ok(!!(await until(async () => (await inThread(q5.ts)).find((x) => x.text === 'Ask Sam at the front desk.'), 15000)), 'and what you write there goes in its thread')
  })

  // ---------- Memory ----------
  await part('memory', async () => {
    const taught = await slack.ask({ user: 'U0DANA', text: `${M} remember that the Austin office closes at 4 on Fridays` })
    const ack = await until(async () => (await inThread(taught.ts)).find((x) => /remember that/.test(x.text)), 10000)
    ok(ack?.text === 'Got it: I\'ll remember that once Tester says so.' && !startsOf('Austin office closes').length, '"remember that…": proposed, they\'re told it\'s kept once you say so, and no agent runs', ack)
    const item = (await mem()).find((x) => /Austin office closes/.test(x.text))
    ok(item?.state === 'proposed' && item.kind === 'channel' && item.of === 'C0LAUNCH' && item.source === 'asked', 'a learning about the channel, waiting for you', item)
    const dmm = await until(() => dmOf('Austin office closes'), 10000)
    ok(actionsOf(dmm).join() === `bb_keep:b1/${item.id},bb_drop:b1/${item.id}`, 'in your DM to keep or discard', actionsOf(dmm))
    // Another thread, before you keep it: not used.
    await slack.ask({ user: 'U0DANA', text: `${M} When does Austin close on Fridays? [recall] [answer That's all.]` })
    const before = await draftOf('Austin close on Fridays')
    ok(/^I remember nothing\./.test(before?.draft || ''), 'asked in another thread before you keep it: it isn\'t given', before?.draft)
    await kit.api(`/bots/questions/${before.id}`, { send: false })
    await slack.click({ user: OWNER.id, action_id: 'bb_keep', value: `b1/${item.id}` })
    ok(!!(await until(async () => (await mem()).find((x) => x.id === item.id)?.state === 'kept', 10000)), 'Keep, from your DM: kept')
    ok(/Kept/.test((await until(() => updatedOf(dmm.ts), 8000))?.text || ''), 'and the DM says so')
    await slack.ask({ user: 'U0DANA', text: `${M} What time does Austin close on a Friday? [recall] [answer That's all.]` })
    const after = await draftOf('Austin close on a Friday')
    ok(/the Austin office closes at 4 on Fridays/.test(after?.draft || ''), 'once kept, it\'s used in another thread', after?.draft)
    const run = (await timelineOf('b1', 'Austin close on a Friday')).find((e) => e.type === 'run.started')
    ok(run?.memory?.includes(item.id), 'and the run says which memory it was given', run?.memory)
    await kit.api(`/bots/questions/${after.id}`, { send: false })
    // A REMEMBER line from its agent: proposed, and taken out of the draft.
    await slack.ask({ user: 'U0DANA', text: `${M} Can you keep answers short? [remember-me Dana prefers short answers] [answer Will do.]` })
    const short = await draftOf('keep answers short')
    const pref = await until(async () => (await mem()).find((x) => /prefers short answers/.test(x.text)), 8000)
    ok(short?.draft === 'Will do.' && pref?.kind === 'person' && pref.of === 'U0DANA' && pref.ofName === 'Dana' && pref.source === 'remember' && pref.state === 'proposed', 'a REMEMBER line from its agent: a learning about Dana, out of the draft', { draft: short?.draft, pref })
    await kit.api(`/bots/questions/${short.id}`, { send: false })
    // Kept, edited and deleted in Settings (the API under it here; the page below).
    await kit.api(`/bots/b1/memory/${pref.id}`, { keep: true }, 'PATCH')
    await kit.api(`/bots/b1/memory/${pref.id}`, { text: 'Dana prefers short answers, in bullet points' }, 'PATCH')
    const added = await kit.api('/bots/b1/memory', { kind: 'bot', text: 'Support moved to the third floor in October.' })
    await kit.api(`/bots/b1/memory/${added.id}`, null, 'DELETE')
    const evs = events()
    ok(evs.some((e) => e.type === 'memory.kept' && e.item?.id === pref.id && e.by === 'Tester') && evs.some((e) => e.type === 'memory.edited' && e.before === 'Dana prefers short answers' && e.item?.text === 'Dana prefers short answers, in bullet points') && evs.some((e) => e.type === 'memory.deleted' && e.item?.id === added.id), 'kept, edited and deleted from Settings, each in the record')
    // !what do you know about me: to them only.
    const asked = await slack.ask({ user: 'U0DANA', text: `${M} !what do you know about me` })
    const priv = await until(async () => (await state()).ephemeral.find((x) => x.user === 'U0DANA' && /bullet points/.test(x.text)), 10000)
    ok(!!priv && !(await inThread(asked.ts)).some((x) => /bullet points/.test(x.text)), '!what do you know about me: what it remembers about them, seen only by them', priv)
    // Straight away, and off.
    await kit.api('/bots/b1/settings', { memory: 'auto' })
    const t2 = await slack.ask({ user: 'U0SAM', text: `${M} remember that I lead the support team` })
    ok((await until(async () => (await inThread(t2.ts)).find((x) => /remember that/.test(x.text)), 10000))?.text === 'Got it: I\'ll remember that.' && (await mem()).find((x) => /lead the support team/.test(x.text))?.state === 'kept', 'kept straight away, when you said so: about Sam', (await mem()).find((x) => /lead the support team/.test(x.text)))
    await kit.api('/bots/b1/settings', { memory: 'off' })
    const t3 = await slack.ask({ user: 'U0SAM', text: `${M} remember that the coffee machine is broken` })
    ok((await until(async () => (await inThread(t3.ts)).find((x) => /between conversations/.test(x.text)), 10000)) && !(await mem()).some((x) => /coffee/.test(x.text)), 'off: nothing kept, and they\'re told')
    await slack.ask({ user: 'U0SAM', text: `${M} What do you know of Austin? [recall] [answer That's all.]` })
    const off = await draftOf('know of Austin')
    ok(/^I remember nothing\./.test(off?.draft || ''), 'and nothing it kept before is given', off?.draft)
    await kit.api(`/bots/questions/${off.id}`, { send: false })
    await kit.api('/bots/b1/settings', { memory: 'approve' })
  })

  // ---------- Commands ----------
  await part('commands', async () => {
    const h = await slack.ask({ user: 'U0SAM', text: `${M} !help` })
    const help = await until(async () => (await inThread(h.ts))[0], 10000)
    ok(/I'm Helpdesk, Tester's bot/.test(help?.text || '') && /\/helpdesk/.test(help.text) && /!forget me/.test(help.text), '!help: what it is, whose, how to ask it (/helpdesk too) and its commands', help?.text)
    const s = await slack.ask({ user: 'U0SAM', text: `${M} !status` })
    ok(/Connected, from Tester's computer\. Answering 0 now/.test((await until(async () => (await inThread(s.ts))[0], 10000))?.text || ''), '!status: connected, and its queue')
    const mu = await slack.ask({ user: 'U0SAM', text: `${M} !mute` })
    ok(/Muted in #launch/.test((await until(async () => (await inThread(mu.ts))[0], 10000))?.text || '') && (await botOf()).settings.muted.some((x) => x.id === 'C0LAUNCH'), '!mute: muted in this channel, a setting you see')
    const n0 = logOf('helpers-started.log').length
    const quiet = await slack.ask({ user: 'U0DANA', text: `${M} Are you there? [answer Yes.]` })
    ok(!!(await until(async () => (await state()).ephemeral.find((x) => x.user === 'U0DANA' && /muted in this channel/.test(x.text)), 10000)), 'muted: a question gets only a word to the asker on how to turn it back on')
    await sleep(1500)
    ok(logOf('helpers-started.log').length === n0 && !(await inThread(quiet.ts)).length && (await convs('b1', 'Are you there'))[0]?.refused === 'muted', 'no agent, nothing posted, and its record says muted')
    const un = await slack.ask({ user: 'U0SAM', text: `${M} !unmute` })
    ok(/Back on in #launch/.test((await until(async () => (await inThread(un.ts))[0], 10000))?.text || '') && !(await botOf()).settings.muted.length, '!unmute: back on')
    // !stop, on an answer still running.
    const long = await slack.ask({ user: 'U0SAM', text: `${M} Summarize every FAQ entry [work 30] [answer Done.]` })
    await startOf('Summarize every FAQ entry')
    const going = await until(async () => (await kit.api('/fleet?all=1')).agents.find((a) => a.helper?.list === 'desk' && a.status === 'working'), 10000)
    await slack.ask({ user: 'U0SAM', thread: long.ts, text: `${M} !stop` })
    const stopped = await until(async () => (await inThread(long.ts)).find((x) => x.text === 'Stopped.'), 15000)
    const tl = await timelineOf('b1', 'Summarize every FAQ entry')
    ok(!!stopped && tl.some((e) => e.type === 'run.finished' && e.end === 'stopped' && e.why === '!stop' && e.by === 'Sam'), '!stop: the answer running in that thread is stopped, and said', tl.filter((e) => e.type === 'run.finished'))
    ok(!!going && !!(await until(async () => !(await kit.api('/fleet?all=1')).agents.some((a) => a.paneId === going?.paneId), 10000)), 'its agent\'s tab is closed')

    // !forget me (D3).
    const runsDir = path.join(kit.data, 'bots', 'b1', 'trace', 'runs')
    const theirs = events().filter((e) => e.type === 'run.finished' && e.transcript?.file && events().some((x) => x.type === 'received' && x.q === e.q && x.person?.id === 'U0DANA'))
    ok(theirs.length > 0 && theirs.every((e) => fs.existsSync(path.join(kit.data, 'bots', 'b1', 'trace', e.transcript.file))), 'each answering agent\'s transcript is kept beside the record (D4)', theirs.map((e) => e.transcript))
    const before = events().filter((e) => e.person?.id === 'U0DANA' && e.text)
    const f = await slack.ask({ user: 'U0DANA', text: `${M} !forget me` })
    const bye = await until(async () => (await inThread(f.ts))[0], 10000)
    ok(/I've deleted what I remembered about you/.test(bye?.text || ''), '!forget me: they\'re told what it did', bye?.text)
    const after = events()
    const hers = after.filter((e) => e.person?.id === 'U0DANA' && e.type === 'received')
    ok(before.length > 3 && hers.length >= before.filter((e) => e.type === 'received').length && hers.every((e) => e.text === null && /^[0-9a-f]{64}$/.test(e.blanked?.text || '')), 'her words are blanked in the record, a hash kept in their place; that she asked stays', hers.slice(0, 2))
    ok(!after.some((e) => (e.messages || []).some((m) => m.person?.id === 'U0DANA' && m.text)), 'and so are her words read as context in others\' questions')
    ok(!JSON.stringify(after).includes('Austin, on 5th Street') || after.filter((e) => JSON.stringify(e).includes('Austin, on 5th Street')).every((e) => e.person?.id !== 'U0DANA'), '(your words to her stay: they\'re yours)')
    ok(!(await mem()).some((x) => x.kind === 'person' && x.of === 'U0DANA'), 'what it remembered about her is gone')
    const gone = after.find((e) => e.type === 'forgotten')
    ok(gone?.person?.id === 'U0DANA' && gone.memory === 1 && gone.events > 3 && gone.transcripts >= theirs.length && theirs.every((e) => !fs.existsSync(path.join(kit.data, 'bots', 'b1', 'trace', e.transcript.file)) && !fs.existsSync(path.join(kit.data, 'bots', 'b1', 'trace', `${e.transcript.file}.gz`))), 'the record says what it did, and the transcripts of her conversations are deleted', { gone, left: fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : [] })
    const integrity = (await kit.api('/bots/b1/activity')).integrity
    ok(integrity?.ok && integrity.blanked > 3, 'and the record\'s chain still holds', integrity)
    ok((await convs('b1')).some((c) => c.from?.id === 'U0DANA' && !c.asked), 'Activity still lists her conversations, without her words')
  })

  // ---------- Limits per person, and pause ----------
  await part('limits and pause', async () => {
    await kit.api('/bots/b1/settings', { limits: { day: 40, atOnce: 1, minutes: 2 } })
    const a = await slack.ask({ user: 'U0SAM', text: `${M} First of two [work 2] [answer One.]` })
    await startOf('First of two')
    await slack.ask({ user: 'U0SAM', text: `${M} Second of two [answer Two.]` })
    const queued = await until(async () => events().find((e) => e.type === 'queued' && /Second of two/.test(events().find((x) => x.q === e.q && x.type === 'received')?.text || '')), 8000)
    ok(!!queued && !startsOf('Second of two').length, 'over what one person may have answered at once: the next waits its turn', queued)
    await startOf('Second of two', 20000)
    const first = (await timelineOf('b1', 'First of two')).find((e) => e.type === 'run.finished')
    const second = (await timelineOf('b1', 'Second of two')).find((e) => e.type === 'run.started')
    ok(!!first && !!second && second.at >= first.at, 'and starts once the first is done', { first: first?.at, second: second?.at })
    await kit.api(`/bots/questions/${(await draftOf('First of two')).id}`, { send: false })
    await kit.api(`/bots/questions/${(await draftOf('Second of two')).id}`, { send: false })
    void a
    // The longest run.
    const slow = await slack.ask({ user: 'U0SAM', text: `${M} Read everything slowly [work 40] [answer Finally.]` })
    const timed = await draftOf('Read everything slowly', 30000)
    const end = (await timelineOf('b1', 'Read everything slowly')).find((e) => e.type === 'run.finished')
    ok(timed?.needsOwner && /ran for 2 minutes, the longest a run may take/.test(timed.why || '') && end?.end === 'timeout', 'past its longest run: stopped, and passed to you, saying why', { why: timed?.why, end })
    ok(!!(await until(async () => (await inThread(slow.ts)).find((x) => /passed this on/.test(x.text)), 8000)), 'the asker hears it\'s passed on')
    await kit.api(`/bots/questions/${timed.id}`, { send: false })
    // A day's limit.
    await kit.api('/bots/b1/settings', { limits: { day: 1, atOnce: 2, minutes: 10 } })
    const n0 = logOf('helpers-started.log').length
    const over = await slack.ask({ user: 'U0SAM', text: `${M} One more thing? [answer Sure.]` })
    const said = await until(async () => (await inThread(over.ts)).find((x) => /questions today/.test(x.text)), 10000)
    ok(/You've asked me 1 questions today/.test(said?.text || '') && logOf('helpers-started.log').length === n0 && (await convs('b1', 'One more thing'))[0]?.refused === 'over-limit', 'over a day\'s limit: told so, no agent, refused in the record', said?.text)
    await kit.api('/bots/b1/settings', { limits: { day: 30, atOnce: 2, minutes: 10 } })
    // Pause: an answer running is stopped at once.
    const p1 = await slack.ask({ user: 'U0SAM', text: `${M} A long look at the FAQ [work 30] [answer Long.]` })
    await startOf('A long look at the FAQ')
    await sleep(500)
    await kit.api('/bots/b1/settings', { paused: true })
    const paused = await draftOf('A long look at the FAQ', 10000)
    ok(paused?.needsOwner && /paused while it answered/.test(paused.why || '') && (await timelineOf('b1', 'A long look')).some((e) => e.type === 'run.finished' && e.end === 'stopped' && e.why === 'paused'), 'paused: the answer running stops at once, and comes to you', paused?.why)
    ok(!!(await until(async () => (await inThread(p1.ts)).find((x) => /passed this on/.test(x.text)), 8000)), 'its asker is told it\'s passed on')
    const n1 = logOf('helpers-started.log').length
    await slack.ask({ user: 'U0SAM', text: `${M} Anyone home? [answer Yes.]` })
    const home = await draftOf('Anyone home', 10000)
    ok(home?.needsOwner && /is paused/.test(home.why || '') && logOf('helpers-started.log').length === n1 && (await timelineOf('b1', 'Anyone home')).some((e) => e.type === 'refused' && e.why === 'paused'), 'while paused, a question goes to you and no agent starts', home?.why)
    await kit.api('/bots/b1/settings', { paused: false })
    for (const d of [paused, home]) await kit.api(`/bots/questions/${d.id}`, { send: false })
  })

  // ---------- Answering without asking, and public channels ----------
  await part('the public-channel check', async () => {
    await kit.api('/bots/b1/settings', { auto: true })
    await slack.ask({ user: 'U0SAM', text: `${M} Quote me the support hours [quote faq.md]` })
    const held = await draftOf('Quote me the support hours')
    ok(held && !held.auto && /quotes ~[/\\]notes[/\\]faq\.md in #launch, a public channel, so it waits for you/.test(held.warn || ''), 'for a public channel, an answer that quotes one of its files waits for you, even answering without asking', held?.warn)
    ok(!!(await until(() => dmOf('Quote me the support hours'), 10000)), 'and comes to your DM')
    await kit.api(`/bots/questions/${held.id}`, { send: false })
    const priv = await slack.ask({ user: 'U0SAM', channel: 'C0PRIV', text: `${M} Quote the support hours here [quote faq.md]` })
    ok(!!(await until(async () => (await posted()).find((x) => x.channel === 'C0PRIV' && x.thread_ts === priv.ts && /nine in the morning/.test(x.text)), 30000)), 'in a private channel, the same answer goes without asking')
    const plain = await slack.ask({ user: 'U0SAM', text: `${M} When is support open, roughly? [answer Weekdays, nine to five.]` })
    ok(!!(await until(async () => (await inThread(plain.ts)).find((x) => /Weekdays, nine to five/.test(x.text)), 30000)), 'and in a public channel, one that quotes nothing goes too')
    await kit.api('/bots/b1/settings', { auto: false })
  })

  // ---------- What your agents are doing (agentsStatus) ----------
  await part('your agents', async () => {
    const launched = await kit.api('/agents/launch', { kind: 'claude', cwd: path.join(kit.home, 'notes'), label: 'Notes review', newSpace: 'Notes', prompt: '[work 1] [file review.md] Review the notes.' })
    await until(async () => (await kit.api('/fleet')).agents.find((x) => x.paneId === launched.paneId && x.sessionId), 20000)
    await slack.ask({ user: 'U0SAM', text: `${M} What are the agents up to? [agents] [answer That's all.]` })
    const off = await draftOf('agents up to')
    ok(/^No agents said\./.test(off?.draft || ''), 'off to start: it isn\'t told what your agents are doing', off?.draft)
    await kit.api(`/bots/questions/${off.id}`, { send: false })
    await kit.api('/bots/b1/settings', { agentsStatus: true })
    await slack.ask({ user: 'U0SAM', text: `${M} And now, what are the agents doing? [agents] [answer That's all.]` })
    const on = await draftOf('what are the agents doing')
    ok(/- "Notes review" \(Claude Code\) in ~[/\\]notes: (working|finished|idle)/.test(on?.draft || ''), 'on: their names, folders and how they stand, and nothing of their conversations', on?.draft)
    await kit.api(`/bots/questions/${on.id}`, { send: false })
    await kit.api('/bots/b1/settings', { agentsStatus: false })
  })

  // ---------- A direct message's turns, and each person's running context ----------
  // (Each question its own conversation here: BRIDGE_BOT_CARRY_MS 0, so what was said before comes
  // from the record, not from going on in the agent's own conversation.)
  await part('running context', async () => {
    try { await context() } finally { await kit.api('/bots/b1/settings', { memory: 'approve', limits: { day: 30, atOnce: 2, minutes: 10 } }) }
  })
  async function context() {
    await kit.api('/bots/b1/settings', { memory: 'auto', limits: { day: 200, atOnce: 2, minutes: 10 } })
    const people = () => { try { return JSON.parse(fs.readFileSync(path.join(kit.data, 'bots', 'b1', 'people.json'), 'utf8')).people } catch { return {} } }
    const earlier = (x) => (/----- earlier conversations -----([\s\S]*?)----- end of earlier conversations -----/.exec(briefOf(x)) || [])[1] ?? null
    const send = async (words, text) => { const d = await draftOf(words); await kit.api(`/bots/questions/${d.id}`, { send: true, ...(text ? { text } : {}) }); return d }
    await slack.ask({ user: 'U0DANA', dm: true, text: 'Which floor is support on? [answer The third floor.]' })
    await send('Which floor is support on', 'The third floor, by the lifts.')
    await postedLike(/by the lifts/)
    // (Your edit is offered as a learning of its own, kept at once here: not what this is about.)
    for (const x of (await mem()).filter((y) => y.source === 'edit' && /Which floor/.test(y.text))) await kit.api(`/bots/b1/memory/${x.id}`, null, 'DELETE')
    await slack.ask({ user: 'U0DANA', dm: true, text: 'Is it open at lunch? [answer Yes, all day.]' })
    const s2 = await startOf('Is it open at lunch')
    ok(/----- earlier turns -----\nDana: Which floor is support on\? \[answer The third floor\.\]\nyou \(Helpdesk\): The third floor, by the lifts\.\n----- end of earlier turns -----/.test(briefOf(s2)) && !s2.args.join(' ').includes('--fork-session'), 'a direct message, one running conversation: its earlier turns given from the record, the answer as it was sent', briefOf(s2).slice(0, 1600))
    await send('Is it open at lunch')
    const lunch = await postedLike(/Yes, all day/)
    ok(lunch?.channel === 'D0DANA' && !lunch.thread_ts, 'answered plainly in the direct message', lunch)
    ok(people().U0DANA?.kept.length === 2 && people().U0DANA.kept.every((x) => x.where?.kind === 'dm' && x.where.private) && events().some((e) => e.type === 'context.noted' && e.person?.id === 'U0DANA' && e.state === 'kept'), 'kept straight away in her running context: her words and its answers, marked private', people().U0DANA)
    // Asked in a public channel: what she said in her direct messages isn't given there.
    await slack.ask({ user: 'U0DANA', text: `${M} Where do I get a badge? [answer At reception.]` })
    const s3 = await startOf('Where do I get a badge')
    ok(earlier(s3) === null && !/third floor/.test(briefOf(s3)), 'in a channel, nothing from her direct messages', briefOf(s3).slice(0, 1200))
    await send('Where do I get a badge')
    await postedLike(/At reception/)
    // Someone else: never hers.
    await slack.ask({ user: 'U0SAM', dm: true, text: 'What is the wifi called? [answer Acme-Guest.]' })
    const s4 = await startOf('wifi called')
    ok(!/third floor|by the lifts|badge|At reception|Which floor/.test(briefOf(s4)), 'Sam\'s question: none of Dana\'s running context', briefOf(s4).slice(0, 1200))
    await send('wifi called')
    await postedLike(/Acme-Guest/)
    // Hers, when she asks again: what she said where others could read it, besides this conversation's turns.
    await slack.ask({ user: 'U0DANA', dm: true, text: 'Anything else I should know? [answer No.]' })
    const s5 = await startOf('Anything else I should know')
    ok(/Where do I get a badge\?[\s\S]*At reception\./.test(earlier(s5) || '') && !/Acme-Guest|wifi/.test(briefOf(s5)) && /They're Dana's alone/.test(briefOf(s5)), 'Dana again: given her earlier conversation in #launch, as hers alone, and nothing of Sam\'s', earlier(s5))
    ok((await timelineOf('b1', 'Anything else I should know')).find((e) => e.type === 'run.started')?.earlier?.person === 1, 'and the run says what it was given', (await timelineOf('b1', 'Anything else I should know')).find((e) => e.type === 'run.started')?.earlier)
    await kit.api(`/bots/questions/${(await draftOf('Anything else I should know')).id}`, { send: false })
    // Memory off: none given, none kept.
    await kit.api('/bots/b1/settings', { memory: 'off' })
    const had = people().U0DANA.kept.length
    await slack.ask({ user: 'U0DANA', dm: true, text: 'One more question? [answer Go ahead.]' })
    const s6 = await startOf('One more question')
    ok(earlier(s6) === null, 'memory off: no running context given', briefOf(s6).slice(0, 1200))
    const d6 = await send('One more question')
    await postedLike(/Go ahead/)
    await sleep(800)
    ok(people().U0DANA.kept.length === had && !events().some((e) => e.type === 'context.noted' && e.q === d6.id), 'and none kept')
    // Forgotten, by you: gone, and not given again; Sam's untouched.
    await kit.api('/bots/b1/settings', { memory: 'auto' })
    const f = await kit.api('/bots/b1/people/U0DANA/forget', {})
    ok(f.context === null && !people().U0DANA && people().U0SAM?.kept.length >= 1 && events().some((e) => e.type === 'context.forgotten' && e.person?.id === 'U0DANA' && e.by === 'Tester'), 'forgetting Dana: hers gone, in the record; Sam\'s still kept', Object.keys(people()))
    await slack.ask({ user: 'U0DANA', text: `${M} Last one: where is the kitchen? [answer Next to support.]` })
    const s7 = await startOf('where is the kitchen')
    ok(earlier(s7) === null && !/you answered “At reception/.test(briefOf(s7)), 'and her next question is given none of it (only the channel\'s own messages, as anyone\'s is)', briefOf(s7).slice(0, 1200))
    await kit.api(`/bots/questions/${(await draftOf('where is the kitchen')).id}`, { send: false })
  }

  // ---------- No secrets, and transcripts gzipped after a month ----------
  const started = logOf('helpers-started.log')
  ok(started.length > 10 && started.every((x) => !x.secrets?.length && !JSON.stringify(x.args).match(/xox[bp]-|xapp-/)), 'no answering agent was ever given a Slack token, in its environment or on its command line', started.filter((x) => x.secrets?.length).map((x) => x.secrets))
  const runsDir = path.join(kit.data, 'bots', 'b1', 'trace', 'runs')
  const month = fs.readdirSync(runsDir)[0]
  const oneRun = fs.readdirSync(path.join(runsDir, month)).find((f) => f.endsWith('.jsonl'))
  const old = new Date(Date.now() - 40 * 86400000)
  fs.utimesSync(path.join(runsDir, month, oneRun), old, old)
  await kit.api('/bots/b1/settings', { retention: '90d' })
  await kit.api('/bots/b1/settings', { retention: '1y' })
  ok(!fs.existsSync(path.join(runsDir, month, oneRun)) && fs.existsSync(path.join(runsDir, month, `${oneRun}.gz`)), 'a kept transcript a month old is gzipped (D4)', fs.readdirSync(path.join(runsDir, month)).slice(0, 5))

  // ---------- All of it in the record ----------
  const types = new Set(events().map((e) => e.type))
  const want = ['approval.asked', 'memory.proposed', 'memory.kept', 'memory.edited', 'memory.deleted', 'forgotten', 'queued', 'stopped', 'status', 'refused', 'settings.changed', 'draft.edited']
  ok(want.every((x) => types.has(x)), 'each new kind of event is in its record', { missing: want.filter((x) => !types.has(x)) })
  ok(['muted', 'paused', 'over-limit'].every((w) => events().some((e) => e.type === 'refused' && e.why === w)), 'refusals say why: muted, paused, over the limit')
  const csv = await fetch(`${kit.url}/api/bots/b1/export?format=csv`).then((r) => r.text())
  ok(/,forgotten,/.test(csv) && /,memory\.kept,/.test(csv) && /,approval\.asked,/.test(csv) && /\(forgotten\)/.test(csv), 'and in its export, her words shown as forgotten', csv.split('\n').filter((l) => /forgotten/.test(l)).slice(0, 3))
  ok((await kit.api('/bots/b1/activity')).integrity?.ok, 'its record whole at the end')
  const tokens = path.join(kit.data, 'bots', 'b1', 'memory.json')
  ok(IS_WIN || (fs.statSync(tokens).mode & 0o777) === 0o600, 'what it remembers is kept readable by you only', IS_WIN ? null : (fs.statSync(tokens).mode & 0o777).toString(8))

  // ---------- Settings, in light and dark, on a computer and a phone ----------
  await slack.ask({ user: 'U0SAM', text: `${M} remember that the printer is on floor 2` })
  await until(async () => (await mem()).some((x) => /printer/.test(x.text)), 8000)
  for (const [mode, theme, phone] of [['light', 'sky', false], ['dark', 'midnight', false], ['light', 'sky', true], ['dark', 'midnight', true]]) {
    await part(`Settings, ${mode}${phone ? ', on a phone' : ''}`, async () => {
      const { ctx, p, errors } = await page(b, kit.url, { mode, theme, phone })
      await openSettings(p)
      await p.locator('.sb-tabs [role="tab"]', { hasText: 'Set Up' }).click()
      await p.locator('[data-setting="slack-owner"]').waitFor({ timeout: 10000 })
      ok(/Tester/.test(await p.locator('[data-setting="slack-owner"]').innerText()), 'You in Slack shows you')
      ok(/30/.test(await p.locator('[data-setting="slack-limits"] input').first().inputValue()), 'its limits: 30 a day')
      if (!phone) {
        await p.locator('[data-setting="slack-owner"]').scrollIntoViewIfNeeded()
        await shot(p, `${tag}bots-approvals-setup-${mode}`)
        await p.locator('[data-setting="slack-limits"]').scrollIntoViewIfNeeded()
        await shot(p, `${tag}bots-approvals-limits-${mode}`)
      }
      // Memory: waiting for you, and kept.
      await p.locator('.sb-tabs [role="tab"]', { hasText: 'Memory' }).click()
      const box = p.locator('[data-setting="slack-memory"]')
      await box.waitFor({ timeout: 10000 })
      await until(async () => /printer is on floor 2/.test(await box.innerText()), 8000)
      const words = await box.innerText()
      ok(/Waiting for you/.test(words) && /printer is on floor 2/.test(words) && /Austin office closes at 4 on Fridays/.test(words) && /leads? the support team/.test(words), 'Memory: what waits for you, and what it keeps, each kind', words.slice(0, 600))
      if (phone) {
        const faults = await phoneFaults(p, '.modal.settings .sb')
        ok(!Object.keys(faults).length, 'on a phone: nothing too small to tap, off the screen or cut short', faults)
      }
      await shot(p, `${tag}bots-approvals-memory-${mode}${phone ? '-phone' : ''}`)
      if (mode === 'light' && !phone) {
        // Kept from the page, and one edited there.
        const row = box.locator('li', { hasText: 'printer is on floor 2' })
        await row.getByRole('button', { name: 'Keep' }).click()
        ok(!!(await until(async () => (await mem()).find((x) => /printer/.test(x.text))?.state === 'kept', 8000)), 'kept from the page')
        const kept = box.locator('li', { hasText: 'lead the support team' })
        await kept.getByRole('button', { name: 'Edit' }).click()
        const editing = box.locator('li input[aria-label="What it remembers"]')
        await editing.fill('Sam leads the support team in Austin')
        await editing.press('Enter')
        ok(!!(await until(async () => (await mem()).some((x) => x.text === 'Sam leads the support team in Austin'), 8000)), 'edited from the page')
      }
      await p.locator('.sb-tabs [role="tab"]', { hasText: 'Set Up' }).click()
      ok(errors.length === 0, 'no page errors', errors)
      await ctx.close()
    })
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-3000))
} finally {
  await b.close()
  kit.stop()
  slack.stop()
}
process.exit(done().fail ? 1 : 0)
