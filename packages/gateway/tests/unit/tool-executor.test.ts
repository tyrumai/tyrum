import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";
import {
  ToolExecutor,
  sanitizeEnv,
  isBlockedUrl,
  resolvesToBlockedAddress,
} from "../../src/modules/agent/tool-executor.js";
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

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.fs.read", "call-1", { path: "test.txt" });

      expect(result.tool_call_id).toBe("call-1");
      expect(result.output).toContain('<data source="tool">');
      expect(result.output).toContain("hello world");
      expect(result.error).toBeUndefined();
    });

    it("fs.read returns error for missing path argument", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.fs.read", "call-2", {});

      expect(result.error).toBe("missing required argument: path");
    });

    it("http.fetch performs outbound request", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const mockFetch = vi.fn(async () => ({
        text: async () => "response-body",
      })) as unknown as typeof fetch;
      const dnsLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        mockFetch,
        undefined,
        dnsLookup,
      );

      const result = await executor.execute("tool.http.fetch", "call-3", {
        url: "https://example.com/api",
      });

      expect(result.output).toContain("response-body");
      expect(result.output).toContain('<data source="web">');
      expect(result.error).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/api",
        expect.objectContaining({ method: "GET" }),
      );
      expect(dnsLookup).toHaveBeenCalledWith("example.com");
    });

    it("http.fetch blocks requests to private network addresses", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const mockFetch = vi.fn(async () => ({
        text: async () => "should-not-fetch",
      })) as unknown as typeof fetch;

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), mockFetch);

      const result = await executor.execute("tool.http.fetch", "call-ssrf-1", {
        url: "http://169.254.169.254/latest/meta-data/",
      });

      expect(result.error).toContain("blocked url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("http.fetch blocks hostnames that resolve to private addresses", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const mockFetch = vi.fn(async () => ({
        text: async () => "should-not-fetch",
      })) as unknown as typeof fetch;
      const dnsLookup = vi.fn(async () => [{ address: "10.0.0.42", family: 4 as const }]);

      const executor = new ToolExecutor(
        homeDir,
        stubMcpManager(),
        new Map(),
        mockFetch,
        undefined,
        dnsLookup,
      );

      const result = await executor.execute("tool.http.fetch", "call-ssrf-2", {
        url: "https://example.com/private",
      });

      expect(result.error).toContain("blocked url");
      expect(mockFetch).not.toHaveBeenCalled();
      expect(dnsLookup).toHaveBeenCalledWith("example.com");
    });

    it("http.fetch returns error for missing url", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.http.fetch", "call-4", {});
      expect(result.error).toBe("missing required argument: url");
    });

    it("fs.write writes file content", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.fs.write", "call-5", {
        path: "test.txt",
        content: "data",
      });

      expect(result.error).toBeUndefined();
      expect(result.output).toContain('<data source="tool">');
      expect(result.output).toContain("Wrote");

      const written = await readFile(join(homeDir, "test.txt"), "utf-8");
      expect(written).toBe("data");
    });

    it("tool.exec executes commands", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.exec", "call-6", { command: "echo hi" });

      expect(result.error).toBeUndefined();
      expect(result.output).toContain('<data source="tool">');
      expect(result.output).toContain("hi");
      expect(result.output).toContain("[exit code:");
    });

    it("tool.node.dispatch returns not-yet-available", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.node.dispatch", "call-7", {
        capability: "screen",
        action: "capture",
      });

      expect(result.error).toBe("tool not yet available");
    });

    it("unknown tool returns error", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.unknown", "call-8", {});

      expect(result.error).toBe("unknown tool: tool.unknown");
    });
  });

  describe("path sandboxing", () => {
    it("rejects paths outside TYRUM_HOME via ..", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.fs.read", "call-sb-1", {
        path: "../../../etc/passwd",
      });

      expect(result.error).toContain("path escapes workspace");
    });

    it("rejects absolute paths outside TYRUM_HOME", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.fs.read", "call-sb-2", { path: "/etc/passwd" });

      expect(result.error).toContain("path escapes workspace");
    });

    it("allows paths inside TYRUM_HOME subdirectory", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));
      await mkdir(join(homeDir, "sub"), { recursive: true });
      await writeFile(join(homeDir, "sub/data.txt"), "nested content", "utf-8");

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.fs.read", "call-sb-3", { path: "sub/data.txt" });

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

      const executor = new ToolExecutor(homeDir, mcpManager, specMap, fetch);

      const result = await executor.execute("mcp.calendar.events_list", "call-mcp-1", {
        date: "2026-02-17",
      });

      expect(result.output).toContain("calendar-result");
      expect(result.output).toContain('<data source="tool">');
      expect(result.error).toBeUndefined();
      expect(callToolMock).toHaveBeenCalledWith(spec, "events_list", { date: "2026-02-17" });
    });

    it("returns error for unknown MCP server", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("mcp.unknown.some_tool", "call-mcp-2", {});

      expect(result.error).toBe("MCP server not found: unknown");
    });

    it("returns error for invalid MCP tool ID format", async () => {
      homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("mcp.x", "call-mcp-3", {});

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

      const executor = new ToolExecutor(homeDir, mcpManager, specMap, fetch);

      const result = await executor.execute("mcp.broken.do_thing", "call-mcp-4", {});

      expect(result.error).toBeTruthy();
    });
  });
});

