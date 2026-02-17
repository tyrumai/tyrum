import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import { McpManager } from "../../src/modules/agent/mcp-manager.js";

const mockServerPath = fileURLToPath(
  new URL("../fixtures/mcp/mock-server.mjs", import.meta.url),
);

describe("McpManager (stdio)", () => {
  const manager = new McpManager();

  afterEach(async () => {
    await manager.shutdown();
  });

  it("discovers tools and can call a tool", async () => {
    const spec: McpServerSpecT = {
      id: "mock",
      name: "Mock MCP",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: [mockServerPath],
      timeout_ms: 2_000,
    };

    const tools = await manager.listToolDescriptors([spec]);
    expect(tools.map((tool) => tool.id)).toContain("mcp.mock.echo");

    const result = await manager.callTool(spec, "echo", { text: "hello" });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
  });
});

