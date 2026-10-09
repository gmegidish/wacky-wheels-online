export const KART_FRAME_WIDTH = 38;
export const KART_FRAME_HEIGHT = 28;
export const KART_FRAMES_PER_CHARACTER = 12;

/** Frames are stored column by column; returns them row by row. */
export function decodeSpriteFrames(bytes: Uint8Array, width: number, height: number): Uint8Array[] {
  const frameSize = width * height;
  if (bytes.length === 0 || bytes.length % frameSize !== 0) {
    throw new Error(`${bytes.length} bytes is not a whole number of ${width}x${height} frames`);
  }
  return Array.from({ length: bytes.length / frameSize }, (_, index) => {
    const stored = bytes.subarray(index * frameSize, (index + 1) * frameSize);
    const frame = new Uint8Array(frameSize);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        frame[y * width + x] = stored[x * height + y];
      }
    }
    return frame;
  });
}
