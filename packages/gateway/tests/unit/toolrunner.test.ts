import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runToolRunnerFromStdio } from "../../src/toolrunner.js";

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function suppressStderr() {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((chunk: any) => {
      writes.push(String(chunk));
      return true;
    }) as never);

  return {
    writes,
    restore: () => spy.mockRestore(),
  };
}

function captureStdout() {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((chunk: any) => {
      writes.push(String(chunk));
      return true;
    }) as never);

  return {
    writes,
    restore: () => spy.mockRestore(),
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  return Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("toolrunner", () => {
  it("returns 2 on invalid JSON payload", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({ payloadB64: b64url("not-json") });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("toolrunner input error");
  });

  it("returns 2 when plan_id/step_index are invalid", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "tenant-1",
          plan_id: "",
          step_index: -1,
          action: {},
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
  });

  it("returns 2 when action schema is invalid", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "tenant-1",
          turn_id: "run-1",
          step_id: "step-1",
          attempt_id: "attempt-1",
          key: "agent:test",
          workspace_id: "default",
          policy_snapshot_id: "policy-1",
          plan_id: "plan-1",
          step_index: 0,
          action: {},
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("invalid action");
  });

  it("returns 2 when tenant_id is missing", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          plan_id: "plan-1",
          step_index: 0,
          action: { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("missing/invalid tenant_id");
  });

  it("returns 2 when tenant_id is blank", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "   ",
          plan_id: "plan-1",
          step_index: 0,
          action: { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("missing/invalid tenant_id");
  });

  it("returns 2 when policy_snapshot_id is not a string", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "tenant-1",
          turn_id: "run-1",
          step_id: "step-1",
          attempt_id: "attempt-1",
          key: "agent:test",
          workspace_id: "default",
          policy_snapshot_id: 123,
          plan_id: "plan-1",
          step_index: 0,
          action: { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("missing/invalid policy_snapshot_id");
  });

  it("returns a terminal policy failure result when policy_snapshot_id is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-toolrunner-home-"));
    tempDirs.push(home);
    const stdout = captureStdout();
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      home,
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "tenant-1",
          turn_id: "run-1",
          step_id: "step-1",
          attempt_id: "attempt-1",
          key: "agent:test",
          workspace_id: "default",
          plan_id: "plan-1",
          step_index: 0,
          action: { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
        }),
      ),
    });
    stderr.restore();
    stdout.restore();

    expect(code).toBe(0);
    expect(stderr.writes.join("")).toBe("");
    expect(JSON.parse(stdout.writes.join("").trim())).toMatchObject({
      success: false,
      failureKind: "policy",
      error: "missing/invalid policy snapshot id for executor policy enforcement",
    });
  });

  it("returns 2 with the approval_id diagnostic when approval_id is blank", async () => {
    const stderr = suppressStderr();
    const code = await runToolRunnerFromStdio({
      payloadB64: b64url(
        JSON.stringify({
          tenant_id: "tenant-1",
          turn_id: "run-1",
          step_id: "step-1",
          attempt_id: "attempt-1",
          approval_id: "   ",
          key: "agent:test",
          workspace_id: "default",
          policy_snapshot_id: "policy-1",
          plan_id: "plan-1",
          step_index: 0,
          action: { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
        }),
      ),
    });
    stderr.restore();

    expect(code).toBe(2);
    expect(stderr.writes.join("")).toContain("missing/invalid approval_id");
  });
});
