/**
 * Pure-unit tests for rankBreakdown (FINLYNQ-128 — chart tooltip top-10
 * breakdown + "Other" residual). Reused by FINLYNQ-129's stacked-member view.
 *
 * Self-contained: rankBreakdown has zero deps, so no harness bootstrap.
 */

import { describe, it, expect } from "vitest";
import { rankBreakdown, type BreakdownMember } from "@/lib/chart-breakdown";

const member = (name: string, value: number): BreakdownMember => ({ name, value });

describe("rankBreakdown", () => {
  it("sorts descending by absolute contribution", () => {
    const { rows, other } = rankBreakdown([
      member("A", 30),
      member("B", -100),
      member("C", 50),
    ]);
    expect(other).toBeNull();
    expect(rows.map((r) => r.name)).toEqual(["B", "C", "A"]); // |100| > |50| > |30|
  });

  it("returns no Other row when member count <= maxMembers", () => {
    const members = Array.from({ length: 10 }, (_, i) => member(`m${i}`, 10 - i));
    const { rows, other } = rankBreakdown(members, { maxMembers: 10 });
    expect(rows).toHaveLength(10);
    expect(other).toBeNull();
  });

  it("collapses the tail past maxMembers into a single Other residual", () => {
    // 13 members, each value = index+1 → top-10 are the largest (13..4), tail = 3,2,1.
    const members = Array.from({ length: 13 }, (_, i) => member(`m${i}`, i + 1));
    const { rows, other, total } = rankBreakdown(members, { maxMembers: 10 });
    expect(rows).toHaveLength(10);
    expect(other).not.toBeNull();
    expect(other!.name).toBe("Other");
    // Tail = values 1 + 2 + 3 = 6.
    expect(other!.value).toBe(6);
    // top-10 + Other preserves the grand total (1..13 = 91).
    const grand = rows.reduce((s, r) => s + r.value, 0) + other!.value;
    expect(grand).toBe(91);
    expect(total).toBe(91);
  });

  it("preserves the grand total with mixed signs in the residual", () => {
    const members: BreakdownMember[] = [
      ...Array.from({ length: 10 }, (_, i) => member(`big${i}`, 1000 - i)),
      member("small+", 5),
      member("small-", -8),
    ];
    const { rows, other, total } = rankBreakdown(members, { maxMembers: 10 });
    expect(rows).toHaveLength(10);
    expect(other!.value).toBe(-3); // 5 + (-8)
    const grand = rows.reduce((s, r) => s + r.value, 0) + (other?.value ?? 0);
    expect(grand).toBeCloseTo(total, 6);
  });

  it("drops zero-value members so they never crowd out a real contributor", () => {
    const { rows, other } = rankBreakdown([
      member("real", 50),
      member("zero", 0),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["real"]);
    expect(other).toBeNull();
  });

  it("honours a custom otherLabel", () => {
    const members = Array.from({ length: 12 }, (_, i) => member(`m${i}`, i + 1));
    const { other } = rankBreakdown(members, { maxMembers: 10, otherLabel: "Everything else" });
    expect(other!.name).toBe("Everything else");
  });

  it("returns empty rows / null other / zero total for no members", () => {
    const { rows, other, total } = rankBreakdown([]);
    expect(rows).toEqual([]);
    expect(other).toBeNull();
    expect(total).toBe(0);
  });
});
