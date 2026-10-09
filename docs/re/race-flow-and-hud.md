# Wacky Wheels (WW.EXE) — race flow and HUD

Static reverse engineering of `dos/WWINST/WW.EXE` (code object at 0x10000, data
object at 0x60000; same layout as `docs/opponent-logic.md`, which this builds
on). Tags: **[C]** confirmed by reading the code at the addresses given,
**[I]** inference. Nothing was verified by running the game. Sprite layouts
marked "rendered" were dumped to PNG from WACKY.DAT and looked at.

Disassembler note: in `code.asm`, `shr/sar/shl reg,0x0` is really a shift by 1
(opcode D1); all "divide by 2" below rely on that.

Timing units used below: a *frame* is one pass of the race loop (default
12/136 s, 11.33 per second); a *tick* is one count of the 136 Hz timer
`[0x7e720]`; the race clock `[0x7e71c]` counts tenths of a second.

## 0. Mode flags (needed to read every condition below)

| variable | meaning | evidence |
|---|---|---|
| `[0x88bb2]` | 1 amateur, 2 pro, 3 champion, 4 time trial | opponent-logic.md; 0x12bf2, 0x3164f |
| `[0x88bb6]` | cup 1..3 = bronze, silver, gold | 0x17a6b, menu wrap 0x192e8 |
| `[0x7ecb4]` | added to the cup: 0 regular, 3 bonus pack [I for the names] | 0x17a72 |
| `[0x88b88]` | race number inside the cup, 1..5 | 0x200b9, menu wrap 0x191c0..0x19238 |
| `[0x88b9c]` | number of laps N | 0x1a148 |
| `[0x88c44]` | 0 pre-start, 1 lights running, 2 racing | 0x30884, 0x30e7a, 0x266e5 |
| `[0x88c3c]` | player finish state: 0 racing, 1 finished, 2 results pending | 0x316d3, 0x318a0 |
| `[0x88c60]` | number of karts that have finished | 0x12e46, 0x12f08 |
| `[0x88bdc]` | two-player race (2 = with the 6 computer karts) | 0x2febc |
| `[0x88be2]` | two-player shoot-out (score instead of laps) [I for the name] | 0x13206, 0x29eb9 |
| `[0x88bde]` | split screen active | 0x17973..0x1799c |
| `[0x88c0c]` | link play (0 = local) | 0x1797c, 0x32326 |
| `[0x7ec74]` | duck shoot | 0x2a9e9 (countdown + score) |
| `[0x7d998]` | 0 normal, 2/3 demo ("DEMO MODE" label when 3) | 0x13371 |
| `[0x7edb0]` | kid mode | opponent-logic.md |
| `[0x7eb80]`, `[0x7eb82]` | view drawn for kart 0 / kart 1 | 0x179a6..0x179fe |
| `[0x7ed30]` | 100 in split screen, else 0 (y offset of the second HUD) | 0x1799c |

Human kart struct fields found here (base 0x68410 + i*0x104, pointer
`[0x7d5b0]`) **[C]**:

| off | meaning | evidence |
|---|---|---|
| +0x16 | held item, 0 none, 3..8 | 0x10e0f, 0x232ad, 0x247f8 |
| +0x26 / +0x28 | speed / displayed speedometer value | 0x2ad84, 0x2ae62 |
| +0x6a | hedgehog count (max 99) | 0x2afc5, 0x232bb, 0x247f2 |
| +0x6c | lives ("tries") | 0x2fe7d, 0x29e93, 0x314ee |
| +0xa4 | lap text visible | 0x12c5b, 0x2b17a |
| +0xa6 / +0xa8 | wrong-way flag / blink phase | 0x12d39, 0x2b0a8 |
| +0xac | race position 1..8 | 0x2af11 |
| +0xae | previous `.POS` value | 0x12dc7 |
| +0xb0 | crossed the line backwards | 0x12d42, 0x12bb6 |
| +0xb2 | lap number (0 before the first line crossing) | 0x12bce |
| +0xd0 | shoot-out score | 0x29ed1 |
| +0xe4.. | giggle animation state | 0x12c8f, 0x2a75b |

