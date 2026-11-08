// The local model built into Bridge AI (server/llm.js): Gemma 4 E2B on llama.cpp's llama-server,
// with a stand-in llama-server (stand-ins/llama-server.mjs) and a small fake model served from this
// computer, so nothing real is downloaded or run.
//   Where it's offered, by the rules for every kind of computer (memory, the build for its platform
//   and chip, macOS and glibc versions, the Docker image, a build that won't load), then by servers
//   standing in for some of them: hidden, with why, where it can't run.
//   Nothing downloads or starts before you pick it: not at start, not when Settings looks, not when
//   a model is chosen for a job. The download: its progress, picked up where it stopped, checked
//   against its SHA-256 (one that doesn't match is thrown away), and too little room said first.
//   Which model Bridge AI uses: Claude first, then a key, then your own Ollama, and the built-in
//   model only once it's downloaded, by itself only for edit by voice or when there's nothing else.
//   llama-server: started on first use, on 127.0.0.1 with a key in its environment (not on its
//   command line), thinking off, kept a while and let go when idle, started again when it stops,
//   and a request it stopped in the middle of asked again. Remove stops it and takes the file away.
//   Settings › Model Providers: the row with its size and what it's good for, Download with progress,
//   Ready and Remove; no row on a computer with 4 GB of memory.
// BRIDGE_REAL_LLAMA=1: also the real thing, once, by hand: this computer's llama-server (node
// scripts/llama.js native/llama puts it there) and the real Gemma 4 E2B (downloaded from Hugging Face
// into test/.out/real-models, kept for next time), asked to rewrite a sentence and for JSON.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { startKit, startModel, startLocalModel, checks, until, sleep, OUT, TEST, ROOT, freePort, browser, page, shot } from '../lib/harness.mjs'

const { ok, skip, done } = checks('builtin-model')
const STAND_IN = path.join(TEST, 'stand-ins', 'llama-server.mjs')

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
  ok(s.offered && !s.have && !s.downloading && !s.loaded && s.model.mb === 2841 && s.model.label === 'Gemma 4 E2B', 'a new computer: the local model is offered (2.8 GB), not downloaded, not running', s)
  ok(!(await builtinListed(kit)), 'and it isn\'t in the model lists until it\'s downloaded')
  const asNone = await notesBy(kit)
  ok(/No model/i.test(asNone.error || '') && asNone.model === null, 'with nothing else, notes aren\'t written by it before it\'s downloaded: no model, said', asNone)
  // (A meeting starting gets the speech model ready, from the same stand-in for Hugging Face: not this.)
  const ours = () => files.asked.filter((a) => a.id === 'gemma-4-e2b')
  ok(ours().length === 0 && !fs.existsSync(path.join(kit.data, 'models', 'llm')), 'nothing was downloaded: not at start, not when Settings looked, not when a model was picked for notes', files.asked)
  ok(launches(kit).length === 0, 'and llama-server never started (only its device list was asked for, to see it loads here)', llamaLog(kit))

  // The download: progress, cut short, picked up where it stopped.
  files.slow = 25
  files.cut = 1_000_000
  await kit.api('/llm/download', {})
  const cutShort = await until(async () => (await kit.api('/llm')).downloading?.error, 15000)
  ok(/cut short/.test(cutShort || ''), 'a download cut short says so', cutShort)
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
  const by = await notesBy(kit)
  ok(/^openai:/.test(by.model || ''), 'with an API key: notes by it', by)
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
  const by = await notesBy(withClaude)
  ok(by.model === 'cli:claude' && launches(withClaude).length === 0, 'with Claude Code signed in: Claude writes the notes, first of all, and the local model isn\'t started', by)
} finally { withClaude.stop(); cloud2.stop() }

// ---------- A download that doesn't match, and too little room ----------
const bad = await startKit('builtin-checksum', { env: kitEnv({ models: catalog('0'.repeat(64)) }) })
try {
  await bad.api('/llm/download', {})
  const e = await until(async () => (await bad.api('/llm')).downloading?.error, 15000)
  const dir = path.join(bad.data, 'models', 'llm', 'gemma-4-e2b')
  ok(/didn't match its checksum, so it was thrown away/.test(e || '') && !(fs.existsSync(dir) && fs.readdirSync(dir).length), 'a download that doesn\'t match its SHA-256 is thrown away, saying so', { e, left: fs.existsSync(dir) ? fs.readdirSync(dir) : [] })
  ok(!(await builtinListed(bad)), 'and isn\'t offered')
} finally { bad.stop() }
const tight = await startKit('builtin-tight', { env: kitEnv({ machine: { freeMB: 5 } }) })
try {
  const n = files.asked.filter((a) => a.id === 'gemma-4-e2b').length
  await tight.api('/llm/download', {})
  const e = await until(async () => (await tight.api('/llm')).downloading?.error, 10000)
  ok(/Not enough free space: Gemma 4 E2B needs \d+ MB, and there's 5 MB free/.test(e || '') && files.asked.filter((a) => a.id === 'gemma-4-e2b').length === n, 'too little free space: said before anything downloads', e)
} finally { tight.stop() }

// ---------- Settings › Model Providers ----------
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
try {
  await ui.api('/setup', { name: 'Tester' })
  await small.api('/setup', { name: 'Tester' })
  const { ctx, p, errors } = await page(b, ui.url)
  await openProviders(p)
  const row = p.locator('[data-builtin-model]')
  await row.waitFor({ timeout: 15000 })
  let text = await row.innerText()
  ok(/Local model on this computer/.test(text) && /Gemma 4 E2B by Google, 2\.8 GB, Apache-2\.0/.test(text) && /Download \(2\.8 GB\)/.test(text), 'Settings › Model Providers: "Local model on this computer", Gemma 4 E2B, its size and licence, and Download', text)
  ok(/rewriting text, Edit by voice, questions about a meeting/.test(text) && /only when you click Download/.test(text), 'with what it\'s good for, and that it downloads only when asked', text)
  await row.scrollIntoViewIfNeeded()
  await shot(p, `${which}-builtin-1-offered`)
  files.slow = 40
  await row.getByRole('button', { name: /Download/ }).click()
  ok(!!(await until(async () => /Downloading \d+%/.test(await row.innerText()) && (await row.locator('[role=progressbar]').count()) === 1, 10000, 100)), 'Download: its progress shows', await row.innerText())
  ok(!!(await until(async () => /Ready/.test(await row.innerText()), 20000, 200)), 'then Ready', await row.innerText())
  files.slow = 0
  text = await row.innerText()
  ok(/Remove/.test(text) && /In every model list/.test(text) && /Claude and your other models come first/.test(text), 'with Remove, and how it\'s used: in every list, Claude and your other models first', text)
  await row.scrollIntoViewIfNeeded()
  await shot(p, `${which}-builtin-2-ready`)
  await row.getByRole('button', { name: /Remove/ }).click()
  ok(!!(await until(async () => /Download \(2\.8 GB\)/.test(await row.innerText()), 10000, 200)), 'Remove: back to Download')
  ok(!errors.length, 'no page errors', errors)
  await ctx.close()
  const s2 = await page(b, small.url)
  await openProviders(s2.p)
  await s2.p.locator('.pv-group', { hasText: /run locally/i }).first().waitFor({ timeout: 10000 }).catch(() => {})
  await sleep(800)
  ok((await s2.p.locator('[data-builtin-model]').count()) === 0, 'a computer with 4 GB of memory: no row for it at all')
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
