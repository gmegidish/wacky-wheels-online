import * as THREE from 'three';
import { type Track, WORLD_SIZE } from '../formats/track';
import { indexedTexture } from './texture';

export type GroundPixels = {
  /** size of the drawing buffer in device pixels; update it when the canvas resizes */
  resolution: THREE.Vector2;
  /** edge of one ground pixel block, in device pixels */
  blockSize: number;
};

// Each block of screen pixels casts one ray through its centre and the whole block takes the colour where that
// ray meets the ground, as the original's per-pixel ray lookup does at 320x200.
const vertexShader = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform sampler2D map;
uniform vec2 resolution;
uniform float blockSize;
uniform float worldSize;
uniform mat4 cameraWorld;
uniform mat4 projectionInverse;

vec3 worldPointOnScreen(vec2 pixel, float depth) {
  vec4 view = projectionInverse * vec4(pixel / resolution * 2.0 - 1.0, depth, 1.0);
  return (cameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
}

void main() {
  vec2 blockCentre = (floor(gl_FragCoord.xy / blockSize) + 0.5) * blockSize;
  vec3 near = worldPointOnScreen(blockCentre, -1.0);
  vec3 far = worldPointOnScreen(blockCentre, 1.0);
  vec3 ground = near + (far - near) * (near.y / (near.y - far.y));
  vec2 uv = ground.xz / worldSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    discard;
  }
  gl_FragColor = texture2D(map, uv);
  #include <colorspace_fragment>
}
`;

/** Ground plane where map (x, y) sits at scene (x, 0, y), drawn in blocks of screen pixels like the original. */
export function createTrackMesh(track: Track, camera: THREE.Camera, pixels: GroundPixels): THREE.Mesh {
  const texture = indexedTexture({
    pixels: track.floor,
    palette: track.palette,
    width: WORLD_SIZE,
    height: WORLD_SIZE,
  });
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
  // +90deg about X lays the plane flat with texture row 0 at z = 0
  geometry.rotateX(Math.PI / 2);
  geometry.translate(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      map: { value: texture },
      resolution: { value: pixels.resolution },
      blockSize: { value: pixels.blockSize },
      worldSize: { value: WORLD_SIZE },
      // the camera's own matrices, so the shader always sees this frame's view
      cameraWorld: { value: camera.matrixWorld },
      projectionInverse: { value: camera.projectionMatrixInverse },
    },
  });
  return new THREE.Mesh(geometry, material);
}

const SURROUND_SIZE = 40000;
const SURROUND_DEPTH = 0.5;

/** Grass stretching to the horizon, just under the track, so nothing is empty beyond the map edge. */
export function createSurroundMesh(track: Track): THREE.Mesh {
  const [red, green, blue] = track.surroundColour;
  const geometry = new THREE.PlaneGeometry(SURROUND_SIZE, SURROUND_SIZE);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(WORLD_SIZE / 2, -SURROUND_DEPTH, WORLD_SIZE / 2);
  const colour = new THREE.Color().setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
  // drawn first and kept out of the depth buffer, so the track on top never flickers against it
  const material = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  return mesh;
}
