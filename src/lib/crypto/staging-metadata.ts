/**
 * FINLYNQ-120 — tier-aware encryption for `staged_imports` metadata columns
 * (`from_address`, `subject`, `original_filename`, `sample_rows`) and
 * `bank_upload_batches.filename`.
 *
 * These columns leaked PLAINTEXT PII / bank identity to a DB-dump-only
 * attacker:
 *   - sample_rows (JSONB) — raw statement rows, HIGHEST sensitivity.
 *   - original_filename / subject / from_address — leak bank + account identity.
 *   - bank_upload_batches.filename — same leak, and this row is PERMANENT.
 *
 * This module mirrors the PROVEN two-tier staged_transactions model:
 *   - User-tier (`v1:`): wrapped with the session DEK (web uploads, which have
 *     a DEK at upload time, and the login-time upgrade sweep).
 *   - Service-tier (`sv1:`): wrapped with PF_STAGING_KEY (the email webhook
 *     path, which has no DEK at receive time). Upgraded to user-tier by the
 *     login-time sweep (see upgrade-staging-metadata.ts).
 *
 * Read paths branch per-row on `staged_imports.encryption_tier` /
 * `bank_upload_batches.encryption_tier` — exactly like staged_transactions /
 * bank_transactions. Mixed tiers within a user are expected mid-upgrade.
 *
 * Crypto primitives are NOT re-implemented here — we delegate to the existing
 * `encryptField`/`tryDecryptField` (user DEK) and `encryptStaged`/
 * `decryptStaged` (service key) helpers.
 */

import { encryptField, tryDecryptField } from "@/lib/crypto/envelope";
import { encryptStaged, decryptStaged } from "@/lib/crypto/staging-envelope";

export type EncryptionTier = "service" | "user";

/**
 * Encrypt a scalar metadata string at the requested tier.
 *   - `user`: requires `dek`; returns a `v1:` envelope (or null for null input).
 *   - `service`: returns an `sv1:` envelope under PF_STAGING_KEY (dev fallback:
 *     plaintext passthrough when PF_STAGING_KEY is unset).
 */
export function encryptStagingMeta(
  value: string | null | undefined,
  tier: EncryptionTier,
  dek: Buffer | null,
): string | null {
  if (value == null) return null;
  if (tier === "user") {
    if (!dek) {
      throw new Error(
        "encryptStagingMeta: user-tier write requires an unlocked DEK",
      );
    }
    return encryptField(dek, value);
  }
  return encryptStaged(value);
}

/**
 * Decrypt a scalar metadata string, branching on the row's encryption tier.
 *   - `user`: decrypts with the DEK (returns null on auth-tag failure or when
 *     no DEK is available — NEVER leaks raw `v1:` ciphertext).
 *   - `service` (or unknown): decrypts the `sv1:` envelope under PF_STAGING_KEY.
 *
 * Legacy plaintext rows (no `v1:`/`sv1:` marker) pass through unchanged via the
 * underlying helpers.
 */
export function decryptStagingMeta(
  value: string | null | undefined,
  tier: string | null | undefined,
  dek: Buffer | null,
): string | null {
  if (value == null) return null;
  if (tier === "user") {
    // tryDecryptField returns null on auth-tag failure (load-bearing — never
    // the raw ciphertext). Without a DEK we also return null rather than leak
    // v1: ciphertext.
    return dek ? tryDecryptField(dek, value, "staged_imports.meta") : null;
  }
  return decryptStaged(value);
}

/**
 * Encrypt the `sample_rows` JSONB payload. We JSON-stringify the array and wrap
 * the resulting string as a single envelope, then store it back into the JSONB
 * column as a JSON string scalar. Returns:
 *   - `null` for null/empty input (column stays NULL),
 *   - the `v1:`/`sv1:` envelope STRING otherwise.
 *
 * Postgres JSONB accepts a bare JSON string scalar, so the existing
 * `jsonb("sample_rows")` column needs no type change.
 */
export function encryptSampleRows(
  rows: unknown,
  tier: EncryptionTier,
  dek: Buffer | null,
): string | null {
  if (rows == null) return null;
  // Don't encrypt an empty array — keep it as NULL-equivalent absent picker.
  if (Array.isArray(rows) && rows.length === 0) return null;
  const json = JSON.stringify(rows);
  return encryptStagingMeta(json, tier, dek);
}

/**
 * Decrypt the `sample_rows` JSONB payload, branching on tier. Returns the parsed
 * array (or null). Handles three shapes for backward-compat:
 *   - encrypted string envelope (`v1:`/`sv1:` prefixed) → decrypt + JSON.parse,
 *   - legacy plaintext JSON string scalar → JSON.parse,
 *   - legacy raw JSONB array (pre-FINLYNQ-120 plaintext rows) → pass through.
 *
 * NEVER throws — a parse/decrypt miss degrades to null (picker hides), matching
 * the permissive `asJsonArray()` boundary convention elsewhere.
 */
export function decryptSampleRows(
  stored: unknown,
  tier: string | null | undefined,
  dek: Buffer | null,
): Array<Record<string, string>> | null {
  if (stored == null) return null;
  // Legacy plaintext rows were stored as a raw JSONB array.
  if (Array.isArray(stored)) {
    return stored as Array<Record<string, string>>;
  }
  if (typeof stored !== "string") return null;
  const pt = decryptStagingMeta(stored, tier, dek);
  if (pt == null) return null;
  try {
    const parsed = JSON.parse(pt);
    return Array.isArray(parsed) ? (parsed as Array<Record<string, string>>) : null;
  } catch {
    return null;
  }
}
