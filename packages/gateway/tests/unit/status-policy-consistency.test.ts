import { afterEach, describe, expect, it } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("/status policy consistency", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("uses a single policy status snapshot for policy and sandbox", async () => {
    db = openTestSqliteDb();

    let calls = 0;
    const policyService = {
      getStatus: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            enabled: true,
            observe_only: false,
            effective_sha256: "policy-a",
            sources: { deployment: "a", agent: null },
          };
        }
        return {
          enabled: false,
          observe_only: true,
          effective_sha256: "policy-b",
          sources: { deployment: "b", agent: null },
        };
      },
      loadEffectiveBundle: async () => ({
        bundle: {
          v: 1 as const,
          tools: {
            default: "allow" as const,
            allow: [],
            require_approval: [],
            deny: [],
          },
        },
        sha256: "bundle-sha",
        sources: { deployment: "default", agent: null, playbook: null },
      }),
    } as unknown as import("../../src/modules/policy/service.js").PolicyService;

    const result = await executeCommand("/status", {
      runtime: {
        version: "test-version",
        instanceId: "test-instance",
        role: "all",
        dbKind: "sqlite",
        isExposed: false,
        otelEnabled: false,
      },
      db,
      policyService,
    });

    const payload = result.data as Record<string, unknown>;
    const policy = payload["policy"] as Record<string, unknown>;
    const sandbox = payload["sandbox"] as Record<string, unknown>;

    expect(calls).toBe(1);
    expect(policy["enabled"]).toBe(sandbox["policy_enabled"]);
    expect(policy["observe_only"]).toBe(sandbox["policy_observe_only"]);
    expect(policy["effective_sha256"]).toBe(sandbox["effective_policy_sha256"]);
  });
});
