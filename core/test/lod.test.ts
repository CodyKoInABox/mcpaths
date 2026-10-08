import assert from 'node:assert/strict'
import test from 'node:test'
import { DATA_VERSION_26_2 } from '../src/versions'
import {
  CHUNK_TILE,
  CHUNK_TILE_BYTES,
  DETAIL_CHUNK_CAP,
  farPixelsPerBlock,
  MIN_PIXELS_PER_BLOCK,
  sampleTiles,
  sliderToZoom,
  viewStride,
  zoomToSlider
} from '../src'
import { buildFixture } from './fixture'

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

function uniqueColors(rgb: Uint8Array): number {
  const seen = new Set<string>()
  for (let i = 0; i < rgb.length; i += 3) seen.add(`${rgb[i]},${rgb[i + 1]},${rgb[i + 2]}`)
  return seen.size
}

test('overview stride stays near a few hundred samples', () => {
  assert.equal(viewStride(1), 1)
  assert.equal(viewStride(DETAIL_CHUNK_CAP), 1)
  assert.ok(viewStride(DETAIL_CHUNK_CAP + 1) >= 2)
  const stride = viewStride(40000)
  assert.ok(stride >= 2)
  assert.ok(Math.ceil(40000 / (stride * stride)) < 800)
})

test('color tiles are 3 bytes and release the decoded column', async () => {
  const { world } = await buildFixture(DATA_VERSION_26_2)
  const color = await sampleTiles(world, 'overworld', [{ cx: 0, cz: 0 }], { quality: 'color', release: true })
  assert.equal(color.aborted, false)
  assert.equal(color.rgb.length, 3)
  assert.ok(color.rgb.some(byte => byte > 40))
  assert.equal(world.columnOf('overworld', 0, 0), null)
  const again = await sampleTiles(world, 'overworld', [{ cx: 0, cz: 0 }], { quality: 'color', release: true })
  assert.deepEqual(again.rgb, color.rgb)
  await world.close()
})

test('chunk tiles are one color per block and stay cached', async () => {
  const { world } = await buildFixture(DATA_VERSION_26_2)
  const first = await sampleTiles(world, 'overworld', [{ cx: 0, cz: 0 }, { cx: 40, cz: 40 }])
  assert.equal(first.aborted, false)
  assert.equal(CHUNK_TILE, 16)
  assert.equal(first.rgb.length, 2 * CHUNK_TILE_BYTES)
  assert.deepEqual(first.cx, [0, 40])
  const grass = first.rgb.subarray(0, CHUNK_TILE_BYTES)
  assert.ok(uniqueColors(grass) > 4)
  assert.ok(grass.some(byte => byte > 40))

  const again = await sampleTiles(world, 'overworld', [{ cx: 0, cz: 0 }])
  assert.deepEqual(again.rgb, grass)

  const pixel = (4 * 16 + 4) * 3
  world.setBlock('overworld', 4, 63, 4, 'stone')
  const changed = await sampleTiles(world, 'overworld', [{ cx: 0, cz: 0 }])
  assert.equal(changed.rgb.length, CHUNK_TILE_BYTES)
  assert.notDeepEqual(Buffer.from(changed.rgb.subarray(pixel, pixel + 3)), Buffer.from(grass.subarray(pixel, pixel + 3)))
  await world.close()
})
