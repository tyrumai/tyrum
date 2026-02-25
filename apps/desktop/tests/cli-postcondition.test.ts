import { describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import { CliProvider } from "../src/main/providers/cli-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCliAction(args: Record<string, unknown>, postcondition?: unknown): ActionPrimitive {
  return { type: "CLI", args, postcondition };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI postcondition evaluation", () => {
  const provider = new CliProvider(["echo", "node"], ["/tmp"]);

  it("evaluates json_path postcondition on JSON stdout", async () => {
    const result = await provider.execute(
      makeCliAction(
        { cmd: "echo", args: ['{"status":"ok","count":42}'] },
        { type: "json_path", path: "$.status", equals: "ok" },
      ),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.postcondition).toBeDefined();
    const report = evidence.postcondition as { passed: boolean };
    expect(report.passed).toBe(true);
  });

  it("fails when json_path postcondition doesn't match", async () => {
    const result = await provider.execute(
      makeCliAction(
        { cmd: "echo", args: ['{"status":"error"}'] },
        { type: "json_path", path: "$.status", equals: "ok" },
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("postcondition failed");
    const evidence = result.evidence as Record<string, unknown>;
    const report = evidence.postcondition as { passed: boolean };
    expect(report.passed).toBe(false);
  });

  it("skips postcondition when command fails", async () => {
    const result = await provider.execute(
      makeCliAction(
        { cmd: "node", args: ["-e", "process.exit(1)"] },
        { type: "json_path", path: "$.status", equals: "ok" },
      ),
    );
    expect(result.success).toBe(false);
    // Error is about the command failing, not the postcondition
    expect(result.error).toContain("Process exited with code 1");
    // postcondition should not be in evidence since it was not evaluated
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.postcondition).toBeUndefined();
  });

  it("handles non-JSON stdout gracefully", async () => {
    const result = await provider.execute(
      makeCliAction(
        { cmd: "echo", args: ["not json"] },
        { type: "json_path", path: "$.foo", equals: "bar" },
      ),
    );
    // Should fail because json context is missing
    expect(result.success).toBe(false);
    expect(result.error).toContain("postcondition error");
  });

  it("succeeds without postcondition (backwards compatible)", async () => {
    const result = await provider.execute(makeCliAction({ cmd: "echo", args: ["hello"] }));
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.postcondition).toBeUndefined();
  });
});
