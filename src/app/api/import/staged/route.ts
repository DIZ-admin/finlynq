/**
 * GET /api/import/staged
 *
 * List the current user's pending staged imports — both email-delivered
 * rows and upload-staged rows — awaiting review at /import/pending.
 *
 * Query params:
 *   ?count=1  → return only `{ pending: number }` for lightweight nav badge polling
 *
 * Otherwise returns an array of:
 *   { id, source, fromAddress, subject, receivedAt, totalRowCount,
 *     duplicateCount, expiresAt, originalFilename, fileFormat }
 *
 * `source` is 'email' or 'upload'. Email rows populate fromAddress + subject;
 * upload rows populate originalFilename + fileFormat (issue #153).
 *
 * Rows are user-scoped via userId filter. Expired rows (expires_at < now)
 * are filtered out in case the cleanup cron hasn't run yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/require-auth";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { decryptStagingMeta } from "@/lib/crypto/staging-metadata";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // FINLYNQ-120 — fromAddress / subject / originalFilename are now encrypted
  // in-place (sv1: service-tier or v1: user-tier). The count-only branch needs
  // no DEK; the full-list branch decrypts tier-aware, so it requires one.
  const countOnly = request.nextUrl.searchParams.get("count") === "1";
  if (countOnly) {
    const authC = await requireAuth(request);
    if (!authC.authenticated) return authC.response;
    const row = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.stagedImports)
      .where(and(
        eq(schema.stagedImports.userId, authC.context.userId),
        eq(schema.stagedImports.status, "pending"),
        gt(schema.stagedImports.expiresAt, new Date()),
      ))
      .get();
    return NextResponse.json({ pending: row?.c ?? 0 });
  }

  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  const { userId, dek } = auth;

  const now = new Date();

  const rows = await db
    .select({
      id: schema.stagedImports.id,
      source: schema.stagedImports.source,
      fromAddress: schema.stagedImports.fromAddress,
      subject: schema.stagedImports.subject,
      receivedAt: schema.stagedImports.receivedAt,
      totalRowCount: schema.stagedImports.totalRowCount,
      duplicateCount: schema.stagedImports.duplicateCount,
      expiresAt: schema.stagedImports.expiresAt,
      // Issue #153: upload-source rows surface filename + format on the list
      // so the review UI can show "{filename} · CSV" instead of an empty
      // "(no subject)" + "from (unknown)".
      originalFilename: schema.stagedImports.originalFilename,
      fileFormat: schema.stagedImports.fileFormat,
      // 2026-06-04 — surfaced so the account-anchored /import Staging tab can
      // filter the list to the selected account without an N+1 detail fetch
      // per batch (the old inbox-staging-tab binding-resolution hack).
      boundAccountId: schema.stagedImports.boundAccountId,
      // FINLYNQ-120 — drives the per-row tier branch for the metadata decrypt.
      encryptionTier: schema.stagedImports.encryptionTier,
    })
    .from(schema.stagedImports)
    .where(and(
      eq(schema.stagedImports.userId, userId),
      eq(schema.stagedImports.status, "pending"),
      gt(schema.stagedImports.expiresAt, now),
    ))
    .orderBy(desc(schema.stagedImports.receivedAt))
    .all();

  // FINLYNQ-120 — decrypt the metadata fields per-row (mixed tiers expected
  // mid-upgrade). encryptionTier is internal; strip it from the payload.
  const decrypted = rows.map(({ encryptionTier, ...r }) => ({
    ...r,
    fromAddress: decryptStagingMeta(r.fromAddress, encryptionTier, dek),
    subject: decryptStagingMeta(r.subject, encryptionTier, dek),
    originalFilename: decryptStagingMeta(r.originalFilename, encryptionTier, dek),
  }));

  return NextResponse.json(decrypted);
}
