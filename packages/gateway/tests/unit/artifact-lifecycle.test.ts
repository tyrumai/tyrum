import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyBundle } from "@tyrum/schemas";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("Artifact lifecycle (retention + quotas)", () => {
  let db: SqliteDb;
  let baseDir: string;
  let artifactStore: FsArtifactStore;
  let snapshotDal: PolicySnapshotDal;

  beforeEach(async () => {
    db = openTestSqliteDb();
    baseDir = await mkdtemp(join(tmpdir(), "tyrum-artifacts-gc-"));
    artifactStore = new FsArtifactStore(baseDir);
    snapshotDal = new PolicySnapshotDal(db);
  });

  afterEach(async () => {
    await db.close();
    await rm(baseDir, { recursive: true, force: true });
  });

  it("adds durable lifecycle tracking columns to execution_artifacts", async () => {
    const columns = await db.all<{ name: string }>("PRAGMA table_info(execution_artifacts)");
    const names = columns.map((c) => c.name);

    expect(names).toContain("retention_expires_at");
    expect(names).toContain("bytes_deleted_at");
    expect(names).toContain("bytes_deleted_reason");
  });

  it("prunes artifact bytes once retention policy expires (by label + sensitivity)", async () => {
    const nowMs = Date.now();
    const oldIso = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
    const freshIso = new Date(nowMs - 6 * 60 * 60 * 1000).toISOString();

    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          retention: {
            by_label: { log: 1 },
          },
        },
      }),
    );

    const expiredRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("old", "utf8"),
      created_at: oldIso,
      labels: ["log"],
    });
    const keptRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("new", "utf8"),
      created_at: freshIso,
      labels: ["log"],
    });

    for (const ref of [expiredRef, keptRef]) {
      await db.run(
        `INSERT INTO execution_artifacts (
	           tenant_id,
	           artifact_id,
	           workspace_id,
	           agent_id,
	           kind,
           uri,
           created_at,
           mime_type,
           size_bytes,
           sha256,
           labels_json,
	           metadata_json,
	           sensitivity,
	           policy_snapshot_id
	         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          ref.artifact_id,
          DEFAULT_WORKSPACE_ID,
          DEFAULT_AGENT_ID,
          ref.kind,
          ref.uri,
          ref.created_at,
          ref.mime_type ?? null,
          ref.size_bytes ?? null,
          ref.sha256 ?? null,
          JSON.stringify(ref.labels ?? []),
          JSON.stringify(ref.metadata ?? {}),
          "normal",
          snapshot.policy_snapshot_id,
        ],
      );
    }

    const { ArtifactLifecycleScheduler } = await import("../../src/modules/artifact/lifecycle.js");
    const scheduler = new ArtifactLifecycleScheduler({
      db,
      artifactStore,
      policySnapshotDal: snapshotDal,
      clock: () => ({ nowMs, nowIso: new Date(nowMs).toISOString() }),
      tickMs: 10_000,
    });

    await scheduler.tick();

    expect(await artifactStore.get(expiredRef.artifact_id)).toBeNull();
    expect(await artifactStore.get(keptRef.artifact_id)).not.toBeNull();

    const rows = await db.all<{
      artifact_id: string;
      retention_expires_at: string | null;
      bytes_deleted_at: string | null;
      bytes_deleted_reason: string | null;
    }>(
      `SELECT artifact_id, retention_expires_at, bytes_deleted_at, bytes_deleted_reason
       FROM execution_artifacts
       WHERE artifact_id IN (?, ?)
       ORDER BY artifact_id`,
      [expiredRef.artifact_id, keptRef.artifact_id],
    );

    const expired = rows.find((r) => r.artifact_id === expiredRef.artifact_id);
    const kept = rows.find((r) => r.artifact_id === keptRef.artifact_id);

    expect(expired?.retention_expires_at).toBeTruthy();
    expect(expired?.bytes_deleted_at).toBeTruthy();
    expect(expired?.bytes_deleted_reason).toBe("retention");

    expect(kept?.retention_expires_at).toBeTruthy();
    expect(kept?.bytes_deleted_at).toBeNull();
  });

  it("normalizes SQLite datetime('now') timestamps as UTC when backfilling retention_expires_at", async () => {
    const originalTz = process.env["TZ"];
    process.env["TZ"] = "America/Los_Angeles";
    try {
      const nowIso = "2026-02-24T12:00:00.000Z";
      const nowMs = Date.parse(nowIso);
      const createdAt = "2026-02-24 00:00:00"; // SQLite `datetime('now')` format (UTC).

      const snapshot = await snapshotDal.getOrCreate(
        PolicyBundle.parse({
          v: 1,
          artifacts: {
            default: "allow",
            retention: {
              by_label: { log: 1 },
            },
          },
        }),
      );

      const ref = await artifactStore.put({
        kind: "log",
        mime_type: "text/plain",
        body: Buffer.from("bytes", "utf8"),
        created_at: createdAt,
        labels: ["log"],
      });

      await db.run(
        `INSERT INTO execution_artifacts (
	         tenant_id,
	         artifact_id,
	         workspace_id,
	         agent_id,
	         kind,
           uri,
           created_at,
           mime_type,
           size_bytes,
           sha256,
           labels_json,
	         metadata_json,
	         sensitivity,
	         policy_snapshot_id
	       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          ref.artifact_id,
          DEFAULT_WORKSPACE_ID,
          DEFAULT_AGENT_ID,
          ref.kind,
          ref.uri,
          createdAt,
          ref.mime_type ?? null,
          ref.size_bytes ?? null,
          ref.sha256 ?? null,
          JSON.stringify(ref.labels ?? []),
          JSON.stringify(ref.metadata ?? {}),
          "normal",
          snapshot.policy_snapshot_id,
        ],
      );

      const { ArtifactLifecycleScheduler } =
        await import("../../src/modules/artifact/lifecycle.js");
      const scheduler = new ArtifactLifecycleScheduler({
        db,
        artifactStore,
        policySnapshotDal: snapshotDal,
        clock: () => ({ nowMs, nowIso }),
        tickMs: 10_000,
      });

      await scheduler.tick();

      const row = await db.get<{ retention_expires_at: string | null }>(
        "SELECT retention_expires_at FROM execution_artifacts WHERE artifact_id = ?",
        [ref.artifact_id],
      );

      // If SQLite timestamps are treated as local time, this will be offset by TZ.
      expect(row?.retention_expires_at).toBe("2026-02-25T00:00:00.000Z");
    } finally {
      if (originalTz === undefined) delete process.env["TZ"];
      else process.env["TZ"] = originalTz;
    }
  });

  it("does not starve retention backfill when oldest artifacts have no retention policy", async () => {
    const nowMs = Date.now();
    const oldIso1 = new Date(nowMs - 3 * 60 * 60 * 1000).toISOString();
    const oldIso2 = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
    const newerIso = new Date(nowMs - 1 * 60 * 60 * 1000).toISOString();

    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          retention: {
            by_label: { log: 1 },
          },
        },
      }),
    );

    const noPolicy1 = await artifactStore.put({
      kind: "diff",
      mime_type: "text/plain",
      body: Buffer.from("old-1", "utf8"),
      created_at: oldIso1,
      labels: ["diff"],
    });
    const noPolicy2 = await artifactStore.put({
      kind: "diff",
      mime_type: "text/plain",
      body: Buffer.from("old-2", "utf8"),
      created_at: oldIso2,
      labels: ["diff"],
    });
    const withPolicy = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("new", "utf8"),
      created_at: newerIso,
      labels: ["log"],
    });

    for (const ref of [noPolicy1, noPolicy2, withPolicy]) {
      await db.run(
        `INSERT INTO execution_artifacts (
	           tenant_id,
	           artifact_id,
	           workspace_id,
	           agent_id,
	           kind,
           uri,
           created_at,
           mime_type,
           size_bytes,
           sha256,
           labels_json,
	           metadata_json,
	           sensitivity,
	           policy_snapshot_id
	         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          ref.artifact_id,
          DEFAULT_WORKSPACE_ID,
          DEFAULT_AGENT_ID,
          ref.kind,
          ref.uri,
          ref.created_at,
          ref.mime_type ?? null,
          ref.size_bytes ?? null,
          ref.sha256 ?? null,
          JSON.stringify(ref.labels ?? []),
          JSON.stringify(ref.metadata ?? {}),
          "normal",
          snapshot.policy_snapshot_id,
        ],
      );
    }

    const { ArtifactLifecycleScheduler } = await import("../../src/modules/artifact/lifecycle.js");
    const scheduler = new ArtifactLifecycleScheduler({
      db,
      artifactStore,
      policySnapshotDal: snapshotDal,
      clock: () => ({ nowMs, nowIso: new Date(nowMs).toISOString() }),
      tickMs: 10_000,
      batchSize: 2,
    });

    await scheduler.tick();
    await scheduler.tick();

    const row = await db.get<{ retention_expires_at: string | null }>(
      "SELECT retention_expires_at FROM execution_artifacts WHERE artifact_id = ?",
      [withPolicy.artifact_id],
    );
    expect(row?.retention_expires_at).toBeTruthy();
  });

  it("prunes oldest artifacts to satisfy per-label quota (by label + sensitivity)", async () => {
    const nowMs = Date.now();
    const olderIso = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
    const newerIso = new Date(nowMs - 1 * 60 * 60 * 1000).toISOString();

    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          quota: {
            by_label: { log: 10 },
          },
        },
      }),
    );

    const oldRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("123456", "utf8"), // 6 bytes
      created_at: olderIso,
      labels: ["log"],
    });
    const newRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("abcdef", "utf8"), // 6 bytes
      created_at: newerIso,
      labels: ["log"],
    });

    for (const ref of [oldRef, newRef]) {
      await db.run(
        `INSERT INTO execution_artifacts (
	           tenant_id,
	           artifact_id,
	           workspace_id,
	           agent_id,
	           kind,
           uri,
           created_at,
           mime_type,
           size_bytes,
           sha256,
           labels_json,
	           metadata_json,
	           sensitivity,
	           policy_snapshot_id
	         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          ref.artifact_id,
          DEFAULT_WORKSPACE_ID,
          DEFAULT_AGENT_ID,
          ref.kind,
          ref.uri,
          ref.created_at,
          ref.mime_type ?? null,
          ref.size_bytes ?? null,
          ref.sha256 ?? null,
          JSON.stringify(ref.labels ?? []),
          JSON.stringify(ref.metadata ?? {}),
          "normal",
          snapshot.policy_snapshot_id,
        ],
      );
    }

    const { ArtifactLifecycleScheduler } = await import("../../src/modules/artifact/lifecycle.js");
    const scheduler = new ArtifactLifecycleScheduler({
      db,
      artifactStore,
      policySnapshotDal: snapshotDal,
      clock: () => ({ nowMs, nowIso: new Date(nowMs).toISOString() }),
      tickMs: 10_000,
    });

    await scheduler.tick();

    expect(await artifactStore.get(oldRef.artifact_id)).toBeNull();
    expect(await artifactStore.get(newRef.artifact_id)).not.toBeNull();

    const rows = await db.all<{
      artifact_id: string;
      bytes_deleted_at: string | null;
      bytes_deleted_reason: string | null;
    }>(
      `SELECT artifact_id, bytes_deleted_at, bytes_deleted_reason
       FROM execution_artifacts
       WHERE artifact_id IN (?, ?)
       ORDER BY artifact_id`,
      [oldRef.artifact_id, newRef.artifact_id],
    );

    const oldRow = rows.find((r) => r.artifact_id === oldRef.artifact_id);
    const newRow = rows.find((r) => r.artifact_id === newRef.artifact_id);

    expect(oldRow?.bytes_deleted_at).toBeTruthy();
    expect(oldRow?.bytes_deleted_reason).toBe("quota");
    expect(newRow?.bytes_deleted_at).toBeNull();
  });

  it("defaults sensitivity to normal for quota enforcement", async () => {
    const nowMs = Date.now();
    const olderIso = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
    const newerIso = new Date(nowMs - 1 * 60 * 60 * 1000).toISOString();

    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          quota: {
            by_label: { log: 10 },
          },
        },
      }),
    );

    const oldRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("123456", "utf8"), // 6 bytes
      created_at: olderIso,
      labels: ["log"],
    });
    const newRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("abcdef", "utf8"), // 6 bytes
      created_at: newerIso,
      labels: ["log"],
    });

    for (const ref of [oldRef, newRef]) {
      await db.run(
        `INSERT INTO execution_artifacts (
	           tenant_id,
	           artifact_id,
	           workspace_id,
	           agent_id,
	           kind,
           uri,
           created_at,
           mime_type,
           size_bytes,
           sha256,
           labels_json,
	           metadata_json,
	           policy_snapshot_id
	         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          ref.artifact_id,
          DEFAULT_WORKSPACE_ID,
          DEFAULT_AGENT_ID,
          ref.kind,
          ref.uri,
          ref.created_at,
          ref.mime_type ?? null,
          ref.size_bytes ?? null,
          ref.sha256 ?? null,
          JSON.stringify(ref.labels ?? []),
          JSON.stringify(ref.metadata ?? {}),
          snapshot.policy_snapshot_id,
        ],
      );
    }

    const { ArtifactLifecycleScheduler } = await import("../../src/modules/artifact/lifecycle.js");
    const scheduler = new ArtifactLifecycleScheduler({
      db,
      artifactStore,
      policySnapshotDal: snapshotDal,
      clock: () => ({ nowMs, nowIso: new Date(nowMs).toISOString() }),
      tickMs: 10_000,
    });

    await scheduler.tick();

    expect(await artifactStore.get(oldRef.artifact_id)).toBeNull();
    expect(await artifactStore.get(newRef.artifact_id)).not.toBeNull();
  });

  it("uses the newest policy snapshot quota when multiple snapshots exist", async () => {
    const nowMs = Date.now();
    const olderIso = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
    const newerIso = new Date(nowMs - 1 * 60 * 60 * 1000).toISOString();

    const smallSnapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          quota: {
            by_label: { log: 10 },
          },
        },
      }),
    );
    const largeSnapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          quota: {
            by_label: { log: 100 },
          },
        },
      }),
    );

    const oldRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("123456", "utf8"), // 6 bytes
      created_at: olderIso,
      labels: ["log"],
    });
    const newRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("abcdef", "utf8"), // 6 bytes
      created_at: newerIso,
      labels: ["log"],
    });

    await db.run(
      `INSERT INTO execution_artifacts (
	         tenant_id,
	         artifact_id,
	         workspace_id,
	         agent_id,
	         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
	         metadata_json,
	         sensitivity,
	         policy_snapshot_id
	       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        oldRef.artifact_id,
        DEFAULT_WORKSPACE_ID,
        DEFAULT_AGENT_ID,
        oldRef.kind,
        oldRef.uri,
        oldRef.created_at,
        oldRef.mime_type ?? null,
        oldRef.size_bytes ?? null,
        oldRef.sha256 ?? null,
        JSON.stringify(oldRef.labels ?? []),
        JSON.stringify(oldRef.metadata ?? {}),
        "normal",
        smallSnapshot.policy_snapshot_id,
      ],
    );

    await db.run(
      `INSERT INTO execution_artifacts (
	         tenant_id,
	         artifact_id,
	         workspace_id,
	         agent_id,
	         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
	         metadata_json,
	         sensitivity,
	         policy_snapshot_id
	       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        newRef.artifact_id,
        DEFAULT_WORKSPACE_ID,
        DEFAULT_AGENT_ID,
        newRef.kind,
        newRef.uri,
        newRef.created_at,
        newRef.mime_type ?? null,
        newRef.size_bytes ?? null,
        newRef.sha256 ?? null,
        JSON.stringify(newRef.labels ?? []),
        JSON.stringify(newRef.metadata ?? {}),
        "normal",
        largeSnapshot.policy_snapshot_id,
      ],
    );

    const { ArtifactLifecycleScheduler } = await import("../../src/modules/artifact/lifecycle.js");
    const scheduler = new ArtifactLifecycleScheduler({
      db,
      artifactStore,
      policySnapshotDal: snapshotDal,
      clock: () => ({ nowMs, nowIso: new Date(nowMs).toISOString() }),
      tickMs: 10_000,
    });

    await scheduler.tick();

    // The newest policy snapshot should win (100 bytes), so nothing is pruned.
    expect(await artifactStore.get(oldRef.artifact_id)).not.toBeNull();
    expect(await artifactStore.get(newRef.artifact_id)).not.toBeNull();
  });

  it("uses the most-specific retention rule over broader defaults", async () => {
    const nowMs = Date.now();
    const oldIso = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();

    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          retention: {
            default_days: 1,
            by_label_sensitivity: {
              log: { normal: 30 },
            },
          },
        },
      }),
    );

    const ref = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("old", "utf8"),
      created_at: oldIso,
      labels: ["log"],
    });

    await db.run(
      `INSERT INTO execution_artifacts (
	         tenant_id,
	         artifact_id,
	         workspace_id,
	         agent_id,
	         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
	         metadata_json,
	         sensitivity,
	         policy_snapshot_id
	       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        ref.artifact_id,
        DEFAULT_WORKSPACE_ID,
        DEFAULT_AGENT_ID,
        ref.kind,
        ref.uri,
        ref.created_at,
        ref.mime_type ?? null,
        ref.size_bytes ?? null,
        ref.sha256 ?? null,
        JSON.stringify(ref.labels ?? []),
        JSON.stringify(ref.metadata ?? {}),
        "normal",
        snapshot.policy_snapshot_id,
      ],
    );

    const { ArtifactLifecycleScheduler } = await import("../../src/modules/artifact/lifecycle.js");
    const scheduler = new ArtifactLifecycleScheduler({
      db,
      artifactStore,
      policySnapshotDal: snapshotDal,
      clock: () => ({ nowMs, nowIso: new Date(nowMs).toISOString() }),
      tickMs: 10_000,
    });

    await scheduler.tick();

    // With most-specific precedence, this should use 30 days and keep bytes.
    expect(await artifactStore.get(ref.artifact_id)).not.toBeNull();
  });

  it("uses the most-specific quota rule over broader defaults", async () => {
    const nowMs = Date.now();
    const olderIso = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
    const newerIso = new Date(nowMs - 1 * 60 * 60 * 1000).toISOString();

    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          quota: {
            default_max_bytes: 10,
            by_label_sensitivity: {
              log: { normal: 100 },
            },
          },
        },
      }),
    );

    const oldRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("123456", "utf8"), // 6 bytes
      created_at: olderIso,
      labels: ["log"],
    });
    const newRef = await artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("abcdef", "utf8"), // 6 bytes
      created_at: newerIso,
      labels: ["log"],
    });

    for (const ref of [oldRef, newRef]) {
      await db.run(
        `INSERT INTO execution_artifacts (
	           tenant_id,
	           artifact_id,
	           workspace_id,
	           agent_id,
	           kind,
           uri,
           created_at,
           mime_type,
           size_bytes,
           sha256,
           labels_json,
	           metadata_json,
	           sensitivity,
	           policy_snapshot_id
	         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          ref.artifact_id,
          DEFAULT_WORKSPACE_ID,
          DEFAULT_AGENT_ID,
          ref.kind,
          ref.uri,
          ref.created_at,
          ref.mime_type ?? null,
          ref.size_bytes ?? null,
          ref.sha256 ?? null,
          JSON.stringify(ref.labels ?? []),
          JSON.stringify(ref.metadata ?? {}),
          "normal",
          snapshot.policy_snapshot_id,
        ],
      );
    }

    const { ArtifactLifecycleScheduler } = await import("../../src/modules/artifact/lifecycle.js");
    const scheduler = new ArtifactLifecycleScheduler({
      db,
      artifactStore,
      policySnapshotDal: snapshotDal,
      clock: () => ({ nowMs, nowIso: new Date(nowMs).toISOString() }),
      tickMs: 10_000,
    });

    await scheduler.tick();

    // With most-specific precedence, default_max_bytes should be 100 and nothing is pruned.
    expect(await artifactStore.get(oldRef.artifact_id)).not.toBeNull();
    expect(await artifactStore.get(newRef.artifact_id)).not.toBeNull();
  });
});
