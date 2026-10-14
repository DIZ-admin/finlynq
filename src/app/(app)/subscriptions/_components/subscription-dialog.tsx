"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, type ComboboxItemShape } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDropdownOrder } from "@/components/dropdown-order-provider";
import { useDisplayCurrency } from "@/components/currency-provider";
import { useActiveCurrencies } from "@/lib/hooks/useActiveCurrencies";
import { parseSaveError } from "@/lib/save-error";
import { FREQUENCY_LABELS, SUBSCRIPTION_FREQUENCIES, frequencyOrMonthly } from "@/lib/subscriptions/schedule";
import type { Subscription } from "./types";

export type SubscriptionDraft = {
  name: string;
  amount: string;
  currency: string;
  frequency: string;
  categoryId: string;
  accountId: string;
  nextDate: string;
  notes: string;
  cancelReminderDate: string;
};

export const EMPTY_DRAFT: SubscriptionDraft = {
  name: "",
  amount: "",
  currency: "",
  frequency: "monthly",
  categoryId: "",
  accountId: "",
  nextDate: "",
  notes: "",
  cancelReminderDate: "",
};

export function draftFromSubscription(sub: Subscription): SubscriptionDraft {
  return {
    name: sub.name ?? "",
    amount: String(sub.amount),
    currency: sub.currency,
    frequency: frequencyOrMonthly(sub.frequency),
    categoryId: sub.categoryId ? String(sub.categoryId) : "",
    accountId: sub.accountId ? String(sub.accountId) : "",
    nextDate: sub.nextDate ?? "",
    notes: sub.notes ?? "",
    cancelReminderDate: sub.cancelReminderDate ?? "",
  };
}

type Option = { id: number; name: string | null };

/**
 * Add / edit a subscription. One dialog + one payload builder for both modes
 * (the loans page lesson: a second dialog is how create and edit drift apart).
 * Keeps the dialog open with the user's input on any failure.
 */
export function SubscriptionDialog({
  open,
  onOpenChange,
  editing,
  initial,
  categories,
  accounts,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set → edit mode (PUT). */
  editing: Subscription | null;
  /** Seed for create mode (e.g. a detected suggestion under review). */
  initial: SubscriptionDraft;
  categories: Option[];
  accounts: Option[];
  onSaved: () => void;
}) {
  const { displayCurrency } = useDisplayCurrency();
  const [form, setForm] = useState<SubscriptionDraft>(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(editing ? draftFromSubscription(editing) : initial);
      setError("");
    }
  }, [open, editing, initial]);

  const sortAccount = useDropdownOrder("account");
  const sortCategory = useDropdownOrder("category");
  const sortCurrency = useDropdownOrder("currency");

  // The currency dropdown is driven by the user's own active set, never a
  // hardcoded list (#291). `form.currency` stays empty until the user picks one
  // and late-binds to the display currency, so the async CurrencyProvider fetch
  // can't be captured stale.
  const formCurrency = form.currency || displayCurrency;
  const currencyOptions = useActiveCurrencies(formCurrency);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const amount = parseFloat(form.amount);
    if (!form.name.trim()) return setError("Name is required");
    if (!Number.isFinite(amount) || amount <= 0) return setError("Amount must be greater than 0");

    const payload = {
      name: form.name.trim(),
      amount,
      currency: formCurrency,
      frequency: form.frequency,
      categoryId: form.categoryId ? parseInt(form.categoryId) : null,
      accountId: form.accountId ? parseInt(form.accountId) : null,
      nextDate: form.nextDate || null,
      notes: form.notes || null,
      cancelReminderDate: form.cancelReminderDate || null,
    };

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/subscriptions", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...payload } : payload),
      });
      if (!res.ok) {
        setError(await parseSaveError(res, "Failed to save subscription"));
        return;
      }
      onOpenChange(false);
      onSaved();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit subscription" : "New subscription"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="sub-name">Name</Label>
            <Input
              id="sub-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Netflix, car insurance, domain renewal"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sub-amount">Amount per payment</Label>
              <Input
                id="sub-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>How often</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v ?? "monthly" })}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: unknown) => FREQUENCY_LABELS[frequencyOrMonthly(String(v ?? ""))]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SUBSCRIPTION_FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Currency</Label>
              <Combobox
                value={formCurrency}
                onValueChange={(v) => setForm({ ...form, currency: v || displayCurrency })}
                items={sortCurrency(
                  currencyOptions.map((c): ComboboxItemShape => ({ value: c, label: c })),
                  (c) => c.value,
                  (a, z) => a.label.localeCompare(z.label),
                )}
                placeholder={displayCurrency}
                searchPlaceholder="Search…"
                emptyMessage="No matches"
                className="w-full"
              />
            </div>
            <div>
              <Label htmlFor="sub-next">Next payment</Label>
              <Input
                id="sub-next"
                type="date"
                value={form.nextDate}
                onChange={(e) => setForm({ ...form, nextDate: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Combobox
                value={form.categoryId}
                onValueChange={(v) => setForm({ ...form, categoryId: v })}
                items={sortCategory(
                  categories.map((c): ComboboxItemShape => ({ value: String(c.id), label: c.name ?? "" })),
                  (c) => Number(c.value),
                  (a, z) => (a.label ?? "").localeCompare(z.label ?? ""),
                )}
                placeholder="None"
                searchPlaceholder="Search categories…"
                emptyMessage="No matches"
                className="w-full"
              />
            </div>
            <div>
              <Label>Paid from</Label>
              <Combobox
                value={form.accountId}
                onValueChange={(v) => setForm({ ...form, accountId: v })}
                items={sortAccount(
                  accounts.map((a): ComboboxItemShape => ({ value: String(a.id), label: a.name ?? "" })),
                  (a) => Number(a.value),
                  (a, z) => (a.label ?? "").localeCompare(z.label ?? ""),
                )}
                placeholder="None"
                searchPlaceholder="Search accounts…"
                emptyMessage="No matches"
                className="w-full"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="sub-reminder">Remind me to cancel on</Label>
            <Input
              id="sub-reminder"
              type="date"
              value={form.cancelReminderDate}
              onChange={(e) => setForm({ ...form, cancelReminderDate: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="sub-notes">Notes</Label>
            <Input id="sub-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add subscription"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
