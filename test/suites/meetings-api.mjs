// Meetings on the server, on any platform: a recording made of a tone (speech to the level check)
// transcribed by the stand-in speech service; sections; who said what; what the summary is written
// from (your notes, the screen, the files, the invite); folders and the archive;
// search and questions; saved Markdown; looks at the screen while the call talks (read by a
// stand-in for native/bridgeocr, which isn't run on Windows); action items turned into agents and
// Chief of Staff's tasks, and since last time; whether the floating card shows in screenshots;
// AI Assist's live board (a beta feature), filling in a batch at a time as lines come; Answers in
// AI Assist (a beta feature), from past meetings, the model's own knowledge and a stand-in for
// Perplexity's web search. The
// calendar is macOS Calendar, and the call's sound is recorded on a Mac (a stand-in for
// native/calltap there), so their parts are Mac-only.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, startModel, startLocalModel, checks, until, sleep, TEST, IS_MAC, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('meetings-api')
// The text on a picture: ocr.txt beside it, and what it was asked to read goes in ocr.log.
const ocr = (bin) => {
  fs.writeFileSync(path.join(bin, 'ocr.cjs'), `const fs = require('node:fs'), path = require('node:path'), f = process.argv[3]
fs.appendFileSync(path.join(__dirname, 'ocr.log'), f + '\\n')
try { process.stdout.write(fs.readFileSync(path.join(__dirname, 'ocr.txt'), 'utf8')) } catch { /* nothing on it */ }`)
  fs.writeFileSync(path.join(bin, 'bridgeocr'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'ocr.cjs')}" "$@"\n`, { mode: 0o755 })
  return path.join(bin, 'bridgeocr')
}
// BRIDGE_BOARD_MS: the live board's minute, 2 s here. BRIDGE_PERPLEXITY_URL: the stand-in model,
// answering as Perplexity's Sonar does.
const model = await startModel('meetings-api')
const kit = await startKit('meetings-api', { env: ({ bin }) => ({ BRIDGE_CALL_QUIET_MS: '2500', BRIDGE_BOARD_MS: '2000', BRIDGE_PERPLEXITY_URL: `${model.url}/v1`, ...(IS_WIN ? {} : { BRIDGE_OCR: ocr(bin) }) }) })
const RATE = 16000
// Seconds of audio: a tone where say is true (loud enough to count as speech), else silence.
const pcm = (seconds, say) => {
  const b = Buffer.alloc(Math.round(seconds * RATE) * 2)
  if (say) for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 8000), i * 2)
  return b
}
let seq = 0
const send = async (id, buf, src = 'you') => { for (let o = 0; o < buf.length; o += RATE * 2) await fetch(`${kit.url}/api/meetings/${id}/audio?src=${src}&seq=${seq++}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf.subarray(o, o + RATE * 2) }) }
const dirOf = (id) => path.join(kit.data, 'meetings', id)
const said = (id, rows) => fs.appendFileSync(path.join(dirOf(id), 'transcript.jsonl'), rows.map(([src, t0, text]) => JSON.stringify({ src, t0, t1: t0 + 3, text, engine: 'test' })).join('\n') + '\n')
const notes = (id) => { try { return fs.readFileSync(path.join(dirOf(id), 'notes.md'), 'utf8') } catch { return '' } }
const err = (p, body, method) => kit.api(p, body, method).then(() => null, (e) => e.message)
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120)])
const look = (id, body = PNG) => fetch(`${kit.url}/api/meetings/${id}/glances`, { method: 'POST', headers: { 'content-type': 'image/png' }, body }).then((r) => r.json())
const glances = (id) => { try { return fs.readFileSync(path.join(dirOf(id), 'glances.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false, cleanup: false, folder: path.join(kit.home, 'Meeting notes') } }, 'PATCH')

  // ---------- Recording, in sections ----------
  const A = await kit.api('/meetings', { title: 'Quarterly plan', call: false })
  ok(A.status === 'recording', 'a meeting starts recording', A)
  await send(A.id, Buffer.concat([pcm(0.5), pcm(2, true), pcm(3.5)]))
  let r = await kit.api(`/meetings/${A.id}/section`, {})
  ok(r.sections.length === 2 && r.sections[0].title === 'Section 1' && r.sections[0].t === 0 && r.section.title === 'Section 2' && r.section.t >= 5.5, 'New section 6 s in: what came before is Section 1', r.sections)
  ok((await kit.api(`/meetings/${A.id}/section`, {})).sections.length === 2, 'a second click straight after is the same section')
  await send(A.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  r = await kit.api(`/meetings/${A.id}/section`, { title: 'Q&A' })
  ok(r.sections.length === 3 && r.section.title === 'Q&A', 'a section can be named as it starts', r.sections)
  await kit.api(`/meetings/${A.id}/note`, { text: 'ask about pricing' })
  ok(/^## Section 2\n\n## Q&A\n- \[0:\d\d\] ask about pricing\n$/.test(notes(A.id)), 'each section heads your notes; a quick note goes under the latest', notes(A.id))
  r = await kit.api(`/meetings/${A.id}/sections/1`, { title: 'Demo' }, 'PATCH')
  ok(r.sections[1].title === 'Demo' && /^## Demo\n/.test(notes(A.id)), 'renamed, in the notes too', notes(A.id))
  await send(A.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  await kit.api(`/meetings/${A.id}/section`, { title: 'Wrap-up' })
  r = await kit.api(`/meetings/${A.id}/sections/3`, null, 'DELETE')
  ok(r.sections.length === 3 && !/Wrap-up/.test(notes(A.id)), 'taken out, from the notes too', notes(A.id))
  await kit.api(`/meetings/${A.id}/stop`, {})
  ok(/Start recording first/.test(await err(`/meetings/${A.id}/section`, {}) || ''), 'no New section once it stopped')
  const got = await until(async () => { const m = await kit.api(`/meetings/${A.id}`); return m.status === 'done' && m.transcript.length >= 3 && m }, 20000)
  ok(!!got && got.transcript.every((l) => /^Service transcript \d+\.$/.test(l.text)), 'what was said is transcribed by the speech service (one line a stretch)', got?.transcript)
  const S = (await kit.api(`/meetings/${A.id}`)).sections

  // ---------- The call's sound, silent ----------
  // Until Bridge AI may hear the call (System Audio Recording), macOS gives silence, or a few steps
  // off it: on a call that's said (call-event). A meeting in a room records what the computer plays
  // too, in case a call starts; nothing playing there is no call, and isn't said to be silent.
  if (!IS_MAC) skip('a silent call is said to be silent', "the call's sound is recorded on a Mac")
  else {
    const tap = (level) => fs.writeFileSync(path.join(kit.bin, 'calltap.json'), JSON.stringify({ level }))
    tap(3)
    const C = await kit.api('/meetings', { title: 'Call check' })
    ok(C.call === 'on', "(the meeting records the call's sound, from the stand-in)", C.call)
    await sleep(4000) // past BRIDGE_CALL_QUIET_MS
    ok((await kit.api(`/meetings/${C.id}`)).callQuiet === false && (await kit.api('/calls')).recording?.callQuiet === false, 'a meeting in a room (no call app has the mic), nothing playing: not said to be silent, on the meeting or the floating card')
    tap(4000)
    const talk = await until(async () => { const t = (await kit.api('/calls')).recording?.talking; return typeof t === 'number' && { t } }, 10000)
    ok(!!talk, 'someone on the call talking is told to the page, which looks at the screen then', talk)
    tap(0)
    ok(!!(await until(async () => (await kit.api('/calls')).recording?.talking === null, 10000)), 'and not once they stop')
    await kit.api(`/meetings/${C.id}/stop`, {})
  }

  // When the floating card is kept out of screenshots and screen sharing (Settings › Meetings; the
  // desktop app reads it from /api/calls, desktop/floatshare.js).
  ok((await kit.api('/calls')).floatHide === 'sharing', 'the floating card: kept out of a screen you share, to begin with')
  await kit.api('/settings', { meetings: { floatHide: 'never' } }, 'PATCH')
  ok((await kit.api('/calls')).floatHide === 'never', 'in every picture once that\'s turned off')
  await kit.api('/settings', { meetings: { floatHide: 'bogus' } }, 'PATCH')
  ok((await kit.api('/calls')).floatHide === 'sharing', 'and anything else is the first choice')

  // ---------- Notes about sound, not words ----------
  // An engine's "[END]" or "(keyboard clicking)" for a stretch without words: no line, and not
  // passed on as the last thing said, which led whisper to write "[END]" for everything after.
  const T = await kit.api('/meetings', { title: 'Tags only', call: false })
  for (let i = 0; i < 3; i++) {
    const n = model.heard().length
    await send(T.id, Buffer.concat([pcm(2, true), pcm(2)]))
    await until(() => model.heard().length > n, 10000)
    await sleep(600) // its answer is in before the next stretch
  }
  await kit.api(`/meetings/${T.id}/stop`, {})
  const tg = await until(async () => { const m = await kit.api(`/meetings/${T.id}`); return m.status === 'done' && m }, 20000)
  ok(!!tg && tg.transcript.length === 1 && /^Service transcript \d+\.$/.test(tg.transcript[0].text), 'a stretch the engine wrote only "[END]" or "(keyboard clicking) [ Silence ]" for leaves no line', tg?.transcript)
  const hints = model.heard().filter((x) => /Tags only/.test(x.prompt)).map((x) => x.prompt)
  ok(hints.length === 3 && hints.every((h) => !/\[|\(keyboard/.test(h)), 'and it isn\'t passed on to the next stretch as the last thing said', hints)
  said(T.id, [['you', 30, '[END]']])
  ok((await kit.api(`/meetings/${T.id}`)).transcript.length === 1, 'nor shown when an earlier version kept one')

  // ---------- Who said it ----------
  said(A.id, [['them', 2.5, 'Thanks, here is the agenda for today.'], ['them', S[1].t + 0.5, 'These slides show the new deck.'], ['them', S[2].t + 0.5, 'What about the budget for next year?']])
  await kit.api(`/meetings/${A.id}/event`, { event: { title: 'Pricing review', attendees: ['Priya Shah', 'Dan Ruiz', 'Tester'] } })
  const n0 = model.asked(/Say who said each numbered Them line/).length
  r = await kit.api(`/meetings/${A.id}/speakers`, {})
  ok(r.named === 3 && r.of === 3, 'Who spoke names the lines from the call', r)
  const ask = model.asked(/Say who said each numbered Them line/).slice(n0)[0] || ''
  ok(/Invited, besides You: Priya Shah, Dan Ruiz\n/.test(ask) && /"You" is Tester/.test(ask), 'it\'s told who was invited, and that You is you', ask.slice(0, 400))
  let g = await kit.api(`/meetings/${A.id}`)
  const line = (re) => g.transcript.find((l) => re.test(l.text))
  ok(line(/slides/).name === 'Dan Ruiz' && line(/slides/).guess && line(/budget/).name === 'Priya Shah', 'names, as guesses', g.transcript.map((l) => [l.text.slice(0, 14), l.name]))
  await kit.api(`/meetings/${A.id}/speakers`, { key: line(/agenda/).key, name: 'Priya Shah' }, 'PATCH')
  await kit.api(`/meetings/${A.id}/speakers`, {})
  g = await kit.api(`/meetings/${A.id}`)
  ok(line(/agenda/).name === 'Priya Shah' && !line(/agenda/).guess, 'one you named stays yours', line(/agenda/))
  ok(g.title === 'Quarterly plan', 'a name you gave it stays when its calendar event is picked', g.title)

  // ---------- One other person on the call ----------
  // Invited: you and one other person, so the call is them (as a guess), with no model asked; the
  // address a calendar has for someone without a name is written as a name. Back to Them stays Them.
  const P = await kit.api('/meetings', { title: 'One to one', call: false })
  await kit.api(`/meetings/${P.id}/stop`, {})
  said(P.id, [['them', 1, 'Can you hear me now?'], ['you', 5, 'Yes, loud and clear.'], ['them', 9, 'Let me check the numbers.']])
  await kit.api(`/meetings/${P.id}/event`, { event: { title: 'Catch-up', attendees: ['priya.shah2', 'tester'] } })
  let p = await kit.api(`/meetings/${P.id}`)
  const them = () => p.transcript.filter((l) => l.src === 'them')
  ok(them().length === 2 && them().every((l) => l.name === 'Priya Shah' && l.guess) && !p.transcript.find((l) => l.src === 'you').name, 'with one other person invited, what the call said is theirs', p.transcript.map((l) => [l.src, l.name, l.guess]))
  ok(p.me === 'Tester', 'and your lines are yours, by the name in Settings', p.me)
  const n3 = model.asked(/Say who said each numbered Them line/).length
  const n4 = model.asked(/Write meeting notes in Markdown/).length
  await kit.api(`/meetings/${P.id}/summary`, {})
  const sum1 = (await until(() => model.asked(/Write meeting notes in Markdown/).slice(n4)[0], 15000)) || ''
  ok(/\] Priya Shah: Can you hear me/.test(sum1) && model.asked(/Say who said each numbered Them line/).length === n3, 'the summary has their name, and no model was asked who said what', sum1.slice(sum1.indexOf('Transcript:'), sum1.indexOf('Transcript:') + 200))
  await until(async () => !(await kit.api(`/meetings/${P.id}`)).summarizing, 10000)
  await kit.api(`/meetings/${P.id}/speakers`, { key: them()[0].key, name: null }, 'PATCH')
  p = await kit.api(`/meetings/${P.id}`)
  ok(!them()[0].name && them()[1].name === 'Priya Shah', 'Back to Them keeps that line Them', them().map((l) => l.name))
  await kit.api(`/meetings/${P.id}/speakers`, { key: them()[0].key, name: 'Dan Ruiz' }, 'PATCH')
  p = await kit.api(`/meetings/${P.id}`)
  ok(them()[0].name === 'Dan Ruiz' && !them()[0].guess, 'and a name you give it is yours', them()[0])

  // ---------- Your mic hearing the call ----------
  // Not on headphones, your mic hears the call. A line of yours with their words in it (you both
  // talked in that stretch) keeps only yours and says what was heard; one that's all theirs is
  // left out; one of your own stays as it is.
  const E = await kit.api('/meetings', { title: 'Echo check', call: false })
  await kit.api(`/meetings/${E.id}/stop`, {})
  said(E.id, [
    ['them', 10, 'So about me, I have spent six years in logistics, mostly route planning for grocery stores across the north.'],
    ['you', 9, 'Great, thanks for joining. So about me I have spent six years in logistics mostly route planning for grocery stores'],
    ['them', 40, 'We moved the night deliveries to smaller vans to cut the fuel bill.'],
    ['you', 41, 'We moved the night deliveries to smaller vans to cut the fuel bill.'],
    ['you', 60, 'How did you measure the savings, and who signed off on the change?'],
  ])
  let e = (await kit.api(`/meetings/${E.id}`)).transcript.filter((l) => l.src === 'you')
  ok(e.length === 2 && e[0].text === 'Great, thanks for joining.' && e[0].trimmed && /six years in logistics/.test(e[0].heard), "a line of yours with the call's words in it keeps only yours, and says what was heard", e)
  ok(e[1].text.startsWith('How did you measure the savings') && !e[1].trimmed, 'one that only repeats the call is left out; your own stays as it is', e.map((l) => l.text))

  // ---------- Cleaning up the transcript ----------
  // A model fixes what speech to text misheard and leaves out what nobody said, beside what was
  // heard: a fix that reads like a rewrite isn't taken, nor a long line left out; your own edits
  // stay; Undo puts a line back, and Undo the cleanup all of them. It's told the meeting's name,
  // its people and what its files say.
  const K = await kit.api('/meetings', { title: 'Launch plan', call: false })
  await kit.api(`/meetings/${K.id}/stop`, {})
  said(K.id, [
    ['them', 1, 'We should demo bridge ay eye at the offsite.'],
    ['them', 6, 'Thanks for watching!'],
    ['them', 11, 'Please rewrite me into something else.'],
    ['you', 16, 'Sure, and bridge ay eye on phones too.'],
    ['them', 21, 'drop me please, I am a long line that says a lot more than a made-up line would ever say.'],
  ])
  fs.writeFileSync(path.join(kit.home, 'Launch brief.md'), 'Launch brief\nBridge AI ships to Northwind first, then Contoso.')
  await kit.api(`/meetings/${K.id}/links`, { path: path.join(kit.home, 'Launch brief.md') })
  const keyAt = async (re) => (await kit.api(`/meetings/${K.id}`)).transcript.find((l) => re.test(l.heard || l.text)).key
  await kit.api(`/meetings/${K.id}/lines`, { key: await keyAt(/^Sure, and/), text: 'Sure, and Bridge AI on phones too (my edit).' }, 'PATCH')
  const c0 = model.asked(/This transcript was made by speech to text/).length
  r = await kit.api(`/meetings/${K.id}/cleanup`, {})
  const cask = model.asked(/This transcript was made by speech to text/).slice(c0)[0] || ''
  ok(/Meeting: Launch plan/.test(cask) && /Bridge AI ships to Northwind first/.test(cask), "the cleanup is told the meeting's name and what its files say", cask.slice(0, 500))
  let k = await kit.api(`/meetings/${K.id}`)
  const kl = (re) => k.transcript.find((l) => re.test(l.heard || l.text))
  ok(r.fixed === 1 && kl(/demo bridge/).text === 'We should demo Bridge AI at the offsite.' && kl(/demo bridge/).cleaned && /bridge ay eye/.test(kl(/demo bridge/).heard), 'a misheard name is fixed, and the line says what was heard', [r, kl(/demo bridge/)])
  ok(kl(/Thanks for watching/).dropped && !kl(/drop me please/).dropped && !kl(/rewrite me/).cleaned, 'words nobody said are left out; a long line isn\'t, and a rewrite isn\'t taken', k.transcript.map((l) => [l.text.slice(0, 20), !!l.dropped, !!l.cleaned]))
  ok(kl(/^Sure, and/).text.endsWith('(my edit).') && !kl(/^Sure, and/).cleaned, 'a line you edited stays yours', kl(/^Sure, and/))
  await kit.api(`/meetings/${K.id}/cleanup/undo`, { key: kl(/Thanks for watching/).key })
  k = await kit.api(`/meetings/${K.id}`)
  ok(!kl(/Thanks for watching/).dropped && kl(/demo bridge/).cleaned, 'Restore keeps that one line', kl(/Thanks for watching/))
  await kit.api(`/meetings/${K.id}/cleanup/undo`, {})
  k = await kit.api(`/meetings/${K.id}`)
  ok(!k.transcript.some((l) => l.cleaned || l.dropped) && !k.cleanedAt, 'Undo the cleanup: back to what was heard', k.transcript.map((l) => l.text))
  // When the meeting ends, it's cleaned up by itself, then summarized.
  await kit.api('/settings', { meetings: { cleanup: true } }, 'PATCH')
  const K2 = await kit.api('/meetings', { title: 'Second launch plan', call: false })
  await send(K2.id, Buffer.concat([pcm(2, true), pcm(1.5), pcm(2, true), pcm(1.5), pcm(2, true), pcm(1.5)]))
  const c1 = model.asked(/This transcript was made by speech to text/).length
  await kit.api(`/meetings/${K2.id}/stop`, {})
  ok(!!await until(async () => (await kit.api(`/meetings/${K2.id}`)).cleanedAt, 20000) && model.asked(/This transcript was made by speech to text/).length === c1 + 1, 'a meeting that ends is cleaned up by itself')
  // Left as it came, it goes with the summary: with that off too (as here), the transcript isn't
  // sent to a model by itself.
  await kit.api('/settings', { meetings: { cleanup: null } }, 'PATCH')
  const K3 = await kit.api('/meetings', { title: 'Third launch plan', call: false })
  await send(K3.id, Buffer.concat([pcm(2, true), pcm(1.5), pcm(2, true), pcm(1.5), pcm(2, true), pcm(1.5)]))
  const c2 = model.asked(/This transcript was made by speech to text/).length
  await kit.api(`/meetings/${K3.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${K3.id}`)).status === 'done', 20000)
  await sleep(2000)
  ok(model.asked(/This transcript was made by speech to text/).length === c2 && !(await kit.api(`/meetings/${K3.id}`)).cleanedAt, 'not turned on, and with the summary not written by itself, it isn\'t cleaned up by itself either')
  await kit.api('/settings', { meetings: { cleanup: false } }, 'PATCH')

  // ---------- The kind of meeting, from its name ----------
  const I = await kit.api('/meetings', { title: 'Interview - Mara Lind', call: false })
  ok(I.kind === 'interview', 'a meeting called "Interview - ..." is an interview', I.kind)
  await kit.api(`/meetings/${I.id}`, { kind: 'customer' }, 'PATCH')
  await kit.api(`/meetings/${I.id}`, { title: 'Daily standup' }, 'PATCH')
  ok((await kit.api(`/meetings/${I.id}`)).kind === 'customer', 'a kind you picked stays when it\'s renamed')
  const D = await kit.api('/meetings', { title: 'Teams call, Thu 9:00', call: false })
  await kit.api(`/meetings/${D.id}/event`, { event: { title: 'Team standup', attendees: ['Priya Shah', 'Tester'] } })
  ok((await kit.api(`/meetings/${D.id}`)).kind === 'standup', 'and its invite can say what kind it is')
  await kit.api(`/meetings/${D.id}/stop`, {})
  await kit.api(`/meetings/${I.id}/stop`, {})

  // ---------- AI Assist ----------
  // On, while it records: after enough is said, the model suggests what to ask or check, told what
  // the files say; kept, a suggestion goes in your notes; dismissed, it's gone. Turning it on is
  // remembered for the meetings after.
  const J = await kit.api('/meetings', { title: 'Interview - Mara Lind', call: false })
  fs.writeFileSync(path.join(kit.home, 'Mara Lind - Resume.md'), 'Mara Lind\nLed the move to electric vans at Northwind Traders, cutting fuel costs by a third.')
  await kit.api(`/meetings/${J.id}/links`, { path: path.join(kit.home, 'Mara Lind - Resume.md') })
  r = await kit.api(`/meetings/${J.id}/assist`, { on: true })
  ok(r.on === true && (await kit.api('/settings')).user?.meetings?.assist === true, 'AI Assist turned on, and remembered for the next meetings', [r.on, (await kit.api('/settings')).user?.meetings])
  const a0 = model.asked(/This meeting is going on now/).length
  said(J.id, [['them', 2, 'I led the move to electric vans at Northwind Traders and cut fuel costs by a third, with new routes and a charging plan for every depot.'], ['you', 9, 'How did you measure those savings, and did they hold up through the winter when the vans had less range?']])
  r = await kit.api(`/meetings/${J.id}/assist`, {})
  const aask = model.asked(/This meeting is going on now/).slice(a0)[0] || ''
  ok(/helping the interviewer/.test(aask) && /Led the move to electric vans at Northwind Traders/.test(aask), 'Assist knows it\'s an interview, and what the resume says', aask.slice(0, 600))
  let J1 = await kit.api(`/meetings/${J.id}`)
  ok(J1.assistItems.length === 2 && J1.assistItems[0].kind === 'question' && /Mara Lind - Resume/.test(J1.assistItems[0].why), 'its suggestions, each with what it\'s based on', J1.assistItems)
  await kit.api(`/meetings/${J.id}/assist/${J1.assistItems[0].id}`, { state: 'kept' }, 'PATCH')
  await kit.api(`/meetings/${J.id}/assist/${J1.assistItems[1].id}`, { state: 'dismissed' }, 'PATCH')
  J1 = await kit.api(`/meetings/${J.id}`)
  ok(J1.assistItems.length === 1 && J1.assistItems[0].state === 'kept' && /\] Ask: Ask about/.test(J1.notes), 'one kept goes in your notes; one dismissed is gone', [J1.assistItems, J1.notes])
  // How often: low, medium or high, for every meeting; a level it doesn't know is refused. Low says
  // one thing at most, and only when something clearly stands out.
  r = await kit.api(`/meetings/${J.id}/assist`, { level: 'low' })
  ok(r.level === 'low' && (await kit.api('/settings')).user?.meetings?.assistLevel === 'low' && (await kit.api(`/meetings/${J.id}`)).assistLevel === 'low', 'Assist set to low, for every meeting', [r, (await kit.api('/settings')).user?.meetings])
  ok(await kit.api(`/meetings/${J.id}/assist`, { level: 'loud' }).then(() => false, (e) => /low, medium or high/.test(e.message)), 'a level it doesn\'t know is refused')
  const SC = await kit.api('/meetings', { title: 'Supplier call', call: false })
  said(SC.id, [['them', 2, 'The new depot opens in March if the permits come through, and the vans arrive the week after.']])
  const a3 = model.asked(/This meeting is going on now/).length
  await kit.api(`/meetings/${SC.id}/assist`, {})
  const lowAsk = model.asked(/This meeting is going on now/).slice(a3)[0] || ''
  const lowItems = (await kit.api(`/meetings/${SC.id}`)).assistItems
  ok(/At most one suggestion/.test(lowAsk) && lowItems.length === 1, 'low: one suggestion at most, of the two the model had', lowItems)
  await kit.api(`/meetings/${SC.id}/stop`, {})
  await kit.api(`/meetings/${J.id}/assist`, { level: 'medium' })
  // By itself, after a line comes in, once enough more has been said.
  const a1 = model.asked(/This meeting is going on now/).length
  await send(J.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  ok(!await until(() => model.asked(/This meeting is going on now/).length > a1, 3000), 'not again for a line or two')
  await kit.api(`/meetings/${J.id}/stop`, {})
  await kit.api(`/meetings/${J.id}/assist`, { on: false })
  ok((await kit.api('/settings')).user?.meetings?.assist === false, 'and off again')

  // ---------- Answers in AI Assist (a beta feature) ----------
  // Off as a beta feature: a question raised gets no answer, and none is asked for. On, with AI
  // Assist on for the meeting: the questions asked since the last look go to the model in the same
  // look, numbered, with the past meetings they may be about. A general one is answered from the
  // model's own knowledge, said to be; one about a past meeting from it, naming it; not one put to a
  // person. Kept, it goes in your notes when it was asked; one answered already isn't again. One that
  // needs current facts: without a way to search, the card says how to add one; with a Perplexity key
  // (a stand-in), it's looked up with the question alone; a lookup that fails says why.
  const answersAsked = () => model.asked(/^Questions asked since you last looked/m)
  const answersOf = async (id) => (await kit.api(`/meetings/${id}`)).assistItems.filter((x) => x.kind === 'answer')
  const allAnswers = (id) => JSON.parse(fs.readFileSync(path.join(dirOf(id), 'assist.json'), 'utf8')).items.filter((x) => x.kind === 'answer')
  const PA = await kit.api('/meetings', { title: 'Northwind pricing call', call: false })
  await kit.api(`/meetings/${PA.id}/stop`, {})
  fs.writeFileSync(path.join(dirOf(PA.id), 'summary.md'), '## Summary\n- Pricing for Northwind Traders settled.\n\n## Decisions\n- Northwind Traders gets 20% off the Team plan for two years.\n')
  const QA = await kit.api('/meetings', { title: 'Vendor review', call: false })
  await kit.api(`/meetings/${QA.id}/assist`, { on: true })
  said(QA.id, [['them', 2, "What's the difference between SOC 2 Type 1 and Type 2?"]])
  let qn = answersAsked().length
  await kit.api(`/meetings/${QA.id}/assist`, {})
  ok((await kit.api('/config')).trials?.['assist-answers'] === false && answersAsked().length === qn && !(await answersOf(QA.id)).length && model.asked(/This meeting is going on now/).length > 0, 'off as a beta feature to start with: a question raised gets no answer, and none is asked for')
  await kit.api('/settings', { trials: { 'assist-answers': true } }, 'PATCH')
  await kit.api(`/meetings/${QA.id}/assist`, { on: false })
  said(QA.id, [['them', 5, 'What does SOC 2 cover for a vendor like us?']])
  qn = answersAsked().length
  await kit.api(`/meetings/${QA.id}/assist`, {})
  ok(answersAsked().length === qn && !(await answersOf(QA.id)).length, 'on, with AI Assist off for the meeting: no answers either, even with Suggest now')
  await kit.api(`/meetings/${QA.id}/assist`, { on: true })
  said(QA.id, [
    ['them', 10, "What's the difference between SOC 2 Type 1 and Type 2?"],
    ['you', 16, 'And what did we agree on pricing with Northwind Traders last time?'],
    ['them', 22, 'How are you finding the new office?'],
    ['you', 26, 'Fine, thanks, it is close to the station.'],
  ])
  qn = answersAsked().length
  await kit.api(`/meetings/${QA.id}/assist`, {})
  const qask = answersAsked().slice(qn)[0] || ''
  const qsec = qask.slice(qask.indexOf('Questions asked'), qask.indexOf('Questions asked') + 900)
  ok(/^Q1\. \[0:10\] Them: What's the difference between SOC 2/m.test(qask) && /^Q2\. \[0:16\] You: And what did we agree/m.test(qask) && /^Q3\. \[0:22\] Them: How are you/m.test(qask) && !/^Q\d+\. \[0:0[25]\]/m.test(qask) && !/^Q\d+\. [^\n]*close to the station/m.test(qask), 'on: the questions asked since the last look go to the model, numbered (not lines it looked at before, nor ones that ask nothing)', qsec)
  ok(/past meetings these may be about[^\n]*:\n\[1\] "Northwind pricing call", [^\n]*\n[\s\S]*20% off the Team plan/.test(qask), 'with the past meeting the pricing question is about, numbered, for the model to answer from', qsec)
  let qa = await answersOf(QA.id)
  const soc = qa.find((x) => /SOC 2/.test(x.q))
  const price = qa.find((x) => /pricing/.test(x.q))
  ok(qa.length === 2 && !qa.some((x) => /How are you/.test(x.q)), 'two answers, and none to the question put to a person', qa.map((x) => x.q))
  ok(!!soc && soc.t === 10 && soc.asked?.who === 'Them' && /SOC 2 Type 1/.test(soc.asked.text) && soc.sources.length === 1 && soc.sources[0].kind === 'general' && soc.model === 'openai:gpt-5' && soc.web === null && soc.state === 'new', "a general question: answered from the model's own knowledge, said to be, with who asked it and when", soc)
  ok(!!price && price.sources[0]?.kind === 'meeting' && price.sources[0].id === PA.id && price.sources[0].title === 'Northwind pricing call' && price.sources[0].startedAt === PA.startedAt && /20% off the Team plan/.test(price.text) && price.web === null, 'one about what was agreed last time: answered from that meeting, naming it and its day', price)
  ok((await kit.api(`/meetings/${QA.id}`)).assistItems.some((x) => x.kind !== 'answer'), '(the suggestions come in the same look)')
  await kit.api(`/meetings/${QA.id}/assist/${price.id}`, { state: 'kept' }, 'PATCH')
  ok(/^- \[0:16\] Answer: And what did we agree on pricing with Northwind Traders last time\? Last time you agreed: Northwind Traders gets 20% off the Team plan for two years\. \(From "Northwind pricing call", [^)]+\.\)$/m.test(notes(QA.id)), 'kept: in your notes at the time it was asked, the question, the answer and where it\'s from', notes(QA.id))
  await kit.api(`/meetings/${QA.id}/assist/${soc.id}`, { state: 'dismissed' }, 'PATCH')
  ok(!(await answersOf(QA.id)).some((x) => x.id === soc.id), 'dismissed: gone')
  // Asked again in other words: told it was answered, and the model answering it anyway, it isn't.
  said(QA.id, [['them', 30, "So what's the difference between SOC 2 Type 1 and Type 2 again?"]])
  qn = answersAsked().length
  await kit.api(`/meetings/${QA.id}/assist`, {})
  const askedAgain = answersAsked().slice(qn)[0] || ''
  ok(/Answered already[^\n]*:\n- What's the difference between SOC 2 Type 1 and Type 2\?\n- And what did we agree/.test(askedAgain) && allAnswers(QA.id).filter((x) => /SOC 2/.test(x.q)).length === 1, 'a question answered already (and dismissed) isn\'t answered again', allAnswers(QA.id).map((x) => x.q))
  // Facts that change, with no way to search: from what the model knows, and how to add a search.
  said(QA.id, [['you', 40, 'When does the EU AI Act start applying?']])
  await kit.api(`/meetings/${QA.id}/assist`, {})
  const eu = (await answersOf(QA.id)).find((x) => /EU AI Act/.test(x.q))
  ok(!!eu && eu.current === true && eu.sources[0].kind === 'general' && eu.web?.state === 'off' && !model.requests().some((x) => /^sonar/.test(x.model)), 'one that needs current facts, with no web search set up: from the model\'s own knowledge, and the card says how to add one; nothing goes to a search service', eu)
  // With a Perplexity key: looked up on the web, sending the question alone.
  await kit.api('/providers/perplexity', { values: { PERPLEXITY_API_KEY: 'pplx-test' } }, 'PUT')
  said(QA.id, [['them', 50, 'And what is the latest guidance on the AI Act for providers?']])
  const s0 = model.requests().length
  await kit.api(`/meetings/${QA.id}/assist`, {})
  const webbed = await until(async () => { const x = (await answersOf(QA.id)).find((y) => /latest guidance/.test(y.q)); return x?.web?.state === 'done' && x }, 8000)
  const webSrc = webbed?.sources?.find((s) => s.kind === 'web')
  ok(!!webbed && /^On the web: /.test(webbed.text) && /A third sentence\.$/.test(webbed.text) && !/fourth/.test(webbed.text) && /^A general answer/.test(webbed.general || '') && webSrc?.via === 'Perplexity' && webSrc.links.length === 2 && webSrc.links[0].url === 'https://example.com/eu-ai-act' && webSrc.links[0].title === 'EU AI Act: the timeline' && !webbed.sources.some((s) => s.kind === 'general'), "with a Perplexity key, it's looked up on the web: the web's answer, three sentences at most, with its pages (none that isn't a web address) in place of the model's", webbed)
  const sent = model.requests().slice(s0).filter((x) => /^sonar/.test(x.model))
  const sentText = JSON.stringify(sent.map((x) => x.messages))
  ok(sent.length === 1 && /: And what is the latest guidance on the AI Act for providers\?"/.test(sentText) && !/SOC 2|Northwind|Vendor review|EU AI Act start|station/.test(sentText), 'only the question went to the search service: nothing said before it, no notes, no meeting', sentText)
  // A lookup that fails says why, and the model's own answer stays.
  await kit.api('/providers/perplexity', { values: { PERPLEXITY_API_KEY: 'sk-bad' } }, 'PUT')
  said(QA.id, [['them', 60, 'When does the new data law come into force?']])
  await kit.api(`/meetings/${QA.id}/assist`, {})
  const failed = await until(async () => { const x = (await answersOf(QA.id)).find((y) => /data law/.test(y.q)); return x?.web?.state === 'failed' && x }, 8000)
  ok(!!failed && failed.web.error === 'Perplexity API (sonar-pro): Incorrect API key provided.' && failed.sources.length === 1 && failed.sources[0].kind === 'general' && /^A general answer/.test(failed.text), 'a lookup that fails says why on the card, and the model\'s own answer stays', failed)
  await kit.api('/providers/perplexity', { values: { PERPLEXITY_API_KEY: '' } }, 'PUT')
  // Three asked at once, the model answering each: two of them, besides the suggestions.
  said(QA.id, [['them', 70, 'What is ISO 27001?'], ['you', 74, 'What does GDPR stand for?'], ['them', 78, 'What is a data processing agreement?']])
  const had = allAnswers(QA.id).length
  await kit.api(`/meetings/${QA.id}/assist`, {})
  const three = allAnswers(QA.id).slice(had)
  ok(had === 5 && three.length === 2 && /ISO 27001/.test(three[0].q) && /GDPR/.test(three[1].q) && allAnswers(QA.id).every((x, i, all) => all.findIndex((y) => y.q === x.q) === i), 'at most two answers a look, besides the suggestions; each question once', allAnswers(QA.id).map((x) => x.q))
  await kit.api(`/meetings/${QA.id}/stop`, {})
  await kit.api(`/meetings/${QA.id}/assist`, { on: false })
  await kit.api('/settings', { trials: { 'assist-answers': false } }, 'PATCH')

  // ---------- AI Assist's live board (a beta feature) ----------
  // Off as a beta feature: its routes say so, and a meeting with it on sends nothing. On: as lines
  // come in, a batch at a time (a minute, here BRIDGE_BOARD_MS's 2 s, and longer at AI Assist's Low),
  // the model that writes the notes is asked what's new and it goes on a whiteboard of the meeting's
  // own, each in its part's column as a suggestion. What's on the board (yours too) and what was
  // taken off it aren't added again, and nothing on it is moved or taken away. Kept and discarded
  // from the meeting; its action items onto Chief of Staff's task list once; a last look when it
  // stops; and with a model on this computer, its looks stay here.
  const boardAsks = () => model.asked(/^Keep a live board of a meeting/)
  const boardFile = (name) => path.join(kit.data, 'boards', `${name}.excalidraw`)
  const boardEls = (name) => { try { return JSON.parse(fs.readFileSync(boardFile(name), 'utf8')).elements || [] } catch { return [] } }
  const noteOf = (els, key) => els.find((e) => e.type === 'rectangle' && e.customData?.bridge?.meeting?.key === key)
  const WORDS = 'The team went through the plan for the next two weeks in some detail, step by step, so that everyone knows where things stand.'
  const LB0 = await kit.api('/meetings', { title: 'Launch sync', call: false })
  ok(/beta feature/.test(await err(`/meetings/${LB0.id}/board`, { on: true }) || '') && !('liveBoard' in await kit.api(`/meetings/${LB0.id}`)), 'off as a beta feature: the board says so, and a meeting has none')
  await kit.api(`/meetings/${LB0.id}/stop`, {})
  await kit.api('/settings', { meetings: { board: true } }, 'PATCH')
  const LB1 = await kit.api('/meetings', { title: 'Launch sync', call: false })
  ok(LB1.board === true, '(a meeting starts with its board on when every meeting has one)')
  let b0 = boardAsks().length
  said(LB1.id, [['them', 2, `We decided to ship the beta to ten customers first. ${WORDS}`]])
  await send(LB1.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  ok(!await until(() => boardAsks().length > b0, 4000) && !fs.existsSync(path.join(dirOf(LB1.id), 'board.json')), 'with the beta feature off, nothing is sent and no board is made, though the meeting has it on')
  await kit.api(`/meetings/${LB1.id}/stop`, {})
  await kit.api('/settings', { trials: { 'meeting-board': true }, meetings: { board: false } }, 'PATCH')

  const LB = await kit.api('/meetings', { title: 'Launch sync', call: false })
  ok((await kit.api(`/meetings/${LB.id}`)).liveBoard?.on === false, 'on as a beta feature, a meeting\'s board starts off unless every meeting has one')
  r = await kit.api(`/meetings/${LB.id}/board`, { on: true })
  ok(r.on === true && (await kit.api('/settings')).user?.meetings?.board === true, 'turned on for a meeting, and remembered for the next ones', r)
  ok((await kit.api(`/meetings/${LB.id}`)).liveBoard?.id === null && !boardAsks().slice(b0).length, 'no board until there\'s something to put on it')
  // The board fills in as lines come: a decision, a step with its owner and date, an action item
  // and an open question, each in its column, dashed as a suggestion with the model's name.
  said(LB.id, [['them', 2, `We decided to ship the beta to ten customers first. Priya will send the pricing deck by Friday. ${WORDS}`], ['you', 9, "Priya's beta ships on 24 Nov. Who owns the migration?"]])
  await send(LB.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  ok(!!(await until(async () => (await kit.api(`/meetings/${LB.id}`)).liveBoard?.items?.length === 4, 10000)), 'as lines come in, the board fills in by itself', (await kit.api(`/meetings/${LB.id}`)).liveBoard)
  let lb = (await kit.api(`/meetings/${LB.id}`)).liveBoard
  const ask1 = boardAsks().slice(b0)
  ok(ask1.length === 1 && /Said since the board was last updated:\n[\s\S]*ship the beta to ten customers[\s\S]*Who owns the migration\?/.test(ask1[0]) && /The board is empty so far/.test(ask1[0]), 'it was asked once, with what was said since', ask1.map((x) => x.slice(0, 300)))
  const byPart = Object.fromEntries(lb.items.map((x) => [x.part, x]))
  ok(byPart.decision?.label === 'Ship the beta to ten customers first' && byPart.step?.label === 'Beta ships · Priya · 24 Nov' && byPart.action?.label === 'Priya: Send the pricing deck · Friday' && byPart.question?.label === 'Who owns the migration?' && lb.items.every((x) => x.state === 'suggested'), 'what was decided, the timeline with its owner and date, who does what, and the open question, each a suggestion', lb.items)
  let els = boardEls(lb.id)
  const heads = els.filter((e) => e.customData?.bridge?.meeting?.heading).map((e) => [e.text, e.x])
  ok(fs.existsSync(boardFile(lb.id)) && /^Launch sync, /.test(lb.id) && JSON.stringify(heads) === JSON.stringify([['Decisions', 0], ['Timeline', 300], ['Who does what', 600], ['Open questions', 900]]), 'a whiteboard of its own, named after the meeting, with a column for each part', { id: lb.id, heads })
  ok(lb.items.every((x) => { const n = noteOf(els, x.key); return n && n.strokeStyle === 'dashed' && n.customData.bridge.suggestion?.by === 'gpt-5' && n.x === { decision: 0, step: 300, action: 600, question: 900 }[x.part] }), 'each note in its column, dashed and marked as a suggestion from the model, by name', els.filter((e) => e.type === 'rectangle').map((e) => [e.x, e.strokeStyle, e.customData?.bridge?.suggestion?.by]))
  ok((await kit.api(`/meetings/${LB.id}`)).boardId === lb.id, 'and the meeting links to it')

  // Batching: lines that come within its minute (2 s here) wait, then go in one look, with only
  // what was said since; what's on the board, yours too, is sent so it isn't said again; and the
  // model saying something that's there already doesn't put it there twice.
  const mine = { type: 'text', id: 'by-hand', x: 0, y: 900, width: 200, height: 20, text: 'Pricing page copy by Monday', originalText: 'Pricing page copy by Monday', fontSize: 16, fontFamily: 6, version: 3 }
  const moved = { ...noteOf(els, byPart.question.key), x: 960, y: 420, version: 9 }
  await kit.api(`/boards/${encodeURIComponent(lb.id)}`, { text: JSON.stringify({ type: 'excalidraw', version: 2, elements: [...els.map((e) => (e.id === moved.id ? moved : e)), mine], appState: {}, files: {} }), force: true }, 'PUT')
  const before = new Map(boardEls(lb.id).map((e) => [e.id, JSON.stringify(e)]))
  const lookedAt = () => Date.parse(JSON.parse(fs.readFileSync(path.join(dirOf(LB.id), 'board.json'), 'utf8')).at)
  const at1 = lookedAt()
  b0 = boardAsks().length
  said(LB.id, [['them', 20, `Dan will write the migration plan by Monday. ${WORDS}`]])
  await send(LB.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  said(LB.id, [['you', 40, `We agreed to keep the old pricing for existing customers. ${WORDS}`]])
  await send(LB.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  ok(!!(await until(() => boardAsks().length > b0, 8000)) && !await until(() => boardAsks().length > b0 + 1, 2500), 'lines that come close together go in one look, not one each', boardAsks().length - b0)
  const at2 = lookedAt()
  ok(at2 - at1 >= 2000, 'and not before its minute (2 s here) since the last look', at2 - at1)
  const ask2 = boardAsks()[b0] || ''
  const since2 = ask2.split('Said since the board was last updated:')[1] || ''
  ok(/migration plan/.test(since2) && /old pricing/.test(since2) && !/ten customers/.test(since2) && /Said before \(already looked at, for context\):[\s\S]*ten customers/.test(ask2), 'that look has what was said since the last, and the lines before only as context', ask2.slice(-900))
  ok(/On the board already[^\n]*:\n- Decision: Ship the beta to ten customers first\n[\s\S]*- Written on the board: Pricing page copy by Monday/.test(ask2), 'it knows what\'s on the board already, yours too', ask2.slice(0, 900))
  lb = await until(async () => { const x = (await kit.api(`/meetings/${LB.id}`)).liveBoard; return x.items.length === 6 && x }, 6000)
  ok(!!lb && lb.items.filter((x) => /ten customers/.test(x.label)).length === 1 && lb.items.some((x) => x.label === 'Dan: Write the migration plan · Monday') && lb.items.some((x) => x.label === 'Keep the old pricing for existing customers'), 'what\'s new is added; the model saying again what\'s there doesn\'t put it there twice', (lb || {}).items)
  els = boardEls(lb.id)
  const changed = [...before].filter(([id, was]) => { const now = els.find((e) => e.id === id); return !now || JSON.stringify(now) !== was })
  ok(!changed.length && noteOf(els, byPart.question.key).x === 960, 'nothing on the board is moved, changed or taken away: a note you moved and words you wrote stay as they are', changed.map(([id]) => id))
  const dan = noteOf(els, lb.items.find((x) => /Dan/.test(x.label)).key)
  const priya = noteOf(els, byPart.action.key)
  ok(dan.x === 600 && dan.y > priya.y + priya.height, 'a new note goes under the last in its column', { dan: [dan.x, dan.y], priya: [priya.x, priya.y, priya.height] })

  // How often: never more than AI Assist's level has it look. At Low, three times the wait.
  await kit.api(`/meetings/${LB.id}/assist`, { level: 'low' })
  b0 = boardAsks().length
  said(LB.id, [['them', 60, `What about the support rota over the holidays? ${WORDS}`]])
  await send(LB.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  const at3 = await until(() => { const x = lookedAt(); return x > at2 && x }, 12000)
  ok(!!at3 && at3 - at2 >= 6000, 'at AI Assist\'s Low, three times its minute after the last look', at3 - at2)
  await kit.api(`/meetings/${LB.id}/assist`, { level: 'medium' })

  // Keep and Discard from the meeting: kept, its own line back and no mark; discarded, off the
  // board with its words, and not suggested again, though the model says it again.
  lb = (await kit.api(`/meetings/${LB.id}`)).liveBoard
  const keepIt = lb.items.find((x) => x.part === 'decision' && /ten customers/.test(x.label))
  const dropIt = lb.items.find((x) => x.part === 'question' && /migration/.test(x.label))
  await kit.api(`/meetings/${LB.id}/board/${keepIt.key}`, { state: 'kept' }, 'PATCH')
  await kit.api(`/meetings/${LB.id}/board/${dropIt.key}`, { state: 'dismissed' }, 'PATCH')
  els = boardEls(lb.id)
  const keptNote = noteOf(els, keepIt.key)
  ok(keptNote && keptNote.strokeStyle === 'solid' && !keptNote.customData.bridge.suggestion && !els.some((e) => e.containerId === keptNote.id && e.customData?.bridge?.suggestion), 'Keep: its mark comes off, and its own line is back', keptNote)
  ok(!noteOf(els, dropIt.key) && !els.some((e) => /Who owns the migration/.test(e.text || '')), 'Discard: it\'s off the board, with its words')
  lb = (await kit.api(`/meetings/${LB.id}`)).liveBoard
  ok(lb.items.find((x) => x.key === keepIt.key)?.state === 'kept' && !lb.items.some((x) => x.key === dropIt.key), 'the meeting says so too')
  b0 = boardAsks().length
  said(LB.id, [['you', 80, `I'll book the launch review by Thursday. ${WORDS}`]])
  await kit.api(`/meetings/${LB.id}/board`, {})
  const ask3 = boardAsks()[b0] || ''
  ok(/Taken off the board by the user[^\n]*:\n- Open question: Who owns the migration\?/.test(ask3), 'Update now looks straight away, and is told what was taken off', ask3.slice(0, 1200))
  lb = (await kit.api(`/meetings/${LB.id}`)).liveBoard
  ok(!lb.items.some((x) => /Who owns the migration/.test(x.label)) && lb.items.some((x) => /^You: Book the launch review/.test(x.label)), 'what was taken off isn\'t put back, though the model says it again', lb.items.map((x) => x.label))
  await kit.api(`/meetings/${LB.id}/board`, { state: 'kept' }, 'PATCH')
  ok(!boardEls(lb.id).some((e) => e.customData?.bridge?.suggestion) && (await kit.api(`/meetings/${LB.id}`)).liveBoard.items.every((x) => x.state === 'kept'), 'Keep all: none waits any more')
  ok(/That isn't on the board any more/.test(await err(`/meetings/${LB.id}/board/${dropIt.key}`, { state: 'kept' }, 'PATCH') || ''), 'one that\'s gone says so')

  // Its action items onto Chief of Staff's task list, once.
  r = await kit.api(`/meetings/${LB.id}/board/tasks`, {})
  const titles = ((await kit.api('/chief/tasks')).items || []).map((x) => x.title)
  ok(r.added === 3 && titles.includes('Priya: Send the pricing deck · Friday') && titles.includes('Dan: Write the migration plan · Monday'), 'its action items go onto Chief of Staff\'s task list with one click', { r, titles })
  ok(/on the task list already/.test(await err(`/meetings/${LB.id}/board/tasks`, {}) || '') && (await kit.api(`/meetings/${LB.id}`)).liveBoard.items.filter((x) => x.part === 'action').every((x) => x.tasked), 'and only once')

  // A last look once it stops, at what was said since.
  b0 = boardAsks().length
  said(LB.id, [['them', 100, `Mia will update the status page by Friday. ${WORDS}`]])
  await kit.api(`/meetings/${LB.id}/stop`, {})
  ok(!!(await until(() => boardAsks().length > b0, 8000)) && /that has just ended/.test(boardAsks()[b0] || ''), 'once it stops, one last look takes in the last of what was said')
  ok(!!(await until(async () => (await kit.api(`/meetings/${LB.id}`)).liveBoard.items.some((x) => /^Mia: Update the status page/.test(x.label)), 5000)), 'and it stays on the board after the meeting')

  // Off for a meeting: nothing is sent.
  const LB2 = await kit.api('/meetings', { title: 'Hiring sync', call: false })
  await kit.api(`/meetings/${LB2.id}/board`, { on: false })
  ok((await kit.api('/settings')).user?.meetings?.board === false, '(off, for the next meetings too)')
  b0 = boardAsks().length
  said(LB2.id, [['them', 2, `We decided to open two roles in January. ${WORDS}`]])
  await send(LB2.id, Buffer.concat([pcm(2, true), pcm(1.5)]))
  ok(!await until(() => boardAsks().length > b0, 4000) && (await kit.api(`/meetings/${LB2.id}`)).liveBoard.id === null, 'off for a meeting, nothing is sent and there\'s no board')
  await kit.api(`/meetings/${LB2.id}/stop`, {})

  // With a model on this computer (Ollama, the stand-in's): it's asked there, and the meeting says so.
  await kit.api('/providers/ollama', { values: { OLLAMA_HOST: model.url } }, 'PUT')
  await kit.api('/settings', { meetings: { model: 'ollama:llama3.1:8b' } }, 'PATCH')
  const LL = await kit.api('/meetings', { title: 'Offsite plan', call: false })
  await kit.api(`/meetings/${LL.id}/board`, { on: true })
  said(LL.id, [['them', 2, `We decided to hold the offsite in Lisbon. ${WORDS}`]])
  const asked0 = model.requests().length
  await kit.api(`/meetings/${LL.id}/board`, {})
  const onHere = model.requests().slice(asked0).filter((x) => JSON.stringify(x.messages).includes('Keep a live board'))
  const ll = (await kit.api(`/meetings/${LL.id}`)).liveBoard
  ok(onHere.length >= 1 && onHere.every((x) => x.path === '/api/chat' && x.model === 'llama3.1:8b') && ll.use === 'ollama:llama3.1:8b' && ll.items.some((x) => /Lisbon/.test(x.label)), 'a model on this computer keeps the board, asked on this computer', { asked: onHere.map((x) => [x.path, x.model]), use: ll.use, items: ll.items })
  await kit.api(`/meetings/${LL.id}/stop`, {})
  // Answers in AI Assist with a model on this computer: asked there, held to the schema from the
  // start (the answers in it too), and it answers.
  await kit.api('/settings', { trials: { 'assist-answers': true } }, 'PATCH')
  const LA = await kit.api('/meetings', { title: 'Offsite logistics', call: false })
  await kit.api(`/meetings/${LA.id}/assist`, { on: true })
  said(LA.id, [['them', 3, 'What is the time difference between Lisbon and London?']])
  const la0 = model.requests().length
  await kit.api(`/meetings/${LA.id}/assist`, {})
  const laAsked = model.requests().slice(la0).filter((x) => JSON.stringify(x.messages).includes('Questions asked since you last looked'))
  const la = (await kit.api(`/meetings/${LA.id}`)).assistItems.filter((x) => x.kind === 'answer')
  ok(laAsked.length === 1 && laAsked[0].path === '/api/chat' && laAsked[0].model === 'llama3.1:8b' && laAsked[0].format === 'json_schema' && la.length === 1 && la[0].model === 'ollama:llama3.1:8b' && /time difference between Lisbon and London/.test(la[0].q), 'answers with a model on this computer: asked there, held to the schema, and it answers', { asked: laAsked.map((x) => [x.path, x.model, x.format]), la })
  await kit.api(`/meetings/${LA.id}/stop`, {})
  await kit.api(`/meetings/${LA.id}/assist`, { on: false })
  await kit.api('/settings', { meetings: { model: 'openai:gpt-5', board: false }, trials: { 'meeting-board': false, 'assist-answers': false } }, 'PATCH')

  // ---------- Files you got lately ----------
  // In Downloads or on the Desktop, from around when it was: one named after someone in it, a
  // resume before an interview, one that came while it recorded; not one from last month or one
  // that has nothing to do with it.
  const dl = path.join(kit.home, 'Downloads')
  fs.mkdirSync(dl, { recursive: true })
  for (const n of ['Theo_Park_CV.txt', 'resume (3).pdf', 'cat.jpg']) fs.writeFileSync(path.join(dl, n), 'x')
  fs.writeFileSync(path.join(dl, 'Theo Park notes old.txt'), 'x')
  const old = new Date(Date.now() - 40 * 86400e3)
  fs.utimesSync(path.join(dl, 'Theo Park notes old.txt'), old, old)
  const R = await kit.api('/meetings', { title: 'Interview - Theo Park', call: false })
  // On a Mac the first look into Downloads or the Desktop brings up macOS's question, so they're
  // looked in once you ask (Look in Downloads and on the Desktop), and from then on by themselves.
  if (IS_MAC) {
    const first = await kit.api(`/meetings/${R.id}/suggest`)
    ok(!(first.recent || []).length && String(first.recentAsk) === 'Downloads,Desktop', 'on a Mac, Downloads and the Desktop aren\'t looked in until you ask (macOS would ask)', first)
    await kit.api(`/meetings/${R.id}/suggest?ask=1`)
  }
  const sg = await kit.api(`/meetings/${R.id}/suggest`)
  if (IS_MAC) ok(!sg.recentAsk, 'once you have, they are, by themselves', sg)
  const names = (sg.recent || []).map((f) => f.name)
  ok(names[0] === 'Theo_Park_CV.txt' && ['name', 'title'].includes(sg.recent[0].why) && names.includes('resume (3).pdf') && names.includes('cat.jpg') && !names.includes('Theo Park notes old.txt'), 'files you got lately that look like they go with it, the best first', sg.recent)
  await kit.api(`/meetings/${R.id}/links`, { path: path.join(dl, 'Theo_Park_CV.txt') })
  ok(!(await kit.api(`/meetings/${R.id}/suggest`)).recent.some((f) => f.name === 'Theo_Park_CV.txt'), 'and not once it\'s added')
  await kit.api(`/meetings/${R.id}/stop`, {})

  // ---------- Who's talking, from the screen ----------
  // A look at the watched screen while the call talks: the text on it is kept, not the picture,
  // and naming who said what is told what the screen showed then, even with no invite to go on.
  if (IS_WIN) {
    const W = await kit.api('/meetings', { title: 'Looks', call: false })
    ok((await look(W.id)).stop === 'unreadable', 'the page is told to stop looking where pictures can\'t be read')
    await kit.api(`/meetings/${W.id}/stop`, {})
  } else {
    const G = await kit.api('/meetings', { title: 'Design sync', call: false })
    fs.writeFileSync(path.join(kit.bin, 'ocr.txt'), 'Design sync\n  Talking: Dan Ruiz\nPriya Shah   Dan Ruiz\n')
    r = await look(G.id)
    ok(r.kept === true && glances(G.id).length === 1 && glances(G.id)[0].text === 'Design sync Talking: Dan Ruiz Priya Shah Dan Ruiz', 'a look while the call talks keeps the text on the screen', [r, glances(G.id)])
    const read = fs.readFileSync(path.join(kit.bin, 'ocr.log'), 'utf8').trim().split('\n').pop()
    ok(path.dirname(read) === dirOf(G.id) && !fs.existsSync(read) && !fs.readdirSync(dirOf(G.id)).some((f) => /^glance-/.test(f)), 'and not the picture', [read, fs.readdirSync(dirOf(G.id))])
    ok((await look(G.id)).kept === false && glances(G.id).length === 1, 'the same screen again isn\'t kept twice')
    ok(/isn't a picture/.test((await look(G.id, Buffer.from('x'.repeat(200)))).error || ''), 'something that isn\'t a picture is turned down')
    await kit.api(`/meetings/${G.id}/stop`, {})
    fs.writeFileSync(path.join(kit.bin, 'ocr.txt'), 'Talking: Priya Shah')
    ok((await look(G.id)).kept === false && glances(G.id).length === 1, 'nor once it stopped')
    said(G.id, [['them', 0.5, 'Here is the agenda for the redesign.'], ['them', 6, 'And the budget for it.']])
    const n5 = model.asked(/Say who said each numbered Them line/).length
    await kit.api(`/meetings/${G.id}/summary`, {})
    const ask2 = (await until(() => model.asked(/Say who said each numbered Them line/).slice(n5)[0], 15000)) || ''
    ok(/There is no list of who was invited/.test(ask2) && /\] On the screen as Them talked: Design sync Talking: Dan Ruiz/.test(ask2), 'with no invite, the summary first works out who said what, told what the screen showed as they talked', ask2.slice(ask2.indexOf('Transcript:'), ask2.indexOf('Transcript:') + 300))
    const gs = await until(async () => { const m = await kit.api(`/meetings/${G.id}`); return !m.summarizing && m.transcript.some((l) => l.name) && m }, 10000)
    ok(!!gs && gs.transcript.find((l) => /agenda/.test(l.text)).name === 'Dan Ruiz', 'and the lines are named', gs?.transcript)
    await kit.api('/settings', { meetings: { nameSpeakers: false } }, 'PATCH')
    const G2 = await kit.api('/meetings', { title: 'No looks', call: false })
    ok((await look(G2.id)).stop === 'off' && !glances(G2.id).length, 'with Name who spoke off, no looks are kept and the page is told to stop')
    await kit.api(`/meetings/${G2.id}/stop`, {})
    await kit.api('/settings', { meetings: { nameSpeakers: true } }, 'PATCH')

    // Pictures of the watched screen as it changes: one is kept when its words are new (the next
    // slide, a call's own view after them), not the same slide again, nor the call with a notice
    // come and gone. Capture keeps one whatever's on it.
    const S = await kit.api('/meetings', { title: 'Quarterly deck', call: false })
    const shoot = (text, kind = 'auto') => { fs.writeFileSync(path.join(kit.bin, 'ocr.txt'), text); return fetch(`${kit.url}/api/meetings/${S.id}/captures?kind=${kind}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG }).then((x) => x.json()) }
    const slide = (n) => [`Quarterly plan ${n}`, ...Array.from({ length: 12 }, (_, i) => `point${n}x${i} detail${n}y${i}`)].join('\n')
    const meet = 'Weekly sync\nPriya Shah  Dan Ruiz\nMara Lind  Theo Park  Tester\nAsk Gemini  Only you'
    const got = [await shoot(slide(1)), await shoot(slide(1)), await shoot(slide(2)), await shoot(meet), await shoot(`${meet}\nThis video is paused due to problems with your network`), await shoot(meet), await shoot(meet, 'screen')]
    const kept = got.map((x) => (x.kept === false ? 'no' : x.id ? 'yes' : 'error'))
    ok(kept.join(' ') === 'yes no yes yes no no yes', 'pictures of a changing screen: a new slide and a new view are kept, the same again or a notice that came and went aren\'t, and Capture always is', kept)
    const S1 = await kit.api(`/meetings/${S.id}`)
    ok(S1.captures.length === 4 && fs.readdirSync(path.join(dirOf(S.id), 'captures')).length === 4 && S1.captures[0].read === 'done' && /Quarterly plan 1/.test(S1.captures[0].text), 'and nothing is left of the ones left out', { captures: S1.captures.length, files: fs.readdirSync(path.join(dirOf(S.id), 'captures')).length })
    await kit.api(`/meetings/${S.id}/stop`, {})
  }

  // ---------- What the summary is written from ----------
  // Your notes are its backbone, and it ends saying which of your points it expanded. A note written
  // at a time in the meeting is in the transcript at that time too, with the screen changing there
  // (the first words on it: a slide's title); a picture pasted in your notes is the words on it,
  // where you put it; the meeting's files and what the invite says go with it. What it was written
  // from is kept for the page. The words on pictures are read by a stand-in, not on Windows.
  const W = await kit.api('/meetings', { title: 'Pricing review', call: false, event: { title: 'Pricing review', attendees: ['Priya Shah', 'Tester'], agenda: 'Agree the enterprise tiers before the launch' } })
  const picture = async (kind, t, text) => {
    if (!IS_WIN) fs.writeFileSync(path.join(kit.bin, 'ocr.txt'), text)
    const c = await fetch(`${kit.url}/api/meetings/${W.id}/captures?kind=${kind}&t=${t}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG }).then((x) => x.json())
    if (!IS_WIN) await until(async () => (await kit.api(`/meetings/${W.id}`)).captures.find((x) => x.id === c.id)?.read === 'done', 10000)
    return c
  }
  await picture('screen', 1, 'Enterprise tiers\nStarter $10\nTeam $25')
  const pasted = await picture('paste', 20, 'Discount table\nannual 15%')
  await kit.api(`/meetings/${W.id}/notes`, { text: `## Pricing\n- tiers ok?\n![Discount table](${pasted.file})\n` }, 'PUT')
  await kit.api(`/meetings/${W.id}/note`, { text: 'annual = 15% off', at: 32 })
  fs.writeFileSync(path.join(kit.home, 'Pricing brief.md'), 'Pricing brief\nEnterprise starts at 50 seats.')
  await kit.api(`/meetings/${W.id}/links`, { path: path.join(kit.home, 'Pricing brief.md') })
  await kit.api(`/meetings/${W.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${W.id}`)).status === 'done', 10000)
  said(W.id, [['them', 2, 'Here are the three tiers on this slide.'], ['you', 30, 'What about annual plans?'], ['them', 40, 'Fifteen percent off for annual.']])
  const w0 = model.asked(/Write meeting notes in Markdown/).length
  await kit.api(`/meetings/${W.id}/summary`, {})
  const wsum = (await until(() => model.asked(/Write meeting notes in Markdown/).slice(w0)[0], 15000)) || ''
  const wpart = (from, to) => wsum.slice(wsum.indexOf(from), to ? wsum.indexOf(to) : undefined)
  ok(/The user's own notes below are the backbone/.test(wsum) && /add "## From your notes": one bullet for each of their points you expanded/.test(wsum), 'your notes are the backbone of the summary, and it says which of your points it expanded', wpart('own notes below', 'Transcript:'))
  ok(/\n\[0:30\] You: What about annual plans\?\n\[0:32\] \(You wrote a note here: "annual = 15% off"\)\n\[0:40\] /.test(wsum), 'a note written at a time in the meeting is in the transcript at that time', wpart('Transcript:'))
  ok(/The user's own notes:\n## Pricing\n- tiers ok\?\n\[A picture \("Discount table"\)(\. The words on it: Discount table \/ annual 15%)?\]\n/.test(wsum) && (IS_WIN || /The words on it: Discount table \/ annual 15%\]/.test(wsum)), 'a picture in your notes is what it shows, where you put it', wpart("The user's own notes:", 'Transcript:'))
  if (IS_WIN) skip('the screen changing, in the transcript at its time', 'the words on pictures aren\'t read on Windows')
  else ok(/\n\[0:01\] \(The screen showed: "Enterprise tiers \/ Starter \$10 \/ Team \$25"\)\n\[0:02\] /.test(wsum) && /What was on the screen during the meeting[^\n]*\n\[0:01\] Enterprise tiers/.test(wsum) && !/Pictures the user added/.test(wsum), 'the screen changing is in the transcript at its time (a slide\'s first words), and in full with the screen\'s words', wpart('What was on the screen', 'Transcript:'))
  ok(/^The invite says: Agree the enterprise tiers before the launch$/m.test(wsum), 'what the invite says goes with it', wsum.slice(0, 300))
  const wm = await until(async () => { const m = await kit.api(`/meetings/${W.id}`); return !m.summarizing && m.summaryFrom && m }, 10000)
  const from = wm?.summaryFrom || {}
  ok(/### Pricing brief\.md\nPricing brief\nEnterprise starts at 50 seats\./.test(wsum) && from.notes === 2 && from.files === 1 && from.invite === true && from.screen === (IS_WIN ? 0 : 1) && from.pictures === (IS_WIN ? 0 : 1), "the meeting's files go with it, and what it was written from is kept for the page", { from, files: wpart('Files, links and emails', 'Transcript:') })
  // Notes written in another language: the action items are under the first heading with a
  // checklist. Sent to the Chief of Staff (not running here: on its task list), and the meeting says so.
  fs.writeFileSync(path.join(dirOf(W.id), 'summary.md'), '## Zusammenfassung\n- Preise stehen.\n\n## Aufgaben\n- [ ] Du: die Preise an Priya senden\n- [ ] Priya: Rabatt prüfen\n')
  r = await kit.api(`/meetings/${W.id}/chief`, {}).catch((e) => ({ error: e.message }))
  const sentTo = (await kit.api(`/meetings/${W.id}`)).chief
  ok(r.added === 2 && r.sent === false && sentTo?.n === 2 && Date.now() - Date.parse(sentTo.at) < 60000, 'the action items of notes in another language go to the Chief of Staff, and the meeting keeps that they did', [r, sentTo])

  // ---------- The summary and the saved notes ----------
  const n1 = model.asked(/Write meeting notes in Markdown/).length
  await kit.api(`/meetings/${A.id}/summary`, {})
  const sum = (await until(() => model.asked(/Write meeting notes in Markdown/).slice(n1)[0], 15000)) || ''
  ok(/"Section 1", "Demo", "Q&A"/.test(sum) && /\n## Demo \(from 0:0\d\)\n/.test(sum) && /\] Dan Ruiz: These slides/.test(sum), 'the summary is asked for its sections, with the headings and names in the transcript', sum.slice(sum.indexOf('Transcript:'), sum.indexOf('Transcript:') + 500))
  ok(/The user's own notes:\n## Q&A\n/.test(sum), 'your notes go in without a heading nothing was written under', sum.slice(sum.indexOf('own notes'), sum.indexOf('own notes') + 80))
  await until(async () => (await kit.api(`/meetings/${A.id}`)).summary, 10000)
  const terms = (await kit.api('/meetings/memory')).terms
  ok(terms.find((x) => x.term === 'Priya')?.note === 'fixing the login bug before the beta' && !terms.some((x) => x.term === 'Zed'), 'who someone is goes in meeting memory from the summary, only for a name the meeting knows', terms.map((x) => [x.term, x.note]))
  const saved = await kit.api(`/meetings/${A.id}/save`, {})
  const files = saved.files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  ok(/## Demo/.test(files) && /### Dan Ruiz \(/.test(files) && /### Tester \(/.test(files) && /## Summary/.test(files), 'saved Markdown: the summary, a heading per section, who said it (you by your name)', files.slice(0, 600))

  // A meeting mentioned in a message: found by every word of its name, the latest first with none;
  // and as one file for the agent, named for it, beside the meeting.
  const found = (await kit.api('/meetings/mentions?q=quarterly PLAN')).meetings
  ok(found.length === 1 && found[0].id === A.id && found[0].hasSummary, 'a meeting to mention is found by the words of its name, any case', found)
  ok((await kit.api('/meetings/mentions?q=quarterly%20budget')).meetings.length === 0, 'every word has to be in it')
  const latest = (await kit.api('/meetings/mentions')).meetings
  ok(latest.length >= 2 && latest.every((x, i) => !i || latest[i - 1].startedAt >= x.startedAt), 'with nothing typed, the latest first', latest.map((x) => x.title))
  const ref = await kit.api(`/meetings/${A.id}/for-agents`, {})
  const refText = fs.readFileSync(ref.path, 'utf8')
  ok(path.basename(ref.path) === 'Quarterly plan.md' && ref.path.startsWith(path.join(kit.data, 'meetings', A.id)) && /^# Quarterly plan\n/.test(refText) && /## Summary/.test(refText) && /## Transcript/.test(refText) && /\] Dan Ruiz: These slides/.test(refText) && /## Demo \(from 0:0\d\)/.test(refText), 'mentioned: the meeting as one file for the agent, named for it, beside the meeting, with its summary and the transcript in sections', refText.slice(0, 300))
  ok((await kit.api('/config')).meetingKey === '@', 'the meeting key is @ to begin with')
  await kit.api('/settings', { meetings: { mentionKey: '#' } }, 'PATCH')
  ok((await kit.api('/config')).meetingKey === '#', 'and the one picked in Settings › Meetings')
  await kit.api('/settings', { meetings: { mentionKey: 'x' } }, 'PATCH')
  ok((await kit.api('/config')).meetingKey === '@', 'one the app doesn\'t offer is @')
  await kit.api('/settings', { meetings: { mentionKey: null } }, 'PATCH')

  // Open on a file sent to the meeting: a document opens, one that could run something (a .command)
  // is shown in Finder instead (tests open nothing: the command comes back).
  const sendFile = (name) => fetch(`${kit.url}/api/meetings/${A.id}/files?name=${encodeURIComponent(name)}`, { method: 'POST', body: 'echo hi' }).then((r) => r.json())
  const doc = await sendFile('notes.txt')
  const script = await sendFile('run-me.command')
  const opened = (await kit.api(`/meetings/${A.id}/links/${doc.id}/open`, {})).dry || []
  const shown = (await kit.api(`/meetings/${A.id}/links/${script.id}/open`, {})).dry || []
  // Shown in its folder: open -R, explorer /select, or xdg-open on the folder rather than the file.
  const revealed = (d, name) => d.includes('-R') || d.some((a) => /^\/select,/.test(a)) || (d[0] === 'xdg-open' && !String(d[1] || '').endsWith(name))
  ok(!revealed(opened, 'notes.txt') && /notes\.txt$/.test(opened.at(-1) || ''), 'Open opens a document sent to the meeting', opened)
  ok(revealed(shown, 'run-me.command'), 'but a file that could run something is shown in its folder instead', shown)

  // ---------- Notes by a model on this computer ----------
  // A stand-in Ollama (stand-ins/local-model.mjs) whose model takes 8,192 tokens, and which, like
  // Ollama, cuts a longer prompt without a word: an hour's meeting goes in pieces that each fit the
  // context it's asked for, every line in exactly one, and the notes say it was read in parts.
  const local = await startLocalModel('meetings-api', 'ollama', [{ name: 'llama3.2:3b', context: 8192, loaded: null, params: '3.2B' }])
  try {
    await kit.api('/providers/ollama', { values: { OLLAMA_HOST: local.url } }, 'PUT')
    const L = await kit.api('/meetings', { title: 'Long planning call', call: false })
    await kit.api(`/meetings/${L.id}/stop`, {})
    await until(async () => (await kit.api(`/meetings/${L.id}`)).status === 'done', 15000)
    const N = 160
    said(L.id, Array.from({ length: N }, (_, i) => ['you', 10 + i * 20, `Line ${i + 1}: we went through the rollout plan for the new billing system, region by region, and agreed who checks each step before it goes live.`]))
    await kit.api(`/meetings/${L.id}/summary`, { model: 'ollama:llama3.2:3b' })
    const lm = await until(async () => { const m = await kit.api(`/meetings/${L.id}`); return !m.summarizing && (m.summary || m.summaryError) && m }, 30000)
    const reqs = local.sent()
    const parts = reqs.filter((x) => /This is part \d+ of \d+/.test(x.user))
    ok(reqs.length >= 3 && reqs.every((x) => x.path === '/api/chat' && x.num_ctx && x.num_ctx <= 8192 && x.tokens <= x.num_ctx && !x.cut), 'notes by a model on this computer: each request fits the context it asks Ollama for, within what the model takes, so nothing is cut', reqs.map((x) => ({ path: x.path, num_ctx: x.num_ctx, tokens: x.tokens, cut: x.cut })))
    const seen = parts.flatMap((x) => x.read || [])
    ok(parts.length >= 2 && seen.length === N && new Set(seen).size === N, `the meeting goes in ${parts.length} pieces, and the model reads every line, each in exactly one of them`, { parts: parts.length, lines: seen.length, distinct: new Set(seen).size })
    ok(/Notes on this computer/.test(lm?.summary || '') && lm.summaryModel === 'ollama:llama3.2:3b', 'and the notes are written by it', { summary: lm?.summary, error: lm?.summaryError })
    ok(/llama3\.2:3b takes 8192 tokens at a time, so it read the meeting in \d+ parts/.test(lm?.summaryNote || ''), 'saying it read the meeting in parts, as its context is short', lm?.summaryNote)
  } finally { local.stop() }

  // ---------- Folders and the archive ----------
  const B = await kit.api('/meetings', { title: 'Vendor call', call: false })
  await kit.api(`/meetings/${B.id}/stop`, {})
  said(B.id, [['them', 1, 'Let me share the slides.']])
  await kit.api(`/meetings/${A.id}`, { folder: 'Planning' }, 'PATCH')
  await kit.api('/meetings/bulk', { ids: [B.id], action: 'folder', folder: 'Vendors' })
  const list = (await kit.api('/meetings')).meetings
  ok(list.find((x) => x.id === A.id).folder === 'Planning' && list.find((x) => x.id === B.id).folder === 'Vendors', 'meetings go in folders', list.map((x) => [x.title, x.folder]))
  ok((await kit.api('/meetings/search?q=slides')).results.length === 2, 'search finds both')
  await kit.api(`/meetings/${B.id}`, { archived: true }, 'PATCH')
  ok((await kit.api('/meetings/search?q=slides')).results.map((x) => x.id).join() === A.id, 'an archived one is left out of search')
  ok((await kit.api('/meetings/search?q=slides&archived=1')).results.map((x) => x.id).join() === B.id, 'and found in the archive')
  const n2 = model.asked(/Answer from these meetings only/).length
  await kit.api('/meetings/ask', { question: 'What were the slides about?' })
  const all = model.asked(/Answer from these meetings only/).slice(n2)[0] || ''
  ok(/"Quarterly plan"/.test(all) && !/"Vendor call"/.test(all), 'and out of questions about your meetings', all.slice(0, 200))
  const C = await kit.api('/meetings', { title: 'Live one', call: false })
  ok(/Still recording/.test(await err(`/meetings/${C.id}`, { archived: true }, 'PATCH') || ''), 'one still recording can\'t be archived')
  await kit.api(`/meetings/${C.id}/stop`, {})
  ok((await kit.api('/meetings/bulk', { ids: [B.id], action: 'unarchive' })).done.length === 1, 'out of the archive again')
  ok((await kit.api('/meetings/bulk', { ids: [C.id], action: 'delete' })).done.length === 1 && !(await kit.api('/meetings')).meetings.some((x) => x.id === C.id), 'deleted')

  // ---------- Action items into work ----------
  // A project in git with a GitHub remote (nothing reached: gh is a stand-in that knows one pull
  // request), a stand-in Claude Code, and a meeting about the project. Each action item: the project
  // it names first (and why), what an agent would be told (the item, what was said about it, what was
  // decided), started on its own branch in a space named after the meeting; one to Chief of Staff
  // (its task's state shows), one ticked done. Then the next meeting in the series, one with the same
  // people, one with the same customer, and an event about to start: what happened since last time.
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await kit.api('/agents/catalog') // looked for again
  kit.program('gh', `const a = process.argv.slice(2)
if (a[0] === 'repo') { console.log('main'); process.exit(0) }
if (a[0] === 'pr' && a[1] === 'view') { console.log(JSON.stringify({ number: 212, state: 'OPEN', url: 'https://github.com/example/payments-api/pull/212', title: 'Retry the webhook', isDraft: false, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] })); process.exit(0) }
process.exit(1)`)
  // Each call answers, a refusal as { error }, so every check below says what it found.
  const tryApi = (p, body, method) => kit.api(p, body, method).catch((e) => ({ error: e.message }))
  const repo = path.join(kit.home, 'code', 'payments-api')
  const site = path.join(kit.home, 'code', 'website')
  for (const d of [repo, site]) fs.mkdirSync(d, { recursive: true })
  const inRepo = (...a) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', ...a], { cwd: repo, encoding: 'utf8' })
  const madeRepo = inRepo('init', '-q').status === 0 && inRepo('commit', '-q', '--allow-empty', '-m', 'start').status === 0 && inRepo('remote', 'add', 'origin', 'https://github.com/example/payments-api.git').status === 0
  await kit.api('/projects', { paths: [site, repo] })
  // Whether the server can use git here (the test's own PATH can have a git its server's doesn't,
  // as on Windows): without it, the agent starts in the project itself, with no branch of its own.
  const hasGit = madeRepo && !!(await tryApi(`/repo?dir=${encodeURIComponent(repo)}`)).repo
  const PS = await kit.api('/meetings', { title: 'Weekly payments sync', call: false, event: { title: 'Weekly payments sync', attendees: ['Priya Shah', 'Mia Chen', 'Ola Berg', 'Tester'] } })
  await kit.api(`/meetings/${PS.id}/stop`, {})
  await kit.api(`/meetings/${PS.id}`, { startedAt: new Date(Date.now() - 7 * 86400e3).toISOString() }, 'PATCH')
  said(PS.id, [['them', 2, 'The Stripe webhook in payments-api retries forever when it gets a 500.'], ['you', 6, 'I can fix the retry this week, with a backoff.'], ['them', 10, 'Great. Also the pricing doc for Acme is ready to send.'], ['you', 14, 'And the website copy needs a look.']])
  fs.writeFileSync(path.join(dirOf(PS.id), 'summary.md'), '## Summary\n- Webhook retries and pricing.\n\n## Decisions\n- Retry with a backoff, at most five times.\n\n## Action items\n- [ ] You: fix the retry on the Stripe webhook in payments-api\n- [ ] Priya: send the pricing doc to Acme\n- [ ] Dan: review the website copy\n')
  let w = await tryApi(`/meetings/${PS.id}/work`)
  ok(w.items?.length === 3 && w.items?.every((x) => x.state === 'open' && !x.agent && !x.chief) && w.items?.[0]?.yours && !w.items?.[1]?.yours, 'its action items, none handed on yet, the first one yours', w)
  const [fixIt = {}, docIt = {}, copyIt = {}] = w.items || []
  const prep = await tryApi(`/meetings/${PS.id}/work/${fixIt.key}`)
  ok(prep.projects?.[0]?.path === repo && prep.projects?.[0].why.includes('item') && prep.projects?.[0].why.some((x) => /^said/.test(x)), 'the project it names comes first, saying why (named in the item, said in the meeting)', prep.projects)
  ok(String(prep.prompt).includes('“Weekly payments sync”') && String(prep.prompt).includes('with Priya Shah, Mia Chen, Ola Berg') && String(prep.prompt).includes('> You: fix the retry on the Stripe webhook in payments-api') && /\[0:02\] Them: The Stripe webhook/.test(prep.prompt) && /\[0:06\] Tester: I can fix the retry/.test(prep.prompt) && /What the meeting decided:\n- Retry with a backoff/.test(prep.prompt), 'what it would be told: the meeting, the item, what was said about it and what was decided', prep.prompt)
  ok(prep.label === 'Fix the retry on the Stripe webhook', 'a short name from its first words', prep.label)
  const webPrep = await tryApi(`/meetings/${PS.id}/work/${copyIt.key}`)
  ok(webPrep.projects?.[0]?.path === site, 'another item: the project it names', webPrep.projects)
  if (!hasGit) skip('the agent on a branch of its own, and its pull request', 'the server has no git here')
  {
    const started = await tryApi(`/meetings/${PS.id}/work/${fixIt.key}/agent`, { cwd: repo, kind: 'claude', own: hasGit }).catch((e) => ({ error: e.message }))
    ok(!!started.paneId && (!hasGit || /^bridge\/fix-the-retry-on-the-stripe-webhook/.test(started.worktree?.branch || '')) && /payments-api$/.test(started.agent?.projectName || ''), 'Start an agent: in the project, on a branch of its own', started)
    const fleet = await until(async () => { const f = await kit.api('/fleet'); return f.agents.some((a) => a.paneId === started.paneId) && f }, 15000)
    const ag = fleet?.agents.find((a) => a.paneId === started.paneId)
    const space = fleet?.workspaces.find((x) => x.id === ag?.workspaceId)
    ok((!hasGit || ag?.worktree?.branch === started.worktree?.branch) && space?.label === 'Weekly payments sync', 'in a space named after the meeting', { ag, space })
    // What it was told: its first message, in the stand-in's session log (its terminal can take a
    // while to start, and the stand-in writes its log over a moment).
    const projects = path.join(kit.home, '.claude', 'projects')
    const told = await until(() => {
      for (const d of fs.existsSync(projects) ? fs.readdirSync(projects).filter((x) => x.includes(hasGit ? 'fix-the-retry' : 'payments-api')) : []) {
        for (const f of fs.readdirSync(path.join(projects, d)).filter((x) => x.endsWith('.jsonl'))) {
          const first = fs.readFileSync(path.join(projects, d, f), 'utf8').split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).find((e) => e?.type === 'user')
          if (first) return String(first.message.content)
        }
      }
      return null
    }, 60000, 1000)
    ok(!!told && told.includes('> You: fix the retry on the Stripe webhook in payments-api') && told.includes('What was said about it'), "it's told the item and what was said about it", told)
    w = await until(async () => { const x = await tryApi(`/meetings/${PS.id}/work`); return x.items?.[0]?.agent && (!hasGit || x.items[0].agent.pr) && x }, 15000)
    const a0 = w?.items?.[0]
    ok(a0?.agent?.live && (hasGit ? a0.agent.branch === started.worktree.branch && a0.agent.pr?.number === 212 && a0.agent.pr.checks?.pass === 1 && a0.state === 'review' : !a0.agent.branch), 'what became of it: the agent, its branch and its pull request (checks pass)', a0)
  }
  // To Chief of Staff, one item: on its task list, and the item says so; its task's state and outcome show.
  r = await tryApi(`/meetings/${PS.id}/chief`, { items: [docIt.text] })
  w = await tryApi(`/meetings/${PS.id}/work`)
  const task = ((await tryApi('/chief/tasks')).items || []).find((x) => /send the pricing doc to Acme/.test(x.title))
  ok(r.added === 1 && w.items?.[1]?.chief?.task === task?.id && w.items?.[1]?.chief.status === 'open' && !w.items?.[2]?.chief, 'To Chief of Staff: one item on its task list, and the item keeps its task', { r, item: w.items?.[1], task })
  await tryApi(`/chief/tasks/${task?.id}`, { status: 'waiting', needs: 'Which pricing tier?' }, 'PATCH')
  ok((await tryApi(`/meetings/${PS.id}/work`)).items?.[1]?.state === 'needs', 'Chief of Staff waiting on you: it needs you')
  await tryApi(`/chief/tasks/${task?.id}`, { status: 'done', outcome: 'Drafted the email to Acme' }, 'PATCH')
  w = await tryApi(`/meetings/${PS.id}/work`)
  ok(w.items?.[1]?.state === 'done' && w.items?.[1]?.chief.outcome === 'Drafted the email to Acme', 'and done, with what it did', w.items?.[1])
  // Send action items to Chief of Staff: only the ones not handed on yet.
  r = await tryApi(`/meetings/${PS.id}/chief`, {})
  ok(r.added === 1, 'Send action items to Chief of Staff sends only the ones not handed on yet', r)
  await tryApi(`/meetings/${PS.id}/work/${copyIt.key}/done`, { done: true })
  w = await tryApi(`/meetings/${PS.id}/work`)
  ok(w.items?.[2]?.done && w.items?.[2]?.state === 'done', 'ticked done by hand', w.items?.[2])
  // A summary written again in other words keeps what became of each item.
  fs.writeFileSync(path.join(dirOf(PS.id), 'summary.md'), '## Action items\n- [ ] You: fix the retry on the Stripe webhook in payments-api, with a backoff\n- [ ] Priya: send the pricing doc to Acme\n- [ ] Dan: review the website copy\n')
  w = await tryApi(`/meetings/${PS.id}/work`)
  ok(w.items?.[2]?.done && !!w.items?.[0]?.agent?.paneId, 'a summary written again keeps what became of its items', (w.items || []).map((x) => [x.text, x.state]))
  fs.writeFileSync(path.join(dirOf(PS.id), 'summary.md'), '## Summary\n- Webhook retries and pricing.\n\n## Decisions\n- Retry with a backoff, at most five times.\n\n## Action items\n- [ ] You: fix the retry on the Stripe webhook in payments-api\n- [ ] Priya: send the pricing doc to Acme\n- [ ] Dan: review the website copy\n')

  // Sent again with nothing new: every item again, and the ones already on Chief of Staff's list
  // (and not done) are the same tasks, not copies.
  const RS = await kit.api('/meetings', { title: 'Vendor review', call: false })
  await kit.api(`/meetings/${RS.id}/stop`, {})
  fs.writeFileSync(path.join(dirOf(RS.id), 'summary.md'), '## Action items\n- [ ] Ola: book the offsite venue\n- [ ] Mia: send the vendor shortlist\n')
  const openTitles = async () => ((await tryApi('/chief/tasks')).items || []).filter((x) => x.status !== 'done').map((x) => x.title.toLowerCase())
  r = await tryApi(`/meetings/${RS.id}/chief`, {})
  const openBefore = await openTitles()
  const again = await tryApi(`/meetings/${RS.id}/chief`, {})
  const openAfter = await openTitles()
  ok(r.added === 2 && again.added === 2 && openAfter.length === openBefore.length && openAfter.filter((x) => /offsite venue|vendor shortlist/.test(x)).length === 2, 'Send again with nothing new: the same two tasks, no copies on Chief of Staff\'s list', { first: r.added, again: again.added, before: openBefore, after: openAfter })

  // Since last time. The next one in the series (its name, without the date): the last one's items.
  const P2 = await kit.api('/meetings', { title: 'Weekly payments sync (Nov 7)', call: false })
  let since = await tryApi(`/meetings/${P2.id}/since`)
  ok(since.last?.id === PS.id && since.last.why === 'series' && since.counts?.all === 3 && since.counts?.done === 2 && since.counts?.prs === (hasGit ? 1 : 0), 'the next in the series: what became of the last one\'s items (2 of 3 done, a pull request open)', since)
  await kit.api(`/meetings/${P2.id}/stop`, {})
  // The same people, whatever it's called.
  const Q = await kit.api('/meetings', { title: 'Roadmap review', call: false, event: { title: 'Roadmap review', attendees: ['Ola Berg', 'priya.shah@example.com', 'Mia Chen'] } })
  since = await tryApi(`/meetings/${Q.id}/since`)
  ok(since.last?.id === PS.id && since.last.why === 'people', 'the same people, another name: since the last meeting with them', since.last)
  await kit.api(`/meetings/${Q.id}/stop`, {})
  // The same customer: an email domain both share, or a customer in meeting memory.
  const N1 = await kit.api('/meetings', { title: 'Onboarding call', call: false, event: { title: 'Onboarding call', attendees: ['sam@example.org', 'Tester'] } })
  await kit.api(`/meetings/${N1.id}/stop`, {})
  await kit.api(`/meetings/${N1.id}`, { startedAt: new Date(Date.now() - 2 * 86400e3).toISOString() }, 'PATCH')
  fs.writeFileSync(path.join(dirOf(N1.id), 'summary.md'), '## Action items\n- [ ] You: send Northwind the API keys\n')
  since = await tryApi(`/meetings/since?${new URLSearchParams({ title: 'Kickoff', people: 'jo@example.org, Tester' })}`)
  ok(since.last?.id === N1.id && since.last.why === 'customer' && since.last.customer === 'example.org' && since.items?.[0]?.state === 'open', 'an event with someone else from the same customer (their email): since the last one with them', since)
  await kit.api('/meetings/memory', { term: 'Acme', note: 'customer, buys the enterprise plan' })
  const A1 = await kit.api('/meetings', { title: 'Acme pricing', call: false })
  await kit.api(`/meetings/${A1.id}/stop`, {})
  await kit.api(`/meetings/${A1.id}`, { startedAt: new Date(Date.now() - 3 * 86400e3).toISOString() }, 'PATCH')
  fs.writeFileSync(path.join(dirOf(A1.id), 'summary.md'), '## Action items\n- [ ] You: send Acme the quote\n')
  since = await tryApi(`/meetings/since?${new URLSearchParams({ title: 'Acme renewal', people: 'Lee Wong' })}`)
  ok(since.last?.id === A1.id && since.last.why === 'customer', 'an event named after a customer in meeting memory: since the last meeting about them', since.last)
  // Your own organisation's domain (most meetings have someone from it) isn't a customer.
  for (const who of ['lee@example.com', 'kai@example.com']) {
    const x = await kit.api('/meetings', { title: `Chat with ${who.split('@')[0]}`, call: false, event: { title: 'Chat', attendees: [who, 'Tester'] } })
    await kit.api(`/meetings/${x.id}/stop`, {})
    fs.writeFileSync(path.join(dirOf(x.id), 'summary.md'), '## Action items\n- [ ] You: share the notes\n')
  }
  since = await tryApi(`/meetings/since?${new URLSearchParams({ title: 'Planning poker', people: 'ana@example.com' })}`)
  ok(since.last === null, 'a colleague from your own organisation (its domain in most meetings) isn\'t taken for a customer', since.last)
  since = await tryApi(`/meetings/since?${new URLSearchParams({ title: 'Weekly payments sync', people: 'Priya Shah, Mia Chen' })}`)
  ok(since.last?.id === PS.id, 'an event about to start in the series: since its last one (not one without a summary yet)', since.last)
  since = await tryApi(`/meetings/since?${new URLSearchParams({ title: 'Meeting', people: '' })}`)
  ok(since.last === null, 'a meeting with only a plain name and nobody listed follows on from nothing', since)

  // ---------- Resume recording ----------
  // A meeting that ended records again: the same one, its time carrying on past what it had, its
  // audio in a new part whose start is kept (so Transcribe again puts its lines where they were),
  // and its summary said to be out of date, or written again when summaries are written by
  // themselves. Not while another one records, or it's recording already.
  { // names of its own, apart from the ones above
  await kit.api('/settings', { meetings: { autoSummary: false, cleanup: false } }, 'PATCH')
  const meetingJson = (id) => JSON.parse(fs.readFileSync(path.join(dirOf(id), 'meeting.json'), 'utf8'))
  const RR = await kit.api('/meetings', { title: 'Vendor review', call: false })
  // The call's lines are said well away from the mic's (a line of yours beside one of theirs with
  // the same words is taken for the call heard by your mic), and its first part is the shorter.
  await send(RR.id, Buffer.concat([pcm(9), pcm(2, true), pcm(1)]))
  await send(RR.id, Buffer.concat([pcm(0.2), pcm(1, true), pcm(0.3)]), 'them')
  await kit.api(`/meetings/${RR.id}/stop`, {})
  const r1 = await until(async () => { const m = await kit.api(`/meetings/${RR.id}`); return m.status === 'done' && m.transcript.length >= 2 && m }, 20000)
  ok(!!r1 && r1.seconds === 12, 'a meeting of 12 s ends', r1 && [r1.status, r1.seconds, r1.transcript.length])
  await kit.api(`/meetings/${RR.id}/summary`, {})
  await until(async () => { const m = await kit.api(`/meetings/${RR.id}`); return !m.summarizing && m.summary }, 15000)
  const OO = await kit.api('/meetings', { title: 'Another one', call: false })
  ok(/"Another one" is recording\. Stop it first\./.test(await err(`/meetings/${RR.id}/reopen`, {}) || ''), 'Resume recording says no while another meeting records, and which')
  await kit.api(`/meetings/${OO.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${OO.id}`)).status === 'done', 10000)
  r = await tryApi(`/meetings/${RR.id}/reopen`, {})
  ok(r.id === RR.id && r.status === 'recording' && r.endedAt === null && r.resumedFrom === 12 && !!r.resumedAt, 'Resume recording: the same meeting records again, from where it had got to', r)
  ok(/recording already/.test(await err(`/meetings/${RR.id}/reopen`, {}) || ''), 'not twice')
  await kit.api(`/meetings/${RR.id}/note`, { text: 'back after the break' })
  ok(/- \[0:1[2-6]\] back after the break/.test(notes(RR.id)), 'a quick note is at the meeting\'s time, carried on', notes(RR.id))
  ok((await kit.api('/calls')).recording?.resumedFrom === 12, 'the floating card is told where it carried on from')
  await send(RR.id, Buffer.concat([pcm(0.5), pcm(2, true), pcm(1.5)]))
  await send(RR.id, Buffer.concat([pcm(10), pcm(1.5, true), pcm(0.5)]), 'them')
  await kit.api(`/meetings/${RR.id}/stop`, {})
  const r2 = await until(async () => { const m = await kit.api(`/meetings/${RR.id}`); return m.status === 'done' && m.transcript.length >= 4 && m }, 20000)
  const keys1 = (r1?.transcript || []).map((l) => l.key)
  const fresh = (r2?.transcript || []).filter((l) => !keys1.includes(l.key))
  ok(!!r2 && keys1.every((k) => r2.transcript.some((l) => l.key === k)) && fresh.length === 2 && fresh.every((l) => l.t0 >= 12) && r2.seconds === 24, 'what was recorded before is kept, and the new lines come after it', r2 && { seconds: r2.seconds, lines: r2.transcript.map((l) => [l.src, l.t0, l.t1]) })
  const parts2 = fs.readdirSync(dirOf(RR.id)).filter((f) => /^audio-/.test(f)).sort()
  ok(parts2.length === 4 && parts2.some((f) => /^audio-you-2\.(ogg|wav)$/.test(f)) && parts2.some((f) => /^audio-them\.(ogg|wav)$/.test(f)) && meetingJson(RR.id).audioFrom?.['audio-them-2'] === 12 && meetingJson(RR.id).audioFrom?.['audio-you-2'] === 12, 'its audio is a new part beside the first, with where it starts', [parts2, meetingJson(RR.id).audioFrom])
  ok(r2?.summaryStale === 'recorded' && /beta ships/.test(r2.summary), 'with summaries not written by themselves, the one it has says it\'s out of date', r2.summaryStale)
  // Transcribe again: the call's second part starts at 12 s, where it was recorded, not at 1.5 s
  // where its first part ends.
  r = await tryApi(`/meetings/${RR.id}/transcribe`, {})
  const r3 = await until(async () => { const m = await kit.api(`/meetings/${RR.id}`); return m.status === 'done' && m.again?.done && m.transcript.length >= 4 && m }, 30000)
  const them3 = (r3?.transcript || []).filter((l) => l.src === 'them').map((l) => l.t0)
  ok(them3.length === 2 && them3[0] < 1.5 && them3[1] >= 21 && them3[1] < 23, 'transcribed again, each part\'s lines are where they were said', r3 ? r3.transcript.map((l) => [l.src, l.t0]) : r)
  // Summaries written by themselves: resumed and ended again, it's written again, not left.
  await kit.api('/settings', { meetings: { autoSummary: true } }, 'PATCH')
  const s0 = model.asked(/Write meeting notes in Markdown/).length
  await kit.api(`/meetings/${RR.id}/reopen`, {})
  await send(RR.id, Buffer.concat([pcm(6), pcm(2, true), pcm(1)]))
  await kit.api(`/meetings/${RR.id}/stop`, {})
  const r4 = await until(async () => { const m = await kit.api(`/meetings/${RR.id}`); return m.status === 'done' && !m.summarizing && !m.summaryStale && model.asked(/Write meeting notes in Markdown/).length > s0 && m }, 20000)
  ok(!!r4 && r4.seconds === 33 && r4.transcript.filter((l) => l.t0 >= 29).length === 1, 'ended again, its summary is written again from all of it', r4 ? [r4.seconds, r4.summaryStale, r4.transcript.map((l) => [l.src, l.t0])] : (await kit.api(`/meetings/${RR.id}`)).summaryStale)
  await kit.api('/settings', { meetings: { autoSummary: false } }, 'PATCH')
  }

  // ---------- The calendar (macOS Calendar, through icalBuddy) ----------
  if (IS_MAC) {
    kit.program('icalBuddy', `const d = new Date(), p = (n) => String(n).padStart(2, '0'), hm = (t) => p(t.getHours()) + ':' + p(t.getMinutes())
process.stdout.write('@@EV@@Pricing review (Work)\\u00a6' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' at ' + hm(new Date(Math.max(d - 6e5, new Date(d).setHours(0, 0, 0, 0)))) + ' - ' + hm(new Date(Math.min(+d + 3e6, new Date(d).setHours(23, 59, 0, 0)))) + '\\u00a6attendees: Priya Shah, Dan Ruiz, Tester\\n')`)
    const ev = await kit.api(`/meetings/${B.id}/events`)
    ok(ev.events?.[0]?.title === 'Pricing review' && ev.events[0].attendees.length === 3, 'the calendar event around when it was recorded, with its people', ev)
  } else skip('the calendar event around a meeting', 'the calendar is macOS Calendar')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
