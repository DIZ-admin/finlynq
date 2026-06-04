/**
 * materializeBankRowAsTransfer — shared bank-row → transfer-pair writer
 * (2026-06-04).
 *
 * Transfer rules (`create_transfer` action, no `set_category`) only fired in
 * Manual mode before this. The Manual materialize dialog wrote the pair via
 * `createTransferPair` and then primary-linked the bank row. Approve-each and
 * Auto-pilot had no equivalent path. This helper extracts that two-step write
 * (create pair + link source leg) so BOTH the Approve-each endpoint and the
 * Auto-pilot `applyRulesToBankRows` materializer reuse one chokepoint — no new
 * transfer write-site, so the `link_id` four-check invariant (audit invariant
 * #8) keeps holding through `createTransferPair`.
 *
 * Scope decision (mirrors the Manual fix): we route the SOURCE (debit) leg of
 * the transfer onto the bank row, so we only handle OUTFLOW bank rows
 * (`amount < 0`). The bank row's account is the transfer's `fromAccount`; the
 * rule's destination is the `toAccount`. Inflow rows, self-transfers, and
 * transfers into an investment destination are refused with a typed code so
 * each caller can surface the right skip/error.
 *
 * Guards (all return a typed `{ ok:false, code }` — never throw for these):
 *   - `transfer_self`           — destAccountId === bank.accountId (no-op pair)
 *   - `transfer_inflow`         — bank.amount >= 0 (we link the source leg, so
 *                                 the bank row must be the outflow side)
 *   - `transfer_investment_dest`— the destination account is_investment=true
 *                                 (a rule can't supply the holding/qty an
 *                                 investment leg requires)
 *
 * On pass, delegates to `createTransferPair` (which resolves the Transfer
 * category, runs cross-currency FX, mints the `link_id`, and invalidates the
 * MCP tx cache) then `linkTransactionToBank` (which primary-links the source
 * leg to the bank row and again invalidates the cache). Neither caller needs a
 * separate `invalidateUser` call — both helpers already invalidate post-commit.
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createTransferPair } from "@/lib/transfer";
import { linkTransactionToBank } from "@/lib/reconcile/links";
import type { TransactionSource } from "@/lib/tx-source";

/** Stable machine codes shared by both caller surfaces. */
export type MaterializeTransferFailCode =
  | "transfer_self"
  | "transfer_inflow"
  | "transfer_investment_dest"
  | "transfer_dest_not_found"
  | "transfer_write_failed";

export type MaterializeTransferResult =
  | {
      ok: true;
      fromTransactionId: number;
      toTransactionId: number;
      linkId: string;
    }
  | {
      ok: false;
      code: MaterializeTransferFailCode;
      /** Human-readable, safe to surface to end users. */
      message: string;
    };

/** Minimal bank-row shape the helper needs. Both callers already SELECT
 *  these columns; passing the subset keeps the helper transport-agnostic. */
export interface MaterializeTransferBank {
  id: string;
  accountId: number;
  date: string;
  amount: number;
  currency: string;
}

export interface MaterializeBankRowAsTransferInput {
  userId: string;
  dek: Buffer;
  bank: MaterializeTransferBank;
  /** Already-decrypted bank-row payee (or null). Used as the pair's note so
   *  the original statement description survives onto the ledger rows. */
  payeePlain: string | null;
  /** Destination account id from the matched rule's `create_transfer` action. */
  destAccountId: number;
  /** Writer-surface attribution — `'auto_rule'` from Auto-pilot,
   *  `'manual'` from a user-clicked Approve. Both legs + the link inherit it. */
  txSource: TransactionSource;
}

export async function materializeBankRowAsTransfer(
  input: MaterializeBankRowAsTransferInput,
): Promise<MaterializeTransferResult> {
  const { userId, dek, bank, payeePlain, destAccountId, txSource } = input;

  // ─── Guards ────────────────────────────────────────────────────────────
  // Self-transfer: a rule pointing back at the bank row's own account would
  // write a degenerate pair.
  if (destAccountId === bank.accountId) {
    return {
      ok: false,
      code: "transfer_self",
      message: "Transfer destination is the same as the source account.",
    };
  }
  // We link the SOURCE (debit) leg onto the bank row, so the bank row must be
  // the outflow side. Inflow transfer-rule rows are left for manual handling.
  if (bank.amount >= 0) {
    return {
      ok: false,
      code: "transfer_inflow",
      message:
        "Transfer rules auto-apply only to outflow rows (the source leg). Handle this inflow row manually.",
    };
  }

  // Destination investment guard. Cross-tenant attacks resolve to "not found"
  // here (the WHERE clause scopes by userId) — never a 403 existence leak.
  const dest = await db
    .select({
      id: schema.accounts.id,
      isInvestment: schema.accounts.isInvestment,
    })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.id, destAccountId),
        eq(schema.accounts.userId, userId),
      ),
    )
    .limit(1);
  if (!dest[0]) {
    return {
      ok: false,
      code: "transfer_dest_not_found",
      message: "Transfer destination account not found.",
    };
  }
  if (dest[0].isInvestment) {
    return {
      ok: false,
      code: "transfer_investment_dest",
      message:
        "Can't auto-create a transfer into an investment account (a rule can't supply the holding/quantity).",
    };
  }

  // ─── Write the pair via the canonical writer ─────────────────────────────
  // createTransferPair mints the link_id (four-check), resolves the Transfer
  // category, runs cross-currency FX, and invalidates the MCP tx cache.
  const pair = await createTransferPair({
    userId,
    dek,
    fromAccountId: bank.accountId,
    toAccountId: destAccountId,
    enteredAmount: Math.abs(bank.amount),
    date: bank.date,
    note: payeePlain ?? undefined,
    txSource,
  });
  if (!pair.ok) {
    return {
      ok: false,
      code: "transfer_write_failed",
      message: pair.message,
    };
  }

  // Primary-link the SOURCE leg (the outflow) to the bank row. Idempotent via
  // the (transaction_id, bank_transaction_id) unique constraint, and again
  // invalidates the MCP tx cache post-commit.
  await linkTransactionToBank({
    userId,
    transactionId: pair.fromTransactionId,
    bankTransactionId: bank.id,
    linkType: "primary",
    source: txSource,
  });

  return {
    ok: true,
    fromTransactionId: pair.fromTransactionId,
    toTransactionId: pair.toTransactionId,
    linkId: pair.linkId,
  };
}
