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
});
