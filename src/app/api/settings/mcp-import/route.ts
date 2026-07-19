/**
 * GET + PUT /api/settings/mcp-import
 *
 * Canonical per-user opt-in for Finlynq's import/reconciliation MCP toolset.
 * The setting is deliberately transport-independent: when enabled, it applies
 * to OAuth, Bearer API-key, stdio, and session-cookie MCP requests for this
 * user. The default is false when the setting is absent.
 */

import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { getImportToolsetEnabled, setImportToolsetEnabled } from "@/lib/mcp/import-toolset-setting";

export const dynamic = "force-dynamic";

const updateSchema = z.object({ enabled: z.boolean() });

export const GET = apiHandler(
  { auth: "auth", logPath: "GET /api/settings/mcp-import" },
  async ({ userId }) => ({ enabled: await getImportToolsetEnabled(userId) }),
);

export const PUT = apiHandler(
  {
    auth: "auth",
    body: updateSchema,
    logPath: "PUT /api/settings/mcp-import",
  },
  async ({ userId, body }) => ({
    enabled: await setImportToolsetEnabled(userId, body.enabled),
  }),
);
