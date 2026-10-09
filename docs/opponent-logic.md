# Wacky Wheels (WW.EXE) — computer opponent logic

Static reverse engineering of `dos/WWINST/WW.EXE` (DOS4GW LE, code object at
0x10000, data object at 0x60000). All addresses are linear addresses in that
layout. Every statement is tagged:

- **[C]** confirmed by reading the disassembly at the addresses given
- **[I]** inference (reasoned from the code or data, not directly proven)

Nothing here was verified by running the game.

## 0. Headline

**[C]** Opponents do not steer, accelerate or brake. They are "on rails": each
`.RD` segment is rasterised at load time into a list of integer points (one
point per pixel, Bresenham), and every tick an opponent simply advances N
points along that list, where N is its current speed in pixels per tick. Their
position is copied straight out of the point list. There is no heading
integration, no steering amount, no terrain lookup and no wall collision for
opponents. The only "decisions" are a 4-state speed machine, a catch-up rule
tied to the player's progress and rank, and two small tweaks (overtake hop,
kid mode).

So questions about "steer left or right, by how much" have the answer: they
do not. The displayed facing is the segment's precomputed octant.

## 1. Data files in memory

### 1.1 `N.RD` — opponent path

Loader: 0x27f22..0x2802b (file name built on the stack at 0x27bd4..0x27c00,
opened at 0x27f24 via the archive-open helper 0x1418c).

- **[C]** u16 count is read into `[0x88b7a]` and immediately decremented
  (0x27f66), so `[0x88b7a]` = index of the last segment.
- **[C]** Each 14-byte record is read into a scratch buffer at 0x7ee0c
  (0x27f80). Only five of the seven words are used:
  - x1 (+0), y1 (+2), x2 (+4), y2 (+6), each with 0x400 added
    (`add ah,4`, 0x27fa0..0x27fd0) -> `[0x88ba4]`, `[0x88bc2]`, `[0x88ba6]`,
    `[0x88bc4]`.
  - word +10 (the "octant 0..7" field) -> segment table.
  - word +8 (heading) and word +12 (length) are read but never referenced
    anywhere else (no other reference to 0x7ee14 / 0x7ee18 in the code).
- **[C]** 0x21554 rasterises the line (x1,y1)->(x2,y2) with Bresenham into
  the buffer whose write cursor is `[0x7ed10]` (initialised from `[0x7ed14]`,
  allocated at 0x33b51). Each point is 4 bytes: i16 x, i16 y (already +0x400).
  One point per step along the major axis, end point included; returns the
  point count.
- **[C]** Segment table at **0x72350**, 8 bytes per segment:
  `+0 u32 pointer to first point`, `+4 u16 point count`, `+6 u16 octant`.
- **[C]** The first segment's start is saved to `[0x88c04]` (x) /
  `[0x88c06]` (y) (0x27fdb).
- **[I]** Octant = round((heading - 480) / 240) mod 8, i.e. 0 = +y (down),
  2 = -x, 4 = -y, 6 = +x. Checked against track 1 data only.
- **[C]** Coordinate system: all kart positions carry a +0x400 bias. The
  64x64-tile track sits in the middle of a 128x128-tile map (texture pointer
  table `[0x7d6a4]`, 0x37b04; rows 0x20..0x5f filled by the `.M` loader at
  0x27e6c). 1 unit = 1 texel; player position is clamped to 0x400..0xbfe
  (0x29145).

Readers of the segment table: 0x16d68 (advance helper used by the special
mode), 0x17188..0x1720b (race start), 0x28f59 (per-tick advance).

### 1.2 `N.POS` — lap progress map

- **[C]** 0x2000 bytes -> buffer `[0x7d5fc]`, trailing u16 -> `[0x88ba2]`
  (0x27cb7..0x27ce6). `[0x88ba0]` = that / 4 (not seen used for AI).
- **[C]** Lookup function 0x1260c(eax = x, edx = y): returns 0 if
  (x-0x400, y-0x400) is outside 0..0x7ff, else the u16 at
  `[0x7d5fc] + ((y-0x400)>>5)*128 + ((x-0x400)>>5)*2` — a 64x64 u16 tile map.
