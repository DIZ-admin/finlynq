-- Persist FINLYNQ-54 parser knobs on `import_templates` (follow-up to
-- 20260520_finlynq-54-parser-knobs.sql, which added the same columns on
-- `staged_imports`). Without this the Edit/Save Template dialogs silently
-- drop the knobs and every re-upload starts from defaults.
--
-- Knobs (mirrors staged_imports semantics — same CHECK list):
--   skip_header_rows       — INT >=0, default 0.
--   skip_footer_rows       — INT >=0, default 0.
--   date_format_override   — TEXT, NULLABLE. 'DD/MM/YYYY' / 'MM/DD/YYYY' /
--                            'YYYY-MM-DD' when set; NULL = auto-detect.
--   default_currency       — TEXT, NULLABLE. ISO 4217 / supportedCurrencyEnum.
--
-- `default_account` is intentionally NOT here — `import_templates` already
-- has a `default_account` TEXT column from the original schema.
--
-- Pure additive. Idempotent. The runner in deploy.sh wraps the file in a
-- transaction with the schema_migrations bookkeeping insert — do NOT add
-- a BEGIN/COMMIT block here.

ALTER TABLE import_templates
  ADD COLUMN IF NOT EXISTS skip_header_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skip_footer_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS date_format_override TEXT,
  ADD COLUMN IF NOT EXISTS default_currency TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'import_templates_skip_header_rows_check'
  ) THEN
    ALTER TABLE import_templates
      ADD CONSTRAINT import_templates_skip_header_rows_check
      CHECK (skip_header_rows >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'import_templates_skip_footer_rows_check'
  ) THEN
    ALTER TABLE import_templates
      ADD CONSTRAINT import_templates_skip_footer_rows_check
      CHECK (skip_footer_rows >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'import_templates_date_format_override_check'
  ) THEN
    ALTER TABLE import_templates
      ADD CONSTRAINT import_templates_date_format_override_check
      CHECK (date_format_override IS NULL OR date_format_override IN ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'));
  END IF;
END $$;
