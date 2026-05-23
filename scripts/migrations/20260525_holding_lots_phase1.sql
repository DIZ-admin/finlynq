-- Lot-tracked cost basis — Phase 1 (2026-05-25).
--
-- Foundation for the portfolio overhaul cataloged in
-- plan/portfolio-lots-and-performance.md. Replaces the average-cost math
-- duplicated across the three portfolio aggregators (REST
-- /api/portfolio/overview, src/lib/holdings-value.ts, MCP HTTP
-- register-tools-pg.ts::aggregateHoldings) with a per-lot model so
-- realized gains are computed by FIFO depletion rather than
-- sellAmount − (sellQty × avgCost). After backfill + per-user rollout, the
-- three aggregators delete their inline math and call
-- src/lib/portfolio/metrics.ts::computeHoldingMetricsFromLots.
--
-- Pure additive: no DROP COLUMN, no behavior change for users whose
-- portfolio_lots_status.enabled is FALSE. Old aggregator paths stay live
-- behind the per-user flag. The trap columns holding_accounts.qty /
-- cost_basis are NOT dropped here — that's a follow-up loose migration
-- after full rollout (see migrate-holding-accounts-drop-qty-cost-basis-loose.sql).
--
-- Carries NO encrypted columns. Display names live on portfolio_holdings.
-- Lot rows reference holdings by FK; readers JOIN through
-- portfolio_holdings to decrypt. Stdio MCP can read this table directly
-- (no DEK required) — that's what un-blocks the streamDRefuseRead refusal
-- on get_portfolio_analysis / get_portfolio_performance / analyze_holding.
--
-- The runner in deploy.sh wraps the file in a transaction with the
-- schema_migrations bookkeeping insert — do NOT add a BEGIN/COMMIT block
-- here.

-- ─── holding_lots ─────────────────────────────────────────────────────────
--
-- One row per buy / dividend-reinvestment / transfer-in / split adjustment
-- / backfilled-lot. Cost basis is stored in the HOLDING's currency
-- (issue #129) — cross-currency trades (e.g. a USD ETF inside a CAD
-- account) record cost_per_share in USD; the holding's reporting-currency
-- conversion happens at read time via the FX resolver.
--
-- qty_remaining is the live "open shares" count for FIFO depletion.
-- Updated atomically on every sell via the lot-write hooks
-- (src/lib/portfolio/lots/write-hooks.ts). qty_original stays immutable
-- after lot creation so the audit trail is preserved (e.g. for tax
-- reporting + the legacy avg-cost vs FIFO tooltip).
--
-- origin discriminates how the lot was opened:
--   'buy'           — direct buy transaction
--   'reinvest_div'  — dividend reinvestment (transactions row has qty>0
--                     AND category_id = user's Dividends — issue #84 both
--                     effects fire)
--   'transfer_in'   — destination leg of an in-kind transfer (parent_lot_id
--                     points back to the closed-out source lot in the
--                     other account; open_date + cost_per_share inherit
--                     from the parent rather than reset to the transfer
--                     date — load-bearing for tax holding-period reporting)
--   'split_adj'     — forward stock split adjustment (qty multiplied,
--                     cost_per_share divided proportionally). Other
--                     corporate actions (merger, spinoff, ticker change)
--                     are explicitly out of scope for Phase 1.
--   'backfill'      — written by scripts/backfill-portfolio-lots.ts for
--                     pre-Phase-1 transactions. Same shape as 'buy', but
--                     distinguishable in audit queries.

