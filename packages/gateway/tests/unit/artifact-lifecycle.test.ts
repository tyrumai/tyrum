import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolicyBundle } from "@tyrum/schemas";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref.artifact_id,
          "default",
          "agent-1",
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ref.artifact_id,
          "default",
          "agent-1",
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
});

