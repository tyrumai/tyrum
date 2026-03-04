/**
 * Artifact lifecycle scheduler — enforces retention and quota policy by
 * pruning artifact bytes from the ArtifactStore while keeping durable
 * StateStore metadata.
 */

import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";
import { PolicyBundle } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import type { Logger } from "../observability/logger.js";
import type { PolicySnapshotDal } from "../policy/snapshot-dal.js";
import type { ArtifactStore } from "./store.js";

const DEFAULT_TICK_MS = 5 * 60_000;
const DEFAULT_BATCH = 100;
const NO_RETENTION_EXPIRES_AT = "9999-12-31T23:59:59.999Z";

type ArtifactSensitivity = "normal" | "sensitive";

export interface ArtifactLifecycleSchedulerClock {
  nowMs: number;
  nowIso: string;
}

export type ArtifactLifecycleSchedulerClockFn = () => ArtifactLifecycleSchedulerClock;

export interface ArtifactLifecycleSchedulerOptions {
  db: SqlDb;
  artifactStore: ArtifactStore;
  policySnapshotDal: PolicySnapshotDal;
  logger?: Logger;
  tickMs?: number;
  keepProcessAlive?: boolean;
  batchSize?: number;
  clock?: ArtifactLifecycleSchedulerClockFn;
}

type ArtifactRow = {
  artifact_id: string;
  workspace_id: string;
  agent_id: string | null;
  kind: string;
  created_at: string | Date;
  size_bytes: number | null;
  sensitivity: string;
  policy_snapshot_id: string | null;
  retention_expires_at: string | Date | null;
};

type BucketKey = {
  workspace_id: string;
  agent_id: string | null;
  kind: string;
  sensitivity: ArtifactSensitivity;
};

function defaultClock(): ArtifactLifecycleSchedulerClock {
  const now = new Date();
  return { nowMs: now.getTime(), nowIso: now.toISOString() };
}

function normalizeSensitivity(value: string | null | undefined): ArtifactSensitivity {
  return value?.trim().toLowerCase() === "sensitive" ? "sensitive" : "normal";
}

function minPositive(values: Array<number | undefined>): number | undefined {
  const candidates = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}

function resolveRetentionDays(
  bundle: PolicyBundleT,
  label: string,
  sensitivity: ArtifactSensitivity,
): number | undefined {
  const artifacts = bundle.artifacts;
  if (!artifacts) return undefined;

  // Precedence: most-specific rule wins.
  // - by_label_sensitivity(label,sensitivity)
  // - by_sensitivity(sensitivity)
  // - by_label(label)
  // - defaults (retention.default_days)
  const byLabelSensitivity = artifacts.retention?.by_label_sensitivity?.[label]?.[sensitivity];
  if (
    typeof byLabelSensitivity === "number" &&
    Number.isFinite(byLabelSensitivity) &&
    byLabelSensitivity > 0
  ) {
    return byLabelSensitivity;
  }

  const bySensitivity = artifacts.retention?.by_sensitivity?.[sensitivity];
  if (typeof bySensitivity === "number" && Number.isFinite(bySensitivity) && bySensitivity > 0) {
    return bySensitivity;
  }

  const byLabel = artifacts.retention?.by_label?.[label];
  if (typeof byLabel === "number" && Number.isFinite(byLabel) && byLabel > 0) {
    return byLabel;
  }

  return minPositive([artifacts.retention?.default_days]);
}

function resolveQuotaMaxBytes(
  bundle: PolicyBundleT,
  label: string,
  sensitivity: ArtifactSensitivity,
): number | undefined {
  const artifacts = bundle.artifacts;
  if (!artifacts) return undefined;

  // Precedence: most-specific rule wins.
  // - by_label_sensitivity(label,sensitivity)
  // - by_sensitivity(sensitivity)
  // - by_label(label)
  // - defaults (quota.default_max_bytes)
  const byLabelSensitivity = artifacts.quota?.by_label_sensitivity?.[label]?.[sensitivity];
  if (
    typeof byLabelSensitivity === "number" &&
    Number.isFinite(byLabelSensitivity) &&
    byLabelSensitivity > 0
  ) {
    return byLabelSensitivity;
  }

  const bySensitivity = artifacts.quota?.by_sensitivity?.[sensitivity];
  if (typeof bySensitivity === "number" && Number.isFinite(bySensitivity) && bySensitivity > 0) {
    return bySensitivity;
  }

  const byLabel = artifacts.quota?.by_label?.[label];
  if (typeof byLabel === "number" && Number.isFinite(byLabel) && byLabel > 0) {
    return byLabel;
  }

  return minPositive([artifacts.quota?.default_max_bytes]);
}

