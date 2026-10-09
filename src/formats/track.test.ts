import { expect, test } from 'vitest';
import { getFile } from './archive';
import { openGameArchive } from './gameArchive.testhelper';
import { WORLD_SIZE, loadTrack, parseTrackInfo } from './track';

test('reads sheet names and start positions from the track descriptor', () => {
  const info = parseTrackInfo(getFile(openGameArchive(), '1.GAM'));

  expect(info.tileSheets).toEqual(['f1.pcx', 'f2.pcx']);
  expect(info.maskSheets).toEqual(['ma1.pcx', 'ma2.pcx']);
  expect(info.background).toBe('back1.pcx');
  expect(info.startPositions.length).toBe(8);
  expect(info.startPositions[0]).toEqual({ x: 288, y: 608 });
});

test('bakes track 1 into a world-sized floor and wall mask', () => {
  const track = loadTrack(openGameArchive(), 1);

  expect(track.floor.length).toBe(WORLD_SIZE * WORLD_SIZE);
  expect(track.mask.length).toBe(WORLD_SIZE * WORLD_SIZE);
});

test('start positions of track 1 are not inside walls', () => {
  const track = loadTrack(openGameArchive(), 1);

  const blocked = track.startPositions.filter(({ x, y }) => track.isWall(x, y));

  expect(blocked).toEqual([]);
});

test('everything outside the world is a wall', () => {
  const track = loadTrack(openGameArchive(), 1);

  expect(track.isWall(-1, 100)).toBe(true);
  expect(track.isWall(100, WORLD_SIZE)).toBe(true);
});

test('rejects a descriptor with too few lines', () => {
  expect(() => parseTrackInfo(new TextEncoder().encode('f1.pcx\r\nf2.pcx\r\n'))).toThrow('descriptor');
});

test('the JUMP marking on the bottom straight of track 1 is a jump, not a wall', () => {
  const track = loadTrack(openGameArchive(), 1);
  const jumpMarking = { x: 25 * 32 + 16, y: 55 * 32 + 16 };

  expect(track.isJump(jumpMarking.x, jumpMarking.y)).toBe(true);
  expect(track.isWall(jumpMarking.x, jumpMarking.y)).toBe(false);
});

test('plain road is not a jump', () => {
  const track = loadTrack(openGameArchive(), 1);
  const [gridSlot] = track.startPositions;

  expect(track.isJump(gridSlot.x, gridSlot.y)).toBe(false);
});

test('track 1 has a 1280x20 strip of distant scenery', () => {
  const { horizon } = loadTrack(openGameArchive(), 1);

  expect([horizon.width, horizon.height]).toEqual([1280, 20]);
  expect(horizon.pixels.length).toBe(1280 * 20);
});

test('the grid of track 1 is plain road', () => {
  const track = loadTrack(openGameArchive(), 1);
  const [gridSlot] = track.startPositions;

  expect(track.surfaceAt(gridSlot.x, gridSlot.y)).toBe(0);
});

test('the sand outside the kerbs can be driven on', () => {
  const track = loadTrack(openGameArchive(), 1);
  const sandBesideTheStartStraight = { x: 100, y: 1000 };

  expect(track.surfaceAt(sandBesideTheStartStraight.x, sandBesideTheStartStraight.y)).toBe(1);
  expect(track.isWall(sandBesideTheStartStraight.x, sandBesideTheStartStraight.y)).toBe(false);
});

test('the fence along the top edge of track 1 is a wall', () => {
  const track = loadTrack(openGameArchive(), 1);

  const wallPixels = Array.from({ length: 2048 }, (_, x) => x).filter((x) => track.isWall(x, 20));

  expect(wallPixels.length).toBeGreaterThan(500);
});

test('walls only ever come from fence tiles, never from kerb corners', () => {
  const track = loadTrack(openGameArchive(), 1);
  const kerbCornerTyreStack = track.objects.find(({ x, y }) => x === 1078 && y === 510);

  expect(kerbCornerTyreStack).toBeDefined();
  expect(track.isWall(1078, 510)).toBe(false);
});
