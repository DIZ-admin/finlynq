"use client";

/**
 * Transactions-page data hooks (FINLYNQ-111 Phase 2).
 *
 * Mechanical extraction of the inline state + effects that used to live in
 * `TransactionsPageInner`. Each hook moves the EXISTING state + fetch logic
 * verbatim — same effects, same deps, same fetch URLs, same setState, same
 * debounce timings. No coordination/logic changes; behaviour-preserving.
 */

import { useState, useEffect, useRef } from "react";
import {
  DEFAULT_COLUMNS as SHARED_DEFAULT_COLUMNS,
  COLUMN_IDS as SHARED_COLUMN_IDS,
  isSortableColumnId,
  type ColumnId,
  type SortableColumnId,
} from "@/lib/transactions/columns";
import type { Account, Category, Holding, ColFilterShape, SortPref, ColumnPref } from "../_types";

const ALL_COLUMNS = SHARED_COLUMN_IDS as readonly ColumnId[];
const DEFAULT_COL_PREFS = SHARED_DEFAULT_COLUMNS;

function mergeColPrefs(saved: ColumnPref[] | null | undefined): ColumnPref[] {
  if (!saved || saved.length === 0) return DEFAULT_COL_PREFS;
  const seen = new Set<ColumnId>();
  const out: ColumnPref[] = [];
  for (const entry of saved) {
    if (!ALL_COLUMNS.includes(entry.id)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, visible: !!entry.visible });
  }
  for (const def of DEFAULT_COL_PREFS) {
    if (seen.has(def.id)) continue;
    out.push(def);
  }
  return out;
}

/**
 * Mount triplet — accounts / categories / holdings lookups. Same uncoordinated
 * parallel fetch as the original mount effect.
 */
export function useLookups() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  useEffect(() => {
    fetch("/api/accounts").then((r) => r.ok ? r.json() : []).then(setAccounts);
    fetch("/api/categories").then((r) => r.ok ? r.json() : []).then(setCategories);
    fetch("/api/portfolio").then((r) => r.ok ? r.json() : []).then(setHoldings);
  }, []);
  return { accounts, categories, holdings };
}

/**
 * Per-user table column layout (visibility + order) persisted via
 * /api/settings/tx-columns. Migrates the legacy localStorage["pf-tx-cols-v1"]
 * blob on first load (then clears it). Last-writer-wins on save (debounced 400ms).
 */
export function useTxColumnPrefs() {
  const [columnPrefs, setColumnPrefs] = useState<ColumnPref[]>(DEFAULT_COL_PREFS);
  const colPrefsLoaded = useRef(false);
  const colPrefsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Read the legacy localStorage blob only when the server endpoint has
      // never been written for this user — otherwise the server-side layout
      // wins (cross-device sync). The legacy blob is cleared after one
      // successful migration.
      let legacy: ColumnPref[] | null = null;
      try {
        const raw = localStorage.getItem("pf-tx-cols-v1");
        if (raw) {
          const parsed = JSON.parse(raw) as { portfolio?: boolean };
          if (parsed && typeof parsed === "object") {
            legacy = DEFAULT_COL_PREFS.map((c) =>
              c.id === "portfolio"
                ? { ...c, visible: !!parsed.portfolio }
                : c,
            );
          }
        }
      } catch { /* ignore */ }
      try {
        const r = await fetch("/api/settings/tx-columns");
        if (cancelled) return;
        if (r.ok) {
          const d = (await r.json()) as { columns?: ColumnPref[] };
          const serverPrefs = mergeColPrefs(d?.columns ?? null);
          // If the server has the canonical defaults AND we have a legacy
          // blob, push the legacy preferences up so the migration sticks.
          const isServerDefault =
            !d?.columns || d.columns.length === 0;
          if (legacy && isServerDefault) {
            setColumnPrefs(legacy);
            try {
              await fetch("/api/settings/tx-columns", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ columns: legacy }),
              });
              localStorage.removeItem("pf-tx-cols-v1");
            } catch { /* best-effort */ }
          } else {
            setColumnPrefs(serverPrefs);
            try { localStorage.removeItem("pf-tx-cols-v1"); } catch { /* ignore */ }
          }
        } else if (legacy) {
          setColumnPrefs(legacy);
        }
      } catch {
        if (legacy) setColumnPrefs(legacy);
      } finally {
        if (!cancelled) colPrefsLoaded.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!colPrefsLoaded.current) return;
    if (colPrefsSaveTimer.current) clearTimeout(colPrefsSaveTimer.current);
    colPrefsSaveTimer.current = setTimeout(() => {
      fetch("/api/settings/tx-columns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: columnPrefs }),
      }).catch(() => { /* swallow — next save retries */ });
    }, 400);
    return () => {
      if (colPrefsSaveTimer.current) clearTimeout(colPrefsSaveTimer.current);
    };
  }, [columnPrefs]);
  const resetColPrefs = () => setColumnPrefs(DEFAULT_COL_PREFS);
  return { columnPrefs, setColumnPrefs, resetColPrefs };
}

