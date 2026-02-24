import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "tyrum-policy-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("PolicyService regressions (precedence + overrides)", () => {
  it("enforces require_approval over allow when patterns overlap", async () => {
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
            "  require_approval:",
            "    - tool.*",
            "  deny: []",
            "",
          ].join("\n"),
          "utf-8",
        );

        const prevBundlePath = process.env["TYRUM_POLICY_BUNDLE_PATH"];
        process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;
        try {
          const policy = new PolicyService({
            home,
            snapshotDal: new PolicySnapshotDal(db),
            overrideDal: new PolicyOverrideDal(db),
          });

          const res = await policy.evaluateToolCall({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.exec",
            toolMatchTarget: "echo ok",
          });

          expect(res.decision).toBe("require_approval");
        } finally {
          if (prevBundlePath === undefined) {
            delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
          } else {
            process.env["TYRUM_POLICY_BUNDLE_PATH"] = prevBundlePath;
          }
        }
      } finally {
        await db.close();
      }
    });
  });

  it("enforces deny over require_approval and allow when patterns overlap", async () => {
    await withTempDir(async (home) => {
      const db = openTestSqliteDb();
      try {
        const bundlePath = join(home, "policy.yml");
        await writeFile(
          bundlePath,
          [
            "v: 1",
            "tools:",
            "  default: allow",
            "  allow:",
            "    - tool.exec",
            "  require_approval:",
            "    - tool.*",
            "  deny:",
            "    - tool.exec",
            "",
          ].join("\n"),
          "utf-8",
        );

        const prevBundlePath = process.env["TYRUM_POLICY_BUNDLE_PATH"];
        process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;
        try {
          const policy = new PolicyService({
            home,
            snapshotDal: new PolicySnapshotDal(db),
            overrideDal: new PolicyOverrideDal(db),
          });

          const res = await policy.evaluateToolCall({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.exec",
            toolMatchTarget: "echo ok",
          });

          expect(res.decision).toBe("deny");
        } finally {
          if (prevBundlePath === undefined) {
            delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
          } else {
            process.env["TYRUM_POLICY_BUNDLE_PATH"] = prevBundlePath;
          }
        }
      } finally {
        await db.close();
      }
    });
  });

  it("merges deployment + agent bundles conservatively (require_approval wins over allow)", async () => {
    await withTempDir(async (home) => {
      const db = openTestSqliteDb();
      try {
        const deploymentPath = join(home, "deployment.yml");
        const agentPath = join(home, "policy.yml");

        await writeFile(
          deploymentPath,
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
        await writeFile(
          agentPath,
          [
            "v: 1",
            "tools:",
            "  default: deny",
            "  allow: []",
            "  require_approval:",
            "    - tool.exec",
            "  deny: []",
            "",
          ].join("\n"),
          "utf-8",
        );

        const prevBundlePath = process.env["TYRUM_POLICY_BUNDLE_PATH"];
        process.env["TYRUM_POLICY_BUNDLE_PATH"] = deploymentPath;
        try {
          const policy = new PolicyService({
            home,
            snapshotDal: new PolicySnapshotDal(db),
            overrideDal: new PolicyOverrideDal(db),
          });

          const res = await policy.evaluateToolCall({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.exec",
            toolMatchTarget: "echo ok",
          });

          expect(res.decision).toBe("require_approval");
        } finally {
          if (prevBundlePath === undefined) {
            delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
          } else {
            process.env["TYRUM_POLICY_BUNDLE_PATH"] = prevBundlePath;
          }
        }
      } finally {
        await db.close();
      }
    });
  });

  it("does not allow policy overrides to bypass explicit tool denies", async () => {
    await withTempDir(async (home) => {
      const db = openTestSqliteDb();
      try {
        const bundlePath = join(home, "policy.yml");
        await writeFile(
          bundlePath,
          [
            "v: 1",
            "tools:",
            "  default: allow",
            "  allow: []",
            "  require_approval: []",
            "  deny:",
            "    - tool.exec",
            "",
          ].join("\n"),
          "utf-8",
        );

        const prevBundlePath = process.env["TYRUM_POLICY_BUNDLE_PATH"];
        process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;
        try {
          const overrideDal = new PolicyOverrideDal(db);
          const policy = new PolicyService({
            home,
            snapshotDal: new PolicySnapshotDal(db),
            overrideDal,
          });

          await overrideDal.create({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.exec",
            pattern: "echo ok",
          });

          const res = await policy.evaluateToolCall({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.exec",
            toolMatchTarget: "echo ok",
          });

          expect(res.decision).toBe("deny");
          expect(res.applied_override_ids).toBeUndefined();
        } finally {
          if (prevBundlePath === undefined) {
            delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
          } else {
            process.env["TYRUM_POLICY_BUNDLE_PATH"] = prevBundlePath;
          }
        }
      } finally {
        await db.close();
      }
    });
  });

  it("does not allow policy overrides to bypass non-tool approval gates (egress)", async () => {
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
            "    - tool.http.fetch",
            "  require_approval: []",
            "  deny: []",
            "network_egress:",
            "  default: require_approval",
            "  allow: []",
            "  require_approval: []",
            "  deny: []",
            "",
          ].join("\n"),
          "utf-8",
        );

        const prevBundlePath = process.env["TYRUM_POLICY_BUNDLE_PATH"];
        process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;
        try {
          const overrideDal = new PolicyOverrideDal(db);
          const policy = new PolicyService({
            home,
            snapshotDal: new PolicySnapshotDal(db),
            overrideDal,
          });

          await overrideDal.create({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.http.fetch",
            pattern: "https://example.com/",
          });

          const res = await policy.evaluateToolCall({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.http.fetch",
            toolMatchTarget: "https://example.com/",
            url: "https://example.com/",
          });

          expect(res.decision).toBe("require_approval");
          expect(res.applied_override_ids).toBeUndefined();
        } finally {
          if (prevBundlePath === undefined) {
            delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
          } else {
            process.env["TYRUM_POLICY_BUNDLE_PATH"] = prevBundlePath;
          }
        }
      } finally {
        await db.close();
      }
    });
  });

  it("allows policy overrides to relax require_approval → allow for matching tool actions", async () => {
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
            "  allow: []",
            "  require_approval:",
            "    - tool.exec",
            "  deny: []",
            "",
          ].join("\n"),
          "utf-8",
        );

        const prevBundlePath = process.env["TYRUM_POLICY_BUNDLE_PATH"];
        process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;
        try {
          const overrideDal = new PolicyOverrideDal(db);
          const policy = new PolicyService({
            home,
            snapshotDal: new PolicySnapshotDal(db),
            overrideDal,
          });

          const override = await overrideDal.create({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.exec",
            pattern: "echo ok",
          });

          const res = await policy.evaluateToolCall({
            agentId: "agent-1",
            workspaceId: "ws-1",
            toolId: "tool.exec",
            toolMatchTarget: "echo ok",
          });

          expect(res.decision).toBe("allow");
          expect(res.applied_override_ids).toEqual([override.policy_override_id]);
        } finally {
          if (prevBundlePath === undefined) {
            delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
          } else {
            process.env["TYRUM_POLICY_BUNDLE_PATH"] = prevBundlePath;
          }
        }
      } finally {
        await db.close();
      }
    });
  });
});

