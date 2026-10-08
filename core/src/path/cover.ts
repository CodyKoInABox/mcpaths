import { regionOf } from '../grid'
import { widthBlocks, type NamedPath } from './presets'
import { resample } from './spline'

/**
 * Chunks the spline can actually touch: the resampled curve, plus width,
 * the one-block edge wander, tunnel lining, and the tree clear.
 * The control-point bounding box is the wrong set. A diagonal would load
 * the whole rectangle, and a sharp Catmull-Rom bulge can leave that rectangle.
 */
export function corridorChunks(paths: NamedPath[]): { cx: number, cz: number }[] {
  const seen = new Set<string>()
  const out: { cx: number, cz: number }[] = []
  const add = (cx: number, cz: number) => {
    const key = `${cx},${cz}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ cx, cz })
  }
  for (const path of paths) {
    if (path.points.length < 2) continue
    const radius = (widthBlocks(path.options.width) - 1) / 2
    // Wander ±1, tunnel mouth and lining, leaf clear ±3, and rounding.
    const pad = radius + 8
    for (const sample of resample(path.points)) {
      const x = Math.round(sample.x)
      const z = Math.round(sample.z)
      const c0x = Math.floor((x - pad) / 16)
      const c1x = Math.floor((x + pad) / 16)
      const c0z = Math.floor((z - pad) / 16)
      const c1z = Math.floor((z + pad) / 16)
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let cz = c0z; cz <= c1z; cz++) add(cx, cz)
      }
    }
  }
  out.sort((a, b) => {
    const ar = regionOf(a.cx, a.cz)
    const br = regionOf(b.cx, b.cz)
    return ar.rx - br.rx || ar.rz - br.rz || a.cx - b.cx || a.cz - b.cz
  })
  return out
}
