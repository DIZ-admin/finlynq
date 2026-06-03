-- Cash-snapshot staleness watermark (plan/net-worth-cash-snapshots.md Phase 1).
--
-- The "Net Worth Over Time" chart now stores per-account daily CASH balances in
-- portfolio_snapshots (source='cash', is_investment=false accounts) translated
-- at each day's HISTORICAL FX rate — consistent with the investment side —
-- instead of re-translating a live cumulative at today's rate on every load.
--
-- Unlike the investment side, the cash side needs NO DEK (cash balance =
-- cumulative SUM(transactions.amount) + cached FX), so it can be built/rebuilt
-- by a real background cron and a DEK-free chart-load self-heal. That freshness
-- machinery needs a cheap "is the stored cash history still valid?" check.
--
-- portfolio_snapshots.created_at is NOT bumped on re-UPSERT (the builder's DO
-- UPDATE SET omits it), so it can't signal "rebuilt since". This per-user meta
-- table is the watermark instead: a fingerprint of the user's cash transactions
-- (max updated-time + row count, the latter catching DELETEs) captured at build
-- time, plus the 'to' date the build covered. isCashStale() compares a live
-- fingerprint against this row.
--
-- Purely additive — no destructive DDL, so deploy.sh applies it on the next
-- deploy with no code-first/SQL-second dance.
--
-- The runner in deploy.sh wraps the file in a transaction with the
-- schema_migrations bookkeeping insert — do NOT add a BEGIN/COMMIT here.

CREATE TABLE IF NOT EXISTS portfolio_cash_snapshot_meta (
  user_id        TEXT        PRIMARY KEY,
  -- GREATEST(MAX(created_at), MAX(updated_at)) of the user's cash transactions
  -- at build time. A later edit pushes the live max above this → stale.
  tx_max_updated TIMESTAMPTZ,
  -- COUNT(*) of the user's cash transactions at build time. A DELETE drops the
  -- live count below this → stale (the max-updated check alone can't see a
  -- delete).
  tx_count       INTEGER     NOT NULL DEFAULT 0,
  -- The 'to' date the build covered (YYYY-MM-DD). A new calendar day past this
  -- → stale (the baseline must roll forward).
  built_through  TEXT,
  built_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
