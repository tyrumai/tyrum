import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");
const TEST_TIMEOUT_MS = 15_000;

async function loadLatestConversationKey(container: GatewayContainer): Promise<string | undefined> {
  return (
    await container.db.get<{ conversation_key: string }>(
      `SELECT conversation_key
         FROM turn_jobs
         ORDER BY rowid DESC
         LIMIT 1`,
    )
  )?.conversation_key;
}

describe("AgentRuntime (subagent queue target override)", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it(
    "does not override execution key when the metadata key is not a subagent conversation",
    async () => {
      const { createContainer } = await import("../../src/container.js");
      const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

      homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
      container = await createContainer({
        dbPath: ":memory:",
        migrationsDir,
      });

      const runtime = new AgentRuntime({
        container,
        home: homeDir,
        languageModel: createStubLanguageModel("ok"),
        fetchImpl: fetch404,
        turnEngineWaitMs: 30_000,
      } as ConstructorParameters<typeof AgentRuntime>[0]);
      const metadataKey = `agent:default:main:${randomUUID()}`;
      await runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
        metadata: { tyrum_key: metadataKey },
      });

      expect(await loadLatestConversationKey(container)).not.toBe(metadataKey);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does not override execution key when subagent key agent id does not match runtime",
    async () => {
      const { createContainer } = await import("../../src/container.js");
      const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

      homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
      container = await createContainer({
        dbPath: ":memory:",
        migrationsDir,
      });

      const runtime = new AgentRuntime({
        container,
        home: homeDir,
        languageModel: createStubLanguageModel("ok"),
        fetchImpl: fetch404,
        turnEngineWaitMs: 30_000,
      } as ConstructorParameters<typeof AgentRuntime>[0]);
      const metadataKey = `agent:other:subagent:${randomUUID()}`;
      await runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
        metadata: { tyrum_key: metadataKey },
      });

      expect(await loadLatestConversationKey(container)).not.toBe(metadataKey);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "falls back to the default work conversation key for malformed subagent queue keys",
    async () => {
      const { createContainer } = await import("../../src/container.js");
      const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

      homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
      container = await createContainer({
        dbPath: ":memory:",
        migrationsDir,
      });

      const runtime = new AgentRuntime({
        container,
        home: homeDir,
        languageModel: createStubLanguageModel("ok"),
        fetchImpl: fetch404,
        turnEngineWaitMs: 30_000,
      } as ConstructorParameters<typeof AgentRuntime>[0]);
      const metadataKey = "agent:default:subagent:bad:key";
      const expectedKey = "agent:default:test:default:channel:thread-1";
      await runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
        metadata: { tyrum_key: metadataKey },
      });

      expect(await loadLatestConversationKey(container)).toBe(expectedKey);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "overrides execution key for a valid subagent conversation key",
    async () => {
      const { createContainer } = await import("../../src/container.js");
      const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");

      homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
      container = await createContainer({
        dbPath: ":memory:",
        migrationsDir,
      });

      const runtime = new AgentRuntime({
        container,
        home: homeDir,
        languageModel: createStubLanguageModel("ok"),
        fetchImpl: fetch404,
        turnEngineWaitMs: 30_000,
      } as ConstructorParameters<typeof AgentRuntime>[0]);
      const metadataKey = `agent:default:subagent:${randomUUID()}`;
      await runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
        metadata: { tyrum_key: metadataKey },
      });

      expect(await loadLatestConversationKey(container)).toBe(metadataKey);
    },
    TEST_TIMEOUT_MS,
  );
});
