import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { createGatewayStepExecutor } from "../../src/modules/execution/gateway-step-executor.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { MockLanguageModelV3 } from "ai/test";

vi.mock("../../src/modules/models/provider-factory.js", () => ({
  createProviderFromNpm: vi.fn(),
}));

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("gateway-step-executor", () => {
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

  const usage = () => ({
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  });

  it("treats template API providers as requiring configured accounts", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-gateway-step-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const cacheDal = new ModelsDevCacheDal(container.db);
    const nowIso = new Date().toISOString();
    await cacheDal.upsert({
      fetchedAt: nowIso,
      etag: null,
      sha256: "sha",
      json: JSON.stringify({
        "template-provider": {
          id: "template-provider",
          name: "Template Provider",
          env: [],
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.example.com/${ACCOUNT_ID}",
          models: {
            "model-1": {
              id: "model-1",
              name: "Model 1",
            },
          },
        },
      }),
      source: "remote",
      lastError: null,
      nowIso,
    });

    const executor = createGatewayStepExecutor({
      container,
      toolExecutor: {
        execute: vi.fn(async () => ({ success: true, result: { ok: true } })),
      },
    });

    await expect(
      executor.execute(
        {
          type: "Llm",
          args: {
            model: "template-provider/model-1",
            prompt: "Return JSON.",
            __playbook: {
              output: {
                type: "json",
                schema: { type: "object" },
              },
            },
          },
        },
        "plan-template-provider",
        0,
        5_000,
        {
          tenantId: DEFAULT_TENANT_ID,
          runId: "run-1",
          stepId: "step-1",
          attemptId: "attempt-1",
          approvalId: null,
          key: "agent:test",
          lane: "main",
          workspaceId: "default",
          policySnapshotId: null,
        },
      ),
    ).rejects.toThrow(
      "no active auth profiles with credentials configured for provider 'template-provider'",
    );
  });

  it("injects the output contract into llm step prompts", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-gateway-step-prompt-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: '{"status":"ok"}' }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }),
    });

    const executor = createGatewayStepExecutor({
      container,
      toolExecutor: {
        execute: vi.fn(async () => ({ success: true, result: { ok: true } })),
      },
      languageModel,
    });

    const result = await executor.execute(
      {
        type: "Llm",
        args: {
          model: "openai/gpt-4.1",
          prompt: "Summarize the run status.",
          __playbook: {
            output: {
              type: "json",
              schema: {
                type: "object",
                properties: {
                  status: { type: "string" },
                },
                required: ["status"],
                additionalProperties: false,
              },
            },
          },
        },
      },
      "plan-llm-prompt",
      0,
      5_000,
      {
        tenantId: DEFAULT_TENANT_ID,
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "agent:test",
        lane: "main",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result).toMatchObject({ success: true });
    const promptJson = JSON.stringify(languageModel.doGenerateCalls[0]?.prompt ?? []);
    expect(promptJson).toContain("Output contract:");
    expect(promptJson).toContain("Do not return prose, Markdown fences");
    expect(promptJson).toContain("status");
  });
});
