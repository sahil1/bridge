// Stand-in for native/calltap (the call's sound on a Mac), so no test ever asks macOS for it:
// 16-bit mono PCM on stdout at --rate, a tenth of a second at a time, until it's stopped. How loud,
// from calltap.json beside it ({ "level": n }, read each time): 0 is silence (what macOS gives
// before you allow System Audio Recording), a few steps is the near-silence one Mac gave for a
// whole call, a few thousand is a call talking.
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const rate = Number(args[args.indexOf('--rate') + 1]) || 16000
const ctl = path.join(__dirname, 'calltap.json')
const level = () => { try { return Number(JSON.parse(fs.readFileSync(ctl, 'utf8')).level) || 0 } catch { return 0 } }
let t = 0
const tick = () => {
  const n = Math.round(rate / 10)
  const b = Buffer.alloc(n * 2)
  const v = level()
  if (v) for (let i = 0; i < n; i++, t++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * t) / rate) * v), i * 2)
  if (!process.stdout.write(b)) process.stdout.once('drain', () => {})
}
process.stdout.on('error', () => process.exit(0))
setInterval(tick, 100)
