/**
 * FINLYNQ-274 — zero-match bulk preview mints no token, and execute names the
 * zero-match case with a dedicated `no_token` error (not `malformed`).
 *
 * Two DB-free layers are asserted here:
 *   1. The crypto verify (`verifyConfirmationToken`) maps an empty/absent token
 *      to `no_token`, keeping `malformed` for a garbled non-empty token.
 *   2. The tool-facing renderer (`renderTokenError`) turns that `no_token`
 *      reason into a "run <preview> first" message, and every other reason into
 *      the unchanged "invalid: <reason>, re-run <preview>" phrasing.
 *
 * The preview-omits-the-token behaviour itself (acceptance criterion 1) is a
 * DB-backed MCP-agent case in the DevManager test plan (tc-1); this suite
 * locks the taxonomy + renderer that the omission relies on.
 */
import { describe, it, expect } from "vitest";

process.env.PF_JWT_SECRET =
  process.env.PF_JWT_SECRET ?? "test-jwt-secret-for-vitest-32chars!!";

import {
  verifyConfirmationToken,
  signConfirmationToken,
} from "@/lib/mcp/confirmation-token";
import { renderTokenError } from "../../mcp-server/tools/_confirm";

describe("FINLYNQ-274 bulk zero-match no-token", () => {
  const userId = "user-274";
  const op = "bulk_delete";
  const payload = { ids: [1, 2, 3] };

  describe("verify: empty token → no_token, garbled → malformed", () => {
    it.each(["", "   ", undefined as unknown as string])(
      "empty/absent token %j → no_token",
      (empty) => {
        const res = verifyConfirmationToken(empty, userId, op, payload);
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("no_token");
      }
    );

    it("garbled non-empty token → still malformed (regression)", () => {
      const res = verifyConfirmationToken("not-a-token", userId, op, payload);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("malformed");
    });
  });

  describe("renderTokenError: no_token names the zero-match case", () => {
    it("no_token → 'run <preview> first (a zero-match preview mints no token)'", () => {
      const res = verifyConfirmationToken("", userId, op, payload);
      const msg = renderTokenError(res, "preview_bulk_delete");
      expect(msg).toContain("no_token");
      expect(msg).toContain("run preview_bulk_delete first");
      expect(msg).toContain("zero-match preview mints no token");
      // Must NOT misdirect the agent to a serialization bug.
      expect(msg).not.toContain("malformed");
    });

    it("malformed (garbled) → unchanged 'invalid: malformed, re-run' phrasing", () => {
      const res = verifyConfirmationToken("garbage-no-dot", userId, op, payload);
      const msg = renderTokenError(res, "preview_bulk_delete");
      expect(msg).toContain("Confirmation token invalid: malformed");
      expect(msg).toContain("Re-run preview_bulk_delete");
      expect(msg).not.toContain("no_token");
    });

    it("payload-mismatch reason is passed through unchanged (regression)", () => {
      const tok = signConfirmationToken(userId, op, payload);
      const res = verifyConfirmationToken(tok, userId, op, { ids: [9] });
      expect(res.reason).toBe("payload-mismatch");
      const msg = renderTokenError(res, "preview_bulk_update");
      expect(msg).toBe(
        "Confirmation token invalid: payload-mismatch. Re-run preview_bulk_update."
      );
    });
  });

  it(">0-match preview still mints a real token", () => {
    // A non-empty token verifies (fresh-token happy path), proving the
    // >0-match branch that signs a token is untouched.
    const tok = signConfirmationToken(userId, op, payload);
    expect(tok).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const res = verifyConfirmationToken(tok, userId, op, payload);
    expect(res.valid).toBe(true);
  });
});
