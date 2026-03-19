import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UIMessageChunk } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WsChatSessionGetResult,
  type WsResponseEnvelope,
  type WsResponseOkEnvelope,
} from "@tyrum/contracts";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { extractArtifactIdFromUrl } from "../../src/modules/artifact/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { handleAiSdkChatMessage } from "../../src/ws/protocol/ai-sdk-chat-ops.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createSpyLogger, makeClient, makeDeps } from "./ws-protocol.test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function createChunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function createErroredChunkStream(
  chunks: UIMessageChunk[],
  error: Error,
): ReadableStream<UIMessageChunk> {
  let index = 0;
  return new ReadableStream<UIMessageChunk>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index += 1;
        return;
      }
      controller.error(error);
    },
  });
}

function readOkResult<T>(response: WsResponseEnvelope | undefined): T {
  expect(response).toBeTruthy();
  expect(response && "ok" in response ? response.ok : false).toBe(true);
  return (response as WsResponseOkEnvelope & { result: T }).result;
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for condition");
}

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

  it("persists an approval-requested snapshot while the run is paused", async () => {
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

    const session = await container.sessionDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-approval",
      containerKind: "channel",
    });

    const finalize = vi.fn(async () => undefined);
    const runtime = {
      turnStream: vi.fn(async () => ({
        finalize,
        streamResult: {
          toUIMessageStream: () =>
            createChunkStream([
              {
                type: "tool-input-available",
                toolCallId: "tc-bash-1",
                toolName: "bash",
                input: { command: "printf smoke-approval" },
              },
              {
                type: "tool-approval-request",
                approvalId: "approval-1",
                toolCallId: "tc-bash-1",
              },
            ]),
        },
      })),
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
        type: "chat.session.send",
        payload: {
          session_id: session.session_key,
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

    const initialSession = WsChatSessionGetResult.parse(
      readOkResult(
        await handleAiSdkChatMessage(
          client!,
          {
            request_id: "req-get-1",
            type: "chat.session.get",
            payload: { session_id: session.session_key },
          } as never,
          deps,
        ),
      ),
    );
    expect(initialSession.session.messages.at(-1)?.role).toBe("user");

    const pausedSession = await waitFor(async () => {
      const result = WsChatSessionGetResult.parse(
        readOkResult(
          await handleAiSdkChatMessage(
            client!,
            {
              request_id: "req-get-2",
              type: "chat.session.get",
              payload: { session_id: session.session_key },
            } as never,
            deps,
          ),
        ),
      );
      const assistantMessage = result.session.messages.findLast(
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

    expect(pausedSession.session.messages.some((message) => message.role === "user")).toBe(true);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("persists the latest partial assistant snapshot when the stream errors", async () => {
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

    const session = await container.sessionDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-error",
      containerKind: "channel",
    });

    const runtime = {
      turnStream: vi.fn(async () => ({
        finalize: vi.fn(async () => undefined),
        streamResult: {
          toUIMessageStream: () =>
            createErroredChunkStream(
              [
                { type: "text-start", id: "text-1" },
                { type: "text-delta", id: "text-1", delta: "partial reply" },
              ],
              new Error("boom"),
            ),
        },
      })),
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
        type: "chat.session.send",
        payload: {
          session_id: session.session_key,
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

    const erroredSession = await waitFor(async () => {
      const result = WsChatSessionGetResult.parse(
        readOkResult(
          await handleAiSdkChatMessage(
            client!,
            {
              request_id: "req-get-3",
              type: "chat.session.get",
              payload: { session_id: session.session_key },
            } as never,
            deps,
          ),
        ),
      );
      const assistantMessage = result.session.messages.findLast(
        (message) => message.role === "assistant",
      );
      const textPart = assistantMessage?.parts.find((part) => part.type === "text");
      return textPart?.text === "partial reply" ? result : undefined;
    });

    expect(erroredSession.session.messages.at(-1)?.role).toBe("assistant");
  });

  it("persists uploaded chat files as artifact records before linking them to the session", async () => {
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

    const session = await container.sessionDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "ui-thread-upload",
      containerKind: "channel",
    });

    const runtime = {
      turnStream: vi.fn(async () => ({
        finalize: vi.fn(async () => undefined),
        streamResult: {
          toUIMessageStream: () => createChunkStream([]),
        },
      })),
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
        type: "chat.session.send",
        payload: {
          session_id: session.session_key,
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
    expect(runtime.turnStream).toHaveBeenCalledWith(
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
      const candidate = await container?.sessionDal.getById({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
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
      [session.tenant_id, artifactId],
    );
    expect(artifactRow).toEqual({
      agent_id: session.agent_id,
      workspace_id: session.workspace_id,
      filename: "hello.txt",
      mime_type: "text/plain",
    });

    const links = await container.db.all<{ parent_id: string; parent_kind: string }>(
      `SELECT parent_kind, parent_id
       FROM artifact_links
       WHERE tenant_id = ? AND artifact_id = ?
       ORDER BY parent_kind ASC, parent_id ASC`,
      [session.tenant_id, artifactId],
    );
    expect(links).toEqual([
      { parent_kind: "chat_message", parent_id: "user-upload-1" },
      { parent_kind: "chat_session", parent_id: session.session_id },
    ]);
  });
});
