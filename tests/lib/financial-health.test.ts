/**
 * Unit tests for the shared financial-health calculator (FINLYNQ-94).
 *
 * In-process tests over a mock `db.execute` shim. Real-Postgres coverage of
 * the same SQL invariants is deferred to a follow-up — these tests focus on
 * the load-bearing branches in the calculator's TypeScript:
 *
 *   1. budget-adherence is EXCLUDED (not 0 or 50/100) when no budgets exist
 *   2. net-worth-trend is EXCLUDED when oldest tx is < 60d old (insufficient
 *      history), not flat-at-50
 *   3. multi-currency totals sum through getRate FX conversion
 *   4. liquid-assets respects accounts.is_investment AND the CASH_GROUPS
 *      whitelist (substring matching on `group` is the wrong shape)
 *   5. age-of-money falls back to 50/excluded when calculateAgeOfMoney
 *      returns ageInDays=0
 *
 * If `finlynq_test` Postgres becomes available, these branches can be
 * promoted into the portfolio-fixtures style (real INSERTs into seeded
 * tables) without changing the calculator API.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { calculateFinancialHealth, HEALTH_WEIGHTS } from "@/lib/financial-health";

const fxMock = vi.fn(async (from: string, to: string): Promise<number> => {
  if (from === to) return 1;
  if (from === "USD" && to === "CAD") return 1.35;
  if (from === "CAD" && to === "USD") return 1 / 1.35;
  return 1;
});

vi.mock("@/lib/fx-service", () => ({
  getRate: (from: string, to: string) => fxMock(from, to),
}));

const aomMock = vi.fn();
vi.mock("@/lib/age-of-money", () => ({
  calculateAgeOfMoney: (...a: unknown[]) => aomMock(...a),
}));

// ── Tiny SQL-matcher harness. ──────────────────────────────────────────────
// The calculator builds queries via Drizzle's sql template-tag, which serializes
// to a `{ queryChunks, getSQL, toQuery, ... }` object. We don't try to evaluate
// the SQL — we just match on substrings of the first chunk to dispatch to a
// fixture per-query-kind.

type FakeQueryDispatch = {
  incomeExpenses3m?: Array<{ month: string; cat_type: string; currency: string | null; total: number }>;
  incomeDebt12m?: Array<{ cat_type: string | null; currency: string | null; account_type: string | null; total: number }>;
  balances?: Array<{ type: string; group: string; currency: string | null; is_investment: boolean | null; balance: number }>;
  balancesPast?: Array<{ currency: string | null; balance: number }>;
  oldestRow?: Array<{ oldest: string | null }>;
  budgets?: Array<{ budget: number; spent: number }>;
};

function buildDb(dispatch: FakeQueryDispatch) {
  return {
    execute: vi.fn(async (q: unknown) => {
      // Drizzle's `sql` template literal yields an object with a `queryChunks`
      // array of alternating string fragments + parameter sigils. We walk it
      // and concatenate string fragments only — enough to match on the literal
      // SQL hints we put in each query.
      const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
      let repr = "";
      for (const chunk of chunks) {
        if (typeof chunk === "string") {
          repr += chunk;
        } else if (chunk && typeof chunk === "object") {
          const rec = chunk as Record<string, unknown>;
          // StringChunk has a `value` array of strings.
          if (Array.isArray(rec.value)) {
            for (const v of rec.value) {
              if (typeof v === "string") repr += v;
            }
          } else if (typeof rec.value === "string") {
            repr += rec.value;
          }
        }
      }

      // Order matters: most specific first.
      if (repr.includes("TO_CHAR(t.date::date, 'YYYY-MM')")) {
        return { rows: dispatch.incomeExpenses3m ?? [] };
      }
      if (repr.includes("a.type AS account_type")) {
        return { rows: dispatch.incomeDebt12m ?? [] };
      }
      if (repr.includes("a.is_investment")) {
        return { rows: dispatch.balances ?? [] };
      }
      if (repr.includes("t.date <= ")) {
        return { rows: dispatch.balancesPast ?? [] };
      }
      if (repr.includes("MIN(t.date)")) {
        return { rows: dispatch.oldestRow ?? [] };
      }
      if (repr.includes("FROM budgets")) {
        return { rows: dispatch.budgets ?? [] };
      }
      return { rows: [] };
    }),
  };
}

describe("calculateFinancialHealth — load-bearing branches", () => {
  beforeEach(() => {
    fxMock.mockClear();
    aomMock.mockReset();
    aomMock.mockResolvedValue({ ageInDays: 0, trend: 0, history: [] });
  });

  it("weights sum to 1.0 (canonical FINLYNQ-94 contract)", () => {
    const sum = Object.values(HEALTH_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("budget-adherence is EXCLUDED (not 0/100) when no budgets exist", async () => {
    aomMock.mockResolvedValue({ ageInDays: 20, trend: 0, history: [] });
    const db = buildDb({
      incomeExpenses3m: [],
      incomeDebt12m: [],
      balances: [],
      balancesPast: [],
      oldestRow: [{ oldest: "2020-01-01" }], // plenty of history → NW trend not excluded
      budgets: [],
    });
    const r = await calculateFinancialHealth({
      db,
      userId: "u",
      dek: null,
      reportingCurrency: "CAD",
    });
    const budgetComp = r.components.find((c) => c.name === "Budget Adherence");
    expect(budgetComp).toBeUndefined();
    expect(r.excludedComponents.some((e) => e.name === "Budget Adherence" && e.reason === "no_budgets"))
      .toBe(true);
  });

  it("net-worth-trend is EXCLUDED (not 50-fallback) when history < 60 days", async () => {
    aomMock.mockResolvedValue({ ageInDays: 20, trend: 0, history: [] });
    const today = new Date();
    const recent = new Date(today);
    recent.setDate(recent.getDate() - 10); // only 10d of history
    const db = buildDb({
      oldestRow: [{ oldest: recent.toISOString().split("T")[0] }],
      budgets: [{ budget: 100, spent: 50 }], // keep budget kept so NW exclusion is isolated
    });
    const r = await calculateFinancialHealth({
      db,
      userId: "u",
      dek: null,
      reportingCurrency: "CAD",
    });
    const nwComp = r.components.find((c) => c.name === "Net Worth Trend");
    expect(nwComp).toBeUndefined();
    expect(r.excludedComponents.some((e) => e.name === "Net Worth Trend" && e.reason === "insufficient_history"))
      .toBe(true);
  });

  it("multi-currency totals convert via getRate (CAD + USD → CAD reporting)", async () => {
    aomMock.mockResolvedValue({ ageInDays: 20, trend: 0, history: [] });
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const db = buildDb({
      incomeExpenses3m: [
        { month, cat_type: "I", currency: "CAD", total: 1000 },
        { month, cat_type: "I", currency: "USD", total: 1000 }, // → 1350 CAD
        { month, cat_type: "E", currency: "CAD", total: -500 },
        { month, cat_type: "E", currency: "USD", total: -100 }, // → 135 CAD abs
      ],
      oldestRow: [{ oldest: "2020-01-01" }],
      budgets: [],
    });
    const r = await calculateFinancialHealth({
      db,
      userId: "u",
      dek: null,
      reportingCurrency: "CAD",
    });
    // income = 1000 + 1350 = 2350; expenses = 500 + 135 = 635
    expect(r.totals.totalIncome3m.amount).toBeCloseTo(2350, 0);
    expect(r.totals.totalExpenses3m.amount).toBeCloseTo(635, 0);
    expect(r.totals.totalIncome3m.currency).toBe("CAD");
    expect(fxMock).toHaveBeenCalledWith("USD", "CAD");
  });

  it("liquid-assets respects is_investment AND the CASH_GROUPS whitelist", async () => {
    aomMock.mockResolvedValue({ ageInDays: 20, trend: 0, history: [] });
    const db = buildDb({
      balances: [
        // Banks + non-investment → counted
        { type: "A", group: "Banks", currency: "CAD", is_investment: false, balance: 5000 },
        // Cash + non-investment → counted
        { type: "A", group: "Cash", currency: "CAD", is_investment: false, balance: 2000 },
        // Banks + investment=true → EXCLUDED (locked-in RRSP cash)
        { type: "A", group: "Banks", currency: "CAD", is_investment: true, balance: 99000 },
        // Real Estate (non-cash group) + non-investment → EXCLUDED
        { type: "A", group: "Real Estate", currency: "CAD", is_investment: false, balance: 500000 },
        // Retirement Accounts (NOT in whitelist) → EXCLUDED
        { type: "A", group: "Retirement Accounts", currency: "CAD", is_investment: false, balance: 100000 },
        // Liability
        { type: "L", group: "Credit Cards", currency: "CAD", is_investment: false, balance: -1500 },
      ],
      oldestRow: [{ oldest: "2020-01-01" }],
      budgets: [],
    });
    const r = await calculateFinancialHealth({
      db,
      userId: "u",
      dek: null,
      reportingCurrency: "CAD",
    });
    expect(r.totals.liquidAssets.amount).toBeCloseTo(7000, 0);
    expect(r.totals.totalLiabilities.amount).toBeCloseTo(1500, 0);
  });

  it("age-of-money is EXCLUDED when calculateAgeOfMoney returns ageInDays=0", async () => {
    aomMock.mockResolvedValue({ ageInDays: 0, trend: 0, history: [] });
    const db = buildDb({
      oldestRow: [{ oldest: "2020-01-01" }],
      budgets: [],
    });
    const r = await calculateFinancialHealth({
      db,
      userId: "u",
      dek: null,
      reportingCurrency: "CAD",
    });
    const aomComp = r.components.find((c) => c.name === "Age of Money");
    expect(aomComp).toBeUndefined();
    expect(r.excludedComponents.some((e) => e.name === "Age of Money" && e.reason === "insufficient_data"))
      .toBe(true);
  });

  it("renormalizes remaining weights when components are excluded", async () => {
    aomMock.mockResolvedValue({ ageInDays: 0, trend: 0, history: [] });
    // Exclude Budget Adherence (no budgets), Net Worth Trend (insufficient history),
    // and Age of Money (ageInDays=0). Kept: Savings Rate (0.25) + DTI (0.20) +
    // Emergency Fund (0.15) = 0.60 → renormalized weights are 25/60, 20/60, 15/60.
    const today = new Date();
    const recent = new Date(today);
    recent.setDate(recent.getDate() - 10);
    const db = buildDb({
      incomeExpenses3m: [], // Savings Rate → 0
      incomeDebt12m: [],     // DTI → 100 (no debt)
      balances: [],
      oldestRow: [{ oldest: recent.toISOString().split("T")[0] }],
      budgets: [],
    });
    const r = await calculateFinancialHealth({
      db,
      userId: "u",
      dek: null,
      reportingCurrency: "CAD",
    });
    const names = r.components.map((c) => c.name).sort();
    expect(names).toEqual(["Debt-to-Income", "Emergency Fund", "Savings Rate"]);
    const renorm = r.components.reduce((s, c) => s + c.weight, 0);
    expect(renorm).toBeCloseTo(1, 2);
  });

  it("returns a valid grade for any score", async () => {
    aomMock.mockResolvedValue({ ageInDays: 0, trend: 0, history: [] });
    const db = buildDb({
      oldestRow: [{ oldest: "2020-01-01" }],
      budgets: [],
    });
    const r = await calculateFinancialHealth({
      db,
      userId: "u",
      dek: null,
      reportingCurrency: "CAD",
    });
    expect(["Excellent", "Good", "Fair", "Needs Work"]).toContain(r.grade);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
