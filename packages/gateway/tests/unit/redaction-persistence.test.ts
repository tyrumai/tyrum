import { describe, expect, it } from "vitest";
import { EventLog } from "../../src/modules/planner/event-log.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("Central redaction at persistence boundaries", () => {
  it("redacts registered secrets in planner_events.action before persistence", async () => {
    const db: SqliteDb = openTestSqliteDb();
    try {
      const redaction = new RedactionEngine();
      redaction.registerSecrets(["secret-AAA"]);

      const log = new EventLog(db, redaction);
      await log.append({
        replayId: "r1",
        planId: "p1",
        stepIndex: 0,
        occurredAt: new Date().toISOString(),
        action: {
          type: "tool_result",
          output: "token=secret-AAA",
          nested: { value: "secret-AAA" },
        },
      });

      const row = await db.get<{ action: string }>(
        "SELECT action FROM planner_events WHERE plan_id = ? AND step_index = ?",
        ["p1", 0],
      );
      expect(row?.action).toContain("[REDACTED]");
      expect(row?.action).not.toContain("secret-AAA");
    } finally {
      await db.close();
    }
  });

  it("redacts registered secrets in outbox.payload_json before persistence", async () => {
    const db: SqliteDb = openTestSqliteDb();
    try {
      const redaction = new RedactionEngine();
      redaction.registerSecrets(["secret-BBB"]);

      const outbox = new OutboxDal(db, redaction);
      const row = await outbox.enqueue("ws.broadcast", {
        message: "hello secret-BBB world",
      });

      expect(JSON.stringify(row.payload)).toContain("[REDACTED]");
      expect(JSON.stringify(row.payload)).not.toContain("secret-BBB");
    } finally {
      await db.close();
    }
  });
});

