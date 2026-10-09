# Wacky Wheels (WW.EXE) — how the picture is produced

Static reverse engineering of `dos/WWINST/WW.EXE` (code object at 0x10000, data
object at 0x60000; all addresses are linear in that layout). Builds on
`docs/opponent-logic.md`. Nothing here was verified by running the game.

- **[C]** confirmed by reading the disassembly at the address given (or by
  parsing the data file exactly as that code does)
- **[I]** inference

Disassembly note: ndisasm prints the one-bit shift opcodes (`D1 xx`) as
`shl/sar reg,0x0`. They are shifts by 1.

Conventions used below:

- Angles: 1920 units per circle. `TRIG.DAT` entry `a` is 8 bytes: cos (16.16)
  at +0, sin at +4; pointer `[0x7d6a0]`. Heading 0 = +x, 480 = +y. **[C]**
  (0x37a21, 0x3057f: race start heading is 480 and the kart sits 124 units in
  +y from the camera).
- World unit = 1 texel; tiles are 32 units; positions carry the +0x400 bias.
- Screen: 320x200, row 0 at the top.

---

## 1. Floor projection

### 1.1 The camera is the stored "player position"

- **[C]** `[0x88b0a]` / `[0x88b0e]` (what the earlier doc calls the player
  position) is the **camera** position. The kart's own world position is
  `camera + 124 * (cos h, sin h)`, computed every tick at 0x2380f..0x23844
  into `[0x88b68]` / `[0x88b6a]` (`[0x7d608] = 0x7c`, helper 0x37bb1). That
  is the position copied into opponent-table slot 0 (0x325bc) and used for
  collisions and the minimap. The terrain probe 0x37a6c also samples 124
  ahead of the camera.
- **[C]** So the camera is **124 units behind the kart**, on the kart's
  heading line, always looking along the heading `[0x7d5d4]`. No lag, no
  smoothing.
- **[C]** Turning pivots the camera about the point `NDIST[0]` (= 133) units
  ahead of it: 0x23c5d..0x23d48 computes `133*(cos,sin)` before and after the
  heading change (0x37a21) and adds the difference to the camera position. So
  the pivot is 9 units ahead of the kart point.
- **[C]** Race start: camera = (slot0.x, slot0.y - 124), heading 480
  (0x30521..0x30589).

### 1.2 The renderer (0x37e94; second viewport 0x3c3e9)

**[C]** It is a per-pixel ray lookup, column by column, bottom to top. For the
full-detail path (0x37fae..0x395d8):

```
for c in 0..319:                       # screen column
    a = (heading - 160 + c) mod 1920   # one angle unit per column
    for k in 0..69:                    # k = 0 is screen row 199, k = 69 is row 130
        d = NDIST[c*70 + k]            # u32, plain integer distance in texels
        X = (camX + ((cos[a] * d) >> 16)) & 0xffff     # 32-bit mul, low dword, then 16-bit add
        Y = (camY + ((sin[a] * d) >> 16)) & 0xffff
        tile  = map[(Y >> 5) * 128 + (X >> 5)]         # dword pointer table [0x7d6a4]
        pixel = tile[(Y & 31) * 32 + (X & 31)]
        screen[199 - k][c] = pixel
```

- **[C]** `NDIST` (89600 bytes) = 320 columns x 70 rows of u32, column-major,
  loaded to `[0x7d660]` (0x282d3..0x28312). Only this table drives the floor.
  The start offset 0x3e30 is row 199 and each step moves up one row
  (`sub edi,0x51` after `movsb`), so the floor covers **rows 130..199** (70
  rows).
- **[C]** Field of view: 320 columns x 1 unit = 320/1920 of a circle =
  **60 degrees** horizontal. Columns are spaced equally **in angle**, not in
  tan(angle).
- **[C]** Table contents (parsed from the file): for the centre columns
  (159 and 160) the distances run 115 (row 199) .. 972 (row 130); column 0
  runs 133 .. 1122. Every column equals the centre column divided by
  `cos((c - 160) * 0.1875 deg)` to within rounding, so the table stores the
  ray length for a fixed **depth along the view axis**.
- **[I]** Fit of the centre column (max error 0.5 = rounding):
  `depth(row) = (9065.1 - 0.527*row) / (row - 120.75)`; the simpler
  `depth(row) = 8960 / (row - 120.75)` is within 0.6 up to row 141 and within
  5 texels at row 130. The mathematical horizon is therefore at **row
  120.75**; rows 121..129 are never drawn as floor (the strip covers them).
