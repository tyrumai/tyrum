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
function addTestClient(cm: ConnectionManager, ws: MockWebSocket): string {
  seq += 1;
  const connectionId = `conn-${seq}`;
  const instanceId = `dev-test-${seq}`;
  return cm.addClient({
    connectionId,
    ws: ws as never,
    role: "client",
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
    addTestClient(cm, ws);

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
    addTestClient(cm, ws);

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
});

