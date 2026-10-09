export type Progress = {
  lap: number;
  checkpoint: number;
};

/** A lap counts when a kart enters checkpoint 1 straight from the last one; undone if it rolls back over the line. */
export function nextProgress(previous: Progress, checkpoint: number, lastCheckpoint: number): Progress {
  if (checkpoint === 0) {
    return previous;
  }
  if (checkpoint === 1 && previous.checkpoint === lastCheckpoint) {
    return { lap: previous.lap + 1, checkpoint };
  }
  if (checkpoint === lastCheckpoint && previous.checkpoint === 1) {
    return { lap: previous.lap - 1, checkpoint };
  }
  return { lap: previous.lap, checkpoint };
}

/** The measure the original compares for catch-up: checkpoints covered since the start. */
export function checkpointsCovered(progress: Progress, lastCheckpoint: number): number {
  return progress.lap * lastCheckpoint + progress.checkpoint;
}

/** 1 for the leader. */
export function racePosition(own: number, others: number[]): number {
  return 1 + others.filter((other) => other > own).length;
}
