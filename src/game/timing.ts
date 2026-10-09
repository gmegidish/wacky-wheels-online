// The original runs one logic step per frame, paced by a 136 Hz counter and waiting 12 counts by default.
// Inferred from WW.EXE (docs/opponent-logic.md section 7), not measured against the running game.
export const ORIGINAL_TICKS_PER_SECOND = 136 / 12;
