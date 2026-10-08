import { colorFor, isMapDecoration } from './blocks'
import { profileOf } from './codec'
import { paletteIds } from './columnscan'
import { regionOf } from './grid'
import { DETAIL_CHUNK_BUDGET } from './lod'
import type { Dimension } from './versions'
import type { LoadHooks, World } from './world'

export interface MapSample {
  originX: number
  originZ: number
  width: number
  height: number
  /** RGB bytes, row-major, length width*height*3. */
  rgb: Uint8Array
  /** 1 where `rgb` is a real sample. 0 leaves the footprint underneath. */
  present: Uint8Array
  chunks: number
  failed: number
  truncated: boolean
  warning?: string
  aborted?: boolean
}

const MAX_EDGE = 2048

const paintCache = new Map<number, [number, number, number] | 0 | 1>()

function paintOf(stateId: number): [number, number, number] | 0 | 1 {
  const cached = paintCache.get(stateId)
  if (cached !== undefined) return cached
  let paint: [number, number, number] | 0 | 1
  if (stateId === 0) paint = 0
  else {
    const profile = profileOf(stateId)
    if (profile.air) paint = 0
    else if (isMapDecoration(profile.name)) paint = 1
    else paint = colorFor(profile.name)
  }
  paintCache.set(stateId, paint)
  return paint
}

function shade(color: [number, number, number], y: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, (y - 80) / 80))
  const f = 1 + t * 0.22
  return [
    Math.max(0, Math.min(255, Math.round(color[0] * f))),
    Math.max(0, Math.min(255, Math.round(color[1] * f))),
    Math.max(0, Math.min(255, Math.round(color[2] * f)))
  ]
}

const VOID_COLOR: [number, number, number] = [20, 24, 32]

/** Surface color of one column. Walks section palettes / state ids. Skips air and plants. */
function columnColor(column: any, lx: number, lz: number): [number, number, number] {
  const sections = (column.sections ?? []) as any[]
  const minY = (column.minY ?? 0) as number
  for (let index = sections.length - 1; index >= 0; index--) {
    const section = sections[index]
    if (!section) continue
    if (typeof section.isEmpty === 'function' ? section.isEmpty() : section.solidBlockCount === 0) continue
    const data = section.data
    const ids = paletteIds(section)
    if (ids && ids.length > 0 && ids.every(id => {
      const paint = paintOf(id)
      return paint === 0 || paint === 1
    })) continue
    const y0 = minY + index * 16
    if (data && typeof data.value === 'number' && data.palette == null) {
      const paint = paintOf(data.value)
      if (paint === 0 || paint === 1) continue
      return shade(paint, y0 + 15)
    }
    for (let ly = 15; ly >= 0; ly--) {
      const stateId = typeof section.get === 'function'
        ? section.get({ x: lx, y: ly, z: lz })
        : column.getBlockStateId({ x: lx, y: y0 + ly, z: lz })
      const paint = paintOf(stateId)
      if (paint === 0 || paint === 1) continue
      return shade(paint, y0 + ly)
    }
  }
  return VOID_COLOR
}

/** Top-down colors for one chunk. Decoration blocks are skipped so the ground shows. */
export function renderSurface(column: any): Uint8Array {
  const rgb = new Uint8Array(16 * 16 * 3)
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const out = columnColor(column, lx, lz)
      const i = (lz * 16 + lx) * 3
      rgb[i] = out[0]
      rgb[i + 1] = out[1]
      rgb[i + 2] = out[2]
    }
  }
  return rgb
}

/** One texel per block column. Same buffer renderSurface writes. */
export const CHUNK_TILE = 16
export const CHUNK_TILE_BYTES = CHUNK_TILE * CHUNK_TILE * 3

export interface ChunkTiles {
  cx: number[]
  cz: number[]
  /** RGB, CHUNK_TILE_BYTES per chunk, same order as cx/cz. */
  rgb: Uint8Array
  failed: number
  aborted?: boolean
}

function solidTile(r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(CHUNK_TILE_BYTES)
  for (let i = 0; i < out.length; i += 3) {
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
  }
  return out
}

