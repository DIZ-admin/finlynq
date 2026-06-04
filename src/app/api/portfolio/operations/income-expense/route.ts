import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { recordPortfolioIncomeOrExpense } from "@/lib/portfolio/operations";
import { invalidateUser as invalidateUserTxCache } from "@/lib/mcp/user-tx-cache";
import { markSnapshotsDirty } from "@/lib/portfolio/snapshots/dirty";
import { mapOperationError, cascadeDeleteForReplace } from "../_helpers";

const schema = z.object({
  accountId: z.number().int().positive(),
  currency: z.string().min(2).max(8),
  amount: z.number().refine((v) => v !== 0, { message: "amount cannot be 0" }),
  relatedHoldingId: z.number().int().positive().nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  date: z.string(),
  payee: z.string().optional(),
  note: z.string().optional(),
  tags: z.string().optional(),
  editId: z.number().int().positive().optional(),
});

// raw/compat mode — bare-shape consumers (web forms + mobile). See buy/route.ts.
export const POST = apiHandler(
  {
    auth: "encryption",
    body: schema,
    raw: true,
    mapError: mapOperationError,
    fallbackMessage: "Failed to record portfolio income/expense",
  },
  async ({ userId, dek, body }) => {
    const { editId, ...input } = body;
    if (editId != null) {
      const refusal = await cascadeDeleteForReplace(userId, editId);
      if (refusal) return refusal;
    }
    const result = await recordPortfolioIncomeOrExpense({
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
