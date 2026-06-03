/**
 * apiHandler unit tests — FINLYNQ-107.
 *
 * Asserts the wrapper folds the four concerns:
 *   1. auth gating          — 401 (requireAuth) / 423 (requireEncryption)
 *   2. body parse/validate  — 400 apiError on schema failure / bad JSON
 *   3. catch → status map    — AppError.status honoured (not a bare 500),
 *                              mapError short-circuit wins first
 *   4. success envelope     — { success: true, data } (default) vs bare (raw)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";

// ─── Configurable auth mock state ───────────────────────────────────────────
type AuthState =
  | { kind: "ok"; userId: string; dek: Buffer | null; sessionId: string | null }
  | { kind: "unauthenticated" }
  | { kind: "locked" };

let authState: AuthState = {
  kind: "ok",
  userId: "user-1",
  dek: Buffer.alloc(32, 0xaa),
  sessionId: "sess-1",
};

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(async () => {
    if (authState.kind === "unauthenticated") {
      return {
        authenticated: false as const,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
    // "locked" still authenticates at requireAuth level but carries no DEK.
    const dek = authState.kind === "ok" ? authState.dek : null;
    const sessionId = authState.kind === "ok" ? authState.sessionId : null;
    const userId = authState.kind === "ok" ? authState.userId : "user-locked";
    return {
      authenticated: true as const,
      context: {
        userId,
        method: "account" as const,
        mfaVerified: false,
        dek,
        sessionId,
      },
    };
  }),
}));

// requireEncryption is the real implementation (it delegates to the mocked
// requireAuth and returns 423 when dek/sessionId are null).

vi.mock("@/lib/server-logger", () => ({
  logServerError: vi.fn(async () => undefined),
}));

import { apiHandler } from "@/lib/api-handler";
import { AppError } from "@/lib/validate";

function makeRequest(body?: unknown, method = "POST") {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  // NextRequest is constructed from a standard Request in the route runtime;
  // the wrapper only touches .json(), .method, .nextUrl.pathname / .url.
  return new Request("http://localhost:3000/api/test", init) as never;
}

beforeEach(() => {
  authState = {
    kind: "ok",
    userId: "user-1",
    dek: Buffer.alloc(32, 0xaa),
    sessionId: "sess-1",
  };
});

describe("apiHandler — success envelope (default mode)", () => {
  it("wraps the handler return value in { success: true, data }", async () => {
    const POST = apiHandler({ auth: "auth" }, async () => ({ hello: "world" }));
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, data: { hello: "world" } });
  });

  it("passes a handler-returned NextResponse through verbatim", async () => {
    const POST = apiHandler({ auth: "auth" }, async () =>
      NextResponse.json({ id: 42 }, { status: 201 }),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(201);
    const json = await res.json();
    // Verbatim — NOT wrapped in the envelope.
    expect(json).toEqual({ id: 42 });
  });

  it("exposes parsed body + auth context to the handler", async () => {
    const schema = z.object({ qty: z.number().int().positive() });
    const seen: Record<string, unknown> = {};
    const POST = apiHandler({ auth: "auth", body: schema }, async (ctx) => {
      seen.userId = ctx.userId;
      seen.qty = ctx.body.qty;
      seen.hasDek = ctx.dek instanceof Buffer;
      return { ok: true };
    });
    const res = await POST(makeRequest({ qty: 5 }));
    expect(res.status).toBe(200);
    expect(seen).toEqual({ userId: "user-1", qty: 5, hasDek: true });
  });
});

describe("apiHandler — body validation", () => {
  const schema = z.object({ qty: z.number().int().positive() });

  it("returns 400 apiError envelope on schema failure", async () => {
    const POST = apiHandler({ auth: "auth", body: schema }, async () => ({ ok: true }));
    const res = await POST(makeRequest({ qty: -1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(typeof json.error).toBe("string");
  });

  it("returns 400 on malformed JSON", async () => {
    const POST = apiHandler({ auth: "auth", body: schema }, async () => ({ ok: true }));
    const badReq = new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    }) as never;
    const res = await POST(badReq);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

describe("apiHandler — auth gating", () => {
  it("returns 401 when unauthenticated (auth mode)", async () => {
    authState = { kind: "unauthenticated" };
    const POST = apiHandler({ auth: "auth" }, async () => ({ ok: true }));
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 423 when encryption required but no DEK (encryption mode)", async () => {
    authState = { kind: "locked" };
    const POST = apiHandler({ auth: "encryption" }, async () => ({ ok: true }));
    const res = await POST(makeRequest());
    expect(res.status).toBe(423);
    const json = await res.json();
    expect(json.error).toBe("session_locked");
  });

  it("does not invoke the handler when auth fails", async () => {
    authState = { kind: "unauthenticated" };
    const handler = vi.fn(async () => ({ ok: true }));
    const POST = apiHandler({ auth: "auth" }, handler);
    await POST(makeRequest());
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("apiHandler — error mapping", () => {
  it("honours AppError.status instead of a bare 500", async () => {
    const POST = apiHandler({ auth: "auth", fallbackMessage: "fallback" }, async () => {
      throw new AppError("Insufficient balance", 422);
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Insufficient balance");
  });

  it("returns 500 + fallback message for a generic (non-AppError) throw", async () => {
    const POST = apiHandler({ auth: "auth", fallbackMessage: "Custom fallback" }, async () => {
      throw new Error("internal db detail that must not leak");
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Custom fallback");
  });

  it("runs mapError first and short-circuits on its NextResponse", async () => {
    const mapError = vi.fn(() =>
      NextResponse.json({ error: "mapped", code: "domain_x" }, { status: 409 }),
    );
    const POST = apiHandler({ auth: "auth", mapError }, async () => {
      throw new Error("boom");
    });
    const res = await POST(makeRequest());
    expect(mapError).toHaveBeenCalled();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toEqual({ error: "mapped", code: "domain_x" });
  });

  it("falls through to the generic path when mapError returns null", async () => {
    const mapError = vi.fn(() => null);
    const POST = apiHandler({ auth: "auth", mapError, fallbackMessage: "fb" }, async () => {
      throw new AppError("user-visible", 400);
    });
    const res = await POST(makeRequest());
    expect(mapError).toHaveBeenCalled();
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("user-visible");
  });
});

describe("apiHandler — raw/compat mode (bare-shape consumers)", () => {
  it("passes the handler's bare success body through unwrapped", async () => {
    const POST = apiHandler({ auth: "encryption", raw: true }, async () =>
      NextResponse.json({ id: 7 }, { status: 201 }),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(201);
    const json = await res.json();
    // Bare — no { success, data } envelope (matches mobile postPortfolioOperation).
    expect(json).toEqual({ id: 7 });
  });

  it("emits a bare { error } (no envelope) on a thrown AppError in raw mode", async () => {
    const POST = apiHandler({ auth: "encryption", raw: true }, async () => {
      throw new AppError("bare error", 400);
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "bare error" });
    expect(json.success).toBeUndefined();
  });

  it("keeps the mapError structured body bare in raw mode", async () => {
    const mapError = vi.fn(() =>
      NextResponse.json(
        { error: "no sleeve", code: "cash_sleeve_not_found", currency: "USD" },
        { status: 400 },
      ),
    );
    const POST = apiHandler({ auth: "encryption", raw: true, mapError }, async () => {
      throw new Error("boom");
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({
      error: "no sleeve",
      code: "cash_sleeve_not_found",
      currency: "USD",
    });
  });
});
