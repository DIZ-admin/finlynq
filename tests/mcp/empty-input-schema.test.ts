import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { withAutoAnnotations } from "../../mcp-server/auto-annotations";

describe("MCP empty input schemas", () => {
  it("preserves the required object type when annotations are injected", async () => {
    const server = withAutoAnnotations(
      new McpServer({ name: "empty-schema-test", version: "0.0.0" }),
    );
    server.tool(
      "get_no_args",
      "A read-only tool with no arguments",
      {},
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (server.server as any)._requestHandlers as Map<
      string,
      (request: unknown, extra: unknown) => Promise<{ tools: Array<{ inputSchema: Record<string, unknown> }> }>
    >;
    const listHandler = handlers.get(ListToolsRequestSchema.shape.method.value);
    expect(listHandler).toBeDefined();

    const result = await listHandler!({ method: "tools/list", params: {} }, {});
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: {},
    });
  });
});
