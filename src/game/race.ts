import { type ProgressMap, checkpointAt } from '../formats/raceData';
import { pushClearOf } from './collision';
import { type Ground, type KartInput, type KartState, stepKart } from './kart';
import { CROWDED_DISTANCE, type Opponent, type Race, STUN_TICKS, createOpponent, stepOpponent } from './opponent';
import { type Progress, checkpointsCovered, nextProgress } from './progress';
import { isFurtherRound, railDistanceOf } from './rails';
import { EMPTY_HANDED, type Inventory, type Projectile, collected, pressFire, stepProjectiles } from './weapons';

type Point = { x: number; y: number };

type Standing = {
  /** checkpoints covered since the start */
  covered: number;
  /** distance round the racing line, to split karts inside the same checkpoint */
  railDistance: number;
};

export type RaceObject = Point & {
  /** 0 solid obstacle, 1 tyre stack, 2 hedgehog ammo, 3-7 special weapon */
  kind: number;
};

export type Entrant = {
  opponent: Opponent;
  progress: Progress;
};

export type RaceState = {
  kart: KartState;
  kartProgress: Progress;
  /** 1 for the leader, counting the player and every opponent */
  kartPosition: number;
  /** race time; stops when the player finishes */
  clockSeconds: number;
  /** the player has crossed the line at the end of the last lap */
  isFinished: boolean;
  entrants: Entrant[];
  inventory: Inventory;
  projectiles: Projectile[];
  /** one flag per track object: true once it has been picked up */
  objectsGone: boolean[];
};

export type RaceSetup = {
  race: Race;
  ground: Ground;
  progressMap: ProgressMap;
  /** obstacles and pickups standing on the track */
  objects: RaceObject[];
  /** laps in the race; the player finishes on the line crossing that would start lap laps + 1 */
  laps: number;
};

const PICKUP_DISTANCE = 14;
const LAST_OBSTACLE_KIND = 1;

function progressAt(previous: Progress, at: Point, map: ProgressMap): Progress {
  return nextProgress(previous, checkpointAt(map, at.x, at.y), map.lastCheckpoint);
}

function isCrowded(opponent: Opponent, entrants: Entrant[]): boolean {
  return entrants.some(
    ({ opponent: other }) =>
      other !== opponent && Math.abs(other.x - opponent.x) + Math.abs(other.y - opponent.y) < CROWDED_DISTANCE,
  );
}

/**
 * 1 for the leader. Checkpoints decide it, as in the original; karts inside the same checkpoint are split by
 * how far round the racing line they are, which the original leaves to chance.
 */
function positionOf(own: Standing, others: Standing[], setup: RaceSetup): number {
  const ahead = others.filter(
    (other) =>
      other.covered > own.covered ||
      (other.covered === own.covered && isFurtherRound(setup.race.rails, other.railDistance, own.railDistance)),
  );
  return 1 + ahead.length;
}

/** The player takes the first grid slot (the back of the grid); opponents fill slots 1 and up. */
export function startRace(grid: Point[], heading: number, setup: RaceSetup): RaceState {
  const [playerSlot, ...opponentSlots] = grid;
  const standingStart = { lap: 0, checkpoint: 0 };
  return {
    kart: { x: playerSlot.x, y: playerSlot.y, heading, speed: 0, height: 0, airSecondsLeft: 0, handbrakeTurnLeft: 0 },
    kartProgress: progressAt(standingStart, playerSlot, setup.progressMap),
    kartPosition: grid.length,
    clockSeconds: 0,
    isFinished: false,
    entrants: opponentSlots.map((slot, index) => ({
      opponent: createOpponent(index + 1, slot, setup.race),
      progress: progressAt(standingStart, slot, setup.progressMap),
    })),
    inventory: EMPTY_HANDED,
    projectiles: [],
    objectsGone: setup.objects.map(() => false),
  };
}

/** Picks up whatever pickup the kart is touching, if it can take it. */
function gathered(state: RaceState, kart: KartState, setup: RaceSetup): Pick<RaceState, 'inventory' | 'objectsGone'> {
  const touched = setup.objects.findIndex(
    (object, index) =>
      object.kind > LAST_OBSTACLE_KIND &&
      !state.objectsGone[index] &&
      kart.airSecondsLeft === 0 &&
      Math.abs(object.x - kart.x) + Math.abs(object.y - kart.y) < PICKUP_DISTANCE,
  );
  const inventory = touched === -1 ? undefined : collected(state.inventory, setup.objects[touched].kind);
  if (!inventory) {
    // ponytail: in the original a pickup the kart cannot take bumps it like an obstacle; here it is driven through
    return { inventory: state.inventory, objectsGone: state.objectsGone };
  }
  return { inventory, objectsGone: state.objectsGone.map((isGone, index) => isGone || index === touched) };
}

export function stepRace(state: RaceState, input: KartInput, setup: RaceSetup, dt: number): RaceState {
  const { progressMap, ground, race, objects, laps } = setup;
  const standing = objects.filter((_, index) => !state.objectsGone[index]);
  const obstacles = standing.filter(({ kind }) => kind <= LAST_OBSTACLE_KIND);
  const driven = stepKart(state.kart, input, dt, ground);
  // ponytail: obstacles block like opponents do; the original's bump (18 unit turn, spark, tyre stack toppling) is not ported
  const bumped = pushClearOf(driven, [...obstacles, ...state.entrants.map(({ opponent }) => opponent)], ground.isWall);

  const { inventory: gatheredInventory, objectsGone } = gathered(state, bumped, setup);
  const trigger = pressFire(gatheredInventory, input.fire === true, bumped);
  const volley = stepProjectiles([...state.projectiles, ...trigger.fired], {
    ground,
    obstacles: standing,
    opponents: state.entrants.map(({ opponent }) => ({ x: opponent.x, y: opponent.y, isStunned: opponent.stunTicksLeft > 0 })),
    player: bumped,
  }, dt);
  const inventory = { ...trigger.inventory, shotsInFlight: Math.max(0, trigger.inventory.shotsInFlight - volley.shotsEnded) };
  // ponytail: the original spins a human kart for 8 ticks (and one mine reverses the steering); here it just stops dead
  const kart = volley.isPlayerHit ? { ...bumped, speed: 0 } : bumped;

  const kartProgress = progressAt(state.kartProgress, kart, progressMap);
  const kartStanding = {
    covered: checkpointsCovered(kartProgress, progressMap.lastCheckpoint),
    railDistance: railDistanceOf(race.rails, kart.x, kart.y),
  };
  const standings = state.entrants.map(({ opponent, progress }) => ({
    covered: checkpointsCovered(progress, progressMap.lastCheckpoint),
    railDistance: opponent.distance,
  }));
  const kartPosition = positionOf(kartStanding, standings, setup);

  const entrants = state.entrants.map(({ opponent, progress }, index) => {
    const situation = {
      playerLead: kartStanding.covered - standings[index].covered,
      playerPosition: kartPosition,
      isCrowded: isCrowded(opponent, state.entrants),
    };
    const struck = volley.opponentsHit.includes(index) ? { ...opponent, stunTicksLeft: STUN_TICKS } : opponent;
    const moved = stepOpponent(struck, race, situation, dt);
    return { opponent: moved, progress: progressAt(progress, moved, progressMap) };
  });
  const isFinished = state.isFinished || kartProgress.lap > laps;
  const clockSeconds = isFinished ? state.clockSeconds : state.clockSeconds + dt;
  return { kart, kartProgress, kartPosition, clockSeconds, isFinished, entrants, inventory, projectiles: volley.projectiles, objectsGone };
}
