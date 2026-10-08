import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import nbt from 'prismarine-nbt'
import os from 'node:os'
import {
  DATA_VERSION_26_2,
  DATA_VERSION_26_3,
  DEFAULT_OPTIONS,
  applyPaths,
  corridorChunks,
  createWorld,
  dimensionBounds,
  planPaths,
  previewPaths,
  readStoredChunk,
  sampleMap,
  type PresetId
} from '../src'
import type { ColumnView } from '../src/path/generate'
import { resample } from '../src/path/spline'
import { buildFixture } from './fixture'

async function flatWorld(dataVersion: number) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-flat-'))
  const world = await createWorld(dir, { dataVersion, name: 'flat' })
  await world.ensureChunk('overworld', 0, 0)
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      world.setBlock('overworld', x, 62, z, 'dirt')
      world.setBlock('overworld', x, 63, z, 'grass_block')
      world.setBiome('overworld', x, 63, z, 'plains')
    }
  }
  return { dir, world }
}

test('map sampler returns a non-empty color grid', async () => {
  const { world } = await buildFixture(DATA_VERSION_26_2)
  const map = await sampleMap(world, 'overworld', 0, 0, 16, 16)
  assert.equal(map.rgb.length, 16 * 16 * 3)
  assert.ok(map.rgb.some(byte => byte > 40))
  await world.close()
})

test('each preset writes its floor, and the chest column stays', async () => {
  const presets: { preset: PresetId, expect: string[] }[] = [
    { preset: 'trail', expect: ['dirt_path', 'rooted_dirt'] },
    { preset: 'cobble', expect: ['cobblestone', 'mossy_cobblestone'] },
    { preset: 'moss', expect: ['moss_block', 'mossy_cobblestone'] },
    { preset: 'sandstone', expect: ['smooth_sandstone', 'sandstone'] },
    { preset: 'boardwalk', expect: ['spruce_planks', 'stripped_spruce_log'] },
    { preset: 'adaptive', expect: ['dirt_path', 'rooted_dirt'] }
  ]
  for (const row of presets) {
    const flat = await flatWorld(DATA_VERSION_26_2)
    await applyPaths(flat.world, 'overworld', [{
      name: row.preset,
      points: [{ x: 2, z: 8 }, { x: 13, z: 8 }],
      preset: row.preset,
      options: { ...DEFAULT_OPTIONS, dressing: 'off' }
    }])
    const names = new Set<string>()
    for (let x = 4; x <= 11; x++) names.add(flat.world.getBlock('overworld', x, 63, 8).name)
    assert.ok([...names].some(name => row.expect.includes(name)), `${row.preset} floor ${[...names].join(',')}`)
    await flat.world.close()
  }

  const { dir, world } = await buildFixture(DATA_VERSION_26_3)
  const level = await fs.readFile(path.join(dir, 'level.dat'))
  const region = path.join(dir, 'dimensions/minecraft/overworld/region/r.0.0.mca')
  const before = await fs.readFile(region)
  const saved = await applyPaths(world, 'overworld', [{
    name: 'Trail',
    points: [{ x: 4, z: 3 }, { x: 13, z: 3 }],
    preset: 'trail',
    options: { ...DEFAULT_OPTIONS, dressing: 'off' }
  }])
  const trail = new Set<string>()
  for (let x = 6; x <= 11; x++) trail.add(world.getBlock('overworld', x, 63, 3).name)
  assert.ok([...trail].some(name => name === 'dirt_path' || name === 'rooted_dirt'), [...trail].join(','))
  assert.equal(world.getBlock('overworld', 2, 64, 2).name, 'chest')
  assert.equal(world.getBlock('overworld', 2, 63, 2).name, 'grass_block')
  const stored = await readStoredChunk(dir, DATA_VERSION_26_3, 'overworld', 0, 0)
  const chest = nbt.simplify(stored).block_entities.find((entity: any) => entity.id === 'minecraft:chest')
  assert.equal(chest.Items[0].id, 'minecraft:diamond')
  assert.ok(saved.backupDir)
  const backup = path.join(saved.backupDir as string, 'dimensions/minecraft/overworld/region/r.0.0.mca')
  assert.deepEqual(await fs.readFile(backup), before)
  assert.deepEqual(await fs.readFile(path.join(dir, 'level.dat')), level)
  assert.equal(world.getBlock('overworld', 10, 64, 3).name !== 'oak_log', true)
  assert.equal(world.getBlock('overworld', 0, 80, 0).name, 'cinnabar')
  await world.close()
})

