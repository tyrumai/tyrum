import { afterEach, describe } from "vitest";
import { registerToolLoopApprovalTests } from "./tool-loop.approval.test-support.js";
import { registerToolLoopCoreTests } from "./tool-loop.core.test-support.js";
import { cleanupToolLoopTestState, createToolLoopTestState } from "./tool-loop.test-support.js";

describe("Tool execution loop", () => {
  const state = createToolLoopTestState();

  afterEach(async () => {
    await cleanupToolLoopTestState(state);
  });

  registerToolLoopCoreTests(state);
  registerToolLoopApprovalTests(state);
});
