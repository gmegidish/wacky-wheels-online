import { type Archive, getFile, hasFile } from './archive';
import { type WheelEffect, loadWheelEffects } from './effects';
import { type TrackObject, loadTrackObjects } from './objects';
import { type IndexedImage, decodePcx } from './pcx';
import { type ProgressMap, parseProgressMap, parseSurfaceDrag } from './raceData';
import { type RoadSegment, parseRoad } from './road';

export type Point = { x: number; y: number };

export type TrackInfo = {
  tileSheets: [string, string];
  maskSheets: [string, string];
  background: string;
  startPositions: Point[];
};

export type Track = {
  /** WORLD_SIZE x WORLD_SIZE palette indices */
  floor: Uint8Array;
  /** WORLD_SIZE x WORLD_SIZE surface values */
  mask: Uint8Array;
  palette: Uint8Array;
  background: IndexedImage;
  /** distant scenery (skyline, hills, clouds) that wraps around the horizon */
  horizon: IndexedImage;
  /** RGB of the grass that lies outside the map */
  surroundColour: [number, number, number];
  startPositions: Point[];
  road: RoadSegment[];
  progressMap: ProgressMap;
  objects: TrackObject[];
  /** puff at the wheels for each surface type */
  wheelEffects: (WheelEffect | undefined)[];
  /** surface type under a point: 0 road, 1 sand, 3 wall, 10 jump ramp, 19 grass, ... */
  surfaceAt: (x: number, y: number) => number;
  isWall: (x: number, y: number) => boolean;
  isJump: (x: number, y: number) => boolean;
  dragAt: (x: number, y: number) => number;
};

export const TILE_SIZE = 32;
export const MAP_TILES = 64;
export const WORLD_SIZE = TILE_SIZE * MAP_TILES;

const SHEET_COLUMNS = 10;
// each sheet has room for 60 tiles but only the first 54 are used; the second sheet continues at 54
const TILES_PER_SHEET = 54;
const SHEET_PREFIX = 'A_';
const START_POSITIONS_LINE = 8;
const START_POSITION_COUNT = 8;
// N.PAR: raw pixels in the tile sheet palette, no header
const HORIZON_WIDTH = 1280;
const HORIZON_HEIGHT = 20;
// N.SIN: one 12-byte record per tile graphic of both sheets: u16 1, u16 "has a mask", u32 surface type of the
// tile, u32 surface type of the pixels its mask sheet marks with 1
const SURFACE_RECORD_SIZE = 12;
const MASK_MARKED = 1;
const SURFACE_WALL = 3;
const SURFACE_JUMP = 10;
const SURFACE_OUTSIDE = SURFACE_WALL;

