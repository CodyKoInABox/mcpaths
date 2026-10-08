import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { paintSwatch } from './swatches'
import {
  DEFAULT_OPTIONS,
  PRESETS,
  type Dimension,
  type PathOptions,
  type PresetId,
  type SaveListing,
  type SaveRoot,
  type SurveyPath,
  type WorldPayload,
  type XZ
} from './types'

const COLORS: Record<string, string> = {
  dirt_path: '#c4a15a',
  rooted_dirt: '#8d6848',
  coarse_dirt: '#7a5a3c',
  cobblestone: '#9a9a9a',
  mossy_cobblestone: '#6e7a5c',
  stone_bricks: '#8d8d8d',
  moss_block: '#5d7a32',
  smooth_sandstone: '#e2d2a4',
  sandstone: '#d2c094',
  spruce_planks: '#8a6238',
  gravel: '#a39898',
  packed_ice: '#b7d4ef',
  air: '#00000000'
}

const DIM_LABEL: Record<Dimension, string> = {
  overworld: 'Overworld',
  nether: 'Nether',
  end: 'End'
}

const GAME_LABEL: Record<string, string> = {
  survival: 'Survival',
  creative: 'Creative',
  adventure: 'Adventure',
  spectator: 'Spectator'
}

const CHUNK_BUDGET = 96

type MapPhase = 'loading' | 'ready' | 'empty' | 'error' | 'overview'
type MapBitmap = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  originX: number
  originZ: number
}

