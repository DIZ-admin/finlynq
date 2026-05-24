#!/usr/bin/env tsx
/**
 * One-off migration: backfill cash-leg sibling rows for legacy single-row
 * buy/sell transactions, so the new two-row portfolio-ops model (introduced
 * in commit 54af299 — `transactions.kind` + `portfolio_holdings.is_cash`)
 * becomes consistent across legacy + new data.
 *
 * Background
 * ──────────
 * Phase 1 of the portfolio-operations refactor (2026-05-25) added an
 * explicit `kind` discriminator to `transactions` and `is_cash` flag to
 * `portfolio_holdings`. New buys/sells written through
 * `src/lib/portfolio/operations.ts` emit a TWO-ROW representation:
 *
 *   Buy:
 *     stock leg: kind='buy',          qty>0, amount=-totalCost,    portfolio_holding_id=stock,       trade_link_id=X
 *     cash leg:  kind='buy_cash_leg', qty=-totalCost, amount=0,    portfolio_holding_id=cash_sleeve, trade_link_id=X
 *
 *   Sell:
 *     stock leg: kind='sell',          qty<0, amount=+totalProceeds, portfolio_holding_id=stock,       trade_link_id=Y
 *     cash leg:  kind='sell_cash_leg', qty=+totalProceeds, amount=0, portfolio_holding_id=cash_sleeve, trade_link_id=Y
 *
 * The Phase 1 SQL migration tagged every legacy portfolio row with
 * kind='buy'/'sell' by qty sign, but it did NOT mint the paired cash legs
 * — that's what this script does. After running, every buy/sell will have
 * a corresponding buy_cash_leg/sell_cash_leg sibling sharing the same
 * trade_link_id, so the new two-row reporting model works uniformly.
 *
 * Idempotent. Safe to re-run. Supports --dry-run and --user-id=<uuid>.
 *
 * Usage
 * ─────
 *   tsx scripts/backfill-buy-sell-cash-legs.ts --dry-run
 *   tsx scripts/backfill-buy-sell-cash-legs.ts --user-id=00000000-0000-0000-0000-00000000demo
 *   tsx scripts/backfill-buy-sell-cash-legs.ts   # apply to all users
 *
 * Notes on schema / write conventions
 * ───────────────────────────────────
 *   - Reads DATABASE_URL or PF_DATABASE_URL from process.env (loaded via
 *     dotenv/config from pf-app/.env).
 *   - For each orphan stock-leg row we insert a cash-leg sibling and (only
 *     when the source row's trade_link_id was NULL) update the stock leg's
 *     trade_link_id + updated_at to NOW(). The cash leg gets a fresh
 *     created_at/updated_at = NOW() and source='backup_restore' (closest
 *     existing value in SOURCES — see src/lib/tx-source.ts; we mustn't
 *     extend the CHECK constraint here).
 *   - Cash-sleeve resolution is per (user_id, account_id, currency). If a
 *     sleeve already exists with is_cash=FALSE (legacy auto-created rows)
 *     we defensively flip it to TRUE before inserting.
 *   - If no sleeve exists we auto-create one (portfolio_holdings row +
 *     paired holding_accounts row per the load-bearing dual-write rule)
 *     using NULL name_ct/name_lookup — leaving the DEK-required fields
 *     unset is allowed by the schema and downstream resolvers fill them
 *     lazily on next login.
 *   - All inserts/updates for a single user are wrapped in one BEGIN/COMMIT
 *     so partial failures roll back cleanly.
 *   - Dry-run prints the proposed actions and exits without writing.
 */

import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Argument parsing ─────────────────────────────────────────────────────

interface Args {
  dryRun: boolean;
  userId: string | null;
  databaseUrl: string;
}

