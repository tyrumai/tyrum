import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import { McpManager } from "../../src/modules/agent/mcp-manager.js";

const mockServerPath = fileURLToPath(
  new URL("../fixtures/mcp/mock-server.mjs", import.meta.url),
);

function firstTextContent(content: unknown[]): string {
  const first = content[0];
  if (!first || typeof first !== "object") return "";
  const text = (first as Record<string, unknown>)["text"];
  return typeof text === "string" ? text : "";
}

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

  it("reconciles disabled servers by stopping and evicting stale entries", async () => {
    const enabledSpec: McpServerSpecT = {
      id: "mock",
      name: "Mock MCP",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: [mockServerPath],
      timeout_ms: 2_000,
    };
    const disabledSpec: McpServerSpecT = { ...enabledSpec, enabled: false };

    await manager.listToolDescriptors([enabledSpec]);
    const beforeDisable = await manager.callTool(enabledSpec, "instance_id");
    expect(beforeDisable.isError).toBe(false);
    const firstInstanceId = firstTextContent(beforeDisable.content);
    expect(firstInstanceId.length).toBeGreaterThan(0);

    const disabledTools = await manager.listToolDescriptors([disabledSpec]);
    expect(disabledTools).toEqual([]);

    await manager.listToolDescriptors([enabledSpec]);
    const afterReEnable = await manager.callTool(enabledSpec, "instance_id");
    expect(afterReEnable.isError).toBe(false);
    const secondInstanceId = firstTextContent(afterReEnable.content);
    expect(secondInstanceId.length).toBeGreaterThan(0);

    expect(secondInstanceId).not.toBe(firstInstanceId);
  });
});

