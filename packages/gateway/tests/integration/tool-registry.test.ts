import { describe, expect, it } from "vitest";
import { SECRET_CLIPBOARD_TOOL_ID } from "../../src/modules/agent/tool-secret-definitions.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { seedAgentConfig } from "../unit/agent-runtime.test-helpers.js";
import { createTestApp } from "./helpers.js";

describe("/config/tools", () => {
  it("returns 404 for a missing explicit agent without creating it", async () => {
    const { request, container, agents } = await createTestApp();
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const before = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );

    const response = await request("/config/tools?agent_key=missing-agent");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "not_found",
      message: "agent 'missing-agent' not found",
    });

    const after = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    expect(after?.count ?? 0).toBe(before?.count ?? 0);

    await agents?.shutdown();
    await container.db.close();
  });

  it("matches runtime inventory exposure and taxonomy for interaction inspection", async () => {
    const { request, container, agents } = await createTestApp();
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { default_mode: "allow", workspace_trusted: true },
        mcp: {
          default_mode: "allow",
          allow: [],
          deny: [],
        },
        tools: {
          default_mode: "allow",
          allow: [SECRET_CLIPBOARD_TOOL_ID],
          deny: [],
        },
        secret_refs: [
          {
            secret_ref_id: "secret-ref-1",
            secret_alias: "desktop-login",
            allowed_tool_ids: [SECRET_CLIPBOARD_TOOL_ID],
          },
        ],
      },
    });

    const runtime = await agents!.getRuntime({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: "default",
    });
    const catalog = (await runtime.listRegisteredTools({
      executionProfile: "interaction",
    })) as Awaited<ReturnType<typeof runtime.listRegisteredTools>> & {
      inventory: Array<{
        descriptor: { id: string; taxonomy?: { canonicalId?: string } };
        enabled: boolean;
        reason: string;
      }>;
    };

    const response = await request("/config/tools?agent_key=default");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<{
        canonical_id: string;
        lifecycle: string;
        visibility: string;
        aliases: Array<{ id: string; lifecycle: string }>;
        effective_exposure: {
          enabled: boolean;
          reason: string;
        };
      }>;
    };
    expect(body.status).toBe("ok");

    const routeToolIds = body.tools.map((tool) => tool.canonical_id).toSorted();
    const runtimeInventoryIds = catalog.inventory
      .map((entry) => entry.descriptor.taxonomy?.canonicalId ?? entry.descriptor.id)
      .toSorted();
    expect(routeToolIds).toEqual(runtimeInventoryIds);
    expect(routeToolIds).toContain(SECRET_CLIPBOARD_TOOL_ID);

    const routeExposureById = new Map(
      body.tools.map((tool) => [tool.canonical_id, tool.effective_exposure] as const),
    );
    for (const entry of catalog.inventory) {
      expect(
        routeExposureById.get(entry.descriptor.taxonomy?.canonicalId ?? entry.descriptor.id),
      ).toMatchObject({
        enabled: entry.enabled,
        reason: entry.reason,
      });
    }

    expect(body.tools).toContainEqual(
      expect.objectContaining({
        canonical_id: "read",
        lifecycle: "canonical",
        visibility: "public",
        aliases: [{ id: "tool.fs.read", lifecycle: "alias" }],
      }),
    );

    await agents?.shutdown();
    await container.db.close();
  });

  it("matches runtime inventory for explicit subagent execution_profile inspection", async () => {
    const { request, container, agents } = await createTestApp();
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: { memory: { enabled: false } },
        },
        tools: {
          allow: ["read", "write", "bash"],
        },
        conversations: { ttl_days: 30, max_turns: 20 },
      },
    });

    const runtime = await agents!.getRuntime({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: "default",
    });
    const explorerCatalog = (await runtime.listRegisteredTools({
      executionProfile: "explorer_ro",
    })) as Awaited<ReturnType<typeof runtime.listRegisteredTools>> & {
      inventory: Array<{
        descriptor: { id: string; taxonomy?: { canonicalId?: string } };
        enabled: boolean;
        reason: string;
      }>;
    };

    const response = await request("/config/tools?agent_key=default&execution_profile=explorer_ro");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<{
        canonical_id: string;
        effective_exposure: {
          enabled: boolean;
          reason: string;
        };
      }>;
    };

    const routeExposureById = new Map(
      body.tools.map((tool) => [tool.canonical_id, tool.effective_exposure] as const),
    );
    for (const entry of explorerCatalog.inventory) {
      expect(
        routeExposureById.get(entry.descriptor.taxonomy?.canonicalId ?? entry.descriptor.id),
      ).toMatchObject({
        enabled: entry.enabled,
        reason: entry.reason,
      });
    }

    expect(routeExposureById.get("write")).toMatchObject({
      enabled: false,
      reason: "disabled_by_execution_profile",
    });
    expect(routeExposureById.get("bash")).toMatchObject({
      enabled: false,
      reason: "disabled_by_execution_profile",
    });
    expect(routeExposureById.get("read")).toMatchObject({
      enabled: true,
      reason: "enabled",
    });

    await agents?.shutdown();
    await container.db.close();
  });
});
