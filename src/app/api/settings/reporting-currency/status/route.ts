import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isReportingRecomputeInFlight } from "@/lib/fx/reporting-amount";

/**
 * Progress of the currency-switch reporting-amount recompute (Phase 3). Polled
 * by the Settings display-currency toast. Returns the latest status row plus a
 * best-effort in-process `inFlight` flag.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  const { userId } = auth.context;

  const row = await db
    .select({
      targetCurrency: schema.reportingRecomputeStatus.targetCurrency,
      total: schema.reportingRecomputeStatus.total,
      done: schema.reportingRecomputeStatus.done,
      startedAt: schema.reportingRecomputeStatus.startedAt,
      finishedAt: schema.reportingRecomputeStatus.finishedAt,
    })
    .from(schema.reportingRecomputeStatus)
    .where(eq(schema.reportingRecomputeStatus.userId, userId))
    .limit(1);

  const s = row[0];
  return NextResponse.json({
    inFlight: isReportingRecomputeInFlight(userId),
    targetCurrency: s?.targetCurrency ?? null,
    total: s?.total ?? 0,
    done: s?.done ?? 0,
    finished: s?.finishedAt != null,
    startedAt: s?.startedAt ?? null,
    finishedAt: s?.finishedAt ?? null,
  });
}
