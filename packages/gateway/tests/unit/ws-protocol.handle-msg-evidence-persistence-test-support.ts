import { expect, it, vi } from "vitest";
import { DispatchRecordDal } from "../../src/modules/node/dispatch-record-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { createSpyLogger, makeDeps, makeClient } from "./ws-protocol.test-support.js";

async function seedEvidenceDispatch(
  db: ReturnType<typeof openTestSqliteDb>,
  connectionId: string,
): Promise<void> {
  await db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_key,
       status,
       trigger_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      "job-1",
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "agent:default:main",
      "running",
      "{}",
    ],
  );
  await db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      "550e8400-e29b-41d4-a716-446655440000",
      "job-1",
      "agent:default:main",
      "running",
      1,
    ],
  );
  await db.run(
    `INSERT INTO dispatch_records (
       tenant_id,
       dispatch_id,
       turn_id,
       selected_node_id,
       capability,
       action_json,
       task_id,
       status,
       connection_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      "550e8400-e29b-41d4-a716-446655440000",
      "dev_test",
      "tyrum.desktop.screenshot",
      JSON.stringify({ type: "Desktop", args: { op: "screenshot" } }),
      "task-1",
      "dispatched",
      connectionId,
    ],
  );
}

export function registerHandleMessageEvidencePersistenceTests(): void {
  it("logs attempt.evidence dispatch record persistence failures but still acknowledges and broadcasts", async () => {
    const db = openTestSqliteDb();
    const updateEvidenceSpy = vi
      .spyOn(DispatchRecordDal.prototype, "updateEvidence")
      .mockRejectedValue(new Error("persist failed"));

    try {
      const cm = new ConnectionManager();
      const { id: nodeConnId } = makeClient(cm, ["desktop"], {
        role: "node",
        deviceId: "dev_test",
        protocolRev: 2,
      });
      const { ws: operatorWs } = makeClient(cm, ["desktop"], { protocolRev: 2 });
      const node = cm.getClient(nodeConnId)!;
      const logger = createSpyLogger();

      await seedEvidenceDispatch(db, nodeConnId);

      const deps = makeDeps(cm, {
        db,
        logger,
        nodePairingDal: {
          getByNodeId: async () => ({ status: "approved" }) as never,
        } as never,
      });

      const result = await handleClientMessage(
        node,
        JSON.stringify({
          request_id: "r-attempt-evidence-persist-fail-1",
          type: "attempt.evidence",
          payload: {
            turn_id: "550e8400-e29b-41d4-a716-446655440000",
            dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
            evidence: { http: { status: 200 } },
          },
        }),
        deps,
      );

      expect(updateEvidenceSpy).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect((result as { ok: boolean }).ok).toBe(true);
      expect((result as { type: string }).type).toBe("attempt.evidence");
      expect(logger.warn).toHaveBeenCalledWith(
        "ws.attempt_evidence.dispatch_record_update_failed",
        expect.objectContaining({
          request_id: "r-attempt-evidence-persist-fail-1",
          request_type: "attempt.evidence",
          tenant_id: DEFAULT_TENANT_ID,
          client_id: node.id,
          node_id: "dev_test",
          dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          error: "persist failed",
        }),
      );

      const frames = operatorWs.send.mock.calls.map((call) =>
        JSON.parse(call[0] as string),
      ) as Array<Record<string, unknown>>;
      expect(
        frames.some(
          (msg) =>
            msg["type"] === "attempt.evidence" &&
            (msg["payload"] as { node_id?: string } | undefined)?.node_id === "dev_test",
        ),
      ).toBe(true);
    } finally {
      updateEvidenceSpy.mockRestore();
      await db.close();
    }
  });
}
