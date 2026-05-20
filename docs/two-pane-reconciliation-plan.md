# Two-pane reconciliation on `/import/pending` — design plan

**DevManager item:** FINLYNQ-56 (F-53C). Parent FINLYNQ-53. Schema dependencies
F-53A (FINLYNQ-54) + F-53B (FINLYNQ-55) shipped 2026-05-20.

## Scope summary

Rebuild `/import/pending` from a single-pane Approve/Reject dialog into a
per-account two-pane reconciliation surface. The right pane shows file rows
from `staged_transactions` for one selected account; the left pane shows
existing `transactions` rows on that account within ±7 days of the file's
date range. The user has four matching actions: accept an auto-match
suggestion, manually link/unlink a file row to a DB row, mark a file row as
`skipped_duplicate`, or flag a DB row as `missing_from_statement`. Every
action persists immediately so a tab close and reopen restores all four
decisions verbatim. The existing reconciliation balance callout
(`Statement says / Finlynq has now / After approval`) is wired to live-
recompute (≤500ms) as each action lands.

## File / endpoint inventory

### Existing files we touch

| Path | Role | Phase |
|---|---|---|
| `pf-app/src/app/(app)/import/pending/page.tsx` | Single-pane dialog today. Rebuild into two-pane shell (account selector + URL state) wrapping the existing `StagedRowEditor` and `ReconciliationCallout`. | 2, 3, 4 |
| `pf-app/src/app/api/import/staged/[id]/route.ts` (GET) | Already returns staged rows + reconciliation block. Extend response to include suggested matches + per-row `reconcileState` / `linkedTransactionId` (already on schema, just not selected). | 1 |
| `pf-app/src/app/api/import/staged/[id]/rows/[rowId]/route.ts` (PATCH) | Extend the Zod schema + update set to accept `reconcileState` (enum) and `linkedTransactionId` (nullable int). Validate the CHECK enum + verify the linked transaction belongs to the same user. Preserve every existing invariant — `import_hash` MUST NOT be recomputed; per-row encryption tier MUST NOT flip; mutual exclusion of `peer_staged_id` vs `target_account_id` unchanged. | 1 |
| `pf-app/src/app/api/import/staged/[id]/approve/route.ts` (POST) | No-op for most of phase 1, but: when materializing rows whose `reconcile_state='linked'`, the existing transaction row already exists — we DO NOT re-insert it; we just delete the staged row from the queue. Skip `reconcile_state='skipped_duplicate'` rows entirely (no insert, no flag). The half-pair transfer invariant, sign-vs-category invariant, and `import_hash` invariant remain unchanged. | 3 |
| `pf-app/src/components/staging/reconciliation-callout.tsx` | Reuse as-is; phase 4 just wires a wider `liveDelta` calculation that subtracts linked + skipped rows in addition to the existing `dedupStatus='existing'` exclusion. | 4 |
| `pf-app/src/components/staging/staged-row-editor.tsx` | Reuse; the editor stays per-row. Phase 3 adds a new "reconcile" action surface on the row (the badge + actions) without changing the editor itself. | 3 |
| `pf-app/CHANGELOG.md` | Unreleased entry per phase commit. | every |
| `C:\Users\halaw\Projects\PF\CLAUDE.md` | Workspace project-instructions. Add a load-bearing gotcha for the four-action invariant (no `flagged_missing` in `reconcile_state`, no `import_hash` recompute, no tier flip) once phase 1 lands. | 1 |
| `pf-app/docs/architecture/database.md` | Update the `staged_transactions` reconciliation columns section with reader/writer routes and link from the load-bearing-gotchas. | 1 |

### New files we create

