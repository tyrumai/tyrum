import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { createAdminWsClient, serializeWsRequest } from "../helpers/ws-protocol-test-helpers.js";
import {
  createTranscriptFixture,
  insertRunningExecutionTrace,
  insertTranscriptContextReport,
  insertTranscriptToolLifecycleEvent,
} from "./transcript-handlers.test-support.js";

describe("transcript WS handlers timeline events", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("includes approval events in transcript.get when approvals are linked to transcript runs", async () => {
    const fixture = await createTranscriptFixture();
    db = fixture.db;
    const { root1 } = fixture;
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await insertRunningExecutionTrace({
      db: db!,
      tenantId: root1.tenant_id,
      agentId: root1.agent_id,
      workspaceId: root1.workspace_id,
      conversationKey: root1.conversation_key,
      jobId: "550e8400-e29b-41d4-a716-446655440301",
      turnId: "550e8400-e29b-41d4-a716-446655440300",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ab",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d1a",
      createdAt: "2026-02-17T00:00:20.000Z",
    });

    const approval = await new ApprovalDal(db!).create({
      tenantId: root1.tenant_id,
      agentId: root1.agent_id,
      workspaceId: root1.workspace_id,
      approvalKey: "approval:transcript-run-1",
      prompt: "Approve transcript run?",
      motivation: "Approve transcript run?",
      kind: "policy",
      status: "queued",
      conversationId: root1.conversation_id,
      turnId: "550e8400-e29b-41d4-a716-446655440300",
      workflowRunStepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ab",
    });
    const getByIdSpy = vi.spyOn(ApprovalDal.prototype, "getById");

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.get",
        payload: { conversation_key: root1.conversation_key },
      }),
      deps,
    )) as {
      ok: boolean;
      result: { events: Array<{ kind: string; event_id: string; conversation_key: string }> };
    };

    expect(response.ok).toBe(true);
    const approvalEvent = response.result.events.find(
      (event) => event.event_id === `approval:${approval.approval_id}`,
    );
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent).toMatchObject({
      kind: "approval",
      conversation_key: root1.conversation_key,
    });
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it("includes persisted tool lifecycle and context report events in transcript.get", async () => {
    const fixture = await createTranscriptFixture();
    db = fixture.db;
    const { root1 } = fixture;
    const client = createAdminWsClient();
    const deps = { connectionManager: new ConnectionManager(), db: db! };

    await insertTranscriptToolLifecycleEvent({
      db: db!,
      tenantId: root1.tenant_id,
      eventId: "550e8400-e29b-41d4-a716-446655440401",
      eventKey: "tool:transcript-1",
      conversationId: root1.conversation_id,
      threadId: "thread-root-1",
      toolCallId: "tool-call-1",
      toolId: "tool.location.get",
      status: "completed",
      summary: "Resolved device location.",
      occurredAt: "2026-02-17T00:00:15.000Z",
    });
    await insertTranscriptContextReport({
      db: db!,
      tenantId: root1.tenant_id,
      contextReportId: "550e8400-e29b-41d4-a716-446655440402",
      conversationId: root1.conversation_id,
      channel: "ui",
      threadId: "thread-root-1",
      agentId: root1.agent_id,
      workspaceId: root1.workspace_id,
      createdAt: "2026-02-17T00:00:16.000Z",
      report: {
        context_report_id: "550e8400-e29b-41d4-a716-446655440402",
        generated_at: "2026-02-17T00:00:16.000Z",
        conversation_id: root1.conversation_id,
        channel: "ui",
        thread_id: "thread-root-1",
        agent_id: root1.agent_id,
        workspace_id: root1.workspace_id,
        system_prompt: { chars: 10, sections: [] },
        user_parts: [],
        selected_tools: [],
        tool_schema_top: [],
        tool_schema_total_chars: 0,
        enabled_skills: [],
        mcp_servers: [],
        memory: { keyword_hits: 1, semantic_hits: 2 },
        pre_turn_tools: [],
        tool_calls: [],
        injected_files: [],
      },
    });

    const response = (await handleClientMessage(
      client,
      serializeWsRequest({
        type: "transcript.get",
        payload: { conversation_key: root1.conversation_key },
      }),
      deps,
    )) as {
      ok: boolean;
      result: {
        events: Array<{
          kind: string;
          event_id: string;
          conversation_key: string;
          payload?: {
            tool_event?: { tool_id: string };
            report?: { memory?: { keyword_hits?: number } };
          };
        }>;
      };
    };

    expect(response.ok).toBe(true);
    expect(response.result.events.find((event) => event.kind === "tool_lifecycle")).toMatchObject({
      event_id: "tool_lifecycle:550e8400-e29b-41d4-a716-446655440401",
      conversation_key: root1.conversation_key,
      payload: {
        tool_event: { tool_id: "tool.location.get" },
      },
    });
    expect(response.result.events.find((event) => event.kind === "context_report")).toMatchObject({
      event_id: "context_report:550e8400-e29b-41d4-a716-446655440402",
      conversation_key: root1.conversation_key,
      payload: {
        report: { memory: { keyword_hits: 1 } },
      },
    });
  });
});