- **[I]** Equivalent pinhole camera for a 3D port: horizontal FOV 60 degrees
  across 320 px (focal length 160/tan 30 = 277.1 px), **no pitch**, principal
  point shifted down to row 120.75 (vertical lens shift of 20.75 px from the
  buffer centre), camera height `8960 / 277.1 = 32.3` units (one tile), 124
  units behind the kart. The kart's ground point then lands on row
  `120.75 + 8960/124 = 193`, which is where the game draws it (section 2.4).
  A true pinhole differs from the game horizontally: the game maps angle
  linearly to x, so a floor point at 15 degrees off-axis is at x = 240 in the
  game and x = 234 in a pinhole view (worst case about 6 px, zero at centre
  and edges). Sprites, however, use the pinhole mapping (section 2.1), so
  the original itself has this mismatch between floor and sprites.
- **[C]** Sampling is nearest-texel, truncating, no filtering, no mip.
- **[C]** Map: `[0x7d6a4]` is a 128x128 table of tile pointers. 0x37a06 fills
  all of it with the pointer to tile 0 (`[0x7d64c]`), then the `.M` loader
  (0x27e6c..0x27f12) writes the 64x64 track into rows 0x20..0x5f, columns
  0x20..0x5f as `tileBase + byte*1024`. Tiles are 32x32 row-major, 1024
  bytes each. **Beyond the 64x64 track the floor shows tile 0 of the first
  sheet, repeated**, for a 32-tile border.
- **[C]** There is no clamp or wrap in the sampler. The camera is clamped to
  0x400..0xbfe (0x29145) and rays reach 1122 units, so rays can leave even
  the 128x128 table (coordinates below 0 wrap to 16 bits and index far past
  the table). What is shown then is whatever memory follows; see Unknown 1.
- **[C]** Detail levels, selected by `[0x88c20]` (0x37eaa): 1 = 320 columns
  (above); 2 = 160 columns, each 2 px wide (plane mask 3 / 0xc), angle step
  2, every second NDIST column (0x395dd..0x3ad0a); 3 = 80 columns, 4 px wide,
  angle step 4 (0x3ad0f..). `[0x88c20]` is the variable the earlier doc
  called the "steering 40/36/32" setting: it is the **screen detail level**,
  and the turn rate is tied to it. **[I]** (the turn rate is larger at higher
  detail to compensate for the lower frame rate).
- **[C]** Split screen: 0x3c3e9 is the same renderer for the top viewport:
  strip at rows 10..29 (offset 0x320), floor rows 30..99 (bottom offset
  0x1ef0). Sprites for that viewport are shifted up by `[0x7ed30]` = 100
  (0x1799c, 0x25554).

### 1.3 `VIEW` and `SLP`

- **[C]** `VIEW` (320 u32, loaded to 0x6b7f8 at 0x3665b) =
  `16384 * cos((x - 160) * 0.1875 deg)` per screen column. Used only by the
  sprite projection to turn a ray length into a depth (section 2.1).
- **[C]** `SLP` (1920 u32, loaded to 0x6e858 at 0x3669e) =
  `65536 * tan(angle)` per angle unit (0 at 480 and 1440). Used only by the
  sprite visibility test 0x24a08: the slope `(dy << 16) / dx` from camera to
  object must lie between `SLP[heading-160]` and `SLP[heading+160]`.

---

## 2. Sprite projection

### 2.1 World position to screen (0x255d4 karts, 0x25a78 track objects — same maths)

**[C]** With `dx = x - camX`, `dy = y - camY`, `c = cos h`, `s = sin h`:

```
cull: object outside the bounding box of {camera, camera + 1122*dir(h-160),
      camera + 1122*dir(h+160)} (built by 0x28480 in [0x88c16..0x88c2c]) -> skip
      0x24a08 slope test fails -> skip
fwd  = (c*dx + s*dy) >> 16
side = (c*dy - s*dx) >> 16
t    = (fwd * 0x93cd) >> 16                 # 0x93cd/65536 = tan(30 deg)
sx   = 160 + (side * 160) / t               # sprite centre column; skip if not 0..319
r    = isqrt(fwd*fwd + side*side)           # 0x249b0
depth = (r * VIEW[sx]) >> 14                # +1 if the remainder >= 0x1fa0
skip unless 80 <= depth <= 1122
level   = clamp((depth - 124) / 70, 0, 9)   # truncating; negative -> 0
groundY = YTAB[depth]
w, h    = size of scale level `level` of the sprite's INF set
left    = sx - w/2
top     = groundY - h
```

