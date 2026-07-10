/**
 * Shared visual language for the persistent cross-pane reconciliation status
 * (see {@link computePanePairing}). Both the FilePane (staged) and BankPane
 * (bank ledger) import these so a "matched" / "only here" row reads with the
 * SAME full-row color on both sides and the eye can pair them across the gap.
 *
 *   matched      → emerald  (has a counterpart on the other side)
 *   only_file    → amber    (staged row with no bank counterpart — new)
 *   only_ledger  → slate    (bank row in the period with no file counterpart)
 *
 * The status is conveyed by a full-row background tint + the toolbar legend
 * (no per-row text pill), which keeps rows to a single uniform line so both
 * panes' rows align and more fit on screen.
 */

export type PaneMatchStatus = "matched" | "only_file" | "only_ledger";

/**
 * Full-row background tint for a row. Empty string when there's no status
 * (neutral). Semi-transparent so it works in both light and dark themes and
 * layers over the row's own hover/dim styling.
 */
export function matchRowClass(status: PaneMatchStatus | undefined): string {
  switch (status) {
    case "matched":
      return "bg-emerald-500/10";
    case "only_file":
      return "bg-amber-500/10";
    case "only_ledger":
      return "bg-slate-500/10";
    default:
      return "";
  }
}

/** Inline legend for the two-pane toolbar so the row tints are self-explanatory. */
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
