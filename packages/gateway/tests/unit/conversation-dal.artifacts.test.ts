import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactRef } from "@tyrum/contracts";

const replaceConversationArtifactLinksTxMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("link failure");
  }),
);

vi.mock("../../src/modules/artifact/dal.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/artifact/dal.js")>();
  return {
    ...actual,
    replaceConversationArtifactLinksTx: replaceConversationArtifactLinksTxMock,
  };
});

import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import { createTextMessage } from "../../src/modules/agent/conversation-dal-message-helpers.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ConversationDal artifact records", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    replaceConversationArtifactLinksTxMock.mockReset();
    replaceConversationArtifactLinksTxMock.mockImplementation(async () => {
      throw new Error("link failure");
    });
    await db?.close();
    db = undefined;
  });

  it("rolls back artifact record inserts when replaceMessages fails", async () => {
    db = openTestSqliteDb();
    const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
    const dal = new ConversationDal(db, identityScopeDal, new ChannelThreadDal(db));
    const conversation = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });

    const artifact = ArtifactRef.parse({
      artifact_id: "11111111-1111-4111-8111-111111111111",
      uri: "artifact://11111111-1111-4111-8111-111111111111",
      external_url: "https://gateway.example.test/a/11111111-1111-4111-8111-111111111111",
      kind: "file",
      media_class: "other",
      created_at: "2026-03-19T09:00:00.000Z",
      filename: "hello.txt",
      mime_type: "text/plain",
      size_bytes: 5,
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      labels: [],
      metadata: { source: "test" },
    });

    await expect(
      dal.replaceMessages({
        tenantId: conversation.tenant_id,
        conversationId: conversation.conversation_id,
        messages: [createTextMessage({ id: "m1", role: "user", text: "hello" })],
        artifactRecords: [
          {
            artifact,
            tenantId: conversation.tenant_id,
            workspaceId: conversation.workspace_id,
            agentId: conversation.agent_id,
            sensitivity: "normal",
            policySnapshotId: null,
          },
        ],
        updatedAt: "2026-03-19T09:00:00.000Z",
      }),
    ).rejects.toThrow("link failure");

    const artifactRows = await db.all<{ artifact_id: string }>(
      "SELECT artifact_id FROM artifacts WHERE tenant_id = ?",
      [conversation.tenant_id],
    );
    expect(artifactRows).toEqual([]);

    const updatedConversation = await dal.getById({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
    });
    expect(updatedConversation?.messages).toEqual([]);
  });
});
