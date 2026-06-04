/**
 * Migrated route-group proof — FINLYNQ-107 tc-2.
 *
 * /api/portfolio/operations/buy now runs through `apiHandler` in raw/compat
 * mode. This test pins the BARE wire contract the web forms + mobile
 * `postPortfolioOperation` depend on (verified by grepping the consumers):
 *
 *   - valid body  → 201 with a BARE `{ id, ... }` body (NOT { success, data })
 *   - invalid body → 400 with a bare `{ error }` (NOT the success envelope)
 *   - domain error → bare structured `{ error, code, ... }` via mapOperationError,
 *     with the status the mapper assigns (e.g. 400 for cash_sleeve_not_found)
 *
 * Auth + validation + error mapping are now centralized in the wrapper while
 * the shape stays byte-compatible — the whole point of compat mode.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockAuthContext, createMockRequest, parseResponse } from "../helpers/api-test-utils";

// vi.hoisted — these are created before the (hoisted) vi.mock factories run, so
// the factories may close over them without the "before initialization" error.
const { recordBuy, markSnapshotsDirty, invalidateUser, CashSleeveNotFoundError } =
  vi.hoisted(() => {
    // The real-shape CashSleeveNotFoundError so mapOperationError's instanceof matches.
    class CashSleeveNotFoundError extends Error {
      readonly code = "cash_sleeve_not_found" as const;
      constructor(
        public userId: string,
        public accountId: number,
        public currency: string,
      ) {
        super("no sleeve");
        this.name = "CashSleeveNotFoundError";
      }
    }
    return {
      recordBuy: vi.fn(),
      markSnapshotsDirty: vi.fn(async () => undefined),
      invalidateUser: vi.fn(),
      CashSleeveNotFoundError,
    };
  });

vi.mock("@/lib/portfolio/operations", () => ({
  recordBuy,
  CashSleeveNotFoundError,
  // The other error classes referenced by _helpers — stubbed so the import resolves.
  CurrencyMismatchError: class CurrencyMismatchError extends Error {},
  HoldingNotFoundError: class HoldingNotFoundError extends Error {},
  InvalidLinkPairError: class InvalidLinkPairError extends Error {},
  canEditPortfolioRow: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/mcp/user-tx-cache", () => ({ invalidateUser }));
vi.mock("@/lib/portfolio/snapshots/dirty", () => ({ markSnapshotsDirty }));
vi.mock("@/lib/portfolio/lots/write-hooks", () => ({
  reverseLotsForDeleteHook: vi.fn(async () => undefined),
}));
vi.mock("@/lib/queries", () => ({ deleteTransaction: vi.fn(async () => undefined) }));
vi.mock("@/lib/server-logger", () => ({ logServerError: vi.fn(async () => undefined) }));

// Default: warm session with a DEK so requireEncryption passes. The holder is
// hoisted so the (hoisted) require-auth factory can read it; tests mutate
// `authHolder.ctx` to flip to a no-DEK (locked) session.
const authHolder = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(async () => ({ authenticated: true, context: authHolder.ctx })),
}));

// _helpers imports @/db for cascadeDeleteForReplace; not exercised here (no editId).
vi.mock("@/db", () => ({
  db: {},
  schema: { transactions: {} },
}));

import { POST } from "@/app/api/portfolio/operations/buy/route";

const validBody = {
  accountId: 1,
  holdingId: 2,
  qty: 10,
  totalCost: 1000,
  date: "2026-01-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  authHolder.ctx = mockAuthContext();
});

describe("POST /api/portfolio/operations/buy (migrated, raw/compat)", () => {
  it("returns 201 with a BARE { id } body on a valid request", async () => {
    recordBuy.mockResolvedValueOnce({ id: 99, txIds: [99, 100] });
    const req = createMockRequest("http://localhost:3000/api/portfolio/operations/buy", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req);
    const { status, data } = await parseResponse(res);
    expect(status).toBe(201);
    // Bare — exactly what recordBuy returned, NO { success, data } envelope.
    expect(data).toEqual({ id: 99, txIds: [99, 100] });
    expect(invalidateUser).toHaveBeenCalledWith("default");
    expect(markSnapshotsDirty).toHaveBeenCalledWith("default", "2026-01-01");
  });

  it("returns a bare 400 { error } on an invalid body (no envelope)", async () => {
    const req = createMockRequest("http://localhost:3000/api/portfolio/operations/buy", {
      method: "POST",
      body: { ...validBody, qty: -5 }, // qty must be positive
    });
    const res = await POST(req);
    const { status, data } = await parseResponse(res);
    expect(status).toBe(400);
    expect((data as { error?: string }).error).toBeDefined();
    expect((data as { success?: boolean }).success).toBeUndefined();
    expect(recordBuy).not.toHaveBeenCalled();
  });

  it("maps a domain error to a bare structured body via mapOperationError", async () => {
    recordBuy.mockRejectedValueOnce(new CashSleeveNotFoundError("default", 1, "USD"));
    const req = createMockRequest("http://localhost:3000/api/portfolio/operations/buy", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req);
    const { status, data } = await parseResponse(res);
    expect(status).toBe(400);
    expect(data).toMatchObject({
      code: "cash_sleeve_not_found",
      accountId: 1,
      currency: "USD",
    });
    expect((data as { success?: boolean }).success).toBeUndefined();
  });

  it("returns 423 when the session has no DEK (encryption gate)", async () => {
    authHolder.ctx = mockAuthContext({ dek: null });
    const req = createMockRequest("http://localhost:3000/api/portfolio/operations/buy", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(423);
    expect(recordBuy).not.toHaveBeenCalled();
  });
});