describe("sanitizeEnv", () => {
  it("strips TYRUM_* prefixed vars", () => {
    const env = { TYRUM_SECRET: "s", TYRUM_HOME: "/h", PATH: "/usr/bin" };
    const result = sanitizeEnv(env);
    expect(result).not.toHaveProperty("TYRUM_SECRET");
    expect(result).not.toHaveProperty("TYRUM_HOME");
    expect(result).toHaveProperty("PATH", "/usr/bin");
  });

  it("strips GATEWAY_* prefixed vars", () => {
    const env = { GATEWAY_PORT: "3000", GATEWAY_SECRET: "x", HOME: "/home/test" };
    const result = sanitizeEnv(env);
    expect(result).not.toHaveProperty("GATEWAY_PORT");
    expect(result).not.toHaveProperty("GATEWAY_SECRET");
    expect(result).toHaveProperty("HOME", "/home/test");
  });

  it("strips TELEGRAM_BOT_TOKEN exact match", () => {
    const env = { TELEGRAM_BOT_TOKEN: "tok123", TELEGRAM_OTHER: "safe" };
    const result = sanitizeEnv(env);
    expect(result).not.toHaveProperty("TELEGRAM_BOT_TOKEN");
    expect(result).toHaveProperty("TELEGRAM_OTHER", "safe");
  });

  it("preserves PATH, HOME, LANG, USER", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/u", LANG: "en_US.UTF-8", USER: "u" };
    const result = sanitizeEnv(env);
    expect(result).toEqual({ PATH: "/usr/bin", HOME: "/home/u", LANG: "en_US.UTF-8", USER: "u" });
  });

  it("accepts extra deny prefixes and names", () => {
    const env = { CUSTOM_KEY: "v", SECRET_X: "v2", KEEP: "ok" };
    const result = sanitizeEnv(env, ["CUSTOM_"], new Set(["SECRET_X"]));
    expect(result).not.toHaveProperty("CUSTOM_KEY");
    expect(result).not.toHaveProperty("SECRET_X");
    expect(result).toHaveProperty("KEEP", "ok");
  });

  it("skips entries with undefined values", () => {
    const env: NodeJS.ProcessEnv = { DEFINED: "yes", UNDEF: undefined };
    const result = sanitizeEnv(env);
    expect(result).toHaveProperty("DEFINED", "yes");
    expect(result).not.toHaveProperty("UNDEF");
  });
});

