export const DETAIL_CHUNK_BUDGET = 96
/** Full 16×16 tiles stay interactive under this many chunks in view. Past it, the map samples. */
export const DETAIL_CHUNK_CAP = 128
/** Target sample count for an overview of a large view. */
export const OVERVIEW_BUDGET = 280
export const OVERVIEW_CHUNK_BUDGET = 240

/**
 * 1 loads every occupied chunk. Above DETAIL_CHUNK_CAP, grow the stride so the
 * sample count stays near OVERVIEW_BUDGET instead of decoding the whole view.
 */
export function viewStride(occupied: number): number {
  if (occupied <= DETAIL_CHUNK_CAP) return 1
  return Math.max(2, Math.ceil(Math.sqrt(occupied / OVERVIEW_BUDGET)))
}
export const MAX_PIXELS_PER_BLOCK = 32
/** Farthest zoom. A 1000px-wide view still covers 250,000 blocks. */
export const MIN_PIXELS_PER_BLOCK = 0.004

/**
 * Smallest pixels-per-block that fits the explored area, plus margin.
 * A small world can still zoom out until about 4096 blocks fit on the short side,
 * so the camera is not stuck on a close minimum.
 */
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

/** Log slider so the far end of the range is usable, not a sliver next to 32. */
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
