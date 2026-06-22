/**
 * POST /api/settings/change-email — change the recovery email of the logged-in
 * account (managed edition only).
 *
 * Email is the recovery-only channel (username is the login handle), so we
 * require the current password to authorize the change, enforce the same
 * cross-column uniqueness as registration, then store the new address as
 * UNVERIFIED and mail a verification link (Finding #10: store the SHA-256 of
 * the raw token; the raw token rides in the emailed link). The send is
 * best-effort — a missing SMTP config never blocks the change.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { getDialect } from "@/db";
import { requireAuth } from "@/lib/auth/require-auth";
import { verifyPassword } from "@/lib/auth";
import {
  getUserById,
  getUserByEmail,
  isIdentifierClaimed,
  updateUserEmail,
} from "@/lib/auth/queries";
import { sendEmail, emailVerificationEmail } from "@/lib/email";
import { validateBody, safeErrorMessage, logApiError } from "@/lib/validate";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  newEmail: z.string().email("Invalid email address").max(254),
  currentPassword: z.string().min(1, "Current password is required").max(256),
});

export async function POST(request: NextRequest) {
  if (getDialect() !== "postgres") {
    return NextResponse.json(
      { error: "Changing your email is only available in managed mode." },
      { status: 403 },
    );
  }

  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  const { userId } = auth.context;

  // Per-user rate limit: 5 attempts per 15 minutes.
  const rl = checkRateLimit(`change-email:${userId}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  try {
    const parsed = validateBody(await request.json(), bodySchema);
    if (parsed.error) return parsed.error;
    const newEmail = parsed.data.newEmail.trim();
    const { currentPassword } = parsed.data;

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // Require the current password to authorize a recovery-channel change.
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Your current password is incorrect." },
        { status: 400 },
      );
    }

    if ((user.email ?? "").toLowerCase() === newEmail.toLowerCase()) {
      return NextResponse.json(
        { error: "That is already your email address." },
        { status: 400 },
      );
    }

    // Same-column email uniqueness + cross-column collision (an email equal to
    // another account's username would break the username-first login lookup),
    // mirroring registration. DB partial unique index is the final backstop.
    const emailTaken = await getUserByEmail(newEmail);
    if (emailTaken && emailTaken.id !== userId) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }
    if (await isIdentifierClaimed(newEmail)) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }

    // Finding #10 — store only the SHA-256 of the verify token; mail the raw.
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await updateUserEmail(userId, newEmail, tokenHash);

    // Best-effort verification mail — never block the change on SMTP.
    sendEmail(emailVerificationEmail(newEmail, rawToken)).catch((err) => {
      console.error("[change-email] verification send failed", err);
    });

    return NextResponse.json({ success: true, email: newEmail });
  } catch (e) {
    await logApiError("POST", "/api/settings/change-email", e);
    return NextResponse.json(
      { error: safeErrorMessage(e, "Failed to change email.") },
      { status: 500 },
    );
  }
}
