/**
 * FINLYNQ-129 — manage_rules write-path regression coverage.
 *
 * The API-key and OAuth transports share the same PostgreSQL tool registrar,
 * so this test exercises the common handler with a user-scoped category and
 * verifies the v2 INSERT shape. The transport-specific auth suites cover the
 * two entry points separately.
 */

import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.PF_JWT_SECRET = "test-jwt-secret-for-vitest-32chars!!";
process.env.PF_PEPPER = process.env.PF_PEPPER ?? "test-pepper-32chars-for-vitest-only!!";
process.env.PF_STAGING_KEY = process.env.PF_STAGING_KEY ?? "test-staging-key-32chars-for-vitest!";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPgTools } from "../../mcp-server/register-tools-pg";
import { encryptField } from "../../src/lib/crypto/envelope";

const DEK = randomBytes(32);

function serializeSqlTemplate(query: unknown): string {
  if (!query || typeof query !== "object") return String(query);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlObject = query as any;
  try {
    const dialect = { escapeName: (name: string) => `"${name}"`, escapeParam: () => "?" };
    const rendered = sqlObject.toQuery?.(dialect);
    if (rendered && typeof rendered.sql === "string") return rendered.sql;
  } catch {
    // Fall through to the chunk renderer used by the other MCP harnesses.
  }
  const chunks = sqlObject.queryChunks ?? sqlObject.chunks ?? [];
  return chunks
    .map((chunk: unknown) => {
      if (chunk && typeof chunk === "object" && Array.isArray((chunk as { value?: unknown[] }).value)) {
        return (chunk as { value: string[] }).value.join("");
      }
      return typeof chunk === "string" ? chunk : "";
    })
    .join("");
}

function bootstrap() {
  const queries: string[] = [];
  const db = {
    execute: async (query: unknown) => {
      const rendered = serializeSqlTemplate(query);
      queries.push(rendered);
      if (/FROM\s+categories/i.test(rendered)) {
        return {
          rows: [{ id: 7, name_ct: encryptField(DEK, "Salary") }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const server = new McpServer({ name: "manage-rules-write-test", version: "0.0.0" });
  registerPgTools(server, db, "user-1", DEK);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (server as any)._registeredTools as Record<string, { handler?: (args: unknown, extra: unknown) => Promise<unknown> }>;
  return { queries, handler: tools["manage_rules"]?.handler };
}

describe("manage_rules v2 write path (FINLYNQ-129)", () => {
  it("creates the legacy shorthand rule using the encrypted v2 INSERT shape", async () => {
    const { queries, handler } = bootstrap();
    expect(handler, "manage_rules must be registered").toBeDefined();

    const response = await handler!({
      op: "create",
      match_payee: "Demo Employer",
      assign_category: "Salary",
    }, {});
    const body = JSON.parse((response as { content: [{ text: string }] }).content[0].text) as {
      success: boolean;
      data?: { message?: string };
    };

    expect(body.success).toBe(true);
    expect(body.data?.message).toMatch(/Rule created/);

    const insert = queries.find((query) => /INSERT INTO\s+transaction_rules/i.test(query));
    expect(insert).toBeDefined();
    expect(insert).toMatch(/conditions/);
    expect(insert).toMatch(/actions/);
    expect(insert).toMatch(/created_at/);
    expect(insert).not.toMatch(/match_field|match_type|match_value|assign_category_id/);
  });
});

describe("transaction-rules v2 migration safety (FINLYNQ-129)", () => {
  it("refuses legacy rows instead of truncating them", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../scripts/migrate-finlynq-84-rules-v2.sql"),
      "utf8",
    );

    expect(migration).toMatch(/legacy_rows/);
    expect(migration).toMatch(/RAISE EXCEPTION/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS conditions jsonb/i);
    expect(migration).toMatch(/DROP COLUMN IF EXISTS match_field/i);
    expect(migration).not.toMatch(/TRUNCATE\s+transaction_rules/i);
  });
});