/**
 * Per-user header sort (issue #59). Cycles desc → asc → null on repeated
 * clicks. Persisted via /api/settings/tx-sort (debounced 400ms).
 */
export function useTxSortPref(onChange?: () => void) {
  const [sortPref, setSortPref] = useState<SortPref>({ columnId: null, direction: null });
  const sortPrefLoaded = useRef(false);
  const sortPrefSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/tx-sort")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SortPref | null) => {
        if (cancelled) return;
        if (d && (d.columnId === null || isSortableColumnId(d.columnId)) && (d.direction === null || d.direction === "asc" || d.direction === "desc")) {
          setSortPref({ columnId: d.columnId, direction: d.direction });
        }
      })
      .catch(() => { /* default = unsorted */ })
      .finally(() => {
        if (!cancelled) sortPrefLoaded.current = true;
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!sortPrefLoaded.current) return;
    if (sortPrefSaveTimer.current) clearTimeout(sortPrefSaveTimer.current);
    sortPrefSaveTimer.current = setTimeout(() => {
      fetch("/api/settings/tx-sort", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sortPref),
      }).catch(() => { /* swallow */ });
    }, 400);
    return () => {
      if (sortPrefSaveTimer.current) clearTimeout(sortPrefSaveTimer.current);
    };
  }, [sortPref]);
  function cycleSort(columnId: SortableColumnId) {
    setSortPref((prev) => {
      if (prev.columnId !== columnId) return { columnId, direction: "desc" };
      if (prev.direction === "desc") return { columnId, direction: "asc" };
      return { columnId: null, direction: null };
    });
    onChange?.();
  }
  return { sortPref, setSortPref, cycleSort };
}

/**
 * Per-column filters (issue #59). Discriminated union by column type; persisted
 * via /api/settings/tx-filters (debounced 400ms). Each column has at most one
 * filter active at a time.
 */
export function useTxFilterPrefs(onChange?: () => void) {
  const [colFilters, setColFilters] = useState<ColFilterShape[]>([]);
  const colFiltersLoaded = useRef(false);
  const colFiltersSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/tx-filters")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { filters?: ColFilterShape[] } | null) => {
        if (cancelled) return;
        if (d?.filters) setColFilters(d.filters);
      })
      .catch(() => { /* default = no filters */ })
      .finally(() => {
        if (!cancelled) colFiltersLoaded.current = true;
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!colFiltersLoaded.current) return;
    if (colFiltersSaveTimer.current) clearTimeout(colFiltersSaveTimer.current);
    colFiltersSaveTimer.current = setTimeout(() => {
      fetch("/api/settings/tx-filters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: colFilters }),
      }).catch(() => { /* swallow */ });
    }, 400);
    return () => {
      if (colFiltersSaveTimer.current) clearTimeout(colFiltersSaveTimer.current);
    };
  }, [colFilters]);
  function findColFilter(columnId: ColumnId): ColFilterShape | undefined {
    return colFilters.find((f) => f.columnId === columnId);
  }
  function setColFilter(filter: ColFilterShape | null, columnId: ColumnId) {
    setColFilters((prev) => {
      const without = prev.filter((f) => f.columnId !== columnId);
      return filter ? [...without, filter] : without;
    });
    onChange?.();
  }
  return { colFilters, setColFilters, findColFilter, setColFilter };
}
