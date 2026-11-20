// The local model built into Bridge AI (server/llm.js): Gemma 4 E2B, E4B or 26B-A4B on llama.cpp's
// llama-server, with a stand-in llama-server (stand-ins/llama-server.mjs) and a small fake model
// served from this computer, so nothing real is downloaded or run.
//   Where it's offered, by the rules for every kind of computer (memory, the build for its platform
//   and chip, macOS and glibc versions, the Docker image, a build that won't load), then by servers
//   standing in for some of them: hidden, with why, where it can't run.
//   Which model, by the computer: the three pinned; the one recommended for 8, 16, 24, 32 and 64 GB
//   Macs, an Intel Mac, PCs with and without a GPU, and why; the larger ones hidden where there's no
//   GPU or too little memory, saying why.
//   Which jobs run here (modeljobs.js): Auto puts a short job on the local model and a long one, a
//   diagram, live suggestions or the transcript cleanup on your cloud model; Cloud first; On this
//   computer, which says why when it can't run.
//   Nothing downloads or starts before you pick it: not at start, not when Settings looks, not when
//   a model is chosen for a job. The download: its progress, picked up where it stopped, checked
//   against its SHA-256 (one that doesn't match is thrown away), and too little room said first; a
//   model downloaded before stays in use until the one recommended is downloaded.
//   Which model Bridge AI uses: your own Ollama before the built-in model with nothing else; with a
//   key or Claude, a short meeting on the local model and a long one on the cloud (Auto), Claude
//   first on Cloud first, everything here on On this computer; edit by voice on it by itself.
//   llama-server: started on first use, on 127.0.0.1 with a key in its environment (not on its
//   command line), thinking off, kept a while and let go when idle, started again when it stops,
//   and a request it stopped in the middle of asked again. Remove stops it and takes the file away.
//   Settings › Agents & Models › Model Providers: the one recommended and why, a row for each model
//   this computer runs with its size and what it's good for, Download with progress, In use and
//   Remove; and the next tab, Which Model Does What: where each task runs (Models for Each Task),
//   with what Auto does now; none of it on a computer with 4 GB of memory, where the tasks have no
//   On this computer to put them on.
// BRIDGE_REAL_LLAMA=1: also the real thing, once, by hand: this computer's llama-server (node
// scripts/llama.js native/llama puts it there) and the real Gemma 4 E2B (downloaded from Hugging Face
// into test/.out/real-models, kept for next time), asked to rewrite a sentence and for JSON.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { startKit, startModel, startLocalModel, checks, until, sleep, OUT, TEST, ROOT, IS_MAC, freePort, browser, page, shot } from '../lib/harness.mjs'

const { ok, skip, done } = checks('builtin-model')
const STAND_IN = path.join(TEST, 'stand-ins', 'llama-server.mjs')
// Every kind of job on Auto (Cloud first is the default).
const AUTO = { notes: 'auto', assist: 'auto', mail: 'auto', tidy: 'auto', live: 'auto', diagrams: 'auto' }