## 1. Race structure

### 1.1 Laps

**[C]** Menu routine 0x1a148 sets N = `[0x88b9c]`:

| case | N |
|---|---|
| kid mode | 3 (0x1a17a) |
| time trial | 6 (0x1a246) |
| menu choice 1 / 2 / 3 ("SIX / EIGHT / TEN LAP RACE", 0x60b14..) | 6 / 8 / 10 (0x1a246, 0x1a255, 0x1a2e7) |
| power-on default | 10 (0x1e4f8) |

Two-player races use the same three-way menu (0x1a264..).

**[C]** Lap counting for humans (0x12b8f..0x12e68), with `pos` = `.POS` value
under the kart, `prev` = kart+0xae, `max` = `[0x88ba2]`:

```
if pos == 1 and prev == max:            # crossed the line forwards
    wrongWay = 0
    if crossedBackwards: crossedBackwards = 0          # no lap credit
    else:
        lap += 1
        if lap <= N: lapTextVisible = 1
        if lap == N: play sound 9; start giggle set 7   # last lap
elif pos == max and prev == 1:          # crossed the line backwards
    crossedBackwards = 1 (and wrongWay = 1 under a condition on kart+0xaa)
elif pos < prev:  wrongWay = 1 (unless kart+0xaa set), remember frame number
elif wrongWay and (pos > prev or 10 frames passed): wrongWay = 0
if lap == N + 1 and slot.finishOrder == 0:
    finishOrder = ++[0x88c60]; if finishOrder <= 3: showFinisher(slot)
```

Lap is 0 on the grid, becomes 1 at the first crossing, and the kart finishes on
the crossing that makes it N+1. Opponents (0x12eb7..0x12f25) use the same
test, stop incrementing at N+1, and get a finish order the same way.

### 1.2 Start sequence

**[C]** Only when `[0x88be2] == 0` and not duck shoot is there a start
sequence (`[0x88c38] = 1`, `[0x88c44] = 0`, 0x3014c); otherwise the race is
running immediately (`[0x88c44] = 2`, 0x30172).

1. **Fly-in** (0x30865..0x30a4a), only in a single-player championship race
   (`[0x88ca8]`, set at 0x2fe0b: not two-player, not time trial, not duck
   shoot). Camera x starts at 0x708 with heading 0x3c0 (reversed), y offset
   +0x84; each frame x -= 0x40 until it reaches player x + 0x84, then heading
   -= 0x28 per frame until 0x1e0, then the camera snaps to the normal position.
   The clock option is forced off during it (0x300a1, restored 0x30a4a). Race
   state stays 0, so the light shows frame 0.
2. **Lights** (0x266a8): frame counter `[0x7ec64]` is zeroed and
   `[0x88c44] = 1` (0x30e5c..0x30e83). Elapsed frames e:
   - e < 17: light frame 0 (red)
   - 17 <= e < 34: light frame 1 (amber)
   - e >= 34: `[0x88c44] = 2`, light frame 2 (green), sound 10 (0x266e5).
   At the default rate that is 1.5 s red, 1.5 s amber.
3. **[C]** While `[0x88c44] != 2` the player's accelerate, brake and fire
   inputs are zeroed (0x2d6d1) and opponents are not updated (0x32783); the
   race clock is held at 0 (0x2a97a).

**[C]** The light is not a HUD element: it is a 38x28 world sprite at
(`[0x88c4a]`, `[0x88c4c]`), projected and scaled like other objects, frames
`[0x7eb40 + 4*state]` in GENEF.SP (0x26a12). Rendered: a tiger holding a
traffic light.

### 1.3 How the race ends

**[C]** Player (0x31609..0x31770): when lap == N+1, `[0x88c3c] = 1`, the
clock is frozen into `[0x7eccc]` (time trial: sum of the six lap times at
0x7d358), controls are zeroed, and the kart gets a finish animation: order
1..3 -> animation table 0x7b378 plus sound 0x11; otherwise table 0x7b238.

