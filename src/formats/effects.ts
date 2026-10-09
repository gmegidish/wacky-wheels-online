import { type Archive, getFile } from './archive';
import { decodeSpriteFrames } from './sprite';

export type WheelEffect = {
  width: number;
  height: number;
  /** row-major palette-indexed frames, played one per tick */
  frames: Uint8Array[];
};

// WACKY.SDX, one 0x12e byte record per surface type (docs/re/player-physics.md section 2.3): a flag per track
// file saying whether the surface's effect is used there, then where its frames sit in EFFECTS.SP
const RECORD_SIZE = 0x12e;
const USED_ON_TRACK = 1;
const OFFSET_FIELD = 0x100;
const GEOMETRY_FIELD = 0x108;

/** The puff drawn at the kart's wheels on each surface type of a track (dust, smoke, grass); undefined for none. */
export function loadWheelEffects(archive: Archive, trackNumber: number): (WheelEffect | undefined)[] {
  const table = getFile(archive, 'WACKY.SDX');
  const art = getFile(archive, 'EFFECTS.SP');
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(0, true);
  if (table.length < 2 + count * RECORD_SIZE) {
    throw new Error(`Surface table of ${table.length} bytes cannot hold its ${count} records`);
  }
  return Array.from({ length: count }, (_, type) => {
    const record = 2 + type * RECORD_SIZE;
    const offset = view.getUint32(record + OFFSET_FIELD, true);
    const width = view.getUint16(record + GEOMETRY_FIELD + 2, true);
    const height = view.getUint16(record + GEOMETRY_FIELD + 4, true);
    const frameCount = view.getUint16(record + GEOMETRY_FIELD + 10, true);
    const size = width * height * frameCount;
    if (table[record + trackNumber - 1] !== USED_ON_TRACK || size === 0 || offset + size > art.length) {
      return undefined;
    }
    return { width, height, frames: decodeSpriteFrames(art.subarray(offset, offset + size), width, height) };
  });
}
