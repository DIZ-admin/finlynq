"use client";

/**
 * ColumnFilterPopover (FINLYNQ-111 Phase 2).
 *
 * Per-column filter popover, extracted verbatim from transactions/page.tsx.
 * Renders a small dropdown with a type-appropriate input(s) — date range /
 * substring / numeric op / multi-select enum. The icon turns primary-colored
 * when a filter is active.
 *
 * Encrypted-column substring filters route through the post-decrypt path
 * server-side; date / numeric / id / source filters push down into SQL.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Filter } from "lucide-react";
import { labelForSource, SOURCES } from "@/lib/tx-source";
import type { ColumnId as SharedColumnId, FilterType } from "@/lib/transactions/columns";
import type { ColFilterShape } from "../_types";

export function ColumnFilterPopover({
  columnId,
  filterType,
  activeFilter,
  onChange,
  accounts,
  categories,
}: {
  columnId: SharedColumnId;
  filterType: FilterType;
  activeFilter: ColFilterShape | undefined;
  onChange: (f: ColFilterShape | null) => void;
  accounts: Array<{ id: number; name: string; type?: string | null; alias?: string | null }>;
  categories: Array<{ id: number; name: string }>;
}) {
  const isActive = !!activeFilter;
  // Local draft state so the user can type without firing one network
  // request per keystroke. Committed on Apply.
  const [draft, setDraft] = useState<ColFilterShape | null>(activeFilter ?? null);
  useEffect(() => {
    setDraft(activeFilter ?? null);
  }, [activeFilter]);

  const initDraft = (): ColFilterShape => {
    if (filterType === "date") return { type: "date", columnId };
    if (filterType === "text") return { type: "text", columnId, value: "" };
    if (filterType === "numeric") return { type: "numeric", columnId, op: "eq", value: 0 };
    return { type: "enum", columnId, values: [] };
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`p-0.5 rounded hover:bg-muted transition-colors ${isActive ? "text-primary" : "text-muted-foreground/60"}`}
            title={isActive ? "Filter active — click to edit" : "Filter column"}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <Filter className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64 p-3 space-y-2">
        {filterType === "date" && (
          <>
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={(draft as { from?: string } | null)?.from ?? ""}
              onChange={(e) => {
                const cur = (draft as ColFilterShape | null) ?? initDraft();
                if (cur.type !== "date") return;
                setDraft({ ...cur, from: e.target.value || undefined });
              }}
              // base-ui Menu.Root attaches keydown listeners on the menu surface
              // for type-ahead (printable chars) and back/close (Backspace).
              // Without this stopPropagation the input never sees its own
              // keystrokes — the menu eats them first. Allow Escape and Tab
              // to bubble so dropdown-close + focus traversal still work.
              onKeyDown={(e) => {
                if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
              }}
            />
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={(draft as { to?: string } | null)?.to ?? ""}
              onChange={(e) => {
                const cur = (draft as ColFilterShape | null) ?? initDraft();
                if (cur.type !== "date") return;
                setDraft({ ...cur, to: e.target.value || undefined });
              }}
              onKeyDown={(e) => {
                if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
              }}
            />
          </>
        )}
        {filterType === "text" && (
          <>
            <Label className="text-xs">Contains</Label>
            <Input
              className="h-8 text-xs"
              placeholder="Substring…"
              value={(draft as { value?: string } | null)?.value ?? ""}
              onChange={(e) => setDraft({ type: "text", columnId, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
              }}
            />
          </>
        )}
        {filterType === "numeric" && (
          <>
            <Label className="text-xs">Operator</Label>
            <Select
              value={(draft as { op?: string } | null)?.op ?? "eq"}
              onValueChange={(v) => {
                const op = (v ?? "eq") as "eq" | "gt" | "lt" | "between";
                const cur = draft && draft.type === "numeric" ? draft : { type: "numeric" as const, columnId, value: 0, op };
                setDraft({ ...cur, op } as ColFilterShape);
              }}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eq">=</SelectItem>
                <SelectItem value="gt">&gt;</SelectItem>
                <SelectItem value="lt">&lt;</SelectItem>
                <SelectItem value="between">Between</SelectItem>
              </SelectContent>
            </Select>
            <Label className="text-xs">Value</Label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={(draft as { value?: number } | null)?.value ?? ""}
              onChange={(e) => {
                const n = e.target.value === "" ? 0 : Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const cur = draft && draft.type === "numeric" ? draft : { type: "numeric" as const, columnId, op: "eq" as const, value: 0 };
                setDraft({ ...cur, value: n } as ColFilterShape);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
              }}
            />
            {draft?.type === "numeric" && draft.op === "between" && (
              <>
                <Label className="text-xs">Upper bound</Label>
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={draft.value2 ?? ""}
                  onChange={(e) => {
                    const n = e.target.value === "" ? undefined : Number(e.target.value);
                    if (n != null && !Number.isFinite(n)) return;
                    setDraft({ ...draft, value2: n });
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
                  }}
                />
              </>
            )}
          </>
        )}
        {filterType === "enum" && (
          <>
            <Label className="text-xs">Match any of</Label>
            <div className="max-h-48 overflow-y-auto space-y-1 border rounded p-2">
              {columnId === "source" &&
                SOURCES.map((s) => {
                  const checked = draft?.type === "enum" && draft.values.includes(s);
                  return (
                    <label key={s} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const cur = draft && draft.type === "enum" ? draft : { type: "enum" as const, columnId, values: [] };
                          const values = e.target.checked
                            ? Array.from(new Set([...cur.values, s]))
                            : cur.values.filter((v) => v !== s);
                          setDraft({ ...cur, values });
                        }}
                      />
                      {labelForSource(s)}
                    </label>
                  );
                })}
              {columnId === "category" &&
                categories.map((cat) => {
                  const checked = draft?.type === "enum" && draft.values.includes(String(cat.id));
                  return (
                    <label key={cat.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const cur = draft && draft.type === "enum" ? draft : { type: "enum" as const, columnId, values: [] };
                          const values = e.target.checked
                            ? Array.from(new Set([...cur.values, String(cat.id)]))
                            : cur.values.filter((v) => v !== String(cat.id));
                          setDraft({ ...cur, values });
                        }}
                      />
                      {cat.name}
                    </label>
                  );
                })}
              {columnId === "account" &&
                accounts.map((a) => {
                  const checked = draft?.type === "enum" && draft.values.includes(String(a.id));
                  return (
                    <label key={a.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const cur = draft && draft.type === "enum" ? draft : { type: "enum" as const, columnId, values: [] };
                          const values = e.target.checked
                            ? Array.from(new Set([...cur.values, String(a.id)]))
                            : cur.values.filter((v) => v !== String(a.id));
                          setDraft({ ...cur, values });
                        }}
                      />
                      {a.name}
                    </label>
                  );
                })}
              {columnId === "accountType" &&
                Array.from(new Set(accounts.map((a) => a.type).filter(Boolean) as string[])).map((t) => {
                  const checked = draft?.type === "enum" && draft.values.includes(t);
                  return (
                    <label key={t} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const cur = draft && draft.type === "enum" ? draft : { type: "enum" as const, columnId, values: [] };
                          const values = e.target.checked
                            ? Array.from(new Set([...cur.values, t]))
                            : cur.values.filter((v) => v !== t);
                          setDraft({ ...cur, values });
                        }}
                      />
                      {t}
                    </label>
                  );
                })}
            </div>
          </>
        )}
        <DropdownMenuSeparator />
        <div className="flex gap-2 justify-end">
          {isActive && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onChange(null)}
            >
              Clear
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              if (!draft) {
                onChange(null);
                return;
              }
              // Drop empty-state filters (no values, no inputs)
              if (draft.type === "date" && !draft.from && !draft.to) onChange(null);
              else if (draft.type === "text" && !draft.value.trim()) onChange(null);
              else if (draft.type === "enum" && draft.values.length === 0) onChange(null);
              else onChange(draft);
            }}
          >
            Apply
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
