// Who said what in a room (server/voices.js): with your mic only, the voices around the table told
// apart on this computer, with a stand-in for sherpa-onnx's speaker model (stand-ins/sherpa.cjs: a
// voice is how high a tone is) and a small fake model file served from this computer, so nothing
// real is downloaded or loaded. Recordings are tones: 220 Hz for one person, 440 Hz for another.
//   Where it's offered, for every kind of computer (the rules), and a computer standing in for an
//   old Linux, where it isn't: hidden, with why.
//   Grouping lines by voice (the numbers alone): two voices, one, short lines.
//   Nothing downloaded or told apart by itself at first. Who spoke on a room meeting: the model
//   downloaded once with its progress, every line heard again from the recording, Speaker 1 and 2,
//   and the notes model naming them (one is you); turned on for the meetings after. A speaker named
//   once names all their lines, in the saved notes too. While the next one records, its lines get
//   their speakers as they come; on a computer with two cores, once it ends instead. Remembering
//   voices: nothing kept until it's on, then a named voice known again by itself next time, and
//   Forget voices. A download that fails its checksum is said, and Try again works. A meeting with
//   the call's sound isn't one for this.
// BRIDGE_REAL_VOICES=1: also the real thing, once, by hand (macOS): the real ERes2Net model downloaded
// from Hugging Face (kept in test/.out/real-models for next time) and run by the real sherpa-onnx
// on two voices made with `say`.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { startKit, startModel, checks, until, sleep, freePort, OUT, IS_MAC } from '../lib/harness.mjs'

const { ok, skip, done } = checks('room-voices')
const RATE = 16000

// ---------- The rules, for every kind of computer ----------
process.env.BRIDGE_HOME = path.join(OUT, 'kits', 'room-voices-rules')
// The rules, asked of server/voices.js itself (each check below says what it got, even without it).
const voices = await import('../../server/voices.js').catch(() => ({ fitVoices: () => ({}), group: () => ({ line: {} }) }))
const COMPUTERS = [
  ['a Mac on Apple Silicon', { platform: 'darwin', arch: 'arm64', os: '15.4', cores: 10 }, true, true],
  ['an Intel Mac', { platform: 'darwin', arch: 'x64', os: '14.6', cores: 8 }, true, true],
  ['Windows x64', { platform: 'win32', arch: 'x64', cores: 8 }, true, true],
  ['Windows on Arm, the x64 app emulated', { platform: 'win32', arch: 'x64', emulated: true, cores: 8 }, true, true],
  ['Linux x64 with glibc 2.35', { platform: 'linux', arch: 'x64', glibc: '2.35', cores: 8 }, true, true],
  ['Linux x64 with glibc 2.31', { platform: 'linux', arch: 'x64', glibc: '2.31', cores: 8 }, false, false, /glibc 2\.32 or later/],
  ['Linux with musl', { platform: 'linux', arch: 'x64', glibc: null, cores: 8 }, false, false, /needs a Linux with glibc/],
  ['Linux Arm', { platform: 'linux', arch: 'arm64', glibc: '2.28', cores: 4 }, true, true],
  ['the Docker image', { platform: 'linux', arch: 'x64', glibc: '2.36', docker: true, cores: 4 }, true, true],
  ['the Docker image on Arm', { platform: 'linux', arch: 'arm64', glibc: '2.36', docker: true, cores: 4 }, true, true],
  ['32-bit Arm Linux', { platform: 'linux', arch: 'arm', glibc: '2.36' }, false, false, /no build for linux on arm/],
  ['FreeBSD', { platform: 'freebsd', arch: 'x64' }, false, false, /no build for freebsd/],
  ['a computer with 1.5 GB of memory', { platform: 'linux', arch: 'x64', glibc: '2.35', memGB: 1.5, cores: 4 }, false, false, /needs 2 GB of memory; this computer has 1\.5 GB/],
  ['a computer with two cores', { platform: 'win32', arch: 'x64', memGB: 4, cores: 2 }, true, false],
]
for (const [what, m, shown, live, why] of COMPUTERS) {
  const r = voices.fitVoices({ memGB: 16, ...m })
  ok(r.ok === shown && r.live === live && (shown ? r.why === null : why.test(r.why || '')), `${what}: ${shown ? `offered, ${live ? 'while it records' : 'once a meeting ends'}` : 'hidden, saying why'}`, r)
}
const broken = voices.fitVoices({ platform: 'darwin', arch: 'arm64', memGB: 16 }, { probe: { ok: false, error: 'Symbol not found' } })
ok(broken.ok === false && /doesn't load on this computer: Symbol not found/.test(broken.why || ''), 'an addon that doesn\'t load hides it, saying why', broken)