- **[C]** Horizontal mapping is a true perspective divide with focal length
  `160 / tan 30 = 277.1` px.
- **[C]** `YTAB` (word table 0x6bd00, built at 0x274a4):
  `v = clamp(round(18000 / depth), 21, 240)`, `YTAB[depth] = 120 - (v >> 1) + v`
  (= `120 + 9000/depth`). Values: depth 80 -> 233, 124 -> 193, 194 -> 167,
  400 -> 143, 754 -> 132, 1122 -> 131. This matches the floor formula
  (`120.75 + 8960/depth`), i.e. a sprite's bottom edge sits on its floor row.
- **[C]** Scale is **not** 1/depth. It is one of 10 fixed levels chosen
  linearly from depth: level 0 for depth 80..193, then one level per 70 units,
  level 9 from depth 754. For a 38x28 kart the widths are 38, 35, 32, 29, 26,
  23, 20, 17, 14, 11 (a true 1/depth scale would give 24 px at depth 194 and
  6 px at 754; the game draws 35 and 11).
- **[C]** Clipping: left/right against 0..319 by skipping whole columns,
  bottom against row 199 by shortening columns. No top clip (a jumping human
  kart seen in the other split-screen view is clamped to top >= 110,
  0x258db).

### 2.2 Sprite pixel format and the `*.INF` tables

- **[C]** All `.SP` sprites are raw 8-bit, **column-major** (x outer, y
  inner), colour 0 transparent (blitters 0x36fd0 unscaled, 0x37487 scaled;
  both walk down a column with `add di,0x4f` after `stosb`).
- **[C]** An INF file is 10 consecutive scale levels (loader 0x28038), each:

```
u16 w, u16 h                 # size of this level
w columns, each (h + 1) x i32:
    [0]      source offset of the first pixel, relative to the frame start
             (= srcColumn * srcHeight)
    [1..h-1] amount to add to the source offset after each drawn pixel
             (1 = next source row, 2 = skip a row, ...)
    [h]      added after the last pixel; unused (the pointer is reset per column)
```

  Level 0 is the identity (w, h = full size, all steps 1). The scaled blit is:
  per destination column, `src = frame + col[0]`; for each of `h` pixels draw
  `*src` if non-zero, then `src += next entry`. Left clipping skips
  `(h+1)*4` bytes per column (0x25933), bottom clipping skips
  `clippedRows*4` per column (`[0x7d878]`).
- **[C]** Level sizes parsed from the files:

| set | file | levels (w x h) | used for |
|---|---|---|---|
| 0 | `38X28.INF` | 38x28 35x26 32x24 29x21 26x19 23x17 20x15 17x12 14x10 11x8 | karts (0x257a6, 0x26b8e) |
| 1 | `28X28.INF` | 28 26 24 21 19 17 15 12 10 8 (square) | track objects `OB1,5..9.SP` |
| 2 | `14X28.INF` | 14x28 13x26 12x24 11x21 10x19 8x17 7x15 6x12 5x10 4x8 | track objects `OB2,3,4,10,11,13.SP` |
| 3 | `32X24.INF` | 32x24 29x22 27x20 24x18 22x16 19x14 17x12 14x11 12x9 9x7 | `H*.SP`, `OB12.SP`, transformed kart (0x26af0, 0x2585b) |
| 4 | `15X13.INF` | 15x13 14x12 13x11 11x10 10x9 9x8 8x7 7x6 5x5 4x4 | see Unknown 5 |
| 5 | `18X13.INF` | 18x13 17x12 15x11 14x10 12x9 11x8 9x7 8x6 6x5 5x4 | see Unknown 5 |
| - | `251X6.INF` | 251x6 231x6 211x5 191x5 171x4 151x4 131x3 110x3 90x2 70x2 | loaded only by 0x28038 with a non-zero argument, together with `ACTION.SP`; see Unknown 5 |

  Level pointers live at `0x6e470 + set*0x50 + level*4` (0x280e2, stride 0x50
  at 0x2815f).