- **[C]** Meaning: a checkpoint number per tile, 1..max, where max =
  `[0x88ba2]`; 0 = no value. A lap is counted when a kart's value becomes 1
  while its previous value was max (0x12b8f..0x12bce for humans,
  0x12eb7..0x12ee4 for opponents). (Track 1: values 0..27, trailer 27.)
- **[C]** Progress metrics written every tick by 0x12b44:
  - `kart[i] + 0x2a` (0x6843a + i*0x104) = lap*1024 + pos, used for ranking
    (sorted at 0x128a4, rank 1..8 stored in `kart + 0xac`).
  - `kart[i] + 0x2e` (0x6843e + i*0x104) = lap*max + pos. This is the value
    the catch-up rule compares.
  - Opponents: lap count in `opp + 0x22`, last pos in `opp + 0x24`, finishing
    order in `opp + 0x20`.

### 1.3 `N.SIN` — not AI

- **[C]** 108 records of 12 bytes; the first 4 bytes of each are discarded and
  the remaining 8 stored at 0x7ad88 (pointer `[0x7d870]`), 0x27d7b..0x27dbc.
- **[C]** Used only by the terrain probes 0x37a6c / 0x37b04: index = tile
  graphic number; the two dwords are the surface type put in `[0x7e568]` when
  the per-texel mask byte is zero / non-zero. It is the surface-type table.

### 1.4 `N.SPW` — not AI

- **[C]** Read by 0x21490: u16 count -> `[0x88b8e]`, then count*12 bytes to
  0x73938; x (+4) and y (+6) get +0x400; word +2 is zeroed (later set to
  0xffff = collected/removed, 1 = touched).
- **[C]** These are the pickup/obstacle objects the player's movement trace
  tests against (0x2176f..0x21800, hit radius: Manhattan distance < 14).

`.PAR`, `.BMC`, `.GAM`: not examined.

## 2. Opponent table

**[C]** Base **0x6aa90**, stride 0x68, indices 0..`[0x88c40]`
(`[0x88c40]` = `[0x7ecb0]` = 7 in a normal race, 0x3038a). The pointer to the
entry being processed is `[0x7d800]`. Slot 0 is the human player's mirror (and
slot 1 too in the two-player modes `[0x88bdc]` / `[0x88be2]`): the main loop
copies the player's position into it (0x325bc..0x325d9) and the opponent
update skips it (0x28d0d..0x28d37). Single-player race = 7 opponents, slots
1..7.

| off  | size | meaning | evidence |
|------|------|---------|----------|
| +0x00 | u16 | merge state: 0 none, 3 = left of line, 4 = right of line | 0x17211..0x17240, 0x28e07 |
| +0x02 | u16 | 0 normal, 1 = touched a human kart this tick, 2 = inactive/removed | 0x29005, 0x21838 |
| +0x04 | u16 | speed state 0..3 (section 3) | 0x28d42 |
| +0x06 | u16 | state-0 countdown, init 0x18 (24 ticks) | 0x17336.., 0x28d5f |
| +0x08 | u16 | cruise speed | 0x1731f, 0x30d2e |
| +0x0a | u16 | launch / catch-up speed | 0x17327, 0x30d18, 0x28bf4 |
| +0x0c | u16 | state-0 speed | 0x173a9 |
| +0x0e | u16 | state-1 / state-3 countdown | 0x17294.., 0x28bee |
| +0x10 | u16 | points left in current segment | 0x171f6, 0x28f33 |
| +0x14 | u16 | lateral offset from the line (pixels) | 0x1727b, 0x28e13 |
| +0x16 | i16 | x (+0x400 biased) | 0x28f0a |
| +0x18 | i16 | y | 0x28f2b |
| +0x1a | u16 | facing octant (from segment) | 0x28f73 |
| +0x1c | u16 | current segment index | 0x28f39 |
| +0x20 | u16 | finishing order | 0x12f15 |
| +0x22 | u16 | laps | 0x12ee4 |
| +0x24 | u16 | last `.POS` value | 0x12f4a |
| +0x50 | u32 | heading (slots of human karts only) | 0x325d9, 0x28777 |
| +0x58 | u16 | "hit by weapon" state, non-zero freezes the kart | 0x28cdb, 0x289ec |
| +0x4c | u32 | frame number when hit | 0x28a9c |
| +0x5e | u32 | pointer to next point in the rasterised path | 0x28f04 |

