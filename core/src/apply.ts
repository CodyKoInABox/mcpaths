import { isProtectedName } from './blocks'
import { dimensionBounds, type Dimension } from './versions'
import type { LoadHooks, World } from './world'
import { corridorChunks } from './path/cover'
import { planPaths, type ColumnView, type Placement } from './path/generate'
import type { NamedPath } from './path/presets'

async function preloadCorridor(world: World, dim: Dimension, paths: NamedPath[], hooks?: LoadHooks) {
  const chunks = corridorChunks(paths)
  if (chunks.length === 0) return chunks
  await world.preloadChunks(dim, chunks, hooks)
  return chunks
}

function columnView(world: World, dim: Dimension): ColumnView {
  return {
    get: (x, y, z) => ({ name: world.blockName(dim, x, y, z) }),
    biome: (x, y, z) => world.getBiome(dim, x, y, z),
    protected: (x, z) => world.isProtectedColumn(dim, x, z),
    ground: (x, z) => world.groundBlock(dim, x, z)
  }
}

export async function applyPaths(world: World, dim: Dimension, paths: NamedPath[], hooks?: LoadHooks) {
  if (!paths.some(path => path.points.length >= 2)) return world.save()
  hooks?.progress?.('Reading terrain…')
  await preloadCorridor(world, dim, paths, hooks)
  if (hooks?.cancelled?.()) return world.save()
  hooks?.progress?.('Placing blocks…')
  const placements = await planPaths(columnView(world, dim), paths, dimensionBounds(dim))
  for (const placement of placements) {
    const name = world.blockName(dim, placement.x, placement.y, placement.z)
    if (name === 'bedrock' || (name !== 'air' && isProtectedName(name))) continue
    world.setBlock(dim, placement.x, placement.y, placement.z, placement.name, placement.properties)
  }
  hooks?.progress?.('Saving regions…')
  return world.save()
}

export async function previewPaths(world: World, dim: Dimension, paths: NamedPath[], hooks?: LoadHooks): Promise<Placement[]> {
  const chunks = await preloadCorridor(world, dim, paths, hooks)
  let cells: Placement[] = []
  if (!hooks?.cancelled?.()) cells = await planPaths(columnView(world, dim), paths, dimensionBounds(dim), hooks?.cancelled)
  for (const chunk of chunks ?? []) world.releaseColumn(dim, chunk.cx, chunk.cz)
  if (hooks?.cancelled?.()) return []
  return cells
}
