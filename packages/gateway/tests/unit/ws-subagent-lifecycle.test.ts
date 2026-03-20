import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeClient, makeDeps } from "./ws-subagent.test-support.js";

describe("handleClientMessage (subagent lifecycle)", () => {
  it("handles subagent.send and emits subagent.output", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const runtimeTurn = vi.fn(async (input: any) => ({
      session_id: "s-1",
      reply: `echo:${
        input.parts
          ?.filter((part: { type?: string; text?: string }) => part.type === "text")
          .map((part: { text?: string }) => part.text ?? "")
          .join("\n\n") ?? ""
      }`,
    }));
    const agents = {
      getRuntime: vi.fn(async () => ({ turn: runtimeTurn })),
    };

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db, agents: agents as any });
      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      ws.send.mockClear();

      const sendRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.send",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            subagent_id: subagentId,
            content: "hello",
          },
        }),
        deps,
      );

      expect((sendRes as any).ok).toBe(true);
      expect((sendRes as any).type).toBe("subagent.send");
      expect((sendRes as any).result.accepted).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtimeTurn).toHaveBeenCalledTimes(1);
      const turnInput = runtimeTurn.mock.calls[0]?.[0] ?? {};
      expect(turnInput.metadata).toMatchObject({
        tyrum_key: `agent:default:subagent:${subagentId}`,
        lane: "subagent",
      });
      expect(turnInput.parts).toEqual([{ type: "text", text: "hello" }]);

      expect(ws.send).toHaveBeenCalled();
      const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
      const output = payloads.find((p) => p.type === "subagent.output");
      expect(output).toBeDefined();
      expect(output.payload?.subagent_id).toBe(subagentId);
      expect(output.payload?.kind).toBe("final");
      expect(output.payload?.content).toBe("echo:hello");
    } finally {
      await db.close();
    }
  });

  it("marks subagent failed and emits subagent.updated when runtime.turn throws", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const runtimeTurn = vi.fn(async () => {
      throw new Error("boom");
    });
    const agents = {
      getRuntime: vi.fn(async () => ({ turn: runtimeTurn })),
    };

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db, agents: agents as any });
      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      ws.send.mockClear();

      const sendRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.send",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            subagent_id: subagentId,
            content: "hello",
          },
        }),
        deps,
      );

      expect((sendRes as any).ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runtimeTurn).toHaveBeenCalledTimes(1);

      const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
      const updated = payloads.find((p) => p.type === "subagent.updated");
      expect(updated?.payload?.subagent?.subagent_id).toBe(subagentId);
      expect(updated?.payload?.subagent?.status).toBe("failed");

      const getRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-3",
          type: "subagent.get",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            subagent_id: subagentId,
          },
        }),
        deps,
      );
      expect((getRes as any).ok).toBe(true);
      expect((getRes as any).result.subagent.status).toBe("failed");
    } finally {
      await db.close();
    }
  });

  it("does not emit subagent.closed when closing a failed subagent", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const runtimeTurn = vi.fn(async () => {
      throw new Error("boom");
    });
    const agents = {
      getRuntime: vi.fn(async () => ({ turn: runtimeTurn })),
    };

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db, agents: agents as any });
      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.send",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            subagent_id: subagentId,
            content: "hello",
          },
        }),
        deps,
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      ws.send.mockClear();

      const closeRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-4",
          type: "subagent.close",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            subagent_id: subagentId,
            reason: "done",
          },
        }),
        deps,
      );

      expect((closeRes as any).ok).toBe(true);
      expect((closeRes as any).result.subagent.status).toBe("failed");
      const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
      expect(payloads.find((p) => p.type === "subagent.closed")).toBeUndefined();
    } finally {
      await db.close();
    }
  });

  it("handles subagent.close and broadcasts subagent.closed", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });
      const spawnRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "subagent.spawn",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            execution_profile: "executor",
          },
        }),
        deps,
      );
      const subagentId = (spawnRes as any).result.subagent.subagent_id as string;

      ws.send.mockClear();

      const closeRes = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-2",
          type: "subagent.close",
          payload: {
            tenant_key: "default",
            agent_key: "default",
            workspace_key: "default",
            subagent_id: subagentId,
            reason: "done",
          },
        }),
        deps,
      );

      expect((closeRes as any).ok).toBe(true);
      expect((closeRes as any).result.subagent.status).toBe("closed");

      const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
      const updated = payloads.find((p) => p.type === "subagent.updated");
      expect(updated?.payload?.subagent?.subagent_id).toBe(subagentId);
      expect(updated?.payload?.subagent?.status).toBe("closing");
      const closed = payloads.find((p) => p.type === "subagent.closed");
      expect(closed?.payload?.subagent?.subagent_id).toBe(subagentId);
      expect(closed?.payload?.subagent?.status).toBe("closed");
    } finally {
      await db.close();
    }
  });
});
