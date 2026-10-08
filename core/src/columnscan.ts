import { profileOf } from './codec'

/** Palette state ids, or null when the section is a direct (global) palette and must be scanned. */
export function paletteIds(section: any): number[] | null {
  const data = section?.data
  if (!data) return null
  if (typeof data.value === 'number' && data.palette == null) return [data.value]
  if (Array.isArray(data.palette)) return data.palette
  return null
}

function sectionEmpty(section: any): boolean {
  if (!section) return true
  if (typeof section.isEmpty === 'function') return section.isEmpty()
  return section.solidBlockCount === 0
}

/** Highest block the path will stand on. Skips air, plants, leaves, and logs. */
export function groundColumn(
  column: any,
  lx: number,
  lz: number,
  bounds: { minY: number, maxY: number }
): { y: number, name: string } | null {
  const sections = (column.sections ?? []) as any[]
  const minY = (column.minY ?? 0) as number
  const maxIndex = Math.min(sections.length - 1, Math.floor((bounds.maxY - minY) / 16))
  const minIndex = Math.max(0, Math.floor((bounds.minY - minY) / 16))
  for (let index = maxIndex; index >= minIndex; index--) {
    const section = sections[index]
    if (sectionEmpty(section)) continue
    const y0 = minY + index * 16
    const yTop = Math.min(15, bounds.maxY - y0)
    const yBot = Math.max(0, minY - y0)
    if (yTop < yBot) continue
    const ids = paletteIds(section)
    if (ids && ids.every(id => profileOf(id).groundSkip)) continue
    for (let ly = yTop; ly >= yBot; ly--) {
      const profile = profileOf(section.get({ x: lx, y: ly, z: lz }))
      if (profile.groundSkip) continue
      return { y: y0 + ly, name: profile.name }
    }
  }
  return null
}

/**
 * Columns that contain a protected block other than bedrock.
 * Sections whose palette has none are skipped. `found` already holds block-entity columns.
 */
export function markProtectedColumns(
  column: any,
  found: Set<string>,
  bounds: { minY: number, maxY: number }
) {
  const done = new Uint8Array(256)
  for (const key of found) {
    const comma = key.indexOf(',')
    const lx = Number(key.slice(0, comma))
    const lz = Number(key.slice(comma + 1))
    if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) done[(lz << 4) | lx] = 1
  }
  let open = 256 - found.size
  if (open <= 0) return
  const sections = (column.sections ?? []) as any[]
  const minY = (column.minY ?? 0) as number
  const maxIndex = Math.min(sections.length - 1, Math.floor((bounds.maxY - minY) / 16))
  const minIndex = Math.max(0, Math.floor((bounds.minY - minY) / 16))
  for (let index = maxIndex; index >= minIndex && open > 0; index--) {
    const section = sections[index]
    if (sectionEmpty(section)) continue
    const y0 = minY + index * 16
    const yTop = Math.min(15, bounds.maxY - y0)
    const yBot = Math.max(0, minY - y0)
    if (yTop < yBot) continue
    const ids = paletteIds(section)
    if (ids && ids.every(id => !profileOf(id).protected)) continue
    for (let lz = 0; lz < 16 && open > 0; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = (lz << 4) | lx
        if (done[col]) continue
        for (let ly = yTop; ly >= yBot; ly--) {
          if (!profileOf(section.get({ x: lx, y: ly, z: lz })).protected) continue
          found.add(`${lx},${lz}`)
          done[col] = 1
          open--
          break
        }
      }
    }
  }
}
