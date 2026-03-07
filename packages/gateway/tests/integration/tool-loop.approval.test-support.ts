import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createDbSecretProvider } from "../../src/modules/secret/create-secret-provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import {
  createFetchStub,
  createSequencedToolLoopLanguageModel,
  createTestRuntime,
  createToolLoopLanguageModel,
  defaultApprovalScope,
  execToolCall,
  fetchToolCall,
  findSuggestedOverride,
  readToolCall,
  resetToolLoopContainer,
  respondToApproval,
  seedAgentConfig,
  setupToolLoopTest,
  textStep,
  toolCallsStep,
  type ToolLoopTestState,
  waitForPendingApproval,
  writeToolCall,
} from "./tool-loop.test-support.js";

export function registerToolLoopApprovalTests(state: ToolLoopTestState): void {
  it("queues high-risk tool calls and resumes after approval", async () => {
    const { homeDir, container } = await setupToolLoopTest(state);
    const ids = await seedAgentConfig(container, {
      agentKey: "agent-test",
      workspaceKey: "ws-test",
      config: { tools: { allow: ["tool.exec"] } },
    });

    const runtime = createTestRuntime({
      container,
      home: homeDir,
      agentId: "agent-test",
      workspaceId: "ws-test",
      languageModel: createToolLoopLanguageModel({
        toolCalls: [execToolCall("tc-approve", "echo approved")],
        finalReply: "approved and executed",
      }),
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-1",
      message: "run command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");
    expect(pending.kind).toBe("workflow_step");
    expect(pending.agent_id).toBe(ids.agentId);
    expect(pending.workspace_id).toBe(ids.workspaceId);
    expect(pending.run_id).not.toBeNull();
    expect(pending.resume_token).toMatch(/^resume-/);
    expect(pending.status).toBe("pending");

    const res = await respondToApproval(container, pending.approval_id, {
      decision: "approved",
      reason: "approved in test",
    });
    expect(res.status).toBe(200);

    const result = await turnPromise;
    expect(result.reply).toBe("approved and executed");
    expect(result.used_tools).toContain("tool.exec");
  });

  it("does not re-request approval when an engine step already has an approved stepApprovalId", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.exec"] } } },
    });

    const toolCallId = "tc-already-approved";
    const command = "echo approved";
    const approval = await container.approvalDal.create({
      ...defaultApprovalScope,
      approvalKey: "tool-loop-already-approved",
      kind: "workflow_step",
      prompt: "Approve execution of 'tool.exec' (risk=high)",
      context: {
        source: "agent-tool-execution",
        tool_id: "tool.exec",
        tool_call_id: toolCallId,
        tool_match_target: command,
      },
    });
    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
      reason: "approved in test",
    });

    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createToolLoopLanguageModel({
        toolCalls: [execToolCall(toolCallId, command)],
        finalReply: "done",
      }),
    });

    const result = await (runtime as unknown as { turnDirect: Function }).turnDirect(
      { channel: "test", thread_id: "thread-resume-approved", message: "run command" },
      {
        execution: {
          planId: "plan-1",
          runId: "run-1",
          stepIndex: 0,
          stepId: "step-1",
          stepApprovalId: approval.approval_id,
        },
      },
    );

    expect(result.reply).toBe("done");
    expect(result.used_tools).toContain("tool.exec");
    expect(await container.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID })).toHaveLength(0);
  }, 10_000);

  it("preserves multi-step tool messages when pausing for approval", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.fs.read", "tool.exec"] } } },
    });
    const safeOutput = "SAFE_TOOL_OUTPUT_123";
    await writeFile(join(homeDir, "safe.txt"), safeOutput, "utf-8");

    const languageModel = createSequencedToolLoopLanguageModel([
      toolCallsStep(readToolCall("tc-read", "safe.txt")),
      toolCallsStep(execToolCall("tc-exec", "echo ok")),
      textStep("done"),
    ]);
    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel,
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-multistep",
      message: "read a file then run a command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");
    const res = await respondToApproval(container, pending.approval_id, {
      decision: "approved",
      reason: "approved in test",
    });
    expect(res.status).toBe(200);

    const result = await turnPromise;
    expect(result.reply).toBe("done");

    const finalCall = languageModel.doGenerateCalls.at(-1);
    expect(finalCall).toBeTruthy();
    expect(JSON.stringify(finalCall!.prompt)).toContain(safeOutput);
  }, 10_000);

  it("requires approval for tool.exec when driven by untrusted tool output", async () => {
    const { homeDir } = await setupToolLoopTest(state);
    const fetchUrl = "https://93.184.216.34";
    const bundlePath = join(homeDir, "policy.yml");
    await writeFile(
      bundlePath,
      [
        "v: 1",
        "tools:",
        "  default: deny",
        "  allow:",
        "    - tool.http.fetch",
        "    - tool.exec",
        "  require_approval: []",
        "  deny: []",
        "network_egress:",
        "  default: deny",
        "  allow:",
        `    - "${fetchUrl}/*"`,
        "  require_approval: []",
        "  deny: []",
        "provenance:",
        "  untrusted_shell_requires_approval: true",
        "",
      ].join("\n"),
      "utf-8",
    );

    const container = await resetToolLoopContainer(state, {
      containerOptions: { deploymentConfig: { policy: { bundlePath } } },
      seedConfig: {
        config: { tools: { allow: ["tool.http.fetch", "tool.exec"] } },
      },
    });

    const languageModel = createSequencedToolLoopLanguageModel([
      toolCallsStep(fetchToolCall("tc-fetch", fetchUrl)),
      toolCallsStep(execToolCall("tc-exec", "echo ok")),
      textStep("done"),
    ]);
    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel,
      fetchImpl: createFetchStub({ [fetchUrl]: { body: "example.com content" } }),
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-provenance-1",
      message: "fetch example.com then run a command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");
    const res = await respondToApproval(container, pending.approval_id, {
      decision: "approved",
      reason: "approved in test",
    });
    expect(res.status).toBe(200);

    const result = await turnPromise;
    expect(result.reply).toBe("done");
    expect(result.used_tools).toContain("tool.http.fetch");
    expect(result.used_tools).toContain("tool.exec");
  }, 10_000);

  it("does not corrupt tool approval resume state via redaction", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.fs.write"] } } },
    });

    const secret = "sk-test-secret-token-12345678901234567890";
    container.redactionEngine.registerSecrets([secret]);
    const secretProvider = await createDbSecretProvider({
      db: container.db,
      dbPath: ":memory:",
      tyrumHome: homeDir,
      tenantId: DEFAULT_TENANT_ID,
    });
    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createToolLoopLanguageModel({
        toolCalls: [writeToolCall("tc-write", "secret.txt", secret)],
        finalReply: "done",
      }),
      secretProvider,
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-redaction-resume",
      message: "write a file with secret content",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.fs.write");
    expect(JSON.stringify(pending.context)).not.toContain(secret);

    const res = await respondToApproval(container, pending.approval_id, {
      decision: "approved",
      reason: "approved in test",
    });
    expect(res.status).toBe(200);

    const result = await turnPromise;
    expect(result.reply).toBe("done");

    const content = await readFile(join(homeDir, "secret.txt"), "utf-8");
    expect(content).toBe(secret);
  }, 10_000);

  it("supports approve-always by creating a policy override that skips future approvals", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.exec"] } } },
    });
    const toolCalls = [execToolCall("tc-always", "echo hello")];

    const runtime1 = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createToolLoopLanguageModel({
        toolCalls,
        finalReply: "approved and executed",
      }),
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });
    const turn1Promise = runtime1.turn({
      channel: "test",
      thread_id: "thread-always-1",
      message: "run command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");
    const selectedOverride = findSuggestedOverride(pending);
    const res = await respondToApproval(
      container,
      pending.approval_id,
      {
        decision: "approved",
        mode: "always",
        overrides: [
          {
            tool_id: selectedOverride.tool_id,
            pattern: selectedOverride.pattern,
            workspace_id: selectedOverride.workspace_id,
          },
        ],
      },
      { includePolicyOverrideDal: true },
    );
    expect(res.status).toBe(200);

    const result1 = await turn1Promise;
    expect(result1.reply).toBe("approved and executed");
    expect(result1.used_tools).toContain("tool.exec");

    const overrides = await container.policyOverrideDal.list({
      tenantId: DEFAULT_TENANT_ID,
      agentId: pending.agent_id,
      toolId: "tool.exec",
    });
    expect(overrides.length).toBeGreaterThan(0);

    const runtime2 = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createToolLoopLanguageModel({
        toolCalls,
        finalReply: "executed without approval",
      }),
      approvalWaitMs: 1_000,
      approvalPollMs: 20,
    });
    const turn2Promise = runtime2.turn({
      channel: "test",
      thread_id: "thread-always-2",
      message: "run command again",
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const stillPending = await container.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(stillPending).toHaveLength(0);

    const result2 = await turn2Promise;
    expect(result2.reply).toBe("executed without approval");
    expect(result2.used_tools).toContain("tool.exec");
  });
}
