import {
  WsConversationCreateResult,
  WsConversationDeleteResult,
  WsConversationGetResult,
  WsSubagentCloseResult,
  WsTranscriptGetResult,
  WsTranscriptListResult,
} from "@tyrum/contracts";
import { vi } from "vitest";
import type { OperatorWsClient } from "../../operator-app/src/deps.js";
import type { Handler } from "./operator-ui.test-support.js";

export class FakeWsClient implements OperatorWsClient {
  connected: boolean;

  constructor(initiallyConnected = true) {
    this.connected = initiallyConnected;
  }

  connect = vi.fn(() => {
    if (this.connected) {
      this.emit("connected", { clientId: null });
    }
  });

  disconnect = vi.fn(() => {
    this.emit("disconnected", { code: 1000, reason: "client disconnect" });
  });

  approvalList = vi.fn(async () => ({ approvals: [], next_cursor: undefined }));
  turnList = vi.fn(async () => ({ turns: [], steps: [], attempts: [] }));
  approvalResolve = vi.fn(async () => {
    throw new Error("not implemented");
  });
  memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }) as unknown);
  memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
  memoryGet = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryUpdate = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] }) as unknown);
  memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" }) as unknown);
  workList = vi.fn(
    async () =>
      ({
        scope: {
          tenant_id: "tenant-default",
          agent_id: "agent-default",
          workspace_id: "workspace-default",
        },
        items: [],
      }) as unknown,
  );
  requestDynamic = vi.fn(
    async (type: string, payload: unknown, schema?: { parse?: (input: unknown) => unknown }) => {
      let result: unknown;
      switch (type) {
        case "conversation.list":
          result = await this.sessionList(payload);
          break;
        case "conversation.get":
          result = await this.sessionGet(payload);
          break;
        case "conversation.create":
          result = await this.sessionCreate(payload);
          break;
        case "conversation.delete":
          result = await this.sessionDelete(payload);
          break;
        case "conversation.queue_mode.set":
          result = await this.sessionQueueModeSet(
            payload as { queue_mode: string; conversation_id: string },
          );
          break;
        case "transcript.list":
          result = await this.transcriptList(payload);
          break;
        case "transcript.get":
          result = await this.transcriptGet(payload);
          break;
        case "subagent.close":
          result = await this.subagentClose(payload);
          break;
        default:
          throw new Error(`unsupported dynamic request: ${type}`);
      }
      return schema?.parse ? schema.parse(result) : result;
    },
  );
  onDynamicEvent = vi.fn((event: string, handler: Handler) => this.on(event, handler));
  offDynamicEvent = vi.fn((event: string, handler: Handler) => this.off(event, handler));
  sessionList = vi.fn(async () => ({ conversations: [], next_cursor: null }));
  sessionGet = vi.fn(async () => ({
    conversation: WsConversationGetResult.parse({
      conversation: {
        conversation_id: "session-1",
        agent_key: "default",
        channel: "ui",
        thread_id: "ui-session-1",
        title: "",
        message_count: 0,
        queue_mode: "steer",
        last_message: null,
        messages: [],
        updated_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    }).conversation,
  }));
  sessionCreate = vi.fn(
    async () =>
      WsConversationCreateResult.parse({
        conversation: {
          conversation_id: "session-1",
          agent_key: "default",
          channel: "ui",
          thread_id: "ui-session-1",
          title: "",
          message_count: 0,
          queue_mode: "steer",
          last_message: null,
          messages: [],
          updated_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      }).conversation,
  );
  sessionDelete = vi.fn(async () =>
    WsConversationDeleteResult.parse({ conversation_id: "session-1" }),
  );
  sessionQueueModeSet = vi.fn(async (payload: { queue_mode: string; conversation_id: string }) => ({
    conversation_id: payload.conversation_id,
    queue_mode: payload.queue_mode,
  }));
  transcriptList = vi.fn(async () =>
    WsTranscriptListResult.parse({
      conversations: [
        {
          conversation_id: "550e8400-e29b-41d4-a716-446655440131",
          conversation_key: "agent:default:ui:default:channel:thread-root-1",
          agent_key: "default",
          channel: "ui",
          thread_id: "thread-root-1",
          title: "Default Agent conversation",
          message_count: 2,
          updated_at: "2026-01-01T00:01:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          archived: false,
          latest_turn_id: null,
          latest_turn_status: null,
          has_active_turn: false,
          pending_approval_count: 0,
        },
      ],
      next_cursor: null,
    }),
  );
  transcriptGet = vi.fn(async () =>
    WsTranscriptGetResult.parse({
      root_conversation_key: "agent:default:ui:default:channel:thread-root-1",
      focus_conversation_key: "agent:default:ui:default:channel:thread-root-1",
      conversations: [
        {
          conversation_id: "550e8400-e29b-41d4-a716-446655440131",
          conversation_key: "agent:default:ui:default:channel:thread-root-1",
          agent_key: "default",
          channel: "ui",
          thread_id: "thread-root-1",
          title: "Default Agent conversation",
          message_count: 2,
          updated_at: "2026-01-01T00:01:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          archived: false,
          latest_turn_id: null,
          latest_turn_status: null,
          has_active_turn: false,
          pending_approval_count: 0,
        },
      ],
      events: [
        {
          event_id: "message:session-root-1:msg-1",
          kind: "message",
          occurred_at: "2026-01-01T00:00:10.000Z",
          conversation_key: "agent:default:ui:default:channel:thread-root-1",
          payload: {
            message: {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "Inspect this agent" }],
            },
          },
        },
        {
          event_id: "message:session-root-1:msg-2",
          kind: "message",
          occurred_at: "2026-01-01T00:00:20.000Z",
          conversation_key: "agent:default:ui:default:channel:thread-root-1",
          payload: {
            message: {
              id: "msg-2",
              role: "assistant",
              parts: [{ type: "text", text: "Transcript retained." }],
            },
          },
        },
      ],
    }),
  );
  subagentClose = vi.fn(async () =>
    WsSubagentCloseResult.parse({
      subagent: {
        subagent_id: "550e8400-e29b-41d4-a716-446655440099",
        tenant_id: "tenant-default",
        agent_id: "00000000-0000-4000-8000-000000000001",
        workspace_id: "00000000-0000-4000-8000-000000000002",
        parent_conversation_key: "agent:default:ui:default:channel:thread-root-1",
        conversation_key: "agent:default:subagent:550e8400-e29b-41d4-a716-446655440099",
        execution_profile: "executor",
        status: "closed",
        created_at: "2026-01-01T00:01:00.000Z",
        updated_at: "2026-01-01T00:02:00.000Z",
        closed_at: "2026-01-01T00:02:00.000Z",
      },
    }),
  );
  commandExecute = vi.fn(async () => ({}));

  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.add(handler);
      if (event === "connected" && this.connected) {
        handler({ clientId: null });
      }
      return;
    }
    this.handlers.set(event, new Set([handler]));
    if (event === "connected" && this.connected) {
      handler({ clientId: null });
    }
  }

  off(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (!existing) return;
    existing.delete(handler);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }

  emit(event: string, data: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}
