/**
 * FINLYNQ-84 — Transaction rules v2: multi-condition matching + richer actions.
 *
 * Zod discriminated unions for the new `transaction_rules` shape. Replaces the
 * legacy flat columns (`matchField`, `matchType`, `matchValue`, `assignCategoryId`,
 * `assignTags`, `renameTo`) with JSONB `conditions` (AND-only group of typed
 * conditions) + JSONB `actions` (typed action array).
 *
 * Load-bearing invariants enforced here:
 * - Condition composition is AND-only (`ConditionGroup.all[]`). No nested OR
 *   in v2; deferred to a future iteration if real-world rules demand it.
 * - `set_portfolio_holding` is assign-existing-id-only (no auto-create branch).
 *   Sidesteps the `holding_accounts` dual-write invariant — that's the job of
 *   `add_portfolio_holding`.
 * - `create_transfer.linkId` is NOT an action-config field. `link_id` is
 *   server-generated only (minted inside `createTransferPair`). The action
 *   carries only the destination account.
 *
 * See plan: pf-app/plan/finlynq-84-rules-v2.md
 * See living doc (post-ship): pf-app/docs/transaction-rules-v2.md
 */
import { z } from "zod";
import { StringOp } from "@/lib/schemas/rule-primitives";
const AmountOp = z.enum(["gt", "lt", "eq"]);
const SetOp = z.enum(["is", "is_not"]);

const StringCondition = z.object({
  field: z.enum(["payee", "note", "tags"]),
  op: StringOp,
  value: z.string().min(1).max(500),
});

const AmountConditionSingle = z.object({
  field: z.literal("amount"),
  op: AmountOp,
  value: z.number(),
});

const AmountConditionBetween = z.object({
  field: z.literal("amount"),
  op: z.literal("between"),
  min: z.number(),
  max: z.number(),
});

const AccountCondition = z.object({
  field: z.literal("account"),
  op: SetOp,
  accountId: z.number().int().positive(),
});

const CurrencyCondition = z.object({
  field: z.literal("currency"),
  op: SetOp,
  value: z.string().length(3).toUpperCase(),
});

const DateWeekdayCondition = z.object({
  field: z.literal("date"),
  op: z.literal("weekday"),
  weekday: z.number().int().min(0).max(6), // 0=Sun..6=Sat (UTC)
});

const DateDayOfMonthCondition = z.object({
  field: z.literal("date"),
  op: z.literal("day_of_month"),
  day: z.number().int().min(1).max(31),
});

