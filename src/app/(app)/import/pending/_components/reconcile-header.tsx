"use client";

/**
 * Two-pane reconcile header + toolbar + re-apply-rules modal
 * (FINLYNQ-118 Phase 4).
 *
 * The batch-open header: title/subline, the Open-reconciliation link, the
 * Re-apply rules / Discard all / Send-to-bank-ledger action buttons, and the
 * FINLYNQ-88 re-apply confirmation Dialog. Extracted verbatim from
 * import/pending/page.tsx; all state + callbacks owned by the page.
 */

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ArrowLeft, ArrowRight, Check, X, Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StagedDetail } from "../_types";

export function ReconcileHeader({
  detail,
  accountId,
  acting,
  reapplying,
  selectedCount,
  reapplyModalOpen,
  setReapplyModalOpen,
  closeDetail,
  reapplyRules,
  reject,
  approve,
}: {
  detail: StagedDetail | null;
  accountId: number | null;
  acting: boolean;
  reapplying: boolean;
  selectedCount: number;
  reapplyModalOpen: boolean;
  setReapplyModalOpen: (v: boolean) => void;
  closeDetail: () => void;
  reapplyRules: () => void;
  reject: () => void;
  approve: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={closeDetail}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Pending Imports
          </button>
          <h1 className="text-xl font-semibold tracking-tight">
            {detail
              ? detail.staged.source === "upload"
                ? detail.staged.originalFilename || "Uploaded file"
                : detail.staged.subject || "(no subject)"
              : "Loading…"}
          </h1>
          {detail && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {detail.staged.source === "upload" && detail.staged.fileFormat
                ? `${detail.staged.fileFormat.toUpperCase()} upload`
                : `From ${detail.staged.fromAddress || "(unknown)"}`}
              {" · "}
              {detail.rows.length} {detail.rows.length === 1 ? "row" : "rows"}
              {detail.staged.dateRangeStart && detail.staged.dateRangeEnd && (
                <>
                  {" · "}
                  {detail.staged.dateRangeStart} → {detail.staged.dateRangeEnd}
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href={
              accountId != null
                ? `/reconcile?account=${accountId}`
                : "/reconcile"
            }
            className={buttonVariants({ variant: "outline" })}
          >
            Open reconciliation
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
          <Button
            variant="outline"
            onClick={() => setReapplyModalOpen(true)}
            disabled={acting || reapplying}
            title="Re-apply all active rules over every row in this batch"
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            Re-apply rules
          </Button>
          <Button
            variant="ghost"
            onClick={reject}
            disabled={acting}
            className="text-rose-700 hover:text-rose-800 hover:bg-rose-50"
          >
            <X className="h-4 w-4 mr-1.5" />
            Discard all
          </Button>
          <Button onClick={approve} disabled={acting || selectedCount === 0}>
            <Check className="h-4 w-4 mr-1.5" />
            Send to bank ledger {selectedCount > 0 && `(${selectedCount})`}
          </Button>
        </div>
      </div>

      {/* FINLYNQ-88 — Re-apply rules confirmation modal. */}
      <Dialog open={reapplyModalOpen} onOpenChange={setReapplyModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Re-apply rules?</DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <span className="block">
                This re-applies all active rules to every row in this batch. It
                may overwrite manual edits to payee, category, tags, type, or
                account on matched rows.
              </span>
              <span className="block">
                Rows you&apos;ve already linked to existing transactions and
                rows marked as duplicates are skipped.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setReapplyModalOpen(false)}
              disabled={reapplying}
            >
              Cancel
            </Button>
            <Button onClick={reapplyRules} disabled={reapplying}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              {reapplying ? "Re-applying…" : "Re-apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
