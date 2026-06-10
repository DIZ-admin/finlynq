-- FINLYNQ-120 — encrypt plaintext staging metadata (2026-06-09).
--
-- Several staging-surface columns held PLAINTEXT PII / bank identity readable
-- by a DB-dump-only attacker:
--   - staged_imports.sample_rows (JSONB)      — raw statement rows (highest).
--   - staged_imports.original_filename        — leaks bank + account identity.
--   - staged_imports.subject / from_address   — leaks bank + account identity.
--   - bank_upload_batches.filename            — same leak, PERMANENT row.
--
-- These columns are now encrypted in-place with the SAME two-tier model as
-- staged_transactions / bank_transactions: 'service' (sv1: under
-- PF_STAGING_KEY, email-webhook ingest with no DEK) upgraded to 'user' (v1:
-- under the user's DEK) by the login-time sweep.
--
-- This migration is NON-DESTRUCTIVE: it ONLY adds the `encryption_tier` marker
-- columns (default 'service'). It does NOT rewrite existing column values —
-- those legacy plaintext rows have no sv1:/v1: marker, so the read helpers
-- (decryptStagingMeta / decryptSampleRows) pass them through unchanged. The
-- login-time upgrade job (upgrade-staging-metadata.ts) re-encrypts them to
-- 'user' tier on the owning user's next login.
--
-- Idempotent: safe to re-run. The deploy.sh runner wraps the file in a
-- transaction with the schema_migrations bookkeeping insert — do NOT add a
-- BEGIN/COMMIT block here.

-- ── staged_imports.encryption_tier ──────────────────────────────────────────
ALTER TABLE staged_imports
  ADD COLUMN IF NOT EXISTS encryption_tier TEXT NOT NULL DEFAULT 'service';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staged_imports_encryption_tier_check'
  ) THEN
    ALTER TABLE staged_imports
      ADD CONSTRAINT staged_imports_encryption_tier_check
      CHECK (encryption_tier IN ('service','user'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staged_imports_user_tier
  ON staged_imports (user_id, encryption_tier);

-- ── bank_upload_batches.encryption_tier ─────────────────────────────────────
ALTER TABLE bank_upload_batches
  ADD COLUMN IF NOT EXISTS encryption_tier TEXT NOT NULL DEFAULT 'service';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bank_upload_batches_encryption_tier_check'
  ) THEN
    ALTER TABLE bank_upload_batches
      ADD CONSTRAINT bank_upload_batches_encryption_tier_check
      CHECK (encryption_tier IN ('service','user'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_upload_batches_user_tier
  ON bank_upload_batches (user_id, encryption_tier);
