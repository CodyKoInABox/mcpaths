import assert from 'node:assert/strict'
import test from 'node:test'
import { isAir, isHeadroom, isLeaves, isLog } from '../src/blocks'
import { profileOf } from '../src/codec'
import { measureHeightmaps } from '../src/heightmap'
import { DATA_VERSION_26_2, dimensionBounds } from '../src/versions'
import { buildFixture } from './fixture'

test('section scans match a per-block walk', async () => {
  const { world } = await buildFixture(DATA_VERSION_26_2)
  await world.preload('overworld', 0, 0, 15, 15)
  const bounds = dimensionBounds('overworld')
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      let slow: { y: number, name: string } | null = null
      for (let y = bounds.maxY; y >= bounds.minY; y--) {
        const name = world.getBlock('overworld', x, y, z).name
        if (isAir(name) || isHeadroom(name) || isLeaves(name) || isLog(name)) continue
        slow = { y, name }
        break
      }
      assert.deepEqual(world.groundBlock('overworld', x, z), slow, `${x},${z}`)
      assert.deepEqual(world.groundBlock('overworld', x, z), slow, `${x},${z} cached`)
    }
  }
  assert.equal(world.isProtectedColumn('overworld', 2, 2), true)
  assert.equal(world.isProtectedColumn('overworld', 0, 0), false)
  assert.equal(world.isProtectedColumn('overworld', 8, 15), false)

  const column = world.columnOf('overworld', 0, 0)
  const fast = measureHeightmaps(column, profileOf)
  const surface = new Int16Array(256)
  const motion = new Int16Array(256)
  const motionNoLeaves = new Int16Array(256)
  const minY = column.minY as number
  const maxY = minY + column.worldHeight - 1
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i = z * 16 + x
      for (let y = maxY; y >= minY; y--) {
        const block = column.getBlock({ x, y, z })
        const name = block?.name || 'air'
        const yVal = y - minY + 1
        if (surface[i] === 0 && !isAir(name)) surface[i] = yVal
        const solid = block?.boundingBox === 'block'
        if (motion[i] === 0 && solid) motion[i] = yVal
        if (motionNoLeaves[i] === 0 && solid && !isLeaves(name)) motionNoLeaves[i] = yVal
        if (surface[i] && motion[i] && motionNoLeaves[i]) break
      }
    }
  }
  assert.deepEqual(Array.from(fast.surface), Array.from(surface))
  assert.deepEqual(Array.from(fast.motion), Array.from(motion))
  assert.deepEqual(Array.from(fast.motionNoLeaves), Array.from(motionNoLeaves))
  await world.close()
})