function whereNullableEquals(
  column: string,
  value: string | null,
): { clause: string; params: unknown[] } {
  if (value === null) return { clause: `${column} IS NULL`, params: [] };
  return { clause: `${column} = ?`, params: [value] };
}

function normalizedSensitivitySql(column: string): string {
  return `CASE WHEN LOWER(TRIM(${column})) = 'sensitive' THEN 'sensitive' ELSE 'normal' END`;
}

export class ArtifactLifecycleScheduler {
  private readonly db: SqlDb;
  private readonly artifactStore: ArtifactStore;
  private readonly policySnapshotDal: PolicySnapshotDal;
  private readonly logger?: Logger;
  private readonly tickMs: number;
  private readonly keepProcessAlive: boolean;
  private readonly batchSize: number;
  private readonly clock: ArtifactLifecycleSchedulerClockFn;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: ArtifactLifecycleSchedulerOptions) {
    this.db = opts.db;
    this.artifactStore = opts.artifactStore;
    this.policySnapshotDal = opts.policySnapshotDal;
    this.logger = opts.logger;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
    this.batchSize = Math.max(1, Math.min(1000, opts.batchSize ?? DEFAULT_BATCH));
    this.clock = opts.clock ?? defaultClock;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("artifact.lifecycle_tick_failed", { error: message });
      });
    }, this.tickMs);
    if (!this.keepProcessAlive) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed for testing — runs one lifecycle enforcement cycle. */
  async tick(): Promise<void> {
    await this.backfillRetentionExpiresAt();
    await this.pruneExpiredArtifacts();
    await this.enforceQuotas();
  }

  private async bundleForSnapshot(
    cache: Map<string, PolicyBundleT>,
    policySnapshotId: string | null,
  ): Promise<PolicyBundleT> {
    if (!policySnapshotId) return PolicyBundle.parse({ v: 1 });
    const cached = cache.get(policySnapshotId);
    if (cached) return cached;
    const row = await this.policySnapshotDal.getById(policySnapshotId);
    const bundle = row?.bundle ?? PolicyBundle.parse({ v: 1 });
    cache.set(policySnapshotId, bundle);
    return bundle;
  }

  private async backfillRetentionExpiresAt(): Promise<void> {
    const rows = await this.db.all<ArtifactRow>(
      `SELECT
         artifact_id,
         workspace_id,
         agent_id,
         kind,
         created_at,
         size_bytes,
         sensitivity,
         policy_snapshot_id,
         retention_expires_at
       FROM execution_artifacts
       WHERE bytes_deleted_at IS NULL AND retention_expires_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
      [this.batchSize],
    );

    if (rows.length === 0) return;

    const bundleCache = new Map<string, PolicyBundleT>();
    for (const row of rows) {
      const sensitivity = normalizeSensitivity(row.sensitivity);
      const bundle = await this.bundleForSnapshot(bundleCache, row.policy_snapshot_id);
      const retentionDays = resolveRetentionDays(bundle, row.kind, sensitivity);
      if (!retentionDays) {
        // Mark as evaluated so old rows without retention policy don't
        // permanently starve the backfill batch.
        await this.db.run(
          `UPDATE execution_artifacts
           SET retention_expires_at = ?
           WHERE artifact_id = ? AND retention_expires_at IS NULL`,
          [NO_RETENTION_EXPIRES_AT, row.artifact_id],
        );
        continue;
      }

      const createdIso = normalizeDbDateTime(row.created_at);
      if (!createdIso) continue;
      const createdMs = Date.parse(createdIso);
      if (!Number.isFinite(createdMs)) continue;

      const expiresAt = new Date(createdMs + retentionDays * 24 * 60 * 60 * 1000).toISOString();
      await this.db.run(
        `UPDATE execution_artifacts
         SET retention_expires_at = ?
         WHERE artifact_id = ? AND retention_expires_at IS NULL`,
        [expiresAt, row.artifact_id],
      );
    }
  }

  private async pruneExpiredArtifacts(): Promise<void> {
    const { nowIso } = this.clock();

    const rows = await this.db.all<Pick<ArtifactRow, "artifact_id">>(
      `SELECT artifact_id
       FROM execution_artifacts
       WHERE bytes_deleted_at IS NULL
         AND retention_expires_at IS NOT NULL
         AND retention_expires_at <= ?
       ORDER BY retention_expires_at ASC
       LIMIT ?`,
      [nowIso, this.batchSize],
    );

    for (const row of rows) {
      await this.pruneArtifactBytes(row.artifact_id, "retention");
    }
  }

  private async enforceQuotas(): Promise<void> {
    const buckets = await this.db.all<{
      workspace_id: string;
      agent_id: string | null;
      kind: string;
      sensitivity: string;
    }>(
      `SELECT DISTINCT workspace_id, agent_id, kind, ${normalizedSensitivitySql("sensitivity")} AS sensitivity
       FROM execution_artifacts
       WHERE bytes_deleted_at IS NULL`,
    );

    const bundleCache = new Map<string, PolicyBundleT>();
    for (const bucket of buckets) {
      const key: BucketKey = {
        workspace_id: bucket.workspace_id,
        agent_id: bucket.agent_id,
        kind: bucket.kind,
        sensitivity: normalizeSensitivity(bucket.sensitivity),
      };

      const maxBytes = await this.resolveBucketQuotaMaxBytes(bundleCache, key);
      if (!maxBytes) continue;

      const total = await this.sumBucketBytes(key);
      if (total <= maxBytes) continue;

      const artifacts = await this.listBucketArtifactsOldestFirst(key);
      let remaining = total;
      for (const artifact of artifacts) {
        if (remaining <= maxBytes) break;
        await this.pruneArtifactBytes(artifact.artifact_id, "quota");
        remaining -= Math.max(0, artifact.size_bytes ?? 0);
      }
    }
  }

  private async resolveBucketQuotaMaxBytes(
    bundleCache: Map<string, PolicyBundleT>,
    bucket: BucketKey,
  ): Promise<number | undefined> {
    const agent = whereNullableEquals("agent_id", bucket.agent_id);

    const row = await this.db.get<{ policy_snapshot_id: string }>(
      `SELECT policy_snapshot_id
       FROM execution_artifacts
       WHERE bytes_deleted_at IS NULL
         AND workspace_id = ?
         AND kind = ?
         AND ${normalizedSensitivitySql("sensitivity")} = ?
         AND policy_snapshot_id IS NOT NULL
         AND ${agent.clause}
       ORDER BY created_at DESC, artifact_id DESC
       LIMIT 1`,
      [bucket.workspace_id, bucket.kind, bucket.sensitivity, ...agent.params],
    );

    if (!row?.policy_snapshot_id) return undefined;
    const bundle = await this.bundleForSnapshot(bundleCache, row.policy_snapshot_id);
    return resolveQuotaMaxBytes(bundle, bucket.kind, bucket.sensitivity);
  }

  private async sumBucketBytes(bucket: BucketKey): Promise<number> {
    const agent = whereNullableEquals("agent_id", bucket.agent_id);
    const row = await this.db.get<{ total_bytes: number | null }>(
      `SELECT SUM(COALESCE(size_bytes, 0)) AS total_bytes
       FROM execution_artifacts
       WHERE bytes_deleted_at IS NULL
         AND workspace_id = ?
         AND kind = ?
         AND ${normalizedSensitivitySql("sensitivity")} = ?
         AND ${agent.clause}`,
      [bucket.workspace_id, bucket.kind, bucket.sensitivity, ...agent.params],
    );
    return row?.total_bytes ?? 0;
  }

  private async listBucketArtifactsOldestFirst(
    bucket: BucketKey,
  ): Promise<Array<{ artifact_id: string; size_bytes: number | null }>> {
    const agent = whereNullableEquals("agent_id", bucket.agent_id);
    return await this.db.all<{ artifact_id: string; size_bytes: number | null }>(
      `SELECT artifact_id, size_bytes
       FROM execution_artifacts
       WHERE bytes_deleted_at IS NULL
         AND workspace_id = ?
         AND kind = ?
         AND ${normalizedSensitivitySql("sensitivity")} = ?
         AND ${agent.clause}
       ORDER BY created_at ASC, artifact_id ASC`,
      [bucket.workspace_id, bucket.kind, bucket.sensitivity, ...agent.params],
    );
  }

  private async pruneArtifactBytes(
    artifactId: string,
    reason: "retention" | "quota",
  ): Promise<void> {
    const { nowIso } = this.clock();

    try {
      await this.artifactStore.delete(artifactId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("artifact.bytes_delete_failed", {
        artifact_id: artifactId,
        reason,
        error: message,
      });
      return;
    }

    await this.db.run(
      `UPDATE execution_artifacts
       SET bytes_deleted_at = ?, bytes_deleted_reason = ?
       WHERE artifact_id = ? AND bytes_deleted_at IS NULL`,
      [nowIso, reason, artifactId],
    );
  }
}
