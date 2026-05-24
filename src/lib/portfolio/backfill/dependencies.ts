/**
 * Dependency-graph computation for backfill proposals.
 *
 * A Sell proposal depends on every Buy proposal in the same
 * `(holding, account)` whose lots the Sell would FIFO-close from.
 *
 * Enforced in the UI selector (can't apply a child without its parents)
 * AND server-side at apply time (the apply route topologically sorts and
 * rejects orphaned children).
 *
 * The dependency walk is purely on proposal order (date asc) within the
 * same holding+account: any Buy proposal dated <= a Sell proposal is a
 * dependency, regardless of qty available. The apply path's live lot
 * engine handles FIFO depletion; we just need to make sure the parents
 * land first.
 *
 * Pure function — operates on the in-memory Proposal[] array and mutates
 * each entry's `dependsOn` field in place.
 */

import type { Proposal } from "./types";

/**
 * Returns the (holdingId, accountId) tuple of the stock-leg row in this
 * proposal, or null if the proposal doesn't operate on a non-cash holding.
 * Drift proposals share the same shape as buy_pair/sell_pair so they're
 * treated identically.
 */
function stockLegKey(p: Proposal, stockRowFinder: (rowIds: number[]) => { holdingId: number | null; accountId: number | null; date: string } | null): { holdingId: number; accountId: number; date: string } | null {
  if (p.kind !== "buy_pair" && p.kind !== "sell_pair" && p.kind !== "drift") return null;
  const meta = stockRowFinder(p.existingRowIds);
  if (!meta || meta.holdingId == null || meta.accountId == null) return null;
  return { holdingId: meta.holdingId, accountId: meta.accountId, date: meta.date };
}

/**
 * Annotate each proposal with `dependsOn` indices.
 *
 * @param proposals - the planner's draft proposals (mutated in place)
 * @param stockRowFinder - lookup: row ids → stock-leg metadata for the proposal
 *   The planner constructs this with a closure over its tx map so the
 *   dependencies module stays free of snapshot details.
 */
export function computeDependencies(
  proposals: Proposal[],
  stockRowFinder: (rowIds: number[]) => { holdingId: number | null; accountId: number | null; date: string } | null,
): void {
  // Index proposals by (holdingId, accountId) for fast lookup.
  type Entry = { idx: number; kind: "buy_pair" | "sell_pair" | "drift"; date: string };
  const byKey = new Map<string, Entry[]>();

  proposals.forEach((p, idx) => {
    const meta = stockLegKey(p, stockRowFinder);
    if (!meta) return;
    const key = `${meta.holdingId}:${meta.accountId}`;
    const list = byKey.get(key) ?? [];
    list.push({ idx, kind: p.kind as "buy_pair" | "sell_pair" | "drift", date: meta.date });
    byKey.set(key, list);
  });

  for (const list of byKey.values()) {
    // For each sell-shaped proposal, every buy-shaped proposal in the
    // same key with date <= sell's date is a dependency.
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      // We treat drift like buy_pair for dependency purposes — drift on a
      // buy raises cost basis (variant B) or splits the fee (variant A),
      // either way it opens lots that downstream sells may close from.
      const isSellShape = entry.kind === "sell_pair";
      if (!isSellShape) continue;
      for (let j = 0; j < i; j++) {
        const parent = list[j];
        if (parent.kind === "buy_pair" || parent.kind === "drift") {
          if (!proposals[entry.idx].dependsOn.includes(parent.idx)) {
            proposals[entry.idx].dependsOn.push(parent.idx);
          }
        }
      }
    }
  }
}
