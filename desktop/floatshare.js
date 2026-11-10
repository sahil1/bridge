// Whether the floating card is kept out of pictures of the screen (desktop/main.js, Settings ›
// Meetings › Hide it from screen sharing): a screen you share on a call, a recording of it, the
// meeting's own (Watch a screen). The setting (hide):
//   'sharing'  the first choice: only while something shares or records the screen, so your
//              screenshots show it. On a Mac, native/callwatch sharing says when, from the moment
//              the card shows; until it has said, when it can't (no helper, a macOS that doesn't
//              say, the helper gone), and anywhere else, as 'always'.
//   'always'   never in a share, a recording or a screenshot.
//   'never'    in every picture.
// Kept out isn't always out: macOS 15 and later lets a capture made with ScreenCaptureKit (most
// calls' screen sharing now) take a window that asks to be left out, and Apple says there's no
// public way to stop it. So a card that isn't the meeting being recorded (a meeting about to start,
// what needs you, a call that started) doesn't show at all while the screen is shared or recorded
// (hold): it waits, and shows once sharing stops, if it's still wanted. On a Mac only, where the
// helper can tell (Windows can't); held for a moment while the helper is first asked, so it never
// shows for an instant over a share; never held where the helper can't say (no helper, a macOS
// that doesn't say, one that went without a word), so it isn't lost there.
// make({ bin, mac, spawn, onChange, wait }): bin, the helper (null: none); onChange(), when hidden()
// or held() may have changed; wait, how long its first answer is waited for.
const { spawn: spawnReal } = require('node:child_process')

const MODES = ['sharing', 'always', 'never']
const modeOf = (v) => (MODES.includes(v) ? v : 'sharing')

function make({ bin = null, mac = process.platform === 'darwin', spawn = spawnReal, onChange = () => {}, wait = 2000 } = {}) {
  let hide = 'sharing'
  let hold = false
  let shared = null // what the helper last said: true, false, or null (not said, or it can't)
  let proc = null
  let asking = false // started, and not said anything yet
  let mute = false // it can't say here (a macOS that doesn't, or it went without a word): not asked again
  let timer = null
  const said = (v) => { if (v !== shared) { shared = v; onChange() } }
  const answered = () => { clearTimeout(timer); if (asking) { asking = false; onChange() } }
  function watch(on) {
    if (!on) {
      if (proc) { const p = proc; proc = null; p.kill() }
      answered()
      said(null)
      return
    }
    if (proc || !mac || !bin || mute) return
    let p
    try { p = spawn(bin, ['sharing'], { stdio: ['ignore', 'pipe', 'ignore'] }) } catch { mute = true; return }
    proc = p
    asking = true
    let spoke = false
    timer = setTimeout(() => { if (proc === p) answered() }, wait)
    let buf = ''
    p.stdout.on('data', (d) => {
      if (proc !== p) return
      buf += d
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let v = null
        try { v = JSON.parse(line).sharing } catch { /* not a line of its */ }
        if (v === null && /"sharing":null/.test(line)) mute = true
        spoke = true
        said(typeof v === 'boolean' ? v : null)
        answered()
      }
    })
    p.on('error', () => {})
    p.on('exit', () => { if (proc === p) { proc = null; if (!spoke) mute = true; answered(); said(null) } })
  }
  return {
    // The setting, from /api/calls; whether the card is wanted (the helper runs only while it is);
    // and whether it waits while the screen is shared (it isn't the meeting being recorded).
    set(v, showing, held = false) {
      const was = hide
      hide = modeOf(v)
      hold = !!held
      watch(showing && (hide === 'sharing' || hold))
      if (hide !== was) onChange()
    },
    hidden: () => hide === 'always' || (hide === 'sharing' && shared !== false),
    // Not shown now: it waits while the screen is shared, or for the helper's first word.
    held: () => hold && !!proc && (shared === true || asking),
    stop: () => watch(false),
  }
}

// What the card shows and where, from /api/calls (c): { key, show, held, bar, instead }. key: what's
// on it (its × hides it until that changes: hiddenFor); show: the card's window up now; held: wanted
// but waiting while the screen is shared; bar: the menu bar's (a recording whose card went there, or
// in the menu bar instead, or a call that started while the screen is shared); instead: the menu bar
// instead of the card (Settings). share: make()'s, told what's wanted, and asked whether it waits.
function place(c, { hiddenFor = null, mac = false, share = null } = {}) {
  const mode = c.float === 'menubar' && !mac ? 'meetings' : c.float || 'meetings'
  // A meeting with other people starting within ten minutes: the card shows its prep.
  const key = c.recording ? `rec:${c.recording.id}:${c.recording.callEnded || ''}` : c.prompt ? `call:${c.prompt.app}:${c.prompt.at}` : c.soon ? `soon:${c.soon.id}` : 'idle'
  const want = mode === 'always' || (mode === 'meetings' && key !== 'idle')
  const card = want && hiddenFor !== key
  share?.set(c.floatHide, card, card && !c.recording)
  const held = card && !!share?.held()
  const show = card && !held
  // The menu bar: instead of the card (Settings), for a meeting whose card you moved there, or for
  // Take notes while the card waits for a share to end.
  const bar = mode === 'menubar' ? !!(c.recording || c.prompt) : mac && want && !show && (!!c.recording || (held && !!c.prompt))
  return { key, show, held, bar, instead: mode === 'menubar' }
}

module.exports = { make, modeOf, place }
