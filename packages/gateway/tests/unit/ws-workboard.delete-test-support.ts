import { expect, it } from "vitest";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeClient, makeDeps } from "./ws-workboard.test-support.js";

const DEFAULT_SCOPE = {
  tenant_id: DEFAULT_TENANT_ID,
  agent_id: DEFAULT_AGENT_ID,
  workspace_id: DEFAULT_WORKSPACE_ID,
} as const;

export function registerWorkboardDeleteTests(): void {
  it("handles work.delete and broadcasts work.item.deleted", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Delete me" },
          },
        }),
        deps,
      );
      expect((createRes as { ok: boolean }).ok).toBe(true);
      const workItemId = (createRes as { result: { item: { work_item_id: string } } }).result.item
        .work_item_id;
      ws.send.mockClear();

      const deleteRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-delete",
          type: "work.delete",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: workItemId,
          },
        }),
        deps,
      );

      expect((deleteRes as { ok: boolean }).ok).toBe(true);
      expect((deleteRes as { type: string }).type).toBe("work.delete");
      expect(
        (deleteRes as { result: { item: { work_item_id: string } } }).result.item.work_item_id,
      ).toBe(workItemId);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const deletedEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: { item?: { work_item_id?: string } };
      };
      expect(deletedEvt.type).toBe("work.item.deleted");
      expect(deletedEvt.payload?.item?.work_item_id).toBe(workItemId);

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-list",
          type: "work.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
          },
        }),
        deps,
      );

      expect((listRes as { ok: boolean }).ok).toBe(true);
      expect(
        (listRes as { result: { items: Array<{ work_item_id: string }> } }).result.items,
      ).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ work_item_id: workItemId })]),
      );
    } finally {
      await db.close();
    }
  });

  it("handles work.delete after cleaning up paused workboard state", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const { ws: peerWs } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-create-paused",
          type: "work.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            item: { kind: "action", title: "Delete paused work" },
          },
        }),
        deps,
      );
      expect((createRes as { ok: boolean }).ok).toBe(true);
      const workItemId = (
        createRes as {
          result: { item: { work_item_id: string } };
        }
      ).result.item.work_item_id;

      const workboard = new WorkboardDal(db);
      await workboard.createTask({
        scope: DEFAULT_SCOPE,
        task: {
          work_item_id: workItemId,
          status: "paused",
          execution_profile: "executor",
          side_effect_class: "workspace",
          result_summary: "Waiting for operator",
        },
      });
      const pausedSubagent = await workboard.createSubagent({
        scope: DEFAULT_SCOPE,
        subagent: {
          work_item_id: workItemId,
          execution_profile: "planner",
          session_key: "subagent-delete-paused",
          status: "paused",
        },
      });
      await workboard.createClarification({
        scope: DEFAULT_SCOPE,
        clarification: {
          work_item_id: workItemId,
          question: "Need confirmation",
          requested_for_session_key: "operator-session",
        },
      });
      const child = await workboard.createItem({
        scope: DEFAULT_SCOPE,
        item: {
          kind: "action",
          title: "Child work",
          parent_work_item_id: workItemId,
          created_from_session_key: "operator-session",
        },
      });
      const artifact = await workboard.createArtifact({
        scope: DEFAULT_SCOPE,
        artifact: {
          work_item_id: workItemId,
          kind: "note",
          title: "Artifact",
        },
      });
      const decision = await workboard.createDecision({
        scope: DEFAULT_SCOPE,
        decision: {
          work_item_id: workItemId,
          question: "Proceed?",
          chosen: "yes",
          rationale_md: "Looks good",
        },
      });
      const signal = await workboard.createSignal({
        scope: DEFAULT_SCOPE,
        signal: {
          work_item_id: workItemId,
          trigger_kind: "manual",
          trigger_spec_json: { source: "test" },
        },
      });
      ws.send.mockClear();
      peerWs.send.mockClear();

      const deleteRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-delete-paused",
          type: "work.delete",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            work_item_id: workItemId,
          },
        }),
        deps,
      );

      expect((deleteRes as { ok: boolean }).ok).toBe(true);
      expect(
        (deleteRes as { result: { item: { work_item_id: string } } }).result.item.work_item_id,
      ).toBe(workItemId);
      const operatorEvents = ws.send.mock.calls.map((call) =>
        JSON.parse(call[0] ?? "{}"),
      ) as Array<{
        type?: string;
        payload?: Record<string, unknown>;
      }>;
      const peerEvents = peerWs.send.mock.calls.map((call) =>
        JSON.parse(call[0] ?? "{}"),
      ) as Array<{
        type?: string;
        payload?: Record<string, unknown>;
      }>;
      for (const events of [operatorEvents, peerEvents]) {
        expect(events.map((event) => event.type)).toEqual([
          "work.item.updated",
          "work.signal.updated",
          "work.item.deleted",
        ]);
        expect(events[0]?.payload?.item).toMatchObject({
          work_item_id: child.work_item_id,
        });
        expect(
          (events[0]?.payload?.item as { parent_work_item_id?: string | undefined } | undefined)
            ?.parent_work_item_id,
        ).toBeUndefined();
        expect(events[1]?.payload?.signal).toMatchObject({
          signal_id: signal.signal_id,
          status: "cancelled",
        });
        expect(
          (events[1]?.payload?.signal as { work_item_id?: string | undefined } | undefined)
            ?.work_item_id,
        ).toBeUndefined();
        expect(events[2]?.payload?.item).toMatchObject({
          work_item_id: workItemId,
        });
      }

      expect(
        await workboard.getSubagent({
          scope: DEFAULT_SCOPE,
          subagent_id: pausedSubagent.subagent_id,
        }),
      ).toMatchObject({
        work_item_id: undefined,
        work_item_task_id: undefined,
      });
      expect(
        await workboard.listClarifications({
          scope: DEFAULT_SCOPE,
          work_item_id: workItemId,
          statuses: ["open"],
        }),
      ).toEqual({ clarifications: [], next_cursor: undefined });
      expect(
        await workboard.getItem({ scope: DEFAULT_SCOPE, work_item_id: child.work_item_id }),
      ).toMatchObject({
        work_item_id: child.work_item_id,
        parent_work_item_id: undefined,
      });
      expect(
        await workboard.getArtifact({ scope: DEFAULT_SCOPE, artifact_id: artifact.artifact_id }),
      ).toMatchObject({
        artifact_id: artifact.artifact_id,
        work_item_id: undefined,
      });
      expect(
        await workboard.getDecision({ scope: DEFAULT_SCOPE, decision_id: decision.decision_id }),
      ).toMatchObject({
        decision_id: decision.decision_id,
        work_item_id: undefined,
      });
      expect(
        await workboard.getSignal({ scope: DEFAULT_SCOPE, signal_id: signal.signal_id }),
      ).toMatchObject({
        signal_id: signal.signal_id,
        status: "cancelled",
        work_item_id: undefined,
      });
    } finally {
      await db.close();
    }
  });
}
