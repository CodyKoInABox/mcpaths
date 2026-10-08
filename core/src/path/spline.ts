export interface XZ {
  x: number
  z: number
}

export interface Sample extends XZ {
  tx: number
  tz: number
  along: number
}

function at(points: XZ[], index: number): XZ {
  if (index < 0) return points[0]
  if (index >= points.length) return points[points.length - 1]
  return points[index]
}

function cr(p0: XZ, p1: XZ, p2: XZ, p3: XZ, t: number): XZ {
  const t2 = t * t
  const t3 = t2 * t
  const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
  const z = 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  return { x, z }
}

/** Catmull-Rom through the clicks, then a point about every block. */
export function resample(points: XZ[]): Sample[] {
  if (points.length < 2) return []
  const dense: XZ[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(points, i - 1)
    const p1 = at(points, i)
    const p2 = at(points, i + 1)
    const p3 = at(points, i + 2)
    const length = Math.hypot(p2.x - p1.x, p2.z - p1.z)
    const steps = Math.max(2, Math.ceil(length * 4))
    for (let step = 0; step <= steps; step++) dense.push(cr(p0, p1, p2, p3, step / steps))
  }
  const out: Sample[] = []
  let cursor = { ...dense[0] }
  let acc = 0
  const push = (x: number, z: number, tx: number, tz: number) => {
    out.push({ x, z, tx, tz, along: out.length })
  }
  push(cursor.x, cursor.z, 1, 0)
  for (let i = 1; i < dense.length; i++) {
    const target = dense[i]
    let dx = target.x - cursor.x
    let dz = target.z - cursor.z
    let dist = Math.hypot(dx, dz)
    if (dist < 1e-8) continue
    const ux = dx / dist
    const uz = dz / dist
    if (out.length === 1) {
      out[0].tx = ux
      out[0].tz = uz
    }
    while (acc + dist >= 1) {
      const need = 1 - acc
      cursor = { x: cursor.x + ux * need, z: cursor.z + uz * need }
      push(cursor.x, cursor.z, ux, uz)
      dist -= need
      acc = 0
    }
    cursor = { x: cursor.x + ux * dist, z: cursor.z + uz * dist }
    acc += dist
  }
  return out
}
