/**
 * Unit tests for src/lib/sort-helpers.ts — mobile port of web's
 * dropdown-order + account-group-order pure helpers (FINLYNQ-240).
 *
 * Tests mirror the web behaviour verified in pf-app/src/lib/dropdown-order.ts
 * and pf-app/src/lib/accounts/groups.ts.
 */

import {
  parseDropdownOrder,
  sortByUserOrder,
  parseGroupOrder,
  parseGroupOrderResponse,
  orderGroups,
  pickDefaultAccountId,
  OTHER_GROUP,
  EMPTY_DROPDOWN_ORDER,
  EMPTY_GROUP_ORDER,
} from "../lib/sort-helpers";

// ─── parseDropdownOrder ────────────────────────────────────────────────────────

describe("parseDropdownOrder", () => {
  it("returns EMPTY_DROPDOWN_ORDER for null/undefined/non-object", () => {
    expect(parseDropdownOrder(null)).toEqual(EMPTY_DROPDOWN_ORDER);
    expect(parseDropdownOrder(undefined)).toEqual(EMPTY_DROPDOWN_ORDER);
    expect(parseDropdownOrder("string")).toEqual(EMPTY_DROPDOWN_ORDER);
    expect(parseDropdownOrder(42)).toEqual(EMPTY_DROPDOWN_ORDER);
  });

  it("returns EMPTY_DROPDOWN_ORDER when version != 1", () => {
    expect(parseDropdownOrder({ version: 2, lists: {} })).toEqual(EMPTY_DROPDOWN_ORDER);
  });

  it("returns EMPTY_DROPDOWN_ORDER when lists is missing", () => {
    expect(parseDropdownOrder({ version: 1 })).toEqual(EMPTY_DROPDOWN_ORDER);
  });

  it("parses a valid dropdown order", () => {
    const raw = { version: 1, lists: { account: [3, 1, 2], category: ["abc", "def"] } };
    const result = parseDropdownOrder(raw);
    expect(result.version).toBe(1);
    expect(result.lists.account).toEqual([3, 1, 2]);
    expect(result.lists.category).toEqual(["abc", "def"]);
  });

  it("deduplicates within a list", () => {
    const raw = { version: 1, lists: { account: [1, 2, 1, 3] } };
    const result = parseDropdownOrder(raw);
    expect(result.lists.account).toEqual([1, 2, 3]);
  });

  it("strips unknown kinds and non-string/number entries", () => {
    const raw = { version: 1, lists: { account: [1, null, "x", true], unknown: [5] } };
    const result = parseDropdownOrder(raw);
    expect(result.lists.account).toEqual([1, "x"]);
    expect((result.lists as Record<string, unknown>).unknown).toBeUndefined();
  });
});

// ─── sortByUserOrder ──────────────────────────────────────────────────────────

interface Item {
  id: number;
  name: string;
}

const fallback = (a: Item, b: Item) => a.name.localeCompare(b.name);

