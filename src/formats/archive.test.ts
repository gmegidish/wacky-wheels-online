import { expect, test } from 'vitest';
import { getFile, parseArchive } from './archive';
import { openGameArchive } from './gameArchive.testhelper';

function archiveWithOneFile(name: string, content: number[]): Uint8Array {
  const bytes = new Uint8Array(2 + 22 + content.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true);
  bytes.set(new TextEncoder().encode(name), 2);
  view.setUint32(2 + 14, content.length, true);
  view.setUint32(2 + 18, 22, true);
  bytes.set(content, 2 + 22);
  return bytes;
}

test('lists every file in the game archive', () => {
  const archive = openGameArchive();

  expect(archive.size).toBe(577);
});

test('returns the 64x64 tile map of track 1', () => {
  const tileMap = getFile(openGameArchive(), '1.M');

  expect(tileMap.length).toBe(64 * 64);
});

test('reads file content at an offset relative to the end of the count', () => {
  const archive = parseArchive(archiveWithOneFile('A.BIN', [7, 8, 9]));

  expect([...getFile(archive, 'a.bin')]).toEqual([7, 8, 9]);
});

test('throws when a file is missing', () => {
  expect(() => getFile(openGameArchive(), 'NOPE.XXX')).toThrow('NOPE.XXX');
});

test('throws when an entry points outside the archive', () => {
  const truncated = archiveWithOneFile('A.BIN', [7, 8, 9]).slice(0, 25);

  expect(() => parseArchive(truncated)).toThrow('A.BIN');
});
