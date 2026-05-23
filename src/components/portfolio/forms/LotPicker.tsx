"use client";

/**
 * LotPicker — best-effort helper for SellForm.
 *
 * Tries to fetch open lots for the chosen holding so the user can pick
 * specific lots. If the endpoint doesn't exist (404 / 405), renders a
 * "coming soon" notice so the parent form can still submit (server
 * defaults to FIFO when no lotSelection is sent).
 *
 * The component is fully controlled — the parent owns the selectedLotIds
 * state and receives changes via onChange.
 */

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/currency";

interface OpenLot {
  lotId: number;
  openDate: string;
  qty: number;
  costPerShare: number;
  costBasis: number;
}

interface LotPickerApiResponse {
  lots?: OpenLot[];
  data?: { lots?: OpenLot[] };
}

interface LotPickerProps {
  holdingId: number;
  currency: string;
  selectedLotIds: number[];
  onChange: (ids: number[]) => void;
}

export default function LotPicker({
  holdingId,
  currency,
  selectedLotIds,
  onChange,
}: LotPickerProps) {
  // State keyed off holdingId so a holding-switch resets loading/lots in one
  // pass without calling setState synchronously inside the effect (which
  // the react-hooks/set-state-in-effect lint rule flags). The effect only
  // calls setState from async fetch callbacks — never in the effect body.
  const [state, setState] = useState<{
    forHoldingId: number;
    lots: OpenLot[] | null;
    loading: boolean;
    unavailable: boolean;
  }>(() => ({
    forHoldingId: holdingId,
    lots: null,
    loading: true,
    unavailable: false,
  }));
  if (state.forHoldingId !== holdingId) {
    // Render-time reset on prop change — React pattern documented at
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    setState({
      forHoldingId: holdingId,
      lots: null,
      loading: true,
      unavailable: false,
    });
  }
  const { lots, loading, unavailable } = state;

  useEffect(() => {
    let cancelled = false;
    // Defensive fetch — endpoint may not exist yet. 404 → fall back to
    // "coming soon" notice; any parsed payload that lacks a lots array
    // gets the same treatment.
    fetch(`/api/portfolio/lots?holdingId=${holdingId}&openOnly=1`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setState((s) =>
            s.forHoldingId === holdingId
              ? { ...s, unavailable: true, loading: false }
              : s,
          );
          return;
        }
        const json: LotPickerApiResponse = await r.json().catch(() => ({}));
        const rows = json.lots ?? json.data?.lots ?? null;
        if (!Array.isArray(rows)) {
          setState((s) =>
            s.forHoldingId === holdingId
              ? { ...s, unavailable: true, loading: false }
              : s,
          );
          return;
        }
        setState((s) =>
          s.forHoldingId === holdingId
            ? { ...s, lots: rows, loading: false }
            : s,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState((s) =>
          s.forHoldingId === holdingId
            ? { ...s, unavailable: true, loading: false }
            : s,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [holdingId]);

  function toggle(lotId: number) {
    if (selectedLotIds.includes(lotId)) {
      onChange(selectedLotIds.filter((id) => id !== lotId));
    } else {
      onChange([...selectedLotIds, lotId]);
    }
  }

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground">Loading open lots…</p>
    );
  }
  if (unavailable || !lots) {
    return (
      <p className="text-xs text-muted-foreground">
        Lot picker not available — using FIFO.
      </p>
    );
  }
  if (lots.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No open lots for this holding.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2">
        <ul className="space-y-1">
          {lots.map((lot) => {
            const selected = selectedLotIds.includes(lot.lotId);
            return (
              <li
                key={lot.lotId}
                className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggle(lot.lotId)}
                  className="h-3.5 w-3.5"
                  id={`lot-${lot.lotId}`}
                />
                <label
                  htmlFor={`lot-${lot.lotId}`}
                  className="flex flex-1 cursor-pointer items-center justify-between gap-2"
                >
                  <span className="font-mono">{lot.openDate}</span>
                  <span>
                    {lot.qty} × {formatCurrency(lot.costPerShare, currency)} ={" "}
                    {formatCurrency(lot.costBasis, currency)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        {selectedLotIds.length === 0
          ? "No lots selected — leaving picker empty will use FIFO."
          : `${selectedLotIds.length} lot${selectedLotIds.length === 1 ? "" : "s"} selected.`}
      </p>
    </div>
  );
}
