export type IndexedImage = {
  width: number;
  height: number;
  pixels: Uint8Array;
  /** 256 RGB triplets */
  palette: Uint8Array;
};

const HEADER_SIZE = 128;
const PALETTE_SIZE = 768;
const PALETTE_MARKER = 0x0c;
const MANUFACTURER = 0x0a;
const RUN_FLAG = 0xc0;
const RUN_LENGTH_MASK = 0x3f;

function decodeRuns(bytes: Uint8Array, start: number, end: number, length: number): Uint8Array {
  const decoded = new Uint8Array(length);
  let source = start;
  let target = 0;
  while (target < length) {
    if (source >= end) {
      throw new Error('PCX pixel data ends early');
    }
    const byte = bytes[source++];
    if (byte >= RUN_FLAG) {
      const run = byte & RUN_LENGTH_MASK;
      decoded.fill(bytes[source++], target, target + run);
      target += run;
    } else {
      decoded[target++] = byte;
    }
  }
  return decoded;
}

export function decodePcx(bytes: Uint8Array): IndexedImage {
  const paletteStart = bytes.length - PALETTE_SIZE;
  const isEightBitPcx =
    bytes.length > HEADER_SIZE + PALETTE_SIZE &&
    bytes[0] === MANUFACTURER &&
    bytes[3] === 8 &&
    bytes[65] === 1 &&
    bytes[paletteStart - 1] === PALETTE_MARKER;
  if (!isEightBitPcx) {
    throw new Error('Not an 8-bit PCX image with a palette');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const bytesPerLine = view.getUint16(66, true);
  const lines = decodeRuns(bytes, HEADER_SIZE, paletteStart - 1, bytesPerLine * height);

  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    pixels.set(lines.subarray(y * bytesPerLine, y * bytesPerLine + width), y * width);
  }
  return { width, height, pixels, palette: bytes.subarray(paletteStart) };
}

export function toRgba(pixels: Uint8Array, palette: Uint8Array, transparentIndex = -1): Uint8Array {
  const rgba = new Uint8Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const colour = pixels[i] * 3;
    rgba[i * 4] = palette[colour];
    rgba[i * 4 + 1] = palette[colour + 1];
    rgba[i * 4 + 2] = palette[colour + 2];
    rgba[i * 4 + 3] = pixels[i] === transparentIndex ? 0 : 255;
  }
  return rgba;
}
