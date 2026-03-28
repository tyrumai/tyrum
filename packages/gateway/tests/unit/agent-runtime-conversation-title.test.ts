import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { migrationsDir } from "./agent-runtime.test-helpers.js";

describe("AgentRuntime conversation title generation", () => {
  let container: GatewayContainer | undefined;
  let homeDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await container?.db.close();
    container = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("generates a title after the first turn and does not overwrite it later", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-conversation-title-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir });

    let titleRequests = 0;
    const languageModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start" as const, id: "text-1" },
            {
              type: "text-delta" as const,
              id: "text-1",
              delta: "I will investigate the retry path.",
            },
            { type: "text-end" as const, id: "text-1" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 6,
                  text: 6,
                  reasoning: undefined,
                },
              },
            },
          ],
        }),
      }),
      doGenerate: async (options) => {
        const call = options as LanguageModelV3CallOptions;
        const system = call.prompt.find((part) => part.role === "system");
        const isTitlePrompt =
          system?.role === "system" &&
          system.content.includes("Write a concise conversation title");
        if (isTitlePrompt) {
          titleRequests += 1;
        }
        return {
          content: [
            {
              type: "text" as const,
              text:
                titleRequests === 1
                  ? "Investigate webhook retry failures"
                  : "This title should not replace the first one",
            },
          ],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: 5,
              text: 5,
              reasoning: undefined,
            },
          },
          warnings: [],
        };
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-conversation-title",
      message: "Please debug the webhook retry failure in production logs.",
    });

    let conversations = await container.conversationDal.list({ connectorKey: "test", limit: 10 });
    expect(conversations.conversations[0]?.title).toBe("Investigate webhook retry failures");

    await runtime.turn({
      channel: "test",
      thread_id: "thread-conversation-title",
      message: "Now check whether the backoff schedule is wrong too.",
    });

    conversations = await container.conversationDal.list({ connectorKey: "test", limit: 10 });
    expect(conversations.conversations[0]?.title).toBe("Investigate webhook retry failures");
    expect(titleRequests).toBe(1);
  });
});
