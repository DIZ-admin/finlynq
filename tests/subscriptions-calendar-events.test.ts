import { describe, it, expect } from "vitest";
import {
  buildScheduleEvents,
  detectedSuggestions,
  effectiveNextDate,
  subscriptionTotals,
  type RecurringRow,
  type SubscriptionRow,
} from "@/lib/subscriptions/calendar-events";

const sub = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  id: 1,
  name: "Netflix",
  amount: 15,
  currency: "USD",
  frequency: "monthly",
  nextDate: "2026-10-10",
  status: "active",
  displayAmount: 15,
  ...over,
});

const rec = (over: Partial<RecurringRow>): RecurringRow => ({
  payee: "Spotify",
  avgAmount: -10,
  currency: "USD",
  avgAmountDisplay: -10,
  frequency: "monthly",
  count: 6,
  lastDate: "2026-09-03",
  nextDate: "2026-10-03",
  accountId: 1,
  categoryId: null,
  ...over,
});

describe("subscription totals", () => {
  it("sums ACTIVE subscriptions as monthly equivalents in the display currency", () => {
    const subs = [
      sub({ id: 1, amount: 15, displayAmount: 15 }),
      sub({ id: 2, name: "Domain", amount: 120, displayAmount: 120, frequency: "annual", nextDate: "2027-03-01" }),
      // Native EUR, server-converted to 66 in the display currency: totals use 66.
      sub({ id: 3, name: "Insurance", amount: 60, currency: "EUR", displayAmount: 66, frequency: "semiannual", nextDate: "2026-10-20" }),
      sub({ id: 4, name: "Paused", status: "paused", amount: 999, displayAmount: 999 }),
    ];
    const t = subscriptionTotals(subs, "2026-10-01", "2026-10-31");
    expect(t.activeCount).toBe(3);
    expect(t.monthly).toBeCloseTo(15 + 10 + 11, 10);
    expect(t.annual).toBeCloseTo((15 + 10 + 11) * 12, 10);
    // Due in Oct: Netflix (10th) + Insurance (20th); the domain renews in March.
    expect(t.dueSoonCount).toBe(2);
    expect(t.dueSoonAmount).toBe(15 + 66);
  });

  it("counts a weekly bill once per occurrence in the window", () => {
    const t = subscriptionTotals([sub({ frequency: "weekly", nextDate: "2026-10-02", displayAmount: 5 })], "2026-10-01", "2026-10-31");
    expect(t.dueSoonCount).toBe(5); // Oct 2, 9, 16, 23, 30
    expect(t.dueSoonAmount).toBe(25);
  });
});

describe("detected suggestions", () => {
  it("offers untracked recurring EXPENSES only, biggest monthly cost first", () => {
    const subs = [sub({ name: "Netflix" })];
    const recurring = [
      rec({ payee: "netflix " }), // already tracked (case/space-insensitive)
      rec({ payee: "Salary", avgAmount: 3000, avgAmountDisplay: 3000 }), // income
      rec({ payee: "Gym", avgAmount: -40, avgAmountDisplay: -40 }),
      rec({ payee: "Car insurance", avgAmount: -600, avgAmountDisplay: -600, frequency: "semiannual" }), // 100/mo
    ];
    expect(detectedSuggestions(recurring, subs).map((r) => r.payee)).toEqual(["Car insurance", "Gym"]);
  });

  it("does not re-suggest a payee the user tracked and then cancelled", () => {
    const subs = [sub({ name: "Gym", status: "cancelled" })];
    expect(detectedSuggestions([rec({ payee: "Gym" })], subs)).toEqual([]);
  });
});

describe("schedule events (calendar view)", () => {
  it("projects active subscriptions and untracked detected series into the month", () => {
    const subs = [
      sub({ id: 7, name: "Netflix", nextDate: "2026-10-10" }),
      sub({ id: 8, name: "Old gym", status: "cancelled", nextDate: "2026-10-05" }),
    ];
    const recurring = [
      rec({ payee: "Netflix" }), // tracked → not duplicated
      rec({ payee: "Salary", avgAmount: 2500, avgAmountDisplay: 2500, frequency: "biweekly", nextDate: "2026-10-09" }),
      rec({ payee: "Water", avgAmount: -90, avgAmountDisplay: -90, frequency: "quarterly", nextDate: "2026-11-15" }),
    ];
    const events = buildScheduleEvents(subs, recurring, "2026-10-01", "2026-10-31");
    expect(events.map((e) => `${e.date} ${e.name} ${e.type}/${e.source}`)).toEqual([
      "2026-10-09 Salary income/detected",
      "2026-10-10 Netflix bill/subscription",
      "2026-10-23 Salary income/detected",
    ]);
    expect(events.find((e) => e.name === "Netflix")?.subscriptionId).toBe(7);
  });

  it("shows a stale stored date on its real cadence", () => {
    // next_date last saved in February; October still gets the 14th.
    const events = buildScheduleEvents([sub({ nextDate: "2026-02-14" })], [], "2026-10-01", "2026-10-31");
    expect(events.map((e) => e.date)).toEqual(["2026-10-14"]);
  });

  it("effectiveNextDate rolls active rows forward only", () => {
    expect(effectiveNextDate(sub({ nextDate: "2026-02-14" }), "2026-10-01")).toBe("2026-10-14");
    expect(effectiveNextDate(sub({ nextDate: "2026-02-14", status: "paused" }), "2026-10-01")).toBe("2026-02-14");
  });
});
