// Feature 6: Recurring Transaction Detection

import { occurrenceAt } from "@/lib/subscriptions/schedule";

type Transaction = {
  id: number;
  date: string;
  payee: string;
  amount: number;
  currency: string;
  accountId: number;
  categoryId: number | null;
};

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function todayDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type DetectedRecurring = {
  payee: string;
  avgAmount: number;
  /** Native currency of the underlying transactions (never assumed). */
  currency: string;
  frequency: RecurringFrequency;
  count: number;
  lastDate: string;
  nextDate: string;
  accountId: number;
  categoryId: number | null;
  transactions: Transaction[];
};

/**
 * Detector cadence vocabulary. "yearly" (not "annual") is kept for the
 * /api/recurring response contract; consumers normalize through
 * `normalizeFrequency` in lib/subscriptions/schedule.ts.
 */
export type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "yearly";

function daysBetween(d1: string, d2: string): number {
  return Math.abs(
    (parseDateOnly(d1).getTime() - parseDateOnly(d2).getTime()) / 86400000
  );
}

function guessFrequency(avgDays: number): RecurringFrequency | null {
  if (avgDays >= 5 && avgDays <= 9) return "weekly";
  if (avgDays >= 12 && avgDays <= 18) return "biweekly";
  if (avgDays >= 25 && avgDays <= 35) return "monthly";
  if (avgDays >= 80 && avgDays <= 100) return "quarterly";
  if (avgDays >= 170 && avgDays <= 195) return "semiannual";
  if (avgDays >= 350 && avgDays <= 380) return "yearly";
  return null;
}

// Shared UTC, anchor-indexed schedule math (lib/subscriptions/schedule.ts).
// The old local-midnight `setMonth` stepping overflowed Jan 31 → Mar 3.
function addFrequency(date: string, frequency: string, periods = 1): string {
  return occurrenceAt(date, frequency, periods);
}

export interface DetectOptions {
  /**
   * When set (ISO date, normally today), drop series that have LAPSED — the
   * next two expected payments after `lastDate` both fell before the series'
   * reference date. A Netflix cancelled eight months ago is not a recurring
   * payment any more, and showing it as an upcoming bill or a subscription
   * suggestion is noise. One missed date is tolerated (a bank feed can lag a
   * cycle).
   *
   * The reference date is the NEWEST transaction in the series' own
   * account(s), capped at `asOf` — never `asOf` alone. Measured against today,
   * a user whose imports for an account stopped in June would be told every
   * bill on it was cancelled, which is a data-freshness problem, not a lapse.
   */
  asOf?: string;
}

export function detectRecurringTransactions(
  transactions: Transaction[],
  opts: DetectOptions = {},
): DetectedRecurring[] {
  // Group by (payee, currency). Currency is part of the key on purpose: the
  // same payee billed in two currencies is two different recurring series, and
  // averaging their amounts together would produce a meaningless figure under
  // a single currency label.
  const groups = new Map<string, Transaction[]>();
  // Newest transaction per account — the lapse reference (see DetectOptions).
  const latestByAccount = new Map<number, string>();
  if (opts.asOf) {
    for (const t of transactions) {
      const prev = latestByAccount.get(t.accountId);
      if (!prev || t.date > prev) latestByAccount.set(t.accountId, t.date);
    }
  }
  for (const t of transactions) {
    const payeeKey = (t.payee || "").trim().toLowerCase();
    if (!payeeKey) continue;
    const key = `${payeeKey}|${(t.currency || "").trim().toUpperCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const results: DetectedRecurring[] = [];

  for (const [, txns] of groups) {
    if (txns.length < 3) continue;

    // Sort by date
    const sorted = txns.sort((a, b) => a.date.localeCompare(b.date));

    // Check amount consistency (within 20% of average)
    const avgAmount = sorted.reduce((s, t) => s + t.amount, 0) / sorted.length;
    const amountConsistent = sorted.every(
      (t) => Math.abs(t.amount - avgAmount) / Math.abs(avgAmount) < 0.2
    );
    if (!amountConsistent) continue;

    // Check interval consistency
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i].date, sorted[i - 1].date));
    }

    const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length;
    const frequency = guessFrequency(avgInterval);
    if (!frequency) continue;

    // Check interval consistency (within 40% of average)
    const intervalConsistent = intervals.every(
      (d) => Math.abs(d - avgInterval) / avgInterval < 0.4
    );
    if (!intervalConsistent) continue;

    const lastDate = sorted[sorted.length - 1].date;
    if (opts.asOf) {
      let horizon = "";
      for (const t of sorted) {
        const latest = latestByAccount.get(t.accountId) ?? "";
        if (latest > horizon) horizon = latest;
      }
      const reference = horizon && horizon < opts.asOf ? horizon : opts.asOf;
      if (addFrequency(lastDate, frequency, 2) < reference) continue;
    }
    results.push({
      payee: sorted[0].payee,
      avgAmount: Math.round(avgAmount * 100) / 100,
      currency: sorted[0].currency,
      frequency,
      count: sorted.length,
      lastDate,
      nextDate: addFrequency(lastDate, frequency),
      accountId: sorted[0].accountId,
      categoryId: sorted[0].categoryId,
      transactions: sorted,
    });
  }

  return results.sort((a, b) => Math.abs(b.avgAmount) - Math.abs(a.avgAmount));
}

// Feature 7: Cash Flow Forecasting
export function forecastCashFlow(
  recurring: DetectedRecurring[],
  currentBalance: number,
  daysAhead: number = 90
): { date: string; balance: number; transactions: { payee: string; amount: number }[] }[] {
  const today = todayDateOnly();
  const forecast: { date: string; balance: number; transactions: { payee: string; amount: number }[] }[] = [];
  let balance = currentBalance;

  const upcoming: { date: string; payee: string; amount: number }[] = [];

  for (const r of recurring) {
    let nextDate = parseDateOnly(r.nextDate);

    while (nextDate <= new Date(today.getTime() + daysAhead * 86400000)) {
      if (nextDate >= today) {
        upcoming.push({
          date: nextDate.toISOString().split("T")[0],
          payee: r.payee,
          amount: r.avgAmount,
        });
      }
      // Advance to next occurrence
      const next = addFrequency(nextDate.toISOString().split("T")[0], r.frequency);
      nextDate = parseDateOnly(next);
    }
  }

  // Sort by date
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  // Group by date
  const byDate = new Map<string, { payee: string; amount: number }[]>();
  for (const u of upcoming) {
    byDate.set(u.date, [...(byDate.get(u.date) ?? []), { payee: u.payee, amount: u.amount }]);
  }

  // Generate forecast
  for (const [date, txns] of byDate) {
    const dayTotal = txns.reduce((s, t) => s + t.amount, 0);
    balance += dayTotal;
    forecast.push({ date, balance: Math.round(balance * 100) / 100, transactions: txns });
  }

  return forecast;
}
