-- FINLYNQ-92 (2026-05-23): persist Yahoo's previousClose on price_cache so stock
-- day-change badges on /portfolio survive a cache hit.
--
-- Pre-fix, readPriceCache / readPriceCacheBulk returned hardcoded change:0,
-- changePct:0 on cache hit, so the badges only worked for the live-fetched
-- crypto path. The Yahoo `meta.previousClose` is already available in
-- fetchQuoteLive — this migration gives us a column to store it in.
--
-- Additive + nullable: safe under deploy.sh's schema_migrations runner. Existing
-- rows stay valid (NULL → readers fall back to change:0, changePct:0); rolls
-- forward naturally as today's cached rows roll over to tomorrow's date.

ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS previous_close DOUBLE PRECISION;
