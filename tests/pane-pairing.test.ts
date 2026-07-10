/**
 * R3 — persistent cross-pane reconciliation pairing (computePanePairing).
 *
 * Pure, DB-free logic that tells the /import two-pane review, for every staged
 * (file) row and bank-ledger row, whether it has a counterpart on the other
 * side. Backs the persistent tint on both panes + the "Show only unmatched"
 * filter. These cases lock the pairing rules the UI depends on.
 */

import { describe, it, expect } from "vitest";
import {
  computePanePairing,
  type PairingStagedRow,
  type PairingBankRow,
} from "@/lib/reconcile/pane-pairing";

const staged = (o: Partial<PairingStagedRow> & { id: string }): PairingStagedRow => ({
  amount: -10,
  date: "2026-06-15",
  reconcileState: "unmatched",
  linkedTransactionId: null,
  ...o,
});
const bank = (o: Partial<PairingBankRow> & { id: string }): PairingBankRow => ({
  amount: -10,
  date: "2026-06-15",
  linkedTransactionId: null,
  ...o,
});

describe("computePanePairing", () => {
  it("pairs an explicit link (shared tx id) as matched on both sides", () => {
    const { stagedStatus, bankStatus } = computePanePairing(
      [staged({ id: "s1", reconcileState: "linked", linkedTransactionId: 42 })],
      [bank({ id: "b1", linkedTransactionId: 42 })],
    );
    expect(stagedStatus.get("s1")).toBe("matched");
    expect(bankStatus.get("b1")).toBe("matched");
  });

  it("fuzzy-pairs a skipped_duplicate to a same-amount bank row within the window", () => {
    const { stagedStatus, bankStatus } = computePanePairing(
      [staged({ id: "s1", reconcileState: "skipped_duplicate", amount: -14.34, date: "2026-06-13" })],
      // Different payee/date is irrelevant — amount + within ±3 days is enough.
      [bank({ id: "b1", amount: -14.34, date: "2026-06-15" })],
    );
    expect(stagedStatus.get("s1")).toBe("matched");
    expect(bankStatus.get("b1")).toBe("matched");
  });

  it("keeps a skipped_duplicate matched even with no visible bank counterpart", () => {
    const { stagedStatus, bankStatus } = computePanePairing(
      [staged({ id: "s1", reconcileState: "skipped_duplicate", amount: -14.34 })],
      [bank({ id: "b1", amount: -99.99 })], // wrong amount → no pair
    );
    expect(stagedStatus.get("s1")).toBe("matched"); // "we already have this"
    // The unrelated bank row is in-window with no file peer → only_ledger.
    expect(bankStatus.get("b1")).toBe("only_ledger");
  });

  it("marks a genuinely new staged row only_file", () => {
    const { stagedStatus } = computePanePairing(
      [staged({ id: "s1", reconcileState: "unmatched", amount: -20, date: "2026-06-20" })],
      [],
    );
    expect(stagedStatus.get("s1")).toBe("only_file");
  });

  it("marks an in-window bank row with no staged peer only_ledger", () => {
    const { bankStatus } = computePanePairing(
      [staged({ id: "s1", amount: -10, date: "2026-06-15" })],
      [bank({ id: "b1", amount: -77, date: "2026-06-16" })],
    );
    expect(bankStatus.get("b1")).toBe("only_ledger");
  });

  it("gives NO status to a bank row outside the staged date window", () => {
    const { bankStatus } = computePanePairing(
      [staged({ id: "s1", amount: -10, date: "2026-06-15" })],
      [bank({ id: "old", amount: -10, date: "2026-01-01" })], // months earlier
    );
    expect(bankStatus.has("old")).toBe(false); // neutral, not "only_ledger"
  });

  it("does not double-claim one bank row for two same-amount dupes (greedy 1:1)", () => {
    const { stagedStatus, bankStatus } = computePanePairing(
      [
        staged({ id: "s1", reconcileState: "skipped_duplicate", amount: -25, date: "2026-06-14" }),
        staged({ id: "s2", reconcileState: "skipped_duplicate", amount: -25, date: "2026-06-15" }),
      ],
      [
        bank({ id: "b1", amount: -25, date: "2026-06-14" }),
        bank({ id: "b2", amount: -25, date: "2026-06-15" }),
      ],
    );
    expect(stagedStatus.get("s1")).toBe("matched");
    expect(stagedStatus.get("s2")).toBe("matched");
    // Each dupe claimed a DISTINCT bank row — both matched, none left only_ledger.
    expect(bankStatus.get("b1")).toBe("matched");
    expect(bankStatus.get("b2")).toBe("matched");
  });
});
