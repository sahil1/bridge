// Watch a screen, in a meeting (src/components/meetings/recording.jsx): the app's answer when a page
// asks for a screen (getDisplayMedia), and why it said no, for the page to say (bridgeApp.screenWhy).
// macOS 15 and later get here only once Remote Screen has taken the screen in this run (main.js
// noPicker): until then Electron shows macOS's own picker instead (useSystemPicker), which needs no
// Screen Recording, and doesn't ask this. Before macOS 15, on Windows and on Linux, it's the whole
// main screen (on Linux, the screen picked in the system's own dialog), which on a Mac needs Screen
// Recording: without it, getSources fails (the first time, macOS asks in a window of its own).
//
// No is said with null: Electron 45 throws at {} for a video that was asked for (and the page hears
// only "Invalid capture constraints" either way), so why is kept here, for the page that asked.
// Everything it uses comes in (create's options), so the tests stand in for Electron.
//
// The reasons (why):
//   gone    the page navigated or closed while it asked
//   frame   a frame in a page (a project's app in Preview, another computer's agent in a tab)
//   page    not this computer's own page (a window showing another computer)
//   off     a Mac's Screen Recording is off for Bridge AI (or macOS has just asked)
//   reopen  Screen Recording turned on since Bridge AI started: macOS applies it once it restarts
//   none    no screen listed, with Screen Recording on (a Mac) or nothing to allow (Windows, Linux)
//   error   listing the screens failed (problem: what it said)
function create({ desktopCapturer, systemPreferences, permits, platform = process.platform, now = Date.now }) {
  const MAC = platform === 'darwin'
  // macOS's word on Screen Recording, without asking: 'ok', 'restricted' or 'off' (macOS says denied
  // until it has asked, so not asked yet is off too).
  const access = () => {
    if (!MAC) return 'ok'
    let s = null
    try { s = systemPreferences.getMediaAccessStatus('screen') } catch { return 'ok' }
    return s === 'granted' ? 'ok' : s === 'restricted' ? 'restricted' : 'off'
  }
  // As it was when the app started: one turned on since takes effect once the app restarts.
  const startedWith = access()
  const said = new Map() // webContents id -> { why, problem, at }
  const note = (id, why, problem) => { if (id != null) said.set(id, { why, ...(problem ? { problem: String(problem).slice(0, 200) } : {}), at: now() }) }
  // Why there's no screen to give, on this computer as it is now.
  const noScreen = () => {
    const a = access()
    if (a !== 'ok') return a === 'restricted' ? 'restricted' : 'off'
    return MAC && startedWith !== 'ok' ? 'reopen' : 'none'
  }
  // req, cb: Electron's. id: the asking page's webContents id (null when it can't be told).
  function handler(req, cb, id = null) {
    const answer = (streams) => { try { cb(streams) } catch { /* the page went away meanwhile */ } }
    const no = (why, problem) => { note(id, why, problem); answer(null) }
    if (!req?.frame) return no('gone')
    if (req.frame.parent) return no('frame')
    if (!permits('display-capture', { url: req.frame.url })) return no('page')
    // Recording the screen too, on Windows: with what the computer plays (the call's sound), which
    // the page asks for there.
    const sound = req.audioRequested && platform === 'win32' ? { audio: 'loopback' } : {}
    return Promise.resolve()
      .then(() => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }))
      .then((list) => {
        const all = (list || []).filter((x) => x && typeof x.id === 'string')
        const s = all.find((x) => x.id.startsWith('screen:')) || all[0] || null
        if (!s) return no(noScreen())
        said.delete(id)
        answer({ video: { id: s.id, name: String(s.name || 'Screen') }, ...sound })
      }, (e) => { const w = noScreen(); no(w === 'none' ? 'error' : w, e?.message || e) })
  }
  // The last no for the page in webContents id, once, if it was a moment ago (the click it answers).
  const why = (id) => {
    const x = said.get(id)
    said.delete(id)
    return x && now() - x.at < 30_000 ? { why: x.why, ...(x.problem ? { problem: x.problem } : {}) } : null
  }
  return { handler, why, access }
}

// The handler set on a session (main.js): with macOS's own picker where it's there (picker: macOS 15
// and later), until off(why) gives it up for the rest of this run, from the next screen asked for.
// With the picker, Electron 45 never asks the handler (lib/browser/api/session.ts answers with the
// picker's own source), so a no from the picker has no why here; where there's none,
// useSystemPicker changes nothing. how(): which answers a
// screen asked for now, for the page (bridgeApp.screenHow) and its line in the log.
function install({ session, handler, picker = false }) {
  let off = null
  const set = () => session.setDisplayMediaRequestHandler(handler, { useSystemPicker: !off })
  set()
  return {
    how: () => ({ picker: !!picker && !off, off }),
    off: (why) => { if (!picker || off) return false; off = String(why || 'off').slice(0, 40); set(); return true },
  }
}

module.exports = { create, install }
