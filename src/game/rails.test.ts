import { expect, test } from 'vitest';
import { getFile } from '../formats/archive';
import { openGameArchive } from '../formats/gameArchive.testhelper';
import { parseRoad } from '../formats/road';
import { buildRails, isFurtherRound, railDistanceOf, railPosition } from './rails';

function trackOneRails() {
  return buildRails(parseRoad(getFile(openGameArchive(), '1.RD')));
}

test('a lap of track 1 is 5642 path points', () => {
  expect(trackOneRails().totalPoints).toBe(5642);
});

test('distance zero is the start of the first segment, heading down the start straight', () => {
  const position = railPosition(trackOneRails(), 0);

  expect(position.x).toBeCloseTo(254);
  expect(position.y).toBeCloseTo(535);
  expect(position.heading).toBeCloseTo(Math.PI / 2, 1);
});

test('going a full lap comes back to the same place', () => {
  const rails = trackOneRails();

  expect(railPosition(rails, 100 + rails.totalPoints)).toEqual(railPosition(rails, 100));
});

test('moves along the segment between its ends', () => {
  const position = railPosition(trackOneRails(), 432);

  expect(position.y).toBeCloseTo(535 + 432);
});

test('a kart beside the start straight is measured along the straight', () => {
  expect(railDistanceOf(trackOneRails(), 300, 935)).toBeCloseTo(400, 0);
});

test('further round the loop wins, including across the point where the loop restarts', () => {
  const rails = trackOneRails();

  expect(isFurtherRound(rails, 500, 400)).toBe(true);
  expect(isFurtherRound(rails, 400, 500)).toBe(false);
  expect(isFurtherRound(rails, 20, rails.totalPoints - 20)).toBe(true);
});
