import * as THREE from 'three';
import { type Archive, getFile, parseArchive } from './formats/archive';
import {
  KART_FRAMES_PER_CHARACTER,
  KART_FRAME_HEIGHT,
  KART_FRAME_WIDTH,
  decodeSpriteFrames,
} from './formats/sprite';
import { parseVelocityTable } from './formats/raceData';
import type { TrackObject } from './formats/objects';
import { type Track, loadTrack } from './formats/track';
import type { KartInput, KartState } from './game/kart';
import { AMATEUR } from './game/opponent';
import { type RaceSetup, startRace, stepRace } from './game/race';
import { buildRails } from './game/rails';
import { ORIGINAL_TICKS_PER_SECOND } from './game/timing';
import { HORIZON_START_PIXELS, createHorizonMesh, scrolledHorizon, showHorizonAt } from './render/horizonMesh';
import { drawHud, lapText, loadHudArt } from './render/hud';
import { createHudMesh, disposeScreenMesh, paintHud } from './render/hudMesh';
import { createDustLayer, createProjectileLayer } from './render/raceLayers';
import { kartFrame, opponentFrame } from './render/kartFrame';
import { FOCAL_LENGTH, HORIZON_ROW, SCREEN_HEIGHT, viewWidthFor } from './render/screen';
import { indexedTexture } from './render/texture';
import { createSurroundMesh, createTrackMesh } from './render/trackMesh';

const ARCHIVE_URL = '/WACKY.DAT';
const TRACK_NUMBER = 1;
const CHARACTER = 0;
// camera of the original (docs/re/rendering.md): 124 world pixels behind the kart, about 32 above the ground
const CAMERA_HEIGHT = 32.3;
const CAMERA_DISTANCE = 124;
const CAMERA_FAR = 20000;
// the player's kart is drawn unscaled at that distance, so sprites are this many world pixels per sprite pixel
const SPRITE_WORLD_SCALE = CAMERA_DISTANCE / FOCAL_LENGTH;
const SPRITE_RENDER_ORDER = 2;
// the ground is drawn in blocks of this many screen pixels, for the chunky look of the 320x200 original
const GROUND_PIXEL_SIZE = 3;
const TICK_SECONDS = 1 / 70;
const MAX_FRAME_SECONDS = 0.1;
const START_HEADING = Math.PI / 2;
const TRANSPARENT_INDEX = 0;
const HANDBRAKE_KEY = ' ';
// the original fires with Ctrl; X is offered too because Ctrl with the arrow keys switches desktops on a Mac
const FIRE_KEYS = ['Control', 'x', 'X'];
const VIEW_COUNT = 8;
// ponytail: the original offers 6, 8 or 10 laps from its menu (10 by default); fixed until there is a menu
const RACE_LAPS = 6;
const STARTING_LIVES = 3;

const pressedKeys = new Set<string>();

function readInput(): KartInput {
  const axis = (negative: string, positive: string): number =>
    (pressedKeys.has(positive) ? 1 : 0) - (pressedKeys.has(negative) ? 1 : 0);
  return {
    throttle: axis('ArrowDown', 'ArrowUp'),
    steer: axis('ArrowLeft', 'ArrowRight'),
    handbrake: pressedKeys.has(HANDBRAKE_KEY),
    fire: FIRE_KEYS.some((key) => pressedKeys.has(key)),
  };
}

function listenToKeyboard(): void {
  window.addEventListener('keydown', (event) => {
    if (event.key.startsWith('Arrow') || event.key === HANDBRAKE_KEY) {
      event.preventDefault();
    }
    pressedKeys.add(event.key);
  });
  window.addEventListener('keyup', (event) => pressedKeys.delete(event.key));
  window.addEventListener('blur', () => pressedKeys.clear());
}

async function fetchArchive(): Promise<Archive> {
  const response = await fetch(ARCHIVE_URL);
  if (!response.ok) {
    throw new Error(`Could not load ${ARCHIVE_URL}: HTTP ${response.status}`);
  }
  return parseArchive(new Uint8Array(await response.arrayBuffer()));
}

function createKartTextures(archive: Archive, track: Track, character: number): THREE.DataTexture[] {
  const frames = decodeSpriteFrames(getFile(archive, 'CARS.SP'), KART_FRAME_WIDTH, KART_FRAME_HEIGHT);
  const first = character * KART_FRAMES_PER_CHARACTER;
  return frames.slice(first, first + KART_FRAMES_PER_CHARACTER).map((pixels) =>
    indexedTexture({
      pixels,
      palette: track.palette,
      width: KART_FRAME_WIDTH,
      height: KART_FRAME_HEIGHT,
      transparentIndex: TRANSPARENT_INDEX,
      topRowFirst: true,
    }),
  );
}

