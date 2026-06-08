"use client";

import { useEffect, useState } from "react";
import type { AccountRow, HoldingRow } from "./useAccountHoldingSelection";

export interface CategoryRow {
  id: number;
  name: string | null;
  type?: string | null;
  group?: string | null;
}

interface UsePortfolioFormDataOpts {
  editId: number | null;
  opType: string;
  includeCategories?: boolean;
  /** Override the error shown when d.op !== opType. Receives the actual op from the server. */
  opMismatchMessage?: (receivedOp: string) => string;
}

export interface UsePortfolioFormDataReturn {
  accounts: AccountRow[];
  holdings: HoldingRow[];
  categories: CategoryRow[];
  loading: boolean;
  loadError: string | null;
  editData: Record<string, unknown> | null;
}

export function usePortfolioFormData({
  editId,
  opType,
  includeCategories = false,
  opMismatchMessage,
}: UsePortfolioFormDataOpts): UsePortfolioFormDataReturn {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);

  const isEdit = editId != null && Number.isFinite(editId) && editId > 0;

  useEffect(() => {
    let cancelled = false;
    const fetches: Promise<unknown>[] = [
      fetch("/api/accounts").then((r) => r.json()),
      fetch("/api/portfolio").then((r) => r.json()),
    ];
    if (includeCategories) {
      fetches.push(
        fetch("/api/categories")
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      );
    }
    Promise.all(fetches)
      .then(([acc, holds, cats]) => {
        if (cancelled) return;
        setAccounts(Array.isArray(acc) ? (acc as AccountRow[]) : []);
        setHoldings(Array.isArray(holds) ? (holds as HoldingRow[]) : []);
        if (includeCategories) {
          setCategories(Array.isArray(cats) ? (cats as CategoryRow[]) : []);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeCategories]);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    fetch(`/api/portfolio/operations/load?id=${editId}`)
      .then(async (r) => {
        if (cancelled) return;
        const json: { error?: string; data?: Record<string, unknown> } =
          await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setLoadError(json.error ?? `Failed to load edit data (${r.status})`);
          return;
        }
        const d = json.data;
        if (!d) {
          setLoadError("Failed to load edit data (empty response)");
          return;
        }
        if (d.op !== opType) {
          setLoadError(
            opMismatchMessage
              ? opMismatchMessage(d.op as string)
              : `This edit link is for "${d.op}" — use that form instead.`,
          );
          return;
        }
        setEditData(d);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load edit data",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [editId, isEdit, opType, opMismatchMessage]);

  return { accounts, holdings, categories, loading, loadError, editData };
}
