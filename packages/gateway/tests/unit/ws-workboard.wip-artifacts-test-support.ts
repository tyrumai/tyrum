import { expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { makeDeps, makeClient, markWorkItemDispatchReady } from "./ws-workboard.test-support.js";

function registerCompletionNotificationTests(): void {
  it("enqueues a channel completion notification when last_active_session_key is a channel session", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const inbox = new ChannelInboxDal(db);
      const channelKey = "agent:default:telegram:default:dm:chat-1";

      await inbox.enqueue({
        source: "telegram:default",
        thread_id: "chat-1",
        message_id: "msg-1",
        key: channelKey,
        lane: "main",
        received_at_ms: 1_000,
        payload: { kind: "test" },
      });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Item 1" },
          },
        }),
        deps,
      );
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const createdId = (createRes as unknown as { result: { item: { work_item_id: string } } })
        .result.item.work_item_id;
      await markWorkItemDispatchReady(db, createdId);

      await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-ready",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "ready",
            reason: "triage",
          },
        }),
        deps,
      );

      await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-doing",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "doing",
            reason: "start",
          },
        }),
        deps,
      );

      const doneRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-done",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: createdId,
            status: "done",
            reason: "complete",
          },
        }),
        deps,
      );
      expect((doneRes as unknown as { ok: boolean }).ok).toBe(true);

      const outboxCount = await db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM channel_outbox",
      );
      expect(outboxCount?.count).toBe(1);
    } finally {
      await db.close();
    }
  });
}

function registerWipAndArtifactTests(): void {
  it("rejects operator transition requests above item-level WIP cap", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const created = await Promise.all(
        ["Item 1", "Item 2", "Item 3"].map(async (title, idx) => {
          const res = await handleClientMessage(
            client,
            JSON.stringify({
              request_id: `r-create-${idx}`,
              type: "work.create",
              payload: {
                tenant_key: "default",
                agent_key: "default",
                workspace_key: "default",
                item: { kind: "action", title },
              },
            }),
            deps,
          );
          expect((res as unknown as { ok: boolean }).ok).toBe(true);
          const workItemId = (res as unknown as { result: { item: { work_item_id: string } } })
            .result.item.work_item_id;
          await markWorkItemDispatchReady(db, workItemId);
          return workItemId;
        }),
      );

      for (const [idx, idItem] of created.entries()) {
        const readyRes = await handleClientMessage(
          client,
          JSON.stringify({
            request_id: `r-ready-${idx}`,
            type: "work.transition",
            payload: {
              tenant_key: "default",
              agent_key: "default",
              workspace_key: "default",
              work_item_id: idItem,
              status: "ready",
            },
          }),
          deps,
        );
        expect((readyRes as unknown as { ok: boolean }).ok).toBe(true);
      }

      ws.send.mockClear();
      const transitionRes0 = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-transition-0",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: created[0]!,
            status: "doing",
            reason: "claim",
          },
        }),
        deps,
      );
      const transitionRes1 = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-transition-1",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: created[1]!,
            status: "doing",
            reason: "claim",
          },
        }),
        deps,
      );
      const transitionRes2 = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-transition-2",
          type: "work.transition",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: created[2]!,
            status: "doing",
            reason: "claim",
          },
        }),
        deps,
      );

      expect((transitionRes0 as { ok: boolean }).ok).toBe(true);
      expect((transitionRes1 as { ok: boolean }).ok).toBe(true);
      expect((transitionRes2 as { ok: boolean }).ok).toBe(false);
      expect((transitionRes2 as { error: { code: string } }).error).toMatchObject({
        code: "wip_limit_exceeded",
      });
      expect(ws.send).toHaveBeenCalledTimes(2);
    } finally {
      await db.close();
    }
  });

  it("handles work.artifact.create/list/get and broadcasts work.artifact.created", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-artifact-create",
          type: "work.artifact.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            artifact: { kind: "hypothesis", title: "A1", body_md: "Hello" },
          },
        }),
        deps,
      );

      expect(createRes).toBeDefined();
      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const artifact = (
        createRes as unknown as { result: { artifact: { artifact_id: string; title: string } } }
      ).result.artifact;
      expect(artifact.title).toBe("A1");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const createdEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(createdEvt.type).toBe("work.artifact.created");
      expect(createdEvt.payload?.artifact?.artifact_id).toBe(artifact.artifact_id);
      ws.send.mockClear();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-artifact-list",
          type: "work.artifact.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
          },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const titles = (
        listRes as unknown as { result: { artifacts: Array<{ title: string }> } }
      ).result.artifacts.map((a) => a.title);
      expect(titles).toContain("A1");
      expect(ws.send).not.toHaveBeenCalled();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-artifact-get",
          type: "work.artifact.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            artifact_id: artifact.artifact_id,
          },
        }),
        deps,
      );
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const got = (getRes as unknown as { result: { artifact: { artifact_id: string } } }).result
        .artifact;
      expect(got.artifact_id).toBe(artifact.artifact_id);
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
}

export function registerWorkboardWipArtifactTests(): void {
  registerCompletionNotificationTests();
  registerWipAndArtifactTests();
}
