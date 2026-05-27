"use client";

/**
 * BulkLinkActionBar — sticky footer on /reconcile (2026-05-27).
 *
 * Surfaced whenever the user has at least one row checked on EITHER
 * pane. The primary action — "Reconcile selected" — fires the cartesian
 * product of `(selected tx) × (selected bank)` against
 * `POST /api/reconcile/links/bulk`. Disabled until BOTH sides have at
 * least one selection (no useful link can be built with a single side).
 *
 * Stays mounted while idle (just hidden via the early-return) so
 * mounting a fresh component on every selection change isn't required.
 */

import { Button } from "@/components/ui/button";
import { Link as LinkIcon, X } from "lucide-react";

export function BulkLinkActionBar({
  txCount,
  bankCount,
  busy,
  onReconcile,
  onClear,
}: {
  txCount: number;
  bankCount: number;
  busy: boolean;
  onReconcile: () => void;
  onClear: () => void;
}) {
  if (txCount === 0 && bankCount === 0) return null;
  const total = txCount * bankCount;
  const canReconcile = txCount > 0 && bankCount > 0 && total > 0;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-fit max-w-[calc(100%-2rem)]">
      <div className="flex items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg">
        <span className="text-sm">
          <strong>{txCount}</strong> transaction{txCount === 1 ? "" : "s"}
          <span className="text-muted-foreground"> × </span>
          <strong>{bankCount}</strong> bank row{bankCount === 1 ? "" : "s"}
          <span className="text-muted-foreground">
            {" "}={" "}
            <strong>{total}</strong> link{total === 1 ? "" : "s"}
          </span>
        </span>
        <Button
          size="sm"
          onClick={onReconcile}
          disabled={!canReconcile || busy}
          className="h-8"
          title={
            !canReconcile
              ? "Select at least one row on each side"
              : `Create ${total} link${total === 1 ? "" : "s"}`
          }
        >
          <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
          {busy ? "Linking…" : "Reconcile selected"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          disabled={busy}
          className="h-8"
          aria-label="Clear selection"
          title="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