- **[C]** Which set a track object uses comes from `SPRITE.ATR` (u16 count =
  36, then 40-byte records loaded to 0x72998 at 0x13e87): +0 kind, +2 = 10,
  +4 w, +6 h, +8 w, +10 h, +12 INF set index, +14 frame count, +16 file
  name. The object's type is `.SPW` word +0, its frame is `.SPW` word +10
  (0x25c43..0x25c98).

### 2.3 Sprite list and draw order

- **[C]** Entries are 0x28 bytes, 1-based at 0x79a28 (entry 0 is swap
  scratch), count `[0x88b78]`:

| off | meaning |
|---|---|
| +0x00 | u16 visible width (after clipping) |
| +0x02 | u16 visible height |
| +0x04 | i16 left |
| +0x06 | i16 top |
| +0x08 | pointer into the INF level data (already advanced past clipped columns) |
| +0x0c | pointer to the frame pixels |
| +0x10 | u32 depth (sort key) |
| +0x14 | u32 bytes to skip per column for bottom clipping |
| +0x18 | i16 kart slot index, -1 for objects |
| +0x1a | u16 scale level |
| +0x1c | u16 state copied from the source record |
| +0x1e, +0x20 | u16 screen relation to the player's sprite, filled by 0x22bf4 |
| +0x24 | i16 kind: 1 = kart from the opponent table, 0 = the player's own kart, -1 = object |

- **[C]** Build order per frame (0x28998): 0x287ec (frame selection), 0x255d4
  (karts), 0x25a78 (`.SPW` objects), 0x26a3c (player's kart), 0x266a8 (only if
  `[0x88c38]`), 0x2632c, then 0x253d8.
- **[C]** 0x253d8 sorts the list by depth **descending** (exchange sort,
  0x25430..0x25484) and draws in that order: far to near, painter's
  algorithm. The player's kart has depth 124, so any kart at depth 80..123 is
  drawn over it.

### 2.4 The player's own kart (0x26a3c, drawn by 0x24bcc)

- **[C]** Centre column 160, scale level 0 (38x28, unscaled), ground row
  `YTAB[124]` = 193: left = 141, top = 165, covering x 141..178, y 165..192.
- **[C]** While `kart[+0x26]` (speed) > 0 during a race the top alternates
  between 165 and 164 every frame (`kart[+0x68]` toggle, 0x26d8c..0x26dbb).
  This 1-px vertical jitter is the only "engine/wheel" animation of the
  player's kart.
- **[C]** Surface effects: after the kart, 0x24e5f.. draws an animated
  sprite taken from the current surface-type record (`kart[+0x76]`, record
  fields +0x126 frames, +0x108 frame size, +0x10a w, +0x10c h, +0x112 frame
  count) at `top + 16`, only while moving and not jumping. **[I]** dust /
  spray at the wheels.

---

## 3. Horizon strip (`N.PAR`)

- **[C]** File layout as the drawing code needs it: 25600 bytes = **1280 x 20
  pixels, row-major, 8-bit**. 0x36f55 uploads it to off-screen video memory at
  offset 0x7d00 (pixel p of the file goes to plane `p & 3`, byte `p >> 2`,
  consecutive), i.e. 320 bytes per strip row.
- **[C]** Each frame the floor routine first copies a 320x20 window of it to
  **screen rows 110..129** (0x37ece..0x37f9a: 20 rows of 80 bytes, source
  stride 320 bytes, VGA latch copy, destination offset 0x2260 = row 110).
  The copy is opaque: **no transparency**; whatever sky shows in rows
  110..129 is part of the PAR image.
- **[C]** Scroll position is the source pointer `[0x7d860]`, in bytes (1 byte
  = 4 pixels). It is **not derived from the heading**; it is stepped while
  the player turns (0x24834, called from the turn code at 0x23d51 / 0x23e71):