export function App() {
  const [saves, setSaves] = useState<SaveListing[]>([])
  const [roots, setRoots] = useState<SaveRoot[]>([])
  const [listPhase, setListPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [opening, setOpening] = useState<string | null>(null)
  const [world, setWorld] = useState<WorldPayload | null>(null)
  const [dim, setDim] = useState<Dimension>('overworld')
  const [status, setStatus] = useState('Reading saves…')
  const [bad, setBad] = useState(false)
  const [paths, setPaths] = useState<SurveyPath[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ x: number, z: number, name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(8)
  const [mapPhase, setMapPhase] = useState<MapPhase>('loading')
  const [mapMessage, setMapMessage] = useState('Indexing regions…')
  const view = useRef({ originX: 0, originZ: 0, scale: 8 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<MapBitmap | null>(null)
  const maskRef = useRef(new Map<string, Uint8Array>())
  const maskListRef = useRef<{ rx: number, rz: number, present: Uint8Array }[]>([])
  const drag = useRef<{ mode: 'pan' | 'point', index: number, sx: number, sy: number, ox: number, oz: number } | null>(null)
  const sampleSeq = useRef(0)
  const paintRef = useRef<() => void>(() => {})
  const sampleRef = useRef<(force?: boolean) => Promise<void>>(async () => {})
  const worldRef = useRef<WorldPayload | null>(null)
  const pendingFocus = useRef<{ x: number, z: number } | null>(null)
  const scaleFor = useRef<string | null>(null)
  const recentered = useRef(false)
  const regionsReady = useRef(false)
  const sampleTimer = useRef(0)
  const busyRef = useRef(false)
  const coordRef = useRef<HTMLSpanElement>(null)
  const visibleRef = useRef<HTMLSpanElement>(null)

  const note = (message: string, isBad = false) => {
    setStatus(message)
    setBad(isBad)
  }

  const openPayload = (payload: WorldPayload) => {
    sampleSeq.current++
    worldRef.current = payload
    scaleFor.current = null
    recentered.current = false
    regionsReady.current = false
    maskRef.current = new Map()
    maskListRef.current = []
    mapRef.current = null
    pendingFocus.current = focusOf(payload.info, 'overworld')
    view.current.scale = 8
    setZoom(8)
    setWorld(payload)
    setDim('overworld')
    setMapPhase('loading')
    setMapMessage('Indexing regions…')
    const first = newPath('Path 1')
    setPaths([first])
    setActiveId(first.id)
    note(`${payload.info.name} · ${payload.info.versionName} · data ${payload.info.dataVersion}`)
  }

  const loadSaves = useCallback(() => {
    if (!window.mcpaths) {
      setListPhase('error')
      note('This window has no MC Paths bridge. Launch the desktop app.', true)
      return
    }
    setListPhase('loading')
    if (!worldRef.current) note('Reading saves…')
    window.mcpaths.listSaves().then(result => {
      if (!result.ok || !result.data) {
        setListPhase('error')
        if (!worldRef.current) note(result.error || 'Could not list saves.', true)
        return
      }
      setRoots(result.data.roots)
      setSaves(result.data.saves)
      setListPhase('ready')
      if (!worldRef.current) {
        note(result.data.saves.length ? 'Pick a save, or open a folder.' : 'No saves in the usual folders.')
      }
    }).catch((error: unknown) => {
      setListPhase('error')
      const message = error instanceof Error ? error.message : 'Could not list saves.'
      if (!worldRef.current) note(message, true)
    })
  }, [])

  useEffect(() => {
    loadSaves()
    if (!window.mcpaths) return
    const offOpen = window.mcpaths.onOpened(openPayload)
    const offStatus = window.mcpaths.onStatus(message => note(message, true))
    return () => { offOpen(); offStatus() }
  }, [loadSaves])

  const scheduleSample = useCallback(() => {
    window.clearTimeout(sampleTimer.current)
    sampleTimer.current = window.setTimeout(() => { void sampleRef.current() }, 90)
  }, [])

  const jumpToTerrain = useCallback(() => {
    if (recentered.current) return false
    const canvas = canvasRef.current
    if (!canvas || canvas.clientWidth < 8 || maskRef.current.size === 0) return false
    if (viewHasChunks(canvas, view.current, maskRef.current)) return false
    const focusX = view.current.originX + canvas.clientWidth / view.current.scale / 2
    const focusZ = view.current.originZ + canvas.clientHeight / view.current.scale / 2
    const nearest = nearestChunk(maskListRef.current, focusX, focusZ)
    if (!nearest) return false
    recentered.current = true
    view.current.originX = nearest.x - canvas.clientWidth / view.current.scale / 2
    view.current.originZ = nearest.z - canvas.clientHeight / view.current.scale / 2
    setMapMessage('No chunks at the spawn. Loading the nearest terrain…')
    return true
  }, [])

  const sample = useCallback(async (force = false) => {
    const canvas = canvasRef.current
    const current = worldRef.current
    if (!current || !window.mcpaths) return
    if (!canvas || canvas.clientWidth < 8 || canvas.clientHeight < 8) {
      setMapPhase('loading')
      setMapMessage('Preparing the map…')
      return
    }
    if (pendingFocus.current) {
      const focus = pendingFocus.current
      pendingFocus.current = null
      view.current.originX = focus.x - canvas.clientWidth / view.current.scale / 2
      view.current.originZ = focus.z - canvas.clientHeight / view.current.scale / 2
    }
    const seq = ++sampleSeq.current
    const scale = view.current.scale
    const blocksW = Math.ceil(canvas.clientWidth / scale) + 1
    const blocksH = Math.ceil(canvas.clientHeight / scale) + 1
    const across = Math.ceil(canvas.clientWidth / scale / 16)
    const down = Math.ceil(canvas.clientHeight / scale / 16)
    if (across * down > CHUNK_BUDGET || blocksW > 512 || blocksH > 512) {
      mapRef.current = null
      setMapPhase(regionsReady.current && maskRef.current.size === 0 ? 'empty' : 'overview')
      setMapMessage(regionsReady.current && maskRef.current.size === 0
        ? emptyMessage(current, dim)
        : 'Zoom in to color the terrain. Explored chunks stay on the grid.')
      paintRef.current()
      return
    }
    setMapPhase('loading')
    setMapMessage('Reading terrain…')
    const off = window.mcpaths.onMapProgress(message => {
      if (seq === sampleSeq.current) setMapMessage(message)
    })
    try {
      const result = await window.mcpaths.sample({
        dim,
        originX: Math.floor(view.current.originX),
        originZ: Math.floor(view.current.originZ),
        width: blocksW,
        height: blocksH,
        force
      })
      if (seq !== sampleSeq.current || !worldRef.current) return
      if (result.cancelled) return
      if (!result.ok || !result.data) {
        mapRef.current = null
        setMapPhase('error')
        setMapMessage(result.error || 'The map could not be read.')
        note(result.error || 'The map could not be read.', true)
        paintRef.current()
        return
      }
      const rgb = bytesOf(result.data.rgb)
      const present = bytesOf(result.data.present)
      mapRef.current = {
        canvas: bitmapOf(rgb, present, result.data.width, result.data.height),
        width: result.data.width,
        height: result.data.height,
        originX: result.data.originX,
        originZ: result.data.originZ
      }
      paintRef.current()
      if (result.data.failed > 0 && result.data.chunks === 0) {
        setMapPhase('error')
        setMapMessage(result.data.warning || 'Region files could not be read.')
        note(result.data.warning || 'Region files could not be read.', true)
        return
      }
      if (result.data.chunks === 0 && result.data.failed === 0) {
        if (jumpToTerrain()) {
          void sampleRef.current()
          return
        }
        if (!regionsReady.current) {
          setMapPhase('loading')
          setMapMessage('Indexing regions…')
          return
        }
        if (maskRef.current.size === 0) {
          setMapPhase('empty')
          setMapMessage(emptyMessage(current, dim))
          return
        }
        setMapPhase('ready')
        setMapMessage('No colored chunks in this view. Pan, or zoom out to see explored terrain.')
        return
      }
      setMapPhase('ready')
      setMapMessage(result.data.warning || '')
      if (result.data.warning) note(result.data.warning, result.data.failed > 0)
    } catch (error) {
      if (seq !== sampleSeq.current || !worldRef.current) return
      const message = error instanceof Error ? error.message : 'The map could not be read.'
      mapRef.current = null
      setMapPhase('error')
      setMapMessage(message)
      note(message, true)
      paintRef.current()
    } finally {
      off()
    }
  }, [dim, jumpToTerrain])

  sampleRef.current = sample

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (cssW < 2 || cssH < 2) return
    canvas.width = Math.floor(cssW * dpr)
    canvas.height = Math.floor(cssH * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#10161c'
    ctx.fillRect(0, 0, cssW, cssH)
    const scale = view.current.scale
    const originX = view.current.originX
    const originZ = view.current.originZ
    drawFootprints(ctx, cssW, cssH, originX, originZ, scale, maskRef.current)
    const map = mapRef.current
    if (map) {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(
        map.canvas,
        (map.originX - originX) * scale,
        (map.originZ - originZ) * scale,
        map.width * scale,
        map.height * scale
      )
    }
    if (16 * scale >= 8) strokeGrid(ctx, cssW, cssH, originX, originZ, scale, 16, 'rgba(232, 238, 246, 0.16)', 1)
    if (512 * scale >= 12) strokeGrid(ctx, cssW, cssH, originX, originZ, scale, 512, 'rgba(228, 177, 90, 0.55)', 1)
    const current = worldRef.current
    if (current && dim === 'overworld') {
      const sx = (current.info.spawn.x + 0.5 - originX) * scale
      const sz = (current.info.spawn.z + 0.5 - originZ) * scale
      ctx.strokeStyle = 'rgba(228, 177, 90, 0.95)'
      ctx.lineWidth = 1
      ctx.strokeRect(sx - 5, sz - 5, 10, 10)
    }
    for (const cell of preview) {
      const sx = (cell.x - originX) * scale
      const sz = (cell.z - originZ) * scale
      ctx.fillStyle = COLORS[cell.name] || '#d7a15e'
      ctx.globalAlpha = 0.72
      ctx.fillRect(sx, sz, Math.max(scale, 1), Math.max(scale, 1))
      ctx.globalAlpha = 1
    }
    for (const path of paths) {
      ctx.strokeStyle = path.id === activeId ? '#e4b15a' : '#3dbea5'
      ctx.lineWidth = 2
      ctx.beginPath()
      path.points.forEach((point, index) => {
        const sx = (point.x - originX + 0.5) * scale
        const sz = (point.z - originZ + 0.5) * scale
        if (index === 0) ctx.moveTo(sx, sz)
        else ctx.lineTo(sx, sz)
      })
      ctx.stroke()
      for (const point of path.points) {
        const sx = (point.x - originX + 0.5) * scale
        const sz = (point.z - originZ + 0.5) * scale
        ctx.fillStyle = path.id === activeId ? '#f4efe4' : '#3dbea5'
        ctx.beginPath()
        ctx.arc(sx, sz, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (visibleRef.current) {
      const visible = countVisible(canvas, view.current, maskRef.current)
      visibleRef.current.textContent = visible < 0 ? 'zoomed out' : `${visible} chunks in view`
    }
  }, [paths, activeId, preview, dim])

  paintRef.current = paint

  useLayoutEffect(() => {
    if (!world) return
    const canvas = canvasRef.current
    if (scaleFor.current !== world.info.path) {
      scaleFor.current = world.info.path
      const scale = canvas && canvas.clientWidth >= 8 ? detailScale(canvas.clientWidth, canvas.clientHeight) : 8
      view.current.scale = scale
      setZoom(scale)
    }
    pendingFocus.current = focusOf(world.info, dim)
    mapRef.current = null
    recentered.current = false
    if (canvas && canvas.clientWidth >= 8 && pendingFocus.current) {
      const focus = pendingFocus.current
      pendingFocus.current = null
      view.current.originX = focus.x - canvas.clientWidth / view.current.scale / 2
      view.current.originZ = focus.z - canvas.clientHeight / view.current.scale / 2
    }
    setMapPhase('loading')
    setMapMessage('Indexing regions…')
    paintRef.current()
  }, [world, dim])

  useEffect(() => { if (world) void sample() }, [sample, world])
  useEffect(() => { paint() }, [paint])

  useEffect(() => {
    if (!world || !window.mcpaths) return
    let cancel = false
    regionsReady.current = false
    window.mcpaths.regions(dim).then(result => {
      if (cancel) return
      if (!result.ok || !result.data) {
        regionsReady.current = true
        setMapPhase('error')
        setMapMessage(result.error || 'Could not read region files.')
        note(result.error || 'Could not read region files.', true)
        return
      }
      const list = result.data.map(mask => ({ rx: mask.rx, rz: mask.rz, present: bytesOf(mask.present) }))
      maskListRef.current = list
      const index = new Map<string, Uint8Array>()
      for (const mask of list) index.set(`${mask.rx},${mask.rz}`, mask.present)
      maskRef.current = index
      regionsReady.current = true
      paintRef.current()
      if (jumpToTerrain()) void sampleRef.current()
      else if (list.length === 0 && mapRef.current == null) {
        setMapPhase('empty')
        setMapMessage(emptyMessage(world, dim))
      }
    }).catch((error: unknown) => {
      if (cancel) return
      regionsReady.current = true
      const message = error instanceof Error ? error.message : 'Could not read region files.'
      setMapPhase('error')
      setMapMessage(message)
      note(message, true)
    })
    return () => { cancel = true }
  }, [world, dim, jumpToTerrain])

  useEffect(() => {
    if (!world) return
    const ready = paths.filter(path => path.points.length >= 2).map(path => ({
      name: path.name,
      points: path.points,
      preset: path.preset,
      options: path.options
    }))
    if (ready.length === 0) {
      setPreview([])
      return
    }
    const handle = window.setTimeout(() => {
      window.mcpaths.preview({ dim, paths: ready }).then(result => {
        if (result.ok) setPreview(result.data || [])
        else note(result.error || 'Preview failed.', true)
      }).catch((error: unknown) => {
        note(error instanceof Error ? error.message : 'Preview failed.', true)
      })
    }, 120)
    return () => window.clearTimeout(handle)
  }, [paths, dim, world])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => {
      if (pendingFocus.current && canvas.clientWidth >= 8) {
        const focus = pendingFocus.current
        pendingFocus.current = null
        view.current.originX = focus.x - canvas.clientWidth / view.current.scale / 2
        view.current.originZ = focus.z - canvas.clientHeight / view.current.scale / 2
      }
      paintRef.current()
      scheduleSample()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [scheduleSample, world, dim])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const prev = view.current.scale
      const next = clampScale(prev * (event.deltaY > 0 ? 0.9 : 1.12))
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const blockX = view.current.originX + px / prev
      const blockZ = view.current.originZ + py / prev
      view.current.scale = next
      view.current.originX = blockX - px / next
      view.current.originZ = blockZ - py / next
      setZoom(next)
      paintRef.current()
      scheduleSample()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [scheduleSample, world, dim])

  function applyScale(next: number) {
    const canvas = canvasRef.current
    const prev = view.current.scale
    const scale = clampScale(next)
    if (canvas) {
      const px = canvas.clientWidth / 2
      const py = canvas.clientHeight / 2
      const blockX = view.current.originX + px / prev
      const blockZ = view.current.originZ + py / prev
      view.current.originX = blockX - px / scale
      view.current.originZ = blockZ - py / scale
    }
    view.current.scale = scale
    setZoom(scale)
    paint()
    scheduleSample()
  }

  function toBlock(event: { clientX: number, clientY: number }): XZ {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.floor(view.current.originX + (event.clientX - rect.left) / view.current.scale),
      z: Math.floor(view.current.originZ + (event.clientY - rect.top) / view.current.scale)
    }
  }

  function writePointer(block: XZ | null) {
    const el = coordRef.current
    if (!el) return
    if (!block) {
      el.textContent = 'block —'
      return
    }
    const loc = addressOf(block.x, block.z)
    el.textContent = `block ${block.x}, ${block.z}    chunk ${loc.chunkX}, ${loc.chunkZ}    region ${loc.regionX}, ${loc.regionZ}`
  }

  function pointIndex(block: XZ): number {
    const path = paths.find(item => item.id === activeId)
    if (!path) return -1
    return path.points.findIndex(point => point.x === block.x && point.z === block.z)
  }

  function onDown(event: ReactMouseEvent) {
    if (!world) return
    const block = toBlock(event)
    writePointer(block)
    if (event.button === 2 || event.button === 1) {
      drag.current = { mode: 'pan', index: -1, sx: event.clientX, sy: event.clientY, ox: view.current.originX, oz: view.current.originZ }
      return
    }
    const index = pointIndex(block)
    if (index >= 0) {
      drag.current = { mode: 'point', index, sx: event.clientX, sy: event.clientY, ox: block.x, oz: block.z }
      return
    }
    const path = paths.find(item => item.id === activeId)
    if (path && !path.draft) {
      note('That path is finished. New path to draw another.')
      return
    }
    setPaths(list => list.map(item => item.id === activeId ? { ...item, points: [...item.points, block] } : item))
  }

  function onMove(event: ReactMouseEvent) {
    if (world) writePointer(toBlock(event))
    const current = drag.current
    if (!current) return
    if (current.mode === 'pan') {
      view.current.originX = current.ox - (event.clientX - current.sx) / view.current.scale
      view.current.originZ = current.oz - (event.clientY - current.sy) / view.current.scale
      paint()
      return
    }
    const block = toBlock(event)
    setPaths(list => list.map(path => {
      if (path.id !== activeId) return path
      const points = path.points.slice()
      points[current.index] = block
      return { ...path, points }
    }))
  }

  function onUp() {
    if (drag.current?.mode === 'pan') void sample()
    drag.current = null
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!worldRef.current) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const step = 80 / view.current.scale
        if (event.key === 'ArrowLeft') view.current.originX -= step
        if (event.key === 'ArrowRight') view.current.originX += step
        if (event.key === 'ArrowUp') view.current.originZ -= step
        if (event.key === 'ArrowDown') view.current.originZ += step
        paintRef.current()
        scheduleSample()
        return
      }
      if (event.key === 'Backspace' || (event.key === 'z' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault()
        setPaths(list => list.map(path => path.id === activeId ? { ...path, draft: true, points: path.points.slice(0, -1) } : path))
      } else if (event.key === 'Escape') {
        setPaths(list => list.map(path => path.id === activeId ? { ...path, draft: true, points: [] } : path))
        note('Cleared the points on this path.')
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        void apply()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const path = paths.find(item => item.id === activeId)
        if (!path || path.points.length < 2) {
          note('Add at least two points, then Enter finishes the spline.', true)
          return
        }
        setPaths(list => list.map(item => item.id === activeId ? { ...item, draft: false } : item))
        note(`${path.name} finished. Apply writes it, or start another path.`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, paths, dim, scheduleSample])

  async function apply() {
    if (busyRef.current) return
    const ready = paths.filter(path => path.points.length >= 2)
    if (ready.length === 0) {
      note('Draw at least two points before applying.', true)
      return
    }
    busyRef.current = true
    setBusy(true)
    note('Writing chunks…')
    try {
      const result = await window.mcpaths.apply({
        dim,
        paths: ready.map(path => ({ name: path.name, points: path.points, preset: path.preset, options: path.options }))
      })
      if (!result.ok) note(result.error || 'Apply failed.', true)
      else {
        note(`Wrote ${result.data?.chunks ?? 0} chunk${result.data?.chunks === 1 ? '' : 's'}. Backup: ${result.data?.backupDir ?? 'none'}`)
        void sample(true)
      }
    } catch (error) {
      note(error instanceof Error ? error.message : 'Apply failed.', true)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function openSave(save: SaveListing) {
    if (opening) return
    if (save.error) {
      note(save.error, true)
      return
    }
    setOpening(save.path)
    note(`Opening ${save.name}…`)
    try {
      const result = await window.mcpaths.openWorld(save.path)
      if (!result.ok || !result.data) note(result.error || 'That save could not be opened.', true)
      else openPayload(result.data)
    } catch (error) {
      note(error instanceof Error ? error.message : 'That save could not be opened.', true)
    } finally {
      setOpening(null)
    }
  }

  async function pickFolder() {
    if (opening) return
    setOpening('folder')
    note('Choose a world folder…')
    try {
      const result = await window.mcpaths.pickFolder()
      if (!result.ok) note(result.error || 'That folder could not be opened.', true)
      else if (result.data) openPayload(result.data)
      else note(saves.length ? 'Pick a save, or open a folder.' : 'No saves in the usual folders.')
    } catch (error) {
      note(error instanceof Error ? error.message : 'That folder could not be opened.', true)
    } finally {
      setOpening(null)
    }
  }

  function updateActive(patch: Partial<SurveyPath>) {
    setPaths(list => list.map(path => path.id === activeId ? { ...path, ...patch } : path))
  }

  function leaveWorld() {
    sampleSeq.current++
    worldRef.current = null
    mapRef.current = null
    setWorld(null)
    note(saves.length ? 'Pick a save, or open a folder.' : 'No saves in the usual folders.')
  }

  const active = paths.find(path => path.id === activeId) || null
  const showFloat = Boolean(world && (mapPhase !== 'ready' || mapMessage))
  const foundRoots = roots.filter(root => root.exists)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">MC Paths</div>
        {world ? (
          <>
            <button className="ghost" onClick={leaveWorld}>Saves</button>
            <div className="world-title" title={`${world.info.path}\n${world.info.versionName} · data ${world.info.dataVersion}`}>
              <strong>{world.info.name || world.info.folder}</strong>
              <span>{world.info.folder !== world.info.name ? world.info.folder : world.info.versionName}</span>
            </div>
            <div className="dims">
              {world.dimensions.map(item => (
                <button
                  key={item.id}
                  className={item.id === dim ? 'on' : ''}
                  onClick={() => { if (item.id !== dim) setDim(item.id) }}
                >{DIM_LABEL[item.id]}</button>
              ))}
            </div>
            <label className="zoom">
              <span>Zoom</span>
              <button type="button" className="icon" onClick={() => applyScale(zoom / 1.25)} aria-label="Zoom out">−</button>
              <input
                type="range"
                min={0.5}
                max={32}
                step={0.01}
                value={zoom}
                aria-label="Zoom"
                onChange={event => applyScale(Number(event.target.value))}
              />
              <button type="button" className="icon" onClick={() => applyScale(zoom * 1.25)} aria-label="Zoom in">+</button>
              <span className="zoom-read">{zoomLabel(zoom)}</span>
            </label>
          </>
        ) : (
          <>
            <p className="top-note">Draw a path into a Java world. Each edited region is copied into .mcpaths-backup first.</p>
            <button className="primary" disabled={opening !== null} onClick={() => void pickFolder()}>
              {opening === 'folder' ? 'Opening…' : 'Open folder'}
            </button>
          </>
        )}
      </header>
      <div className="workspace">
        {world ? (
          <>
            <div className="stage">
              <canvas
                ref={canvasRef}
                className="map"
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
                onMouseLeave={() => { onUp(); writePointer(null) }}
                onContextMenu={event => event.preventDefault()}
              />
              {showFloat && (
                <div className={`map-float${mapPhase === 'error' ? ' bad' : ''}`} role="status">
                  {mapPhase === 'loading' && <span className="spinner" aria-hidden="true" />}
                  <span>{mapMessage}</span>
                  {mapPhase === 'error' && (
                    <button type="button" onClick={() => void sample(true)}>Retry</button>
                  )}
                </div>
              )}
            </div>
            <aside className="dock">
              <div className="dock-scroll">
                <section className="panel">
                  <h2>Paths</h2>
                  <div className="paths">
                    {paths.map(path => (
                      <button key={path.id} className={path.id === activeId ? 'path on' : 'path'} onClick={() => setActiveId(path.id)}>
                        <span>{path.name}</span>
                        <small>{path.points.length} pts{path.draft ? '' : ' · finished'}</small>
                      </button>
                    ))}
                  </div>
                  <button className="ghost block" onClick={() => {
                    const next = newPath(`Path ${paths.length + 1}`)
                    setPaths(list => [...list, next])
                    setActiveId(next.id)
                  }}>New path</button>
                </section>
                {active && (
                  <section className="panel">
                    <h2>Preset</h2>
                    <div className="presets">
                      {PRESETS.map(preset => (
                        <button key={preset.id} className={active.preset === preset.id ? 'preset on' : 'preset'} onClick={() => updateActive({ preset: preset.id })}>
                          <Swatch preset={preset.id} />
                          <span>{preset.label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {active && (
                  <section className="panel">
                    <h2>Shape</h2>
                    <Options value={active.options} onChange={options => updateActive({ options })} />
                  </section>
                )}
              </div>
              <div className="dock-foot">
                <button className="primary block" disabled={busy || !active} onClick={() => void apply()}>
                  {busy ? 'Writing chunks…' : 'Apply path'}
                </button>
              </div>
            </aside>
          </>
        ) : (
          <div className="browser">
            <div className="browser-head">
              <h1>Worlds</h1>
              {listPhase === 'ready' && foundRoots.length > 0 && (
                <p className="roots">{foundRoots.map(root => root.path).join('  ·  ')}</p>
              )}
            </div>
            {listPhase === 'loading' && (
              <div className="empty">
                <span className="spinner" aria-hidden="true" />
                <h2>Reading saves…</h2>
                <p>Checking level.dat in the usual Minecraft folders.</p>
              </div>
            )}
            {listPhase === 'error' && (
              <div className="empty">
                <h2>Could not read saves</h2>
                <p className="bad-text">{status}</p>
                <button className="primary" onClick={loadSaves}>Retry</button>
              </div>
            )}
            {listPhase === 'ready' && saves.length === 0 && (
              <div className="empty">
                <h2>No saves found</h2>
                <p>Looked for a level.dat in:</p>
                <ul className="root-list">
                  {roots.map(root => (
                    <li key={root.path}>
                      <code>{root.path}</code>
                      <span>{root.exists ? 'empty' : 'not found'}</span>
                    </li>
                  ))}
                </ul>
                <button className="primary" disabled={opening !== null} onClick={() => void pickFolder()}>Open folder</button>
              </div>
            )}
            {listPhase === 'ready' && saves.length > 0 && (
              <div className="save-list">
                {saves.map(save => (
                  <button
                    key={save.path}
                    className={save.error ? 'save bad-save' : 'save'}
                    disabled={opening !== null}
                    onClick={() => void openSave(save)}
                  >
                    <span className="save-name">{opening === save.path ? `Opening ${save.name}…` : (save.name || save.folder || 'Untitled world')}</span>
                    <span className="save-folder">{save.folder}</span>
                    <span className="save-meta">{saveDetail(save)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="statusbar">
        <span ref={coordRef}>block —</span>
        <span ref={visibleRef} />
        {world && <span>{paths.length} paths · {active?.points.length ?? 0} pts</span>}
        <span className={bad ? 'message bad' : 'message'}>{status}</span>
        <span className="hints">
          {world
            ? <><kbd>right-drag</kbd> pan · <kbd>wheel</kbd> zoom · <kbd>Enter</kbd> finish · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> apply</>
            : 'Open a save to draw'}
        </span>
      </footer>
    </div>
  )
}

function newPath(name: string): SurveyPath {
  return { id: crypto.randomUUID(), name, points: [], preset: 'trail', options: { ...DEFAULT_OPTIONS }, draft: true }
}

function Swatch({ preset }: { preset: PresetId }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) paintSwatch(ref.current, preset) }, [preset])
  return <canvas ref={ref} width={88} height={36} />
}

function Options({ value, onChange }: { value: PathOptions, onChange: (value: PathOptions) => void }) {
  return (
    <div className="options">
      <Choice label="Width" value={value.width} options={[['narrow', 'Narrow 3'], ['normal', 'Normal 5'], ['wide', 'Wide 7']]} onChange={width => onChange({ ...value, width: width as PathOptions['width'] })} />
      <div className="diagrams">
        <Diagram on={value.hills === 'follow'} kind="follow" onClick={() => onChange({ ...value, hills: 'follow' })} />
        <Diagram on={value.hills === 'tunnel'} kind="tunnel" onClick={() => onChange({ ...value, hills: 'tunnel' })} />
        <Diagram on={value.water === 'bridge'} kind="bridge" onClick={() => onChange({ ...value, water: 'bridge' })} />
        <Diagram on={value.water === 'causeway'} kind="causeway" onClick={() => onChange({ ...value, water: 'causeway' })} />
      </div>
      <Choice label="Dressing" value={value.dressing} options={[['off', 'Off'], ['subtle', 'Subtle'], ['lined', 'Lined']]} onChange={dressing => onChange({ ...value, dressing: dressing as PathOptions['dressing'] })} />
    </div>
  )
}

function Choice({ label, value, options, onChange }: { label: string, value: string, options: [string, string][], onChange: (value: string) => void }) {
  return (
    <label className="field">{label}
      <div className="choice">
        {options.map(([id, text]) => (
          <button type="button" key={id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{text}</button>
        ))}
      </div>
    </label>
  )
}

function Diagram({ kind, on, onClick }: { kind: 'follow' | 'tunnel' | 'bridge' | 'causeway', on: boolean, onClick: () => void }) {
  const label = kind === 'follow' ? 'Follow' : kind === 'tunnel' ? 'Tunnel' : kind === 'bridge' ? 'Bridge' : 'Causeway'
  return (
    <button type="button" className={on ? 'diagram on' : 'diagram'} onClick={onClick}>
      <svg viewBox="0 0 80 40" aria-hidden="true">
        {kind === 'follow' && <polyline points="4,30 24,28 40,18 58,16 76,8" fill="none" stroke="#3dbea5" strokeWidth="3" />}
        {kind === 'tunnel' && <>
          <rect x="18" y="14" width="44" height="16" fill="#8d8d8d" />
          <rect x="22" y="18" width="36" height="8" fill="#1c2633" />
        </>}
        {kind === 'bridge' && <>
          <rect x="4" y="24" width="72" height="8" fill="#3d6ea8" />
          <rect x="10" y="16" width="60" height="4" fill="#c4a15a" />
          <rect x="16" y="20" width="3" height="8" fill="#8a6238" />
          <rect x="60" y="20" width="3" height="8" fill="#8a6238" />
        </>}
        {kind === 'causeway' && <>
          <rect x="4" y="22" width="72" height="10" fill="#3d6ea8" />
          <rect x="16" y="14" width="48" height="14" fill="#9a9a9a" />
        </>}
      </svg>
      <span className="diagram-label">{label}</span>
    </button>
  )
}

function focusOf(info: WorldPayload['info'], dim: Dimension): { x: number, z: number } {
  if (info.player && info.player.dimension === dim) {
    return { x: Math.floor(info.player.x), z: Math.floor(info.player.z) }
  }
  if (dim === 'overworld') return { x: info.spawn?.x ?? 0, z: info.spawn?.z ?? 0 }
  return { x: 0, z: 0 }
}

function emptyMessage(world: WorldPayload, dim: Dimension): string {
  const region = world.dimensions.find(item => item.id === dim)?.region
  return region ? `No region files in ${region}` : `No region files for the ${DIM_LABEL[dim]}.`
}

function detailScale(width: number, height: number): number {
  const across = width / (10 * 16)
  const down = height / (8 * 16)
  return clampScale(Math.max(across, down))
}

function clampScale(scale: number): number {
  return Math.min(32, Math.max(0.5, scale))
}

function zoomLabel(scale: number): string {
  const rounded = Math.round(scale * 10) / 10
  return Number.isInteger(rounded) ? `${rounded} px` : `${rounded.toFixed(1)} px`
}

function saveDetail(save: SaveListing): string {
  if (save.error) return save.error
  const bits: string[] = []
  if (save.versionName) bits.push(save.versionName)
  else if (save.label) bits.push(save.label)
  if (save.gameType) bits.push(GAME_LABEL[save.gameType] || save.gameType)
  const played = formatPlayed(save.lastPlayed)
  if (played) bits.push(played)
  if (save.dataVersion != null) bits.push(`data ${save.dataVersion}`)
  return bits.join(' · ')
}

function formatPlayed(ms: number | null): string | null {
  if (ms == null) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return Uint8Array.from(value)
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return Uint8Array.from((value as { data: number[] }).data)
  }
  return new Uint8Array()
}

function bitmapOf(rgb: Uint8Array, present: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const off = document.createElement('canvas')
  off.width = Math.max(1, width)
  off.height = Math.max(1, height)
  const ctx = off.getContext('2d')
  if (!ctx || width < 1 || height < 1) return off
  const pixels = new Uint8ClampedArray(width * height * 4)
  const count = Math.min(width * height, present.length, Math.floor(rgb.length / 3))
  for (let p = 0; p < count; p++) {
    const i = p * 3
    const j = p * 4
    pixels[j] = rgb[i] ?? 0
    pixels[j + 1] = rgb[i + 1] ?? 0
    pixels[j + 2] = rgb[i + 2] ?? 0
    pixels[j + 3] = present[p] ? 255 : 0
  }
  const image = ctx.createImageData(width, height)
  image.data.set(pixels)
  ctx.putImageData(image, 0, 0)
  return off
}

/** Same arithmetic as core/src/grid.ts. Negative blocks stay in the previous region. */
function addressOf(blockX: number, blockZ: number) {
  const chunkX = Math.floor(blockX / 16)
  const chunkZ = Math.floor(blockZ / 16)
  const regionX = Math.floor(chunkX / 32)
  const regionZ = Math.floor(chunkZ / 32)
  let localX = chunkX % 32
  let localZ = chunkZ % 32
  if (localX < 0) localX += 32
  if (localZ < 0) localZ += 32
  return { chunkX, chunkZ, regionX, regionZ, localX, localZ }
}

function bitSet(present: Uint8Array, index: number): boolean {
  return (present[index >> 3] & (1 << (index & 7))) !== 0
}

function viewHasChunks(
  canvas: HTMLCanvasElement,
  view: { originX: number, originZ: number, scale: number },
  masks: Map<string, Uint8Array>
): boolean {
  const bounds = viewChunkBounds(canvas, view)
  for (let rz = bounds.r0z; rz <= bounds.r1z; rz++) {
    for (let rx = bounds.r0x; rx <= bounds.r1x; rx++) {
      const present = masks.get(`${rx},${rz}`)
      if (!present) continue
      const lx0 = Math.max(0, bounds.c0x - rx * 32)
      const lx1 = Math.min(31, bounds.c1x - rx * 32)
      const lz0 = Math.max(0, bounds.c0z - rz * 32)
      const lz1 = Math.min(31, bounds.c1z - rz * 32)
      for (let lz = lz0; lz <= lz1; lz++) {
        for (let lx = lx0; lx <= lx1; lx++) {
          if (bitSet(present, (lz << 5) | lx)) return true
        }
      }
    }
  }
  return false
}

function countVisible(
  canvas: HTMLCanvasElement,
  view: { originX: number, originZ: number, scale: number },
  masks: Map<string, Uint8Array>
): number {
  const bounds = viewChunkBounds(canvas, view)
  if ((bounds.r1x - bounds.r0x + 1) * (bounds.r1z - bounds.r0z + 1) > 48) return -1
  let count = 0
  for (let rz = bounds.r0z; rz <= bounds.r1z; rz++) {
    for (let rx = bounds.r0x; rx <= bounds.r1x; rx++) {
      const present = masks.get(`${rx},${rz}`)
      if (!present) continue
      const lx0 = Math.max(0, bounds.c0x - rx * 32)
      const lx1 = Math.min(31, bounds.c1x - rx * 32)
      const lz0 = Math.max(0, bounds.c0z - rz * 32)
      const lz1 = Math.min(31, bounds.c1z - rz * 32)
      for (let lz = lz0; lz <= lz1; lz++) {
        for (let lx = lx0; lx <= lx1; lx++) {
          if (bitSet(present, (lz << 5) | lx)) count++
        }
      }
    }
  }
  return count
}

function viewChunkBounds(canvas: HTMLCanvasElement, view: { originX: number, originZ: number, scale: number }) {
  const maxX = view.originX + canvas.clientWidth / view.scale
  const maxZ = view.originZ + canvas.clientHeight / view.scale
  const c0x = Math.floor(view.originX / 16)
  const c1x = Math.floor(maxX / 16)
  const c0z = Math.floor(view.originZ / 16)
  const c1z = Math.floor(maxZ / 16)
  return {
    c0x, c1x, c0z, c1z,
    r0x: Math.floor(c0x / 32),
    r1x: Math.floor(c1x / 32),
    r0z: Math.floor(c0z / 32),
    r1z: Math.floor(c1z / 32)
  }
}

function nearestChunk(masks: { rx: number, rz: number, present: Uint8Array }[], x: number, z: number): { x: number, z: number } | null {
  let best: { x: number, z: number } | null = null
  let bestD = Infinity
  for (const mask of masks) {
    for (let i = 0; i < 1024; i++) {
      if (!bitSet(mask.present, i)) continue
      const cx = mask.rx * 32 + (i & 31)
      const cz = mask.rz * 32 + (i >> 5)
      const bx = cx * 16 + 8
      const bz = cz * 16 + 8
      const d = (bx - x) * (bx - x) + (bz - z) * (bz - z)
      if (d < bestD) {
        bestD = d
        best = { x: bx, z: bz }
      }
    }
  }
  return best
}

function drawFootprints(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  originX: number,
  originZ: number,
  scale: number,
  masks: Map<string, Uint8Array>
) {
  if (masks.size === 0) return
  const maxX = originX + cssW / scale
  const maxZ = originZ + cssH / scale
  const c0x = Math.floor(originX / 16)
  const c1x = Math.floor(maxX / 16)
  const c0z = Math.floor(originZ / 16)
  const c1z = Math.floor(maxZ / 16)
  const span = (c1x - c0x + 1) * (c1z - c0z + 1)
  ctx.fillStyle = '#24382f'
  if (span > 4000 || 16 * scale < 2) {
    const r0x = Math.floor(c0x / 32)
    const r1x = Math.floor(c1x / 32)
    const r0z = Math.floor(c0z / 32)
    const r1z = Math.floor(c1z / 32)
    for (let rz = r0z; rz <= r1z; rz++) {
      for (let rx = r0x; rx <= r1x; rx++) {
        if (!masks.has(`${rx},${rz}`)) continue
        const sx = (rx * 512 - originX) * scale
        const sz = (rz * 512 - originZ) * scale
        ctx.fillRect(sx, sz, 512 * scale, 512 * scale)
      }
    }
    return
  }
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const rx = Math.floor(cx / 32)
      const rz = Math.floor(cz / 32)
      const present = masks.get(`${rx},${rz}`)
      if (!present) continue
      let lx = cx % 32
      let lz = cz % 32
      if (lx < 0) lx += 32
      if (lz < 0) lz += 32
      if (!bitSet(present, (lz << 5) | lx)) continue
      ctx.fillRect((cx * 16 - originX) * scale, (cz * 16 - originZ) * scale, 16 * scale, 16 * scale)
    }
  }
}

function strokeGrid(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  originX: number,
  originZ: number,
  scale: number,
  step: number,
  color: string,
  width: number
) {
  const x1 = originX + cssW / scale
  const z1 = originZ + cssH / scale
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  for (let x = Math.floor(originX / step) * step; x <= x1; x += step) {
    const sx = Math.round((x - originX) * scale) + 0.5
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, cssH)
  }
  for (let z = Math.floor(originZ / step) * step; z <= z1; z += step) {
    const sz = Math.round((z - originZ) * scale) + 0.5
    ctx.moveTo(0, sz)
    ctx.lineTo(cssW, sz)
  }
  ctx.stroke()
}
