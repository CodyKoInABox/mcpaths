import nbt from 'prismarine-nbt'
import { isAir, isLeaves } from './blocks'

const BitArray = require('prismarine-chunk/src/pc/common/BitArrayNoSpan')

/** 1.18+ heightmaps: 256 values, 9 bits each, not packed across longs. */
export function packHeightmap(values: number[]): [number, number][] {
  const bits = new BitArray({ bitsPerValue: 9, capacity: 256 })
  for (let i = 0; i < 256; i++) bits.set(i, values[i] ?? 0)
  return bits.toLongArray()
}

export function updateHeightmaps(chunkTag: any, column: any) {
  const minY: number = column.minY
  const maxY: number = minY + column.worldHeight - 1
  const surface = new Array<number>(256).fill(0)
  const motion = new Array<number>(256).fill(0)
  const motionNoLeaves = new Array<number>(256).fill(0)
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const index = z * 16 + x
      for (let y = maxY; y >= minY; y--) {
        const block = column.getBlock({ x, y, z })
        const name = block?.name || 'air'
        if (surface[index] === 0 && !isAir(name)) surface[index] = y - minY + 1
        const solid = block?.boundingBox === 'block'
        if (motion[index] === 0 && solid) motion[index] = y - minY + 1
        if (motionNoLeaves[index] === 0 && solid && !isLeaves(name)) motionNoLeaves[index] = y - minY + 1
        if (surface[index] && motion[index] && motionNoLeaves[index]) break
      }
    }
  }
  if (!chunkTag.value.Heightmaps) chunkTag.value.Heightmaps = nbt.comp({})
  const maps = chunkTag.value.Heightmaps.value
  const pack = (values: number[]) => nbt.longArray(packHeightmap(values) as unknown as number[])
  maps.WORLD_SURFACE = pack(surface)
  maps.MOTION_BLOCKING = pack(motion)
  maps.MOTION_BLOCKING_NO_LEAVES = pack(motionNoLeaves)
}
