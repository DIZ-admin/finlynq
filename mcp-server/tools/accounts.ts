/**
 * MCP HTTP tool group: accounts (FINLYNQ-109 extraction).
 *
 * Handler bodies moved VERBATIM out of register-tools-pg.ts. The only edits
 * are the enclosing function wrapper + the shared-state destructure from ctx.
 * Do not reformat or re-logic the handlers.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  q,
  text,
  err,
  dataResponse,
  suggestionList,
  fuzzyFind,
  resolveAccountStrict,
  decryptNameish,
  supportedCurrencyEnum,
  type Row,
  type PgToolContext,
} from "./_shared";
import {
  sql,
} from "drizzle-orm";
import {
  z,
} from "zod";
import {
  encryptName,
  nameLookup,
} from "../../src/lib/crypto/encrypted-columns";
import {
} from "../../src/lib/fx/supported-currencies";
import {
  invalidateUser as invalidateUserTxCache,
} from "../../src/lib/mcp/user-tx-cache";
import { withConfirmation, PreviewAbortError } from "./_confirm";

export function registerAccountsTools(server: McpServer, ctx: PgToolContext) {
  const { db, userId, dek, encNote } = ctx;


  // ── add_account ────────────────────────────────────────────────────────────
  server.tool(
    "add_account",
    "Create a new financial account (bank, investment, credit card, etc.)",
    {
      name: z.string().describe("Account name (must be unique)"),
      type: z.enum(["A", "L"]).describe("Account type: 'A' for asset, 'L' for liability"),
      group: z.string().optional().describe("Account group (e.g. 'Banks', 'Credit Cards', 'Investment')"),
      currency: supportedCurrencyEnum.optional().describe("ISO 4217 currency code (default CAD). Issue #206: any currency in SUPPORTED_CURRENCIES is accepted; FX engine triangulates through USD."),
      note: z.string().optional().describe("Optional note"),
      alias: z.string().max(64).optional().describe("Optional short alias used to match the account when receipts or imports reference it by a non-canonical name (e.g. last 4 digits of a card, or a receipt label)."),
    },
    async ({ name, type, group, currency, note, alias }) => {
      // Stream D Phase 4 — plaintext name dropped; lookup-only collision check.
      const lookup = dek ? nameLookup(dek, name) : null;
      if (!lookup) return err("Cannot create account without an unlocked DEK (Stream D Phase 4).");
      const existing = await q(db, sql`
        SELECT id FROM accounts WHERE user_id = ${userId} AND name_lookup = ${lookup}
      `);
      if (existing.length) return err(`Account "${name}" already exists (id: ${existing[0].id})`);

      const aliasValue = alias && alias.trim() ? alias.trim() : null;
      const nameEnc = dek ? encryptName(dek, name) : { ct: null, lookup: null };
      const aliasEnc = dek ? encryptName(dek, aliasValue) : { ct: null, lookup: null };
      // Issue #233 — liability accounts default to `"Liability"` when group
      // is omitted/blank, matching the REST seam in `resolveDefaultGroup`.
      // Asset accounts keep the historical empty-string behavior.
      const resolvedGroup = (() => {
        const trimmed = (group ?? "").trim();
        if (trimmed) return trimmed;
        return type === "L" ? "Liability" : "";
      })();
      // Stream D Phase 4 — plaintext name/alias columns dropped.
      const result = await q(db, sql`
        INSERT INTO accounts (
          user_id, type, "group", currency, note,
          name_ct, name_lookup, alias_ct, alias_lookup
        )
        VALUES (
          ${userId}, ${type}, ${resolvedGroup}, ${currency ?? "CAD"}, ${encNote(note)},
          ${nameEnc.ct}, ${nameEnc.lookup}, ${aliasEnc.ct}, ${aliasEnc.lookup}
        )
        RETURNING id
      `);

      return text({ success: true, data: { accountId: result[0]?.id, message: `Account "${name}" created (${type === "A" ? "asset" : "liability"}, ${currency ?? "CAD"})${aliasValue ? `, alias "${aliasValue}"` : ""}` } });
    }
  );


  // ── update_account ─────────────────────────────────────────────────────────
  // Issue #234 (Phase 2) — added `accountId` exact-match param + switched
  // from `fuzzyFind` (which silently returned the first match on
  // ambiguity / `lo.includes("")` reverse-includes collapse) to
  // `resolveAccountStrict`. Same bug class as #230 (delete_account).
  server.tool(
    "update_account",
    "Update name, group, currency, note, or alias of an account. Pass exactly ONE of `accountId` (preferred, exact) or `account` (name/alias, fuzzy). Supplying both is allowed only when they resolve to the same account — a mismatch fails loud and does NOT update.",
    {
      accountId: z.number().int().positive().optional().describe("Account FK (accounts.id). Exact match — preferred. The only path that works without an unlocked DEK."),
      account: z.string().optional().describe("Current account name or alias (fuzzy matched against name; exact match on alias). Requires an unlocked DEK because account names live in encrypted columns post Stream D Phase 4. Pass `accountId` instead when no DEK is available."),
      name: z.string().optional().describe("New name"),
      group: z.string().optional().describe("New group"),
      currency: supportedCurrencyEnum.optional().describe("New ISO 4217 currency code (issue #206: full SUPPORTED_CURRENCIES list)."),
      note: z.string().optional().describe("New note"),
      alias: z.string().max(64).optional().describe("New alias — short shorthand used to match receipts/imports (e.g. last 4 digits of a card). Pass an empty string to clear."),
    },
    async ({ accountId, account, name, group, currency, note, alias }) => {
      if (accountId == null && (account == null || account === "")) {
        return err("Pass `accountId` (numeric) or `account` (name/alias) to identify the account.");
      }

      // Resolve via id first when supplied — the safe path that never depends
      // on the DEK. SELECT both encrypted columns so we can echo a name on
      // success when a DEK happens to be available.
      let acct: Row | null = null;
      if (accountId != null) {
        const rows = await q(db, sql`
          SELECT id, name_ct, alias_ct FROM accounts WHERE user_id = ${userId} AND id = ${accountId}
        `);
        if (!rows.length) return err(`Account #${accountId} not found.`);
        acct = decryptNameish(rows, dek)[0];
      }

      // Resolve via name (fuzzy). Refuses without a DEK — same shape as
      // delete_account (issue #230) and the stdio counterpart's refusal at
      // register-core-tools.ts.
      let resolvedByName: Row | null = null;
      if (account != null && account !== "") {
        if (!dek) {
          return err("Cannot resolve account by name without an unlocked DEK (Stream D Phase 4). Pass `accountId` instead.");
        }
        const rawAccounts = await q(db, sql`
          SELECT id, name_ct, alias_ct FROM accounts WHERE user_id = ${userId}
        `);
        const allAccounts = decryptNameish(rawAccounts, dek);
        const resolved = resolveAccountStrict(account, allAccounts);
        if (!resolved.ok) {
          const suggestions = suggestionList(account, allAccounts);
          if (resolved.reason === "ambiguous") {
            return err(`Ambiguous: "${account}" matches ${resolved.candidates.length} accounts. Did you mean: ${suggestions}? (Pass accountId to disambiguate.)`);
          }
          if (resolved.reason === "low_confidence") {
            return err(`Account "${account}" did not match strongly — closest is "${resolved.suggestion.name}" but no shared whitespace token. Did you mean: ${suggestions}? (Pass accountId to disambiguate.)`);
          }
          return err(`Account "${account}" not found. Did you mean: ${suggestions}?`);
        }
        resolvedByName = resolved.account;
      }

      // BOTH supplied — fail loud on mismatch, never silently prefer one.
      if (acct && resolvedByName) {
        if (Number(acct.id) !== Number(resolvedByName.id)) {
          return err(`Account mismatch: "${account}" resolves to #${Number(resolvedByName.id)}, but accountId=${Number(acct.id)} was supplied.`);
        }
      } else if (!acct && resolvedByName) {
        acct = resolvedByName;
      }
      if (!acct) {
        return err("Pass `accountId` (numeric) or `account` (name/alias) to identify the account.");
      }

      // Stream D Phase 4 — plaintext name/alias dropped; only encrypted columns.
      const updates: ReturnType<typeof sql>[] = [];
      if (name !== undefined) {
        if (!dek) return err("Cannot rename account without an unlocked DEK (Stream D Phase 4).");
        const n = encryptName(dek, name);
        updates.push(sql`name_ct = ${n.ct}`, sql`name_lookup = ${n.lookup}`);
      }
      if (group !== undefined) updates.push(sql`"group" = ${group}`);
      if (currency !== undefined) updates.push(sql`currency = ${currency}`);
      if (note !== undefined) updates.push(sql`note = ${encNote(note)}`);
      if (alias !== undefined) {
        const trimmed = alias.trim();
        const aliasValue = trimmed ? trimmed : null;
        if (!dek) return err("Cannot update alias without an unlocked DEK (Stream D Phase 4).");
        const a = encryptName(dek, aliasValue);
        updates.push(sql`alias_ct = ${a.ct}`, sql`alias_lookup = ${a.lookup}`);
      }
      if (!updates.length) return err("No fields to update");

      const result = await db.execute(
        sql`UPDATE accounts SET ${sql.join(updates, sql`, `)} WHERE id = ${acct.id} AND user_id = ${userId}`
      );
      // pg returns { rowCount }; some drivers expose it differently. If the update
      // touched 0 rows the ownership check in WHERE failed (e.g. race with delete).
      const affected =
        (result && typeof result === "object" && "rowCount" in result && typeof (result as { rowCount: unknown }).rowCount === "number")
          ? (result as { rowCount: number }).rowCount
          : null;
      const acctNameLabel = (acct.name as string | undefined) ?? "<encrypted>";
      const acctIdLabel = Number(acct.id);
      if (affected === 0) return err(`Account #${acctIdLabel} ("${acctNameLabel}") not found or not owned by this user`);
      return text({ success: true, data: { accountId: acctIdLabel, message: `Account #${acctIdLabel} ("${acctNameLabel}") updated` } });
    }
  );


  // ── delete_account ─────────────────────────────────────────────────────────
  // Issue #230 (HOTFIX, 2026-05-10): the previous handler called `fuzzyFind`
  // on rows that only carried `name_ct` / `alias_ct` (Stream D Phase 4) and
  // never decrypted them. With every `o.name === undefined`, `fuzzyFind`'s
  // last-resort `lo.includes(String(o.name ?? "").toLowerCase())` waterfall
  // step collapsed to `lo.includes("")` — unconditionally true — and quietly
  // returned the FIRST account in the SELECT result. Combined with `force=true`
  // and FK CASCADE on `accounts → transactions / holding_accounts /
  // goal_accounts`, the wrong-target was a data-loss-risk class. Same bug
  // class as #211 (delete_budget / delete_loan) and #214 (create_rule).
  //
  // Fix: add an `accountId` (numeric, exact) param, mark `account` optional,
  // require exactly one. Refuse the name path without an unlocked DEK (stdio
  // already does this — `register-core-tools.ts` lines 1322-1326). Decrypt
  // BEFORE fuzzy-matching. Echo both id + name in success/error messages so
  // the caller can verify the resolved target.
  //
  // FK CASCADE remains DB-side: deleting an account drops its `transactions`,
  // `holding_accounts`, and `goal_accounts` rows automatically — no
  // application-layer child DELETEs needed.
  // FINLYNQ-264 Phase 1 (tier-1 — biggest blast radius): a non-empty /
  // force delete CASCADEs the account's transactions + holding_accounts +
  // goal_accounts, so it now requires the preview→token two-step. A CLEAN,
  // EMPTY account (no transactions) still deletes directly (the `required`
  // predicate returns false → no token needed). Resolution (id/name, mismatch
  // guard, DEK refusal) is unchanged and shared across every phase via the
  // memoized `resolve()`; the token payload binds the resolved id + force flag.
  type DeleteAccountArgs = {
    accountId?: number;
    account?: string;
    force?: boolean;
    confirmation_token?: string;
    // memo slots (populated by resolve(), reused across required/preview/commit)
    __acct?: Row;
    __count?: number;
  };

  /**
   * Resolve the target account + its transaction count ONCE per tool call,
   * memoized on the args object so `required`/`tokenPayload`/`preview`/`commit`
   * share the same result. Aborts (PreviewAbortError) on any resolution failure
   * so the middleware surfaces a clean tool error and mints no token.
   */
  async function resolveDeleteAccount(a: DeleteAccountArgs): Promise<{ acct: Row; count: number }> {
    if (a.__acct) return { acct: a.__acct, count: a.__count ?? 0 };
    const { accountId, account } = a;
    if (accountId == null && (account == null || account === "")) {
      throw new PreviewAbortError("Pass `accountId` (numeric) or `account` (name/alias) to identify the account.");
    }
    // Resolve via id first when supplied — the safe path that never depends on
    // the DEK. SELECT both encrypted columns so we can echo a name.
    let acct: Row | null = null;
    if (accountId != null) {
      const rows = await q(db, sql`
        SELECT id, name_ct, alias_ct FROM accounts WHERE user_id = ${userId} AND id = ${accountId}
      `);
      if (!rows.length) throw new PreviewAbortError(`Account #${accountId} not found.`);
      acct = decryptNameish(rows, dek)[0];
    }
    // Resolve via name (fuzzy). Refuses without a DEK.
    let resolvedByName: Row | null = null;
    if (account != null && account !== "") {
      if (!dek) {
        throw new PreviewAbortError("Cannot resolve account by name without an unlocked DEK (Stream D Phase 4). Pass `accountId` instead.");
      }
      const rawAccounts = await q(db, sql`
        SELECT id, name_ct, alias_ct FROM accounts WHERE user_id = ${userId}
      `);
      const allAccounts = decryptNameish(rawAccounts, dek);
      resolvedByName = fuzzyFind(account, allAccounts);
      if (!resolvedByName) {
        throw new PreviewAbortError(`Account "${account}" not found. Did you mean: ${suggestionList(account, allAccounts)}?`);
      }
    }
    // Both supplied — fail loud on mismatch.
    if (acct && resolvedByName) {
      if (Number(acct.id) !== Number(resolvedByName.id)) {
        throw new PreviewAbortError(`Account mismatch: "${account}" resolves to #${Number(resolvedByName.id)}, but accountId=${Number(acct.id)} was supplied.`);
      }
    } else if (!acct && resolvedByName) {
      acct = resolvedByName;
    }
    if (!acct) {
      throw new PreviewAbortError("Pass `accountId` (numeric) or `account` (name/alias) to identify the account.");
    }
    const acctId = Number(acct.id);
    const txnCount = await q(db, sql`SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ${userId} AND account_id = ${acctId}`);
    const count = Number(txnCount[0]?.cnt ?? 0);
    a.__acct = acct;
    a.__count = count;
    return { acct, count };
  }

  server.tool(
    "delete_account",
    "Delete an account. Pass exactly ONE of `accountId` (preferred, exact) or `account` (name/alias, fuzzy). A non-empty account (has transactions) or `force=true` is DESTRUCTIVE — it CASCADEs the account's transactions, holding_accounts, and goal_accounts — so it requires a two-step: the first call returns a preview (name + tx/holding/goal counts) + a confirmationToken (single-use, 5-min TTL) and deletes NOTHING; call again with the token to commit. A CLEAN, empty account deletes directly. Supplying both id + name is allowed only when they resolve to the same account.",
    {
      accountId: z.number().int().positive().optional().describe("Account FK (accounts.id). Exact match — preferred and the only way to delete an account when the user's DEK is not unlocked."),
      account: z.string().optional().describe("Account name or alias (fuzzy matched against name; exact match on alias). Requires an unlocked DEK because account names live in encrypted columns post Stream D Phase 4. Pass `accountId` instead when no DEK is available."),
      force: z.boolean().optional().describe("Delete even if transactions exist. FK CASCADE removes the account's transactions, holding_accounts, and goal_accounts rows — irreversible. A non-empty delete ALWAYS requires the confirmation token regardless of this flag."),
      confirmation_token: z.string().optional().describe("Omit to preview; pass the preview's token to commit a non-empty/force delete. Single-use, 5-min TTL. Not needed to delete a clean empty account."),
    },
    withConfirmation<DeleteAccountArgs>(userId, {
      operation: "delete_account",
      tokenPayload: (a) => ({ accountId: a.__acct ? Number(a.__acct.id) : null, force: a.force === true }),
      // Gate ON when force OR the account has transactions; skip (direct delete)
      // for a clean empty account. resolve() runs here first, so the memo is
      // primed for tokenPayload/preview/commit.
      required: async (a) => {
        const { count } = await resolveDeleteAccount(a);
        return a.force === true || count > 0;
      },
      preview: async (a) => {
        const { acct, count } = await resolveDeleteAccount(a);
        const acctId = Number(acct.id);
        const holdingCount = Number(
          (await q(db, sql`SELECT COUNT(*) AS cnt FROM holding_accounts WHERE user_id = ${userId} AND account_id = ${acctId}`))[0]?.cnt ?? 0,
        );
        const goalCount = Number(
          (await q(db, sql`SELECT COUNT(*) AS cnt FROM goal_accounts WHERE user_id = ${userId} AND account_id = ${acctId}`))[0]?.cnt ?? 0,
        );
        return {
          accountId: acctId,
          name: (acct.name as string | undefined) ?? "<encrypted>",
          transactionCount: count,
          holdingLinkCount: holdingCount,
          goalLinkCount: goalCount,
          cascades: "transactions, holding_accounts, goal_accounts",
        };
      },
      commit: async (a) => {
        const { acct, count } = await resolveDeleteAccount(a);
        const acctId = Number(acct.id);
        const acctName = (acct.name as string | undefined) ?? "<encrypted>";
        // FK CASCADE: this DELETE drops `transactions`, `holding_accounts`, and
        // `goal_accounts` rows for this account in the same DB transaction.
        await db.execute(sql`DELETE FROM accounts WHERE id = ${acctId} AND user_id = ${userId}`);
        // CLAUDE.md invariant: every MCP tx-mutating write must invalidate the
        // per-user tx cache. Mirrors `delete_budget` precedent.
        invalidateUserTxCache(userId);
        return text({
          success: true,
          data: {
            accountId: acctId,
            message: `Account #${acctId} ("${acctName}") deleted${count > 0 ? ` (${count} transactions also removed)` : ""}`,
          },
        });
      },
    }),
  );


  // ── set_account_mode ────────────────────────────────────────────────────────
  // Owner-scoped UPDATE of the per-account pipeline policy. NOT a transactions
  // write → no invalidateUser. 0 rows (cross-tenant / missing) → "Not found".
  server.tool(
    "set_account_mode",
    "Set an account's import pipeline mode. 'auto' fires rules at upload, 'approve' reviews each row, 'manual' fires rules at materialize. Returns {id, mode}. Cross-tenant / missing id → Not found.",
    {
      accountId: z.number().int().positive().describe("accounts.id."),
      mode: z
        .enum(["auto", "approve", "manual"])
        .describe("New pipeline mode for this account."),
    },
    async ({ accountId, mode }) => {
      const rows = await q(
        db,
        sql`
          UPDATE accounts SET mode = ${mode}
          WHERE id = ${accountId} AND user_id = ${userId}
          RETURNING id, mode
        `,
      );
      if (!rows.length) return err("Not found");
      return dataResponse({ id: Number(rows[0].id), mode: String(rows[0].mode) });
    },
  );
}