describe("sortByUserOrder", () => {
  const items: Item[] = [
    { id: 1, name: "Checking" },
    { id: 2, name: "Savings" },
    { id: 3, name: "Visa" },
  ];

  it("falls back to comparator when savedOrder is undefined", () => {
    const result = sortByUserOrder(items, (i) => i.id, undefined, fallback);
    expect(result.map((i) => i.name)).toEqual(["Checking", "Savings", "Visa"]);
  });

  it("falls back to comparator when savedOrder is empty", () => {
    const result = sortByUserOrder(items, (i) => i.id, [], fallback);
    expect(result.map((i) => i.name)).toEqual(["Checking", "Savings", "Visa"]);
  });

  it("pins saved items first in saved sequence, then fallback for rest", () => {
    // User pinned Visa (3) then Savings (2) — Checking (1) is unpinned
    const result = sortByUserOrder(items, (i) => i.id, [3, 2], fallback);
    expect(result.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it("unpinned items are sorted by the fallback comparator", () => {
    const moreItems: Item[] = [
      { id: 4, name: "Zorro" },
      { id: 5, name: "Alpha" },
      { id: 1, name: "Checking" },
    ];
    // Pin id=1, rest sorted alpha: Alpha, Zorro
    const result = sortByUserOrder(moreItems, (i) => i.id, [1], fallback);
    expect(result.map((i) => i.name)).toEqual(["Checking", "Alpha", "Zorro"]);
  });

  it("ignores savedOrder entries that don't match any item", () => {
    // 99 doesn't exist — all items become unpinned → alpha sort
    const result = sortByUserOrder(items, (i) => i.id, [99], fallback);
    expect(result.map((i) => i.name)).toEqual(["Checking", "Savings", "Visa"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...items];
    sortByUserOrder(items, (i) => i.id, [3, 1], fallback);
    expect(items).toEqual(copy);
  });
});

// ─── parseGroupOrder ──────────────────────────────────────────────────────────

describe("parseGroupOrder", () => {
  it("returns EMPTY_GROUP_ORDER for falsy input", () => {
    expect(parseGroupOrder(null)).toEqual(EMPTY_GROUP_ORDER);
    expect(parseGroupOrder(undefined)).toEqual(EMPTY_GROUP_ORDER);
    expect(parseGroupOrder("")).toEqual(EMPTY_GROUP_ORDER);
  });

  it("parses a JSON string value", () => {
    const value = JSON.stringify({ A: ["Cash", "Savings"], L: ["Mortgage"] });
    const result = parseGroupOrder(value);
    expect(result.A).toEqual(["Cash", "Savings"]);
    expect(result.L).toEqual(["Mortgage"]);
  });

  it("accepts an already-parsed object", () => {
    const result = parseGroupOrder({ A: ["Investment"], L: [] });
    expect(result.A).toEqual(["Investment"]);
    expect(result.L).toEqual([]);
  });

  it("returns EMPTY_GROUP_ORDER for malformed JSON", () => {
    expect(parseGroupOrder("{bad json")).toEqual(EMPTY_GROUP_ORDER);
  });

  it("de-dupes case-insensitively, preserving first-seen", () => {
    const result = parseGroupOrder({ A: ["Cash", "cash", "CASH", "Savings"] });
    expect(result.A).toEqual(["Cash", "Savings"]);
  });

  it("ignores non-string array entries", () => {
    const result = parseGroupOrder({ A: ["Cash", 42, null, true, "Savings"] });
    expect(result.A).toEqual(["Cash", "Savings"]);
  });
});

// ─── parseGroupOrderResponse (Bug 2: envelope unwrap) ─────────────────────────

describe("parseGroupOrderResponse", () => {
  it("unwraps the { order: {A,L} } envelope so the saved order is honored", () => {
    // This is the regression: the route returns { order: {...} }, NOT {A,L}.
    const response = { order: { A: ["Cash", "Savings"], L: ["Mortgage"] } };
    const result = parseGroupOrderResponse(response);
    expect(result.A).toEqual(["Cash", "Savings"]);
    expect(result.L).toEqual(["Mortgage"]);
  });

  it("differs from passing the raw envelope to parseGroupOrder (the bug)", () => {
    const response = { order: { A: ["Cash"], L: [] } };
    // The bug: parseGroupOrder(response) reads .A/.L off the wrapper → empty.
    expect(parseGroupOrder(response)).toEqual(EMPTY_GROUP_ORDER);
    // The fix: parseGroupOrderResponse unwraps → real order.
    expect(parseGroupOrderResponse(response).A).toEqual(["Cash"]);
  });

  it("degrades to EMPTY_GROUP_ORDER for a missing/malformed envelope", () => {
    expect(parseGroupOrderResponse(null)).toEqual(EMPTY_GROUP_ORDER);
    expect(parseGroupOrderResponse(undefined)).toEqual(EMPTY_GROUP_ORDER);
    expect(parseGroupOrderResponse({})).toEqual(EMPTY_GROUP_ORDER);
    expect(parseGroupOrderResponse({ order: null })).toEqual(EMPTY_GROUP_ORDER);
    expect(parseGroupOrderResponse([1, 2, 3])).toEqual(EMPTY_GROUP_ORDER);
  });
});

// ─── pickDefaultAccountId (Bug 3: default = first sorted) ──────────────────────

interface Acct {
  id: number;
  name: string;
}

describe("pickDefaultAccountId", () => {
  const acctFallback = (a: Acct, b: Acct) => a.name.localeCompare(b.name);
  // Raw API order intentionally does NOT match sorted order.
  const usable: Acct[] = [
    { id: 5, name: "Zebra" },
    { id: 2, name: "Apple" },
    { id: 9, name: "Mango" },
  ];

  it("returns null for an empty list", () => {
    expect(pickDefaultAccountId([], (a: Acct) => a.id, undefined, acctFallback)).toBeNull();
  });

  it("defaults to the first SORTED account (name fallback), not raw-API-first", () => {
    // Raw-first would be id=5 (Zebra); sorted-first is id=2 (Apple).
    const result = pickDefaultAccountId(usable, (a) => a.id, undefined, acctFallback);
    expect(result).toBe(2);
  });

  it("defaults to the first account of the saved dropdown order", () => {
    // Saved order pins id=9 first → it wins over alpha.
    const result = pickDefaultAccountId(usable, (a) => a.id, [9, 2], acctFallback);
    expect(result).toBe(9);
  });

  it("honors a valid preselectedAccountId over the sorted default", () => {
    const result = pickDefaultAccountId(usable, (a) => a.id, undefined, acctFallback, 5);
    expect(result).toBe(5);
  });

  it("ignores an invalid preselectedAccountId and uses the sorted default", () => {
    const result = pickDefaultAccountId(usable, (a) => a.id, undefined, acctFallback, 999);
    expect(result).toBe(2);
  });
});

// ─── groupAccounts within-group ordering (Bug 1, via helper composition) ──────

describe("within-group account ordering (sortByUserOrder)", () => {
  // Mirrors AccountsScreen.groupAccounts: accounts within a group honor the
  // saved account dropdown order, then fall back to name.
  const nameFallback = (a: Acct, b: Acct) => a.name.localeCompare(b.name);
  const group: Acct[] = [
    { id: 5, name: "Zebra" },
    { id: 2, name: "Apple" },
    { id: 9, name: "Mango" },
  ];

  it("orders by saved account dropdown order first, then name", () => {
    // Pin id=9 (Mango) and id=5 (Zebra); id=2 (Apple) falls to alpha.
    const result = sortByUserOrder(group, (a) => a.id, [9, 5], nameFallback);
    expect(result.map((a) => a.id)).toEqual([9, 5, 2]);
  });

  it("falls back to name.localeCompare with no saved order", () => {
    const result = sortByUserOrder(group, (a) => a.id, undefined, nameFallback);
    expect(result.map((a) => a.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });
});

// ─── orderGroups ─────────────────────────────────────────────────────────────

describe("orderGroups", () => {
  const groups = ["Other", "Savings", "Cash", "Investment"];

  it("puts Other last regardless of its position", () => {
    const result = orderGroups(groups, []);
    expect(result[result.length - 1]).toBe(OTHER_GROUP);
  });

  it("puts Other last even when savedOrder places it first", () => {
    const result = orderGroups(groups, ["Other", "Cash", "Savings"]);
    expect(result[result.length - 1]).toBe(OTHER_GROUP);
  });

  it("follows saved order for non-Other groups", () => {
    const result = orderGroups(groups, ["Investment", "Savings"]);
    // Investment, Savings lead; Cash falls to fallback alpha; Other is last
    expect(result).toEqual(["Investment", "Savings", "Cash", OTHER_GROUP]);
  });

  it("falls back to alpha for groups not in savedOrder", () => {
    const result = orderGroups(["Zzz", "Aaa", OTHER_GROUP], []);
    expect(result).toEqual(["Aaa", "Zzz", OTHER_GROUP]);
  });

  it("is case-insensitive for the savedOrder lookup", () => {
    const result = orderGroups(["Cash", "Savings", OTHER_GROUP], ["savings", "cash"]);
    expect(result.slice(0, 2)).toEqual(["Savings", "Cash"]);
    expect(result[result.length - 1]).toBe(OTHER_GROUP);
  });

  it("de-dupes groups before ordering", () => {
    const result = orderGroups(["Cash", "cash", "Other"], ["Cash"]);
    // "cash" is a dup of "Cash" → only one "Cash" entry
    expect(result).toEqual(["Cash", OTHER_GROUP]);
  });

  it("returns empty array for empty input", () => {
    expect(orderGroups([], [])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = ["Other", "Cash", "Savings"];
    const copy = [...input];
    orderGroups(input, ["Savings"]);
    expect(input).toEqual(copy);
  });
});
