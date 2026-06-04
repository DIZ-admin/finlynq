"use client";

/**
 * UnboundPickerPane (FINLYNQ-118 Phase 4).
 *
 * 2026-05-28 — the unbound email-import path: a CSV that didn't template-match
 * at parse time renders the template/account picker INSTEAD of the panes. On
 * bind, reload detail so the picker disappears (the server stops sending
 * pickerCandidates once boundAccountId is set) and the panes render with the
 * now-bound rows. Extracted verbatim from import/pending/page.tsx.
 */

import {
  UnboundImportPicker,
} from "@/components/staging/unbound-import-picker";
import type { StagedDetail } from "../_types";

export function UnboundPickerPane({
  detail,
  openId,
  setDetail,
  setDetailLoading,
}: {
  // Caller only renders this when pickerCandidates + headers are present.
  detail: StagedDetail & {
    pickerCandidates: NonNullable<StagedDetail["pickerCandidates"]>;
  };
  openId: string | null;
  setDetail: (d: StagedDetail) => void;
  setDetailLoading: (v: boolean) => void;
}) {
  return (
    <UnboundImportPicker
      stagedImportId={detail.staged.id}
      headers={detail.staged.headers ?? []}
      sampleRows={detail.staged.sampleRows ?? []}
      accounts={detail.pickerCandidates.accounts}
      templates={detail.pickerCandidates.templates}
      fromAddress={detail.staged.fromAddress ?? null}
      subject={detail.staged.subject ?? null}
      totalRowCount={detail.staged.totalRowCount ?? detail.rows.length}
      onBound={async () => {
        // Reload detail so the picker disappears (server stops
        // sending pickerCandidates after boundAccountId is set)
        // and the panes render with the now-bound rows.
        if (openId) {
          setDetailLoading(true);
          try {
            const resp = await fetch(`/api/import/staged/${openId}`);
            if (resp.ok) {
              const data = await resp.json();
              setDetail(data);
            }
          } finally {
            setDetailLoading(false);
          }
        }
      }}
    />
  );
}
