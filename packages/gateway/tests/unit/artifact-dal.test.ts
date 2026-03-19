import { afterEach, describe, expect, it } from "vitest";
import { ArtifactRef, type TyrumUIMessage } from "@tyrum/schemas";
import {
  extractArtifactIdFromUrl,
  insertArtifactRecordTx,
  replaceSessionArtifactLinksTx,
} from "../../src/modules/artifact/dal.js";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function makeArtifactRef(artifactId: string, publicBaseUrl = "https://gateway.example.test") {
  return ArtifactRef.parse({
    artifact_id: artifactId,
    uri: `artifact://${artifactId}`,
    external_url: `${publicBaseUrl}/a/${artifactId}`,
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

  it("skips session links for file URLs without matching artifacts", async () => {
    db = openTestSqliteDb();
    const storedArtifact = makeArtifactRef("33333333-3333-4333-8333-333333333333");
    const missingArtifactId = "44444444-4444-4444-8444-444444444444";
    const nextMessages: TyrumUIMessage[] = [
      {
        id: "message-1",
        role: "user",
        parts: [
          {
            type: "file",
            url: storedArtifact.external_url,
            mediaType: "text/plain",
            filename: storedArtifact.filename,
          },
          {
            type: "file",
            url: `https://gateway.example.test/a/${missingArtifactId}`,
            mediaType: "text/plain",
            filename: "missing.txt",
          },
        ],
      },
    ];

    await db.transaction(async (tx) => {
      await insertArtifactRecordTx(tx, {
        artifact: storedArtifact,
        tenantId: DEFAULT_TENANT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        agentId: null,
        sensitivity: "normal",
        policySnapshotId: null,
      });
    });

    await db.transaction(async (tx) => {
      await replaceSessionArtifactLinksTx(tx, {
        tenantId: DEFAULT_TENANT_ID,
        sessionId: "session-1",
        previousMessages: [],
        nextMessages,
      });
    });

    const links = await db.all<{
      artifact_id: string;
      parent_kind: string;
      parent_id: string;
    }>(
      `SELECT artifact_id, parent_kind, parent_id
       FROM artifact_links
       ORDER BY parent_kind ASC, parent_id ASC`,
    );

    expect(links).toEqual([
      {
        artifact_id: storedArtifact.artifact_id,
        parent_kind: "chat_message",
        parent_id: "message-1",
      },
      {
        artifact_id: storedArtifact.artifact_id,
        parent_kind: "chat_session",
        parent_id: "session-1",
      },
    ]);
  });

  it("tracks session links for artifact URLs under a public base path prefix", async () => {
    db = openTestSqliteDb();
    const storedArtifact = makeArtifactRef(
      "66666666-6666-4666-8666-666666666666",
      "https://gateway.example.test/gateway",
    );
    const nextMessages: TyrumUIMessage[] = [
      {
        id: "message-prefixed",
        role: "user",
        parts: [
          {
            type: "file",
            url: storedArtifact.external_url,
            mediaType: "text/plain",
            filename: storedArtifact.filename,
          },
        ],
      },
    ];

    await db.transaction(async (tx) => {
      await insertArtifactRecordTx(tx, {
        artifact: storedArtifact,
        tenantId: DEFAULT_TENANT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        agentId: null,
        sensitivity: "normal",
        policySnapshotId: null,
      });
    });

    await db.transaction(async (tx) => {
      await replaceSessionArtifactLinksTx(tx, {
        tenantId: DEFAULT_TENANT_ID,
        sessionId: "session-prefixed",
        previousMessages: [],
        nextMessages,
      });
    });

    const links = await db.all<{
      artifact_id: string;
      parent_kind: string;
      parent_id: string;
    }>(
      `SELECT artifact_id, parent_kind, parent_id
       FROM artifact_links
       ORDER BY parent_kind ASC, parent_id ASC`,
    );

    expect(links).toEqual([
      {
        artifact_id: storedArtifact.artifact_id,
        parent_kind: "chat_message",
        parent_id: "message-prefixed",
      },
      {
        artifact_id: storedArtifact.artifact_id,
        parent_kind: "chat_session",
        parent_id: "session-prefixed",
      },
    ]);
  });
});

describe("extractArtifactIdFromUrl", () => {
  it("extracts artifact ids from canonical artifact URLs", () => {
    const artifactId = "55555555-5555-4555-8555-555555555555";

    expect(extractArtifactIdFromUrl(`artifact://${artifactId}`)).toBe(artifactId);
    expect(extractArtifactIdFromUrl(`https://gateway.example.test/a/${artifactId}`)).toBe(
      artifactId,
    );
  });

  it("extracts artifact ids from canonical artifact URLs under a public base path", () => {
    const artifactId = "77777777-7777-4777-8777-777777777777";

    expect(extractArtifactIdFromUrl(`https://gateway.example.test/gateway/a/${artifactId}`)).toBe(
      artifactId,
    );
  });

  it("rejects relative artifact-like paths", () => {
    expect(extractArtifactIdFromUrl("/a/55555555-5555-4555-8555-555555555555")).toBeUndefined();
  });

  it("rejects non-uuid path segments", () => {
    expect(extractArtifactIdFromUrl("https://gateway.example.test/a/not-a-uuid")).toBeUndefined();
  });
});
