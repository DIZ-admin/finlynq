/**
 * GET /api/securities/lookup?symbol=AAPL — best-effort ticker → name/currency.
 *
 * Powers the "Add security" dialog's auto-fill: when the user types a ticker we
 * try to resolve its display name (Yahoo `shortName`) + quote currency so they
 * don't have to type them. Purely advisory — on a miss / timeout it returns
 * { found:false } and the user fills the fields manually (dev's price_cache is
 * cold so live fetches can time out; that's expected and non-blocking).
 *
 * Auth: requireAuth (no DEK needed — this only hits the public quote service).
 */

import { apiHandler } from "@/lib/api-handler";
import { fetchQuote } from "@/lib/price-service";

export const GET = apiHandler(
  { auth: "auth", fallbackMessage: "Lookup failed" },
  async ({ request }) => {
    const symbol = (request.nextUrl.searchParams.get("symbol") ?? "").trim();
    if (!symbol) return { found: false };

    const quote = await fetchQuote(symbol).catch(() => null);
    if (!quote) return { found: false };

    // fetchQuote falls back to `name = symbol` when Yahoo has no shortName — in
    // that case there's no real description to offer.
    const name =
      quote.name && quote.name.trim().toUpperCase() !== symbol.toUpperCase()
        ? quote.name.trim()
        : null;
    return { found: true, name, currency: quote.currency ?? null };
  },
);
