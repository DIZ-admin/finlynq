import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const fixture = vi.hoisted(() => ({ userId: "", failAfterBackfill: false }));
vi.mock("@/lib/auth/require-encryption", () => ({
  requireEncryption: async () => ({ ok: true, userId: fixture.userId, dek: Buffer.alloc(32, 0xaa) }),
}));
vi.mock("@/lib/investment-account", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/investment-account")>();
  return {
    ...real,
    backfillInvestmentAccount: async (...args: Parameters<typeof real.backfillInvestmentAccount>) => {
      const result = await real.backfillInvestmentAccount(...args);
      if (fixture.failAfterBackfill) throw new Error("synthetic failure after backfill");
      return result;
    },
  };
});

import { PUT } from "@/app/api/accounts/route";
import { db, schema } from "@/db";
import { getAccountById } from "@/lib/queries";
import { createMockRequest } from "../helpers/api-test-utils";
import {
  bootstrapTestDb,
  createAccount,
  createTestUser,
  recordTransaction,
  shutdownTestDb,
} from "../helpers/portfolio-fixtures";

describe.runIf(process.env.FINLYNQ_ACCOUNT_PG_TEST === "1")("investment conversion on PostgreSQL", () => {
  beforeAll(bootstrapTestDb);
  afterAll(shutdownTestDb);

  it("rolls back both writes, then retries the same PUT successfully", async () => {
    fixture.userId = await createTestUser();
    const id = await createAccount({
      userId: fixture.userId, name: "Fixture", currency: "CAD", isInvestment: false, type: "A",
    });
    const transactionId = await recordTransaction({
      userId: fixture.userId, accountId: id, currency: "CAD", amount: 100,
    });
    const request = () => createMockRequest("http://localhost/api/accounts", {
      method: "PUT", body: { id, isInvestment: true },
    });
    const holdingId = async () => {
      const [row] = await db.select({ id: schema.transactions.portfolioHoldingId })
        .from(schema.transactions).where(eq(schema.transactions.id, transactionId));
      return row.id;
    };
    fixture.failAfterBackfill = true;
    expect((await PUT(request())).status).toBe(500);
    expect((await getAccountById(id, fixture.userId))?.isInvestment).toBe(false);
    expect(await holdingId()).toBeNull();

    fixture.failAfterBackfill = false;
    expect((await PUT(request())).status).toBe(200);
    expect((await getAccountById(id, fixture.userId))?.isInvestment).toBe(true);
    expect(await holdingId()).toEqual(expect.any(Number));
  });
});
