import { describe, it, expect } from "vitest";
import {
  buildCategoryDetail,
  categoryWindow,
  shiftMonth,
  type CategoryTxRow,
} from "@/lib/reports/category-detail";

let nextId = 1;
const tx = (date: string, amount: number, payee: string | null = "Store", over: Partial<CategoryTxRow> = {}): CategoryTxRow => ({
  id: nextId++,
  date,
  payee,
  amount,
  currency: "USD",
  reportingAmount: null,
  reportingCurrency: null,
  accountName: "Visa",
  ...over,
});

// Identity conversion unless a test overrides it.
const native = (r: CategoryTxRow) => r.amount;

describe("category window", () => {
  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", -12)).toBe("2025-10");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });

  it("always queries back far enough for a same-month-last-year comparison", () => {
    expect(categoryWindow("2026-10-01", 6)).toEqual({
      currentMonth: "2026-10",
      windowStartMonth: "2026-05",
      windowStart: "2026-05-01",
      queryStart: "2025-10-01",
    });
    expect(categoryWindow("2026-10-01", 24).queryStart).toBe("2024-11-01");
  });
});

describe("buildCategoryDetail", () => {
  const today = "2026-10-12";

  it("orients expense amounts positive and nets refunds", () => {
    const d = buildCategoryDetail({
      type: "E",
      rows: [tx("2026-09-03", -100), tx("2026-09-20", 30, "Store")], // refund
      budgets: new Map(),
      today,
      months: 6,
      toDisplay: native,
      typeTotal: 700,
    });
    expect(d.months.map((m) => m.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(d.stats.lastMonth).toBe(70);
    expect(d.stats.total).toBe(70);
    expect(d.stats.shareOfType).toBeCloseTo(0.1, 10);
    expect(d.months.at(-1)?.partial).toBe(true);
  });

  it("orients income amounts positive", () => {
    const d = buildCategoryDetail({
      type: "I",
      rows: [tx("2026-09-15", 3200, "Acme"), tx("2026-10-01", 3200, "Acme")],
      budgets: new Map(),
      today,
      months: 6,
      toDisplay: native,
      typeTotal: 6400,
    });
    expect(d.stats.thisMonth).toBe(3200);
    expect(d.stats.lastMonth).toBe(3200);
    expect(d.stats.shareOfType).toBe(1);
  });

  it("averages complete months only, from the category's first activity", () => {
    const d = buildCategoryDetail({
      type: "E",
      // Nothing in May/June (category didn't exist yet); July 100, Aug 0 (a real quiet month), Sept 200; Oct partial 999.
      rows: [tx("2026-07-10", -100), tx("2026-09-10", -200), tx("2026-10-05", -999)],
      budgets: new Map(),
      today,
      months: 6,
      toDisplay: native,
      typeTotal: 0,
    });
    // (100 + 0 + 200) / 3 — May/June excluded, August's zero kept, October excluded.
    expect(d.stats.averageMonthly).toBe(100);
    expect(d.stats.medianMonthly).toBe(100);
    expect(d.stats.highestMonth).toEqual({ month: "2026-09", amount: 200 });
    expect(d.stats.shareOfType).toBeNull();
  });

  it("compares with the same month last year even in a 6-month view", () => {
    const d = buildCategoryDetail({
      type: "E",
      rows: [tx("2025-10-08", -55), tx("2026-10-02", -20)],
      budgets: new Map(),
      today,
      months: 6,
      toDisplay: native,
      typeTotal: 20,
    });
    expect(d.stats.sameMonthLastYear).toBe(55);
    // Last year's row is outside the 6-month window: not in totals, payees or recent.
    expect(d.stats.total).toBe(20);
    expect(d.stats.transactionCount).toBe(1);
    expect(d.recent).toHaveLength(1);
  });

  it("uses the converter for every money figure (FINLYNQ-123)", () => {
    // EUR rows converted at 1.1; the stored reporting amount wins when present.
    const toDisplay = (r: CategoryTxRow) => (r.reportingAmount != null ? r.reportingAmount : r.amount * 1.1);
    const d = buildCategoryDetail({
      type: "E",
      rows: [
        tx("2026-09-01", -100, "Rent", { currency: "EUR" }),
        tx("2026-09-02", -100, "Rent", { currency: "EUR", reportingAmount: -105, reportingCurrency: "USD" }),
      ],
      budgets: new Map([["2026-09", 250]]),
      today,
      months: 6,
      toDisplay,
      typeTotal: 215,
    });
    expect(d.stats.lastMonth).toBe(215);
    expect(d.topPayees[0]).toMatchObject({ payee: "Rent", amount: 215, count: 2, share: 1 });
    // Recent rows stay NATIVE (shown in their own currency).
    expect(d.recent.map((r) => [r.amount, r.currency])).toEqual([[-100, "EUR"], [-100, "EUR"]]);
    expect(d.hasBudget).toBe(true);
    expect(d.months.find((m) => m.month === "2026-09")?.budget).toBe(250);
  });

  it("ranks payees case-insensitively and labels missing ones", () => {
    const d = buildCategoryDetail({
      type: "E",
      rows: [tx("2026-09-01", -10, "Uber"), tx("2026-09-05", -15, "UBER "), tx("2026-09-06", -50, "Metro"), tx("2026-09-07", -5, null)],
      budgets: new Map(),
      today,
      months: 6,
      toDisplay: native,
      typeTotal: 80,
    });
    expect(d.topPayees.map((p) => [p.payee, p.amount, p.count])).toEqual([
      ["Metro", 50, 1],
      ["Uber", 25, 2],
      ["(no payee)", 5, 1],
    ]);
  });

  it("ignores future-dated rows", () => {
    const d = buildCategoryDetail({
      type: "E",
      rows: [tx("2026-10-30", -500)],
      budgets: new Map(),
      today,
      months: 6,
      toDisplay: native,
      typeTotal: 0,
    });
    expect(d.stats.thisMonth).toBe(0);
    expect(d.stats.transactionCount).toBe(0);
  });
});
