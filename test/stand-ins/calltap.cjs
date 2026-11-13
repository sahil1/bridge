// Stand-in for native/calltap (the call's sound on a Mac), so no test ever asks macOS for it:
// 16-bit mono PCM on stdout at --rate, a tenth of a second at a time, until it's stopped. How loud,
// from calltap.json beside it ({ "level": n }, read each time): 0 is silence (what macOS gives
// before you allow System Audio Recording), a few steps is the near-silence one Mac gave for a
// whole call, a few thousand is a call talking. What macOS says ({ "access": "allowed" | "denied" |
// "unknown" }, none: an older calltap that doesn't say): on stderr as it starts, and alone on stdout
// for --check, as native/calltap.swift does. Each start is a line in calltap.log beside it. Started
// while macOS says no, it stays as loud as it started (as a real tap does, allowed or not since):
// only a new start hears the call.
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const rate = Number(args[args.indexOf('--rate') + 1]) || 16000
const ctl = path.join(__dirname, 'calltap.json')
const read = () => { try { return JSON.parse(fs.readFileSync(ctl, 'utf8')) || {} } catch { return {} } }
const level = () => Number(read().level) || 0
const access = read().access
if (args.includes('--check')) { process.stdout.write(`${access || 'unknown'}\n`); process.exit(0) }
fs.appendFileSync(path.join(__dirname, 'calltap.log'), `start ${access || ''}\n`)
if (access) process.stderr.write(`access ${access}\n`)
const denied = access === 'denied' ? level() : null
let t = 0
const tick = () => {
  const n = Math.round(rate / 10)
  const b = Buffer.alloc(n * 2)
  const v = denied ?? level()
  if (v) for (let i = 0; i < n; i++, t++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * t) / rate) * v), i * 2)
  if (!process.stdout.write(b)) process.stdout.once('drain', () => {})
}
process.stdout.on('error', () => process.exit(0))
setInterval(tick, 100)
