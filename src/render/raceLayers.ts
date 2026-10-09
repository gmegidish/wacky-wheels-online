import * as THREE from 'three';
import { type Archive, getFile } from '../formats/archive';
import { decodeSpriteFrames } from '../formats/sprite';
import type { Track } from '../formats/track';
import type { KartState } from '../game/kart';
import { type Projectile, projectileFrame } from '../game/weapons';
import { indexedTexture } from './texture';

export type Layer<Shown> = {
  group: THREE.Group;
  show: (shown: Shown) => void;
};

export type SpriteStyle = {
  /** world pixels per sprite pixel */
  scale: number;
  renderOrder: number;
};

export type Dust = {
  kart: KartState;
  /** original ticks since the race began; the puff plays one frame per tick */
  ticks: number;
};

const TRANSPARENT_INDEX = 0;
// HOGMIS.SP: every thrown thing and its explosion, 26 frames of 18x13
const PROJECTILE_WIDTH = 18;
const PROJECTILE_HEIGHT = 13;
// ponytail: the original draws the puff 16 rows down the kart sprite; where across is not decoded, so one sits at each rear wheel
const WHEEL_OFFSET_PIXELS = 13;
const DUST_TOWARDS_CAMERA = 1;

function groundSprite(width: number, height: number, style: SpriteStyle): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ alphaTest: 0.5 }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(width * style.scale, height * style.scale, 1);
  sprite.renderOrder = style.renderOrder;
  return sprite;
}

/** Hedgehogs, flames, mines and their explosions. Sprites are made as needed and reused. */
export function createProjectileLayer(archive: Archive, track: Track, style: SpriteStyle): Layer<Projectile[]> {
  const textures = decodeSpriteFrames(getFile(archive, 'HOGMIS.SP'), PROJECTILE_WIDTH, PROJECTILE_HEIGHT).map((pixels) =>
    indexedTexture({ pixels, palette: track.palette, width: PROJECTILE_WIDTH, height: PROJECTILE_HEIGHT, transparentIndex: TRANSPARENT_INDEX, topRowFirst: true }),
  );
  const group = new THREE.Group();
  const sprites: THREE.Sprite[] = [];
  const show = (projectiles: Projectile[]): void => {
    while (sprites.length < projectiles.length) {
      const sprite = groundSprite(PROJECTILE_WIDTH, PROJECTILE_HEIGHT, style);
      sprites.push(sprite);
      group.add(sprite);
    }
    sprites.forEach((sprite, index) => {
      const projectile = projectiles[index];
      sprite.visible = projectile !== undefined;
      if (projectile) {
        sprite.position.set(projectile.x, 0, projectile.y);
        sprite.material.map = textures[projectileFrame(projectile)];
      }
    });
  };
  return { group, show };
}

/** The puff of dust, smoke or grass at the rear wheels, picked by the surface the kart is on. */
export function createDustLayer(track: Track, style: SpriteStyle): Layer<Dust> {
  const textures = track.wheelEffects.map((effect) =>
    effect?.frames.map((pixels) =>
      indexedTexture({ pixels, palette: track.palette, width: effect.width, height: effect.height, transparentIndex: TRANSPARENT_INDEX, topRowFirst: true }),
    ),
  );
  const group = new THREE.Group();
  const puffs = [-1, 1].map((side) => ({ side, sprite: groundSprite(1, 1, style) }));
  group.add(...puffs.map(({ sprite }) => sprite));

  const show = ({ kart, ticks }: Dust): void => {
    const surface = track.surfaceAt(kart.x, kart.y);
    const effect = track.wheelEffects[surface];
    const frames = textures[surface];
    const isKickingUp = kart.speed > 0 && kart.airSecondsLeft === 0 && effect !== undefined && frames !== undefined;
    puffs.forEach(({ side, sprite }) => {
      sprite.visible = isKickingUp;
      if (!isKickingUp) {
        return;
      }
      const sideways = side * WHEEL_OFFSET_PIXELS * style.scale;
      sprite.scale.set(effect.width * style.scale, effect.height * style.scale, 1);
      sprite.position.set(
        kart.x - Math.sin(kart.heading) * sideways - Math.cos(kart.heading) * DUST_TOWARDS_CAMERA,
        0,
        kart.y + Math.cos(kart.heading) * sideways - Math.sin(kart.heading) * DUST_TOWARDS_CAMERA,
      );
      sprite.material.map = frames[Math.floor(ticks) % frames.length];
    });
  };
  return { group, show };
}
