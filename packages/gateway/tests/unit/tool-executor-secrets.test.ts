import { describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretResolutionAuditDal } from "../../src/modules/secret/resolution-audit-dal.js";
import type { SecretHandle } from "@tyrum/schemas";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function stubMcpManager(): McpManager {
  return {
    listToolDescriptors: vi.fn(async () => []),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "mcp-result" }] })),
  } as unknown as McpManager;
}

function stubSecretProvider(secrets: Map<string, string>): SecretProvider {
  const handles: SecretHandle[] = [...secrets.keys()].map((id) => ({
    handle_id: id,
    provider: "db" as const,
    scope: id,
    created_at: "",
  }));
  return {
    resolve: vi.fn(async (handle: SecretHandle) => secrets.get(handle.handle_id) ?? null),
    store: vi.fn(async () => ({
      handle_id: "h1",
      provider: "db" as const,
      scope: "test",
      created_at: "",
    })),
    revoke: vi.fn(async () => true),
    list: vi.fn(async () => handles),
  };
}

async function allowPublicDnsLookup() {
  return [{ address: "93.184.216.34", family: 4 }] as const;
}

describe("ToolExecutor secret resolution", () => {
  let homeDir: string | undefined;
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("resolves secret: prefixed arg values before execution", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));

    const mockFetch = vi.fn(async () => ({
      text: async () => "api-response",
    })) as unknown as typeof fetch;

    const secrets = new Map([["handle-abc", "my-api-key-value"]]);
    const provider = stubSecretProvider(secrets);

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      mockFetch,
      provider,
      allowPublicDnsLookup,
    );

    await executor.execute("tool.http.fetch", "call-1", {
      url: "https://api.example.com",
      headers: { Authorization: "secret:handle-abc" },
    });

    // The fetch should have been called with the resolved secret value
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "my-api-key-value",
        }),
      }),
    );
  });

  it("records audit rows for resolved secrets when audit context is provided", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));
    db = openTestSqliteDb();

    const mockFetch = vi.fn(async () => ({
      text: async () => "ok",
    })) as unknown as typeof fetch;

    const secrets = new Map([["handle-abc", "my-api-key-value"]]);
    const provider = stubSecretProvider(secrets);

    const auditDal: SecretResolutionAuditDal = {
      record: vi.fn(async () => {
        return {
          tenant_id: DEFAULT_TENANT_ID,
          secret_resolution_id: "sr-1",
          tool_call_id: "call-1",
          tool_id: "tool.http.fetch",
          handle_id: "handle-abc",
          provider: "db",
          scope: "handle-abc",
          agent_id: "default",
          workspace_id: "default",
          session_id: "s1",
          channel: "telegram",
          thread_id: "t1",
          policy_snapshot_id: "ps-1",
          outcome: "resolved",
          error: null,
          occurred_at: new Date().toISOString(),
        };
      }),
    } as unknown as SecretResolutionAuditDal;

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      mockFetch,
      provider,
      allowPublicDnsLookup,
      undefined,
      auditDal,
      {
        db,
        tenantId: DEFAULT_TENANT_ID,
        agentId: null,
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
    );

    await executor.execute(
      "tool.http.fetch",
      "call-1",
      {
        url: "https://api.example.com",
        headers: { Authorization: "secret:handle-abc" },
      },
      {
        agent_id: "default",
        workspace_id: "default",
        session_id: "s1",
        channel: "telegram",
        thread_id: "t1",
        policy_snapshot_id: "ps-1",
      },
    );

    expect(auditDal.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: DEFAULT_TENANT_ID,
        toolCallId: "call-1",
        toolId: "tool.http.fetch",
        handleId: "handle-abc",
        provider: "db",
        scope: "handle-abc",
        sessionId: "s1",
        channel: "telegram",
        threadId: "t1",
        policySnapshotId: "ps-1",
        outcome: "resolved",
      }),
    );
  });

  it("does not write secret audit rows when tenant context is missing", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));
    db = openTestSqliteDb();

    const mockFetch = vi.fn(async () => ({
      text: async () => "ok",
    })) as unknown as typeof fetch;

    const provider = stubSecretProvider(new Map([["handle-abc", "my-api-key-value"]]));
    const auditDal: SecretResolutionAuditDal = {
      record: vi.fn(async () => {
        throw new Error("should not be called");
      }),
    } as unknown as SecretResolutionAuditDal;

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      mockFetch,
      provider,
      allowPublicDnsLookup,
      undefined,
      auditDal,
      {
        db,
        tenantId: "   ",
        agentId: null,
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
    );

    await executor.execute(
      "tool.http.fetch",
      "call-missing-tenant-audit",
      {
        url: "https://api.example.com",
        headers: { Authorization: "secret:handle-abc" },
      },
      {
        agent_id: "default",
        workspace_id: "default",
      },
    );

    expect(auditDal.record).not.toHaveBeenCalled();
  });

  it("redacts resolved secret values from tool output", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));

    const mockFetch = vi.fn(async () => ({
      text: async () => "Response contains my-api-key-value in the body",
    })) as unknown as typeof fetch;

    const secrets = new Map([["handle-abc", "my-api-key-value"]]);
    const provider = stubSecretProvider(secrets);

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      mockFetch,
      provider,
      allowPublicDnsLookup,
    );

    const result = await executor.execute("tool.http.fetch", "call-2", {
      url: "https://api.example.com",
      headers: { Authorization: "secret:handle-abc" },
    });

    expect(result.output).not.toContain("my-api-key-value");
    expect(result.output).toContain("[REDACTED]");
  });

  it("passes args through unchanged when no secret provider", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));
    await writeFile(join(homeDir, "test.txt"), "file content", "utf-8");

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      fetch,
      // no secret provider
    );

    const result = await executor.execute("tool.fs.read", "call-3", { path: "test.txt" });

    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("file content");
  });

  it("leaves non-secret string args unchanged", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));

    const mockFetch = vi.fn(async () => ({
      text: async () => "ok",
    })) as unknown as typeof fetch;

    const secrets = new Map<string, string>();
    const provider = stubSecretProvider(secrets);

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      mockFetch,
      provider,
      allowPublicDnsLookup,
    );

    await executor.execute("tool.http.fetch", "call-4", {
      url: "https://example.com",
      headers: { "Content-Type": "application/json" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("keeps original value when secret handle is not found", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));

    const mockFetch = vi.fn(async () => ({
      text: async () => "ok",
    })) as unknown as typeof fetch;

    const secrets = new Map<string, string>(); // empty — no secrets
    const provider = stubSecretProvider(secrets);

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      mockFetch,
      provider,
      allowPublicDnsLookup,
    );

    await executor.execute("tool.http.fetch", "call-5", {
      url: "https://example.com",
      headers: { Authorization: "secret:nonexistent" },
    });

    // Should pass through the unresolved value
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "secret:nonexistent",
        }),
      }),
    );
  });

  it("resolves secrets in nested array args", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));
    await writeFile(join(homeDir, "test.txt"), "content", "utf-8");

    const secrets = new Map([["handle-xyz", "resolved-value"]]);
    const provider = stubSecretProvider(secrets);

    const executor = new ToolExecutor(homeDir, stubMcpManager(), new Map(), fetch, provider);

    // Use fs.read which has a path arg; also pass an extra arg with nested secrets
    // to verify the walk function handles arrays
    const result = await executor.execute("tool.fs.read", "call-6", {
      path: "test.txt",
      tags: ["secret:handle-xyz", "plain"],
    });

    // The file read should still work
    expect(result.output).toContain('<data source="tool">');
    expect(result.output).toContain("content");
  });

  it("redacts multiple secret values from output", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));

    const mockFetch = vi.fn(async () => ({
      text: async () => "key1=secret-AAA and key2=secret-BBB here",
    })) as unknown as typeof fetch;

    const secrets = new Map([
      ["h1", "secret-AAA"],
      ["h2", "secret-BBB"],
    ]);
    const provider = stubSecretProvider(secrets);

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      mockFetch,
      provider,
      allowPublicDnsLookup,
    );

    const result = await executor.execute("tool.http.fetch", "call-7", {
      url: "https://example.com",
      headers: {
        "X-Key-1": "secret:h1",
        "X-Key-2": "secret:h2",
      },
    });

    expect(result.output).not.toContain("secret-AAA");
    expect(result.output).not.toContain("secret-BBB");
    expect(result.output).toContain("[REDACTED]");
  });
});