The human kart struct is separate: base 0x68410, stride 0x104, pointer
`[0x7d5b0]`.

## 3. Race start (0x16f90, normal-race branch 0x170a9..0x173c3)

**[C]** Start grid: slot 0's start point `(sx, sy)` comes from
`[0x7d7cc]` / `[0x7d7e0]` (filled from track data at 0x27396 with +0x3e0;
source file not traced). When `[0x88be2] == 0` the eight grid slots are
generated in a single row (0x170b3..0x170f4): same y for everyone, x =
`sx + 80, +60, +40, +20, +0, -20, -40, -60` for slots 4, 3, 2, 1, 0, 7, 6, 5.

**[C]** For each slot i (0x170f8..0x1728e):

```
opp.x, opp.y   = grid[i]
opp.octant     = seg[0].octant
opp.seg        = 0
dy             = abs(seg0_start_y - opp.y)          ; [0x88c06]
opp.lateral    = abs(seg0_start_x - opp.x)          ; [0x88c04]
opp.pointsLeft = seg[0].count - dy
opp.ptr        = seg[0].points + 4*dy
opp.merge      = 3 if opp.x < seg0_start_x, 4 if opp.x > seg0_start_x, else 0
opp.state      = 0
```

**[I]** This assumes segment 0 runs along the y axis (true for track 1).

**[C]** Speed fields, with `B = [0x88b84]` (section 5):

```
opp[i].cruise  (+0x08) = B
opp[i].launch  (+0x0a) = B + 60 - 10*(7-i)
opp[i].state0  (+0x0c) = B - 4  - 10*(7-i)
opp[i].timer0  (+0x06) = 24                                  for all
opp[i].timer1  (+0x0e) = 22,28,30,34,40,50,58,60             for i = 0..7
```

**[C]** Then at 0x30d18..0x30d7b (opponents i >= 1 only) `cruise` and `launch`
are converted through the velocity table `VELTAB` (0x7e730, section 6):
`cruise = VELTAB[cruise]`, `launch = VELTAB[launch]`, and then both are scaled
by the same drag factor the player received at race start:
`v -= (v * player.kart[+0x36]) >> 16` (factor is 0 on normal surface).
**`state0` (+0x0c) is NOT converted** — it is used raw as pixels per tick.
This is what the code does (the only writer is 0x173a9, the only reader
0x28d5b); it looks odd, so see "Unknown / to verify".

## 4. Per-tick opponent update (0x28cac)

Called once per game tick from the main loop (0x3277c / 0x3278d), only while
`[0x88c44] == 2` (race running). Order within a tick: player input 0x2d6d0,
player kart 0x290a0, copy player pos to slot 0, 0x24364, **opponents
0x28cac**, progress/rank 0x12b44, 0x2602c.

All of this is **[C]**; names are mine.

