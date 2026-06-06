import {
  unlinkedBankRows,
  reconciledRows,
  buildSuggestionByBank,
  buildDuplicateByBank,
  resolveSuggestedCategoryId,
  isMode,
  MODE_META,
  MODE_ORDER,
} from "../lib/inbox";
import type { ReconcileSuggestions } from "../../../shared/types";

const snap: ReconcileSuggestions = {
  linked: [
    {
      transactionId: 10,
      bankTransactionId: "b1",
      linkType: "primary",
      source: "manual",
      createdAt: "2026-05-01T00:00:00Z",
    },
  ],
  suggestions: [
    {
      transactionId: 20,
      bankTransactionId: "b2",
      strategy: "fuzzy",
      score: 0.9,
      reason: "amount+date",
      daysOff: 1,
      amountDeltaAbs: 0,
    },
  ],
  bankOnly: ["b3"],
  txOnly: [],
  transactions: {
    10: { id: 10, date: "2026-04-30", amount: -50, currency: "CAD", payee: "Hydro", categoryName: "Utilities", categoryType: "E" },
    20: { id: 20, date: "2026-05-02", amount: -25, currency: "CAD", payee: "Coffee", categoryName: "Dining", categoryType: "E" },
  },
  bankTransactions: {
    b1: { id: "b1", date: "2026-04-30", amount: -50, currency: "CAD", payee: "HYDRO ONE", accountId: 1, suggestedCategoryId: null, duplicateOfTransactionId: null },
    b2: { id: "b2", date: "2026-05-02", amount: -25, currency: "CAD", payee: "STARBUCKS", accountId: 1, suggestedCategoryId: null, duplicateOfTransactionId: null },
    b3: { id: "b3", date: "2026-05-05", amount: -12, currency: "CAD", payee: "NETFLIX", accountId: 1, suggestedCategoryId: 7, duplicateOfTransactionId: null },
  },
};

const catName = (id: number) => `Cat#${id}`;

describe("unlinkedBankRows", () => {
  it("excludes already-linked bank rows and sorts newest-first", () => {
    const rows = unlinkedBankRows(snap);
    expect(rows.map((r) => r.id)).toEqual(["b3", "b2"]); // b1 is linked
  });
  it("returns [] for a null snapshot", () => {
    expect(unlinkedBankRows(null)).toEqual([]);
  });
});

describe("reconciledRows", () => {
  it("joins linked bank+tx snapshots", () => {
    const rows = reconciledRows(snap);
    expect(rows).toHaveLength(1);
    expect(rows[0].bank.id).toBe("b1");
    expect(rows[0].tx.id).toBe(10);
    expect(rows[0].tx.categoryName).toBe("Utilities");
  });
  it("drops links whose bank or tx snapshot is missing", () => {
    const broken: ReconcileSuggestions = {
      ...snap,
      linked: [
        {
          transactionId: 999,
          bankTransactionId: "missing",
          linkType: "primary",
          source: "manual",
          createdAt: "2026-05-01T00:00:00Z",
        },
      ],
    };
    expect(reconciledRows(broken)).toEqual([]);
  });
});

describe("buildSuggestionByBank", () => {
  it("prefers a match against an existing tx, falls back to suggestedCategoryId", () => {
    const map = buildSuggestionByBank(snap, catName);
    // b2 → match tx 20
    expect(map.get("b2")).toEqual({
      kind: "match",
      transactionId: 20,
      txPayee: "Coffee",
      txCategoryName: "Dining",
    });
    // b3 → create from the rule-engine suggestedCategoryId
    expect(map.get("b3")).toEqual({
      kind: "create",
      categoryId: 7,
      categoryName: "Cat#7",
    });
    // b1 has neither a suggestion nor a suggestedCategoryId
    expect(map.has("b1")).toBe(false);
  });
});

describe("buildDuplicateByBank", () => {
  it("returns an empty map when no bank row flags a duplicate", () => {
    expect(buildDuplicateByBank(snap).size).toBe(0);
  });
  it("returns [] for a null snapshot", () => {
    expect(buildDuplicateByBank(null).size).toBe(0);
  });
  it("maps a flagged bank row to the existing ledger tx snapshot", () => {
    const dupSnap: ReconcileSuggestions = {
      ...snap,
      transactions: {
        ...snap.transactions,
        77: { id: 77, date: "2026-05-04", amount: -99, currency: "CAD", payee: "Rent", categoryName: "Housing", categoryType: "E" },
      },
      bankTransactions: {
        ...snap.bankTransactions,
        b9: { id: "b9", date: "2026-05-05", amount: -99, currency: "CAD", payee: "RENT CO", accountId: 1, suggestedCategoryId: null, duplicateOfTransactionId: 77 },
      },
    };
    const map = buildDuplicateByBank(dupSnap);
    expect(map.get("b9")).toEqual({
      transactionId: 77,
      txPayee: "Rent",
      txDate: "2026-05-04",
      txAmount: -99,
      txCurrency: "CAD",
    });
    // Rows that don't flag a duplicate stay out of the map.
    expect(map.has("b1")).toBe(false);
  });
  it("drops a flag whose referenced tx snapshot is missing (defensive)", () => {
    const orphan: ReconcileSuggestions = {
      ...snap,
      bankTransactions: {
        ...snap.bankTransactions,
        b8: { id: "b8", date: "2026-05-06", amount: -5, currency: "CAD", payee: "X", accountId: 1, suggestedCategoryId: null, duplicateOfTransactionId: 999 },
      },
    };
    expect(buildDuplicateByBank(orphan).has("b8")).toBe(false);
  });
});

describe("resolveSuggestedCategoryId", () => {
  const byName = (name: string) => (name === "Dining" ? 99 : null);
  it("returns the categoryId directly for a 'create' suggestion", () => {
    expect(resolveSuggestedCategoryId({ kind: "create", categoryId: 7, categoryName: "X" }, byName)).toBe(7);
  });
  it("resolves a 'match' suggestion via the matched tx's category name", () => {
    expect(
      resolveSuggestedCategoryId(
        { kind: "match", transactionId: 1, txPayee: null, txCategoryName: "Dining" },
        byName,
      ),
    ).toBe(99);
  });
  it("returns null when a 'match' category can't be resolved", () => {
    expect(
      resolveSuggestedCategoryId(
        { kind: "match", transactionId: 1, txPayee: null, txCategoryName: "Unknown" },
        byName,
      ),
    ).toBeNull();
    expect(
      resolveSuggestedCategoryId(
        { kind: "match", transactionId: 1, txPayee: null, txCategoryName: null },
        byName,
      ),
    ).toBeNull();
  });
  it("returns null for no suggestion", () => {
    expect(resolveSuggestedCategoryId(null, byName)).toBeNull();
  });
});

describe("mode metadata", () => {
  it("isMode accepts the three policies and rejects others", () => {
    expect(isMode("auto")).toBe(true);
    expect(isMode("approve")).toBe(true);
    expect(isMode("manual")).toBe(true);
    expect(isMode("nope")).toBe(false);
    expect(isMode(null)).toBe(false);
  });
  it("MODE_ORDER + MODE_META cover all three modes with gate counts", () => {
    expect(MODE_ORDER).toEqual(["auto", "approve", "manual"]);
    expect(MODE_META.auto.gates).toBe(0);
    expect(MODE_META.approve.gates).toBe(1);
    expect(MODE_META.manual.gates).toBe(2);
  });
});
