import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyBundle, type ArtifactKind, type ArtifactRef } from "@tyrum/contracts";
import { ArtifactLifecycleScheduler } from "../../src/modules/artifact/lifecycle.js";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const INSERT_WITH_SENSITIVITY = `INSERT INTO execution_artifacts (
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
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_WITHOUT_SENSITIVITY = `INSERT INTO execution_artifacts (
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
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

type SeedExecutionArtifactInput = {
  snapshotId: string;
  body: string | Buffer;
  createdAt: string;
  kind?: ArtifactKind;
  labels?: string[];
  mimeType?: string;
  metadata?: unknown;
  sensitivity?: string;
  omitSensitivity?: boolean;
};

export type ArtifactLifecycleHarness = {
  db: SqliteDb;
  artifactStore: FsArtifactStore;
  snapshotDal: PolicySnapshotDal;
  close: () => Promise<void>;
  createSnapshot: (bundle: unknown) => ReturnType<PolicySnapshotDal["getOrCreate"]>;
  seedExecutionArtifact: (input: SeedExecutionArtifactInput) => Promise<ArtifactRef>;
};

function asBuffer(body: string | Buffer): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : body;
}

async function insertExecutionArtifact(
  db: SqliteDb,
  ref: ArtifactRef,
  input: SeedExecutionArtifactInput,
): Promise<void> {
  const baseParams = [
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
  ];

  if (input.omitSensitivity) {
    await db.run(INSERT_WITHOUT_SENSITIVITY, [...baseParams, input.snapshotId]);
    return;
  }

  await db.run(INSERT_WITH_SENSITIVITY, [
    ...baseParams,
    input.sensitivity ?? "normal",
    input.snapshotId,
  ]);
}

export async function createArtifactLifecycleHarness(): Promise<ArtifactLifecycleHarness> {
  const baseDir = await mkdtemp(join(tmpdir(), "tyrum-artifacts-gc-"));
  const artifactStore = new FsArtifactStore(baseDir);
  const db = openTestSqliteDb();
  const snapshotDal = new PolicySnapshotDal(db);

  return {
    db,
    artifactStore,
    snapshotDal,
    createSnapshot: async (bundle) =>
      await snapshotDal.getOrCreate(DEFAULT_TENANT_ID, PolicyBundle.parse(bundle)),
    seedExecutionArtifact: async (input) => {
      const ref = await artifactStore.put({
        kind: input.kind ?? "log",
        mime_type: input.mimeType ?? "text/plain",
        body: asBuffer(input.body),
        created_at: input.createdAt,
        labels: input.labels ?? [],
        metadata: input.metadata,
      });
      await insertExecutionArtifact(db, ref, input);
      return ref;
    },
    close: async () => {
      await db.close();
      await rm(baseDir, { recursive: true, force: true });
    },
  };
}

export function daysAgoIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

export function hoursAgoIso(nowMs: number, hours: number): string {
  return new Date(nowMs - hours * 60 * 60 * 1000).toISOString();
}

export async function tickArtifactLifecycle(
  harness: ArtifactLifecycleHarness,
  options: {
    nowMs: number;
    nowIso?: string;
    batchSize?: number;
    count?: number;
  },
): Promise<void> {
  const nowIso = options.nowIso ?? new Date(options.nowMs).toISOString();
  const scheduler = new ArtifactLifecycleScheduler({
    db: harness.db,
    artifactStore: harness.artifactStore,
    policySnapshotDal: harness.snapshotDal,
    clock: () => ({ nowMs: options.nowMs, nowIso }),
    tickMs: 10_000,
    batchSize: options.batchSize,
  });

  for (let index = 0; index < (options.count ?? 1); index += 1) {
    await scheduler.tick();
  }
}