test('follow changes a hill, tunnel carves, bridge spans, causeway fills', async () => {
  const follow = await buildFixture(DATA_VERSION_26_2)
  await applyPaths(follow.world, 'overworld', [{
    name: 'hill',
    points: [{ x: 8, z: 6 }, { x: 8, z: 13 }],
    preset: 'trail',
    options: { ...DEFAULT_OPTIONS, hills: 'follow' }
  }])
  const low = follow.world.getBlock('overworld', 8, 63, 6).name
  assert.ok(low === 'dirt_path' || low === 'rooted_dirt')
  const highNames = [67, 68, 69].map(y => follow.world.getBlock('overworld', 8, y, 12).name)
  assert.ok(highNames.some(name => name === 'dirt_path' || name === 'rooted_dirt'), highNames.join(','))
  await follow.world.close()

  const tunnel = await buildFixture(DATA_VERSION_26_2)
  await applyPaths(tunnel.world, 'overworld', [{
    name: 'bore',
    points: [{ x: 8, z: 6 }, { x: 8, z: 13 }],
    preset: 'cobble',
    options: { ...DEFAULT_OPTIONS, hills: 'tunnel', dressing: 'off' }
  }])
  assert.equal(tunnel.world.getBlock('overworld', 8, 65, 12).name, 'air')
  const lining = []
  for (let x = 4; x <= 12; x++) lining.push(tunnel.world.getBlock('overworld', x, 65, 12).name)
  assert.ok(lining.includes('stone_bricks'), lining.join(','))
  await tunnel.world.close()

  const bridge = await buildFixture(DATA_VERSION_26_3)
  await applyPaths(bridge.world, 'overworld', [{
    name: 'span',
    points: [{ x: 2, z: 15 }, { x: 13, z: 15 }],
    preset: 'trail',
    options: { ...DEFAULT_OPTIONS, water: 'bridge', dressing: 'off' }
  }])
  let plank = false
  let pier = false
  let gap = false
  for (let x = 0; x < 16; x++) {
    for (let y = 57; y <= 80; y++) {
      const name = bridge.world.getBlock('overworld', x, y, 15).name
      assert.notEqual(name, 'gravel')
      assert.notEqual(name, 'dirt_path')
      if (name !== 'oak_planks') continue
      plank = true
      if (bridge.world.getBlock('overworld', x, y - 3, 15).name === 'air') gap = true
      for (let foot = 57; foot < y; foot++) {
        if (bridge.world.getBlock('overworld', x, foot, 15).name === 'stone_bricks'
          && bridge.world.getBlock('overworld', x, foot + 1, 15).name === 'oak_log') pier = true
      }
    }
  }
  assert.ok(plank, 'timber deck')
  assert.ok(pier, 'log pier on a stone footing')
  assert.ok(gap, 'open span under the deck')
  await bridge.world.close()

  const cause = await buildFixture(DATA_VERSION_26_3)
  await applyPaths(cause.world, 'overworld', [{
    name: 'fill',
    points: [{ x: 2, z: 15 }, { x: 13, z: 15 }],
    preset: 'cobble',
    options: { ...DEFAULT_OPTIONS, water: 'causeway', dressing: 'off' }
  }])
  assert.equal(cause.world.getBlock('overworld', 7, 60, 15).name, 'cobblestone')
  const top = cause.world.getBlock('overworld', 7, 63, 15).name
  assert.ok(top === 'cobblestone' || top === 'mossy_cobblestone', top)
  await cause.world.close()
})

test('boardwalk keeps fences when dressing is off', async () => {
  const flat = await flatWorld(DATA_VERSION_26_2)
  await applyPaths(flat.world, 'overworld', [{
    name: 'planks',
    points: [{ x: 2, z: 8 }, { x: 13, z: 8 }],
    preset: 'boardwalk',
    options: { ...DEFAULT_OPTIONS, dressing: 'off' }
  }])
  let fences = 0
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      if (flat.world.getBlock('overworld', x, 64, z).name === 'spruce_fence') fences++
    }
  }
  assert.ok(fences > 0, 'boardwalk fences are part of the preset, not dressing')
  await flat.world.close()
})

test('corridor follows the spline instead of the control-point rectangle', () => {
  const points = [{ x: 0, z: 0 }, { x: 1000, z: 1000 }]
  const chunks = corridorChunks([{
    name: 'diagonal',
    points,
    preset: 'trail',
    options: { ...DEFAULT_OPTIONS, width: 'wide' }
  }])
  const keys = new Set(chunks.map(chunk => `${chunk.cx},${chunk.cz}`))
  assert.ok(keys.has('0,0'))
  assert.ok(keys.has('62,62'))
  assert.equal(keys.has('0,60'), false)
  const box = 63 * 63
  assert.ok(chunks.length < box / 5, `corridor ${chunks.length} should be far under the ${box} bounding box`)
  for (const sample of resample(points)) {
    const cx = Math.floor(sample.x / 16)
    const cz = Math.floor(sample.z / 16)
    assert.ok(keys.has(`${cx},${cz}`), `${cx},${cz}`)
  }
})