```
for i in 0..[0x88c40]:
    opp = &table[i]
    if opp.hit (+0x58) != 0: run hit timer (0x289ec); continue
    if i is a human slot: continue           ; slot 0, plus slot 1 in 2P modes

    ; ---- speed state machine (jump table 0x28c9c) ----
    switch opp.state:
      0: speed = opp.state0                  ; raw px/tick
         if --opp.timer0 <= 0: opp.state = 1
      1: speed = opp.launch
         if --opp.timer1 <= 0: opp.state = 2
      2: speed = opp.cruise
         speed = catchUp(i, speed)           ; 0x28b20, may switch to state 3
      3: speed = opp.launch                  ; holds the catch-up speed
         diff = player.progress - kart[i].progress        ; +0x2e values
         if --opp.timer1 <= 0 or diff <= (7 - i) + T: opp.state = 2

    ; ---- merge from grid position onto the line ----
    lateral = 0
    if opp.merge != 0:
        lateral = (opp.merge == 3) ? -opp.lateral : +opp.lateral
        opp.lateral -= 4
        if opp.lateral <= 0: opp.merge = 0

    ; ---- overtake hop ----
    if opp.merge == 0 and opp.state == 2 and not specialMode([0x7ec74]):
        for j in 7 down to 1, j != i:
            if |opp[j].x - opp.x| + |opp[j].y - opp.y| < 20:
                speed += 60; break

    ; ---- kid mode ----
    if [0x7edb0] != 0 and [0x88c3c] == 0:
        speed = max(speed - 12, 4)

    ; ---- advance `speed` points along the rails ----
    repeat speed times:                      ; nothing happens if speed < 1
        opp.x = ptr->x + lateral             ; lateral applies to x only
        opp.y = ptr->y
        ptr += 1 point
        if --opp.pointsLeft == 0:
            opp.seg = (opp.seg + 1 > lastSeg) ? 0 : opp.seg + 1
            opp.octant, opp.ptr, opp.pointsLeft = seg[opp.seg]
        ; contact test against human karts, every single point:
        for h in human slots (0, or 0..1 in 2P):
            if kart[h].spinning(+0x0a) == 0 and kart[h](+0x7e) == 0
               and [0x88c3c] == 0
               and |opp.x - slot[h].x| + |opp.y - slot[h].y| < 14:
                opp.flag(+0x02) = 1
                kart[h].contact(+0x7c) = 1
```

Notes:

- **[C]** Speed is literally an integer number of path points (pixels) per
  tick. There is no fractional accumulator and no acceleration ramp other than
  the state changes.
- **[C]** Opponents never consult terrain, walls, objects or other karts for
  movement (the overtake hop is the only kart-kart interaction among
  opponents). They pass through everything.
- **[C]** The last segment wraps to segment 0; the path is a closed loop.
- **[C]** The lateral offset shrinks 4 px per tick, so the grid row collapses
  onto the centre line within at most 20 ticks (max offset 80).
- **[I]** Because the hop adds 60 px to whichever of two close opponents is
  processed first (lower index first) and the other then no longer sees it
  within 20 px, the effect is that the lower-index kart jumps ahead of the
  other; opponents never stay stacked on the same spot.

### 4.1 Catch-up rule, function 0x28b20(i, speed) — the rubber band

**[C]** Disabled entirely when `[0x88bdc] != 0` (two-player), `[0x7ec74] != 0`
(special mode) or `[0x7edb0] != 0` (kid mode). Only called from state 2.

```
diff = player.progress - kart[i].progress    ; [0x6843e] - [0x6843e + i*0x104]
                                             ; progress = lap*maxPos + posValue
if i < 4: return speed                       ; slots 1..3 never catch up

if diff >= (7 - i) + T:                      ; player is that many checkpoints ahead
    if opp.state != 3:
        v = VELTAB[B] + bonus[i]             ; bonus: i=4:+16, 5:+28, 6:+36, 7:+40
        opp.state  = 3                       ; jump table 0x28b10
        opp.timer1 = 32000
        opp.launch = v
        speed      = v
else if opp.state == 3:
    opp.state = 2

if i < 5: return speed
rank = currentKart[+0xac]                    ; [0x7d5b0]; the player's race position
switch rank:
    1: i==7: speed += 5   i==6: speed += 4   i==5: speed += 3
    2: i==7: speed += 1   i==6: speed += 2   i==5: speed += 3
    3:                    i==6: speed += 1   i==5: speed += 2
    other: nothing
return speed
```

- **[C]** `T = [0x7ece0]` is the difficulty threshold (section 5).
- **[C]** Units of `diff` are `.POS` checkpoint numbers (track 1 has 27 per
  lap), not pixels.
