"use client";

/**
 * /admin/api-log — operator-only view of the outbound market-data API calls
 * (Yahoo / CoinGecko) recorded by `marketFetch`. Diagnostic surface: Clear the
 * log, reproduce an operation (e.g. "Rebuild investment history"), and see
 * EXACTLY which upstream APIs were hit + status + latency — even when the local
 * price_cache / fx_rates are warm. In-memory + admin-gated by the API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Activity, RefreshCw, Trash2 } from "lucide-react";

interface OutboundCall {
  id: number;
  at: string;
  provider: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  ms: number;
  error?: string;
}
interface ApiResponse {
  calls: OutboundCall[];
  meta: { count: number; cap: number };
}

const POLL_MS = 2000;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function StatusCell({ call }: { call: OutboundCall }) {
  if (call.status === 0) {
    return (
      <span className="text-rose-600" title={call.error ?? "network error / timeout"}>
        ERR
      </span>
    );
  }
  const cls = call.ok ? "text-emerald-600" : "text-amber-600";
  return <span className={cls}>{call.status}</span>;
}

export default function AdminApiLogPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/api-log", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh poll while enabled — handy to watch calls stream in live as you
  // reproduce an operation in another tab.
  useEffect(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (auto) {
      timer.current = setInterval(() => {
        void load();
      }, POLL_MS);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto, load]);

  async function confirmClear() {
    setClearing(true);
    try {
      const res = await fetch("/api/admin/api-log", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Clear failed");
      }
      setClearOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  }

  const calls = useMemo(() => data?.calls ?? [], [data]);

  // Per-provider + error counts over the buffered set.
  const summary = useMemo(() => {
    const byProvider = new Map<string, number>();
    let errors = 0;
    for (const c of calls) {
      byProvider.set(c.provider, (byProvider.get(c.provider) ?? 0) + 1);
      if (!c.ok) errors++;
    }
    return { byProvider: [...byProvider.entries()].sort((a, b) => b[1] - a[1]), errors };
  }, [calls]);

  const columns = useMemo<DataTableColumn<OutboundCall>[]>(
    () => [
      {
        key: "at",
        header: "Time",
        accessor: (r) => new Date(r.at).getTime(),
        render: (r) => (
          <span className="whitespace-nowrap">
            {fmtTime(r.at)} <span className="text-muted-foreground">({ago(r.at)})</span>
          </span>
        ),
      },
      {
        key: "provider",
        header: "Provider",
        accessor: (r) => r.provider,
        filter: "select",
        render: (r) => (
          <Badge variant="outline" className="text-[10px]">
            {r.provider}
          </Badge>
        ),
      },
      { key: "method", header: "Method", accessor: (r) => r.method },
      {
        key: "status",
        header: "Status",
        align: "right",
        accessor: (r) => r.status,
        render: (r) => <StatusCell call={r} />,
      },
      { key: "ms", header: "ms", align: "right", accessor: (r) => r.ms },
      {
        key: "url",
        header: "URL",
        accessor: (r) => r.url,
        filter: "text",
        render: (r) => (
          <span className="font-mono text-xs break-all text-muted-foreground" title={r.error ? `${r.url}\n${r.error}` : r.url}>
            {r.url}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Outbound API log</h1>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every outbound market-data call (Yahoo / CoinGecko) made by the server, newest first.
            In-memory (last {data?.meta.cap ?? 1000}, cleared on restart). To diagnose an operation:{" "}
            <span className="text-foreground">Clear</span>, reproduce it (e.g. rebuild balances),
            then <span className="text-foreground">Refresh</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Auto-refresh
          </label>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-rose-300 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900/60 dark:hover:bg-rose-950/30"
            onClick={() => setClearOpen(true)}
            disabled={calls.length === 0 || clearing}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-rose-200 bg-rose-50/30">
          <CardContent className="py-3 text-sm text-rose-700">{error}</CardContent>
        </Card>
      )}

      {/* Summary */}
      {data && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 text-sm">
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Buffered</span>
              <span className="font-semibold tabular-nums">
                {data.meta.count.toLocaleString()} / {data.meta.cap.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Errors</span>
              <span className={`font-semibold tabular-nums ${summary.errors > 0 ? "text-rose-600" : ""}`}>
                {summary.errors.toLocaleString()}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {summary.byProvider.map(([prov, n]) => (
                <Badge key={prov} variant="outline" className="text-[11px]">
                  {prov}: {n.toLocaleString()}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Calls */}
      <Card>
        <CardContent className="overflow-x-auto p-2">
          <DataTable<OutboundCall>
            columns={columns}
            rows={calls}
            rowKey={(r) => r.id}
            rowClassName={(r) => (!r.ok ? "bg-rose-500/5" : undefined)}
            emptyState={
              <p className="py-10 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "No outbound calls recorded yet. Reproduce an operation, then Refresh."}
              </p>
            }
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={(o) => { if (!o) setClearOpen(false); }}
        title="Clear API log"
        description="Clear the in-memory outbound-API log? This just resets the diagnostic buffer — it doesn't affect any cache or data."
        confirmLabel="Clear log"
        busyLabel="Clearing…"
        busy={clearing}
        onConfirm={confirmClear}
      />
    </div>
  );
}
