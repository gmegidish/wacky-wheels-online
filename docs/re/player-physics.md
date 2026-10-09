# Wacky Wheels (WW.EXE) — player kart physics

Static reverse engineering of `dos/WWINST/WW.EXE` (DOS4GW LE, code object at
0x10000, data object at 0x60000), plus data read from `WACKY.DAT` and one
table of bytes in `SETUP.EXE`. Builds on `docs/opponent-logic.md` (sections
6-8) and corrects it in a few places (section 0).

- **[C]** confirmed by reading the code / data at the addresses given
- **[I]** inference

Nothing here was verified by running the game.

Units: positions in map texels (32 per tile, +0x400 bias), headings in 1/1920
of a circle (0 = +x, 480 = +y, y down, so "+" is clockwise on the map), all
rates "per tick" where one tick = one rendered frame (section 8).

## 0. Corrections to the earlier pass

| earlier statement | what the code does |
|---|---|
| Surface type 10 is a "hazard that starts a spin" | **[C]** Type 10 is the **jump ramp**. `kart+0x0a` is the airborne state, not "spinning" (section 3). |
| Wall bounce = "heading + 960" | **[C]** The heading is not changed. Only the shove direction `[0x7d678]` is reversed; the kart is pushed 32 px straight backwards (section 4). |
| Brake = throttle -8 | **[C]** Brake also forces the accelerate input off, so the coast rule (-4) applies in the same tick: **-12 per tick** (section 7.4). |
| Table 0x741f8 "filled at run time" | **[C]** It is the file `WACKY.SDX` read verbatim (0x281c1..0x28221). Values in section 2.3. |
| Steering setting `[0x88c20]` label unknown | **[C]** It is the graphics **detail** level (HIGH / MEDIUM / LOW DETAIL) (section 7.6). |
| 0x2d6d0 = "player input" | **[C]** It is an input *gate* (zeroes inputs in certain states, handles cheat combos). The device read is 0x377ae / 0x3784b (section 7). |

## 1. Hand brake turn

Trigger: 0x296d9..0x297b0 (inside the kart update 0x290a0). Execution:
0x2251a..0x2256f (top of the steering routine 0x224ec).

**[C]** Trigger conditions, all required, evaluated every tick after the
throttle has been updated:

```
kart.air   (+0x0a) == 0          ; not airborne
kart.skid  (+0x3c) == 0
kart.spin  (+0x20) == 0
kart.throttle (+0x42) != 0       ; throttle, not speed
handBrakeInput [0x88b46] != 0
kart.hb    (+0x06) == 0          ; not already turning
```

**[C]** On trigger:

```
play sound 0x11
kart.hbCount (+0x08) = 1
kart.hb (+0x06) = (steerRightInput [0x88b98] != 0) ? 2 : 1     ; 1 = left, 2 = right
kart.skid (+0x3c) = kart.hb                                     ; borrowed, cleared at the end
(sprite animation 3 or 4 selected: +0x18, +0x1a, +0x4e)
```

- **[C]** Direction: **right only if steer-right is held at that moment;
  otherwise left** (steer-left held, or nothing held). There is no "last steer
  direction" memory. `[0x88b98]` is the right input after the reversed-controls
  swap (section 7.3).
- **[C]** Per tick while `kart.hb != 0` (0x2251a): steer amount = 0x78 (120)
  in the chosen direction, `kart.hbCount += 1`, and when `hbCount > 4`:
  `kart.hb = 0`, `kart.skid = 0`. The routine runs on the trigger tick too, so
  the count goes 1 -> 2, 3, 4, 5: **4 ticks x 120 = 480 units = 90 degrees**.
- **[C]** Speed: the turn itself never touches throttle or speed. But the
  input gate 0x2d7ba zeroes *all* inputs (left, right, accelerate, fire, brake,
  hand brake) at the start of every tick in which `kart.hb != 0`, i.e. on
  ticks 2..4. So the throttle coasts (-4) for three ticks: **-12 throttle
  total** (100 -> 88, i.e. 40 -> 36 px/tick with `VEL.TAB`). In kid mode the
  accelerate input is forced back on, so no loss.
- **[C]** Surface drag is not applied during the four ticks (the hand-brake
  branch returns before the drag code), so on grass etc. the kart moves at
  full `VELTAB[throttle]` for those ticks.
- **[C]** No cooldown and the input is level-triggered (`[0x88b46]` is the
  key state copied every frame, 0x377de). Holding the key re-triggers on the
  tick after the turn ends.
- **[C]** Standstill: works whenever throttle != 0, even at speed 0 (e.g.
  the tick accelerate is first pressed, or stopped against something).
  Does nothing with throttle 0.
- **[C]** Not possible in the air, during a skid or during a spin-out.
- **[C]** A wall hit during the turn zeroes the throttle and clears
  `kart.skid` (0x23933) but not `kart.hb`; the turn completes.
- **[C]** The backdrop scroll counters `+0x52` / `+0x54` are forced to 0x10
  while the turn runs (0x23c82, 0x23da1) — visual only.
