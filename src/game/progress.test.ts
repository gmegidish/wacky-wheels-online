import { expect, test } from 'vitest';
import { checkpointsCovered, nextProgress, racePosition } from './progress';

const LAST = 27;

test('crossing from the last checkpoint to the first completes a lap', () => {
  expect(nextProgress({ lap: 0, checkpoint: LAST }, 1, LAST)).toEqual({ lap: 1, checkpoint: 1 });
});

test('rolling back over the line takes the lap away again', () => {
  expect(nextProgress({ lap: 1, checkpoint: 1 }, LAST, LAST)).toEqual({ lap: 0, checkpoint: LAST });
});

test('driving off the course keeps the last known checkpoint', () => {
  expect(nextProgress({ lap: 2, checkpoint: 9 }, 0, LAST)).toEqual({ lap: 2, checkpoint: 9 });
});

test('progress adds whole laps to the current checkpoint', () => {
  expect(checkpointsCovered({ lap: 2, checkpoint: 5 }, LAST)).toBe(59);
});

test('race position counts the karts ahead', () => {
  expect(racePosition(50, [10, 60, 70])).toBe(3);
  expect(racePosition(80, [10, 60, 70])).toBe(1);
});
