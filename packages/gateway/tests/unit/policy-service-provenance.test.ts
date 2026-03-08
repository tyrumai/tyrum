import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { seedDeploymentPolicyBundle } from "../helpers/runtime-config.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("PolicyService provenance rules", () => {
  it("defaults to requiring approval for untrusted tool.exec when provenance config is omitted", async () => {
    const db = openTestSqliteDb();
    try {
      await seedDeploymentPolicyBundle(db, {
        v: 1,
        tools: {
          default: "deny",
          allow: ["tool.exec"],
          require_approval: [],
          deny: [],
        },
      });

      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
        configStore: createGatewayConfigStore({
          db,
          home: "/tmp/unused",
          deploymentConfig: {},
        }),
      });

      const untrusted = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "tool.exec",
        toolMatchTarget: "echo ok",
        inputProvenance: { source: "web", trusted: false },
      });
      expect(untrusted.decision).toBe("require_approval");
    } finally {
      await db.close();
    }
  });

  it("escalates tool.exec to require_approval when input provenance is untrusted", async () => {
    const db = openTestSqliteDb();
    try {
      await seedDeploymentPolicyBundle(db, {
        v: 1,
        tools: {
          default: "deny",
          allow: ["tool.exec"],
          require_approval: [],
          deny: [],
        },
        provenance: {
          untrusted_shell_requires_approval: true,
        },
      });

      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
        configStore: createGatewayConfigStore({
          db,
          home: "/tmp/unused",
          deploymentConfig: {},
        }),
      });

      const trusted = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "tool.exec",
        toolMatchTarget: "echo ok",
        inputProvenance: { source: "user", trusted: true },
      });
      expect(trusted.decision).toBe("allow");

      const untrusted = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "tool.exec",
        toolMatchTarget: "echo ok",
        inputProvenance: { source: "web", trusted: false },
      });
      expect(untrusted.decision).toBe("require_approval");
    } finally {
      await db.close();
    }
  });

  it("allows policy overrides to bypass the untrusted-shell approval gate", async () => {
    const db = openTestSqliteDb();
    try {
      await seedDeploymentPolicyBundle(db, {
        v: 1,
        tools: {
          default: "deny",
          allow: ["tool.exec"],
          require_approval: [],
          deny: [],
        },
        provenance: {
          untrusted_shell_requires_approval: true,
        },
      });

      const overrideDal = new PolicyOverrideDal(db);
      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal,
        configStore: createGatewayConfigStore({
          db,
          home: "/tmp/unused",
          deploymentConfig: {},
        }),
      });

      const override = await overrideDal.create({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "tool.exec",
        pattern: "echo ok",
      });

      const decision = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "tool.exec",
        toolMatchTarget: "echo ok",
        inputProvenance: { source: "web", trusted: false },
      });
      expect(decision.decision).toBe("allow");
      expect(decision.applied_override_ids).toEqual([override.policy_override_id]);
    } finally {
      await db.close();
    }
  });
});
