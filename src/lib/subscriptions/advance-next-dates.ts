/**
 * Keep `subscriptions.next_date` current.
 *
 * Nothing ever advanced a subscription's stored next-payment date, so after one
 * billing cycle it sat in the past forever. Every reader that windows on it
 * then went quiet: the Action Center's large-bill / renewal cards and the
 * weekly recap's "upcoming bills" all query `next_date BETWEEN today AND
 * today+7`, so a stale row could never match again, and the page showed a
 * months-old "next" date.
 *
 * This self-heal rolls each ACTIVE row whose date has passed forward to its
 * next occurrence on/after today (schedule math in ./schedule.ts). Paused and
 * cancelled rows are left alone — their date is history, not a forecast.
 *
 * Runs on the read paths that care (subscriptions GET, the Action Center, the
 * weekly recap, MCP list) and is idempotent: the UPDATE is conditional on the
 * date it read, so two concurrent callers can't double-advance a row.
 *
 * Takes an `{execute}` Executor so the app's Drizzle proxy and the MCP
 * `DbLike` share one implementation.
 */

import { sql } from "drizzle-orm";
import type { Executor } from "@/lib/delete-blockers";
import { normalizeDbRows } from "@/lib/db-utils";
import { todayISO } from "@/lib/utils/date";
import { rollForwardNextDate } from "./schedule";

export async function advanceStaleSubscriptionDates(
  db: Executor,
  userId: string,
  today: string = todayISO(),
): Promise<number> {
  const rows = normalizeDbRows<{ id: number; next_date: string; frequency: string | null }>(
    await db.execute(sql`
      SELECT id, next_date, frequency
      FROM subscriptions
      WHERE user_id = ${userId}
        AND status = 'active'
        AND next_date IS NOT NULL
        AND next_date < ${today}
    `),
  );

  let advanced = 0;
  for (const r of rows) {
    const next = rollForwardNextDate(r.next_date, r.frequency, today);
    if (!next || next === r.next_date) continue; // malformed date — leave it for the user to fix
    await db.execute(sql`
      UPDATE subscriptions
      SET next_date = ${next}
      WHERE id = ${r.id} AND user_id = ${userId} AND next_date = ${r.next_date}
    `);
    advanced++;
  }
  return advanced;
}

/** Best-effort wrapper for read paths: a failed self-heal must never fail the read. */
export async function advanceStaleSubscriptionDatesSafe(db: Executor, userId: string): Promise<void> {
  try {
    await advanceStaleSubscriptionDates(db, userId);
  } catch {
    // Swallowed on purpose — the caller still serves the stored dates.
  }
}
