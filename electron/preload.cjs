/* eslint-disable @typescript-eslint/no-require-imports */
/* global process, require */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shortsFactoryDesktop', {
  runtime: 'electron',
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  selectAndImportMedia: (payload) => ipcRenderer.invoke('shorts:select-and-import-media', payload),
  selectFile: (payload) => ipcRenderer.invoke('shorts:select-file', payload),
})
