import type { SubscriptionRow } from "@/lib/subscriptions/calendar-events";

/** GET /api/subscriptions row as the page uses it. */
export type Subscription = SubscriptionRow & {
  categoryId: number | null;
  categoryName: string | null;
  accountId: number | null;
  accountName: string | null;
  cancelReminderDate: string | null;
  notes: string | null;
  displayCurrency?: string;
};
