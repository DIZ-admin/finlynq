/**
 * SimpleFIN bank-feed orchestrator.
 *
 * Unlike the file-based connectors (Money Pro / Generic CSV) which run through
 * `executeImport` and write BOTH `transactions` + `bank_transactions`, SimpleFIN
 * is a live BANK FEED: a sync writes ONLY into `bank_transactions` with
 * `source='connector'` (never `transactions`). Those rows are the bank-candidate
 * pool the /import reconciliation page reads — the user reconciles them against
 * their own manually-entered ledger transactions there. Writing ledger rows
 * directly would double-count. This mirrors the "Send to bank ledger" /
 * `send_to_bank_ledger` bank-only-promote semantics.
 *
 * The access URL is a long-lived secret stored encrypted under the user's DEK
 * (src/lib/external-import/credentials.ts). Because the DEK lives only in the
 * in-memory session cache, sync is ON DEMAND (user click while logged in) — no
 * background cron. See finlynq-cloud/plan/simplefin-bank-feed.md.
 *
 * Account resolution: SimpleFIN account ids are mapped to Finlynq account ids
 * and the mapping is persisted (encrypted, alongside the access URL) so a
 * re-sync reuses the same accounts even after the user renames them. A
 * SimpleFIN account with no mapping (first sync, or a newly-linked bank) is
 * resolve-or-created via buildNameFields/createAccount, exactly like the other
 * connector orchestrators.
 *
 * Dedup: fitId (the SimpleFIN transaction id) is the primary key — a row whose
 * fitId already exists in the bank ledger is skipped up front (mirrors
 * executeImport's "fitId takes priority"). Rows without a fitId, and re-pulls of
 * the same content, still dedup via upsertBankTransaction's
 * (user, account, import_hash, occurrence_index) ON CONFLICT.
 */

import { db, schema } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { buildNameFields } from "@/lib/crypto/encrypted-columns";
import { createAccount } from "@/lib/queries";
import { upsertBankTransaction } from "@/lib/bank-ledger";
import { encryptStagingMeta } from "@/lib/crypto/staging-metadata";
import { generateImportHash, checkFitIdDuplicates } from "@/lib/import-hash";
import {
  saveConnectorCredentials,
  loadConnectorCredentials,
  hasConnectorCredentials,
  deleteConnectorCredentials,
} from "./credentials";
import { simplefin } from "@finlynq/import-connectors";

const CONNECTOR_ID = "simplefin";
/** Second credential slot: SimpleFIN account id → Finlynq account id (as string). */
const ACCOUNT_MAP_ID = "simplefin:accounts";
/** How far back to pull on each sync. SimpleFIN keeps ~90 days. */
const SYNC_LOOKBACK_DAYS = 90;

export class SimplefinNotConnectedError extends Error {
  constructor() {
    super("SimpleFIN is not connected");
    this.name = "SimplefinNotConnectedError";
  }
}

export interface SimplefinConnectResult {
  connected: true;
}

export interface SimplefinSyncResult {
  /** Number of SimpleFIN accounts seen this sync. */
  accountsSynced: number;
  /** Finlynq accounts freshly created this sync. */
  accountsCreated: number;
  /** Bank-ledger rows freshly inserted. */
  imported: number;
  /** Rows skipped as already known (fitId or import_hash match). */
  duplicates: number;
  /** Pending rows skipped by the transform. */
  skippedPending: number;
  /** Provider + per-row errors (non-fatal). */
  errors: string[];
}

export interface SimplefinStatus {
  connected: boolean;
  /** ISO timestamp of the most recent connector batch, or null. */
  lastSyncAt: string | null;
}

/**
 * Exchange a one-time setup token for an access URL and persist it (encrypted
 * under the DEK). Throws SimpleFinSetupTokenError on a bad/expired token.
 */
export async function connectSimpleFin(
  userId: string,
  dek: Buffer,
  setupToken: string,
): Promise<SimplefinConnectResult> {
  const accessUrl = await simplefin.exchangeSetupToken(setupToken);
  await saveConnectorCredentials(userId, CONNECTOR_ID, dek, { accessUrl });
  return { connected: true };
}

/**
 * Pull the last ~90 days of accounts + transactions and land them in
 * `bank_transactions` (source='connector'). Resolve-or-creates Finlynq accounts
 * for each SimpleFIN account and persists the id mapping.
 */
