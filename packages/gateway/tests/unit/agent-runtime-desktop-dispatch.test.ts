import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import {
  seedAgentConfig,
  teardownTestEnv,
  fetch404,
  DEFAULT_TENANT_ID,
  migrationsDir,
} from "./agent-runtime.test-helpers.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import { MockLanguageModelV3 } from "ai/test";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";

describe("AgentRuntime - desktop dispatch", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("executes tool.node.dispatch Desktop snapshot during a turn and returns artifact refs without base64", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: ["tool.node.dispatch"] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { v1: { enabled: false } },
      },
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "allow" as const })),
    };

    const connectionManager = new ConnectionManager();
    const taskResults = new TaskResultRegistry();

    const bytesBase64 = Buffer.from("desktop-bytes-should-not-leak", "utf8").toString("base64");

    const nodeId = "node-1";
    const nodeWs = {
      send: vi.fn((raw: string) => {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect(parsed["type"]).toBe("task.execute");

        const payload = parsed["payload"];
        expect(payload).toBeTruthy();
        expect(payload).toSatisfy(
          (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value),
          "payload is an object",
        );

        const payloadObj = payload as Record<string, unknown>;
        const action = payloadObj["action"];
        expect(action).toBeTruthy();
        expect(action).toSatisfy(
          (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value),
          "payload.action is an object",
        );

        const actionObj = action as Record<string, unknown>;
        expect(actionObj["type"]).toBe("Desktop");

        const actionArgs = actionObj["args"];
        expect(actionArgs).toBeTruthy();
        expect(actionArgs).toSatisfy(
          (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value),
          "payload.action.args is an object",
        );
        const actionArgsObj = actionArgs as Record<string, unknown>;
        expect(actionArgsObj["op"]).toBe("snapshot");
        expect(actionArgsObj["include_tree"]).toBe(false);

        const requestId = parsed["request_id"];
        expect(requestId).toSatisfy(
          (value: unknown) => typeof value === "string" && value.trim().length > 0,
          "request_id is a non-empty string",
        );

        taskResults.resolve(requestId as string, {
          ok: true,
          result: { op: "snapshot" },
          evidence: {
            type: "snapshot",
            mime: "image/png",
            width: 1,
            height: 1,
            timestamp: new Date().toISOString(),
            bytesBase64,
          },
        });
      }),
      on: vi.fn(() => undefined as never),
      readyState: 1,
    };

    connectionManager.addClient(nodeWs as never, ["desktop"], {
      id: "conn-1",
      role: "node",
      deviceId: nodeId,
      authClaims: {
        token_kind: "device",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        device_id: nodeId,
        role: "node",
        scopes: [],
      },
      protocolRev: 2,
    });

    const pending = await container.nodePairingDal.upsertOnConnect({
      tenantId: DEFAULT_TENANT_ID,
      nodeId,
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["desktop"],
      nowIso: new Date().toISOString(),
    });
    const desktopDescriptorId = descriptorIdForClientCapability("desktop");
    await container.nodePairingDal.resolve({
      tenantId: DEFAULT_TENANT_ID,
      pairingId: pending.pairing_id,
      decision: "approved",
      trustLevel: "local",
      capabilityAllowlist: [
        {
          id: desktopDescriptorId,
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    });

    const usage = () => ({
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
    });

    let callCount = 0;
    const toolLoopModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-1",
                toolName: "tool.node.dispatch",
                input: JSON.stringify({
                  node_id: nodeId,
                  capability: "tyrum.desktop",
                  action: "Desktop",
                  args: { op: "snapshot", include_tree: false },
                }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        const safeMessages = (() => {
          const candidate =
            (options as unknown as { messages?: unknown; prompt?: unknown }).messages ??
            (options as unknown as { prompt?: unknown }).prompt ??
            options;
          try {
            const json = JSON.stringify(candidate);
            return typeof json === "string" ? json : String(candidate);
          } catch {
            return String(candidate);
          }
        })();

        expect(/artifact:\/\//.test(safeMessages) && !safeMessages.includes(bytesBase64)).toBe(
          true,
        );

        return {
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: toolLoopModel,
      fetchImpl: fetch404,
      policyService: policyService as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["policyService"],
      protocolDeps: {
        connectionManager,
        taskResults,
        nodePairingDal: container.nodePairingDal,
        db: container.db,
        logger: container.logger,
      } as never,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "take a desktop snapshot via node dispatch",
    });

    expect(result.reply).toBe("done");
    expect(result.used_tools).toContain("tool.node.dispatch");
    expect(nodeWs.send).toHaveBeenCalledTimes(1);

    const row = await container.db.get<{ uri: string }>(
      "SELECT uri FROM execution_artifacts WHERE kind = 'screenshot' LIMIT 1",
    );
    expect(row).toBeTruthy();
    expect(row?.uri?.startsWith("artifact://")).toBe(true);
  }, 20_000);
});
