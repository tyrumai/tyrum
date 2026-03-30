import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WsConversationGetResult } from "@tyrum/contracts";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { handleAiSdkChatMessage } from "../../src/ws/protocol/ai-sdk-chat-ops.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { createSpyLogger, makeClient, makeDeps } from "./ws-protocol.test-support.js";
import { readOkResult } from "./ai-sdk-chat-ops.test-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("ai-sdk chat ops tool message normalization", () => {
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

  it("normalizes persisted raw tool call and result messages when loading a conversation", async () => {
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
      providerThreadId: "ui-thread-persisted-tool",
      containerKind: "channel",
    });

    await container.conversationDal.replaceMessages({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "search docs" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "text", text: "Searching now" },
            {
              type: "tool-call",
              toolCallId: "tc-websearch-1",
              toolName: "websearch",
              input: { query: "latest docs" },
              title: "Web Search",
            },
          ],
        },
        {
          id: "tool-1",
          role: "tool",
          parts: [
            {
              type: "tool-result",
              toolCallId: "tc-websearch-1",
              toolName: "websearch",
              input: { query: "latest docs" },
              output: { hits: 3 },
              title: "Web Search",
            },
          ],
        },
      ],
    });

    const deps = makeDeps(connectionManager, {
      db: container.db,
      logger: createSpyLogger(),
      redactionEngine: container.redactionEngine,
    });

    const loadedConversation = WsConversationGetResult.parse(
      readOkResult(
        await handleAiSdkChatMessage(
          client!,
          {
            request_id: "req-get-normalized-1",
            type: "conversation.get",
            payload: { conversation_id: conversation.conversation_key },
          } as never,
          deps,
        ),
      ),
    );

    expect(loadedConversation.conversation.messages).toHaveLength(2);
    expect(
      loadedConversation.conversation.messages.some((message) => message.role === "tool"),
    ).toBe(false);
    expect(loadedConversation.conversation.messages[1]).toMatchObject({
      role: "assistant",
      parts: [
        { type: "text", text: "Searching now" },
        {
          type: "tool-websearch",
          toolCallId: "tc-websearch-1",
          state: "output-available",
          input: { query: "latest docs" },
          output: { hits: 3 },
          title: "Web Search",
        },
      ],
    });
  });
});
