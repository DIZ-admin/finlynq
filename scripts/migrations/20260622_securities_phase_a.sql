-- Securities master (Tier 2) — Phase A: additive schema.
-- Plan: finlynq-cloud/app-plan/securities-master-plan.md (§7 Phase A).
--
-- Creates the `securities` identity table, adds the nullable `security_id` FK
-- to `portfolio_holdings`, and a per-user backfill stamp on `users`. Nothing
-- reads or writes these yet (Phase B dual-writes, Phase C/login backfills,
-- Phase D flips reads behind a flag). Fully additive + idempotent — safe to
-- re-run, reversible by dropping the table/columns.
--
-- `cluster_key` is the privacy-preserving cluster discriminator (see
-- src/lib/securities/canonical.ts): `eq:<symbol_lookup>` / `crypto:<…>` /
-- `metal:<…>` (HMAC, ticker-hiding) for symbol-bearing positions,
-- `cash#<CCY>` (plaintext currency, non-sensitive) for cash sleeves,
-- `custom:<name_lookup>` for symbol-less user holdings. The
-- (user_id, cluster_key) unique index keeps find-or-create concurrency-safe
-- and clustering provably equivalent to the legacy canonicalKey partition.

CREATE TABLE IF NOT EXISTS securities (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  cluster_key   TEXT NOT NULL,
  asset_type    TEXT NOT NULL,                 -- stock|etf|crypto|cash|metal|custom (display)
  currency      TEXT NOT NULL DEFAULT 'USD',   -- quote/trading currency
  is_cash       BOOLEAN NOT NULL DEFAULT FALSE,
  is_crypto     INTEGER DEFAULT 0,
  symbol_ct     TEXT,
  symbol_lookup TEXT,
  name_ct       TEXT,
  name_lookup   TEXT,
  image         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One security per (user, cluster). Backs the find-or-create 23505 re-select.
CREATE UNIQUE INDEX IF NOT EXISTS securities_user_cluster_idx
  ON securities (user_id, cluster_key);
CREATE INDEX IF NOT EXISTS securities_user_idx ON securities (user_id);

-- Nullable FK on positions. ON DELETE SET NULL so deleting a security never
-- orphans a position (positions/lots/transactions are the durable record).
ALTER TABLE portfolio_holdings
  ADD COLUMN IF NOT EXISTS security_id INTEGER
  REFERENCES securities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS portfolio_holdings_security_idx
  ON portfolio_holdings (security_id);

-- Per-user one-time backfill stamp (login-time backfill short-circuits on it,
-- mirroring users.portfolio_names_canonicalized_at).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS securities_backfilled_at TIMESTAMPTZ;
