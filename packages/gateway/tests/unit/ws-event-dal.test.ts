import { describe, expect, it } from "vitest";
import { WsEventDal } from "../../src/modules/ws-event/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";
import type { SqlDb } from "../../src/statestore/types.js";

const TEST_TENANT_ID = DEFAULT_TENANT_ID;
const EVENT_KEY = "approval.resolved:approval-1:approved";
const EVENT_AUDIENCE = {
  roles: ["client"],
  required_scopes: ["operator.admin"],
} as const;

const DB_CASES: Array<{
  name: string;
  open: () => Promise<{ db: SqlDb; close: () => Promise<void> }>;
}> = [
  {
    name: "sqlite",
    open: async () => {
      const db = openTestSqliteDb();
      return {
        db,
        close: async () => {
          await db.close();
        },
      };
    },
  },
  {
    name: "postgres",
    open: openTestPostgresDb,
  },
];

for (const testCase of DB_CASES) {
  describe(`WsEventDal (${testCase.name})`, () => {
    it("returns the first persisted event for duplicate event keys", async () => {
      const opened = await testCase.open();
      try {
        const dal = new WsEventDal(opened.db);

        const first = await dal.ensureEvent({
          tenantId: TEST_TENANT_ID,
          eventKey: EVENT_KEY,
          type: "approval.resolved",
          occurredAt: "2026-03-06T12:00:00.000Z",
          payload: { approval_id: "approval-1", status: "approved" },
          audience: EVENT_AUDIENCE,
        });
        const second = await dal.ensureEvent({
          tenantId: TEST_TENANT_ID,
          eventKey: EVENT_KEY,
          type: "approval.resolved",
          occurredAt: "2026-03-06T12:05:00.000Z",
          payload: { approval_id: "approval-1", status: "approved", duplicate: true },
          audience: { roles: ["node"] },
        });

        expect(second).toEqual(first);
        expect(second.event.event_id).toBe(first.event.event_id);
        expect(second.event.occurred_at).toBe("2026-03-06T12:00:00.000Z");
        expect(second.event.payload).toEqual({ approval_id: "approval-1", status: "approved" });
        expect(second.audience).toEqual(EVENT_AUDIENCE);
      } finally {
        await opened.close();
      }
    });
  });
}
