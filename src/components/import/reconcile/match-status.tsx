/**
 * Shared visual language for the persistent cross-pane reconciliation status
 * (see {@link computePanePairing}). Both the FilePane (staged) and BankPane
 * (bank ledger) import these so a "matched" / "only here" row reads with the
 * SAME color on both sides and the eye can pair them across the gap.
 *
 *   matched      → emerald  (has a counterpart on the other side)
 *   only_file    → amber    (staged row with no bank counterpart — new)
 *   only_ledger  → slate    (bank row in the period with no file counterpart)
 */

import { Badge } from "@/components/ui/badge";

export type PaneMatchStatus = "matched" | "only_file" | "only_ledger";

/** Left-border tint for a row. Empty string when there's no status (neutral). */
export function matchBorderClass(status: PaneMatchStatus | undefined): string {
  switch (status) {
    case "matched":
      return "border-l-2 border-l-emerald-500/70";
    case "only_file":
      return "border-l-2 border-l-amber-500/70";
    case "only_ledger":
      return "border-l-2 border-l-slate-400/60";
    default:
      return "";
  }
}

const BADGE_CONFIG: Record<PaneMatchStatus, { label: string; cls: string }> = {
  matched: {
    label: "Matched",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  only_file: {
    label: "Only in file",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  },
  only_ledger: {
    label: "Only in ledger",
    cls: "bg-slate-100 text-slate-600 border-slate-300",
  },
};

/** Compact status pill rendered inside a row's Type cell. Null when no status. */
export function MatchStatusBadge({
  status,
}: {
  status: PaneMatchStatus | undefined;
}) {
  if (!status) return null;
  const cfg = BADGE_CONFIG[status];
  return (
    <Badge variant="outline" className={`text-[10px] ${cfg.cls}`}>
      {cfg.label}
    </Badge>
  );
}

/** Inline legend for the two-pane toolbar so the tint colors are self-explanatory. */
export function MatchStatusLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/70" />
        Matched
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/70" />
        Only in file
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-400/60" />
        Only in ledger
      </span>
    </div>
  );
}
