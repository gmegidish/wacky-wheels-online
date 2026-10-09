export type ProgressMap = {
  /** one checkpoint number per 32px tile, 64 per row; 0 means off the course */
  checkpoints: Uint16Array;
  lastCheckpoint: number;
};

const MAP_TILES = 64;
const TILE_SIZE = 32;
const MAP_BYTES = MAP_TILES * MAP_TILES * 2;

function readWords(bytes: Uint8Array, count: number): Uint16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint16Array.from({ length: count }, (_, index) => view.getUint16(index * 2, true));
}

/** VEL.TAB: speed in pixels per original tick for each throttle value. */
export function parseVelocityTable(bytes: Uint8Array): number[] {
  if (bytes.length === 0 || bytes.length % 2 !== 0) {
    throw new Error(`Velocity table of ${bytes.length} bytes is not a list of 16-bit values`);
  }
  return [...readWords(bytes, bytes.length / 2)];
}

// WACKY.SDX: u16 count, then one 0x12e byte record per surface type; the drag is a 16.16 fraction at 0x120
const SURFACE_RECORD_SIZE = 0x12e;
const SURFACE_DRAG_OFFSET = 0x120;

/** Share of the speed each surface type takes away, indexed by surface type. */
export function parseSurfaceDrag(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 2 ? view.getUint16(0, true) : 0;
  if (count === 0 || bytes.length < 2 + count * SURFACE_RECORD_SIZE) {
    throw new Error(`Surface table of ${bytes.length} bytes cannot hold its ${count} records`);
  }
  return Array.from({ length: count }, (_, type) => view.getUint32(2 + type * SURFACE_RECORD_SIZE + SURFACE_DRAG_OFFSET, true) / 0x10000);
}

/** N.POS: the checkpoint each tile belongs to, followed by the number of the last checkpoint. */
export function parseProgressMap(bytes: Uint8Array): ProgressMap {
  if (bytes.length !== MAP_BYTES + 2) {
    throw new Error(`Progress map is ${bytes.length} bytes, expected ${MAP_BYTES + 2}`);
  }
  const words = readWords(bytes, MAP_TILES * MAP_TILES + 1);
  return { checkpoints: words.subarray(0, MAP_TILES * MAP_TILES), lastCheckpoint: words[MAP_TILES * MAP_TILES] };
}

export function checkpointAt(map: ProgressMap, x: number, y: number): number {
  const tileX = Math.floor(x / TILE_SIZE);
  const tileY = Math.floor(y / TILE_SIZE);
  if (tileX < 0 || tileY < 0 || tileX >= MAP_TILES || tileY >= MAP_TILES) {
    return 0;
  }
  return map.checkpoints[tileY * MAP_TILES + tileX];
}
