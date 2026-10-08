import nbt from 'prismarine-nbt'
import type { StateProfile } from './codec'

const BitArray = require('prismarine-chunk/src/pc/common/BitArrayNoSpan')

/** 1.18+ heightmaps: 256 values, 9 bits each, not packed across longs. */
export function packHeightmap(values: ArrayLike<number>): [number, number][] {
  const bits = new BitArray({ bitsPerValue: 9, capacity: 256 })
  for (let i = 0; i < 256; i++) bits.set(i, values[i] ?? 0)
  return bits.toLongArray()
}

export interface HeightColumns {
  surface: Int16Array
  motion: Int16Array
  motionNoLeaves: Int16Array
}

function paletteIds(section: any): number[] | null {
  const data = section?.data
  if (!data) return null
  if (typeof data.value === 'number' && data.palette == null) return [data.value]
  if (Array.isArray(data.palette)) return data.palette
  return null
}

function sectionEmpty(section: any): boolean {
  if (!section) return true
  if (typeof section.isEmpty === 'function') return section.isEmpty()
  return section.solidBlockCount === 0
}

/**
 * WORLD_SURFACE / MOTION_BLOCKING / MOTION_BLOCKING_NO_LEAVES.
 * Walks section palettes and state ids. A uniform section is one sample.
 * Stops once every column has all three values, so stone under the surface is not visited.
 */
export function measureHeightmaps(column: any, profile: (stateId: number) => StateProfile): HeightColumns {
  const minY: number = column.minY
  const maxY: number = minY + column.worldHeight - 1
  const surface = new Int16Array(256)
  const motion = new Int16Array(256)
  const motionNoLeaves = new Int16Array(256)
  const sections = (column.sections ?? []) as any[]
  let open = 256
  for (let index = sections.length - 1; index >= 0 && open > 0; index--) {
    const section = sections[index]
    if (sectionEmpty(section)) continue
    const y0 = minY + index * 16
    const yTop = Math.min(15, maxY - y0)
    const yBot = Math.max(0, minY - y0)
    if (yTop < yBot) continue
    const ids = paletteIds(section)
    if (ids && ids.length === 1) {
      const kind = profile(ids[0])
      const yVal = y0 + yTop - minY + 1
      if (kind.air && !kind.solid) continue
      for (let i = 0; i < 256; i++) {
        if (surface[i] !== 0 && motion[i] !== 0 && motionNoLeaves[i] !== 0) continue
        const before = (surface[i] !== 0 ? 1 : 0) + (motion[i] !== 0 ? 1 : 0) + (motionNoLeaves[i] !== 0 ? 1 : 0)
        if (surface[i] === 0 && !kind.air) surface[i] = yVal
        if (motion[i] === 0 && kind.solid) motion[i] = yVal
        if (motionNoLeaves[i] === 0 && kind.solid && !kind.leaves) motionNoLeaves[i] = yVal
        const after = (surface[i] !== 0 ? 1 : 0) + (motion[i] !== 0 ? 1 : 0) + (motionNoLeaves[i] !== 0 ? 1 : 0)
        if (before < 3 && after === 3) open--
      }
      continue
    }
    for (let z = 0; z < 16 && open > 0; z++) {
      for (let x = 0; x < 16; x++) {
        const i = z * 16 + x
        if (surface[i] !== 0 && motion[i] !== 0 && motionNoLeaves[i] !== 0) continue
        for (let ly = yTop; ly >= yBot; ly--) {
          const kind = profile(section.get({ x, y: ly, z }))
          const yVal = y0 + ly - minY + 1
          if (surface[i] === 0 && !kind.air) surface[i] = yVal
          if (motion[i] === 0 && kind.solid) motion[i] = yVal
          if (motionNoLeaves[i] === 0 && kind.solid && !kind.leaves) motionNoLeaves[i] = yVal
          if (surface[i] !== 0 && motion[i] !== 0 && motionNoLeaves[i] !== 0) {
            open--
            break
          }
        }
      }
    }
  }
  return { surface, motion, motionNoLeaves }
}

export function updateHeightmaps(chunkTag: any, column: any, profile: (stateId: number) => StateProfile) {
  const measured = measureHeightmaps(column, profile)
  if (!chunkTag.value.Heightmaps) chunkTag.value.Heightmaps = nbt.comp({})
  const maps = chunkTag.value.Heightmaps.value
  const pack = (values: Int16Array) => nbt.longArray(packHeightmap(values) as unknown as number[])
  maps.WORLD_SURFACE = pack(measured.surface)
  maps.MOTION_BLOCKING = pack(measured.motion)
  maps.MOTION_BLOCKING_NO_LEAVES = pack(measured.motionNoLeaves)
}