**[C]** The race does not end until the player has finished. Then
(0x317fb..0x318a9), once `[0x88c60] >= 3` (or immediately in time trial):
points are staged, the end message (section 4) is posted if the player is in
the top three, `[0x88c3c] = 2`, and 800 ticks (5.9 s) later (0x31919):

- order > 3: lives -= 1 (0x31959). Lives 0 -> "GAME OVER" (0x29e0c ->
  0x17888, centred small text at y = 0x60 on both pages, then waits for the
  jingle or 500 ticks) and the race function returns. Otherwise a menu:
  "TRY TO QUALIFY" (or "TRY AGAIN" in race 5), "LEAVE RACE", and "SAVE AND
  QUIT" in a plain single-player championship (0x319d7..0x31a5b); choice 1
  restarts the same race (0x3006a).
- order <= 3 (0x31cf0): staged points are added to slot+0x1e (0x6aaae), then
  the leader board (0x2bff0) or, in time trial, the hall of fame (0x2e4b8).

**[C]** Lives are set to 3 at the top of every race call (0x2fe7d), not per
cup. Restarting from the pause menu also costs one (0x32570).

**[C]** Opponents keep driving after they finish; only the lap count is
capped.

**[C]** Two-player race (0x3150c): ends as soon as either human reaches lap
N+1; every slot gets `9 - position` points (0x315bc..0x315da).

### 1.4 Points

**[C]** 0x31781..0x317f1, by difficulty, for finishing 1st / 2nd / 3rd only:

| difficulty | 1st | 2nd | 3rd |
|---|---|---|---|
| amateur | 9 | 6 | 3 |
| pro | 12 | 9 | 6 |
| champion | 15 | 12 | 9 |

Applied to all eight slots by finish order (0x31821..0x31880). Fourth and
below score nothing, and the player must finish top three to advance.

### 1.5 Championship structure

**[C]** A cup is five races; after a completed race the caller increments
`[0x88b88]` and loops (0x2003c -> 0x200b9). Track number `[0x7e728]` and
overhead-map file are chosen at 0x17a6b by class = cup + `[0x7ecb4]` - 1
(jump table 0x17910):

| class | track files | map file |
|---|---|---|
| 0 | 1..5 | BRONZEM.SP |
| 1 | 6..10 | SILVERM.SP |
| 2 | 11..15 | GOLDM.SP |
| 3 | 22..26 | BONUSB.SP |
| 4 | 27..31 | BONUSS.SP |
| 5 | 32..36 | BONUSG.SP |

**[C]** After race 5 (0x2c614) the standings are grouped into three podium
steps (ties share a step). Then:

- if the player is on the podium, difficulty is champion, single player,
  class 0 (`[0x7ed98]`, set only at 0x17a9b) and the bonus has not been run:
  a three-line box "YOU HAVE WON THE RIGHT TO ENTER / THE BONUS TRACK! THIS
  GIVES YOU / THE CHANCE TO GET MORE POINTS!!" and `[0x7ec80] = 1`. The bonus
  race loads track 7 with map SILVERM.SP frame 1 (0x17abc, 0x27a40) and is
  labelled "BONUS". The code has this for class 0 only.
- otherwise "THE ROSTRUM" on WIN.PCX (0x2c95d..): 1st at (0x8e,0x96), 2nd
  (0x55,0x92), 3rd (0xc5,0x8f), tied karts stacked 28 px apart; a player off
  the podium stands at (10,0x9e).

**[C]** Leader board (0x2b270): big-font title "LEADER BOARD AFTER " + race
label centred at y = 4, "POINTS" at (0x37,0x22) and (0xdf,0x22); entries from
the sorted table 0x799d8 (points, character), places 1..4 at x = 2 and 5..8
at x = 0xaa, y = 0x32 + 0x26 per row; name padded to 8 characters, two-digit
points, 38x28 portrait.

**[C]** Hedgehog count, held item and score are saved with the game and are
only zeroed at race start in two-player / duck-shoot modes (0x30255..0x30283),
so they carry between championship races.

