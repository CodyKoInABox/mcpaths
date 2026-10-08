import nbt from 'prismarine-nbt'
import { CODEC_VERSION, type PaletteSchema } from './versions'
import { bareName, isAir, isHeadroom, isLeaves, isLog, isProtectedName, isWater, namespaced } from './blocks'
import { extendRegistry, mergeProperties, type BlockOcc } from './registry'
import { readPalette, retagPalette, sectionList, type PaletteEntry } from './palette'
import { updateHeightmaps } from './heightmap'

const mcData = require('minecraft-data')
const ChunkCodec = require('prismarine-provider-anvil').chunk
const BlockFactory = require('prismarine-block')

const registry = mcData(CODEC_VERSION)
const Block = BlockFactory(registry)
const codec = ChunkCodec(CODEC_VERSION)
const extra = extendRegistry(registry)

const placedState = new Map<string, number>()

function placementKey(name: string, properties: Record<string, string>): string {
  const keys = Object.keys(properties)
  if (keys.length === 0) return name
  keys.sort()
  let key = name
  for (const prop of keys) key += '\0' + prop + '=' + properties[prop]
  return key
}

export function blockStateId(name: string, properties: Record<string, string> = {}): number {
  const bare = bareName(name)
  const key = placementKey(bare, properties)
  const cached = placedState.get(key)
  if (cached != null) return cached
  if (!registry.blocksByName[bare]) {
    extra.ensureBlocks([{ name: bare, properties }])
  }
  const props = mergeProperties(registry, Block, bare, properties)
  const block = Block.fromProperties(bare, props, 0)
  if (!block || block.stateId == null) {
    throw new Error(`MC Paths does not know how to place ${namespaced(bare)}.`)
  }
  placedState.set(key, block.stateId)
  return block.stateId
}

export interface StateProfile {
  name: string
  air: boolean
  water: boolean
  headroom: boolean
  leaves: boolean
  log: boolean
  solid: boolean
  protected: boolean
  /** Air, plants, leaves, and logs. The path looks through these for the ground. */
  groundSkip: boolean
}

const stateProfiles = new Map<number, StateProfile>()

/** One Block allocation per state id. Hot loops must not call getBlock. */
export function profileOf(stateId: number): StateProfile {
  const cached = stateProfiles.get(stateId)
  if (cached) return cached
  const block = Block.fromStateId(stateId, 0)
  const name = block?.name || 'air'
  const air = isAir(name)
  const leaves = isLeaves(name)
  const log = isLog(name)
  const headroom = isHeadroom(name)
  const profile: StateProfile = {
    name,
    air,
    water: isWater(name),
    headroom,
    leaves,
    log,
    solid: block?.boundingBox === 'block',
    protected: name !== 'bedrock' && isProtectedName(name),
    groundSkip: air || headroom || leaves || log
  }
  stateProfiles.set(stateId, profile)
  return profile
}

export function describeState(stateId: number): { name: string, properties: Record<string, string> } {
  const block = Block.fromStateId(stateId, 0)
  const properties: Record<string, string> = {}
  for (const [key, value] of Object.entries(block.getProperties() as Record<string, unknown>)) {
    properties[key] = String(value)
  }
  return { name: block.name || 'air', properties }
}

export interface LoadedChunk {
  column: any
  /** Deep copy used only so the caller's tag stays intact until save. */
  source: any
}

function cloneTag(tag: any): any {
  return nbt.parseUncompressed(nbt.writeUncompressed(tag))
}

function asEntries(section: any): PaletteEntry[] {
  return readPalette(section.block_states?.value?.palette).map(entry => ({
    name: bareName(entry.name),
    properties: entry.properties
  }))
}

function prepareClone(tag: any) {
  const occurrences: BlockOcc[] = []
  for (const section of sectionList(tag)) {
    if (!section.block_states) continue
    for (const entry of asEntries(section)) occurrences.push(entry)
  }
  extra.ensureBlocks(occurrences)
  for (const section of sectionList(tag)) {
    if (section.block_states) {
      const entries = asEntries(section).map(entry => ({
        name: namespaced(entry.name),
        properties: mergeProperties(registry, Block, entry.name, entry.properties)
      }))
      const comps = entries.map(entry => {
        const props = Object.fromEntries(Object.entries(entry.properties).map(([k, v]) => [k, nbt.string(v)]))
        const body: Record<string, any> = { Name: nbt.string(entry.name) }
        if (Object.keys(props).length) body.Properties = nbt.comp(props)
        return body
      })
      section.block_states.value.palette = nbt.list(nbt.comp(comps))
    }
    const biomes = section.biomes?.value?.palette
    if (biomes?.value?.type === 'compound') {
      const names = (biomes.value.value as any[]).map(comp => {
        const fields = comp.value ?? comp
        return stringOf(fields.Name) || stringOf(fields.id) || 'minecraft:plains'
      })
      for (const name of names) extra.ensureBiome(name)
      section.biomes.value.palette = nbt.list(nbt.string(names))
    } else if (biomes?.value?.type === 'string') {
      for (const name of biomes.value.value as string[]) extra.ensureBiome(name)
    }
  }
  if (!tag.value.LastUpdate) tag.value.LastUpdate = nbt.long([0, 0])
  if (!tag.value.InhabitedTime) tag.value.InhabitedTime = nbt.long([0, 0])
  if (!tag.value.block_entities) tag.value.block_entities = nbt.list(nbt.comp([]))
}