- **[I]** Sound 0x11 is the tyre-screech effect (same id is used for brake,
  skid start and spin start).
- **[I]** If a jump starts mid-turn the steering routine is not called while
  airborne, so the remaining ticks of the turn (and the input lock) resume
  after landing.

## 2. Surfaces

### 2.1 Geometry: pivot point vs kart point

- **[C]** `[0x88b0a]` / `[0x88b0e]` is not where the kart is drawn; it is the
  camera/pivot point. The kart's ground point is **124 px ahead** of it along
  the heading: `K = P + round(124 * (cos, sin)(heading))` (0x2380f..0x23844,
  0x24107..0x24194; trig table `TRIG.DAT`, 1920 entries of (cos, sin) as
  16.16 fixed point, pointer `[0x7d6a0]`).
- **[C]** Every surface lookup, wall test, object test and kart test uses K.
  After the movement step K is stored in `[0x88b68]` / `[0x88b6a]` and copied
  to opponent-table slot 0 (0x325bc).
- **[C]** Steering rotates about the point `NDIST[0]` px ahead of P
  (0x37a21 reads the first dword of the `NDIST` file through `[0x7d660]`; its
  value is 133): the offset vector is computed before and after the heading
  change and P is moved by the difference (0x23c5d..0x23d48). So K barely
  moves when steering (9 px lever arm).
- **[C]** The wall-scrape and bump deflections (sections 4, 5) change the
  heading *without* that compensation, so K swings sideways by
  124 * sin(18 units) = about 7 px per deflection.

### 2.2 Lookup (0x37b04; identical inline copy at 0x37a6c)

```
x, y clamped to 0..0xfff
cell    = map128[(y >> 5) * 128 + (x >> 5)]        ; [0x7d6a4], dword = pointer to tile pixels
tile    = (cell - tileBase [0x7d64c]) >> 10         ; tile graphic number 0..107
maskPx  = byte at cell + 0x1b000 + (y & 31) * 32 + (x & 31)
type    = (maskPx == 0) ? SIN[tile].typeA : SIN[tile].typeB     ; -> [0x7e568]
```

- **[C]** `N.SIN`: 108 records x 12 bytes: dword (discarded by the loader),
  dword `typeA` (mask pixel == 0), dword `typeB` (mask pixel != 0).
- **[C]** The mask pixels live 0x1b000 bytes (= 108 tiles x 1024) after the
  tile pixels, i.e. the two mask sheets are loaded directly behind the two
  tile sheets with the same tile numbering. Only zero / non-zero is tested;
  values 1 and 255 are not distinguished.
- **[C]** So the surface is per **pixel**: tile index picks a pair of types,
  the mask picks which of the two.
- **[C]** Track 1 JUMP tiles 63 and 89 have `(typeA, typeB) = (10, 0)`: jump
  where the mask is 0, plain road where the mask is set.

### 2.3 Per-type parameters: `WACKY.SDX`

- **[C]** File = u16 count (30), then 30 records of 0x12e bytes, read to
  0x741f8 (0x281ea..0x28221). Record index = surface type.
- **[C]** Record layout:

| off | size | meaning |
|---|---|---|
| 0x000 | 128 x u8 | per track file number N (index N-1): 1 = load effect sprite set A for this track (0x275cf) |
| 0x080 | 128 x u8 | same for effect sprite set B (0x276c2) |
| 0x100 | u32, u32 | file offsets of sprite sets A / B (0x275f7, 0x276e4) |
| 0x108 | 6 x u16 | set A geometry (size = word[0] * word[5]) |
| 0x114 | 6 x u16 | set B geometry |
| **0x120** | u32 | **drag**, 16.16 fraction -> `kart+0x36` |
| **0x124** | u16 | **skid threshold** in ticks -> `kart+0x3a` |
| 0x126 | u32, u32 | run-time pointers to the loaded sprite sets |

- **[C]** Drag rule (0x22940, also 0x2267b, 0x228c2):
  `speed = VELTAB[throttle]; speed -= (speed * drag) >> 16` every tick. It is
  a multiplier on the table speed, not cumulative. The drag and threshold used
  in a tick are those of the surface under K at the end of the previous tick
  (0x2419a..0x241cd).
- **[C]** Values (drag as fraction; resulting top speed for `VEL.TAB` 40 and
  `VEL2.TAB` 28; tile sets that actually use the type in a track map):