test('adaptive desert uses sandstone and backup restores the region', async () => {
  const { dir, world } = await buildFixture(DATA_VERSION_26_2)
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) world.setBiome('overworld', x, 64, z, 'desert')
  }
  const region = path.join(dir, 'dimensions/minecraft/overworld/region/r.0.0.mca')
  const before = await fs.readFile(region)
  const saved = await applyPaths(world, 'overworld', [{
    name: 'dunes',
    points: [{ x: 3, z: 9 }, { x: 12, z: 9 }],
    preset: 'adaptive',
    options: { ...DEFAULT_OPTIONS, dressing: 'off' }
  }])
  const name = world.getBlock('overworld', 7, 64, 9).name
  assert.ok(['smooth_sandstone', 'sandstone', 'smooth_sandstone_stairs'].includes(name), name)
  const backup = path.join(saved.backupDir as string, 'dimensions/minecraft/overworld/region/r.0.0.mca')
  await fs.copyFile(backup, region)
  await world.close()
  const { World } = await import('../src')
  const restored = await World.open(dir)
  await restored.preload('overworld', 0, 0, 15, 15)
  assert.equal(restored.getBlock('overworld', 7, 64, 9).name, 'grass_block')
  assert.deepEqual(await fs.readFile(region), before)
  await restored.close()
})

const BOUNDS = dimensionBounds('overworld')

function grassView(): ColumnView {
  return {
    get(_x, y) {
      if (y === 63) return { name: 'grass_block' }
      if (y >= 1 && y <= 62) return { name: 'dirt' }
      if (y === 0) return { name: 'bedrock' }
      return { name: 'air' }
    },
    biome() { return 'plains' },
    protected() { return false },
    ground() { return { y: 63, name: 'grass_block' } }
  }
}

function lakeView(): ColumnView {
  return {
    get(_x, y) {
      if (y >= 58 && y <= 62) return { name: 'water' }
      if (y >= 1 && y <= 57) return { name: 'stone' }
      if (y === 0) return { name: 'bedrock' }
      return { name: 'air' }
    },
    biome() { return 'plains' },
    protected() { return false },
    ground() { return { y: 62, name: 'water' } }
  }
}

function shoreView(): ColumnView {
  return {
    get(_x, y, z) {
      if (z >= 8) {
        if (y >= 58 && y <= 62) return { name: 'water' }
        if (y >= 1 && y <= 57) return { name: 'stone' }
        return { name: 'air' }
      }
      if (y === 63) return { name: 'grass_block' }
      if (y >= 1 && y <= 62) return { name: 'stone' }
      return { name: 'air' }
    },
    biome() { return 'plains' },
    protected() { return false },
    ground(_x, z) {
      return z >= 8 ? { y: 62, name: 'water' } : { y: 63, name: 'grass_block' }
    }
  }
}

test('tunnel does not enter water', async () => {
  const cells = await planPaths(shoreView(), [{
    name: 'bore',
    points: [{ x: 0, z: 2 }, { x: 0, z: 14 }],
    preset: 'cobble',
    options: { ...DEFAULT_OPTIONS, hills: 'tunnel', water: 'causeway', dressing: 'lined' }
  }], BOUNDS)
  assert.equal(cells.some(cell => cell.z >= 8), false)
  assert.ok(cells.some(cell => cell.z < 8 && cell.name === 'air'))
  assert.ok(cells.some(cell => cell.name === 'stone_bricks'))
})

