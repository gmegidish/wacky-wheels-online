import { expect, test } from 'vitest';
import { kartFrame, opponentFrame } from './kartFrame';

const A_MOMENT = 0.05;
const A_WHILE = 1;

test('shows the plain rear view when driving straight', () => {
  expect(kartFrame(0, A_WHILE)).toBe(4);
});

test('driver leans a little when steering starts, then fully', () => {
  expect(kartFrame(-1, A_MOMENT)).toBe(8);
  expect(kartFrame(-1, A_WHILE)).toBe(9);
});

test('driver leans the other way when steering right', () => {
  expect(kartFrame(1, A_MOMENT)).toBe(10);
  expect(kartFrame(1, A_WHILE)).toBe(11);
});

const EIGHTH_TURN = Math.PI / 4;

test('an opponent driving the same way as the camera is seen from behind', () => {
  expect(opponentFrame(1, 1)).toBe(4);
});

test('an opponent driving towards the camera is seen from the front', () => {
  expect(opponentFrame(0, Math.PI)).toBe(0);
});

test('an opponent veering right of the camera direction shows the next view round', () => {
  expect(opponentFrame(0, EIGHTH_TURN)).toBe(5);
  expect(opponentFrame(0, -EIGHTH_TURN)).toBe(3);
});

test('view wraps around for headings several turns apart', () => {
  expect(opponentFrame(0, 4 * Math.PI + EIGHTH_TURN)).toBe(5);
});