| type | drag | top 40 -> | top 28 -> | skid thr | used by tile set | special |
|---|---|---|---|---|---|---|
| 0 | 0 | 40 | 28 | 18 | all | plain road |
| 1 | 0x75c2 (0.46) | 22 | 16 | 18 | f1 | |
| 2 | 0 | 40 | 28 | 20 | f1 f5 f7 f9 | **turbo strip**, no skid |
| 3 | 0 | - | - | 0 | all | **wall** |
| 4 | 0 | 40 | 28 | 14 | f3 | |
| 5 | 0x1999 (0.10) | 37 | 26 | 60 | f3 f13 f16 | sprite sinks 4 rows when stopped (0x26e2b) |
| 6 | 0xb333 (0.70) | 13 | 9 | 18 | f3 f13 f16 | **water state** |
| 7 | 0x4ccc (0.30) | 29 | 20 | 16 | f3 | |
| 8 | 0x28f5 (0.16) | 34 | 24 | 10 | f3 | |
| 9 | 0 | 40 | 28 | 18 | f5 | |
| 10 | 0 | 40 | 28 | 0 | f1 f5 f7 f16 | **jump ramp** |
| 11 | 0 | 40 | 28 | 14 | f7 | |
| 12 | 0x5c28 (0.36) | 26 | 18 | 8 | f7 | |
| 13 | 0x9999 (0.60) | 17 | 12 | 4 | f1 f7 | skid can become a spin |
| 14 | 0 | 40 | 28 | 60 | f9 | |
| 15 | 0x5c28 (0.36) | 26 | 18 | 20 | f9 | **water state** |
| 16 | 0 | 40 | 28 | 8 | f9 | |
| 17 | 0x9999 (0.60) | 17 | 12 | **0** | f9 | instant spin at full throttle |
| 18 | 0 | 40 | 28 | 14 | f13 | |
| 19 | 0x75c2 (0.46) | 22 | 16 | 8 | f1 f3 f13 | |
| 20 | 0x1999 (0.10) | 37 | 26 | 12 | f16 | |
| 21 | 0x3333 (0.20) | 33 | 23 | 8 | f16 | |
| 22 | 0x8000 (0.50) | 20 | 14 | 16 | f5 | |
| 23 | 0xb333 (0.70) | 13 | 9 | 18 | f5 | |
| 25 | 0 | 40 | 28 | **0** | f13 | instant spin at full throttle |
| 26 | 0 | 40 | 28 | **0** | f1 | instant spin at full throttle |
| 27 | 0 | 40 | 28 | 4 | f5 | skid can become a spin |
| 24, 28, 29 | 0 | | | 0 | unused | |

  Tile sets per track file N (from `N.GAM`): f1 = 1 5 10 15 19 26 31 36 38;
  f3 = 2 12 16 27 33 42; f5 = 3 9 21 22 29 37; f7 = 4 8 18 24 35 40;
  f9 = 6 13 20 25 32 39; f13 = 7 14 23 30; f16 = 11 17 28 34 41.
- **[I]** The human names (grass, sand, ice, oil...) were not determined; the
  code has only numbers. "Instant spin" types behave like oil/ice patches.

### 2.4 Types with code attached

- **[C] 3 = wall**: the only type that stops movement (section 4).
- **[C] 10 = jump** (section 3). The steering routine is also skipped while
  the surface under K is 10 (0x297c0).
- **[C] 2 = turbo strip** (0x297f3..0x29857): after the movement step, if the
  surface under K is 2 and no turbo is active, and the heading is inside the
  track's window (function 0x125bc): sound 0x0c, throttle = 160, timer
  `+0xb6` = 16, flag `+0xb4` = 1. While the flag is set the accelerate input
  is ignored and the throttle is held (brake still subtracts 8); each tick the
  timer is decremented and the flag cleared at 0 (0x2969b). Result: 16 ticks
  at `VELTAB[160]` (64 or 45 px/tick); on the next tick with accelerate held
  the throttle is clamped back to 100. Skids cannot start on type 2 (0x2298f).
- **[C] Turbo strips are one-way.** The heading window is set per track file
  number `[0x7e728]` at race setup (0x124e8, called from 0x3020f):

| track file N | window (units) | centre |
|---|---|---|
| 3, 4, 9, 24, 29, 35 | 1320..1560 | 1440 = -y (up the map) |
| 6, 10, 13, 15, 25 | 840..1080 | 960 = -x (left) |
| any other | left unchanged from the previous race (0..0 at program start) | |

  These are exactly the eleven tracks whose maps contain a type-2 pixel.
- **[C] 6 and 15 = water state** (0x241d1..0x2428e): entering either one
  (not airborne, not already in the state, not crashing) plays sound 0x0f and
  sets `kart+0x44` = 1; the kart is drawn with an alternative 8-frame sprite
  set and sound 0x0e loops (0x26ac7). The state ends, with sound 0x0f again,
  when the surface under K is neither the type that started it nor a wall
  (0x26b40). Physics consequences of the state: skids cannot start
  (0x22975), the full-throttle crash rule does not apply (0x23363, 0x23522).
  The slowdown comes only from the drag column.
- **[C]** Everything else differs only through drag and skid threshold.

## 3. Jumps

State in the kart struct: `+0x0a` air state (0 ground, 1 rising, 2 falling,
3 just landed), `+0x0c` tick countdown, `+0x10` height in screen pixels,
`+0x0e` max height.

**[C]** Triggers (all do the same thing: sound 0x0c, `air = 1`,
`countdown = 8`, `height = 8`, `maxHeight = 40`, leave the water state):

