import { describe, expect, it, vi } from "vitest";
import { sendPromptAndCollectTrace } from "../../src/benchmark/runner.js";
import { summarizeBenchmarkTrace } from "../../src/benchmark/trace-normalizer.js";

describe("benchmark trace capture approvals", () => {
  it("preserves approval request transitions for auto-approved runs", async () => {
    const handlers = new Map<string, Set<(event: unknown) => void>>();
    const conversationKey = "agent:default:main";
    const approvalId = "550e8400-e29b-41d4-a716-446655440222";
    const queuedApproval = {
      approval_id: approvalId,
      approval_key: "approval-2",
      kind: "policy" as const,
      status: "awaiting_human" as const,
      prompt: "Approve checkout",
      motivation: "Payment required",
      created_at: "2026-04-08T09:00:00.000Z",
      latest_review: null,
      scope: { conversation_key: conversationKey },
    };
    const approvedApproval = {
      ...queuedApproval,
      status: "approved" as const,
    };
    const emitApproval = (eventId: string, approval: typeof queuedApproval): void => {
      for (const handler of handlers.get("approval.updated") ?? []) {
        handler({
          event_id: eventId,
          type: "approval.updated",
          occurred_at: approval.created_at,
          payload: { approval },
        });
      }
    };
    const ws = {
      onDynamicEvent(type: string, handler: (event: unknown) => void) {
        const current = handlers.get(type) ?? new Set<(event: unknown) => void>();
        current.add(handler);
        handlers.set(type, current);
      },
      offDynamicEvent(type: string, handler: (event: unknown) => void) {
        handlers.get(type)?.delete(handler);
      },
      approvalResolve: vi.fn(async () => undefined),
      requestDynamic: vi.fn(async (type: string) => {
        if (type === "conversation.send") {
          emitApproval("approval-live-request", queuedApproval);
          emitApproval("approval-live-approved", approvedApproval);
          queueMicrotask(() => {
            for (const handler of handlers.get("chat.ui-message.stream") ?? []) {
              handler({
                event_id: "stream-done",
                type: "chat.ui-message.stream",
                occurred_at: "2026-04-08T09:00:00.100Z",
                payload: { stream_id: "stream-1", stage: "done" },
              });
            }
          });
          return { stream_id: "stream-1" };
        }
        if (type === "conversation.get") {
          return {
            conversation: {
              conversation_id: "conv-1",
              messages: [
                {
                  id: "assistant-1",
                  role: "assistant",
                  parts: [{ type: "text", text: "Done" }],
                },
              ],
            },
          };
        }
        if (type === "transcript.get") {
          return {
            root_conversation_key: conversationKey,
            focus_conversation_key: conversationKey,
            conversations: [],
            events: [
              {
                event_id: "approval:request",
                kind: "approval",
                occurred_at: "2026-04-08T09:00:00.010Z",
                conversation_key: conversationKey,
                payload: { approval: queuedApproval },
              },
              {
                event_id: "approval:approved",
                kind: "approval",
                occurred_at: "2026-04-08T09:00:00.020Z",
                conversation_key: conversationKey,
                payload: { approval: approvedApproval },
              },
            ],
          };
        }
        throw new Error(`unexpected request type ${type}`);
      }),
    };

    const trace = await sendPromptAndCollectTrace(
      ws as never,
      { conversation_id: "conv-1" } as never,
      conversationKey,
      "Order pizza",
      1_000,
      true,
      20,
    );
    const approvalStatuses = trace.approvalEvents.map((approval) => approval.status).toSorted();
    const summary = summarizeBenchmarkTrace({
      toolEvents: [],
      contextReports: [],
      approvals: trace.approvalEvents,
      assistantMessages: [],
      finalReply: trace.finalReply,
      requiredToolFamilies: [],
      disallowedToolFamilies: [],
      seededFacts: [],
    });

    expect(approvalStatuses).toEqual(["approved", "awaiting_human"]);
    expect(summary.approvals.requested).toBe(1);
    expect(summary.approvals.approved).toBe(1);
    expect(ws.approvalResolve).toHaveBeenCalledWith({
      approval_id: approvalId,
      decision: "approved",
      reason: "benchmark auto-approval",
    });
  });

  it("fails fast when benchmark auto-approval cannot be sent", async () => {
    const handlers = new Map<string, Set<(event: unknown) => void>>();
    const conversationKey = "agent:default:main";
    const approvalId = "550e8400-e29b-41d4-a716-446655440223";
    const queuedApproval = {
      approval_id: approvalId,
      approval_key: "approval-3",
      kind: "policy" as const,
      status: "awaiting_human" as const,
      prompt: "Approve checkout",
      motivation: "Payment required",
      created_at: "2026-04-08T09:00:00.000Z",
      latest_review: null,
      scope: { conversation_key: conversationKey },
    };
    const emitApproval = (eventId: string, approval: typeof queuedApproval): void => {
      for (const handler of handlers.get("approval.updated") ?? []) {
        handler({
          event_id: eventId,
          type: "approval.updated",
          occurred_at: approval.created_at,
          payload: { approval },
        });
      }
    };
    const unhandledRejections: unknown[] = [];
    const handleUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };

    process.on("unhandledRejection", handleUnhandledRejection);

    try {
      const ws = {
        onDynamicEvent(type: string, handler: (event: unknown) => void) {
          const current = handlers.get(type) ?? new Set<(event: unknown) => void>();
          current.add(handler);
          handlers.set(type, current);
        },
        offDynamicEvent(type: string, handler: (event: unknown) => void) {
          handlers.get(type)?.delete(handler);
        },
        approvalResolve: vi.fn(async () => {
          throw new Error("socket closed");
        }),
        requestDynamic: vi.fn(async (type: string) => {
          if (type === "conversation.send") {
            emitApproval("approval-live-request", queuedApproval);
            return { stream_id: "stream-1" };
          }
          throw new Error(`unexpected request type ${type}`);
        }),
      };

      await expect(
        sendPromptAndCollectTrace(
          ws as never,
          { conversation_id: "conv-1" } as never,
          conversationKey,
          "Order pizza",
          1_000,
          true,
          20,
        ),
      ).rejects.toThrow("benchmark auto-approval failed: socket closed");

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", handleUnhandledRejection);
    }
  });

  it("captures live tool and context events by thread and channel when payload ids use internal conversation uuids", async () => {
    const handlers = new Map<string, Set<(event: unknown) => void>>();
    const conversationKey = "agent:default:main";
    const conversationThreadId = "ui-thread-1";
    const internalConversationId = "550e8400-e29b-41d4-a716-446655440401";

    const emit = (type: string, event: unknown): void => {
      for (const handler of handlers.get(type) ?? []) {
        handler(event);
      }
    };

    const ws = {
      onDynamicEvent(type: string, handler: (event: unknown) => void) {
        const current = handlers.get(type) ?? new Set<(event: unknown) => void>();
        current.add(handler);
        handlers.set(type, current);
      },
      offDynamicEvent(type: string, handler: (event: unknown) => void) {
        handlers.get(type)?.delete(handler);
      },
      requestDynamic: vi.fn(async (type: string) => {
        if (type === "conversation.send") {
          emit("tool.lifecycle", {
            event_id: "tool-live-match",
            type: "tool.lifecycle",
            occurred_at: "2026-04-08T09:00:00.010Z",
            payload: {
              conversation_id: internalConversationId,
              thread_id: conversationThreadId,
              tool_call_id: "tool-call-1",
              tool_id: "tool.location.get",
              status: "completed",
              summary: "Resolved location",
              channel: "ui",
            },
          });
          emit("tool.lifecycle", {
            event_id: "tool-live-ignore",
            type: "tool.lifecycle",
            occurred_at: "2026-04-08T09:00:00.011Z",
            payload: {
              conversation_id: "550e8400-e29b-41d4-a716-446655440499",
              thread_id: "heartbeat",
              tool_call_id: "tool-call-2",
              tool_id: "tool.location.get",
              status: "completed",
              summary: "Ignore me",
              channel: "automation:default",
            },
          });
          emit("context_report.created", {
            event_id: "context-live-match",
            type: "context_report.created",
            occurred_at: "2026-04-08T09:00:00.020Z",
            payload: {
              turn_id: "550e8400-e29b-41d4-a716-446655440402",
              report: {
                context_report_id: "550e8400-e29b-41d4-a716-446655440403",
                generated_at: "2026-04-08T09:00:00.020Z",
                conversation_id: internalConversationId,
                channel: "ui",
                thread_id: conversationThreadId,
                agent_id: "00000000-0000-4000-8000-000000000002",
                workspace_id: "00000000-0000-4000-8000-000000000003",
                system_prompt: { chars: 1, sections: [] },
                user_parts: [],
                selected_tools: [],
                tool_schema_top: [],
                tool_schema_total_chars: 0,
                enabled_skills: [],
                mcp_servers: [],
                memory: { keyword_hits: 0, semantic_hits: 0 },
                pre_turn_tools: [],
                tool_calls: [],
                injected_files: [],
              },
            },
          });
          emit("context_report.created", {
            event_id: "context-live-ignore",
            type: "context_report.created",
            occurred_at: "2026-04-08T09:00:00.021Z",
            payload: {
              turn_id: "550e8400-e29b-41d4-a716-446655440404",
              report: {
                context_report_id: "550e8400-e29b-41d4-a716-446655440405",
                generated_at: "2026-04-08T09:00:00.021Z",
                conversation_id: "550e8400-e29b-41d4-a716-446655440499",
                channel: "automation:default",
                thread_id: "heartbeat",
                agent_id: "00000000-0000-4000-8000-000000000002",
                workspace_id: "00000000-0000-4000-8000-000000000003",
                system_prompt: { chars: 1, sections: [] },
                user_parts: [],
                selected_tools: [],
                tool_schema_top: [],
                tool_schema_total_chars: 0,
                enabled_skills: [],
                mcp_servers: [],
                memory: { keyword_hits: 0, semantic_hits: 0 },
                pre_turn_tools: [],
                tool_calls: [],
                injected_files: [],
              },
            },
          });
          queueMicrotask(() => {
            emit("chat.ui-message.stream", {
              event_id: "stream-done",
              type: "chat.ui-message.stream",
              occurred_at: "2026-04-08T09:00:00.100Z",
              payload: { stream_id: "stream-1", stage: "done" },
            });
          });
          return { stream_id: "stream-1" };
        }
        if (type === "conversation.get") {
          return {
            conversation: {
              conversation_id: conversationKey,
              channel: "ui",
              thread_id: conversationThreadId,
              messages: [
                {
                  id: "assistant-1",
                  role: "assistant",
                  parts: [{ type: "text", text: "Done" }],
                },
              ],
            },
          };
        }
        if (type === "transcript.get") {
          return {
            root_conversation_key: conversationKey,
            focus_conversation_key: conversationKey,
            conversations: [],
            events: [],
          };
        }
        throw new Error(`unexpected request type ${type}`);
      }),
    };

    const trace = await sendPromptAndCollectTrace(
      ws as never,
      {
        conversation_id: conversationKey,
        channel: "ui",
        thread_id: conversationThreadId,
      } as never,
      conversationKey,
      "Check the weather forecast.",
      1_000,
      false,
      20,
    );

    expect(trace.captureDiagnostics.liveToolEvents).toBe(1);
    expect(trace.captureDiagnostics.liveContextReports).toBe(1);
    expect(trace.toolEvents).toEqual([
      expect.objectContaining({
        conversation_id: internalConversationId,
        tool_id: "tool.location.get",
      }),
    ]);
    expect(trace.contextReports).toEqual([
      expect.objectContaining({
        conversation_id: internalConversationId,
        thread_id: conversationThreadId,
      }),
    ]);
  });
});
