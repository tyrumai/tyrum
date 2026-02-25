import { afterEach, describe, expect, it } from "vitest";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("OutboxDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function setup(): OutboxDal {
    db = openTestSqliteDb();
    return new OutboxDal(db);
  }

  it("delivers broadcast rows to all consumers and directed rows only to target", async () => {
    const outbox = setup();
    await outbox.enqueue("ws.broadcast", { hello: "world" });
    await outbox.enqueue(
      "ws.direct",
      { connection_id: "c1", message: { x: 1 } },
      { targetEdgeId: "edge-a" },
    );
    await outbox.enqueue(
      "ws.direct",
      { connection_id: "c2", message: { y: 2 } },
      { targetEdgeId: "edge-b" },
    );

    const a = await outbox.poll("edge-a", 100);
    const b = await outbox.poll("edge-b", 100);

    expect(a.map((r) => r.topic)).toEqual(["ws.broadcast", "ws.direct"]);
    expect(b.map((r) => r.topic)).toEqual(["ws.broadcast", "ws.direct"]);

    expect((a[1]!.payload as { connection_id: string }).connection_id).toBe("c1");
    expect((b[1]!.payload as { connection_id: string }).connection_id).toBe("c2");

    await outbox.ackConsumerCursor("edge-a", a[a.length - 1]!.id);
    expect(await outbox.poll("edge-a", 100)).toHaveLength(0);
  });
});
