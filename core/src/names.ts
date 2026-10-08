import type { Dimension } from './versions'

export type GameTypeName = 'survival' | 'creative' | 'adventure' | 'spectator'

const GAME_TYPES: GameTypeName[] = ['survival', 'creative', 'adventure', 'spectator']

export interface PlayerView {
  x: number
  y: number
  z: number
  dimension: Dimension
}

/** LevelName may be a Java string or an older byte string. Blank falls back to the folder. */
export function levelDisplayName(levelName: unknown, folderName: string): string {
  const text = nbtText(levelName).replace(/\u0000+$/g, '').trim()
  return text || folderName || 'Untitled world'
}

export function nbtText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.toString('utf8')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  if (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'number' && item >= 0 && item <= 255)) {
    return Buffer.from(value).toString('utf8')
  }
  if (value && typeof value === 'object' && 'value' in value && !Array.isArray(value)) {
    return nbtText((value as { value: unknown }).value)
  }
  return ''
}

/** Ints, doubles, bigints, and prismarine longs (`[hi, lo]`). */
export function nbtNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    const hi = value[0] | 0
    const lo = value[1] >>> 0
    const n = hi * 0x100000000 + lo
    return Number.isFinite(n) ? n : null
  }
  if (value && typeof value === 'object' && 'value' in value) return nbtNumber((value as { value: unknown }).value)
  return null
}

export function dimensionFromTag(value: unknown): Dimension | null {
  if (typeof value === 'string') {
    const bare = value.replace(/^minecraft:/, '')
    if (bare === 'overworld') return 'overworld'
    if (bare === 'the_nether' || bare === 'nether') return 'nether'
    if (bare === 'the_end' || bare === 'end') return 'end'
    return null
  }
  const n = nbtNumber(value)
  if (n === 0) return 'overworld'
  if (n === -1) return 'nether'
  if (n === 1) return 'end'
  return null
}

export function playerFromLevel(data: any): PlayerView | null {
  const pos = data?.Player?.Pos
  if (!Array.isArray(pos) || pos.length < 3) return null
  const x = nbtNumber(pos[0])
  const y = nbtNumber(pos[1])
  const z = nbtNumber(pos[2])
  if (x == null || y == null || z == null) return null
  return {
    x,
    y,
    z,
    dimension: dimensionFromTag(data?.Player?.Dimension) ?? 'overworld'
  }
}

export function gameTypeFromLevel(data: any): GameTypeName | null {
  const n = nbtNumber(data?.GameType)
  if (n == null || !Number.isInteger(n)) return null
  return GAME_TYPES[n] ?? null
}

export function lastPlayedFromLevel(data: any): number | null {
  const n = nbtNumber(data?.LastPlayed)
  if (n == null || n <= 0) return null
  return n
}