- **[C]** The catch-up speed is not scaled by the surface drag factor and
  ignores the rank bonus while state 3 lasts (state 3 does not call 0x28b20).
- **[C]** State 3 ends when the gap closes to `diff <= (7 - i) + T` or after
  32000 ticks.
- **[I]** `kart + 0xac` is race position 1..8: written by the sort in 0x128a4
  (0x1295a, 0x12a08, 0x12b22), initialised to 8 or 1 at 0x3021e / 0x30232.
- **[C]** There is no rule that slows opponents down when the player is
  behind. The only handicaps in the player's favour are the cruise speed being
  below the player's top speed and the catch-up being limited to slots 4..7.

## 5. Difficulty and class constants (0x19db4, jump table 0x19da8)

**[C]** `[0x88bb2]` selects the row; `[0x7ee5a]` (copied to `[0x7ea58]`) is a
1/2 setting that also selects the velocity table.

| `[0x88bb2]` | label string copied | `B = [0x88b84]` if `[0x7ee5a]==1` | otherwise | `T = [0x7ece0]` |
|---|---|---|---|---|
| 1 | "AMATEUR. " (0x6094c) | 0x59 | 0x5a | 8 |
| 2 | "PRO. " (0x60958) | 0x5e | 0x5c | 4 |
| 3 | "CHAMPION. " (0x60960) | 0x63 | 0x5e | 1 |
| 4 | (empty string) | 0x54 | 0x54 | 20 |

- **[I]** Row 4 is time trial / a non-championship mode ("TIME TRIAL" is the
  4th class name at 0x609a5); `[0x88bb2] == 5` is "KID MODE" (0x19fb2), which
  resets to 1 and sets `[0x7edb0] = 1`.
- **[C]** Default before any menu choice: `B = 0x59` (0x1e501).
- **[C]** Speeds do **not** differ per character. They differ only by slot
  index i (grid slot), difficulty and class. Which character sits in which
  slot was not traced.
- **[I]** `[0x7ee5a]`: 1 = fast engine class, 2 = slow class (forced to 2 in
  kid mode, 0x16848). The game's actual label for it was not located.

Resulting opponent speeds in pixels per tick (computed from the tables, **[I]**
in the sense that I evaluated them offline):

Class 1 (`VEL.TAB`), player top speed 40:

| difficulty | B | cruise | launch, slots 1..7 | state-0 raw, slots 1..7 | catch-up, slots 4..7 |
|---|---|---|---|---|---|
| Amateur | 0x59 | 36 | 36 40 44 48 52 56 60 | 25 35 45 55 65 75 85 | 52 64 72 76 |
| Pro | 0x5e | 38 | 38 42 46 50 54 58 62 | 30 40 50 60 70 80 90 | 54 66 74 78 |
| Champion | 0x63 | 40 | 40 44 48 52 56 60 64 | 35 45 55 65 75 85 95 | 56 68 76 80 |
| row 4 | 0x54 | 34 | 34 38 42 46 50 54 58 | 20 30 40 50 60 70 80 | 50 62 70 74 |

Class 2 (`VEL2.TAB`), player top speed 28:

| difficulty | B | cruise | launch, slots 1..7 | catch-up, slots 4..7 |
|---|---|---|---|---|
| Amateur | 0x5a | 25 | 25 28 31 34 36 39 42 | 41 53 61 65 |
| Pro | 0x5c | 26 | 26 29 32 34 37 40 43 | 42 54 62 66 |
| Champion | 0x5e | 27 | 27 29 32 35 38 41 43 | 43 55 63 67 |

(State-0 raw speeds are `B - 4 - 10*(7-i)` regardless of class.)

Phase durations: state 0 lasts 24 ticks for everyone; state 1 lasts
28, 30, 34, 40, 50, 58, 60 ticks for slots 1..7; then cruise forever.

**[I]** Net effect: the opponents fan out along the track during the first
~84 ticks by fixed amounts, then all cruise at the same speed, slightly below
(or, on Champion, equal to) the player's top speed. Order among opponents
never changes after the launch except through the catch-up rule.

