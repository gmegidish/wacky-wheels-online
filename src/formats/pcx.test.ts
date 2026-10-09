import { expect, test } from 'vitest';
import { getFile } from './archive';
import { openGameArchive } from './gameArchive.testhelper';
import { decodePcx, toRgba } from './pcx';

test('decodes a tile sheet as a 320x200 image with a 256 colour palette', () => {
  const sheet = decodePcx(getFile(openGameArchive(), 'A_F1.PCX'));

  expect([sheet.width, sheet.height]).toEqual([320, 200]);
  expect(sheet.pixels.length).toBe(320 * 200);
  expect(sheet.palette.length).toBe(768);
});

test('first tile of the first sheet is grass green', () => {
  const sheet = decodePcx(getFile(openGameArchive(), 'A_F1.PCX'));

  const [red, green, blue] = toRgba(sheet.pixels, sheet.palette);

  expect(green).toBeGreaterThan(red + blue);
});

test('makes the transparent index fully transparent', () => {
  const palette = new Uint8Array(768).fill(200);

  const rgba = toRgba(new Uint8Array([0, 5]), palette, 0);

  expect([rgba[3], rgba[7]]).toEqual([0, 255]);
});

test('rejects data that is not a PCX image', () => {
  expect(() => decodePcx(new Uint8Array(1000))).toThrow('PCX');
});
