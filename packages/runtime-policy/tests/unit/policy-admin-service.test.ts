import { describe, expect, it } from "vitest";
import { PolicyAdminService } from "@tyrum/runtime-policy";

describe("PolicyAdminService", () => {
  it("rejects legacy umbrella node dispatch override patterns", async () => {
    const service = new PolicyAdminService({
      policyOverrideStore: {
        async list() {
          return [];
        },
        async expireStale() {
          return [];
        },
        async create() {
          throw new Error("create should not be called");
        },
        async revoke() {
          return undefined;
        },
      },
    });

    const result = await service.createOverride({
      tenantId: "tenant-1",
      agentId: "agent-1",
      toolId: "tool.node.dispatch",
      pattern: "capability:tyrum.desktop;action:Desktop;op:act",
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_request",
      message:
        "tool.node.dispatch override patterns must use exact split descriptors or family wildcards such as 'tyrum.desktop.*'",
    });
  });
});
