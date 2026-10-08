export function hash01(x: number, z: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

export function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  const v00 = hash01(x0, z0)
  const v10 = hash01(x0 + 1, z0)
  const v01 = hash01(x0, z0 + 1)
  const v11 = hash01(x0 + 1, z0 + 1)
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  return v00 * (1 - ux) * (1 - uz) + v10 * ux * (1 - uz) + v01 * (1 - ux) * uz + v11 * ux * uz
}

/** Border radius wanders by one block. Interior stays filled. */
export function wanderedRadius(x: number, z: number, radius: number): number {
  const n = valueNoise(x * 0.35, z * 0.35)
  const jitter = n < 0.3 ? -1 : n > 0.7 ? 1 : 0
  return Math.max(0, radius + jitter)
}
