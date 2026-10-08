const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mcpaths', {
  listSaves: () => ipcRenderer.invoke('list-saves'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openWorld: (folder) => ipcRenderer.invoke('open-world', folder),
  bounds: (dim) => ipcRenderer.invoke('bounds', dim),
  regions: (dim) => ipcRenderer.invoke('regions', dim),
  sample: (query) => ipcRenderer.invoke('sample', query),
  overview: (query) => ipcRenderer.invoke('overview', query),
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
  },
  onMapProgress: (handler) => {
    const listener = (_event, message) => handler(message)
    ipcRenderer.on('map-progress', listener)
    return () => ipcRenderer.removeListener('map-progress', listener)
  }
})
