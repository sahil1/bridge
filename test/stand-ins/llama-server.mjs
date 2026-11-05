// A stand-in for llama.cpp's llama-server, for the tests (server/llm.js runs it in its place, with
// BRIDGE_LLAMA_SERVER). It takes llama-server's arguments and answers as it does where Bridge AI
// depends on it, and notes each start and request in BRIDGE_LLAMA_LOG as a line of JSON.
//   --list-devices   its devices (a Metal GPU), or with BRIDGE_LLAMA_FAIL=load, fails as a build
//                    whose libraries don't load would; with BRIDGE_LLAMA_FAIL=slow-once, the first
//                    takes 30 s (a file beside the log remembers), as a slow Mac compiling
//                    llama.cpp's GPU shaders the first time can
//   -m <file> --host <h> --port <p> -c <n> ...   serves, with the key from LLAMA_API_KEY (as the
//                    real one reads it): /health (loading for a moment, then ok), /props, and
//                    /v1/chat/completions, which turns away a request without the key (401). A
//                    model file that isn't there stops it, as the real one does.
// Answers: edit by voice (the text in capitals), meeting notes, who said what (JSON when held to a
// schema), dictation to tidy (tidied as a model that keeps to its instructions would: "you know" and
// "I mean" out, a phrase said twice kept once, a capital and a full stop; "take your time" in it
// answers after 8 s, "fail on purpose" with an error), anything else "built-in answer". A prompt
// with "CRASH ONCE" stops the process mid-request the first time (a file beside the log
// remembers), as a crash would.
import http from 'node:http'
import fs from 'node:fs'

const args = process.argv.slice(2)
const LOG = process.env.BRIDGE_LLAMA_LOG
const log = (o) => { if (LOG) fs.appendFileSync(LOG, `${JSON.stringify({ pid: process.pid, ...o })}\n`) }
const opt = (...names) => { const i = args.findIndex((a) => names.includes(a)); return i >= 0 ? args[i + 1] : null }

if (args.includes('--version')) { console.log('version: 0.8.0 (build 11960, stand-in)'); process.exit(0) }
if (args.includes('--list-devices')) {
  log({ probe: true })
  if (process.env.BRIDGE_LLAMA_FAIL === 'load') { console.error('dyld: Library not loaded: @rpath/libggml-metal.0.dylib (stand-in)'); process.exit(1) }
  if (process.env.BRIDGE_LLAMA_FAIL === 'slow-once' && LOG && !fs.existsSync(`${LOG}.slow`)) { fs.writeFileSync(`${LOG}.slow`, ''); await new Promise((r) => setTimeout(r, 30000)) }
  console.log('Available devices:\n  MTL0: Apple M4 (16384 MiB, 16000 MiB free)\n  BLAS: Accelerate (0 MiB, 0 MiB free)')
  process.exit(0)
}

const key = process.env.LLAMA_API_KEY || ''
const file = opt('-m', '--model')
const port = Number(opt('--port'))
const host = opt('--host')
const ctx = Number(opt('-c', '--ctx-size')) || 0
log({ launch: true, args, host, port, ctx, model: file, hasKey: key.length >= 32, keyInArgs: !!key && args.some((a) => a.includes(key)), modelThere: !!file && fs.existsSync(file) })
if (!file || !fs.existsSync(file)) { console.error(`llama_model_load: error loading model: failed to open ${file}`); process.exit(1) }

const started = Date.now()
const crashMark = `${LOG || 'llama'}.crashed`
function answer(text, json) {
  const edit = /^Instruction: [\s\S]*?\n\nText:\n([\s\S]*)$/.exec(text)
  if (edit) return edit[1].toUpperCase()
  if (/Write meeting notes in Markdown/.test(text)) return '## Summary\n- Notes by the local model.'
  if (/Say who said each numbered Them line/.test(text)) {
    const out = {}
    for (const [, n, t] of text.matchAll(/^(\d+)\. \[[^\]]+\] Them: (.*)$/gm)) out[n] = /budget/i.test(t) ? 'Priya Shah' : null
    return json ? JSON.stringify(out) : 'The budget line is Priya\'s, I think.'
  }
  const said = dictated(text)
  if (said != null) return tidied(said)
  return 'built-in answer'
}
const dictated = (text) => /^<dictation>\n([\s\S]*)\n<\/dictation>$/.exec(text)?.[1] ?? null
function tidied(s) {
  const x = s.replace(/,?\s*\b(?:you know|I mean)\b,?/gi, '').replace(/\b(\w+(?:\s+\w+){1,2})\s+\1\b/gi, '$1').replace(/\s{2,}/g, ' ').trim()
  const y = x.charAt(0).toUpperCase() + x.slice(1)
  return /[.!?]$/.test(y) ? y : `${y}.`
}
http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.url === '/health') return Date.now() - started < 400 ? j(503, { error: { code: 503, message: 'Loading model' } }) : j(200, { status: 'ok' })
    if (req.headers.authorization !== `Bearer ${key}` || !key) return j(401, { error: { code: 401, message: 'Invalid API Key', type: 'authentication_error' } })
    if (req.url === '/props') return j(200, { default_generation_settings: { n_ctx: ctx }, build_info: 'b11960-stand-in' })
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let b = {}
      try { b = JSON.parse(Buffer.concat(chunks).toString()) } catch { /* not JSON */ }
      const user = [...(b.messages || [])].reverse().find((m) => m.role === 'user')?.content || ''
      const system = dictated(user) != null ? (b.messages || []).find((m) => m.role === 'system')?.content || '' : undefined
      log({ chat: true, user, system, chat_template_kwargs: b.chat_template_kwargs ?? null, response_format: b.response_format ?? null })
      if (/CRASH ONCE/.test(user) && !fs.existsSync(crashMark)) { fs.writeFileSync(crashMark, '1'); process.exit(1) }
      if (/fail on purpose/i.test(dictated(user) || '')) return j(500, { error: { code: 500, message: 'Context shift is disabled (stand-in)', type: 'server_error' } })
      const content = answer(user, b.response_format?.type === 'json_schema')
      const reply = () => j(200, { choices: [{ message: { role: 'assistant', content } }], timings: { prompt_n: 300, prompt_per_second: 500, predicted_n: 80, predicted_per_second: 48 } })
      return /take your time/i.test(dictated(user) || '') ? setTimeout(reply, 8000) : reply()
    }
    j(404, { error: { code: 404, message: 'File Not Found' } })
  })
}).listen(port, host || '127.0.0.1')
