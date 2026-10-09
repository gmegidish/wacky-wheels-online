import { type Archive, getFile } from './archive';
import { decodeSpriteFrames } from './sprite';

export type TrackObject = {
  x: number;
  y: number;
  /** 0 solid obstacle, 1 tyre stack, 2 hedgehog ammo, 3-7 special weapon of that number */
  kind: number;
  width: number;
  height: number;
  /** row-major palette-indexed frames */
  frames: Uint8Array[];
};

type SpriteKind = Pick<TrackObject, 'kind' | 'width' | 'height'> & { file: string; frameCount: number };

const COUNT_SIZE = 2;
// SPRITE.ATR: kind, 10, width, height, width, height, scale set, frame count (u16 each), then the file name
const ATTRIBUTE_SIZE = 40;
const ATTRIBUTE_NAME_OFFSET = 16;
// N.SPW: index into SPRITE.ATR, 0, x, y, 0, 0 (u16 each)
const OBJECT_SIZE = 12;
const LAST_OBSTACLE_KIND = 1;

function readName(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return String.fromCharCode(...bytes.subarray(0, end === -1 ? bytes.length : end));
}

function parseSpriteKinds(bytes: Uint8Array): SpriteKind[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= COUNT_SIZE ? view.getUint16(0, true) : 0;
  if (count === 0 || bytes.length < COUNT_SIZE + count * ATTRIBUTE_SIZE) {
    throw new Error(`Sprite attribute table of ${bytes.length} bytes cannot hold its ${count} records`);
  }
  return Array.from({ length: count }, (_, index) => {
    const offset = COUNT_SIZE + index * ATTRIBUTE_SIZE;
    return {
      kind: view.getUint16(offset, true),
      width: view.getUint16(offset + 4, true),
      height: view.getUint16(offset + 6, true),
      frameCount: view.getUint16(offset + 14, true),
      file: readName(bytes.subarray(offset + ATTRIBUTE_NAME_OFFSET, offset + ATTRIBUTE_SIZE)),
    };
  });
}

/** Everything standing on a track: obstacles, tyre stacks and pickups. */
export function loadTrackObjects(archive: Archive, trackNumber: number): TrackObject[] {
  const kinds = parseSpriteKinds(getFile(archive, 'SPRITE.ATR'));
  const bytes = getFile(archive, `${trackNumber}.SPW`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= COUNT_SIZE ? view.getUint16(0, true) : 0;
  if (bytes.length < COUNT_SIZE + count * OBJECT_SIZE) {
    throw new Error(`Object list of track ${trackNumber} is cut short: ${bytes.length} bytes for ${count} objects`);
  }
  return Array.from({ length: count }, (_, index) => {
    const offset = COUNT_SIZE + index * OBJECT_SIZE;
    const spriteIndex = view.getUint16(offset, true);
    const sprite = kinds[spriteIndex];
    if (!sprite) {
      throw new Error(`Object ${index} of track ${trackNumber} uses unknown sprite ${spriteIndex}`);
    }
    return {
      x: view.getUint16(offset + 4, true),
      y: view.getUint16(offset + 6, true),
      kind: sprite.kind,
      width: sprite.width,
      height: sprite.height,
      frames: decodeSpriteFrames(getFile(archive, sprite.file), sprite.width, sprite.height),
    };
  });
}

export function isObstacle(object: TrackObject): boolean {
  return object.kind <= LAST_OBSTACLE_KIND;
}
