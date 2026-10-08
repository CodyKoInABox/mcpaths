const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const core = require(path.join(__dirname, '../../core/dist/index.js'))

let win = null
let world = null

function sendStatus(error) {
  win?.webContents.send('status', error ? String(error) : '')
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
      hasFiles: fs.existsSync(world.regionDir(dim)) && fs.readdirSync(world.regionDir(dim)).some(name => name.endsWith('.mca'))
    }))
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#12161a',
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
        const opened = await openPath(process.argv[flag + 1])
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
    const saves = await core.listSaves()
    return { ok: true, data: saves }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths[0]) return { ok: true, data: null }
  try {
    return { ok: true, data: await openPath(result.filePaths[0]) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('open-world', async (_event, folder) => {
  try {
    return { ok: true, data: await openPath(folder) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('bounds', async (_event, dim) => {
  if (!world) return { ok: false, error: 'No world is open.' }
  try {
    return { ok: true, data: world.bounds(dim) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('sample', async (_event, query) => {
  if (!world) return { ok: false, error: 'No world is open.' }
  try {
    const map = await core.sampleMap(world, query.dim, query.originX, query.originZ, query.width, query.height)
    return { ok: true, data: { ...map, rgb: Array.from(map.rgb) } }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('preview', async (_event, query) => {
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

ipcMain.handle('apply', async (_event, query) => {
  if (!world) return { ok: false, error: 'No world is open.' }
  try {
    const result = await core.applyPaths(world, query.dim, query.paths)
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
