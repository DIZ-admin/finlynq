# Transaction-canonicalization backfill pipeline

**Status:** Shipped to dev across commits `e3487de` → `15ac794` (2026-06-02 through 2026-05-24). Four rounds of iteration are live on `dev` (V1 + review fixes + Phases 0–4 + cash_dividend correction). See "Iteration history" below for the chronological version.

**Migrations** (run in deploy.sh order):
- [20260602_backfill_pipeline.sql](../../scripts/migrations/20260602_backfill_pipeline.sql) — V1 schema (runs, proposals, audit)
- [20260603_opening_balance_kind.sql](../../scripts/migrations/20260603_opening_balance_kind.sql) — extends `transactions_kind_check` with `dividend`, `interest`, `opening_balance`; re-tags earliest-per-holding rows
- [20260604_backfill_dividend_reinvest.sql](../../scripts/migrations/20260604_backfill_dividend_reinvest.sql) — `chosen_holding_id` + `candidate_holding_ids` on `backfill_proposals`
- [20260605_backfill_missing_lot.sql](../../scripts/migrations/20260605_backfill_missing_lot.sql) — `lot_action` on `backfill_proposals`
- [20260607_dividend_variant.sql](../../scripts/migrations/20260607_dividend_variant.sql) — `dividend_variant` on `backfill_proposals`

**Key modules:**
- Pure planner: [src/lib/portfolio/backfill/planner.ts](../../src/lib/portfolio/backfill/planner.ts) (Passes 0, 1, 1.5, 1.6, 2, 3)
- Types:        [src/lib/portfolio/backfill/types.ts](../../src/lib/portfolio/backfill/types.ts) (`PAIRLESS_CANONICAL_KINDS`, `isAlreadyCanonical`, `ProposalKind`)
- Synthesize:   [src/lib/portfolio/backfill/synthesize.ts](../../src/lib/portfolio/backfill/synthesize.ts)
- Dependencies: [src/lib/portfolio/backfill/dependencies.ts](../../src/lib/portfolio/backfill/dependencies.ts)
- Apply + Undo + Snapshot loader: [src/lib/portfolio/backfill/apply.ts](../../src/lib/portfolio/backfill/apply.ts)
- UI:           [src/app/(app)/settings/backfill/page.tsx](../../src/app/(app)/settings/backfill/page.tsx) (wizard + symbol fix card) + [[runId]/page.tsx](../../src/app/(app)/settings/backfill/[runId]/page.tsx) (review with variant + holding pickers)
- CLI:          [scripts/backfill-cli.ts](../../scripts/backfill-cli.ts)
- Coverage:     [src/app/api/settings/backfill/coverage/route.ts](../../src/app/api/settings/backfill/coverage/route.ts) (canonical + missing-lots metrics)
- Symbol fix:   [src/app/api/settings/backfill/fix-cash-sleeve-symbols/route.ts](../../src/app/api/settings/backfill/fix-cash-sleeve-symbols/route.ts)
- Tests:        [tests/backfill-planner.test.ts](../../tests/backfill-planner.test.ts) (24 scenarios)

## Why

The Phase 5c cash-sleeve lot tracking shipped 2026-05-26 only writes lots for transactions inserted *through* the live engine (operations.ts hooks). Anything imported from a competitor (Wealthfolio, Ghostfolio, Mint) or imported pre-Phase-2 carries `kind=NULL`, no `trade_link_id`, and no Phase 2 canonical pair shape. The Realized Gains page is empty for those rows, and lot inventory is wrong.

This is also load-bearing for ongoing migrations: when a user imports a competitor CSV via a new connector, the rows land in `transactions` with NULL kind and no canonical pairing. The same pipeline reshapes them into Phase 2 canonical pairs so the rest of the system works.

## Pipeline (four stages, hard checkpoints)

