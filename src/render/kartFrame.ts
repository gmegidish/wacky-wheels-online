// Frame layout of one character in CARS.SP: 0-7 are views from eight directions (4 is from behind),
// 8-11 are from behind with the driver leaning into a turn.
const FRAME_REAR = 4;
const FRAMES_LEAN_LEFT = [8, 9];
const FRAMES_LEAN_RIGHT = [10, 11];
const FULL_LEAN_SECONDS = 0.15;
const VIEW_COUNT = 8;

/** Sprite frame for the player's kart seen from behind. */
export function kartFrame(steer: number, steerHeldSeconds: number): number {
  if (steer === 0) {
    return FRAME_REAR;
  }
  const lean = steer < 0 ? FRAMES_LEAN_LEFT : FRAMES_LEAN_RIGHT;
  return lean[steerHeldSeconds < FULL_LEAN_SECONDS ? 0 : 1];
}

/** Sprite frame for another kart, picked from the eight views by how its heading differs from the camera's. */
export function opponentFrame(cameraHeading: number, kartHeading: number): number {
  const eighthTurns = Math.round((kartHeading - cameraHeading) / ((2 * Math.PI) / VIEW_COUNT));
  return (((FRAME_REAR + eighthTurns) % VIEW_COUNT) + VIEW_COUNT) % VIEW_COUNT;
}
