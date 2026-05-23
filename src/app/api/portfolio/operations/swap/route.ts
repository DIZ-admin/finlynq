import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { validateBody, safeErrorMessage, logApiError } from "@/lib/validate";
import { recordSwap } from "@/lib/portfolio/operations";
import { invalidateUser as invalidateUserTxCache } from "@/lib/mcp/user-tx-cache";
import { mapOperationError } from "../_helpers";

const schema = z.object({
  accountId: z.number().int().positive(),
  sourceHoldingId: z.number().int().positive(),
  sourceQty: z.number().positive(),
  sourceProceeds: z.number().positive(),
  destHoldingId: z.number().int().positive(),
  destQty: z.number().positive(),
  destCost: z.number().positive(),
  date: z.string(),
  payee: z.string().optional(),
  note: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const parsed = validateBody(body, schema);
    if (parsed.error) return parsed.error;
    const result = await recordSwap({
      ...parsed.data,
      userId: auth.userId,
      dek: auth.dek,
      source: "manual",
    });
    invalidateUserTxCache(auth.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const mapped = mapOperationError(err);
    if (mapped) return mapped;
    await logApiError("POST", "/api/portfolio/operations/swap", err, auth.userId);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to record swap") },
      { status: 500 },
    );
  }
}
