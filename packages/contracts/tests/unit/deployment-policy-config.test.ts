import { describe, expect, it } from "vitest";
import {
  DeploymentPolicyConfigGetResponse,
  DeploymentPolicyConfigListRevisionsResponse,
  DeploymentPolicyConfigRevertRequest,
  DeploymentPolicyConfigUpdateRequest,
} from "@tyrum/contracts";

describe("DeploymentPolicyConfig schemas", () => {
  it("parses revision metadata and structured bundles", () => {
    const parsed = DeploymentPolicyConfigGetResponse.parse({
      revision: 7,
      bundle: {
        v: 1,
        tools: {
          default: "require_approval",
          allow: ["read"],
          require_approval: ["bash"],
          deny: [],
        },
      },
      agent_key: null,
      created_at: "2026-02-25T00:00:00.000Z",
      created_by: { kind: "tenant.token", token_id: "tok_1" },
      reason: null,
      reverted_from_revision: 6,
    });

    expect(parsed.revision).toBe(7);
    expect(parsed.bundle.tools?.require_approval).toEqual(["bash"]);
    expect(parsed.reverted_from_revision).toBe(6);
  });

  it("canonicalizes nested tool ids in update requests", () => {
    const parsed = DeploymentPolicyConfigUpdateRequest.parse({
      bundle: {
        v: 1,
        tools: {
          default: "deny",
          allow: ["tool.fs.read", "tool.exec"],
          require_approval: [],
          deny: [],
        },
      },
      reason: "tighten allowlist",
    });

    expect(parsed.bundle.tools?.allow).toEqual(["read", "bash"]);
  });

  it("validates revision list responses and revert inputs", () => {
    const revisions = DeploymentPolicyConfigListRevisionsResponse.parse({
      revisions: [
        {
          revision: 7,
          agent_key: null,
          created_at: "2026-02-25T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "tok_1" },
          reason: "tighten allowlist",
          reverted_from_revision: null,
        },
      ],
    });

    expect(revisions.revisions[0]?.revision).toBe(7);
    expect(() => DeploymentPolicyConfigRevertRequest.parse({ revision: 0 })).toThrow();
  });
});
