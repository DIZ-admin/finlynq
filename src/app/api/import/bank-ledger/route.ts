/**
 * GET /api/import/bank-ledger?accountId=<int>
 *
 * Returns the user's full `bank_transactions` history for one account,
 * decrypted under the session DEK. Powers the left pane of the
 * `/import/pending` two-pane reconciliation UI — the user sees the
 * continuous bank-side history merged against the new upload's staged
 * rows on the right.
 *
 * Replaces the previous `/api/transactions/reconciliation` source for the
 * same pane (which read from `transactions` in a ±7d window). The bank
 * ledger is the truthful "continuous statement from the bank side" view
 * per the 2026-05-22 two-ledger refactor.
 *
 * `requireEncryption()` — bank-ledger rows are encrypted-in-place; the
 * session DEK (or PF_STAGING_KEY for the rare service-tier row) decrypts
 * them. Without a DEK we couldn't render the surface usefully.
 *
 * Cross-tenant attacks return 404 (consistent with the rest of the
 * staging surface — never 403, which would leak existence).
 *
 * Per-row enrichment:
 *   - `linkedTransactionId` — the live `transactions.id` whose
 *     `bank_transaction_id` references this bank row. NULL when the row
 *     is bank-side only (history without a current system-side transaction
 *     — e.g., the user deleted the transaction after approval).
 *   - `linkedStagedRowId` — the current upload's `staged_transactions.id`
 *     whose `linked_transaction_id` was manually linked to the same
 *     `linkedTransactionId`. NULL when no staged row was linked. Lets
 *     the UI surface "linked to row #X" indicators without a second query.
 *
 * Load-bearing rules honored:
 *   - User-scoped — `WHERE bank_transactions.user_id = $userId` AND
 *     `WHERE accounts.user_id = $userId`. Cross-tenant accountId = 404.
 *   - Tier-aware decrypt: 'user'-tier via `tryDecryptField(dek, ...)`,
 *     'service'-tier via `decryptStaged(...)`. Mixed-tier batches are
 *     expected mid-upgrade (the login-time job is async).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { tryDecryptField } from "@/lib/crypto/envelope";
import { decryptStaged } from "@/lib/crypto/staging-envelope";
import { listBankAnchors } from "@/lib/bank-ledger-balance";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  const { userId, dek } = auth;

  const params = request.nextUrl.searchParams;
  const accountIdRaw = params.get("accountId");

  if (!accountIdRaw) {
    return NextResponse.json(
      { error: "Missing required query param: accountId" },
      { status: 400 },
    );
  }
  const accountId = parseInt(accountIdRaw, 10);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return NextResponse.json({ error: "Invalid accountId" }, { status: 400 });
  }

  // Verify the account belongs to this user. Cross-tenant attack returns
  // 404 without leaking that the account id exists for someone else.
  const acct = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(
      eq(schema.accounts.id, accountId),
      eq(schema.accounts.userId, userId),
    ))
    .get();
  if (!acct) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Bank ledger for the account, joined to the live transaction (when a
  // system-side row currently references this bank row) and to the current
  // upload's staged_transactions (via the linked transaction). The two
  // LEFT JOINs let the UI render lineage + manual-link state in one pass.
  const rows = await db
    .select({
      bankId: schema.bankTransactions.id,
      date: schema.bankTransactions.date,
      amount: schema.bankTransactions.amount,
      currency: schema.bankTransactions.currency,
      payee: schema.bankTransactions.payee,
      note: schema.bankTransactions.note,
      tags: schema.bankTransactions.tags,
      accountName: schema.bankTransactions.accountName,
      encryptionTier: schema.bankTransactions.encryptionTier,
      seenCount: schema.bankTransactions.seenCount,
      firstSeenAt: schema.bankTransactions.firstSeenAt,
      lastSeenAt: schema.bankTransactions.lastSeenAt,
      txId: schema.transactions.id,
      txCategoryNameCt: schema.categories.nameCt,
      txCategoryType: schema.categories.type,
      linkedStagedRowId: schema.stagedTransactions.id,
    })
    .from(schema.bankTransactions)
    .leftJoin(
      schema.transactions,
      and(
        eq(schema.transactions.bankTransactionId, schema.bankTransactions.id),
        eq(schema.transactions.userId, schema.bankTransactions.userId),
      ),
    )
    .leftJoin(
      schema.categories,
      eq(schema.transactions.categoryId, schema.categories.id),
    )
    .leftJoin(
      schema.stagedTransactions,
      eq(schema.stagedTransactions.linkedTransactionId, schema.transactions.id),
    )
    .where(and(
      eq(schema.bankTransactions.userId, userId),
      eq(schema.bankTransactions.accountId, accountId),
    ))
    // 2026-05-24 — newest-first sort. The /import/pending bank-ledger
    // pane shows running balance per day, anchored from the most-recent
    // anchor; reading top-down means walking history from now backwards.
    .orderBy(desc(schema.bankTransactions.date), desc(schema.bankTransactions.id))
    .all();

  // Dedup by bank id — a single bank row may join to multiple staged_transactions
  // if a race ever linked more than one (defensive — PATCH enforces 0..1).
  const byBankId = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    if (!byBankId.has(r.bankId)) byBankId.set(r.bankId, r);
  }
  const deduped = Array.from(byBankId.values());

  // ─── End-of-day calculated balance per date (2026-05-22 refactor) ─────
  //
  // For each date d we want to display: find the most-recent anchor STRICTLY
  // before d (anchor.date < d, not <= d), then:
  //
  //   calculated[d] = lastAnchor.balance + Σ(bank_tx.amount in (lastAnchor.date, d])
  //
  // Three properties fall out of strict-<:
  //   1. On an anchor day (d IS itself an anchor), calculated is derived
  //      from the PRIOR anchor + every tx up through d — independent of
  //      d's own anchor. The Calculated and Loaded columns then become a
  //      real cross-check rather than circular logic.
  //   2. Between two anchors, drift only accumulates within that gap. The
  //      moment we cross the next anchor going forward, drift resets to
  //      that anchor's truth.
  //   3. For d before the first-ever anchor → no lastAnchor exists →
  //      calculated stays null. We do NOT extrapolate backward from a
  //      future anchor; the bank never told us anything about that period.
  //
  // The previous algorithm picked the single LATEST anchor as a global
  // checkpoint and projected from it across all dates. That silently
  // ignored every other loaded anchor and let drift compound linearly.
  // Per CLAUDE.md "Bank balance anchors" — errors must not compound
  // forward across anchor boundaries.
  const allAnchors = await listBankAnchors(userId, accountId);
  // listBankAnchors returns DESC; reverse for ASC processing.
  const anchorsAsc = [...allAnchors].reverse();
  const anchorByDate = new Map<string, { balance: number; source: string }>();
  for (const a of allAnchors) {
    anchorByDate.set(a.date, { balance: a.balance, source: a.source });
  }

  // Daily sum + cumulative sum of bank_tx amounts. Pure aggregation over
  // the rows the user will see — anchors on dates with no rows are still
  // valid for "Loaded" but contribute nothing to the cum walk.
  const dailySum = new Map<string, number>();
  for (const r of deduped) {
    dailySum.set(r.date, (dailySum.get(r.date) ?? 0) + Number(r.amount));
  }
  const datesAsc = Array.from(dailySum.keys()).sort();
  const cumByDate = new Map<string, number>();
  let running = 0;
  for (const d of datesAsc) {
    running += dailySum.get(d) ?? 0;
    cumByDate.set(d, running);
  }

  // cumUpTo(date) = Σ(amounts on dates <= argument). Binary search over
  // datesAsc; returns 0 when no row date is <= argument.
  const cumUpTo = (date: string): number => {
    if (datesAsc.length === 0) return 0;
    let lo = 0;
    let hi = datesAsc.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (datesAsc[mid] <= date) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans < 0 ? 0 : cumByDate.get(datesAsc[ans]) ?? 0;
  };

  // Find the most recent anchor whose date is STRICTLY before `d`.
  // Binary search over anchorsAsc; returns null when no prior anchor.
  const findLastAnchorBefore = (d: string): { date: string; balance: number } | null => {
    if (anchorsAsc.length === 0) return null;
    let lo = 0;
    let hi = anchorsAsc.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (anchorsAsc[mid].date < d) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans < 0) return null;
    const a = anchorsAsc[ans];
    return { date: a.date, balance: a.balance };
  };

  // Compute calculated[d] for every unique row date. Σ(amounts in
  // (lastAnchor.date, d]) = cumUpTo(d) - cumUpTo(lastAnchor.date).
  const endOfDayBalance = new Map<string, number>();
  for (const d of datesAsc) {
    const lastAnchor = findLastAnchorBefore(d);
    if (!lastAnchor) continue; // no backward extrapolation
    const sum = (cumByDate.get(d) ?? 0) - cumUpTo(lastAnchor.date);
    endOfDayBalance.set(d, lastAnchor.balance + sum);
  }

  // Per-row decrypt. Tier-aware: 'user' → DEK, 'service' → PF_STAGING_KEY.
  // Category name decrypts under the user DEK only (Stream D table).
  const transactions = deduped.map((r) => {
    const tier = r.encryptionTier ?? "user";
    const decode = (v: string | null): string | null => {
      if (v == null) return null;
      return tier === "user" ? tryDecryptField(dek, v) : decryptStaged(v);
    };
    const payee = decode(r.payee);
    const note = decode(r.note);
    const category = r.txCategoryNameCt
      ? tryDecryptField(dek, r.txCategoryNameCt, "categories.name_ct")
      : null;
    return {
      // Stable unique key for React + Map keying. Bank UUID is the
      // permanent identifier; the system-side transactions.id (when
      // present) is surfaced separately for "Matches transaction #X".
      id: r.bankId,
      bankTransactionId: r.bankId,
      linkedTransactionId: r.txId ?? null,
      date: r.date,
      amount: Number(r.amount),
      currency: r.currency,
      payee,
      category,
      note,
      txType: (r.txCategoryType as "E" | "I" | "R" | "T" | null) ?? null,
      linkedStagedRowId: r.linkedStagedRowId ?? null,
      // Frequency metadata — how many statements have included this row.
      // Surfaced in the UI as "seen N times" or similar.
      seenCount: r.seenCount,
      firstSeenAt: r.firstSeenAt?.toISOString() ?? null,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      // 2026-05-24 — end-of-day balance for this row's date. Same value
      // appears on every row of that date; the UI shows it only on the
      // first row of each day in display order to reduce noise. Null
      // when the account has no anchor yet.
      runningBalance: endOfDayBalance.get(r.date) ?? null,
      // 2026-05-22 — the actual loaded anchor for this date, if any. The
      // UI renders this alongside `runningBalance` so the user can see
      // both "what the bank told us" (anchor) and "what the system
      // computed" (running). Null when no anchor exists for this date.
      anchorBalance: anchorByDate.get(r.date)?.balance ?? null,
      anchorSource: anchorByDate.get(r.date)?.source ?? null,
    };
  });

  // latestAnchor — return the most recent loaded anchor for the page
  // header. allAnchors is DESC by date; index 0 is the latest.
  const latestAnchor = allAnchors.length > 0 ? allAnchors[0] : null;

  return NextResponse.json({
    success: true,
    data: {
      transactions,
      latestAnchor,
    },
  });
}