| Path | Role | Phase |
|---|---|---|
| `pf-app/src/app/api/transactions/[id]/reconciliation-flag/route.ts` | New endpoint. `POST` inserts into `transaction_reconciliation_flags(flag_kind='missing_from_statement')`. `DELETE` removes it. Both `user_id`-scoped; cross-tenant attacks return 404. Body accepts an optional `note`. | 1 |
| `pf-app/src/lib/import/auto-match.ts` | Pure server-side function — given a list of decoded staged rows + a list of DB transactions in the ±7d window, return `{ stagedId, transactionId, confidence }[]`. **Algorithm is an open question** (see below); first cut: exact `date` AND exact `amount` AND DB row not already linked. | 1 |
| `pf-app/src/app/api/import/staged/[id]/db-rows/route.ts` | New endpoint. `GET ?accountId=N&from=YYYY-MM-DD&to=YYYY-MM-DD` returns the left pane: existing `transactions` rows for the selected account, ±7d window around the staged batch's date range. User-scoped. Returns decoded payee/category names so the UI doesn't have to re-implement the per-tier decode. (Live `transactions.payee` is `v1:` ciphertext only — no staging-tier branch needed.) | 2 |
| `pf-app/src/components/import/reconcile/*` | UI components: `AccountSelector`, `TwoPaneLayout`, `FilePane`, `DbPane`, `SuggestionsGroup`, `RowBadge`. Each is a thin client component; the page composes them. | 2, 3 |

## Phases

Five phases total. Effort assumes phase-isolated commits with passing
`npm run build` self-check.

### Phase 1 — Backend (PATCH extension + flag endpoint + auto-match)

**Effort:** 1–3h

Extend the per-row PATCH endpoint to accept two new optional fields:
`reconcileState` (enum: `unmatched | auto_suggested | linked | skipped_duplicate`)
and `linkedTransactionId` (nullable int). Validate the CHECK enum
client-side via Zod; verify the linked transaction belongs to
`userId`. Add the new `POST /api/transactions/[id]/reconciliation-flag`
endpoint (+ `DELETE`) for the DB-side `missing_from_statement` flag.
Add the pure auto-match helper at `src/lib/import/auto-match.ts`
returning candidate pairs from same-day, same-amount, not-already-linked
DB rows. Surface suggestions in the GET staged-detail response under a
new `suggestedMatches: []` field.

**Acceptance:**

- `PATCH /api/import/staged/:id/rows/:rowId` accepts the two new fields
  and rejects an invalid enum with HTTP 400.
- `POST /api/transactions/:id/reconciliation-flag` returns HTTP 201 and
  inserts a row in `transaction_reconciliation_flags`; `DELETE` returns
  HTTP 200 and removes the matching row (idempotent on second DELETE).
- `GET /api/import/staged/:id` includes a non-null `suggestedMatches`
  field; empty array when no candidates.
- `npm run build` passes.

### Phase 2 — UI shell (account selector, URL state, two-pane scaffold)

**Effort:** 1–3h

Rebuild `/import/pending` as a two-pane shell. Above the panes: an
`AccountSelector` populated from the staged batch's accounts (which
account names appear on staged rows). Selection persists in URL
(`?id=<batchId>&account=<accountId>`) so tab-close + reopen restores
state. Right pane renders the existing staged rows for the chosen
account (no new actions yet, just badges from `reconcileState`). Left
pane fetches the DB rows from the new `db-rows` endpoint and renders
them with a "linked to staged #X" indicator where applicable.

**Acceptance:**

- Account selector narrows both panes; URL updates without a reload.
- Right pane renders staged rows for the chosen account with the
  current `reconcileState` shown as a badge.
- Left pane renders DB rows in the ±7d window.
- Closing + reopening the tab with the URL intact restores both panes.

### Phase 3 — Match actions (auto / link / unlink / skip / flag)

**Effort:** half-day

