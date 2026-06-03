/**
 * Golden-value tests for buildTransactionQuery (FINLYNQ-111 Phase 1).
 *
 * These pin the query string the `/transactions` page emits for a GET
 * /api/transactions request, so the extraction stays byte-identical to the
 * original inline param builder. Pure function — no DB, no fetch, no mocks.
 *
 * Each expected value below is derived by walking the ORIGINAL inline code
 * (transactions/page.tsx :786-856 pre-refactor) by hand, NOT by capturing the
 * new function's output — so the test actually asserts behaviour-equivalence.
 */

import { describe, it, expect } from "vitest";
import {
  buildTransactionQuery,
  type TxFilters,
  type TxSortPref,
  type TxColFilter,
  type TxQueryAccount,
} from "@/lib/transactions/build-query";

const EMPTY_FILTERS: TxFilters = {
  startDate: "",
  endDate: "",
  accountId: "",
  categoryId: "",
  search: "",
  portfolioHolding: "",
  tag: "",
};
const NO_SORT: TxSortPref = { columnId: null, direction: null };
const PAGE0: { page: number; limit: number } = { page: 0, limit: 50 };

const ACCOUNTS: TxQueryAccount[] = [
  { id: 1, type: "checking" },
  { id: 2, type: "savings" },
  { id: 3, type: "credit" },
  { id: 4, type: "checking" },
  { id: 5, type: null },
];

function build(
  filters: TxFilters,
  sort: TxSortPref,
  colFilters: TxColFilter[],
  page = PAGE0,
  accounts = ACCOUNTS,
): string {
  return buildTransactionQuery(filters, sort, colFilters, accounts, page).toString();
}