test('dressing stays off the bridge and still dresses land', async () => {
  const water = [{ x: 0, z: 8 }, { x: 40, z: 8 }]
  const bare = await planPaths(lakeView(), [{
    name: 'road',
    points: water,
    preset: 'cobble',
    options: { ...DEFAULT_OPTIONS, dressing: 'off', water: 'bridge', design: 'timber' }
  }], BOUNDS)
  const lined = await planPaths(lakeView(), [{
    name: 'road',
    points: water,
    preset: 'cobble',
    options: { ...DEFAULT_OPTIONS, dressing: 'lined', water: 'bridge', design: 'timber' }
  }], BOUNDS)
  const sig = (cells: { x: number, y: number, z: number, name: string }[]) => cells.map(cell => `${cell.x},${cell.y},${cell.z},${cell.name}`).sort().join('|')
  assert.equal(sig(bare), sig(lined))
  assert.equal(bare.some(cell => cell.name === 'gravel' || cell.name === 'cobblestone'), false)
  assert.ok(bare.some(cell => cell.name === 'oak_fence'))
  assert.ok(bare.some(cell => cell.name === 'lantern'))

  const landOff = await planPaths(grassView(), [{
    name: 'road',
    points: [{ x: 0, z: 4 }, { x: 24, z: 4 }],
    preset: 'cobble',
    options: { ...DEFAULT_OPTIONS, dressing: 'off' }
  }], BOUNDS)
  const landLined = await planPaths(grassView(), [{
    name: 'road',
    points: [{ x: 0, z: 4 }, { x: 24, z: 4 }],
    preset: 'cobble',
    options: { ...DEFAULT_OPTIONS, dressing: 'lined' }
  }], BOUNDS)
  assert.equal(landOff.some(cell => cell.name === 'oak_fence'), false)
  assert.ok(landLined.some(cell => cell.name === 'oak_fence'))

  const sandOff = await planPaths(grassView(), [{
    name: 'sand',
    points: [{ x: 0, z: 4 }, { x: 20, z: 4 }],
    preset: 'sandstone',
    options: { ...DEFAULT_OPTIONS, dressing: 'off' }
  }], BOUNDS)
  const sandLined = await planPaths(grassView(), [{
    name: 'sand',
    points: [{ x: 0, z: 4 }, { x: 20, z: 4 }],
    preset: 'sandstone',
    options: { ...DEFAULT_OPTIONS, dressing: 'lined' }
  }], BOUNDS)
  assert.equal(sig(sandOff), sig(sandLined))
})

const SPAN = [{ x: 0, z: 8 }, { x: 48, z: 8 }]

function above(cells: { x: number, y: number, z: number, name: string }[], name: string, over: string): boolean {
  return cells.some(cell => cell.name === over && cells.some(other => other.name === name && other.x === cell.x && other.z === cell.z && other.y > cell.y))
}

test('each bridge design places its own blocks', async () => {
  async function span(design: 'dock' | 'timber' | 'arch' | 'masonry') {
    return planPaths(lakeView(), [{
      name: design,
      points: SPAN,
      preset: 'cobble',
      options: { ...DEFAULT_OPTIONS, water: 'bridge', dressing: 'lined', design }
    }], BOUNDS)
  }

  const dock = await span('dock')
  assert.ok(dock.some(cell => cell.name === 'oak_planks' && cell.y === 63))
  assert.ok(dock.some(cell => cell.name === 'oak_slab'))
  assert.ok(dock.some(cell => cell.name === 'oak_fence'))
  assert.ok(dock.some(cell => cell.name === 'lantern'))
  assert.ok(dock.some(cell => cell.name === 'oak_log' && cell.y <= 57))
  assert.ok(dock.some(cell => cell.name === 'oak_planks' && cell.y >= 67), 'roofed shelter')
  assert.equal(dock.some(cell => cell.name === 'stone_bricks' || cell.name === 'gravel' || cell.name === 'cobblestone'), false)

  const timber = await span('timber')
  assert.ok(timber.some(cell => cell.name === 'stone_bricks' && cell.y <= 57))
  assert.ok(above(timber, 'oak_log', 'stone_bricks'))
  assert.ok(above(timber, 'oak_planks', 'air'))
  assert.ok(timber.some(cell => cell.name === 'air' && !timber.some(stone => stone.name === 'stone_bricks' && stone.x === cell.x && stone.z === cell.z)))
  assert.ok(timber.some(cell => cell.name === 'oak_fence'))
  assert.ok(timber.some(cell => cell.name === 'lantern'))
  assert.equal(timber.some(cell => cell.name === 'gravel' || cell.name === 'dirt_path' || cell.name === 'cobblestone'), false)

  const arch = await span('arch')
  assert.ok(arch.some(cell => cell.name === 'stone_bricks' && cell.y <= 57))
  assert.ok(above(arch, 'stone_bricks', 'air'))
  assert.ok(arch.some(cell => cell.name === 'stone_brick_wall'))
  assert.equal(arch.some(cell => cell.name === 'gravel' || cell.name === 'dirt' || cell.name === 'dirt_path' || cell.name === 'sand' || cell.name === 'lantern' || cell.name === 'oak_fence' || cell.name === 'cobblestone'), false)

  const masonry = await span('masonry')
  assert.ok(masonry.some(cell => cell.name === 'stone_bricks' && cell.y <= 57))
  assert.ok(masonry.some(cell => cell.name === 'dirt_path'))
  assert.ok(masonry.some(cell => cell.name === 'sand'))
  assert.ok(masonry.some(cell => cell.name === 'lantern'))
  assert.ok(above(masonry, 'stone_bricks', 'air'))
  assert.equal(masonry.some(cell => (cell.name === 'dirt_path' || cell.name === 'sand') && cell.y <= 62), false)
  assert.equal(masonry.some(cell => cell.name === 'gravel' || cell.name === 'cobblestone'), false)
})

