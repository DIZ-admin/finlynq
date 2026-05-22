"use client";

/**
 * DbPane — left pane of the /import/pending two-pane UI.
 *
 * Renders the user's continuous bank-side ledger (`bank_transactions`) for
 * the currently-selected account. Powered by `GET /api/import/bank-ledger`
 * (2026-05-22 two-ledger refactor) — previously this pane showed live
 * `transactions` in a ±7-day window via /api/transactions/reconciliation;
 * post-refactor we show the full bank-side history so the user sees
 * "continuous statement from the bank side" alongside the new upload on
 * the right.
 *
 * Each row surfaces:
 *   - the linked system-side transaction's id when present (rendered as
 *     "Matches #X"); bank-only rows whose transaction was deleted display
 *     without it,
 *   - a "linked to staged #X" indicator when the current upload's staged
 *     row was manually linked to this bank row's system-side transaction,
 *   - a "flagged" badge when `transaction_reconciliation_flags` carries a
 *     `missing_from_statement` row,
 *   - amount + decoded payee + decoded category name (when linked tx).
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";

export interface DbTransactionRow {
  /**
   * Unique row identifier. Post the two-ledger refactor (2026-05-22) this
   * is the `bank_transactions.id` UUID — bank-side rows are the source of
   * truth for the pane. Pre-refactor consumers that key on a numeric
   * transactions.id should use `linkedTransactionId` instead.
   */
  id: string;
  /** UUID of the bank-ledger row this entry came from. Always present. */
  bankTransactionId: string;
  /**
   * `transactions.id` of the live system-side transaction linked to this
   * bank row. NULL when the bank ledger has the row but no transaction
   * currently references it (user deleted the transaction after approval).
   */
  linkedTransactionId: number | null;
  date: string;
  amount: number;
  currency: string;
  payee: string | null;
  category: string | null;
  note: string | null;
  txType: "E" | "I" | "R" | "T" | null;
  linkedStagedRowId: string | null;
  reconciliationFlag: { kind: string; note: string | null } | null;
  /** How many statements have included this row. Bumped on every re-import. */
  seenCount?: number;
  /**
   * End-of-day balance for this row's date, computed from the latest
   * bank_daily_balances anchor + cumulative sum of intervening amounts.
   * Same value appears on every row of a given date (server-side); the
   * pane renders it only on the FIRST row of each day in display order
   * to reduce noise (the "one balance per day" rule the user picked).
   * Null when the account has no anchor at all yet.
   */
  runningBalance?: number | null;
  /**
   * The actual loaded anchor for this row's date, when one exists in
   * `bank_daily_balances`. Surfaced alongside `runningBalance` so the
   * user can see "what the bank told us" vs "what we computed" on the
   * same row. Null when no anchor exists for this date.
   */
  anchorBalance?: number | null;
  anchorSource?: string | null;
}

