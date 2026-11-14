// Fractional ordering: each card has a floating-point `position`, and the
// order of a column is simply "sort by position". Moving a card only rewrites
// that one card (its new position is the midpoint of its new neighbours)
// instead of renumbering every card below it.
//
// Used by the server (authoritative) and by the client (optimistic updates),
// so both always agree on where a moved card lands.

export const GAP = 1024;

/** Repeated halving eventually runs out of float precision; below this gap
 *  the server renumbers the column. */
export const MIN_GAP = 1e-6;

export function positionBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return GAP;
  if (before === undefined) return after! - GAP;
  if (after === undefined) return before + GAP;
  return (before + after) / 2;
}

export function needsRebalance(before?: number, after?: number): boolean {
  return before !== undefined && after !== undefined && after - before < MIN_GAP;
}