```
turning one way:   if ptr == MAX: ptr = MAX - 160;   ptr = min(ptr + kart[+0x54], MAX)
turning the other: if ptr == MIN: ptr = MIN + 160;   ptr = max(ptr - kart[+0x52], MIN)
MIN = 0xa7d00 (window starts at strip x = 0), MAX = 0xa7df0 (x = 960),
initial 0xa7d50 (x = 320)                              (0x36789..0x367b1)
```

  `kart[+0x52]` / `[+0x54]` are the per-tick step in bytes: they ramp 1, 2, 3,
  4 over the first ticks of a turn and stay at 4 (= 16 px per tick), or are
  16 (= 64 px per tick) while `kart[+6]` (skid) is set (0x23c7b..0x23c95,
  0x23da1..); they reset to 0 when not turning that way (0x23d68, 0x23e88).
- **[C]** Wrap width is **640 px**: the pointer jumps by 160 bytes at either
  end, and every row of every PAR file checked (tracks 1, 2, 17) repeats
  exactly with period 640.
- **[I]** Pixels per angle unit: at detail level 2 the turn is 36 units per
  tick and the strip moves 16 px, about **0.44 px per unit** (40 units at
  level 1, 32 at level 3 give 0.40 and 0.50). A full circle therefore scrolls
  about 850 px, not a multiple of 640: the strip is not locked to the
  heading, and the same heading can show different scenery.
- **[C]** Nothing in the strip is animated; the scroll applies only in modes
  `[0x7d998]` 0 and 3.

---

## 4. Backdrop and palette

- **[C]** The fifth name in `N.GAM` (`BACKn.PCX`, replaced by `BLANK.PCX` in
  split-screen, 0x2748b) is loaded as raw PCX RLE data without its palette
  (0x27dd8 -> 0x27060) and decoded straight into a video page by 0x375cd,
  then copied to the other page (0x36f14). It is drawn **once**; per frame
  only rows 110..199 are rewritten, so rows 0..109 keep the backdrop (plus
  HUD drawn on top). The backdrop does not scroll.
- **[C]** Race palette = the 768-byte palette at the end of the **first tile
  sheet** named in `N.GAM` (`A_Fn.PCX`), shifted right 2 bits to 6-bit VGA
  (0x27c06..0x27c46, 0x26ec4), kept at `[0x7d718]`. The backdrop, strip and
  all sprites are drawn with that palette.
- **[C]** Transitions are whole-palette fades: 0x1bf94 fades the current
  palette to black, 0x32cf8 fades from black up to a target palette, both in
  steps of `[0x88c46]` per component, writing all 256 entries through
  0x37cf1.
- **[C]** Palette cycling exists (0x28668, called every frame from 0x2f7a0)
  and is switched on by the flag after the grid positions in `N.GAM`
  (section 5). It animates **tile colours** only:
  - 9-step cycle: DAC 0xa1, 0xa2, 0xa3, 0xa4 and 0x94 (0x37c43), 15 bytes per
    step; advances every `[0x88b5a]` frames, except that step 3 is held for
    `[0x88b4e]` frames.
  - 4-step cycle: DAC 0xad, 0xac, 0xae, 0xaf (in that order) and 0xa8..0xab
    (0x37c84), 12 + 12 bytes per step; advances every `[0x88b4c]` frames.
  - The colour data is **the palette of `BEACH.PCX`**, read at start-up into
    `[0x7d758]` (0x36720): palette entries 0..44 are the 9 steps x 5 colours,
    entries 45..60 the 4 steps for 0xad/0xac/0xae/0xaf, entries 61..76 the 4
    steps for 0xa8..0xab (`[0x7d6d0] = [0x7d758] + 0x87`, second block at
    +0x30).
  - **[I]** It is the water/surf animation of the beach tile sets: only the
    tracks using `f3` / `f4` / `f11` have the flag, and the colours are blues
    and sand.
- **[C]** **Kart wheels are not palette-animated.** `CARS.SP` and the
  character files use none of the cycled indices (0x94, 0xa1..0xa4,
  0xa8..0xaf), so the cycle above cannot touch them. **[I]** No other
  in-race DAC writer was found (the only other palette routine, 0x37cf1, is
  the whole-palette fade). Wheels are a static dither; motion is conveyed by
  the 1-px jitter (2.4) and the surface effect sprites.

---

## 5. `N.GAM` numbers, `N.BMC`, `MAP.XY`

### `N.GAM` (parser 0x2717c; one CR/LF-terminated token per line)

