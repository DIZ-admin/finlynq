import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { recordInKindTransfer } from "@/lib/portfolio/operations";
import { invalidateUser as invalidateUserTxCache } from "@/lib/mcp/user-tx-cache";
import { markSnapshotsDirty } from "@/lib/portfolio/snapshots/dirty";
import { mapOperationError, cascadeDeleteForReplace } from "../_helpers";

const schema = z.object({
  sourceAccountId: z.number().int().positive(),
  destAccountId: z.number().int().positive(),
  holdingId: z.number().int().positive(),
  qty: z.number().positive(),
  date: z.string(),
  payee: z.string().optional(),
  note: z.string().optional(),
  editId: z.number().int().positive().optional(),
});

// raw/compat mode — bare-shape consumers (web forms + mobile). See buy/route.ts.
export const POST = apiHandler(
  {
    auth: "encryption",
    body: schema,
    raw: true,
    mapError: mapOperationError,
    fallbackMessage: "Failed to record in-kind transfer",
  },
  async ({ userId, dek, body }) => {
    const { editId, ...input } = body;
    if (editId != null) {
      const refusal = await cascadeDeleteForReplace(userId, editId);
      if (refusal) return refusal;
    }
    const result = await recordInKindTransfer({
      ...input,
      userId,
      dek,
      source: "manual",
    });
    invalidateUserTxCache(userId);
    // Snapshot history is stale from this trade date forward — auto-rebuild.
    await markSnapshotsDirty(userId, input.date);
    return NextResponse.json(
      editId != null ? { ...result, replaced: editId } : result,
      { status: 201 },
    );
  },
);
