import type { Ground, KartState } from './kart';
import { ORIGINAL_TICKS_PER_SECOND } from './timing';

export type Inventory = {
  /** hedgehog ammo, 0-99 */
  hedgehogs: number;
  /** special weapon being carried: 0 none, 3 flames, 4 bouncers, 5 bomb, 6 oil, 7 upturned hedgehog */
  heldWeapon: number;
  wasFireDown: boolean;
  /** forward shots of this kart still flying; nothing can be fired until they are gone */
  shotsInFlight: number;
};

export type Projectile = {
  kind: 'shot' | 'bouncer' | 'mine';
  /** picture to draw: first frame in HOGMIS.SP and how many frames loop */
  firstFrame: number;
  frameCount: number;
  x: number;
  y: number;
  /** bouncers and mines keep their own heading; shots follow their owner and only keep this offset from it */
  heading: number;
  travelled: number;
  ageTicks: number;
  /** still overlapping the kart that fired it, so it cannot hit that kart yet */
  isInsideOwner: boolean;
  /** ticks of the explosion still to play; 0 while live */
  explodingTicksLeft: number;
};

export type Target = { x: number; y: number; isStunned: boolean };

export type Battlefield = {
  ground: Ground;
  /** objects still standing on the track */
  obstacles: { x: number; y: number }[];
  opponents: Target[];
  player: KartState;
};

export type Volley = {
  projectiles: Projectile[];
  /** indices into Battlefield.opponents that were hit this step */
  opponentsHit: number[];
  isPlayerHit: boolean;
  /** forward shots that ended this step */
  shotsEnded: number;
};

// Weapons of WW.EXE as documented in docs/re/pickups-and-weapons.md, converted from per-tick to per-second.
const ANGLE_UNIT = (2 * Math.PI) / 1920;
export const MAX_HEDGEHOGS = 99;
export const HEDGEHOGS_PER_PICKUP = 4;
const SHOT_SPEED = 100 * ORIGINAL_TICKS_PER_SECOND;
const SHOT_RANGE = 1000;
const BOUNCER_SPEED = 16 * ORIGINAL_TICKS_PER_SECOND;
const LAUNCH_DISTANCE = { shot: 10, bouncer: 16, mine: 10 };
const HIT_DISTANCE = 18;
const OBSTACLE_DISTANCE = 14;
const EXPLOSION_TICKS = 3;
const EXPLOSION_FIRST_FRAME = 0;
const SPREAD = 30 * ANGLE_UNIT;
const QUARTER_TURN = 480 * ANGLE_UNIT;
const HALF_TURN = 960 * ANGLE_UNIT;
// longest stretch moved between hit checks, so a fast shot cannot skip over a kart
const PROBE_STEP = 4;
const WEAPON_FLAMES = 3;
const WEAPON_BOUNCERS = 4;
const MINE_FRAME: Record<number, number> = { 5: 8, 6: 9, 7: 10 };

export const EMPTY_HANDED: Inventory = { hedgehogs: 0, heldWeapon: 0, wasFireDown: false, shotsInFlight: 0 };

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function launched(kind: Projectile['kind'], kart: KartState, heading: number, firstFrame: number, frameCount = 1): Projectile {
  // shots store their offset from the owner's heading; the others fly along their own
  const direction = kind === 'shot' ? kart.heading + heading : heading;
  return {
    kind,
    firstFrame,
    frameCount,
    x: kart.x + Math.cos(direction) * LAUNCH_DISTANCE[kind],
    y: kart.y + Math.sin(direction) * LAUNCH_DISTANCE[kind],
    heading,
    travelled: 0,
    ageTicks: 0,
    isInsideOwner: true,
    explodingTicksLeft: 0,
  };
}

/** What a pickup of this kind does to the inventory, or undefined if the kart cannot take it. */
export function collected(inventory: Inventory, kind: number): Inventory | undefined {
  if (inventory.hedgehogs >= MAX_HEDGEHOGS) {
    return undefined;
  }
  if (kind === 2) {
    return { ...inventory, hedgehogs: Math.min(MAX_HEDGEHOGS, inventory.hedgehogs + HEDGEHOGS_PER_PICKUP) };
  }
  return inventory.heldWeapon === 0 ? { ...inventory, heldWeapon: kind } : undefined;
}

function weaponProjectiles(weapon: number, kart: KartState): Projectile[] {
  if (weapon === 0) {
    return [launched('shot', kart, 0, 3, 3)];
  }
  if (weapon === WEAPON_FLAMES) {
    return [0, -SPREAD, SPREAD].map((offset) => launched('shot', kart, offset, 6));
  }
  if (weapon === WEAPON_BOUNCERS) {
    return [QUARTER_TURN, -QUARTER_TURN].map((side) => launched('bouncer', kart, kart.heading + side, 7));
  }
  return [launched('mine', kart, kart.heading + HALF_TURN, MINE_FRAME[weapon] ?? MINE_FRAME[5])];
}

