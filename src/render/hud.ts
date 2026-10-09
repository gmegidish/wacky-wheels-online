import { type Archive, getFile } from '../formats/archive';
import { decodeSpriteFrames } from '../formats/sprite';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen';

export type HudArt = {
  positionBox: Uint8Array;
  positionDigits: Uint8Array[];
  livesPanel: Uint8Array;
  hedgehogPanel: Uint8Array;
  smallDigits: Uint8Array[];
  speedometer: Uint8Array;
  speedDigits: Uint8Array[];
  clockGlyphs: Uint8Array[];
  smallFont: Uint8Array[];
  itemIcons: Uint8Array[];
};

export type HudState = {
  /** race position, 1 for the leader */
  position: number;
  lives: number;
  hedgehogs: number;
  /** special weapon carried, 3-8; 0 for none */
  heldWeapon: number;
  /** number on the speedometer, 0-99 */
  speed: number;
  /** empty until the first line crossing */
  lapText: string;
  clockTenths: number;
};

type Size = { width: number; height: number };

export const HUD_HEIGHT = SCREEN_HEIGHT;

// Layout and file offsets of the race HUD as decoded from WW.EXE (docs/re/race-flow-and-hud.md sections 2, 3, 5).
const POSITION_DIGIT: Size = { width: 22, height: 29 };
const POSITION_BOX: Size = { width: 38, height: 41 };
const LIVES_PANEL: Size = { width: 65, height: 19 };
const HEDGEHOG_PANEL: Size = { width: 61, height: 19 };
const SMALL_DIGIT: Size = { width: 10, height: 9 };
const SPEEDOMETER: Size = { width: 42, height: 19 };
const SPEED_DIGIT: Size = { width: 10, height: 15 };
const CLOCK_GLYPH: Size = { width: 7, height: 9 };
const FONT_GLYPH: Size = { width: 8, height: 8 };
const ITEM_ICON: Size = { width: 26, height: 21 };
const FIRST_ITEM = 3;
const FONT_GLYPH_COUNT = 61;
const CLOCK_COLON = 10;
const TRANSPARENT_INDEX = 0;
const FONT_SYMBOLS: Record<string, number> = { '!': 36, '#': 38, '&': 42, '(': 44, ')': 45, '?': 52, '.': 53, ':': 53, ',': 54, '-': 55, '@': 56, "'": 57 };

function cut(file: Uint8Array, offset: number, size: Size, count: number): Uint8Array[] {
  const length = size.width * size.height * count;
  if (offset + length > file.length) {
    throw new Error(`HUD art at offset ${offset} runs past the end of its ${file.length} byte file`);
  }
  return decodeSpriteFrames(file.subarray(offset, offset + length), size.width, size.height);
}

export function loadHudArt(archive: Archive): HudArt {
  const lap = getFile(archive, 'LAP.SP');
  const icons = getFile(archive, 'ICONS.SP');
  return {
    positionDigits: cut(lap, 0, POSITION_DIGIT, 8),
    positionBox: cut(lap, 0x377c, POSITION_BOX, 1)[0],
    livesPanel: cut(lap, 0x3d92, LIVES_PANEL, 1)[0],
    hedgehogPanel: cut(lap, 0x4265, HEDGEHOG_PANEL, 1)[0],
    smallDigits: cut(lap, 0x46ec, SMALL_DIGIT, 10),
    itemIcons: cut(icons, 0, ITEM_ICON, 6),
    speedometer: cut(icons, 0xccc, SPEEDOMETER, 1)[0],
    speedDigits: cut(icons, 0xfea, SPEED_DIGIT, 10),
    clockGlyphs: cut(getFile(archive, 'GENEF.SP'), 0x35a5, CLOCK_GLYPH, 11),
    smallFont: cut(getFile(archive, 'OFONT.SP'), 0, FONT_GLYPH, FONT_GLYPH_COUNT),
  };
}

function fontGlyph(character: string): number | undefined {
  if (character >= 'A' && character <= 'Z') {
    return character.charCodeAt(0) - 'A'.charCodeAt(0);
  }
  if (character >= '0' && character <= '9') {
    return 26 + Number(character);
  }
  return FONT_SYMBOLS[character];
}

function twoDigits(value: number): [number, number] {
  const shown = Math.max(0, Math.min(99, Math.floor(value)));
  return [Math.floor(shown / 10), shown % 10];
}

/**
 * The race HUD as one picture of palette indices, width x 200; index 0 is see-through. The clock and the held item
 * sit at the right edge of the original 320 wide screen, so on a wider view they move out to the new edge.
 */
export function drawHud(art: HudArt, state: HudState, width: number): Uint8Array {
  const screen = new Uint8Array(width * HUD_HEIGHT);
  const rightEdgeShift = width - SCREEN_WIDTH;
  const blit = (frame: Uint8Array, size: Size, x: number, y: number): void => {
    for (let row = 0; row < size.height; row++) {
      for (let column = 0; column < size.width; column++) {
        const pixel = frame[row * size.width + column];
        if (pixel !== TRANSPARENT_INDEX) {
          screen[(y + row) * width + x + column] = pixel;
        }
      }
    }
  };

  blit(art.positionBox, POSITION_BOX, 17, 6);
  blit(art.positionDigits[Math.max(1, Math.min(8, state.position)) - 1], POSITION_DIGIT, 25, 12);
  blit(art.livesPanel, LIVES_PANEL, 68, 6);
  blit(art.smallDigits[twoDigits(state.lives)[1]], SMALL_DIGIT, 118, 11);
  blit(art.hedgehogPanel, HEDGEHOG_PANEL, 146, 6);
  twoDigits(state.hedgehogs).forEach((digit, index) => blit(art.smallDigits[digit], SMALL_DIGIT, 181 + index * 10, 11));
  blit(art.speedometer, SPEEDOMETER, 0, 181);
  twoDigits(state.speed).forEach((digit, index) => blit(art.speedDigits[digit], SPEED_DIGIT, 3 + index * 12, 183));

  const itemIcon = art.itemIcons[state.heldWeapon - FIRST_ITEM];
  if (itemIcon) {
    blit(itemIcon, ITEM_ICON, 293 + rightEdgeShift, 178);
  }

  [...state.lapText].forEach((character, index) => {
    const glyph = fontGlyph(character);
    if (glyph !== undefined) {
      blit(art.smallFont[glyph], FONT_GLYPH, 4 + index * FONT_GLYPH.width, 164);
    }
  });

  const tenths = Math.max(0, Math.floor(state.clockTenths));
  const [minuteTens, minuteOnes] = twoDigits(Math.floor(tenths / 600));
  const [secondTens, secondOnes] = twoDigits(Math.floor(tenths / 10) % 60);
  [minuteTens, minuteOnes, CLOCK_COLON, secondTens, secondOnes, CLOCK_COLON, tenths % 10].forEach((glyph, index) =>
    blit(art.clockGlyphs[glyph], CLOCK_GLYPH, 264 + rightEdgeShift + index * CLOCK_GLYPH.width, 112),
  );
  return screen;
}

/** "LAP n" from the first line crossing, then the last-lap and finished notices. */
export function lapText(lap: number, laps: number, isFinished: boolean): string {
  if (isFinished) {
    return 'FINISHED!';
  }
  if (lap < 1) {
    return '';
  }
  return lap < laps ? `LAP ${lap}` : 'LAST LAP!';
}
