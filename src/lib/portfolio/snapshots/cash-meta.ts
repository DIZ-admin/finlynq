/**
 * Cash-snapshot staleness watermark helpers (plan/net-worth-cash-snapshots.md
 * Phase 3).
 *
 * The cash side of the "Net Worth Over Time" chart stores per-account daily
 * balances in `portfolio_snapshots` (source='cash'). Unlike the investment
 * side it needs NO DEK, so it's kept fresh by a real background cron + a
 * DEK-free chart-load self-heal. `portfolio_snapshots.created_at` is NOT bumped
 * on re-UPSERT, so it can't signal "rebuilt since" — this per-user meta row is
 * the watermark instead.
 *
 * `isCashStale` is the pure linchpin: it decides whether the stored cash
 * snapshots still reflect the user's cash transactions + a fresh "today".
 */

import { db, schema } from "@/db";
import { eq, sql } from "drizzle-orm";

/** Stored watermark from `portfolio_cash_snapshot_meta`. */
export interface CashSnapshotMeta {
  txMaxUpdated: Date | null;
  txCount: number;
  builtThrough: string | null; // YYYY-MM-DD
}

/** Live fingerprint of the user's cash transactions (see getCashTxFingerprint). */
export interface CashTxFingerprint {
  maxUpdated: Date | null;
  count: number;
}

export async function getCashSnapshotMeta(
  userId: string,
): Promise<CashSnapshotMeta | null> {
  const rows = await db
    .select({
      txMaxUpdated: schema.portfolioCashSnapshotMeta.txMaxUpdated,
      txCount: schema.portfolioCashSnapshotMeta.txCount,
      builtThrough: schema.portfolioCashSnapshotMeta.builtThrough,
    })
    .from(schema.portfolioCashSnapshotMeta)
    .where(eq(schema.portfolioCashSnapshotMeta.userId, userId))
    .all();
  const r = rows[0];
  if (!r) return null;
  const raw = r.txMaxUpdated as Date | string | null;
  return {
    txMaxUpdated:
      raw == null ? null : raw instanceof Date ? raw : new Date(String(raw)),
    txCount: Number(r.txCount ?? 0),
    builtThrough: r.builtThrough ?? null,
  };
}

export async function upsertCashSnapshotMeta(
  userId: string,
  fp: CashTxFingerprint,
  builtThrough: string,
): Promise<void> {
  const maxUpdatedIso = fp.maxUpdated ? fp.maxUpdated.toISOString() : null;
  await db.execute(sql`
    INSERT INTO portfolio_cash_snapshot_meta (
      user_id, tx_max_updated, tx_count, built_through, built_at
    ) VALUES (
      ${userId}, ${maxUpdatedIso}, ${fp.count}, ${builtThrough}, NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      tx_max_updated = EXCLUDED.tx_max_updated,
      tx_count = EXCLUDED.tx_count,
      built_through = EXCLUDED.built_through,
      built_at = NOW()
  `);
}

/**
 * PURE staleness predicate (unit-tested, no DB). Stored cash snapshots are
 * stale — i.e. need a rebuild — when ANY of:
 *   - no meta row exists yet (never built / first view);
 *   - the live cash-tx count differs from the count at build time (an INSERT
 *     OR a DELETE — the latter leaves max-updated untouched, so the count is
 *     the only signal);
 *   - a cash tx was created/updated AFTER the build's watermark;
 *   - the build covered a 'to' date earlier than today (baseline must roll
 *     the carried-forward balance onto the new day).
 */
export function isCashStale(
  live: CashTxFingerprint,
  meta: CashSnapshotMeta | null,
  today: string,
): boolean {
  if (meta == null) return true;
  if (meta.txCount !== live.count) return true;
  const liveMax = live.maxUpdated ? live.maxUpdated.getTime() : 0;
  const metaMax = meta.txMaxUpdated ? meta.txMaxUpdated.getTime() : 0;
  if (liveMax > metaMax) return true;
  if (meta.builtThrough == null || meta.builtThrough < today) return true;
  return false;
}
