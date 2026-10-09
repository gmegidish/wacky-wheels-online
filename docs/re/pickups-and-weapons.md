# Wacky Wheels (WW.EXE) — pickups, weapons, obstacles

Static reverse engineering of `dos/WWINST/WW.EXE` (code base 0x10000, data
base 0x60000), building on `docs/opponent-logic.md`. Tags:

- **[C]** read directly from the disassembly / data at the addresses given
- **[I]** inference

Nothing was verified by running the game. "tick" = one pass of the race loop.
Angles are 1920 (0x780) per circle. "slot" = entry in the kart table
0x6aa90 (stride 0x68); "kart" = human kart struct `[0x7d5b0]` (0x68410,
stride 0x104).

## 0. Headline

- **[C]** `N.SPW` is a flat list of 12-byte records `{type, 0, x, y, 0, 0}`.
  `type` is an index into `SPRITE.ATR`; the **class** word of that
  `SPRITE.ATR` record decides everything: 0 = solid obstacle, 1 = tyre stack
  (knock-over), 2 = hedgehog pickup (+4 ammo), 3..7 = special weapon pickup
  (the class number is the weapon number).
- **[C]** Pickups do not respawn during a race. Obstacles never disappear
  (except the tyre stack).
- **[C]** There are six projectile types (0..5) in a 61-entry table at
  0x7f2b0. Only human karts fire; computer opponents never fire, never pick
  anything up and never collide with objects. They can only be hit.
- **[C]** A hit computer opponent stands still for 33 ticks (50 for the ice
  cube). A hit human spins for 8 ticks, or gets left/right swapped for 300
  ticks (weapon 7).
- Correction to the earlier doc: surface type 10 is a **jump ramp**, not a
  spin hazard (section 6).

## 1. Data files

### 1.1 `N.SPW` (loader 0x21490)

**[C]** `u16 count` -> `[0x88b8e]`, then `count` records of 12 bytes read to
0x73938. Track 1 has 13 records (file = 2 + 13*12 = 158 bytes); all 42 files
satisfy `len == 2 + count*12`.

| off | size | in file | in memory (0x73938 + i*12) | evidence |
|-----|------|---------|-----------------------------|----------|
| +0 | i16 | object type = `SPRITE.ATR` record index 0..35 | same | 0x2133d, 0x23227, 0x25c43 |
| +2 | i16 | always 0 in all 838 records | state: 0 idle, 1 touched this tick, -1 removed | 0x21510, 0x217e7, 0x2329c, 0x26224 |
| +4 | i16 | x, 0..2047 | x + 0x400 | 0x21519 |
| +6 | i16 | y, 0..2047 | y + 0x400 | 0x21521 |
| +8 | i16 | always 0 | not referenced by the race code | - |
| +10 | i16 | always 0 | current animation frame | 0x26230, 0x25c82 |

**[C]** After loading, 0x21310 walks the `SPRITE.ATR` table and, for every
type that occurs in this track's list, reads the sprite file (`w*h*frames`
bytes) into a shared buffer and stores the pointer at record +0x24. It also
records in `[0x7eda4]` the first type present whose class is 2.

### 1.2 `SPRITE.ATR` (in memory at 0x72998, stride 0x28, count `[0x88b82]`)

**[C]** The file is `u16 count (=36)` followed by 36 records of 40 bytes (so
the "nine u16 then a name at +18" description is the same data shifted by the
2-byte header).

| off | size | meaning | evidence |
|-----|------|---------|----------|
| +0x00 | i16 | **class** (see below) | 0x2322d, 0x2139d, 0x21439 |
| +0x02 | i16 | always 10; not seen used | [C] value, use unknown |
| +0x04 | i16 | frame width | 0x2134f |
| +0x06 | i16 | frame height | 0x21356 |
| +0x08 | i16 | width again (unused in code read) | - |
| +0x0a | i16 | height again (unused in code read) | - |
| +0x0c | i16 | scale-table set: 1 = 28x28, 2 = 14x28, 3 = 32x24. Indexes `0x6e470 + v*0x50 + distBand*4` | 0x25c4b..0x25c67 |
| +0x0e | i16 | number of animation frames | 0x21360, 0x26238 |
| +0x10 | char[20] | sprite file name | 0x2137a |
| +0x24 | u32 | run-time pointer to pixel data | 0x2136f, 0x25c98 |

