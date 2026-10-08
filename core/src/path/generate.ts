import { isAir, isHeadroom, isLeaves, isLog, isWater } from '../blocks'
import { hash01, wanderedRadius } from './noise'
import {
  resolveMaterials,
  widthBlocks,
  type Materials,
  type NamedPath,
  type PathOptions
} from './presets'
import type { Sample } from './spline'
import { resample } from './spline'

export interface Placement {
  x: number
  y: number
  z: number
  name: string
  properties: Record<string, string>
}

export interface ColumnView {
  get(x: number, y: number, z: number): { name: string }
  biome(x: number, y: number, z: number): string
  protected(x: number, z: number): boolean
}

interface Ground {
  y: number
  name: string
}

interface Stamp {
  x: number
  z: number
  role: 'center' | 'edge' | 'outer'
  along: number
  tx: number
  tz: number
  pathY: number
  uphill: string | null
}

const ROLE = { outer: 1, edge: 2, center: 3 }

export function planPaths(view: ColumnView, paths: NamedPath[], bounds: { minY: number, maxY: number }): Placement[] {
  const cells = new Map<string, Placement>()
  const floors: { x: number, z: number, y: number }[] = []
  for (const path of paths) {
    if (path.points.length < 2) continue
    const samples = resample(path.points)
    if (samples.length === 0) continue
    const options = path.options
    const radius = (widthBlocks(options.width) - 1) / 2
    const sx = Math.round(samples[0].x)
    const sz = Math.round(samples[0].z)
    const start = ground(view, sx, sz, bounds)
    const biome = view.biome(sx, start?.y ?? bounds.minY, sz)
    const mats = resolveMaterials(path.preset, biome)
    if (options.hills === 'tunnel') tunnel(view, samples, radius, mats, options, bounds, cells, floors)
    else follow(view, samples, radius, mats, path.preset, options, bounds, cells, floors)
  }
  clearTrees(view, floors, bounds, cells)
  return [...cells.values()]
}

function ground(view: ColumnView, x: number, z: number, bounds: { minY: number, maxY: number }): Ground | null {
  for (let y = bounds.maxY; y >= bounds.minY; y--) {
    const name = view.get(x, y, z).name
    if (isAir(name) || isHeadroom(name) || isLeaves(name) || isLog(name)) continue
    return { y, name }
  }
  return null
}

function facing(dx: number, dz: number): string {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west'
  return dz > 0 ? 'south' : 'north'
}

function opposite(face: string): string {
  switch (face) {
    case 'north': return 'south'
    case 'south': return 'north'
    case 'east': return 'west'
    default: return 'east'
  }
}

function follow(
  view: ColumnView,
  samples: Sample[],
  radius: number,
  mats: Materials,
  preset: NamedPath['preset'],
  options: PathOptions,
  bounds: { minY: number, maxY: number },
  cells: Map<string, Placement>,
  floors: { x: number, z: number, y: number }[]
) {
  const stamps = new Map<string, Stamp>()
  samples.forEach((sample, index) => {
    const cx = Math.round(sample.x)
    const cz = Math.round(sample.z)
    const here = ground(view, cx, cz, bounds)
    if (!here) return
    const next = samples[index + 1]
    let uphill: string | null = null
    if (next && mats.stair) {
      const ahead = ground(view, Math.round(next.x), Math.round(next.z), bounds)
      if (ahead && ahead.y === here.y + 1) {
        uphill = opposite(facing(Math.round(next.x) - cx, Math.round(next.z) - cz))
      }
    }
    const reach = wanderedRadius(cx, cz, radius)
    const nx = -sample.tz
    const nz = sample.tx
    for (let offset = -reach; offset <= reach; offset++) {
      const x = Math.round(sample.x + nx * offset)
      const z = Math.round(sample.z + nz * offset)
      if (view.protected(x, z)) continue
      const dist = Math.abs(offset)
      const role = dist === 0 ? 'center' : dist >= radius ? 'outer' : 'edge'
      if (preset === 'trail' && role === 'outer' && hash01(x, z + 41) < 0.38) continue
      const key = `${x},${z}`
      const prev = stamps.get(key)
      if (prev && ROLE[prev.role] >= ROLE[role]) continue
      stamps.set(key, { x, z, role, along: sample.along, tx: sample.tx, tz: sample.tz, pathY: here.y, uphill: role === 'center' ? uphill : null })
    }
  })
  for (const stamp of stamps.values()) {
    const g = ground(view, stamp.x, stamp.z, bounds)
    if (!g) continue
    if (isWater(g.name)) {
      waterColumn(view, stamp, g, mats, options, bounds, cells, floors)
      continue
    }
    const alt = stamp.role === 'center' && hash01(stamp.x, stamp.z) < 0.15
    let name = stamp.role === 'center' ? (alt ? mats.centerAlt : mats.center) : stamp.role === 'edge' ? mats.border : mats.shoulder
    let y = g.y
    let properties: Record<string, string> = {}
    if (stamp.role !== 'center' && mats.slab && g.y === stamp.pathY - 1) {
      name = mats.slab
      properties = { type: 'bottom' }
      y = g.y
    } else if (stamp.role === 'center' && stamp.uphill && mats.stair) {
      name = mats.stair
      properties = { facing: stamp.uphill, half: 'bottom', shape: 'straight' }
      y = g.y
    }
    put(cells, stamp.x, y, stamp.z, name, properties)
    floors.push({ x: stamp.x, z: stamp.z, y })
    clearHeadroom(view, stamp.x, y, stamp.z, cells)
    if (name === 'dirt_path') solidUnder(view, stamp.x, y, stamp.z, 'dirt', cells)
    dress(stamp, y, mats, preset, options, cells)
  }
}

