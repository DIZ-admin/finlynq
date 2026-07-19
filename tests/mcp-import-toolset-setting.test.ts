import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  db: {},
  schema: { settings: {} },
}));

import { parseImportToolsetEnabled } from "@/lib/mcp/import-toolset-setting";

describe("MCP import toolset setting", () => {
  it("defaults absent and malformed values to disabled", () => {
    expect(parseImportToolsetEnabled(undefined)).toBe(false);
    expect(parseImportToolsetEnabled(null)).toBe(false);
    expect(parseImportToolsetEnabled("")).toBe(false);
    expect(parseImportToolsetEnabled("yes")).toBe(false);
    expect(parseImportToolsetEnabled("TRUE")).toBe(false);
  });

  it("accepts the canonical persisted enabled values only", () => {
    expect(parseImportToolsetEnabled("1")).toBe(true);
    expect(parseImportToolsetEnabled("true")).toBe(true);
    expect(parseImportToolsetEnabled("0")).toBe(false);
    expect(parseImportToolsetEnabled("false")).toBe(false);
  });

  it("exposes the setting through an authenticated owner-scoped route", () => {
    const route = readFileSync("src/app/api/settings/mcp-import/route.ts", "utf8");
    expect(route).toContain("apiHandler");
    expect(route).toContain('auth: "auth"');
    expect(route).toContain("userId");
    expect(route).toContain("getImportToolsetEnabled");
    expect(route).toContain("setImportToolsetEnabled");
    expect(route).toContain("body: updateSchema");
    expect(route).not.toContain("schema.settings");
  });

  it("keeps the UI path on Settings → Integrations", () => {
    const page = readFileSync(
      "src/app/(app)/settings/integrations/page.tsx",
      "utf8",
    );
    expect(page).toContain("McpImportToolsetCard");
    expect(page).toContain("./mcp-import-toolset");
  });
});
