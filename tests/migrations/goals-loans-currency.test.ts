import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../../scripts/migrations/20260720_goals_loans_currency.sql");

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("goals/loans currency schema repair migration", () => {
  it("is in the automatic migration directory and repairs both columns idempotently", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/ALTER TABLE\s+goals\s+ADD COLUMN IF NOT EXISTS currency\s+TEXT\s+NOT NULL\s+DEFAULT\s+'CAD'/);
    expect(sql).toMatch(/ALTER TABLE\s+loans\s+ADD COLUMN IF NOT EXISTS currency\s+TEXT\s+NOT NULL\s+DEFAULT\s+'CAD'/);
    expect(sql).toMatch(/UPDATE goals\s+AS g[\s\S]*SET currency = a\.currency/);
    expect(sql).toMatch(/UPDATE loans\s+AS l[\s\S]*SET currency = a\.currency/);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/);
  });

  it("does not open or close its own transaction", () => {
    // The migration runner owns a single transaction for each file. Nested
    // BEGIN/COMMIT would make the runner's checksum insert unreliable.
    const sql = migrationSql();
    expect(sql.split(/\r?\n/).some((line) => /^(BEGIN|COMMIT)\s*;\s*$/.test(line.trim()))).toBe(false);
  });
});
