/**
 * Admin outbound-API log.
 *
 * GET    — the in-memory ring buffer of outbound market-data API calls (Yahoo /
 *          CoinGecko) recorded by `marketFetch` ([src/lib/market-fetch.ts]).
 *          Diagnostic: see EXACTLY which upstream APIs an operation (e.g. a
 *          snapshot rebuild) hits, even when the local caches are warm.
 * DELETE — clear the buffer (the "Clear → reproduce → view" workflow).
 *
 * Hand-rolls `requireAdmin` + the managed-mode postgres-dialect guard, mirroring
 * the other /api/admin/* routes. No DB / DEK — the log lives on `globalThis`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDialect } from "@/db";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getOutboundLog, getOutboundLogMeta, clearOutboundLog } from "@/lib/market-fetch";

export async function GET(request: NextRequest) {
  if (getDialect() !== "postgres") {
    return NextResponse.json(
      { error: "Admin features are only available in managed mode." },
      { status: 403 },
    );
  }
  const auth = await requireAdmin(request);
  if (!auth.authenticated) return auth.response;

  return NextResponse.json({ calls: getOutboundLog(), meta: getOutboundLogMeta() });
}

export async function DELETE(request: NextRequest) {
  if (getDialect() !== "postgres") {
    return NextResponse.json(
      { error: "Admin features are only available in managed mode." },
      { status: 403 },
    );
  }
  const auth = await requireAdmin(request);
  if (!auth.authenticated) return auth.response;

  return NextResponse.json({ cleared: clearOutboundLog() });
}
