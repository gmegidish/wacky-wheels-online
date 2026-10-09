import type { RoadSegment } from '../formats/road';

type Rail = RoadSegment & {
  /** path points on this segment: the original rasterises each one pixel by pixel */
  points: number;
  heading: number;
};

export type Rails = {
  rails: Rail[];
  totalPoints: number;
};

export type RailPosition = { x: number; y: number; heading: number };

/** The racing line as the original stores it: a loop measured in rasterised path points. */
export function buildRails(road: RoadSegment[]): Rails {
  const rails = road.map((segment) => {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    return { ...segment, points: Math.max(Math.abs(dx), Math.abs(dy)), heading: Math.atan2(dy, dx) };
  });
  return { rails, totalPoints: rails.reduce((total, rail) => total + rail.points, 0) };
}

export function railPosition({ rails, totalPoints }: Rails, distance: number): RailPosition {
  let remaining = ((distance % totalPoints) + totalPoints) % totalPoints;
  const rail = rails.find((candidate) => {
    if (remaining < candidate.points) {
      return true;
    }
    remaining -= candidate.points;
    return false;
  }) ?? rails[0];
  const along = rail.points === 0 ? 0 : remaining / rail.points;
  return {
    x: rail.from.x + (rail.to.x - rail.from.x) * along,
    y: rail.from.y + (rail.to.y - rail.from.y) * along,
    heading: rail.heading,
  };
}

/** How far round the loop the point of the racing line nearest to this position is. */
export function railDistanceOf({ rails }: Rails, x: number, y: number): number {
  let before = 0;
  let nearest = { gap: Infinity, distance: 0 };
  for (const rail of rails) {
    const dx = rail.to.x - rail.from.x;
    const dy = rail.to.y - rail.from.y;
    const lengthSquared = dx * dx + dy * dy || 1;
    const along = Math.max(0, Math.min(1, ((x - rail.from.x) * dx + (y - rail.from.y) * dy) / lengthSquared));
    const gap = Math.hypot(x - (rail.from.x + dx * along), y - (rail.from.y + dy * along));
    if (gap < nearest.gap) {
      nearest = { gap, distance: before + along * rail.points };
    }
    before += rail.points;
  }
  return nearest.distance;
}

/** True when a is further round the loop than b, going the short way between them. */
export function isFurtherRound({ totalPoints }: Rails, a: number, b: number): boolean {
  const lead = (((a - b) % totalPoints) + totalPoints) % totalPoints;
  return lead > 0 && lead < totalPoints / 2;
}