/** Handles the fire button for one step: fires on a fresh press if the kart is able to. */
export function pressFire(inventory: Inventory, isFireDown: boolean, kart: KartState): { inventory: Inventory; fired: Projectile[] } {
  const isNewPress = isFireDown && !inventory.wasFireDown;
  const next = { ...inventory, wasFireDown: isFireDown };
  const isArmed = inventory.heldWeapon !== 0 || inventory.hedgehogs > 0;
  if (!isNewPress || kart.airSecondsLeft > 0 || inventory.shotsInFlight > 0 || !isArmed) {
    return { inventory: next, fired: [] };
  }
  const fired = weaponProjectiles(inventory.heldWeapon, kart);
  const shotsInFlight = fired.filter(({ kind }) => kind === 'shot').length;
  // a held special is always used first and costs no hedgehog
  const spent = inventory.heldWeapon !== 0 ? { heldWeapon: 0 } : { hedgehogs: inventory.hedgehogs - 1 };
  return { inventory: { ...next, ...spent, shotsInFlight }, fired };
}

type Probe = { projectile: Projectile; opponentHit?: number; isPlayerHit: boolean; hasEnded: boolean };

function probed(projectile: Projectile, field: Battlefield): Probe {
  const exploded = { ...projectile, explodingTicksLeft: EXPLOSION_TICKS };
  const isBlocked =
    field.ground.isWall(projectile.x, projectile.y) ||
    field.obstacles.some((obstacle) => manhattan(obstacle, projectile) < OBSTACLE_DISTANCE);
  if (isBlocked) {
    if (projectile.kind === 'bouncer') {
      return { projectile: { ...projectile, heading: projectile.heading + HALF_TURN }, isPlayerHit: false, hasEnded: false };
    }
    return { projectile: exploded, isPlayerHit: false, hasEnded: true };
  }
  const opponentHit = field.opponents.findIndex((opponent) => manhattan(opponent, projectile) < HIT_DISTANCE);
  if (opponentHit !== -1) {
    // an opponent that is already stunned swallows the shot without further effect
    const isFreshHit = !field.opponents[opponentHit].isStunned;
    return { projectile: exploded, opponentHit: isFreshHit ? opponentHit : undefined, isPlayerHit: false, hasEnded: true };
  }
  const isNearOwner = field.player.airSecondsLeft === 0 && manhattan(field.player, projectile) < HIT_DISTANCE;
  // own shots can never hit their owner; own bouncers and mines can once they have been clear of the kart
  if (projectile.kind === 'shot' || (isNearOwner && projectile.isInsideOwner)) {
    return { projectile, isPlayerHit: false, hasEnded: false };
  }
  if (isNearOwner) {
    return { projectile: exploded, isPlayerHit: true, hasEnded: true };
  }
  return { projectile: { ...projectile, isInsideOwner: false }, isPlayerHit: false, hasEnded: false };
}

function flown(projectile: Projectile, field: Battlefield, dt: number): Probe {
  if (projectile.kind === 'mine') {
    return probed(projectile, field);
  }
  const isShot = projectile.kind === 'shot';
  let remaining = (isShot ? SHOT_SPEED : BOUNCER_SPEED) * dt;
  let probe: Probe = { projectile, isPlayerHit: false, hasEnded: false };
  while (remaining > 0 && !probe.hasEnded) {
    const step = Math.min(PROBE_STEP, remaining);
    const current = probe.projectile;
    // a shot keeps steering with the kart that fired it
    const direction = isShot ? field.player.heading + current.heading : current.heading;
    const moved = { ...current, x: current.x + Math.cos(direction) * step, y: current.y + Math.sin(direction) * step, travelled: current.travelled + step };
    probe = probed(moved, field);
    remaining -= step;
    if (isShot && !probe.hasEnded && moved.travelled >= SHOT_RANGE) {
      probe = { projectile: { ...moved, explodingTicksLeft: EXPLOSION_TICKS }, isPlayerHit: false, hasEnded: true };
    }
  }
  return probe;
}

/** Moves every projectile one step and reports what they hit. Finished explosions are dropped. */
export function stepProjectiles(projectiles: Projectile[], field: Battlefield, dt: number): Volley {
  const ticks = dt * ORIGINAL_TICKS_PER_SECOND;
  const volley: Volley = { projectiles: [], opponentsHit: [], isPlayerHit: false, shotsEnded: 0 };
  return projectiles.reduce((result, projectile) => {
    const aged = { ...projectile, ageTicks: projectile.ageTicks + ticks };
    if (projectile.explodingTicksLeft > 0) {
      const explodingTicksLeft = projectile.explodingTicksLeft - ticks;
      return explodingTicksLeft > 0 ? { ...result, projectiles: [...result.projectiles, { ...aged, explodingTicksLeft }] } : result;
    }
    const probe = flown(aged, field, dt);
    return {
      projectiles: [...result.projectiles, probe.projectile],
      opponentsHit: probe.opponentHit === undefined ? result.opponentsHit : [...result.opponentsHit, probe.opponentHit],
      isPlayerHit: result.isPlayerHit || probe.isPlayerHit,
      shotsEnded: result.shotsEnded + (probe.hasEnded && projectile.kind === 'shot' ? 1 : 0),
    };
  }, volley);
}

/** Frame of HOGMIS.SP to draw for a projectile right now. */
export function projectileFrame(projectile: Projectile): number {
  if (projectile.explodingTicksLeft > 0) {
    return EXPLOSION_FIRST_FRAME + Math.min(EXPLOSION_TICKS - 1, Math.floor(EXPLOSION_TICKS - projectile.explodingTicksLeft));
  }
  return projectile.firstFrame + (Math.floor(projectile.ageTicks) % projectile.frameCount);
}
