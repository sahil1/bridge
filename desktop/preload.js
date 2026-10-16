// Lets the page know it's inside the desktop app (for the title bar layout), and lets it take a
// picture of part of its own window (the Preview tab's app). Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('bridgeApp', { platform: process.platform, desktop: true, capture: (rect) => ipcRenderer.invoke('bridge:capture', rect) })
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', `platform-${process.platform}`))
