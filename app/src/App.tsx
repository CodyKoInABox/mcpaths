import { useCallback, useEffect, useRef, useState } from 'react'
import { paintSwatch } from './swatches'
import { DEFAULT_OPTIONS, PRESETS, type Dimension, type PathOptions, type PresetId, type SurveyPath, type WorldPayload, type XZ } from './types'

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

export function App() {
  const [saves, setSaves] = useState<WorldPayload['info'][]>([])
  const [world, setWorld] = useState<WorldPayload | null>(null)
  const [dim, setDim] = useState<Dimension>('overworld')
  const [status, setStatus] = useState('Looking for saves…')
  const [bad, setBad] = useState(false)
  const [paths, setPaths] = useState<SurveyPath[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ x: number, z: number, name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const view = useRef({ originX: 0, originZ: 0, scale: 6 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<{ rgb: Uint8ClampedArray, width: number, height: number, originX: number, originZ: number } | null>(null)
  const drag = useRef<{ mode: 'pan' | 'point', index: number, sx: number, sy: number, ox: number, oz: number } | null>(null)
  const sampleSeq = useRef(0)
  const paintRef = useRef<() => void>(() => {})
  const worldRef = useRef<WorldPayload | null>(null)
  const fittedKey = useRef<string | null>(null)

  const note = (message: string, isBad = false) => {
    setStatus(message)
    setBad(isBad)
  }

  const openPayload = (payload: WorldPayload) => {
    worldRef.current = payload
    setWorld(payload)
    setDim('overworld')
    fittedKey.current = null
    const first = newPath('Path 1')
    setPaths([first])
    setActiveId(first.id)
    note(`${payload.info.name} · Java ${payload.info.support.label} · data ${payload.info.dataVersion}`)
  }

  useEffect(() => {
    window.mcpaths.listSaves().then(result => {
      if (worldRef.current) {
        if (result.ok) setSaves(result.data || [])
        return
      }
      if (!result.ok) note(result.error || 'Could not list saves.', true)
      else {
        setSaves(result.data || [])
        note(result.data?.length ? 'Pick a save, or open a folder.' : 'No saves detected. Open a folder that contains level.dat.')
      }
    })
    const offOpen = window.mcpaths.onOpened(openPayload)
    const offStatus = window.mcpaths.onStatus(message => note(message, true))
    return () => { offOpen(); offStatus() }
  }, [])

  const sample = useCallback(async () => {
    const canvas = canvasRef.current
    if (!world || !canvas) return
    if (canvas.clientWidth < 8 || canvas.clientHeight < 8) return
    const seq = ++sampleSeq.current
    const key = `${world.info.path}:${dim}`
    if (fittedKey.current !== key) {
      const bounds = await window.mcpaths.bounds(dim)
      if (seq !== sampleSeq.current) return
      if (bounds.ok && bounds.data) {
        const box = bounds.data
        const blocksW = box.maxX - box.minX + 1
        const blocksH = box.maxZ - box.minZ + 1
        const pad = 32
        const fit = Math.min(
          (canvas.clientWidth - pad * 2) / blocksW,
          (canvas.clientHeight - pad * 2) / blocksH
        )
        view.current.scale = Math.min(40, Math.max(2, fit))
        const midX = (box.minX + box.maxX + 1) / 2
        const midZ = (box.minZ + box.maxZ + 1) / 2
        view.current.originX = midX - canvas.clientWidth / view.current.scale / 2
        view.current.originZ = midZ - canvas.clientHeight / view.current.scale / 2
      }
      fittedKey.current = key
    }
    const width = Math.max(8, Math.ceil(canvas.clientWidth / view.current.scale))
    const height = Math.max(8, Math.ceil(canvas.clientHeight / view.current.scale))
    const result = await window.mcpaths.sample({
      dim,
      originX: Math.floor(view.current.originX),
      originZ: Math.floor(view.current.originZ),
      width,
      height
    })
    if (seq !== sampleSeq.current) return
    if (!result.ok || !result.data) {
      note(result.error || 'The map could not be read.', true)
      return
    }
    mapRef.current = {
      rgb: Uint8ClampedArray.from(result.data.rgb),
      width: result.data.width,
      height: result.data.height,
      originX: result.data.originX,
      originZ: result.data.originZ
    }
    paintRef.current()
  }, [world, dim])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const map = mapRef.current
    if (!canvas || !map) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(canvas.clientWidth * dpr)
    canvas.height = Math.floor(canvas.clientHeight * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const pixels = new Uint8ClampedArray(map.width * map.height * 4)
    const src = map.rgb
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      pixels[j] = src[i] ?? 0
      pixels[j + 1] = src[i + 1] ?? 0
      pixels[j + 2] = src[i + 2] ?? 0
      pixels[j + 3] = 255
    }
    const image = ctx.createImageData(map.width, map.height)
    image.data.set(pixels)
    const off = document.createElement('canvas')
    off.width = map.width
    off.height = map.height
    off.getContext('2d')?.putImageData(image, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#0c1014'
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    const scale = view.current.scale
    const originX = view.current.originX
    const originZ = view.current.originZ
    ctx.drawImage(
      off,
      (map.originX - originX) * scale,
      (map.originZ - originZ) * scale,
      map.width * scale,
      map.height * scale
    )
    for (const cell of preview) {
      const sx = (cell.x - originX) * scale
      const sz = (cell.z - originZ) * scale
      ctx.fillStyle = COLORS[cell.name] || '#d7a15e'
      ctx.globalAlpha = 0.72
      ctx.fillRect(sx, sz, scale, scale)
      ctx.globalAlpha = 1
    }
    const active = paths.find(path => path.id === activeId)
    for (const path of paths) {
      ctx.strokeStyle = path.id === activeId ? '#d7a15e' : '#2f7d68'
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
        ctx.fillStyle = path.id === activeId ? '#f3ead7' : '#2f7d68'
        ctx.beginPath()
        ctx.arc(sx, sz, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    void active
  }, [paths, activeId, preview])

  paintRef.current = paint

  useEffect(() => { void sample() }, [sample])
  useEffect(() => { paint() }, [paint])

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
      })
    }, 120)
    return () => window.clearTimeout(handle)
  }, [paths, dim, world])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => { void sample() })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [sample, world])

  function toBlock(event: React.MouseEvent): XZ {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.floor(view.current.originX + (event.clientX - rect.left) / view.current.scale),
      z: Math.floor(view.current.originZ + (event.clientY - rect.top) / view.current.scale)
    }
  }

  function pointIndex(block: XZ): number {
    const path = paths.find(item => item.id === activeId)
    if (!path) return -1
    return path.points.findIndex(point => Math.abs(point.x - block.x) <= 0 && Math.abs(point.z - block.z) <= 0)
  }

  function onDown(event: React.MouseEvent) {
    if (!world) return
    const block = toBlock(event)
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

  function onMove(event: React.MouseEvent) {
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

  function onWheel(event: React.WheelEvent) {
    event.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const prev = view.current.scale
    const next = Math.min(48, Math.max(2, prev * (event.deltaY > 0 ? 0.9 : 1.1)))
    const blockX = view.current.originX + px / prev
    const blockZ = view.current.originZ + py / prev
    view.current.scale = next
    view.current.originX = blockX - px / next
    view.current.originZ = blockZ - py / next
    void sample()
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!world) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
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
  }, [world, activeId, paths, dim])

  async function apply() {
    const ready = paths.filter(path => path.points.length >= 2)
    if (ready.length === 0) {
      note('Draw at least two points before applying.', true)
      return
    }
    setBusy(true)
    const result = await window.mcpaths.apply({
      dim,
      paths: ready.map(path => ({ name: path.name, points: path.points, preset: path.preset, options: path.options }))
    })
    setBusy(false)
    if (!result.ok) note(result.error || 'Apply failed.', true)
    else {
      note(`Wrote ${result.data?.chunks ?? 0} chunk${result.data?.chunks === 1 ? '' : 's'}. Backup: ${result.data?.backupDir ?? 'none'}`)
      void sample()
    }
  }

  function updateActive(patch: Partial<SurveyPath>) {
    setPaths(list => list.map(path => path.id === activeId ? { ...path, ...patch } : path))
  }

  const active = paths.find(path => path.id === activeId) || null
  const dimInfo = world?.dimensions.find(item => item.id === dim)

  if (!world) {
    return (
      <div className="home">
        <h1>MC Paths</h1>
        <p className="lede">Draw a path on a Java world. The save is edited in place, after a copy of each region file is stored under .mcpaths-backup.</p>
        <div className="row">
          <button className="copper" onClick={async () => {
            const result = await window.mcpaths.pickFolder()
            if (!result.ok) note(result.error || 'That folder could not be opened.', true)
            else if (result.data) openPayload(result.data)
          }}>Open folder</button>
        </div>
        <div className="save-list">
          {saves.map(save => (
            <button key={save.path} className="save" onClick={async () => {
              const result = await window.mcpaths.openWorld(save.path)
              if (!result.ok || !result.data) note(result.error || 'That save could not be opened.', true)
              else openPayload(result.data)
            }}>
              {save.name}
              <small>Java {save.support.label} · data {save.dataVersion}</small>
            </button>
          ))}
        </div>
        <div className={bad ? 'status bad' : 'status'}>{status}</div>
      </div>
    )
  }

  return (
    <div className="editor">
      <div className="topbar">
        <button className="ghost" onClick={() => {
          worldRef.current = null
          setWorld(null)
          note(saves.length ? 'Pick a save, or open a folder.' : 'No saves detected. Open a folder that contains level.dat.')
        }}>Saves</button>
        <strong>{world.info.name}</strong>
        <span>Java {world.info.support.label}</span>
        <div className="dims">
          {world.dimensions.map(item => (
            <button key={item.id} className={item.id === dim ? 'on' : ''} onClick={() => setDim(item.id)}>{item.id}</button>
          ))}
        </div>
      </div>
      <div className="map-wrap">
        <canvas
          ref={canvasRef}
          className="map"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onWheel={onWheel}
          onContextMenu={event => event.preventDefault()}
        />
      </div>
      <aside className="side">
        <div className="panel">
          <h2>Paths</h2>
          <div className="paths">
            {paths.map(path => (
              <button key={path.id} className={path.id === activeId ? 'path on' : 'path'} onClick={() => setActiveId(path.id)}>
                <span>{path.name}</span>
                <small>{path.points.length} pts{path.draft ? '' : ' · finished'}</small>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="ghost" onClick={() => {
              const next = newPath(`Path ${paths.length + 1}`)
              setPaths(list => [...list, next])
              setActiveId(next.id)
            }}>New path</button>
          </div>
        </div>
        {active && (
          <div className="panel preset-panel">
            <h2>Preset</h2>
            <div className="presets">
              {PRESETS.map(preset => (
                <button key={preset.id} className={active.preset === preset.id ? 'preset on' : 'preset'} onClick={() => updateActive({ preset: preset.id })}>
                  <Swatch preset={preset.id} />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {active && (
          <div className="dock">
            <div className="panel">
              <Options value={active.options} onChange={options => updateActive({ options })} />
            </div>
            <button className="copper" disabled={busy} onClick={() => void apply()}>{busy ? 'Writing…' : 'Apply'}</button>
          </div>
        )}
      </aside>
      <div className={bad ? 'statusbar bad' : 'statusbar'}>
        <span className="message" title={dimInfo && !dimInfo.hasFiles ? 'This dimension has no region files yet.' : status}>{dimInfo && !dimInfo.hasFiles ? 'This dimension has no region files yet.' : status}</span>
        <span className="hints"><kbd>Enter</kbd> finish · <kbd>Backspace</kbd> undo · <kbd>Esc</kbd> clear · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> apply · right-drag pan</span>
      </div>
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
    <div style={{ display: 'grid', gap: 8 }}>
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
        {kind === 'follow' && <polyline points="4,30 24,28 40,18 58,16 76,8" fill="none" stroke="#2f7d68" strokeWidth="3" />}
        {kind === 'tunnel' && <>
          <rect x="18" y="14" width="44" height="16" fill="#8d8d8d" />
          <rect x="22" y="18" width="36" height="8" fill="#f3ead7" />
        </>}
        {kind === 'bridge' && <>
          <rect x="4" y="24" width="72" height="8" fill="#6ea0d4" />
          <rect x="10" y="16" width="60" height="4" fill="#8a6238" />
          <rect x="16" y="20" width="3" height="8" fill="#5c4632" />
          <rect x="60" y="20" width="3" height="8" fill="#5c4632" />
        </>}
        {kind === 'causeway' && <>
          <rect x="4" y="22" width="72" height="10" fill="#6ea0d4" />
          <rect x="16" y="14" width="48" height="14" fill="#9a9a9a" />
        </>}
      </svg>
      <span className="diagram-label">{label}</span>
    </button>
  )
}
