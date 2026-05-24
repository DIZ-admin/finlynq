/**
 * Lot selection — pure function that picks which lots to deplete to
 * satisfy a sell of `targetQty` shares.
 *
 * No DB I/O; consumes a list of candidate lots (caller pre-filters to
 * `(user, holding, account)` with `status='open'`) and returns a
 * `LotClosurePlan`. The closures-engine consumes the plan and writes the
 * per-leg closure rows.
 *
 * Three strategies today:
 *   FIFO       oldest open_date first, id ASC tiebreaker. Default.
 *   HIFO       highest cost_per_share first, id ASC tiebreaker. Tax-loss
 *              harvesting opt-in; no UI yet (Phase 1 ships engine-only).
 *   SPECIFIC   caller supplies `lotIds` in priority order.
 *
 * Edge cases:
 *   - empty `lots` array         → success=false, shortfall=targetQty
 *   - sum(qty_remaining) < targetQty → success=false, shortfall=delta
 *   - targetQty <= 0             → success=true, legs=[] (no-op)
 *   - SPECIFIC with unknown id   → silently skips it (selection.ts can't
 *                                  surface a fatal mismatch — caller's
 *                                  responsibility to validate)
 */

import type {
  HoldingLot,
  LotClosurePlan,
  LotSelectionStrategy,
} from "./types";

export interface SelectLotsToCloseInput {
  strategy: LotSelectionStrategy;
  lots: HoldingLot[];
  targetQty: number;
  /** Required for `strategy='SPECIFIC'`; ignored otherwise. */
  lotIds?: number[];
}

export function selectLotsToClose(input: SelectLotsToCloseInput): LotClosurePlan {
  const { strategy, lots, targetQty, lotIds } = input;

  if (targetQty <= 0) {
    return { success: true, legs: [], strategy };
  }

  const openLots = lots.filter((l) => l.status === "open" && l.qtyRemaining > 0);
  const ordered = orderLots(openLots, strategy, lotIds);

  const legs: LotClosurePlan["legs"] = [];
  let remaining = targetQty;
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const qty = Math.min(lot.qtyRemaining, remaining);
    if (qty <= 0) continue;
    legs.push({
      lotId: lot.id,
      qty,
      costPerShare: lot.costPerShare,
      openDate: lot.openDate,
      currency: lot.currency,
    });
    remaining -= qty;
  }

  if (remaining > 1e-9) {
    return {
      success: false,
      legs,
      shortfall: remaining,
      strategy,
    };
  }
  return { success: true, legs, strategy };
}

function orderLots(
  openLots: HoldingLot[],
  strategy: LotSelectionStrategy,
  lotIds?: number[],
): HoldingLot[] {
  switch (strategy) {
    case "FIFO": {
      const arr = openLots.slice();
      arr.sort(
        (a, b) =>
          a.openDate.localeCompare(b.openDate) || (a.id - b.id),
      );
      return arr;
    }
    case "HIFO": {
      const arr = openLots.slice();
      arr.sort(
        (a, b) =>
          b.costPerShare - a.costPerShare || (a.id - b.id),
      );
      return arr;
    }
    case "SPECIFIC": {
      if (!lotIds || lotIds.length === 0) return [];
      const byId = new Map(openLots.map((l) => [l.id, l]));
      const out: HoldingLot[] = [];
      for (const id of lotIds) {
        const l = byId.get(id);
        if (l) out.push(l);
      }
      return out;
    }
  }
}
