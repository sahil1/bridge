// Speech to text on this computer: Parakeet through sherpa-onnx (server/speech.js, asr.js, voice.js),
// with a stand-in for sherpa-onnx's addon (stand-ins/sherpa.cjs) and a small fake model served from
// this computer, so nothing real is downloaded or loaded.
//   Which engines and models each kind of computer is offered (macOS on both chips and versions,
//   Windows, Windows on Arm, Linux by its glibc, Linux Arm, Docker, little memory, an addon that
//   won't load), asked of the rules themselves, then of servers standing in for another computer
//   (an old Linux, Docker on Arm, a Mac whose sherpa-onnx won't load):
//   what isn't offered is left out of the list and said only in its diagnostics, and a pick that
//   can't run there falls back to the portable default, saying so.
//   The download: progress, checked against its SHA-256 (one that doesn't match is thrown away),
//   picked up where it stopped, too little free space said before it starts, and Remove.
//   /api/transcribe: the first time, the answer says a one-time download is needed (name, size, it
//   stays on this computer) and starts nothing; after the download, a 16 kHz WAV goes to Parakeet
//   (another rate or stereo is turned into that first, and audio that needs ffmpeg says so when
//   it's missing); names to listen for go with it, and meeting memory's spellings come out fixed.
//   The engine runs in a process of its own, loaded once and kept, let go when idle, started
//   again after a crash. A meeting transcribed by Parakeet.
// BRIDGE_REAL_PARAKEET=1: also the real thing, once, by hand: both real models downloaded from
// Hugging Face (into test/.out/real-models, kept for next time), each turning a clip made with `say` into text (macOS).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, startSpeechModels, checks, until, sleep, OUT, IS_MAC } from '../lib/harness.mjs'

const { ok, skip, done } = checks('speech')
const NO_MAC_SPEECH = path.join(OUT, 'no-such-bridgespeech') // so the Mac's own speech never stands in here

