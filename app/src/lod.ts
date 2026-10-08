export const DETAIL_CHUNK_BUDGET = 96
export const MAX_PIXELS_PER_BLOCK = 32
export const MIN_PIXELS_PER_BLOCK = 0.004

export type ViewLod = 'detail' | 'overview'

/** Mirrors core/src/lod.ts. The renderer cannot import the Node core package. */
export function viewLod(chunksAcross: number, chunksDown: number, budget = DETAIL_CHUNK_BUDGET): ViewLod {
  if (!Number.isFinite(chunksAcross) || !Number.isFinite(chunksDown)) return 'detail'
  if (chunksAcross < 1 || chunksDown < 1) return 'detail'
  return chunksAcross * chunksDown > budget ? 'overview' : 'detail'
}

export function farPixelsPerBlock(canvasW: number, canvasH: number, blocksW: number, blocksH: number): number {
  const width = Math.max(1, canvasW)
  const height = Math.max(1, canvasH)
  const margin = 1.3
  const spanW = Math.max(512, blocksW) * margin
  const spanH = Math.max(512, blocksH) * margin
  const fit = Math.min(width / spanW, height / spanH)
  const roomy = Math.min(width, height) / 4096
  const scale = Math.min(fit, roomy)
  return Math.min(MAX_PIXELS_PER_BLOCK, Math.max(MIN_PIXELS_PER_BLOCK, scale))
}

export function zoomToSlider(scale: number, min: number, max: number): number {
  if (!(max > min) || scale <= min) return 0
  if (scale >= max) return 1
  return Math.log(scale / min) / Math.log(max / min)
}

export function sliderToZoom(t: number, min: number, max: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  if (!(max > min)) return min
  return min * Math.pow(max / min, clamped)
}
