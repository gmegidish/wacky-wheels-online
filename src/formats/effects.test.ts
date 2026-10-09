import { expect, test } from 'vitest';
import { loadWheelEffects } from './effects';
import { openGameArchive } from './gameArchive.testhelper';

test('road and sand on track 1 each have a three-frame puff of 20x12', () => {
  const effects = loadWheelEffects(openGameArchive(), 1);

  expect(effects[0]).toMatchObject({ width: 20, height: 12 });
  expect(effects[0]?.frames.length).toBe(3);
  expect(effects[1]?.frames.length).toBe(3);
});

test('walls have no wheel effect', () => {
  expect(loadWheelEffects(openGameArchive(), 1)[3]).toBeUndefined();
});
