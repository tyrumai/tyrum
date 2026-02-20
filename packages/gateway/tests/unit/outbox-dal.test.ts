import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("OutboxDal", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function setup(): OutboxDal {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);
    return new OutboxDal(db);
  }

  it("delivers broadcast rows to all consumers and directed rows only to target", () => {
    const outbox = setup();
    outbox.enqueue("ws.broadcast", { hello: "world" });
    outbox.enqueue("ws.direct", { connection_id: "c1", message: { x: 1 } }, { targetEdgeId: "edge-a" });
    outbox.enqueue("ws.direct", { connection_id: "c2", message: { y: 2 } }, { targetEdgeId: "edge-b" });

    const a = outbox.poll("edge-a", 100);
    const b = outbox.poll("edge-b", 100);

    expect(a.map((r) => r.topic)).toEqual(["ws.broadcast", "ws.direct"]);
    expect(b.map((r) => r.topic)).toEqual(["ws.broadcast", "ws.direct"]);

    expect((a[1]!.payload as { connection_id: string }).connection_id).toBe("c1");
    expect((b[1]!.payload as { connection_id: string }).connection_id).toBe("c2");

    outbox.ackConsumerCursor("edge-a", a[a.length - 1]!.id);
    expect(outbox.poll("edge-a", 100)).toHaveLength(0);
  });
});

