import { expect, test } from 'vitest';
import { getFile } from '../formats/archive';
import { openGameArchive } from '../formats/gameArchive.testhelper';
import { parseVelocityTable } from '../formats/raceData';
import { parseRoad } from '../formats/road';
import { AMATEUR, type Opponent, type Race, STUN_TICKS, type Situation, createOpponent, stepOpponent } from './opponent';
import { buildRails } from './rails';
import { ORIGINAL_TICKS_PER_SECOND } from './timing';

const TICK = 1 / 70;
const ONE_ORIGINAL_TICK = 1 / ORIGINAL_TICKS_PER_SECOND;
const CRUISE_PIXELS_PER_TICK = 36;
const LEVEL_WITH_PLAYER: Situation = { playerLead: 0, playerPosition: 8, isCrowded: false };
const ON_THE_LINE = { x: 254, y: 800 };

function amateurRaceOnTrackOne(): Race {
  const archive = openGameArchive();
  return {
    rails: buildRails(parseRoad(getFile(archive, '1.RD'))),
    velocity: parseVelocityTable(getFile(archive, 'VEL.TAB')),
    difficulty: AMATEUR,
  };
}

function raceFor(seconds: number, start: Opponent, race: Race, situation = LEVEL_WITH_PLAYER): Opponent {
  let opponent = start;
  for (let elapsed = 0; elapsed < seconds; elapsed += TICK) {
    opponent = stepOpponent(opponent, race, situation, TICK);
  }
  return opponent;
}

function cruising(slot: number, race: Race): Opponent {
  return { ...createOpponent(slot, ON_THE_LINE, race), phase: 'cruise', phaseTicksLeft: 0 };
}

function pixelsPerTickOver(seconds: number, start: Opponent, race: Race, situation: Situation): number {
  const end = raceFor(seconds, start, race, situation);
  return (end.distance - start.distance) / (seconds * ORIGINAL_TICKS_PER_SECOND);
}

test('starts on its grid slot and merges sideways onto the racing line', () => {
  const race = amateurRaceOnTrackOne();
  const onGrid = createOpponent(3, { x: 320, y: 896 }, race);

  const later = raceFor(3, onGrid, race);

  expect(onGrid.x).toBeCloseTo(320, 0);
  expect(onGrid.y).toBeCloseTo(896, 0);
  expect(later.lateral).toBe(0);
});

test('goes through start and launch, then settles into the cruise', () => {
  const race = amateurRaceOnTrackOne();
  const onGrid = createOpponent(1, ON_THE_LINE, race);

  expect(raceFor(1, onGrid, race).phase).toBe('start');
  expect(raceFor(3, onGrid, race).phase).toBe('launch');
  expect(raceFor(6, onGrid, race).phase).toBe('cruise');
});

test('cruises at the velocity table speed for the difficulty', () => {
  const race = amateurRaceOnTrackOne();

  expect(pixelsPerTickOver(2, cruising(2, race), race, LEVEL_WITH_PLAYER)).toBeCloseTo(CRUISE_PIXELS_PER_TICK, 0);
});

test('grid slots further forward get a bigger head start', () => {
  const race = amateurRaceOnTrackOne();

  const backMarker = raceFor(8, createOpponent(1, ON_THE_LINE, race), race);
  const frontRunner = raceFor(8, createOpponent(7, ON_THE_LINE, race), race);

  expect(frontRunner.distance).toBeGreaterThan(backMarker.distance);
});

test('a front runner speeds up when the player gets far ahead, a back marker never does', () => {
  const race = amateurRaceOnTrackOne();
  const playerFarAhead: Situation = { playerLead: 20, playerPosition: 4, isCrowded: false };

  expect(pixelsPerTickOver(2, cruising(7, race), race, playerFarAhead)).toBeGreaterThan(CRUISE_PIXELS_PER_TICK + 30);
  expect(pixelsPerTickOver(2, cruising(2, race), race, playerFarAhead)).toBeCloseTo(CRUISE_PIXELS_PER_TICK, 0);
});

test('catching up stops once the gap has closed', () => {
  const race = amateurRaceOnTrackOne();
  const chasing: Opponent = { ...cruising(7, race), phase: 'catchUp', boostSpeed: 76 };

  expect(stepOpponent(chasing, race, LEVEL_WITH_PLAYER, TICK).phase).toBe('cruise');
});

test('front runners push a little harder while the player leads the race', () => {
  const race = amateurRaceOnTrackOne();
  const playerLeads: Situation = { playerLead: 0, playerPosition: 1, isCrowded: false };

  expect(pixelsPerTickOver(2, cruising(7, race), race, playerLeads)).toBeCloseTo(CRUISE_PIXELS_PER_TICK + 5, 0);
});

test('hops ahead when crowded by another opponent', () => {
  const race = amateurRaceOnTrackOne();
  const crowded: Situation = { ...LEVEL_WITH_PLAYER, isCrowded: true };
  const start = cruising(2, race);

  const alone = stepOpponent(start, race, LEVEL_WITH_PLAYER, ONE_ORIGINAL_TICK);
  const hopped = stepOpponent(start, race, crowded, ONE_ORIGINAL_TICK);

  expect(hopped.distance - alone.distance).toBeCloseTo(60);
});

test('keeps lapping the track on its rails', () => {
  const race = amateurRaceOnTrackOne();

  const later = raceFor(60, createOpponent(4, ON_THE_LINE, race), race);

  expect(later.distance / race.rails.totalPoints).toBeGreaterThan(3);
  expect(later.x).toBeGreaterThan(0);
});

test('a hit opponent stands still for 33 ticks, then drives on', () => {
  const race = amateurRaceOnTrackOne();
  const hit: Opponent = { ...cruising(3, race), stunTicksLeft: STUN_TICKS };

  const duringStun = raceFor(2, hit, race);
  const afterStun = raceFor(4, hit, race);

  expect(duringStun.distance).toBe(hit.distance);
  expect(afterStun.distance).toBeGreaterThan(hit.distance);
});