const DateBetweenCondition = z.object({
  field: z.literal("date"),
  op: z.literal("between"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// FINLYNQ-84 cycle 2 (2026-05-21): Zod v4 rejects discriminatedUnion when
// two branches share a discriminator value. The original schema had
// `field: "amount"` ×2 (single + between) and `field: "date"` ×3 (weekday +
// day_of_month + between), which threw at union-build time and broke every
// .safeParse() on the rule endpoints. Switched to top-level z.union so the
// 8 leaf schemas can be tried in order. Tradeoff: error messages on parse
// failure become "no schema matched" instead of "field=amount but op=foo
// invalid"; existing tests don't depend on the Zod error fingerprint
// (they assert HTTP status codes + body presence), so the trade is fine.
export const Condition = z.union([
  StringCondition,
  AmountConditionSingle,
  AmountConditionBetween,
  AccountCondition,
  CurrencyCondition,
  DateWeekdayCondition,
  DateDayOfMonthCondition,
  DateBetweenCondition,
]);
export type Condition = z.infer<typeof Condition>;

export const ConditionGroup = z.object({
  all: z.array(Condition).min(1).max(20),
});
export type ConditionGroup = z.infer<typeof ConditionGroup>;

export const Action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_category"), categoryId: z.number().int().positive() }),
  z.object({ kind: z.literal("set_tags"), tags: z.string().max(500) }),
  z.object({ kind: z.literal("rename_payee"), to: z.string().min(1).max(500) }),
  z.object({ kind: z.literal("set_account"), accountId: z.number().int().positive() }),
  z.object({ kind: z.literal("set_entered_currency"), currency: z.string().length(3).toUpperCase() }),
  z.object({ kind: z.literal("set_portfolio_holding"), holdingId: z.number().int().positive() }),
  z.object({ kind: z.literal("create_transfer"), destAccountId: z.number().int().positive() }),
]);
export type Action = z.infer<typeof Action>;

export const Rule = z.object({
  name: z.string().min(1).max(120),
  conditions: ConditionGroup,
  actions: z.array(Action).min(1).max(10),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type Rule = z.infer<typeof Rule>;

// ─── Typed factory maps (FINLYNQ-114) ────────────────────────────────────────
//
// When the rule editor switches a condition's `field` or an action's `kind`,
// it must reset the row to a fully-typed default for the NEW variant (not just
// patch the discriminator). Modeling these as typed factory maps gives each
// default a precise member type — a wrong field on a variant is now a compile
// error here, instead of being hidden behind `as unknown as Partial<…>` at the
// 12 call sites in `rule-editor-dialog.tsx`. The objects produced are
// byte-identical to what those casts produced, so the wire shape is unchanged.

/** Discriminate a Condition union member by its `field` literal. */
export type ConditionField = Condition["field"];

/** Discriminate an Action union member by its `kind` literal. */
export type ActionKind = Action["kind"];

/**
 * Default `Condition` for a freshly-selected field. The `amount` and `date`
 * fields have multiple op-variants in the union; the editor seeds the first
 * variant (single `amount` / `weekday` `date`) and the user refines `op` after.
 */
export const CONDITION_DEFAULTS: {
  payee: () => Extract<Condition, { field: "payee" | "note" | "tags" }>;
  note: () => Extract<Condition, { field: "payee" | "note" | "tags" }>;
  tags: () => Extract<Condition, { field: "payee" | "note" | "tags" }>;
  amount: () => Extract<Condition, { field: "amount" }>;
  account: (accountId: number) => Extract<Condition, { field: "account" }>;
  currency: () => Extract<Condition, { field: "currency" }>;
  date: () => Extract<Condition, { field: "date" }>;
} = {
  payee: () => ({ field: "payee", op: "contains", value: "" }),
  note: () => ({ field: "note", op: "contains", value: "" }),
  tags: () => ({ field: "tags", op: "contains", value: "" }),
  amount: () => ({ field: "amount", op: "gt", value: 0 }),
  account: (accountId: number) => ({ field: "account", op: "is", accountId }),
  currency: () => ({ field: "currency", op: "is", value: "CAD" }),
  date: () => ({ field: "date", op: "weekday", weekday: 1 }),
};

/** Build a fully-typed default `Condition` when the editor switches `field`. */
export function defaultConditionForField(
  field: ConditionField,
  accountId = 0,
): Condition {
  return field === "account"
    ? CONDITION_DEFAULTS.account(accountId)
    : CONDITION_DEFAULTS[field]();
}

/**
 * Default `Action` for a freshly-selected kind. Each entry returns the exact
 * discriminated-union member, so a typo in the config object fails to compile.
 */
export const ACTION_DEFAULTS: {
  [K in ActionKind]: (id: number) => Extract<Action, { kind: K }>;
} = {
  set_category: (categoryId) => ({ kind: "set_category", categoryId }),
  set_tags: () => ({ kind: "set_tags", tags: "" }),
  rename_payee: () => ({ kind: "rename_payee", to: "" }),
  set_account: (accountId) => ({ kind: "set_account", accountId }),
  set_entered_currency: () => ({ kind: "set_entered_currency", currency: "USD" }),
  set_portfolio_holding: (holdingId) => ({ kind: "set_portfolio_holding", holdingId }),
  create_transfer: (destAccountId) => ({ kind: "create_transfer", destAccountId }),
};

/** Build a fully-typed default `Action` when the editor switches `kind`. */
export function defaultActionForKind(kind: ActionKind, id = 0): Action {
  return ACTION_DEFAULTS[kind](id);
}

/**
 * Helper — extract every FK id referenced by an action array, so callers
 * can drive `verifyOwnership` in one batch instead of N+1 queries.
 *
 * Used by REST POST/PUT /api/rules and the staged-import inline create-rule
 * endpoint. Returns deduped arrays per FK kind.
 */
export function collectActionFKs(actions: Action[]): {
  categoryIds: number[];
  accountIds: number[];
  holdingIds: number[];
} {
  const categoryIds = new Set<number>();
  const accountIds = new Set<number>();
  const holdingIds = new Set<number>();
  for (const a of actions) {
    switch (a.kind) {
      case "set_category":
        categoryIds.add(a.categoryId);
        break;
      case "set_account":
        accountIds.add(a.accountId);
        break;
      case "set_portfolio_holding":
        holdingIds.add(a.holdingId);
        break;
      case "create_transfer":
        accountIds.add(a.destAccountId);
        break;
      default:
        break;
    }
  }
  return {
    categoryIds: [...categoryIds],
    accountIds: [...accountIds],
    holdingIds: [...holdingIds],
  };
}

/**
 * Action kinds that mutate ROWS OTHER THAN the matched transaction (or create
 * new rows). These must NOT be applied by paths that only have a single
 * committed row in scope (e.g. `apply_rules_to_uncategorized`) — silent
 * balance corruption risk otherwise. Approve-time paths can run them.
 */
export const SIDE_EFFECT_ACTION_KINDS = new Set(["set_account", "create_transfer"]);

export function actionHasSideEffects(action: Action): boolean {
  return SIDE_EFFECT_ACTION_KINDS.has(action.kind);
}

export function ruleHasSideEffects(actions: Action[]): boolean {
  return actions.some(actionHasSideEffects);
}