1. Surface type 10 under K at any pixel of the movement walk while
   `air == 0` (0x216d4..0x21745). The walk stops at that pixel for this tick.
2. Cheat: command-line word `JUMP` sets bit 1 of `kart+0xe0`; then brake +
   accelerate together start a jump anywhere (0x2d8aa..0x2d945).
3. Function 0x24298 (same body). No direct caller found.

**[C]** While `air != 0` the kart update takes a separate path
(0x291e0..0x292e8, then straight to the movement call at 0x297ce):

```
speed = VELTAB[150]                 ; 60 px/tick (VEL.TAB), 42 (VEL2.TAB); throttle untouched
steerLeft = steerRight = 0          ; no steering
countdown -= 1
if countdown <= 4: air = 2          ; start falling
; skipped entirely: throttle up/down, brake, hand brake, steering routine, drag, skid logic
move(speed)
```

**[C]** Height is advanced in the player-sprite draw code (0x24c5c..0x24ce0),
once per drawn frame: rising `height = min(height + 8, maxHeight)`; falling
`height -= 8`, and when it reaches 0: `air = 3`, sound 0x17; `air` is reset
to 0 at the end of the same draw (0x253be). The sprite is drawn `height`
pixels higher. There is no gravity curve: a linear 8 px/frame up and down.

**[I]** Resulting timeline with one draw per tick (T = tick of the trigger):

| tick | T | T+1 | T+2 | T+3 | T+4 | T+5 | T+6 | T+7 | T+8 |
|---|---|---|---|---|---|---|---|---|---|
| height after draw | 16 | 24 | 32 | 40 | 32 | 24 | 16 | 8 | 0 (landed) |

  Eight airborne movement ticks (T+1..T+8): 480 px with `VEL.TAB`, 336 px
  with `VEL2.TAB`, regardless of the speed at take-off. Normal control
  returns on T+9 with the pre-jump throttle.

**[C]** In the air:

- Walls still stop the kart: the wall test comes before the airborne
  early-out in the per-pixel probe (0x21749). A wall hit sets `air = 0`
  immediately (0x238e9) and the normal wall response follows.
- Objects and other karts are not tested (0x2175f jumps past both loops), and
  opponents running into the player are ignored too (their test requires
  `air == 0`, 0x28fb0). Jump ramps are not re-triggered.
- The side-corner wall probes (section 4) still run and can deflect the
  heading by 18 units.
- A turbo strip under the landing/overflown point still triggers (0x297f3 has
  no air check).
- Weapons cannot be fired (0x24479).

## 4. Walls and obstacles

Movement step 0x237e4, per-pixel probe 0x216a0, line walk 0x21de0.

**[C]** The walk tests the *current* pixel before each step and stops on the
first pixel that reports something, leaving P on that pixel. Priority at a
pixel: jump, wall, objects, karts.

### 4.1 Result 1: wall (type 3 under K)

**[C]** 0x23925..0x23c4a:

```
if skid: skid = 0; throttle = 0
if spin: spin = 0; throttle = 0
P += 32 px in direction (heading + 960)          ; straight back; heading itself unchanged
R = wall at P + 124 * dir(heading + 18)          ; right front corner
L = wall at P + 124 * dir(heading - 18)          ; left front corner
if L and R: L = R = 0                            ; square-on hit: no deflection
if R: heading -= 18; P += 1 px along heading; spark(side 4)
if L: heading += 18; P += 1 px along heading; spark(side 3)
throttle = 0
```

- `spark(side)`: only if `kart+0x46 == 0`: sound 0x15, `kart+0x46 = side`,
  animation timer reset (`+0x48`, `+0x4a`). Cleared by the draw code when the
  animation ends (0x255bc).
- **[C]** No stun timer, no heading reversal, no lateral bounce. The kart
  restarts from throttle 0 (+10 per tick). A square-on hit makes no sound in
  this routine.
- **[C]** Because the heading is unchanged, holding accelerate into a wall
  repeats: creep forward, hit, 32 px back.

### 4.2 Every tick without a wall hit: side scrape

**[C]** After steering has been applied (0x23e8e..0x24107) the same two
corner probes run. Each one that is inside a wall turns the heading 18 units
away from it and moves P 1 px forward, with `spark`. Both can fire in the same
tick (cancelling out). No speed loss. This is what slides the kart along a
wall it touches at a shallow angle.

### 4.3 Result 2: object (`N.SPW` entry within Manhattan distance 14 of K)

**[C]** In the movement step: nothing but stopping on that pixel; steering and
the corner probes proceed as normal. Flags set by the probe: `obj+2 = 1`,
`kart+0x7c = 1`. Touch flags are cleared every tick at 0x261fc.

**[C]** The consequence is decided later in the same frame, in the sprite
pass 0x22bf4 (0x231d5..0x23772), only for objects that were drawn this frame
(the flag travels in the sprite record, `+0x1c`). Object class = word at
`0x72998 + objType * 0x28`:

