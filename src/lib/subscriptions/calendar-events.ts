/**
 * Pure builders for the Subscriptions page — the list-view summary, the
 * "detected from your transactions" suggestions and the calendar-view events
 * all come from here, so the two views cannot disagree about what is due when.
 *
 * Client-safe (no db / server imports). Mirrored by mobile
 * mobile/src/lib/subscriptions.ts — keep the two in sync.
 */

import {
  frequencyOrMonthly,
  monthlyEquivalent,
  occurrencesBetween,
  rollForwardNextDate,
  type SubscriptionFrequency,
} from "./schedule";

/** GET /api/subscriptions row (the fields these builders read). */
export interface SubscriptionRow {
  id: number;
  name: string | null;
  amount: number;
  currency: string;
  frequency: string;
  nextDate: string | null;
  status: string;
  /** Current-rate conversion of `amount` into `displayCurrency` (FINLYNQ-123). */
  displayAmount?: number;
}

/** GET /api/recurring `recurring[]` row. */
export interface RecurringRow {
  payee: string;
  /** Signed: negative = money out (bill), positive = money in (income). */
  avgAmount: number;
  currency: string;
  avgAmountDisplay?: number;
  frequency: string;
  count: number;
  lastDate: string;
  nextDate: string;
  accountId: number;
  categoryId: number | null;
}

export interface ScheduleEvent {
  date: string;
  name: string;
  /** NATIVE amount (always positive), shown per row in `currency`. */
  amount: number;
  currency: string;
  /** The same amount in the display currency — totals only. */
  displayAmount: number;
  type: "bill" | "income";
  source: "subscription" | "detected";
  frequency: SubscriptionFrequency;
  /** Set for `source: "subscription"`. */
  subscriptionId?: number;
  /** Set for `source: "detected"`, so the UI can offer "Track". */
  detected?: RecurringRow;
}

const nameKey = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * A detected payee is "already tracked" when ANY subscription (whatever its
 * status) carries the same name. A cancelled subscription is a decision the
 * user already made — re-suggesting it is noise.
 */
export function isTrackedPayee(payee: string, subs: SubscriptionRow[]): boolean {
  const k = nameKey(payee);
  return !!k && subs.some((s) => nameKey(s.name) === k);
}

/** Recurring EXPENSES the user isn't tracking yet, biggest monthly cost first. */
export function detectedSuggestions(recurring: RecurringRow[], subs: SubscriptionRow[]): RecurringRow[] {
  return recurring
    .filter((r) => r.avgAmount < 0 && !isTrackedPayee(r.payee, subs))
    .sort(
      (a, b) =>
        monthlyEquivalent(Math.abs(b.avgAmountDisplay ?? b.avgAmount), b.frequency) -
        monthlyEquivalent(Math.abs(a.avgAmountDisplay ?? a.avgAmount), a.frequency),
    );
}

/** Display-currency amount of one billing period (native when no conversion was served). */
export function subDisplayAmount(s: SubscriptionRow): number {
  return s.displayAmount ?? s.amount;
}

/** Effective next payment date: a passed date on an active row is rolled forward. */
export function effectiveNextDate(s: SubscriptionRow, today: string): string | null {
  if (s.status !== "active") return s.nextDate;
  return rollForwardNextDate(s.nextDate, s.frequency, today);
}

export interface SubscriptionTotals {
  /** Active subscriptions, monthly-equivalent, display currency. */
  monthly: number;
  annual: number;
  activeCount: number;
  /** Payments falling in [today, today + horizonDays], display currency. */
  dueSoonAmount: number;
  dueSoonCount: number;
}

export function subscriptionTotals(
  subs: SubscriptionRow[],
  today: string,
  dueSoonEnd: string,
): SubscriptionTotals {
  const active = subs.filter((s) => s.status === "active");
  const monthly = active.reduce((sum, s) => sum + monthlyEquivalent(subDisplayAmount(s), s.frequency), 0);
  let dueSoonAmount = 0;
  let dueSoonCount = 0;
  for (const s of active) {
    if (!s.nextDate) continue;
    const n = occurrencesBetween(s.nextDate, s.frequency, today, dueSoonEnd).length;
    dueSoonAmount += n * Math.abs(subDisplayAmount(s));
    dueSoonCount += n;
  }
  return { monthly, annual: monthly * 12, activeCount: active.length, dueSoonAmount, dueSoonCount };
}

/**
 * Every expected payment in [start, end]: active subscriptions (bills) plus
 * detected recurring series that aren't tracked (bills AND income), sorted by
 * date then name.
 */
export function buildScheduleEvents(
  subs: SubscriptionRow[],
  recurring: RecurringRow[],
  start: string,
  end: string,
): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];

  for (const s of subs) {
    if (s.status !== "active" || !s.nextDate) continue;
    const frequency = frequencyOrMonthly(s.frequency);
    for (const date of occurrencesBetween(s.nextDate, frequency, start, end)) {
      events.push({
        date,
        name: s.name ?? "Subscription",
        amount: Math.abs(s.amount),
        currency: s.currency,
        displayAmount: Math.abs(subDisplayAmount(s)),
        type: "bill",
        source: "subscription",
        frequency,
        subscriptionId: s.id,
      });
    }
  }

  for (const r of recurring) {
    if (isTrackedPayee(r.payee, subs)) continue;
    const frequency = frequencyOrMonthly(r.frequency);
    for (const date of occurrencesBetween(r.nextDate, frequency, start, end)) {
      events.push({
        date,
        name: r.payee,
        amount: Math.abs(r.avgAmount),
        currency: r.currency,
        displayAmount: Math.abs(r.avgAmountDisplay ?? r.avgAmount),
        type: r.avgAmount > 0 ? "income" : "bill",
        source: "detected",
        frequency,
        detected: r,
      });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
