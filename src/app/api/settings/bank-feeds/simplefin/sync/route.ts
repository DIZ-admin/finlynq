import { NextRequest, NextResponse } from "next/server";
import { requireEncryption } from "@/lib/auth/require-encryption";
import {
  syncSimpleFin,
  SimplefinNotConnectedError,
} from "@/lib/external-import/simplefin-orchestrator";
import { simplefin } from "@finlynq/import-connectors";

/**
 * POST /api/settings/bank-feeds/simplefin/sync
 *
 * Pulls the last ~90 days from SimpleFIN into bank_transactions
 * (source='connector'). requireEncryption — needs the DEK to decrypt the stored
 * access URL and encrypt the ledger rows. The bank rows surface on /import for
 * reconciliation; no `transactions` rows are created here.
 */
export async function POST(request: NextRequest) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await syncSimpleFin(auth.userId, auth.dek);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SimplefinNotConnectedError) {
      return NextResponse.json({ error: "SimpleFIN is not connected" }, { status: 400 });
    }
    // Upstream SimpleFIN failure (bad access URL, provider error) — 502.
    if (err instanceof simplefin.SimpleFinApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[simplefin/sync] failed", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
