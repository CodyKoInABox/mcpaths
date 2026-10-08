import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import nbt from 'prismarine-nbt'
import { DATA_VERSION_26_2, DATA_VERSION_26_3, readStoredChunk, World } from '../src'
import { buildFixture, snapshot } from './fixture'

for (const dataVersion of [DATA_VERSION_26_2, DATA_VERSION_26_3]) {
  test(`round-trip blocks, entity, and chest at data version ${dataVersion}`, async () => {
    const { dir, world } = await buildFixture(dataVersion)
    const before = await snapshot(world)
    const levelBefore = await fs.readFile(`${dir}/level.dat`)
    await world.close()

    const reopened = await World.open(dir)
    await reopened.preload('overworld', 0, 0, 15, 15)
    assert.deepEqual(await snapshot(reopened), before)
    reopened.rewriteLoaded()
    await reopened.save()
    const after = await snapshot(reopened)
    assert.deepEqual(after, before)

    const stored = await readStoredChunk(dir, dataVersion, 'overworld', 0, 0)
    assert.equal(stored.value.DataVersion.value, dataVersion)
    assert.notEqual(stored.value.DataVersion.value, 4671)
    const simple = nbt.simplify(stored)
    const chest = simple.block_entities.find((entity: any) => entity.id === 'minecraft:chest')
    assert.equal(chest.Items[0].id, 'minecraft:diamond')
    assert.equal(chest.Items[0].count, 3)
    assert.equal(simple.entities[0].id, 'minecraft:pig')
    const levelAfter = await fs.readFile(`${dir}/level.dat`)
    assert.deepEqual(levelAfter, levelBefore)
    await reopened.close()
  })
}
