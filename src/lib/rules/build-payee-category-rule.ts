/**
 * FINLYNQ-125 — build the `POST /api/rules` payload for the inline
 * "Also create a rule" affordance in `TransactionDialog` (reconcile/import).
 *
 * Given a payee + a chosen category id, produces a server-valid rule payload
 * of the shape `payee contains "<payee>" → set category <categoryId>`. The
 * caller POSTs this verbatim to `/api/rules` (which Zod-validates, runs
 * `verifyOwnership` on the FK, and encrypts the sensitive free-text with the
 * session DEK — the client only ever sends plaintext).
 *
 * Load-bearing (CLAUDE.md "Rule Condition/Action construction", FINLYNQ-114):
 * the condition + action are built through the typed factory maps in
 * `@/lib/rules/schema` (`defaultConditionForField("payee")` /
 * `defaultActionForKind("set_category", categoryId)`), NOT hand-rolled with
 * `{…} as unknown as Condition|Action`. The factory output is the exact
 * discriminated-union member, so a wrong field/kind is a compile error.
 *
 * Naming: `Match "<payee.slice(0,100)>"` — the surround adds 8 chars, so a
 * 100-char payee slice stays well under the 120-char `transaction_rules.name`
 * cap (mirrors the precedent in `staging/unresolved-categories-banner.tsx`).
 * The condition `value` carries the FULL trimmed payee (the server caps it at
 * 500). This intentionally diverges from the sliced display name so the rule
 * still matches the entire payee substring on future imports.
 */
import {
  CONDITION_DEFAULTS,
  defaultActionForKind,
  type Condition,
  type Action,
} from "@/lib/rules/schema";

export interface PayeeCategoryRulePayload {
  name: string;
  conditions: { all: Condition[] };
  actions: Action[];
  priority: number;
  isActive: boolean;
}

/**
 * Build the `POST /api/rules` payload for a one-click
 * `payee contains "<payee>" → set category <categoryId>` rule.
 *
 * @param payee      the raw payee string (will be trimmed)
 * @param categoryId the chosen category's id (positive integer)
 */
export function buildPayeeCategoryRule(
  payee: string,
  categoryId: number,
): PayeeCategoryRulePayload {
  const trimmed = (payee ?? "").trim();

  // FINLYNQ-114 typed factories — never hand-roll the union member.
  // `CONDITION_DEFAULTS.payee()` returns the precise string-condition member
  // (`{field:"payee", op:"contains", value:""}`) — not the wide `Condition`
  // union — so the `value` spread below stays a string and type-narrows.
  const condition = CONDITION_DEFAULTS.payee();
  const conditionWithValue: Condition = { ...condition, value: trimmed };

  const action = defaultActionForKind("set_category", categoryId);

  return {
    name: `Match "${trimmed.slice(0, 100)}"`,
    conditions: { all: [conditionWithValue] },
    actions: [action],
    priority: 0,
    isActive: true,
  };
}
