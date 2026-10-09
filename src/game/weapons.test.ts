import { expect, test } from 'vitest';
import type { Ground, KartState } from './kart';
import { type Battlefield, EMPTY_HANDED, type Inventory, type Projectile, collected, pressFire, projectileFrame, stepProjectiles } from './weapons';

const TICK = 1 / 70;
const KART: KartState = { x: 100, y: 100, heading: 0, speed: 200, height: 0, airSecondsLeft: 0, handbrakeTurnLeft: 0 };
const openGround: Ground = { isWall: () => false, isJump: () => false, dragAt: () => 0 };
const EMPTY_FIELD: Battlefield = { ground: openGround, obstacles: [], opponents: [], player: KART };
const ARMED: Inventory = { ...EMPTY_HANDED, hedgehogs: 4 };

function fire(inventory: Inventory, kart = KART): Projectile[] {
  return pressFire(inventory, true, kart).fired;
}

function flyFor(seconds: number, projectiles: Projectile[], field: Battlefield) {
  let volley = { projectiles, opponentsHit: [] as number[], isPlayerHit: false, shotsEnded: 0 };
  const opponentsHit: number[] = [];
  let isPlayerHit = false;
  let shotsEnded = 0;
  for (let elapsed = 0; elapsed < seconds; elapsed += TICK) {
    volley = stepProjectiles(volley.projectiles, field, TICK);
    opponentsHit.push(...volley.opponentsHit);
    isPlayerHit = isPlayerHit || volley.isPlayerHit;
    shotsEnded += volley.shotsEnded;
  }
  return { projectiles: volley.projectiles, opponentsHit, isPlayerHit, shotsEnded };
}

test('a hedgehog pickup adds four hedgehogs, up to 99', () => {
  expect(collected(EMPTY_HANDED, 2)?.hedgehogs).toBe(4);
  expect(collected({ ...EMPTY_HANDED, hedgehogs: 97 }, 2)?.hedgehogs).toBe(99);
});

test('a special weapon is taken only when none is held', () => {
  expect(collected(EMPTY_HANDED, 5)?.heldWeapon).toBe(5);
  expect(collected({ ...EMPTY_HANDED, heldWeapon: 3 }, 5)).toBeUndefined();
});

test('nothing can be picked up with a full load of hedgehogs', () => {
  expect(collected({ ...EMPTY_HANDED, hedgehogs: 99 }, 2)).toBeUndefined();
  expect(collected({ ...EMPTY_HANDED, hedgehogs: 99 }, 5)).toBeUndefined();
});

test('firing throws one hedgehog forward and uses one up', () => {
  const { inventory, fired } = pressFire(ARMED, true, KART);

  expect(fired.length).toBe(1);
  expect(fired[0].x).toBeGreaterThan(KART.x);
  expect(inventory.hedgehogs).toBe(3);
});

test('holding the button does not fire again, and nothing fires while a shot is still flying', () => {
  const first = pressFire(ARMED, true, KART);
  const stillHeld = pressFire(first.inventory, true, KART);
  const released = pressFire(stillHeld.inventory, false, KART);
  const pressedAgain = pressFire(released.inventory, true, KART);

  expect(stillHeld.fired).toEqual([]);
  expect(pressedAgain.fired).toEqual([]);
});

test('cannot fire with nothing to throw, or in the air', () => {
  expect(fire(EMPTY_HANDED)).toEqual([]);
  expect(fire(ARMED, { ...KART, airSecondsLeft: 0.3 })).toEqual([]);
});

test('a held special is used before hedgehogs and costs none', () => {
  const { inventory, fired } = pressFire({ ...ARMED, heldWeapon: 3 }, true, KART);

  expect(fired.length).toBe(3);
  expect(inventory.heldWeapon).toBe(0);
  expect(inventory.hedgehogs).toBe(4);
});

test('bouncers leave to both sides and a mine is dropped behind', () => {
  const bouncers = fire({ ...EMPTY_HANDED, heldWeapon: 4 });
  const [mine] = fire({ ...EMPTY_HANDED, heldWeapon: 5 });

  expect(bouncers.map(({ y }) => Math.sign(y - KART.y)).sort()).toEqual([-1, 1]);
  expect(mine.x).toBeLessThan(KART.x);
});

test('a hedgehog stuns the opponent it reaches and is then spent', () => {
  const opponentAhead = { x: 400, y: 100, isStunned: false };

  const result = flyFor(1, fire(ARMED), { ...EMPTY_FIELD, opponents: [opponentAhead] });

  expect(result.opponentsHit).toEqual([0]);
  expect(result.shotsEnded).toBe(1);
  expect(result.projectiles).toEqual([]);
});

test('an opponent that is already stunned swallows the shot', () => {
  const stunnedAhead = { x: 400, y: 100, isStunned: true };

  const result = flyFor(1, fire(ARMED), { ...EMPTY_FIELD, opponents: [stunnedAhead] });

  expect(result.opponentsHit).toEqual([]);
  expect(result.shotsEnded).toBe(1);
});

test('a hedgehog gives up after a thousand pixels', () => {
  const result = flyFor(2, fire(ARMED), EMPTY_FIELD);

  expect(result.shotsEnded).toBe(1);
  expect(result.opponentsHit).toEqual([]);
});

test('a wall or a tyre stack stops a hedgehog', () => {
  const walled = { ...EMPTY_FIELD, ground: { ...openGround, isWall: (x: number) => x > 300 } };
  const blocked = { ...EMPTY_FIELD, obstacles: [{ x: 300, y: 100 }], opponents: [{ x: 500, y: 100, isStunned: false }] };

  expect(flyFor(1, fire(ARMED), walled).shotsEnded).toBe(1);
  expect(flyFor(1, fire(ARMED), blocked).opponentsHit).toEqual([]);
});

test('a shot keeps steering with the kart that fired it', () => {
  const turnedSouth = { ...EMPTY_FIELD, player: { ...KART, heading: Math.PI / 2 } };

  const [shot] = stepProjectiles(fire(ARMED), turnedSouth, TICK).projectiles;

  expect(shot.y).toBeGreaterThan(KART.y);
});

test('a bouncer turns straight back at a wall and keeps going', () => {
  const walled = { ...EMPTY_FIELD, ground: { ...openGround, isWall: (_x: number, y: number) => y > 200 } };
  const southBound = fire({ ...EMPTY_HANDED, heldWeapon: 4 }).filter(({ y }) => y > KART.y);

  const [bouncer] = flyFor(3, southBound, { ...walled, player: { ...KART, x: 5000 } }).projectiles;

  expect(bouncer.y).toBeLessThan(KART.y);
});

test('your own mine gets you once you have driven clear and come back', () => {
  const mine = fire({ ...EMPTY_HANDED, heldWeapon: 5 });
  const stillOnIt = flyFor(0.2, mine, EMPTY_FIELD);
  const drivenAway = flyFor(0.2, stillOnIt.projectiles, { ...EMPTY_FIELD, player: { ...KART, x: 400 } });
  const cameBack = flyFor(0.2, drivenAway.projectiles, EMPTY_FIELD);

  expect(stillOnIt.isPlayerHit).toBe(false);
  expect(cameBack.isPlayerHit).toBe(true);
});

test('a flying hedgehog cycles its three frames and an explosion plays the first three', () => {
  const [shot] = fire(ARMED);

  expect(projectileFrame(shot)).toBe(3);
  expect(projectileFrame({ ...shot, ageTicks: 2 })).toBe(5);
  expect(projectileFrame({ ...shot, explodingTicksLeft: 3 })).toBe(0);
});
