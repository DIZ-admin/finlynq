/**
 * POST /api/settings/backfill/[runId]/undo/[proposalId]
 *
 * Undo a single applied proposal. Refused with 409 +
 * blockingClosureTxIds / blockingProposalIds if downstream activity exists
 * (mirrors the cascadeDeleteForReplace edit guard).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { safeErrorMessage, logApiError } from "@/lib/validate";
import { undoProposal } from "@/lib/portfolio/backfill/apply";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; proposalId: string }> },
) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  const { runId, proposalId: pidStr } = await params;
  const proposalId = Number.parseInt(pidStr, 10);
  if (!Number.isFinite(proposalId) || proposalId <= 0) {
    return NextResponse.json({ error: "Invalid proposalId" }, { status: 400 });
  }
  try {
    // Verify proposal belongs to run+user.
    const existing = await db
      .select({ id: schema.backfillProposals.id })
      .from(schema.backfillProposals)
      .where(
        and(
          eq(schema.backfillProposals.id, proposalId),
          eq(schema.backfillProposals.runId, runId),
          eq(schema.backfillProposals.userId, auth.userId),
        ),
      );
    if (existing.length === 0) {
      return NextResponse.json({ error: "Proposal not found in run" }, { status: 404 });
    }

    const result = await undoProposal(proposalId, auth.userId);
    if (!result.ok) {
      const status =
        result.code === "portfolio_edit_blocked" || result.code === "dependents_applied"
          ? 409
          : result.code === "not_found"
            ? 404
            : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    await logApiError("POST", `/api/settings/backfill/${runId}/undo/${proposalId}`, err, auth.userId);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to undo proposal") },
      { status: 500 },
    );
  }
}
