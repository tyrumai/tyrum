import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import {
  createToolSetBuilder,
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  makeContextReport,
  migrationsDir,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";

describe("AgentRuntime memory approval rollout", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("reuses execution approvals when legacy and canonical public memory ids differ only by rollout alias", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "require_approval" as const })),
    };

    const toolSetBuilder = createToolSetBuilder({ home: homeDir, container, policyService });

    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "plan-1:step:0:tool_call:tc-memory",
      kind: "workflow_step",
      prompt: "Approve memory write",
      motivation: "Verify mixed memory rollout aliases resume the same approved execution.",
      context: {
        source: "agent-tool-execution",
        tool_id: "mcp.memory.write",
        tool_call_id: "tc-memory",
        tool_match_target: "mcp.memory.write",
      },
    });
    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
    });

    const toolDesc = {
      id: "memory.write",
      description: "Persist durable memory.",
      effect: "state_changing" as const,
      keywords: [],
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["note"] },
          body_md: { type: "string" },
        },
        required: ["kind", "body_md"],
        additionalProperties: false,
      },
    };

    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-memory",
        output: "stored",
        error: undefined,
        provenance: undefined,
      })),
    };

    const usedTools = new Set<string>();
    const toolSet = toolSetBuilder.buildToolSet(
      [toolDesc],
      toolExecutor,
      usedTools,
      {
        planId: "plan-1",
        conversationId: "conversation-1",
        channel: "test",
        threadId: "thread-1",
        execution: {
          turnId: "run-1",
          stepIndex: 0,
          stepId: "step-1",
          stepApprovalId: approval.approval_id,
        },
      },
      makeContextReport(),
    );

    await toolSet["memory.write"]!.execute({ kind: "note", body_md: "remember this" }, {
      toolCallId: "tc-memory",
    } as unknown);

    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(usedTools.has("memory.write")).toBe(true);
  });
});
