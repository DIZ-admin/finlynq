/**
 * debt_payoff goals link a liability account whose balance is negative (the
 * amount still owed). Progress must be the paid-off share of the target, not
 * the raw negative balance (which rendered as "-100%").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const dbHolder = vi.hoisted(() => ({ results: [] as unknown[][] }));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "groupBy"]) chain[m] = vi.fn(() => chain);
  chain.then = (r: (v: unknown) => unknown) =>
    r(dbHolder.results.length ? dbHolder.results.shift()! : []);
  const tbl = { id: {}, userId: {}, currency: {}, isInvestment: {}, type: {}, accountId: {}, amount: {} };
  return { db: chain, schema: { accounts: tbl, transactions: tbl } };
});
vi.mock("@/lib/holdings-value", () => ({
  getHoldingsValueByAccount: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/fx-service", () => ({ getLatestFxRate: vi.fn(async () => 1) }));

import { computeGoalProgress } from "@/lib/goals-progress";

function queueAccountBalance(type: "A" | "L", balance: number) {
  dbHolder.results = [
    [{ id: 22, currency: "VND", isInvestment: false, type }],
    [{ accountId: 22, total: balance }],
  ];
}
const queueLoanBalance = (balance: number) => queueAccountBalance("L", balance);

const goal = (type: string | null) => ({
  id: 3,
  type,
  currency: "VND",
  targetAmount: 150_000_000,
  deadline: null,
  accountIds: [22],
});

describe("computeGoalProgress — debt_payoff", () => {
  beforeEach(() => {
    dbHolder.results = [];
  });

  it("reads 0% when the full target is still owed", async () => {
    queueLoanBalance(-150_000_000);
    const p = (await computeGoalProgress("u1", null, [goal("debt_payoff")])).get(3)!;
    expect(p.currentAmount).toBe(0);
    expect(p.progress).toBe(0);
    expect(p.remaining).toBe(150_000_000);
  });

  it("counts the paid-down part of the debt as progress", async () => {
    queueLoanBalance(-90_000_000);
    const p = (await computeGoalProgress("u1", null, [goal("debt_payoff")])).get(3)!;
    expect(p.currentAmount).toBe(60_000_000);
    expect(p.progress).toBe(40);
    expect(p.remaining).toBe(90_000_000);
  });

  it("reads 100% once the loan balance reaches zero", async () => {
    queueLoanBalance(0);
    const p = (await computeGoalProgress("u1", null, [goal("debt_payoff")])).get(3)!;
    expect(p.progress).toBe(100);
    expect(p.remaining).toBe(0);
  });

  it("leaves savings goals unchanged", async () => {
    queueAccountBalance("A", 60_000_000);
    const p = (await computeGoalProgress("u1", null, [goal("savings")])).get(3)!;
    expect(p.currentAmount).toBe(60_000_000);
    expect(p.progress).toBe(40);
  });

  // Regression: the inversion must only apply when a liability is linked.
  // Without one there is nothing "owed" to measure, and inverting read the
  // goal as fully paid off.
  it("a debt_payoff goal with no linked accounts (manual tracking) reads 0%, not 100%", async () => {
    const p = (await computeGoalProgress("u1", null, [{ ...goal("debt_payoff"), accountIds: [] }])).get(3)!;
    expect(p.currentAmount).toBe(0);
    expect(p.progress).toBe(0);
    expect(p.remaining).toBe(150_000_000);
  });

  it("a debt_payoff goal saving toward the payoff in an asset account uses the saved balance", async () => {
    queueAccountBalance("A", 30_000_000);
    const p = (await computeGoalProgress("u1", null, [goal("debt_payoff")])).get(3)!;
    expect(p.currentAmount).toBe(30_000_000);
    expect(p.progress).toBe(20);
    expect(p.remaining).toBe(120_000_000);
  });
});
