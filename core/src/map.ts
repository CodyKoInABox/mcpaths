import { colorFor } from './blocks'
import type { Dimension } from './versions'
import type { World } from './world'

export interface MapSample {
  originX: number
  originZ: number
  width: number
  height: number
  /** RGB bytes, row-major, length width*height*3. */
  rgb: Uint8Array
}

export async function sampleMap(world: World, dim: Dimension, originX: number, originZ: number, width: number, height: number): Promise<MapSample> {
  await world.preload(dim, originX, originZ, originX + width - 1, originZ + height - 1)
  const rgb = new Uint8Array(width * height * 3)
  const missing: [number, number, number] = [18, 22, 26]
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const block = world.topBlock(dim, originX + x, originZ + z)
      const color = block.name === 'air' ? missing : colorFor(block.name)
      const i = (z * width + x) * 3
      rgb[i] = color[0]
      rgb[i + 1] = color[1]
      rgb[i + 2] = color[2]
    }
  }
  return { originX, originZ, width, height, rgb }
}
