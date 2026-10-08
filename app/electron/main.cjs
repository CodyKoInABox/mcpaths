const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const core = require(path.join(__dirname, '../../core/dist/index.js'))

let win = null
let world = null
let mapToken = 0
let worldChain = Promise.resolve()

function enqueue(task) {
  const run = worldChain.then(task, task)
  worldChain = run.then(() => {}, () => {})
  return run
}

function sendStatus(error) {
  win?.webContents.send('status', error ? String(error) : '')
}

function hasRegionFiles(dir) {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).some(name => name.endsWith('.mca'))
  } catch {
    return false
  }
}

function asBytes(value) {
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  return Buffer.from(value)
}

async function openPath(folder) {
  if (world) {
    await world.close()
    world = null
  }
  world = await core.World.open(folder)
  return {
    info: world.info,
    dimensions: ['overworld', 'nether', 'end'].map(dim => ({
      id: dim,
      region: world.regionDir(dim),
      hasFiles: hasRegionFiles(world.regionDir(dim))
    }))
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0e141b',
    title: 'MC Paths',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const dev = process.env.VITE_DEV_SERVER
  if (dev) win.loadURL(dev)
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(async () => {
  createWindow()
  const flag = process.argv.indexOf('--world')
  if (flag >= 0 && process.argv[flag + 1]) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const opened = await enqueue(() => openPath(process.argv[flag + 1]))
        win.webContents.send('opened-world', opened)
      } catch (error) {
        sendStatus(error.message || error)
      }
    })
  }
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', async () => { if (world) await world.close() })

ipcMain.handle('list-saves', async () => {
  try {
    return { ok: true, data: await core.listSaves() }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths[0]) return { ok: true, data: null }
  mapToken++
  try {
    return { ok: true, data: await enqueue(() => openPath(result.filePaths[0])) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('open-world', async (_event, folder) => {
  mapToken++
  try {
    return { ok: true, data: await enqueue(() => openPath(folder)) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('bounds', async (_event, dim) => {
  if (!world) return { ok: false, error: 'No world is open.' }
  try {
    return { ok: true, data: await enqueue(() => world.bounds(dim)) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('regions', async (_event, dim) => {
  if (!world) return { ok: false, error: 'No world is open.' }
  try {
    const masks = await enqueue(() => core.regionMasks(world.info.path, dim, world.info.dataVersion))
    return {
      ok: true,
      data: masks.map(mask => ({ rx: mask.rx, rz: mask.rz, present: Uint8Array.from(mask.present) }))
    }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('sample', async (event, query) => {
  const token = ++mapToken
  if (!world) return { ok: false, error: 'No world is open.' }
  return enqueue(async () => {
    if (!world || token !== mapToken) return { ok: false, cancelled: true }
    try {
      if (query.force) world.clearMapCache()
      const map = await core.sampleMap(world, query.dim, query.originX, query.originZ, query.width, query.height, {
        progress: message => {
          if (token === mapToken) event.sender.send('map-progress', message)
        },
        cancelled: () => token !== mapToken
      })
      if (token !== mapToken || map.aborted) return { ok: false, cancelled: true }
      return {
        ok: true,
        data: {
          originX: map.originX,
          originZ: map.originZ,
          width: map.width,
          height: map.height,
          rgb: asBytes(map.rgb),
          present: asBytes(map.present),
          chunks: map.chunks,
          failed: map.failed,
          truncated: map.truncated,
          warning: map.warning || ''
        }
      }
    } catch (error) {
      if (token !== mapToken) return { ok: false, cancelled: true }
      return { ok: false, error: error.message }
    }
  })
})

ipcMain.handle('tiles', async (event, query) => {
  const token = ++mapToken
  if (!world) return { ok: false, error: 'No world is open.' }
  const chunks = Array.isArray(query?.chunks) ? query.chunks : []
  return enqueue(async () => {
    if (!world || token !== mapToken) return { ok: false, cancelled: true }
    try {
      if (query.force) world.clearMapCache()
      const map = await core.sampleTiles(world, query.dim, chunks, {
        progress: message => {
          if (token === mapToken) event.sender.send('map-progress', message)
        },
        cancelled: () => token !== mapToken
      })
      if (token !== mapToken || map.aborted) return { ok: false, cancelled: true }
      return {
        ok: true,
        data: {
          cx: map.cx,
          cz: map.cz,
          rgb: asBytes(map.rgb),
          failed: map.failed
        }
      }
    } catch (error) {
      if (token !== mapToken) return { ok: false, cancelled: true }
      return { ok: false, error: error.message }
    }
  })
})

ipcMain.handle('preview', async (_event, query) => {
  if (!world) return { ok: false, error: 'No world is open.' }
  return enqueue(async () => {
    if (!world) return { ok: false, error: 'No world is open.' }
    try {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
      for (const path of query.paths) {
        for (const point of path.points) {
          minX = Math.min(minX, point.x)
          minZ = Math.min(minZ, point.z)
          maxX = Math.max(maxX, point.x)
          maxZ = Math.max(maxZ, point.z)
        }
      }
      if (Number.isFinite(minX)) await world.preload(query.dim, minX - 8, minZ - 8, maxX + 8, maxZ + 8)
      const cells = core.previewPaths(world, query.dim, query.paths)
      return { ok: true, data: cells.map(cell => ({ x: cell.x, y: cell.y, z: cell.z, name: cell.name })) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
})

ipcMain.handle('apply', async (_event, query) => {
  if (!world) return { ok: false, error: 'No world is open.' }
  return enqueue(async () => {
    if (!world) return { ok: false, error: 'No world is open.' }
    try {
      const result = await core.applyPaths(world, query.dim, query.paths)
      world.clearMapCache()
      return {
        ok: true,
        data: {
          backupDir: result.backupDir,
          chunks: result.chunks
        }
      }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
})
