import type { Point } from './track';

export type RoadSegment = {
  from: Point;
  to: Point;
};

const COUNT_SIZE = 2;
// x1, y1, x2, y2, heading (1920 units per circle), heading octant, length: seven u16 values
const SEGMENT_SIZE = 14;

/** The racing line of a track: a closed chain of segments in driving order. */
export function parseRoad(bytes: Uint8Array): RoadSegment[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= COUNT_SIZE ? view.getUint16(0, true) : 0;
  if (count === 0 || bytes.length < COUNT_SIZE + count * SEGMENT_SIZE) {
    throw new Error(`Road data of ${bytes.length} bytes cannot hold its ${count} segments`);
  }
  return Array.from({ length: count }, (_, index) => {
    const offset = COUNT_SIZE + index * SEGMENT_SIZE;
    return {
      from: { x: view.getUint16(offset, true), y: view.getUint16(offset + 2, true) },
      to: { x: view.getUint16(offset + 4, true), y: view.getUint16(offset + 6, true) },
    };
  });
}
