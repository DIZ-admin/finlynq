"use client";

/**
 * /settings/bank-feeds — SimpleFIN bank feed (on-demand sync).
 *
 * Paste a SimpleFIN setup token to connect, then "Sync now" pulls the last ~90
 * days into the bank ledger. Those rows appear on the /import reconciliation
 * page for matching against your ledger transactions. On-demand only (no
 * background pull) — the access URL is encrypted under your DEK, which is only
 * available while you're logged in. See finlynq-cloud/plan/simplefin-bank-feed.md.
 *
 * Follows the settings-page convention: bespoke fetch/useState/useEffect (no
 * SWR), shared ConfirmDialog for the destructive disconnect, parseSaveError for
 * failed mutations.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { parseSaveError } from "@/lib/save-error";
import { cn } from "@/lib/utils";
import { Landmark, Loader2, RefreshCw, CheckCircle2, ExternalLink } from "lucide-react";

interface SimplefinStatus {
  connected: boolean;
  lastSyncAt: string | null;
}

interface SyncResult {
  accountsSynced: number;
  accountsCreated: number;
  imported: number;
  duplicates: number;
  skippedPending: number;
  errors: string[];
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function BankFeedsSettingsPage() {
  const [status, setStatus] = useState<SimplefinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/settings/bank-feeds/simplefin/status");
      if (!res.ok) {
        setLoadError(await parseSaveError(res, "Failed to load bank feed status"));
        setStatus(null);
        return;
      }
      setStatus(await res.json());
    } catch {
      setLoadError("Failed to load bank feed status");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConnect() {
    if (!token.trim()) return;
    setConnecting(true);
    setConnectError("");
    try {
      const res = await fetch("/api/settings/bank-feeds/simplefin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken: token.trim() }),
      });
      if (!res.ok) {
        setConnectError(await parseSaveError(res, "Failed to connect"));
        return;
      }
      setToken("");
      await load();
    } catch {
      setConnectError("Failed to connect");
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError("");
    setSyncResult(null);
    try {
      const res = await fetch("/api/settings/bank-feeds/simplefin/sync", { method: "POST" });
      if (!res.ok) {
        setSyncError(await parseSaveError(res, "Sync failed"));
        return;
      }
      setSyncResult(await res.json());
      await load();
    } catch {
      setSyncError("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/settings/bank-feeds/simplefin/disconnect", {
        method: "DELETE",
      });
      if (!res.ok) return;
      setConfirmDisconnect(false);
      setSyncResult(null);
      await load();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bank feeds</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pull transactions automatically from your bank via SimpleFIN
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              <Landmark className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                SimpleFIN
                {status?.connected && (
                  <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-600/40">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                An open bank-feed protocol. You link your banks at simplefin.org ($15/yr, paid
                directly to SimpleFIN) and paste a one-time setup token here. Synced transactions
                land in your bank ledger for reconciliation — Finlynq never sees your bank login.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : loadError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="outline" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          ) : status?.connected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {status.lastSyncAt
                    ? `Last synced ${formatDateTime(status.lastSyncAt)}`
                    : "Not synced yet"}
                </p>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleSync} disabled={syncing}>
                    {syncing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Syncing…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-1.5" /> Sync now
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDisconnect(true)}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>

              {syncError && <p className="text-sm text-destructive">{syncError}</p>}

              {syncResult && (
                <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium">Sync complete</p>
                  <p className="text-sm text-muted-foreground">
                    {syncResult.imported} imported · {syncResult.duplicates} already known ·{" "}
                    {syncResult.accountsCreated} account
                    {syncResult.accountsCreated === 1 ? "" : "s"} created
                    {syncResult.skippedPending > 0
                      ? ` · ${syncResult.skippedPending} pending skipped`
                      : ""}
                  </p>
                  {syncResult.errors.length > 0 && (
                    <p className="text-xs text-amber-600">
                      {syncResult.errors.length} warning
                      {syncResult.errors.length === 1 ? "" : "s"}: {syncResult.errors[0]}
                    </p>
                  )}
                  <Link
                    href="/import"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Reconcile in Import <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <label htmlFor="simplefin-token" className="block text-sm font-medium">
                Setup token
              </label>
              <textarea
                id="simplefin-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                rows={3}
                placeholder="Paste your SimpleFIN setup token…"
                className={cn(
                  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm font-mono transition-colors outline-none",
                  "placeholder:text-muted-foreground placeholder:font-sans focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  "disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30",
                )}
                disabled={connecting}
              />
              {connectError && <p className="text-sm text-destructive">{connectError}</p>}
              <div className="flex items-center justify-between gap-3">
                <a
                  href="https://beta-bridge.simplefin.org/"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Where do I get a token? <ExternalLink className="h-3 w-3" />
                </a>
                <Button size="sm" onClick={handleConnect} disabled={connecting || !token.trim()}>
                  {connecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Connecting…
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect SimpleFIN"
        description={
          <>
            Disconnect SimpleFIN? Your stored access is removed and no more transactions will be
            pulled. Already-imported bank transactions are kept — you can reconnect later with a new
            setup token.
          </>
        }
        confirmLabel="Disconnect"
        busyLabel="Disconnecting…"
        busy={disconnecting}
        onConfirm={handleDisconnect}
      />
    </div>
  );
}
