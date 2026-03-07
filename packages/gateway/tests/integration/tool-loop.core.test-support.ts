import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createStubLanguageModel } from "../unit/stub-language-model.js";
import {
  collectPromptToolIds,
  createSequencedToolLoopLanguageModel,
  createTestRuntime,
  createToolLoopLanguageModel,
  readToolCall,
  setupToolLoopTest,
  textStep,
  toolCallsStep,
  type ToolLoopTestState,
  writeFixtureFiles,
  fetchToolCall,
  createFetchStub,
  waitForPendingApproval,
  respondToApproval,
} from "./tool-loop.test-support.js";

export function registerToolLoopCoreTests(state: ToolLoopTestState): void {
  it("executes tool calls and returns the final reply", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.fs.read"] } } },
    });
    await writeFixtureFiles(homeDir, { "notes.txt": "important notes" });

    const languageModel = createToolLoopLanguageModel({
      toolCalls: [readToolCall("tc-1", "notes.txt")],
      finalReply: "I read the file, it says: important notes",
    });
    const runtime = createTestRuntime({ container, home: homeDir, languageModel });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "read the notes file",
    });

    expect(result.reply).toBe("I read the file, it says: important notes");
    expect(result.used_tools).toContain("tool.fs.read");
  }, 10_000);

  it("prunes older tool results from the model prompt deterministically", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.fs.read"] } } },
    });
    await writeFixtureFiles(homeDir, {
      "one.txt": "FIRST_TOOL_OUTPUT_123",
      "two.txt": "SECOND_TOOL_OUTPUT_456",
      "three.txt": "THIRD_TOOL_OUTPUT_789",
    });

    const languageModel = createSequencedToolLoopLanguageModel([
      toolCallsStep(readToolCall("tc-1", "one.txt")),
      toolCallsStep(readToolCall("tc-2", "two.txt")),
      toolCallsStep(readToolCall("tc-3", "three.txt")),
      textStep("done"),
    ]);
    const runtime = createTestRuntime({ container, home: homeDir, languageModel });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-pruning-1",
      message: "read three files",
    });

    expect(result.reply).toBe("done");
    const lastCall = languageModel.doGenerateCalls.at(-1);
    expect(lastCall).toBeTruthy();
    const promptText = JSON.stringify(lastCall!.prompt);
    expect(promptText).toContain("SECOND_TOOL_OUTPUT_456");
    expect(promptText).toContain("THIRD_TOOL_OUTPUT_789");
    expect(promptText).not.toContain("FIRST_TOOL_OUTPUT_123");
  });

  it("does not orphan tool call/result pairs when truncating history", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: {
        config: {
          tools: { allow: ["tool.fs.read"] },
          sessions: { context_pruning: { max_messages: 8, tool_prune_keep_last_messages: 7 } },
        },
      },
    });
    await writeFixtureFiles(homeDir, {
      "one.txt": "FIRST_TOOL_OUTPUT_123",
      "two.txt": "SECOND_TOOL_OUTPUT_456",
      "three.txt": "THIRD_TOOL_OUTPUT_789",
      "four.txt": "FOURTH_TOOL_OUTPUT_000",
    });

    const languageModel = createSequencedToolLoopLanguageModel([
      toolCallsStep(readToolCall("tc-1", "one.txt")),
      toolCallsStep(readToolCall("tc-2", "two.txt")),
      toolCallsStep(readToolCall("tc-3", "three.txt")),
      toolCallsStep(readToolCall("tc-4", "four.txt")),
      textStep("done"),
    ]);
    const runtime = createTestRuntime({ container, home: homeDir, languageModel });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-pruning-2",
      message: "read four files",
    });

    expect(result.reply).toBe("done");
    const lastCall = languageModel.doGenerateCalls.at(-1);
    expect(lastCall).toBeTruthy();

    const { toolCallIds, toolResultIds } = collectPromptToolIds(lastCall!.prompt);
    expect(toolResultIds.size).toBeGreaterThan(0);
    for (const toolCallId of toolResultIds) {
      expect(toolCallIds.has(toolCallId)).toBe(true);
    }
  });

  it("returns final reply when LLM returns no tool_calls (single-shot)", async () => {
    const { homeDir, container } = await setupToolLoopTest(state);
    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("just a reply"),
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-2",
      message: "hello",
    });

    expect(result.reply).toBe("just a reply");
    expect(result.used_tools).toEqual([]);
  });

  it("populates used_tools across multiple tool calls", async () => {
    const url = "https://example.com";
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: {
        config: { tools: { allow: ["tool.fs.read", "tool.http.fetch"] } },
      },
    });
    await writeFixtureFiles(homeDir, { "a.txt": "file A" });

    const languageModel = createToolLoopLanguageModel({
      toolCalls: [readToolCall("tc-1", "a.txt"), fetchToolCall("tc-2", url)],
      finalReply: "done with both tools",
    });
    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel,
      fetchImpl: createFetchStub({ [url]: { body: "example.com content" } }),
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-3",
      message: "read a file and fetch a url",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.http.fetch");
    const res = await respondToApproval(container, pending.approval_id, {
      decision: "approved",
      reason: "approved in test",
    });
    expect(res.status).toBe(200);

    const result = await turnPromise;
    expect(result.reply).toBe("done with both tools");
    expect(result.used_tools).toContain("tool.fs.read");
    expect(result.used_tools).toContain("tool.http.fetch");
    expect(result.used_tools).toHaveLength(2);
  });

  it("queues approval requests even when maxSteps is exhausted", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.exec"] } } },
    });

    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createToolLoopLanguageModel({
        toolCalls: [
          {
            id: "tc-budget",
            name: "tool.exec",
            arguments: JSON.stringify({ command: "echo approved" }),
          },
        ],
        finalReply: "approved and executed",
      }),
      maxSteps: 1,
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-maxsteps",
      message: "run command",
    });

    const pending = await waitForPendingApproval(container, 1_000);
    expect(pending.prompt).toContain("tool.exec");
    expect(pending.kind).toBe("workflow_step");

    const res = await respondToApproval(container, pending.approval_id, {
      decision: "approved",
      reason: "approved in test",
    });
    expect(res.status).toBe(200);

    const result = await turnPromise;
    expect(result.reply).toBe("No assistant response returned.");
  });

  it("respects maxSteps and stops looping", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: {
        config: {
          tools: { allow: ["tool.fs.read"] },
          sessions: {
            loop_detection: {
              within_turn: { enabled: false },
              cross_turn: { enabled: false },
            },
          },
        },
      },
    });
    await writeFixtureFiles(homeDir, { "loop.txt": "loop" });

    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createToolLoopLanguageModel({
        toolCalls: [readToolCall("tc-loop", "loop.txt")],
        finalReply: "ignored",
        mode: "infinite",
      }),
      maxSteps: 3,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-4",
      message: "run something",
    });

    expect(result.reply).toBe("No assistant response returned.");
    expect(result.used_tools).toContain("tool.fs.read");
  });

  it("detects and stops a within-turn tool loop (consecutive)", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.fs.read"] } } },
    });
    await writeFixtureFiles(homeDir, { "notes.txt": "important notes" });

    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createToolLoopLanguageModel({
        toolCalls: [readToolCall("tc-loop", "notes.txt")],
        finalReply: "ignored",
        mode: "infinite",
      }),
      maxSteps: 20,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-loop-detect-consecutive",
      message: "read the notes file",
    });

    expect(result.reply).toContain("Loop detected");
    expect(result.used_tools).toContain("tool.fs.read");
  });

  it("detects and stops a within-turn tool loop (cycle)", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.fs.read"] } } },
    });
    await writeFixtureFiles(homeDir, { "a.txt": "A", "b.txt": "B" });

    const languageModel = createSequencedToolLoopLanguageModel([
      toolCallsStep(readToolCall("tc-a-1", "a.txt")),
      toolCallsStep(readToolCall("tc-b-1", "b.txt")),
      toolCallsStep(readToolCall("tc-a-2", "a.txt")),
      toolCallsStep(readToolCall("tc-b-2", "b.txt")),
      toolCallsStep(readToolCall("tc-a-3", "a.txt")),
      toolCallsStep(readToolCall("tc-b-3", "b.txt")),
    ]);
    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel,
      maxSteps: 20,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-loop-detect-cycle",
      message: "read files repeatedly",
    });

    expect(result.reply).toContain("Loop detected");
    expect(result.used_tools).toContain("tool.fs.read");
  });

  it("does not execute high-risk tool when approval is denied", async () => {
    const { homeDir, container } = await setupToolLoopTest(state, {
      seedConfig: { config: { tools: { allow: ["tool.fs.write"] } } },
    });
    const runtime = createTestRuntime({
      container,
      home: homeDir,
      languageModel: createToolLoopLanguageModel({
        toolCalls: [
          {
            id: "tc-deny",
            name: "tool.fs.write",
            arguments: JSON.stringify({ path: "blocked.txt", content: "secret" }),
          },
        ],
        finalReply: "approval denied",
      }),
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-2",
      message: "write blocked file",
    });

    const pending = await waitForPendingApproval(container);
    const res = await respondToApproval(container, pending.approval_id, {
      decision: "denied",
      reason: "denied in test",
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { approval?: { status?: string } };
    expect(payload.approval?.status).toBe("denied");

    const result = await turnPromise;
    expect(result.reply).toBe("approval denied");
    expect(result.used_tools).not.toContain("tool.fs.write");
    await expect(access(join(homeDir, "blocked.txt"))).rejects.toThrow();
  });
}
