import { expect, test } from 'vitest';
import { CONTACT_DISTANCE, pushClearOf } from './collision';
import type { KartState, SurfaceProbe } from './kart';

const noWalls: SurfaceProbe = () => false;

function kartAt(x: number, y: number, extra: Partial<KartState> = {}): KartState {
  return {
    x,
    y,
    heading: 0,
    speed: 100,
    height: 0,
    airSecondsLeft: 0,
    handbrakeTurnLeft: 0,
    ...extra,
  };
}

test('a kart overlapping an opponent is slid out until they just touch', () => {
  const kart = pushClearOf(kartAt(100, 100), [{ x: 104, y: 100 }], noWalls);

  expect(kart.x).toBeCloseTo(104 - CONTACT_DISTANCE);
  expect(kart.y).toBeCloseTo(100);
});

test('a bump does not rob the kart of its speed', () => {
  expect(pushClearOf(kartAt(100, 100), [{ x: 104, y: 100 }], noWalls).speed).toBe(100);
});

test('a kart that is not touching anyone is left alone', () => {
  const kart = kartAt(100, 100);

  expect(pushClearOf(kart, [{ x: 300, y: 100 }], noWalls)).toEqual(kart);
});

test('a kart sitting exactly on an opponent backs out along its heading', () => {
  const kart = pushClearOf(kartAt(100, 100), [{ x: 100, y: 100 }], noWalls);

  expect(kart.x).toBeCloseTo(100 - CONTACT_DISTANCE);
});

test('a kart is never pushed into a wall', () => {
  const wallWestOf100: SurfaceProbe = (x) => x < 100;

  expect(pushClearOf(kartAt(100, 100), [{ x: 104, y: 100 }], wallWestOf100).x).toBe(100);
});

test('a kart flying over an opponent does not bump it', () => {
  const airborne = kartAt(100, 100, { height: 20 });

  expect(pushClearOf(airborne, [{ x: 104, y: 100 }], noWalls)).toEqual(airborne);
});

test('does not mutate the kart it was given', () => {
  const kart = kartAt(100, 100);
  const before = structuredClone(kart);

  pushClearOf(kart, [{ x: 104, y: 100 }], noWalls);

  expect(kart).toEqual(before);
});
