/**
 * Operator CLI for the transaction-canonicalization backfill pipeline.
 *
 * Usage:
 *   cd pf-app && DATABASE_URL="postgresql://..." \
 *     npx tsx scripts/backfill-cli.ts <userId> <mode> [--apply]
 *
 *   <mode> = refuse_orphans | synthesize_orphans
 *   --apply (optional) = auto-apply all high-confidence non-drift proposals.
 *                        Without this flag, prints the plan and exits 0.
 *
 * No DEK — names render as null. The planner doesn't depend on names for
 * correctness; the operator just won't see human-readable summaries.
 *
 * Live feature doc: pf-app/docs/architecture/backfill.md.
 */

import { PostgresAdapter } from "../src/db/adapters/postgres";
import { setAdapter, setDialect } from "../src/db";
import { loadLedgerSnapshot, applyProposal } from "../src/lib/portfolio/backfill/apply";
import { planBackfill } from "../src/lib/portfolio/backfill/planner";
import type { BackfillMode } from "../src/lib/portfolio/backfill/types";

async function main(): Promise<number> {
  const userId = process.argv[2];
  const mode = process.argv[3] as BackfillMode | undefined;
  const applyFlag = process.argv.includes("--apply");

  if (!userId || !mode || (mode !== "refuse_orphans" && mode !== "synthesize_orphans")) {
    console.error("Usage: npx tsx scripts/backfill-cli.ts <userId> <refuse_orphans|synthesize_orphans> [--apply]");
    return 1;
  }
  const databaseUrl = process.env.DATABASE_URL || process.env.PF_DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL (or PF_DATABASE_URL) must be set");
    return 1;
  }

  setDialect("postgres");
  const adapter = new PostgresAdapter();
  await adapter.initialize({
    dialect: "postgres",
    postgres: { connectionString: databaseUrl, userId },
  });
  setAdapter(adapter);

  try {
    console.log(`Planning backfill for user: ${userId} (mode: ${mode})`);
    const snapshot = await loadLedgerSnapshot(userId, null, {});
    const proposals = planBackfill(snapshot, { mode, scope: {} });
    console.log("");
    console.log(`Proposals: ${proposals.length}`);
    const byKind = new Map<string, number>();
    for (const p of proposals) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
    for (const [k, n] of byKind) console.log(`  ${k}: ${n}`);
    console.log("");
    console.log("By confidence:");
    const byConf = new Map<string, number>();
    for (const p of proposals) byConf.set(p.confidence, (byConf.get(p.confidence) ?? 0) + 1);
    for (const [c, n] of byConf) console.log(`  ${c}: ${n}`);
    console.log("");

    if (!applyFlag) {
      console.log("Dry run. Pass --apply to apply all high-confidence non-drift proposals.");
      console.log("Or use the web UI at /settings/backfill for review + selective apply.");
      return 0;
    }

    // CLI auto-apply: only high-confidence non-drift proposals (the operator
    // can use the web UI for drift variant picking + dependency review).
    // Skips refused proposals.
    console.log("Auto-applying high-confidence non-drift proposals…");
    let applied = 0;
    let skipped = 0;
    let failed = 0;
    // We need to persist these proposals first so applyProposal() can load them.
    // For an operator CLI, the simplest path is to short-circuit: call applyProposal
    // directly? No — applyProposal reads the row from backfill_proposals.
    // For V1 the CLI uses the same POST /api/settings/backfill flow conceptually.
    // We replicate it here with direct DB writes for the operator path.
    const { db, schema } = await import("../src/db");
    const { eq } = await import("drizzle-orm");
    const runInserted = await db
      .insert(schema.backfillRuns)
      .values({ userId, mode, scopeFilter: {}, status: "ready" })
      .returning({ id: schema.backfillRuns.id });
    const runId = runInserted[0]?.id;
    if (!runId) {
      console.error("FATAL: failed to create backfill_runs row");
      return 1;
    }
    const proposalIdByIndex = new Map<number, number>();
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      const isDrift = p.kind === "drift";
      const persistedReplacementJson = isDrift && p.variants ? p.variants : p.replacement;
      const inserted = await db
        .insert(schema.backfillProposals)
        .values({
          runId,
          userId,
          proposalKind: p.kind,
          confidence: p.confidence,
          refusalReason: p.refusalReason ?? null,
          summary: p.summary,
          existingRowIds: p.existingRowIds,
          replacementRowsJson: persistedReplacementJson,
          synthesizedRowsJson: p.synthesized.length > 0 ? p.synthesized : null,
          deltasJson: p.deltas,
          dependsOnProposalIds: [],
          variantChoice: null,
          status: p.confidence === "refused" ? "refused_with_reason" : (p.kind === "drift" ? "pending" : "approved"),
        })
        .returning({ id: schema.backfillProposals.id });
      const id = inserted[0]?.id;
      if (id != null) proposalIdByIndex.set(i, id);
    }
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      const dbId = proposalIdByIndex.get(i);
      if (dbId == null || p.dependsOn.length === 0) continue;
      const deps = p.dependsOn.map((idx) => proposalIdByIndex.get(idx)).filter((v): v is number => v != null);
      if (deps.length > 0) {
        await db
          .update(schema.backfillProposals)
          .set({ dependsOnProposalIds: deps })
          .where(eq(schema.backfillProposals.id, dbId));
      }
    }
    // Apply approved proposals in original (dependency-respecting) order.
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      if (p.kind === "drift") { skipped++; continue; }
      if (p.confidence === "refused") { skipped++; continue; }
      const dbId = proposalIdByIndex.get(i);
      if (dbId == null) continue;
      const result = await applyProposal(dbId, userId, null);
      if (result.ok) { applied++; }
      else { console.error(`  FAILED proposal ${dbId}: ${result.code} — ${result.message}`); failed++; }
    }
    console.log("");
    console.log(`Applied: ${applied}, Skipped (drift/refused): ${skipped}, Failed: ${failed}`);
    console.log(`Run id: ${runId} (review at /settings/backfill/${runId})`);
    return failed === 0 ? 0 : 1;
  } catch (err) {
    console.error("FATAL:", err);
    return 1;
  } finally {
    await adapter.close();
  }
}

main().then((code) => process.exit(code));
