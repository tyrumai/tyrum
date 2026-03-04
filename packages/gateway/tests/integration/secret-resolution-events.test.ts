import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";
import { createTestContainer } from "./helpers.js";

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

describe("secret resolution events", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("emits secret.resolution with requester identity and policy snapshot refs", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "secret-resolution-events-"));

    const container = await createTestContainer();

    const mockFetch = vi.fn(async () => ({
      text: async () => "ok",
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
      container.secretResolutionAuditDal,
    );

    await executor.execute(
      "tool.http.fetch",
      "call-1",
      {
        url: "https://api.example.com",
        headers: { Authorization: "secret:handle-abc" },
      },
      {
        agent_id: "agent-1",
        workspace_id: "workspace-1",
        session_id: "session-1",
        channel: "telegram",
        thread_id: "thread-1",
        policy_snapshot_id: "ps-1",
      },
    );

    const outbox = await container.db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const resolution = outbox
      .map(
        (row) => JSON.parse(row.payload_json) as { message?: { type?: string; payload?: unknown } },
      )
      .map((row) => row.message)
      .find((message) => message?.type === "secret.resolution");

    expect(resolution).toBeTruthy();
    expect(resolution?.payload).toMatchObject({
      requester: {
        agent_id: "agent-1",
        workspace_id: "workspace-1",
        session_id: "session-1",
        channel: "telegram",
        thread_id: "thread-1",
      },
      resolution: {
        tool_call_id: "call-1",
        tool_id: "tool.http.fetch",
        handle_id: "handle-abc",
        provider: "db",
        scope: "handle-abc",
        policy_snapshot_id: "ps-1",
        outcome: "resolved",
      },
    });

    await container.db.close();
  });
});
