import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyBundle } from "@tyrum/contracts";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { PolicyService } from "@tyrum/runtime-policy";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import { seedAgentPolicyBundle } from "../helpers/runtime-config.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "tyrum-policy-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("PolicyService regressions (precedence + overrides)", () => {
  it("fails closed when a tenant id is not provided", async () => {
    const db = openTestSqliteDb();
    try {
      const policy = new PolicyService({
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
      });

      await expect(policy.loadEffectiveBundle({ tenantId: "" })).rejects.toThrow(
        "tenantId is required",
      );
      await expect(policy.getStatus({ tenantId: "" })).rejects.toThrow("tenantId is required");
    } finally {
      await db.close();
    }
  });

  it("enforces require_approval over allow when patterns overlap", async () => {
    await withTempDir(async (_home) => {
      const db = openTestSqliteDb();
      try {
        const playbookBundle = PolicyBundle.parse({
          v: 1,
          tools: {
            default: "deny",
            allow: ["bash"],
            require_approval: ["tool.*"],
            deny: [],
          },
        });

        const policy = new PolicyService({
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal: new PolicyOverrideDal(db),
        });

        const res = await policy.evaluateToolCall({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "bash",
          toolMatchTarget: "echo ok",
          playbookBundle,
        });

        expect(res.decision).toBe("require_approval");
      } finally {
        await db.close();
      }
    });
  });

  it("enforces deny over require_approval and allow when patterns overlap", async () => {
    await withTempDir(async (_home) => {
      const db = openTestSqliteDb();
      try {
        const playbookBundle = PolicyBundle.parse({
          v: 1,
          tools: {
            default: "allow",
            allow: ["bash"],
            require_approval: ["tool.*"],
            deny: ["bash"],
          },
        });

        const policy = new PolicyService({
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal: new PolicyOverrideDal(db),
        });

        const res = await policy.evaluateToolCall({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "bash",
          toolMatchTarget: "echo ok",
          playbookBundle,
        });

        expect(res.decision).toBe("deny");
      } finally {
        await db.close();
      }
    });
  });

  it("merges multiple bundles conservatively (require_approval wins over allow)", async () => {
    await withTempDir(async (_home) => {
      const db = openTestSqliteDb();
      try {
        await seedAgentPolicyBundle(db, {
          agentId: DEFAULT_AGENT_ID,
          bundle: {
            v: 1,
            tools: {
              default: "deny",
              allow: [],
              require_approval: ["bash"],
              deny: [],
            },
          },
        });

        const playbookBundle = PolicyBundle.parse({
          v: 1,
          tools: {
            default: "deny",
            allow: ["bash"],
            require_approval: [],
            deny: [],
          },
        });

        const policy = new PolicyService({
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal: new PolicyOverrideDal(db),
          configStore: createGatewayConfigStore({ db }),
        });

        const res = await policy.evaluateToolCall({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "bash",
          toolMatchTarget: "echo ok",
          playbookBundle,
        });

        expect(res.decision).toBe("require_approval");
      } finally {
        await db.close();
      }
    });
  });

  it("does not allow policy overrides to bypass explicit tool denies", async () => {
    await withTempDir(async (_home) => {
      const db = openTestSqliteDb();
      try {
        const playbookBundle = PolicyBundle.parse({
          v: 1,
          tools: {
            default: "allow",
            allow: [],
            require_approval: [],
            deny: ["bash"],
          },
        });

        const overrideDal = new PolicyOverrideDal(db);
        const policy = new PolicyService({
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal,
        });

        await overrideDal.create({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "bash",
          pattern: "echo ok",
        });

        const res = await policy.evaluateToolCall({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "bash",
          toolMatchTarget: "echo ok",
          playbookBundle,
        });

        expect(res.decision).toBe("deny");
        expect(res.applied_override_ids).toBeUndefined();
      } finally {
        await db.close();
      }
    });
  });

  it("does not allow connector send overrides to bypass explicit connector denies", async () => {
    await withTempDir(async (_home) => {
      const db = openTestSqliteDb();
      try {
        const playbookBundle = PolicyBundle.parse({
          v: 1,
          connectors: {
            default: "allow",
            allow: [],
            require_approval: [],
            deny: ["telegram:work:123"],
          },
        });

        const overrideDal = new PolicyOverrideDal(db);
        const policy = new PolicyService({
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal,
        });

        await overrideDal.create({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          toolId: "connector.send",
          pattern: "telegram:work:123",
        });

        const res = await policy.evaluateConnectorAction({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          matchTarget: "telegram:work:123",
          playbookBundle,
        });

        expect(res.decision).toBe("deny");
        expect(res.applied_override_ids).toBeUndefined();
      } finally {
        await db.close();
      }
    });
  });

  it("does not allow policy overrides to bypass non-tool approval gates (egress)", async () => {
    await withTempDir(async (_home) => {
      const db = openTestSqliteDb();
      try {
        const playbookBundle = PolicyBundle.parse({
          v: 1,
          tools: {
            default: "deny",
            allow: ["webfetch"],
            require_approval: [],
            deny: [],
          },
          network_egress: {
            default: "require_approval",
            allow: [],
            require_approval: [],
            deny: [],
          },
        });

        const overrideDal = new PolicyOverrideDal(db);
        const policy = new PolicyService({
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal,
        });

        await overrideDal.create({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "webfetch",
          pattern: "https://example.com/",
        });

        const res = await policy.evaluateToolCall({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "webfetch",
          toolMatchTarget: "https://example.com/",
          url: "https://example.com/",
          playbookBundle,
        });

        expect(res.decision).toBe("require_approval");
        expect(res.applied_override_ids).toBeUndefined();
      } finally {
        await db.close();
      }
    });
  });

  it("allows policy overrides to relax require_approval → allow for matching tool actions", async () => {
    await withTempDir(async (_home) => {
      const db = openTestSqliteDb();
      try {
        const playbookBundle = PolicyBundle.parse({
          v: 1,
          tools: {
            default: "deny",
            allow: [],
            require_approval: ["bash"],
            deny: [],
          },
        });

        const overrideDal = new PolicyOverrideDal(db);
        const policy = new PolicyService({
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal,
        });

        const override = await overrideDal.create({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "bash",
          pattern: "echo ok",
        });

        const res = await policy.evaluateToolCall({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          toolId: "bash",
          toolMatchTarget: "echo ok",
          playbookBundle,
        });

        expect(res.decision).toBe("allow");
        expect(res.applied_override_ids).toEqual([override.policy_override_id]);
      } finally {
        await db.close();
      }
    });
  });
});