Sprite data is column-major, `w*h` bytes per frame (confirmed by rendering).

Classes and the records that carry them (**[C]** class values from the file,
behaviour from 0x23219..0x23348; picture descriptions are **[I]** from
rendering the frames):

| class | ATR records (file) | picture | behaviour |
|-------|--------------------|---------|-----------|
| 0 | 24..35 (`OB2`..`OB13`) | cattail, striped post, cactus, red/yellow/green barrels, tyre+post, reeds, striped poles, bush, log | solid obstacle |
| 1 | 23 (`OB1`) | stack of tyres | solid; can be knocked over once (section 2.3) |
| 2 | 1..9, 11, 14..16, 18..22 (`H2 H4 H5 H7 H6 H8 H9 H10 H11 H14 H17 H18 H19 H21..H25`) | hedgehogs doing various things (2..7 frames) | hedgehog pickup: +4 ammo |
| 3 | 0 (`H1`) | matchbox with flame | weapon 3 |
| 4 | 12 (`H15`) | red blob | weapon 4 |
| 5 | 10 (`H12`) | black bomb | weapon 5 |
| 6 | 13 (`H16`) | oil can | weapon 6 |
| 7 | 17 (`H20`) | hedgehog on its back | weapon 7 |

**[I]** The many class-2 sprites are purely cosmetic variety; the code treats
all of them identically.

### 1.3 Per-race reset (0x213f0, called once from race setup 0x301b6)

**[C]**
```
for each object:
    state = 0
    if single-player and not demo([0x7d998]==0) and not special mode
       and [0x88bb2] == 4 and class >= 2:      ; "row 4" = time trial [I]
        state = -1                              ; no pickups in that mode
    if special mode ([0x7ec74]) and class > 2:
        type = [0x7eda4]                        ; weapons become hedgehog pickups
```

### 1.4 Animation and lifetime (0x261fc, once per frame from 0x2fb73)

**[C]** For every object whose state is not -1: `state = 0` (clears the
"touched" flag) and `frame = (frame + 1) % ATR.frames`. So every object
animates at one frame per tick, looping.

**[C]** State -1 is only ever written at 0x2329c (pickup taken), 0x23309
(tyre stack knocked) and 0x21445 (reset above). Nothing writes it back to 0
during a race: **no respawn**.

**[C]** Drawing: 0x25a78 projects each non-removed object into the sprite
list (entry +0x1c = object state, +0x22 = object index, +0x24 = -1 meaning
"not a kart"), skipping objects outside the view box and those closer than
0x50 or farther than 0x462 in view depth.

## 2. Touching objects

### 2.1 Detection (0x2175f..0x21800, inside the player's per-pixel walk)

**[C]**
```
if kart.jump(+0x0a) != 0: skip all object and kart tests   ; airborne
for each object with state != -1:
    if |obj.x - px| + |obj.y - py| < 14:
        kart[+0x7c] = 1; obj.state = 1; result [0x88bae] = 2; stop walk
```
The walk stops at that pixel, so **every** object, pickups included, blocks
the kart for the rest of that tick. The response is decided later, in the
sprite pass (0x231d5..0x23772), for sprite entries whose `+0x1c != 0` while
`kart[+0x7c] != 0`.

### 2.2 Pickups, class >= 2 (0x2324d..0x232d1)

**[C]**
```
if kart.ammo(+0x6a) >= 99: treat as obstacle (bump, not collected)
elif class != 2 and kart.weapon(+0x16) != 0: treat as obstacle (already holding one)
else:
    play sound [0x88b96]
    obj.state = -1                    ; gone for the rest of the race
    no bump
    if class == 2: kart.ammo = min(kart.ammo + 4, 99)
    else:          kart.weapon = class        ; 3..7
```
- **[C]** Note the ammo >= 99 test also blocks weapon pickups.
- **[I]** `[0x88b96]` is the local player's character number; sound ids 0..7
  are the eight character voice samples (0x11c16..0x11c2d suppresses ids <= 7
  other than `[0x88b96]` in special mode).

Inventory fields in the human kart struct:

