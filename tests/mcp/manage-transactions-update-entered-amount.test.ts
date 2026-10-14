/**
 * MCP manage_transactions(op:update) with amount-only: entered_* must stay in sync
 *
 * Bug: updating transaction with {id, amount} without enteredAmount left
 * entered_amount/entered_currency/entered_fx_rate at stale values.
 *
 * When amount changes and enteredAmount is not supplied:
 * - Same currency case: set entered_amount = amount, entered_fx_rate = 1
 * - Cross-currency case: keep entered_amount, recompute entered_fx_rate = amount / entered_amount
 */
import { describe, it, expect, beforeAll } from "vitest";

process.env.PF_JWT_SECRET = process.env.PF_JWT_SECRET ?? "test-jwt-secret-for-vitest-32chars!!";
process.env.PF_PEPPER = process.env.PF_PEPPER ?? "test-pepper-32chars-for-vitest-only!!";
process.env.PF_STAGING_KEY = process.env.PF_STAGING_KEY ?? "test-staging-key-32chars-for-vitest!";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { registerPgTools } from "../../mcp-server/register-tools-pg";
import { withAutoAnnotations } from "../../mcp-server/auto-annotations";

type Tool = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ text: string }> }>;
};

const dialect = new PgDialect();
let executed: Array<{ sql: string; params: unknown[] }> = [];
let tool: Tool;

// Mock transaction rows
const mockTransactionVnd = {
  id: 123,
  account_id: 1,
  category_id: 10,
  date: "2024-01-15",
  amount: -138512,
  entered_amount: -138512,
  entered_currency: "VND",
  account_currency: "VND",
};
const mockTransactionCrossCurrency = {
  id: 124,
  account_id: 1,
  category_id: 10,
  date: "2024-01-15",
  amount: 98512,
  entered_amount: 1000,
  entered_currency: "USD",
  account_currency: "VND",
};

beforeAll(() => {
  const server = withAutoAnnotations(new McpServer({ name: "tx-update-test", version: "0.0.0" }));
  registerPgTools(
    server,
    {
      execute: async (query: SQL) => {
        const rendered = dialect.sqlToQuery(query);
        executed.push({ sql: rendered.sql, params: rendered.params });

        const sql = rendered.sql;

        // Mock the initial SELECT to get existing transaction
        if (sql.includes("SELECT t.id, t.account_id, t.category_id, t.date, t.amount, t.entered_amount, t.entered_currency")) {
          if (rendered.params && rendered.params.length > 0) {
            const txId = rendered.params[rendered.params.length - 1];
            if (txId === 124) {
              return {
                rows: [{
                  id: mockTransactionCrossCurrency.id,
                  account_id: mockTransactionCrossCurrency.account_id,
                  category_id: mockTransactionCrossCurrency.category_id,
                  date: mockTransactionCrossCurrency.date,
                  amount: mockTransactionCrossCurrency.amount,
                  entered_amount: mockTransactionCrossCurrency.entered_amount,
                  entered_currency: mockTransactionCrossCurrency.entered_currency,
                  account_currency: mockTransactionCrossCurrency.account_currency,
                }],
                rowCount: 1,
              };
            }
          }
          return {
            rows: [{
              id: mockTransactionVnd.id,
              account_id: mockTransactionVnd.account_id,
              category_id: mockTransactionVnd.category_id,
              date: mockTransactionVnd.date,
              amount: mockTransactionVnd.amount,
              entered_amount: mockTransactionVnd.entered_amount,
              entered_currency: mockTransactionVnd.entered_currency,
              account_currency: mockTransactionVnd.account_currency,
            }],
            rowCount: 1,
          };
        }

        // Mock the reporting currency lookup
        if (sql.includes("SELECT display_currency FROM users WHERE id =")) {
          return { rows: [{ display_currency: "VND" }], rowCount: 1 };
        }

        // Mock the full transaction read for reporting fields
        if (sql.includes("SELECT t.date, t.amount, t.currency FROM transactions")) {
          return {
            rows: [{
              date: mockTransactionVnd.date,
              amount: mockTransactionVnd.amount,
              currency: mockTransactionVnd.account_currency,
            }],
            rowCount: 1,
          };
        }

        // Mock the updated_at read
        if (sql.includes("SELECT updated_at FROM transactions")) {
          return { rows: [{ updated_at: new Date().toISOString() }], rowCount: 1 };
        }

        // For other SELECTs, return empty
        if (sql.includes("SELECT")) {
          return { rows: [], rowCount: 0 };
        }

        // Don't actually execute updates in this mock
        if (sql.includes("UPDATE transactions")) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    "default",
    Buffer.alloc(32),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool = (server as any)._registeredTools.manage_transactions as Tool;
});

describe("MCP manage_transactions(op:update) — amount-only path keeps entered_* in sync", () => {
  it("same-currency amount update: sets entered_amount = new amount and entered_fx_rate = 1", async () => {
    executed = [];

    await tool.handler(
      {
        op: "update",
        id: mockTransactionVnd.id,
        amount: -98512, // new amount, entered_currency stays VND (same as account)
        // no enteredAmount — this is the amount-only case
      },
      {}
    );

    // Should have UPDATE statement that updates entered_amount, entered_currency, entered_fx_rate
    const updates = executed.filter(e => e.sql.includes("UPDATE transactions"));

    // Find the update that includes entered_fx_rate
    const amountUpdate = updates.find(e => {
      const sql = e.sql;
      return sql.includes("entered_fx_rate = ");
    });

    expect(amountUpdate).toBeDefined();
    expect(amountUpdate!.sql).toContain("amount = ");
    expect(amountUpdate!.sql).toContain("entered_amount = ");
    expect(amountUpdate!.sql).toContain("entered_currency = ");
    expect(amountUpdate!.sql).toContain("entered_fx_rate = ");

    // Verify the parameters
    // Should have: amount, entered_amount, entered_currency, entered_fx_rate, updated_at, id, userId
    const params = amountUpdate!.params;
    expect(params).toContain(-98512); // new amount
    expect(params).toContain(-98512); // entered_amount should equal amount in same-currency case
    expect(params).toContain("VND"); // entered_currency should be account currency
    expect(params).toContain(1); // entered_fx_rate should be 1
  });

  it("cross-currency amount update: keeps entered_amount, recomputes entered_fx_rate", async () => {
    executed = [];

    await tool.handler(
      {
        op: "update",
        id: mockTransactionCrossCurrency.id,
        amount: 50000, // new VND amount; entered is USD 1000
        // no enteredAmount
      },
      {}
    );

    const updates = executed.filter(e => e.sql.includes("UPDATE transactions"));

    const amountUpdate = updates.find(e => {
      const sql = e.sql;
      return sql.includes("entered_fx_rate = ");
    });

    expect(amountUpdate).toBeDefined();

    const params = amountUpdate!.params;
    // Should have 50000 (new amount)
    expect(params).toContain(50000);
    // Should have 1000 (existing entered_amount, kept unchanged)
    expect(params).toContain(1000);
    // Should have USD (existing entered_currency, kept unchanged)
    expect(params).toContain("USD");
    // Should have 50 (50000 / 1000 = 50, the recomputed rate)
    expect(params).toContain(50);
  });
});
