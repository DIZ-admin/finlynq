/**
 * POST /api/portfolio/snapshots/rebuild
 *
 * Synchronously re-materializes the user's daily `portfolio_snapshots` from
 * `fromDate` (default: their earliest transaction) to today. Backs the
 * "Rebuild investment history" button (Settings → Investments + the net-worth
 * chart empty-state). Idempotent on the snapshot unique index.
 *
 * Requires a real session DEK (`requireEncryption` → 423 if absent). Post
 * Stream D Phase 4 holding symbols are ENCRYPTED, so pricing a holding needs
 * the DEK to decrypt the symbol — without it `getHoldingsValueByAccount`
 * mis-values stock holdings (treats share counts as $1/unit). A DEK-less
 * rebuild would write garbage, so we refuse rather than corrupt history. This
 * is also why the auto-rebuild is a DEK-bearing self-heal on chart load
 * (see /api/net-worth-history) rather than a blind background cron.
 *
 * Guards against an overlapping per-user run (409). plan/net-worth-over-time.md
 * Part B.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { logApiError } from "@/lib/validate";
import {
  rebuildPortfolioSnapshots,
  tryBeginRebuild,
  endRebuild,
} from "@/lib/portfolio/snapshots/rebuild";
import { clearDirtyIfUnchanged, listDirtySnapshotUsers } from "@/lib/portfolio/snapshots/dirty";

export async function POST(request: NextRequest) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  const { userId, dek } = auth;

  if (!tryBeginRebuild(userId)) {
    return NextResponse.json(
      { error: "A rebuild is already running for your account. Please wait.", code: "rebuild_in_progress" },
      { status: 409 },
    );
  }

  try {
    let fromDate: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.fromDate === "string") fromDate = body.fromDate;
    } catch {
      /* empty body is fine */
    }

    const summary = await rebuildPortfolioSnapshots(userId, fromDate ?? null, null, dek);

    // The manual rebuild covers whatever the auto-drain would have — clear any
    // pending dirty row that hasn't been re-stamped since before this run.
    try {
      const dirty = await listDirtySnapshotUsers();
      const mine = dirty.find((d) => d.userId === userId);
      if (mine) await clearDirtyIfUnchanged(userId, mine.markedAt);
    } catch {
      /* dirty-row cleanup is best-effort */
    }

    return NextResponse.json(summary);
  } catch (error: unknown) {
    await logApiError("POST", "/api/portfolio/snapshots/rebuild", error, userId);
    const message = error instanceof Error ? error.message : "Rebuild failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    endRebuild(userId);
  }
}
