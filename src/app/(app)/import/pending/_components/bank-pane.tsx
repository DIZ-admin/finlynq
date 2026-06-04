"use client";

/**
 * BankPane — the left "Bank ledger (continuous)" pane (FINLYNQ-118 Phase 4).
 *
 * Wraps <DbPane> with its full `rowActions` render-prop (link-mode Pick /
 * flag-unflag toggle / per-row delete), extracted verbatim from
 * import/pending/page.tsx. All state + callbacks are owned by the page and
 * threaded in, so this component stays a presentational wrapper.
 */

import { Button } from "@/components/ui/button";
import { Check, Flag, X as XIcon, Trash2 } from "lucide-react";
import { DbPane, type DbTransactionRow } from "@/components/import/reconcile/db-pane";

export function BankPane({
  dbRows,
  dbRowsLoading,
  onDbRowClick,
  highlightedBankIds,
  linkMode,
  busyKey,
  deleteBankRow,
  completeLink,
  flagDbRow,
  unflagDbRow,
}: {
  dbRows: DbTransactionRow[];
  dbRowsLoading: boolean;
  onDbRowClick: (bankId: string) => void;
  highlightedBankIds: ReadonlySet<string>;
  linkMode: { stagedRowId: string } | null;
  busyKey: string | null;
  deleteBankRow: (bankId: string, deleteLinkedTransactions: boolean | null) => void;
  completeLink: (transactionId: number) => void;
  flagDbRow: (transactionId: number) => void;
  unflagDbRow: (transactionId: number) => void;
}) {
  return (
    <DbPane
      rows={dbRows}
      loading={dbRowsLoading}
      onRowClick={onDbRowClick}
      highlightedBankIds={highlightedBankIds}
      rowActions={(r) => {
        // In link-mode: show a Pick button on rows that aren't
        // already linked to a DIFFERENT staged row. The staged
        // row being linked may itself already be the back-ref
        // (re-linking), which we allow.
        const eligibleForLink =
          !r.linkedStagedRowId ||
          r.linkedStagedRowId === linkMode?.stagedRowId;
        const linkBusy = busyKey === `link:${linkMode?.stagedRowId}`;
        // Two-ledger refactor (2026-05-22): link / flag actions
        // target the system-side transaction. Bank-only rows
        // (linkedTransactionId == null) can't be linked / flagged
        // — they're historical bank entries without a current
        // system-side row.
        const txId = r.linkedTransactionId;
        const deleteBusy = busyKey === `bank-delete:${r.id}`;
        // Per-row bank delete (2026-05-27) — always available
        // alongside the link/flag affordances.
        const deleteBtn = (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void deleteBankRow(r.id, null)}
            disabled={deleteBusy}
            title="Delete this bank-ledger row"
            aria-label="Delete bank row"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        );
        if (linkMode) {
          if (!eligibleForLink) {
            return (
              <div className="flex items-center justify-end gap-1">
                <span className="text-[10px] text-muted-foreground italic">
                  already linked
                </span>
                {deleteBtn}
              </div>
            );
          }
          if (txId == null) {
            return (
              <div className="flex items-center justify-end gap-1">
                <span className="text-[10px] text-muted-foreground italic">
                  bank-only
                </span>
                {deleteBtn}
              </div>
            );
          }
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => completeLink(txId)}
                disabled={linkBusy}
                className="h-7 px-2"
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Pick
              </Button>
              {deleteBtn}
            </div>
          );
        }
        if (txId == null) {
          // Bank-only history row — flag actions don't apply,
          // but delete still does.
          return (
            <div className="flex items-center justify-end gap-1">
              {deleteBtn}
            </div>
          );
        }
        // Default mode: flag / unflag toggle + delete.
        const flagBusy =
          busyKey === `flag:${txId}` || busyKey === `unflag:${txId}`;
        if (r.reconciliationFlag) {
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => unflagDbRow(txId)}
                disabled={flagBusy}
                className="h-7 px-2 text-rose-700"
                title="Remove 'missing from statement' flag"
              >
                <XIcon className="h-3.5 w-3.5" />
              </Button>
              {deleteBtn}
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => flagDbRow(txId)}
              disabled={flagBusy}
              className="h-7 px-2 text-muted-foreground hover:text-rose-700"
              title="Mark as missing from this statement"
            >
              <Flag className="h-3.5 w-3.5" />
            </Button>
            {deleteBtn}
          </div>
        );
      }}
    />
  );
}
