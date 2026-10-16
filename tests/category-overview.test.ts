import { describe, it, expect } from "vitest";
import { averageFromFirstActivity, buildCategoryOverview } from "@/lib/reports/category-overview";
import { buildCategoryDetail, type CategoryTxRow } from "@/lib/reports/category-detail";

const cats = [
  { id: 1, name: "Groceries", group: "Food" },
  { id: 2, name: "Dining", group: "Food" },
  { id: 3, name: "Gym", group: "Health" },
  { id: 4, name: "Unused", group: "" },
];

describe("averageFromFirstActivity", () => {
  it("ignores leading empty months but keeps later quiet ones", () => {
    expect(averageFromFirstActivity([0, 0, 100, 0, 200])).toBe(100);
    expect(averageFromFirstActivity([0, 0])).toBeNull();
  });
});

describe("buildCategoryOverview", () => {
  const base = { type: "E" as const, month: "2026-10", currentMonth: "2026-10", months: 6, categories: cats, budgets: new Map<number, number>() };

  it("ranks the month's categories with share, usual month and change", () => {
    const o = buildCategoryOverview({
      ...base,
      slices: [
        // Groceries: 400/mo May–Sep, 300 so far in Oct.
        ...["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) => ({ categoryId: 1, month: m, value: -400 })),
        { categoryId: 1, month: "2026-10", value: -300 },
        // Dining: started in Sep (100), 100 in Oct.
        { categoryId: 2, month: "2026-09", value: -100 },
        { categoryId: 2, month: "2026-10", value: -100 },
        // Gym: only in the past.
        { categoryId: 3, month: "2026-06", value: -50 },
        // Outside the window — ignored.
        { categoryId: 1, month: "2026-04", value: -9999 },
      ],
    });
    expect(o.windowMonths).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(o.partial).toBe(true);
    expect(o.total).toBe(400);
    expect(o.categories.map((c) => [c.name, c.amount, c.average])).toEqual([
      ["Groceries", 300, 400],
      ["Dining", 100, 100],
      ["Gym", 0, 12.5], // (50 + 0 + 0 + 0) / 4 from June
    ]);
    expect(o.categories[0].share).toBe(0.75);
    expect(o.categories[0].change).toBe(-0.25);
    expect(o.categories[0].trend).toEqual([400, 400, 400, 400, 400, 300]);
    // A category with no activity and no budget isn't listed.
    expect(o.categories.find((c) => c.name === "Unused")).toBeUndefined();
    // Usual month total: May 400, Jun 450 (Gym 50), Jul 400, Aug 400, Sep 500 → 2150 / 5.
    expect(o.averageTotal).toBe(430);
  });

  it("lists a budgeted category even before anything is spent", () => {
    const o = buildCategoryOverview({ ...base, slices: [], budgets: new Map([[4, 80]]) });
    expect(o.categories).toEqual([
      expect.objectContaining({ name: "Unused", amount: 0, budget: 80, average: null, change: null }),
    ]);
    expect(o.total).toBe(0);
  });

  it("orients income positive", () => {
    const o = buildCategoryOverview({
      ...base,
      type: "I",
      categories: [{ id: 9, name: "Salary", group: "" }],
      slices: [{ categoryId: 9, month: "2026-09", value: 5000 }, { categoryId: 9, month: "2026-10", value: 5200 }],
    });
    expect(o.categories[0]).toMatchObject({ amount: 5200, average: 5000, change: 0.04 });
  });

  it("agrees with the single-category view's average for the same window", () => {
    // Same data through both builders: overview month = current month, same 12-month window.
    let id = 1;
    const tx = (date: string, amount: number): CategoryTxRow => ({
      id: id++, date, payee: "x", amount, currency: "USD", reportingAmount: null, reportingCurrency: null, accountName: null,
    });
    const rows = [tx("2026-03-10", -120), tx("2026-05-02", -80), tx("2026-08-20", -200), tx("2026-10-05", -40)];
    const detail = buildCategoryDetail({ type: "E", rows, budgets: new Map(), today: "2026-10-12", months: 12, toDisplay: (r) => r.amount, typeTotal: 0 });
    const overview = buildCategoryOverview({
      ...base,
      months: 12,
      categories: [{ id: 1, name: "X", group: "" }],
      slices: rows.map((r) => ({ categoryId: 1, month: r.date.slice(0, 7), value: r.amount })),
    });
    expect(overview.categories[0].average).toBe(detail.stats.averageMonthly);
  });
});
