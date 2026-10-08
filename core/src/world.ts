import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import nbt from 'prismarine-nbt'
import {
  dimensionBounds,
  supportForDataVersion,
  type Dimension,
  type VersionSupport
} from './versions'
import {
  blockStateId,
  chunkBlockEntities,
  chunkTagFromColumn,
  describeState,
  loadChunkTag,
  newColumn,
  saveColumn
} from './codec'
import { isAir, isProtectedName } from './blocks'
import { registry } from './codec'
import { regionOf } from './grid'
import {
  gameTypeFromLevel,
  lastPlayedFromLevel,
  levelDisplayName,
  playerFromLevel,
  type GameTypeName,
  type PlayerView
} from './names'

const RegionFile = require('prismarine-provider-anvil/src/region')

export interface WorldInfo {
  path: string
  name: string
  folder: string
  dataVersion: number
  versionName: string
  support: VersionSupport
  spawn: { x: number, y: number, z: number }
  player: PlayerView | null
  lastPlayed: number | null
  gameType: GameTypeName | null
}

export interface RegionMask {
  rx: number
  rz: number
  /** 1024 chunk bits, index `(localZ << 5) | localX`, little-endian bits. */
  present: Buffer
}

export interface BlockState {
  name: string
  properties: Record<string, string>
}

interface EditableChunk {
  dim: Dimension
  file: string
  localX: number
  localZ: number
  chunkX: number
  chunkZ: number
  tag: any
  column: any
  dirty: boolean
  fresh: boolean
  touched: Set<number>
  protected: Set<string> | null
  blockEntities: any[]
  entities: any[]
}

function directoryHasRegions(dir: string): boolean {
  if (!fs.existsSync(dir)) return false
  try {
    return fs.readdirSync(dir).some(name => name.endsWith('.mca'))
  } catch {
    return false
  }
}

