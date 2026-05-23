/**
 * POST /api/portfolio/holdings/cash-sleeve — explicit per-currency cash sleeve.
 * DELETE /api/portfolio/holdings/cash-sleeve?id=N — only when zero transactions
 * reference the sleeve.
 *
 * Phase 1 of the portfolio-ops refactor made cash sleeves explicit
 * (`portfolio_holdings.is_cash`). This route lets the account-detail UI
 * provision a fresh sleeve in any currency (e.g. add a USD sleeve to a
 * CAD-default investment account before recording a US-equity buy). The
 * partial unique index `(user, account, currency) WHERE is_cash=TRUE` is the
 * DB backstop; we pre-check and surface 409 with a friendlier message.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireEncryption } from "@/lib/auth/require-encryption";
import { requireAuth } from "@/lib/auth/require-auth";
import { validateBody, safeErrorMessage, logApiError } from "@/lib/validate";
import { buildNameFields } from "@/lib/crypto/encrypted-columns";

const postSchema = z.object({
  accountId: z.number().int().positive(),
  currency: z.string().min(2).max(8),
  /** Optional display name; defaults to "Cash <CCY>". */
  name: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireEncryption(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const parsed = validateBody(body, postSchema);
    if (parsed.error) return parsed.error;
    const { accountId, currency } = parsed.data;
    const ccy = currency.toUpperCase();
    const name = parsed.data.name?.trim() || `Cash ${ccy}`;

    const acct = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, auth.userId)))
      .get();
    if (!acct) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const existing = await db
      .select({ id: schema.portfolioHoldings.id })
      .from(schema.portfolioHoldings)
      .where(
        and(
          eq(schema.portfolioHoldings.userId, auth.userId),
          eq(schema.portfolioHoldings.accountId, accountId),
          eq(schema.portfolioHoldings.currency, ccy),
          eq(schema.portfolioHoldings.isCash, true),
        ),
      )
      .get();
    if (existing?.id) {
      return NextResponse.json(
        {
          error: `Account already has a ${ccy} cash sleeve`,
          code: "duplicate_cash_sleeve",
          holdingId: existing.id,
        },
        { status: 409 },
      );
    }

    const enc = buildNameFields(auth.dek, { name });

    try {
      const inserted = await db
        .insert(schema.portfolioHoldings)
        .values({
          userId: auth.userId,
          accountId,
          currency: ccy,
          isCrypto: 0,
          isCash: true,
          note: "",
          ...enc,
        })
        .returning({
          id: schema.portfolioHoldings.id,
          accountId: schema.portfolioHoldings.accountId,
          currency: schema.portfolioHoldings.currency,
          isCash: schema.portfolioHoldings.isCash,
        });
      const row = inserted[0];
      if (!row) {
        return NextResponse.json({ error: "Failed to create cash sleeve" }, { status: 500 });
      }
      try {
        await db
          .insert(schema.holdingAccounts)
          .values({
            holdingId: row.id,
            accountId,
            userId: auth.userId,
            qty: 0,
            costBasis: 0,
            isPrimary: true,
          })
          .onConflictDoNothing();
      } catch (pairingErr) {
        await db
          .delete(schema.portfolioHoldings)
          .where(
            and(
              eq(schema.portfolioHoldings.id, row.id),
              eq(schema.portfolioHoldings.userId, auth.userId),
            ),
          );
        throw pairingErr;
      }
      return NextResponse.json({ ...row, name }, { status: 201 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      if (code === "23505" || msg.toLowerCase().includes("unique")) {
        return NextResponse.json(
          {
            error: `Account already has a ${ccy} cash sleeve`,
            code: "duplicate_cash_sleeve",
          },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err: unknown) {
    await logApiError("POST", "/api/portfolio/holdings/cash-sleeve", err, auth.userId);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to create cash sleeve") },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  const { userId } = auth.context;
  const id = parseInt(request.nextUrl.searchParams.get("id") ?? "0");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const holding = await db
      .select({
        id: schema.portfolioHoldings.id,
        isCash: schema.portfolioHoldings.isCash,
      })
      .from(schema.portfolioHoldings)
      .where(
        and(
          eq(schema.portfolioHoldings.id, id),
          eq(schema.portfolioHoldings.userId, userId),
        ),
      )
      .get();
    if (!holding) {
      return NextResponse.json({ error: "Cash sleeve not found" }, { status: 404 });
    }
    if (!holding.isCash) {
      return NextResponse.json(
        { error: "Not a cash sleeve — use /api/portfolio for non-cash holdings" },
        { status: 400 },
      );
    }

    const txnCountRow = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          eq(schema.transactions.portfolioHoldingId, id),
        ),
      )
      .get();
    const txnCount = Number(txnCountRow?.cnt ?? 0);
    if (txnCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete — ${txnCount} transaction(s) reference this sleeve. Delete or reassign them first.`,
          code: "cash_sleeve_in_use",
          transactionCount: txnCount,
        },
        { status: 409 },
      );
    }

    await db
      .delete(schema.portfolioHoldings)
      .where(
        and(
          eq(schema.portfolioHoldings.id, id),
          eq(schema.portfolioHoldings.userId, userId),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    await logApiError("DELETE", "/api/portfolio/holdings/cash-sleeve", err, userId);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to delete cash sleeve") },
      { status: 500 },
    );
  }
}