CREATE TABLE IF NOT EXISTS holding_lots (
  id                SERIAL            PRIMARY KEY,
  user_id           TEXT              NOT NULL,
  holding_id        INTEGER           NOT NULL REFERENCES portfolio_holdings(id) ON DELETE CASCADE,
  account_id        INTEGER           NOT NULL REFERENCES accounts(id)            ON DELETE CASCADE,
  open_tx_id        INTEGER           NOT NULL REFERENCES transactions(id)        ON DELETE CASCADE,
  -- YYYY-MM-DD, mirrors transactions.date format. Inherits from parent_lot
  -- on transfer-in legs (NOT the transfer-date) so tax-lot age is preserved
  -- across in-kind moves.
  open_date         TEXT              NOT NULL,
  qty_original      DOUBLE PRECISION  NOT NULL,
  qty_remaining     DOUBLE PRECISION  NOT NULL,
  -- In `currency`. For paired multi-currency trades (issue #96), the lot's
  -- cost_per_share is computed from the cash-leg's entered_amount, not
  -- the stock-leg's amount (the stock leg is the same trade re-priced at
  -- Finlynq's live FX rate; the cash leg is the broker's actual
  -- settlement at IBKR's FX rate).
  cost_per_share    DOUBLE PRECISION  NOT NULL,
  currency          TEXT              NOT NULL,
  -- Snapshot of the FX rate (cost-basis currency → USD) at lot-open
  -- time. Nullable to keep the column additive — backfill can leave it
  -- NULL for old lots if the FX cache doesn't cover the date. Phase 3
  -- (TWRR / value-over-time) reads this for cross-currency reporting.
  fx_to_usd_at_open DOUBLE PRECISION,
  origin            TEXT              NOT NULL,
  parent_lot_id     INTEGER           REFERENCES holding_lots(id) ON DELETE SET NULL,
  -- 'open'              — qty_remaining > 0, lot still depletable
  -- 'closed'            — qty_remaining = 0 via sell or full transfer-out
  -- 'transferred_out'   — full transfer-out leg; closure row was written
  --                       with close_kind='transfer_out' and realized_gain=0
  status            TEXT              NOT NULL DEFAULT 'open',
  -- Mirrors transactions.source (src/lib/tx-source.ts SOURCES tuple). Set
  -- once at lot creation, never modified — the writer-surface that opened
  -- the lot is the writer-surface that wrote the underlying transaction.
  source            TEXT              NOT NULL DEFAULT 'manual',
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CHECK (qty_original > 0),
  CHECK (qty_remaining >= 0 AND qty_remaining <= qty_original),
  CHECK (origin IN ('buy','reinvest_div','transfer_in','split_adj','backfill')),
  CHECK (status IN ('open','closed','transferred_out'))
);

-- Hot path: FIFO selection — "give me every open lot for this
-- (holding, account, user), ordered by open_date ASC, id ASC tiebreaker".
-- The status='open' clause is critical — closed lots stay in the table
-- for audit and tax reporting but should not be re-selected.
CREATE INDEX IF NOT EXISTS holding_lots_user_hold_acct_status_open_idx
  ON holding_lots (user_id, holding_id, account_id, status, open_date, id);

-- Hot path: "find the lot opened by this transaction" — used by
-- reverseLotsForDelete when a transactions row is deleted. open_tx_id is
-- 1:1 with transactions.id at INSERT but can be NULL'd if the underlying
-- transaction is deleted (CASCADE on the FK handles the row deletion).
CREATE INDEX IF NOT EXISTS holding_lots_open_tx_idx
  ON holding_lots (open_tx_id);

-- ─── holding_lot_closures ────────────────────────────────────────────────
--
-- One row per (close_tx, lot) pair — a single sell can deplete multiple
-- FIFO lots, and a single transfer-out closes exactly one lot. Realized
-- gain is computed at close time and stored, not recomputed on read, so
-- the tax-year query in Phase 2 (/portfolio/realized-gains) is a simple
-- filter on close_date.
--
-- Realized gain is in the HOLDING's currency (matches holding_lots.currency).
-- Cross-currency reporting (e.g. showing realized gain in the user's
-- reporting currency) FX-converts at read time.

CREATE TABLE IF NOT EXISTS holding_lot_closures (
  id                  SERIAL            PRIMARY KEY,
  user_id             TEXT              NOT NULL,
  lot_id              INTEGER           NOT NULL REFERENCES holding_lots(id)  ON DELETE CASCADE,
  close_tx_id         INTEGER           NOT NULL REFERENCES transactions(id)  ON DELETE CASCADE,
  -- YYYY-MM-DD, mirrors transactions.date.
  close_date          TEXT              NOT NULL,
  qty_closed          DOUBLE PRECISION  NOT NULL,
  -- Per-share proceeds AFTER the issue #96 paired-cash-leg substitution.
  -- For a non-paired sell, this is sellAmount / qtyClosed (sellAmount in
  -- the holding's currency). For a paired sell (issue #128), the cash leg
  -- IS skipped from the close branch entirely; only the stock-leg sell
  -- writes closure rows — but the stock-leg's amount is also under-priced
  -- at Finlynq's live FX rate, so the closure substitutes the cash leg's
  -- entered_amount the same way the buy branch does.
  proceeds_per_share  DOUBLE PRECISION  NOT NULL,
  -- Snapshot of holding_lots.cost_per_share at the moment the lot was
  -- closed. Stored here so realized_gain stays stable even if a future
  -- reverseLotsForDelete + redo cycle changes the lot's nominal
  -- cost_per_share (which today never happens — cost is immutable post-
  -- open — but the snapshot is defense-in-depth).
  cost_per_share      DOUBLE PRECISION  NOT NULL,
  -- (proceeds_per_share − cost_per_share) × qty_closed, in `currency`.
  -- Positive = gain, negative = loss. Transfer-out closures write 0 here
  -- (a transfer is not a realization).
  realized_gain       DOUBLE PRECISION  NOT NULL,
  currency            TEXT              NOT NULL,
  -- Calendar-day count from open_date → close_date. Used to surface the
  -- US short-term (≤ 365d) vs long-term (> 365d) distinction in the
  -- Phase 2 realized-gains dashboard. The dashboard column is
  -- user-locale-gated; CRA users may still want the raw value.
  days_held           INTEGER           NOT NULL,
  -- 'sell'          — the underlying close transaction was a sell
  --                   (transactions row has qty<0, NOT a paired cash leg
  --                   per issue #128)
  -- 'transfer_out'  — the underlying close transaction was a transfer
  --                   leg; realized_gain is 0 by construction
  close_kind          TEXT              NOT NULL,
  source              TEXT              NOT NULL DEFAULT 'manual',
  created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CHECK (qty_closed > 0),
  CHECK (close_kind IN ('sell','transfer_out'))
);

-- Hot path: "give me every realized close in this date range" — drives
-- the Phase 2 /portfolio/realized-gains tax-year filter and the
-- MCP tool get_realized_gains.
CREATE INDEX IF NOT EXISTS holding_lot_closures_user_close_date_idx
  ON holding_lot_closures (user_id, close_date, lot_id);

-- Hot path: "find the closure(s) for this transaction" — used by
-- reverseLotsForDelete when a sell transaction is deleted (multiple
-- closures may exist if the sell spanned multiple FIFO lots).
CREATE INDEX IF NOT EXISTS holding_lot_closures_close_tx_idx
  ON holding_lot_closures (close_tx_id);

-- ─── portfolio_lots_status ───────────────────────────────────────────────
--
-- Per-user feature flag + backfill watermark. The three aggregators
-- branch on `enabled` to pick the lot-derived metrics path vs the legacy
-- avg-cost path. After backfill + manual canary verification, an admin
-- (or scripts/backfill-portfolio-lots.ts on success) flips `enabled`.
--
-- After every active user is enabled, the legacy paths are deleted from
-- the three aggregators and this table can be DROPped in a follow-up
-- migration. For now it stays as the rollout gate.

CREATE TABLE IF NOT EXISTS portfolio_lots_status (
  user_id        TEXT              PRIMARY KEY,
  -- Set to TRUE by the backfill script after it has successfully written
  -- lot rows for every (holding, account) pair in the user's transaction
  -- history. Implies the user CAN be flipped to enabled=TRUE; does not
  -- imply they have been (the human canary step is independent).
  backfill_done  BOOLEAN           NOT NULL DEFAULT FALSE,
  -- The rollout gate — when FALSE, the three aggregators use the legacy
  -- avg-cost math (computed inline from `transactions`); when TRUE, they
  -- read from holding_lots + holding_lot_closures via
  -- src/lib/portfolio/metrics.ts.
  enabled        BOOLEAN           NOT NULL DEFAULT FALSE,
  backfilled_at  TIMESTAMPTZ,
  -- Free-text audit field — typically holds the canary user's hand-rolled
  -- verification notes (FIFO realized-gain delta vs legacy avg-cost,
  -- aggregator parity diff results).
  notes          TEXT              NOT NULL DEFAULT ''
);

-- ─── portfolio_legacy_realized_gain_snapshot ─────────────────────────────
--
-- One-time pre-cutover snapshot of the avg-cost realized-gain number per
-- (user, holding, account). Avg-cost realized gain ≠ FIFO realized gain
-- on any user with partial sells (FIFO depletes oldest-first; avg-cost
-- spreads sell proceeds against the pooled average). The Phase 1 UI
-- shows a tooltip on the realized-gain column: "Pre-2026-05 avg-cost: $X"
-- so users can see what they used to see.
--
-- Written exactly once per (user, holding, account) by the backfill
-- script. Never updated. After every active user is enabled and a
-- release cycle has passed, this table can be DROPped — the snapshot is
-- a transition aid, not a long-term audit field.

CREATE TABLE IF NOT EXISTS portfolio_legacy_realized_gain_snapshot (
  user_id           TEXT              NOT NULL,
  holding_id        INTEGER           NOT NULL,
  account_id        INTEGER           NOT NULL,
  -- The avg-cost realized gain at the moment of snapshot. In the
  -- holding's currency (mirrors holding_lots.currency).
  avg_cost_realized DOUBLE PRECISION  NOT NULL,
  currency          TEXT              NOT NULL,
  snapped_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, holding_id, account_id)
);
