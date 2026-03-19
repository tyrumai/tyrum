import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createArtifactLifecycleHarness,
  daysAgoIso,
  hoursAgoIso,
  tickArtifactLifecycle,
  type ArtifactLifecycleHarness,
} from "./artifact-lifecycle.test-support.js";

describe("Artifact lifecycle (retention + quotas)", () => {
  let harness: ArtifactLifecycleHarness;

  beforeEach(async () => {
    harness = await createArtifactLifecycleHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("adds durable lifecycle tracking columns to artifacts", async () => {
    const columns = await harness.db.all<{ name: string }>("PRAGMA table_info(artifacts)");
    const names = columns.map((c) => c.name);

    expect(names).toContain("retention_expires_at");
    expect(names).toContain("bytes_deleted_at");
    expect(names).toContain("bytes_deleted_reason");
  });

  it("prunes artifact bytes once retention policy expires (by label + sensitivity)", async () => {
    const nowMs = Date.now();
    const snapshot = await harness.createSnapshot({
      v: 1,
      artifacts: {
        default: "allow",
        retention: {
          by_label: { log: 1 },
        },
      },
    });
    const expiredRef = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "old",
      createdAt: daysAgoIso(nowMs, 2),
      labels: ["log"],
    });
    const keptRef = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "new",
      createdAt: hoursAgoIso(nowMs, 6),
      labels: ["log"],
    });

    await tickArtifactLifecycle(harness, { nowMs });

    expect(await harness.artifactStore.get(expiredRef.artifact_id)).toBeNull();
    expect(await harness.artifactStore.get(keptRef.artifact_id)).not.toBeNull();

    const rows = await harness.db.all<{
      artifact_id: string;
      retention_expires_at: string | null;
      bytes_deleted_at: string | null;
      bytes_deleted_reason: string | null;
    }>(
      `SELECT artifact_id, retention_expires_at, bytes_deleted_at, bytes_deleted_reason
       FROM artifacts
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

      const snapshot = await harness.createSnapshot({
        v: 1,
        artifacts: {
          default: "allow",
          retention: {
            by_label: { log: 1 },
          },
        },
      });
      const ref = await harness.seedExecutionArtifact({
        snapshotId: snapshot.policy_snapshot_id,
        body: "bytes",
        createdAt,
        labels: ["log"],
      });

      await tickArtifactLifecycle(harness, { nowMs, nowIso });

      const row = await harness.db.get<{ retention_expires_at: string | null }>(
        "SELECT retention_expires_at FROM artifacts WHERE artifact_id = ?",
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
    const snapshot = await harness.createSnapshot({
      v: 1,
      artifacts: {
        default: "allow",
        retention: {
          by_label: { log: 1 },
        },
      },
    });

    await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      kind: "diff",
      body: "old-1",
      createdAt: hoursAgoIso(nowMs, 3),
      labels: ["diff"],
    });
    await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      kind: "diff",
      body: "old-2",
      createdAt: hoursAgoIso(nowMs, 2),
      labels: ["diff"],
    });
    const withPolicy = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "new",
      createdAt: hoursAgoIso(nowMs, 1),
      labels: ["log"],
    });

    await tickArtifactLifecycle(harness, { nowMs, batchSize: 2, count: 2 });

    const row = await harness.db.get<{ retention_expires_at: string | null }>(
      "SELECT retention_expires_at FROM artifacts WHERE artifact_id = ?",
      [withPolicy.artifact_id],
    );
    expect(row?.retention_expires_at).toBeTruthy();
  });

  it("prunes oldest artifacts to satisfy per-label quota (by label + sensitivity)", async () => {
    const nowMs = Date.now();
    const snapshot = await harness.createSnapshot({
      v: 1,
      artifacts: {
        default: "allow",
        quota: {
          by_label: { log: 10 },
        },
      },
    });

    const oldRef = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "123456",
      createdAt: hoursAgoIso(nowMs, 2),
      labels: ["log"],
    });
    const newRef = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "abcdef",
      createdAt: hoursAgoIso(nowMs, 1),
      labels: ["log"],
    });

    await tickArtifactLifecycle(harness, { nowMs });

    expect(await harness.artifactStore.get(oldRef.artifact_id)).toBeNull();
    expect(await harness.artifactStore.get(newRef.artifact_id)).not.toBeNull();

    const rows = await harness.db.all<{
      artifact_id: string;
      bytes_deleted_at: string | null;
      bytes_deleted_reason: string | null;
    }>(
      `SELECT artifact_id, bytes_deleted_at, bytes_deleted_reason
       FROM artifacts
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
    const snapshot = await harness.createSnapshot({
      v: 1,
      artifacts: {
        default: "allow",
        quota: {
          by_label: { log: 10 },
        },
      },
    });

    const oldRef = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "123456",
      createdAt: hoursAgoIso(nowMs, 2),
      labels: ["log"],
      omitSensitivity: true,
    });
    const newRef = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "abcdef",
      createdAt: hoursAgoIso(nowMs, 1),
      labels: ["log"],
      omitSensitivity: true,
    });

    await tickArtifactLifecycle(harness, { nowMs });

    expect(await harness.artifactStore.get(oldRef.artifact_id)).toBeNull();
    expect(await harness.artifactStore.get(newRef.artifact_id)).not.toBeNull();
  });

  it("uses the newest policy snapshot quota when multiple snapshots exist", async () => {
    const nowMs = Date.now();

    const smallSnapshot = await harness.createSnapshot({
      v: 1,
      artifacts: {
        default: "allow",
        quota: {
          by_label: { log: 10 },
        },
      },
    });
    const largeSnapshot = await harness.createSnapshot({
      v: 1,
      artifacts: {
        default: "allow",
        quota: {
          by_label: { log: 100 },
        },
      },
    });

    const oldRef = await harness.seedExecutionArtifact({
      snapshotId: smallSnapshot.policy_snapshot_id,
      body: "123456",
      createdAt: hoursAgoIso(nowMs, 2),
      labels: ["log"],
    });
    const newRef = await harness.seedExecutionArtifact({
      snapshotId: largeSnapshot.policy_snapshot_id,
      body: "abcdef",
      createdAt: hoursAgoIso(nowMs, 1),
      labels: ["log"],
    });

    await tickArtifactLifecycle(harness, { nowMs });

    // The newest policy snapshot should win (100 bytes), so nothing is pruned.
    expect(await harness.artifactStore.get(oldRef.artifact_id)).not.toBeNull();
    expect(await harness.artifactStore.get(newRef.artifact_id)).not.toBeNull();
  });

  it("uses the most-specific retention rule over broader defaults", async () => {
    const nowMs = Date.now();
    const snapshot = await harness.createSnapshot({
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
    });
    const ref = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "old",
      createdAt: daysAgoIso(nowMs, 2),
      labels: ["log"],
    });

    await tickArtifactLifecycle(harness, { nowMs });

    // With most-specific precedence, this should use 30 days and keep bytes.
    expect(await harness.artifactStore.get(ref.artifact_id)).not.toBeNull();
  });

  it("uses the most-specific quota rule over broader defaults", async () => {
    const nowMs = Date.now();
    const snapshot = await harness.createSnapshot({
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
    });

    const oldRef = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "123456",
      createdAt: hoursAgoIso(nowMs, 2),
      labels: ["log"],
    });
    const newRef = await harness.seedExecutionArtifact({
      snapshotId: snapshot.policy_snapshot_id,
      body: "abcdef",
      createdAt: hoursAgoIso(nowMs, 1),
      labels: ["log"],
    });

    await tickArtifactLifecycle(harness, { nowMs });

    // With most-specific precedence, default_max_bytes should be 100 and nothing is pruned.
    expect(await harness.artifactStore.get(oldRef.artifact_id)).not.toBeNull();
    expect(await harness.artifactStore.get(newRef.artifact_id)).not.toBeNull();
  });
});
