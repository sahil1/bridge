// Meetings on the server, on any platform: a recording made of a tone (speech to the level check)
// transcribed by the stand-in speech service; sections; who said what; folders and the archive;
// search and questions; saved Markdown; looks at the screen while the call talks (read by a
// stand-in for native/bridgeocr, which isn't run on Windows). The calendar is macOS Calendar, and
// the call's sound is recorded on a Mac (a stand-in for native/calltap there), so their parts are
// Mac-only.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startModel, checks, until, sleep, IS_MAC, IS_WIN } from '../lib/harness.mjs'

const { ok, skip, done } = checks('meetings-api')
// The text on a picture: ocr.txt beside it, and what it was asked to read goes in ocr.log.
const ocr = (bin) => {
  fs.writeFileSync(path.join(bin, 'ocr.cjs'), `const fs = require('node:fs'), path = require('node:path'), f = process.argv[3]
fs.appendFileSync(path.join(__dirname, 'ocr.log'), f + '\\n')
try { process.stdout.write(fs.readFileSync(path.join(__dirname, 'ocr.txt'), 'utf8')) } catch { /* nothing on it */ }`)
  fs.writeFileSync(path.join(bin, 'bridgeocr'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'ocr.cjs')}" "$@"\n`, { mode: 0o755 })
  return path.join(bin, 'bridgeocr')
}
const kit = await startKit('meetings-api', { env: ({ bin }) => ({ BRIDGE_CALL_QUIET_MS: '2500', ...(IS_WIN ? {} : { BRIDGE_OCR: ocr(bin) }) }) })
const model = await startModel('meetings-api')
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
  await kit.api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false, folder: path.join(kit.home, 'Meeting notes') } }, 'PATCH')

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
  // off it: that's said, on the meeting and on the floating card, and not once the call is heard.
  if (!IS_MAC) skip('a silent call is said to be silent', "the call's sound is recorded on a Mac")
  else {
    const tap = (level) => fs.writeFileSync(path.join(kit.bin, 'calltap.json'), JSON.stringify({ level }))
    tap(3)
    const C = await kit.api('/meetings', { title: 'Call check' })
    ok(C.call === 'on', "(the meeting records the call's sound, from the stand-in)", C.call)
    ok(!!(await until(async () => (await kit.api(`/meetings/${C.id}`)).callQuiet, 10000)), 'a call only a few steps off silence is said to be silent')
    ok((await kit.api('/calls')).recording?.callQuiet === true, 'and the floating card is told')
    tap(4000)
    ok(!!(await until(async () => (await kit.api(`/meetings/${C.id}`)).callQuiet === false, 10000)), 'once the call is heard, not any more')
    const talk = await until(async () => { const t = (await kit.api('/calls')).recording?.talking; return typeof t === 'number' && { t } }, 10000)
    ok(!!talk, 'someone on the call talking is told to the page, which looks at the screen then', talk)
    tap(0)
    ok(!!(await until(async () => (await kit.api('/calls')).recording?.talking === null, 10000)), 'and not once they stop')
    await kit.api(`/meetings/${C.id}/stop`, {})
  }

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

  // ---------- The summary and the saved notes ----------
  const n1 = model.asked(/Write meeting notes in Markdown/).length
  await kit.api(`/meetings/${A.id}/summary`, {})
  const sum = (await until(() => model.asked(/Write meeting notes in Markdown/).slice(n1)[0], 15000)) || ''
  ok(/"Section 1", "Demo", "Q&A"/.test(sum) && /\n## Demo \(from 0:0\d\)\n/.test(sum) && /\] Dan Ruiz: These slides/.test(sum), 'the summary is asked for its sections, with the headings and names in the transcript', sum.slice(sum.indexOf('Transcript:'), sum.indexOf('Transcript:') + 500))
  ok(/The user's own notes:\n## Q&A\n/.test(sum), 'your notes go in without a heading nothing was written under', sum.slice(sum.indexOf('own notes'), sum.indexOf('own notes') + 80))
  await until(async () => (await kit.api(`/meetings/${A.id}`)).summary, 10000)
  const saved = await kit.api(`/meetings/${A.id}/save`, {})
  const files = saved.files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  ok(/## Demo/.test(files) && /### Dan Ruiz \(/.test(files) && /### Tester \(/.test(files) && /## Summary/.test(files), 'saved Markdown: the summary, a heading per section, who said it (you by your name)', files.slice(0, 600))

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

  // ---------- The calendar (macOS Calendar, through icalBuddy) ----------
  if (IS_MAC) {
    kit.program('icalBuddy', `const d = new Date(), p = (n) => String(n).padStart(2, '0'), hm = (t) => p(t.getHours()) + ':' + p(t.getMinutes())
process.stdout.write('@@EV@@Pricing review (Work)\\u00a6' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' at ' + hm(new Date(d - 6e5)) + ' - ' + hm(new Date(+d + 3e6)) + '\\u00a6attendees: Priya Shah, Dan Ruiz, Tester\\n')`)
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
