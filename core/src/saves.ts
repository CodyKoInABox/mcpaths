import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readWorldInfo, type WorldInfo } from './world'
import type { GameTypeName, PlayerView } from './names'

export interface SaveRoot {
  path: string
  exists: boolean
}

export interface SaveListing {
  path: string
  name: string
  folder: string
  dataVersion: number | null
  versionName: string | null
  label: string | null
  spawn: { x: number, y: number, z: number } | null
  player: PlayerView | null
  lastPlayed: number | null
  gameType: GameTypeName | null
  error: string | null
}

export function saveSearchPaths(): SaveRoot[] {
  const home = os.homedir()
  const paths = [
    process.env.APPDATA ? path.join(process.env.APPDATA, '.minecraft', 'saves') : '',
    path.join(home, '.minecraft', 'saves'),
    path.join(home, 'Library', 'Application Support', 'minecraft', 'saves'),
    path.join(home, '.var', 'app', 'com.mojang.Minecraft', '.minecraft', 'saves')
  ].filter((root): root is string => Boolean(root))
  const seen = new Set<string>()
  const roots: SaveRoot[] = []
  for (const root of paths) {
    const norm = path.normalize(root)
    const key = process.platform === 'win32' ? norm.toLowerCase() : norm
    if (seen.has(key)) continue
    seen.add(key)
    roots.push({ path: norm, exists: fs.existsSync(norm) })
  }
  return roots
}

export function candidateSaveRoots(): string[] {
  return saveSearchPaths().filter(root => root.exists).map(root => root.path)
}

export async function describeSave(dir: string): Promise<SaveListing> {
  const folder = path.basename(dir)
  try {
    return listingFromInfo(await readWorldInfo(dir))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const saveName = (error as { saveName?: string }).saveName
    return {
      path: dir,
      name: saveName || folder || 'Untitled world',
      folder: folder || 'Untitled world',
      dataVersion: null,
      versionName: null,
      label: null,
      spawn: null,
      player: null,
      lastPlayed: null,
      gameType: null,
      error: message
    }
  }
}

function listingFromInfo(info: WorldInfo): SaveListing {
  return {
    path: info.path,
    name: info.name || info.folder,
    folder: info.folder,
    dataVersion: info.dataVersion,
    versionName: info.versionName,
    label: info.support.label,
    spawn: info.spawn,
    player: info.player,
    lastPlayed: info.lastPlayed,
    gameType: info.gameType,
    error: null
  }
}

export async function listSaves(): Promise<{ roots: SaveRoot[], saves: SaveListing[] }> {
  const roots = saveSearchPaths()
  const saves: SaveListing[] = []
  for (const root of roots) {
    if (!root.exists) continue
    let names: string[] = []
    try {
      names = fs.readdirSync(root.path)
    } catch {
      continue
    }
    for (const name of names) {
      const dir = path.join(root.path, name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(dir)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      if (!fs.existsSync(path.join(dir, 'level.dat'))) continue
      saves.push(await describeSave(dir))
    }
  }
  saves.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name))
  return { roots, saves }
}