export function DbPane({
  rows,
  loading,
  rowActions,
  header,
}: {
  rows: DbTransactionRow[];
  loading: boolean;
  rowActions?: (row: DbTransactionRow) => React.ReactNode;
  header?: React.ReactNode;
}) {
  if (loading) {
    return (
      <>
        {header}
        <p className="p-6 text-sm text-muted-foreground text-center">
          Loading…
        </p>
      </>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        {header}
        <p className="p-6 text-sm text-muted-foreground text-center">
          No bank-ledger entries for this account yet.
        </p>
      </>
    );
  }

  // 2026-05-24 — "one balance per day" rule: show runningBalance only on
  // the FIRST row of each day in display order (rows are already sorted
  // newest-first by the server). Track which dates we've already shown.
  //
  // 2026-05-22 — the Balance column header is ALWAYS rendered (was: hidden
  // when no row had a runningBalance). When no anchor exists, every cell
  // would be empty otherwise, which made the column look like it didn't
  // exist at all — confusing on fresh accounts mid-anchor-upload. Now we
  // render "—" on the first row of each day in that case, signaling
  // "column exists, balances will land here once an anchor is loaded".
  const balanceShownForDate = new Set<string>();
  const dayFirstSeenForFallback = new Set<string>();
  const anchorShownForDate = new Set<string>();

  // Format the loaded anchor as a small sub-line, e.g. "📌 $1,234.56 (csv)".
  // Tolerance match against the computed running balance gets a ✓ glyph
  // to flag "system agrees with the bank" at a glance; a non-match shows
  // the actual loaded value so the user sees both numbers.
  const EPSILON = 0.005;

  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Payee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              {rowActions && <TableHead className="w-32 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const dimmed = r.linkedStagedRowId != null ? "opacity-70" : "";
              const showBalance =
                r.runningBalance != null && !balanceShownForDate.has(r.date);
              if (showBalance) balanceShownForDate.add(r.date);
              // Dash fallback — first row of each day when no anchor.
              const isFirstOfDayNoAnchor =
                r.runningBalance == null && !dayFirstSeenForFallback.has(r.date);
              if (isFirstOfDayNoAnchor) dayFirstSeenForFallback.add(r.date);
              // Loaded anchor for this date — only render once per day.
              const showAnchor =
                r.anchorBalance != null && !anchorShownForDate.has(r.date);
              if (showAnchor) anchorShownForDate.add(r.date);
              const anchorMatches =
                showAnchor &&
                r.runningBalance != null &&
                r.anchorBalance != null &&
                Math.abs(r.runningBalance - r.anchorBalance) <= EPSILON;
              return (
                <TableRow key={r.id} className={dimmed}>
                  <TableCell className="font-mono text-xs">{r.date}</TableCell>
                  <TableCell className="text-xs truncate max-w-[220px]">
                    {r.payee || (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {r.category && (
                      <span className="text-muted-foreground"> · {r.category}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="flex items-center gap-1 flex-wrap">
                      {r.txType === "R" ? (
                        <Badge variant="outline" className="text-[10px]">
                          Transfer
                        </Badge>
                      ) : r.txType === "I" ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"
                        >
                          Income
                        </Badge>
                      ) : r.txType === "T" ? (
                        <Badge variant="outline" className="text-[10px]">
                          True-up
                        </Badge>
                      ) : r.txType === "E" ? (
                        <Badge variant="outline" className="text-[10px]">
                          Expense
                        </Badge>
                      ) : null}
                      {r.linkedStagedRowId != null && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"
                          title={`Linked to staged row ${r.linkedStagedRowId}`}
                        >
                          linked
                        </Badge>
                      )}
                      {r.reconciliationFlag && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                          title={r.reconciliationFlag.note ?? undefined}
                        >
                          missing from statement
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatCurrency(r.amount, r.currency || "CAD")}
                  </TableCell>
                  <TableCell
                    className="text-right font-mono text-xs"
                    title={
                      showBalance
                        ? `End-of-day running balance for ${r.date}`
                        : isFirstOfDayNoAnchor
                          ? "No bank-side anchor yet — approve a statement to load balances"
                          : undefined
                    }
                  >
                    <div className="flex flex-col items-end leading-tight">
                      <span>
                        {showBalance && r.runningBalance != null
                          ? formatCurrency(r.runningBalance, r.currency || "CAD")
                          : isFirstOfDayNoAnchor
                            ? <span className="text-muted-foreground">—</span>
                            : ""}
                      </span>
                      {showAnchor && r.anchorBalance != null && (
                        <span
                          className={
                            anchorMatches
                              ? "text-[10px] text-emerald-700"
                              : "text-[10px] text-sky-700"
                          }
                          title={
                            anchorMatches
                              ? `Bank-loaded anchor (${r.anchorSource ?? "anchor"}) matches`
                              : `Bank-loaded anchor (${r.anchorSource ?? "anchor"})`
                          }
                        >
                          {anchorMatches ? "✓ anchor" : (
                            <>
                              📌{" "}
                              {formatCurrency(r.anchorBalance, r.currency || "CAD")}
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  {rowActions && (
                    <TableCell className="text-right">{rowActions(r)}</TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
