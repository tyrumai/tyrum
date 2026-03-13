import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createGuardianDecisionLanguageModel } from "./stub-language-model.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  fetch404,
  seedAgentConfig,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

function usage() {
  return {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  };
}

describe("AgentRuntime guardian review mode", () => {
  let homeDir: string | undefined;
  let container: Awaited<ReturnType<typeof setupTestEnv>>["container"] | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    homeDir = undefined;
    container = undefined;
  });

  it("runs guardian review turns through the subagent lane without normal tools or memory writes", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: {
            memory: {
              enabled: false,
            },
          },
        },
        tools: { allow: ["bash", "read", "write"] },
        sessions: { ttl_days: 30, max_turns: 20 },
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createGuardianDecisionLanguageModel({
        decision: {
          decision: "approve",
          reason: "The request is narrowly scoped and safe to auto-approve.",
          risk_level: "low",
          risk_score: 12,
          evidence: { source: "unit-test" },
        },
      }),
      fetchImpl: fetch404,
    });
    const memoryCreateSpy = vi.spyOn(container.memoryV1Dal, "create");
    const workboard = new WorkboardDal(container.db);
    const subagentId = "guardian-subagent-1";
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;

    await workboard.createSubagent({
      scope,
      subagentId,
      subagent: {
        execution_profile: "reviewer_ro",
        session_key: `agent:default:subagent:${subagentId}`,
        lane: "subagent",
        status: "running",
      },
    });

    const result = await runtime.executeGuardianReview({
      channel: "subagent",
      thread_id: subagentId,
      message: 'Review this approval request.\n\n{"subject":{"approval_id":"approval-1"}}',
      metadata: {
        tyrum_key: `agent:default:subagent:${subagentId}`,
        lane: "subagent",
        subagent_id: subagentId,
        guardian_review: {
          subject_type: "approval",
          target_id: "approval-1",
        },
      },
    });

    expect(result.calls).toBe(1);
    expect(result.invalidCalls).toBe(0);
    expect(result.decision).toMatchObject({
      decision: "approve",
      reason: "The request is narrowly scoped and safe to auto-approve.",
      risk_level: "low",
      risk_score: 12,
    });
    expect(result.response.memory_written).toBe(false);
    expect(memoryCreateSpy).not.toHaveBeenCalled();
    expect(runtime.getLastContextReport()).toMatchObject({
      execution_profile: "reviewer_ro",
      selected_tools: [],
      system_prompt: {
        sections: [
          { id: "identity", chars: 0 },
          { id: "safety", chars: 0 },
          { id: "sandbox", chars: 0 },
        ],
      },
    });
  });

  it("forces the guardian decision tool and stops after the first valid decision", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: {
            memory: {
              enabled: false,
            },
          },
        },
        tools: { allow: ["bash", "read", "write"] },
        sessions: { ttl_days: 30, max_turns: 20 },
      },
    });

    let reviewRequests = 0;
    let titleRequests = 0;
    const languageModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const call = options as LanguageModelV3CallOptions;
        const system = call.prompt.find((part) => part.role === "system");
        const isTitlePrompt =
          system?.role === "system" && system.content.includes("Write a concise session title");
        if (isTitlePrompt) {
          titleRequests += 1;
          return {
            content: [{ type: "text" as const, text: "Guardian review title" }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        reviewRequests += 1;
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "tc-guardian-review",
              toolName: "guardian_review_decision",
              input: JSON.stringify({
                decision: "approve",
                reason: "This request is narrow and safe.",
                risk_level: "low",
                risk_score: 8,
              }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      fetchImpl: fetch404,
    });
    const workboard = new WorkboardDal(container.db);
    const subagentId = "guardian-subagent-2";
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;

    await workboard.createSubagent({
      scope,
      subagentId,
      subagent: {
        execution_profile: "reviewer_ro",
        session_key: `agent:default:subagent:${subagentId}`,
        lane: "subagent",
        status: "running",
      },
    });

    const result = await runtime.executeGuardianReview({
      channel: "subagent",
      thread_id: subagentId,
      message: 'Review this approval request.\n\n{"subject":{"approval_id":"approval-2"}}',
      metadata: {
        tyrum_key: `agent:default:subagent:${subagentId}`,
        lane: "subagent",
        subagent_id: subagentId,
        guardian_review: {
          subject_type: "approval",
          target_id: "approval-2",
        },
      },
    });

    expect(reviewRequests).toBe(1);
    expect(titleRequests).toBe(1);
    expect(result.calls).toBe(1);
    expect(result.invalidCalls).toBe(0);
    expect(result.decision).toMatchObject({
      decision: "approve",
      reason: "This request is narrow and safe.",
      risk_level: "low",
      risk_score: 8,
    });
  });
});