function stringOf(tag: any): string {
  if (!tag) return ''
  if (typeof tag === 'string') return tag
  if (typeof tag.value === 'string') return tag.value
  return ''
}

export function loadChunkTag(tag: any): LoadedChunk {
  const source = cloneTag(tag)
  prepareClone(source)
  let column: any
  try {
    column = codec.nbtChunkToPrismarineChunk(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not read a chunk with the 1.21 palette codec: ${message}`)
  }
  return { column, source }
}

export function newColumn(): any {
  const Chunk = require('prismarine-chunk')(CODEC_VERSION)
  return new Chunk({ minY: -64, worldHeight: 384 })
}

/** Serialize a column. DataVersion is the world's, never the 1.21 codec value. */
export function chunkTagFromColumn(column: any, chunkX: number, chunkZ: number, dataVersion: number, schema: PaletteSchema, yPos: number): any {
  const tag = codec.prismarineChunkToNbt(column, chunkX, chunkZ)
  tag.value.DataVersion = nbt.int(dataVersion)
  tag.value.xPos = nbt.int(chunkX)
  tag.value.zPos = nbt.int(chunkZ)
  tag.value.yPos = nbt.int(yPos)
  tag.value.Status = nbt.string('minecraft:full')
  tag.value.isLightOn = nbt.byte(0)
  if (!tag.value.block_entities) tag.value.block_entities = nbt.list(nbt.comp([]))
  if (!tag.value.structures) tag.value.structures = nbt.comp({})
  for (const section of sectionList(tag)) {
    if (section.block_states) retagPalette(section.block_states, schema)
    delete section.BlockLight
    delete section.SkyLight
  }
  updateHeightmaps(tag, column, profileOf)
  return tag
}

export function columnFromTag(tag: any): any {
  return loadChunkTag(tag).column
}

/**
 * Write block_states from `column` back onto `tag`.
 * DataVersion is `dataVersion` (the world's), never the 1.21 codec's 4671.
 */
export function saveColumn(tag: any, column: any, dataVersion: number, schema: PaletteSchema, touched: Set<number> | 'all') {
  const generated = codec.prismarineChunkToNbt(column, tag.value.xPos?.value ?? 0, tag.value.zPos?.value ?? 0)
  const generatedSections = new Map<number, any>()
  for (const section of sectionList(generated)) {
    generatedSections.set(Number(section.Y.value), section)
  }
  const existing = sectionList(tag)
  const existingY = new Set(existing.map(section => Number(section.Y.value)))
  const ys = touched === 'all' ? [...generatedSections.keys()] : [...touched]
  for (const y of ys) {
    const from = generatedSections.get(y)
    if (!from) continue
    let dest = existing.find(section => Number(section.Y.value) === y)
    if (!dest) {
      dest = {
        Y: nbt.byte(y),
        block_states: from.block_states,
        biomes: from.biomes
      }
      existing.push(dest)
      existingY.add(y)
    } else {
      dest.block_states = from.block_states
      delete dest.BlockLight
      delete dest.SkyLight
    }
    retagPalette(dest.block_states, schema)
  }
  tag.value.DataVersion = nbt.int(dataVersion)
  tag.value.isLightOn = nbt.byte(0)
  updateHeightmaps(tag, column, profileOf)
  return tag
}

export function chunkBlockEntities(tag: any): { x: number, y: number, z: number }[] {
  const list = tag.value.block_entities?.value?.value
  if (!Array.isArray(list)) return []
  return list.map(entity => ({
    x: Number(entity.x?.value ?? 0),
    y: Number(entity.y?.value ?? 0),
    z: Number(entity.z?.value ?? 0)
  }))
}

export { registry, Block }
