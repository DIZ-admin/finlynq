"use client";

/**
 * /settings/backfill/[runId] — two-pane review for a backfill run.
 *
 * Left pane: proposal list with confidence chips + summary
 * Right pane: detail view of selected proposal
 *   - displaced rows → replacement rows
 *   - drift proposals: two-radio variant picker
 *   - dependency callout if a dependent is checked without parents
 *
 * Live feature doc: pf-app/docs/architecture/backfill.md.
 */

import { useState, useEffect, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Undo2 } from "lucide-react";

interface Proposal {
  id: number;
  runId: string;
  proposalKind: string;
  confidence: "high" | "medium" | "low" | "refused";
  refusalReason: string | null;
  summary: string;
  existingRowIds: number[];
  // For non-drift: ReplacementRow[]; for drift: { separate_fee_row: DriftVariant; absorb_into_cost: DriftVariant }
  replacementRowsJson: unknown;
  synthesizedRowsJson: unknown;
  deltasJson: { balance: number; lots: Array<{ holdingId: number; qtyDelta: number }>; realizedGainBase: number | null };
  dependsOnProposalIds: number[];
  variantChoice: "separate_fee_row" | "absorb_into_cost" | null;
  status: string;
}

export default function BackfillReviewPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  async function loadProposals() {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/backfill/${runId}`);
      const data = await res.json();
      setProposals(data.proposals ?? []);
      if ((data.proposals ?? []).length > 0 && selectedId == null) {
        setSelectedId(data.proposals[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load proposals");
    }
    setLoading(false);
  }

  useEffect(() => { loadProposals(); }, [runId]);

  async function updateProposal(proposalId: number, patch: { status?: string; variantChoice?: string | null }) {
    setError("");
    const res = await fetch(`/api/settings/backfill/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId, ...patch }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err?.error ?? `HTTP ${res.status}`);
      return false;
    }
    await loadProposals();
    return true;
  }

  async function applyAll() {
    setApplying(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch(`/api/settings/backfill/${runId}/apply`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.failed?.message ?? data?.error ?? `HTTP ${res.status}`);
      } else {
        setInfo(`Applied ${data.applied.length} proposal(s).`);
      }
      await loadProposals();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    }
    setApplying(false);
  }

  async function undoProposal(proposalId: number) {
    setError("");
    setInfo("");
    const res = await fetch(`/api/settings/backfill/${runId}/undo/${proposalId}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.message ?? data?.error ?? `HTTP ${res.status}`);
    } else {
      setInfo(`Undone proposal #${proposalId}.`);
    }
    await loadProposals();
  }

  const selected = useMemo(() => proposals.find((p) => p.id === selectedId) ?? null, [proposals, selectedId]);
  const approvedCount = proposals.filter((p) => p.status === "approved").length;
  const appliedCount = proposals.filter((p) => p.status === "applied").length;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Backfill review</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {proposals.length} proposal(s) · {approvedCount} approved · {appliedCount} applied
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/settings/backfill")}>
            <RefreshCw className="size-4 mr-2" /> New run
          </Button>
          <Button onClick={applyAll} disabled={applying || approvedCount === 0}>
            {applying ? (<><Loader2 className="size-4 animate-spin mr-2" /> Applying…</>) : `Apply ${approvedCount} approved`}
          </Button>
        </div>
      </div>

      {error && <div className="border border-destructive bg-destructive/10 text-destructive rounded p-3 text-sm">{error}</div>}
      {info && <div className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded p-3 text-sm flex items-center gap-2"><CheckCircle2 className="size-4" /> {info}</div>}

      {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>}

      {!loading && proposals.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No proposals — your ledger appears already canonical. Great!
          </CardContent>
        </Card>
      )}

      {!loading && proposals.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {/* LEFT: proposal list */}
          <div className="col-span-5 space-y-2 max-h-[70vh] overflow-y-auto pr-2">
            {proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
                onToggleApprove={() => updateProposal(p.id, { status: p.status === "approved" ? "pending" : "approved" })}
              />
            ))}
          </div>

          {/* RIGHT: detail */}
          <div className="col-span-7">
            {selected ? (
              <ProposalDetail
                proposal={selected}
                onVariantChange={(v) => updateProposal(selected.id, { variantChoice: v })}
                onApprove={() => updateProposal(selected.id, { status: "approved" })}
                onReject={() => updateProposal(selected.id, { status: "rejected" })}
                onUndo={() => undoProposal(selected.id)}
              />
            ) : (
              <Card><CardContent className="py-8 text-center text-muted-foreground">Select a proposal to view detail.</CardContent></Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  selected,
  onSelect,
  onToggleApprove,
}: {
  proposal: Proposal;
  selected: boolean;
  onSelect: () => void;
  onToggleApprove: () => void;
}) {
  const isApproved = proposal.status === "approved";
  const isApplied = proposal.status === "applied";
  const isRefused = proposal.confidence === "refused";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
    >
      <div className="flex items-start gap-2">
        {!isRefused && !isApplied && (
          <input
            type="checkbox"
            checked={isApproved}
            onChange={(e) => { e.stopPropagation(); onToggleApprove(); }}
            onClick={(e) => e.stopPropagation()}
            className="mt-1"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <ConfidenceBadge confidence={proposal.confidence} />
            <Badge variant="outline" className="text-xs">{proposal.proposalKind}</Badge>
            {isApplied && <Badge className="text-xs bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40">Applied</Badge>}
          </div>
          <div className="text-sm font-medium mt-1.5 truncate">{proposal.summary}</div>
          <div className="text-xs text-muted-foreground mt-1 flex gap-3">
            <span>Δ balance: {proposal.deltasJson.balance.toFixed(2)}</span>
            {proposal.deltasJson.realizedGainBase != null && <span>realized: {proposal.deltasJson.realizedGainBase.toFixed(2)}</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

function ConfidenceBadge({ confidence }: { confidence: Proposal["confidence"] }) {
  const styles: Record<Proposal["confidence"], string> = {
    high: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
    medium: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40",
    low: "bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/40",
    refused: "bg-destructive/20 text-destructive border-destructive/40",
  };
  return <Badge className={`text-xs ${styles[confidence]}`}>{confidence}</Badge>;
}

function ProposalDetail({
  proposal,
  onVariantChange,
  onApprove,
  onReject,
  onUndo,
}: {
  proposal: Proposal;
  onVariantChange: (v: "separate_fee_row" | "absorb_into_cost" | null) => void;
  onApprove: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  const isDrift = proposal.proposalKind === "drift";
  const isRefused = proposal.confidence === "refused";
  const isApplied = proposal.status === "applied";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{proposal.summary}</CardTitle>
          <div className="flex gap-2">
            {!isApplied && !isRefused && (
              <>
                <Button size="sm" variant="outline" onClick={onReject}>Reject</Button>
                <Button size="sm" onClick={onApprove} disabled={proposal.status === "approved"}>Approve</Button>
              </>
            )}
            {isApplied && (
              <Button size="sm" variant="outline" onClick={onUndo}><Undo2 className="size-4 mr-1" /> Undo</Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {isRefused && (
          <div className="border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded p-3 flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Refused: {proposal.refusalReason ?? "no reason"}</div>
              <div className="text-xs mt-1 opacity-80">This proposal can&apos;t be applied automatically. Resolve the underlying issue in /transactions, then re-run the backfill.</div>
            </div>
          </div>
        )}

        {proposal.dependsOnProposalIds.length > 0 && (
          <div className="border border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 rounded p-3 text-xs">
            Depends on proposal(s): #{proposal.dependsOnProposalIds.join(", #")}. Apply those first.
          </div>
        )}

        <DisplacedRows ids={proposal.existingRowIds} />

        {isDrift && (
          <div className="space-y-2">
            <div className="font-medium">Pick fee handling</div>
            <DriftVariantPicker
              proposal={proposal}
              onChange={onVariantChange}
            />
          </div>
        )}

        {!isDrift && (
          <ReplacementPreview proposal={proposal} />
        )}

        <DeltasPanel deltas={proposal.deltasJson} />
      </CardContent>
    </Card>
  );
}

function DisplacedRows({ ids }: { ids: number[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Existing rows being displaced</div>
      <div className="rounded border bg-muted/30 p-2 text-xs font-mono">
        {ids.length === 0 ? <span className="text-muted-foreground">none</span> : ids.map((id) => `Tx #${id}`).join(", ")}
      </div>
    </div>
  );
}

function ReplacementPreview({ proposal }: { proposal: Proposal }) {
  const rows = (proposal.replacementRowsJson as Array<Record<string, unknown>> | null) ?? [];
  const synth = (proposal.synthesizedRowsJson as Array<Record<string, unknown>> | null) ?? [];
  return (
    <div className="space-y-2">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Will become</div>
        <pre className="rounded border bg-muted/30 p-2 text-xs overflow-x-auto">{JSON.stringify(rows, null, 2)}</pre>
      </div>
      {synth.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Synthesized rows (new)</div>
          <pre className="rounded border bg-amber-500/10 border-amber-500/40 p-2 text-xs overflow-x-auto">{JSON.stringify(synth, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function DriftVariantPicker({
  proposal,
  onChange,
}: {
  proposal: Proposal;
  onChange: (v: "separate_fee_row" | "absorb_into_cost") => void;
}) {
  const variants = proposal.replacementRowsJson as {
    separate_fee_row?: { explanation: string };
    absorb_into_cost?: { explanation: string };
  } | null;
  if (!variants) return null;
  const selected = proposal.variantChoice;
  return (
    <div className="space-y-2">
      <VariantOption
        label="Book separate fee row"
        explanation={variants.separate_fee_row?.explanation ?? ""}
        selected={selected === "separate_fee_row"}
        onSelect={() => onChange("separate_fee_row")}
      />
      <VariantOption
        label="Absorb into cost basis"
        explanation={variants.absorb_into_cost?.explanation ?? ""}
        selected={selected === "absorb_into_cost"}
        onSelect={() => onChange("absorb_into_cost")}
      />
    </div>
  );
}

function VariantOption({ label, explanation, selected, onSelect }: { label: string; explanation: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded border p-2 ${
        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className={`mt-1 size-3 rounded-full ${selected ? "bg-primary" : "border border-border"}`} />
        <div>
          <div className="font-medium text-xs">{label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{explanation}</div>
        </div>
      </div>
    </button>
  );
}

function DeltasPanel({ deltas }: { deltas: Proposal["deltasJson"] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Impact</div>
      <div className="rounded border bg-muted/30 p-2 text-xs space-y-1">
        <div>Account balance delta: <span className="font-mono">{deltas.balance.toFixed(2)}</span></div>
        {deltas.realizedGainBase != null && (
          <div>Realized gain (base): <span className="font-mono">{deltas.realizedGainBase.toFixed(2)}</span></div>
        )}
        {deltas.lots.length > 0 && (
          <div>Lot effects: {deltas.lots.map((l) => `holding #${l.holdingId} qty ${l.qtyDelta > 0 ? "+" : ""}${l.qtyDelta}`).join(", ")}</div>
        )}
      </div>
    </div>
  );
}
