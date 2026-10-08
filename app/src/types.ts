export type Dimension = 'overworld' | 'nether' | 'end'
export type PresetId = 'trail' | 'cobble' | 'moss' | 'sandstone' | 'adaptive' | 'boardwalk'
export type WidthOption = 'narrow' | 'normal' | 'wide'
export type HillsOption = 'follow' | 'tunnel'
export type WaterOption = 'bridge' | 'causeway'
export type DressingOption = 'off' | 'subtle' | 'lined'

export interface PathOptions {
  width: WidthOption
  hills: HillsOption
  water: WaterOption
  dressing: DressingOption
}

export interface XZ { x: number, z: number }

export interface SurveyPath {
  id: string
  name: string
  points: XZ[]
  preset: PresetId
  options: PathOptions
  /** False after Enter. Further clicks do not add points. */
  draft: boolean
}

export interface WorldPayload {
  info: {
    path: string
    name: string
    dataVersion: number
    versionName: string
    support: { label: string, palette: string }
    spawn: { x: number, y: number, z: number }
  }
  dimensions: { id: Dimension, region: string, hasFiles: boolean }[]
}

export interface ApiResult<T> { ok: boolean, data?: T, error?: string }

export interface McPathsApi {
  listSaves: () => Promise<ApiResult<WorldPayload['info'][]>>
  pickFolder: () => Promise<ApiResult<WorldPayload | null>>
  openWorld: (folder: string) => Promise<ApiResult<WorldPayload>>
  bounds: (dim: Dimension) => Promise<ApiResult<{ minX: number, minZ: number, maxX: number, maxZ: number } | null>>
  sample: (query: { dim: Dimension, originX: number, originZ: number, width: number, height: number }) => Promise<ApiResult<{ rgb: number[], width: number, height: number, originX: number, originZ: number }>>
  preview: (query: { dim: Dimension, paths: { name: string, points: XZ[], preset: PresetId, options: PathOptions }[] }) => Promise<ApiResult<{ x: number, z: number, name: string }[]>>
  apply: (query: { dim: Dimension, paths: { name: string, points: XZ[], preset: PresetId, options: PathOptions }[] }) => Promise<ApiResult<{ backupDir: string | null, chunks: number }>>
  onOpened: (handler: (payload: WorldPayload) => void) => () => void
  onStatus: (handler: (message: string) => void) => () => void
}

declare global {
  interface Window { mcpaths: McPathsApi }
}

export const DEFAULT_OPTIONS: PathOptions = {
  width: 'normal',
  hills: 'follow',
  water: 'bridge',
  dressing: 'subtle'
}

export const PRESETS: { id: PresetId, label: string }[] = [
  { id: 'trail', label: 'Trail' },
  { id: 'cobble', label: 'Cobble road' },
  { id: 'moss', label: 'Moss walk' },
  { id: 'sandstone', label: 'Sandstone way' },
  { id: 'adaptive', label: 'Adaptive' },
  { id: 'boardwalk', label: 'Boardwalk' }
]
