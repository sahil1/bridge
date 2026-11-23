// Transcribe a file or a folder, on the server (server/meetfiles.js, audiofile.js, meetings.js),
// with stand-ins for sherpa-onnx (stand-ins/sherpa.cjs, a voice told by its pitch), small fake
// speech and voice models served from this computer (harness.startSpeechModels), a stand-in for
// the program that reads compressed files (stand-ins/afconvert.cjs: afconvert on a Mac, ffmpeg
// elsewhere) and a stand-in model service, so nothing real is downloaded, read or asked.
//   A file sent in pieces, each checked against its SHA-256 (a damaged one turned away, one out of
//   place told where to carry on), its line going through each step with its progress: the speech
//   model's one download, transcribing, the voice model's download, telling speakers apart, done. A
//   WAV of any rate and channels is read by Bridge AI itself; another kind by the program that
//   reads it. The transcript is a meeting of its own: from the file, its lines by Speaker 1 and 2
//   (never You), left out of merging and Meeting Insights, nothing written by a model by itself and
//   not saved to the notes folder until asked; Ask about it says it's a recording.
//   As text, Markdown, SRT and WebVTT: downloaded, and saved beside its note.
//   A folder: one after another, each its own line; one that isn't sound, one with nothing said,
//   and one whose kind nothing here reads (the page reads it and sends its sound instead, or says
//   it couldn't) each say why on screen, and the rest go on.
//   Whisper in another language (downloaded first), a speech service, a file stopped part way,
//   one that stopped coming in, too little free space, and a file waiting while a meeting records.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { startKit, startModel, startSpeechModels, checks, until, sleep, TEST } from '../lib/harness.mjs'

const { ok, skip, done } = checks('transcribe-files')
const models = await startSpeechModels('transcribe-files')
const model = await startModel('transcribe-files')
const reader = fs.readFileSync(path.join(TEST, 'stand-ins', 'afconvert.cjs'), 'utf8')
// A kit whose computer reads compressed files with the stand-in (as a Mac's afconvert would), or
// reads none (none: WAV only, as Windows without ffmpeg).
const kitFor = (name, { none = false, more = {} } = {}) => startKit(name, {
  env: ({ bin }) => {
    const prog = path.join(bin, 'afconvert')
    fs.writeFileSync(`${prog}.cjs`, reader)
    fs.writeFileSync(prog, `#!/bin/sh\nexec "${process.execPath}" "${prog}.cjs" "$@"\n`, { mode: 0o755 })
    return { ...models.env()({ bin }), BRIDGE_AFCONVERT: none ? 'none' : prog, BRIDGE_FFMPEG: 'none', BRIDGE_AFCONVERT_LOG: path.join(bin, 'afconvert.log'), BRIDGE_ASR_IDLE_MS: '60000', ...more }
  },
})

// ---------- Sounds ----------
const RATE = 16000
// A WAV of tones ([hz, seconds], hz 0 for quiet), at a rate and with channels of its own.
const wav = (tones, rate = RATE, channels = 1) => {
  const n = tones.reduce((s, [, secs]) => s + Math.round(secs * rate), 0)
  const b = Buffer.alloc(44 + n * 2 * channels)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2 * channels, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2 * channels, 28); b.writeUInt16LE(2 * channels, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2 * channels, 40)
  let at = 0
  for (const [hz, secs] of tones) {
    const k = Math.round(secs * rate)
    for (let i = 0; i < k; i++) for (let c = 0; c < channels; c++) b.writeInt16LE(hz ? Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000) : 0, 44 + ((at + i) * channels + c) * 2)
    at += k
  }
  return b
}
// Two people taking turns: one voice at 220 Hz, the other at 440, with pauses between.
const INTERVIEW = [[0, 1], [220, 2.5], [0, 1.5], [440, 2.5], [0, 1.5], [220, 2.5], [0, 1.5], [440, 2.5], [0, 1.5]]
// A made-up compressed file (an MP4's first bytes), which the stand-in reader reads.
const m4a = (tones) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A \0\0\0\0isomM4A '), Buffer.from(JSON.stringify({ tones }))])
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