function createRaceSetup(archive: Archive, track: Track): RaceSetup {
  return {
    race: {
      rails: buildRails(track.road),
      velocity: parseVelocityTable(getFile(archive, 'VEL.TAB')),
      difficulty: AMATEUR,
    },
    ground: track,
    progressMap: track.progressMap,
    objects: track.objects,
    laps: RACE_LAPS,
  };
}

/** A standing object (tyre stack, obstacle, pickup) as a billboard on the ground. Shows its first frame. */
function createObjectSprite(object: TrackObject, track: Track): THREE.Sprite {
  const texture = indexedTexture({
    pixels: object.frames[0],
    palette: track.palette,
    width: object.width,
    height: object.height,
    transparentIndex: TRANSPARENT_INDEX,
    topRowFirst: true,
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, alphaTest: 0.5 }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(object.width * SPRITE_WORLD_SCALE, object.height * SPRITE_WORLD_SCALE, 1);
  sprite.position.set(object.x, 0, object.y);
  sprite.renderOrder = SPRITE_RENDER_ORDER;
  return sprite;
}

function createKartSprite(): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ alphaTest: 0.5 }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(KART_FRAME_WIDTH * SPRITE_WORLD_SCALE, KART_FRAME_HEIGHT * SPRITE_WORLD_SCALE, 1);
  sprite.renderOrder = SPRITE_RENDER_ORDER;
  return sprite;
}

function createCamera(): THREE.PerspectiveCamera {
  const fieldOfView = THREE.MathUtils.radToDeg(2 * Math.atan(HORIZON_ROW / FOCAL_LENGTH));
  const camera = new THREE.PerspectiveCamera(fieldOfView, 1, 1, CAMERA_FAR);
  camera.rotation.order = 'YXZ';
  return camera;
}

/** Frames a view this many original pixels wide, keeping the original's height and lens. */
function frameView(camera: THREE.PerspectiveCamera, viewWidth: number): void {
  // The camera looks level, yet the horizon is below the middle of the screen. So frame a taller picture that
  // has the horizon in its middle and show only its top 200 rows.
  const fullHeight = 2 * HORIZON_ROW;
  camera.aspect = viewWidth / fullHeight;
  camera.setViewOffset(viewWidth, fullHeight, 0, 0, viewWidth, SCREEN_HEIGHT);
}

function followKart(camera: THREE.PerspectiveCamera, kart: KartState): void {
  camera.position.set(
    kart.x - Math.cos(kart.heading) * CAMERA_DISTANCE,
    CAMERA_HEIGHT,
    kart.y - Math.sin(kart.heading) * CAMERA_DISTANCE,
  );
  camera.rotation.y = -kart.heading - Math.PI / 2;
}

function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  return renderer;
}

