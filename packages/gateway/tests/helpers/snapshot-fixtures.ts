import type { SqlDb } from "../../src/statestore/types.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

export async function seedSnapshotApprovalScopeFixtures(input: {
  db: SqlDb;
  turnId: string;
  turnItemId: string;
  workflowRunId: string;
  workflowRunStepId: string;
}): Promise<void> {
  await input.db.run(
    `INSERT INTO turn_items (
       tenant_id,
       turn_item_id,
       turn_id,
       item_index,
       item_key,
       kind,
       payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      input.turnItemId,
      input.turnId,
      0,
      "message:snapshot-linked",
      "message",
      JSON.stringify({
        message: {
          id: "message-snapshot-linked",
          role: "assistant",
          parts: [{ type: "text", text: "approval placeholder" }],
        },
      }),
    ],
  );

  await input.db.run(
    `INSERT INTO workflow_runs (
       workflow_run_id,
       tenant_id,
       agent_id,
       workspace_id,
       run_key,
       conversation_key,
       status,
       trigger_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.workflowRunId,
      DEFAULT_TENANT_ID,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "snapshot-linked-run",
      "agent:agent-1:telegram-1:group:thread-1",
      "paused",
      JSON.stringify({ kind: "api", metadata: { source: "snapshot-test" } }),
    ],
  );

  await input.db.run(
    `INSERT INTO workflow_run_steps (
       tenant_id,
       workflow_run_step_id,
       workflow_run_id,
       step_index,
       status,
       action_json
     )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      input.workflowRunStepId,
      input.workflowRunId,
      0,
      "paused",
      JSON.stringify({ type: "CLI", args: { cmd: "echo", args: ["snapshot-linked"] } }),
    ],
  );
}
