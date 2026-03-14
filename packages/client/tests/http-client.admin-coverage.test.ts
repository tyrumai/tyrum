import { describe, expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import { createTestClient, jsonResponse, makeFetchMock } from "./http-client.test-support.js";

const routingConfig = {
  v: 1,
  telegram: {
    accounts: {
      default: {
        default_agent_key: "agent-1",
        threads: { "12345": "agent-2" },
      },
    },
  },
} as const;

const routingSnapshot = {
  revision: 2,
  config: routingConfig,
  created_at: "2026-03-10T00:00:00.000Z",
  created_by: { kind: "tenant.token", token_id: "token-1" },
  reason: "seed routing",
} as const;

const telegramChannel = {
  channel: "telegram",
  account_key: "default",
  bot_token_configured: true,
  webhook_secret_configured: false,
  allowed_user_ids: ["1001", "1002"],
  pipeline_enabled: true,
} as const;

const skillSummary = {
  kind: "skill",
  key: "ops-pack",
  name: "Ops Pack",
  description: "Managed operational skills",
  version: "1.0.0",
  enabled: true,
  revision: 2,
  source: {
    kind: "direct-url",
    url: "https://example.test/ops-pack.tgz",
    filename: "ops-pack.tgz",
  },
  refreshable: true,
  materialized_path: "/var/lib/tyrum/extensions/ops-pack",
  assignment_count: 1,
  transport: null,
  source_type: "managed",
  default_access: "inherit",
  can_edit_settings: false,
  can_toggle_source_enabled: true,
  can_refresh_source: true,
  can_revert_source: true,
} as const;

const skillDetail = {
  ...skillSummary,
  manifest: {
    meta: {
      id: "ops-pack",
      name: "Ops Pack",
      version: "1.0.0",
      description: "Managed operational skills",
    },
    body: "Use the runbook and summarize the outcome.",
  },
  spec: null,
  files: ["SKILL.md"],
  revisions: [
    {
      revision: 2,
      enabled: true,
      created_at: "2026-03-10T00:00:00.000Z",
      reason: "seed routing",
      reverted_from_revision: null,
    },
  ],
  default_mcp_server_settings_json: null,
  default_mcp_server_settings_yaml: null,
  sources: [
    {
      source_type: "managed",
      is_effective: true,
      enabled: true,
      revision: 2,
      refreshable: true,
      materialized_path: "/var/lib/tyrum/extensions/ops-pack",
      transport: null,
      version: "1.0.0",
      description: "Managed operational skills",
      source: {
        kind: "direct-url",
        url: "https://example.test/ops-pack.tgz",
        filename: "ops-pack.tgz",
      },
    },
  ],
} as const;

const mcpDetail = {
  kind: "mcp",
  key: "exa",
  name: "Exa",
  description: "Remote search server",
  version: "1.0.0",
  enabled: true,
  revision: 3,
  source: {
    kind: "npm",
    npm_spec: "@modelcontextprotocol/server-exa",
    command: "npx",
    args: ["-y"],
  },
  refreshable: false,
  materialized_path: "/var/lib/tyrum/extensions/exa",
  assignment_count: 2,
  transport: "remote",
  source_type: "managed",
  default_access: "allow",
  can_edit_settings: true,
  can_toggle_source_enabled: true,
  can_refresh_source: false,
  can_revert_source: true,
  manifest: null,
  spec: {
    id: "exa",
    name: "Exa",
    enabled: true,
    transport: "remote",
    url: "https://mcp.example.test",
  },
  files: [],
  revisions: [
    {
      revision: 3,
      enabled: true,
      created_at: "2026-03-11T00:00:00.000Z",
      reason: "imported from npm",
      reverted_from_revision: null,
    },
  ],
  default_mcp_server_settings_json: {
    namespace: "shared",
  },
  default_mcp_server_settings_yaml: "namespace: shared\n",
  sources: [
    {
      source_type: "managed",
      is_effective: true,
      enabled: true,
      revision: 3,
      refreshable: false,
      materialized_path: "/var/lib/tyrum/extensions/exa",
      transport: "remote",
      version: "1.0.0",
      description: "Remote search server",
      source: {
        kind: "npm",
        npm_spec: "@modelcontextprotocol/server-exa",
        command: "npx",
        args: ["-y"],
      },
    },
  ],
} as const;

const contextReportRow = {
  context_report_id: "11111111-1111-4111-8111-111111111111",
  session_id: "session-1",
  channel: "telegram",
  thread_id: "thread-1",
  agent_id: "22222222-2222-4222-8222-222222222222",
  workspace_id: "33333333-3333-4333-8333-333333333333",
  run_id: "44444444-4444-4444-8444-444444444444",
  report: null,
  created_at: "2026-03-12T00:00:00.000Z",
} as const;

describe("admin HTTP client coverage", () => {
  it("covers routing config admin endpoints", async () => {
    const fetch = makeFetchMock(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/routing/config") && init?.method === "GET") {
        return jsonResponse(routingSnapshot);
      }
      if (url.endsWith("/routing/config/revisions?limit=5")) {
        return jsonResponse({ revisions: [routingSnapshot] });
      }
      if (url.endsWith("/routing/channels/telegram/threads?limit=7")) {
        return jsonResponse({
          threads: [
            {
              channel: "telegram",
              account_key: "default",
              thread_id: "thread-1",
              container_kind: "group",
              session_title: "ops room",
              last_active_at: "2026-03-12T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.endsWith("/routing/channels/configs") && init?.method === "GET") {
        return jsonResponse({ channels: [telegramChannel] });
      }
      if (url.endsWith("/routing/channels/configs") && init?.method === "POST") {
        return jsonResponse({ config: telegramChannel }, 201);
      }
      if (url.endsWith("/routing/config") && init?.method === "PUT") {
        return jsonResponse({ ...routingSnapshot, revision: 3 }, 201);
      }
      if (url.endsWith("/routing/channels/configs/telegram/default") && init?.method === "PATCH") {
        return jsonResponse({ config: { ...telegramChannel, pipeline_enabled: false } });
      }
      if (url.endsWith("/routing/channels/configs/telegram/default") && init?.method === "DELETE") {
        return jsonResponse({ deleted: true, channel: "telegram", account_key: "default" });
      }
      if (url.endsWith("/routing/config/revert") && init?.method === "POST") {
        return jsonResponse({ ...routingSnapshot, revision: 1 }, 201);
      }
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    const client = createTestClient({ fetch });

    const routing = client.routingConfig;
    const current = await routing.get();
    const revisions = await routing.listRevisions({ limit: 5 });
    const threads = await routing.listObservedTelegramThreads({ limit: 7 });
    const channels = await routing.listChannelConfigs();
    const created = await routing.createChannelConfig({
      channel: "telegram",
      account_key: "default",
      bot_token: "secret-token",
      allowed_user_ids: ["1001", "1002"],
    });
    const updated = await routing.update({ config: routingConfig, reason: "sync routing" });
    const patched = await routing.updateChannelConfig("telegram", "default", {
      pipeline_enabled: false,
    });
    const deleted = await routing.deleteChannelConfig("telegram", "default");
    const reverted = await routing.revert({ revision: 1, reason: "rollback" });

    expect(current.revision).toBe(2);
    expect(revisions.revisions).toHaveLength(1);
    expect(threads.threads[0]?.container_kind).toBe("group");
    expect(channels.channels[0]?.account_key).toBe("default");
    expect(created.config.bot_token_configured).toBe(true);
    expect(updated.revision).toBe(3);
    expect(patched.config.pipeline_enabled).toBe(false);
    expect(deleted.deleted).toBe(true);
    expect(reverted.revision).toBe(1);

    const createCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[4] as [
      string,
      RequestInit,
    ];
    const updateCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[5] as [
      string,
      RequestInit,
    ];
    expect(createCall[0]).toBe("https://gateway.example/routing/channels/configs");
    expect(JSON.parse(createCall[1].body as string)).toMatchObject({ channel: "telegram" });
    expect(updateCall[0]).toBe("https://gateway.example/routing/config");
    expect(JSON.parse(updateCall[1].body as string)).toMatchObject({ reason: "sync routing" });
  });

  it("covers extensions and context admin endpoints", async () => {
    const fetch = makeFetchMock(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/config/extensions/skill") && init?.method === "GET") {
        return jsonResponse({ items: [skillSummary] });
      }
      if (url.endsWith("/config/extensions/skill/ops-pack") && init?.method === "GET") {
        return jsonResponse({ item: skillDetail });
      }
      if (url.endsWith("/config/extensions/skill/import")) {
        return jsonResponse({ item: skillDetail });
      }
      if (url.endsWith("/config/extensions/skill/upload")) {
        return jsonResponse({ item: skillDetail });
      }
      if (url.endsWith("/config/extensions/mcp/import")) {
        return jsonResponse({ item: mcpDetail });
      }
      if (url.endsWith("/config/extensions/mcp/upload")) {
        return jsonResponse({ item: mcpDetail });
      }
      if (url.endsWith("/config/extensions/skill/ops-pack/toggle")) {
        return jsonResponse({ item: { ...skillDetail, enabled: false } });
      }
      if (url.endsWith("/config/extensions/skill/ops-pack/revert")) {
        return jsonResponse({ item: { ...skillDetail, revision: 1 } });
      }
      if (url.endsWith("/config/extensions/skill/ops-pack/refresh")) {
        return jsonResponse({ item: skillDetail });
      }
      if (url.endsWith("/context?agent_key=agent-1")) {
        return jsonResponse({ status: "ok", report: null });
      }
      if (url.endsWith("/context/list?session_id=session-1&limit=5")) {
        return jsonResponse({ status: "ok", reports: [contextReportRow] });
      }
      if (url.endsWith(`/context/detail/${contextReportRow.context_report_id}`)) {
        return jsonResponse({ status: "ok", report: contextReportRow });
      }
      if (url.endsWith("/context/tools?agent_key=agent-1")) {
        return jsonResponse({
          status: "ok",
          allowlist: ["read"],
          mcp_servers: ["exa"],
          tools: [
            {
              id: "read",
              description: "Read files from disk.",
              source: "builtin",
              family: "fs",
              backing_server_id: null,
              enabled_by_agent: true,
            },
          ],
        });
      }
      throw new Error(`unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    const client = createTestClient({ fetch });

    const extensions = client.extensions;
    const context = client.context;
    const listed = await extensions.list("skill");
    const detail = await extensions.get("skill", "ops-pack");
    await extensions.importSkill({ url: "https://example.test/ops-pack.tgz", reason: "sync" });
    await extensions.uploadSkill({ content_base64: "c2tpbGw=", filename: "ops-pack.tgz" });
    const importedMcp = await extensions.importMcp({
      source: "npm",
      npm_spec: "@modelcontextprotocol/server-exa",
    });
    await extensions.uploadMcp({ content_base64: "bWNw", filename: "exa.tgz" });
    const toggled = await extensions.toggle("skill", "ops-pack", { enabled: false });
    const reverted = await extensions.revert("skill", "ops-pack", { revision: 1 });
    const refreshed = await extensions.refresh("skill", "ops-pack");
    const currentContext = await context.get({ agent_key: "agent-1" });
    const listedContext = await context.list({ session_id: "session-1", limit: 5 });
    const detailContext = await context.detail(contextReportRow.context_report_id);
    const tools = await context.tools({ agent_key: "agent-1" });

    expect(listed.items[0]?.key).toBe("ops-pack");
    expect(detail.item.manifest?.meta.id).toBe("ops-pack");
    expect(importedMcp.item.kind).toBe("mcp");
    expect(toggled.item.enabled).toBe(false);
    expect(reverted.item.revision).toBe(1);
    expect(refreshed.item.revision).toBe(2);
    expect(currentContext.report).toBeNull();
    expect(listedContext.reports[0]?.context_report_id).toBe(contextReportRow.context_report_id);
    expect(detailContext.report.thread_id).toBe("thread-1");
    expect(tools.tools[0]?.id).toBe("read");

    const importSkillCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[2] as [
      string,
      RequestInit,
    ];
    const toggleCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[6] as [
      string,
      RequestInit,
    ];
    expect(importSkillCall[0]).toBe("https://gateway.example/config/extensions/skill/import");
    expect(JSON.parse(importSkillCall[1].body as string)).toMatchObject({ source: "direct-url" });
    expect(toggleCall[0]).toBe("https://gateway.example/config/extensions/skill/ops-pack/toggle");
    expect(JSON.parse(toggleCall[1].body as string)).toEqual({ enabled: false });
  });
});