function waterColumn(
  view: ColumnView,
  stamp: Stamp,
  g: Ground,
  mats: Materials,
  options: PathOptions,
  bounds: { minY: number, maxY: number },
  cells: Map<string, Placement>,
  floors: { x: number, z: number, y: number }[]
) {
  const alt = stamp.role === 'center' && hash01(stamp.x, stamp.z) < 0.15
  const surface = stamp.role === 'center' ? (alt ? mats.centerAlt : mats.center) : stamp.role === 'edge' ? mats.border : mats.shoulder
  if (options.water === 'causeway') {
    let bottom = g.y
    while (bottom - 1 >= bounds.minY && isWater(view.get(stamp.x, bottom - 1, stamp.z).name)) bottom--
    for (let y = bottom; y <= g.y; y++) put(cells, stamp.x, y, stamp.z, mats.fill, {})
    put(cells, stamp.x, g.y + 1, stamp.z, surface, {})
    floors.push({ x: stamp.x, z: stamp.z, y: g.y + 1 })
    if (surface === 'dirt_path') solidUnder(view, stamp.x, g.y + 1, stamp.z, mats.fill, cells)
    return
  }
  const deck = g.y + 1
  put(cells, stamp.x, deck, stamp.z, surface, {})
  floors.push({ x: stamp.x, z: stamp.z, y: deck })
  if (surface === 'dirt_path') put(cells, stamp.x, g.y, stamp.z, 'dirt', {})
  if (stamp.role === 'center' && stamp.along % 4 === 0) {
    for (let y = deck - 1, left = 0; y >= bounds.minY && left < 24; y--, left++) {
      const name = view.get(stamp.x, y, stamp.z).name
      if (!isAir(name) && !isWater(name) && !isHeadroom(name)) break
      put(cells, stamp.x, y, stamp.z, mats.support, mats.support.endsWith('_fence') ? fenceProps() : {})
    }
  }
  if ((mats.railings || options.dressing !== 'off') && stamp.role === 'outer' && mats.fence) {
    put(cells, stamp.x, deck + 1, stamp.z, mats.fence, fenceProps())
  }
  clearHeadroom(view, stamp.x, deck, stamp.z, cells)
}

function tunnel(
  view: ColumnView,
  samples: Sample[],
  radius: number,
  mats: Materials,
  options: PathOptions,
  bounds: { minY: number, maxY: number },
  cells: Map<string, Placement>,
  floors: { x: number, z: number, y: number }[]
) {
  const grounds = samples.map(sample => ground(view, Math.round(sample.x), Math.round(sample.z), bounds)).filter((g): g is Ground => !!g && !isWater(g.name))
  if (grounds.length === 0) return
  const floorY = Math.min(...grounds.map(g => g.y))
  const last = samples[samples.length - 1].along
  for (const sample of samples) {
    const mouth = sample.along <= 2 || sample.along >= last - 2
    const airR = wanderedRadius(Math.round(sample.x), Math.round(sample.z), radius) + (mouth ? 1 : 0)
    const height = 3 + (mouth ? 1 : 0)
    const nx = -sample.tz
    const nz = sample.tx
    for (let offset = -(airR + 1); offset <= airR + 1; offset++) {
      const x = Math.round(sample.x + nx * offset)
      const z = Math.round(sample.z + nz * offset)
      if (view.protected(x, z)) continue
      const wall = Math.abs(offset) > airR
      if (wall) {
        for (let y = floorY; y <= floorY + height + 1; y++) put(cells, x, y, z, lineBlock(y), {})
      } else {
        for (let y = floorY + 1; y <= floorY + height; y++) put(cells, x, y, z, 'air', {})
        put(cells, x, floorY + height + 1, z, lineBlock(floorY + height + 1), {})
        const alt = offset === 0 && hash01(x, z) < 0.15
        const floor = alt ? mats.centerAlt : offset === 0 ? mats.center : Math.abs(offset) >= radius ? mats.shoulder : mats.border
        put(cells, x, floorY, z, floor, {})
        floors.push({ x, z, y: floorY })
        if (floor === 'dirt_path') solidUnder(view, x, floorY, z, 'dirt', cells)
      }
    }
    if (sample.along % 8 === 0) {
      const x = Math.round(sample.x)
      const z = Math.round(sample.z)
      if (!view.protected(x, z)) put(cells, x, floorY + 2, z, 'lantern', { hanging: 'true' })
    }
  }
}