### 1.6 Time trial

**[C]** `[0x88bb2] == 4`: no opponents (`[0x88c40] = 0`, 0x2fef7), 6 laps, no
fly-in but the lights still run, clock always shown, "TIME TRIAL" label.
Lap times: at each crossing with lap 2..7, `time[lap-2]` = clock minus the
previous crossing (first one is the raw clock), six dwords at 0x7d358
(0x12bfc..0x12c3b). The first crossing from the grid is not timed. Track is
picked freely: cup 1..3 and race 1..5 with wrap-around.

### 1.7 Pause and quit

**[C]** Key code 0xc5 (**[I]** the Pause key) shows a centred "PAUSED" box until another key
(0x2fc95..0x2fd2f). Esc during a race (0x32121, ignored after finishing)
opens: "BACK TO RACE", "LEAVE RACE", "SAVE AND QUIT" (single-player
championship only), "RESTART RACE" (not offered on the last life). Shoot-out
and duck shoot get "BACK TO ZONE" / "LEAVE ZONE" / "RESTART RACE".

## 2. HUD

### 2.1 Drawing primitives

Screen is unchained VGA 320x200 with two pages (`[0x88b24]` = 0 or 0x3e80).
All take x `[0x88b32]`, y `[0x88b34]`, width `[0x88b36]`, height `[0x88b26]`,
source `[0x7d704]`; sources are column-major. **[C]**

| routine | behaviour |
|---|---|
| 0x36fd0 | blit, colour 0 transparent |
| 0x373ee | blit, opaque |
| 0x37132 | blit variant used for shoot-out scores (not decoded) |
| 0x371e4 | rectangle, border colour `[0x88ce8]`, fill `[0x88ce9]` |
| 0x37bf0 | one pixel, colour `[0x88ce9]` |
| 0x11404 | 0x3707e blit with bottom clipping at y = 199 |
| 0x37487 | scaled blit through a scaling table `[0x7d838]` |

### 2.2 Static panel, drawn once per race start (0x12f80)

Called from 0x1367a after the background picture. Skipped unless
`[0x7d998]` is 0 or 3.

| element | source | size | x,y | condition |
|---|---|---|---|---|
| overhead map (also saved as backing copy) | `[0x7eb5c]`: frame race-1 of the class map file | 78x50 | 0,60 | map option `[0x88ca0]` |
| character name | small font | | 4,50 | not split, not shoot-out |
| position box | LAP.SP `[0x7d83c]` | 38x41 | 17,6 | same |
| duck icon inside the box | GENEF.SP `[0x7eb60]` | 19x14 | 26,14 | duck shoot |
| "kart x" lives panel | LAP.SP `[0x7d814]` | 65x19 | 68,6 | single player, not duck shoot |
| "hedgehog x" panel | LAP.SP `[0x7d810]` | 61x19 | 146,6 | all but split screen |
| "DEMO MODE" | small font | | 232,6 | `[0x7d998] == 3` |
| "TIME TRIAL" | small font | | 232,6 | time trial |
| shoot-out: name + "SCORE" twice | small font | | name 4,11 and 4,41; "SCORE" 74,11 and 74,41 | `[0x88be2]` |
| split screen: the two names | small font | | 4,1 and 4,101 | `[0x88bde]` |

The map option is forced off in split screen, shoot-out, duck shoot and demo 2
(0x2fe14).

### 2.3 Per-frame HUD (0x2a92c, then 0x10dd8)

"Race HUD" below means `[0x88be2] == 0`, `[0x7d998]` in {0,3}, not duck shoot
(0x2a942). For kart 1 in split screen, every y has `[0x7ed30]` = 100
subtracted. **[C]** unless noted.

