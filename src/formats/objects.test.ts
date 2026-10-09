import { expect, test } from 'vitest';
import { openGameArchive } from './gameArchive.testhelper';
import { isObstacle, loadTrackObjects } from './objects';

test('track 1 has 13 objects, nine of them obstacles', () => {
  const objects = loadTrackObjects(openGameArchive(), 1);

  expect(objects.length).toBe(13);
  expect(objects.filter(isObstacle).length).toBe(9);
});

test('every object has at least one frame of its own size', () => {
  const objects = loadTrackObjects(openGameArchive(), 1);

  const badlySized = objects.filter(({ frames, width, height }) => frames.length === 0 || frames[0].length !== width * height);

  expect(badlySized).toEqual([]);
});

test('the first tyre stack of track 1 stands beside the bottom straight', () => {
  const tyreStack = loadTrackObjects(openGameArchive(), 1).find(({ kind }) => kind === 1);

  expect(tyreStack).toMatchObject({ x: 1478, y: 1657, width: 28, height: 28 });
});

test('objects load for every track in the game', () => {
  const archive = openGameArchive();

  const counts = Array.from({ length: 42 }, (_, index) => loadTrackObjects(archive, index + 1).length);

  expect(counts.length).toBe(42);
});