export async function sampleMap(
  world: World,
  dim: Dimension,
  originX: number,
  originZ: number,
  width: number,
  height: number,
  hooks?: LoadHooks
): Promise<MapSample> {
  if (!Number.isFinite(originX) || !Number.isFinite(originZ) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('The map view is not a valid block rectangle.')
  }
  if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) {
    throw new Error(`Map view is ${width}×${height} blocks, past the detail sampler limit of ${MAX_EDGE}.`)
  }
  const rgb = new Uint8Array(width * height * 3)
  const present = new Uint8Array(width * height)
  const c0x = Math.floor(originX / 16)
  const c1x = Math.floor((originX + width - 1) / 16)
  const c0z = Math.floor(originZ / 16)
  const c1z = Math.floor((originZ + height - 1) / 16)
  const midX = originX + width / 2
  const midZ = originZ + height / 2
  const wanted: { cx: number, cz: number, rx: number, rz: number, dist: number }[] = []
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const located = regionOf(cx, cz)
      const dx = cx * 16 + 8 - midX
      const dz = cz * 16 + 8 - midZ
      wanted.push({ cx, cz, rx: located.rx, rz: located.rz, dist: dx * dx + dz * dz })
    }
  }
  wanted.sort((a, b) => a.dist - b.dist)
  const truncated = wanted.length > DETAIL_CHUNK_BUDGET
  const chosen = wanted.slice(0, DETAIL_CHUNK_BUDGET)
  chosen.sort((a, b) => a.rx - b.rx || a.rz - b.rz || a.cx - b.cx || a.cz - b.cz)
  const chosenKeys = new Set(chosen.map(chunk => `${chunk.cx},${chunk.cz}`))
  await world.preloadChunks(dim, chosen, hooks)
  if (hooks?.cancelled?.()) {
    return { originX, originZ, width, height, rgb, present, chunks: 0, failed: 0, truncated, aborted: true }
  }
  hooks?.progress?.('Rendering chunks…')
  let chunks = 0
  let failed = 0
  let firstError = ''
  const seen = new Set<string>()
  for (let z = 0; z < height; z++) {
    if (hooks?.cancelled?.()) {
      return { originX, originZ, width, height, rgb, present, chunks, failed, truncated, aborted: true }
    }
    for (let x = 0; x < width; x++) {
      const bx = originX + x
      const bz = originZ + z
      const cx = Math.floor(bx / 16)
      const cz = Math.floor(bz / 16)
      const key = `${cx},${cz}`
      const pi = z * width + x
      if (!chosenKeys.has(key)) continue
      const error = world.chunkError(dim, cx, cz)
      const i = pi * 3
      if (error) {
        if (!seen.has(key)) {
          seen.add(key)
          failed++
          if (!firstError) firstError = error
        }
        present[pi] = 1
        rgb[i] = 140
        rgb[i + 1] = 72
        rgb[i + 2] = 72
        continue
      }
      let tile = world.cachedSurface(dim, cx, cz)
      if (!tile) {
        const column = world.columnOf(dim, cx, cz)
        if (!column) continue
        tile = renderSurface(column)
        world.cacheSurface(dim, cx, cz, tile)
      }
      if (!seen.has(key)) {
        seen.add(key)
        chunks++
      }
      const lx = bx - cx * 16
      const lz = bz - cz * 16
      const ti = (lz * 16 + lx) * 3
      rgb[i] = tile[ti] ?? 0
      rgb[i + 1] = tile[ti + 1] ?? 0
      rgb[i + 2] = tile[ti + 2] ?? 0
      present[pi] = 1
    }
  }
  let warning: string | undefined
  if (failed > 0) warning = `${failed} chunk${failed === 1 ? '' : 's'} could not be read. ${firstError}`
  return { originX, originZ, width, height, rgb, present, chunks, failed, truncated, warning, aborted: false }
}

export interface TileHooks extends LoadHooks {
  /** Drop clean columns after the surface tile is cached so a large map does not keep every chunk decoded. */
  release?: boolean
}

/** One 16×16 image per chunk, one texel per block. A bad chunk is red and does not drop the rest. */
export async function sampleTiles(
  world: World,
  dim: Dimension,
  chunks: { cx: number, cz: number }[],
  hooks?: TileHooks
): Promise<ChunkTiles> {
  const ordered = chunks.slice().sort((a, b) => {
    const ar = regionOf(a.cx, a.cz)
    const br = regionOf(b.cx, b.cz)
    return ar.rx - br.rx || ar.rz - br.rz || a.cx - b.cx || a.cz - b.cz
  })
  const missing: { cx: number, cz: number }[] = []
  for (const chunk of ordered) {
    if (world.chunkError(dim, chunk.cx, chunk.cz)) continue
    if (world.cachedSurface(dim, chunk.cx, chunk.cz)) continue
    if (world.columnOf(dim, chunk.cx, chunk.cz)) continue
    missing.push(chunk)
  }
  if (missing.length) {
    hooks?.progress?.('Rendering chunks…')
    await world.preloadChunks(dim, missing, hooks)
  }
  if (hooks?.cancelled?.()) {
    return { cx: [], cz: [], rgb: new Uint8Array(), failed: 0, aborted: true }
  }
  const cx: number[] = []
  const cz: number[] = []
  const rgb = new Uint8Array(ordered.length * CHUNK_TILE_BYTES)
  let failed = 0
  let colored = 0
  for (const chunk of ordered) {
    if (hooks?.cancelled?.()) {
      return { cx, cz, rgb: rgb.subarray(0, cx.length * CHUNK_TILE_BYTES), failed, aborted: true }
    }
    const offset = cx.length * CHUNK_TILE_BYTES
    cx.push(chunk.cx)
    cz.push(chunk.cz)
    let tile = world.cachedSurface(dim, chunk.cx, chunk.cz)
    if (!tile) {
      const error = world.chunkError(dim, chunk.cx, chunk.cz)
      if (error) {
        failed++
        tile = solidTile(140, 72, 72)
      } else {
        const column = world.columnOf(dim, chunk.cx, chunk.cz)
        tile = column ? renderSurface(column) : solidTile(VOID_COLOR[0], VOID_COLOR[1], VOID_COLOR[2])
      }
      world.cacheSurface(dim, chunk.cx, chunk.cz, tile)
    }
    rgb.set(tile.subarray(0, CHUNK_TILE_BYTES), offset)
    if (hooks?.release) world.releaseColumn(dim, chunk.cx, chunk.cz)
    colored++
    if (colored % 16 === 0) hooks?.progress?.(`Rendering chunks ${colored}…`)
  }
  return { cx, cz, rgb: rgb.subarray(0, cx.length * CHUNK_TILE_BYTES), failed, aborted: false }
}
