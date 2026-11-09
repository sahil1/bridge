// Whether the floating card is kept out of pictures of the screen (desktop/main.js, Settings ›
// Meetings › Hide it from screen sharing): a screen you share on a call, a recording of it, the
// meeting's own (Watch a screen). The setting (hide):
//   'sharing'  the first choice: only while something shares or records the screen, so your
//              screenshots show it. On a Mac, native/callwatch sharing says when, from the moment
//              the card shows; until it has said, when it can't (no helper, a macOS that doesn't
//              say, the helper gone), and anywhere else, as 'always'.
//   'always'   never in a share, a recording or a screenshot.
//   'never'    in every picture.
// make({ bin, mac, spawn, onChange }): bin, the helper (null: none); onChange(), when hidden()
// may have changed.
const { spawn: spawnReal } = require('node:child_process')

const MODES = ['sharing', 'always', 'never']
const modeOf = (v) => (MODES.includes(v) ? v : 'sharing')

function make({ bin = null, mac = process.platform === 'darwin', spawn = spawnReal, onChange = () => {} } = {}) {
  let hide = 'sharing'
  let shared = null // what the helper last said: true, false, or null (not said, or it can't)
  let proc = null
  const said = (v) => { if (v !== shared) { shared = v; onChange() } }
  function watch(on) {
    if (!on) {
      if (proc) { const p = proc; proc = null; p.kill() }
      said(null)
      return
    }
    if (proc || !mac || !bin) return
    let p
    try { p = spawn(bin, ['sharing'], { stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return }
    proc = p
    let buf = ''
    p.stdout.on('data', (d) => {
      if (proc !== p) return
      buf += d
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let v = null
        try { v = JSON.parse(line).sharing } catch { /* not a line of its */ }
        said(typeof v === 'boolean' ? v : null)
      }
    })
    p.on('error', () => {})
    p.on('exit', () => { if (proc === p) { proc = null; said(null) } })
  }
  return {
    // The setting, from /api/calls; and whether the card shows (the helper runs only while it does).
    set(v, showing) {
      const was = hide
      hide = modeOf(v)
      watch(showing && hide === 'sharing')
      if (hide !== was) onChange()
    },
    hidden: () => hide === 'always' || (hide === 'sharing' && shared !== false),
    stop: () => watch(false),
  }
}

module.exports = { make, modeOf }
