import assert from 'node:assert/strict'
import test from 'node:test'
import { scanViewport, type RegionBits } from '../src/viewscan'

function bitSet(present: Uint8Array, index: number): boolean {
  return (present[index >> 3] & (1 << (index & 7))) !== 0
}

function setBit(present: Uint8Array, lx: number, lz: number) {
  const index = (lz << 5) | lx
  present[index >> 3] |= 1 << (index & 7)
}

function mask(rx: number, rz: number, fill: 'all' | number[]): RegionBits {
  const present = new Uint8Array(128)
  if (fill === 'all') present.fill(255)
  else for (const index of fill) present[index >> 3] |= 1 << (index & 7)
  return { rx, rz, present }
}

/** Full occupied list, same region order as scanViewport. The overview path must match a decimation of this. */
function slowChunks(
  originX: number,
  originZ: number,
  spanX: number,
  spanZ: number,
  masks: Map<string, Uint8Array>,
  list: RegionBits[]
): { cx: number, cz: number }[] {
  const maxX = originX + spanX
  const maxZ = originZ + spanZ
  const c0x = Math.floor(originX / 16)
  const c1x = Math.floor(maxX / 16)
  const c0z = Math.floor(originZ / 16)
  const c1z = Math.floor(maxZ / 16)
  const r0x = Math.floor(c0x / 32)
  const r1x = Math.floor(c1x / 32)
  const r0z = Math.floor(c0z / 32)
  const r1z = Math.floor(c1z / 32)
  const regionSpan = (r1x - r0x + 1) * (r1z - r0z + 1)
  const chunks: { cx: number, cz: number }[] = []
  const push = (rx: number, rz: number, present: Uint8Array) => {
    const lx0 = Math.max(0, c0x - rx * 32)
    const lx1 = Math.min(31, c1x - rx * 32)
    const lz0 = Math.max(0, c0z - rz * 32)
    const lz1 = Math.min(31, c1z - rz * 32)
    if (lx0 > lx1 || lz0 > lz1) return
    for (let lz = lz0; lz <= lz1; lz++) {
      for (let lx = lx0; lx <= lx1; lx++) {
        if (bitSet(present, (lz << 5) | lx)) chunks.push({ cx: rx * 32 + lx, cz: rz * 32 + lz })
      }
    }
  }
  if (list.length > 0 && list.length < regionSpan) {
    for (const entry of list) {
      if (entry.rx < r0x || entry.rx > r1x || entry.rz < r0z || entry.rz > r1z) continue
      push(entry.rx, entry.rz, entry.present)
    }
    return chunks
  }
  for (let rz = r0z; rz <= r1z; rz++) {
    for (let rx = r0x; rx <= r1x; rx++) {
      const present = masks.get(`${rx},${rz}`)
      if (present) push(rx, rz, present)
    }
  }
  return chunks
}

function slowDecimate(chunks: { cx: number, cz: number }[], stride: number) {
  const cells = new Map<string, { cx: number, cz: number, sx: number, sz: number }>()
  for (const chunk of chunks) {
    const sx = Math.floor(chunk.cx / stride) * stride
    const sz = Math.floor(chunk.cz / stride) * stride
    const key = `${sx},${sz}`
    if (!cells.has(key)) cells.set(key, { cx: chunk.cx, cz: chunk.cz, sx, sz })
  }
  return [...cells.values()]
}

function expectScan(
  originX: number,
  originZ: number,
  spanX: number,
  spanZ: number,
  list: RegionBits[]
) {
  const masks = new Map(list.map(entry => [`${entry.rx},${entry.rz}`, entry.present]))
  const scanned = scanViewport(originX, originZ, spanX, spanZ, masks, list)
  const all = slowChunks(originX, originZ, spanX, spanZ, masks, list)
  assert.equal(scanned.count, all.length)
  if (scanned.stride === 1) {
    assert.deepEqual(scanned.chunks, all)
    assert.deepEqual(scanned.picks, [])
  } else {
    assert.deepEqual(scanned.chunks, [])
    assert.deepEqual(scanned.picks, slowDecimate(all, scanned.stride))
    assert.ok(scanned.picks.length < all.length)
  }
}

test('detail zoom lists every occupied chunk, including a clipped negative region', () => {
  const present = new Uint8Array(128)
  setBit(present, 1, 1)
  setBit(present, 2, 1)
  setBit(present, 31, 31)
  const list = [{ rx: -1, rz: -1, present }]
  // Chunk (-31, -31) is local (1, 1) of region (-1, -1). The window clips before local 31.
  expectScan(-31 * 16, -31 * 16, 40, 40, list)
  const masks = new Map([['-1,-1', present]])
  const scanned = scanViewport(-31 * 16, -31 * 16, 40, 40, masks, list)
  assert.equal(scanned.stride, 1)
  assert.deepEqual(scanned.chunks, [{ cx: -31, cz: -31 }, { cx: -30, cz: -31 }])
})

test('overview keeps the first occupied chunk per stride cell and does not allocate the full list', () => {
  const filled = mask(0, 0, 'all')
  const neighbor = mask(1, 0, 'all')
  expectScan(0, 0, 511, 511, [filled])
  expectScan(0, 0, 40 * 16, 40 * 16, [filled, neighbor])
  const masks = new Map([['0,0', filled.present], ['1,0', neighbor.present]])
  const wide = scanViewport(-32, -32, 96 * 16, 40 * 16, masks, [neighbor, filled])
  const all = slowChunks(-32, -32, 96 * 16, 40 * 16, masks, [neighbor, filled])
  assert.ok(all.length > 128)
  assert.deepEqual(wide.chunks, [])
  assert.deepEqual(wide.picks, slowDecimate(all, wide.stride))
})

test('a full region popcount matches the bit walk', () => {
  const list = [mask(3, -2, 'all')]
  const masks = new Map(list.map(entry => [`${entry.rx},${entry.rz}`, entry.present]))
  const originX = 3 * 32 * 16
  const originZ = -2 * 32 * 16
  const scanned = scanViewport(originX, originZ, 511, 511, masks, list)
  assert.equal(scanned.count, 1024)
  assert.equal(scanned.chunks.length, 0)
  assert.ok(scanned.picks.length < 400)
})
