import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { AgentConfig } from "@tyrum/schemas";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { prepareTurn } from "../../src/modules/agent/runtime/turn-preparation.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function usage() {
  return {
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
  };
}

function createRuntimeLanguageModel(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: usage(),
      warnings: [],
    }),
  });
}

describe("turn preparation attachments", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("keeps resolved attachment summary text for file-only native turns", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-turn-prep-attachments-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const agentId = await container.identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
    await new AgentConfigDal(container.db).set({
      tenantId: DEFAULT_TENANT_ID,
      agentId,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        attachments: { input_mode: "native" },
      }),
      createdBy: { kind: "test" },
      reason: "turn preparation attachment regression test",
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createRuntimeLanguageModel(),
      mcpManager: {
        listToolDescriptors: vi.fn(async () => []),
        shutdown: vi.fn(async () => {}),
        callTool: vi.fn(async () => ({ content: [] })),
      } as ConstructorParameters<typeof AgentRuntime>[0]["mcpManager"],
    });

    const prepared = await prepareTurn((runtime as any).prepareTurnDeps, {
      channel: "test",
      thread_id: "thread-native-file-only",
      parts: [
        {
          type: "file",
          url: "https://example.com/screenshot.png",
          mediaType: "image/png",
          filename: "screenshot.png",
        },
      ],
    });

    expect(prepared.userContent.slice(-2)).toEqual([
      {
        type: "text",
        text: prepared.resolved.message,
      },
      {
        type: "file",
        data: "https://example.com/screenshot.png",
        mediaType: "image/png",
        filename: "screenshot.png",
      },
    ]);
    expect(prepared.resolved.message).toContain("Attachments:");
  });
});
