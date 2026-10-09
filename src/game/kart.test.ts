import { expect, test } from 'vitest';
import { type Ground, JUMP_PEAK_HEIGHT, type KartInput, type KartState, type SurfaceProbe, stepKart } from './kart';

const TICK = 1 / 70;
const PARKED: KartState = { x: 100, y: 100, heading: 0, speed: 0, height: 0, airSecondsLeft: 0, handbrakeTurnLeft: 0 };
const FULL_THROTTLE: KartInput = { throttle: 1, steer: 0, handbrake: false };
const COASTING: KartInput = { throttle: 0, steer: 0, handbrake: false };
const BRAKING: KartInput = { throttle: -1, steer: 0, handbrake: false };
const QUARTER_TURN = Math.PI / 2;

const nowhere: SurfaceProbe = () => false;
const openField: Ground = { isWall: nowhere, isJump: nowhere, dragAt: () => 0 };

function wallEastOf(wallX: number): Ground {
  return { ...openField, isWall: (x) => x >= wallX };
}

function jumpBetween(fromX: number, toX: number): Ground {
  return { ...openField, isJump: (x) => x >= fromX && x < toX };
}

function sandEverywhere(drag: number): Ground {
  return { ...openField, dragAt: () => drag };
}

function driveFor(seconds: number, start: KartState, input: KartInput, ground: Ground = openField): KartState {
  let state = start;
  for (let elapsed = 0; elapsed < seconds; elapsed += TICK) {
    state = stepKart(state, input, TICK, ground);
  }
  return state;
}

function highestPointWhileDriving(seconds: number, start: KartState, input: KartInput, ground: Ground): number {
  let state = start;
  let highest = 0;
  for (let elapsed = 0; elapsed < seconds; elapsed += TICK) {
    state = stepKart(state, input, TICK, ground);
    highest = Math.max(highest, state.height);
  }
  return highest;
}

function upToSpeed(): KartState {
  return driveFor(3, PARKED, FULL_THROTTLE);
}

test('accelerates along its heading under throttle', () => {
  const kart = driveFor(1, PARKED, FULL_THROTTLE);

  expect(kart.x).toBeGreaterThan(PARKED.x);
  expect(kart.y).toBeCloseTo(PARKED.y);
  expect(kart.speed).toBeGreaterThan(0);
});

test('reaches the original top speed of 40 pixels a tick in under a second and holds it', () => {
  const afterOneSecond = driveFor(1, PARKED, FULL_THROTTLE);
  const afterTenSeconds = driveFor(10, PARKED, FULL_THROTTLE);

  expect(afterOneSecond.speed).toBeCloseTo((40 * 136) / 12);
  expect(afterTenSeconds.speed).toBeCloseTo(afterOneSecond.speed);
});

test('rolls to a stop when coasting', () => {
  expect(driveFor(10, upToSpeed(), COASTING).speed).toBe(0);
});

test('braking stops the kart sooner than coasting and never reverses it', () => {
  const braked = driveFor(1, upToSpeed(), BRAKING);
  const coasted = driveFor(1, upToSpeed(), COASTING);

  expect(braked.speed).toBe(0);
  expect(coasted.speed).toBeGreaterThan(0);
  expect(driveFor(5, braked, BRAKING).x).toBe(braked.x);
});

test('steering right while moving turns the heading clockwise', () => {
  const kart = driveFor(1, PARKED, { throttle: 1, steer: 1, handbrake: false });

  expect(kart.heading).toBeGreaterThan(PARKED.heading);
});

test('steering does nothing while parked', () => {
  const kart = driveFor(1, PARKED, { throttle: 0, steer: 1, handbrake: false });

  expect(kart.heading).toBe(PARKED.heading);
});

test('sand takes its share off the speed but leaves the throttle alone', () => {
  const onRoad = driveFor(2, PARKED, FULL_THROTTLE);
  const onSand = driveFor(2, PARKED, FULL_THROTTLE, sandEverywhere(0.46));

  expect(onSand.x - PARKED.x).toBeCloseTo((onRoad.x - PARKED.x) * 0.54, 0);
  expect(onSand.speed).toBe(onRoad.speed);
});

