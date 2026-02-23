import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime system prompt sandbox section", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;
  const originalHardeningProfile = process.env["TYRUM_TOOLRUNNER_HARDENING_PROFILE"];

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }

    if (originalHardeningProfile === undefined) {
      delete process.env["TYRUM_TOOLRUNNER_HARDENING_PROFILE"];
    } else {
      process.env["TYRUM_TOOLRUNNER_HARDENING_PROFILE"] = originalHardeningProfile;
    }
  });

  it("includes hardening profile and elevated execution availability", async () => {
    process.env["TYRUM_TOOLRUNNER_HARDENING_PROFILE"] = "hardened";

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-sandbox-prompt-"));
    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    let capturedSystem: string | undefined;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const call = options as LanguageModelV3CallOptions;
        const system = call.prompt.find((m) => m.role === "system");
        capturedSystem = system?.role === "system" ? system.content : undefined;

        return {
          content: [{ type: "text" as const, text: "hello" }],
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
      doStream: async () => {
        throw new Error("not implemented");
      },
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      getStatus: async () => ({
        enabled: true,
        observe_only: false,
        effective_sha256: "policy-sha",
        sources: { deployment: "default", agent: null },
      }),
      loadEffectiveBundle: async () => ({
        bundle: {
          v: 1 as const,
          tools: {
            default: "allow" as const,
          },
        },
        sha256: "policy-sha",
        sources: { deployment: "default", agent: null, playbook: null },
      }),
    } as unknown as ConstructorParameters<typeof AgentRuntime>[0]["policyService"];

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: model,
      fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
      policyService,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    expect(result.reply).toBe("hello");
    expect(capturedSystem).toContain("Sandbox:");
    expect(capturedSystem).toContain("Hardening profile: hardened");
    expect(capturedSystem).toContain("Elevated execution available: true");
  });
});

