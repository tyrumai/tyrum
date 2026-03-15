import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { GatewayContainer } from "../../src/container.js";
import { createStubLanguageModel } from "./stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const generateTextMock = vi.hoisted(() => vi.fn());
const TITLE_PROMPT_TEXT = "Write a concise session title.";

function isTitleGenerateRequest(value: unknown): boolean {
  return (
    typeof (value as { system?: unknown } | undefined)?.system === "string" &&
    ((value as { system: string }).system.includes(TITLE_PROMPT_TEXT) ?? false)
  );
}

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

  it(
    "passes an abortSignal to generateText for execution timeouts",
    async () => {
    generateTextMock.mockImplementation(async (input) => ({
      text: isTitleGenerateRequest(input) ? "Generated session title" : "ok",
      steps: [],
    }));

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

    const res = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    expect(res.reply).toBe("ok");
    const call = generateTextMock.mock.calls
      .map(([first]) => first)
      .find((entry) => !isTitleGenerateRequest(entry)) as { abortSignal?: AbortSignal } | undefined;
    expect(call).toBeDefined();
    expect(call?.abortSignal).toBeInstanceOf(AbortSignal);
    },
    15_000,
  );
});
