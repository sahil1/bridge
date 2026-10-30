// The Allow access tile (main.js): drag Bridge AI from it into System Settings, or close it.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('tile', {
  drag: () => ipcRenderer.send('bridge:tile-drag'),
  close: () => ipcRenderer.send('bridge:tile-close'),
})
