import { expect, test } from 'vitest';
import { openGameArchive } from '../formats/gameArchive.testhelper';
import { type HudArt, type HudState, drawHud as drawHudAnyWidth, lapText, loadHudArt } from './hud';

const ORIGINAL_WIDTH = 320;
const WIDE = 400;

function drawHud(art: HudArt, state: HudState): Uint8Array {
  return drawHudAnyWidth(art, state, ORIGINAL_WIDTH);
}

const ON_THE_GRID: HudState = { position: 8, lives: 3, hedgehogs: 0, heldWeapon: 0, speed: 0, lapText: '', clockTenths: 0 };

function paintedPixelsIn(screen: Uint8Array, left: number, top: number, width: number, height: number, screenWidth = ORIGINAL_WIDTH): number {
  let painted = 0;
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      painted += screen[y * screenWidth + x] === 0 ? 0 : 1;
    }
  }
  return painted;
}

test('draws the position box, both panels and the speedometer where the original puts them', () => {
  const screen = drawHud(loadHudArt(openGameArchive()), ON_THE_GRID);

  expect(paintedPixelsIn(screen, 17, 6, 38, 41)).toBeGreaterThan(1000);
  expect(paintedPixelsIn(screen, 68, 6, 65, 19)).toBeGreaterThan(600);
  expect(paintedPixelsIn(screen, 146, 6, 61, 19)).toBeGreaterThan(600);
  expect(paintedPixelsIn(screen, 0, 181, 42, 19)).toBeGreaterThan(400);
});

test('leaves the middle of the view clear', () => {
  const screen = drawHud(loadHudArt(openGameArchive()), ON_THE_GRID);

  expect(paintedPixelsIn(screen, 60, 70, 200, 30)).toBe(0);
});

test('shows the lap text only once there is one', () => {
  const art = loadHudArt(openGameArchive());

  const before = drawHud(art, ON_THE_GRID);
  const after = drawHud(art, { ...ON_THE_GRID, lapText: 'LAP 1' });

  expect(paintedPixelsIn(before, 4, 164, 80, 8)).toBe(0);
  expect(paintedPixelsIn(after, 4, 164, 80, 8)).toBeGreaterThan(40);
});

test('the position digit changes with the race position', () => {
  const art = loadHudArt(openGameArchive());

  const last = drawHud(art, ON_THE_GRID);
  const first = drawHud(art, { ...ON_THE_GRID, position: 1 });

  expect(first).not.toEqual(last);
});

test('lap text counts laps, then announces the last lap and the finish', () => {
  expect(lapText(0, 6, false)).toBe('');
  expect(lapText(2, 6, false)).toBe('LAP 2');
  expect(lapText(6, 6, false)).toBe('LAST LAP!');
  expect(lapText(7, 6, true)).toBe('FINISHED!');
});

test('shows the icon of a held special weapon in the bottom right corner', () => {
  const art = loadHudArt(openGameArchive());

  const emptyHanded = drawHud(art, ON_THE_GRID);
  const holdingBomb = drawHud(art, { ...ON_THE_GRID, heldWeapon: 5 });

  expect(paintedPixelsIn(emptyHanded, 293, 178, 26, 21)).toBe(0);
  expect(paintedPixelsIn(holdingBomb, 293, 178, 26, 21)).toBeGreaterThan(100);
});

test('on a wider view the held item follows the right edge while the position box stays put', () => {
  const art = loadHudArt(openGameArchive());

  const wide = drawHudAnyWidth(art, { ...ON_THE_GRID, heldWeapon: 5 }, WIDE);

  expect(paintedPixelsIn(wide, 293 + WIDE - ORIGINAL_WIDTH, 178, 26, 21, WIDE)).toBeGreaterThan(100);
  expect(paintedPixelsIn(wide, 17, 6, 38, 41, WIDE)).toBeGreaterThan(1000);
});