- class 1: special pickup, removed, sound 0x16 (single player only, once).
- class 2: removed, sound, `kart+0x6a += 4` (capped at 99).
- class > 2: if nothing is held (`kart+0x16 == 0`): removed, becomes the held
  item.
- class <= 0 (solid obstacle): **bump** (section 4.4), preceded by the crash
  rule (section 5.2) if the obstacle's sprite is centred on the kart's.

### 4.4 Bump response (0x2369f..0x23772, then 0x2d3fc after the frame is drawn)

**[C]**

```
if skid: skid = 0; throttle = 0
if spin: spin = 0; throttle = 0
sound 0x15 (object) or 0x16 (kart)
side  = 3 centre (sprite x within +-4 px of the player's), 4 left, 5 right
depth = 1 farther up the screen than the player, 2 nearer, 3 same row
kart+0x46 = 4 if side == 5 else 3                 ; spark side
; 0x2d3fc:
heading += (side == 5) ? -18 : +18                ; turn away; centre counts as "turn right"
P += 1 px along the new heading
if touched thing is a kart:
    if depth == 2: throttle = min(throttle + 40, 190)      ; it is behind you: shove forward
    if depth == 1: throttle = max(throttle - 40, 0)        ; it is ahead: you are slowed
```

- **[C]** An obstacle never changes the throttle (unless a skid/spin was
  cancelled). The kart stays pinned on the contact pixel and is rotated 18
  units per tick (K swings about 7 px sideways each time) until K leaves the
  14 px diamond.
- **[C]** The +40 shove is undone on the next tick if accelerate is held,
  because the accelerate rule clamps throttle to 100 (0x29666). It only
  matters when coasting.

## 5. Kart-to-kart contact

### 5.1 Detection

- **[C]** Player into opponent: per-pixel probe, Manhattan distance < 14
  between K and the opponent, any slot whose `+2 != 2` (0x21802..0x2189e).
  Sets `kart+0x7c`, `slot+2 = 1`, result 3; the walk stops on that pixel.
  Skipped while airborne.
- **[C]** Opponent into player: opponent update (earlier doc section 4), same
  radius; requires player `air == 0` and not crashing. The opponent is never
  slowed or deflected.
- **[C]** Result 3 has no effect inside the movement step. As for objects,
  the response comes from the sprite pass and only if the opponent's sprite
  was drawn this frame.

### 5.2 Full-throttle crash (0x2345b..0x235fb; object variant 0x2334d..0x2343b)

**[C]** If all of these hold when a touched opponent is processed:

```
kart.throttle >= 100 and not already crashing (kart+0x7e == 0)
single-player race (not [0x88be2], not [0x88bdc]); not special mode [0x7ec74]; not kid mode [0x7edb0]
opponent slot word (+0x38 + 2 * playerIndex) is 0, 1 or 7
kart.water (+0x44) == 0 and kart.air (+0x0a) == 0
```

then: sound 0x0d; the opponent is switched off (`slot+2 = 2`); the player's
spin, skid and throttle are zeroed; `kart+0x7e = 1`; crash sequence
`[0x88c42] = 1`. For a solid obstacle the conditions are the same except the
slot test is replaced by "obstacle sprite is centred (side 3)".

**[C]** Crash sequence: while `[0x88c42] == 1` the kart update does nothing
except push P 64 px backwards per tick, clamped to the map (0x290c9..0x291dc);
the kart sprite tumbles up the screen (6 px/frame to y = 114), holds 11
frames, drops off the bottom (4 px/frame) (0x26b8e..0x26ceb); 13 frames later
the screen fades, `kart+0x6c` is decremented (initial value 3, 0x2fe7d) and
the race restarts, or the race function returns if it reached 0
(0x314a2..0x31507).

**[I]** So ramming an opponent (or hitting an obstacle dead centre) with the
throttle at 100 or more costs one of three attempts and restarts the race.
This is what the code says; it is the single most important thing to confirm
against the running game. Below full throttle only 5.3 applies.

### 5.3 Ordinary bump

**[C]** Section 4.4 with "kart" = true: sound 0x16, 18-unit turn away, 1 px
nudge, and throttle +40 (opponent drawn nearer than the player, i.e. behind)
or -40 (opponent ahead). A skid or spin in progress is cancelled with
throttle 0. In single-player races this branch is reached only below
throttle 100, in water, or when the slot test of 5.2 fails.

## 6. Skid and spin-out

All in the steering routine 0x224ec, called once per tick when on the ground
and the surface under K is not 10. It returns immediately (no steering at
all) if the race is not running (`[0x88c44] != 2`) or the player's slot is
frozen by a weapon hit (`slot+0x58`).

Hold counters (0x29415..0x294ac): `kart+0x22` = consecutive ticks steer-left
has been held, `kart+0x24` = same for right; each is zeroed when the other
direction or nothing is held. If both are held, right wins.

### 6.1 Normal state (0x22940..0x22be9)

