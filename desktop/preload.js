// Lets the page know it's inside the desktop app (for the title bar layout), and lets it take a
// picture of part of its own window (the Preview tab's app), lets an agent open in a window of its
// own, and says how long since you last used the computer. Nothing else is exposed.
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
})
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', `platform-${process.platform}`))
