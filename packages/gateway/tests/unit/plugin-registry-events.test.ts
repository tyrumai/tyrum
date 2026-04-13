import { rm } from "node:fs/promises";
import { afterEach, describe, it } from "vitest";
import { emitPluginToolInvokedEvent } from "../../src/modules/plugins/registry-events.js";
import {
  createEchoPluginHome,
  createSilentLogger,
  expectToolInvokedAuditLinkage,
  getLastBroadcastEvent,
  withTestContainer,
} from "./plugin-registry.test-support.js";

describe("plugin registry event emission", () => {
  let home: string | undefined;

  afterEach(async () => {
    if (home) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it("canonicalizes supported legacy aliases before emitting plugin tool audit payloads", async () => {
    const fixture = await createEchoPluginHome();
    home = fixture.home;

    await withTestContainer(fixture.home, async (container) => {
      await emitPluginToolInvokedEvent(
        { logger: createSilentLogger(), container },
        {
          pluginId: "echo",
          pluginVersion: "1.0.0",
          toolId: "mcp.memory.write",
          toolCallId: "call-legacy-memory",
          agentId: "default",
          workspaceId: "default",
          auditPlanId: "agent-turn-test",
          outcome: "succeeded",
          durationMs: 12,
        },
      );

      const lastOutbox = await getLastBroadcastEvent(container);
      await expectToolInvokedAuditLinkage(container, lastOutbox, {
        planKey: "gateway.plugins.tool_invoked:agent-turn-test",
        pluginId: "echo",
        toolId: "memory.write",
        toolCallId: "call-legacy-memory",
      });
    });
  });
});
