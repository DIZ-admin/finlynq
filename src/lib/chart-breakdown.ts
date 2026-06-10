/**
 * chart-breakdown.ts — shared pure util for chart tooltip / stacked-member
 * breakdowns (FINLYNQ-128, reused by FINLYNQ-129's stacked-member toggle).
 *
 * A "breakdown" is the per-member decomposition of an aggregate value at one
 * point on a value-over-time chart:
 *   - Net Worth Over Time → per ACCOUNT
 *   - Income vs Expenses   → per CATEGORY
 *   - Performance          → per HOLDING (market value $) — deferred, see item
 *
 * `rankBreakdown` ranks members descending by ABSOLUTE contribution and
 * collapses everything past `maxMembers` into a single "Other" residual row, so
 * a tooltip never lists more than `maxMembers + 1` rows. The residual preserves
 * the grand total: top-N + Other === sum of all members (modulo float).
 *
 * PURE / CLIENT-SAFE: zero deps, no @/db, no next/server, no Date.now(). Safe to
 * import from "use client" components AND from API route handlers that pre-shape
 * the breakdown payload.
 */

/** One member's contribution to an aggregate at a point in time. */
export interface BreakdownMember {
  /** Stable id (accountId / categoryId / holdingId). Optional — display uses name. */
  id?: number | string | null;
  /** Display name. Caller MUST pre-resolve null encrypted names via safeName. */
  name: string;
  /** Contribution in the chart's display currency. May be negative (liabilities). */
  value: number;
}

export interface RankBreakdownOptions {
  /** Max named rows before collapsing into "Other". Default 10. */
  maxMembers?: number;
  /** Label for the residual row. Default "Other". */
  otherLabel?: string;
}

export interface RankedBreakdown {
  /** Up to `maxMembers` named rows, sorted desc by |value|. */
  rows: BreakdownMember[];
  /**
   * The collapsed residual row, or null when member count ≤ maxMembers. Its
   * `value` is the signed sum of all members past the top-N (NOT abs) so that
   * `rows + other` re-sums to the grand total exactly.
   */
  other: BreakdownMember | null;
  /** Signed sum across ALL input members (top-N rows + other). */
  total: number;
}

/**
 * Rank members desc by absolute contribution, collapsing the tail past
 * `maxMembers` into one "Other" residual row.
 *
 * Invariants (exercised by the unit test):
 *  - rows.length ≤ maxMembers.
 *  - At most ONE residual row; present iff member count > maxMembers.
 *  - sum(rows.value) + (other?.value ?? 0) === total (the grand total is
 *    preserved; the residual is the SIGNED remainder, not abs).
 *  - Zero-value members are dropped (they add nothing to the aggregate and
 *    would crowd out a real contributor from the top-N).
 */
export function rankBreakdown(
  members: BreakdownMember[],
  options: RankBreakdownOptions = {},
): RankedBreakdown {
  const maxMembers = options.maxMembers ?? 10;
  const otherLabel = options.otherLabel ?? "Other";

  const nonZero = members.filter((m) => Number.isFinite(m.value) && m.value !== 0);
  const total = nonZero.reduce((s, m) => s + m.value, 0);

  // Sort desc by absolute contribution; tie-break by signed value then name so
  // the order is deterministic (stable across renders / matches the stacked view).
  const sorted = [...nonZero].sort((a, b) => {
    const da = Math.abs(b.value) - Math.abs(a.value);
    if (da !== 0) return da;
    if (b.value !== a.value) return b.value - a.value;
    return a.name.localeCompare(b.name);
  });

  if (sorted.length <= maxMembers) {
    return { rows: sorted, other: null, total };
  }

  const rows = sorted.slice(0, maxMembers);
  const tail = sorted.slice(maxMembers);
  const otherValue = tail.reduce((s, m) => s + m.value, 0);
  return {
    rows,
    other: { name: otherLabel, value: otherValue },
    total,
  };
}
