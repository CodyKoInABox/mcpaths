import nbt from 'prismarine-nbt'
import type { PaletteSchema } from './versions'
import { bareName, namespaced } from './blocks'

export interface PaletteEntry {
  name: string
  properties: Record<string, string>
}

/** Read a block_states palette in either 1.18–26.2 (Name) or 26.3 (id / string) form. */
export function readPalette(paletteTag: any): PaletteEntry[] {
  if (!paletteTag) return []
  const list = paletteTag.value ?? paletteTag
  const type = list.type
  const values = list.value
  if (type === 'string') {
    return (values as string[]).map(name => ({ name, properties: {} }))
  }
  const comps: any[] = Array.isArray(values) ? values : []
  return comps.map(comp => {
    const fields = comp.value ?? comp
    const name = stringField(fields, 'Name') || stringField(fields, 'id') || stringField(fields, '')
    if (!name) throw new Error('A block palette entry has no block id.')
    const propsTag = fields.Properties || fields.properties
    const properties: Record<string, string> = {}
    const propFields = propsTag?.value ?? propsTag
    if (propFields && typeof propFields === 'object' && !propFields.type) {
      for (const [key, val] of Object.entries(propFields)) {
        if (key === '') continue
        properties[key] = String((val as any).value ?? val)
      }
    }
    return { name, properties }
  })
}

function stringField(fields: any, key: string): string {
  const tag = fields?.[key]
  if (!tag) return ''
  if (typeof tag === 'string') return tag
  if (typeof tag.value === 'string') return tag.value
  return ''
}

export function paletteToNameCompounds(entries: PaletteEntry[]): any {
  const comps = entries.map(entry => {
    const props = Object.fromEntries(Object.entries(entry.properties).map(([key, value]) => [key, nbt.string(value)]))
    const body: Record<string, any> = { Name: nbt.string(namespaced(entry.name)) }
    if (Object.keys(props).length > 0) body.Properties = nbt.comp(props)
    return body
  })
  return nbt.list(nbt.comp(comps))
}

/**
 * 26.3 writes `id` / `properties` (properties omitted for the default state,
 * stored as a string). 26.2 and 1.18–1.21 keep `Name` / `Properties`.
 */
export function retagPalette(blockStates: any, schema: PaletteSchema) {
  const entries = readPalette(blockStates.value.palette).map(entry => ({
    name: bareName(entry.name),
    properties: entry.properties
  }))
  if (schema === 'name') {
    blockStates.value.palette = paletteToNameCompounds(entries.map(entry => ({
      name: namespaced(entry.name),
      properties: entry.properties
    })))
    return
  }
  const items = entries.map(entry => {
    if (Object.keys(entry.properties).length === 0) return namespaced(entry.name)
    const props = Object.fromEntries(Object.entries(entry.properties).map(([key, value]) => [key, nbt.string(value)]))
    return {
      id: nbt.string(namespaced(entry.name)),
      properties: nbt.comp(props)
    }
  })
  const allStrings = items.every(item => typeof item === 'string')
  blockStates.value.palette = allStrings
    ? nbt.list(nbt.string(items as string[]))
    : nbt.list(nbt.comp(items.map(item => {
      if (typeof item === 'string') return { id: nbt.string(item) }
      return item
    })))
}

export function replacePaletteWithNames(sectionTag: any, entries: PaletteEntry[]) {
  const blockStates = sectionTag.block_states ?? sectionTag.value?.block_states
  const target = blockStates.value ? blockStates : null
  if (!target) return
  target.value.palette = paletteToNameCompounds(entries)
}

export function sectionList(chunk: any): any[] {
  const sections = chunk.value?.sections
  if (!sections) return []
  return sections.value?.value ?? []
}
