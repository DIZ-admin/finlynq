/**
 * Shared snapshot-rebuild walk loop (plan/net-worth-over-time.md Part B).
 *
 * Re-materializes daily `portfolio_snapshots` for one user from `fromDate`
 * (default: their earliest transaction) to `toDate` (default: today), one day
 * per `buildDailySnapshot` call (idempotent UPSERT). Extracted from
 * scripts/backfill-portfolio-snapshots.ts so the manual rebuild endpoint and
 * the auto-rebuild drain cron share the exact same logic as the admin script.
 *
 * `dek` may be null — market value needs no decrypted names.
 */

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildDailySnapshot } from "@/lib/portfolio/snapshots/builder";

export interface RebuildResult {
  fromDate: string;
  toDate: string;
  daysProcessed: number;
  gapsFilledDays: number;
}

// HMR-safe per-user in-flight guard. Shared by the manual rebuild endpoint and
// the chart-load self-heal so a double-click / concurrent chart loads don't
// spawn overlapping walks for the same user.
const g = globalThis as typeof globalThis & { __pfRebuildInFlight?: Set<string> };
function inFlightSet(): Set<string> {
  if (!g.__pfRebuildInFlight) g.__pfRebuildInFlight = new Set();
  return g.__pfRebuildInFlight;
}

/** Returns true and marks the user in-flight, or false if a rebuild is already running. */
export function tryBeginRebuild(userId: string): boolean {
  const s = inFlightSet();
  if (s.has(userId)) return false;
  s.add(userId);
  return true;
}

export function endRebuild(userId: string): void {
  inFlightSet().delete(userId);
}

export function isRebuildInFlight(userId: string): boolean {
  return inFlightSet().has(userId);
}

function addDayUTC(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function rebuildPortfolioSnapshots(
  userId: string,
  fromDate?: string | null,
  toDate?: string | null,
  dek?: Buffer | null,
): Promise<RebuildResult> {
  const to = toDate ?? new Date().toISOString().slice(0, 10);

  // Discover the user's earliest transaction date when no start given.
  let from = fromDate ?? null;
  if (!from) {
    const row = await db
      .select({ minDate: sql<string>`MIN(${schema.transactions.date})` })
      .from(schema.transactions)
      .where(eq(schema.transactions.userId, userId));
    from = row[0]?.minDate ?? to;
  }
  // Clamp a from-date past today to today (single-day rebuild).
  if (from > to) from = to;

  let day = from;
  let daysProcessed = 0;
  let gapsFilledDays = 0;
  // Guard against pathological input (≈30y of days).
  const MAX_DAYS = 30 * 366;
  let guard = 0;
  while (day <= to && guard < MAX_DAYS) {
    guard++;
    const result = await buildDailySnapshot({ userId, date: day, dek: dek ?? null });
    if (result.gapsFilled) gapsFilledDays++;
    daysProcessed++;
    if (day === to) break;
    day = addDayUTC(day);
  }

  return { fromDate: from, toDate: to, daysProcessed, gapsFilledDays };
}
