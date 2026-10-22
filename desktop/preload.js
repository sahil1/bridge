// Lets the page know it's inside the desktop app (for the title bar layout), and lets it take a
// picture of part of its own window (the Preview tab's app), lets an agent open in a window of its
// own, says how long since you last used the computer, restarts the app, and helps you allow what
// macOS asks about. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('bridgeApp', {
  platform: process.platform,
  desktop: true,
  capture: (rect) => ipcRenderer.invoke('bridge:capture', rect),
  // An agent in a window of its own, and back.
  popOut: (paneId, title) => ipcRenderer.invoke('bridge:popout', { paneId, title }),
  focusMain: () => ipcRenderer.invoke('bridge:focus-main'),
  focusPopout: (paneId) => ipcRenderer.invoke('bridge:focus-popout', paneId),
  // Seconds since you last used the computer, so your phone isn't kept quiet while you're away.
  idle: () => ipcRenderer.invoke('bridge:idle'),
  // After you allow something in System Settings: restart so it takes effect.
  restart: () => ipcRenderer.invoke('bridge:restart'),
  // Allow access: the tile with the app's icon to drag into System Settings' list, and closing it.
  fixTile: (pane) => ipcRenderer.invoke('bridge:fix-tile', pane),
  closeFixTile: () => ipcRenderer.invoke('bridge:fix-tile-close'),
  // Whether macOS lets the app use the mic, and a test notification.
  mediaAccess: (kind) => ipcRenderer.invoke('bridge:media-access', kind),
  testNotification: () => ipcRenderer.invoke('bridge:notify-test'),
})
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', `platform-${process.platform}`))
