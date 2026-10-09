import type { KartState, SurfaceProbe } from './kart';

type Obstacle = { x: number; y: number };

// WW.EXE detects kart contact within 14 pixels and never moves the opponent, which keeps riding its rails.
// ponytail: the player's side of the original response is not decoded; here the player is simply slid clear.
export const CONTACT_DISTANCE = 14;
const CLEARS_A_KART_HEIGHT = 10;

/** Slides a kart out of every opponent it overlaps; the opponents stay where they are. */
export function pushClearOf(kart: KartState, opponents: Obstacle[], isWall: SurfaceProbe): KartState {
  if (kart.height >= CLEARS_A_KART_HEIGHT) {
    return kart;
  }
  return opponents.reduce<KartState>((moved, opponent) => {
    const distance = Math.hypot(moved.x - opponent.x, moved.y - opponent.y);
    if (distance >= CONTACT_DISTANCE) {
      return moved;
    }
    // straight on top of each other there is no direction to slide, so go back along the heading
    const awayX = distance === 0 ? -Math.cos(moved.heading) : (moved.x - opponent.x) / distance;
    const awayY = distance === 0 ? -Math.sin(moved.heading) : (moved.y - opponent.y) / distance;
    const x = opponent.x + awayX * CONTACT_DISTANCE;
    const y = opponent.y + awayY * CONTACT_DISTANCE;
    return isWall(x, y) ? moved : { ...moved, x, y };
  }, kart);
}
