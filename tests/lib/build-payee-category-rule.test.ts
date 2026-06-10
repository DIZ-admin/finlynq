/**
 * Unit tests for `buildPayeeCategoryRule` (FINLYNQ-125).
 *
 * The inline "Also create a rule" affordance in `TransactionDialog` builds its
 * `POST /api/rules` payload through this pure helper. These tests pin the
 * helper to:
 *   1. the trim/slice naming contract (name ≤ 120 even for a 300-char payee),
 *   2. the full-trimmed-payee condition value (so the rule matches the whole
 *      payee substring on future imports, not the truncated display name),
 *   3. the SERVER contract — `Rule.safeParse(payload).success === true`, which
 *      is the same Zod schema `/api/rules` re-validates against (tc-1).
 */
import { describe, it, expect } from "vitest";

import { buildPayeeCategoryRule } from "@/lib/rules/build-payee-category-rule";
import { Rule } from "@/lib/rules/schema";

describe("buildPayeeCategoryRule", () => {
  it("builds a server-valid payee→set_category rule for a normal payee", () => {
    const payload = buildPayeeCategoryRule("Whole Foods Market", 42);

    expect(payload.name).toBe('Match "Whole Foods Market"');
    expect(payload.conditions.all).toEqual([
      { field: "payee", op: "contains", value: "Whole Foods Market" },
    ]);
    expect(payload.actions).toEqual([{ kind: "set_category", categoryId: 42 }]);
    expect(payload.priority).toBe(0);
    expect(payload.isActive).toBe(true);

    // Pin to the same Zod schema /api/rules re-validates against.
    const parsed = Rule.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("trims surrounding whitespace before naming and matching", () => {
    const payload = buildPayeeCategoryRule("  Costco Wholesale  ", 7);

    expect(payload.name).toBe('Match "Costco Wholesale"');
    expect(
      (payload.conditions.all[0] as { value: string }).value,
    ).toBe("Costco Wholesale");
    expect(Rule.safeParse(payload).success).toBe(true);
  });

  it("caps the name at ≤120 chars for a 300-char payee while keeping the full payee as the condition value", () => {
    const longPayee = "A".repeat(300);
    const payload = buildPayeeCategoryRule(longPayee, 1);

    // Name slices the payee to 100 → 'Match "' (7) + 100 + '"' (1) = 108 ≤ 120.
    expect(payload.name).toBe(`Match "${"A".repeat(100)}"`);
    expect(payload.name.length).toBeLessThanOrEqual(120);

    // Condition value carries the full (untruncated) trimmed payee. The server
    // schema caps string-condition values at 500, so a 300-char payee is fine.
    expect((payload.conditions.all[0] as { value: string }).value).toBe(longPayee);

    expect(Rule.safeParse(payload).success).toBe(true);
  });
});