function startGame(canvas: HTMLCanvasElement, archive: Archive): void {
  const track = loadTrack(archive, TRACK_NUMBER);
  const scene = new THREE.Scene();
  scene.background = indexedTexture({ ...track.background, topRowFirst: true });
  const camera = createCamera();
  const groundPixels = { resolution: new THREE.Vector2(), blockSize: GROUND_PIXEL_SIZE * window.devicePixelRatio };
  scene.add(createSurroundMesh(track), createTrackMesh(track, camera, groundPixels));
  const objectSprites = track.objects.map((object) => createObjectSprite(object, track));
  scene.add(...objectSprites);
  const spriteStyle = { scale: SPRITE_WORLD_SCALE, renderOrder: SPRITE_RENDER_ORDER };
  const projectileLayer = createProjectileLayer(archive, track, spriteStyle);
  const dustLayer = createDustLayer(track, { ...spriteStyle, renderOrder: SPRITE_RENDER_ORDER + 1 });
  scene.add(projectileLayer.group, dustLayer.group);

  const kartTextures = createKartTextures(archive, track, CHARACTER);
  const kartSprite = createKartSprite();
  scene.add(kartSprite);

  const setup = createRaceSetup(archive, track);
  let race = startRace(track.startPositions, START_HEADING, setup);
  // ponytail: opponent n drives character n; which character the original puts in which slot is not decoded
  const opponentTextures = race.entrants.map((_, index) => createKartTextures(archive, track, index + 1));
  const opponentSprites = race.entrants.map(() => createKartSprite());
  scene.add(...opponentSprites);

  let viewWidth = viewWidthFor(canvas.clientWidth, canvas.clientHeight);
  frameView(camera, viewWidth);
  let horizon = createHorizonMesh(track, viewWidth);
  let hud = createHudMesh(viewWidth);
  camera.add(horizon, hud);
  let horizonPixels = HORIZON_START_PIXELS;
  let headingLastFrame = START_HEADING;
  const hudArt = loadHudArt(archive);
  scene.add(camera);
  const renderer = createRenderer(canvas);
  const fitCanvas = (): void => {
    const width = viewWidthFor(canvas.clientWidth, canvas.clientHeight);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    if (width === viewWidth) {
      return;
    }
    viewWidth = width;
    frameView(camera, viewWidth);
    [horizon, hud].forEach((mesh) => {
      camera.remove(mesh);
      disposeScreenMesh(mesh);
    });
    horizon = createHorizonMesh(track, viewWidth);
    hud = createHudMesh(viewWidth);
    camera.add(horizon, hud);
  };
  let previousTime = performance.now();
  let pendingSeconds = 0;
  let steerHeld = { direction: 0, seconds: 0 };

  const renderFrame = (time: number): void => {
    fitCanvas();
    const frameSeconds = Math.min(MAX_FRAME_SECONDS, (time - previousTime) / 1000);
    pendingSeconds += frameSeconds;
    previousTime = time;
    const input = readInput();
    steerHeld = {
      direction: input.steer,
      seconds: input.steer === steerHeld.direction ? steerHeld.seconds + frameSeconds : 0,
    };
    while (pendingSeconds >= TICK_SECONDS) {
      race = stepRace(race, input, setup, TICK_SECONDS);
      pendingSeconds -= TICK_SECONDS;
    }

    const { kart } = race;
    kartSprite.position.set(kart.x, kart.height, kart.y);
    kartSprite.material.map = kartTextures[kartFrame(input.steer, steerHeld.seconds)];
    race.entrants.forEach(({ opponent }, index) => {
      const sprite = opponentSprites[index];
      sprite.position.set(opponent.x, 0, opponent.y);
      // a hit opponent spins on the spot through its eight views
      const frame = opponent.stunTicksLeft > 0 ? Math.floor(opponent.stunTicksLeft) % VIEW_COUNT : opponentFrame(kart.heading, opponent.heading);
      sprite.material.map = opponentTextures[index][frame];
    });
    objectSprites.forEach((sprite, index) => {
      sprite.visible = !race.objectsGone[index];
    });
    projectileLayer.show(race.projectiles);
    dustLayer.show({ kart, ticks: race.clockSeconds * ORIGINAL_TICKS_PER_SECOND });
    followKart(camera, kart);
    horizonPixels = scrolledHorizon(horizonPixels, kart.heading - headingLastFrame);
    headingLastFrame = kart.heading;
    showHorizonAt(horizon, track, horizonPixels);
    const hudPicture = drawHud(hudArt, {
      position: race.kartPosition,
      lives: STARTING_LIVES,
      hedgehogs: race.inventory.hedgehogs,
      heldWeapon: race.inventory.heldWeapon,
      // the original speedometer reads twice the speed in pixels per tick (its smoothing is not ported)
      speed: (2 * Math.abs(kart.speed)) / ORIGINAL_TICKS_PER_SECOND,
      lapText: lapText(race.kartProgress.lap, RACE_LAPS, race.isFinished),
      clockTenths: race.clockSeconds * 10,
    }, viewWidth);
    paintHud(hud, hudPicture, track.palette);
    renderer.getDrawingBufferSize(groundPixels.resolution);
    renderer.render(scene, camera);
    requestAnimationFrame(renderFrame);
  };
  requestAnimationFrame(renderFrame);
}

function showError(error: unknown): void {
  const status = document.querySelector<HTMLElement>('#status');
  if (status) {
    status.textContent = `Could not start the game: ${error instanceof Error ? error.message : String(error)}`;
    status.hidden = false;
  }
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#screen');
  if (!canvas) {
    throw new Error('Canvas #screen is missing from the page');
  }
  listenToKeyboard();
  startGame(canvas, await fetchArchive());
}

main().catch(showError);