describe("buildTransactionQuery", () => {
  it("emits only limit + offset for an empty query (page 0)", () => {
    // No filters, no sort, no col-filters → just pagination.
    expect(build(EMPTY_FILTERS, NO_SORT, [])).toBe("limit=50&offset=0");
  });

  it("computes offset as page * limit", () => {
    expect(build(EMPTY_FILTERS, NO_SORT, [], { page: 3, limit: 50 })).toBe("limit=50&offset=150");
    expect(build(EMPTY_FILTERS, NO_SORT, [], { page: 2, limit: 25 })).toBe("limit=25&offset=50");
  });

  it("maps every top-bar filter to its param, in declared order", () => {
    const filters: TxFilters = {
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      accountId: "7",
      categoryId: "9",
      search: "coffee",
      portfolioHolding: "VTI",
      tag: "business",
    };
    expect(build(filters, NO_SORT, [])).toBe(
      "startDate=2026-01-01&endDate=2026-03-31&accountId=7&categoryId=9&search=coffee&portfolioHolding=VTI&tag=business&limit=50&offset=0",
    );
  });

  it("skips empty-string top-bar filters", () => {
    const filters: TxFilters = { ...EMPTY_FILTERS, accountId: "12", search: "rent" };
    expect(build(filters, NO_SORT, [])).toBe("accountId=12&search=rent&limit=50&offset=0");
  });

  it("sets sort + sortDir only when both columnId and direction are present", () => {
    expect(build(EMPTY_FILTERS, { columnId: "amount", direction: "desc" }, [])).toBe(
      "sort=amount&sortDir=desc&limit=50&offset=0",
    );
    // direction null → no sort params emitted
    expect(build(EMPTY_FILTERS, { columnId: "amount", direction: null }, [])).toBe("limit=50&offset=0");
    // columnId null → no sort params emitted
    expect(build(EMPTY_FILTERS, { columnId: null, direction: "asc" }, [])).toBe("limit=50&offset=0");
  });

  // ---- date col-filter precedence (load-bearing) ----

  it("date col-filter sets startDate/endDate when the top-bar has not", () => {
    const cf: TxColFilter[] = [{ type: "date", columnId: "date", from: "2026-02-01", to: "2026-02-28" }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe(
      "startDate=2026-02-01&endDate=2026-02-28&limit=50&offset=0",
    );
  });

  it("date col-filter does NOT override an already-set top-bar startDate/endDate", () => {
    const filters: TxFilters = { ...EMPTY_FILTERS, startDate: "2026-01-01", endDate: "2026-01-31" };
    const cf: TxColFilter[] = [{ type: "date", columnId: "date", from: "2026-02-01", to: "2026-02-28" }];
    // Top-bar wins on both ends.
    expect(build(filters, NO_SORT, cf)).toBe(
      "startDate=2026-01-01&endDate=2026-01-31&limit=50&offset=0",
    );
  });

  it("date col-filter fills only the unset end (per-end precedence)", () => {
    const filters: TxFilters = { ...EMPTY_FILTERS, startDate: "2026-01-01" };
    const cf: TxColFilter[] = [{ type: "date", columnId: "date", from: "2026-02-01", to: "2026-02-28" }];
    // startDate already set (top-bar wins); endDate falls through to the col-filter.
    expect(build(filters, NO_SORT, cf)).toBe(
      "startDate=2026-01-01&endDate=2026-02-28&limit=50&offset=0",
    );
  });

  it("createdAt / updatedAt date col-filters use their own param pairs", () => {
    const cf: TxColFilter[] = [
      { type: "date", columnId: "createdAt", from: "2026-01-01", to: "2026-01-31" },
      { type: "date", columnId: "updatedAt", from: "2026-02-01", to: "2026-02-28" },
    ];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe(
      "createdAtFrom=2026-01-01&createdAtTo=2026-01-31&updatedAtFrom=2026-02-01&updatedAtTo=2026-02-28&limit=50&offset=0",
    );
  });

  // ---- text col-filter ----

  it("text col-filter emits filter_<columnId>", () => {
    const cf: TxColFilter[] = [{ type: "text", columnId: "payee", value: "Amazon" }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("filter_payee=Amazon&limit=50&offset=0");
  });

  // ---- numeric col-filter ----

  it("numeric eq → <prefix>Eq", () => {
    const cf: TxColFilter[] = [{ type: "numeric", columnId: "amount", op: "eq", value: 100 }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("amountEq=100&limit=50&offset=0");
  });

  it("numeric gt → <prefix>Min, lt → <prefix>Max", () => {
    expect(
      build(EMPTY_FILTERS, NO_SORT, [{ type: "numeric", columnId: "amount", op: "gt", value: 50 }]),
    ).toBe("amountMin=50&limit=50&offset=0");
    expect(
      build(EMPTY_FILTERS, NO_SORT, [{ type: "numeric", columnId: "quantity", op: "lt", value: 10 }]),
    ).toBe("quantityMax=10&limit=50&offset=0");
  });

  it("numeric between → Min + Max (Max only when value2 present)", () => {
    expect(
      build(EMPTY_FILTERS, NO_SORT, [{ type: "numeric", columnId: "amount", op: "between", value: 10, value2: 90 }]),
    ).toBe("amountMin=10&amountMax=90&limit=50&offset=0");
    // value2 absent → only Min
    expect(
      build(EMPTY_FILTERS, NO_SORT, [{ type: "numeric", columnId: "amount", op: "between", value: 10 }]),
    ).toBe("amountMin=10&limit=50&offset=0");
  });

  it("numeric col-filter on a non-amount/quantity column is skipped (no prefix)", () => {
    // The original `continue`s when prefix is null.
    const cf: TxColFilter[] = [{ type: "numeric", columnId: "note", op: "eq", value: 5 }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("limit=50&offset=0");
  });

  // ---- enum col-filters ----

  it("enum source → sources (comma-joined)", () => {
    const cf: TxColFilter[] = [{ type: "enum", columnId: "source", values: ["manual", "import"] }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("sources=manual%2Cimport&limit=50&offset=0");
  });

  it("enum category → categoryIds (comma-joined)", () => {
    const cf: TxColFilter[] = [{ type: "enum", columnId: "category", values: ["3", "7"] }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("categoryIds=3%2C7&limit=50&offset=0");
  });

  it("enum account → accountIds verbatim (no resolution)", () => {
    const cf: TxColFilter[] = [{ type: "enum", columnId: "account", values: ["11", "22"] }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("accountIds=11%2C22&limit=50&offset=0");
  });

  it("enum accountType → resolves matching account ids and joins them", () => {
    // "checking" matches ids 1 + 4 (id 5 has null type → excluded).
    const cf: TxColFilter[] = [{ type: "enum", columnId: "accountType", values: ["checking"] }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("accountIds=1%2C4&limit=50&offset=0");
  });

  it("enum accountType → multiple types resolve to the union of ids, in account order", () => {
    const cf: TxColFilter[] = [{ type: "enum", columnId: "accountType", values: ["savings", "credit"] }];
    // savings = id 2, credit = id 3 → "2,3" in account iteration order.
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("accountIds=2%2C3&limit=50&offset=0");
  });

  it("enum accountType → emits NOTHING when no account matches the type", () => {
    // The original only sets accountIds when ids.length > 0.
    const cf: TxColFilter[] = [{ type: "enum", columnId: "accountType", values: ["brokerage"] }];
    expect(build(EMPTY_FILTERS, NO_SORT, cf)).toBe("limit=50&offset=0");
  });

  // ---- combined: top-bar + sort + multiple col-filters ----

  it("combines top-bar filters, sort, and several col-filters in source order", () => {
    const filters: TxFilters = { ...EMPTY_FILTERS, accountId: "8", search: "groceries" };
    const sort: TxSortPref = { columnId: "date", direction: "asc" };
    const cf: TxColFilter[] = [
      { type: "text", columnId: "payee", value: "Whole Foods" },
      { type: "numeric", columnId: "amount", op: "gt", value: 20 },
      { type: "enum", columnId: "accountType", values: ["checking"] },
    ];
    expect(build(filters, sort, cf, { page: 1, limit: 50 })).toBe(
      "accountId=8&search=groceries&sort=date&sortDir=asc&filter_payee=Whole+Foods&amountMin=20&accountIds=1%2C4&limit=50&offset=50",
    );
  });
});
