/**
 * GET   /api/settings/backfill/[runId]   — list proposals for this run
 * PATCH /api/settings/backfill/[runId]   — update one proposal's status/variant
 *
 * Status transitions enforced server-side:
 *   pending  → approved | rejected
 *   approved → applied (only via /apply route, not here)
 *   applied  → undone  (only via /undo route, not here)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { validateBody, safeErrorMessage, logApiError } from "@/lib/validate";

const patchSchema = z.object({
  proposalId: z.number().int().positive(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  variantChoice: z.enum(["separate_fee_row", "absorb_into_cost"]).nullable().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  const { runId } = await params;
  try {
    const proposals = await db
      .select()
      .from(schema.backfillProposals)
      .where(
        and(
          eq(schema.backfillProposals.runId, runId),
          eq(schema.backfillProposals.userId, auth.userId),
        ),
      )
      .orderBy(schema.backfillProposals.id);
    return NextResponse.json({ proposals });
  } catch (err: unknown) {
    await logApiError("GET", `/api/settings/backfill/${runId}`, err, auth.userId);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to load proposals") },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  const { runId } = await params;
  try {
    const body = await request.json();
    const parsed = validateBody(body, patchSchema);
    if (parsed.error) return parsed.error;
    const { proposalId, status, variantChoice } = parsed.data;

    // Verify the proposal belongs to this run+user.
    const existing = await db
      .select({
        id: schema.backfillProposals.id,
        status: schema.backfillProposals.status,
        proposalKind: schema.backfillProposals.proposalKind,
      })
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
    const row = existing[0];
    if (row.status === "applied" || row.status === "undone") {
      return NextResponse.json(
        { error: `Proposal already in terminal status '${row.status}'` },
        { status: 409 },
      );
    }

    const patch: Record<string, unknown> = {};
    if (status !== undefined) patch.status = status;
    if (variantChoice !== undefined) patch.variantChoice = variantChoice;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, noop: true });
    }
    await db
      .update(schema.backfillProposals)
      .set(patch)
      .where(eq(schema.backfillProposals.id, proposalId));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    await logApiError("PATCH", `/api/settings/backfill/${runId}`, err, auth.userId);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to update proposal") },
      { status: 500 },
    );
  }
}
