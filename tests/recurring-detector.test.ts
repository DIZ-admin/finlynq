import { describe, it, expect } from "vitest";
import { detectRecurringTransactions, forecastCashFlow } from "@/lib/recurring-detector";

function makeTxn(id: number, date: string, payee: string, amount: number, currency = "CAD") {
  return { id, date, payee, amount, currency, accountId: 1, categoryId: 1 };
}

describe("detectRecurringTransactions", () => {
  it("detects monthly recurring transactions", () => {
    const txns = [
      makeTxn(1, "2024-01-15", "Netflix", -15.99),
      makeTxn(2, "2024-02-15", "Netflix", -15.99),
      makeTxn(3, "2024-03-15", "Netflix", -15.99),
      makeTxn(4, "2024-04-15", "Netflix", -15.99),
    ];
    const result = detectRecurringTransactions(txns);
    expect(result.length).toBe(1);
    expect(result[0].payee).toBe("Netflix");
    expect(result[0].frequency).toBe("monthly");
    expect(result[0].avgAmount).toBe(-15.99);
    expect(result[0].count).toBe(4);
  });

  it("detects weekly recurring transactions", () => {
    const txns = [];
    for (let i = 0; i < 5; i++) {
      txns.push(makeTxn(i, `2024-01-${String(1 + i * 7).padStart(2, "0")}`, "Gym", -10));
    }
    const result = detectRecurringTransactions(txns);
    expect(result.length).toBe(1);
    expect(result[0].frequency).toBe("weekly");
  });

  it("rejects inconsistent amounts (>20% variance)", () => {
    const txns = [
      makeTxn(1, "2024-01-15", "Store", -50),
      makeTxn(2, "2024-02-15", "Store", -200),
      makeTxn(3, "2024-03-15", "Store", -10),
    ];
    const result = detectRecurringTransactions(txns);
    expect(result.length).toBe(0);
  });

  it("requires at least 3 transactions", () => {
    const txns = [
      makeTxn(1, "2024-01-15", "Netflix", -15.99),
      makeTxn(2, "2024-02-15", "Netflix", -15.99),
    ];
    expect(detectRecurringTransactions(txns)).toEqual([]);
  });

  it("skips empty payees", () => {
    const txns = [
      makeTxn(1, "2024-01-15", "", -100),
      makeTxn(2, "2024-02-15", "", -100),
      makeTxn(3, "2024-03-15", "", -100),
    ];
    expect(detectRecurringTransactions(txns)).toEqual([]);
  });

  it("calculates next date", () => {
    const txns = [
      makeTxn(1, "2024-01-15", "Netflix", -15.99),
      makeTxn(2, "2024-02-15", "Netflix", -15.99),
      makeTxn(3, "2024-03-15", "Netflix", -15.99),
    ];
    const result = detectRecurringTransactions(txns);
    expect(result[0].nextDate).toBe("2024-04-15");
  });

  // feedback #7 — the detector used to drop the transaction currency entirely,
  // so every suggestion reached the subscriptions writer with no currency and
  // got stamped with a hardcoded "CAD".
  it("carries the native transaction currency onto the detected series", () => {
    const txns = [
      makeTxn(1, "2024-01-15", "Spotify", -239, "MXN"),
      makeTxn(2, "2024-02-15", "Spotify", -239, "MXN"),
      makeTxn(3, "2024-03-15", "Spotify", -239, "MXN"),
    ];
    const result = detectRecurringTransactions(txns);
    expect(result.length).toBe(1);
    expect(result[0].currency).toBe("MXN");
  });

  it("keeps the same payee billed in two currencies as two series", () => {
    const txns = [
      makeTxn(1, "2024-01-15", "Spotify", -239, "MXN"),
      makeTxn(2, "2024-02-15", "Spotify", -239, "MXN"),
      makeTxn(3, "2024-03-15", "Spotify", -239, "MXN"),
      makeTxn(4, "2024-01-20", "Spotify", -12, "USD"),
      makeTxn(5, "2024-02-20", "Spotify", -12, "USD"),
      makeTxn(6, "2024-03-20", "Spotify", -12, "USD"),
    ];
    const result = detectRecurringTransactions(txns);
    expect(result.length).toBe(2);
    // Grouping them together would have averaged 239 and 12 into one
    // meaningless figure under a single currency label.
    expect(result.map((r) => r.currency).sort()).toEqual(["MXN", "USD"]);
    expect(result.find((r) => r.currency === "MXN")?.avgAmount).toBe(-239);
    expect(result.find((r) => r.currency === "USD")?.avgAmount).toBe(-12);
  });

  it("sorts by absolute amount descending", () => {
    const txns = [
      makeTxn(1, "2024-01-15", "Small", -10),
      makeTxn(2, "2024-02-15", "Small", -10),
      makeTxn(3, "2024-03-15", "Small", -10),
      makeTxn(4, "2024-01-15", "Big", -100),
      makeTxn(5, "2024-02-15", "Big", -100),
      makeTxn(6, "2024-03-15", "Big", -100),
    ];
    const result = detectRecurringTransactions(txns);
    expect(result[0].payee).toBe("Big");
  });

  // Subscriptions merge (2026-10) — longer cadences + lapsed series.
  it("detects quarterly and semi-annual series", () => {
    const txns = [
      makeTxn(1, "2025-01-10", "Water", -90),
      makeTxn(2, "2025-04-10", "Water", -92),
      makeTxn(3, "2025-07-10", "Water", -88),
      makeTxn(4, "2024-03-01", "Car insurance", -600),
      makeTxn(5, "2024-09-01", "Car insurance", -600),
      makeTxn(6, "2025-03-01", "Car insurance", -610),
    ];
    const result = detectRecurringTransactions(txns);
    expect(result.find((r) => r.payee === "Water")?.frequency).toBe("quarterly");
    expect(result.find((r) => r.payee === "Water")?.nextDate).toBe("2025-10-10");
    expect(result.find((r) => r.payee === "Car insurance")?.frequency).toBe("semiannual");
    expect(result.find((r) => r.payee === "Car insurance")?.nextDate).toBe("2025-09-01");
  });

  it("computes the next date without month-end overflow", () => {
    const txns = [
      makeTxn(1, "2024-10-31", "Rent", -1000),
      makeTxn(2, "2024-11-30", "Rent", -1000),
      makeTxn(3, "2024-12-31", "Rent", -1000),
      makeTxn(4, "2025-01-31", "Rent", -1000),
    ];
    // Old local-time setMonth stepping turned Jan 31 + 1 month into Mar 3.
    expect(detectRecurringTransactions(txns)[0].nextDate).toBe("2025-02-28");
  });

  it("drops a lapsed series when asOf is given (two expected payments missed)", () => {
    const txns = [
      makeTxn(1, "2026-01-15", "Old streaming", -9.99),
      makeTxn(2, "2026-02-15", "Old streaming", -9.99),
      makeTxn(3, "2026-03-15", "Old streaming", -9.99),
      makeTxn(4, "2026-07-15", "Current", -5),
      makeTxn(5, "2026-08-15", "Current", -5),
      makeTxn(6, "2026-09-15", "Current", -5),
    ];
    expect(detectRecurringTransactions(txns).length).toBe(2);
    const live = detectRecurringTransactions(txns, { asOf: "2026-10-01" });
    expect(live.map((r) => r.payee)).toEqual(["Current"]);
    // One missed cycle is tolerated (bank feeds lag).
    expect(detectRecurringTransactions(txns, { asOf: "2026-05-01" }).length).toBe(2);
  });

  it("judges lapse against the account's newest transaction, not today", () => {
    // Account 2's imports stopped in June; its bills are not "cancelled" in
    // October just because nobody has synced it since.
    const stale = (id: number, date: string, payee: string, amount: number) => ({ ...makeTxn(id, date, payee, amount), accountId: 2 });
    const txns = [
      stale(1, "2026-04-11", "Spotify", -10.99),
      stale(2, "2026-05-11", "Spotify", -10.99),
      stale(3, "2026-06-11", "Spotify", -10.99),
      stale(4, "2026-06-20", "Groceries", -80),
    ];
    expect(detectRecurringTransactions(txns, { asOf: "2026-10-01" }).map((r) => r.payee)).toEqual(["Spotify"]);
    // ...but a series that stopped while the account kept moving IS lapsed.
    const moving = [...txns, stale(5, "2026-09-25", "Groceries", -75)];
    expect(detectRecurringTransactions(moving, { asOf: "2026-10-01" })).toEqual([]);
  });
});

describe("forecastCashFlow", () => {
  it("forecasts balance over time", () => {
    const recurring = [{
      payee: "Salary",
      avgAmount: 5000,
      currency: "CAD",
      frequency: "monthly" as const,
      count: 6,
      lastDate: "2024-01-01",
      nextDate: "2024-02-01",
      accountId: 1,
      categoryId: 1,
      transactions: [],
    }];
    const forecast = forecastCashFlow(recurring, 10000, 60);
    expect(forecast.length).toBeGreaterThan(0);
    // Balance should grow with income
    const lastEntry = forecast[forecast.length - 1];
    expect(lastEntry.balance).toBeGreaterThan(10000);
  });

  it("handles empty recurring list", () => {
    const forecast = forecastCashFlow([], 10000, 30);
    expect(forecast).toEqual([]);
  });
});