| off | size | meaning | evidence |
|-----|------|---------|----------|
| +0x16 | i16 | held special weapon, 0 none, 3..7 from pickups, 8 from holding fire | 0x232ad, 0x2444b, 0x244c5 |
| +0x6a | i16 | hedgehog ammo, 0..99 | 0x232bb, 0x247f2 |
| +0x14 | i16 | steering-reversed flag | 0x21da7, 0x2934a |
| +0x8a | u32 | frame when +0x14 was set | 0x21db0, 0x2fc0d |
| +0x80 | i16 | fire button was down last tick | 0x243d6 |
| +0x8e | u32 | frame of last fire press (hold timer) | 0x2439d, 0x2440c |
| +0xe0 | u32 | command-line cheat bits (section 3.5) | 0x244ce.. |

**[C]** Race setup zeroes ammo and weapon only in the two-player / special
modes (0x30255..0x30283); in a normal single-player race they are left
alone, and they are stored to / restored from a per-save block (0x30020,
0x1fe86). **[I]** So ammo and a held weapon carry over between races of a
championship.

### 2.3 Tyre stack, class 1 (0x232d6..0x23348)

**[C]** If `[0x88c8c] == 0` and not two-player (`[0x88bdc] == 0`): sound
0x16, object removed, `[0x88c8c] = -1`, three screen-y words at 0x80ae8 are
seeded (sprite y, +11, +22). 0x2f7aa..0x2f910 then runs a screen-space
animation: state 1 rises 30 px per frame to y = 0x72, state 2 falls 10 px per
frame to y = 0xc7, state 3, then 0. Only one such animation at a time;
otherwise the stack is a plain obstacle. **[I]** Three loose tyres fly up and
drop.

### 2.4 Obstacles, class <= 0, and any un-collected object

