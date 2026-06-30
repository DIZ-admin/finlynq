/**
 * POST /api/portfolio/holdings/[holdingId]/lots/rebuild — FINLYNQ
 *
 * Targeted lot rebuild for ONE (security, account). The cure for an
 * out-of-order import: when a sell was recorded before its buy, the live
 * engine opened a phantom SHORT. Replaying the position's transactions in
 * chronological order opens the long first, so the sell closes it as a long.
 *
 * Scope: the position the inspector is showing — every portfolio_holding that
 * clusters under the SAME security (security_id), within the SAME account as
 * the clicked holding. Lots never cross accounts, so this is self-contained.
 *
 * Wipes + replays ONLY holding_lots / holding_lot_closures for that scope.
 * NEVER touches any `transactions` row — those are the source of truth the
 * replay reads from, so the only downside of a bad run is "run it again."
 *
 * Body: { } (none required — accountId + security cluster derive from the
 *   holding). Returns { lotsWritten, closuresWritten, txProcessed, warnings }.
 *
 * Auth: requireEncryption — the replay resolves the Dividends category (DEK).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { logApiError, safeErrorMessage } from "@/lib/validate";
import { rebuildLotsForPosition } from "@/lib/portfolio/lots/backfill";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ holdingId: string }> },
) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  try {
    const { holdingId: holdingIdRaw } = await params;
    const holdingId = parseInt(holdingIdRaw, 10);
    if (!Number.isFinite(holdingId) || holdingId <= 0) {
      return NextResponse.json(
        { error: "holdingId must be a positive integer" },
        { status: 400 },
      );
    }

    // Resolve the clicked holding (owner-scoped) → its account + security
    // cluster. accountId comes from the holding itself so the scope can't be
    // spoofed cross-account.
    const [holding] = await db
      .select({
        id: schema.portfolioHoldings.id,
        accountId: schema.portfolioHoldings.accountId,
        securityId: schema.portfolioHoldings.securityId,
      })
      .from(schema.portfolioHoldings)
      .where(
        and(
          eq(schema.portfolioHoldings.id, holdingId),
          eq(schema.portfolioHoldings.userId, auth.userId),
        ),
      )
      .limit(1);

    if (!holding || holding.accountId == null) {
      return NextResponse.json(
        { error: "Holding not found" },
        { status: 404 },
      );
    }
    const accountId = holding.accountId;

    // Every position clustering under the same security IN THIS ACCOUNT.
    // Un-backfilled rows (security_id null) fall back to just this holding.
    let holdingIds: number[] = [holdingId];
    if (holding.securityId != null) {
      const siblings = await db
        .select({ id: schema.portfolioHoldings.id })
        .from(schema.portfolioHoldings)
        .where(
          and(
            eq(schema.portfolioHoldings.userId, auth.userId),
            eq(schema.portfolioHoldings.securityId, holding.securityId),
            eq(schema.portfolioHoldings.accountId, accountId),
          ),
        );
      holdingIds = [...new Set([holdingId, ...siblings.map((s) => s.id)])];
    }

    const result = await rebuildLotsForPosition(auth.userId, auth.dek, {
      holdingIds,
      accountId,
    });

    return NextResponse.json({
      lotsWritten: result.lotsWritten,
      closuresWritten: result.closuresWritten,
      txProcessed: result.txProcessed,
      holdingIds,
      accountId,
      // `errors` carries non-fatal warnings (sell shortfalls / cross-account
      // transfer legs rebuilt within the account) — surfaced to the user.
      warnings: result.errors,
    });
  } catch (error) {
    await logApiError(
      "POST",
      "/api/portfolio/holdings/[holdingId]/lots/rebuild",
      error,
      auth.userId,
    );
    return NextResponse.json(
      { error: safeErrorMessage(error, "Failed to rebuild lots") },
      { status: 500 },
    );
  }
}
