import { describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import { CliProvider } from "../src/main/providers/cli-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "CLI", args };
}

function makeProvider(
  allowedCommands = ["echo", "ls", "false"],
  allowedWorkingDirs = ["/tmp"],
) {
  return new CliProvider(allowedCommands, allowedWorkingDirs);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CliProvider", () => {
  // -- Capability field ------------------------------------------------------

  it("capability field is 'cli'", () => {
    const provider = makeProvider();
    expect(provider.capability).toBe("cli");
  });

  // -- Allowed command succeeds ----------------------------------------------

  it("allowed command succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["hello"] }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect((evidence.stdout as string).trim()).toBe("hello");
    expect(evidence.exit_code).toBe(0);
  });

  // -- Disallowed command rejected -------------------------------------------

  it("disallowed command rejected", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ cmd: "rm" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("not in the allowlist");
    expect(result.error).toContain("rm");
  });

  it("disallowed command allowed when enforcement disabled", async () => {
    const provider = new CliProvider([], [], false);
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["allowlist-off"] }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect((evidence.stdout as string).trim()).toBe("allowlist-off");
  });

  it("wildcard command allowlist entry permits any command", async () => {
    const provider = new CliProvider(["*"], [], true);
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["wildcard-pass"] }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect((evidence.stdout as string).trim()).toBe("wildcard-pass");
  });

  it("supports subcommand allowlist prefixes (allow node --version only)", async () => {
    const provider = new CliProvider(["node --version"], [], true);

    const allowed = await provider.execute(
      makeAction({ cmd: "node", args: ["--version"] }),
    );
    expect(allowed.success).toBe(true);

    const denied = await provider.execute(
      makeAction({ cmd: "node", args: ["--help"] }),
    );
    expect(denied.success).toBe(false);
    expect(denied.error).toContain("not in the allowlist");
  });

  // -- Missing cmd returns error ---------------------------------------------

  it("missing cmd returns error", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'cmd'");
  });

  // -- Working directory enforcement -----------------------------------------

  it("allowed cwd passes", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["cwd-test"], cwd: "/tmp" }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect((evidence.stdout as string).trim()).toBe("cwd-test");
  });

  it("disallowed cwd fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["nope"], cwd: "/etc" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not in the allowlist");
  });

  it("disallowed cwd allowed when enforcement disabled", async () => {
    const provider = new CliProvider([], [], false);
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["cwd-allowlist-off"], cwd: "/etc" }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect((evidence.stdout as string).trim()).toBe("cwd-allowlist-off");
  });

  it("subdirectory of allowed dir passes", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["sub"], cwd: "/tmp/sub" }),
    );
    // /tmp/sub is within /tmp so it should be allowed
    // The command itself may fail if /tmp/sub doesn't exist, but the
    // allowlist check should pass. We check that the error is NOT about
    // the working directory allowlist.
    if (!result.success) {
      expect(result.error).not.toContain("not in the allowlist");
    }
  });

  it("working directory wildcard allows any cwd", async () => {
    const provider = new CliProvider(["echo"], ["*"], true);
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["cwd-wildcard"], cwd: "/etc" }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect((evidence.stdout as string).trim()).toBe("cwd-wildcard");
  });

  it("sibling directory with shared prefix is rejected", async () => {
    const provider = makeProvider(undefined, ["/tmp"]);
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["nope"], cwd: "/tmpevil" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not in the allowlist");
  });

  // -- Non-zero exit code returns failure ------------------------------------

  it("non-zero exit code returns failure", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ cmd: "false" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("exited with code");
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.exit_code).not.toBe(0);
  });

  // -- Evidence shape --------------------------------------------------------

  it("evidence includes exit_code, stdout, stderr, duration_ms", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ cmd: "echo", args: ["evidence-check"] }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence).toHaveProperty("exit_code");
    expect(evidence).toHaveProperty("stdout");
    expect(evidence).toHaveProperty("stderr");
    expect(evidence).toHaveProperty("duration_ms");
    expect(typeof evidence.duration_ms).toBe("number");
    expect((evidence.duration_ms as number)).toBeGreaterThanOrEqual(0);
  });
});
