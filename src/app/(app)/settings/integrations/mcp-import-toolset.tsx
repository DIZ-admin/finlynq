"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { parseSaveError } from "@/lib/save-error";
import { Loader2, Upload } from "lucide-react";

export function McpImportToolsetCard() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/mcp-import");
      if (!response.ok) {
        setError(await parseSaveError(response, "Failed to load MCP import settings"));
        return;
      }
      const body = await response.json();
      setEnabled(body?.data?.enabled === true);
    } catch {
      setError("Failed to load MCP import settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(nextEnabled: boolean) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings/mcp-import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!response.ok) {
        setError(await parseSaveError(response, "Failed to save MCP import settings"));
        return;
      }
      const body = await response.json();
      setEnabled(body?.data?.enabled === true);
    } catch {
      setError("Failed to save MCP import settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">MCP import & reconciliation</CardTitle>
            <CardDescription>
              Allow connected AI assistants to see and use the staged-import and bank-reconciliation tools.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Enable import toolset</p>
              <p className="text-xs text-muted-foreground">
                {enabled
                  ? "Enabled for OAuth, API-key, stdio, and session-cookie MCP connections."
                  : "Off by default. Import tools stay hidden from MCP connections."}
              </p>
            </div>
            <Button
              type="button"
              variant={enabled ? "default" : "outline"}
              size="sm"
              aria-pressed={enabled}
              disabled={saving}
              onClick={() => void update(!enabled)}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {enabled ? "Enabled" : "Enable"}
            </Button>
          </div>
        )}
        {error ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Enabling this does not upload or approve any statement. It only makes the tools available to an authorized MCP client.
        </p>
      </CardContent>
    </Card>
  );
}
