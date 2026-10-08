import { bareName } from '../blocks'

export const PRESET_IDS = ['trail', 'cobble', 'moss', 'sandstone', 'adaptive', 'boardwalk'] as const
export type PresetId = typeof PRESET_IDS[number]
export type WidthOption = 'narrow' | 'normal' | 'wide'
export type HillsOption = 'follow' | 'tunnel'
export type WaterOption = 'bridge' | 'causeway'
export type DressingOption = 'off' | 'subtle' | 'lined'

export interface PathOptions {
  width: WidthOption
  hills: HillsOption
  water: WaterOption
  dressing: DressingOption
}

export const DEFAULT_OPTIONS: PathOptions = {
  width: 'normal',
  hills: 'follow',
  water: 'bridge',
  dressing: 'subtle'
}

export interface NamedPath {
  name: string
  points: { x: number, z: number }[]
  preset: PresetId
  options: PathOptions
}

export interface Materials {
  center: string
  centerAlt: string
  border: string
  shoulder: string
  stair?: string
  slab?: string
  fence?: string
  support: string
  fill: string
  lining: string
  flower: string
  railings: boolean
}

export function widthBlocks(width: WidthOption): 3 | 5 | 7 {
  if (width === 'narrow') return 3
  if (width === 'wide') return 7
  return 5
}

type Family = 'trail' | 'sandstone' | 'red_sandstone' | 'forest' | 'mountain' | 'snow' | 'boardwalk' | 'jungle'

export function familyForBiome(biome: string): Family {
  const name = bareName(biome)
  if (/badlands/.test(name)) return 'red_sandstone'
  if (/desert/.test(name)) return 'sandstone'
  if (/swamp|mangrove/.test(name)) return 'boardwalk'
  if (/jungle|bamboo/.test(name)) return 'jungle'
  if (/snowy|ice_spikes|frozen|grove/.test(name)) return 'snow'
  if (/peaks|stony_peaks|windswept_hills|windswept_gravelly|jagged/.test(name)) return 'mountain'
  if (/forest|taiga|birch|cherry|dark_forest|old_growth|flower_forest/.test(name)) return 'forest'
  return 'trail'
}

function wood(biome: string): string {
  const name = bareName(biome)
  if (name.includes('mangrove')) return 'mangrove'
  if (name.includes('jungle') || name.includes('bamboo')) return 'jungle'
  if (name.includes('birch')) return 'birch'
  if (name.includes('cherry')) return 'cherry'
  if (name.includes('dark_forest') || name.includes('dark_oak')) return 'dark_oak'
  if (name.includes('savanna') || name.includes('acacia')) return 'acacia'
  if (name.includes('crimson')) return 'crimson'
  if (name.includes('warped')) return 'warped'
  return 'spruce'
}

function plankSet(woodName: string): Materials {
  return {
    center: `${woodName}_planks`,
    centerAlt: woodName === 'crimson' || woodName === 'warped' ? `${woodName}_stem` : `stripped_${woodName}_log`,
    border: `${woodName}_slab`,
    shoulder: `${woodName}_slab`,
    stair: `${woodName}_stairs`,
    slab: `${woodName}_slab`,
    fence: `${woodName}_fence`,
    support: `${woodName}_fence`,
    fill: `${woodName}_planks`,
    lining: 'stone_bricks',
    flower: 'short_grass',
    railings: true
  }
}