## 6. Player speed model (for comparison)

Code: 0x290a0 (kart update), 0x237e4 (movement), 0x224ec (steer amounts).

- **[C]** `VEL.TAB` is read to 0x7e8c4 and `VEL2.TAB` to 0x7e584
  (0x365cf..0x3663d), 200 i16 each. At race setup (0x16d0b..0x16d59) one is
  copied to the working table `VELTAB` at 0x7e730: `VEL2` if
  `[0x7ea58] == 2`, else `VEL`.
- **[C]** `kart + 0x42` is a throttle value 0..100; `kart + 0x26` =
  `VELTAB[throttle]` is the speed in pixels per tick (0x296c9).
  - accelerate held: throttle += 10 per tick (+= 6 in 2P-split / special
    modes), capped at 100 (0x29650..0x2966d)
  - no accelerate: throttle -= 4 per tick, floor 0 (0x296b7)
  - brake (`[0x88b44]`): throttle -= 8 per tick, floor 0 (0x29597)
  - kid mode: accelerate is forced on and throttle is pinned to 0x36
    (0x29601, 0x2965e)
  - turbo (surface type 2 with 0x125bc returning non-zero, 0x29808; also
    0x24315, 0x2d86d): throttle = 160 for 16 ticks (`kart + 0xb6`), during
    which the normal accelerate/coast code is skipped
- **[C]** Top speeds: `VEL[100]` = 40, `VEL2[100]` = 28; turbo `VEL[160]` =
  64, `VEL2[160]` = 45. So 0..top takes 10 ticks, coasting to zero 25 ticks.
- **[C]** Surface drag: `speed -= (speed * kart[+0x36]) >> 16` each tick
  (0x22940..0x22965). `kart + 0x36` comes from a per-surface-type table
  (0x741f8 + type*0x12e, field +0x120; 0x30c70). Values not extracted (table
  is filled at run time).
- **[C]** Movement (0x237e4): target = pos + speed * (cos, sin)(heading) with
  16.16 trig, then 0x21de0 walks a Bresenham line pixel by pixel from the old
  to the new position, calling 0x216a0 at every pixel; the walk stops at the
  first pixel where `[0x88bae]` becomes non-zero (1 = wall surface type 3,
  2 = object, 3 = another kart, 4 = surface type 10 hazard which starts a
  spin).
- **[C]** Steering amounts per tick, units of 1/1920 circle (0x16ca0,
  0x2299d..0x229dd): `[0x88c7c]` = 40, 36 or 32 for `[0x88c20]` = 1, 2, 3
  (forced to 36 in `[0x88be2]` / `[0x7ec74]` modes). While skidding the amount
  is `[0x88c7a]` = half of that (0x16d09). Spin-out uses `[0x88c54]` = 0x78.
  `[0x88b92]` is subtracted from the heading, `[0x88b90]` added (0x23c9b,
  0x23dba). `[0x88c20]` comes from the config word `[0x7ee58]` (default 2);
  its menu label was not located.

## 7. Tick rate

- **[C]** Three periodic timers are registered at 0x364c2..0x3650f through the
  timer library call 0x40e38 (handler 0x10be8 just increments a dword):
  `[0x7e720]` at 136 Hz, `[0x7e71c]` at 10 Hz, `[0x7ea74]` at 1 Hz. The
  library programs the PIT at 0x40ab0 (mode byte 0x36 to port 0x43, divisor to
  port 0x40), divisor = 0x12305e / rate.
- **[C]** The race loop runs exactly one logic step per rendered frame (all
  speeds above are per frame; there is no delta time). At the end of each
  frame (0x31108..0x31122) it busy-waits until
  `[0x7e720] - frameStartCount >= [0x7ea5c]`, where the start count is sampled
  at the top of the loop (0x31049).
- **[C]** `[0x7ea5c]` = `[0x7ed08]` (0x16d5b), default 12 (0x35cf4). Command
  line switches (0x36243..0x36296): `/1` -> 12, `/2` -> 6, `/3` -> 0
  (uncapped).
