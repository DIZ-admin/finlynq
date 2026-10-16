/**
 * Goal currency: a static wiring gate over every surface that creates or
 * renders a goal.
 *
 * WHY THIS EXISTS
 * ---------------
 * `goals.currency` defaulted to 'CAD' at the column level, and two of the three
 * create paths leaned on that default:
 *
 *   * MCP `manage_goals(op:add)` omitted the column from its INSERT, so every
 *     goal an assistant created was CAD — for a USD user too — and its progress
 *     was then measured in CAD (USD balances inflated by the CAD/USD rate).
 *   * REST `POST /api/goals` only set it when the caller sent one.
 *   * `scripts/seed-demo.ts` never named it, so the public demo's goals were
 *     re-stamped CAD on every nightly reseed.
 *
 * And the `/goals` page formatted every goal in the DISPLAY currency, so a
 * goal's real currency was invisible, and it summed native amounts across
 * currencies under one symbol (FINLYNQ-123).
 *
 * The precedence rule itself (`pickRecordCurrency`) is unit-tested in
 * loan-currency.test.ts. These assertions are pure source reads: they can't
 * prove runtime behaviour, but they catch the regression this codebase keeps
 * shipping — a correct rule that some call site quietly fails to use.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const MCP_GOALS = read("mcp-server/tools/goals.ts");
const REST_GOALS = read("src/app/api/goals/route.ts");
const GOALS_PAGE = read("src/app/(app)/goals/page.tsx");
const GOALS_PROGRESS = read("src/lib/goals-progress.ts");
const SCHEMA = read("src/db/schema-pg.ts");
const SEED_DEMO = read("scripts/seed-demo.ts");

/** Strip comments — the files document the very literal ("CAD") being banned. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("wiring: new goals never fall through to a CAD default", () => {
  it("the goals table defaults to USD, not CAD", () => {
    const block = SCHEMA.slice(SCHEMA.indexOf('pgTable("goals"'));
    const currencyLine = codeOnly(block).split("\n").find((l) => l.includes("currency: text("));
    expect(currencyLine).toBeDefined();
    expect(currencyLine).toContain('default("USD")');
  });

  it("a migration moves the live column default too", () => {
    const sql = read("scripts/migrations/20261002_goals_currency_default_usd.sql");
    expect(sql).toMatch(/ALTER TABLE goals ALTER COLUMN currency SET DEFAULT 'USD'/);
  });

  it("MCP manage_goals add resolves the currency and names the column in its INSERT", () => {
    expect(MCP_GOALS).toContain("pickRecordCurrency");
    expect(MCP_GOALS).toContain("resolveReportingCurrency");
    const insert = MCP_GOALS.slice(MCP_GOALS.indexOf("INSERT INTO goals"));
    // Omitting the column is the original bug.
    expect(insert.slice(0, insert.indexOf("RETURNING"))).toMatch(/\bcurrency\b/);
  });

  it("MCP manage_goals add + update accept an explicit currency", () => {
    const add = MCP_GOALS.slice(MCP_GOALS.indexOf("const addVariant"), MCP_GOALS.indexOf("const updateVariant"));
    const update = MCP_GOALS.slice(MCP_GOALS.indexOf("const updateVariant"), MCP_GOALS.indexOf("const deleteVariant"));
    expect(add).toContain("currency:");
    expect(update).toContain("currency:");
  });

  it("REST POST resolves the currency instead of conditionally spreading it", () => {
    expect(REST_GOALS).toContain("pickRecordCurrency");
    expect(REST_GOALS).toContain("getDisplayCurrency");
    // The old bug, verbatim: only persisted when the caller sent one.
    expect(REST_GOALS).not.toContain("...(d.currency ? { currency:");
  });

  it("the demo seed stamps its goals with a currency", () => {
    const insert = SEED_DEMO.slice(SEED_DEMO.indexOf("INSERT INTO goals"));
    expect(insert.slice(0, insert.indexOf("VALUES"))).toMatch(/\bcurrency\b/);
  });

  it("no goal surface falls back to a CAD literal", () => {
    for (const [label, src] of [
      ["mcp goals", MCP_GOALS],
      ["rest /api/goals", REST_GOALS],
      ["goals page", GOALS_PAGE],
      ["goals-progress", GOALS_PROGRESS],
    ] as const) {
      expect(codeOnly(src), `${label} still has a CAD literal`).not.toMatch(/["']CAD["']/);
    }
  });
});

describe("wiring: the goals page shows each goal in its own currency", () => {
  it("per-goal amounts use the goal's currency, never the display currency alone", () => {
    const code = codeOnly(GOALS_PAGE);
    expect(code).toContain("formatCurrency(g.currentAmount, g.currency || displayCurrency)");
    expect(code).toContain("formatCurrency(g.targetAmount, g.currency || displayCurrency)");
    // The old bug, verbatim: native amounts rendered under the display symbol.
    expect(code).not.toContain("formatCurrency(g.currentAmount, displayCurrency)");
    expect(code).not.toContain("formatCurrency(g.targetAmount, displayCurrency)");
    expect(code).not.toContain("formatCurrency(g.remaining, displayCurrency)");
  });

  it("the summary tiles total the server's display-currency conversions", () => {
    const code = codeOnly(GOALS_PAGE);
    expect(code).toContain("targetAmountDisplay");
    expect(code).toContain("currentAmountDisplay");
  });

  it("REST GET emits the display-currency companions", () => {
    expect(REST_GOALS).toContain("targetAmountDisplay");
    expect(REST_GOALS).toContain("currentAmountDisplay");
    expect(REST_GOALS).toContain("getRateMap");
  });
});