```
PLAN          → reads transactions/holdings → writes backfill_runs + backfill_proposals
REVIEW        → user toggles status per proposal in /settings/backfill/[runId] two-pane UI
APPLY         → per-proposal DB tx: UPDATE transactions in place, replay live lot hooks,
                snapshot displaced state to backfill_audit
UNDO (≤7d UX) → restore from backfill_audit, refuses with 409 if downstream closures exist
                (mirrors cascadeDeleteForReplace's guard at _helpers.ts:77-190)
```

## Stitching engine — per-row detectors

The planner walks `transactions` in scope, then runs six ordered passes (first match per row wins):

| Pass | Predicate | Proposal kind | Confidence |
|---|---|---|---|
| **0** missing-lot | canonical row + qty≠0 + non-cash holding + no `holding_lots.open_tx_id` (or `closures.close_tx_id`) | `missing_lot` w/ `lotAction='open'` or `'close'` | HIGH |
| **1** dividend (qty=0) | stock holding + qty=0 + amount>0 + category=Dividends | `dividend` | HIGH |
| **1.5** combined cash leg | one cash row matches the sum of ≥2 same-date stock legs | `orphan_stock_leg` (refused: combined_cash_leg) | REFUSED |
| **1.6** DRIP / cash-div on stock | category=Dividends + qty>0 + amount>0 + qty≈amount | `dividend_reinvestment` w/ holding picker + variant radio | MEDIUM |
| **2** buy / sell / drift | stock holding + qty≠0; matches cash leg by magnitude → buy_pair / sell_pair | `buy_pair` / `sell_pair` / `drift` / `orphan_stock_leg` / `opening_balance` | varies |
| **3** safety net | every remaining unconsumed candidate | `orphan_stock_leg` (refused: unmatched_candidate) | REFUSED |

Pass 0 operates on **already-canonical** rows (the rest operate on non-canonical candidates). Pass 3 is a hard symmetry guard: coverage-pending count and planner-proposal count cannot diverge silently.

**Refusal cases** (`proposal.confidence='refused'`, not auto-applyable):
- **S1 cross-currency** — stock-leg currency != cash-leg currency. The user must record an FX Conversion first; V1 doesn't synthesize FX rates.
- **S2 combined cash leg** — one cash row matches the sum of multiple stock legs. The user must split it manually in /transactions.
- **S4 drift** — same-date+same-account near-magnitude match but `|stock| - |cash| > $0.01`. Surfaces with TWO action variants:
  - Variant A `separate_fee_row`: book a Brokerage Fee row on the cash sleeve to absorb the drift. Preserves audit trail.
  - Variant B `absorb_into_cost`: raise the stock-leg amount to match the cash-leg. Cleaner ledger but changes cost basis.

  The user picks per proposal; `variant_choice=NULL` means "still needs user input" and the apply route refuses.