- **[I]** Default tick = 12/136 s = 88.2 ms = **11.33 ticks per second**, on a
  machine fast enough to finish a frame in that time; slower machines simply
  run the whole game slower. Sanity check: track 1 path is 5642 px, cruise
  36 px/tick -> 157 ticks = 13.8 s per lap.

## 8. Kart-to-kart collision

- **[C]** Detection, player moving into an opponent (0x21802..0x2189e, inside
  the per-pixel movement walk): for every table slot other than the player's
  own with `slot[+0x02] != 2`, if Manhattan distance between the probe point
  and the slot position < 14: `kart[+0x7c] = 1`, `slot[+0x02] = 1`,
  `[0x88bae] = 3`, and the walk stops — the player does not advance past the
  pixel before contact this tick. The probe point is the kart position plus
  the offset `[0x88b68]` / `[0x88b6a]`.
- **[C]** Detection, opponent moving into the player: the per-point test in
  section 4 (same 14 px Manhattan radius, same two flags). The opponent itself
  is not stopped, slowed or deflected; it continues along its rails.
- **[C]** Result code 3 does not trigger the wall-bounce branch in 0x237e4
  (that is only for code 1: heading + 960, i.e. reversed, 32 px shove, speed
  zeroed at 0x23c44); it only sets `kart[+0xaa] = 1` (0x23915).
- **[C]** `kart[+0x7c]` is consumed in the sprite pass at 0x231e6. One decoded
  consequence (0x2334d..0x2343b): in a single-player race, not kid mode, if
  the player is at full throttle (`kart[+0x42] >= 100`), not already spinning,
  and the touched sprite entry has `[+0x20] == 3`, then sound 0x0d plays,
  `kart[+0x7e] = 1`, throttle and skid state are zeroed and `[0x88c42] = 1`
  (a knocked-out / crash sequence). The rest of that routine
  (0x2345b..0x23772) was not decoded.
- **[C]** Weapon hits on opponents set `slot[+0x58]` (0x21b0a..0x21b3e);
  while it is non-zero the opponent does not move, for 0x21 or 0x32 frames
  depending on the hit type (0x289ec..0x28aa5).

## 9. Unknown / to verify

1. **State-0 speed is raw.** The code uses `B - 4 - 10*(7-i)` directly as
   pixels per tick for the first 24 ticks (25..85 px/tick on Amateur), which
   moves slot 7 about 2000 px in two seconds. I found no conversion through
   the velocity table for field +0x0c, but this is the one number that looks
   implausible; compare against the real game (DOSBox) before relying on it.
   If the real game shows a gentle start, the intended value is probably
   `VELTAB[that index]` (10..34 px/tick) and I missed a write.
2. Which character is assigned to which slot 1..7, and whether slot order is
   shuffled between races.
3. Source of the start position `[0x7d7cc]` / `[0x7d7e0]` (written at 0x27396
   from track data; file not identified) and the grid layout when
   `[0x88be2] != 0`.
4. What consumes `slot[+0x02] == 1` (the "touched" flag on an opponent) and
   the full player-side response to kart contact (0x2345b..0x23772): whether
   the player is slowed, bumped or only blocked.
5. The per-surface parameter table at 0x741f8 (drag factor `+0x120`, skid
   threshold `+0x124`): where it is loaded from and its values.
6. Meaning of `[0x7ec74]` ("special mode": up to 24 table entries spaced 260
   path points apart, 0x16f24) and of `[0x88be2]`; I treated them as
   non-standard game modes and did not analyse them.
7. The game's own names for `[0x7ee5a]` (class 1/2) and `[0x7ee58]` /
   `[0x88c20]` (steering 40/36/32).
8. `.PAR`, `.BMC`, `.GAM` contents.
9. Sprite frame selection for opponents (0x287ec uses a table at 0x706a0
   indexed by view octant*8 + kart octant; table is filled at run time).
10. Whether the 136 Hz figure is exact: it assumes the timer library's `edx`
    argument is a rate in Hz (divisor = 0x12305e / edx supports this).