```
apply drag
canSkid = throttle >= 100 and not water and single-player normal race and surface != 2
steerL = left  ? S : 0            ; S = [0x88c7c] = 40 / 36 / 32
if right: steerL = 0; steerR = S
if canSkid:
    thr = kart.skidThreshold (+0x3a, from the surface)
    if leftHold >= thr:   start skid(left)
    elif rightHold >= thr: start skid(right)

start skid(dir):
    sound 0x11
    steer = S/2 in dir if that key is held, else 0        ; [0x88c7a]
    kart.skid = dir (1 left, 2 right); kart.skidTimer (+0x40) = 120
    leftHold = rightHold = 0
    if thr == 0:                                          ; instant spin surfaces
        sound 0x11; kart.skid = 0; kart.spin = dir; steer = 0; spin frame = 7 (left) / 9 (right)
```

- **[C]** A skid starts after holding one steering direction for
  `threshold` consecutive ticks at throttle >= 100 (18 ticks on plain road).
- **[C]** With threshold 0 the left test `0 >= 0` is true even with no key
  held, so on types 17, 25, 26 a kart at full throttle spins out at once,
  always to the left.

### 6.2 Skid state (0x226f7..0x2293f)

```
spinThr = 2 * skidThreshold (0 if threshold is 0)        ; current surface
steer = S/2 in the held direction, but 0 if it is opposite to the skid
if opposite key held for >= 2 ticks and skidThreshold != 0: skid = 0; return     ; counter-steer ends it
if holdCounter(skid direction) >= spinThr:
    sound 0x11; skid = 0; spin = direction; steer = 120 in that direction; spin frame = 7 / 9
skidTimer -= 10; if skidTimer < 0: skid = 0             ; 13 ticks after the start
apply drag
if speed > 0 and skid != 0: return
; skid just ended here (timeout, spin start, or speed 0):
if spin == 0: steer = 0
leftHold = rightHold = 0; skid = 0; speed = 0           ; speed for THIS tick only
```

- **[C]** Effect on steering: half rate while skidding; no effect on throttle.
- **[C]** A skid times out after 13 ticks; the hold counters restart, so on
  road (18) full-throttle cornering alternates 18 ticks at full rate and 13
  at half rate.
- **[C]** On the tick a skid ends by timeout or turns into a spin, the speed
  for that tick is set to 0 (0x22933): the kart does not move for one tick
  while the throttle is untouched. Looks odd; verify in the real game.
- **[C]** Spin from a skid needs `2 * threshold` ticks of continued holding
  inside the 13-tick skid, so only surfaces with threshold <= 6 can do it
  (types 13 and 27: 8 ticks).
- **[C]** Wall hit, bump or crash cancel a skid with throttle 0.

### 6.3 Spin-out (0x22574..0x226f6)

```
each tick: steer = 120 ([0x88c54]) in the spin direction; advance spin frame (7 down to 0, or 9 up to 16)
when the frame runs out (8th tick): spin = 0; steer = 0; throttle = 0; hold counters = 0; sprite reset
apply drag
```

- **[C]** Duration: 7 ticks of 120 units plus an ending tick; 840 units of
  rotation, or 960 (exactly half a turn) when it came from a skid, whose start
  tick already steers 120.
- **[C]** Inputs are all zeroed by the gate while `spin != 0`, so the
  throttle coasts (-4 per tick) and the kart keeps moving along the rotating
  heading, then is set to throttle 0 at the end.
- **[C]** A wall hit or bump ends the spin at once with throttle 0.

## 7. Input

### 7.1 Keyboard interrupt handler (0x40907)

**[C]** Reads port 0x60, acknowledges via port 0x61 and EOI. A byte 0xe0 is
replaced by the previous raw code. Codes above 0x52 are treated as releases
(code - 0x80, state 0), otherwise press (state 1). Then:

- Enter (0x1c) and Space (0x39) -> `[0x88cce]`; F10 (0x44) -> `[0x88ccd]`;
  Up (0x48) -> `[0x88cdb]`; Down (0x50) -> `[0x88cd2]` (menu use).
- Key table: 12 pairs of (scan code, state) at **0x7b6d8** (pointer
  `[0x7d990]`); every pair whose code matches gets the state.
- Last raw code -> `[0x88cd0]` (ESC is tested as `[0x88cd0] == 1`).

### 7.2 Key table and defaults

**[C]** Pairs 0..5 = player 1, 6..11 = player 2, in the help-screen order:
steer left, steer right, accelerate, fire, brakes, hand brake turn. The 24
bytes are loaded from `WACKY.CFG` at file offset 0x492 (0x36046); WW.EXE has
no defaults and refuses to start without the file.

**[C]** Defaults are written by `SETUP.EXE` (byte sequence at file offsets
0x371c2 and 0x37e5f, twelve `mov byte [table + 2k], code`):

| control | player 1 | player 2 |
|---|---|---|
| steer left | 0x4b Left arrow | 0x20 D |
| steer right | 0x4d Right arrow | 0x21 F |
| accelerate | 0x38 Alt | 0x1e A |
| fire | 0x1d Ctrl | 0x1f S |
| brakes | 0x50 Down arrow | 0x22 G |
| hand brake turn | 0x39 Space | 0x23 H |