Add the four matching actions. Auto-match suggestions render in a pinned
group at the top of the right pane; Accept/Reject each. Manual link is
"click file row" → "click DB row" → both flip to `linked` (file row
PATCH writes `reconcile_state='linked'` + `linked_transaction_id=N`).
Unlink reverts both. Mark-skipped writes `reconcile_state='skipped_duplicate'`.
Mark-missing on a DB row POSTs to the flag endpoint. Approve endpoint
gains the "skip materialize when `reconcile_state='linked' or
'skipped_duplicate'`" logic — linked rows just delete from staging
(the DB row is already there); skipped rows delete from staging with no
DB insert.

**Acceptance:**

- Accept-suggestion writes `linked` + `linked_transaction_id` on the
  staged row; the DB row's "linked to staged #X" indicator appears.
- Unlink reverts both rows to `unmatched` and clears
  `linked_transaction_id`.
- Mark-skipped flips the staged row's badge and excludes it from
  approve.
- Flag-missing inserts in `transaction_reconciliation_flags`; approve
  the rest of the batch still succeeds.
- All four actions persist across a tab close and reopen.

### Phase 4 — Live balance callout

**Effort:** ≤30m

Wire the existing `ReconciliationCallout`'s `liveDelta` calculation to
also subtract rows where `reconcileState IN ('linked', 'skipped_duplicate')`
(the linked DB row is already in the live balance; skipped rows won't
materialize). Recompute target: within 500ms of any action.

**Acceptance:**

- "After approval" updates within 500ms of every match/skip/flag/link/
  unlink action.
- Same currency-mismatch caveat as today; no new FX hops.

### Phase 5 — Polish + edge cases

**Effort:** 1–3h

Empty states (no DB rows in ±7d, no staged rows for the selected
account, no auto-match candidates). Error toast paths for the new
endpoints. Transfer-pair handling on link/unlink (a `tx_type='R'` row's
peer must be linked too, or neither — same half-pair invariant as
approve). Sign-vs-category invariant still enforced on materialize
(unchanged from FINLYNQ-57 / issue #212). Decimal-tolerance probing on
auto-match (±0.01 acceptable? — see open questions). E2E human-walked
verification per `tc-1-end-to-end-ui` in the test plan.

**Acceptance:**

- All four `tc-*` test cases in the DevManager test plan execute
  cleanly.
- No regressions on existing approve / reject / PATCH paths
  (sign-vs-category, half-pair transfer, sv1↔v1 tier preservation,
  `import_hash` stability across edits).

## Open questions

1. **Auto-match scoring threshold.** The item body says "staged.date ± 0
   days AND staged.amount = db.amount". Strict equality means a
   `49.999` cent rounding diff in CAD won't match. Should the helper
   accept ±0.01 tolerance, ±0.05, or strict equality only? Note the
   stored values are `numeric` so float drift isn't the concern;
   bank reporting precision is. **Default for phase 1 if user doesn't
   weigh in: strict equality (matches the item body verbatim).**
2. **Multi-candidate behaviour.** If two DB rows on the same day match
   the same staged amount (e.g., two $20 ATM withdrawals), do we
   surface BOTH as candidates and ask the user to pick, or skip the
   ambiguous case and leave both `unmatched`? **Default for phase 1:
   surface all candidates; the SuggestionsGroup renders each as a
   separate accept/reject pair.**
3. **DB-row pane scope.** ±7 days is in the spec, but for an investment
   account a statement-period CSV typically spans 30+ days. Is ±7
   relative to the staged batch's date range (min staged date − 7 to
   max staged date + 7) or to each row individually? **Default: batch-
   level window — query once per pane render, not once per row.**
4. **`flag_kind` UI visibility off /import/pending.** The CLAUDE.md
   gotcha says flags persist past approval. Should the transactions
   list (`/transactions`) also surface the flag badge? **Out of scope
   for FINLYNQ-56**; defer to a follow-up item if the user wants it.
5. **Transfer-pair link/unlink semantics.** When a `tx_type='R'` row is
   manually linked to a DB row, does linking imply both peer legs are
   linked, or only the one the user clicked? Item body's "Don't" says:
   "link/unlink on a tx_type='R' row must still validate the half-pair
   rule — both peer-linked rows selected, or neither". So linking one
   without the peer should refuse. **Default for phase 3: refuse with
   an inline error.**

The phase-1 gate fails on open question #1 alone — the auto-match
behavior is exposed on the API response and changing the threshold
later means re-running every existing batch's suggestions. So phase 1
defers until the user picks.

## Cross-cutting `Don't` rules

