import { expect, test } from 'vitest';
import { getFile } from './archive';
import { openGameArchive } from './gameArchive.testhelper';
import { checkpointAt, parseProgressMap, parseSurfaceDrag, parseVelocityTable } from './raceData';

test('velocity table gives 40 pixels per tick at full throttle', () => {
  const velocity = parseVelocityTable(getFile(openGameArchive(), 'VEL.TAB'));

  expect(velocity[0]).toBe(0);
  expect(velocity[100]).toBe(40);
});

test('track 1 has 27 checkpoints', () => {
  const map = parseProgressMap(getFile(openGameArchive(), '1.POS'));

  expect(map.lastCheckpoint).toBe(27);
  expect(Math.max(...map.checkpoints)).toBe(27);
});

test('checkpoints count up along the start straight', () => {
  const map = parseProgressMap(getFile(openGameArchive(), '1.POS'));

  expect(checkpointAt(map, 288, 700)).toBeLessThan(checkpointAt(map, 288, 1200));
});

test('outside the map there is no checkpoint', () => {
  const map = parseProgressMap(getFile(openGameArchive(), '1.POS'));

  expect(checkpointAt(map, -5, 100)).toBe(0);
  expect(checkpointAt(map, 100, 5000)).toBe(0);
});

test('rejects a progress map of the wrong size', () => {
  expect(() => parseProgressMap(new Uint8Array(100))).toThrow('Progress map');
});

test('plain road has no drag and sand takes nearly half the speed', () => {
  const drag = parseSurfaceDrag(getFile(openGameArchive(), 'WACKY.SDX'));

  expect(drag.length).toBe(30);
  expect(drag[0]).toBe(0);
  expect(drag[1]).toBeCloseTo(0.46, 2);
});
