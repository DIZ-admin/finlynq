-- Currency rework Phase 3 (2026-06-06): store a per-transaction reporting amount.
--
-- reporting_amount = `amount` (account currency) converted to the user's
-- display/reporting currency at THIS row's `date` historical FX rate, locked
-- at write time. Flow reports (trends / yoy / income-statement income+expense /
-- tax-summary) SUM it instead of converting at today's rate. reporting_currency
-- records which currency it's in (the user's display currency when computed);
-- a background job re-derives every row when the user switches display currency.
-- All three columns are nullable; reports fall back to on-the-fly conversion for
-- NULL / stale rows, so this migration is safe to apply before the backfill runs.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS reporting_currency text,
  ADD COLUMN IF NOT EXISTS reporting_amount double precision,
  ADD COLUMN IF NOT EXISTS reporting_rate double precision;

-- One row per user; drives the progress toast while the currency-switch
-- recompute job runs. Reports stay correct via the fallback regardless.
CREATE TABLE IF NOT EXISTS reporting_recompute_status (
  user_id text PRIMARY KEY,
  target_currency text NOT NULL,
  total integer NOT NULL DEFAULT 0,
  done integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