// ---------- Grouping lines by voice ----------
const vec = (i, noise = 0.15, seed = 1) => { const v = new Float32Array(16); v[i] = 1; for (let k = 0; k < 16; k++) v[k] += noise * Math.sin(seed * 7.3 + k * 1.7); const n = Math.hypot(...v); return v.map((x) => x / n) }
const lines = [[0, 3], [5, 3], [0, 4], [5, 2.5], [0, 0.8], [5, 1.0], [0, 6]].map(([who, s], i) => ({ key: `you:${i}`, v: vec(who, 0.15, i + 1), s, t0: i * 10 + (who ? 1 : 0) }))
let g = voices.group(lines)
ok(g.speakers === 2 && ['you:0', 'you:2', 'you:4', 'you:6'].every((k) => g.line[k] === 1) && ['you:1', 'you:3', 'you:5'].every((k) => g.line[k] === 2), 'two voices: two speakers, numbered in the order they first spoke, the short lines with theirs', g.line)
g = voices.group(lines.filter((x) => x.key.match(/:(0|2|6)$/)))
ok(g.speakers === 1, 'one voice: one speaker', g)
g = voices.group([...lines, { key: 'you:9', v: vec(10), s: 0.7, t0: 99 }, { key: 'you:10', v: vec(12), s: 2, t0: 100 }])
ok(g.line['you:9'] == null && g.line['you:10'] == null && g.speakers === 2, 'a short line like nobody else, or one line of two seconds, stays unmarked', g.line)
g = voices.group([...lines, { key: 'you:11', v: vec(12), s: 3.5, t0: 100 }])
ok(g.line['you:11'] === 3 && g.speakers === 3, 'one line of three seconds and more in a voice of its own is a speaker', g.line)

// ---------- The model, served from this computer ----------
const fake = Buffer.alloc(400_000, 7)
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const catalog = path.join(OUT, 'kits', 'room-voices-models.json')
fs.mkdirSync(path.dirname(catalog), { recursive: true })
fs.writeFileSync(catalog, JSON.stringify({ voices: { files: [{ name: 'voice.onnx', bytes: fake.length, sha256: sha(fake) }] } }))
const served = { asked: 0, bad: false }
const srv = http.createServer(async (req, res) => {
  served.asked++
  if (!/\/voices\/voice\.onnx$/.test(req.url)) { res.writeHead(404); res.end(); return }
  const body = served.bad ? Buffer.alloc(fake.length, 9) : fake
  served.bad = false
  res.writeHead(200, { 'content-length': body.length })
  for (let o = 0; o < body.length; o += 40_000) { res.write(body.subarray(o, o + 40_000)); await sleep(60) }
  res.end()
})
const port = await freePort()
await new Promise((r) => srv.listen(port, '127.0.0.1', r))
const env = (more = {}) => ({ bin }) => ({ BRIDGE_MODELS_URL: `http://127.0.0.1:${port}`, BRIDGE_SPEECH_MODELS: catalog, BRIDGE_SHERPA_LOG: path.join(path.dirname(bin), 'sherpa.log'), BRIDGE_MACHINE: JSON.stringify({ cores: 8, memGB: 16 }), ...more })
const model = await startModel('room-voices')
const kits = []

