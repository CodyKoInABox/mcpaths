import { colorFor, isAir, isMapDecoration } from './blocks'
import { describeState } from './codec'
import { regionOf } from './grid'
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

const CHUNK_BUDGET = 96
const MAX_EDGE = 512

const paintCache = new Map<number, [number, number, number] | 0 | 1>()

function paintOf(stateId: number): [number, number, number] | 0 | 1 {
  const cached = paintCache.get(stateId)
  if (cached !== undefined) return cached
  let paint: [number, number, number] | 0 | 1
  if (stateId === 0) paint = 0
  else {
    const name = describeState(stateId).name
    if (isAir(name)) paint = 0
    else if (isMapDecoration(name)) paint = 1
    else paint = colorFor(name)
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

/** Top-down colors for one chunk. Decoration blocks are skipped so the ground shows. */
export function renderSurface(column: any): Uint8Array {
  const rgb = new Uint8Array(16 * 16 * 3)
  const sections = (column.sections ?? []) as any[]
  const minY = (column.minY ?? 0) as number
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      let color: [number, number, number] | null = null
      let topY = minY
      for (let index = sections.length - 1; index >= 0; index--) {
        const section = sections[index]
        if (!section) continue
        if (typeof section.isEmpty === 'function' ? section.isEmpty() : section.solidBlockCount === 0) continue
        const data = section.data
        const y0 = minY + index * 16
        if (data && typeof data.value === 'number' && data.palette == null) {
          const paint = paintOf(data.value)
          if (paint === 0 || paint === 1) continue
          color = paint
          topY = y0 + 15
          break
        }
        let found = false
        for (let ly = 15; ly >= 0; ly--) {
          const stateId = typeof section.get === 'function'
            ? section.get({ x: lx, y: ly, z: lz })
            : column.getBlockStateId({ x: lx, y: y0 + ly, z: lz })
          const paint = paintOf(stateId)
          if (paint === 0 || paint === 1) continue
          color = paint
          topY = y0 + ly
          found = true
          break
        }
        if (found) break
      }
      const out = color ? shade(color, topY) : [20, 24, 32]
      const i = (lz * 16 + lx) * 3
      rgb[i] = out[0]
      rgb[i + 1] = out[1]
      rgb[i + 2] = out[2]
    }
  }
  return rgb
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
    throw new Error(`Map view is ${width}×${height} blocks. Zoom in so each sample stays within ${MAX_EDGE}.`)
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
  const truncated = wanted.length > CHUNK_BUDGET
  const chosen = wanted.slice(0, CHUNK_BUDGET)
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
  else if (truncated) warning = `Colored ${chosen.length} of ${wanted.length} chunks in view. Zoom in for the rest.`
  return { originX, originZ, width, height, rgb, present, chunks, failed, truncated, warning, aborted: false }
}