function lineBlock(y: number): string {
  return y < 0 ? 'deepslate_bricks' : 'stone_bricks'
}

function dress(stamp: Stamp, y: number, mats: Materials, preset: NamedPath['preset'], options: PathOptions, cells: Map<string, Placement>) {
  if (options.dressing === 'off') return
  const lined = options.dressing === 'lined'
  if (mats.railings && stamp.role === 'outer' && mats.fence) {
    put(cells, stamp.x, y + 1, stamp.z, mats.fence, fenceProps())
    if (lined && stamp.along % 8 === 0) put(cells, stamp.x, y + 2, stamp.z, 'lantern', { hanging: 'false' })
    return
  }
  if (preset === 'cobble' && stamp.role === 'outer' && mats.fence) {
    const step = lined ? 8 : 16
    if (stamp.along % step === 0) {
      put(cells, stamp.x, y + 1, stamp.z, mats.fence, fenceProps())
      put(cells, stamp.x, y + 2, stamp.z, 'lantern', { hanging: 'false' })
    }
    return
  }
  if ((preset === 'trail' || preset === 'moss' || preset === 'adaptive') && stamp.role !== 'center') {
    const gate = lined ? 0.22 : 0.08
    if (hash01(stamp.x + 3, stamp.z + 11) < gate) {
      const plant = preset === 'moss' && hash01(stamp.x, stamp.z + 5) < 0.5 ? 'moss_carpet' : mats.flower
      put(cells, stamp.x, y + 1, stamp.z, plant, {})
    }
  }
}

function clearHeadroom(view: ColumnView, x: number, y: number, z: number, cells: Map<string, Placement>) {
  for (const above of [y + 1, y + 2]) {
    const name = view.get(x, above, z).name
    if (isHeadroom(name)) put(cells, x, above, z, 'air', {})
  }
}

function solidUnder(view: ColumnView, x: number, y: number, z: number, solid: string, cells: Map<string, Placement>) {
  const below = view.get(x, y - 1, z).name
  if (isAir(below) || isWater(below) || isHeadroom(below)) put(cells, x, y - 1, z, solid, {})
}

function clearTrees(
  view: ColumnView,
  floors: { x: number, z: number, y: number }[],
  bounds: { minY: number, maxY: number },
  cells: Map<string, Placement>
) {
  const seen = new Set<string>()
  for (const floor of floors) {
    const key = `${floor.x},${floor.z}`
    if (seen.has(key)) continue
    seen.add(key)
    if (view.protected(floor.x, floor.z)) continue
    let base = -1
    for (let y = floor.y; y <= Math.min(bounds.maxY, floor.y + 12); y++) {
      if (isLog(view.get(floor.x, y, floor.z).name)) {
        base = y
        break
      }
    }
    if (base < 0) continue
    for (let y = base; y <= Math.min(bounds.maxY, base + 16); y++) {
      if (isLog(view.get(floor.x, y, floor.z).name)) put(cells, floor.x, y, floor.z, 'air', {})
    }
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let y = base; y <= Math.min(bounds.maxY, base + 10); y++) {
          if (isLeaves(view.get(floor.x + dx, y, floor.z + dz).name)) put(cells, floor.x + dx, y, floor.z + dz, 'air', {})
        }
      }
    }
  }
}

function fenceProps(): Record<string, string> {
  return { north: 'true', south: 'true', east: 'true', west: 'true' }
}

function put(cells: Map<string, Placement>, x: number, y: number, z: number, name: string, properties: Record<string, string>) {
  cells.set(`${x},${y},${z}`, { x, y, z, name, properties })
}
