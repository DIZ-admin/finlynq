import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { recordBuy } from "@/lib/portfolio/operations";
import { invalidateUser as invalidateUserTxCache } from "@/lib/mcp/user-tx-cache";
import { markSnapshotsDirty } from "@/lib/portfolio/snapshots/dirty";
import { mapOperationError, cascadeDeleteForReplace } from "../_helpers";

const schema = z.object({
  accountId: z.number().int().positive(),
  holdingId: z.number().int().positive(),
  qty: z.number().positive(),
  totalCost: z.number().positive(),
  date: z.string(),
  payee: z.string().optional(),
  note: z.string().optional(),
  tags: z.string().optional(),
  cashSleeveHoldingId: z.number().int().positive().optional(),
  // Phase 2 edit-as-replace (2026-05-25 follow-up). When set, cascade-deletes
  // the existing pair (via trade_link_id) before creating the new one.
  // Refused with 409 if the edit guard fires (lot has downstream closures).
  editId: z.number().int().positive().optional(),
});

// raw/compat mode: this route is consumed BARE by the web portfolio forms +
// mobile `postPortfolioOperation` (bare `{ id, ... }` on 2xx, bare structured
// error on 4xx). apiHandler centralizes auth + body validation + error mapping
// here WITHOUT changing the wire shape. → FINLYNQ-107 / CLAUDE.md.
export const POST = apiHandler(
  {
    auth: "encryption",
    body: schema,
    raw: true,
    mapError: mapOperationError,
    fallbackMessage: "Failed to record buy",
  },
  async ({ userId, dek, body }) => {
    const { editId, ...input } = body;
    if (editId != null) {
      const refusal = await cascadeDeleteForReplace(userId, editId);
      if (refusal) return refusal;
    }
    const result = await recordBuy({
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
