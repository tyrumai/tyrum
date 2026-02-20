import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { EventLog } from "../../src/modules/planner/event-log.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("Central redaction at persistence boundaries", () => {
  it("redacts registered secrets in planner_events.action before persistence", () => {
    const db = createDatabase(":memory:");
    try {
      migrate(db, migrationsDir);

      const redaction = new RedactionEngine();
      redaction.registerSecrets(["secret-AAA"]);

      const log = new EventLog(db, redaction);
      log.append({
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

      const row = db
        .prepare("SELECT action FROM planner_events WHERE plan_id = ? AND step_index = ?")
        .get("p1", 0) as { action: string };
      expect(row.action).toContain("[REDACTED]");
      expect(row.action).not.toContain("secret-AAA");
    } finally {
      db.close();
    }
  });

  it("redacts registered secrets in outbox.payload_json before persistence", () => {
    const db = createDatabase(":memory:");
    try {
      migrate(db, migrationsDir);

      const redaction = new RedactionEngine();
      redaction.registerSecrets(["secret-BBB"]);

      const outbox = new OutboxDal(db, redaction);
      const row = outbox.enqueue("ws.broadcast", {
        message: "hello secret-BBB world",
      });

      expect(JSON.stringify(row.payload)).toContain("[REDACTED]");
      expect(JSON.stringify(row.payload)).not.toContain("secret-BBB");
    } finally {
      db.close();
    }
  });
});

