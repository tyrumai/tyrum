import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ActionPrimitive } from "@tyrum/schemas";
import { createToolRunnerStepExecutor } from "../../src/modules/execution/toolrunner-step-executor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const largeResultEntrypoint = join(__dirname, "../fixtures/toolrunner/emit-large-step-result.mjs");

describe("ToolRunnerStepExecutor", () => {
  it("does not truncate valid large StepResult JSON over stdio transport", async () => {
    const executor = createToolRunnerStepExecutor({
      entrypoint: largeResultEntrypoint,
      env: {
        ...process.env,
        STEP_RESULT_BYTES: "300000",
      },
    });

    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: "echo",
        args: ["ignored"],
      },
    });

    const res = await executor.execute(action, "plan-large", 0, 2_000);
    expect(res.success).toBe(true);
    const result = res.result as { stdout?: string };
    expect(result.stdout?.length).toBe(300000);
  });
});
