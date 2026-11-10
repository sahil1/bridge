// Lets the page know it's inside the desktop app (for the title bar layout), and lets it take a
// picture of part of its own window (the Preview tab's app), lets an agent open in a window of its
// own, says how long since you last used the computer, restarts the app, picks a folder or files in
// Finder, says where a dropped file is, helps you allow what macOS asks about (asking it, seeing
// it, and forgetting an answer that doesn't take), sets up the dictation key and its window, makes
// its own window full screen for Studio's Focus, and says what an update would lose in the window.
// Nothing else is exposed.
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron')
// Another of your devices, shown through this one (/m/<id>/, at an address of its own: senders.js):
// its pages get windows and nothing of this computer's (no Finder, files, mic, screen or floating
// card), as on a phone. So does any page that isn't this computer's own at its own address (a page an
// agent made, at /api/...), and the app checks each message too (senders.js guard).
const machine = /^\/m\/([A-Za-z0-9_-]{1,20})\//.exec(location.pathname)?.[1] || null
const own = !machine && location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) && !location.pathname.startsWith('/api/')
// What an update would lose in this window, asked by the app before it updates by itself while
// you're away (main.js): the page answers (src/busy.js). No answer: null, which counts as busy.
let busyAnswer = null
ipcRenderer.on('bridge:busy-ask', (_e, id) => {
  let a = null
  try { a = busyAnswer ? busyAnswer() : null } catch { /* no answer */ }
  ipcRenderer.send('bridge:busy-said', id, Array.isArray(a) ? a.filter((x) => typeof x === 'string') : null)
})
const windows = {
  // An agent in a window of its own (on this device or the one shown), and back.
  popOut: (paneId, title) => ipcRenderer.invoke('bridge:popout', { paneId, title, machine }),
  focusMain: () => ipcRenderer.invoke('bridge:focus-main'),
  focusPopout: (paneId) => ipcRenderer.invoke('bridge:focus-popout', paneId),
  // One of your devices (or this one, id null) in a window of its own. pass: what this page passes
  // to that one, for after the # of its address (src/passed.js).
  openMachine: (id, agent, pass) => ipcRenderer.invoke('bridge:open-machine', { id: id || null, agent: agent || null, pass: typeof pass === 'string' ? pass : '' }),
  // How the page says what an update would lose in it (above).
  answerBusy: (fn) => { busyAnswer = typeof fn === 'function' ? fn : null },
}
// dictates: the app listens for the dictation key in its window (desktop/dictation.js), as its page
// can't use this computer's microphone, so the page leaves the key to it. looking: the agent it has
// on screen, for the dictation window's "the agent I looked at last" (src/dictation/controller.js).
if (!own) {
  contextBridge.exposeInMainWorld('bridgeApp', {
    platform: process.platform, desktop: false, machine, dictates: true, ...windows,
    looking: (l) => ipcRenderer.send('bridge:looking', { pane: String(l?.pane || '').slice(0, 200), name: String(l?.name || '').slice(0, 120) }),
  })
} else contextBridge.exposeInMainWorld('bridgeApp', {
  platform: process.platform,
  desktop: true,
  capture: (rect) => ipcRenderer.invoke('bridge:capture', rect),
  ...windows,
  // A folder picked in Finder (or the system's own dialog), for a new agent, or as a place in Files
  // ({ place: true }).
  pickFolder: (start, o) => ipcRenderer.invoke('bridge:pick-folder', start, { place: !!o?.place }),
  // Seconds since you last used the computer, so your phone isn't kept quiet while you're away.
  idle: () => ipcRenderer.invoke('bridge:idle'),
  // After you allow something in System Settings: restart so it takes effect.
  restart: () => ipcRenderer.invoke('bridge:restart'),
  // What the app itself asks the system for (desktop/permissions.js): the microphone, Accessibility,
  // notifications. Its question first, else System Settings and the tile; whether it's on, without
  // asking; and an answer that doesn't take, forgotten and asked again.
  permission: {
    kinds: () => ipcRenderer.invoke('bridge:perm', { op: 'kinds' }),
    status: (kind) => ipcRenderer.invoke('bridge:perm', { op: 'status', kind }),
    ask: (kind) => ipcRenderer.invoke('bridge:perm', { op: 'ask', kind }),
    open: (kind) => ipcRenderer.invoke('bridge:perm', { op: 'open', kind }),
    reset: (kind) => ipcRenderer.invoke('bridge:perm', { op: 'reset', kind }),
    canReset: (kind) => ipcRenderer.invoke('bridge:perm', { op: 'can-reset', kind }),
  },
  // Allow access: the tile with the app's icon to drag into System Settings' list, and closing it.
  fixTile: (pane) => ipcRenderer.invoke('bridge:fix-tile', pane),
  closeFixTile: () => ipcRenderer.invoke('bridge:fix-tile-close'),
  // Whether macOS lets the app use the mic, and a test notification.
  mediaAccess: (kind) => ipcRenderer.invoke('bridge:media-access', kind),
  askMedia: (kind) => ipcRenderer.invoke('bridge:media-ask', kind),
  resetMedia: (kind) => ipcRenderer.invoke('bridge:media-reset', kind),
  testNotification: () => ipcRenderer.invoke('bridge:notify-test'),
  // Meetings: the main window says when it's recording (so closing it hides it instead), and the
  // floating card fits its size, hides, takes notes for a call and opens things in the main window.
  recording: (on) => ipcRenderer.invoke('bridge:recording', !!on),
  floatSize: (w, h, low) => ipcRenderer.send('bridge:float-size', w, h, low),
  // The page's zoom (⌘+ and ⌘− in the main window zoom the card too): what's left of the screen,
  // in its own pixels.
  zoom: () => { try { return webFrame.getZoomFactor() } catch { return 1 } },
  floatHide: () => ipcRenderer.invoke('bridge:float-hide'),
  floatStart: (o) => ipcRenderer.invoke('bridge:float-start', o),
  floatOpen: (o) => ipcRenderer.invoke('bridge:float-open', o),
  // The card is dragged from anywhere on it, and asks the main window to watch a screen.
  floatMove: (x, y) => ipcRenderer.send('bridge:float-move', x, y),
  floatWatch: () => ipcRenderer.invoke('bridge:float-watch'),
  // A meeting's files: picked in Finder, or dropped (where each one is), and watching a screen.
  pickFiles: () => ipcRenderer.invoke('bridge:pick-files'),
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || null } catch { return null } },
  watching: (on) => ipcRenderer.invoke('bridge:watching', !!on),
  // Studio's Focus: this window full screen (true) or back (false), or whether it is (nothing).
  fullScreen: (on) => ipcRenderer.invoke('bridge:full-screen', typeof on === 'boolean' ? on : null),
  // Dictation's key from other apps (Settings › Voice), and its window (?dictate=1): what was
  // pressed before it was ready, its size, whether it's listening (Esc is held for it then), hiding,
  // copying, and the keyboard while its words are edited there (taken, then given back). Pasting
  // where you're typing in another app: the text pasted there (back: from the card, with that app
  // brought to the front first), whether it's allowed (a Mac's Accessibility), and asking for it.
  dictateStatus: () => ipcRenderer.invoke('bridge:dictate-status'),
  hudPaste: (text, o) => ipcRenderer.invoke('bridge:hud-paste', String(text), { back: o?.back === true }),
  // ...or, for a window of Bridge AI's showing another of your devices, into that window's page; and
  // the agent such a window had on screen, when it was the one looked at last.
  hudInto: (text) => ipcRenderer.invoke('bridge:hud-into', String(text)),
  hudLooked: () => ipcRenderer.invoke('bridge:hud-looked'),
  // Edit by voice: what was selected where you were typing, read as the key was let go.
  hudSelection: () => ipcRenderer.invoke('bridge:hud-selection'),
  pasteAccess: () => ipcRenderer.invoke('bridge:paste-access'),
  pasteAsk: () => ipcRenderer.invoke('bridge:paste-ask'),
  dictateConfigure: (s) => ipcRenderer.invoke('bridge:dictate-configure', s),
  hudReady: () => ipcRenderer.invoke('bridge:hud-ready'),
  hudSize: (w, h) => ipcRenderer.send('bridge:hud-size', w, h),
  hudPhase: (phase) => ipcRenderer.send('bridge:hud-phase', String(phase)),
  hudHide: () => ipcRenderer.invoke('bridge:hud-hide'),
  hudCopy: (text) => ipcRenderer.invoke('bridge:hud-copy', String(text)),
  hudKeyboard: (on) => ipcRenderer.invoke('bridge:hud-keys', on === true),
  // The pointer on its pill (clicks go through the rest of its window), and Paste again from the
  // list of your dictations.
  hudPointer: (on) => ipcRenderer.send('bridge:hud-pointer', !!on),
  dictateRepaste: (o) => ipcRenderer.invoke('bridge:dictate-repaste', o),
})
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', `platform-${process.platform}`))
