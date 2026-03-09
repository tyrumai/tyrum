import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { buildToolSet } from "../../src/modules/execution/gateway-step-executor-tool-set.js";
import { createStubLanguageModel } from "./stub-language-model.js";

describe("gateway step executor tool set", () => {
  it("runs the extraction pass for webfetch(mode=extract)", async () => {
    const toolExecutor = {
      execute: vi.fn(async () => ({
        success: true,
        result: {
          ok: true,
          type: "Mcp",
          server_id: "exa",
          tool_name: "crawling_exa",
          output: "raw crawl body",
        },
      })),
    };

    const toolSet = buildToolSet({
      planId: "plan-1",
      stepIndex: 0,
      timeoutMs: 5_000,
      allowedToolIds: ["webfetch"],
      maxToolCalls: 2,
      toolExecutor: toolExecutor as never,
      toolBudget: { toolCallsUsed: 0, countedToolCallIds: new Set<string>() },
      executionContext: {
        tenantId: DEFAULT_TENANT_ID,
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        agentId: null,
        key: "default",
        lane: "main",
        workspaceId: DEFAULT_WORKSPACE_ID,
        policySnapshotId: null,
      },
      container: {
        db: { get: vi.fn() },
        logger: { warn: vi.fn(), info: vi.fn() },
      } as never,
      languageModel: createStubLanguageModel("## Extracted\n- grounded summary"),
      toolCallPolicyStates: new Map(),
    });

    const result = (await toolSet["webfetch"]!.execute(
      {
        url: "https://example.com",
        mode: "extract",
        prompt: "Summarize the page",
      },
      { toolCallId: "tc-webfetch-1", messages: [] } as never,
    )) as Record<string, unknown>;

    expect(result["output"]).toEqual(expect.stringContaining("grounded summary"));
    expect(result["output"]).toEqual(expect.stringContaining('<data source="web">'));
    expect(result["output"]).not.toEqual(expect.stringContaining("raw crawl body"));
  });
});
