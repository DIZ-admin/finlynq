-- Phase 4b — Two-variant dividend reinvestment proposals.
--
-- Context (plan `ok-bug-one-fixed-floofy-hopper.md`, Phase 4b): the user
-- pointed out from the dev review that a row like VUN.TO with category
-- =Dividends, qty=9.76, amount=$9.76 CAD is NOT a share reinvestment.
-- The qty field happens to equal the dollar amount because the import
-- stored both numbers identically; the row is a normal CAD cash
-- dividend, already correctly associated with VUN.TO for reporting.
-- Treating it as DRIP and opening a 9.76-share lot at $1/share is wrong.
--
-- For the crypto / true-DRIP case (qty is genuinely a share count of a
-- sub-dollar unit), opening a lot IS correct.
--
-- The planner can't auto-disambiguate from qty alone — user picks. New
-- column lets the user choose between:
--   'cash_dividend' — apply UPDATEs kind='dividend', sets quantity=0
--                     (qty was the import quirk; cash dividend has no
--                     share count), portfolio_holding_id=chosen. No lot.
--   'drip'          — apply UPDATEs kind='dividend',
--                     portfolio_holding_id=chosen; qty stays as-is.
--                     Lot replay opens at costPerShare=amount/qty.
--
-- Default suggested by the planner: 'cash_dividend' when the row is
-- already on a non-cash stock holding (the VUN.TO case); 'drip' when
-- it's on a cash sleeve or has no holding.
--
-- The runner in deploy.sh wraps each migration in a transaction
-- (psql --single-transaction with ON_ERROR_STOP=1); no BEGIN/COMMIT.

ALTER TABLE backfill_proposals
  ADD COLUMN IF NOT EXISTS dividend_variant TEXT
    CHECK (dividend_variant IS NULL OR dividend_variant IN ('cash_dividend', 'drip'));
