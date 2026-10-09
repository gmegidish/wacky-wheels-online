import * as THREE from 'three';
import { toRgba } from '../formats/pcx';

export type IndexedPixels = {
  pixels: Uint8Array;
  palette: Uint8Array;
  width: number;
  height: number;
  transparentIndex?: number;
  /** flip so the first stored row ends up at the top of the texture */
  topRowFirst?: boolean;
};

function flipRows(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = width * 4;
  const flipped = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y++) {
    flipped.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), (height - 1 - y) * rowBytes);
  }
  return flipped;
}

export function indexedTexture(image: IndexedPixels): THREE.DataTexture {
  const rgba = toRgba(image.pixels, image.palette, image.transparentIndex);
  const data = image.topRowFirst ? flipRows(rgba, image.width, image.height) : rgba;
  const texture = new THREE.DataTexture(data, image.width, image.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
