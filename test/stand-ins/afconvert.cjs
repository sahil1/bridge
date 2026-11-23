// A stand-in for the programs that read a sound or video file for Bridge AI (server/audiofile.js):
// macOS's afconvert (afconvert -f WAVE -d LEI16@16000 -c 1 <in> <out>) and ffmpeg (ffmpeg … -i <in>
// … <out>), named by BRIDGE_AFCONVERT or BRIDGE_FFMPEG in the tests, so no test needs either.
// It reads a made-up kind of file: an MP4's first bytes, then JSON of the tones in it, as
// { tones: [[hz, seconds], …] } (hz 0: quiet), and writes them as a 16 kHz mono WAV. Anything else
// fails as afconvert does ("Couldn't open input file"). Each run is a line of JSON in
// BRIDGE_AFCONVERT_LOG: { args }.
const fs = require('node:fs')

const args = process.argv.slice(2)
if (process.env.BRIDGE_AFCONVERT_LOG) fs.appendFileSync(process.env.BRIDGE_AFCONVERT_LOG, `${JSON.stringify({ args })}\n`)
const ff = args.includes('-i')
const src = ff ? args[args.indexOf('-i') + 1] : args[args.length - 2]
const out = args[args.length - 1]
let tones = null
try {
  const b = fs.readFileSync(src)
  if (b.toString('latin1', 4, 8) === 'ftyp') tones = JSON.parse(b.toString('utf8', b.indexOf('{'))).tones
} catch { /* not ours */ }
if (!Array.isArray(tones)) {
  process.stderr.write(ff ? `${src}: Invalid data found when processing input\n` : "Error: Couldn't open input file ('dta?')\n")
  process.exit(1)
}
const RATE = 16000
const n = tones.reduce((s, [, secs]) => s + Math.round(secs * RATE), 0)
const wav = Buffer.alloc(44 + n * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40)
let at = 0
for (const [hz, secs] of tones) {
  const k = Math.round(secs * RATE)
  for (let i = 0; i < k; i++) wav.writeInt16LE(hz ? Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * 8000) : 0, 44 + (at + i) * 2)
  at += k
}
fs.writeFileSync(out, wav)
