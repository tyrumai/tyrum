import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import { buildAgentTurnKey } from "../../src/modules/agent/turn-key.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createStubLanguageModel } from "./stub-language-model.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  seedAgentConfig,
} from "./agent-runtime.test-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function hasWorkboardCaptureResult(options: LanguageModelV3CallOptions): boolean {
  return (options.prompt ?? []).some(
    (entry) =>
      entry.role === "tool" &&
      Array.isArray(entry.content) &&
      entry.content.some(
        (part) =>
          Boolean(part) &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "tool-result" &&
          (part as { toolName?: unknown }).toolName === "workboard.capture",
      ),
  );
}

function createWorkboardCaptureLanguageModel(): LanguageModelV3 {
  const captureArgs = JSON.stringify({
    kind: "initiative",
    title: "Retro 90s games website",
    request: "Build a retro 90s games style website that opens directly in a browser.",
  });
  const reply = "Captured retro work.";

  const buildResponse = (
    options: LanguageModelV3CallOptions,
  ): { kind: "text"; text: string } | { kind: "tool-call"; input: string } =>
    hasWorkboardCaptureResult(options)
      ? { kind: "text", text: reply }
      : { kind: "tool-call", input: captureArgs };

  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "workboard-capture",
    supportedUrls: {},
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const response = buildResponse(options);
      return {
        content:
          response.kind === "tool-call"
            ? [
                {
                  type: "tool-call" as const,
                  toolCallId: "tc-workboard-capture",
                  toolName: "workboard.capture",
                  input: response.input,
                },
              ]
            : [{ type: "text" as const, text: response.text }],
        finishReason: {
          unified: response.kind === "tool-call" ? ("tool-calls" as const) : ("stop" as const),
          raw: undefined,
        },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream(options): Promise<LanguageModelV3StreamResult> {
      const response = buildResponse(options);
      return {
        stream: simulateReadableStream({
          chunks:
            response.kind === "tool-call"
              ? [
                  {
                    type: "tool-call" as const,
                    toolCallId: "tc-workboard-capture",
                    toolName: "workboard.capture",
                    input: response.input,
                  },
                  {
                    type: "finish" as const,
                    finishReason: { unified: "tool-calls" as const, raw: undefined },
                    logprobs: undefined,
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
                  },
                ]
              : [
                  { type: "text-start" as const, id: "text-1" },
                  { type: "text-delta" as const, id: "text-1", delta: response.text },
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
                        total: 5,
                        text: 5,
                        reasoning: undefined,
                      },
                    },
                  },
                ],
        }),
        warnings: [],
      };
    },
  };
}

