import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

const materializeStoredMessageFilesMock = vi.hoisted(() =>
  vi.fn(async (messages: unknown) => messages),
);

vi.mock("../../src/modules/ai-sdk/attachment-parts.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/modules/ai-sdk/attachment-parts.js")>();
  return {
    ...actual,
    materializeStoredMessageFiles: materializeStoredMessageFilesMock,
  };
});

import { finalizeTurn } from "../../src/modules/agent/runtime/turn-finalization.js";

function sampleInput(
  responseMessages: readonly ModelMessage[],
  options?: {
    artifactStore?: unknown;
    conversationMessages?: Array<Record<string, unknown>>;
    resolvedMessage?: string;
    resolvedParts?: Array<Record<string, unknown>>;
    turnId?: string;
  },
) {
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const replaceMessages = vi.fn(async () => undefined);
  const getById = vi.fn(async () => ({
    agent_id: "agent-1",
    archived: false,
    channel_thread_id: "thread-1",
    context_state: {
      version: 1,
      recent_message_ids: [],
      checkpoint: null,
      pending_approvals: [],
      pending_tool_state: [],
      updated_at: "2026-03-13T00:00:00.000Z",
    },
    created_at: "2026-03-13T00:00:00.000Z",
    tenant_id: "tenant-1",
    conversation_id: conversationId,
    conversation_key: "agent:agent-1:main",
    summary: "",
    title: "Existing title",
    transcript: [],
    updated_at: "2026-03-13T00:00:00.000Z",
    workspace_id: "workspace-1",
    messages: options?.conversationMessages ?? [],
  }));

  return {
    args: {
      container: {
        artifactStore: (options?.artifactStore ?? undefined) as never,
        contextReportDal: { insert: vi.fn(async () => undefined) },
        db: {} as never,
        logger: { warn: vi.fn(), info: vi.fn() },
      },
      conversationDal: {
        replaceMessages,
        getById,
        setTitleIfBlank: vi.fn(async () => undefined),
      },
      ctx: {
        config: {
          conversations: {
            loop_detection: {
              cross_turn: {
                enabled: false,
                window_assistant_messages: 3,
                similarity_threshold: 0.95,
                min_chars: 20,
                cooldown_assistant_messages: 1,
              },
            },
          },
        },
      },
      conversation: {
        agent_id: "agent-1",
        archived: false,
        channel_thread_id: "thread-1",
        context_state: {
          version: 1,
          recent_message_ids: [],
          checkpoint: null,
          pending_approvals: [],
          pending_tool_state: [],
          updated_at: "2026-03-13T00:00:00.000Z",
        },
        created_at: "2026-03-13T00:00:00.000Z",
        tenant_id: "tenant-1",
        conversation_id: conversationId,
        conversation_key: "agent:agent-1:main",
        summary: "",
        title: "Existing title",
        transcript: [],
        updated_at: "2026-03-13T00:00:00.000Z",
        workspace_id: "workspace-1",
        messages: options?.conversationMessages ?? [],
      },
      resolved: {
        message: options?.resolvedMessage ?? "hello",
        parts: options?.resolvedParts ?? [],
        channel: "ui",
        thread_id: "thread-1",
      },
      reply: "ok",
      turn_id: options?.turnId ?? "11111111-1111-4111-8111-111111111112",
      model: {} as never,
      usedTools: new Set<string>(),
      memoryWritten: false,
      contextReport: {
        context_report_id: "report-1",
        generated_at: "2026-03-13T00:00:00.000Z",
        conversation_id: conversationId,
        thread_id: "thread-1",
        channel: "ui",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
        tool_calls: [],
        injected_files: [],
      },
      responseMessages,
    } as const,
    replaceMessages,
  };
}