// ---------- The rules, for every kind of computer ----------
process.env.BRIDGE_HOME = path.join(OUT, 'kits', 'builtin-rules')
const llm = await import('../../server/llm.js')
const gemma = llm.MODELS.find((m) => m.id === 'gemma-4-e2b')
ok(gemma && gemma.license === 'Apache-2.0' && gemma.files[0].name === 'gemma-4-E2B-it-Q4_0.gguf' && gemma.files[0].bytes === 2841481184 && /^[0-9a-f]{64}$/.test(gemma.files[0].sha256) && /^[0-9a-f]{40}$/.test(gemma.rev), 'the model is Gemma 4 E2B (Apache-2.0), one 2.8 GB file pinned to a revision and a SHA-256', gemma?.files)
// What came with the app for that computer: its build (as llm.js finds it), or none.
const buildFor = (m) => { const key = m.platform === 'win32' && m.emulated ? 'win32-arm64' : `${m.platform}-${m.arch}`; return llm.NEEDS[key] ? { key, needs: llm.NEEDS[key] } : null }
const fit = (m, o = {}) => llm.fitModel(gemma, { memGB: 16, ...m }, { build: 'build' in o ? o.build : buildFor({ memGB: 16, ...m }), probe: o.probe || null })
const COMPUTERS = [
  ['macOS 14 on Apple Silicon, 16 GB', { platform: 'darwin', arch: 'arm64', os: '14.6' }, true],
  ['macOS 26 on Apple Silicon, 8 GB', { platform: 'darwin', arch: 'arm64', os: '26.1', memGB: 8.6 }, true],
  ['an Intel Mac on macOS 14', { platform: 'darwin', arch: 'x64', os: '14.7' }, true],
  ['a Mac older than llama.cpp\'s build (macOS 13.0)', { platform: 'darwin', arch: 'arm64', os: '13.0' }, false, /needs macOS 13\.3 or later; this Mac has 13\.0/],
  ['a computer with 4 GB of memory', { platform: 'darwin', arch: 'arm64', os: '15.4', memGB: 4 }, false, /needs 8 GB of memory; this computer has 4 GB/],
  ['Windows x64', { platform: 'win32', arch: 'x64', os: '10.0.22631' }, true],
  ['Windows on Arm, the x64 app emulated (its Arm build)', { platform: 'win32', arch: 'x64', os: '10.0.26100', emulated: true }, true],
  ['Linux x64 with glibc 2.35 (Ubuntu 22.04)', { platform: 'linux', arch: 'x64', glibc: '2.35' }, true],
  ['Linux x64 with glibc 2.34', { platform: 'linux', arch: 'x64', glibc: '2.34' }, true],
  ['Linux x64 with glibc 2.31 (Ubuntu 20.04)', { platform: 'linux', arch: 'x64', glibc: '2.31' }, false, /glibc 2\.34 or later; this Linux has 2\.31/],
  ['Linux x64 with musl (Alpine)', { platform: 'linux', arch: 'x64', glibc: null }, false, /needs a Linux with glibc/],
  ['Linux on Arm with glibc 2.36 (Debian 12)', { platform: 'linux', arch: 'arm64', glibc: '2.36' }, false, /glibc 2\.38 or later; this Linux has 2\.36/],
  ['Linux on Arm with glibc 2.39 (Ubuntu 24.04)', { platform: 'linux', arch: 'arm64', glibc: '2.39' }, true],
  ['32-bit Arm Linux', { platform: 'linux', arch: 'arm', glibc: '2.36' }, false, /no llama\.cpp build for linux on arm/],
  ['FreeBSD', { platform: 'freebsd', arch: 'x64' }, false, /no llama\.cpp build for freebsd/],
]
for (const [what, m, shown, why] of COMPUTERS) {
  const r = fit(m)
  ok(r.ok === shown && (shown ? r.why === null : why.test(r.why || '')), `${what}: the local model ${shown ? 'is offered' : 'isn\'t offered, and the diagnostics say why'}`, r)
}
ok(/isn't in the Docker image/.test(fit({ platform: 'linux', arch: 'x64', glibc: '2.36', docker: true }, { build: null }).why || ''), 'the Docker image (no llama.cpp in it): not offered, saying why')
ok(/didn't come with this copy/.test(fit({ platform: 'linux', arch: 'x64', glibc: '2.39' }, { build: null }).why || ''), 'a server run from a checkout without a build: not offered, saying why')
const broken = fit({ platform: 'darwin', arch: 'arm64', os: '14.6' }, { probe: { ok: false, error: 'Library not loaded: @rpath/libggml-metal.0.dylib' } })
ok(!broken.ok && /doesn't load on this computer: Library not loaded/.test(broken.why || ''), 'a build that doesn\'t load here (tried in a process of its own): not offered, with what the loader said', broken)

// ---------- Which model, for each kind of computer ----------
// The larger ones, pinned like the first (values from Hugging Face's own listing of each revision).
const e4b = llm.MODELS.find((m) => m.id === 'gemma-4-e4b')
const big = llm.MODELS.find((m) => m.id === 'gemma-4-26b-a4b')
ok(llm.MODELS.length === 3 && llm.MODELS.every((m) => m.license === 'Apache-2.0' && /^ggml-org\/gemma-4-/.test(m.repo) && /^[0-9a-f]{40}$/.test(m.rev) && m.files.length === 1 && /^[0-9a-f]{64}$/.test(m.files[0].sha256) && m.files[0].bytes > 1e9) && llm.MODELS.map((m) => m.memGB).join() === '8,16,32', 'three models, smallest first, each Apache-2.0 from the llama.cpp team, pinned to a revision, a size and a SHA-256', llm.MODELS.map((m) => [m.id, m.memGB]))
ok(e4b?.files[0].name === 'gemma-4-E4B-it-Q4_0.gguf' && e4b.files[0].bytes === 4590807392 && e4b.files[0].sha256 === 'a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2' && e4b.rev === 'a69f018d7678a2b9f5e705f8903d6fb29b9b25dc' && e4b.gpu && e4b.active === 4.5, 'Gemma 4 E4B: 4.6 GB, for 16 GB with a GPU', e4b)
ok(big?.files[0].name === 'gemma-4-26B-A4B-it-Q4_0.gguf' && big.files[0].bytes === 14618145824 && big.files[0].sha256 === 'd208665ab1cd3a69f7a9a4bc59430e8448c8093d9b06334f566ac59d6d504a03' && big.rev === '9cf8c8db0f83fb4582f15381f8fb1a7c1b0b9ca2' && big.gpu && big.active === 3.8, 'Gemma 4 26B-A4B: 14.6 GB, for 32 GB with a GPU', big)
const RECOMMEND = [
  ['an 8 GB Mac', { platform: 'darwin', arch: 'arm64', memGB: 8.6 }, 'Apple M2', 'gemma-4-e2b', '8 GB of memory: Gemma 4 E2B'],
  ['a 16 GB Mac', { platform: 'darwin', arch: 'arm64', memGB: 17.2 }, 'Apple M4', 'gemma-4-e4b', '16 GB of memory: Gemma 4 E4B'],
  ['a 24 GB Mac', { platform: 'darwin', arch: 'arm64', memGB: 25.8 }, 'Apple M4', 'gemma-4-e4b', '24 GB of memory: Gemma 4 E4B'],
  ['a 32 GB Mac', { platform: 'darwin', arch: 'arm64', memGB: 34.4 }, 'Apple M4 Pro', 'gemma-4-26b-a4b', '32 GB of memory: Gemma 4 26B-A4B'],
  ['a 64 GB Mac', { platform: 'darwin', arch: 'arm64', memGB: 68.7 }, 'Apple M4 Max', 'gemma-4-26b-a4b', '64 GB of memory: Gemma 4 26B-A4B'],
  ['an Intel Mac with 16 GB (Metal unused there)', { platform: 'darwin', arch: 'x64', memGB: 17.2 }, 'AMD Radeon Pro 5500M', 'gemma-4-e2b', '16 GB of memory, processor only: Gemma 4 E2B'],
  ['a PC with 16 GB and no GPU', { platform: 'win32', arch: 'x64', memGB: 17.2 }, null, 'gemma-4-e2b', '16 GB of memory, processor only: Gemma 4 E2B'],
  ['a PC with 8 GB and no GPU', { platform: 'win32', arch: 'x64', memGB: 8.5 }, null, 'gemma-4-e2b', '8 GB of memory: Gemma 4 E2B'],
  ['Linux with 16 GB and a Vulkan GPU', { platform: 'linux', arch: 'x64', glibc: '2.35', memGB: 16.7 }, 'AMD Radeon RX 7600', 'gemma-4-e4b', '16 GB of memory: Gemma 4 E4B'],
  ['a PC with 32 GB and an NVIDIA GPU', { platform: 'win32', arch: 'x64', memGB: 34.3 }, 'NVIDIA GeForce RTX 4070', 'gemma-4-26b-a4b', '32 GB of memory: Gemma 4 26B-A4B'],
  ['Windows on Arm with 32 GB (processor only)', { platform: 'win32', arch: 'x64', emulated: true, memGB: 34.3 }, null, 'gemma-4-e2b', '32 GB of memory, processor only: Gemma 4 E2B'],
]
for (const [what, m, gpu, id, why] of RECOMMEND) {
  const r = llm.recommend(m, { gpu })
  ok(r?.id === id && r.why === why, `${what}: recommends ${id}, saying "${why}"`, r)
}
ok(llm.recommend({ platform: 'darwin', arch: 'arm64', memGB: 4.3 }, { gpu: 'Apple M1' }) === null, 'a computer with 4 GB: none recommended')
// Hidden where it can't run, saying why.
const onCpu = llm.fitModel(e4b, { platform: 'win32', arch: 'x64', memGB: 34.3 }, { build: buildFor({ platform: 'win32', arch: 'x64' }), gpu: null })
ok(!onCpu.ok && /Gemma 4 E4B needs a GPU llama\.cpp can use/.test(onCpu.why || ''), 'Gemma 4 E4B on a PC without a GPU: hidden, saying why', onCpu)
const intelMac = llm.fitModel(e4b, { platform: 'darwin', arch: 'x64', os: '14.7', memGB: 34.4 }, { build: buildFor({ platform: 'darwin', arch: 'x64' }), gpu: 'AMD Radeon Pro 5500M' })
ok(!intelMac.ok && /needs a GPU/.test(intelMac.why || ''), 'and on an Intel Mac, whose GPU llama.cpp doesn\'t use', intelMac)
const tooSmall = llm.fitModel(big, { platform: 'darwin', arch: 'arm64', os: '15.4', memGB: 25.8 }, { build: buildFor({ platform: 'darwin', arch: 'arm64' }), gpu: 'Apple M4' })
ok(!tooSmall.ok && /Gemma 4 26B-A4B needs 32 GB of memory; this computer has 25\.8 GB/.test(tooSmall.why || ''), 'Gemma 4 26B-A4B on a 24 GB Mac: hidden, saying why', tooSmall)
ok(llm.fitModel(gemma, { platform: 'win32', arch: 'x64', memGB: 8.5 }, { build: buildFor({ platform: 'win32', arch: 'x64' }), gpu: null }).ok, 'Gemma 4 E2B runs on a processor alone')

// ---------- Which jobs run here (modeljobs.js) ----------
const jobs = await import('../../server/modeljobs.js')
const here = { id: 'bridge:gemma-4-e4b', label: 'Gemma 4 E4B' }
const limit = jobs.shortLimit({ ctx: 32768, readPerSecond: 300 })
ok(limit.tokens === 12000 && Math.floor(limit.tokens / jobs.PER_MINUTE) === 50, 'Auto\'s short: about 50 minutes of a meeting, within what the model reads at a time', limit)
ok(jobs.shortLimit({ ctx: 8192 }).tokens === 8192 - 2048 && jobs.shortLimit({ ctx: 16384, readPerSecond: 40 }).by === 'slow', 'held to less by a short context, or a slow processor', [jobs.shortLimit({ ctx: 8192 }), jobs.shortLimit({ ctx: 16384, readPerSecond: 40 })])
const both = { job: 'notes', first: 'cli:claude', cloud: 'cli:claude', local: here, limit }
let r = jobs.route({ ...both, need: 3000, seconds: 40 })
ok(r.id === here.id && r.where === 'local' && r.auto && r.why === 'short', 'Auto: a short meeting\'s notes on the local model, though Claude is there', r)
r = jobs.route({ ...both, need: 20000, seconds: 90 })
ok(r.id === 'cli:claude' && r.why === 'long', 'Auto: a meeting longer than that on Claude', r)
r = jobs.route({ ...both, need: 3000, seconds: 400 })
ok(r.id === 'cli:claude' && r.why === 'slow', 'Auto: one that would take minutes here on Claude', r)
r = jobs.route({ ...both, need: null })
ok(r.id === 'cli:claude' && r.why === 'unknown', 'Auto: one of no known size on Claude', r)
for (const job of ['diagrams', 'live']) {
  r = jobs.route({ ...both, job, need: 300, seconds: 5 })
  ok(r.id === 'cli:claude' && r.why === 'better', `Auto: ${job === 'live' ? 'live suggestions' : 'diagrams'}, however short, on Claude`, r)
}
r = jobs.route({ ...both, job: 'tidy', need: 300, seconds: 5, better: true })
ok(r.id === 'cli:claude', 'Auto: the transcript cleanup on Claude too', r)
r = jobs.route({ ...both, cloud: null, first: here.id, need: 90000 })
ok(r.id === here.id && r.why === 'nothing else', 'Auto with nothing else: the local model, however long', r)
r = jobs.route({ ...both, set: 'cloud', need: 300 })
ok(r.id === 'cli:claude' && !r.auto, 'Cloud first: Claude, as before', r)
r = jobs.route({ ...both, set: 'local', need: 90000 })
ok(r.id === here.id && r.kept, 'On this computer: the local model, however long', r)
r = jobs.route({ ...both, set: 'local', local: null, missing: { code: 'not_downloaded', why: 'Gemma 4 E4B isn\'t downloaded yet' } })
ok(r.error?.code === 'local_missing' && r.error.message === 'Meeting notes is set to run on this computer, but Gemma 4 E4B isn\'t downloaded yet. Download it in Settings › Agents & Models › Model Providers, or set Meeting notes to Auto in Settings › Agents & Models › Which Model Does What.', 'On this computer with the model not downloaded: an error that says so, and what to do', r.error?.message)
r = jobs.route({ ...both, job: 'mail', set: 'local', local: null, missing: { code: 'not_here', why: 'Gemma 4 E2B needs 8 GB of memory; this computer has 4 GB' } })
ok(/^Mail is set to run on this computer, but Gemma 4 E2B needs 8 GB of memory; this computer has 4 GB\. Set Mail to Auto/.test(r.error?.message || ''), 'and on a computer it can\'t run on, why not', r.error?.message)

// ---------- A small fake model, served from this computer ----------
const fake = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 255; return b }
const MODEL = fake(3_000_000)
const SHA = crypto.createHash('sha256').update(MODEL).digest('hex')
const files = { asked: [], cut: 0, slow: 0 }
const srv = http.createServer(async (req, res) => {
  const [, id, name] = req.url.split('/')
  files.asked.push({ id, name, range: req.headers.range || null })
  if (id !== 'gemma-4-e2b' || name !== gemma.files[0].name) { res.writeHead(404); res.end(); return }
  const m = /bytes=(\d+)-/.exec(req.headers.range || '')
  const from = m ? Number(m[1]) : 0
  const part = MODEL.subarray(from)
  res.writeHead(m ? 206 : 200, { 'content-length': part.length, ...(m ? { 'content-range': `bytes ${from}-${MODEL.length - 1}/${MODEL.length}` } : {}) })
  const cut = files.cut
  files.cut = 0
  for (let o = 0; o < part.length; o += 100_000) {
    if (cut && o >= cut) { res.destroy(); return }
    res.write(part.subarray(o, Math.min(part.length, o + 100_000)))
    if (files.slow) await sleep(files.slow)
  }
  res.end()
})
const filesPort = await freePort()
await new Promise((r) => srv.listen(filesPort, '127.0.0.1', r))
const catalog = (sha) => {
  const f = path.join(OUT, 'kits', `builtin-models-${sha.slice(0, 8)}.json`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify({ 'gemma-4-e2b': { files: [{ name: gemma.files[0].name, bytes: MODEL.length, sha256: sha }] } }))
  return f
}
const GOOD = catalog(SHA)
// A server of its own: 16 GB unless said, the stand-in llama-server (its log in the kit's folder),
// models from this computer, let go after 1.5 s idle.
const kitEnv = ({ machine = {}, models = GOOD, ...more } = {}) => ({ bin }) => ({
  BRIDGE_MACHINE: JSON.stringify({ memGB: 16, ...machine }), BRIDGE_MODELS_URL: `http://127.0.0.1:${filesPort}`, BRIDGE_LLM_MODELS: models,
  BRIDGE_LLAMA_SERVER: STAND_IN, BRIDGE_LLAMA_LOG: path.join(path.dirname(bin), 'llama.log'), BRIDGE_LLM_IDLE_MS: '1500', ...more,
})
const llamaLog = (kit) => { try { return fs.readFileSync(path.join(kit.dir, 'llama.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const launches = (kit) => llamaLog(kit).filter((x) => x.launch)
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const err = (kit, p, body, method) => kit.api(p, body, method).then(() => null, (e) => e.message)
const builtinListed = async (kit) => (await kit.api('/chat/models?refresh=1')).models.find((m) => m.id === 'bridge:gemma-4-e2b')
async function meeting(kit, title) {
  const m = await kit.api('/meetings', { title, call: false })
  await kit.api(`/meetings/${m.id}/stop`, {})
  await until(async () => (await kit.api(`/meetings/${m.id}`)).status === 'done', 15000)
  fs.appendFileSync(path.join(kit.data, 'meetings', m.id, 'transcript.jsonl'), `${JSON.stringify({ src: 'you', t0: 1, t1: 4, text: 'We agreed to ship on Friday.', engine: 'test' })}\n`)
  return m.id
}
// The model notes were written with, when none was picked: { model, note, error }.
async function notesBy(kit) {
  const id = await meeting(kit, 'Which model')
  await kit.api(`/meetings/${id}/summary`, {})
  const m = await until(async () => { const x = await kit.api(`/meetings/${id}`); return !x.summarizing && (x.summary || x.summaryError) && x }, 30000)
  return { model: m?.summaryModel || null, note: m?.summaryNote || null, error: m?.summaryError || null }
}
const consult = (kit) => kit.api('/consult', { who: 'local', prompt: 'What is two and two?' }).catch((e) => ({ error: e.message }))
const edit = (kit) => kit.api('/dictation/edit', { text: 'teh plan is fine', instruction: 'make it louder' }).catch((e) => ({ error: e.message }))

// ---------- Computers where it can't run ----------
for (const [what, more, why] of [
  ['4 GB of memory', { machine: { memGB: 4 } }, /needs 8 GB of memory/],
  ['Linux with glibc 2.31', { machine: { platform: 'linux', arch: 'x64', glibc: '2.31', docker: false } }, /glibc 2\.34 or later/],
  ['a llama.cpp build that doesn\'t load', { BRIDGE_LLAMA_FAIL: 'load' }, /doesn't load on this computer: dyld: Library not loaded/],
]) {
  const k = await startKit(`builtin-${what.replace(/\W+/g, '-').slice(0, 20)}`, { env: kitEnv(more) })
  try {
    const s = await k.api('/llm')
    ok(s.offered === false && why.test(s.why || ''), `${what}: not offered, and the diagnostics say why`, s)
    ok(/./.test(await err(k, '/llm/download', {}) || '') && !files.asked.some((a) => a.id === 'gemma-4-e2b'), 'and it can\'t be downloaded there')
  } finally { k.stop() }
}

// A build whose first device list takes longer than it's given (a slow Mac compiling llama.cpp's GPU
// shaders the first time): not offered for now, and asked again the next time.
{
  const k = await startKit('builtin-slow-probe', { env: kitEnv({ BRIDGE_LLAMA_FAIL: 'slow-once', BRIDGE_LLAMA_PROBE_MS: '1500' }) })
  try {
    const first = await k.api('/llm')
    ok(first.offered === false && /doesn't load on this computer: it took more than 2 seconds to start/.test(first.why || ''), 'a build that takes longer to start than it\'s given: not offered for now, saying why', first)
    const later = await until(async () => { const s = await k.api('/llm'); return s.offered ? s : null }, 20000, 500)
    ok(!!later && llamaLog(k).filter((x) => x.probe).length === 2, 'and asked again the next time: offered once it answers in time, and remembered', { later, probes: llamaLog(k).filter((x) => x.probe).length })
  } finally { k.stop() }
}

// ---------- This computer ----------
const kit = await startKit('builtin', { env: kitEnv(), config: { meetings: { autoSummary: false, cleanup: false, nameSpeakers: false } } })
let ollama = null
let cloud = null
try {
  await kit.api('/setup', { name: 'Tester' })
  // Nothing before you pick it.
  await sleep(500)
  let s = await kit.api('/llm')
  ok(s.offered && !s.have && !s.downloading && !s.loaded && !s.using && s.recommended?.id === 'gemma-4-e4b' && s.recommended.why === '16 GB of memory: Gemma 4 E4B' && s.model.id === 'gemma-4-e4b', 'a new 16 GB computer with a GPU: the local model is offered, Gemma 4 E4B recommended and why, nothing downloaded, nothing running', s)
  ok(s.models.map((m) => m.id).join() === 'gemma-4-e2b,gemma-4-e4b' && s.models[0].mb === 2841 && s.hidden.length === 1 && /Gemma 4 26B-A4B needs 32 GB of memory/.test(s.hidden[0].why), 'offered: Gemma 4 E2B (2.8 GB) and E4B; the 32 GB one hidden, with why', { models: s.models, hidden: s.hidden })
  ok(!(await builtinListed(kit)), 'and it isn\'t in the model lists until it\'s downloaded')
  const asNone = await notesBy(kit)
  ok(/No model/i.test(asNone.error || '') && asNone.model === null, 'with nothing else, notes aren\'t written by it before it\'s downloaded: no model, said', asNone)
  // Meeting notes set to stay here, with nothing here: why it didn't run, and no going elsewhere.
  await kit.api('/settings', { modelJobs: { notes: 'local' } }, 'PATCH')
  const kept = await notesBy(kit)
  ok(kept.error === 'Meeting notes is set to run on this computer, but Gemma 4 E4B isn\'t downloaded yet. Download it in Settings › Agents & Models › Model Providers, or set Meeting notes to Auto in Settings › Agents & Models › Which Model Does What.' && kept.model === null, 'Meeting notes set to On this computer, with no model here: the meeting says why they weren\'t written', kept)
  const jobsHere = await kit.api('/model-jobs')
  ok(jobsHere.jobs.length === (process.platform === 'darwin' ? 6 : 5) && jobsHere.jobs.find((j) => j.id === 'notes').set === 'local' && jobsHere.jobs.filter((j) => j.id !== 'notes').every((j) => j.set === 'cloud') && jobsHere.missing?.code === 'not_downloaded' && jobsHere.offered, 'Settings is told which jobs are set how (the rest Cloud first, the default), and what\'s missing here', jobsHere)
  await kit.api('/settings', { modelJobs: null }, 'PATCH')
  // (A meeting starting gets the speech model ready, from the same stand-in for Hugging Face: not this.)
  const ours = () => files.asked.filter((a) => a.id === 'gemma-4-e2b')
  ok(ours().length === 0 && !fs.existsSync(path.join(kit.data, 'models', 'llm')), 'nothing was downloaded: not at start, not when Settings looked, not when a model was picked for notes', files.asked)
  ok(launches(kit).length === 0, 'and llama-server never started (only its device list was asked for, to see it loads here)', llamaLog(kit))

  // The download: progress, cut short, picked up where it stopped. Gemma 4 E2B, picked rather than
  // the one recommended: then it's the one used.
  files.slow = 25
  files.cut = 1_000_000
  await kit.api('/llm/download', { model: 'gemma-4-e2b' })
  const cutShort = await until(async () => (await kit.api('/llm')).downloading?.error, 15000)
  ok(/cut short/.test(cutShort || ''), 'a download cut short says so', cutShort)
  ok((await kit.api('/settings')).user.llmModel === 'gemma-4-e2b' && (await kit.api('/llm')).model.id === 'gemma-4-e2b', 'a download you start for a model makes it your pick', (await kit.api('/settings')).user.llmModel)
  const partFile = path.join(kit.data, 'models', 'llm', 'gemma-4-e2b', `${gemma.files[0].name}.part`)
  ok(fs.existsSync(partFile) && fs.statSync(partFile).size === 1_000_000, 'and keeps what came', fs.existsSync(partFile) ? fs.statSync(partFile).size : null)
  const seen = new Set()
  await kit.api('/llm/download', {})
  const got = await until(async () => { const x = await kit.api('/llm'); if (x.downloading && !x.downloading.error) seen.add(x.downloading.percent); return x.have && x }, 30000, 150)
  ok(!!got && [...seen].some((p) => p > 33 && p < 100), 'Download again: it carries on, with its progress', [...seen])
  ok(ours().at(-1)?.range === 'bytes=1000000-', 'asking only for the rest', ours().map((a) => a.range))
  ok(fs.existsSync(path.join(kit.data, 'models', 'llm', 'gemma-4-e2b', gemma.files[0].name)) && !fs.existsSync(partFile), 'checked against its SHA-256, and only then given its name')
  files.slow = 0
  const listed = await builtinListed(kit)
  ok(listed?.via === 'local' && listed.provider === 'Bridge AI, on this computer' && listed.builtin, 'once it\'s here, it\'s in every model list, as on this computer', listed)
  ok(launches(kit).length === 0, 'and still not running: listing it starts nothing')

  // With nothing else, it writes the notes; edit by voice uses it with none picked.
  const only = await notesBy(kit)
  ok(only.model === 'bridge:gemma-4-e2b', 'with no other model, notes are written by it', only)
  const first = launches(kit)[0]
  ok(first?.host === '127.0.0.1' && first.port > 0 && first.modelThere, 'llama-server starts on first use, on 127.0.0.1, with the downloaded model', first)
  ok(first?.hasKey && !first.keyInArgs, 'with a key made up for it, handed over in its environment, not on its command line (where any program could read it)', first)
  ok(first?.ctx === 32768, 'reading 32K tokens at a time on a 16 GB computer', first?.ctx)
  ok(llamaLog(kit).filter((x) => x.chat).every((x) => x.chat_template_kwargs?.enable_thinking === false), 'thinking off for Bridge AI\'s own jobs', llamaLog(kit).filter((x) => x.chat).map((x) => x.chat_template_kwargs))
  let r = await consult(kit)
  ok(r.text === 'built-in answer' && /^Gemma 4 E2B \(Bridge AI, on this computer\)$/.test(r.route || ''), 'the Chief of Staff\'s "local": it, saying so', r)
  r = await edit(kit)
  ok(r.text === 'TEH PLAN IS FINE', 'edit by voice with no model picked: rewritten by it, on this computer', r)
  ok(new Set(launches(kit).map((x) => x.pid)).size === 1, 'kept loaded between requests: one llama-server', launches(kit).map((x) => x.pid))

  // Let go when idle; started again; started again after it stops; a request it stopped in, asked again.
  const pid1 = first?.pid
  ok(!!(await until(async () => !alive(pid1) && (await kit.api('/llm')).loaded === false, 8000, 250)), 'let go a while after its last answer: the process ends and its memory goes back')
  r = await consult(kit)
  const pid2 = launches(kit).at(-1)?.pid
  ok(r.text === 'built-in answer' && pid2 && pid2 !== pid1, 'asked again: started again', { r, pid2 })
  try { process.kill(pid2) } catch { /* gone */ }
  await until(() => !alive(pid2), 5000, 100)
  r = await consult(kit)
  const pid3 = launches(kit).at(-1)?.pid
  ok(r.text === 'built-in answer' && pid3 !== pid2, 'one that stopped is started again for the next request', { r, pid3 })
  r = await kit.api('/consult', { who: 'local', prompt: 'CRASH ONCE, then answer' }).catch((e) => ({ error: e.message }))
  const pid4 = launches(kit).at(-1)?.pid
  ok(r.text === 'built-in answer' && pid4 !== pid3, 'one that stops in the middle of a request is started again and asked again, once', { r, pid4 })

  // Your own models come first.
  ollama = await startLocalModel('builtin', 'ollama', [{ name: 'llama3.2:3b', context: 131072, loaded: null, params: '3.2B' }])
  await kit.api('/providers/ollama', { values: { OLLAMA_HOST: ollama.url } }, 'PUT')
  ok((await notesBy(kit)).model === 'ollama:llama3.2:3b', 'with your own Ollama too: notes by Ollama\'s model, before the built-in one')
  r = await consult(kit)
  ok(r.model === 'ollama:llama3.2:3b', 'and the Chief of Staff\'s "local" is yours', r)
  r = await edit(kit)
  ok(r.text === 'TEH PLAN IS FINE' && llamaLog(kit).filter((x) => x.chat).at(-1)?.user.includes('Instruction: make it louder'), 'edit by voice still uses the built-in one when none is picked (the text stays here, on the model meant for it)', r)
  cloud = await startModel('builtin')
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${cloud.url}/v1` } }, 'PUT')
  // Auto, with a key and the local model: a short meeting here, saying so; a long one on the key.
  await kit.api('/settings', { modelJobs: AUTO }, 'PATCH')
  const by = await notesBy(kit)
  ok(by.model === 'bridge:gemma-4-e2b' && /^Written on this computer by bridge:gemma-4-e2b: with Auto, a meeting this short stays here/.test(by.note || ''), 'with an API key too: a short meeting\'s notes by the local model (Auto), saying so under them', by)
  const longOne = await meeting(kit, 'A long one')
  // (About 18,000 tokens, all said into your microphone: an hour and a quarter.)
  fs.appendFileSync(path.join(kit.data, 'meetings', longOne, 'transcript.jsonl'), Array.from({ length: 600 }, (_, i) => JSON.stringify({ src: 'you', t0: 10 + i * 8, t1: 17 + i * 8, text: `Point ${i}: we went over the rollout plan, the budget for the quarter and who follows up with the customer.`, engine: 'test' })).join('\n') + '\n')
  await kit.api(`/meetings/${longOne}/summary`, {})
  const longBy = await until(async () => { const x = await kit.api(`/meetings/${longOne}`); return !x.summarizing && (x.summary || x.summaryError) && x }, 30000)
  ok(/^openai:/.test(longBy?.summaryModel || '') && !longBy.summaryNote, 'and a meeting longer than about 50 minutes by the key\'s model (Auto)', { model: longBy?.summaryModel, note: longBy?.summaryNote, error: longBy?.summaryError })
  // Auto put a short one here and the local model can't run it (out of memory): the key's model writes
  // it, and the note under it says why. Set to stay here, only another model here may (your Ollama).
  const failing = await meeting(kit, 'Out of memory here')
  fs.appendFileSync(path.join(kit.data, 'meetings', failing, 'transcript.jsonl'), `${JSON.stringify({ src: 'you', t0: 6, t1: 9, text: 'LOCAL FAILS on this one.', engine: 'test' })}\n`)
  await kit.api(`/meetings/${failing}/summary`, {})
  const fb = await until(async () => { const x = await kit.api(`/meetings/${failing}`); return !x.summarizing && (x.summary || x.summaryError) && x }, 30000)
  ok(/^openai:/.test(fb?.summaryModel || '') && /^bridge:gemma-4-e2b couldn't write it here \(Gemma 4 E2B: failed to allocate buffer: out of memory \(stand-in\)\), so openai:\S+ wrote it\.$/.test(fb.summaryNote || ''), 'Auto, and the local model can\'t run it here: the key\'s model writes it, and the note says why', { model: fb?.summaryModel, note: fb?.summaryNote, error: fb?.summaryError })
  await kit.api('/settings', { modelJobs: { notes: 'local' } }, 'PATCH')
  const toKey = cloud.asked(/LOCAL FAILS/).length
  await kit.api(`/meetings/${failing}/summary`, {})
  const keptFb = await until(async () => { const x = await kit.api(`/meetings/${failing}`); return !x.summarizing && x.summarizedAt !== fb.summarizedAt && x }, 30000)
  ok(keptFb?.summaryModel === 'ollama:llama3.2:3b' && /^bridge:gemma-4-e2b couldn't write it here \(.*out of memory \(stand-in\)\), so ollama:llama3\.2:3b wrote it\.$/.test(keptFb.summaryNote || '') && cloud.asked(/LOCAL FAILS/).length === toKey, 'set to On this computer: your Ollama, also here, writes it, saying why, and nothing goes to the key\'s model', { model: keptFb?.summaryModel, note: keptFb?.summaryNote })
  await kit.api('/settings', { modelJobs: AUTO }, 'PATCH')
  const jobsNow = await kit.api('/model-jobs')
  ok(jobsNow.local?.id === 'bridge:gemma-4-e2b' && /^openai:/.test(jobsNow.cloud?.id || '') && jobsNow.limit?.minutes === 50, 'Settings is told what Auto does here: the local model up to about 50 minutes, the key\'s model after', jobsNow)
  const listed2 = await kit.api('/chat/models')
  ok(/^openai:/.test(listed2.automatic || '') && listed2.short?.id === 'bridge:gemma-4-e2b' && listed2.short.minutes === 50, 'and Meetings & Voice: notes by the key\'s model, short ones by the local model', { automatic: listed2.automatic, short: listed2.short })
  await kit.api('/settings', { modelJobs: { notes: 'cloud' } }, 'PATCH')
  ok(/^openai:/.test((await notesBy(kit)).model || ''), 'Meeting notes set to Cloud first: a short one by the key\'s model, as before Auto')
  await kit.api('/settings', { modelJobs: { notes: 'local' } }, 'PATCH')
  const before0 = cloud.asked(/Point 1:/).length
  await kit.api(`/meetings/${longOne}/summary`, {})
  const keptLong = await until(async () => { const x = await kit.api(`/meetings/${longOne}`); return !x.summarizing && x.summarizedAt !== longBy.summarizedAt && x }, 30000)
  ok(keptLong?.summaryModel === 'bridge:gemma-4-e2b' && cloud.asked(/Point 1:/).length === before0, 'set to On this computer: the long one by the local model too, and nothing sent to the key\'s', { model: keptLong?.summaryModel, note: keptLong?.summaryNote })
  await kit.api('/settings', { modelJobs: null }, 'PATCH')
  await kit.api('/settings', { dictation: { editModel: 'openai:gpt-5' } }, 'PATCH')
  const before = cloud.asked(/Instruction: make it louder/).length
  r = await edit(kit)
  ok(cloud.asked(/Instruction: make it louder/).length === before + 1, 'edit by voice with a model picked: that one', r)
  await kit.api('/settings', { dictation: { editModel: null } }, 'PATCH')

  // Remove: stopped, the file gone, out of the lists.
  await consult(kit) // (the Chief of Staff's "local" is Ollama's now; the built-in one may be idle)
  await edit(kit)
  const running = launches(kit).at(-1)?.pid
  s = await kit.api('/llm', null, 'DELETE')
  ok(!s.have && !fs.existsSync(path.join(kit.data, 'models', 'llm', 'gemma-4-e2b')) && !alive(running), 'Remove: it stops, and the model is taken off this computer', { s, alive: alive(running) })
  ok(!(await builtinListed(kit)), 'and it\'s out of the model lists')
  r = await edit(kit)
  ok(/Pick the model/.test(r.error || ''), 'edit by voice with none picked then asks for a model', r)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  kit.stop()
  ollama?.stop()
  cloud?.stop()
}

// ---------- Claude first ----------
// A computer with Claude Code signed in (a stand-in that answers one-off questions), an API key, and
// the local model downloaded: Claude writes the notes.
const CLAUDE = `const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('2.1.312 (Claude Code)'); process.exit(0) }
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0) }
if (a.includes('-p')) { console.log('## Summary\\n- Notes by Claude.'); process.exit(0) }
`
const withClaude = await startKit('builtin-claude', {
  config: { meetings: { autoSummary: false, cleanup: false, nameSpeakers: false } },
  env: (dirs) => {
    fs.writeFileSync(path.join(dirs.bin, 'claude.cjs'), CLAUDE)
    if (process.platform === 'win32') fs.writeFileSync(path.join(dirs.bin, 'claude.cmd'), `@"${process.execPath}" "${path.join(dirs.bin, 'claude.cjs')}" %*\r\n`)
    else fs.writeFileSync(path.join(dirs.bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dirs.bin, 'claude.cjs')}" "$@"\n`, { mode: 0o755 })
    fs.mkdirSync(path.join(dirs.home, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(dirs.home, '.claude', '.credentials.json'), '{}')
    fs.mkdirSync(path.join(dirs.data, 'models', 'llm', 'gemma-4-e2b'), { recursive: true })
    fs.writeFileSync(path.join(dirs.data, 'models', 'llm', 'gemma-4-e2b', gemma.files[0].name), MODEL)
    return kitEnv()(dirs)
  },
})
const cloud2 = await startModel('builtin-claude')
try {
  await withClaude.api('/setup', { name: 'Tester' })
  await withClaude.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${cloud2.url}/v1` } }, 'PUT')
  const list = (await withClaude.api('/chat/models?refresh=1')).models.map((m) => m.id)
  ok(list.includes('cli:claude') && list.includes('bridge:gemma-4-e2b') && list.some((m) => m.startsWith('openai:')), '(Claude Code, a key and the local model are all there)', list)
  // Gemma 4 E2B, downloaded before E4B was recommended for 16 GB: still the one used, nothing else fetched.
  const st = await withClaude.api('/llm')
  ok(st.using?.id === 'gemma-4-e2b' && st.recommended?.id === 'gemma-4-e4b' && !st.have && !files.asked.some((a) => a.id === 'gemma-4-e4b'), 'a model downloaded before stays in use until the one recommended is downloaded too; nothing downloads by itself', { using: st.using, recommended: st.recommended })
  await withClaude.api('/settings', { modelJobs: { notes: 'cloud' } }, 'PATCH')
  const by = await notesBy(withClaude)
  ok(by.model === 'cli:claude' && launches(withClaude).length === 0, 'with Claude Code signed in and Meeting notes on Cloud first: Claude writes the notes, first of all, and the local model isn\'t started', by)
  await withClaude.api('/settings', { modelJobs: null }, 'PATCH')
  ok((await notesBy(withClaude)).model === 'cli:claude', 'by default (Cloud first): Claude writes them, as before')
  await withClaude.api('/settings', { modelJobs: AUTO }, 'PATCH')
  const auto = await notesBy(withClaude)
  ok(auto.model === 'bridge:gemma-4-e2b' && launches(withClaude).length === 1, 'on Auto: a short meeting by the local model, on this computer', auto)
  // Diagrams stay with Claude on Auto, however short.
  ok((await withClaude.api('/boards/models')).pick === 'cli:claude', 'Diagrams on Auto: Claude')
} finally { withClaude.stop(); cloud2.stop() }

// ---------- A download that doesn't match, and too little room ----------
const bad = await startKit('builtin-checksum', { env: kitEnv({ models: catalog('0'.repeat(64)) }) })
try {
  await bad.api('/llm/download', { model: 'gemma-4-e2b' })
  const e = await until(async () => (await bad.api('/llm')).downloading?.error, 15000)
  const dir = path.join(bad.data, 'models', 'llm', 'gemma-4-e2b')
  ok(/didn't match its checksum, so it was thrown away/.test(e || '') && !(fs.existsSync(dir) && fs.readdirSync(dir).length), 'a download that doesn\'t match its SHA-256 is thrown away, saying so', { e, left: fs.existsSync(dir) ? fs.readdirSync(dir) : [] })
  ok(!(await builtinListed(bad)), 'and isn\'t offered')
} finally { bad.stop() }
const tight = await startKit('builtin-tight', { env: kitEnv({ machine: { freeMB: 5 } }) })
try {
  // (Download with none named: the one recommended here, Gemma 4 E4B.)
  const n = files.asked.length
  await tight.api('/llm/download', {})
  const e = await until(async () => (await tight.api('/llm')).downloading?.error, 10000)
  ok(/Not enough free space: Gemma 4 E4B needs 4791 MB, and there's 5 MB free/.test(e || '') && files.asked.length === n, 'too little free space: said before anything downloads (the one recommended, as none was named)', e)
} finally { tight.stop() }

// ---------- Settings › Agents & Models: Model Providers, and Which Model Does What ----------
const ui = await startKit('builtin-ui', { env: kitEnv() })
const small = await startKit('builtin-ui-small', { env: kitEnv({ machine: { memGB: 4 } }) })
const { b, which } = await browser()
const openProviders = async (p) => {
  await p.waitForSelector('.rail-nav-btn, body', { timeout: 30000 }).catch(() => {})
  await until(async () => {
    if (!(await p.locator('.modal.settings').count())) await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } })))
    return (await p.locator('.pv-card').count()) > 0
  }, 45000, 1500)
}
// Agents & Models' tabs: Model Providers (providers) or Which Model Does What (models).
const tab = async (p, id) => {
  await p.locator(`.modal.settings .st-tabs [data-tab="${id}"]`).click()
  await p.locator(id === 'models' ? '[data-model-jobs]' : '.pv-card').first().waitFor({ timeout: 10000 }).catch(() => {})
}
try {
  await ui.api('/setup', { name: 'Tester' })
  await small.api('/setup', { name: 'Tester' })
  const { ctx, p, errors } = await page(b, ui.url)
  await openProviders(p)
  const row = p.locator('[data-builtin-model]')
  await row.waitFor({ timeout: 15000 })
  let text = await row.innerText()
  const small2 = row.locator('[data-llm="gemma-4-e2b"]')
  ok(/Local model on this computer/.test(text) && /Recommended here: Gemma 4 E4B \(16 GB of memory\)/.test(text) && /Gemma 4 E2B\s+By Google, 2\.8 GB, Apache-2\.0/.test(await small2.innerText()) && /By Google, 4\.6 GB, Apache-2\.0/.test(await row.locator('[data-llm="gemma-4-e4b"]').innerText()) && !/26B/.test(text) && /Download \(2\.8 GB\)/.test(await small2.innerText()), 'Settings › Model Providers: "Local model on this computer", the one recommended here and why, each model this computer can run with its size, licence and Download (not the 32 GB one)', text)
  ok(/Recommended/.test(await row.locator('[data-llm="gemma-4-e4b"]').innerText()), 'the recommended one marked')
  // What it's good for, the rest of its line (on hover, or under More); that it downloads only when
  // asked, and stays private, in the line.
  const more = async () => {
    const t0 = await row.locator('p[title]').first().getAttribute('title', { timeout: 1000 }).catch(() => null)
    if (t0) return t0
    const btn = row.locator('.st-more[aria-expanded="false"]').first()
    if (await btn.count()) await btn.click()
    return row.locator('.st-more-text').first().innerText({ timeout: 2000 }).catch(() => '')
  }
  ok(/rewriting text, Edit by voice, questions about a meeting/.test(await more()) && /only when you click Download/.test(text) && /never leaves this computer/.test(text), 'with what it\'s good for, and that it downloads only when asked', [text, await more()])
  await row.scrollIntoViewIfNeeded()
  await shot(p, `${which}-builtin-1-offered`)
  // Which jobs run here, the next tab: each kind, Auto, and what Auto does with no model here yet.
  await tab(p, 'models')
  const jobsBox = p.locator('[data-model-jobs]')
  await jobsBox.waitFor({ timeout: 10000 })
  ok((await jobsBox.locator('li[data-job]').count()) === (IS_MAC ? 6 : 5) && (await jobsBox.locator('li[data-job] select').evaluateAll((s) => s.every((x) => x.value === 'cloud'))) && /Meeting notes/.test(await jobsBox.innerText()) && /Diagrams/.test(await jobsBox.innerText()), 'Models for Each Task: each kind (Mail where there\'s Mail, a Mac), each on Cloud first to start', await jobsBox.innerText())
  ok((await jobsBox.locator('li[data-job="live"] option[value="local"]').count()) === 1, 'On this computer offered for live suggestions here (it has a GPU)')
  await tab(p, 'providers')
  await row.waitFor({ timeout: 10000 })
  files.slow = 40
  await small2.getByRole('button', { name: /Download/ }).click()
  ok(!!(await until(async () => /Downloading \d+%/.test(await small2.innerText()) && (await small2.locator('[role=progressbar]').count()) === 1, 10000, 100)), 'Download: its progress shows', await row.innerText())
  ok(!!(await until(async () => /In use/.test(await small2.innerText()), 20000, 200)), 'then In use (the one downloaded is the one used)', await row.innerText())
  files.slow = 0
  text = await row.innerText()
  ok(/Remove/.test(await small2.innerText()) && /Gemma 4 E2B is in use, in every model list/.test(text) && /With Auto, Bridge AI runs short jobs on it/.test(await more()), 'with Remove, and how it\'s used: in every list, short jobs on Auto', [text, await more()])
  await row.scrollIntoViewIfNeeded()
  await shot(p, `${which}-builtin-2-ready`)
  await tab(p, 'models')
  await jobsBox.locator('li[data-job="notes"] select').selectOption('auto')
  ok(!!(await until(async () => /Gemma 4 E2B, on this computer: there's no other model/.test(await jobsBox.locator('li[data-job="notes"]').innerText()), 10000, 200)), 'Which jobs run here says what Auto does now: with no other model, everything here', await jobsBox.innerText())
  await jobsBox.locator('li[data-job="notes"] select').selectOption('local')
  ok(!!(await until(async () => (await ui.api('/settings')).user.modelJobs?.notes === 'local' && /Always on this computer, with Gemma 4 E2B/.test(await jobsBox.locator('li[data-job="notes"]').innerText()), 10000, 200)), 'Meeting notes set to On this computer, there and in the settings', (await ui.api('/settings')).user.modelJobs)
  await jobsBox.scrollIntoViewIfNeeded()
  await shot(p, `${which}-builtin-3-jobs`)
  await tab(p, 'providers')
  await small2.getByRole('button', { name: /Remove/ }).click()
  ok(!!(await until(async () => /Download \(2\.8 GB\)/.test(await small2.innerText()), 10000, 200)), 'Remove: back to Download')
  await tab(p, 'models')
  ok(!!(await until(async () => /Set to stay here, but Gemma 4 E4B isn't downloaded yet/.test(await jobsBox.locator('li[data-job="notes"]').innerText()), 10000, 200)), 'and a job set to stay here says why it can\'t run now', await jobsBox.locator('li[data-job="notes"]').innerText())
  await ui.api('/settings', { modelJobs: null }, 'PATCH')
  ok(!errors.length, 'no page errors', errors)
  await ctx.close()
  const s2 = await page(b, small.url)
  await openProviders(s2.p)
  await s2.p.locator('.pv-group', { hasText: /run locally/i }).first().waitFor({ timeout: 10000 }).catch(() => {})
  await sleep(800)
  const noRow = (await s2.p.locator('[data-builtin-model]').count()) === 0
  await tab(s2.p, 'models')
  await s2.p.locator('[data-model-jobs] li[data-job]').first().waitFor({ timeout: 10000 }).catch(() => {})
  await sleep(800)
  ok(noRow && (await s2.p.locator('[data-model-jobs] li[data-job]').count()) === (IS_MAC ? 6 : 5) && (await s2.p.locator('[data-model-jobs] select').count()) === 0, 'a computer with 4 GB of memory: no row for it at all, and the tasks with no On this computer to put them on')
  await s2.ctx.close()
} finally {
  await b.close()
  ui.stop()
  small.stop()
}

// ---------- The real thing, once, by hand ----------
if (process.env.BRIDGE_REAL_LLAMA === '1') {
  const key = process.platform === 'win32' ? 'win32-x64' : `${process.platform}-${process.arch}`
  const bin = path.join(ROOT, 'native', 'llama', key, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')
  if (!fs.existsSync(bin)) skip('the real local model', 'run node scripts/llama.js native/llama first, for this computer\'s llama-server')
  else {
    const store = path.join(OUT, 'real-models', 'llm')
    fs.mkdirSync(store, { recursive: true })
    const real = await startKit('builtin-real', { env: ({ data }) => { fs.mkdirSync(path.join(data, 'models'), { recursive: true }); fs.symlinkSync(store, path.join(data, 'models', 'llm'), 'junction'); return { BRIDGE_MODELS_URL: '' } } })
    try {
      const t0 = Date.now()
      await real.api('/llm/download', {})
      const got = await until(async () => { const x = await real.api('/llm'); if (x.downloading?.error) throw new Error(x.downloading.error); return x.have && x }, 60 * 60_000, 2000)
      console.log(`REAL Gemma 4 E2B: downloaded and checked in ${Math.round((Date.now() - t0) / 1000)} s (or already here); GPU: ${got?.gpu || 'none'}`)
      ok(!!got, 'the real Gemma 4 E2B downloads from Hugging Face and matches its SHA-256')
      const t1 = Date.now()
      const r = await real.api('/dictation/edit', { text: 'hey, cant make it tmrw, sorry', instruction: 'make it formal' })
      const first = (Date.now() - t1) / 1000
      const t2 = Date.now()
      const r2 = await real.api('/consult', { who: 'local', prompt: 'Answer with one word: what colour is the sky on a clear day?' })
      console.log(`REAL edit by voice: "${r.text}" in ${first.toFixed(1)} s with loading; a question: "${r2.text}" in ${((Date.now() - t2) / 1000).toFixed(1)} s loaded`)
      ok(r.text && !/cant|tmrw/.test(r.text) && /blue/i.test(r2.text), 'the real model rewrites a sentence and answers a question, on this computer', { r, r2 })
    } finally { real.stop() }
  }
} else skip('the real local model', 'set BRIDGE_REAL_LLAMA=1 to download it and try it once')

srv.close()
process.exit(done().fail ? 1 : 0)