describe("AgentRuntime.turnStream", () => {
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

  it("returns the streamed reply", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-stream-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "  loop_detection:",
        "    within_turn:",
        "      enabled: true",
        "      consecutive_repeat_limit: 3",
        "      cycle_repeat_limit: 3",
        "    cross_turn:",
        "      enabled: false",
        "      window_assistant_messages: 3",
        "      similarity_threshold: 0.97",
        "      min_chars: 120",
        "      cooldown_assistant_messages: 6",
        "memory:",
        "  v1: { enabled: false }",
      ].join("\n"),
      "utf-8",
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
    });

    const { finalize } = await runtime.turnStream({
      channel: "test",
      thread_id: "thread-stream-1",
      message: "hi",
    });

    const result = await finalize();
    expect(result.reply).toBe("hello");
    expect(result.used_tools).toEqual([]);
  }, 10_000);

  it("refreshes managed desktop activity for streamed turns", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-stream-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "  loop_detection:",
        "    within_turn:",
        "      enabled: true",
        "      consecutive_repeat_limit: 3",
        "      cycle_repeat_limit: 3",
        "    cross_turn:",
        "      enabled: false",
        "      window_assistant_messages: 3",
        "      similarity_threshold: 0.97",
        "      min_chars: 120",
        "      cooldown_assistant_messages: 6",
        "memory:",
        "  v1: { enabled: false }",
      ].join("\n"),
      "utf-8",
    );

    const hostDal = new DesktopEnvironmentHostDal(container.db);
    await hostDal.upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    const environmentDal = new DesktopEnvironmentDal(container.db);
    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "stream-managed-desktop",
      imageRef: "ghcr.io/example/workboard-desktop:test",
      desiredRunning: true,
    });
    await environmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "node-1",
    });
    const sessionKey = buildAgentTurnKey({
      agentId: "default",
      workspaceId: "default",
      channel: "test",
      containerKind: "channel",
      threadId: "thread-stream-managed-desktop",
    });
    await new SessionLaneNodeAttachmentDal(container.db).upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: sessionKey,
      lane: "main",
      desktopEnvironmentId: environment.environment_id,
      attachedNodeId: "node-1",
      lastActivityAtMs: 1,
      updatedAtMs: 1,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
    });

    const handle = await runtime.turnStream({
      channel: "test",
      thread_id: "thread-stream-managed-desktop",
      message: "hi",
    });
    await handle.finalize();

    await expect(
      new SessionLaneNodeAttachmentDal(container.db).get({
        tenantId: DEFAULT_TENANT_ID,
        key: sessionKey,
        lane: "main",
      }),
    ).resolves.toMatchObject({
      desktop_environment_id: environment.environment_id,
      attached_node_id: "node-1",
      last_activity_at_ms: expect.any(Number),
    });
    const refreshed = await new SessionLaneNodeAttachmentDal(container.db).get({
      tenantId: DEFAULT_TENANT_ID,
      key: sessionKey,
      lane: "main",
    });
    expect(refreshed?.last_activity_at_ms).toBeGreaterThan(1);
  }, 10_000);

  it("publishes the context report before stream finalization", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-stream-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow: []",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "  loop_detection:",
        "    within_turn:",
        "      enabled: true",
        "      consecutive_repeat_limit: 3",
        "      cycle_repeat_limit: 3",
        "    cross_turn:",
        "      enabled: false",
        "      window_assistant_messages: 3",
        "      similarity_threshold: 0.97",
        "      min_chars: 120",
        "      cooldown_assistant_messages: 6",
        "memory:",
        "  v1: { enabled: false }",
      ].join("\n"),
      "utf-8",
    );

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
    });

    const handle = await runtime.turnStream({
      channel: "test",
      thread_id: "thread-stream-context",
      message: "hi",
    });

    expect(handle.sessionId).toBeTruthy();
    expect(runtime.getLastContextReport()).toMatchObject({
      session_id: handle.sessionId,
      thread_id: "thread-stream-context",
      channel: "test",
    });

    await handle.finalize();
  }, 10_000);

  it("backfills a work_session_key for streamed workboard capture", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-stream-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: ["workboard.capture"] },
        sessions: {
          ttl_days: 30,
          max_turns: 20,
          loop_detection: {
            within_turn: {
              enabled: true,
              consecutive_repeat_limit: 3,
              cycle_repeat_limit: 3,
            },
            cross_turn: {
              enabled: false,
              window_assistant_messages: 3,
              similarity_threshold: 0.97,
              min_chars: 120,
              cooldown_assistant_messages: 6,
            },
          },
        },
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createWorkboardCaptureLanguageModel(),
      policyService: {
        isEnabled: () => false,
        isObserveOnly: () => false,
        evaluateToolCall: async () => ({
          decision: "allow" as const,
          applied_override_ids: [],
        }),
      } as never,
    });

    const handle = await runtime.turnStream({
      channel: "ui",
      thread_id: "thread-stream-capture",
      message: "Capture this for later.",
    });
    const result = await handle.finalize();

    expect(result.reply).toBe("Captured retro work.");
    expect(result.used_tools).toEqual(["workboard.capture"]);
    const workboard = new WorkboardDal(container.db);
    const { items } = await workboard.listItems({
      scope: {
        tenant_id: DEFAULT_TENANT_ID,
        agent_id: DEFAULT_AGENT_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.created_from_session_key).toBe(
      buildAgentTurnKey({
        agentId: "default",
        workspaceId: "default",
        channel: "ui",
        containerKind: "channel",
        threadId: "thread-stream-capture",
      }),
    );
  }, 10_000);
});
