// Lets the page know it's inside the desktop app (for the title bar layout). Nothing else is exposed.
const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('bridgeApp', { platform: process.platform, desktop: true })
window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-bridge-app', `platform-${process.platform}`))