Verbatim from CLAUDE.md + FINLYNQ-56 body. Each phase MUST honour all of
these:

- **Do NOT recompute `import_hash`** on any row edit, including
  `reconcile_state` toggles, link/unlink, or any new PATCH field
  introduced here. Bank-side dedup keys on the ingest-time hash. Load-
  bearing per CLAUDE.md "`import_hash` always over plaintext payee" and
  "Staged-transactions reads MUST branch on `encryption_tier` per row".
- **Do NOT flip the per-row `encryption_tier` mid-edit.** Even when the
  user edits payee on a row that was ingested at `service` tier, the
  re-encrypt stays at `service` (`sv1:`). The login-time upgrade job is
  the only path that promotes service → user.
- **Do NOT route `flagged_missing` through `staged_transactions.reconcile_state`.**
  It belongs on the new `transaction_reconciliation_flags` table from
  F-53B. The CHECK constraint will reject `flagged_missing` at the SQL
  layer anyway, but the helper / UI MUST be explicit about which path
  takes each action.
- **Do NOT skip the sign-vs-category invariant on approve** (issue
  #212). Even rows the user manually linked must satisfy it for the
  staging-side leg to materialize — but `reconcile_state='linked'`
  rows DON'T materialize (the DB row already exists), so the gate
  applies only to rows that go through `executeImport`. For linked
  rows, the gate is skipped because the staged row never lands in
  `transactions`.
- **Do NOT bypass transfer-pair routing** (issue #155). Link/unlink on
  a `tx_type='R'` row must still validate the half-pair rule from the
  approve endpoint — both peer-linked rows are linked together, or
  neither.
- **Do NOT add a SQL filter to `aggregateHoldings()` or any aggregator**
  while wiring the left pane (issue #236). The pane fetches
  `transactions` raw; no aggregator changes here.
- **Do NOT bypass `requireEncryption`** on the PATCH or new flag
  endpoint. Both touch encrypted columns directly or indirectly (PATCH
  re-encrypts payee/category/note on edit; the flag endpoint just
  needs a logged-in user, but `requireEncryption` is cheap and keeps
  the surface uniform).
- **Do NOT accept client-supplied `linkId` or `trade_link_id`**
  anywhere new (CLAUDE.md load-bearing gotchas). Neither field is in
  scope for this work, but if a future merge prompt or auto-link path
  wants one, mint server-side only.

## Decomposition mapping

FINLYNQ-56 already has 8 children filed in DevManager
(FINLYNQ-68..75). The phases above map onto them as follows:

| Phase | DevManager sub-item(s) |
|---|---|
| Phase 1 (backend) | FINLYNQ-74 (flag endpoint) — the PATCH-extension + auto-match cohort doesn't have a dedicated sub-item; it's implicit infrastructure across FINLYNQ-72/73 child surfaces. |
| Phase 2 (UI shell) | FINLYNQ-68 (account selector + URL state), FINLYNQ-69 (right pane), FINLYNQ-70 (left pane) |
| Phase 3 (match actions) | FINLYNQ-71 (auto-match suggestions), FINLYNQ-72 (manual link/unlink), FINLYNQ-73 (skipped_duplicate), FINLYNQ-74 (mark-missing) |
| Phase 4 (live balance) | FINLYNQ-75 (balance callout live recompute) |
| Phase 5 (polish) | none — covered as the closing pass for FINLYNQ-56 itself |

The sub-items can be drained independently in phase order once the user
clears the auto-match open question.
