// A stand-in for whisper.cpp's whisper-cli (server/speech.js, where sherpa-onnx can't run and
// whisper.cpp is installed), so no test needs whisper.cpp: whisper-cli -m <model> -f <wav> -nt -np
// -l <language> -t <threads> [--prompt <hint>]. It checks the model's file is there, as the real one
// does, and writes BRIDGE_WHISPER_SAYS (or "Heard by whisper.cpp."). Each run is a line of JSON in
// BRIDGE_WHISPER_LOG: { model, language, seconds }.
const fs = require('node:fs')
const path = require('node:path')

const a = process.argv.slice(2)
const arg = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null)
const model = arg('-m')
const wav = arg('-f')
if (!model || !fs.existsSync(model)) { process.stderr.write(`error: failed to open '${model}'\n`); process.exit(1) }
const bytes = (() => { try { return fs.statSync(wav).size } catch { return 0 } })()
if (process.env.BRIDGE_WHISPER_LOG) fs.appendFileSync(process.env.BRIDGE_WHISPER_LOG, `${JSON.stringify({ model: path.basename(model), language: arg('-l'), seconds: Math.round(((bytes - 44) / 32000) * 100) / 100 })}\n`)
process.stdout.write(`${process.env.BRIDGE_WHISPER_SAYS || 'Heard by whisper.cpp.'}\n`)