function loadDotenvFallback(): void {
  // dotenv/config normally loads from cwd. When the script is launched from
  // outside pf-app, fall back to manually reading pf-app/.env so the
  // operator doesn't need to remember to cd first.
  if (process.env.DATABASE_URL || process.env.PF_DATABASE_URL) return;
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

function parseArgs(): Args {
  const args: Args = { dryRun: false, userId: null, databaseUrl: "" };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run") {
      args.dryRun = true;
    } else if (a.startsWith("--user-id=")) {
      args.userId = a.slice("--user-id=".length);
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/backfill-buy-sell-cash-legs.ts [--dry-run] [--user-id=<uuid>]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  loadDotenvFallback();
  args.databaseUrl = process.env.DATABASE_URL ?? process.env.PF_DATABASE_URL ?? "";
  if (!args.databaseUrl) {
    console.error("ERROR: DATABASE_URL or PF_DATABASE_URL must be set (pf-app/.env)");
    process.exit(2);
  }
  return args;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface OrphanRow {
  id: number;
  user_id: string;
  account_id: number | null;
  portfolio_holding_id: number | null;
  date: string;
  currency: string;
  amount: number;
  quantity: number | null;
  kind: "buy" | "sell";
  trade_link_id: string | null;
  payee: string | null;
  note: string | null;
  tags: string | null;
}

interface SleeveRow {
  id: number;
  user_id: string;
  account_id: number | null;
  currency: string;
  is_cash: boolean;
}

interface PerUserPlan {
  userId: string;
  orphanBuys: OrphanRow[];
  orphanSells: OrphanRow[];
  // Logged for the summary line; populated as we process.
  cashLegsCreated: number;
  sleevesCreated: number;
  sleevesFlagFlipped: number;
  tradeLinkIdsGenerated: number;
}

// ─── Orphan-row discovery ─────────────────────────────────────────────────

async function findOrphans(
  client: pg.PoolClient,
  userId: string | null,
): Promise<OrphanRow[]> {
  // An orphan is a row with kind IN ('buy','sell') that has no sibling
  // (matching trade_link_id, kind LIKE '%_cash_leg'). Rows with NULL
  // trade_link_id are always orphan because no sibling key exists yet.
  const params: unknown[] = [];
  let userClause = "";
  if (userId) {
    params.push(userId);
    userClause = ` AND t.user_id = $${params.length}`;
  }
  const sql = `
    SELECT
      t.id,
      t.user_id,
      t.account_id,
      t.portfolio_holding_id,
      t.date,
      t.currency,
      t.amount,
      t.quantity,
      t.kind,
      t.trade_link_id,
      t.payee,
      t.note,
      t.tags
    FROM transactions t
    WHERE t.kind IN ('buy', 'sell')
      AND (
        t.trade_link_id IS NULL
        OR NOT EXISTS (
          SELECT 1
            FROM transactions s
           WHERE s.trade_link_id = t.trade_link_id
             AND s.user_id = t.user_id
             AND s.kind IN ('buy_cash_leg', 'sell_cash_leg')
        )
      )
      ${userClause}
    ORDER BY t.user_id, t.account_id, t.date, t.id
  `;
  const res = await client.query<OrphanRow>(sql, params);
  return res.rows;
}

// ─── Cash sleeve resolution / auto-create ─────────────────────────────────

async function findCashSleeve(
  client: pg.PoolClient,
  userId: string,
  accountId: number | null,
  currency: string,
): Promise<SleeveRow | null> {
  // Per the Phase 1 migration's detection rule + partial unique index,
  // a cash sleeve is (user_id, account_id, currency) WHERE is_cash=TRUE.
  // Defensively also match legacy sleeves where is_cash=FALSE but
  // symbol_ct IS NULL (the pre-migration auto-create shape) so we can
  // flag-flip them rather than minting a duplicate.
  const params: unknown[] = [userId, currency];
  // account_id NULL is treated as DISTINCT per Postgres semantics; we
  // mirror that with IS NOT DISTINCT FROM.
  let accountClause: string;
  if (accountId == null) {
    accountClause = "ph.account_id IS NULL";
  } else {
    params.push(accountId);
    accountClause = `ph.account_id = $${params.length}`;
  }
  const sql = `
    SELECT ph.id, ph.user_id, ph.account_id, ph.currency, ph.is_cash
      FROM portfolio_holdings ph
     WHERE ph.user_id = $1
       AND ph.currency = $2
       AND ${accountClause}
       AND (ph.is_cash = TRUE OR ph.symbol_ct IS NULL)
     ORDER BY ph.is_cash DESC, ph.id ASC
     LIMIT 1
  `;
  const res = await client.query<SleeveRow>(sql, params);
  return res.rows[0] ?? null;
}

async function createCashSleeve(
  client: pg.PoolClient,
  userId: string,
  accountId: number | null,
  currency: string,
): Promise<SleeveRow> {
  // No DEK available in a server-side migration script — leave name_ct /
  // name_lookup NULL; downstream resolver fills them on next login. The
  // is_cash=TRUE flag is what the new aggregators key off, not the name.
  // ALSO dual-write the holding_accounts pairing row (load-bearing
  // invariant: every portfolio_holdings INSERT pairs with a
  // holding_accounts row in the same transaction — see CLAUDE.md).
  const ins = await client.query<{ id: number }>(
    `INSERT INTO portfolio_holdings
       (user_id, account_id, currency, is_crypto, is_cash, note)
     VALUES ($1, $2, $3, 0, TRUE, 'auto-created by backfill-buy-sell-cash-legs')
     RETURNING id`,
    [userId, accountId, currency],
  );
  const id = ins.rows[0]!.id;
  if (accountId != null) {
    await client.query(
      `INSERT INTO holding_accounts (holding_id, account_id, user_id, qty, cost_basis, is_primary)
       VALUES ($1, $2, $3, 0, 0, TRUE)
       ON CONFLICT DO NOTHING`,
      [id, accountId, userId],
    );
  }
  return { id, user_id: userId, account_id: accountId, currency, is_cash: true };
}

/**
 * Resolve the cash sleeve for an orphan row, returning the sleeve + any
 * side-effects that fired (sleeve created, flag flipped). In dry-run
 * mode no writes happen — we still RETURN the planned actions for the
 * summary, but the sleeve `id` returned is a placeholder (-1) so callers
 * don't try to use it for inserts (dry-run skips inserts entirely).
 */
async function resolveSleeve(
  client: pg.PoolClient,
  orphan: OrphanRow,
  dryRun: boolean,
): Promise<{ sleeve: SleeveRow; created: boolean; flagFlipped: boolean }> {
  const existing = await findCashSleeve(client, orphan.user_id, orphan.account_id, orphan.currency);
  if (existing) {
    let flagFlipped = false;
    if (!existing.is_cash) {
      flagFlipped = true;
      if (!dryRun) {
        await client.query(
          `UPDATE portfolio_holdings SET is_cash = TRUE WHERE id = $1 AND user_id = $2`,
          [existing.id, orphan.user_id],
        );
        existing.is_cash = true;
      }
    }
    return { sleeve: existing, created: false, flagFlipped };
  }
  if (dryRun) {
    // Placeholder sleeve so the summary count is right — inserts won't fire.
    return {
      sleeve: {
        id: -1,
        user_id: orphan.user_id,
        account_id: orphan.account_id,
        currency: orphan.currency,
        is_cash: true,
      },
      created: true,
      flagFlipped: false,
    };
  }
  const sleeve = await createCashSleeve(client, orphan.user_id, orphan.account_id, orphan.currency);
  return { sleeve, created: true, flagFlipped: false };
}

// ─── Cash-leg insertion ───────────────────────────────────────────────────

async function insertCashLeg(
  client: pg.PoolClient,
  orphan: OrphanRow,
  sleeveId: number,
  tradeLinkId: string,
): Promise<void> {
  const kindCashLeg = orphan.kind === "buy" ? "buy_cash_leg" : "sell_cash_leg";
  // Cash leg quantity = stock leg's `amount` (matches the new
  // operations.ts convention: buy stock leg has amount=-totalCost so the
  // cash sleeve sees -totalCost; sell stock leg has amount=+totalProceeds
  // so the cash sleeve sees +totalProceeds). amount=0 keeps account-level
  // SUM(amount) unchanged.
  const cashQty = orphan.amount;
  // payee/note/tags intentionally NULL on cash legs — they are bookkeeping
  // rows, not user-facing entries. The stock-leg row carries the metadata.
  await client.query(
    `INSERT INTO transactions
       (user_id, date, account_id, portfolio_holding_id,
        currency, amount, quantity,
        kind, trade_link_id, source,
        payee, note, tags,
        created_at, updated_at)
     VALUES
       ($1, $2, $3, $4,
        $5, 0, $6,
        $7, $8, 'backup_restore',
        NULL, NULL, NULL,
        NOW(), NOW())`,
    [
      orphan.user_id,
      orphan.date,
      orphan.account_id,
      sleeveId,
      orphan.currency,
      cashQty,
      kindCashLeg,
      tradeLinkId,
    ],
  );
}

async function backfillTradeLinkId(
  client: pg.PoolClient,
  orphan: OrphanRow,
  tradeLinkId: string,
): Promise<void> {
  // Only fires when orphan.trade_link_id was NULL. Bump updated_at since
  // we mutated audit-relevant data on the row (per CLAUDE.md "Audit trio"
  // invariant: every UPDATE on transactions sets updated_at=NOW()).
  await client.query(
    `UPDATE transactions
        SET trade_link_id = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3 AND trade_link_id IS NULL`,
    [tradeLinkId, orphan.id, orphan.user_id],
  );
}

// ─── Per-user processing ──────────────────────────────────────────────────

async function processUser(
  pool: pg.Pool,
  userId: string,
  orphans: OrphanRow[],
  dryRun: boolean,
): Promise<PerUserPlan> {
  const plan: PerUserPlan = {
    userId,
    orphanBuys: orphans.filter((o) => o.kind === "buy"),
    orphanSells: orphans.filter((o) => o.kind === "sell"),
    cashLegsCreated: 0,
    sleevesCreated: 0,
    sleevesFlagFlipped: 0,
    tradeLinkIdsGenerated: 0,
  };
  if (orphans.length === 0) return plan;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Per-(account, currency) sleeve cache so auto-create only fires once.
    const sleeveCache = new Map<string, SleeveRow>();
    const sleeveCacheKey = (acctId: number | null, ccy: string): string =>
      `${acctId == null ? "NULL" : acctId}|${ccy}`;

    for (const o of orphans) {
      const key = sleeveCacheKey(o.account_id, o.currency);
      let sleeve = sleeveCache.get(key);
      if (!sleeve) {
        const r = await resolveSleeve(client, o, dryRun);
        sleeve = r.sleeve;
        if (r.created) plan.sleevesCreated++;
        if (r.flagFlipped) plan.sleevesFlagFlipped++;
        sleeveCache.set(key, sleeve);
      }

      // Ensure we have a trade_link_id to share between stock + cash leg.
      let tradeLinkId = o.trade_link_id;
      if (!tradeLinkId) {
        tradeLinkId = randomUUID();
        plan.tradeLinkIdsGenerated++;
        if (!dryRun) {
          await backfillTradeLinkId(client, o, tradeLinkId);
        }
      }

      if (!dryRun) {
        await insertCashLeg(client, o, sleeve.id, tradeLinkId);
      }
      plan.cashLegsCreated++;
    }

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return plan;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseArgs();

  const pool = new pg.Pool({ connectionString: args.databaseUrl });

  console.log("==> backfill-buy-sell-cash-legs");
  console.log(`    mode:    ${args.dryRun ? "DRY-RUN (no writes)" : "APPLY"}`);
  console.log(`    scope:   ${args.userId ?? "ALL users"}`);
  console.log("");

  const initClient = await pool.connect();
  let orphans: OrphanRow[];
  try {
    orphans = await findOrphans(initClient, args.userId);
  } finally {
    initClient.release();
  }

  if (orphans.length === 0) {
    console.log("==> No orphan buy/sell rows found. Nothing to do.");
    await pool.end();
    return 0;
  }

  // Group by user_id so per-user processing stays in one transaction.
  const byUser = new Map<string, OrphanRow[]>();
  for (const o of orphans) {
    const list = byUser.get(o.user_id) ?? [];
    list.push(o);
    byUser.set(o.user_id, list);
  }
  console.log(`==> Found ${orphans.length} orphan row(s) across ${byUser.size} user(s).`);
  console.log("");

  let totalBuys = 0;
  let totalSells = 0;
  let totalCashLegs = 0;
  let totalSleevesCreated = 0;
  let totalSleevesFlagFlipped = 0;
  let totalTradeLinkIdsGenerated = 0;

  for (const [userId, userOrphans] of byUser.entries()) {
    const plan = await processUser(pool, userId, userOrphans, args.dryRun);
    totalBuys += plan.orphanBuys.length;
    totalSells += plan.orphanSells.length;
    totalCashLegs += plan.cashLegsCreated;
    totalSleevesCreated += plan.sleevesCreated;
    totalSleevesFlagFlipped += plan.sleevesFlagFlipped;
    totalTradeLinkIdsGenerated += plan.tradeLinkIdsGenerated;

    console.log(
      `    user=${userId.slice(0, 8)}…  buys=${plan.orphanBuys.length}  sells=${plan.orphanSells.length}  ` +
        `cash-legs=${plan.cashLegsCreated}  sleeves-created=${plan.sleevesCreated}  ` +
        `sleeves-flipped=${plan.sleevesFlagFlipped}  trade-link-ids-generated=${plan.tradeLinkIdsGenerated}`,
    );
  }

  console.log("");
  console.log("==> Summary");
  console.log(`    Processed ${totalBuys} orphan buys, ${totalSells} orphan sells.`);
  console.log(`    ${args.dryRun ? "Would create" : "Created"} ${totalCashLegs} cash legs.`);
  console.log(
    `    ${args.dryRun ? "Would auto-create" : "Auto-created"} ${totalSleevesCreated} sleeves; ${
      args.dryRun ? "would flip" : "flipped"
    } is_cash=TRUE on ${totalSleevesFlagFlipped} existing sleeves.`,
  );
  console.log(
    `    ${args.dryRun ? "Would generate" : "Generated"} ${totalTradeLinkIdsGenerated} new trade_link_ids for NULL-link rows.`,
  );
  if (args.dryRun) {
    console.log("");
    console.log("==> Dry-run complete. Re-run without --dry-run to apply.");
  }
  await pool.end();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("FATAL:", err);
    process.exit(1);
  },
);
