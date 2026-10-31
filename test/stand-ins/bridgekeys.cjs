// Stand-in for native/bridgekeys (the dictation key and pasting on a Mac), so the desktop app's side
// (desktop/dictation.js) can be checked on any computer without a key pressed, a key sent or the
// clipboard touched:
//   hotkey <code> <mods>   the key set at once; with $BRIDGEKEYS_PRESS, pressed in TextEdit (pid 4242)
//                          a moment later and let go after; "press" and "release" on stdin too
//   paste [--pid <pid>]    what it was given (its arguments and the text on stdin) noted in
//                          $BRIDGEKEYS_LOG, nothing pressed; it answers with $BRIDGEKEYS_PASTE, or
//                          as a paste the app in front read
const fs = require('node:fs')
const [cmd, ...rest] = process.argv.slice(2)
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const down = () => say({ down: Date.now(), app: 'TextEdit', bundle: 'com.apple.TextEdit', pid: 4242, secure: false })
const up = () => say({ up: Date.now() })
if (cmd === 'hotkey') {
  say({ ready: true })
  if (process.env.BRIDGEKEYS_PRESS) { setTimeout(down, 150); setTimeout(up, 700) }
  let buf = ''
  process.stdin.on('data', (d) => {
    buf += d
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line === 'press') down()
      else if (line === 'release') up()
    }
  })
  process.stdin.on('end', () => process.exit(0))
} else if (cmd === 'paste') {
  let text = ''
  process.stdin.on('data', (d) => { text += d })
  process.stdin.on('end', () => {
    if (process.env.BRIDGEKEYS_LOG) fs.appendFileSync(process.env.BRIDGEKEYS_LOG, `${JSON.stringify({ args: rest, text })}\n`)
    process.stdout.write(`${process.env.BRIDGEKEYS_PASTE || JSON.stringify({ pasted: true, read: true, restored: true })}\n`)
  })
} else process.exit(2)
