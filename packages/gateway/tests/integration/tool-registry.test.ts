import { describe, expect, it } from "vitest";
import type { EffectiveToolExposureReason } from "../../src/modules/agent/runtime/effective-exposure-resolver.js";
import { SECRET_CLIPBOARD_TOOL_ID } from "../../src/modules/agent/tool-secret-definitions.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { seedAgentConfig } from "../unit/agent-runtime.test-helpers.js";
import { createTestApp } from "./helpers.js";

function mapRouteReason(reason: EffectiveToolExposureReason): string {
  switch (reason) {
    case "enabled":
      return "enabled";
    case "disabled_by_state_mode":
      return "disabled_by_state_mode";
    case "disabled_invalid_schema":
      return "disabled_invalid_schema";
    default:
      return "disabled_by_agent_allowlist";
  }
}

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

  it("matches runtime inventory exposure for agent-scoped dynamic built-ins", async () => {
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
    const catalog = (await runtime.listRegisteredTools()) as Awaited<
      ReturnType<typeof runtime.listRegisteredTools>
    > & {
      inventory: Array<{
        descriptor: { id: string };
        reason: EffectiveToolExposureReason;
      }>;
    };

    const response = await request("/config/tools?agent_key=default");
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
    expect(body.status).toBe("ok");

    const routeToolIds = body.tools.map((tool) => tool.canonical_id).toSorted();
    const runtimeInventoryIds = catalog.inventory.map((entry) => entry.descriptor.id).toSorted();
    expect(routeToolIds).toEqual(runtimeInventoryIds);
    expect(routeToolIds).toContain(SECRET_CLIPBOARD_TOOL_ID);

    const routeExposureById = new Map(
      body.tools.map((tool) => [tool.canonical_id, tool.effective_exposure] as const),
    );
    for (const entry of catalog.inventory) {
      expect(routeExposureById.get(entry.descriptor.id)?.reason).toBe(mapRouteReason(entry.reason));
    }

    expect(routeExposureById.get(SECRET_CLIPBOARD_TOOL_ID)).toMatchObject({
      enabled: true,
      reason: "enabled",
    });

    await agents?.shutdown();
    await container.db.close();
  });
});
