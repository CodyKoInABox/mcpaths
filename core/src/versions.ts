/**
 * Chunk section bit-packing (palette indices, minimum 4 bits, no cross-long
 * spanning) is the same from Java 1.18 through 26.3. Prismarine has no 26.2
 * or 26.3 chunk codec, so block_states are read and written with its newest
 * 1.21 palette codec (1.21.11). That is a codec alias only.
 *
 * The world's DataVersion is never replaced with 1.21's (4671). Java 26.2
 * stays 4903 and Java 26.3 stays 5023.
 *
 * 26.3-snapshot-7 (DataVersion 5009) renamed palette fields Name/Properties
 * to id/properties and allowed a string palette. We translate those names
 * around the 1.21 codec. 26.1 (4786) moved dimension folders under
 * dimensions/minecraft/…; section encoding did not change.
 */

export const CODEC_VERSION = '1.21.11'
export const CODEC_DATA_VERSION = 4671

export const DATA_VERSION_1_18 = 2860
export const DATA_VERSION_26_1 = 4786
export const DATA_VERSION_26_2 = 4903
export const DATA_VERSION_26_3 = 5023
/** 26.3-snapshot-7: block palette uses id/properties (and string entries). */
export const PALETTE_ID_SINCE = 5009
/** 26.4-snapshot-1: biomes become per-block and Status is renamed. Do not write. */
export const BIOME_FORMAT_BREAK = 5119

export type PaletteSchema = 'name' | 'id'
export type Dimension = 'overworld' | 'nether' | 'end'

export interface VersionSupport {
  dataVersion: number
  /** Release label. 26.2 and 26.3 are named explicitly, never "1.21". */
  label: string
  palette: PaletteSchema
  namespacedDimensions: boolean
  /** Always the 1.21 anvil palette codec when we agree to edit the world. */
  codec: typeof CODEC_VERSION
}

interface ProtocolRow {
  minecraftVersion: string
  dataVersion?: number
  releaseType?: string
}

let releaseRows: ProtocolRow[] | null = null

function releases(): ProtocolRow[] {
  if (releaseRows) return releaseRows
  const rows = require('minecraft-data/minecraft-data/data/pc/common/protocolVersions.json') as ProtocolRow[]
  releaseRows = rows.filter(row => row.releaseType === 'release' && typeof row.dataVersion === 'number')
  return releaseRows
}

export function paletteSchema(dataVersion: number): PaletteSchema {
  return dataVersion >= PALETTE_ID_SINCE ? 'id' : 'name'
}

export function supportForDataVersion(dataVersion: number): VersionSupport {
  if (!Number.isInteger(dataVersion)) {
    throw new Error('This save has no DataVersion in level.dat, so MC Paths cannot tell which chunk format it uses.')
  }
  if (dataVersion < DATA_VERSION_1_18) {
    throw new Error(`This save is from before Java 1.18 (data version ${dataVersion}). MC Paths edits 1.18 through 26.3.`)
  }
  if (dataVersion >= BIOME_FORMAT_BREAK) {
    throw new Error(`This save is Java 26.4 or newer (data version ${dataVersion}). Biome storage changed in 26.4, so MC Paths will not write it.`)
  }
  let label = 'Java'
  if (dataVersion === DATA_VERSION_26_2) label = '26.2'
  else if (dataVersion === DATA_VERSION_26_3) label = '26.3'
  else if (dataVersion >= PALETTE_ID_SINCE) label = '26.3'
  else if (dataVersion >= DATA_VERSION_26_2) label = '26.2'
  else if (dataVersion >= DATA_VERSION_26_1) label = '26.1'
  else {
    let best: ProtocolRow | undefined
    for (const row of releases()) {
      const rowVersion = row.dataVersion as number
      if (rowVersion <= dataVersion && (!best || rowVersion > (best.dataVersion as number))) best = row
    }
    if (best?.minecraftVersion) label = best.minecraftVersion
  }
  return {
    dataVersion,
    label,
    palette: paletteSchema(dataVersion),
    namespacedDimensions: dataVersion >= DATA_VERSION_26_1,
    codec: CODEC_VERSION
  }
}

export function dimensionBounds(dim: Dimension): { minY: number, maxY: number } {
  if (dim === 'overworld') return { minY: -64, maxY: 319 }
  return { minY: 0, maxY: 255 }
}
