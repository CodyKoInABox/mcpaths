const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mcpaths', {
  listSaves: () => ipcRenderer.invoke('list-saves'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openWorld: (folder) => ipcRenderer.invoke('open-world', folder),
  bounds: (dim) => ipcRenderer.invoke('bounds', dim),
  sample: (query) => ipcRenderer.invoke('sample', query),
  preview: (query) => ipcRenderer.invoke('preview', query),
  apply: (query) => ipcRenderer.invoke('apply', query),
  onOpened: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('opened-world', listener)
    return () => ipcRenderer.removeListener('opened-world', listener)
  },
  onStatus: (handler) => {
    const listener = (_event, message) => handler(message)
    ipcRenderer.on('status', listener)
    return () => ipcRenderer.removeListener('status', listener)
  }
})
