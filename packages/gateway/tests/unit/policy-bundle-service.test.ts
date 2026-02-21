import { afterEach, describe, expect, it } from "vitest";
import { PolicyBundle } from "@tyrum/schemas";
import type { ActionPrimitive } from "@tyrum/schemas";
import { PolicyBundleService } from "../../src/modules/policy-bundle/service.js";
import { PolicyOverrideDal } from "../../src/modules/policy-overrides/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function action(type: ActionPrimitive["type"], args?: Record<string, unknown>): ActionPrimitive {
  return { type, args: args ?? {} };
}

describe("PolicyBundleService (composition + snapshots)", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("merges deployment + agent + playbook policy conservatively", async () => {
    db = openTestSqliteDb();
    const service = new PolicyBundleService(db);

    await service.setBundle({
      scopeKind: "deployment",
      scopeId: "default",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "allow" },
        actions: {
          allow: ["Http", "CLI"],
          deny: ["Pay"],
          require_approval: [],
          default: "allow",
        },
        network: {
          egress: {
            allow_hosts: ["openai.com", "example.com"],
            deny_hosts: [],
            require_approval_hosts: [],
            default: "require_approval",
          },
        },
        secrets: {
          resolve: {
            allow: ["svc-*"],
            deny: [],
            require_approval: ["*"],
            default: "require_approval",
          },
        },
        provenance: {
          rules: [
            {
              sources: ["web"],
              actions: {
                allow: [],
                deny: ["CLI"],
                require_approval: [],
                default: "allow",
              },
            },
          ],
        },
      }),
    });

    await service.setBundle({
      scopeKind: "agent",
      scopeId: "agent-1",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "allow" },
        actions: {
          allow: ["Http"],
          deny: ["CLI"],
          require_approval: [],
          default: "require_approval",
        },
        network: {
          egress: {
            allow_hosts: ["openai.com"],
            deny_hosts: ["bad.example"],
            require_approval_hosts: [],
            default: "allow",
          },
        },
        secrets: {
          resolve: {
            allow: [],
            deny: ["svc-root"],
            require_approval: [],
            default: "require_approval",
          },
        },
        provenance: {
          rules: [
            {
              sources: ["connector"],
              actions: {
                allow: [],
                deny: [],
                require_approval: ["Http"],
                default: "allow",
              },
            },
          ],
        },
      }),
    });

    await service.setBundle({
      scopeKind: "playbook",
      scopeId: "pb-1",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "allow" },
        actions: {
          allow: [],
          deny: [],
          require_approval: ["Http"],
          default: "allow",
        },
        network: {
          egress: {
            allow_hosts: [],
            deny_hosts: [],
            require_approval_hosts: ["example.com"],
            default: "allow",
          },
        },
        secrets: {
          resolve: {
            allow: [],
            deny: [],
            require_approval: [],
            default: "require_approval",
          },
        },
        provenance: { rules: [] },
      }),
    });

    const { policy, sources } = await service.getEffectivePolicy({
      agentId: "agent-1",
      playbookId: "pb-1",
    });

    expect(sources.map((s) => `${s.scope_kind}/${s.scope_id}`)).toEqual([
      "deployment/default",
      "agent/agent-1",
      "playbook/pb-1",
    ]);

    expect(policy.actions.allow).toEqual(["Http"]);
    expect(policy.actions.deny).toEqual(["CLI", "Pay"]);
    expect(policy.actions.require_approval).toEqual(["Http"]);
    expect(policy.actions.default).toBe("require_approval");

    expect(policy.network.egress.allow_hosts).toEqual(["openai.com"]);
    expect(policy.network.egress.deny_hosts).toEqual(["bad.example"]);
    expect(policy.network.egress.require_approval_hosts).toEqual(["example.com"]);
    expect(policy.network.egress.default).toBe("require_approval");

    expect(policy.secrets.resolve.allow).toEqual(["svc-*"]);
    expect(policy.secrets.resolve.deny).toEqual(["svc-root"]);
    expect(policy.secrets.resolve.require_approval).toEqual(["*"]);
    expect(policy.secrets.resolve.default).toBe("require_approval");

    expect(policy.provenance.rules).toHaveLength(2);
    expect(policy.provenance.rules[0]!.sources).toEqual(["web"]);
    expect(policy.provenance.rules[1]!.sources).toEqual(["connector"]);
  });

  it("records bundle sources in policy snapshots", async () => {
    db = openTestSqliteDb();
    const service = new PolicyBundleService(db);

    await service.setBundle({
      scopeKind: "deployment",
      scopeId: "default",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "allow" },
        actions: { allow: [], deny: [], require_approval: [], default: "allow" },
        network: { egress: { allow_hosts: ["*"], deny_hosts: [], require_approval_hosts: [], default: "allow" } },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: { rules: [] },
      }),
    });

    await service.setBundle({
      scopeKind: "agent",
      scopeId: "agent-2",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "allow" },
        actions: { allow: [], deny: ["CLI"], require_approval: [], default: "allow" },
        network: { egress: { allow_hosts: ["*"], deny_hosts: [], require_approval_hosts: [], default: "allow" } },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: { rules: [] },
      }),
    });

    await service.setBundle({
      scopeKind: "playbook",
      scopeId: "pb-2",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "allow" },
        actions: { allow: [], deny: [], require_approval: ["Http"], default: "allow" },
        network: { egress: { allow_hosts: ["*"], deny_hosts: [], require_approval_hosts: [], default: "allow" } },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: { rules: [] },
      }),
    });

    const snapshot = await service.getOrCreateSnapshot({
      agentId: "agent-2",
      playbookId: "pb-2",
      createdBy: "test",
    });

    const snapshotRow = await db.get<{ sources_json: string | null }>(
      "SELECT sources_json FROM policy_snapshots WHERE policy_snapshot_id = ?",
      [snapshot.policySnapshotId],
    );
    expect(snapshotRow?.sources_json).toBeTruthy();

    const sources = JSON.parse(snapshotRow!.sources_json!) as Array<{
      scope_kind: string;
      scope_id: string;
      content_hash: string;
    }>;
    expect(sources.map((s) => `${s.scope_kind}/${s.scope_id}`)).toEqual([
      "deployment/default",
      "agent/agent-2",
      "playbook/pb-2",
    ]);

    const same = await service.getOrCreateSnapshot({
      agentId: "agent-2",
      playbookId: "pb-2",
      createdBy: "test",
    });
    expect(same.policySnapshotId).toBe(snapshot.policySnapshotId);
    expect(same.contentHash).toBe(snapshot.contentHash);
  });

  it("supports ? as a single-character wildcard in policy matching", async () => {
    db = openTestSqliteDb();
    const service = new PolicyBundleService(db);

    await service.setBundle({
      scopeKind: "deployment",
      scopeId: "default",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: ["svc-??"], default: "deny" },
        actions: { allow: [], deny: [], require_approval: [], default: "allow" },
        network: { egress: { allow_hosts: ["*"], deny_hosts: [], require_approval_hosts: [], default: "allow" } },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: { rules: [] },
      }),
    });

    const match = await service.evaluateToolCall("svc-ab", {});
    expect(match.decision).toBe("require_approval");

    const tooShort = await service.evaluateToolCall("svc-a", {});
    expect(tooShort.decision).toBe("deny");

    const tooLong = await service.evaluateToolCall("svc-abc", {});
    expect(tooLong.decision).toBe("deny");
  });

  it("treats * as zero-or-more characters in policy matching", async () => {
    db = openTestSqliteDb();
    const service = new PolicyBundleService(db);

    await service.setBundle({
      scopeKind: "deployment",
      scopeId: "default",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: ["svc-*"], default: "deny" },
        actions: { allow: [], deny: [], require_approval: [], default: "allow" },
        network: { egress: { allow_hosts: ["*"], deny_hosts: [], require_approval_hosts: [], default: "allow" } },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: { rules: [] },
      }),
    });

    const emptySuffix = await service.evaluateToolCall("svc-", {});
    expect(emptySuffix.decision).toBe("require_approval");

    const nonEmptySuffix = await service.evaluateToolCall("svc-abc", {});
    expect(nonEmptySuffix.decision).toBe("require_approval");

    const nonMatch = await service.evaluateToolCall("svc", {});
    expect(nonMatch.decision).toBe("deny");
  });

  it("supports ? as a single-character wildcard in network host matching", async () => {
    db = openTestSqliteDb();
    const service = new PolicyBundleService(db);

    await service.setBundle({
      scopeKind: "deployment",
      scopeId: "default",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "allow" },
        actions: { allow: [], deny: [], require_approval: [], default: "allow" },
        network: {
          egress: {
            allow_hosts: ["api?.example.com"],
            deny_hosts: [],
            require_approval_hosts: [],
            default: "deny",
          },
        },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: { rules: [] },
      }),
    });

    const allowed = await service.evaluateAction(action("Http", { url: "https://api1.example.com/test" }));
    expect(allowed.decision).toBe("allow");

    const denied = await service.evaluateAction(action("Http", { url: "https://api12.example.com/test" }));
    expect(denied.decision).toBe("deny");
  });

  it("evaluates provenance-aware action rules conservatively", async () => {
    db = openTestSqliteDb();
    const service = new PolicyBundleService(db);

    await service.setBundle({
      scopeKind: "deployment",
      scopeId: "default",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "allow" },
        actions: { allow: [], deny: [], require_approval: [], default: "allow" },
        network: { egress: { allow_hosts: ["*"], deny_hosts: [], require_approval_hosts: [], default: "allow" } },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: {
          rules: [
            {
              sources: ["web"],
              actions: {
                allow: [],
                deny: ["Http"],
                require_approval: [],
                default: "allow",
              },
            },
          ],
        },
      }),
    });

    const denied = await service.evaluateAction(action("Http"), {
      provenance: { sources: ["web"] },
    });
    expect(denied.decision).toBe("deny");
    expect(denied.reasons.some((r) => r.domain === "provenance")).toBe(true);

    const conservative = await service.evaluateAction(action("Http"));
    expect(conservative.decision).toBe("require_approval");
    expect(conservative.reasons.some((r) => r.code === "missing_provenance")).toBe(true);
  });

  it("applies policy overrides only to relax require_approval -> allow", async () => {
    db = openTestSqliteDb();
    const service = new PolicyBundleService(db);
    const overrides = new PolicyOverrideDal(db);

    await service.setBundle({
      scopeKind: "deployment",
      scopeId: "default",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: [], require_approval: [], default: "require_approval" },
        actions: { allow: [], deny: [], require_approval: [], default: "allow" },
        network: { egress: { allow_hosts: ["*"], deny_hosts: [], require_approval_hosts: [], default: "allow" } },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: { rules: [] },
      }),
    });

    const created = await overrides.create({
      policyOverrideId: "pov-test-1",
      agentId: "agent-1",
      workspaceId: "default",
      toolId: "tool.exec",
      pattern: "git status --porcelain",
      createdBy: { source: "test" },
    });

    const res = await service.evaluateToolCall(
      "tool.exec",
      { command: "git   status   --porcelain" },
      { agentId: "agent-1", workspaceId: "default" },
    );
    expect(res.decision).toBe("allow");
    expect(res.policy_override_ids).toEqual([created.policy_override_id]);
  });

  it("does not allow policy overrides to bypass explicit deny", async () => {
    db = openTestSqliteDb();
    const service = new PolicyBundleService(db);
    const overrides = new PolicyOverrideDal(db);

    await service.setBundle({
      scopeKind: "deployment",
      scopeId: "default",
      bundle: PolicyBundle.parse({
        version: 1,
        tools: { allow: [], deny: ["tool.exec"], require_approval: [], default: "allow" },
        actions: { allow: [], deny: [], require_approval: [], default: "allow" },
        network: { egress: { allow_hosts: ["*"], deny_hosts: [], require_approval_hosts: [], default: "allow" } },
        secrets: { resolve: { allow: [], deny: [], require_approval: [], default: "allow" } },
        provenance: { rules: [] },
      }),
    });

    await overrides.create({
      policyOverrideId: "pov-test-2",
      agentId: "agent-1",
      workspaceId: "default",
      toolId: "tool.exec",
      pattern: "git status --porcelain",
      createdBy: { source: "test" },
    });

    const res = await service.evaluateToolCall(
      "tool.exec",
      { command: "git status --porcelain" },
      { agentId: "agent-1", workspaceId: "default" },
    );
    expect(res.decision).toBe("deny");
    expect(res.policy_override_ids).toBeUndefined();
  });
});
