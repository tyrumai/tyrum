import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WsConversationGetResult, WsConversationListResult } from "@tyrum/contracts";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { extractArtifactIdFromUrl } from "../../src/modules/artifact/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { handleAiSdkChatMessage } from "../../src/ws/protocol/ai-sdk-chat-ops.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createSpyLogger, makeClient, makeDeps } from "./ws-protocol.test-support.js";
import {
  createErroredChunkStream,
  createTurnIngressStreamHandle,
  readOkResult,
  seedPausedApprovalTurn,
  waitFor,
} from "./ai-sdk-chat-ops.test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("ai-sdk chat ops", () => {
  let container: GatewayContainer | undefined;
  let homeDir: string | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("projects a pending approval message from durable paused turn state", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-ops-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const connectionManager = new ConnectionManager();
    const { id } = makeClient(connectionManager, []);
    const client = connectionManager.getClient(id);
    expect(client).toBeTruthy();

    const conversation = await container.conversationDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-approval",
      containerKind: "channel",
    });

    const finalize = vi.fn(async () => undefined);
    const runtime = {
      turnIngressStream: vi.fn(async () =>
        createTurnIngressStreamHandle({
          finalize,
          outcome: "paused",
        }),
      ),
    };
    const deps = makeDeps(connectionManager, {
      agents: {
        getRuntime: vi.fn(async () => runtime),
      } as never,
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    await handleAiSdkChatMessage(
      client!,
      {
        request_id: "req-send-1",
        type: "conversation.send",
        payload: {
          conversation_id: conversation.conversation_key,
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "run a safe shell command" }],
            },
          ],
          trigger: "submit-message",
        },
      } as never,
      deps,
    );

    const initialConversation = WsConversationGetResult.parse(
      readOkResult(
        await handleAiSdkChatMessage(
          client!,
          {
            request_id: "req-get-1",
            type: "conversation.get",
            payload: { conversation_id: conversation.conversation_key },
          } as never,
          deps,
        ),
      ),
    );
    expect(initialConversation.conversation.messages.at(-1)?.role).toBe("user");

    await seedPausedApprovalTurn({
      assistantText: "Let me check that first.",
      container,
      conversation,
      tenantId: DEFAULT_TENANT_ID,
      toolCallId: "tc-bash-1",
      toolCommand: "printf smoke-approval",
      toolId: "bash",
      userText: "run a safe shell command",
    });

    const pausedConversation = await waitFor(async () => {
      const result = WsConversationGetResult.parse(
        readOkResult(
          await handleAiSdkChatMessage(
            client!,
            {
              request_id: "req-get-2",
              type: "conversation.get",
              payload: { conversation_id: conversation.conversation_key },
            } as never,
            deps,
          ),
        ),
      );
      const assistantMessage = result.conversation.messages.findLast(
        (message) => message.role === "assistant",
      );
      const hasPendingApproval = assistantMessage?.parts.some((part) => {
        if (part.type === "data-approval-state" && "data" in part) {
          return part.data?.state === "pending";
        }
        return (
          (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
          "state" in part &&
          part.state === "approval-requested"
        );
      });
      return hasPendingApproval ? result : undefined;
    });

    expect(
      pausedConversation.conversation.messages.some((message) => message.role === "user"),
    ).toBe(true);
    const projectedAssistant = pausedConversation.conversation.messages.findLast(
      (message) => message.role === "assistant",
    );
    const projectedTextPart = projectedAssistant?.parts.find((part) => part.type === "text");
    expect(projectedTextPart).toMatchObject({
      type: "text",
      text: "Let me check that first.",
    });
    const pausedList = WsConversationListResult.parse(
      readOkResult(
        await handleAiSdkChatMessage(
          client!,
          {
            request_id: "req-list-approval-1",
            type: "conversation.list",
            payload: { agent_key: "default", channel: "ui" },
          } as never,
          deps,
        ),
      ),
    );
    const pausedSummary = pausedList.conversations.find(
      (summary) => summary.conversation_id === pausedConversation.conversation.conversation_id,
    );
    expect(pausedSummary?.message_count).toBe(pausedConversation.conversation.message_count);
    expect(pausedSummary?.last_message).toEqual(pausedConversation.conversation.last_message);
    expect(pausedSummary?.last_message?.text).toBe("Let me check that first.");
    expect(finalize).not.toHaveBeenCalled();
  });

  it("keeps the durable transcript at the submitted user turn when the durable stream errors", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-ops-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const connectionManager = new ConnectionManager();
    const { id } = makeClient(connectionManager, []);
    const client = connectionManager.getClient(id);
    expect(client).toBeTruthy();

    const conversation = await container.conversationDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-error",
      containerKind: "channel",
    });

    const runtime = {
      turnIngressStream: vi.fn(async () =>
        createTurnIngressStreamHandle({
          stream: createErroredChunkStream([], new Error("boom")),
        }),
      ),
    };
    const deps = makeDeps(connectionManager, {
      agents: {
        getRuntime: vi.fn(async () => runtime),
      } as never,
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    await handleAiSdkChatMessage(
      client!,
      {
        request_id: "req-send-2",
        type: "conversation.send",
        payload: {
          conversation_id: conversation.conversation_key,
          messages: [
            {
              id: "user-2",
              role: "user",
              parts: [{ type: "text", text: "say something partial" }],
            },
          ],
          trigger: "submit-message",
        },
      } as never,
      deps,
    );

    const erroredConversation = WsConversationGetResult.parse(
      readOkResult(
        await handleAiSdkChatMessage(
          client!,
          {
            request_id: "req-get-3",
            type: "conversation.get",
            payload: { conversation_id: conversation.conversation_key },
          } as never,
          deps,
        ),
      ),
    );

    expect(erroredConversation.conversation.messages).toHaveLength(1);
    expect(erroredConversation.conversation.messages[0]).toMatchObject({
      id: "user-2",
      role: "user",
    });
  });

  it("persists uploaded chat files as artifact records before linking them to the conversation", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-ops-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const connectionManager = new ConnectionManager();
    const { id } = makeClient(connectionManager, []);
    const client = connectionManager.getClient(id);
    expect(client).toBeTruthy();

    const conversation = await container.conversationDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-upload",
      containerKind: "channel",
    });

    const runtime = {
      turnIngressStream: vi.fn(async () => createTurnIngressStreamHandle()),
    };
    const deps = makeDeps(connectionManager, {
      agents: {
        getRuntime: vi.fn(async () => runtime),
      } as never,
      artifactMaxUploadBytes: 1024,
      artifactStore: container.artifactStore,
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    const response = await handleAiSdkChatMessage(
      client!,
      {
        request_id: "req-send-upload-1",
        type: "conversation.send",
        payload: {
          conversation_id: conversation.conversation_key,
          messages: [
            {
              id: "user-upload-1",
              role: "user",
              parts: [
                {
                  type: "file",
                  url: "data:text/plain;base64,aGVsbG8=",
                  mediaType: "text/plain",
                  filename: "hello.txt",
                },
              ],
            },
          ],
          trigger: "submit-message",
        },
      } as never,
      deps,
    );

    readOkResult<{ stream_id: string }>(response);
    expect(runtime.turnIngressStream).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          expect.objectContaining({
            type: "file",
            url: expect.stringMatching(/\/a\//),
            filename: "hello.txt",
            mediaType: "text/plain",
          }),
        ],
      }),
    );

    const updated = await waitFor(async () => {
      const candidate = await container?.conversationDal.getById({
        tenantId: conversation.tenant_id,
        conversationId: conversation.conversation_id,
      });
      const url = candidate?.messages.at(-1)?.parts[0];
      return url?.type === "file" && typeof url.url === "string" ? candidate : undefined;
    });

    const filePart = updated.messages.at(-1)?.parts[0];
    expect(filePart?.type).toBe("file");
    if (filePart?.type !== "file") {
      throw new Error("expected a persisted file part");
    }
    expect(filePart.url.startsWith("data:")).toBe(false);
    const artifactId = extractArtifactIdFromUrl(filePart.url);
    expect(artifactId).toBeTruthy();
    if (!artifactId) {
      throw new Error("expected an artifact-backed file URL");
    }

    const artifactRow = await container.db.get<{
      agent_id: string | null;
      filename: string | null;
      mime_type: string | null;
      workspace_id: string;
    }>(
      `SELECT agent_id, workspace_id, filename, mime_type
       FROM artifacts
       WHERE tenant_id = ? AND artifact_id = ?`,
      [conversation.tenant_id, artifactId],
    );
    expect(artifactRow).toEqual({
      agent_id: conversation.agent_id,
      workspace_id: conversation.workspace_id,
      filename: "hello.txt",
      mime_type: "text/plain",
    });

    const links = await container.db.all<{ parent_id: string; parent_kind: string }>(
      `SELECT parent_kind, parent_id
       FROM artifact_links
       WHERE tenant_id = ? AND artifact_id = ?
       ORDER BY parent_kind ASC, parent_id ASC`,
      [conversation.tenant_id, artifactId],
    );
    expect(links).toEqual([
      { parent_kind: "chat_conversation", parent_id: conversation.conversation_id },
      { parent_kind: "chat_message", parent_id: "user-upload-1" },
    ]);
  });

  it("returns conversation metadata that parses under the strict conversation schemas", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-ai-sdk-chat-ops-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const connectionManager = new ConnectionManager();
    const { id } = makeClient(connectionManager, []);
    const client = connectionManager.getClient(id);
    expect(client).toBeTruthy();

    const conversation = await container.conversationDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "telegram",
      accountKey: "ops",
      providerThreadId: "telegram-thread-metadata",
      containerKind: "dm",
    });
    const deps = makeDeps(connectionManager, {
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    const listResult = WsConversationListResult.parse(
      readOkResult(
        await handleAiSdkChatMessage(
          client!,
          {
            request_id: "req-list-metadata",
            type: "conversation.list",
            payload: { agent_key: "default", channel: "telegram" },
          } as never,
          deps,
        ),
      ),
    );
    expect(listResult.conversations).toContainEqual(
      expect.objectContaining({
        conversation_id: conversation.conversation_key,
        account_key: "ops",
        container_kind: "dm",
      }),
    );

    const getResult = WsConversationGetResult.parse(
      readOkResult(
        await handleAiSdkChatMessage(
          client!,
          {
            request_id: "req-get-metadata",
            type: "conversation.get",
            payload: { conversation_id: conversation.conversation_key },
          } as never,
          deps,
        ),
      ),
    );
    expect(getResult.conversation).toMatchObject({
      conversation_id: conversation.conversation_key,
      account_key: "ops",
      container_kind: "dm",
    });
  });
});
