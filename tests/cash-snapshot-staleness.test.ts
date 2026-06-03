/**
 * Pure-unit tests for isCashStale — the linchpin of the DEK-free cash-snapshot
 * freshness machinery (plan/net-worth-cash-snapshots.md Phase 3/5).
 *
 * `@/db` is mocked so importing cash-meta.ts (which imports the db proxy for its
 * async helpers) never touches Postgres; isCashStale itself is pure.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/db", () => ({ db: {}, schema: {} }));

import {
  isCashStale,
  type CashSnapshotMeta,
  type CashTxFingerprint,
} from "@/lib/portfolio/snapshots/cash-meta";

const TODAY = "2026-06-02";
const t = (iso: string) => new Date(iso);

function meta(over: Partial<CashSnapshotMeta> = {}): CashSnapshotMeta {
  return {
    txMaxUpdated: t("2026-06-01T00:00:00Z"),
    txCount: 10,
    builtThrough: TODAY,
    ...over,
  };
}
function live(over: Partial<CashTxFingerprint> = {}): CashTxFingerprint {
  return { maxUpdated: t("2026-06-01T00:00:00Z"), count: 10, ...over };
}

describe("isCashStale", () => {
  it("is fresh when count, max-updated and built_through all match today", () => {
    expect(isCashStale(live(), meta(), TODAY)).toBe(false);
  });

  it("is stale when no meta row exists yet (never built / first view)", () => {
    expect(isCashStale(live(), null, TODAY)).toBe(true);
  });

  it("is stale on an INSERT — live count higher than built count", () => {
    expect(isCashStale(live({ count: 11 }), meta({ txCount: 10 }), TODAY)).toBe(true);
  });

  it("is stale on a DELETE — live count lower (max-updated unchanged)", () => {
    // The delete leaves the newest create/update instant untouched; only the
    // count reveals it. This is the case the count column exists for.
    expect(
      isCashStale(
        live({ count: 9, maxUpdated: t("2026-06-01T00:00:00Z") }),
        meta({ txCount: 10, txMaxUpdated: t("2026-06-01T00:00:00Z") }),
        TODAY,
      ),
    ).toBe(true);
  });

  it("is stale on an EDIT — a cash tx updated after the build watermark", () => {
    expect(
      isCashStale(
        live({ maxUpdated: t("2026-06-02T09:00:00Z") }),
        meta({ txMaxUpdated: t("2026-06-01T00:00:00Z") }),
        TODAY,
      ),
    ).toBe(true);
  });

  it("is stale on a NEW DAY — built_through earlier than today", () => {
    expect(isCashStale(live(), meta({ builtThrough: "2026-06-01" }), TODAY)).toBe(true);
  });

  it("is stale when built_through is null", () => {
    expect(isCashStale(live(), meta({ builtThrough: null }), TODAY)).toBe(true);
  });

  it("treats equal max-updated instants as fresh (not strictly newer)", () => {
    const same = t("2026-06-01T12:34:56Z");
    expect(
      isCashStale(live({ maxUpdated: same }), meta({ txMaxUpdated: same }), TODAY),
    ).toBe(false);
  });

  it("is fresh for a user with zero cash txns and matching null watermarks", () => {
    expect(
      isCashStale(
        { maxUpdated: null, count: 0 },
        { txMaxUpdated: null, txCount: 0, builtThrough: TODAY },
        TODAY,
      ),
    ).toBe(false);
  });
});