/** Chunks present in region headers. Empty directories are ignored. */
export function regionMasks(worldPath: string, dim: Dimension, dataVersion: number): RegionMask[] {
  const dir = regionDirectory(worldPath, dim, dataVersion)
  if (!fs.existsSync(dir)) return []
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not read region folder ${dir}: ${message}`)
  }
  const masks: RegionMask[] = []
  const header = Buffer.alloc(4096)
  for (const name of names) {
    const match = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(name)
    if (!match) continue
    const present = Buffer.alloc(128)
    let fd: number
    try {
      fd = fs.openSync(path.join(dir, name), 'r')
    } catch {
      continue
    }
    try {
      const read = fs.readSync(fd, header, 0, 4096, 0)
      const slots = Math.min(1024, Math.floor(read / 4))
      let any = false
      for (let i = 0; i < slots; i++) {
        if ((header.readUInt32BE(i * 4) >>> 8) === 0) continue
        present[i >> 3] |= 1 << (i & 7)
        any = true
      }
      if (any) masks.push({ rx: Number(match[1]), rz: Number(match[2]), present })
    } finally {
      fs.closeSync(fd)
    }
  }
  return masks
}

/** Block bounds of chunks that actually exist in the region headers. */
export function occupiedBounds(worldPath: string, dim: Dimension, dataVersion: number): { minX: number, minZ: number, maxX: number, maxZ: number } | null {
  const masks = regionMasks(worldPath, dim, dataVersion)
  let minCX = Infinity
  let minCZ = Infinity
  let maxCX = -Infinity
  let maxCZ = -Infinity
  for (const mask of masks) {
    for (let i = 0; i < 1024; i++) {
      if ((mask.present[i >> 3] & (1 << (i & 7))) === 0) continue
      const cx = mask.rx * 32 + (i & 31)
      const cz = mask.rz * 32 + (i >> 5)
      if (cx < minCX) minCX = cx
      if (cz < minCZ) minCZ = cz
      if (cx > maxCX) maxCX = cx
      if (cz > maxCZ) maxCZ = cz
    }
  }
  if (!Number.isFinite(minCX)) return null
  return { minX: minCX * 16, minZ: minCZ * 16, maxX: maxCX * 16 + 15, maxZ: maxCZ * 16 + 15 }
}

export function regionDirectory(worldPath: string, dim: Dimension, dataVersion: number): string {
  const modern: Record<Dimension, string> = {
    overworld: 'dimensions/minecraft/overworld/region',
    nether: 'dimensions/minecraft/the_nether/region',
    end: 'dimensions/minecraft/the_end/region'
  }
  const legacy: Record<Dimension, string> = {
    overworld: 'region',
    nether: 'DIM-1/region',
    end: 'DIM1/region'
  }
  const modernPath = path.join(worldPath, modern[dim])
  const legacyPath = path.join(worldPath, legacy[dim])
  // Directory existence is not enough: an empty leftover `region/` would hide
  // `dimensions/minecraft/.../region`, and the map would sample nothing.
  const modernHas = directoryHasRegions(modernPath)
  const legacyHas = directoryHasRegions(legacyPath)
  if (modernHas && !legacyHas) return modernPath
  if (legacyHas && !modernHas) return legacyPath
  if (modernHas && legacyHas) return dataVersion >= 4786 ? modernPath : legacyPath
  return dataVersion >= 4786 ? modernPath : legacyPath
}

export async function readWorldInfo(worldPath: string): Promise<WorldInfo> {
  const file = path.join(worldPath, 'level.dat')
  if (!fs.existsSync(file)) {
    throw new Error('This folder has no level.dat, so it is not a Minecraft save.')
  }
  let parsed: any
  try {
    parsed = await nbt.parse(await fsp.readFile(file))
  } catch {
    throw new Error('level.dat is there, but MC Paths could not read it.')
  }
  const root = nbt.simplify(parsed.parsed)
  const data = root?.Data ?? root
  const dataVersion = typeof data?.DataVersion === 'number' ? data.DataVersion : null
  if (dataVersion == null) {
    throw new Error('level.dat has no DataVersion, so MC Paths cannot tell how this world stores chunks.')
  }
  const folder = path.basename(worldPath)
  const name = levelDisplayName(data?.LevelName, folder)
  let support: VersionSupport
  try {
    support = supportForDataVersion(dataVersion)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const wrapped = new Error(message) as Error & { saveName?: string }
    wrapped.saveName = name
    throw wrapped
  }
  const versionName = typeof data.Version?.Name === 'string' && data.Version.Name ? data.Version.Name : support.label
  return {
    path: worldPath,
    name,
    folder,
    dataVersion,
    versionName,
    support,
    spawn: {
      x: Number(data.SpawnX ?? 0),
      y: Number(data.SpawnY ?? 64),
      z: Number(data.SpawnZ ?? 0)
    },
    player: playerFromLevel(data),
    lastPlayed: lastPlayedFromLevel(data),
    gameType: gameTypeFromLevel(data)
  }
}

export async function createWorld(worldPath: string, opts: { dataVersion: number, name: string, spawn?: { x: number, y: number, z: number } }): Promise<World> {
  await fsp.mkdir(worldPath, { recursive: true })
  const support = supportForDataVersion(opts.dataVersion)
  const spawn = opts.spawn ?? { x: 8, y: 70, z: 8 }
  const tag = nbt.comp({
    Data: nbt.comp({
      DataVersion: nbt.int(opts.dataVersion),
      Version: nbt.comp({
        Id: nbt.int(opts.dataVersion),
        Name: nbt.string(support.label),
        Series: nbt.string('main'),
        Snapshot: nbt.byte(0)
      }),
      LevelName: nbt.string(opts.name),
      SpawnX: nbt.int(spawn.x),
      SpawnY: nbt.int(spawn.y),
      SpawnZ: nbt.int(spawn.z)
    })
  }, '')
  await fsp.writeFile(path.join(worldPath, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(tag as any)))
  return World.open(worldPath)
}

function chunkKey(dim: Dimension, cx: number, cz: number): string {
  return `${dim}:${cx}:${cz}`
}

function splitBlock(x: number, z: number) {
  const cx = Math.floor(x / 16)
  const cz = Math.floor(z / 16)
  return { cx, cz, lx: x - cx * 16, lz: z - cz * 16 }
}

export interface LoadHooks {
  progress?: (message: string) => void
  cancelled?: () => boolean
}

export class World {
  readonly info: WorldInfo
  private regions = new Map<string, any>()
  private chunks = new Map<string, EditableChunk>()
  private surfaces = new Map<string, Uint8Array>()
  private overviews = new Map<string, Uint8Array>()
  private failures = new Map<string, string>()

  private constructor(info: WorldInfo) {
    this.info = info
  }

  static async open(worldPath: string): Promise<World> {
    return new World(await readWorldInfo(worldPath))
  }

  regionDir(dim: Dimension): string {
    return regionDirectory(this.info.path, dim, this.info.dataVersion)
  }

  bounds(dim: Dimension) {
    return occupiedBounds(this.info.path, dim, this.info.dataVersion)
  }

  async close() {
    for (const region of this.regions.values()) await region.close()
    this.regions.clear()
    this.chunks.clear()
    this.surfaces.clear()
    this.overviews.clear()
    this.failures.clear()
  }

  clearMapCache() {
    this.surfaces.clear()
    this.overviews.clear()
    this.failures.clear()
  }

  columnOf(dim: Dimension, cx: number, cz: number): any | null {
    return this.chunks.get(chunkKey(dim, cx, cz))?.column ?? null
  }

  cachedSurface(dim: Dimension, cx: number, cz: number): Uint8Array | null {
    return this.surfaces.get(chunkKey(dim, cx, cz)) ?? null
  }

  cacheSurface(dim: Dimension, cx: number, cz: number, rgb: Uint8Array) {
    this.surfaces.set(chunkKey(dim, cx, cz), rgb)
  }

  cachedOverview(dim: Dimension, cx: number, cz: number): Uint8Array | null {
    return this.overviews.get(chunkKey(dim, cx, cz)) ?? null
  }

  cacheOverview(dim: Dimension, cx: number, cz: number, rgb: Uint8Array) {
    this.overviews.set(chunkKey(dim, cx, cz), rgb)
  }

  chunkError(dim: Dimension, cx: number, cz: number): string | null {
    return this.failures.get(chunkKey(dim, cx, cz)) ?? null
  }

  async preloadChunks(dim: Dimension, chunks: { cx: number, cz: number }[], hooks?: LoadHooks) {
    let lastFile = ''
    for (const chunk of chunks) {
      if (hooks?.cancelled?.()) return
      const { rx, rz } = regionOf(chunk.cx, chunk.cz)
      const label = `r.${rx}.${rz}.mca`
      const file = path.join(this.regionDir(dim), label)
      if (label !== lastFile && fs.existsSync(file)) {
        hooks?.progress?.(`Reading region ${label}…`)
        lastFile = label
      }
      try {
        await this.loadChunk(dim, chunk.cx, chunk.cz, false)
        this.failures.delete(chunkKey(dim, chunk.cx, chunk.cz))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.failures.set(chunkKey(dim, chunk.cx, chunk.cz), message)
      }
    }
  }

  private async region(file: string) {
    let region = this.regions.get(file)
    if (!region) {
      await fsp.mkdir(path.dirname(file), { recursive: true })
      region = new RegionFile(file)
      await region.initialize()
      this.regions.set(file, region)
    }
    return region
  }

  private async loadChunk(dim: Dimension, cx: number, cz: number, create: boolean): Promise<EditableChunk | null> {
    const key = chunkKey(dim, cx, cz)
    const cached = this.chunks.get(key)
    if (cached) return cached
    const { rx, rz, lx, lz } = regionOf(cx, cz)
    const file = path.join(this.regionDir(dim), `r.${rx}.${rz}.mca`)
    const exists = fs.existsSync(file)
    if (!exists && !create) return null
    const region = await this.region(file)
    const raw = exists ? await region.read(lx, lz) : null
    if (!raw && !create) return null
    let tag: any
    let column: any
    let fresh = false
    if (!raw) {
      tag = null
      column = newColumn()
      fresh = true
    } else {
      const loaded = loadChunkTag(raw)
      tag = raw
      column = loaded.column
    }
    const editable: EditableChunk = {
      dim,
      file,
      localX: lx,
      localZ: lz,
      chunkX: cx,
      chunkZ: cz,
      tag,
      column,
      dirty: fresh,
      fresh,
      touched: new Set<number>(),
      protected: null,
      blockEntities: [],
      entities: []
    }
    this.chunks.set(key, editable)
    return editable
  }

  async preload(dim: Dimension, minX: number, minZ: number, maxX: number, maxZ: number) {
    const c0x = Math.floor(Math.min(minX, maxX) / 16)
    const c1x = Math.floor(Math.max(minX, maxX) / 16)
    const c0z = Math.floor(Math.min(minZ, maxZ) / 16)
    const c1z = Math.floor(Math.max(minZ, maxZ) / 16)
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) await this.loadChunk(dim, cx, cz, false)
    }
  }

  /** Highest non-air block in a loaded column. Empty sections are skipped. */
  topBlock(dim: Dimension, x: number, z: number): BlockState {
    const { cx, cz, lx, lz } = splitBlock(x, z)
    const chunk = this.chunks.get(chunkKey(dim, cx, cz))
    if (!chunk) return { name: 'air', properties: {} }
    const sections = chunk.column.sections as any[]
    const minY = chunk.column.minY as number
    for (let index = sections.length - 1; index >= 0; index--) {
      const section = sections[index]
      if (!section || section.isEmpty?.()) continue
      const single = section.data
      if (single && typeof single.value === 'number' && single.palette == null) {
        const block = describeState(single.value)
        if (!isAir(block.name)) return block
        continue
      }
      const y0 = minY + index * 16
      for (let y = y0 + 15; y >= y0; y--) {
        const block = chunk.column.getBlock({ x: lx, y, z: lz })
        const name = block?.name || 'air'
        if (!isAir(name)) {
          const properties: Record<string, string> = {}
          for (const [key, value] of Object.entries(block.getProperties?.() ?? {})) properties[key] = String(value)
          return { name, properties }
        }
      }
    }
    return { name: 'air', properties: {} }
  }

  getBlock(dim: Dimension, x: number, y: number, z: number): BlockState {
    const { cx, cz, lx, lz } = splitBlock(x, z)
    const chunk = this.chunks.get(chunkKey(dim, cx, cz))
    if (!chunk) return { name: 'air', properties: {} }
    const block = chunk.column.getBlock({ x: lx, y, z: lz })
    const properties: Record<string, string> = {}
    for (const [key, value] of Object.entries(block.getProperties?.() ?? {})) properties[key] = String(value)
    return { name: block.name || 'air', properties }
  }

  getBiome(dim: Dimension, x: number, y: number, z: number): string {
    const { cx, cz, lx, lz } = splitBlock(x, z)
    const chunk = this.chunks.get(chunkKey(dim, cx, cz))
    if (!chunk) return 'plains'
    const id = chunk.column.getBiome({ x: lx, y, z: lz })
    return registry.biomes[id]?.name || 'plains'
  }

  setBlock(dim: Dimension, x: number, y: number, z: number, name: string, properties: Record<string, string> = {}) {
    const { cx, cz, lx, lz } = splitBlock(x, z)
    const chunk = this.chunks.get(chunkKey(dim, cx, cz))
    if (!chunk) throw new Error(`No chunk is loaded at ${x}, ${z}.`)
    const stateId = blockStateId(name, properties)
    chunk.column.setBlock({ x: lx, y, z: lz }, { stateId })
    chunk.dirty = true
    chunk.touched.add(Math.floor(y / 16))
    this.surfaces.delete(chunkKey(dim, cx, cz))
    this.overviews.delete(chunkKey(dim, cx, cz))
  }

  setBiome(dim: Dimension, x: number, y: number, z: number, biome: string) {
    const { cx, cz, lx, lz } = splitBlock(x, z)
    const chunk = this.chunks.get(chunkKey(dim, cx, cz))
    if (!chunk) throw new Error(`No chunk is loaded at ${x}, ${z}.`)
    const id = registry.biomesByName[biome.replace(/^minecraft:/, '')]?.id
    if (id == null) throw new Error(`Unknown biome ${biome}.`)
    chunk.column.setBiome({ x: lx, y, z: lz }, id)
    chunk.dirty = true
    chunk.fresh = chunk.fresh || false
  }

  async ensureChunk(dim: Dimension, x: number, z: number) {
    const { cx, cz } = splitBlock(x, z)
    await this.loadChunk(dim, cx, cz, true)
  }

  isProtectedColumn(dim: Dimension, x: number, z: number): boolean {
    const { cx, cz, lx, lz } = splitBlock(x, z)
    const chunk = this.chunks.get(chunkKey(dim, cx, cz))
    if (!chunk) return false
    if (!chunk.protected) chunk.protected = this.scanProtected(dim, chunk)
    return chunk.protected.has(`${lx},${lz}`)
  }

  private scanProtected(dim: Dimension, chunk: EditableChunk): Set<string> {
    const found = new Set<string>()
    const { minY, maxY } = dimensionBounds(dim)
    for (const entity of chunk.tag ? chunkBlockEntities(chunk.tag) : []) {
      if (Math.floor(entity.x / 16) !== chunk.chunkX || Math.floor(entity.z / 16) !== chunk.chunkZ) continue
      const lx = entity.x - chunk.chunkX * 16
      const lz = entity.z - chunk.chunkZ * 16
      found.add(`${lx},${lz}`)
    }
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        if (found.has(`${lx},${lz}`)) continue
        for (let y = maxY; y >= minY; y--) {
          const block = chunk.column.getBlock({ x: lx, y, z: lz })
          const name = block?.name || ''
          if (name !== 'bedrock' && isProtectedName(name)) {
            found.add(`${lx},${lz}`)
            break
          }
        }
      }
    }
    return found
  }

  /** Reload every cached chunk through the codec and write it back. */
  rewriteLoaded() {
    for (const chunk of this.chunks.values()) {
      if (chunk.fresh) continue
      chunk.dirty = true
      chunk.touched.clear()
    }
  }

  addBlockEntity(dim: Dimension, compound: Record<string, any>) {
    const x = Number(compound.x?.value)
    const z = Number(compound.z?.value)
    const { cx, cz } = splitBlock(x, z)
    const chunk = this.chunks.get(chunkKey(dim, cx, cz))
    if (!chunk) throw new Error('No chunk is loaded for that block entity.')
    chunk.blockEntities.push(compound)
    chunk.dirty = true
    chunk.protected = null
  }

  addEntity(dim: Dimension, x: number, z: number, compound: Record<string, any>) {
    const { cx, cz } = splitBlock(x, z)
    const chunk = this.chunks.get(chunkKey(dim, cx, cz))
    if (!chunk) throw new Error('No chunk is loaded for that entity.')
    chunk.entities.push(compound)
    chunk.dirty = true
  }

  async save(): Promise<{ backupDir: string | null, chunks: number, files: string[] }> {
    const dirty = [...this.chunks.values()].filter(chunk => chunk.dirty)
    if (dirty.length === 0) return { backupDir: null, chunks: 0, files: [] }
    const files = [...new Set(dirty.map(chunk => chunk.file).filter(file => fs.existsSync(file)))]
    const backupDir = await backupRegionFiles(this.info.path, files)
    for (const chunk of dirty) {
      if (chunk.fresh || !chunk.tag) {
        chunk.tag = chunkTagFromColumn(
          chunk.column,
          chunk.chunkX,
          chunk.chunkZ,
          this.info.dataVersion,
          this.info.support.palette,
          chunk.dim === 'overworld' ? -4 : 0
        )
      } else {
        saveColumn(chunk.tag, chunk.column, this.info.dataVersion, this.info.support.palette, chunk.touched.size > 0 ? chunk.touched : 'all')
      }
      appendBlockEntities(chunk.tag, chunk.blockEntities)
      appendEntities(chunk.tag, chunk.entities)
      const region = await this.region(chunk.file)
      await region.write(chunk.localX, chunk.localZ, chunk.tag)
      chunk.dirty = false
      chunk.fresh = false
      chunk.touched.clear()
      chunk.blockEntities = []
      chunk.entities = []
      chunk.protected = null
    }
    return { backupDir, chunks: dirty.length, files }
  }
}

function appendEntities(tag: any, entities: any[]) {
  if (entities.length === 0) return
  if (!tag.value.entities || tag.value.entities.value?.type === 'end') {
    tag.value.entities = { type: 'list', value: { type: 'compound', value: [] } }
  }
  const list = tag.value.entities
  if (!Array.isArray(list.value?.value)) list.value = { type: 'compound', value: [] }
  for (const entity of entities) list.value.value.push(entity)
}

function appendBlockEntities(tag: any, entities: any[]) {
  if (entities.length === 0) return
  if (!tag.value.block_entities || tag.value.block_entities.value?.type === 'end') {
    tag.value.block_entities = { type: 'list', value: { type: 'compound', value: [] } }
  }
  const list = tag.value.block_entities
  if (!Array.isArray(list.value?.value)) list.value = { type: 'compound', value: [] }
  for (const entity of entities) list.value.value.push(entity)
}

async function backupRegionFiles(worldPath: string, files: string[]): Promise<string | null> {
  if (files.length === 0) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const root = path.join(worldPath, '.mcpaths-backup', stamp)
  for (const file of files) {
    const rel = path.relative(worldPath, file)
    const dest = path.join(root, rel)
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    await fsp.copyFile(file, dest)
  }
  return root
}

export async function readStoredChunk(worldPath: string, dataVersion: number, dim: Dimension, blockX: number, blockZ: number): Promise<any | null> {
  const cx = Math.floor(blockX / 16)
  const cz = Math.floor(blockZ / 16)
  const { rx, rz, lx, lz } = regionOf(cx, cz)
  const file = path.join(regionDirectory(worldPath, dim, dataVersion), `r.${rx}.${rz}.mca`)
  if (!fs.existsSync(file)) return null
  const region = new RegionFile(file)
  await region.initialize()
  try {
    return await region.read(lx, lz)
  } finally {
    await region.close()
  }
}

export function stateName(stateId: number): BlockState {
  return describeState(stateId)
}
