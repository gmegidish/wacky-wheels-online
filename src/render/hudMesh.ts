import * as THREE from 'three';
import { toRgba } from '../formats/pcx';
import { HUD_HEIGHT } from './hud';
import { heightOfRow, pixelSizeAt } from './screen';

const DISTANCE = 50;
const TRANSPARENT_INDEX = 0;

/** A see-through sheet fixed in front of the camera that the HUD picture is painted on. Add it to the camera. */
export function createHudMesh(width: number): THREE.Mesh {
  const texture = new THREE.DataTexture(new Uint8Array(width * HUD_HEIGHT * 4), width, HUD_HEIGHT, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  // the picture is stored top row first
  texture.repeat.y = -1;
  texture.offset.y = 1;

  const pixel = pixelSizeAt(DISTANCE);
  const geometry = new THREE.PlaneGeometry(width * pixel, HUD_HEIGHT * pixel);
  geometry.translate(0, heightOfRow(HUD_HEIGHT / 2, DISTANCE), -DISTANCE);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1000;
  return mesh;
}

export function paintHud(mesh: THREE.Mesh, screen: Uint8Array, palette: Uint8Array): void {
  const texture = (mesh.material as THREE.MeshBasicMaterial).map as THREE.DataTexture;
  (texture.image.data as Uint8Array).set(toRgba(screen, palette, TRANSPARENT_INDEX));
  texture.needsUpdate = true;
}

/** Frees the GPU memory of a sheet made by createHudMesh or createHorizonMesh. */
export function disposeScreenMesh(mesh: THREE.Mesh): void {
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.map?.dispose();
  material.dispose();
  mesh.geometry.dispose();
}
