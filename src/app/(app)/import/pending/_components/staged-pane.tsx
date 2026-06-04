"use client";

/**
 * StagedPane — the right "From the file (staged)" pane (FINLYNQ-118 Phase 4).
 *
 * Wraps <FilePane> with its suggestions header + `rowActions` render-prop
 * (Link / Skip / Unlink / Un-skip), extracted verbatim from
 * import/pending/page.tsx. All state + callbacks are owned by the page and
 * threaded in.
 */

import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { Link as LinkIcon, X as XIcon } from "lucide-react";
import { FilePane } from "@/components/import/reconcile/file-pane";
import {
  type StagedEditableRow,
  type AccountOption as EditorAccountOption,
  type HoldingOption,
} from "@/components/staging/staged-row-editor";
import {
  SuggestionsGroup,
  type SuggestionDisplay,
} from "@/components/import/reconcile/suggestions-group";

export function StagedPane({
  stagedImportId,
  rows,
  selected,
  expanded,
  accounts,
  holdings,
  onToggleSelect,
  onToggleExpand,
  onRowUpdated,
  onStagedRowClick,
  highlightedStagedIds,
  anchorsByDate,
  displaySuggestions,
  acceptSuggestion,
  rejectSuggestion,
  busyKey,
  linkMode,
  beginLink,
  skipStagedRow,
  unskipStagedRow,
  unlinkStagedRow,
}: {
  stagedImportId: string;
  rows: StagedEditableRow[];
  selected: Set<string>;
  expanded: Set<string>;
  accounts: EditorAccountOption[];
  holdings: HoldingOption[];
  onToggleSelect: (id: string) => void;
  onToggleExpand: (rowId: string) => void;
  onRowUpdated: (updated: StagedEditableRow) => void;
  onStagedRowClick: (stagedId: string) => void;
  highlightedStagedIds: ReadonlySet<string>;
  anchorsByDate: Map<string, number>;
  displaySuggestions: SuggestionDisplay[];
  acceptSuggestion: (s: SuggestionDisplay) => void;
  rejectSuggestion: (s: SuggestionDisplay) => void;
  busyKey: string | null;
  linkMode: { stagedRowId: string } | null;
  beginLink: (stagedRowId: string) => void;
  skipStagedRow: (rowId: string) => void;
  unskipStagedRow: (rowId: string) => void;
  unlinkStagedRow: (rowId: string) => void;
}) {
  return (
    <FilePane
      stagedImportId={stagedImportId}
      rows={rows}
      selected={selected}
      expanded={expanded}
      accounts={accounts}
      holdings={holdings}
      onToggleSelect={onToggleSelect}
      onToggleExpand={onToggleExpand}
      onRowUpdated={onRowUpdated}
      onRowClick={onStagedRowClick}
      highlightedStagedIds={highlightedStagedIds}
      anchorsByDate={anchorsByDate}
      header={
        displaySuggestions.length > 0 && (
          <SuggestionsGroup
            suggestions={displaySuggestions}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            busyId={
              busyKey?.startsWith("accept:")
                ? busyKey.replace(/^accept:/, "")
                : null
            }
          />
        )
      }
      rowActions={(r) => {
        const linkBusy = busyKey === `link:${r.id}`;
        const skipBusy =
          busyKey === `skip:${r.id}` || busyKey === `unskip:${r.id}`;
        const unlinkBusy = busyKey === `unlink:${r.id}`;
        if (r.reconcileState === "linked") {
          return (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => unlinkStagedRow(r.id)}
              disabled={unlinkBusy}
              className="h-7 px-2 text-muted-foreground"
              title="Unlink"
            >
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          );
        }
        if (r.reconcileState === "skipped_duplicate") {
          return (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => unskipStagedRow(r.id)}
              disabled={skipBusy}
              className="h-7 px-2 text-muted-foreground"
              title="Un-skip"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          );
        }
        // Default state — show Link + Skip.
        return (
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => beginLink(r.id)}
              disabled={linkBusy || linkMode != null}
              className="h-7 px-2"
              title="Link to a DB row"
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => skipStagedRow(r.id)}
              disabled={skipBusy}
              className="h-7 px-2 text-muted-foreground"
              title="Mark as already imported"
            >
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      }}
    />
  );
}
