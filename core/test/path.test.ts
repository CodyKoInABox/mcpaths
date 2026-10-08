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
  createWorld,
  readStoredChunk,
  sampleMap,
  type PresetId
} from '../src'
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
  const deck = bridge.world.getBlock('overworld', 7, 63, 15).name
  assert.ok(deck === 'dirt_path' || deck === 'rooted_dirt', deck)
  assert.notEqual(bridge.world.getBlock('overworld', 7, 60, 15).name, 'air')
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
