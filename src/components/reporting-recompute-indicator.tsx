"use client";

/**
 * Global progress pill for the currency-rework Phase 3 reporting recompute.
 *
 * The recompute runs in the background whenever (a) the user switches display
 * currency, or (b) a self-heal fires on the Dashboard / Reports load to backfill
 * transactions whose stored reporting_amount is missing or stale. This pill
 * polls `GET /api/settings/reporting-currency/status` and surfaces "Recalculating
 * reports… (done/total)" while a job runs, then "Reports updated" briefly when it
 * finishes. It shows nothing when idle (no stale "done" — the status row carries
 * finishedAt so we only flash the completion for a few seconds).
 *
 * Mounted once in the (app) shell; checks on mount and on navigation to a
 * trigger page (after a short delay so the page's own self-heal has kicked the
 * job), and self-polls while a job is in flight.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";

type View = { running: boolean; target: string; done: number; total: number } | null;

const TRIGGER_PATHS = ["/dashboard", "/reports"];
const DONE_FLASH_MS = 8000;

export function ReportingRecomputeIndicator() {
  const [view, setView] = useState<View>(null);
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Hoisted function declaration so the poll loop can re-schedule itself
    // (a self-referencing useCallback trips the React Compiler TDZ rule).
    async function check() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        const res = await fetch("/api/settings/reporting-currency/status");
        if (!alive) return;
        if (!res.ok) {
          setView(null);
          return;
        }
        const s = await res.json();
        if (!alive) return;
        const now = Date.now();
        const started = s.startedAt ? Date.parse(s.startedAt) : 0;
        const finishedAt = s.finishedAt ? Date.parse(s.finishedAt) : 0;
        const running =
          s.inFlight === true || (!s.finished && started > 0 && now - started < 5 * 60 * 1000);
        const recentlyDone = !!s.finished && finishedAt > 0 && now - finishedAt < DONE_FLASH_MS;
        const target = s.targetCurrency ?? "";

        if (running) {
          setView({ running: true, target, done: s.done ?? 0, total: s.total ?? 0 });
          timer = setTimeout(check, 1500);
        } else if (recentlyDone) {
          setView({ running: false, target, done: s.done ?? 0, total: s.total ?? 0 });
          timer = setTimeout(() => {
            if (alive) setView(null);
          }, DONE_FLASH_MS - (now - finishedAt));
        } else {
          setView(null);
        }
      } catch {
        if (alive) setView(null);
      }
    }

    const isTrigger = TRIGGER_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
    // On a trigger page, wait briefly so the page's self-heal can start the job
    // before we poll; elsewhere check immediately (catches a switch in progress).
    const kickoff = setTimeout(check, isTrigger ? 1200 : 0);
    return () => {
      alive = false;
      clearTimeout(kickoff);
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  if (!view) return null;

  return (
    <div className="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-full bg-background px-3.5 py-2 text-xs text-muted-foreground shadow-lg ring-1 ring-foreground/10 md:bottom-4">
      {view.running ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
          <span>
            Recalculating reports{view.target ? ` in ${view.target}` : ""}
            {view.total > 0 ? ` (${view.done}/${view.total})` : "…"}
          </span>
        </>
      ) : (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>Reports updated{view.target ? ` to ${view.target}` : ""}</span>
        </>
      )}
    </div>
  );
}
