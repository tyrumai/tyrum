import { describe, expect, it } from "vitest";
import { PolicyAdminService } from "@tyrum/runtime-policy";

describe("PolicyAdminService", () => {
  it("creates dedicated routed tool overrides without generic node-dispatch validation", async () => {
    const create = async (input: {
      tenantId: string;
      agentId: string;
      toolId: string;
      pattern: string;
    }) => ({
      policy_override_id: "override-1",
      tenant_id: input.tenantId,
      agent_id: input.agentId,
      tool_id: input.toolId,
      pattern: input.pattern,
    });
    const service = new PolicyAdminService({
      policyOverrideStore: {
        async list() {
          return [];
        },
        async expireStale() {
          return [];
        },
        create,
        async revoke() {
          return undefined;
        },
      },
    });

    const result = await service.createOverride({
      tenantId: "tenant-1",
      agentId: "agent-1",
      toolId: "tool.desktop.act",
      pattern: "tool.desktop.act",
    });

    expect(result).toEqual({
      ok: true,
      override: {
        policy_override_id: "override-1",
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        tool_id: "tool.desktop.act",
        pattern: "tool.desktop.act",
      },
    });
  });
});