test('does not drive through a wall', () => {
  const kart = driveFor(5, PARKED, FULL_THROTTLE, wallEastOf(150));

  expect(kart.x).toBeLessThan(150);
});

test('a wall throws the kart 32 pixels straight back and stops it dead', () => {
  const justBeforeTheWall: KartState = { ...upToSpeed(), x: 148 };

  const kart = stepKart(justBeforeTheWall, FULL_THROTTLE, TICK, wallEastOf(150));

  expect(kart.x).toBeCloseTo(148 - 32);
  expect(kart.speed).toBe(0);
});

test('does not mutate the state it was given', () => {
  const start: KartState = { ...PARKED };

  stepKart(start, FULL_THROTTLE, TICK, openField);

  expect(start).toEqual(PARKED);
});

test('a jump ramp launches the kart to the peak height and sets it down again', () => {
  const start = upToSpeed();
  const rampAhead = jumpBetween(start.x + 50, start.x + 82);

  const highest = highestPointWhileDriving(1, start, FULL_THROTTLE, rampAhead);
  const afterwards = driveFor(5, start, FULL_THROTTLE, rampAhead);

  expect(highest).toBeCloseTo(JUMP_PEAK_HEIGHT, 0);
  expect(afterwards.height).toBe(0);
});

test('a jump covers the same ground however slowly the kart took off', () => {
  const crawling: KartState = { ...PARKED, speed: 20 };
  const ramp = jumpBetween(100, 110);
  const takeOff = stepKart(crawling, COASTING, TICK, ramp);

  const landed = driveFor(8 / (136 / 12), takeOff, COASTING, ramp);

  expect(landed.height).toBe(0);
  expect(landed.x - takeOff.x).toBeGreaterThan(470);
  expect(landed.x - takeOff.x).toBeLessThan(490);
});

test('cannot steer while in the air', () => {
  const airborne: KartState = { ...PARKED, speed: 200, height: 10, airSecondsLeft: 0.3 };

  const kart = stepKart(airborne, { throttle: 1, steer: 1, handbrake: false }, TICK, openField);

  expect(kart.heading).toBe(airborne.heading);
});

test('a wall ends a jump', () => {
  const airborne: KartState = { ...PARKED, x: 149, speed: 200, height: 10, airSecondsLeft: 0.3 };

  const kart = stepKart(airborne, COASTING, TICK, wallEastOf(150));

  expect(kart.airSecondsLeft).toBe(0);
  expect(kart.height).toBe(0);
});

test('hand brake swings a moving kart a quarter turn to the left', () => {
  const tapped = stepKart(upToSpeed(), { throttle: 0, steer: 0, handbrake: true }, TICK, openField);

  const kart = driveFor(1, tapped, COASTING);

  expect(kart.heading).toBeCloseTo(-QUARTER_TURN);
});

test('hand brake swings right when steering right', () => {
  const tapped = stepKart(upToSpeed(), { throttle: 0, steer: 1, handbrake: true }, TICK, openField);

  const kart = driveFor(1, tapped, COASTING);

  expect(kart.heading).toBeCloseTo(QUARTER_TURN);
});

test('holding the hand brake keeps swinging quarter turn after quarter turn', () => {
  const kart = driveFor(0.6, upToSpeed(), { throttle: 1, steer: 0, handbrake: true });

  expect(kart.heading).toBeLessThan(-QUARTER_TURN);
});

test('hand brake does nothing to a parked kart or one in the air', () => {
  const airborne: KartState = { ...PARKED, speed: 200, height: 10, airSecondsLeft: 0.3 };
  const pulled: KartInput = { throttle: 0, steer: 0, handbrake: true };

  expect(stepKart(PARKED, pulled, TICK, openField).heading).toBe(PARKED.heading);
  expect(stepKart(airborne, pulled, TICK, openField).heading).toBe(airborne.heading);
});
