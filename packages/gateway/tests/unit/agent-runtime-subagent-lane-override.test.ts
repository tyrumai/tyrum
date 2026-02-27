import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import type { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime (subagent lane override)", () => {
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

  it("does not override execution key when lane is not subagent", async () => {
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

    const engine = (runtime as unknown as { executionEngine: ExecutionEngine }).executionEngine;
    const enqueueSpy = vi.spyOn(engine, "enqueuePlan");

    const metadataKey = `agent:default:subagent:${randomUUID()}`;
    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
      metadata: { tyrum_key: metadataKey, lane: "main" },
    });

    expect(enqueueSpy).toHaveBeenCalled();
    const enqueueInput = enqueueSpy.mock.calls[0]?.[0] as { key?: string } | undefined;
    expect(enqueueInput?.key).not.toBe(metadataKey);
  });

  it("does not override execution key when subagent key agent id does not match runtime", async () => {
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

    const engine = (runtime as unknown as { executionEngine: ExecutionEngine }).executionEngine;
    const enqueueSpy = vi.spyOn(engine, "enqueuePlan");

    const metadataKey = `agent:other:subagent:${randomUUID()}`;
    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
      metadata: { tyrum_key: metadataKey, lane: "subagent" },
    });

    expect(enqueueSpy).toHaveBeenCalled();
    const enqueueInput = enqueueSpy.mock.calls[0]?.[0] as { key?: string } | undefined;
    expect(enqueueInput?.key).not.toBe(metadataKey);
  });

  it("overrides execution key/lane for valid subagent metadata scope", async () => {
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

    const engine = (runtime as unknown as { executionEngine: ExecutionEngine }).executionEngine;
    const enqueueSpy = vi.spyOn(engine, "enqueuePlan");

    const metadataKey = `agent:default:subagent:${randomUUID()}`;
    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
      metadata: { tyrum_key: metadataKey, lane: "subagent" },
    });

    expect(enqueueSpy).toHaveBeenCalled();
    const enqueueInput = enqueueSpy.mock.calls[0]?.[0] as
      | { key?: string; lane?: string }
      | undefined;
    expect(enqueueInput?.key).toBe(metadataKey);
    expect(enqueueInput?.lane).toBe("subagent");
  });
});
