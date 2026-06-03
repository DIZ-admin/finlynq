/**
 * GET /api/net-worth-history?period=6m|1y|all&accountId=<optional int>
 *
 * Accurate "Net Worth Over Time" (and per-account "Balance Over Time") daily
 * series. Cash/liability accounts are computed live from `transactions`;
 * investment accounts read the stored daily `portfolio_snapshots`, with TODAY
 * substituted by the live holdings aggregator so the latest point matches the
 * dashboard hero net-worth number exactly.
 *
 * Mirrors the head of /api/dashboard (requireAuth → getDEK → getDisplayCurrency
 * → getRateMap). The heavy lifting is the pure `buildNetWorthHistory` core.
 *
 * plan/net-worth-over-time.md Part A.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { getDEK } from "@/lib/crypto/dek-cache";
import {
  getRateMap,
  getDisplayCurrency,
} from "@/lib/fx-service";
import { getAccountBalances, getCashDailyDeltas, getInvestmentSnapshotsInRange } from "@/lib/queries";
import { getHoldingsValueByAccount, type AccountHoldingsValue } from "@/lib/holdings-value";
import { logApiError } from "@/lib/validate";
import {
  buildNetWorthHistory,
  type NetWorthPeriod,
  type LiveInvestmentValue,
} from "@/lib/net-worth-history";
import {
  rebuildPortfolioSnapshots,
  tryBeginRebuild,
  endRebuild,
} from "@/lib/portfolio/snapshots/rebuild";
import { listDirtySnapshotUsers, clearDirtyIfUnchanged } from "@/lib/portfolio/snapshots/dirty";

/**
 * DEK-bearing self-heal. Background jobs have no DEK (Stream D encrypts holding
 * symbols), so a cron CANNOT correctly value investment holdings — it would
 * write $1/unit garbage. This request DOES have the session DEK, and the chart
 * is exactly where stale investment history surfaces, so we rebuild here:
 *   - when a back-dated investment edit left a dirty marker, OR
 *   - on first view for a user who has live investments but no snapshots yet.
 * Fire-and-forget (the standalone Node server persists the work); the current
 * response uses existing snapshots and the NEXT load reflects the rebuild.
 */
function kickSelfHeal(
  userId: string,
  dek: Buffer,
  today: string,
  dirtyFrom: string | null,
  dirtyMarkedAt: string | null,
  needsInitialBackfill: boolean,
): void {
  if (!dirtyFrom && !needsInitialBackfill) return;
  if (!tryBeginRebuild(userId)) return; // a rebuild is already running
  // dirtyFrom drives back-dated-edit refresh; null → full history (initial backfill).
  const from = dirtyFrom;
  void (async () => {
    try {
      await rebuildPortfolioSnapshots(userId, from, today, dek);
      if (dirtyMarkedAt) await clearDirtyIfUnchanged(userId, dirtyMarkedAt);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[net-worth-history] self-heal rebuild failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      endRebuild(userId);
    }
  })();
}

function parsePeriod(raw: string | null): NetWorthPeriod {
  return raw === "6m" || raw === "1y" || raw === "all" ? raw : "6m";
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  const { userId, sessionId } = auth.context;
  const dek = sessionId ? getDEK(sessionId, userId) : null;

  const params = request.nextUrl.searchParams;
  const period = parsePeriod(params.get("period"));
  const accountId = params.get("accountId")
    ? parseInt(params.get("accountId")!, 10)
    : null;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const displayCurrency = await getDisplayCurrency(userId, params.get("currency"));
    const rateMap = await getRateMap(displayCurrency, userId);

    // Cash side (live from transactions) + investment side (stored snapshots).
    const cashDeltas = await getCashDailyDeltas(userId, accountId ?? undefined);
    const snapshotRows = await getInvestmentSnapshotsInRange(
      userId,
      "1900-01-01",
      today,
      accountId ?? undefined,
    );

    // Today's live override. Restrict to the SAME non-archived investment
    // account set the dashboard hero sums over, so the latest point matches.
    const balances = await getAccountBalances(userId);
    const investmentAccountIds = new Set(
      balances.filter((b) => Boolean(b.isInvestment)).map((b) => b.accountId),
    );
    // The live "today" override only applies to INVESTMENT accounts. Valuing the
    // whole portfolio (getHoldingsValueByAccount prices every holding live) is
    // pointless when the in-scope account set has no investment account — e.g. a
    // cash account's per-account chart, which would otherwise pay the full
    // ~all-holdings valuation for a result it immediately discards. Skip it.
    const scopeHasInvestmentAccount =
      accountId != null
        ? investmentAccountIds.has(accountId)
        : investmentAccountIds.size > 0;
    const holdingsByAccount: Map<number, AccountHoldingsValue> =
      scopeHasInvestmentAccount
        ? await getHoldingsValueByAccount(userId, dek)
        : new Map();
    const liveInvestmentByAccount = new Map<number, LiveInvestmentValue>();
    for (const [accId, v] of holdingsByAccount) {
      if (!investmentAccountIds.has(accId)) continue;
      if (accountId != null && accId !== accountId) continue;
      liveInvestmentByAccount.set(accId, { value: v.value, currency: v.currency });
    }

    const snapshots = snapshotRows.map((r) => ({
      accountId: r.accountId as number,
      snapDate: r.snapDate,
      marketValue: Number(r.marketValue),
      currency: r.currency,
    }));

    const { series, hasInvestmentData, fxApproximation } = buildNetWorthHistory({
      period,
      displayCurrency,
      rateMap,
      cashDeltas: cashDeltas.map((d) => ({
        date: d.date,
        currency: d.currency,
        delta: Number(d.delta),
      })),
      snapshots,
      liveInvestmentByAccount,
      today,
    });

    // Auto-rebuild stale investment history with the request DEK (a cron can't
    // — see kickSelfHeal). Only when we actually have a DEK to price correctly.
    if (dek) {
      const needsInitialBackfill =
        liveInvestmentByAccount.size > 0 && snapshots.length === 0;
      let dirtyFrom: string | null = null;
      let dirtyMarkedAt: string | null = null;
      try {
        const dirty = await listDirtySnapshotUsers();
        const mine = dirty.find((d) => d.userId === userId);
        if (mine) {
          dirtyFrom = mine.fromDate;
          dirtyMarkedAt = mine.markedAt;
        }
      } catch {
        /* dirty lookup is best-effort */
      }
      kickSelfHeal(userId, dek, today, dirtyFrom, dirtyMarkedAt, needsInitialBackfill);
    }

    return NextResponse.json({
      displayCurrency,
      period,
      accountId,
      series,
      hasInvestmentData,
      fxApproximation,
    });
  } catch (error: unknown) {
    await logApiError("GET", "/api/net-worth-history", error, userId);
    const message =
      error instanceof Error ? error.message : "Failed to load net worth history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