// ---------- The rules, for every kind of computer ----------
process.env.BRIDGE_HOME = path.join(OUT, 'kits', 'speech-rules')
const speech = await import('../../server/speech.js')
const parakeet = speech.MODELS.find((m) => m.id === 'parakeet-v3')
const whisper = speech.MODELS.find((m) => m.id === 'small.en-q5_1')
const fit = (m, o, model = parakeet) => speech.fitModel(model, { memGB: 16, ...m }, o)
const COMPUTERS = [
  ['macOS 14 on Apple Silicon', { platform: 'darwin', arch: 'arm64', os: '14.6' }, true],
  ['macOS 26 on Apple Silicon', { platform: 'darwin', arch: 'arm64', os: '26.1' }, true],
  ['an Intel Mac on macOS 14', { platform: 'darwin', arch: 'x64', os: '14.7' }, true],
  ['the Intel build under Rosetta', { platform: 'darwin', arch: 'x64', os: '15.4', rosetta: true }, true],
  ['Windows x64', { platform: 'win32', arch: 'x64', os: '10.0.22631' }, true],
  ['Windows on Arm, the x64 app emulated', { platform: 'win32', arch: 'x64', os: '10.0.26100', emulated: true }, true],
  ['Linux x64 with glibc 2.35 (Ubuntu 22.04)', { platform: 'linux', arch: 'x64', glibc: '2.35' }, true],
  ['Linux x64 with glibc 2.32', { platform: 'linux', arch: 'x64', glibc: '2.32' }, true],
  ['Linux x64 with glibc 2.31 (Ubuntu 20.04)', { platform: 'linux', arch: 'x64', glibc: '2.31' }, false, /glibc 2\.32 or later.*has 2\.31/],
  ['Linux x64 with musl (Alpine)', { platform: 'linux', arch: 'x64', glibc: null }, false, /needs a Linux with glibc/],
  ['Linux Arm with glibc 2.28', { platform: 'linux', arch: 'arm64', glibc: '2.28' }, true],
  ['Linux Arm with glibc 2.17', { platform: 'linux', arch: 'arm64', glibc: '2.17' }, true],
  ['32-bit Arm Linux (a Raspberry Pi OS 32-bit)', { platform: 'linux', arch: 'arm', glibc: '2.36' }, false, /no build for linux on arm/],
  ['the Docker image (Debian 12)', { platform: 'linux', arch: 'x64', glibc: '2.36', docker: true }, true],
  ['the Docker image on Arm', { platform: 'linux', arch: 'arm64', glibc: '2.36', docker: true }, true],
  ['FreeBSD', { platform: 'freebsd', arch: 'x64' }, false, /no build for freebsd/],
]
for (const [what, m, shown, why] of COMPUTERS) {
  const r = fit(m)
  ok(r.ok === shown && (shown ? r.why === null : why.test(r.why || '')), `${what}: Parakeet ${shown ? 'is offered' : `isn't offered, and the diagnostics say why`}`, r)
}
ok(!fit({ platform: 'darwin', arch: 'arm64', os: '13.6' }, { probe: { ok: false, error: 'Symbol not found: _foo' } }).ok, 'an addon that doesn\'t load on this Mac (tried in a process of its own) hides Parakeet there')
ok(/doesn't load on this computer: Symbol not found/.test(fit({ platform: 'darwin', arch: 'arm64', os: '13.6' }, { probe: { ok: false, error: 'Symbol not found: _foo' } }).why), 'and says why, for diagnostics')
ok(!fit({ platform: 'linux', arch: 'x64', glibc: '2.35', memGB: 2 }).ok && /needs 3 GB of memory; this computer has 2 GB/.test(fit({ platform: 'linux', arch: 'x64', glibc: '2.35', memGB: 2 }).why), 'a computer with 2 GB of memory isn\'t offered Parakeet (it takes about 2 GB loaded)')
ok(fit({ platform: 'linux', arch: 'x64', glibc: '2.35', memGB: 2 }, {}, whisper).ok, 'but is offered a small Whisper')
ok(!fit({ platform: 'linux', arch: 'x64', glibc: '2.36', docker: true }, {}, whisper).ok, 'the Docker image isn\'t offered Whisper (no whisper.cpp in it)')
ok(fit({ platform: 'linux', arch: 'x64', glibc: '2.36', docker: true }, { whisperHere: true }, whisper).ok, 'unless whisper.cpp was installed in the container')
for (const [what, m] of [['a Mac', { platform: 'darwin', arch: 'arm64' }], ['Windows', { platform: 'win32', arch: 'x64' }], ['Linux with an old glibc', { platform: 'linux', arch: 'x64', glibc: '2.31' }]]) ok(fit(m, {}, whisper).ok, `${what}: Whisper is offered (kept for other languages)`)
ok(speech.DEFAULT === 'parakeet-v3', 'the portable default is Parakeet')

// ---------- A small fake model, served from this computer ----------
const served = await startSpeechModels('speech')
const FILES = served.files
const sha = served.sha

// A WAV of a tone: rate, channels and seconds.
const wav = (seconds, rate = 16000, channels = 1) => {
  const n = Math.round(seconds * rate)
  const b = Buffer.alloc(44 + n * 2 * channels)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2 * channels, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2 * channels, 28); b.writeUInt16LE(2 * channels, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2 * channels, 40)
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000), 44 + (i * channels + c) * 2)
  return b
}
const post = async (kit, body, type = 'audio/wav') => { const r = await fetch(`${kit.url}/api/transcribe`, { method: 'POST', headers: { 'content-type': type }, body }); return { status: r.status, ...(await r.json().catch(() => ({}))) } }
const sherpaLog = (kit) => { try { return fs.readFileSync(path.join(kit.dir, 'sherpa.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const kitEnv = served.env

// ---------- A server standing in for another computer ----------
// Linux with glibc 2.31: no Parakeet in the list; a config that picked it falls back, saying so.
const old = await startKit('speech-oldlinux', { env: kitEnv({ BRIDGE_MACHINE: JSON.stringify({ platform: 'linux', arch: 'x64', glibc: '2.31', docker: false }) }), config: { speech: { model: 'parakeet-v3' } } })
try {
  const sp = await old.api('/speech')
  ok(!sp.local.models.some((m) => /^parakeet/.test(m.id)) && sp.local.models.some((m) => m.id === 'large-v3-turbo-q5_0'), 'Linux with glibc 2.31: Parakeet isn\'t in the list; Whisper is', sp.local.models.map((m) => m.id))
  ok(sp.hidden.some((h) => h.id === 'parakeet-v3' && /glibc 2\.32 or later/.test(h.why)), 'and the diagnostics say why', sp.hidden)
  ok(sp.local.model === 'large-v3-turbo-q5_0' && sp.fellBack?.from === 'parakeet-v3' && sp.fellBack.to === 'large-v3-turbo-q5_0' && /glibc/.test(sp.fellBack.why), 'Parakeet picked on another computer: Whisper is used here, and Settings is told why', sp.fellBack)
  const v = await old.api('/voice')
  ok(v.model.id === 'large-v3-turbo-q5_0' && v.needs === 'whisper' && !v.ready, 'voice notes there need whisper.cpp, and say so', { model: v.model.id, needs: v.needs })
  ok(/can't run on this computer|glibc/.test(await old.api('/speech/models/parakeet-v3', {}).then(() => '', (e) => e.message)), 'and Parakeet can\'t be downloaded there')
} finally { old.stop() }
// The Docker image: Parakeet only (no whisper.cpp in it), and no Mac speech.
const docker = await startKit('speech-docker', { env: kitEnv({ BRIDGE_MACHINE: JSON.stringify({ platform: 'linux', arch: 'arm64', glibc: '2.36', docker: true }) }) })
try {
  const sp = await docker.api('/speech')
  ok(sp.local.models.map((m) => m.id).join(',') === 'parakeet-v3,parakeet-en' && sp.local.model === 'parakeet-v3', 'Docker on Arm: Parakeet and Parakeet English, Parakeet first; no Whisper', sp.local.models.map((m) => m.id))
  ok(sp.machine.docker === true && sp.machine.arch === 'arm64' && sp.machine.sherpa?.ok === true, 'its diagnostics say what it is, and that sherpa-onnx loaded', sp.machine)
} finally { docker.stop() }

// An addon that won't load here (as sherpa-onnx's, built for macOS 15 on Intel, might on macOS 14): tried in
// a process of its own, so the server stays up; Parakeet isn't offered, and Whisper is used.
const broken = path.join(OUT, 'kits', 'speech-broken-sherpa.cjs')
fs.writeFileSync(broken, "throw new Error('dlopen(sherpa-onnx.node): Symbol not found: _foo (which was built for macOS 15.0)')\n")
const nope = await startKit('speech-broken', { env: kitEnv({ BRIDGE_SHERPA: broken, BRIDGE_MACHINE: JSON.stringify({ platform: 'darwin', arch: 'x64', os: '14.7', docker: false }) }) })
try {
  const sp = await nope.api('/speech')
  ok(!sp.local.models.some((m) => /^parakeet/.test(m.id)) && sp.local.model === 'large-v3-turbo-q5_0', 'sherpa-onnx that won\'t load on this computer: no Parakeet in the list, Whisper used', sp.local.models.map((m) => m.id))
  ok(sp.hidden.some((h) => h.id === 'parakeet-v3' && /doesn't load on this computer: dlopen\(sherpa-onnx\.node\): Symbol not found/.test(h.why)) && sp.machine.sherpa?.ok === false, 'and the diagnostics say what the loader said', sp.hidden)
} finally { nope.stop() }

// ---------- This computer, with the stand-in engine ----------
const kit = await startKit('speech', { env: kitEnv({ BRIDGE_ASR_IDLE_MS: '2500' }), config: { meetings: { vocabulary: 'Kubernetes, OKRs' } } })
try {
  await kit.api('/setup', { name: 'Tester' })
  const sp = await kit.api('/speech')
  ok(sp.local.models[0]?.id === 'parakeet-v3' && sp.local.models[0].best && sp.local.model === 'parakeet-v3' && sp.local.default === 'parakeet-v3', 'a new computer: Parakeet first in the list, and the one used', sp.local.models.map((m) => m.id))
  ok(sp.local.models.find((m) => m.id === 'parakeet-v3').mb === 670 && sp.local.models.find((m) => m.id === 'parakeet-v3').license === 'CC-BY-4.0', 'with its size and license')
  ok(!fs.existsSync(path.join(kit.data, 'models')) && served.asked.length === 0, 'nothing downloads by itself: not at start, not when Settings looks', served.asked)

  // The first time: the answer says what's needed, in words, and starts nothing.
  let r = await post(kit, wav(1.5))
  ok(r.status === 409 && r.code === 'needs-model' && r.model?.id === 'parakeet-v3' && r.model.mb === 670, 'the first voice note: a one-time download is needed (409, needs-model, the model)', r)
  ok(/one-time download: Parakeet, 670 MB\. It stays on this computer/.test(r.error || ''), 'said in words the page can show as it is', r.error)
  await sleep(300)
  ok(served.asked.length === 0, 'and nothing started downloading')

  // Not enough room: said before anything downloads.
  // (The server reads free space for real; a kit of its own says there's 5 MB.)
  const tight = await startKit('speech-tight', { env: kitEnv({ BRIDGE_MACHINE: JSON.stringify({ freeMB: 1 }) }) })
  try {
    await tight.api('/speech/models/parakeet-v3', {})
    const t = await until(async () => (await tight.api('/voice')).error, 10000)
    ok(/Not enough free space: Parakeet needs \d+ MB, and there's 1 MB free/.test(t || ''), 'too little free space: it says so, and downloads nothing', t)
  } finally { tight.stop() }
  served.asked.length = 0

  // Bad checksum: Whisper base's file doesn't match, so it's thrown away.
  await kit.api('/speech/models/base.en-q5_1', {})
  const bad = await until(async () => (await kit.api('/speech')).local.models.find((m) => m.id === 'base.en-q5_1').downloading?.error, 15000)
  ok(/ggml-base\.en-q5_1\.bin didn't match its checksum/.test(bad || ''), 'a download that doesn\'t match its checksum fails, and says so', bad)
  ok(!fs.existsSync(path.join(kit.data, 'models', 'ggml-base.en-q5_1.bin')) && !fs.existsSync(path.join(kit.data, 'models', 'ggml-base.en-q5_1.bin.part')), 'and the file is thrown away', fs.existsSync(path.join(kit.data, 'models')) ? fs.readdirSync(path.join(kit.data, 'models')) : [])
  ok(!(await kit.api('/speech')).local.models.find((m) => m.id === 'base.en-q5_1').have, 'so the model isn\'t counted as here')

  // One click: the download, cut off part way, then picked up where it stopped.
  served.cut = 600_000
  served.slow = 40
  const s1 = await kit.api('/voice/setup', {})
  ok(s1.model.id === 'parakeet-v3', 'Download: the voice model starts downloading', s1.model)
  const mid = await until(async () => { const v = await kit.api('/voice'); return v.downloading?.percent > 0 && v.downloading.percent < 100 && v.downloading.percent }, 10000, 50)
  ok(!!mid, 'with progress along the way', mid)
  const cutErr = await until(async () => (await kit.api('/voice')).error, 15000)
  ok(/cut short/.test(cutErr || ''), 'a dropped connection says so', cutErr)
  const part = path.join(kit.data, 'models', 'parakeet-v3', 'encoder.int8.onnx.part')
  const kept = fs.existsSync(part) ? fs.statSync(part).size : 0
  ok(kept >= 500_000 && kept < FILES['encoder.int8.onnx'].length, 'what came is kept', kept)
  served.slow = 0
  await kit.api('/voice/setup', {})
  const ready = await until(async () => (await kit.api('/voice')).ready, 15000)
  ok(!!ready, 'Try again: it finishes')
  const resumed = served.asked.filter((a) => a.model === 'parakeet-v3' && a.name === 'encoder.int8.onnx').at(-1)
  ok(resumed?.range === `bytes=${kept}-`, 'asking only for the rest', resumed)
  ok(served.asked.filter((a) => a.model === 'parakeet-v3' && a.name === 'tokens.txt').length === 1, 'and the files already done aren\'t downloaded again', served.asked.map((a) => `${a.model}/${a.name}`))
  ok(sha(fs.readFileSync(path.join(kit.data, 'models', 'parakeet-v3', 'encoder.int8.onnx'))) === sha(FILES['encoder.int8.onnx']), 'the file put together is the right one')

  // Now it transcribes, in its own process, with the names to listen for.
  await kit.api('/meetings/memory', { term: 'Claude Code', heard: ['Claud Code'] })
  r = await post(kit, wav(1.5))
  ok(r.status === 200 && r.text === 'Open the work tree in Claude Code.' && r.engine === 'Parakeet', 'a 16 kHz WAV is transcribed by Parakeet, meeting memory\'s spelling fixed', r)
  let log = sherpaLog(kit)
  const loads = log.filter((l) => l.load)
  const asks = log.filter((l) => l.seconds != null)
  ok(loads.length === 1 && loads[0].load === 'parakeet-v3' && loads[0].decoding === 'modified_beam_search' && loads[0].bpeVocab, 'the model is loaded in the engine\'s process, set up for names to listen for', loads)
  ok(asks[0]?.seconds === 1.5, 'it gets the whole clip, as 16 kHz', asks[0])
  ok(['Claude Code', 'Codex', 'worktree', 'Kubernetes', 'OKRs'].every((w) => asks[0]?.hotwords.includes(w)), 'names to listen for: Bridge AI\'s, Settings\' words and meeting memory\'s', asks[0]?.hotwords)
  ok(!asks[0]?.hotwords.some((w) => /PR|repo|chief/.test(w)), 'not everyday words, which would only get in the way', asks[0]?.hotwords)

  r = await post(kit, wav(2, 48000, 2))
  log = sherpaLog(kit)
  ok(r.status === 200 && log.filter((l) => l.seconds != null).at(-1)?.seconds === 2, 'a 48 kHz stereo WAV is turned into 16 kHz mono first', log.at(-1))
  ok(log.filter((l) => l.load).length === 1, 'the model stays loaded between voice notes')
  // The names dictation spells (server/dictation.js: agents, projects, branches, and the agents and
  // models Bridge AI knows), found in the background after the first voice note.
  const more = await until(async () => { await post(kit, wav(0.5)); const h = sherpaLog(kit).filter((l) => l.seconds != null).at(-1)?.hotwords || []; return h.includes('OpenCode') && h }, 8000, 300)
  ok(!!more && !more.includes('main'), 'and the names dictation spells, not plain lowercase words', more)
  ok(Math.abs(log.filter((l) => l.seconds != null).at(-1)?.peak - 0.244) < 0.02, 'and sounds the same after (its level kept)', log.at(-1))

  r = await post(kit, Buffer.from('OggS not really a recording'), 'audio/webm;codecs=opus')
  ok(r.status === 415 && r.code === 'needs-ffmpeg' && /came as audio\/webm, which Bridge AI reads with ffmpeg, and ffmpeg isn't on this computer/.test(r.error || ''), 'compressed audio without ffmpeg: it says so plainly', r)

  // Unused for a moment (2.5 s in this test, minutes in the app): let go, and loaded again next time.
  await sleep(5000)
  r = await post(kit, wav(1))
  log = sherpaLog(kit)
  ok(r.status === 200 && log.filter((l) => l.load).length === 2 && log.filter((l) => l.load)[1].pid !== log.filter((l) => l.load)[0].pid, 'unused for a while, the engine lets go of the model; the next voice note loads it again', log.filter((l) => l.load))

  // A crash in the engine: started again, and the voice note still comes back.
  fs.writeFileSync(path.join(kit.data, 'models', 'parakeet-v3', 'crash-once'), '')
  r = await post(kit, wav(1))
  log = sherpaLog(kit)
  ok(r.status === 200 && r.text, 'the engine crashed mid-way: started again, and the text still comes', r)
  ok((await kit.api('/config').then(() => true, () => false)), 'the server didn\'t go down with it')
  fs.writeFileSync(path.join(kit.data, 'models', 'parakeet-v3', 'crash-always'), '')
  r = await post(kit, wav(1))
  ok(r.status === 502 && /speech engine stopped/.test(r.error || ''), 'one that crashes every time says so, once tried twice', r)
  fs.rmSync(path.join(kit.data, 'models', 'parakeet-v3', 'crash-always'))

  // A meeting, transcribed by Parakeet.
  await kit.api('/settings', { meetings: { engine: 'local', autoSummary: false, cleanup: false } }, 'PATCH')
  const A = await kit.api('/meetings', { title: 'Parakeet sync', call: false })
  const tone = wav(2.5).subarray(44)
  const silence = Buffer.alloc(16000 * 2 * 2)
  let seq = 0
  for (const b of [silence.subarray(0, 16000), tone, silence]) for (let o = 0; o < b.length; o += 32000) await fetch(`${kit.url}/api/meetings/${A.id}/audio?src=you&seq=${seq++}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: b.subarray(o, o + 32000) })
  await kit.api(`/meetings/${A.id}/stop`, {})
  const got = await until(async () => { const m = await kit.api(`/meetings/${A.id}`); return m.status === 'done' && m.transcript.length && m }, 20000)
  ok(!!got && got.transcript[0].text === 'Open the work tree in Claude Code.' && got.transcript[0].engine === 'Parakeet', 'a meeting on this computer is transcribed by Parakeet, with meeting memory\'s spelling', got?.transcript)
  ok(sherpaLog(kit).filter((l) => l.seconds != null).at(-1)?.hotwords.includes('Kubernetes'), 'and the meeting\'s words to listen for')

  // Remove: gone from the disk and from memory; the next voice note asks for the download again.
  await kit.api('/speech/models/parakeet-v3', null, 'DELETE')
  ok(!fs.existsSync(path.join(kit.data, 'models', 'parakeet-v3')), 'Remove deletes its files')
  r = await post(kit, wav(1))
  ok(r.status === 409 && r.code === 'needs-model', 'and the mic asks for the download again', r)
} catch (e) {
  ok(false, `speech crashed: ${e.stack}`)
  console.log(kit.log().slice(-2000))
} finally { kit.stop() }

// ---------- The real thing (BRIDGE_REAL_PARAKEET=1, by hand) ----------
// Both Parakeets from Hugging Face (kept in test/.out/real-models for next time), the real addon,
// and a sentence spoken by macOS's `say` (Samantha's voice: the default one is too robotic for any
// model), with words Parakeet mishears without help.
if (process.env.BRIDGE_REAL_PARAKEET === '1') {
  const store = path.join(OUT, 'real-models')
  fs.mkdirSync(store, { recursive: true })
  const real = await startKit('speech-real', { env: { BRIDGE_MODELS_URL: '', BRIDGE_SHERPA: '', BRIDGE_SPEECH: NO_MAC_SPEECH } })
  try {
    fs.symlinkSync(store, path.join(real.data, 'models'), 'junction')
    let clip = null
    if (IS_MAC) {
      const file = path.join(os.tmpdir(), `bridge-say-${process.pid}.wav`)
      const said = 'Open the worktree in Claude Code, then ask Codex to review the pull request.'
      if (spawnSync('say', ['-v', 'Samantha', '-o', file, '--data-format=LEI16@16000', said]).status !== 0) spawnSync('say', ['-o', file, '--data-format=LEI16@16000', said])
      clip = fs.existsSync(file) ? fs.readFileSync(file) : null
    }
    for (const id of ['parakeet-v3', 'parakeet-en']) {
      await real.api('/settings', { speech: { model: id } }, 'PATCH')
      const t0 = Date.now()
      await real.api('/voice/setup', {})
      const got = await until(async () => { const v = await real.api('/voice'); if (v.error) throw new Error(v.error); return v.ready && v.model.id === id && v }, 60 * 60_000, 2000)
      console.log(`REAL ${id}: downloaded and checked in ${Math.round((Date.now() - t0) / 1000)} s (or already here)`)
      ok(!!got, `the real ${id} downloads from Hugging Face and matches its checksums`)
      if (!clip) { skip(`the real ${id} transcribing`, 'a clip needs macOS `say`'); continue }
      const t1 = Date.now()
      const r = await post(real, clip)
      const first = (Date.now() - t1) / 1000
      const t2 = Date.now()
      const r2 = await post(real, clip)
      console.log(`REAL ${id}: "${r.text}" in ${first.toFixed(2)} s with loading, then ${((Date.now() - t2) / 1000).toFixed(2)} s loaded`)
      ok(r.status === 200 && /Claude Code/.test(r.text) && /Codex/.test(r.text) && /pull request/i.test(r.text) && r2.text === r.text, `the real ${id} writes what was said, Claude Code and Codex spelled right`, r)
    }
  } finally { real.stop() }
} else skip('the real Parakeet', 'set BRIDGE_REAL_PARAKEET=1 to download it and try it once')

served.stop()
process.exit(done().fail ? 1 : 0)
