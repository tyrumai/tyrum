import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { OutboxPoller } from "../../src/modules/backplane/outbox-poller.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(opts?: { throwsOnSend?: boolean }): MockWebSocket {
  return {
    send: opts?.throwsOnSend ? vi.fn(() => {
      throw new Error("ws send failed");
    }) : vi.fn(),
    close: vi.fn(),
    readyState: 1,
  };
}

let seq = 0;
function addTestPeer(
  cm: ConnectionManager,
  ws: MockWebSocket,
  opts?: { role?: "client" | "node"; instanceId?: string },
): string {
  seq += 1;
  const connectionId = `conn-${seq}`;
  const instanceId = opts?.instanceId ?? `dev-test-${seq}`;
  return cm.addClient({
    connectionId,
    ws: ws as never,
    role: opts?.role ?? "client",
    instanceId,
    device: { device_id: instanceId, pubkey: "pubkey" },
    capabilities: [],
  });
}

describe("OutboxPoller", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function setup(
    consumerId = "edge-a",
    opts?: { connectionManager?: ConnectionManager },
  ): {
    outbox: OutboxDal;
    poller: OutboxPoller;
    consumerId: string;
  } {
    db = openTestSqliteDb();
    const outbox = new OutboxDal(db);
    const connectionManager = opts?.connectionManager ?? new ConnectionManager();
    const poller = new OutboxPoller({
      consumerId,
      outboxDal: outbox,
      connectionManager,
      pollIntervalMs: 0,
      batchSize: 100,
    });
    return { outbox, poller, consumerId };
  }

  it("acks after processing a broadcast row", async () => {
    const { outbox, poller, consumerId } = setup();
    const cm = (poller as unknown as { connectionManager: ConnectionManager }).connectionManager;
    const ws = createMockWs();
    addTestPeer(cm, ws);

    const row = await outbox.enqueue("ws.broadcast", {
      event_id: "evt-1",
      type: "plan.update",
      occurred_at: "2026-02-21T12:00:00Z",
      payload: { plan_id: "p1", status: "running" },
    });

    await poller.tick();

    expect(ws.send).toHaveBeenCalledOnce();
    expect(await outbox.getConsumerCursor(consumerId)).toBe(row.id);
  });

  it("does not advance the cursor when delivery throws", async () => {
    const connectionManager = {
      allClients: () => {
        throw new Error("boom");
      },
      getClient: () => undefined,
    } as unknown as ConnectionManager;

    const { outbox, poller, consumerId } = setup("edge-a", { connectionManager });
    await outbox.enqueue("ws.broadcast", { event_id: "evt-1", type: "x", occurred_at: "t", payload: {} });

    await poller.tick();

    expect(await outbox.getConsumerCursor(consumerId)).toBe(0);
    expect(await outbox.poll(consumerId, 100)).toHaveLength(1);
  });

  it("acks invalid payload rows so a single bad row does not wedge the consumer", async () => {
    const { outbox, poller, consumerId } = setup();
    const row = await outbox.enqueue("ws.broadcast", "not-an-object");

    await poller.tick();

    expect(await outbox.getConsumerCursor(consumerId)).toBe(row.id);
  });

  it("acks rows even when ws.send throws", async () => {
    const { outbox, poller, consumerId } = setup();
    const cm = (poller as unknown as { connectionManager: ConnectionManager }).connectionManager;
    const ws = createMockWs({ throwsOnSend: true });
    addTestPeer(cm, ws);

    const row = await outbox.enqueue("ws.broadcast", {
      event_id: "evt-1",
      type: "plan.update",
      occurred_at: "2026-02-21T12:00:00Z",
      payload: { plan_id: "p1", status: "running" },
    });

    await poller.tick();

    expect(ws.send).toHaveBeenCalledOnce();
    expect(await outbox.getConsumerCursor(consumerId)).toBe(row.id);
  });

  it("acks after processing a close row and closes matching peers", async () => {
    const { outbox, poller, consumerId } = setup();
    const cm = (poller as unknown as { connectionManager: ConnectionManager }).connectionManager;
    const ws = createMockWs();
    const instanceId = "node-1";
    addTestPeer(cm, ws, { role: "node", instanceId });

    const row = await outbox.enqueue("ws.close", {
      target_role: "node",
      instance_id: instanceId,
      code: 1012,
      reason: "pairing resolved; reconnect",
    });

    await poller.tick();

    expect(ws.close).toHaveBeenCalledWith(1012, "pairing resolved; reconnect");
    expect(await outbox.getConsumerCursor(consumerId)).toBe(row.id);
  });

  it("acks close rows but skips local delivery when skip_local is set", async () => {
    const { outbox, poller, consumerId } = setup("edge-a");
    const cm = (poller as unknown as { connectionManager: ConnectionManager }).connectionManager;
    const ws = createMockWs();
    const instanceId = "node-2";
    addTestPeer(cm, ws, { role: "node", instanceId });

    const row = await outbox.enqueue("ws.close", {
      source_edge_id: consumerId,
      skip_local: true,
      target_role: "node",
      instance_id: instanceId,
      code: 1012,
      reason: "pairing resolved; reconnect",
    });

    await poller.tick();

    expect(ws.close).not.toHaveBeenCalled();
    expect(await outbox.getConsumerCursor(consumerId)).toBe(row.id);
  });
});
