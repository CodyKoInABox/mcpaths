# MC Paths

Desktop map for Minecraft Java Edition. Draw a spline, pick a preset, and write the path into the world.

## Install and build

```sh
npm ci
npm test
npm start
npm run dist:win
```

`npm start` builds `core` and the Electron UI, then opens the app. `dist:win` produces an NSIS installer for Windows (`release/MC-Paths-Setup-0.1.0.exe`). The installer is unsigned. CI builds that installer on `windows-latest` and uploads it as an artifact. Published downloads belong on [GitHub Releases](https://github.com/CodyKoInABox/mcpaths/releases).

The showcase page lives in `site/`. `.github/workflows/pages.yml` deploys that folder to GitHub Pages on `workflow_dispatch` and on push to `main`. Pages is not live until that workflow has been enabled and has run.

## Supported versions

Java 1.18 through the newest 1.21.x minecraft-data knows, plus 26.1, **26.2 (DataVersion 4903)**, and **26.3 (DataVersion 5023)**.

Saves older than 1.18 (DataVersion below 2860) are refused. Java 26.4 and newer (DataVersion 5119 and above) are refused: biomes become per-block and `Status` is renamed.

Prismarine has no 26.2 or 26.3 chunk codec. Section bit-packing (palette indices, 4-bit minimum, no value split across longs) is the same from 1.18 through 26.3, so block states use prismarine’s newest 1.21 palette codec (`1.21.11`). That alias is only the codec. On save, the world’s real DataVersion is written back. 26.2 stays 4903 and 26.3 stays 5023. The codec’s own value, 4671, is never written. From 26.3-snapshot-7 (DataVersion 5009) palette fields are `id` / `properties` and a palette may be a list of strings; those are translated around the 1.21 codec, which still speaks `Name` / `Properties`.

26.1 and newer prefer `dimensions/minecraft/<name>/region` when that layout is in use. Older worlds stay on `region`, `DIM-1/region`, and `DIM1/region`.

## Safety

Apply copies each touched `.mca` into `<world>/.mcpaths-backup/<timestamp>/` before writing. `level.dat` is not rewritten, so player data stays put. Edits are in-place on the chunk: entities, block entities, biomes, and structures on existing sections are left as they were. Bedrock is never replaced. A column that holds a chest, barrel, shulker box, spawner, end portal frame, command block, lodestone, beacon, jukebox, lectern, or any block entity is skipped. After a write, `isLightOn` is cleared and section light arrays are removed so Minecraft relights the chunk. `WORLD_SURFACE`, `MOTION_BLOCKING`, and `MOTION_BLOCKING_NO_LEAVES` are recomputed.

## Presets

Trail, Cobble road, Moss walk, Sandstone way, Adaptive, Boardwalk.

Options: width Narrow 3 / Normal 5 / Wide 7, hills Follow or Tunnel, water Bridge or Causeway, dressing Off / Subtle / Lined.

The default is Trail, Normal, Follow, Bridge, Subtle. Several named paths can be drawn in one session. Preview is drawn on the map before Apply.

## Dev

```sh
npm test          # core round-trip, presets, 26.2 and 26.3
npm run typecheck
npm start         # Electron UI
npm run dist:win  # Windows NSIS installer
```

License: GPL-3.0-only.

## Limits

- Unknown 26.2 and 26.3 blocks round-trip by name. The block registry is minecraft-data 1.21.11 plus a synthetic entry for names it does not know. Map colors for those names are a small hand-written table or a hash.
- Lighting is invalidated, not solved. Fence links are written connected; Minecraft may correct them.
- Entity region files (`entities/*.mca`) are not edited. Entities stored inside the terrain chunk are preserved.
- A brand-new chunk is serialized through prismarine, so unknown extra chunk fields are not invented. Existing chunks only replace `block_states` on touched sections, heightmaps, and the light flags.
- The Windows installer is not code-signed.
