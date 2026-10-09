import { ORIGINAL_TICKS_PER_SECOND } from './timing';

export type KartState = {
  x: number;
  y: number;
  /** radians; 0 points along +x, increasing turns clockwise on the map */
  heading: number;
  /** world pixels per second the throttle is asking for, before the surface slows it */
  speed: number;
  /** world pixels above the ground */
  height: number;
  /** seconds of the current jump still to go; 0 on the ground */
  airSecondsLeft: number;
  /** signed radians still to swing in the current hand brake turn; negative is left */
  handbrakeTurnLeft: number;
};

export type KartInput = {
  /** -1 brake .. 1 accelerate */
  throttle: number;
  /** -1 left .. 1 right */
  steer: number;
  handbrake: boolean;
  fire?: boolean;
};

export type SurfaceProbe = (x: number, y: number) => boolean;

export type Ground = {
  isWall: SurfaceProbe;
  isJump: SurfaceProbe;
  /** share of the speed the surface takes away, 0 on plain road */
  dragAt: (x: number, y: number) => number;
};

type Turning = Pick<KartState, 'heading' | 'handbrakeTurnLeft'>;

// The player's kart as WW.EXE drives it (docs/re/player-physics.md), converted from per-tick to per-second.
// Throttle runs 0..100 and VEL.TAB maps it linearly to 0..40 pixels per tick: +10 a tick accelerating,
// -4 coasting, -12 braking, and there is no reverse. Angles are 1920 units per circle.
const PIXELS_PER_TICK_PER_THROTTLE = 0.4;
const ANGLE_UNIT = (2 * Math.PI) / 1920;
const TOP_SPEED = 100 * PIXELS_PER_TICK_PER_THROTTLE * ORIGINAL_TICKS_PER_SECOND;
const ACCELERATION = 10 * PIXELS_PER_TICK_PER_THROTTLE * ORIGINAL_TICKS_PER_SECOND ** 2;
const DRAG = 4 * PIXELS_PER_TICK_PER_THROTTLE * ORIGINAL_TICKS_PER_SECOND ** 2;
const BRAKING = 12 * PIXELS_PER_TICK_PER_THROTTLE * ORIGINAL_TICKS_PER_SECOND ** 2;
// 40 units a tick at the high detail setting
const TURN_RATE = 40 * ANGLE_UNIT * ORIGINAL_TICKS_PER_SECOND;
// a jump always flies 8 ticks at the speed of throttle 150, whatever the take-off speed, with no steering
const JUMP_SECONDS = 8 / ORIGINAL_TICKS_PER_SECOND;
const JUMP_SPEED = 150 * PIXELS_PER_TICK_PER_THROTTLE * ORIGINAL_TICKS_PER_SECOND;
// the sprite rises 8 screen pixels a frame to 40 and back; 40 pixels at the kart's distance is this many world pixels
export const JUMP_PEAK_HEIGHT = 17.9;
// a hand brake turn is 4 ticks of 120 units, right only if steering right; the kart brakes while it swings
const HANDBRAKE_TURN = 480 * ANGLE_UNIT;
const HANDBRAKE_SECONDS = 4 / ORIGINAL_TICKS_PER_SECOND;
// hitting a wall throws the kart 32 pixels straight back and kills its speed
const WALL_SHOVE = 32;
// ponytail: mine, not the original's; steering there does not fade at low speed, but turning on the spot felt wrong
const FULL_STEERING_SPEED = 90;

function nextSpeed(speed: number, throttle: number, isBraking: boolean, dt: number): number {
  if (isBraking || throttle < 0) {
    return Math.max(0, speed - BRAKING * dt);
  }
  if (throttle > 0) {
    return Math.min(TOP_SPEED, speed + ACCELERATION * throttle * dt);
  }
  return Math.max(0, speed - DRAG * dt);
}

function nextTurning(state: KartState, input: KartInput, dt: number): Turning {
  const startsHandbrakeTurn = input.handbrake && state.speed > 0 && state.handbrakeTurnLeft === 0;
  const remaining = startsHandbrakeTurn ? (input.steer > 0 ? HANDBRAKE_TURN : -HANDBRAKE_TURN) : state.handbrakeTurnLeft;
  if (remaining !== 0) {
    const swing = Math.sign(remaining) * Math.min(Math.abs(remaining), (HANDBRAKE_TURN / HANDBRAKE_SECONDS) * dt);
    return { heading: state.heading + swing, handbrakeTurnLeft: remaining - swing };
  }
  const steeringGrip = Math.min(1, state.speed / FULL_STEERING_SPEED);
  return { heading: state.heading + input.steer * TURN_RATE * steeringGrip * dt, handbrakeTurnLeft: 0 };
}

/** Height of a jump with this much of it left: straight up to the peak, straight back down. */
function jumpHeight(airSecondsLeft: number): number {
  const progress = 1 - airSecondsLeft / JUMP_SECONDS;
  return JUMP_PEAK_HEIGHT * (1 - Math.abs(2 * progress - 1));
}

function bouncedOffWall(state: KartState, heading: number, ground: Ground): KartState {
  const x = state.x - Math.cos(heading) * WALL_SHOVE;
  const y = state.y - Math.sin(heading) * WALL_SHOVE;
  const landing = ground.isWall(x, y) ? { x: state.x, y: state.y } : { x, y };
  // ponytail: the original also deflects the heading 18 units away from the corner that hit; not ported
  return { ...state, ...landing, heading, speed: 0, height: 0, airSecondsLeft: 0, handbrakeTurnLeft: 0 };
}

function stepInTheAir(state: KartState, dt: number, ground: Ground): KartState {
  const x = state.x + Math.cos(state.heading) * JUMP_SPEED * dt;
  const y = state.y + Math.sin(state.heading) * JUMP_SPEED * dt;
  if (ground.isWall(x, y)) {
    return bouncedOffWall(state, state.heading, ground);
  }
  const airSecondsLeft = Math.max(0, state.airSecondsLeft - dt);
  return { ...state, x, y, airSecondsLeft, height: airSecondsLeft === 0 ? 0 : jumpHeight(airSecondsLeft) };
}

export function stepKart(state: KartState, input: KartInput, dt: number, ground: Ground): KartState {
  if (state.airSecondsLeft > 0) {
    return stepInTheAir(state, dt, ground);
  }
  const isSwinging = state.handbrakeTurnLeft !== 0;
  const speed = nextSpeed(state.speed, input.throttle, isSwinging, dt);
  const { heading, handbrakeTurnLeft } = nextTurning(state, input, dt);
  // the surface does not wear speed down over time: it scales what the throttle gives, tick by tick
  const drag = isSwinging ? 0 : ground.dragAt(state.x, state.y);
  const travelled = speed * (1 - drag) * dt;
  const x = state.x + Math.cos(heading) * travelled;
  const y = state.y + Math.sin(heading) * travelled;

  if (ground.isWall(x, y)) {
    return bouncedOffWall(state, heading, ground);
  }
  const airSecondsLeft = ground.isJump(x, y) ? JUMP_SECONDS : 0;
  return { x, y, heading, speed, height: 0, airSecondsLeft, handbrakeTurnLeft };
}
