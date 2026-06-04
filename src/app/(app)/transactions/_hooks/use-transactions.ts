"use client";

/**
 * useTransactions (FINLYNQ-111 Phase 2).
 *
 * Owns the main list state (`txns` / `total` / `loading` / `page`) + `loadTxns`.
 * Mechanical extraction of the inline `loadTxns` useCallback + its driving
 * effect — same deps, same fetch URL (built by the pure buildTransactionQuery),
 * same `{data,total}` unwrap (issue #59), same setLoading bracketing.
 */

import { useState, useCallback, useEffect } from "react";
import { buildTransactionQuery } from "@/lib/transactions/build-query";
import type { Account, ColFilterShape, SortPref, Transaction } from "../_types";

const limit = 50;

export const TX_PAGE_LIMIT = limit;

export function useTransactions(
  filters: {
    startDate: string;
    endDate: string;
    accountId: string;
    categoryId: string;
    search: string;
    portfolioHolding: string;
    tag: string;
  },
  sortPref: SortPref,
  colFilters: ColFilterShape[],
  accounts: Account[],
  page: number,
) {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadTxns = useCallback(() => {
    setLoading(true);
    // Issue #59 — the top-bar quick filters are URL-driven (deep links from
    // /portfolio etc. must keep working); per-column filters + sort are
    // persisted server-side. Both sets narrow the result. The param assembly
    // is the pure, unit-tested buildTransactionQuery (FINLYNQ-111 Phase 1).
    const params = buildTransactionQuery(filters, sortPref, colFilters, accounts, { page, limit });

    fetch(`/api/transactions?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setTxns(d.data ?? []);
        setTotal(d.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [filters, page, sortPref, colFilters, accounts]);

  useEffect(() => { loadTxns(); }, [loadTxns]);

  return { txns, total, loading, limit, loadTxns };
}
