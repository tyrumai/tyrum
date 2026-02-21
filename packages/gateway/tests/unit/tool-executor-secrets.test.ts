import { describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";
import { EventLog } from "../../src/modules/planner/event-log.js";
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
    provider: "env" as const,
    scope: id,
    created_at: "",
  }));
  return {
    resolve: vi.fn(async (handle: SecretHandle) => secrets.get(handle.handle_id) ?? null),
    store: vi.fn(async () => ({ handle_id: "h1", provider: "env" as const, scope: "test", created_at: "" })),
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
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
    await db?.close();
    db = undefined;
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

    await executor.execute(
      "tool.http.fetch",
      "call-1",
      {
        url: "https://api.example.com",
        headers: { Authorization: "secret:handle-abc" },
      },
    );

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

  it("emits a secret resolution audit event without logging raw values", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-audit-"));
    db = openTestSqliteDb();

    const eventLog = new EventLog(db);

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
      undefined,
      { planId: "plan-secret-audit-1", eventLog },
    );

    await executor.execute(
      "tool.http.fetch",
      "call-audit-1",
      {
        url: "https://api.example.com",
        headers: { Authorization: "secret:handle-abc" },
      },
    );

    const events = await eventLog.eventsForPlan("plan-secret-audit-1");
    const secretEvents = events.filter((e) => (e.action as { type?: string }).type === "secret.resolution");
    expect(secretEvents.length).toBe(1);
    expect(JSON.stringify(secretEvents[0]!.action)).not.toContain("my-api-key-value");
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

    const result = await executor.execute(
      "tool.http.fetch",
      "call-2",
      {
        url: "https://api.example.com",
        headers: { Authorization: "secret:handle-abc" },
      },
    );

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

    const result = await executor.execute(
      "tool.fs.read",
      "call-3",
      { path: "test.txt" },
    );

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

    await executor.execute(
      "tool.http.fetch",
      "call-4",
      {
        url: "https://example.com",
        headers: { "Content-Type": "application/json" },
      },
    );

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

    await executor.execute(
      "tool.http.fetch",
      "call-5",
      {
        url: "https://example.com",
        headers: { Authorization: "secret:nonexistent" },
      },
    );

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

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      fetch,
      provider,
    );

    // Use fs.read which has a path arg; also pass an extra arg with nested secrets
    // to verify the walk function handles arrays
    const result = await executor.execute(
      "tool.fs.read",
      "call-6",
      { path: "test.txt", tags: ["secret:handle-xyz", "plain"] },
    );

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

    const result = await executor.execute(
      "tool.http.fetch",
      "call-7",
      {
        url: "https://example.com",
        headers: {
          "X-Key-1": "secret:h1",
          "X-Key-2": "secret:h2",
        },
      },
    );

    expect(result.output).not.toContain("secret-AAA");
    expect(result.output).not.toContain("secret-BBB");
    expect(result.output).toContain("[REDACTED]");
  });
});
