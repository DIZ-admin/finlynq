"use client";

import { useEffect, useState } from "react";
import { SUPPORTED_FIAT_CURRENCIES } from "@/lib/fx/supported-currencies";

/**
 * Currency codes to offer in form dropdowns (account / transaction / goal /
 * loan / holding forms).
 *
 * Returns the full built-in supported-fiat list UNION the user's
 * `active_currencies` setting — so custom, metal, or regional ISO codes the
 * user added in Settings → "Currencies you use" actually appear in the
 * pickers (the gap behind issue #291, where the Add/Edit Account dropdown was
 * hardcoded to CAD/USD/EUR/GBP and ignored the setting entirely).
 *
 * The result is always a SUPERSET of `SUPPORTED_FIAT_CURRENCIES`, so a cold or
 * failed fetch degrades to today's behavior rather than an empty list.
 *
 * `ensure` guarantees specific codes are present regardless of the setting —
 * pass the value a form is currently bound to (e.g. an account's existing
 * currency in edit mode) so a Combobox/Select never renders a value missing
 * from its own item list.
 */
export function useActiveCurrencies(ensure?: string | string[] | null): string[] {
  const [active, setActive] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/active-currencies")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { active?: unknown } | null) => {
        if (cancelled) return;
        if (Array.isArray(data?.active)) {
          setActive(
            data.active
              .filter((s): s is string => typeof s === "string")
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
          );
        }
      })
      .catch(() => {
        /* keep the built-in fiat list */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ensured = (ensure == null ? [] : Array.isArray(ensure) ? ensure : [ensure])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().toUpperCase());

  return Array.from(new Set([...SUPPORTED_FIAT_CURRENCIES, ...active, ...ensured])).sort();
}
