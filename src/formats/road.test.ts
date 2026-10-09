import { expect, test } from 'vitest';
import { getFile } from './archive';
import { openGameArchive } from './gameArchive.testhelper';
import { parseRoad } from './road';

test('reads the 42 road segments of track 1', () => {
  const road = parseRoad(getFile(openGameArchive(), '1.RD'));

  expect(road.length).toBe(42);
  expect(road[0].from).toEqual({ x: 254, y: 535 });
  expect(road[0].to).toEqual({ x: 253, y: 1399 });
});

test('road segments chain into a closed lap', () => {
  const road = parseRoad(getFile(openGameArchive(), '1.RD'));

  const gaps = road.map((segment, index) => {
    const next = road[(index + 1) % road.length];
    return Math.hypot(next.from.x - segment.to.x, next.from.y - segment.to.y);
  });

  expect(Math.max(...gaps)).toBeLessThan(4);
});

test('rejects road data cut off mid-segment', () => {
  expect(() => parseRoad(new Uint8Array([2, 0, 1, 2, 3]))).toThrow('Road');
});
