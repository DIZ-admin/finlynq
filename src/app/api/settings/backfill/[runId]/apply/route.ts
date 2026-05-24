/**
 * POST /api/settings/backfill/[runId]/apply
 *
 * Applies every approved proposal in this run, in dependency-topological
 * order so child proposals (sells) land after their parents (buys).
 * Stops on first failure and returns the partial result + the failure
 * details so the user can decide whether to retry or fix and re-run.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { safeErrorMessage, logApiError } from "@/lib/validate";
import { applyProposal } from "@/lib/portfolio/backfill/apply";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  const { runId } = await params;
  try {
    // Verify the run belongs to the user.
    const run = await db
      .select({ id: schema.backfillRuns.id, status: schema.backfillRuns.status })
      .from(schema.backfillRuns)
      .where(
        and(
          eq(schema.backfillRuns.id, runId),
          eq(schema.backfillRuns.userId, auth.userId),
        ),
      );
    if (run.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Load all approved proposals + their deps.
    const approved = await db
      .select({
        id: schema.backfillProposals.id,
        dependsOnProposalIds: schema.backfillProposals.dependsOnProposalIds,
      })
      .from(schema.backfillProposals)
      .where(
        and(
          eq(schema.backfillProposals.runId, runId),
          eq(schema.backfillProposals.userId, auth.userId),
          eq(schema.backfillProposals.status, "approved"),
        ),
      );

    if (approved.length === 0) {
      return NextResponse.json({ ok: true, applied: [], message: "No approved proposals to apply" });
    }

    // Topological sort: parents before children. Kahn's algorithm.
    const approvedIds = new Set(approved.map((p) => p.id));
    const incoming = new Map<number, number>();
    const graph = new Map<number, number[]>();
    for (const p of approved) {
      incoming.set(p.id, 0);
      graph.set(p.id, []);
    }
    for (const p of approved) {
      for (const dep of p.dependsOnProposalIds ?? []) {
        if (!approvedIds.has(dep)) continue;
        graph.get(dep)!.push(p.id);
        incoming.set(p.id, (incoming.get(p.id) ?? 0) + 1);
      }
    }
    const queue: number[] = [];
    for (const [id, n] of incoming) if (n === 0) queue.push(id);
    const ordered: number[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      ordered.push(id);
      for (const child of graph.get(id) ?? []) {
        incoming.set(child, (incoming.get(child) ?? 0) - 1);
        if (incoming.get(child) === 0) queue.push(child);
      }
    }
    if (ordered.length !== approved.length) {
      return NextResponse.json(
        { error: "Dependency cycle detected among approved proposals", code: "dep_cycle" },
        { status: 500 },
      );
    }

    const applied: number[] = [];
    for (const id of ordered) {
      const result = await applyProposal(id, auth.userId, auth.dek);
      if (!result.ok) {
        // Mark run partially applied and return the failure.
        await db
          .update(schema.backfillRuns)
          .set({ status: applied.length > 0 ? "partially_applied" : "ready" })
          .where(eq(schema.backfillRuns.id, runId));
        return NextResponse.json(
          { ok: false, applied, failed: { proposalId: id, ...result } },
          { status: 409 },
        );
      }
      applied.push(id);
    }

    await db
      .update(schema.backfillRuns)
      .set({ status: "applied", appliedAt: sql`NOW()` })
      .where(eq(schema.backfillRuns.id, runId));

    return NextResponse.json({ ok: true, applied });
  } catch (err: unknown) {
    await logApiError("POST", `/api/settings/backfill/${runId}/apply`, err, auth.userId);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to apply backfill run") },
      { status: 500 },
    );
  }
}
