import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import nbt from 'prismarine-nbt'
import { createWorld, type World } from '../src'

export async function tempWorld(dataVersion: number, name = 'fixture'): Promise<{ dir: string, world: World }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcpaths-'))
  const world = await createWorld(dir, { dataVersion, name, spawn: { x: 8, y: 70, z: 8 } })
  return { dir, world }
}

/** Grass/dirt/stone plain, a hill, a water channel, a chest, a tree. One chunk. */
export async function buildFixture(dataVersion: number): Promise<{ dir: string, world: World }> {
  const { dir, world } = await tempWorld(dataVersion)
  await world.ensureChunk('overworld', 0, 0)
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      world.setBlock('overworld', x, 0, z, 'bedrock')
      for (let y = 1; y <= 59; y++) world.setBlock('overworld', x, y, z, 'stone')
      for (let y = 60; y <= 62; y++) world.setBlock('overworld', x, y, z, 'dirt')
      let surface = 63
      if (z >= 8 && z <= 14) surface = 63 + (z - 8)
      for (let y = 63; y < surface; y++) world.setBlock('overworld', x, y, z, 'dirt')
      world.setBlock('overworld', x, surface, z, 'grass_block')
      world.setBiome('overworld', x, 64, z, 'plains')
    }
  }
  for (let x = 0; x < 16; x++) {
    for (let y = 58; y <= 62; y++) world.setBlock('overworld', x, y, 15, 'water')
    world.setBlock('overworld', x, 63, 15, 'air')
  }
  world.setBlock('overworld', 2, 64, 2, 'chest')
  world.addBlockEntity('overworld', {
    id: nbt.string('minecraft:chest'),
    x: nbt.int(2),
    y: nbt.int(64),
    z: nbt.int(2),
    Items: nbt.list(nbt.comp([{
      Slot: nbt.byte(0),
      id: nbt.string('minecraft:diamond'),
      count: nbt.int(3)
    }]))
  })
  world.addEntity('overworld', 4, 4, {
    id: nbt.string('minecraft:pig'),
    Pos: nbt.list(nbt.double([4.5, 64, 4.5]))
  })
  for (let y = 64; y <= 66; y++) world.setBlock('overworld', 10, y, 3, 'oak_log')
  world.setBlock('overworld', 10, 67, 3, 'oak_leaves')
  world.setBlock('overworld', 11, 66, 3, 'oak_leaves')
  world.setBlock('overworld', 0, 80, 0, 'cinnabar')
  await world.save()
  return { dir, world }
}

export async function snapshot(world: World): Promise<string[]> {
  const cells: string[] = []
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y <= 80; y++) {
        const block = world.getBlock('overworld', x, y, z)
        if (block.name !== 'air') cells.push(`${x},${y},${z},${block.name}`)
      }
    }
  }
  return cells
}
