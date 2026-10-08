import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import nbt from 'prismarine-nbt'
import {
  DATA_VERSION_26_2,
  DATA_VERSION_26_3,
  applyPaths,
  createWorld,
  DEFAULT_OPTIONS,
  readStoredChunk,
  supportForDataVersion
} from '../src'

test('26.2 keeps Name palettes and data version 4903', async () => {
  const world = await paintFlat(DATA_VERSION_26_2)
  await applyPaths(world.world, 'overworld', [{
    name: 'Trail',
    points: [{ x: 2, z: 8 }, { x: 12, z: 8 }],
    preset: 'trail',
    options: DEFAULT_OPTIONS
  }])
  const stored = await readStoredChunk(world.dir, DATA_VERSION_26_2, 'overworld', 0, 0)
  assert.equal(stored.value.DataVersion.value, 4903)
  assertPalette(stored, 'name')
  assert.equal(world.world.getBlock('overworld', 6, 63, 8).name === 'dirt_path' || world.world.getBlock('overworld', 6, 63, 8).name === 'rooted_dirt', true)
  await world.world.close()
})

test('26.3 string palette loads, and a path write stays on data version 5023', async () => {
  const { dir, world } = await createEmpty(DATA_VERSION_26_3)
  await writeStringPaletteChunk(dir)
  await world.close()
  const opened = await (await import('../src')).World.open(dir)
  await opened.preload('overworld', 0, 0, 15, 15)
  assert.equal(opened.getBlock('overworld', 1, 64, 1).name, 'stone')
  opened.setBlock('overworld', 1, 64, 1, 'dirt')
  await opened.save()
  const stored = await readStoredChunk(dir, DATA_VERSION_26_3, 'overworld', 0, 0)
  assert.equal(stored.value.DataVersion.value, 5023)
  assert.notEqual(stored.value.DataVersion.value, 4671)
  assertPalette(stored, 'id')
  assert.equal(nbt.simplify(stored).sections.some((section: any) => JSON.stringify(section.block_states.palette).includes('dirt')), true)
  await opened.close()
})

test('1.21.1 writes the legacy region folder and keeps data version 3955', async () => {
  const world = await paintFlat(3955)
  await applyPaths(world.world, 'overworld', [{
    name: 'Trail',
    points: [{ x: 2, z: 8 }, { x: 10, z: 8 }],
    preset: 'trail',
    options: DEFAULT_OPTIONS
  }])
  const stored = await readStoredChunk(world.dir, 3955, 'overworld', 0, 0)
  assert.equal(stored.value.DataVersion.value, 3955)
  assertPalette(stored, 'name')
  const legacy = require('node:path').join(world.dir, 'region', 'r.0.0.mca')
  const modern = require('node:path').join(world.dir, 'dimensions/minecraft/overworld/region/r.0.0.mca')
  assert.equal(require('node:fs').existsSync(legacy), true)
  assert.equal(require('node:fs').existsSync(modern), false)
  await world.world.close()
})

test('support labels do not call 26.2 or 26.3 a 1.21 world', () => {
  assert.equal(supportForDataVersion(DATA_VERSION_26_2).label, '26.2')
  assert.equal(supportForDataVersion(DATA_VERSION_26_3).label, '26.3')
  assert.equal(supportForDataVersion(DATA_VERSION_26_2).codec, '1.21.11')
  assert.equal(supportForDataVersion(DATA_VERSION_26_3).palette, 'id')
  assert.equal(supportForDataVersion(3955).label, '1.21.1')
})

async function paintFlat(dataVersion: number) {
  const dir = await fs.mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'mcpaths-flat-'))
  const world = await createWorld(dir, { dataVersion, name: 'flat' })
  await world.ensureChunk('overworld', 0, 0)
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      world.setBlock('overworld', x, 62, z, 'dirt')
      world.setBlock('overworld', x, 63, z, 'grass_block')
      world.setBiome('overworld', x, 64, z, 'plains')
    }
  }
  await world.save()
  return { dir, world }
}

async function createEmpty(dataVersion: number) {
  const dir = await fs.mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'mcpaths-empty-'))
  const world = await createWorld(dir, { dataVersion, name: 'empty' })
  return { dir, world }
}

async function writeStringPaletteChunk(dir: string) {
  const RegionFile = require('prismarine-provider-anvil/src/region')
  const file = require('node:path').join(dir, 'dimensions/minecraft/overworld/region/r.0.0.mca')
  await fs.mkdir(require('node:path').dirname(file), { recursive: true })
  const tag = nbt.comp({
    DataVersion: nbt.int(DATA_VERSION_26_3),
    xPos: nbt.int(0),
    zPos: nbt.int(0),
    yPos: nbt.int(-4),
    Status: nbt.string('minecraft:full'),
    LastUpdate: nbt.long([0, 0]),
    InhabitedTime: nbt.long([0, 0]),
    block_entities: nbt.list(nbt.comp([])),
    sections: nbt.list(nbt.comp([{
      Y: nbt.byte(4),
      block_states: nbt.comp({
        palette: nbt.list(nbt.string(['minecraft:stone']))
      }),
      biomes: nbt.comp({
        palette: nbt.list(nbt.string(['minecraft:plains']))
      })
    }]))
  }, '')
  const region = new RegionFile(file)
  await region.initialize()
  await region.write(0, 0, tag)
  await region.close()
}

function assertPalette(tag: any, schema: 'name' | 'id') {
  for (const section of tag.value.sections.value.value) {
    const palette = section.block_states?.value?.palette
    if (!palette) continue
    if (schema === 'name') {
      assert.equal(palette.value.type, 'compound')
      for (const entry of palette.value.value) assert.ok(entry.Name, '26.2 palette entry missing Name')
    } else if (palette.value.type === 'string') {
      assert.ok(palette.value.value.length > 0)
    } else {
      for (const entry of palette.value.value) {
        assert.equal(entry.Name, undefined)
        assert.ok(entry.id, '26.3 palette entry missing id')
      }
    }
  }
}
