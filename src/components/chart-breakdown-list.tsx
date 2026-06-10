"use client";

/**
 * TooltipBreakdownList — the shared "top-10 member breakdown" block appended to
 * chart tooltips (FINLYNQ-128). Renders a ranked list of contributors with
 * names + currency-formatted values, capped in height and scrollable so it
 * never overflows a small viewport (tc-4).
 *
 * The breakdown is PRE-RANKED by the API (top-10 + a single "Other" residual
 * via `rankBreakdown` in src/lib/chart-breakdown.ts) — this component only
 * renders. Reused by the Net Worth and Income vs Expenses tooltips, and is the
 * intended render target for FINLYNQ-129's stacked-member view legend.
 */

import { formatCurrency } from "@/lib/currency";

export interface BreakdownRow {
  name: string;
  value: number;
}

export function TooltipBreakdownList({
  rows,
  currency,
  /** Heading above the list, e.g. "By account" / "By category". */
  heading,
}: {
  rows: BreakdownRow[] | undefined;
  currency: string;
  heading?: string;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      {heading && (
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
          {heading}
        </p>
      )}
      {/* Cap height so a long list scrolls instead of running off small screens. */}
      <div className="max-h-40 overflow-y-auto pr-1 space-y-0.5">
        {rows.map((r, i) => (
          <div key={`${r.name}-${i}`} className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground truncate max-w-[140px]" title={r.name}>
              {r.name}
            </span>
            <span className="font-medium tabular-nums ml-auto whitespace-nowrap">
              {formatCurrency(Number(r.value), currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
