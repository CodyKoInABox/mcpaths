/** Chunk and region coordinates. Negative blocks stay in the correct region file. */

export interface GridAddress {
  chunkX: number
  chunkZ: number
  regionX: number
  regionZ: number
  localX: number
  localZ: number
}

export function gridAddress(blockX: number, blockZ: number): GridAddress {
  const chunkX = Math.floor(blockX / 16)
  const chunkZ = Math.floor(blockZ / 16)
  const located = regionOf(chunkX, chunkZ)
  return {
    chunkX,
    chunkZ,
    regionX: located.rx,
    regionZ: located.rz,
    localX: located.lx,
    localZ: located.lz
  }
}

export function regionOf(chunkX: number, chunkZ: number): { rx: number, rz: number, lx: number, lz: number } {
  const rx = Math.floor(chunkX / 32)
  const rz = Math.floor(chunkZ / 32)
  let lx = chunkX % 32
  let lz = chunkZ % 32
  if (lx < 0) lx += 32
  if (lz < 0) lz += 32
  return { rx, rz, lx, lz }
}
