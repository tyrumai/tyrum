import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { PolicyService } from "@tyrum/runtime-policy";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("PolicyService effect defaults", () => {
  it("allows role-permitted read-only tools by default when no explicit tool rule matches", async () => {
    const db = openTestSqliteDb();
    try {
      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
      });

      const res = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "workboard.item.get",
        toolMatchTarget: "workboard.item.get",
        toolEffect: "read_only",
        roleAllowed: true,
      });

      expect(res.decision).toBe("allow");
    } finally {
      await db.close();
    }
  });

  it("requires approval for role-permitted state-changing tools by default when no explicit tool rule matches", async () => {
    const db = openTestSqliteDb();
    try {
      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
      });

      const res = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "workboard.item.update",
        toolMatchTarget: "workboard.item.update",
        toolEffect: "state_changing",
        roleAllowed: true,
      });

      expect(res.decision).toBe("require_approval");
    } finally {
      await db.close();
    }
  });

  it("allows mcp.memory.write by default even though it is state-changing", async () => {
    const db = openTestSqliteDb();
    try {
      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
      });

      const res = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "mcp.memory.write",
        toolMatchTarget: "mcp.memory.write",
        toolEffect: "state_changing",
        roleAllowed: true,
      });

      expect(res.decision).toBe("allow");
      expect(res.decision_record?.rules).toContainEqual(
        expect.objectContaining({
          rule: "tool_policy",
          outcome: "allow",
          detail: expect.stringContaining("default=mcp_memory_write"),
        }),
      );
    } finally {
      await db.close();
    }
  });

  it("still honors explicit policy rules for mcp.memory.write", async () => {
    const db = openTestSqliteDb();
    try {
      await db.run(
        `INSERT INTO policy_bundle_config_revisions (
           tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason
         ) VALUES (?, 'deployment', NULL, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          JSON.stringify({
            v: 1,
            tools: { default: "deny", allow: [], require_approval: ["mcp.memory.write"], deny: [] },
          }),
          new Date().toISOString(),
          JSON.stringify({ kind: "test" }),
          "deployment-memory-write-requires-approval",
        ],
      );

      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
        configStore: createGatewayConfigStore({
          db,
          home: "/tmp/unused",
          deploymentConfig: { state: { mode: "shared" } },
        }),
      });

      const res = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "mcp.memory.write",
        toolMatchTarget: "mcp.memory.write",
        toolEffect: "state_changing",
        roleAllowed: true,
      });

      expect(res.decision).toBe("require_approval");
      expect(res.decision_record?.rules).toContainEqual(
        expect.objectContaining({
          rule: "tool_policy",
          outcome: "require_approval",
          detail: expect.stringContaining("source=explicit_rule"),
        }),
      );
    } finally {
      await db.close();
    }
  });

  it("denies tools outside the role ceiling before approval logic", async () => {
    const db = openTestSqliteDb();
    try {
      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
      });

      const res = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "bash",
        toolMatchTarget: "git status --short",
        toolEffect: "state_changing",
        roleAllowed: false,
      });

      expect(res.decision).toBe("deny");
      expect(res.decision_record?.rules).toContainEqual(
        expect.objectContaining({
          rule: "tool_policy",
          outcome: "deny",
          detail: expect.stringContaining("source=role_ceiling"),
        }),
      );
    } finally {
      await db.close();
    }
  });

  it("loads shared deployment and agent bundles from the config store", async () => {
    const db = openTestSqliteDb();
    try {
      await db.run(
        `INSERT INTO policy_bundle_config_revisions (
           tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason
         ) VALUES (?, 'deployment', NULL, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          JSON.stringify({
            v: 1,
            tools: { default: "deny", allow: ["bash"], require_approval: [], deny: [] },
          }),
          new Date().toISOString(),
          JSON.stringify({ kind: "test" }),
          "deployment",
        ],
      );
      await db.run(
        `INSERT INTO policy_bundle_config_revisions (
           tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason
         ) VALUES (?, 'agent', ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          DEFAULT_AGENT_ID,
          JSON.stringify({
            v: 1,
            tools: { default: "deny", allow: [], require_approval: ["bash"], deny: [] },
          }),
          new Date().toISOString(),
          JSON.stringify({ kind: "test" }),
          "agent",
        ],
      );

      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
        includeAgentHomeBundle: false,
        configStore: createGatewayConfigStore({
          db,
          home: "/tmp/unused",
          deploymentConfig: { state: { mode: "shared" } },
        }),
      });

      const res = await policy.evaluateToolCall({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "bash",
        toolMatchTarget: "echo ok",
      });

      expect(res.decision).toBe("require_approval");
    } finally {
      await db.close();
    }
  });

  it("refreshes shared deployment bundles after config-store updates", async () => {
    const db = openTestSqliteDb();
    try {
      const configStore = createGatewayConfigStore({
        db,
        home: "/tmp/unused",
        deploymentConfig: { state: { mode: "shared" } },
      });
      const policy = new PolicyService({
        home: "/tmp/unused",
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
        includeAgentHomeBundle: false,
        configStore,
      });

      await db.run(
        `INSERT INTO policy_bundle_config_revisions (
           tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason
         ) VALUES (?, 'deployment', NULL, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          JSON.stringify({
            v: 1,
            tools: { default: "deny", allow: ["bash"], require_approval: [], deny: [] },
          }),
          new Date().toISOString(),
          JSON.stringify({ kind: "test" }),
          "deployment-v1",
        ],
      );

      expect(
        (
          await policy.evaluateToolCall({
            tenantId: DEFAULT_TENANT_ID,
            agentId: DEFAULT_AGENT_ID,
            workspaceId: DEFAULT_WORKSPACE_ID,
            toolId: "bash",
            toolMatchTarget: "echo ok",
          })
        ).decision,
      ).toBe("allow");

      await db.run(
        `INSERT INTO policy_bundle_config_revisions (
           tenant_id, scope_kind, agent_id, bundle_json, created_at, created_by_json, reason
         ) VALUES (?, 'deployment', NULL, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          JSON.stringify({
            v: 1,
            tools: { default: "deny", allow: [], require_approval: ["bash"], deny: [] },
          }),
          new Date().toISOString(),
          JSON.stringify({ kind: "test" }),
          "deployment-v2",
        ],
      );

      expect(
        (
          await policy.evaluateToolCall({
            tenantId: DEFAULT_TENANT_ID,
            agentId: DEFAULT_AGENT_ID,
            workspaceId: DEFAULT_WORKSPACE_ID,
            toolId: "bash",
            toolMatchTarget: "echo ok",
          })
        ).decision,
      ).toBe("require_approval");
    } finally {
      await db.close();
    }
  });
});
