import { isProtectedName } from './blocks'
import { dimensionBounds, type Dimension } from './versions'
import type { World } from './world'
import { planPaths, type ColumnView } from './path/generate'
import type { NamedPath } from './path/presets'

export async function applyPaths(world: World, dim: Dimension, paths: NamedPath[]) {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const path of paths) {
    for (const point of path.points) {
      minX = Math.min(minX, point.x)
      minZ = Math.min(minZ, point.z)
      maxX = Math.max(maxX, point.x)
      maxZ = Math.max(maxZ, point.z)
    }
  }
  if (!Number.isFinite(minX)) return world.save()
  await world.preload(dim, minX - 8, minZ - 8, maxX + 8, maxZ + 8)
  const view: ColumnView = {
    get: (x, y, z) => world.getBlock(dim, x, y, z),
    biome: (x, y, z) => world.getBiome(dim, x, y, z),
    protected: (x, z) => world.isProtectedColumn(dim, x, z)
  }
  const placements = planPaths(view, paths, dimensionBounds(dim))
  for (const placement of placements) {
    const existing = world.getBlock(dim, placement.x, placement.y, placement.z)
    if (existing.name === 'bedrock' || (existing.name !== 'air' && isProtectedName(existing.name))) continue
    world.setBlock(dim, placement.x, placement.y, placement.z, placement.name, placement.properties)
  }
  return world.save()
}

export function previewPaths(world: World, dim: Dimension, paths: NamedPath[]) {
  const view: ColumnView = {
    get: (x, y, z) => world.getBlock(dim, x, y, z),
    biome: (x, y, z) => world.getBiome(dim, x, y, z),
    protected: (x, z) => world.isProtectedColumn(dim, x, z)
  }
  return planPaths(view, paths, dimensionBounds(dim))
}
