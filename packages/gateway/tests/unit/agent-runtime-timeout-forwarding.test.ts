import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import type { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

describe("AgentRuntime", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;

  afterEach(async () => {
    generateTextMock.mockReset();
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("forwards execution timeouts to generateText", async () => {
    const timeoutMs = 10_000;

    generateTextMock.mockResolvedValueOnce({
      text: "ok",
      steps: [],
    });

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
      languageModel: createStubLanguageModel("unused"),
      fetchImpl: fetch404,
      turnEngineWaitMs: 30_000,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    const engine = (runtime as unknown as { executionEngine: ExecutionEngine }).executionEngine;
    const engineAny = engine as unknown as Record<string, unknown>;
    const originalExecuteWithTimeout = engineAny["executeWithTimeout"];
    if (typeof originalExecuteWithTimeout !== "function") {
      throw new Error("expected ExecutionEngine.executeWithTimeout to exist");
    }

    engineAny["executeWithTimeout"] = async (...args: unknown[]) => {
      return await (originalExecuteWithTimeout as (...args: unknown[]) => Promise<unknown>).apply(engine, [
        args[0],
        args[1],
        args[2],
        args[3],
        timeoutMs,
      ]);
    };

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    expect(res.reply).toBe("ok");
    expect(generateTextMock).toHaveBeenCalledOnce();
    expect(generateTextMock.mock.calls[0]?.[0]).toMatchObject({ timeout: timeoutMs });
  });
});
