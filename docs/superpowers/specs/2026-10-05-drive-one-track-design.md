# Milestone 1: drive one track

## Goal

Open the page, see track 1 of the original game rendered in 3D, and drive a kart around it with the keyboard.
This is the first rung of a hybrid port: a playable remake from the original data now, corrected against a
disassembly of `WW.EXE` later.

## Decisions

- Vite + TypeScript, `three` for all rendering, vitest for tests.
- `WACKY.DAT` is fetched and parsed in the browser at runtime. No converted assets are committed.
- Real 3D scene: the tile map is baked into one texture on a ground plane, a perspective camera follows the kart,
  the kart is a billboard sprite. Rendered at the display's native resolution with multisampling; every
  texture is sampled nearest-neighbour, so texels keep hard edges. Framing keeps the original's height and lens
  but the view is as wide as the window (at least the original 320); HUD elements from the right edge of the original screen move to the new edge.
- Driving physics are approximate and live in one pure step function.

## Data formats (decoded from the archive)

- `WACKY.DAT`: u16 file count, then 22-byte entries (14-byte name, u32 size, u32 offset). Offsets are relative to
  the end of the 2-byte count.
- `.PCX`: standard 8-bit RLE with a trailing 256-colour palette. All images are 320x200.
- `N.GAM`: text. Lines 1-2 tile sheets, 3-4 mask sheets, 5 background, then three numbers of unknown meaning,
  then 8 x/y start positions. Sheet names resolve to archive files with an `A_` prefix.
- `N.M`: 64x64 tile indices. Tiles are 32x32, 10 per sheet row, 54 used per sheet; index 54+ is the second
  sheet. World is 2048x2048.
- Jumps: tiles 63 and 89 (the two halves of the JUMP road marking in sheet `f2`) launch a kart that crosses
  them at speed. Provisional: other tile sets have no such marking, so their jump rule is still unknown.
- Mask sheets use the same tile layout with pixel values 0, 1, 255. Value 1 is treated as a wall (provisional).
- `.SP`: raw frames stored column by column. Karts are 38x28, 12 frames per character, 8 characters in `CARS.SP`.

## Units

| Unit | Path | Job |
|---|---|---|
| Archive | `src/formats/archive.ts` | bytes to named files |
| PCX | `src/formats/pcx.ts` | indexed image + palette, RGBA conversion |
| Track | `src/formats/track.ts` | `.GAM` text, tile map baking, start positions |
| Sprites | `src/formats/sprite.ts` | column-major frames to row-major |
| Kart | `src/game/kart.ts` | pure step: accelerate, steer, drag, wall slide, jump |
| Textures | `src/render/texture.ts` | indexed pixels to `THREE.DataTexture` |
| Track mesh | `src/render/trackMesh.ts` | ground plane in world coordinates |
| Entry | `src/main.ts` | load, input, fixed-timestep loop, camera |

## Not in this milestone

AI, laps, HUD, pickups, sound, menus, other tracks, surface-dependent speed.

## Testing

Parsers are tested against the real archive with synchronous file reads. The kart step is tested as pure maths.

## Added after milestone 1

- Hand brake (Space): a quarter turn. `WW.EXE` shows a hand-brake state that replaces steering with 120 angle
  units per tick (1920 per circle) and exists for both left and right. What selects the direction and how long
  a tick lasts are not decoded; the port turns left unless right is held, over a guessed 0.12 seconds.
- Opponents: ported from `WW.EXE` as documented in `docs/opponent-logic.md`. They ride the `N.RD` racing line
  like a rail (`src/game/rails.ts`) on a fixed speed schedule: start, launch, cruise, and a catch-up for
  grid slots 4-7 when the player leads by enough `N.POS` checkpoints (`src/game/opponent.ts`). Speeds come
  from `VEL.TAB`. The player's top speed, acceleration, drag, braking and steering rate use the original's
  numbers too. `src/game/race.ts` steps everything and tracks laps and race position.
- Still open: the tick rate (136/12 per second) is inferred; the start-phase speed is used raw as the code
  reads and looks too fast; the player's side of kart contact is not decoded (opponents never move, the
  player is slid clear); which character sits in which slot is unknown.
