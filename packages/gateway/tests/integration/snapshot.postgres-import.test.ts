import { describe, expect, it } from "vitest";
import { createSnapshotRoutes } from "../../src/routes/snapshot.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";

describe("snapshot routes postgres import", () => {
  it("imports json-null conversation state into postgres targets", async () => {
    const targetOpened = await openTestPostgresDb();
    const channelAccountId = "00000000-0000-4000-8000-000000000111";
    const channelThreadId = "00000000-0000-4000-8000-000000000112";
    const conversationId = "00000000-0000-4000-8000-000000000113";
    const bundle = {
      format: "tyrum.snapshot.v2",
      exported_at: "2026-03-28T11:00:00.000Z",
      gateway_version: "test-version",
      db_kind: "postgres",
      artifacts: {
        bytes: { included: false, included_sensitivity: [] },
        retention: {
          artifacts: {
            included: false,
            has_retention_expires_at: false,
            has_bytes_deleted_at: false,
            has_bytes_deleted_reason: false,
          },
        },
      },
      tables: {
        channel_accounts: {
          columns: [
            "tenant_id",
            "workspace_id",
            "channel_account_id",
            "connector_key",
            "account_key",
          ],
          rows: [
            {
              tenant_id: DEFAULT_TENANT_ID,
              workspace_id: DEFAULT_WORKSPACE_ID,
              channel_account_id: channelAccountId,
              connector_key: "telegram",
              account_key: "account-postgres-import",
            },
          ],
        },
        channel_threads: {
          columns: [
            "tenant_id",
            "workspace_id",
            "channel_thread_id",
            "channel_account_id",
            "provider_thread_id",
            "container_kind",
          ],
          rows: [
            {
              tenant_id: DEFAULT_TENANT_ID,
              workspace_id: DEFAULT_WORKSPACE_ID,
              channel_thread_id: channelThreadId,
              channel_account_id: channelAccountId,
              provider_thread_id: "thread-postgres-import",
              container_kind: "dm",
            },
          ],
        },
        conversations: {
          columns: [
            "tenant_id",
            "conversation_id",
            "conversation_key",
            "agent_id",
            "workspace_id",
            "channel_thread_id",
          ],
          rows: [
            {
              tenant_id: DEFAULT_TENANT_ID,
              conversation_id: conversationId,
              conversation_key: "agent:default:main",
              agent_id: DEFAULT_AGENT_ID,
              workspace_id: DEFAULT_WORKSPACE_ID,
              channel_thread_id: channelThreadId,
            },
          ],
        },
        conversation_state: {
          columns: ["tenant_id", "conversation_id", "summary_json", "pending_json", "updated_at"],
          rows: [
            {
              tenant_id: DEFAULT_TENANT_ID,
              conversation_id: conversationId,
              summary_json: null,
              pending_json: {
                compacted_through_message_id: null,
                recent_message_ids: [],
                pending_approvals: [],
                pending_tool_state: [],
              },
              updated_at: "2026-03-28T11:00:00.000Z",
            },
          ],
        },
      },
    } as const;

    try {
      const importApp = createSnapshotRoutes({
        db: targetOpened.db,
        version: "test-version",
        importEnabled: true,
      });
      const importRes = await importApp.request("/snapshot/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "IMPORT", bundle }),
      });
      expect(importRes.status).toBe(200);

      const importedState = await targetOpened.db.get<{
        summary_json: unknown;
        pending_json: unknown;
      }>(
        `SELECT summary_json, pending_json
           FROM conversation_state
          WHERE tenant_id = ? AND conversation_id = ?`,
        [DEFAULT_TENANT_ID, conversationId],
      );
      expect(importedState?.summary_json).toBeNull();
      expect(importedState?.pending_json).toEqual({
        compacted_through_message_id: null,
        recent_message_ids: [],
        pending_approvals: [],
        pending_tool_state: [],
      });
    } finally {
      await targetOpened.close();
    }
  });
});
