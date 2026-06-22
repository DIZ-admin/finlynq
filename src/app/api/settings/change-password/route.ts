/**
 * POST /api/settings/change-password — change the password of the logged-in
 * account (managed edition only).
 *
 * Unlike the forgot-password reset (which WIPES data because the old password
 * is gone), this is a logged-in change: the user supplies their CURRENT
 * password, so we can unwrap the per-user DEK and RE-WRAP it under a KEK
 * derived from the new password. The DEK — and therefore all encrypted row
 * data — is preserved untouched. The re-wrap keeps the row's existing
 * `pepper_version` (login's lazy pepper-rotation handles target migration).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDialect } from "@/db";
import { requireAuth } from "@/lib/auth/require-auth";
import { hashPassword, verifyPassword } from "@/lib/auth";
import {
  getUserById,
  updateUserPasswordAndWrap,
} from "@/lib/auth/queries";
import {
  deriveKEK,
  unwrapDEK,
  wrapDEK,
  generateSalt,
  createWrappedDEKForPassword,
} from "@/lib/crypto/envelope";
import { validatePasswordStrength } from "@/lib/auth/password-policy";
import { validateBody, safeErrorMessage, logApiError } from "@/lib/validate";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(256),
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(256, "Password is too long")
    .refine((pw) => validatePasswordStrength(pw) === null, {
      message: "Password is too weak — see strength requirements",
    }),
});

export async function POST(request: NextRequest) {
  if (getDialect() !== "postgres") {
    return NextResponse.json(
      { error: "Changing your password is only available in managed mode." },
      { status: 403 },
    );
  }

  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  const { userId } = auth.context;

  // Per-user rate limit: 5 attempts per 15 minutes.
  const rl = checkRateLimit(`change-password:${userId}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  try {
    const parsed = validateBody(await request.json(), bodySchema);
    if (parsed.error) return parsed.error;
    const { currentPassword, newPassword } = parsed.data;

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // Verify the current password before changing anything.
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Your current password is incorrect." },
        { status: 400 },
      );
    }

    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: "Your new password must be different from the current one." },
        { status: 400 },
      );
    }

    const newHash = await hashPassword(newPassword);

    const hasEnvelope =
      !!user.kekSalt &&
      !!user.dekWrapped &&
      !!user.dekWrappedIv &&
      !!user.dekWrappedTag;

    let wrap: {
      kekSalt: string;
      dekWrapped: string;
      dekWrappedIv: string;
      dekWrappedTag: string;
    };

    if (hasEnvelope) {
      // Re-wrap the EXISTING DEK so encrypted row data stays readable. Derive
      // the old KEK with the row's pepper_version, unwrap, then wrap under a
      // fresh salt + KEK derived from the new password at the SAME pepper
      // version (preserving pepper_version is the safe choice).
      const pepperVersion = user.pepperVersion ?? 1;
      const oldSalt = Buffer.from(user.kekSalt!, "base64");
      let dek: Buffer;
      try {
        const oldKek = deriveKEK(currentPassword, oldSalt, pepperVersion);
        dek = unwrapDEK(oldKek, {
          salt: oldSalt,
          wrapped: Buffer.from(user.dekWrapped!, "base64"),
          iv: Buffer.from(user.dekWrappedIv!, "base64"),
          tag: Buffer.from(user.dekWrappedTag!, "base64"),
        });
      } catch (err) {
        // bcrypt verified the password, so a failure here means a corrupted
        // envelope (migration bug), not a wrong password. Surface, don't wipe.
        await logApiError("POST", "/api/settings/change-password (unwrap)", err);
        return NextResponse.json(
          { error: "Unable to re-encrypt your data. Please contact support." },
          { status: 500 },
        );
      }
      const newSalt = generateSalt();
      const newKek = deriveKEK(newPassword, newSalt, pepperVersion);
      const w = wrapDEK(newKek, dek, newSalt);
      wrap = {
        kekSalt: w.salt.toString("base64"),
        dekWrapped: w.wrapped.toString("base64"),
        dekWrappedIv: w.iv.toString("base64"),
        dekWrappedTag: w.tag.toString("base64"),
      };
    } else {
      // Pre-encryption account with no envelope yet (rare — login normally
      // promotes on first sign-in). There is no DEK to preserve, so mint a
      // fresh one wrapped by the new password.
      const { wrapped } = createWrappedDEKForPassword(newPassword);
      wrap = {
        kekSalt: wrapped.salt.toString("base64"),
        dekWrapped: wrapped.wrapped.toString("base64"),
        dekWrappedIv: wrapped.iv.toString("base64"),
        dekWrappedTag: wrapped.tag.toString("base64"),
      };
    }

    await updateUserPasswordAndWrap(userId, newHash, wrap);

    // The DEK itself is unchanged, so the current session (and any other
    // active sessions) keep working — no forced re-login, no cache update.
    return NextResponse.json({ success: true });
  } catch (e) {
    await logApiError("POST", "/api/settings/change-password", e);
    return NextResponse.json(
      { error: safeErrorMessage(e, "Failed to change password.") },
      { status: 500 },
    );
  }
}
