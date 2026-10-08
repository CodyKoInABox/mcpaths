import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readWorldInfo, type WorldInfo } from './world'

export function candidateSaveRoots(): string[] {
  const home = os.homedir()
  const roots = [
    process.env.APPDATA ? path.join(process.env.APPDATA, '.minecraft', 'saves') : '',
    path.join(home, '.minecraft', 'saves'),
    path.join(home, 'Library', 'Application Support', 'minecraft', 'saves'),
    path.join(home, '.var', 'app', 'com.mojang.Minecraft', '.minecraft', 'saves')
  ]
  return roots.filter(root => root && fs.existsSync(root))
}

export async function listSaves(): Promise<WorldInfo[]> {
  const saves: WorldInfo[] = []
  for (const root of candidateSaveRoots()) {
    let names: string[] = []
    try {
      names = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      const dir = path.join(root, name)
      if (!fs.existsSync(path.join(dir, 'level.dat'))) continue
      try {
        saves.push(await readWorldInfo(dir))
      } catch {
        // Skip saves we cannot read. The folder picker reports its own error.
      }
    }
  }
  saves.sort((a, b) => a.name.localeCompare(b.name))
  return saves
}
