import { describe, expect, it } from "vitest";
import { EventLog } from "../../src/modules/planner/event-log.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("Central redaction at persistence boundaries", () => {
  it("redacts registered secrets in planner_events.action before persistence", async () => {
    const db: SqliteDb = openTestSqliteDb();
    try {
      const redaction = new RedactionEngine();
      redaction.registerSecrets(["secret-AAA"]);

      const log = new EventLog(db, redaction);
      const outcome = await log.append({
        tenantId: DEFAULT_TENANT_ID,
        replayId: "r1",
        planKey: "p1",
        stepIndex: 0,
        occurredAt: new Date().toISOString(),
        action: {
          type: "tool_result",
          output: "token=secret-AAA",
          nested: { value: "secret-AAA" },
        },
      });
      expect(outcome.kind).toBe("inserted");
      if (outcome.kind !== "inserted") {
        throw new Error("expected planner event insert");
      }

      const row = await db.get<{ action_json: string }>(
        "SELECT action_json FROM planner_events WHERE tenant_id = ? AND plan_id = ? AND step_index = ?",
        [DEFAULT_TENANT_ID, outcome.event.planId, 0],
      );
      expect(row?.action_json).toContain("[REDACTED]");
      expect(row?.action_json).not.toContain("secret-AAA");
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
