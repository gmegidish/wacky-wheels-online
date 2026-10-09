import { expect, test } from 'vitest';
import { viewWidthFor } from './screen';

test('a 4:3 canvas shows exactly the original 320 wide picture, as a CRT did', () => {
  expect(viewWidthFor(1600, 1200)).toBe(320);
});

test('a 16:9 canvas shows a view 427 original pixels wide', () => {
  expect(viewWidthFor(1600, 900)).toBe(427);
});

test('a canvas narrower than the original still shows the full 320', () => {
  expect(viewWidthFor(600, 800)).toBe(320);
});
