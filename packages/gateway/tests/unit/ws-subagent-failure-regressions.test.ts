import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

function makeDeps(cm: ConnectionManager, overrides?: Partial<ProtocolDeps>): ProtocolDeps {
  return { connectionManager: cm, ...overrides };
}

function makeClient(cm: ConnectionManager): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const id = cm.addClient(
    ws as never,
    [] as never,
    {
      authClaims: {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
      role: "client",
    } as never,
  );
  return { id, ws };
}

describe("subagent WS failure regressions", () => {
  it("marks subagent failed when resuming it to running fails before runtime.turn", async () => {
    const cm = new ConnectionManager();
    const { id, ws } = makeClient(cm);
    const client = cm.getClient(id)!;

    const runtimeTurn = vi.fn(async (input: { message: string }) => {
      return { session_id: "s-1", reply: `echo:${input.message}` };
    });
    const agents = {
      getRuntime: vi.fn(async () => ({ turn: runtimeTurn })),
    };

    const db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    try {
      const deps = makeDeps(cm, { db, agents: agents as never });

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
      const spawnedSubagent = (spawnRes as any).result.subagent as {
        subagent_id: string;
        agent_id: string;
        workspace_id: string;
      };
      const subagentId = spawnedSubagent.subagent_id;

      await workboard.updateSubagent({
        scope: {
          tenant_id: DEFAULT_TENANT_ID,
          agent_id: spawnedSubagent.agent_id,
          workspace_id: spawnedSubagent.workspace_id,
        },
        subagent_id: subagentId,
        patch: { status: "paused" },
      });

      const originalUpdateSubagent = WorkboardDal.prototype.updateSubagent;
      const updateSpy = vi
        .spyOn(WorkboardDal.prototype, "updateSubagent")
        .mockImplementation(async function (params) {
          if (params.subagent_id === subagentId && params.patch.status === "running") {
            throw new Error("resume failed");
          }
          return await originalUpdateSubagent.call(this, params);
        });

      ws.send.mockClear();

      try {
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

        expect(runtimeTurn).not.toHaveBeenCalled();

        const payloads = ws.send.mock.calls.map((call) => JSON.parse(call[0] ?? "{}"));
        const updated = payloads.find((payload) => payload.type === "subagent.updated");
        expect(updated).toBeDefined();
        expect(updated.payload?.subagent?.subagent_id).toBe(subagentId);
        expect(updated.payload?.subagent?.status).toBe("failed");

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
        updateSpy.mockRestore();
      }
    } finally {
      await db.close();
    }
  });
});
