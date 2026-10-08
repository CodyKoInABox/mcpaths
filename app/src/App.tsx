import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { DETAIL_CHUNK_BUDGET, MAX_PIXELS_PER_BLOCK, MIN_PIXELS_PER_BLOCK, farPixelsPerBlock, sliderToZoom, zoomToSlider } from './lod'
import { scanViewport } from '../../core/src/viewscan'
import { paintSwatch } from './swatches'
import {
  DEFAULT_OPTIONS,
  PRESETS,
  type BridgeDesign,
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
  oak_planks: '#a67c52',
  oak_slab: '#a67c52',
  oak_log: '#6b5030',
  oak_fence: '#a67c52',
  sand: '#dbd3a2',
  lantern: '#f0c85a',
  stone_brick_wall: '#8d8d8d',
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

const PRESET_BLURB: Record<PresetId, string> = {
  trail: 'Dirt path down the middle, coarse dirt and rooted dirt on the sides. The outer edge skips some blocks so it looks worn.',
  cobble: 'Cobblestone center, stone brick edges, gravel shoulders. A one-block rise in the center becomes cobble stairs.',
  moss: 'Moss center and shoulders, rooted dirt edges. A one-block rise becomes mossy cobble stairs.',
  sandstone: 'Smooth sandstone center, cut sandstone edges, sand shoulders.',
  adaptive: 'Materials come from the biome under the first point only. Badlands are red sandstone, deserts sandstone, swamps and mangroves a boardwalk, jungles moss. Snowy, ice, frozen, and grove biomes are packed ice. Stony or jagged peaks and windswept hills are stone brick. Other forests, taiga, birch, and cherry are moss. Everywhere else is a trail.',
  boardwalk: 'Planks and fences in the wood of the biome under the first point (spruce, unless the biome names a tree). Fences stay even when dressing is off.'
}

const DRESSING_BLURB: Record<PathOptions['dressing'], string> = {
  off: 'No plants or lamp posts. A boardwalk still gets its fences.',
  subtle: 'A few plants on trail, moss, and adaptive edges. Cobble gets a lamp post about every 16 blocks.',
  lined: 'Denser plants. Cobble posts about every 8 blocks. Fences, including boardwalks, get a lantern every 8 blocks.'
}

const BRIDGE_LINES: { id: BridgeDesign, label: string, line: string }[] = [
  { id: 'dock', label: 'Dock', line: 'Low oak pier on the water: plank and slab deck, fence rails, lantern posts, and a roofed shelter on a long span.' },
  { id: 'timber', label: 'Timber', line: 'Raised oak deck on spaced log piers with stone footings, fence rails, and lanterns.' },
  { id: 'arch', label: 'Arch', line: 'Stone-brick deck, crenellated parapets, thick piers, and open arches down to the river bed.' },
  { id: 'masonry', label: 'Masonry', line: 'Stone-brick arches and low parapets, a sand path down the middle, lanterns on brick posts.' }
]

type MapPhase = 'loading' | 'ready' | 'empty' | 'error'
const TILE = 16
const TILE_BYTES = TILE * TILE * 3

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
  const [minZoom, setMinZoom] = useState(MIN_PIXELS_PER_BLOCK)
  const [mapPhase, setMapPhase] = useState<MapPhase>('loading')
  const [mapMessage, setMapMessage] = useState('Indexing regions…')
  const view = useRef({ originX: 0, originZ: 0, scale: 8 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef(new Map<string, Uint8Array>())
  const maskListRef = useRef<{ rx: number, rz: number, present: Uint8Array }[]>([])
  const tilesRef = useRef(new Map<string, HTMLCanvasElement>())
  const spanRef = useRef<{ w: number, h: number } | null>(null)
  const minZoomRef = useRef(MIN_PIXELS_PER_BLOCK)
  const applyScaleRef = useRef<(next: number) => void>(() => {})
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
  const previewSeq = useRef(0)
  const pathStore = useRef<Record<Dimension, SurveyPath[]>>({ overworld: [], nether: [], end: [] })
  const visibleChunks = useRef<{ cx: number, cz: number }[]>([])
  const dragPoints = useRef<XZ[] | null>(null)
  const stampRef = useRef({ w: 0, h: 0, data: new Uint32Array(0), stamp: 1 })
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
    tilesRef.current = new Map()
    spanRef.current = null
    minZoomRef.current = MIN_PIXELS_PER_BLOCK
    setMinZoom(MIN_PIXELS_PER_BLOCK)
    const start = startDimension(payload)
    pendingFocus.current = focusOf(payload.info, start)
    view.current.scale = 8
    setZoom(8)
    setWorld(payload)
    setDim(start)
    setMapPhase('loading')
    setMapMessage('Indexing regions…')
    const first = newPath('Path 1')
    pathStore.current = { overworld: [], nether: [], end: [] }
    pathStore.current[start] = [first]
    setPaths([first])
    setActiveId(first.id)
    setPreview([])
    const where = payload.info.player?.dimension === start ? 'at the player' : start === 'overworld' ? 'at spawn' : 'at the origin'
    note(`${payload.info.name} · ${payload.info.versionName} · data ${payload.info.dataVersion} · ${DIM_LABEL[start]} ${where}`)
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
    if (!window.mcpaths) return
    return window.mcpaths.onMapProgress(message => {
      if (busyRef.current && message) note(message)
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
    const stage = canvas
    const opened = current
    if (pendingFocus.current) {
      const focus = pendingFocus.current
      pendingFocus.current = null
      view.current.originX = focus.x - canvas.clientWidth / view.current.scale / 2
      view.current.originZ = focus.z - canvas.clientHeight / view.current.scale / 2
    }

    async function fillTiles(seq: number, passForce: boolean) {
      if (regionsReady.current && maskRef.current.size === 0) {
        setMapPhase('empty')
        setMapMessage(emptyMessage(opened, dim))
        paintRef.current()
        return
      }
      const scanned = scanViewport(
        view.current.originX,
        view.current.originZ,
        stage.clientWidth / view.current.scale,
        stage.clientHeight / view.current.scale,
        maskRef.current,
        maskListRef.current
      )
      const occupied = scanned.chunks
      visibleChunks.current = occupied
      const missing = occupied.filter(chunk => !tilesRef.current.has(tileKey(dim, chunk.cx, chunk.cz)))
      if (missing.length === 0) {
        if (seq !== sampleSeq.current) return
        if (!regionsReady.current && occupied.length === 0) {
          setMapPhase('loading')
          setMapMessage('Indexing regions…')
        } else if (occupied.length === 0 && jumpToTerrain()) {
          void sampleRef.current()
          return
        } else {
          setMapPhase('ready')
          setMapMessage('')
        }
        paintRef.current()
        return
      }
      const total = occupied.length
      let done = total - missing.length
      setMapPhase('loading')
      setMapMessage(`Rendering chunks ${done} / ${total}…`)
      paintRef.current()
      let live = true
      const off = window.mcpaths.onMapProgress(message => {
        if (live && seq === sampleSeq.current) setMapMessage(message)
      })
      try {
        const midCx = (view.current.originX + stage.clientWidth / view.current.scale / 2) / 16
        const midCz = (view.current.originZ + stage.clientHeight / view.current.scale / 2) / 16
        missing.sort((a, b) => {
          const da = (a.cx - midCx) ** 2 + (a.cz - midCz) ** 2
          const db = (b.cx - midCx) ** 2 + (b.cz - midCz) ** 2
          return da - db
        })
        let first = passForce
        let failed = 0
        for (let i = 0; i < missing.length; i += DETAIL_CHUNK_BUDGET) {
          if (seq !== sampleSeq.current || !worldRef.current) return
          setMapMessage(`Rendering chunks ${done} / ${total}…`)
          const result = await window.mcpaths.tiles({
            dim,
            chunks: missing.slice(i, i + DETAIL_CHUNK_BUDGET),
            force: first
          })
          first = false
          if (seq !== sampleSeq.current || !worldRef.current) return
          if (result.cancelled) return
          if (!result.ok || !result.data) {
            setMapPhase('error')
            setMapMessage(result.error || 'The map could not be read.')
            note(result.error || 'The map could not be read.', true)
            paintRef.current()
            return
          }
          const cx = numberList(result.data.cx)
          const cz = numberList(result.data.cz)
          const rgb = bytesOf(result.data.rgb)
          const count = Math.min(cx.length, cz.length, Math.floor(rgb.length / TILE_BYTES))
          for (let n = 0; n < count; n++) {
            tilesRef.current.set(tileKey(dim, cx[n] ?? 0, cz[n] ?? 0), tileCanvas(rgb, n * TILE_BYTES))
          }
          failed += result.data.failed || 0
          done += count
          paintRef.current()
          setMapMessage(`Rendering chunks ${Math.min(done, total)} / ${total}…`)
          await new Promise<void>(resolve => { window.setTimeout(resolve, 0) })
          if (seq !== sampleSeq.current || !worldRef.current) return
        }
        if (seq !== sampleSeq.current) return
        live = false
        if (failed > 0 && done === 0) {
          setMapPhase('error')
          setMapMessage('Region files could not be read.')
          note('Region files could not be read.', true)
          return
        }
        setMapPhase('ready')
        setMapMessage('')
        if (failed > 0) note(`${failed} chunk${failed === 1 ? '' : 's'} could not be read.`, true)
      } catch (error) {
        if (seq !== sampleSeq.current || !worldRef.current) return
        const message = error instanceof Error ? error.message : 'The map could not be read.'
        setMapPhase('error')
        setMapMessage(message)
        note(message, true)
        paintRef.current()
      } finally {
        off()
      }
    }

    const seq = ++sampleSeq.current
    if (force) tilesRef.current.clear()
    paintRef.current()
    await fillTiles(seq, force)
  }, [dim, jumpToTerrain])

  sampleRef.current = sample

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (cssW < 2 || cssH < 2) return
    const targetW = Math.max(1, Math.floor(cssW * dpr))
    const targetH = Math.max(1, Math.floor(cssH * dpr))
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#10161c'
    ctx.fillRect(0, 0, cssW, cssH)
    const scale = view.current.scale
    const originX = view.current.originX
    const originZ = view.current.originZ
    drawChunkList(ctx, cssW, cssH, originX, originZ, scale, visibleChunks.current, tilesRef.current, dim)
    if (16 * scale >= 8) strokeGrid(ctx, cssW, cssH, originX, originZ, scale, 16, 'rgba(232, 238, 246, 0.16)', 1)
    if (512 * scale >= 16) strokeGrid(ctx, cssW, cssH, originX, originZ, scale, 512, 'rgba(232, 238, 246, 0.28)', 1)
    const current = worldRef.current
    if (current && dim === 'overworld') {
      const sx = (current.info.spawn.x + 0.5 - originX) * scale
      const sz = (current.info.spawn.z + 0.5 - originZ) * scale
      ctx.strokeStyle = 'rgba(228, 177, 90, 0.95)'
      ctx.lineWidth = 1
      ctx.strokeRect(sx - 5, sz - 5, 10, 10)
    }
    drawPreview(ctx, cssW, cssH, originX, originZ, scale, preview, stampRef.current)
    for (const path of paths) {
      const points = path.id === activeId && dragPoints.current ? dragPoints.current : path.points
      ctx.strokeStyle = path.id === activeId ? '#e4b15a' : '#3dbea5'
      ctx.lineWidth = 2
      ctx.beginPath()
      points.forEach((point, index) => {
        const sx = (point.x - originX + 0.5) * scale
        const sz = (point.z - originZ + 0.5) * scale
        if (index === 0) ctx.moveTo(sx, sz)
        else ctx.lineTo(sx, sz)
      })
      ctx.stroke()
      for (const point of points) {
        const sx = (point.x - originX + 0.5) * scale
        const sz = (point.z - originZ + 0.5) * scale
        ctx.fillStyle = path.id === activeId ? '#f4efe4' : '#3dbea5'
        ctx.beginPath()
        ctx.arc(sx, sz, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (visibleRef.current) {
      visibleRef.current.textContent = `${visibleChunks.current.length} chunks in view`
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
    tilesRef.current = new Map()
    visibleChunks.current = []
    spanRef.current = null
    maskRef.current = new Map()
    maskListRef.current = []
    regionsReady.current = false
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
      spanRef.current = exploredSpan(list)
      refreshMinZoom()
      paintRef.current()
      if (jumpToTerrain()) void sampleRef.current()
      else if (list.length === 0 && tilesRef.current.size === 0) {
        setMapPhase('empty')
        setMapMessage(emptyMessage(world, dim))
      } else void sampleRef.current()
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
      options: withDesign(path.options)
    }))
    if (ready.length === 0) {
      setPreview([])
      return
    }
    const seq = ++previewSeq.current
    const handle = window.setTimeout(() => {
      window.mcpaths.preview({ dim, paths: ready }).then(result => {
        if (seq !== previewSeq.current || result.cancelled) return
        if (result.ok) setPreview(result.data || [])
        else note(result.error || 'Preview failed.', true)
      }).catch((error: unknown) => {
        if (seq !== previewSeq.current) return
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
      refreshMinZoom()
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
      const next = clampScale(prev * (event.deltaY > 0 ? 0.8 : 1.25), minZoomRef.current)
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
    const scale = clampScale(next, minZoomRef.current)
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

  applyScaleRef.current = applyScale

  function refreshMinZoom() {
    const canvas = canvasRef.current
    const width = canvas && canvas.clientWidth >= 8 ? canvas.clientWidth : 1000
    const height = canvas && canvas.clientHeight >= 8 ? canvas.clientHeight : 800
    const span = spanRef.current
    const next = span
      ? farPixelsPerBlock(width, height, span.w, span.h)
      : farPixelsPerBlock(width, height, 4096, 4096)
    minZoomRef.current = next
    setMinZoom(prev => prev === next ? prev : next)
    if (view.current.scale < next) {
      view.current.scale = next
      setZoom(next)
    }
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

  function hitPoint(event: { clientX: number, clientY: number }): number {
    const path = paths.find(item => item.id === activeId)
    const canvas = canvasRef.current
    if (!path || !canvas) return -1
    const rect = canvas.getBoundingClientRect()
    const scale = view.current.scale
    const grab = Math.max(12, scale * 0.55)
    let best = -1
    let bestD = grab * grab
    for (let index = 0; index < path.points.length; index++) {
      const point = path.points[index]
      const sx = rect.left + (point.x - view.current.originX + 0.5) * scale
      const sy = rect.top + (point.z - view.current.originZ + 0.5) * scale
      const d = (sx - event.clientX) ** 2 + (sy - event.clientY) ** 2
      if (d <= bestD) {
        bestD = d
        best = index
      }
    }
    return best
  }

  function onDown(event: ReactMouseEvent) {
    if (!world) return
    const block = toBlock(event)
    writePointer(block)
    if (event.button === 2 || event.button === 1) {
      drag.current = { mode: 'pan', index: -1, sx: event.clientX, sy: event.clientY, ox: view.current.originX, oz: view.current.originZ }
      return
    }
    const index = hitPoint(event)
    if (index >= 0) {
      drag.current = { mode: 'point', index, sx: event.clientX, sy: event.clientY, ox: block.x, oz: block.z }
      return
    }
    const path = paths.find(item => item.id === activeId)
    if (path && !path.draft) {
      note('This path is finished, so a click will not add a point. Drag a point, or choose Edit path.', true)
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
    const path = paths.find(item => item.id === activeId)
    if (!path || current.index < 0 || current.index >= path.points.length) return
    const points = (dragPoints.current ?? path.points).slice()
    points[current.index] = block
    dragPoints.current = points
    paint()
  }

  function onUp() {
    const current = drag.current
    const moved = dragPoints.current
    dragPoints.current = null
    if (current?.mode === 'point' && moved) {
      setPaths(list => list.map(path => path.id === activeId ? { ...path, points: moved } : path))
    }
    if (current?.mode === 'pan') void sample()
    drag.current = null
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!worldRef.current) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (event.key === '-' || event.key === '_' || event.key === '=' || event.key === '+') {
        event.preventDefault()
        const factor = event.key === '-' || event.key === '_' ? 1 / 1.25 : 1.25
        applyScaleRef.current(view.current.scale * factor)
        return
      }
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
        paths: ready.map(path => ({ name: path.name, points: path.points, preset: path.preset, options: withDesign(path.options) }))
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
    previewSeq.current++
    worldRef.current = null
    tilesRef.current = new Map()
    spanRef.current = null
    pathStore.current = { overworld: [], nether: [], end: [] }
    setPreview([])
    setPaths([])
    setActiveId(null)
    setWorld(null)
    note(saves.length ? 'Pick a save, or open a folder.' : 'No saves in the usual folders.')
  }

  function switchDim(next: Dimension) {
    if (next === dim) return
    pathStore.current[dim] = paths
    const stored = pathStore.current[next]
    if (stored && stored.length > 0) {
      setPaths(stored)
      setActiveId(stored[0].id)
    } else {
      const first = newPath('Path 1')
      pathStore.current[next] = [first]
      setPaths([first])
      setActiveId(first.id)
    }
    setPreview([])
    setDim(next)
    note(`Paths are kept per dimension. These points belong to the ${DIM_LABEL[next]}.`)
  }

  function toggleDraft() {
    const path = paths.find(item => item.id === activeId)
    if (!path) return
    if (path.draft && path.points.length < 2) {
      note('Add at least two points, then finish the path.', true)
      return
    }
    const finished = path.draft
    setPaths(list => list.map(item => item.id === activeId ? { ...item, draft: !item.draft } : item))
    note(finished
      ? `${path.name} is finished. Clicks no longer add points. Apply still writes it.`
      : `${path.name} can take new points again.`)
  }

  function undoPoint() {
    setPaths(list => list.map(path => path.id === activeId ? { ...path, draft: true, points: path.points.slice(0, -1) } : path))
  }

  function clearPoints() {
    setPaths(list => list.map(path => path.id === activeId ? { ...path, draft: true, points: [] } : path))
    note('Cleared the points on this path.')
  }

  function deletePath() {
    if (paths.length <= 1) return
    const list = paths.filter(path => path.id !== activeId)
    setPaths(list)
    setActiveId(list[0].id)
  }

  const active = paths.find(path => path.id === activeId) || null
  const readyCount = paths.filter(path => path.points.length >= 2).length
  const showFloat = Boolean(world && (mapPhase !== 'ready' || mapMessage))
  const foundRoots = roots.filter(root => root.exists)
  const presetLabel = (id: PresetId) => PRESETS.find(preset => preset.id === id)?.label ?? id

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">MC Paths</div>
        {world ? (
          <>
            <button className="ghost" onClick={leaveWorld}>Saves</button>
            <div className="world-title" title={`${world.info.path}\n${world.info.versionName} · data ${world.info.dataVersion}`}>
              <strong>{world.info.name || world.info.folder}</strong>
              <span>{world.info.versionName}{world.info.folder !== world.info.name ? ` · ${world.info.folder}` : ''}</span>
            </div>
            <div className="dims">
              {world.dimensions.map(item => (
                <button
                  key={item.id}
                  className={`${item.id === dim ? 'on' : ''}${item.hasFiles ? '' : ' empty'}`}
                  title={item.hasFiles ? `Show the ${DIM_LABEL[item.id]}` : `No region files for the ${DIM_LABEL[item.id]}`}
                  onClick={() => switchDim(item.id)}
                >{DIM_LABEL[item.id]}{item.hasFiles ? '' : ' · empty'}</button>
              ))}
            </div>
            <label className="zoom" title="Pixels used to draw one block. Scroll the map to zoom toward the cursor.">
              <span>Zoom</span>
              <button type="button" className="icon" onClick={() => applyScale(view.current.scale / 1.25)} aria-label="Zoom out">−</button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={zoomToSlider(zoom, minZoom, MAX_PIXELS_PER_BLOCK)}
                aria-label="Zoom"
                onChange={event => applyScale(sliderToZoom(Number(event.target.value), minZoomRef.current, MAX_PIXELS_PER_BLOCK))}
              />
              <button type="button" className="icon" onClick={() => applyScale(view.current.scale * 1.25)} aria-label="Zoom in">+</button>
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
              {mapPhase === 'ready' && active && active.points.length === 0 && (
                <div className="map-help">
                  <strong>Click the map to place points</strong>
                  <span>Two points define {active.name}. Drag a point to move it. Right-drag pans, the wheel zooms.</span>
                </div>
              )}
            </div>
            <aside className="dock">
              <div className="dock-scroll">
                <section className="panel">
                  <h2>Paths</h2>
                  <p className="hint">Each path keeps its own preset and shape. Apply writes every path in this dimension that has two or more points.</p>
                  <div className="paths">
                    {paths.map(path => (
                      <button key={path.id} className={path.id === activeId ? 'path on' : 'path'} onClick={() => setActiveId(path.id)}>
                        <span className="path-name">{path.name.trim() || 'Untitled'}</span>
                        <small>{path.points.length} {path.points.length === 1 ? 'point' : 'points'} · {presetLabel(path.preset)} · {path.draft ? 'drawing' : 'finished'}</small>
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
                    <h2>This path</h2>
                    <label className="field">Name
                      <input
                        className="text"
                        value={active.name}
                        maxLength={48}
                        aria-label="Path name"
                        onChange={event => updateActive({ name: event.target.value })}
                      />
                    </label>
                    <div className="row-actions">
                      <button type="button" onClick={toggleDraft} disabled={active.draft && active.points.length < 2} title="Finished paths ignore new clicks. Apply still writes them.">
                        {active.draft ? 'Finish path' : 'Edit path'}
                      </button>
                      <button type="button" onClick={undoPoint} disabled={active.points.length === 0} title="Remove the last point (Backspace)">Undo</button>
                      <button type="button" onClick={clearPoints} disabled={active.points.length === 0} title="Remove every point (Escape)">Clear</button>
                    </div>
                    <button type="button" className="ghost block" onClick={deletePath} disabled={paths.length <= 1} title={paths.length <= 1 ? 'The list always keeps one path. Clear removes its points.' : 'Remove this path from the list'}>
                      Delete path
                    </button>
                  </section>
                )}
                {active && (
                  <section className="panel">
                    <h2>Preset</h2>
                    <div className="presets">
                      {PRESETS.map(preset => (
                        <button key={preset.id} className={active.preset === preset.id ? 'preset on' : 'preset'} title={PRESET_BLURB[preset.id]} onClick={() => updateActive({ preset: preset.id })}>
                          <Swatch preset={preset.id} />
                          <span>{preset.label}</span>
                        </button>
                      ))}
                    </div>
                    <p className="hint">{PRESET_BLURB[active.preset]}</p>
                  </section>
                )}
                {active && (
                  <section className="panel">
                    <h2>Shape</h2>
                    <Options preset={active.preset} value={active.options} onChange={options => updateActive({ options })} />
                  </section>
                )}
              </div>
              <div className="dock-foot">
                <button className="primary block" disabled={busy || readyCount === 0} onClick={() => void apply()} title={readyCount === 0 ? 'Add at least two points on a path' : 'Backup each region, then write the paths'}>
                  {busy ? 'Writing chunks…' : readyCount > 1 ? `Apply ${readyCount} paths` : 'Apply path'}
                </button>
                <p className="hint">Close the world in Minecraft first. Copies each touched region into .mcpaths-backup, then edits blocks in place. Bedrock stays. A column with a chest, shulker, spawner, or any block entity is skipped. Lighting is cleared so Minecraft rebuilds it.</p>
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
        {world && <span>{DIM_LABEL[dim]} · {paths.length} {paths.length === 1 ? 'path' : 'paths'} · {active?.points.length ?? 0} {active?.points.length === 1 ? 'point' : 'points'}</span>}
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

function withDesign(options: PathOptions): PathOptions {
  if (options.design === 'dock' || options.design === 'timber' || options.design === 'arch' || options.design === 'masonry') return options
  return { ...options, design: 'timber' }
}

function Swatch({ preset }: { preset: PresetId }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) paintSwatch(ref.current, preset) }, [preset])
  return <canvas ref={ref} width={88} height={36} />
}

function Options({ preset, value, onChange }: { preset: PresetId, value: PathOptions, onChange: (value: PathOptions) => void }) {
  const tunnel = value.hills === 'tunnel'
  const designOff = tunnel || value.water !== 'bridge'
  const dressingOff = tunnel || preset === 'sandstone'
  const dressingHint = tunnel
    ? 'Not used while Tunnel is on. The tunnel already places stone lining and lanterns.'
    : preset === 'sandstone'
      ? 'Not used for Sandstone way. That preset has no plants or lamp posts.'
      : DRESSING_BLURB[value.dressing]
  const designHint = tunnel
    ? 'Not used while Tunnel is on. A tunnel skips water instead of crossing it.'
    : value.water !== 'bridge'
      ? 'Not used for a causeway. A causeway fills the water and paves the top with this preset.'
      : 'Only the water uses this. On land the path preset still applies, including its dressing.'
  const design = value.design ?? 'timber'
  return (
    <div className="options">
      <Choice
        label="Width"
        hint="How many blocks across, including the edges. The sides wander by one block."
        value={value.width}
        options={[['narrow', 'Narrow 3'], ['normal', 'Normal 5'], ['wide', 'Wide 7']]}
        onChange={width => onChange({ ...value, width: width as PathOptions['width'] })}
      />
      <fieldset className="group">
        <legend>Hills</legend>
        <p className="hint">Follow sits on the ground and climbs. Tunnel cuts a flat passage at the lowest dry ground, with stone brick walls and a lantern every 8 blocks.</p>
        <div className="diagrams">
          <Diagram on={value.hills === 'follow'} kind="follow" onClick={() => onChange({ ...value, hills: 'follow' })} />
          <Diagram on={value.hills === 'tunnel'} kind="tunnel" onClick={() => onChange({ ...value, hills: 'tunnel' })} />
        </div>
      </fieldset>
      <fieldset className={tunnel ? 'group is-idle' : 'group'}>
        <legend>Water</legend>
        <p className="hint">{tunnel
          ? 'Not used while Tunnel is on. A tunnel skips water instead of crossing it.'
          : 'Bridge uses the design below and only replaces water. Causeway fills the water and paves the top with this preset.'}</p>
        <div className="diagrams">
          <Diagram disabled={tunnel} on={value.water === 'bridge'} kind="bridge" onClick={() => onChange({ ...value, water: 'bridge' })} />
          <Diagram disabled={tunnel} on={value.water === 'causeway'} kind="causeway" onClick={() => onChange({ ...value, water: 'causeway' })} />
        </div>
        <div className={designOff && !tunnel ? 'designs is-idle' : 'designs'}>
          <p className="hint">{designHint}</p>
          {BRIDGE_LINES.map(item => (
            <button
              type="button"
              key={item.id}
              className={design === item.id ? 'on' : ''}
              disabled={designOff}
              onClick={() => onChange({ ...value, design: item.id })}
            >
              <strong>{item.label}</strong>
              <span>{item.line}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <Choice
        label="Dressing"
        hint={dressingHint}
        value={value.dressing}
        disabled={dressingOff}
        options={[['off', 'Off'], ['subtle', 'Subtle'], ['lined', 'Lined']]}
        onChange={dressing => onChange({ ...value, dressing: dressing as PathOptions['dressing'] })}
      />
    </div>
  )
}

function Choice({ label, hint, value, options, disabled, onChange }: { label: string, hint?: string, value: string, options: [string, string][], disabled?: boolean, onChange: (value: string) => void }) {
  return (
    <label className={disabled ? 'field is-idle' : 'field'}>{label}
      {hint && <span className="hint">{hint}</span>}
      <div className="choice">
        {options.map(([id, text]) => (
          <button type="button" key={id} className={value === id ? 'on' : ''} disabled={disabled} onClick={() => onChange(id)}>{text}</button>
        ))}
      </div>
    </label>
  )
}

function Diagram({ kind, on, disabled, onClick }: { kind: 'follow' | 'tunnel' | 'bridge' | 'causeway', on: boolean, disabled?: boolean, onClick: () => void }) {
  const label = kind === 'follow' ? 'Follow' : kind === 'tunnel' ? 'Tunnel' : kind === 'bridge' ? 'Bridge' : 'Causeway'
  const detail = kind === 'follow'
    ? 'Lay the path on the surface'
    : kind === 'tunnel'
      ? 'Cut a level passage through the hill'
      : kind === 'bridge'
        ? 'Cross on the design below'
        : 'Fill water, then pave'
  return (
    <button type="button" className={on ? 'diagram on' : 'diagram'} disabled={disabled} title={detail} onClick={onClick}>
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

function startDimension(payload: WorldPayload): Dimension {
  const playerDim = payload.info.player?.dimension
  if (playerDim && payload.dimensions.some(item => item.id === playerDim && item.hasFiles)) return playerDim
  if (payload.dimensions.some(item => item.id === 'overworld' && item.hasFiles)) return 'overworld'
  return payload.dimensions.find(item => item.hasFiles)?.id ?? 'overworld'
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
  return Math.min(MAX_PIXELS_PER_BLOCK, Math.max(2, Math.max(across, down)))
}

function clampScale(scale: number, min: number): number {
  return Math.min(MAX_PIXELS_PER_BLOCK, Math.max(min, scale))
}

function zoomLabel(scale: number): string {
  if (scale >= 10) return `${Math.round(scale)} px/block`
  if (scale >= 1) {
    const rounded = Math.round(scale * 10) / 10
    return Number.isInteger(rounded) ? `${rounded} px/block` : `${rounded.toFixed(1)} px/block`
  }
  if (scale >= 0.1) return `${scale.toFixed(2)} px/block`
  return `${scale.toFixed(3)} px/block`
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

function tileCanvas(rgb: Uint8Array, offset: number): HTMLCanvasElement {
  const off = document.createElement('canvas')
  off.width = TILE
  off.height = TILE
  const ctx = off.getContext('2d')
  if (!ctx) return off
  const pixels = new Uint8ClampedArray(TILE * TILE * 4)
  for (let p = 0; p < TILE * TILE; p++) {
    const i = offset + p * 3
    const j = p * 4
    pixels[j] = rgb[i] ?? 0
    pixels[j + 1] = rgb[i + 1] ?? 0
    pixels[j + 2] = rgb[i + 2] ?? 0
    pixels[j + 3] = 255
  }
  const image = ctx.createImageData(TILE, TILE)
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

function tileKey(dim: string, cx: number, cz: number): string {
  return `${dim}:${cx},${cz}`
}

function numberList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(item => Number(item))
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value as unknown as ArrayLike<number>)
  return []
}

function exploredSpan(list: { rx: number, rz: number, present: Uint8Array }[]): { w: number, h: number } | null {
  let minCX = Infinity
  let maxCX = -Infinity
  let minCZ = Infinity
  let maxCZ = -Infinity
  let any = false
  for (const mask of list) {
    for (let i = 0; i < 1024; i++) {
      if (!bitSet(mask.present, i)) continue
      any = true
      const cx = mask.rx * 32 + (i & 31)
      const cz = mask.rz * 32 + (i >> 5)
      if (cx < minCX) minCX = cx
      if (cx > maxCX) maxCX = cx
      if (cz < minCZ) minCZ = cz
      if (cz > maxCZ) maxCZ = cz
    }
  }
  if (!any) return null
  return { w: (maxCX - minCX + 1) * 16, h: (maxCZ - minCZ + 1) * 16 }
}


interface StampBuf { w: number, h: number, data: Uint32Array, stamp: number }


function drawChunkList(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  originX: number,
  originZ: number,
  scale: number,
  chunks: { cx: number, cz: number }[],
  tiles: Map<string, HTMLCanvasElement>,
  dim: string
) {
  const chunkPx = 16 * scale
  ctx.imageSmoothingEnabled = false
  for (const chunk of chunks) {
    const sx = (chunk.cx * 16 - originX) * scale
    const sz = (chunk.cz * 16 - originZ) * scale
    if (sx + chunkPx < 0 || sz + chunkPx < 0 || sx > cssW || sz > cssH) continue
    const tile = tiles.get(tileKey(dim, chunk.cx, chunk.cz))
    if (!tile) {
      ctx.fillStyle = '#24382f'
      ctx.fillRect(sx, sz, chunkPx, chunkPx)
      continue
    }
    ctx.drawImage(tile, sx, sz, chunkPx, chunkPx)
  }
}


function drawPreview(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  originX: number,
  originZ: number,
  scale: number,
  cells: { x: number, z: number, name: string }[],
  buf: StampBuf
) {
  if (cells.length === 0) return
  if (buf.w !== cssW || buf.h !== cssH) {
    buf.w = cssW
    buf.h = cssH
    buf.data = new Uint32Array(cssW * cssH)
    buf.stamp = 1
  }
  let stamp = buf.stamp + 1
  if (stamp >= 0xffffffff) {
    buf.data.fill(0)
    stamp = 1
  }
  buf.stamp = stamp
  const mark = scale < 2
  ctx.globalAlpha = 0.72
  for (const cell of cells) {
    const sx = (cell.x - originX) * scale
    const sz = (cell.z - originZ) * scale
    const size = Math.max(scale, 1)
    if (sx + size < 0 || sz + size < 0 || sx > cssW || sz > cssH) continue
    if (mark) {
      const px = sx | 0
      const py = sz | 0
      if (px < 0 || py < 0 || px >= cssW || py >= cssH) continue
      const i = py * cssW + px
      if (buf.data[i] === stamp) continue
      buf.data[i] = stamp
    }
    ctx.fillStyle = COLORS[cell.name] || '#d7a15e'
    ctx.fillRect(sx, sz, size, size)
  }
  ctx.globalAlpha = 1
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
