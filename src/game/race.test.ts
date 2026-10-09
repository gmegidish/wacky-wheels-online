import { expect, test } from 'vitest';
import { getFile } from '../formats/archive';
import { openGameArchive } from '../formats/gameArchive.testhelper';
import { parseVelocityTable } from '../formats/raceData';
import { loadTrack } from '../formats/track';
import type { KartInput } from './kart';
import { AMATEUR } from './opponent';
import { type RaceSetup, type RaceState, startRace, stepRace } from './race';
import { buildRails } from './rails';

const TICK = 1 / 70;
const GRID_HEADING = Math.PI / 2;
const HANDS_OFF: KartInput = { throttle: 0, steer: 0, handbrake: false };
const FLAT_OUT: KartInput = { throttle: 1, steer: 0, handbrake: false };

function amateurRaceOnTrackOne(): { setup: RaceSetup; start: RaceState } {
  const archive = openGameArchive();
  const track = loadTrack(archive, 1);
  const setup: RaceSetup = {
    race: {
      rails: buildRails(track.road),
      velocity: parseVelocityTable(getFile(archive, 'VEL.TAB')),
      difficulty: AMATEUR,
    },
    ground: track,
    progressMap: track.progressMap,
    objects: [],
    laps: 1,
  };
  return { setup, start: startRace(track.startPositions, GRID_HEADING, setup) };
}

function raceFor(seconds: number, start: RaceState, input: KartInput, setup: RaceSetup): RaceState {
  let state = start;
  for (let elapsed = 0; elapsed < seconds; elapsed += TICK) {
    state = stepRace(state, input, setup, TICK);
  }
  return state;
}

test('the grid holds the player at the back and seven opponents', () => {
  const { start } = amateurRaceOnTrackOne();

  expect(start.entrants.length).toBe(7);
  expect(start.kartPosition).toBe(8);
});

test('a player who never moves is left in last place while every opponent laps the track', () => {
  const { setup, start } = amateurRaceOnTrackOne();

  const later = raceFor(40, start, HANDS_OFF, setup);

  expect(later.kartPosition).toBe(8);
  expect(Math.min(...later.entrants.map(({ progress }) => progress.lap))).toBeGreaterThanOrEqual(2);
});

test('the player completes a lap count when crossing the line', () => {
  const { setup, start } = amateurRaceOnTrackOne();

  const later = raceFor(4, start, FLAT_OUT, setup);

  expect(later.kartProgress.lap).toBe(1);
});

test('opponents are not shoved off their rails by the player', () => {
  const { setup, start } = amateurRaceOnTrackOne();
  const alone = raceFor(5, { ...start, kart: { ...start.kart, x: 1000, y: 1000 } }, HANDS_OFF, setup);

  const withPlayerDrivingThroughThem = raceFor(5, start, FLAT_OUT, setup);

  expect(withPlayerDrivingThroughThem.entrants[0].opponent.distance).toBeCloseTo(alone.entrants[0].opponent.distance, 0);
});

test('a tyre stack in the way stops the player driving through it', () => {
  const { setup, start } = amateurRaceOnTrackOne();
  const tyreStackAhead = { x: start.kart.x, y: start.kart.y + 200 };
  const blockedSetup = { ...setup, objects: [{ ...tyreStackAhead, kind: 1 }] };

  const later = raceFor(1, { ...start, entrants: [], objectsGone: [false] }, FLAT_OUT, blockedSetup);

  expect(later.kart.y).toBeLessThan(tyreStackAhead.y);
});

test('the clock runs during the race and stops once the player has finished the last lap', () => {
  const { setup, start } = amateurRaceOnTrackOne();
  const onTheLastLap: RaceState = { ...start, kartProgress: { lap: 1, checkpoint: start.kartProgress.checkpoint } };

  const racing = raceFor(2, start, FLAT_OUT, setup);
  const finished = raceFor(4, onTheLastLap, FLAT_OUT, setup);
  const longAfter = raceFor(3, finished, FLAT_OUT, setup);

  expect(racing.isFinished).toBe(false);
  expect(racing.clockSeconds).toBeCloseTo(2, 1);
  expect(finished.isFinished).toBe(true);
  expect(longAfter.clockSeconds).toBe(finished.clockSeconds);
});

test('driving over a hedgehog pickup collects it, and it is gone for the rest of the race', () => {
  const { setup, start } = amateurRaceOnTrackOne();
  const pickupAhead = { x: start.kart.x, y: start.kart.y + 150, kind: 2 };
  const withPickup = { ...setup, objects: [pickupAhead] };

  const later = raceFor(2, { ...start, entrants: [], objectsGone: [false] }, FLAT_OUT, withPickup);

  expect(later.inventory.hedgehogs).toBe(4);
  expect(later.objectsGone).toEqual([true]);
});

test('a thrown hedgehog stops the opponent ahead in its tracks', () => {
  const { setup, start } = amateurRaceOnTrackOne();
  const opponentAhead = start.entrants[0].opponent;
  const armed: RaceState = {
    ...start,
    kart: { ...start.kart, x: opponentAhead.x, y: opponentAhead.y - 100 },
    inventory: { ...start.inventory, hedgehogs: 1 },
  };

  const afterShot = raceFor(0.5, armed, { ...HANDS_OFF, fire: true }, setup);

  expect(afterShot.inventory.hedgehogs).toBe(0);
  expect(afterShot.entrants[0].opponent.stunTicksLeft).toBeGreaterThan(0);
  expect(afterShot.entrants[0].opponent.distance).toBeLessThan(opponentAhead.distance + 80);
});

test('side by side in the same checkpoint, the kart further along the road is placed ahead', () => {
  const { setup, start } = amateurRaceOnTrackOne();
  const lastOnGrid = start.entrants[0].opponent;
  const justPastIt: RaceState = { ...start, kart: { ...start.kart, x: lastOnGrid.x + 30, y: lastOnGrid.y + 10 } };
  const justBehindIt: RaceState = { ...start, kart: { ...start.kart, x: lastOnGrid.x + 30, y: lastOnGrid.y - 10 } };

  expect(stepRace(justPastIt, HANDS_OFF, setup, TICK).kartPosition).toBe(7);
  expect(stepRace(justBehindIt, HANDS_OFF, setup, TICK).kartPosition).toBe(8);
});
