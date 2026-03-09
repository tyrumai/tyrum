import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type McpServerSpec } from "@tyrum/schemas";
import { expect, it, vi } from "vitest";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import {
  createToolExecutor,
  requireHomeDir,
  stubMcpManager,
  type HomeDirState,
} from "./tool-executor.shared-test-support.js";

function createMcpSpec(id: string, name: string): McpServerSpec {
  return {
    id,
    name,
    enabled: true,
    transport: "stdio",
    command: "node",
  };
}

export function registerPathSandboxingTests(home: HomeDirState): void {
  it("rejects paths outside TYRUM_HOME via ..", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "read",
      "call-sb-1",
      { path: "../../../etc/passwd" },
    );

    expect(result.error).toContain("path escapes workspace");
  });

  it("rejects absolute paths outside TYRUM_HOME", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "read",
      "call-sb-2",
      { path: "/etc/passwd" },
    );

    expect(result.error).toContain("path escapes workspace");
  });

  it("allows paths inside TYRUM_HOME subdirectory", async () => {
    const homeDir = requireHomeDir(home);
    await mkdir(join(homeDir, "sub"), { recursive: true });
    await writeFile(join(homeDir, "sub/data.txt"), "nested content", "utf-8");

    const result = await createToolExecutor({ homeDir }).execute("read", "call-sb-3", {
      path: "sub/data.txt",
    });

    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("nested content");
    expect(result.error).toBeUndefined();
  });
}

export function registerMcpDelegationTests(home: HomeDirState): void {
  it("delegates to mcpManager.callTool for mcp.* tools", async () => {
    const callToolMock = vi.fn(async () => ({
      content: [{ type: "text", text: "calendar-result" }],
    }));
    const mcpManager = stubMcpManager({ callTool: callToolMock as McpManager["callTool"] });
    const spec = createMcpSpec("calendar", "Calendar MCP");

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager,
      mcpServerSpecs: new Map([["calendar", spec]]),
    }).execute("mcp.calendar.events_list", "call-mcp-1", {
      date: "2026-02-17",
    });

    expect(result.output).toContain("calendar-result");
    expect(result.output).toContain('<data source="web">');
    expect(result.error).toBeUndefined();
    expect(callToolMock).toHaveBeenCalledWith(spec, "events_list", { date: "2026-02-17" });
  });

  it("returns error for unknown MCP server", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "mcp.unknown.some_tool",
      "call-mcp-2",
      {},
    );

    expect(result.error).toBe("MCP server not found: unknown");
  });

  it("returns error for invalid MCP tool ID format", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "mcp.x",
      "call-mcp-3",
      {},
    );

    expect(result.error).toContain("invalid MCP tool ID");
  });

  it("handles MCP call errors gracefully", async () => {
    const callToolMock = vi.fn(async () => ({
      content: ["something went wrong"],
      isError: true,
    }));
    const mcpManager = stubMcpManager({ callTool: callToolMock as McpManager["callTool"] });
    const spec = createMcpSpec("broken", "Broken MCP");

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager,
      mcpServerSpecs: new Map([["broken", spec]]),
    }).execute("mcp.broken.do_thing", "call-mcp-4", {});

    expect(result.error).toBeTruthy();
  });
}
