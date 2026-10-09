import * as THREE from 'three';
import type { Track } from '../formats/track';
import { heightOfRow, pixelSizeAt } from './screen';
import { indexedTexture } from './texture';

// From WW.EXE (docs/re/rendering.md section 3): the strip is copied pixel for pixel onto rows 110-129, over
// the far end of the floor. It is not tied to the heading: it slides up to 16 pixels for each 40-unit tick of
// turning and wraps.
const TOP_ROW = 110;
const PIXELS_PER_RADIAN = (16 / 40) * (1920 / (2 * Math.PI));
// ponytail: where the strip starts is read off one screenshot of the track 1 grid, not decoded
export const HORIZON_START_PIXELS = 168;
const DISTANCE = 100;

/** The strip of distant scenery as a flat band fixed to the screen. Add it to the camera, not the scene. */
export function createHorizonMesh(track: Track, viewWidth: number): THREE.Mesh {
  const { horizon } = track;
  const texture = indexedTexture({ ...horizon, topRowFirst: true });
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(viewWidth / horizon.width, 1);

  const pixel = pixelSizeAt(DISTANCE);
  const geometry = new THREE.PlaneGeometry(viewWidth * pixel, horizon.height * pixel);
  geometry.translate(0, heightOfRow(TOP_ROW + horizon.height / 2, DISTANCE), -DISTANCE);

  // drawn after the floor and before the sprites, and ignored by the depth buffer
  const material = new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

/** Strip position after the kart has turned by this many radians (positive is to the right). */
export function scrolledHorizon(pixels: number, turned: number): number {
  return pixels + turned * PIXELS_PER_RADIAN;
}

export function showHorizonAt(mesh: THREE.Mesh, track: Track, pixels: number): void {
  const texture = (mesh.material as THREE.MeshBasicMaterial).map;
  if (texture) {
    texture.offset.x = pixels / track.horizon.width;
  }
}