| line | track 1 | meaning |
|---|---|---|
| 1, 2 | f1.pcx, f2.pcx | tile sheets (get the `A_` prefix) **[C]** |
| 3, 4 | ma1.pcx, ma2.pcx | mask sheets (get the `A_` prefix) **[C]** |
| 5 | back1.pcx | backdrop **[C]** |
| 6 | 1250 | initial camera x, +0x400 -> `[0x88b0a]` (0x2733d) **[C]** |
| 7 | 1500 | initial camera y, +0x400 -> `[0x88b0e]` (0x2735a) **[C]** |
| 8 | 1 | read and discarded (0x27370) **[C]** |
| 9..24 | 288 608 320 704 ... | 8 (x, y) pairs, +0x3e0, -> `[0x7d7cc+i*2]` / `[0x7d7e0+i*2]` (start grid, see opponent doc) **[C]** |
| 25 | 0 | palette-cycle enable -> `[0x88b60]` **[C]** |
| 26..28 | (2 4 3) | only if enabled: frames per step of the 9-step cycle `[0x88b5a]`, hold of step 3 `[0x88b4e]`, frames per step of the 4-step cycle `[0x88b4c]` **[C]** |

- **[C]** Lines 6 and 7 are 1250 / 1500 in all 42 files, and the race start
  overwrites the camera from the grid (0x30521), so they have no effect on a
  normal race.

### `N.BMC` — recorded demo input

- **[C]** u16 count, then count x 3 bytes: u16 duration in frames, u8 input
  mask. Loaded to 0x7d9a0 only when `[0x7d998]` is 2 or 3 (0x18199..0x18232);
  played back by 0x2e348, which holds each mask for its duration: bit 0 ->
  `[0x88cd5]`, bit 1 -> `[0x88cdd]`, bit 2 -> `[0x88b40]`, bit 3 ->
  `[0x88b42]`, bit 4 -> `[0x88b44]`, bit 5 -> `[0x88b46]`, bit 6 ->
  `[0x88cec]`. Track 1: 278 records, 1310 frames.
