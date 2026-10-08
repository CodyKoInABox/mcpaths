import { DETAIL_CHUNK_CAP, viewStride } from './lod'

export interface RegionBits {
  rx: number
  rz: number
  present: Uint8Array
}

export interface ChunkPick {
  cx: number
  cz: number
  sx: number
  sz: number
}

interface Window {
  c0x: number
  c1x: number
  c0z: number
  c1z: number
  r0x: number
  r1x: number
  r0z: number
  r1z: number
}

const BYTE_BITS = new Uint8Array(256)
for (let i = 1; i < 256; i++) BYTE_BITS[i] = (i & 1) + BYTE_BITS[i >> 1]

function windowOf(originX: number, originZ: number, spanX: number, spanZ: number): Window {
  const maxX = originX + spanX
  const maxZ = originZ + spanZ
  const c0x = Math.floor(originX / 16)
  const c1x = Math.floor(maxX / 16)
  const c0z = Math.floor(originZ / 16)
  const c1z = Math.floor(maxZ / 16)
  return {
    c0x, c1x, c0z, c1z,
    r0x: Math.floor(c0x / 32),
    r1x: Math.floor(c1x / 32),
    r0z: Math.floor(c0z / 32),
    r1z: Math.floor(c1z / 32)
  }
}

function bitSet(present: Uint8Array, index: number): boolean {
  return (present[index >> 3] & (1 << (index & 7))) !== 0
}

type Visit = (
  rx: number,
  rz: number,
  present: Uint8Array,
  lx0: number,
  lx1: number,
  lz0: number,
  lz1: number
) => void

/** Same region order as the old per-chunk list: existing masks when the view is mostly empty, else rx/rz scan. */
function eachRegion(bounds: Window, masks: Map<string, Uint8Array>, list: RegionBits[], visit: Visit) {
  const regionSpan = (bounds.r1x - bounds.r0x + 1) * (bounds.r1z - bounds.r0z + 1)
  const clip = (rx: number, rz: number, present: Uint8Array) => {
    const lx0 = Math.max(0, bounds.c0x - rx * 32)
    const lx1 = Math.min(31, bounds.c1x - rx * 32)
    const lz0 = Math.max(0, bounds.c0z - rz * 32)
    const lz1 = Math.min(31, bounds.c1z - rz * 32)
    if (lx0 > lx1 || lz0 > lz1) return
    visit(rx, rz, present, lx0, lx1, lz0, lz1)
  }
  if (list.length > 0 && list.length < regionSpan) {
    for (const mask of list) {
      if (mask.rx < bounds.r0x || mask.rx > bounds.r1x || mask.rz < bounds.r0z || mask.rz > bounds.r1z) continue
      clip(mask.rx, mask.rz, mask.present)
    }
    return
  }
  for (let rz = bounds.r0z; rz <= bounds.r1z; rz++) {
    for (let rx = bounds.r0x; rx <= bounds.r1x; rx++) {
      const present = masks.get(`${rx},${rz}`)
      if (present) clip(rx, rz, present)
    }
  }
}

function countRegion(present: Uint8Array, lx0: number, lx1: number, lz0: number, lz1: number): number {
  if (lx0 === 0 && lx1 === 31 && lz0 === 0 && lz1 === 31) {
    let n = 0
    const length = Math.min(present.length, 128)
    for (let i = 0; i < length; i++) n += BYTE_BITS[present[i]] ?? 0
    return n
  }
  let n = 0
  for (let lz = lz0; lz <= lz1; lz++) {
    for (let lx = lx0; lx <= lx1; lx++) {
      if (bitSet(present, (lz << 5) | lx)) n++
    }
  }
  return n
}

function collect(bounds: Window, masks: Map<string, Uint8Array>, list: RegionBits[]): { cx: number, cz: number }[] {
  const chunks: { cx: number, cz: number }[] = []
  eachRegion(bounds, masks, list, (rx, rz, present, lx0, lx1, lz0, lz1) => {
    for (let lz = lz0; lz <= lz1; lz++) {
      const cz = rz * 32 + lz
      for (let lx = lx0; lx <= lx1; lx++) {
        if (bitSet(present, (lz << 5) | lx)) chunks.push({ cx: rx * 32 + lx, cz })
      }
    }
  })
  return chunks
}

function decimate(bounds: Window, masks: Map<string, Uint8Array>, list: RegionBits[], stride: number): ChunkPick[] {
  const picked = new Map<string, ChunkPick>()
  eachRegion(bounds, masks, list, (rx, rz, present, lx0, lx1, lz0, lz1) => {
    for (let lz = lz0; lz <= lz1; lz++) {
      const cz = rz * 32 + lz
      const sz = Math.floor(cz / stride) * stride
      let lx = lx0
      while (lx <= lx1) {
        const cx = rx * 32 + lx
        const sx = Math.floor(cx / stride) * stride
        const key = `${sx},${sz}`
        if (picked.has(key) || bitSet(present, (lz << 5) | lx)) {
          if (!picked.has(key)) picked.set(key, { cx, cz, sx, sz })
          const next = sx + stride - rx * 32
          lx = next > lx ? next : lx + 1
          continue
        }
        lx++
      }
    }
  })
  return [...picked.values()]
}

/**
 * Chunks the map should load for this view.
 * At detail zoom, `chunks` is every occupied chunk.
 * Past that, `chunks` stays empty and `picks` is one occupied chunk per stride cell —
 * the same chunk a full list would have kept first. The full list is never allocated.
 */
export function scanViewport(
  originX: number,
  originZ: number,
  spanX: number,
  spanZ: number,
  masks: Map<string, Uint8Array>,
  list: RegionBits[]
): { count: number, stride: number, chunks: { cx: number, cz: number }[], picks: ChunkPick[] } {
  const bounds = windowOf(originX, originZ, spanX, spanZ)
  const area = (bounds.c1x - bounds.c0x + 1) * (bounds.c1z - bounds.c0z + 1)
  if (area <= DETAIL_CHUNK_CAP) {
    const chunks = collect(bounds, masks, list)
    return { count: chunks.length, stride: 1, chunks, picks: [] }
  }
  let count = 0
  eachRegion(bounds, masks, list, (_rx, _rz, present, lx0, lx1, lz0, lz1) => {
    count += countRegion(present, lx0, lx1, lz0, lz1)
  })
  const stride = viewStride(count)
  if (stride === 1) return { count, stride, chunks: collect(bounds, masks, list), picks: [] }
  return { count, stride, chunks: [], picks: decimate(bounds, masks, list, stride) }
}
