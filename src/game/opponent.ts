import { type Rails, railPosition } from './rails';
import { ORIGINAL_TICKS_PER_SECOND } from './timing';

export type Difficulty = {
  /** throttle value the field cruises at (B in docs/opponent-logic.md) */
  cruiseThrottle: number;
  /** how many checkpoints the player must lead by before the back markers start catching up (T) */
  catchUpGap: number;
};

export type Race = {
  rails: Rails;
  /** pixels per original tick for each throttle value */
  velocity: number[];
  difficulty: Difficulty;
};

export type Situation = {
  /** checkpoints the player is ahead of this opponent; negative when behind */
  playerLead: number;
  playerPosition: number;
  /** another opponent is within CROWDED_DISTANCE */
  isCrowded: boolean;
};

export type Opponent = {
  /** grid slot 1..7; slot 0 is the player */
  slot: number;
  phase: 'start' | 'launch' | 'cruise' | 'catchUp';
  phaseTicksLeft: number;
  /** pixels per tick used by the launch and catch-up phases */
  boostSpeed: number;
  /** path points travelled along the rails */
  distance: number;
  /** pixels still to merge sideways (x only) from the grid slot onto the racing line */
  lateral: number;
  /** ticks left standing still after being hit by a weapon */
  stunTicksLeft: number;
  x: number;
  y: number;
  heading: number;
};

type Point = { x: number; y: number };

// Everything below is the opponent logic of WW.EXE as documented in docs/opponent-logic.md (sections 3-5).
// Opponents ride the racing line like a rail: they never steer, brake or look at the ground.
export const AMATEUR: Difficulty = { cruiseThrottle: 0x59, catchUpGap: 8 };
export const CROWDED_DISTANCE = 20;
const LAST_SLOT = 7;
const START_TICKS = 24;
const LAUNCH_TICKS = [22, 28, 30, 34, 40, 50, 58, 60];
const SLOT_SPEED_STEP = 10;
const MERGE_PER_TICK = 4;
const OVERTAKE_HOP = 60;
export const STUN_TICKS = 33;
const FIRST_CATCH_UP_SLOT = 4;
const CATCH_UP_BONUS: Record<number, number> = { 4: 16, 5: 28, 6: 36, 7: 40 };
// extra pixels per tick for slots 5, 6, 7 while the player holds 1st, 2nd or 3rd place
const POSITION_BONUS: Record<number, Record<number, number>> = {
  1: { 5: 3, 6: 4, 7: 5 },
  2: { 5: 3, 6: 2, 7: 1 },
  3: { 5: 2, 6: 1 },
};

function slotsFromBack(slot: number): number {
  return LAST_SLOT - slot;
}

function placed(opponent: Opponent, rails: Rails): Opponent {
  const position = railPosition(rails, opponent.distance);
  return { ...opponent, x: position.x + opponent.lateral, y: position.y, heading: position.heading };
}

export function createOpponent(slot: number, grid: Point, race: Race): Opponent {
  const lineStart = race.rails.rails[0].from;
  const launchThrottle = race.difficulty.cruiseThrottle + 60 - SLOT_SPEED_STEP * slotsFromBack(slot);
  return placed(
    {
      slot,
      phase: 'start',
      phaseTicksLeft: START_TICKS,
      boostSpeed: race.velocity[launchThrottle],
      // as in the original, this assumes the first segment runs along y
      distance: Math.abs(lineStart.y - grid.y),
      lateral: grid.x - lineStart.x,
      stunTicksLeft: 0,
      x: grid.x,
      y: grid.y,
      heading: 0,
    },
    race.rails,
  );
}

/** Pixels per tick this tick, plus the phase the opponent is in afterwards. */
function paced(opponent: Opponent, race: Race, situation: Situation, ticks: number): Opponent & { speed: number } {
  const { cruiseThrottle, catchUpGap } = race.difficulty;
  const cruise = race.velocity[cruiseThrottle];
  const isFarBehind = situation.playerLead >= slotsFromBack(opponent.slot) + catchUpGap;
  const phaseTicksLeft = opponent.phaseTicksLeft - ticks;

  if (opponent.phase === 'start') {
    // ponytail: used raw as pixels per tick, exactly as the code reads; looks too fast, check against DOSBox
    const speed = cruiseThrottle - 4 - SLOT_SPEED_STEP * slotsFromBack(opponent.slot);
    const next = phaseTicksLeft <= 0 ? { phase: 'launch' as const, phaseTicksLeft: LAUNCH_TICKS[opponent.slot] } : { phaseTicksLeft };
    return { ...opponent, ...next, speed };
  }
  if (opponent.phase === 'launch') {
    const next = phaseTicksLeft <= 0 ? { phase: 'cruise' as const } : {};
    return { ...opponent, phaseTicksLeft, ...next, speed: opponent.boostSpeed };
  }
  if (opponent.phase === 'catchUp') {
    return { ...opponent, phase: isFarBehind ? 'catchUp' : 'cruise', speed: opponent.boostSpeed };
  }
  if (opponent.slot < FIRST_CATCH_UP_SLOT) {
    return { ...opponent, speed: cruise };
  }
  const positionBonus = POSITION_BONUS[situation.playerPosition]?.[opponent.slot] ?? 0;
  if (isFarBehind) {
    const boostSpeed = cruise + CATCH_UP_BONUS[opponent.slot];
    return { ...opponent, phase: 'catchUp', boostSpeed, speed: boostSpeed + positionBonus };
  }
  return { ...opponent, speed: cruise + positionBonus };
}

export function stepOpponent(opponent: Opponent, race: Race, situation: Situation, dt: number): Opponent {
  const ticks = dt * ORIGINAL_TICKS_PER_SECOND;
  if (opponent.stunTicksLeft > 0) {
    // a hit opponent just stands there, then carries on exactly where its schedule left off
    return { ...opponent, stunTicksLeft: Math.max(0, opponent.stunTicksLeft - ticks) };
  }
  const { speed, ...next } = paced(opponent, race, situation, ticks);
  const isOnLine = opponent.lateral === 0;
  const hop = isOnLine && next.phase === 'cruise' && situation.isCrowded ? OVERTAKE_HOP : 0;
  const merged = Math.max(0, Math.abs(opponent.lateral) - MERGE_PER_TICK * ticks);
  return placed(
    { ...next, distance: opponent.distance + (speed + hop) * ticks, lateral: Math.sign(opponent.lateral) * merged },
    race.rails,
  );
}
