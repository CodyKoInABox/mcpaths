import { isAir, isHeadroom, isLeaves, isLog, isWater } from '../blocks'
import type { BridgeDesign } from './presets'

export interface BridgeColumn {
  x: number
  z: number
  role: 'center' | 'edge' | 'outer'
  along: number
  tx: number
  tz: number
}

interface Column {
  stamp: BridgeColumn
  waterY: number
}

interface Span {
  along: number
  columns: Column[]
}

type Put = (x: number, y: number, z: number, name: string, properties: Record<string, string>) => void

interface Reader {
  get(x: number, y: number, z: number): { name: string }
}

interface Bounds {
  minY: number
  maxY: number
}

const FENCE = { north: 'true', south: 'true', east: 'true', west: 'true' }
const POST = { axis: 'y' }

/** Designs replace the water columns only. Land keeps the path preset. */
export function placeBridge(
  view: Reader,
  columns: Column[],
  design: BridgeDesign,
  bounds: Bounds,
  put: Put,
  floors: { x: number, z: number, y: number }[]
) {
  for (const run of runs(columns)) {
    const mid = run[Math.floor(run.length / 2)].along
    const shelter = design === 'dock' && run.length >= 12
    for (const span of run) {
      const waterY = span.columns.reduce((max, column) => Math.max(max, column.waterY), span.columns[0].waterY)
      const deck = deckOf(design, waterY)
      const edges = edgeKeys(span.columns)
      const shelterHere = shelter && Math.abs(span.along - mid) <= 1
      for (const column of span.columns) {
        const stamp = column.stamp
        const onEdge = edges.has(`${stamp.x},${stamp.z}`)
        clearDeck(view, put, stamp.x, deck, stamp.z)
        if (design === 'dock') placeDock(view, put, stamp, bounds, waterY, deck, onEdge, shelterHere, span.along === mid)
        else if (design === 'timber') placeTimber(view, put, stamp, bounds, waterY, deck, onEdge)
        else if (design === 'arch') placeArch(view, put, stamp, bounds, waterY, deck, onEdge)
        else placeMasonry(view, put, stamp, bounds, waterY, deck, onEdge)
        floors.push({ x: stamp.x, z: stamp.z, y: deck })
      }
    }
  }
}

function deckOf(design: BridgeDesign, waterY: number): number {
  if (design === 'dock') return waterY + 1
  if (design === 'arch') return waterY + 6
  if (design === 'masonry') return waterY + 5
  return waterY + 4
}

function runs(columns: Column[]): Span[][] {
  const byAlong = new Map<number, Span>()
  for (const column of columns) {
    let span = byAlong.get(column.stamp.along)
    if (!span) {
      span = { along: column.stamp.along, columns: [] }
      byAlong.set(column.stamp.along, span)
    }
    span.columns.push(column)
  }
  const ordered = [...byAlong.values()].sort((a, b) => a.along - b.along)
  const out: Span[][] = []
  let run: Span[] = []
  let prev = Number.NEGATIVE_INFINITY
  for (const span of ordered) {
    if (run.length && span.along - prev > 2) {
      out.push(run)
      run = []
    }
    run.push(span)
    prev = span.along
  }
  if (run.length) out.push(run)
  return out
}

function rank(role: BridgeColumn['role']): number {
  if (role === 'outer') return 2
  if (role === 'edge') return 1
  return 0
}

/** Outermost water columns of this slice. A one-block channel has no separate rail. */
function edgeKeys(columns: Column[]): Set<string> {
  let max = 0
  for (const column of columns) max = Math.max(max, rank(column.stamp.role))
  const keys = new Set<string>()
  if (max === 0) return keys
  for (const column of columns) {
    if (rank(column.stamp.role) === max) keys.add(`${column.stamp.x},${column.stamp.z}`)
  }
  return keys
}

function pierDist(along: number, spacing: number): number {
  const mod = ((along % spacing) + spacing) % spacing
  return Math.min(mod, spacing - mod)
}

function bed(view: Reader, x: number, z: number, bounds: Bounds, waterY: number): number {
  let y = waterY
  while (y - 1 >= bounds.minY) {
    const name = view.get(x, y - 1, z).name
    if (name === 'bedrock') return y
    if (!isAir(name) && !isWater(name) && !isHeadroom(name) && !isLeaves(name) && !isLog(name)) return y - 1
    y--
  }
  return Math.max(bounds.minY, y)
}

function fill(put: Put, x: number, z: number, y0: number, y1: number, name: string, properties: Record<string, string>) {
  if (y1 < y0) return
  for (let y = y0; y <= y1; y++) put(x, y, z, name, properties)
}

function beamAxis(stamp: BridgeColumn): Record<string, string> {
  return { axis: Math.abs(stamp.tx) >= Math.abs(stamp.tz) ? 'x' : 'z' }
}

function clearDeck(view: Reader, put: Put, x: number, deck: number, z: number) {
  for (const above of [deck + 1, deck + 2]) {
    if (isHeadroom(view.get(x, above, z).name)) put(x, above, z, 'air', {})
  }
}