| element | source and frame rule | size | x,y | shown when |
|---|---|---|---|---|
| map background restore | `[0x7eb3c]`, opaque | 78x50 | 0,60 | map on (0x2a4ac) |
| map dots | 1 pixel per slot 0..`[0x88c40]`; x = MAPXY[x-0x400], y = 60 + MAPXY[2048 + y-0x400], inputs clamped to 0..0x7ff | | | map on |
| race clock | "MM:SS:T" from `[0x7e71c]` (frozen value `[0x7eccc]` after finishing); GENEF.SP 7x9 digits, 7 px advance, 7 characters | 49x9 | 264,112 (also 264,12 in split) | race HUD and (clock option `[0x775d2]` or time trial) |
| duck-shoot countdown / score | `[0x7ec88]` - clock; two 10x9 digits of `[0x7edb4]` | | 264,112 / 26,32 | duck shoot |
| end-of-race message | small font in a box (mode 1) | | x centred, y = 100 | `[0x88c48]` (section 4) |
| speedometer frame | ICONS.SP `[0x7ea84]` | 42x19 | 0,181 | view on, `[0x7d998] == 0`, not shoot-out or duck shoot, speedometer option `[0x775d4]` |
| speedometer digits | ICONS.SP 10x15, two digits, leading zero | 10x15 | 3,183 and 15,183 | same |
| position digit | LAP.SP frame rank-1 (opaque) | 22x29 | 25,12 (split: 4,111 and 4,11, transparent, white digit set) | race HUD |
| hedgehog count | LAP.SP 10x9 digits, two digits | 10x9 | 181,11 and 191,11 (split: 154,100) | view on, `[0x7d998]` in {0,3} |
| lives digit | LAP.SP 10x9 digit, value kart+0x6c | 10x9 | 118,11 | 0x29e0c: drawn at setup and after each life lost, not every frame |
| WRONG WAY | LAP.SP `[0x6e720]` / `[0x6e724]`, alternating every frame | 80x17 | 120,182 | wrong-way flag, `[0x7d998] == 0`, not shoot-out or duck shoot |
| lap text | small font, no box | | 4,164 | lap text visible and no giggle running |
| giggle / puff | GIGGLES.SP set, 4 frames 38x44, then PUF.SP 38x28 | | 250+dx, 120+dy (dx,dy from table 0x7b548) | 0x2a740; see 2.4 |
| Apogee logo | OFONT.SP second block | 92x41 | 4,155 | `[0x7d998]` 2 or 3 |
| held item icon | ICONS.SP frame item-3 | 26x21 | 293,178 | item != 0 and view on (0x10dd8) |
| top-three finisher list | "1ST"/"2ND"/"3RD" at 240, 4+28*(order-1); portrait 38x28 at 270, same y; drawn once on both pages | | | 0x12770: single player, not demo, not time trial |

Details:

- **Clock** **[C]** 0x2a618: t = tenths; string = MM ":" SS ":" T with
  MM = t/600, SS = (t/10) mod 60, T = t mod 10. Above 36000 the clock is
  reset.
- **Speedometer** **[C]** 0x2ad84..0x2aea9: shown value = min(kart+0x28, 99),
  0 before the start. Each frame kart+0x28 moves toward 2 * speed (kart+0x26):
  up by 2 while racing (4 otherwise), down by 4 (10 otherwise), clamped at the
  target. So top speed 40 px/frame reads "80".
- **Lap text** **[C]** 0x2b17a: lap < N -> "LAP " + lap; lap >= N ->
  "LAST LAP!", or "FINISHED!" once `[0x88c3c] != 0`. The visible flag is never
  cleared during a race, so this is the lap counter; it first appears at the
  first line crossing. There is no "lap x of N" graphic.
- **Items** **[C]** pickup type 2 adds 4 hedgehogs (0x232bb); other types 3..8
  become the held item if none is held (0x232ad). Fire uses the held item if
  any, else one hedgehog (0x247eb). Icon order (rendered): fireball, red
  devil face, bomb, oil slick, a brown animal, ice cube = items 3..8; which
  gameplay effect each has was not traced.
- **Shoot-out scores** **[C]** 0x29eb9: two-digit 10x9 digits at (118,11) and
  (118,`[0x7ec7c]` = 41). Split screen draws "SCORE" boxes (38x8 rectangles,
  colour 0x2e) at (221,101) and (221,1) with digits at (263,100) and (263,0)
  (0x2a041..).