### 7.3 Per-frame read (race loop 0x3114c..0x31229)

- **[C]** 0x377ae: accelerate `[0x88b40]`, fire `[0x88b42]`, brake
  `[0x88b44]`, hand brake `[0x88b46]` = key states at table offsets +5, +7,
  +9, +11; then, unless the joystick is disabled, port 0x201 buttons (bits
  4..7, active low) OR in as accelerate, fire, brake, hand brake.
- **[C]** 0x3784b: joystick axes are timed on port 0x201 and compared with
  the calibrated centre and dead zones to give digital left `[0x88cd5]` /
  right `[0x88cdd]`. Then the key states OR in (0x31209). Steering is purely
  digital on every device.
- **[C]** Kart update (0x29322..0x29383): `left = [0x88cd5] != 0`,
  `right = [0x88cdd] != 0`; if `kart+0x14` is set (reversed controls, set at
  0x21da7) they are swapped; both are zeroed while airborne.
- **[I]** Mouse: not seen. Modem/demo input arrives as one packed byte
  `[0x88cef]` (bits 0..5 = left, right, accelerate, fire, brake, hand brake;
  0x2d94c).

### 7.4 Input gate 0x2d6d0 and throttle rules

- **[C]** Fire, brake and hand brake are zeroed while the race is not running.
- **[C]** All six inputs are zeroed while the kart is spinning, doing a hand
  brake turn, crashing, frozen by a weapon, or in the finish state
  `[0x88c3c]`.
- **[C]** Cheat combos, enabled by command-line words that set bits of
  `kart+0xe0` (0x3618d..0x36239: `TURBO` 1, `JUMP` 2, `HOG` 4, `ICE` 8,
  `FIRE` 0x10): brake + fire with bit 0 = turbo on demand; brake + accelerate
  with bit 1 = jump on demand.
- **[C]** Throttle per tick (0x29553..0x296d5), in order:
  1. brake held and throttle > 0: accelerate input := 0, sound 0x11,
     throttle -= 8 (floor 0);
  2. turbo active: hold throttle, count the timer down;
  3. else accelerate held: throttle += 10 (6 in two-player/special modes),
     clamp to 100;
  4. else: throttle -= 4 (floor 0).
  Braking therefore removes 12 per tick (100 to 0 in 9 ticks); brake at
  throttle 0 does nothing; there is no reverse gear.
- **[C]** Steering works at speed 0 in a normal race (no speed test in the
  normal branch). In the modes with `[0x7d998] != 0` it is disabled at speed
  0 (0x2939c..0x29415).
- **[I]** The kart update is called before the start signal too; the
  movement step forces speed 0 until `[0x88c44] == 2` (0x237f7) but the
  throttle rules still run, so holding accelerate on the grid gives full
  throttle on the first racing tick.

### 7.5 Engine class `[0x7ee5a]`

**[C]** Menu at 0x16835..0x1692c with the strings "FAST 12 HP ENGINES"
(0x60535) and "SLOW 6 HP ENGINES" (0x6054c). 1 = fast = `VEL.TAB` (top 40
px/tick, turbo 64, jump 60); 2 = slow = `VEL2.TAB` (28 / 45 / 42). Kid mode
forces 2.

### 7.6 Steering setting `[0x88c20]`

**[C]** Copy of the config word `[0x7ee58]`, which is the result of the
three-entry menu at 0x163fc built from "HIGH DETAIL", "MEDIUM DETAIL", "LOW
DETAIL" (0x60450..0x6047f). 1 = high = 40 units per tick, 2 = medium = 36,
3 = low = 32 (0x16ca0). Forced to 36 in `[0x88be2]` / `[0x7ec74]` modes. Skid
rate is half (`[0x88c7a]`, 0x16d09), hand brake and spin are always 120.
**[I]** It is the screen detail option; the steering rate was tied to it,
presumably to compensate for frame rate.

## 8. Timing

- **[C]** The timer library keeps a list of tasks, each with its own PIT
  divisor. `0x40afc(rate)` computes `0x12305e / rate` and, if that is smaller
  than the current divisor, programs the PIT (0x40ab0: 0x36 to port 0x43,
  low/high byte to port 0x40). The interrupt handler (0x40b5c -> 0x40be4)
  adds the PIT divisor to each task's accumulator and calls the task when it
  reaches the task's divisor; the original 18.2 Hz handler is chained every
  0x10000 counts.
- **[C]** `[0x7e720]` is registered at 136 Hz (0x364c2; handler 0x10be8
  increments the dword). Divisor 1192030 / 136 = 8764, so the real rate is
  1193182 / 8764 = 136.1 Hz (and stays 136.1 Hz on average if a faster task
  reprograms the PIT). Other uses of the counter agree, e.g. a 272-count
  modem wait (0x10f4f).