- **[I]** `[0x7d998]` 2 / 3 are the self-running demo modes, which is why only
  six tracks have the file; bits 0/1 are steer, bit 2 accelerate (it is set
  in most records), bit 4 brake (the earlier doc's `[0x88b44]`).

### `MAP.XY` — minimap coordinate tables

- **[C]** Two 2048-byte tables (0x28183): the first -> 0x802cc maps
  `x - 0x400` (0..2047) to a minimap column 0..77, the second -> 0x7faca maps
  `y - 0x400` to a minimap row 0..49. Used by 0x2a4ac: when the map is on
  (`[0x88ca0]`), a 78x50 picture is drawn at screen (0, 60) and one pixel per
  kart is plotted at `(MAPX[x], 60 + MAPY[y])`.
- **[C]** The 78x50 picture is 3900 bytes read from a class file at
  `(trackInClass - 1) * 3900` (0x27a21..0x27a89). **[I]** the files are
  `BRONZEM.SP`, `SILVERM.SP`, `GOLDM.SP`, `BONUSB/S/G.SP` (each 19500 bytes =
  5 maps).

---

## 6. Kart sprite frames

### 6.1 Sprite data

- **[C]** `CARS.SP` = 8 characters x 12 frames of 38x28 (1064 bytes each,
  column-major). Per character there is a table of frame pointers
  `T[n] = [0x73c08 + char*0x98 + n*4]` (0x32945..0x3298b): T[0..11] are the
  12 `CARS.SP` frames. T[12..] come from the character's own file
  (`PANDA.SP`, `CAMEL.SP`, ...; 0x32a2f..0x32afb): file frames 0,1 -> T[12],
  T[13]; 2,3 -> T[14], T[15]; 4..11 -> T[16..23]; then `p0` frames -> T[24..]
  and `p1` frames -> T[28..], with (p0, p1) per character = (4,2) (4,4) (4,8)
  (4,8) (2,2) (1,7) (2,2) (1,4) (0x3299f..0x32a26).
- **[I]** What the frames show (viewed): `CARS.SP` 0 = front, 1 =
  front-left, 2 = left side, 3 = rear-left, 4 = rear, 5 = rear-right, 6 =
  right side, 7 = front-right; 8..11 = rear view with the driver's **head
  turned** (two amounts each way) — they are not lean frames. Character file
  0..3 = rear view **leaning** (two amounts each way), 4..11 = driver tumbling
  without the kart, then flying / celebration frames.

### 6.2 Other karts (0x287ec)

- **[C]** View octant `V = round(heading / 240) mod 8` (0x287f7..0x28875).
  Kart octant `K` = the `.RD` segment octant in `slot[+0x1a]`; for a human
  slot seen in split-screen it is `tbl[round(slotHeading/240) mod 8]` with
  `tbl = 6,7,0,1,2,3,4,5` (0x2876c, table 0x7d328 set at 0x3633d).
- **[C]** Frame = `word [0x706a0 + V*16 + K*2]`, stored per viewer in
  `slot[+0x38 + viewer*2]`; the sprite is `T[frame]` of character
  `slot[+0x26]` (0x257e1..0x25800). The table is built at 0x3657d as
  `(start(V) + K) mod 8` with `start` decreasing by one per V.
- **[I]** `start(0)` = 6, i.e. **frame = (K - V + 6) mod 8** (the initial
  value is the `edx = 6` left from the call at 0x36574; it is the only value
  that gives the rear frame 4 when both karts face the same way).
- **[C]** Only the heading difference is used; the bearing from the camera to
  the kart does not affect the frame.
- **[C]** A hit opponent (`slot[+0x58]` > 1) shows `T[slot[+0x5a]]`; a
  removed one (`slot[+2] == 2`) shows up to 4 frames from the table 0x7c7f0
  (0x257b4..0x25817).

### 6.3 The player's kart

**[C]** The frame is `*kart[+0x4e]`, a pointer into one of these per-player
pointer tables (filled at 0x17661..0x17810), indexed by `kart[+0x1a]`; the
animation state is `kart[+0x18]` (dispatch 0x298e3, jump table 0x29068; all
states except 5 advance only when the timer counter `[0x7ec64]` has moved on
since the last step, 0x298a2; its rate was not traced):

| table | entries | used by |
|---|---|---|
| 0x7b518 | T12, T13, T4, T14, T15 | state 5: steering lean. Index moves one step per frame toward the target `kart[+0x1c]`; 2 = straight (rear frame 4) |
| 0x7b4d8 | T3, T12, T13, T4, T14, T15, T5 | states 3 / 4 (set at 0x2976f / 0x29797): seven-step version whose ends are the diagonal rear views, stepping back to centre. **[I]** skid recovery |
| 0x7b448 | 17 entries: T4, T5, T6, T7, T0, T1, T2, T3, T4, ... | states 1, 2, 14: spin — the 8 direction frames in rotation, one way or the other, ending on the rear frame |
| 0x7b418 | T9, T8, T4, T10, T11 | states 6 / 7 (set by 0x22bf4 at 0x2308c / 0x2309a), then 8 / 9 back to centre: head turn. **[I]** the driver looks at a kart alongside |
| 0x7b238 | T8, T9, T8, T4, T10, T11, T10, T4 (loop) | state 13: head wobble loop (set at 0x3174a) |
| 0x7b378 | T4, T3, T2, T1, T0, then T28.. | state 10: turn round to face the camera, then the character's `p1` frames (set at 0x31717). **[I]** finish celebration |
| 0x7b328 | T16..T23 | knocked-out sequence, rising (section 7.3) |
| 0x7b2d8 | T22.. (`p0`-dependent count) | knocked-out sequence, hanging and falling |

- **[C]** There is **no shadow sprite** for the player's kart in this draw
  path, and jumping does not change the frame.
- See Unknown 3 for which lean frames are left and which are right.

---

## 7. Screen effects and page setup

### 7.1 Video pages

- **[C]** Unchained 320x200 VGA ("Mode X": plane select through port 0x3c4
  index 2, 80 bytes per row; set up at 0x37e41). Three 16000-byte pages:
  0x0000, 0x3e80, 0x7d00. `[0x88b24]` is the offset of the page being drawn.
- **[C]** Race frame (0x3108b..0x31108): 0x28480 (view setup), 0x37e94 (strip
  + floor), 0x28998 (sprites), 0x2f794 (HUD and palette cycle), 0x37de0 (wait
  for display enable, set the CRTC start address to `[0x88b24]`, wait for
  vertical retrace), then toggle `[0x88b24]` between 0 and 0x3e80. Plain
  two-page flipping; the third page area holds the PAR strip.
- **[C]** In mode `[0x7d998] == 2` the third page holds a full picture
  instead, and the top 130 rows are copied from it every frame (0x39604).

### 7.2 Jump

- **[C]** Started at 0x21715 / 0x242c9 / 0x2d906: `kart[+0xa] = 1`,
  `kart[+0x10]` (height) = 8, `kart[+0xe]` (max) = 40, `kart[+0xc]` = 8.
  While state 1 the height grows 8 px per frame up to 40 (0x24c73);
  `kart[+0xc]` counts down once per tick and at 4 the state becomes 2
  (0x292cd); then the height drops 8 px per frame; at 0 the state becomes 3
  (landing sound 0x17) and returns to 0 after the draw (0x253be).
- **[C]** The only visual is the kart sprite drawn `height` pixels higher
  (0x24ce0). The floor, camera and sprite size do not change. The steering
  and frame state machine is frozen while airborne (0x29873).

### 7.3 Knocked out (`[0x88c42]`, 0x26ba1..0x26cf0)

- **[C]** State 1: the sprite's bottom row `[0x88c1a]` rises 6 px per frame to
  row 114 while cycling T16..T23; state 2: holds for 11 counts of
  the timer `[0x7ec64]`; state 3: falls 4 px per frame until row 199 (clipped at the screen
  bottom); state 4: done, the kart is no longer drawn.

### 7.4 Transformed kart and puff

- **[C]** `kart[+0x44]` set (0x24271): the kart is drawn as an 8-frame,
  32x24 animation (`kart[+0x64] + frame*768`, scale set 3) taken from the
  surface/effect record field +0x12a, with sound 0x0e each frame, and other
  players see it the same way (0x25837..0x2587d). It starts and ends with a
  4-frame 38x28 animation from record field +0x126 drawn at the fixed
  position (141, 168) (`kart[+0x5a]`, 0x24d37..0x24dc8). See Unknown 4 for
  the trigger.

### 7.5 Spin-out

- **[C]** Shown by stepping through the 17-entry direction table (6.3). The
  heading itself is changed by the spin code (earlier doc: 0x78 units per
  tick), so the floor rotates with it.

### 7.6 `SHRINKn.PCX`

- **[C]** Not an in-race effect. It is loaded by 0x17de4 (name built at
  0x27aa0 as "SHRINK" + track number + ".PCX") and blitted full-screen before
  the race, after a fade to black. **[I]** It is the track preview screen: a
  shrunken top-down picture of the whole track with the class name
  (confirmed by viewing `SHRINK1.PCX`).

---

## Not determined

1. What the floor shows when a ray leaves the 128x128 pointer table (camera
   near the map edge looking outward). The code has no guard; whether tracks
   keep the kart far enough from the edge was not checked.
2. The 28x11 two-frame sprite at `[0x7c528]` / `[0x7c52c]`, drawn over the
   lower part of the player's kart at (left + 5, top + 12) when `[0x88c9e]` is
   set (0x24ddf..0x24e5a; flag set at 0x2f8e4, cleared at 0x30114). Its
   picture and purpose were not identified.
3. Which of the lean frames (character file 0,1 vs 2,3) and head-turn frames
   (`CARS.SP` 8,9 vs 10,11) is left and which is right, and the exact input
   -> `kart[+0x1c]` target mapping (0x29306..0x294a4 not decoded).
4. What triggers the transformed state `kart[+0x44]` and which file the
   32x24 / 38x28 animations at record fields +0x12a / +0x126 come from.
5. The sprite sources 0x2632c and 0x266a8 (not decoded: projectiles, pickups
   or effects), and with them the users of `15X13.INF`, `18X13.INF` and
   `251X6.INF`.
6. Opponent head-turn / overtaking animation (`slot[+0x28]`, `[+0x2c]`,
   `[+0x30]`, `[+0x34]`, set in 0x22bf4) and what 0x22bf4 does with the
   screen-relation fields beyond that.
7. The mask sheets (`A_MAn.PCX`) and tile-sheet-to-tile conversion were not
   re-examined; the floor samples tiles as 32x32 row-major blocks at
   `tileBase + index*1024`, with the mask block 0x1b000 bytes later.
8. The meaning of the discarded `N.GAM` line 8 and of the constant 1250 /
   1500 in modes other than a normal race.
9. The rate of the timer counter `[0x7ec64]` that gates the animation
   states, and everything else that needs the game running: none of the
   above was checked against DOSBox.
