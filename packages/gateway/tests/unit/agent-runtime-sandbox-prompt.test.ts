import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime system prompt sandbox section", () => {
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

  it("uses a neutral sandbox prompt", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-sandbox-prompt-"));
    container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir,
      },
      {
        deploymentConfig: {
          toolrunner: { hardeningProfile: "hardened" },
        },
      },
    );

    let capturedSystem: string | undefined;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const call = options as LanguageModelV3CallOptions;
        const system = call.prompt.find((m) => m.role === "system");
        const systemText = system?.role === "system" ? system.content : undefined;
        if (systemText && !systemText.includes("Write a concise session title")) {
          capturedSystem = systemText;
        }

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
    expect(capturedSystem).toContain("Execution constraints are enforced by the gateway.");
    expect(capturedSystem).toContain("hardening_profile=hardened");
    expect(capturedSystem).toContain("managed_desktop_attached=false");
  });

  it("keeps the sandbox prompt stable when policy resolution fails", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-sandbox-prompt-unknown-"));
    container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir,
      },
      {
        deploymentConfig: {
          toolrunner: { hardeningProfile: "hardened" },
        },
      },
    );

    let capturedSystem: string | undefined;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const call = options as LanguageModelV3CallOptions;
        const system = call.prompt.find((m) => m.role === "system");
        const systemText = system?.role === "system" ? system.content : undefined;
        if (systemText && !systemText.includes("Write a concise session title")) {
          capturedSystem = systemText;
        }

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
      loadEffectiveBundle: async () => {
        throw new Error("bundle unavailable");
      },
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
      thread_id: "thread-unknown",
      message: "hello",
    });

    expect(result.reply).toBe("hello");
    expect(capturedSystem).toContain("Sandbox:");
    expect(capturedSystem).toContain("Execution constraints are enforced by the gateway.");
    expect(capturedSystem).toContain("hardening_profile=hardened");
    expect(capturedSystem).toContain("managed_desktop_attached=false");
  });

  it("includes managed desktop attachment details when the current lane owns one", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-sandbox-prompt-attached-"));
    container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir,
      },
      {
        deploymentConfig: {
          toolrunner: { hardeningProfile: "hardened" },
        },
      },
    );
    await new DesktopEnvironmentHostDal(container.db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    const environment = await new DesktopEnvironmentDal(container.db).create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "Prompt desktop",
      imageRef: "ghcr.io/example/workboard-desktop:test",
      desiredRunning: true,
    });
    await new DesktopEnvironmentDal(container.db).updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "node-1",
    });
    await new SessionLaneNodeAttachmentDal(container.db).upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:test:default:channel:thread-attached",
      lane: "main",
      desktopEnvironmentId: environment.environment_id,
      attachedNodeId: "node-1",
      updatedAtMs: 1,
      lastActivityAtMs: 1,
    });

    let capturedSystem: string | undefined;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const call = options as LanguageModelV3CallOptions;
        const system = call.prompt.find((m) => m.role === "system");
        const systemText = system?.role === "system" ? system.content : undefined;
        if (systemText && !systemText.includes("Write a concise session title")) {
          capturedSystem = systemText;
        }

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
      thread_id: "thread-attached",
      message: "hello",
      metadata: {
        tyrum_key: "agent:default:test:default:channel:thread-attached",
        lane: "main",
      },
    });

    expect(result.reply).toBe("hello");
    expect(capturedSystem).toContain("managed_desktop_attached=true");
    expect(capturedSystem).toContain(`desktop_environment_id=${environment.environment_id}`);
    expect(capturedSystem).toContain("attached_node_id=node-1");
    expect(capturedSystem).toContain("exclusive_control=true");
    expect(capturedSystem).toContain("handoff_available=true");
  });
});
