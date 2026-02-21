import { describe, expect, it, afterEach } from "vitest";
import { EventPublisher, GATEWAY_EVENT_TOPIC } from "../../src/modules/backplane/event-publisher.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("EventPublisher integration", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    if (db) {
      await db.close();
      db = undefined;
    }
  });

  it("round-trips events through outbox", async () => {
    db = openTestSqliteDb();
    const outboxDal = new OutboxDal(db);
    const publisher = new EventPublisher(outboxDal);

    // Publish two events
    const id1 = await publisher.publish("run.started", { run_id: "r1" });
    const id2 = await publisher.publish("step.completed", { step_id: "s1" });

    // Poll them back
    await outboxDal.ensureConsumer("test-consumer");
    const rows = await outboxDal.poll("test-consumer", 10);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.topic).toBe(GATEWAY_EVENT_TOPIC);

    const msg1 = rows[0]!.payload as Record<string, unknown>;
    expect(msg1.event_id).toBe(id1);
    expect(msg1.kind).toBe("run.started");

    const msg2 = rows[1]!.payload as Record<string, unknown>;
    expect(msg2.event_id).toBe(id2);
    expect(msg2.kind).toBe("step.completed");
  });
});