describe("env sanitization", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("tool.exec does not leak sensitive env vars", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-"));

    // Inject sensitive vars into the real process.env for this test
    const origTyrum = process.env["TYRUM_TEST_SECRET"];
    const origGateway = process.env["GATEWAY_TEST_SECRET"];
    process.env["TYRUM_TEST_SECRET"] = "should-not-appear";
    process.env["GATEWAY_TEST_SECRET"] = "should-not-appear-either";

    try {
      const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch);

      const result = await executor.execute("tool.exec", "call-env-1", { command: "env" });

      expect(result.error).toBeUndefined();
      expect(result.output).not.toContain("TYRUM_TEST_SECRET");
      expect(result.output).not.toContain("GATEWAY_TEST_SECRET");
      expect(result.output).toContain("PATH=");
    } finally {
      // Restore original env state
      if (origTyrum === undefined) delete process.env["TYRUM_TEST_SECRET"];
      else process.env["TYRUM_TEST_SECRET"] = origTyrum;

      if (origGateway === undefined) delete process.env["GATEWAY_TEST_SECRET"];
      else process.env["GATEWAY_TEST_SECRET"] = origGateway;
    }
  });
});

describe("SSRF protection", () => {
  // --- IPv6 ---

  it("blocks IPv6 loopback [::1]", () => {
    expect(isBlockedUrl("http://[::1]/")).toBe(true);
  });

  it("blocks IPv6 link-local [fe80::1]", () => {
    expect(isBlockedUrl("http://[fe80::1]/")).toBe(true);
  });

  it("blocks IPv6 unique-local [fc00::1]", () => {
    expect(isBlockedUrl("http://[fc00::1]/")).toBe(true);
  });

  it("blocks IPv6 unique-local [fd00::1]", () => {
    expect(isBlockedUrl("http://[fd00::1]/")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 [::ffff:127.0.0.1]", () => {
    expect(isBlockedUrl("http://[::ffff:127.0.0.1]/")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 [::ffff:10.0.0.1]", () => {
    expect(isBlockedUrl("http://[::ffff:10.0.0.1]/")).toBe(true);
  });

  // --- Numeric IPv4 evasion ---

  it("blocks decimal integer IP 2130706433 (127.0.0.1)", () => {
    expect(isBlockedUrl("http://2130706433/")).toBe(true);
  });

  it("blocks hex IP 0x7f000001 (127.0.0.1)", () => {
    expect(isBlockedUrl("http://0x7f000001/")).toBe(true);
  });

  it("blocks octal IP 0177.0.0.1 (127.0.0.1)", () => {
    expect(isBlockedUrl("http://0177.0.0.1/")).toBe(true);
  });

  // --- Cloud metadata ---

  it("blocks cloud metadata hostname metadata.google.internal", () => {
    expect(isBlockedUrl("http://metadata.google.internal/")).toBe(true);
  });

  // --- Standard private IPv4 ---

  it("blocks 10.x.x.x", () => {
    expect(isBlockedUrl("http://10.0.0.1/")).toBe(true);
  });

  it("blocks 172.16.x.x", () => {
    expect(isBlockedUrl("http://172.16.0.1/")).toBe(true);
  });

  it("blocks 192.168.x.x", () => {
    expect(isBlockedUrl("http://192.168.1.1/")).toBe(true);
  });

  it("blocks 169.254.x.x (link-local)", () => {
    expect(isBlockedUrl("http://169.254.169.254/")).toBe(true);
  });

  it("blocks 127.0.0.1", () => {
    expect(isBlockedUrl("http://127.0.0.1/")).toBe(true);
  });

  it("blocks localhost", () => {
    expect(isBlockedUrl("http://localhost/")).toBe(true);
  });

  // --- Allowed ---

  it("allows public hostname https://example.com", () => {
    expect(isBlockedUrl("https://example.com")).toBe(false);
  });

  it("allows public IP 8.8.8.8", () => {
    expect(isBlockedUrl("http://8.8.8.8/")).toBe(false);
  });

  it("blocks non-http URL schemes", () => {
    expect(isBlockedUrl("file:///etc/passwd")).toBe(true);
  });

  it("blocks when DNS resolves to a private IPv4", async () => {
    const blocked = await resolvesToBlockedAddress("https://safe.example/path", async () => [
      { address: "192.168.1.10", family: 4 },
    ]);
    expect(blocked).toBe(true);
  });

  it("allows when DNS resolves to public addresses only", async () => {
    const blocked = await resolvesToBlockedAddress("https://safe.example/path", async () => [
      { address: "8.8.8.8", family: 4 },
    ]);
    expect(blocked).toBe(false);
  });
});