// The page's way of sending files: their lines, then each in pieces, then done.
async function send(kit, files, how = {}, { piece = 64 * 1024 } = {}) {
  const r = await kit.api('/meetings/files', { files: files.map((f) => ({ name: f.name, size: f.body.length, type: f.type || '' })), with: how })
  for (const [i, x] of r.items.entries()) {
    if (x.state === 'failed') continue
    for (let at = 0; at < files[i].body.length;) {
      const part = files[i].body.subarray(at, at + piece)
      const res = await fetch(`${kit.url}/api/meetings/files/${x.id}?at=${at}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-sha256': sha(part) }, body: part })
      at = (await res.json()).have
    }
    await kit.api(`/meetings/files/${x.id}/done`, {})
  }
  return r.items
}
const lineOf = async (kit, id) => (await kit.api('/meetings/files')).items.find((x) => x.id === id)
// Its line, as it goes, until it's done or failed: every state it was seen in.
async function watch(kit, id, ms = 30000) {
  const seen = []
  const end = await until(async () => {
    const x = await lineOf(kit, id)
    if (x && seen.at(-1) !== x.state) seen.push(x.state)
    return x && ['done', 'failed', 'read-here'].includes(x.state) && x
  }, ms, 100)
  return { line: end || await lineOf(kit, id), seen }
}
const sherpaLog = (kit) => { try { return fs.readFileSync(path.join(kit.dir, 'sherpa.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }

const kit = await kitFor('transcribe-files')
try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { meetings: { model: 'openai:gpt-5', folder: path.join(kit.home, 'Meeting notes') } }, 'PATCH')
  ok((await kit.api('/meetings/files')).items.length === 0 && !fs.existsSync(path.join(kit.data, 'models')), 'to start: no files, and nothing downloaded by itself')

  // ---------- One file, sent in pieces ----------
  const body = wav(INTERVIEW, 44100, 2)
  const r = await kit.api('/meetings/files', { files: [{ name: 'Interview with Priya.wav', size: body.length, type: 'audio/wav', modified: Date.parse('2026-11-01T10:00:00Z') }], with: { engine: 'local' } })
  const id = r.items[0].id
  ok(r.items.length === 1 && r.items[0].state === 'waiting' && r.piece >= 1024 * 1024, 'added: its line waits for the file, and the page is told how big a piece to send', r)
  // A piece damaged on the way is turned away; one out of place is told where to carry on.
  const first = body.subarray(0, 200_000)
  let res = await fetch(`${kit.url}/api/meetings/files/${id}?at=0`, { method: 'PUT', headers: { 'x-sha256': sha(Buffer.from('other')) }, body: first })
  ok(res.status === 422 && (await res.json()).code === 'damaged', 'a piece that doesn\'t match its SHA-256 is turned away')
  res = await fetch(`${kit.url}/api/meetings/files/${id}?at=0`, { method: 'PUT', headers: { 'x-sha256': sha(first) }, body: first })
  ok((await res.json()).have === 200_000, 'a good one is taken')
  res = await fetch(`${kit.url}/api/meetings/files/${id}?at=0`, { method: 'PUT', headers: { 'x-sha256': sha(first) }, body: first })
  ok((await res.json()).have === 200_000, 'the same piece sent again (a retry) is taken once')
  ok((await lineOf(kit, id)).state === 'sending' && (await lineOf(kit, id)).percent > 0, 'its line says it\'s being sent, how far', await lineOf(kit, id))
  for (let at = 200_000; at < body.length;) {
    const part = body.subarray(at, at + 300_000)
    at = (await (await fetch(`${kit.url}/api/meetings/files/${id}?at=${at}`, { method: 'PUT', headers: { 'x-sha256': sha(part) }, body: part })).json()).have
  }
  models.slow = 30
  await kit.api(`/meetings/files/${id}/done`, {})
  const { line, seen } = await watch(kit, id, 60000)
  models.slow = 0
  ok(line?.state === 'done', 'it\'s transcribed', line)
  ok(seen.includes('model') && seen.at(-1) === 'done', 'the speech model\'s one download first (none was here), then done', seen)
  ok(fs.existsSync(path.join(kit.data, 'models', 'parakeet-v3')) && fs.existsSync(path.join(kit.data, 'models', 'voices')), 'the speech model and the voice model downloaded, the first time', fs.readdirSync(path.join(kit.data, 'models')))
  const m = await kit.api(`/meetings/${id}`)
  ok(m.file?.name === 'Interview with Priya.wav' && m.title === 'Interview with Priya' && m.status === 'done' && m.seconds === 17, 'a meeting of its own, named after the file, its length the recording\'s', { title: m.title, file: m.file, seconds: m.seconds })
  ok(!fs.existsSync(path.join(kit.data, 'meetings', id, 'source.part')) && fs.statSync(path.join(kit.data, 'meetings', id, 'audio-you.wav')).size === 44 + 17 * RATE * 2, 'its sound kept as a 16 kHz mono recording, read by Bridge AI itself (a 44.1 kHz stereo WAV), and the copy that came in gone', fs.readdirSync(path.join(kit.data, 'meetings', id)))
  const said = m.transcript.filter((l) => l.text)
  ok(said.length === 4 && said.every((l) => l.text === 'Open the work tree in Claud Code.' && l.engine === 'Parakeet'), 'a line for each time someone spoke, by Parakeet', said.map((l) => [l.t0, l.text]))
  ok(said.map((l) => l.voice).join(',') === '1,2,1,2' && m.voices?.speakers === 2, 'who spoke, by voice: Speaker 1 and Speaker 2, taking turns', said.map((l) => l.voice))
  ok(said.every((l) => l.file && !l.me && !l.name) && Math.abs(said[0].t0 - 0.7) < 0.2 && Math.abs(said[1].t0 - 4.7) < 0.2, 'with when, and nobody\'s You', said.map((l) => [l.t0, l.voice]))
  ok(!fs.existsSync(path.join(kit.data, 'meetings', id, 'summary.md')) && !m.summarizing && !m.cleanedAt && !m.saved && !fs.existsSync(path.join(kit.home, 'Meeting notes')), 'nothing written by a model by itself, and not saved to the notes folder until asked')
  ok(!model.asked().length, 'and the model was asked nothing')
  ok((await kit.api('/config')).meetings?.roomVoices == null, 'telling a file\'s speakers apart leaves the setting for rooms as it is')
  const listed = (await kit.api('/meetings')).meetings.find((x) => x.id === id)
  ok(!!listed?.file && !listed.mergeHint, 'in Meetings, marked as a file, never offered to merge', listed)
  const ins = await kit.api('/meetings/insights?days=all').catch(() => null)
  ok(!ins || !JSON.stringify(ins).includes(id), 'and left out of Meeting Insights')

  // ---------- As text and subtitles ----------
  const get = async (f) => { const x = await fetch(`${kit.url}/api/meetings/${id}/transcript/${f}`); return { status: x.status, type: x.headers.get('content-type'), name: x.headers.get('content-disposition'), text: await x.text() } }
  const txt = await get('txt')
  ok(txt.status === 200 && /^text\/plain/.test(txt.type) && /filename="Interview with Priya\.txt"/.test(txt.name || ''), 'as text: a file named after it', txt)
  ok(/^\[0:01\] Speaker 1: Open the work tree in Claud Code\.\n\n\[0:05\] Speaker 2: Open/.test(txt.text) && txt.text.split('\n\n').length === 4, 'a paragraph each time someone speaks: when, who, what', txt.text)
  const md = await get('md')
  ok(/^# Interview with Priya\n\nTranscribed from Interview with Priya\.wav, 0:17 long\n\n\*\*\[0:01\]\*\* \*\*Speaker 1:\*\* Open/.test(md.text) && /filename="Interview with Priya \(transcript\)\.md"/.test(md.name || ''), 'as Markdown: its name, where it came from, then who said what', md.text)
  const srt = await get('srt')
  ok(/^1\n00:00:00,[0-9]{3} --> 00:00:0[0-9],[0-9]{3}\nSpeaker 1: Open the work tree in Claud Code\.\n\n2\n00:00:04,[0-9]{3} --> /.test(srt.text) && /^application\/x-subrip/.test(srt.type), 'as SRT subtitles: numbered cues, times to the millisecond, who\'s speaking', srt.text)
  const vtt = await get('vtt')
  ok(/^WEBVTT\n\n00:00:00\.[0-9]{3} --> 00:00:0[0-9]\.[0-9]{3}\n<v Speaker 1>Open the work tree in Claud Code\./.test(vtt.text) && /^text\/vtt/.test(vtt.type), 'as WebVTT: its voices as WebVTT names them', vtt.text)
  ok((await get('exe')).status === 404, 'and nothing else')
  const saved = await kit.api(`/meetings/${id}/transcript/srt`, {})
  ok(saved.file && saved.file.startsWith(path.join(kit.home, 'Meeting notes')) && saved.file.endsWith('Interview with Priya.srt') && fs.readFileSync(saved.file, 'utf8') === srt.text, 'saved on this computer: beside where its note goes, named as the note is', saved)
  // A long line as subtitles: two short lines a cue at most, its time shared out.
  const long = 'This is the part where the two of them talk for a long while about everything the team planned for the launch next month and what is still open'
  fs.writeFileSync(path.join(kit.data, 'meetings', id, 'edits.json'), JSON.stringify({ [said[0].key]: long }))
  const cues = (await get('srt')).text.split('\n\n')
  ok(cues.length > 4 && cues.every((c) => c.split('\n').slice(2).length <= 2 && c.split('\n').slice(2).every((l) => l.length <= 54)), 'a long line is cut into cues of two short lines', cues.slice(0, 3))
  fs.rmSync(path.join(kit.data, 'meetings', id, 'edits.json'))

  // ---------- Ask about it ----------
  const a = await kit.api(`/meetings/${id}/ask`, { question: 'What did they talk about?' })
  const q = model.asked(/What did they talk about/).at(-1) || ''
  ok(!!a.answer && /^Recording: Interview with Priya\.wav/.test(q) && /Speaker 1: Open the work tree/.test(q) && /Answer from the recording only/.test(q) && !/"You" is me/.test(q), 'Ask about it: the model is told it\'s a recording, with who spoke by voice', q.slice(0, 400))

  // ---------- A folder: one after another, each says how it went ----------
  const folder = await send(kit, [
    { name: 'One.m4a', body: m4a([[0, 0.5], [220, 2.5], [0, 1.5]]) },
    { name: 'Notes.mp3', body: Buffer.from('%PDF-1.7 not a sound at all, a document named .mp3') },
    { name: 'Quiet.wav', body: wav([[0, 3]]) },
    { name: 'Two.wav', body: wav([[0, 0.5], [440, 2.5], [0, 1.5]], 8000) },
  ], { engine: 'local', speakers: false })
  const lines = await until(async () => { const all = (await kit.api('/meetings/files')).items.filter((x) => folder.some((f) => f.id === x.id)); return all.every((x) => ['done', 'failed'].includes(x.state)) && all }, 40000, 200)
  ok(!!lines && lines.length === 4 && folder.every((f) => f.batch && f.batch === folder[0].batch), 'a folder: a line for each file, together', lines && lines.map((x) => [x.name, x.state]))
  const by = (n) => (lines || []).find((x) => x.name === n)
  ok(by('One.m4a')?.state === 'done' && (await kit.api(`/meetings/${by('One.m4a').id}`)).transcript.length === 1, 'a compressed file, read by the program this computer has for it (afconvert on a Mac)', by('One.m4a'))
  const asked = fs.readFileSync(path.join(kit.bin, 'afconvert.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).args)
  ok(asked.length === 1 && asked[0].slice(0, 6).join(' ') === '-f WAVE -d LEI16@16000 -c 1' && asked[0][6].endsWith('source.part') && asked[0][7].endsWith('audio-you.wav'), 'asked for 16 kHz mono, from the copy that came in into the meeting\'s recording (never a file in your folders)', asked)
  ok(by('Notes.mp3')?.state === 'failed' && by('Notes.mp3').error === 'This isn\'t an audio or video file.' && !by('Notes.mp3').meeting, 'one that isn\'t sound says so, and leaves nothing behind', by('Notes.mp3'))
  ok(by('Quiet.wav')?.state === 'done' && by('Quiet.wav').note === 'No one is heard speaking in it.', 'one where nobody speaks says so', by('Quiet.wav'))
  ok(by('Two.wav')?.state === 'done' && (await kit.api(`/meetings/${by('Two.wav').id}`)).transcript.length === 1, 'and the rest go on (an 8 kHz WAV, read as 16 kHz)', by('Two.wav'))
  ok(!(await kit.api(`/meetings/${by('One.m4a').id}`)).voices, 'Tell speakers apart off for these: not told apart')
  // Off the list: the finished lines go, their transcripts stay.
  const cleared = await kit.api('/meetings/files/clear', {})
  ok(cleared.items.length === 0 && (await kit.api('/meetings')).meetings.some((x) => x.id === by('Two.wav').id), 'Clear: the finished lines go, the transcripts stay in Meetings')

  // ---------- How far it's got, while it's transcribed ----------
  // (A slow engine here: each piece takes most of its own length.)
  fs.writeFileSync(path.join(kit.data, 'models', 'parakeet-v3', 'slow'), '')
  const [p1] = await send(kit, [{ name: 'Slow.wav', body: wav([[0, 0.5], [220, 2], [0, 1.5], [440, 2], [0, 1.5]]) }], { engine: 'local', speakers: false })
  const going = await until(async () => { const x = await lineOf(kit, p1.id); return x?.state === 'transcribing' && x.percent > 0 && x.percent < 100 && x }, 20000, 100)
  ok(!!going, 'while it\'s transcribed, its line says how far it\'s got', going)
  const shown = going && await kit.api(`/meetings/${p1.id}`)
  ok(!!shown && shown.status === 'transcribing' && shown.progress > 0, 'and so does its meeting', shown && { status: shown.status, progress: shown.progress })
  ok((await watch(kit, p1.id)).line?.state === 'done', 'then it\'s done')
  fs.rmSync(path.join(kit.data, 'models', 'parakeet-v3', 'slow'))

  // ---------- Whisper, in another language, downloaded first ----------
  const n0 = sherpaLog(kit).length
  models.slow = 40
  const [w] = await send(kit, [{ name: 'Entrevista.wav', body: wav([[0, 0.5], [220, 2.5], [0, 1.5]]) }], { engine: 'local', localModel: 'whisper-turbo', language: 'ja', speakers: false })
  const wr = await watch(kit, w.id)
  models.slow = 0
  ok(wr.line?.state === 'done' && wr.seen.includes('model'), 'with Whisper large turbo, which downloads first', wr)
  const loaded = sherpaLog(kit).slice(n0).find((l) => l.load)
  ok(loaded?.load === 'whisper-turbo' && loaded.whisper === 'ja', 'Whisper is told the language picked', loaded)
  const wm = await kit.api(`/meetings/${w.id}`)
  ok(wm.transcript[0]?.engine === 'Whisper large turbo' && wm.transcript[0].lang === 'ja' && wr.line.lang === 'ja' && wm.language === 'ja', 'and the transcript says what heard it, and in which language', wm.transcript[0])

  // ---------- A speech service ----------
  const [s] = await send(kit, [{ name: 'Call.wav', body: wav([[0, 0.5], [220, 2.5], [0, 1.5]]) }], { engine: 'openai', speakers: false })
  const sr = await watch(kit, s.id)
  ok(sr.line?.state === 'done' && model.heard().length >= 1 && (await kit.api(`/meetings/${s.id}`)).transcript[0]?.engine?.startsWith('OpenAI'), 'with a speech service picked for it: sent there', sr.line)

  // ---------- Stopped, part way ----------
  const big = wav([[0, 0.5], [220, 30]])
  const st = await kit.api('/meetings/files', { files: [{ name: 'Long.wav', size: big.length }] })
  const half = big.subarray(0, 300_000)
  await fetch(`${kit.url}/api/meetings/files/${st.items[0].id}?at=0`, { method: 'PUT', headers: { 'x-sha256': sha(half) }, body: half })
  await kit.api(`/meetings/files/${st.items[0].id}`, null, 'DELETE')
  ok(!(await lineOf(kit, st.items[0].id)) && !fs.existsSync(path.join(kit.data, 'meetings', st.items[0].id)), 'stopped while it was being sent: its line and its meeting go')
  res = await fetch(`${kit.url}/api/meetings/files/${st.items[0].id}?at=300000`, { method: 'PUT', headers: { 'x-sha256': sha(half) }, body: half })
  ok(res.status === 409, 'and a piece after that is turned away')

  // ---------- A meeting recording: a file waits for it ----------
  const rec = await kit.api('/meetings', { title: 'Standup', call: false })
  const tone = wav([[220, 1]]).subarray(44)
  await fetch(`${kit.url}/api/meetings/${rec.id}/audio?src=you&seq=0`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: tone })
  const [h] = await send(kit, [{ name: 'Later.wav', body: wav([[0, 0.5], [220, 2.5], [0, 1.5]]) }], { engine: 'local', speakers: false })
  const held = await until(async () => (await lineOf(kit, h.id))?.state === 'held', 10000, 100)
  ok(!!held, 'a file added while a meeting records waits for it to end, and says so')
  await kit.api(`/meetings/${rec.id}/stop`, {})
  ok((await watch(kit, h.id)).line?.state === 'done', 'then it\'s transcribed')
} catch (e) {
  ok(false, `transcribing files crashed: ${e.stack}`)
  console.log(kit.log().slice(-2500))
} finally { kit.stop() }

// ---------- A computer that reads no compressed files (Windows without ffmpeg) ----------
// The page reads the kind itself and sends its sound; or says it couldn't, and the line says why.
const bare = await kitFor('transcribe-files-bare', { none: true, more: { BRIDGE_FILES_STALE_MS: '3000' } })
try {
  await bare.api('/setup', { name: 'Tester' })
  await bare.api('/speech/models/parakeet-v3', {})
  await until(async () => (await bare.api('/speech')).local.models.find((x) => x.id === 'parakeet-v3').have, 15000)
  const [x] = await send(bare, [{ name: 'Voice memo.m4a', body: m4a([[220, 2]]) }], { engine: 'local', speakers: false })
  const rx = await watch(bare, x.id)
  ok(rx.line?.state === 'read-here' && rx.line.error === 'Bridge AI can\'t read MP4 files on this computer by itself.', 'a kind nothing here reads: its line says so, for the page to read it itself', rx.line)
  // The page sends its sound instead, as a WAV.
  const sound = wav([[0, 0.5], [220, 2.5], [0, 1.5]])
  await bare.api(`/meetings/files/${x.id}/again`, { size: sound.length })
  await fetch(`${bare.url}/api/meetings/files/${x.id}?at=0`, { method: 'PUT', headers: { 'x-sha256': sha(sound) }, body: sound })
  await bare.api(`/meetings/files/${x.id}/done`, {})
  const ax = await watch(bare, x.id)
  ok(ax.line?.state === 'done' && (await bare.api(`/meetings/${x.id}`)).transcript.length === 1 && (await bare.api(`/meetings/${x.id}`)).file.name === 'Voice memo.m4a', 'the page sends its sound: transcribed, named as the file is', ax.line)
  // The page couldn't read it either.
  const [y] = await send(bare, [{ name: 'Broken.webm', body: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200)]) }], { engine: 'local' })
  await watch(bare, y.id)
  await bare.api(`/meetings/files/${y.id}/again`, { failed: 'decode' })
  const fy = await lineOf(bare, y.id)
  ok(fy?.state === 'failed' && /can't read WebM or MKV files on this computer by itself\. This window couldn't read it either/.test(fy.error) && !fs.existsSync(path.join(bare.data, 'meetings', y.id)), 'and when the page can\'t read it either, the line says so, and nothing is left behind', fy)
  // A file that stopped coming in (the page closed): said, to add again.
  const z = await bare.api('/meetings/files', { files: [{ name: 'Gone.wav', size: 100_000 }] })
  await sleep(3500)
  const gz = await lineOf(bare, z.items[0].id)
  ok(gz?.state === 'failed' && /stopped coming in before all of it was here\. Add it again\./.test(gz.error), 'one that stopped coming in says so, to be added again', gz)
} catch (e) {
  ok(false, `the bare computer crashed: ${e.stack}`)
  console.log(bare.log().slice(-2500))
} finally { bare.stop() }

// ---------- Too little free space ----------
const tight = await kitFor('transcribe-files-tight', { more: { BRIDGE_MACHINE: JSON.stringify({ freeMB: 300 }) } })
try {
  await tight.api('/setup', { name: 'Tester' })
  const r = await tight.api('/meetings/files', { files: [{ name: 'Lecture.mp4', size: 900_000_000 }, { name: 'Short.wav', size: 50_000 }] })
  ok(r.items[0].state === 'failed' && /^Not enough free space: Lecture\.mp4 needs 1100 MB, and there's 300 MB free\.$/.test(r.items[0].error) && r.items[1].state === 'waiting', 'too little free space for a file: it says so before anything is sent, and the next one still comes', r.items)
} catch (e) {
  ok(false, `the tight computer crashed: ${e.stack}`)
} finally { tight.stop() }

models.stop()
model.stop()
process.exit(done().fail ? 1 : 0)
