// Lets the page know it's inside the desktop app (for the title bar layout), and lets it take a
// picture of part of its own window (the Preview tab's app), lets an agent open in a window of its
// own, says how long since you last used the computer, restarts the app, picks a folder or files in
// Finder, says where a dropped file is, helps you allow what macOS asks about (asking it, seeing
// it, and forgetting an answer that doesn't take), and sets up the dictation key and its window.
// Nothing else is exposed.
const { contextBridge, ipcRenderer, webUtils } = require('electron')
// Another of your devices, shown through this one (/m/<id>/): its pages get windows and nothing
// of this computer's (no Finder, files, mic, screen or floating card), as on a phone.
const machine = /^\/m\/([A-Za-z0-9_-]{1,20})\//.exec(location.pathname)?.[1] || null
const windows = {
  // An agent in a window of its own (on this device or the one shown), and back.
  popOut: (paneId, title) => ipcRenderer.invoke('bridge:popout', { paneId, title, machine }),
  focusMain: () => ipcRenderer.invoke('bridge:focus-main'),
  focusPopout: (paneId) => ipcRenderer.invoke('bridge:focus-popout', paneId),
  // One of your devices (or this one, id null) in a window of its own.
  openMachine: (id, agent) => ipcRenderer.invoke('bridge:open-machine', { id: id || null, agent: agent || null }),
}
if (machine) contextBridge.exposeInMainWorld('bridgeApp', { platform: process.platform, desktop: false, machine, ...windows })
else contextBridge.exposeInMainWorld('bridgeApp', {
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
  floatSize: (w, h) => ipcRenderer.send('bridge:float-size', w, h),
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
  // Dictation's key from other apps (Settings › Voice), and its window (?dictate=1): what was
  // pressed before it was ready, its size, whether it's listening (Esc is held for it then), hiding,
  // copying, and opening the agent in the main window. Pasting where you're typing in another app:
  // the text pasted there, whether it's allowed (a Mac's Accessibility), and asking for it.
  dictateStatus: () => ipcRenderer.invoke('bridge:dictate-status'),
  hudPaste: (text) => ipcRenderer.invoke('bridge:hud-paste', String(text)),
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
  hudOpen: (o) => ipcRenderer.invoke('bridge:hud-open', o),
  // The pointer on its pill (clicks go through the rest of its window), and Paste again from the
  // list of your dictations.
  hudPointer: (on) => ipcRenderer.send('bridge:hud-pointer', !!on),
  dictateRepaste: (o) => ipcRenderer.invoke('bridge:dictate-repaste', o),
})
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', `platform-${process.platform}`))