export async function syncSimpleFin(
  userId: string,
  dek: Buffer,
): Promise<SimplefinSyncResult> {
  const creds = await loadConnectorCredentials<{ accessUrl: string }>(
    userId,
    CONNECTOR_ID,
    dek,
  );
  if (!creds?.accessUrl) throw new SimplefinNotConnectedError();

  const client = new simplefin.SimpleFINClient(creds.accessUrl);
  const startDate = Math.floor(Date.now() / 1000) - SYNC_LOOKBACK_DAYS * 24 * 60 * 60;
  const resp = await client.fetchAccounts({ startDate });
  const { accounts, skippedPending, errors } = simplefin.simplefinToRawTransactions(resp);

  // Load the persisted SimpleFIN-account-id → Finlynq-account-id map.
  const accountMap =
    (await loadConnectorCredentials<Record<string, string>>(userId, ACCOUNT_MAP_ID, dek)) ?? {};
  let mapDirty = false;

  let imported = 0;
  let duplicates = 0;
  let accountsCreated = 0;

  for (const acct of accounts) {
    // ── Resolve or create the Finlynq account for this SimpleFIN account ──
    let finAccountId: number | undefined;
    const mapped = accountMap[acct.externalId];
    if (mapped) {
      const id = Number(mapped);
      const exists = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, userId)))
        .get();
      if (exists) finAccountId = id;
    }
    if (finAccountId === undefined) {
      const enc = buildNameFields(dek, { name: acct.name });
      const created = await createAccount(userId, {
        type: "A",
        group: "",
        currency: acct.currency,
        isInvestment: false,
        ...enc,
      } as Parameters<typeof createAccount>[1]);
      finAccountId = created.id;
      accountsCreated += 1;
      accountMap[acct.externalId] = String(finAccountId);
      mapDirty = true;
    }

    if (acct.rows.length === 0) continue;

    // ── fitId-first dedup: drop rows already in the bank ledger ──
    const fitIds = acct.rows
      .map((r) => r.fitId)
      .filter((f): f is string => !!f);
    const existingFitIds = await checkFitIdDuplicates(fitIds, userId);
    const toWrite = acct.rows.filter((r) => !(r.fitId && existingFitIds.has(r.fitId)));
    duplicates += acct.rows.length - toWrite.length;
    if (toWrite.length === 0) continue;

    // ── One connector batch row for lineage (feeds the reconcile summary) ──
    const [batch] = await db
      .insert(schema.bankUploadBatches)
      .values({
        userId,
        accountId: finAccountId,
        source: "connector",
        mode: "simplified",
        // Encrypted at the user tier (FINLYNQ-120) — a batch label, not a real
        // filename (SimpleFIN is a live feed). Satisfies the audit invariant
        // `staging-metadata-encrypted` which guards every bank_upload_batches
        // insert against plaintext metadata.
        filename: encryptStagingMeta("SimpleFIN sync", "user", dek),
        encryptionTier: "user",
        rowCount: toWrite.length,
      })
      .returning({ id: schema.bankUploadBatches.id });

    // ── Upsert each row into bank_transactions ──
    const occ = new Map<string, number>();
    for (const r of toWrite) {
      const payee = (r.payee ?? "").trim();
      const importHash = generateImportHash(r.date, finAccountId, r.amount, payee);
      const occKey = `${finAccountId}:${importHash}`;
      const occurrenceIndex = occ.get(occKey) ?? 0;
      occ.set(occKey, occurrenceIndex + 1);

      try {
        const { wasInserted } = await upsertBankTransaction(dek, {
          userId,
          accountId: finAccountId,
          importHash,
          occurrenceIndex,
          fitId: r.fitId ?? null,
          date: r.date,
          amount: r.amount,
          currency: (r.currency ?? acct.currency).toUpperCase(),
          payee,
          note: r.note ?? null,
          tags: null,
          accountName: acct.name,
          source: "connector",
          filename: null,
          uploadBatchId: batch.id,
        });
        if (wasInserted) imported += 1;
        else duplicates += 1;
      } catch (err) {
        errors.push(
          `Account "${acct.name}" row ${r.fitId ?? r.date}: ${err instanceof Error ? err.message : "write failed"}`,
        );
      }
    }
  }

  if (mapDirty) {
    await saveConnectorCredentials(userId, ACCOUNT_MAP_ID, dek, accountMap);
  }

  return {
    accountsSynced: accounts.length,
    accountsCreated,
    imported,
    duplicates,
    skippedPending,
    errors,
  };
}

/** Connected? + when the last connector sync ran (from bank_upload_batches). */
export async function getSimpleFinStatus(userId: string): Promise<SimplefinStatus> {
  const connected = await hasConnectorCredentials(userId, CONNECTOR_ID);
  let lastSyncAt: string | null = null;
  if (connected) {
    const row = await db
      .select({ uploadedAt: schema.bankUploadBatches.uploadedAt })
      .from(schema.bankUploadBatches)
      .where(
        and(
          eq(schema.bankUploadBatches.userId, userId),
          eq(schema.bankUploadBatches.source, "connector"),
        ),
      )
      .orderBy(desc(schema.bankUploadBatches.uploadedAt))
      .limit(1)
      .get();
    if (row?.uploadedAt) {
      lastSyncAt = row.uploadedAt instanceof Date ? row.uploadedAt.toISOString() : String(row.uploadedAt);
    }
  }
  return { connected, lastSyncAt };
}

/** Remove the stored access URL + account map. Does not need the DEK. */
export async function disconnectSimpleFin(userId: string): Promise<void> {
  await deleteConnectorCredentials(userId, CONNECTOR_ID);
  await deleteConnectorCredentials(userId, ACCOUNT_MAP_ID);
}