export function parseTrackInfo(bytes: Uint8Array): TrackInfo {
  const lines = new TextDecoder('latin1')
    .decode(bytes)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < START_POSITIONS_LINE + START_POSITION_COUNT * 2) {
    throw new Error(`Track descriptor has only ${lines.length} lines`);
  }

  const startPositions = Array.from({ length: START_POSITION_COUNT }, (_, index) => {
    const x = Number(lines[START_POSITIONS_LINE + index * 2]);
    const y = Number(lines[START_POSITIONS_LINE + index * 2 + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Track descriptor start position ${index + 1} is not a number`);
    }
    return { x, y };
  });
  return {
    tileSheets: [lines[0], lines[1]],
    maskSheets: [lines[2], lines[3]],
    background: lines[4],
    startPositions,
  };
}

function loadImage(archive: Archive, name: string): IndexedImage {
  const stored = hasFile(archive, name) ? name : SHEET_PREFIX + name;
  return decodePcx(getFile(archive, stored));
}

export function bakeTileMap(tiles: Uint8Array, sheets: [IndexedImage, IndexedImage]): Uint8Array {
  if (tiles.length !== MAP_TILES * MAP_TILES) {
    throw new Error(`Tile map has ${tiles.length} tiles, expected ${MAP_TILES * MAP_TILES}`);
  }
  const baked = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
  tiles.forEach((tile, index) => {
    const sheet = sheets[tile < TILES_PER_SHEET ? 0 : 1];
    const tileInSheet = tile < TILES_PER_SHEET ? tile : tile - TILES_PER_SHEET;
    const sourceX = (tileInSheet % SHEET_COLUMNS) * TILE_SIZE;
    const sourceY = Math.floor(tileInSheet / SHEET_COLUMNS) * TILE_SIZE;
    const targetX = (index % MAP_TILES) * TILE_SIZE;
    const targetY = Math.floor(index / MAP_TILES) * TILE_SIZE;
    for (let row = 0; row < TILE_SIZE; row++) {
      const source = (sourceY + row) * sheet.width + sourceX;
      baked.set(sheet.pixels.subarray(source, source + TILE_SIZE), (targetY + row) * WORLD_SIZE + targetX);
    }
  });
  return baked;
}

function loadHorizon(archive: Archive, trackNumber: number, palette: Uint8Array): IndexedImage {
  const pixels = getFile(archive, `${trackNumber}.PAR`);
  if (pixels.length !== HORIZON_WIDTH * HORIZON_HEIGHT) {
    throw new Error(`Horizon strip of track ${trackNumber} is ${pixels.length} bytes, expected ${HORIZON_WIDTH * HORIZON_HEIGHT}`);
  }
  return { width: HORIZON_WIDTH, height: HORIZON_HEIGHT, pixels, palette };
}

export function loadTrack(archive: Archive, trackNumber: number): Track {
  const info = parseTrackInfo(getFile(archive, `${trackNumber}.GAM`));
  const tiles = getFile(archive, `${trackNumber}.M`);
  const tileSheets = info.tileSheets.map((name) => loadImage(archive, name)) as [IndexedImage, IndexedImage];
  const maskSheets = info.maskSheets.map((name) => loadImage(archive, name)) as [IndexedImage, IndexedImage];
  const mask = bakeTileMap(tiles, maskSheets);
  // tile 0 of the first sheet is the grass drawn outside the track border
  const grass = tileSheets[0].pixels[0] * 3;
  const palette = tileSheets[0].palette;

  const surfaces = getFile(archive, `${trackNumber}.SIN`);
  if (surfaces.length !== TILES_PER_SHEET * 2 * SURFACE_RECORD_SIZE) {
    throw new Error(`Surface table of track ${trackNumber} is ${surfaces.length} bytes`);
  }
  const surfaceView = new DataView(surfaces.buffer, surfaces.byteOffset, surfaces.byteLength);
  const surfaceAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) {
      return SURFACE_OUTSIDE;
    }
    const record = tiles[Math.floor(y / TILE_SIZE) * MAP_TILES + Math.floor(x / TILE_SIZE)] * SURFACE_RECORD_SIZE;
    const hasMask = surfaceView.getUint16(record + 2, true) !== 0;
    const isMarked = hasMask && mask[Math.floor(y) * WORLD_SIZE + Math.floor(x)] === MASK_MARKED;
    return surfaceView.getUint32(record + (isMarked ? 8 : 4), true);
  };
  const isWall = (x: number, y: number): boolean => surfaceAt(x, y) === SURFACE_WALL;
  const isJump = (x: number, y: number): boolean => surfaceAt(x, y) === SURFACE_JUMP;
  const drag = parseSurfaceDrag(getFile(archive, 'WACKY.SDX'));
  const dragAt = (x: number, y: number): number => drag[surfaceAt(x, y)] ?? 0;

  return {
    floor: bakeTileMap(tiles, tileSheets),
    mask,
    palette,
    surroundColour: [palette[grass], palette[grass + 1], palette[grass + 2]],
    background: loadImage(archive, info.background),
    horizon: loadHorizon(archive, trackNumber, palette),
    startPositions: info.startPositions,
    road: parseRoad(getFile(archive, `${trackNumber}.RD`)),
    progressMap: parseProgressMap(getFile(archive, `${trackNumber}.POS`)),
    objects: loadTrackObjects(archive, trackNumber),
    wheelEffects: loadWheelEffects(archive, trackNumber),
    surfaceAt,
    isWall,
    isJump,
    dragAt,
  };
}
