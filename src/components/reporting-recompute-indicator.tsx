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
import { Loader2, CheckCircle2 } from "lucide-react";

type View = { running: boolean; target: string; done: number; total: number } | null;

const DONE_FLASH_MS = 8000;
const IDLE_POLL_MS = 5000; // catch a job within ~5s of it starting (any source)
const RUN_POLL_MS = 1500; // tighter cadence while a job is in flight / flashing done

export function ReportingRecomputeIndicator() {
  const [view, setView] = useState<View>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Self-scheduling poll. Continuous (cheap single-row read) so it reliably
    // catches a recompute regardless of which page/source kicked it — a
    // dashboard/reports self-heal or a Settings currency switch — without a
    // race against when the job actually starts. Hoisted function declaration
    // so it can re-schedule itself (a self-referencing useCallback trips the
    // React Compiler TDZ rule).
    async function poll() {
      let next = IDLE_POLL_MS;
      try {
        const res = await fetch("/api/settings/reporting-currency/status");
        if (!alive) return;
        if (res.ok) {
          const s = await res.json();
          const now = Date.now();
          const started = s.startedAt ? Date.parse(s.startedAt) : 0;
          const finishedAt = s.finishedAt ? Date.parse(s.finishedAt) : 0;
          const running =
            s.inFlight === true || (!s.finished && started > 0 && now - started < 5 * 60 * 1000);
          const recentlyDone = !!s.finished && finishedAt > 0 && now - finishedAt < DONE_FLASH_MS;
          const target = s.targetCurrency ?? "";

          if (running) {
            setView({ running: true, target, done: s.done ?? 0, total: s.total ?? 0 });
            next = RUN_POLL_MS;
          } else if (recentlyDone) {
            setView({ running: false, target, done: s.done ?? 0, total: s.total ?? 0 });
            next = RUN_POLL_MS;
          } else {
            setView(null);
          }
        }
      } catch {
        /* keep polling at idle cadence */
      }
      if (alive) timer = setTimeout(poll, next);
    }

    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

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
