import { afterEach, describe, expect, it } from "vitest";
import { ArtifactRef } from "@tyrum/schemas";
import { insertArtifactRecordTx } from "../../src/modules/artifact/dal.js";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function makeArtifactRef(artifactId: string) {
  return ArtifactRef.parse({
    artifact_id: artifactId,
    uri: `artifact://${artifactId}`,
    external_url: `https://gateway.example.test/a/${artifactId}`,
    kind: "file",
    media_class: "other",
    created_at: "2026-03-19T09:00:00.000Z",
    filename: `${artifactId}.txt`,
    mime_type: "text/plain",
    size_bytes: 5,
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    labels: [],
    metadata: { source: "test" },
  });
}

describe("insertArtifactRecordTx", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("remains idempotent for repeated inserts of the same artifact", async () => {
    db = openTestSqliteDb();
    const artifact = makeArtifactRef("11111111-1111-4111-8111-111111111111");

    const first = await db.transaction(async (tx) => {
      return await insertArtifactRecordTx(tx, {
        artifact,
        tenantId: DEFAULT_TENANT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        agentId: null,
        sensitivity: "normal",
        policySnapshotId: null,
      });
    });
    const second = await db.transaction(async (tx) => {
      return await insertArtifactRecordTx(tx, {
        artifact,
        tenantId: DEFAULT_TENANT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        agentId: null,
        sensitivity: "normal",
        policySnapshotId: null,
      });
    });

    const accessRows = await db.all<{ access_id: string }>(
      "SELECT access_id FROM artifact_access WHERE access_id = ?",
      [artifact.artifact_id],
    );

    expect(first).toEqual({ inserted: true, accessId: artifact.artifact_id });
    expect(second).toEqual({ inserted: false, accessId: artifact.artifact_id });
    expect(accessRows).toHaveLength(1);
  });

  it("rejects cross-tenant access_id collisions explicitly", async () => {
    db = openTestSqliteDb();
    const artifact = makeArtifactRef("22222222-2222-4222-8222-222222222222");
    const scopeDal = new IdentityScopeDal(db);
    const otherTenantId = await scopeDal.ensureTenantId("tenant-b");
    const otherWorkspaceId = await scopeDal.ensureWorkspaceId(otherTenantId, "default");

    await db.transaction(async (tx) => {
      await insertArtifactRecordTx(tx, {
        artifact,
        tenantId: DEFAULT_TENANT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        agentId: null,
        sensitivity: "normal",
        policySnapshotId: null,
      });
    });

    await expect(
      db.transaction(async (tx) => {
        await insertArtifactRecordTx(tx, {
          artifact,
          tenantId: otherTenantId,
          workspaceId: otherWorkspaceId,
          agentId: null,
          sensitivity: "normal",
          policySnapshotId: null,
        });
      }),
    ).rejects.toThrow(
      `artifact access_id '${artifact.artifact_id}' already exists for tenant '${DEFAULT_TENANT_ID}' artifact '${artifact.artifact_id}'`,
    );
  });
});