describe("finalizeTurn", () => {
  beforeEach(() => {
    materializeStoredMessageFilesMock.mockReset();
    materializeStoredMessageFilesMock.mockImplementation(async (messages: unknown) => messages);
  });

  it("does not duplicate the triggering user message when responseMessages include it", async () => {
    const { args, replaceMessages } = sampleInput([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      } as ModelMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "draft" }],
      } as ModelMessage,
    ]);

    await finalizeTurn(args);

    expect(replaceMessages).toHaveBeenCalledOnce();
    const persisted = replaceMessages.mock.calls[0]?.[0]?.messages;
    expect(persisted).toHaveLength(2);
    expect(persisted?.[0]?.role).toBe("user");
    expect(persisted?.[0]?.parts).toEqual([{ type: "text", text: "hello" }]);
    expect(persisted?.[0]?.metadata).toEqual({
      turn_id: "11111111-1111-4111-8111-111111111112",
      created_at: expect.any(String),
    });
    expect(persisted?.[1]?.role).toBe("assistant");
    expect(persisted?.[1]?.parts).toEqual([{ type: "text", text: "ok" }]);
    expect(persisted?.[1]?.metadata).toEqual({
      turn_id: "11111111-1111-4111-8111-111111111112",
      created_at: expect.any(String),
    });
  });

  it("does not duplicate a submitted user message that is already persisted", async () => {
    const persistedUserMessage = {
      id: "user-existing",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    };
    const { args, replaceMessages } = sampleInput(
      [
        {
          role: "assistant",
          content: [{ type: "text", text: "draft" }],
        } as ModelMessage,
      ],
      {
        conversationMessages: [persistedUserMessage],
      },
    );

    await finalizeTurn(args);

    expect(replaceMessages).toHaveBeenCalledOnce();
    const persisted = replaceMessages.mock.calls[0]?.[0]?.messages;
    expect(persisted).toHaveLength(2);
    expect(persisted?.[0]).toEqual(persistedUserMessage);
    expect(persisted?.[1]?.role).toBe("assistant");
    expect(persisted?.[1]?.parts).toEqual([{ type: "text", text: "ok" }]);
    expect(persisted?.[1]?.metadata).toEqual({
      turn_id: "11111111-1111-4111-8111-111111111112",
      created_at: expect.any(String),
    });
  });

  it("does not duplicate file-bearing user turns when materialization rewrites data URLs", async () => {
    const dataUrl = "data:text/plain;base64,aGVsbG8=";
    materializeStoredMessageFilesMock.mockImplementation(
      async (
        messages: unknown,
        _artifactStore: unknown,
        _maxUploadBytes: unknown,
        _artifactRecordScope: unknown,
        artifactRecords?: Array<Record<string, unknown>>,
      ) => {
        artifactRecords?.push({
          artifact: {
            artifact_id: "upload-1",
            uri: "artifact://upload-1",
            external_url: "https://example.com/a/upload-1",
            kind: "file",
            media_class: "other",
            created_at: "2026-03-13T00:00:00.000Z",
            filename: "hello.txt",
            mime_type: "text/plain",
            size_bytes: 5,
            sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            labels: [],
            metadata: { source: "test" },
          },
          tenantId: "tenant-1",
          workspaceId: "workspace-1",
          agentId: "agent-1",
          sensitivity: "normal",
          policySnapshotId: null,
        });
        const output: Array<{ parts: Array<Record<string, unknown>> }> = [];
        for (const message of messages as Array<{ parts: Array<Record<string, unknown>> }>) {
          const nextParts: Array<Record<string, unknown>> = [];
          for (const part of message.parts) {
            if (part["type"] === "file" && part["url"] === dataUrl) {
              nextParts.push({
                type: "file",
                url: "https://example.com/a/upload-1",
                mediaType: part["mediaType"],
                filename: part["filename"],
              });
              continue;
            }
            nextParts.push(part);
          }
          output.push({
            ...message,
            parts: nextParts,
          });
        }
        return output;
      },
    );

    const { args, replaceMessages } = sampleInput(
      [
        {
          role: "user",
          content: [
            {
              type: "file",
              url: dataUrl,
              mediaType: "text/plain",
              filename: "hello.txt",
            },
          ],
        } as ModelMessage,
        {
          role: "assistant",
          content: [{ type: "text", text: "draft" }],
        } as ModelMessage,
      ],
      {
        resolvedParts: [
          {
            type: "file",
            url: dataUrl,
            mediaType: "text/plain",
            filename: "hello.txt",
          },
        ],
      },
    );

    await finalizeTurn(args);

    expect(replaceMessages).toHaveBeenCalledOnce();
    const persisted = replaceMessages.mock.calls[0]?.[0]?.messages;
    expect(persisted).toHaveLength(2);
    expect(persisted?.[0]).toEqual({
      id: expect.any(String),
      role: "user",
      parts: [
        {
          type: "file",
          url: "https://example.com/a/upload-1",
          mediaType: "text/plain",
          filename: "hello.txt",
        },
      ],
      metadata: {
        turn_id: "11111111-1111-4111-8111-111111111112",
        created_at: expect.any(String),
      },
    });
    expect(persisted?.[1]?.role).toBe("assistant");
    expect(persisted?.[1]?.parts).toEqual([{ type: "text", text: "ok" }]);
    expect(persisted?.[1]?.metadata).toEqual({
      turn_id: "11111111-1111-4111-8111-111111111112",
      created_at: expect.any(String),
    });
    expect(replaceMessages.mock.calls[0]?.[0]?.artifactRecords).toEqual([
      {
        artifact: {
          artifact_id: "upload-1",
          uri: "artifact://upload-1",
          external_url: "https://example.com/a/upload-1",
          kind: "file",
          media_class: "other",
          created_at: "2026-03-13T00:00:00.000Z",
          filename: "hello.txt",
          mime_type: "text/plain",
          size_bytes: 5,
          sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          labels: [],
          metadata: { source: "test" },
        },
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        agentId: "agent-1",
        sensitivity: "normal",
        policySnapshotId: null,
      },
    ]);
  });

  it("persists tool activity as a normalized assistant tool part", async () => {
    const { args, replaceMessages } = sampleInput([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Searching now" },
          {
            type: "tool-call",
            toolCallId: "tc-websearch-1",
            toolName: "websearch",
            input: { query: "latest docs" },
            title: "Web Search",
          },
        ],
      } as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-websearch-1",
            toolName: "websearch",
            input: { query: "latest docs" },
            output: { hits: 3 },
            title: "Web Search",
          },
        ],
      } as ModelMessage,
    ]);

    await finalizeTurn(args);

    expect(replaceMessages).toHaveBeenCalledOnce();
    const persisted = replaceMessages.mock.calls[0]?.[0]?.messages;
    expect(persisted).toHaveLength(2);
    expect(persisted?.[0]?.role).toBe("user");
    expect(persisted?.[1]).toMatchObject({
      role: "assistant",
      metadata: {
        turn_id: "11111111-1111-4111-8111-111111111112",
        created_at: expect.any(String),
      },
      parts: [
        {
          type: "tool-websearch",
          toolCallId: "tc-websearch-1",
          state: "output-available",
          input: { query: "latest docs" },
          output: { hits: 3 },
          title: "Web Search",
        },
        { type: "text", text: "ok" },
      ],
    });
  });
});
