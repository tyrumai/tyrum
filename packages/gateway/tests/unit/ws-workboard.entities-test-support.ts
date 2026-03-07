import { expect, it } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeDeps, makeClient } from "./ws-workboard.test-support.js";

function registerDecisionAndSignalTests(): void {
  it("handles work.decision.create/list/get and broadcasts work.decision.created", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-decision-create",
          type: "work.decision.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            decision: {
              question: "Q1",
              chosen: "A1",
              rationale_md: "Because.",
            },
          },
        }),
        deps,
      );

      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const decision = (
        createRes as unknown as { result: { decision: { decision_id: string; question: string } } }
      ).result.decision;
      expect(decision.question).toBe("Q1");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const createdEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(createdEvt.type).toBe("work.decision.created");
      expect(createdEvt.payload?.decision?.decision_id).toBe(decision.decision_id);
      ws.send.mockClear();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-decision-list",
          type: "work.decision.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
          },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const questions = (
        listRes as unknown as { result: { decisions: Array<{ question: string }> } }
      ).result.decisions.map((d) => d.question);
      expect(questions).toContain("Q1");
      expect(ws.send).not.toHaveBeenCalled();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-decision-get",
          type: "work.decision.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            decision_id: decision.decision_id,
          },
        }),
        deps,
      );
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const got = (getRes as unknown as { result: { decision: { decision_id: string } } }).result
        .decision;
      expect(got.decision_id).toBe(decision.decision_id);
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it("handles work.signal.create/list/get/update and broadcasts work.signal.* events", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const createRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-create",
          type: "work.signal.create",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal: {
              trigger_kind: "event",
              trigger_spec_json: { topic: "t1" },
              payload_json: { hello: true },
            },
          },
        }),
        deps,
      );

      expect((createRes as unknown as { ok: boolean }).ok).toBe(true);
      const signal = (
        createRes as unknown as { result: { signal: { signal_id: string; status: string } } }
      ).result.signal;
      expect(signal.status).toBe("active");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const createdEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(createdEvt.type).toBe("work.signal.created");
      expect(createdEvt.payload?.signal?.signal_id).toBe(signal.signal_id);
      ws.send.mockClear();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-list",
          type: "work.signal.list",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
          },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const ids = (
        listRes as unknown as { result: { signals: Array<{ signal_id: string }> } }
      ).result.signals.map((s) => s.signal_id);
      expect(ids).toContain(signal.signal_id);
      expect(ws.send).not.toHaveBeenCalled();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-get",
          type: "work.signal.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal_id: signal.signal_id,
          },
        }),
        deps,
      );
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const got = (getRes as unknown as { result: { signal: { signal_id: string } } }).result
        .signal;
      expect(got.signal_id).toBe(signal.signal_id);
      expect(ws.send).not.toHaveBeenCalled();

      const updateRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-update",
          type: "work.signal.update",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal_id: signal.signal_id,
            patch: { status: "paused" },
          },
        }),
        deps,
      );
      expect((updateRes as unknown as { ok: boolean }).ok).toBe(true);
      const updatedStatus = (updateRes as unknown as { result: { signal: { status: string } } })
        .result.signal.status;
      expect(updatedStatus).toBe("paused");

      expect(ws.send).toHaveBeenCalledTimes(1);
      const updatedEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(updatedEvt.type).toBe("work.signal.updated");
      expect(updatedEvt.payload?.signal?.signal_id).toBe(signal.signal_id);
      expect(updatedEvt.payload?.signal?.status).toBe("paused");

      ws.send.mockClear();
      const noOpRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-signal-update-noop",
          type: "work.signal.update",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            signal_id: signal.signal_id,
            patch: { status: "paused" },
          },
        }),
        deps,
      );
      expect((noOpRes as unknown as { ok: boolean }).ok).toBe(true);
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
}

function registerStateKvTests(): void {
  it("handles work.state_kv.set/get/list and broadcasts work.state_kv.updated", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const scope = {
        kind: "agent",
        tenant_key: "default",
        agent_key: "default",
        workspace_key: "default",
      };

      const setRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-kv-set",
          type: "work.state_kv.set",
          payload: { scope, key: "k1", value_json: { a: 1 } },
        }),
        deps,
      );
      expect((setRes as unknown as { ok: boolean }).ok).toBe(true);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const updatedEvt = JSON.parse(ws.send.mock.calls[0]?.[0] ?? "{}") as {
        type?: string;
        payload?: any;
      };
      expect(updatedEvt.type).toBe("work.state_kv.updated");
      expect(updatedEvt.payload?.key).toBe("k1");
      expect(updatedEvt.payload?.scope).toMatchObject(scope);
      expect(typeof updatedEvt.payload?.updated_at).toBe("string");
      ws.send.mockClear();

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-kv-get",
          type: "work.state_kv.get",
          payload: { scope, key: "k1" },
        }),
        deps,
      );
      expect((getRes as unknown as { ok: boolean }).ok).toBe(true);
      const entry = (getRes as unknown as { result: { entry: { key: string; value_json: any } } })
        .result.entry;
      expect(entry.key).toBe("k1");
      expect(entry.value_json).toEqual({ a: 1 });
      expect(ws.send).not.toHaveBeenCalled();

      const listRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-kv-list",
          type: "work.state_kv.list",
          payload: { scope, prefix: "k" },
        }),
        deps,
      );
      expect((listRes as unknown as { ok: boolean }).ok).toBe(true);
      const entries = (listRes as unknown as { result: { entries: Array<{ key: string }> } }).result
        .entries;
      expect(entries.map((e) => e.key)).toContain("k1");
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
}

export function registerWorkboardEntityTests(): void {
  registerDecisionAndSignalTests();
  registerStateKvTests();
}
