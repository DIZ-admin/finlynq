import { describe, it, expect } from "vitest";
import {
  addDays,
  annualEquivalent,
  daysBetween,
  frequencyLabel,
  frequencyOrMonthly,
  monthlyEquivalent,
  nextOnOrAfter,
  normalizeFrequency,
  occurrenceAt,
  occurrencesBetween,
  rollForwardNextDate,
  SUBSCRIPTION_FREQUENCIES,
} from "@/lib/subscriptions/schedule";

describe("subscription schedule — frequencies", () => {
  it("offers weekly through annual, including every-2-weeks and semi-annual", () => {
    expect(SUBSCRIPTION_FREQUENCIES).toEqual(["weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"]);
  });

  it("normalizes legacy and alternate spellings", () => {
    expect(normalizeFrequency("yearly")).toBe("annual");
    expect(normalizeFrequency(" Annually ")).toBe("annual");
    expect(normalizeFrequency("semi-annual")).toBe("semiannual");
    expect(normalizeFrequency("half-yearly")).toBe("semiannual");
    expect(normalizeFrequency("fortnightly")).toBe("biweekly");
    expect(normalizeFrequency("bi-weekly")).toBe("biweekly");
    expect(normalizeFrequency("hourly")).toBeNull();
    expect(normalizeFrequency(null)).toBeNull();
    expect(frequencyOrMonthly("whatever")).toBe("monthly");
    expect(frequencyLabel("semiannual")).toBe("Semi-annual");
  });

  it("prices every cadence as a monthly / annual equivalent", () => {
    expect(monthlyEquivalent(120, "annual")).toBe(10);
    expect(monthlyEquivalent(120, "yearly")).toBe(10); // MCP-written spelling
    expect(monthlyEquivalent(60, "semiannual")).toBe(10);
    expect(monthlyEquivalent(30, "quarterly")).toBe(10);
    expect(monthlyEquivalent(10, "monthly")).toBe(10);
    expect(monthlyEquivalent(12, "weekly")).toBeCloseTo(52, 10);
    expect(monthlyEquivalent(12, "biweekly")).toBeCloseTo(26, 10);
    expect(annualEquivalent(10, "monthly")).toBe(120);
    expect(annualEquivalent(50, "semiannual")).toBe(100);
  });
});

describe("subscription schedule — dates", () => {
  it("clamps month-end anchors and re-expands (no Jan 31 → Mar 3 overflow, no drift)", () => {
    expect(occurrenceAt("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(occurrenceAt("2026-01-31", "monthly", 2)).toBe("2026-03-31");
    expect(occurrenceAt("2024-01-31", "monthly", 1)).toBe("2024-02-29");
    expect(occurrenceAt("2026-08-31", "semiannual", 1)).toBe("2027-02-28");
    expect(occurrenceAt("2024-02-29", "annual", 1)).toBe("2025-02-28");
    expect(occurrenceAt("2024-02-29", "annual", 4)).toBe("2028-02-29");
  });

  it("projects backwards as well as forwards", () => {
    expect(occurrenceAt("2026-03-15", "monthly", -2)).toBe("2026-01-15");
    expect(occurrenceAt("2026-03-15", "quarterly", -1)).toBe("2025-12-15");
    expect(occurrenceAt("2026-03-15", "weekly", -1)).toBe("2026-03-08");
    expect(occurrenceAt("2026-03-15", "biweekly", 2)).toBe("2026-04-12");
  });

  it("finds the first occurrence on/after a date", () => {
    expect(nextOnOrAfter("2026-01-15", "monthly", "2026-10-01")).toBe("2026-10-15");
    expect(nextOnOrAfter("2026-01-15", "monthly", "2026-10-15")).toBe("2026-10-15");
    expect(nextOnOrAfter("2026-01-15", "monthly", "2026-10-16")).toBe("2026-11-15");
    expect(nextOnOrAfter("2025-03-01", "semiannual", "2026-10-01")).toBe("2027-03-01");
    expect(nextOnOrAfter("2026-09-28", "weekly", "2026-10-01")).toBe("2026-10-05");
    // A future anchor projects backwards too.
    expect(nextOnOrAfter("2026-12-01", "monthly", "2026-10-01")).toBe("2026-10-01");
  });

  it("rolls a passed next-payment date forward and leaves current ones alone", () => {
    expect(rollForwardNextDate("2026-02-10", "monthly", "2026-10-01")).toBe("2026-10-10");
    expect(rollForwardNextDate("2025-06-30", "annual", "2026-10-01")).toBe("2027-06-30");
    expect(rollForwardNextDate("2026-10-20", "monthly", "2026-10-01")).toBe("2026-10-20");
    expect(rollForwardNextDate("2026-10-01", "monthly", "2026-10-01")).toBe("2026-10-01");
    expect(rollForwardNextDate(null, "monthly", "2026-10-01")).toBeNull();
    expect(rollForwardNextDate("not-a-date", "monthly", "2026-10-01")).toBeNull();
  });

  it("lists every occurrence inside a range, inclusive", () => {
    expect(occurrencesBetween("2026-01-05", "weekly", "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26",
    ]);
    expect(occurrencesBetween("2026-01-31", "monthly", "2026-02-01", "2026-04-30")).toEqual([
      "2026-02-28", "2026-03-31", "2026-04-30",
    ]);
    expect(occurrencesBetween("2026-03-01", "annual", "2026-10-01", "2026-10-31")).toEqual([]);
    expect(occurrencesBetween("2026-03-01", "monthly", "2026-10-31", "2026-10-01")).toEqual([]);
  });

  it("does date arithmetic in UTC", () => {
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST change day
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26"); // EU DST change day
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBe(-30);
  });
});
