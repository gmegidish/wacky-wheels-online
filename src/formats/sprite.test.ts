import { expect, test } from 'vitest';
import { getFile } from './archive';
import { openGameArchive } from './gameArchive.testhelper';
import { KART_FRAME_HEIGHT, KART_FRAME_WIDTH, decodeSpriteFrames } from './sprite';

test('turns column-by-column storage into row-by-row frames', () => {
  // 3 wide, 2 high: columns are [1,2] [3,4] [5,6]
  const stored = new Uint8Array([1, 2, 3, 4, 5, 6]);

  const [frame] = decodeSpriteFrames(stored, 3, 2);

  expect([...frame]).toEqual([1, 3, 5, 2, 4, 6]);
});

test('kart sheet holds 12 frames for each of the 8 characters', () => {
  const frames = decodeSpriteFrames(getFile(openGameArchive(), 'CARS.SP'), KART_FRAME_WIDTH, KART_FRAME_HEIGHT);

  expect(frames.length).toBe(8 * 12);
});

test('rejects data that is not a whole number of frames', () => {
  expect(() => decodeSpriteFrames(new Uint8Array(7), 3, 2)).toThrow('frames');
});
