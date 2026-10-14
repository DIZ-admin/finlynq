"use client";

/**
 * Categories overview — where the money went in a month, and how each
 * category compares with its usual month. Every row opens the single-category
 * view (`/categories/[id]`). Data: GET /api/reports/categories (math in
 * lib/reports/category-overview.ts, averaging shared with the detail view).
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/error-state";
import { PageSkeleton } from "@/components/page-skeleton";
import { Sparkline } from "@/components/sparkline";
import { formatCurrency } from "@/lib/currency";
import { CHART_COLORS } from "@/lib/chart-colors";
import { localDateISO } from "@/lib/utils/date";
import { shiftMonth } from "@/lib/reports/category-detail";
import type { CategoryOverview } from "@/lib/reports/category-overview";
import { ChevronLeft, ChevronRight } from "lucide-react";

type OverviewResponse = CategoryOverview & { type: "E" | "I"; displayCurrency: string };

const TOP_SEGMENTS = 6;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthName(key: string, style: "long" | "short" = "long"): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: style,
    year: style === "long" ? "numeric" : "2-digit",
    timeZone: "UTC",
  });
}

function changeLabel(change: number | null): string | null {
  if (change == null || !Number.isFinite(change)) return null;
  const pct = Math.round(change * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export default function CategoriesPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="list" rows={6} />}>
      <CategoriesOverview />
    </Suspense>
  );
}

function CategoriesOverview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentMonth = localDateISO().slice(0, 7);
  const monthParam = searchParams.get("month");
  const month = monthParam && MONTH_RE.test(monthParam) && monthParam <= currentMonth ? monthParam : currentMonth;
  const type: "E" | "I" = searchParams.get("type") === "I" ? "I" : "E";

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/reports/categories?month=${month}&type=${type}&months=12`);
      if (!res.ok) throw new Error("load failed");
      setData((await res.json()).data as OverviewResponse);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [month, type]);

  useEffect(() => {
    load();
  }, [load]);

  function go(next: { month?: string; type?: "E" | "I" }) {
    const m = next.month ?? month;
    const t = next.type ?? type;
    const qs = new URLSearchParams();
    if (m !== currentMonth) qs.set("month", m);
    if (t === "I") qs.set("type", "I");
    router.replace(`/categories${qs.toString() ? `?${qs}` : ""}`, { scroll: false });
  }

  if (loading && !data) return <PageSkeleton variant="list" rows={6} />;
  if (failed || !data) {
    return <ErrorState title="Couldn't load categories" message="Please try again." onRetry={load} />;
  }

  const cur = data.displayCurrency;
  const isIncome = type === "I";
  const noun = isIncome ? "income" : "spending";
  const totalChange = data.averageTotal ? (data.total - data.averageTotal) / data.averageTotal : null;
  const active = data.categories.filter((c) => c.amount > 0);
  const segments = active.slice(0, TOP_SEGMENTS);
  const otherAmount = active.slice(TOP_SEGMENTS).reduce((s, c) => s + c.amount, 0);
  const color = (i: number) => CHART_COLORS.categories[i % CHART_COLORS.categories.length];
  const sparkLabels = data.windowMonths.map((m) => monthName(m, "short"));
  // Up is bad for spending, good for income.
  const toneFor = (change: number | null) =>
    change == null ? "text-muted-foreground" : (change > 0) === isIncome ? "text-emerald-600" : "text-rose-600";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Where your money goes, and how each category compares with a usual month.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={type} onValueChange={(v) => go({ type: v === "I" ? "I" : "E" })}>
            <TabsList>
              <TabsTrigger value="E" className="px-3">Spending</TabsTrigger>
              <TabsTrigger value="I" className="px-3">Income</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => go({ month: shiftMonth(month, -1) })}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">{monthName(month)}</span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              disabled={month >= currentMonth}
              onClick={() => go({ month: shiftMonth(month, 1) })}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Month summary + where it went */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                {isIncome ? "Income" : "Spending"} in {monthName(month)}{data.partial ? " so far" : ""}
              </p>
              <p className="text-3xl font-bold tabular-nums">{formatCurrency(data.total, cur)}</p>
            </div>
            {data.averageTotal != null && (
              <p className="text-sm text-muted-foreground">
                Usual month {formatCurrency(data.averageTotal, cur)}
                {changeLabel(totalChange) && (
                  <span className={`ml-1.5 font-medium ${toneFor(totalChange)}`}>{changeLabel(totalChange)}</span>
                )}
              </p>
            )}
          </div>
          {active.length > 0 ? (
            <>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Where your ${noun} went`}>
                {segments.map((c, i) => (
                  <div key={c.id} style={{ width: `${c.share * 100}%`, backgroundColor: color(i) }} title={`${c.name ?? "Category"}: ${formatCurrency(c.amount, cur)}`} />
                ))}
                {otherAmount > 0 && data.total > 0 && (
                  <div style={{ width: `${(otherAmount / data.total) * 100}%`, backgroundColor: CHART_COLORS.categories[11] }} title={`Other: ${formatCurrency(otherAmount, cur)}`} />
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                {segments.map((c, i) => (
                  <span key={c.id} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color(i) }} />
                    {c.name ?? "Category"} {Math.round(c.share * 100)}%
                  </span>
                ))}
                {otherAmount > 0 && data.total > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.categories[11] }} />
                    Other {Math.round((otherAmount / data.total) * 100)}%
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No {noun} recorded in {monthName(month)} yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Category list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">By category</CardTitle>
          <CardDescription>
            Compared with each category&apos;s average over the previous complete months (up to 11) · {cur}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          {data.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2">No categories with {noun} in the last 12 months.</p>
          ) : (
            <ul className="divide-y">
              {data.categories.map((c) => {
                const segIdx = segments.findIndex((s) => s.id === c.id);
                const dot = segIdx >= 0 ? color(segIdx) : CHART_COLORS.categories[11];
                // Nothing yet this month reads as "none", not a green "-100%".
                const none = c.amount === 0;
                const ch = none ? (data.partial ? "none yet" : "none") : changeLabel(c.change);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/categories/${c.id}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-lg px-2 py-3 hover:bg-muted/40"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{c.name ?? "Category"}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {c.group ? `${c.group} · ` : ""}
                            {c.average != null ? `usually ${formatCurrency(c.average, cur)}` : "new this period"}
                            {c.budget != null ? ` · budget ${formatCurrency(c.budget, cur)}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="hidden sm:block">
                        <Sparkline data={c.trend} color={isIncome ? CHART_COLORS.positive : CHART_COLORS.negative} labels={sparkLabels} currency={cur} />
                      </div>
                      <div className="hidden sm:block">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, c.share * 100)}%`, backgroundColor: dot }} />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">{Math.round(c.share * 100)}% of {monthName(month, "short")}</p>
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">{formatCurrency(c.amount, cur)}</p>
                          {ch && (
                            <p className={`text-xs font-medium tabular-nums ${none ? "text-muted-foreground" : toneFor(c.change)}`}>
                              {none ? ch : `${ch} vs usual`}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.partial && (
        <p className="text-xs text-muted-foreground">
          {monthName(month)} is still running, so its amounts are month-to-date. Amounts are in {cur}, converted at each transaction&apos;s historical rate.
        </p>
      )}
    </div>
  );
}
