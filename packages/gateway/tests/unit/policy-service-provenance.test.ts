import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
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

describe("PolicyService provenance rules", () => {
  it("defaults to requiring approval for untrusted tool.exec when provenance config is omitted", async () => {
    await withTempDir(async (home) => {
      const db = openTestSqliteDb();
      try {
        const bundlePath = join(home, "policy.yml");
        await writeFile(
          bundlePath,
          [
            "v: 1",
            "tools:",
            "  default: deny",
            "  allow:",
            "    - tool.exec",
            "  require_approval: []",
            "  deny: []",
            "",
          ].join("\n"),
          "utf-8",
        );

        const policy = new PolicyService({
          home,
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal: new PolicyOverrideDal(db),
          deploymentPolicy: { bundlePath },
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
  });

  it("escalates tool.exec to require_approval when input provenance is untrusted", async () => {
    await withTempDir(async (home) => {
      const db = openTestSqliteDb();
      try {
        const bundlePath = join(home, "policy.yml");
        await writeFile(
          bundlePath,
          [
            "v: 1",
            "tools:",
            "  default: deny",
            "  allow:",
            "    - tool.exec",
            "  require_approval: []",
            "  deny: []",
            "provenance:",
            "  untrusted_shell_requires_approval: true",
            "",
          ].join("\n"),
          "utf-8",
        );

        const policy = new PolicyService({
          home,
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal: new PolicyOverrideDal(db),
          deploymentPolicy: { bundlePath },
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
  });

  it("allows policy overrides to bypass the untrusted-shell approval gate", async () => {
    await withTempDir(async (home) => {
      const db = openTestSqliteDb();
      try {
        const bundlePath = join(home, "policy.yml");
        await writeFile(
          bundlePath,
          [
            "v: 1",
            "tools:",
            "  default: deny",
            "  allow:",
            "    - tool.exec",
            "  require_approval: []",
            "  deny: []",
            "provenance:",
            "  untrusted_shell_requires_approval: true",
            "",
          ].join("\n"),
          "utf-8",
        );

        const overrideDal = new PolicyOverrideDal(db);
        const policy = new PolicyService({
          home,
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal,
          deploymentPolicy: { bundlePath },
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
});