test('a gravel or path preset does not become the bridge', async () => {
  for (const design of ['dock', 'timber', 'arch', 'masonry'] as const) {
    const cells = await planPaths(lakeView(), [{
      name: design,
      points: SPAN,
      preset: 'cobble',
      options: { ...DEFAULT_OPTIONS, water: 'bridge', dressing: 'lined', design }
    }], BOUNDS)
    assert.equal(cells.some(cell => cell.name === 'gravel'), false, design)
  }
  const trail = await planPaths(lakeView(), [{
    name: 'trail',
    points: SPAN,
    preset: 'trail',
    options: { ...DEFAULT_OPTIONS, water: 'bridge', dressing: 'off', design: 'timber' }
  }], BOUNDS)
  assert.equal(trail.some(cell => cell.name === 'dirt_path' || cell.name === 'gravel' || cell.name === 'coarse_dirt' || cell.name === 'rooted_dirt' || cell.name === 'dirt'), false)
})

test('a saved path without a design builds timber', async () => {
  const cells = await planPaths(lakeView(), [{
    name: 'old',
    points: SPAN,
    preset: 'trail',
    options: { width: 'normal', hills: 'follow', water: 'bridge', dressing: 'off' } as typeof DEFAULT_OPTIONS
  }], BOUNDS)
  assert.ok(cells.some(cell => cell.name === 'oak_log'))
  assert.ok(cells.some(cell => cell.name === 'stone_bricks'))
  assert.equal(cells.some(cell => cell.name === 'dirt_path' || cell.name === 'gravel'), false)
})

test('bridge stays on the water and land keeps the preset', async () => {
  const shore = 16
  const cells = await planPaths({
    get(_x, y, z) {
      if (z >= shore) {
        if (y >= 58 && y <= 62) return { name: 'water' }
        if (y >= 1 && y <= 57) return { name: 'stone' }
        return { name: 'air' }
      }
      if (y === 63) return { name: 'grass_block' }
      if (y >= 1 && y <= 62) return { name: 'stone' }
      return { name: 'air' }
    },
    biome() { return 'plains' },
    protected() { return false },
    ground(_x, z) {
      return z >= shore ? { y: 62, name: 'water' } : { y: 63, name: 'grass_block' }
    }
  }, [{
    name: 'cross',
    points: [{ x: 0, z: 0 }, { x: 0, z: 40 }],
    preset: 'cobble',
    options: { ...DEFAULT_OPTIONS, water: 'bridge', dressing: 'lined', design: 'arch' }
  }], BOUNDS)
  const land = cells.filter(cell => cell.z < shore)
  const wet = cells.filter(cell => cell.z >= shore)
  assert.ok(land.some(cell => cell.name === 'cobblestone' || cell.name === 'mossy_cobblestone'))
  assert.ok(land.some(cell => cell.name === 'gravel'))
  assert.ok(land.some(cell => cell.name === 'oak_fence'))
  assert.ok(wet.some(cell => cell.name === 'stone_bricks'))
  assert.ok(wet.some(cell => cell.name === 'air'))
  assert.equal(wet.some(cell => cell.name === 'gravel' || cell.name === 'cobblestone' || cell.name === 'oak_fence' || cell.name === 'dirt_path'), false)
})

test('preview drops clean columns and a cancel returns nothing', async () => {
  const flat = await flatWorld(DATA_VERSION_26_2)
  await flat.world.save()
  const pathSpec = {
    name: 't',
    points: [{ x: 2, z: 8 }, { x: 13, z: 8 }],
    preset: 'trail' as const,
    options: { ...DEFAULT_OPTIONS }
  }
  const cells = await previewPaths(flat.world, 'overworld', [pathSpec])
  assert.ok(cells.length > 0)
  assert.equal(flat.world.columnOf('overworld', 0, 0), null)
  const stopped = await previewPaths(flat.world, 'overworld', [pathSpec], { cancelled: () => true })
  assert.deepEqual(stopped, [])
  await flat.world.close()
})
