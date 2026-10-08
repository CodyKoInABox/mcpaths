/** Original approximate top-face colors. Not Mojang textures. */

const COLORS: Record<string, [number, number, number]> = {
  air: [0, 0, 0],
  cave_air: [0, 0, 0],
  void_air: [0, 0, 0],
  stone: [125, 125, 125],
  granite: [149, 108, 76],
  diorite: [188, 188, 188],
  andesite: [136, 136, 136],
  deepslate: [80, 80, 85],
  cobblestone: [127, 127, 127],
  mossy_cobblestone: [110, 118, 94],
  stone_bricks: [122, 122, 122],
  cracked_stone_bricks: [118, 118, 118],
  mossy_stone_bricks: [115, 121, 96],
  deepslate_bricks: [70, 70, 74],
  dirt: [134, 96, 67],
  coarse_dirt: [119, 85, 59],
  rooted_dirt: [144, 103, 76],
  podzol: [92, 63, 29],
  grass_block: [121, 168, 84],
  dirt_path: [148, 122, 65],
  farmland: [140, 100, 55],
  sand: [219, 207, 160],
  red_sand: [190, 102, 33],
  sandstone: [216, 203, 155],
  smooth_sandstone: [216, 203, 155],
  cut_sandstone: [216, 203, 155],
  red_sandstone: [181, 97, 31],
  smooth_red_sandstone: [181, 97, 31],
  cut_red_sandstone: [181, 97, 31],
  gravel: [136, 126, 126],
  clay: [160, 166, 179],
  moss_block: [89, 109, 45],
  moss_carpet: [89, 109, 45],
  azalea: [110, 145, 75],
  flowering_azalea: [130, 150, 90],
  oak_log: [109, 85, 50],
  spruce_log: [58, 37, 16],
  birch_log: [216, 215, 210],
  jungle_log: [85, 67, 25],
  acacia_log: [103, 96, 86],
  dark_oak_log: [60, 46, 26],
  mangrove_log: [84, 66, 40],
  cherry_log: [54, 33, 44],
  oak_planks: [162, 130, 78],
  spruce_planks: [114, 84, 48],
  birch_planks: [192, 175, 121],
  jungle_planks: [160, 115, 80],
  acacia_planks: [168, 90, 50],
  dark_oak_planks: [66, 43, 20],
  mangrove_planks: [117, 54, 48],
  cherry_planks: [226, 178, 172],
  oak_leaves: [60, 110, 40],
  spruce_leaves: [55, 90, 55],
  birch_leaves: [80, 120, 55],
  jungle_leaves: [50, 110, 30],
  water: [45, 90, 200],
  lava: [210, 90, 20],
  bedrock: [84, 84, 84],
  snow: [245, 250, 255],
  snow_block: [245, 250, 255],
  packed_ice: [165, 195, 245],
  ice: [145, 180, 230],
  blue_ice: [120, 160, 220],
  short_grass: [112, 160, 70],
  grass: [112, 160, 70],
  fern: [96, 150, 70],
  tall_grass: [100, 155, 65],
  dandelion: [200, 190, 60],
  poppy: [180, 50, 45],
  cornflower: [70, 110, 190],
  oxeye_daisy: [210, 210, 180],
  chest: [160, 120, 50],
  oak_fence: [162, 130, 78],
  spruce_fence: [114, 84, 48],
  lantern: [240, 190, 80],
  cinnabar: [176, 72, 58],
  polished_cinnabar: [190, 86, 70],
  sulfur: [214, 196, 92],
  potent_sulfur: [196, 210, 70],
  poplar_log: [150, 140, 120],
  poplar_leaves: [90, 140, 70],
  red_poplar_leaves: [176, 72, 48],
  orange_poplar_leaves: [200, 120, 40],
  yellow_poplar_leaves: [210, 180, 50]
}

export function colorFor(name: string): [number, number, number] {
  const bare = name.replace(/^minecraft:/, '')
  const known = COLORS[bare]
  if (known) return known
  let h = 2166136261
  for (let i = 0; i < bare.length; i++) {
    h ^= bare.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const r = 70 + (h & 0x7f)
  const g = 70 + ((h >>> 8) & 0x7f)
  const b = 70 + ((h >>> 16) & 0x7f)
  return [r, g, b]
}

const PROTECTED = new Set([
  'bedrock',
  'chest',
  'trapped_chest',
  'barrel',
  'spawner',
  'end_portal_frame',
  'end_portal',
  'command_block',
  'chain_command_block',
  'repeating_command_block',
  'lodestone',
  'beacon',
  'jukebox',
  'lectern'
])

export function isProtectedName(name: string): boolean {
  const bare = name.replace(/^minecraft:/, '')
  if (PROTECTED.has(bare)) return true
  if (bare === 'shulker_box' || bare.endsWith('_shulker_box')) return true
  return false
}

const VEGETATION = new Set([
  'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
  'snow', 'snow_layer', 'vine', 'glow_lichen', 'seagrass', 'tall_seagrass',
  'kelp', 'kelp_plant', 'sweet_berry_bush', 'moss_carpet', 'pink_petals',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
  'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
  'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush',
  'peony', 'torchflower', 'pitcher_plant', 'closed_eyeblossom', 'open_eyeblossom',
  'wildflowers', 'bush', 'firefly_bush', 'cactus_flower', 'short_dry_grass',
  'tall_dry_grass'
])

export function isHeadroom(name: string): boolean {
  const bare = name.replace(/^minecraft:/, '')
  if (VEGETATION.has(bare)) return true
  if (bare.endsWith('_sapling') || bare.endsWith('_mushroom')) return true
  return false
}

export function isAir(name: string): boolean {
  const bare = name.replace(/^minecraft:/, '')
  return bare === 'air' || bare === 'cave_air' || bare === 'void_air'
}

export function isWater(name: string): boolean {
  const bare = name.replace(/^minecraft:/, '')
  return bare === 'water' || bare === 'bubble_column'
}

export function isLog(name: string): boolean {
  const bare = name.replace(/^minecraft:/, '')
  return /(_log|_wood|_stem|_hyphae)$/.test(bare)
}

export function isLeaves(name: string): boolean {
  const bare = name.replace(/^minecraft:/, '')
  return bare.endsWith('_leaves')
}

export function bareName(name: string): string {
  return name.replace(/^minecraft:/, '')
}

export function namespaced(name: string): string {
  return name.startsWith('minecraft:') ? name : `minecraft:${name}`
}
