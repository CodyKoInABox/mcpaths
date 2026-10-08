import { bareName } from './blocks'

export interface BlockOcc {
  name: string
  properties: Record<string, string>
}

/**
 * Blocks added after the 1.21.11 registry (cinnabar, poplar, …) are registered
 * here so the 1.21 palette codec can round-trip their names and properties.
 * State ids are appended past the registry's max; they are never written to disk.
 */
export function extendRegistry(registry: any) {
  let nextState = 0
  let nextId = 0
  for (const block of Object.values(registry.blocks) as any[]) {
    nextState = Math.max(nextState, (block.maxStateId ?? 0) + 1)
    nextId = Math.max(nextId, (block.id ?? 0) + 1)
  }

  function ensureBlocks(occurrences: BlockOcc[]) {
    const grouped = new Map<string, Record<string, string>[]>()
    for (const occ of occurrences) {
      const name = bareName(occ.name)
      if (registry.blocksByName[name]) continue
      const list = grouped.get(name) ?? []
      list.push(occ.properties)
      grouped.set(name, list)
    }
    for (const [name, propsList] of grouped) {
      if (registry.blocksByName[name]) continue
      const keys = new Set<string>()
      for (const props of propsList) {
        for (const key of Object.keys(props)) keys.add(key)
      }
      const keyList = [...keys].sort()
      const values: Record<string, string[]> = {}
      for (const key of keyList) {
        const set = new Set<string>()
        for (const props of propsList) set.add(props[key] ?? 'false')
        const list = [...set]
        values[key] = list.length > 0 ? list : ['false']
      }
      const states = keyList.map(key => ({
        name: key,
        type: 'enum',
        num_values: values[key].length,
        values: values[key]
      }))
      let product = 1
      for (const state of states) product *= state.num_values
      if (product < 1) product = 1
      const minStateId = nextState
      const maxStateId = nextState + product - 1
      nextState = maxStateId + 1
      const block = {
        id: nextId++,
        name,
        displayName: name,
        hardness: 1,
        resistance: 1,
        stackSize: 64,
        diggable: true,
        material: 'default',
        transparent: false,
        emitLight: 0,
        filterLight: 15,
        defaultState: minStateId,
        minStateId,
        maxStateId,
        states,
        drops: [],
        boundingBox: 'block'
      }
      registry.blocks[block.id] = block
      registry.blocksByName[name] = block
      for (let stateId = minStateId; stateId <= maxStateId; stateId++) {
        registry.blocksByStateId[stateId] = block
      }
    }
  }

  function ensureBiome(name: string) {
    const bare = bareName(name)
    if (registry.biomesByName[bare]) return
    let id = 0
    while (registry.biomes[id]) id++
    const biome = { id, name: bare, displayName: bare, category: 'none' }
    registry.biomes[id] = biome
    registry.biomesByName[bare] = biome
  }

  return { ensureBlocks, ensureBiome }
}

export function defaultProperties(registry: any, Block: any, name: string): Record<string, string> {
  const block = registry.blocksByName[bareName(name)]
  if (!block) return {}
  const state = Block.fromStateId(block.defaultState, 0)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(state.getProperties() as Record<string, unknown>)) {
    out[key] = String(value)
  }
  return out
}

export function mergeProperties(registry: any, Block: any, name: string, overrides: Record<string, string>): Record<string, string> {
  return { ...defaultProperties(registry, Block, name), ...overrides }
}
