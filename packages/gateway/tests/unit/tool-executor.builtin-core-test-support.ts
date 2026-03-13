import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { acquireWorkspaceLease, releaseWorkspaceLease } from "../../src/modules/workspace/lease.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  createToolExecutor,
  requireHomeDir,
  stubMcpManager,
  type HomeDirState,
} from "./tool-executor.shared-test-support.js";

export function registerToolExecutorBuiltinCoreTests(home: HomeDirState): void {
  it("mcp.memory.search delegates to the agent memory runtime", async () => {
    const memoryToolRuntime = {
      search: vi.fn(async () => ({
        status: "ok",
        query: "pizza",
        hits: [{ memory_item_id: "mem-1", kind: "note", preview: "pizza note" }],
      })),
      write: vi.fn(),
    };

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      memoryToolRuntime: memoryToolRuntime as never,
    }).execute("mcp.memory.search", "call-memory-search-1", {
      query: "pizza",
      limit: 1,
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("pizza note");
    expect(memoryToolRuntime.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "pizza", limit: 1 }),
    );
  });

  it("mcp.memory.write accepts supported writable kinds", async () => {
    const memoryToolRuntime = {
      search: vi.fn(),
      write: vi.fn(async () => ({ status: "ok", item: { memory_item_id: "mem-1" } })),
    };

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      memoryToolRuntime: memoryToolRuntime as never,
    }).execute("mcp.memory.write", "call-memory-add-1", {
      kind: "note",
      body_md: "remember this",
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("\"status\": \"ok\"");
    expect(memoryToolRuntime.write).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "note", body_md: "remember this" }),
      "call-memory-add-1",
    );
  });

  it("fs.read returns file content", async () => {
    const homeDir = requireHomeDir(home);
    await writeFile(join(homeDir, "test.txt"), "hello world", "utf-8");

    const result = await createToolExecutor({ homeDir }).execute("read", "call-1", {
      path: "test.txt",
    });

    expect(result.tool_call_id).toBe("call-1");
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("hello world");
    expect(result.error).toBeUndefined();
  });

  it("fs.read returns error for missing path argument", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "read",
      "call-2",
      {},
    );

    expect(result.error).toBe("missing required argument: path");
  });

  it("webfetch delegates to Exa crawling via MCP", async () => {
    const callToolMock = vi.fn(async () => ({
      content: [{ type: "text", text: "response-body" }],
    }));
    const dnsLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager: stubMcpManager({ callTool: callToolMock }),
      dnsLookup,
    }).execute("webfetch", "call-3", {
      url: "https://example.com/api",
      mode: "raw",
    });

    expect(result.output).toContain("response-body");
    expect(result.output).toContain('<data source="web">');
    expect(result.error).toBeUndefined();
    expect(callToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "exa",
        name: "Exa",
        transport: "remote",
        url: expect.stringContaining("https://mcp.exa.ai/mcp"),
      }),
      "crawling_exa",
      { url: "https://example.com/api" },
    );
    expect(dnsLookup).toHaveBeenCalledWith("example.com");
  });

  it("webfetch forwards the Exa API key from the secret provider", async () => {
    const callToolMock = vi.fn(async () => ({
      content: [{ type: "text", text: "response-body" }],
    }));
    const secretProvider = {
      resolve: vi.fn(async () => "exa-test-key"),
      store: vi.fn(),
      revoke: vi.fn(),
      list: vi.fn(async () => []),
    } as const;

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager: stubMcpManager({ callTool: callToolMock }),
      secretProvider,
    }).execute("webfetch", "call-3a", {
      url: "https://example.com/api",
      mode: "raw",
    });

    expect(result.error).toBeUndefined();
    expect(secretProvider.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ handle_id: "exa_api_key", scope: "exa_api_key" }),
    );
    expect(callToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "exa",
        url: expect.stringContaining("exaApiKey=exa-test-key"),
      }),
      "crawling_exa",
      { url: "https://example.com/api" },
    );
  });

  it("webfetch allows bare URL calls without requiring an extract prompt", async () => {
    const callToolMock = vi.fn(async () => ({
      content: [{ type: "text", text: "response-body" }],
    }));

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager: stubMcpManager({ callTool: callToolMock }),
    }).execute("webfetch", "call-3b", {
      url: "https://example.com/api",
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("response-body");
    expect(callToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "exa" }),
      "crawling_exa",
      { url: "https://example.com/api" },
    );
  });

  it("apply_patch accepts a trailing newline after the end marker", async () => {
    const homeDir = requireHomeDir(home);
    await writeFile(join(homeDir, "notes.txt"), "hello\n", "utf-8");

    const result = await createToolExecutor({ homeDir }).execute("apply_patch", "call-3c", {
      patch: [
        "*** Begin Patch",
        "*** Update File: notes.txt",
        "@@",
        "-hello",
        "+hi",
        "*** End Patch",
        "",
      ].join("\n"),
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("update notes.txt");
    await expect(readFile(join(homeDir, "notes.txt"), "utf-8")).resolves.toBe("hi\n");
  });

  it("http.fetch blocks requests to private network addresses", async () => {
    const callToolMock = vi.fn(async () => ({
      content: [{ type: "text", text: "should-not-fetch" }],
    }));

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager: stubMcpManager({ callTool: callToolMock }),
    }).execute("webfetch", "call-ssrf-1", {
      url: "http://169.254.169.254/latest/meta-data/",
    });

    expect(result.error).toContain("blocked url");
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it("http.fetch blocks hostnames that resolve to private addresses", async () => {
    const callToolMock = vi.fn(async () => ({
      content: [{ type: "text", text: "should-not-fetch" }],
    }));
    const dnsLookup = vi.fn(async () => [{ address: "10.0.0.42", family: 4 as const }]);

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager: stubMcpManager({ callTool: callToolMock }),
      dnsLookup,
    }).execute("webfetch", "call-ssrf-2", {
      url: "https://example.com/private",
    });

    expect(result.error).toContain("blocked url");
    expect(callToolMock).not.toHaveBeenCalled();
    expect(dnsLookup).toHaveBeenCalledWith("example.com");
  });

  it("http.fetch returns error for missing url", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "webfetch",
      "call-4",
      {},
    );

    expect(result.error).toBe("missing required argument: url");
  });

  it("grep returns a structured error for invalid regex patterns", async () => {
    const homeDir = requireHomeDir(home);
    await writeFile(join(homeDir, "notes.txt"), "hello world\n", "utf-8");

    const result = await createToolExecutor({ homeDir }).execute("grep", "call-4a", {
      path: ".",
      pattern: "[unterminated",
      regex: true,
    });

    expect(result.output).toBe("");
    expect(result.error).toContain("invalid regex pattern");
  });

  it("fs.write writes file content", async () => {
    const homeDir = requireHomeDir(home);

    const result = await createToolExecutor({ homeDir }).execute("write", "call-5", {
      path: "test.txt",
      content: "data",
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("Wrote");

    const written = await readFile(join(homeDir, "test.txt"), "utf-8");
    expect(written).toBe("data");
  });

  it("bash executes commands", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "bash",
      "call-6",
      {
        command: "echo hi",
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("hi");
    expect(result.output).toContain("[exit code:");
  });

  it("bash timeout includes workspace lease wait", async () => {
    const db = openTestSqliteDb();
    const tenantId = DEFAULT_TENANT_ID;
    const workspaceId = DEFAULT_WORKSPACE_ID;
    const timeoutMs = 600;
    const releaseAfterMs = 450;

    try {
      await acquireWorkspaceLease(db, {
        tenantId,
        workspaceId,
        owner: "other-owner",
        ttlMs: 60_000,
      });

      const releaseDone = new Promise<void>((resolve) => {
        setTimeout(() => {
          void releaseWorkspaceLease(db, {
            tenantId,
            workspaceId,
            owner: "other-owner",
          })
            .then(resolve)
            .catch(() => resolve());
        }, releaseAfterMs);
      });

      const executor = createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: {
          db,
          tenantId,
          agentId: null,
          workspaceId,
          ownerPrefix: "test-tool",
        },
      });

      const startedAtMs = Date.now();
      const result = await executor.execute("bash", "call-lease-timeout-1", {
        command: "sleep 1",
        timeout_ms: timeoutMs,
      });
      const durationMs = Date.now() - startedAtMs;

      await releaseDone;

      expect(result.error).toBeUndefined();
      expect(durationMs).toBeLessThan(timeoutMs + 250);
    } finally {
      await db.close();
    }
  });

  it("websearch delegates to Exa search via MCP", async () => {
    const callToolMock = vi.fn(async () => ({
      content: [{ type: "text", text: "search-result" }],
    }));

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager: stubMcpManager({ callTool: callToolMock }),
    }).execute("websearch", "call-websearch-1", {
      query: "site:example.com release notes",
      num_results: 3,
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("search-result");
    expect(callToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "exa" }),
      "web_search_exa",
      { query: "site:example.com release notes", numResults: 3 },
    );
  });

  it("codesearch delegates to Exa code context via MCP", async () => {
    const callToolMock = vi.fn(async () => ({
      content: [{ type: "text", text: "code-context" }],
    }));

    const result = await createToolExecutor({
      homeDir: requireHomeDir(home),
      mcpManager: stubMcpManager({ callTool: callToolMock }),
    }).execute("codesearch", "call-codesearch-1", {
      query: "react startTransition example",
      tokens_num: 1024,
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("code-context");
    expect(callToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "exa" }),
      "get_code_context_exa",
      { query: "react startTransition example", tokensNum: 1024 },
    );
  });

  it("unknown tool returns error", async () => {
    const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
      "tool.unknown",
      "call-8",
      {},
    );

    expect(result.error).toBe("unknown tool: tool.unknown");
  });

  it("rejects invalid automation schedule steps before dispatching to the service", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: null,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        identityScopeDal: new IdentityScopeDal(db),
      }).execute("tool.automation.schedule.create", "call-schedule-invalid-steps-1", {
        kind: "cron",
        cadence: { type: "interval", interval_ms: 60_000 },
        execution: {
          kind: "steps",
          steps: [{ type: "Nope", args: {} }],
        },
      });

      expect(result.output).toBe("");
      expect(result.error).toMatch(/invalid steps schedule action/i);
    } finally {
      await db.close();
    }
  });

  it("fails closed when automation schedule tools are invoked without a tenant id", async () => {
    const db = openTestSqliteDb();

    try {
      const result = await createToolExecutor({
        homeDir: requireHomeDir(home),
        workspaceLease: {
          db,
          tenantId: "   ",
          agentId: null,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        identityScopeDal: new IdentityScopeDal(db),
      }).execute("tool.automation.schedule.list", "call-schedule-missing-tenant-1", {});

      expect(result.output).toBe("");
      expect(result.error).toBe("tenantId is required");
    } finally {
      await db.close();
    }
  });
}
