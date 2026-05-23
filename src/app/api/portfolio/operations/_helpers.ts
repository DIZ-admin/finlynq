/**
 * Shared error → HTTP response mapping for /api/portfolio/operations/* routes.
 *
 * Each route delegates to the corresponding helper in
 * src/lib/portfolio/operations.ts; this file maps the domain errors those
 * helpers throw into structured 400 responses.
 */

import { NextResponse } from "next/server";
import {
  CashSleeveNotFoundError,
  CurrencyMismatchError,
  HoldingNotFoundError,
  InvalidLinkPairError,
} from "@/lib/portfolio/operations";

export function mapOperationError(err: unknown): NextResponse | null {
  if (err instanceof CashSleeveNotFoundError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        accountId: err.accountId,
        currency: err.currency,
      },
      { status: 400 },
    );
  }
  if (err instanceof CurrencyMismatchError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        expected: err.expected,
        got: err.got,
      },
      { status: 400 },
    );
  }
  if (err instanceof HoldingNotFoundError) {
    return NextResponse.json(
      { error: err.message, code: err.code, holdingId: err.holdingId },
      { status: 404 },
    );
  }
  if (err instanceof InvalidLinkPairError) {
    return NextResponse.json(
      { error: err.message, code: "invalid_link_pair" },
      { status: 400 },
    );
  }
  return null;
}
