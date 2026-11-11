import { NextRequest, NextResponse } from "next/server";
import { getAccounts, createAccount, updateAccount, deleteAccount } from "@/lib/queries";
import { requireAuth } from "@/lib/auth/require-auth";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { z } from "zod";
import { validateBody, safeErrorMessage, logApiError } from "@/lib/validate";
import { buildNameFields, decryptNamedRows } from "@/lib/crypto/encrypted-columns";
import { backfillInvestmentAccount } from "@/lib/investment-account";
import { isPgErrorCode } from "@/lib/db-utils";
import { db, withDbTransaction } from "@/db";
import {
  getAccountDeleteBlockers,
  accountDeleteBlockedMessage,
} from "@/lib/accounts/delete-blockers";

const postSchema = z.object({
  name: z.string(),
  type: z.string(),
  group: z.string(),
  currency: z.string(),
  note: z.string().optional(),
  alias: z.string().max(64).trim().optional(),
  isInvestment: z.boolean().optional(),
});

const putSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  type: z.string().optional(),
  group: z.string().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
  archived: z.boolean().optional(),
  alias: z.string().max(64).trim().nullable().optional(),
  isInvestment: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request); if (!auth.authenticated) return auth.response;
  try {
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
    const rows = await getAccounts(auth.context.userId, { includeArchived });
    // Stream D: decrypt name + alias from *_ct columns when a DEK is in cache,
    // else fall back to plaintext columns (pre-backfill or degraded session).
    const data = decryptNamedRows(rows, auth.context.dek, {
      nameCt: "name",
      aliasCt: "alias",
    });
    return NextResponse.json(data);
  } catch (error: unknown) {
    await logApiError("GET", "/api/accounts", error, auth.context.userId);
    return NextResponse.json({ error: safeErrorMessage(error, "Failed to load accounts") }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // requireEncryption, not requireAuth: this handler calls buildNameFields,
  // which returns {} for a null DEK — the row would persist with NULL
  // name_ct/name_lookup and be permanently nameless (review 2026-07-30 #7).
  const auth = await requireEncryption(request); if (!auth.ok) return auth.response;
  const { userId, dek } = auth;
  try {
    const body = await request.json();
    const parsed = validateBody(body, postSchema);
    if (parsed.error) return parsed.error;
    const { alias, name, ...rest } = parsed.data;
    const normalizedAlias = alias ? alias : null;
    const enc = buildNameFields(dek, { name, alias: normalizedAlias });
    // Stream D Phase 4 — plaintext `name`/`alias` columns dropped. Only the
    // `*_ct`/`*_lookup` siblings get persisted via `enc`.
    const account = await withDbTransaction(async () => {
      const created = await createAccount(userId, { ...rest, ...enc });
      if (rest.isInvestment === true && created?.id != null) {
        await backfillInvestmentAccount(userId, created.id, dek);
      }
      return created;
    });
    return NextResponse.json(account, { status: 201 });
  } catch (error: unknown) {
    await logApiError("POST", "/api/accounts", error, userId);
    return NextResponse.json({ error: safeErrorMessage(error, "Failed to create account") }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  // requireEncryption — buildNameFields(null) yields {}, so a rename would
  // silently no-op while the request reported success (review 2026-07-30 #7).
  const auth = await requireEncryption(request); if (!auth.ok) return auth.response;
  const { userId, dek } = auth;
  try {
    const body = await request.json();
    const parsed = validateBody(body, putSchema);
    if (parsed.error) return parsed.error;
    const { id, alias, name, ...data } = parsed.data;
    // Stream D Phase 4 — plaintext `name`/`alias` are NOT in the schema.
    // Strip them from the update set; only the encrypted siblings persist.
    const normalizedAlias = alias === undefined ? undefined : (alias ? alias : null);
    const toEncrypt: Record<string, string | null | undefined> = {};
    if (name !== undefined) toEncrypt.name = name;
    if (normalizedAlias !== undefined) toEncrypt.alias = normalizedAlias;
    const enc = buildNameFields(dek, toEncrypt);
    const account = await withDbTransaction(async () => {
      const updated = await updateAccount(id, userId, { ...data, ...enc });
      // An explicit opt-in also repairs accounts left incomplete by older builds.
      // Backfill only assigns transactions with no holding, so retries are safe.
      if (updated && data.isInvestment === true) {
        await backfillInvestmentAccount(userId, id, dek);
      }
      return updated;
    });
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json(account);
  } catch (error: unknown) {
    await logApiError("PUT", "/api/accounts", error, userId);
    return NextResponse.json({ error: safeErrorMessage(error, "Failed to update account") }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request); if (!auth.authenticated) return auth.response;
  try {
    const idParam = request.nextUrl.searchParams.get("id");
    const id = idParam ? Number(idParam) : NaN;
    if (!Number.isFinite(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
    // Pre-check the ten ON DELETE NO ACTION referents, so the caller is told
    // what is actually in the way and the doomed DELETE never reaches Postgres
    // (every attempt lands in `diagnostics_log` as a db_error).
    const blockers = await getAccountDeleteBlockers(db, auth.context.userId, id);
    if (blockers.length > 0) {
      return NextResponse.json({ error: accountDeleteBlockedMessage(blockers) }, { status: 409 });
    }
    await deleteAccount(id, auth.context.userId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    // Backstop for the race where a linked row appears between the pre-check
    // above and the DELETE.
    if (isPgErrorCode(error, "23503")) {
      return NextResponse.json(
        { error: "This account still has transactions or other records linked to it. Archive it instead, or remove the related records first." },
        { status: 409 },
      );
    }
    await logApiError("DELETE", "/api/accounts", error, auth.context.userId);
    return NextResponse.json({ error: safeErrorMessage(error, "Failed to delete account") }, { status: 500 });
  }
}