### 2.4 Giggles

**[C]** Last lap sets giggle = 7 (0x12c8f); the function keys set others
(strings at 0x60d30). 0x2a740: frame = GIGGLES.SP set (value-1), sub-frame
0..3 cycling one per frame, position stepped through the offset table
0x7b548; after `[0x88b80]` steps it switches to the four PUF.SP frames in the
order 3,2,1,0 (index `3 - sub`, 0x2a7a1) and ends. In single
screen it is drawn only when the kart's own view is on. A second block
(kart+0xc0.., 0x2ab05) draws the other player's giggle at x base 141 in
two-player modes.

## 3. Fonts

### 3.1 WFONT1.SP — big font

**[C]** 42 glyphs, 15 wide x 13 high, 195 bytes each, table 0x6a888
(0x13ed2). Draw routine 0x146d4(eax = x, edx = y, ebx = string, ecx = scaled
flag): advance 11 px, transparent blit; with ecx != 0 it draws scaled
through 0x37487. Glyph order (rendered):

| index | 0..25 | 26..35 | 36 | 37 | 38 | 39 | 40 | 41 |
|---|---|---|---|---|---|---|---|---|
| glyph | A..Z | 0..9 | blank | . | tick mark | dash | ! | TM |

Character mapping (0x14761..0x14806): space -> 36, '.' -> 37, '<' -> 38,
'>' and '#' -> 39, '!' -> 40, '?' and '~' -> 41, anything else -> 36.

### 3.2 OFONT.SP — three blocks (0x13b78..0x13bcb)

| block | bytes | content |
|---|---|---|
| 1 | 0xf40 | small font: 61 glyphs 8x8, table 0x6a778 |
| 2 | 0xebc | Apogee logo 92x41 |
| 3 | 0x2240 | 137 glyphs 8x8, opaque, ASCII 0x20 upward (table indexed by character at 0x6a4c8) |

**[C]** Small-font routine 0x148f4(eax = x, edx = y, ebx = string, ecx =
mode), advance 8 px, transparent glyphs, unmapped characters (including
space) just advance. Mode 0: text only. Mode 2: first a rectangle
(x, y, 8*len, 8) in colour 0x2c. Any other mode: a box at (x-4, y-4), size
(8*len + 8) x 16, border 0x26, fill 0x2c.

