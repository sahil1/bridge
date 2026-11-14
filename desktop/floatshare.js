// The floating card and a screen you share or record (desktop/main.js, Settings › Voice & Meetings › Hide it
// from screen sharing): a screen you share on a call, a recording of it. On a Mac, native/callwatch
// sharing says when, from the moment the card is wanted.
// Asking macOS to leave a window out of pictures of the screen isn't enough: macOS 15 and later lets
// a capture made with ScreenCaptureKit (most calls' screen sharing now) take a window that asks to
// be left out, and Apple says there's no public way to stop it. So while the screen is shared the
// card isn't there to be seen: the meeting being recorded's goes to the menu bar and comes back
// after, and any other card waits (place, below). Windows can't tell when its screen is shared, but
// keeps a window out of a share as asked. The setting (hide):
//   'sharing'  the first choice: on a Mac, the card goes to the menu bar while the screen is shared,
//              and is asked to be left out of pictures meanwhile (which older ways of capturing
//              keep to), so your screenshots show it. Asked to be left out until the helper has
//              said, when it can't (no helper, a macOS that doesn't say, the helper gone), and
//              anywhere else, as 'always'.
//   'always'   the same, and asked to be left out of screenshots too, where macOS keeps to it.
//   'never'    the meeting being recorded's card stays on the screen while you share, in every
//              picture. (Any other card still waits until you stop sharing.)
// make({ bin, mac, spawn, onChange, wait }): bin, the helper (null: none); onChange(), when hidden(),
// sharing() or waiting() may have changed; wait, how long its first answer is waited for.
const { spawn: spawnReal } = require('node:child_process')

const MODES = ['sharing', 'always', 'never']
const modeOf = (v) => (MODES.includes(v) ? v : 'sharing')

function make({ bin = null, mac = process.platform === 'darwin', spawn = spawnReal, onChange = () => {}, wait = 2000 } = {}) {
  let hide = 'sharing'
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
    // and whether it goes while the screen is shared (watch: the helper's needed whatever the setting).
    set(v, showing, watching = false) {
      const was = hide
      hide = modeOf(v)
      watch(showing && (hide === 'sharing' || watching))
      if (hide !== was) onChange()
    },
    hidden: () => hide === 'always' || (hide === 'sharing' && shared !== false),
    // The helper says the screen is shared or recorded now; it's been asked and hasn't said yet.
    sharing: () => !!proc && shared === true,
    waiting: () => !!proc && asking,
    mode: () => hide,
    stop: () => watch(false),
  }
}

// What the card shows and where, from /api/calls (c): { key, show, held, bar, instead, moved }. key:
// what's on it (its × hides it until that changes: hiddenFor); show: the card's window up now; held:
// wanted, but not shown while the screen is shared; bar: the menu bar's (a recording whose card went
// there, by you or for a share, in the menu bar instead, or Take notes while the screen is shared);
// instead: the menu bar instead of the card (Settings); moved: the meeting's card went to the menu
// bar for a share (place's answer, given back next time). share: make()'s, told what's wanted.
//   A card that isn't the meeting being recorded (a meeting about to start, what needs you, a call
//   that started) waits while the screen is shared or recorded, whatever the setting, and for the
//   helper's first word, so it never shows for an instant over a share.
//   The meeting being recorded's card goes to the menu bar while the screen is shared (unless set to
//   Never: then it stays, and anyone you share with may see it), and comes back as it was once
//   sharing stops; keep: you asked for it back from the menu bar during this share (Show the card).
// The helper can't tell Bridge AI's own looks at the screen from a share: they're said here.
//   capturing: a look at the call's window for its names (server/calls.js shot) is being taken, or
//   was a moment ago (the helper's word trails it by a second and a half). One alone doesn't move
//   the card, nor bring back a card that went for a share (they come every few seconds while
//   people talk, and a share goes on through them).
//   watching: the meeting watches a screen (Watch a screen, in the main window), all the while it
//   does. A share then can't be told from it, so the card stays, as its Capture is on it.
function place(c, { hiddenFor = null, mac = false, share = null, watching = false, capturing = false, moved = false, keep = null } = {}) {
  const mode = c.float === 'menubar' && !mac ? 'meetings' : c.float || 'meetings'
  // A meeting with other people starting within ten minutes: the card shows its prep.
  const key = c.recording ? `rec:${c.recording.id}:${c.recording.callEnded || ''}` : c.prompt ? `call:${c.prompt.app}:${c.prompt.at}` : c.soon ? `soon:${c.soon.id}` : 'idle'
  const want = mode === 'always' || (mode === 'meetings' && key !== 'idle')
  const card = want && hiddenFor !== key
  const rec = !!c.recording
  share?.set(c.floatHide, card, card && (!rec || modeOf(c.floatHide) !== 'never'))
  const shared = !!share?.sharing() && !watching
  let held = false
  let went = false
  if (card && !rec) held = (shared && !capturing) || !!share?.waiting()
  else if (card && modeOf(c.floatHide) !== 'never') went = shared && (moved || !capturing) && keep !== key
  held ||= went
  const show = card && !held
  const bar = mode === 'menubar' ? !!(c.recording || c.prompt) : mac && want && !show && (rec || (held && !!c.prompt))
  return { key, show, held, bar, instead: mode === 'menubar', moved: went }
}

module.exports = { make, modeOf, place }
