/**
 * Categories overview — pure builder.
 *
 * Feeds `GET /api/reports/categories` (the `/categories` page and the mobile
 * Category reports screen): for one month, every category of one type with
 * its amount, share of the month's total, its "usual month" (average) and a
 * small trend.
 *
 * Shares the averaging rule with the single-category view
 * (lib/reports/category-detail.ts) so the two pages agree: the average covers
 * COMPLETE months in the window BEFORE the selected month, starting from the
 * category's first activity. With the same window, a category's average here
 * equals its average on `/categories/[id]`.
 */

import { round2 } from "@/lib/utils/number";
import { shiftMonth, type CategoryType } from "./category-detail";

export interface OverviewSlice {
  categoryId: number;
  month: string; // YYYY-MM
  /** Display-currency signed amount for that slice. */
  value: number;
}

export interface OverviewCategoryInput {
  id: number;
  name: string | null;
  group: string;
}

export interface OverviewCategory {
  id: number;
  name: string | null;
  group: string;
  /** Selected month, oriented positive (spend for expenses, receipts for income). */
  amount: number;
  /** Share of the selected month's total (0..1). */
  share: number;
  average: number | null;
  /** (amount − average) ÷ average; null without an average. */
  change: number | null;
  budget: number | null;
  /** One value per window month, oldest first, selected month last. */
  trend: number[];
}

export interface CategoryOverview {
  month: string;
  /** The selected month is the current, still-running one. */
  partial: boolean;
  windowMonths: string[];
  total: number;
  averageTotal: number | null;
  categories: OverviewCategory[];
}

/** Mean of the values from the first non-zero one; null when there is none. */
export function averageFromFirstActivity(values: number[]): number | null {
  const first = values.findIndex((v) => v !== 0);
  if (first < 0) return null;
  const active = values.slice(first);
  return active.reduce((s, v) => s + v, 0) / active.length;
}

export function buildCategoryOverview(input: {
  type: CategoryType;
  month: string;
  currentMonth: string;
  months: number;
  categories: OverviewCategoryInput[];
  slices: OverviewSlice[];
  /** categoryId → budget for the selected month, display currency. */
  budgets: Map<number, number>;
}): CategoryOverview {
  const { type, month, currentMonth, months, categories, slices, budgets } = input;
  const sign = type === "I" ? 1 : -1;
  const windowMonths: string[] = [];
  for (let k = shiftMonth(month, -(months - 1)); k <= month; k = shiftMonth(k, 1)) windowMonths.push(k);
  const index = new Map(windowMonths.map((m, i) => [m, i]));

  const series = new Map<number, number[]>();
  for (const s of slices) {
    const i = index.get(s.month);
    if (i == null) continue;
    const arr = series.get(s.categoryId) ?? new Array(windowMonths.length).fill(0);
    arr[i] += sign * s.value;
    series.set(s.categoryId, arr);
  }

  const last = windowMonths.length - 1;
  const total = round2([...series.values()].reduce((s, arr) => s + arr[last], 0));

  const rows: OverviewCategory[] = [];
  for (const c of categories) {
    const arr = series.get(c.id);
    const budget = budgets.get(c.id);
    if (!arr && budget == null) continue; // nothing to say about this category
    const values = (arr ?? new Array(windowMonths.length).fill(0)).map(round2);
    const amount = values[last];
    const avg = averageFromFirstActivity(values.slice(0, last));
    rows.push({
      id: c.id,
      name: c.name,
      group: c.group,
      amount,
      share: total > 0 ? amount / total : 0,
      average: avg != null ? round2(avg) : null,
      change: avg ? (amount - avg) / Math.abs(avg) : null,
      budget: budget != null ? round2(budget) : null,
      trend: values,
    });
  }
  rows.sort((a, b) => b.amount - a.amount || (b.average ?? 0) - (a.average ?? 0));

  const monthTotals = windowMonths.map((_, i) => [...series.values()].reduce((s, arr) => s + arr[i], 0));
  const avgTotal = averageFromFirstActivity(monthTotals.slice(0, last));

  return {
    month,
    partial: month === currentMonth,
    windowMonths,
    total,
    averageTotal: avgTotal != null ? round2(avgTotal) : null,
    categories: rows,
  };
}
