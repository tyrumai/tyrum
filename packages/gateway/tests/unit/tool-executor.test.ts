import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import type { McpServerSpec } from "@tyrum/schemas";

function stubMcpManager(overrides?: Partial<McpManager>): McpManager {
  return {
    listToolDescriptors: vi.fn(async () => []),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "mcp-result" }] })),
    ...overrides,
  } as unknown as McpManager;
}

describe("ToolExecutor", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  describe("builtin routing", () => {
    it("fs.read returns file content", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));
      await writeFile(join(homeDir, "test.txt"), "hello world", "utf-8");

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "tool.fs.read",
        "call-1",
        { path: "test.txt" },
      );

      expect(result.tool_call_id).toBe("call-1");
      expect(result.output).toContain('<data source="tool">');
      expect(result.output).toContain("hello world");
      expect(result.error).toBeUndefined();
    });

    it("fs.read returns error for missing path argument", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute("tool.fs.read", "call-2", {});

      expect(result.error).toBe("missing required argument: path");
    });

    it("http.fetch performs outbound request", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const mockFetch = vi.fn(async () => ({
        text: async () => "response-body",
      })) as unknown as typeof fetch;

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        mockFetch,
      );

      const result = await executor.execute(
        "tool.http.fetch",
        "call-3",
        { url: "https://example.com/api" },
      );

      expect(result.output).toContain("response-body");
      expect(result.output).toContain('<data source="web">');
      expect(result.error).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("http.fetch blocks requests to private network addresses", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const mockFetch = vi.fn(async () => ({
        text: async () => "should-not-fetch",
      })) as unknown as typeof fetch;

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        mockFetch,
      );

      const result = await executor.execute(
        "tool.http.fetch",
        "call-ssrf-1",
        { url: "http://169.254.169.254/latest/meta-data/" },
      );

      expect(result.error).toContain("blocked url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("http.fetch returns error for missing url", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute("tool.http.fetch", "call-4", {});
      expect(result.error).toBe("missing required argument: url");
    });

    it("fs.write writes file content", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "tool.fs.write",
        "call-5",
        { path: "test.txt", content: "data" },
      );

      expect(result.error).toBeUndefined();
      expect(result.output).toContain('<data source="tool">');
      expect(result.output).toContain("Wrote");

      const written = await readFile(join(homeDir, "test.txt"), "utf-8");
      expect(written).toBe("data");
    });

    it("tool.exec executes commands", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "tool.exec",
        "call-6",
        { command: "echo hi" },
      );

      expect(result.error).toBeUndefined();
      expect(result.output).toContain('<data source="tool">');
      expect(result.output).toContain("hi");
      expect(result.output).toContain("[exit code:");
    });

    it("tool.node.dispatch returns not-yet-available", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "tool.node.dispatch",
        "call-7",
        { capability: "screen", action: "capture" },
      );

      expect(result.error).toBe("tool not yet available");
    });

    it("unknown tool returns error", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "tool.unknown",
        "call-8",
        {},
      );

      expect(result.error).toBe("unknown tool: tool.unknown");
    });
  });

  describe("path sandboxing", () => {
    it("rejects paths outside TYRUM_HOME via ..", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "tool.fs.read",
        "call-sb-1",
        { path: "../../../etc/passwd" },
      );

      expect(result.error).toContain("path escapes workspace");
    });

    it("rejects absolute paths outside TYRUM_HOME", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "tool.fs.read",
        "call-sb-2",
        { path: "/etc/passwd" },
      );

      expect(result.error).toContain("path escapes workspace");
    });

    it("allows paths inside TYRUM_HOME subdirectory", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));
      await mkdir(join(homeDir, "sub"), { recursive: true });
      await writeFile(join(homeDir, "sub/data.txt"), "nested content", "utf-8");

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "tool.fs.read",
        "call-sb-3",
        { path: "sub/data.txt" },
      );

      expect(result.output).toContain('<data source="tool">');
      expect(result.output).toContain("nested content");
      expect(result.error).toBeUndefined();
    });
  });

  describe("MCP delegation", () => {
    it("delegates to mcpManager.callTool for mcp.* tools", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const callToolMock = vi.fn(async () => ({
        content: [{ type: "text", text: "calendar-result" }],
      }));

      const mcpManager = stubMcpManager({ callTool: callToolMock as McpManager["callTool"] });

      const spec: McpServerSpec = {
        id: "calendar",
        name: "Calendar MCP",
        enabled: true,
        transport: "stdio",
        command: "node",
      };

      const specMap = new Map<string, McpServerSpec>([["calendar", spec]]);

      const executor = new ToolExecutor(
        homeDir,
        mcpManager,
        specMap,
        fetch,
      );

      const result = await executor.execute(
        "mcp.calendar.events_list",
        "call-mcp-1",
        { date: "2026-02-17" },
      );

      expect(result.output).toContain("calendar-result");
      expect(result.output).toContain('<data source="tool">');
      expect(result.error).toBeUndefined();
      expect(callToolMock).toHaveBeenCalledWith(
        spec,
        "events_list",
        { date: "2026-02-17" },
      );
    });

    it("returns error for unknown MCP server", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "mcp.unknown.some_tool",
        "call-mcp-2",
        {},
      );

      expect(result.error).toBe("MCP server not found: unknown");
    });

    it("returns error for invalid MCP tool ID format", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        fetch,
      );

      const result = await executor.execute(
        "mcp.x",
        "call-mcp-3",
        {},
      );

      expect(result.error).toContain("invalid MCP tool ID");
    });

    it("handles MCP call errors gracefully", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const callToolMock = vi.fn(async () => ({
        content: ["something went wrong"],
        isError: true,
      }));

      const mcpManager = stubMcpManager({ callTool: callToolMock as McpManager["callTool"] });

      const spec: McpServerSpec = {
        id: "broken",
        name: "Broken MCP",
        enabled: true,
        transport: "stdio",
        command: "node",
      };

      const specMap = new Map<string, McpServerSpec>([["broken", spec]]);

      const executor = new ToolExecutor(
        homeDir,
        mcpManager,
        specMap,
        fetch,
      );

      const result = await executor.execute(
        "mcp.broken.do_thing",
        "call-mcp-4",
        {},
      );

      expect(result.error).toBeTruthy();
    });
  });
});
