-- FINLYNQ-84 — Transaction rules v2: multi-condition + richer actions.
--
-- DESTRUCTIVE MIGRATION — DO NOT MOVE THIS FILE TO scripts/migrations/.
-- The code-first deployment must be live before this file is applied manually.
-- This remains outside the auto-runner because dropping the legacy columns is
-- irreversible and needs an operator-visible backup/rollback decision.
--
-- Safe properties:
--   * never truncates or deletes rules;
--   * accepts a database where conditions/actions were already added by
--     schema-push but legacy NOT NULL columns were left behind;
--   * refuses atomically when legacy rows exist, because converting their
--     plaintext fields requires the user's DEK and must happen in application
--     code rather than SQL;
--   * is re-runnable after a successful cutover.
--
-- Manual sequence (run AFTER the new bundle has fully deployed):
--   psql "$DATABASE_URL" -f scripts/migrate-finlynq-84-rules-v2.sql
--
-- This file owns its transaction for the manual psql flow. It is intentionally
-- not suitable for deploy.sh's scripts/migrations runner.

BEGIN;

DO $$
DECLARE
  legacy_columns_present boolean;
  legacy_rows bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'transaction_rules'
       AND column_name IN (
         'match_field', 'match_type', 'match_value',
         'assign_category_id', 'assign_tags', 'rename_to'
       )
  ) INTO legacy_columns_present;

  IF legacy_columns_present THEN
    SELECT COUNT(*) INTO legacy_rows FROM transaction_rules;
    IF legacy_rows > 0 THEN
      RAISE EXCEPTION
        'transaction_rules v2 cutover refused: % legacy rule rows require DEK-aware application backfill',
        legacy_rows;
    END IF;
  END IF;
END $$;

-- Additive safety for databases where schema-push has not created the v2
-- columns yet. Defaults are needed only while existing rows are present; they
-- are removed below after the empty/legacy-row guard has passed.
ALTER TABLE transaction_rules
  ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{"all":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

-- The initial schema used INTEGER 0/1 while the current Drizzle schema uses
-- BOOLEAN. Convert only when the old type is still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'transaction_rules'
       AND column_name = 'is_active'
       AND data_type = 'integer'
  ) THEN
    ALTER TABLE transaction_rules ALTER COLUMN is_active DROP DEFAULT;
    ALTER TABLE transaction_rules
      ALTER COLUMN is_active TYPE BOOLEAN USING (is_active::int <> 0);
    ALTER TABLE transaction_rules ALTER COLUMN is_active SET DEFAULT TRUE;
  END IF;
END $$;

ALTER TABLE transaction_rules
  DROP CONSTRAINT IF EXISTS transaction_rules_assign_category_id_categories_id_fk;

ALTER TABLE transaction_rules
  DROP COLUMN IF EXISTS match_field,
  DROP COLUMN IF EXISTS match_type,
  DROP COLUMN IF EXISTS match_value,
  DROP COLUMN IF EXISTS assign_category_id,
  DROP COLUMN IF EXISTS assign_tags,
  DROP COLUMN IF EXISTS rename_to;

ALTER TABLE transaction_rules
  ALTER COLUMN conditions DROP DEFAULT,
  ALTER COLUMN actions DROP DEFAULT,
  ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS transaction_rules_user_active_priority_idx
  ON transaction_rules (user_id, is_active, priority DESC);

COMMIT;