/** Low oak pier. Pilings in the water, rails and lanterns on the edges, a roof on a long run. */
function placeDock(
  view: Reader,
  put: Put,
  stamp: BridgeColumn,
  bounds: Bounds,
  waterY: number,
  deck: number,
  onEdge: boolean,
  shelterHere: boolean,
  shelterCenter: boolean
) {
  const slab = stamp.role === 'edge' && !onEdge
  put(stamp.x, deck, stamp.z, slab ? 'oak_slab' : 'oak_planks', slab ? { type: 'bottom' } : {})
  if (pierDist(stamp.along, 5) === 0) {
    fill(put, stamp.x, stamp.z, bed(view, stamp.x, stamp.z, bounds, waterY), deck - 1, 'oak_log', POST)
  }
  if (onEdge) {
    const top = shelterHere ? deck + 3 : deck + 1
    for (let y = deck + 1; y <= top; y++) put(stamp.x, y, stamp.z, 'oak_fence', FENCE)
    if (!shelterHere && stamp.along % 5 === 0) put(stamp.x, deck + 2, stamp.z, 'lantern', { hanging: 'false' })
  }
  if (shelterHere) put(stamp.x, deck + 4, stamp.z, 'oak_planks', {})
  if (shelterHere && shelterCenter && stamp.role === 'center') put(stamp.x, deck + 3, stamp.z, 'lantern', { hanging: 'true' })
}

/** Raised plank deck, log beam underneath, thick log piers on stone footings, open water between. */
function placeTimber(
  view: Reader,
  put: Put,
  stamp: BridgeColumn,
  bounds: Bounds,
  waterY: number,
  deck: number,
  onEdge: boolean
) {
  const dist = pierDist(stamp.along, 8)
  if (dist <= 1) {
    const bottom = bed(view, stamp.x, stamp.z, bounds, waterY)
    fill(put, stamp.x, stamp.z, bottom, waterY, 'stone_bricks', {})
    fill(put, stamp.x, stamp.z, waterY + 1, deck - 2, 'oak_log', POST)
  } else {
    for (let y = waterY + 1; y <= deck - 2; y++) put(stamp.x, y, stamp.z, 'air', {})
  }
  put(stamp.x, deck - 1, stamp.z, 'oak_log', beamAxis(stamp))
  put(stamp.x, deck, stamp.z, 'oak_planks', {})
  if (!onEdge) return
  put(stamp.x, deck + 1, stamp.z, 'oak_fence', FENCE)
  if (stamp.along % 6 === 0) put(stamp.x, deck + 2, stamp.z, 'lantern', { hanging: 'false' })
}

function carveArch(
  view: Reader,
  put: Put,
  stamp: BridgeColumn,
  bounds: Bounds,
  waterY: number,
  deck: number,
  rise: number
) {
  const dist = pierDist(stamp.along, 8)
  const bottom = bed(view, stamp.x, stamp.z, bounds, waterY)
  if (dist <= 1) {
    fill(put, stamp.x, stamp.z, bottom, deck - 1, 'stone_bricks', {})
    return
  }
  const t = Math.min(1, (dist - 1) / 3)
  const height = Math.max(1, Math.round(Math.sin(t * Math.PI / 2) * rise))
  const ring = waterY + height
  for (let y = waterY + 1; y < ring && y < deck; y++) put(stamp.x, y, stamp.z, 'air', {})
  fill(put, stamp.x, stamp.z, Math.min(ring, deck - 1), deck - 1, 'stone_bricks', {})
}

/** Stone-brick castle bridge. Crenels on the parapet. The arch is air, not a solid wall. */
function placeArch(
  view: Reader,
  put: Put,
  stamp: BridgeColumn,
  bounds: Bounds,
  waterY: number,
  deck: number,
  onEdge: boolean
) {
  carveArch(view, put, stamp, bounds, waterY, deck, 4)
  put(stamp.x, deck, stamp.z, 'stone_bricks', {})
  if (!onEdge) return
  put(stamp.x, deck + 1, stamp.z, 'stone_brick_wall', {})
  if (stamp.along % 2 === 0) put(stamp.x, deck + 2, stamp.z, 'stone_bricks', {})
}

/** Stone body and low parapets. Only the walking deck is path and sand. */
function placeMasonry(
  view: Reader,
  put: Put,
  stamp: BridgeColumn,
  bounds: Bounds,
  waterY: number,
  deck: number,
  onEdge: boolean
) {
  carveArch(view, put, stamp, bounds, waterY, deck, 3)
  if (onEdge) put(stamp.x, deck, stamp.z, 'stone_bricks', {})
  else if (stamp.role === 'center') put(stamp.x, deck, stamp.z, 'dirt_path', {})
  else put(stamp.x, deck, stamp.z, 'sand', {})
  if (!onEdge) return
  if (stamp.along % 6 === 0) {
    put(stamp.x, deck + 1, stamp.z, 'stone_bricks', {})
    put(stamp.x, deck + 2, stamp.z, 'stone_bricks', {})
    put(stamp.x, deck + 3, stamp.z, 'lantern', { hanging: 'false' })
    return
  }
  put(stamp.x, deck + 1, stamp.z, 'stone_brick_wall', {})
}
