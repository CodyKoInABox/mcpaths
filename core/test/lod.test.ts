import assert from 'node:assert/strict'
import test from 'node:test'
import { DATA_VERSION_26_2 } from '../src/versions'
import {
  DETAIL_CHUNK_BUDGET,
  farPixelsPerBlock,
  MIN_PIXELS_PER_BLOCK,
  OVERVIEW_COLUMNS,
  sampleOverview,
  sliderToZoom,
  viewLod,
  zoomToSlider
} from '../src'
import { buildFixture } from './fixture'

test('lod stays detailed inside the chunk budget and switches past it', () => {
  assert.equal(viewLod(8, 12, DETAIL_CHUNK_BUDGET), 'detail')
  assert.equal(viewLod(10, 10), 'overview')
  assert.equal(viewLod(1, 1), 'detail')
  assert.equal(viewLod(0, 40), 'detail')
})

test('far zoom fits the explored area and is much wider than the old 0.5 floor', () => {
  const wide = farPixelsPerBlock(1000, 800, 10000, 10000)
  assert.ok(Math.abs(wide - 800 / (10000 * 1.3)) < 1e-9)
  assert.ok(wide < 0.5)
  assert.ok(1000 / wide >= 10000)

  const tiny = farPixelsPerBlock(1000, 800, 200, 200)
  assert.ok(Math.abs(tiny - 800 / 4096) < 1e-9)
  assert.ok(tiny < 0.5)

  const huge = farPixelsPerBlock(1000, 800, 500000, 500000)
  assert.equal(huge, MIN_PIXELS_PER_BLOCK)
  assert.ok(1000 / huge >= 200000)
})

test('zoom slider is logarithmic and round-trips', () => {
  const min = 0.02
  const max = 32
  const mid = sliderToZoom(0.5, min, max)
  assert.ok(Math.abs(mid - Math.sqrt(min * max)) < 1e-9)
  assert.ok(Math.abs(zoomToSlider(mid, min, max) - 0.5) < 1e-9)
  assert.equal(sliderToZoom(0, min, max), min)
  assert.ok(Math.abs(sliderToZoom(1, min, max) - max) < 1e-9)
})

test('overview samples four columns, eight blocks apart', () => {
  assert.equal(OVERVIEW_COLUMNS.length, 4)
  assert.deepEqual([...OVERVIEW_COLUMNS[0]], [4, 4])
  assert.deepEqual([...OVERVIEW_COLUMNS[3]], [12, 12])
  assert.equal(OVERVIEW_COLUMNS[1][0] - OVERVIEW_COLUMNS[0][0], 8)
})

test('overview colors a chunk from four columns and caches it', async () => {
  const { world } = await buildFixture(DATA_VERSION_26_2)
  const first = await sampleOverview(world, 'overworld', [{ cx: 0, cz: 0 }])
  assert.equal(first.aborted, false)
  assert.equal(first.failed, 0)
  assert.deepEqual(first.cx, [0])
  assert.equal(first.rgb.length, 12)
  assert.ok(first.rgb.some(byte => byte > 40))

  const again = await sampleOverview(world, 'overworld', [{ cx: 0, cz: 0 }])
  assert.deepEqual(again.rgb, first.rgb)

  const missing = await sampleOverview(world, 'overworld', [{ cx: 40, cz: 40 }])
  assert.equal(missing.rgb.length, 12)
  assert.equal(missing.failed, 0)

  world.setBlock('overworld', 4, 63, 4, 'stone')
  const changed = await sampleOverview(world, 'overworld', [{ cx: 0, cz: 0 }])
  assert.notDeepEqual(Buffer.from(changed.rgb.subarray(0, 3)), Buffer.from(first.rgb.subarray(0, 3)))
  await world.close()
})