- **Ambiguous candidates** — multiple cash-sleeve rows match exact magnitude. User must pick the right pair manually.
- **No cash sleeve to synthesize into** (synthesize mode + missing sleeve) — the account doesn't have a cash sleeve in the target currency; user must create one first.
- **`unmatched_candidate`** — Pass 3 fallback for any non-canonical row that none of Passes 1/1.5/2 handled (e.g., qty=0 with categoryId ≠ user's Dividends id, or cash-holding row with kind set but no pair). Surfaces to the user instead of being silently dropped.

## Proposal kinds with user choice (V1 + Phase 4)

Two proposal classes require user input on the right pane before they can be applied. Both follow the same pattern as drift's `variant_choice`: a nullable column on `backfill_proposals`, planner pre-fills a sensible default, apply route refuses with a code if NULL.

### `opening_balance` (V1 + Phase 0 fix)
First transaction for a (holding, account) with qty>0 and no cash pair — almost certainly a carry-in from another platform. The apply records the row as a lot at the entered cost basis with NO cash-side impact and stamps the distinct `kind='opening_balance'` literal so the strict canonicalization predicate counts it as pair-less canonical.

### `dividend_reinvestment` (Phase 2 + Phase 4b)
Pattern: `category=Dividends`, `qty>0`, `amount>0`, `|qty - amount| / max(qty, amount) < 0.05`. The qty=$amount shape can mean either a cash dividend (qty stored quirkily) or a true share reinvestment at $1/share. The proposal carries two pickers:

**Holding picker** (`chosen_holding_id`): which underlying stock did this dividend come from? Candidates = every non-cash holding in the row's account. Defaults to the planner's first suggestion. Refusal code: `holding_choice_missing`.

**Variant radio** (`dividend_variant`): how should it apply?

| Variant | Apply behavior |
|---|---|
| `cash_dividend` | Move row to the matching cash sleeve `(accountId, currency)`; set `related_holding_id` = chosen stock; `kind='portfolio_income'`; **preserve** qty (it represents cash units on the sleeve). The dividend lands where the cash actually went; reports attribute it to the picked stock. If no cash sleeve exists → apply throws and surfaces "create one first". |
| `drip` | Set `portfolio_holding_id` = chosen stock; `kind='dividend'`; preserve qty (interpreted as share count). Lot replay opens at `costPerShare=amount/qty`. |

Planner default:
- Row already on a non-cash stock holding → suggests `cash_dividend` (typical VUN.TO-style case)
- Row on a cash sleeve or no holding → suggests `drip` (typical crypto/sub-dollar case)

Refusal code: `dividend_variant_missing`.

### `missing_lot` (Phase 3)
Canonical buy/sell row on a non-cash stock holding with no matching `holding_lots.open_tx_id` (qty>0) or `holding_lot_closures.close_tx_id` (qty<0). Apply runs `applyLotEffectsForTx` directly on the row — no UPDATE-in-place, just retroactive lot creation. Confidence HIGH (mechanical fix). Stale guard: refuses with `lot_already_exists` if a lot/closure has been created since planning. `lot_action` carries `'open' | 'close' | 'transfer'`.

**Orphan handling** is gated by the per-run preflight mode (S8):
- `refuse_orphans`: orphan stock legs surface as `orphan_stock_leg` proposals at confidence `low`. The user fixes them manually.
- `synthesize_orphans`: each orphan gets a fabricated paired cash leg tagged `source='backfill_synth'`. Bank-side balance diverges by exactly the synthesized amount — this is the expected tradeoff when the brokerage's cash isn't tracked in Finlynq.

## Apply path

Per proposal, single DB transaction:

1. **Snapshot displaced rows** → INSERT into `backfill_audit` (full row JSON, keyed by proposal_id + tx_id).
2. **UPDATE-in-place** the existing `transactions` rows. Only `amount`, `kind`, `trade_link_id`, `link_id` are patched; `updated_at = NOW()` always (audit-trio invariant). `id`, `created_at`, `import_hash`, `bank_transaction_id`, `source`, `payee_ct`, `name_lookup` are preserved — load-bearing per [invariants.md](invariants.md).
3. **INSERT synthesized rows** (synthesize-mode cash legs, drift variant A fee rows) tagged `source='backfill_synth'`.
4. **Replay live lot hooks** by calling `applyLotEffectsForTx(row, ctx)` from [src/lib/portfolio/lots/write-hooks.ts:904](../../src/lib/portfolio/lots/write-hooks.ts) for every replaced + synthesized row. This satisfies the audit-invariants script's invariant #8 (portfolio-ops kinds only originate from the canonical lot module) — the backfill imports from `@/lib/portfolio/lots/write-hooks` rather than writing raw `kind: 'buy'` literals.
5. **`invalidateUser(userId)`** for the MCP per-user tx cache (MCP cache invariant from CLAUDE.md).

## Dependency graph

Computed at plan time by [dependencies.ts](../../src/lib/portfolio/backfill/dependencies.ts): a Sell proposal carries `depends_on_proposal_ids[]` listing every Buy proposal in the same `(holding, account)` whose lots it FIFO-closes from.

Enforcement:
- **UI**: checking a dependent without its parent auto-checks the parent + shows a callout.
- **Apply route**: server-side topological sort (Kahn's algorithm) before iterating proposals. Refuses with `dependencies_unapplied` if any parent is not yet `applied`.

## Undo path

`POST /api/settings/backfill/[runId]/undo/[proposalId]`:

1. Verify proposal belongs to this run + user, status='applied'.
2. **Check for child proposals** already applied — those depend on this one's lots; undoing would break them. Returns `409 { code: 'dependents_applied', blockingProposalIds[] }`.
3. **Check for downstream closures** via `canEditPortfolioRow(userId, txId)` from [operations.ts:1297](../../src/lib/portfolio/operations.ts) — same predicate as the live edit guard. Walks the row's lots, queries `holding_lot_closures` for any matching `lotId`. Returns `409 { code: 'portfolio_edit_blocked', blockingClosureTxIds[] }`.
4. **Reverse lots** via `reverseLotsForDeleteHook(userId, txId)` for each tx in the proposal's scope (existing + synthesized).
5. **Restore** existing rows from `backfill_audit.before_json` (UPDATE-in-place).
6. **DELETE** any `source='backfill_synth'` rows associated with this proposal.
7. Mark `proposal.status='undone'`, `invalidateUser`.

## Idempotency (S5)

Re-running the planner after apply returns `[]` — the `isAlreadyCanonical(tx)` filter in [types.ts](../../src/lib/portfolio/backfill/types.ts) skips rows where `kind IS NOT NULL AND (kind IN PAIRLESS_CANONICAL_KINDS OR tradeLinkId IS NOT NULL OR linkId IS NOT NULL)`. The `PAIRLESS_CANONICAL_KINDS` set (`dividend`, `interest`, `portfolio_income`, `portfolio_expense`, `opening_balance`) is **shared** between this predicate and the coverage endpoint's SQL — importing one constant from the other so the two surfaces cannot drift.

Partial-applied runs work too — only proposals with `status='approved'` get applied, leaving the rest in `pending` for a future review pass.

## Coverage dashboard

`GET /api/settings/backfill/coverage` returns per-investment-account:
- `total` — count of transactions in the account
- `canonical` — count matching the strict predicate above
- `pending` — `total - canonical`
- `pendingPct` — rounded percentage
- `missingLots` — count of canonical buy/sell rows whose lot/closure is missing (Phase 3 metric)

Plus top-level aggregates: `totalTxs`, `canonicalTxs`, `nonCanonicalTxs`, `canonicalPct`, `missingLots`. The wizard at `/settings/backfill` reads this on load.

## Cash-sleeve symbol hygiene (Phase 4a)

`POST /api/settings/backfill/fix-cash-sleeve-symbols` (Step 0 in the wizard). Finds every `portfolio_holdings` row where `is_cash=true` AND `symbol_ct IS NULL`, sets `symbol_ct = encryptName(dek, currency).ct` + `symbol_lookup = encryptName(dek, currency).lookup`. Idempotent. Returns `{ fixed, total }`. Used to populate Symbol = currency code (e.g., `CAD` for a CAD cash sleeve) before any backfill run so the holdings list isn't visually ambiguous.

## Kind column on `/transactions` (Phase 0)

The Kind column in [transactions/page.tsx](../../src/app/(app)/transactions/page.tsx) renders the row's `kind` as a colored pill. Border style mirrors the coverage SQL predicate:
- **Solid border** = row is coverage-canonical (PAIRLESS kind OR `trade_link_id` OR `link_id`)
- **Dashed border** = `kind` set but row is still coverage-pending (broken pair, manual fix needed)

Hover title surfaces the explanation. This lets users see at a glance which rows the backfill dashboard still counts as pending without leaving the transactions page.

## Schema invariants for future contributors

When extending the backfill pipeline:

- **NEVER use DELETE+INSERT on existing rows** — UPDATE-in-place is load-bearing. Synthesis is the only path that creates net-new rows, and only with `source='backfill_synth'`.
- **NEVER write raw `kind: 'buy' | 'sell' | ...` literals** in apply.ts — always go through `applyLotEffectsForTx`. The audit-invariants script's #8 invariant will catch deviation.
- **NEVER skip `invalidateUser(userId)`** after a successful apply or undo — the MCP per-user tx cache will serve stale data.
- **Adding a new proposal kind** requires: (1) the planner detector in planner.ts, (2) test fixtures in tests/backfill-planner.test.ts, (3) any new replacement-payload shape documented in this file.
- **Adding a new refusal reason** requires: only updating the planner; the apply route reads `confidence='refused'` and refuses without case-by-case logic.

## Iteration history (resolved)

The pipeline shipped across four rounds. Earlier round's "Known issues" are all resolved — kept here as a record of what each round addressed.

### Round 1 — V1 pipeline (`e3487de` → `92ed3a6`, 2026-06-02)
Planner + apply/undo + UI + 13 stress scenarios. Three bugs surfaced from manual review on the demo user (1,280 investment transactions across 10 accounts):
1. Wizard "Specific accounts" picker showed "No investment accounts found" — read `a.accountId` while `/api/accounts` returns `a.id`.
2. Coverage said 312 pending but planner returned 0 proposals — `isAlreadyCanonical` (loose: "any non-null kind") and the coverage SQL (strict: "kind + pair-less OR pair link") had diverged.
3. Kind column tagged all 4 Gold Coins rows as `buy` but coverage said only 76% canonical — same root cause as #2.

### Round 2 — Resolution commits (`e1c37a9` → `bb066c9`, 2026-05-24)
- `e1c37a9` — Bug 1 fix (read `a.id`); Bug 2/3 fix (introduce `kind='opening_balance'` literal so the strict predicate can return; planner emits the new literal; coverage's `PAIRLESS_CANONICAL_KINDS` imported from `types.ts` so SQL and TS predicates share one source of truth).
- `bb066c9` — Deploy failure recovery: extend `transactions_kind_check` enum with `dividend`, `interest`, `opening_balance` (all three were in `PAIRLESS_CANONICAL_KINDS` but only `portfolio_income`/`portfolio_expense` were in the SQL CHECK constraint — applying any dividend/interest/opening_balance proposal would have failed the check).
- One-off data migration (`20260603_opening_balance_kind.sql`): re-tag earliest-per-(holding, account) rows that the first-pass flow stamped `kind='buy'` to `kind='opening_balance'`. Guarded by the same `isFirstTxForHolding` heuristic so genuinely broken pairs (non-earliest `kind='buy'` + no `trade_link_id`) stay flagged.

### Round 3 — Coverage and planner converge (`e1a184a` → `86fa4c7`, 2026-05-24)
- **Phase 0** (`e1a184a`) — Kind column on `/transactions` renders dashed-border pill when `kind` is set but the row is still coverage-pending. Solid border = canonical. Mirrors the coverage predicate client-side.
- **Phase 1** (`1853dc9`) — Planner Pass 3 safety net: any candidate that falls through Passes 1/1.5/2 silently now emits an `unmatched_candidate` refused proposal. Guarantees `count(coverage_pending) === count(planner_proposals)` by construction. Catches cash-holding rows with kind set but no pair, qty=0 rows with non-Dividends categories, etc.
- **Phase 2** (`7743ce4`) — DRIP detection: Pass 1.6 emits `dividend_reinvestment` proposals when `category=Dividends, qty>0, qty≈amount`. Right-pane holding picker with candidates pre-filtered to non-cash holdings in the row's account. Apply switches `portfolio_holding_id` + stamps `kind='dividend'`. (Variant chooser added in Phase 4b — see below.)
- **Phase 3** (`86fa4c7`) — Pass 0 missing-lot detection. Already-canonical rows on non-cash holdings whose lot/closure is missing surface as `missing_lot` proposals. Coverage gets a new `missingLots` metric. Apply runs `applyLotEffectsForTx` directly without UPDATEing the row.

### Round 4 — Cash dividends + symbol hygiene (`77794e7` → `15ac794`, 2026-05-24)
- **Phase 4a** (`77794e7`) — Cash-sleeve symbol auto-fix. Server-side endpoint sets `symbol = currency` for cash sleeves missing a symbol. Surfaces as Step 0 in the wizard.
- **Phase 4b** (`30a1459`) — Two-variant `dividend_reinvestment`: `cash_dividend` vs `drip`. Variant radio above the holding picker.
- **Cash-dividend correction** (`15ac794`) — The initial Phase 4b apply for `cash_dividend` zeroed qty and kept `portfolio_holding_id` = the picked stock. User flagged that's the wrong direction — cash dividends LAND on the cash sleeve (where the money goes), not on the stock. Fixed: `cash_dividend` apply now sets `portfolio_holding_id` = matching cash sleeve, `related_holding_id` = picked stock (for reporting), `kind='portfolio_income'`, preserves qty as cash units. Mirrors the shape produced by `recordIncomeExpense` in `operations.ts`.

### Known dev-side cleanup
- One duplicate VWRD.L lot (32 shares, opened 2022-12-31 on IBKR Joint) from the pre-Phase-0 opening_balance double-apply. Delete one of the two `2022-12-31` VWRD.L buy rows from `/transactions`; `reverseLotsForDeleteHook` drops the orphan lot.
- One Mimi TFSA VUN.TO dividend row (Apr 6) was applied with the buggy first version of `cash_dividend` (kind=dividend, qty=0, holding=VUN.TO instead of cash sleeve). Either undo the proposal on `/settings/backfill/[runId]` and re-apply with the new code, or edit manually via `/transactions`.

## V2 work surfaced by stress testing (not yet shipped)

- **S1 cross-currency synthesis** — fabricate FX Conversion pair when the user supplies a known rate or accepts a historical lookup.
- **S2 N-row trade families** — generalize `operations.ts` to support combined-cash-leg structures so the user doesn't have to manually split.
- **Stock split / corporate-action backfill** — separate concern; integrate with existing `add_split` MCP tool.
- **Direct CSV ingest from competitor exports** — new connector under `@finlynq/import-connectors` that lands rows into `transactions`, then the backfill pipeline canonicalizes them.
- **`missing_symbol` proposal kind** for holdings (not transactions) — surface non-cash holdings missing a ticker as proposals the user reviews. Currently only the cash-sleeve case auto-fixes.
- **Lot cleanup on holding switch** — when `dividend_reinvestment`'s `cash_dividend` apply moves a row from a stock holding to a cash sleeve, the old lot opened on the stock during a prior wrong apply remains. Manual cleanup needed for now.

## Verification

```bash
cd pf-app
npx vitest run tests/backfill-planner.test.ts   # 24/24 PASS — all 6 passes + Phase 0-4 scenarios
npx tsc --noEmit                                  # clean
npm run audit:invariants                         # 8/8 PASS — backfill imports applyLotEffectsForTx so invariant #8 holds
```

Integration (dev env):

1. Visit `dev.finlynq.com/settings/backfill`
2. **Step 0:** Click "Fix cash-sleeve symbols" if any cash sleeves show blank Symbol in the holdings list
3. Pick `synthesize_orphans` mode if Wealthfolio-style data lacks cash sleeve activity; otherwise `refuse_orphans`
4. Pick scope, click "Compute proposals"
5. Right-pane each proposal; confirm displaced→replacement rows + lot impact
6. For drift proposals, pick variant A or B
7. For `dividend_reinvestment` proposals, pick variant (cash_dividend vs drip) + the underlying stock
8. For `missing_lot` proposals, no input needed — just approve
9. Click "Apply N approved" → 200 OK
10. Verify `/portfolio/realized-gains` populates for historical sells
11. Verify `/portfolio` shows unchanged qty + balance
12. Click "Undo" on one proposal; verify restore
13. Re-run planner → empty proposal set (idempotency)
14. Verify `/transactions` Kind column shows solid pills on every row (no dashed = no coverage-pending)
