/**
 * Admin script — backfill `transactions.reporting_amount` (currency rework
 * Phase 3, 2026-06-06).
 *
 * Usage:
 *   cd pf-app && DATABASE_URL="postgresql://..." npx tsx scripts/backfill-tx-reporting-amount.ts <userId|--all>
 *
 * For each user, resolves their display/reporting currency and runs
 * `recomputeReportingAmounts`, which converts every transaction's account-
 * currency `amount` to that currency at the row's historical date rate and
 * stores it. No DEK needed — only amount/currency/date (all plaintext) are
 * read. Idempotent: re-running recomputes into the same currency. Rows whose
 * historical rate can't be resolved are left NULL (reports fall back; the cron
 * + self-heal retry later).
 */

import { PostgresAdapter } from "../src/db/adapters/postgres";
import { setAdapter, setDialect, db, schema } from "../src/db";
import { recomputeReportingAmounts } from "../src/lib/fx/reporting-amount";
import { getDisplayCurrency } from "../src/lib/fx-service";

async function main(): Promise<number> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx scripts/backfill-tx-reporting-amount.ts <userId|--all>");
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
    // userId here is just connection metadata; recomputeReportingAmounts scopes
    // every query by the explicit per-user id below.
    postgres: { connectionString: databaseUrl, userId: arg === "--all" ? "" : arg },
  });
  setAdapter(adapter);

  try {
    let userIds: string[];
    if (arg === "--all") {
      const rows = await db
        .selectDistinct({ userId: schema.transactions.userId })
        .from(schema.transactions);
      userIds = rows.map((r) => r.userId).filter(Boolean);
    } else {
      userIds = [arg];
    }

    console.log(`Backfilling reporting amounts for ${userIds.length} user(s)`);
    for (const userId of userIds) {
      const displayCurrency = await getDisplayCurrency(userId);
      const res = await recomputeReportingAmounts(userId, displayCurrency);
      if (res.ok) {
        console.log(
          `  ${userId} → ${displayCurrency}: ${res.updated} group(s) updated, ${res.skipped} skipped (no rate)`,
        );
      } else {
        console.log(`  ${userId}: skipped (${res.reason})`);
      }
    }
    console.log("Done.");
    return 0;
  } catch (err) {
    console.error("FATAL:", err);
    return 1;
  } finally {
    await adapter.close();
  }
}

main().then((code) => process.exit(code));