- **[C]** Frame pacing (0x31049, 0x31108..0x31122): the counter is sampled
  at the top of the frame and the loop busy-waits until 12 counts
  (`[0x7ea5c]`) have passed. One logic step per frame, no delta time.
  `[0x7ec64]` is a frame counter incremented once per frame (0x3114c); all
  "at least 1 frame since" animation gates are therefore true every tick.
- **[C]** `[0x7ea5c]` = `[0x7ed08]` (0x16d5b): default 12 (0x35cf4);
  command line `/1` = 12, `/2` = 6, `/3` = 0 (no wait) (0x36243..0x36296).
- **[I]** Default tick = 12 / 136.1 s = 88.2 ms = **11.3 ticks per second**
  on a machine that renders a frame in under 88 ms. All constants in this
  document are per tick at that rate. With `/2` the whole game, physics
  included, runs twice as fast.

## 9. Kart struct fields used above (base 0x68410, stride 0x104, pointer `[0x7d5b0]`)

| off | meaning | evidence |
|---|---|---|
| +0x06 | hand brake turn: 0 none, 1 left, 2 right | 0x2974e, 0x2251f |
| +0x08 | hand brake tick counter (1..5) | 0x29738, 0x22554 |
| +0x0a | air state 0..3 | 0x21715, 0x292e2, 0x24cad, 0x253c5 |
| +0x0c / +0x0e / +0x10 | jump countdown / max height / height | 0x2172a.., 0x24c73 |
| +0x14 | reversed steering flag | 0x2934a |
| +0x16, +0x6a | held item, ammo count | 0x232ad, 0x232bb |
| +0x18, +0x1a, +0x1c, +0x4e | sprite animation state / frame / target / frame pointer | 0x298cf.. |
| +0x20 | spin-out: 0, 1 left, 2 right | 0x227fc, 0x225b5 |
| +0x22 / +0x24 | steer-left / steer-right hold counters | 0x29448, 0x2948a |
| +0x26 | speed this tick, px | 0x296d5 |
| +0x36 / +0x3a | drag / skid threshold of the current surface | 0x241bd, 0x241cd |
| +0x3c | skid: 0, 1 left, 2 right | 0x22a47, 0x22b5d |
| +0x3e | spin threshold (2 x skid threshold) | 0x2270f |
| +0x40 | skid timer (120, -10 per tick) | 0x22a5f, 0x228b0 |
| +0x42 | throttle 0..100 (160 turbo, up to 190 after a shove) | 0x29657, 0x2d4b2 |
| +0x44 | water state | 0x24271, 0x26b6d |
| +0x46 | spark animation side (3 / 4) | 0x23b1e, 0x2375e |
| +0x52 / +0x54 | backdrop scroll ramps (left / right) | 0x23c8a, 0x23da9 |
| +0x56 | surface type under K | 0x241a5 |
| +0x6c | attempts left (starts at 3) | 0x2fe86, 0x314ee |
| +0x7c | "touched something" (set, never cleared) | 0x217d3, 0x21871 |
| +0x7e | crashing | 0x233f4, 0x2357d |
| +0xb4 / +0xb6 | turbo active / ticks left | 0x29808, 0x29842 |
| +0xe0 | command-line cheat bits | 0x2d851, 0x2d8cb |

## 10. Not determined

1. **The crash rule (5.2) as gameplay.** The code path is clear, but whether
   a full-throttle touch really costs an attempt and restarts the race must
   be checked in DOSBox. Also unknown: the meaning of the opponent slot word
   `+0x38 + 2 * player` that gates it (values 0, 1, 7 allow the crash).
2. The one-tick stall when a skid ends (6.2) — real, or masked by something
   not found.
3. Human names of the surface types, and of the sound ids (0x0c turbo/jump,
   0x0d crash, 0x0e water loop, 0x0f splash, 0x11 screech, 0x15 scrape/bump,
   0x16 kart bump, 0x17 landing). Sounds are indexed into `AUDIOHED.FX` /
   `AUDIOT.FX` (0x11f98); no names in the executable.
4. Callers of 0x24298 (start jump) and 0x242fc (start turbo); neither is
   called directly. Possibly unused or reached through a pointer.
5. Whether the jump height code runs once per tick in the split-screen modes
   (it lives in the draw routine; two viewports could step it twice).
6. The object class table at 0x72998 (which `N.SPW` types are solid) — its
   loader was not traced.
7. Readers of `kart+0xaa` (set when the walk was blocked or while skidding)
   and `kart+0x1e` (set at spin end).
8. The other eight words of the `WACKY.SDX` tail and how the effect sprites
   (dust, splash) are placed; cosmetic.
9. What sets `kart+0x14` (reversed steering) in play, and the sub-modes
   selected by `[0x7d998]` (1..3).
10. Joystick calibration details and the two-player / modem control paths.
11. The default key table was read from the bytes in `SETUP.EXE`, not by
    tracing its code; the two identical copies make it very likely but it is
    not proven that this is what a fresh `WACKY.CFG` contains.
12. Turbo strips on tracks other than the eleven listed keep the previous
    race's heading window; no such track has a type-2 pixel, so this has no
    visible effect.
