-- Restore the currency columns required by the goals/loans schema.
--
-- The original Phase-4 migration lived at scripts/migrate-goals-loans-currency.sql,
-- outside the automatic migration directory. Existing deployments therefore had
-- goals/loans rows but no currency columns, while application code still selected
-- and wrote those columns. Keep this migration additive and idempotent so it can
-- repair those installations safely.

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CAD';

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CAD';

-- Infer the currency only for rows that received the new default. Never overwrite
-- an explicitly stored currency.
UPDATE goals AS g
   SET currency = a.currency
  FROM accounts AS a
 WHERE g.account_id = a.id
   AND a.currency IS NOT NULL
   AND a.currency <> ''
   AND g.currency = 'CAD'
   AND a.currency <> 'CAD';

UPDATE loans AS l
   SET currency = a.currency
  FROM accounts AS a
 WHERE l.account_id = a.id
   AND a.currency IS NOT NULL
   AND a.currency <> ''
   AND l.currency = 'CAD'
   AND a.currency <> 'CAD';
