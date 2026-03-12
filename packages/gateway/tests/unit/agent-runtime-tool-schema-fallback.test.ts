import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import {
  createToolSetBuilder,
  makeContextReport,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

describe("ToolSetBuilder schema fallback", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("builds and executes tools that omit inputSchema", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const toolSetBuilder = createToolSetBuilder({
      home: homeDir,
      container,
      policyService: {
        isEnabled: () => false,
        isObserveOnly: () => false,
      },
    });
    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-plugin-1",
        output: "ok",
      })),
    };

    const toolSet = toolSetBuilder.buildToolSet(
      [
        {
          id: "plugin.echo.say",
          description: "Echo text back to the caller.",
          risk: "low",
          requires_confirmation: false,
          keywords: ["echo"],
        },
      ],
      toolExecutor as never,
      new Set<string>(),
      {
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
      },
      makeContextReport() as never,
    );

    const result = await toolSet["plugin_echo_say"]?.execute({ text: "hello" });

    expect(result).toBe("ok");
    expect(toolExecutor.execute).toHaveBeenCalledWith(
      "plugin.echo.say",
      expect.any(String),
      { text: "hello" },
      expect.objectContaining({
        session_id: "session-1",
        channel: "test",
        thread_id: "thread-1",
      }),
    );
  });
});