**[C]** Crash (0x2334d..0x2343b): only in single-player, not kid mode, not
special mode; if the kart is not already out (+0x7e), not jumping, not
sinking (+0x44), throttle (+0x42) >= 100, and the obstacle is dead ahead
(sprite entry +0x20 == 3, i.e. its screen x is within +-4 px of the kart's):
sound 0x0d, `kart[+0x7e] = 1`, throttle and spin/skid state zeroed,
`[0x88c42] = 1` (the knocked-out sequence).

**[C]** Bump (0x2345b.., 0x2369f..0x23772, then 0x2d3fc once per frame):
```
cancel skid (+0x3c) / spin (+0x20) and zero throttle if either was active
sound 0x15 (object) or 0x16 (kart)
spark sprite on the kart: +0x46 = 3 or 4 (side), +0x48 = 0, +0x4a = SPARK.SP
heading -= 18 if the thing is to the right (entry +0x20 == 5) else += 18
position += 1 px along the new heading
; kart-kart only: entry+0x1e == 2 -> throttle = min(throttle+40, 190)
;                 entry+0x1e == 1 -> throttle = max(throttle-40, 0)
```
`SPARK.SP` is 4 frames of 90 bytes (0x255a4..0x255c7).

## 3. Firing (0x24364, called per human kart from 0x325de / 0x32718)

### 3.1 Button handling

**[C]** `[0x88b42]` is the fire input for the current kart.
```
if fire and kart[+0x7e]: return
if not fire: kart.holdT(+0x8e) = frame; kart.wasDown(+0x80) = 0
if fire:
    if not kart.wasDown: kart.wasDown = 1; kart.holdT = frame   ; new press
    else: fire = 0                                              ; no auto-repeat
    if frame - kart.holdT >= 20:                                ; held 20 ticks
        kart.holdT = frame
        if kart.weapon != 8 and [0x7e574] == 0:
            play sound [0x88b96]; kart.weapon = 8
        fire = 0
if not fire: return
if kart.jump(+0x0a) != 0: return
if slot.shotsInFlight(+0x12) != 0: return        ; silent
if kart.weapon == 0 and kart.ammo == 0: sound 0x1a; return
w = kart.weapon
if w == 0: w = 0; if cheat&0x10: w = 3; if cheat&0x08: w = 8
switch w (jump table 0x24340) ...
play fire sound (unless already playing)
if kart.weapon == 0: kart.ammo -= 1 else kart.weapon = 0
```
- **[C]** Firing is edge-triggered; there is no cooldown timer. The only
  rate limit is `slot[+0x12]` (set by weapons 0 and 3, see below).
- **[C]** Holding fire for 20 ticks loads weapon 8 for free, when
  `[0x7e574] == 0`. `[0x7e574]` is set to 1 at startup when `20.GAM` cannot
  be opened (0x34489..0x344b4). **[I]** i.e. the ice cube is a
  registered-version feature obtained by holding the fire key.
- **[C]** A held special weapon is always used before hedgehog ammo, and
  using it costs no ammo.

### 3.2 Weapon switch (0x2452c..0x247bb)

All spawns go through 0x2d548(type, ownerSlot) with globals `[0x7eb9c]`
(direction or spread index), `[0x7eb04]` (sprite) and `[0x88bc0]` (animation
frame count). `H` = kart heading `[0x7d5d4]`. Sprites are frames of
`HOGMIS.SP` (18x13, 234 bytes per frame, 26 frames, column-major).

| weapon | from | spawns | projectile type | direction | HOGMIS frames | sets slot+0x12 | fire sound |
|--------|------|--------|-----------------|-----------|---------------|----------------|-----------|
| 0 | hedgehog ammo | 1 | 0 | spread index 0 | 3..5 (hedgehog, 3-frame loop) | 1 | 0x14 |
| 1, 2 | - | nothing (table entries jump to the exit; ammo is still consumed) | | | | | none set |
| 3 | matchbox (class 3), `FIRE` cheat | 3 | 0 | spread index 0, 1, 2 | 6 (flame) | 3 | 0x13 |
| 4 | red blob (class 4) | 2 | 1 | H+480 and H-480 (left and right) | 7 (red face) | 0 | 0x17 |
| 5 | bomb (class 5) | 1 | 2 | H+960 (behind) | 8 (bomb) | 0 | 0x17 |
| 6 | oil can (class 6) | 1 | 3 | H+960 | 9 (dark puddle) | 0 | 0x17 |
| 7 | upturned hedgehog (class 7) | 1 | 4 | H+960 | 10 (hedgehog on its back) | 0 | 0x17 |
| 8 | hold fire, `ICE` cheat | 1 | 5 | spread index 0 | 23..25 (ice cube, 3-frame loop) | 0 | 0x14 |

Other `HOGMIS.SP` frames: 0..2 explosion puff (all projectiles, 0x261d3);
11..14, 15..18, 19..22 are three 4-frame kart effects selected at 0x24afc
(sparkle / smoke rings / fireballs by picture) — not weapon related as far as
decoded.

### 3.3 Projectile table (0x7f2b0, 61 entries of 0x22 bytes)

| off | size | meaning | evidence |
|-----|------|---------|----------|
| +0x00 | i16 | owner slot | 0x2d5aa |
| +0x02 | i16 | type 0..5 | 0x2d5a1 |
| +0x04 | i16 | active | 0x2d58f |
| +0x06 | i16 | 0 flying, 0xff exploding | 0x261c1 |
| +0x08 | i16 | "still inside owner" flag, starts 1 | 0x2d583, 0x21a01 |
| +0x0a | i16 | x (biased +0x400) | 0x2d5c2 |
| +0x0c | i16 | y | 0x2d5cf |
| +0x0e | i16 | animation frame | 0x26048 |
| +0x10 | i16 | animation frame count | 0x2d600 |
| +0x12 | i16 | bytes per frame = 234 | 0x2d5f0 |
| +0x14 | i16 | range = 1000 | 0x2d595 |
| +0x16 | i16 | step length: 16 for type 1, else 10 (types 0/5 switch to 100 after the first update) | 0x2d569.., 0x260bc |
| +0x18 | i16 | distance travelled | 0x260c2 |
| +0x1a | u32 | sprite pointer | 0x2d5f6 |
| +0x1e | u32 | types 1..4: heading. types 0/5: spread index 0/1/2 | 0x2d5b3, 0x25ea6 |

**[C]** Spawn (0x2d548): first free entry; position = `[0x88b68]`,
`[0x88b6a]` (written at 0x29190..0x291d0 as view position + 124 px along the
heading; **[I]** the kart's own track position); then one un-checked step of
`+0x16` px in its direction (0x25e6c with eax = 0). So mines are laid 10 px
behind the kart, side shots start 16 px out. If the table is full nothing is
spawned (ammo is still spent). All entries are cleared at race setup
(0x2d4fc).

### 3.4 Per-tick projectile update (0x2602c, after the opponents each tick)

**[C]**
```
for each active entry p:
    p.frame = (p.frame + 1) % p.frames
    if p.exploding: if frame wrapped: p.active = 0;  continue
    ownerHeading = slot[p.owner].heading(+0x50)

    ; direction (0x25e6c)
    types 1..4: dir = p.heading
    types 0, 5: dir = ownerHeading, -30 for spread index 1, +30 for index 2
                ; re-read every tick: the shot turns with its owner

    ; movement
    types 2, 3, 4: do not move; probe (0x218a4) at their own position
    types 0, 1, 5: walk pixel by pixel from pos to pos + step*dir,
                   probing each pixel (0x22230 -> 0x218a4), stop at first hit
                   (type 1 hitting a kart is placed at the far end of the step)

    type 1:  if result is wall(1) or object(2):
                 p.heading += 960; pos += step*newDir; result = 0   ; bounce straight back
    types 0, 5:
             p.step = 100
             p.travelled += step just used        ; 10, then 100 per tick
             if p.travelled >= 1000: result = 1   ; range reached

    if result != 0:                                ; explode
        sound 0x12
        slot[p.owner].shotsInFlight = max(shotsInFlight - 1, 0)
        p.exploding; p.frames = 3; p.sprite = HOGMIS frames 0..2
```
Summary:

| type | rule | speed (px/tick) | ends when |
|------|------|-----------------|-----------|
| 0 hedgehog / flame | straight, but follows the owner's current heading | 10 first tick, then 100 | wall, any object, any kart, or 1000 px (about 11 ticks) |
| 1 red blob | straight, reverses 180 deg on walls and objects | 16 | only when it hits a kart (no range limit, no timeout) |
| 2 bomb, 3 oil, 4 upturned hedgehog | stationary | 0 | a kart comes within range (they also explode at once if laid on a wall tile or within 14 px of an object) |
| 5 ice cube | same as type 0 | 10, then 100 | same as type 0 |

- **[C]** No homing anywhere. No gravity/arc.
- **[C]** Limits: 61 projectiles total. A player cannot fire anything while
  `slot[+0x12] > 0`; weapon 0 sets it to 1 and weapon 3 to 3, and every
  explosion of one of that player's projectiles (including an old mine)
  decrements it. Weapons 4..8 set it to 0, so they never block.
- **[C]** Explosion animation is 3 frames, then the entry is freed.

### 3.5 Cheat bits (command line, 0x36156..0x3621d -> kart 0 +0xe0)

**[C]** Argument strings and bits: `TURBO` 1, `JUMP` 2, `HOG` 4, `ICE` 8,
`FIRE` 0x10. At race start (0x307fc) any of HOG / ICE / FIRE sets ammo to 99.
With no held weapon, FIRE makes every shot weapon 3 and ICE makes every shot
weapon 8 (ICE wins if both). TURBO: brake + fire gives the turbo
(0x2d842..0x2d891). JUMP: brake + `[0x88b40]` starts a jump (0x2d8aa.., 0x24298).

## 4. Hits

### 4.1 Projectile probe (0x218a4)

**[C]**
```
if surface type at point == 3: result = 1 (wall); return
for each object with state != -1:
    if manhattan(obj, point) < 14: result = 2; return     ; object is not affected
for each slot i (0..[0x88c40]) with slot.flag(+2) != 2 and kart[i].jump(+0x0a) == 0:
    near = manhattan(slot.pos, point) < 18
    if i == p.owner:
        if near and (p.insideOwner or p.type == 0 or p.type == 5): near = false
        if not near: p.insideOwner = 0
    if not near: continue
    if slot.hit(+0x58) != 0 or slot.flag == 2: result = 3; return   ; absorbed, no effect
    p.pos = slot.pos
    ... apply effect below ...
    result = 3; return
```
- **[C]** Own hedgehogs / flames / ice cubes can never hit their owner. Own
  red blobs and mines can, once they have been more than 18 px away.
- **[C]** Airborne (jumping) karts cannot be hit.
- **[C]** Objects stop projectiles but are never destroyed or changed by them.

### 4.2 Effect on a computer opponent (0x21a9a..0x21b87)

"Computer" = slot index != 0 (or > 1 in the two-player modes).

**[C]**
```
if type == 5 and not ([0x88be2] or special mode):
    slot.hit(+0x58) = 2; slot.hitFrame(+0x4c) = frame; sound 0x19
else:                                   ; types 0..4 all the same
    sound 0x11
    slot.hit = 1; slot.hitFrame = frame
    slot.spinFrame(+0x5a) = slot[+0x38 + 2*shooterSlot]
```
While `slot.hit != 0` the opponent update skips the slot entirely (0x28cdb),
so it stands still, then resumes its rails at its normal state speed. Timer
(0x289ec):

| hit value | duration | extra |
|-----------|----------|-------|
| 1 (types 0..4) | 0x21 = 33 ticks | spin animation: +0x5a cycles 0..7, one step per frame (0x262ab) |
| 2 / 3 (ice cube) | 0x32 = 50 ticks | value toggles 2 <-> 3 each time the current sound ends, alternately playing sounds 0x18 and 0x19 |
| any, special mode | 4 ticks | then the target is removed (flag = 2), sound 0x0d, score `[0x7edb4]` +1 (+2 if its character == `[0x7ec6c]`), cap 99 |

**[C]** No speed penalty beyond the standstill, no knock-back, no position
change. Bomb, oil and upturned hedgehog are identical against computer
karts.

### 4.3 Effect on a human kart (0x21b87..0x21db6)

**[C]** Nothing happens if the kart is already out (`kart[+0x7e]`).
```
if [0x88be2] and type <= 2:             ; head-to-head mode: a kill
    sound 0x0d; slot.flag = 2; kart[+0x7e] = 1; throttle, spin, skid zeroed
elif type == 4:                          ; upturned hedgehog
    if kart[+0x14] == 0: kart[+0x14] = 1; kart[+0x8a] = frame
elif type == 5:                          ; ice cube (treated as type 0 in [0x88be2]/special modes)
    slot.hit = 2; slot.hitFrame = frame; sound 0x19
else:                                    ; types 0..3: spin-out
    sound 0x11; character voice 0x10c90(slot.character(+0x26))
    kart.spin(+0x20) = 1; kart[+0x1a] = 7; kart[+0x18] = 1
    kart[+0x1e] = 0; kart.skid(+0x3c) = 0; kart[+0x32] = frame
```
- **Spin-out [C]** (0x22574..0x2260e): each tick the heading is turned by
  `[0x88c54]` = 120 units and the frame counter +0x1a counts 7 -> 0; on the
  8th tick the spin ends and throttle (+0x42) is set to 0. During the spin
  only surface drag reduces speed. So: 7 x 120 = 840 units of rotation, 8
  ticks, then restart from throttle 0.
- **Reversed steering [C]** (0x2934a..0x2937d, timer 0x2fbd6..0x2fc1d):
  while `kart[+0x14]` is set the left and right inputs (`[0x88b8c]`,
  `[0x88b98]`) are swapped. Cleared after 0x12c = 300 ticks. No spin, no speed
  loss. Timer code sits in the two-player HUD branch (0x2fb86), **[I]** since
  only another human's (or one's own) type-4 mine can reach a human.
- **Ice on a human [C]**: sets the same slot field (+0x58 = 2) as for a
  computer kart. The human-side consequence of slot +0x58 was not traced
  (see unknowns).

### 4.4 Track-surface effects seen while tracing (terrain is not this subsystem)

- **[C]** Surface type 3: wall, for karts and projectiles.
- **[C]** Surface type 10 (0x216d4..0x21745): starts a **jump**:
  `kart[+0x0a] = 1`, height +0x10 = 8 rising 8 per tick to +0x0e = 0x28 then
  falling (0x24c61..0x24cad), sound 0x0c. While airborne: object and kart
  collisions are skipped, the kart cannot fire and cannot be hit, speed is
  pinned to `[0x7e85c]` (0x291ed).
- **[C]** Surface types 6 and 0x0f (0x241d1..0x2428e): sound 0x0f,
  `kart[+0x44] = 1` with two parameters from the per-surface table (+0x126,
  +0x12a). **[I]** water / pit "sinking" state. Not decoded further.
- **[C]** Surface type 2: turbo (earlier doc).
- There are no weapon-like hazards painted on the surface other than these;
  oil slicks exist only as projectile type 3.

## 5. Opponents and weapons

- **[C]** 0x2d548 (spawn) is called only from 0x24364, and 0x24364 only for
  human karts. Computer opponents never fire.
- **[C]** Object contact is tested only in the human movement walk (0x216a0).
  Computer opponents pass through pickups and obstacles and never collect.
- **[C]** They can be hit by anything a human fires or lays (section 4.2);
  being hit does not change their speed state machine, it only pauses it.
- **[C]** A slot that is already in a hit state absorbs further projectiles
  with no additional effect (the timer is not extended).

## 6. Sound ids (argument to 0x11c04; 0x11bbc = "is it still playing")

Sounds are entries 0..26 of `AUDIOT.FX` via the `AUDIOHED.FX` offset table
(0x11f98..); there are no names in the executable, so only ids are given.

| id | used for | where |
|----|----------|-------|
| `[0x88b96]` (0..7 [I]) | pickup collected; ice cube charged | 0x23283, 0x2443a |
| 0x0c | jump start; turbo start | 0x2171b, 0x24334 |
| 0x0d | crash / kart knocked out / special-mode target removed | 0x233ba, 0x21bc0, 0x28ab4 |
| 0x0f | entering surface 6 / 0x0f | 0x2420d |
| 0x11 | kart hit by projectile types 0..4 | 0x21b00, 0x21cf3 |
| 0x12 | any projectile exploding | 0x26188 |
| 0x13 | fire weapon 3 (triple flame) | 0x245f0 |
| 0x14 | fire hedgehog; fire ice cube | 0x2455f, 0x247b0 |
| 0x15 | bump into object | 0x236f5 |
| 0x16 | bump into kart; tyre stack knocked | 0x236fc, 0x232f2 |
| 0x17 | fire weapons 4..7 | 0x24609.. |
| 0x18 / 0x19 | frozen by ice cube (alternating) | 0x21b57, 0x28a39.. |
| 0x1a | fire pressed with nothing to fire | 0x24809 |
| 0xff -> 3 | special-mode hit | 0x21abb, 0x11c40 |

## 7. Could not determine

1. What a human kart does while its slot has +0x58 = 2 (ice cube hit on a
   human): the freeze duration / input lock on the human side was not traced.
2. Whether weapon 8 really is reachable in normal play exactly as written
   (hold fire 20 ticks, free, unlimited). The code path is unambiguous, but
   it should be checked against the running game; the polarity of
   `[0x7e574]` (1 = `20.GAM` missing) is read from the code, its meaning
   "shareware" is inferred.
3. Whether projectile sprites 6..10 and the pickup pictures really mean what
   I named them (flame, red blob, bomb, oil, upturned hedgehog); names come
   from looking at the frames only.
4. Sound id -> actual sample names; ids 0..7 being character voices.
5. `SPRITE.ATR` +0x02 (always 10) and the duplicated w/h at +0x08/+0x0a.
6. `.SPW` words +8 and +10 in the file (always 0); no use found.
7. Whether throttle input is ignored during the 8-tick spin (only the end
   state, throttle = 0, was read).
8. The HUD side: how ammo count and the held weapon are drawn (`ICONS.SP`
   not examined).
9. The trailing `.GAM` lines ("0", "1 2 4 3"): no connection to objects or
   weapons was found in the code read here; still undecoded.
10. The exact meaning of `[0x88be2]` (treated as head-to-head/kill mode) and
    special mode `[0x7ec74]` (targets that take hits and score to 99).
11. In the kart walk 0x216a0 the words `[0x88b68]`/`[0x88b6a]` are added to
    the probe point, while 0x291b0 writes them as an absolute position; I did
    not reconcile the two uses, so the projectile spawn point is "those two
    words" [C] and "the kart's position" only [I].
