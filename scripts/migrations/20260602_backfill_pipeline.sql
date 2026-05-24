-- Transaction-canonicalization backfill pipeline (2026-06-02).
--
-- Three new tables that stage proposed canonical reshapes of existing
-- `transactions` rows for user review before they're applied. Goal: take
-- legacy single-row or unpaired imports (typical of competitor exports
-- like Wealthfolio / Ghostfolio, or pre-Phase-2 historical activity) and
-- reshape them into Phase 2 canonical pairs so `holding_lots` +
-- `holding_lot_closures` populate correctly and `/portfolio/realized-gains`
-- surfaces realized gains.
--
-- Pipeline stages (see pf-app/docs/architecture/backfill.md for full mechanics):
--   PLAN   → reads transactions/holdings, writes backfill_runs + backfill_proposals
--   REVIEW → user toggles status per proposal in two-pane UI
--   APPLY  → per-proposal DB tx: UPDATE transactions in place, replay live
--            lot hooks via applyLotEffectsForTx, snapshot to backfill_audit
--   UNDO   → restore from backfill_audit, refuses with 409 if downstream
--            closures exist (mirrors cascadeDeleteForReplace's guard)
--
-- Key invariant choice: APPLY does UPDATE-in-place on `transactions` rather
-- than DELETE+INSERT. This preserves `id`, `created_at`, `import_hash`
-- (plaintext-payee invariant), and `bank_transaction_id` lineage. Synthesis
-- is the only path that creates net-new rows; those are tagged with
-- `source='backfill_synth'` (new enum value, added below).
--
-- Pure additive: no DROP COLUMN, no behavior change for paths that don't
-- yet read the new tables. The runner in deploy.sh wraps the file in a
-- transaction with the schema_migrations bookkeeping insert — do NOT add
-- a BEGIN/COMMIT block here.

-- ─── backfill_runs ─────────────────────────────────────────────────────
--
-- One row per "compute proposals" invocation. Carries the preflight mode
-- choice (S8 from the plan) + the scope filter. CASCADE on user_id so
-- wipe-account cleans up automatically.
CREATE TABLE IF NOT EXISTS backfill_runs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'refuse_orphans'    — orphan stock legs surface as manual-fix proposals,
  --                       no synthesis. Use when the user also imports this
  --                       brokerage's cash transactions separately.
  -- 'synthesize_orphans' — orphans get a fabricated paired cash leg tagged
  --                       source='backfill_synth'. Bank-side balance will
  --                       diverge by exactly the synthesized amount.
  mode          TEXT         NOT NULL CHECK (mode IN ('refuse_orphans','synthesize_orphans')),
  -- { accountIds?: number[], stagedImportId?: string, dateFrom?: 'YYYY-MM-DD',
  --   dateTo?: 'YYYY-MM-DD' }. Empty object {} = all accounts, all dates.
  scope_filter  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT         NOT NULL DEFAULT 'planning' CHECK (status IN (
                  'planning','ready','applied','partially_applied','cancelled','undone'
                )),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  applied_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS backfill_runs_user_created_idx
  ON backfill_runs (user_id, created_at DESC);

-- ─── backfill_proposals ────────────────────────────────────────────────
--
-- One row per proposed canonical reshape. `replacement_rows_json` is the
-- shape the apply path will UPDATE the existing rows into; for drift
-- proposals (S4) it carries BOTH variant payloads keyed by 'separate_fee_row'
-- and 'absorb_into_cost' — the user's variant_choice picks one.
-- `synthesized_rows_json` carries net-new rows for synthesize-mode orphans
-- and for drift variant A (separate fee row).
--
-- `depends_on_proposal_ids` (S7) — a Sell proposal depends on every Buy
-- proposal in the same (holding, account) that opens lots the Sell would
-- FIFO-close from. Enforced in the UI selector AND server-side at apply.
CREATE TABLE IF NOT EXISTS backfill_proposals (
  id                       SERIAL       PRIMARY KEY,
  run_id                   UUID         NOT NULL REFERENCES backfill_runs(id) ON DELETE CASCADE,
  user_id                  TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'buy_pair' | 'sell_pair' | 'dividend' | 'fx_pair' |
  -- 'brokerage_deposit_pair' | 'brokerage_withdrawal_pair' |
  -- 'classify_only' | 'drift' | 'orphan_stock_leg'
  proposal_kind            TEXT         NOT NULL,
  confidence               TEXT         NOT NULL CHECK (confidence IN ('high','medium','low','refused')),
  refusal_reason           TEXT,
  summary                  TEXT         NOT NULL,
  -- transactions.id values being displaced/updated by this proposal.
  -- INTEGER[] matches transactions.id (serial → INTEGER).
  existing_row_ids         INTEGER[]    NOT NULL,
  replacement_rows_json    JSONB        NOT NULL,
  synthesized_rows_json    JSONB,
  -- { balance: number, lots: [{ holdingId, qtyDelta }], realizedGainBase: number }
  deltas_json              JSONB        NOT NULL,
  depends_on_proposal_ids  INTEGER[]    NOT NULL DEFAULT '{}',
  -- NULL until the user picks for a drift proposal. The apply route refuses
  -- to apply a drift proposal with variant_choice IS NULL.
  variant_choice           TEXT         CHECK (variant_choice IS NULL OR variant_choice IN ('separate_fee_row','absorb_into_cost')),
  status                   TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN (
                             'pending','approved','rejected','applied','undone','refused_with_reason'
                           )),
  applied_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS backfill_proposals_run_status_idx
  ON backfill_proposals (run_id, status);
CREATE INDEX IF NOT EXISTS backfill_proposals_user_idx
  ON backfill_proposals (user_id);

-- ─── backfill_audit ────────────────────────────────────────────────────
--
-- Snapshot of the row state BEFORE the apply UPDATE/INSERT. The undo
-- endpoint reads this to restore the pre-apply state. Kept indefinitely
-- (no TTL) so the audit trail survives — the 7-day UX limit on the Undo
-- button is enforced application-side, not by row expiry.
CREATE TABLE IF NOT EXISTS backfill_audit (
  id           SERIAL       PRIMARY KEY,
  proposal_id  INTEGER      NOT NULL REFERENCES backfill_proposals(id) ON DELETE CASCADE,
  -- transactions.id at snapshot time. INTEGER (not INTEGER REFERENCES)
  -- intentionally — the row may have been deleted by an unrelated flow,
  -- and the snapshot is what we restore from.
  tx_id        INTEGER      NOT NULL,
  -- Full row payload as JSON. Restored via UPDATE in the undo path.
  before_json  JSONB        NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS backfill_audit_proposal_idx
  ON backfill_audit (proposal_id);

-- ─── transactions.source CHECK — append 'backfill_synth' ───────────────
--
-- Idempotent: drop the old constraint if present, then add fresh. Mirrors
-- the pattern in scripts/migrations/20260523_transaction-bank-links.sql.
-- The 9 allowed values mirror the SOURCES tuple in src/lib/tx-source.ts.
--
-- 'backfill_synth' is set ONLY by the backfill synthesize path on net-new
-- rows it fabricates (paired cash legs for orphan stock legs, fee rows for
-- drift variant A). Apply UPDATE-in-place on existing rows does NOT change
-- `source` — the audit trail of the original writer surface is preserved.
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_source_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_source_check
    CHECK (source IN ('manual','import','mcp_http','mcp_stdio',
                      'connector','sample_data','backup_restore',
                      'reconcile_link','backfill_synth'));
