import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import nbt from 'prismarine-nbt'
import zlib from 'node:zlib'
import { DATA_VERSION_26_2, createWorld, describeSave, readWorldInfo, regionDirectory } from '../src'

test('readWorldInfo uses LevelName and keeps the folder when the name is blank', async () => {
  const named = await createWorld(await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-name-')), {
    dataVersion: DATA_VERSION_26_2,
    name: 'Survey World',
    spawn: { x: 4, y: 80, z: -12 }
  })
  assert.equal(named.info.name, 'Survey World')
  assert.equal(named.info.folder, path.basename(named.info.path))
  assert.deepEqual(named.info.spawn, { x: 4, y: 80, z: -12 })
  await named.close()

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-noname-'))
  const folder = path.basename(dir)
  const tag = nbt.comp({
    Data: nbt.comp({
      DataVersion: nbt.int(DATA_VERSION_26_2),
      LevelName: nbt.string('   '),
      SpawnX: nbt.int(0),
      SpawnY: nbt.int(64),
      SpawnZ: nbt.int(0)
    })
  }, '')
  await fs.writeFile(path.join(dir, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(tag as any)))
  const info = await readWorldInfo(dir)
  assert.equal(info.name, folder)
})

test('byte-array LevelName and corrupt level.dat still yield a folder name', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-bytes-'))
  const tag = nbt.comp({
    Data: nbt.comp({
      DataVersion: nbt.int(3955),
      LevelName: nbt.byteArray([...Buffer.from('Byte World', 'utf8')]),
      GameType: nbt.int(0),
      LastPlayed: nbt.long([0, 123456]),
      SpawnX: nbt.int(10),
      SpawnY: nbt.int(64),
      SpawnZ: nbt.int(-20),
      Player: nbt.comp({
        Pos: nbt.list(nbt.double([3.5, 70, 8])),
        Dimension: nbt.string('minecraft:overworld')
      })
    })
  }, '')
  await fs.writeFile(path.join(dir, 'level.dat'), zlib.gzipSync(nbt.writeUncompressed(tag as any)))
  const info = await readWorldInfo(dir)
  assert.equal(info.name, 'Byte World')
  assert.equal(info.gameType, 'survival')
  assert.equal(info.lastPlayed, 123456)
  assert.equal(info.player?.dimension, 'overworld')
  assert.equal(info.player?.x, 3.5)

  const broken = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-bad-'))
  await fs.writeFile(path.join(broken, 'level.dat'), Buffer.from('not nbt'))
  const listing = await describeSave(broken)
  assert.equal(listing.name, path.basename(broken))
  assert.ok(listing.error)
})

test('region directory follows the folder that actually contains mca files', async () => {
  const modernOnly = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-modern-'))
  const modern = path.join(modernOnly, 'dimensions', 'minecraft', 'overworld', 'region')
  await fs.mkdir(path.join(modernOnly, 'region'), { recursive: true })
  await fs.mkdir(modern, { recursive: true })
  await fs.writeFile(path.join(modern, 'r.0.0.mca'), Buffer.alloc(0))
  assert.equal(regionDirectory(modernOnly, 'overworld', 3955), modern)

  const legacyOnly = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-legacy-'))
  const legacy = path.join(legacyOnly, 'region')
  await fs.mkdir(path.join(legacyOnly, 'dimensions', 'minecraft', 'overworld', 'region'), { recursive: true })
  await fs.mkdir(legacy, { recursive: true })
  await fs.writeFile(path.join(legacy, 'r.-1.2.mca'), Buffer.alloc(0))
  assert.equal(regionDirectory(legacyOnly, 'overworld', DATA_VERSION_26_2), legacy)

  const neither = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-empty-'))
  assert.equal(
    regionDirectory(neither, 'overworld', DATA_VERSION_26_2),
    path.join(neither, 'dimensions', 'minecraft', 'overworld', 'region')
  )
  assert.equal(regionDirectory(neither, 'nether', 3955), path.join(neither, 'DIM-1', 'region'))
})
