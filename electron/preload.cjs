// Runs with contextIsolation on: the renderer only ever sees this frozen
// surface, never Node or ipcRenderer directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: patch => ipcRenderer.invoke('settings:set', patch)
  },

  key: {
    get: () => ipcRenderer.invoke('key:get'),
    set: plain => ipcRenderer.invoke('key:set', plain),
    isSecure: () => ipcRenderer.invoke('key:secure')
  },

  history: {
    list: () => ipcRenderer.invoke('history:list'),
    add: entry => ipcRenderer.invoke('history:add', entry),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  saveFile: (suggestedName, content) =>
    ipcRenderer.invoke('file:save', { suggestedName, content }),

  aiRequest: body => ipcRenderer.invoke('ai:request', body)
});