// Tones: who 1 at 220 Hz, who 2 at 440 Hz, each said for 2.5 s with a pause after.
const tone = (s, hz) => { const b = Buffer.alloc(Math.round(s * RATE) * 2); if (hz) for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * 8000), i * 2); return b }
const turns = (who) => Buffer.concat(who.flatMap((w) => [tone(2.5, w === 1 ? 220 : 440), tone(1.6)]))
async function record(kit, title, who, { event, stop = true } = {}) {
  const m = await kit.api('/meetings', { title, call: false, ...(event ? { event } : {}) })
  const buf = turns(who)
  let seq = 0
  for (let o = 0; o < buf.length; o += RATE * 2) await fetch(`${kit.url}/api/meetings/${m.id}/audio?src=you&seq=${seq++}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf.subarray(o, o + RATE * 2) })
  if (stop) await kit.api(`/meetings/${m.id}/stop`, {})
  return m
}
const said = async (kit, id, n) => until(async () => { const m = await kit.api(`/meetings/${id}`); return m.transcript.filter((l) => l.text).length >= n && (m.status !== 'transcribing' || m.status === 'recording') && m }, 30000)
const voicesOf = async (kit, id) => (await kit.api(`/meetings/${id}`)).transcript.filter((l) => l.text).map((l) => l.voice || null)
const sherpaLog = (kit) => { try { return fs.readFileSync(path.join(kit.dir, 'sherpa.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const setup = async (kit) => {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false, cleanup: false } }, 'PATCH')
}
const tryApi = (kit, p, body, method) => kit.api(p, body, method).catch((e) => ({ error: e.message }))

try {
  const kit = await startKit('room-voices', { env: env() })
  kits.push(kit)
  await setup(kit)
  let st = await tryApi(kit, '/meetings/voices')
  ok(st.offered === true && st.have === false && st.on === false && st.live === true && st.mb === 26 && st.license === 'Apache-2.0', 'offered here, the model not downloaded, not on yet', st)
  ok((await kit.api('/speech')).voices?.offered === true, 'and Settings › Meetings is told so')

  // A room meeting before anything's asked: nothing downloaded, nothing told apart.
  const event = { title: 'Design review', attendees: ['Priya Shah', 'Dan Ruiz', 'Tester'] }
  const R1 = await record(kit, 'Design review', [1, 2, 1, 2], { event })
  await said(kit, R1.id, 4)
  await until(async () => (await kit.api(`/meetings/${R1.id}`)).status === 'done', 10000)
  ok(st.offered === true && (await voicesOf(kit, R1.id)).every((v) => v === null) && served.asked === 0 && !fs.existsSync(path.join(kit.data, 'models', 'voices')), 'where it\'s offered, a room meeting on its own downloads nothing and tells nothing apart', { offered: st.offered, voices: await voicesOf(kit, R1.id), asked: served.asked })

  // Who spoke: the model downloads, with its progress, then the voices.
  let r = await tryApi(kit, `/meetings/${R1.id}/voices`, {})
  ok(r.working?.state === 'downloading', 'Who spoke: the voice model downloads first', r)
  const pct = await until(async () => { const w = (await kit.api(`/meetings/${R1.id}`)).voicesWork; return w?.state === 'downloading' && w.percent > 0 && w.percent < 100 && w }, 10000, 50)
  ok(!!pct, 'with its progress on the meeting', pct)
  const v1 = await until(async () => { const v = await voicesOf(kit, R1.id); return v.join() === '1,2,1,2' && v }, 20000)
  ok(!!v1, 'then each line is heard again from the recording: Speaker 1, 2, 1, 2', await voicesOf(kit, R1.id))
  const log1 = sherpaLog(kit)
  ok(log1.filter((x) => x.loadVoices).length === 1 && log1.filter((x) => x.embed).length === 4, 'the voice model loaded once, each line heard once', log1)
  st = await tryApi(kit, '/meetings/voices')
  ok(st.have && st.on, 'used once, it\'s on for the meetings after', st)
  // Named by the notes model, as a call's lines are: one is you, one is Priya.
  let t1 = await until(async () => { const tr = (await kit.api(`/meetings/${R1.id}`)).transcript.filter((l) => l.text); return tr.every((l) => (l.voice === 1 ? l.me : l.name === 'Priya Shah' && l.guess)) && tr }, 10000)
  ok(!!t1, 'the notes model works out who each voice is: Speaker 1 is you, Speaker 2 Priya (a guess)', (await kit.api(`/meetings/${R1.id}`)).transcript.map((l) => [l.voice, l.name, l.me, l.guess]))
  ok(model.asked(/Say who each speaker is/).some((q) => /Invited, besides the person recording: Priya Shah, Dan Ruiz/.test(q) && /Speaker 2: Service transcript/.test(q)), 'it\'s told who was invited and what each speaker said', model.asked(/Say who each speaker is/).slice(-1)[0]?.slice(0, 400))

  // Named once: every line of theirs.
  await tryApi(kit, `/meetings/${R1.id}/voices/2`, { name: 'Dan Ruiz' }, 'PATCH')
  t1 = (await kit.api(`/meetings/${R1.id}`)).transcript.filter((l) => l.text)
  ok(t1.filter((l) => l.voice === 2).length === 2 && t1.filter((l) => l.voice === 2).every((l) => l.name === 'Dan Ruiz' && !l.guess), 'a speaker named once: all their lines', t1.map((l) => [l.voice, l.name]))
  await kit.api('/settings', { meetings: { folder: path.join(kit.home, 'Meeting notes') } }, 'PATCH')
  const saved = (await kit.api(`/meetings/${R1.id}/save`, {})).files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  ok(/### Dan Ruiz \(/.test(saved) && /### Tester \(/.test(saved) && !/Speaker \d/.test(saved), 'and in the saved notes', saved.slice(0, 500))
  ok(t1.some((l) => l.name === 'Dan Ruiz') && !fs.existsSync(path.join(kit.data, 'meetings', 'voices.json')), 'a voice named, but nothing is remembered by voice until you turn it on')
  r = await tryApi(kit, `/meetings/${R1.id}/voices/7`, { name: 'X' }, 'PATCH')
  ok(/No such speaker/.test(r.error || ''), 'a speaker it doesn\'t have is refused', r)

  // Remembering, turned on: a voice you name is kept, and known again next time.
  await kit.api('/settings', { meetings: { rememberVoices: true } }, 'PATCH')
  await tryApi(kit, `/meetings/${R1.id}/voices/2`, { name: 'Dan Ruiz' }, 'PATCH')
  await tryApi(kit, `/meetings/${R1.id}/voices/1`, { me: true }, 'PATCH')
  const known = (() => { try { return JSON.parse(fs.readFileSync(path.join(kit.data, 'meetings', 'voices.json'), 'utf8')) } catch { return { voices: [] } } })()
  ok(known.voices.length === 2 && known.voices.some((k) => k.name === 'Dan Ruiz') && known.voices.some((k) => k.me) && (fs.statSync(path.join(kit.data, 'meetings', 'voices.json'), { throwIfNoEntry: false })?.mode & 0o077) === 0, 'on: the two named voices are kept, readable by you only', known.voices.map((k) => [k.name, k.me]))
  ok((await tryApi(kit, '/meetings/voices')).known === 2, 'and Settings says how many')

  // The next one, while it records: each line's speaker as it comes, and the known voices named.
  const R2 = await record(kit, 'Standup', [2, 1, 2], { stop: false })
  const live = await until(async () => { const m = await kit.api(`/meetings/${R2.id}`); const tr = m.transcript.filter((l) => l.text); return m.status === 'recording' && tr.length === 3 && tr.every((l) => l.voice) && tr }, 30000)
  ok(!!live, 'while it records, each line gets its speaker as it comes', (await kit.api(`/meetings/${R2.id}`)).transcript.map((l) => [l.text, l.voice]))
  ok(!!live && live.filter((l) => l.voice === 1).every((l) => l.name === 'Dan Ruiz' && l.byVoice) && live.filter((l) => l.voice === 2).every((l) => l.me), 'and the voices named before are known again by their sound', live && live.map((l) => [l.voice, l.name, l.me, l.byVoice]))
  await kit.api(`/meetings/${R2.id}/stop`, {})
  ok((await tryApi(kit, '/meetings/voices/forget', {})).ok && !fs.existsSync(path.join(kit.data, 'meetings', 'voices.json')) && (await tryApi(kit, '/meetings/voices')).known === 0, 'Forget voices: none kept')

  // A meeting with the call's sound says who's on the call already.
  const C = await kit.api('/meetings', { title: 'Call', call: false })
  await kit.api(`/meetings/${C.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${C.id}`)).status === 'done', 10000)
  fs.appendFileSync(path.join(kit.data, 'meetings', C.id, 'transcript.jsonl'), `${JSON.stringify({ src: 'them', t0: 1, t1: 3, text: 'Hello from the call.' })}\n${JSON.stringify({ src: 'you', t0: 4, t1: 6, text: 'Hi.' })}\n`)
  r = await tryApi(kit, `/meetings/${C.id}/voices`, {})
  ok(/call's sound/.test(r.error || ''), 'a meeting with the call\'s sound isn\'t told apart by voice', r)

  // Two cores: not while it records, once it ends. And a download that fails its checksum.
  const slow = await startKit('room-voices-slow', { env: env({ BRIDGE_MACHINE: JSON.stringify({ cores: 2, memGB: 4 }) }) })
  kits.push(slow)
  await setup(slow)
  ok((await tryApi(slow, '/meetings/voices')).live === false, 'two cores: offered for once a meeting ends')
  const S0 = await record(slow, 'Planning', [1, 2], {})
  await said(slow, S0.id, 2)
  await until(async () => (await slow.api(`/meetings/${S0.id}`)).status === 'done', 10000)
  served.bad = true
  await tryApi(slow, `/meetings/${S0.id}/voices`, {})
  const bad = await until(async () => (await slow.api(`/meetings/${S0.id}`)).voicesWork?.error, 15000)
  ok(/didn't match its checksum/.test(bad || '') && !fs.existsSync(path.join(slow.data, 'models', 'voices', 'voice.onnx')), 'a download that doesn\'t match its checksum is thrown away, and the meeting says so', bad)
  await tryApi(slow, `/meetings/${S0.id}/voices`, {})
  ok(!!(await until(async () => (await voicesOf(slow, S0.id)).join() === '1,2', 20000)), 'Try again: downloaded, and told apart', await voicesOf(slow, S0.id))
  const S1 = await record(slow, 'Planning', [2, 1, 2], { stop: false })
  await said(slow, S1.id, 3)
  ok((await tryApi(slow, '/meetings/voices')).on === true && (await voicesOf(slow, S1.id)).every((v) => v === null), 'two cores, with it on: nothing told apart while it records', await voicesOf(slow, S1.id))
  await slow.api(`/meetings/${S1.id}/stop`, {})
  ok(!!(await until(async () => (await voicesOf(slow, S1.id)).join() === '1,2,1', 20000)), 'and the voices are told apart once it ends, by itself', await voicesOf(slow, S1.id))

  // An old Linux: not offered, and refused with why.
  const old = await startKit('room-voices-oldlinux', { env: env({ BRIDGE_MACHINE: JSON.stringify({ platform: 'linux', arch: 'x64', glibc: '2.31', docker: false, cores: 8, memGB: 16 }) }) })
  kits.push(old)
  await setup(old)
  st = await tryApi(old, '/meetings/voices')
  ok(st.offered === false && /glibc 2\.32 or later/.test(st.why || '') && (await old.api('/speech')).voices?.offered === false, 'an old Linux: not offered (Settings hides it), saying why', st)
  const O = await record(old, 'Room', [1, 2], {})
  await said(old, O.id, 2)
  r = await tryApi(old, `/meetings/${O.id}/voices`, {})
  ok(/glibc/.test(r.error || '') && !fs.existsSync(path.join(old.data, 'models', 'voices')), 'and Who spoke there is refused with why, downloading nothing', r)

  // ---------- The real thing, by hand ----------
  if (process.env.BRIDGE_REAL_VOICES !== '1') skip('the real voice model on two voices made with say', 'set BRIDGE_REAL_VOICES=1 to download the real ERes2Net model and run it')
  else if (!IS_MAC) skip('the real voice model on two voices made with say', 'the voices are made with macOS\'s say')
  else {
    const keep = path.join(OUT, 'real-models', 'voices')
    const real = await startKit('room-voices-real', { env: ({ bin }) => ({ BRIDGE_MODELS_URL: '', BRIDGE_SHERPA: '', BRIDGE_SPEECH_MODELS: '', BRIDGE_SHERPA_LOG: path.join(path.dirname(bin), 'sherpa.log') }) })
    kits.push(real)
    await setup(real)
    if (fs.existsSync(keep)) fs.cpSync(keep, path.join(real.data, 'models', 'voices'), { recursive: true })
    const tmp = path.join(real.dir, 'say')
    fs.mkdirSync(tmp, { recursive: true })
    const clip = (voice, text, n) => {
      const aiff = path.join(tmp, `${n}.aiff`), wavf = path.join(tmp, `${n}.wav`)
      spawnSync('say', ['-v', voice, '-o', aiff, text])
      spawnSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wavf])
      // The samples, wherever afconvert put them (after a padding chunk).
      const all = fs.readFileSync(wavf)
      for (let at = 12; at + 8 <= all.length;) { const n = all.readUInt32LE(at + 4); if (all.toString('ascii', at, at + 4) === 'data') return all.subarray(at + 8, at + 8 + n); at += 8 + n + (n % 2) }
      return Buffer.alloc(0)
    }
    const parts = [
      ['Samantha', 'Good morning everyone, let us start with the payments work from last week.'],
      ['Daniel', 'Thanks. The webhook retries are fixed, and the tests pass on staging now.'],
      ['Samantha', 'Great, can you send the release notes to the support team today?'],
      ['Daniel', 'Yes, I will send them this afternoon, after the review with the designers.'],
      ['Samantha', 'Perfect. Next, the pricing page needs a new table for the enterprise plan.'],
      ['Daniel', 'I can draft that tomorrow, if someone shares the numbers with me first.'],
    ]
    const clips = parts.map(([v, text], i) => clip(v, text, i))
    const audio = Buffer.concat(clips.flatMap((c) => [c, tone(1.4)]))
    // Where each clip starts, in seconds: a line belongs to the clip its middle is in.
    const starts = clips.reduce((a, c) => [...a, a[a.length - 1] + c.length / 2 / RATE + 1.4], [0])
    const m = await real.api('/meetings', { title: 'Real voices', call: false })
    let seq = 0
    for (let o = 0; o < audio.length; o += RATE * 2) await fetch(`${real.url}/api/meetings/${m.id}/audio?src=you&seq=${seq++}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: audio.subarray(o, o + RATE * 2) })
    await real.api(`/meetings/${m.id}/stop`, {})
    await until(async () => (await real.api(`/meetings/${m.id}`)).status === 'done', 60000)
    const t0 = Date.now()
    await real.api(`/meetings/${m.id}/voices`, {})
    const got = await until(async () => { const x = await real.api(`/meetings/${m.id}`); return !x.voicesWork && x.voices && x }, 600000, 1000)
    const tr = (got?.transcript || []).filter((l) => l.text)
    const who = tr.map((l) => l.voice || 0)
    const sayer = (l) => parts[Math.max(0, starts.findLastIndex((x) => x <= (l.t0 + l.t1) / 2))]?.[0]
    console.log(`real voices: ${tr.length} lines, speakers ${got?.voices?.speakers}, voices ${who.join(',')} for ${tr.map(sayer).join(',')}, in ${Math.round((Date.now() - t0) / 1000)} s (download included the first time)`)
    const same = tr.length >= 4 && tr.every((l) => tr.every((k) => (sayer(l) === sayer(k)) === (l.voice === k.voice)))
    ok(got?.voices?.speakers === 2 && same, 'the real ERes2Net model on two voices made with say: two speakers, each line with its own', { speakers: got?.voices?.speakers, who, lines: tr.map((l) => l.t0) })
    if (fs.existsSync(path.join(real.data, 'models', 'voices'))) { fs.mkdirSync(path.dirname(keep), { recursive: true }); fs.cpSync(path.join(real.data, 'models', 'voices'), keep, { recursive: true }) }
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  model.stop()
  srv.close()
}
process.exit(done().fail ? 1 : 0)