Mapping (0x149df..0x14acc): A..Z -> 0..25, 0..9 -> 26..35, '!' 36, '#' 38,
'&' 42, '(' 44, ')' 45, '?' 52, '.' and ':' 53, ',' 54, '-' 55, '@' 56,
''' 57. Rendered glyph order of the rest: 37 copyright-like sign, 39 $,
40 %, 41 ^, 43 *, 46 _, 47 +, 48 /, 49 \, 50 >, 51 <, 58 ~, 59 pound,
60 blank; these have no mapping in the routine.

Block 3 is drawn by 0x14890 (8 px advance, opaque); its users were not
traced **[I]** (chat / name entry).

### 3.3 Other digit sets

| set | file, offset | size | table |
|---|---|---|---|
| position digits 1..8 (blue/yellow) | LAP.SP, 0 | 22x29 | 0x6e6f0, rebuilt per race at 0x17a30 |
| big white digits 0..9 | LAP.SP, 0x13f0 | 22x29 | 0x6e350 + 4*char (0x2b558: results screens; split-screen positions use 1..8 of these) |
| small digits 0..9 | LAP.SP, 0x46ec | 10x9 | 0x6e380 + 4*char |
| clock digits 0..9 and ':' | GENEF.SP, 0x35a5 | 7x9 | 0x7d618 + 4*char |
| speedometer digits 0..9 | ICONS.SP, 0xfea | 10x15 | 0x7c118 + 4*char |

### 3.4 Message boxes

**[C]** 0x2a414(eax = string, edx = y, 0 means 92): centred one-line box,
width 8*len + 8, height 16, text at +4,+4. 0x2a268(eax = lines, edx = wait
for key, ebx = ticks): multi-line box from the 60-byte line buffers at
0x7c854.., 9 px line pitch, centred both ways.

## 4. In-race messages

| text | trigger | where | evidence |
|---|---|---|---|
| "LAP n", "LAST LAP!", "FINISHED!" | section 2.3 | 4,164 | 0x2b17a |
| WRONG WAY (sprite) | section 1.1 | 120,182 | 0x2b0a8 |
| "1ST" "2ND" "3RD" + portrait | each of the first three finishers | top right | 0x12770 |
| end message | three karts finished and the player is one of them | boxed, y = 100 | 0x2d264 |
| "GAME OVER" | lives reach 0 | centred, y = 96 | 0x2a1f7 |
| "PAUSED" | Pause key | box, y = 92 | 0x2fcfa |
| "WHAT A CRASH!" | two-player race, both humans flagged out (kart+0x7e) with both slot timers > 12 | box, y = 92, 400 ticks | 0x31288 |
| "THAT WAS A DOUBLE KILL!" | same in shoot-out | same | 0x3129d |
| name + " HAS BEEN WAXED!" | one human out in two-player modes; the name is that player's own character | same | 0x312de, 0x31355 |
| "TIMES HAVE BEEN RECORDED" | time trial finished | boxed, y = 100 | 0x2d27b |

**[C]** End message (0x2d292..): row = finish order, column = race number
1..5, 40-byte strings at 0x63d44 (1st), 0x63e0c (2nd), 0x63ed4 (3rd):

| race | 1st | 2nd | 3rd |
|---|---|---|---|
| 1 | GOOD DRIVING. KEEP IT UP! | WELL DONE! | THAT WAS CLOSE! |
| 2 | EXCELLENT SKILL! | WOW! WHAT A RACE! | YOU LIVE TOO CLOSE TO THE EDGE! |
| 3 | FANTASTIC PIECE OF DRIVING! | THESE GUYS DON'T KNOW WHAT HIT THEM! | KEEP DOING WHAT YOU'RE DOING! |
| 4 | BRILLIANT. NOW COMES THE BIG ONE! | GLORY IS A SMALL STEP AWAY! | GO FOR GLORY! |
| 5 | YOU ARE TOO GOOD! | THE FINAL WAS BREATHTAKING! | YOU DESERVED TO WIN! |

"YOU ARE TOO GOOD! TRY A REAL RACE!" / "YOU ARE GOOD! TRY A REAL RACE!"
(0x617cc, 0x617f0) sit behind a time-trial test nested inside the
not-time-trial branch, so they cannot be reached **[C]**.

"KNOCK ME OFF!" is not an in-race message: it is the placeholder name in the
default hall-of-fame records in WACKY.ING **[C]** (file contents).

Sounds used here **[C]** (index into the 27-name table at code 0x10010, one
`.VOC` per name, loaded at 0x12168; other sound devices take the same index
into AUDIOT.FX): 9 BELL (last lap), 10 START (green light), 11 GLASS
(crash sequence, 0x2fc62), 17 SKID (top-three finish). Indices 0..7 are the eight character
voices.

## 5. Sprite files

All verified by rendering unless noted. Offsets are byte offsets in the file.

| file | size | layout |
|---|---|---|
| LAP.SP | 19542 | 8 x 22x29 position digits 1..8; 10 x 22x29 white digits 0..9 (0x13f0); 2 x 80x17 WRONG WAY (0x2cdc); 38x41 box (0x377c); 65x19 "kart x" (0x3d92); 61x19 "hedgehog x" (0x4265); 10 x 10x9 digits (0x46ec); 54x9 "Order Me" (0x4a70) |
| ICONS.SP | 5574 | 6 x 26x21 item icons; 42x19 speedometer "mph" frame (0xccc); 10 x 10x15 digits (0xfea) |
| GENEF.SP | 14692 | 6 x 28x23 wheels (bronze, silver, gold, two frames each); 3 x 15x13 trophies; 3 x 38x28 start light; 4 x 38x28 explosion; 38x28 red X; 2 x 22x14 patterns; 12x13 hand; 11 x 7x9 clock glyphs; 19x14 duck |
| WFONT1.SP | 8190 | 42 x 15x13 |
| OFONT.SP | 16444 | section 3.2 |
| GIGGLES.SP | 46816 | 7 sets x 4 frames 38x44 [C] from 0x13c8e and 0x2a7b7; not rendered |
| PUF.SP, AJ.SP | 4256 | 4 x 38x28 each [C] 0x13f31..0x13f7e; not rendered |
| HANDLE.SP | 3680 | 8 x 20x23, a hedgehog animation used by menu code 0x15b18; not a race HUD element |
| BRONZEM / SILVERM / GOLDM / BONUSB / BONUSS / BONUSG .SP | 19500 | 5 x 78x50 overhead maps, frame = race-1. Not medals. |
| DOPE.SP | 11895 | 2 x 80x72 plus 1 x 25x15 [C] from 0x13858..0x138d4; not rendered |
| MAP.XY | 4096 | 2048 bytes world x -> map x (0..77), then 2048 bytes world y -> map y (0..49); linear |

Note on LAP.SP offsets: cumulative from the loader at 0x13dc9: 0x13f0 +
10*0x27e = 0x2cdc; + 2*0x550 = 0x377c; + 0x616 = 0x3d92; + 0x4d3 = 0x4265;
+ 0x487 = 0x46ec (small digits, 10 x 0x5a); then 0x4a70.

## 6. Split screen

**[C]** 0x1795b: split is on in two-player modes on one machine (in link
play it follows `[0x88bd0]`). Then `[0x7ed30] = 100`, both views are drawn;
kart 0 owns the lower half and kart 1 the upper half (every kart-1 HUD y is
kart-0 y minus 100). The ground renderer writes from video offset 0x2260
(row 110) for the single / lower view (0x37ed3, 0x2fb9e) and 0x320 (row 10)
for the upper view (0x3c427), using a separate routine 0x3c3e9.

HUD differences in split screen **[C]**: no overhead map; names at (4,1) and
(4,101); position digits use the white digit set, transparent, at (4,11) and
(4,111); hedgehog count at (154,0) and (154,100); clock at (264,12) and
(264,112); no lives panel or position box.

**[I]** Each half is a 100-row band: 10 rows of backdrop above 90 rows of
ground (rows 0..9 + 10..99, and 100..109 + 110..199). The single view is 110
rows of backdrop/panel above the same 90 rows of ground. The row counts of
the ground were not read out of the renderer.

## 7. Not determined

1. Height and exact rectangle of the 3D viewport(s); only the first ground
   row is confirmed.
2. What the six held items do, and which pickup object type maps to which.
3. Colours: text and digit colours come from the track palette; palette
   indices 0x26 / 0x2c / 0x2e (boxes) were not resolved to RGB.
4. ACTION.SP, EFFECTS.SP, HOGMIS.SP, CRACK.SP, SPARK.SP frame layouts (loaders
   at 0x2805b, 0x2758b, 0x13b30; they are world/effect sprites, not HUD).
5. The trigger for the DOPE.SP sequence (`[0x7ed24] >= 0x36`, 0x1375c).
6. Tracks 16..21 and 37..42: not reachable through the cup table at 0x17a6b;
   presumably the two-player "zones" and duck shoot. Why the bonus race is
   track 7 and exists only for class 0 on champion.
7. What follows the rostrum screen (0x2cb36 onward) and the save-game flow.
8. The hall-of-fame screen 0x2e4b8 and the WACKY.ING record layout.
9. The "wrong way" suppression flag kart+0xaa (who sets it).
10. The finish animations at 0x7b378 / 0x7b238 and the giggle offset table
    0x7b548 (run-time data; GIG.MOV is the likely source).
11. Blit 0x37132 (shoot-out score digits) and the scaled text path.
12. Exact condition under which a giggle is drawn for each player in
    two-player modes (the two code blocks test the view flags with opposite
    senses).