export function materialsFor(preset: PresetId, biome: string): Materials {
  if (preset === 'adaptive') return materialsFor(familyPreset(familyForBiome(biome)), biome)
  if (preset === 'boardwalk') return plankSet(wood(biome))
  if (preset === 'cobble') {
    return {
      center: 'cobblestone',
      centerAlt: 'mossy_cobblestone',
      border: 'stone_bricks',
      shoulder: 'gravel',
      stair: 'cobblestone_stairs',
      slab: 'cobblestone_slab',
      fence: 'oak_fence',
      support: 'cobblestone',
      fill: 'cobblestone',
      lining: 'stone_bricks',
      flower: 'dandelion',
      railings: false
    }
  }
  if (preset === 'moss') {
    return {
      center: 'moss_block',
      centerAlt: 'mossy_cobblestone',
      border: 'rooted_dirt',
      shoulder: 'moss_block',
      stair: 'mossy_cobblestone_stairs',
      slab: 'mossy_cobblestone_slab',
      fence: 'oak_fence',
      support: 'mossy_cobblestone',
      fill: 'moss_block',
      lining: 'stone_bricks',
      flower: 'azalea',
      railings: false
    }
  }
  if (preset === 'sandstone') {
    return sandstone('sand', 'sandstone', 'smooth_sandstone', 'cut_sandstone')
  }
  return {
    center: 'dirt_path',
    centerAlt: 'rooted_dirt',
    border: 'coarse_dirt',
    shoulder: 'rooted_dirt',
    support: 'dirt',
    fill: 'dirt',
    lining: 'stone_bricks',
    flower: 'short_grass',
    railings: false
  }
}

function familyPreset(family: Family): PresetId {
  if (family === 'sandstone' || family === 'red_sandstone') return 'sandstone'
  if (family === 'forest' || family === 'jungle') return 'moss'
  if (family === 'mountain') return 'cobble'
  if (family === 'snow') return 'trail'
  if (family === 'boardwalk') return 'boardwalk'
  return 'trail'
}

function sandstone(shoulder: string, base: string, smooth: string, cut: string): Materials {
  return {
    center: smooth,
    centerAlt: base,
    border: cut,
    shoulder,
    stair: `${smooth}_stairs`,
    slab: `${smooth}_slab`,
    fence: 'oak_fence',
    support: base,
    fill: base,
    lining: 'stone_bricks',
    flower: 'dead_bush',
    railings: false
  }
}

export function materialsForAdaptive(biome: string): Materials {
  const family = familyForBiome(biome)
  if (family === 'red_sandstone') return sandstone('red_sand', 'red_sandstone', 'smooth_red_sandstone', 'cut_red_sandstone')
  if (family === 'sandstone') return materialsFor('sandstone', biome)
  if (family === 'jungle') {
    return {
      center: 'moss_block',
      centerAlt: 'podzol',
      border: 'podzol',
      shoulder: 'rooted_dirt',
      stair: 'mossy_cobblestone_stairs',
      slab: 'mossy_cobblestone_slab',
      support: 'podzol',
      fill: 'podzol',
      lining: 'stone_bricks',
      flower: 'azalea',
      railings: false
    }
  }
  if (family === 'forest') {
    const moss = materialsFor('moss', biome)
    return { ...moss, shoulder: 'podzol', border: 'podzol' }
  }
  if (family === 'mountain') {
    return {
      center: 'stone_bricks',
      centerAlt: 'cobblestone',
      border: 'cobblestone',
      shoulder: 'gravel',
      stair: 'stone_brick_stairs',
      slab: 'stone_brick_slab',
      fence: 'oak_fence',
      support: 'cobblestone',
      fill: 'stone',
      lining: 'stone_bricks',
      flower: 'short_grass',
      railings: false
    }
  }
  if (family === 'snow') {
    return {
      center: 'packed_ice',
      centerAlt: 'blue_ice',
      border: 'cobblestone',
      shoulder: 'snow_block',
      stair: 'cobblestone_stairs',
      slab: 'cobblestone_slab',
      support: 'cobblestone',
      fill: 'stone',
      lining: 'stone_bricks',
      flower: 'snow',
      railings: false
    }
  }
  if (family === 'boardwalk') return materialsFor('boardwalk', biome)
  return materialsFor('trail', biome)
}

export function resolveMaterials(preset: PresetId, biome: string): Materials {
  if (preset === 'adaptive') return materialsForAdaptive(biome)
  return materialsFor(preset, biome)
}
