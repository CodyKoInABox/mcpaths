import assert from 'node:assert/strict'
import test from 'node:test'
import { gridAddress } from '../src/grid'
import { gameTypeFromLevel, lastPlayedFromLevel, levelDisplayName, nbtNumber, playerFromLevel } from '../src/names'

test('level name falls back to the folder for blank, missing, and byte strings', () => {
  assert.equal(levelDisplayName('Survey', 'New World'), 'Survey')
  assert.equal(levelDisplayName('  ', 'New World'), 'New World')
  assert.equal(levelDisplayName(undefined, 'New World'), 'New World')
  assert.equal(levelDisplayName(Buffer.from('Byte World'), 'folder'), 'Byte World')
  assert.equal(levelDisplayName([...Buffer.from('Byte World')], 'folder'), 'Byte World')
  assert.equal(levelDisplayName({ type: 'string', value: 'Nested' }, 'folder'), 'Nested')
  assert.equal(levelDisplayName(Buffer.from('Pad\u0000'), 'folder'), 'Pad')
})

test('prismarine longs and player position decode', () => {
  assert.equal(nbtNumber(12), 12)
  assert.equal(nbtNumber([0, 123456]), 123456)
  assert.equal(nbtNumber([1, 0]), 4294967296)
  assert.equal(nbtNumber([-1, -1]), -1)
  const data = {
    GameType: 1,
    LastPlayed: [0, 123456],
    Player: {
      Pos: [12.5, 70, -4.25],
      Dimension: 'minecraft:the_nether'
    }
  }
  assert.equal(gameTypeFromLevel(data), 'creative')
  assert.equal(lastPlayedFromLevel(data), 123456)
  assert.deepEqual(playerFromLevel(data), { x: 12.5, y: 70, z: -4.25, dimension: 'nether' })
  assert.equal(playerFromLevel({}), null)
  assert.equal(gameTypeFromLevel({}), null)
})

test('negative blocks land in the previous region', () => {
  assert.deepEqual(gridAddress(0, 0), { chunkX: 0, chunkZ: 0, regionX: 0, regionZ: 0, localX: 0, localZ: 0 })
  assert.deepEqual(gridAddress(-1, -1), { chunkX: -1, chunkZ: -1, regionX: -1, regionZ: -1, localX: 31, localZ: 31 })
  assert.deepEqual(gridAddress(512, -16), { chunkX: 32, chunkZ: -1, regionX: 1, regionZ: -1, localX: 0, localZ: 31 })
})
