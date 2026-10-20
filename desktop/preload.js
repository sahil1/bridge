// Lets the page know it's inside the desktop app (for the title bar layout), and lets it take a
// picture of part of its own window (the Preview tab's app), and lets an agent open in a window of
// its own. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('bridgeApp', {
  platform: process.platform,
  desktop: true,
  capture: (rect) => ipcRenderer.invoke('bridge:capture', rect),
  // An agent in a window of its own, and back.
  popOut: (paneId, title) => ipcRenderer.invoke('bridge:popout', { paneId, title }),
  focusMain: () => ipcRenderer.invoke('bridge:focus-main'),
  focusPopout: (paneId) => ipcRenderer.invoke('bridge:focus-popout', paneId),
})
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', `platform-${process.platform}`))
