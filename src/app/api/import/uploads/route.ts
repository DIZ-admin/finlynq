/**
 * GET /api/import/uploads (Phase 4 of import-modes refactor, 2026-05-25)
 *
 * Lists the most recent upload batches for the user, optionally scoped to
 * an account. Backs the Recent Uploads panel on /reconcile so the user
 * can see + undo recent ingests.
 *
 * Query params:
 *   accountId   — optional. When set, returns only batches for that account.
 *   limit       — optional. Default 20, capped at 100.
 *
 * Returns:
 *   [{ id, accountId, source, mode, filename, uploadedAt, rowCount,
 *      anchorCount, currentRowCount, hasLinkedTransactions }, ...]
 *
 *   - rowCount: count snapshot at batch write time.
 *   - currentRowCount: live count of bank_transactions still linked to the
 *     batch (drops as users delete individual rows or run batch undo).
 *   - hasLinkedTransactions: whether ANY bank_transaction in this batch
 *     has a primary join row in transaction_bank_links — drives the
 *     confirmation prompt on Delete batch.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, desc, eq, inArray, count } from "drizzle-orm";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { decryptStagingMeta } from "@/lib/crypto/staging-metadata";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  // FINLYNQ-120 — bank_upload_batches.filename is now encrypted in-place;
  // decrypting it needs the session DEK, so this read upgrades to
  // requireEncryption (was requireAuth). The panel is a web-only login surface.
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  const { userId, dek } = auth;

  const url = new URL(request.url);
  const accountIdRaw = url.searchParams.get("accountId");
  const limitRaw = url.searchParams.get("limit");

  const accountId =
    accountIdRaw && /^\d+$/.test(accountIdRaw) ? Number(accountIdRaw) : null;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : DEFAULT_LIMIT),
  );

  const whereClauses = [eq(schema.bankUploadBatches.userId, userId)];
  if (accountId != null) {
    whereClauses.push(eq(schema.bankUploadBatches.accountId, accountId));
  }

  const batches = await db
    .select({
      id: schema.bankUploadBatches.id,
      accountId: schema.bankUploadBatches.accountId,
      source: schema.bankUploadBatches.source,
      mode: schema.bankUploadBatches.mode,
      filename: schema.bankUploadBatches.filename,
      // FINLYNQ-120 — drives the per-row tier branch for the filename decrypt.
      encryptionTier: schema.bankUploadBatches.encryptionTier,
      uploadedAt: schema.bankUploadBatches.uploadedAt,
      rowCount: schema.bankUploadBatches.rowCount,
      anchorCount: schema.bankUploadBatches.anchorCount,
      // 2026-06-05 — surfaced so clicking a loaded batch can re-open the
      // staging two-pane review for its source import (the imported rows now
      // persist there, highlighted). NULL for simplified/auto batches (no
      // staged import).
      stagedImportId: schema.bankUploadBatches.stagedImportId,
    })
    .from(schema.bankUploadBatches)
    .where(and(...whereClauses))
    .orderBy(desc(schema.bankUploadBatches.uploadedAt))
    .limit(limit)
    .all();

  if (batches.length === 0) return NextResponse.json([]);

  const ids = batches.map((b) => b.id);

  // currentRowCount per batch: live count of bank_transactions still linked.
  const currentCounts = await db
    .select({
      batchId: schema.bankTransactions.uploadBatchId,
      n: count(),
    })
    .from(schema.bankTransactions)
    .where(and(
      eq(schema.bankTransactions.userId, userId),
      inArray(schema.bankTransactions.uploadBatchId, ids),
    ))
    .groupBy(schema.bankTransactions.uploadBatchId)
    .all();
  const currentByBatch = new Map<string, number>();
  for (const row of currentCounts) {
    if (row.batchId) currentByBatch.set(row.batchId, Number(row.n ?? 0));
  }

  // hasLinkedTransactions per batch: any primary join row pointing at a
  // bank_transaction whose upload_batch_id is in our set.
  const linkedIds = await db
    .select({ batchId: schema.bankTransactions.uploadBatchId })
    .from(schema.transactionBankLinks)
    .innerJoin(
      schema.bankTransactions,
      eq(schema.bankTransactions.id, schema.transactionBankLinks.bankTransactionId),
    )
    .where(and(
      eq(schema.transactionBankLinks.userId, userId),
      eq(schema.transactionBankLinks.linkType, "primary"),
      inArray(schema.bankTransactions.uploadBatchId, ids),
    ))
    .all();
  const linkedSet = new Set<string>();
  for (const row of linkedIds) {
    if (row.batchId) linkedSet.add(row.batchId);
  }

  return NextResponse.json(
    batches.map((b) => ({
      id: b.id,
      accountId: b.accountId,
      source: b.source,
      mode: b.mode,
      // FINLYNQ-120 — decrypt tier-aware (mixed tiers expected mid-upgrade).
      filename: decryptStagingMeta(b.filename, b.encryptionTier, dek),
      uploadedAt: b.uploadedAt,
      rowCount: b.rowCount,
      anchorCount: b.anchorCount,
      currentRowCount: currentByBatch.get(b.id) ?? 0,
      hasLinkedTransactions: linkedSet.has(b.id),
      stagedImportId: b.stagedImportId ?? null,
    })),
  );
}
