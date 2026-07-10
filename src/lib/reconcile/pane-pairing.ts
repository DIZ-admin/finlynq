/**
 * Persistent cross-pane reconciliation pairing for the /import two-pane review.
 *
 * The FilePane (staged file rows) and BankPane (continuous bank ledger) sit
 * side by side. This pure helper derives, for EVERY visible row, whether it has
 * a counterpart on the other side — so both panes can be tinted persistently
 * (not just on click) and the user can scan for "what's on one side but not the
 * other". It also backs the "Show only unmatched" filter.
 *
 * Pairing rules (mirrors the dedup + click-highlight the surface already uses):
 *   1. Explicit link — a staged row's linkedTransactionId matches a bank row's
 *      linkedTransactionId ⇒ both `matched`.
 *   2. A staged row in reconcileState 'linked' is `matched` even when its bank
 *      counterpart isn't in view (it's linked to a system tx).
 *   3. Fuzzy — a 'skipped_duplicate' staged row (a charge we already have,
 *      possibly under a drifted payee) is paired to the nearest UNCLAIMED bank
 *      row of the same amount within ±windowDays. It stays `matched` even when
 *      no in-view bank row is found (it duplicates SOMETHING we hold).
 *
 * Bank rows are only classified WITHIN the staged date window (± window): older
 * / newer ledger history isn't expected to appear in this statement, so it gets
 * NO status (neutral) rather than a misleading "only in ledger".
 *
 * Pure + dependency-free so the client surface can call it in a memo and a unit
 * test can exercise it without a DB or DEK.
 */

export interface PairingStagedRow {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  reconcileState?: "unmatched" | "auto_suggested" | "linked" | "skipped_duplicate";
  linkedTransactionId?: number | null;
}

export interface PairingBankRow {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  linkedTransactionId: number | null;
}

export type StagedMatchStatus = "matched" | "only_file";
export type BankMatchStatus = "matched" | "only_ledger";

export interface PanePairing {
  /** id → status for staged (file) rows. Every input staged row is present. */
  stagedStatus: Map<string, StagedMatchStatus>;
  /** id → status for bank rows. Out-of-window bank rows are ABSENT (neutral). */
  bankStatus: Map<string, BankMatchStatus>;
}

/** Matches the DEFAULT_FUZZY_DEDUP_WINDOW_DAYS the staging dedup uses. */
export const PANE_PAIRING_WINDOW_DAYS = 3;

function toEpochDay(iso: string): number | null {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 86_400_000);
}

export function computePanePairing(
  stagedRows: PairingStagedRow[],
  bankRows: PairingBankRow[],
  windowDays: number = PANE_PAIRING_WINDOW_DAYS,
): PanePairing {
  const stagedStatus = new Map<string, StagedMatchStatus>();
  const bankStatus = new Map<string, BankMatchStatus>();
  const claimedBank = new Set<string>();

  // Staged date window — bank rows outside [min-window, max+window] are ledger
  // history not expected in this statement, so they stay neutral (no status).
  const stagedDays = stagedRows
    .map((s) => toEpochDay(s.date))
    .filter((d): d is number => d != null);
  const hasWindow = stagedDays.length > 0;
  const lo = hasWindow ? Math.min(...stagedDays) - windowDays : 0;
  const hi = hasWindow ? Math.max(...stagedDays) + windowDays : 0;

  // Index bank rows by linked tx id (explicit pairing) + by amount (fuzzy).
  const bankByTxId = new Map<number, PairingBankRow[]>();
  const bankByAmount = new Map<string, PairingBankRow[]>();
  for (const b of bankRows) {
    if (b.linkedTransactionId != null) {
      const arr = bankByTxId.get(b.linkedTransactionId) ?? [];
      arr.push(b);
      bankByTxId.set(b.linkedTransactionId, arr);
    }
    const key = b.amount.toFixed(2);
    const arr = bankByAmount.get(key) ?? [];
    arr.push(b);
    bankByAmount.set(key, arr);
  }

  for (const s of stagedRows) {
    let matched = false;

    // (1) explicit link by tx id.
    if (s.linkedTransactionId != null) {
      const peers = bankByTxId.get(s.linkedTransactionId);
      if (peers && peers.length > 0) {
        for (const b of peers) {
          bankStatus.set(b.id, "matched");
          claimedBank.add(b.id);
        }
        matched = true;
      }
    }

    // (2) a 'linked' staged row is matched even without an in-view bank peer.
    if (!matched && s.reconcileState === "linked") matched = true;

    // (3) fuzzy pairing for a duplicate we already hold.
    if (!matched && s.reconcileState === "skipped_duplicate") {
      const sd = toEpochDay(s.date);
      const candidates = bankByAmount.get(s.amount.toFixed(2)) ?? [];
      let best: PairingBankRow | null = null;
      let bestDelta = Infinity;
      for (const b of candidates) {
        if (claimedBank.has(b.id)) continue;
        const bd = toEpochDay(b.date);
        if (sd == null || bd == null) continue;
        const delta = Math.abs(bd - sd);
        if (delta <= windowDays && delta < bestDelta) {
          best = b;
          bestDelta = delta;
        }
      }
      if (best) {
        bankStatus.set(best.id, "matched");
        claimedBank.add(best.id);
      }
      matched = true; // skipped_duplicate ⇒ "we already have this".
    }

    stagedStatus.set(s.id, matched ? "matched" : "only_file");
  }

  // Remaining in-window bank rows with no staged counterpart → only_ledger.
  for (const b of bankRows) {
    if (bankStatus.has(b.id)) continue;
    if (!hasWindow) continue;
    const bd = toEpochDay(b.date);
    if (bd == null || bd < lo || bd > hi) continue;
    bankStatus.set(b.id, "only_ledger");
  }

  return { stagedStatus, bankStatus };
}
